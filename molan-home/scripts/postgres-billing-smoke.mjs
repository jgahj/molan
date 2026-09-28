import crypto from 'node:crypto';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createPostgresRepository } = require('../lib/postgres-repository.js');

/** 验证 PG 预算预占、幂等、结算、释放和超额保护。 */
async function main() {
  const repository = createPostgresRepository(process.env);
  if (!repository.enabled) throw new Error('未配置 PostgreSQL');
  const suffix = crypto.randomBytes(6).toString('hex');
  const userId = `usr_pg_billing_${suffix}`;
  const workspaceId = `ws_pg_billing_${suffix}`;
  const projectId = `n_pg_billing_${suffix}`;
  const jobId = `cj_pg_billing_${suffix}`;
  const periodStart = '2026-01-01';
  const periodEnd = '2027-01-01';
  let stage = 'save-profile';
  try {
    await repository.saveProfile({ userId, workspaceId, projectId, title: '预算作品', state: { title: '预算作品', volumes: [] } });
    stage = 'create-job';
    await repository.upsertJob({
      userId,
      workspaceId,
      projectId,
      jobId,
      kind: 'writing',
      state: 'queued',
      inputHash: crypto.createHash('sha256').update('billing', 'utf8').digest('hex')
    });
    stage = 'reserve-budget';
    const reserved = await repository.reserveBudget({
      userId,
      workspaceId,
      projectId,
      jobId,
      reservationId: `reservation_${suffix}`,
      amountMinor: 30,
      limitMinor: 100,
      periodStart,
      periodEnd
    });
    if (!reserved.ok || reserved.state !== 'reserved') throw new Error('预算预占失败');
    stage = 'reserve-idempotent';
    const repeated = await repository.reserveBudget({
      userId,
      workspaceId,
      projectId,
      jobId,
      reservationId: `reservation_${suffix}`,
      amountMinor: 30,
      limitMinor: 100,
      periodStart,
      periodEnd
    });
    if (!repeated.idempotent) throw new Error('预算预占未幂等');
    stage = 'settle-budget';
    const settled = await repository.settleBudget({ userId, reservationId: reserved.id, actualMinor: 20, jobId });
    if (!settled.ok || settled.state !== 'settled') throw new Error('预算结算失败');
    stage = 'settle-idempotent';
    const settledAgain = await repository.settleBudget({ userId, reservationId: reserved.id, actualMinor: 20, jobId });
    if (!settledAgain.idempotent) throw new Error('预算结算未幂等');

    const releaseJob = `cj_pg_billing_release_${suffix}`;
    stage = 'release-job';
    await repository.upsertJob({ userId, workspaceId, projectId, jobId: releaseJob, kind: 'writing', state: 'queued', inputHash: reserved.inputHash || crypto.createHash('sha256').update(releaseJob, 'utf8').digest('hex') });
    stage = 'release-reserve';
    const releaseReservation = await repository.reserveBudget({
      userId,
      workspaceId,
      projectId,
      jobId: releaseJob,
      reservationId: `reservation_release_${suffix}`,
      amountMinor: 10,
      periodStart,
      periodEnd
    });
    stage = 'release-budget';
    const released = await repository.releaseBudget({ userId, reservationId: releaseReservation.id });
    if (!released.ok || released.state !== 'released') throw new Error('预算释放失败');
    let exceededCode = '';
    const exceededJob = `cj_pg_billing_exceeded_${suffix}`;
    stage = 'exceeded-job';
    await repository.upsertJob({ userId, workspaceId, projectId, jobId: exceededJob, kind: 'writing', state: 'queued', inputHash: crypto.createHash('sha256').update(exceededJob, 'utf8').digest('hex') });
    stage = 'exceeded-reserve';
    try {
      await repository.reserveBudget({ userId, workspaceId, projectId, jobId: exceededJob, reservationId: `reservation_exceeded_${suffix}`, amountMinor: 90, periodStart, periodEnd });
    } catch (error) {
      exceededCode = String(error && error.code || '');
    }
    if (exceededCode !== 'budget_exceeded') throw new Error('预算超额未被拒绝');
    process.stdout.write(JSON.stringify({ ok: true, checks: ['reservation-idempotency', 'settlement-idempotency', 'release-ledger', 'budget-limit'] }) + '\n');
  } catch (error) {
    const wrapped = new Error(stage + ': ' + String(error && error.message || ''));
    wrapped.code = error && error.code;
    wrapped.status = error && error.status;
    wrapped.databaseCode = error && error.databaseCode;
    wrapped.databaseMessage = error && error.databaseMessage;
    throw wrapped;
  } finally {
    await repository.close();
  }
}

main().catch(error => {
  process.stderr.write(JSON.stringify({
    ok: false,
    code: String(error && error.code || 'postgres_billing_smoke_failed'),
    error: String(error && error.message || 'PostgreSQL 预算烟测失败')
  }) + '\n');
  process.exitCode = 1;
});
