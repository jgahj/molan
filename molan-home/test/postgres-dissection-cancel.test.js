'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPostgresDissectionMutationService } = require('../services/postgres-dissection-mutation-service');
const { createPostgresRepository, internalUuid } = require('../lib/postgres-repository');
const { createDissectionScheduler } = require('../services/dissection-scheduler');
const { checkDissectionActiveInPostgres, runDissectionChat, planDissectionRetry } = require('../server');

/**
 * 构造用于测试的 HTTP 响应模拟对象。
 */
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

/**
 * 构造模拟的 PostgreSQL 连接池与客户端，支持真实 createPostgresRepository 事务、SQL 规范化与行级锁执行。
 */
function createFakePgPool(databaseState = {}) {
  const executedQueries = [];
  const rowsTable = databaseState.dissections || new Map();
  const dissectionRowsTable = databaseState.dissectionRows || new Map();
  let updateExecutionCount = 0;

  class FakeClient {
    constructor() {
      this.inTransaction = false;
      this.currentRole = null;
      this.currentActorUuid = null;
      this.released = false;
    }

    async query(sqlText, parameters = []) {
      const normalizedSql = String(sqlText || '').replace(/\s+/g, ' ').trim();
      executedQueries.push({ sql: normalizedSql, parameters });

      if (/^BEGIN/i.test(normalizedSql)) {
        this.inTransaction = true;
        return { rows: [], rowCount: 0 };
      }
      if (/^COMMIT/i.test(normalizedSql) || /^ROLLBACK/i.test(normalizedSql)) {
        this.inTransaction = false;
        return { rows: [], rowCount: 0 };
      }
      if (/^SET ROLE/i.test(normalizedSql)) {
        this.currentRole = normalizedSql.replace(/^SET ROLE\s+/i, '').trim();
        return { rows: [], rowCount: 0 };
      }
      if (/^RESET/i.test(normalizedSql)) {
        this.currentRole = null;
        return { rows: [], rowCount: 0 };
      }
      if (/SELECT set_config\(\$1,\s*\$2,\s*true\)/i.test(normalizedSql)) {
        this.currentActorUuid = parameters[1] || null;
        return { rows: [{ set_config: parameters[1] }], rowCount: 1 };
      }

      if (/SELECT \* FROM luna\.runtime_dissections WHERE id = \$1::text AND owner_actor_id = luna\.actor_id\(\) FOR UPDATE/i.test(normalizedSql)) {
        const targetId = String(parameters[0] || '');
        const matchingRow = rowsTable.get(targetId);
        if (!matchingRow) {
          return { rows: [], rowCount: 0 };
        }
        if (this.currentActorUuid && matchingRow.owner_actor_id !== this.currentActorUuid) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [{ ...matchingRow }], rowCount: 1 };
      }

      if (/UPDATE luna\.runtime_dissections SET cancel_requested = true/i.test(normalizedSql)) {
        updateExecutionCount += 1;
        const targetId = String(parameters[0] || '');
        const existingRow = rowsTable.get(targetId);
        if (!existingRow || (this.currentActorUuid && existingRow.owner_actor_id !== this.currentActorUuid)) {
          return { rows: [], rowCount: 0 };
        }
        const updatedRow = {
          ...existingRow,
          cancel_requested: true,
          status: 'cancelled',
          error: '任务已取消，可从当前阶段继续',
          updated_at_value: parameters[1],
          revision: Number(existingRow.revision || 0) + 1
        };
        rowsTable.set(targetId, updatedRow);
        return { rows: [{ ...updatedRow }], rowCount: 1 };
      }

      if (/UPDATE luna\.runtime_dissections SET status = 'queued'/i.test(normalizedSql)) {
        updateExecutionCount += 1;
        const targetId = String(parameters[0] || '');
        const existingRow = rowsTable.get(targetId);
        if (!existingRow || (this.currentActorUuid && existingRow.owner_actor_id !== this.currentActorUuid)) {
          return { rows: [], rowCount: 0 };
        }
        const updatedRow = {
          ...existingRow,
          status: 'queued',
          cancel_requested: false,
          phase_index: parameters[1],
          phase: parameters[2],
          progress: parameters[3],
          error: '',
          meta_json: parameters[4],
          updated_at_value: parameters[5],
          revision: Number(existingRow.revision || 0) + 1
        };
        rowsTable.set(targetId, updatedRow);
        return { rows: [{ ...updatedRow }], rowCount: 1 };
      }

      if (/UPDATE luna\.runtime_dissections SET title = \$2::text/i.test(normalizedSql) && /WHERE id = \$1::text AND owner_actor_id = luna\.actor_id\(\)/i.test(normalizedSql)) {
        updateExecutionCount += 1;
        const targetId = String(parameters[0] || '');
        const existingRow = rowsTable.get(targetId);
        if (!existingRow || (this.currentActorUuid && existingRow.owner_actor_id !== this.currentActorUuid)) {
          return { rows: [], rowCount: 0 };
        }
        const updatedRow = {
          ...existingRow,
          title: parameters[1],
          source_type: parameters[2],
          source_name: parameters[3],
          source_text: parameters[4],
          depth: parameters[5],
          purpose: parameters[6],
          selected_model: parameters[7],
          status: parameters[8],
          phase: parameters[9],
          phase_index: parameters[10],
          progress: parameters[11],
          estimated_credits: parameters[12],
          actual_credits: parameters[13],
          result_json: parameters[14],
          meta_json: parameters[15],
          error: parameters[16],
          cancel_requested: parameters[17],
          owner_user_id: parameters[18],
          updated_at_value: parameters[19],
          revision: Number(existingRow.revision || 0) + 1
        };
        rowsTable.set(targetId, updatedRow);
        return { rows: [{ ...updatedRow }], rowCount: 1 };
      }

      if (/SELECT \* FROM luna\.runtime_dissection_rows WHERE owner_actor_id = luna\.actor_id\(\) AND dissection_id = \$1::text/i.test(normalizedSql)) {
        const targetId = String(parameters[0] || '');
        const matchingDissectionRows = [];
        const sourceTableFilter = parameters[1] ? String(parameters[1]) : '';
        for (const dissectionRow of dissectionRowsTable.values()) {
          if (dissectionRow.dissection_id === targetId && dissectionRow.owner_actor_id === this.currentActorUuid) {
            if (!sourceTableFilter || dissectionRow.source_table === sourceTableFilter) {
              matchingDissectionRows.push({ ...dissectionRow });
            }
          }
        }
        return { rows: matchingDissectionRows, rowCount: matchingDissectionRows.length };
      }

      if (/SELECT pg_notify/i.test(normalizedSql)) {
        return { rows: [], rowCount: 0 };
      }

      return { rows: [], rowCount: 0 };
    }

    release() {
      this.released = true;
    }
  }

  class FakePool {
    constructor(configuration) {
      this.configuration = configuration;
    }

    async connect() {
      return new FakeClient();
    }
  }

  return {
    FakePool,
    executedQueries,
    rowsTable,
    dissectionRowsTable,
    getUpdateExecutionCount: () => updateExecutionCount
  };
}

