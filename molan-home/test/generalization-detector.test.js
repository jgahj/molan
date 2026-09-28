'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { auditGeneralization } = require('../lib/generalization-detector.js');
const { buildFixedRegressionSet, runRegressionSuite } = require('../lib/regression-testing-engine.js');

test('auditGeneralization 缺少外部评测证据时必须保留未评估状态', () => {
  const report = auditGeneralization({});

  // 1. 六大核心属性完整性
  assert.ok(report.quality_gain);
  assert.ok(report.benchmark_similarity);
  assert.ok(report.diversity);
  assert.ok(report.originality_risk);
  assert.ok(report.style_collapse_risk);
  assert.ok(report.overfitting_risk);
  assert.ok(report.capability_attribution);
  assert.ok(report.summary_verdict);

  // 2. 十二项显微趋同检测覆盖
  assert.equal(report.micro_convergence_checks.length, 12);
  const checkIds = report.micro_convergence_checks.map(c => c.id);
  assert.ok(checkIds.includes('CHK-01-SYNTAX'));
  assert.ok(checkIds.includes('CHK-04-CONFLICT'));
  assert.ok(checkIds.includes('CHK-10-AUTHOR_OVERFIT'));
  assert.ok(checkIds.includes('CHK-12-STYLE_COLLAPSE'));

  // 缺少外部评测时不能虚构泛化归因。
  assert.equal(report.status, 'NEEDS_MORE_DATA');
  assert.equal(report.capability_attribution.status, 'NOT_ASSESSED');
  assert.ok(report.micro_convergence_checks.every(item => item.status === 'NOT_ASSESSED'));

  // 4. 严禁单一分数决定论
  assert.equal(typeof report.summary_verdict, 'string');
  assert.equal(report.summary_verdict.length > 30, true);
});

test('auditGeneralization 只有各维度与回归证据齐全时才标记待复核', () => {
  const checks = Object.fromEntries(Array.from({ length: 12 }, (_, index) => {
    const id = `CHK-${String(index + 1).padStart(2, '0')}-${[
      'SYNTAX', 'PLOT', 'CHARACTER', 'CONFLICT', 'OPENING', 'COOLPOINT',
      'CHAPTER_STRUCT', 'LANGUAGE', 'HIGH_FREQ_EXPR', 'AUTHOR_OVERFIT',
      'WORK_OVERFIT', 'STYLE_COLLAPSE'
    ][index]}`;
    return [id, { risk_level: 'LOW', evidence: [{ reference: `fixture:${id}`, location: 'section:1' }] }];
  }));
  const section = { status: 'REVIEWED', evidence: [{ reference: 'fixture:summary', location: 'summary' }] };
  const regressionReport = runRegressionSuite({
    experimentId: 'EXP-1',
    caseResults: Object.fromEntries(buildFixedRegressionSet().map(item => [item.case_id, {
      status: 'PASS',
      previous_result: 'PASS',
      evidence: [{ source: 'fixture:' + item.case_id, hash: 'a1b2' }]
    }]))
  });
  const report = auditGeneralization({
    experiment_id: 'EXP-1',
    checks,
    quality_gain: section,
    benchmark_similarity: section,
    diversity: section,
    originality_risk: section,
    style_collapse_risk: section,
    overfitting_risk: section,
    regressionReport
  });

  assert.equal(report.status, 'READY_FOR_REVIEW');
  assert.equal(report.summary_verdict.includes('人工复核'), true);
});

test('auditGeneralization 不接受只有一个用例的回归报告', () => {
  const regressionReport = runRegressionSuite({
    experimentId: 'EXP-1',
    caseResults: [{
      case_id: 'REG-CASE-01-PIPE-FSM',
      status: 'PASS',
      previous_result: 'PASS',
      evidence: [{ source: 'fixture:REG-CASE-01', hash: 'a1b2' }]
    }]
  });
  const report = auditGeneralization({ experiment_id: 'EXP-1', regressionReport });

  assert.equal(report.regression_gate.status, 'BLOCKED');
  assert.equal(report.status, 'NEEDS_MORE_DATA');
});
