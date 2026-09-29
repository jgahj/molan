'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { matchesTokenUsageReservation } = require('../lib/token-usage-idempotency');

const reservation = {
  requestId: 'req_123', userEmail: 'author@example.test', userId: 'user-1',
  workspaceId: 'workspace-1', projectId: 'project-1', modelId: 'model-1',
  providerModel: 'provider/model-1', messagesHash: 'a'.repeat(64), reservedCost: 1.25
};

test('Provider request IDs are bound to the same user, scope, model, body hash, and reservation', () => {
  const stored = {
    request_id: reservation.requestId, user_email: reservation.userEmail, user_id: reservation.userId,
    workspace_id: reservation.workspaceId, project_id: reservation.projectId, model_id: reservation.modelId,
    provider_model: reservation.providerModel, messages_sha256: reservation.messagesHash,
    reserved_cost: reservation.reservedCost, status: 'reserved'
  };
  assert.equal(matchesTokenUsageReservation(stored, reservation), true);
  for (const [key, value] of [
    ['userId', 'other-user'], ['projectId', 'other-project'], ['modelId', 'other-model'],
    ['messagesHash', 'b'.repeat(64)], ['reservedCost', 3]
  ]) {
    assert.equal(matchesTokenUsageReservation(stored, { ...reservation, [key]: value }), false, key);
  }
  const { reservedCost, ...identity } = reservation;
  assert.equal(matchesTokenUsageReservation(stored, identity), true);
});
