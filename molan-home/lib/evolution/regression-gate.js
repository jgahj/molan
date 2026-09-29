'use strict';

const DEFAULT_POLICY = require('../../data/evolution/regressions/policy.json');
const VALID_RESULTS = new Set(['PASS', 'FAIL', 'BLOCKED']);

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function refsOf(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(ref => typeof ref === 'string').map(ref => ref.trim()).filter(Boolean);
}

function evaluateCategoryResults(categoryResults, categories) {
  const results = {};
  for (const category of categories) {
    const supplied = categoryResults && categoryResults[category];
    const status = String(supplied && supplied.status || '').trim().toUpperCase();
    const evidenceRefs = refsOf(supplied && supplied.evidence_refs);
    const valid = VALID_RESULTS.has(status) && evidenceRefs.length > 0;
    results[category] = {
      status: valid ? status : 'BLOCKED',
      evidence_refs: valid ? evidenceRefs : [],
      reason: valid ? null : 'missing_or_invalid_status_or_evidence'
    };
  }
  return results;
}

function evaluateGuard(guard, metricValues) {
  const source = metricValues && metricValues[guard.metric];
  const evidenceRefs = refsOf(source && source.evidence_refs);
  if (!source || !finite(source.baseline) || !finite(source.candidate) || !evidenceRefs.length) {
    return { metric: guard.metric, category: guard.category, status: 'BLOCKED', reason: 'missing_values_or_evidence' };
  }

  const baseline = source.baseline;
  const candidate = source.candidate;
  if (guard.metric === 'cost' && (baseline < 0 || candidate < 0)) {
    return { metric: guard.metric, category: guard.category, status: 'BLOCKED', reason: 'negative_cost_value' };
  }
  const change = candidate - baseline;
  let regressed = false;
  if (guard.direction === 'higher') regressed = baseline - candidate > guard.maxDecline;
  else if (guard.direction === 'lower') {
    const increase = candidate - baseline;
    const maxIncrease = baseline === 0 ? 0 : Math.abs(baseline) * guard.maxIncreaseRatio;
    regressed = increase > maxIncrease;
  }

  return {
    metric: guard.metric,
    category: guard.category,
    baseline,
    candidate,
    change,
    status: regressed ? 'FAIL' : 'PASS',
    evidence_refs: evidenceRefs
  };
}

function evaluateTargetMetric(targetMetric, minimumRelativeImprovement) {
  const evidenceRefs = refsOf(targetMetric && targetMetric.evidence_refs);
  if (!targetMetric || !String(targetMetric.name || '').trim() ||
      !['higher', 'lower'].includes(targetMetric.direction) ||
      !finite(targetMetric.baseline) || !finite(targetMetric.candidate) || !evidenceRefs.length) {
    return { status: 'BLOCKED', reason: 'missing_target_metric_values_or_evidence' };
  }

  const signedDelta = targetMetric.direction === 'higher'
    ? targetMetric.candidate - targetMetric.baseline
    : targetMetric.baseline - targetMetric.candidate;
  if (!finite(targetMetric.minimum_delta) && targetMetric.baseline === 0) {
    return { status: 'BLOCKED', reason: 'zero_baseline_requires_minimum_delta' };
  }
  const minimumDelta = finite(targetMetric.minimum_delta)
    ? targetMetric.minimum_delta
    : Math.abs(targetMetric.baseline) * minimumRelativeImprovement;
  if (minimumDelta < 0) return { status: 'BLOCKED', reason: 'negative_minimum_improvement' };
  const status = signedDelta >= minimumDelta ? 'PASS' : 'FAIL';
  return {
    metric: String(targetMetric.name),
    direction: targetMetric.direction,
    baseline: targetMetric.baseline,
    candidate: targetMetric.candidate,
    improvement: signedDelta,
    minimum_improvement: minimumDelta,
    status,
    evidence_refs: evidenceRefs
  };
}

/** Evaluate eight independent regression categories plus explicit guard and target metrics. */
function evaluateRegressionGate({ categoryResults = {}, metricValues = {}, targetMetric = null, policy = DEFAULT_POLICY } = {}) {
  if (!policy || policy.schemaVersion !== 'quality-regression-policy-v1' ||
      !Array.isArray(policy.categories) || !Array.isArray(policy.guards)) {
    throw new TypeError('无效的质量回归策略');
  }
  if (!finite(policy.targetMetricMinimumRelativeImprovement) || policy.targetMetricMinimumRelativeImprovement < 0 ||
      !policy.guards.every(guard => guard && typeof guard.metric === 'string' &&
        policy.categories.includes(guard.category) && ['higher', 'lower'].includes(guard.direction) &&
        (guard.direction === 'higher' ? finite(guard.maxDecline) && guard.maxDecline >= 0
          : finite(guard.maxIncreaseRatio) && guard.maxIncreaseRatio >= 0))) {
    throw new TypeError('回归策略的 target 或 guard 阈值无效');
  }
  const categories = evaluateCategoryResults(categoryResults, policy.categories);
  const unknownCategories = Object.keys(categoryResults || {}).filter(category => !policy.categories.includes(category));
  const guards = policy.guards.map(guard => evaluateGuard(guard, metricValues));
  const target = evaluateTargetMetric(targetMetric, policy.targetMetricMinimumRelativeImprovement);
  const allResults = [...Object.values(categories), ...guards, target];
  const failed = allResults.filter(result => result.status === 'FAIL').length;
  const blocked = allResults.filter(result => result.status === 'BLOCKED').length;
  const status = failed ? 'REJECT' : blocked || unknownCategories.length ? 'BLOCKED' : 'PASS';

  return {
    schemaVersion: 'quality-regression-gate-v1',
    status,
    accepted: status === 'PASS',
    category_results: categories,
    unknown_categories: unknownCategories,
    guard_metrics: guards,
    target_metric: target,
    summary: {
      category_count: policy.categories.length,
      failed_categories: Object.entries(categories).filter(([, result]) => result.status === 'FAIL').map(([category]) => category),
      blocked_categories: Object.entries(categories).filter(([, result]) => result.status === 'BLOCKED').map(([category]) => category),
      failed_guards: guards.filter(item => item.status === 'FAIL').map(item => item.metric),
      blocked_guards: guards.filter(item => item.status === 'BLOCKED').map(item => item.metric)
    }
  };
}

module.exports = { DEFAULT_POLICY, evaluateRegressionGate };
