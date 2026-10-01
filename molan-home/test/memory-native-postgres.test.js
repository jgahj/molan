'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createPostgresRepository } = require('../lib/postgres-repository');
const { createMemoryStore } = require('../lib/memory-store');
const { createPostgresStyleProfileStore } = require('../lib/style-profile-store');
test('native Postgres generation executes guarded calls and persists run history', { skip: process.env.MOLAN_PG_ENABLED !== '1' }, async t => {
  const repository = createPostgresRepository(process.env);
  t.after(() => repository.close());
  const suffix = crypto.randomUUID();
  const userId = `native-generation-user-${suffix}`, projectId = `native-generation-project-${suffix}`, bookId = `native-generation-book-${suffix}`;
  const workspaceId = `native-generation-workspace-${suffix}`;
  await repository.saveProfile({ userId, projectId, workspaceId, title: 'Native generation test', state: { volumes: [] } });
  await repository.createCreationBook({ userId, projectId, workspaceId, bookId, title: 'Native generation test' });
  const store = createMemoryStore({ backend: 'postgres', repository });
  const input = { userId, bookId, requestId: 'native-request-one', prompt: 'write', maxCalls: 1 };
  let calls = 0;
  const execute = async (params, guard) => { await guard(async () => { calls++; return { usage: { creditCost: 0, billingStatus: 'exact' } }; }); return { status: 'passed', text: 'candidate' }; };
  const run = await store.generate(input, execute);
  assert.equal(run.status, 'succeeded');
  assert.equal((await store.getGeneration({ ...input, runId: run.id })).costStatus, 'settled');
  assert.equal((await store.generate(input, execute)).replayed, true); assert.equal(calls, 1);
  const history = await store.getRun({ userId, runId: run.id, events: true });
  assert.equal(history.events.some(e => e.type === 'MODEL_CALL_COMPLETED'), true);
  assert.equal((await store.getRun({ userId, runId: run.id })).result.text, 'candidate');
  const missingCostInput = { ...input, requestId: 'native-request-unknown-cost' };
  const missingCost = await store.generate(missingCostInput, async (_params, guard) => {
    await guard(async () => ({ text: 'retained response', usage: { totalTokens: 1 } }));
  });
  assert.equal(missingCost.status, 'provider_unknown');
  const unknownRead = await store.getGeneration({ ...input, runId: missingCost.id });
  assert.equal(unknownRead.costStatus, 'unknown');
  assert.equal(unknownRead.settledCreditCost, null);
  assert.equal(unknownRead.providerResponses[0].text, 'retained response');
  const manifest = await store.getContextManifest({ userId, bookId, manifestId: run.manifestId });
  assert.match(manifest.compiledContext, /write/);
  assert.equal(manifest.contextPlan.fits, true);
  assert.equal(manifest.contextPlan.replayManifest.strategyVersion, require('../lib/generation/context').CONTEXT_STRATEGY_VERSION);
});

