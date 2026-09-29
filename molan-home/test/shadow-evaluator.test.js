'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runShadowEvaluation } = require('../lib/evolution/shadow-evaluator');

test('shadow run is detached from production, non-user-visible, and records only evaluation metrics', async () => {
  const context = { chapterIndex: 9, state: { facts: ['已确认的事实'] } };
  const before = JSON.stringify(context);
  let timestamp = 1000;
  const result = await runShadowEvaluation({
    generationId: 'gen-9',
    contextSnapshot: context,
    shadowPrompt: 'candidate prompt',
    promptVersion: 'shadow-2',
    model: 'test-model',
    parameters: { temperature: 0.6 },
    now: () => timestamp += 25,
    generateShadow: async request => {
      assert.equal(request.mode, 'shadow');
      assert.equal(request.billableToUser, false);
      assert.equal(Object.isFrozen(request.contextSnapshot.state), true);
      assert.equal(Object.hasOwn(request, 'billing'), false);
      return { text: '候选正文仅在本次评估使用', cost: 0.12 };
    },
    evaluateShadow: async ({ candidateText }) => {
      assert.equal(candidateText, '候选正文仅在本次评估使用');
      return { metrics: { quality: 0.82, style: 0.7, continuity: 1, latency: 40, unused: 'ignore' }, evidence_refs: ['audit:gen-9'] };
    }
  });

  assert.equal(JSON.stringify(context), before);
  assert.equal(result.status, 'completed');
  assert.equal(result.user_visible, false);
  assert.equal(result.user_billing_mutation, 'none');
  assert.equal(result.state_mutation, 'none');
  assert.deepEqual(result.metrics, { quality: 0.82, style: 0.7, continuity: 1, cost: 0.12, latency: 40 });
  assert.equal(Object.hasOwn(result, 'candidate_text'), false);
  assert.ok(result.shadow_output_hash);
});

test('shadow failure is contained and cannot fail the production-facing request', async () => {
  const result = await runShadowEvaluation({
    generationId: 'gen-10',
    contextSnapshot: { chapterIndex: 10 },
    shadowPrompt: 'prompt',
    promptVersion: 'shadow-1',
    model: 'test-model',
    generateShadow: async () => { throw Object.assign(new Error('secret provider detail'), { code: 'RATE_LIMITED' }); },
    evaluateShadow: async () => ({})
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.error_code, 'RATE_LIMITED');
  assert.equal(JSON.stringify(result).includes('secret provider detail'), false);
  assert.equal(result.user_billing_mutation, 'none');
  assert.equal(result.state_mutation, 'none');
});
