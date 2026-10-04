'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { JsonAppRepository } = require('../lib/repositories/json-app-repository');
const { JsonCreationRepository } = require('../lib/repositories/json-creation-repository');
const { createGenerationService } = require('../services/generation-service');

test('native generation uses shared authority, Bible version and plan hash without SQL', async testContext => {
  const previous = process.env.MOLAN_APP_STORE;
  process.env.MOLAN_APP_STORE = 'json';
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-native-generation-'));
  const app = new JsonAppRepository(directory);
  testContext.after(async () => {
    if (previous === undefined) delete process.env.MOLAN_APP_STORE;
    else process.env.MOLAN_APP_STORE = previous;
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const user = await app.saveAccount({ userId: 'owner', email: 'owner@test.local' });
  const novel = await app.create({ user, id: 'n_generation', state: { volumes: [] } });
  const repository = new JsonCreationRepository(app);
  const scope = { userId: user.userId, projectId: novel.id, workspaceId: novel.workspaceId, bookId: 'cb_generation' };
  await repository.create({ ...scope, payload: { creationPlan: { marker: 'authority' } } });
  let options;
  const service = createGenerationService({
    POSTGRES_MODE: false, crypto,
    projectScope: require('../lib/project-scope'), generationManifest: require('../lib/generation/manifest'),
    getNativeCreationRepository: () => repository, getNativeAppRepository: () => app,
    getDatabase: () => { throw new Error('SQL must not be used'); }, generationRunStore: () => ({}),
    createGenerationOrchestrator: value => { options = value; return {}; },
    creationChapterContext: () => ({ characters: [], characterLibrary: [], rules: [] })
  });
  const input = {
    actorUserId: user.userId, projectId: novel.id, workspaceId: novel.workspaceId,
    request: { creationBookId: scope.bookId, chapterId: 'chapter_1' }
  };
  const authority = await service.loadAuthoritativeGenerationContext(input);
  assert.equal(authority.ok, true);
  assert.equal(authority.storyContext.bibleVersion, 1);
  assert.equal(authority.storyContext.baseRevision, novel.revision);
  assert.equal(authority.storyContext.planHash, crypto.createHash('sha256').update(JSON.stringify({ marker: 'authority' })).digest('hex'));
  assert.equal((await service.loadAuthoritativeGenerationContext({ ...input, actorUserId: 'outsider' })).ok, false);
  await repository.saveBibleCAS({ ...scope, expectedVersion: 1, payload: { creationPlan: { marker: 'updated' } } });
  const updated = await service.loadAuthoritativeGenerationContext(input);
  assert.equal(updated.storyContext.bibleVersion, 2);
  assert.notEqual(updated.snapshotHash, authority.snapshotHash);
  service.generationRunOrchestrator();
  assert.equal(options.db, app.repository);
  const dependencies = options.dependenciesForRun({ auth: { user }, user, actorUserId: user.userId, projectId: novel.id, workspaceId: novel.workspaceId }, {});
  let committed;
  repository.commitChapter = async value => { committed = value; return { committed: true }; };
  await dependencies.commit({
    run: { id: 'run', projectId: novel.id, workspaceId: novel.workspaceId, leaseOwner: 'worker', fencingToken: 2 },
    request: { creationBookId: scope.bookId }, payload: { userId: 'outsider' }, text: 'draft'
  });
  assert.equal(committed.userId, user.userId);
  assert.equal(committed.projectId, novel.id);
  assert.equal(committed.leaseOwner, 'worker');
  assert.equal(committed.fencingToken, 2);
});

test('native V2 commit route persists manuscript and receipt once through the real orchestrator', async testContext => {
  const previous = process.env.MOLAN_APP_STORE;
  process.env.MOLAN_APP_STORE = 'json';
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-native-route-commit-'));
  const app = new JsonAppRepository(directory);
  testContext.after(async () => {
    if (previous === undefined) delete process.env.MOLAN_APP_STORE;
    else process.env.MOLAN_APP_STORE = previous;
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const user = await app.saveAccount({ userId: 'route-owner', email: 'route-owner@test.local' });
  const novel = await app.create({ user, id: 'n_routecommit', state: { volumes: [{ chapters: [{ id: 'chapter_1', scenes: [{ id: 'scene_1', content: 'old' }] }] }] } });
  const repository = new JsonCreationRepository(app);
  const scope = { userId: user.userId, projectId: novel.id, workspaceId: novel.workspaceId, bookId: 'cb_route_commit' };
  await repository.create({ ...scope, payload: {} });
  const manifest = require('../lib/generation/manifest');
  const store = require('../lib/generation/json-store').createJsonGenerationStore(null, { repository: app.repository });
  const request = {
    creationBookId: scope.bookId, novelId: novel.id, chapterId: 'chapter_1', sceneId: 'scene_1',
    storyContext: { stateVersion: 0, baseRevision: 0, baseHash: manifest.hashValue('old'), bibleVersion: 1, planHash: manifest.hashValue('{}') }
  };
  await store.createRun({
    id: 'route-run', actorUserId: user.userId, projectId: novel.id, workspaceId: novel.workspaceId,
    chapterId: 'chapter_1', idempotencyKey: 'route-key', requestHash: manifest.hashValue(request), request
  });
  const row = await app.repository.generation.get(novel.id, 'route-run');
  const text = 'new';
  await app.repository.generation.put(novel.id, {
    ...row, state: 'waiting_author', costStatus: 'settled', actualCostMinor: 0,
    stages: [{ stage: 'provider:writer', costStatus: 'settled', status: 'completed', actualCostMinor: 0 }],
    result: {
      draft: text, outputHash: manifest.hashValue(text), contract: { chapterNo: 1 }, audit: { passed: true, issues: [] },
      benchmark: { status: 'passed' }, semanticAudit: { passed: true, audit: { passed: true, issues: [], factLedgerDelta: { newPromises: [], newRules: [], updates: [], byEntity: {} } } },
      quality: { passed: true, status: 'MEASURED', qualityVector: { language: { value: 0.9, confidence: 0.9, status: 'MEASURED', source: 'literary_evaluator', evidence: [{ quote: text, start: 0, end: text.length }] } } }
    }
  }, row.revision);
  let response;
  const body = { text, outputHash: manifest.hashValue(text), userId: 'outsider' };
  const service = createGenerationService({
    POSTGRES_MODE: false, crypto,
    GenerationError: require('../lib/generation/errors').GenerationError, projectScope: require('../lib/project-scope'), generationManifest: manifest,
    getNativeCreationRepository: () => repository, getNativeAppRepository: () => app, getDatabase: () => { throw new Error('SQL must not be used'); },
    generationRunStore: () => store, createGenerationOrchestrator: require('../lib/generation/orchestrator').createGenerationOrchestrator,
    generationV2Enabled: () => true, getAuthUser: () => ({ user }), postgresActor: auth => auth.user.userId,
    requireSqliteForPublic: () => true, decodePathParam: decodeURIComponent, readBody: async () => body,
    json: (responseTarget, status, data) => { response = { status, data }; }
  });
  const req = { method: 'POST', headers: {}, url: '/api/generation-runs/route-run/commit' };
  await service.handleGenerationRuns(req, {}, req.url);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.equal(response.data.run.state, 'committed');
  assert.equal((await app.read(scope)).state.volumes[0].chapters[0].scenes[0].content, text);
  await service.handleGenerationRuns(req, {}, req.url);
  assert.equal(response.status, 200);
  assert.equal(response.data.idempotent, true);
  assert.equal((await app.read(scope)).revision, 1);
  assert.equal((await repository.snapshots(scope)).length, 1);
});

test('service-level resolveStyle: 只有持久小说文风设定时继承作品设定且客户端伪权威不覆盖', async testContext => {
  const previousStore = process.env.MOLAN_APP_STORE;
  process.env.MOLAN_APP_STORE = 'json';
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-native-style-novel-'));
  const app = new JsonAppRepository(directory);
  testContext.after(async () => {
    if (previousStore === undefined) delete process.env.MOLAN_APP_STORE;
    else process.env.MOLAN_APP_STORE = previousStore;
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const novelPersistentStyle = '清冷留白、古典肃穆的史诗叙事风';
  const user = await app.saveAccount({ userId: 'style-novel-owner', email: 'style-novel-owner@test.local' });
  const novel = await app.create({
    user,
    id: 'n_stylenovel',
    state: {
      narrativeStyle: novelPersistentStyle,
      volumes: []
    }
  });
  const repository = new JsonCreationRepository(app);
  const scope = { userId: user.userId, projectId: novel.id, workspaceId: novel.workspaceId, bookId: 'cb_style_novel' };
  await repository.create({
    ...scope,
    payload: {
      creationPlan: { marker: 'style-novel-plan' }
    }
  });

  let capturedOptions;
  const service = createGenerationService({
    POSTGRES_MODE: false,
    crypto,
    projectScope: require('../lib/project-scope'),
    generationManifest: require('../lib/generation/manifest'),
    getNativeCreationRepository: () => repository,
    getNativeAppRepository: () => app,
    getDatabase: () => { throw new Error('SQL must not be used'); },
    generationRunStore: () => ({}),
    createGenerationOrchestrator: value => { capturedOptions = value; return {}; },
    creationChapterContext: () => ({ characters: [], characterLibrary: [], rules: [] })
  });

  service.generationRunOrchestrator();
  const runRequest = { creationBookId: scope.bookId, chapterId: 'chapter_1' };
  const dependencies = capturedOptions.dependenciesForRun({
    auth: { user },
    user,
    actorUserId: user.userId,
    projectId: novel.id,
    workspaceId: novel.workspaceId
  }, runRequest);

  const inheritedResult = await dependencies.resolveStyle(runRequest, 'universal');
  assert.equal(inheritedResult.status, 'resolved');
  assert.equal(inheritedResult.source, 'narrative_authoritative');
  assert.match(inheritedResult.style, /清冷留白、古典肃穆/);

  const spoofedClientRequest = {
    ...runRequest,
    storyContext: {
      narrativeStyle: '客户端伪造的轻佻搞笑文风'
    }
  };
  const antiSpoofResult = await dependencies.resolveStyle(spoofedClientRequest, 'universal');
  assert.equal(antiSpoofResult.source, 'narrative_authoritative');
  assert.match(antiSpoofResult.style, /清冷留白、古典肃穆/);
  assert.doesNotMatch(antiSpoofResult.style, /客户端伪造/);
});

test('service-level resolveStyle: 只有 Bible 存储文风时继承作品设定且客户端伪权威不覆盖', async testContext => {
  const previousStore = process.env.MOLAN_APP_STORE;
  process.env.MOLAN_APP_STORE = 'json';
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-native-style-bible-'));
  const app = new JsonAppRepository(directory);
  testContext.after(async () => {
    if (previousStore === undefined) delete process.env.MOLAN_APP_STORE;
    else process.env.MOLAN_APP_STORE = previousStore;
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const biblePersistentStyle = '典雅含蓄、暗藏机锋的深宫权谋风';
  const user = await app.saveAccount({ userId: 'style-bible-owner', email: 'style-bible-owner@test.local' });
  const novel = await app.create({
    user,
    id: 'n_stylebible',
    state: {
      volumes: []
    }
  });
  const repository = new JsonCreationRepository(app);
  const scope = { userId: user.userId, projectId: novel.id, workspaceId: novel.workspaceId, bookId: 'cb_style_bible' };
  await repository.create({
    ...scope,
    payload: {
      narrativeStyle: biblePersistentStyle,
      creationPlan: { marker: 'style-bible-plan' }
    }
  });

  let capturedOptions;
  const service = createGenerationService({
    POSTGRES_MODE: false,
    crypto,
    projectScope: require('../lib/project-scope'),
    generationManifest: require('../lib/generation/manifest'),
    getNativeCreationRepository: () => repository,
    getNativeAppRepository: () => app,
    getDatabase: () => { throw new Error('SQL must not be used'); },
    generationRunStore: () => ({}),
    createGenerationOrchestrator: value => { capturedOptions = value; return {}; },
    creationChapterContext: () => ({ characters: [], characterLibrary: [], rules: [] })
  });

  service.generationRunOrchestrator();
  const runRequest = { creationBookId: scope.bookId, chapterId: 'chapter_1' };
  const dependencies = capturedOptions.dependenciesForRun({
    auth: { user },
    user,
    actorUserId: user.userId,
    projectId: novel.id,
    workspaceId: novel.workspaceId
  }, runRequest);

  const inheritedResult = await dependencies.resolveStyle(runRequest, 'universal');
  assert.equal(inheritedResult.status, 'resolved');
  assert.equal(inheritedResult.source, 'narrative_authoritative');
  assert.match(inheritedResult.style, /典雅含蓄、暗藏机锋/);

  const spoofedClientRequest = {
    ...runRequest,
    storyContext: {
      narrativeStyle: '客户端伪造的都市快餐风'
    }
  };
  const antiSpoofResult = await dependencies.resolveStyle(spoofedClientRequest, 'universal');
  assert.equal(antiSpoofResult.source, 'narrative_authoritative');
  assert.match(antiSpoofResult.style, /典雅含蓄、暗藏机锋/);
  assert.doesNotMatch(antiSpoofResult.style, /客户端伪造/);
});

test('service-level resolveStyle: 无任何文风时从持久正文样本推断且 writer 真实调用并正确接收解析结果', async testContext => {
  const previousStore = process.env.MOLAN_APP_STORE;
  process.env.MOLAN_APP_STORE = 'json';
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-native-style-sample-'));
  const app = new JsonAppRepository(directory);
  testContext.after(async () => {
    if (previousStore === undefined) delete process.env.MOLAN_APP_STORE;
    else process.env.MOLAN_APP_STORE = previousStore;
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const sampleProse = '韩立捡到了神秘小绿瓶，黄枫谷七玄门墨大夫，小心翼翼隐忍算计，散修灵根灵石紧缺，如履薄冰。';
  const user = await app.saveAccount({ userId: 'sample-owner', email: 'sample-owner@test.local' });
  const novel = await app.create({
    user,
    id: 'n_stylesample',
    state: {
      volumes: [
        {
          chapters: [
            {
              id: 'chapter_sample_1',
              title: '序章',
              scenes: [{ id: 'scene_sample_1', content: sampleProse }]
            }
          ]
        }
      ]
    }
  });
  const repository = new JsonCreationRepository(app);
  const scope = { userId: user.userId, projectId: novel.id, workspaceId: novel.workspaceId, bookId: 'cb_style_sample' };
  await repository.create({
    ...scope,
    payload: {
      creationPlan: { marker: 'sample-plan' }
    }
  });

  let capturedDraftInput = null;
  const fakeContentEngine = {
    generateDraft: async draftInput => {
      capturedDraftInput = draftInput;
      return {
        draft: '生成的示例正文内容',
        outputHash: crypto.createHash('sha256').update('生成的示例正文内容').digest('hex'),
        audit: { passed: true, issues: [] }
      };
    }
  };

  let capturedOptions;
  const service = createGenerationService({
    POSTGRES_MODE: false,
    crypto,
    contentEngine: fakeContentEngine,
    projectScope: require('../lib/project-scope'),
    generationManifest: require('../lib/generation/manifest'),
    getNativeCreationRepository: () => repository,
    getNativeAppRepository: () => app,
    getDatabase: () => { throw new Error('SQL must not be used'); },
    generationRunStore: () => ({}),
    createGenerationOrchestrator: value => { capturedOptions = value; return {}; },
    creationChapterContext: () => ({ characters: [], characterLibrary: [], rules: [] })
  });

  service.generationRunOrchestrator();
  const runRequest = {
    creationBookId: scope.bookId,
    chapterId: 'chapter_sample_2',
    storyContext: {
      narrativeStyle: '客户端伪造的轻佻搞笑文风'
    }
  };
  const dependencies = capturedOptions.dependenciesForRun({
    auth: { user },
    user,
    actorUserId: user.userId,
    projectId: novel.id,
    workspaceId: novel.workspaceId
  }, runRequest);

  const sampleInferred = await dependencies.resolveStyle(runRequest, 'universal');
  assert.equal(sampleInferred.status, 'resolved');
  assert.equal(sampleInferred.source, 'inferred_sample');
  assert.equal(sampleInferred.bundle.styleId, 'hardcore_progression');
  assert.ok(typeof sampleInferred.confidence === 'number' && sampleInferred.confidence > 0.6);

  const resolvedBundleStyle = sampleInferred.style;
  assert.ok(resolvedBundleStyle && resolvedBundleStyle.length > 0);
  assert.doesNotMatch(resolvedBundleStyle, /\[object Object\]/);
  assert.doesNotMatch(resolvedBundleStyle, /客户端伪造/);

  await dependencies.writer({
    request: runRequest,
    style: sampleInferred,
    contract: { chapterId: 'chapter_sample_2' }
  });

  assert.ok(capturedDraftInput !== null, 'dependencies.writer 必须真实调用 contentEngine.generateDraft');
  assert.equal(capturedDraftInput.style, sampleInferred.style);
  assert.doesNotMatch(capturedDraftInput.style, /\[object Object\]/);
  assert.doesNotMatch(capturedDraftInput.style, /客户端伪造/);

  const explicitStyleInput = {
    style: '显式指定硬核科幻风'
  };
  await dependencies.writer({
    request: runRequest,
    style: explicitStyleInput,
    contract: { chapterId: 'chapter_sample_2' }
  });
  assert.equal(capturedDraftInput.style, '显式指定硬核科幻风', '显式传入文风优先且正确传递至 writer 依赖');
});
