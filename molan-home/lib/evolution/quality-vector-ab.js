'use strict';

const { QUALITY_DIMENSIONS } = require('../quality-vectors');
const { DEFAULT_POLICY, evaluateRegressionGate } = require('./regression-gate');
const { POLICY: EXPERIMENT_POLICY } = require('./experiment-acceptance');
const { hashJson } = require('./replay-manifest');

const INPUT_SCHEMA = 'quality-vector-ab-input-v1';
const REPORT_SCHEMA = 'quality-vector-ab-report-v1';
const VECTOR_SCHEMA = 'quality-vector-v2';
const EVIDENCE_STATUSES = new Set(['NOT_MEASURED', 'ESTIMATED', 'MEASURED', 'JUDGED', 'HUMAN_REVIEWED']);
const COMPARABLE_STATUSES = new Set(['MEASURED', 'JUDGED', 'HUMAN_REVIEWED']);
const VERSION_FIELDS = ['pipelineVersion', 'promptVersion', 'genreProfileVersion', 'styleVersion'];
const DECLINE_LIMIT = 0.03;

/** 判断必填标识是否是非空字符串。 */
function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** 清理、去重并稳定排序证据引用。 */
function refs(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter(nonEmpty).map(item => item.trim()))].sort()
    : [];
}

/** 将阻断原因去重，保持报告顺序稳定。 */
function block(reasons) {
  return [...new Set(reasons)];
}