test('真实 PostgreSQL 仓储：runtimeRequestDissectionCancel 事务行锁、权限门禁、终态幂等与字段窄写', async () => {
  const actorOneUuid = internalUuid('actor-1');
  const initialRows = new Map();
  initialRows.set('d_running_1', {
    id: 'd_running_1',
    owner_actor_id: actorOneUuid,
    owner_user_id: 'actor-1',
    user_email: 'author@example.test',
    title: '运行中的拆书',
    status: 'running',
    phase: 'extract',
    phase_index: 2,
    progress: 40,
    estimated_credits: 50,
    actual_credits: null,
    result_json: JSON.stringify({ overview: '阶段概览' }),
    meta_json: JSON.stringify({ tags: ['网文'] }),
    revision: 3,
    error: '',
    cancel_requested: false,
    updated_at_value: 1700000000000
  });

  initialRows.set('d_completed_1', {
    id: 'd_completed_1',
    owner_actor_id: actorOneUuid,
    owner_user_id: 'actor-1',
    user_email: 'author@example.test',
    title: '已完成的拆书',
    status: 'completed',
    phase: 'completed',
    phase_index: 8,
    progress: 100,
    estimated_credits: 50,
    actual_credits: 45.2,
    result_json: JSON.stringify({ overview: '完整概览' }),
    meta_json: JSON.stringify({ tags: ['完结'] }),
    revision: 10,
    error: '',
    cancel_requested: false,
    updated_at_value: 1700000100000
  });

  const fakeState = { dissections: initialRows };
  const { FakePool, executedQueries } = createFakePgPool(fakeState);

  const repository = createPostgresRepository({
    Pool: FakePool,
    env: {
      MOLAN_PG_ENABLED: 'true',
      MOLAN_PG_URL: 'postgres://luna:test@localhost:5432/molan_test'
    }
  });

  await assert.rejects(
    async () => {
      await repository.runtimeRequestDissectionCancel('actor-1', 'd_non_existent');
    },
    { code: 'not_found' }
  );

  await assert.rejects(
    async () => {
      await repository.runtimeRequestDissectionCancel('actor-other', 'd_running_1');
    },
    { code: 'not_found' }
  );

  const completedNoopResult = await repository.runtimeRequestDissectionCancel('actor-1', 'd_completed_1');
  assert.equal(completedNoopResult.status, 'completed');
  assert.equal(completedNoopResult.revision, 10);
  assert.equal(completedNoopResult.wasQueued, false);
  assert.equal(completedNoopResult.isNoop, true);
  assert.equal(completedNoopResult.wasCancelled, false);

  const cancelRunningResult = await repository.runtimeRequestDissectionCancel('actor-1', 'd_running_1');
  assert.equal(cancelRunningResult.status, 'cancelled');
  assert.equal(cancelRunningResult.cancel_requested, true);
  assert.equal(cancelRunningResult.error, '任务已取消，可从当前阶段继续');
  assert.equal(cancelRunningResult.revision, 4);
  assert.equal(cancelRunningResult.isNoop, false);
  assert.equal(cancelRunningResult.wasCancelled, true);

  const selectForUpdateQuery = executedQueries.find(entry => entry.sql.includes('SELECT * FROM luna.runtime_dissections') && entry.sql.includes('FOR UPDATE'));
  assert.ok(selectForUpdateQuery, '必须包含行锁 SELECT ... FOR UPDATE 语句');
  assert.ok(selectForUpdateQuery.sql.includes('owner_actor_id = luna.actor_id()'), '行锁必须包含严格 owner_actor_id 条件');

  const updateQuery = executedQueries.find(entry => entry.sql.includes('UPDATE luna.runtime_dissections SET cancel_requested = true'));
  assert.ok(updateQuery, '必须包含窄更新 UPDATE 语句');
  assert.ok(!updateQuery.sql.includes('result_json'), '窄更新不得修改 result_json');
  assert.ok(!updateQuery.sql.includes('actual_credits'), '窄更新不得修改 actual_credits');
});

