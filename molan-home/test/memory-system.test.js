'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const memorySystem = require('../lib/memory-system');
const { createNativeMemoryFixture: fixture } = require('./helpers/native-memory-fixture');

test('命题与证据模态化提取及原文锚点计算', () => {
  const text = '老者叹道：“你师父已经仙逝了。” 主角暗想难道师门真的惨遭灭顶之灾？他打算明日启程前往青云宗。';
  const { propositions, evidence } = memorySystem.extractPropositionsAndEvidence(text, {
    bookId: 'book-001',
    chapterRevisionId: 'c1_v1'
  });

  assert.ok(propositions.length >= 2, '成功提取句子命题');
  assert.ok(evidence.length >= 2, '成功提取证据');
  const dialogueEvid = evidence.find(e => e.sourceType === 'dialogue');
  assert.ok(dialogueEvid, '识别出对白证据');
  assert.equal(dialogueEvid.modality, 'claim');
  assert.ok(dialogueEvid.sourceAnchor.startOffset >= 0);
  assert.ok(evidence.some(e => e.modality === 'guess'), '识别出心理猜测');
  assert.ok(evidence.some(e => e.modality === 'plan'), '识别出计划');
});

test('世界事实裁决与人物私下认知及对外表现分离', async context => {
  const f = await fixture(context);
  const propositionId = await f.secret();
  await f.commit([
    { type: 'INSERT_FACT', payload: { id: 'dec_001', propositionId, verdict: 'true', decisionReason: '主线隐藏真相' } },
    { type: 'INSERT_COGNITION', payload: {
      id: 'cog_protagonist_01', holderEntityId: 'protagonist', targetExpressionId: propositionId,
      awareness: 'hearsay', attitude: 'disbelieves', subjectiveCertainty: 'probable', publicStance: 'feign_ignorance',
      nestedCognition: { believesOtherCharacter: { juniorSister: 'knows_truth' } }
    } }
  ]);

  const facts = await f.store.getMemory({ ...f.scope, status: 'confirmed' });
  assert.equal(facts.length, 1);
  assert.equal(facts[0].verdict, 'true');
  const cognitions = await f.store.getCognition({ ...f.scope, holderEntityId: 'protagonist' });
  assert.equal(cognitions.length, 1);
  assert.equal(cognitions[0].attitude, 'disbelieves');
  assert.equal(cognitions[0].publicStance, 'feign_ignorance');
  assert.equal(cognitions[0].nestedCognition.believesOtherCharacter.juniorSister, 'knows_truth');
});

test('四维时间系统：时序关系与因果有向无环校验', () => {
  assert.equal(memorySystem.validateTemporalRelations([
    { relationType: 'before', sourceEventId: 'ev_1', targetEventId: 'ev_2' },
    { relationType: 'before', sourceEventId: 'ev_2', targetEventId: 'ev_3' }
  ]), true, '无环时序应通过');
  assert.equal(memorySystem.validateTemporalRelations([
    { relationType: 'before', sourceEventId: 'ev_1', targetEventId: 'ev_2' },
    { relationType: 'before', sourceEventId: 'ev_2', targetEventId: 'ev_1' }
  ]), false, '因果时序成环应被检测拦截');
});

test('上下文检索装配：披露策略控制（正文写作包 vs 审校包）', async context => {
  const f = await fixture(context);
  const publicPropositionId = (await f.store.extract({ ...f.scope, text: '玉佩由师妹保管。' })).propositions[0].id;
  const secretPropositionId = (await f.store.extract({ ...f.scope, text: '密室钥匙在假山下。' })).propositions[0].id;
  await f.commit([
    { type: 'INSERT_FACT', payload: { id: 'd_pub', propositionId: publicPropositionId, verdict: 'true' } },
    { type: 'INSERT_FACT', payload: { id: 'd_sec', propositionId: secretPropositionId, verdict: 'true' } },
    { type: 'SET_DISCLOSURE', payload: { id: 'pol_1', targetInfoId: secretPropositionId, policyType: 'hide' } }
  ]);

  const manifest = await f.store.assembleContext({ ...f.scope, stateVersion: 2 });
  assert.ok(manifest.id.startsWith('manif_'));
  assert.equal(manifest.writingPackage.facts.some(fact => fact.propositionId === secretPropositionId), false,
    '正文写作包绝不泄露隐藏事实');
  assert.equal(manifest.writingPackage.facts.some(fact => fact.propositionId === publicPropositionId), true,
    '允许披露的事实成功入包');
  assert.equal(manifest.auditPackage.facts.some(fact => fact.propositionId === secretPropositionId), true,
    '审校包保留隐藏真相用于逻辑审核');
});

