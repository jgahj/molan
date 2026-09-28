import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './export-runtime-contract.mjs';
import { buildPromptSet, SCORE_KEYS as EVALUATION_SCORE_KEYS, validatePromptSet } from './generation-eval.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_EVAL_DIR = path.join(REPO_ROOT, 'data', 'character-material-v3.1', 'eval');
const SCORE_KEYS = Object.freeze(['naturalness', 'individuality', 'subtext', 'dialogue', 'emotionalEffect', 'readability', 'aiFlavor']);
const FAILURE_CATEGORIES = Object.freeze([
  'continuity',
  'contract',
  'character',
  'dialogue',
  'emotion',
  'pacing',
  'style',
  'originality',
  'retrieval',
  'safety',
  'other'
]);
const RETRIEVAL_ISSUES = Object.freeze(['missed', 'irrelevant', 'duplicate', 'wrong_scope', 'stale', 'other']);
const AUTOMATED_REVIEW_PATTERN = /ai|detector|model|proxy|llm|machine|automatic/iu;

function now() {
  return new Date().toISOString();
}

function jsonl(rows) {
  return rows.length ? `${rows.map(row => JSON.stringify(row)).join('\n')}\n` : '';
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf8');
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { value: null, missing: true, errors: [] };
  try {
    return { value: JSON.parse(fs.readFileSync(filePath, 'utf8')), missing: false, errors: [] };
  } catch (error) {
    return { value: null, missing: false, errors: [`JSON 无效：${filePath}：${error.message}`] };
  }
}

export function readJsonl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { rows: [], missing: true, errors: [] };
  const rows = [];
  const errors = [];
  fs.readFileSync(filePath, 'utf8').split(/\r?\n/u).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      errors.push(`JSONL 无效：${filePath}：第 ${index + 1} 行：${error.message}`);
    }
  });
  return { rows, missing: false, errors };
}

function asString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function stableId(value, fallback) {
  const candidate = asString(value);
  if (candidate) return candidate;
  return crypto.createHash('sha256').update(JSON.stringify(fallback)).digest('hex').slice(0, 16);
}

function numericScore(value) {
  const score = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(score) && score >= 1 && score <= 5 ? score : null;
}

function normalizeScoreSet(value) {
  if (!value || typeof value !== 'object') return null;
  const result = {};
  for (const key of SCORE_KEYS) {
    const score = numericScore(value[key]);
    if (score === null) return null;
    result[key] = score;
  }
  return result;
}

function normalizeCategories(value) {
  const values = Array.isArray(value) ? value : [value];
  const categories = unique(values.map(item => asString(item).toLowerCase()).map(item => FAILURE_CATEGORIES.includes(item) ? item : item ? 'other' : ''));
  return categories;
}

function normalizeFailureCase(item, context) {
  if (!item || typeof item !== 'object') return null;
  const categories = normalizeCategories(item.categories || item.category || item.type);
  return {
    caseId: stableId(item.caseId, { evalId: context.evalId, summary: item.summary, categories }),
    evalId: context.evalId,
    promptId: context.promptId,
    side: ['A', 'B', 'both', 'unknown'].includes(item.side) ? item.side : 'unknown',
    categories: categories.length ? categories : ['other'],
    severity: ['blocking', 'major', 'minor'].includes(item.severity) ? item.severity : 'minor',
    summary: asString(item.summary || item.reason),
    evidence: asString(item.evidence || item.evidenceRef),
    source: 'human',
    reviewerId: context.reviewerId,
    recordedAt: context.recordedAt
  };
}

function normalizeSampleFeedback(item, context) {
  if (!item || typeof item !== 'object') return null;
  return {
    feedbackId: stableId(item.feedbackId, { type: 'sample', evalId: context.evalId, action: item.action, reason: item.reason }),
    evalId: context.evalId,
    promptId: context.promptId,
    sampleId: asString(item.sampleId || item.id || context.promptId),
    action: ['keep', 'revise', 'remove', 'add'].includes(item.action) ? item.action : 'revise',
    reason: asString(item.reason),
    target: asString(item.target),
    reviewerId: context.reviewerId,
    recordedAt: context.recordedAt
  };
}