test('真实 PostgreSQL 仓储：runtimeUpdateDissection worker 围栏与 null 费用保持', async () => {
  const actorOneUuid = internalUuid('actor-1');
  const initialRows = new Map();
  initialRows.set('d_cancelled_null_credits', {
    id: 'd_cancelled_null_credits',
    owner_actor_id: actorOneUuid,
    owner_user_id: 'actor-1',
    user_email: 'author@example.test',
    title: '已取消任务',
    status: 'cancelled',
    phase: 'extract',
    phase_index: 2,
    progress: 30,
    estimated_credits: 50,
    actual_credits: null,
    result_json: JSON.stringify({ overview: '未完成' }),
    meta_json: JSON.stringify({ tags: ['初始'] }),
    revision: 5,
    error: '任务已取消，可从当前阶段继续',
    cancel_requested: true,
    updated_at_value: 1700000000000
  });

  initialRows.set('d_cancelled_known_credits', {
    id: 'd_cancelled_known_credits',
    owner_actor_id: actorOneUuid,
    owner_user_id: 'actor-1',
    user_email: 'author@example.test',
    title: '已知费用已取消任务',
    status: 'cancelled',
    phase: 'extract',
    phase_index: 2,
    progress: 30,
    estimated_credits: 50,
    actual_credits: 35.5,
    result_json: JSON.stringify({ overview: '已产出部分' }),
    meta_json: JSON.stringify({ tags: ['初始'] }),
    revision: 5,
    error: '任务已取消，可从当前阶段继续',
    cancel_requested: true,
    updated_at_value: 1700000000000
  });

  const fakeState = { dissections: initialRows };
  const { FakePool } = createFakePgPool(fakeState);

  const repository = createPostgresRepository({
    Pool: FakePool,
    env: {
      MOLAN_PG_ENABLED: 'true',
      MOLAN_PG_URL: 'postgres://luna:test@localhost:5432/molan_test'
    }
  });

  await assert.rejects(
    async () => {
      await repository.runtimeUpdateDissection({
        id: 'd_cancelled_null_credits',
        ownerUserId: 'actor-1',
        status: 'running',
        phase: 'extract',
        phaseIndex: 3,
        progress: 50
      });
    },
    { code: 'cancelled' }
  );

  const writebackRecord = {
    id: 'd_cancelled_null_credits',
    ownerUserId: 'actor-1',
    status: 'cancelled',
    cancelRequested: false,
    phase: 'extract',
    phaseIndex: 2,
    progress: 30,
    actualCredits: 15.0,
    error: ''
  };

  const updatedNullRow = await repository.runtimeUpdateDissection(writebackRecord);
  assert.equal(updatedNullRow.status, 'cancelled');
  assert.equal(updatedNullRow.cancel_requested, true);
  assert.equal(updatedNullRow.actual_credits, null, '未知费用必须强制保持 null，禁止被 stale worker 覆盖为确定数值');

  const knownCreditsRecord = {
    id: 'd_cancelled_known_credits',
    ownerUserId: 'actor-1',
    status: 'cancelled',
    cancelRequested: false,
    phase: 'extract',
    phaseIndex: 2,
    progress: 30,
    actualCredits: 20.0,
    error: ''
  };

  const updatedKnownRow = await repository.runtimeUpdateDissection(knownCreditsRecord);
  assert.equal(updatedKnownRow.status, 'cancelled');
  assert.equal(updatedKnownRow.cancel_requested, true);
  assert.equal(Number(updatedKnownRow.actual_credits), 35.5, '已知费用必须保留已有最大值，不得降低');
});

