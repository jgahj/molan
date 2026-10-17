'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createAuthAccountService } = require('../services/auth-account-service');

// PG-only 收敛后（2026-10-16）：本服务不再有 SQLite/JSON 同步账户缓存与会话文件持久化，
// 原「legacy behavior」「mutable database handle」两个测试的标的（loadUsers/saveUser/
// getUserByEmail/flushSessionsSync）已随生产死代码删除。保留对无存储依赖纯函数的合同断言。
function fixture(overrides = {}) {
  const service = createAuthAccountService({
    SESSION_TTL_MS: 3600000,
    allowAuthAttempt: () => true,
    authAttemptLimiter: null,
    applyAuthSessionInvalidation: () => false,
    canChooseModel: () => true,
    crypto,
    currentDefaultModel: () => 'default-model',
    findPlatformModel: () => true,
    getPostgresUsageSummary: async () => ({ totalTokens: 0 }),
    isAdminUser: () => false,
    json: () => {},
    normalizeUserRole: user => user.role || 'normal',
    postgresRepository: { enabled: false },
    postgresRuntimeUserFromRow: row => row,
    projectScope: { stableUserId: email => 'user-' + email, ensureUserWorkspace: () => {} },
    readBody: () => Promise.resolve({}),
    requestError: (status, message) => Object.assign(new Error(message), { status }),
    respondError: () => {},
    sessionEventUserId: () => '',
    ...overrides
  });
  return service;
}

test('password records: scrypt 封装、校验与升级标记', () => {
  const service = fixture();
  const record = service.createPasswordRecord('secret123');
  assert.match(record.pwd, /^scrypt\$[a-f0-9]+$/);
  assert.equal(record.salt.length, 32);
  const user = { email: 'alice@example.test', ...record };
  assert.equal(service.verifyPassword('secret123', user).ok, true);
  assert.equal(service.verifyPassword('secret123', user).needsUpgrade, false);
  assert.equal(service.verifyPassword('wrong', user).ok, false);
  // 旧式 sha256 记录标记 needsUpgrade，供登录链换密
  const legacy = { email: 'bob@example.test', salt: 's', pwd: crypto.createHash('sha256').update('pw:s').digest('hex') };
  assert.equal(service.verifyPassword('pw', legacy).ok, true);
  assert.equal(service.verifyPassword('pw', legacy).needsUpgrade, true);
});

test('session tokens: 哈希确定、scope 归一与撤销标记', () => {
  const service = fixture();
  const token = 'a'.repeat(48);
  const hash = service.hashSessionToken(token);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(service.hashSessionToken(token), hash, '同一令牌哈希必须确定');
  assert.equal(service.normalizeSessionScope('ADMIN'), 'admin');
  assert.equal(service.normalizeSessionScope('client'), 'client');
  assert.equal(service.normalizeSessionScope(''), 'client');
  assert.equal(service.isSessionRevoked(hash), false);
  service.markSessionRevoked(hash);
  assert.equal(service.isSessionRevoked(hash), true, '撤销后必须拒绝');
});

test('PG-only 收敛后不再导出同步账户缓存与会话文件持久化面', () => {
  const service = fixture();
  for (const removed of ['loadUsers', 'saveUsers', 'saveUser', 'getUserByEmail', 'getUserById', 'persistUsersToDb', 'persistSessions', 'flushSessions', 'flushSessionsSync']) {
    assert.equal(service[removed], undefined, removed + ' 应已随 legacy 路径删除');
  }
  for (const kept of ['insertUserIfAbsent', 'issueToken', 'getAuthUser', 'publicUser', 'handleLogin', 'handleRegister', 'hydratePostgresSessions', 'loadSessions']) {
    assert.equal(typeof service[kept], 'function', kept + ' 必须保留');
  }
});

test('getAuthUser 仅认 PG 中间件注入的 request-scoped 身份', () => {
  const service = fixture();
  const user = { userId: 'u1', email: 'a@example.test', role: 'normal' };
  assert.equal(service.getAuthUser({ headers: {} }), null, '无注入身份返回 null');
  assert.equal(service.getAuthUser({ molanPostgresAuth: { scope: 'client', token: 't', user } }, 'admin'), null, 'scope 不匹配返回 null');
  const ok = service.getAuthUser({ molanPostgresAuth: { scope: 'client', token: 't', user } }, 'client');
  assert.deepEqual(ok, { token: 't', user });
});