test('改写合同合规检查（锁定命题与禁止披露防线）', async context => {
  const f = await fixture(context);
  const contract = {
    bookId: f.scope.bookId,
    lockedPropositions: ['天外飞仙剑谱仍在怀中'],
    disclosureBoundary: { forbiddenAnswers: ['掌门是杀父仇人'] }
  };
  const compliantText = '他深吸一口气，天外飞仙剑谱仍在怀中温热。他没有对掌门显露任何异样神色。';
  const resultPass = await f.store.rewrite({ ...f.scope, contract, candidateText: compliantText });
  assert.equal(resultPass.compliant, true);

  const violatingText = '他把怀里的秘籍扔了，脱口怒喝道：“原来掌门是杀父仇人！”';
  const resultFail = await f.store.rewrite({ ...f.scope, contract, candidateText: violatingText });
  assert.equal(resultFail.compliant, false);
  assert.ok(resultFail.violations.length >= 2, '同时拦截了核心命题丢失与禁止披露泄密');
});

test('变更集审批、原子事务提交、Outbox 任务写入与补偿性撤销', async context => {
  const f = await fixture(context);
  await f.commit([]);
  await f.commit([]);
  const state = await f.store.workbenchState(f.scope);
  assert.equal(state.stateVersion, 3);
  const changeset = await f.store.createChangeset({
    ...f.scope, baseStateVersion: state.stateVersion,
    operations: [{ type: 'STATE_TRANSITION', payload: {
      id: 'trans_001', entityId: 'item_sword', dimension: 'possession',
      preState: 'protagonist', postState: 'junior_sister'
    } }]
  });

  await assert.rejects(f.store.commitChangeset({ ...f.scope, changesetId: changeset.id }), { code: 'changeset_not_approved' });
  const approval = await f.store.approveChangeset({ ...f.scope, changesetId: changeset.id });
  assert.equal(approval.ok, true);
  const commitResult = await f.store.commitChangeset({ ...f.scope, changesetId: changeset.id });
  assert.equal(commitResult.ok, true);
  assert.equal(commitResult.stateVersion, 4);

  const transition = (await f.store.getRecords({ ...f.scope, type: 'transition' }))
    .find(record => record.id === 'trans_001');
  assert.ok(transition);
  assert.equal(transition.postState, 'junior_sister');
  const outbox = (await f.state()).branches.main.outbox.find(job => job.eventId === changeset.id);
  assert.ok(outbox);
  assert.equal(outbox.stateVersion, 4);
  assert.equal(outbox.status, 'queued');

  const replay = await f.store.commitChangeset({ ...f.scope, changesetId: changeset.id });
  assert.equal(replay.ok, true);
  assert.equal(replay.replayed, true);
  const operation = (await f.store.listOperations(f.scope)).find(row => row.changesetId === changeset.id);
  assert.ok(operation);
  const reverted = await f.store.revertOperation({
    ...f.scope, operationId: operation.id, reason: '作者决定重构剧情'
  });
  assert.equal(reverted.ok, true);
  assert.ok(reverted.compensationId);
  await assert.rejects(f.store.revertOperation({ ...f.scope, operationId: operation.id }), { code: 'already_reverted' });
});

test('修改影响分析与投影一致性校验器', async context => {
  const f = await fixture(context);
  const propositionId = (await f.store.extract({ ...f.scope, text: '门派秘宝属于宗门。' })).propositions[0].id;
  await f.commit([{ type: 'INSERT_FACT', payload: { id: 'dec_old', propositionId, verdict: 'true' } }]);
  await f.commit([
    { type: 'INSERT_FACT', payload: { id: 'dec_new', propositionId, verdict: 'false', supersedesId: 'dec_old' } },
    { type: 'STATE_TRANSITION', payload: {
      id: 'tr_1', entityId: 'item_token', dimension: 'possession', preState: 'dec_old', postState: 'new_holder'
    } }
  ]);

  const impact = await f.store.analyzeImpact({ ...f.scope, targetId: 'dec_old', modifiedType: 'fact' });
  assert.equal(impact.bookId, f.scope.bookId);
  assert.ok(impact.totalImpactCount >= 2, '检测到明确依赖和潜在影响');
  assert.ok(impact.explicitImpacts.some(item => item.type === 'SUPERSEDED_DECISION'));
  assert.ok(impact.explicitImpacts.some(item => item.type === 'STATE_TRANSITION_BROKEN'));

  const projectionStatus = await f.store.getProjections(f.scope);
  assert.equal((await f.state()).bookId, f.scope.bookId);
  assert.ok(Number.isInteger(projectionStatus.expectedStateVersion));
});
