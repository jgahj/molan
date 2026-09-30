'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonFileRepository } = require('../lib/repositories/json-file-repository');

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-json-repository-'));
  return dir;
}

async function cleanup(repo) {
  await repo.close();
  fs.rmSync(repo.directory, { recursive: true, force: true });
}

test('JSON domains preserve CAS, project isolation, immutable ledger, rollback and restart', async t => {
  const dir = directory(t);
  let repo = new JsonFileRepository(dir);
  t.after(() => cleanup(repo));
  await repo.transaction([null, 'book-a'], tx => {
    tx.put(null, 'accounts', { id: 'user-a', email: 'a@example.test' });
    tx.put('book-a', 'novels', { id: 'book-a', title: '正文' }, 0);
  });
  assert.equal(await repo.novels.get('book-b', 'book-a'), null);
  await assert.rejects(repo.novels.put('book-a', { id: 'book-a' }, 0), { code: 'REVISION_CONFLICT' });
  await assert.rejects(repo.transaction(['book-a'], tx => {
    tx.put('book-a', 'novels', { id: 'book-a', title: '错误稿' });
    throw new Error('rollback');
  }), /rollback/);
  assert.equal((await repo.novels.get('book-a', 'book-a')).title, '正文');
  await repo.ledger.put('book-a', { id: 'charge-1', costMinor: 10 });
  await assert.rejects(repo.ledger.put('book-a', { id: 'charge-1', costMinor: 0 }), { code: 'IMMUTABLE_LEDGER' });
  await repo.close();
  repo = new JsonFileRepository(dir);
  assert.equal((await repo.accounts.get(null, 'user-a')).email, 'a@example.test');
  assert.equal((await repo.novels.get('book-a', 'book-a')).revision, 1);
});

test('serial concurrent CAS permits exactly one writer and rejects another instance', async t => {
  const repo = new JsonFileRepository(directory(t));
  t.after(() => cleanup(repo));
  assert.throws(() => new JsonFileRepository(repo.directory), { code: 'REPOSITORY_LOCKED' });
  await repo.novels.put('book-a', { id: 'book-a' }, 0);
  const results = await Promise.allSettled([
    repo.novels.put('book-a', { id: 'book-a', title: 'first' }, 1),
    repo.novels.put('book-a', { id: 'book-a', title: 'second' }, 1)
  ]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.find(item => item.status === 'rejected').reason.code, 'REVISION_CONFLICT');
});

test('interrupted multi-file commit fails explicitly and completes on restart', async t => {
  const dir = directory(t);
  let fail = true;
  const io = Object.create(fs);
  io.renameSync = (from, to) => {
    if (fail && to.includes(`${path.sep}novels${path.sep}`)) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    return fs.renameSync(from, to);
  };
  const repo = new JsonFileRepository(dir, { fs: io });
  await assert.rejects(repo.transaction([null, 'book-a'], tx => {
    tx.put(null, 'accounts', { id: 'a' });
    tx.put('book-a', 'novels', { id: 'book-a' });
  }), { code: 'ENOSPC' });
  await assert.rejects(repo.accounts.list(null), { code: 'REPOSITORY_RECOVERY_REQUIRED' });
  fail = false;
  await repo.close();
  const recovered = new JsonFileRepository(dir);
  t.after(() => cleanup(recovered));
  assert.equal((await recovered.accounts.get(null, 'a')).id, 'a');
  assert.equal((await recovered.novels.get('book-a', 'book-a')).revision, 1);
  assert.equal(fs.existsSync(path.join(dir, '.commit.json')), false);
});

test('corrupt data is never loaded as an empty store', async t => {
  const dir = directory(t);
  const repo = new JsonFileRepository(dir);
  t.after(() => cleanup(repo));
  fs.writeFileSync(path.join(dir, 'accounts.json'), '{broken', 'utf8');
  await assert.rejects(repo.accounts.list(null), { code: 'REPOSITORY_CORRUPT' });
  await assert.rejects(repo.accounts.put(null, { id: 'a' }), { code: 'REPOSITORY_CORRUPT' });
});
