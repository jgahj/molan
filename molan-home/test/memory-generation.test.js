'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonAppRepository } = require('../lib/repositories/json-app-repository');
const { createMemoryStore } = require('../lib/memory-store');

async function fixture(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-memory-generation-'));
  const app = new JsonAppRepository(directory);
  context.after(async () => {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await app.saveAccount({ userId: 'author', email: 'author@test.local' });
  await app.create({ id: 'n_book', user: { userId: 'author', email: 'author@test.local' }, state: { volumes: [{ chapters: [{ id: 'c1', content: '' }] }] } });
  const store = createMemoryStore({ backend: 'json', repository: app.repository, getAccess: input => app.getAccess(input) });
  return { store, scope: { userId: 'author', bookId: 'n_book' } };
}

test('持久生成只读取合法记忆，原请求重放不重复收费调用', async context => {
  const { store, scope } = await fixture(context);
  const manuscript = await store.saveManuscript({ ...scope, chapterId: 'c1', text: '凶手是师父。', expectedRevision: 0, expectedNovelRevision: 0 });
  const extracted = await store.extract({ ...scope, manuscriptRevisionId: manuscript.id });
  const fact = await store.createChangeset({ ...scope, operations: [
    { type: 'INSERT_FACT', payload: { id: 'secret', propositionId: extracted.propositions[0].id } }
  ] });
  await store.approveChangeset({ ...scope, changesetId: fact.id });
  await store.commitChangeset({ ...scope, changesetId: fact.id });
  const hide = await store.createChangeset({ ...scope, operations: [
    { type: 'SET_DISCLOSURE', payload: { id: 'hide', targetInfoId: 'secret', policyType: 'hide' } }
  ] });
  await store.approveChangeset({ ...scope, changesetId: hide.id });
  await store.commitChangeset({ ...scope, changesetId: hide.id });
  assert.equal((await store.getMemory(scope)).length, 1);
  const state = await store.repository.memory.get(scope.bookId, `memory:${scope.bookId}`);
  assert.equal(state.branches.main.outbox.filter(job => job.status === 'queued').length, 2);
  assert.equal((await store.processProjections(scope)).synced, true);
  let calls = 0;
  const input = { ...scope, requestId: 'request_00001', prompt: '写渡口重逢', maxCalls: 2 };
  const execute = async (params, guard) => {
    assert.equal(JSON.stringify(params).includes('凶手是师父'), false);
    await guard(async () => { calls++; return { usage: { totalTokens: 10 } }; });
    return { text: '两人在渡口相逢。', status: 'passed' };
  };
  const result = await store.generate(input, execute);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.calls, 1);
  assert.equal((await store.generate(input, execute)).replayed, true);
  assert.equal(calls, 1);
  await assert.rejects(store.generate({ ...input, prompt: '改写任务' }, execute), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('供应商结果未知持久化，刷新与原请求重放不会重新推理', async context => {
  const { store, scope } = await fixture(context);
  let calls = 0;
  const input = { ...scope, requestId: 'request_unknown', prompt: '写作' };
  const execute = async (_params, guard) => guard(async () => { calls++; throw new Error('socket lost'); });
  const result = await store.generate(input, execute);
  assert.equal(result.status, 'provider_unknown');
  assert.equal((await store.getGeneration({ ...scope, runId: result.id })).status, 'provider_unknown');
  assert.equal((await store.generate(input, execute)).status, 'provider_unknown');
  assert.equal(calls, 1);
});

test('共享调用预算覆盖审稿修订，预算耗尽保存已有候选', async context => {
  const { store, scope } = await fixture(context);
  const result = await store.generate({ ...scope, requestId: 'request_budget', prompt: '写作', maxCalls: 1 },
    async (_params, guard) => {
      await guard(async () => ({ text: '已有候选' }));
      await assert.rejects(guard(async () => ({ text: '不应执行' })), { code: 'GENERATION_BUDGET_EXCEEDED' });
      return { text: '已有候选', status: 'needs_review' };
    });
  assert.equal(result.status, 'needs_review');
  assert.equal(result.result.text, '已有候选');
  assert.equal(result.calls, 1);
});
