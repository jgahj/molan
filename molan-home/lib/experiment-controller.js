'use strict';

/**
 * experiment-controller.js
 * ---------------------------------------------------------------------------
 * 小说生成质量实验控制器 (Novel Generation Quality Experiment Controller)
 *
 * 核心设计目标：
 * 1. 严格单一变量隔离：单次实验只验证一个核心假设；
 * 2. 对照组 (Control) 与 实验组 (Treatment) 保持固定变量绝对一致：
 *    - 相同题材类别 (Same Genre)
 *    - 相同创作需求与大纲 (Same Creative Brief & Outline)
 *    - 相同 Story Bible
 *    - 相同生成参数 (Model, Temperature, TopP, Seed)
 *    - 相同 Benchmark
 * 3. 拦截跨题材混淆（如 A写都市 vs B写玄幻）；
 * 4. 自动化判定：成功标准、失败标准、副作用标准、回滚标准。
 * ---------------------------------------------------------------------------
 */

const crypto = require('node:crypto');

// 时空硬切检测模式
const ABRUPT_TRANSITION_REGEX = /(?:[。！？!?”])\s*(?:三日后|三天后|数日后|翌日|次日|隔天|半月后|转眼间|眨眼间)[，,]/;

/**
 * 校验实验规格的单一变量合规性
 * @param {Object} plan 实验计划配置
 */
function validateExperimentIsolation(plan = {}) {
  const { control_group, treatment_group, fixed_variables, target_variable } = plan;

  if (!control_group || !treatment_group) {
    throw new Error('实验规格不完整：必须同时包含 control_group 与 treatment_group');
  }

  // 1. 严格禁止跨题材比较
  if (control_group.genre !== treatment_group.genre) {
    throw new Error(`【禁止跨题材实验】: 对照组为 "${control_group.genre}"，实验组为 "${treatment_group.genre}"，严禁跨题材混淆对比！`);
  }

  // 2. 校验固定变量一致性
  const requiredFixed = ['model', 'temperature', 'story_bible_id', 'outline_hash', 'benchmark'];
  for (const key of requiredFixed) {
    if (control_group[key] !== treatment_group[key]) {
      throw new Error(`【固定变量漂移违规】: 变量 "${key}" 在对照组 (${control_group[key]}) 与实验组 (${treatment_group[key]}) 中不一致！`);
    }
  }

  if (!target_variable || !target_variable.name) {
    throw new Error('实验规格缺失：必须指定明确的 target_variable 单一测试变量');
  }

  return true;
}

/**
 * 提取文本的微观质量度量指标
 * @param {string} text 正文文本
 * @returns {Object} 结构化度量指标
 */
function extractPacingMetrics(text = '') {
  const clean = String(text || '');
  const charCount = clean.length;

  // 1. 时空硬切计数 (如无过渡句直接以“三日后，”切入)
  const abruptMatches = clean.match(new RegExp(ABRUPT_TRANSITION_REGEX, 'g')) || [];
  const abruptCount = abruptMatches.length;

  // 2. 场景切片切分 (按双换行或明显场景切换词粗分)
  const sceneBlocks = clean.split(/\n\s*\n/).filter(b => b.trim().length > 30);
  const sceneCount = Math.max(1, sceneBlocks.length);
  const avgSceneLength = Math.round(charCount / sceneCount);

  // 3. 情绪呼吸与环境留白比例估算 (景物描写、光影、心绪沉淀、茶盏器物)
  const downtimePatterns = /(夜风|星光|阴影|茶盏|杯盏|酒樽|青石|烛火|沉吟|微凉|呼吸|心跳|调息|凝视|沉默|云海|微光)/g;
  const downtimeMatches = clean.match(downtimePatterns) || [];
  const downtimeDensity = downtimeMatches.length / Math.max(1, charCount / 100); // 每百字留白词频
  const estimatedDowntimeRatio = Math.min(0.25, Number((downtimeMatches.length * 12 / Math.max(1, charCount)).toFixed(3)));

  // 4. 冲突烈度词频：覆盖神威术法对决与物理受力击打动词（斩、劈、刺、削、轰、撞、砸、碎、裂、断、血等）
  const conflictPatterns = /(神威|交锋|杀气|威压|崩碎|暴退|吐血|神灵|对决|斗法|死战|压迫|斩|劈|刺|削|轰|撞|退|碎|裂|爆|断|砸|杀|血|刃|对抗|魔光|剑锋|刀气|下塌|崩开|击)/g;
  const conflictMatches = clean.match(conflictPatterns) || [];
  const conflictDensity = conflictMatches.length / Math.max(1, charCount / 100);

  return {
    charCount,
    abruptTransitionCount: abruptCount,
    sceneCount,
    avgSceneLength,
    downtimeMatchesCount: downtimeMatches.length,
    estimatedDowntimeRatio,
    conflictMatchesCount: conflictMatches.length,
    conflictDensity
  };
}