function normalizeRuleFeedback(item, context) {
  if (!item || typeof item !== 'object') return null;
  return {
    feedbackId: stableId(item.feedbackId, { type: 'rule', evalId: context.evalId, ruleId: item.ruleId, action: item.action }),
    evalId: context.evalId,
    promptId: context.promptId,
    ruleId: asString(item.ruleId || item.id),
    action: ['keep', 'tighten', 'loosen', 'replace', 'remove', 'add'].includes(item.action) ? item.action : 'revise',
    priority: ['blocking', 'high', 'normal', 'low'].includes(item.priority) ? item.priority : 'normal',
    reason: asString(item.reason),
    proposedText: asString(item.proposedText || item.rule),
    reviewerId: context.reviewerId,
    recordedAt: context.recordedAt
  };
}

function normalizeRetrievalFeedback(item, context) {
  if (!item || typeof item !== 'object') return null;
  const issue = asString(item.issue || item.type).toLowerCase();
  return {
    feedbackId: stableId(item.feedbackId, { type: 'retrieval', evalId: context.evalId, query: item.query, issue }),
    evalId: context.evalId,
    promptId: context.promptId,
    query: asString(item.query),
    issue: RETRIEVAL_ISSUES.includes(issue) ? issue : 'other',
    sourceRefs: unique((Array.isArray(item.sourceRefs) ? item.sourceRefs : [item.sourceRef]).map(asString)),
    action: asString(item.action || 'inspect'),
    reason: asString(item.reason),
    reviewerId: context.reviewerId,
    recordedAt: context.recordedAt
  };
}

function reviewIdentityErrors(row) {
  const value = row && typeof row === 'object' ? row : {};
  const reviewerId = asString(value.reviewerId || value.annotatorId);
  const errors = [];
  if (!reviewerId) errors.push('缺少 reviewerId');
  const automatedFields = ['detector', 'detectorId', 'model', 'modelId', 'aiDetector'];
  if (automatedFields.some(key => value[key] !== undefined && value[key] !== null)) {
    errors.push('评审记录包含 detector/model 身份，不得作为真人盲评');
  }
  const identityText = [
    reviewerId,
    asString(value.evaluator),
    asString(value.evaluatorType),
    asString(value.reviewerType),
    asString(value.source)
  ].join(' ');
  if (AUTOMATED_REVIEW_PATTERN.test(identityText)) {
    errors.push('评审身份疑似模型或自动检测器，不得作为真人盲评');
  }
  return errors;
}

/** Normalize one human blind-review record without consulting an AI detector. */
export function normalizeHumanReview(input, options = {}) {
  const row = input && typeof input === 'object' ? input : {};
  const promptId = asString(row.promptId);
  const evalId = asString(row.evalId) || (promptId ? `eval-${promptId}` : stableId('', { promptId }));
  const reviewerId = asString(row.reviewerId || row.annotatorId);
  const recordedAt = asString(row.recordedAt || row.updatedAt || row.createdAt) || options.recordedAt || now();
  const errors = [];
  const rawStatus = asString(row.status).toLowerCase();
  const status = rawStatus || 'scored';
  errors.push(...reviewIdentityErrors(row));
  if (rawStatus && !['pending', 'scored'].includes(rawStatus)) errors.push('review status 必须为 pending 或 scored');
  if (!promptId && !asString(row.evalId)) errors.push('缺少 evalId 或 promptId');
  const winner = row.winner || row.choice || row.preferred;
  if (status === 'scored' && !['A', 'B', 'tie'].includes(winner)) errors.push('scored 评审的 winner 必须为 A、B 或 tie');
  const rawScores = row.scores || row.sideScores || {};
  const scores = { A: normalizeScoreSet(rawScores.A), B: normalizeScoreSet(rawScores.B) };
  if (status === 'scored' && (!scores.A || !scores.B)) errors.push('scored 评审必须同时提供 A/B 的 1-5 全维度人工评分');
  const context = { evalId, promptId, reviewerId, recordedAt };
  const failureCases = (Array.isArray(row.failureCases) ? row.failureCases : row.failureCase ? [row.failureCase] : [])
    .map(item => normalizeFailureCase(item, context)).filter(Boolean);
  const feedback = row.feedback && typeof row.feedback === 'object' ? row.feedback : {};
  const sampleFeedback = (Array.isArray(feedback.samples) ? feedback.samples : feedback.sample ? [feedback.sample] : [])
    .map(item => normalizeSampleFeedback(item, context)).filter(Boolean);
  const ruleFeedback = (Array.isArray(feedback.rules) ? feedback.rules : feedback.rule ? [feedback.rule] : [])
    .map(item => normalizeRuleFeedback(item, context)).filter(Boolean);
  const retrievalFeedback = (Array.isArray(feedback.retrieval) ? feedback.retrieval : feedback.retrieval ? [feedback.retrieval] : [])
    .map(item => normalizeRetrievalFeedback(item, context)).filter(Boolean);
  return {
    reviewId: stableId(row.reviewId, { evalId, reviewerId, recordedAt }),
    evalId,
    promptId,
    reviewerId,
    status: errors.length ? 'pending' : status,
    pendingReason: errors.length ? errors : (status === 'pending' ? [asString(row.pendingReason) || 'human_review_pending'] : []),
    winner: errors.length ? null : (['A', 'B', 'tie'].includes(winner) ? winner : null),
    scores: errors.length ? null : (status === 'scored' ? scores : null),
    failureCases,
    feedback: { samples: sampleFeedback, rules: ruleFeedback, retrieval: retrievalFeedback },
    notes: asString(row.notes),
    source: 'human-blind-review',
    recordedAt
  };
}

