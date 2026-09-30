'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonFileRepository } = require('../lib/repositories/json-file-repository');
const { JsonDissectionRepository } = require('../lib/repositories/json-dissection-repository');
const helpers = require('../services/dissection-input-service').createDissectionInputService({ crypto: require('node:crypto'), DISSECTION_CHUNK_CHARS: 12000, DISSECTION_MAX_UNITS: 100, DISSECTION_NOISE_ANCHORED: /$a/, DISSECTION_NOISE_ANYWHERE: /$a/ });
const resultHelpers = { normalizeDissectionStageResult: value => value, mergeDissectionResult: (a, b) => ({ ...a, ...b }), dissectionStageMissingFields: () => [] };
async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-dissection-native-'));
  const repository = new JsonFileRepository(directory);
  t.after(async () => { await repository.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const account = await repository.accounts.put(null, { id: 'account:alice', kind: 'account', userId: 'alice', email: 'alice@example.test', role: 'user' }, 0);
  await repository.accounts.put(null, { id: 'account:bob', kind: 'account', userId: 'bob', email: 'bob@example.test', role: 'user' }, 0);
  const repo = new JsonDissectionRepository(repository, { inputService: helpers, resultService: resultHelpers, phases: ['overview'] });
  return { repository, repo, account };
}
test('job creation is idempotent, ACL scoped and unit list paginates', async t => {
  const { repo } = await fixture(t);
  const input = { actorUserId: 'alice', requestId: 'create-1', title: 'Test', sourceText: '正文' };
  const first = await repo.create(input); const retry = await repo.create(input);
  assert.equal(first.id, retry.id); assert.equal((await repo.list({ actorUserId: 'alice' })).length, 1);
  assert.equal((await repo.listUnits({ actorUserId: 'alice', jobId: first.id, limit: 1 })).items.length, 1);
  await assert.rejects(repo.get({ actorUserId: 'bob', jobId: first.id }), { code: 'FORBIDDEN' });
});
test('lease fence rejects stale workers and cost ledger is immutable/idempotent', async t => {
  const { repo } = await fixture(t);
  const job = await repo.create({ actorUserId: 'alice', requestId: 'create-2', sourceText: '正文' });
  const lease = await repo.acquireLease({ actorUserId: 'alice', jobId: job.id, workerId: 'worker', leaseMs: 1000 });
  await assert.rejects(repo.recordCost({ actorUserId: 'alice', jobId: job.id, leaseToken: 'bad', fence: lease.fence, requestId: 'cost', model: 'stub', usage: { prompt_tokens: 1, completion_tokens: 1 }, amount: 1, currency: 'USD' }), { code: 'LEASE_FENCE_REJECTED' });
  const cost = { actorUserId: 'alice', jobId: job.id, ...lease, requestId: 'cost', model: 'stub', usage: { prompt_tokens: 1, completion_tokens: 1 }, amount: 1, currency: 'USD' };
  await repo.recordCost(cost); assert.deepEqual(await repo.recordCost(cost), await repo.recordCost(cost));
  await assert.rejects(repo.recordCost({ ...cost, amount: 2 }), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(repo.cancel({ actorUserId: 'alice', jobId: job.id, expectedRevision: job.revision }), { code: 'REVISION_CONFLICT' });
  const current = await repo.get({ actorUserId: 'alice', jobId: job.id });
  await repo.cancel({ actorUserId: 'alice', jobId: job.id, expectedRevision: current.revision });
  await assert.rejects(repo.recordCost(cost), { code: 'LEASE_FENCE_REJECTED' });
});
test('stage writes require lease and completion records immutable result', async t => {
  const { repo } = await fixture(t);
  const job = await repo.create({ actorUserId: 'alice', requestId: 'create-3', sourceText: '正文' });
  const lease = await repo.acquireLease({ actorUserId: 'alice', jobId: job.id, workerId: 'worker', leaseMs: 1000 });
  const saved = await repo.appendStageRun({ actorUserId: 'alice', jobId: job.id, ...lease, requestId: 'stage-1', stageId: 'overview', result: { overview: { ok: true } }, expectedRevision: lease.revision });
  assert.equal(saved.result.overview.ok, true);
  const completed = await repo.complete({ actorUserId: 'alice', jobId: job.id, ...lease, expectedRevision: saved.revision });
  assert.equal(completed.status, 'completed');
});
test('project ACL and expired lease recovery prevent superseded worker writes', async t => {
  const { repository } = await fixture(t);
  await repository.novels.put('n_project', { id: 'n_project', kind: 'novel', ownerUserId: 'alice', status: 'active', workspaceId: 'ws_one', aclRevision: 1,
    members: { alice: { role: 'owner', active: true, canSpend: true }, bob: { role: 'viewer', active: true } } }, 0);
  let now = 100;
  const repo = new JsonDissectionRepository(repository, { inputService: helpers, resultService: resultHelpers, phases: ['overview'], now: () => now });
  const job = await repo.create({ actorUserId: 'alice', projectId: 'n_project', requestId: 'project-job', sourceText: '正文' });
  assert.equal((await repo.get({ actorUserId: 'bob', jobId: job.id })).id, job.id);
  await assert.rejects(repo.acquireLease({ actorUserId: 'bob', jobId: job.id, workerId: 'bad', leaseMs: 50 }), { code: 'FORBIDDEN' });
  const first = await repo.acquireLease({ actorUserId: 'alice', jobId: job.id, workerId: 'one', leaseMs: 50 });
  now = 151;
  assert.deepEqual(await repo.recoverExpiredLeases({ actorUserId: 'alice' }), { recovered: 1 });
  const next = await repo.acquireLease({ actorUserId: 'alice', jobId: job.id, workerId: 'two', leaseMs: 50 });
  assert.equal(next.fence, first.fence + 1);
  const current = await repo.get({ actorUserId: 'alice', jobId: job.id });
  await assert.rejects(repo.appendStageRun({ actorUserId: 'alice', jobId: job.id, ...first, requestId: 'stale', stageId: 'overview', result: { overview: {} }, expectedRevision: current.revision }), { code: 'LEASE_FENCE_REJECTED' });
  await assert.rejects(repo.update({ actorUserId: 'alice', jobId: job.id, patch: { ownerUserId: 'bob' }, expectedRevision: current.revision }), { code: 'INVALID_DISSECTION_PATCH' });
});
