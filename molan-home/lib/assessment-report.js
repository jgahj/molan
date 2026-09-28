'use strict';

const { checkValidityGate } = require('./evaluation-validity-gate');

const ARRAY_FIELDS = [
  'architecture', 'corpusPools', 'generationRuns', 'metrics', 'evidence', 'issues',
  'gapMatrix', 'rootCauseHypotheses', 'patches', 'iterationLedger', 'limitations'
];

const BLIND_REVIEW_STATUSES = new Set(['reviewed', 'pending_review', 'not_applicable', 'invalid']);

function hanCharacterCount(value) {
  return [...String(value || '')].filter(char => /\p{Script=Han}/u.test(char)).length;
}

function normalizeEvidence(items, unknowns) {
  return (Array.isArray(items) ? items : []).filter(item => item && typeof item === 'object').map((item, index) => {
    const quote = typeof item.quote === 'string' ? item.quote : null;
    const quoteAllowed = quote === null || hanCharacterCount(quote) <= 20;
    if (!quoteAllowed) unknowns.push(`evidence[${index}].quote_exceeds_20_han_characters`);
    const evidenceId = item.evidenceId || item.evidence_id || null;
    const sourceFile = item.sourceFile || item.source_file || null;
    const textHash = item.textHash || item.text_hash || null;
    const runId = item.runId || item.run_id || item.taskId || item.task_id || null;
    const taskId = item.taskId || item.task_id || item.runId || item.run_id || null;
    const chapterIndex = Number.isInteger(item.chapterIndex) ? item.chapterIndex
      : Number.isInteger(item.chapter_index) ? item.chapter_index : null;
    const paragraphIndex = Number.isInteger(item.paragraphIndex) ? item.paragraphIndex
      : Number.isInteger(item.paragraph_index) ? item.paragraph_index : null;
    if (!evidenceId) unknowns.push(`evidence[${index}].evidenceId`);
    if (!runId || !taskId) unknowns.push(`evidence[${index}].runId_or_taskId`);
    if (!sourceFile) unknowns.push(`evidence[${index}].sourceFile`);
    if (!textHash) unknowns.push(`evidence[${index}].textHash`);
    if (chapterIndex === null) unknowns.push(`evidence[${index}].chapterIndex`);
    if (paragraphIndex === null) unknowns.push(`evidence[${index}].paragraphIndex`);
    if (quote === null) unknowns.push(`evidence[${index}].quote`);
    return {
      evidenceId,
      runId,
      taskId,
      sourceFile,
      textHash,
      chapterIndex,
      paragraphIndex,
      quote: quoteAllowed ? quote : null,
      verified: quoteAllowed && item.verified === true && Boolean(
        evidenceId && runId && taskId && sourceFile && textHash && chapterIndex !== null &&
        paragraphIndex !== null && quote !== null
      ),
      supports: Array.isArray(item.supports) ? item.supports.map(String) : []
    };
  });
}

function sectionValue(input, key, fallback) {
  return input && input[key] !== undefined && input[key] !== null ? input[key] : fallback;
}