/** 计算有限数值的平均值，不为缺失值补默认分。 */
function mean(values) {
  if (!values.length || values.some(value => !Number.isFinite(value))) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** 校验 Golden 清单哈希、任务覆盖和每条输入快照绑定。 */
function validateGolden(golden, tasks) {
  const reasons = [];
  if (!golden || golden.schemaVersion !== 'quality-ab-golden-manifest-v1') reasons.push('golden_manifest_schema_invalid');
  if (golden?.fixtureStatus !== 'ready' || golden?.dataStatus !== 'complete') reasons.push('golden_corpus_not_ready');
  if (!Number.isInteger(golden?.taskCount) || golden.taskCount < EXPERIMENT_POLICY.minimumPairedTasks) reasons.push('golden_task_count_insufficient');
  if (!Array.isArray(golden?.tasks) || golden.tasks.length !== golden.taskCount) reasons.push('golden_task_records_mismatch');
  if (!/^[a-f0-9]{64}$/.test(String(golden?.manifestHash || ''))) reasons.push('golden_manifest_hash_missing');

  const manifestTasks = Array.isArray(golden?.tasks) ? golden.tasks : [];
  const seen = new Set();
  for (const task of manifestTasks) {
    const id = String(task?.task_id || '').trim();
    if (!id || seen.has(id)) reasons.push('golden_task_id_missing_or_duplicate');
    seen.add(id);
    if (!nonEmpty(task?.genre) || !/^[a-f0-9]{64}$/.test(String(task?.input_hash || ''))) reasons.push(`golden_task_binding_invalid:${id || 'unknown'}`);
  }
  const { manifestHash, ...manifestBody } = golden || {};
  try {
    if (manifestHash && hashJson(manifestBody) !== manifestHash) reasons.push('golden_manifest_hash_mismatch');
  } catch {
    reasons.push('golden_manifest_unhashable');
  }

  const pairs = Array.isArray(tasks) ? tasks : [];
  if (pairs.length !== manifestTasks.length) reasons.push('paired_task_count_mismatch');
  const byId = new Map(manifestTasks.map(task => [String(task.task_id), task]));
  const pairIds = new Set();
  for (const pair of pairs) {
    const id = String(pair?.task_id || '').trim();
    if (!id || pairIds.has(id)) {
      reasons.push('paired_task_id_missing_or_duplicate');
      continue;
    }
    pairIds.add(id);
    const manifestTask = byId.get(id);
    if (!manifestTask || pair.input_hash !== manifestTask.input_hash || pair.genre !== manifestTask.genre) {
      reasons.push(`paired_input_mismatch:${id}`);
    }
  }
  if (pairIds.size !== byId.size || [...byId.keys()].some(id => !pairIds.has(id))) reasons.push('golden_task_set_mismatch');
  return block(reasons);
}

/** 校验模型、评审与双方生成版本的可追溯标识。 */
function validateBindings(input) {
  const reasons = [];
  const binding = input?.binding;
  for (const field of ['model', 'modelParametersHash', 'evaluatorVersion', 'reviewerVersion']) {
    if (!nonEmpty(binding?.[field])) reasons.push(`binding_missing:${field}`);
  }
  if (!/^[a-f0-9]{64}$/.test(String(binding?.modelParametersHash || ''))) reasons.push('model_parameters_hash_invalid');
  for (const arm of ['baseline', 'candidate']) {
    const version = input?.versions?.[arm];
    for (const field of VERSION_FIELDS) if (!nonEmpty(version?.[field])) reasons.push(`version_missing:${arm}:${field}`);
  }
  return block(reasons);
}

/** 校验单个评分的向量版本、量表、证据等级和引用。 */
function validateScore(pair, arm, dimension, scoreScale) {
  const vector = pair?.[arm]?.qualityVector;
  const values = vector?.values;
  const details = vector?.dimensions;
  const entry = details?.[dimension];
  const value = values?.[dimension];
  const status = String(entry?.status || '').toUpperCase();
  const evidenceRefs = refs(entry?.evidence_refs);
  const reasons = [];

  if (!vector || vector.schemaVersion !== VECTOR_SCHEMA || !values || typeof values !== 'object' || !details || typeof details !== 'object') {
    reasons.push('quality_vector_schema_invalid');
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > scoreScale || entry?.value !== value) {
    reasons.push('score_missing_or_out_of_range');
  }
  if (!EVIDENCE_STATUSES.has(status)) reasons.push('evidence_status_invalid');
  if (!evidenceRefs.length) reasons.push('evidence_refs_missing');
  if (!COMPARABLE_STATUSES.has(status)) {
    if (status === 'NOT_MEASURED') reasons.push('dimension_not_measured');
    else if (status === 'ESTIMATED') reasons.push('estimated_evidence_not_promotion_grade');
    else if (EVIDENCE_STATUSES.has(status)) reasons.push('evidence_status_not_comparable');
  }
  return { value: reasons.length ? null : value, status, evidenceRefs, reasons };
}

/** 读取单次生成费用及其账本证据。 */
function validateCost(pair, arm) {
  const cost = pair?.[arm]?.cost;
  const amount = cost?.amount;
  const evidenceRefs = refs(cost?.evidence_refs);
  return {
    amount: typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 ? amount : null,
    currency: nonEmpty(cost?.currency) ? cost.currency.trim() : null,
    evidenceRefs
  };
}

/** 汇总一个维度的配对得分并应用归一化退化阈值。 */
function evaluateDimension(input, dimension, scoreScale) {
  const pairs = Array.isArray(input?.tasks) ? input.tasks : [];
  const rows = pairs.map(pair => {
    const baseline = validateScore(pair, 'baseline', dimension, scoreScale);
    const candidate = validateScore(pair, 'candidate', dimension, scoreScale);
    const reasons = [...baseline.reasons.map(reason => `baseline:${reason}`), ...candidate.reasons.map(reason => `candidate:${reason}`)];
    if (baseline.status !== candidate.status) reasons.push('evidence_status_mismatch');
    return { task_id: String(pair?.task_id || ''), baseline, candidate, reasons };
  });
  const reasons = block(rows.flatMap(row => row.reasons.map(reason => `${row.task_id}:${reason}`)));
  if (reasons.length) {
    return { dimension, status: 'BLOCKED', reason_codes: reasons, baseline: null, candidate: null, delta: null, normalized_delta: null, decline_limit: DECLINE_LIMIT, evidence_status: null, evidence_refs: [] };
  }

  const baseline = mean(rows.map(row => row.baseline.value));
  const candidate = mean(rows.map(row => row.candidate.value));
  const normalizedDelta = (candidate - baseline) / scoreScale;
  const direction = dimension === 'ai_flavor' ? 'lower' : 'higher';
  const signedImprovement = direction === 'higher' ? normalizedDelta : -normalizedDelta;
  const evidenceStatus = rows[0]?.baseline.status || null;
  const evidenceRefs = refs(rows.flatMap(row => [...row.baseline.evidenceRefs, ...row.candidate.evidenceRefs]));
  const status = signedImprovement < -DECLINE_LIMIT ? 'FAIL' : 'PASS';
  return {
    dimension,
    direction,
    status,
    baseline: Number(baseline.toFixed(6)),
    candidate: Number(candidate.toFixed(6)),
    delta: Number((candidate - baseline).toFixed(6)),
    normalized_delta: Number(normalizedDelta.toFixed(6)),
    signed_improvement: Number(signedImprovement.toFixed(6)),
    decline_limit: DECLINE_LIMIT,
    evidence_status: evidenceStatus,
    evidence_refs: evidenceRefs
  };
}

/** 汇总两臂总费用并阻断缺失或币种混用的账本。 */
function evaluateCosts(input) {
  const tasks = Array.isArray(input?.tasks) ? input.tasks : [];
  const baselineCosts = [];
  const candidateCosts = [];
  const evidenceRefs = [];
  const reasons = [];
  let currency = null;
  for (const task of tasks) {
    const baseline = validateCost(task, 'baseline');
    const candidate = validateCost(task, 'candidate');
    for (const [arm, cost] of [['baseline', baseline], ['candidate', candidate]]) {
      if (cost.amount === null || !cost.currency || !cost.evidenceRefs.length) reasons.push(`cost_missing:${task.task_id}:${arm}`);
      if (currency && cost.currency && currency !== cost.currency) reasons.push('cost_currency_mismatch');
      if (cost.currency) currency = currency || cost.currency;
    }
    baselineCosts.push(baseline.amount);
    candidateCosts.push(candidate.amount);
    evidenceRefs.push(...baseline.evidenceRefs, ...candidate.evidenceRefs);
  }
  if (reasons.length) return { status: 'BLOCKED', reason_codes: block(reasons), baseline: null, candidate: null, currency, evidence_refs: [] };
  return {
    status: 'PASS',
    baseline: Number(baselineCosts.reduce((sum, value) => sum + value, 0).toFixed(6)),
    candidate: Number(candidateCosts.reduce((sum, value) => sum + value, 0).toFixed(6)),
    currency,
    evidence_refs: refs(evidenceRefs)
  };
}

/** 把质量目标、安全指标与成本交给既有回归门禁复核。 */
function buildExistingGate(input, dimensions, scoreScale, cost) {
  const source = input?.safety_gate || {};
  const targetDimension = Array.isArray(input?.targetDimensions) ? input.targetDimensions[0] : null;
  const target = dimensions.find(item => item.dimension === targetDimension);
  const metricValues = { ...(source.metricValues && typeof source.metricValues === 'object' ? source.metricValues : {}) };
  if (cost.status === 'PASS') {
    metricValues.cost = {
      baseline: cost.baseline,
      candidate: cost.candidate,
      evidence_refs: cost.evidence_refs
    };
  }
  const targetMetric = target && target.status === 'PASS' ? {
    name: target.dimension,
    direction: target.direction,
    baseline: target.baseline / scoreScale,
    candidate: target.candidate / scoreScale,
    evidence_refs: target.evidence_refs
  } : null;
  try {
    return evaluateRegressionGate({
      categoryResults: source.categoryResults,
      metricValues,
      targetMetric,
      policy: DEFAULT_POLICY
    });
  } catch (error) {
    return { schemaVersion: 'quality-regression-gate-v1', status: 'BLOCKED', accepted: false, error: String(error.message || error) };
  }
}

/** 比较同一批固定输入的质量向量，并将完整证据与既有安全门禁绑定到晋级结论。 */
function compareQualityVectors(input = {}) {
  const reasons = [];
  if (input.schemaVersion !== INPUT_SCHEMA) reasons.push('input_schema_invalid');
  if (input.evaluationMode !== 'saved_results_only') reasons.push('live_evaluation_not_supported');
  const scoreScale = input.scoreScale;
  if (![1, 100].includes(scoreScale)) reasons.push('score_scale_must_be_declared_1_or_100');
  reasons.push(...validateBindings(input));
  reasons.push(...validateGolden(input.golden, input.tasks));

  if (!Array.isArray(input.targetDimensions) || !input.targetDimensions.length ||
      input.targetDimensions.some(dimension => !QUALITY_DIMENSIONS.includes(dimension)) ||
      new Set(input.targetDimensions).size !== input.targetDimensions.length) {
    reasons.push('target_dimensions_invalid');
  }
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const generationIds = new Set();
  for (const pair of tasks) {
    if (!nonEmpty(pair?.baseline?.generationId) || !/^[a-f0-9]{64}$/.test(String(pair?.baseline?.outputHash || ''))) reasons.push(`baseline_run_binding_missing:${pair?.task_id || 'unknown'}`);
    if (!nonEmpty(pair?.candidate?.generationId) || !/^[a-f0-9]{64}$/.test(String(pair?.candidate?.outputHash || ''))) reasons.push(`candidate_run_binding_missing:${pair?.task_id || 'unknown'}`);
    for (const arm of ['baseline', 'candidate']) {
      const run = pair?.[arm];
      const generationId = String(run?.generationId || '').trim();
      if (generationId && generationIds.has(generationId)) reasons.push(`generation_id_reused:${generationId}`);
      if (generationId) generationIds.add(generationId);
      if (run?.input_hash !== pair?.input_hash) reasons.push(`run_input_mismatch:${pair?.task_id || 'unknown'}:${arm}`);
      for (const field of ['model', 'modelParametersHash', 'evaluatorVersion', 'reviewerVersion']) {
        if (run?.binding?.[field] !== input.binding?.[field]) reasons.push(`run_binding_mismatch:${pair?.task_id || 'unknown'}:${arm}:${field}`);
      }
      for (const field of VERSION_FIELDS) {
        if (run?.versions?.[field] !== input.versions?.[arm]?.[field]) reasons.push(`run_version_mismatch:${pair?.task_id || 'unknown'}:${arm}:${field}`);
      }
    }
  }

  const dimensions = QUALITY_DIMENSIONS.map(dimension => evaluateDimension(input, dimension, [1, 100].includes(scoreScale) ? scoreScale : 1));
  const cost = evaluateCosts(input);
  const safetyGate = buildExistingGate(input, dimensions, [1, 100].includes(scoreScale) ? scoreScale : 1, cost);
  if (cost.status === 'BLOCKED') reasons.push(...cost.reason_codes);
  if (safetyGate.status === 'BLOCKED') reasons.push('existing_regression_gate_blocked');

  const targetSet = new Set(Array.isArray(input.targetDimensions) ? input.targetDimensions : []);
  for (const item of dimensions) {
    if (item.status === 'BLOCKED') reasons.push(`dimension_blocked:${item.dimension}`);
    if (item.status === 'FAIL') reasons.push(`dimension_decline_exceeded:${item.dimension}`);
    if (targetSet.has(item.dimension) && item.status === 'PASS' && !(item.signed_improvement > 0)) reasons.push(`target_dimension_not_improved:${item.dimension}`);
  }
  if (safetyGate.status === 'REJECT') reasons.push('existing_regression_gate_rejected');

  const uniqueReasons = block(reasons);
  const rejected = dimensions.some(item => item.status === 'FAIL') || safetyGate.status === 'REJECT';
  const status = rejected ? 'REJECTED' : uniqueReasons.length ? 'BLOCKED' : 'PROMOTION_READY';
  const reportBody = {
    schemaVersion: REPORT_SCHEMA,
    createdAt: new Date().toISOString(),
    inputHash: hashJson(input),
    qualityVectorVersion: VECTOR_SCHEMA,
    status,
    promotionEligible: status === 'PROMOTION_READY',
    evaluationMode: 'saved_results_only',
    binding: input.binding || null,
    versions: input.versions || null,
    golden: input.golden ? {
      schemaVersion: input.golden.schemaVersion,
      fixtureStatus: input.golden.fixtureStatus,
      dataStatus: input.golden.dataStatus,
      taskCount: input.golden.taskCount,
      manifestHash: input.golden.manifestHash
    } : null,
    scoreScale: [1, 100].includes(scoreScale) ? scoreScale : null,
    targetDimensions: Array.isArray(input.targetDimensions) ? input.targetDimensions : [],
    pairedTaskCount: tasks.length,
    dimensions,
    costs: cost,
    existingRegressionGate: safetyGate,
    blockingReasons: uniqueReasons
  };
  const hashPayload = { ...reportBody };
  delete hashPayload.createdAt;
  return { ...reportBody, reportHash: hashJson(hashPayload) };
}

/** 校验待晋级配置是否精确引用一份有效且匹配版本的评测报告。 */
function validatePromotion(report, target = {}) {
  const reasons = [];
  if (report?.schemaVersion !== REPORT_SCHEMA) reasons.push('quality_report_schema_invalid');
  if (report?.status !== 'PROMOTION_READY' || report?.promotionEligible !== true) reasons.push('quality_report_not_promotion_eligible');
  if (!/^[a-f0-9]{64}$/.test(String(report?.reportHash || ''))) reasons.push('quality_report_hash_missing');
  if (!/^[a-f0-9]{64}$/.test(String(report?.inputHash || ''))) reasons.push('quality_input_hash_missing');
  if (target?.schemaVersion !== 'quality-promotion-target-v1') reasons.push('promotion_target_schema_invalid');
  if (target?.qualityReportHash !== report?.reportHash) reasons.push('promotion_report_hash_mismatch');
  if (target?.inputHash !== report?.inputHash) reasons.push('promotion_input_hash_mismatch');
  if (target?.model !== report?.binding?.model) reasons.push('promotion_model_mismatch');
  if (target?.modelParametersHash !== report?.binding?.modelParametersHash) reasons.push('promotion_model_parameters_mismatch');
  if (!report?.versions?.candidate || !target?.versions ||
      VERSION_FIELDS.some(field => !nonEmpty(target.versions[field]) || target.versions[field] !== report.versions.candidate[field])) {
    reasons.push('promotion_candidate_version_mismatch');
  }

  if (report?.schemaVersion === REPORT_SCHEMA && /^[a-f0-9]{64}$/.test(String(report.reportHash || ''))) {
    const hashPayload = { ...report };
    delete hashPayload.createdAt;
    delete hashPayload.reportHash;
    try {
      if (hashJson(hashPayload) !== report.reportHash) reasons.push('quality_report_hash_mismatch');
    } catch {
      reasons.push('quality_report_unhashable');
    }
  }
  const blockingReasons = block(reasons);
  return {
    schemaVersion: 'quality-promotion-binding-v1',
    status: blockingReasons.length ? 'BLOCKED' : 'PASS',
    accepted: blockingReasons.length === 0,
    reportHash: report?.reportHash || null,
    inputHash: report?.inputHash || null,
    candidateVersions: target?.versions || null,
    blockingReasons
  };
}

module.exports = {
  INPUT_SCHEMA,
  REPORT_SCHEMA,
  VECTOR_SCHEMA,
  EVIDENCE_STATUSES: Object.freeze([...EVIDENCE_STATUSES]),
  COMPARABLE_STATUSES: Object.freeze([...COMPARABLE_STATUSES]),
  DECLINE_LIMIT,
  compareQualityVectors,
  validatePromotion
};
