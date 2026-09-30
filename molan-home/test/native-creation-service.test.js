'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { JsonAppRepository } = require('../lib/repositories/json-app-repository');
const { JsonCreationRepository } = require('../lib/repositories/json-creation-repository');
const { createNativeCreationService } = require('../services/native-creation-service');

test('native creation HTTP preserves response shapes, scope, member ACL and Bible CAS', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-native-creation-http-'));
  const app = new JsonAppRepository(directory);
  const owner = await app.saveAccount({ userId: 'owner', email: 'owner@test.local' });
  await app.saveAccount({ userId: 'viewer', email: 'viewer@test.local' });
  const novel = await app.create({ user: owner, id: 'n_http', state: { volumes: [] } });
  await app.upsertWorkspaceMember('owner', novel.workspaceId, 'viewer', 'member');
  await app.upsertProjectMember({ userId: 'owner', projectId: novel.id, targetUserId: 'viewer', role: 'viewer' });
  const service = createNativeCreationService({ repository: new JsonCreationRepository(app),
    getAuthUser: req => req.headers.authorization ? { user: { userId: req.headers.authorization } } : null,
    readBody: async req => { let text = ''; for await (const chunk of req) text += chunk; return JSON.parse(text); },
    json: (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); },
    normalizeCreationPlan: input => ({ ...input, budgetLimit: input.budgetLimit || 0 }),
    normalizeBiblePayload: body => body,
    creationForbiddenTerms: () => [],
    creationBibleSeedValidation: payload => ({ ok: Boolean(payload.valid), hits: [], missing: ['valid'] }) });
  const server = http.createServer(async (req, res) => {
    if (!await service.dispatch(req, res, new URL(req.url, 'http://localhost').pathname)) { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await app.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(url, method = 'GET', body, user = 'owner') {
    const response = await fetch(base + url, { method, headers: { ...(user ? { authorization: user } : {}), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  assert.equal((await call('/api/creation-books?projectId=n_http', 'GET', undefined, '')).status, 401);
  assert.equal((await call('/api/creation-books')).body.code, 'CREATION_PROJECT_SCOPE_REQUIRED');
  const payload = { projectId: 'n_http', creationBookId: 'cb_http', title: 'Book', bible: { valid: true } };
  assert.equal((await call('/api/creation-books', 'POST', { ...payload, bible: {} })).status, 422);
  const created = await call('/api/creation-books', 'POST', payload);
  assert.equal(created.status, 200);
  assert.equal(created.body.book.id, 'cb_http');
  assert.equal(created.body.book.bibleVersion, 1);
  assert.deepEqual(created.body.bible, { valid: true });
  assert.equal((await call('/api/creation-books', 'POST', payload)).body.reused, true);
  assert.equal((await call('/api/creation-books', 'POST', payload, 'viewer')).status, 404);
  assert.equal((await call('/api/creation-books?novelId=n_http', 'GET', undefined, 'viewer')).body.books.length, 1);
  const bible = '/api/creation-books/cb_http/bible?projectId=n_http';
  assert.equal((await call(bible)).body.bible.version, 1);
  assert.equal((await call(bible, 'PUT', { bible: { valid: true } })).status, 428);
  assert.equal((await call(bible, 'PUT', { bible: { valid: true }, bibleVersion: 1 }, 'viewer')).status, 404);
  assert.equal((await call(bible, 'PUT', { bible: { valid: true, revised: true }, bibleVersion: 1 })).body.bibleVersion, 2);
  const stale = await call(bible, 'PUT', { bible: { valid: true }, revision: 1 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'needs_rebase');
  const state = await call('/api/creation-books/cb_http/state?projectId=n_http');
  assert.equal(state.status, 200);
  assert.deepEqual(state.body.snapshots, []);
  assert.equal((await call('/api/creation-books/cb_http/state?projectId=n_http&chapterNo=-1')).status, 422);
  assert.equal((await call('/api/creation-books/cb_http/bible?projectId=n_other')).status, 404);
});
