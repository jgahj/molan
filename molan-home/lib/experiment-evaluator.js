'use strict';

const VERDICTS = new Set(['SUPPORTED', 'PARTIALLY_SUPPORTED', 'NOT_SUPPORTED', 'INCONCLUSIVE']);
const { checkValidityGate } = require('./evaluation-validity-gate');
const EXTERNAL_FIELDS = new Set([
  'schemaVersion', 'experiment_id', 'title', 'evaluation_mode', 'validity_checks',
  'invalidity_findings', 'genre_mapping', 'verdict', 'verdict_rationale',
  'target_metric_before', 'target_metric_after', 'delta', 'side_effects',
  'unexpected_effects', 'quality_regression', 'dimensions_comparison',
  'evidence', 'limitations'
]);
const DIMENSIONS = [
  'target_metrics',
  'non_target_metrics',
  'overall_quality',
  'side_effects',
  'ai_flavor',
  'human_touch',
  'plot',
  'pacing',
  'character',
  'causality',
  'emotion',
  'reading_drive',
  'consistency'
];

/** 只保留有限数值，避免把正文或任意文本当作指标。 */
function numericMetrics(value, field, errors, allowEmpty = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push('experimentResult.' + field);
    return {};
  }
  const entries = Object.entries(value).filter(([, metric]) => typeof metric === 'number' && Number.isFinite(metric));
  if (!entries.length && !allowEmpty) errors.push('experimentResult.' + field);
  return Object.fromEntries(entries);
}

/** 检查报告中每条副作用判断是否引用了顶层证据。 */
function normalizeFindings(value, field, evidenceIds, errors) {
  if (!Array.isArray(value)) {
    errors.push('experimentResult.' + field);
    return [];
  }
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push('experimentResult.' + field + '[' + index + ']');
      return null;
    }
    if (Object.hasOwn(item, 'quote') || Object.hasOwn(item, 'excerpt') || Object.hasOwn(item, 'text')) {
      errors.push('experimentResult.' + field + '[' + index + '].no_quote_or_text');
    }
    const refs = Array.isArray(item.evidence_refs)
      ? item.evidence_refs.map(reference => String(reference || '').trim()).filter(Boolean)
      : [];
    if (!refs.length || refs.some(reference => !evidenceIds.has(reference))) {
      errors.push('experimentResult.' + field + '[' + index + '].evidence_refs');
    }
    return {
      type: String(item.type || '').trim() || null,
      dimension: String(item.dimension || '').trim() || null,
      severity: String(item.severity || '').trim() || null,
      impact: String(item.impact || '').trim() || null,
      summary: String(item.summary || '').trim() || null,
      evidence_refs: refs
    };
  }).filter(Boolean);
}

