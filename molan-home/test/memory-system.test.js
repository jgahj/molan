'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const memorySystem = require('../lib/memory-system');

function createTestDatabase() {
  const db = new DatabaseSync(':memory:');
  memorySystem.initializeSchema(db);
  return db;
}

test('命题与证据模态化提取及原文锚点计算', () => {
  const text = '老者叹道：“你师父已经仙逝了。” 主角暗想难道师门真的惨遭灭顶之灾？他打算明日启程前往青云宗。';
  const { propositions, evidence } = memorySystem.extractPropositionsAndEvidence(text, {
    bookId: 'book-001',
    chapterRevisionId: 'c1_v1'
  });

  assert.ok(propositions.length >= 2, '成功提取句子命题');
  assert.ok(evidence.length >= 2, '成功提取证据');

  // 对白提取为 claim
  const dialogueEvid = evidence.find(e => e.sourceType === 'dialogue');
  assert.ok(dialogueEvid, '识别出对白证据');
  assert.equal(dialogueEvid.modality, 'claim');
  assert.ok(dialogueEvid.sourceAnchor.startOffset >= 0);

  // 心理活动提取为 guess
  const guessEvid = evidence.find(e => e.modality === 'guess');
  assert.ok(guessEvid, '识别出心理猜测');

  // 计划提取为 plan
  const planEvid = evidence.find(e => e.modality === 'plan');
  assert.ok(planEvid, '识别出计划');
});

test('世界事实裁决与人物私下认知及对外表现分离', () => {
  const db = createTestDatabase();
  const bookId = 'book-001';

  // 1. 记录客观事实裁决：师父并没有死（隐秘事实）
  db.prepare("INSERT INTO memory_propositions (id, book_id, display_text, created_at) VALUES ('prop_master_alive', 'book-001', '师父假死隐修', 1000)").run();
  memorySystem.recordDecision(db, {
    id: 'dec_001',
    bookId,
    propositionId: 'prop_master_alive',
    verdict: 'true',
    status: 'confirmed',
    decisionReason: '主线隐藏真相'
  });

  const facts = memorySystem.getMemory(db, bookId, { status: 'confirmed' });
  assert.equal(facts.length, 1);
  assert.equal(facts[0].verdict, 'true');

  // 2. 记录主角认知：误信师父已死，但对外假装承认师妹的说法
  memorySystem.recordCognition(db, {
    id: 'cog_protagonist_01',
    bookId,
    holderEntityId: 'protagonist',
    targetExpressionId: 'prop_master_alive',
    awareness: 'hearsay',
    attitude: 'disbelieves', // 私下不相信师父还活着
    subjectiveCertainty: 'probable',
    publicStance: 'feign_ignorance', // 对外装作不知道
    nestedCognition: {
      believesOtherCharacter: {
        juniorSister: 'knows_truth'
      }
    }
  });

  const cognitions = memorySystem.getCognition(db, bookId, { holderEntityId: 'protagonist' });
  assert.equal(cognitions.length, 1);
  assert.equal(cognitions[0].attitude, 'disbelieves');
  assert.equal(cognitions[0].publicStance, 'feign_ignorance');
  assert.equal(cognitions[0].nestedCognition.believesOtherCharacter.juniorSister, 'knows_truth');
});

test('四维时间系统：时序关系与因果有向无环校验', () => {
  const relationsAcyclic = [
    { relationType: 'before', sourceEventId: 'ev_1', targetEventId: 'ev_2' },
    { relationType: 'before', sourceEventId: 'ev_2', targetEventId: 'ev_3' }
  ];
  assert.equal(memorySystem.validateTemporalRelations(relationsAcyclic), true, '无环时序应通过');

  const relationsCyclic = [
    { relationType: 'before', sourceEventId: 'ev_1', targetEventId: 'ev_2' },
    { relationType: 'before', sourceEventId: 'ev_2', targetEventId: 'ev_1' }
  ];
  assert.equal(memorySystem.validateTemporalRelations(relationsCyclic), false, '因果时序成环应被检测拦截');
});

test('上下文检索装配：披露策略控制（正文写作包 vs 审校包）', () => {
  const db = createTestDatabase();
  const bookId = 'book-001';

  // 插入公开事实和保密事实
  db.prepare("INSERT INTO memory_propositions (id, book_id, display_text, created_at) VALUES ('p_pub', 'book-001', '玉佩由师妹保管', 1000)").run();
  db.prepare("INSERT INTO memory_propositions (id, book_id, display_text, created_at) VALUES ('p_sec', 'book-001', '密室钥匙在假山下', 1000)").run();

  memorySystem.recordDecision(db, { id: 'd_pub', bookId, propositionId: 'p_pub', verdict: 'true', status: 'confirmed' });
  memorySystem.recordDecision(db, { id: 'd_sec', bookId, propositionId: 'p_sec', verdict: 'true', status: 'confirmed' });

  // 设置披露策略：隐藏密室钥匙事实
  db.prepare(`INSERT INTO disclosure_policies (
    id, book_id, target_info_id, policy_type, created_at
  ) VALUES ('pol_1', 'book-001', 'p_sec', 'hide', 1000)`).run();

  const manifest = memorySystem.assembleContext(db, bookId, { stateVersion: 1 });
  assert.ok(manifest.id.startsWith('manif_'));

  // 正文写作包应过滤隐藏事实
  const writingFacts = manifest.writingPackage.facts;
  assert.equal(writingFacts.some(f => f.propositionId === 'p_sec'), false, '正文写作包绝不泄露隐藏事实');
  assert.equal(writingFacts.some(f => f.propositionId === 'p_pub'), true, '允许披露的事实成功入包');

  // 审校包应保留完整真相
  const auditFacts = manifest.auditPackage.facts;
  assert.equal(auditFacts.some(f => f.propositionId === 'p_sec'), true, '审校包保留隐藏真相用于逻辑审核');
});

