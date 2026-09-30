'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { DatabaseSync } = require('node:sqlite');

const memorySystem = require('../lib/memory-system');
const memoryRoutes = require('../lib/memory-routes');
const projectScope = require('../lib/project-scope');
const styleSystem = require('../lib/style-system');
const { createJsonStyleProfileStore } = require('../lib/style-profile-store');

function fixture(context) {
  const db = new DatabaseSync(':memory:');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-style-profiles-'));
  const styleProfileStore = createJsonStyleProfileStore(directory);
  const stores = [styleProfileStore];
  context.after(async () => {
    db.close();
    for (const store of stores) await store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  db.exec("CREATE TABLE accounts (user_id TEXT PRIMARY KEY); INSERT INTO accounts VALUES ('author'), ('viewer')");
  projectScope.initializeSchema(db);
  memorySystem.initializeSchema(db);
  styleSystem.initializeSchema(db);
  db.exec(`INSERT INTO workspaces VALUES ('workspace', 'author', 'fixture', 1, 1);
    INSERT INTO workspace_members VALUES ('workspace', 'author', 'owner', 1, 1, 1),
      ('workspace', 'viewer', 'member', 1, 1, 1);
    INSERT INTO novel_projects (workspace_id, project_id, owner_user_id, created_at, updated_at)
      VALUES ('workspace', 'book-one', 'author', 1, 1), ('workspace', 'book-two', 'author', 1, 1);
    INSERT INTO project_members VALUES ('workspace', 'book-one', 'author', 'owner', 1, 1, 1, 1, 1),
      ('workspace', 'book-two', 'author', 'owner', 1, 1, 1, 1, 1),
      ('workspace', 'book-one', 'viewer', 'viewer', 1, 0, 0, 1, 1)`);
  return { db, styleProfileStore, directory, stores };
}

async function invoke(db, styleProfileStore, method, url, body, user = { userId: 'author' }) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost' };
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    body: '',
    writeHead(statusCode) { this.statusCode = statusCode; },
    end(chunk) { if (chunk) this.body += String(chunk); this.finished = true; this.emit('finish'); }
  });
  process.nextTick(() => {
    if (body !== undefined) req.emit('data', JSON.stringify(body));
    req.emit('end');
  });
  const handled = await memoryRoutes.dispatch(req, res, url.split('?')[0], db,
    () => user ? { user, token: 'test-token' } : null, { backend: 'sqlite', styleProfileStore });
  if (!res.finished) await new Promise(resolve => res.once('finish', resolve));
  return { handled, status: res.statusCode, body: JSON.parse(res.body) };
}

test('文风档案 JSON API 保持版本、分支和项目隔离，并进入上下文编译', async context => {
  const { db, styleProfileStore, directory, stores } = fixture(context);
  const created = await invoke(db, styleProfileStore, 'POST', '/api/books/book-one/styles', {
    id: 'profile-one', expectedRevision: 0, name: '近距离限知', level: 'novel_narrative',
    hardRules: ['只写当前视角可知信息'], checkRules: { minDialogueRatio: 0.4 }
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.revision, 1);

  const updated = await invoke(db, styleProfileStore, 'POST', '/api/books/book-one/styles', {
    id: 'profile-one', expectedRevision: 1, name: '限知叙事修订',
    hardRules: ['只写当前视角可知信息', '对白必须推动冲突']
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.revision, 2);
  assert.equal(updated.body.level, 'novel_narrative');

  const stale = await invoke(db, styleProfileStore, 'POST', '/api/books/book-one/styles', {
    id: 'profile-one', expectedRevision: '1', name: '过期写入'
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'STYLE_VERSION_CONFLICT');

  const history = await invoke(db, styleProfileStore, 'GET', '/api/books/book-one/styles/profile-one/versions');
  assert.equal(history.status, 200);
  assert.deepEqual(history.body.versions.map(version => version.revision), [1, 2]);

  const mainStyles = await invoke(db, styleProfileStore, 'GET', '/api/books/book-one/styles');
  assert.equal(mainStyles.body.styles[0].level, 'novel_narrative');
  assert.equal(mainStyles.body.styles[0].revision, 2);
  const otherBranch = await invoke(db, styleProfileStore, 'GET', '/api/books/book-one/styles?branchId=branch-two');
  assert.deepEqual(otherBranch.body.styles, []);
  const otherProject = await invoke(db, styleProfileStore, 'GET', '/api/books/book-two/styles');
  assert.deepEqual(otherProject.body.styles, []);

  const manifest = await invoke(db, styleProfileStore, 'POST', '/api/books/book-one/context/assemble', { budgetTokens: 5000 });
  assert.equal(manifest.status, 200);
  assert.deepEqual(manifest.body.manifest.writingPackage.style.hardRules,
    ['只写当前视角可知信息', '对白必须推动冲突']);
  assert.deepEqual(manifest.body.manifest.auditPackage.inputMetadata.styleVersions,
    [{ id: 'profile-one', revision: 2 }]);

  const audit = await invoke(db, styleProfileStore, 'POST', '/api/books/book-one/style-audits', {
    text: '一段没有对白的正文。'
  });
  assert.equal(audit.status, 200);
  assert.deepEqual(audit.body.audit.styleVersions, [{ id: 'profile-one', revision: 2 }]);
  assert.ok(audit.body.audit.findings.some(finding => finding.type === 'DIALOGUE_RATIO_TOO_LOW'));
  assert.equal(db.prepare('SELECT count(*) AS count FROM style_profiles').get().count, 0);

  await styleProfileStore.close();
  const reopenedStore = createJsonStyleProfileStore(directory);
  stores.push(reopenedStore);
  const afterRestart = await reopenedStore.getStyleProfiles({ projectId: 'book-one', bookId: 'book-one' });
  assert.equal(afterRestart[0].revision, 2);
  assert.deepEqual((await reopenedStore.getStyleProfileVersions({
    projectId: 'book-one', bookId: 'book-one', profileId: 'profile-one'
  })).map(version => version.revision), [1, 2]);
});

test('文风 JSON 路由仍执行项目读写权限检查', async context => {
  const { db, styleProfileStore } = fixture(context);
  const deniedWrite = await invoke(db, styleProfileStore, 'POST', '/api/books/book-one/styles',
    { name: '越权文风' }, { userId: 'viewer' });
  assert.equal(deniedWrite.status, 403);
  const deniedRead = await invoke(db, styleProfileStore, 'GET', '/api/books/book-two/styles',
    undefined, { userId: 'viewer' });
  assert.equal(deniedRead.status, 404);
});
