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

test('native generation uses shared authority, Bible version and plan hash without SQL', async t => {
  const previous = process.env.MOLAN_APP_STORE;
  process.env.MOLAN_APP_STORE = 'json';
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-native-generation-'));
  const app = new JsonAppRepository(directory);
  t.after(async () => { if (previous === undefined) delete process.env.MOLAN_APP_STORE; else process.env.MOLAN_APP_STORE = previous; await app.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const user = await app.saveAccount({ userId: 'owner', email: 'owner@test.local' });
  const novel = await app.create({ user, id: 'n_generation', state: { volumes: [] } });
  const repository = new JsonCreationRepository(app);
  const scope = { userId: user.userId, projectId: novel.id, workspaceId: novel.workspaceId, bookId: 'cb_generation' };
  await repository.create({ ...scope, payload: { creationPlan: { marker: 'authority' } } });
  let options;
  const service = createGenerationService({ POSTGRES_MODE: false, crypto,
    projectScope: require('../lib/project-scope'), generationManifest: require('../lib/generation/manifest'),
    getNativeCreationRepository: () => repository, getNativeAppRepository: () => app,
    getDatabase: () => { throw new Error('SQL must not be used'); }, generationRunStore: () => ({}),
    createGenerationOrchestrator: value => { options = value; return {}; },
    creationChapterContext: () => ({ characters: [], characterLibrary: [], rules: [] }) });
  const input = { actorUserId: user.userId, projectId: novel.id, workspaceId: novel.workspaceId,
    request: { creationBookId: scope.bookId, chapterId: 'chapter_1' } };
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
  await dependencies.commit({ run: { id: 'run', projectId: novel.id, workspaceId: novel.workspaceId, leaseOwner: 'worker', fencingToken: 2 },
    request: { creationBookId: scope.bookId }, payload: { userId: 'outsider' }, text: 'draft' });
  assert.equal(committed.userId, user.userId);
  assert.equal(committed.projectId, novel.id);
  assert.equal(committed.leaseOwner, 'worker');
  assert.equal(committed.fencingToken, 2);
});

test('native V2 commit route persists manuscript and receipt once through the real orchestrator', async t => {
  const previous = process.env.MOLAN_APP_STORE;
  process.env.MOLAN_APP_STORE = 'json';
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-native-route-commit-'));
  const app = new JsonAppRepository(directory);
  t.after(async () => { if (previous === undefined) delete process.env.MOLAN_APP_STORE; else process.env.MOLAN_APP_STORE = previous; await app.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const user = await app.saveAccount({ userId: 'route-owner', email: 'route-owner@test.local' });
  const novel = await app.create({ user, id: 'n_routecommit', state: { volumes: [{ chapters: [{ id: 'chapter_1', scenes: [{ id: 'scene_1', content: 'old' }] }] }] } });
  const repository = new JsonCreationRepository(app);
  const scope = { userId: user.userId, projectId: novel.id, workspaceId: novel.workspaceId, bookId: 'cb_route_commit' };
  await repository.create({ ...scope, payload: {} });
  const manifest = require('../lib/generation/manifest');
  const store = require('../lib/generation/json-store').createJsonGenerationStore(null, { repository: app.repository });
  const request = { creationBookId: scope.bookId, novelId: novel.id, chapterId: 'chapter_1', sceneId: 'scene_1',
    storyContext: { stateVersion: 0, baseRevision: 0, baseHash: manifest.hashValue('old'), bibleVersion: 1, planHash: manifest.hashValue('{}') } };
  await store.createRun({ id: 'route-run', actorUserId: user.userId, projectId: novel.id, workspaceId: novel.workspaceId,
    chapterId: 'chapter_1', idempotencyKey: 'route-key', requestHash: manifest.hashValue(request), request });
  const row = await app.repository.generation.get(novel.id, 'route-run');
  const text = 'new';
  await app.repository.generation.put(novel.id, { ...row, state: 'waiting_author', costStatus: 'settled', actualCostMinor: 0,
    stages: [{ stage: 'provider:writer', costStatus: 'settled', status: 'completed', actualCostMinor: 0 }],
    result: { draft: text, outputHash: manifest.hashValue(text), contract: { chapterNo: 1 }, audit: { passed: true, issues: [] },
      benchmark: { status: 'passed' }, semanticAudit: { passed: true, audit: { passed: true, issues: [], factLedgerDelta: { newPromises: [], newRules: [], updates: [], byEntity: {} } } },
      quality: { passed: true, qualityVector: { language: { value: 0.9, confidence: 0.9 } } } } }, row.revision);
  let response;
  const body = { text, outputHash: manifest.hashValue(text), userId: 'outsider' };
  const service = createGenerationService({ POSTGRES_MODE: false, crypto,
    GenerationError: require('../lib/generation/errors').GenerationError, projectScope: require('../lib/project-scope'), generationManifest: manifest,
    getNativeCreationRepository: () => repository, getNativeAppRepository: () => app, getDatabase: () => { throw new Error('SQL must not be used'); },
    generationRunStore: () => store, createGenerationOrchestrator: require('../lib/generation/orchestrator').createGenerationOrchestrator,
    generationV2Enabled: () => true, getAuthUser: () => ({ user }), postgresActor: auth => auth.user.userId,
    requireSqliteForPublic: () => true, decodePathParam: decodeURIComponent, readBody: async () => body,
    json: (_res, status, data) => { response = { status, data }; } });
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
