'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { generationV2Enabled } = require('../lib/generation/feature-flag');

test('explicit disable and emergency kill switch override percentage rollout', () => {
  assert.equal(generationV2Enabled({ MOLAN_GENERATION_V2: 'false', MOLAN_GENERATION_V2_PERCENT: '100' }, 'user-1'), false);
  assert.equal(generationV2Enabled({ MOLAN_GENERATION_V2_FORCE_OFF: '1', MOLAN_GENERATION_V2_PERCENT: '100' }, 'user-1'), false);
});

test('percentage rollout is stable per actor and never enables anonymous requests', () => {
  const env = { MOLAN_GENERATION_V2_PERCENT: '100' };
  assert.equal(generationV2Enabled(env, ''), false);
  assert.equal(generationV2Enabled(env, 'user-1'), true);
  assert.equal(generationV2Enabled({ ...env, MOLAN_GENERATION_V2_PERCENT: '0' }, 'user-1'), false);
});

test('unknown explicit values fail closed', () => {
  assert.equal(generationV2Enabled({ MOLAN_GENERATION_V2: 'sometimes', MOLAN_GENERATION_V2_PERCENT: '100' }, 'user-1'), false);
});
