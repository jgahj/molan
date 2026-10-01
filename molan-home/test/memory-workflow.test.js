'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const workflow = require('../lib/memory-workflow');
const { JsonCreationRepository } = require('../lib/repositories/json-creation-repository');
const { createNativeMemoryFixture: fixture } = require('./helpers/native-memory-fixture');

async function manuscriptFixture(context) {
  const f = await fixture(context);
  await f.app.saveCAS({
    userId: f.scope.userId,
    projectId: f.scope.projectId,
    expectedRevision: 0,
    state: {
      title: '工作流合同',
      volumes: [{ id: 'volume', chapters: [{
        id: 'chapter', title: '第一章', scenes: [{ id: 'scene', content: '旧稿' }]
      }] }]
    }
  });
  return f;
}

async function saveReviewed(f, text = '师妹收下玉佩。') {
  const novel = await f.repository.novels.get(f.scope.projectId, f.scope.projectId);
  const draft = await f.store.saveManuscript({
    ...f.scope, chapterId: 'chapter', sceneId: 'scene', text,
    expectedRevision: 0, expectedNovelRevision: novel.contentRevision
  });
  const review = await f.store.rewrite({
    ...f.scope, manuscriptRevisionId: draft.id, contract: { bookId: f.scope.bookId }
  });
  assert.equal(review.compliant, true);
  return { draft, rewriteReviewId: review.review.id };
}

async function createBoundChangeset(f, source, operations = []) {
  const state = await f.store.workbenchState(f.scope);
  return f.store.createChangeset({
    ...f.scope,
    baseStateVersion: state.stateVersion,
    manuscriptRevisionId: source.draft.id,
    rewriteReviewId: source.rewriteReviewId,
    operations
  });
}

test('分支 head 命中时不扫描历史 changeset，旧数据仍从历史恢复版本', () => {
  let historyScanned = false;
  const currentDb = {
    prepare() {
      return {
        get: () => ({ state_version: 8 }),
        all: () => { historyScanned = true; throw new Error('history must not be scanned'); }
      };
    }
  };
  assert.equal(workflow.stateVersion(currentDb, 'book'), 8);
  assert.equal(historyScanned, false);

  const legacyDb = {
    prepare() {
      return {
        get: () => null,
        all: () => [{ base_state_version: 4 }, { base_state_version: '8' }, { base_state_version: null }]
      };
    }
  };
  assert.equal(workflow.stateVersion(legacyDb, 'book'), 9);
});

test('正文候选与正式稿分离，审批后同事务正式采纳', async context => {
  const f = await manuscriptFixture(context);
  const source = await saveReviewed(f);
  assert.equal(source.draft.contentHash, require('../lib/memory-system').computeTextHash('师妹收下玉佩。'));
  assert.ok((await f.repository.novels.get(f.scope.projectId, f.scope.projectId)).state.volumes[0].chapters[0].scenes[0].content.includes('旧稿'));

  const changeset = await createBoundChangeset(f, source);
  await assert.rejects(f.store.commitChangeset({ ...f.scope, changesetId: changeset.id }), { code: 'changeset_not_approved' });
  await f.store.approveChangeset({ ...f.scope, changesetId: changeset.id });
  const receipt = await f.store.commitChangeset({ ...f.scope, changesetId: changeset.id });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.manuscriptRevisionId, source.draft.id);
  const novel = await f.repository.novels.get(f.scope.projectId, f.scope.projectId);
  assert.ok(novel.state.volumes[0].chapters[0].scenes[0].content.includes('师妹收下玉佩'));
  assert.equal(novel.contentRevision, 2);
  assert.equal((await f.store.commitChangeset({ ...f.scope, changesetId: changeset.id })).replayed, true);
});

