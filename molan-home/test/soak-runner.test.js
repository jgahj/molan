'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReplayManifest } = require('../lib/evolution/replay-manifest');
const { runSoakTask, contentHash } = require('../lib/evolution/soak-runner');
const { SOAK_CHECKPOINT_METRICS } = require('../lib/evolution/soak-test');

const replayManifest = buildReplayManifest({
  sourceGenerationId: 'soak-source', pipelineVersion: 'pipe-1', promptVersion: 'writer-1',
  genreProfileVersion: 'genre-1', styleVersion: 'style-1', model: 'test-model', parameters: { temperature: 0.7 },
  artifacts: {
    bible: { ref: 'bible:1', snapshot: { id: 'bible' } },
    outline: { ref: 'outline:1', snapshot: { id: 'outline' } },
    chapterContract: { ref: 'contract:1', snapshot: { id: 'contract' } },
    contextSnapshot: { ref: 'context:1', snapshot: { id: 'context' } }
  }
});

function makeStore() {
  const states = new Map();
  let nextToken = 0;
  const active = new Set();
  return {
    async load(taskId) { return states.has(taskId) ? structuredClone(states.get(taskId)) : null; },
    async save(taskId, state, { fencingToken }) {
      assert.ok(Number(fencingToken) <= nextToken);
      states.set(taskId, structuredClone(state));
    },
    async withLease(taskId, work) {
      if (active.has(taskId)) throw new Error('lease already held');
      active.add(taskId);
      try { return await work({ fencingToken: String(++nextToken) }); }
      finally { active.delete(taskId); }
    },
    inspect(taskId) { return states.get(taskId); }
  };
}

function generatedChapter(chapterIndex) {
  const text = `chapter-${chapterIndex}`;
  return { status: 'completed', text, output_hash: contentHash(text), evidence_ref: `run:${chapterIndex}` };
}

function passingAudit({ chapterIndex }) {
  return { passed: true, status: 'passed', evidence_ref: `audit:${chapterIndex}` };
}

function measuredCheckpoint({ chapterIndex }) {
  return {
    evidence_ref: `checkpoint:${chapterIndex}`,
    metrics: Object.fromEntries(SOAK_CHECKPOINT_METRICS.map(metric => [metric, 0]))
  };
}

test('soak runner executes fixed-manifest chapters serially and checkpoints every ten chapters', async () => {
  const store = makeStore();
  const calls = [];
  const report = await runSoakTask({
    taskId: 'soak-10', replayManifest, milestone: 10, store,
    async generateChapter(input) { calls.push(['generate', input.chapterIndex, input.idempotencyKey]); return generatedChapter(input.chapterIndex); },
    async auditChapter(input) { calls.push(['audit', input.chapterIndex, input.textHash]); return passingAudit(input); },
    async measureCheckpoint(input) { calls.push(['checkpoint', input.chapterIndex]); return measuredCheckpoint(input); }
  });

  assert.equal(report.status, 'PASS');
  assert.equal(report.execution_status, 'completed');
  assert.deepEqual(calls.filter(call => call[0] === 'generate').map(call => call[1]), Array.from({ length: 10 }, (_, index) => index + 1));
  assert.deepEqual(calls.filter(call => call[0] === 'checkpoint').map(call => call[1]), [10]);
});

test('provider unknown is reconciled before resume and never blindly generated twice', async () => {
  const store = makeStore();
  let chapterTwoCalls = 0;
  const common = {
    taskId: 'soak-unknown', replayManifest, milestone: 3, store,
    generateChapter: async ({ chapterIndex }) => {
      if (chapterIndex === 2) { chapterTwoCalls += 1; const error = new Error('unknown'); error.code = 'PROVIDER_UNKNOWN'; throw error; }
      return generatedChapter(chapterIndex);
    },
    auditChapter: async input => passingAudit(input)
  };

  const interrupted = await runSoakTask(common);
  assert.equal(interrupted.execution_status, 'provider_unknown');
  const held = await runSoakTask(common);
  assert.equal(held.execution_status, 'provider_unknown');
  assert.equal(chapterTwoCalls, 1);

  const resumed = await runSoakTask({
    ...common,
    recoverUnknown: async ({ chapterIndex, idempotencyKey }) => {
      assert.equal(chapterIndex, 2);
      assert.equal(idempotencyKey, 'soak-unknown:chapter:2');
      return { resolved: true, chapter: generatedChapter(chapterIndex) };
    }
  });
  assert.equal(resumed.status, 'PASS');
  assert.equal(resumed.execution_status, 'completed');
  assert.equal(chapterTwoCalls, 1);
});

test('a persisted generated chapter resumes at audit without calling the generator again', async () => {
  const store = makeStore();
  let generationCalls = 0;
  let auditCalls = 0;
  const common = {
    taskId: 'soak-pending-audit', replayManifest, milestone: 3, store,
    async generateChapter({ chapterIndex }) { generationCalls += 1; return generatedChapter(chapterIndex); },
    async auditChapter(input) {
      auditCalls += 1;
      if (auditCalls === 1) throw new Error('audit temporarily unavailable');
      return passingAudit(input);
    }
  };

  const interrupted = await runSoakTask(common);
  assert.equal(interrupted.execution_status, 'interrupted');
  assert.equal(store.inspect('soak-pending-audit').pending_chapter.chapter_index, 1);

  const resumed = await runSoakTask(common);
  assert.equal(resumed.status, 'PASS');
  assert.equal(generationCalls, 3);
});

test('pause persists completed chapters and resume continues at the next chapter', async () => {
  const store = makeStore();
  const controller = new AbortController();
  const generated = [];
  const common = {
    taskId: 'soak-pause', replayManifest, milestone: 3, store,
    async generateChapter({ chapterIndex }) { generated.push(chapterIndex); return generatedChapter(chapterIndex); },
    async auditChapter(input) { return passingAudit(input); }
  };

  const paused = await runSoakTask({
    ...common,
    signal: controller.signal,
    onProgress({ chapterIndex }) { if (chapterIndex === 1) controller.abort(); }
  });
  assert.equal(paused.execution_status, 'paused');
  assert.equal(store.inspect('soak-pause').chapters.length, 1);

  const resumed = await runSoakTask(common);
  assert.equal(resumed.status, 'PASS');
  assert.deepEqual(generated, [1, 2, 3]);
});

test('soak state cannot be resumed against a changed Replay Manifest', async () => {
  const store = makeStore();
  await runSoakTask({
    taskId: 'soak-hash', replayManifest, milestone: 3, store,
    generateChapter: async ({ chapterIndex }) => generatedChapter(chapterIndex),
    auditChapter: async input => passingAudit(input)
  });
  const changedManifest = buildReplayManifest({
    sourceGenerationId: 'soak-source', pipelineVersion: 'pipe-2', promptVersion: 'writer-1',
    genreProfileVersion: 'genre-1', styleVersion: 'style-1', model: 'test-model', parameters: { temperature: 0.7 },
    artifacts: {
      bible: { ref: 'bible:1', snapshot: { id: 'bible' } },
      outline: { ref: 'outline:1', snapshot: { id: 'outline' } },
      chapterContract: { ref: 'contract:1', snapshot: { id: 'contract' } },
      contextSnapshot: { ref: 'context:1', snapshot: { id: 'context' } }
    }
  });
  await assert.rejects(() => runSoakTask({
    taskId: 'soak-hash', replayManifest: changedManifest, milestone: 3, store,
    generateChapter: async ({ chapterIndex }) => generatedChapter(chapterIndex),
    auditChapter: async input => passingAudit(input)
  }), /Replay Manifest 不一致/);
});
