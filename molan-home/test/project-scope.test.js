const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const { createLocalRuntime } = require('./helpers/local-runtime');
const projectScope = require('../lib/project-scope');
const memorySystem = require('../lib/memory-system');

const dataDirectory = createLocalRuntime();
const app = require('../server');
app.initDB();

test('本地账户迁移到稳定用户、个人工作区和项目成员作用域', () => {
  const user = { email: 'scope-owner@example.com', name: '作用域作者', role: 'normal', level: 'normal', plan: 'normal', credits: 100, spent: 0 };
  app.saveUser(user);
  const database = new DatabaseSync(path.join(dataDirectory, 'molan.db'));
  try {
    const account = database.prepare('SELECT email, user_id FROM accounts WHERE email = ?').get(user.email);
    assert.ok(account.user_id);
    const workspace = database.prepare('SELECT id FROM workspaces WHERE owner_user_id = ?').get(account.user_id);
    assert.ok(workspace);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'creation_core_jobs'").get().n, 1);
    database.prepare('INSERT INTO novels (id,user_email,title,state_json,word_count,created_at,updated_at,revision,workspace_id,project_id) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run('n_scope_1', user.email, '作用域小说', '{"volumes":[]}', 0, Date.now(), Date.now(), 0, workspace.id, 'n_scope_1');
    const scope = projectScope.ensureNovelProject(database, { ...user, userId: account.user_id }, 'n_scope_1', '作用域小说');
    assert.equal(scope.workspaceId, workspace.id);
    const access = projectScope.getNovelAccess(database, 'n_scope_1', account.user_id);
    assert.equal(projectScope.canAccess(access), true);
    assert.equal(projectScope.canAccess(access, projectScope.WRITE_ROLES), true);
    assert.equal(projectScope.canAccess(access, projectScope.PROJECT_ROLES, 'export'), true);
  } finally {
    database.close();
  }
});

test('小说HTTP读写按显式项目成员隔离并支持协作者保存与恢复', async () => {
  const userA = { email: 'scope-http-a@example.com', name: 'HTTP作者', role: 'normal', level: 'normal', plan: 'normal', credits: 100, spent: 0 };
  const userB = { email: 'scope-http-b@example.com', name: 'HTTP协作者', role: 'normal', level: 'normal', plan: 'normal', credits: 100, spent: 0 };
  app.saveUser(userA);
  app.saveUser(userB);
  const tokenA = crypto.randomBytes(32).toString('hex');
  const tokenB = crypto.randomBytes(32).toString('hex');
  app.sessions.set(app.hashSessionToken(tokenA), { email: userA.email, scope: 'client', expiresAt: Date.now() + 60000 });
  app.sessions.set(app.hashSessionToken(tokenB), { email: userB.email, scope: 'client', expiresAt: Date.now() + 60000 });
  const port = await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', () => resolve(app.server.address().port));
  });
  const base = `http://127.0.0.1:${port}`;
  const request = (pathname, token, options = {}) => fetch(base + pathname, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const novelId = 'n_scopehttp1';
  const workspaceId = projectScope.personalWorkspaceId(projectScope.stableUserId(userA.email));
  const state = { title: 'HTTP作用域小说', volumes: [{ id: 'v1', title: '第一卷', chapters: [{ id: 'c1', title: '第一章', scenes: [{ id: 's1', name: '正文', content: '初稿正文' }] }] }] };
  try {
    const created = await (await request('/api/novels', tokenA, { method: 'POST', body: JSON.stringify({ id: novelId, title: state.title, state }) })).json();
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.equal((await (await request('/api/novels', tokenB)).json()).novels.length, 0);
    assert.equal((await request(`/api/novels/${novelId}`, tokenB)).status, 404);
    assert.equal((await request(`/api/books/${novelId}/memory`, tokenB)).status, 404);
    assert.equal((await request(`/api/books/${novelId}/memory`, tokenA)).status, 200);

    const database = new DatabaseSync(path.join(dataDirectory, 'molan.db'));
    try {
      const accountA = database.prepare('SELECT user_id FROM accounts WHERE email = ?').get(userA.email);
      const project = database.prepare('SELECT project_id FROM novel_projects WHERE project_id = ?').get(novelId);
      assert.equal(project.project_id, novelId);
      const candidate = memorySystem.createChangeset(database, {
        bookId: novelId,
        operations: [{ type: 'STATE_TRANSITION', payload: { entityId: 'item_http', postState: 'held' } }]
      });
      const memoryPath = `/api/books/${novelId}/memory/changesets/${candidate.id}`;
      assert.equal((await request(`${memoryPath}/approve`, tokenB, { method: 'POST', body: '{}' })).status, 404);
      assert.equal((await request(`${memoryPath}/approve`, tokenA, { method: 'POST', body: '{' })).status, 400);
      assert.equal((await request(`${memoryPath}/approve`, tokenA, { method: 'POST', body: '{}' })).status, 200);
      const commitOptions = {
        method: 'POST', body: '{}', headers: { 'Idempotency-Key': 'memory-http-commit' }
      };
      const receipt = await (await request(`${memoryPath}/commit`, tokenA, commitOptions)).json();
      assert.equal(receipt.ok, true, JSON.stringify(receipt));
      assert.equal(receipt.stateVersion, 2);
      assert.equal(receipt.projectionStatus, 'queued');
      const replay = await (await request(`${memoryPath}/commit`, tokenA, commitOptions)).json();
      assert.deepEqual(replay, { ...receipt, replayed: true });
      assert.equal(database.prepare('SELECT count(*) AS count FROM memory_outbox WHERE book_id = ?').get(novelId).count, 1);
      assert.equal((await request(`/api/runs/${candidate.id}`, tokenB)).status, 404);
      assert.equal((await request(`/api/runs/${candidate.id}`, tokenA)).status, 200);
      const conflict = await request(`${memoryPath}/commit`, tokenA, {
        ...commitOptions, body: JSON.stringify({ candidateHash: 'tampered' })
      });
      assert.equal(conflict.status, 409);
      assert.equal((await conflict.json()).code, 'IDEMPOTENCY_CONFLICT');
      const workspaceMember = await (await request(`/api/workspaces/${workspaceId}/members`, tokenA, {
        method: 'POST',
        body: JSON.stringify({ email: userB.email, role: 'member' })
      })).json();
      assert.equal(workspaceMember.ok, true, JSON.stringify(workspaceMember));
      const member = await (await request(`/api/workspaces/${workspaceId}/projects/${novelId}/members`, tokenA, {
        method: 'POST',
        body: JSON.stringify({ email: userB.email, role: 'editor' })
      })).json();
      assert.equal(member.ok, true, JSON.stringify(member));
    } finally {
      database.close();
    }

    const shared = await (await request(`/api/novels/${novelId}`, tokenB)).json();
    assert.equal(shared.ok, true, JSON.stringify(shared));
    assert.equal((await request(`/api/books/${novelId}/memory`, tokenB)).status, 200);
    const changed = structuredClone(shared.novel.state);
    changed.title = '协作者已保存';
    const saved = await (await request(`/api/novels/${novelId}`, tokenB, { method: 'PUT', body: JSON.stringify({ state: changed, title: changed.title, revision: shared.novel.revision }) })).json();
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.equal((await (await request(`/api/novels/${novelId}`, tokenA)).json()).novel.title, '协作者已保存');
    assert.equal((await request(`/api/novels/${novelId}`, tokenB, { method: 'DELETE' })).status, 403);
    assert.equal((await (await request(`/api/novels/${novelId}`, tokenA, { method: 'DELETE' })).json()).deleted, 1);
    assert.equal((await request(`/api/novels/${novelId}`, tokenA)).status, 404);
    assert.equal((await (await request(`/api/novels/${novelId}/restore`, tokenA, { method: 'POST', body: '{}' })).json()).restored, true);
    assert.equal((await request(`/api/novels/${novelId}`, tokenB)).status, 200);
    assert.equal((await request(`/api/novels/${novelId}/package`, tokenB)).status, 404);
    const packageResponse = await (await request(`/api/novels/${novelId}/package`, tokenA)).json();
    assert.equal(packageResponse.ok, true, JSON.stringify(packageResponse));
    assert.equal(packageResponse.package.manifest.scope.projectId, novelId);
    assert.equal((await request(`/api/novels/${novelId}/package/import`, tokenA, { method: 'POST', body: JSON.stringify({ package: packageResponse.package }) })).status, 409);
    const beforeRestore = await (await request(`/api/novels/${novelId}`, tokenA)).json();
    const restoredPackage = await (await request(`/api/novels/${novelId}/package/restore`, tokenA, {
      method: 'POST',
      body: JSON.stringify({ revision: beforeRestore.novel.revision, package: packageResponse.package })
    })).json();
    assert.equal(restoredPackage.ok, true, JSON.stringify(restoredPackage));
    assert.equal(restoredPackage.revision, beforeRestore.novel.revision + 1);
    assert.equal((await request(`/api/novels/${novelId}/package/restore`, tokenA, {
      method: 'POST',
      body: JSON.stringify({ revision: beforeRestore.novel.revision, package: packageResponse.package })
    })).status, 412);
    assert.equal((await request(`/api/novels/${novelId}/resources/character`, tokenA, {
      method: 'POST',
      body: JSON.stringify({ id: 'character-invalid', payload: '不能静默变成空对象' })
    })).status, 422);
    const resourceCreated = await (await request(`/api/novels/${novelId}/resources/character`, tokenA, {
      method: 'POST',
      body: JSON.stringify({ id: 'character-scope-a', payload: { name: '林澄', age: 24, goal: '守护档案' } })
    })).json();
    assert.equal(resourceCreated.ok, true, JSON.stringify(resourceCreated));
    const resourceResponse = await request(`/api/novels/${novelId}/resources/character/character-scope-a`, tokenB);
    const resourceRead = await resourceResponse.json();
    assert.equal(resourceRead.resource.payload.age, 24);
    const resourceEtag = resourceResponse.headers.get('etag');
    assert.ok(resourceEtag);
    const resourceUpdated = await (await request(`/api/novels/${novelId}/resources/character/character-scope-a`, tokenB, {
      method: 'PATCH',
      headers: { 'If-Match': resourceEtag },
      body: JSON.stringify({ payload: { name: '林澄', age: 25, goal: '守护新档案' } })
    })).json();
    assert.equal(resourceUpdated.resource.revision, 2, JSON.stringify(resourceUpdated));
    const resourceHistory = await (await request(`/api/novels/${novelId}/resources/character/character-scope-a/history`, tokenB)).json();
    assert.deepEqual(resourceHistory.versions.map(version => version.revision), [2, 1]);
    const historicalRestoreResponse = await request(`/api/novels/${novelId}/resources/character/character-scope-a/history/1/restore`, tokenB, {
      method: 'POST',
      headers: { 'If-Match': resourceUpdated.resource.etag },
      body: JSON.stringify({ changeReason: '恢复早期人物卡' })
    });
    const historicalRestore = await historicalRestoreResponse.json();
    assert.equal(historicalRestoreResponse.status, 200, JSON.stringify(historicalRestore));
    assert.equal(historicalRestore.resource.revision, 3);
    assert.equal(historicalRestore.resource.payload.age, 24);
    assert.equal((await request(`/api/novels/${novelId}/resources/character/character-scope-a/history/1/restore`, tokenA, {
      method: 'POST', headers: { 'If-Match': resourceUpdated.resource.etag }, body: '{}'
    })).status, 412);
    assert.equal((await request(`/api/novels/${novelId}/resources/character/character-scope-a`, tokenA, { method: 'PATCH', headers: { 'If-Match': resourceEtag }, body: JSON.stringify({ payload: { name: '冲突' } }) })).status, 412);
    const resourceDeleted = await (await request(`/api/novels/${novelId}/resources/character/character-scope-a`, tokenA, { method: 'DELETE', headers: { 'If-Match': historicalRestore.resource.etag }, body: '{}' })).json();
    assert.equal(resourceDeleted.ok, true, JSON.stringify(resourceDeleted));
    assert.equal((await (await request(`/api/novels/${novelId}/resources/character?includeDeleted=1`, tokenB)).json()).resources.length, 1);
    const resourceRestored = await (await request(`/api/novels/${novelId}/resources/character/character-scope-a`, tokenA, { method: 'POST', headers: { 'If-Match': resourceDeleted.resource.etag }, body: JSON.stringify({ changeReason: '回到资料中心' }) })).json();
    assert.equal(resourceRestored.ok, true, JSON.stringify(resourceRestored));
    assert.equal((await (await request(`/api/novels/${novelId}/resources/character`, tokenB)).json()).resources.length, 1);
    const resourcePackage = await (await request(`/api/novels/${novelId}/package`, tokenA)).json();
    assert.equal(resourcePackage.ok, true, JSON.stringify(resourcePackage));
    assert.ok(Object.values(resourcePackage.package.files || {}).some(file => String(file && file.content || '').includes('projectResources')));
    const resourceChangedAfterExport = await (await request(`/api/novels/${novelId}/resources/character/character-scope-a`, tokenB, {
      method: 'PATCH',
      headers: { 'If-Match': resourceRestored.resource.etag },
      body: JSON.stringify({ payload: { name: '林澄', age: 26, goal: '临时修改' } })
    })).json();
    assert.equal(resourceChangedAfterExport.resource.payload.age, 26, JSON.stringify(resourceChangedAfterExport));
    const novelBeforeResourceRestore = await (await request(`/api/novels/${novelId}`, tokenA)).json();
    const resourceRestorePackage = await (await request(`/api/novels/${novelId}/package/restore`, tokenA, {
      method: 'POST',
      body: JSON.stringify({ revision: novelBeforeResourceRestore.novel.revision, package: resourcePackage.package })
    })).json();
    assert.equal(resourceRestorePackage.ok, true, JSON.stringify(resourceRestorePackage));
    assert.equal((await (await request(`/api/novels/${novelId}/resources/character/character-scope-a`, tokenB)).json()).resource.payload.age, 24);
    const transferred = await (await request(`/api/workspaces/${workspaceId}/projects/${novelId}/members`, tokenA, {
      method: 'PATCH',
      body: JSON.stringify({ email: userB.email, role: 'owner', transferOwner: true })
    })).json();
    assert.equal(transferred.ok, true, JSON.stringify(transferred));
    assert.equal((await request(`/api/novels/${novelId}`, tokenA)).status, 200);
  } finally {
    app.sessions.delete(app.hashSessionToken(tokenA));
    app.sessions.delete(app.hashSessionToken(tokenB));
    app.server.closeAllConnections();
    await new Promise(resolve => app.server.close(resolve));
  }
});
