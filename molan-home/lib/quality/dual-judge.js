'use strict';

/**
 * 双评委语义复核与分歧判定 (Dual Semantic Review & Discrepancy Gate)
 *
 * 核心设计：
 * - 双独立裁决：引入 Judge A 与 Judge B 两个独立的文学质量评估向量；
 * - 分歧判定门禁：若任一核心维度分歧绝对值 |Score_A - Score_B| > 0.18，或两位评委结论相悖（一过一挂），
 *   直接触发 `status: 'needs_human'`，错误码 `DUAL_JUDGE_DISCREPANCY`，阻断自动提交；
 * - 共识合并：在容差 (<= 0.18) 范围内达成一致时，计算加权/算术均值生成最终权威质量向量与状态。
 */

const MAX_ALLOWED_DISCREPANCY_DELTA = 0.18; // 允许的最大分歧容差 (18%)

function extractNumericScore(entry) {
  if (entry == null) return null;
  if (typeof entry === 'number' && Number.isFinite(entry)) return entry;
  if (typeof entry === 'object' && Number.isFinite(Number(entry.score))) return Number(entry.score);
  if (typeof entry === 'object' && Number.isFinite(Number(entry.value))) return Number(entry.value);
  return null;
}

function evaluateDualJudgeConsensus(judgeA, judgeB, options = {}) {
  const maxDelta = Number(options.maxAllowedDelta) || MAX_ALLOWED_DISCREPANCY_DELTA;

  if (!judgeA || typeof judgeA !== 'object' || !judgeB || typeof judgeB !== 'object') {
    return {
      consensus: false,
      passed: false,
      status: 'needs_human',
      code: 'DUAL_JUDGE_DISCREPANCY',
      reason: '双评委评估结果不完整，缺少有效的评委输入对象',
      discrepancies: [{ dimension: 'general', delta: 1.0, message: '评委输入缺失' }]
    };
  }

  const scoreA = extractNumericScore(judgeA.score !== undefined ? judgeA.score : judgeA.overallScore);
  const scoreB = extractNumericScore(judgeB.score !== undefined ? judgeB.score : judgeB.overallScore);

  const passedA = judgeA.passed === true;
  const passedB = judgeB.passed === true;

  const vectorA = judgeA.qualityVector || judgeA.vector || {};
  const vectorB = judgeB.qualityVector || judgeB.vector || {};

  const discrepancies = [];

  // 1. 检查总分分歧
  if (scoreA !== null && scoreB !== null) {
    const overallDelta = Math.abs(scoreA - scoreB);
    if (overallDelta > maxDelta) {
      discrepancies.push({
        dimension: 'overallScore',
        scoreA,
        scoreB,
        delta: Number(overallDelta.toFixed(4)),
        threshold: maxDelta,
        message: `综合分分歧过大 (|${scoreA.toFixed(2)} - ${scoreB.toFixed(2)}| = ${overallDelta.toFixed(3)} > ${maxDelta})`
      });
    }
  }

  // 2. 检查判定结论冲突 (一过一挂)
  if (passedA !== passedB) {
    discrepancies.push({
      dimension: 'pass_fail_consensus',
      passedA,
      passedB,
      delta: 1.0,
      threshold: 0,
      message: `评委结论冲突 (Judge A: ${passedA ? '通过' : '未通过'}, Judge B: ${passedB ? '通过' : '未通过'})`
    });
  }

  // 3. 检查各维度的分歧
  const allDimensions = new Set([
    ...Object.keys(vectorA),
    ...Object.keys(vectorB)
  ]);

  const consensusVector = {};

  for (const dim of allDimensions) {
    const entryA = vectorA[dim];
    const entryB = vectorB[dim];
    const valA = extractNumericScore(entryA);
    const valB = extractNumericScore(entryB);

    if (valA !== null && valB !== null) {
      const delta = Math.abs(valA - valB);
      if (delta > maxDelta) {
        discrepancies.push({
          dimension: dim,
          scoreA: valA,
          scoreB: valB,
          delta: Number(delta.toFixed(4)),
          threshold: maxDelta,
          message: `维度「${dim}」评分分歧过大 (|${valA.toFixed(2)} - ${valB.toFixed(2)}| = ${delta.toFixed(3)} > ${maxDelta})`
        });
      }
      // 计算共识均值与保留正文引文
      const avgScore = Number(((valA + valB) / 2).toFixed(4));
      const confA = typeof entryA?.confidence === 'number' ? entryA.confidence : 0.85;
      const confB = typeof entryB?.confidence === 'number' ? entryB.confidence : 0.85;
      const avgConf = Number(((confA + confB) / 2).toFixed(4));
      const rawEvidenceList = [
        ...(Array.isArray(entryA && entryA.evidence) ? entryA.evidence : [entryA && entryA.evidence]),
        ...(Array.isArray(entryB && entryB.evidence) ? entryB.evidence : [entryB && entryB.evidence])
      ].filter(Boolean);
      const chosenQuote = (entryA && entryA.quote) || (entryB && entryB.quote) ||
        rawEvidenceList.find(e => typeof e === 'string' && !e.startsWith('[') && e.length >= 4) || '';

      consensusVector[dim] = {
        status: 'JUDGED',
        score: avgScore,
        confidence: avgConf,
        source: 'dual_judge_consensus',
        ...(chosenQuote ? { quote: chosenQuote } : {}),
        evidence: rawEvidenceList.length ? rawEvidenceList : `共识评分: ${avgScore}`
      };
    } else if (valA !== null) {
      consensusVector[dim] = { ...entryA };
    } else if (valB !== null) {
      consensusVector[dim] = { ...entryB };
    }
  }

  // 4. 判断最终共识与门禁状态
  const hasDiscrepancy = discrepancies.length > 0;
  if (hasDiscrepancy) {
    const maxDiscrepancyDelta = Math.max(...discrepancies.map(d => d.delta || 0));
    return {
      consensus: false,
      passed: false,
      status: 'needs_human',
      code: 'DUAL_JUDGE_DISCREPANCY',
      reason: `双评委分歧超过容差阈值 (${discrepancies[0].message})`,
      maxDelta: maxDiscrepancyDelta,
      discrepancies,
      judgeA: { score: scoreA, passed: passedA },
      judgeB: { score: scoreB, passed: passedB }
    };
  }

  // 达成共识
  const finalScore = scoreA !== null && scoreB !== null
    ? Number(((scoreA + scoreB) / 2).toFixed(4))
    : (scoreA !== null ? scoreA : scoreB);

  const bothPassed = passedA && passedB;

  return {
    consensus: true,
    passed: bothPassed,
    status: bothPassed ? 'MEASURED' : 'needs_human',
    score: finalScore,
    qualityVector: consensusVector,
    discrepancies: [],
    details: {
      judgeAScore: scoreA,
      judgeBScore: scoreB,
      evaluatedDimensions: Array.from(allDimensions)
    }
  };
}

module.exports = {
  MAX_ALLOWED_DISCREPANCY_DELTA,
  evaluateDualJudgeConsensus
};
