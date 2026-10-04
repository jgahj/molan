'use strict';

/**
 * 双评委生产管线与分歧判定门禁 (Dual Judge Production Pipeline & Discrepancy Gate)
 *
 * 核心设计：
 * - 独立评估元数据：全面记录并追踪 Judge A 与 Judge B 独立的评委身份 (judgeId, evaluatorId)、
 *   执行模型 (modelId)、提示词版本 (promptVersion) 以及严格的入参/输出 SHA-256 哈希 (inputHash, outputHash)。
 * - 选择性分流 (Selective Routing)：
 *   - 黄金前三章 (1-3) 强制执行双评委共识 (GOLDEN_CHAPTER)；
 *   - 分卷高潮 (VOLUME_CLIMAX) 与重大转折点 (MAJOR_TURNING_POINT) 强制执行双评委共识；
 *   - 显式强制标识 (EXPLICIT_OVERRIDE) 强制执行双评委共识；
 *   - 普通章节默认路由至单评委 (SINGLE_JUDGE: NORMAL_CHAPTER) 降低成本。
 * - 动态升阶判定 (Dynamic Escalation)：
 *   - 临界综合分 [0.65, 0.78] 动态升级至双评委 (BORDERLINE_SCORE)；
 *   - 低置信度 (< 0.85 整体或 < 0.80 关键维度) 动态升级至双评委 (LOW_CONFIDENCE)；
 *   - 临界维度分 [0.70, 0.75] 动态升级至双评委 (BORDERLINE_DIMENSION)；
 *   - 高置信度常态通过则无需二次评估。
 * - 分歧与共识门禁 (Discrepancy & Consensus)：
 *   - 最大允许分歧容差 MAX_ALLOWED_DISCREPANCY_DELTA = 0.18 (18%)；
 *   - 综合分或任一核心维度分歧绝对值 > 0.18，或两位评委结论相悖（一过一挂），
 *     直接触发 status: 'needs_human'，错误码 DUAL_JUDGE_DISCREPANCY，阻断自动提交；
 *   - 在容差 (<= 0.18) 范围内达成一致时合并共识，保留真实引文，标记 source: 'dual_judge_consensus'，
 *     status: 'MEASURED'，保留双评委完整元数据。
 */

const { hashValue } = require('../generation/manifest');

const MAX_ALLOWED_DISCREPANCY_DELTA = 0.18; // 允许的最大分歧容差 (18%)

function extractNumericScore(entry) {
  if (entry == null) return null;
  if (typeof entry === 'number' && Number.isFinite(entry)) return entry;
  if (typeof entry === 'object') {
    if (typeof entry.score === 'number' && Number.isFinite(entry.score)) return entry.score;
    if (typeof entry.value === 'number' && Number.isFinite(entry.value)) return entry.value;
  }
  return null;
}

/**
 * 规范化并创建单评委独立评估记录，确保具备完整的审计元数据与指纹哈希
 */
function createJudgeEvaluationRecord(input = {}, defaultSlot = 'judge_a') {
  const data = (input && typeof input === 'object') ? input : {};
  const judgeId = String(data.judgeId || defaultSlot || 'judge_a');
  const defaultEvaluator = judgeId === 'judge_b' ? 'literary_evaluator_b' : 'literary_evaluator_a';
  const evaluatorId = String(data.evaluatorId || defaultEvaluator);
  const defaultModel = judgeId === 'judge_b' ? 'deepseek-reasoner' : 'gpt-4o';
  const modelId = String(data.modelId || defaultModel);
  const promptVersion = String(data.promptVersion || 'judge_prompt_v2.1');

  const rawScore = data.score !== undefined ? data.score : data.overallScore;
  const score = extractNumericScore(rawScore);
  const passed = data.passed === true;

  const confidence = (typeof data.confidence === 'number' && Number.isFinite(data.confidence))
    ? Number(data.confidence)
    : (score !== null ? 0.85 : 0);

  const qualityVector = (data.qualityVector && typeof data.qualityVector === 'object')
    ? { ...data.qualityVector }
    : ((data.vector && typeof data.vector === 'object') ? { ...data.vector } : {});

  // 计算或保留输入哈希
  let inputHash = '';
  if (typeof data.inputHash === 'string' && data.inputHash.trim()) {
    inputHash = data.inputHash.trim();
  } else {
    const inputPayload = data.inputPayload ?? data.input ?? data.draft ?? data.text ?? {
      judgeId,
      evaluatorId,
      modelId,
      promptVersion
    };
    inputHash = hashValue(inputPayload);
  }

  // 计算或保留输出哈希
  let outputHash = '';
  if (typeof data.outputHash === 'string' && data.outputHash.trim()) {
    outputHash = data.outputHash.trim();
  } else {
    const outputPayload = data.outputPayload ?? data.output ?? data.response ?? {
      judgeId,
      evaluatorId,
      modelId,
      score,
      passed,
      confidence,
      qualityVector
    };
    outputHash = hashValue(outputPayload);
  }

  return {
    judgeId,
    evaluatorId,
    modelId,
    promptVersion,
    inputHash,
    outputHash,
    score,
    passed,
    confidence,
    qualityVector,
    status: data.status || (passed ? 'MEASURED' : (score !== null ? 'MEASURED' : 'NOT_MEASURED')),
    ...(data.code ? { code: data.code } : {}),
    ...(data.error ? { error: data.error } : {}),
    evaluatedAt: data.evaluatedAt || new Date().toISOString(),
    ...(data.details !== undefined ? { details: data.details } : {})
  };
}