export function mergeReviewLedger(existing = [], incoming = []) {
  const byId = new Map();
  for (const row of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    const normalized = normalizeHumanReview(row);
    if (!normalized.reviewId) continue;
    byId.set(normalized.reviewId, normalized);
  }
  return [...byId.values()].sort((a, b) => `${a.recordedAt}:${a.reviewId}`.localeCompare(`${b.recordedAt}:${b.reviewId}`));
}

function reviewByPair(reviews) {
  const map = new Map();
  for (const rawReview of reviews) {
    const review = normalizeHumanReview(rawReview);
    const key = review.evalId || `eval-${review.promptId}`;
    const current = map.get(key);
    if (!current || `${review.recordedAt}:${review.reviewId}` > `${current.recordedAt}:${current.reviewId}`) map.set(key, review);
  }
  return map;
}

function promptIdForPair(row) {
  return asString(row?.promptId) || asString(row?.evalId).replace(/^eval-/u, '');
}

export function qualityNonInferiority(metrics = {}) {
  const regressions = [];
  for (const key of SCORE_KEYS) {
    const delta = Number(metrics.meanDelta?.[key]);
    if (!Number.isFinite(delta)) regressions.push(`${key}:missing`);
    else if (key === 'aiFlavor' ? delta > 0 : delta < 0) regressions.push(`${key}:${delta}`);
  }
  return {
    pass: regressions.length === 0 && Number(metrics.scoredPairCount || 0) > 0 && Number(metrics.pendingPairCount || 0) === 0,
    regressions,
    rule: '人工 A/B 的六项正向指标不得低于 baseline，aiFlavor 不得升高。'
  };
}

export function aggregateHumanFeedbackMetrics(rows = [], promptCount = Array.isArray(rows) ? rows.length : 0) {
  const scored = rows.filter(row => row.status === 'scored' && row.humanScores?.A && row.humanScores?.B);
  const pending = rows.filter(row => row.status === 'pending');
  const means = { A: {}, B: {} };
  const meanDelta = {};
  for (const key of SCORE_KEYS) {
    const average = side => scored.length ? scored.reduce((sum, row) => sum + row.humanScores[side][key], 0) / scored.length : null;
    means.A[key] = means.A[key] === undefined ? average('A') : means.A[key];
    means.B[key] = average('B');
    meanDelta[key] = means.A[key] === null ? null : Number((means.B[key] - means.A[key]).toFixed(4));
    if (means.A[key] !== null) means.A[key] = Number(means.A[key].toFixed(4));
    if (means.B[key] !== null) means.B[key] = Number(means.B[key].toFixed(4));
  }
  const count = predicate => scored.filter(predicate).length;
  const bWins = count(row => row.winner === 'B');
  const aWins = count(row => row.winner === 'A');
  const ties = count(row => row.winner === 'tie');
  const ratio = value => scored.length ? Number((value / scored.length).toFixed(4)) : null;
  const complete = pending.length === 0 && scored.length === rows.length && scored.length > 0;
  return {
    source: 'human-blind-review',
    evidencePolicy: { humanReviewRequired: true, aiDetectorSoleBasis: false },
    promptCount,
    scoredPairCount: scored.length,
    pendingPairCount: pending.length,
    status: pending.length || !scored.length ? 'pending' : 'scored',
    means,
    meanDelta,
    winnerCounts: { B: bWins, A: aWins, tie: ties },
    bWinRate: ratio(bWins),
    aiFlavorDecreaseRate: ratio(count(row => row.humanScores.B.aiFlavor < row.humanScores.A.aiFlavor)),
    readabilityDecreaseRate: ratio(count(row => row.humanScores.B.readability < row.humanScores.A.readability)),
    individualityImprovementRate: ratio(count(row => row.humanScores.B.individuality > row.humanScores.A.individuality)),
    dialogueImprovementRate: ratio(count(row => row.humanScores.B.dialogue > row.humanScores.A.dialogue)),
    subtextImprovementRate: ratio(count(row => row.humanScores.B.subtext > row.humanScores.A.subtext)),
    naturalnessImprovementRate: ratio(count(row => row.humanScores.B.naturalness > row.humanScores.A.naturalness)),
    claimable: complete,
    claimableMetrics: complete ? { bWinRate: ratio(bWins), meanDelta } : null,
    limitations: [
      '指标只来自真实人工盲评；generation-eval 的 deterministic proxy 和 AI 检测器不计为人工依据。',
      '任一 pair 或人工评审缺失时保留 pending，不能据此宣称整体收益。'
    ]
  };
}

