'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createReadingLab } = require('../lib/xuanhuan-reading');
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
  let server, reading, directory;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (reading) await reading.close();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
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
  await repo.save({ owner: other, actorUserId: other, kind: 'reading', job: { owner: other, id: 'other-job', status: 'queued', stages: {}, votes: {} }, expectedRevision: 0 });
  await repo.recoverScoped({ owner, actorUserId: owner, kind: 'reading' });
  assert.equal((await repo.load(input)).job.status, 'needs_review');
  assert.equal((await repo.load(input)).job.attempts[0].status, 'provider_unknown');
  assert.equal((await repo.load({ owner, kind: 'blind', id: 'blind-job' })).job.status, 'queued');
  assert.equal((await repo.load({ owner: other, actorUserId: other, kind: 'reading', id: 'other-job' })).job.status, 'queued');
  await repo.recoverScoped({ owner, actorUserId: owner, kind: 'reading' });
  assert.equal((await repo.load(input)).job.status, 'needs_review');
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
  const email = `${owner}@test.local`;
  const httpInput = { owner: email, actorUserId: owner, kind: 'reading', id: 'http-job' };
  await repo.save({ ...httpInput, expectedRevision: 0, job: { owner: email, id: 'http-job', status: 'running',
    stages: {}, votes: {}, attempts: [], books: [], usage: [], callCount: 0, createdAt: Date.now() } });
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-pg-reading-http-'));
  let recoverCalls = 0;
  const httpRepo = new PostgresLabJobRepository(runtime);
  const recoverScoped = httpRepo.recoverScoped.bind(httpRepo);
  httpRepo.recoverScoped = async input => { recoverCalls++; return recoverScoped(input); };
  reading = createReadingLab({ dataDir: directory, repository: httpRepo,
    getAuthUser: () => ({ user: { email, userId: owner }, token: 'test-session' }),
    json: (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); } });
  await reading.init();
  server = http.createServer((req, res) => void reading.handle(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/xuanhuan-reading/jobs`;
  const first = await fetch(url);
  assert.equal(first.status, 200);
  const firstJobs = (await first.json()).jobs;
  assert.equal(firstJobs.length, 1);
  assert.equal(firstJobs[0].id, 'http-job');
  assert.equal(firstJobs[0].status, 'interrupted');
  const initialized = await repo.load(httpInput);
  await repo.save({ ...httpInput, expectedRevision: initialized.revision, job: { ...initialized.job, status: 'running' } });
  const second = await fetch(url);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).jobs[0].status, 'running');
  assert.equal(recoverCalls, 1);
  assert.equal((await repo.load({ owner: other, actorUserId: other, kind: 'reading', id: 'other-job' })).job.status, 'queued');
  await assert.rejects(repo.recover({ kind: 'blind' }), error => error.code === '42501' || error.databaseCode === '42501');
  await new PostgresLabJobRepository(worker).recover({ kind: 'blind' });
  assert.equal((await repo.load({ owner, kind: 'blind', id: 'blind-job' })).job.status, 'interrupted');
  assert.equal((await repo.load(httpInput)).job.status, 'running');
  assert.equal((await repo.load({ owner: other, actorUserId: other, kind: 'reading', id: 'other-job' })).job.status, 'queued');
});
