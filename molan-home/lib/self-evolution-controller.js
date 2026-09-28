'use strict';

const { buildFixedRegressionSet, hasEvidenceReference } = require('./regression-testing-engine.js');
const { hasCompleteRegressionEvidence } = require('./generalization-detector.js');
const { REQUIRED_CHECKS_BY_MODE } = require('./evaluation-validity-gate.js');

const EXPERIMENT_VERDICTS = new Set([
  'SUPPORTED', 'PARTIALLY_SUPPORTED', 'NOT_SUPPORTED', 'INCONCLUSIVE'
]);
const RESULT_STATES = new Set(['PASS', 'FAIL', 'BLOCKED']);
const RISK_LEVELS = new Set(['LOW', 'MEDIUM', 'HIGH']);

/** 判断输入是否为有限数值。 */
function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 仅在五个优先级因子均有明确数值时计算排序分。 */
function calculateEvolutionPriority(candidate = {}) {
  const keys = ['severity', 'scope', 'frequency', 'fixability', 'validationValue'];
  if (!keys.every(key => finite(candidate[key]) && candidate[key] >= 0)) return null;
  return keys.reduce((total, key) => total * candidate[key], 1);
}

/** 优先读取缺陷报告中的分值，否则使用完整因子计算。 */
function defectPriority(defect) {
  const explicit = defect && defect.ranking_factors && defect.ranking_factors.priority_score;
  if (finite(explicit) && explicit >= 0) return explicit;
  return calculateEvolutionPriority(defect && defect.priority_factors || {});
}

/** 统一检查列表或文字形式的来源证据。 */
function hasEvidence(value) {
  if (!value || typeof value !== 'object') return false;
  const evidence = Array.isArray(value.evidence_refs)
    ? value.evidence_refs
    : Array.isArray(value.evidence) ? value.evidence : [];
  if (evidence.some(hasEvidenceReference)) return true;
  return typeof value.evidence === 'string' && value.evidence.trim().length >= 12;
}

/** 校验外部评测器交付的版本、实验编号、结论和证据。 */
function validExperimentResult(result, experimentId) {
  const verdict = String(result && result.verdict || '').toUpperCase();
  const validEvidence = Array.isArray(result && result.evidence) &&
    result.evidence.length > 0 && result.evidence.every(hasEvidenceReference);
  const evidenceIds = new Set(Array.isArray(result && result.evidence)
    ? result.evidence.map(item => String(item && item.evidence_id || '').trim()).filter(Boolean)
    : []);
  const requiredChecks = REQUIRED_CHECKS_BY_MODE.P3_BLIND_AB;
  const gate = result && result.validity_gate;
  const validGate = Boolean(
    gate && gate.mode === 'P3_BLIND_AB' &&
    gate.evaluation_status === 'VALID_FOR_PAIRED_AB' &&
    Array.isArray(gate.required_checks) && gate.required_checks.length === requiredChecks.length &&
    requiredChecks.every(checkId => {
      const check = gate.checks && gate.checks[checkId];
      return gate.required_checks.includes(checkId) && check && check.status === 'PASS' &&
        Array.isArray(check.evidence_refs) && check.evidence_refs.length > 0 &&
        check.evidence_refs.every(reference => evidenceIds.has(String(reference || '').trim()));
    }) &&
    Array.isArray(gate.missing_checks) && gate.missing_checks.length === 0
  );
  const validInconclusive = verdict === 'INCONCLUSIVE' &&
    Array.isArray(result && result.limitations) && result.limitations.length > 0;
  return Boolean(
    result && result.schemaVersion === 'validated-novel-quality-experiment-result/v2' &&
    result.validation_status === 'READY_FOR_REVIEW' &&
    result.evaluation_status === 'VALID_FOR_PAIRED_AB' &&
    validGate &&
    experimentId && result.experiment_id === experimentId &&
    EXPERIMENT_VERDICTS.has(verdict) && (validEvidence || validInconclusive)
  );
}

/** 校验固定回归集是否全量通过且逐例有历史状态和来源证据。 */
function completeRegression(report, experimentId) {
  return hasCompleteRegressionEvidence(report, experimentId);
}

