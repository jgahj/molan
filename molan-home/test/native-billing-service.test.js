'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonAppRepository } = require('../lib/repositories/json-app-repository');
const { createNativeBillingService } = require('../services/native-billing-service');
const { matchesTokenUsageReservation } = require('../lib/token-usage-idempotency');

test('native billing keeps unknown usage reserved and settles exact provider usage once', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-native-billing-'));
  const repository = new JsonAppRepository(directory);
  t.after(async () => { await repository.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const user = await repository.saveAccount({ email: 'billing@test.local', userId: 'payer', role: 'normal', credits: 10 });
  const service = createNativeBillingService({ repository, isAdminUser: u => u.role === 'admin',
    creditCostForUser: (u, model, tokens) => tokens / 1000, roundCreditValue: x => Math.round(x * 10000) / 10000,
    toTokenCount: value => Number.isSafeInteger(value) && value >= 0 ? value : null, matchesTokenUsageReservation });
  const reserve = () => service.reserveCredits(user, 'model', 'provider-model', 'request-one', 2, {}, 'hash', null);
  assert.equal((await reserve()).ok, true);
  assert.equal((await reserve()).existing, true);
  assert.equal((await repository.getAccount(user.userId)).credits, 8);
  assert.equal((await service.reserveCredits(user, 'model', 'provider-model', 'request-one', 2, {}, 'changed', null)).conflict, true);
  const pending = await service.settleTokenUsage({ userId: user.userId, requestId: 'request-one', modelId: 'model', status: 'usage_unavailable' });
  assert.equal(pending.billingStatus, 'pending');
  assert.equal((await repository.lookupTokenUsage({ userId: user.userId, requestId: 'request-one' })).status, 'reserved');
  const event = { userId: user.userId, requestId: 'request-one', modelId: 'model', status: 'succeeded', totalTokens: 500 };
  assert.equal((await service.settleTokenUsage(event)).recorded, true);
  assert.equal((await service.settleTokenUsage(event)).recorded, false);
  assert.equal((await repository.getAccount(user.userId)).credits, 9.5);
  assert.equal((await repository.listTokenUsage({ userId: user.userId })).length, 1);
  await assert.rejects(service.settleTokenUsage({ ...event, totalTokens: 600 }), { code: 'IDEMPOTENCY_KEY_REUSED' });
});
