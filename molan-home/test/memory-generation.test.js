'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const memory = require('../lib/memory-system');
const generation = require('../lib/memory-generation');

function fixture(context) {
  const db = new DatabaseSync(':memory:');
  context.after(() => db.close());
  memory.initializeSchema(db);
  return db;
}

test('持久生成只读取合法记忆，原请求重放不重复收费调用', async context => {
  const db = fixture(context);
  db.exec("INSERT INTO memory_propositions (id, book_id, display_text, created_at) VALUES ('secret', 'book', '凶手是师父', 1)");
  memory.recordDecision(db, { bookId: 'book', propositionId: 'secret' });
  db.exec("INSERT INTO disclosure_policies (id, book_id, target_info_id, policy_type, created_at) VALUES ('hide', 'book', 'secret', 'hide', 1)");
  let calls = 0;
  const input = { requestId: 'request_00001', prompt: '写渡口重逢', maxCalls: 2 };
  const execute = async (params, guard) => {
    assert.equal(JSON.stringify(params).includes('凶手是师父'), false);
    await guard(async () => { calls++; return { usage: { totalTokens: 10 } }; });
    return { text: '两人在渡口相逢。', status: 'passed' };
  };
  const result = await generation.generate(db, 'book', 'author', input, execute, () => true);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.calls, 1);
  assert.equal((await generation.generate(db, 'book', 'author', input, execute, () => true)).replayed, true);
  assert.equal(calls, 1);
  await assert.rejects(generation.generate(db, 'book', 'author', { ...input, prompt: '改写任务' }, execute), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('供应商结果未知持久化，刷新与原请求重放不会重新推理', async context => {
  const db = fixture(context);
  let calls = 0;
  const input = { requestId: 'request_unknown', prompt: '写作' };
  const execute = async (_params, guard) => guard(async () => { calls++; throw new Error('socket lost'); });
  const result = await generation.generate(db, 'book', 'author', input, execute);
  assert.equal(result.status, 'provider_unknown');
  assert.equal((await generation.generate(db, 'book', 'author', input, execute)).status, 'provider_unknown');
  assert.equal(calls, 1);
});

test('共享调用预算覆盖审稿修订，预算耗尽保存已有候选', async context => {
  const db = fixture(context);
  const result = await generation.generate(db, 'book', 'author', { requestId: 'request_budget', prompt: '写作', maxCalls: 1 },
    async (_params, guard) => {
      await guard(async () => ({ text: '已有候选' }));
      await assert.rejects(guard(async () => ({ text: '不应执行' })), { code: 'GENERATION_BUDGET_EXCEEDED' });
      return { text: '已有候选', status: 'needs_review' };
    });
  assert.equal(result.status, 'needs_review');
  assert.equal(result.result.text, '已有候选');
  assert.equal(result.calls, 1);
});
