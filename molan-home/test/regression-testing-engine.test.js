'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFixedRegressionSet, runRegressionSuite } = require('../lib/regression-testing-engine.js');

test('buildFixedRegressionSet 必须完整覆盖 8 大回归维度与 10 项测试用例', () => {
  const set = buildFixedRegressionSet();
  assert.equal(set.length, 10);

  const genres = new Set(set.map(s => s.genre));
  assert.ok(genres.has('玄幻修真'));
  assert.ok(genres.has('都市重生/商战'));
  assert.ok(genres.has('古典仙侠'));
  assert.ok(genres.has('民俗怪异'));
  assert.ok(genres.has('青春甜宠'));

  // 校验每个用例具备完整结构属性
  for (const item of set) {
    assert.ok(item.case_id);
    assert.ok(item.opening_type);
    assert.ok(item.character_structure);
    assert.ok(item.world_complexity);
    assert.ok(item.plot_complexity);
  }
});

test('runRegressionSuite 保留有证据的逐例失败并关联 Optimization', () => {
  const report = runRegressionSuite({
    caseResults: {
      'REG-CASE-02-PACING-BRIDGE': {
        status: 'FAIL',
        previous_result: 'PASS',
        regression: 'fixture regression',
        new_defect: { defect_id: 'DEF-PACING-REG-001' },
        causing_optimization: 'OPT-SCENE-001',
        confidence: 0.8,
        evidence: [{ source: 'fixture', hash: 'a1b2' }]
      }
    }
  });

  assert.equal(report.final_verdict, 'FAIL');
  assert.equal(report.statistics.regressions_count, 1);
  assert.equal(report.statistics.blocked_cases, 9);

  const regCase = report.test_results.find(t => t.case_id === 'REG-CASE-02-PACING-BRIDGE');
  assert.ok(regCase);
  assert.equal(regCase.current_result, 'FAIL');
  assert.equal(regCase.causing_optimization, 'OPT-SCENE-001');
  assert.ok(regCase.regression);
  assert.equal(regCase.new_defect?.defect_id, 'DEF-PACING-REG-001');
});

test('runRegressionSuite 仅在固定回归集全部具备证据时判定 PASS', () => {
  const caseResults = Object.fromEntries(buildFixedRegressionSet().map(item => [item.case_id, {
    status: 'PASS',
    previous_result: 'PASS',
    evidence: [{ source: `fixture:${item.case_id}`, hash: 'a1b2' }],
    confidence: 0.7
  }]));
  const report = runRegressionSuite({
    caseResults
  });

  assert.equal(report.final_verdict, 'PASS');
  assert.equal(report.statistics.regressions_count, 0);
});

test('runRegressionSuite 缺少逐例证据时必须 BLOCKED', () => {
  const report = runRegressionSuite({});
  assert.equal(report.final_verdict, 'BLOCKED');
  assert.equal(report.statistics.passed_cases, 0);
  assert.equal(report.statistics.blocked_cases, 10);
});

test('runRegressionSuite 拒绝无效历史状态和未知用例编号', () => {
  const caseResults = Object.fromEntries(buildFixedRegressionSet().map(item => [item.case_id, {
    status: 'PASS',
    previous_result: 'UNKNOWN',
    evidence: [{ source: 'fixture:' + item.case_id, hash: 'a1b2' }]
  }]));
  caseResults['REG-CASE-UNKNOWN'] = {
    status: 'PASS',
    previous_result: 'PASS',
    evidence: [{ source: 'fixture:unknown', hash: 'c3d4' }]
  };

  const report = runRegressionSuite({ caseResults, experimentId: 'EXP-1' });
  assert.equal(report.final_verdict, 'BLOCKED');
  assert.equal(report.statistics.passed_cases, 0);
  assert.equal(report.statistics.input_error_count, 1);
  assert.equal(report.experiment_id, 'EXP-1');
});

test('runRegressionSuite 不允许重复用例编号覆盖已有评测', () => {
  const caseResults = buildFixedRegressionSet().map(item => ({
    case_id: item.case_id,
    status: 'PASS',
    previous_result: 'PASS',
    evidence: [{ source: 'fixture:' + item.case_id, hash: 'a1b2' }]
  }));
  caseResults.push({ ...caseResults[0], status: 'FAIL' });

  const report = runRegressionSuite({ caseResults });
  assert.equal(report.final_verdict, 'BLOCKED');
  assert.equal(report.statistics.input_error_count, 1);
  assert.deepEqual(report.statistics.duplicate_case_ids, ['REG-CASE-01-PIPE-FSM']);
});
