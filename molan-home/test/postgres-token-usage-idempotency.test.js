'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createPostgresRepository } = require('../lib/postgres-repository');

class ReservationClient {
  constructor(state) {
    this.state = state;
  }

  release() {}

  async query(sql, params = []) {
    const statement = String(sql).trim();
    if (statement === 'BEGIN' || statement === 'COMMIT' || statement === 'ROLLBACK' ||
        statement === 'RESET ROLE' || statement === 'RESET ALL') {
      return { rows: [], rowCount: 0 };
    }
    if (statement.startsWith('SELECT set_config')) {
      this.state.actorId = params[1];
      return { rows: [], rowCount: 0 };
    }
    if (statement.startsWith('SELECT role, credits FROM luna.runtime_accounts')) {
      return { rows: [{ role: this.state.role, credits: this.state.credits }], rowCount: 1 };
    }
    if (statement.startsWith('SELECT') && statement.includes("source_table = 'token_usage'")) {
      if (statement.startsWith('SELECT owner_actor_id, owner_user_id, row_key, document')) {
        const rows = [...this.state.rows.values()]
          .filter(row => row.ownerActorId === this.state.actorId || this.state.role === 'admin')
          .map(row => ({ owner_actor_id: row.ownerActorId, owner_user_id: row.ownerUserId, row_key: row.rowKey, document: row.document }));
        return { rows, rowCount: rows.length };
      }
      const row = this.state.rows.get(String(params[0]));
      const visible = row && (row.ownerActorId === this.state.actorId || this.state.role === 'admin');
      return { rows: visible ? [{ document: row.document }] : [], rowCount: visible ? 1 : 0 };
    }
    if (statement.startsWith('UPDATE luna.runtime_accounts')) {
      if (statement.includes('credits = GREATEST(0, credits + $1::numeric - $2::numeric)')) {
        const reserved = Number(params[0]) || 0;
        const actual = Number(params[1]) || 0;
        this.state.credits = Math.max(0, this.state.credits + reserved - actual);
        this.state.spent = Math.max(0, this.state.spent + actual);
        return { rows: [{ credits: this.state.credits }], rowCount: 1 };
      }
      if (statement.includes('credits = credits + $2::numeric')) {
        this.state.credits += Number(params[1]) || 0;
        return { rows: [], rowCount: 1 };
      }
      const amount = Number(params[0]) || 0;
      if (this.state.role === 'admin' || this.state.credits < amount) return { rows: [], rowCount: 0 };
      this.state.credits -= amount;
      return { rows: [{ credits: this.state.credits }], rowCount: 1 };
    }
    if (statement.startsWith('INSERT INTO luna.runtime_dissection_rows')) {
      const document = JSON.parse(params[2]);
      this.state.rows.set(String(params[1]), {
        ownerActorId: this.state.actorId, ownerUserId: String(params[0]), rowKey: String(params[1]), document
      });
      return { rows: [], rowCount: 1 };
    }
    if (statement.startsWith('UPDATE luna.runtime_dissection_rows')) {
      const ownerScoped = statement.includes('owner_actor_id = luna.actor_id()');
      const rowKey = String(params[ownerScoped ? 0 : 1]);
      const row = this.state.rows.get(rowKey);
      if (!row) return { rows: [], rowCount: 0 };
      row.document = JSON.parse(params[ownerScoped ? 1 : 2]);
      return { rows: [], rowCount: 1 };
    }
    if (statement.includes('pg_notify')) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }
}

/** 构造仅覆盖运行时费用账本所需查询的 PostgreSQL 仓储。 */
function reservationRepository(state) {
  const client = new ReservationClient(state);
  class FakePool {
    async connect() { return client; }
    async end() {}
  }
  return createPostgresRepository({
    env: { MOLAN_PG_ENABLED: '1', MOLAN_PG_RUNTIME_ROLE: 'none' },
    Pool: FakePool
  });
}

