'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPostgresProjectService } = require('../services/postgres-project-service');

test('PG 项目及工作区成员接口等待原生账户查询，不依赖同步账户缓存', async () => {
  const responses = [];
  const mutations = [];
  const service = createPostgresProjectService({
    getAuthUser: () => ({ user: { userId: 'actor' } }),
    postgresActor: auth => auth.user.userId,
    json: (response, status, body) => responses.push({ status, body }),
    readBody: async request => request.body,
    getUserById: async userId => ({ userId, email: 'member@test.invalid', name: '成员' }),
    getUserByEmail: async email => ({ userId: 'member', email, name: '成员' }),
    postgresRepository: {
      listWorkspaceMembers: async () => [{ userId: 'member', role: 'member' }],
      listProjectMembers: async () => [{ userId: 'member', role: 'reader', canSpend: false, canExport: true }],
      upsertWorkspaceMember: async (...args) => { mutations.push(args); return { ok: true }; },
      upsertProjectMember: async (...args) => { mutations.push(args); return { ok: true }; }
    }
  });
  await service.handlePostgresWorkspaceMembers({ method: 'GET' }, {}, 'workspace');
  assert.equal(responses.at(-1).body.members[0].email, 'member@test.invalid');
  await service.handlePostgresNovelMembers({ method: 'GET' }, {}, 'workspace', 'project');
  assert.equal(responses.at(-1).body.members[0].name, '成员');
  await service.handlePostgresWorkspaceMembers({ method: 'POST', body: { email: 'member@test.invalid' } }, {}, 'workspace');
  await service.handlePostgresNovelMembers({ method: 'PATCH', body: { userId: 'member', role: 'editor', aclRevision: 3 } }, {}, 'workspace', 'project');
  assert.deepEqual(mutations[0], ['actor', 'workspace', 'member', 'member']);
  assert.deepEqual(mutations[1], ['actor', 'workspace', 'project', 'member', 'editor', false, false, false, 3]);
  assert.ok(responses.every(response => response.status === 200));
});
