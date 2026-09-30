'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createJsonQualityLoopStore } = require('../lib/evolution/quality-loop-json-store');

test('native quality settlement persists, replays idempotently and cannot be overwritten', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-quality-native-'));
  let store = createJsonQualityLoopStore(directory);
  try {
    const input = { runId: 'run-a', idempotencyKey: 'key-a', inputHash: 'a'.repeat(64) };
    assert.equal((await store.beginRun(input)).created, true);
    assert.equal((await store.beginRun({ ...input, runId: 'run-b' })).created, false);
    await assert.rejects(store.beginRun({ ...input, inputHash: 'b'.repeat(64) }), { code: 'QUALITY_LOOP_IDEMPOTENCY_CONFLICT' });
    const settled = { runId: input.runId, inputHash: input.inputHash, report: { status: 'BLOCKED', reason: 'missing_evidence' } };
    assert.equal((await store.settleRun(settled)).idempotent, false);
    assert.equal((await store.settleRun(settled)).idempotent, true);
    await assert.rejects(store.settleRun({ ...settled, report: { status: 'ACCEPTED' } }), { code: 'QUALITY_LOOP_SETTLED_IMMUTABLE' });
    await store.close();
    store = createJsonQualityLoopStore(directory);
    const run = await store.getByIdempotencyKey(input.idempotencyKey);
    assert.equal(run.state, 'settled');
    assert.deepEqual(run.report, settled.report);
  } finally {
    await store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
