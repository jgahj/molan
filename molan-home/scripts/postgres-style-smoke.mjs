import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createPostgresRepository } = require('../lib/postgres-repository');
const { createPostgresStyleProfileStore } = require('../lib/style-profile-store');
const repository = createPostgresRepository(process.env);
if (!repository.enabled) throw new Error('PostgreSQL must be explicitly configured');
const suffix = crypto.randomUUID();
const userId = `style-owner-${suffix}`;
const workspaceId = `style-workspace-${suffix}`;
const projectId = `style-project-${suffix}`;
const bookId = `style-book-${suffix}`;
const store = createPostgresStyleProfileStore(repository);
try {
  await repository.saveProfile({ userId, workspaceId, projectId, title: 'Style smoke', state: { volumes: [] } });
  await repository.createCreationBook({ userId, workspaceId, projectId, bookId, title: 'Style smoke', plan: { totalChapters: 1 }, payload: {} });
  const input = { userId, bookId, id: `style-${suffix}`, expectedRevision: 0, hardRules: ['Concrete action'], softPreferences: { pace: 'rapid' } };
  assert.equal((await store.upsertStyleProfile(input)).revision, 1);
  assert.equal((await store.upsertStyleProfile({ ...input, expectedRevision: 1, hardRules: ['Concrete action', 'Explicit consequence'] })).revision, 2);
  await assert.rejects(store.upsertStyleProfile({ ...input, expectedRevision: 1 }), { code: 'STYLE_VERSION_CONFLICT' });
  await assert.rejects(store.upsertStyleProfile({ ...input, expectedRevision: 2, hardRules: {} }), { code: 'STYLE_PROFILE_INVALID' });
  const profiles = await store.getStyleProfiles({ userId, bookId });
  assert.equal(profiles[0].revision, 2);
  assert.deepEqual(profiles[0].hardRules, ['Concrete action', 'Explicit consequence']);
  const versions = await store.getStyleProfileVersions({ userId, bookId, profileId: input.id });
  assert.deepEqual(versions.map(row => row.revision), [1, 2]);
  await assert.rejects(store.getStyleProfiles({ userId: `stranger-${suffix}`, bookId }));
  await assert.rejects(store.upsertStyleProfile({ ...input, userId: `stranger-${suffix}`, expectedRevision: 2 }));
  assert.equal((await store.getStyleProfiles({ userId, bookId }))[0].revision, 2);
  process.stdout.write('PostgreSQL native style CAS, versions, rollback and isolation PASS\n');
} finally {
  await repository.close();
}
