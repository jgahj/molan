import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const planJsonPath = path.resolve(process.cwd(), 'molan-home/data/evaluation-input/optimization-plans/system-optimization-plan.json');
const planMdPath = path.resolve(process.cwd(), 'molan-home/data/evaluation-input/optimization-plans/system-optimization-plan.md');

test('优化架构方案：系统优化方案 JSON/Markdown 资产完备性', () => {
  assert.ok(fs.existsSync(planJsonPath), 'system-optimization-plan.json 必须存在');
  assert.ok(fs.existsSync(planMdPath), 'system-optimization-plan.md 必须存在');
});

test('优化架构方案：符合架构师核心准则与单一变量隔离约束', () => {
  const planData = JSON.parse(fs.readFileSync(planJsonPath, 'utf8'));
  
  assert.ok(planData.corePhilosophy, '必须包含 corePhilosophy 哲学');
  assert.ok(planData.corePhilosophy.priorityRules.includes('根因 > 症状'));
  assert.ok(planData.corePhilosophy.priorityRules.includes('系统问题 > 单篇问题'));
  assert.ok(planData.corePhilosophy.priorityRules.includes('高频问题 > 偶发问题'));
  assert.ok(planData.corePhilosophy.priorityRules.includes('高影响问题 > 低影响问题'));
  
  // 检验单一变量隔离约束
  assert.ok(planData.corePhilosophy.variableIsolationRule.includes('严格单一变量隔离'));
});

test('优化架构方案：14 项结构化契约字段完整性断言', () => {
  const planData = JSON.parse(fs.readFileSync(planJsonPath, 'utf8'));
  const allPlans = [
    ...planData.plansByPriority.High,
    ...planData.plansByPriority.Medium,
    ...planData.plansByPriority.Low
  ];

  assert.ok(allPlans.length >= 5, '至少应包含 5 个系统级优化方案');

  const requiredFields = [
    'optimization_id',
    'target_defect',
    'root_cause',
    'target_module',
    'level',
    'current_behavior',
    'desired_behavior',
    'change_type',
    'exact_change',
    'expected_effect',
    'risk',
    'side_effect',
    'validation_method',
    'rollback_condition',
    'experiment_group'
  ];

  for (const plan of allPlans) {
    for (const field of requiredFields) {
      assert.ok(plan[field], `方案 ${plan.optimization_id} 缺失必填字段: ${field}`);
    }
    assert.ok(plan.experiment_group.control, `方案 ${plan.optimization_id} 缺失对照组 (control)`);
    assert.ok(plan.experiment_group.experimental, `方案 ${plan.optimization_id} 缺失实验组 (experimental)`);
  }
});

test('优化架构方案：严禁表面化“增加冲突”，深度剖析容量与切片根因', () => {
  const planData = JSON.parse(fs.readFileSync(planJsonPath, 'utf8'));
  const pacingPlan = planData.plansByPriority.High.find(p => p.optimization_id === 'OPT-SCENE-001');

  assert.ok(pacingPlan, '必须包含 OPT-SCENE-001 节奏优化方案');
  // 必须追溯单章容量与转场切片，禁止粗暴增加冲突
  assert.ok(pacingPlan.root_cause.includes('Scene Planner 缺位'));
  assert.ok(pacingPlan.root_cause.includes('Event Capacity Gate') || pacingPlan.root_cause.includes('容量门禁'));
  assert.ok(!pacingPlan.desired_behavior.includes('增加冲突'), '严禁看到节奏慢就盲目增加冲突');
});

test('优化架构方案：Markdown 报告与 5 大方案全覆盖断言', () => {
  const mdContent = fs.readFileSync(planMdPath, 'utf8');
  assert.ok(mdContent.includes('OPT-ARCH-001'));
  assert.ok(mdContent.includes('OPT-SCENE-001'));
  assert.ok(mdContent.includes('OPT-CHAR-001'));
  assert.ok(mdContent.includes('OPT-AUDIT-001'));
  assert.ok(mdContent.includes('OPT-DATA-001'));
  assert.ok(mdContent.includes('单一变量'));
  assert.ok(mdContent.includes('对照组'));
  assert.ok(mdContent.includes('实验组'));
});
