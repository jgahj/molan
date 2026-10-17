'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { JsonAppRepository } = require('../lib/repositories/json-app-repository');
const { createGenerationService } = require('../services/generation-service');

const BOOK_ID = 'cb_generation';
const PROJECT_ID = 'n_generation';
const WORKSPACE_ID = 'ws_generation';

/**
 * PG-only 验收桩：生成服务只能通过 postgresRepository 读取创作书、圣经、项目状态，
 * 任何 legacy（原生 JSON 仓储 / SQLite）路径都已随 POSTGRES_MODE 收敛删除。
 */
function createPostgresStub({ userId = 'owner', book, bible, profile, commitResult }) {
  const calls = { getProjectAccess: 0, getCreationState: 0, getProfile: 0, commitChapter: [], patchProfileScene: [] };
  const repository = {
    enabled: true,
    async getProjectAccess(actorUserId, projectId) {
      calls.getProjectAccess += 1;
      if (String(actorUserId) !== String(userId) || String(projectId) !== PROJECT_ID) return null;
      return {
        workspace_id: WORKSPACE_ID, project_id: PROJECT_ID, workspace_uuid: 'uuid_ws', project_uuid: 'uuid_pj',
        owner_user_id: userId, title: '验收项目', status: 'active', role: 'owner', active: true,
        can_spend: 1, can_export: 1, acl_revision: 1, revision: 3
      };
    },
    async getCreationState(actorUserId, bookId) {
      calls.getCreationState += 1;
      if (String(actorUserId) !== String(userId) || String(bookId) !== BOOK_ID) return null;
      return { book, bible, snapshots: [] };
    },
    async getProfile(actorUserId, projectId) {
      calls.getProfile += 1;
      if (String(actorUserId) !== String(userId) || String(projectId) !== PROJECT_ID) return null;
      return { access: { workspace_id: WORKSPACE_ID, project_id: PROJECT_ID }, state: profile.state, revision: profile.revision };
    },
    async commitChapter(input) {
      calls.commitChapter.push(input);
      if (typeof commitResult === 'function') return commitResult(input);
      return commitResult || { ok: true, committed: true, receiptId: `rcpt_${calls.commitChapter.length}` };
    },
    async patchProfileScene(input) {
      calls.patchProfileScene.push(input);
      return { revision: input.expectedRevision + 1, contentHash: 'f'.repeat(64) };
    }
  };
  return { repository, calls };
}

function baseServiceDeps(repository, extra = {}) {
  return {
    crypto,
    projectScope: require('../lib/project-scope'),
    generationManifest: require('../lib/generation/manifest'),
    postgresRepository: repository,
    postgresActor: auth => auth.user.userId,
    generationRunStore: () => ({}),
    createGenerationOrchestrator: value => {
      if (typeof extra.onOrchestrator === 'function') extra.onOrchestrator(value);
      return {};
    },
    creationChapterContext: () => ({ characters: [], characterLibrary: [], rules: [] }),
    ...extra
  };
}

function creationBook() {
  return {
    id: BOOK_ID, title: '验收创作书', novelId: PROJECT_ID, bibleId: 'bible_generation',
    currentStateVersion: 0, currentChapterNo: 0, status: 'draft',
    workspaceId: WORKSPACE_ID, projectId: PROJECT_ID, ownerUserId: 'owner'
  };
}

