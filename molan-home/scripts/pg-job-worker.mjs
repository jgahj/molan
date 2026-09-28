import crypto from 'node:crypto';
import os from 'node:os';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createPostgresRepository } = require('../lib/postgres-repository.js');
const { parseChatStream } = require('../lib/molan-node-client.js');

/** 解析本地 worker 参数，只允许显式 stub 模式避免误触发外部供应商。 */
function parseArguments(argv) {
  return { loop: argv.includes('--loop'), once: argv.includes('--once') || !argv.includes('--loop') };
}

/** 为本地端到端测试生成可恢复的最小创作圣经，不模拟外部模型计费。 */
function buildCreationStubBible(input, source = 'local-stub') {
  const plan = input.plan && typeof input.plan === 'object' && !Array.isArray(input.plan) ? input.plan : {};
  const title = String(input.title || plan.title || '未命名小说').trim();
  const genre = String(input.genre || plan.genre || '').trim();
  const prompt = String(input.userPrompt || '').trim();
  return {
    taskConstraints: { title, genre, source },
    premise: { core: prompt.slice(0, 2000), source },
    worldRules: [],
    characters: [],
    creationPlan: plan,
    source
  };
}

function parseGeneratedJson(text) {
  const source = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const value = JSON.parse(source);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (_) {}
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(source.slice(start, end + 1));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (_) { return null; }
}

function workerApiOrigin() {
  const value = String(process.env.MOLAN_WORKER_API_URL || 'http://127.0.0.1:3000').trim();
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('worker 只允许访问本机墨阑 HTTP 服务');
  }
  return url.origin;
}

function sessionTokenHash(token) {
  return crypto.createHash('sha256').update('molan-session:' + String(token || '')).digest('hex');
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function actualCostMinorFromJobInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const candidate = input.actualCostMinor ?? input.costMinor ?? (input.usage && input.usage.costMinor);
  if (candidate === null || candidate === undefined || candidate === '') return null;
  const value = Number(candidate);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

async function createWorkerHttpSession(repository, workerId, userId) {
  const token = crypto.randomBytes(24).toString('hex');
  const tokenHash = sessionTokenHash(token);
  const sessionId = `worker-session-${workerId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const expiresAt = Date.now() + 15 * 60 * 1000;
  await repository.createWorkerAuthSession({ sessionId, userId, legacyId: userId, tokenHash, scope: 'client', expiresAt });
  const baseUrl = workerApiOrigin();
  try {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(1500)
      }).catch(() => null);
      if (response && response.status === 200) return { token, tokenHash, baseUrl };
      await wait(100);
    }
    throw Object.assign(new Error('worker 会话未被应用实例接收'), { code: 'worker_session_unavailable' });
  } catch (error) {
    await repository.revokeWorkerAuthSession(tokenHash).catch(() => {});
    throw error;
  }
}

async function generatePlatformCreationBible(repository, workerId, claimedJob, input) {
  const userId = String(input.userId || '').trim();
  if (!userId) throw Object.assign(new Error('持久任务缺少 userId，拒绝代用户调用模型'), { code: 'worker_owner_missing' });
  const session = await createWorkerHttpSession(repository, workerId, userId);
  try {
    const response = await fetch(`${session.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: String(input.system || '') },
          { role: 'user', content: String(input.userPrompt || '') }
        ],
        model: String(input.modelId || '').trim() || undefined,
        stage: 'writing',
        jsonMode: true,
        creationMode: true,
        temperature: 0.5,
        max_tokens: 9000
      }),
      signal: AbortSignal.timeout(Math.min(900000, Math.max(30000, Number(process.env.MOLAN_WORKER_MODEL_TIMEOUT_MS) || 600000)))
    });
    const raw = await response.text();
    if (!response.ok) {
      const error = new Error(`平台模型 HTTP ${response.status}: ${raw.slice(0, 240)}`);
      error.status = response.status;
      error.code = response.status >= 500 ? 'worker_provider_unknown' : 'worker_provider_failed';
      throw error;
    }
    const parsed = parseChatStream(raw);
    const generated = parseGeneratedJson(parsed.text);
    if (!generated) throw Object.assign(new Error('平台模型返回的创书包不是合法 JSON'), { code: 'worker_invalid_json' });
    return {
      bible: {
        ...buildCreationStubBible(input, 'platform-worker'),
        ...generated,
        source: 'platform-worker',
        provenance: { ...(generated.provenance && typeof generated.provenance === 'object' ? generated.provenance : {}), provider: 'platform-worker', workerId }
      },
      usage: parsed.usage,
      providerRequestId: String(parsed.usage && (parsed.usage.requestId || parsed.usage.request_id) || `platform-${claimedJob.jobId}-${claimedJob.attemptNo}`),
      costMinor: Math.max(0, Math.round((Number(parsed.usage && parsed.usage.creditCost) || 0) * 100))
    };
  } finally {
    await repository.revokeWorkerAuthSession(session.tokenHash).catch(() => {});
  }
}

