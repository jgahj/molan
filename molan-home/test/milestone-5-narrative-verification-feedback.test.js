'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createNarrativeOutcomeContract,
  createStrategyRule
} = require('../lib/composition/models/data-schemas');

const {
  evaluateOutcomeContractFulfillment,
  detectEntityMentions,
  detectEventOccurrences,
  verifyNarrativeStateTransition,
  updateStrategyFeedback,
  batchUpdateStrategyFeedback,
  TRANSITION_DOMAINS
} = require('../lib/composition/evaluation/composition-evaluator');

// ---------------------------------------------------------------------------
// Suite 1: R11 Deep State-Transition Outcome Verification (P1-12)
// ---------------------------------------------------------------------------

test('R11 Suite 1.1: 实体提及判定 (Entity Mention Discrimination) - 区分前景活跃叙事与背景闲聊口述', () => {
  const contract = createNarrativeOutcomeContract({
    stateDelta: {
      stateBefore: '未获线索',
      events: ['潜入藏宝阁', '起获暗黑古钱'],
      stateAfter: '取得证据'
    }
  });

  // 正文仅在路边闲聊、传闻中提及实体，无当前真实行动
  const oralText = '在路旁茶棚中，几名江湖客正低声闲聊：“传闻当年藏宝阁中失落过一枚暗黑古钱，不知是真是假。”另一人笑道：“不过是捕风捉影的传说罢了。”两人喝了碗茶，各自散去。';

  const res = evaluateOutcomeContractFulfillment(oralText, contract);

  assert.equal(res.passed, false, '背景传闻提及不应判定履约通过');
  assert.ok(res.fulfillmentScore < 0.75, '得分应低于及格线');
  assert.equal(res.entityMentions.foregroundCount, 0, '前景实体数应为 0');
  assert.ok(res.entityMentions.backgroundCount > 0, '应检测到背景口述提及');
  assert.equal(res.eventOccurrences.events[0].status, 'MENTION_ONLY', '事件应仅判定为 MENTION_ONLY');
  assert.equal(res.stateTransitions.verified, false, '状态跃迁不应成立');
});

test('R11 Suite 1.2: 否定与挫折未果拦截 (Negation & Frustration Interception)', () => {
  const contract = createNarrativeOutcomeContract({
    stateDelta: {
      stateBefore: '未获线索',
      events: ['潜入藏宝阁', '起获暗黑古钱'],
      stateAfter: '取得暗黑古钱'
    }
  });

  // 正文描述尝试潜入但受挫逃窜，未能起获，空手而归
  const negatedText = '李巡悄然潜入藏宝阁二层未果，触动机关后被迫收手，仓皇逃窜间未能起获暗黑古钱，终究空手而归。';

  const res = evaluateOutcomeContractFulfillment(negatedText, contract);

  assert.equal(res.passed, false, '行动挫折未果必须判定不通过');
  assert.ok(res.eventOccurrences.events.some(e => e.status === 'FAILED_ATTEMPT'), '必须识别出 FAILED_ATTEMPT 状态');
  assert.ok(res.contradictionsDetected.includes('空手而归'), '必须捕获物权转移矛盾词 [空手而归]');
  assert.equal(res.stateTransitions.verified, false, '存在矛盾时状态跃迁不得成立');
  assert.ok(res.fulfillmentScore < 0.60, '失败并出现矛盾时得分应显著惩罚');
});

