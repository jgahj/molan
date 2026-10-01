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
  const validContract = {
    goal: 'Investigate the hidden document', protagonistAction: 'Hero examines the sealed archive',
    opposition: 'The guard prevents archive access', irreversibleResult: 'The seal is irreversibly broken'
  };
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
      if (providerMode === 'missing_usage') return { json: validContract };
      if (providerMode === 'missing_cost') return { json: validContract, usage: { totalTokens: 80, billingStatus: 'settled' } };
      if (providerMode === 'unknown_billing') return { json: validContract, usage: { totalTokens: 80, creditCost: 1, billingStatus: 'UNKNOWN' } };
      if (providerMode === 'negative_cost') return { json: validContract, usage: { totalTokens: 80, creditCost: -1, billingStatus: 'exact' } };
      if (providerMode === 'nonfinite_cost') return { json: validContract, usage: { totalTokens: 80, creditCost: Infinity, billingStatus: 'settled' } };
      if (providerMode === 'stale') await creationRepo.saveBibleCAS({ userId: 'owner', projectId: 'n_http', bookId: 'cb_http',
        expectedVersion: input.baseline.bibleVersion, payload: { valid: true } });
      return { json: providerMode === 'invalid' || input.attempt === 0 ? { goal: 'short' } : validContract,
        usage: { creditCost: 1, billingStatus: input.attempt === 0 ? 'exact' : 'settled', totalTokens: 80 } };
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
  assert.deepEqual((await call('/api/creation-books')).body.books, []);
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
  assert.deepEqual(contracts[0].providerAttempts.map(attempt => attempt.usage.billingStatus), ['exact', 'settled']);
  assert.ok(contracts[0].providerAttempts.every(attempt => attempt.usage.creditCost === 1));
  providerMode = 'unknown';
  const callsBeforeUnknown = providerCalls;
  const unknown = await call(contractUrl, 'POST', { chapterNo: 1 });
  assert.equal(unknown.status, 502);
  assert.equal(unknown.body.code, 'PROVIDER_UNKNOWN');
  assert.equal(providerCalls, callsBeforeUnknown + 1);
  assert.equal(unknown.body.providerResponse.status, 'provider_unknown');
  assert.equal(unknown.body.failureEvidence.checks.providerResultKnown, false);
  const unknownRecord = await app.repository.ledger.get('n_http', unknown.body.failureEvidence.failureId);
  assert.equal(unknownRecord.kind, 'creation-contract-failure');
  assert.equal(unknownRecord.providerResponse.status, 'provider_unknown');
  assert.equal(unknownRecord.failureEvidence.code, 'PROVIDER_UNKNOWN');
  assert.equal((await app.repository.ledger.list('n_http')).filter(row => row.kind === 'creation-contract').length, 1);
  providerMode = 'missing_cost';
  const callsBeforeMissingCost = providerCalls;
  const missingCost = await call(contractUrl, 'POST', { chapterNo: 1 });
  assert.equal(missingCost.status, 502);
  assert.equal(missingCost.body.code, 'PROVIDER_COST_UNKNOWN');
  assert.equal(providerCalls, callsBeforeMissingCost + 1);
  assert.equal(missingCost.body.providerResponse.json.goal, validContract.goal);
  assert.equal(missingCost.body.failureEvidence.checks.finiteNonNegativeCreditCost, false);
  assert.equal(missingCost.body.failureEvidence.checks.settledBillingStatus, true);
  const missingCostRecord = await app.repository.ledger.get('n_http', missingCost.body.failureEvidence.failureId);
  assert.equal(missingCostRecord.providerResponse.json.goal, validContract.goal);
  assert.equal(missingCostRecord.failureEvidence.reason, 'provider_cost_unconfirmed');
  providerMode = 'unknown_billing';
  const callsBeforeUnknownBilling = providerCalls;
  const unknownBilling = await call(contractUrl, 'POST', { chapterNo: 1 });
  assert.equal(unknownBilling.status, 502);
  assert.equal(unknownBilling.body.code, 'PROVIDER_COST_UNKNOWN');
  assert.equal(providerCalls, callsBeforeUnknownBilling + 1);
  assert.equal(unknownBilling.body.failureEvidence.checks.finiteNonNegativeCreditCost, true);
  assert.equal(unknownBilling.body.failureEvidence.checks.settledBillingStatus, false);
  for (const mode of ['missing_usage', 'negative_cost', 'nonfinite_cost']) {
    providerMode = mode;
    const callsBeforeInvalidCost = providerCalls;
    const invalidCost = await call(contractUrl, 'POST', { chapterNo: 1 });
    assert.equal(invalidCost.status, 502, mode);
    assert.equal(invalidCost.body.code, 'PROVIDER_COST_UNKNOWN', mode);
    assert.equal(providerCalls, callsBeforeInvalidCost + 1, mode);
    assert.equal(invalidCost.body.failureEvidence.checks.finiteNonNegativeCreditCost, false, mode);
    if (mode === 'missing_usage') assert.equal(invalidCost.body.failureEvidence.checks.usagePresent, false);
  }
  providerMode = 'invalid';
  const callsBeforeInvalid = providerCalls;
  assert.equal((await call(contractUrl, 'POST', { chapterNo: 1 })).status, 422);
  assert.equal(providerCalls, callsBeforeInvalid + 2);
  assert.equal((await app.repository.ledger.list('n_http')).filter(row => row.kind === 'creation-contract').length, 1);
  providerMode = 'stale';
  const staleContract = await call(contractUrl, 'POST', { chapterNo: 1 });
  assert.equal(staleContract.status, 409);
  assert.equal(staleContract.body.code, 'needs_rebase');
  assert.equal((await app.repository.ledger.list('n_http')).filter(row => row.kind === 'creation-contract').length, 1);
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