export function buildFeedbackRows({ prompts = [], pairs = [], scores = [], reviews = [] } = {}) {
  const promptRows = Array.isArray(prompts) ? prompts : [];
  const pairMap = new Map();
  for (const row of Array.isArray(scores) ? scores : []) {
    pairMap.set(asString(row?.evalId || `eval-${promptIdForPair(row)}`), row);
  }
  for (const row of Array.isArray(pairs) ? pairs : []) {
    const key = asString(row?.evalId || `eval-${promptIdForPair(row)}`);
    pairMap.set(key, { ...pairMap.get(key), ...row });
  }
  const pairRows = [...pairMap.values()];
  const reviewMap = reviewByPair(reviews);
  const promptById = new Map(promptRows.map(prompt => [asString(prompt?.promptId || prompt?.id), prompt]));
  const promptIds = unique([
    ...promptRows.map(prompt => asString(prompt?.promptId || prompt?.id)),
    ...pairRows.map(promptIdForPair)
  ]);
  return promptIds.map(promptId => {
    const prompt = promptById.get(promptId) || {};
    const evalId = `eval-${promptId}`;
    const pair = pairMap.get(evalId) || pairMap.get(asString(prompt?.evalId));
    const review = reviewMap.get(evalId) || reviewMap.get(asString(pair?.evalId));
    const pendingReason = [];
    if (!pair) pendingReason.push('pair_missing');
    else if (pair.status !== 'scored' || !pair.scores?.A || !pair.scores?.B) pendingReason.push(...(pair.pendingReason || ['pair_pending']));
    if (!review) pendingReason.push('human_review_missing');
    else if (review.status !== 'scored' || !review.scores?.A || !review.scores?.B) pendingReason.push(...(review.pendingReason || ['human_review_pending']));
    const isScored = pendingReason.length === 0;
    return {
      evalId,
      promptId,
      categoryId: asString(prompt?.categoryId),
      category: asString(prompt?.category),
      blindOrder: pair?.blindOrder || null,
      status: isScored ? 'scored' : 'pending',
      pendingReason: unique(pendingReason),
      winner: isScored ? review.winner : null,
      humanScores: isScored ? review.scores : null,
      reviewId: review?.reviewId || null,
      reviewerId: review?.reviewerId || null,
      failureCases: review?.failureCases || [],
      feedback: review?.feedback || { samples: [], rules: [], retrieval: [] },
      claimable: isScored
    };
  });
}

export function classifyFailureCases(rows = []) {
  const cases = [];
  for (const row of Array.isArray(rows) ? rows : []) cases.push(...(row.failureCases || []));
  const byCategory = Object.fromEntries(FAILURE_CATEGORIES.map(category => [category, 0]));
  const bySeverity = { blocking: 0, major: 0, minor: 0 };
  for (const item of cases) {
    for (const category of item.categories || ['other']) byCategory[FAILURE_CATEGORIES.includes(category) ? category : 'other'] += 1;
    if (bySeverity[item.severity] !== undefined) bySeverity[item.severity] += 1;
  }
  return { cases, total: cases.length, byCategory, bySeverity };
}