function providerFailureState(error) {
  const code = String(error && error.code || '');
  return ['worker_provider_failed', 'worker_owner_missing', 'worker_invalid_json', 'provider_mode_invalid', 'unsupported_job_kind'].includes(code) ||
    (Number(error && error.status) >= 400 && Number(error && error.status) < 500) ? 'failed' : 'provider_unknown';
}

/** 处理 PG 创书核心任务，成功必须先写入 Bible，再结束任务。 */
async function processCreationCoreJob(repository, workerId, claimedJob, mode) {
  const input = await repository.getJobInput({
    workerId,
    workspaceId: claimedJob.workspaceId,
    projectId: claimedJob.projectId,
    jobId: claimedJob.jobId
  });
  if (!input || !String(input.bookId || '').trim()) throw new Error('创书任务输入不存在或缺少 bookId');
  if (mode === 'platform') {
    const providerRequestId = `platform-${claimedJob.jobId}-${claimedJob.attemptNo}`;
    await repository.recordProviderAttempt({
      workspaceId: claimedJob.workspaceId,
      projectId: claimedJob.projectId,
      jobId: claimedJob.jobId,
      attemptNo: claimedJob.attemptNo,
      providerRequestId,
      state: 'started',
      usage: { source: 'platform-worker', inputHash: claimedJob.inputHash }
    });
    try {
      if (String(input.providerMode || 'platform') !== 'platform') {
        throw Object.assign(new Error('任务供应商模式与真实 worker 不匹配'), { code: 'provider_mode_invalid' });
      }
      const generated = await generatePlatformCreationBible(repository, workerId, claimedJob, input);
      const completed = await repository.finishCreationCoreJob({
        workerId,
        workspaceId: claimedJob.workspaceId,
        projectId: claimedJob.projectId,
        jobId: claimedJob.jobId,
        attemptNo: claimedJob.attemptNo,
        fencingToken: claimedJob.fencingToken,
        bookId: String(input.bookId),
        bibleId: String(input.bibleId || `bible_${input.bookId}`),
        bible: generated.bible,
        costMinor: generated.costMinor
      });
      if (!completed.finished) {
        if (completed.billingState === 'unknown') {
          await repository.recordProviderAttempt({
            workspaceId: claimedJob.workspaceId,
            projectId: claimedJob.projectId,
            jobId: claimedJob.jobId,
            attemptNo: claimedJob.attemptNo,
            providerRequestId: generated.providerRequestId || providerRequestId,
            state: 'unknown',
            usage: { source: 'platform-worker', inputHash: claimedJob.inputHash, ...(generated.usage || {}), billingState: 'unknown' },
            costMinor: generated.costMinor
          });
          return true;
        }
        throw Object.assign(new Error('创书任务围栏已失效，拒绝写入 Bible'), { code: 'stale_fencing' });
      }
      await repository.recordProviderAttempt({
        workspaceId: claimedJob.workspaceId,
        projectId: claimedJob.projectId,
        jobId: claimedJob.jobId,
        attemptNo: claimedJob.attemptNo,
        providerRequestId: generated.providerRequestId || providerRequestId,
        state: 'succeeded',
        usage: { source: 'platform-worker', inputHash: claimedJob.inputHash, ...(generated.usage || {}) },
        costMinor: generated.costMinor
      });
      return true;
    } catch (error) {
      const state = providerFailureState(error);
      await repository.recordProviderAttempt({
        workspaceId: claimedJob.workspaceId,
        projectId: claimedJob.projectId,
        jobId: claimedJob.jobId,
        attemptNo: claimedJob.attemptNo,
        providerRequestId,
        state: state === 'provider_unknown' ? 'unknown' : 'failed',
        usage: { source: 'platform-worker', inputHash: claimedJob.inputHash, error: String(error && error.message || error).slice(0, 240) }
      });
      const finished = await repository.finishJob({
        workerId,
        workspaceId: claimedJob.workspaceId,
        projectId: claimedJob.projectId,
        jobId: claimedJob.jobId,
        attemptNo: claimedJob.attemptNo,
        fencingToken: claimedJob.fencingToken,
        state,
        errorCode: String(error && error.code || 'worker_provider_failed').slice(0, 120)
      });
      if (!finished) throw new Error('平台 worker 围栏已失效，拒绝写回任务');
      return true;
    }
  }
  if (String(input.providerMode || 'local-stub') !== 'local-stub') {
    return repository.finishJob({
      workerId,
      workspaceId: claimedJob.workspaceId,
      projectId: claimedJob.projectId,
      jobId: claimedJob.jobId,
      attemptNo: claimedJob.attemptNo,
      fencingToken: claimedJob.fencingToken,
      state: 'failed',
      errorCode: 'provider_not_configured'
    });
  }
  await repository.recordProviderAttempt({
    workspaceId: claimedJob.workspaceId,
    projectId: claimedJob.projectId,
    jobId: claimedJob.jobId,
    attemptNo: claimedJob.attemptNo,
    providerRequestId: `local-stub-${claimedJob.jobId}-${claimedJob.attemptNo}`,
    state: mode === 'unknown' ? 'unknown' : mode === 'fail' ? 'failed' : 'started',
    usage: { source: 'local-stub', inputHash: claimedJob.inputHash }
  });
  if (mode === 'unknown') {
    return repository.finishJob({
      workerId,
      workspaceId: claimedJob.workspaceId,
      projectId: claimedJob.projectId,
      jobId: claimedJob.jobId,
      attemptNo: claimedJob.attemptNo,
      fencingToken: claimedJob.fencingToken,
      state: 'provider_unknown',
      errorCode: 'local_stub_unknown'
    });
  }
  if (mode === 'fail') {
    return repository.finishJob({
      workerId,
      workspaceId: claimedJob.workspaceId,
      projectId: claimedJob.projectId,
      jobId: claimedJob.jobId,
      attemptNo: claimedJob.attemptNo,
      fencingToken: claimedJob.fencingToken,
      state: 'failed',
      errorCode: 'local_stub_failed'
    });
  }
  const bible = buildCreationStubBible(input);
  const completed = await repository.finishCreationCoreJob({
    workerId,
    workspaceId: claimedJob.workspaceId,
    projectId: claimedJob.projectId,
    jobId: claimedJob.jobId,
    attemptNo: claimedJob.attemptNo,
    fencingToken: claimedJob.fencingToken,
    bookId: String(input.bookId),
    bibleId: String(input.bibleId || `bible_${input.bookId}`),
    bible,
    costMinor: 0
  });
  if (!completed.finished) {
    if (completed.billingState === 'unknown') return true;
    throw new Error('创书任务围栏已失效，拒绝写入 Bible');
  }
  await repository.recordProviderAttempt({
    workspaceId: claimedJob.workspaceId,
    projectId: claimedJob.projectId,
    jobId: claimedJob.jobId,
    attemptNo: claimedJob.attemptNo,
    providerRequestId: `local-stub-${claimedJob.jobId}-${claimedJob.attemptNo}`,
    state: 'succeeded',
    usage: { source: 'local-stub', inputHash: claimedJob.inputHash, outputTokens: 0 },
    costMinor: 0
  });
  return true;
}

