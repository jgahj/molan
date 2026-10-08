'use strict';

/**
 * @file data-schemas.js
 * Molan V3 创作策略操作系统核心数据模型与实体契约 (Data Schemas & Entity Contracts)
 * 
 * 核心设计原则：
 * 1. 确立【半正交 + 条件依赖】模型，纳入 StoryEngine, ReaderPromise, NarrativeOutcome, ChapterArchetype 与 NarrativeDebt 第一公民；
 * 2. 章节目标演进为【结果契约 (Narrative Outcome Contract)】，融合状态跃迁与读者/人物信念位移；
 * 3. 笔墨分配演进为【软预算分配 (Soft Focus Budget)】，建立 Dominant/Supporting 阶梯与软浮动区间，消除机械字数配额；
 * 4. 建立统计学驱动的【策略卡质量模型 (Strategy Rule Stats)】，摒弃硬编码人工阈值。
 */

/**
 * 校验并创建故事引擎实体 (Story Engine Profile)
 * 回答“故事为什么往前跑”——核心驱动机制
 * @param {Object} input
 * @returns {Object} 冻结的 StoryEngine 实体
 */
function createStoryEngineProfile(input = {}) {
  const id = String(input.id || '').trim();
  const name = String(input.name || '').trim();
  if (!id) throw new TypeError('StoryEngineProfile 必须具备唯一 id');
  if (!name) throw new TypeError('StoryEngineProfile 必须具备人类可读 name');

  const profile = {
    schemaVersion: 'story-engine-profile-v1',
    id,
    name,
    driveMechanism: String(input.driveMechanism || 'progression').trim(), // upgrade, revenge, mystery, survival, conquest, resource_building
    corePacingRhythm: String(input.corePacingRhythm || 'medium_continuous'), // slow_burn, burst_release, steady_spiral
    typicalObstacles: Array.isArray(input.typicalObstacles) ? input.typicalObstacles.map(String).filter(Boolean) : [],
    primaryPayoffType: String(input.primaryPayoffType || 'competence_validation'),
    forbiddenTropes: Array.isArray(input.forbiddenTropes) ? input.forbiddenTropes.map(String).filter(Boolean) : [],
    metadata: typeof input.metadata === 'object' && input.metadata !== null ? { ...input.metadata } : {}
  };

  return Object.freeze(profile);
}

/**
 * 校验并创建读者阅读契约实体 (Reader Promise Profile)
 * 回答“读者为什么愿意读下去”——预期兑现与新缺口生成
 * @param {Object} input
 * @returns {Object} 冻结的 ReaderPromise 实体
 */
function createReaderPromiseProfile(input = {}) {
  const id = String(input.id || '').trim();
  const name = String(input.name || '').trim();
  if (!id) throw new TypeError('ReaderPromiseProfile 必须具备唯一 id');
  if (!name) throw new TypeError('ReaderPromiseProfile 必须具备人类可读 name');

  const profile = {
    schemaVersion: 'reader-promise-profile-v1',
    id,
    name,
    coreExpectation: String(input.coreExpectation || '').trim(), // e.g. "获得力量成长与胜势兑现", "逼近悬案幕后真相"
    payoffPacing: String(input.payoffPacing || 'rhythmic_ladder'), // immediate, cyclic_wave, long_fuse
    gapGenerationMechanism: String(input.gapGenerationMechanism || 'reveal_leads_to_larger_conspiracy'),
    emotionalPayoff: String(input.emotionalPayoff || 'satisfaction_and_catharsis'),
    metadata: typeof input.metadata === 'object' && input.metadata !== null ? { ...input.metadata } : {}
  };

  return Object.freeze(profile);
}

/**
 * 校验并创建章节结果契约 (Narrative Outcome Contract)
 * 超越单一剧情状态机，涵盖剧情状态、读者心理预期与人物信念位移
 * @param {Object} input
 * @returns {Object} 规范化的 Narrative Outcome Contract
 */
