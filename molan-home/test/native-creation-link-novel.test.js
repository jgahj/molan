'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { JsonAppRepository } = require('../lib/repositories/json-app-repository');
const { JsonCreationRepository } = require('../lib/repositories/json-creation-repository');
const { createNativeCreationService } = require('../services/native-creation-service');

const hash = text => crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');

async function createHttpFixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-link-novel-test-'));
  const app = new JsonAppRepository(directory, options);
  const owner = await app.saveAccount({ userId: 'owner', email: 'owner@test.local', credits: 100 });
  const editor = await app.saveAccount({ userId: 'editor', email: 'editor@test.local', credits: 100 });
  const viewer = await app.saveAccount({ userId: 'viewer', email: 'viewer@test.local', credits: 100 });
  const stranger = await app.saveAccount({ userId: 'stranger', email: 'stranger@test.local', credits: 100 });

  const targetNovel = await app.create({
    user: owner,
    id: 'n_target1',
    state: {
      volumes: [{
        chapters: [{
          id: 'chapter_1',
          scenes: [{ id: 'scene_1', content: '初始正文' }]
        }]
      }]
    }
  });
  await app.upsertWorkspaceMember('owner', targetNovel.workspaceId, 'editor', 'member');
  await app.upsertWorkspaceMember('owner', targetNovel.workspaceId, 'viewer', 'member');
  await app.upsertProjectMember({ userId: 'owner', projectId: targetNovel.id, targetUserId: 'editor', role: 'editor' });
  await app.upsertProjectMember({ userId: 'owner', projectId: targetNovel.id, targetUserId: 'viewer', role: 'viewer' });

  const strangerNovel = await app.create({
    user: stranger,
    id: 'n_strangernovel',
    state: { volumes: [] }
  });

  const otherNovel = await app.create({
    user: owner,
    id: 'n_target2',
    state: { volumes: [] }
  });

  const creationRepo = new JsonCreationRepository(app);
  const service = createNativeCreationService({
    repository: creationRepo,
    getAuthUser: req => req.headers.authorization ? { user: { userId: req.headers.authorization } } : null,
    readBody: async req => {
      let text = '';
      for await (const chunk of req) text += chunk;
      return text ? JSON.parse(text) : {};
    },
    json: (res, status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    },
    normalizeCreationPlan: input => ({ ...input, budgetLimit: Number(input.budgetLimit || 0) }),
    normalizeBiblePayload: body => body,
    creationForbiddenTerms: () => [],
    creationBibleSeedValidation: payload => ({ ok: Boolean(payload.valid), hits: [], missing: payload.valid ? [] : ['valid'] }),
    creationChapterContext: (payload, chapterNo) => ({ chapterNo, title: payload.title || 'test' }),
    contractFieldsSubstantive: () => ({ ok: true }),
    deterministicContractValidation: () => ({ status: 'passed', blockerCount: 0, findings: [] }),
    generateChapterContract: async input => ({
      json: {
        goal: 'Goal for chapter',
        protagonistAction: 'Hero takes action',
        opposition: 'Enemy responds',
        irreversibleResult: 'Something changed forever'
      },
      usage: { creditCost: 1, billingStatus: 'settled', totalTokens: 100 }
    })
  });

  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (!await service.dispatch(req, res, pathname)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, code: 'NOT_FOUND', error: 'Route not handled' }));
    }
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(url, method = 'GET', body, user = 'owner') {
    const response = await fetch(base + url, {
      method,
      headers: {
        ...(user ? { authorization: user } : {}),
        'Content-Type': 'application/json'
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() };
  }

  return { app, directory, creationRepo, server, base, call, targetNovel, strangerNovel, otherNovel };
}

test('native link-novel: permission gates, 404 boundaries, and atomic rollback on failure', async t => {
  const f = await createHttpFixture(t);

  const unauth = await f.call('/api/creation-books/cb_unlinked_1/link-novel', 'POST', { novelId: f.targetNovel.id }, '');
  assert.equal(unauth.status, 401);

  const createRes = await f.call('/api/creation-books', 'POST', {
    creationBookId: 'cb_unlinked_1',
    title: '独立书权限测试',
    initialCost: 10,
    plan: { budgetLimit: 50 },
    bible: { valid: true, bookPremise: { title: '权限测试' } }
  });
  assert.equal(createRes.status, 200);
  assert.equal(createRes.body.book.id, 'cb_unlinked_1');
  assert.equal(createRes.body.book.spentCost, 10);
  assert.equal(createRes.body.book.projectId, undefined);

  const invalidId = await f.call('/api/creation-books/cb_unlinked_1/link-novel', 'POST', { novelId: 'invalid_novel!' });
  assert.equal(invalidId.status, 400);

  const strangerBook = await f.call('/api/creation-books/cb_unlinked_1/link-novel', 'POST', { novelId: f.targetNovel.id }, 'stranger');
  assert.equal(strangerBook.status, 404);

  const missingNovel = await f.call('/api/creation-books/cb_unlinked_1/link-novel', 'POST', { novelId: 'n_nonexistent' });
  assert.equal(missingNovel.status, 404);
  assert.equal(await f.app.repository.novels.get('n_nonexistent', 'n_nonexistent'), null);

  const crossUserNovel = await f.call('/api/creation-books/cb_unlinked_1/link-novel', 'POST', { novelId: f.strangerNovel.id }, 'owner');
  assert.equal(crossUserNovel.status, 404);

  await f.call('/api/creation-books', 'POST', {
    creationBookId: 'cb_viewer_book',
    title: 'Viewer独立书',
    bible: { valid: true }
  }, 'viewer');
  const viewerForbidden = await f.call('/api/creation-books/cb_viewer_book/link-novel', 'POST', { novelId: f.targetNovel.id }, 'viewer');
  assert.equal(viewerForbidden.status, 404);

  assert.equal(await f.app.repository.novels.get(f.targetNovel.id, 'creation-book:cb_unlinked_1'), null);
  assert.equal(await f.app.repository.novels.get(f.targetNovel.id, 'creation-book:cb_viewer_book'), null);
  const unlinkedList = await f.call('/api/creation-books');
  assert.deepEqual(unlinkedList.body.books.map(b => b.id).sort(), ['cb_unlinked_1']);
});

test('native link-novel: atomic cross-partition migration, ID/version/history/cost retention and ledger non-double-counting', async t => {
  const f = await createHttpFixture(t);

  const bookId = 'cb_migrate_full';
  await f.call('/api/creation-books', 'POST', {
    creationBookId: bookId,
    title: '跨分区原子迁移书',
    initialCost: 15.5,
    plan: { budgetLimit: 60, genre: '都市' },
    bible: { valid: true, versionTag: 'v1' }
  });

  const v2 = await f.call(`/api/creation-books/${bookId}/bible`, 'PUT', {
    bible: { valid: true, versionTag: 'v2' },
    bibleVersion: 1,
    changeSummary: '升级到v2'
  });
  assert.equal(v2.status, 200);
  assert.equal(v2.body.bibleVersion, 2);

  const v3 = await f.call(`/api/creation-books/${bookId}/bible`, 'PUT', {
    bible: { valid: true, versionTag: 'v3' },
    bibleVersion: 2,
    changeSummary: '升级到v3'
  });
  assert.equal(v3.status, 200);
  assert.equal(v3.body.bibleVersion, 3);

  const linkRes = await f.call(`/api/creation-books/${bookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id,
    workspaceId: f.targetNovel.workspaceId
  });
  assert.equal(linkRes.status, 200);
  assert.equal(linkRes.body.ok, true);
  assert.equal(linkRes.body.idempotent, false);
  assert.equal(linkRes.body.book.id, bookId);
  assert.equal(linkRes.body.book.projectId, f.targetNovel.id);
  assert.equal(linkRes.body.book.novelId, f.targetNovel.id);
  assert.equal(linkRes.body.book.workspaceId, f.targetNovel.workspaceId);
  assert.equal(linkRes.body.book.spentCost, 15.5);
  assert.equal(linkRes.body.book.budgetLimit, 60);
  assert.equal(linkRes.body.book.currentStateVersion, 0);

  const unlinkedQuery = await f.call('/api/creation-books');
  assert.deepEqual(unlinkedQuery.body.books, []);
  const projectQuery = await f.call(`/api/creation-books?projectId=${f.targetNovel.id}`);
  assert.equal(projectQuery.body.books.length, 1);
  assert.equal(projectQuery.body.books[0].id, bookId);
  assert.equal(projectQuery.body.books[0].spentCost, 15.5);

  const bibleRes = await f.call(`/api/creation-books/${bookId}/bible`);
  assert.equal(bibleRes.status, 200);
  assert.equal(bibleRes.body.bible.version, 3);
  assert.equal(bibleRes.body.bible.payload.versionTag, 'v3');

  const v4 = await f.call(`/api/creation-books/${bookId}/bible`, 'PUT', {
    bible: { valid: true, versionTag: 'v4' },
    bibleVersion: 3,
    changeSummary: '关联后升级v4'
  });
  assert.equal(v4.status, 200);
  assert.equal(v4.body.bibleVersion, 4);

  const targetLedger = await f.app.repository.ledger.list(f.targetNovel.id);
  const bibleVersionsInTarget = targetLedger.filter(r => r.kind === 'creation-bible-version' && r.bookId === bookId);
  assert.ok(bibleVersionsInTarget.some(r => r.version === 1));
  assert.ok(bibleVersionsInTarget.some(r => r.version === 2));
  assert.ok(bibleVersionsInTarget.some(r => r.version === 3));
  assert.ok(bibleVersionsInTarget.some(r => r.version === 4));
  const linkEvidence = targetLedger.find(r => r.kind === 'creation-link-evidence' && r.bookId === bookId);
  assert.ok(linkEvidence);
  assert.equal(linkEvidence.spentCost, 15.5);
  assert.equal(linkEvidence.bibleVersion, 3);
  assert.equal(linkEvidence.targetProjectId, f.targetNovel.id);

  const sourceScope = linkEvidence.sourceStorageScope;
  const sourceLedger = await f.app.repository.ledger.list(sourceScope);
  const bibleVersionsInSource = sourceLedger.filter(r => r.kind === 'creation-bible-version' && r.bookId === bookId);
  assert.equal(bibleVersionsInSource.length, 3);
  const sourceLinkRecord = sourceLedger.find(r => r.kind === 'creation-link-source' && r.bookId === bookId);
  assert.ok(sourceLinkRecord);
  assert.equal(sourceLinkRecord.spentCost, 15.5);

  const readBook = await f.call(`/api/creation-books/${bookId}`);
  assert.equal(readBook.body.book.spentCost, 15.5);

  const contractRes = await f.call(`/api/creation-books/${bookId}/chapter-contract`, 'POST', { chapterNo: 1 });
  assert.equal(contractRes.status, 200);

  const text = '第一章更新的正文内容';
  const runId = 'run_commit_1';
  const run = {
    id: runId,
    kind: 'generation-run-v1',
    projectId: f.targetNovel.id,
    workspaceId: f.targetNovel.workspaceId,
    actorUserId: 'owner',
    state: 'committing',
    leaseOwner: 'worker',
    fencingToken: 1,
    leaseUntil: Date.now() + 60000,
    actualCostMinor: 50,
    costStatus: 'settled',
    stages: [
      { stage: 'context_built', costStatus: 'pending', status: 'completed' },
      { stage: 'provider:writer', actualCostMinor: 50, costStatus: 'settled', status: 'completed' }
    ],
    request: {
      creationBookId: bookId,
      novelId: f.targetNovel.id,
      chapterId: 'chapter_1',
      sceneId: 'scene_1',
      storyContext: {
        stateVersion: 0,
        baseRevision: 0,
        baseHash: hash('初始正文'),
        storyBibleVersion: 4,
        planHash: hash('{}')
      }
    },
    result: {
      draft: text,
      outputHash: hash(text),
      contract: { chapterNo: 1 },
      audit: { passed: true, issues: [] },
      benchmark: { status: 'passed' },
      semanticAudit: {
        passed: true,
        audit: { passed: true, issues: [], factLedgerDelta: { newPromises: [], newRules: [], updates: [], byEntity: {} } }
      },
      quality: { passed: true, qualityVector: { language: { value: 0.9, confidence: 0.9 } } }
    }
  };
  await f.app.repository.generation.put(f.targetNovel.id, run, 0);

  const receipt = await f.creationRepo.commitChapter({
    userId: 'owner',
    projectId: f.targetNovel.id,
    workspaceId: f.targetNovel.workspaceId,
    bookId,
    runId,
    leaseOwner: 'worker',
    fencingToken: 1,
    text
  });
  assert.equal(receipt.spentCost, 16.0);
  const updatedBook = await f.creationRepo.read({ userId: 'owner', projectId: f.targetNovel.id, bookId });
  assert.equal(updatedBook.spentCost, 16.0);
});

test('native link-novel: activity status and active generation job conflict prevents migration', async t => {
  const f = await createHttpFixture(t);

  const bookId = 'cb_active_conflict';
  await f.call('/api/creation-books', 'POST', {
    creationBookId: bookId,
    title: '活动任务冲突测试',
    bible: { valid: true }
  });

  await f.app.repository.generation.put(f.targetNovel.id, {
    id: 'run_active_generating',
    kind: 'generation-run-v1',
    projectId: f.targetNovel.id,
    workspaceId: f.targetNovel.workspaceId,
    actorUserId: 'owner',
    state: 'generating',
    request: { creationBookId: bookId }
  }, 0);

  const blocked = await f.call(`/api/creation-books/${bookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, 'CREATION_JOB_ACTIVE');

  const bookCheck = await f.call(`/api/creation-books/${bookId}`);
  assert.equal(bookCheck.status, 200);
  assert.equal(bookCheck.body.book.projectId, undefined);

  const existingRun = await f.app.repository.generation.get(f.targetNovel.id, 'run_active_generating');
  await f.app.repository.generation.put(f.targetNovel.id, {
    ...existingRun,
    state: 'committed'
  }, existingRun.revision);

  const success = await f.call(`/api/creation-books/${bookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  assert.equal(success.status, 200);
  assert.equal(success.body.book.projectId, f.targetNovel.id);
});

test('native link-novel: re-linking semantics (idempotent same project, safe reject on different project)', async t => {
  const f = await createHttpFixture(t);

  const bookId = 'cb_relink_test';
  await f.call('/api/creation-books', 'POST', {
    creationBookId: bookId,
    title: '重链语义测试',
    bible: { valid: true }
  });

  const firstLink = await f.call(`/api/creation-books/${bookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  assert.equal(firstLink.status, 200);
  assert.equal(firstLink.body.idempotent, false);

  const idempotentLink = await f.call(`/api/creation-books/${bookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  assert.equal(idempotentLink.status, 200);
  assert.equal(idempotentLink.body.idempotent, true);
  assert.equal(idempotentLink.body.book.id, bookId);
  assert.equal(idempotentLink.body.book.projectId, f.targetNovel.id);

  const differentProjectLink = await f.call(`/api/creation-books/${bookId}/link-novel`, 'POST', {
    novelId: f.otherNovel.id
  });
  assert.equal(differentProjectLink.status, 409);
  assert.equal(differentProjectLink.body.code, 'ALREADY_LINKED');

  const current = await f.call(`/api/creation-books/${bookId}`);
  assert.equal(current.body.book.projectId, f.targetNovel.id);
});

test('native link-novel: restart and durability verification after persistence', async t => {
  const f = await createHttpFixture(t);

  const bookId = 'cb_restart_test';
  await f.call('/api/creation-books', 'POST', {
    creationBookId: bookId,
    title: '持久化重启测试',
    initialCost: 20,
    plan: { budgetLimit: 100 },
    bible: { valid: true, premise: '重启核验' }
  });

  await f.call(`/api/creation-books/${bookId}/bible`, 'PUT', {
    bible: { valid: true, premise: '重启核验v2' },
    bibleVersion: 1
  });

  const link = await f.call(`/api/creation-books/${bookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  assert.equal(link.status, 200);

  await new Promise(resolve => f.server.close(resolve));
  await f.app.close();

  const reloadedApp = new JsonAppRepository(f.directory);
  const reloadedRepo = new JsonCreationRepository(reloadedApp);

  try {
    const book = await reloadedRepo.read({ userId: 'owner', bookId });
    assert.equal(book.id, bookId);
    assert.equal(book.projectId, f.targetNovel.id);
    assert.equal(book.spentCost, 20);

    const bible = await reloadedRepo.readBible({ userId: 'owner', bookId });
    assert.equal(bible.version, 2);
    assert.equal(bible.payload.premise, '重启核验v2');

    const unlinked = await reloadedRepo.list({ userId: 'owner' });
    assert.deepEqual(unlinked, []);

    const projectBooks = await reloadedRepo.list({ userId: 'owner', projectId: f.targetNovel.id });
    assert.equal(projectBooks.length, 1);
    assert.equal(projectBooks[0].id, bookId);

    const contractCtx = await reloadedRepo.contractContext({ userId: 'owner', bookId });
    assert.equal(contractCtx.book.id, bookId);
    assert.equal(contractCtx.bible.version, 2);
  } finally {
    await reloadedApp.close();
  }
});

test('native link-novel: ID conflict on ledger or debt record with different content throws 409 ID_CONFLICT and produces atomic no-change', async t => {
  const f = await createHttpFixture(t);
  const bookId = 'cb_id_conflict_test';
  await f.call('/api/creation-books', 'POST', {
    creationBookId: bookId,
    title: 'ID冲突测试',
    bible: { valid: true, payloadTag: 'source_v1' }
  });

  const sourceScope = `__molan_creation_owner_v1_${hash(JSON.stringify(['owner', bookId]))}`;
  const sourceBibleRecord = (await f.app.repository.ledger.list(sourceScope)).find(r => r.bookId === bookId && r.kind === 'creation-bible-version');
  assert.ok(sourceBibleRecord);

  await f.app.repository.ledger.put(f.targetNovel.id, {
    id: sourceBibleRecord.id,
    kind: 'creation-bible-version',
    bookId,
    bibleId: 'different_bible',
    version: 1,
    payload: { different: true }
  }, 0);

  const blockedLedger = await f.call(`/api/creation-books/${bookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  assert.equal(blockedLedger.status, 409);
  assert.equal(blockedLedger.body.code, 'ID_CONFLICT');

  const targetBookAfterBlock = await f.app.repository.novels.get(f.targetNovel.id, `creation-book:${bookId}`);
  assert.equal(targetBookAfterBlock, null);
  const sourceBookAfterBlock = await f.app.repository.novels.get(sourceScope, `creation-book:${bookId}`);
  assert.equal(sourceBookAfterBlock.status, 'draft');

  const debtBookId = 'cb_debt_conflict_test';
  await f.call('/api/creation-books', 'POST', {
    creationBookId: debtBookId,
    title: 'Debt冲突测试',
    bible: { valid: true }
  });
  const debtScope = `__molan_creation_owner_v1_${hash(JSON.stringify(['owner', debtBookId]))}`;
  const debtRecord = {
    id: `creation-debt-materialized:${debtBookId}:debt_1`,
    kind: 'creation-debt-materialized',
    bookId: debtBookId,
    seed: 'source_seed',
    status: 'open'
  };
  await f.app.repository.novels.put(debtScope, debtRecord, 0);

  await f.app.repository.novels.put(f.targetNovel.id, {
    id: debtRecord.id,
    kind: 'creation-debt-materialized',
    bookId: debtBookId,
    seed: 'conflicting_seed',
    status: 'closed'
  }, 0);

  const blockedDebt = await f.call(`/api/creation-books/${debtBookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  assert.equal(blockedDebt.status, 409);
  assert.equal(blockedDebt.body.code, 'ID_CONFLICT');

  const sourceDebtBook = await f.app.repository.novels.get(debtScope, `creation-book:${debtBookId}`);
  assert.equal(sourceDebtBook.status, 'draft');
  assert.equal(await f.app.repository.novels.get(f.targetNovel.id, `creation-book:${debtBookId}`), null);
});

test('native link-novel: book reconstruction retains extra fields, activity status, and Bible business version', async t => {
  const f = await createHttpFixture(t);
  const bookId = 'cb_fields_retention_test';
  await f.call('/api/creation-books', 'POST', {
    creationBookId: bookId,
    title: '字段完整保留测试',
    bible: { valid: true, versionTag: 'v1' }
  });

  const sourceScope = `__molan_creation_owner_v1_${hash(JSON.stringify(['owner', bookId]))}`;
  const existingBook = await f.app.repository.novels.get(sourceScope, `creation-book:${bookId}`);
  await f.app.repository.novels.put(sourceScope, {
    ...existingBook,
    genre: '科幻',
    activityStatus: 'idle',
    status: 'in_progress',
    customTag: 'preserved_tag',
    reviewScore: 98
  }, existingBook.revision);

  await f.call(`/api/creation-books/${bookId}/bible`, 'PUT', {
    bible: { valid: true, versionTag: 'v2' },
    bibleVersion: 1
  });
  await f.call(`/api/creation-books/${bookId}/bible`, 'PUT', {
    bible: { valid: true, versionTag: 'v3' },
    bibleVersion: 2
  });

  const linkRes = await f.call(`/api/creation-books/${bookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  assert.equal(linkRes.status, 200);
  assert.equal(linkRes.body.ok, true);
  assert.equal(linkRes.body.book.genre, '科幻');
  assert.equal(linkRes.body.book.activityStatus, 'idle');
  assert.equal(linkRes.body.book.status, 'in_progress');
  assert.equal(linkRes.body.book.customTag, 'preserved_tag');
  assert.equal(linkRes.body.book.reviewScore, 98);
  assert.equal(linkRes.body.book.bibleVersion, 3);

  const storedTargetBook = await f.app.repository.novels.get(f.targetNovel.id, `creation-book:${bookId}`);
  assert.equal(storedTargetBook.genre, '科幻');
  assert.equal(storedTargetBook.activityStatus, 'idle');
  assert.equal(storedTargetBook.status, 'in_progress');
  assert.equal(storedTargetBook.customTag, 'preserved_tag');
  assert.equal(storedTargetBook.reviewScore, 98);
  assert.equal(storedTargetBook.bibleVersion, 3);

  const storedTargetBible = await f.app.repository.novels.get(f.targetNovel.id, `creation-bible:${bookId}`);
  assert.equal(storedTargetBible.version, 3);
});

test('native link-novel: active generation check covers diverse real-world run structures and manifests', async t => {
  const f = await createHttpFixture(t);
  const bookId = 'cb_run_structure_test';
  await f.call('/api/creation-books', 'POST', {
    creationBookId: bookId,
    title: '任务结构覆盖测试',
    bible: { valid: true }
  });

  await f.app.repository.generation.put(f.targetNovel.id, {
    id: 'run_struct_manifest',
    kind: 'generation-run-v1',
    projectId: f.targetNovel.id,
    workspaceId: f.targetNovel.workspaceId,
    actorUserId: 'owner',
    state: 'scene_planning',
    manifest: { creationBookId: bookId }
  }, 0);

  const blocked1 = await f.call(`/api/creation-books/${bookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  assert.equal(blocked1.status, 409);
  assert.equal(blocked1.body.code, 'CREATION_JOB_ACTIVE');

  const run1 = await f.app.repository.generation.get(f.targetNovel.id, 'run_struct_manifest');
  await f.app.repository.generation.put(f.targetNovel.id, { ...run1, state: 'failed', finishedAt: Date.now() }, run1.revision);

  await f.app.repository.generation.put(f.targetNovel.id, {
    id: 'run_struct_chapter_context',
    kind: 'generation-run-v1',
    projectId: f.targetNovel.id,
    workspaceId: f.targetNovel.workspaceId,
    actorUserId: 'owner',
    state: 'generating',
    request: { chapterContext: { creationBookId: bookId } }
  }, 0);

  const blocked2 = await f.call(`/api/creation-books/${bookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  assert.equal(blocked2.status, 409);
  assert.equal(blocked2.body.code, 'CREATION_JOB_ACTIVE');

  const run2 = await f.app.repository.generation.get(f.targetNovel.id, 'run_struct_chapter_context');
  await f.app.repository.generation.put(f.targetNovel.id, { ...run2, state: 'committed', finishedAt: Date.now() }, run2.revision);

  await f.app.repository.generation.put(f.targetNovel.id, {
    id: 'run_struct_lease',
    kind: 'generation-run-v1',
    projectId: f.targetNovel.id,
    workspaceId: f.targetNovel.workspaceId,
    actorUserId: 'owner',
    state: 'running',
    leaseUntil: Date.now() + 60000,
    creationBookId: bookId
  }, 0);

  const blocked3 = await f.call(`/api/creation-books/${bookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  assert.equal(blocked3.status, 409);
  assert.equal(blocked3.body.code, 'CREATION_JOB_ACTIVE');

  const run3 = await f.app.repository.generation.get(f.targetNovel.id, 'run_struct_lease');
  await f.app.repository.generation.put(f.targetNovel.id, { ...run3, state: 'completed', finishedAt: Date.now() }, run3.revision);

  const success = await f.call(`/api/creation-books/${bookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  assert.equal(success.status, 200);
  assert.equal(success.body.book.projectId, f.targetNovel.id);
});

test('native link-novel: idempotent re-link verifies active target project status', async t => {
  const f = await createHttpFixture(t);
  const bookId = 'cb_idempotent_active_test';
  await f.call('/api/creation-books', 'POST', {
    creationBookId: bookId,
    title: '幂等目标状态核验测试',
    bible: { valid: true }
  });

  const firstLink = await f.call(`/api/creation-books/${bookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  assert.equal(firstLink.status, 200);
  assert.equal(firstLink.body.idempotent, false);

  const secondLink = await f.call(`/api/creation-books/${bookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  assert.equal(secondLink.status, 200);
  assert.equal(secondLink.body.idempotent, true);
  assert.equal(secondLink.body.book.id, bookId);

  const targetProjectRow = await f.app.repository.novels.get(f.targetNovel.id, f.targetNovel.id);
  await f.app.repository.novels.put(f.targetNovel.id, {
    ...targetProjectRow,
    status: 'archived'
  }, targetProjectRow.revision);

  const archivedLink = await f.call(`/api/creation-books/${bookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  assert.equal(archivedLink.status, 404);
});

test('native link-novel: transaction failure distinction: callback abort vs post-journal crash recovery commit', async t => {
  const f = await createHttpFixture(t);
  const bookId = 'cb_tx_distinction_test';
  await f.call('/api/creation-books', 'POST', {
    creationBookId: bookId,
    title: '事务失败区分测试',
    bible: { valid: true, tag: 'orig' }
  });

  const journalPath = f.app.repository.journalPath;
  assert.equal(fs.existsSync(journalPath), false);

  await f.app.repository.generation.put(f.targetNovel.id, {
    id: 'run_block_cb',
    kind: 'generation-run-v1',
    projectId: f.targetNovel.id,
    workspaceId: f.targetNovel.workspaceId,
    actorUserId: 'owner',
    state: 'generating',
    request: { creationBookId: bookId }
  }, 0);

  const callbackFailRes = await f.call(`/api/creation-books/${bookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  assert.equal(callbackFailRes.status, 409);
  assert.equal(callbackFailRes.body.code, 'CREATION_JOB_ACTIVE');

  assert.equal(fs.existsSync(journalPath), false);
  assert.equal(f.app.repository.poisoned, false);

  const activeRun = await f.app.repository.generation.get(f.targetNovel.id, 'run_block_cb');
  await f.app.repository.generation.put(f.targetNovel.id, { ...activeRun, state: 'committed', finishedAt: Date.now() }, activeRun.revision);

  const originalAtomicWrite = f.app.repository.atomicWrite.bind(f.app.repository);
  let crashed = false;
  f.app.repository.atomicWrite = function(filename, content) {
    originalAtomicWrite(filename, content);
    if (filename === f.app.repository.journalPath && !crashed) {
      crashed = true;
      throw new Error('SIMULATED_DISK_CRASH_AFTER_JOURNAL');
    }
  };

  const postJournalFailRes = await f.call(`/api/creation-books/${bookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  assert.equal(postJournalFailRes.status, 500);

  assert.equal(fs.existsSync(journalPath), true);
  assert.equal(f.app.repository.poisoned, true);

  await new Promise(resolve => f.server.close(resolve));
  await f.app.close();

  const restartedApp = new JsonAppRepository(f.directory);
  const restartedRepo = new JsonCreationRepository(restartedApp);

  try {
    assert.equal(fs.existsSync(journalPath), false);
    const recoveredBook = await restartedRepo.read({ userId: 'owner', bookId });
    assert.equal(recoveredBook.id, bookId);
    assert.equal(recoveredBook.projectId, f.targetNovel.id);
  } finally {
    await restartedApp.close();
  }
});

test('native link-novel: concurrent race conditions (same destination concurrent idempotency & different destination safe rejection)', async t => {
  const f = await createHttpFixture(t);

  const sameBookId = 'cb_race_same_target';
  await f.call('/api/creation-books', 'POST', {
    creationBookId: sameBookId,
    title: '同目标并发竞态测试',
    bible: { valid: true }
  });

  const [res1, res2] = await Promise.all([
    f.call(`/api/creation-books/${sameBookId}/link-novel`, 'POST', { novelId: f.targetNovel.id }),
    f.call(`/api/creation-books/${sameBookId}/link-novel`, 'POST', { novelId: f.targetNovel.id })
  ]);

  assert.equal(res1.status, 200);
  assert.equal(res2.status, 200);
  assert.equal(res1.body.book.projectId, f.targetNovel.id);
  assert.equal(res2.body.book.projectId, f.targetNovel.id);
  const idempotentValues = [res1.body.idempotent, res2.body.idempotent].sort();
  assert.deepEqual(idempotentValues, [false, true]);

  const diffBookId = 'cb_race_diff_target';
  await f.call('/api/creation-books', 'POST', {
    creationBookId: diffBookId,
    title: '异目标并发竞态测试',
    bible: { valid: true }
  });

  const [diffRes1, diffRes2] = await Promise.all([
    f.call(`/api/creation-books/${diffBookId}/link-novel`, 'POST', { novelId: f.targetNovel.id }),
    f.call(`/api/creation-books/${diffBookId}/link-novel`, 'POST', { novelId: f.otherNovel.id })
  ]);

  const statuses = [diffRes1.status, diffRes2.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  const winner = diffRes1.status === 200 ? diffRes1 : diffRes2;
  const rejected = diffRes1.status === 409 ? diffRes1 : diffRes2;
  assert.equal(rejected.body.code, 'ALREADY_LINKED');
  assert.equal(winner.body.ok, true);

  const finalCheck = await f.call(`/api/creation-books/${diffBookId}`);
  assert.equal(finalCheck.body.book.projectId, winner.body.book.projectId);
});

test('native link-novel: source novel deleted or read-only must not be revived', async t => {
  const f = await createHttpFixture(t);

  const deletedBookId = 'cb_deleted_source';
  await f.call('/api/creation-books', 'POST', {
    creationBookId: deletedBookId,
    title: '已删除源书不得关联测试',
    bible: { valid: true }
  });

  const delScope = `__molan_creation_owner_v1_${hash(JSON.stringify(['owner', deletedBookId]))}`;
  const unlinkedDelBook = await f.app.repository.novels.get(delScope, `creation-book:${deletedBookId}`);
  await f.app.repository.novels.put(delScope, {
    ...unlinkedDelBook,
    deleted: true,
    status: 'deleted'
  }, unlinkedDelBook.revision);

  const delLinkRes = await f.call(`/api/creation-books/${deletedBookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  assert.equal(delLinkRes.status, 404);
  assert.equal(await f.app.repository.novels.get(f.targetNovel.id, `creation-book:${deletedBookId}`), null);

  const readonlyBookId = 'cb_readonly_source';
  await f.call('/api/creation-books', 'POST', {
    creationBookId: readonlyBookId,
    title: '只读源书不得关联测试',
    bible: { valid: true }
  });

  const roScope = `__molan_creation_owner_v1_${hash(JSON.stringify(['owner', readonlyBookId]))}`;
  const unlinkedRoBook = await f.app.repository.novels.get(roScope, `creation-book:${readonlyBookId}`);
  await f.app.repository.novels.put(roScope, {
    ...unlinkedRoBook,
    readOnly: true,
    status: 'archived'
  }, unlinkedRoBook.revision);

  const roLinkRes = await f.call(`/api/creation-books/${readonlyBookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  assert.equal(roLinkRes.status, 404);
  assert.equal(await f.app.repository.novels.get(f.targetNovel.id, `creation-book:${readonlyBookId}`), null);

  const activeStatusBookId = 'cb_active_status_source';
  await f.call('/api/creation-books', 'POST', {
    creationBookId: activeStatusBookId,
    title: '活跃状态源书阻断测试',
    bible: { valid: true }
  });
  const actScope = `__molan_creation_owner_v1_${hash(JSON.stringify(['owner', activeStatusBookId]))}`;
  const unlinkedActBook = await f.app.repository.novels.get(actScope, `creation-book:${activeStatusBookId}`);
  await f.app.repository.novels.put(actScope, {
    ...unlinkedActBook,
    activityStatus: 'generating'
  }, unlinkedActBook.revision);

  const actLinkRes = await f.call(`/api/creation-books/${activeStatusBookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  assert.equal(actLinkRes.status, 409);
  assert.equal(actLinkRes.body.code, 'CREATION_JOB_ACTIVE');

  const linkedDeletedBookId = 'cb_linked_then_deleted';
  await f.call('/api/creation-books', 'POST', {
    creationBookId: linkedDeletedBookId,
    title: '目标书删除后不得幂等复活测试',
    bible: { valid: true }
  });
  const initialLink = await f.call(`/api/creation-books/${linkedDeletedBookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  assert.equal(initialLink.status, 200);

  const targetBookRow = await f.app.repository.novels.get(f.targetNovel.id, `creation-book:${linkedDeletedBookId}`);
  await f.app.repository.novels.put(f.targetNovel.id, {
    ...targetBookRow,
    deleted: true,
    status: 'deleted'
  }, targetBookRow.revision);

  const reviveAttempt = await f.call(`/api/creation-books/${linkedDeletedBookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  assert.equal(reviveAttempt.status, 404);

  const targetBookAfter = await f.app.repository.novels.get(f.targetNovel.id, `creation-book:${linkedDeletedBookId}`);
  assert.equal(targetBookAfter.deleted, true);
  assert.equal(targetBookAfter.status, 'deleted');

  const linkedReadonlyBookId = 'cb_linked_then_readonly';
  await f.call('/api/creation-books', 'POST', {
    creationBookId: linkedReadonlyBookId,
    title: '目标书只读后不得重链测试',
    bible: { valid: true }
  });
  await f.call(`/api/creation-books/${linkedReadonlyBookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  const targetRoRow = await f.app.repository.novels.get(f.targetNovel.id, `creation-book:${linkedReadonlyBookId}`);
  await f.app.repository.novels.put(f.targetNovel.id, {
    ...targetRoRow,
    readOnly: true,
    status: 'archived'
  }, targetRoRow.revision);

  const roRelink = await f.call(`/api/creation-books/${linkedReadonlyBookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  assert.equal(roRelink.status, 404);
});

test('native link-novel: retains state, debts, history, quality evidence, and prevents ledger double-charging', async t => {
  const f = await createHttpFixture(t);
  const bookId = 'cb_full_retention_evidence';

  await f.call('/api/creation-books', 'POST', {
    creationBookId: bookId,
    title: '全量证据保留与防双计费测试',
    initialCost: 12.0,
    plan: { budgetLimit: 50, genre: '仙侠' },
    bible: { valid: true, storyTag: '仙侠卷' }
  });

  const sourceScope = `__molan_creation_owner_v1_${hash(JSON.stringify(['owner', bookId]))}`;
  const now = Date.now();

  await f.app.repository.ledger.put(sourceScope, {
    id: `snap_${bookId}_1_1`,
    kind: 'creation-snapshot',
    bookId,
    chapterNo: 1,
    bibleVersion: 1,
    stateVersion: 1,
    contentHash: hash('第一章内容'),
    auditStatus: 'passed',
    actorUserId: 'owner',
    createdAt: now
  }, 0);

  await f.app.repository.ledger.put(sourceScope, {
    id: `cca_evidence_${bookId}_1`,
    kind: 'creation-audit',
    bookId,
    chapterNo: 1,
    contentHash: hash('第一章内容'),
    evidence: { passed: true, score: 95 },
    projection: { summary: '第一章顺利展开' },
    bibleVersion: 1,
    stateVersion: 1,
    actorUserId: 'owner',
    createdAt: now
  }, 0);

  await f.app.repository.ledger.put(sourceScope, {
    id: `creation-debt-outbox:snap_${bookId}_1_1`,
    kind: 'creation-debt-outbox',
    bookId,
    snapshotId: `snap_${bookId}_1_1`,
    causalDebts: [{
      seed: '仙门伏笔：灵石丢失',
      type: 'arc',
      originChapter: 1,
      maturationChapter: 10,
      debtCategory: 'plot'
    }],
    status: 'pending',
    actorUserId: 'owner',
    createdAt: now
  }, 0);

  await f.app.repository.ledger.put(sourceScope, {
    id: `contract_failure_${bookId}_1`,
    kind: 'creation-contract-failure',
    bookId,
    chapterNo: 1,
    failureEvidence: { reason: '模型超时重试' },
    createdAt: now
  }, 0);

  const preDebts = await f.creationRepo.debts({ userId: 'owner', bookId });
  assert.equal(preDebts.recovery.recovered, 1);
  assert.equal(preDebts.active.length, 1);
  assert.equal(preDebts.active[0].seed, '仙门伏笔：灵石丢失');

  const sourceBookRow = await f.app.repository.novels.get(sourceScope, `creation-book:${bookId}`);
  await f.app.repository.novels.put(sourceScope, {
    ...sourceBookRow,
    currentStateVersion: 1,
    currentChapterNo: 1
  }, sourceBookRow.revision);

  const linkRes = await f.call(`/api/creation-books/${bookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  assert.equal(linkRes.status, 200);
  assert.equal(linkRes.body.ok, true);
  assert.equal(linkRes.body.book.currentStateVersion, 1);
  assert.equal(linkRes.body.book.currentChapterNo, 1);
  assert.equal(linkRes.body.book.spentCost, 12.0);

  const postSnapshots = await f.call(`/api/creation-books/${bookId}/state`);
  assert.equal(postSnapshots.status, 200);
  assert.equal(postSnapshots.body.snapshots.length, 1);
  assert.equal(postSnapshots.body.snapshots[0].id, `snap_${bookId}_1_1`);

  const postDebts = await f.call(`/api/creation-books/${bookId}/debts?chapterNo=2`);
  assert.equal(postDebts.status, 200);
  assert.equal(postDebts.body.active.length, 1);
  assert.equal(postDebts.body.active[0].seed, '仙门伏笔：灵石丢失');

  const postQuality = await f.call(`/api/creation-books/${bookId}/quality-report`);
  assert.equal(postQuality.status, 200);
  assert.ok(postQuality.body.summary);
  assert.equal(postQuality.body.chapters.length, 1);

  const targetLedgerRows = await f.app.repository.ledger.list(f.targetNovel.id);
  assert.ok(targetLedgerRows.some(r => r.id === `snap_${bookId}_1_1`));
  assert.ok(targetLedgerRows.some(r => r.id === `cca_evidence_${bookId}_1`));
  assert.ok(targetLedgerRows.some(r => r.id === `contract_failure_${bookId}_1`));
  assert.ok(targetLedgerRows.some(r => r.id.startsWith('debt_')));
  assert.ok(targetLedgerRows.some(r => r.kind === 'creation-link-evidence'));

  const sourceLedgerRows = await f.app.repository.ledger.list(sourceScope);
  assert.ok(sourceLedgerRows.some(r => r.id === `snap_${bookId}_1_1`));
  assert.ok(sourceLedgerRows.some(r => r.id === `cca_evidence_${bookId}_1`));
  assert.ok(sourceLedgerRows.some(r => r.id === `contract_failure_${bookId}_1`));
  assert.ok(sourceLedgerRows.some(r => r.kind === 'creation-link-source'));

  const targetBookAfter = await f.creationRepo.read({ userId: 'owner', projectId: f.targetNovel.id, bookId });
  assert.equal(targetBookAfter.spentCost, 12.0);
  assert.equal(targetBookAfter.currentStateVersion, 1);
  assert.equal(targetBookAfter.currentChapterNo, 1);
});

test('native link-novel: activityStatus and isRunActive protect non-terminal states and reject unmigrated source runs', async t => {
  const f = await createHttpFixture(t);

  const blockedStatuses = ['waiting_author', 'paused', 'needs_human', 'provider_unknown', 'unknown_review_state'];
  for (const st of blockedStatuses) {
    const bookId = `cb_status_${st}`;
    await f.call('/api/creation-books', 'POST', {
      creationBookId: bookId,
      title: `状态保护-${st}`,
      bible: { valid: true }
    });
    const scope = `__molan_creation_owner_v1_${hash(JSON.stringify(['owner', bookId]))}`;
    const unlinked = await f.app.repository.novels.get(scope, `creation-book:${bookId}`);
    await f.app.repository.novels.put(scope, {
      ...unlinked,
      activityStatus: st
    }, unlinked.revision);

    const res = await f.call(`/api/creation-books/${bookId}/link-novel`, 'POST', {
      novelId: f.targetNovel.id
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'CREATION_JOB_ACTIVE');
  }

  const runBlockedStates = ['waiting_author', 'paused', 'needs_human', 'provider_unknown', 'custom_generating_phase'];
  for (const st of runBlockedStates) {
    const bookId = `cb_run_${st}`;
    await f.call('/api/creation-books', 'POST', {
      creationBookId: bookId,
      title: `任务状态保护-${st}`,
      bible: { valid: true }
    });
    const runId = `run_${st}`;
    await f.app.repository.generation.put(f.targetNovel.id, {
      id: runId,
      kind: 'generation-run-v1',
      projectId: f.targetNovel.id,
      workspaceId: f.targetNovel.workspaceId,
      actorUserId: 'owner',
      state: st,
      request: { creationBookId: bookId }
    }, 0);

    const res = await f.call(`/api/creation-books/${bookId}/link-novel`, 'POST', {
      novelId: f.targetNovel.id
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'CREATION_JOB_ACTIVE');
  }

  const sourceHistoryBookId = 'cb_source_history_terminal';
  await f.call('/api/creation-books', 'POST', {
    creationBookId: sourceHistoryBookId,
    title: '来源历史记录阻断测试',
    bible: { valid: true }
  });
  const sourceScope = `__molan_creation_owner_v1_${hash(JSON.stringify(['owner', sourceHistoryBookId]))}`;
  await f.app.repository.generation.put(sourceScope, {
    id: 'run_source_terminal_1',
    kind: 'generation-run-v1',
    projectId: sourceScope,
    workspaceId: 'personal',
    actorUserId: 'owner',
    state: 'completed',
    finishedAt: Date.now(),
    request: { creationBookId: sourceHistoryBookId }
  }, 0);

  const histRes = await f.call(`/api/creation-books/${sourceHistoryBookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  assert.equal(histRes.status, 409);
  assert.equal(histRes.body.code, 'CREATION_HISTORY_MIGRATION_REQUIRED');

  const targetBook = await f.app.repository.novels.get(f.targetNovel.id, `creation-book:${sourceHistoryBookId}`);
  assert.equal(targetBook, null);
  const sourceBook = await f.app.repository.novels.get(sourceScope, `creation-book:${sourceHistoryBookId}`);
  assert.notEqual(sourceBook.status, 'migrated');
  const sourceRun = await f.app.repository.generation.get(sourceScope, 'run_source_terminal_1');
  assert.ok(sourceRun);

  const receiptBookId = 'cb_source_receipt_terminal';
  await f.call('/api/creation-books', 'POST', {
    creationBookId: receiptBookId,
    title: '来源回执历史阻断测试',
    bible: { valid: true }
  });
  const receiptScope = `__molan_creation_owner_v1_${hash(JSON.stringify(['owner', receiptBookId]))}`;
  await f.app.repository.ledger.put(receiptScope, {
    id: `creation-commit-receipt:${receiptBookId}:1`,
    kind: 'creation-commit-receipt',
    bookId: receiptBookId,
    actorUserId: 'owner',
    createdAt: Date.now()
  }, 0);

  const receiptRes = await f.call(`/api/creation-books/${receiptBookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  assert.equal(receiptRes.status, 409);
  assert.equal(receiptRes.body.code, 'CREATION_HISTORY_MIGRATION_REQUIRED');
  const targetReceiptBook = await f.app.repository.novels.get(f.targetNovel.id, `creation-book:${receiptBookId}`);
  assert.equal(targetReceiptBook, null);
});

test('native link-novel: source ACL verification before ALREADY_LINKED prevents existence leakage and preserves contracts', async t => {
  const f = await createHttpFixture(t);

  const bookId = 'cb_linked_acl_guard';
  await f.call('/api/creation-books', 'POST', {
    creationBookId: bookId,
    title: '已关联书来源权限泄漏防御测试',
    bible: { valid: true }
  });

  const linkRes = await f.call(`/api/creation-books/${bookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  assert.equal(linkRes.status, 200);
  assert.equal(linkRes.body.idempotent, false);

  const strangerDiff = await f.call(`/api/creation-books/${bookId}/link-novel`, 'POST', {
    novelId: f.otherNovel.id
  }, 'stranger');
  assert.equal(strangerDiff.status, 404);
  assert.equal(strangerDiff.body.code, 'BOOK_NOT_FOUND');

  const strangerSame = await f.call(`/api/creation-books/${bookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  }, 'stranger');
  assert.equal(strangerSame.status, 404);
  assert.equal(strangerSame.body.code, 'BOOK_NOT_FOUND');

  const viewerDiff = await f.call(`/api/creation-books/${bookId}/link-novel`, 'POST', {
    novelId: f.otherNovel.id
  }, 'viewer');
  assert.equal(viewerDiff.status, 404);
  assert.equal(viewerDiff.body.code, 'FORBIDDEN');

  const ownerDiff = await f.call(`/api/creation-books/${bookId}/link-novel`, 'POST', {
    novelId: f.otherNovel.id
  }, 'owner');
  assert.equal(ownerDiff.status, 409);
  assert.equal(ownerDiff.body.code, 'ALREADY_LINKED');

  const ownerSame = await f.call(`/api/creation-books/${bookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  }, 'owner');
  assert.equal(ownerSame.status, 200);
  assert.equal(ownerSame.body.idempotent, true);

  await assert.rejects(
    f.creationRepo.linkNovel({ userId: 'stranger', bookId, targetProjectId: f.targetNovel.id, novelId: f.targetNovel.id }),
    err => {
      assert.equal(err.status, 404);
      assert.equal(err.code, 'BOOK_NOT_FOUND');
      assert.notEqual(err.code, 'ALREADY_LINKED');
      return true;
    }
  );
  await assert.rejects(
    f.creationRepo.linkNovel({ userId: 'stranger', bookId, targetProjectId: f.otherNovel.id, novelId: f.otherNovel.id }),
    err => {
      assert.equal(err.status, 404);
      assert.equal(err.code, 'BOOK_NOT_FOUND');
      assert.notEqual(err.code, 'ALREADY_LINKED');
      return true;
    }
  );
  await assert.rejects(
    f.creationRepo.linkNovel({ userId: 'viewer', bookId, targetProjectId: f.targetNovel.id, novelId: f.targetNovel.id }),
    err => {
      assert.equal(err.status, 404);
      assert.equal(err.code, 'BOOK_NOT_FOUND');
      assert.notEqual(err.code, 'ALREADY_LINKED');
      return true;
    }
  );
  await assert.rejects(
    f.creationRepo.linkNovel({ userId: 'viewer', bookId, targetProjectId: f.otherNovel.id, novelId: f.otherNovel.id }),
    err => {
      assert.equal(err.status, 404);
      assert.equal(err.code, 'BOOK_NOT_FOUND');
      assert.notEqual(err.code, 'ALREADY_LINKED');
      return true;
    }
  );
  await assert.rejects(
    f.creationRepo.linkNovel({ userId: 'owner', bookId, targetProjectId: f.otherNovel.id, novelId: f.otherNovel.id }),
    err => {
      assert.equal(err.status, 409);
      assert.equal(err.code, 'ALREADY_LINKED');
      return true;
    }
  );
  const repoOwnerSame = await f.creationRepo.linkNovel({ userId: 'owner', bookId, targetProjectId: f.targetNovel.id, novelId: f.targetNovel.id });
  assert.equal(repoOwnerSame.ok, true);
  assert.equal(repoOwnerSame.idempotent, true);

  const roBookId = 'cb_linked_then_ro_acl';
  await f.call('/api/creation-books', 'POST', {
    creationBookId: roBookId,
    title: '只读书来源异目标防御测试',
    bible: { valid: true }
  });
  await f.call(`/api/creation-books/${roBookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  const targetRoRow = await f.app.repository.novels.get(f.targetNovel.id, `creation-book:${roBookId}`);
  await f.app.repository.novels.put(f.targetNovel.id, {
    ...targetRoRow,
    readOnly: true,
    status: 'archived'
  }, targetRoRow.revision);

  const roDiff = await f.call(`/api/creation-books/${roBookId}/link-novel`, 'POST', {
    novelId: f.otherNovel.id
  }, 'owner');
  assert.equal(roDiff.status, 404);
});

test('native link-novel: source immutable ledger depth invariant, excluded usage replication, no commit receipt fabrication, and account and summarizeTokenUsage invariant', async t => {
  const f = await createHttpFixture(t);

  const bookId = 'cb_ledger_invariants';
  await f.call('/api/creation-books', 'POST', {
    creationBookId: bookId,
    title: '账本不变性与费用汇总测试',
    initialCost: 25.0,
    plan: { budgetLimit: 100 },
    bible: { valid: true }
  });

  const sourceScope = `__molan_creation_owner_v1_${hash(JSON.stringify(['owner', bookId]))}`;
  const now = Date.now();

  await f.app.repository.ledger.put(sourceScope, {
    id: `snap_${bookId}_test_1`,
    kind: 'creation-snapshot',
    bookId,
    chapterNo: 1,
    bibleVersion: 1,
    stateVersion: 1,
    contentHash: hash('快照正文'),
    auditStatus: 'passed',
    actorUserId: 'owner',
    createdAt: now
  }, 0);

  await f.app.repository.ledger.put(sourceScope, {
    id: `cca_${bookId}_test_1`,
    kind: 'creation-audit',
    bookId,
    chapterNo: 1,
    contentHash: hash('快照正文'),
    evidence: { passed: true },
    bibleVersion: 1,
    stateVersion: 1,
    actorUserId: 'owner',
    createdAt: now
  }, 0);

  await f.app.repository.ledger.put(sourceScope, {
    id: `usage_settle_${bookId}_1`,
    kind: 'usage-settlement',
    bookId,
    userId: 'owner',
    requestId: 'req_settle_1',
    creditCost: 3.5,
    actualCost: 3.5,
    createdAt: now
  }, 0);

  await f.app.repository.ledger.put(sourceScope, {
    id: `usage_pending_${bookId}_1`,
    kind: 'usage-pending',
    bookId,
    userId: 'owner',
    requestId: 'req_pending_1',
    reservedCost: 2.0,
    createdAt: now
  }, 0);

  await f.app.repository.ledger.put(sourceScope, {
    id: `credit_adj_${bookId}_1`,
    kind: 'credit-adjustment',
    bookId,
    userId: 'owner',
    delta: -5.0,
    createdAt: now
  }, 0);

  await f.app.repository.ledger.put(sourceScope, {
    id: `usage_disp_${bookId}_1`,
    kind: 'usage-dispatch',
    bookId,
    userId: 'owner',
    requestId: 'req_disp_1',
    createdAt: now
  }, 0);

  const settledReqId = `req_${'a'.repeat(40)}`;
  await f.app.reserveTokenUsage({
    userId: 'owner',
    requestId: settledReqId,
    reservedCost: 3.5
  });
  await f.app.recordDispatchAttempt({
    userId: 'owner',
    requestId: settledReqId
  });
  await f.app.settleTokenUsage({
    userId: 'owner',
    requestId: settledReqId,
    actualCost: 3.5,
    usage: { totalTokens: 100 }
  });

  const pendingReqId = `req_${'b'.repeat(40)}`;
  await f.app.reserveTokenUsage({
    userId: 'owner',
    requestId: pendingReqId,
    reservedCost: 2.0
  });
  await f.app.recordDispatchAttempt({
    userId: 'owner',
    requestId: pendingReqId
  });
  await f.app.holdTokenUsage({
    userId: 'owner',
    requestId: pendingReqId,
    usage: { status: 'provider_unknown' }
  });

  const initialSourceLedger = await f.app.repository.ledger.list(sourceScope);
  const initialSourceDepth = initialSourceLedger.length;

  const initialAccount = await f.app.getAccount('owner');
  assert.ok(initialAccount.spent > 0);
  assert.equal(initialAccount.spent, 3.5);

  const initialUsageAll = await f.app.summarizeTokenUsage({ userId: 'owner' });
  assert.equal(initialUsageAll.length, 2);
  const initialSettled = initialUsageAll.find(r => r.kind === 'usage-settlement');
  assert.ok(initialSettled);
  assert.equal(initialSettled.actualCost, 3.5);
  const initialPending = initialUsageAll.find(r => r.kind === 'usage-pending');
  assert.ok(initialPending);
  assert.equal(initialPending.actualCost, null);

  const initialUsageTarget = await f.app.summarizeTokenUsage({ userId: 'owner', projectId: f.targetNovel.id });

  const linkRes = await f.call(`/api/creation-books/${bookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  assert.equal(linkRes.status, 200);
  assert.equal(linkRes.body.ok, true);

  const postSourceLedger = await f.app.repository.ledger.list(sourceScope);
  assert.equal(postSourceLedger.length, initialSourceDepth + 1);
  const sourceEvidenceRecord = postSourceLedger.find(r => r.kind === 'creation-link-source');
  assert.ok(sourceEvidenceRecord);
  assert.equal(sourceEvidenceRecord.bookId, bookId);
  for (const row of initialSourceLedger) {
    const afterRow = postSourceLedger.find(r => r.id === row.id);
    assert.deepEqual(afterRow, row);
  }

  const targetLedger = await f.app.repository.ledger.list(f.targetNovel.id);
  assert.ok(targetLedger.some(r => r.id === `snap_${bookId}_test_1`));
  assert.ok(targetLedger.some(r => r.id === `cca_${bookId}_test_1`));
  assert.ok(targetLedger.some(r => r.kind === 'creation-link-evidence'));

  const forbiddenTargetKinds = ['usage-settlement', 'usage-pending', 'credit-adjustment', 'usage-dispatch', 'creation-commit-receipt'];
  for (const forbiddenKind of forbiddenTargetKinds) {
    const leaked = targetLedger.filter(r => r.kind === forbiddenKind);
    assert.equal(leaked.length, 0);
  }

  const postAccount = await f.app.getAccount('owner');
  assert.equal(postAccount.credits, initialAccount.credits);
  assert.equal(postAccount.spent, initialAccount.spent);

  const postUsageAll = await f.app.summarizeTokenUsage({ userId: 'owner' });
  assert.deepEqual(postUsageAll, initialUsageAll);
  const postUsageTarget = await f.app.summarizeTokenUsage({ userId: 'owner', projectId: f.targetNovel.id });
  assert.deepEqual(postUsageTarget, initialUsageTarget);

  const repeatRes = await f.call(`/api/creation-books/${bookId}/link-novel`, 'POST', {
    novelId: f.targetNovel.id
  });
  assert.equal(repeatRes.status, 200);
  assert.equal(repeatRes.body.idempotent, true);

  const repeatSourceLedger = await f.app.repository.ledger.list(sourceScope);
  assert.equal(repeatSourceLedger.length, initialSourceDepth + 1);

  const repeatTargetLedger = await f.app.repository.ledger.list(f.targetNovel.id);
  assert.equal(repeatTargetLedger.length, targetLedger.length);

  const repeatAccount = await f.app.getAccount('owner');
  assert.equal(repeatAccount.credits, initialAccount.credits);
  assert.equal(repeatAccount.spent, initialAccount.spent);

  const repeatUsageAll = await f.app.summarizeTokenUsage({ userId: 'owner' });
  assert.deepEqual(repeatUsageAll, initialUsageAll);
  const repeatUsageTarget = await f.app.summarizeTokenUsage({ userId: 'owner', projectId: f.targetNovel.id });
  assert.deepEqual(repeatUsageTarget, initialUsageTarget);
});

test('native link-novel: source exclusive partition rejects active runs, completed history, and commit receipts without explicit bookRef', async testContext => {
  const fixture = await createHttpFixture(testContext);

  const activeBookId = 'cb_source_active_nobookref';
  await fixture.call('/api/creation-books', 'POST', {
    creationBookId: activeBookId,
    title: '来源未知运行态无bookRef测试',
    bible: { valid: true }
  });
  const activeScope = `__molan_creation_owner_v1_${hash(JSON.stringify(['owner', activeBookId]))}`;
  await fixture.app.repository.generation.put(activeScope, {
    id: 'run_source_unknown_1',
    kind: 'generation-run-v1',
    projectId: activeScope,
    workspaceId: 'personal',
    actorUserId: 'owner',
    state: 'provider_unknown',
    request: { messages: [{ role: 'user', content: '继续生成' }] }
  }, 0);

  const initialActiveLedger = await fixture.app.repository.ledger.list(activeScope);
  const initialActiveGeneration = await fixture.app.repository.generation.list(activeScope);
  const initialActiveNovels = await fixture.app.repository.novels.list(activeScope);

  const activeLinkRes = await fixture.call(`/api/creation-books/${activeBookId}/link-novel`, 'POST', {
    novelId: fixture.targetNovel.id
  });
  assert.equal(activeLinkRes.status, 409);
  assert.equal(activeLinkRes.body.code, 'CREATION_JOB_ACTIVE');

  const postActiveLedger = await fixture.app.repository.ledger.list(activeScope);
  const postActiveGeneration = await fixture.app.repository.generation.list(activeScope);
  const postActiveNovels = await fixture.app.repository.novels.list(activeScope);
  assert.equal(postActiveLedger.length, initialActiveLedger.length);
  assert.equal(postActiveGeneration.length, initialActiveGeneration.length);
  assert.equal(postActiveNovels.length, initialActiveNovels.length);
  assert.deepEqual(postActiveLedger, initialActiveLedger);
  assert.deepEqual(postActiveGeneration, initialActiveGeneration);
  assert.deepEqual(postActiveNovels, initialActiveNovels);

  const targetBookActive = await fixture.app.repository.novels.get(fixture.targetNovel.id, `creation-book:${activeBookId}`);
  assert.equal(targetBookActive, null);
  const targetBibleActive = await fixture.app.repository.novels.get(fixture.targetNovel.id, `creation-bible:${activeBookId}`);
  assert.equal(targetBibleActive, null);

  const indexActive = await fixture.app.repository.novels.get('__molan_creation_index_v1__', `creation-book:${activeBookId}`);
  assert.equal(indexActive.storageScope, activeScope);
  assert.equal(indexActive.scopeKind, 'owner-book');
  assert.equal(indexActive.projectId, undefined);

  const resolvedActive = await fixture.creationRepo.resolveScope({ userId: 'owner', bookId: activeBookId });
  assert.equal(resolvedActive.storageScope, activeScope);
  assert.equal(resolvedActive.scopeKind, 'owner-book');

  const completedBookId = 'cb_source_completed_nobookref';
  await fixture.call('/api/creation-books', 'POST', {
    creationBookId: completedBookId,
    title: '来源已完成历史无bookRef测试',
    bible: { valid: true }
  });
  const completedScope = `__molan_creation_owner_v1_${hash(JSON.stringify(['owner', completedBookId]))}`;
  await fixture.app.repository.generation.put(completedScope, {
    id: 'run_source_completed_1',
    kind: 'generation-run-v1',
    projectId: completedScope,
    workspaceId: 'personal',
    actorUserId: 'owner',
    state: 'completed',
    finishedAt: Date.now(),
    request: { messages: [{ role: 'user', content: '已完成生成' }] }
  }, 0);

  const initialCompletedLedger = await fixture.app.repository.ledger.list(completedScope);
  const initialCompletedGeneration = await fixture.app.repository.generation.list(completedScope);
  const initialCompletedNovels = await fixture.app.repository.novels.list(completedScope);

  const completedLinkRes = await fixture.call(`/api/creation-books/${completedBookId}/link-novel`, 'POST', {
    novelId: fixture.targetNovel.id
  });
  assert.equal(completedLinkRes.status, 409);
  assert.equal(completedLinkRes.body.code, 'CREATION_HISTORY_MIGRATION_REQUIRED');

  const postCompletedLedger = await fixture.app.repository.ledger.list(completedScope);
  const postCompletedGeneration = await fixture.app.repository.generation.list(completedScope);
  const postCompletedNovels = await fixture.app.repository.novels.list(completedScope);
  assert.equal(postCompletedLedger.length, initialCompletedLedger.length);
  assert.equal(postCompletedGeneration.length, initialCompletedGeneration.length);
  assert.equal(postCompletedNovels.length, initialCompletedNovels.length);
  assert.deepEqual(postCompletedLedger, initialCompletedLedger);
  assert.deepEqual(postCompletedGeneration, initialCompletedGeneration);
  assert.deepEqual(postCompletedNovels, initialCompletedNovels);

  const targetBookCompleted = await fixture.app.repository.novels.get(fixture.targetNovel.id, `creation-book:${completedBookId}`);
  assert.equal(targetBookCompleted, null);
  const targetBibleCompleted = await fixture.app.repository.novels.get(fixture.targetNovel.id, `creation-bible:${completedBookId}`);
  assert.equal(targetBibleCompleted, null);

  const indexCompleted = await fixture.app.repository.novels.get('__molan_creation_index_v1__', `creation-book:${completedBookId}`);
  assert.equal(indexCompleted.storageScope, completedScope);
  assert.equal(indexCompleted.scopeKind, 'owner-book');
  assert.equal(indexCompleted.projectId, undefined);

  const resolvedCompleted = await fixture.creationRepo.resolveScope({ userId: 'owner', bookId: completedBookId });
  assert.equal(resolvedCompleted.storageScope, completedScope);
  assert.equal(resolvedCompleted.scopeKind, 'owner-book');

  const receiptBookId = 'cb_source_receipt_nobookid';
  await fixture.call('/api/creation-books', 'POST', {
    creationBookId: receiptBookId,
    title: '来源回执无bookId测试',
    bible: { valid: true }
  });
  const receiptScope = `__molan_creation_owner_v1_${hash(JSON.stringify(['owner', receiptBookId]))}`;
  await fixture.app.repository.ledger.put(receiptScope, {
    id: 'receipt_without_book_id_1',
    kind: 'creation-commit-receipt',
    actorUserId: 'owner',
    createdAt: Date.now()
  }, 0);

  const initialReceiptLedger = await fixture.app.repository.ledger.list(receiptScope);
  const initialReceiptGeneration = await fixture.app.repository.generation.list(receiptScope);
  const initialReceiptNovels = await fixture.app.repository.novels.list(receiptScope);

  const receiptLinkRes = await fixture.call(`/api/creation-books/${receiptBookId}/link-novel`, 'POST', {
    novelId: fixture.targetNovel.id
  });
  assert.equal(receiptLinkRes.status, 409);
  assert.equal(receiptLinkRes.body.code, 'CREATION_HISTORY_MIGRATION_REQUIRED');

  const postReceiptLedger = await fixture.app.repository.ledger.list(receiptScope);
  const postReceiptGeneration = await fixture.app.repository.generation.list(receiptScope);
  const postReceiptNovels = await fixture.app.repository.novels.list(receiptScope);
  assert.equal(postReceiptLedger.length, initialReceiptLedger.length);
  assert.equal(postReceiptGeneration.length, initialReceiptGeneration.length);
  assert.equal(postReceiptNovels.length, initialReceiptNovels.length);
  assert.deepEqual(postReceiptLedger, initialReceiptLedger);
  assert.deepEqual(postReceiptGeneration, initialReceiptGeneration);
  assert.deepEqual(postReceiptNovels, initialReceiptNovels);

  const targetBookReceipt = await fixture.app.repository.novels.get(fixture.targetNovel.id, `creation-book:${receiptBookId}`);
  assert.equal(targetBookReceipt, null);
  const targetBibleReceipt = await fixture.app.repository.novels.get(fixture.targetNovel.id, `creation-bible:${receiptBookId}`);
  assert.equal(targetBibleReceipt, null);

  const indexReceipt = await fixture.app.repository.novels.get('__molan_creation_index_v1__', `creation-book:${receiptBookId}`);
  assert.equal(indexReceipt.storageScope, receiptScope);
  assert.equal(indexReceipt.scopeKind, 'owner-book');
  assert.equal(indexReceipt.projectId, undefined);

  const resolvedReceipt = await fixture.creationRepo.resolveScope({ userId: 'owner', bookId: receiptBookId });
  assert.equal(resolvedReceipt.storageScope, receiptScope);
  assert.equal(resolvedReceipt.scopeKind, 'owner-book');
});
