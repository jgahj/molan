'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPostgresDissectionMutationService } = require('../services/postgres-dissection-mutation-service');
const { createPostgresRepository } = require('../lib/postgres-repository');

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
    writeHead(code, headers = {}) {
      this.statusCode = code;
      Object.assign(this.headers, headers);
      return this;
    },
    end(data) {
      this.body = data;
      this.ended = true;
      return this;
    }
  };
}

function createHarness(options = {}) {
  const repositoryCalls = [];

  const defaultRow = {
    id: 'd_test-mutation-1',
    owner_user_id: 'actor-1',
    user_email: 'author@example.test',
    title: '原小说标题',
    source_type: 'text',
    source_name: '第一章',
    source_text: '正文样本内容',
    depth: 'standard',
    purpose: 'new-writer',
    selected_model: 'deepseek-v4-flash',
    status: 'running',
    phase: 'extract',
    phase_index: 1,
    progress: 30,
    estimated_credits: null,
    actual_credits: null,
    result_json: JSON.stringify({}),
    meta_json: JSON.stringify({
      tags: ['原标签'],
      folder: '原文件夹',
      pipeline: { unitTotal: 10, unitCompleted: 3 }
    }),
    revision: 1,
    error: '',
    cancel_requested: false,
    created_at_value: 1700000000000,
    updated_at_value: 1700000050000
  };

  const repository = {
    async runtimePatchDissectionMetadata(actorUserId, dissectionId, patchInput) {
      repositoryCalls.push(['runtimePatchDissectionMetadata', actorUserId, dissectionId, patchInput]);
      if (options.patchError) {
        throw options.patchError;
      }
      if (options.patchRow !== undefined) {
        return options.patchRow;
      }
      return {
        ...defaultRow,
        title: patchInput.title !== undefined ? String(patchInput.title).trim() : defaultRow.title,
        revision: Number(defaultRow.revision) + 1
      };
    }
  };

  const rowToRecord = row => {
    let result = {}, meta = {};
    try { result = JSON.parse(row.result_json || '{}'); } catch (_) {}
    try { meta = JSON.parse(row.meta_json || '{}'); } catch (_) {}
    return {
      id: row.id,
      userEmail: row.user_email,
      ownerUserId: row.owner_user_id || 'stable:usr',
      title: row.title,
      sourceType: row.source_type,
      sourceName: row.source_name,
      sourceText: row.source_text,
      depth: row.depth,
      purpose: row.purpose,
      selectedModel: row.selected_model,
      status: row.status,
      phase: row.phase,
      phaseIndex: Number(row.phase_index) || 0,
      progress: Number(row.progress) || 0,
      estimatedCredits: row.estimated_credits === null ? null : Number(row.estimated_credits),
      actualCredits: row.actual_credits === null ? null : Number(row.actual_credits),
      result,
      meta,
      revision: Number(row.revision) || 0,
      error: row.error || '',
      cancelRequested: Boolean(row.cancel_requested),
      createdAt: Number(row.created_at_value || row.created_at) || 0,
      updatedAt: Number(row.updated_at_value || row.updated_at) || 0
    };
  };

  const publicRecord = (record, includeResult = true, pipelineStats) => {
    if (!record) return null;
    const meta = record.meta && typeof record.meta === 'object' ? record.meta : {};
    const pipeline = meta.pipeline ? { ...meta.pipeline, ...pipelineStats } : pipelineStats;
    return {
      id: record.id,
      title: record.title,
      sourceType: record.sourceType,
      sourceName: record.sourceName,
      depth: record.depth,
      purpose: record.purpose,
      selectedModel: record.selectedModel,
      status: record.status,
      phase: record.phase,
      phaseIndex: record.phaseIndex,
      progress: record.progress,
      estimatedCredits: record.estimatedCredits,
      actualCredits: record.actualCredits,
      tags: meta.tags || [],
      folder: meta.folder || '',
      pipeline,
      isComplete: record.status === 'completed',
      revision: record.revision
    };
  };

  const computeStats = async (actorUserId, dissectionId, record) => {
    if (options.computeStatsError) {
      throw options.computeStatsError;
    }
    return options.mockStats || {
      unitTotal: 10,
      unitCompleted: 3,
      factCoverage: 0.3,
      entities: 5,
      candidates: 1
    };
  };

  const service = createPostgresDissectionMutationService({
    postgresRepository: repository,
    readBody: async request => {
      if (options.readBodyError) {
        throw options.readBodyError;
      }
      return options.mockBody !== undefined ? options.mockBody : request.body;
    },
    getAuthUser: request => request.auth || null,
    postgresActor: auth => String(auth && auth.user && auth.user.userId || '').trim(),
    json: (response, status, body) => {
      response.statusCode = status;
      response.body = body;
      return body;
    },
    respondPostgresError: (response, error) => {
      response.statusCode = Number(error && error.status) || 500;
      response.body = { error: error && error.message || '操作失败', code: error && error.code || 'internal_error' };
      return response.body;
    },
    rowToRecord,
    publicRecord,
    computeStats
  });

  const createRequest = (pathname, method = 'PATCH', authUser = { userId: 'actor-1', email: 'author@example.test' }, body = {}) => ({
    url: pathname,
    method,
    auth: authUser ? { user: authUser } : null,
    body
  });

  return {
    repository,
    repositoryCalls,
    defaultRow,
    service,
    createRequest
  };
}

