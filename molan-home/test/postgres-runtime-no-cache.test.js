'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createAuthAccountService } = require('../services/auth-account-service');
const { createGenerationRoutes } = require('../routes/generation');
const { createSkillService } = require('../services/skill-service');
const { createGenerationService } = require('../services/generation-service');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('PG 同步账户入口拒绝缓存读取与未等待的写回', () => {
  const service = createAuthAccountService({
    POSTGRES_MODE: true,
    requestError: (status, message) => Object.assign(new Error(message), { status })
  });
  for (const operation of [
    () => service.loadUsers(),
    () => service.getUserByEmail('owner@example.test'),
    () => service.getUserById('owner'),
    () => service.saveUser({ email: 'owner@example.test' }),
    () => service.saveUsers([])
  ]) assert.throws(operation, /禁止同步账户缓存/);
});

test('PG 预占清理由原生维护身份执行，不依赖账户镜像', async () => {
  const calls = [];
  const context = {
    POSTGRES_MODE: true, Date, CREDIT_RESERVATION_TTL_MS: 1000, SERVER_INSTANCE_ID: 'instance',
    postgresRepository: {
      runtimeMaintenanceActor: async () => 'admin',
      runtimeReleaseStaleTokenUsage: async input => { calls.push(input); return 2; }
    }
  };
  vm.createContext(context);
  const start = source.indexOf('async function releaseStaleCreditReservations()');
  const end = source.indexOf('\nfunction ', start + 1);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), context);
  assert.equal(await context.releaseStaleCreditReservations(), 2);
  assert.equal(calls[0].actorUserId, 'admin');
  assert.equal(calls[0].instanceId, 'instance');
  context.postgresRepository.runtimeMaintenanceActor = async () => '';
  assert.equal(await context.releaseStaleCreditReservations(), 0);
  assert.equal(calls.length, 1);
});

test('PG 同步技能入口拒绝读取空镜像或全量写回', () => {
  const service = createSkillService({
    POSTGRES_MODE: true,
    requestError: (status, message) => Object.assign(new Error(message), { status })
  });
  for (const operation of [
    () => service.loadAllUserSkillRecords(),
    () => service.saveAllUserSkillRecords({}),
    () => service.loadGlobalSkills(),
    () => service.saveGlobalSkills([]),
    () => service.loadOpenSkills(),
    () => service.findOpenSkill('skill')
  ]) assert.throws(operation, /禁止同步技能缓存/);
});

test('PG 健康接口等待原生管理员统计，不访问同步数据库', async () => {
  const responses = [];
  const context = {
    POSTGRES_MODE: true, Date, process, PLATFORM_MODELS: [], DEEPSEEK_KEY: '',
    healthCache: null, healthCacheAt: 0,
    postgresHealth: { available: true },
    chatAdmission: { activeCount: () => 0 },
    getAuthUser: () => ({ user: { userId: 'admin' } }),
    isAdminUser: () => true,
    postgresRepository: { runtimeAdminDataRows: async (actor, type) => {
      assert.equal(actor, 'admin');
      assert.equal(type, 'novels');
      return [{ id: 'novel' }];
    } },
    json: (_res, status, body) => responses.push({ status, body }),
    respondPostgresError: (_res, error) => { throw error; }
  };
  vm.createContext(context);
  const start = source.indexOf('async function handleHealth(');
  const end = source.indexOf('\n/*', start + 1);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), context);
  await context.handleHealth({}, {});
  assert.equal(responses[0].body.db, 'ready');
  assert.equal(responses[0].body.novels, 1);
});

test('健康路由等待异步处理完成并传播错误', async () => {
  let release;
  let finished = false;
  const routes = createGenerationRoutes({
    health: () => new Promise(resolve => { release = resolve; })
  });
  const result = routes.dispatchCore({ method: 'GET' }, {}, '/api/health').then(value => {
    finished = true;
    return value;
  });
  await Promise.resolve();
  assert.equal(finished, false);
  release();
  assert.equal(await result, true);
  assert.equal(await routes.dispatchCore({ method: 'GET' }, {}, '/unknown'), false);
  const rejected = createGenerationRoutes({ health: async () => { throw new Error('PG unavailable'); } });
  await assert.rejects(rejected.dispatchCore({ method: 'GET' }, {}, '/api/health'), /PG unavailable/);
});

test('PG 生成能力按原生仓储公布暂停恢复与中断恢复', async () => {
  let response;
  const service = createGenerationService({
    POSTGRES_MODE: true,
    getAuthUser: () => ({ user: { userId: 'owner' } }),
    postgresActor: auth => auth.user.userId,
    generationRunStore: () => ({
      requestPause() {}, resumeRun() {}, recoverExpiredRuns() {}
    }),
    postgresRepository: { commitChapter() {} },
    generationV2Enabled: () => true,
    generationV2Status: enabled => ({ enabled }),
    json: (_res, status, body) => { response = { status, body }; }
  });
  await service.handleGenerationRuns({ method: 'GET', headers: {} }, {}, '/api/generation-runs/capabilities');
  assert.equal(response.status, 200);
  assert.equal(response.body.storageMode, 'postgres');
  assert.equal(response.body.pauseResume, true);
  assert.equal(response.body.recovery, true);
  assert.equal(response.body.commit, true);
});