test('真实 PostgreSQL 仓储：runtimeRequeueDissection 非法 CAS、损坏 meta 与 0 UPDATE 断言', async () => {
  const actorOneUuid = internalUuid('actor-1');
  const initialRows = new Map();
  initialRows.set('d_retry_candidate', {
    id: 'd_retry_candidate',
    owner_actor_id: actorOneUuid,
    owner_user_id: 'actor-1',
    user_email: 'author@example.test',
    title: '待重试拆书',
    status: 'cancelled',
    phase: 'cancelled',
    phase_index: 3,
    progress: 35,
    estimated_credits: 50,
    actual_credits: 22.0,
    result_json: JSON.stringify({ overview: '前三阶段' }),
    meta_json: JSON.stringify({ stageUsage: { extract: { tokens: 1000 } }, retryCount: 1 }),
    revision: 6,
    error: '任务已取消，可从当前阶段继续',
    cancel_requested: true,
    updated_at_value: 1700000000000
  });

  initialRows.set('d_corrupt_meta_task', {
    id: 'd_corrupt_meta_task',
    owner_actor_id: actorOneUuid,
    owner_user_id: 'actor-1',
    user_email: 'author@example.test',
    title: '损坏元数据拆书',
    status: 'cancelled',
    phase: 'cancelled',
    phase_index: 1,
    progress: 10,
    estimated_credits: 50,
    actual_credits: 10.0,
    result_json: '{}',
    meta_json: '{broken json',
    revision: 3,
    error: '任务已取消，可从当前阶段继续',
    cancel_requested: true,
    updated_at_value: 1700000000000
  });

  const fakeState = { dissections: initialRows };
  const { FakePool, getUpdateExecutionCount } = createFakePgPool(fakeState);

  const repository = createPostgresRepository({
    Pool: FakePool,
    env: {
      MOLAN_PG_ENABLED: 'true',
      MOLAN_PG_URL: 'postgres://luna:test@localhost:5432/molan_test'
    }
  });

  await assert.rejects(
    async () => {
      await repository.runtimeRequeueDissection('actor-1', 'd_retry_candidate', {
        phaseIndex: 3,
        phase: 'extract',
        progress: 35,
        expectedRevision: 'not-a-number'
      });
    },
    { code: 'invalid_revision' }
  );
  assert.equal(getUpdateExecutionCount(), 0, '非法 CAS 必须在执行任何 UPDATE 前拒绝');

  await assert.rejects(
    async () => {
      await repository.runtimeRequeueDissection('actor-1', 'd_retry_candidate', {
        phaseIndex: 3,
        phase: 'extract',
        progress: 35,
        expectedRevision: 5
      });
    },
    { code: 'revision_conflict' }
  );
  assert.equal(getUpdateExecutionCount(), 0, 'CAS 版本冲突必须在执行任何 UPDATE 前拒绝');

  await assert.rejects(
    async () => {
      await repository.runtimeRequeueDissection('actor-1', 'd_corrupt_meta_task', {
        phaseIndex: 1,
        phase: 'extract',
        progress: 10,
        expectedRevision: 3
      });
    },
    { code: 'corrupt_meta' }
  );
  assert.equal(getUpdateExecutionCount(), 0, '损坏元数据必须在执行任何 UPDATE 前 fail-closed');

  const requeuedRow = await repository.runtimeRequeueDissection('actor-1', 'd_retry_candidate', {
    phaseIndex: 3,
    phase: 'extract',
    progress: 35,
    expectedRevision: 6
  });

  assert.equal(requeuedRow.status, 'queued');
  assert.equal(requeuedRow.cancel_requested, false);
  assert.equal(requeuedRow.error, '');
  assert.equal(requeuedRow.revision, 7);
  assert.equal(getUpdateExecutionCount(), 1);

  const parsedMeta = JSON.parse(requeuedRow.meta_json);
  assert.equal(parsedMeta.retryCount, 2);
  assert.ok(parsedMeta.stageUsage && parsedMeta.stageUsage.extract, '必须保留已有 stageUsage');
});