function createFakePostgresPool(queryHandler) {
  return function MockPool() {
    return {
      async connect() {
        return {
          async query(sqlStatement, parameters = []) {
            return queryHandler(sqlStatement, parameters);
          },
          release() {}
        };
      },
      async end() {}
    };
  };
}

test('POSTGRES MUTATION: anonymous patch request returns 401', async () => {
  const testHarness = createHarness();
  const request = testHarness.createRequest('/api/dissections/d_test-mutation-1', 'PATCH', null, { title: '新标题' });
  const response = createMockResponse();

  const dispatched = await testHarness.service.dispatch(request, response, '/api/dissections/d_test-mutation-1');
  assert.equal(dispatched, true);
  assert.equal(response.statusCode, 401);
  assert.equal(response.body.error, '请先登录');
});

test('POSTGRES MUTATION: invalid JSON body returns 400', async () => {
  const invalidError = new Error('请求体不是合法 JSON');
  invalidError.status = 400;
  const testHarness = createHarness({ readBodyError: invalidError });
  const request = testHarness.createRequest('/api/dissections/d_test-mutation-1', 'PATCH');
  const response = createMockResponse();

  const dispatched = await testHarness.service.dispatch(request, response, '/api/dissections/d_test-mutation-1');
  assert.equal(dispatched, true);
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, '请求体不是合法 JSON');
});

test('POSTGRES MUTATION: non-object body returns 400', async () => {
  const testHarness = createHarness({ mockBody: 'invalid-string-body' });
  const request = testHarness.createRequest('/api/dissections/d_test-mutation-1', 'PATCH');
  const response = createMockResponse();

  const dispatched = await testHarness.service.dispatch(request, response, '/api/dissections/d_test-mutation-1');
  assert.equal(dispatched, true);
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, '请求体必须是 JSON 对象');
});

test('POSTGRES MUTATION: task not found or cross-owner returns 404', async () => {
  const notFoundError = new Error('拆书任务不存在或无权修改');
  notFoundError.status = 404;
  notFoundError.code = 'not_found';
  const testHarness = createHarness({ patchError: notFoundError });
  const request = testHarness.createRequest('/api/dissections/d_missing-task', 'PATCH', { userId: 'actor-1', email: 'author@example.test' }, { title: '新标题' });
  const response = createMockResponse();

  const dispatched = await testHarness.service.dispatch(request, response, '/api/dissections/d_missing-task');
  assert.equal(dispatched, true);
  assert.equal(response.statusCode, 404);
  assert.equal(response.body.code, 'not_found');
});

test('POSTGRES MUTATION: CAS revision conflict returns 409', async () => {
  const conflictError = new Error('拆书任务版本冲突，请刷新后重试');
  conflictError.status = 409;
  conflictError.code = 'revision_conflict';
  const testHarness = createHarness({ patchError: conflictError });
  const request = testHarness.createRequest('/api/dissections/d_test-mutation-1', 'PATCH', { userId: 'actor-1', email: 'author@example.test' }, { title: '新标题', expectedRevision: 999 });
  const response = createMockResponse();

  const dispatched = await testHarness.service.dispatch(request, response, '/api/dissections/d_test-mutation-1');
  assert.equal(dispatched, true);
  assert.equal(response.statusCode, 409);
  assert.equal(response.body.code, 'revision_conflict');
});

test('POSTGRES MUTATION: persistence rejection never acknowledges success', async () => {
  const testHarness = createHarness({ patchError: Object.assign(new Error('写入失败'), { status: 503 }) });
  const response = createMockResponse();
  await testHarness.service.dispatch(testHarness.createRequest('/api/dissections/d_test-1', 'PATCH', undefined, { title: '未保存' }), response, '/api/dissections/d_test-1');
  assert.equal(response.statusCode, 503);
  assert.notEqual(response.body.ok, true);
});

