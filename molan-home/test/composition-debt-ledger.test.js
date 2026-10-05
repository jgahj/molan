'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  StoryDebtLedger,
  createDebtEvent,
  DEBT_TYPES,
  DEBT_STATUSES,
  DEBT_EVENT_TYPES,
  DEBT_PRIORITIES,
  normalizeDebtType,
  normalizeDebtStatus
} = require('../lib/composition/debt');

test('StoryDebtLedger: 规范化 7 维底层债务类型与向前兼容别名映射', () => {
  assert.equal(normalizeDebtType('plot'), DEBT_TYPES.PLOT);
  assert.equal(normalizeDebtType('plot_debt'), DEBT_TYPES.PLOT);
  assert.equal(normalizeDebtType('hook'), DEBT_TYPES.HOOK);
  assert.equal(normalizeDebtType('hook_debt'), DEBT_TYPES.HOOK);
  assert.equal(normalizeDebtType('character'), DEBT_TYPES.CHARACTER);
  assert.equal(normalizeDebtType('character_debt'), DEBT_TYPES.CHARACTER);
  assert.equal(normalizeDebtType('information'), DEBT_TYPES.INFORMATION);
  assert.equal(normalizeDebtType('info_debt'), DEBT_TYPES.INFORMATION);
  assert.equal(normalizeDebtType('relationship'), DEBT_TYPES.RELATIONSHIP);
  assert.equal(normalizeDebtType('world'), DEBT_TYPES.WORLD);
  assert.equal(normalizeDebtType('world_debt'), DEBT_TYPES.WORLD);
  assert.equal(normalizeDebtType('reader_expectation'), DEBT_TYPES.READER_EXPECTATION);
  assert.equal(normalizeDebtType('reader_promise'), DEBT_TYPES.READER_EXPECTATION);

  assert.equal(normalizeDebtStatus('active'), DEBT_STATUSES.OPEN);
  assert.equal(normalizeDebtStatus('deepened'), DEBT_STATUSES.DEVELOPING);
  assert.equal(normalizeDebtStatus('resolved'), DEBT_STATUSES.PAID);
  assert.equal(normalizeDebtStatus('partially_resolved'), DEBT_STATUSES.PARTIALLY_PAID);
});

test('StoryDebtLedger: 不可变 DebtEvent 校验与防篡改', () => {
  assert.throws(() => createDebtEvent({}), /DebtEvent 必须具备 debtId/);
  assert.throws(() => createDebtEvent({ debtId: 'd1', eventType: 'INVALID_OP' }), /非法的债务事件类型/);

  const event = createDebtEvent({
    debtId: 'debt_ch21_secret',
    eventType: 'CREATED',
    chapterNo: 21,
    evidence: '李巡悄然藏匿半枚焦黑古钱',
    notes: '产生 CharacterDebt',
    payload: { weight: 0.7 }
  });

  assert.equal(event.schemaVersion, 'debt-event-v1');
  assert.equal(event.debtId, 'debt_ch21_secret');
  assert.equal(event.eventType, 'CREATED');
  assert.equal(event.chapterNo, 21);
  assert.equal(Object.isFrozen(event), true);
  assert.equal(Object.isFrozen(event.payload), true);
});

