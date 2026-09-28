import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  PIPELINE_ARTIFACT_MAP,
  PIPELINE_STAGES,
  STAGE_DEPENDENCIES,
  artifactState,
  buildPipelineState
} from '../scripts/run-character-material-pipeline.mjs';

function writeFile(root, relative, content) {
  const filePath = path.join(root, relative);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeJson(root, relative, value) {
  writeFile(root, relative, `${JSON.stringify(value)}\n`);
}

function writeJsonl(root, relative, rows) {
  writeFile(root, relative, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
}

function stage(stageId) {
  return PIPELINE_STAGES.find(item => item.id === stageId);
}

function runtimeIndex() {
  return {
    published: true,
    general: {
      rules: [],
      samples: [{ id: 'sample-1', text: '这是一段超过十二字的合法运行时样本。', residualTerms: [] }]
    },
    mature: { rules: [], samples: [] },
    audit: {
      compatibilityBuilder: {
        compatibleSampleCount: 1,
        rejectedSampleCount: 0,
        residualTermsRequired: true,
        sampleChars: [12, 140]
      }
    }
  };
}

function passValue(spec, stageId) {
  if (spec.policy === 'compatibility-index' || spec.policy === 'runtime-index') return runtimeIndex();
  if (spec.policy === 'eval-report') return {
    pass: true,
    stageId,
    promptValidation: { pass: true },
    metrics: { promptCount: 60, completePairCount: 60, pendingPairCount: 0 }
  };
  if (spec.policy === 'feedback-report') return {
    status: 'scored',
    claimable: true,
    metrics: {
      source: 'human-blind-review',
      evidencePolicy: { humanReviewRequired: true },
      scoredPairCount: 60,
      pendingPairCount: 0,
      claimable: true
    },
    gates: {
      realHumanScoredData: { pass: true },
      noPendingPairs: { pass: true },
      failureCasesClassified: { pass: true },
      claimable: { pass: true }
    },
    qualityGate: { pass: true }
  };
  if (spec.policy === 'release-manifest') return {
    version: 'v3.1.0',
    status: 'released',
    gates: { feedback: { pass: true }, compatibility: { pass: true }, security: { pass: true } },
    rollback: { auditable: true }
  };
  if (spec.policy === 'validation') return { pass: true, status: 'pass' };
  return { pass: true };
}

function writePassStage(root, stageId) {
  for (const spec of stage(stageId).artifactSpecs) {
    if (spec.kind === 'jsonl' && spec.policy === 'prompt') {
      writeJsonl(root, spec.path, Array.from({ length: spec.minRows || 1 }, (_, index) => ({ promptId: `prompt-${String(index + 1).padStart(3, '0')}`, prompt: '固定测试 prompt' })));
    } else if (spec.kind === 'jsonl' && spec.policy === 'generation-output') {
      writeJsonl(root, spec.path, Array.from({ length: spec.minRows || 1 }, (_, index) => ({ promptId: `prompt-${String(index + 1).padStart(3, '0')}`, text: '一段完整的生成结果。' })));
    } else if (spec.kind === 'jsonl' && spec.policy === 'score') {
      writeJsonl(root, spec.path, Array.from({ length: spec.minRows || 1 }, (_, index) => ({
        evalId: `eval-prompt-${String(index + 1).padStart(3, '0')}`,
        promptId: `prompt-${String(index + 1).padStart(3, '0')}`,
        status: 'scored',
        scores: { A: { naturalness: 3 }, B: { naturalness: 4 } }
      })));
    } else {
      writeJson(root, spec.path, passValue(spec, stageId));
    }
  }
}

function writePassThrough(root, stageId) {
  const targetIndex = PIPELINE_STAGES.findIndex(item => item.id === stageId);
  for (const item of PIPELINE_STAGES.slice(0, targetIndex + 1)) writePassStage(root, item.id);
}

test('pipeline exposes the complete ordered Stage 0-18 artifact map and explicit dependencies', () => {
  const ids = PIPELINE_STAGES.map(item => item.id);
  assert.deepEqual(ids, ['0', '0.5', ...Array.from({ length: 18 }, (_, index) => String(index + 1))]);
  assert.deepEqual(STAGE_DEPENDENCIES['0.5'], ['0']);
  assert.deepEqual(STAGE_DEPENDENCIES['18'], ['17']);
  assert.equal(PIPELINE_ARTIFACT_MAP['0'].some(item => item.path.endsWith('schema-contract.snapshot.json')), true);

  const baselineReport = PIPELINE_ARTIFACT_MAP['0.5'].find(item => item.policy === 'eval-report');
  const generationReport = PIPELINE_ARTIFACT_MAP['17'].find(item => item.policy === 'eval-report');
  assert.notEqual(baselineReport.path, generationReport.path);
  assert.match(baselineReport.path, /eval[\\/]stage-0\.5[\\/]report\.json/u);
  assert.match(generationReport.path, /eval[\\/]stage-17[\\/]report\.json/u);
});

test('pipeline blocks expansion on missing evidence and records the dependency gate', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-pipeline-state-'));
  try {
    const state = buildPipelineState({ artifactRoot: root });
    assert.equal(state.pass, false);
    assert.equal(state.mayExpand, false);
    assert.equal(state.stages[0].status, 'pending');
    assert.equal(state.stages[1].status, 'blocked');
    assert.deepEqual(state.stages[1].dependsOn, ['0']);
    assert.ok(state.stages[1].reasons.some(reason => reason.includes('prerequisite')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('JSONL is read line by line and preserves pending/blocked rows instead of treating non-empty as pass', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-pipeline-jsonl-'));
  try {
    const file = path.join(root, 'rows.jsonl');
    writeJsonl(root, 'rows.jsonl', [
      { id: 'pending-row', status: 'pending' },
      { id: 'blocked-row', status: 'blocked' },
      { id: 'unknown-row', value: 'non-empty but unverified' }
    ]);
    const result = artifactState(file);
    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.rowStates.map(row => row.status), ['pending', 'blocked', 'pending']);
    assert.deepEqual(result.rows.map(row => row.id), ['pending-row', 'blocked-row', 'unknown-row']);

    writeJsonl(root, 'pending-only.jsonl', [{ id: 'pending-row', status: 'pending' }]);
    const pending = artifactState(path.join(root, 'pending-only.jsonl'));
    assert.equal(pending.status, 'pending');
    assert.equal(pending.rowStates[0].status, 'pending');

    writeFile(root, 'malformed.jsonl', '{"id":"valid","status":"pending"}\nnot-json\n');
    const malformed = artifactState(path.join(root, 'malformed.jsonl'));
    assert.equal(malformed.status, 'blocked');
    assert.deepEqual(malformed.rowStates.map(row => row.status), ['pending', 'blocked']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Stage 0.5 keeps a partial baseline pending and does not confuse it with Stage 17', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-pipeline-eval-'));
  try {
    writePassStage(root, '0');
    writeJsonl(root, 'eval/stage-0.5/prompts.jsonl', Array.from({ length: 50 }, (_, index) => ({ promptId: `prompt-${String(index + 1).padStart(3, '0')}`, prompt: '固定 prompt' })));
    writeJsonl(root, 'eval/stage-0.5/baseline.jsonl', [
      ...Array.from({ length: 49 }, (_, index) => ({ promptId: `prompt-${String(index + 1).padStart(3, '0')}`, text: '基线输出' })),
      { promptId: 'prompt-050', status: 'pending' }
    ]);
    writeJsonl(root, 'eval/stage-0.5/material.jsonl', Array.from({ length: 50 }, (_, index) => ({ promptId: `prompt-${String(index + 1).padStart(3, '0')}`, text: '素材输出' })));
    writeJson(root, 'eval/stage-0.5/report.json', { status: 'pending', stageId: '0.5' });

    const state = buildPipelineState({ artifactRoot: root, stage: '0.5' });
    assert.equal(state.stages[0].status, 'pass');
    assert.equal(state.stages[1].status, 'pending');
    assert.equal(state.pass, false);
    const baseline = state.stages[1].artifacts.find(item => item.logicalPath.endsWith('baseline.jsonl'));
    assert.equal(baseline.rowStates.length, 50);
    assert.equal(baseline.rowStates.slice(0, 49).every(row => row.status === 'pass'), true);
    assert.equal(baseline.rowStates.at(-1).status, 'pending');
    assert.equal(state.mayExpand, false);

    writePassThrough(root, '16');
    writeJsonl(root, 'eval/stage-17/scores.jsonl', [{
      evalId: 'eval-prompt-1',
      promptId: 'prompt-1',
      status: 'scored',
      scores: { A: { naturalness: 3 }, B: { naturalness: 4 } }
    }]);
    const beforeStage17Report = buildPipelineState({ artifactRoot: root, stage: '17' });
    const stage17Before = beforeStage17Report.stages.find(item => item.id === '17');
    assert.equal(stage17Before.status, 'pending');
    assert.equal(stage17Before.artifacts.find(item => item.logicalPath.endsWith('report.json')).status, 'missing');
    assert.equal(stage17Before.artifacts.some(item => item.path.endsWith('stage-0.5/report.json')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pipeline accepts a complete requested Stage 16 only after its runtime index passes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-pipeline-stage16-'));
  try {
    writePassThrough(root, '15');
    writePassStage(root, '16');
    const state = buildPipelineState({ artifactRoot: root, stage: '16' });
    assert.equal(state.pass, true);
    assert.equal(state.status, 'pass');
    assert.equal(state.mayExpand, true);
    assert.equal(state.stages[18].status, 'not_requested');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('proxy-only evaluation reports remain pending and cannot pass ordinary quality gates', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-pipeline-proxy-report-'));
  try {
    writePassStage(root, '0');
    writePassStage(root, '0.5');
    writeJson(root, 'eval/stage-0.5/report.json', {
      status: 'proxy-only',
      stageId: '0.5',
      claimable: false,
      promptValidation: { pass: true },
      metrics: {
        promptCount: 60,
        completePairCount: 60,
        pendingPairCount: 0,
        claimable: false,
        evaluator: 'deterministic-proxy'
      }
    });

    const state = buildPipelineState({ artifactRoot: root, stage: '0.5' });
    const report = state.stages[1].artifacts.find(item => item.logicalPath.endsWith('report.json'));
    assert.equal(report.status, 'pending');
    assert.equal(report.reason, 'eval_report_proxy_only_not_claimable');
    assert.equal(state.stages[1].status, 'pending');
    assert.equal(state.pass, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an evaluation report containing only reportVersion cannot pass its gate', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-pipeline-report-version-'));
  try {
    writePassStage(root, '0');
    writePassStage(root, '0.5');
    writeJson(root, 'eval/stage-0.5/report.json', { reportVersion: 'v3.1', stageId: '0.5' });

    const state = buildPipelineState({ artifactRoot: root, stage: '0.5' });
    const report = state.stages[1].artifacts.find(item => item.logicalPath.endsWith('report.json'));
    assert.equal(report.status, 'pending');
    assert.equal(report.reason, 'eval_report_metrics_missing');
    assert.equal(state.pass, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pass true cannot override a blocked evaluation report status', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-pipeline-conflicting-report-'));
  try {
    writePassStage(root, '0');
    writePassStage(root, '0.5');
    writeJson(root, 'eval/stage-0.5/report.json', {
      pass: true,
      status: 'blocked',
      stageId: '0.5',
      promptValidation: { pass: true },
      metrics: { promptCount: 60, completePairCount: 60, pendingPairCount: 0 }
    });

    const state = buildPipelineState({ artifactRoot: root, stage: '0.5' });
    const report = state.stages[1].artifacts.find(item => item.logicalPath.endsWith('report.json'));
    assert.equal(report.status, 'blocked');
    assert.equal(report.reason, 'eval_report_gate_failed');
    assert.equal(state.stages[1].status, 'blocked');
    assert.equal(state.pass, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an empty runtime index cannot pass Stage 16', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-pipeline-empty-runtime-index-'));
  try {
    writePassThrough(root, '15');
    writeJson(root, 'runtime-index.json', {
      published: true,
      general: { rules: [], samples: [] },
      mature: { rules: [], samples: [] },
      audit: { compatibilityBuilder: { compatibleSampleCount: 0, rejectedSampleCount: 0, residualTermsRequired: true, sampleChars: [12, 140] } }
    });

    const state = buildPipelineState({ artifactRoot: root, stage: '16' });
    const runtimeIndex = state.stages.find(item => item.id === '16').artifacts[0];
    assert.equal(runtimeIndex.status, 'pending');
    assert.equal(runtimeIndex.reason, 'runtime_index_compatible_samples_incomplete');
    assert.equal(state.status, 'pending');
    assert.equal(state.pass, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('published is required for the runtime index but not the compatibility builder index', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-pipeline-published-index-'));
  try {
    const filePath = path.join(root, 'runtime-index.json');
    const index = runtimeIndex();
    index.published = false;
    writeJson(root, 'runtime-index.json', index);

    const compatibilitySpec = stage('15').artifactSpecs[0];
    const runtimeSpec = stage('16').artifactSpecs[0];
    assert.equal(artifactState(filePath, compatibilitySpec).status, 'pass');
    assert.equal(artifactState(filePath, runtimeSpec).status, 'pending');
    assert.equal(artifactState(filePath, runtimeSpec).reason, 'runtime_index_not_published');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a blocked JSONL row blocks its stage even when other rows pass', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-pipeline-blocked-row-'));
  try {
    writePassStage(root, '0');
    writeJsonl(root, 'eval/stage-0.5/prompts.jsonl', [{ promptId: 'prompt-1', prompt: '固定 prompt' }]);
    writeJsonl(root, 'eval/stage-0.5/baseline.jsonl', [{ promptId: 'prompt-1', text: '基线输出' }]);
    writeJsonl(root, 'eval/stage-0.5/material.jsonl', [{ promptId: 'prompt-1', text: '素材输出' }, { promptId: 'prompt-2', status: 'blocked' }]);
    writeJson(root, 'eval/stage-0.5/report.json', { pass: true });
    const state = buildPipelineState({ artifactRoot: root, stage: '0.5' });
    assert.equal(state.stages[1].status, 'blocked');
    const material = state.stages[1].artifacts.find(item => item.logicalPath.endsWith('material.jsonl'));
    assert.deepEqual(material.rowStates.map(row => row.status), ['pass', 'blocked']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