export function buildFeedbackReport({ data, rows, reviews, paths = {}, generatedAt } = {}) {
  const feedbackRows = Array.isArray(rows) ? rows : [];
  const metrics = aggregateHumanFeedbackMetrics(feedbackRows, data?.prompts?.length || feedbackRows.length);
  const qualityGate = qualityNonInferiority(metrics);
  const failures = classifyFailureCases(feedbackRows);
  const feedback = { samples: [], rules: [], retrieval: [] };
  for (const row of feedbackRows) {
    for (const type of Object.keys(feedback)) feedback[type].push(...(row.feedback?.[type] || []));
  }
  const pendingIds = feedbackRows.filter(row => row.status === 'pending').map(row => row.evalId);
  const gates = {
    realHumanScoredData: { pass: metrics.scoredPairCount > 0, value: metrics.scoredPairCount },
    noPendingPairs: { pass: pendingIds.length === 0, value: pendingIds.length },
    failureCasesClassified: { pass: failures.cases.every(item => item.categories?.length > 0), value: failures.total },
    claimable: { pass: metrics.claimable, value: metrics.claimable },
    qualityNonInferiority: { pass: qualityGate.pass, regressions: qualityGate.regressions }
  };
  return {
    reportVersion: 'molan-generation-feedback-v1',
    generatedAt: generatedAt || now(),
    status: metrics.status,
    claimable: metrics.claimable,
    humanReviewRequired: pendingIds.length > 0,
    source: {
      generationEval: 'scripts/generation-eval.mjs',
      promptCount: data?.prompts?.length || 0,
      pairCount: data?.pairs?.length || data?.scores?.length || 0,
      reportVersion: data?.report?.reportVersion || null,
      paths
    },
    metrics,
    gates,
    pending: { count: pendingIds.length, evalIds: pendingIds },
    failureCases: failures,
    feedback,
    qualityGate,
    reviewCount: reviews.length,
    reviewerIds: unique(reviews.map(row => row.reviewerId)),
    checkpoint: {
      resumable: true,
      lastReviewId: reviews.at(-1)?.reviewId || null,
      pendingEvalIds: pendingIds
    },
    interpretation: metrics.claimable
      ? '全部评测 pair 均有真实人工盲评，可声明的指标仅限本报告列出的人工指标。'
      : '当前评测仍 pending；已保存的人工评分可继续复用，但不得把部分数据声明为整体收益。'
  };
}

export function loadGenerationEvaluationData(options = {}) {
  const evalDir = options.evalDir || DEFAULT_EVAL_DIR;
  const promptsPath = options.promptsPath || path.join(evalDir, 'prompts.jsonl');
  const pairsPath = options.pairsPath || path.join(evalDir, 'pairs.jsonl');
  const scoresPath = options.scoresPath || path.join(evalDir, 'scores.jsonl');
  const baselinePath = options.baselinePath || path.join(evalDir, 'baseline.jsonl');
  const materialPath = options.materialPath || path.join(evalDir, 'material.jsonl');
  const reportPath = options.reportPath || path.join(evalDir, 'report.json');
  const metricsPath = options.metricsPath || path.join(evalDir, 'metrics.json');
  const prompts = readJsonl(promptsPath);
  const pairs = readJsonl(pairsPath);
  const scores = readJsonl(scoresPath);
  const baseline = readJsonl(baselinePath);
  const material = readJsonl(materialPath);
  const report = readJson(reportPath);
  const metrics = readJson(metricsPath);
  const missingErrors = [
    prompts.missing ? `缺少 generation-eval prompts：${promptsPath}` : '',
    baseline.missing ? `缺少 generation-eval baseline：${baselinePath}` : '',
    material.missing ? `缺少 generation-eval material：${materialPath}` : '',
    scores.missing ? `缺少 generation-eval scores：${scoresPath}` : '',
    report.missing ? `缺少 generation-eval report：${reportPath}` : ''
  ].filter(Boolean);
  const errors = [...missingErrors, ...prompts.errors, ...pairs.errors, ...scores.errors, ...baseline.errors, ...material.errors, ...report.errors, ...metrics.errors];
  return {
    prompts: prompts.rows,
    promptValidation: validatePromptSet(prompts.rows),
    pairs: pairs.rows,
    scores: scores.rows,
    baseline: baseline.rows,
    material: material.rows,
    report: report.value,
    metrics: metrics.value,
    errors,
    paths: { promptsPath, pairsPath, scoresPath, baselinePath, materialPath, reportPath, metricsPath },
    missing: { prompts: prompts.missing, pairs: pairs.missing, scores: scores.missing, baseline: baseline.missing, material: material.missing, report: report.missing, metrics: metrics.missing }
  };
}

