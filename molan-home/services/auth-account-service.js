'use strict';

/** Legacy account and session lifecycle; mutable databases are resolved at call time. */
function createAuthAccountService({
  DATA_DIR,
  POSTGRES_MODE,
  SESSIONS_FILE,
  SESSION_TTL_MS,
  USERS_FILE,
  USER_CACHE_TTL_MS,
  allowAuthAttempt,
  applyAuthSessionInvalidation,
  cachePostgresRuntimeUser,
  canChooseModel,
  crypto,
  currentDefaultModel,
  dbReady,
  enqueuePostgresRuntimeWrite,
  findPlatformModel,
  fs,
  getDatabase,
  getPostgresRuntimeUserByEmail,
  getUsageSummary,
  isAdminUser,
  json,
  nativeAuthService,
  normalizeUserRole,
  postgresRepository,
  postgresRuntimeState,
  postgresRuntimeUserFromRow,
  projectScope,
  readBody,
  requestError,
  respondError,
  sessionEventUserId
}) {
  const PASSWORD_SCRYPT_KEYLEN = 64;
  const PASSWORD_SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
  const MAX_AVATAR_DATA_LENGTH = 300000;
  const AVATAR_DATA_URL_RE = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i;
  const sessions = new Map();
  const locallyRevokedSessions = new Map();
  let sessionsPersistTimer = null;
  let sessionsPersistInFlight = false;
  let sessionsPersistDirty = false;
  let usersCache = null;
  let usersCacheMtimeMs = 0;
  let usersCacheCheckedAt = 0;

  function loadUsers() {
    if (POSTGRES_MODE) return postgresRuntimeState.accounts.slice();
    if (dbReady()) {
      return getDatabase().prepare(`SELECT email, user_id AS userId, name, avatar, bio, default_model AS defaultModel, salt, pwd, role, level, plan, credits, spent, created_at AS createdAt
        FROM accounts ORDER BY created_at ASC`).all().map(userFromDbRow);
    }
    const now = Date.now();
    if (usersCache && now - usersCacheCheckedAt < USER_CACHE_TTL_MS) return usersCache;
    try {
      const stat = fs.statSync(USERS_FILE);
      if (usersCache && stat.mtimeMs === usersCacheMtimeMs) {
        usersCacheCheckedAt = now;
        return usersCache;
      }
      const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
      if (!Array.isArray(users)) return [];
      let changed = false;
      for (const user of users) {
        if (!user || typeof user !== 'object') continue;
        if (!user.userId) { user.userId = projectScope.stableUserId(user.email); changed = true; }
        const role = normalizeUserRole(user);
        if (user.role !== role) { user.role = role; changed = true; }
        if (user.plan !== role) { user.plan = role; changed = true; }
        if (user.credits == null && role !== 'admin') { user.credits = 500; changed = true; }
        if (typeof user.avatar !== 'string') { user.avatar = ''; changed = true; }
      }
      usersCache = users;
      usersCacheMtimeMs = stat.mtimeMs;
      usersCacheCheckedAt = now;
      if (changed) saveUsers(users);
      return usersCache;
    } catch (_) { return []; }
  }
  
  function saveUsers(users) {
    if (POSTGRES_MODE) {
      const next = Array.isArray(users) ? users : [];
      postgresRuntimeState.accounts = next;
      postgresRuntimeState.accountsByEmail.clear();
      postgresRuntimeState.accountsById.clear();
      next.forEach(user => {
        if (!user || !user.email) return;
        postgresRuntimeState.accountsByEmail.set(String(user.email).trim().toLowerCase(), user);
        postgresRuntimeState.accountsById.set(String(user.userId || ''), user);
      });
      usersCache = next;
      usersCacheCheckedAt = Date.now();
      for (const user of next) saveUser(user);
      return;
    }
    if (dbReady()) {
      persistUsersToDb(users);
      return;
    }
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
    usersCache = users;
    usersCacheCheckedAt = Date.now();
    try { usersCacheMtimeMs = fs.statSync(USERS_FILE).mtimeMs; } catch (_) {}
  }
  
  function saveUser(user, actorUserId = '') {
    if (POSTGRES_MODE) {
      if (!user || !user.email) return user;
      const email = String(user.email).trim().toLowerCase();
      const normalized = { ...user, email, userId: String(user.userId || projectScope.stableUserId(email)) };
      const previous = postgresRuntimeState.accountsByEmail.get(email);
      const preserveFinancials = !!previous &&
        Number(previous.credits) === Number(normalized.credits) &&
        Number(previous.spent) === Number(normalized.spent);
      if (previous) Object.assign(previous, normalized);
      else postgresRuntimeState.accounts.push(normalized);
      const current = previous || normalized;
      postgresRuntimeState.accountsByEmail.set(email, current);
      postgresRuntimeState.accountsById.set(current.userId, current);
      usersCache = postgresRuntimeState.accounts;
      usersCacheCheckedAt = Date.now();
      const write = previous
        ? enqueuePostgresRuntimeWrite('account-update', () => postgresRepository.runtimeUpdateAccount({ actorUserId: actorUserId || current.userId, ...current, createdAtText: current.createdAt, preserveFinancials }))
        : enqueuePostgresRuntimeWrite('account-register', () => postgresRepository.runtimeRegisterAccount({ ...current, createdAtText: current.createdAt }));
      try { Object.defineProperty(current, '__postgresWrite', { value: write, enumerable: false, configurable: true }); } catch (_) {}
      return current;
    }
    if (dbReady()) {
      persistUsersToDb([{ ...user, userId: user.userId || projectScope.stableUserId(user.email) }]);
      const saved = getUserByEmail(user.email);
      if (saved) projectScope.ensureUserWorkspace(getDatabase(), saved);
      return;
    }
    if (user && !user.userId) user.userId = projectScope.stableUserId(user.email);
    const users = loadUsers();
    const index = users.findIndex(item => item.email === user.email);
    if (index >= 0) users[index] = user; else users.push(user);
    saveUsers(users);
  }
  
  async function insertUserIfAbsent(user) {
    const email = String(user && user.email || '').trim().toLowerCase();
    if (!email) return false;
    if (POSTGRES_MODE) {
      if (postgresRuntimeState.accountsByEmail.has(email)) return false;
      const normalized = { ...user, email, userId: String(user.userId || projectScope.stableUserId(email)) };
      postgresRuntimeState.accounts.push(normalized);
      postgresRuntimeState.accountsByEmail.set(email, normalized);
      postgresRuntimeState.accountsById.set(normalized.userId, normalized);
      usersCache = postgresRuntimeState.accounts;
      usersCacheCheckedAt = Date.now();
      const write = enqueuePostgresRuntimeWrite('account-register', () => postgresRepository.runtimeRegisterAccount({ ...normalized, createdAtText: normalized.createdAt }));
      try { Object.defineProperty(normalized, '__postgresWrite', { value: write, enumerable: false, configurable: true }); } catch (_) {}
      await write;
      return true;
    }
    if (dbReady()) {
      const role = normalizeUserRole(user);
      const userId = String(user.userId || projectScope.stableUserId(email));
      const result = getDatabase().prepare(`INSERT OR IGNORE INTO accounts
        (email, user_id, name, avatar, bio, default_model, salt, pwd, role, level, plan, credits, spent, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        email,
        userId,
        String(user.name || email).slice(0, 24),
        storedAvatar(user.avatar),
        String(user.bio || '').slice(0, 500),
        String(user.defaultModel || '').slice(0, 120),
        String(user.salt || ''),
        String(user.pwd || ''),
        role,
        role,
        role,
        role === 'admin' ? 0 : Math.max(0, Number(user.credits) || 0),
        Math.max(0, Number(user.spent) || 0),
        String(user.createdAt || new Date().toISOString())
      );
      const saved = getUserByEmail(email);
      if (saved) projectScope.ensureUserWorkspace(getDatabase(), saved);
      return Number(result.changes || 0) === 1;
    }
    const users = loadUsers();
    if (users.some(item => String(item && item.email || '').trim().toLowerCase() === email)) return false;
    users.push(user);
    saveUsers(users);
    return true;
  }
  
  function userFromDbRow(row) {
    return {
      email: row.email,
      userId: row.userId || row.user_id || projectScope.stableUserId(row.email),
      name: row.name,
      avatar: storedAvatar(row.avatar),
      bio: String(row.bio || ''),
      defaultModel: String(row.defaultModel || ''),
      salt: row.salt,
      pwd: row.pwd,
      role: row.role,
      level: row.level,
      plan: row.plan,
      credits: Number(row.credits) || 0,
      spent: Number(row.spent) || 0,
      createdAt: row.createdAt
    };
  }
  
  function getUserByEmail(email) {
    const key = String(email || '').trim().toLowerCase();
    if (!key) return null;
    if (POSTGRES_MODE) return postgresRuntimeState.accountsByEmail.get(key) || null;
    if (dbReady()) {
      const row = getDatabase().prepare(`SELECT email, user_id AS userId, name, avatar, bio, default_model AS defaultModel, salt, pwd, role, level, plan, credits, spent, created_at AS createdAt
        FROM accounts WHERE email = ?`).get(key);
      return row ? userFromDbRow(row) : null;
    }
    return loadUsers().find(user => String(user.email || '').toLowerCase() === key) || null;
  }
  
  function getUserById(userId) {
    const key = String(userId || '').trim();
    if (!key) return null;
    if (POSTGRES_MODE) return postgresRuntimeState.accountsById.get(key) || null;
    if (dbReady()) {
      const row = getDatabase().prepare(`SELECT email, user_id AS userId, name, avatar, bio, default_model AS defaultModel, salt, pwd, role, level, plan, credits, spent, created_at AS createdAt
        FROM accounts WHERE user_id = ?`).get(key);
      return row ? userFromDbRow(row) : null;
    }
    return loadUsers().find(user => String(user && user.userId || '') === key) || null;
  }
  
  function hashPwd(pwd, salt) {
    return crypto.createHash('sha256').update(String(pwd) + ':' + salt).digest('hex');
  }
  
  function createPasswordRecord(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = crypto.scryptSync(String(password), Buffer.from(salt, 'hex'), PASSWORD_SCRYPT_KEYLEN, PASSWORD_SCRYPT_OPTIONS).toString('hex');
    return { salt, pwd: 'scrypt$' + derived };
  }
  
  function verifyPassword(password, user) {
    const stored = String(user && user.pwd || '');
    if (stored.startsWith('scrypt$')) {
      try {
        const expected = Buffer.from(stored.slice(7), 'hex');
        const actual = crypto.scryptSync(String(password), Buffer.from(String(user.salt || ''), 'hex'), PASSWORD_SCRYPT_KEYLEN, PASSWORD_SCRYPT_OPTIONS);
        return { ok: expected.length === actual.length && crypto.timingSafeEqual(expected, actual), needsUpgrade: false };
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
    return crypto.createHash('sha256').update('molan-session:' + String(token || '')).digest('hex');
  }
  
  function normalizeSessionScope(value) {
    return String(value || '').trim().toLowerCase() === 'admin' ? 'admin' : 'client';
  }
  
  function loadSessions() {
    try {
      if (POSTGRES_MODE && postgresRepository.enabled) {
        sessions.clear();
        void hydratePostgresSessions();
        return;
      }
      if (dbReady()) {
        const rows = getDatabase().prepare('SELECT token_hash, email, user_id, scope, expires_at FROM auth_sessions WHERE revoked_at IS NULL AND expires_at > ?').all(Date.now());
        if (rows.length) {
          sessions.clear();
          rows.forEach(row => sessions.set(row.token_hash, {
            userId: row.user_id || projectScope.stableUserId(row.email),
            email: row.email, expiresAt: Number(row.expires_at), scope: normalizeSessionScope(row.scope), dbBacked: true
          }));
          return;
        }
      }
      const arr = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
      if (!Array.isArray(arr)) return;
      sessions.clear();
      const now = Date.now();
      let migrated = false;
      for (const item of arr) {
        let tokenHash = '', email = '', userId = '', expiresAt = 0, scope = 'client';
        if (Array.isArray(item)) {
          const value = item[1];
          if (value && typeof value === 'object') {
            tokenHash = String(item[0] || '');
            email = String(value.email || '').trim().toLowerCase();
            userId = String(value.userId || '').trim();
            expiresAt = Number(value.expiresAt) || 0;
            scope = normalizeSessionScope(value.scope);
            if (!Object.prototype.hasOwnProperty.call(value, 'scope')) migrated = true;
          } else {
            tokenHash = hashSessionToken(item[0]);
            email = String(value || '').trim().toLowerCase();
            expiresAt = now + SESSION_TTL_MS;
            migrated = true;
          }
        } else if (item && typeof item === 'object') {
          if (item.token) {
            tokenHash = hashSessionToken(item.token);
            migrated = true;
          } else {
            tokenHash = String(item.tokenHash || '');
          }
          email = String(item.email || '').trim().toLowerCase();
          userId = String(item.userId || '').trim();
          expiresAt = Number(item.expiresAt) || 0;
          scope = normalizeSessionScope(item.scope);
          if (!Object.prototype.hasOwnProperty.call(item, 'scope')) migrated = true;
        }
        if (!/^[a-f0-9]{64}$/i.test(tokenHash) || !email) continue;
        if (!expiresAt) { expiresAt = now + SESSION_TTL_MS; migrated = true; }
        if (expiresAt <= now) { migrated = true; continue; }
        userId = userId || projectScope.stableUserId(email);
        sessions.set(tokenHash, { userId, email, expiresAt, scope, dbBacked: dbReady() });
        if (dbReady()) {
          getDatabase().prepare(`INSERT OR REPLACE INTO auth_sessions
            (token_hash, email, user_id, scope, expires_at, created_at, revoked_at)
            VALUES (?, ?, ?, ?, ?, ?, NULL)`)
            .run(tokenHash, email, userId, scope, expiresAt, now);
        }
      }
      if (migrated) persistSessions();
    } catch (error) {
      // 保留损坏文件供排查，避免静默覆盖；服务仍以空会话表启动，小说数据不受影响。
      try { fs.copyFileSync(SESSIONS_FILE, SESSIONS_FILE + '.corrupt-' + Date.now()); } catch (_) {}
      console.error('[sessions] 会话文件损坏，已保留副本并清空内存会话：', error && error.message || error);
    }
  }
  
  async function hydratePostgresSessions() {
    if (!POSTGRES_MODE || !postgresRepository.enabled) return;
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
  
  function persistSessions() {
    sessionsPersistDirty = true;
    if (sessionsPersistInFlight || sessionsPersistTimer) return;
    sessionsPersistTimer = setTimeout(flushSessions, 100);
    sessionsPersistTimer.unref();
  }
  
  function flushSessions() {
    sessionsPersistTimer = null;
    if (sessionsPersistInFlight || !sessionsPersistDirty) return;
    sessionsPersistDirty = false;
    sessionsPersistInFlight = true;
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = SESSIONS_FILE + '.tmp';
    const payload = JSON.stringify([...sessions.entries()].map(([tokenHash, record]) => ({ tokenHash, ...record })));
    fs.writeFile(tmp, payload, 'utf-8', writeError => {
      if (writeError) {
        sessionsPersistInFlight = false;
        sessionsPersistDirty = true;
        return;
      }
      fs.rename(tmp, SESSIONS_FILE, renameError => {
        sessionsPersistInFlight = false;
        if (renameError) {
          sessionsPersistDirty = true;
          console.error('[sessions] 保存失败：', renameError.message || renameError);
        } else {
          try { fs.chmodSync(SESSIONS_FILE, 0o600); } catch (_) {}
        }
        if (sessionsPersistDirty && !sessionsPersistTimer) {
          sessionsPersistTimer = setTimeout(flushSessions, 100);
          sessionsPersistTimer.unref();
        }
      });
    });
  }
  
  function flushSessionsSync() {
    if (POSTGRES_MODE && postgresRepository.enabled) return;
    let fd = null;
    try {
      if (sessionsPersistTimer) clearTimeout(sessionsPersistTimer);
      sessionsPersistTimer = null;
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = SESSIONS_FILE + '.tmp';
      const payload = JSON.stringify([...sessions.entries()].map(([tokenHash, record]) => ({ tokenHash, ...record })));
      fd = fs.openSync(tmp, 'w', 0o600);
      fs.writeSync(fd, payload, null, 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = null;
      fs.renameSync(tmp, SESSIONS_FILE);
      try { fs.chmodSync(SESSIONS_FILE, 0o600); } catch (_) {}
      sessionsPersistDirty = false;
    } catch (error) {
      if (fd !== null) { try { fs.closeSync(fd); } catch (_) {} }
      console.error('[sessions] 退出时保存失败：', error && error.message || error);
      /* 进程退出时尽力落盘，失败不阻止服务退出 */
    }
  }
  
  function issueToken(email, scope = 'client') {
    const token = crypto.randomBytes(24).toString('hex');
    const tokenHash = hashSessionToken(token);
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const account = getUserByEmail(normalizedEmail);
    const userId = String(account && account.userId || projectScope.stableUserId(normalizedEmail)).trim();
    const expiresAt = Date.now() + SESSION_TTL_MS;
    const normalizedScope = normalizeSessionScope(scope);
    locallyRevokedSessions.delete(tokenHash);
    sessions.set(tokenHash, {
      userId,
      email: normalizedEmail,
      expiresAt,
      scope: normalizedScope,
      dbBacked: POSTGRES_MODE || dbReady()
    });
    if (POSTGRES_MODE && postgresRepository.enabled) {
      void postgresRepository.createAuthSession({
        sessionId: crypto.randomUUID(),
        userId,
        legacyId: userId,
        tokenHash,
        scope: normalizedScope,
        expiresAt
      }).catch(error => {
        sessions.delete(tokenHash);
        console.error('[sessions] PostgreSQL 会话写入失败：' + String(error && error.code || 'pg_unavailable'));
      });
      return token;
    }
    if (dbReady()) {
      getDatabase().prepare(`INSERT OR REPLACE INTO auth_sessions
        (token_hash, email, user_id, scope, expires_at, created_at, revoked_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL)`).run(tokenHash, normalizedEmail, userId, normalizedScope, expiresAt, Date.now());
    }
    persistSessions();
    return token;
  }
  
  function getAuthUser(req, expectedScope = 'client') {
    if (process.env.MOLAN_APP_STORE === 'json' && !POSTGRES_MODE) {
      return nativeAuthService().getAuthUser(req, expectedScope);
    }
    const auth = req.headers['authorization'] || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token || token.length > 256) return null;
    const tokenHash = hashSessionToken(token);
    if (isSessionRevoked(tokenHash)) return null;
    let session = sessions.get(tokenHash);
    if (!POSTGRES_MODE && dbReady()) {
      const row = getDatabase().prepare('SELECT email, user_id, scope, expires_at FROM auth_sessions WHERE token_hash = ? AND revoked_at IS NULL').get(tokenHash);
      if (row) {
        session = {
          userId: row.user_id || projectScope.stableUserId(row.email),
          email: row.email, expiresAt: Number(row.expires_at), scope: normalizeSessionScope(row.scope), dbBacked: true
        };
        sessions.set(tokenHash, session);
      } else if (session && session.dbBacked) {
        sessions.delete(tokenHash);
        return null;
      }
    }
    if (!session) return null;
    if (normalizeSessionScope(session.scope) !== normalizeSessionScope(expectedScope)) return null;
    if (session.expiresAt <= Date.now()) {
      sessions.delete(tokenHash);
      markSessionRevoked(tokenHash);
      if (POSTGRES_MODE && postgresRepository.enabled) {
        void postgresRepository.revokeAuthSession(tokenHash).catch(() => {});
      }
      if (!POSTGRES_MODE && dbReady()) getDatabase().prepare('UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ?').run(Date.now(), tokenHash);
      if (!POSTGRES_MODE) persistSessions();
      return null;
    }
    const user = session.userId ? getUserById(session.userId) || getUserByEmail(session.email) : getUserByEmail(session.email);
    if (user && session.userId !== user.userId) session.userId = user.userId;
    return user ? { token, user } : null;
  }
  
  function publicUser(u) {
    const role = normalizeUserRole(u);
    const isAdmin = role === 'admin';
    return {
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
      createdAt: u.createdAt,
      usage: getUsageSummary(u.email, false)
    };
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
    if (!allowAuthAttempt(req, 'register', 20)) return json(res, 429, { error: '操作过于频繁，请稍后再试' });
    readBody(req).then(async p => {
      const email = String(p.email || '').trim().toLowerCase();
      const password = String(p.password || '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('邮箱格式不正确');
      if (password.length < 6 || password.length > 256) throw new Error('密码长度需为 6 到 256 位');
      if (getUserByEmail(email)) throw new Error('该邮箱已注册，请直接登录');
      const passwordRecord = createPasswordRecord(password);
      const user = {
        email, name: String(p.name || email.split('@')[0]).slice(0, 24),
        avatar: '',
        salt: passwordRecord.salt, pwd: passwordRecord.pwd,
        role: 'normal', level: 'normal', plan: 'normal', credits: 500, spent: 0,
        createdAt: new Date().toISOString()
      };
      if (!await insertUserIfAbsent(user)) throw requestError(409, '该邮箱已注册，请直接登录');
      json(res, 200, { ok: true, token: issueToken(email), user: publicUser(user) });
    }).catch(e => respondError(res, e));
  }
  
  async function authenticatePasswordLogin(email, password) {
    let user = getUserByEmail(email);
    if (!user && POSTGRES_MODE && postgresRepository.enabled) {
      user = await getPostgresRuntimeUserByEmail(email);
    }
    if (!user) throw new Error('邮箱或密码错误');
    const verification = verifyPassword(password, user);
    if (!verification.ok) throw new Error('邮箱或密码错误');
    if (verification.needsUpgrade) {
      const passwordRecord = createPasswordRecord(password);
      user.salt = passwordRecord.salt;
      user.pwd = passwordRecord.pwd;
      saveUser(user);
    }
    return user;
  }
  
  function handleLogin(req, res) {
    if (!allowAuthAttempt(req, 'login', 20)) return json(res, 429, { error: '操作过于频繁，请稍后再试' });
    readBody(req).then(async p => {
      const email = String(p.email || '').trim().toLowerCase();
      const password = String(p.password || '');
      const user = await authenticatePasswordLogin(email, password);
      json(res, 200, { ok: true, token: issueToken(user.email, 'client'), user: publicUser(user) });
    }).catch(e => respondError(res, e));
  }
  
  function handleAdminLogin(req, res) {
    if (!allowAuthAttempt(req, 'admin-login', 20)) return json(res, 429, { error: '操作过于频繁，请稍后再试' });
    readBody(req).then(async p => {
      const email = String(p.email || '').trim().toLowerCase();
      const password = String(p.password || '');
      const user = await authenticatePasswordLogin(email, password);
      if (!isAdminUser(user)) throw requestError(403, '该账户没有管理员权限');
      json(res, 200, { ok: true, token: issueToken(user.email, 'admin'), user: publicUser(user) });
    }).catch(e => respondError(res, e));
  }
  
  function handleSendCode(req, res) {
    json(res, 410, { error: '邮箱验证码登录暂未开放，请使用邮箱和密码登录' });
  }
  
  function handleLoginByCode(req, res) {
    json(res, 410, { error: '邮箱验证码登录暂未开放，请使用邮箱和密码登录' });
  }
  
  function handleMe(req, res) {
    const a = getAuthUser(req);
    if (!a) return json(res, 401, { error: '未登录' });
    json(res, 200, { ok: true, user: publicUser(a.user) });
  }
  
  function handleAdminMe(req, res) {
    const a = getAuthUser(req, 'admin');
    if (!a) return json(res, 401, { error: '未登录管理后台' });
    if (!isAdminUser(a.user)) return json(res, 403, { error: '该账户没有管理员权限' });
    json(res, 200, { ok: true, user: publicUser(a.user) });
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
      if (POSTGRES_MODE) {
        const row = await postgresRepository.runtimeUpdateAccountProfile({
          actorUserId: auth.user.userId,
          userId: auth.user.userId,
          name: user.name,
          avatar: user.avatar,
          bio: user.bio,
          defaultModel: user.defaultModel
        });
        const saved = cachePostgresRuntimeUser(postgresRuntimeUserFromRow(row));
        if (saved && saved !== user) Object.assign(user, saved);
      } else {
        saveUser(user);
      }
      json(res, 200, { ok: true, user: publicUser(user) });
    }).catch(e => respondError(res, e));
  }
  
  function handleLogout(req, res, expectedScope = 'client') {
    const auth = req.headers['authorization'] || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (token && !getAuthUser(req, expectedScope)) return json(res, 401, { error: '登录态无效或用途不匹配' });
    if (token) {
      const tokenHash = hashSessionToken(token);
      markSessionRevoked(tokenHash);
      sessions.delete(tokenHash);
      if (POSTGRES_MODE && postgresRepository.enabled) {
        void postgresRepository.revokeAuthSession(tokenHash).catch(error => {
          console.error('[sessions] PostgreSQL 会话撤销失败：' + String(error && error.code || 'pg_unavailable'));
        });
      } else if (dbReady()) {
        getDatabase().prepare('UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ?').run(Date.now(), tokenHash);
      }
    }
    if (!POSTGRES_MODE) persistSessions();
    json(res, 200, { ok: true });
  }
  
  function handleLogoutAll(req, res) {
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
    if (POSTGRES_MODE && postgresRepository.enabled) {
      void postgresRepository.revokeAuthSessions(userId).catch(error => {
        console.error('[sessions] PostgreSQL 全部会话撤销失败：' + String(error && error.code || 'pg_unavailable'));
      });
    } else if (dbReady()) {
      getDatabase().prepare(`UPDATE auth_sessions SET revoked_at = ?
        WHERE (user_id = ? OR (user_id = '' AND email = ?)) AND revoked_at IS NULL`).run(Date.now(), userId, email);
    }
    if (!POSTGRES_MODE) persistSessions();
    json(res, 200, { ok: true, removed });
  }
  
  function persistUsersToDb(users) {
    if (!dbReady() || !Array.isArray(users) || !users.length) return;
    const insert = getDatabase().prepare(`INSERT INTO accounts
      (email, user_id, name, avatar, bio, default_model, salt, pwd, role, level, plan, credits, spent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        user_id = COALESCE(accounts.user_id, excluded.user_id),
        name = excluded.name, avatar = excluded.avatar, bio = excluded.bio, default_model = excluded.default_model,
        salt = excluded.salt, pwd = excluded.pwd,
        role = excluded.role, level = excluded.level, plan = excluded.plan,
        credits = excluded.credits, spent = excluded.spent, created_at = excluded.created_at`);
    getDatabase().exec('BEGIN IMMEDIATE');
    try {
      for (const user of users) {
        if (!user || !user.email) continue;
        const role = normalizeUserRole(user);
        const email = String(user.email).trim().toLowerCase();
        insert.run(
          email,
          String(user.userId || projectScope.stableUserId(email)),
          String(user.name || user.email).slice(0, 24),
          storedAvatar(user.avatar),
          String(user.bio || '').slice(0, 500),
          String(user.defaultModel || '').slice(0, 120),
          String(user.salt || ''),
          String(user.pwd || ''),
          role,
          role,
          role,
          role === 'admin' ? 0 : Math.max(0, Number(user.credits) || 0),
          Math.max(0, Number(user.spent) || 0),
          String(user.createdAt || new Date().toISOString())
        );
      }
      getDatabase().exec('COMMIT');
    } catch (error) {
      try { getDatabase().exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
  }

  return {
    loadUsers, saveUsers, saveUser, insertUserIfAbsent, userFromDbRow, getUserByEmail, getUserById, hashPwd, createPasswordRecord, verifyPassword, markSessionRevoked, isSessionRevoked, hashSessionToken, normalizeSessionScope, loadSessions, hydratePostgresSessions, persistSessions, flushSessions, flushSessionsSync, issueToken, getAuthUser, publicUser, normalizeAvatar, storedAvatar, handleRegister, authenticatePasswordLogin, handleLogin, handleAdminLogin, handleSendCode, handleLoginByCode, handleMe, handleAdminMe, handleProfile, handleLogout, handleLogoutAll, persistUsersToDb, sessions,
    resetUserCache: () => { usersCache = null; usersCacheMtimeMs = 0; usersCacheCheckedAt = 0; }
  };
}

module.exports = { createAuthAccountService };

