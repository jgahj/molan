'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPostgresDissectionMutationService } = require('../services/postgres-dissection-mutation-service');

function fixture(overrides = {}) {
  const calls = [];
  const repository = {
    runtimeListDissections: async () => [],
    runtimeInsertDissection: async record => { calls.push(['insert', record]); },
    runtimeGetDissection: async () => ({ id: 'd_write', owner_user_id: 'owner', status: 'completed' }),
    runtimeDeleteDissection: async () => { calls.push(['delete']); return 1; },
    runtimeListDissectionRows: async () => [
      { row_key: 'first', document: { id: 'first', token: 'first', result: {} } },
      { row_key: 'second', document: { id: 'second', token: 'second', result: {} } }
    ],
    runtimeReplaceDissectionRows: async input => { calls.push(['replace', input]); },
    runtimeDeleteDissectionRow: async (...args) => { calls.push(['delete-row', ...args]); return 1; },
    runtimeDeleteDissectionRows: async () => { throw new Error('non-atomic delete forbidden'); },
    ...overrides.repository
  };
  const dependencies = {
    postgresRepository: repository,
    getAuthUser: () => ({ user: { userId: 'owner', email: 'owner@example.test' } }),
    postgresActor: auth => auth.user.userId,
    readBody: async request => request.body || {},
    json: (response, status, body) => Object.assign(response, { status, body }),
    respondPostgresError: (response, error) => Object.assign(response, { status: error.status || 503, body: { code: error.code || 'pg_error' } }),
    rowToRecord: row => ({ id: row.id, ownerUserId: row.owner_user_id, userEmail: 'owner@example.test', status: row.status, result: {} }),
    publicRecord: record => record,
    computeStats: async () => ({}),
    getActiveDissection: () => null,
    acquireUserSlot: () => { calls.push(['acquire']); return true; },
    releaseUserSlot: () => { calls.push(['release']); },
    scheduleStartDissection: () => { calls.push(['schedule']); },
    normalizeDissectionInput: body => ({ source: String(body.text || ''), sourceFiles: [] }),
    resolveModel: (_user, requested) => { calls.push(['model', requested]); return 'permitted-model'; },
    hasCompleteContent: result => result.complete === true,
    buildDissectionChunks: text => Array.from({ length: 6 }, (_, index) => ({ chapterId: `chapter-${index}`, text })),
    chooseDissectionChunks: chunks => chunks,
    dissectionContext: chunks => chunks.map(chunk => chunk.text).join('\n'),
    dissectionWordCount: text => text.length,
    estimateBillingTokens: () => 1000,
    pipelineEstimatedTokensFor: () => 2000,
    creditCostForUser: () => 2,
    dissectionSkillRecord: () => ({ id: 'dissection' }),
    dissectionSkillPromptFiles: () => [],
    dissectionId: () => 'd_write',
    emptyDissectionResult: () => ({}),
    postgresPipelineStore: {
      initializeDissectionPipeline: async (actor, record) => {
        assert.equal(actor, 'owner');
        assert.equal(calls.some(call => call[0] === 'insert'), true);
        calls.push(['pipeline', record.id]);
      }
    },
    ...overrides.dependencies
  };
  return { service: createPostgresDissectionMutationService(dependencies), calls, repository };
}

test('PG batch reuses native creation, reports invalid inputs and run:false dispatches nothing', async () => {
  let sequence = 0;
  const instance = fixture({ dependencies: { dissectionId: () => 'd_batch_' + (++sequence) } });
  const response = {};
  assert.equal(await instance.service.dispatch({ method: 'POST',
    body: { run: false, tasks: [{ text: '合成批量甲' }, null, { text: '合成批量乙' }] }
  }, response, '/api/dissections/batch'), true);
  assert.equal(response.status, 202);
  assert.equal(response.body.count, 2);
  assert.equal(response.body.errors.length, 1);
  assert.equal(instance.calls.filter(call => call[0] === 'insert').length, 2);
  assert.equal(instance.calls.filter(call => call[0] === 'schedule').length, 0);
});

test('PG batch awaits each owner task instead of dispatching the whole batch concurrently', async () => {
  let sequence = 0;
  const records = new Map();
  const dispatched = [];
  let finishFirst;
  let notifySecond;
  const firstCompletion = new Promise(resolve => { finishFirst = resolve; });
  const secondStarted = new Promise(resolve => { notifySecond = resolve; });
  const instance = fixture({
    repository: {
      runtimeInsertDissection: async record => { records.set(record.id, { ...record, owner_user_id: 'owner' }); },
      runtimeGetDissection: async (_actor, id) => records.get(id),
      runtimeListDissections: async () => [...records.values()]
    },
    dependencies: {
      dissectionId: () => 'd_batch_' + (++sequence),
      scheduleStartDissection: async id => {
        dispatched.push(id);
        if (dispatched.length === 1) await firstCompletion;
        else notifySecond();
        records.get(id).status = 'completed';
      }
    }
  });
  const response = {};
  await instance.service.handleBatch({ body: { tasks: [{ text: '合成甲' }, { text: '合成乙' }] } }, response);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(dispatched, ['d_batch_1']);
  finishFirst();
  await secondStarted;
  assert.deepEqual(dispatched, ['d_batch_1', 'd_batch_2']);
});

test('cancelling an unstarted batch task cannot release another task user slot', async () => {
  const instance = fixture({ repository: {
    runtimeRequestDissectionCancel: async () => ({
      id: 'd_batch', owner_user_id: 'owner', status: 'cancelled', wasQueued: true,
      wasCancelled: true, meta_json: JSON.stringify({ batchQueued: true })
    })
  } });
  const response = {};
  await instance.service.handleCancel({ body: {} }, response, 'd_batch');
  assert.equal(response.status, 200);
  assert.equal(instance.calls.filter(call => call[0] === 'release').length, 0);
});