test('PG 生成上下文只读创作书、圣经与项目状态，bible 版本与 planHash 权威且提交走 PG CAS', async () => {
  const book = creationBook();
  const bible = { bibleId: 'bible_generation', version: 1, payload: { creationPlan: { marker: 'authority' } } };
  const profile = { state: { volumes: [] }, revision: 3 };
  const { repository, calls } = createPostgresStub({ book, bible, profile });
  let options;
  const service = createGenerationService(baseServiceDeps(repository, { onOrchestrator: value => { options = value; } }));
  service.generationRunOrchestrator();

  const input = {
    actorUserId: 'owner', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID,
    request: { creationBookId: BOOK_ID, chapterId: 'chapter_1' }
  };
  const authority = await service.loadAuthoritativeGenerationContext(input);
  assert.equal(authority.ok, true);
  assert.equal(authority.storyContext.bibleVersion, 1);
  assert.equal(authority.storyContext.baseRevision, 3);
  assert.equal(authority.storyContext.planHash, crypto.createHash('sha256').update(JSON.stringify({ marker: 'authority' })).digest('hex'));
  assert.equal((await service.loadAuthoritativeGenerationContext({ ...input, actorUserId: 'outsider' })).ok, false);

  bible.version = 2;
  bible.payload = { creationPlan: { marker: 'updated' } };
  const updated = await service.loadAuthoritativeGenerationContext(input);
  assert.equal(updated.storyContext.bibleVersion, 2);
  assert.notEqual(updated.snapshotHash, authority.snapshotHash);
  assert.ok(calls.getCreationState >= 2);

  const dependencies = options.dependenciesForRun(
    { auth: { user: { userId: 'owner', email: 'owner@test.local' } }, user: { userId: 'owner' }, actorUserId: 'owner', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID },
    {}
  );
  const receipt = await dependencies.commit({
    run: {
      id: 'run', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID, leaseOwner: 'worker', fencingToken: 2,
      result: {
        outputHash: crypto.createHash('sha256').update('draft').digest('hex'),
        audit: { passed: true, issues: [] },
        semanticAudit: { passed: true, audit: { passed: true, issues: [], factLedgerDelta: { newPromises: [], newRules: [], updates: [], byEntity: {} } } }
      }
    },
    request: { creationBookId: BOOK_ID, storyContext: { baseRevision: 1, stateVersion: 0 } },
    payload: { expectedRevision: 1, baseStateVersion: 0 },
    text: 'draft'
  });
  assert.equal(receipt.committed, true);
  assert.equal(calls.commitChapter.length, 1);
  const committed = calls.commitChapter[0];
  assert.equal(committed.userId, 'owner');
  assert.equal(committed.projectId, PROJECT_ID);
  assert.equal(committed.workspaceId, WORKSPACE_ID);
  assert.equal(committed.bookId, BOOK_ID);
  assert.equal(committed.chapterNo, 1);
  assert.equal(committed.runLeaseOwner, 'worker');
  assert.equal(committed.fencingToken, 2);
  assert.equal(committed.content, 'draft');
  assert.equal(committed.baseStateVersion, 0);
  assert.equal(committed.expectedProjectRevision, 1);
});