test('保存新候选或修改来源正文后，旧确认不能采纳', async context => {
  const f = await manuscriptFixture(context);
  const source = await saveReviewed(f);
  const changeset = await createBoundChangeset(f, source);
  await f.store.approveChangeset({ ...f.scope, changesetId: changeset.id });
  const novel = await f.repository.novels.get(f.scope.projectId, f.scope.projectId);
  await f.store.saveManuscript({
    ...f.scope, chapterId: 'chapter', sceneId: 'scene', text: '新候选',
    expectedRevision: 1, expectedNovelRevision: novel.contentRevision
  });
  await assert.rejects(f.store.commitChangeset({ ...f.scope, changesetId: changeset.id }), { code: 'CONTENT_VERSION_CONFLICT' });
});

test('配置 authority 快照自动使旧审批失效', async context => {
  const cases = [
    {
      name: '文风 active/revision',
      setup: async f => {
        await f.style.upsertStyleProfile({ ...f.scope, id: 'workflow-style', hardRules: ['初版规则'] });
        return () => f.style.upsertStyleProfile({ ...f.scope, id: 'workflow-style', expectedRevision: 1, hardRules: ['修订规则'] });
      }
    },
    {
      name: '资料 status/revision',
      setup: async f => {
        const saved = await f.app.saveResource({
          userId: f.scope.userId, projectId: f.scope.projectId, id: 'workflow-character', kind: 'character',
          payload: { name: '师妹' }, expectedRevision: 0
        });
        return () => f.app.deleteResource({
          userId: f.scope.userId, projectId: f.scope.projectId,
          id: 'workflow-character', expectedRevision: saved.resource.revision
        });
      }
    },
    {
      name: 'disclosure 完整记录',
      setup: async f => {
        const extracted = await f.store.extract({ ...f.scope, text: '密室钥匙在假山下。' });
        await f.commit([{
          type: 'SET_DISCLOSURE',
          payload: { id: 'workflow-disclosure', targetInfoId: extracted.propositions[0].id, policyType: 'imply', allowedClues: ['旧线索'] }
        }]);
        return () => f.repository.transaction([f.scope.projectId], tx => {
          const state = tx.get(f.scope.projectId, 'memory', `memory:${f.scope.bookId}`);
          state.branches.main.records['workflow-disclosure'].allowedClues = ['新线索'];
          tx.put(f.scope.projectId, 'memory', state, state.revision);
        });
      }
    },
    {
      name: 'creation Bible',
      setup: async f => {
        const creation = new JsonCreationRepository(f.app);
        const bookId = 'workflow-creation-book';
        await creation.create({
          userId: f.scope.userId, projectId: f.scope.projectId, bookId,
          title: '工作流合同', plan: { totalChapters: 1 }, payload: { premise: '初始设定' }
        });
        return () => creation.saveBibleCAS({
          userId: f.scope.userId, projectId: f.scope.projectId, bookId,
          expectedVersion: 1, payload: { premise: '修订设定' }
        });
      }
    },
    {
      name: 'creation plan/currentState',
      setup: async f => {
        const creation = new JsonCreationRepository(f.app);
        const bookId = 'workflow-plan-book';
        await creation.create({
          userId: f.scope.userId, projectId: f.scope.projectId, bookId,
          title: '工作流合同', plan: { totalChapters: 1 }, payload: { premise: '初始设定' }
        });
        return () => f.repository.transaction([f.scope.projectId], tx => {
          const recordId = `creation-book:${bookId}`;
          const book = tx.get(f.scope.projectId, 'novels', recordId);
          book.plan = { ...book.plan, totalChapters: 2 };
          book.currentStateVersion++;
          tx.put(f.scope.projectId, 'novels', book, book.revision);
        });
      }
    }
  ];

  for (const scenario of cases) {
    await context.test(scenario.name, async nestedContext => {
      const f = await manuscriptFixture(nestedContext);
      const mutateConfiguration = await scenario.setup(f);
      const source = await saveReviewed(f);
      const changeset = await createBoundChangeset(f, source);
      await f.store.approveChangeset({ ...f.scope, changesetId: changeset.id });
      await mutateConfiguration();
      await assert.rejects(
        f.store.commitChangeset({ ...f.scope, changesetId: changeset.id }),
        { code: 'CONFIG_VERSION_CONFLICT' }
      );
    });
  }
});

