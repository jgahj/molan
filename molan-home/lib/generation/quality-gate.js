'use strict';

const crypto = require('node:crypto');
const {
  CRITICAL_QUALITY_DIMENSIONS,
  isProxySource,
  PROXY_SOURCE_PATTERN,
  PROXY_EVIDENCE_PATTERN,
  NEGATIVE_ABSENCE_PATTERN
} = require('./quality-assessment');

const VALID_MEASURED_STATUSES = Object.freeze(new Set([
  'MEASURED',
  'JUDGED',
  'HUMAN_REVIEWED'
]));

const INITIAL_SCORE_THRESHOLD = 0.70;
const INITIAL_CONFIDENCE_THRESHOLD = 0.75;

/** 计算文本 SHA-256 摘要供哈希一致性比对。 */
function computeSha256(content) {
  return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}

/** 规范化题材名称并从必要质检维度表中提取维度清单，未知题材严格退回通用语言维度。 */
function resolveGenreDimensions(rawGenre) {
  const genreText = typeof rawGenre === 'object' && rawGenre !== null
    ? String(rawGenre.genre || rawGenre.id || rawGenre.title || '')
    : String(rawGenre || '');
  const trimmed = genreText.trim();
  if (!trimmed) {
    return { genreKey: '通用', dimensions: ['language'] };
  }
  for (const knownKey of Object.keys(CRITICAL_QUALITY_DIMENSIONS)) {
    if (trimmed === knownKey || trimmed.includes(knownKey)) {
      return { genreKey: knownKey, dimensions: CRITICAL_QUALITY_DIMENSIONS[knownKey] };
    }
  }
  return { genreKey: '通用', dimensions: ['language'] };
}

