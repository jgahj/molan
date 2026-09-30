'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { JsonAppRepository } = require('../lib/repositories/json-app-repository');
const { JsonCreationRepository } = require('../lib/repositories/json-creation-repository');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

async function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-json-creation-'));
  const app = new JsonAppRepository(directory, options);
  t.after(async () => { await app.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const user = await app.saveAccount({ userId: 'owner', email: 'owner@test.local' });
  const novel = await app.create({ user, id: 'n_creation', state: { volumes: [{ chapters: [{ id: 'chapter_1',
    scenes: [{ id: 'scene_1', content: 'old' }] }] }] } });
  const repo = new JsonCreationRepository(app);
  const scope = { userId: user.userId, projectId: novel.id, workspaceId: novel.workspaceId, bookId: 'book-1' };
  await repo.create({ ...scope, payload: {}, plan: { budgetLimit: 2 } });
  const text = 'new';
  const run = { id: 'run-1', kind: 'generation-run-v1', projectId: novel.id, workspaceId: novel.workspaceId,
    actorUserId: user.userId, state: 'committing', leaseOwner: 'worker', fencingToken: 1, leaseUntil: Date.now() + 60000,
    actualCostMinor: 50, request: { creationBookId: 'book-1', novelId: novel.id, chapterId: 'chapter_1', sceneId: 'scene_1',
      storyContext: { stateVersion: 0, baseRevision: 0, baseHash: hash('old'), storyBibleVersion: 1, planHash: hash('{}') } },
    result: { draft: text, outputHash: hash(text), contract: { chapterNo: 1 }, audit: { passed: true, issues: [] },
      benchmark: { status: 'passed' }, semanticAudit: { passed: true, audit: { passed: true, issues: [],
        factLedgerDelta: { newPromises: ['truth'], newRules: [], updates: [], byEntity: {} } } },
      quality: { passed: true, qualityVector: { language: { value: 0.9, confidence: 0.9 } } } } };
  await app.repository.generation.put(novel.id, run, 0);
  const commit = { ...scope, runId: run.id, leaseOwner: 'worker', fencingToken: 1, text };
  return { app, repo, scope, run, commit };
}

test('native creation Bible CAS, ACL and chapter commit persist one atomic receipt', async t => {
  let hookCalls = 0;
  const f = await fixture(t, { onNovelChanged(tx, next) {
    hookCalls++;
    tx.put(next.id, 'memory', { id: 'chapter-memory', kind: 'test-memory', revisionSeen: next.contentRevision }, 0);
  } });
  assert.equal((await f.repo.read(f.scope)).currentStateVersion, 0);
  await assert.rejects(f.repo.read({ ...f.scope, userId: 'stranger' }), { code: 'FORBIDDEN' });
  await f.repo.saveBibleCAS({ ...f.scope, expectedVersion: 1, payload: { characters: [] } });
  await assert.rejects(f.repo.saveBibleCAS({ ...f.scope, expectedVersion: 1, payload: {} }), { code: 'REVISION_CONFLICT' });
  assert.equal((await f.repo.readBible(f.scope)).version, 2);
  await assert.rejects(f.repo.commitChapter(f.commit), { code: 'STATE_CONFLICT' });
  const refreshed = await f.app.repository.generation.get(f.scope.projectId, f.run.id);
  await f.app.repository.generation.put(f.scope.projectId, { ...refreshed, request: { ...refreshed.request,
    storyContext: { ...refreshed.request.storyContext, storyBibleVersion: 2 } } }, refreshed.revision);
  const receipt = await f.repo.commitChapter(f.commit);
  assert.equal(receipt.projectRevision, 1);
  assert.equal(receipt.spentCost, 0.5);
  assert.equal((await f.repo.snapshots(f.scope))[0].bibleVersion, 2);
  assert.equal((await f.app.read(f.scope)).state.volumes[0].chapters[0].scenes[0].content, 'new');
  assert.equal((await f.repo.read(f.scope)).currentStateVersion, 1);
  assert.equal((await f.app.repository.memory.get(f.scope.projectId, 'chapter-memory')).revisionSeen, 1);
  assert.equal((await f.repo.commitChapter(f.commit)).idempotent, true);
  assert.equal(hookCalls, 1);
  assert.equal(receipt.debtStatus.status, 'pending');
  await assert.rejects(f.repo.commitChapter({ ...f.commit, text: 'changed' }), { code: 'STATE_CONFLICT' });
});

test('native commit rejects stale lease and authoritative audit failure without partial writes', async t => {
  const f = await fixture(t);
  await assert.rejects(f.repo.commitChapter({ ...f.commit, fencingToken: 0 }), { code: 'LEASE_LOST' });
  const run = await f.app.repository.generation.get(f.scope.projectId, f.run.id);
  await f.app.repository.generation.put(f.scope.projectId, { ...run, leaseUntil: undefined }, run.revision);
  await assert.rejects(f.repo.commitChapter(f.commit), { code: 'LEASE_LOST' });
  const invalidLease = await f.app.repository.generation.get(f.scope.projectId, f.run.id);
  await f.app.repository.generation.put(f.scope.projectId, { ...run, actualCostMinor: null, costStatus: 'pending' }, invalidLease.revision);
  await assert.rejects(f.repo.commitChapter(f.commit), { code: 'PROVIDER_COST_PENDING' });
  const pendingRun = await f.app.repository.generation.get(f.scope.projectId, f.run.id);
  await f.app.repository.generation.put(f.scope.projectId, { ...run, result: { ...run.result, audit: { passed: false } } }, pendingRun.revision);
  await assert.rejects(f.repo.commitChapter({ ...f.commit, run: f.run }), { code: 'AUDIT_BLOCKED' });
  assert.equal((await f.app.read(f.scope)).revision, 0);
  assert.equal((await f.repo.snapshots(f.scope)).length, 0);
});

test('native commit rolls back novel, memory and snapshots when transaction hook fails', async t => {
  const f = await fixture(t, { onNovelChanged(tx, next) {
    tx.put(next.id, 'memory', { id: 'attempt', kind: 'test-memory' }, 0);
    throw new Error('memory unavailable');
  } });
  await assert.rejects(f.repo.commitChapter(f.commit), /memory unavailable/);
  assert.equal((await f.app.read(f.scope)).revision, 0);
  assert.equal((await f.repo.read(f.scope)).currentStateVersion, 0);
  assert.equal(await f.app.repository.memory.get(f.scope.projectId, 'attempt'), null);
  assert.equal((await f.repo.snapshots(f.scope)).length, 0);
});