function createNarrativeOutcomeContract(input = {}) {
  const rawDelta = input.stateDelta || {};
  const stateDelta = {
    stateBefore: typeof rawDelta.stateBefore === 'object' && rawDelta.stateBefore !== null
      ? { ...rawDelta.stateBefore }
      : { summary: String(rawDelta.stateBefore || '初始平衡状态') },
    events: Array.isArray(rawDelta.events)
      ? rawDelta.events.map(String).filter(Boolean)
      : (rawDelta.events ? [String(rawDelta.events)] : []),
    stateAfter: typeof rawDelta.stateAfter === 'object' && rawDelta.stateAfter !== null
      ? { ...rawDelta.stateAfter }
      : { summary: String(rawDelta.stateAfter || '达成不可逆推进状态') },
    invalidIfRemoved: String(rawDelta.invalidIfRemoved || '后续剧情因果链条断裂').trim()
  };

  const rawReader = input.readerEffect || {};
  const readerEffect = {
    knowledgeDelta: String(rawReader.knowledgeDelta || rawReader.knowledge || '').trim(),
    emotionalShift: String(rawReader.emotionalShift || rawReader.emotion || '').trim(),
    curiosityTrigger: String(rawReader.curiosityTrigger || rawReader.curiosity || '').trim()
  };

  const rawCharacter = input.characterEffect || {};
  const characterEffect = {
    beliefShift: String(rawCharacter.beliefShift || '').trim(), // 人物对世界或他者认知产生裂痕或转变
    motivationDelta: String(rawCharacter.motivationDelta || '').trim(), // 动机增强或改变
    internalStakes: String(rawCharacter.internalStakes || '').trim() // 心理代价
  };

  const outcome = {
    schemaVersion: 'narrative-outcome-contract-v1',
    stateDelta,
    readerEffect,
    characterEffect,
    informationEffect: String(input.informationEffect || '').trim(),
    storyEffect: String(input.storyEffect || '').trim()
  };

  return Object.freeze(outcome);
}

/**
 * 校验并创建镜头软预算配置 (Soft Focus Budget)
 * 拒绝机械百分比与生硬凑字数，确立层级倾向与浮动软区间
 * @param {Object} input
 * @returns {Object} 规范化的 Soft Focus Budget
 */
function createSoftFocusBudget(input = {}) {
  const allowedTiers = ['dominant', 'supporting', 'optional', 'forbidden'];
  const tiers = {
    dominant: Array.isArray(input.dominant) ? input.dominant.map(String) : ['conflict', 'dialogue'],
    supporting: Array.isArray(input.supporting) ? input.supporting.map(String) : ['character', 'action'],
    optional: Array.isArray(input.optional) ? input.optional.map(String) : ['setting'],
    forbidden: Array.isArray(input.forbidden) ? input.forbidden.map(String) : []
  };

  const defaultRanges = {
    dialogue: [0.25, 0.40],
    action: [0.15, 0.30],
    character: [0.15, 0.25],
    conflict: [0.20, 0.35],
    setting: [0.05, 0.15],
    emotion: [0.10, 0.25],
    foreshadowing: [0.02, 0.08]
  };

  const ranges = {};
  const customRanges = input.ranges && typeof input.ranges === 'object' ? input.ranges : {};
  for (const [key, defaultRange] of Object.entries(defaultRanges)) {
    if (Array.isArray(customRanges[key]) && customRanges[key].length === 2) {
      const min = Math.max(0, Math.min(1, Number(customRanges[key][0]) || 0));
      const max = Math.max(min, Math.min(1, Number(customRanges[key][1]) || 1));
      ranges[key] = [min, max];
    } else {
      ranges[key] = [...defaultRange];
    }
  }

  const budget = {
    schemaVersion: 'soft-focus-budget-v1',
    priorityTiers: Object.freeze(tiers),
    softRanges: Object.freeze(ranges),
    resourceGuidance: String(input.resourceGuidance || '本配置为镜头笔墨关注倾向，非逐字硬性配额；严禁为凑对白比例而强行安排机械对话。').trim()
  };

  return Object.freeze(budget);
}

/**
 * 校验并创建叙事债务实体 (Narrative Debt)
 * 涵盖 情节债 (Plot Debt)、钩子债 (Hook Debt)、人物债 (Character Debt)
 * @param {Object} input
 * @returns {Object} 规范化的 Narrative Debt 实体
 */
function createNarrativeDebt(input = {}) {
  const debtId = String(input.debtId || input.id || input.debt_id || 'debt_' + Date.now()).trim();
  const { normalizeDebtType } = require('../debt/debt-types');
  const rawType = input.debtType || input.debt_type || '';
  const allowedTypes = [
    'plot_debt', 'hook_debt', 'character_debt', 'world_debt', 'relationship_debt',
    'information_debt', 'reader_promise_debt',
    'plot', 'hook', 'character', 'information', 'relationship', 'world',
    'reader_expectation', 'reader_promise'
  ];
  let debtType;
  if (allowedTypes.includes(rawType)) {
    debtType = rawType;
  } else {
    debtType = normalizeDebtType(rawType) || 'hook_debt';
  }

  const debt = {
    schemaVersion: 'narrative-debt-v1',
    debtId,
    debtType,
    createdChapter: Number(input.createdChapter || input.created_at_chapter) || 1,
    summary: String(input.summary || '').trim(),
    evidence: String(input.evidence || input.creation_evidence || '').trim(), // 产生债务的原文章节引文或事实
    payoffHorizon: {
      minChapters: Math.max(1, Number(input.payoffHorizon?.minChapters || input.expected_payoff_from) || 2),
      maxChapters: Math.max(2, Number(input.payoffHorizon?.maxChapters || input.expected_payoff_to) || 5),
      label: String(input.payoffHorizon?.label || '中长线兑现')
    },
    status: ['active', 'deepened', 'partially_resolved', 'resolved', 'open', 'developing', 'partially_paid', 'paid', 'deferred', 'invalidated', 'abandoned'].includes(input.status)
      ? input.status
      : 'active',
    trackingHistory: Array.isArray(input.trackingHistory) ? input.trackingHistory.map(item => ({ ...item })) : [],
    resolutionNotes: String(input.resolutionNotes || input.resolution_notes || '').trim()
  };

  if (!debt.summary) throw new TypeError('NarrativeDebt 必须具备 summary 说明');
  return Object.freeze(debt);
}

