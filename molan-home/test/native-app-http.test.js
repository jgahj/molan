'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('native auth and novel HTTP persist sessions, reject stale revisions, and restore ownership', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'molan-native-http-'));
  process.env.MOLAN_DATA_DIR = directory;
  process.env.MOLAN_APP_STORE = 'json';
  const app = require('../server');
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  async function request(method, url, body, token) {
    const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json() };
  }
  try {
    const registered = await request('POST', '/api/auth/register', { email: 'native@example.com', password: 'test-password' });
    assert.equal(registered.status, 200);
    const token = registered.data.token;
    const state = { title: 'Native', volumes: [] };
    const created = await request('POST', '/api/novels', { id: 'n_native', state }, token);
    assert.equal(created.status, 200);
    assert.equal(created.data.revision, 0);
    const saved = await request('PUT', '/api/novels/n_native', { state, revision: 0 }, token);
    assert.equal(saved.status, 200);
    assert.equal(saved.data.revision, 1);
    assert.equal((await request('PUT', '/api/novels/n_native', { state, revision: 0 }, token)).status, 409);
    assert.equal((await request('GET', '/api/novels', null, token)).data.novels.length, 1);
    assert.equal((await request('DELETE', '/api/novels/n_native', null, token)).data.deleted, 1);
    assert.equal((await request('GET', '/api/novels/n_native', null, token)).status, 404);
    assert.equal((await request('POST', '/api/novels/n_native/restore', {}, token)).data.restored, true);
    const login = await request('POST', '/api/auth/login', { email: 'native@example.com', password: 'test-password' });
    assert.equal(login.status, 200);
    assert.equal((await request('GET', '/api/auth/me', null, login.data.token)).status, 200);
    assert.equal((await request('POST', '/api/auth/logout', {}, login.data.token)).status, 200);
    assert.equal((await request('GET', '/api/auth/me', null, login.data.token)).status, 401);
    await app.appRepository().close();
    const { JsonAppRepository } = require('../lib/repositories/json-app-repository');
    const reopened = new JsonAppRepository(path.join(directory, 'app-json'));
    try {
      assert.equal((await reopened.read({ userId: registered.data.user.userId, projectId: 'n_native' })).revision, 1);
      assert.equal((await reopened.listAuthSessions()).length, 1);
    } finally { await reopened.close(); }
  } finally {
    await new Promise(resolve => app.server.close(resolve));
    await app.closeStorageStores();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
