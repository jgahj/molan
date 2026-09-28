// 评测指标：黄金集（方案 13.2.1）中定义的核心指标计算，输入为一条条 {sample, expected, actual} 结果。
// 纯函数、无副作用，便于单测。
'use strict';

function countTruthy(items) {
  return Array.isArray(items) ? items.filter(Boolean).length : 0;
}

// 单元覆盖率：完成且有结果的 unit / 计划 unit
export function unitCoverage(planned, completedWithResult) {
  return planned > 0 ? Math.min(1, completedWithResult / planned) : 1;
}

// 重要结论精确率 / 召回率（claim 级）
export function claimPrecision(correctOutput, outputClaims) {
  return outputClaims > 0 ? Math.min(1, correctOutput / outputClaims) : 0;
}
export function claimRecall(foundCorrect, annotatedClaims) {
  return annotatedClaims > 0 ? Math.min(1, foundCorrect / annotatedClaims) : 0;
}

// 证据可追溯率：有有效证据引用的重要 claim / 输出重要 claim
export function evidenceTraceability(withValidEvidence, importantClaims) {
  return importantClaims > 0 ? Math.min(1, withValidEvidence / importantClaims) : 0;
}

// 实体/伏笔 micro F1
export function microF1(truePos, falsePos, falseNeg) {
  const precision = truePos + falsePos > 0 ? truePos / (truePos + falsePos) : 0;
  const recall = truePos + falseNeg > 0 ? truePos / (truePos + falseNeg) : 0;
  return precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
}

// 合同通过率：满足确定性+语义门槛的章节 / 评测章节
export function contractPassRate(passed, total) {
  return total > 0 ? Math.min(1, passed / total) : 1;
}

// 原创高风险拦截率：正确拦截高风险复刻 / 高风险复刻样本
export function originalityBlockRate(blocked, riskySamples) {
  return riskySamples > 0 ? Math.min(1, blocked / riskySamples) : 1;
}

// 假通过率：实际失败但被标记 passed 的样本 / 失败样本（Q1 必须为 0）
export function falsePassRate(falsePassed, failedSamples) {
  return failedSamples > 0 ? Math.min(1, falsePassed / failedSamples) : 0;
}

// 从一组结果聚合全部指标；results = [{task, expected, actual}]
export function computeMetrics(results) {
  let plannedUnits = 0, completedUnits = 0;
  let outputClaims = 0, correctOutput = 0, annotatedClaims = 0, foundCorrect = 0;
  let withValidEvidence = 0, importantClaims = 0;
  let tp = 0, fp = 0, fn = 0;
  let contractPassed = 0, contractTotal = 0;
  let riskySamples = 0, blockedRisky = 0;
  let failedSamples = 0, falsePassed = 0;

  (Array.isArray(results) ? results : []).forEach(({ task, expected, actual }) => {
    const exp = expected || {};
    const act = actual || {};
    if (task === 'unit') {
      plannedUnits += Number(exp.planned) || 0;
      completedUnits += Number(act.completed) || 0;
    } else if (task === 'claim' || task === 'evidence') {
      const expClaims = Number(exp.claimCount) || 0;
      const expImportant = Number(exp.importantClaimCount) || 0;
      const actClaims = Number(act.claimCount) || 0;
      const actCorrect = Number(act.correctClaimCount) || 0;
      const actFound = Number(act.foundCorrectClaimCount) || 0;
      outputClaims += actClaims; correctOutput += actCorrect;
      annotatedClaims += expClaims; foundCorrect += actFound;
      if (task === 'evidence') {
        importantClaims += expImportant;
        withValidEvidence += Number(act.withValidEvidence) || 0;
      }
    } else if (task === 'entity_state' || task === 'foreshadow') {
      tp += Number(act.truePos) || 0; fp += Number(act.falsePos) || 0; fn += Number(act.falseNeg) || 0;
    } else if (task === 'contract') {
      contractTotal += 1; if (act.passed) contractPassed += 1;
    } else if (task === 'originality') {
      if (exp.risky) { riskySamples += 1; if (act.blocked) blockedRisky += 1; }
    }
    // 假通过：expected 判定为失败，但 actual 标 passed
    const expShouldFail = exp.shouldFail === true;
    if (expShouldFail) {
      failedSamples += 1;
      if (act && act.passed === true) falsePassed += 1;
    }
  });

  return {
    unit_coverage: unitCoverage(plannedUnits, completedUnits),
    claim_precision: claimPrecision(correctOutput, outputClaims),
    claim_recall: claimRecall(foundCorrect, annotatedClaims),
    evidence_traceability: evidenceTraceability(withValidEvidence, importantClaims),
    entity_state_f1: microF1(tp, fp, fn),
    foreshadow_f1: microF1(tp, fp, fn),
    contract_pass_rate: contractPassRate(contractPassed, contractTotal),
    originality_block_rate: originalityBlockRate(blockedRisky, riskySamples),
    false_pass_rate: falsePassRate(falsePassed, failedSamples)
  };
}