/** 判断失败回归报告是否覆盖固定用例且没有阻塞项。 */
function completeRegressionFailure(report, experimentId) {
  const expectedIds = buildFixedRegressionSet().map(item => item.case_id);
  if (!report || report.final_verdict !== 'FAIL' ||
      !Array.isArray(report.test_results) || report.test_results.length !== expectedIds.length ||
      !report.statistics || report.statistics.total_cases !== expectedIds.length ||
      !Number.isInteger(report.statistics.failed_cases) || report.statistics.failed_cases < 1 ||
      report.statistics.blocked_cases !== 0 || report.statistics.input_error_count !== 0 ||
      (experimentId && report.experiment_id !== experimentId)) return false;
  const rows = new Map(report.test_results.map(item => [item && item.case_id, item]));
  const everyCaseAssessed = rows.size === expectedIds.length && expectedIds.every(caseId => {
    const item = rows.get(caseId);
    return Boolean(
      item && RESULT_STATES.has(String(item.previous_result || '').toUpperCase()) &&
      RESULT_STATES.has(String(item.current_result || '').toUpperCase()) &&
      hasEvidence(item)
    );
  });
  const failedCount = report.test_results.filter(item => item.current_result === 'FAIL').length;
  return everyCaseAssessed && failedCount > 0 &&
    report.statistics.failed_cases === failedCount &&
    report.statistics.passed_cases + failedCount === expectedIds.length;
}

/** 只接受有完整引用且风险不高的泛化报告。 */
function safeGeneralization(report, experimentId) {
  if (!report || report.status !== 'READY_FOR_REVIEW' ||
      !experimentId || report.experiment_id !== experimentId ||
      !report.regression_gate || report.regression_gate.status !== 'PASS' ||
      !hasCompleteRegressionEvidence({
        final_verdict: report.regression_gate.status,
        experiment_id: experimentId,
        test_results: report.regression_gate.evidence,
        statistics: { total_cases: 10, passed_cases: 10, failed_cases: 0, blocked_cases: 0, input_error_count: 0 }
      })) return false;
  const risks = [report.originality_risk, report.style_collapse_risk, report.overfitting_risk];
  return risks.every(item => {
    const level = String(item && (item.risk_level || item.level) || '').toUpperCase();
    return item && item.assessment_status === 'ASSESSED' &&
      RISK_LEVELS.has(level) && level !== 'HIGH' && hasEvidence(item);
  });
}

/** 检查泛化报告中是否有证据支持的高风险结论。 */
function hasHighGeneralizationRisk(report, experimentId) {
  if (!report || report.status !== 'READY_FOR_REVIEW' ||
      !experimentId || report.experiment_id !== experimentId) return false;
  return [report.originality_risk, report.style_collapse_risk, report.overfitting_risk].some(item =>
    item && item.assessment_status === 'ASSESSED' &&
    String(item.risk_level || item.level || '').toUpperCase() === 'HIGH' && hasEvidence(item)
  );
}

/** 从有来源证据的缺陷登记中选择优先级最高的缺陷。 */
function selectCriticalDefect(defectRegistry) {
  const defects = Array.isArray(defectRegistry && defectRegistry.defects) ? defectRegistry.defects : [];
  return defects
    .filter(item => item && String(item.severity || '').toUpperCase() !== 'E' &&
      hasEvidence(item) && finite(defectPriority(item)))
    .map(item => ({ ...item, computed_priority: defectPriority(item) }))
    .sort((a, b) => (b.computed_priority ?? -1) - (a.computed_priority ?? -1))[0] || null;
}

/** 按缺陷编号关联有来源证据的根因分析。 */
function selectRootCause(rootCauseReport, defectId) {
  const causes = Array.isArray(rootCauseReport && rootCauseReport.rootCauses) ? rootCauseReport.rootCauses : [];
  return causes.find(item => item && item.defect_id === defectId && hasEvidence(item)) || null;
}

/** 只从明确关联目标缺陷的优化方案中选择任务。 */
function selectOptimization(optimizationPlan, defectId) {
  if (!defectId) return null;
  const tasks = Array.isArray(optimizationPlan && optimizationPlan.tasks) ? optimizationPlan.tasks : [];
  return tasks
    .filter(task => task && (task.target_defect === defectId || task.targetDefect === defectId))
    .map(item => ({ ...item, calculated_priority: finite(item.priorityScore) ? item.priorityScore : defectPriority(item) }))
    .sort((a, b) => (b.calculated_priority ?? -1) - (a.calculated_priority ?? -1))[0] || null;
}

