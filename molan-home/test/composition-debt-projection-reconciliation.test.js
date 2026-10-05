'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  StoryDebtLedger,
  projectDebtsForChapter,
  reconcileChapterDebts,
  DEBT_TYPES,
  DEBT_STATUSES,
  DEBT_EVENT_TYPES
} = require('../lib/composition/debt');

const contentEngine = require('../lib/generation/content-engine');
const { defaultProfileRegistry } = require('../lib/composition/profiles/profile-registry');

test('DebtProjection: 50条债务压缩至当前章节最相关的 8 条，彻底避免模型注意力稀释', () => {
  const ledger = new StoryDebtLedger({ storyId: 'story_big_ledger' });

  // 批量注入 50 条各类生命周期债务
  for (let i = 1; i <= 50; i++) {
    const isOverdue = i === 1 || i === 2; // 第1、2条逾期
    const isDueSoon = i >= 3 && i <= 8; // 第3~8条在第118章窗口期内
    const isChar = i === 9 || i === 10;
    const isHook = i === 11 || i === 12;

    ledger.createDebt({
      debtId: `debt_bulk_${i}`,
      debtType: isHook ? 'hook' : (isChar ? 'character' : (i % 2 === 0 ? 'plot' : 'information')),
      summary: isChar ? `李巡在暗巷遗失的密信_${i}` : `伏笔事件编号_${i}`,
      target_entity_id: isChar ? '李巡' : `npc_${i}`,
      created_at_chapter: isOverdue ? 90 : (isDueSoon ? 112 : 110),
      expected_payoff_from: isOverdue ? 100 : (isDueSoon ? 116 : 130),
      expected_payoff_to: isOverdue ? 110 : (isDueSoon ? 122 : 150),
      priority: isOverdue ? 'critical' : (i === 3 ? 'high' : 'normal'),
      weight: 0.5
    });
  }

  assert.equal(ledger.getOpenDebts().length, 50);

  // 为第 118 章执行债务投影，聚焦主角 李巡
  const chapterProjection = projectDebtsForChapter(ledger, {
    currentChapter: 118,
    activeCharacters: ['李巡'],
    maxDebts: 8
  });

  assert.equal(chapterProjection.currentChapter, 118);
  assert.equal(chapterProjection.totalOpenDebts, 50);
  assert.equal(chapterProjection.selectedDebtsCount, 8);
  assert.equal(chapterProjection.debtsToAddress.length, 8);

  // 检查分层投影结构
  const p = chapterProjection.projection;
  assert.ok(Array.isArray(p.urgent));
  assert.ok(Array.isArray(p.dueSoon));
  assert.ok(Array.isArray(p.activeCharacterDebts));
  assert.ok(Array.isArray(p.openHooks));
  assert.ok(Array.isArray(p.longTermForeshadows));

  // 逾期债务必须进入 urgent
  assert.ok(p.urgent.some(u => u.debtId === 'debt_bulk_1' || u.debtId === 'debt_bulk_2'));

  // 出场人物匹配的债务必须被精准捕获
  assert.ok(p.activeCharacterDebts.some(c => c.debtId === 'debt_bulk_9' || c.debtId === 'debt_bulk_10'));

  // 生成的提示词指引必须精炼有效
  assert.ok(chapterProjection.promptGuidance.includes('【本章叙事债务快照·第 118 章】'));
  assert.ok(chapterProjection.promptGuidance.includes('总待偿债务 50 条，精选聚焦 8 条'));
  assert.ok(chapterProjection.promptGuidance.includes('【到期与紧急债务 (Urgent)】'));
});