function buildAssessmentReport(input = {}) {
  const unknowns = Array.isArray(input.unknowns) ? input.unknowns.map(String) : [];
  const evidence = normalizeEvidence(input.evidence, unknowns);
  const validity = input.validity && typeof input.validity === 'object'
    ? input.validity
    : {
      mode: input.evaluation_mode,
      checks: input.validity_checks,
      invalidityFindings: input.invalidity_findings,
      genreMapping: input.genre_mapping
    };
  const gate = checkValidityGate({
    mode: validity.mode,
    checks: validity.checks,
    evidenceIds: evidence.filter(item => item.verified).map(item => item.evidenceId),
    invalidityFindings: validity.invalidityFindings,
    genreMapping: validity.genreMapping
  });

  for (const checkId of gate.missing_checks) unknowns.push(`validity_checks.${checkId}`);
  for (const code of gate.unverified_invalidity_findings) unknowns.push(`invalidity_findings.${code}`);
  if (!input || !Object.keys(input).length) unknowns.push('assessment_input_not_provided');
  for (const field of ARRAY_FIELDS) {
    if (!Array.isArray(input[field])) unknowns.push(`${field}:NOT_PROVIDED`);
  }
  if (!input.experimentPlan || typeof input.experimentPlan !== 'object') unknowns.push('experimentPlan:NOT_PROVIDED');

  const blindReview = input.blindReview && typeof input.blindReview === 'object' ? input.blindReview : {};
  const blindStatus = BLIND_REVIEW_STATUSES.has(blindReview.status) ? blindReview.status : 'pending_review';

  const report = {
    schemaVersion: 'molan-assessment-v1',
    evaluationStatus: gate.evaluation_status,
    generatedAt: new Date().toISOString(),
    executiveSummary: sectionValue(input, 'executiveSummary', 'UNKNOWN'),
    scope: sectionValue(input, 'scope', {}),
    provenance: sectionValue(input, 'provenance', {}),
    architecture: sectionValue(input, 'architecture', []),
    corpusPools: sectionValue(input, 'corpusPools', []),
    generationRuns: sectionValue(input, 'generationRuns', []),
    metrics: sectionValue(input, 'metrics', []),
    blindReview: {
      status: blindStatus,
      pairedPreference: sectionValue(blindReview, 'pairedPreference', {}),
      dimensionResults: sectionValue(blindReview, 'dimensionResults', []),
      stateChecks: sectionValue(blindReview, 'stateChecks', [])
    },
    evidence,
    issues: sectionValue(input, 'issues', []),
    gapMatrix: sectionValue(input, 'gapMatrix', []),
    rootCauseHypotheses: sectionValue(input, 'rootCauseHypotheses', []),
    patches: sectionValue(input, 'patches', []),
    experimentPlan: sectionValue(input, 'experimentPlan', {}),
    iterationLedger: sectionValue(input, 'iterationLedger', []),
    unknowns: [...new Set(unknowns)],
    limitations: sectionValue(input, 'limitations', []),
    validityGate: gate
  };

  return report;
}

function display(value) {
  if (value === null || value === undefined) return 'UNKNOWN';
  if (typeof value === 'string') return value || 'UNKNOWN';
  if (Array.isArray(value) && !value.length) return 'UNKNOWN';
  if (typeof value === 'object' && !Object.keys(value).length) return 'UNKNOWN';
  return '```json\n' + JSON.stringify(value, null, 2) + '\n```';
}

function renderAssessmentMarkdown(report) {
  const sections = [
    ['Evaluation Status', { status: report.evaluationStatus, validityGate: report.validityGate }],
    ['Executive Summary', report.executiveSummary],
    ['Scope & Data Provenance', { scope: report.scope, provenance: report.provenance }],
    ['Actual Project Architecture', report.architecture],
    ['Corpus & Benchmark Pools', report.corpusPools],
    ['Generation Run Inventory', report.generationRuns],
    ['Deterministic Quality Vector', report.metrics],
    ['Blind Review Results', report.blindReview],
    ['Evidence-Backed Strengths & Issues P0-P3', {
      strengths: report.evidence,
      issues: report.issues
    }],
    ['Gap Matrix', report.gapMatrix],
    ['Root Cause Diagnosis', report.rootCauseHypotheses],
    ['Optimization Patch Drafts', report.patches],
    ['Next Experiment Plan', report.experimentPlan],
    ['Iteration Ledger', report.iterationLedger],
    ['Unknowns, Limitations & Required Human Decisions', {
      unknowns: report.unknowns,
      limitations: report.limitations
    }]
  ];

  return [
    '# 墨阑质量评测整合报告',
    '',
    ...sections.flatMap(([title, value], index) => [
      `## ${index + 1}. ${title}`,
      '',
      display(value),
      ''
    ])
  ].join('\n');
}

module.exports = {
  buildAssessmentReport,
  renderAssessmentMarkdown
};
