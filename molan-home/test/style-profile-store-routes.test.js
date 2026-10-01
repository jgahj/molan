'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');

const memoryRoutes = require('../lib/memory-routes');
const { JsonFileRepository } = require('../lib/repositories/json-file-repository');
const { JsonAppRepository } = require('../lib/repositories/json-app-repository');
const { createMemoryStore } = require('../lib/memory-store');
const { createJsonStyleProfileStore } = require('../lib/style-profile-store');

async function fixture(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-style-profiles-'));
  let repository = new JsonFileRepository(directory);
  let app = new JsonAppRepository(directory, { repository });
  let memoryStore = createMemoryStore({ repository, getAccess: input => app.getAccess(input) });
  let styleProfileStore = createJsonStyleProfileStore(directory, { repository });
  context.after(async () => {
    await styleProfileStore.close();
    await memoryStore.close();
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await app.saveAccount({ userId: 'author', email: 'author@style.test' });
  await app.saveAccount({ userId: 'viewer', email: 'viewer@style.test' });
  const bookOne = await app.create({ id: 'n_styleone', user: { userId: 'author' }, state: { title: '文风一', volumes: [] } });
  await app.create({ id: 'n_styletwo', user: { userId: 'author' }, state: { title: '文风二', volumes: [] } });
  await app.upsertWorkspaceMember('author', bookOne.workspaceId, 'viewer', 'member');
  await app.upsertProjectMember({ userId: 'author', projectId: bookOne.id, targetUserId: 'viewer', role: 'viewer', expectedAclRevision: 1 });

  async function reopenStyleProfileStore() {
    await styleProfileStore.close();
    await memoryStore.close();
    await repository.close();
    repository = new JsonFileRepository(directory);
    app = new JsonAppRepository(directory, { repository });
    memoryStore = createMemoryStore({ repository, getAccess: input => app.getAccess(input) });
    styleProfileStore = createJsonStyleProfileStore(directory, { repository });
    return styleProfileStore;
  }
  return { memoryStore, styleProfileStore, reopenStyleProfileStore };
}

async function invoke(memoryStore, styleProfileStore, method, url, body, user = { userId: 'author' }) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost' };
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    body: '',
    writeHead(statusCode) { this.statusCode = statusCode; },
    end(chunk) { if (chunk) this.body += String(chunk); this.finished = true; this.emit('finish'); }
  });
  const handled = await memoryRoutes.dispatch(req, res, url.split('?')[0], null,
    async () => user ? { user, token: 'test-token' } : null,
    { backend: 'json', memoryStore, styleProfileStore });
  if (!res.finished) await new Promise(resolve => res.once('finish', resolve));
  return { handled, status: res.statusCode, body: JSON.parse(res.body) };
}

test('文风档案 JSON API 保持版本、分支和项目隔离，并进入上下文编译', async context => {
  const { memoryStore, styleProfileStore, reopenStyleProfileStore } = await fixture(context);
  const created = await invoke(memoryStore, styleProfileStore, 'POST', '/api/books/n_styleone/styles', {
    id: 'profile-one', projectId: 'n_styletwo', expectedRevision: 0, name: '近距离限知', level: 'novel_narrative',
    hardRules: ['只写当前视角可知信息'], checkRules: { minDialogueRatio: 0.4 }
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.revision, 1);

  const updated = await invoke(memoryStore, styleProfileStore, 'POST', '/api/books/n_styleone/styles', {
    id: 'profile-one', expectedRevision: 1, name: '限知叙事修订',
    hardRules: ['只写当前视角可知信息', '对白必须推动冲突']
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.revision, 2);
  assert.equal(updated.body.level, 'novel_narrative');

  const stale = await invoke(memoryStore, styleProfileStore, 'POST', '/api/books/n_styleone/styles', {
    id: 'profile-one', expectedRevision: '1', name: '过期写入'
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'STYLE_VERSION_CONFLICT');

  const history = await invoke(memoryStore, styleProfileStore, 'GET', '/api/books/n_styleone/styles/profile-one/versions');
  assert.equal(history.status, 200);
  assert.deepEqual(history.body.versions.map(version => version.revision), [1, 2]);

  const mainStyles = await invoke(memoryStore, styleProfileStore, 'GET', '/api/books/n_styleone/styles');
  assert.equal(mainStyles.body.styles[0].level, 'novel_narrative');
  assert.equal(mainStyles.body.styles[0].revision, 2);
  const otherBranch = await invoke(memoryStore, styleProfileStore, 'GET', '/api/books/n_styleone/styles?branchId=branch-two');
  assert.deepEqual(otherBranch.body.styles, []);
  const otherProject = await invoke(memoryStore, styleProfileStore, 'GET', '/api/books/n_styletwo/styles');
  assert.deepEqual(otherProject.body.styles, []);

  const manifest = await invoke(memoryStore, styleProfileStore, 'POST', '/api/books/n_styleone/context/assemble', {
    budgetTokens: 5000, styleProfiles: [{ id: 'forged-profile', revision: 99, hardRules: ['伪造规则'] }]
  });
  assert.equal(manifest.status, 200);
  assert.deepEqual(manifest.body.manifest.writingPackage.style.hardRules,
    ['只写当前视角可知信息', '对白必须推动冲突']);
  assert.deepEqual(manifest.body.manifest.auditPackage.inputMetadata.styleVersions,
    [{ id: 'profile-one', revision: 2 }]);

  const audit = await invoke(memoryStore, styleProfileStore, 'POST', '/api/books/n_styleone/style-audits', {
    text: '一段没有对白的正文。'
  });
  assert.equal(audit.status, 200);
  assert.deepEqual(audit.body.audit.styleVersions, [{ id: 'profile-one', revision: 2 }]);
  assert.ok(audit.body.audit.findings.some(finding => finding.type === 'DIALOGUE_RATIO_TOO_LOW'));

  const reopenedStore = await reopenStyleProfileStore();
  const afterRestart = await reopenedStore.getStyleProfiles({ projectId: 'n_styleone', bookId: 'n_styleone' });
  assert.equal(afterRestart[0].revision, 2);
  assert.deepEqual((await reopenedStore.getStyleProfileVersions({
    projectId: 'n_styleone', bookId: 'n_styleone', profileId: 'profile-one'
  })).map(version => version.revision), [1, 2]);
});

test('文风 JSON 路由仍执行项目读写权限检查', async context => {
  const { memoryStore, styleProfileStore } = await fixture(context);
  const deniedWrite = await invoke(memoryStore, styleProfileStore, 'POST', '/api/books/n_styleone/styles',
    { name: '越权文风' }, { userId: 'viewer' });
  assert.equal(deniedWrite.status, 403);
  const deniedRead = await invoke(memoryStore, styleProfileStore, 'GET', '/api/books/n_styletwo/styles',
    undefined, { userId: 'viewer' });
  assert.equal(deniedRead.status, 404);
  const unknownRoute = await invoke(memoryStore, styleProfileStore, 'GET', '/api/books/n_styleone/styles/profile-one/unknown');
  assert.equal(unknownRoute.status, 404);
  assert.equal(unknownRoute.body.code, 'ROUTE_NOT_FOUND');
});
