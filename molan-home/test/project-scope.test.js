'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-project-scope-native-'));
const dataDirectory = path.join(runtimeRoot, 'app-data');
const configDirectory = path.join(runtimeRoot, 'config');
fs.mkdirSync(dataDirectory, { recursive: true });
fs.mkdirSync(configDirectory, { recursive: true });
const environmentKeys = [
  'MOLAN_APP_STORE', 'MOLAN_DATA_DIR', 'MOLAN_CONFIG_DIR', 'MOLAN_REQUIRE_SQLITE',
  'MOLAN_PUBLIC_MODE', 'MOLAN_LOCAL_ONLY', 'MOLAN_PG_ENABLED'
];
const previousEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
Object.assign(process.env, {
  MOLAN_APP_STORE: 'json',
  MOLAN_DATA_DIR: dataDirectory,
  MOLAN_CONFIG_DIR: configDirectory,
  MOLAN_REQUIRE_SQLITE: '0',
  MOLAN_PUBLIC_MODE: '0',
  MOLAN_LOCAL_ONLY: '1',
  MOLAN_PG_ENABLED: '0'
});
const platformModels = ['gpt-5.6-luna', 'deepseek-v4-flash'].map(id => ({
  id, model: id, provider: 'openai-compat', baseURL: 'http://127.0.0.1:1/v1', creditsPer1k: 0.18
}));
fs.writeFileSync(path.join(configDirectory, 'config.json'), JSON.stringify({
  cloudApiBase: '', platformModels,
  pricing: { fallbackCreditsPer1k: 0.18 }, modelPolicy: { defaultModel: 'gpt-5.6-luna' }
}), 'utf8');
const app = require('../server');

