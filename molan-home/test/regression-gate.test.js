'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_POLICY, evaluateRegressionGate } = require('../lib/evolution/regression-gate');

function passingInput() {
  const categoryResults = Object.fromEntries(DEFAULT_POLICY.categories.map(category => [category, {
    status: 'PASS', evidence_refs: [`regression:${category.toLowerCase()}`]
  }]));
  const values = {
    continuity: [0.9, 0.9],
    originality: [0.8, 0.8],
    genreFit: [80, 79],
    styleFit: [75, 74],
    stability: [0.99, 0.99],
    cost: [1, 1.14]
  };
  const metricValues = Object.fromEntries(Object.entries(values).map(([metric, [baseline, candidate]]) => [metric, {
    baseline, candidate, evidence_refs: [`metric:${metric}`]
  }]));
  return {
    categoryResults,
    metricValues,
    targetMetric: { name: 'dialogue', direction: 'higher', baseline: 0.5, candidate: 0.53, evidence_refs: ['metric:dialogue'] }
  };
}

test('regression gate evaluates all eight categories and independent hard guards', () => {
  const result = evaluateRegressionGate(passingInput());
  assert.equal(DEFAULT_POLICY.categories.length, 8);
  assert.equal(result.status, 'PASS');
  assert.equal(result.accepted, true);
  assert.equal(result.category_results.Originality.status, 'PASS');
  assert.equal(result.guard_metrics.find(item => item.metric === 'genreFit').status, 'PASS');
  assert.equal(Object.hasOwn(result, 'overall_quality_score'), false);
});

test('a category failure or guard regression rejects even when the target improves', () => {
  const categoryFailure = passingInput();
  categoryFailure.categoryResults.Literary = { status: 'FAIL', evidence_refs: ['literary:dialogue-fail'] };
  assert.equal(evaluateRegressionGate(categoryFailure).status, 'REJECT');

  const guardFailure = passingInput();
  guardFailure.metricValues.originality.candidate = 0.79;
  const report = evaluateRegressionGate(guardFailure);
  assert.equal(report.status, 'REJECT');
  assert.deepEqual(report.summary.failed_guards, ['originality']);
});

test('missing category evidence or guard data blocks acceptance', () => {
  const input = passingInput();
  delete input.metricValues.cost;
  input.categoryResults.Performance = { status: 'PASS', evidence_refs: [] };
  const report = evaluateRegressionGate(input);
  assert.equal(report.status, 'BLOCKED');
  assert.ok(report.summary.blocked_categories.includes('Performance'));
  assert.ok(report.summary.blocked_guards.includes('cost'));
});

test('optimization gate rejects gains below the target metric threshold', () => {
  const input = passingInput();
  input.targetMetric.candidate = 0.51;
  const report = evaluateRegressionGate(input);
  assert.equal(report.status, 'REJECT');
  assert.equal(report.target_metric.status, 'FAIL');
});
