'use strict';

/**
 * 固定回归集及证据校验器。
 * 本模块验证外部评测结果的完整性，不替代盲评或人工语义判断。
 */

const REGRESSION_CASES = [
  ['REG-CASE-01-PIPE-FSM', '流式交付完整性', '玄幻修真', '生成交付', '长篇单章', '高 token 生成', '传输完整性', 'DEF-PIPE-001'],
  ['REG-CASE-02-PACING-BRIDGE', '时空过渡与冲突烈度', '玄幻修真', '动作切入与跨时段过渡', '双人博弈', '高魔多元', '动作与时间跨度并存', 'DEF-PACING-001'],
  ['REG-CASE-03-CAPACITY-GATE', '单章事件容量', '玄幻修真', '多幕连续推进', '多阵营角力', '中高复杂度', '多事件链聚合', 'DEF-PACING-002'],
  ['REG-CASE-04-CHAR-HUMANITY', '人物人味与微观反应', '玄幻修真', '高压互动', '主角与盟友关系', '高魔生存压力', '算计与情感反差', 'DEF-CHAR-001'],
  ['REG-CASE-05-DESC-SOMATIC', '受力描写与物理反馈', '玄幻修真', '破壁突袭', '强弱悬殊对抗', '神力物理规则', '生死防御试探', 'DEF-DESC-001'],
  ['REG-CASE-06-CONSIST-GRAPH', '实体关系与状态一致性', '玄幻修真', '道具交接', '多代关系网', '复杂实体状态', '物件状态与关系演进', 'DEF-CONSIST-001'],
  ['REG-CASE-07-URBAN-BREADTH', '都市题材写实阻尼', '都市重生/商战', '现实危机开篇', '市井群像', '写实低魔', '经济博弈与生活细节', 'CROSS-GENRE-STABILITY'],
  ['REG-CASE-08-XIANXIA-LONER', '古典仙侠独行感', '古典仙侠', '独行修行开篇', '独狼主角', '严密修炼等级', '生存推演与谨慎抉择', 'CROSS-GENRE-STABILITY'],
  ['REG-CASE-09-SUSPENSE-RULES', '悬疑认知边界', '民俗怪异', '线索切入', '师徒/调查关系', '民俗禁忌规则', '有限认知与线索推导', 'CROSS-GENRE-STABILITY'],
  ['REG-CASE-10-ROMANCE-SUBTLE', '青春情感关系推进', '青春甜宠', '生活场景开篇', '平等关系', '现代写实', '劳动细节与双向回应', 'CROSS-GENRE-STABILITY']
].map(([case_id, name, genre, opening_type, character_structure, world_complexity, plot_complexity, historical_defect_id]) => ({
  case_id,
  name,
  genre,
  opening_type,
  character_structure,
  world_complexity,
  plot_complexity,
  historical_defect_id
}));

const RESULT_STATES = new Set(['PASS', 'FAIL', 'BLOCKED']);

/** 返回不含作品原文的固定回归集定义。 */
function buildFixedRegressionSet() {
  return REGRESSION_CASES.map(item => ({ ...item }));
}

/** 将数组或按用例编号索引的结果统一为 Map。 */
function normalizeCaseResults(input) {
  if (Array.isArray(input)) {
    return new Map(input.filter(item => item && item.case_id).map(item => [item.case_id, item]));
  }
  if (input && typeof input === 'object') return new Map(Object.entries(input));
  return new Map();
}

/** 查出数组输入中重复的用例编号，避免最后一条静默覆盖前面的结果。 */
function duplicateCaseIds(input) {
  if (!Array.isArray(input)) return [];
  const counts = new Map();
  for (const item of input) {
    if (!item || !item.case_id) continue;
    counts.set(item.case_id, (counts.get(item.case_id) || 0) + 1);
  }
  return [...counts].filter(([, count]) => count > 1).map(([caseId]) => caseId);
}

/** 只接受包含稳定来源标识或来源位置的证据项。 */
function hasEvidenceReference(item) {
  if (!item || typeof item !== 'object') return false;
  const reference = item.reference || item.evidence_id || item.artifact_id || item.source;
  if (!String(reference || '').trim()) return false;
  return Boolean(item.location || item.hash || item.chapter || item.dimension || item.artifact_id);
}

/** 按选定用例集合汇总通过、失败或阻塞状态。 */
function summarizeCases(results, ids) {
  const selected = results.filter(item => ids.includes(item.case_id));
  if (!selected.length) return { status: 'NOT_ASSESSED', count: 0 };
  if (selected.some(item => item.current_result === 'FAIL')) {
    return { status: 'FAIL', count: selected.length };
  }
  if (selected.some(item => item.current_result === 'BLOCKED')) {
    return { status: 'BLOCKED', count: selected.length };
  }
  return { status: 'PASS', count: selected.length };
}

