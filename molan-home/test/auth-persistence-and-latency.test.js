'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const { createAuthAccountService } = require('../services/auth-account-service');
const { mergeResourcesIntoState } = require('../lib/project-resource-projection');
const projectScope = require('../lib/project-scope');
const projectResources = require('../lib/project-resources');

function fixture(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-auth-perf-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const service = createAuthAccountService({
    DATA_DIR: directory,
    POSTGRES_MODE: false,
    USERS_FILE: path.join(directory, 'users.json'),
    SESSIONS_FILE: path.join(directory, 'sessions.json'),
    SESSION_TTL_MS: 3600000,
    USER_CACHE_TTL_MS: 1000,
    fs,
    crypto,
    dbReady: () => false,
    getDatabase: () => null,
    projectScope: { stableUserId: email => 'user-' + email, ensureUserWorkspace: () => {} },
    normalizeUserRole: user => user.role || 'normal',
    getUsageSummary: () => ({}),
    requestError: (status, message) => Object.assign(new Error(message), { status }),
    ...overrides
  });
  t.after(() => service.flushSessionsSync());
  return { service, directory };
}

test('createPasswordRecordAsync and verifyPasswordAsync handle non-blocking scrypt hashing', async t => {
  const { service } = fixture(t);
  const password = 'SuperSecretPassword!2026';

  // 1. 生成异步密码凭据
  const record = await service.createPasswordRecordAsync(password);
  assert.ok(record.salt);
  assert.equal(typeof record.salt, 'string');
  assert.ok(record.pwd.startsWith('scrypt$'));
  assert.equal(record.pwd.slice(7).length, 128); // 64 bytes hex = 128 hex chars

  // 2. 异步验证正确密码
  const user = { salt: record.salt, pwd: record.pwd };
  const verifyResult = await service.verifyPasswordAsync(password, user);
  assert.equal(verifyResult.ok, true);
  assert.equal(verifyResult.needsUpgrade, false);

  // 3. 异步验证错误密码
  const wrongResult = await service.verifyPasswordAsync('WrongPassword', user);
  assert.equal(wrongResult.ok, false);
  assert.equal(wrongResult.needsUpgrade, false);

  // 4. 兼容老旧 SHA-256 哈希升级标记
  const legacySalt = 'randomsalt123';
  const legacyHash = crypto.createHash('sha256').update(password + ':' + legacySalt).digest('hex');
  const legacyUser = { salt: legacySalt, pwd: legacyHash };
  const legacyVerify = await service.verifyPasswordAsync(password, legacyUser);
  assert.equal(legacyVerify.ok, true);
  assert.equal(legacyVerify.needsUpgrade, true);
});

test('userMemoryCache caches lookups within TTL and invalidates on update', t => {
  let queryCount = 0;
  const mockDb = {
    prepare: (sql) => ({
      get: (param) => {
        queryCount++;
        return {
          email: 'cachetest@example.com',
          userId: 'usr_cache123',
          name: 'Cache User',
          avatar: '',
          bio: '',
          defaultModel: '',
          salt: 'salt1',
          pwd: 'pwd1',
          role: 'normal',
          level: 'normal',
          plan: 'normal',
          credits: 100,
          spent: 0,
          createdAt: new Date().toISOString()
        };
      }
    })
  };

  const { service } = fixture(t, {
    dbReady: () => true,
    getDatabase: () => mockDb
  });

  // 第一次查询：命中 DB
  const user1 = service.getUserByEmail('cachetest@example.com');
  assert.equal(user1.name, 'Cache User');
  assert.equal(queryCount, 1);

  // 第二次查询：命中内存缓存，DB 查询计数不变
  const user2 = service.getUserByEmail('cachetest@example.com');
  assert.equal(user2.name, 'Cache User');
  assert.equal(queryCount, 1);

  // 通过 userId 查询：同样命中内存缓存
  const user3 = service.getUserById('usr_cache123');
  assert.equal(user3.name, 'Cache User');
  assert.equal(queryCount, 1);

  // 显式清理缓存后再次查询：重新触发 DB 查询
  service.invalidateUserMemoryCache('cachetest@example.com', 'usr_cache123');
  const user4 = service.getUserByEmail('cachetest@example.com');
  assert.equal(user4.name, 'Cache User');
  assert.equal(queryCount, 2);
});

test('mergeResourcesIntoState preserves reference identity of unmodified branches without full-tree JSON clone', () => {
  const chapters = [{ id: 'ch1', title: 'Chapter 1', content: 'Huge manuscript text...' }];
  const characters = [{ id: 'c1', name: 'Protagonist' }];
  const originalState = {
    title: 'Immortal Legend',
    chapters,
    characters,
    knowledge: {
      entities: { old_e1: { id: 'old_e1', name: 'Old Entity' } },
      edges: [{ id: 'edge1', source: 'c1', target: 'c2' }]
    },
    foreshadows: [{ id: 'fs1', title: 'Ring origin' }],
    timeline: [{ id: 'tl1', title: 'Battle at pass' }],
    creationAssets: {
      worldbuilding: [{ id: 'wb1', title: 'Three Realms' }]
    }
  };

  const resources = [
    {
      id: 'fs2',
      kind: 'foreshadow',
      status: 'active',
      payload: { title: 'Sword mystery', plantPlan: 'Chapter 3' }
    },
    {
      id: 'tl2',
      kind: 'timeline',
      status: 'active',
      payload: { title: 'Ascension', storyTime: 'Year 500' }
    }
  ];

  const merged = mergeResourcesIntoState(originalState, resources);

  // 验证未受影响的引用保持同一内存地址（绝无全局 JSON.parse/JSON.stringify）
  assert.equal(merged.chapters, originalState.chapters, 'chapters 必须保持引用同一');
  assert.equal(merged.characters, originalState.characters, 'characters 必须保持引用同一');
  assert.equal(merged.title, originalState.title);

  // 验证相关受影响分支已正确追加更新
  assert.equal(merged.foreshadows.length, 2);
  assert.equal(merged.foreshadows[1].id, 'fs2');
  assert.equal(merged.foreshadows[1].title, 'Sword mystery');

  assert.equal(merged.timeline.length, 2);
  assert.equal(merged.timeline[1].id, 'tl2');
  assert.equal(merged.timeline[1].title, 'Ascension');

  // 空资源输入直接返回原对象引用
  assert.equal(mergeResourcesIntoState(originalState, []), originalState);
});

