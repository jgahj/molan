'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const memory = require('../lib/memory-system');
const style = require('../lib/style-system');
const { createNativeMemoryFixture: fixture } = require('./helpers/native-memory-fixture');

test('暗示包不包含隐藏答案字段，人物认知也不泄漏秘密', async context => {
  const f = await fixture(context);
  const secret = await f.secret();
  assert.equal((await f.commit([
    { type: 'INSERT_FACT', payload: { propositionId: secret } },
    { type: 'INSERT_COGNITION', payload: { holderEntityId: 'hero', targetExpressionId: secret } },
    { type: 'SET_DISCLOSURE', payload: { targetInfoId: secret, policyType: 'imply', allowedClues: ['袖口有血迹'] } }
  ])).ok, true);
  const manifest = await f.store.assembleContext({ ...f.scope, povId: 'hero' });
  assert.equal(JSON.stringify(manifest.writingPackage).includes('凶手是师父'), false);
  assert.deepEqual(manifest.writingPackage.facts[0].allowedClues, ['袖口有血迹']);
  assert.equal(manifest.writingPackage.cognitions.length, 0);
  assert.ok(JSON.stringify(manifest.auditPackage).includes('凶手是师父'));
});

test('时间区间、人物知识和分支隔离生效；不足预算零清单写入', async context => {
  const f = await fixture(context);
  const secret = await f.secret();
  await f.commit([{ type: 'INSERT_FACT', payload: { propositionId: secret, validIntervalStart: '0020', validIntervalEnd: '0030' } }]);
  const otherSecret = await f.secret({ branchId: 'other' });
  await f.commit([{ type: 'INSERT_COGNITION', payload: { holderEntityId: 'hero', targetExpressionId: otherSecret } }], { branchId: 'other' });
  assert.equal((await f.store.getCognition({ ...f.scope, holderEntityId: 'hero' })).length, 0);
  assert.equal((await f.store.assembleContext({ ...f.scope, storyTime: '0010' })).writingPackage.facts.length, 0);
  assert.equal((await f.store.assembleContext({ ...f.scope, storyTime: '0021', povId: 'hero' })).writingPackage.facts.length, 0);
  const before = Object.keys((await f.state()).branches.main.manifests).length;
  await assert.rejects(f.store.assembleContext({ ...f.scope, storyTime: '0021', budgetTokens: 10 }), { code: 'CONTEXT_BUDGET_EXCEEDED' });
  assert.equal(Object.keys((await f.state()).branches.main.manifests).length, before);
});

test('计划到期不自动完成，完成必须引用真实事件', async context => {
  const f = await fixture(context);
  await assert.rejects(f.commit([{ type: 'UPSERT_PLAN', payload: { title: '去青云宗', status: 'completed' } }]), { code: 'EVENT_EVIDENCE_REQUIRED' });
  const result = await f.commit([
    { type: 'UPSERT_PLAN', payload: { id: 'plan', title: '去青云宗', status: 'completed', realizationEventId: 'event' } },
    { type: 'INSERT_EVENT', payload: { id: 'event', title: '抵达青云宗' } }
  ]);
  assert.equal(result.ok, true);
  assert.equal((await f.store.getRecords({ ...f.scope, type: 'plan' })).find(record => record.id === 'plan').status, 'completed');
});

test('伏笔与条件承诺不能无证据完成', async context => {
  const f = await fixture(context);
  await assert.rejects(f.commit([{ type: 'UPSERT_FORESHADOW', payload: { title: '玉佩', status: 'resolved' } }]), { code: 'PAYOFF_EVIDENCE_REQUIRED' });
  await assert.rejects(f.commit([{ type: 'UPSERT_COMMITMENT', payload: {
    promisorId: 'elder', promiseeId: 'hero', triggerCondition: '回来', fulfillmentContent: '告知秘密', status: 'fulfilled'
  } }]), { code: 'CONDITION_EVIDENCE_REQUIRED' });
});

