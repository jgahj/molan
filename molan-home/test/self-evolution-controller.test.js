'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateEvolutionPriority, executeEvolutionCycle } = require('../lib/self-evolution-controller.js');
const { buildFixedRegressionSet, runRegressionSuite } = require('../lib/regression-testing-engine.js');
const { auditGeneralization } = require('../lib/generalization-detector.js');
const { DIMENSIONS, evaluateExperiment } = require('../lib/experiment-evaluator.js');
const { VALIDITY_CHECKS } = require('../lib/evaluation-validity-gate.js');

function regressionReport(experimentId = 'EXP-1') {
  return runRegressionSuite({
    experimentId,
    caseResults: Object.fromEntries(buildFixedRegressionSet().map(item => [item.case_id, {
      status: 'PASS',
      previous_result: 'PASS',
      evidence: [{ source: 'fixture:' + item.case_id, hash: 'a1b2' }]
    }]))
  });
}

function generalizationReport(report, riskLevel = 'LOW') {
  const checkIds = [
    'CHK-01-SYNTAX', 'CHK-02-PLOT', 'CHK-03-CHARACTER', 'CHK-04-CONFLICT',
    'CHK-05-OPENING', 'CHK-06-COOLPOINT', 'CHK-07-CHAPTER_STRUCT',
    'CHK-08-LANGUAGE', 'CHK-09-HIGH_FREQ_EXPR', 'CHK-10-AUTHOR_OVERFIT',
    'CHK-11-WORK_OVERFIT', 'CHK-12-STYLE_COLLAPSE'
  ];
  const checks = Object.fromEntries(checkIds.map(id => [id, {
    risk_level: 'LOW',
    evidence: [{ reference: 'fixture:' + id, location: 'section:1' }]
  }]));
  const section = { status: 'REVIEWED', evidence: [{ reference: 'fixture:summary', location: 'summary' }] };
  const risk = level => ({ ...section, risk_level: level });
  return auditGeneralization({
    experiment_id: 'EXP-1',
    checks,
    quality_gain: section,
    benchmark_similarity: section,
    diversity: section,
    originality_risk: risk(riskLevel),
    style_collapse_risk: risk('LOW'),
    overfitting_risk: risk('LOW'),
    regressionReport: report
  });
}

function experimentResult(verdict = 'SUPPORTED') {
  const evidence = [{ evidence_id: 'EV-1', artifact_id: 'GEN-T', location: 'chapter:1/paragraph:2' }];
  return {
    schemaVersion: 'validated-novel-quality-experiment-result/v2',
    experiment_id: 'EXP-1',
    validation_status: 'READY_FOR_REVIEW',
    evaluation_status: 'VALID_FOR_PAIRED_AB',
    verdict,
    evidence,
    validity_gate: {
      mode: 'P3_BLIND_AB',
      evaluation_status: 'VALID_FOR_PAIRED_AB',
      required_checks: [...VALIDITY_CHECKS],
      checks: Object.fromEntries(VALIDITY_CHECKS.map(checkId => [checkId, {
        status: 'PASS', evidence_refs: ['EV-1']
      }])),
      missing_checks: []
    }
  };
}

function validatedExperimentResult() {
  const dimensions = Object.fromEntries(DIMENSIONS.map(dimension => [dimension, {
    status: 'ASSESSED',
    summary: 'fixture evidence supports this dimension.',
    evidence_refs: ['EV-1']
  }]));
  return evaluateExperiment({
    experimentPlan: { experiment_id: 'EXP-1', title: 'fixture plan' },
    experimentResult: {
      schemaVersion: 'external-novel-quality-experiment-result/v2',
      experiment_id: 'EXP-1',
      evaluation_mode: 'P3_BLIND_AB',
      validity_checks: Object.fromEntries(VALIDITY_CHECKS.map(checkId => [checkId, {
        status: 'PASS', evidence_refs: ['EV-1']
      }])),
      invalidity_findings: [],
      verdict: 'SUPPORTED',
      verdict_rationale: 'Synthetic fixture contract only.',
      target_metric_before: { target: 1 },
      target_metric_after: { target: 0 },
      delta: { target: -1 },
      side_effects: [],
      unexpected_effects: [],
      quality_regression: [],
      dimensions_comparison: dimensions,
      evidence: [{ evidence_id: 'EV-1', artifact_id: 'GEN-T', location: 'fixture:1' }],
      limitations: []
    }
  });
}