test('PostgreSQL usage reservation rejects key reuse with a different identity and debits only once', async t => {
  const state = { role: 'normal', credits: 10, spent: 0, rows: new Map() };
  const repository = reservationRepository(state);
  t.after(() => repository.close());
  const document = {
    request_id: 'req_stable', user_email: 'author@example.test', user_id: 'author-1',
    workspace_id: 'workspace-1', project_id: 'project-1', model_id: 'model-1',
    provider_model: 'provider/model-1', messages_sha256: 'a'.repeat(64),
    reserved_cost: 2, status: 'reserved'
  };
  const reserve = (input, reservedCost = 2, lookupOnly = false) => repository.runtimeReserveTokenUsage({
    actorUserId: 'author-1', userId: 'author-1', requestId: 'req_stable',
    reservedCost, document: input, cells: [], lookupOnly
  });

  assert.equal((await reserve(document, 0, true)).missing, true);
  assert.equal(state.credits, 10);
  assert.equal((await reserve(document)).existing, false);
  assert.equal(state.credits, 8);
  assert.equal((await reserve({ ...document, reserved_cost: 0.5 }, 0.5)).existing, true);
  assert.equal(state.credits, 8);
  assert.equal((await reserve({ ...document, messages_sha256: 'b'.repeat(64) })).conflict, true);
  assert.equal(state.credits, 8);
});

test('PostgreSQL provider-unknown usage keeps its reservation until exact evidence settles once', async t => {
  const state = { role: 'normal', credits: 10, spent: 0, rows: new Map() };
  const repository = reservationRepository(state);
  t.after(() => repository.close());
  const identity = {
    request_id: 'req_unknown', user_email: 'author@example.test', user_id: 'author-1',
    workspace_id: 'workspace-1', project_id: 'project-1', model_id: 'model-1',
    provider_model: 'provider/model-1', messages_sha256: 'c'.repeat(64),
    reserved_cost: 2, status: 'reserved', created_at: Date.now(), credit_cost: 0
  };
  const reserve = (document, lookupOnly = false) => repository.runtimeReserveTokenUsage({
    actorUserId: 'author-1', userId: 'author-1', requestId: identity.request_id,
    reservedCost: identity.reserved_cost, document, cells: [], lookupOnly
  });
  const reservation = await reserve(identity);
  assert.equal(reservation.existing, false);
  assert.equal(state.credits, 8);

  const partial = { ...identity, status: 'usage_unavailable', usage_source: 'unavailable', total_tokens: null };
  const held = await repository.runtimeSettleTokenUsage({
    actorUserId: 'author-1', requestId: identity.request_id, reservedCost: identity.reserved_cost,
    actualCost: 0, isAdmin: false, holdReservation: true, document: partial, cells: []
  });
  assert.equal(held.recorded, true);
  assert.equal(held.status, 'provider_unknown');
  assert.equal(held.billingStatus, 'pending');
  assert.equal(held.creditCost, null);
  assert.equal(held.document.credit_cost, null);
  assert.equal(held.document.provider_unknown_diagnostic, 'usage_unavailable');
  assert.equal(state.credits, 8);

  const duplicateHold = await repository.runtimeSettleTokenUsage({
    actorUserId: 'author-1', requestId: identity.request_id, reservedCost: identity.reserved_cost,
    actualCost: 0, isAdmin: false, holdReservation: true, document: partial, cells: []
  });
  assert.equal(duplicateHold.recorded, false);
  assert.equal(duplicateHold.billingStatus, 'pending');
  assert.equal(duplicateHold.creditCost, null);
  assert.equal((await reserve(identity, true)).document.status, 'provider_unknown');

  for (const usage of [
    { total_tokens: 12, provider_usage_incomplete: true },
    { total_tokens: -1, provider_usage_incomplete: false },
    { total_tokens: 1.5, provider_usage_incomplete: false },
    { total_tokens: Number.MAX_SAFE_INTEGER + 1, provider_usage_incomplete: false }
  ]) {
    const stillPending = await repository.runtimeSettleTokenUsage({
      actorUserId: 'author-1', requestId: identity.request_id, reservedCost: identity.reserved_cost,
      actualCost: 0.5, isAdmin: false,
      document: { ...partial, ...usage, status: 'succeeded' }, cells: []
    });
    assert.equal(stillPending.recorded, false);
    assert.equal(stillPending.status, 'provider_unknown');
    assert.equal(stillPending.billingStatus, 'pending');
    assert.equal(stillPending.creditCost, null);
    assert.equal(state.credits, 8);
    assert.equal(state.spent, 0);
  }

  const released = await repository.runtimeReleaseStaleTokenUsage({ actorUserId: 'author-1', cutoff: Date.now() + 1000 });
  assert.equal(released, 0);
  assert.equal(state.credits, 8);

  const exactDocument = {
    ...partial, status: 'succeeded', usage_source: 'upstream', total_tokens: 12,
    prompt_tokens: 8, completion_tokens: 4, credit_cost: 0.5
  };
  const settled = await repository.runtimeSettleTokenUsage({
    actorUserId: 'author-1', requestId: identity.request_id, reservedCost: identity.reserved_cost,
    actualCost: 0.5, isAdmin: false, document: exactDocument, cells: []
  });
  assert.equal(settled.recorded, true);
  assert.equal(settled.creditCost, 0.5);
  assert.equal(settled.status, 'succeeded');
  assert.equal(state.credits, 9.5);
  assert.equal(state.spent, 0.5);

  const replay = await repository.runtimeSettleTokenUsage({
    actorUserId: 'author-1', requestId: identity.request_id, reservedCost: identity.reserved_cost,
    actualCost: 0.5, isAdmin: false, document: exactDocument, cells: []
  });
  assert.equal(replay.recorded, false);
  assert.equal(replay.creditCost, 0.5);
  assert.equal(state.credits, 9.5);
  assert.equal(state.spent, 0.5);
});

