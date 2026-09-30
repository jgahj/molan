'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { hashJson } = require('../lib/evolution/replay-manifest');
const { QUALITY_DIMENSIONS } = require('../lib/quality-vectors');
const { DEFAULT_POLICY } = require('../lib/evolution/regression-gate');
const { INPUT_SCHEMA, compareQualityVectors } = require('../lib/evolution/quality-vector-ab');

/** 构造 80 条固定输入的离线评测夹具，不代表真实模型评测结果。 */
function fixture() {
  const tasks = Array.from({ length: 80 }, (_, index) => {
    const taskId = `case-${String(index + 1).padStart(3, '0')}`;
    const inputHash = String(index + 1).toString(16).padStart(64, '0');
    const values = Object.fromEntries(QUALITY_DIMENSIONS.map(dimension => [
      dimension,
      dimension === 'ai_flavor' ? 0.25 : 0.7
    ]));
    const makeRun = (arm, candidate) => {
      const nextValues = { ...values };
      nextValues.dialogue = candidate ? 0.75 : 0.7;
      nextValues.plot = candidate ? 0.71 : 0.7;
      nextValues.ai_flavor = candidate ? 0.24 : 0.25;
      const dimensions = Object.fromEntries(QUALITY_DIMENSIONS.map(dimension => [dimension, {
        value: nextValues[dimension],
        status: 'HUMAN_REVIEWED',
        evidence_refs: [`${arm}:${taskId}:${dimension}`]
      }]));
      return {
        generationId: `${arm}-${taskId}`,
        outputHash: 'a'.repeat(64),
        qualityVector: { schemaVersion: 'quality-vector-v2', values: nextValues, dimensions },
        cost: { amount: 0.01, currency: 'USD', evidence_refs: [`cost:${arm}:${taskId}`] }
      };
    };
    return {
      task_id: taskId,
      genre: ['玄幻', '都市', '悬疑', '言情', '历史', '科幻', '西幻', '轻小说'][index % 8],
      input_hash: inputHash,
      baseline: makeRun('baseline', false),
      candidate: makeRun('candidate', true)
    };
  });
  const golden = {
    schemaVersion: 'quality-ab-golden-manifest-v1',
    fixtureStatus: 'ready',
    dataStatus: 'complete',
    taskCount: tasks.length,
    tasks: tasks.map(({ task_id, genre, input_hash }) => ({ task_id, genre, input_hash }))
  };
  golden.manifestHash = hashJson(golden);
  return {
    schemaVersion: INPUT_SCHEMA,
    evaluationMode: 'saved_results_only',
    binding: {
      model: 'fixture-model',
      modelParametersHash: 'b'.repeat(64),
      evaluatorVersion: 'fixture-evaluator-v1',
      reviewerVersion: 'fixture-reviewer-v1'
    },
    versions: {
      baseline: { pipelineVersion: 'p1', promptVersion: 'r1', genreProfileVersion: 'g1', styleVersion: 's1' },
      candidate: { pipelineVersion: 'p2', promptVersion: 'r2', genreProfileVersion: 'g1', styleVersion: 's1' }
    },
    scoreScale: 1,
    golden,
    targetDimensions: ['dialogue'],
    tasks,
    safety_gate: {
      categoryResults: Object.fromEntries(DEFAULT_POLICY.categories.map(category => [category, {
        status: 'PASS', evidence_refs: [`category:${category}`]
      }])),
      metricValues: {
        continuity: { baseline: 0.9, candidate: 0.9, evidence_refs: ['safety:continuity'] },
        originality: { baseline: 0.8, candidate: 0.8, evidence_refs: ['safety:originality'] },
        genreFit: { baseline: 90, candidate: 90, evidence_refs: ['safety:genre'] },
        styleFit: { baseline: 90, candidate: 90, evidence_refs: ['safety:style'] },
        stability: { baseline: 0.99, candidate: 0.99, evidence_refs: ['safety:stability'] }
      }
    }
  };
}