/** 汇总已有阶段产物；不执行比较、生成或结果推断。 */
function executeEvolutionCycle(input = {}) {
  const defectRegistry = input.defectRegistry || null;
  const rootCauseReport = input.rootCauseReport || null;
  const optimizationPlan = input.optimizationPlan || null;
  const optimizationChangeLog = Array.isArray(input.optimizationChangeLog) ? input.optimizationChangeLog : [];
  const experimentPlan = input.experimentPlan || null;
  const experimentResult = input.experimentResult || null;
  const regressionReport = input.regressionReport || null;
  const generalizationReport = input.generalizationReport || null;
  const controlOutput = input.controlOutput || null;
  const treatmentOutput = input.treatmentOutput || null;
  const benchmarkData = input.benchmarkData || null;
  const genreBaselines = input.genreBaselines || null;

  const experimentId = String(experimentPlan && experimentPlan.experiment_id || '').trim();
  const experimentReady = validExperimentResult(experimentResult, experimentId);
  const regressionPassed = completeRegression(regressionReport, experimentId);
  const regressionFailed = completeRegressionFailure(regressionReport, experimentId);
  const generalizationSafe = safeGeneralization(generalizationReport, experimentId);
  const generalizationHighRisk = hasHighGeneralizationRisk(generalizationReport, experimentId);
  const missingEvidence = [];

  if (!defectRegistry || !Array.isArray(defectRegistry.defects)) missingEvidence.push('defectRegistry.defects');
  if (!rootCauseReport || !Array.isArray(rootCauseReport.rootCauses)) missingEvidence.push('rootCauseReport.rootCauses');
  if (!optimizationPlan || !Array.isArray(optimizationPlan.tasks)) missingEvidence.push('optimizationPlan.tasks');
  if (!experimentId || !String(experimentPlan && (experimentPlan.hypothesis || experimentPlan.title) || '').trim()) {
    missingEvidence.push('experimentPlan.experiment_id_and_hypothesis');
  }
  if (!experimentReady) missingEvidence.push('experimentResult.validated_result_and_evidence');
  if (!regressionPassed && !regressionFailed) missingEvidence.push('regressionReport.fixed_ten_case_evidence');
  if (!generalizationSafe && !generalizationHighRisk) missingEvidence.push('generalizationReport.evidence_and_risk_assessment');
  if (!controlOutput || !String(controlOutput.generation_id || '').trim()) missingEvidence.push('controlOutput.generation_id');
  if (!treatmentOutput || !String(treatmentOutput.generation_id || '').trim()) missingEvidence.push('treatmentOutput.generation_id');
  if (!benchmarkData || !String(benchmarkData.benchmark_id || '').trim()) missingEvidence.push('benchmarkData.benchmark_id');
  if (!genreBaselines || !String(genreBaselines.genre || '').trim()) missingEvidence.push('genreBaselines.genre');

  const criticalProblem = selectCriticalDefect(defectRegistry);
  const rootCause = criticalProblem ? selectRootCause(rootCauseReport, criticalProblem.defect_id) : null;
  const optimization = selectOptimization(optimizationPlan, criticalProblem && criticalProblem.defect_id);
  const linkedChanges = optimizationChangeLog.filter(item => item &&
    String(item.change_id || item.id || '').trim() &&
    String(item.summary || item.description || '').trim() &&
    optimization && (
      item.optimization_id === optimization.id ||
      item.optimizationId === optimization.id ||
      item.target_defect === criticalProblem.defect_id
    )
  );
  if (!criticalProblem) missingEvidence.push('critical_defect_with_evidence');
  if (criticalProblem && !rootCause) missingEvidence.push('rootCause_for_critical_defect');
  if (criticalProblem && !optimization) missingEvidence.push('optimization_for_critical_defect');
  if (!linkedChanges.length) missingEvidence.push('optimizationChangeLog.linked_to_target');

  let finalStatus = 'NEEDS_MORE_DATA';
  const reasons = [];
  if (experimentReady && experimentResult.verdict === 'NOT_SUPPORTED') {
    finalStatus = 'REJECTED';
    reasons.push('外部实验评测以可追溯证据否定了优化假设。');
  } else if (regressionFailed) {
    finalStatus = 'REJECTED';
    reasons.push('完整固定回归集发现有证据支持的失败项。');
  } else if (generalizationHighRisk) {
    finalStatus = 'REJECTED';
    reasons.push('泛化评测以证据标记了高风险，不接受该轮优化。');
  } else if (missingEvidence.length) {
    reasons.push('缺少证据：' + [...new Set(missingEvidence)].join('、'));
  } else if (experimentResult.verdict === 'SUPPORTED' && regressionPassed && generalizationSafe) {
    finalStatus = 'ACCEPTED';
    reasons.push('实验评测支持假设，完整回归集通过且泛化风险不高。');
  } else {
    reasons.push('现有外部评测尚不足以接受或拒绝优化。');
  }

  const hasRecordedChange = linkedChanges.length > 0;
  const canWriteLedger = Boolean(experimentPlan && (experimentPlan.hypothesis || experimentPlan.title) && hasRecordedChange) &&
    (finalStatus === 'ACCEPTED' ||
    (finalStatus === 'REJECTED' && experimentReady &&
      (experimentResult.verdict === 'NOT_SUPPORTED' || regressionFailed || generalizationHighRisk)));
  const ledgerEntry = canWriteLedger ? {
    experiment_id: experimentId,
    timestamp: new Date().toISOString(),
    hypothesis: experimentPlan.hypothesis || experimentPlan.title || null,
    change_ids: hasRecordedChange
      ? linkedChanges.map(item => item.change_id || item.id)
      : [],
    result: experimentResult.verdict,
    regression: regressionReport && regressionReport.final_verdict || 'NOT_ASSESSED',
    generalization_status: generalizationReport && generalizationReport.status || 'NOT_ASSESSED',
    final_status: finalStatus,
    evidence_refs: experimentResult.evidence.map(item => ({
      evidence_id: item.evidence_id,
      artifact_id: item.artifact_id,
      location: item.location
    }))
  } : null;

  const candidates = (defectRegistry && Array.isArray(defectRegistry.defects) ? defectRegistry.defects : [])
    .filter(item => item && String(item.severity || '').toUpperCase() !== 'E' &&
      hasEvidence(item) && finite(defectPriority(item)))
    .map(item => ({
      defect_id: item.defect_id || null,
      symptom: item.symptom || null,
      calculated_priority: defectPriority(item)
    }))
    .sort((a, b) => (b.calculated_priority ?? -1) - (a.calculated_priority ?? -1));

  return {
    schemaVersion: 'self-evolution-cycle-v3',
    generated_at: new Date().toISOString(),
    status: finalStatus,
    final_status: finalStatus,
    status_reason: reasons.join(' '),
    missing_evidence: [...new Set(missingEvidence)],
    scanned_assets: {
      defect_registry: Boolean(defectRegistry && Array.isArray(defectRegistry.defects)),
      root_cause_report: Boolean(rootCauseReport && Array.isArray(rootCauseReport.rootCauses)),
      optimization_plan: Boolean(optimizationPlan && Array.isArray(optimizationPlan.tasks)),
      optimization_change_log_count: optimizationChangeLog.length,
      experiment_plan: Boolean(experimentId),
      experiment_result: experimentReady,
      regression_report: regressionPassed || regressionFailed,
      generalization_report: generalizationSafe || generalizationHighRisk,
      control_output: Boolean(controlOutput && controlOutput.generation_id),
      treatment_output: Boolean(treatmentOutput && treatmentOutput.generation_id),
      benchmark: Boolean(benchmarkData && benchmarkData.benchmark_id),
      genre_baselines: Boolean(genreBaselines && genreBaselines.genre)
    },
    critical_problem: criticalProblem,
    target_layer: rootCause ? { affected_module: rootCause.affected_module || null } : null,
    root_cause: rootCause,
    optimization: optimization,
    experiment_plan: experimentPlan,
    experiment_result: experimentResult,
    regression_summary: regressionReport ? {
      final_verdict: regressionReport.final_verdict || 'NOT_ASSESSED',
      total_cases: regressionReport.statistics && regressionReport.statistics.total_cases || null,
      passed_cases: regressionReport.statistics && regressionReport.statistics.passed_cases || null,
      blocked_cases: regressionReport.statistics && regressionReport.statistics.blocked_cases || null
    } : { final_verdict: 'NOT_ASSESSED' },
    generalization_status: generalizationReport && generalizationReport.status || 'NOT_ASSESSED',
    quality_vector: input.qualityVector || null,
    defect_vector: defectRegistry && defectRegistry.defect_vector || null,
    root_cause_vector: rootCauseReport && rootCauseReport.root_cause_vector || null,
    next_round_plan: {
      candidates,
      selected_target: candidates[0] || null
    },
    evolution_ledger_entry: ledgerEntry
  };
}

module.exports = {
  calculateEvolutionPriority,
  executeEvolutionCycle,
  completeRegression,
  completeRegressionFailure,
  safeGeneralization
};