test('PostgreSQL dispatch boundary records durable attempts before provider call and reaper does not refund interrupted dispatch', async t => {
  const state = { role: 'normal', credits: 10, spent: 0, rows: new Map() };
  const repository = reservationRepository(state);
  t.after(() => repository.close());

  const identity = {
    request_id: 'req_journal_1', user_email: 'author@example.test', user_id: 'author-1',
    workspace_id: 'workspace-1', project_id: 'project-1', model_id: 'model-1',
    provider_model: 'provider/model-1', messages_sha256: 'd'.repeat(64),
    reserved_cost: 3, status: 'reserved', created_at: Date.now(), credit_cost: 0
  };

  // 1. 预占 3 积分
  await repository.runtimeReserveTokenUsage({
    actorUserId: 'author-1', userId: 'author-1', requestId: identity.request_id,
    reservedCost: identity.reserved_cost, document: identity, cells: []
  });
  assert.equal(state.credits, 7);

  // 2. 第一遍派发记录（首遍独立 attemptId）
  const firstPass = await repository.runtimeRecordDispatchAttempt({
    actorUserId: 'author-1', userId: 'author-1', requestId: identity.request_id,
    attemptId: 'att_pass_1', pass: 1, stage: 'first_pass', modelId: 'model-1', providerModel: 'provider/model-1'
  });
  assert.equal(firstPass.ok, true);
  assert.equal(firstPass.authorized, true);
  assert.equal(firstPass.status, 'dispatched');
  assert.equal(firstPass.attempts.length, 1);
  assert.equal(firstPass.attempts[0].attemptId, 'att_pass_1');

  // 3. 第二遍派发记录（独立 attemptId）
  const secondPass = await repository.runtimeRecordDispatchAttempt({
    actorUserId: 'author-1', userId: 'author-1', requestId: identity.request_id,
    attemptId: 'att_pass_2', pass: 2, stage: 'second_pass', modelId: 'model-1', providerModel: 'provider/model-1'
  });
  assert.equal(secondPass.ok, true);
  assert.equal(secondPass.authorized, true);
  assert.equal(secondPass.status, 'dispatched');
  assert.equal(secondPass.attempts.length, 2);
  assert.equal(secondPass.attempts[1].attemptId, 'att_pass_2');

  // 4. 重复 attempt ID 拒绝授权，不得重复供应商请求
  const duplicateAttempt = await repository.runtimeRecordDispatchAttempt({
    actorUserId: 'author-1', userId: 'author-1', requestId: identity.request_id,
    attemptId: 'att_pass_2', pass: 2, stage: 'second_pass', modelId: 'model-1', providerModel: 'provider/model-1'
  });
  assert.equal(duplicateAttempt.ok, false);
  assert.equal(duplicateAttempt.authorized, false);
  assert.equal(duplicateAttempt.duplicate, true);

  // 5. 活动中的 dispatched 请求在未超时时不被 reaper 提前变为 unknown
  const prematureReap = await repository.runtimeReleaseStaleTokenUsage({
    actorUserId: 'author-1', cutoff: Date.now() - 60000
  });
  assert.equal(prematureReap, 0);
  const rowBeforeExpiry = state.rows.get('req_journal_1');
  assert.equal(rowBeforeExpiry.document.status, 'dispatched');

  // 6. 进程中断恢复接口：启动时将中断的 dispatched 恢复为 provider_unknown
  const recoverRes = await repository.runtimeRecoverInterruptedUsage({ actorUserId: 'author-1' });
  assert.equal(recoverRes.recovered, 1);
  const rowAfterRecover = state.rows.get('req_journal_1');
  assert.equal(rowAfterRecover.document.status, 'provider_unknown');
  assert.equal(rowAfterRecover.document.credit_cost, null);

  // 6b. 已恢复为 provider_unknown 的请求拒绝授权新 attempt，不得重复调用供应商
  const unknownAttempt = await repository.runtimeRecordDispatchAttempt({
    actorUserId: 'author-1', userId: 'author-1', requestId: identity.request_id,
    attemptId: 'att_unknown_new', pass: 3, stage: 'third_pass'
  });
  assert.equal(unknownAttempt.ok, false);
  assert.equal(unknownAttempt.authorized, false);
  assert.equal(unknownAttempt.status, 'provider_unknown');

  // 7. 即使过期 reaper 也绝不退款 provider_unknown
  const released = await repository.runtimeReleaseStaleTokenUsage({
    actorUserId: 'author-1', cutoff: Date.now() + 60000
  });
  assert.equal(released, 0);
  assert.equal(state.credits, 7);

  // 8. 真实完整用量后续幂等结算
  const exactDoc = {
    ...identity, status: 'succeeded', usage_source: 'upstream', total_tokens: 20,
    prompt_tokens: 15, completion_tokens: 5, credit_cost: 1
  };
  const settled = await repository.runtimeSettleTokenUsage({
    actorUserId: 'author-1', requestId: identity.request_id, reservedCost: identity.reserved_cost,
    actualCost: 1, isAdmin: false, document: exactDoc, cells: []
  });
  assert.equal(settled.recorded, true);
  assert.equal(settled.creditCost, 1);
  assert.equal(state.credits, 9);
  assert.equal(state.spent, 1);

  // 9. 已结算后尝试再次派发必须被拒绝
  const postSettledAttempt = await repository.runtimeRecordDispatchAttempt({
    actorUserId: 'author-1', userId: 'author-1', requestId: identity.request_id,
    attemptId: 'att_post_settle', pass: 3, stage: 'third_pass'
  });
  assert.equal(postSettledAttempt.ok, false);
  assert.equal(postSettledAttempt.authorized, false);
  assert.equal(postSettledAttempt.status, 'settled');
});