function fullInput(overrides = {}) {
  const regression = regressionReport();
  return {
    defectRegistry: {
      defects: [{
        defect_id: 'DEF-1',
        severity: 'B',
        symptom: 'fixture symptom',
        evidence: '该缺陷由历史报告中的定位证据确认。',
        ranking_factors: { priority_score: 80 }
      }]
    },
    rootCauseReport: {
      rootCauses: [{
        defect_id: 'DEF-1',
        root_cause: 'fixture cause',
        affected_module: 'planner',
        evidence: '根因报告提供了可追溯证据和文件位置。'
      }]
    },
    optimizationPlan: { tasks: [{ id: 'OPT-1', target_defect: 'DEF-1', priorityScore: 80 }] },
    optimizationChangeLog: [{ change_id: 'CHG-1', optimization_id: 'OPT-1', summary: '记录了本轮修改内容。' }],
    experimentPlan: { experiment_id: 'EXP-1', hypothesis: 'fixture hypothesis' },
    experimentResult: experimentResult(),
    regressionReport: regression,
    generalizationReport: generalizationReport(regression),
    controlOutput: { generation_id: 'GEN-C' },
    treatmentOutput: { generation_id: 'GEN-T' },
    benchmarkData: { benchmark_id: 'BM-1' },
    genreBaselines: { genre: '玄幻修真' },
    ...overrides
  };
}

test('calculateEvolutionPriority 只对完整的五维因子计算分值', () => {
  assert.equal(calculateEvolutionPriority({
    severity: 4,
    scope: 3,
    frequency: 5,
    fixability: 4,
    validationValue: 5
  }), 4 * 3 * 5 * 4 * 5);
  assert.equal(calculateEvolutionPriority({ severity: 4 }), null);
});

test('缺少阶段资产或证据时不得生成采纳结论或账簿', () => {
  const report = executeEvolutionCycle({});
  assert.equal(report.final_status, 'NEEDS_MORE_DATA');
  assert.equal(report.evolution_ledger_entry, null);
  assert.ok(report.missing_evidence.includes('experimentResult.validated_result_and_evidence'));
  assert.ok(report.missing_evidence.includes('regressionReport.fixed_ten_case_evidence'));
});

test('只有同一实验的外部评测、十例回归和低中风险泛化证据齐全时才允许 ACCEPTED', () => {
  const report = executeEvolutionCycle(fullInput());

  assert.equal(report.final_status, 'ACCEPTED', JSON.stringify({
    missing: report.missing_evidence,
    reason: report.status_reason,
    generalization: report.generalization_status
  }));
  assert.equal(report.evolution_ledger_entry.experiment_id, 'EXP-1');
  assert.equal(report.evolution_ledger_entry.change_ids[0], 'CHG-1');
  assert.equal(report.next_round_plan.selected_target.defect_id, 'DEF-1');
});

test('外部 v2 评测器的有效性 gate 结果可供自进化控制器使用', () => {
  const experiment = validatedExperimentResult();
  assert.equal(experiment.evaluation_status, 'VALID_FOR_PAIRED_AB');
  assert.equal(executeEvolutionCycle(fullInput({ experimentResult: experiment })).final_status, 'ACCEPTED');
});

test('高泛化风险导致 REJECTED，缺少来源证据的单例回归不能判通过', () => {
  const regression = regressionReport();
  const report = executeEvolutionCycle(fullInput({
    generalizationReport: generalizationReport(regression, 'HIGH')
  }));
  assert.equal(report.final_status, 'REJECTED');
  assert.equal(report.evolution_ledger_entry.final_status, 'REJECTED');

  const incomplete = runRegressionSuite({ experimentId: 'EXP-1', caseResults: [{
    case_id: 'REG-CASE-01-PIPE-FSM',
    status: 'PASS',
    previous_result: 'PASS',
    evidence: [{ source: 'fixture' }]
  }] });
  assert.equal(incomplete.final_verdict, 'BLOCKED');
  assert.equal(executeEvolutionCycle(fullInput({ regressionReport: incomplete })).final_status, 'NEEDS_MORE_DATA');
});