export function validateSourceEvaluationData(data = {}) {
  const errors = [];
  const promptValidation = validatePromptSet(Array.isArray(data.prompts) ? data.prompts : []);
  if (!promptValidation.pass) errors.push('generation-eval 固定 prompt 集未通过校验');
  const expectedIds = new Set(buildPromptSet().map(prompt => prompt.promptId));
  const report = data.report;
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    errors.push('缺少 generation-eval report');
  } else {
    const reportStatus = asString(report.status).toLowerCase();
    if (reportStatus !== 'proxy-only') errors.push('generation-eval report 必须是已完成 proxy 计算且待人工盲评的 proxy-only 状态');
    if (['pending', 'blocked', 'failed'].includes(reportStatus)) errors.push('generation-eval report 仍处于 pending/失败状态');
    if (Array.isArray(report.inputErrors) && report.inputErrors.length) errors.push('generation-eval report 含 inputErrors');
    if (report.promptValidation?.pass !== true) errors.push('generation-eval report 未绑定通过的 promptValidation');
    if (report.stageId !== '0.5') errors.push('generation-eval report 未绑定 Stage 0.5');
    if (report.claimable !== false || report.metrics?.claimable !== false || report.metrics?.evaluator !== 'deterministic-proxy-v1') {
      errors.push('generation-eval report 的 proxy/claimable 边界字段不完整');
    }
    const reportMetrics = report.metrics;
    if (!reportMetrics
      || Number(reportMetrics.promptCount) !== expectedIds.size
      || Number(reportMetrics.completePairCount) !== expectedIds.size
      || Number(reportMetrics.pendingPairCount) !== 0) {
      errors.push('generation-eval report 未提供完整 A/B pair');
    }
    if (report.promptCount !== undefined && Number(report.promptCount) !== expectedIds.size) errors.push('generation-eval report promptCount 与固定 prompt 集不一致');
    if (reportMetrics?.status !== undefined && reportMetrics.status !== 'proxy-only') errors.push('generation-eval report metrics 状态未绑定 proxy-only');
    for (const side of ['baseline', 'material']) {
      const input = report.inputs?.[side];
      if (input?.available !== true || Number(input.rowCount) !== expectedIds.size || Number(input.errorCount || 0) !== 0 || input.missing === true) {
        errors.push(`generation-eval ${side} 输入未完整绑定`);
      }
    }
  }
  const scoreRows = Array.isArray(data.scores) ? data.scores : [];
  const seen = new Set();
  if (scoreRows.length !== expectedIds.size) errors.push('generation-eval scores 行数与固定 prompt 集不一致');
  for (const row of scoreRows) {
    const promptId = asString(row?.promptId);
    if (!expectedIds.has(promptId) || seen.has(promptId)) errors.push(`generation-eval scores promptId 无效或重复：${promptId || '(空)'}`);
    seen.add(promptId);
    if (row?.evalId !== `eval-${promptId}`) errors.push(`generation-eval scores evalId 未绑定 promptId：${promptId || '(空)'}`);
    if (row?.status !== 'scored' || row?.evaluator !== 'deterministic-proxy-v1' || !row.scores?.A || !row.scores?.B) errors.push(`generation-eval scores 未完成 A/B：${promptId || '(空)'}`);
    for (const side of ['A', 'B']) {
      for (const key of EVALUATION_SCORE_KEYS) if (!Number.isInteger(Number(row?.scores?.[side]?.[key])) || Number(row.scores[side][key]) < 1 || Number(row.scores[side][key]) > 5) {
        errors.push(`generation-eval scores ${promptId || '(空)'} ${side} 缺少完整 proxy 分数`);
        break;
      }
    }
  }
  if (seen.size !== expectedIds.size) errors.push('generation-eval scores 未覆盖全部固定 prompt');
  if (data.metrics && typeof data.metrics === 'object') {
    if (data.metrics.evaluator !== 'deterministic-proxy-v1'
      || data.metrics.claimable !== false
      || Number(data.metrics.promptCount) !== expectedIds.size
      || Number(data.metrics.completePairCount) !== expectedIds.size
      || Number(data.metrics.pendingPairCount) !== 0) {
      errors.push('generation-eval metrics 未完成固定 prompt 集');
    }
    if (data.metrics.status !== undefined && data.metrics.status !== 'proxy-only') errors.push('generation-eval metrics 状态未绑定 proxy-only');
  } else errors.push('缺少 generation-eval metrics');
  if (data.report?.metrics && data.metrics && typeof data.metrics === 'object') {
    for (const key of ['evaluator', 'promptCount', 'completePairCount', 'pendingPairCount', 'claimable', 'status']) {
      if (data.report.metrics[key] !== undefined && data.report.metrics[key] !== data.metrics[key]) {
        errors.push(`generation-eval report.metrics.${key} 与 metrics 未绑定`);
      }
    }
  }
  for (const side of ['baseline', 'material']) {
    const rows = Array.isArray(data[side]) ? data[side] : [];
    const seenSide = new Set();
    if (rows.length !== expectedIds.size) errors.push(`generation-eval ${side} 实际输出行数不完整`);
    for (const row of rows) {
      const promptId = asString(row?.promptId);
      if (!expectedIds.has(promptId) || seenSide.has(promptId) || !asString(row?.output || row?.text || row?.content)) errors.push(`generation-eval ${side} 输出绑定无效：${promptId || '(空)'}`);
      seenSide.add(promptId);
    }
    if (seenSide.size !== expectedIds.size) errors.push(`generation-eval ${side} 未覆盖全部固定 prompt`);
  }
  const pairRows = Array.isArray(data.pairs) ? data.pairs : [];
  if (pairRows.length) {
    if (pairRows.length !== expectedIds.size) errors.push('generation-eval pairs 行数与固定 prompt 集不一致');
    const seenPairs = new Set();
    for (const row of pairRows) {
      const promptId = asString(row?.promptId);
      if (!expectedIds.has(promptId) || seenPairs.has(promptId) || row?.evalId !== `eval-${promptId}`) {
        errors.push(`generation-eval pairs 未与 promptId/evalId 正确绑定：${promptId || '(空)'}`);
      }
      seenPairs.add(promptId);
    }
    if (seenPairs.size !== expectedIds.size) errors.push('generation-eval pairs 未覆盖全部固定 prompt');
  }
  return { pass: errors.length === 0, errors: [...new Set(errors)] };
}

