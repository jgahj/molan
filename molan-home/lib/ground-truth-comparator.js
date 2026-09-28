'use strict';

/**
 * ground-truth-comparator.js
 * ---------------------------------------------------------------------------
 * 原文真机三角对照评测引擎 (Ground Truth Triad Comparator)
 *
 * 核心设计目标：
 * 1. 实现双版本生成小说与原文真机的三角对照：
 *    - 对照 A: 详细版生成 (V_detailed) vs 名家原本情节 (O)
 *    - 对照 B: 粗略版生成 (V_coarse) vs 名家原本情节 (O)
 *    - 对照 C: 详细版 vs 粗略版 (V_detailed vs V_coarse，量化提示词敏感度)
 * 2. 彻底揭示 AI 生成小说与名家原本的真实差距（结构、节奏、人味、受力描写）；
 * 3. 统计计算提示词敏感度指数 (PSI - Prompt Sensitivity Index)。
 * ---------------------------------------------------------------------------
 */

const { computeAiFlavorScore } = require('./ai-flavor-detector');
const { calculateStyleDistance } = require('./style-fingerprint');

/**
 * 提取文本的物理指纹特征
 */
function extractTextFeatures(text = '') {
  const clean = String(text || '').trim();
  const charCount = clean.length;
  const paragraphs = clean.split(/\r?\n+/).filter(p => p.trim());

  // 对白提取 (双引号内的文本)
  const quotes = [...clean.matchAll(/“([^”]+)”|"([^"]+)"/g)].map(m => m[1] || m[2]);
  const dialogueCharCount = quotes.reduce((sum, q) => sum + q.length, 0);
  const dialogueRatio = charCount > 0 ? (dialogueCharCount / charCount) : 0;

  // 句子切分与均长
  const sentences = clean.split(/[。！？!?]/).filter(s => s.trim());
  const sentenceLengths = sentences.map(s => s.length);
  const sentenceLenMean = sentenceLengths.length > 0
    ? sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length
    : 0;

  // 物理受力感官词命中频次
  const somaticHits = (clean.match(/(?:骨骼|重力|形变|受压|气流|龟裂|下陷|震颤|吐血|倒退|寸步|肌肉|冷汗|发麻|微鸣)/g) || []).length;
  const somaticDensity = charCount > 0 ? (somaticHits / (charCount / 1000)) : 0;

  // 人性微弱点动作命中频次
  const humanWeaknessHits = (clean.match(/(?:自嘲|后怕|擦汗|苦笑|心知|发胀|吸气|微顿|迟疑|暗骂|侥幸|嘴硬)/g) || []).length;

  // AI味评分
  let aiFlavorScore = 0;
  try {
    const aiRes = computeAiFlavorScore(clean);
    aiFlavorScore = typeof aiRes === 'number' ? aiRes : (aiRes?.score || 18);
  } catch (_) {
    aiFlavorScore = 20;
  }

  return {
    charCount,
    paragraphCount: paragraphs.length,
    sentenceCount: sentences.length,
    sentenceLenMean: Math.round(sentenceLenMean * 10) / 10,
    dialogueRatio: Math.round(dialogueRatio * 1000) / 1000,
    somaticDensity: Math.round(somaticDensity * 100) / 100,
    humanWeaknessHits,
    aiFlavorScore: Math.round(aiFlavorScore * 10) / 10
  };
}

/**
 * 计算两组特征之间的综合文风差距距离 (0~100, 越小越相似)
 */
function calculateTextDistance(featA, featB) {
  const dRatioDiff = Math.abs(featA.dialogueRatio - featB.dialogueRatio) * 100;
  const sLenDiff = Math.abs(featA.sentenceLenMean - featB.sentenceLenMean) * 2;
  const somaticDiff = Math.abs(featA.somaticDensity - featB.somaticDensity) * 10;
  const aiDiff = Math.abs(featA.aiFlavorScore - featB.aiFlavorScore) * 0.8;

  const total = (dRatioDiff * 0.35) + (sLenDiff * 0.25) + (somaticDiff * 0.20) + (aiDiff * 0.20);
  return Math.min(100, Math.round(total * 10) / 10);
}

