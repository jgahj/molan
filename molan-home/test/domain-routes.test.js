'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAuthRoutes } = require('../routes/auth');
const { createAdminRoutes } = require('../routes/admin');
const { createSkillRoutes } = require('../routes/skills');
const { createGenerationRoutes } = require('../routes/generation');
const { createKnowledgeRoutes } = require('../routes/knowledge');
const { createDissectionRoutes } = require('../routes/dissections');
const { createProjectRoutes } = require('../routes/projects');
const { createNovelReadHandlers } = require('../routes/novel-read-handlers');
const { createNovelWriteHandlers } = require('../routes/novel-write-handlers');
const { createAuthAttemptLimiter } = require('../services/auth-attempt-limiter');

function serviceRecorder(overrides = {}) {
  const calls = [];
  const handlers = new Proxy({}, {
    get(_target, name) {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      return (...args) => {
        calls.push([name, ...args]);
        return Promise.resolve();
      };
    }
  });
  return { handlers, calls };
}

test('auth route module injects handlers and retains admin logout scope', async () => {
  const req = { method: 'POST' };
  const res = {};
  const { handlers, calls } = serviceRecorder();
  const dispatch = createAuthRoutes(handlers);

  assert.equal(await dispatch(req, res, '/api/admin/auth/logout'), true);
  assert.equal(await dispatch({ method: 'GET' }, res, '/api/auth/me'), true);
  assert.equal(await dispatch({ method: 'GET' }, res, '/not-an-auth-route'), false);
  assert.equal(calls[0][0], 'logout');
  assert.equal(calls[0][3], 'admin');
  assert.equal(calls[1][0], 'me');
});

test('skill and admin routes distinguish collection and item paths', async () => {
  const req = { method: 'POST' };
  const res = {};
  const skillRecorder = serviceRecorder();
  const dispatchSkill = createSkillRoutes(skillRecorder.handlers);
  assert.equal(await dispatchSkill(req, res, '/api/open-skills/skill-1/download'), true);
  assert.equal(skillRecorder.calls[0][0], 'openDownload');
  assert.deepEqual(skillRecorder.calls[0].slice(3), ['skill-1']);

  const adminRecorder = serviceRecorder();
  const dispatchAdmin = createAdminRoutes(adminRecorder.handlers);
  assert.equal(await dispatchAdmin({ method: 'PATCH' }, res, '/api/admin/users/user-1'), true);
  assert.equal(adminRecorder.calls[0][0], 'userPatch');
  assert.equal(adminRecorder.calls[0][3], 'user-1');
});

test('generation and knowledge routes keep proxy stage and response contracts', () => {
  const req = { method: 'GET', url: '/api/local-style/samples?bucket=dialogue' };
  const res = {};
  const generationRecorder = serviceRecorder();
  const generation = createGenerationRoutes(generationRecorder.handlers);
  assert.equal(generation.dispatchBeforeProxy(req, res, '/api/generation-runs/run-1/events'), true);
  assert.equal(generationRecorder.calls[0][0], 'generationRuns');

  const knowledgeRecorder = serviceRecorder();
  const knowledge = createKnowledgeRoutes(knowledgeRecorder.handlers);
  assert.equal(knowledge.dispatchLocal(req, res, '/api/local-style/samples'), true);
  assert.equal(knowledgeRecorder.calls[0][0], 'localStyleSamples');
  assert.equal(knowledgeRecorder.calls[0][3].get('bucket'), 'dialogue');
  assert.equal(knowledge.dispatch({ method: 'GET' }, res, '/api/style-catalog'), true);
  assert.equal(knowledgeRecorder.calls[1][0], 'json');
  assert.equal(knowledgeRecorder.calls[1][2], 200);
});

test('dissection and project routers preserve method matching and PostgreSQL precedence', async () => {
  const req = { method: 'GET' };
  const res = {};
  const dissectionRecorder = serviceRecorder();
  const dispatchDissection = createDissectionRoutes(dissectionRecorder.handlers);
  assert.equal(await dispatchDissection(req, res, '/api/dissection/book_1/versions/v_2'), true);
  assert.equal(dissectionRecorder.calls[0][0], 'version');
  assert.equal(dissectionRecorder.calls[0][3], 'book_1');
  assert.equal(dissectionRecorder.calls[0][4], 'v_2');

  const projectRecorder = serviceRecorder();
  const dispatchProject = createProjectRoutes({ postgresMode: true, handlers: projectRecorder.handlers });
  assert.equal(await dispatchProject(req, res, '/api/novels/n_project1/export'), true);
  assert.equal(projectRecorder.calls[0][0], 'postgresNovelExport');
  assert.equal(projectRecorder.calls[0][3], 'n_project1');
});

test('auth attempt limiter separates scopes and resets after its window', () => {
  let now = 1000;
  const limiter = createAuthAttemptLimiter({ windowMs: 100, now: () => now });
  const req = { socket: { remoteAddress: '127.0.0.1' } };
  try {
    assert.equal(limiter.allow(req, 'login', 2), true);
    assert.equal(limiter.allow(req, 'login', 2), true);
    assert.equal(limiter.allow(req, 'login', 2), false);
    assert.equal(limiter.allow(req, 'register', 1), true);
    now += 100;
    assert.equal(limiter.allow(req, 'login', 2), true);
  } finally {
    limiter.close();
  }
});

