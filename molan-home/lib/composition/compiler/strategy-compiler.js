'use strict';

/**
 * @file strategy-compiler.js
 * 创作策略编译器 (Creation Strategy Compiler)
 * 
 * 核心架构定位：
 * 1. 替代脆弱且易漂移的“万能长 Prompt 模板”，作为工业化提示词编译器；
 * 2. 接收 CompositionSpec、创作圣经、章节合同与实时语料证据，编译出具有 P0~P8 严格优先级梯队的策略指令；
 * 3. 严格遵循【注意力分层】与【确定性编译】纪律：相同输入必定产出相同策略。
 */

const crypto = require('node:crypto');
const { compileGenrePolicy } = require('../profiles/genre-profile');
const { compileStylePolicy } = require('../profiles/style-profile');
const { compileGoalPolicy } = require('../profiles/chapter-goal-profile');
const { compileFocusPolicy } = require('../profiles/focus-profile');
const { compileHookPolicy } = require('../profiles/hook-profile');
const { evaluateCompatibility } = require('./compatibility-matrix');
const { createStrategyIR } = require('../ir/strategy-ir-schema');
const { lowerToPrompt } = require('../ir/ir-lowering');
const { tierAttention } = require('./attention-tiering');

function sha256(val) {
  return crypto.createHash('sha256').update(String(val || ''), 'utf8').digest('hex');
}

/**
 * 第一阶段：纯确定性编译为 StrategyIR 中间表示
 * @param {Object} params
 * @returns {Object} 冻结的 StrategyIR 实体
 */
function compileToStrategyIR(params = {}) {
  const {
    spec,
    bible = null,
    chapterContract = {},
    evidenceCards = [],
    debtContext = null,
    options = {}
  } = params;

  if (!spec || typeof spec !== 'object') {
    throw new TypeError('compileToStrategyIR 需要有效的 CompositionSpec');
  }

  const compatibility = evaluateCompatibility(spec);
  const effectiveModulation = spec.localStyleModulation || compatibility.recommendedModulation || null;

  const targetChars = Number(chapterContract.wordBudget?.targetChars || spec.targetChars || 3000);
  const minChars = Number(chapterContract.wordBudget?.minChars || Math.round(targetChars * 0.85));
  const maxChars = Number(chapterContract.wordBudget?.maxChars || Math.round(targetChars * 1.15));

  const hardConstraints = {
    targetWordRange: { min: minChars, max: maxChars, target: targetChars },
    narrativePov: spec.derived?.narrativePov || chapterContract.pov || '第三人称限制视角',
    viewpointCharacter: chapterContract.viewpointCharacter || '',
    forbiddenKnowledge: Array.isArray(chapterContract.forbiddenKnowledge) ? chapterContract.forbiddenKnowledge : [],
    continuityInvariants: Array.isArray(chapterContract.mustPreserve) ? chapterContract.mustPreserve : [],
    negativeGuards: [
      '严禁脸谱化肢体套路：严禁‘嘴角勾起玩味弧度’、‘瞳孔骤缩’、‘倒吸一口凉气’等机械描写',
      '严禁抽象情绪口号：严禁‘心中涌起难以言喻的暖流/愤怒’，必须通过具体的现场肌肉反应、呼吸变重传达心理',
      '严禁孤立时空硬切开篇，须有残茶、物候或脚步声等微观锚点过渡'
    ]
  };

  const bookIdentity = {
    worldRuleSummary: bible?.worldRuleSummary || bible?.title || '',
    genre: spec.genre || { name: '通用文学' },
    storyEngine: spec.derived?.storyEngine || { name: '主线推进' },
    baseStyleDna: spec.style?.stableDna || {},
    readerPromises: spec.genre?.readerPromises || []
  };

  const outcome = spec.chapterGoal?.outcomeContract || {
    objectiveName: spec.chapterGoal?.name || '核心推进',
    stateDelta: spec.stateDelta || spec.chapterGoal?.defaultStateDelta || {},
    readerEffect: { summary: Array.isArray(spec.chapterGoal?.readerEffect) ? spec.chapterGoal.readerEffect.join('、') : '' }
  };

  const effectiveVector = effectiveModulation
    ? require('../profiles/style-profile').modulateStyle(spec.style?.baseVector || {}, effectiveModulation)
    : (spec.style?.baseVector || {});

  const stylePolicy = {
    name: spec.style?.name || '标准沉稳',
    stableDna: spec.style?.stableDna || {},
    modulatedVector: effectiveVector,
    narrativeDistance: spec.style?.stableDna?.narrativeDistance || 'medium',
    positiveRules: spec.style?.positiveRules || [],
    negativeRules: spec.style?.negativeRules || []
  };

  const tiers = spec.focus?.softBudget?.priorityTiers || {
    dominant: ['conflict', 'dialogue'], supporting: ['character', 'action'], optional: ['setting'], forbidden: []
  };
  const focusPolicy = {
    name: spec.focus?.name || '均衡推进',
    priorityTiers: tiers,
    softRanges: spec.focus?.softBudget?.softRanges || {},
    sceneDirectives: chapterContract.scenes ? chapterContract.scenes.map((s, idx) => `场景 ${idx + 1}: ${s.goal || ''}`).join('\n') : ''
  };

  const hookPolicy = {
    name: spec.hook?.name || '章末余波',
    openingHook: spec.hook?.openingHook || null,
    closingHook: spec.hook?.closingHook || { gapType: spec.hook?.gapType || '悬念缺口' },
    payoffHorizon: spec.hook?.payoffHorizon || { label: '即时/短线' },
    debtTracking: {
      debtsToAddress: Array.isArray(debtContext?.debtsToAddress) ? debtContext.debtsToAddress : [],
      debtsToCreate: Array.isArray(debtContext?.debtsToCreate) ? debtContext.debtsToCreate : []
    }
  };

  return createStrategyIR({
    metadata: {
      generationId: options.generationId || '',
      runId: options.runId || '',
      chapterId: chapterContract.chapterId || '',
      targetModelFamily: options.targetModelFamily || 'generic'
    },
    hardConstraints,
    bookIdentity,
    chapterOutcomeContract: outcome,
    stylePolicy,
    focusPolicy,
    hookPolicy,
    abstractEvidenceCards: Array.isArray(evidenceCards) ? evidenceCards : [],
    repairInstructions: options.repairInstructions || null
  });
}

