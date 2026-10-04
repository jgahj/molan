'use strict';

const crypto = require('node:crypto');

const { CRITICAL_QUALITY_DIMENSIONS, isProxySource } = require('./quality-assessment');

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
  const contractChapterNo = Number(result.contract && result.contract.chapterNo);

  const isQualityAssessment = Boolean(quality && (quality.schemaVersion === 'quality-assessment-v1' || quality.literary || quality.compliance));
  let qualityVector = quality && (quality.qualityVector || quality.vector);
  if (!qualityVector && quality && quality.literary && quality.literary.dimensions) {
    qualityVector = quality.literary.dimensions;
  }

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
  if (!quality || typeof quality !== 'object' || Array.isArray(quality)) {
    return { ok: false, code: 'QUALITY_AUDIT_REQUIRED', message: '质量评估未提供或格式无效' };
  }

  // QualityAssessment 分层约束校验优先（提供细分错误码）
  if (isQualityAssessment) {
    if (quality.compliance && (quality.compliance.passed !== true || auditHasBlocker(quality.compliance))) {
      return { ok: false, code: 'COMPLIANCE_AUDIT_REQUIRED', message: '质量评估合规层未通过' };
    }
    if (quality.literary && quality.literary.passed !== true) {
      return { ok: false, code: 'LITERARY_QUALITY_REQUIRED', message: '质量评估文学质量未通过' };
    }
    if (quality.style && quality.style.passed === false) {
      return { ok: false, code: 'STYLE_QUALITY_REQUIRED', message: '质量评估风格质感未通过' };
    }
    if (quality.aiFlavor && (quality.aiFlavor.risk === 'critical' || quality.aiFlavor.passed === false)) {
      return { ok: false, code: 'AI_FLAVOR_CRITICAL_RISK', message: '质量评估检测到严重 AI 笔调风险' };
    }
  }

  if (quality.passed !== true || !qualityVector || typeof qualityVector !== 'object' ||
      Array.isArray(qualityVector) || !Object.keys(qualityVector).length) {
    return { ok: false, code: 'QUALITY_AUDIT_REQUIRED', message: '质量向量未通过或缺失' };
  }

  // 严格题材质量维度门禁检验
  const rawGenre = input.genre ||
    (result.genreResolution && (result.genreResolution.genre || result.genreResolution.id)) ||
    result.effectiveGenre ||
    (quality && quality.genre) ||
    '';
  const genreKey = matchGenreKey(rawGenre);
  const requiredDimensions = genreKey ? CRITICAL_QUALITY_DIMENSIONS[genreKey] : ['language'];

  const dimensionsSource = (quality && quality.literary && quality.literary.dimensions && Object.keys(quality.literary.dimensions).length > 0)
    ? quality.literary.dimensions
    : qualityVector;

  for (const dim of requiredDimensions) {
    const entry = dimensionsSource[dim] || qualityVector[dim];
    if (!entry) {
      return {
        ok: false,
        code: 'CRITICAL_QUALITY_DIMENSION_MISSING',
        message: `质量向量缺失题材「${genreKey || '通用'}」关键质检维度「${dim}」`
      };
    }
    if (entry && entry.status === 'NOT_MEASURED') {
      return {
        ok: false,
        code: 'CRITICAL_QUALITY_DIMENSION_NOT_MEASURED',
        message: `关键质检维度「${dim}」未真实测量 (status=NOT_MEASURED)`
      };
    }
    if (isQualityAssessment) {
      const sourceName = typeof entry === 'object' && entry ? entry.source : '';
      if (isProxySource(sourceName)) {
        return {
          ok: false,
          code: 'CRITICAL_QUALITY_DIMENSION_PROVENANCE_VIOLATION',
          message: `关键质检维度「${dim}」来源于代理指标「${sourceName || '未标注'}」，代理来源不可满足文学层维度`
        };
      }
    }
    const score = typeof entry === 'number' ? entry : Number(entry.value !== undefined ? entry.value : entry.score);
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
      quality,
      qualityAssessment: (quality && quality.schemaVersion === 'quality-assessment-v1') ? quality : undefined
    }
  };
}

module.exports = { CRITICAL_QUALITY_DIMENSIONS, validateGenerationAuditEvidence, matchGenreKey, auditHasBlocker };
