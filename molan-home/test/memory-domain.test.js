'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const memory = require('../lib/memory-system');
const workflow = require('../lib/memory-workflow');
const style = require('../lib/style-system');

function fixture(context) {
  const db = new DatabaseSync(':memory:');
  context.after(() => db.close());
  memory.initializeSchema(db);
  style.initializeSchema(db);
  db.exec("INSERT INTO memory_propositions (id, book_id, display_text, created_at) VALUES ('secret', 'book', '凶手是师父', 1)");
  return db;
}

function commit(db, operations) {
  const changeset = memory.createChangeset(db, { bookId: 'book', baseStateVersion: workflow.stateVersion(db, 'book'), operations });
  memory.approveChangeset(db, 'book', changeset.id, 'author');
  return memory.commitChangeset(db, 'book', changeset.id, 'author');
}

test('暗示包不包含隐藏答案字段，人物认知也不泄漏秘密', context => {
  const db = fixture(context);
  memory.recordDecision(db, { bookId: 'book', propositionId: 'secret' });
  memory.recordCognition(db, { bookId: 'book', holderEntityId: 'hero', targetExpressionId: 'secret' });
  assert.equal(commit(db, [{ type: 'SET_DISCLOSURE', payload: { targetInfoId: 'secret', policyType: 'imply', allowedClues: ['袖口有血迹'] } }]).ok, true);
  const manifest = memory.assembleContext(db, 'book', { povId: 'hero' });
  assert.equal(JSON.stringify(manifest.writingPackage).includes('凶手是师父'), false);
  assert.deepEqual(manifest.writingPackage.facts[0].allowedClues, ['袖口有血迹']);
  assert.equal(manifest.writingPackage.cognitions.length, 0);
  assert.ok(JSON.stringify(manifest.auditPackage).includes('凶手是师父'));
});

test('时间区间、人物知识和分支隔离生效；不足预算零清单写入', context => {
  const db = fixture(context);
  memory.recordDecision(db, { bookId: 'book', propositionId: 'secret', validIntervalStart: '0020', validIntervalEnd: '0030' });
  memory.recordCognition(db, { bookId: 'book', branchId: 'other', holderEntityId: 'hero', targetExpressionId: 'secret' });
  assert.equal(memory.getCognition(db, 'book', { holderEntityId: 'hero' }).length, 0);
  assert.equal(memory.assembleContext(db, 'book', { storyTime: '0010' }).writingPackage.facts.length, 0);
  assert.equal(memory.assembleContext(db, 'book', { storyTime: '0021', povId: 'hero' }).writingPackage.facts.length, 0);
  const before = db.prepare('SELECT count(*) AS count FROM context_manifests').get().count;
  assert.throws(() => memory.assembleContext(db, 'book', { storyTime: '0021', budgetTokens: 10 }), { code: 'CONTEXT_BUDGET_EXCEEDED' });
  assert.equal(db.prepare('SELECT count(*) AS count FROM context_manifests').get().count, before);
});

test('计划到期不自动完成，完成必须引用真实事件', context => {
  const db = fixture(context);
  assert.equal(commit(db, [{ type: 'UPSERT_PLAN', payload: { title: '去青云宗', status: 'completed' } }]).code, 'EVENT_EVIDENCE_REQUIRED');
  const result = commit(db, [
    { type: 'UPSERT_PLAN', payload: { id: 'plan', title: '去青云宗', status: 'completed', realizationEventId: 'event' } },
    { type: 'INSERT_EVENT', payload: { id: 'event', title: '抵达青云宗' } }
  ]);
  assert.equal(result.ok, true);
  assert.equal(db.prepare("SELECT status FROM story_plans WHERE id = 'plan'").get().status, 'completed');
});

test('伏笔与条件承诺不能无证据完成', context => {
  const db = fixture(context);
  assert.equal(commit(db, [{ type: 'UPSERT_FORESHADOW', payload: { title: '玉佩', status: 'resolved' } }]).code, 'PAYOFF_EVIDENCE_REQUIRED');
  assert.equal(commit(db, [{ type: 'UPSERT_COMMITMENT', payload: {
    promisorId: 'elder', promiseeId: 'hero', triggerCondition: '回来', fulfillmentContent: '告知秘密', status: 'fulfilled'
  } }]).code, 'CONDITION_EVIDENCE_REQUIRED');
});

test('时间关系同时、晚于和SQLite字段都能正确判环', context => {
  fixture(context);
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

test('相反世界裁决必须显式取代，不自动改变角色认知', context => {
  const db = fixture(context);
  memory.recordDecision(db, { id: 'old', bookId: 'book', propositionId: 'secret', verdict: 'true' });
  memory.recordCognition(db, { bookId: 'book', holderEntityId: 'hero', targetExpressionId: 'secret', attitude: 'believes' });
  assert.equal(commit(db, [{ type: 'INSERT_FACT', payload: { propositionId: 'secret', verdict: 'false' } }]).code, 'FACT_CONFLICT');
  assert.equal(commit(db, [{ type: 'INSERT_FACT', payload: { propositionId: 'secret', verdict: 'false', supersedesId: 'old' } }]).ok, true);
  assert.equal(db.prepare("SELECT status FROM world_fact_decisions WHERE id = 'old'").get().status, 'superseded');
  assert.equal(memory.getCognition(db, 'book')[0].attitude, 'believes');
});

test('补偿撤销推进版本，恢复前状态并保留历史', context => {
  const db = fixture(context);
  commit(db, [{ type: 'STATE_TRANSITION', payload: { entityId: 'sword', preState: 'hero', postState: 'sister' } }]);
  const operation = db.prepare('SELECT * FROM memory_operations_log').get();
  const result = memory.revertOperation(db, 'book', operation.id, 'author', '剧情修正');
  assert.equal(result.stateVersion, 3);
  assert.equal(db.prepare('SELECT count(*) AS count FROM state_transitions').get().count, 2);
  assert.equal(db.prepare('SELECT post_state FROM state_transitions WHERE id = ?').get(result.compensationId).post_state, 'hero');
  assert.equal(db.prepare('SELECT count(*) AS count FROM memory_record_versions').get().count, 1);
});

test('文风更新防跨作品覆盖、保留未提供字段并检查版本', context => {
  const db = fixture(context);
  const created = style.upsertStyleProfile(db, { id: 'style', bookId: 'book', hardRules: ['第三人称'], positiveSamples: ['样本'] });
  assert.throws(() => style.upsertStyleProfile(db, { id: 'style', bookId: 'other' }), { code: 'STYLE_NOT_FOUND' });
  style.upsertStyleProfile(db, { id: 'style', bookId: 'book', expectedRevision: created.revision, name: '改名' });
  assert.deepEqual(style.getStyleProfiles(db, 'book')[0].positiveSamples, ['样本']);
  assert.throws(() => style.upsertStyleProfile(db, { id: 'style', bookId: 'book', expectedRevision: 1 }), { code: 'STYLE_VERSION_CONFLICT' });
  assert.throws(() => style.compileStyleBundle([
    { level: 'novel_narrative', hardRules: ['第三人称'], positiveSamples: [] },
    { level: 'scene_mode', targetSceneType: 'battle', hardRules: ['第一人称'] }
  ], { sceneType: 'battle' }), { code: 'STYLE_HARD_RULE_CONFLICT' });
});