/** 只校验外部评测报告，不读取正文或自行比较生成结果。 */
function evaluateExperiment({ experimentPlan, experimentResult } = {}) {
  const errors = [];
  const experimentId = String(experimentPlan && experimentPlan.experiment_id || '').trim();
  if (!experimentId) errors.push('experimentPlan.experiment_id');

  if (!experimentResult || typeof experimentResult !== 'object' || Array.isArray(experimentResult)) {
    errors.push('experimentResult');
  }

  const source = experimentResult && typeof experimentResult === 'object' ? experimentResult : {};
  const rawVerdict = String(source.verdict || '').toUpperCase();
  const isInconclusive = rawVerdict === 'INCONCLUSIVE';
  if (Object.keys(source).some(key => !EXTERNAL_FIELDS.has(key))) {
    errors.push('experimentResult.unexpected_fields');
  }
  if (source.schemaVersion !== 'external-novel-quality-experiment-result/v2') {
    errors.push('experimentResult.schemaVersion');
  }
  if (!experimentId || source.experiment_id !== experimentId) errors.push('experimentResult.experiment_id');
  if (!VERDICTS.has(rawVerdict)) errors.push('experimentResult.verdict');
  if (!String(source.verdict_rationale || '').trim()) errors.push('experimentResult.verdict_rationale');
  if (!Array.isArray(source.limitations)) errors.push('experimentResult.limitations');
  if (isInconclusive && Array.isArray(source.limitations) && !source.limitations.length) {
    errors.push('experimentResult.limitations.for_inconclusive');
  }
  const targetMetricBefore = numericMetrics(source.target_metric_before, 'target_metric_before', errors, isInconclusive);
  const targetMetricAfter = numericMetrics(source.target_metric_after, 'target_metric_after', errors, isInconclusive);
  const delta = numericMetrics(source.delta, 'delta', errors, isInconclusive);

  const evidenceIds = new Set();
  const evidence = [];
  if (!Array.isArray(source.evidence) || (!source.evidence.length && !isInconclusive)) {
    errors.push('experimentResult.evidence');
  } else if (Array.isArray(source.evidence)) {
    for (const item of source.evidence) {
      const evidenceId = String(item && item.evidence_id || '').trim();
      const artifactId = String(item && item.artifact_id || '').trim();
      const location = String(item && item.location || '').trim();
      if (!evidenceId || !artifactId || !location || evidenceIds.has(evidenceId) ||
          Object.hasOwn(item || {}, 'quote') || Object.hasOwn(item || {}, 'excerpt') || Object.hasOwn(item || {}, 'text')) {
        errors.push('experimentResult.evidence_reference');
        continue;
      }
      evidenceIds.add(evidenceId);
      evidence.push({ evidence_id: evidenceId, artifact_id: artifactId, location });
    }
  }
  if (!String(source.evaluation_mode || '').trim()) errors.push('experimentResult.evaluation_mode');
  if (!source.validity_checks || typeof source.validity_checks !== 'object' || Array.isArray(source.validity_checks)) {
    errors.push('experimentResult.validity_checks');
  }
  if (!Array.isArray(source.invalidity_findings)) errors.push('experimentResult.invalidity_findings');
  const validityGate = checkValidityGate({
    mode: source.evaluation_mode,
    checks: source.validity_checks,
    evidenceIds,
    invalidityFindings: source.invalidity_findings,
    genreMapping: source.genre_mapping
  });
  if (!validityGate.mode) errors.push('experimentResult.evaluation_mode');
  if (validityGate.evaluation_status === 'EVALUATION_INVALID') {
    errors.push('experimentResult.validity_gate.invalidity_findings');
  }
  const sideEffects = normalizeFindings(source.side_effects, 'side_effects', evidenceIds, errors);
  const unexpectedEffects = normalizeFindings(source.unexpected_effects, 'unexpected_effects', evidenceIds, errors);
  const qualityRegression = normalizeFindings(source.quality_regression, 'quality_regression', evidenceIds, errors);

  const dimensions = {};
  const comparison = source.dimensions_comparison;
  if (!comparison || typeof comparison !== 'object' || Array.isArray(comparison)) {
    errors.push('experimentResult.dimensions_comparison');
  } else {
    for (const dimension of DIMENSIONS) {
      const section = comparison[dimension];
      const status = String(section && section.status || '').trim().toUpperCase();
      const summary = String(section && section.summary || '').trim();
      const refs = Array.isArray(section && section.evidence_refs)
        ? section.evidence_refs.map(value => String(value || '').trim()).filter(Boolean)
        : [];

      if (!section || !status || !summary || !Array.isArray(section.evidence_refs)) {
        errors.push('experimentResult.dimensions_comparison.' + dimension);
        continue;
      }
      if (status === 'NOT_ASSESSED') {
        if (refs.length) errors.push('experimentResult.dimensions_comparison.' + dimension + '.evidence_refs');
      } else if (!refs.length || refs.some(reference => !evidenceIds.has(reference))) {
        errors.push('experimentResult.dimensions_comparison.' + dimension + '.evidence_refs');
      }
      dimensions[dimension] = { status, summary, evidence_refs: refs };
    }
  }

  const missingEvidence = [...new Set([
    ...errors,
    ...validityGate.missing_checks.map(checkId => 'validity_checks.' + checkId),
    ...validityGate.unverified_invalidity_findings.map(code => 'invalidity_findings.' + code)
  ])];
  const valid = errors.length === 0;
  const pairedEvidenceReady = valid && validityGate.evaluation_status === 'VALID_FOR_PAIRED_AB';
  return {
    schemaVersion: 'validated-novel-quality-experiment-result/v2',
    experiment_id: experimentId || null,
    title: String(experimentPlan && experimentPlan.title || source.title || ''),
    validated_at: new Date().toISOString(),
    evaluator: 'external-model-result-validator',
    validation_status: valid ? 'READY_FOR_REVIEW' : 'BLOCKED',
    evaluation_status: validityGate.evaluation_status,
    validity_gate: validityGate,
    verdict: pairedEvidenceReady ? String(source.verdict).toUpperCase() : 'INCONCLUSIVE',
    verdict_rationale: pairedEvidenceReady ? String(source.verdict_rationale).trim() : null,
    missing_evidence: missingEvidence,
    target_metric_before: valid ? targetMetricBefore : null,
    target_metric_after: valid ? targetMetricAfter : null,
    delta: valid ? delta : null,
    side_effects: valid ? sideEffects : [],
    unexpected_effects: valid ? unexpectedEffects : [],
    quality_regression: valid ? qualityRegression : [],
    dimensions_comparison: dimensions,
    evidence,
    limitations: Array.isArray(source.limitations) ? source.limitations.map(String) : []
  };
}

module.exports = {
  evaluateExperiment,
  DIMENSIONS,
  VERDICTS
};
