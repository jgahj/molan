'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createStoryEngineProfile,
  createReaderPromiseProfile,
  createNarrativeOutcomeContract,
  createSoftFocusBudget,
  createNarrativeDebt,
  createStrategyRule,
  createChapterArchetypeProfile
} = require('../lib/composition/models/data-schemas');

const {
  evaluateDisentanglementFidelity,
  evaluateOutcomeContractFulfillment,
  evaluateStyleDistance,
  updateStrategyFeedback
} = require('../lib/composition/evaluation/composition-evaluator');

const { createGenreProfile } = require('../lib/composition/profiles/genre-profile');

test('Composition Models: StoryEngineProfile 核心驱动机制与契约约束', () => {
  assert.throws(() => createStoryEngineProfile({}), /StoryEngineProfile 必须具备唯一 id/);
  assert.throws(() => createStoryEngineProfile({ id: 'se_1' }), /StoryEngineProfile 必须具备人类可读 name/);

  const engine = createStoryEngineProfile({
    id: 'revenge_ladder',
    name: '复仇阶梯引擎',
    driveMechanism: 'revenge',
    corePacingRhythm: 'steady_spiral',
    typicalObstacles: ['旧部背叛', '强敌压制'],
    primaryPayoffType: 'competence_validation',
    forbiddenTropes: ['机械降神', '圣母饶恕']
  });

  assert.equal(engine.schemaVersion, 'story-engine-profile-v1');
  assert.equal(engine.id, 'revenge_ladder');
  assert.equal(engine.driveMechanism, 'revenge');
  assert.equal(engine.typicalObstacles.length, 2);
  assert.equal(Object.isFrozen(engine), true);
});

test('Composition Models: ReaderPromiseProfile 预期兑现与缺口机制', () => {
  assert.throws(() => createReaderPromiseProfile({}), /ReaderPromiseProfile 必须具备唯一 id/);

  const promise = createReaderPromiseProfile({
    id: 'rp_truth_uncover',
    name: '逼近悬案真相',
    coreExpectation: '每三章披露一层宗门覆灭真相',
    payoffPacing: 'cyclic_wave',
    gapGenerationMechanism: 'reveal_leads_to_larger_conspiracy'
  });

  assert.equal(promise.schemaVersion, 'reader-promise-profile-v1');
  assert.equal(promise.id, 'rp_truth_uncover');
  assert.equal(promise.payoffPacing, 'cyclic_wave');
  assert.equal(Object.isFrozen(promise), true);
});

test('Composition Models: NarrativeOutcomeContract 涵盖状态跃迁、读者预期与人物信念位移', () => {
  const contract = createNarrativeOutcomeContract({
    stateDelta: {
      stateBefore: '李巡坚信宗主为生父',
      events: ['潜入密室发现生辰八字玉佩', '比对宗门旧谱确认血缘伪造'],
      stateAfter: '李巡破除执念，认定宗主为仇家',
      invalidIfRemoved: '后续李巡反出宗门失去动机支撑'
    },
    readerEffect: {
      knowledgeDelta: '读者获知二十年前旧案真相',
      emotionalShift: '从同情宗主转向危机窒息感',
      curiosityTrigger: '生父真正身份成谜'
    },
    characterEffect: {
      beliefShift: '对师门由绝对忠诚变为全面怀疑',
      motivationDelta: '由被动受令转为暗中自保复仇',
      internalStakes: '失去宗门第一顺位庇护，沦为孤狼'
    },
    informationEffect: '解封甲级绝密卷宗'
  });

  assert.equal(contract.schemaVersion, 'narrative-outcome-contract-v1');
  assert.equal(contract.stateDelta.stateBefore.summary, '李巡坚信宗主为生父');
  assert.equal(contract.stateDelta.events.length, 2);
  assert.equal(contract.characterEffect.beliefShift, '对师门由绝对忠诚变为全面怀疑');
  assert.equal(contract.characterEffect.motivationDelta, '由被动受令转为暗中自保复仇');
  assert.equal(contract.readerEffect.emotionalShift, '从同情宗主转向危机窒息感');
  assert.equal(Object.isFrozen(contract), true);
});

