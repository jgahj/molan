'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { applyRuntimeKillSwitch, evaluateGenerationRollout, ROLLBACK_METRICS } = require('../lib/generation/rollout-policy');

function rates(overrides = {}, sampleCount = 50) {
  return { ...Object.fromEntries(ROLLBACK_METRICS.map(metric => [metric, 0])), ...overrides, sampleCount };
}

test('rollout stays on hold until every metric has enough measured evidence', () => {
  const result = evaluateGenerationRollout({ baseline: rates({}, 50), candidate: rates({}, 12), minimumSamples: 30 });
  assert.equal(result.status, 'hold');
  assert.equal(result.disableGenerationV2, false);
});

test('rollout trips when a stability or literary regression threshold is exceeded', () => {
  const result = evaluateGenerationRollout({
    baseline: rates({ providerUnknownRate: 0.01 }),
    candidate: rates({ providerUnknownRate: 0.04 })
  });
  assert.equal(result.status, 'rollback');
  assert.equal(result.disableGenerationV2, true);
  assert.equal(result.triggers[0].metric, 'providerUnknownRate');
});

test('healthy rollout leaves the kill switch untouched and rollback applies it', () => {
  const env = { MOLAN_GENERATION_V2_PERCENT: '10' };
  assert.equal(applyRuntimeKillSwitch(env, { disableGenerationV2: false }), false);
  assert.equal(applyRuntimeKillSwitch(env, { disableGenerationV2: true, reason: 'regression' }), true);
  assert.equal(env.MOLAN_GENERATION_V2_FORCE_OFF, '1');
  assert.equal(env.MOLAN_GENERATION_V2_ROLLBACK_REASON, 'regression');
});
