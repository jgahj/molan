'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable, Writable } = require('node:stream');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { JsonFileRepository } = require('../lib/repositories/json-file-repository');
const { JsonAppRepository } = require('../lib/repositories/json-app-repository');
const { createMemoryStore, guardNovelWrite, onNovelChanged } = require('../lib/memory-store');
const { dispatch } = require('../lib/memory-store-routes');
function request(method, url, payload, headers = {}) { const req = Readable.from(payload === undefined ? [] : [JSON.stringify(payload)]); req.method = method; req.url = url; req.headers = headers; return req; }
async function invoke(req, store, services = {}) { let body = ''; const res = new Writable({ write(chunk, enc, done) { body += chunk.toString(); done(); } }); res.writeHead = (status, headers) => { res.statusCode = status; res.headers = headers; }; res.end = chunk => { if (chunk) body += chunk; res.emit('finish'); }; await dispatch(req, res, new URL(req.url, 'http://x').pathname, () => ({ user: { userId: 'u' } }), { ...services, memoryStore: store }); return { status: res.statusCode, body: JSON.parse(body) }; }
test('native memory routes preserve API envelopes and preconditions', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-memory-http-')); const repository = new JsonFileRepository(dir); const app = new JsonAppRepository(dir, { repository });
  t.after(async () => { await repository.close(); fs.rmSync(dir, { recursive: true, force: true }); }); await app.saveAccount({ userId: 'u', email: 'u@t' }); await app.create({ id: 'n_http', user: { userId: 'u', email: 'u@t' }, state: { volumes: [{ chapters: [{ id: 'c', content: '' }] }] } });
  const store = createMemoryStore({ repository, getAccess: input => app.getAccess(input) });
  const styleProfileStore = require('../lib/style-profile-store').createJsonStyleProfileStore(dir, { repository });
  const audit = await invoke(request('POST', '/api/books/n_http/style-audits', { text: '阿青走进房间。' }), store, { styleProfileStore });
  assert.equal(audit.status, 200); assert.equal(audit.body.audit.requiresSemanticReview, true);
  const scopedStyles = { getStyleProfiles: async input => { assert.equal(input.projectId, 'n_http'); assert.equal(input.bookId, 'n_http'); assert.equal(input.userId, 'u'); return []; } };
  const injected = { projectId: 'n_other', workspaceId: 'other', userId: 'other', bookId: 'n_other', text: '正文' };
  assert.equal((await invoke(request('POST', '/api/books/n_http/style-audits', injected), store, { styleProfileStore: scopedStyles })).status, 200);
  assert.equal((await invoke(request('POST', '/api/books/n_http/context/assemble', injected), store, { styleProfileStore: scopedStyles })).status, 200);
  let result = await invoke(request('GET', '/api/books/n_http/memory'), store); assert.equal(result.status, 200); assert.equal(result.body.ok, true); assert.equal(result.body.bookId, 'n_http');
  result = await invoke(request('POST', '/api/books/n_http/memory/changesets', { operations: [] }), store); assert.equal(result.status, 201); const id = result.body.changeset.id;
  result = await invoke(request('POST', `/api/books/n_http/memory/changesets/${id}/approve`, {}), store); assert.equal(result.status, 200);
  result = await invoke(request('POST', `/api/books/n_http/memory/changesets/${id}/commit`, {}, { 'if-match': 'bad' }), store); assert.equal(result.status, 412); assert.equal(result.body.code, 'PRECONDITION_FAILED');
  result = await invoke(request('POST', `/api/books/n_http/memory/changesets/${id}/commit`, {}, { 'idempotency-key': 'http-one' }), store); assert.equal(result.status, 200); assert.equal(result.body.ok, true);
  result = await invoke(request('GET', '/api/books/n_http/workbench'), store); assert.equal(result.body.changesets[0].approval_status, 'approved'); assert.equal(result.body.changesets[0].base_state_version, 1); assert.equal(typeof result.body.changesets[0].committed_at, 'number');
  result = await invoke(request('GET', '/api/books/n_http/projections'), store); assert.equal(result.status, 200); assert.equal(result.body.projections.status, 'PENDING_PROJECTION');
  let calls = 0;
  const generationServices = { styleProfileStore, generate: async (user, params, guard) => { assert.equal(params.novelId, 'n_http'); assert.equal(params.compiledContextText.includes('[currentTask]'), true); assert.equal(params.contextPlan.requiredBlocks.includes('currentTask'), true); await guard(async () => { calls++; return { usage: { totalTokens: 2, creditCost: 0, billingStatus: 'exact' } }; }); return { status: 'passed', text: '阿青走进房间。' }; } };
  const payload = { requestId: 'request-one', prompt: '写正文', maxCalls: 1 };
  result = await invoke(request('POST', '/api/books/n_http/generations', payload), store, generationServices);
  assert.equal(result.status, 200); assert.equal(result.body.run.status, 'succeeded'); const runId = result.body.run.id;
  result = await invoke(request('POST', '/api/books/n_http/generations', payload), store, generationServices); assert.equal(result.body.run.replayed, true); assert.equal(calls, 1);
  result = await invoke(request('GET', `/api/runs/${runId}/events`), store); assert.equal(result.status, 200); assert.equal(result.body.events.some(e => e.type === 'MODEL_CALL_COMPLETED'), true);
  result = await invoke(request('GET', `/api/runs/${runId}`), store); assert.equal(result.body.result.text, '阿青走进房间。');
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const pending = invoke(request('POST', '/api/books/n_http/generations', { requestId: 'request-cancel', prompt: '正文' }), store, {
    generate: async (user, params, guard) => { entered(); await gate; return { status: 'passed', text: 'cancelled candidate' }; }
  });
  await ready;
  const active = await invoke(request('GET', '/api/books/n_http/generations?requestId=request-cancel'), store);
  result = await invoke(request('POST', `/api/books/n_http/generations/${active.body.run.id}/cancel`, {}), store); assert.equal(result.body.run.status, 'cancel_requested');
  release(); assert.equal((await pending).body.run.status, 'cancelled');
});
test('novel hooks require CAS and invalidate candidate sources inside the app transaction', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-memory-hooks-'));
  const repository = new JsonFileRepository(dir);
  const app = new JsonAppRepository(dir, { repository, guardNovelWrite, onNovelChanged });
  t.after(async () => { await repository.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  await app.saveAccount({ userId: 'u', email: 'u@t' });
  await app.create({ id: 'n_hooks', user: { userId: 'u', email: 'u@t' }, state: { volumes: [{ chapters: [{ id: 'c', content: 'old' }] }] } });
  const store = createMemoryStore({ repository, getAccess: input => app.getAccess(input) });
  const m = await store.saveManuscript({ userId: 'u', bookId: 'n_hooks', chapterId: 'c', text: 'candidate', expectedRevision: 0, expectedNovelRevision: 0 });
  const state = { volumes: [{ chapters: [{ id: 'c', content: 'changed' }] }] };
  await assert.rejects(app.saveCAS({ userId: 'u', projectId: 'n_hooks', state }), { code: 'VERSION_REQUIRED' });
  await app.saveCAS({ userId: 'u', projectId: 'n_hooks', expectedRevision: 0, state });
  assert.equal((await store.workbenchState({ userId: 'u', bookId: 'n_hooks' })).invalidations[0].manuscriptId, m.id);
  await repository.transaction(['n_hooks'], tx => {
    const memory = tx.get('n_hooks', 'memory', 'memory:n_hooks');
    memory.branches.main.heads['c:'].acceptedId = m.id;
    tx.put('n_hooks', 'memory', memory, memory.revision);
  });
  await assert.rejects(app.saveCAS({ userId: 'u', projectId: 'n_hooks', expectedRevision: 1, state: { volumes: [] } }), { code: 'MEMORY_CHAPTER_REVIEW_REQUIRED' });
});