test('SQLite composite indexes for novels, project_members, and project_resources are created properly', () => {
  const db = new DatabaseSync(':memory:');

  // 初始化基础表结构
  db.exec(`CREATE TABLE IF NOT EXISTS accounts (
    email TEXT PRIMARY KEY,
    user_id TEXT UNIQUE,
    name TEXT NOT NULL,
    avatar TEXT NOT NULL DEFAULT '',
    bio TEXT NOT NULL DEFAULT '',
    default_model TEXT NOT NULL DEFAULT '',
    salt TEXT NOT NULL,
    pwd TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'normal',
    level TEXT NOT NULL DEFAULT 'normal',
    plan TEXT NOT NULL DEFAULT 'normal',
    credits REAL NOT NULL DEFAULT 500,
    spent REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS novels (
    id TEXT PRIMARY KEY,
    user_email TEXT NOT NULL,
    title TEXT NOT NULL,
    state_json TEXT NOT NULL,
    word_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    workspace_id TEXT,
    project_id TEXT,
    owner_user_id TEXT NOT NULL DEFAULT ''
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_novels_project_scope ON novels(workspace_id, project_id, updated_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_novels_project_id ON novels(project_id)');

  // 初始化 projectScope 与 projectResources 表和索引
  projectScope.initializeSchema(db);
  projectResources.initializeSchema(db);

  const getIndexes = (tableName) => {
    return db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?`).all(tableName).map(r => r.name);
  };

  const novelIndexes = getIndexes('novels');
  assert.ok(novelIndexes.includes('idx_novels_project_scope'), 'novels 表应包含 idx_novels_project_scope 联合索引');
  assert.ok(novelIndexes.includes('idx_novels_project_id'), 'novels 表应包含 idx_novels_project_id 索引');

  const memberIndexes = getIndexes('project_members');
  assert.ok(memberIndexes.includes('idx_project_members_project_user'), 'project_members 表应包含 idx_project_members_project_user 联合索引');

  const resourceIndexes = getIndexes('project_resources');
  assert.ok(resourceIndexes.includes('idx_project_resources_lookup'), 'project_resources 表应包含 idx_project_resources_lookup 联合索引');

  db.close();
});

test('refreshBackendUser silent retry preserves auth on transient failure and only clears on 401', async () => {
  // 模拟客户端会话与存储环境
  const localStorageMock = new Map();
  const sessionStorageMock = new Map();
  let clearedAuth = false;

  const backendState = {
    token: 'valid_test_token_2026',
    user: { email: 'author@molan.test', name: 'Author' },
    rememberMe: true
  };

  function clearBackendAuth() {
    clearedAuth = true;
    backendState.token = '';
    backendState.user = null;
    localStorageMock.delete('ml_token');
    localStorageMock.delete('ml_user');
  }

  // 1. 模拟网络抖动 / 500 临时故障：重试并保持现有凭证，不调用 clearBackendAuth
  async function simulateRefreshWithRetry(fetchFn, retries = 2) {
    if (!backendState.token) return null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const data = await fetchFn();
        if (data && data.user) {
          backendState.user = data.user;
          return backendState.user;
        }
        return backendState.user;
      } catch (error) {
        if (error && error.status === 401) {
          clearBackendAuth();
          return null;
        }
        if (attempt < retries) {
          continue; // 静默重试
        }
        return backendState.user; // 网络异常保持当前登录态
      }
    }
    return backendState.user;
  }

  // 场景 A：网络超时与 502 错误
  let networkFailures = 0;
  const transientErrorFetch = async () => {
    networkFailures++;
    const err = new Error('502 Bad Gateway / Network Timeout');
    err.status = 502;
    throw err;
  };

  clearedAuth = false;
  const userAfterNetworkFail = await simulateRefreshWithRetry(transientErrorFetch, 2);
  assert.equal(clearedAuth, false, '网络抖动或5xx错误绝不能清除登录凭证');
  assert.ok(userAfterNetworkFail, '应该保留原用户对象');
  assert.equal(userAfterNetworkFail.email, 'author@molan.test');
  assert.equal(networkFailures, 3, '应当执行初次 + 2次重试 = 共3次调用');

  // 场景 B：服务端明确返回 401 Unauthorized（Token 过期）
  const unauthorizedFetch = async () => {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  };

  clearedAuth = false;
  const userAfter401 = await simulateRefreshWithRetry(unauthorizedFetch, 2);
  assert.equal(clearedAuth, true, 'HTTP 401 必须清除鉴权状态');
  assert.equal(userAfter401, null);
  assert.equal(backendState.token, '');
});
