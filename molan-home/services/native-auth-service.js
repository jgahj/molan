'use strict';

function createNativeAuthService({ repository, crypto, readBody, json, respondError, createPasswordRecord,
  verifyPassword, hashSessionToken, publicUser, allowAuthAttempt, isAdminUser, normalizeAvatar,
  findPlatformModel, canChooseModel, currentDefaultModel, sessionTtlMs, now = Date.now }) {
  const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
  const scopeOf = value => value === 'admin' ? 'admin' : 'client';
  async function resolve(req) {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!token || token.length > 256) return null;
    const session = await repository.getAuthSession(hashSessionToken(token));
    return session ? { token, user: session.user, scope: scopeOf(session.scope) } : null;
  }
  function getAuthUser(req, expectedScope = 'client') {
    const auth = req.molanNativeAuth;
    return auth && auth.scope === scopeOf(expectedScope) ? auth : null;
  }
  async function issueToken(user, scope = 'client') {
    const token = crypto.randomBytes(24).toString('hex');
    await repository.createAuthSession({ userId: user.userId, tokenHash: hashSessionToken(token), scope,
      expiresAt: now() + sessionTtlMs });
    return token;
  }
  function execute(req, res, action) {
    return Promise.resolve().then(action).catch(error => respondError(res, error));
  }
  function register(req, res) {
    if (!allowAuthAttempt(req, 'register', 20)) return json(res, 429, { error: '操作过于频繁，请稍后再试' });
    return execute(req, res, async () => {
      const body = await readBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, '邮箱格式不正确');
      if (password.length < 6 || password.length > 256) fail(400, '密码长度需为 6 到 256 位');
      if (await repository.getAccount({ email })) fail(409, '该邮箱已注册，请直接登录');
      const user = await repository.saveAccount({ email, name: String(body.name || email.split('@')[0]).slice(0, 24),
        avatar: '', ...createPasswordRecord(password), role: 'normal', level: 'normal', plan: 'normal',
        credits: 500, spent: 0, createdAt: new Date(now()).toISOString() }, 0);
      return json(res, 200, { ok: true, token: await issueToken(user), user: await publicUser(user) });
    });
  }
  function loginFor(scope) {
    return function login(req, res) {
      if (!allowAuthAttempt(req, scope === 'admin' ? 'admin-login' : 'login', 20)) return json(res, 429, { error: '操作过于频繁，请稍后再试' });
      return execute(req, res, async () => {
        const body = await readBody(req);
        let user = await repository.getAccount({ email: String(body.email || '').trim().toLowerCase() });
        const verification = user && verifyPassword(String(body.password || ''), user);
        if (!verification?.ok) fail(400, '邮箱或密码错误');
        if (user.disabled || user.status === 'disabled') fail(403, '该账户已停用');
        if (scope === 'admin' && !isAdminUser(user)) fail(403, '该账户没有管理员权限');
        if (verification.needsUpgrade) user = await repository.saveAccount({ ...user, ...createPasswordRecord(String(body.password || '')) }, user.revision);
        return json(res, 200, { ok: true, token: await issueToken(user, scope), user: await publicUser(user) });
      });
    };
  }
  function meFor(scope) {
    return (req, res) => execute(req, res, async () => {
      const auth = getAuthUser(req, scope);
      if (!auth) return json(res, 401, { error: scope === 'admin' ? '未登录管理后台' : '未登录' });
      if (scope === 'admin' && !isAdminUser(auth.user)) return json(res, 403, { error: '该账户没有管理员权限' });
      return json(res, 200, { ok: true, user: await publicUser(auth.user) });
    });
  }
  function profile(req, res) {
    return execute(req, res, async () => {
      const auth = getAuthUser(req);
      if (!auth) return json(res, 401, { error: '未登录' });
      const body = await readBody(req);
      const user = { ...auth.user };
      if (body.name !== undefined) {
        const name = String(body.name || '').trim();
        if (name.length > 24) fail(400, '昵称不能超过 24 个字符');
        user.name = name || user.email.split('@')[0].slice(0, 24);
      }
      if (Object.hasOwn(body, 'avatar')) user.avatar = normalizeAvatar(body.avatar, '');
      if (body.bio !== undefined) {
        user.bio = String(body.bio || '').trim();
        if (user.bio.length > 500) fail(400, '个人简介不能超过 500 个字符');
      }
      if (body.defaultModel !== undefined) {
        const requested = String(body.defaultModel || '').trim();
        if (requested && !findPlatformModel(requested)) fail(400, '默认模型不存在或未配置');
        user.defaultModel = canChooseModel(user) ? requested || currentDefaultModel() : currentDefaultModel();
      }
      const saved = await repository.saveAccount(user, user.revision);
      return json(res, 200, { ok: true, user: await publicUser(saved) });
    });
  }
  function logout(req, res, scope = 'client') {
    return execute(req, res, async () => {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
      if (token && !getAuthUser(req, scope)) return json(res, 401, { error: '登录态无效或用途不匹配' });
      if (token) await repository.revokeAuthSession(hashSessionToken(token));
      return json(res, 200, { ok: true });
    });
  }
  function logoutAll(req, res) {
    return execute(req, res, async () => {
      const auth = getAuthUser(req);
      if (!auth) return json(res, 401, { error: '未登录' });
      const sessions = (await repository.listAuthSessions()).filter(row => row.userId === auth.user.userId);
      for (const session of sessions) await repository.revokeAuthSession(session.tokenHash);
      return json(res, 200, { ok: true, removed: sessions.length });
    });
  }
  return { resolve, getAuthUser, register, login: loginFor('client'), adminLogin: loginFor('admin'),
    me: meFor('client'), adminMe: meFor('admin'), profile, logout, logoutAll, issueToken };
}

module.exports = { createNativeAuthService };
