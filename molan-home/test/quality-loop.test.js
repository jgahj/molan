'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createJsonQualityLoopStore } = require('../lib/evolution/quality-loop-json-store');
const { buildGoldenSuite } = require('../lib/evolution/golden-suite');
const { runQualityLoop } = require('../lib/evolution/quality-loop');
const { DEFAULT_POLICY: REGRESSION_POLICY } = require('../lib/evolution/regression-gate');

function fixtureCorpus() {
  const suite = buildGoldenSuite();
  const tasks = suite.tasks;
  return {
    tasks,
    manifest: {
      manifestVersion: 1,
      taskCount: tasks.length,
      genres: suite.genres,
      tasksPerGenre: suite.tasksPerGenre,
      fixtureStatus: suite.fixtureStatus,
      dataStatus: suite.dataStatus,
      taskRecordsIncluded: true,
      replaySnapshotsIncluded: true,
      promotionEligible: false
    }
  };
}

function storeFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-quality-loop-'));
  const store = createJsonQualityLoopStore(directory);
  t.after(async () => {
    await store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return store;
}

function runnerFixture(counters = {}) {
  counters.baseline = 0;
  counters.candidate = 0;
  counters.shadow = 0;
  counters.evaluation = 0;
  const categories = Object.fromEntries(REGRESSION_POLICY.categories.map(category => [category, {
    status: 'PASS', evidence_refs: [`regression:${category}`]
  }]));
  return {
    runArm: async request => {
      counters[request.arm] += 1;
      assert.equal(request.mode, 'experiment');
      assert.equal(Object.isFrozen(request.replayManifest), true);
      const isCandidate = request.arm === 'candidate';
      return {
        replayManifestHash: request.replayManifestHash,
        text: `${request.arm} output for ${request.taskId}`,
        metrics: {
          dialogue: isCandidate ? 0.56 : 0.5,
          continuity: 0.95,
          genreFit: 90,
          styleFit: 88,
          originality: 80,
          stability: 0.99,
          aiFlavor: 20,
          cost: 1,
          subtext: 0.62,
          characterVoice: 0.78,
          latency: 1000
        },
        evidence_refs: [`audit:${request.arm}:${request.taskId}`],
        blocker_check: { status: 'PASS', evidence_ref: `blockers:${request.taskId}` },
        category_results: categories,
        defects: []
      };
    },
    generateShadow: async request => {
      counters.shadow += 1;
      assert.equal(request.mode, 'shadow');
      assert.equal(request.billableToUser, false);
      assert.equal(request.replayManifestHash, request.replayManifest.manifestHash);
      assert.equal(Object.hasOwn(request, 'billing'), false);
      return {
        text: `PRIVATE_SHADOW_TEXT_${request.taskId}`,
        cost: 0.1,
        replayManifestHash: request.replayManifestHash
      };
    },
    evaluateShadow: async request => {
      counters.evaluation += 1;
      assert.equal(request.mode, 'shadow');
      assert.equal(request.replayManifestHash, request.replayManifest.manifestHash);
      assert.match(request.candidateText, /^PRIVATE_SHADOW_TEXT_/);
      return {
        metrics: { quality: 0.82, style: 0.8, continuity: 0.95 },
        evidence_refs: [`shadow-evidence:${request.taskId}`]
      };
    }
  };
}

function loopInput({ store, manifest, tasks, runner, idempotencyKey = 'quality-loop-test' }) {
  return {
    store,
    idempotencyKey,
    runId: 'quality-loop-run-test',
    goldenManifest: manifest,
    tasks,
    baseline: { pipelineVersion: 'baseline-pipe', promptVersion: 'baseline-prompt' },
    candidate: { pipelineVersion: 'candidate-pipe', promptVersion: 'candidate-prompt', shadowPrompt: 'candidate only' },
    targetMetric: 'dialogue',
    runner
  };
}

test('test fixtures complete paired replay, shadow evaluation, and gates without becoming promotable', async t => {
  const store = storeFixture(t);
  const { manifest, tasks } = fixtureCorpus();
  const counters = {};
  const runner = runnerFixture(counters);
  const input = loopInput({ store, manifest, tasks, runner });

  const report = await runQualityLoop(input);

  assert.equal(report.status, 'TEST_ONLY');
  assert.equal(report.decision_status, 'ACCEPTED');
  assert.equal(report.accepted, false);
  assert.equal(report.promotion_eligible, false);
  assert.equal(report.corpus_status, 'test_fixture');
  assert.equal(report.paired_task_count, 80);
  assert.equal(counters.baseline, 80);
  assert.equal(counters.candidate, 80);
  assert.equal(counters.shadow, 80);
  assert.equal(counters.evaluation, 80);
  assert.equal(report.shadow_runs.length, 80);
  assert.ok(report.shadow_runs.every(shadow => shadow.status === 'completed' &&
    shadow.user_visible === false && shadow.user_billing_mutation === 'none' && shadow.state_mutation === 'none'));
  assert.equal(JSON.stringify(report).includes('PRIVATE_SHADOW_TEXT_'), false);
  assert.ok(Object.values(report.replay_manifest_hashes).every(hash => /^[a-f0-9]{64}$/.test(hash)));

  const replay = await runQualityLoop(input);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.status, 'TEST_ONLY');
  assert.equal(counters.baseline, 80);
  assert.equal(counters.candidate, 80);
  assert.equal(counters.shadow, 80);

  const saved = await store.getByIdempotencyKey('quality-loop-test');
  assert.equal(saved.state, 'settled');
  assert.equal(saved.report.status, 'TEST_ONLY');
  await assert.rejects(store.settleRun({
    runId: saved.runId,
    inputHash: saved.inputHash,
    report: { status: 'ACCEPTED' }
  }), error => error.code === 'QUALITY_LOOP_SETTLED_IMMUTABLE');
});