test('R11 Suite 1.3: 假设非实模态过滤 (Hypothetical / Counterfactual Statement Exclusion)', () => {
  const contract = createNarrativeOutcomeContract({
    stateDelta: {
      stateBefore: '未获线索',
      events: ['潜入藏宝阁', '起获暗黑古钱'],
      stateAfter: '取得暗黑古钱'
    }
  });

  // 正文为内心假想/假设性推断，非既成事实
  const hypotheticalText = '李巡望着远方的阁楼沉思。若是今夜未能潜入藏宝阁起获暗黑古钱，三日后的宗门大典上他便再无退路，必须另寻良策。';

  const res = evaluateOutcomeContractFulfillment(hypotheticalText, contract);

  assert.equal(res.passed, false, '假设性非实模态不可作为履约证据');
  assert.ok(
    res.eventOccurrences.events.some(e => e.status === 'HYPOTHETICAL' || e.status === 'FAILED_ATTEMPT'),
    '应识别为假设性或未遂事件'
  );
  assert.equal(res.stateTransitions.verified, false, '假设模态下状态跃迁不成立');
});

test('R11 Suite 1.4: 物权转移状态跃迁验证 (Possession Transfer Verification)', () => {
  const contract = createNarrativeOutcomeContract({
    domain: 'possession',
    stateDelta: {
      stateBefore: '未获古钱',
      events: ['潜入藏宝阁', '起获暗黑古钱'],
      stateAfter: '取得暗黑古钱'
    }
  });

  // 正文潜入成功，起获并紧握贴身收纳，扎实落地
  const possessionText = '夜色深沉，李巡潜入藏宝阁。他绕开层层法阵，在一处隐秘暗格中起获暗黑古钱，紧握古钱贴身藏入怀中，悄然撤离。' + '。'.repeat(150);

  const res = evaluateOutcomeContractFulfillment(possessionText, contract);

  assert.equal(res.passed, true, '物权转移扎实落地应判定通过');
  assert.equal(res.stateTransitions.domain, 'possession', '领域应为 possession');
  assert.equal(res.stateTransitions.verified, true, '状态跃迁应验证成立');
  assert.ok(res.fulfillmentScore >= 0.85, '达成度得分应在 0.85 以上');
  assert.equal(res.contradictionsDetected.length, 0, '不得检出矛盾');
});

test('R11 Suite 1.5: 隐秘揭示/认知位移跃迁验证 (Information Revelation Verification)', () => {
  const contract = createNarrativeOutcomeContract({
    domain: 'information',
    stateDelta: {
      stateBefore: '内奸不明',
      events: ['拆阅密函', '查明叛徒'],
      stateAfter: '赵统领通敌真相大白'
    }
  });

  const infoText = '密室之内，李巡用匕首撬开暗匣，取出一封漆印完好的密函。他拆阅密函，就着烛火辨认字迹，信尾赫然写着赵统领的亲笔署名，通敌叛国的真相大白。' + '。'.repeat(150);

  const res = evaluateOutcomeContractFulfillment(infoText, contract);

  assert.equal(res.passed, true, '认知揭秘跃迁应判定通过');
  assert.equal(res.stateTransitions.domain, 'information', '领域应为 information');
  assert.equal(res.stateTransitions.verified, true);
  assert.ok(res.fulfillmentScore >= 0.85);
});

test('R11 Suite 1.6: 生理/生死状态跃迁验证 (Vitality & Condition Verification)', () => {
  const contract = createNarrativeOutcomeContract({
    domain: 'condition',
    stateDelta: {
      stateBefore: '刺客完好',
      events: ['刺穿重铠', '击杀刺客'],
      stateAfter: '刺客重创气绝身亡'
    }
  });

  const conditionText = '两马交错之际，长枪如毒龙出洞，直刺穿黑衣刺客的重铠。黑衣刺客胸口鲜血狂喷，惨叫一声倒地不起，气绝身亡。' + '。'.repeat(150);

  const res = evaluateOutcomeContractFulfillment(conditionText, contract);

  assert.equal(res.passed, true);
  assert.equal(res.stateTransitions.domain, 'condition');
  assert.equal(res.stateTransitions.verified, true);
  assert.ok(res.fulfillmentScore >= 0.85);
});

