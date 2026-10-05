'use strict';

/**
 * @file composition-evaluator.js
 * 创作评测体系与闭环反馈学习引擎 (Composition Evaluator & Quality Feedback)
 * 
 * 核心功能：
 * 1. 解耦保真度评测 (Disentanglement Fidelity)：检测题材边界围栏 (forbiddenAssumptions) 是否被越权破坏；
 * 2. Outcome Contract 达成度检验：深度三层判准状态跃迁与人物信念/读者预期是否在正文中扎实落定；
 * 3. 文风距离稳定性测算 (Style Distance Stability)：以欧氏距离度量正文实际风格与目标向量的偏离度；
 * 4. 归因净化策略反馈学习器 (Attribution-Clean Strategy Feedback Learning)：通过反事实 A-B 对照与对照保留集，
 *    消除共现污染与信贷分配误赋，自适应驱动策略规则的置信度、质量增益与混淆度演化。
 */

const { checkForbiddenAssumptions } = require('../profiles/genre-profile');
const { STYLE_VECTOR_KEYS } = require('../profiles/style-profile');
const {
  evaluateOutcomeContractFulfillment,
  detectEntityMentions,
  detectEventOccurrences,
  verifyNarrativeStateTransition,
  TRANSITION_DOMAINS
} = require('./outcome-contract');

/**
 * 评估正文与题材的解耦保真度（越权假设拦截）
 * @param {string} text 生成正文
 * @param {Object} genreProfile 题材 Profile
 * @returns {Object} 评测结果 { passed, fidelityScore, violations }
 */
function evaluateDisentanglementFidelity(text, genreProfile) {
  const content = String(text || '');
  const check = checkForbiddenAssumptions(content, genreProfile);

  const violationCount = check.violations.length;
  const fidelityScore = Math.max(0, Number((1.0 - violationCount * 0.3).toFixed(2)));

  return Object.freeze({
    passed: check.passed,
    fidelityScore,
    violations: check.violations
  });
}

/**
 * 测算正文实际文风特征与目标调制向量的欧氏空间距离
 * @param {Object} observedVector 正文测算出的文风特征
 * @param {Object} targetVector 目标期望风格向量
 * @returns {Object} { distance, isStable, dimensionDeltas }
 */
function evaluateStyleDistance(observedVector = {}, targetVector = {}) {
  const deltas = {};
  let sumSq = 0;
  let count = 0;

  for (const key of STYLE_VECTOR_KEYS) {
    if (key === 'averageSentenceLength') {
      // 句长归一化至 0~1 区间参与距离计算 (以 50 字为标尺)
      const obs = (Number(observedVector[key]) || 20) / 50;
      const tgt = (Number(targetVector[key]) || 20) / 50;
      const diff = obs - tgt;
      deltas[key] = Number(diff.toFixed(3));
      sumSq += diff * diff;
      count++;
    } else {
      const obs = Number(observedVector[key]) || 0;
      const tgt = Number(targetVector[key]) || 0;
      const diff = obs - tgt;
      deltas[key] = Number(diff.toFixed(3));
      sumSq += diff * diff;
      count++;
    }
  }

  const distance = Number(Math.sqrt(sumSq / Math.max(1, count)).toFixed(3));
  // 欧氏归一化距离小于 0.25 视为文风高度稳定
  const isStable = distance <= 0.25;

  return Object.freeze({
    distance,
    isStable,
    dimensionDeltas: deltas
  });
}

/**
 * 闭环反馈：归因净化策略反馈学习器 (Attribution-Clean Strategy Feedback Updater)
 * 
 * 支持三种模式：
 * 1. 标量分值兼容回退 (Legacy Scalar Score): 接受纯数字 auditScore，执行 EMA 增益与置信度更新；
 * 2. 反事实配对 A-B 对照 (Counterfactual Paired A-B): 计算孤立干预效应 ΔQ = Q_treatment - Q_control，
 *    消解 parasitic hitchhiker 寄生搭便车，并显著降低 confoundScore；
 * 3. 对照保留集比较 (Controlled Holdout Comparison): 消除多规则共现通胀，按混淆度惩罚边际贡献。
 * 
 * @param {Object} strategyCard 原策略卡实体
 * @param {number|Object} feedbackContext 审计得分标量或结构化反馈上下文
 * @param {Object} options 更新选项 (alpha, causalAlpha 等)
 * @returns {Object} 带有更新后统计指标的新策略卡实体
 */
