'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createJsonGenerationStore } = require('../lib/generation/json-store');
const { createGenerationOrchestrator } = require('../lib/generation/orchestrator');

function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-generation-json-'));
  let store = createJsonGenerationStore(directory, options);
  t.after(async () => {
    await store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    get store() { return store; },
    reopen(nextOptions = options) {
      store = createJsonGenerationStore(directory, nextOptions);
      return store;
    }
  };
}

function runInput(overrides = {}) {
  return {
    id: 'run-1', workspaceId: 'workspace-1', projectId: 'project-1', actorUserId: 'author-1',
    chapterId: 'chapter-1', idempotencyKey: 'key-1', requestHash: 'a'.repeat(64),
    request: { projectId: 'project-1', prompt: 'private request snapshot' }, now: 1000,
    ...overrides
  };
}

test('native generation cancellation waits for asynchronous lease release', async t => {
  const { store } = fixture(t);
  const input = runInput({ id: 'cancel-native' });
  await store.createRun(input);
  let enterStage, continueStage, enterRelease, continueRelease;
  const stageEntered = new Promise(resolve => { enterStage = resolve; });
  const stageGate = new Promise(resolve => { continueStage = resolve; });
  const releaseEntered = new Promise(resolve => { enterRelease = resolve; });
  const releaseGate = new Promise(resolve => { continueRelease = resolve; });
  const adapter = { ...store, async releaseLease(...args) {
    enterRelease();
    await releaseGate;
    return store.releaseLease(...args);
  } };
  const orchestrator = createGenerationOrchestrator({ store: adapter, db: {}, dependencies: {
    resolveGenre: async () => ({ status: 'resolved', genre: 'fantasy' }),
    resolveStyle: async () => { enterStage(); await stageGate; return { status: 'resolved', style: 'direct' }; }
  } });
  let settled = false;
  const running = orchestrator.execute(input, input.id).then(result => { settled = true; return result; });
  try {
    await stageEntered;
    await orchestrator.cancel(input);
    continueStage();
    await releaseEntered;
    assert.equal(settled, false);
    continueRelease();
    assert.equal((await running).state, 'cancelled');
    const lease = await store.acquireLease({ ...input, leaseOwner: 'next-worker' });
    assert.ok(lease);
  } finally {
    continueStage();
    continueRelease();
    await running;
  }
});

test('asynchronous lease persistence failures reach the generation caller', async t => {
  const { store } = fixture(t);
  const input = runInput({ id: 'release-write-failure' });
  await store.createRun(input);
  const adapter = { ...store, async releaseLease() {
    throw Object.assign(new Error('lease write failed'), { code: 'JSON_COMMIT_FAILED' });
  } };
  const orchestrator = createGenerationOrchestrator({ store: adapter, db: {} });
  await assert.rejects(orchestrator.execute(input, input.id), { code: 'JSON_COMMIT_FAILED' });
});

async function acquire(store, input, leaseOwner = 'worker-1', now = 2000, ttlMs = 15000) {
  return store.acquireLease(null, { ...input, leaseOwner, now, ttlMs });
}

async function advance(store, scope, fencingToken, leaseOwner, states, start = 3000) {
  let now = start;
  let run;
  for (const state of states) {
    run = await store.updateRun(null, { ...scope, state, fencingToken, leaseOwner, now: now++ });
  }
  return { run, now };
}

