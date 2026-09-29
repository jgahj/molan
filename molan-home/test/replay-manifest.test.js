'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildReplayManifest,
  verifyReplayManifest,
  buildReplayVariant
} = require('../lib/evolution/replay-manifest');

function fixture() {
  const artifacts = {
    bible: { ref: 'bible:v3', snapshot: { title: '测试书', protagonist: ['林野'] } },
    outline: { ref: 'outline:v8', snapshot: { chapter: 12, event: '进入旧城' } },
    chapterContract: { ref: 'contract:v4', snapshot: { wordBudget: { targetChars: 2400 }, objectives: ['发现线索'] } },
    contextSnapshot: { ref: 'context:v12', snapshot: { chapterIndex: 12, knownFacts: ['旧城封锁'] } }
  };
  return {
    input: {
      sourceGenerationId: 'gen-123',
      pipelineVersion: 'generation-2.1',
      promptVersion: 'writer-7',
      genreProfileVersion: 'genre-4',
      styleVersion: 'style-8',
      model: 'gpt-5.6-luna',
      parameters: { temperature: 0.8, maxTokens: 5000 },
      artifacts
    },
    artifacts: Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [key, { ref: value.ref, value: value.snapshot }]))
  };
}

test('Replay Manifest pins all gold-task inputs by artifact reference and stable content hashes', () => {
  const data = fixture();
  const manifest = buildReplayManifest(data.input);
  assert.equal(manifest.schemaVersion, 'generation-replay-manifest-v1');
  assert.equal(manifest.sourceGenerationId, 'gen-123');
  assert.equal(manifest.artifact_refs.bible, 'bible:v3');
  assert.match(manifest.contextHash, /^[a-f0-9]{64}$/);
  assert.match(manifest.contractHash, /^[a-f0-9]{64}$/);
  assert.equal(verifyReplayManifest(manifest, data.artifacts).valid, true);
  assert.equal(JSON.stringify(manifest).includes('旧城封锁'), false);
});

test('Replay verification blocks any changed snapshot or artifact reference', () => {
  const data = fixture();
  const manifest = buildReplayManifest(data.input);
  const changed = { ...data.artifacts, contextSnapshot: { ref: 'context:v12', value: { chapterIndex: 12, knownFacts: ['已改变'] } } };
  const result = verifyReplayManifest(manifest, changed);
  assert.equal(result.status, 'mismatch');
  assert.deepEqual(result.mismatches, ['contextSnapshot.hash']);
});

test('Replay variants may change prompt or pipeline version but keep every input and model control fixed', () => {
  const data = fixture();
  const manifest = buildReplayManifest(data.input);
  const variant = buildReplayVariant(manifest, { promptVersion: 'writer-8' });
  assert.equal(variant.sourceManifestHash, manifest.manifestHash);
  assert.equal(variant.promptVersion, 'writer-8');
  assert.equal(variant.model, manifest.model);
  assert.deepEqual(variant.artifact_hashes, manifest.artifact_hashes);
  assert.equal(verifyReplayManifest(variant, data.artifacts).valid, true);
  assert.throws(() => buildReplayVariant(manifest, { model: 'other-model' }), /不支持改变/);
});