function updateStrategyFeedback(strategyCard, feedbackContext = 0.85, options = {}) {
  if (!strategyCard || typeof strategyCard !== 'object') {
    throw new TypeError('updateStrategyFeedback 需要有效的 strategyCard');
  }

  const oldStats = strategyCard.stats || {};
  const oldSupport = Number(oldStats.supportCount) || 1;
  const oldConfidence = Number(oldStats.confidence) || 0.85;
  const oldLift = Number(oldStats.qualityLift) || 0.15;
  const oldConfound = Number(oldStats.confoundScore ?? 0.10);

  const newSupport = oldSupport + 1;
  const alpha = Number(options.alpha ?? 0.15);

  let newConfidence = oldConfidence;
  let newLift = oldLift;
  let newConfound = oldConfound;

  if (typeof feedbackContext === 'number') {
    // Mode 3: Legacy numeric scalar score fallback
    const auditScore = Number(feedbackContext);
    const targetConf = auditScore >= 0.75 ? 1.0 : 0.4;
    newConfidence = Math.max(0.1, Math.min(1.0, Number((oldConfidence * (1 - alpha) + targetConf * alpha).toFixed(3))));
    const sampleLift = auditScore - 0.75;
    newLift = Number((oldLift * (1 - alpha) + sampleLift * alpha).toFixed(3));
    newConfound = oldConfound;
  } else if (feedbackContext && typeof feedbackContext === 'object') {
    const mode = feedbackContext.mode || (
      feedbackContext.counterfactual || (feedbackContext.treatmentScore !== undefined && feedbackContext.controlScore !== undefined)
        ? 'counterfactual_ab'
        : (feedbackContext.holdout || (feedbackContext.auditScore !== undefined && feedbackContext.holdoutBaselineScore !== undefined)
          ? 'holdout_comparison'
          : (feedbackContext.cleanLift !== undefined ? 'ablation' : 'standard'))
    );

    if (mode === 'counterfactual_ab') {
      // Mode 1: Counterfactual paired A-B comparisons
      const treatmentScore = Number(feedbackContext.treatmentScore ?? 0.85);
      const controlScore = Number(feedbackContext.controlScore ?? 0.75);
      const cleanLift = treatmentScore - controlScore;

      newLift = Number((oldLift * (1 - alpha) + cleanLift * alpha).toFixed(3));

      // 干净干预效应驱动置信度更新 (如果 ΔQ 为负，即使总体合格也予以惩罚)
      const targetConf = cleanLift > 0 ? 1.0 : (cleanLift === 0 ? 0.5 : 0.35);
      newConfidence = Math.max(0.1, Math.min(1.0, Number((oldConfidence * (1 - alpha) + targetConf * alpha).toFixed(3))));

      // 因果 A-B 对照消解混淆度风险
      const causalAlpha = Number(options.causalAlpha ?? 0.20);
      newConfound = Math.max(0.01, Math.min(1.0, Number((oldConfound * (1 - causalAlpha)).toFixed(3))));
    } else if (mode === 'holdout_comparison') {
      // Mode 2: Controlled holdout comparisons
      const auditScore = Number(feedbackContext.auditScore ?? 0.85);
      const holdoutBaseline = Number(feedbackContext.holdoutBaselineScore ?? feedbackContext.baselineScore ?? 0.75);
      const activeRuleCount = Math.max(1, Number(feedbackContext.activeRuleCount ?? feedbackContext.ruleCount ?? 1));
      const groupLift = auditScore - holdoutBaseline;

      // 剔除共现通胀，按混淆度惩罚边际贡献
      const cleanLift = (groupLift / activeRuleCount) * (1.0 - 0.5 * oldConfound);
      newLift = Number((oldLift * (1 - alpha) + cleanLift * alpha).toFixed(3));

      const targetConf = cleanLift > 0 ? 0.90 : 0.40;
      newConfidence = Math.max(0.1, Math.min(1.0, Number((oldConfidence * (1 - alpha) + targetConf * alpha).toFixed(3))));

      // 多规则共现未做干预剥离时，混淆度不降低 (规则过多时轻微递增)
      const confoundInc = activeRuleCount > 2 ? 0.02 : 0;
      newConfound = Math.min(1.0, Number((oldConfound + confoundInc).toFixed(3)));
    } else if (mode === 'ablation') {
      // Mode 4: Direct ablation / clean lift
      const cleanLift = Number(feedbackContext.cleanLift ?? 0);
      newLift = Number((oldLift * (1 - alpha) + cleanLift * alpha).toFixed(3));

      const targetConf = cleanLift > 0 ? 0.95 : 0.35;
      newConfidence = Math.max(0.1, Math.min(1.0, Number((oldConfidence * (1 - alpha) + targetConf * alpha).toFixed(3))));
      newConfound = Math.max(0.01, Math.min(1.0, Number((oldConfound * 0.95).toFixed(3))));
    } else {
      // Standard / fallback object
      const auditScore = Number(feedbackContext.auditScore ?? 0.85);
      const targetConf = auditScore >= 0.75 ? 1.0 : 0.4;
      newConfidence = Math.max(0.1, Math.min(1.0, Number((oldConfidence * (1 - alpha) + targetConf * alpha).toFixed(3))));
      const sampleLift = auditScore - 0.75;
      newLift = Number((oldLift * (1 - alpha) + sampleLift * alpha).toFixed(3));
      newConfound = oldConfound;
    }
  }

  const updatedCard = {
    ...strategyCard,
    stats: Object.freeze({
      ...oldStats,
      supportCount: newSupport,
      confidence: newConfidence,
      qualityLift: newLift,
      confoundScore: newConfound
    })
  };

  return Object.freeze(updatedCard);
}