test('PostgreSQL 六维基线从真实 authority 读取并在提交时校验', {
  skip: process.env.MOLAN_MEMORY_BASELINE_PG_LIVE_TEST !== '1'
}, async t => {
  assert.equal(process.env.MOLAN_PG_ENABLED, '1');
  assert.match(String(process.env.MOLAN_PG_DATABASE || ''), /(?:acceptance|test)/i);
  const repository = createPostgresRepository(process.env);
  const store = createMemoryStore({ backend: 'postgres', repository });
  const styles = createPostgresStyleProfileStore(repository);
  t.after(async () => { await styles.close(); await store.close(); await repository.close(); });

  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 14);
  const userId = `memory-baseline-user-${suffix}`;
  const workspaceId = `memory-baseline-workspace-${suffix}`;
  const projectId = `memory-baseline-project-${suffix}`;
  const bookId = `memory-baseline-book-${suffix}`;
  await repository.saveProfile({
    userId, workspaceId, projectId, title: 'memory baseline acceptance',
    state: { title: 'memory baseline acceptance', volumes: [{
      id: 'volume', chapters: [{ id: 'chapter', scenes: [{ id: 'scene', content: '旧稿' }] }]
    }] }
  });
  const created = await repository.createCreationBook({
    userId, workspaceId, projectId, bookId, title: 'memory baseline acceptance',
    plan: { totalChapters: 1 }, payload: {}
  });
  assert.equal(created.ok, true);
  const style = await styles.upsertStyleProfile({
    userId, bookId, id: `style-${suffix}`, expectedRevision: 0, hardRules: ['验收文风基线']
  });
  assert.equal(style.revision, 1);

  const extracted = await store.extract({ userId, bookId, text: '掌门将玉佩交给少年。' });
  const disclosure = await store.createChangeset({
    userId, bookId, operations: [{
      type: 'SET_DISCLOSURE',
      payload: { id: `disclosure-${suffix}`, targetInfoId: extracted.propositions[0].id, policyType: 'hide' }
    }]
  });
  await store.approveChangeset({ userId, bookId, changesetId: disclosure.id });
  await store.commitChangeset({ userId, bookId, changesetId: disclosure.id });

  const [profile, books, bibleRecord, styleProfiles, disclosures, access] = await Promise.all([
    repository.getProfile(userId, projectId, workspaceId),
    repository.listCreationBooks(userId),
    repository.getCreationBible(userId, bookId),
    styles.getStyleProfiles({ userId, bookId, branchId: 'main' }),
    store.getRecords({ userId, bookId, branchId: 'main', type: 'disclosure' }),
    repository.getProjectAccess(userId, projectId, workspaceId)
  ]);
  const book = books.find(row => row.id === bookId);
  assert.ok(profile && Number.isSafeInteger(Number(profile.revision)));
  assert.ok(book && Object.hasOwn(book, 'currentStateVersion'));
  assert.ok(bibleRecord?.bible && Number.isSafeInteger(Number(bibleRecord.bible.version)));
  assert.equal(styleProfiles.length, 1);
  assert.equal(disclosures.length, 1);
  assert.ok(access && Number.isSafeInteger(Number(access.acl_revision)));
  const baseline = {
    expectedNovelRevision: Number(profile.revision),
    expectedBibleVersion: Number(bibleRecord.bible.version),
    expectedPlanVersion: Number(book.currentStateVersion),
    expectedStyleVersion: Number(styleProfiles[0].revision),
    expectedDisclosurePolicyVersion: disclosures.length,
    expectedAclRevision: Number(access.acl_revision)
  };
  assert.ok(Object.values(baseline).every(Number.isSafeInteger));

  const state = await store.workbenchState({ userId, bookId });
  const candidate = await store.createChangeset({
    userId, bookId, baseStateVersion: state.stateVersion, operations: []
  });
  await store.approveChangeset({ userId, bookId, changesetId: candidate.id });
  for (const key of Object.keys(baseline)) {
    await assert.rejects(
      store.commitChangeset({ userId, bookId, changesetId: candidate.id, [key]: baseline[key] + 1 }),
      { code: 'BASELINE_STALE' }
    );
  }
  const committed = await store.commitChangeset({ userId, bookId, changesetId: candidate.id, ...baseline });
  assert.equal(committed.ok, true);

  const currentProfile = await repository.getProfile(userId, projectId, workspaceId);
  const manuscript = await store.saveManuscript({
    userId, bookId, chapterId: 'chapter', sceneId: 'scene', text: '配置漂移应自动使审批失效。',
    expectedRevision: 0, expectedNovelRevision: Number(currentProfile.revision)
  });
  const review = await store.rewrite({ userId, bookId, manuscriptRevisionId: manuscript.id, contract: { bookId } });
  const nextState = await store.workbenchState({ userId, bookId });
  const sourceCandidate = await store.createChangeset({
    userId, bookId, baseStateVersion: nextState.stateVersion, manuscriptRevisionId: manuscript.id,
    rewriteReviewId: review.review.id, operations: []
  });
  await store.approveChangeset({ userId, bookId, changesetId: sourceCandidate.id });
  await styles.upsertStyleProfile({
    userId, bookId, id: `style-${suffix}`, expectedRevision: style.revision, hardRules: ['修订后的验收文风基线']
  });
  await assert.rejects(
    store.commitChangeset({ userId, bookId, changesetId: sourceCandidate.id }),
    { code: 'CONFIG_VERSION_CONFLICT' }
  );
});
