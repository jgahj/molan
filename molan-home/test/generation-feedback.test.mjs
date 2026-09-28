import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildFeedbackReport,
  buildFeedbackRows,
  classifyFailureCases,
  mergeReviewLedger,
  normalizeHumanReview,
  runGenerationFeedback
} from '../scripts/generation-feedback.mjs';
import { buildPromptSet } from '../scripts/generation-eval.mjs';
import {
  buildRollbackPlan,
  evaluateReleaseGates,
  prepareRelease,
  resolveContainedPath,
  validateRollbackTarget
} from '../scripts/release-version.mjs';

function score(value) {
  return {
    naturalness: value,
    individuality: value,
    subtext: value,
    dialogue: value,
    emotionalEffect: value,
    readability: value,
    aiFlavor: value
  };
}

function evalData(count = 2) {
  const prompts = buildPromptSet().slice(0, count);
  const scores = prompts.map(prompt => ({
    evalId: `eval-${prompt.promptId}`,
    promptId: prompt.promptId,
    status: 'scored',
    blindOrder: ['A', 'B'],
    evaluator: 'deterministic-proxy-v1',
    scores: { A: score(3), B: score(4) }
  }));
  const baseline = prompts.map(prompt => ({ promptId: prompt.promptId, output: '她看了看门口，把手机放回桌上，过了一会儿才开口说明自己的决定。' }));
  const material = prompts.map(prompt => ({ promptId: prompt.promptId, output: '她先核对桌上的文件，又把杯子移到手边。“你说吧。”她抬头看着对方，没有急着回答。' }));
  const complete = count === 60;
  const metrics = {
    evaluationVersion: 'molan-character-generation-eval-v3.1-stage0.5',
    stageId: '0.5',
    evaluator: 'deterministic-proxy-v1',
    promptCount: count,
    completePairCount: count,
    pendingPairCount: 0,
    claimable: false,
  };
  return {
    prompts,
    pairs: [],
    scores,
    baseline,
    material,
    metrics: complete ? metrics : { ...metrics, promptCount: count },
    report: {
      reportVersion: 'molan-character-generation-report-v3.1-stage0.5',
      stageId: '0.5',
      status: 'proxy-only',
      claimable: false,
      promptValidation: { pass: complete },
      inputs: {
        baseline: { available: true, rowCount: count, errorCount: 0, missing: false },
        material: { available: true, rowCount: count, errorCount: 0, missing: false },
      },
      metrics,
      inputErrors: [],
    },
    errors: [],
    paths: {},
  };
}

function review(promptId, value = 4, extra = {}) {
  return normalizeHumanReview({
    promptId,
    reviewerId: 'reviewer-1',
    winner: 'B',
    scores: { A: score(value - 1), B: score(value) },
    ...extra
  });
}

test('human review normalizes prompt ids and keeps missing pair/review pending', () => {
  const data = evalData(2);
  const rows = buildFeedbackRows({ prompts: data.prompts, scores: data.scores, reviews: [review('prompt-001')] });
  assert.equal(rows[0].evalId, 'eval-prompt-001');
  assert.equal(rows[0].status, 'scored');
  assert.equal(rows[0].claimable, true);
  assert.equal(rows[1].status, 'pending');
  assert.deepEqual(rows[1].pendingReason, ['human_review_missing']);

  const report = buildFeedbackReport({ data, rows, reviews: [review('prompt-001')] });
  assert.equal(report.status, 'pending');
  assert.equal(report.claimable, false);
  assert.equal(report.metrics.scoredPairCount, 1);
  assert.equal(report.metrics.claimableMetrics, null);
});

test('feedback ledger resumes idempotently and stores failure/sample/rule/retrieval feedback', () => {
  const data = evalData(60);
  const first = review('prompt-001', 4, {
    failureCases: [{ caseId: 'case-1', categories: ['dialogue'], severity: 'major', summary: '对白僵硬' }],
    feedback: {
      samples: [{ sampleId: 'sample-1', action: 'revise', reason: '补充动作细节' }],
      rules: [{ ruleId: 'rule-1', action: 'tighten', reason: '约束不够明确' }],
      retrieval: [{ query: '人物状态', issue: 'missed', sourceRef: 'unit-1', reason: '漏召回' }]
    }
  });
  const ledger = data.prompts.map(prompt => prompt.promptId === 'prompt-001' ? first : review(prompt.promptId));
  const same = normalizeHumanReview({ ...first, recordedAt: first.recordedAt });
  assert.equal(mergeReviewLedger(ledger, [same]).length, data.prompts.length);
  const result = runGenerationFeedback({ data, existingReviews: ledger, write: false });
  assert.equal(result.report.claimable, true);
  assert.equal(result.report.failureCases.byCategory.dialogue, 1);
  assert.equal(result.report.feedback.samples.length, 1);
  assert.equal(result.report.feedback.rules.length, 1);
  assert.equal(result.report.feedback.retrieval[0].issue, 'missed');
  assert.equal(result.report.checkpoint.resumable, true);
  assert.deepEqual(classifyFailureCases(result.rows).bySeverity, { blocking: 0, major: 1, minor: 0 });
});