test('quality vector A/B accepts complete comparable evidence only after the existing gate passes', () => {
  const input = fixture();
  const report = compareQualityVectors(input);
  const replay = compareQualityVectors(input);
  assert.equal(report.status, 'PROMOTION_READY');
  assert.equal(report.promotionEligible, true);
  assert.equal(report.inputHash, hashJson(input));
  assert.equal(report.reportHash, replay.reportHash);
  assert.equal(report.dimensions.length, QUALITY_DIMENSIONS.length);
  assert.equal(report.existingRegressionGate.status, 'PASS');
  assert.equal(report.dimensions.find(item => item.dimension === 'dialogue').signed_improvement, 0.05);
});

test('missing or estimated dimension evidence blocks promotion without filling a score', () => {
  const input = fixture();
  input.tasks[0].candidate.qualityVector.dimensions.opening.evidence_refs = [];
  input.tasks[1].baseline.qualityVector.dimensions.plot.status = 'ESTIMATED';
  const report = compareQualityVectors(input);
  assert.equal(report.status, 'BLOCKED');
  assert.equal(report.dimensions.find(item => item.dimension === 'opening').candidate, null);
  assert.ok(report.blockingReasons.includes('dimension_blocked:opening'));
  assert.ok(report.blockingReasons.includes('dimension_blocked:plot'));
});

test('a decline above 0.03 or an unchanged target cannot be promoted', () => {
  const input = fixture();
  for (const task of input.tasks) {
    task.candidate.qualityVector.values.relationship = 0.66;
    task.candidate.qualityVector.dimensions.relationship.value = 0.66;
  }
  const report = compareQualityVectors(input);
  assert.equal(report.status, 'REJECTED');
  assert.ok(report.blockingReasons.includes('dimension_decline_exceeded:relationship'));

  const unchanged = fixture();
  for (const task of unchanged.tasks) {
    task.candidate.qualityVector.values.dialogue = 0.7;
    task.candidate.qualityVector.dimensions.dialogue.value = 0.7;
  }
  const unchangedReport = compareQualityVectors(unchanged);
  assert.equal(unchangedReport.status, 'REJECTED');
  assert.ok(unchangedReport.blockingReasons.includes('target_dimension_not_improved:dialogue'));
});

test('versions, task snapshots, and the existing safety gate must remain comparable', () => {
  const input = fixture();
  input.versions.candidate.promptVersion = '';
  input.tasks[0].input_hash = 'c'.repeat(64);
  input.safety_gate.metricValues.continuity.candidate = 0.89;
  const report = compareQualityVectors(input);
  assert.equal(report.status, 'REJECTED');
  assert.ok(report.blockingReasons.includes('version_missing:candidate:promptVersion'));
  assert.ok(report.blockingReasons.includes('paired_input_mismatch:case-001'));
  assert.equal(report.existingRegressionGate.status, 'REJECT');
});

test('schema and fixed corpus provenance are mandatory and incomplete evidence stays blocked', () => {
  const input = fixture();
  input.evaluationMode = 'live';
  input.golden.fixtureStatus = 'test_fixture';
  input.binding.modelParametersHash = '';
  const report = compareQualityVectors(input);
  assert.equal(report.status, 'BLOCKED');
  assert.ok(report.blockingReasons.includes('live_evaluation_not_supported'));
  assert.ok(report.blockingReasons.includes('golden_corpus_not_ready'));
  assert.ok(report.blockingReasons.includes('binding_missing:modelParametersHash'));
});

test('offline CLI writes a new report and refuses to overwrite it', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-quality-ab-'));
  const inputPath = path.join(directory, 'input.json');
  const reportPath = path.join(directory, 'report.json');
  const cliPath = path.resolve(__dirname, '../scripts/compare-quality-vectors.mjs');
  try {
    fs.writeFileSync(inputPath, JSON.stringify(fixture()), 'utf8');
    const first = spawnSync(process.execPath, ['--no-warnings', cliPath, '--input', inputPath, '--out', reportPath], { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(fs.readFileSync(reportPath, 'utf8')).status, 'PROMOTION_READY');
    const second = spawnSync(process.execPath, ['--no-warnings', cliPath, '--input', inputPath, '--out', reportPath], { encoding: 'utf8' });
    assert.equal(second.status, 1);
    assert.match(second.stderr, /already exists|已存在/i);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
