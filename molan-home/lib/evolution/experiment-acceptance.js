'use strict';

const POLICY = require('../../data/evolution/experiments/acceptance-policy.json');

const FIXED_INPUT_FIELDS = [
  'genre', 'bibleHash', 'outlineHash', 'sceneHash', 'contractHash', 'contextHash',
  'model', 'parametersHash', 'benchmarkId'
];
const GUARD_METRICS = ['continuity', 'genreFit', 'styleFit', 'originality', 'stability', 'aiFlavor', 'cost'];
const OBSERVATION_METRICS = ['subtext', 'characterVoice', 'latency'];

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function evidenceRefs(arm) {
  return Array.isArray(arm && arm.evidence_refs)
    ? arm.evidence_refs.filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean)
    : [];
}

function fixedInputsMatch(pair) {
  const control = pair && pair.control && pair.control.fixed_inputs;
  const treatment = pair && pair.treatment && pair.treatment.fixed_inputs;
  if (!control || !treatment) return { valid: false, reason: 'fixed_inputs_missing' };
  for (const field of FIXED_INPUT_FIELDS) {
    if (typeof control[field] !== 'string' || !control[field].trim() || control[field] !== treatment[field]) {
      return { valid: false, reason: `fixed_input_mismatch:${field}` };
    }
  }
  return { valid: true };
}

function mean(values) {
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6));
}

function validGuardMetrics(metrics) {
  return [...GUARD_METRICS, ...OBSERVATION_METRICS].every(metric => finite(metrics && metrics[metric]) &&
    metrics[metric] >= 0 && (!['cost', 'latency'].includes(metric) ? metrics[metric] <= 100 : true));
}

function blockReason(taskId, reason) {
  return { task_id: taskId || null, status: 'BLOCKED', reason };
}

