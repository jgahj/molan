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
  await app.saveAccount({ userId: 'editor', email: 'editor@test.local' });
  const novel = await app.create({ user: owner, id: 'n_http', state: { volumes: [] } });
  await app.upsertWorkspaceMember('owner', novel.workspaceId, 'viewer', 'member');
  await app.upsertWorkspaceMember('owner', novel.workspaceId, 'editor', 'member');
  await app.upsertProjectMember({ userId: 'owner', projectId: novel.id, targetUserId: 'viewer', role: 'viewer' });
  await app.upsertProjectMember({ userId: 'owner', projectId: novel.id, targetUserId: 'editor', role: 'editor' });
  let providerCalls = 0;
  let providerMode = 'normal';
  const creationRepo = new JsonCreationRepository(app);
  const service = createNativeCreationService({ repository: creationRepo,
    getAuthUser: req => req.headers.authorization ? { user: { userId: req.headers.authorization } } : null,
    readBody: async req => { let text = ''; for await (const chunk of req) text += chunk; return JSON.parse(text); },
    json: (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); },
    normalizeCreationPlan: input => ({ ...input, budgetLimit: input.budgetLimit || 0 }),
    normalizeBiblePayload: body => body,
    creationForbiddenTerms: () => [],
    creationBibleSeedValidation: payload => ({ ok: Boolean(payload.valid), hits: [], missing: ['valid'] }),
    creationChapterContext: (payload, chapterNo) => ({ chapterNo, title: payload.title || 'test' }),
    contractFieldsSubstantive: contract => ({ ok: ['goal', 'protagonistAction', 'opposition', 'irreversibleResult'].every(key => String(contract[key] || '').length >= 8) }),
    deterministicContractValidation: contract => ({ status: contract.goal ? 'passed' : 'failed', blockerCount: contract.goal ? 0 : 1, findings: [] }),
    generateChapterContract: async input => {
      providerCalls++;
      if (providerMode === 'unknown') return { status: 'provider_unknown', usage: { billingStatus: 'unknown' } };
      if (providerMode === 'stale') await creationRepo.saveBibleCAS({ userId: 'owner', projectId: 'n_http', bookId: 'cb_http',
        expectedVersion: input.baseline.bibleVersion, payload: { valid: true } });
      return { json: providerMode === 'invalid' || input.attempt === 0 ? { goal: 'short' } : {
        goal: 'Investigate the hidden document', protagonistAction: 'Hero examines the sealed archive',
        opposition: 'The guard prevents archive access', irreversibleResult: 'The seal is irreversibly broken' }, usage: { creditCost: 1 } };
    } });
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
  const quality = await call('/api/creation-books/cb_http/quality-report', 'GET', undefined, 'viewer');
  assert.equal(quality.status, 200);
  assert.equal(quality.body.summary.chapterCount, 0);
  assert.deepEqual(quality.body.chapters, []);
  assert.equal((await call('/api/creation-books/cb_http/quality-report', 'GET', undefined, 'stranger')).status, 404);
  const legacyState = await call('/api/creation-books/cb_http/state?chapterNo=1');
  assert.equal(legacyState.status, 200);
  assert.equal(legacyState.body.book.projectId, 'n_http');
  assert.equal((await call('/api/creation-books/cb_http/bible')).body.bible.version, 2);
  assert.equal((await call('/api/creation-books/cb_http/bible', 'PUT', { bible: { valid: true }, bibleVersion: 2 })).body.bibleVersion, 3);
  assert.equal((await call('/api/creation-books/cb_http/state?chapterNo=1', 'GET', undefined, 'stranger')).status, 404);
  assert.equal((await call('/api/creation-books/cb_missing/state', 'GET', undefined, 'stranger')).status, 404);
  assert.equal((await call('/api/creation-books/cb_http/bible', 'PUT', { projectId: 'n_fake', bible: { valid: true }, bibleVersion: 3 })).status, 404);
  assert.equal((await call('/api/creation-books/cb_http/bible?projectId=n_http', 'PUT', {
    projectId: 'n_fake', bible: { valid: true }, bibleVersion: 3 })).status, 404);
  assert.equal((await call('/api/creation-books/cb_http/state?projectId=n_http&chapterNo=-1')).status, 422);
  assert.equal((await call('/api/creation-books/cb_http/bible?projectId=n_other')).status, 404);
  const contractUrl = '/api/creation-books/cb_http/chapter-contract';
  assert.equal((await call(contractUrl, 'POST', { chapterNo: 1 }, 'viewer')).status, 404);
  const forbiddenSpend = await call(contractUrl, 'POST', { chapterNo: 1 }, 'editor');
  assert.equal(forbiddenSpend.status, 403);
  assert.equal(forbiddenSpend.body.code, 'spend_forbidden');
  assert.equal(providerCalls, 0);
  const generated = await call(contractUrl, 'POST', { chapterNo: 1 });
  assert.equal(generated.status, 200, JSON.stringify(generated.body));
  assert.equal(generated.body.retried, true);
  assert.equal(generated.body.contract.bibleVersion, 3);
  assert.equal(generated.body.contract.stateVersion, 0);
  assert.equal(providerCalls, 2);
  const contracts = (await app.repository.ledger.list('n_http')).filter(row => row.kind === 'creation-contract');
  assert.equal(contracts.length, 1);
  assert.equal(contracts[0].auditStatus, 'unaudited');
  assert.equal(contracts[0].providerAttempts.length, 2);
  assert.equal(generated.body.providerAttempts.length, 2);
  providerMode = 'unknown';
  const callsBeforeUnknown = providerCalls;
  assert.equal((await call(contractUrl, 'POST', { chapterNo: 1 })).status, 502);
  assert.equal(providerCalls, callsBeforeUnknown + 1);
  providerMode = 'invalid';
  assert.equal((await call(contractUrl, 'POST', { chapterNo: 1 })).status, 422);
  assert.equal((await app.repository.ledger.list('n_http')).filter(row => row.kind === 'creation-contract').length, 1);
  providerMode = 'stale';
  const staleContract = await call(contractUrl, 'POST', { chapterNo: 1 });
  assert.equal(staleContract.status, 409);
  assert.equal(staleContract.body.code, 'needs_rebase');
  await app.repository.ledger.put('n_http', { id: 'test-outbox', kind: 'creation-debt-outbox', bookId: 'cb_http',
    snapshotId: 'snapshot-1', createdAt: 1, status: 'pending', causalDebts: [
      { type: 'arc', seed: 'Archive promise', originChapter: 1 },
      { type: 'micro', seed: 'Lost token', originChapter: 1 }
    ] }, 0);
  const debtUrl = '/api/creation-books/cb_http/debts?chapterNo=11';
  assert.equal((await call(debtUrl, 'GET', undefined, 'stranger')).status, 404);
  const debts = await call(debtUrl, 'GET', undefined, 'viewer');
  assert.equal(debts.status, 200);
  assert.equal(debts.body.recovery.recovered, 1);
  assert.equal(debts.body.matured.length, 1);
  assert.equal(debts.body.allDebts.find(debt => debt.type === 'micro').status, 'settled');
  assert.match(debts.body.block, /Archive promise/);
  assert.equal((await call(debtUrl)).body.recovery.recovered, 0);
  assert.equal((await app.repository.ledger.list('n_http')).filter(row => row.kind === 'creation-debt').length, 2);
});

test('native debt view applies capacity and micro expiry without changing source evidence', () => {
  const { projectDebts } = require('../lib/creation-debt-projection');
  const source = [1, 2, 3, 4].map(index => ({ id: `d${index}`, type: 'arc', seed: `seed${index}`,
    status: 'active', originChapter: 1, maturationChapter: 11 }));
  source.push({ id: 'micro', type: 'micro', seed: 'cost', status: 'active', originChapter: 1, maturationChapter: 4 });
  const result = projectDebts(source, 11);
  assert.equal(result.matured.length, 3);
  assert.equal(result.allDebts.find(debt => debt.id === 'd1').status, 'settled');
  assert.equal(result.allDebts.find(debt => debt.id === 'micro').status, 'settled');
  assert.equal(source[0].status, 'active');
});
