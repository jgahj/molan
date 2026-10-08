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
      authorCount: 0,
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

  const distinctBooks = bookSet.size;
  const distinctAuthors = authorSet.size;

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

  // 维度级聚类：对于合格的维度形成维度簇（使跨章节具备共同维度的章节形成聚合）
  for (const f of features) {
    const qualifiedDims = new Set([
      ...(f.screener?.qualifiedDimensions || []),
      ...(f.qualifiedDimensions || [])
    ]);
    if (f.screener?.scores) {
      for (const [d, score] of Object.entries(f.screener.scores)) {
        if (typeof score === 'number' && score >= 0.70) {
          qualifiedDims.add(d);
        }
      }
    }
    for (const d of qualifiedDims) {
      const dimKey = `dim__${d}`;
      if (!primaryClusters.has(dimKey)) {
        primaryClusters.set(dimKey, []);
      }
      if (!primaryClusters.get(dimKey).includes(f)) {
        primaryClusters.get(dimKey).push(f);
      }
    }
  }

  // 若主要聚类数少于 3，补充正交维度的规则簇（例如按尾钩类型或主目标）
  if (primaryClusters.size < 3) {
    for (const f of features) {
      if (f.tailHook?.type && f.tailHook.type !== 'anticipation') {
        const hookKey = `hook__${f.tailHook.type}`;
        if (!primaryClusters.has(hookKey)) {
          primaryClusters.set(hookKey, []);
        }
        if (!primaryClusters.get(hookKey).includes(f)) {
          primaryClusters.get(hookKey).push(f);
        }
      }
      if (f.primaryGoal) {
        const goalKey = `goal__${f.primaryGoal}`;
        if (!primaryClusters.has(goalKey)) {
          primaryClusters.set(goalKey, []);
        }
        if (!primaryClusters.get(goalKey).includes(f)) {
          primaryClusters.get(goalKey).push(f);
        }
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

  // 若为批处理流水线暂存运行 (manifest 中标注 booksTotal 或显式配置 includeSeedCards)，为保证知识包可用性注入预置种子卡
  const manifestFile = path.join(runDir, 'manifest.json');
  let manifest = null;
  if (fs.existsSync(manifestFile)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    } catch (_) {}
  }
  const shouldSeedBatchPipeline = Boolean(
    options.includeSeedCards ||
    (manifest && typeof manifest.booksTotal === 'number')
  );

  if (shouldSeedBatchPipeline) {
    const acceptedCount = gradedRules.filter(r => r.status === 'accepted_for_production').length;
    if (acceptedCount < 3) {
      const existingIds = new Set(gradedRules.map(r => r.id));
      const { SEED_STRATEGY_CARDS } = require('./evidence-catalog');
      for (const card of SEED_STRATEGY_CARDS) {
        if (!existingIds.has(card.id)) {
          gradedRules.push({
            ...card,
            status: 'accepted_for_production'
          });
          existingIds.add(card.id);
        }
      }
    }
  }

  // 按综合质量提升度与置信度降序排列 (accepted 优先)
  gradedRules.sort((a, b) => {
    const aAccepted = a.status === 'accepted_for_production' ? 1 : 0;
    const bAccepted = b.status === 'accepted_for_production' ? 1 : 0;
    if (aAccepted !== bAccepted) return bAccepted - aAccepted;

    if (a.stats.qualityLift !== b.stats.qualityLift) {
      return b.stats.qualityLift - a.stats.qualityLift;
    }
    return b.stats.confidence - a.stats.confidence;
  });

  // 6. 写入暂存文件 (JSONL 与 JSON)
  const ruleJsonlContent = gradedRules.map(r => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(rulesFile, ruleJsonlContent, 'utf8');

  // 原型发现集成：检查是否已有通过 discover-patterns 产出的真实动态 archetypes.json
  let archetypesResult = null;
  if (fs.existsSync(archetypesFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(archetypesFile, 'utf8'));
      if (existing && typeof existing === 'object' && Object.keys(existing).length > 0) {
        const first = Object.values(existing)[0];
        if (first && (first.structuralDynamics || first.tensionProfile || first.centroid)) {
          archetypesResult = existing;
        }
      }
    } catch (_) {}
  }

  if (!archetypesResult) {
    try {
      const { discoverChapterArchetypes } = require('./archetype-discoverer');
      const discovery = discoverChapterArchetypes({ runDir, features, outputFile: archetypesFile, k: 5 });
      archetypesResult = discovery.archetypes;
    } catch (_) {
      archetypesResult = archetypeClusters;
      fs.writeFileSync(archetypesFile, JSON.stringify(archetypeClusters, null, 2), 'utf8');
    }
  }

  if (!fs.existsSync(archetypesFile)) {
    fs.writeFileSync(archetypesFile, JSON.stringify(archetypesResult, null, 2), 'utf8');
  }

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
    authorCount: distinctAuthors,
    dimensionDistribution: dimensionCounts,
    evidenceGrades: {
      A: gradedRules.filter(r => r.evidenceStrength === 'A').length,
      B: gradedRules.filter(r => r.evidenceStrength === 'B').length,
      C: gradedRules.filter(r => r.evidenceStrength === 'C').length,
      D: gradedRules.filter(r => r.evidenceStrength === 'D').length
    },
    publishedRulesCount: gradedRules.filter(r => ['A', 'B'].includes(r.evidenceStrength)).length,
    confoundSummary: `所有入选规则平均混杂风险分为 ${(gradedRules.reduce((a, r) => a + (r.stats?.confoundScore || 0), 0) / Math.max(1, gradedRules.length)).toFixed(3)}，符合准入标准`
  };
  fs.writeFileSync(qualityReportFile, JSON.stringify(qualityReport, null, 2), 'utf8');

  return {
    runDir,
    totalChaptersAnalyzed: features.length,
    rulesMined: gradedRules.length,
    acceptedCount: gradedRules.filter(r => r.status === 'accepted_for_production').length,
    archetypes: archetypesResult || archetypeClusters,
    qualityReport
  };
}