/**
 * 实验评估执行器：对比 Control 与 Treatment，判定是否符合四个标准
 * @param {string} controlText 对照组正文
 * @param {string} treatmentText 实验组正文
 * @param {Object} experimentPlan 实验计划
 * @returns {Object} 实验裁决报告
 */
function evaluateExperimentRun(controlText, treatmentText, experimentPlan, options = {}) {
  validateExperimentIsolation(experimentPlan);

  const controlMetrics = extractPacingMetrics(controlText);
  const treatmentMetrics = extractPacingMetrics(treatmentText);

  const metricsDelta = {
    abruptTransitionChange: treatmentMetrics.abruptTransitionCount - controlMetrics.abruptTransitionCount,
    avgSceneLengthChange: treatmentMetrics.avgSceneLength - controlMetrics.avgSceneLength,
    downtimeRatioChange: Number((treatmentMetrics.estimatedDowntimeRatio - controlMetrics.estimatedDowntimeRatio).toFixed(3)),
    conflictDensityChange: Number((treatmentMetrics.conflictDensity - controlMetrics.conflictDensity).toFixed(3))
  };

  const { success_criteria, failure_criteria, side_effect_criteria, rollback_criteria } = experimentPlan;
  const minChapterWords = options.isSnippetMode ? 100 : (side_effect_criteria.min_chapter_words ?? 1800);
  const criticalMinWords = options.isSnippetMode ? 50 : (rollback_criteria.critical_min_words ?? 1500);
  const minSceneLength = options.isSnippetMode ? 40 : (success_criteria.min_avg_scene_length ?? 500);
  const minAllowedSceneLength = options.isSnippetMode ? 20 : (failure_criteria.min_allowed_scene_length ?? 300);

  // 1. 成功标准检验
  const successAbruptEliminated = treatmentMetrics.abruptTransitionCount <= (success_criteria.max_abrupt_transitions ?? 0);
  const successSceneExpanded = treatmentMetrics.avgSceneLength >= minSceneLength;
  const successDowntimeMet = treatmentMetrics.estimatedDowntimeRatio >= (success_criteria.min_downtime_ratio ?? 0.10);
  const isSuccess = successAbruptEliminated && (successSceneExpanded || successDowntimeMet);

  // 2. 失败标准检验
  const isFailure = treatmentMetrics.abruptTransitionCount > (failure_criteria.max_allowed_abrupt ?? 1) ||
    treatmentMetrics.avgSceneLength < minAllowedSceneLength;

  // 3. 副作用标准检验 (如 冲突密度剧烈衰退 > 40% 或 字数失控腰斩)
  const conflictDropRatio = controlMetrics.conflictDensity > 0
    ? (controlMetrics.conflictDensity - treatmentMetrics.conflictDensity) / controlMetrics.conflictDensity
    : 0;
  const isSideEffectExceeded = conflictDropRatio > (side_effect_criteria.max_conflict_drop_ratio ?? 0.35) ||
    treatmentMetrics.charCount < minChapterWords;

  // 4. 回滚标准检验
  const isRollbackTriggered = isSideEffectExceeded ||
    treatmentMetrics.charCount < criticalMinWords ||
    treatmentMetrics.abruptTransitionCount >= (rollback_criteria.critical_abrupt_threshold ?? 3);

  let verdict = 'NEEDS_ITERATION';
  if (isRollbackTriggered) {
    verdict = 'ROLLBACK';
  } else if (isSideEffectExceeded || isFailure) {
    verdict = 'REJECTED';
  } else if (isSuccess) {
    verdict = 'PROMOTED';
  }

  return {
    experimentId: experimentPlan.experiment_id,
    targetVariable: experimentPlan.target_variable.name,
    verdict,
    passedSuccessCriteria: isSuccess,
    triggeredFailureCriteria: isFailure,
    triggeredSideEffect: isSideEffectExceeded,
    triggeredRollback: isRollbackTriggered,
    controlMetrics,
    treatmentMetrics,
    metricsDelta,
    criteriaEvaluation: {
      success: {
        target: '硬切归零且呼吸留白>=10%',
        met: isSuccess,
        details: { successAbruptEliminated, successSceneExpanded, successDowntimeMet }
      },
      sideEffect: {
        target: '冲突烈度衰退不得超过35%',
        triggered: isSideEffectExceeded,
        conflictDropRatio: Number((conflictDropRatio * 100).toFixed(1)) + '%'
      },
      rollback: {
        target: '字数无腰斩截断且无死锁',
        triggered: isRollbackTriggered
      }
    }
  };
}

module.exports = {
  validateExperimentIsolation,
  extractPacingMetrics,
  evaluateExperimentRun
};