test('JSON generation runs enforce scoped idempotency and atomically index IDs across projects', async t => {
  const fixtureState = fixture(t);
  let store = fixtureState.store;
  const input = runInput();
  const created = await store.createRun(input);
  const replay = await store.createRun(input);
  assert.equal(created.idempotent, false);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.run.id, 'run-1');

  await assert.rejects(store.createRun({ ...input, actorUserId: 'other-author' }), { code: 'IDEMPOTENCY_KEY_REUSED', status: 409 });
  await assert.rejects(store.createRun({ ...input, requestHash: 'b'.repeat(64) }), { code: 'IDEMPOTENCY_KEY_REUSED', status: 409 });
  assert.equal((await store.getRun({ ...input, actorUserId: 'other-author' })), null);
  assert.equal((await store.getRun({ ...input, projectId: 'another-project' })), null);
  assert.equal((await store.getRunById({ id: 'run-1', actorUserId: 'author-1' })).projectId, 'project-1');
  assert.equal(await store.getRunById({ id: 'run-1', actorUserId: 'other-author' }), null);
  assert.deepEqual(await store.getRunInput(input), input.request);
  assert.equal(Object.hasOwn(created.run, 'request'), false);

  const otherProject = await store.createRun({ ...input, id: 'run-2', projectId: 'project-2', idempotencyKey: 'key-2' });
  assert.equal(otherProject.run.projectId, 'project-2');
  await store.appendEvent(null, { ...input, event: { message: 'progress' }, now: 2000 });
  assert.deepEqual((await store.listEvents(null, { ...input, generationId: input.id, after: 1 })).map(event => event.sequence), [2]);

  await store.close();
  store = fixtureState.reopen();
  assert.equal((await store.getRun(input)).state, 'created');
  assert.deepEqual((await store.listEvents({ ...input, generationId: input.id, limit: 1 })).map(event => event.sequence), [1]);
});

test('stage summaries preserve retry identity, aggregate costs, and require the active fencing token', async t => {
  const { store } = fixture(t);
  const input = runInput();
  await store.createRun(null, input);
  const lease = await acquire(store, input);
  const worker = { ...input, generationId: input.id, leaseOwner: 'worker-1', fencingToken: lease.fencingToken };
  await store.recordStage(null, {
    ...worker, stage: 'writer', attemptNo: 1, status: 'running', inputHash: 'input-v1',
    reservedCostMinor: 20, actualCostMinor: 5, startedAt: 2500, now: 2600
  });
  await store.recordStage(null, {
    ...worker, stage: 'writer', attemptNo: 1, status: 'completed', inputHash: 'changed-input', outputHash: 'output-v1',
    promptTokens: 12, completionTokens: 34, reasoningTokens: 3, cachedTokens: 2,
    reservedCostMinor: 25, actualCostMinor: 10, startedAt: 2900, finishedAt: 3100, now: 3100
  });
  await store.recordStage(null, {
    ...worker, stage: 'audit', attemptNo: 1, status: 'completed', reservedCostMinor: 5,
    actualCostMinor: 2, startedAt: 3200, finishedAt: 3300, now: 3300
  });

  const stages = await store.listStages(null, { ...input, generationId: input.id });
  assert.equal(stages.length, 2);
  assert.equal(stages[0].inputHash, 'input-v1');
  assert.equal(stages[0].startedAt, 2500);
  assert.equal(stages[0].outputHash, 'output-v1');
  assert.equal(stages[0].promptTokens, 12);
  const run = await store.getRun(input);
  assert.equal(run.reservedCostMinor, 30);
  assert.equal(run.actualCostMinor, 12);

  assert.equal(await store.renewLease(null, { ...worker, now: 4000, ttlMs: 20000 }), true);
  assert.equal(await store.releaseLease(null, { ...worker, now: 5000 }), true);
  await assert.rejects(store.recordStage(null, {
    ...worker, stage: 'late', status: 'completed', startedAt: 6000, now: 6000
  }), { code: 'RUN_NOT_FOUND' });
  await store.appendEvent({ ...input, event: { message: 'after release' }, now: 7000 });
  assert.deepEqual((await store.listEvents({ ...input, generationId: input.id, after: 1, limit: 10 })).map(event => event.sequence), [2]);
});

