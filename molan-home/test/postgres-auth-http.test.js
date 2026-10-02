'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readConfig } = require('../lib/postgres-repository');

test('real isolated PG auth HTTP: register, login, latest roles, profile, scope, durable logout and native usage', {
  skip: process.env.MOLAN_PG_AUTH_ACCEPTANCE !== '1',
  timeout: 20000
}, async () => {
  const settings = readConfig(process.env);
  assert.ok(settings.enabled && /test|acceptance/i.test(settings.config.database || ''));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-pg-auth-http-'));
  process.env.MOLAN_DATA_DIR = directory;
  process.env.MOLAN_CONFIG_DIR = directory;
  process.env.MOLAN_LOCAL_ONLY = '1';
  process.env.MOLAN_PUBLIC_MODE = '0';
  const app = require('../server');
  const suffix = crypto.randomBytes(8).toString('hex');
  const email = `auth-${suffix}@example.test`;
  const password = crypto.randomBytes(24).toString('hex');
  const prototype = require('../lib/pure-js-database').PureJsDatabase.prototype;
  const originalPrepare = prototype.prepare;
  let forbiddenAccess = 0;
  let listening = false;
  try {
    assert.equal(app.initDB(), true);
    await app.initializePostgresRuntime();
    prototype.prepare = function (sql, ...args) {
      if (/\baccounts\b|\bauth_sessions\b|\btoken_usage\b/i.test(String(sql))) {
        forbiddenAccess++;
        throw new Error('auth accessed legacy SQL');
      }
      return originalPrepare.call(this, sql, ...args);
    };
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    listening = true;
    const address = `http://127.0.0.1:${app.server.address().port}`;
    const request = async (route, { method = 'GET', token, body } = {}) => {
      const response = await fetch(address + route, {
        method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return { status: response.status, body: await response.json() };
    };
    const registered = await request('/api/auth/register', { method: 'POST', body: { email, password, name: '合成验收' } });
    assert.equal(registered.status, 200);
    const token = registered.body.token;
    assert.equal(typeof token, 'string');
    const userId = registered.body.user.userId;
    const persistedSession = await app.postgresRepository.requestAuthSession(app.hashSessionToken(token));
    assert.equal(persistedSession.userId, userId);
    assert.equal((await request('/api/auth/me', { token })).status, 200);
    assert.equal((await request('/api/admin/auth/me', { token })).status, 401);
    const profile = await request('/api/auth/profile', { method: 'PATCH', token, body: { name: '已持久化昵称', bio: '合成资料' } });
    assert.equal(profile.status, 200);
    assert.equal(profile.body.user.name, '已持久化昵称');
    assert.equal((await app.postgresRepository.runtimeAccountByUserId(userId)).name, '已持久化昵称');
    const login = await request('/api/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(login.status, 200);
    assert.equal(typeof login.body.token, 'string');
    assert.equal((await request('/api/usage', { token })).body.usage.requestCount, 0);
    const adminId = `auth_admin_${suffix}`;
    await app.postgresRepository.runtimeRegisterAccount({ userId: adminId, email: `${adminId}@example.test`, role: 'admin', name: '权限验收' });
    await app.postgresRepository.runtimeUpdateAccount({
      actorUserId: adminId, userId, email, name: '已持久化昵称', role: 'vip', preserveFinancials: true
    });
    assert.equal((await request('/api/auth/me', { token })).body.user.role, 'vip');
    const logout = await request('/api/auth/logout', { method: 'POST', token });
    assert.equal(logout.status, 200);
    assert.equal(await app.postgresRepository.requestAuthSession(app.hashSessionToken(token)), null);
    assert.equal((await request('/api/auth/me', { token })).status, 401);
    assert.equal((await request('/api/auth/me', { token: login.body.token })).status, 200);
    assert.equal((await request('/api/auth/logout-all', { method: 'POST', token: login.body.token })).status, 200);
    assert.equal((await request('/api/auth/me', { token: login.body.token })).status, 401);
    assert.equal(forbiddenAccess, 0);
  } finally {
    prototype.prepare = originalPrepare;
    if (listening) await new Promise(resolve => app.server.close(resolve));
    await app.postgresRepository.close();
  }
});