test('metadata-only golden manifest settles blocked before invoking any runner method', async t => {
  const store = storeFixture(t);
  let calls = 0;
  const report = await runQualityLoop(loopInput({
    store,
    manifest: { manifestVersion: 1, taskCount: 80, genres: ['玄幻'], tasksPerGenre: 80, fixtureStatus: 'metadata_only' },
    tasks: undefined,
    runner: {
      runArm: async () => { calls += 1; throw new Error('runner must not run'); },
      generateShadow: async () => { calls += 1; throw new Error('runner must not run'); },
      evaluateShadow: async () => { calls += 1; throw new Error('runner must not run'); }
    }
  }));

  assert.equal(report.status, 'BLOCKED');
  assert.equal(report.reason, 'golden_corpus_metadata_only');
  assert.equal(calls, 0);
  assert.equal((await store.getByIdempotencyKey('quality-loop-test')).state, 'settled');
});

test('a 79-task corpus cannot enter the runner', async t => {
  const store = storeFixture(t);
  const { manifest, tasks } = fixtureCorpus();
  let calls = 0;
  const report = await runQualityLoop(loopInput({
    store,
    manifest,
    tasks: tasks.slice(0, 79),
    runner: {
      runArm: async () => { calls += 1; throw new Error('runner must not run'); },
      generateShadow: async () => { calls += 1; throw new Error('runner must not run'); },
      evaluateShadow: async () => { calls += 1; throw new Error('runner must not run'); }
    }
  }));

  assert.equal(report.status, 'BLOCKED');
  assert.equal(report.reason, 'insufficient_golden_tasks');
  assert.equal(report.actual_task_count, 79);
  assert.equal(report.required_pair_count, 80);
  assert.equal(calls, 0);
});

test('runner errors settle with the active stage instead of leaking a ReferenceError', async t => {
  const store = storeFixture(t);
  const { manifest, tasks } = fixtureCorpus();
  const report = await runQualityLoop(loopInput({
    store,
    manifest,
    tasks,
    runner: {
      runArm: async () => { throw Object.assign(new Error('upstream failed'), { code: 'UPSTREAM_FAILED' }); },
      generateShadow: async () => '',
      evaluateShadow: async () => ({})
    }
  }));

  assert.equal(report.status, 'BLOCKED');
  assert.equal(report.reason, 'quality_loop_stage_failed');
  assert.equal(report.stage, 'baseline');
  assert.equal(report.error_code, 'UPSTREAM_FAILED');
});

test('JSON settlements survive reopening the store and remain immutable', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-quality-loop-'));
  let store = createJsonQualityLoopStore(directory);
  t.after(async () => {
    await store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const inputHash = 'a'.repeat(64);
  await store.beginRun({ runId: 'durable-run', idempotencyKey: 'durable-key', inputHash, createdAt: 1 });
  await store.settleRun({
    runId: 'durable-run', inputHash,
    report: { schemaVersion: 'quality-loop-run-v1', status: 'TEST_ONLY' }, settledAt: 2
  });

  await store.close();
  store = createJsonQualityLoopStore(directory);
  const saved = await store.getByIdempotencyKey('durable-key');
  assert.equal(saved.state, 'settled');
  assert.equal(saved.report.status, 'TEST_ONLY');
  assert.equal((await store.beginRun({ runId: 'duplicate-run', idempotencyKey: 'durable-key', inputHash })).created, false);
  await assert.rejects(store.settleRun({
    runId: 'durable-run', inputHash,
    report: { schemaVersion: 'quality-loop-run-v1', status: 'ACCEPTED' }
  }), error => error.code === 'QUALITY_LOOP_SETTLED_IMMUTABLE');
});
