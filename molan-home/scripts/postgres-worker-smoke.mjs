import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createPostgresRepository } = require('../lib/postgres-repository.js');

/** 启动一个独立 worker 进程，返回其退出码和脱敏输出。 */
function runWorker(environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve(import.meta.dirname, 'pg-job-worker.mjs'), '--once'], {
      env: { ...environment, MOLAN_WORKER_STUB: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let standardOutput = '';
    let standardError = '';
    child.stdout.on('data', chunk => { standardOutput += chunk.toString(); });
    child.stderr.on('data', chunk => { standardError += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => resolve({ code, standardOutput, standardError }));
  });
}

/** 验证独立 PG worker 的领取、围栏、供应商 attempt 和 provider_unknown 语义。 */
async function main() {
  const repository = createPostgresRepository(process.env);
  if (!repository.enabled) throw new Error('未配置 PostgreSQL');
  const suffix = crypto.randomBytes(6).toString('hex');
  const userId = `usr_pg_worker_${suffix}`;
  const workspaceId = `ws_pg_worker_${suffix}`;
  const projectId = `n_pg_worker_${suffix}`;
  const workerEnvironment = {
    ...process.env,
    MOLAN_PG_USER: process.env.MOLAN_PG_WORKER_USER || 'novel_worker_runtime',
    MOLAN_PG_PASSWORD: process.env.MOLAN_PG_WORKER_PASSWORD || '',
    MOLAN_PG_PASSWORD_FILE: process.env.MOLAN_PG_WORKER_PASSWORD_FILE || path.join(os.homedir(), 'AppData', 'Local', 'molan-postgresql', 'novel-worker-password.txt'),
    MOLAN_PG_RUNTIME_ROLE: 'none',
    MOLAN_PG_WORKER_ROLE: 'novel_worker',
    MOLAN_WORKER_WORKSPACE_ID: workspaceId,
    MOLAN_WORKER_PROJECT_ID: projectId
  };
  try {
    await repository.saveProfile({ userId, workspaceId, projectId, title: 'worker作品', state: { title: 'worker作品', volumes: [] } });
    const creationBookId = `cb_pg_worker_creation_${suffix}`;
    const creationJobId = `cj_pg_worker_creation_${suffix}`;
    await repository.createCreationBookPlaceholder({
      userId,
      workspaceId,
      projectId,
      bookId: creationBookId,
      title: 'worker创书',
      plan: { title: 'worker创书', genre: '本地测试', totalChapters: 1 }
    });
    await repository.upsertJob({
      userId,
      workspaceId,
      projectId,
      jobId: creationJobId,
      kind: 'creation-core',
      state: 'queued',
      inputPayload: {
        providerMode: 'local-stub',
        bookId: creationBookId,
        title: 'worker创书',
        genre: '本地测试',
        plan: { title: 'worker创书', genre: '本地测试', totalChapters: 1 },
        userPrompt: '使用本地 stub 生成可恢复的创作圣经'
      },
      input: { bookId: creationBookId, title: 'worker创书' }
    });
    const creationWorker = await runWorker({ ...workerEnvironment, MOLAN_WORKER_PROVIDER_MODE: 'success', MOLAN_WORKER_JOB_KIND: 'creation-core', MOLAN_WORKER_ID: `worker_creation_${suffix}` });
    if (creationWorker.code !== 0) throw new Error('独立 worker 创书任务失败：' + creationWorker.standardError.slice(-500));
    const creationJob = await repository.getJob(userId, creationJobId);
    const creationBible = await repository.getCreationBible(userId, creationBookId);
    if (!creationJob || creationJob.state !== 'succeeded' || !creationBible || !creationBible.bible || creationBible.bible.version !== 1) {
      throw new Error('worker 创书任务未完成 Bible 落库');
    }

    const budgetBookId = `cb_pg_worker_budget_${suffix}`;
    const budgetJobId = `cj_pg_worker_budget_success_${suffix}`;
    const budgetInput = {
      providerMode: 'local-stub',
      bookId: budgetBookId,
      title: 'worker预算创书',
      genre: '本地测试',
      plan: { title: 'worker预算创书', genre: '本地测试', totalChapters: 1 },
      userPrompt: '使用本地 stub 验证预算结算'
    };
    await repository.upsertJob({
      userId, workspaceId, projectId, jobId: budgetJobId, kind: 'creation-core', state: 'queued',
      inputPayload: budgetInput, input: budgetInput, creationBook: {
        bookId: budgetBookId, title: budgetInput.title, plan: budgetInput.plan, budgetLimit: 1
      }, budgetReservation: {
        reservationId: `reservation_${budgetJobId}`, amountMinor: 30, limitMinor: 100
      }, requireSpend: true
    });
    const budgetSuccessWorker = await runWorker({ ...workerEnvironment, MOLAN_WORKER_PROVIDER_MODE: 'success', MOLAN_WORKER_JOB_KIND: 'creation-core', MOLAN_WORKER_ID: `worker_budget_success_${suffix}` });
    if (budgetSuccessWorker.code !== 0) throw new Error('预算成功 worker 失败：' + budgetSuccessWorker.standardError.slice(-500));
    const settledBudget = await repository.getJobBudget(userId, budgetJobId);
    if (!settledBudget || settledBudget.state !== 'settled' || !settledBudget.ledger.some(entry => entry.entryType === 'charge') || !settledBudget.ledger.some(entry => entry.entryType === 'release')) {
      throw new Error('创书成功后预算未结算并释放差额');
    }

    const failedBookId = `cb_pg_worker_budget_failed_${suffix}`;
    const failedJobId = `cj_pg_worker_budget_failed_${suffix}`;
    await repository.upsertJob({
      userId, workspaceId, projectId, jobId: failedJobId, kind: 'creation-core', state: 'queued',
      inputPayload: { ...budgetInput, bookId: failedBookId }, input: { bookId: failedBookId }, creationBook: {
        bookId: failedBookId, title: 'worker预算失败', plan: budgetInput.plan, budgetLimit: 1
      }, budgetReservation: { reservationId: `reservation_${failedJobId}`, amountMinor: 20, limitMinor: 100 }, requireSpend: true
    });
    const failedWorker = await runWorker({ ...workerEnvironment, MOLAN_WORKER_PROVIDER_MODE: 'fail', MOLAN_WORKER_JOB_KIND: 'creation-core', MOLAN_WORKER_ID: `worker_budget_failed_${suffix}` });
    if (failedWorker.code !== 0) throw new Error('预算失败 worker 失败：' + failedWorker.standardError.slice(-500));
    const releasedBudget = await repository.getJobBudget(userId, failedJobId);
    if (!releasedBudget || releasedBudget.state !== 'released') throw new Error('普通失败未释放创书预算');

    const unknownBookId = `cb_pg_worker_budget_unknown_${suffix}`;
    const unknownBudgetJobId = `cj_pg_worker_budget_unknown_${suffix}`;
    await repository.upsertJob({
      userId, workspaceId, projectId, jobId: unknownBudgetJobId, kind: 'creation-core', state: 'queued',
      inputPayload: { ...budgetInput, bookId: unknownBookId }, input: { bookId: unknownBookId }, creationBook: {
        bookId: unknownBookId, title: 'worker预算未知', plan: budgetInput.plan, budgetLimit: 1
      }, budgetReservation: { reservationId: `reservation_${unknownBudgetJobId}`, amountMinor: 20, limitMinor: 100 }, requireSpend: true
    });
    const unknownBudgetWorker = await runWorker({ ...workerEnvironment, MOLAN_WORKER_PROVIDER_MODE: 'unknown', MOLAN_WORKER_JOB_KIND: 'creation-core', MOLAN_WORKER_ID: `worker_budget_unknown_${suffix}` });
    if (unknownBudgetWorker.code !== 0) throw new Error('预算未知 worker 失败：' + unknownBudgetWorker.standardError.slice(-500));
    const unknownBudget = await repository.getJobBudget(userId, unknownBudgetJobId);
    if (!unknownBudget || unknownBudget.state !== 'unknown' || unknownBudget.ledger.length !== 0) throw new Error('provider_unknown 未保留预算预占');

    const successJobId = `cj_pg_worker_success_${suffix}`;
    await repository.upsertJob({
      userId, workspaceId, projectId, jobId: successJobId, kind: 'internal-test',
      state: 'queued', inputHash: crypto.createHash('sha256').update(successJobId, 'utf8').digest('hex')
    });
    const successWorker = await runWorker({ ...workerEnvironment, MOLAN_WORKER_PROVIDER_MODE: 'success', MOLAN_WORKER_JOB_KIND: 'internal-test', MOLAN_WORKER_ID: `worker_success_${suffix}` });
    if (successWorker.code !== 0) throw new Error('独立 worker 成功任务失败：' + successWorker.standardError.slice(-500));
    const succeeded = await repository.getJob(userId, successJobId);
    if (!succeeded || succeeded.state !== 'succeeded') throw new Error('worker 成功终态未写回');

    const actualCostJobId = `cj_pg_worker_actual_cost_${suffix}`;
    const actualCostInput = { actualCostMinor: 20, source: 'worker-actual-cost-smoke' };
    await repository.upsertJob({
      userId, workspaceId, projectId, jobId: actualCostJobId, kind: 'billing-test',
      state: 'queued', input: actualCostInput, inputPayload: actualCostInput,
      budgetReservation: { reservationId: `reservation_${actualCostJobId}`, amountMinor: 30, limitMinor: 100 },
      requireSpend: true
    });
    const actualCostWorker = await runWorker({
      ...workerEnvironment,
      MOLAN_WORKER_PROVIDER_MODE: 'success',
      MOLAN_WORKER_JOB_KIND: 'billing-test',
      MOLAN_WORKER_ID: `worker_actual_cost_${suffix}`
    });
    if (actualCostWorker.code !== 0) throw new Error('普通任务实际费用 worker 失败：' + actualCostWorker.standardError.slice(-500));
    const actualCostBudget = await repository.getJobBudget(userId, actualCostJobId);
    const actualCostLedger = new Map((actualCostBudget && actualCostBudget.ledger || []).map(entry => [entry.entryType, Number(entry.amountMinor)]));
    if (!actualCostBudget || actualCostBudget.state !== 'settled' || actualCostLedger.get('charge') !== 20 || actualCostLedger.get('release') !== 10) {
      throw new Error('普通任务未按实际费用结算预算：' + JSON.stringify(actualCostBudget));
    }

    const unknownJobId = `cj_pg_worker_unknown_${suffix}`;
    await repository.upsertJob({
      userId, workspaceId, projectId, jobId: unknownJobId, kind: 'provider-test',
      state: 'queued', inputHash: crypto.createHash('sha256').update(unknownJobId, 'utf8').digest('hex')
    });
    const unknownWorker = await runWorker({ ...workerEnvironment, MOLAN_WORKER_PROVIDER_MODE: 'unknown', MOLAN_WORKER_JOB_KIND: 'provider-test', MOLAN_WORKER_ID: `worker_unknown_${suffix}` });
    if (unknownWorker.code !== 0) throw new Error('独立 worker 未知任务失败：' + unknownWorker.standardError.slice(-500));
    const unknown = await repository.getJob(userId, unknownJobId);
    if (!unknown || unknown.state !== 'provider_unknown') throw new Error('provider_unknown 未写回');
    let blockedCode = '';
    try {
      await repository.upsertJob({
        userId, workspaceId, projectId, jobId: unknownJobId, kind: 'provider-test',
        state: 'running', attemptNo: unknown.attemptNo + 1, fencingToken: unknown.fencingToken + 1,
        inputHash: unknown.inputHash
      });
    } catch (error) {
      blockedCode = String(error && error.code || '');
    }
    if (blockedCode !== 'provider_unknown') throw new Error('未知任务未阻止自动重发');

    const fencedJobId = `cj_pg_worker_fenced_${suffix}`;
    await repository.upsertJob({
      userId, workspaceId, projectId, jobId: fencedJobId, kind: 'internal-test',
      state: 'queued', inputHash: crypto.createHash('sha256').update(fencedJobId, 'utf8').digest('hex')
    });
    const workerRepository = createPostgresRepository({ env: workerEnvironment });
    const claimed = await workerRepository.claimNextJob(`worker_fence_${suffix}`, 600, 'internal-test', workspaceId, projectId);
    if (!claimed || claimed.jobId.length === 0) throw new Error('worker 未领取 fencing 任务');
    const staleHeartbeat = await workerRepository.heartbeatJob({
      workerId: `worker_fence_${suffix}`,
      workspaceId: claimed.workspaceId,
      projectId: claimed.projectId,
      jobId: claimed.jobId,
      attemptNo: claimed.attemptNo,
      fencingToken: claimed.fencingToken + 1
    });
    const staleFinish = await workerRepository.finishJob({
      workerId: `worker_fence_${suffix}`,
      workspaceId: claimed.workspaceId,
      projectId: claimed.projectId,
      jobId: claimed.jobId,
      attemptNo: claimed.attemptNo,
      fencingToken: claimed.fencingToken + 1,
      state: 'succeeded'
    });
    if (staleHeartbeat || staleFinish) throw new Error('旧 fencing token 仍可写回');
    if (!await workerRepository.finishJob({
      workerId: `worker_fence_${suffix}`,
      workspaceId: claimed.workspaceId,
      projectId: claimed.projectId,
      jobId: claimed.jobId,
      attemptNo: claimed.attemptNo,
      fencingToken: claimed.fencingToken,
      state: 'succeeded',
      result: { source: 'fencing-smoke' }
    })) throw new Error('当前 fencing token 无法完成任务');
    await workerRepository.close();
    process.stdout.write(JSON.stringify({ ok: true, checks: ['independent-worker', 'creation-core-bible', 'provider-attempt', 'creation-budget-settle-release-unknown', 'generic-worker-actual-cost', 'provider-unknown', 'stale-fencing-reject'] }) + '\n');
  } finally {
    await repository.close();
  }
}

main().catch(error => {
  process.stderr.write(JSON.stringify({
    ok: false,
    code: String(error && error.code || 'postgres_worker_smoke_failed'),
    error: String(error && error.message || 'PostgreSQL worker 烟测失败')
  }) + '\n');
  process.exitCode = 1;
});
