'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createAuthAccountService } = require('../services/auth-account-service');

function fixture(overrides = {}) {
  const calls = [];
  const user = { userId: 'owner', email: 'owner@example.test', name: 'owner', role: 'normal', credits: 20 };
  const repository = {
    enabled: true,
    runtimeAccountByEmail: async () => { calls.push('account'); return user; },
    createAuthSession: async () => { calls.push('session'); },
    runtimeRegisterAccount: async input => { calls.push('register'); return input; },
    revokeAuthSession: async () => { calls.push('revoke'); },
    revokeAuthSessions: async () => { calls.push('revoke-all'); },
    ...overrides.repository
  };
  const service = createAuthAccountService({
    POSTGRES_MODE: true, postgresRepository: repository, crypto, SESSION_TTL_MS: 600000,
    projectScope: { stableUserId: () => 'owner' },
    postgresRuntimeUserFromRow: row => row,
    postgresRuntimeState: { accounts: [], accountsByEmail: new Map(), accountsById: new Map() },
    getDatabase: () => { throw new Error('SQL compatibility forbidden'); },
    getUsageSummary: () => { throw new Error('SQL usage forbidden'); },
    getPostgresUsageSummary: async () => ({ requestCount: 0 }),
    normalizeUserRole: account => account.role,
    requestError: (status, message) => Object.assign(new Error(message), { status }),
    json: (response, status, body) => Object.assign(response, { status, body }),
    ...overrides.dependencies
  });
  return { service, calls, user, repository };
}

test('PG auth ignores locally cached sessions and trusts only the request-scoped verified identity', () => {
  const instance = fixture();
  const token = crypto.randomBytes(24).toString('hex');
  instance.service.sessions.set(instance.service.hashSessionToken(token), { userId: 'owner', scope: 'admin', expiresAt: Date.now() + 600000 });
  const request = { headers: { authorization: `Bearer ${token}` } };
  assert.equal(instance.service.getAuthUser(request), null);
  request.molanPostgresAuth = { token, user: instance.user, scope: 'client' };
  assert.equal(instance.service.getAuthUser(request).user, instance.user);
  assert.equal(instance.service.getAuthUser(request, 'admin'), null);
});

test('PG session issuance waits for the database and never publishes a local credential', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const instance = fixture({ repository: { createAuthSession: async () => pending } });
  let settled = false;
  const issuance = instance.service.issueToken(instance.user.email).then(token => { settled = true; return token; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(instance.service.sessions.size, 0);
  finish();
  assert.match(await issuance, /^[0-9a-f]{48}$/);
});

test('PG issuance and registration faults propagate instead of confirming a cached write', async () => {
  const fault = new Error('PG unavailable');
  const instance = fixture({ repository: {
    createAuthSession: async () => { throw fault; },
    runtimeRegisterAccount: async () => { throw fault; }
  } });
  await assert.rejects(instance.service.issueToken(instance.user.email), error => error === fault);
  await assert.rejects(instance.service.insertUserIfAbsent(instance.user), error => error === fault);
  assert.equal(instance.service.sessions.size, 0);
});

test('PG logout acknowledges only durable revocation and preserves scope isolation', async () => {
  const instance = fixture();
  const request = { headers: { authorization: 'Bearer synthetic' }, molanPostgresAuth: { token: 'synthetic', user: instance.user, scope: 'client' } };
  const wrongScope = {};
  await instance.service.handleLogout(request, wrongScope, 'admin');
  assert.equal(wrongScope.status, 401);
  assert.equal(instance.calls.includes('revoke'), false);
  const response = {};
  await instance.service.handleLogout(request, response);
  assert.equal(response.status, 200);
  assert.equal(instance.calls.includes('revoke'), true);
  instance.repository.revokeAuthSession = async () => { throw new Error('PG unavailable'); };
  await assert.rejects(instance.service.handleLogout(request, {}), /PG unavailable/);
});

test('PG public user usage comes from native PG ledger and never the SQL projection', async () => {
  const instance = fixture();
  const view = await instance.service.publicUser(instance.user);
  assert.equal(view.userId, instance.user.userId);
  assert.deepEqual(view.usage, { requestCount: 0 });
});
