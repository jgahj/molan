import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { migrateLabJobs } from '../migrate-lab-jobs.mjs';
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');
const { JsonFileRepository } = require('../../../lib/repositories/json-file-repository');
const { JsonLabJobRepository } = require('../../../lib/repositories/json-lab-job-repository');

function fixture(context, kind) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-lab-migrate-'));
  const options = { kind, source: path.join(directory, 'legacy.db'), backup: path.join(directory, 'backup.sqlite'),
    target: path.join(directory, 'native'), report: path.join(directory, 'report.json'), apply: true };
  const database = new DatabaseSync(options.source);
  database.exec('PRAGMA journal_mode=WAL');
  const table = kind === 'reading' ? 'reading_jobs' : 'jobs';
  database.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY, owner TEXT NOT NULL, payload TEXT NOT NULL, updated INTEGER NOT NULL)`);
  if (kind === 'blind') database.exec('CREATE TABLE reference_votes(owner TEXT, scene_id TEXT, scores TEXT, updated INTEGER, PRIMARY KEY(owner,scene_id))');
  context.after(() => { database.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { options, database, table };
}

test('blind WAL snapshot imports jobs and immutable votes with exact persisted hashes', async context => {
  const f = fixture(context, 'blind');
  const vote = { winner: 'A', scores: { A: { causal: 5 } }, at: 42 };
  const job = { id: 'job-1', owner: 'author@example.test', status: 'complete', cases: [{ id: 'case-1', outputs: {} }], votes: { 'case-1': vote } };
  f.database.prepare('INSERT INTO jobs VALUES(?,?,?,?)').run(job.id, job.owner, JSON.stringify(job), 42);
  f.database.prepare('INSERT INTO reference_votes VALUES(?,?,?,?)').run(job.owner, 'scene-1', JSON.stringify({ causal: 4 }), 43);
  const report = await migrateLabJobs(f.options);
  assert.equal(report.applied, true);
  assert.equal(report.jobs, 1);
  assert.equal(report.referenceVotes, 1);
  assert.equal(report.checks.contentHash, true);
  assert.equal(report.checks.counts, true);
  assert.equal(report.sourceContentHash, report.targetContentHash);
  const repository = new JsonFileRepository(f.options.target);
  try {
    const store = new JsonLabJobRepository(repository);
    const saved = await store.load({ owner: job.owner, kind: 'blind', id: job.id });
    assert.deepEqual(saved.job, job);
    assert.deepEqual(await store.referenceVotes({ owner: job.owner }), [{ sceneId: 'scene-1', scores: { causal: 4 } }]);
    await assert.rejects(store.vote({ owner: job.owner, kind: 'blind', id: job.id, caseId: 'case-1', vote: {}, expectedRevision: saved.revision }), { code: 'VOTE_IMMUTABLE' });
    assert.equal(await store.load({ owner: 'stranger', kind: 'blind', id: job.id }), null);
  } finally { await repository.close(); }
  await assert.rejects(migrateLabJobs({ ...f.options, backup: f.options.backup + '.new', report: f.options.report + '.new' }), /already exists/);
});

test('reading dry-run backs up and checks ownership without creating a destination', async context => {
  const f = fixture(context, 'reading');
  const job = { id: 'reading-1', owner: 'reader@example.test', status: 'running', stages: { one: { text: '原文证据' } } };
  f.database.prepare('INSERT INTO reading_jobs VALUES(?,?,?,?)').run(job.id, job.owner, JSON.stringify(job), 7);
  const report = await migrateLabJobs({ ...f.options, apply: false });
  assert.equal(report.applied, false);
  assert.equal(report.jobs, 1);
  assert.equal(fs.existsSync(f.options.target), false);
  assert.equal(fs.existsSync(f.options.backup), true);
});

test('invalid owner association stops import while retaining a consistent backup', async context => {
  const f = fixture(context, 'reading');
  f.database.prepare('INSERT INTO reading_jobs VALUES(?,?,?,?)').run('reading-1', 'author', JSON.stringify({ id: 'reading-1', owner: 'intruder' }), 7);
  await assert.rejects(migrateLabJobs(f.options), /ownership mismatch/);
  assert.equal(fs.existsSync(f.options.target), false);
  assert.equal(fs.existsSync(f.options.backup), true);
});

test('explicit merge preserves other jobs and votes and rejects duplicate imports atomically', async context => {
  const blind = fixture(context, 'blind');
  const reading = fixture(context, 'reading');
  const owner = 'author@example.test';
  const blindJob = { id: 'blind-1', owner, status: 'complete', cases: [{ id: 'case-1' }], votes: { 'case-1': { winner: 'B' } } };
  blind.database.prepare('INSERT INTO jobs VALUES(?,?,?,?)').run(blindJob.id, owner, JSON.stringify(blindJob), 4);
  await migrateLabJobs(blind.options);
  const readingJob = { id: 'reading-1', owner, status: 'complete', stages: {} };
  reading.database.prepare('INSERT INTO reading_jobs VALUES(?,?,?,?)').run(readingJob.id, owner, JSON.stringify(readingJob), 5);
  const merge = { ...reading.options, target: blind.options.target, merge: true };
  assert.equal((await migrateLabJobs(merge)).checks.existingRecordsPreserved, true);
  await assert.rejects(migrateLabJobs({ ...merge, backup: merge.backup + '.again', report: merge.report + '.again' }), { code: 'REVISION_CONFLICT' });
  const repository = new JsonFileRepository(blind.options.target);
  try {
    const store = new JsonLabJobRepository(repository);
    assert.deepEqual((await store.load({ owner, kind: 'blind', id: blindJob.id })).job, blindJob);
    assert.deepEqual((await store.load({ owner, kind: 'reading', id: readingJob.id })).job, readingJob);
  } finally { await repository.close(); }
});
