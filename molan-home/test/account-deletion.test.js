'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { createAuthAccountService } = require('../services/auth-account-service');
const { createAuthRoutes } = require('../routes/auth');

function buildHarness({ adminEmails = [], localEmail = 'local@molan.local' } = {}) {
  const accounts = new Map(); // email -> row
  const revoked = [];
  const deactivated = [];
  const salted = (pwd, salt) => 'scrypt$' + crypto.scryptSync(pwd, Buffer.from(salt, 'hex'), 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');

  const repo = {
    enabled: true,
    async runtimeAccountByEmail(email) { return accounts.get(email) || null; },
    async runtimeAccountByUserId(id) { return [...accounts.values()].find(a => a.userId === id) || null; },
    async runtimeRegisterAccount(user) {
      if (accounts.has(user.email)) return null;
      if ([...accounts.values()].some(a => a.userId === user.userId)) throw new Error('pk conflict');
      const row = { ...user };
      accounts.set(user.email, row);
      return row;
    },
    async createAuthSession() {},
    async runtimeDeactivateAccount({ userId }) {
      const entry = [...accounts.entries()].find(([, a]) => a.userId === userId);
      if (!entry || adminEmails.includes(entry[0])) throw Object.assign(new Error('账户不存在或不允许注销'), { status: 404 });
      const [email, row] = entry;
      accounts.delete(email);
      accounts.set(`deleted-${userId}@deleted.molan.invalid`, { ...row, email: `deleted-${userId}@deleted.molan.invalid`, name: '已注销用户', pwd: '!deactivated', salt: '' });
      deactivated.push(userId);
      return { userId };
    },
    async revokeAuthSessions(userId) { revoked.push(userId); return 1; }
  };

  let currentBody = {};
  let currentUser = null;
  const service = createAuthAccountService({
    SESSION_TTL_MS: 86400000,
    allowAuthAttempt: () => true,
    authAttemptLimiter: { recordFailure() {}, recordSuccess() {}, retryAfterSeconds: () => 30 },
    applyAuthSessionInvalidation: () => false,
    canChooseModel: () => true,
    crypto,
    currentDefaultModel: () => 'gpt-6-luna',
    findPlatformModel: () => ({ id: 'gpt-6-luna' }),
    getPostgresUsageSummary: async () => ({ requestCount: 0 }),
    isAdminUser: u => adminEmails.includes(String((u && u.email) || u || '').toLowerCase()),
    isLocalOpenAccount: email => email === localEmail,
    json: (res, status, payload, headers) => { res.writeHead(status, headers || {}); res.end(JSON.stringify(payload)); },
    normalizeUserRole: u => (u && u.role) || 'normal',
    postgresRepository: repo,
    postgresRuntimeUserFromRow: row => row,
    projectScope: { stableUserId: email => 'usr_' + crypto.createHash('sha256').update(email).digest('hex').slice(0, 32) },
    readBody: async () => currentBody,
    requestError: (status, message) => Object.assign(new Error(message), { status }),
    resolveFallbackAuth: () => null,
    respondError: (res, err) => { res.writeHead(err && err.status ? err.status : 400, {}); res.end(JSON.stringify({ error: err.message })); },
    sessionEventUserId: () => ''
  });

  const dispatch = createAuthRoutes({
    register: service.handleRegister, login: service.handleLogin, sendCode: service.handleSendCode,
    loginByCode: service.handleLoginByCode, me: service.handleMe, profile: service.handleProfile,
    logout: service.handleLogout, logoutAll: service.handleLogoutAll, deleteAccount: service.handleDeleteAccount,
    adminLogin: service.handleAdminLogin, adminMe: service.handleAdminMe, usage: async () => {}
  });

  function call(method, url, body = {}, user = currentUser) {
    currentBody = body;
    return new Promise(async resolve => {
      const req = { method, url, headers: { authorization: 'Bearer tok' }, socket: { remoteAddress: '127.0.0.1' } };
      if (user) req.molanPostgresAuth = { scope: 'client', token: 'tok', user };
      const res = { writeHead(code) { this.code = code; }, end(raw) { resolve({ status: this.code, body: raw ? JSON.parse(raw) : null }); } };
      await dispatch(req, res, url);
    });
  }
  return { accounts, revoked, deactivated, repo, call, salted, setUser: u => { currentUser = u; } };
}

async function register(h, email, password) {
  const r = await h.call('POST', '/api/auth/register', { email, password }, null);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return h.accounts.get(email);
}

test('delete-account anonymizes the account, revokes sessions, frees the email, and allows safe re-registration', async () => {
  const h = buildHarness();
  const row = await register(h, 'writer@example.com', 'password123');
  const user = { ...row };

  const wrongPwd = await h.call('POST', '/api/auth/delete-account', { confirmEmail: 'writer@example.com', password: 'bad-password' }, user);
  assert.equal(wrongPwd.status, 400);
  const wrongEmail = await h.call('POST', '/api/auth/delete-account', { confirmEmail: 'other@example.com', password: 'password123' }, user);
  assert.equal(wrongEmail.status, 400);
  assert.equal(h.deactivated.length, 0);

  const ok = await h.call('POST', '/api/auth/delete-account', { confirmEmail: 'writer@example.com', password: 'password123' }, user);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
  assert.deepEqual(h.deactivated, [row.userId]);
  assert.deepEqual(h.revoked, [row.userId]);
  assert.equal(h.accounts.has('writer@example.com'), false);

  const login = await h.call('POST', '/api/auth/login', { email: 'writer@example.com', password: 'password123' }, null);
  assert.notEqual(login.status, 200);

  // 邮箱释放后重新注册：稳定 ID 被墓碑占用，必须派生新 ID 且不继承旧账号
  const again = await register(h, 'writer@example.com', 'newpassword456');
  assert.notEqual(again.userId, row.userId);
});

test('delete-account requires authentication and refuses admin and local-open accounts', async () => {
  const h = buildHarness({ adminEmails: ['root@example.com'], localEmail: 'local@molan.local' });
  const anon = await h.call('POST', '/api/auth/delete-account', { confirmEmail: 'a@b.co', password: 'x' }, null);
  assert.equal(anon.status, 401);

  const admin = await h.call('POST', '/api/auth/delete-account', { confirmEmail: 'root@example.com', password: 'x' }, { email: 'root@example.com', userId: 'usr_admin' });
  assert.equal(admin.status, 403);
  const local = await h.call('POST', '/api/auth/delete-account', { confirmEmail: 'local@molan.local', password: 'x' }, { email: 'local@molan.local', userId: 'usr_local' });
  assert.equal(local.status, 403);
  assert.equal(h.deactivated.length, 0);
});

test('account deletion UI and repository contract are wired in SPA, standalone modal, and PostgreSQL repository', () => {
  const root = path.resolve(__dirname, '..');
  const platform = fs.readFileSync(path.join(root, 'completion-platform.js'), 'utf8');
  const account = fs.readFileSync(path.join(root, 'pages', 'account.js'), 'utf8');
  const repo = fs.readFileSync(path.join(root, 'lib', 'postgres-repository.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.ok(platform.includes('data-c-action="account-delete"') && platform.includes("'/api/auth/delete-account'"));
  assert.ok(account.includes('data-account-delete') && account.includes('/api/auth/delete-account'));
  assert.ok(repo.includes('runtimeDeactivateAccount') && repo.includes("role <> 'admin'"));
  assert.ok(server.includes('deleteAccount: handleDeleteAccount'));
});