/**
 * 编译章节创作策略 (Compile Chapter Creation Strategy)
 * 经历 IR 编译 -> 下沉渲染 -> 注意力分包三阶段
 * @param {Object} params
 * @returns {Object} 编译好的分级提示词结构体与 StrategyIR
 */
function compileChapterStrategy(params = {}) {
  const {
    spec,
    bible = null,
    chapterContract = {},
    chapterContext = '',
    evidenceCards = [],
    debtContext = null,
    options = {}
  } = params;

  if (!spec || typeof spec !== 'object') {
    throw new TypeError('compileChapterStrategy 需要有效的 CompositionSpec');
  }

  // 1. 评估兼容性与局部文风调制
  const compatibility = evaluateCompatibility(spec);
  const effectiveModulation = spec.localStyleModulation || compatibility.recommendedModulation || null;

  // 2. 编译第一公民 StrategyIR (中间表示)
  const strategyIR = compileToStrategyIR(params);

  // 3. 降级渲染为特定模型 Prompt (Lowering)
  const lowered = lowerToPrompt(strategyIR, {
    chapterContext,
    userInstruction: spec.userInstruction || options.userInstruction || '',
    context: chapterContext
  });

  // 4. 注意力分级打包 (Attention Tiering)
  const attention = tierAttention({
    permanentContext: lowered.priorityCascade.P2_CREATION_BIBLE,
    chapterStrategy: lowered.systemPrompt,
    evidenceCards,
    immediateContext: lowered.userPrompt,
    maxTotalTokens: options.maxTokens || 6000
  });

  const digest = strategyIR.irDigest;

  return Object.freeze({
    systemPrompt: lowered.systemPrompt,
    userPrompt: lowered.userPrompt,
    wordBudget: lowered.wordBudget,
    priorityCascade: lowered.priorityCascade,
    compatibility,
    attentionMetrics: attention.metrics,
    effectiveModulation,
    strategyIR,
    digest
  });
}

module.exports = {
  compileToStrategyIR,
  compileChapterStrategy
};