test('novel read handlers use injected storage and retain project visibility checks', () => {
  const responses = [];
  const access = { workspace_id: 'workspace-1', project_id: 'novel-1' };
  const rows = [
    { id: 'n_novel1', workspace_id: access.workspace_id, project_id: access.project_id, title: '测试小说', state_json: '{"volumes":[]}', word_count: 0, created_at: 1, updated_at: 2, revision: 3 }
  ];
  const database = {
    prepare(sql) {
      return {
        all() {
          if (/FROM novels/.test(sql)) assert.match(sql, /project_members/);
          return /FROM novels/.test(sql) ? rows : [];
        },
        get(id, userId) {
          assert.equal(id, 'n_novel1');
          assert.equal(userId, 'user-1');
          return rows[0];
        }
      };
    }
  };
  const handlers = createNovelReadHandlers({
    getDatabase: () => database,
    getAuthUser: () => ({ user: { userId: 'user-1' } }),
    requireStorage: () => true,
    isStorageReady: () => true,
    json: (_res, status, body) => responses.push({ status, body }),
    summarizeNovel: row => ({ id: row.id, title: row.title }),
    projectScope: { getNovelAccess: () => access, canAccess: () => true, scopePublic: value => value },
    sanitizeNovelState: value => value,
    postgresData: { mergeResourcesIntoState: state => state },
    projectResources: { publicResource: value => value }
  });
  const req = {};
  const res = {};

  handlers.handleNovelList(req, res);
  handlers.handleNovelGet(req, res, 'n_novel1');
  assert.deepEqual(responses.map(result => result.status), [200, 200]);
  assert.deepEqual(responses[0].body.novels, [{ id: 'n_novel1', title: '测试小说' }]);
  assert.equal(responses[1].body.novel.revision, 3);
  assert.equal(responses[1].body.novel.scope, access);
});

test('novel create handler rejects unauthenticated requests before reading input', async () => {
  const responses = [];
  const handlers = createNovelWriteHandlers({
    getDatabase: () => { throw new Error('database should not be read'); },
    getAuthUser: () => null,
    requireStorage: () => { throw new Error('storage check should not run'); },
    isStorageReady: () => true,
    readBody: () => { throw new Error('request body should not be read'); },
    sanitizeNovelState: value => value,
    byteLength: Buffer.byteLength,
    maxNovelStateBytes: 1024,
    maxNovelsPerUser: 10,
    calcWordCount: () => 0,
    requestError: (status, message) => Object.assign(new Error(message), { status }),
    projectScope: {},
    json: (_res, status, body) => responses.push({ status, body }),
    respondError: error => { throw error; },
    now: () => 1234,
    random: () => 0.5
  });

  await handlers.handleNovelCreate({}, {});
  assert.deepEqual(responses, [{ status: 401, body: { error: '未登录' } }]);
});

test('novel create handler injects project access, storage limits, and creation response', async () => {
  const responses = [];
  const inserts = [];
  const projectEnsures = [];
  const database = {
    prepare(sql) {
      if (/SELECT user_email, owner_user_id, title FROM novels/.test(sql)) return { get: () => null };
      if (/SELECT COUNT\(\*\) AS n FROM novels/.test(sql)) return { get: () => ({ n: 0 }) };
      if (/INSERT INTO novels/.test(sql)) return { run: (...params) => { inserts.push(params); return { changes: 1 }; } };
      throw new Error('unexpected SQL: ' + sql);
    }
  };
  const auth = { user: { userId: 'owner-1', email: 'owner@example.test' } };
  const state = { title: '测试作品', volumes: [{ id: 'vol-1' }] };
  const handlers = createNovelWriteHandlers({
    getDatabase: () => database,
    getAuthUser: () => auth,
    requireStorage: () => true,
    isStorageReady: () => true,
    readBody: async () => ({ id: 'n_test1', title: '新小说', state, workspaceId: 'workspace-1' }),
    sanitizeNovelState: value => ({ ...value, normalized: true }),
    byteLength: Buffer.byteLength,
    maxNovelStateBytes: 1024,
    maxNovelsPerUser: 10,
    calcWordCount: () => 17,
    requestError: (status, message) => Object.assign(new Error(message), { status }),
    projectScope: {
      getWorkspaceAccess: (_db, workspaceId, userId) => workspaceId === 'workspace-1' && userId === auth.user.userId,
      getNovelAccess: () => ({ workspace_id: 'workspace-1' }),
      ensureNovelProject: (...args) => projectEnsures.push(args)
    },
    json: (_res, status, body) => responses.push({ status, body }),
    respondError: error => { throw error; },
    now: () => 1234,
    random: () => 0.5
  });

  await handlers.handleNovelCreate({}, {});
  assert.equal(inserts.length, 1);
  assert.deepEqual(inserts[0], [
    'n_test1', 'owner@example.test', 'owner-1', '新小说',
    JSON.stringify({ ...state, normalized: true }), 17, 1234, 1234
  ]);
  assert.equal(projectEnsures.length, 1);
  assert.equal(projectEnsures[0][4], 'workspace-1');
  assert.deepEqual(responses, [{
    status: 200,
    body: { ok: true, id: 'n_test1', workspaceId: 'workspace-1', projectId: 'n_test1', wordCount: 17, updatedAt: 1234, revision: 0 }
  }]);
});