test('改写合同合规检查（锁定命题与禁止披露防线）', () => {
  const db = createTestDatabase();
  const contract = memorySystem.createRewriteContract(db, {
    bookId: 'book-001',
    lockedPropositions: ['天外飞仙剑谱仍在怀中'],
    disclosureBoundary: {
      forbiddenAnswers: ['掌门是杀父仇人']
    }
  });

  const compliantText = '他深吸一口气，天外飞仙剑谱仍在怀中温热。他没有对掌门显露任何异样神色。';
  const resultPass = memorySystem.verifyRewriteContractCompliance(contract, compliantText);
  assert.equal(resultPass.passed, true);

  const violatingText = '他把怀里的秘籍扔了，脱口怒喝道：“原来掌门是杀父仇人！”';
  const resultFail = memorySystem.verifyRewriteContractCompliance(contract, violatingText);
  assert.equal(resultFail.passed, false);
  assert.ok(resultFail.violations.length >= 2, '同时拦截了核心命题丢失与禁止披露泄密');
});

test('变更集审批、原子事务提交、Outbox 任务写入与补偿性撤销', () => {
  const db = createTestDatabase();
  const bookId = 'book-001';
  db.prepare('INSERT INTO memory_branch_heads VALUES (?, ?, ?)').run(bookId, 'main', 3);

  // 1. 创建变更集
  const changeset = memorySystem.createChangeset(db, {
    bookId,
    baseStateVersion: 3,
    candidateHash: 'hash-abc-123',
    operations: [
      {
        type: 'STATE_TRANSITION',
        payload: {
          id: 'trans_001',
          entityId: 'item_sword',
          dimension: 'possession',
          preState: 'protagonist',
          postState: 'junior_sister'
        }
      }
    ]
  });

  // 未审批前提交应报错
  const earlyCommit = memorySystem.commitChangeset(db, bookId, changeset.id, 'author');
  assert.equal(earlyCommit.ok, false);
  assert.equal(earlyCommit.code, 'changeset_not_approved');

  // 2. 审批变更集
  const approval = memorySystem.approveChangeset(db, bookId, changeset.id, 'author', 'approved');
  assert.equal(approval.ok, true);

  // 3. 正式提交：原子事务执行、状态版本递增、写入 Outbox
  const commitRes = memorySystem.commitChangeset(db, bookId, changeset.id, 'author');
  assert.equal(commitRes.ok, true);
  assert.equal(commitRes.stateVersion, 4);

  // 验证状态转换表
  const transRow = db.prepare("SELECT * FROM state_transitions WHERE id = 'trans_001'").get();
  assert.ok(transRow);
  assert.equal(transRow.post_state, 'junior_sister');

  // 验证 Outbox 任务已排队
  const outboxRow = db.prepare("SELECT * FROM memory_outbox WHERE book_id = 'book-001'").get();
  assert.ok(outboxRow);
  assert.equal(outboxRow.state_version, 4);
  assert.equal(outboxRow.status, 'queued');

  // 4. 重放提交幂等
  const replayedCommit = memorySystem.commitChangeset(db, bookId, changeset.id, 'author');
  assert.equal(replayedCommit.ok, true);
  assert.equal(replayedCommit.replayed, true);

  // 5. 补偿性撤销 (Revert)
  const opLog = db.prepare("SELECT id FROM memory_operations_log WHERE changeset_id = ?").get(changeset.id);
  assert.ok(opLog);

  const revertRes = memorySystem.revertOperation(db, bookId, opLog.id, 'author', '作者决定重构剧情');
  assert.equal(revertRes.ok, true);
  assert.ok(revertRes.compensationId);

  // 重复撤销被拒
  const secondRevert = memorySystem.revertOperation(db, bookId, opLog.id, 'author');
  assert.equal(secondRevert.ok, false);
  assert.equal(secondRevert.code, 'already_reverted');
});

test('修改影响分析与投影一致性校验器', () => {
  const db = createTestDatabase();
  const bookId = 'book-001';

  // 准备事实与后续依赖
  db.prepare("INSERT INTO memory_propositions (id, book_id, display_text, created_at) VALUES ('prop_1', 'book-001', '门派秘宝', 500)").run();
  db.prepare("INSERT INTO world_fact_decisions (id, book_id, proposition_id, verdict, status, supersedes_id, created_at) VALUES ('dec_old', 'book-001', 'prop_1', 'true', 'confirmed', null, 1000)").run();
  db.prepare("INSERT INTO world_fact_decisions (id, book_id, proposition_id, verdict, status, supersedes_id, created_at) VALUES ('dec_new', 'book-001', 'prop_1', 'false', 'confirmed', 'dec_old', 2000)").run();
  db.prepare("INSERT INTO state_transitions (id, book_id, entity_id, dimension, pre_state, post_state, created_at) VALUES ('tr_1', 'book-001', 'item_token', 'possession', 'dec_old_holder', 'new_holder', 1500)").run();

  const impact = memorySystem.analyzeImpact(db, bookId, { targetId: 'dec_old', modifiedType: 'fact' });
  assert.ok(impact.totalImpactCount >= 2, '检测到明确依赖和潜在影响');
  assert.ok(impact.explicitImpacts.some(i => i.type === 'SUPERSEDED_DECISION'));
  assert.ok(impact.explicitImpacts.some(i => i.type === 'STATE_TRANSITION_BROKEN'));

  // 校验投影状态
  const projStatus = memorySystem.verifyProjections(db, bookId);
  assert.equal(projStatus.bookId, bookId);
  assert.ok(Number.isInteger(projStatus.expectedStateVersion));
});
