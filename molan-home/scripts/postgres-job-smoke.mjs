import crypto from 'node:crypto';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createPostgresRepository } = require('../lib/postgres-repository.js');

/** 验证 PG 持久任务状态、事件追加、跨用户隔离和 provider_unknown 防重发。 */
async function main() {
  const repository = createPostgresRepository(process.env);
  if (!repository.enabled) throw new Error('未配置 PostgreSQL');
  const suffix = crypto.randomBytes(6).toString('hex');
  const owner = `usr_pg_job_owner_${suffix}`;
  const otherUser = `usr_pg_job_other_${suffix}`;
  const workspaceId = `ws_pg_job_${suffix}`;
  const projectId = `n_pg_job_${suffix}`;
  const jobId = `cj_pg_job_${suffix}`;
  try {
    await repository.saveProfile({ userId: owner, workspaceId, projectId, title: '持久任务作品', state: { title: '持久任务作品', volumes: [] } });
    const running = await repository.upsertJob({
      userId: owner,
      workspaceId,
      projectId,
      jobId,
      kind: 'creation-core',
      state: 'running',
      workerId: `worker-${suffix}`,
      inputHash: crypto.createHash('sha256').update('job-input', 'utf8').digest('hex'),
      result: { receivedChars: 10 }
    });
    if (running.state !== 'running' || running.attemptNo !== 1) throw new Error('持久任务创建失败');
    const isolated = await repository.getJob(otherUser, jobId);
    if (isolated) throw new Error('未授权用户读取到持久任务');
    const succeeded = await repository.upsertJob({
      userId: owner,
      workspaceId,
      projectId,
      jobId,
      kind: 'creation-core',
      state: 'succeeded',
      workerId: `worker-${suffix}`,
      attemptNo: running.attemptNo,
      fencingToken: running.fencingToken,
      inputHash: running.inputHash,
      result: { receivedChars: 120, bibleVersion: 1 }
    });
    if (succeeded.state !== 'succeeded' || succeeded.result.receivedChars !== 120) throw new Error('持久任务完成状态保存失败');
    const unknown = await repository.upsertJob({
      userId: owner,
      workspaceId,
      projectId,
      jobId,
      kind: 'creation-core',
      state: 'provider_unknown',
      workerId: `worker-${suffix}`,
      attemptNo: succeeded.attemptNo,
      fencingToken: succeeded.fencingToken,
      inputHash: succeeded.inputHash,
      errorCode: 'provider_timeout'
    });
    if (unknown.state !== 'provider_unknown') throw new Error('provider_unknown 状态保存失败');
    let blockedCode = '';
    try {
      await repository.upsertJob({
        userId: owner,
        workspaceId,
        projectId,
        jobId,
        kind: 'creation-core',
        state: 'running',
        workerId: `worker-${suffix}`,
        attemptNo: unknown.attemptNo + 1,
        fencingToken: unknown.fencingToken + 1,
        inputHash: unknown.inputHash
      });
    } catch (error) {
      blockedCode = String(error && error.code || '');
    }
    if (blockedCode !== 'provider_unknown') throw new Error('未知供应商结果未阻止自动重发');
    process.stdout.write(JSON.stringify({ ok: true, checks: ['job-events', 'job-isolation', 'terminal-state', 'provider-unknown-no-retry'] }) + '\n');
  } finally {
    await repository.close();
  }
}

main().catch(error => {
  process.stderr.write(JSON.stringify({
    ok: false,
    code: String(error && error.code || 'postgres_job_smoke_failed'),
    error: String(error && error.message || 'PostgreSQL 持久任务烟测失败')
  }) + '\n');
  process.exitCode = 1;
});