/** 处理一条已领取任务；平台模式只支持已定义的创书核心任务。 */
async function processClaimedJob(repository, workerId, claimedJob, mode) {
  if (claimedJob.kind === 'creation-core') {
    return processCreationCoreJob(repository, workerId, claimedJob, mode);
  }
  const input = await repository.getJobInput({
    workerId,
    workspaceId: claimedJob.workspaceId,
    projectId: claimedJob.projectId,
    jobId: claimedJob.jobId
  });
  // Generic providers can attach their authoritative minor-unit charge to the
  // persisted job input before the worker completes the task.  The value is
  // forwarded to both the attempt record and the atomic terminal write.
  const actualCostMinor = actualCostMinorFromJobInput(input);
  const finish = (state, extra = {}) => repository.finishJob({
    workerId,
    workspaceId: claimedJob.workspaceId,
    projectId: claimedJob.projectId,
    jobId: claimedJob.jobId,
    attemptNo: claimedJob.attemptNo,
    fencingToken: claimedJob.fencingToken,
    state,
    costMinor: actualCostMinor,
    ...extra
  });
  if (mode === 'platform') {
    await repository.recordProviderAttempt({
      workspaceId: claimedJob.workspaceId,
      projectId: claimedJob.projectId,
      jobId: claimedJob.jobId,
      attemptNo: claimedJob.attemptNo,
      providerRequestId: `platform-${claimedJob.jobId}-${claimedJob.attemptNo}`,
      state: 'failed',
      usage: { source: 'platform-worker', inputHash: claimedJob.inputHash, error: 'unsupported_job_kind' }
    });
    return finish('failed', { errorCode: 'unsupported_job_kind' });
  }
  await repository.recordProviderAttempt({
    workspaceId: claimedJob.workspaceId,
    projectId: claimedJob.projectId,
    jobId: claimedJob.jobId,
    attemptNo: claimedJob.attemptNo,
    providerRequestId: `local-stub-${claimedJob.jobId}-${claimedJob.attemptNo}`,
    state: mode === 'unknown' ? 'unknown' : mode === 'fail' ? 'failed' : 'started',
    usage: { source: 'local-stub', inputHash: claimedJob.inputHash },
    costMinor: actualCostMinor
  });
  if (mode === 'unknown') {
    return finish('provider_unknown', { errorCode: 'local_stub_unknown' });
  }
  if (mode === 'fail') {
    return finish('failed', { errorCode: 'local_stub_failed' });
  }
  await repository.recordProviderAttempt({
    workspaceId: claimedJob.workspaceId,
    projectId: claimedJob.projectId,
    jobId: claimedJob.jobId,
    attemptNo: claimedJob.attemptNo,
    providerRequestId: `local-stub-${claimedJob.jobId}-${claimedJob.attemptNo}`,
    state: 'succeeded',
    usage: { source: 'local-stub', inputHash: claimedJob.inputHash, outputTokens: 0 },
    costMinor: actualCostMinor
  });
  return finish('succeeded', { result: { source: 'local-stub', workerId, inputHash: claimedJob.inputHash } });
}

