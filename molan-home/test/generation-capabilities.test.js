'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { generationV2Status } = require('../lib/generation/feature-flag');

test('generation capabilities identify a disabled rollout for fail-closed clients', () => {
  assert.deepEqual(generationV2Status(false), {
    generationV2: false,
    code: 'generation_v2_disabled'
  });
  assert.deepEqual(generationV2Status(true), {
    generationV2: true,
    code: null
  });
});
