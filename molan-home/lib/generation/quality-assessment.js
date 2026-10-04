'use strict';

const crypto = require('node:crypto');
const CRITICAL_QUALITY_DIMENSIONS = Object.freeze({
  '玄幻': ['causality', 'consistency', 'language'],
  '都市': ['logic', 'dialogue', 'language'],
  '悬疑': ['clueIntegrity', 'povBoundary', 'language'],
  '历史': ['historicalPlausibility', 'logic', 'language'],
  '言情': ['emotionalArc', 'relationshipDynamics', 'language'],
  '科幻': ['speculativeConsistency', 'logic', 'language'],
  '西幻': ['worldRules', 'consistency', 'language'],
  '轻小说': ['characterVoice', 'pacing', 'language']
});

const SCHEMA_VERSION = 'quality-assessment-v1';

const PROXY_SOURCE_PATTERN = /^(heuristic|presence|ratio|linguistic_metrics?_analyzer|word_?count|char_?count(er)?|dialogue_extractor|dialogue_density_.*|character_presence_verifier|causal_debt_prose_verifier|chapter_goal_prose_verifier|pov_and_clue_boundary_evaluator|fact_.*|causal_issue_detector.*|unmeasured|none|proxy.*)$/i;
const PROXY_EVIDENCE_PATTERN = /^(字符数=|目标字数=|句子数=|平均句长=|对白提取总句数=|对白字数占比=|未检测到|未检出|未发现|未见异常|无异常|无违规|无问题|零越界|无明确冲突|初筛完成|暂无冲突|符合规范)/i;
const NEGATIVE_ABSENCE_PATTERN = /(未检测到|未检出|未发现|未见异常|无异常|无违规|无问题|零越界|无明确冲突|初筛完成|暂无冲突|符合规范)/;

const VALID_LITERARY_STATUSES = Object.freeze(new Set([
  'MEASURED',
  'JUDGED',
  'HUMAN_REVIEWED'
]));

const INITIAL_SCORE_THRESHOLD = 0.70;
const INITIAL_CONFIDENCE_THRESHOLD = 0.75;

/** 判断指定来源名称是否属于已知代理指标或规则统计检查器。 */
function isProxySource(sourceName) {
  const raw = String(sourceName || '').trim().toLowerCase();
  if (!raw || raw === 'none' || raw === 'unmeasured') return true;
  // 规范化：去除 _v1, -v2 等版本后缀
  const normalized = raw.replace(/[_-]v\d+.*$/, '');

  if (PROXY_SOURCE_PATTERN.test(normalized) || PROXY_SOURCE_PATTERN.test(raw)) return true;

  const proxyTokens = [
    'heuristic', 'presence', 'ratio', 'word_count', 'wordcount', 'char_count', 'char_counter',
    'counter', 'count', 'metric', 'extractor', 'boundary', 'verifier', 'scanner', 'proxy',
    'rule', 'density', 'detector', 'statistical', 'regex', 'unmeasured', 'none',
    'fact_', 'fact-'
  ];

  for (const token of proxyTokens) {
    if (normalized.includes(token) || raw.includes(token)) {
      return true;
    }
  }

  return false;
}

/** 计算 SHA-256 摘要 */
function computeSha256(content) {
  return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}

/**
 * 规范化题材名称以匹配质检维度表。
 */
function resolveGenreKey(rawGenre) {
  const str = typeof rawGenre === 'object' && rawGenre !== null
    ? String(rawGenre.genre || rawGenre.id || rawGenre.title || '')
    : String(rawGenre || '');
  const trimmed = str.trim();
  if (!trimmed) return '通用';
  for (const key of Object.keys(CRITICAL_QUALITY_DIMENSIONS)) {
    if (trimmed === key || trimmed.includes(key) || key.includes(trimmed)) {
      return key;
    }
  }
  return '通用';
}