/**
 * 校验并创建统计学驱动的策略规则原子 (Statistical Strategy Rule)
 * 彻底消除人工固定硬阈值，支持样本量、置信度与质量增益打分
 * @param {Object} input
 * @returns {Object} 规范化的 Strategy Rule 实体
 */
function createStrategyRule(input = {}) {
  const id = String(input.id || 'rule_' + Date.now()).trim();
  const name = String(input.name || '经典创作律').trim();
  const ruleStatement = String(input.ruleStatement || input.rule || '').trim();
  const abstractPattern = String(input.abstractPattern || '').trim();
  const microExample = String(input.microExample || '').trim();
  const counterExample = String(input.counterExample || '').trim();
  const failureMode = String(input.failureMode || '').trim();

  if (!ruleStatement) throw new TypeError('StrategyRule 必须具备 ruleStatement 正向规则陈述');
  if (!abstractPattern) throw new TypeError('StrategyRule 必须具备 abstractPattern 抽象运行模式');

  const rawSupport = input.stats?.supportCount;
  const rawBooks = input.stats?.bookCount;
  const rawAuthors = input.stats?.authorCount;
  const rawGenres = input.stats?.genreCount;

  const stats = {
    supportCount: rawSupport !== undefined && Number.isFinite(Number(rawSupport)) ? Math.max(0, Number(rawSupport)) : 1,
    bookCount: rawBooks !== undefined && Number.isFinite(Number(rawBooks)) ? Math.max(0, Number(rawBooks)) : 1,
    authorCount: rawAuthors !== undefined && Number.isFinite(Number(rawAuthors)) ? Math.max(0, Number(rawAuthors)) : 0,
    genreCount: rawGenres !== undefined && Number.isFinite(Number(rawGenres)) ? Math.max(0, Number(rawGenres)) : 1,
    qualityLift: Number(input.stats?.qualityLift ?? 0.15), // 采用该规则相对基准章节的平均质量提振度 (-1.0 ~ +1.0)
    confidence: Math.max(0, Math.min(1, Number(input.stats?.confidence ?? 0.85))),
    confoundScore: Math.max(0, Math.min(1, Number(input.stats?.confoundScore ?? 0.10))) // 混杂因素风险评分 (0~1)
  };

  const rule = {
    schemaVersion: 'strategy-rule-v2',
    id,
    name,
    dimension: String(input.dimension || 'general').trim(), // genre, story_engine, style, goal, focus, hook, combo
    abstractionLevel: ['high', 'medium', 'low'].includes(input.abstractionLevel) ? input.abstractionLevel : 'high',
    ruleStatement,
    abstractPattern,
    microExample,
    counterExample,
    failureMode,
    stats: Object.freeze(stats),
    applicableDimensions: Array.isArray(input.applicableDimensions) ? input.applicableDimensions.map(String) : [],
    similarityRiskPolicy: 'prohibit_verbatim_quote' // 严防原句直出
  };

  return Object.freeze(rule);
}

/**
 * 校验并创建章节运转原型实体 (Chapter Archetype Profile)
 * 回答“这一章通常以何种拓扑机制运转”
 * @param {Object} input
 * @returns {Object} 规范化的 Chapter Archetype 实体
 */
function createChapterArchetypeProfile(input = {}) {
  const id = String(input.id || '').trim();
  const name = String(input.name || '').trim();
  if (!id) throw new TypeError('ChapterArchetypeProfile 必须具备唯一 id');
  if (!name) throw new TypeError('ChapterArchetypeProfile 必须具备人类可读 name');

  const profile = {
    schemaVersion: 'chapter-archetype-profile-v1',
    id,
    name,
    drivePattern: String(input.drivePattern || '').trim(), // e.g. "信息受压 -> 试探对峙 -> 意外破局 -> 锁定嫌疑"
    typicalStructure: Array.isArray(input.typicalStructure) ? input.typicalStructure.map(String) : [],
    failureModes: Array.isArray(input.failureModes) ? input.failureModes.map(String) : [],
    metadata: typeof input.metadata === 'object' && input.metadata !== null ? { ...input.metadata } : {}
  };

  return Object.freeze(profile);
}

module.exports = {
  createStoryEngineProfile,
  createReaderPromiseProfile,
  createNarrativeOutcomeContract,
  createSoftFocusBudget,
  createNarrativeDebt,
  createStrategyRule,
  createChapterArchetypeProfile
};
