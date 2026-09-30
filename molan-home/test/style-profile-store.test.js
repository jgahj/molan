'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createJsonStyleProfileStore } = require('../lib/style-profile-store');

test('borrowed generation and style adapters leave the shared repository open', async t => {
  const { JsonFileRepository } = require('../lib/repositories/json-file-repository');
  const { createJsonGenerationStore } = require('../lib/generation/json-store');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-shared-domains-'));
  const repository = new JsonFileRepository(directory);
  t.after(async () => { await repository.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const styles = createJsonStyleProfileStore(directory, { repository });
  const generations = createJsonGenerationStore(directory, { repository });
  await styles.close();
  await generations.close();
  await repository.accounts.put(null, { id: 'still-open', credits: 1 }, 0);
  assert.equal((await repository.accounts.get(null, 'still-open')).credits, 1);
});

test('JSON 文风档案 CAS、版本快照和项目/分支隔离可在纯 Node 环境运行', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-style-store-'));
  let store = createJsonStyleProfileStore(directory);
  try {
    const created = await store.upsertStyleProfile({
      projectId: 'project-one', bookId: 'book-one', id: 'style-one', expectedRevision: 0,
      level: 'scene_mode', targetSceneType: 'battle', hardRules: ['动作具体'],
      softPreferences: { pace: 'rapid' }
    });
    assert.equal(created.revision, 1);
    await assert.rejects(store.upsertStyleProfile({
      projectId: 'project-one', bookId: 'book-one', id: 'style-one', expectedRevision: 1,
      hardRules: { invalid: true }
    }), { code: 'STYLE_PROFILE_INVALID', status: 422 });
    assert.equal((await store.getStyleProfiles({ projectId: 'project-one', bookId: 'book-one' }))[0].revision, 1);

    const updated = await store.upsertStyleProfile({
      projectId: 'project-one', bookId: 'book-one', id: 'style-one', expectedRevision: 1,
      name: '战斗修订', hardRules: ['动作具体', '交锋改变局势']
    });
    assert.equal(updated.revision, 2);

    await assert.rejects(store.upsertStyleProfile({
      projectId: 'project-one', bookId: 'book-one', id: 'style-one', expectedRevision: '1'
    }), { code: 'STYLE_VERSION_CONFLICT' });
    assert.equal((await store.getStyleProfiles({ projectId: 'project-one', bookId: 'book-one' }))[0].level, 'scene_mode');
    assert.deepEqual(await store.getStyleProfiles({ projectId: 'project-one', bookId: 'book-one', branchId: 'alternate' }), []);

    await store.upsertStyleProfile({
      projectId: 'project-one', bookId: 'book-one', branchId: 'alternate', id: 'style-alt', expectedRevision: 0,
      hardRules: ['仅备用分支']
    });
    await store.upsertStyleProfile({
      projectId: 'project-two', bookId: 'book-one', id: 'style-one', expectedRevision: 0,
      hardRules: ['其他项目']
    });
    assert.deepEqual((await store.getStyleProfiles({ projectId: 'project-two', bookId: 'book-one' }))[0].hardRules, ['其他项目']);
    assert.deepEqual((await store.getStyleProfileVersions({
      projectId: 'project-one', bookId: 'book-one', profileId: 'style-one'
    })).map(version => version.revision), [1, 2]);

    await store.close();
    store = createJsonStyleProfileStore(directory);
    const reopened = await store.getStyleProfiles({ projectId: 'project-one', bookId: 'book-one' });
    assert.equal(reopened[0].revision, 2);
    assert.deepEqual(reopened[0].softPreferences, { pace: 'rapid' });
  } finally {
    await store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