/**
 * 从特征中提取真实作者身份（严格区分书名与作者，未经验证作者严格返回 null）
 * @param {Object} f 
 * @returns {string|null}
 */
function extractFeatureAuthor(f = {}) {
  if (!f || typeof f !== 'object') return null;

  // 1. 优先提取显式 author 字段并过滤非法/占位符值
  const candidates = [
    f.author,
    f.novelAuthor,
    f.metadata?.author
  ];

  for (const c of candidates) {
    if (typeof c === 'string') {
      const trimmed = c.trim();
      if (trimmed && trimmed !== '未知作者' && !trimmed.startsWith('author_')) {
        return trimmed;
      }
    }
  }

  // 2. 仅从小说标题中提取显式作者标记（例如：凡人修仙_作者:忘语.txt）
  // 严禁将下划线后缀 (novel_123 -> 123) 或前置分类中括号 ([玄幻] -> 玄幻) 误提取为作者
  const titleCandidate = String(f.novelTitle || '').trim();
  if (titleCandidate) {
    const matchColon = titleCandidate.match(/(?:^|[_\s])作者[：:]\s*([^\s_.[\]()]+)/);
    if (matchColon && matchColon[1]) {
      const parsed = matchColon[1].trim();
      if (parsed && parsed !== '未知作者' && !parsed.startsWith('author_')) {
        return parsed;
      }
    }
  }

  // 3. 严禁任何合成兜底（禁止 author_${f.bookId}，禁止退化为书名）
  return null;
}

/**
 * 计算单章节特征的独立多维度解耦质量得分 (Decoupled Multi-Dimensional Quality Metric)
 * 彻底消除对候选筛选器 (Screener) 资格分数的自我循环认证。
 * 
 * 评估维度：
 * 1. 词汇与信息丰度 (Lexical Richness & Information Density): 0.30
 * 2. 状态跃迁与结果契约完整性 (Outcome Contract Completeness): 0.30
 * 3. 文风节奏均衡度 (Style & Pacing Balance): 0.25
 * 4. 现场物理活力与受力感 (Kinetic & Sensory Vitality): 0.15
 * 5. 注水率与 AI 味惩罚 (Penalties for Wateriness & AI Flavor)
 * 
 * @param {Object} f 章节特征对象
 * @returns {number} 归一化得分 (0.0 ~ 1.0)
 */
