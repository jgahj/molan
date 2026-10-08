const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  StoryDebtLedger,
  createDebtEvent,
  reconcileChapterDebts,
  DEBT_TYPES,
  DEBT_STATUSES,
  DEBT_EVENT_TYPES,
  DEBT_PRIORITIES,
  TERMINAL_DEBT_STATUSES,
  ALLOWED_TRANSITIONS,
  StateTransitionRejectedError,
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

test('StoryDebtLedger: events.jsonl 增量日志追加落盘与跨实例确定性水合 (T-R4-01)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debt-ledger-test-pers-'));
  try {
    const ledger1 = new StoryDebtLedger({ storageDir: tmpDir, storyId: 'story_pers_test' });

    ledger1.createDebt({
      debtId: 'debt_pers_1',
      debtType: 'plot',
      summary: '黑水古殿暗门之钥',
      created_at_chapter: 1,
      creation_evidence: '李巡拾得青铜匙'
    });

    ledger1.escalateDebt('debt_pers_1', {
      chapterNo: 3,
      evidence: '暗门钥匙浮现血色铭文',
      notes: '危机升级'
    });

    ledger1.partiallyPayDebt('debt_pers_1', {
      chapterNo: 5,
      evidence: '开启外层石门',
      notes: '外层闭环'
    });

    // 检查磁盘 events.jsonl 文件
    const eventsFile = path.join(tmpDir, 'story_pers_test.events.jsonl');
    assert.ok(fs.existsSync(eventsFile), 'events.jsonl 必须落盘');
    const lines = fs.readFileSync(eventsFile, 'utf8').trim().split('\n');
    assert.equal(lines.length, 3);
    const parsedLine1 = JSON.parse(lines[0]);
    assert.equal(parsedLine1.debtId, 'debt_pers_1');
    assert.equal(parsedLine1.eventType, 'CREATED');

    // 全新实例化 ledger2，验证确定性状态水合
    const ledger2 = new StoryDebtLedger({ storageDir: tmpDir, storyId: 'story_pers_test' });
    assert.equal(ledger2.getEventStream().length, 3);
    const hydratedDebt = ledger2.getDebt('debt_pers_1');
    assert.deepEqual(hydratedDebt, ledger1.getDebt('debt_pers_1'));
    assert.equal(hydratedDebt.status, 'partially_paid');
    assert.equal(hydratedDebt.event_count, 3);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('StoryDebtLedger: 快照原子生成与增量尾部日志重放 (Snapshot + Tail Replay) (T-R4-02)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debt-ledger-test-snap-'));
  try {
    const ledger1 = new StoryDebtLedger({
      storageDir: tmpDir,
      storyId: 'story_snapshot_test',
      snapshotInterval: 50
    });

    ledger1.createDebt({
      debtId: 'debt_snap_1',
      debtType: 'character',
      summary: '李巡的假身份掩饰',
      created_at_chapter: 2
    });

    ledger1.escalateDebt('debt_snap_1', {
      chapterNo: 4,
      notes: '身份被同门怀疑'
    });

    // 手动触发原子快照
    const snapshot = ledger1.saveSnapshot();
    assert.ok(snapshot);
    assert.equal(snapshot.eventCount, 2);

    const snapshotFile = path.join(tmpDir, 'story_snapshot_test.snapshot.json');
    assert.ok(fs.existsSync(snapshotFile), 'snapshot.json 必须存在');
    const snapshotContent = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
    assert.equal(snapshotContent.eventCount, 2);
    assert.equal(snapshotContent.debts.length, 1);
    assert.equal(snapshotContent.debts[0].status, 'developing');

    // 快照后追加 2 条增量尾部事件
    ledger1.partiallyPayDebt('debt_snap_1', {
      chapterNo: 6,
      notes: '向掌门澄清误会'
    });
    ledger1.payDebt('debt_snap_1', {
      chapterNo: 8,
      notes: '身份彻底公布恢复原身'
    });

    assert.equal(ledger1.getEventStream().length, 4);
    assert.equal(ledger1.getDebt('debt_snap_1').status, 'paid');

    // 实例化新 Ledger，验证先加载快照后只重放尾部增量事件
    const ledger2 = new StoryDebtLedger({ storageDir: tmpDir, storyId: 'story_snapshot_test' });
    assert.equal(ledger2.getEventStream().length, 4);
    const restoredDebt = ledger2.getDebt('debt_snap_1');
    assert.deepEqual(restoredDebt, ledger1.getDebt('debt_snap_1'));
    assert.equal(restoredDebt.status, 'paid');
    assert.equal(restoredDebt.event_count, 4);

    const explain = ledger2.explainDebt('debt_snap_1');
    assert.equal(explain.isResolved, true);
    assert.equal(explain.totalEvents, 4);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('StoryDebtLedger: 复合幂等键防重与冲突异常拦截 (story_id + idempotency_key / event_id) (T-R4-03)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debt-ledger-test-idem-'));
  try {
    const ledger = new StoryDebtLedger({ storageDir: tmpDir, storyId: 'story_idem_test' });

    ledger.createDebt({
      debtId: 'debt_idem_1',
      summary: '宿命之约',
      idempotencyKey: 'idem_key_unique_001'
    });

    // 重复提交相同 idempotencyKey 应被严格拦截并抛出 ERR_DUPLICATE_IDEMPOTENCY_KEY
    assert.throws(() => {
      ledger.createDebt({
        debtId: 'debt_idem_1',
        summary: '宿命之约重试',
        idempotencyKey: 'idem_key_unique_001'
      });
    }, (err) => {
      assert.equal(err.code, 'ERR_DUPLICATE_IDEMPOTENCY_KEY');
      assert.equal(err.idempotencyKey, 'idem_key_unique_001');
      assert.equal(err.storyId, 'story_idem_test');
      return true;
    });

    // 显式 eventId 重复提交也应被拦截
    ledger.escalateDebt('debt_idem_1', {
      eventId: 'dbevt_fixed_999',
      notes: '加深因果'
    });

    assert.throws(() => {
      ledger.escalateDebt('debt_idem_1', {
        eventId: 'dbevt_fixed_999',
        notes: '重复重试'
      });
    }, (err) => {
      assert.equal(err.code, 'ERR_DUPLICATE_IDEMPOTENCY_KEY');
      assert.equal(err.eventId, 'dbevt_fixed_999');
      return true;
    });

    // 异构故事 story_id 下相同 key 不应冲突 (compound key 隔离性)
    const otherStoryLedger = new StoryDebtLedger({ storageDir: tmpDir, storyId: 'story_other_test' });
    const otherDebt = otherStoryLedger.createDebt({
      debtId: 'debt_other_1',
      summary: '另一本书的伏笔',
      idempotencyKey: 'idem_key_unique_001'
    });
    assert.equal(otherDebt.debt_id, 'debt_other_1');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('StoryDebtLedger: 跨进程实例化/重启后历史幂等键不丢失 (T-R4-04)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debt-ledger-test-restart-'));
  try {
    const ledger1 = new StoryDebtLedger({ storageDir: tmpDir, storyId: 'story_restart_test' });

    ledger1.createDebt({
      debtId: 'debt_restart_1',
      summary: '重启记忆伏笔',
      idempotencyKey: 'idem_persisted_key_888'
    });

    // 模拟进程退出与新实例重启
    const ledger2 = new StoryDebtLedger({ storageDir: tmpDir, storyId: 'story_restart_test' });

    // 重启后尝试再次写入相同幂等键，必须依然被拦截
    assert.throws(() => {
      ledger2.recordEvent({
        debtId: 'debt_restart_1',
        eventType: 'ESCALATED',
        idempotencyKey: 'idem_persisted_key_888',
        notes: '网络重试事件'
      });
    }, (err) => {
      assert.equal(err.code, 'ERR_DUPLICATE_IDEMPOTENCY_KEY');
      assert.equal(err.idempotencyKey, 'idem_persisted_key_888');
      return true;
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('StoryDebtLedger & Reconciliation: proposeResolution 状态跃迁与两阶段确权闭环 (T-R5-01)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debt-ledger-test-r5-'));
  try {
    const ledger = new StoryDebtLedger({ storageDir: tmpDir, storyId: 'story_r5_guard' });

    ledger.createDebt({
      debtId: 'debt_sword_mystery',
      debtType: 'character',
      summary: '佩剑铸印真相',
      target_entity_id: '李巡',
      created_at_chapter: 10
    });

    // 阶段 1：正文启发式检出 -> 必须降级为 proposed_resolution，严禁直接为 paid
    const draftText = '雷雨夜，李巡终于说出隐瞒多年的佩剑铸印真相，师妹冷眼旁观。';
    const recon1 = reconcileChapterDebts({
      ledger,
      chapterNo: 11,
      draftText
    });

    assert.equal(recon1.reconciledCount, 1);
    const candidateDebt = ledger.getDebt('debt_sword_mystery');
    assert.equal(candidateDebt.status, 'proposed_resolution');
    assert.ok(candidateDebt.payoff_evidence.includes('终于说出'));

    // 审计说明验证：候选解决提议尚未 resolved
    const explain1 = ledger.explainDebt('debt_sword_mystery');
    assert.equal(explain1.isResolved, false);
    assert.ok(explain1.auditStatement.includes('PROPOSED_RESOLUTION'));

    // 阶段 2：显式声明 (declaredResolutions) 最终确权闭环 -> paid
    const recon2 = reconcileChapterDebts({
      ledger,
      chapterNo: 12,
      declaredResolutions: [
        {
          debtId: 'debt_sword_mystery',
          action: 'PAID',
          evidence: '李巡向掌门彻底交出佩剑并认错',
          notes: '作者确认伏笔正式闭环'
        }
      ]
    });

    assert.equal(recon2.reconciledCount, 1);
    const finalDebt = ledger.getDebt('debt_sword_mystery');
    assert.equal(finalDebt.status, 'paid');
    assert.ok(finalDebt.payoff_evidence.includes('彻底交出佩剑'));

    const explain2 = ledger.explainDebt('debt_sword_mystery');
    assert.equal(explain2.isResolved, true);
    assert.ok(explain2.auditStatement.includes('PROPOSED_RESOLUTION'));
    assert.ok(explain2.auditStatement.includes('PAID'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('DebtReconciliation: 形式语义验证 (semanticVerification) 直接确权闭环 (T-R5-02)', () => {
  const ledger = new StoryDebtLedger({ storyId: 'story_semantic_test' });

  ledger.createDebt({
    debtId: 'debt_elder_seal',
    debtType: 'world',
    summary: '后山禁地长老封印异动',
    created_at_chapter: 5
  });

  // 形式语义验证通道确权
  const reconResult = reconcileChapterDebts({
    ledger,
    chapterNo: 8,
    draftText: '李巡静静走在山道上。',
    semanticVerification: [
      {
        debtId: 'debt_elder_seal',
        verified: true,
        evidence: '语义审计确认封印已被重新加固且因果解除',
        notes: '形式语义验证形式化推理通过'
      }
    ]
  });

  assert.equal(reconResult.reconciledCount, 1);
  const debt = ledger.getDebt('debt_elder_seal');
  assert.equal(debt.status, 'paid');
  assert.ok(debt.payoff_evidence.includes('语义审计确认封印已被重新加固'));

  const explain = ledger.explainDebt('debt_elder_seal');
  assert.equal(explain.isResolved, true);
  assert.equal(explain.timeline[1].operator, 'semantic_verification');
});

test('DebtEvent: 顶层 idempotencyKey 提取与校验 (T-R4-05)', () => {
  const event1 = createDebtEvent({
    debtId: 'debt_event_test',
    idempotencyKey: 'key_camel_123'
  });
  assert.equal(event1.idempotencyKey, 'key_camel_123');

  const event2 = createDebtEvent({
    debtId: 'debt_event_test',
    idempotency_key: 'key_snake_456'
  });
  assert.equal(event2.idempotencyKey, 'key_snake_456');

  const event3 = createDebtEvent({
    debtId: 'debt_event_test'
  });
  assert.equal(event3.idempotencyKey, null);

  assert.throws(() => {
    createDebtEvent({
      debtId: 'debt_event_test',
      idempotencyKey: '   '
    });
  }, /DebtEvent idempotencyKey 不能为空字符串/);
});

test('StoryDebtLedger: 规范导出与静态成员完整性 (R5: ALLOWED_TRANSITIONS, TERMINAL_DEBT_STATUSES, StateTransitionRejectedError)', () => {
  assert.equal(StoryDebtLedger.StateTransitionRejectedError, StateTransitionRejectedError);
  assert.equal(StoryDebtLedger.ALLOWED_TRANSITIONS, ALLOWED_TRANSITIONS);
  assert.equal(StoryDebtLedger.TERMINAL_DEBT_STATUSES, TERMINAL_DEBT_STATUSES);

  assert.equal(TERMINAL_DEBT_STATUSES.size, 3);
  assert.ok(TERMINAL_DEBT_STATUSES.has(DEBT_STATUSES.PAID));
  assert.ok(TERMINAL_DEBT_STATUSES.has(DEBT_STATUSES.INVALIDATED));
  assert.ok(TERMINAL_DEBT_STATUSES.has(DEBT_STATUSES.ABANDONED));

  assert.equal(ALLOWED_TRANSITIONS[DEBT_STATUSES.PAID].length, 0);
  assert.equal(ALLOWED_TRANSITIONS[DEBT_STATUSES.INVALIDATED].length, 0);
  assert.equal(ALLOWED_TRANSITIONS[DEBT_STATUSES.ABANDONED].length, 0);
});

test('StoryDebtLedger: 终态保护 (PAID, INVALIDATED, ABANDONED) 严禁所有状态跃迁并抛出 STATE_TRANSITION_REJECTED (R5)', () => {
  const ledger = new StoryDebtLedger({ storyId: 'story_terminal_unit' });

  // 1. PAID 终态测试
  ledger.createDebt({ debtId: 'd_paid', summary: '已结清测试债务' });
  ledger.payDebt('d_paid', { chapterNo: 2 });
  assert.equal(ledger.getDebt('d_paid').status, DEBT_STATUSES.PAID);

  const mutationAttempts = [
    () => ledger.proposeResolution('d_paid', { chapterNo: 3 }),
    () => ledger.escalateDebt('d_paid', { chapterNo: 3 }),
    () => ledger.reframeDebt('d_paid', { chapterNo: 3, payload: { summary: '改写' } }),
    () => ledger.partiallyPayDebt('d_paid', { chapterNo: 3 }),
    () => ledger.deferDebt('d_paid', { chapterNo: 3 }),
    () => ledger.payDebt('d_paid', { chapterNo: 3 }),
    () => ledger.invalidateDebt('d_paid', { chapterNo: 3 }),
    () => ledger.abandonDebt('d_paid', { chapterNo: 3 }),
    () => ledger.recordEvent({ debtId: 'd_paid', eventType: DEBT_EVENT_TYPES.CREATED, payload: { summary: '重建' } })
  ];

  for (const fn of mutationAttempts) {
    assert.throws(fn, (err) => {
      assert.equal(err.code, 'STATE_TRANSITION_REJECTED');
      assert.equal(err.currentStatus, DEBT_STATUSES.PAID);
      assert.equal(err.debtId, 'd_paid');
      assert.equal(err.name, 'StateTransitionRejectedError');
      return true;
    });
  }
  assert.equal(ledger.getDebt('d_paid').status, DEBT_STATUSES.PAID);

  // 2. INVALIDATED 终态测试
  ledger.createDebt({ debtId: 'd_inv', summary: '已失效测试债务' });
  ledger.invalidateDebt('d_inv', { chapterNo: 2 });
  assert.equal(ledger.getDebt('d_inv').status, DEBT_STATUSES.INVALIDATED);

  assert.throws(() => {
    ledger.payDebt('d_inv', { chapterNo: 3 });
  }, (err) => {
    assert.equal(err.code, 'STATE_TRANSITION_REJECTED');
    assert.equal(err.currentStatus, DEBT_STATUSES.INVALIDATED);
    assert.equal(err.debtId, 'd_inv');
    return true;
  });

  assert.throws(() => {
    ledger.escalateDebt('d_inv', { chapterNo: 3 });
  }, (err) => {
    assert.equal(err.code, 'STATE_TRANSITION_REJECTED');
    assert.equal(err.currentStatus, DEBT_STATUSES.INVALIDATED);
    assert.equal(err.debtId, 'd_inv');
    return true;
  });

  // 3. ABANDONED 终态测试
  ledger.createDebt({ debtId: 'd_ab', summary: '已放弃测试债务' });
  ledger.abandonDebt('d_ab', { chapterNo: 2 });
  assert.equal(ledger.getDebt('d_ab').status, DEBT_STATUSES.ABANDONED);

  assert.throws(() => {
    ledger.payDebt('d_ab', { chapterNo: 3 });
  }, (err) => {
    assert.equal(err.code, 'STATE_TRANSITION_REJECTED');
    assert.equal(err.currentStatus, DEBT_STATUSES.ABANDONED);
    assert.equal(err.debtId, 'd_ab');
    return true;
  });

  assert.throws(() => {
    ledger.escalateDebt('d_ab', { chapterNo: 3 });
  }, (err) => {
    assert.equal(err.code, 'STATE_TRANSITION_REJECTED');
    assert.equal(err.currentStatus, DEBT_STATUSES.ABANDONED);
    assert.equal(err.debtId, 'd_ab');
    return true;
  });
});

test('StoryDebtLedger: 非终态非法回退至 OPEN 受到严密拦截 (R5)', () => {
  const ledger = new StoryDebtLedger({ storyId: 'story_regression_unit' });
  ledger.createDebt({ debtId: 'd_reg', summary: '推进中债务' });
  ledger.escalateDebt('d_reg', { chapterNo: 2 });
  assert.equal(ledger.getDebt('d_reg').status, DEBT_STATUSES.DEVELOPING);

  assert.throws(() => {
    ledger.recordEvent({
      debtId: 'd_reg',
      eventType: DEBT_EVENT_TYPES.CREATED,
      payload: { summary: '非法回退到OPEN' }
    });
  }, (err) => {
    assert.equal(err.code, 'STATE_TRANSITION_REJECTED');
    assert.equal(err.currentStatus, DEBT_STATUSES.DEVELOPING);
    assert.equal(err.debtId, 'd_reg');
    return true;
  });

  assert.equal(ledger.getDebt('d_reg').status, DEBT_STATUSES.DEVELOPING);
});

test('StoryDebtLedger: StateTransitionRejectedError 错误对象字段契约完整性 (R5)', () => {
  const ledger = new StoryDebtLedger({ storyId: 'story_err_contract_unit' });
  ledger.createDebt({ debtId: 'd_contract', summary: '契约完整性测试' });
  ledger.payDebt('d_contract', { chapterNo: 2 });

  try {
    ledger.escalateDebt('d_contract', { chapterNo: 3 });
    assert.fail('Should have thrown StateTransitionRejectedError');
  } catch (err) {
    assert.ok(err instanceof StateTransitionRejectedError);
    assert.ok(err instanceof Error);
    assert.equal(err.name, 'StateTransitionRejectedError');
    assert.equal(err.code, 'STATE_TRANSITION_REJECTED');
    assert.equal(err.debtId, 'd_contract');
    assert.equal(err.currentStatus, DEBT_STATUSES.PAID);
    assert.equal(err.targetStatus, DEBT_STATUSES.DEVELOPING);
    assert.equal(err.eventType, DEBT_EVENT_TYPES.ESCALATED);
    assert.equal(err.storyId, 'story_err_contract_unit');
    assert.ok(/STATE_TRANSITION_REJECTED/.test(err.message));
  }
});

test('DebtReconciliation: 已结清 (PAID) 债务在 declaredResolutions 与 semanticVerification 中重复结算保持幂等不崩溃 (R5)', () => {
  const ledger = new StoryDebtLedger({ storyId: 'story_recon_repeat_unit' });
  ledger.createDebt({ debtId: 'd_already_paid', summary: '已结清债务' });
  ledger.payDebt('d_already_paid', { chapterNo: 2 });
  assert.equal(ledger.getDebt('d_already_paid').status, DEBT_STATUSES.PAID);

  // 1. declaredResolutions 重复声明 PAID 不抛错，幂等跳过
  const report1 = reconcileChapterDebts({
    ledger,
    chapterNo: 3,
    declaredResolutions: [{ debtId: 'd_already_paid', action: 'PAID' }]
  });
  assert.equal(report1.reconciledCount, 0);

  // 2. semanticVerification 通道重复验证已 PAID 债务不抛错，幂等跳过
  const report2 = reconcileChapterDebts({
    ledger,
    chapterNo: 4,
    semanticVerification: [{ debtId: 'd_already_paid', verified: true, evidence: '重复语义确权' }]
  });
  assert.equal(report2.reconciledCount, 0);

  // 3. 终态依然保持 PAID
  assert.equal(ledger.getDebt('d_already_paid').status, DEBT_STATUSES.PAID);
});
