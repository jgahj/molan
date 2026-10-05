'use strict';

/**
 * @file candidate-screener.js
 * 优秀章节多目标分层两阶段筛选器 (Two-Stage Multi-Dimensional Candidate Chapter Screener)
 * 
 * 核心设计目标：
 * 1. 严格杜绝将 1279 部小说的所有章节盲目执行重型 LLM 因子化（极度昂贵且浪费）；
 * 2. 第一阶段（便宜筛选）：纯规则与统计学物理特征秒级计算（零 Token 消耗）；
 * 3. 拒绝“唯高爽论”：按 8 大维度独立分层筛选优秀章节：
 *    - thrill (爽点优秀)
 *    - plot (剧情优秀)
 *    - character (人物优秀)
 *    - emotion (情绪优秀)
 *    - suspense (悬疑优秀)
 *    - style (文风优秀)
 *    - hook (章末钩子优秀)
 *    - pacing (节奏优秀)
 * 4. 第二阶段：仅对通过第一阶段的高价值候选章节执行正交因子化特征抽取。
 */

const { extractChapterFactors, disentangleStyleFromGoal } = require('./factorized-extractor');

const DIMENSION_KEYS = Object.freeze([
  'thrill',
  'plot',
  'character',
  'emotion',
  'suspense',
  'style',
  'hook',
  'pacing'
]);

// 廉价水文与废话词组黑名单
const WATER_PHRASES = [
  '总而言之', '言归正传', '闲话休提', '却说', '话说', '且说', '不知不觉间',
  '不得不说', '话分两头', '按下不表', '众所周知', '书接上回', '且听下回分解'
];

// 常见机械 AI 套套词
const AI_FLAVOR_PHRASES = [
  '嘴角勾起', '倒吸一口凉气', '瞳孔骤缩', '心中涌起', '仿佛在诉说',
  '冷笑一声', '玩味的笑容', '深吸一口气', '眼神中闪过一丝', '不可置信'
];

/**
 * 第一阶段：便宜物理特征统计与多目标分层打分 (Stage 1 Cheap Screener)
 * @param {string} chapterText 章节完整正文
 * @param {Object} metadata 章节元数据
 * @returns {Object} 筛选报告与各维度打分
 */