/**
 * 提取请求或合同中的章节编号
 */
function extractChapterNumber(chapterNo, contract, request, options) {
  if (Number.isInteger(Number(chapterNo)) && Number(chapterNo) > 0) {
    return Number(chapterNo);
  }
  const c = (contract && typeof contract === 'object') ? contract : {};
  const r = (request && typeof request === 'object') ? request : {};
  const o = (options && typeof options === 'object') ? options : {};

  if (Number.isInteger(Number(c.chapterNo)) && Number(c.chapterNo) > 0) {
    return Number(c.chapterNo);
  }
  if (Number.isInteger(Number(r.chapterNo)) && Number(r.chapterNo) > 0) {
    return Number(r.chapterNo);
  }
  if (Number.isInteger(Number(o.chapterNo)) && Number(o.chapterNo) > 0) {
    return Number(o.chapterNo);
  }
  const rawId = String(r.chapterId || c.chapterId || '');
  const match = rawId.match(/(\d+)/);
  if (match) {
    const parsed = Number(match[1]);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

/**
 * 选择性评估路由判定 (Selective Routing Engine)
 *
 * @param {Object} context
 * @param {number} [context.chapterNo]
 * @param {Object} [context.contract]
 * @param {Object} [context.request]
 * @param {Object} [context.options]
 * @returns {{ route: 'DUAL_JUDGE' | 'SINGLE_JUDGE', reason: string }}
 */
function resolveEvaluationRoute(params = {}) {
  const p = (params && typeof params === 'object') ? params : {};
  const contract = (p.contract && typeof p.contract === 'object') ? p.contract : {};
  const request = (p.request && typeof p.request === 'object') ? p.request : {};
  const options = (p.options && typeof p.options === 'object') ? p.options : {};
  const chapterNo = p.chapterNo;

  // 1. 显式覆盖标记 (优先级最高)
  const isExplicitOverride = Boolean(
    p.forceDualJudge === true ||
    options.forceDualJudge === true ||
    request.forceDualJudge === true ||
    contract.forceDualJudge === true
  );
  if (isExplicitOverride) {
    return { route: 'DUAL_JUDGE', reason: 'EXPLICIT_OVERRIDE' };
  }

  // 2. 黄金前三章 (1-3)
  const resolvedChapterNo = extractChapterNumber(chapterNo, contract, request, options);
  const chapterFunc = String(contract.chapterFunction || request.chapterFunction || '').toLowerCase();
  const isGoldenFunction = chapterFunc.includes('golden') ||
    chapterFunc.includes('hook') ||
    chapterFunc.includes('goldfinger') ||
    chapterFunc.includes('first_cool');

  if ((resolvedChapterNo !== null && resolvedChapterNo >= 1 && resolvedChapterNo <= 3) || isGoldenFunction) {
    return { route: 'DUAL_JUDGE', reason: 'GOLDEN_CHAPTER' };
  }

  // 3. 分卷高潮 (Volume Climax)
  const isVolumeClimax = Boolean(
    p.isVolumeClimax === true ||
    options.isVolumeClimax === true ||
    request.isVolumeClimax === true ||
    contract.isVolumeClimax === true ||
    contract.chapterType === 'volume_climax' ||
    request.chapterType === 'volume_climax' ||
    contract.isClimax === true ||
    request.isClimax === true
  );
  if (isVolumeClimax) {
    return { route: 'DUAL_JUDGE', reason: 'VOLUME_CLIMAX' };
  }

  // 4. 重大转折点 (Major Turning Point)
  const isMajorTurningPoint = Boolean(
    p.isMajorTurningPoint === true ||
    options.isMajorTurningPoint === true ||
    request.isMajorTurningPoint === true ||
    contract.isMajorTurningPoint === true ||
    contract.isTurningPoint === true ||
    request.isTurningPoint === true ||
    contract.chapterType === 'major_turning_point' ||
    request.chapterType === 'major_turning_point'
  );
  if (isMajorTurningPoint) {
    return { route: 'DUAL_JUDGE', reason: 'MAJOR_TURNING_POINT' };
  }

  // 5. 常态章节路由至单评委
  return { route: 'SINGLE_JUDGE', reason: 'NORMAL_CHAPTER' };
}

/**
 * 单评委评估结果动态升阶判定 (Dynamic Escalation)
 *
 * @param {Object} judgeResult 单评委评估结果
 * @param {Object} [options] 可选门限配置
 * @returns {{ escalate: boolean, reason?: string }}
 */
function shouldEscalateToDualJudge(judgeResult, options = {}) {
  const opts = (options && typeof options === 'object') ? options : {};
  if (!judgeResult || typeof judgeResult !== 'object') {
    return { escalate: false, reason: 'NO_EVALUATION' };
  }

  const score = extractNumericScore(
    judgeResult.score !== undefined ? judgeResult.score : judgeResult.overallScore
  );
  const confidence = (typeof judgeResult.confidence === 'number' && Number.isFinite(judgeResult.confidence))
    ? judgeResult.confidence
    : null;

  const vector = (judgeResult.qualityVector && typeof judgeResult.qualityVector === 'object')
    ? judgeResult.qualityVector
    : ((judgeResult.vector && typeof judgeResult.vector === 'object')
      ? judgeResult.vector
      : ((judgeResult.literary && typeof judgeResult.literary.dimensions === 'object') ? judgeResult.literary.dimensions : {}));

  // 1. 临界综合分判定：[0.65, 0.78]
  if (score !== null && score >= 0.65 && score <= 0.78) {
    return { escalate: true, reason: 'BORDERLINE_SCORE' };
  }

  // 2. 整体低置信度判定：< 0.85
  if (confidence !== null && confidence < 0.85) {
    return { escalate: true, reason: 'LOW_CONFIDENCE' };
  }

  // 检查各维度置信度与临界分
  const dimensionKeys = Object.keys(vector);
  for (const dim of dimensionKeys) {
    const entry = vector[dim];
    if (!entry || typeof entry !== 'object') continue;

    // 关键维度低置信度：< 0.80
    const dimConf = typeof entry.confidence === 'number' && Number.isFinite(entry.confidence)
      ? entry.confidence
      : null;
    if (dimConf !== null && dimConf < 0.80) {
      return { escalate: true, reason: 'LOW_CONFIDENCE' };
    }
  }

  // 3. 临界维度分判定：[0.70, 0.75]
  for (const dim of dimensionKeys) {
    const entry = vector[dim];
    const dimScore = extractNumericScore(entry);
    if (dimScore !== null && dimScore >= 0.70 && dimScore <= 0.75) {
      return { escalate: true, reason: 'BORDERLINE_DIMENSION' };
    }
  }

  // 4. 高置信度常态通过，无需升阶
  return { escalate: false, reason: 'HIGH_CONFIDENCE_NORMAL' };
}

/**
 * 双评委共识评估与分歧判定门禁
 *
 * @param {Object} judgeA 评委 A 结果
 * @param {Object} judgeB 评委 B 结果
 * @param {Object} [options] 判定选项
 * @returns {Object} 共识评估结果或阻断错误
 */
function evaluateDualJudgeConsensus(judgeA, judgeB, options = {}) {
  const opts = (options && typeof options === 'object') ? options : {};
  const maxDelta = Number(opts.maxAllowedDelta) || MAX_ALLOWED_DISCREPANCY_DELTA;

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

  // 若任一评委模型评估执行失败，严格遵循 Fail-Closed，不可自证通过
  if (judgeA.status === 'EVALUATION_FAILED' || judgeB.status === 'EVALUATION_FAILED' ||
      judgeA.code === 'EVALUATION_FAILED' || judgeB.code === 'EVALUATION_FAILED') {
    const failedMsg = (judgeA.error && judgeA.error.message) ||
      (judgeB.error && judgeB.error.message) ||
      (judgeA.reason || judgeB.reason || '评委模型调用执行失败');
    return {
      consensus: false,
      passed: false,
      status: 'needs_human',
      code: 'EVALUATION_FAILED',
      reason: `评委评估执行失败 (EVALUATION_FAILED): ${failedMsg}`,
      error: judgeA.error || judgeB.error || { message: failedMsg },
      discrepancies: [{ dimension: 'evaluation_execution', delta: 1.0, message: failedMsg }],
      judgeA: createJudgeEvaluationRecord(judgeA, 'judge_a'),
      judgeB: createJudgeEvaluationRecord(judgeB, 'judge_b')
    };
  }

  // 规范化双评委独立元数据
  const recordA = createJudgeEvaluationRecord(
    {
      ...judgeA,
      ...(opts.judgeAModelId && !judgeA.modelId ? { modelId: opts.judgeAModelId } : {})
    },
    judgeA.judgeId || 'judge_a'
  );

  const recordB = createJudgeEvaluationRecord(
    {
      ...judgeB,
      ...(opts.judgeBModelId && !judgeB.modelId ? { modelId: opts.judgeBModelId } : {})
    },
    judgeB.judgeId || (judgeA.judgeId === 'judge_b' ? 'judge_a' : 'judge_b')
  );

  const scoreA = recordA.score;
  const scoreB = recordB.score;

  const passedA = recordA.passed === true;
  const passedB = recordB.passed === true;

  const vectorA = recordA.qualityVector || {};
  const vectorB = recordB.qualityVector || {};

  const discrepancies = [];

  // 1. 检查总分分歧 (使用四位小数取整防御 IEEE 754 浮点精度抖动，如 0.88 - 0.70 = 0.18000000000000005)
  if (scoreA !== null && scoreB !== null) {
    const rawOverallDelta = Math.abs(scoreA - scoreB);
    const overallDelta = Math.round(rawOverallDelta * 10000) / 10000;
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
      const rawDelta = Math.abs(valA - valB);
      const delta = Math.round(rawDelta * 10000) / 10000;
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
        status: 'MEASURED',
        score: avgScore,
        confidence: avgConf,
        source: 'dual_judge_consensus',
        ...(chosenQuote ? { quote: chosenQuote } : {}),
        evidence: rawEvidenceList.length ? rawEvidenceList : `共识评分: ${avgScore}`
      };
    } else if (valA !== null) {
      consensusVector[dim] = {
        ...entryA,
        status: entryA?.status || 'MEASURED',
        source: 'dual_judge_consensus'
      };
    } else if (valB !== null) {
      consensusVector[dim] = {
        ...entryB,
        status: entryB?.status || 'MEASURED',
        source: 'dual_judge_consensus'
      };
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
      judgeA: recordA,
      judgeB: recordB
    };
  }

  // 达成共识
  const finalScore = scoreA !== null && scoreB !== null
    ? Number(((scoreA + scoreB) / 2).toFixed(4))
    : (scoreA !== null ? scoreA : scoreB);

  const bothPassed = passedA && passedB;
  const avgConfidence = Number(((recordA.confidence + recordB.confidence) / 2).toFixed(4));

  // 若双评委均判定未通过，赋予明确错误码 DUAL_JUDGE_REJECTED 而非歧义的 DISCREPANCY
  if (!bothPassed) {
    return {
      consensus: true,
      passed: false,
      status: 'needs_human',
      code: 'DUAL_JUDGE_REJECTED',
      reason: '双评委一致判定未通过',
      score: finalScore,
      confidence: avgConfidence,
      source: 'dual_judge_consensus',
      qualityVector: consensusVector,
      discrepancies: [],
      judgeA: recordA,
      judgeB: recordB,
      details: {
        judgeAScore: scoreA,
        judgeBScore: scoreB,
        evaluatedDimensions: Array.from(allDimensions)
      }
    };
  }

  return {
    consensus: true,
    passed: true,
    status: 'MEASURED',
    score: finalScore,
    confidence: avgConfidence,
    source: 'dual_judge_consensus',
    qualityVector: consensusVector,
    discrepancies: [],
    judgeA: recordA,
    judgeB: recordB,
    details: {
      judgeAScore: scoreA,
      judgeBScore: scoreB,
      evaluatedDimensions: Array.from(allDimensions)
    }
  };
}

module.exports = {
  MAX_ALLOWED_DISCREPANCY_DELTA,
  extractNumericScore,
  createJudgeEvaluationRecord,
  resolveEvaluationRoute,
  shouldEscalateToDualJudge,
  evaluateDualJudgeConsensus
};