/**
 * 创建统一的 4 层 QualityAssessment 实体。
 * 解耦 4 层职责：
 * 1. compliance: 确定性与启发式规则校验（字数、排版、硬事实、POV边界、违禁扫描、存在性正则）
 * 2. literary: 主观文学叙事质量（人物声音、因果律、叙事节奏、情感弧光、题材共鸣）
 * 3. style: 用词、句长方差、节奏指标、人工质感
 * 4. aiFlavor: 结构化 AI 笔调/特征检测
 *
 * 严格来源门禁：代理指标/启发式分析器仅允许产生 compliance 证据，严禁伪造 literary 评分。
 * 提供向后兼容的 qualityVector 投影供历史调用方使用。
 */
function createQualityAssessment(options = {}) {
  const opts = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
  const rawCompliance = opts.compliance && typeof opts.compliance === 'object' ? opts.compliance : {};
  const rawLiterary = opts.literary && typeof opts.literary === 'object' ? opts.literary : {};
  const rawStyle = opts.style && typeof opts.style === 'object' ? opts.style : {};
  const rawAiFlavor = opts.aiFlavor && typeof opts.aiFlavor === 'object'
    ? opts.aiFlavor
    : (opts.ai_flavor_risk && typeof opts.ai_flavor_risk === 'object' ? opts.ai_flavor_risk : {});

  const genre = String(opts.genre || 'universal').trim();
  const contentDigest = String(opts.contentDigest || opts.contentHash || opts.outputHash || '').trim();

  // 1. Compliance 层处理
  const complianceChecks = { ...(rawCompliance.checks || {}) };
  if (opts.checks && typeof opts.checks === 'object') {
    Object.assign(complianceChecks, opts.checks);
  }

  // 2. Literary 层与严格 Provenance 处理
  const literaryDimensions = {};
  const provenanceViolations = [];

  // 输入维度：优先 literary.dimensions，兼顾 options.qualityVector / options.vector 向后兼容输入
  const inputDimensions = {
    ...(opts.qualityVector || opts.vector || {}),
    ...(rawLiterary.dimensions || {})
  };

  for (const [dim, entry] of Object.entries(inputDimensions)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const source = String(entry.source || '').trim();

    if (isProxySource(source)) {
      // 代理来源必须约束在 compliance.checks，严禁进入 literary.dimensions 伪造文学层评分
      provenanceViolations.push({
        dimension: dim,
        source: source || 'unmeasured',
        reason: `维度「${dim}」来源于代理指标「${source || '未标注'}」，代理来源无论是否附引文都不能伪造文学层评分`
      });
      // 归入合规检查
      if (!complianceChecks[dim]) {
        complianceChecks[dim] = entry;
      }
    } else {
      // 真实文学评估维度
      const rawScore = entry.value !== undefined ? entry.value : entry.score;
      const numericScore = typeof rawScore === 'number' && Number.isFinite(rawScore) ? rawScore : 0;
      const rawConf = entry.confidence;
      const numericConf = typeof rawConf === 'number' && Number.isFinite(rawConf) ? rawConf : 0;
      const entryStatus = String(entry.status || '').trim() || 'MEASURED';

      const evidences = Array.isArray(entry.evidence)
        ? [...entry.evidence]
        : (entry.quote ? [entry.quote] : (entry.evidence ? [String(entry.evidence)] : []));

      literaryDimensions[dim] = {
        value: numericScore,
        score: numericScore,
        status: entryStatus,
        confidence: numericConf,
        source: source || 'literary_evaluator',
        evidence: evidences,
        quote: entry.quote || (typeof evidences[0] === 'string' ? evidences[0] : undefined),
        start: Number.isInteger(entry.start) ? entry.start : undefined,
        end: Number.isInteger(entry.end) ? entry.end : undefined,
        rationale: entry.rationale || entry.reason
      };
    }
  }

  // 计算 compliance.passed
  const complianceIssues = Array.isArray(rawCompliance.issues) ? [...rawCompliance.issues] : [];
  const complianceBlockerCount = Number(rawCompliance.blockerCount ?? complianceIssues.filter(i => i && i.severity === 'blocker').length) || 0;
  const compliancePassed = Boolean(rawCompliance.passed !== undefined
    ? rawCompliance.passed
    : (complianceBlockerCount === 0 && Object.keys(complianceChecks).length > 0));

  // 计算 literary.passed
  // 严格原则：
  // 1) 存在代理来源侵入文学层时，文学层不可通过
  // 2) 维度为空时，文学层不可通过
  // 3) 任何文学维度未测量、分数或置信度未达标时，文学层不可通过
  // 4) 包含消极缺省词（如“未检测到违规”、“未见异常”）的引文，严禁解锁文学层通过状态
  // 5) compliance.passed === true 绝不能单独解锁 literary.passed
  const literaryDimensionCount = Object.keys(literaryDimensions).length;
  let literaryAllDimensionsMeetThreshold = literaryDimensionCount > 0;
  for (const dim of Object.values(literaryDimensions)) {
    if (!VALID_LITERARY_STATUSES.has(dim.status) || dim.score < INITIAL_SCORE_THRESHOLD || dim.confidence < INITIAL_CONFIDENCE_THRESHOLD) {
      literaryAllDimensionsMeetThreshold = false;
      break;
    }

    const quoteStr = typeof dim.quote === 'string' ? dim.quote.trim() : '';
    const evidences = Array.isArray(dim.evidence) ? dim.evidence : [];

    // 消极缺省词严禁解锁文学层
    const hasNegativeAbsence = (quoteStr && NEGATIVE_ABSENCE_PATTERN.test(quoteStr)) ||
      evidences.some(ev => typeof ev === 'string' && NEGATIVE_ABSENCE_PATTERN.test(ev));
    if (hasNegativeAbsence) {
      literaryAllDimensionsMeetThreshold = false;
      break;
    }
  }

  const rawLiteraryPassedExplicit = rawLiterary.passed === true;
  const literaryPassed = rawLiteraryPassedExplicit &&
    provenanceViolations.length === 0 &&
    literaryDimensionCount > 0 &&
    literaryAllDimensionsMeetThreshold;

  const rawLiteraryStatus = String(rawLiterary.status || '').trim().toUpperCase();
  const literaryStatus = VALID_LITERARY_STATUSES.has(rawLiteraryStatus)
    ? rawLiteraryStatus
    : (literaryPassed ? 'MEASURED' : 'NOT_MEASURED');

  const literaryScore = typeof rawLiterary.score === 'number' && Number.isFinite(rawLiterary.score)
    ? rawLiterary.score
    : (literaryDimensionCount > 0
      ? Object.values(literaryDimensions).reduce((sum, d) => sum + d.score, 0) / literaryDimensionCount
      : 0);

  const literaryConfidence = typeof rawLiterary.confidence === 'number' && Number.isFinite(rawLiterary.confidence)
    ? rawLiterary.confidence
    : (literaryDimensionCount > 0
      ? Object.values(literaryDimensions).reduce((sum, d) => sum + d.confidence, 0) / literaryDimensionCount
      : 0);

  const literaryEvaluator = rawLiterary.evaluator && typeof rawLiterary.evaluator === 'object'
    ? { ...rawLiterary.evaluator }
    : { mode: 'single', modelId: 'literary-judge-v1' };

  // 3. Style 层处理
  const stylePassed = rawStyle.passed !== false;
  const styleScore = typeof rawStyle.score === 'number' && Number.isFinite(rawStyle.score)
    ? rawStyle.score
    : (stylePassed ? 0.85 : 0.5);
  const styleMetrics = rawStyle.metrics && typeof rawStyle.metrics === 'object' ? { ...rawStyle.metrics } : {};
  const styleEvidence = Array.isArray(rawStyle.evidence) ? [...rawStyle.evidence] : [];

  // 4. AI Flavor 层处理
  const aiFlavorRisk = String(rawAiFlavor.risk || 'clean').toLowerCase();
  const aiFlavorPassed = rawAiFlavor.passed !== false && aiFlavorRisk !== 'critical';
  const aiFlavorScore = typeof rawAiFlavor.score === 'number' && Number.isFinite(rawAiFlavor.score) ? rawAiFlavor.score : 0;
  const aiFlavorStatus = String(rawAiFlavor.status || 'MEASURED');
  const aiFlavorSource = String(rawAiFlavor.source || 'ai_flavor_detector');
  const aiFlavorEvidence = Array.isArray(rawAiFlavor.evidence) ? [...rawAiFlavor.evidence] : [];

  // Overall 整合
  // 核心不变式：compliance.passed 绝不能单独解锁 overallPassed
  const overallPassed = compliancePassed && literaryPassed && stylePassed && aiFlavorPassed;
  const overallStatus = overallPassed
    ? (literaryStatus === 'JUDGED' ? 'JUDGED' : 'MEASURED')
    : (literaryStatus === 'NOT_MEASURED' ? 'NOT_MEASURED' : 'needs_human');
  const overallScore = literaryScore;
  const overallConfidence = literaryConfidence;

  // 向后兼容投影：qualityVector
  const legacyQualityVector = {};
  for (const [k, v] of Object.entries(literaryDimensions)) {
    legacyQualityVector[k] = { ...v };
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    passed: overallPassed,
    status: overallStatus,
    score: overallScore,
    confidence: overallConfidence,
    contentDigest,
    genre,
    compliance: {
      passed: compliancePassed,
      checks: complianceChecks,
      blockerCount: complianceBlockerCount,
      issues: complianceIssues
    },
    literary: {
      passed: literaryPassed,
      status: literaryStatus,
      score: literaryScore,
      confidence: literaryConfidence,
      evaluator: literaryEvaluator,
      dimensions: literaryDimensions
    },
    style: {
      passed: stylePassed,
      score: styleScore,
      metrics: styleMetrics,
      evidence: styleEvidence
    },
    aiFlavor: {
      passed: aiFlavorPassed,
      risk: aiFlavorRisk,
      score: aiFlavorScore,
      status: aiFlavorStatus,
      source: aiFlavorSource,
      evidence: aiFlavorEvidence
    },
    qualityVector: legacyQualityVector,
    provenance: {
      valid: provenanceViolations.length === 0,
      proxySourcesConfinedToCompliance: true,
      literarySourcesGenuine: provenanceViolations.length === 0 && literaryDimensionCount > 0,
      violations: provenanceViolations
    }
  };
}