test('R11 Suite 1.7: 阵营/关系跃迁验证 (Relationship Shift Verification)', () => {
  const contract = createNarrativeOutcomeContract({
    domain: 'relationship',
    stateDelta: {
      stateBefore: '兄弟同盟',
      events: ['割袍断义', '反目决裂'],
      stateAfter: '反目成仇势不两立'
    }
  });

  const relationText = '面对昔日同生共死的结拜兄长，李巡拔刀削下衣袍一角：“今日你背叛宗门，我便割袍断义，从此反目成仇，势不两立！”' + '。'.repeat(150);

  const res = evaluateOutcomeContractFulfillment(relationText, contract);

  assert.equal(res.passed, true);
  assert.equal(res.stateTransitions.domain, 'relationship');
  assert.equal(res.stateTransitions.verified, true);
  assert.ok(res.fulfillmentScore >= 0.85);
});

test('R11 Suite 1.8: 位阶/境界跃迁验证 (Status & Realm Ascension Verification)', () => {
  const contract = createNarrativeOutcomeContract({
    domain: 'status',
    stateDelta: {
      stateBefore: '筑基瓶颈',
      events: ['运转心法', '突破破境'],
      stateAfter: '成功突破踏入金丹初期'
    }
  });

  const statusText = '丹田灵气澎湃，李巡全力运转心法，经脉轰鸣声中突破瓶颈，成功突破踏入金丹初期境界。' + '。'.repeat(150);

  const res = evaluateOutcomeContractFulfillment(statusText, contract);

  assert.equal(res.passed, true);
  assert.equal(res.stateTransitions.domain, 'status');
  assert.equal(res.stateTransitions.verified, true);
});

test('R11 Suite 1.9: 通用因果跃迁验证 (General Domain Causal Verification)', () => {
  const contract = createNarrativeOutcomeContract({
    domain: 'general',
    stateDelta: {
      stateBefore: '局势未定',
      events: ['闭合城门', '全城戒严'],
      stateAfter: '终成定局再无回头路'
    }
  });

  const generalText = '随着城门最后一声轰然闭合，铁锁落定，全城戒严的大势终成定局，再无回头路。' + '。'.repeat(150);

  const res = evaluateOutcomeContractFulfillment(generalText, contract);

  assert.equal(res.passed, true);
  assert.equal(res.stateTransitions.domain, 'general');
  assert.equal(res.stateTransitions.verified, true);
});

test('R11 Suite 1.10: 参数双向重载与空输入防御 (Signature Overload & Edge Protection)', () => {
  const contract = createNarrativeOutcomeContract({
    stateDelta: {
      stateBefore: '初始',
      events: ['潜入藏宝阁', '起获暗黑古钱'],
      stateAfter: '取得'
    }
  });
  const validText = '李巡潜入藏宝阁起获暗黑古钱收入怀中。' + '。'.repeat(180);

  // 1. (text, contract) 调用
  const r1 = evaluateOutcomeContractFulfillment(validText, contract);
  assert.equal(r1.passed, true);

  // 2. (contract, text) 逆序重载调用
  const r2 = evaluateOutcomeContractFulfillment(contract, validText);
  assert.equal(r2.passed, true);

  // 3. 空输入防御
  const rEmpty = evaluateOutcomeContractFulfillment('', contract);
  assert.equal(rEmpty.passed, false);
  assert.equal(rEmpty.fulfillmentScore, 0);

  const rNull = evaluateOutcomeContractFulfillment(null, null);
  assert.equal(rNull.passed, false);
});

// ---------------------------------------------------------------------------
// Suite 2: R12 Attribution-Clean Strategy Feedback Learning (P1-13)
// ---------------------------------------------------------------------------

