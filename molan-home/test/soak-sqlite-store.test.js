'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSqliteSoakStore } = require('../lib/evolution/soak-sqlite-store');

test('SQLite Soak store persists state and rejects writes from an expired fencing token', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-soak-'));
  const file = path.join(directory, 'soak.sqlite');
  const first = createSqliteSoakStore(file);
  const second = createSqliteSoakStore(file);
  t.after(() => { first.close(); second.close(); fs.rmSync(directory, { recursive: true, force: true }); });

  let staleLease;
  await first.withLease('task-1', async lease => {
    staleLease = lease;
    await first.save('task-1', { schemaVersion: 'state-v1', chapters: [1] }, lease);
  });
  assert.deepEqual(await second.load('task-1'), { schemaVersion: 'state-v1', chapters: [1] });
  await assert.rejects(() => first.save('task-1', { chapters: [1, 2] }, staleLease), /SOAK_LEASE_LOST/);
});

test('SQLite Soak store rejects a second active task lease across connections', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-soak-'));
  const file = path.join(directory, 'soak.sqlite');
  const first = createSqliteSoakStore(file);
  const second = createSqliteSoakStore(file);
  t.after(() => { first.close(); second.close(); fs.rmSync(directory, { recursive: true, force: true }); });

  await first.withLease('task-1', async () => {
    await assert.rejects(() => second.withLease('task-1', async () => {}), /SOAK_LEASE_HELD/);
  });
});
