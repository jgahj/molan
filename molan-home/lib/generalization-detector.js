'use strict';

const { buildFixedRegressionSet } = require('./regression-testing-engine.js');

const CHECKS = [
  ['CHK-01-SYNTAX', '句式趋同'],
  ['CHK-02-PLOT', '情节结构趋同'],
  ['CHK-03-CHARACTER', '人物模板趋同'],
  ['CHK-04-CONFLICT', '冲突模板趋同'],
  ['CHK-05-OPENING', '开篇模板趋同'],
  ['CHK-06-COOLPOINT', '爽点模板趋同'],
  ['CHK-07-CHAPTER_STRUCT', '章节结构趋同'],
  ['CHK-08-LANGUAGE', '语言模板趋同'],
  ['CHK-09-HIGH_FREQ_EXPR', '高频表达异常增加'],
  ['CHK-10-AUTHOR_OVERFIT', '与单一作者过度相似'],
  ['CHK-11-WORK_OVERFIT', '与单一作品过度相似'],
  ['CHK-12-STYLE_COLLAPSE', '不同类别之间风格坍缩']
];

const RISK_LEVELS = new Set(['LOW', 'MEDIUM', 'HIGH']);
const RESULT_STATES = new Set(['PASS', 'FAIL', 'BLOCKED']);

/** 规范化引用，只保留来源标识和定位信息。 */
function evidenceRefs(value) {
  if (!value || typeof value !== 'object') return [];
  const evidence = Array.isArray(value.evidence_refs)
    ? value.evidence_refs
    : Array.isArray(value.evidence) ? value.evidence : [];
  return evidence.map(item => {
    if (!item || typeof item !== 'object') return null;
    const reference = String(item.reference || item.evidence_id || item.artifact_id || item.source || '').trim();
    const location = String(item.location || item.chapter || item.dimension || '').trim();
    const hash = String(item.hash || '').trim();
    return reference && (location || hash) ? { reference, location: location || null, hash: hash || null } : null;
  }).filter(Boolean).slice(0, 20);
}

/** 缺少明确结论或引用时，该节保持未评估。 */
function assessedSection(value) {
  const sourceStatus = String(value && (value.status || value.verdict || value.risk_level) || '').trim();
  const evidence = evidenceRefs(value);
  if (!value || typeof value !== 'object' || !sourceStatus || !evidence.length) {
    return { status: 'NOT_ASSESSED', assessment_status: 'NOT_ASSESSED', evidence: [] };
  }
  return { ...value, status: sourceStatus, assessment_status: 'ASSESSED', evidence };
}

/** 仅在固定十例均有历史结果、当前判断和来源引用时开放泛化复核。 */
function hasCompleteRegressionEvidence(report, experimentId = null) {
  const expectedIds = buildFixedRegressionSet().map(item => item.case_id);
  if (!report || report.final_verdict !== 'PASS' ||
      !Array.isArray(report.test_results) || report.test_results.length !== expectedIds.length ||
      !report.statistics || report.statistics.total_cases !== expectedIds.length ||
      report.statistics.passed_cases !== expectedIds.length ||
      report.statistics.failed_cases !== 0 ||
      report.statistics.blocked_cases !== 0 ||
      report.statistics.input_error_count !== 0 ||
      (experimentId && report.experiment_id !== experimentId)) return false;

  const rows = new Map(report.test_results.map(item => [item && item.case_id, item]));
  return rows.size === expectedIds.length && expectedIds.every(caseId => {
    const item = rows.get(caseId);
    return Boolean(
      item && RESULT_STATES.has(String(item.previous_result || '').toUpperCase()) &&
      item.current_result === 'PASS' && evidenceRefs(item).length
    );
  });
}

/** 汇总外部泛化评测结果，不自行计算题材相似度或原创性结论。 */
function auditGeneralization(input = {}) {
  const suppliedChecks = input.checks || input.micro_convergence_checks || {};
  const checks = CHECKS.map(([id, dimension]) => {
    const source = Array.isArray(suppliedChecks)
      ? suppliedChecks.find(item => item && item.id === id)
      : suppliedChecks[id];
    const section = assessedSection(source);
    const rawRisk = String(source && (source.risk_level || source.status) || '').toUpperCase();
    const riskLevel = RISK_LEVELS.has(rawRisk) ? rawRisk : 'NOT_ASSESSED';
    const ready = section.assessment_status === 'ASSESSED' && riskLevel !== 'NOT_ASSESSED';
    return {
      id,
      dimension,
      risk_level: ready ? riskLevel : 'NOT_ASSESSED',
      status: ready ? 'ASSESSED' : 'NOT_ASSESSED',
      evidence: ready ? section.evidence : []
    };
  });

  const qualityGain = assessedSection(input.quality_gain || input.qualityGain);
  const benchmarkSimilarity = assessedSection(input.benchmark_similarity || input.benchmarkSimilarity);
  const diversity = assessedSection(input.diversity);
  const originalityRisk = assessedSection(input.originality_risk || input.originalityRisk);
  const styleCollapseRisk = assessedSection(input.style_collapse_risk || input.styleCollapseRisk);
  const overfittingRisk = assessedSection(input.overfitting_risk || input.overfittingRisk);
  const regressionReport = input.regressionReport || input.regression_report || null;
  const experimentId = String(input.experiment_id || input.experimentId || '').trim();
  const regressionReady = Boolean(experimentId) && hasCompleteRegressionEvidence(regressionReport, experimentId);
  const sections = {
    quality_gain: qualityGain,
    benchmark_similarity: benchmarkSimilarity,
    diversity,
    originality_risk: originalityRisk,
    style_collapse_risk: styleCollapseRisk,
    overfitting_risk: overfittingRisk
  };
  const missingEvidence = Object.entries(sections)
    .filter(([, section]) => section.assessment_status !== 'ASSESSED')
    .map(([name]) => name);
  for (const check of checks) {
    if (check.status !== 'ASSESSED') missingEvidence.push(check.id);
  }
  if (!regressionReady) missingEvidence.push('regressionReport.fixed_ten_case_pass');
  if (!experimentId) missingEvidence.push('experiment_id');

  const status = missingEvidence.length ? 'NEEDS_MORE_DATA' : 'READY_FOR_REVIEW';
  const regressionRows = regressionReady
    ? regressionReport.test_results.map(item => ({
        case_id: item.case_id,
        previous_result: item.previous_result,
        current_result: item.current_result,
        evidence: evidenceRefs(item)
      }))
    : [];

  return {
    report_title: '小说质量泛化与 Benchmark 过拟合检测报告 (GeneralizationReport)',
    generated_at: new Date().toISOString(),
    experiment_id: experimentId || null,
    status,
    missing_evidence: missingEvidence,
    ...sections,
    micro_convergence_checks: checks,
    capability_attribution: assessedSection(input.capability_attribution || input.capabilityAttribution),
    regression_gate: {
      status: regressionReady ? 'PASS' : 'BLOCKED',
      evidence: regressionRows
    },
    summary_verdict: status === 'READY_FOR_REVIEW'
      ? '外部泛化判断和固定回归集均有可追溯引用，结果可进入人工复核；本模块不替代比较评判。'
      : 'NEEDS_MORE_DATA：缺少带引用的质量收益、相似度、多样性、原创性、风格坍缩、过拟合或完整回归输入。'
  };
}

module.exports = {
  auditGeneralization,
  hasCompleteRegressionEvidence
};
