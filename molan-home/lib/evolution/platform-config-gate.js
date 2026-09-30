'use strict';

const { hashJson } = require('./replay-manifest');
const { compareQualityVectors, validatePromotion } = require('./quality-vector-ab');

function canonicalGlobalPrompts(value) {
  if (!Array.isArray(value)) return value;
  return value.map(skill => {
    if (!skill || typeof skill !== 'object' || Array.isArray(skill)) return skill;
    const copy = structuredClone(skill);
    for (const field of ['createdAt', 'updatedAt', 'downloads']) delete copy[field];
    return copy;
  });
}

/** Gate platform rollout only; callers pass the exact normalized value they will persist. */
function validatePlatformConfigPromotion({ kind, proposed, evidence } = {}) {
  const reasons = [];
  const allowed = new Set(['default-model', 'global-prompts', 'genre-profile', 'style-profile', 'pipeline']);
  if (!allowed.has(kind)) reasons.push('platform_config_kind_invalid');
  if (!evidence?.report || !evidence?.input || !evidence?.target || !evidence?.artifactRoot) reasons.push('platform_promotion_evidence_required');
  if (!reasons.length) {
    try {
      const recomputed = compareQualityVectors(evidence.input, { artifactRoot: evidence.artifactRoot });
      if (recomputed.status !== 'PROMOTION_READY' || recomputed.reportHash !== evidence.report.reportHash) reasons.push('platform_source_report_mismatch');
      const binding = validatePromotion(recomputed, evidence.target);
      reasons.push(...binding.blockingReasons);
      const configuration = evidence.target.configuration;
      const expected = kind === 'default-model' ? evidence.target.model
        : configuration?.[{ 'global-prompts': 'prompt', 'genre-profile': 'genreProfile', 'style-profile': 'style', pipeline: 'pipeline' }[kind]];
      const canonical = kind === 'global-prompts' ? canonicalGlobalPrompts : value => value;
      if (expected === undefined || hashJson(canonical(expected)) !== hashJson(canonical(proposed))) reasons.push('platform_proposed_content_mismatch');
    } catch (error) {
      reasons.push(`platform_evidence_invalid:${error.message}`);
    }
  }
  return { schemaVersion: 'platform-config-promotion-gate-v1', status: reasons.length ? 'BLOCKED' : 'PASS', accepted: reasons.length === 0, blockingReasons: [...new Set(reasons)] };
}

function assertPlatformConfigPromotion(options) {
  const result = validatePlatformConfigPromotion(options);
  if (!result.accepted) {
    const error = new Error('平台配置晋级证据未通过质量门禁');
    error.statusCode = 409;
    error.code = 'QUALITY_PROMOTION_BLOCKED';
    error.details = result;
    throw error;
  }
  return result;
}

module.exports = { validatePlatformConfigPromotion, assertPlatformConfigPromotion, canonicalGlobalPrompts };
