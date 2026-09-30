import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createPostgresRepository } = require('../lib/postgres-repository');
const { createMemoryStore } = require('../lib/memory-store');
const repository = createPostgresRepository(process.env);
if (!repository.enabled) throw new Error('PostgreSQL must be explicitly configured');
const suffix = crypto.randomUUID();
const userId = `memory-owner-${suffix}`, workspaceId = `memory-workspace-${suffix}`, projectId = `memory-project-${suffix}`, bookId = `memory-book-${suffix}`;
const scope = { userId, bookId };
const store = createMemoryStore({ backend: 'postgres', repository });
try {
  await repository.saveProfile({ userId, workspaceId, projectId, title: 'Memory smoke', state: { title: 'Memory smoke', volumes: [{ chapters: [{ id: 'c1', content: 'original' }] }] } });
  await repository.createCreationBook({ userId, workspaceId, projectId, bookId, title: 'Memory smoke', plan: { totalChapters: 1 }, payload: { chapterPlan: [] } });
  await assert.rejects(store.getMemory({ ...scope, userId: `intruder-${suffix}` }));
  const profile = await repository.getProfile(userId, projectId, workspaceId);
  const m = await store.saveManuscript({ ...scope, text: '阿青回到家中。', chapterId: 'c1', expectedRevision: 0, expectedNovelRevision: profile.revision });
  const extracted = await store.extract({ ...scope, manuscriptRevisionId: m.id });
  assert.equal(extracted.propositions.length, 1);
  const review = await store.rewrite({ ...scope, contract: { lockedPropositions: ['阿青'] }, manuscriptRevisionId: m.id });
  const cs = await store.createChangeset({ ...scope, manuscriptRevisionId: m.id, rewriteReviewId: review.review.id, operations: [{ type: 'INSERT_FACT', payload: { id: 'f1', propositionId: extracted.propositions[0].id, supportingEvidenceIds: [extracted.evidence[0].id] } }] });
  await assert.rejects(store.commitChangeset({ ...scope, changesetId: cs.id }), { code: 'changeset_not_approved' });
  await store.approveChangeset({ ...scope, changesetId: cs.id });
  await assert.rejects(store.commitChangeset({ ...scope, changesetId: cs.id, expectedStateVersion: 0 }), { code: 'MEMORY_VERSION_CONFLICT' });
  const receipt = await store.commitChangeset({ ...scope, changesetId: cs.id, expectedStateVersion: 1, idempotencyKey: 'one' });
  assert.equal(receipt.novelRevision, profile.revision + 1);
  assert.equal((await store.commitChangeset({ ...scope, changesetId: cs.id, expectedStateVersion: 1, idempotencyKey: 'one' })).replayed, true);
  assert.equal((await repository.getProfile(userId, projectId, workspaceId)).state.volumes[0].chapters[0].content, '<p>阿青回到家中。</p>');
  const bad = await store.createChangeset({ ...scope, operations: [{ type: 'INSERT_FACT', payload: { id: 'bad', propositionId: 'missing' } }] });
  await store.approveChangeset({ ...scope, changesetId: bad.id });
  await assert.rejects(store.commitChangeset({ ...scope, changesetId: bad.id }), { code: 'MEMORY_REFERENCE_INVALID' });
  assert.equal((await store.listOperations(scope)).length, 1);
  assert.equal((await store.getMemory(scope)).length, 1);
  assert.equal((await store.processProjections(scope)).synced, true);
  const latest = await repository.getProfile(userId, projectId, workspaceId);
  const candidate = await store.saveManuscript({ ...scope, text: '阿青打开窗户。', chapterId: 'c1', expectedRevision: 1, expectedNovelRevision: latest.revision });
  const secondReview = await store.rewrite({ ...scope, contract: {}, manuscriptRevisionId: candidate.id });
  const pending = await store.createChangeset({ ...scope, manuscriptRevisionId: candidate.id, rewriteReviewId: secondReview.review.id });
  await store.approveChangeset({ ...scope, changesetId: pending.id });
  // Cause a real database error after native memory rows were written, before chapter CAS.
  const failingStore = createMemoryStore({ backend: 'postgres', repository: {
    withCreationBookTransaction: (input, action) => repository.withCreationBookTransaction(input, (client, state) => action({ query: (sql, values) => String(sql).startsWith('UPDATE luna.project_profiles') ? client.query('SELECT 1/0') : client.query(sql, values) }, state))
  } });
  await assert.rejects(failingStore.commitChangeset({ ...scope, changesetId: pending.id }));
  assert.equal((await store.getChangeset({ ...scope, changesetId: pending.id })).committedAt, null);
  assert.equal((await repository.getProfile(userId, projectId, workspaceId)).revision, latest.revision);
  assert.equal((await store.getMemory(scope)).length, 1);
  assert.equal((await store.listOperations(scope)).length, 1);
  process.stdout.write(JSON.stringify({ ok: true, checks: ['memory-rls-isolation', 'author-approval', 'memory-cas', 'atomic-chapter-cas', 'commit-replay', 'invalid-commit-rollback', 'native-projection', 'database-error-full-rollback'] }) + '\n');
} finally { await repository.close(); }
