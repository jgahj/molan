'use strict';

const crypto = require('node:crypto');
const { CRITICAL_QUALITY_DIMENSIONS } = require('./audit-evidence');

const VALID_MEASURED_STATUSES = Object.freeze(new Set([
  'MEASURED',
  'JUDGED',
  'HUMAN_REVIEWED'
]));

const INITIAL_SCORE_THRESHOLD = 0.70;
const INITIAL_CONFIDENCE_THRESHOLD = 0.75;

const PROXY_SOURCE_PATTERN = /^(heuristic|presence|ratio|linguistic_metrics_analyzer|word_count|dialogue_extractor|dialogue_density_evaluator|character_presence_verifier|causal_debt_prose_verifier|chapter_goal_prose_verifier|pov_and_clue_boundary_evaluator|fact_consistency_verifier|causal_issue_detector|unmeasured|none)$/i;
const PROXY_EVIDENCE_PATTERN = /^(字符数=|目标字数=|句子数=|平均句长=|对白提取总句数=|对白字数占比=|未检测到|未检出|无违规|无问题|零越界|无明确冲突|初筛完成)/i;
const NEGATIVE_ABSENCE_PATTERN = /(未检测到|未检出|无违规|无问题|零越界|无明确冲突|初筛完成)/;

/** 判断指定来源名称是否属于已知代理指标或规则统计检查器。 */
function isProxySource(sourceName) {
  const normalized = String(sourceName || '').trim().toLowerCase();
  if (!normalized || normalized === 'none' || normalized === 'unmeasured') return true;
  if (PROXY_SOURCE_PATTERN.test(normalized)) return true;
  if (normalized.includes('heuristic') || normalized.includes('presence') || normalized.includes('ratio') ||
      normalized.includes('word_count') || normalized.includes('metrics') || normalized.includes('extractor') ||
      normalized.includes('boundary_evaluator') || normalized.includes('prose_verifier')) {
    return true;
  }
  return false;
}

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
  const rawSemantic = options.semanticAudit || options.semantic;

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

  // 若传入了双独立评委数据，先经由双评委共识判定
  if (rawQuality.judgeA && rawQuality.judgeB) {
    const { evaluateDualJudgeConsensus } = require('../quality/dual-judge');
    const dualResult = evaluateDualJudgeConsensus(rawQuality.judgeA, rawQuality.judgeB, options);
    if (!dualResult.consensus || !dualResult.passed) {
      return {
        passed: false,
        status: 'needs_human',
        code: dualResult.code || 'DUAL_JUDGE_DISCREPANCY',
        reason: dualResult.reason || '双评委质量分歧过大，已转入人工复核',
        quality: {
          ...rawQuality,
          passed: false,
          status: 'needs_human',
          dualJudge: dualResult
        }
      };
    }
    rawQuality.passed = true;
    rawQuality.status = 'MEASURED';
    rawQuality.qualityVector = { ...dualResult.qualityVector, ...(rawQuality.qualityVector || {}) };
    rawQuality.score = dualResult.score;
    rawQuality.dualJudge = dualResult;
  }

  const topStatus = String(rawQuality.status || '').trim().toUpperCase();
  if (!topStatus || !VALID_MEASURED_STATUSES.has(topStatus)) {
    return {
      passed: false,
      status: 'needs_human',
      code: 'QUALITY_UNMEASURED',
      reason: `顶层质量状态为「${rawQuality.status || '未标注'}」，未真实完成测量 (仅接受 MEASURED / JUDGED / HUMAN_REVIEWED)`,
      quality: {
        ...rawQuality,
        passed: false,
        status: rawQuality.status || 'NOT_MEASURED'
      }
    };
  }

  if (rawQuality.passed !== true) {
    return {
      passed: false,
      status: 'needs_human',
      code: 'QUALITY_UNMEASURED',
      reason: '质量评估未被标记为严格通过 (passed !== true)',
      quality: {
        ...rawQuality,
        passed: false,
        status: rawQuality.status || 'NOT_MEASURED'
      }
    };
  }

  const qualityVector = rawQuality.qualityVector || rawQuality.vector;
  if (!qualityVector || typeof qualityVector !== 'object' || Array.isArray(qualityVector) || Object.keys(qualityVector).length === 0) {
    return {
      passed: false,
      status: 'needs_human',
      code: 'QUALITY_UNMEASURED',
      reason: '质量向量 (qualityVector) 为空或无效',
      quality: {
        ...rawQuality,
        passed: false,
        status: 'NOT_MEASURED',
        qualityVector: {}
      }
    };
  }

  const hashChecks = [
    { label: 'options.contentDigest', value: options.contentDigest },
    { label: 'options.contentHash', value: options.contentHash },
    { label: 'options.outputHash', value: options.outputHash },
    { label: 'options.expectedContentDigest', value: options.expectedContentDigest },
    { label: 'options.expectedContentHash', value: options.expectedContentHash },
    { label: 'options.expectedOutputHash', value: options.expectedOutputHash },
    { label: 'quality.contentDigest', value: rawQuality.contentDigest },
    { label: 'quality.contentHash', value: rawQuality.contentHash },
    { label: 'quality.outputHash', value: rawQuality.outputHash }
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
            ...rawQuality,
            passed: false,
            status: rawQuality.status || 'NOT_MEASURED'
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
            ...rawQuality,
            passed: false,
            status: rawQuality.status || 'NOT_MEASURED'
          }
        };
      }
    }
  }

  if (rawQuality.independentEvidence === false) {
    return {
      passed: false,
      status: 'needs_human',
      code: 'QUALITY_UNMEASURED',
      reason: '当前结果仅有语义审计通过，缺少独立文学质量评估证据',
      quality: {
        ...rawQuality,
        passed: false,
        status: 'NOT_MEASURED'
      }
    };
  }

  const { genreKey, dimensions } = resolveGenreDimensions(rawGenre);
  const evaluatedDimensions = {};
  const blockers = [];

  for (const dimensionName of dimensions) {
    const entry = qualityVector[dimensionName];
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
        ...rawQuality,
        passed: false,
        status: isUnmeasured ? 'NOT_MEASURED' : (rawQuality.status || 'MEASURED'),
        qualityVector,
        unmeasuredReason: firstBlocker.reason,
        initialThresholdNote: 'score>=0.70, confidence>=0.75 (未校准初值)'
      }
    };
  }

  return {
    passed: true,
    status: 'passed',
    code: 'OK',
    reason: '全题材必要维度质检与正文证据核验通过',
    quality: {
      ...rawQuality,
      passed: true,
      status: rawQuality.status || 'MEASURED',
      qualityVector,
      genreKey,
      evaluatedDimensions,
      contentHash: currentProseDigest,
      contentDigest: currentProseDigest,
      outputHash: currentProseDigest,
      initialThresholdNote: 'score>=0.70, confidence>=0.75 (未校准初值)'
    }
  };
}

module.exports = {
  INITIAL_SCORE_THRESHOLD,
  INITIAL_CONFIDENCE_THRESHOLD,
  resolveGenreDimensions,
  verifyDimensionEvidence,
  evaluateQualityGate
};