test('Composition Models: SoftFocusBudget 阶梯倾向与软浮动区间', () => {
  const budget = createSoftFocusBudget({
    dominant: ['action', 'conflict'],
    supporting: ['dialogue'],
    optional: ['setting'],
    forbidden: ['emotion'],
    ranges: {
      action: [0.30, 0.50],
      conflict: [0.25, 0.40]
    }
  });

  assert.equal(budget.schemaVersion, 'soft-focus-budget-v1');
  assert.deepEqual(budget.priorityTiers.dominant, ['action', 'conflict']);
  assert.deepEqual(budget.priorityTiers.supporting, ['dialogue']);
  assert.deepEqual(budget.priorityTiers.forbidden, ['emotion']);
  assert.deepEqual(budget.softRanges.action, [0.30, 0.50]);
  assert.ok(budget.resourceGuidance.includes('非逐字硬性配额'));
  assert.equal(Object.isFrozen(budget), true);
});

test('Composition Models: NarrativeDebt 因果债务生命周期', () => {
  assert.throws(() => createNarrativeDebt({ summary: '' }), /NarrativeDebt 必须具备 summary 说明/);

  const debt = createNarrativeDebt({
    debtId: 'debt_blood_token_01',
    debtType: 'character_debt',
    createdChapter: 12,
    summary: '李巡对师妹隐瞒了佩剑真相',
    evidence: '第12章藏剑于床榻暗格',
    payoffHorizon: { minChapters: 3, maxChapters: 8, label: '中线暴露' }
  });

  assert.equal(debt.schemaVersion, 'narrative-debt-v1');
  assert.equal(debt.debtType, 'character_debt');
  assert.equal(debt.createdChapter, 12);
  assert.equal(debt.status, 'active');
  assert.equal(debt.payoffHorizon.maxChapters, 8);
  assert.equal(Object.isFrozen(debt), true);
});

test('Composition Models: StrategyRule 统计学证据模型与反套用防范', () => {
  assert.throws(() => createStrategyRule({}), /StrategyRule 必须具备 ruleStatement/);
  assert.throws(() => createStrategyRule({ ruleStatement: '规则A' }), /StrategyRule 必须具备 abstractPattern/);

  const rule = createStrategyRule({
    id: 'rule_high_tension_reveal',
    name: '对峙中错位揭秘律',
    ruleStatement: '在物理对抗白热化时穿插关键隐秘言语交锋',
    abstractPattern: '行动交锋(30%) -> 话语刺探(20%) -> 攻守倒转(50%)',
    microExample: '剑锋刺入半寸时，对方忽然道出主角母族徽记',
    stats: {
      supportCount: 42,
      bookCount: 8,
      authorCount: 5,
      qualityLift: 0.22,
      confidence: 0.94,
      confoundScore: 0.08
    }
  });

  assert.equal(rule.schemaVersion, 'strategy-rule-v2');
  assert.equal(rule.stats.supportCount, 42);
  assert.equal(rule.stats.bookCount, 8);
  assert.equal(rule.stats.qualityLift, 0.22);
  assert.equal(rule.similarityRiskPolicy, 'prohibit_verbatim_quote');
  assert.equal(Object.isFrozen(rule), true);
});

test('Composition Models: ChapterArchetypeProfile 运转原型机制', () => {
  assert.throws(() => createChapterArchetypeProfile({}), /ChapterArchetypeProfile 必须具备唯一 id/);

  const archetype = createChapterArchetypeProfile({
    id: 'pressure_confrontation_reveal',
    name: '极限对峙揭秘型',
    drivePattern: '危机突临 -> 心理博弈 -> 决绝反击 -> 意外发现',
    typicalStructure: ['暗夜潜入', '陷阱触发', '底牌对撞', '线索浮现'],
    failureModes: ['缺少前置铺垫导致突兀', '反派自述过长沦为解说']
  });

  assert.equal(archetype.schemaVersion, 'chapter-archetype-profile-v1');
  assert.equal(archetype.drivePattern.includes('极限对峙揭秘型'), false);
  assert.equal(archetype.typicalStructure.length, 4);
  assert.equal(Object.isFrozen(archetype), true);
});

