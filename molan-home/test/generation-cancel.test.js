'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const store = require('../lib/generation/sqlite-store');
const { createGenerationOrchestrator } = require('../lib/generation/orchestrator');

/** 创建用于控制异步阶段时序的测试门闩。 */
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

/** 在内存 SQLite 中创建一条待运行任务。 */
function createRun(db, id) {
  const scope = { workspaceId: 'ws-cancel', projectId: 'project-cancel', actorUserId: 'author-cancel' };
  const request = {
    projectId: scope.projectId, chapterId: 'chapter_1', genre: 'fantasy', style: 'direct',
    chapterContract: { chapterId: 'chapter_1', chapterNo: 1, chapterGoal: '推进事件', scenes: [{ id: 'scene_1' }] }
  };
  const created = store.createRun(db, {
    ...scope, id, chapterId: request.chapterId, idempotencyKey: `key-${id}`,
    requestHash: 'a'.repeat(64), request
  }).run;
  return { scope, request, created };
}

/** 提供无需外部服务即可运行到 Provider 边界的依赖。 */
function baseDependencies() {
  return {
    resolveGenre: async request => ({ status: 'resolved', genre: request.genre }),
    resolveStyle: async request => ({ status: 'resolved', style: request.style }),
    loadAuthoritativeContext: async () => ({ ok: true, storyContext: {}, snapshotHash: 'snapshot-1' }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 'snapshot-1' })
  };
}

test('cancellation before the Provider boundary is terminally cancelled and idempotent', async () => {
  const db = new DatabaseSync(':memory:');
  store.ensureSqliteSchema(db);
  const { scope, created } = createRun(db, 'cancel-before-provider');
  const resolving = deferred();
  const entered = deferred();
  const orchestrator = createGenerationOrchestrator({
    store, db,
    dependencies: {
      ...baseDependencies(),
      resolveStyle: async () => { entered.resolve(); await resolving.promise; return { status: 'resolved', style: 'direct' }; }
    }
  });
  try {
    const running = orchestrator.execute(scope, created.id);
    await entered.promise;
    const first = await orchestrator.cancel({ ...scope, id: created.id });
    const repeated = await orchestrator.cancel({ ...scope, id: created.id });
    assert.equal(first.state, 'cancel_requested');
    assert.equal(repeated.state, 'cancel_requested');
    resolving.resolve();
    assert.equal((await running).state, 'cancelled');
  } finally {
    resolving.resolve();
    db.close();
  }
});

test('cancellation after a Provider request starts becomes provider_unknown without retry', async () => {
  const db = new DatabaseSync(':memory:');
  store.ensureSqliteSchema(db);
  const { scope, created } = createRun(db, 'cancel-after-provider');
  const entered = deferred();
  const orchestrator = createGenerationOrchestrator({
    store, db,
    dependenciesForRun: executionContext => ({
      ...baseDependencies(),
      writer: ({ signal }) => new Promise((resolve, reject) => {
        executionContext.onProviderStart();
        entered.resolve();
        const abort = () => reject(signal.reason || new Error('aborted'));
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      })
    })
  });
  try {
    const running = orchestrator.execute(scope, created.id);
    await entered.promise;
    assert.equal((await orchestrator.cancel({ ...scope, id: created.id })).state, 'cancel_requested');
    const finalRun = await running;
    assert.equal(finalRun.state, 'provider_unknown');
    assert.equal(finalRun.errorCode, 'PROVIDER_UNKNOWN');
    assert.equal((await orchestrator.execute(scope, created.id)).state, 'provider_unknown');
  } finally {
    db.close();
  }
});
