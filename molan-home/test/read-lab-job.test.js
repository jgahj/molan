'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { JsonFileRepository } = require('../lib/repositories/json-file-repository');
const { JsonLabJobRepository } = require('../lib/repositories/json-lab-job-repository');
const { readLabJob } = require('../scripts/read-lab-job.cjs');

test('lab audit reader isolates owners without acquiring locks or recovering journals', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'molan-lab-audit-'));
  const store = new JsonFileRepository(directory);
  t.after(async () => { await store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const jobs = new JsonLabJobRepository(store);
  await jobs.save({ owner: 'alice', kind: 'reading', job: { id: 'job', owner: 'alice', status: 'completed' }, expectedRevision: 0 });
  const input = { owner: 'alice', directory, env: {} };
  assert.equal((await readLabJob(input)).id, 'job');
  assert.equal(await readLabJob({ ...input, owner: 'bob' }), null);
  assert.equal(await readLabJob({ ...input, kind: 'blind' }), null);
  await assert.rejects(readLabJob({ ...input, owner: '' }), /owner/);
  const journal = path.join(directory, '.commit.json');
  await fs.writeFile(journal, '{}', 'utf8');
  await assert.rejects(readLabJob(input), /recovery/);
  assert.equal(await fs.readFile(journal, 'utf8'), '{}');
  await fs.unlink(journal);
});
