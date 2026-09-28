'use strict';

const EVALUATION_STATUSES = new Set([
  'VALID_FOR_DESCRIPTIVE', 'VALID_FOR_PAIRED_AB', 'INCONCLUSIVE', 'EVALUATION_INVALID'
]);

const VALIDITY_CHECKS = Object.freeze([
  'task_fit',
  'provenance_separation',
  'paired_manifest_integrity',
  'human_review_integrity',
  'quote_verification',
  'pipeline_conditions',
  'failure_accounting'
]);

const DESCRIPTIVE_CHECKS = Object.freeze([
  'task_fit', 'provenance_separation', 'quote_verification', 'pipeline_conditions', 'failure_accounting'
]);

const REQUIRED_CHECKS_BY_MODE = Object.freeze({
  CORPUS_PROFILE: DESCRIPTIVE_CHECKS,
  HISTORICAL_RUN_AUDIT: DESCRIPTIVE_CHECKS,
  P4_LONGFORM: [...DESCRIPTIVE_CHECKS, 'human_review_integrity'],
  P3_BLIND_AB: VALIDITY_CHECKS
});

const INVALIDITY_CODES = new Set([
  'benchmark_contamination',
  'blind_mapping_leak',
  'hash_mismatch',
  'evidence_fabrication',
  'sample_omission',
  'condition_mismatch_claimed_as_causal'
]);

function normalizeReferences(value, evidenceIds) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))]
    .filter(reference => evidenceIds.has(reference));
}

/** Classifies evidence readiness; it does not verify referenced artifacts itself. */
function checkValidityGate({ mode, checks = {}, evidenceIds = [], invalidityFindings = [], genreMapping } = {}) {
  const normalizedMode = String(mode || '').trim().toUpperCase();
  const requiredChecks = REQUIRED_CHECKS_BY_MODE[normalizedMode] || [];
  const ids = evidenceIds instanceof Set
    ? evidenceIds
    : new Set(Array.isArray(evidenceIds) ? evidenceIds.map(value => String(value || '').trim()).filter(Boolean) : []);
  const normalizedChecks = {};

  for (const checkId of VALIDITY_CHECKS) {
    const source = checks && typeof checks === 'object' && !Array.isArray(checks) ? checks[checkId] : null;
    const rawStatus = String(source && source.status || '').trim().toUpperCase();
    const evidenceRefs = normalizeReferences(source && source.evidence_refs, ids);
    const status = ['PASS', 'FAIL'].includes(rawStatus) && evidenceRefs.length
      ? rawStatus
      : 'NOT_ASSESSED';
    normalizedChecks[checkId] = { status, evidence_refs: evidenceRefs };
  }

  const sourceGenre = String(genreMapping && genreMapping.source_genre || '').trim();
  const targetGenre = String(genreMapping && genreMapping.target_genre || '').trim();
  const mappingEvidence = normalizeReferences(genreMapping && genreMapping.evidence_refs, ids);
  let genreMappingStatus = 'NOT_PROVIDED';
  if (sourceGenre && targetGenre) {
    if (sourceGenre === targetGenre) {
      genreMappingStatus = 'SAME_LABEL';
    } else if (String(genreMapping.status || '').toUpperCase() === 'VERIFIED' &&
        String(genreMapping.mapping_id || '').trim() && mappingEvidence.length) {
      genreMappingStatus = 'VERIFIED';
    } else {
      genreMappingStatus = 'GENRE_MAPPING_UNVERIFIED';
      normalizedChecks.task_fit = { status: 'NOT_ASSESSED', evidence_refs: [] };
    }
  }

  const verifiedInvalidityFindings = [];
  const unverifiedInvalidityFindings = [];
  for (const finding of Array.isArray(invalidityFindings) ? invalidityFindings : []) {
    const code = String(finding && finding.code || '').trim();
    const evidenceRefs = normalizeReferences(finding && finding.evidence_refs, ids);
    if (INVALIDITY_CODES.has(code) && evidenceRefs.length) {
      verifiedInvalidityFindings.push({ code, evidence_refs: evidenceRefs });
    } else {
      unverifiedInvalidityFindings.push(code || 'UNKNOWN');
    }
  }

  const missingChecks = requiredChecks.filter(checkId => normalizedChecks[checkId].status !== 'PASS');
  let evaluationStatus = 'INCONCLUSIVE';
  if (verifiedInvalidityFindings.length) {
    evaluationStatus = 'EVALUATION_INVALID';
  } else if (requiredChecks.length && !missingChecks.length && !unverifiedInvalidityFindings.length) {
    evaluationStatus = normalizedMode === 'P3_BLIND_AB'
      ? 'VALID_FOR_PAIRED_AB'
      : 'VALID_FOR_DESCRIPTIVE';
  }

  return {
    mode: REQUIRED_CHECKS_BY_MODE[normalizedMode] ? normalizedMode : null,
    evaluation_status: EVALUATION_STATUSES.has(evaluationStatus) ? evaluationStatus : 'INCONCLUSIVE',
    required_checks: requiredChecks,
    checks: normalizedChecks,
    genre_mapping_status: genreMappingStatus,
    missing_checks: missingChecks,
    verified_invalidity_findings: verifiedInvalidityFindings,
    unverified_invalidity_findings: unverifiedInvalidityFindings
  };
}

module.exports = {
  EVALUATION_STATUSES,
  VALIDITY_CHECKS,
  REQUIRED_CHECKS_BY_MODE,
  checkValidityGate
};
