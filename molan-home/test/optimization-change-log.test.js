'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const logJsonPath = path.resolve(__dirname, '../data/evaluation-input/optimization-plans/optimization-change-log.json');
const logMdPath = path.resolve(__dirname, '../data/evaluation-input/optimization-plans/optimization-change-log.md');

test('OptimizationChangeLog：变更日志 JSON 与 Markdown 资产存在性', () => {
  assert.ok(fs.existsSync(logJsonPath), 'optimization-change-log.json 必须存在');
  assert.ok(fs.existsSync(logMdPath), 'optimization-change-log.md 必须存在');
});

test('OptimizationChangeLog：执行审计与七大检查维度合规性', () => {
  const data = JSON.parse(fs.readFileSync(logJsonPath, 'utf8'));
  assert.equal(data.executor, '小说生成系统优化执行器');
  assert.ok(data.executionSummary.principlesEnforced.some(p => p.includes('只执行已分析的 OptimizationPlan')));
  assert.ok(data.executionSummary.verificationStats.syntaxCheck.includes('PASSED'));
  assert.equal(data.executionSummary.verificationStats.unitTestPassed >= 53, true);
  assert.equal(data.executionSummary.verificationStats.unitTestFailed, 0);
  assert.ok(data.executionSummary.verificationStats.apiCheck.includes('200 OK'));
});

test('OptimizationChangeLog：11项契约全字段完整性断言 (CHG-OPT-001 ~ CHG-OPT-007)', () => {
  const data = JSON.parse(fs.readFileSync(logJsonPath, 'utf8'));
  const changes = data.changeLogs;

  assert.equal(changes.length, 7, '必须完整包含 7 项变更记录');

  const requiredFields = [
    'change_id',
    'file',
    'module',
    'before',
    'after',
    'reason',
    'target_defect',
    'expected_effect',
    'risk',
    'test_result',
    'rollback_point'
  ];

  for (const item of changes) {
    for (const f of requiredFields) {
      assert.ok(item[f], `变更记录 ${item.change_id} 缺失必填字段: ${f}`);
    }
  }

  // 验证各方案的映射匹配
  assert.ok(changes.some(c => c.change_id === 'CHG-OPT-001' && c.target_defect === 'DEF-PIPE-001'));
  assert.ok(changes.some(c => c.change_id === 'CHG-OPT-002' && c.target_defect === 'DEF-PACING-002'));
  assert.ok(changes.some(c => c.change_id === 'CHG-OPT-003' && c.target_defect === 'DEF-PACING-001'));
  assert.ok(changes.some(c => c.change_id === 'CHG-OPT-004' && c.target_defect === 'DEF-CHAR-001'));
  assert.ok(changes.some(c => c.change_id === 'CHG-OPT-005' && c.target_defect === 'DEF-DESC-001'));
  assert.ok(changes.some(c => c.change_id === 'CHG-OPT-006' && c.target_defect === 'DEF-CONSIST-001'));
});