function screenCandidateChapter(chapterText = '', metadata = {}) {
  const content = String(chapterText || '').trim();
  const totalChars = content.length;

  const minChars = Math.max(100, Number(metadata.minChars || 600));
  if (totalChars < minChars) {
    return {
      isCandidate: false,
      rejectionReason: `字数过少 (不足${minChars}字)`,
      dimensionScores: {},
      qualifiedDimensions: []
    };
  }

  // 1. 基础物理指标快速计算
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const sentences = content.split(/[。！？!?\n]+/).map(s => s.trim()).filter(Boolean);
  const sentenceCount = Math.max(1, sentences.length);
  const avgSentenceLen = totalChars / sentenceCount;

  // 重复率 (简易 3-gram 重复率测算)
  const trigramMap = new Map();
  let repeatedCount = 0;
  const sampleText = content.slice(0, Math.min(3000, totalChars));
  for (let i = 0; i <= sampleText.length - 3; i += 3) {
    const gram = sampleText.slice(i, i + 3);
    const count = (trigramMap.get(gram) || 0) + 1;
    trigramMap.set(gram, count);
    if (count > 2) repeatedCount++;
  }
  const repetitionRate = Number((repeatedCount / Math.max(10, sampleText.length / 3)).toFixed(3));

  // 水文占比与 AI 味检出
  const waterMatchCount = WATER_PHRASES.reduce((acc, p) => acc + (content.split(p).length - 1), 0);
  const waterinessRate = Number((waterMatchCount / Math.max(5, sentenceCount / 10)).toFixed(3));

  const aiMatchCount = AI_FLAVOR_PHRASES.reduce((acc, p) => acc + (content.split(p).length - 1), 0);
  const aiFlavorRisk = Number((aiMatchCount / Math.max(5, sentenceCount / 10)).toFixed(3));

  // 对白占比
  const dialogueMatches = content.match(/“[^”]+”|"([^"]+)"/g) || [];
  const dialogueChars = dialogueMatches.reduce((acc, d) => acc + d.length, 0);
  const dialogueRatio = Number((dialogueChars / totalChars).toFixed(3));

  // 动作与物理动词密度
  const actionVerbs = (content.match(/冲|杀|斩|劈|刺|轰|撞|退|按|扣|崩|裂|砸|拔|闪|握|碾/g) || []).length;
  const actionDensity = Number((actionVerbs / Math.max(10, totalChars / 100)).toFixed(3));

  // 疑问与悬念标记
  const questionMarks = (content.match(/[？?]/g) || []).length;
  const mysteryKeywords = (content.match(/到底|为何|秘密|残缺|疑云|异样|血迹|原来|不对劲|究竟/g) || []).length;
  const mysteryIntensity = Number(((questionMarks * 1.5 + mysteryKeywords) / Math.max(5, sentenceCount / 10)).toFixed(3));

  // 人物微表情与细腻心理反应
  const emotionSensoryVerbs = (content.match(/指尖|喉结|呼吸|后背|冷汗|发麻|僵住|咬牙|视线|低头/g) || []).length;
  const emotionIntensity = Number((emotionSensoryVerbs / Math.max(5, sentenceCount / 15)).toFixed(3));

  // 末尾 250 字钩子强度
  const tail = content.slice(-250);
  const hasQuestionHook = /[？?]/.test(tail) || /为何|怎么会|究竟|难道/i.test(tail);
  const hasDangerHook = /轰然|杀至|突变|不好|破门|倒飞/i.test(tail);
  const hasClueHook = /墨迹|古钱|残图|印记|字迹|暗格/i.test(tail);
  const hookScore = (hasQuestionHook ? 0.35 : 0) + (hasDangerHook ? 0.35 : 0) + (hasClueHook ? 0.35 : 0) + 0.2;

  // 2. 8 大维度独立归一化评估 (0.0 ~ 1.0)
  const scores = {
    // 爽点优秀：高物理对抗、破局压制、高反馈
    thrill: Number(Math.min(1.0, actionDensity * 0.5 + (dialogueRatio >= 0.25 ? 0.2 : 0) + (content.includes('突破') || content.includes('败') || content.includes('斩') ? 0.3 : 0.1)).toFixed(2)),

    // 剧情优秀：状态不可逆推进、关键转折
    plot: Number(Math.min(1.0, 0.4 + (content.includes('原来') || content.includes('真相') || content.includes('决定') ? 0.3 : 0.1) + (dialogueRatio >= 0.2 && dialogueRatio <= 0.5 ? 0.2 : 0.05)).toFixed(2)),

    // 人物优秀：对白机锋充足、有肢体微动作、非脸谱化
    character: Number(Math.min(1.0, (dialogueRatio >= 0.3 ? 0.4 : 0.2) + emotionIntensity * 0.3 + (aiFlavorRisk <= 0.15 ? 0.3 : 0.05)).toFixed(2)),

    // 情绪优秀：高微表情、压迫感、张力余韵
    emotion: Number(Math.min(1.0, emotionIntensity * 0.6 + (avgSentenceLen <= 32 ? 0.3 : 0.1)).toFixed(2)),

    // 悬念优秀：物证异样、高疑问密度、信息缺口
    suspense: Number(Math.min(1.0, mysteryIntensity * 0.6 + (hasClueHook ? 0.3 : 0.1)).toFixed(2)),

    // 文风优秀：冷硬克制、低套路AI味、低水文、短句适中
    style: Number(Math.min(1.0, (aiFlavorRisk <= 0.1 ? 0.4 : 0.1) + (waterinessRate <= 0.05 ? 0.3 : 0.1) + (avgSentenceLen >= 18 && avgSentenceLen <= 35 ? 0.3 : 0.1)).toFixed(2)),

    // 钩子优秀：章末缺口明确
    hook: Number(Math.min(1.0, hookScore).toFixed(2)),

    // 节奏优秀：对白与叙述动静交错，无长篇说明书
    pacing: Number(Math.min(1.0, (dialogueRatio >= 0.25 && dialogueRatio <= 0.55 ? 0.4 : 0.2) + (repetitionRate <= 0.15 ? 0.3 : 0.1) + (waterinessRate <= 0.08 ? 0.3 : 0.05)).toFixed(2))
  };

  // 3. 门槛硬拦截（过滤严重注水与刷字章节）
  if (waterinessRate > 0.40 || repetitionRate > 0.30) {
    return {
      isCandidate: false,
      rejectionReason: `注水或重复率过高 (水文率: ${waterinessRate}, 重复率: ${repetitionRate})`,
      dimensionScores: scores,
      qualifiedDimensions: []
    };
  }

  // 4. 多目标分层晋级判定：任何一个维度达到 0.65 且文风及格即可晋级
  const qualifiedDimensions = Object.entries(scores)
    .filter(([_, score]) => score >= 0.65)
    .map(([dim]) => dim);

  const isCandidate = qualifiedDimensions.length >= 1;
  const bestDimension = isCandidate
    ? Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0]
    : null;

  return {
    isCandidate,
    primaryDimension: bestDimension,
    dimensionScores: scores,
    qualifiedDimensions,
    rejectionReason: isCandidate ? null : '未达任何优秀维度的候选门槛'
  };
}

/**
 * 第二阶段：对候选章节执行深度正交因子化抽取 (Stage 2 Deep Factorization)
 * @param {string} chapterText 候选章节正文
 * @param {Object} metadata 章节元数据
 * @param {Object} screenerResult 第一阶段筛选产物
 * @returns {Object} 丰富的因子化特征包 (ChapterFeatures)
 */
function factorizeCandidateChapter(chapterText = '', metadata = {}, screenerResult = null) {
  const screener = screenerResult || screenCandidateChapter(chapterText, metadata);
  const baseFactors = extractChapterFactors(chapterText, metadata);
  const pureStylometry = disentangleStyleFromGoal(baseFactors.stylometry, baseFactors.primaryGoal);

  return Object.freeze({
    schemaVersion: 'chapter-features-v2',
    novelTitle: metadata.title || metadata.novelTitle || '',
    bookId: metadata.bookId || metadata.book_id || '',
    chapterNo: metadata.chapterNo ?? metadata.chapter_no ?? 1,
    chapterTitle: metadata.chapterTitle || metadata.title || '',
    genre: metadata.genre || 'universal',
    screener: Object.freeze({
      primaryDimension: screener.primaryDimension,
      qualifiedDimensions: [...screener.qualifiedDimensions],
      scores: { ...screener.dimensionScores }
    }),
    primaryGoal: baseFactors.primaryGoal,
    secondaryGoals: baseFactors.secondaryGoals,
    focusVector: baseFactors.focusVector,
    tailHook: baseFactors.tailHook,
    outcomeContract: baseFactors.outcomeContract,
    stylometry: pureStylometry,
    totalChars: baseFactors.totalChars,
    extractedAt: new Date().toISOString()
  });
}

module.exports = {
  DIMENSION_KEYS,
  screenCandidateChapter,
  factorizeCandidateChapter
};