test('POSTGRES MUTATION: successful patch returns 200 with publicRecord and live PG stats without SQL', async () => {
  const testHarness = createHarness({
    mockBody: { title: '已修改小说标题', tags: ['玄幻', '升级'], folder: '我的归档' },
    mockStats: { unitTotal: 20, unitCompleted: 5, factCoverage: 0.25, entities: 8, candidates: 2 }
  });
  const request = testHarness.createRequest('/api/dissections/d_test-mutation-1', 'PATCH');
  const response = createMockResponse();

  const dispatched = await testHarness.service.dispatch(request, response, '/api/dissections/d_test-mutation-1');
  assert.equal(dispatched, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.task.title, '已修改小说标题');
  assert.equal(response.body.task.estimatedCredits, null);
  assert.equal(response.body.task.actualCredits, null);
  assert.deepEqual(response.body.task.pipeline, {
    unitTotal: 20,
    unitCompleted: 5,
    factCoverage: 0.25,
    entities: 8,
    candidates: 2
  });
});

test('POSTGRES MUTATION: dispatch ignores non-PATCH methods', async () => {
  const testHarness = createHarness();
  const requestGet = testHarness.createRequest('/api/dissections/d_test-mutation-1', 'GET');
  const responseGet = createMockResponse();
  const dispatchedGet = await testHarness.service.dispatch(requestGet, responseGet, '/api/dissections/d_test-mutation-1');
  assert.equal(dispatchedGet, false);

  const requestPost = testHarness.createRequest('/api/dissections/d_test-mutation-1', 'POST');
  const responsePost = createMockResponse();
  const dispatchedPost = await testHarness.service.dispatch(requestPost, responsePost, '/api/dissections/d_test-mutation-1');
  assert.equal(dispatchedPost, false);
});

test('POSTGRES MUTATION: dispatch ignores non-matching URLs', async () => {
  const testHarness = createHarness();
  const requestList = testHarness.createRequest('/api/dissections', 'PATCH');
  const responseList = createMockResponse();
  const dispatchedList = await testHarness.service.dispatch(requestList, responseList, '/api/dissections');
  assert.equal(dispatchedList, false);

  const requestInvalidId = testHarness.createRequest('/api/dissections/invalid_without_prefix', 'PATCH');
  const responseInvalidId = createMockResponse();
  const dispatchedInvalidId = await testHarness.service.dispatch(requestInvalidId, responseInvalidId, '/api/dissections/invalid_without_prefix');
  assert.equal(dispatchedInvalidId, false);

  const requestSubRoute = testHarness.createRequest('/api/dissections/d_test-mutation-1/export', 'PATCH');
  const responseSubRoute = createMockResponse();
  const dispatchedSubRoute = await testHarness.service.dispatch(requestSubRoute, responseSubRoute, '/api/dissections/d_test-mutation-1/export');
  assert.equal(dispatchedSubRoute, false);
});

test('POSTGRES REPO: runtimePatchDissectionMetadata field sanitization preserves 0 and false in tags', async () => {
  const executedStatements = [];
  const fakePool = createFakePostgresPool((sqlStatement, parameters) => {
    executedStatements.push({ sqlStatement, parameters });
    if (sqlStatement.includes('SELECT * FROM luna.runtime_dissections')) {
      return {
        rows: [{
          id: 'd_test-1',
          owner_actor_id: '00000000-0000-0000-0000-000000000001',
          title: '旧标题',
          revision: 2,
          meta_json: JSON.stringify({ tags: ['旧标签'], folder: '旧文件夹' })
        }]
      };
    }
    if (sqlStatement.includes('UPDATE luna.runtime_dissections')) {
      return {
        rows: [{
          id: 'd_test-1',
          title: parameters[1],
          meta_json: parameters[2],
          revision: 3
        }]
      };
    }
    return { rows: [] };
  });

  const repository = createPostgresRepository({
    env: { MOLAN_PG_ENABLED: '1', MOLAN_PG_URL: 'postgres://test:test@localhost:5432/test' },
    Pool: fakePool
  });

  const updatedRow = await repository.runtimePatchDissectionMetadata('actor-1', 'd_test-1', {
    title: '  新长篇标题  ',
    tags: [0, false, '  玄幻修仙  ', ''],
    folder: '  分卷资料夹  '
  });

  assert.equal(updatedRow.title, '新长篇标题');
  const parsedMeta = JSON.parse(updatedRow.meta_json);
  assert.deepEqual(parsedMeta.tags, ['0', 'false', '玄幻修仙']);
  assert.equal(parsedMeta.folder, '分卷资料夹');
  const update = executedStatements.find(statement => statement.sqlStatement.includes('UPDATE luna.runtime_dissections'));
  assert.ok(update);
  assert.doesNotMatch(update.sqlStatement, /source_text|result_json|actual_credits|estimated_credits|cancel_requested|status\s*=/);
  assert.ok(executedStatements.some(statement => statement.sqlStatement.includes('FOR UPDATE') && statement.sqlStatement.includes('owner_actor_id = luna.actor_id()')));
});

