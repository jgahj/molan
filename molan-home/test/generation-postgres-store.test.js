'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { createPostgresRepository, internalUuid } = require('../lib/postgres-repository');
const { createPostgresGenerationStore } = require('../lib/generation/postgres-store');

const ACTOR = 'author-1';
const ACTOR_UUID = internalUuid(ACTOR);
const WORKSPACE_UUID = internalUuid('workspace-1');
const PROJECT_UUID = internalUuid('project-1');
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_1 = '22222222-2222-4222-8222-222222222222';
const OWNER_2 = '33333333-3333-4333-8333-333333333333';
const BASE = 1700000000000;

function makeRun(overrides = {}) {
  return {
    id: RUN_ID,
    workspace_id: WORKSPACE_UUID,
    project_id: PROJECT_UUID,
    workspace_legacy_id: 'workspace-1',
    project_legacy_id: 'project-1',
    requested_by: ACTOR_UUID,
    chapter_id: 'chapter_1',
    pipeline_version: 'test',
    state: 'created',
    attempt_no: 0,
    idempotency_key: 'key',
    request_hash: 'a'.repeat(64),
    input: { creationBookId: 'book-1', chapterId: 'chapter_1', chapterContract: { chapterNo: 1 } },
    manifest: {},
    result: {},
    reserved_cost_minor: 0,
    actual_cost_minor: 0,
    cancel_requested: false,
    pause_requested: false,
    lease_owner: null,
    lease_until: null,
    fencing_token: 0,
    error_code: '',
    error_detail: '',
    created_at: new Date(BASE),
    updated_at: new Date(BASE),
    finished_at: null,
    ...overrides
  };
}

function copy(value) {
  return structuredClone(value);
}

class FakePgClient {
  constructor(state) {
    this.state = state;
    this.snapshot = null;
    this.failNextEventInsert = false;
    this.queries = [];
  }

  release() {}