/** 校验指定维度是否具备正文可定位的有效文学质量证据，拦截代理指标与伪引用。 */
function verifyDimensionEvidence(dimensionName, dimensionEntry, proseContent) {
  if (!dimensionEntry || typeof dimensionEntry !== 'object') {
    return { ok: false, reason: `维度「${dimensionName}」条目非有效对象` };
  }
  const sourceName = String(dimensionEntry.source || '').trim();
  if (isProxySource(sourceName)) {
    return {
      ok: false,
      reason: `维度「${dimensionName}」来源于代理指标「${sourceName || '未标注'}」，代理来源无论是否附引文都不能独自解锁必要文学维度`
    };
  }

  const rawEvidences = Array.isArray(dimensionEntry.evidence)
    ? dimensionEntry.evidence
    : Array.isArray(dimensionEntry.evidences)
      ? dimensionEntry.evidences
      : typeof dimensionEntry.evidence === 'string'
        ? [dimensionEntry.evidence]
        : (dimensionEntry.evidence && typeof dimensionEntry.evidence === 'object')
          ? [dimensionEntry.evidence]
          : [];

  const candidateQuotes = [];
  if (dimensionEntry.start !== undefined || dimensionEntry.end !== undefined) {
    if (!Number.isInteger(dimensionEntry.start) || !Number.isInteger(dimensionEntry.end)) {
      return { ok: false, reason: `维度「${dimensionName}」证据偏移量 start/end 必须双边均为整数` };
    }
    if (dimensionEntry.start < 0 || dimensionEntry.end > proseContent.length || dimensionEntry.start >= dimensionEntry.end) {
      return { ok: false, reason: `维度「${dimensionName}」证据位置越界或无效: [${dimensionEntry.start}, ${dimensionEntry.end}]` };
    }
    const slicedExcerpt = proseContent.slice(dimensionEntry.start, dimensionEntry.end);
    if (!slicedExcerpt.trim()) {
      return { ok: false, reason: `维度「${dimensionName}」证据位置对应正文片段为空` };
    }
    const explicitQuote = typeof dimensionEntry.quote === 'string' ? dimensionEntry.quote : '';
    if (explicitQuote && explicitQuote !== slicedExcerpt) {
      return { ok: false, reason: `维度「${dimensionName}」证据引用与正文偏移切片不一致` };
    }
    candidateQuotes.push(slicedExcerpt);
  } else {
    const explicitQuote = typeof dimensionEntry.quote === 'string' ? dimensionEntry.quote.trim() : '';
    if (explicitQuote) candidateQuotes.push(explicitQuote);
  }

  for (const item of rawEvidences) {
    if (typeof item === 'string') {
      const trimmedItem = item.trim();
      if (!trimmedItem) continue;
      const quoteMatch = trimmedItem.match(/引文[「“'"]([^」”'"]+)[」”'"]/);
      if (quoteMatch && quoteMatch[1] && quoteMatch[1].trim()) {
        candidateQuotes.push(quoteMatch[1].trim());
      } else if (!PROXY_EVIDENCE_PATTERN.test(trimmedItem) && trimmedItem.length >= 4) {
        if (proseContent.includes(trimmedItem)) {
          candidateQuotes.push(trimmedItem);
        }
      }
    } else if (item && typeof item === 'object') {
      if (item.start !== undefined || item.end !== undefined) {
        if (!Number.isInteger(item.start) || !Number.isInteger(item.end)) {
          return { ok: false, reason: `维度「${dimensionName}」证据偏移量 start/end 必须双边均为整数` };
        }
        if (item.start < 0 || item.end > proseContent.length || item.start >= item.end) {
          return { ok: false, reason: `维度「${dimensionName}」证据位置越界或无效: [${item.start}, ${item.end}]` };
        }
        const sliced = proseContent.slice(item.start, item.end);
        if (!sliced.trim()) {
          return { ok: false, reason: `维度「${dimensionName}」证据位置对应正文片段为空` };
        }
        const itemQuote = typeof item.quote === 'string' ? item.quote : '';
        if (itemQuote && itemQuote !== sliced) {
          return { ok: false, reason: `维度「${dimensionName}」证据引用与正文偏移切片不一致` };
        }
        candidateQuotes.push(sliced);
      } else {
        const itemQuote = typeof item.quote === 'string' ? item.quote.trim() : '';
        if (itemQuote) candidateQuotes.push(itemQuote);
      }
    }
  }

  const minLen = Math.min(4, Math.max(1, proseContent.trim().length));
  const validQuote = candidateQuotes.find(candidate => candidate.length >= minLen && !NEGATIVE_ABSENCE_PATTERN.test(candidate) && proseContent.includes(candidate));
  if (!validQuote) {
    return { ok: false, reason: `维度「${dimensionName}」缺少可定位的正文逐字证据或引用不存在于正文` };
  }

  return { ok: true, locatedQuote: validQuote };
}

/**
 * 共享质量门禁评估器，执行 Fail-Closed 策略。
 * 覆盖自动生成、手动修订复审和最终提交三处，杜绝伪造分数与绕过质量检查。
 *
 * 全面支持 4 层 QualityAssessment 结构 (compliance, literary, style, aiFlavor)：
 * - compliance.checks 中的代理/启发式指标被识别为合规证据，不再误报阻断文学质量门禁；
 * - literary.dimensions 严格核验主观文学叙事质量与正文逐字证据；
 * - 严格 Provenance Guard 拦截代理指标潜入文学层；
 * - aiFlavor 阻断 critical 风险与未通过状态；
 * - 保持对既有调用方与遗留 qualityVector 的 100% 向后兼容。
 */
