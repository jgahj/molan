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

test('shared cluster state aligns multi-worker instances without drift', () => {
  const { alignClusterFeatureState } = require('../lib/generation/feature-flag');
  // 集群熔断优先下线
  assert.equal(generationV2Enabled({ MOLAN_GENERATION_V2: 'true' }, 'user-1', { forceOff: true }), false);
  // 集群显式开启优先于未设置的环境变量
  assert.equal(generationV2Enabled({}, 'user-1', { generationV2: true }), true);
  // 集群显式关闭切断生成
  assert.equal(generationV2Enabled({}, 'user-1', { generationV2: false }), false);
  // 集群放量比例生效
  assert.equal(generationV2Enabled({}, 'user-1', { percent: 100 }), true);
  assert.equal(generationV2Enabled({}, 'user-1', { percent: 0 }), false);

  const state = alignClusterFeatureState({ enabled: true, percent: 50 }, { MOLAN_GENERATION_V2_FORCE_OFF: '0' });
  assert.equal(state.generationV2, true);
  assert.equal(state.forceOff, false);
  assert.equal(state.percent, 50);
});

