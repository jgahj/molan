'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { createPostgresRepository, internalUuid, readConfig } = require('../lib/postgres-repository');
const { PostgresLabJobRepository } = require('../lib/repositories/postgres-lab-job-repository');

test('live PG lab transactions enforce RLS, CAS, immutable votes and scoped recovery', {
  skip: process.env.MOLAN_LAB_PG_LIVE_TEST !== '1'
}, async t => {
  const adminFile = process.env.MOLAN_LAB_PG_ADMIN_PASSWORD_FILE;
  const admin = new Pool({ ...readConfig(process.env).config, user: 'postgres', password: fs.readFileSync(adminFile, 'utf8').trim() });
  const runtime = createPostgresRepository({ env: process.env });
  const worker = createPostgresRepository({ env: { ...process.env, MOLAN_PG_USER: 'novel_worker_runtime',
    MOLAN_PG_PASSWORD_FILE: process.env.MOLAN_LAB_PG_WORKER_PASSWORD_FILE } });
  const repo = new PostgresLabJobRepository(runtime);
  const owner = `lab-test-${crypto.randomUUID()}`;
  const other = `lab-test-${crypto.randomUUID()}`;
  const ownerId = internalUuid(owner), otherId = internalUuid(other);
  t.after(async () => {
    await runtime.close(); await worker.close();
    await admin.query('DELETE FROM luna.lab_reference_votes WHERE owner_id=ANY($1::uuid[])', [[ownerId, otherId]]);
    await admin.query('DELETE FROM luna.lab_jobs WHERE owner_id=ANY($1::uuid[])', [[ownerId, otherId]]);
    await admin.query('DELETE FROM luna.users WHERE id=ANY($1::uuid[])', [[ownerId, otherId]]);
    await admin.end();
  });
  await admin.query('INSERT INTO luna.users(id,legacy_id) VALUES($1,$2),($3,$4)', [ownerId, owner, otherId, other]);
  const input = { owner, kind: 'reading', id: 'same-job' };
  let row = await repo.save({ ...input, job: { owner, id: input.id, status: 'running', stages: {}, callCount: 1,
    attempts: [{ status: 'running', stage: 'read' }], votes: {} }, expectedRevision: 0 });
  await assert.rejects(repo.save({ ...input, job: row.job, expectedRevision: 0 }), { code: 'REVISION_CONFLICT' });
  assert.equal(await repo.load({ ...input, owner: other }), null);
  row = await repo.vote({ ...input, caseId: 'case-1', vote: { winner: 'A' }, expectedRevision: row.revision });
  await assert.rejects(repo.vote({ ...input, caseId: 'case-1', vote: { winner: 'B' }, expectedRevision: row.revision }), { code: 'VOTE_IMMUTABLE' });
  await repo.recordReferenceVote({ owner, sceneId: 'scene-1', scores: { language: 5 } });
  await assert.rejects(repo.recordReferenceVote({ owner, sceneId: 'scene-1', scores: { language: 1 } }), { code: 'VOTE_IMMUTABLE' });
  assert.deepEqual(await repo.referenceVotes({ owner: other }), []);
  await repo.save({ owner, kind: 'blind', job: { owner, id: 'blind-job', status: 'queued', stages: {}, votes: {} }, expectedRevision: 0 });
  await new PostgresLabJobRepository(worker).recover({ kind: 'reading' });
  assert.equal((await repo.load(input)).job.status, 'needs_review');
  assert.equal((await repo.load(input)).job.attempts[0].status, 'provider_unknown');
  assert.equal((await repo.load({ owner, kind: 'blind', id: 'blind-job' })).job.status, 'queued');
  assert.equal((await repo.list({ owner, kind: 'reading' })).length, 1);
  const raw = new Pool(readConfig(process.env).config);
  const client = await raw.connect();
  try {
    await client.query('SET ROLE novel_app'); await client.query('BEGIN');
    await client.query("SELECT set_config('app.user_id',$1,true)", [otherId]);
    assert.equal((await client.query('SELECT * FROM luna.lab_jobs WHERE owner_id=$1', [ownerId])).rows.length, 0);
    await assert.rejects(client.query(`INSERT INTO luna.lab_jobs(owner_id,owner_legacy_id,job_kind,job_id,payload)
      VALUES($1,$2,'reading','forged',$3::jsonb)`, [ownerId, owner, JSON.stringify({ owner, id: 'forged' })]), error => error.code === '42501');
    await client.query('ROLLBACK');
  } finally { client.release(); await raw.end(); }
});