/**
 * 执行三角对照评测 (Triad Comparison)
 * @param {string} originalText 原文真机真实章节内容 (O)
 * @param {string} detailedGenText 详细提示词生成内容 (V_detailed)
 * @param {string} coarseGenText 粗略提示词生成内容 (V_coarse)
 * @param {Object} context 语境元数据 (bookTitle, author, genre, stage)
 */
function compareTriad(originalText, detailedGenText, coarseGenText, context = {}) {
  const featOrig = extractTextFeatures(originalText);
  const featDetailed = extractTextFeatures(detailedGenText);
  const featCoarse = extractTextFeatures(coarseGenText);

  // 1. 计算与原文的真实距离
  const distDetailedToOrig = calculateTextDistance(featDetailed, featOrig);
  const distCoarseToOrig = calculateTextDistance(featCoarse, featOrig);
  const distBetweenDetailedAndCoarse = calculateTextDistance(featDetailed, featCoarse);

  // 2. 计算提示词敏感度指数 (PSI - Prompt Sensitivity Index)
  // PSI 越接近 1.0，说明详细提示词相比粗略提示词对逼近原著起到了显著的正向纠偏效果；
  // 若 PSI 接近 0 或为负，说明详细提示词对模型影响微弱甚至导致了死板负优化。
  let psi = 0;
  if (distCoarseToOrig > 0) {
    psi = (distCoarseToOrig - distDetailedToOrig) / distCoarseToOrig;
  }
  psi = Math.max(-1.0, Math.min(1.0, Math.round(psi * 100) / 100));

  // 3. 维度逐项差距分析
  const gapsDetailed = {
    dialogueRatioGap: Math.round((featDetailed.dialogueRatio - featOrig.dialogueRatio) * 1000) / 10, // 百分点
    sentenceLenGap: Math.round((featDetailed.sentenceLenMean - featOrig.sentenceLenMean) * 10) / 10,
    somaticDensityGap: Math.round((featDetailed.somaticDensity - featOrig.somaticDensity) * 100) / 100,
    aiFlavorDelta: Math.round((featDetailed.aiFlavorScore - featOrig.aiFlavorScore) * 10) / 10
  };

  const gapsCoarse = {
    dialogueRatioGap: Math.round((featCoarse.dialogueRatio - featOrig.dialogueRatio) * 1000) / 10,
    sentenceLenGap: Math.round((featCoarse.sentenceLenMean - featOrig.sentenceLenMean) * 10) / 10,
    somaticDensityGap: Math.round((featCoarse.somaticDensity - featOrig.somaticDensity) * 100) / 100,
    aiFlavorDelta: Math.round((featCoarse.aiFlavorScore - featOrig.aiFlavorScore) * 10) / 10
  };

  // 4. 定性判定
  let verdict = 'detailed_superior';
  if (distDetailedToOrig <= distCoarseToOrig) {
    verdict = 'detailed_superior'; // 详细版更逼近名家原著
  } else {
    verdict = 'coarse_superior_or_overconstrained'; // 详细版过于拘束或粗略版自由发挥更佳
  }

  return {
    meta: {
      bookTitle: context.bookTitle || '未知作品',
      author: context.author || '名家',
      genre: context.genre || '玄幻',
      stage: context.stage || 'early'
    },
    features: {
      original: featOrig,
      detailed: featDetailed,
      coarse: featCoarse
    },
    distances: {
      detailedToOriginal: distDetailedToOrig,
      coarseToOriginal: distCoarseToOrig,
      betweenVersions: distBetweenDetailedAndCoarse
    },
    promptSensitivityIndex: psi,
    verdict,
    gapsDetailed,
    gapsCoarse
  };
}

module.exports = {
  extractTextFeatures,
  calculateTextDistance,
  compareTriad
};
