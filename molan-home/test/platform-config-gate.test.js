'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { compareQualityVectors } = require('../lib/evolution/quality-vector-ab');
const { validatePlatformConfigPromotion, assertPlatformConfigPromotion } = require('../lib/evolution/platform-config-gate');

test('platform config writes require complete source evidence', () => {
  for (const kind of ['default-model', 'global-prompts', 'genre-profile', 'style-profile', 'pipeline']) {
    const options = { kind, proposed: kind === 'default-model' ? 'test-model' : {} };
    assert.equal(validatePlatformConfigPromotion(options).status, 'BLOCKED');
    assert.throws(() => assertPlatformConfigPromotion(options), error => error.code === 'QUALITY_PROMOTION_BLOCKED' && error.statusCode === 409);
  }
});

test('an invented READY report cannot bypass recomputation and approved Golden provenance', () => {
  const input = {};
  const report = { ...compareQualityVectors(input), status: 'PROMOTION_READY', promotionEligible: true };
  const result = validatePlatformConfigPromotion({ kind: 'default-model', proposed: 'test-model', evidence: { report, input, artifactRoot: __dirname, target: {} } });
  assert.equal(result.accepted, false);
  assert.ok(result.blockingReasons.includes('platform_source_report_mismatch'));
});
