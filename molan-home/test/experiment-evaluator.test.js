'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DIMENSIONS, evaluateExperiment } = require('../lib/experiment-evaluator.js');
const { VALIDITY_CHECKS } = require('../lib/evaluation-validity-gate.js');

function externalResult(experimentId = 'EXP-1') {
  const dimensions = Object.fromEntries(DIMENSIONS.map(dimension => [dimension, {
    status: 'ASSESSED',
    summary: '有可追溯材料支持本维度判断。',
    evidence_refs: ['EV-01']
  }]));
  return {
    schemaVersion: 'external-novel-quality-experiment-result/v2',
    experiment_id: experimentId,
    evaluation_mode: 'P3_BLIND_AB',
    validity_checks: Object.fromEntries(VALIDITY_CHECKS.map(checkId => [checkId, {
      status: 'PASS',
      evidence_refs: ['EV-01']
    }])),
    invalidity_findings: [],
    verdict: 'PARTIALLY_SUPPORTED',
    verdict_rationale: '目标指标改善，但副作用证据仍需复核。',
    target_metric_before: { target: 1 },
    target_metric_after: { target: 0 },
    delta: { target: -1 },
    side_effects: [],
    unexpected_effects: [],
    quality_regression: [],
    dimensions_comparison: dimensions,
    evidence: [{
      evidence_id: 'EV-01',
      artifact_id: 'GEN-C',
      location: 'chapter:1/paragraph:4'
    }],
    limitations: []
  };
}

test('evaluateExperiment 仅校验外部模型报告并移除正文引句', () => {
  const result = evaluateExperiment({
    experimentPlan: { experiment_id: 'EXP-1', title: '实验标题' },
    experimentResult: externalResult()
  });

  assert.equal(result.validation_status, 'READY_FOR_REVIEW');
  assert.equal(result.evaluation_status, 'VALID_FOR_PAIRED_AB');
  assert.equal(result.verdict, 'PARTIALLY_SUPPORTED');
  assert.equal(result.evidence.length, 1);
  assert.deepEqual(result.evidence[0], {
    evidence_id: 'EV-01',
    artifact_id: 'GEN-C',
    location: 'chapter:1/paragraph:4'
  });
  assert.equal('confidence' in result, false);
  assert.equal(Object.hasOwn(result.evidence[0], 'quote'), false);
  assert.equal(Object.hasOwn(result.evidence[0], 'text'), false);
  assert.equal(Object.keys(result.dimensions_comparison).length, 13);
});

test('evaluateExperiment 输入缺少可追溯结论时返回 INCONCLUSIVE', () => {
  const report = externalResult();
  delete report.evidence;
  delete report.dimensions_comparison.consistency;
  report.experiment_id = 'EXP-OTHER';

  const result = evaluateExperiment({
    experimentPlan: { experiment_id: 'EXP-1' },
    experimentResult: report
  });

  assert.equal(result.validation_status, 'BLOCKED');
  assert.equal(result.verdict, 'INCONCLUSIVE');
  assert.ok(result.missing_evidence.includes('experimentResult.experiment_id'));
  assert.ok(result.missing_evidence.includes('experimentResult.evidence'));
  assert.ok(result.missing_evidence.includes('experimentResult.dimensions_comparison.consistency'));
});

test('evaluateExperiment 接受明确列出数据缺口的 INCONCLUSIVE 报告', () => {
  const report = externalResult();
  report.verdict = 'INCONCLUSIVE';
  report.verdict_rationale = '当前材料不足以判断优化效果。';
  report.target_metric_before = {};
  report.target_metric_after = {};
  report.delta = {};
  report.evidence = [];
  report.validity_checks = Object.fromEntries(VALIDITY_CHECKS.map(checkId => [checkId, {
    status: 'NOT_ASSESSED',
    evidence_refs: []
  }]));
  report.limitations = ['缺少对照组的目标指标记录。'];
  report.dimensions_comparison = Object.fromEntries(DIMENSIONS.map(dimension => [dimension, {
    status: 'NOT_ASSESSED',
    summary: '缺少必要材料，未评估该维度。',
    evidence_refs: []
  }]));

  const result = evaluateExperiment({
    experimentPlan: { experiment_id: 'EXP-1' },
    experimentResult: report
  });

  assert.equal(result.validation_status, 'READY_FOR_REVIEW');
  assert.equal(result.evaluation_status, 'INCONCLUSIVE');
  assert.equal(result.verdict, 'INCONCLUSIVE');
  assert.equal(result.evidence.length, 0);
  assert.ok(result.limitations.length > 0);
});

test('evaluateExperiment 拒绝含正文摘录的报告', () => {
  const report = externalResult();
  report.evidence[0].quote = 'verbatim excerpt';

  const result = evaluateExperiment({
    experimentPlan: { experiment_id: 'EXP-1' },
    experimentResult: report
  });

  assert.equal(result.validation_status, 'BLOCKED');
  assert.ok(result.missing_evidence.includes('experimentResult.evidence_reference'));
});

test('evaluateExperiment refuses a supported verdict when the validity gate is incomplete', () => {
  const report = externalResult();
  report.validity_checks.human_review_integrity = { status: 'NOT_ASSESSED', evidence_refs: [] };

  const result = evaluateExperiment({
    experimentPlan: { experiment_id: 'EXP-1' },
    experimentResult: report
  });

  assert.equal(result.validation_status, 'READY_FOR_REVIEW');
  assert.equal(result.evaluation_status, 'INCONCLUSIVE');
  assert.equal(result.verdict, 'INCONCLUSIVE');
  assert.ok(result.missing_evidence.includes('validity_checks.human_review_integrity'));
});

test('evaluateExperiment invalidates a report with evidenced benchmark contamination', () => {
  const report = externalResult();
  report.invalidity_findings = [{ code: 'benchmark_contamination', evidence_refs: ['EV-01'] }];

  const result = evaluateExperiment({
    experimentPlan: { experiment_id: 'EXP-1' },
    experimentResult: report
  });

  assert.equal(result.validation_status, 'BLOCKED');
  assert.equal(result.evaluation_status, 'EVALUATION_INVALID');
  assert.equal(result.verdict, 'INCONCLUSIVE');
});