test('时间关系同时、晚于和历史字段格式都能正确判环', () => {
  assert.equal(memory.validateTemporalRelations([
    { source_event_id: 'first', target_event_id: 'second', relation_type: 'simultaneous' },
    { source_event_id: 'second', target_event_id: 'first', relation_type: 'before' }
  ]), false);
  assert.equal(memory.validateTemporalRelations([
    { sourceEventId: 'first', targetEventId: 'second', relationType: 'after' },
    { sourceEventId: 'first', targetEventId: 'second', relationType: 'before' }
  ]), false);
  assert.equal(memory.validateTemporalRelations([
    { sourceEventId: 'first', targetEventId: 'second', relationType: 'before', cycleId: 'one' },
    { sourceEventId: 'second', targetEventId: 'first', relationType: 'before', cycleId: 'two' }
  ]), true);
});

test('相反世界裁决必须显式取代，不自动改变角色认知', async context => {
  const f = await fixture(context);
  const secret = await f.secret();
  await f.commit([
    { type: 'INSERT_FACT', payload: { id: 'old', propositionId: secret, verdict: 'true' } },
    { type: 'INSERT_COGNITION', payload: { holderEntityId: 'hero', targetExpressionId: secret, attitude: 'believes' } }
  ]);
  await assert.rejects(f.commit([{ type: 'INSERT_FACT', payload: { propositionId: secret, verdict: 'false' } }]), { code: 'FACT_CONFLICT' });
  assert.equal((await f.commit([{ type: 'INSERT_FACT', payload: { propositionId: secret, verdict: 'false', supersedesId: 'old' } }])).ok, true);
  assert.equal((await f.store.getRecords({ ...f.scope, type: 'fact' })).find(record => record.id === 'old').status, 'superseded');
  assert.equal((await f.store.getCognition(f.scope))[0].attitude, 'believes');
});

test('补偿撤销推进版本，恢复前状态并保留历史', async context => {
  const f = await fixture(context);
  await f.commit([{ type: 'STATE_TRANSITION', payload: { entityId: 'sword', preState: 'hero', postState: 'sister' } }]);
  const operation = (await f.store.listOperations(f.scope))[0];
  const result = await f.store.revertOperation({ ...f.scope, operationId: operation.id, reason: '剧情修正' });
  assert.equal(result.stateVersion, 3);
  const transitions = await f.store.getRecords({ ...f.scope, type: 'transition' });
  assert.equal(transitions.length, 2);
  assert.equal(transitions.find(record => record.id === result.compensationId).postState, 'hero');
  const history = await f.store.listOperations(f.scope);
  assert.equal(history.length, 1);
  assert.equal(history[0].after.postState, 'sister');
  assert.equal(history[0].reverted, true);
  assert.equal(history[0].compensationReceipt.compensationId, result.compensationId);
});

test('文风更新防跨作品覆盖、保留未提供字段并检查版本', async context => {
  const f = await fixture(context);
  const created = await f.style.upsertStyleProfile({ ...f.scope, id: 'style', hardRules: ['第三人称'], positiveSamples: ['样本'] });
  await assert.rejects(f.style.upsertStyleProfile({ ...f.scope, id: 'style', bookId: 'other' }), { code: 'STYLE_NOT_FOUND' });
  await f.style.upsertStyleProfile({ ...f.scope, id: 'style', expectedRevision: created.revision, name: '改名' });
  assert.deepEqual((await f.style.getStyleProfiles(f.scope))[0].positiveSamples, ['样本']);
  await assert.rejects(f.style.upsertStyleProfile({ ...f.scope, id: 'style', expectedRevision: 1 }), { code: 'STYLE_VERSION_CONFLICT' });
  assert.throws(() => style.compileStyleBundle([
    { level: 'novel_narrative', hardRules: ['第三人称'], positiveSamples: [] },
    { level: 'scene_mode', targetSceneType: 'battle', hardRules: ['第一人称'] }
  ], { sceneType: 'battle' }), { code: 'STYLE_HARD_RULE_CONFLICT' });
});