test('PG creation selects permitted model and inserts parent before deep pipeline initialization', async () => {
  const instance = fixture({ repository: {
    runtimeUpdateDissection: async () => {}
  } });
  const response = {};
  await instance.service.handleCreate({ body: { text: '第一章：有限合成正文', depth: 'deep', run: false, model: 'requested-model' } }, response);
  assert.equal(response.status, 202);
  assert.deepEqual(instance.calls.map(call => call[0]), ['model', 'insert', 'pipeline']);
  assert.equal(response.body.task.selectedModel, 'permitted-model');
  assert.equal(response.body.task.status, 'queued');
});

test('incomplete completed result is never reused as a successful cached dissection', async () => {
  const crypto = require('node:crypto');
  const source = '合成内容';
  const instance = fixture({ repository: {
    runtimeListDissections: async () => [{
      id: 'd_incomplete', status: 'completed', depth: 'quick', purpose: 'new-writer',
      meta_json: JSON.stringify({ sourceHash: crypto.createHash('sha1').update(source).digest('hex') }),
      result_json: '{}'
    }]
  } });
  const response = {};
  await instance.service.handleCreate({ body: { text: source, depth: 'quick', run: false } }, response);
  assert.equal(response.status, 202);
  assert.equal(response.body.cached, undefined);
  assert.equal(response.body.task.status, 'queued');
});

test('PG create failure releases acquired slot without dispatching provider', async () => {
  const instance = fixture({ repository: {
    runtimeInsertDissection: async () => { throw new Error('PG unavailable'); }
  } });
  const response = {};
  await instance.service.handleCreate({ body: { text: 'synthetic' } }, response);
  assert.equal(response.status, 503);
  assert.equal(instance.calls.filter(call => call[0] === 'release').length, 1);
  assert.equal(instance.calls.some(call => call[0] === 'schedule'), false);
});

test('PG JSONB 完整拆书复用保留结果且不重新派发模型', async () => {
  const crypto = require('node:crypto');
  const source = '完整合成内容';
  const result = { complete: true, overview: { summary: '有限合成结果' } };
  const instance = fixture({ repository: {
    runtimeListDissections: async () => [{
      id: 'd_complete', status: 'completed', depth: 'quick', purpose: 'new-writer',
      meta_json: { sourceHash: crypto.createHash('sha1').update(source).digest('hex') },
      result_json: result
    }]
  } });
  const response = {};
  await instance.service.handleCreate({ headers: {}, body: { text: source, depth: 'quick' } }, response);
  assert.equal(response.status, 202);
  assert.equal(response.body.cached, true);
  assert.deepEqual(instance.calls.find(call => call[0] === 'insert')[1].result, result);
  assert.equal(instance.calls.some(call => call[0] === 'schedule'), false);
});

test('missing deep pipeline fails closed and releases the slot', async () => {
  const instance = fixture({ dependencies: { postgresPipelineStore: null } });
  const response = {};
  await instance.service.handleCreate({ body: { text: 'synthetic', depth: 'deep' } }, response);
  assert.equal(response.status, 503);
  assert.equal(instance.calls.filter(call => call[0] === 'release').length, 1);
  assert.equal(instance.calls.some(call => call[0] === 'insert' || call[0] === 'schedule'), false);
});

test('delete denied by PG visibility never aborts a local worker', async () => {
  const controller = new AbortController();
  const instance = fixture({
    repository: { runtimeGetDissection: async () => null },
    dependencies: { getActiveDissection: () => ({ controller }) }
  });
  const response = {};
  await instance.service.handleDelete({}, response, 'd_write');
  assert.equal(response.status, 404);
  assert.equal(controller.signal.aborted, false);
  assert.equal(instance.calls.some(call => call[0] === 'delete'), false);
});

test('failed durable deletion never aborts or confirms success', async () => {
  const controller = new AbortController();
  const instance = fixture({
    repository: { runtimeDeleteDissection: async () => { throw new Error('PG unavailable'); } },
    dependencies: { getActiveDissection: () => ({ controller }) }
  });
  const response = {};
  await instance.service.handleDelete({}, response, 'd_write');
  assert.equal(response.status, 503);
  assert.equal(controller.signal.aborted, false);
});

test('version and share revocation delete only the target row without replacing concurrent rows', async () => {
  const instance = fixture();
  const response = {};
  await instance.service.handleVersion({ method: 'DELETE' }, response, 'd_write', 'first');
  assert.equal(response.status, 200);
  await instance.service.handleShareDelete({}, response, 'd_write', 'first');
  assert.equal(response.status, 200);
  assert.deepEqual(instance.calls.filter(call => call[0] === 'delete-row'), [
    ['delete-row', 'owner', 'd_write', 'dissection_versions', 'first'],
    ['delete-row', 'owner', 'd_write', 'dissection_shares', 'first']
  ]);
  assert.equal(instance.calls.some(call => call[0] === 'replace'), false);
});

test('legacy singular dissection management routes are handled by the PG service', async () => {
  const instance = fixture();
  for (const suffix of ['versions/first', 'share/first']) {
    const response = {};
    const handled = await instance.service.dispatch({ method: 'DELETE' }, response, `/api/dissection/d_write/${suffix}`);
    assert.equal(handled, true);
    assert.equal(response.status, 200);
  }
});