test('Composition Evaluator: 解耦保真度评测与越权假设拦截', () => {
  const gp = createGenreProfile({
    id: 'xuanhuan_std',
    name: '标准玄幻',
    family: 'xuanhuan',
    background: ['灵脉'],
    coreConflicts: ['争夺筑基丹']
  });

  const cleanText = '林凡在石室中静心吐纳，引导灵气归入丹田气海。';
  const cleanResult = evaluateDisentanglementFidelity(cleanText, gp);
  assert.equal(cleanResult.passed, true);
  assert.equal(cleanResult.fidelityScore, 1.0);
  assert.equal(cleanResult.violations.length, 0);

  const contaminatedText = '林凡望向顾凝欣和佳云泽，心中暗骂系统怎么还不觉醒。';
  const contamResult = evaluateDisentanglementFidelity(contaminatedText, gp);
  assert.equal(contamResult.passed, false);
  assert.ok(contamResult.violations.length >= 1);
  assert.ok(contamResult.fidelityScore < 1.0);
});

test('Composition Evaluator: 结果契约达成度评测 (Outcome Contract Fulfillment)', () => {
  const contract = createNarrativeOutcomeContract({
    stateDelta: {
      stateBefore: '未获线索',
      events: ['潜入藏宝阁', '起获暗黑古钱'],
      stateAfter: '取得证据'
    }
  });

  // 1. 正文覆盖关键事件实词
  const passingText = '夜深人静，李巡悄然潜入藏宝阁二层。在一处暗格之中，他指尖触碰到了那枚暗黑古钱。' + '。'.repeat(180);
  const passRes = evaluateOutcomeContractFulfillment(passingText, contract);
  assert.equal(passRes.passed, true);
  assert.ok(passRes.fulfillmentScore >= 0.75);
  assert.ok(passRes.observations.some(o => o.includes('推进事件')));

  // 2. 正文未包含推进事件实词
  const failingText = '春风吹拂，花草摇曳，路上行人匆匆走过。';
  const failRes = evaluateOutcomeContractFulfillment(failingText, contract);
  assert.ok(failRes.fulfillmentScore < 0.75);
});

test('Composition Evaluator: 文风欧氏距离与闭环反馈更新器', () => {
  const targetVector = {
    narrativeDensity: 0.70,
    emotionalIntensity: 0.50,
    rhetoricalAbundance: 0.40,
    colloquialLevel: 0.45,
    dialogueRatio: 0.35,
    psychologicalRatio: 0.25,
    settingRatio: 0.20,
    averageSentenceLength: 20.0,
    shortSentenceRatio: 0.55,
    informationDensity: 0.70,
    negativeSpaceRatio: 0.40
  };

  const closeVector = {
    ...targetVector,
    averageSentenceLength: 21.0,
    dialogueRatio: 0.36
  };

  const distantVector = {
    ...targetVector,
    narrativeDensity: 0.10,
    emotionalIntensity: 0.95,
    colloquialLevel: 0.90,
    dialogueRatio: 0.85,
    psychologicalRatio: 0.05,
    settingRatio: 0.05,
    averageSentenceLength: 45.0,
    shortSentenceRatio: 0.10
  };

  const closeEval = evaluateStyleDistance(closeVector, targetVector);
  assert.equal(closeEval.isStable, true);
  assert.ok(closeEval.distance < 0.10);

  const distantEval = evaluateStyleDistance(distantVector, targetVector);
  assert.equal(distantEval.isStable, false);
  assert.ok(distantEval.distance > 0.25);

  // 闭环反馈自适应更新测试
  const card = createStrategyRule({
    id: 'rule_1',
    ruleStatement: '适度留白',
    abstractPattern: '短句收束',
    stats: {
      supportCount: 10,
      confidence: 0.80,
      qualityLift: 0.10
    }
  });

  const updatedCardHigh = updateStrategyFeedback(card, 0.92);
  assert.equal(updatedCardHigh.stats.supportCount, 11);
  assert.ok(updatedCardHigh.stats.confidence > card.stats.confidence);
  assert.ok(updatedCardHigh.stats.qualityLift > card.stats.qualityLift);

  const updatedCardLow = updateStrategyFeedback(card, 0.50);
  assert.equal(updatedCardLow.stats.supportCount, 11);
  assert.ok(updatedCardLow.stats.confidence < card.stats.confidence);
  assert.ok(updatedCardLow.stats.qualityLift < card.stats.qualityLift);
});
