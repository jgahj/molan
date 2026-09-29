'use strict';

const ROLLBACK_METRICS = Object.freeze([
  'providerUnknownRate',
  'commitConflictRate',
  'emptyOutputRate',
  'billingFailureRate',
  'stateDriftRate',
  'literaryRegressionRate'
]);

const DEFAULT_LIMITS = Object.freeze({
  providerUnknownRate: 0.02,
  commitConflictRate: 0.02,
  emptyOutputRate: 0.005,
  billingFailureRate: 0.01,
  stateDriftRate: 0.005,
  literaryRegressionRate: 0.05
});

function validRate(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Missing or undersized metric samples hold the rollout; measured hard regressions trip the V2 kill switch. */
function evaluateGenerationRollout({ baseline, candidate, minimumSamples = 30, limits = DEFAULT_LIMITS } = {}) {
  const missing = ROLLBACK_METRICS.filter(metric =>
    !validRate(baseline && baseline[metric]) || !validRate(candidate && candidate[metric]));
  const baselineSamples = Math.max(0, Math.floor(Number(baseline && baseline.sampleCount) || 0));
  const candidateSamples = Math.max(0, Math.floor(Number(candidate && candidate.sampleCount) || 0));
  const requiredSamples = Math.max(1, Math.floor(Number(minimumSamples) || 30));
  if (missing.length || baselineSamples < requiredSamples || candidateSamples < requiredSamples) {
    return {
      status: 'hold',
      disableGenerationV2: false,
      reason: 'insufficient_evidence',
      requiredSamples,
      baselineSamples,
      candidateSamples,
      missingMetrics: missing
    };
  }
  const triggers = ROLLBACK_METRICS.flatMap(metric => {
    const limit = Number(limits && limits[metric]);
    const baselineValue = baseline[metric];
    const candidateValue = candidate[metric];
    const threshold = Number.isFinite(limit) ? Math.min(1, baselineValue + Math.max(0, limit)) : baselineValue;
    return candidateValue > threshold ? [{ metric, baseline: baselineValue, candidate: candidateValue, threshold }] : [];
  });
  return {
    status: triggers.length ? 'rollback' : 'healthy',
    disableGenerationV2: triggers.length > 0,
    reason: triggers.length ? 'quality_or_stability_threshold_exceeded' : null,
    requiredSamples,
    baselineSamples,
    candidateSamples,
    missingMetrics: [],
    triggers
  };
}

/** Apply an immediate process-local kill switch; the deployment controller must propagate it to every replica. */
function applyRuntimeKillSwitch(env, decision) {
  if (!env || typeof env !== 'object') throw new TypeError('运行环境配置必须是对象');
  if (!decision || decision.disableGenerationV2 !== true) return false;
  env.MOLAN_GENERATION_V2_FORCE_OFF = '1';
  env.MOLAN_GENERATION_V2_ROLLBACK_REASON = String(decision.reason || 'rollout_gate_failed');
  return true;
}

module.exports = { DEFAULT_LIMITS, ROLLBACK_METRICS, applyRuntimeKillSwitch, evaluateGenerationRollout };