test('PG V2 提交路由经真实编排器落稿且回执幂等，绝不触碰 legacy 存储', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-pg-route-commit-'));
  const app = new JsonAppRepository(directory);
  testContext.after(async () => {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const user = await app.saveAccount({ userId: 'route-owner', email: 'route-owner@test.local' });
  const manifest = require('../lib/generation/manifest');
  const store = require('../lib/generation/json-store').createJsonGenerationStore(null, { repository: app.repository });

  const novelState = { volumes: [{ chapters: [{ id: 'chapter_1', scenes: [{ id: 'scene_1', content: 'old' }] }] }] };
  const book = creationBook();
  const bible = { bibleId: 'bible_generation', version: 1, payload: { creationPlan: {} } };
  const { repository, calls } = createPostgresStub({
    userId: user.userId,
    book, bible, profile: { state: novelState, revision: 1 },
    commitResult: input => {
      novelState.volumes[0].chapters[0].scenes[0].content = input.content;
      return { ok: true, committed: true, receiptId: 'rcpt_route' };
    }
  });

  const request = {
    creationBookId: BOOK_ID, novelId: PROJECT_ID, chapterId: 'chapter_1', sceneId: 'scene_1',
    storyContext: { stateVersion: 0, baseRevision: 1, baseHash: manifest.hashValue('old'), bibleVersion: 1, planHash: manifest.hashValue('{}') }
  };
  await store.createRun({
    id: 'route-run', actorUserId: user.userId, projectId: PROJECT_ID, workspaceId: WORKSPACE_ID,
    chapterId: 'chapter_1', idempotencyKey: 'route-key', requestHash: manifest.hashValue(request), request
  });
  const row = await app.repository.generation.get(PROJECT_ID, 'route-run');
  const text = 'new';
  await app.repository.generation.put(PROJECT_ID, {
    ...row, state: 'waiting_author', costStatus: 'settled', actualCostMinor: 0,
    stages: [{ stage: 'provider:writer', costStatus: 'settled', status: 'completed', actualCostMinor: 0 }],
    result: {
      draft: text, outputHash: manifest.hashValue(text), contract: { chapterNo: 1 }, audit: { passed: true, issues: [] },
      benchmark: { status: 'passed' }, semanticAudit: { passed: true, audit: { passed: true, issues: [], factLedgerDelta: { newPromises: [], newRules: [], updates: [], byEntity: {} } } },
      quality: { passed: true, status: 'MEASURED', qualityVector: { language: { value: 0.9, confidence: 0.9, status: 'MEASURED', source: 'literary_evaluator', evidence: [{ quote: text, start: 0, end: text.length }] } } }
    }
  }, row.revision);

  let response;
  const body = { text, outputHash: manifest.hashValue(text), expectedRevision: 1, baseStateVersion: 0 };
  const service = createGenerationService({
    crypto,
    GenerationError: require('../lib/generation/errors').GenerationError,
    projectScope: require('../lib/project-scope'),
    generationManifest: manifest,
    postgresRepository: repository,
    generationRunStore: () => store,
    createGenerationOrchestrator: require('../lib/generation/orchestrator').createGenerationOrchestrator,
    generationV2Enabled: () => true,
    generationV2Status: () => ({ enabled: true, generationV2: true }),
    getAuthUser: () => ({ user }),
    postgresActor: auth => auth.user.userId,
    decodePathParam: decodeURIComponent,
    readBody: async () => body,
    json: (responseTarget, status, data) => { response = { status, data }; }
  });
  const req = { method: 'POST', headers: {}, url: '/api/generation-runs/route-run/commit' };
  await service.handleGenerationRuns(req, {}, req.url);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.equal(response.data.run.state, 'committed');
  assert.equal(response.data.idempotent, false);
  assert.equal(novelState.volumes[0].chapters[0].scenes[0].content, text);
  assert.equal(calls.commitChapter.length, 1);
  const committed = calls.commitChapter[0];
  assert.equal(committed.bookId, BOOK_ID);
  assert.equal(committed.content, text);
  assert.ok(committed.fencingToken > 0, '提交必须携带 fencing token');
  assert.ok(committed.runLeaseOwner, '提交必须携带租约Owner');

  await service.handleGenerationRuns(req, {}, req.url);
  assert.equal(response.status, 200);
  assert.equal(response.data.idempotent, true);
  assert.equal(calls.commitChapter.length, 1, '幂等重放不得二次落稿');
});

test('service-level resolveStyle: 只有持久小说文风设定时继承作品设定且客户端伪权威不覆盖', async () => {
  const book = creationBook();
  const bible = { bibleId: 'bible_generation', version: 1, payload: { creationPlan: { marker: 'style-novel-plan' } } };
  const profile = { state: { narrativeStyle: '清冷留白、古典肃穆的史诗叙事风', volumes: [] }, revision: 1 };
  const { repository } = createPostgresStub({ book, bible, profile });
  let options;
  const service = createGenerationService(baseServiceDeps(repository, { onOrchestrator: value => { options = value; } }));
  service.generationRunOrchestrator();

  const runRequest = { creationBookId: BOOK_ID, chapterId: 'chapter_1' };
  const dependencies = options.dependenciesForRun({
    auth: { user: { userId: 'owner' } }, user: { userId: 'owner' },
    actorUserId: 'owner', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID
  }, runRequest);

  const inheritedResult = await dependencies.resolveStyle(runRequest, 'universal');
  assert.equal(inheritedResult.status, 'resolved');
  assert.equal(inheritedResult.source, 'narrative_authoritative');
  assert.match(inheritedResult.style, /清冷留白、古典肃穆/);

  const spoofedClientRequest = { ...runRequest, storyContext: { narrativeStyle: '客户端伪造的轻佻搞笑文风' } };
  const antiSpoofResult = await dependencies.resolveStyle(spoofedClientRequest, 'universal');
  assert.equal(antiSpoofResult.source, 'narrative_authoritative');
  assert.match(antiSpoofResult.style, /清冷留白、古典肃穆/);
  assert.doesNotMatch(antiSpoofResult.style, /客户端伪造/);
});

test('service-level resolveStyle: 只有 Bible 存储文风时继承作品设定且客户端伪权威不覆盖', async () => {
  const book = creationBook();
  const bible = { bibleId: 'bible_generation', version: 1, payload: { narrativeStyle: '典雅含蓄、暗藏机锋的深宫权谋风', creationPlan: { marker: 'style-bible-plan' } } };
  const profile = { state: { volumes: [] }, revision: 1 };
  const { repository } = createPostgresStub({ book, bible, profile });
  let options;
  const service = createGenerationService(baseServiceDeps(repository, { onOrchestrator: value => { options = value; } }));
  service.generationRunOrchestrator();

  const runRequest = { creationBookId: BOOK_ID, chapterId: 'chapter_1' };
  const dependencies = options.dependenciesForRun({
    auth: { user: { userId: 'owner' } }, user: { userId: 'owner' },
    actorUserId: 'owner', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID
  }, runRequest);

  const inheritedResult = await dependencies.resolveStyle(runRequest, 'universal');
  assert.equal(inheritedResult.status, 'resolved');
  assert.equal(inheritedResult.source, 'narrative_authoritative');
  assert.match(inheritedResult.style, /典雅含蓄、暗藏机锋/);

  const spoofedClientRequest = { ...runRequest, storyContext: { narrativeStyle: '客户端伪造的都市快餐风' } };
  const antiSpoofResult = await dependencies.resolveStyle(spoofedClientRequest, 'universal');
  assert.equal(antiSpoofResult.source, 'narrative_authoritative');
  assert.match(antiSpoofResult.style, /典雅含蓄、暗藏机锋/);
  assert.doesNotMatch(antiSpoofResult.style, /客户端伪造/);
});

test('service-level resolveStyle: 无任何文风时从持久正文样本推断且 writer 真实调用并正确接收解析结果', async () => {
  const sampleProse = '韩立捡到了神秘小绿瓶，黄枫谷七玄门墨大夫，小心翼翼隐忍算计，散修灵根灵石紧缺，如履薄冰。';
  const book = creationBook();
  const bible = { bibleId: 'bible_generation', version: 1, payload: { creationPlan: { marker: 'sample-plan' } } };
  const profile = {
    state: { volumes: [{ chapters: [{ id: 'chapter_sample_1', title: '序章', scenes: [{ id: 'scene_sample_1', content: sampleProse }] }] }] },
    revision: 1
  };
  const { repository } = createPostgresStub({ book, bible, profile });

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
  let options;
  const service = createGenerationService(baseServiceDeps(repository, {
    onOrchestrator: value => { options = value; },
    contentEngine: fakeContentEngine
  }));
  service.generationRunOrchestrator();

  const runRequest = {
    creationBookId: BOOK_ID,
    chapterId: 'chapter_sample_2',
    storyContext: { narrativeStyle: '客户端伪造的轻佻搞笑文风' }
  };
  const dependencies = options.dependenciesForRun({
    auth: { user: { userId: 'owner' } }, user: { userId: 'owner' },
    actorUserId: 'owner', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID
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

  const explicitStyleInput = { style: '显式指定硬核科幻风' };
  await dependencies.writer({
    request: runRequest,
    style: explicitStyleInput,
    contract: { chapterId: 'chapter_sample_2' }
  });
  assert.equal(capturedDraftInput.style, '显式指定硬核科幻风', '显式传入文风优先且正确传递至 writer 依赖');
});

test('PG capabilities 端点恒报 postgres 存储，commit 能力来自 PG 仓储', async () => {
  const { repository } = createPostgresStub({ book: creationBook(), bible: null, profile: { state: {}, revision: 1 } });
  let response;
  const service = createGenerationService(baseServiceDeps(repository, {
    generationV2Enabled: () => true,
    generationV2Status: () => ({ enabled: true }),
    getAuthUser: () => ({ user: { userId: 'owner' } }),
    decodePathParam: decodeURIComponent,
    json: (responseTarget, status, data) => { response = { status, data }; }
  }));
  const req = { method: 'GET', headers: {}, url: '/api/generation-runs/capabilities' };
  await service.handleGenerationRuns(req, {}, req.url);
  assert.equal(response.status, 200);
  assert.equal(response.data.storageMode, 'postgres');
  assert.equal(response.data.commit, true);
  assert.equal(response.data.enabled, true);

  const commitless = { enabled: true };
  let commitlessResponse;
  const commitlessService = createGenerationService(baseServiceDeps(commitless, {
    generationV2Enabled: () => true,
    generationV2Status: () => ({ enabled: true }),
    getAuthUser: () => ({ user: { userId: 'owner' } }),
    decodePathParam: decodeURIComponent,
    json: (responseTarget, status, data) => { commitlessResponse = { status, data }; }
  }));
  await commitlessService.handleGenerationRuns(req, {}, req.url);
  assert.equal(commitlessResponse.data.commit, false, '缺少 commitChapter 的仓储不得宣称可提交');
});

test('PG 场景补丁路由走 patchProfileScene，错误映射保持 409 语义', async () => {
  const book = creationBook();
  const { repository, calls } = createPostgresStub({ book, bible: null, profile: { state: {}, revision: 1 } });
  let response;
  const service = createGenerationService(baseServiceDeps(repository, {
    MAX_NOVEL_STATE_BYTES: 1024 * 1024,
    generationScenePatch: require('../lib/generation/scene-patch'),
    getAuthUser: () => ({ user: { userId: 'owner' } }),
    postgresActor: auth => auth.user.userId,
    decodePathParam: decodeURIComponent,
    readBody: async () => ({ chapterId: 'chapter_1', revision: 4, baseHash: 'a'.repeat(64), operations: [{ op: 'replace', find: 'old', replace: 'new' }] }),
    json: (responseTarget, status, data) => { response = { status, data }; }
  }));
  await service.handleNovelScenePatch({ method: 'PATCH', headers: {} }, {}, PROJECT_ID, 'scene_1');
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.equal(response.data.ok, true);
  assert.equal(response.data.revision, 5);
  assert.equal(calls.patchProfileScene.length, 1);
  const patch = calls.patchProfileScene[0];
  assert.equal(patch.userId, 'owner');
  assert.equal(patch.projectId, PROJECT_ID);
  assert.equal(patch.chapterId, 'chapter_1');
  assert.equal(patch.sceneId, 'scene_1');
  assert.equal(patch.expectedRevision, 4);
  assert.equal(patch.baseHash, 'a'.repeat(64));
  assert.equal(patch.maxStateBytes, 1024 * 1024);

  const conflict = Object.assign(new Error('小说 revision 已变化，请重新读取'), { code: 'revision_conflict', status: 409 });
  repository.patchProfileScene = async () => { throw conflict; };
  await service.handleNovelScenePatch({ method: 'PATCH', headers: {} }, {}, PROJECT_ID, 'scene_1');
  assert.equal(response.status, 409);
  assert.equal(response.data.code, 'revision_conflict');
});
