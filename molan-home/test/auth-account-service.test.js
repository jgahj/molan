'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createAuthAccountService } = require('../services/auth-account-service');

function fixture(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-auth-factory-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const service = createAuthAccountService({ DATA_DIR: directory, POSTGRES_MODE: false,
    USERS_FILE: path.join(directory, 'users.json'), SESSIONS_FILE: path.join(directory, 'sessions.json'),
    SESSION_TTL_MS: 3600000, USER_CACHE_TTL_MS: 1000, fs, crypto, dbReady: () => false, getDatabase: () => null,
    projectScope: { stableUserId: email => 'user-' + email, ensureUserWorkspace: () => {} },
    normalizeUserRole: user => user.role || 'normal', getUsageSummary: () => ({}), requestError: (status, message) => Object.assign(new Error(message), { status }),
    ...overrides });
  t.after(() => service.flushSessionsSync());
  return { service, directory };
}

test('extracted file accounts, password records and scoped hashed sessions retain legacy behavior', t => {
  const { service, directory } = fixture(t);
  service.saveUser({ email: 'alice@example.test', name: 'Alice', role: 'normal', credits: 500, ...service.createPasswordRecord('secret123') });
  const user = service.getUserByEmail('ALICE@EXAMPLE.TEST');
  assert.equal(service.verifyPassword('secret123', user).ok, true);
  assert.equal(service.verifyPassword('wrong', user).ok, false);
  const client = service.issueToken(user.email, 'client');
  const admin = service.issueToken(user.email, 'admin');
  assert.ok(service.getAuthUser({ headers: { authorization: 'Bearer ' + client } }));
  assert.equal(service.getAuthUser({ headers: { authorization: 'Bearer ' + admin } }), null);
  service.flushSessionsSync();
  const persisted = fs.readFileSync(path.join(directory, 'sessions.json'), 'utf8');
  assert.equal(persisted.includes(client), false);
  assert.equal(persisted.includes(admin), false);
  service.sessions.clear(); service.loadSessions();
  assert.ok(service.getAuthUser({ headers: { authorization: 'Bearer ' + admin } }, 'admin'));
  service.markSessionRevoked(service.hashSessionToken(client));
  assert.equal(service.getAuthUser({ headers: { authorization: 'Bearer ' + client } }), null);
});

test('factory resolves mutable database at call time instead of retaining initial handle', t => {
  let current;
  const database = name => ({ prepare: () => ({ get: () => ({ email: 'a@example.test', userId: 'a', name, credits: 1 }) }) });
  const { service } = fixture(t, { dbReady: () => true, getDatabase: () => current });
  current = database('first');
  assert.equal(service.getUserByEmail('a@example.test').name, 'first');
  current = database('second');
  assert.equal(service.getUserByEmail('a@example.test').name, 'second');
});
