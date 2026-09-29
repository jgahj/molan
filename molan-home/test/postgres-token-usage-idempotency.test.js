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
        statement === 'RESET ROLE' || statement === 'RESET ALL' || statement.startsWith('SELECT set_config')) {
      return { rows: [], rowCount: 0 };
    }
    if (statement.startsWith('SELECT role, credits FROM luna.runtime_accounts')) {
      return { rows: [{ role: this.state.role, credits: this.state.credits }], rowCount: 1 };
    }
    if (statement.includes("source_table = 'token_usage'")) {
      const document = this.state.rows.get(String(params[0]));
      return { rows: document ? [{ document }] : [], rowCount: document ? 1 : 0 };
    }
    if (statement.startsWith('UPDATE luna.runtime_accounts')) {
      const amount = Number(params[0]) || 0;
      if (this.state.role === 'admin' || this.state.credits < amount) return { rows: [], rowCount: 0 };
      this.state.credits -= amount;
      return { rows: [{ credits: this.state.credits }], rowCount: 1 };
    }
    if (statement.startsWith('INSERT INTO luna.runtime_dissection_rows')) {
      const document = JSON.parse(params[2]);
      this.state.rows.set(String(params[1]), document);
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
  const state = { role: 'normal', credits: 10, rows: new Map() };
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