/** 以独立 worker 连接池领取并完成 queued 任务，支持一次运行或持续轮询。 */
async function main() {
  const stubEnabled = process.env.MOLAN_WORKER_STUB === '1';
  const providerMode = stubEnabled
    ? 'local-stub'
    : String(process.env.MOLAN_WORKER_PROVIDER || 'platform').trim().toLowerCase();
  if (!stubEnabled && providerMode !== 'platform') throw new Error('真实 worker 只支持 platform 供应商模式');
  const argumentsValue = parseArguments(process.argv.slice(2));
  const workerId = String(process.env.MOLAN_WORKER_ID || `worker_${os.hostname()}_${process.pid}_${crypto.randomBytes(4).toString('hex')}`).replace(/[^A-Za-z0-9_-]/g, '_');
  const mode = stubEnabled
    ? (['success', 'fail', 'unknown'].includes(String(process.env.MOLAN_WORKER_PROVIDER_MODE || 'success'))
      ? String(process.env.MOLAN_WORKER_PROVIDER_MODE || 'success')
      : 'success')
    : providerMode;
  if (!process.env.MOLAN_PG_WORKER_PASSWORD && !process.env.MOLAN_PG_WORKER_PASSWORD_FILE) {
    throw new Error('独立 worker 必须配置 MOLAN_PG_WORKER_PASSWORD_FILE 或 MOLAN_PG_WORKER_PASSWORD');
  }
  const workerEnvironment = {
    ...process.env,
    MOLAN_PG_USER: process.env.MOLAN_PG_WORKER_USER || 'novel_worker_runtime',
    MOLAN_PG_PASSWORD: process.env.MOLAN_PG_WORKER_PASSWORD || '',
    MOLAN_PG_PASSWORD_FILE: process.env.MOLAN_PG_WORKER_PASSWORD_FILE || '',
    MOLAN_PG_RUNTIME_ROLE: 'none',
    MOLAN_PG_WORKER_ROLE: 'novel_worker'
  };
  const repository = createPostgresRepository({ env: workerEnvironment });
  if (!repository.enabled) throw new Error('未配置 PostgreSQL');
  let claimedCount = 0;
  let finishedCount = 0;
  try {
    do {
      const claimedJob = await repository.claimNextJob(
        workerId,
        Number(process.env.MOLAN_WORKER_LEASE_SECONDS) || 600,
        String(process.env.MOLAN_WORKER_JOB_KIND || '').trim(),
        String(process.env.MOLAN_WORKER_WORKSPACE_ID || '').trim(),
        String(process.env.MOLAN_WORKER_PROJECT_ID || '').trim()
      );
      if (!claimedJob) {
        if (!argumentsValue.loop) break;
        await wait(Math.min(60000, Math.max(1000, Number(process.env.MOLAN_WORKER_POLL_MS) || 5000)));
        continue;
      }
      claimedCount += 1;
      const finished = await processClaimedJob(repository, workerId, claimedJob, mode);
      if (!finished) throw new Error('worker 围栏已失效，拒绝写回任务');
      finishedCount += 1;
      if (argumentsValue.once) break;
    } while (argumentsValue.loop);
    process.stdout.write(JSON.stringify({ ok: true, workerId, mode, claimedCount, finishedCount }) + '\n');
  } finally {
    await repository.close();
  }
}

main().catch(error => {
  process.stderr.write(JSON.stringify({
    ok: false,
    code: String(error && error.code || 'pg_worker_failed'),
    error: String(error && error.message || 'PG worker 执行失败'),
    databaseCode: error && error.databaseCode || '',
    databaseMessage: error && error.databaseMessage || ''
  }) + '\n');
  process.exitCode = 1;
});