test('unlinked native creation books stay owner-scoped and require a novel before chapter generation', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-native-unlinked-creation-'));
  const app = new JsonAppRepository(directory);
  await app.saveAccount({ userId: 'owner', email: 'owner@test.local' });
  await app.saveAccount({ userId: 'stranger', email: 'stranger@test.local' });
  const repository = new JsonCreationRepository(app);
  let providerCalls = 0;
  const service = createNativeCreationService({ repository,
    getAuthUser: req => req.headers.authorization ? { user: { userId: req.headers.authorization } } : null,
    readBody: async req => { let text = ''; for await (const chunk of req) text += chunk; return JSON.parse(text); },
    json: (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); },
    normalizeCreationPlan: input => ({ ...input, budgetLimit: input.budgetLimit || 0 }),
    normalizeBiblePayload: body => body,
    creationForbiddenTerms: () => [],
    creationBibleSeedValidation: payload => ({ ok: Boolean(payload.valid), hits: [], missing: ['valid'] }),
    creationChapterContext: () => ({}), deterministicContractValidation: () => ({ blockerCount: 0 }),
    contractFieldsSubstantive: () => ({ ok: true }),
    generateChapterContract: async () => { providerCalls++; return {}; }
  });
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

  assert.deepEqual((await call('/api/creation-books')).body.books, []);
  const payload = { creationBookId: 'cb_unlinked', title: 'Unlinked', bible: { valid: true } };
  const created = await call('/api/creation-books', 'POST', payload);
  assert.equal(created.status, 200);
  assert.equal(created.body.book.id, 'cb_unlinked');
  assert.equal(Object.hasOwn(created.body.book, 'projectId'), false);
  assert.deepEqual((await call('/api/creation-books')).body.books.map(book => book.id), ['cb_unlinked']);
  assert.deepEqual((await call('/api/creation-books', 'GET', undefined, 'stranger')).body.books, []);
  assert.equal((await call('/api/creation-books/cb_unlinked', 'GET', undefined, 'stranger')).status, 404);

  const state = await call('/api/creation-books/cb_unlinked/state');
  assert.equal(state.status, 200);
  assert.equal(state.body.book.currentStateVersion, 0);
  assert.deepEqual(state.body.snapshots, []);
  assert.equal((await call('/api/creation-books/cb_unlinked/quality-report')).body.summary.chapterCount, 0);
  assert.equal((await call('/api/creation-books/cb_unlinked/debts')).body.recovery.recovered, 0);
  const bible = '/api/creation-books/cb_unlinked/bible';
  assert.equal((await call(bible, 'PUT', { bible: { valid: true, revised: true }, bibleVersion: 1 })).body.bibleVersion, 2);
  assert.equal((await call(bible, 'PUT', { bible: { valid: true }, bibleVersion: 1 })).body.code, 'needs_rebase');
  assert.equal((await call('/api/creation-books/cb_unlinked/chapter-contract', 'POST', { chapterNo: 1 })).body.code,
    'CREATION_PROJECT_REQUIRED');
  assert.equal(providerCalls, 0);
  await assert.rejects(repository.commitChapter({ userId: 'owner', bookId: 'cb_unlinked', runId: 'run-unlinked' }),
    { code: 'CREATION_PROJECT_REQUIRED' });
  const novel = await app.create({ user: { userId: 'owner' }, id: 'n_unlinkedtest', state: { volumes: [] } });
  await assert.rejects(repository.commitChapter({ userId: 'owner', projectId: novel.id, workspaceId: novel.workspaceId,
    bookId: 'cb_unlinked', runId: 'run-unlinked' }), { code: 'CREATION_PROJECT_REQUIRED' });
  assert.equal((await call('/api/creation-books', 'POST', payload, 'stranger')).body.code, 'CREATION_BOOK_CONFLICT');
  assert.deepEqual((await app.list({ userId: 'owner' })).map(book => book.id), ['n_unlinkedtest']);
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