/**
 * 校验 QualityAssessment 实体的完整性与真实性。
 * 执行 4 层解耦校验与严格来源门禁 (Fail-Closed)。
 */
function validateQualityAssessment(assessment, options = {}) {
  const opts = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
  const errors = [];
  const violations = [];

  if (!assessment || typeof assessment !== 'object' || Array.isArray(assessment)) {
    return {
      valid: false,
      passed: false,
      code: 'INVALID_ASSESSMENT_OBJECT',
      errors: ['assessment 必须为非空对象'],
      violations: []
    };
  }

  // 1. Schema 版本检查
  if (assessment.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion 必须为「${SCHEMA_VERSION}」，实际为「${assessment.schemaVersion}」`);
  }

  // 2. 检查 4 层结构完整性
  const { compliance, literary, style, aiFlavor } = assessment;

  if (!compliance || typeof compliance !== 'object' || Array.isArray(compliance)) {
    errors.push('compliance 层缺失或非对象');
  } else {
    if (typeof compliance.passed !== 'boolean') errors.push('compliance.passed 必须为 boolean');
    if (!compliance.checks || typeof compliance.checks !== 'object') errors.push('compliance.checks 必须为对象');
    if (typeof compliance.blockerCount !== 'number' || !Number.isFinite(compliance.blockerCount)) errors.push('compliance.blockerCount 必须为有限 number');
    if (!Array.isArray(compliance.issues)) errors.push('compliance.issues 必须为数组');
  }

  if (!literary || typeof literary !== 'object' || Array.isArray(literary)) {
    errors.push('literary 层缺失或非对象');
  } else {
    if (typeof literary.passed !== 'boolean') errors.push('literary.passed 必须为 boolean');
    if (typeof literary.status !== 'string') errors.push('literary.status 必须为 string');
    if (typeof literary.score !== 'number' || !Number.isFinite(literary.score)) errors.push('literary.score 必须为有限 number');
    if (typeof literary.confidence !== 'number' || !Number.isFinite(literary.confidence)) errors.push('literary.confidence 必须为有限 number');
    if (!literary.dimensions || typeof literary.dimensions !== 'object') errors.push('literary.dimensions 必须为对象');
  }

  if (!style || typeof style !== 'object' || Array.isArray(style)) {
    errors.push('style 层缺失或非对象');
  } else {
    if (typeof style.passed !== 'boolean') errors.push('style.passed 必须为 boolean');
  }

  if (!aiFlavor || typeof aiFlavor !== 'object' || Array.isArray(aiFlavor)) {
    errors.push('aiFlavor 层缺失或非对象');
  } else {
    if (typeof aiFlavor.passed !== 'boolean') errors.push('aiFlavor.passed 必须为 boolean');
    if (typeof aiFlavor.risk !== 'string') errors.push('aiFlavor.risk 必须为 string');
  }

  if (assessment.score !== undefined && (typeof assessment.score !== 'number' || !Number.isFinite(assessment.score))) {
    errors.push('assessment.score 必须为有限 number');
  }
  if (assessment.confidence !== undefined && (typeof assessment.confidence !== 'number' || !Number.isFinite(assessment.confidence))) {
    errors.push('assessment.confidence 必须为有限 number');
  }

  if (errors.length > 0) {
    return {
      valid: false,
      passed: false,
      code: 'SCHEMA_VALIDATION_FAILED',
      errors,
      violations
    };
  }

  // 3. 严格 Provenance 来源门禁检查
  // 检查 literary.dimensions 中是否潜藏代理来源，并对各维度评分/置信度执行有限数字校验
  const dimensions = literary.dimensions || {};
  for (const [dim, entry] of Object.entries(dimensions)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`维度「${dim}」条目非有效对象`);
      continue;
    }
    const sourceName = String(entry.source || '').trim();
    if (isProxySource(sourceName)) {
      violations.push({
        dimension: dim,
        source: sourceName,
        code: 'LITERARY_PROVENANCE_VIOLATION',
        reason: `维度「${dim}」来源于代理指标「${sourceName || '未标注'}」，代理来源无论是否附引文都不能伪造文学层评分`
      });
    }

    const rawDimScore = entry.score !== undefined ? entry.score : entry.value;
    if (rawDimScore !== undefined && (typeof rawDimScore !== 'number' || !Number.isFinite(rawDimScore))) {
      errors.push(`维度「${dim}」评分「${rawDimScore}」非有效有限数字`);
    }

    const rawDimConf = entry.confidence;
    if (rawDimConf !== undefined && (typeof rawDimConf !== 'number' || !Number.isFinite(rawDimConf))) {
      errors.push(`维度「${dim}」置信度「${rawDimConf}」非有效有限数字`);
    }

    // 检查维度引文/证据中是否包含消极缺省词汇（无论文学层是否标记为 passed）
    const quote = typeof entry.quote === 'string' ? entry.quote.trim() : '';
    const evidenceArr = Array.isArray(entry.evidence)
      ? entry.evidence
      : (entry.evidence ? [String(entry.evidence)] : []);

    if (quote && NEGATIVE_ABSENCE_PATTERN.test(quote)) {
      errors.push(`维度「${dim}」引文「${quote}」包含消极缺省/无违规词汇，不可作为文学质量证据`);
    }
    for (const ev of evidenceArr) {
      if (typeof ev === 'string' && NEGATIVE_ABSENCE_PATTERN.test(ev)) {
        if (!errors.some(e => e.includes(`维度「${dim}」`) && e.includes('消极缺省'))) {
          errors.push(`维度「${dim}」引文「${ev}」包含消极缺省/无违规词汇，不可作为文学质量证据`);
        }
      }
    }
  }

  // 4. 不变式校验：Fail-Closed 核心防御
  // 全局 passed === true 时，必须严格满足：
  // - compliance.passed === true && compliance.blockerCount === 0
  // - literary.passed === true
  // - style.passed !== false
  // - aiFlavor.passed !== false && aiFlavor.risk !== 'critical'
  // 若任何一项未满足，严禁认证通过，抛出 SCHEMA_INVARIANT_VIOLATION
  if (assessment.passed === true) {
    const hasBlocker = compliance.blockerCount > 0 ||
      (Array.isArray(compliance.issues) && compliance.issues.some(i => i && i.severity === 'blocker'));

    if (compliance.passed !== true || hasBlocker) {
      violations.push({
        code: 'SCHEMA_INVARIANT_VIOLATION',
        reason: '合规检查未通过或存在阻断项，全局 passed 不可为 true'
      });
    }

    if (literary.passed !== true) {
      violations.push({
        code: 'SCHEMA_INVARIANT_VIOLATION',
        reason: '文学质量未通过，全局 passed 不可为 true'
      });
    }

    if (style.passed === false) {
      violations.push({
        code: 'SCHEMA_INVARIANT_VIOLATION',
        reason: '风格质感未通过，全局 passed 不可为 true'
      });
    }

    if (aiFlavor.passed === false || aiFlavor.risk === 'critical') {
      violations.push({
        code: 'SCHEMA_INVARIANT_VIOLATION',
        reason: 'AI笔调层未通过或达严重风险，全局 passed 不可为 true'
      });
    }

    if (!VALID_LITERARY_STATUSES.has(assessment.status)) {
      violations.push({
        code: 'SCHEMA_INVARIANT_VIOLATION',
        reason: `全局 status「${assessment.status}」非有效测量状态，全局 passed 不可为 true`
      });
    }
  }

  // 5. 文学层为 passed=true 时的深度校验
  const scoreThreshold = typeof opts.scoreThreshold === 'number' ? opts.scoreThreshold : INITIAL_SCORE_THRESHOLD;
  const confThreshold = typeof opts.confidenceThreshold === 'number' ? opts.confidenceThreshold : INITIAL_CONFIDENCE_THRESHOLD;

  if (literary.passed === true) {
    if (!VALID_LITERARY_STATUSES.has(literary.status)) {
      errors.push(`文学层标记为 passed=true，但 status「${literary.status}」不属于有效测量状态`);
    }
    if (typeof literary.score !== 'number' || !Number.isFinite(literary.score) || literary.score < scoreThreshold) {
      errors.push(`文学层总分 ${literary.score} 低于门限 ${scoreThreshold}`);
    }
    if (typeof literary.confidence !== 'number' || !Number.isFinite(literary.confidence) || literary.confidence < confThreshold) {
      errors.push(`文学层置信度 ${literary.confidence} 低于门限 ${confThreshold}`);
    }
    if (Object.keys(dimensions).length === 0) {
      errors.push('文学层标记为 passed=true，但未包含任何质检维度 (dimensions 为空)');
    }

    const proseContent = typeof opts.prose === 'string'
      ? opts.prose
      : (typeof opts.content === 'string' ? opts.content : '');

    for (const [dim, entry] of Object.entries(dimensions)) {
      const dimScore = entry.score !== undefined ? entry.score : entry.value;
      if (typeof dimScore !== 'number' || !Number.isFinite(dimScore)) {
        errors.push(`维度「${dim}」评分「${dimScore}」非有效有限数字`);
      } else if (dimScore < scoreThreshold) {
        errors.push(`维度「${dim}」评分「${dimScore}」未达门限 ${scoreThreshold}`);
      }

      if (typeof entry.confidence !== 'number' || !Number.isFinite(entry.confidence)) {
        errors.push(`维度「${dim}」置信度「${entry.confidence}」非有效有限数字`);
      } else if (entry.confidence < confThreshold) {
        errors.push(`维度「${dim}」置信度「${entry.confidence}」未达门限 ${confThreshold}`);
      }

      if (!VALID_LITERARY_STATUSES.has(String(entry.status || ''))) {
        errors.push(`维度「${dim}」status「${entry.status}」未处于测量状态`);
      }

      // 引文正文核验
      const quote = typeof entry.quote === 'string' ? entry.quote.trim() : '';
      const evidenceArr = Array.isArray(entry.evidence)
        ? entry.evidence
        : (entry.evidence ? [String(entry.evidence)] : []);

      let validQuote = quote;
      if (!validQuote && evidenceArr.length > 0) {
        for (const ev of evidenceArr) {
          if (typeof ev === 'string' && ev.trim().length >= 4 && !NEGATIVE_ABSENCE_PATTERN.test(ev)) {
            validQuote = ev.trim();
            break;
          }
        }
      }

      // 无论是否传入 prose，当 literary.passed === true 时，必须具备有效引文 (长度 >= 4 且无消极缺省)
      if (!validQuote || validQuote.length < 4) {
        errors.push(`维度「${dim}」缺少长度 >= 4 的有效正文逐字引文`);
      } else if (NEGATIVE_ABSENCE_PATTERN.test(validQuote)) {
        errors.push(`维度「${dim}」引文「${validQuote}」包含消极缺省/无违规词汇，不可作为文学质量证据`);
      } else if (proseContent.trim() && !proseContent.includes(validQuote)) {
        errors.push(`维度「${dim}」引文「${validQuote}」不存在于正文中`);
      }

      if (quote && NEGATIVE_ABSENCE_PATTERN.test(quote)) {
        if (!errors.some(e => e.includes(`维度「${dim}」引文`) && e.includes('消极缺省'))) {
          errors.push(`维度「${dim}」引文「${quote}」包含消极缺省/无违规词汇，不可作为文学质量证据`);
        }
      }
    }
  }

  // 6. AI Flavor 阻断检查
  if (aiFlavor.risk === 'critical' && assessment.passed === true) {
    violations.push({
      code: 'AI_FLAVOR_CRITICAL_RISK',
      reason: 'AI 味道检测处于 critical 风险，禁止通过质量评估'
    });
  }

  // 7. 题材关键维度存在性检查（当传入题材时）
  if (opts.genre) {
    const genreKey = resolveGenreKey(opts.genre);
    const requiredDims = CRITICAL_QUALITY_DIMENSIONS[genreKey] || ['language'];
    for (const reqDim of requiredDims) {
      if (!dimensions[reqDim]) {
        errors.push(`题材「${genreKey}」必需关键维度「${reqDim}」缺失`);
      }
    }
  }

  const valid = errors.length === 0 && violations.length === 0;
  const overallPassed = valid && assessment.passed === true;
  const firstCode = violations.length > 0
    ? violations[0].code
    : (errors.length > 0 ? (errors.some(e => e.includes('必需关键维度')) ? 'CRITICAL_DIMENSION_MISSING' : 'VALIDATION_FAILED') : 'OK');

  return {
    valid,
    passed: overallPassed,
    code: firstCode,
    errors,
    violations
  };
}

module.exports = {
  SCHEMA_VERSION,
  CRITICAL_QUALITY_DIMENSIONS,
  PROXY_SOURCE_PATTERN,
  PROXY_EVIDENCE_PATTERN,
  NEGATIVE_ABSENCE_PATTERN,
  VALID_LITERARY_STATUSES,
  INITIAL_SCORE_THRESHOLD,
  INITIAL_CONFIDENCE_THRESHOLD,
  isProxySource,
  computeSha256,
  resolveGenreKey,
  createQualityAssessment,
  validateQualityAssessment
};