test('DebtReconciliation: 章节生成后对账闭环 (显式结算 + 证据启发式核销 + 新钩子入账)', () => {
  const ledger = new StoryDebtLedger({ storyId: 'story_reconcile_test' });

  // 1. 初始建立两条债务
  ledger.createDebt({
    debtId: 'debt_reconcile_1',
    debtType: 'plot',
    summary: '夺取黑煞令并交还宗门掌教',
    created_at_chapter: 10,
    expected_payoff_to: 15
  });

  ledger.createDebt({
    debtId: 'debt_reconcile_2',
    debtType: 'character',
    summary: '李巡对身世玉佩的秘密',
    created_at_chapter: 12,
    expected_payoff_to: 20
  });

  // 模拟章节生成后正文，包含了对身世玉佩的解开动词
  const draftText = `
长阶夜深，风声如咽。
李巡深吸一口气，从怀中摸出温热的古玉，终于说出当年藏在玉佩夹层里的族谱血书。
值守长老看罢血书，神色大变。
章末异变：古池底部忽然传来一声低沉龙吟，水波暴卷！
  `.trim();

  // 2. 模拟章节对账：包含 1 条显式 PAID 声明 + 正文启发式匹配 + 1 条章末新钩子
  const reconResult = reconcileChapterDebts({
    ledger,
    chapterNo: 15,
    chapterId: 'chap_15',
    draftText,
    declaredResolutions: [
      {
        debtId: 'debt_reconcile_1',
        action: 'PAID',
        evidence: '在第15章亲手将黑煞令交还掌教案头',
        notes: '黑煞令主线任务圆满达成'
      }
    ],
    declaredDebtsToCreate: [
      {
        debtType: 'hook',
        summary: '古池底部的低沉龙吟异动',
        expectedPayoffFrom: 16,
        expectedPayoffTo: 19,
        priority: 'high',
        evidence: '古池底部忽然传来一声低沉龙吟，水波暴卷'
      }
    ]
  });

  assert.equal(reconResult.chapterNo, 15);
  assert.ok(reconResult.eventsRecorded.length >= 2);
  assert.equal(reconResult.debtsCreated.length, 1);

  // 验证 debt_reconcile_1 被显式核销
  const debt1 = ledger.getDebt('debt_reconcile_1');
  assert.equal(debt1.status, 'paid');
  assert.ok(debt1.payoff_evidence.includes('亲手将黑煞令交还'));

  // 验证 debt_reconcile_2 被正文启发式“终于说出”识别并推进至 proposed_resolution 候选提议
  const debt2 = ledger.getDebt('debt_reconcile_2');
  assert.equal(debt2.status, 'proposed_resolution');
  assert.ok(debt2.payoff_evidence.includes('终于说出'));

  // 验证新钩子被自动录入 Ledger
  const openDebts = ledger.getOpenDebts();
  assert.ok(openDebts.some(d => d.summary.includes('古池底部的低沉龙吟异动')));

  // 验证审计溯源回答：候选提议阶段尚未 resolved
  const explain = ledger.explainDebt('debt_reconcile_2');
  assert.equal(explain.isResolved, false);
  assert.ok(explain.auditStatement.includes('PROPOSED_RESOLUTION'));
});

test('Composition E2E: Content Engine 全链路贯通 Story Debt Ledger (投影 -> 编译 -> 生成 -> 对账)', async () => {
  const ledger = new StoryDebtLedger({ storyId: 'story_e2e_comp' });

  // 预先建立本章亟需呼应的债务
  ledger.createDebt({
    debtId: 'debt_token_reveal',
    debtType: 'character',
    summary: '李巡对师妹隐瞒佩剑真相',
    created_at_chapter: 12,
    expected_payoff_from: 14,
    expected_payoff_to: 18,
    priority: 'high',
    target_entity_id: '李巡'
  });

  const spec = defaultProfileRegistry.resolveCompositionSpec({
    genre: 'xuanhuan_cautious',
    style: 'laobai_restrained',
    chapterGoal: 'info_reveal',
    focus: 'dialogue_game',
    hook: 'suspense_clue',
    targetChars: 2500
  });

  // 1. compileDraftPrompt 自动挂载 storyDebtLedger，Prompt 内生成债务投影指令
  const compiled = contentEngine.compileDraftPrompt({
    compositionSpec: spec,
    storyDebtLedger: ledger,
    contract: { chapterNo: 16, chapterGoal: '信息揭露', wordBudget: { targetChars: 2500 }, characters: ['李巡'] },
    context: '前情提要：茶肆夜雨。'
  });

  assert.ok(compiled.systemPrompt.includes('【本章钩子策略'));
  assert.ok(compiled.systemPrompt.includes('李巡对师妹隐瞒佩剑真相'));
  assert.ok(compiled.systemPrompt.includes('【本章叙事债务快照·第 16 章】'));

  // 2. generateDraft 生成模拟正文并在完成时自动执行对账闭环
  const draftResult = await contentEngine.generateDraft({
    callModel: async () => ({
      text: '雨声淅沥，李巡终于说出隐瞒两年的佩剑铸印真相。师妹闻言指尖微颤，没有拔剑，只是默默后撤半步。',
      usage: { totalTokens: 150, promptTokens: 100, completionTokens: 50 }
    }),
    auth: { user: { userId: 'u_comp_ledger' } },
    request: {
      compositionSpec: spec,
      storyDebtLedger: ledger,
      chapterNo: 16,
      targetChars: 2500
    },
    contract: { chapterNo: 16, chapterId: 'ch_16', chapterGoal: '信息揭露' },
    context: '雨声淅沥。'
  });

  assert.equal(draftResult.status, 'draft_created');
  assert.ok(draftResult.debtReconciliation !== null);
  assert.ok(draftResult.debtReconciliation.reconciledCount >= 1);

  // 验证 Ledger 状态被启发式自动推进至 proposed_resolution 候选提议
  const reconciledDebt = ledger.getDebt('debt_token_reveal');
  assert.equal(reconciledDebt.status, 'proposed_resolution');
  assert.ok(reconciledDebt.payoff_evidence.includes('终于说出'));
});