test('checkDissectionActiveInPostgres 校验：owner 匹配与非 owner 阻断', async () => {
  const repository = {
    async runtimeGetDissection(actorUserId, dissectionId) {
      if (dissectionId === 'd_cross_owner') {
        return { id: 'd_cross_owner', owner_user_id: 'actor-other', status: 'running', cancel_requested: false };
      }
      if (dissectionId === 'd_no_owner') {
        return { id: 'd_no_owner', owner_user_id: '', status: 'running', cancel_requested: false };
      }
      if (dissectionId === 'd_active') {
        return { id: 'd_active', owner_user_id: actorUserId, status: 'running', cancel_requested: false };
      }
      if (dissectionId === 'd_cancelled') {
        return { id: 'd_cancelled', owner_user_id: actorUserId, status: 'cancelled', cancel_requested: true };
      }
      return null;
    }
  };

  const crossOwnerCheck = await checkDissectionActiveInPostgres(repository, 'actor-admin', 'd_cross_owner');
  assert.equal(crossOwnerCheck.ok, false);
  assert.equal(crossOwnerCheck.reason, 'unauthorized');

  const noOwnerCheck = await checkDissectionActiveInPostgres(repository, 'actor-1', 'd_no_owner');
  assert.equal(noOwnerCheck.ok, false);
  assert.equal(noOwnerCheck.reason, 'unauthorized');

  const activeCheck = await checkDissectionActiveInPostgres(repository, 'actor-1', 'd_active');
  assert.equal(activeCheck.ok, true);

  const cancelledCheck = await checkDissectionActiveInPostgres(repository, 'actor-1', 'd_cancelled');
  assert.equal(cancelledCheck.ok, false);
  assert.equal(cancelledCheck.reason, 'cancelled');

  const missingCheck = await checkDissectionActiveInPostgres(repository, 'actor-1', 'd_missing');
  assert.equal(missingCheck.ok, false);
  assert.equal(missingCheck.reason, 'missing');
});

test('runDissectionChat 真实流守护：headers 先到达后正文挂起，中途检测到 PG cancel 触发 abort', async () => {
  const controller = new AbortController();
  let pollCounter = 0;
  const pollingRepository = {
    async runtimeGetDissection(actorUserId, dissectionId) {
      pollCounter += 1;
      if (pollCounter >= 2) {
        return { id: dissectionId, owner_user_id: actorUserId, status: 'cancelled', cancel_requested: true };
      }
      return { id: dissectionId, owner_user_id: actorUserId, status: 'running', cancel_requested: false };
    }
  };

  const fakeFetch = async (url, options) => {
    return {
      status: 200,
      ok: true,
      text: async () => {
        return new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const abortError = new Error('The operation was aborted');
            abortError.name = 'AbortError';
            reject(abortError);
          });
        });
      }
    };
  };

  const dummyRecord = {
    id: 'd_synthetic_cancel',
    ownerUserId: 'actor-1',
    userEmail: 'author@example.test',
    phase: 'extract',
    depth: 'standard',
    result: {},
    meta: {}
  };

  await assert.rejects(
    async () => {
      await runDissectionChat(
        'Bearer token',
        dummyRecord,
        'system prompt',
        'user prompt',
        1000,
        null,
        controller,
        null,
        {
          postgresRepository: pollingRepository,
          fetch: fakeFetch,
          pollIntervalMs: 50,
          postgresMode: true
        }
      );
    },
    error => {
      assert.equal(error.name, 'AbortError');
      assert.equal(error.cancelled, true);
      assert.equal(controller.signal.aborted, true);
      return true;
    }
  );
});

