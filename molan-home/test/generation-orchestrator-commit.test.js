'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createJsonGenerationStore } = require('../lib/generation/json-store');
const { JsonFileRepository } = require('../lib/repositories/json-file-repository');
const { createGenerationOrchestrator } = require('../lib/generation/orchestrator');
const { hashValue } = require('../lib/generation/manifest');

test('orchestrator fences the formal commit and releases its lease after persisting the receipt', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-commit-json-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  t.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const scope = { workspaceId: 'workspace-1', projectId: 'project-1', actorUserId: 'author-1' };
  const request = { chapterId: 'chapter_1', genre: 'fantasy', style: 'direct' };
  const text = 'The audited chapter';
  const outputHash = hashValue(text);
  const created = (await store.createRun({
    ...scope, id: 'run-commit', chapterId: 'chapter_1', idempotencyKey: 'commit-key',
    requestHash: 'a'.repeat(64), request, now: 1700000000000
  })).run;
  const initialOwner = '11111111-1111-4111-8111-111111111111';
  const initialLease = await store.acquireLease({ ...scope, id: created.id, leaseOwner: initialOwner, now: 1700000000001 });
  const worker = { ...scope, id: created.id, leaseOwner: initialOwner, fencingToken: initialLease.fencingToken, now: 1700000000002 };
  let run = created;
  for (const state of [
    'request_validated', 'genre_resolved', 'style_resolved', 'context_built', 'contract_validated',
    'pre_generation_guard', 'scene_planning', 'generating', 'draft_received', 'deterministic_audit',
    'semantic_audit', 'quality_audit'
  ]) run = await store.updateRun({ ...worker, state });
  run = await store.updateRun({
    ...worker, state: 'waiting_author',
    result: { draft: text, outputHash }, event: { message: 'ready' }
  });
  await store.releaseLease(worker);

  let commitRun;
  const orchestrator = createGenerationOrchestrator({
    store,
    db: {},
    dependencies: {
      commit: async input => {
        commitRun = input.run;
        return { committed: true, snapshotId: 'snapshot-1', stateVersion: 12, contentHash: outputHash };
      }
    }
  });
  const result = await orchestrator.commit({ ...scope, id: created.id, text, outputHash });
  const committed = await store.getRun({ ...scope, id: created.id });
  assert.equal(result.run.state, 'committed');
  assert.equal(committed.state, 'committed');
  assert.equal(committed.result.commitReceipt.snapshotId, 'snapshot-1');
  assert.equal(commitRun.fencingToken, 2);
  assert.equal(committed.fencingToken, 2);
  const persisted = await repository.generation.get(scope.projectId, created.id);
  assert.equal(persisted.leaseOwner, '');
  assert.equal(persisted.leaseUntil, null);
});