function evaluateQualityGate(options = {}) {
  const rawProse = String(options.draft ?? options.text ?? options.content ?? options.prose ?? '');
  if (!rawProse.trim()) {
    return {
      passed: false,
      status: 'needs_human',
      code: 'QUALITY_UNMEASURED',
      reason: '待质检正文内容为空',
      quality: {
        passed: false,
        status: 'NOT_MEASURED',
        qualityVector: {},
        unmeasuredReason: '正文为空'
      }
    };
  }
  const proseContent = rawProse;
  const currentProseDigest = computeSha256(proseContent);

  const rawQuality = options.quality;
  const rawGenre = options.genre;

  if (!rawQuality || typeof rawQuality !== 'object' || Array.isArray(rawQuality)) {
    return {
      passed: false,
      status: 'needs_human',
      code: 'QUALITY_UNMEASURED',
      reason: '未提供质量评估结果 (quality 为空或非对象)',
      quality: {
        passed: false,
        status: 'NOT_MEASURED',
        qualityVector: {},
        unmeasuredReason: 'quality 缺失'
      }
    };
  }

  // 浅拷贝以防入参被外部 freeze 导致直接修改报错
  const qualityData = { ...rawQuality };

  // 若传入了双独立评委数据，先经由双评委共识判定
  const judgeA = qualityData.judgeA || (qualityData.literary && qualityData.literary.judgeA);
  const judgeB = qualityData.judgeB || (qualityData.literary && qualityData.literary.judgeB);
  if (judgeA && judgeB) {
    const { evaluateDualJudgeConsensus } = require('../quality/dual-judge');
    const dualResult = evaluateDualJudgeConsensus(judgeA, judgeB, options);
    if (!dualResult.consensus || !dualResult.passed) {
      return {
        passed: false,
        status: 'needs_human',
        code: dualResult.code || 'DUAL_JUDGE_DISCREPANCY',
        reason: dualResult.reason || '双评委质量分歧过大，已转入人工复核',
        quality: {
          ...qualityData,
          passed: false,
          status: 'needs_human',
          dualJudge: dualResult
        }
      };
    }
    qualityData.passed = true;
    qualityData.status = 'MEASURED';
    qualityData.qualityVector = { ...dualResult.qualityVector, ...(qualityData.qualityVector || {}) };
    if (qualityData.literary && typeof qualityData.literary === 'object') {
      qualityData.literary = {
        ...qualityData.literary,
        dimensions: { ...dualResult.qualityVector, ...(qualityData.literary.dimensions || {}) },
        score: dualResult.score,
        passed: true,
        status: 'MEASURED'
      };
    }
    qualityData.score = dualResult.score;
    qualityData.dualJudge = dualResult;
  }

  // 顶层状态校验：显式传入状态优先；若未传，则可降级读取 literary.status
  const rawTopStatus = qualityData.status !== undefined
    ? String(qualityData.status || '')
    : (qualityData.literary && qualityData.literary.status ? String(qualityData.literary.status) : '');
  const topStatus = rawTopStatus.trim().toUpperCase();

  // 若处于明确的未测量状态，直接阻断并返回规范的 QUALITY_UNMEASURED 错误码
  const isExplicitlyUnmeasured = !topStatus ||
    topStatus === 'NOT_MEASURED' ||
    topStatus === 'ESTIMATED' ||
    topStatus === 'UNKNOWN' ||
    (!VALID_MEASURED_STATUSES.has(topStatus) && topStatus !== 'NEEDS_HUMAN');

  if (isExplicitlyUnmeasured) {
    return {
      passed: false,
      status: 'needs_human',
      code: 'QUALITY_UNMEASURED',
      reason: `顶层质量状态为「${qualityData.status || '未标注'}」，未真实完成测量 (仅接受 MEASURED / JUDGED / HUMAN_REVIEWED)`,
      quality: {
        ...qualityData,
        passed: false,
        status: qualityData.status || 'NOT_MEASURED'
      }
    };
  }

  // 哈希摘要校验
  const hashChecks = [
    { label: 'options.contentDigest', value: options.contentDigest },
    { label: 'options.contentHash', value: options.contentHash },
    { label: 'options.outputHash', value: options.outputHash },
    { label: 'options.expectedContentDigest', value: options.expectedContentDigest },
    { label: 'options.expectedContentHash', value: options.expectedContentHash },
    { label: 'options.expectedOutputHash', value: options.expectedOutputHash },
    { label: 'quality.contentDigest', value: qualityData.contentDigest },
    { label: 'quality.contentHash', value: qualityData.contentHash },
    { label: 'quality.outputHash', value: qualityData.outputHash }
  ];
  for (const check of hashChecks) {
    if (check.value !== undefined) {
      if (typeof check.value !== 'string' || !/^[a-f0-9]{64}$/i.test(check.value.trim())) {
        return {
          passed: false,
          status: 'needs_human',
          code: 'QUALITY_UNMEASURED',
          reason: `正文内容摘要格式非法: 「${check.label}」必须为 64 位 SHA-256 字符串，不能以 null、空串或非哈希值绕过`,
          quality: {
            ...qualityData,
            passed: false,
            status: qualityData.status || 'NOT_MEASURED'
          }
        };
      }
      if (check.value.trim().toLowerCase() !== currentProseDigest.toLowerCase()) {
        return {
          passed: false,
          status: 'needs_human',
          code: 'QUALITY_UNMEASURED',
          reason: `正文内容摘要不一致: 「${check.label}」为「${check.value}」，当前正文实际「${currentProseDigest}」`,
          quality: {
            ...qualityData,
            passed: false,
            status: qualityData.status || 'NOT_MEASURED'
          }
        };
      }
    }
  }

  if (qualityData.independentEvidence === false) {
    return {
      passed: false,
      status: 'needs_human',
      code: 'QUALITY_UNMEASURED',
      reason: '当前结果仅有语义审计通过，缺少独立文学质量评估证据',
      quality: {
        ...qualityData,
        passed: false,
        status: 'NOT_MEASURED'
      }
    };
  }

  const blockers = [];

  // 1. Compliance 层检查（合规层与代理指标去冲突）
  if (qualityData.compliance && typeof qualityData.compliance === 'object') {
    const compliance = qualityData.compliance;
    const complianceIssues = Array.isArray(compliance.issues) ? compliance.issues : [];
    const hasBlocker = Number(compliance.blockerCount) > 0 ||
      complianceIssues.some(i => i && i.severity === 'blocker');

    if (compliance.passed !== true || hasBlocker) {
      const issueReason = complianceIssues.find(i => i && (i.message || i.reason))?.message ||
        complianceIssues.find(i => i && (i.message || i.reason))?.reason ||
        compliance.reason ||
        '质量评估合规层检查未通过 (compliance.passed !== true 或存在阻断项)';
      blockers.push({
        dimension: 'compliance',
        code: 'COMPLIANCE_CHECK_FAILED',
        reason: issueReason
      });
    }
  }

  // 2. AI Flavor 层检查
  const aiFlavorObj = (qualityData.aiFlavor && typeof qualityData.aiFlavor === 'object')
    ? qualityData.aiFlavor
    : ((qualityData.ai_flavor_risk && typeof qualityData.ai_flavor_risk === 'object') ? qualityData.ai_flavor_risk : null);

  if (aiFlavorObj) {
    const aiRisk = String(aiFlavorObj.risk || '').trim().toLowerCase();
    if (aiRisk === 'critical') {
      blockers.push({
        dimension: 'aiFlavor',
        code: 'AI_FLAVOR_CRITICAL_RISK',
        reason: 'AI笔调检测处于 critical 风险，禁止通过质量门禁'
      });
    } else if (aiFlavorObj.passed === false) {
      blockers.push({
        dimension: 'aiFlavor',
        code: 'AI_FLAVOR_CHECK_FAILED',
        reason: 'AI笔调检测未通过 (aiFlavor.passed === false)'
      });
    }
  }

  // 3. Style 层检查
  if (qualityData.style && typeof qualityData.style === 'object') {
    if (qualityData.style.passed === false) {
      blockers.push({
        dimension: 'style',
        code: 'STYLE_QUALITY_FAILED',
        reason: qualityData.style.reason || '质量评估风格质感未通过 (style.passed === false)'
      });
    }
  }

  // 4. 文学维度解析与来源门禁 (Provenance Guard)
  // 核心：优先从 quality.literary.dimensions 读取主观文学维度，fallback 到 legacy qualityVector
  let literaryDimensions = null;
  if (qualityData.literary && qualityData.literary.dimensions && typeof qualityData.literary.dimensions === 'object' && !Array.isArray(qualityData.literary.dimensions)) {
    literaryDimensions = qualityData.literary.dimensions;
  } else if (qualityData.qualityVector && typeof qualityData.qualityVector === 'object' && !Array.isArray(qualityData.qualityVector)) {
    literaryDimensions = qualityData.qualityVector;
  } else if (qualityData.vector && typeof qualityData.vector === 'object' && !Array.isArray(qualityData.vector)) {
    literaryDimensions = qualityData.vector;
  }

  const qualityVector = qualityData.qualityVector || qualityData.vector || literaryDimensions || {};

  // 若无具体层级 blocker 产生，但顶层 qualityData.passed 并非严格 true，执行未测量兜底阻断
  if (qualityData.passed !== true && blockers.length === 0) {
    return {
      passed: false,
      status: 'needs_human',
      code: 'QUALITY_UNMEASURED',
      reason: '质量评估未被标记为严格通过 (passed !== true)',
      quality: {
        ...qualityData,
        passed: false,
        status: qualityData.status || 'NOT_MEASURED'
      }
    };
  }

  if (!literaryDimensions || typeof literaryDimensions !== 'object' || Array.isArray(literaryDimensions) || Object.keys(literaryDimensions).length === 0) {
    return {
      passed: false,
      status: 'needs_human',
      code: 'QUALITY_UNMEASURED',
      reason: '质量向量或文学维度 (qualityVector / literary.dimensions) 为空或无效',
      quality: {
        ...qualityData,
        passed: false,
        status: 'NOT_MEASURED',
        qualityVector: {}
      }
    };
  }

  const { genreKey, dimensions } = resolveGenreDimensions(rawGenre);
  const evaluatedDimensions = {};

  for (const dimensionName of dimensions) {
    const entry = literaryDimensions[dimensionName];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      blockers.push({
        dimension: dimensionName,
        code: 'CRITICAL_QUALITY_DIMENSION_MISSING',
        reason: `题材「${genreKey}」关键质检维度「${dimensionName}」缺失`
      });
      continue;
    }

    const currentStatus = String(entry.status || '').trim();
    if (!VALID_MEASURED_STATUSES.has(currentStatus)) {
      blockers.push({
        dimension: dimensionName,
        code: 'CRITICAL_QUALITY_DIMENSION_NOT_MEASURED',
        reason: `维度「${dimensionName}」状态为「${currentStatus || '未标注'}」，未真实完成测量`
      });
      continue;
    }

    const rawScore = entry.value !== undefined ? entry.value : entry.score;
    if (typeof rawScore !== 'number' || !Number.isFinite(rawScore) || rawScore < 0 || rawScore > 1) {
      blockers.push({
        dimension: dimensionName,
        code: 'QUALITY_SCORE_INVALID',
        reason: `维度「${dimensionName}」分值必须为 0..1 范围内的严格有限 number，不接受布尔、null 或数值字符串`
      });
      continue;
    }
    const numericScore = rawScore;

    if (numericScore < INITIAL_SCORE_THRESHOLD) {
      blockers.push({
        dimension: dimensionName,
        code: 'QUALITY_THRESHOLD_NOT_MET',
        reason: `维度「${dimensionName}」分值「${numericScore}」未达到门限「${INITIAL_SCORE_THRESHOLD}」`
      });
      continue;
    }

    const rawConfidence = entry.confidence;
    if (typeof rawConfidence !== 'number' || !Number.isFinite(rawConfidence) || rawConfidence < 0 || rawConfidence > 1) {
      blockers.push({
        dimension: dimensionName,
        code: 'QUALITY_CONFIDENCE_INVALID',
        reason: `维度「${dimensionName}」置信度必须为 0..1 范围内的严格有限 number，不接受布尔、null 或数值字符串`
      });
      continue;
    }
    const numericConfidence = rawConfidence;

    if (numericConfidence < INITIAL_CONFIDENCE_THRESHOLD) {
      blockers.push({
        dimension: dimensionName,
        code: 'QUALITY_CONFIDENCE_LOW',
        reason: `维度「${dimensionName}」置信度「${numericConfidence}」低于门限「${INITIAL_CONFIDENCE_THRESHOLD}」`
      });
      continue;
    }

    const evidenceCheck = verifyDimensionEvidence(dimensionName, entry, proseContent);
    if (!evidenceCheck.ok) {
      blockers.push({
        dimension: dimensionName,
        code: 'QUALITY_EVIDENCE_INVALID',
        reason: evidenceCheck.reason
      });
      continue;
    }

    evaluatedDimensions[dimensionName] = {
      ...entry,
      verifiedScore: numericScore,
      verifiedConfidence: numericConfidence,
      verifiedQuote: evidenceCheck.locatedQuote
    };
  }

  // 5. 文学层整体状态检查（若前面无具体维度 blocker，但 literary.passed === false）
  if (qualityData.literary && qualityData.literary.passed === false && blockers.length === 0) {
    blockers.push({
      dimension: 'literary',
      code: 'LITERARY_QUALITY_REQUIRED',
      reason: qualityData.literary.reason || '质量评估文学层未通过 (literary.passed !== true)'
    });
  }

  // 若顶层为 needs_human 且前面没有定位到细分 blocker，兜底作为 unmeasured
  if (!VALID_MEASURED_STATUSES.has(topStatus) && blockers.length === 0) {
    blockers.push({
      dimension: 'status',
      code: 'QUALITY_UNMEASURED',
      reason: `顶层质量状态为「${qualityData.status || '未标注'}」，未真实完成测量`
    });
  }

  if (blockers.length > 0) {
    const firstBlocker = blockers[0];
    const isUnmeasured = firstBlocker.code.includes('NOT_MEASURED') || firstBlocker.code.includes('MISSING');
    return {
      passed: false,
      status: 'needs_human',
      code: isUnmeasured ? 'QUALITY_UNMEASURED' : firstBlocker.code,
      reason: firstBlocker.reason,
      blockers,
      quality: {
        ...qualityData,
        passed: false,
        status: isUnmeasured ? 'NOT_MEASURED' : (qualityData.status || 'MEASURED'),
        qualityVector,
        unmeasuredReason: firstBlocker.reason,
        initialThresholdNote: 'score>=0.70, confidence>=0.75 (未校准初值)'
      }
    };
  }

  const finalLiterary = qualityData.literary ? {
    ...qualityData.literary,
    passed: true,
    status: qualityData.literary.status || 'MEASURED',
    dimensions: literaryDimensions
  } : undefined;

  return {
    passed: true,
    status: 'passed',
    code: 'OK',
    reason: '全题材必要维度质检与正文证据核验通过',
    quality: {
      ...qualityData,
      passed: true,
      status: qualityData.status || 'MEASURED',
      qualityVector,
      genreKey,
      evaluatedDimensions,
      ...(finalLiterary ? { literary: finalLiterary } : {}),
      contentHash: currentProseDigest,
      contentDigest: currentProseDigest,
      outputHash: currentProseDigest,
      initialThresholdNote: 'score>=0.70, confidence>=0.75 (未校准初值)'
    }
  };
}

module.exports = {
  CRITICAL_QUALITY_DIMENSIONS,
  INITIAL_SCORE_THRESHOLD,
  INITIAL_CONFIDENCE_THRESHOLD,
  resolveGenreDimensions,
  verifyDimensionEvidence,
  evaluateQualityGate,
  isProxySource
};