test('runDissectionChat 真实流守护：headers 到达后正文挂起，PG 故障抛出原 error 且不重试', async () => {
  const controller = new AbortController();
  let attemptCount = 0;
  let pollCounter = 0;

  const outageRepository = {
    async runtimeGetDissection(actorUserId, dissectionId) {
      pollCounter += 1;
      if (pollCounter >= 2) {
        throw new Error('PostgreSQL 数据库不可达');
      }
      return { id: dissectionId, owner_user_id: actorUserId, status: 'running', cancel_requested: false };
    }
  };

  const fakeFetch = async (url, options) => {
    attemptCount += 1;
    return {
      status: 200,
      ok: true,
      text: async () => {
        return new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const abortError = new Error('The operation was aborted');
            abortError.name = 'AbortError';
            reject(abortError);
          });
        });
      }
    };
  };

  const dummyRecord = {
    id: 'd_synthetic_outage',
    ownerUserId: 'actor-1',
    userEmail: 'author@example.test',
    phase: 'extract',
    depth: 'standard',
    result: {},
    meta: {}
  };

  await assert.rejects(
    async () => {
      await runDissectionChat(
        'Bearer token',
        dummyRecord,
        'system prompt',
        'user prompt',
        1000,
        null,
        controller,
        null,
        {
          postgresRepository: outageRepository,
          fetch: fakeFetch,
          pollIntervalMs: 50,
          postgresMode: true
        }
      );
    },
    error => {
      assert.equal(error.message, 'PostgreSQL 数据库不可达');
      assert.notEqual(error.name, 'AbortError');
      return true;
    }
  );

  assert.equal(attemptCount, 1, '遇到 PG 故障时不得误判为普通网络错误进行多次重试');
});

test('真实调度器：waitForDissectionCapacity 异步等待，排队取消与 PG 读取失败不占容量', async () => {
  let mockRecord = { id: 'd_sched_test', status: 'running', cancelRequested: false };
  let loadShouldThrow = false;

  const scheduler = createDissectionScheduler({
    maxConcurrent: 1,
    loadRecord: async (id, email) => {
      if (loadShouldThrow) {
        throw new Error('PG 读取连接超时');
      }
      return mockRecord;
    }
  });

  const firstController = new AbortController();
  await scheduler.waitForDissectionCapacity('d_first', 'user1@example.test', firstController);

  const cancelController = new AbortController();
  mockRecord = { id: 'd_sched_test', status: 'cancelled', cancelRequested: true };

  await assert.rejects(
    async () => {
      await scheduler.waitForDissectionCapacity('d_sched_test', 'user2@example.test', cancelController);
    },
    error => {
      assert.equal(error.cancelled, true);
      return true;
    }
  );

  scheduler.releaseCapacity();

  loadShouldThrow = true;
  const failureController = new AbortController();

  await assert.rejects(
    async () => {
      await scheduler.waitForDissectionCapacity('d_sched_test', 'user3@example.test', failureController);
    },
    error => {
      assert.equal(error.message, 'PG 读取连接超时');
      return true;
    }
  );
});

test('scheduler concurrent asynchronous reads respect the capacity limit', async () => {
  const scheduler = createDissectionScheduler({
    maxConcurrent: 1,
    loadRecord: async () => ({ status: 'queued', cancelRequested: false })
  });
  let entered = 0;
  const controllers = [new AbortController(), new AbortController()];
  const pending = controllers.map((controller, index) =>
    scheduler.waitForDissectionCapacity(`d_capacity_${index}`, 'owner@example.test', controller)
      .then(() => { entered += 1; })
      .catch(error => { assert.equal(error.cancelled, true); })
  );
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(entered, 1);
  controllers.forEach(controller => controller.abort());
  await Promise.all(pending);
  scheduler.releaseCapacity();
});

