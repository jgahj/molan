'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonFileRepository } = require('../lib/repositories/json-file-repository');
const { JsonLabJobRepository } = require('../lib/repositories/json-lab-job-repository');

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-native-lab-'));
  const storage = new JsonFileRepository(dir);
  t.after(async () => { await storage.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return new JsonLabJobRepository(storage);
}
function job(owner, id = 'shared-id') { return { id, owner, status: 'queued', stages: {}, votes: {}, attempts: [], callCount: 0 }; }

test('lab jobs isolate owner and kind with explicit CAS, stable JSON payload and lists', async t => {
  const repo = await fixture(t);
  assert.deepEqual(await repo.init(), { recovered: 0 });
  const created = await repo.save({ owner: 'alice', kind: 'reading', job: job('alice'), expectedRevision: 0 });
  await repo.save({ owner: 'bob', kind: 'reading', job: job('bob'), expectedRevision: 0 });
  assert.equal(created.job.id, 'shared-id');
  assert.equal((await repo.load({ owner: 'bob', kind: 'reading', id: 'shared-id' })).job.owner, 'bob');
  assert.equal(await repo.load({ owner: 'stranger', kind: 'reading', id: 'shared-id' }), null);
  assert.equal(await repo.load({ owner: 'alice', kind: 'blind', id: 'shared-id' }), null);
  assert.equal((await repo.list({ owner: 'alice', kind: 'reading' })).length, 1);
  await assert.rejects(repo.save({ owner: 'alice', kind: 'reading', job: job('bob'), expectedRevision: 0 }), { code: 'OWNER_MISMATCH' });
  await assert.rejects(repo.save({ owner: 'alice', kind: 'reading', job: job('alice') }), { code: 'VERSION_REQUIRED' });
  await assert.rejects(repo.save({ owner: 'alice', kind: 'reading', job: job('alice'), expectedRevision: 0 }), { code: 'REVISION_CONFLICT' });
});

test('author votes and reference ratings persist and cannot be overwritten', async t => {
  const repo = await fixture(t);
  let row = await repo.save({ owner: 'alice', kind: 'blind', job: job('alice'), expectedRevision: 0 });
  row = await repo.vote({ owner: 'alice', kind: 'blind', id: row.job.id, caseId: 'case-1', vote: { winner: 'A' }, expectedRevision: row.revision });
  await assert.rejects(repo.vote({ owner: 'alice', kind: 'blind', id: row.job.id, caseId: 'case-1', vote: { winner: 'B' }, expectedRevision: row.revision }), { code: 'VOTE_IMMUTABLE' });
  const preserved = await repo.save({ owner: 'alice', kind: 'blind', job: { ...row.job, votes: {} }, expectedRevision: row.revision });
  assert.equal(preserved.job.votes['case-1'].winner, 'A');
  await repo.recordReferenceVote({ owner: 'alice', sceneId: 'scene-1', scores: { language: 5 } });
  await assert.rejects(repo.recordReferenceVote({ owner: 'alice', sceneId: 'scene-1', scores: { language: 1 } }), { code: 'VOTE_IMMUTABLE' });
  assert.deepEqual(await repo.referenceVotes({ owner: 'bob' }), []);
});

test('restart recovery retains evidence and blocks unresolved provider replay', async t => {
  const repo = await fixture(t);
  await repo.save({ owner: 'alice', kind: 'reading', job: { ...job('alice'), status: 'running', callCount: 1,
    attempts: [{ stage: 'read', status: 'running' }] }, expectedRevision: 0 });
  await repo.save({ owner: 'alice', kind: 'blind', job: { ...job('alice'), status: 'running', callCount: 1,
    stages: { saved: { text: 'persisted', usage: { creditCost: 1 } } } }, expectedRevision: 0 });
  assert.deepEqual(await repo.init({ kind: 'reading' }), { recovered: 1 });
  assert.equal((await repo.load({ owner: 'alice', kind: 'blind', id: 'shared-id' })).job.status, 'running');
  assert.deepEqual(await repo.recover({ kind: 'blind' }), { recovered: 1 });
  const reading = await repo.load({ owner: 'alice', kind: 'reading', id: 'shared-id' });
  assert.equal(reading.job.status, 'needs_review');
  assert.equal(reading.job.attempts[0].status, 'provider_unknown');
  const blind = await repo.load({ owner: 'alice', kind: 'blind', id: 'shared-id' });
  assert.equal(blind.job.status, 'interrupted');
  assert.equal(blind.job.stages.saved.text, 'persisted');
  assert.deepEqual(await repo.recover(), { recovered: 0 });
});