test('POSTGRES REPO: runtimePatchDissectionMetadata CAS strictly accepts non-negative safe integers and rejects invalid revisions', async () => {
  const fakePool = createFakePostgresPool((sqlStatement) => {
    if (sqlStatement.includes('SELECT * FROM luna.runtime_dissections')) {
      return {
        rows: [{
          id: 'd_test-1',
          owner_actor_id: '00000000-0000-0000-0000-000000000001',
          title: '旧标题',
          revision: 5,
          meta_json: JSON.stringify({})
        }]
      };
    }
    return { rows: [] };
  });

  const repository = createPostgresRepository({
    env: { MOLAN_PG_ENABLED: '1', MOLAN_PG_URL: 'postgres://test:test@localhost:5432/test' },
    Pool: fakePool
  });

  await assert.rejects(
    async () => repository.runtimePatchDissectionMetadata('actor-1', 'd_test-1', { expectedRevision: '' }),
    error => error && error.status === 400 && error.code === 'invalid_revision'
  );

  await assert.rejects(
    async () => repository.runtimePatchDissectionMetadata('actor-1', 'd_test-1', { expectedRevision: '   ' }),
    error => error && error.status === 400 && error.code === 'invalid_revision'
  );

  await assert.rejects(
    async () => repository.runtimePatchDissectionMetadata('actor-1', 'd_test-1', { expectedRevision: -1 }),
    error => error && error.status === 400 && error.code === 'invalid_revision'
  );

  await assert.rejects(
    async () => repository.runtimePatchDissectionMetadata('actor-1', 'd_test-1', { expectedRevision: 'invalid-text' }),
    error => error && error.status === 400 && error.code === 'invalid_revision'
  );

  await assert.rejects(
    async () => repository.runtimePatchDissectionMetadata('actor-1', 'd_test-1', { expectedRevision: 99 }),
    error => error && error.status === 409 && error.code === 'revision_conflict'
  );
  assert.equal((await repository.runtimePatchDissectionMetadata('actor-1', 'd_test-1', { expectedRevision: '5' })).revision, 5);
  for (const expectedRevision of [true, null, [], {}, 1.5, '1.5', '1e0', Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      repository.runtimePatchDissectionMetadata('actor-1', 'd_test-1', { expectedRevision }),
      error => error.code === 'invalid_revision'
    );
  }
});

test('POSTGRES REPO: malformed metadata rolls back without update or notification', async () => {
  for (const metadata of [null, '', 'null', '[]', '123', '{invalid']) {
    const statements = [];
    const repository = createPostgresRepository({
      env: { MOLAN_PG_ENABLED: '1', MOLAN_PG_URL: 'postgres://test:test@localhost:5432/test' },
      Pool: createFakePostgresPool(statement => {
        statements.push(statement);
        return { rows: statement.includes('SELECT * FROM luna.runtime_dissections')
          ? [{ id: 'd_corrupt', title: '保留证据', revision: 1, meta_json: metadata }] : [] };
      })
    });
    await assert.rejects(repository.runtimePatchDissectionMetadata('actor-1', 'd_corrupt', { title: '不可覆盖' }), error => error.code === 'corrupt_meta');
    assert.ok(statements.includes('ROLLBACK'));
    assert.equal(statements.some(statement => /UPDATE luna.runtime_dissections|pg_notify/.test(statement)), false);
    await repository.close();
  }
});

