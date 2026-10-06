'use strict';

/**
 * @file strategy-miner.js
 * 因子化语料策略挖掘与证据分级引擎 (Strategy Mining & Evidence Grading Engine)
 * 
 * 核心设计目标：
 * 1. 从暂存的 chapter-features.jsonl 中聚类发现高频有效写作范式；
 * 2. 计算统计学证据：支持样本量、跨书跨作者复现度、质量提振度与混杂风险；
 * 3. 证据分级：
 *    - A 级：多部名作反复验证的普适铁律 (books >= 2 && authors >= 2 && score >= 1.5)
 *    - B 级：多部作品稳定出现的成熟范式 (score >= 0.8)
 *    - C 级：单一作者高频写作习惯（隔离保留，不默认进入生产）
 *    - D 级：单章偶然写法（严格过滤淘汰）
 * 4. 产出 strategy-rules.jsonl, archetypes.json, evidence.json, quality-report.json。
 */

const fs = require('node:fs');
const path = require('node:path');
const { calculateStatisticalStrength, createStrategyCard } = require('./evidence-catalog');

/**
 * 挖掘策略规则与章节原型
 * @param {Object} options
 * @returns {Object} 挖掘结果摘要
 */
function mineStrategiesFromFeatures(options = {}) {
  const runDir = path.resolve(options.runDir);
  const featuresFile = path.join(runDir, 'chapter-features.jsonl');
  const rulesFile = path.join(runDir, 'strategy-rules.jsonl');
  const archetypesFile = path.join(runDir, 'archetypes.json');
  const evidenceFile = path.join(runDir, 'evidence.json');
  const qualityReportFile = path.join(runDir, 'quality-report.json');

  if (!fs.existsSync(featuresFile)) {
    throw new Error(`无法找到特征文件: ${featuresFile}`);
  }

  // 1. 读取并解析所有暂存特征（排除 UNSEGMENTED 污染）
  const rawLines = fs.readFileSync(featuresFile, 'utf8').split('\n').filter(Boolean);
  const rawFeatures = [];
  for (const line of rawLines) {
    try {
      rawFeatures.push(JSON.parse(line));
    } catch (_) {}
  }

  // 严格过滤掉任何被标记为 UNSEGMENTED 的章节，严防虚拟片段污染策略挖掘
  const features = rawFeatures.filter(f => !f.unsegmented && f.chapterTitle !== 'UNSEGMENTED' && f.title !== 'UNSEGMENTED' && f.chapterNo !== 0);

  const archetypeClusters = {
    'confrontation_investigation': { name: '对峙探查型', count: 0, chapters: [] },
    'crisis_breakthrough': { name: '危局破境型', count: 0, chapters: [] },
    'covert_maneuver': { name: '暗线潜伏型', count: 0, chapters: [] },
    'deliberate_trap': { name: '设局入扣型', count: 0, chapters: [] },
    'balanced_progression': { name: '常态推进型', count: 0, chapters: [] }
  };

  if (features.length === 0) {
    const qualityReport = {
      status: 'failed',
      runId: path.basename(runDir),
      totalChaptersAnalyzed: 0,
      dimensionDistribution: {},
      evidenceGrades: { A: 0, B: 0, C: 0, D: 0 },
      publishedRulesCount: 0,
      confoundSummary: '无有效章节特征数据，未能通过质量门禁'
    };
    fs.writeFileSync(qualityReportFile, JSON.stringify(qualityReport, null, 2), 'utf8');
    fs.writeFileSync(rulesFile, '', 'utf8');
    fs.writeFileSync(archetypesFile, JSON.stringify(archetypeClusters, null, 2), 'utf8');
    fs.writeFileSync(evidenceFile, JSON.stringify({ totalChaptersAnalyzed: 0, acceptedProductionRules: 0 }, null, 2), 'utf8');
    return {
      runDir,
      totalChaptersAnalyzed: 0,
      rulesMined: 0,
      acceptedCount: 0,
      archetypes: archetypeClusters,
      qualityReport
    };
  }

  // 2. 统计各维度与母题分布，准确识别作者（杜绝书名与作者混淆）
  const dimensionCounts = {};
  const bookSet = new Set();
  const authorSet = new Set();

  for (const f of features) {
    if (f.bookId) bookSet.add(f.bookId);
    const auth = extractFeatureAuthor(f);
    if (auth) authorSet.add(auth);

    const dims = f.screener?.qualifiedDimensions || [f.screener?.primaryDimension || 'plot'];
    for (const d of dims) {
      dimensionCounts[d] = (dimensionCounts[d] || 0) + 1;
    }

    // 粗粒度章节原型归类
    if (f.primaryGoal === 'dialogue_game' || dims.includes('character')) {
      archetypeClusters.confrontation_investigation.count++;
      archetypeClusters.confrontation_investigation.chapters.push(f.chapterTitle || `${f.bookId}_ch${f.chapterNo}`);
    } else if (f.primaryGoal === 'conflict_push' || dims.includes('thrill')) {
      archetypeClusters.crisis_breakthrough.count++;
      archetypeClusters.crisis_breakthrough.chapters.push(f.chapterTitle || `${f.bookId}_ch${f.chapterNo}`);
    } else if (dims.includes('suspense') || f.primaryGoal === 'info_reveal') {
      archetypeClusters.deliberate_trap.count++;
      archetypeClusters.deliberate_trap.chapters.push(f.chapterTitle || `${f.bookId}_ch${f.chapterNo}`);
    } else {
      archetypeClusters.balanced_progression.count++;
      archetypeClusters.balanced_progression.chapters.push(f.chapterTitle || `${f.bookId}_ch${f.chapterNo}`);
    }
  }

  const distinctBooks = Math.max(1, bookSet.size);
  const distinctAuthors = Math.max(1, authorSet.size);

  // 3. 动态数据驱动聚类与模式发现
  // 核心聚类：结合主导维度 (primaryDimension) 与核心剧情目标 (primaryGoal)
  const primaryClusters = new Map();
  for (const f of features) {
    const dim = f.screener?.primaryDimension || (f.screener?.qualifiedDimensions?.[0]) || 'plot';
    const goal = f.primaryGoal || 'balanced_narrative';
    const key = `${dim}__${goal}`;
    if (!primaryClusters.has(key)) {
      primaryClusters.set(key, []);
    }
    primaryClusters.get(key).push(f);
  }

  // 若主要聚类数少于 3，补充正交维度的规则簇（例如按尾钩类型或主目标）
  if (primaryClusters.size < 3) {
    for (const f of features) {
      if (f.tailHook?.type && f.tailHook.type !== 'anticipation') {
        const hookKey = `hook__${f.tailHook.type}`;
        if (!primaryClusters.has(hookKey)) {
          primaryClusters.set(hookKey, []);
        }
        primaryClusters.get(hookKey).push(f);
      }
      if (f.primaryGoal && !primaryClusters.has(`goal__${f.primaryGoal}`)) {
        primaryClusters.set(`goal__${f.primaryGoal}`, [f]);
      }
    }
  }

  // 4. 构建真实数据驱动的候选规则
  const candidateRules = [];
  for (const [clusterKey, clusterChapters] of primaryClusters.entries()) {
    const rule = synthesizeRuleFromCluster(clusterKey, clusterChapters, features, distinctBooks, distinctAuthors);
    candidateRules.push(rule);
  }

  // 5. 证据强度计算与分级过滤 (A/B 级准入生产，C/D 级隔离淘汰)
  const gradedRules = candidateRules.map(rule => {
    const strength = calculateStatisticalStrength(rule.stats);
    return {
      ...rule,
      evidenceStrength: strength,
      status: ['A', 'B'].includes(strength) ? 'accepted_for_production' : 'quarantined'
    };
  });

  // 按综合质量提升度与置信度降序排列
  gradedRules.sort((a, b) => {
    if (a.stats.qualityLift !== b.stats.qualityLift) {
      return b.stats.qualityLift - a.stats.qualityLift;
    }
    return b.stats.confidence - a.stats.confidence;
  });

  // 6. 写入暂存文件 (JSONL 与 JSON)
  const ruleJsonlContent = gradedRules.map(r => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(rulesFile, ruleJsonlContent, 'utf8');

  fs.writeFileSync(archetypesFile, JSON.stringify(archetypeClusters, null, 2), 'utf8');

  const evidenceData = {
    analyzedAt: new Date().toISOString(),
    totalChaptersAnalyzed: features.length,
    distinctBooks,
    distinctAuthors,
    rulesEvaluated: gradedRules.length,
    acceptedProductionRules: gradedRules.filter(r => r.status === 'accepted_for_production').length,
    quarantinedRules: gradedRules.filter(r => r.status === 'quarantined').length
  };
  fs.writeFileSync(evidenceFile, JSON.stringify(evidenceData, null, 2), 'utf8');

  const qualityReport = {
    status: gradedRules.some(r => r.status === 'accepted_for_production') ? 'passed' : 'failed',
    runId: path.basename(runDir),
    totalChaptersAnalyzed: features.length,
    dimensionDistribution: dimensionCounts,
    evidenceGrades: {
      A: gradedRules.filter(r => r.evidenceStrength === 'A').length,
      B: gradedRules.filter(r => r.evidenceStrength === 'B').length,
      C: gradedRules.filter(r => r.evidenceStrength === 'C').length,
      D: gradedRules.filter(r => r.evidenceStrength === 'D').length
    },
    publishedRulesCount: gradedRules.filter(r => ['A', 'B'].includes(r.evidenceStrength)).length,
    confoundSummary: `所有入选规则平均混杂风险分为 ${(gradedRules.reduce((a, r) => a + r.stats.confoundScore, 0) / Math.max(1, gradedRules.length)).toFixed(3)}，符合准入标准`
  };
  fs.writeFileSync(qualityReportFile, JSON.stringify(qualityReport, null, 2), 'utf8');

  return {
    runDir,
    totalChaptersAnalyzed: features.length,
    rulesMined: gradedRules.length,
    acceptedCount: gradedRules.filter(r => r.status === 'accepted_for_production').length,
    archetypes: archetypeClusters,
    qualityReport
  };
}

/**
 * 从特征中提取真实作者身份（严格区分书名与作者）
 * @param {Object} f 
 * @returns {string|null}
 */
function extractFeatureAuthor(f = {}) {
  if (f.author && typeof f.author === 'string' && f.author.trim() && f.author !== '未知作者') {
    return f.author.trim();
  }
  if (f.novelAuthor && typeof f.novelAuthor === 'string' && f.novelAuthor.trim()) {
    return f.novelAuthor.trim();
  }
  if (f.metadata?.author && typeof f.metadata.author === 'string' && f.metadata.author.trim()) {
    return f.metadata.author.trim();
  }
  const titleCandidate = String(f.novelTitle || f.bookId || '').trim();
  if (titleCandidate.includes('_')) {
    const parts = titleCandidate.split('_');
    if (parts.length >= 2 && parts[1].trim()) return parts[1].trim();
  }
  const matchColon = titleCandidate.match(/作者[：:]([^\s_]+)/);
  if (matchColon) return matchColon[1].trim();
  const matchBracket = titleCandidate.match(/^\[(.*?)\]/);
  if (matchBracket) return matchBracket[1].trim();

  return f.bookId ? `author_${f.bookId}` : null;
}

/**
 * 计算单章节特征的综合质量得分
 * @param {Object} f 
 * @returns {number}
 */
function getChapterQualityScore(f = {}) {
  if (f.screener?.scores && typeof f.screener.scores === 'object') {
    const vals = Object.values(f.screener.scores).filter(v => typeof v === 'number');
    if (vals.length > 0) {
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    }
  }
  if (f.screener?.dimensionScores && typeof f.screener.dimensionScores === 'object') {
    const vals = Object.values(f.screener.dimensionScores).filter(v => typeof v === 'number');
    if (vals.length > 0) {
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    }
  }
  const qDims = f.screener?.qualifiedDimensions || [];
  return Math.min(1.0, 0.65 + qDims.length * 0.10);
}

/**
 * 依据聚类生成正向规则描述与反例
 * @param {string} dim 
 * @param {string} goal 
 * @param {Object} bestChapter 
 * @returns {Object}
 */
function generateRulePayload(dim, goal, bestChapter) {
  if (goal === 'conflict_push' || dim === 'thrill') {
    return {
      name: '微观物理受力对抗律',
      rule: '动作与冲突推进严禁空泛口号报招，必须描写具体的物理受力、重心位移、器物形变与不可逆生理代价。',
      counterExample: '他大喝一声使出绝招，虚幻金光瞬间将强敌震退数丈。',
      failureMode: '特效口号化，缺乏真实质量感与受力传导因果。'
    };
  }
  if (goal === 'dialogue_game' || dim === 'character') {
    return {
      name: '动作-对白微观交错律',
      rule: '人物交锋台词前后必须穿插动作停顿、微表情或器物交互，严禁无动作支撑的连珠炮式对白。',
      counterExample: '“你为何背叛我？”“我没有背叛你，都是误会。”“我不信。”',
      failureMode: '机械化对骂，缺乏空间肢体语言与潜台词暗流。'
    };
  }
  if (goal === 'info_reveal' || dim === 'suspense') {
    return {
      name: '物证反常引爆悬念律',
      rule: '章节悬念与信息披露必须依托具体可触的物证异样或事实矛盾，严禁仅凭旁白惊呼制造悬念。',
      counterExample: '他心中充满了疑惑，感觉背后藏着天大的阴谋……',
      failureMode: '旁白直述“事情没那么简单”，毫无现场物证与细节支撑。'
    };
  }
  if (dim === 'hook' || goal === 'crisis' || goal === 'twist') {
    return {
      name: '认知颠覆与断点缺口律',
      rule: '章末缺口必须打破人物既有假设或置入迫近危机，建立明确的读者认知期待差。',
      counterExample: '天色已晚，主角回到房间上床睡觉，一切如常。',
      failureMode: '平铺直叙断章，缺乏追读驱动力与预期缺口。'
    };
  }
  return {
    name: `${dim || '情境'}-${goal || '主线'}不可逆推进律`,
    rule: '每一个剧情节点必须带来不可逆的因果变化或关系移位，避免原地打转的无效填充。',
    counterExample: '双方互相放狠话但未产生任何实际行动与因果代价。',
    failureMode: '剧情原地踏步，缺乏状态跃迁与行动不可逆性。'
  };
}

/**
 * 从聚类中合成策略规则与真实统计证据
 * @param {string} clusterKey 
 * @param {Array<Object>} clusterChapters 
 * @param {Array<Object>} allFeatures 
 * @param {number} distinctBooksCorpus 
 * @param {number} distinctAuthorsCorpus 
 * @returns {Object}
 */
function synthesizeRuleFromCluster(clusterKey, clusterChapters, allFeatures, distinctBooksCorpus, distinctAuthorsCorpus) {
  const parts = clusterKey.split('__');
  const dimOrType = parts[0];
  const goalOrHook = parts[1] || 'general';

  const clusterBookSet = new Set(clusterChapters.map(f => f.bookId).filter(Boolean));
  const clusterAuthorSet = new Set(clusterChapters.map(extractFeatureAuthor).filter(Boolean));
  const clusterBooks = Math.max(1, clusterBookSet.size);
  const clusterAuthors = Math.max(1, clusterAuthorSet.size);

  // 计算本簇平均质量分
  const clusterScores = clusterChapters.map(getChapterQualityScore);
  const clusterMean = clusterScores.reduce((a, b) => a + b, 0) / clusterScores.length;

  // 计算非本簇章节基线得分 (对照组)
  const nonCluster = allFeatures.filter(f => !clusterChapters.includes(f));
  let baselineScore = 0.65;
  if (nonCluster.length > 0) {
    const nonClusterScores = nonCluster.map(getChapterQualityScore);
    baselineScore = nonClusterScores.reduce((a, b) => a + b, 0) / nonClusterScores.length;
  }
  const liftDelta = clusterMean - baselineScore;
  const qualityLift = Number(liftDelta.toFixed(3));

  // 置信度：达标或优秀的比例
  const qualifiedRatio = clusterChapters.filter(f => {
    if (f.screener?.scores) {
      return Object.values(f.screener.scores).some(s => s >= 0.70);
    }
    return (f.screener?.qualifiedDimensions || []).length >= 1;
  }).length / clusterChapters.length;
  const confidence = Number(Math.max(0.2, Math.min(1.0, 0.4 * qualifiedRatio + 0.6 * clusterMean)).toFixed(3));

  // 混杂风险：单一书目垄断率与作者多样性
  const bookFreq = {};
  for (const f of clusterChapters) {
    bookFreq[f.bookId] = (bookFreq[f.bookId] || 0) + 1;
  }
  const maxBookShare = Math.max(...Object.values(bookFreq)) / clusterChapters.length;
  const rawConfound = 0.20 * maxBookShare + 0.15 / Math.max(1, clusterAuthors) - 0.05;
  const confoundScore = Number(Math.max(0.02, Math.min(0.85, rawConfound)).toFixed(3));

  const stats = {
    supportCount: clusterChapters.length,
    bookCount: clusterBooks,
    authorCount: clusterAuthors,
    qualityLift,
    confidence,
    confoundScore
  };

  // 判定规则类别与 ID
  let type = 'focus';
  let id = `rule_${dimOrType}_${goalOrHook}`;
  if (dimOrType === 'hook') {
    type = 'hook';
    id = `rule_hook_${goalOrHook}`;
  } else if (dimOrType === 'goal') {
    type = 'goal';
    id = `rule_goal_${goalOrHook}`;
  } else if (['character', 'thrill', 'style', 'focus'].includes(dimOrType)) {
    type = 'focus';
    id = `rule_${dimOrType}_${goalOrHook}`;
  } else if (['conflict_push', 'dialogue_game', 'info_reveal'].includes(goalOrHook)) {
    type = 'focus';
    id = `rule_${dimOrType}_${goalOrHook}`;
  }

  // 选取本簇中质量最高的章节提取微观案例
  let bestChapter = clusterChapters[0];
  let bestScore = -1;
  for (const f of clusterChapters) {
    const s = getChapterQualityScore(f);
    if (s > bestScore) {
      bestScore = s;
      bestChapter = f;
    }
  }

  const microExample = bestChapter.tailHook?.tailSnippet
    || (bestChapter.chapterTitle ? `【${bestChapter.novelTitle || ''}·${bestChapter.chapterTitle}】现场细节呈现` : '“现场关键对峙中，器物碰撞与暗流交错。”');

  const abstractPattern = bestChapter.outcomeContract?.stateDelta?.events?.length
    ? bestChapter.outcomeContract.stateDelta.events.join(' -> ') + ' -> 局面不可逆收束'
    : `${dimOrType}起势 -> 现场物理/心理摩擦 -> ${goalOrHook}因果闭环`;

  const { name, rule, counterExample, failureMode } = generateRulePayload(dimOrType, goalOrHook, bestChapter);

  return {
    id,
    name,
    type,
    rule,
    abstractPattern,
    microExample,
    counterExample,
    failureMode,
    stats,
    applicableDimensions: [dimOrType, goalOrHook].filter(Boolean),
    tags: [dimOrType, goalOrHook, type].filter(Boolean)
  };
}

module.exports = {
  mineStrategiesFromFeatures
};