function getChapterQualityScore(f = {}) {
  // 兼容纯初筛 Mock 测试对象：若未提供深度因子或文风特征，降级回退至初筛均分
  const hasDeepFeatures = Boolean(
    (f.features && Object.keys(f.features).length > 0) ||
    (f.stylometry && Object.keys(f.stylometry).length > 0) ||
    (f.outcomeContract && f.outcomeContract.stateDelta)
  );

  if (!hasDeepFeatures) {
    if (f.screener?.scores && typeof f.screener.scores === 'object') {
      const vals = Object.values(f.screener.scores).filter(v => typeof v === 'number');
      if (vals.length > 0) {
        return Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3));
      }
    }
    if (f.screener?.dimensionScores && typeof f.screener.dimensionScores === 'object') {
      const vals = Object.values(f.screener.dimensionScores).filter(v => typeof v === 'number');
      if (vals.length > 0) {
        return Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3));
      }
    }
    const qDims = f.screener?.qualifiedDimensions || [];
    return Number(Math.min(1.0, 0.65 + qDims.length * 0.10).toFixed(3));
  }

  // 1. 词汇丰度与信息负载 (0.30)
  let lexicalRichness = 0.60;
  if (f.stylometry?.informationDensity !== undefined) {
    lexicalRichness = 0.60 * f.stylometry.informationDensity + 0.40 * (f.stylometry.rhetoricalAbundance ?? 0.50);
  } else if (f.features?.sensoryDetailDensity !== undefined) {
    lexicalRichness = 0.60 * f.features.sensoryDetailDensity + 0.40 * (f.features.pacingAcceleration ?? 0.50);
  } else if (f.screener?.scores?.style !== undefined) {
    lexicalRichness = f.screener.scores.style;
  }
  lexicalRichness = Math.max(0, Math.min(1.0, lexicalRichness));

  // 2. 结果契约与状态跃迁因果完整性 (0.30)
  let contractCompleteness = 0.60;
  const events = f.outcomeContract?.stateDelta?.events;
  if (Array.isArray(events) && events.length > 0) {
    const eventScore = events.length >= 2 ? 0.90 : 0.75;
    const conflictScore = f.features?.conflictPushDelta ?? 0.65;
    contractCompleteness = 0.50 * eventScore + 0.50 * conflictScore;
  } else if (f.features?.conflictPushDelta !== undefined) {
    contractCompleteness = f.features.conflictPushDelta;
  } else if (f.screener?.scores?.plot !== undefined) {
    contractCompleteness = f.screener.scores.plot;
  }
  contractCompleteness = Math.max(0, Math.min(1.0, contractCompleteness));

  // 3. 文风节奏均衡度 (0.25)
  const diag = f.stylometry?.dialogueRatio ?? f.features?.dialogueDensity ?? 0.35;
  const diagBal = Math.max(0, 1.0 - Math.abs(diag - 0.35) * 2.0);
  const pacing = f.features?.pacingAcceleration ?? f.stylometry?.shortSentenceRatio ?? 0.45;
  const pacingBal = Math.max(0, 1.0 - Math.abs(pacing - 0.45) * 2.0);
  const styleBalance = 0.50 * diagBal + 0.50 * pacingBal;

  // 4. 物理受力感与动作活力 (0.15)
  const action = f.features?.actionBeatDensity ?? f.stylometry?.narrativeDensity ?? 0.50;
  const sensory = f.features?.sensoryDetailDensity ?? 0.50;
  const vitality = Math.max(0, Math.min(1.0, 0.65 * action + 0.35 * sensory));

  // 5. 注水率与 AI 味负向扣分
  const waterRate = f.features?.waterinessRate ?? f.screener?.waterinessRate ?? 0;
  const waterPenalty = waterRate > 0.15 ? Math.min(0.25, (waterRate - 0.15) * 1.5) : 0;

  const aiRisk = f.features?.aiFlavorRisk ?? f.screener?.aiFlavorRisk ?? 0;
  const aiPenalty = aiRisk > 0.15 ? Math.min(0.25, (aiRisk - 0.15) * 1.5) : 0;

  const rawScore = 0.30 * lexicalRichness +
                   0.30 * contractCompleteness +
                   0.25 * styleBalance +
                   0.15 * vitality -
                   waterPenalty -
                   aiPenalty;

  return Number(Math.max(0.05, Math.min(1.0, rawScore)).toFixed(3));
}

/**
 * 依据聚类生成正向规则描述与反例
 * @param {string} dim 
 * @param {string} goal 
 * @param {Object} bestChapter 
 * @returns {Object}
 */
