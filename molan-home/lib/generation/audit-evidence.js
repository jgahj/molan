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

/** 计算正文摘要，供提交门禁绑定完整输出。 */
function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

/** 判断审计结果是否仍含未解决的阻断项。 */
function auditHasBlocker(audit) {
  if (!audit || typeof audit !== 'object') return false;
  if (Number(audit.blockerCount) > 0 || ['blocked', 'needs_review', 'provider_unknown'].includes(String(audit.status || ''))) return true;
  return Array.isArray(audit.issues) && audit.issues.some(issue => issue && issue.severity === 'blocker');
}

/** 规范化题材名称以匹配质检维度表。 */
function matchGenreKey(rawGenre) {
  const str = String(rawGenre || '').trim();
  if (!str) return '';
  for (const key of Object.keys(CRITICAL_QUALITY_DIMENSIONS)) {
    if (str === key || str.includes(key) || key.includes(str)) return key;
  }
  return '';
}

/** 将 Generation Run 中的最终审计结果绑定到实际正文和目标章节。 */
function validateGenerationAuditEvidence(input = {}) {
  const generationId = String(input.generationId || '').trim();
  const chapterNo = Number(input.chapterNo);
  const content = String(input.content || '');
  const contentHash = sha256(content);
  const result = input.result && typeof input.result === 'object' ? input.result : {};
  const deterministic = result.audit || result.deterministicAudit;
  const semantic = result.semanticAudit;
  const semanticEvidence = semantic && semantic.audit;
  const quality = result.quality;
  const qualityVector = quality && (quality.qualityVector || quality.vector);
  const contractChapterNo = Number(result.contract && result.contract.chapterNo);

  if (!generationId || !Number.isInteger(chapterNo) || chapterNo < 1 || !content.trim() || String(input.contentHash || '') !== contentHash ||
      String(result.draft || '') !== content || String(result.outputHash || '') !== contentHash ||
      !Number.isInteger(contractChapterNo) || contractChapterNo !== chapterNo) {
    return { ok: false, code: 'AUDIT_EVIDENCE_MISMATCH', message: 'Generation Run、正文摘要或章节编号不匹配' };
  }
  if (!deterministic || deterministic.passed !== true || auditHasBlocker(deterministic)) {
    return { ok: false, code: 'DETERMINISTIC_AUDIT_REQUIRED', message: '确定性审计未通过' };
  }
  if (!semantic || semantic.passed !== true || !semanticEvidence || semanticEvidence.passed !== true ||
      auditHasBlocker(semanticEvidence) || auditHasBlocker(semantic)) {
    return { ok: false, code: 'SEMANTIC_AUDIT_REQUIRED', message: '语义审计证据未通过' };
  }
  if (!quality || quality.passed !== true || !qualityVector || typeof qualityVector !== 'object' ||
      Array.isArray(qualityVector) || !Object.keys(qualityVector).length) {
    return { ok: false, code: 'QUALITY_AUDIT_REQUIRED', message: '质量向量未通过或缺失' };
  }

  // 严格题材质量维度门禁检验
  const rawGenre = input.genre ||
    (result.genreResolution && (result.genreResolution.genre || result.genreResolution.id)) ||
    result.effectiveGenre || '';
  const genreKey = matchGenreKey(rawGenre);
  const requiredDimensions = genreKey ? CRITICAL_QUALITY_DIMENSIONS[genreKey] : ['language'];

  for (const dim of requiredDimensions) {
    const entry = qualityVector[dim];
    if (!entry) {
      return {
        ok: false,
        code: 'CRITICAL_QUALITY_DIMENSION_MISSING',
        message: `质量向量缺失题材「${genreKey || '通用'}」关键质检维度「${dim}」`
      };
    }
    const score = typeof entry === 'number' ? entry : Number(entry.value);
    if (!Number.isFinite(score) || score < 0.4) {
      return {
        ok: false,
        code: 'QUALITY_THRESHOLD_NOT_MET',
        message: `关键质检维度「${dim}」评分（${score}）未达门限`
      };
    }
  }

  return {
    ok: true,
    evidence: {
      protocol: 'generation-v2-audit-v1',
      generationId,
      chapterNo,
      contentHash,
      passed: true,
      deterministicAudit: deterministic,
      semanticAudit: semanticEvidence,
      quality
    }
  };
}

module.exports = { CRITICAL_QUALITY_DIMENSIONS, validateGenerationAuditEvidence };
