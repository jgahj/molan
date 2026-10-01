'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createPostgresNovelService } = require('../services/postgres-novel-service');

function harness() {
  const calls = [];
  const profile = {
    title: 'Test novel', createdAt: 1, updatedAt: 2, revision: 4,
    access: { workspace_id: 'workspace-1', project_id: 'n_test', role: 'owner' },
    state: { title: 'Test novel', volumes: [], knowledge: { entities: {} } }
  };
  const repository = {
    async listWorkspaces(userId) { calls.push(['listWorkspaces', userId]); return [{ id: 'workspace-1' }]; },
    async listProjects(userId, workspaceId) { calls.push(['listProjects', userId, workspaceId]); return [{ projectId: 'n_test', workspaceId, title: 'Test novel' }]; },
    async getProfile(userId, projectId, workspaceId) { calls.push(['getProfile', userId, projectId, workspaceId]); return projectId === 'n_test' ? structuredClone(profile) : null; },
    async saveProfile(input) { calls.push(['saveProfile', input]); return { ok: true, revision: (input.expectedRevision || 0) + 1 }; },
    async deleteProject(userId, id) { calls.push(['deleteProject', userId, id]); return { ok: true, deleted: 1 }; },
    async restoreProject(userId, id) { calls.push(['restoreProject', userId, id]); return { ok: true, restored: true }; }
  };
  const service = createPostgresNovelService({
    getAuthUser: req => req.auth || null,
    json: (res, status, body) => { res.status = status; res.body = body; return body; },
    getPostgresRepository: () => repository,
    readBody: async req => req.body || {},
    requestError: (status, message) => Object.assign(new Error(message), { status }),
    projectScope: {
      WRITE_ROLES: new Set(['owner', 'admin', 'editor']),
      stableUserId: email => `stable:${email}`,
      scopePublic: access => ({ role: access.role }),
      canAccess: (access, roles) => roles.has(access.role)
    },
    sanitizeNovelStateForStorage: state => structuredClone(state),
    calcWordCount: state => (state.volumes || []).length,
    maxNovelStateBytes: 1024 * 1024,
    crypto: require('node:crypto'),
    novelListSummary: row => ({ id: row.id, title: row.title, wordCount: row.word_count, revision: row.revision })
  });
  const req = body => ({ auth: { user: { userId: 'actor-1', email: 'actor@example.test' } }, body });
  return { calls, profile, repository, service, req };
}

test('PostgreSQL novel list/read preserve legacy shapes and resolve stable actors', async () => {
  const h = harness();
  const listResponse = {};
  await h.service.handlePostgresNovelList(h.req(), listResponse);
  assert.equal(listResponse.status, 200);
  assert.deepEqual(listResponse.body.novels, [{ id: 'n_test', title: 'Test novel', wordCount: 0, revision: 4 }]);
  assert.equal(h.calls[0][1], 'actor-1');

  const readResponse = {};
  await h.service.handlePostgresNovelGet(h.req(), readResponse, 'n_test');
  assert.equal(readResponse.status, 200);
  assert.equal(readResponse.body.novel.scope.role, 'owner');
  assert.deepEqual(readResponse.body.novel.state, h.profile.state);

  const missingActor = {};
  await h.service.handlePostgresNovelList({}, missingActor);
  assert.equal(missingActor.status, 401);
});

test('PostgreSQL novel create/save retain validation and revision CAS inputs', async () => {
  const h = harness();
  const saved = {};
  await h.service.handlePostgresNovelSave(h.req({ state: { title: 'Saved', volumes: [] }, revision: 3 }), saved, 'n_test');
  assert.equal(saved.status, 200);
  const saveCall = h.calls.find(call => call[0] === 'saveProfile')[1];
  assert.equal(saveCall.expectedRevision, 3);
  assert.equal(saveCall.workspaceId, 'workspace-1');

  const created = {};
  await h.service.handlePostgresNovelCreate(h.req({ id: 'n_created', state: { volumes: [] } }), created);
  assert.equal(created.status, 200);
  assert.equal(h.calls.filter(call => call[0] === 'saveProfile').at(-1)[1].projectId, 'n_created');

  await assert.rejects(h.service.handlePostgresNovelSave(h.req({ state: { volumes: [] }, revision: -1 }), {}, 'n_test'), { status: 422 });
  await assert.rejects(h.service.handlePostgresNovelCreate(h.req({ id: 'bad-id', state: { volumes: [] } }), {}), { status: 422 });
});

test('PostgreSQL character import keeps deterministic IDs, deduplication and profile CAS', async () => {
  const h = harness();
  const response = {};
  await h.service.handlePostgresNovelImportCharacters(h.req({ revision: 4, characters: [
    { name: 'Lead', function: 'witness', goal: 'find proof' }, { name: 'Lead', goal: 'duplicate' }
  ] }), response, 'n_test');
  assert.equal(response.status, 200);
  assert.equal(response.body.added, 1);
  assert.equal(response.body.total, 1);
  const saveCall = h.calls.find(call => call[0] === 'saveProfile')[1];
  assert.equal(saveCall.expectedRevision, 4);
  assert.equal(saveCall.state.knowledge.entities[Object.keys(saveCall.state.knowledge.entities)[0]].name, 'Lead');
});

test('PostgreSQL novel delete/restore and error helpers keep their route contracts', async () => {
  const h = harness();
  const deleted = {};
  await h.service.handlePostgresNovelDelete(h.req(), deleted, 'n_test');
  assert.deepEqual(deleted.body, { ok: true, deleted: 1 });
  const restored = {};
  await h.service.handlePostgresNovelRestore(h.req(), restored, 'n_test');
  assert.deepEqual(restored.body, { ok: true, restored: true });

  const absent = {};
  await h.service.handlePostgresNovelGet(h.req(), absent, 'invalid');
  assert.equal(absent.status, 400);
  const errorResponse = {};
  h.service.respondPostgresError(errorResponse, Object.assign(new Error('conflict'), { status: 409, code: 'revision_conflict' }));
  assert.equal(errorResponse.status, 409);
  assert.equal(errorResponse.body.code, 'revision_conflict');
});
