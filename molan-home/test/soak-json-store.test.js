'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createJsonSoakStore } = require('../lib/evolution/soak-json-store');

test('native Soak saves across restart and rejects stale fencing and a concurrent lease', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-soak-json-'));
  let store = createJsonSoakStore(dir);
  try {
    let oldLease;
    await store.withLease('task-a', async lease => {
      oldLease = lease;
      await store.save('task-a', { chapter: 1 }, lease);
      await assert.rejects(store.withLease('task-a', async () => {}), { code: 'SOAK_LEASE_HELD' });
    });
    await store.withLease('task-a', async lease => {
      await assert.rejects(store.save('task-a', { chapter: 0 }, oldLease), { code: 'SOAK_LEASE_LOST' });
      assert.equal(Number(lease.fencingToken), Number(oldLease.fencingToken) + 1);
      await store.save('task-a', { chapter: 2 }, lease);
    });
    await store.close();
    store = createJsonSoakStore(dir);
    assert.deepEqual(await store.load('task-a'), { chapter: 2 });
  } finally {
    await store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
