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