/** Gate paired optimization runs; every arm shares the same gold inputs and controlled model settings. */
function evaluateExperimentAcceptance({ pairs = [], targetMetric, targetDirection = 'higher', policy = POLICY } = {}) {
  if (!Array.isArray(pairs) || !policy || policy.schemaVersion !== 'optimization-experiment-policy-v1' ||
      !Number.isInteger(policy.minimumPairedTasks) || policy.minimumPairedTasks < 1 ||
      !finite(policy.minimumTargetRelativeImprovement) || policy.minimumTargetRelativeImprovement < 0 ||
      !finite(policy.maximumContinuityDecline) || policy.maximumContinuityDecline < 0 ||
      !finite(policy.maximumAiFlavorIncrease) || policy.maximumAiFlavorIncrease < 0 ||
      !finite(policy.maximumGenreFitDecline) || policy.maximumGenreFitDecline < 0 ||
      !finite(policy.maximumStyleFitDecline) || policy.maximumStyleFitDecline < 0 ||
      !finite(policy.maximumCostIncreaseRatio) || policy.maximumCostIncreaseRatio < 0) {
    throw new TypeError('无效的 Experiment Acceptance 输入或策略');
  }
  if (typeof targetMetric !== 'string' || !targetMetric.trim() || !['higher', 'lower'].includes(targetDirection)) {
    throw new TypeError('必须指定单一 targetMetric 与 higher/lower 优化方向');
  }
  const uniqueTaskIds = new Set();
  const blockedPairs = [];
  const metricPairs = [];
  let blockerRegressionCount = 0;

  for (const pair of pairs) {
    const taskId = String(pair && pair.task_id || '').trim();
    if (!taskId || uniqueTaskIds.has(taskId)) {
      blockedPairs.push(blockReason(taskId, taskId ? 'duplicate_task_id' : 'missing_task_id'));
      continue;
    }
    uniqueTaskIds.add(taskId);
    const fixed = fixedInputsMatch(pair);
    if (!fixed.valid) {
      blockedPairs.push(blockReason(taskId, fixed.reason));
      continue;
    }
    const controlEvidence = evidenceRefs(pair.control);
    const treatmentEvidence = evidenceRefs(pair.treatment);
    if (!controlEvidence.length || !treatmentEvidence.length) {
      blockedPairs.push(blockReason(taskId, 'arm_evidence_missing'));
      continue;
    }
    const blockerCheck = pair.blocker_check || {};
    const blockerStatus = String(blockerCheck.status || '').toUpperCase();
    if (!['PASS', 'FAIL'].includes(blockerStatus) || typeof blockerCheck.evidence_ref !== 'string' || !blockerCheck.evidence_ref.trim()) {
      blockedPairs.push(blockReason(taskId, 'blocker_regression_check_missing'));
      continue;
    }
    if (blockerStatus === 'FAIL') blockerRegressionCount += 1;

    const metricNames = [targetMetric, ...GUARD_METRICS, ...OBSERVATION_METRICS];
    const metricsValid = metricNames.every(metric => finite(pair.control.metrics && pair.control.metrics[metric]) &&
      finite(pair.treatment.metrics && pair.treatment.metrics[metric])) &&
      validGuardMetrics(pair.control.metrics) && validGuardMetrics(pair.treatment.metrics);
    if (!metricsValid) {
      blockedPairs.push(blockReason(taskId, 'paired_metric_missing'));
      continue;
    }
    metricPairs.push({
      task_id: taskId,
      control: pair.control.metrics,
      treatment: pair.treatment.metrics,
      evidence_refs: [...controlEvidence, ...treatmentEvidence, String(blockerCheck.evidence_ref)]
    });
  }

  const count = metricPairs.length;
  const enoughPairs = count >= policy.minimumPairedTasks;
  const checks = [];
  let observedMetrics = null;
  if (!enoughPairs) {
    checks.push({ metric: 'paired_task_count', status: 'BLOCKED', actual: count, required: policy.minimumPairedTasks });
  } else {
    const targetBefore = mean(metricPairs.map(pair => pair.control[targetMetric]));
    const targetAfter = mean(metricPairs.map(pair => pair.treatment[targetMetric]));
    if (targetBefore === 0) {
      checks.push({ metric: targetMetric, status: 'BLOCKED', reason: 'zero_baseline_requires_absolute_threshold' });
    } else {
      const uplift = (targetDirection === 'higher' ? targetAfter - targetBefore : targetBefore - targetAfter) / Math.abs(targetBefore);
      checks.push({
        metric: targetMetric,
        direction: targetDirection,
        status: uplift >= policy.minimumTargetRelativeImprovement ? 'PASS' : 'FAIL',
        before: targetBefore,
        after: targetAfter,
        relative_improvement: Number(uplift.toFixed(6)),
        required_relative_improvement: policy.minimumTargetRelativeImprovement
      });
    }

    const averages = Object.fromEntries(GUARD_METRICS.map(metric => [metric, {
      before: mean(metricPairs.map(pair => pair.control[metric])),
      after: mean(metricPairs.map(pair => pair.treatment[metric]))
    }]));
    const observations = Object.fromEntries(OBSERVATION_METRICS.map(metric => [metric, {
      before: mean(metricPairs.map(pair => pair.control[metric])),
      after: mean(metricPairs.map(pair => pair.treatment[metric]))
    }]));
    observations.continuity = averages.continuity;
    observations.aiFlavor = averages.aiFlavor;
    observations.latency = {
      before: mean(metricPairs.map(pair => pair.control.latency)),
      after: mean(metricPairs.map(pair => pair.treatment.latency))
    };
    const continuityDecline = averages.continuity.before - averages.continuity.after;
    checks.push({
      metric: 'continuity', status: continuityDecline <= policy.maximumContinuityDecline ? 'PASS' : 'FAIL',
      ...averages.continuity, decline: continuityDecline, maximum_decline: policy.maximumContinuityDecline
    });
    const aiFlavorIncrease = averages.aiFlavor.after - averages.aiFlavor.before;
    checks.push({
      metric: 'aiFlavor', status: aiFlavorIncrease <= policy.maximumAiFlavorIncrease ? 'PASS' : 'FAIL',
      ...averages.aiFlavor, increase: aiFlavorIncrease, maximum_increase: policy.maximumAiFlavorIncrease
    });
    for (const metric of ['genreFit', 'styleFit']) {
      const drop = averages[metric].before - averages[metric].after;
      const limit = metric === 'genreFit' ? policy.maximumGenreFitDecline : policy.maximumStyleFitDecline;
      checks.push({ metric, status: drop <= limit ? 'PASS' : 'FAIL', ...averages[metric], decline: drop, maximum_decline: limit });
    }
    for (const metric of ['originality', 'stability']) {
      const decline = averages[metric].before - averages[metric].after;
      checks.push({ metric, status: decline <= 0 ? 'PASS' : 'FAIL', ...averages[metric], decline, maximum_decline: 0 });
    }
    const cost = averages.cost;
    const increaseRatio = cost.before === 0
      ? cost.after === 0 ? 0 : Infinity
      : (cost.after - cost.before) / Math.abs(cost.before);
    checks.push({
      metric: 'cost',
      status: increaseRatio <= policy.maximumCostIncreaseRatio ? 'PASS' : 'FAIL',
      ...cost,
      increase_ratio: Number.isFinite(increaseRatio) ? Number(increaseRatio.toFixed(6)) : null,
      maximum_increase_ratio: policy.maximumCostIncreaseRatio
    });
    checks.push({
      metric: 'blocker_regressions',
      status: blockerRegressionCount === 0 ? 'PASS' : 'FAIL',
      count: blockerRegressionCount,
      evidence_refs: metricPairs.flatMap(pair => pair.evidence_refs)
    });
    checks.push({ metric: 'latency', status: 'MEASURED', ...observations.latency });
    checks.push({ metric: 'subtext', status: 'MEASURED', ...observations.subtext });
    checks.push({ metric: 'characterVoice', status: 'MEASURED', ...observations.characterVoice });
    observedMetrics = observations;
  }

  const failed = checks.some(check => check.status === 'FAIL') || blockerRegressionCount > 0;
  const blocked = checks.some(check => check.status === 'BLOCKED') || blockedPairs.length > 0;
  const status = failed ? 'REJECT' : blocked ? 'BLOCKED' : 'PROMOTE';
  return {
    schemaVersion: 'optimization-experiment-acceptance-v1',
    status,
    accepted: status === 'PROMOTE',
    target_metric: String(targetMetric),
    target_direction: targetDirection,
    pair_count: count,
    required_pair_count: policy.minimumPairedTasks,
    blocker_regression_count: blockerRegressionCount,
    checks,
    blocked_pairs: blockedPairs,
    guard_metrics: GUARD_METRICS,
    observed_metrics: typeof observedMetrics === 'undefined' ? null : observedMetrics
  };
}

module.exports = { POLICY, FIXED_INPUT_FIELDS, GUARD_METRICS, OBSERVATION_METRICS, evaluateExperimentAcceptance };
