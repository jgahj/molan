'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { createLocalRuntime } = require('./helpers/local-runtime');

const directory = createLocalRuntime();
process.env.MOLAN_STYLE_STORE = 'json';
let app = require('../server');
app.initDB();

test('HTTP JSON style save survives reopen and supplies authoritative context versions', async t => {
  const user = { email: 'style-http@example.test', name: '文风作者', role: 'normal', credits: 100, spent: 0 };
  app.saveUser(user);
  const token = crypto.randomBytes(32).toString('hex');
  app.sessions.set(app.hashSessionToken(token), { email: user.email, scope: 'client', expiresAt: Date.now() + 60000 });
  let base;
  const listen = async () => {
    await new Promise((resolve, reject) => {
      app.server.once('error', reject);
      app.server.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${app.server.address().port}`;
  };
  const close = async () => {
    app.server.closeAllConnections();
    await new Promise(resolve => app.server.close(resolve));
    await app.closeStorageStores();
  };
  t.after(async () => {
    await close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const request = async (url, body) => {
    const response = await fetch(base + url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  };
  await listen();
  const bookId = 'n_stylehttp1';
  await request('/api/novels', { id: bookId, state: { title: '文风持久化', volumes: [] } });
  const created = await request(`/api/books/${bookId}/styles`, { name: '简洁文风', hardRules: ['对白推动冲突'] });
  assert.equal(created.revision, 1);
  app.flushSessionsSync();
  await close();
  assert.equal(fs.existsSync(directory + '/style-profiles-json/.writer.lock'), false);
  delete require.cache[require.resolve('../server')];
  app = require('../server');
  app.initDB();
  app.loadSessions();
  await listen();
  const reopened = await request(`/api/books/${bookId}/styles`);
  assert.equal(reopened.styles[0].revision, 1);
  const updated = await request(`/api/books/${bookId}/styles`, {
    id: created.id, expectedRevision: 1, hardRules: ['对白推动冲突', '只写当前视角可知信息']
  });
  assert.equal(updated.revision, 2);
  const history = await request(`/api/books/${bookId}/styles/${created.id}/versions`);
  assert.deepEqual(history.versions.map(version => version.revision), [1, 2]);
  const context = await request(`/api/books/${bookId}/context/assemble`, {
    budgetTokens: 6000, styleProfiles: [{ id: 'forged-profile', revision: 99, hardRules: ['伪造规则'] }]
  });
  assert.deepEqual(context.manifest.auditPackage.inputMetadata.styleVersions, [{ id: created.id, revision: 2 }]);
  assert.deepEqual(context.manifest.writingPackage.style.hardRules, ['对白推动冲突', '只写当前视角可知信息']);
});
