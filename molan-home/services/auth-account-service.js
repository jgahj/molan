'use strict';

/**
 * PostgreSQL-only account and session lifecycle (PG-only 收敛后).
 * 历史：本文件原为 SQLite/JSON/PG 三模账户服务；2026-10-16 按用户 PG-only 授权
 * （docs/postgres-only-checkpoint-20261002.md）坍缩全部 POSTGRES_MODE 双模分支，
 * 删除同步账户缓存（loadUsers/saveUsers/saveUser/getUserByEmail/getUserById/
 * userFromDbRow/persistUsersToDb）与会话文件持久化（persistSessions/flushSessions/
 * flushSessionsSync）——这些路径在生产已被 PG 分支取代，仅 dev/test 可达。
 * 保留：内存撤销标记（locallyRevokedSessions）、PG 会话 hydration/订阅、密码记录、
 * 会话令牌哈希与 scope 归一（无存储依赖的纯函数）。
 */
function createAuthAccountService({
  SESSION_TTL_MS,
  allowAuthAttempt,
  authAttemptLimiter,
  applyAuthSessionInvalidation,
  canChooseModel,
  crypto,
  currentDefaultModel,
  findPlatformModel,
  getPostgresUsageSummary,
  isAdminUser,
  json,
  normalizeUserRole,
  postgresRepository,
  postgresRuntimeUserFromRow,
  projectScope,
  readBody,
  requestError,
  respondError,
  sessionEventUserId
}) {
  const cryptoModule = crypto || require('node:crypto');
  const util = require('node:util');
  const scryptAsync = util.promisify(cryptoModule.scrypt);
  const PASSWORD_SCRYPT_KEYLEN = 64;
  const PASSWORD_SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
  const MAX_AVATAR_DATA_LENGTH = 300000;
  const AVATAR_DATA_URL_RE = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i;
  const sessions = new Map();
  const locallyRevokedSessions = new Map();

  async function insertUserIfAbsent(user) {
    const email = String(user && user.email || '').trim().toLowerCase();
    if (!email) return false;
    const normalized = { ...user, email, userId: String(user.userId || projectScope.stableUserId(email)) };
    const saved = await postgresRepository.runtimeRegisterAccount({ ...normalized, createdAtText: normalized.createdAt });
    if (!saved) throw requestError(503, '账户创建未得到数据库确认');
    Object.assign(user, postgresRuntimeUserFromRow(saved));
    return true;
  }

  function hashPwd(pwd, salt) {
    return cryptoModule.createHash('sha256').update(String(pwd) + ':' + salt).digest('hex');
  }

  function createPasswordRecord(password) {
    const salt = cryptoModule.randomBytes(16).toString('hex');
    const derived = cryptoModule.scryptSync(String(password), Buffer.from(salt, 'hex'), PASSWORD_SCRYPT_KEYLEN, PASSWORD_SCRYPT_OPTIONS).toString('hex');
    return { salt, pwd: 'scrypt$' + derived };
  }

  async function createPasswordRecordAsync(password) {
    const salt = cryptoModule.randomBytes(16).toString('hex');
    const derived = await scryptAsync(String(password), Buffer.from(salt, 'hex'), PASSWORD_SCRYPT_KEYLEN, PASSWORD_SCRYPT_OPTIONS);
    return { salt, pwd: 'scrypt$' + derived.toString('hex') };
  }

  function verifyPassword(password, user) {
    const stored = String(user && user.pwd || '');
    if (stored.startsWith('scrypt$')) {
      try {
        const expected = Buffer.from(stored.slice(7), 'hex');
        const actual = cryptoModule.scryptSync(String(password), Buffer.from(String(user.salt || ''), 'hex'), PASSWORD_SCRYPT_KEYLEN, PASSWORD_SCRYPT_OPTIONS);
        return { ok: expected.length === actual.length && cryptoModule.timingSafeEqual(expected, actual), needsUpgrade: false };
      } catch (_) {
        return { ok: false, needsUpgrade: false };
      }
    }
    return { ok: hashPwd(password, user && user.salt) === stored, needsUpgrade: true };
  }

  async function verifyPasswordAsync(password, user) {
    const stored = String(user && user.pwd || '');
    if (stored.startsWith('scrypt$')) {
      try {
        const expected = Buffer.from(stored.slice(7), 'hex');
        const actual = await scryptAsync(String(password), Buffer.from(String(user.salt || ''), 'hex'), PASSWORD_SCRYPT_KEYLEN, PASSWORD_SCRYPT_OPTIONS);
        return { ok: expected.length === actual.length && cryptoModule.timingSafeEqual(expected, actual), needsUpgrade: false };
      } catch (_) {
        return { ok: false, needsUpgrade: false };
      }
    }
    return { ok: hashPwd(password, user && user.salt) === stored, needsUpgrade: true };
  }

  function markSessionRevoked(tokenHash) {
    locallyRevokedSessions.set(String(tokenHash || '').toLowerCase(), Date.now() + SESSION_TTL_MS);
  }

  function isSessionRevoked(tokenHash) {
    const key = String(tokenHash || '').toLowerCase();
    const expiresAt = locallyRevokedSessions.get(key);
    if (!expiresAt) return false;
    if (expiresAt <= Date.now()) {
      locallyRevokedSessions.delete(key);
      return false;
    }
    return true;
  }

  function hashSessionToken(token) {
    return cryptoModule.createHash('sha256').update('molan-session:' + String(token || '')).digest('hex');
  }

  function normalizeSessionScope(value) {
    return String(value || '').trim().toLowerCase() === 'admin' ? 'admin' : 'client';
  }

  function loadSessions() {
    sessions.clear();
    void hydratePostgresSessions();
  }

  async function hydratePostgresSessions() {
    if (!postgresRepository.enabled) return;
    try {
      await postgresRepository.subscribeAuthSessionInvalidation(event => {
        if (!event || !event.event) return;
        if (applyAuthSessionInvalidation(sessions, event)) return;
        const userId = sessionEventUserId(event);
        if (event.event === 'created' && event.tokenHash && userId) {
          const tokenHash = String(event.tokenHash).toLowerCase();
          if (isSessionRevoked(tokenHash)) {
            void postgresRepository.revokeAuthSession(tokenHash).catch(() => {});
            return;
          }
          sessions.set(tokenHash, {
            userId,
            email: '',
            expiresAt: Number(event.expiresAt) || 0,
            scope: normalizeSessionScope(event.scope),
            dbBacked: true
          });
        }
      });
      const records = await postgresRepository.listAuthSessions();
      const now = Date.now();
      records.forEach(record => {
        if (!/^[a-f0-9]{64}$/i.test(record.tokenHash) || !record.userId || record.expiresAt <= now || isSessionRevoked(record.tokenHash)) return;
        sessions.set(record.tokenHash, {
          userId: record.userId,
          email: '',
          expiresAt: record.expiresAt,
          scope: normalizeSessionScope(record.scope),
          dbBacked: true
        });
      });
    } catch (error) {
      console.error('[sessions] PostgreSQL 共享会话恢复失败：' + String(error && error.code || 'pg_unavailable'), {
        databaseCode: String(error && error.databaseCode || ''),
        databaseMessage: String(error && error.databaseMessage || '').slice(0, 240)
      });
    }
  }

  function issueToken(email, scope = 'client') {
    return issuePostgresToken(email, scope);
  }

  async function issuePostgresToken(email, scope) {
    const user = postgresRuntimeUserFromRow(await postgresRepository.runtimeAccountByEmail(email));
    if (!user) throw requestError(401, '账户不存在');
    const token = cryptoModule.randomBytes(24).toString('hex');
    await postgresRepository.createAuthSession({
      sessionId: cryptoModule.randomUUID(), userId: user.userId, legacyId: user.userId,
      tokenHash: hashSessionToken(token), scope: normalizeSessionScope(scope),
      expiresAt: Date.now() + SESSION_TTL_MS
    });
    return token;
  }

  function getAuthUser(req, expectedScope = 'client') {
    const targetScope = normalizeSessionScope(expectedScope);
    const verified = req.molanPostgresAuth;
    if (!verified) return null;
    const verifiedScope = normalizeSessionScope(verified.scope);
    if (targetScope !== verifiedScope) return null;
    return { token: verified.token, user: verified.user };
  }

  function publicUser(u) {
    const role = normalizeUserRole(u);
    const isAdmin = role === 'admin';
    const view = {
      userId: String(u.userId || projectScope.stableUserId(u.email)),
      email: u.email,
      name: u.name,
      avatar: storedAvatar(u.avatar),
      bio: String(u.bio || ''),
      defaultModel: String(u.defaultModel || ''),
      role,
      level: role,
      plan: role,
      costMultiplier: isAdmin ? 0 : (role === 'vip' ? 1 : 2),
      isAdmin,
      unlimitedCredits: isAdmin,
      credits: isAdmin ? null : (u.credits == null ? 500 : u.credits),
      spent: Math.round((Number(u.spent) || 0) * 100) / 100,
      createdAt: u.createdAt
    };
    return getPostgresUsageSummary(u.userId, false).then(usage => ({ ...view, usage }));
  }

  function normalizeAvatar(value, fallback) {
    if (value === undefined) return fallback == null ? '' : String(fallback);
    const avatar = String(value || '').trim();
    if (!avatar) return '';
    if (avatar.length > MAX_AVATAR_DATA_LENGTH || !AVATAR_DATA_URL_RE.test(avatar)) {
      throw requestError(400, '头像必须是 PNG、JPG、WebP 或 GIF 图片，且不能超过 220 KB');
    }
    return avatar;
  }

  function storedAvatar(value) {
    try { return normalizeAvatar(value, ''); } catch (_) { return ''; }
  }

  function handleRegister(req, res) {
    if (!allowAuthAttempt(req, 'register', 20)) return json(res, 429, { error: '操作过于频繁，请稍后再试' }, { 'Retry-After': String(authRetryAfter(req, 'register')) });
    readBody(req).then(async p => {
      const email = String(p.email || '').trim().toLowerCase();
      const password = String(p.password || '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('邮箱格式不正确');
      if (password.length < 6 || password.length > 256) throw new Error('密码长度需为 6 到 256 位');
      if (await postgresRepository.runtimeAccountByEmail(email)) {
        throw requestError(409, '该邮箱已注册，请直接登录');
      }
      const passwordRecord = await createPasswordRecordAsync(password);
      const role = isAdminUser(email) ? 'admin' : 'normal';
      const user = {
        email, name: String(p.name || email.split('@')[0]).slice(0, 24),
        avatar: '',
        salt: passwordRecord.salt, pwd: passwordRecord.pwd,
        role, level: role, plan: role, credits: role === 'admin' ? 0 : 500, spent: 0,
        createdAt: new Date().toISOString()
      };
      if (!await insertUserIfAbsent(user)) throw requestError(409, '该邮箱已注册，请直接登录');
      json(res, 200, { ok: true, token: await issueToken(email), user: await publicUser(user) });
    }).catch(e => respondError(res, e));
  }

  async function authenticatePasswordLogin(email, password) {
    const user = postgresRuntimeUserFromRow(await postgresRepository.runtimeAccountByEmail(email));
    if (!user) throw new Error('邮箱或密码错误');
    const verification = await verifyPasswordAsync(password, user);
    if (!verification.ok) throw new Error('邮箱或密码错误');
    if (verification.needsUpgrade) {
      const passwordRecord = await createPasswordRecordAsync(password);
      user.salt = passwordRecord.salt;
      user.pwd = passwordRecord.pwd;
      await postgresRepository.runtimeUpdateAccount({ ...user, actorUserId: user.userId, preserveFinancials: true });
    }
    return user;
  }

  /** 登录失败计数：达到软/硬阈值后自动收紧或阻断（XFF 还原真实客户端 IP） */
  function recordAuthFailure(req, scope) {
    try { if (authAttemptLimiter) authAttemptLimiter.recordFailure(req, scope); } catch (_) {}
  }

  /** 登录成功清零失败计数，避免共享 NAT/误操作牵连后续正常登录 */
  function recordAuthSuccess(req, scope) {
    try { if (authAttemptLimiter) authAttemptLimiter.recordSuccess(req, scope); } catch (_) {}
  }

  /** 429 响应的 Retry-After 秒数 */
  function authRetryAfter(req, scope) {
    try { return authAttemptLimiter ? authAttemptLimiter.retryAfterSeconds(req, scope) : 0; } catch (_) { return 0; }
  }

  function handleLogin(req, res) {
    if (!allowAuthAttempt(req, 'login', 20)) return json(res, 429, { error: '操作过于频繁，请稍后再试' }, { 'Retry-After': String(authRetryAfter(req, 'login')) });
    readBody(req).then(async p => {
      const email = String(p.email || '').trim().toLowerCase();
      const password = String(p.password || '');
      let user;
      try {
        user = await authenticatePasswordLogin(email, password);
      } catch (e) {
        recordAuthFailure(req, 'login');
        throw e;
      }
      recordAuthSuccess(req, 'login');
      json(res, 200, { ok: true, token: await issueToken(user.email, 'client'), user: await publicUser(user) });
    }).catch(e => respondError(res, e));
  }

  function handleAdminLogin(req, res) {
    if (!allowAuthAttempt(req, 'admin-login', 20)) return json(res, 429, { error: '操作过于频繁，请稍后再试' }, { 'Retry-After': String(authRetryAfter(req, 'admin-login')) });
    readBody(req).then(async p => {
      const email = String(p.email || '').trim().toLowerCase();
      const password = String(p.password || '');
      let user;
      try {
        user = await authenticatePasswordLogin(email, password);
      } catch (e) {
        recordAuthFailure(req, 'admin-login');
        throw e;
      }
      recordAuthSuccess(req, 'admin-login');
      if (!isAdminUser(user)) throw requestError(403, '该账户没有管理员权限');
      json(res, 200, { ok: true, token: await issueToken(user.email, 'admin'), user: await publicUser(user) });
    }).catch(e => respondError(res, e));
  }

  function handleSendCode(req, res) {
    json(res, 410, { error: '邮箱验证码登录暂未开放，请使用邮箱和密码登录' });
  }

  function handleLoginByCode(req, res) {
    json(res, 410, { error: '邮箱验证码登录暂未开放，请使用邮箱和密码登录' });
  }

  async function handleMe(req, res) {
    const a = getAuthUser(req);
    if (!a) return json(res, 401, { error: '未登录' });
    json(res, 200, { ok: true, user: await publicUser(a.user) });
  }

  async function handleAdminMe(req, res) {
    const a = getAuthUser(req, 'admin');
    if (!a) return json(res, 401, { error: '未登录管理后台' });
    if (!isAdminUser(a.user)) return json(res, 403, { error: '该账户没有管理员权限' });
    json(res, 200, { ok: true, user: await publicUser(a.user) });
  }

  function handleProfile(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    readBody(req).then(async body => {
      const user = auth.user;
      if (body.name !== undefined) {
        const name = String(body.name || '').trim();
        if (name.length > 24) throw requestError(400, '昵称不能超过 24 个字符');
        user.name = name || String(user.email || '').split('@')[0].slice(0, 24);
      }
      if (Object.prototype.hasOwnProperty.call(body, 'avatar')) user.avatar = normalizeAvatar(body.avatar, '');
      if (body.bio !== undefined) {
        const bio = String(body.bio || '').trim();
        if (bio.length > 500) throw requestError(400, '个人简介不能超过 500 个字符');
        user.bio = bio;
      }
      if (body.defaultModel !== undefined) {
        const requestedModel = String(body.defaultModel || '').trim();
        if (requestedModel && !findPlatformModel(requestedModel)) throw requestError(400, '默认模型不存在或未配置');
        user.defaultModel = canChooseModel(user) ? (requestedModel || currentDefaultModel()) : currentDefaultModel();
      }
      const row = await postgresRepository.runtimeUpdateAccountProfile({
        actorUserId: auth.user.userId,
        userId: auth.user.userId,
        name: user.name,
        avatar: user.avatar,
        bio: user.bio,
        defaultModel: user.defaultModel
      });
      const saved = postgresRuntimeUserFromRow(row);
      if (saved && saved !== user) Object.assign(user, saved);
      json(res, 200, { ok: true, user: await publicUser(user) });
    }).catch(e => respondError(res, e));
  }

  async function handleLogout(req, res, expectedScope = 'client') {
    const auth = req.headers['authorization'] || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (token && !getAuthUser(req, expectedScope)) return json(res, 401, { error: '登录态无效或用途不匹配' });
    if (token) {
      const tokenHash = hashSessionToken(token);
      markSessionRevoked(tokenHash);
      sessions.delete(tokenHash);
      if (postgresRepository.enabled) {
        await postgresRepository.revokeAuthSession(tokenHash);
      }
    }
    json(res, 200, { ok: true });
  }

  async function handleLogoutAll(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    const userId = String(auth.user.userId || projectScope.stableUserId(auth.user.email)).trim();
    const email = String(auth.user.email || '').trim().toLowerCase();
    let removed = 0;
    for (const [tokenHash, record] of sessions.entries()) {
      if (record && (String(record.userId || '') === userId || !record.userId && String(record.email || '').toLowerCase() === email)) {
        markSessionRevoked(tokenHash);
        sessions.delete(tokenHash);
        removed += 1;
      }
    }
    if (postgresRepository.enabled) {
      await postgresRepository.revokeAuthSessions(userId);
    }
    json(res, 200, { ok: true, removed });
  }

  return {
    insertUserIfAbsent, createPasswordRecord, createPasswordRecordAsync, verifyPassword, verifyPasswordAsync, markSessionRevoked, isSessionRevoked, hashSessionToken, normalizeSessionScope, loadSessions, hydratePostgresSessions, issueToken, getAuthUser, publicUser, normalizeAvatar, storedAvatar, handleRegister, authenticatePasswordLogin, handleLogin, handleAdminLogin, handleSendCode, handleLoginByCode, handleMe, handleAdminMe, handleProfile, handleLogout, handleLogoutAll, sessions
  };
}

module.exports = { createAuthAccountService };
