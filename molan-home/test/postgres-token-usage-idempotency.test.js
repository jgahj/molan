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