test('R12 Suite 2.1: 反事实配对 A-B 对照 (Counterfactual Paired A-B) 孤立纯净因果增益并降低混淆度', () => {
  const card = createStrategyRule({
    id: 'rule_causal_1',
    ruleStatement: '伏笔收束',
    abstractPattern: '三段式线索互锁',
    stats: {
      supportCount: 10,
      confidence: 0.80,
      qualityLift: 0.10,
      confoundScore: 0.10
    }
  });

  // 处理组得分 0.92，对照组（无该规则）得分 0.80 -> 干净因果净增益 ΔQ = +0.12
  const updated = updateStrategyFeedback(card, {
    mode: 'counterfactual_ab',
    treatmentScore: 0.92,
    controlScore: 0.80
  });

  assert.equal(updated.stats.supportCount, 11);
  assert.ok(updated.stats.qualityLift > card.stats.qualityLift, '净增益应显著提升');
  assert.ok(updated.stats.confidence > card.stats.confidence, '置信度应提升');
  assert.ok(updated.stats.confoundScore < card.stats.confoundScore, '反事实验证应显著降低混淆度 confoundScore');
});

test('R12 Suite 2.2: 反事实配对 A-B 对照精准惩罚过关章节中的有害寄生规则 (Harmful Hitchhiker)', () => {
  const cardHarm = createStrategyRule({
    id: 'rule_hitchhiker',
    ruleStatement: '生硬转折',
    abstractPattern: '毫无铺垫的机械降神',
    stats: {
      supportCount: 10,
      confidence: 0.85,
      qualityLift: 0.15,
      confoundScore: 0.10
    }
  });

  // 章节总体及格 (0.78 >= 0.75)，但去掉该规则的对照组得分高达 0.86！
  // 说明该规则实际造成了负向损伤 ΔQ = 0.78 - 0.86 = -0.08
  const updated = updateStrategyFeedback(cardHarm, {
    mode: 'counterfactual_ab',
    treatmentScore: 0.78,
    controlScore: 0.86
  });

  assert.equal(updated.stats.supportCount, 11);
  assert.ok(updated.stats.qualityLift < cardHarm.stats.qualityLift, '有害规则质量增益必须下降');
  assert.ok(updated.stats.confidence < cardHarm.stats.confidence, '有害规则置信度必须下降');
});

test('R12 Suite 2.3: 对照保留集比较 (Holdout Comparison) 消除多规则共现通胀', () => {
  const card = createStrategyRule({
    id: 'rule_cooccur',
    ruleStatement: '动作白描',
    abstractPattern: '动词短语叠用',
    stats: {
      supportCount: 10,
      confidence: 0.80,
      qualityLift: 0.10,
      confoundScore: 0.10
    }
  });

  // 3 条规则共同生效，总提振 0.87 - 0.75 = 0.12
  const updatedHoldout = updateStrategyFeedback(card, {
    mode: 'holdout_comparison',
    auditScore: 0.87,
    holdoutBaselineScore: 0.75,
    activeRuleCount: 3
  });

  // 单独全额赋予提振 (相当于不加分解的传统做法)
  const updatedNaive = updateStrategyFeedback(card, {
    mode: 'holdout_comparison',
    auditScore: 0.87,
    holdoutBaselineScore: 0.75,
    activeRuleCount: 1
  });

  assert.ok(
    updatedHoldout.stats.qualityLift < updatedNaive.stats.qualityLift,
    '3 规则平分并惩罚后的增益应严格小于单规则全额冒领'
  );
});

