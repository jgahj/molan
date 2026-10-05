'use strict';

/**
 * @file strategy-ir-schema.js
 * 创作策略中间表示规范 (Creation Strategy Intermediate Representation Schema)
 * 
 * 核心架构定位：
 * 1. 确立 Strategy IR 为 Molan 系统的核心权威创作资产（Prompt 仅为终端模型渲染降级产物）；
 * 2. 模型无关：彻底解耦特定大语言模型的提示词句法，无论下游换用 GPT、Claude、DeepSeek 还是端侧小模型，IR 结构与创作策略恒定不变；
 * 3. 严格包含元数据、物理硬围栏、作品基因、结果契约、文风策略、镜头软预算、钩子与叙事债务、抽象证据卡及确定性摘要哈希。
 */

const crypto = require('node:crypto');

const STRATEGY_IR_SCHEMA_VERSION = 'strategy-ir-v1';

function sha256(val) {
  return crypto.createHash('sha256').update(String(val || ''), 'utf8').digest('hex');
}

/**
 * 校验并创建规范的 StrategyIR 实体
 * @param {Object} input
 * @returns {Object} 冻结的不可变 StrategyIR 实体
 */
function createStrategyIR(input = {}) {
  const metadata = {
    generationId: String(input.metadata?.generationId || '').trim(),
    runId: String(input.metadata?.runId || '').trim(),
    chapterId: String(input.metadata?.chapterId || '').trim(),
    targetModelFamily: String(input.metadata?.targetModelFamily || 'generic').trim(),
    createdAt: Number(input.metadata?.createdAt) || Date.now()
  };

  const hardConstraints = {
    targetWordRange: {
      min: Math.max(100, Number(input.hardConstraints?.targetWordRange?.min || input.hardConstraints?.minChars || 2000)),
      max: Math.max(200, Number(input.hardConstraints?.targetWordRange?.max || input.hardConstraints?.maxChars || 4000)),
      target: Math.max(150, Number(input.hardConstraints?.targetWordRange?.target || input.hardConstraints?.targetChars || 3000))
    },
    narrativePov: String(input.hardConstraints?.narrativePov || '第三人称限制视角').trim(),
    viewpointCharacter: String(input.hardConstraints?.viewpointCharacter || '').trim(),
    forbiddenKnowledge: Array.isArray(input.hardConstraints?.forbiddenKnowledge)
      ? input.hardConstraints.forbiddenKnowledge.map(String).filter(Boolean)
      : [],
    continuityInvariants: Array.isArray(input.hardConstraints?.continuityInvariants)
      ? input.hardConstraints.continuityInvariants.map(String).filter(Boolean)
      : [],
    negativeGuards: Array.isArray(input.hardConstraints?.negativeGuards)
      ? input.hardConstraints.negativeGuards.map(String).filter(Boolean)
      : []
  };

  const bookIdentity = {
    worldRuleSummary: String(input.bookIdentity?.worldRuleSummary || '').trim(),
    genre: typeof input.bookIdentity?.genre === 'object' && input.bookIdentity?.genre !== null
      ? { ...input.bookIdentity.genre }
      : { name: String(input.bookIdentity?.genre || '通用文学') },
    storyEngine: typeof input.bookIdentity?.storyEngine === 'object' && input.bookIdentity?.storyEngine !== null
      ? { ...input.bookIdentity.storyEngine }
      : { name: String(input.bookIdentity?.storyEngine || '主线推进') },
    baseStyleDna: typeof input.bookIdentity?.baseStyleDna === 'object' && input.bookIdentity?.baseStyleDna !== null
      ? { ...input.bookIdentity.baseStyleDna }
      : {},
    readerPromises: Array.isArray(input.bookIdentity?.readerPromises)
      ? input.bookIdentity.readerPromises.map(String)
      : []
  };

  const rawOutcome = input.chapterOutcomeContract || {};
  const chapterOutcomeContract = {
    objectiveName: String(rawOutcome.objectiveName || rawOutcome.name || '核心推进').trim(),
    stateDelta: typeof rawOutcome.stateDelta === 'object' && rawOutcome.stateDelta !== null
      ? { ...rawOutcome.stateDelta }
      : { summary: String(rawOutcome.stateDelta || '') },
    readerEffect: typeof rawOutcome.readerEffect === 'object' && rawOutcome.readerEffect !== null
      ? { ...rawOutcome.readerEffect }
      : { summary: String(rawOutcome.readerEffect || '') },
    characterEffect: typeof rawOutcome.characterEffect === 'object' && rawOutcome.characterEffect !== null
      ? { ...rawOutcome.characterEffect }
      : { summary: String(rawOutcome.characterEffect || '') },
    informationEffect: String(rawOutcome.informationEffect || '').trim()
  };

  const stylePolicy = {
    name: String(input.stylePolicy?.name || '标准沉稳').trim(),
    stableDna: typeof input.stylePolicy?.stableDna === 'object' && input.stylePolicy?.stableDna !== null
      ? { ...input.stylePolicy.stableDna }
      : {},
    modulatedVector: typeof input.stylePolicy?.modulatedVector === 'object' && input.stylePolicy?.modulatedVector !== null
      ? { ...input.stylePolicy.modulatedVector }
      : {},
    narrativeDistance: String(input.stylePolicy?.narrativeDistance || 'medium').trim(),
    positiveRules: Array.isArray(input.stylePolicy?.positiveRules) ? input.stylePolicy.positiveRules.map(String) : [],
    negativeRules: Array.isArray(input.stylePolicy?.negativeRules) ? input.stylePolicy.negativeRules.map(String) : []
  };

  const focusPolicy = {
    name: String(input.focusPolicy?.name || '均衡推进').trim(),
    priorityTiers: typeof input.focusPolicy?.priorityTiers === 'object' && input.focusPolicy?.priorityTiers !== null
      ? { ...input.focusPolicy.priorityTiers }
      : { dominant: ['conflict', 'dialogue'], supporting: ['action', 'character'], optional: ['setting'], forbidden: [] },
    softRanges: typeof input.focusPolicy?.softRanges === 'object' && input.focusPolicy?.softRanges !== null
      ? { ...input.focusPolicy.softRanges }
      : {},
    sceneDirectives: String(input.focusPolicy?.sceneDirectives || '').trim()
  };

  const hookPolicy = {
    name: String(input.hookPolicy?.name || '章末余波').trim(),
    openingHook: input.hookPolicy?.openingHook || null,
    closingHook: input.hookPolicy?.closingHook || null,
    payoffHorizon: typeof input.hookPolicy?.payoffHorizon === 'object' && input.hookPolicy?.payoffHorizon !== null
      ? { ...input.hookPolicy.payoffHorizon }
      : { label: '即时/短线' },
    debtTracking: {
      debtsToAddress: Array.isArray(input.hookPolicy?.debtTracking?.debtsToAddress) ? [...input.hookPolicy.debtTracking.debtsToAddress] : [],
      debtsToCreate: Array.isArray(input.hookPolicy?.debtTracking?.debtsToCreate) ? [...input.hookPolicy.debtTracking.debtsToCreate] : [],
      projection: input.hookPolicy?.debtTracking?.projection || null,
      promptGuidance: String(input.hookPolicy?.debtTracking?.promptGuidance || '')
    }
  };

  const abstractEvidenceCards = Array.isArray(input.abstractEvidenceCards)
    ? input.abstractEvidenceCards.map(c => ({
        id: c.id,
        rule: c.rule || c.ruleStatement,
        abstractPattern: c.abstractPattern,
        microExample: c.microExample,
        failureMode: c.failureMode,
        evidenceStrength: c.evidenceStrength || 'B'
      }))
    : [];

  const repairInstructions = input.repairInstructions && typeof input.repairInstructions === 'object'
    ? { ...input.repairInstructions }
    : null;

  // 严格确定性指纹计算
  const canonicalPayload = JSON.stringify({
    hardConstraints,
    bookIdentity,
    chapterOutcomeContract,
    stylePolicy,
    focusPolicy,
    hookPolicy,
    abstractEvidenceCards,
    repairInstructions
  });
  const irDigest = sha256(canonicalPayload);

  const ir = {
    schemaVersion: STRATEGY_IR_SCHEMA_VERSION,
    irDigest,
    metadata: Object.freeze(metadata),
    hardConstraints: Object.freeze(hardConstraints),
    bookIdentity: Object.freeze(bookIdentity),
    chapterOutcomeContract: Object.freeze(chapterOutcomeContract),
    stylePolicy: Object.freeze(stylePolicy),
    focusPolicy: Object.freeze(focusPolicy),
    hookPolicy: Object.freeze(hookPolicy),
    abstractEvidenceCards: Object.freeze(abstractEvidenceCards),
    repairInstructions: repairInstructions ? Object.freeze(repairInstructions) : null
  };

  return Object.freeze(ir);
}

module.exports = {
  STRATEGY_IR_SCHEMA_VERSION,
  createStrategyIR
};