function defaultOutputPaths(outputDir) {
  return {
    reviewsPath: path.join(outputDir, 'human-reviews.jsonl'),
    feedbackScoresPath: path.join(outputDir, 'feedback-scores.jsonl'),
    failureCasesPath: path.join(outputDir, 'failure-cases.jsonl'),
    sampleFeedbackPath: path.join(outputDir, 'sample-feedback.jsonl'),
    ruleFeedbackPath: path.join(outputDir, 'rule-feedback.jsonl'),
    retrievalFeedbackPath: path.join(outputDir, 'retrieval-feedback.jsonl'),
    reportPath: path.join(outputDir, 'feedback-report.json'),
    reportMarkdownPath: path.join(outputDir, 'feedback-report.md'),
    checkpointPath: path.join(outputDir, 'feedback-checkpoint.json')
  };
}

function feedbackMarkdown(report) {
  return [
    '# Generation Feedback Report',
    '',
    `状态：${report.status}`,
    `可声明：${report.claimable ? '是' : '否'}`,
    '',
    '## Pending',
    '',
    `- 数量：${report.pending.count}`,
    `- Eval IDs：${report.pending.evalIds.join(', ') || '无'}`,
    '',
    '## 人工指标',
    '',
    '```json',
    JSON.stringify(report.metrics, null, 2),
    '```',
    '',
    '## 失败分类',
    '',
    '```json',
    JSON.stringify(report.failureCases, null, 2),
    '```',
    ''
  ].join('\n');
}

function collectReviews(reviewPath) {
  const input = readJsonl(reviewPath);
  return { rows: input.rows.map(row => normalizeHumanReview(row)).filter(Boolean), errors: input.errors };
}