test('pause and recovery preserve Provider boundaries and prevent stale workers from writing', async t => {
  const { store } = fixture(t);
  const input = runInput();
  await store.createRun(input);
  const firstLease = await acquire(store, input, 'worker-1', 2000);
  const safeStates = [
    'request_validated', 'genre_resolved', 'style_resolved', 'context_built',
    'contract_validated', 'pre_generation_guard', 'scene_planning'
  ];
  await advance(store, input, firstLease.fencingToken, 'worker-1', safeStates, 2100);
  const requested = await store.requestPause(null, { ...input, now: 3000 });
  assert.equal(requested.pauseRequested, true);
  const paused = await store.beginProvider(null, { ...input, leaseOwner: 'worker-1', fencingToken: firstLease.fencingToken, now: 4000 });
  assert.equal(paused.paused, true);
  assert.equal(paused.run.state, 'paused');
  assert.equal(await store.releaseLease(null, { ...input, leaseOwner: 'worker-1', fencingToken: firstLease.fencingToken, now: 5000 }), true);

  const resumed = await store.resumeRun(null, { ...input, now: 6000 });
  assert.equal(resumed.state, 'created');
  assert.equal(resumed.attemptNo, 1);
  assert.equal(resumed.fencingToken, firstLease.fencingToken + 1);
  await assert.rejects(store.beginProvider(null, {
    ...input, leaseOwner: 'worker-1', fencingToken: firstLease.fencingToken, now: 6100
  }), { code: 'STATE_CONFLICT' });

  const secondLease = await acquire(store, input, 'worker-2', 7000);
  await advance(store, input, secondLease.fencingToken, 'worker-2', safeStates, 7100);
  const started = await store.beginProvider(null, { ...input, leaseOwner: 'worker-2', fencingToken: secondLease.fencingToken, now: 8000 });
  assert.equal(started.run.state, 'generating');

  await store.createRun({ ...input, id: 'safe-unleased', idempotencyKey: 'safe-key' });
  const recovered = await store.recoverExpiredRuns({ ...input, now: 30000 });
  assert.deepEqual(recovered, { paused: 1, providerUnknown: 1, waitingAuthor: 0, committed: 0 });
  assert.equal((await store.getRun(input)).state, 'provider_unknown');
  assert.equal((await store.getRun({ ...input, id: 'safe-unleased', idempotencyKey: 'safe-key' })).state, 'paused');
  assert.equal((await store.acquireLease(null, { ...input, leaseOwner: 'worker-3', now: 31000 })).acquired, false);
  assert.equal(await store.renewLease(null, {
    ...input, leaseOwner: 'worker-2', fencingToken: secondLease.fencingToken, now: 31000
  }), false);
});

test('commit recovery requires a matching immutable receipt before marking a run committed', async t => {
  const hashes = { 'commit-ok': 'c'.repeat(64), 'commit-mismatch': 'd'.repeat(64) };
  const findCommitReceipt = async ({ run }) => ({
    snapshotId: `snapshot-${run.id}`, stateVersion: 9,
    contentHash: run.id === 'commit-ok' ? hashes['commit-ok'] : 'e'.repeat(64)
  });
  const { store } = fixture(t, { findCommitReceipt });
  const scope = runInput();
  const commitStates = [
    'request_validated', 'genre_resolved', 'style_resolved', 'context_built', 'contract_validated',
    'pre_generation_guard', 'scene_planning', 'generating', 'draft_received', 'deterministic_audit',
    'semantic_audit', 'quality_audit', 'committing'
  ];
  for (const id of Object.keys(hashes)) {
    const input = { ...scope, id, chapterId: `${id}-chapter`, idempotencyKey: id };
    await store.createRun(null, input);
    const lease = await acquire(store, input, `worker-${id}`, 2000);
    await advance(store, input, lease.fencingToken, `worker-${id}`, commitStates.slice(0, -1), 2100);
    await store.updateRun(null, {
      ...input, state: 'committing', leaseOwner: `worker-${id}`, fencingToken: lease.fencingToken,
      result: { outputHash: hashes[id] }, now: 2200
    });
    await store.releaseLease(null, { ...input, leaseOwner: `worker-${id}`, fencingToken: lease.fencingToken, now: 2300 });
  }

  const recovered = await store.recoverExpiredRuns(null, { ...scope, now: 30000 });
  assert.deepEqual(recovered, { paused: 0, providerUnknown: 0, waitingAuthor: 1, committed: 1 });
  const committed = await store.getRun({ ...scope, id: 'commit-ok' });
  assert.equal(committed.state, 'committed');
  assert.equal(committed.result.commitReceipt.snapshotId, 'snapshot-commit-ok');
  assert.equal(committed.result.commitReceipt.contentHash, hashes['commit-ok']);
  assert.equal((await store.getRun({ ...scope, id: 'commit-mismatch' })).state, 'waiting_author');
});
