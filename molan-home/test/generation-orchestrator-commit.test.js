'use strict';

const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const store = require('../lib/generation/sqlite-store');
const { createGenerationOrchestrator } = require('../lib/generation/orchestrator');
const { hashValue } = require('../lib/generation/manifest');

test('orchestrator fences the formal commit and releases its lease after persisting the receipt', async () => {
  const db = new DatabaseSync(':memory:');
  store.ensureSqliteSchema(db);
  const scope = { workspaceId: 'workspace-1', projectId: 'project-1', actorUserId: 'author-1' };
  const request = { chapterId: 'chapter_1', genre: 'fantasy', style: 'direct' };
  const text = 'The audited chapter';
  const outputHash = hashValue(text);
  const created = store.createRun(db, {
    ...scope, id: 'run-commit', chapterId: 'chapter_1', idempotencyKey: 'commit-key',
    requestHash: 'a'.repeat(64), request, now: 1700000000000
  }).run;
  const initialOwner = '11111111-1111-4111-8111-111111111111';
  const initialLease = store.acquireLease(db, { ...scope, id: created.id, leaseOwner: initialOwner, now: 1700000000001 });
  const worker = { ...scope, id: created.id, leaseOwner: initialOwner, fencingToken: initialLease.fencingToken, now: 1700000000002 };
  let run = created;
  for (const state of [
    'request_validated', 'genre_resolved', 'style_resolved', 'context_built', 'contract_validated',
    'pre_generation_guard', 'scene_planning', 'generating', 'draft_received', 'deterministic_audit',
    'semantic_audit', 'quality_audit'
  ]) run = store.updateRun(db, { ...worker, state });
  run = store.updateRun(db, {
    ...worker, state: 'waiting_author',
    result: { draft: text, outputHash }, event: { message: 'ready' }
  });
  store.releaseLease(db, worker);

  let commitRun;
  const orchestrator = createGenerationOrchestrator({
    store,
    db,
    dependencies: {
      commit: async input => {
        commitRun = input.run;
        return { committed: true, snapshotId: 'snapshot-1', stateVersion: 12, contentHash: outputHash };
      }
    }
  });
  const result = await orchestrator.commit({ ...scope, id: created.id, text, outputHash });
  const committed = store.getRun(db, { ...scope, id: created.id });
  assert.equal(result.run.state, 'committed');
  assert.equal(committed.state, 'committed');
  assert.equal(committed.result.commitReceipt.snapshotId, 'snapshot-1');
  assert.equal(commitRun.fencingToken, 2);
  assert.equal(committed.fencingToken, 2);
  assert.equal(db.prepare('SELECT lease_owner FROM generation_runs WHERE id = ?').get(created.id).lease_owner, null);
  db.close();
});
