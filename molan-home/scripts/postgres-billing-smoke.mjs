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

    const tokenUserId = `${userId}_usage`;
    const tokenEmail = `pg-billing-${suffix}@smoke.invalid`;
    const outsiderUserId = `${userId}_outsider`;
    stage = 'register-token-account';
    await repository.runtimeRegisterAccount({
      userId: tokenUserId, email: tokenEmail, name: 'PG账务烟测', salt: 'smoke-salt', pwd: 'smoke-hash',
      role: 'normal', credits: 20, spent: 0
    });
    await repository.runtimeRegisterAccount({
      userId: outsiderUserId, email: `pg-billing-outsider-${suffix}@smoke.invalid`, name: 'PG隔离烟测', salt: 'smoke-salt', pwd: 'smoke-hash',
      role: 'normal', credits: 20, spent: 0
    });
    const tokenAccount = await repository.runtimeAccountByUserId(tokenUserId);
    if (!tokenAccount || Number(tokenAccount.credits) !== 20) throw new Error('Token烟测账户创建失败');
    const tokenRequestId = `req_pg_billing_${suffix}`;
    const tokenIdentity = {
      request_id: tokenRequestId, user_email: tokenEmail, user_id: tokenUserId,
      workspace_id: workspaceId, project_id: projectId, model_id: 'smoke-model',
      provider_model: 'smoke/provider-model', messages_sha256: crypto.createHash('sha256').update(suffix).digest('hex'),
      reserved_cost: 7, status: 'reserved', created_at: Date.now(), credit_cost: 0
    };
    stage = 'reserve-token-usage';
    const tokenReservation = await repository.runtimeReserveTokenUsage({
      actorUserId: tokenUserId, userId: tokenUserId, requestId: tokenRequestId,
      reservedCost: 7, document: tokenIdentity, cells: []
    });
    if (!tokenReservation.ok || tokenReservation.existing || Number(tokenReservation.remainingCredits) !== 13) {
      throw new Error('Token费用预占失败');
    }
    stage = 'hold-provider-unknown';
    const pendingDocument = { ...tokenIdentity, status: 'usage_unavailable', usage_source: 'unavailable', total_tokens: null };
    const pending = await repository.runtimeSettleTokenUsage({
      actorUserId: tokenUserId, userId: tokenUserId, requestId: tokenRequestId,
      reservedCost: 7, actualCost: 0, isAdmin: false, holdReservation: true,
      document: pendingDocument, cells: []
    });
    if (!pending.recorded || pending.status !== 'provider_unknown' || pending.billingStatus !== 'pending' || pending.creditCost !== null) {
      throw new Error('未知供应商结果未保留为待核对费用');
    }
    stage = 'read-provider-unknown';
    const retained = await repository.runtimeReserveTokenUsage({
      actorUserId: tokenUserId, userId: tokenUserId, requestId: tokenRequestId,
      reservedCost: 7, document: tokenIdentity, cells: [], lookupOnly: true
    });
    if (!retained.existing || retained.document.status !== 'provider_unknown' || retained.document.credit_cost !== null) {
      throw new Error('未知费用诊断或空费用值未持久化');
    }
    stage = 'cross-actor-token-lookup';
    const crossActorLookup = await repository.runtimeReserveTokenUsage({
      actorUserId: outsiderUserId, userId: outsiderUserId, requestId: tokenRequestId,
      reservedCost: 7, document: tokenIdentity, cells: [], lookupOnly: true
    });
    if (crossActorLookup.existing || !crossActorLookup.missing) throw new Error('其他 actor 可见 token 预占');
    stage = 'reject-inexact-token-usage';
    for (const usage of [
      { total_tokens: 12, provider_usage_incomplete: true },
      { total_tokens: -1, provider_usage_incomplete: false },
      { total_tokens: 1.5, provider_usage_incomplete: false }
    ]) {
      const stillPending = await repository.runtimeSettleTokenUsage({
        actorUserId: tokenUserId, userId: tokenUserId, requestId: tokenRequestId,
        reservedCost: 7, actualCost: 2, isAdmin: false,
        document: { ...pendingDocument, ...usage, status: 'succeeded' }, cells: []
      });
      if (stillPending.recorded || stillPending.status !== 'provider_unknown' || stillPending.billingStatus !== 'pending' || stillPending.creditCost !== null) {
        throw new Error('不完整或非精确用量触发了 token 费用结算');
      }
    }
    stage = 'stale-token-usage-sweep';
    const staleReleased = await repository.runtimeReleaseStaleTokenUsage({ actorUserId: tokenUserId, cutoff: Date.now() + 1000 });
    const afterStaleSweep = await repository.runtimeAccountByUserId(tokenUserId);
    if (staleReleased !== 0 || Number(afterStaleSweep.credits) !== 13 || Number(afterStaleSweep.spent) !== 0) {
      throw new Error('过期扫描退款或扣除了未知费用');
    }
    stage = 'settle-exact-token-usage';
    const exact = await repository.runtimeSettleTokenUsage({
      actorUserId: tokenUserId, userId: tokenUserId, requestId: tokenRequestId,
      reservedCost: 7, actualCost: 2, isAdmin: false,
      document: { ...pendingDocument, status: 'succeeded', usage_source: 'upstream', total_tokens: 12,
        prompt_tokens: 8, completion_tokens: 4, credit_cost: 2 }, cells: []
    });
    if (!exact.recorded || exact.status !== 'succeeded' || Number(exact.creditCost) !== 2) throw new Error('精确Token费用结算失败');
    stage = 'settle-exact-token-usage-idempotent';
    const exactReplay = await repository.runtimeSettleTokenUsage({
      actorUserId: tokenUserId, userId: tokenUserId, requestId: tokenRequestId,
      reservedCost: 7, actualCost: 2, isAdmin: false,
      document: { ...pendingDocument, status: 'succeeded', usage_source: 'upstream', total_tokens: 12,
        prompt_tokens: 8, completion_tokens: 4, credit_cost: 2 }, cells: []
    });
    const afterExactReplay = await repository.runtimeAccountByUserId(tokenUserId);
    if (exactReplay.recorded || Number(afterExactReplay.credits) !== 18 || Number(afterExactReplay.spent) !== 2) {
      throw new Error('精确Token费用重复结算');
    }

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
    process.stdout.write(JSON.stringify({ ok: true, checks: ['reservation-idempotency', 'settlement-idempotency', 'token-usage-unknown-hold', 'cross-actor-token-isolation', 'inexact-token-usage-remains-pending', 'stale-unknown-retained', 'exact-token-settlement-once', 'release-ledger', 'budget-limit'] }) + '\n');
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