export function runGenerationFeedback(options = {}) {
  const data = options.data || loadGenerationEvaluationData(options);
  const outputDir = options.outputDir || path.dirname(options.reviewsPath || path.join(DEFAULT_EVAL_DIR, 'human-reviews.jsonl'));
  const outputPaths = { ...defaultOutputPaths(outputDir), ...(options.outputPaths || {}) };
  const previous = options.existingReviews || (options.resume === false ? [] : readJsonl(outputPaths.reviewsPath).rows.map(row => normalizeHumanReview(row)));
  const reviewInput = options.reviewsPath ? collectReviews(options.reviewsPath) : { rows: [], errors: [] };
  const incoming = options.reviews || reviewInput.rows;
  const reviews = mergeReviewLedger(previous, incoming);
  const rows = buildFeedbackRows({ prompts: data.prompts, pairs: data.pairs, scores: data.scores, reviews });
  const report = buildFeedbackReport({ data, rows, reviews, paths: data.paths });
  const sourceValidation = validateSourceEvaluationData(data);
  report.inputErrors = [...(data.errors || []), ...reviewInput.errors, ...sourceValidation.errors];
  report.status = report.inputErrors.length ? 'pending' : report.status;
  report.claimable = report.inputErrors.length === 0 && report.claimable;
  report.gates.sourceEvaluation = { pass: sourceValidation.pass, errors: sourceValidation.errors };
  report.gates.inputIntegrity = { pass: report.inputErrors.length === 0, value: report.inputErrors.length };
  report.gates.claimable.pass = report.claimable;
  const flatFeedback = { samples: [], rules: [], retrieval: [] };
  const failures = [];
  for (const row of rows) {
    failures.push(...row.failureCases);
    for (const type of Object.keys(flatFeedback)) flatFeedback[type].push(...(row.feedback?.[type] || []));
  }
  const result = { pass: report.inputErrors.length === 0 && report.claimable === true, data, reviews, rows, report, paths: outputPaths };
  if (options.write) {
    writeText(outputPaths.reviewsPath, jsonl(reviews));
    writeText(outputPaths.feedbackScoresPath, jsonl(rows));
    writeText(outputPaths.failureCasesPath, jsonl(failures));
    writeText(outputPaths.sampleFeedbackPath, jsonl(flatFeedback.samples));
    writeText(outputPaths.ruleFeedbackPath, jsonl(flatFeedback.rules));
    writeText(outputPaths.retrievalFeedbackPath, jsonl(flatFeedback.retrieval));
    writeJson(outputPaths.reportPath, report);
    writeText(outputPaths.reportMarkdownPath, feedbackMarkdown(report));
    writeJson(outputPaths.checkpointPath, report.checkpoint);
  }
  return result;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('用法：node scripts/generation-feedback.mjs [--write] [--eval-dir path] [--reviews path] [--out-dir path]');
    return 0;
  }
  const evalDir = options['eval-dir'] ? path.resolve(process.cwd(), String(options['eval-dir'])) : DEFAULT_EVAL_DIR;
  const outputDir = options['out-dir'] ? path.resolve(process.cwd(), String(options['out-dir'])) : evalDir;
  const result = runGenerationFeedback({
    evalDir,
    promptsPath: options.prompts ? path.resolve(process.cwd(), String(options.prompts)) : undefined,
    pairsPath: options.pairs ? path.resolve(process.cwd(), String(options.pairs)) : undefined,
    scoresPath: options.scores ? path.resolve(process.cwd(), String(options.scores)) : undefined,
    reportPath: options.report ? path.resolve(process.cwd(), String(options.report)) : undefined,
    metricsPath: options.metrics ? path.resolve(process.cwd(), String(options.metrics)) : undefined,
    reviewsPath: (options.reviews || options.review || options.feedback) ? path.resolve(process.cwd(), String(options.reviews || options.review || options.feedback)) : undefined,
    outputDir,
    resume: options.resume !== false,
    write: options.write === true
  });
  console.log(JSON.stringify({
    pass: result.pass,
    status: result.report.status,
    claimable: result.report.claimable,
    scoredPairCount: result.report.metrics.scoredPairCount,
    pendingPairCount: result.report.metrics.pendingPairCount,
    outputs: options.write === true ? result.paths : null
  }, null, 2));
  return result.pass ? 0 : 1;
}

if (path.resolve(process.argv[1] || '') === SCRIPT_PATH) process.exitCode = main();

export {
  DEFAULT_EVAL_DIR,
  FAILURE_CATEGORIES,
  RETRIEVAL_ISSUES,
  SCORE_KEYS
};