test('planDissectionRetry：使用 runtimeListDissectionRows 查询真实 units 判断流水线与错误传播', async () => {
  let listRowsCalledWith = null;
  let shouldOutage = false;

  const mockRepository = {
    async runtimeListDissectionRows(actorUserId, dissectionId, sourceTable) {
      listRowsCalledWith = [actorUserId, dissectionId, sourceTable];
      if (shouldOutage) {
        throw new Error('PG units 查表网络中断');
      }
      const generatedRows = [];
      for (let index = 0; index < 85; index += 1) {
        generatedRows.push({
          source_table: 'dissection_units',
          document: { unit_type: 'chapter', chapter_no: index + 1 }
        });
      }
      return generatedRows;
    }
  };

  const deepRecord = {
    id: 'd_deep_book',
    depth: 'deep',
    result: {}
  };

    const plannedDeep = await planDissectionRetry('actor-1', deepRecord, { revision: 3 }, mockRepository);
    assert.equal(plannedDeep.phase, 'extract');
    assert.equal(plannedDeep.phaseIndex, 0);
    assert.equal(plannedDeep.expectedRevision, 3);
    assert.deepEqual(listRowsCalledWith, ['actor-1', 'd_deep_book', 'dissection_units']);
    shouldOutage = true;
    await assert.rejects(planDissectionRetry('actor-1', deepRecord, { revision: 3 }, mockRepository), /PG units 查表网络中断/);
});

test('Mutation 服务：handleCancel 终态 no-op 不 abort active，新取消才 abort', async () => {
  const mockActiveController = new AbortController();
  let repositoryCancelCalled = false;

  const repository = {
    async runtimeRequestDissectionCancel(actorUserId, dissectionId) {
      repositoryCancelCalled = true;
      if (dissectionId === 'd_completed_task') {
        return {
          id: 'd_completed_task',
          owner_user_id: actorUserId,
          status: 'completed',
          isNoop: true,
          wasCancelled: false,
          revision: 5
        };
      }
      return {
        id: 'd_running_task',
        owner_user_id: actorUserId,
        status: 'cancelled',
        isNoop: false,
        wasCancelled: true,
        revision: 6
      };
    }
  };

  const mutationService = createPostgresDissectionMutationService({
    postgresRepository: repository,
    readBody: async () => ({}),
    getAuthUser: request => request.mockAuth || null,
    postgresActor: auth => String(auth.user && auth.user.userId || 'actor-1'),
    json: (response, code, payload) => {
      response.writeHead(code, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(payload));
      return payload;
    },
    respondPostgresError: (response, error) => {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: error.message }));
    },
    rowToRecord: row => ({ ...row, meta: {}, result: {} }),
    publicRecord: record => ({ id: record.id, status: record.status }),
    computeStats: async () => ({}),
    getActiveDissection: dissectionId => {
      return { controller: mockActiveController };
    },
    releaseUserSlot: () => {}
  });

  const completedRequest = { mockAuth: { user: { email: 'author@example.test', userId: 'actor-1' } } };
  const completedResponse = createMockResponse();
  await mutationService.handleCancel(completedRequest, completedResponse, 'd_completed_task');
  assert.equal(completedResponse.statusCode, 200);
  assert.equal(mockActiveController.signal.aborted, false, '终态 no-op 不得 abort 仍在运行或清理的 controller');

  const runningRequest = { mockAuth: { user: { email: 'author@example.test', userId: 'actor-1' } } };
  const runningResponse = createMockResponse();
  await mutationService.handleCancel(runningRequest, runningResponse, 'd_running_task');
  assert.equal(runningResponse.statusCode, 200);
  assert.equal(mockActiveController.signal.aborted, true, '新取消必须 abort controller');
});

test('Mutation 服务：handleRetry 严格先校验 auth 与 owner 才查 active，槽位按获取释放', async () => {
  let activeCheckCount = 0;
  let slotReleased = false;

  const repository = {
    async runtimeGetDissection(actorUserId, dissectionId) {
      if (dissectionId === 'd_cross_owner') {
        return {
          id: 'd_cross_owner',
          owner_user_id: 'actor-other',
          status: 'cancelled',
          revision: 2
        };
      }
      return {
        id: 'd_own_task',
        owner_user_id: actorUserId,
        status: 'cancelled',
        depth: 'standard',
        result_json: '{}',
        meta_json: '{}',
        revision: 4
      };
    },
    async runtimeRequeueDissection() {
      throw new Error('Requeue 数据库写入失败');
    }
  };

  const mutationService = createPostgresDissectionMutationService({
    postgresRepository: repository,
    readBody: async () => ({}),
    getAuthUser: request => request.mockAuth || null,
    postgresActor: auth => String(auth.user && auth.user.userId || 'actor-1'),
    json: (response, code, payload) => {
      response.writeHead(code, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(payload));
      return payload;
    },
    respondPostgresError: (response, error) => {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: error.message }));
    },
    rowToRecord: row => ({ ...row, meta: {}, result: {} }),
    publicRecord: record => ({ id: record.id, status: record.status }),
    computeStats: async () => ({}),
    getActiveDissection: dissectionId => {
      activeCheckCount += 1;
      return null;
    },
    acquireUserSlot: () => true,
    releaseUserSlot: () => {
      slotReleased = true;
    },
    scheduleStartDissection: () => {},
    planRetry: async (actorUserId, record, row) => ({
      phaseIndex: 0,
      phase: 'validate',
      progress: 0,
      expectedRevision: row.revision
    })
  });

  const crossOwnerRequest = { mockAuth: { user: { email: 'author@example.test', userId: 'actor-1' } } };
  const crossOwnerResponse = createMockResponse();
  await mutationService.handleRetry(crossOwnerRequest, crossOwnerResponse, 'd_cross_owner');
  assert.equal(crossOwnerResponse.statusCode, 404);
  assert.equal(activeCheckCount, 0, '跨 owner 时必须在查询 active 之前直接 404');

  const failRequeueRequest = { mockAuth: { user: { email: 'author@example.test', userId: 'actor-1' } } };
  const failRequeueResponse = createMockResponse();
  await mutationService.handleRetry(failRequeueRequest, failRequeueResponse, 'd_own_task');
  assert.equal(failRequeueResponse.statusCode, 500);
  assert.equal(slotReleased, true, 'Requeue 失败时必须释放已获取的槽位');
});