test('POSTGRES REPO: runtimePatchDissectionMetadata empty patch is idempotent and does not execute update', async () => {
  let updateExecuted = false;
  const fakePool = createFakePostgresPool((sqlStatement) => {
    if (sqlStatement.includes('SELECT * FROM luna.runtime_dissections')) {
      return {
        rows: [{
          id: 'd_test-1',
          owner_actor_id: '00000000-0000-0000-0000-000000000001',
          title: '现有标题',
          revision: 3,
          meta_json: JSON.stringify({ tags: ['修真'], folder: '分类A' })
        }]
      };
    }
    if (sqlStatement.includes('UPDATE luna.runtime_dissections')) {
      updateExecuted = true;
      return { rows: [] };
    }
    return { rows: [] };
  });

  const repository = createPostgresRepository({
    env: { MOLAN_PG_ENABLED: '1', MOLAN_PG_URL: 'postgres://test:test@localhost:5432/test' },
    Pool: fakePool
  });

  const resultEmpty = await repository.runtimePatchDissectionMetadata('actor-1', 'd_test-1', {});
  assert.equal(updateExecuted, false);
  assert.equal(resultEmpty.revision, 3);

  const resultIdentical = await repository.runtimePatchDissectionMetadata('actor-1', 'd_test-1', {
    title: '现有标题',
    tags: ['修真'],
    folder: '分类A',
    expectedRevision: 3
  });
  assert.equal(updateExecuted, false);
  assert.equal(resultIdentical.revision, 3);
});

test('POSTGRES REPO: corrupt existing meta_json in DB throws 500 corrupt_meta without washing evidence', async () => {
  const fakePool = createFakePostgresPool((sqlStatement) => {
    if (sqlStatement.includes('SELECT * FROM luna.runtime_dissections')) {
      return {
        rows: [{
          id: 'd_test-1',
          owner_actor_id: '00000000-0000-0000-0000-000000000001',
          title: '现有标题',
          revision: 1,
          meta_json: '["not-an-object", 123]'
        }]
      };
    }
    return { rows: [] };
  });

  const repository = createPostgresRepository({
    env: { MOLAN_PG_ENABLED: '1', MOLAN_PG_URL: 'postgres://test:test@localhost:5432/test' },
    Pool: fakePool
  });

  await assert.rejects(
    async () => repository.runtimePatchDissectionMetadata('actor-1', 'd_test-1', { title: '新标题' }),
    error => error && error.status === 500 && error.code === 'corrupt_meta'
  );

  await assert.rejects(
    async () => repository.runtimeUpdateDissection({ id: 'd_test-1', userId: 'actor-1' }),
    error => error && error.status === 500 && error.code === 'corrupt_meta'
  );
});

test('POSTGRES REPO: runtimeUpdateDissection protects native title, merges meta and retains null credits', async () => {
  let executedUpdateParameters = null;
  const fakePool = createFakePostgresPool((sqlStatement, parameters) => {
    if (sqlStatement.includes('SELECT * FROM luna.runtime_dissections')) {
      return {
        rows: [{
          id: 'd_test-worker-1',
          owner_actor_id: '00000000-0000-0000-0000-000000000001',
          title: '已由用户修改的真实标题',
          revision: 4,
          meta_json: JSON.stringify({
            tags: ['已保存标签A', '已保存标签B'],
            folder: '已保存文件夹'
          })
        }]
      };
    }
    if (sqlStatement.includes('UPDATE luna.runtime_dissections')) {
      executedUpdateParameters = parameters;
      return {
        rows: [{
          id: parameters[0],
          title: parameters[1],
          meta_json: parameters[15]
        }]
      };
    }
    return { rows: [] };
  });

  const repository = createPostgresRepository({
    env: { MOLAN_PG_ENABLED: '1', MOLAN_PG_URL: 'postgres://test:test@localhost:5432/test' },
    Pool: fakePool
  });

  await repository.runtimeUpdateDissection({
    id: 'd_test-worker-1',
    userId: 'actor-1',
    title: '旧worker试图覆盖的旧标题',
    estimatedCredits: null,
    actualCredits: null,
    meta: {
      tags: [],
      folder: '',
      pipeline: { unitTotal: 50, unitCompleted: 50, factCoverage: 1.0 }
    }
  });

  assert.ok(executedUpdateParameters);
  assert.equal(executedUpdateParameters[1], '已由用户修改的真实标题');
  assert.equal(executedUpdateParameters[12], null);
  assert.equal(executedUpdateParameters[13], null);

  const mergedMeta = JSON.parse(executedUpdateParameters[15]);
  assert.deepEqual(mergedMeta.tags, ['已保存标签A', '已保存标签B']);
  assert.equal(mergedMeta.folder, '已保存文件夹');
  assert.equal(mergedMeta.pipeline.unitTotal, 50);
});
