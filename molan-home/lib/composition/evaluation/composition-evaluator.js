'use strict';

/**
 * @file composition-evaluator.js
 * 创作评测体系与闭环反馈学习引擎 (Composition Evaluator & Quality Feedback)
 * 
 * 核心功能：
 * 1. 解耦保真度评测 (Disentanglement Fidelity)：检测题材边界围栏 (forbiddenAssumptions) 是否被越权破坏；
 * 2. Outcome Contract 达成度检验：评估状态跃迁与人物信念/读者预期是否在正文中扎实落定；
 * 3. 文风距离稳定性测算 (Style Distance Stability)：以欧氏距离度量正文实际风格与目标向量的偏离度；
 * 4. 闭环反馈更新器 (Strategy Feedback Updater)：根据生成质量评测结果，自适应更新策略规则的置信度与质量增益。
 */

const { checkForbiddenAssumptions } = require('../profiles/genre-profile');
const { STYLE_VECTOR_KEYS } = require('../profiles/style-profile');

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
 * 检验正文对结果契约 (Narrative Outcome Contract) 的履约达成度
 * @param {string} text 生成正文
 * @param {Object} outcomeContract 结果契约实体
 * @returns {Object} { passed, fulfillmentScore, observations }
 */
function evaluateOutcomeContractFulfillment(text, outcomeContract) {
  const content = String(text || '');
  if (!content) return { passed: false, fulfillmentScore: 0, observations: ['正文为空'] };

  const delta = outcomeContract?.stateDelta || {};
  const observations = [];
  let score = 0.85;

  // 1. 存在性检验：如果定义了推进事件，检查正文中是否有事件关键实体提及
  if (Array.isArray(delta.events) && delta.events.length) {
    const matchedCount = delta.events.filter(ev => {
      // 提取事件中的实词（简单2字以上片段）
      const tokens = String(ev).match(/[\u4e00-\u9fa5]{2,4}/g) || [];
      return tokens.some(t => content.includes(t));
    }).length;

    if (matchedCount > 0) {
      score += 0.10;
      observations.push(`检测到 ${matchedCount} 项推进事件的核心事实落地`);
    } else {
      score -= 0.15;
      observations.push('未检测到推进事件的核心实体');
    }
  }

  // 2. 状态跃迁达成检验
  if (delta.stateAfter?.summary && content.length > 200) {
    score += 0.05;
  }

  const finalScore = Math.max(0.1, Math.min(1.0, Number(score.toFixed(2))));
  return Object.freeze({
    passed: finalScore >= 0.75,
    fulfillmentScore: finalScore,
    observations
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
 * 闭环反馈：根据本次生成审计质量，自适应更新策略卡的置信度与质量提振度
 * @param {Object} strategyCard 原策略卡实体
 * @param {Object} auditScore 本次生成质检得分 (0.0 ~ 1.0)
 * @returns {Object} 带有更新后统计指标的新策略卡实体
 */
function updateStrategyFeedback(strategyCard, auditScore = 0.85) {
  if (!strategyCard || typeof strategyCard !== 'object') {
    throw new TypeError('updateStrategyFeedback 需要有效的 strategyCard');
  }

  const oldStats = strategyCard.stats || {};
  const oldSupport = Number(oldStats.supportCount) || 1;
  const oldConfidence = Number(oldStats.confidence) || 0.85;
  const oldLift = Number(oldStats.qualityLift) || 0.15;

  const newSupport = oldSupport + 1;
  // EMA 滑动更新置信度
  const alpha = 0.15;
  const newConfidence = Math.max(0.1, Math.min(1.0, Number((oldConfidence * (1 - alpha) + (auditScore >= 0.75 ? 1.0 : 0.4) * alpha).toFixed(3))));
  const sampleLift = Number(auditScore) - 0.75;
  const newLift = Number((oldLift * (1 - alpha) + sampleLift * alpha).toFixed(3));

  const updatedCard = {
    ...strategyCard,
    stats: Object.freeze({
      ...oldStats,
      supportCount: newSupport,
      confidence: newConfidence,
      qualityLift: newLift
    })
  };

  return Object.freeze(updatedCard);
}

module.exports = {
  evaluateDisentanglementFidelity,
  evaluateOutcomeContractFulfillment,
  evaluateStyleDistance,
  updateStrategyFeedback
};
