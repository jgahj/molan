'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { JsonFileRepository } = require('../lib/repositories/json-file-repository');
const { JsonAppRepository } = require('../lib/repositories/json-app-repository');
const { createMemoryStore } = require('../lib/memory-store');

async function fixture(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-memory-safety-'));
  const author = { userId: 'author', email: 'author@memory-safety.test' };
  const bookId = `n_memory${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
  let repository = new JsonFileRepository(directory);
  let app = new JsonAppRepository(directory, { repository });
  let store = createMemoryStore({ repository, getAccess: input => app.getAccess(input) });

  await app.saveAccount(author);
  await app.create({ id: bookId, user: author, state: { title: '提交安全测试', volumes: [] } });

  const harness = {
    directory,
    scope: { userId: author.userId, bookId },
    get repository() { return repository; },
    get app() { return app; },
    get store() { return store; },
    async reopen(options = {}) {
      await store.close();
      await repository.close();
      repository = new JsonFileRepository(directory, options);
      app = new JsonAppRepository(directory, { repository });
      store = createMemoryStore({ repository, getAccess: input => app.getAccess(input) });
      return harness;
    },
    async createBook() {
      const id = `n_memory${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
      await app.create({ id, user: author, state: { title: '隔离测试', volumes: [] } });
      return id;
    }
  };

  context.after(async () => {
    await store.close();
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return harness;
}

async function proposal(store, scope, overrides = {}) {
  const input = {
    ...scope,
    baseStateVersion: 1,
    operations: [{ type: 'STATE_TRANSITION', payload: { entityId: 'sword', preState: 'sheathed', postState: 'sister' } }],
    ...overrides,
    branchId: overrides.branchId || scope.branchId || 'main'
  };
  const candidate = await store.createChangeset(input);
  await store.approveChangeset({ ...scope, branchId: input.branchId, changesetId: candidate.id });
  return candidate;
}

/** 验证原生异步接口以指定业务错误码拒绝请求。 */
async function rejectsCode(promise, code) {
  await assert.rejects(promise, { code });
}

test('同一分支旧基线只能提交一次，其他分支独立推进', async context => {
  const fixtureState = await fixture(context);
  const first = await proposal(fixtureState.store, fixtureState.scope);
  const stale = await proposal(fixtureState.store, fixtureState.scope);
  assert.equal((await fixtureState.store.commitChangeset({ ...fixtureState.scope, changesetId: first.id })).stateVersion, 2);
  await rejectsCode(fixtureState.store.commitChangeset({ ...fixtureState.scope, changesetId: stale.id }), 'MEMORY_VERSION_CONFLICT');
  const alternate = await proposal(fixtureState.store, { ...fixtureState.scope, branchId: 'alternate' });
  assert.equal((await fixtureState.store.commitChangeset({ ...fixtureState.scope, branchId: 'alternate', changesetId: alternate.id })).stateVersion, 2);
  const memoryState = await fixtureState.repository.memory.get(fixtureState.scope.bookId, `memory:${fixtureState.scope.bookId}`);
  assert.equal(Object.values(memoryState.branches).reduce((count, branch) => count + branch.outbox.length, 0), 2);
});

test('审批绑定全部变更，确认后篡改被拒绝', async context => {
  const fixtureState = await fixture(context);
  const candidate = await proposal(fixtureState.store, fixtureState.scope);
  await fixtureState.repository.transaction([fixtureState.scope.bookId], tx => {
    const state = tx.get(fixtureState.scope.bookId, 'memory', `memory:${fixtureState.scope.bookId}`);
    state.branches.main.changesets[candidate.id].candidateHash = 'changed';
    tx.put(fixtureState.scope.bookId, 'memory', state, state.revision);
  });
  await rejectsCode(fixtureState.store.commitChangeset({ ...fixtureState.scope, changesetId: candidate.id }), 'APPROVAL_STALE');
  assert.equal((await fixtureState.store.getRecords({ ...fixtureState.scope, type: 'transition' })).length, 0);
});

test('幂等回执可恢复，同键不同请求拒绝', async context => {
  const fixtureState = await fixture(context);
  const first = await proposal(fixtureState.store, fixtureState.scope);
  const options = { idempotencyKey: 'request-1' };
  const receipt = await fixtureState.store.commitChangeset({ ...fixtureState.scope, changesetId: first.id, ...options });
  const replay = await fixtureState.store.commitChangeset({ ...fixtureState.scope, changesetId: first.id, ...options });
  assert.deepEqual(replay, { ...receipt, replayed: true });
  const second = await proposal(fixtureState.store, fixtureState.scope, { baseStateVersion: 2 });
  await rejectsCode(fixtureState.store.commitChangeset({ ...fixtureState.scope, changesetId: second.id, ...options }), 'IDEMPOTENCY_CONFLICT');
  assert.equal((await fixtureState.store.commitChangeset({ ...fixtureState.scope, changesetId: first.id, idempotencyKey: 'alias' })).replayed, true);
  await rejectsCode(fixtureState.store.commitChangeset({ ...fixtureState.scope, changesetId: second.id, idempotencyKey: 'alias' }), 'IDEMPOTENCY_CONFLICT');
});

test('未知操作与未满足依赖不能被静默提交', async context => {
  const fixtureState = await fixture(context);
  const unknown = await proposal(fixtureState.store, fixtureState.scope, { operations: [{ type: 'DELETE_ALL', payload: {} }] });
  await rejectsCode(fixtureState.store.commitChangeset({ ...fixtureState.scope, changesetId: unknown.id }), 'INVALID_MEMORY_OPERATION');
  const dependent = await proposal(fixtureState.store, fixtureState.scope, { dependencies: ['missing'] });
  await rejectsCode(fixtureState.store.commitChangeset({ ...fixtureState.scope, changesetId: dependent.id }), 'CHANGESET_DEPENDENCY_MISSING');
});

test('正式事实不可跨作品引用命题', async context => {
  const fixtureState = await fixture(context);
  const otherBookId = await fixtureState.createBook();
  const otherStore = createMemoryStore({ repository: fixtureState.repository, getAccess: input => fixtureState.app.getAccess(input) });
  const foreign = await otherStore.extract({ userId: fixtureState.scope.userId, bookId: otherBookId, text: '密信藏在井沿下。' });
  const candidate = await proposal(fixtureState.store, fixtureState.scope, {
    operations: [{ type: 'INSERT_FACT', payload: { propositionId: foreign.propositions[0].id } }]
  });
  await rejectsCode(fixtureState.store.commitChangeset({ ...fixtureState.scope, changesetId: candidate.id }), 'MEMORY_REFERENCE_INVALID');
  assert.equal((await fixtureState.store.getRecords({ ...fixtureState.scope, type: 'fact' })).length, 0);
});

test('原生 JSON 提交的日志发布失败回滚记忆、版本、回执和outbox', async context => {
  const fixtureState = await fixture(context);
  const candidate = await proposal(fixtureState.store, fixtureState.scope);
  let failJournalRename = false;
  let failingRepository;
  const injectedFs = Object.create(fs);
  injectedFs.renameSync = (temporary, destination) => {
    if (failJournalRename && destination === failingRepository.journalPath) {
      failJournalRename = false;
      throw Object.assign(new Error('fixture failure'), { code: 'EIO' });
    }
    return fs.renameSync(temporary, destination);
  };
  await fixtureState.reopen({ fs: injectedFs });
  failingRepository = fixtureState.repository;
  failJournalRename = true;
  await rejectsCode(fixtureState.store.commitChangeset({ ...fixtureState.scope, changesetId: candidate.id }), 'EIO');
  assert.equal(failJournalRename, false);
  assert.equal((await fixtureState.store.workbenchState(fixtureState.scope)).stateVersion, 1);
  assert.equal((await fixtureState.store.getRecords({ ...fixtureState.scope, type: 'transition' })).length, 0);
  const persisted = await fixtureState.repository.memory.get(fixtureState.scope.bookId, `memory:${fixtureState.scope.bookId}`);
  const branch = persisted.branches.main;
  assert.equal(branch.stateVersion, 1);
  assert.equal(branch.receipts && Object.keys(branch.receipts).length || 0, 0);
  assert.equal(branch.outbox.length, 0);
  assert.equal(branch.changesets[candidate.id].committedAt, undefined);
  assert.equal((await fixtureState.store.commitChangeset({ ...fixtureState.scope, changesetId: candidate.id })).stateVersion, 2);
});

test('自动生成ID必须写入流水，重复ID不覆盖已确认历史', async context => {
  const fixtureState = await fixture(context);
  const extracted = await fixtureState.store.extract({ ...fixtureState.scope, text: '主角推开石门，门后摆着一只木箱。' });
  const propositionId = extracted.propositions[0].id;
  const candidate = await proposal(fixtureState.store, fixtureState.scope, {
    operations: [{ type: 'INSERT_FACT', payload: { propositionId } }]
  });
  assert.equal((await fixtureState.store.commitChangeset({ ...fixtureState.scope, changesetId: candidate.id })).ok, true);
  const log = (await fixtureState.store.listOperations(fixtureState.scope)).find(operation => operation.changesetId === candidate.id);
  assert.ok(log.recordId);
  const committed = (await fixtureState.store.getRecords({ ...fixtureState.scope, type: 'fact' })).find(record => record.id === log.recordId);
  assert.equal(committed.id, log.recordId);
  assert.equal(committed.verdict, 'true');
  const replacement = await proposal(fixtureState.store, fixtureState.scope, {
    baseStateVersion: 2,
    operations: [{ type: 'INSERT_FACT', payload: { id: log.recordId, propositionId, verdict: 'false' } }]
  });
  await rejectsCode(fixtureState.store.commitChangeset({ ...fixtureState.scope, changesetId: replacement.id }), 'MEMORY_RECORD_EXISTS');
  const unchanged = (await fixtureState.store.getRecords({ ...fixtureState.scope, type: 'fact' })).find(record => record.id === log.recordId);
  assert.equal(unchanged.verdict, 'true');
});

test('重复初始化保留版本，提交后重审批和变更请求被拒绝', async context => {
  const fixtureState = await fixture(context);
  const candidate = await proposal(fixtureState.store, fixtureState.scope);
  assert.equal((await fixtureState.store.commitChangeset({ ...fixtureState.scope, changesetId: candidate.id })).ok, true);
  await fixtureState.reopen();
  await rejectsCode(fixtureState.store.approveChangeset({ ...fixtureState.scope, changesetId: candidate.id }), 'CHANGESET_ALREADY_COMMITTED');
  await rejectsCode(fixtureState.store.commitChangeset({
    ...fixtureState.scope, changesetId: candidate.id, idempotencyKey: 'new-key', candidateHash: 'changed'
  }), 'IDEMPOTENCY_CONFLICT');
  const next = await proposal(fixtureState.store, fixtureState.scope, { baseStateVersion: 2 });
  assert.equal((await fixtureState.store.commitChangeset({ ...fixtureState.scope, changesetId: next.id })).stateVersion, 3);
});

test('同作品其他分支的命题不能被正式引用', async context => {
  const fixtureState = await fixture(context);
  const extracted = await fixtureState.store.extract({ ...fixtureState.scope, branchId: 'other', text: '密信藏在井沿下。' });
  const candidate = await proposal(fixtureState.store, fixtureState.scope, {
    operations: [{ type: 'INSERT_COGNITION', payload: { targetExpressionId: extracted.propositions[0].id, holderEntityId: 'hero' } }]
  });
  await rejectsCode(fixtureState.store.commitChangeset({ ...fixtureState.scope, changesetId: candidate.id }), 'MEMORY_REFERENCE_INVALID');
});
