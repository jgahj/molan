'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const test = require('node:test');
const { createLocalRuntime } = require('./helpers/local-runtime');

const dataDirectory = createLocalRuntime();
const app = require('../server');
app.initDB();

test('novel create/save CAS/delete/restore preserve HTTP permissions and revisions', async t => {
  const owner = { email: 'novel-write-owner@example.test', name: '小说作者', role: 'normal', level: 'normal', plan: 'normal', credits: 100, spent: 0 };
  const editor = { email: 'novel-write-editor@example.test', name: '协作者', role: 'normal', level: 'normal', plan: 'normal', credits: 100, spent: 0 };
  app.saveUser(owner);
  app.saveUser(editor);
  const ownerToken = crypto.randomBytes(32).toString('hex');
  const editorToken = crypto.randomBytes(32).toString('hex');
  app.sessions.set(app.hashSessionToken(ownerToken), { email: owner.email, scope: 'client', expiresAt: Date.now() + 60000 });
  app.sessions.set(app.hashSessionToken(editorToken), { email: editor.email, scope: 'client', expiresAt: Date.now() + 60000 });
  const port = await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', () => resolve(app.server.address().port));
  });
  const base = `http://127.0.0.1:${port}`;
  const request = (pathname, token, options = {}) => fetch(base + pathname, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });

  t.after(async () => {
    app.sessions.delete(app.hashSessionToken(ownerToken));
    app.sessions.delete(app.hashSessionToken(editorToken));
    app.server.closeAllConnections();
    await new Promise(resolve => app.server.close(resolve));
    await app.closeStorageStores();
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  });

  const id = 'n_novelwrite1';
  const originalState = { title: '小说保存验证', volumes: [{ id: 'volume-1', chapters: [] }] };
  const createdResponse = await request('/api/novels', ownerToken, {
    method: 'POST', body: JSON.stringify({ id, state: originalState })
  });
  assert.equal(createdResponse.status, 200);
  const created = await createdResponse.json();
  assert.equal(created.revision, 0);

  const changedState = { ...originalState, title: '已保存的新标题' };
  const savedResponse = await request(`/api/novels/${id}`, ownerToken, {
    method: 'PUT', body: JSON.stringify({ state: changedState, revision: created.revision })
  });
  assert.equal(savedResponse.status, 200);
  assert.equal((await savedResponse.json()).revision, 1);

  const staleResponse = await request(`/api/novels/${id}`, ownerToken, {
    method: 'PUT', body: JSON.stringify({ state: originalState, revision: created.revision })
  });
  assert.equal(staleResponse.status, 409);
  assert.equal((await staleResponse.json()).error, '小说已在其他设备更新，请先同步最新版本');

  const workspaceMember = await request(`/api/workspaces/${created.workspaceId}/members`, ownerToken, {
    method: 'POST', body: JSON.stringify({ email: editor.email, role: 'member' })
  });
  assert.equal((await workspaceMember.json()).ok, true);
  const projectMember = await request(`/api/workspaces/${created.workspaceId}/projects/${id}/members`, ownerToken, {
    method: 'POST', body: JSON.stringify({ email: editor.email, role: 'editor' })
  });
  assert.equal((await projectMember.json()).ok, true);

  assert.equal((await request(`/api/novels/${id}`, editorToken, { method: 'DELETE' })).status, 403);
  const deletedResponse = await request(`/api/novels/${id}`, ownerToken, { method: 'DELETE' });
  assert.equal(deletedResponse.status, 200);
  assert.equal((await deletedResponse.json()).deleted, 1);
  assert.equal((await request(`/api/novels/${id}/restore`, editorToken, { method: 'POST', body: '{}' })).status, 404);
  const restoredResponse = await request(`/api/novels/${id}/restore`, ownerToken, { method: 'POST', body: '{}' });
  assert.equal(restoredResponse.status, 200);
  assert.equal((await restoredResponse.json()).restored, true);

  const restoredNovel = await (await request(`/api/novels/${id}`, ownerToken)).json();
  assert.equal(restoredNovel.novel.revision, 1);
  assert.equal(restoredNovel.novel.state.title, '已保存的新标题');
});
