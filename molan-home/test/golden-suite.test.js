'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGoldenSuite, validateGoldenSuite, GOLDEN_GENRES, GOLDEN_MODEL } = require('../lib/evolution/golden-suite');

test('golden input suite fixes ten replayable tasks for each required genre', () => {
  const suite = buildGoldenSuite();
  const audit = validateGoldenSuite(suite);
  assert.equal(audit.valid, true, audit.failures.join('\n'));
  assert.equal(suite.taskCount, 80);
  assert.deepEqual(suite.genres, GOLDEN_GENRES);
  assert.deepEqual(Object.values(audit.genreCounts), Array(8).fill(10));
});

test('gold tasks pin all required inputs and do not claim fabricated model results', () => {
  const first = buildGoldenSuite().tasks[0];
  assert.equal(first.model, GOLDEN_MODEL);
  assert.deepEqual(Object.keys(first.modelParams).sort(), ['maxTokens', 'temperature', 'topP']);
  assert.match(first.replayManifest.manifestHash, /^[a-f0-9]{64}$/);
  assert.equal(first.replayManifest.artifact_hashes.contextSnapshot, first.replayManifest.contextHash);
  assert.equal(first.replayManifest.artifact_hashes.chapterContract, first.replayManifest.contractHash);
  assert.equal(buildGoldenSuite().fixtureStatus, 'test_fixture');
  assert.equal(buildGoldenSuite().dataStatus, 'inputs_only');
  assert.equal(first.artifacts.contextSnapshot.snapshot, first.contextSnapshot);
  assert.equal(first.sourceGenerationId, first.replayManifest.sourceGenerationId);
  assert.equal(Object.isFrozen(first.contextSnapshot.storyState), true);
});