test('StoryDebtLedger: 债务全生命周期演进 (Created -> Escalated -> Reframed -> Partially Paid -> Paid)', () => {
  const ledger = new StoryDebtLedger({ storyId: 'story_molan_01' });

  // 1. Chapter 21: 产生 CharacterDebt
  const debt = ledger.createDebt({
    debtId: 'debt_token_21',
    debtType: 'character',
    summary: '李巡对师妹隐瞒了佩剑铸印与焦黑古钱的真相',
    created_at_chapter: 21,
    expected_payoff_from: 25,
    expected_payoff_to: 29,
    priority: 'high',
    weight: 0.6,
    target_entity_id: 'char_lixun',
    creation_evidence: '第21章于床榻暗格中藏入焦黑古钱'
  }, {
    chapterNo: 21,
    operator: 'author'
  });

  assert.equal(debt.debt_id, 'debt_token_21');
  assert.equal(debt.debt_type, 'character');
  assert.equal(debt.status, 'open');
  assert.equal(debt.created_at_chapter, 21);
  assert.equal(debt.event_count, 1);

  // 2. Chapter 23: 加深 (ESCALATED)
  ledger.escalateDebt('debt_token_21', {
    chapterNo: 23,
    evidence: '师妹在暗格旁发现松动木屑，李巡强行转移话题',
    notes: '怀疑萌生，冲突加深'
  });

  let snapshot = ledger.getDebt('debt_token_21');
  assert.equal(snapshot.status, 'developing');
  assert.equal(snapshot.event_count, 2);
  assert.equal(snapshot.last_touched_chapter, 23);
  assert.ok(snapshot.weight >= 0.7);

  // 3. Chapter 25: 部分解释 (PARTIALLY_PAID)
  ledger.partiallyPayDebt('debt_token_21', {
    chapterNo: 25,
    evidence: '李巡向师妹承认佩剑曾被魔修经手，但仍隐瞒古钱来源',
    notes: '佩剑铸印疑云解开，古钱仍悬而未决'
  });

  snapshot = ledger.getDebt('debt_token_21');
  assert.equal(snapshot.status, 'partially_paid');
  assert.equal(snapshot.event_count, 3);
  assert.equal(snapshot.last_touched_chapter, 25);
  assert.ok(snapshot.payoff_evidence.includes('佩剑曾被魔修经手'));

  // 4. Chapter 29: 完全偿还 (PAID)
  ledger.payDebt('debt_token_21', {
    chapterNo: 29,
    evidence: '宗门后山寒潭前，李巡交出古钱，道出全盘真相',
    notes: '秘密彻底解开，人物因果闭环'
  });

  snapshot = ledger.getDebt('debt_token_21');
  assert.equal(snapshot.status, 'paid');
  assert.equal(snapshot.event_count, 4);
  assert.equal(snapshot.last_touched_chapter, 29);
  assert.ok(snapshot.payoff_evidence.includes('交出古钱'));

  // 5. 确定性审计说明查询 (explainDebt)
  // 回答：“这个伏笔为什么现在被认为已经回收？”
  const audit = ledger.explainDebt('debt_token_21');
  assert.equal(audit.isResolved, true);
  assert.equal(audit.totalEvents, 4);
  assert.equal(audit.timeline.length, 4);
  assert.ok(audit.auditStatement.includes('第 21 章产生'));
  assert.ok(audit.auditStatement.includes('第 23 章【ESCALATED】'));
  assert.ok(audit.auditStatement.includes('第 25 章【PARTIALLY_PAID】'));
  assert.ok(audit.auditStatement.includes('第 29 章'));
  assert.ok(audit.auditStatement.includes('PAID'));
});

test('StoryDebtLedger: 延期 (DEFERRED)、作废 (INVALIDATED) 与放弃 (ABANDONED)', () => {
  const ledger = new StoryDebtLedger();

  ledger.createDebt({
    debtId: 'debt_exam_01',
    debtType: 'reader_expectation',
    summary: '宗门大比夺魁誓言',
    created_at_chapter: 10,
    expected_payoff_to: 20
  });

  // 延期
  ledger.deferDebt('debt_exam_01', {
    chapterNo: 19,
    deferUntilChapter: 35,
    notes: '宗门突遭魔袭，大比推迟至战后'
  });
  let d = ledger.getDebt('debt_exam_01');
  assert.equal(d.status, 'deferred');
  assert.equal(d.expected_payoff_to, 35);

  // 作废
  ledger.createDebt({
    debtId: 'debt_betrayal_01',
    debtType: 'relationship',
    summary: '大长老计划在寒潭刺杀掌教',
    created_at_chapter: 15
  });
  ledger.invalidateDebt('debt_betrayal_01', {
    chapterNo: 18,
    notes: '掌教在第18章因天劫坐化，刺杀前提已不复存在'
  });
  d = ledger.getDebt('debt_betrayal_01');
  assert.equal(d.status, 'invalidated');

  // 放弃
  ledger.createDebt({
    debtId: 'debt_side_quest',
    debtType: 'plot',
    summary: '黑市药贩的私仇支线',
    created_at_chapter: 5
  });
  ledger.abandonDebt('debt_side_quest', {
    chapterNo: 12,
    notes: '主线收紧，作者砍掉边缘支线'
  });
  d = ledger.getDebt('debt_side_quest');
  assert.equal(d.status, 'abandoned');
});

test('StoryDebtLedger: 事件回放确定性 (Replay Determinism) 与快照恢复', () => {
  const ledger1 = new StoryDebtLedger({ storyId: 'story_replay' });

  ledger1.createDebt({ debtId: 'd_1', debtType: 'hook', summary: '门外的轻微叩门声', created_at_chapter: 1 });
  ledger1.escalateDebt('d_1', { chapterNo: 2, notes: '第二声叩门带着血迹' });
  ledger1.payDebt('d_1', { chapterNo: 3, evidence: '推门发现重伤的同门师兄' });

  const events = ledger1.getEventStream();
  assert.equal(events.length, 3);

  // 用相同事件流在全新 Ledger 上回放
  const ledger2 = new StoryDebtLedger({ storyId: 'story_replay' });
  ledger2.replay(events);

  assert.deepEqual(ledger2.getDebt('d_1'), ledger1.getDebt('d_1'));
  assert.equal(ledger2.getDebt('d_1').status, 'paid');

  // JSON 导出恢复
  const serialized = JSON.stringify(ledger1.toJSON());
  const restored = StoryDebtLedger.fromJSON(JSON.parse(serialized));
  assert.deepEqual(restored.getDebt('d_1'), ledger1.getDebt('d_1'));
});
