'use strict';

/**
 * @file style-profile.js
 * 文风核心 Profile 契约模型 (Style Profile)
 * 
 * 核心设计原则：
 * 1. 文风彻底脱离题材（题材 × 文风 正交组合）；
 * 2. 具备 11 维量化连续向量（Vectorized Stylometry）；
 * 3. 支持“作品级全局基因 + 章节级局部调制”机制；
 * 4. 包含确切的正面描写律与反面警戒律。
 */

const STYLE_VECTOR_KEYS = Object.freeze([
  'narrativeDensity',       // 叙事密度 (0~1)
  'emotionalIntensity',     // 情绪浓度 (0~1)
  'rhetoricalAbundance',    // 修辞丰度 (0~1)
  'colloquialLevel',        // 口语化程度 (0~1)
  'dialogueRatio',          // 对白占比 (0~1)
  'psychologicalRatio',     // 心理描写 (0~1)
  'settingRatio',           // 环境描写 (0~1)
  'averageSentenceLength',  // 句式平均字数 (正数，典型 12~35)
  'shortSentenceRatio',     // 短句比例 (0~1)
  'informationDensity',     // 信息密度 (0~1)
  'negativeSpaceRatio'      // 留白程度 (0~1)
]);

const DEFAULT_STYLE_VECTOR = Object.freeze({
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
});

function clamp(val, min = 0, max = 1) {
  const num = Number(val);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(max, num));
}

/**
 * 校验并归一化风格向量
 * @param {Object} rawVector
 * @returns {Object} 11 维规范化向量
 */
function normalizeStyleVector(rawVector = {}) {
  const input = rawVector || {};
  const normalized = {};

  for (const key of STYLE_VECTOR_KEYS) {
    if (key === 'averageSentenceLength') {
      const len = Number(input[key] ?? DEFAULT_STYLE_VECTOR[key]);
      normalized[key] = Number.isFinite(len) && len >= 6 ? Math.min(60, len) : DEFAULT_STYLE_VECTOR[key];
    } else {
      normalized[key] = clamp(input[key] ?? DEFAULT_STYLE_VECTOR[key], 0, 1);
    }
  }

  return Object.freeze(normalized);
}

/**
 * 局部文风调制运算函数 (Local Style Modulation)
 * 将章节级瞬时需求（如高潮高对抗）叠加于作品级基底文风之上
 * @param {Object} baseVector 作品基底风格向量
 * @param {Object} modulationDelta 章节级局部微调增量
 * @returns {Object} 调制后的当前章节风格向量
 */
function modulateStyle(baseVector = {}, modulationDelta = {}) {
  const base = normalizeStyleVector(baseVector);
  const delta = modulationDelta || {};
  const modulated = {};

  for (const key of STYLE_VECTOR_KEYS) {
    if (key === 'averageSentenceLength') {
      const d = Number(delta[key]) || 0;
      modulated[key] = Math.max(8, Math.min(50, base[key] + d));
    } else {
      const d = Number(delta[key]) || 0;
      modulated[key] = clamp(base[key] + d, 0, 1);
    }
  }

  return Object.freeze(modulated);
}

/**
 * 创建合规的 StyleProfile 实体
 * @param {Object} options
 * @returns {Object} 冻结的 StyleProfile 实体
 */
function createStyleProfile(options = {}) {
  const input = options || {};
  const id = String(input.id || '').trim();
  const name = String(input.name || '').trim();

  if (!id) throw new TypeError('StyleProfile 必须具备唯一 id');
  if (!name) throw new TypeError('StyleProfile 必须具备人类可读 name');

  const baseVector = normalizeStyleVector(input.baseVector);
  const positiveRules = Array.isArray(input.positiveRules)
    ? input.positiveRules.map(String).filter(Boolean)
    : [];
  const negativeRules = Array.isArray(input.negativeRules)
    ? input.negativeRules.map(String).filter(Boolean)
    : [];

  const profile = {
    schemaVersion: 'style-profile-v1',
    id,
    name,
    category: String(input.category || 'general'),
    baseVector,
    positiveRules,
    negativeRules,
    description: String(input.description || ''),
    microSamples: Array.isArray(input.microSamples) ? input.microSamples.map(String) : [],
    metadata: typeof input.metadata === 'object' && input.metadata !== null ? { ...input.metadata } : {}
  };

  return Object.freeze(profile);
}

/**
 * 编译文风策略指令块 (Style Policy Directive)
 * @param {Object} profile 
 * @param {Object} localModulation 章节级局部调制增量
 * @returns {string}
 */
function compileStylePolicy(profile, localModulation = null) {
  if (!profile) return '';
  const effectiveVector = localModulation
    ? modulateStyle(profile.baseVector, localModulation)
    : profile.baseVector;

  const vectorDesc = [
    `叙事密度: ${(effectiveVector.narrativeDensity * 100).toFixed(0)}%`,
    `情绪浓度: ${(effectiveVector.emotionalIntensity * 100).toFixed(0)}%`,
    `对白占比目标: ${(effectiveVector.dialogueRatio * 100).toFixed(0)}%`,
    `短句比例: ${(effectiveVector.shortSentenceRatio * 100).toFixed(0)}%`,
    `平均句长: ${effectiveVector.averageSentenceLength.toFixed(1)}字`,
    `留白克制: ${(effectiveVector.negativeSpaceRatio * 100).toFixed(0)}%`
  ].join(' | ');

  const lines = [
    `【文风质感策略·${profile.name}】`,
    `风格量化标尺：${vectorDesc}`,
    profile.positiveRules.length ? `必须遵循的笔触规范：\n${profile.positiveRules.map(r => `· ${r}`).join('\n')}` : '',
    profile.negativeRules.length ? `严厉禁止的行文禁忌：\n${profile.negativeRules.map(r => `· ${r}`).join('\n')}` : ''
  ].filter(Boolean);

  return lines.join('\n');
}

module.exports = {
  createStyleProfile,
  normalizeStyleVector,
  modulateStyle,
  compileStylePolicy,
  STYLE_VECTOR_KEYS,
  DEFAULT_STYLE_VECTOR
};