test('invalid human scores are pending and detector fields cannot make them claimable', () => {
  const data = evalData(1);
  const invalid = normalizeHumanReview({
    promptId: 'prompt-001',
    reviewerId: 'reviewer-1',
    winner: 'B',
    evaluator: 'ai-detector',
    aiDetector: { pass: true },
    scores: { A: score(3), B: { ...score(4), dialogue: 9 } }
  });
  const result = runGenerationFeedback({ data, reviews: [invalid], write: false });
  assert.equal(result.rows[0].status, 'pending');
  assert.equal(result.report.claimable, false);
  assert.equal(result.report.metrics.source, 'human-blind-review');
});

test('missing reviewer identity or detector/model identity cannot claim feedback', () => {
  const data = evalData(1);
  const missingReviewer = normalizeHumanReview({
    promptId: 'prompt-001',
    winner: 'B',
    scores: { A: score(3), B: score(4) },
  });
  assert.equal(missingReviewer.status, 'pending');
  assert.ok(missingReviewer.pendingReason.includes('缺少 reviewerId'));
  assert.equal(runGenerationFeedback({ data, reviews: [missingReviewer], write: false }).report.claimable, false);

  const forgedNormalized = {
    reviewId: 'forged-review',
    evalId: 'eval-prompt-001',
    promptId: 'prompt-001',
    reviewerId: 'reviewer-1',
    status: 'scored',
    winner: 'B',
    scores: { A: score(3), B: score(4) },
    model: 'gpt-test',
    source: 'human-blind-review',
  };
  const detectorResult = runGenerationFeedback({ data, reviews: [forgedNormalized], write: false });
  assert.equal(detectorResult.rows[0].status, 'pending');
  assert.equal(detectorResult.report.claimable, false);
});

test('pending generation-eval reports and mismatched source inputs cannot claim feedback', () => {
  const data = evalData(60);
  const reviews = data.prompts.map(prompt => review(prompt.promptId));
  const pendingReport = runGenerationFeedback({
    data: { ...data, report: { ...data.report, status: 'pending' } },
    reviews,
    write: false,
  });
  assert.equal(pendingReport.report.claimable, false);
  assert.ok(pendingReport.report.inputErrors.some(error => error.includes('pending')));

  for (const mutate of [
    value => ({ ...value, baseline: [{ ...value.baseline[0], promptId: 'prompt-999' }, ...value.baseline.slice(1)] }),
    value => ({ ...value, material: [{ ...value.material[0], promptId: 'prompt-999' }, ...value.material.slice(1)] }),
    value => ({ ...value, scores: [{ ...value.scores[0], evalId: 'eval-wrong' }, ...value.scores.slice(1)] }),
    value => ({ ...value, metrics: { ...value.metrics, promptCount: 59 } }),
    value => ({ ...value, report: { ...value.report, metrics: { ...value.report.metrics, completePairCount: 59 } } }),
  ]) {
    const result = runGenerationFeedback({ data: mutate(data), reviews, write: false });
    assert.equal(result.report.claimable, false);
    assert.ok(result.report.inputErrors.length > 0);
  }
});

test('release gates require complete human feedback and explicit compatibility/security passes', () => {
  const feedbackReport = {
    reportVersion: 'molan-generation-feedback-v1',
    status: 'scored',
    claimable: true,
    inputErrors: [],
    source: {
      generationEval: 'scripts/generation-eval.mjs',
      reportVersion: 'molan-character-generation-report-v3.1-stage0.5',
    },
    reviewCount: 60,
    reviewerIds: ['reviewer-1'],
    qualityGate: { pass: true },
    metrics: {
      source: 'human-blind-review',
      evidencePolicy: { humanReviewRequired: true, aiDetectorSoleBasis: false },
      claimable: true,
      scoredPairCount: 60,
      pendingPairCount: 0,
      meanDelta: { naturalness: 0, individuality: 1, subtext: 0, dialogue: 1, emotionalEffect: 0, readability: 0, aiFlavor: -1 },
    },
    gates: {
      sourceEvaluation: { pass: true },
      inputIntegrity: { pass: true },
      realHumanScoredData: { pass: true },
      noPendingPairs: { pass: true },
      failureCasesClassified: { pass: true },
      claimable: { pass: true },
      qualityNonInferiority: { pass: true },
    }
  };
  assert.equal(evaluateReleaseGates({ feedbackReport, compatibility: { pass: true }, security: { pass: true } }).pass, true);
  assert.equal(evaluateReleaseGates({ feedbackReport: { ...feedbackReport, status: 'pending' }, compatibility: { pass: true }, security: { pass: true } }).pass, false);
  assert.equal(evaluateReleaseGates({ feedbackReport: { ...feedbackReport, reviewerIds: [] }, compatibility: { pass: true }, security: { pass: true } }).pass, false);
  assert.equal(evaluateReleaseGates({ feedbackReport: { ...feedbackReport, reviewerIds: ['model-reviewer'] }, compatibility: { pass: true }, security: { pass: true } }).pass, false);
});