test('R12 Suite 2.4: 混淆度演化分化 (ConfoundScore Divergence)', () => {
  let cardAB = createStrategyRule({
    id: 'rule_ab',
    ruleStatement: '伏笔递进',
    abstractPattern: '三段式线索互锁',
    stats: { supportCount: 10, confidence: 0.80, qualityLift: 0.10, confoundScore: 0.10 }
  });

  let cardHoldout = createStrategyRule({
    id: 'rule_holdout',
    ruleStatement: '背景铺垫',
    abstractPattern: '环境渲染呼应心境',
    stats: { supportCount: 10, confidence: 0.80, qualityLift: 0.10, confoundScore: 0.10 }
  });

  // 连续 3 次反事实 A-B 评测
  for (let i = 0; i < 3; i++) {
    cardAB = updateStrategyFeedback(cardAB, {
      mode: 'counterfactual_ab',
      treatmentScore: 0.90,
      controlScore: 0.80
    });
  }

  // 连续 3 次高并发共现评测 (4条规则共存，未做单独消融)
  for (let i = 0; i < 3; i++) {
    cardHoldout = updateStrategyFeedback(cardHoldout, {
      mode: 'holdout_comparison',
      auditScore: 0.90,
      holdoutBaselineScore: 0.80,
      activeRuleCount: 4
    });
  }

  assert.ok(cardAB.stats.confoundScore < 0.08, '经过因果 A-B 验证的规则混淆度持续下降');
  assert.ok(cardHoldout.stats.confoundScore >= 0.10, '高共现未消融环境下的规则混淆度保持或上升');
  assert.ok(cardAB.stats.confoundScore < cardHoldout.stats.confoundScore, '因果验证与共现环境的混淆度产生显著分化');
});

test('R12 Suite 2.5: 批量反馈更新与维度靶向归因 (batchUpdateStrategyFeedback)', () => {
  const cardSuspense = createStrategyRule({
    id: 'rule_suspense_1',
    ruleStatement: '章末留悬念',
    abstractPattern: '钩子递进',
    tags: ['suspense', 'hook'],
    stats: { supportCount: 5, confidence: 0.75, qualityLift: 0.08, confoundScore: 0.12 }
  });

  const cardDialogue = createStrategyRule({
    id: 'rule_dialogue_1',
    ruleStatement: '对话简练',
    abstractPattern: '短句留白',
    tags: ['dialogue'],
    stats: { supportCount: 5, confidence: 0.75, qualityLift: 0.08, confoundScore: 0.12 }
  });

  // 本次生成在悬念维度显著提升 (0.92 vs 0.75)，但在对话维度表现低劣 (0.60 vs 0.75)
  const batchResult = batchUpdateStrategyFeedback(
    [cardSuspense, cardDialogue],
    {
      dimensionScores: {
        suspense: 0.92,
        dialogue: 0.60
      },
      baselineScore: 0.75
    }
  );

  assert.ok(Array.isArray(batchResult));
  assert.equal(batchResult.length, 2);

  const [upSuspense, upDialogue] = batchResult;

  assert.ok(upSuspense.stats.qualityLift > cardSuspense.stats.qualityLift, '悬念规则应获正向增益');
  assert.ok(upSuspense.stats.confidence > cardSuspense.stats.confidence);

  assert.ok(upDialogue.stats.qualityLift < cardDialogue.stats.qualityLift, '对话规则应受负向惩罚');
  assert.ok(upDialogue.stats.confidence < cardDialogue.stats.confidence);

  assert.ok(batchResult.attributionReport);
  assert.equal(batchResult.attributionReport.ruleCount, 2);
});

test('R12 Suite 2.6: 标量分值调用 100% 向后兼容 (Legacy Numeric Scalar Fallback)', () => {
  const card = createStrategyRule({
    id: 'rule_legacy',
    ruleStatement: '适度留白',
    abstractPattern: '短句收束',
    stats: { supportCount: 10, confidence: 0.80, qualityLift: 0.10 }
  });

  const upHigh = updateStrategyFeedback(card, 0.92);
  assert.equal(upHigh.stats.supportCount, 11);
  assert.ok(upHigh.stats.confidence > card.stats.confidence);
  assert.ok(upHigh.stats.qualityLift > card.stats.qualityLift);

  const upLow = updateStrategyFeedback(card, 0.50);
  assert.equal(upLow.stats.supportCount, 11);
  assert.ok(upLow.stats.confidence < card.stats.confidence);
  assert.ok(upLow.stats.qualityLift < card.stats.qualityLift);

  assert.throws(() => updateStrategyFeedback(null, 0.85), TypeError);
});
