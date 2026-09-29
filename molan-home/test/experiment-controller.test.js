'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  validateExperimentIsolation,
  extractPacingMetrics,
  evaluateExperimentRun
} = require('../lib/experiment-controller');

const planJsonPath = path.resolve(__dirname, '../data/evaluation-input/experiments/experiment-plan-scene-pacing.json');
const experimentPlan = JSON.parse(fs.readFileSync(planJsonPath, 'utf8'));

test('Experiment Controller：实验计划 JSON/Markdown 资产完备性', () => {
  assert.ok(fs.existsSync(planJsonPath), 'experiment-plan-scene-pacing.json 必须存在');
  const mdPath = path.resolve(__dirname, '../data/evaluation-input/experiments/experiment-plan-scene-pacing.md');
  assert.ok(fs.existsSync(mdPath), 'experiment-plan-scene-pacing.md 必须存在');
});

test('Experiment Controller：严格单一变量隔离断言 (禁止跨题材)', () => {
  // 正规单变量实验（同为东方玄幻）
  assert.equal(validateExperimentIsolation(experimentPlan), true);

  // 跨题材混淆实验必须被拦截（A写都市 vs B写玄幻）
  const crossGenrePlan = JSON.parse(JSON.stringify(experimentPlan));
  crossGenrePlan.control_group.genre = '都市日常';
  crossGenrePlan.treatment_group.genre = '东方玄幻';

  assert.throws(() => {
    validateExperimentIsolation(crossGenrePlan);
  }, /【禁止跨题材实验】/);

  // 固定变量漂移必须被拦截（如 模型不一致）
  const driftedPlan = JSON.parse(JSON.stringify(experimentPlan));
  driftedPlan.treatment_group.model = 'gpt-4o';

  assert.throws(() => {
    validateExperimentIsolation(driftedPlan);
  }, /【固定变量漂移违规】/);
});

test('Experiment Controller：微观节奏度量指标抽取 (DEF-PACING-001/002)', () => {
  // 包含生硬硬切与无留白的文本
  const abruptText = `
张若尘强闯魔窟。神灵威压落下。
姑射静赶来相救。
。三日后，张若尘来到云琉神殿借石刻。
  `;

  const metrics = extractPacingMetrics(abruptText);
  assert.equal(metrics.abruptTransitionCount, 1, '必须准确检出孤立生硬硬切');
  assert.ok(metrics.avgSceneLength > 0);
});

test('Experiment Controller：四重标准裁决执行 (Success -> PROMOTED)', () => {
  // 对照组文本（含生硬硬切，紧绷无留白）
  const controlSample = `
张若尘在木灵希陪同下强闯魔窟。神威压迫下，姑射静赶来出手相助。
设宴结拜后，姑射静向母神抱怨，姑射云琉点破其算计。
。三日后，张若尘来到云琉神殿借出天魔石刻，开启日晷。
张若尘告诉木灵希，月圆之夜必须离开云山界。
  `;

  // 实验组文本（转场平滑，具备环境视点描写与呼吸留白，冲突未衰退）
  const treatmentSample = `
张若尘在木灵希陪同下高调惹事，强闯魔窟深处。神威交锋如十万大山倾塌，神殿青石寸寸崩碎，姑射静虚空踏步破局解围。
夜风拂过云山界，殿内烛火摇曳。张若尘端起冰凉的茶盏微抿一口，暗中调息平复狂跳的心脉，自嘲在刀尖跳舞实属不易。
随后伪神设宴，机锋暗藏。姑射静向母神姑射云琉抱怨，母神一针见血点破这不过是逼婚退婚的双向阳谋。
微光破晓，云海翻腾，三日的暗流在罗祖云山界悄然发酵。
第四日清晨，张若尘移步来到云琉神殿，借出《天魔石刻》并以日晷延长时间相赠，随后向木灵希肃然交代，月圆夜第二日必须离开。
  `;

  const report = evaluateExperimentRun(controlSample, treatmentSample, experimentPlan, { isSnippetMode: true });

  assert.equal(report.verdict, 'PROMOTED', '满足成功标准且无副作用时必须晋阶');
  assert.equal(report.passedSuccessCriteria, true);
  assert.equal(report.triggeredFailureCriteria, false);
  assert.equal(report.triggeredSideEffect, false);
  assert.equal(report.triggeredRollback, false);
  assert.equal(report.treatmentMetrics.abruptTransitionCount, 0, '实验组硬切必须为 0');
});

test('Experiment Controller：副作用与回滚熔断保护断言', () => {
  const controlSample = '神威交锋！威压崩碎！死战暴退！吐血对决！' + '张若尘出手。'.repeat(100);

  // 极端注水导致冲突暴跌 90% 的坏样本
  const dilutedTreatment = '今天天气真好，云彩很白。' + '喝茶看风景。'.repeat(200);

  const report = evaluateExperimentRun(controlSample, dilutedTreatment, experimentPlan, { isSnippetMode: true });
  assert.equal(report.verdict === 'REJECTED' || report.verdict === 'ROLLBACK', true);
  assert.equal(report.triggeredSideEffect, true);
});