  async query(sql, params = []) {
    const statement = String(sql).trim();
    this.queries.push({ statement, params: copy(params) });
    if (/^(SET ROLE|RESET ROLE|RESET ALL|SELECT set_config|SELECT luna\.ensure_actor)/i.test(statement)) return { rows: [], rowCount: 0 };
    if (statement === 'BEGIN') {
      this.snapshot = copy(this.state);
      return { rows: [], rowCount: 0 };
    }
    if (statement === 'COMMIT') {
      this.snapshot = null;
      return { rows: [], rowCount: 0 };
    }
    if (statement === 'ROLLBACK') {
      if (this.snapshot) Object.assign(this.state, copy(this.snapshot));
      this.snapshot = null;
      return { rows: [], rowCount: 0 };
    }
    if (statement.includes('FROM luna.project_access')) {
      return { rows: [{
        workspace_uuid: WORKSPACE_UUID, project_uuid: PROJECT_UUID, role: 'owner',
        project_status: 'active', can_spend: true, project_revision: 1, acl_revision: 1
      }], rowCount: 1 };
    }
    if (statement.includes('SELECT r.* FROM luna.generation_runs r')) {
      const states = new Set(params[1] || []);
      const cutoff = new Date(Number(params[4]));
      const rows = [...this.state.runs.values()].filter(row =>
        row.requested_by === params[0] && states.has(row.state) && row.lease_owner &&
        row.lease_until && row.lease_until <= cutoff &&
        (params[2] == null || row.workspace_id === params[2]) &&
        (params[3] == null || row.project_id === params[3])
      );
      return { rows: rows.map(copy), rowCount: rows.length };
    }
    if (statement.includes('FROM luna.outbox o')) {
      assert.match(statement, /JOIN luna\.context_snapshots cs/);
      assert.match(statement, /mr\.body_hash = \$5::text/);
      const receipt = this.state.receipts.get(params[2]);
      return { rows: receipt ? [copy(receipt)] : [], rowCount: receipt ? 1 : 0 };
    }
    if (statement.includes('SELECT coalesce(max(event_seq),0)+1 AS next_seq')) {
      const generationId = params[2];
      const next = this.state.events.filter(event => event.generation_id === generationId)
        .reduce((max, event) => Math.max(max, Number(event.event_seq) || 0), 0) + 1;
      return { rows: [{ next_seq: next }], rowCount: 1 };
    }
    if (statement.startsWith('INSERT INTO luna.generation_run_events')) {
      if (this.failNextEventInsert) {
        this.failNextEventInsert = false;
        throw new Error('injected event failure');
      }
      this.state.events.push({
        workspace_id: params[0], project_id: params[1], generation_id: params[2],
        event_seq: Number(params[3]), state: params[4], payload: JSON.parse(params[5]),
        created_at: params.length > 6 ? new Date(Number(params[6])) : new Date(BASE)
      });
      return { rows: [], rowCount: 1 };
    }
    if (statement.startsWith('SELECT input FROM luna.generation_runs')) {
      const row = this.state.runs.get(params[2]);
      return { rows: row ? [{ input: copy(row.input) }] : [], rowCount: row ? 1 : 0 };
    }
    if (statement.startsWith('SELECT * FROM luna.generation_runs') || statement.startsWith('SELECT r.*')) {
      const row = this.state.runs.get(params[2]);
      return { rows: row ? [copy(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (statement.startsWith('SELECT * FROM luna.generation_runs')) {
      const row = this.state.runs.get(params[2]);
      return { rows: row ? [copy(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (statement.startsWith('UPDATE luna.generation_runs')) return this.updateRun(statement, params);
    if (statement.startsWith('INSERT INTO luna.generation_stage_runs')) {
      const key = `${params[2]}:${params[4]}:${params[5]}`;
      this.state.stages.set(key, {
        generation_id: params[2], stage: params[4], attempt_no: params[5],
        reserved_cost_minor: params[13], actual_cost_minor: params[14]
      });
      return { rows: [{ generation_id: params[2] }], rowCount: 1 };
    }
    throw new Error(`Unexpected PostgreSQL contract query: ${statement.slice(0, 220)}`);
  }

  updateRun(statement, params) {
    const row = this.state.runs.get(params[2]);
    if (!row) return { rows: [], rowCount: 0 };
    if (statement.includes('SET lease_owner = $5::uuid')) {
      const cutoff = new Date(Number(params[6]));
      if (row.requested_by !== params[3] || row.state !== params[7] || Number(row.fencing_token) !== Number(params[8]) ||
          row.lease_until && row.lease_until > cutoff) return { rows: [], rowCount: 0 };
      row.lease_owner = params[4];
      row.lease_until = new Date(Number(params[5]));
      row.fencing_token = Number(row.fencing_token) + 1;
      row.updated_at = new Date(Number(params[6]));
      return { rows: [{ fencing_token: row.fencing_token }], rowCount: 1 };
    }
    if (statement.includes('SET lease_until = to_timestamp')) {
      if (row.requested_by !== params[3] || row.lease_owner !== params[4] || Number(row.fencing_token) !== Number(params[5]) ||
          !row.lease_until || row.lease_until <= new Date(Number(params[7]))) return { rows: [], rowCount: 0 };
      row.lease_until = new Date(Number(params[6]));
      row.updated_at = new Date(Number(params[7]));
      return { rows: [], rowCount: 1 };
    }
    if (statement.includes('SET lease_owner = NULL')) {
      if (row.requested_by !== params[3] || row.lease_owner !== params[4] || Number(row.fencing_token) !== Number(params[5])) return { rows: [], rowCount: 0 };
      row.lease_owner = null;
      row.lease_until = null;
      row.updated_at = new Date(Number(params[6]));
      return { rows: [], rowCount: 1 };
    }
    if (statement.includes('SET reserved_cost_minor = COALESCE')) {
      if (params[3] != null && (row.lease_owner !== params[4] || Number(row.fencing_token) !== Number(params[3]) || row.lease_until <= new Date(Number(params[5])))) return { rows: [], rowCount: 0 };
      row.reserved_cost_minor = [...this.state.stages.values()].reduce((sum, stage) => sum + Number(stage.reserved_cost_minor || 0), 0);
      row.actual_cost_minor = [...this.state.stages.values()].reduce((sum, stage) => sum + Number(stage.actual_cost_minor || 0), 0);
      row.updated_at = new Date(Number(params[5]));
      return { rows: [], rowCount: 1 };
    }
    if (statement.includes('SET state = $5::text, pause_requested = $6::boolean')) {
      if (row.state !== params[6] || Number(row.fencing_token) !== Number(params[8])) return { rows: [], rowCount: 0 };
      row.state = params[4];
      row.pause_requested = params[5];
      row.updated_at = new Date(Number(params[7]));
      return { rows: [], rowCount: 1 };
    }
    if (statement.includes('attempt_no = attempt_no + 1')) {
      if (row.state !== 'paused' || Number(row.fencing_token) !== Number(params[5])) return { rows: [], rowCount: 0 };
      row.state = params[4];
      row.pause_requested = false;
      row.attempt_no += 1;
      row.lease_owner = null;
      row.lease_until = null;
      row.fencing_token += 1;
      row.updated_at = new Date(Number(params[6]));
      row.finished_at = null;
      return { rows: [], rowCount: 1 };
    }
    if (statement.includes('started_at = COALESCE')) {
      if (row.state !== params[5] || row.lease_owner !== params[6] || Number(row.fencing_token) !== Number(params[8]) ||
          !row.lease_until || row.lease_until <= new Date(Number(params[7]))) return { rows: [], rowCount: 0 };
      row.state = params[4];
      row.pause_requested = false;
      row.updated_at = new Date(Number(params[7]));
      return { rows: [], rowCount: 1 };
    }
    if (statement.includes('SET state = $5::text, result = $6::jsonb')) {
      if (row.state !== params[9] || Number(row.fencing_token) !== Number(params[10]) || !row.lease_owner || row.lease_until > new Date(Number(params[8]))) return { rows: [], rowCount: 0 };
      Object.assign(row, {
        state: params[4], result: JSON.parse(params[5]), error_code: params[6], error_detail: params[7],
        pause_requested: false, lease_owner: null, lease_until: null,
        fencing_token: Number(row.fencing_token) + 1, updated_at: new Date(Number(params[8])),
        finished_at: ['committed', 'provider_unknown'].includes(params[4]) ? new Date(Number(params[8])) : null
      });
      return { rows: [{ state: row.state }], rowCount: 1 };
    }
    if (statement.includes('SET state = $5::text')) {
      if (row.state !== params[13]) return { rows: [], rowCount: 0 };
      if (params[14] != null && (row.lease_owner !== params[15] || Number(row.fencing_token) !== Number(params[14]) || row.lease_until <= new Date(Number(params[16])))) return { rows: [], rowCount: 0 };
      row.state = params[4];
      row.result = params[5] ? JSON.parse(params[6]) : row.result;
      row.manifest = params[7] ? JSON.parse(params[8]) : row.manifest;
      row.error_code = params[9];
      row.error_detail = params[10];
      row.cancel_requested = row.cancel_requested || params[11];
      row.updated_at = new Date(Number(params[16]));
      row.finished_at = params[12] ? new Date(Number(params[16])) : row.finished_at;
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected UPDATE generation_runs contract: ${statement.slice(0, 220)}`);
  }
}

function fixture() {
  const state = { runs: new Map([[RUN_ID, makeRun()]]), events: [], stages: new Map(), receipts: new Map() };
  const client = new FakePgClient(state);
  class FakePool {
    async connect() { return client; }
    async end() {}
  }
  const repository = createPostgresRepository({
    env: { MOLAN_PG_ENABLED: '1', MOLAN_PG_RUNTIME_ROLE: 'none' },
    Pool: FakePool
  });
  return { state, client, repository, store: createPostgresGenerationStore(repository) };
}

const scope = { workspaceId: 'workspace-1', projectId: 'project-1', actorUserId: ACTOR, id: RUN_ID };

test('PostgreSQL Generation store fences lease takeover, state events, stages, and progress events', async t => {
  const { state, client, repository, store } = fixture();
  t.after(() => repository.close());
  const first = await store.acquireLease(repository, { ...scope, leaseOwner: OWNER_1, now: BASE, ttlMs: 15000 });
  assert.equal(first.acquired, true);
  assert.equal(first.fencingToken, 1);
  const competing = await store.acquireLease(repository, { ...scope, leaseOwner: OWNER_2, now: BASE + 1, ttlMs: 15000 });
  assert.equal(competing.acquired, false);

  const worker = { ...scope, leaseOwner: OWNER_1, fencingToken: first.fencingToken };
  await assert.rejects(store.updateRun(repository, { ...worker, fencingToken: 0, state: 'request_validated', now: BASE + 2 }), { code: 'STATE_CONFLICT' });
  await store.updateRun(repository, { ...worker, state: 'request_validated', now: BASE + 2, event: { message: 'started' } });
  await store.recordStage(repository, { ...worker, generationId: RUN_ID, stage: 'writer', status: 'completed', reservedCostMinor: 20, actualCostMinor: 10, now: BASE + 3 });
  assert.equal(state.runs.get(RUN_ID).reserved_cost_minor, 20);
  await assert.rejects(store.appendEvent(repository, { ...worker, fencingToken: 0, event: { message: 'stale' }, now: BASE + 4 }), { code: 'STATE_CONFLICT' });
  assert.equal(state.events.length, 1);
  assert.equal(state.stages.size, 1);

  client.failNextEventInsert = true;
  await assert.rejects(store.updateRun(repository, { ...worker, state: 'genre_resolved', now: BASE + 5, event: { message: 'fail' } }));
  assert.equal(state.runs.get(RUN_ID).state, 'request_validated');
  assert.equal(state.events.length, 1);
  await repository.close();
});

test('PostgreSQL safe pause is consumed at the Provider boundary and resume advances the fence', async t => {
  const { state, repository, store } = fixture();
  t.after(() => repository.close());
  const row = state.runs.get(RUN_ID);
  Object.assign(row, {
    state: 'scene_planning', lease_owner: OWNER_1, lease_until: new Date(BASE + 50000), fencing_token: 4
  });
  const worker = { ...scope, leaseOwner: OWNER_1, fencingToken: 4 };
  const requested = await store.requestPause(repository, { ...scope, now: BASE + 1 });
  assert.equal(requested.pauseRequested, true);
  const boundary = await store.beginProvider(repository, { ...worker, now: BASE + 2 });
  assert.equal(boundary.paused, true);
  assert.equal(boundary.run.state, 'paused');
  assert.equal(boundary.run.pauseRequested, false);
  assert.equal(await store.releaseLease(repository, { ...worker, now: BASE + 3 }), true);
  const resumed = await store.resumeRun(repository, { ...scope, now: BASE + 4 });
  assert.equal(resumed.state, 'created');
  assert.equal(resumed.attemptNo, 1);
  assert.equal(resumed.fencingToken, 5);
  const nextLease = await store.acquireLease(repository, { ...scope, leaseOwner: OWNER_2, now: BASE + 5, ttlMs: 15000 });
  assert.equal(nextLease.fencingToken, 6);
  const resumedWorker = { ...scope, leaseOwner: OWNER_2, fencingToken: nextLease.fencingToken };
  let resumedRun;
  for (const state of [
    'request_validated', 'genre_resolved', 'style_resolved', 'context_built', 'contract_validated',
    'pre_generation_guard', 'scene_planning'
  ]) {
    resumedRun = await store.updateRun(repository, { ...resumedWorker, state, now: BASE + 6 });
  }
  assert.equal(resumedRun.state, 'scene_planning');
  const started = await store.beginProvider(repository, {
    ...resumedWorker, now: BASE + 7
  });
  assert.equal(started.paused, false);
  assert.equal(started.run.state, 'generating');
  await assert.rejects(store.requestPause(repository, { ...scope, now: BASE + 7 }), { code: 'STATE_CONFLICT' });
});

test('PostgreSQL recovery pauses pre-Provider work, marks Provider work unknown, and reconciles commit receipts', async t => {
  const { state, client, repository, store } = fixture();
  t.after(() => repository.close());
  const outputHash = crypto.createHash('sha256').update('committed chapter', 'utf8').digest('hex');
  const safeId = '44444444-4444-4444-8444-444444444444';
  const providerId = '55555555-5555-4555-8555-555555555555';
  const commitId = '66666666-6666-4666-8666-666666666666';
  const unresolvedCommitId = '77777777-7777-4777-8777-777777777777';
  const expired = { lease_owner: OWNER_1, lease_until: new Date(BASE - 1), fencing_token: 7 };
  state.runs.set(safeId, makeRun({ id: safeId, state: 'scene_planning', ...expired }));
  state.runs.set(providerId, makeRun({ id: providerId, state: 'generating', ...expired }));
  state.runs.set(commitId, makeRun({
    id: commitId, state: 'committing', result: { outputHash }, ...expired
  }));
  state.runs.set(unresolvedCommitId, makeRun({ id: unresolvedCommitId, state: 'committing', ...expired }));
  const manuscriptId = internalUuid('manuscript:book-1:chapter:1');
  state.receipts.set(manuscriptId, {
    payload: { snapshotId: 'snapshot-1' }, aggregate_revision: 12, aggregate_id: 'commit-1'
  });

  const recovered = await store.recoverExpiredRuns(repository, { actorUserId: ACTOR, now: BASE });
  assert.deepEqual(recovered, { paused: 1, providerUnknown: 1, waitingAuthor: 1, committed: 1 });
  assert.equal(state.runs.get(safeId).state, 'paused');
  assert.equal(state.runs.get(providerId).state, 'provider_unknown');
  assert.equal(state.runs.get(commitId).state, 'committed');
  assert.equal(state.runs.get(unresolvedCommitId).state, 'waiting_author');
  assert.deepEqual(state.runs.get(commitId).result.commitReceipt, {
    snapshotId: 'snapshot-1', stateVersion: 12, commitId: 'commit-1', contentHash: outputHash, committed: true
  });
  assert.equal(state.events.filter(event => JSON.parse(JSON.stringify(event.payload)).recovery).length, 4);
  assert.ok(client.queries.some(query => query.statement.includes('luna.outbox o') && query.statement.includes('luna.context_snapshots cs')));
});