test('rollback only accepts an existing registered manifest with matching gates and identity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-release-'));
  try {
    const manifestPath = path.join(root, 'v1.0.0', 'manifest.json');
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    const manifest = { version: 'v1.0.0', status: 'released', gates: { compatibility: { pass: true }, security: { pass: true } } };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
    const hash = crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex');
    const registry = { versions: [{ version: 'v1.0.0', status: 'released', manifestPath: 'v1.0.0/manifest.json', compatibility: { pass: true }, security: { pass: true }, manifestSha256: hash }] };
    const valid = validateRollbackTarget({ targetVersion: 'v1.0.0', registry, versionsRoot: root });
    assert.equal(valid.pass, true);
    const plan = buildRollbackPlan({ currentVersion: 'v2.0.0', targetVersion: 'v1.0.0', targetValidation: valid });
    assert.equal(plan.targetVersion, 'v1.0.0');
    assert.equal(plan.auditable, true);

    assert.equal(resolveContainedPath(root, '../outside').pass, false);
    assert.equal(validateRollbackTarget({ targetVersion: 'v9.9.9', registry, versionsRoot: root }).pass, false);
    const forged = validateRollbackTarget({
      targetVersion: 'v1.0.0',
      registry: { versions: [{ ...registry.versions[0], manifestPath: 'v1.0.0/manifest.json', manifestSha256: '0'.repeat(64) }] },
      versionsRoot: root
    });
    assert.equal(forged.pass, false);

    assert.equal(validateRollbackTarget({
      targetVersion: 'v1.0.0',
      registry: { versions: [{ ...registry.versions[0], manifestSha256: undefined }] },
      versionsRoot: root,
    }).pass, false);
    assert.equal(validateRollbackTarget({
      targetVersion: 'v1.0.0',
      registry: { versions: [{ ...registry.versions[0], status: undefined }] },
      versionsRoot: root,
    }).pass, false);
    fs.writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, status: undefined })}\n`, 'utf8');
    assert.equal(validateRollbackTarget({ targetVersion: 'v1.0.0', registry, versionsRoot: root }).pass, false);
    assert.throws(() => buildRollbackPlan({
      currentVersion: 'v2.0.0',
      targetVersion: 'v1.0.0',
      targetValidation: { ...valid, manifestHashVerified: false },
    }), /未验证/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('blocked release does not create a rollback plan or claim a release', () => {
  const targetValidation = { pass: true, version: 'v1.0.0', manifestPath: '/versions/v1.0.0/manifest.json', entry: { status: 'released' } };
  const result = prepareRelease({
    version: 'v2.0.0',
    feedbackReport: { status: 'pending', claimable: false, metrics: { claimable: false } },
    compatibility: { pass: true },
    security: { pass: true },
    rollbackTarget: targetValidation
  });
  assert.equal(result.pass, false);
  assert.equal(result.manifest.status, 'blocked');
  assert.equal(result.rollbackPlan, null);
});

test('generation feedback CLI writes a resumable scored report', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-feedback-cli-'));
  try {
    const evalDir = path.join(root, 'eval');
    const outDir = path.join(root, 'feedback');
    const reviewPath = path.join(root, 'reviews.jsonl');
    fs.mkdirSync(evalDir, { recursive: true });
    const data = evalData(60);
    const writeJsonl = (filePath, rows) => fs.writeFileSync(filePath, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`, 'utf8');
    writeJsonl(path.join(evalDir, 'prompts.jsonl'), data.prompts);
    writeJsonl(path.join(evalDir, 'baseline.jsonl'), data.baseline);
    writeJsonl(path.join(evalDir, 'material.jsonl'), data.material);
    writeJsonl(path.join(evalDir, 'scores.jsonl'), data.scores);
    fs.writeFileSync(path.join(evalDir, 'metrics.json'), `${JSON.stringify(data.metrics)}\n`, 'utf8');
    fs.writeFileSync(path.join(evalDir, 'report.json'), `${JSON.stringify(data.report)}\n`, 'utf8');
    writeJsonl(reviewPath, data.prompts.map(prompt => ({ promptId: prompt.promptId, reviewerId: 'reviewer-1', winner: 'B', scores: { A: score(3), B: score(4) } })));
    const scriptPath = fileURLToPath(new URL('../scripts/generation-feedback.mjs', import.meta.url));
    const run = spawnSync(process.execPath, [scriptPath, '--write', '--eval-dir', evalDir, '--reviews', reviewPath, '--out-dir', outDir], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(fs.readFileSync(path.join(outDir, 'feedback-report.json'), 'utf8'));
    assert.equal(report.status, 'scored');
    assert.equal(report.claimable, true);
    assert.equal(report.checkpoint.resumable, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