/** 仅接收带历史结果和证据的逐例判断，缺项一律 BLOCKED。 */
function runRegressionSuite({ caseResults = [], optimizationPlans = [], experimentId = null } = {}) {
  const suppliedResults = normalizeCaseResults(caseResults);
  const caseIds = new Set(REGRESSION_CASES.map(item => item.case_id));
  const duplicates = duplicateCaseIds(caseResults);
  for (const caseId of duplicates) suppliedResults.delete(caseId);
  const unknownCases = [...suppliedResults.keys()].filter(id => !caseIds.has(id));
  const inputErrorCount = unknownCases.length + duplicates.length;
  const results = REGRESSION_CASES.map((testCase) => {
    const supplied = suppliedResults.get(testCase.case_id);
    const missingEvidence = [];
    if (!supplied) missingEvidence.push('case_result');

    const rawStatus = String(supplied && (supplied.status || supplied.current_result) || '').toUpperCase();
    const hasValidStatus = RESULT_STATES.has(rawStatus);
    if (supplied && !hasValidStatus) missingEvidence.push('valid_status');

    const previousResult = String(supplied && (supplied.previous_result || supplied.previousResult) || '').toUpperCase();
    if (!RESULT_STATES.has(previousResult)) missingEvidence.push('previous_result');

    const evidence = supplied && Array.isArray(supplied.evidence)
      ? supplied.evidence.filter(hasEvidenceReference)
      : [];
    if (!evidence.length) missingEvidence.push('evidence');

    const currentResult = missingEvidence.length ? 'BLOCKED' : rawStatus;
    const linkedPlan = Array.isArray(optimizationPlans)
      ? optimizationPlans.find(plan => plan && plan.id === (supplied && supplied.causing_optimization))
      : null;

    return {
      case_id: testCase.case_id,
      name: testCase.name,
      genre: testCase.genre,
      status: currentResult,
      previous_result: RESULT_STATES.has(previousResult) ? previousResult : null,
      current_result: currentResult,
      regression: currentResult === 'FAIL' ? supplied.regression || supplied.reason || '评测输入标记为失败' : false,
      improvement: supplied && supplied.improvement || null,
      new_defect: supplied && supplied.new_defect || null,
      causing_optimization: linkedPlan ? linkedPlan.id : supplied && supplied.causing_optimization || null,
      confidence: typeof (supplied && supplied.confidence) === 'number' && Number.isFinite(supplied.confidence)
        ? Math.max(0, Math.min(1, Number(supplied.confidence)))
        : null,
      evidence,
      missing_evidence: missingEvidence
    };
  });

  const failed = results.filter(item => item.current_result === 'FAIL');
  const blocked = results.filter(item => item.current_result === 'BLOCKED');
  const finalVerdict = failed.length ? 'FAIL' : blocked.length || inputErrorCount ? 'BLOCKED' : 'PASS';
  const allCaseIds = results.map(item => item.case_id);
  const defectCases = results.filter(item => item.new_defect);
  const statusForAll = summarizeCases(results, allCaseIds).status;

  return {
    report_title: '小说生成系统回归测试报告 (RegressionReport)',
    generated_at: new Date().toISOString(),
    experiment_id: experimentId || null,
    evaluator: '回归评测结果证据校验器',
    final_verdict: finalVerdict,
    verdict_rationale: finalVerdict === 'PASS'
      ? '固定回归集的全部案例均有历史结果、当前判断和可追溯证据。'
      : finalVerdict === 'FAIL'
        ? `存在 ${failed.length} 个有证据支持的失败案例。`
        : String(blocked.length) + ' 个案例缺少历史结果、有效状态或证据；另有 ' +
          String(inputErrorCount) + ' 个未知或重复编号。缺少或错配数据不能判作通过。',
    statistics: {
      total_cases: results.length,
      passed_cases: results.filter(item => item.current_result === 'PASS').length,
      failed_cases: failed.length,
      blocked_cases: blocked.length,
      input_error_count: inputErrorCount,
      regressions_count: failed.length,
      improvements_count: results.filter(item => item.improvement).length,
      new_defects_count: defectCases.length,
      unknown_case_ids: unknownCases,
      duplicate_case_ids: duplicates
    },
    key_inspection_summary: {
      recurrence_of_fixed_defects: { ...summarizeCases(results, allCaseIds), details: '依据逐例回归结果汇总。' },
      new_defects_generated: {
        status: defectCases.length ? 'DETECTED' : statusForAll === 'PASS' ? 'NONE' : 'NOT_ASSESSED',
        count: defectCases.length,
        defects: defectCases.map(item => item.new_defect)
      },
      quality_regression: { ...summarizeCases(results, allCaseIds), count: failed.length },
      style_collapse: summarizeCases(results, ['REG-CASE-07-URBAN-BREADTH', 'REG-CASE-08-XIANXIA-LONER', 'REG-CASE-09-SUSPENSE-RULES', 'REG-CASE-10-ROMANCE-SUBTLE']),
      templatization: { status: 'NOT_ASSESSED' },
      ai_flavor_trend: { status: 'NOT_ASSESSED' },
      plot_homogenization: { status: 'NOT_ASSESSED' },
      benchmark_overfitting: { status: 'NOT_ASSESSED' }
    },
    test_results: results
  };
}

module.exports = {
  buildFixedRegressionSet,
  runRegressionSuite,
  hasEvidenceReference,
  duplicateCaseIds
};
