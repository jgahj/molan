'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

test('native main starts, persists sessions and skills, and restarts without creating legacy files', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'molan-native-main-'));
  let child;
  let base;
  async function start() {
    child = spawn(process.execPath, [path.resolve(__dirname, '../server.js')], {
      env: { ...process.env, MOLAN_DATA_DIR: directory, MOLAN_APP_STORE: 'json', PORT: '0', HOST: '127.0.0.1', NODE_ENV: 'test' },
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    });
    await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('startup timeout: ' + output)), 10000);
      child.on('exit', code => { clearTimeout(timer); reject(new Error('startup exit ' + code + ': ' + output)); });
      child.stdout.on('data', data => {
        output += data;
        const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) { base = match[0]; clearTimeout(timer); resolve(); }
      });
      child.stderr.on('data', data => { output += data; });
    });
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill(); await exited;
  }
  async function request(method, url, body, token) {
    const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json() };
  }
  try {
    await start();
    for (const catalogPath of ['/api/genre-catalog', '/api/model-capabilities', '/api/style-catalog']) {
      const catalog = await request('GET', catalogPath);
      assert.equal(catalog.status, 200, catalogPath);
      assert.equal(catalog.data.ok, true);
    }
    assert.equal((await request('POST', '/api/genre-catalog')).status, 503);
    const registered = await request('POST', '/api/auth/register', { email: 'restart@example.test', password: 'test-password' });
    assert.equal(registered.status, 200);
    const token = registered.data.token;
    assert.equal((await request('GET', '/api/runs/missing', null, token)).status, 404);
    assert.equal((await request('GET', '/api/books/n_restart/unsupported', null, token)).status, 404);
    const capabilities = await request('GET', '/api/generation-runs/capabilities', null, token);
    assert.equal(capabilities.status, 200);
    assert.equal(capabilities.data.storageMode, 'json');
    assert.equal(capabilities.data.commit, true);
    assert.equal((await request('POST', '/api/admin/auth/login', { email: 'restart@example.test', password: 'test-password' })).status, 403);
    assert.equal((await request('POST', '/api/auth/code', { email: 'restart@example.test' })).status, 503);
    assert.equal((await request('POST', '/api/auth/login-code', { email: 'restart@example.test', code: '123456' })).status, 503);
    assert.equal((await request('POST', '/api/novels', { id: 'n_restart', state: { title: 'Restart', volumes: [] } }, token)).status, 200);
    assert.equal((await request('POST', '/api/skills/import', { name: 'Personal', instruction: 'Private instructions' }, token)).status, 200);
    const dissection = await request('POST', '/api/dissections', { id: 'd_native', requestId: 'create_native', text: '第一章 开始\n故事开始了。', title: 'Native', run: false }, token);
    assert.equal(dissection.status, 200);
    assert.equal(dissection.data.dissection.status, 'queued');
    assert.equal((await request('GET', '/api/dissections/d_native', null, token)).data.dissection.status, 'queued');
    const units = await request('GET', '/api/dissections/d_native/units', null, token);
    assert.equal(units.status, 200);
    assert.ok(units.data.items.length > 0);
    assert.equal((await request('POST', '/api/creation-books', {}, token)).status, 422);
    const creationBooks = await request('GET', '/api/creation-books?projectId=n_restart', null, token);
    assert.equal(creationBooks.status, 200);
    assert.deepEqual(creationBooks.data.books, []);
    await stop();
    assert.equal((await fs.readdir(directory)).some(name => /^(?:molan\.db|users\.json|sessions\.json)/.test(name)), false);
    await start();
    assert.equal((await request('GET', '/api/auth/me', null, token)).status, 200);
    assert.equal((await request('GET', '/api/novels/n_restart', null, token)).status, 200);
    assert.equal((await request('GET', '/api/dissections/d_native', null, token)).data.dissection.status, 'queued');
    assert.ok((await request('GET', '/api/skills', null, token)).data.some(s => s.name === 'Personal'));
  } finally { await stop(); await fs.rm(directory, { recursive: true, force: true }); }
});