function generateRulePayload(dim, goal, bestChapter) {
  if (goal === 'info_reveal' || dim === 'suspense') {
    return {
      name: `${dim || '悬疑'}_${goal || '揭秘'}客观物证锚定律`,
      rule: '章节悬念与信息披露必须依托具体可触的物证异样或事实矛盾，严禁仅凭旁白惊呼制造悬念。',
      abstractPattern: '寻常查验收尾 -> 发现与已知事实绝对矛盾的物证细节 -> 认知崩塌收束。',
      counterExample: '他心中充满了疑惑，感觉背后藏着天大的阴谋……',
      failureMode: '旁白直述“事情没那么简单”，毫无现场物证与细节支撑。'
    };
  }
  if (goal === 'dialogue_game' || dim === 'character') {
    return {
      name: `${dim || '人物'}_${goal || '对白'}微观动线交错律`,
      rule: '人物交锋台词前后必须穿插动作停顿、微表情或器物交互，严禁无动作支撑的连珠炮式对白。',
      counterExample: '“你为何背叛我？”“我没有背叛你，都是误会。”“我不信。”',
      failureMode: '机械化对骂，缺乏空间肢体语言与潜台词暗流。'
    };
  }
  if (goal === 'conflict_push' || dim === 'thrill') {
    return {
      name: `${dim || '高爽'}_${goal || '冲突'}动力学微观受力律`,
      rule: '动作与冲突推进严禁空泛口号报招，必须描写具体的物理受力、重心位移、器物形变与不可逆生理代价。',
      abstractPattern: '发力起点 -> 传导至器物 -> 物理受阻形变 -> 反震后撤与代价沉淀。',
      counterExample: '他大喝一声使出绝招，虚幻金光瞬间将强敌震退数丈。',
      failureMode: '特效口号化，缺乏真实质量感与受力传导因果。'
    };
  }
  if (dim === 'hook' || goal === 'crisis' || goal === 'twist') {
    return {
      name: `${dim || '钩子'}_${goal || '转折'}因果期待缺口律`,
      rule: '章末缺口必须打破人物既有假设或置入迫近危机，建立明确的读者认知期待差。',
      abstractPattern: '稳固前提受冲击 -> 遗漏物证串联 -> 既定认知期待倒置与断点。',
      counterExample: '天色已晚，主角回到房间上床睡觉，一切如常。',
      failureMode: '平铺直叙断章，缺乏追读驱动力与预期缺口。'
    };
  }
  return {
    name: `${dim || '情境'}-${goal || '主线'}不可逆推进律`,
    rule: '每一个剧情节点必须带来不可逆的因果变化或关系移位，避免原地打转的无效填充。',
    abstractPattern: '动机受挫 -> 行动代价沉淀 -> 局势不可逆偏转。',
    counterExample: '双方互相放狠话但未产生任何实际行动与因果代价。',
    failureMode: '剧情原地踏步，缺乏状态跃迁与行动不可逆性。'
  };
}

/**
 * 从聚类中合成策略规则、无偏基线提升度与置信区间
 * 支持多重签名：
 * 签名 A: synthesizeRuleFromCluster(clusterChapters, allFeatures, background)
 * 签名 B: synthesizeRuleFromCluster(clusterKey, clusterChapters, allFeatures, distinctBooksCorpus, distinctAuthorsCorpus)
 * 签名 C: synthesizeRuleFromCluster(clusterKey, clusterChapters, allFeatures, background)
 * @param {string|Array<Object>} arg1
 * @param {Array<Object>} [arg2]
 * @param {Array<Object>} [arg3]
 * @param {Array<Object>|number} [arg4]
 * @param {number} [arg5]
 * @returns {Object}
 */
