'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { compileContext } = require('../lib/memory-context');
const source = () => ({ bookId: 'book', branchId: 'main', version: 1,
  facts: [{ id: 'fact', propositionId: 'prop', revision: 1, displayText: 'hard fact' }],
  cognitions: [{ id: 'knowledge', holderEntityId: 'pov', targetExpressionId: 'prop', attitude: 'knows', awareness: 'aware' }],
  policies: [], profiles: [], plans: [], sourceCurrent: () => true });
test('memory compiler preserves required blocks and binds complete replay selection', () => {
  const query = { currentTask: 'current task', povId: 'pov', sceneId: 'scene', budgetTokens: 10000, modelId: 'gpt-4o', requiredIds: ['fact'] };
  const first = compileContext(source(), query), second = compileContext(source(), { ...query });
  assert.equal(first.inputHash, second.inputHash); assert.equal(first.compiledContext, second.compiledContext);
  assert.deepEqual(first.contextPlan.requiredBlocks, ['currentTask', 'hardState', 'povKnowledge']);
  assert.equal(first.contextPlan.omittedBlocks.includes('hardState'), false);
  for (const change of [{ povId: '' }, { sceneId: 'other' }, { budgetTokens: 11000 }, { requiredIds: [] }, { modelId: 'default' }]) assert.notEqual(compileContext(source(), { ...query, ...change }).inputHash, first.inputHash);
  const altered = source(); altered.plans = [{ id: 'unselected', revision: 2 }];
  assert.notEqual(compileContext(altered, query).inputHash, first.inputHash);
  assert.throws(() => compileContext(source(), { ...query, budgetTokens: 1000, currentTask: 'required'.repeat(2000) }), { code: 'CONTEXT_BUDGET_EXCEEDED' });
});
