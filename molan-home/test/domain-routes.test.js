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

test('auth route module injects handlers and retains admin logout scope', () => {
  const req = { method: 'POST' };
  const res = {};
  const { handlers, calls } = serviceRecorder();
  const dispatch = createAuthRoutes(handlers);

  assert.equal(dispatch(req, res, '/api/admin/auth/logout'), true);
  assert.equal(dispatch({ method: 'GET' }, res, '/api/auth/me'), true);
  assert.equal(dispatch({ method: 'GET' }, res, '/not-an-auth-route'), false);
  assert.equal(calls[0][0], 'logout');
  assert.equal(calls[0][3], 'admin');
  assert.equal(calls[1][0], 'me');
});

test('skill and admin routes distinguish collection and item paths', () => {
  const req = { method: 'POST' };
  const res = {};
  const skillRecorder = serviceRecorder();
  const dispatchSkill = createSkillRoutes(skillRecorder.handlers);
  assert.equal(dispatchSkill(req, res, '/api/open-skills/skill-1/download'), true);
  assert.equal(skillRecorder.calls[0][0], 'openDownload');
  assert.deepEqual(skillRecorder.calls[0].slice(3), ['skill-1']);

  const adminRecorder = serviceRecorder();
  const dispatchAdmin = createAdminRoutes(adminRecorder.handlers);
  assert.equal(dispatchAdmin({ method: 'PATCH' }, res, '/api/admin/users/user-1'), true);
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

test('dissection and project routers preserve method matching and PostgreSQL precedence', () => {
  const req = { method: 'GET' };
  const res = {};
  const dissectionRecorder = serviceRecorder();
  const dispatchDissection = createDissectionRoutes(dissectionRecorder.handlers);
  assert.equal(dispatchDissection(req, res, '/api/dissection/book_1/versions/v_2'), true);
  assert.equal(dissectionRecorder.calls[0][0], 'version');
  assert.equal(dissectionRecorder.calls[0][3], 'book_1');
  assert.equal(dissectionRecorder.calls[0][4], 'v_2');

  const projectRecorder = serviceRecorder();
  const dispatchProject = createProjectRoutes({ postgresMode: true, handlers: projectRecorder.handlers });
  assert.equal(dispatchProject(req, res, '/api/novels/n_project1/export'), true);
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