test('Mutation 服务：dispatch 路由通过真实 repository mock 验证调用', async () => {
  let cancelCalledWith = null;
  let retryCalledWith = null;

  const repository = {
    async runtimeRequestDissectionCancel(actorUserId, dissectionId) {
      cancelCalledWith = [actorUserId, dissectionId];
      return {
        id: dissectionId,
        owner_user_id: actorUserId,
        status: 'cancelled',
        revision: 2,
        isNoop: false,
        wasCancelled: true
      };
    },
    async runtimeGetDissection(actorUserId, dissectionId) {
      return {
        id: dissectionId,
        owner_user_id: actorUserId,
        status: 'cancelled',
        depth: 'standard',
        result_json: '{}',
        meta_json: '{}',
        revision: 3
      };
    },
    async runtimeRequeueDissection(actorUserId, dissectionId, retryState) {
      retryCalledWith = [actorUserId, dissectionId, retryState];
      return {
        id: dissectionId,
        owner_user_id: actorUserId,
        status: 'queued',
        revision: 4,
        estimated_credits: 50,
        actual_credits: 10,
        result_json: '{}',
        meta_json: '{}'
      };
    }
  };

  const mutationService = createPostgresDissectionMutationService({
    postgresRepository: repository,
    readBody: async () => ({}),
    getAuthUser: () => ({ user: { email: 'test@example.com', userId: 'actor-1' } }),
    postgresActor: () => 'actor-1',
    json: (response, code, payload) => {
      response.writeHead(code, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(payload));
      return payload;
    },
    respondPostgresError: () => {},
    rowToRecord: row => row,
    publicRecord: record => record,
    computeStats: async () => ({}),
    getActiveDissection: () => null,
    acquireUserSlot: () => true,
    releaseUserSlot: () => {},
    scheduleStartDissection: () => {},
    planRetry: async (actorUserId, record, row) => ({
      phaseIndex: 0,
      phase: 'validate',
      progress: 0,
      expectedRevision: row.revision
    })
  });

  const cancelRequest = { method: 'POST', headers: {} };
  const cancelResponse = createMockResponse();
  const handledCancel = await mutationService.dispatch(cancelRequest, cancelResponse, '/api/dissections/d_dispatch_cancel_1/cancel');
  assert.equal(handledCancel, true);
  assert.equal(cancelResponse.statusCode, 200);
  assert.deepEqual(cancelCalledWith, ['actor-1', 'd_dispatch_cancel_1']);

  const retryRequest = { method: 'POST', headers: {} };
  const retryResponse = createMockResponse();
  const handledRetry = await mutationService.dispatch(retryRequest, retryResponse, '/api/dissections/d_dispatch_retry_1/retry');
  assert.equal(handledRetry, true);
  assert.equal(retryResponse.statusCode, 202);
  assert.equal(retryCalledWith[0], 'actor-1');
  assert.equal(retryCalledWith[1], 'd_dispatch_retry_1');

  const unhandledPath = await mutationService.dispatch({ method: 'GET' }, createMockResponse(), '/api/dissections/d_abc/unknown');
  assert.equal(unhandledPath, false);
});
