'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { applyAuthSessionInvalidation, sessionEventUserId } = require('../lib/auth-session-events');

test('shared user revocation invalidates matching sessions on every app instance', () => {
  const instances = Array.from({ length: 4 }, (_, index) => new Map([
    [`token-${index}`, { userId: 'stable-user-1', email: '', expiresAt: 0 }],
    [`other-${index}`, { userId: 'stable-user-2', email: '', expiresAt: 0 }]
  ]));
  const event = { event: 'user_revoked', userId: 'stable-user-1', legacyId: 'old-field-user' };
  for (const sessions of instances) {
    assert.equal(applyAuthSessionInvalidation(sessions, event), true);
    assert.equal(sessions.size, 1);
    assert.equal(sessions.has('other-' + instances.indexOf(sessions)), true);
  }
  assert.equal(sessionEventUserId({ event: 'user_revoked', legacyId: 'legacy-user' }), 'legacy-user');
});

test('single-session revocation removes only the notified token hash', () => {
  const sessions = new Map([
    ['a'.repeat(64), { userId: 'stable-user-1' }],
    ['b'.repeat(64), { userId: 'stable-user-1' }]
  ]);
  assert.equal(applyAuthSessionInvalidation(sessions, { event: 'revoked', tokenHash: 'A'.repeat(64) }), true);
  assert.equal(sessions.has('a'.repeat(64)), false);
  assert.equal(sessions.has('b'.repeat(64)), true);
});