test('native JSON HTTP preserves account, project, memory, package, and resource scope contracts', async t => {
  const issuedTokens = [];
  t.after(async () => {
    if (app.server.listening) {
      app.server.closeAllConnections();
      await new Promise(resolve => app.server.close(resolve));
    }
    await app.closeStorageStores();
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  });

  const port = await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', () => resolve(app.server.address().port));
  });
  const base = 'http://127.0.0.1:' + port;
  const request = (pathname, token, options = {}) => fetch(base + pathname, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }
  });
  const register = async (email, name) => {
    const response = await request('/api/auth/register', null, {
      method: 'POST', body: JSON.stringify({ email, name, password: 'test-password' })
    });
    const value = await response.json();
    assert.equal(response.status, 200, JSON.stringify(value));
    assert.equal(value.ok, true, JSON.stringify(value));
    assert.ok(value.user.userId);
    issuedTokens.push(value.token);
    return value;
  };

  const userA = await register('scope-http-a@example.com', 'HTTP作者');
  const userB = await register('scope-http-b@example.com', 'HTTP协作者');
  const tokenA = userA.token;
  const tokenB = userB.token;
  const ownerWorkspaces = await (await request('/api/workspaces', tokenA)).json();
  assert.equal(ownerWorkspaces.workspaces.length, 1);

  const novelId = 'n_scopehttp1';
  const state = { title: 'HTTP作用域小说', volumes: [{ id: 'v1', title: '第一卷', chapters: [
    { id: 'c1', chapterNo: 10, title: '第一章', scenes: [{ id: 's1', name: '正文', content: '初稿正文' }] },
    { id: 'c2', chapterNo: 20, title: '第二章', scenes: [{ id: 's2', name: '正文', content: '第二章正文' }] }
  ] }] };
  const createdResponse = await request('/api/novels', tokenA, {
    method: 'POST', body: JSON.stringify({ id: novelId, title: state.title, state })
  });
  const created = await createdResponse.json();
  assert.equal(createdResponse.status, 200, JSON.stringify(created));
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.projectId, novelId);
  const workspaceId = created.workspaceId;
  assert.equal(ownerWorkspaces.workspaces[0].id, workspaceId);
  const ownerMembers = await (await request('/api/workspaces/' + workspaceId + '/projects/' + novelId + '/members', tokenA)).json();
  assert.equal(ownerMembers.members.length, 1);
  assert.equal(ownerMembers.members[0].role, 'owner');
  assert.equal(ownerMembers.members[0].canExport, true);

  const previousGenerationFlag = process.env.MOLAN_GENERATION_V2;
  process.env.MOLAN_GENERATION_V2 = 'true';
  try {
    const legacyWrite = prompt => ({
      projectId: novelId, chapterId: 'c1', creationMode: true, stage: 'writing',
      genre: '玄幻', prompt
    });
    const missingKey = await request('/api/chat', tokenA, {
      method: 'POST', body: JSON.stringify(legacyWrite('写第一章'))
    });
    assert.equal(missingKey.status, 428);
    assert.equal((await missingKey.json()).code, 'IDEMPOTENCY_KEY_REQUIRED');

    const forbiddenWrite = await request('/api/chat', tokenB, {
      method: 'POST',
      headers: { 'Idempotency-Key': 'legacy-chat-unauthorized' },
      body: JSON.stringify(legacyWrite('写第一章'))
    });
    assert.equal(forbiddenWrite.status, 404);

    const legacyOptions = prompt => ({
      method: 'POST',
      headers: { 'Idempotency-Key': 'legacy-chat-idempotent' },
      body: JSON.stringify(legacyWrite(prompt))
    });
    const firstLegacyRun = await request('/api/chat', tokenA, legacyOptions('写第一章'));
    assert.equal(firstLegacyRun.status, 200);
    assert.match(firstLegacyRun.headers.get('content-type') || '', /text\/event-stream/i);
    const firstLegacyBody = await firstLegacyRun.text();
    const firstLegacyLine = firstLegacyBody.split(/\r?\n/).find(line => line.startsWith('data: '));
    assert.ok(firstLegacyLine);
    const firstLegacyEvent = JSON.parse(firstLegacyLine.slice(6));
    assert.equal(firstLegacyEvent.idempotent, false);
    const legacyRunId = firstLegacyRun.headers.get('x-molan-generation-id');
    assert.ok(legacyRunId);

    const replayLegacyRun = await request('/api/chat', tokenA, legacyOptions('写第一章'));
    assert.equal(replayLegacyRun.status, 200);
    const replayLegacyBody = await replayLegacyRun.text();
    const replayLegacyLine = replayLegacyBody.split(/\r?\n/).find(line => line.startsWith('data: '));
    assert.ok(replayLegacyLine);
    const replayLegacyEvent = JSON.parse(replayLegacyLine.slice(6));
    assert.equal(replayLegacyEvent.idempotent, true);
    assert.equal(replayLegacyRun.headers.get('x-molan-generation-id'), legacyRunId);

    const conflictingLegacyRun = await request('/api/chat', tokenA, legacyOptions('写不同的第一章'));
    assert.equal(conflictingLegacyRun.status, 409);
    assert.equal((await conflictingLegacyRun.json()).code, 'IDEMPOTENCY_KEY_REUSED');
  } finally {
    if (previousGenerationFlag === undefined) delete process.env.MOLAN_GENERATION_V2;
    else process.env.MOLAN_GENERATION_V2 = previousGenerationFlag;
  }

  const textExport = await request('/api/novels/' + novelId + '/export?format=txt', tokenA);
  assert.equal(textExport.status, 200);
  assert.match(textExport.headers.get('content-type') || '', /^text\/plain; charset=utf-8/i);
  assert.match(textExport.headers.get('content-disposition') || '', /attachment/);
  assert.match(await textExport.text(), /初稿正文/);
  const rangedExport = await request('/api/novels/' + novelId + '/export?format=txt&fromChapter=2&toChapter=2', tokenA);
  assert.equal(rangedExport.status, 200);
  const rangedText = await rangedExport.text();
  assert.match(rangedText, /第二章正文/);
  assert.doesNotMatch(rangedText, /初稿正文/);
  for (const suffix of [
    'fromChapter=0', 'fromChapter=2&toChapter=1', 'fromChapter=3', 'toChapter=3',
    'fromChapter=1&fromChapter=2'
  ]) {
    const invalidRange = await request('/api/novels/' + novelId + '/export?format=txt&' + suffix, tokenA);
    assert.equal(invalidRange.status, 400, suffix);
    assert.equal(invalidRange.headers.get('content-disposition'), null, suffix);
    assert.equal((await invalidRange.json()).code, 'export_range_invalid', suffix);
  }
  assert.equal((await request('/api/novels/' + novelId + '/export?format=pdf', tokenA)).status, 400);
  assert.equal((await request('/api/novels/' + novelId + '/export?format=txt', tokenB)).status, 404);
  assert.equal((await (await request('/api/novels', tokenB)).json()).novels.length, 0);
  assert.equal((await request('/api/novels/' + novelId, tokenB)).status, 404);
  assert.equal((await request('/api/books/' + novelId + '/memory', tokenB)).status, 404);
  assert.equal((await request('/api/books/' + novelId + '/memory', tokenA)).status, 200);

  const candidateResponse = await request('/api/books/' + novelId + '/memory/changesets', tokenA, {
    method: 'POST',
    body: JSON.stringify({ operations: [{ type: 'STATE_TRANSITION', payload: { entityId: 'item_http', postState: 'held' } }] })
  });
  const candidateResult = await candidateResponse.json();
  assert.equal(candidateResponse.status, 201, JSON.stringify(candidateResult));
  const candidateId = candidateResult.changeset.id;
  assert.ok(candidateId);
  const memoryPath = '/api/books/' + novelId + '/memory/changesets/' + candidateId;
  assert.equal((await request(memoryPath + '/approve', tokenB, { method: 'POST', body: '{}' })).status, 404);
  assert.equal((await request(memoryPath + '/approve', tokenA, { method: 'POST', body: '{' })).status, 400);
  assert.equal((await request(memoryPath + '/approve', tokenA, { method: 'POST', body: '{}' })).status, 200);
  const commitOptions = { method: 'POST', body: '{}', headers: { 'Idempotency-Key': 'memory-http-commit' } };
  const receipt = await (await request(memoryPath + '/commit', tokenA, commitOptions)).json();
  assert.equal(receipt.ok, true, JSON.stringify(receipt));
  assert.equal(receipt.stateVersion, 2);
  assert.equal(receipt.projectionStatus, 'queued');
  const replay = await (await request(memoryPath + '/commit', tokenA, commitOptions)).json();
  assert.deepEqual(replay, { ...receipt, replayed: true });
  const memoryRecord = await app.appRepository().repository.memory.get(novelId, 'memory:' + novelId);
  assert.equal(memoryRecord.branches.main.outbox.length, 1);
  assert.equal((await request('/api/runs/' + candidateId, tokenB)).status, 404);
  assert.equal((await request('/api/runs/' + candidateId, tokenA)).status, 200);
  const conflict = await request(memoryPath + '/commit', tokenA, {
    ...commitOptions, body: JSON.stringify({ candidateHash: 'tampered' })
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, 'IDEMPOTENCY_CONFLICT');

  const workspaceMember = await (await request('/api/workspaces/' + workspaceId + '/members', tokenA, {
    method: 'POST', body: JSON.stringify({ email: userB.user.email, role: 'member' })
  })).json();
  assert.equal(workspaceMember.ok, true, JSON.stringify(workspaceMember));
  const member = await (await request('/api/workspaces/' + workspaceId + '/projects/' + novelId + '/members', tokenA, {
    method: 'POST', body: JSON.stringify({ email: userB.user.email, role: 'editor' })
  })).json();
  assert.equal(member.ok, true, JSON.stringify(member));
  assert.equal((await request('/api/novels/' + novelId + '/export?format=txt', tokenB)).status, 404);

  const shared = await (await request('/api/novels/' + novelId, tokenB)).json();
  assert.equal(shared.ok, true, JSON.stringify(shared));
  assert.equal((await request('/api/books/' + novelId + '/memory', tokenB)).status, 200);
  const changed = structuredClone(shared.novel.state);
  changed.title = '协作者已保存';
  const saved = await (await request('/api/novels/' + novelId, tokenB, {
    method: 'PUT', body: JSON.stringify({ state: changed, title: changed.title, revision: shared.novel.revision })
  })).json();
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal((await (await request('/api/novels/' + novelId, tokenA)).json()).novel.title, '协作者已保存');
  assert.equal((await request('/api/novels/' + novelId, tokenB, { method: 'DELETE' })).status, 403);
  assert.equal((await (await request('/api/novels/' + novelId, tokenA, { method: 'DELETE' })).json()).deleted, 1);
  assert.equal((await request('/api/novels/' + novelId, tokenA)).status, 404);
  assert.equal((await (await request('/api/novels/' + novelId + '/restore', tokenA, { method: 'POST', body: '{}' })).json()).restored, true);
  assert.equal((await request('/api/novels/' + novelId, tokenB)).status, 200);
  assert.equal((await request('/api/novels/' + novelId + '/package', tokenB)).status, 404);
  const packageResponse = await (await request('/api/novels/' + novelId + '/package', tokenA)).json();
  assert.equal(packageResponse.ok, true, JSON.stringify(packageResponse));
  assert.equal(packageResponse.package.manifest.scope.projectId, novelId);
  assert.equal((await request('/api/novels/' + novelId + '/package/import', tokenA, {
    method: 'POST', body: JSON.stringify({ package: packageResponse.package })
  })).status, 409);
  const beforeRestore = await (await request('/api/novels/' + novelId, tokenA)).json();
  const restoredPackage = await (await request('/api/novels/' + novelId + '/package/restore', tokenA, {
    method: 'POST', body: JSON.stringify({ revision: beforeRestore.novel.revision, package: packageResponse.package })
  })).json();
  assert.equal(restoredPackage.ok, true, JSON.stringify(restoredPackage));
  assert.equal(restoredPackage.revision, beforeRestore.novel.revision + 1);
  assert.equal((await request('/api/novels/' + novelId + '/package/restore', tokenA, {
    method: 'POST', body: JSON.stringify({ revision: beforeRestore.novel.revision, package: packageResponse.package })
  })).status, 412);
  assert.equal((await request('/api/novels/' + novelId + '/resources/character', tokenA, {
    method: 'POST', body: JSON.stringify({ id: 'character-invalid', payload: '不能静默变成空对象' })
  })).status, 422);
  const resourceCreated = await (await request('/api/novels/' + novelId + '/resources/character', tokenA, {
    method: 'POST', body: JSON.stringify({ id: 'character-scope-a', payload: { name: '林澄', age: 24, goal: '守护档案' } })
  })).json();
  assert.equal(resourceCreated.ok, true, JSON.stringify(resourceCreated));
  const resourceResponse = await request('/api/novels/' + novelId + '/resources/character/character-scope-a', tokenB);
  const resourceRead = await resourceResponse.json();
  assert.equal(resourceRead.resource.payload.age, 24);
  const resourceEtag = resourceResponse.headers.get('etag');
  assert.ok(resourceEtag);
  const resourceUpdated = await (await request('/api/novels/' + novelId + '/resources/character/character-scope-a', tokenB, {
    method: 'PATCH', headers: { 'If-Match': resourceEtag },
    body: JSON.stringify({ payload: { name: '林澄', age: 25, goal: '守护新档案' } })
  })).json();
  assert.equal(resourceUpdated.resource.revision, 2, JSON.stringify(resourceUpdated));
  const resourceHistory = await (await request('/api/novels/' + novelId + '/resources/character/character-scope-a/history', tokenB)).json();
  assert.deepEqual(resourceHistory.versions.map(version => version.revision), [2, 1]);
  const historicalRestoreResponse = await request('/api/novels/' + novelId + '/resources/character/character-scope-a/history/1/restore', tokenB, {
    method: 'POST', headers: { 'If-Match': resourceUpdated.resource.etag },
    body: JSON.stringify({ changeReason: '恢复早期人物卡' })
  });
  const historicalRestore = await historicalRestoreResponse.json();
  assert.equal(historicalRestoreResponse.status, 200, JSON.stringify(historicalRestore));
  assert.equal(historicalRestore.resource.revision, 3);
  assert.equal(historicalRestore.resource.payload.age, 24);
  assert.equal((await request('/api/novels/' + novelId + '/resources/character/character-scope-a/history/1/restore', tokenA, {
    method: 'POST', headers: { 'If-Match': resourceUpdated.resource.etag }, body: '{}'
  })).status, 412);
  assert.equal((await request('/api/novels/' + novelId + '/resources/character/character-scope-a', tokenA, {
    method: 'PATCH', headers: { 'If-Match': resourceEtag }, body: JSON.stringify({ payload: { name: '冲突' } })
  })).status, 412);
  const resourceDeleted = await (await request('/api/novels/' + novelId + '/resources/character/character-scope-a', tokenA, {
    method: 'DELETE', headers: { 'If-Match': historicalRestore.resource.etag }, body: '{}'
  })).json();
  assert.equal(resourceDeleted.ok, true, JSON.stringify(resourceDeleted));
  assert.equal(resourceDeleted.revision, 4);
  assert.equal((await (await request('/api/novels/' + novelId + '/resources/character?includeDeleted=1', tokenB)).json()).resources.length, 1);
  const resourceRestored = await (await request('/api/novels/' + novelId + '/resources/character/character-scope-a', tokenA, {
    method: 'POST', headers: { 'If-Match': '"resource-character-scope-a-' + resourceDeleted.revision + '"' },
    body: JSON.stringify({ changeReason: '回到资料中心' })
  })).json();
  assert.equal(resourceRestored.ok, true, JSON.stringify(resourceRestored));
  assert.equal((await (await request('/api/novels/' + novelId + '/resources/character', tokenB)).json()).resources.length, 1);
  const resourcePackage = await (await request('/api/novels/' + novelId + '/package', tokenA)).json();
  assert.equal(resourcePackage.ok, true, JSON.stringify(resourcePackage));
  assert.ok(Object.values(resourcePackage.package.files || {}).some(file => String(file && file.content || '').includes('projectResources')));
  const resourceChangedAfterExport = await (await request('/api/novels/' + novelId + '/resources/character/character-scope-a', tokenB, {
    method: 'PATCH', headers: { 'If-Match': resourceRestored.resource.etag },
    body: JSON.stringify({ payload: { name: '林澄', age: 26, goal: '临时修改' } })
  })).json();
  assert.equal(resourceChangedAfterExport.resource.payload.age, 26, JSON.stringify(resourceChangedAfterExport));
  const novelBeforeResourceRestore = await (await request('/api/novels/' + novelId, tokenA)).json();
  const resourceRestorePackage = await (await request('/api/novels/' + novelId + '/package/restore', tokenA, {
    method: 'POST', body: JSON.stringify({ revision: novelBeforeResourceRestore.novel.revision, package: resourcePackage.package })
  })).json();
  assert.equal(resourceRestorePackage.ok, true, JSON.stringify(resourceRestorePackage));
  assert.equal((await (await request('/api/novels/' + novelId + '/resources/character/character-scope-a', tokenB)).json()).resource.payload.age, 24);
  const transferred = await (await request('/api/workspaces/' + workspaceId + '/projects/' + novelId + '/members', tokenA, {
    method: 'PATCH', body: JSON.stringify({ email: userB.user.email, role: 'owner', transferOwner: true })
  })).json();
  assert.equal(transferred.ok, true, JSON.stringify(transferred));
  assert.equal((await request('/api/novels/' + novelId, tokenA)).status, 200);
});