/**
 * 批量执行归因净化策略反馈学习
 * @param {Array<Object>} strategyCards 策略规则卡列表
 * @param {Object} feedbackBatch 批量反馈上下文
 * @param {Object} options 更新选项
 * @returns {Array<Object>} 带有 attributionReport 属性的更新后策略卡列表
 */
function batchUpdateStrategyFeedback(strategyCards = [], feedbackBatch = {}, options = {}) {
  if (!Array.isArray(strategyCards)) {
    throw new TypeError('batchUpdateStrategyFeedback 需要策略卡数组');
  }

  const baselineScore = Number(feedbackBatch.baselineScore ?? feedbackBatch.holdoutBaselineScore ?? 0.75);
  const updatedCards = [];
  const attributionDetails = [];

  const dimensionScores = feedbackBatch.dimensionScores || null;
  const ruleFeedbackMap = feedbackBatch.ruleFeedback || feedbackBatch.rules || null;

  for (const card of strategyCards) {
    let cardContext = null;

    if (ruleFeedbackMap && (ruleFeedbackMap[card.id] !== undefined)) {
      cardContext = ruleFeedbackMap[card.id];
    } else if (dimensionScores && typeof dimensionScores === 'object') {
      // 维度靶向归因
      const cardText = `${card.id || ''} ${card.ruleStatement || ''} ${card.abstractPattern || ''} ${(card.tags || []).join(' ')} ${card.category || ''}`.toLowerCase();
      
      let matchedDim = null;
      let matchedScore = null;

      for (const [dim, score] of Object.entries(dimensionScores)) {
        const dimLower = String(dim).toLowerCase();
        let isMatch = false;
        if (cardText.includes(dimLower)) isMatch = true;
        if ((dimLower === 'suspense' || dimLower === '悬念') && (cardText.includes('悬念') || cardText.includes('suspense') || cardText.includes('hook'))) isMatch = true;
        if ((dimLower === 'dialogue' || dimLower === '对话') && (cardText.includes('对话') || cardText.includes('dialogue') || cardText.includes('留白'))) isMatch = true;
        if ((dimLower === 'pacing' || dimLower === '节奏') && (cardText.includes('节奏') || cardText.includes('pacing'))) isMatch = true;

        if (isMatch) {
          matchedDim = dim;
          matchedScore = Number(score);
          break;
        }
      }

      if (matchedScore !== null) {
        const cleanLift = Number((matchedScore - baselineScore).toFixed(3));
        cardContext = {
          mode: 'ablation',
          cleanLift,
          dimension: matchedDim,
          score: matchedScore
        };
      } else {
        cardContext = {
          mode: 'holdout_comparison',
          auditScore: baselineScore,
          holdoutBaselineScore: baselineScore,
          activeRuleCount: strategyCards.length
        };
      }
    } else {
      cardContext = {
        ...feedbackBatch,
        activeRuleCount: feedbackBatch.activeRuleCount ?? strategyCards.length
      };
    }

    const updated = updateStrategyFeedback(card, cardContext, options);
    updatedCards.push(updated);
    attributionDetails.push({
      cardId: card.id,
      oldLift: card.stats?.qualityLift,
      newLift: updated.stats?.qualityLift,
      oldConfidence: card.stats?.confidence,
      newConfidence: updated.stats?.confidence,
      context: cardContext
    });
  }

  const attributionReport = Object.freeze({
    ruleCount: strategyCards.length,
    mode: feedbackBatch.mode || (dimensionScores ? 'dimension_targeted' : 'batch_holdout'),
    details: attributionDetails
  });

  const output = [...updatedCards];
  output.updatedCards = Object.freeze(updatedCards);
  output.attributionReport = attributionReport;

  return Object.freeze(output);
}

module.exports = {
  evaluateDisentanglementFidelity,
  evaluateOutcomeContractFulfillment,
  evaluateStyleDistance,
  updateStrategyFeedback,
  batchUpdateStrategyFeedback,
  detectEntityMentions,
  detectEventOccurrences,
  verifyNarrativeStateTransition,
  TRANSITION_DOMAINS
};