test('PostgreSQL regression: cutoff recovery branch, cross-instance active protection, expired recovery, and refund bypass prevention', async t => {
  const state = { role: 'normal', credits: 10, spent: 0, rows: new Map() };
  const repository = reservationRepository(state);
  t.after(() => repository.close());

  const now = Date.now();

  // 1. 回归实际触发 cutoff 恢复分支：有 cutoff 时 rowTime 正确识别，旧请求恢复，新请求保留
  const oldDoc = {
    request_id: 'req_cut_old', user_email: 'author@example.test', user_id: 'author-1',
    reserved_cost: 2, status: 'reserved', created_at: now - 60000, updated_at: now - 60000
  };
  await repository.runtimeReserveTokenUsage({
    actorUserId: 'author-1', userId: 'author-1', requestId: 'req_cut_old',
    reservedCost: 2, document: oldDoc, cells: []
  });
  await repository.runtimeRecordDispatchAttempt({
    actorUserId: 'author-1', userId: 'author-1', requestId: 'req_cut_old',
    instanceId: 'inst_local', attemptId: 'att_cut_old', pass: 1, stage: 'single_pass'
  });
  // 手工调整 updated_at 为旧时间以模拟 60s 前的派发
  state.rows.get('req_cut_old').document.updated_at = now - 60000;

  const recentDoc = {
    request_id: 'req_cut_recent', user_email: 'author@example.test', user_id: 'author-1',
    reserved_cost: 2, status: 'reserved', created_at: now - 10000, updated_at: now - 10000
  };
  await repository.runtimeReserveTokenUsage({
    actorUserId: 'author-1', userId: 'author-1', requestId: 'req_cut_recent',
    reservedCost: 2, document: recentDoc, cells: []
  });
  await repository.runtimeRecordDispatchAttempt({
    actorUserId: 'author-1', userId: 'author-1', requestId: 'req_cut_recent',
    instanceId: 'inst_local', attemptId: 'att_cut_recent', pass: 1, stage: 'single_pass'
  });
  state.rows.get('req_cut_recent').document.updated_at = now - 10000;

  // 使用 cutoff = now - 30000 执行恢复，必须无 ReferenceError 且旧的恢复，近期的不恢复
  const cutoffRecover = await repository.runtimeRecoverInterruptedUsage({
    actorUserId: 'author-1',
    instanceId: 'inst_local',
    cutoff: now - 30000
  });
  assert.equal(cutoffRecover.recovered, 1);
  assert.equal(state.rows.get('req_cut_old').document.status, 'provider_unknown');
  assert.equal(state.rows.get('req_cut_recent').document.status, 'dispatched');

  // 将 req_cut_recent 正常结算，以便步骤 2 专注验证跨实例隔离
  await repository.runtimeSettleTokenUsage({
    actorUserId: 'author-1', requestId: 'req_cut_recent', reservedCost: 2,
    actualCost: 1, isAdmin: false,
    document: { ...recentDoc, status: 'succeeded', total_tokens: 20 }, cells: []
  });

  // 2. 跨实例活动保护与 reaper lease 守则：另一实例活跃中，cutoff 不能覆盖未过期其他实例
  const activeOtherDoc = {
    request_id: 'req_other_active', user_email: 'author@example.test', user_id: 'author-1',
    reserved_cost: 2, status: 'reserved', created_at: now - 60000, updated_at: now - 60000
  };
  await repository.runtimeReserveTokenUsage({
    actorUserId: 'author-1', userId: 'author-1', requestId: 'req_other_active',
    reservedCost: 2, document: activeOtherDoc, cells: []
  });
  await repository.runtimeRecordDispatchAttempt({
    actorUserId: 'author-1', userId: 'author-1', requestId: 'req_other_active',
    instanceId: 'inst_remote', attemptId: 'att_remote_1', pass: 1, stage: 'single_pass',
    leaseMs: 300000
  });
  state.rows.get('req_other_active').document.updated_at = now - 60000;

  // inst_local 尝试执行 recovery 和 reaper，cutoff 即使大于 rowTime 也绝不覆盖未过期远程实例
  const otherRecover = await repository.runtimeRecoverInterruptedUsage({
    actorUserId: 'author-1',
    instanceId: 'inst_local',
    cutoff: now + 100000
  });
  assert.equal(otherRecover.recovered, 0);
  assert.equal(state.rows.get('req_other_active').document.status, 'dispatched');

  const otherReap = await repository.runtimeReleaseStaleTokenUsage({
    actorUserId: 'author-1',
    instanceId: 'inst_local',
    cutoff: now + 100000
  });
  assert.equal(otherReap, 0);
  assert.equal(state.rows.get('req_other_active').document.status, 'dispatched');

  // 3. 过期恢复：当另一实例租约已过期时，正常恢复为 provider_unknown
  state.rows.get('req_other_active').document.lease_until = now - 5000;
  const expiredRecover = await repository.runtimeRecoverInterruptedUsage({
    actorUserId: 'author-1',
    instanceId: 'inst_local',
    cutoff: now
  });
  assert.equal(expiredRecover.recovered, 1);
  assert.equal(state.rows.get('req_other_active').document.status, 'provider_unknown');

  // 4. null / 空串 / 布尔 / 正金额退款绕过拦截
  const bypassDoc = {
    request_id: 'req_bypass_test', user_email: 'author@example.test', user_id: 'author-1',
    reserved_cost: 2, status: 'reserved', created_at: now, updated_at: now
  };
  await repository.runtimeReserveTokenUsage({
    actorUserId: 'author-1', userId: 'author-1', requestId: 'req_bypass_test',
    reservedCost: 2, document: bypassDoc, cells: []
  });
  await repository.runtimeRecordDispatchAttempt({
    actorUserId: 'author-1', userId: 'author-1', requestId: 'req_bypass_test',
    instanceId: 'inst_local', attemptId: 'att_b1', pass: 1, stage: 'single_pass'
  });
  const creditsBeforeBypass = state.credits;

  for (const bypassUsage of [
    { total_tokens: null },
    { total_tokens: '' },
    { total_tokens: '   ' },
    { total_tokens: false },
    { total_tokens: true },
    {}
  ]) {
    // 无论是 0 费用 aborted 还是正金额 0.5 结算，无明确证据均保留 null 不退款
    const resAborted = await repository.runtimeSettleTokenUsage({
      actorUserId: 'author-1', requestId: 'req_bypass_test', reservedCost: 2,
      actualCost: 0, isAdmin: false,
      document: { ...bypassDoc, status: 'aborted', ...bypassUsage }, cells: []
    });
    assert.equal(resAborted.recorded, false);
    assert.equal(resAborted.creditCost, null);
    assert.equal(state.credits, creditsBeforeBypass);

    const resPositive = await repository.runtimeSettleTokenUsage({
      actorUserId: 'author-1', requestId: 'req_bypass_test', reservedCost: 2,
      actualCost: 0.5, isAdmin: false,
      document: { ...bypassDoc, status: 'succeeded', ...bypassUsage }, cells: []
    });
    assert.equal(resPositive.recorded, false);
    assert.equal(resPositive.creditCost, null);
    assert.equal(state.credits, creditsBeforeBypass);
  }

  // 5. 符合规范的明确数值字符串 / 整数完整证据结算与幂等
  const exactStringSettled = await repository.runtimeSettleTokenUsage({
    actorUserId: 'author-1', requestId: 'req_bypass_test', reservedCost: 2,
    actualCost: 0.5, isAdmin: false,
    document: {
      ...bypassDoc, status: 'succeeded', usage_source: 'upstream',
      total_tokens: '100', prompt_tokens: '80', completion_tokens: '20'
    }, cells: []
  });
  assert.equal(exactStringSettled.recorded, true);
  assert.equal(exactStringSettled.creditCost, 0.5);
  assert.equal(exactStringSettled.status, 'succeeded');
  assert.equal(state.credits, creditsBeforeBypass + 1.5); // 退还预占差额 2.0 - 0.5 = 1.5

  // 再次传入相同结算：幂等
  const replaySettled = await repository.runtimeSettleTokenUsage({
    actorUserId: 'author-1', requestId: 'req_bypass_test', reservedCost: 2,
    actualCost: 0.5, isAdmin: false,
    document: {
      ...bypassDoc, status: 'succeeded', usage_source: 'upstream',
      total_tokens: '100', prompt_tokens: '80', completion_tokens: '20'
    }, cells: []
  });
  assert.equal(replaySettled.recorded, false);
  assert.equal(replaySettled.creditCost, 0.5);
  assert.equal(state.credits, creditsBeforeBypass + 1.5);
});
