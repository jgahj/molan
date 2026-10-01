'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { JsonAppRepository } = require('../lib/repositories/json-app-repository');
const { JsonCreationRepository } = require('../lib/repositories/json-creation-repository');
const { createNativeCreationService } = require('../services/native-creation-service');

test('unlinked creation books keep stable owner scope across Bible, state and debt HTTP access', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-creation-scope-'));
  const app = new JsonAppRepository(directory);
  const ownerUserId = 'creation-scope-owner';
  const strangerUserId = 'creation-scope-stranger';
  await app.saveAccount({ userId: ownerUserId, email: 'creation-scope-a@example.com' });
  await app.saveAccount({ userId: strangerUserId, email: 'creation-scope-b@example.com' });
  const repository = new JsonCreationRepository(app);
  const service = createNativeCreationService({ repository,
    getAuthUser: req => req.headers.authorization ? { user: { userId: req.headers.authorization } } : null,
    readBody: async req => { let text = ''; for await (const chunk of req) text += chunk; return JSON.parse(text); },
    json: (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); },
    normalizeCreationPlan: input => ({ ...input, budgetLimit: input.budgetLimit || 0 }),
    normalizeBiblePayload: body => body,
    creationForbiddenTerms: () => [],
    creationBibleSeedValidation: payload => ({ ok: Boolean(payload.valid), hits: [], missing: payload.valid ? [] : ['valid'] }),
    creationChapterContext: () => ({}),
    deterministicContractValidation: () => ({ blockerCount: 0 }),
    contractFieldsSubstantive: () => ({ ok: true }),
    generateChapterContract: async () => ({})
  });
  const server = http.createServer(async (req, res) => {
    if (!await service.dispatch(req, res, new URL(req.url, 'http://localhost').pathname)) { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(url, method = 'GET', body, userId = ownerUserId) {
    const response = await fetch(base + url, { method,
      headers: { ...(userId ? { authorization: userId } : {}), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }

  const bookId = 'cb_scope_stable_1';
  const created = await call('/api/creation-books', 'POST', { creationBookId: bookId, title: '稳定归属测试',
    plan: { budgetLimit: 100 }, bible: { valid: true, bookPremise: { title: '稳定归属测试' }, characters: [{ name: '甲' }] } });
  assert.equal(created.status, 200);
  assert.equal(created.body.book.id, bookId);
  assert.equal(created.body.book.ownerUserId, ownerUserId);
  assert.equal(Object.hasOwn(created.body.book, 'projectId'), false);
  assert.equal((await app.list({ userId: ownerUserId })).length, 0);
  assert.deepEqual((await call('/api/creation-books')).body.books.map(book => book.id), [bookId]);
  assert.deepEqual((await call('/api/creation-books', 'GET', undefined, strangerUserId)).body.books, []);

  assert.equal((await call(`/api/creation-books/${bookId}`)).status, 200);
  assert.equal((await call(`/api/creation-books/${bookId}`, 'GET', undefined, strangerUserId)).status, 404);
  const bibleUrl = `/api/creation-books/${bookId}/bible`;
  assert.equal((await call(bibleUrl)).body.bible.version, 1);
  assert.equal((await call(bibleUrl, 'GET', undefined, strangerUserId)).status, 404);
  assert.equal((await call(bibleUrl, 'PUT', { bible: { valid: true, revised: true }, bibleVersion: 1 })).body.bibleVersion, 2);
  assert.equal((await call(bibleUrl, 'PUT', { bible: { valid: true }, bibleVersion: 2 }, strangerUserId)).status, 404);

  const stateUrl = `/api/creation-books/${bookId}/state`;
  const state = await call(stateUrl);
  assert.equal(state.status, 200);
  assert.equal(state.body.book.currentStateVersion, 0);
  assert.deepEqual(state.body.snapshots, []);
  assert.equal((await call(stateUrl, 'GET', undefined, strangerUserId)).status, 404);

  const debtsUrl = `/api/creation-books/${bookId}/debts`;
  const debts = await call(debtsUrl);
  assert.equal(debts.status, 200);
  assert.deepEqual(debts.body.allDebts, []);
  assert.equal((await call(debtsUrl, 'GET', undefined, strangerUserId)).status, 404);
});