test('精确锚点保留空白、emoji 与重复引文位置，提取不自动确立真相', async context => {
  const f = await manuscriptFixture(context);
  const text = '  😀他来了。\r\n他来了。';
  const source = await saveReviewed(f, text);
  const extracted = await f.store.extract({ ...f.scope, manuscriptRevisionId: source.draft.id });
  const anchors = extracted.evidence.map(record => record.sourceAnchor);
  assert.equal(anchors[0].contentHash, require('../lib/memory-system').computeTextHash(text));
  for (const anchor of anchors) {
    assert.equal(text.slice(anchor.startOffset, anchor.endOffset), anchor.quote);
    assert.equal(anchor.offsetUnit, 'utf16');
  }
  assert.ok(anchors[1].startOffset > anchors[0].startOffset);
  assert.equal((await f.store.getMemory({ ...f.scope, status: 'all' })).length, 0);
  assert.equal((await f.store.extract({ ...f.scope, manuscriptRevisionId: source.draft.id })).evidence[0].id, extracted.evidence[0].id);
});

test('投影消费可重放且检测同版本漂移，不覆盖外部修改', async context => {
  const f = await manuscriptFixture(context);
  const source = await saveReviewed(f);
  const changeset = await createBoundChangeset(f, source);
  await f.store.approveChangeset({ ...f.scope, changesetId: changeset.id });
  await f.store.commitChangeset({ ...f.scope, changesetId: changeset.id });
  assert.equal((await f.store.getProjections(f.scope)).synced, false);
  assert.equal((await f.store.processProjections(f.scope)).status, 'SYNCED');
  assert.equal((await f.store.processProjections(f.scope)).status, 'SYNCED');
  await f.repository.transaction([f.scope.projectId], tx => {
    const state = tx.get(f.scope.projectId, 'memory', `memory:${f.scope.bookId}`);
    state.branches.main.projection.payload = {};
    tx.put(f.scope.projectId, 'memory', state, state.revision);
  });
  assert.equal((await f.store.getProjections(f.scope)).status, 'PROJECTION_DRIFT');
  assert.equal((await f.store.processProjections(f.scope)).status, 'PROJECTION_DRIFT');
  assert.deepEqual((await f.state()).branches.main.projection.payload, {});
});

test('正文、memory 变更集与 outbox 故障时一同回滚', async context => {
  const f = await manuscriptFixture(context);
  const source = await saveReviewed(f);
  const changeset = await createBoundChangeset(f, source);
  await f.store.approveChangeset({ ...f.scope, changesetId: changeset.id });

  let failCommit = false;
  const repository = Object.create(f.repository);
  repository.transaction = (scopes, callback, expectedRevisions) => f.repository.transaction(scopes, async tx => {
    const result = await callback(tx);
    if (failCommit) {
      failCommit = false;
      throw new Error('outbox fixture failure');
    }
    return result;
  }, expectedRevisions);
  const failingStore = require('../lib/memory-store').createMemoryStore({
    repository, getAccess: input => f.app.getAccess(input)
  });

  failCommit = true;
  await assert.rejects(
    failingStore.commitChangeset({ ...f.scope, changesetId: changeset.id }),
    /outbox fixture failure/
  );
  const novel = await f.repository.novels.get(f.scope.projectId, f.scope.projectId);
  assert.ok(novel.state.volumes[0].chapters[0].scenes[0].content.includes('旧稿'));
  const state = await f.state();
  assert.equal(state.branches.main.changesets[changeset.id].committedAt, undefined);
  assert.equal(state.branches.main.outbox.some(job => job.eventId === changeset.id), false);
});
