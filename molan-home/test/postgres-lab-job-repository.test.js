'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPostgresLabJobMethods } = require('../lib/repositories/postgres-lab-job-methods');
const { PostgresLabJobRepository } = require('../lib/repositories/postgres-lab-job-repository');

test('PG lab adapter uses injected actor transaction, CAS and explicit email actor identity', async () => {
  const jobs = new Map();
  let transactions = 0;
  const client = { async query(sql, values) {
    const key = values?.slice(0, 3).join('|');
    if (sql.startsWith('SELECT payload, revision FROM')) return { rows: jobs.has(key) ? [jobs.get(key)] : [] };
    if (sql.startsWith('INSERT INTO luna.lab_jobs')) {
      if (jobs.has(key)) return { rows: [] };
      const row = { payload: JSON.parse(values[3]), revision: 1 };
      jobs.set(key, row); return { rows: [row] };
    }
    if (sql.startsWith('UPDATE luna.lab_jobs')) {
      const previous = jobs.get(key);
      if (!previous || previous.revision !== values[4]) return { rows: [] };
      const row = { payload: JSON.parse(values[3]), revision: previous.revision + 1 };
      jobs.set(key, row); return { rows: [row] };
    }
    throw new Error('Unexpected query');
  } };
  const methods = createPostgresLabJobMethods({ internalUuid: id => `uuid:${id}`,
    withTransaction: async (actor, fn) => { assert.equal(actor, 'real-user-id'); transactions++; return fn(client); },
    withWorkerTransaction: async fn => fn(client) });
  const repo = new PostgresLabJobRepository(methods);
  const input = { owner: 'owner@test.local', actorUserId: 'real-user-id', kind: 'reading', id: 'job-1' };
  await assert.rejects(repo.load({ ...input, actorUserId: undefined }), { code: 'ACTOR_USER_ID_REQUIRED' });
  let row = await repo.save({ ...input, job: { id: input.id, owner: input.owner, status: 'queued', votes: {} }, expectedRevision: 0 });
  assert.equal(row.revision, 1);
  await assert.rejects(repo.save({ ...input, job: row.job, expectedRevision: 0 }), { code: 'REVISION_CONFLICT' });
  row = await repo.vote({ ...input, caseId: 'case-1', vote: { winner: 'A' }, expectedRevision: 1 });
  assert.equal(row.revision, 2);
  await assert.rejects(repo.vote({ ...input, caseId: 'case-1', vote: { winner: 'B' }, expectedRevision: 2 }), { code: 'VOTE_IMMUTABLE' });
  assert.equal((await repo.load(input)).job.votes['case-1'].winner, 'A');
  assert.equal(await repo.load({ ...input, owner: 'other@test.local' }), null);
  assert.ok(transactions >= 5);
});
