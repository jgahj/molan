'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { QUALITY_DIMENSIONS } = require('../lib/quality-vectors');
const { hashJson } = require('../lib/evolution/replay-manifest');
const { verifyQualityArtifacts, createArtifactResolver } = require('../lib/evolution/quality-ab-artifacts');
const { planEvaluation, runEvaluation } = require('../lib/evolution/quality-ab-runner');
function plan() {
  const snapshot = { prompt: 'fixed test input' };
  const version = { pipelineVersion: 'p1', promptVersion: 'a', genreProfileVersion: 'g1', styleVersion: 's1' };
  return { schemaVersion: 'quality-ab-live-plan-v1', binding: { model: 'offline-stub', modelParametersHash: hashJson({ temperature: 0 }), evaluatorVersion: 'v1', reviewerVersion: 'v1' }, modelParameters: { temperature: 0 }, versions: { baseline: version, candidate: { ...version, promptVersion: 'b' } }, maxOutputTokens: 200, pricing: { currency: 'USD', inputPerMillion: 1, outputPerMillion: 1 }, tasks: [{ task_id: 'one', genre: 'fixture', snapshot, input_hash: hashJson(snapshot), prompts: { baseline: 'A', candidate: 'B' }, judgePrompt: 'score as JUDGED, not measured or human reviewed' }] };
}
test('live plan displays scale and refuses execution without an explicit sufficient cap', async () => {
  assert.equal(planEvaluation(plan()).totalCalls, 4);
  let called = false;
  await assert.rejects(runEvaluation(plan(), { maxCost: 0, callModel: () => { called = true; } }), /max_cost/);
  await assert.rejects(runEvaluation(plan(), { maxCost: 0.00001, callModel: () => { called = true; } }), /exceeds_limit/);
  assert.equal(called, false);
});
test('saved artifacts bind text, inputs, scores and usage; tampering blocks resolution', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-ab-artifacts-'));
  const directory = path.join(root, 'run');
  let calls = 0;
  try {
    const vector = { schemaVersion: 'quality-vector-v2', values: Object.fromEntries(QUALITY_DIMENSIONS.map(d => [d, 0.7])), dimensions: Object.fromEntries(QUALITY_DIMENSIONS.map(d => [d, { status: 'JUDGED', value: 0.7, explanation: 'stub evidence only' }])) };
    const result = await runEvaluation(plan(), { maxCost: 1, directory, callModel: async () => ({ model: 'offline-stub', choices: [{ message: { content: ++calls % 2 ? 'actual saved stub prose' : JSON.stringify({ qualityVector: vector }) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }) });
    assert.equal(result.status, 'COMPLETED_PENDING_COMPARISON');
    const input = JSON.parse(fs.readFileSync(path.join(directory, 'results.json'), 'utf8'));
    assert.equal(verifyQualityArtifacts(input, directory).status, 'PASS');
    input.safety_gate = { categoryResults: { security: { status: 'PASS', evidence_refs: ['task-0-baseline-output#'] } } };
    assert.ok(verifyQualityArtifacts(input, directory).reason_codes.includes('safety_evidence_value_mismatch:category:security'));
    delete input.safety_gate;
    const ledgerPath = path.join(directory, 'task-0-baseline-generation-call.json');
    const originalLedger = fs.readFileSync(ledgerPath);
    const ledger = JSON.parse(originalLedger);
    ledger.request.modelParameters.temperature = 1;
    const changedLedger = Buffer.from(JSON.stringify(ledger));
    fs.writeFileSync(ledgerPath, changedLedger);
    const indexPath = path.join(directory, 'artifacts.json');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const record = index.artifacts.find(item => item.id === 'task-0-baseline-generation-call');
    const originalHash = record.sha256;
    record.sha256 = require('../lib/evolution/quality-ab-artifacts').sha256(changedLedger);
    fs.writeFileSync(indexPath, JSON.stringify(index));
    assert.ok(verifyQualityArtifacts(input, directory).reason_codes.some(reason => reason.includes('provider_request_binding_missing')));
    fs.writeFileSync(ledgerPath, originalLedger);
    record.sha256 = originalHash;
    fs.writeFileSync(indexPath, JSON.stringify(index));
    fs.appendFileSync(path.join(directory, 'task-0-baseline-output.txt'), 'changed');
    assert.equal(verifyQualityArtifacts(input, directory).status, 'BLOCKED');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('missing usage stops further calls and retains cost-unknown failure evidence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-ab-unknown-'));
  const directory = path.join(root, 'run');
  let calls = 0;
  try {
    const result = await runEvaluation(plan(), { maxCost: 1, directory, callModel: async () => { calls++; return { choices: [{ message: { content: 'unpriced' } }] }; } });
    assert.equal(calls, 1);
    assert.equal(result.status, 'BLOCKED');
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'execution.json'), 'utf8')).costUnknown, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('artifact index rejects outside-root records', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-ab-outside-'));
  try {
    fs.writeFileSync(path.join(root, 'artifacts.json'), JSON.stringify({ schemaVersion: 'quality-ab-artifact-index-v1', artifacts: [{ id: 'bad', path: process.execPath, kind: 'text', sha256: 'a'.repeat(64) }] }));
    assert.throws(() => createArtifactResolver(root), /artifact_record_invalid/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
