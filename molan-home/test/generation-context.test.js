'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assembleContext } = require('../lib/generation/context');

test('上下文按固定优先级编译，并为相同输入生成稳定摘要', () => {
  const input = {
    historicalFacts: '较远的历史',
    characters: ['当前角色'],
    sceneContract: { goal: '拿到账册' },
    immediateTimeline: '上一场结束在仓库门口'
  };
  const first = assembleContext(input, { maxChars: 1000, outputReserve: 900 });
  const second = assembleContext({ ...input }, { maxChars: 1000, outputReserve: 900 });
  assert.deepEqual(first.contextPlan.requiredBlocks, ['sceneContract', 'immediateTimeline']);
  assert.equal(first.contextPlan.contextHash, second.contextPlan.contextHash);
  assert.ok(first.text.indexOf('[sceneContract]') < first.text.indexOf('[characters]'));
  assert.ok(first.text.indexOf('[characters]') < first.text.indexOf('[historicalFacts]'));
});

test('必要合同超出预算时拒绝编译，不静默裁剪', () => {
  assert.throws(() => assembleContext({ sceneContract: '合同'.repeat(600) }, { maxChars: 1000 }), { code: 'CONTEXT_OVERFLOW' });
});

test('结构化的低优先级历史整块省略，避免留下截断 JSON', () => {
  const result = assembleContext({
    sceneContract: { goal: '拿到账册' },
    historicalFacts: { chapter1: '旧事实'.repeat(500) }
  }, { maxChars: 1000 });
  assert.deepEqual(result.contextPlan.omittedBlocks, ['historicalFacts']);
  assert.equal(result.contextPlan.truncatedBlocks.length, 0);
  assert.ok(!result.text.includes('historicalFacts'));
});
