'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCharacterMaterialReviewService } = require('../services/character-material-review-service');
const passing = { json: { review: { pass: true, suitable: true, errorFree: true, issues: [] } } };
const material = { request: { mode: 'strong' }, samples: [{ id: 'sample-one', text: '人物望向旧窗。' }] };

test('strong material cannot enter a prompt when review billing evidence is missing or unknown', async () => {
  for (const usage of [undefined, { totalTokens: null, creditCost: 0, billingStatus: 'exact' },
    { totalTokens: 10, creditCost: null, billingStatus: 'settled' },
    { totalTokens: 10, creditCost: 1, billingStatus: 'pending' }]) {
    let calls = 0;
    const service = createCharacterMaterialReviewService({ DYNAMIC_PROMPT_MARKER: '', safeJsonParse: JSON.parse,
      callMolanChat: async () => { calls++; return { ...passing, usage }; } });
    const result = await service.reviewCharacterMaterialSamples('', {}, material, [], 'test-model');
    assert.deepEqual(result.approvedIds, []);
    assert.equal(result.audit.calls[0].status, 'unavailable');
    assert.equal(result.audit.status, 'partial');
    assert.equal(calls, 1);
  }
});

test('confirmed zero-cost review accepts a suitable sample and preserves exact evidence', async () => {
  const service = createCharacterMaterialReviewService({ DYNAMIC_PROMPT_MARKER: '', safeJsonParse: JSON.parse,
    callMolanChat: async () => ({ ...passing, usage: { requestId: 'review-one', totalTokens: 10, creditCost: 0, billingStatus: 'exact' } }) });
  const result = await service.reviewCharacterMaterialSamples('', {}, material, [], 'test-model');
  assert.deepEqual(result.approvedIds, ['sample-one']);
  assert.equal(result.audit.calls[0].creditCost, 0);
  assert.equal(result.audit.calls[0].billingStatus, 'exact');
});