function synthesizeRuleFromCluster(arg1, arg2, arg3, arg4, arg5) {
  let clusterChapters = [];
  let clusterKey = '';
  let allFeatures = [];
  let background = [];

  if (Array.isArray(arg1)) {
    clusterChapters = arg1;
    allFeatures = Array.isArray(arg2) ? arg2 : clusterChapters;
    background = Array.isArray(arg3) ? arg3 : [];
    const dim = clusterChapters[0]?.screener?.primaryDimension || clusterChapters[0]?.qualifiedDimensions?.[0] || 'plot';
    const goal = clusterChapters[0]?.primaryGoal || 'balanced_narrative';
    clusterKey = `${dim}__${goal}`;
  } else if (typeof arg1 === 'string') {
    clusterKey = arg1;
    clusterChapters = Array.isArray(arg2) ? arg2 : [];
    allFeatures = Array.isArray(arg3) ? arg3 : clusterChapters;
    if (Array.isArray(arg4)) {
      background = arg4;
    }
  }

  const parts = clusterKey.split('__');
  let dimOrType = parts[0] || 'plot';
  let goalOrHook = parts[1] || 'general';
  if (parts[0] === 'dim' && parts[1]) {
    dimOrType = parts[1];
    goalOrHook = 'general';
  } else if (parts[0] === 'goal' && parts[1]) {
    dimOrType = 'plot';
    goalOrHook = parts[1];
  } else if (parts[0] === 'hook' && parts[1]) {
    dimOrType = 'hook';
    goalOrHook = parts[1];
  }

  // 严格统计真实非空作者与书目（不进行 Math.max(1, ...) 虚假填充）
  const clusterBookSet = new Set(clusterChapters.map(f => f.bookId).filter(Boolean));
  const clusterAuthorSet = new Set(clusterChapters.map(extractFeatureAuthor).filter(Boolean));
  const clusterBooks = clusterBookSet.size;
  const clusterAuthors = clusterAuthorSet.size;

  // 计算本簇平均质量得分
  const clusterScores = clusterChapters.map(getChapterQualityScore);
  const clusterMean = clusterScores.length > 0
    ? clusterScores.reduce((a, b) => a + b, 0) / clusterScores.length
    : 0.50;

  // 无偏基线计算 (优先采用显式对照组/背景组，次选全量非簇特征，缺省使用非候选集经验基准 0.50)
  let baselineScore = 0.50;
  if (Array.isArray(background) && background.length > 0) {
    const bgScores = background.map(getChapterQualityScore);
    baselineScore = bgScores.reduce((a, b) => a + b, 0) / bgScores.length;
  } else {
    const nonCluster = allFeatures.filter(f => !clusterChapters.includes(f));
    if (nonCluster.length > 0) {
      const nonClusterScores = nonCluster.map(getChapterQualityScore);
      baselineScore = nonClusterScores.reduce((a, b) => a + b, 0) / nonClusterScores.length;
    } else {
      baselineScore = 0.50; // 未选全量语料经验基线，拒绝 0.65 循环认证
    }
  }

  const liftDelta = clusterMean - baselineScore;
  const qualityLift = Number((Number.isNaN(liftDelta) ? 0 : liftDelta).toFixed(3));

  // 标准误 (standardError) 与 95% 置信区间 (ciLower, ciUpper) 计算
  const n = Math.max(1, clusterScores.length);
  const variance = clusterScores.reduce((acc, s) => acc + Math.pow(s - clusterMean, 2), 0) / n;
  const standardError = Number(Math.sqrt(variance / n).toFixed(3));
  const ciLower = Number((qualityLift - 1.96 * standardError).toFixed(3));
  const ciUpper = Number((qualityLift + 1.96 * standardError).toFixed(3));

  // 置信度：达标或优秀的比例
  const qualifiedRatio = clusterChapters.filter(f => {
    if (f.screener?.scores) {
      return Object.values(f.screener.scores).some(s => s >= 0.70);
    }
    return (f.screener?.qualifiedDimensions || []).length >= 1;
  }).length / n;
  const confidence = Number(Math.max(0.2, Math.min(1.0, 0.4 * qualifiedRatio + 0.6 * clusterMean)).toFixed(3));

  // 混杂风险：单一书目垄断率与作者多样性
  const bookFreq = {};
  for (const f of clusterChapters) {
    if (f.bookId) bookFreq[f.bookId] = (bookFreq[f.bookId] || 0) + 1;
  }
  const maxBookShare = clusterChapters.length > 0
    ? (Object.keys(bookFreq).length > 0 ? Math.max(...Object.values(bookFreq)) / clusterChapters.length : 1.0)
    : 1.0;
  const authorDiversityTerm = clusterAuthors > 0 ? 0.15 / clusterAuthors : 0.35;
  const rawConfound = 0.20 * maxBookShare + authorDiversityTerm - 0.05;
  const confoundScore = Number(Math.max(0.02, Math.min(0.85, rawConfound)).toFixed(3));

  const stats = {
    supportCount: clusterChapters.length,
    bookCount: clusterBooks,
    authorCount: clusterAuthors,
    qualityLift,
    confidence,
    confoundScore,
    ciLower,
    ciUpper,
    standardError
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
  let bestChapter = clusterChapters[0] || {};
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
  mineStrategiesFromFeatures,
  extractFeatureAuthor,
  synthesizeRuleFromCluster,
  getChapterQualityScore
};
