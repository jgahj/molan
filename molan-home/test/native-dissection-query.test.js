'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonFileRepository } = require('../lib/repositories/json-file-repository');
const { JsonDissectionRepository } = require('../lib/repositories/json-dissection-repository');
const {
  createNativeDissectionQueryService,
  compareEntityDeterministic,
  parseSafeNumberOrNull,
  parseSafeNonNegativeIntegerOrNull,
  parseSafeRatioOrNull
} = require('../services/native-dissection-query-service');
const helpers = require('../services/dissection-input-service').createDissectionInputService({
  crypto: require('node:crypto'),
  DISSECTION_CHUNK_CHARS: 12000,
  DISSECTION_MAX_UNITS: 100,
  DISSECTION_NOISE_ANCHORED: /$a/,
  DISSECTION_NOISE_ANYWHERE: /$a/
});
const resultHelpers = {
  normalizeDissectionStageResult: value => value,
  mergeDissectionResult: (a, b) => ({ ...a, ...b }),
  dissectionStageMissingFields: () => []
};

async function createFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-dissection-query-test-'));
  const fileRepo = new JsonFileRepository(directory);
  t.after(async () => {
    try { await fileRepo.close(); } catch (_) {}
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch (_) {}
  });
  await fileRepo.accounts.put(null, { id: 'account:alice', kind: 'account', userId: 'alice', email: 'alice@test.com', role: 'user' }, 0);
  await fileRepo.accounts.put(null, { id: 'account:bob', kind: 'account', userId: 'bob', email: 'bob@test.com', role: 'user' }, 0);
  await fileRepo.accounts.put(null, { id: 'account:charlie', kind: 'account', userId: 'charlie', email: 'charlie@test.com', role: 'user' }, 0);
  const repo = new JsonDissectionRepository(fileRepo, { inputService: helpers, resultService: resultHelpers, phases: ['overview', 'entities'] });
  return { directory, fileRepo, repo };
}

test('searchUnits returns matching snippets and handles short query', async t => {
  const { repo } = await createFixture(t);
  const job = await repo.create({
    actorUserId: 'alice',
    requestId: 'req-search-1',
    title: '修仙传说',
    sourceText: '第一章 宗门大比。林动站在演武场上，神色淡定。第二章 青檀心事。林动回到了自己的竹屋。'
  });
  const shortSearch = await repo.searchUnits({ actorUserId: 'alice', jobId: job.id, query: '林' });
  assert.equal(shortSearch.items.length, 0);
  assert.equal(shortSearch.query, '林');
  const found = await repo.searchUnits({ actorUserId: 'alice', jobId: job.id, query: '演武场' });
  assert.ok(found.items.length >= 1);
  assert.equal(found.query, '演武场');
  assert.ok(found.items[0].snippet.includes('[演武场]'));
  const notFound = await repo.searchUnits({ actorUserId: 'alice', jobId: job.id, query: '不存在的内容' });
  assert.equal(notFound.items.length, 0);
});

test('getQueryData reads job and units with zero writes to ledger or revision', async t => {
  const { fileRepo, repo } = await createFixture(t);
  const job = await repo.create({
    actorUserId: 'alice',
    requestId: 'req-stats-1',
    title: '数据统计',
    sourceText: '第一章 天下。正文内容在这里。'
  });
  const initialJob = await repo.get({ actorUserId: 'alice', jobId: job.id });
  const initialRevision = initialJob.revision;
  const historyBefore = await repo.listHistory({ actorUserId: 'alice', jobId: job.id });
  const ledgerCountBefore = historyBefore.length;
  for (let i = 0; i < 5; i++) {
    const data = await repo.getQueryData({ actorUserId: 'alice', jobId: job.id });
    assert.equal(data.job.id, job.id);
    assert.ok(data.unitTotal >= 1);
    await repo.searchUnits({ actorUserId: 'alice', jobId: job.id, query: '天下' });
  }
  const jobAfter = await repo.get({ actorUserId: 'alice', jobId: job.id });
  assert.equal(jobAfter.revision, initialRevision);
  const historyAfter = await repo.listHistory({ actorUserId: 'alice', jobId: job.id });
  assert.equal(historyAfter.length, ledgerCountBefore);
});

test('entities query paginates and sorts by mention count and canonical name', async t => {
  const { repo } = await createFixture(t);
  const job = await repo.create({
    actorUserId: 'alice',
    requestId: 'req-ent-1',
    title: '人物测试',
    sourceText: '正文一段'
  });
  const lease = await repo.acquireLease({ actorUserId: 'alice', jobId: job.id, workerId: 'w1', leaseMs: 10000 });
  const stageResult = {
    characters: [
      { id: 'c3', name: '王腾', role: 'antagonist', count: 5 },
      { id: 'c1', name: '林动', role: 'protagonist', count: 10 },
      { id: 'c2', name: '青檀', role: 'protagonist', count: 10 },
      { id: 'c4', name: '绫清竹', role: 'heroine', count: 2 }
    ]
  };
  await repo.appendStageRun({
    actorUserId: 'alice',
    jobId: job.id,
    ...lease,
    requestId: 'stage-ent-1',
    stageId: 'entities',
    result: stageResult,
    expectedRevision: lease.revision
  });
  function mockRes() {
    return {
      statusCode: 200,
      headers: {},
      data: null,
      writeHead(code, h) { this.statusCode = code; this.headers = h; },
      end(body) { this.data = body; }
    };
  }
  const queryService = createNativeDissectionQueryService({
    repository: repo,
    getAuthUser: () => ({ user: { userId: 'alice' } }),
    json: (res, code, obj) => { res.statusCode = code; res.data = obj; }
  });
  const page1Res = mockRes();
  await queryService.handleEntities({ url: '/api/dissections/' + job.id + '/entities?limit=2' }, page1Res, job.id);
  assert.equal(page1Res.statusCode, 200);
  assert.equal(page1Res.data.items.length, 2);
  assert.equal(page1Res.data.items[0].canonical_name, '林动');
  assert.equal(page1Res.data.items[1].canonical_name, '青檀');
  assert.ok(page1Res.data.next);
  const page2Res = mockRes();
  await queryService.handleEntities({ url: '/api/dissections/' + job.id + '/entities?limit=2&cursor=' + page1Res.data.next }, page2Res, job.id);
  assert.equal(page2Res.statusCode, 200);
  assert.equal(page2Res.data.items.length, 2);
  assert.equal(page2Res.data.items[0].canonical_name, '王腾');
  assert.equal(page2Res.data.items[1].canonical_name, '绫清竹');
  assert.equal(page2Res.data.next, '');
});

test('foreshadows and summaries pagination and missing source explicit reporting', async t => {
  const { repo } = await createFixture(t);
  const emptyJob = await repo.create({
    actorUserId: 'alice',
    requestId: 'req-empty-1',
    title: '空任务',
    sourceText: '正文一段'
  });
  function mockRes() {
    return {
      statusCode: 200,
      headers: {},
      data: null,
      writeHead(code, h) { this.statusCode = code; this.headers = h; },
      end(body) { this.data = body; }
    };
  }
  const queryService = createNativeDissectionQueryService({
    repository: repo,
    getAuthUser: () => ({ user: { userId: 'alice' } }),
    json: (res, code, obj) => { res.statusCode = code; res.data = obj; }
  });
  const emptyForeshadows = mockRes();
  await queryService.handleForeshadows({ url: '/api/dissections/' + emptyJob.id + '/foreshadows' }, emptyForeshadows, emptyJob.id);
  assert.equal(emptyForeshadows.statusCode, 200);
  assert.equal(emptyForeshadows.data.items.length, 0);
  assert.equal(emptyForeshadows.data.source, 'missing');
  const emptySummaries = mockRes();
  await queryService.handleSummaries({ url: '/api/dissections/' + emptyJob.id + '/summaries' }, emptySummaries, emptyJob.id);
  assert.equal(emptySummaries.statusCode, 200);
  assert.equal(emptySummaries.data.items.length, 0);
  assert.equal(emptySummaries.data.source, 'missing');
  const lease = await repo.acquireLease({ actorUserId: 'alice', jobId: emptyJob.id, workerId: 'w2', leaseMs: 10000 });
  await repo.appendStageRun({
    actorUserId: 'alice',
    jobId: emptyJob.id,
    ...lease,
    requestId: 'stage-full-1',
    stageId: 'overview',
    result: {
      foreshadowing: [
        { id: 'f1', title: '古玉秘密', status: 'setup', setupChapter: 1 },
        { id: 'f2', title: '祖符觉醒', status: 'resolved', setupChapter: 2, payoffChapter: 50 },
        { id: 'f3', title: '黑白双圣', status: 'setup', setupChapter: 3 }
      ],
      volumeSummaries: [
        { id: 'v1', title: '青阳篇', summary: '少年崛起' },
        { id: 'v2', title: '大荒篇', summary: '宗门试炼' }
      ]
    },
    expectedRevision: lease.revision
  });
  const filteredForeshadows = mockRes();
  await queryService.handleForeshadows({ url: '/api/dissections/' + emptyJob.id + '/foreshadows?status=setup' }, filteredForeshadows, emptyJob.id);
  assert.equal(filteredForeshadows.statusCode, 200);
  assert.equal(filteredForeshadows.data.items.length, 2);
  assert.equal(filteredForeshadows.data.source, 'native-result');
  const populatedSummaries = mockRes();
  await queryService.handleSummaries({ url: '/api/dissections/' + emptyJob.id + '/summaries?type=volume' }, populatedSummaries, emptyJob.id);
  assert.equal(populatedSummaries.statusCode, 200);
  assert.equal(populatedSummaries.data.items.length, 2);
  assert.equal(populatedSummaries.data.type, 'volume');
  assert.equal(populatedSummaries.data.source, 'native-result');
});

test('coverage and validation report authentic status and do not fake pipeline', async t => {
  const { repo } = await createFixture(t);
  const job = await repo.create({
    actorUserId: 'alice',
    requestId: 'req-cov-1',
    title: '覆盖率任务',
    sourceText: '正文一段。第二章正文。'
  });
  function mockRes() {
    return {
      statusCode: 200,
      headers: {},
      data: null,
      writeHead(code, h) { this.statusCode = code; this.headers = h; },
      end(body) { this.data = body; }
    };
  }
  const queryService = createNativeDissectionQueryService({
    repository: repo,
    getAuthUser: () => ({ user: { userId: 'alice' } }),
    json: (res, code, obj) => { res.statusCode = code; res.data = obj; }
  });
  const covRes = mockRes();
  await queryService.handleCoverage({ url: '/api/dissections/' + job.id + '/coverage' }, covRes, job.id);
  assert.equal(covRes.statusCode, 200);
  assert.equal(covRes.data.coverage.aggregated, false);
  assert.equal(covRes.data.coverage.batchDone, null);
  assert.equal(covRes.data.coverage.pipelineAvailable, false);
  assert.ok(covRes.data.coverage.unitTotal >= 1);
  const valRes = mockRes();
  await queryService.handleValidation({ url: '/api/dissections/' + job.id + '/validation' }, valRes, job.id);
  assert.equal(valRes.statusCode, 200);
  assert.equal(valRes.data.validation.conclusion, 'unknown');
  assert.equal(valRes.data.validation.source, 'missing');
});

test('export handles incomplete 409 and complete JSON markdown docx', async t => {
  const { repo } = await createFixture(t);
  const job = await repo.create({
    actorUserId: 'alice',
    requestId: 'req-exp-1',
    title: '导出小说',
    sourceText: '第一章 乾坤。正文开始。'
  });
  function mockRes() {
    return {
      statusCode: 200,
      headers: {},
      data: null,
      writeHead(code, h) { this.statusCode = code; this.headers = h; },
      end(body) { this.data = body; }
    };
  }
  const queryService = createNativeDissectionQueryService({
    repository: repo,
    getAuthUser: () => ({ user: { userId: 'alice' } }),
    json: (res, code, obj) => { res.statusCode = code; res.data = obj; },
    hasCompleteContent: (result) => Boolean(result && result.overview)
  });
  const incompleteRes = mockRes();
  await queryService.handleExport({ url: '/api/dissections/' + job.id + '/export' }, incompleteRes, job.id);
  assert.equal(incompleteRes.statusCode, 409);
  const lease = await repo.acquireLease({ actorUserId: 'alice', jobId: job.id, workerId: 'w3', leaseMs: 10000 });
  const stage1 = await repo.appendStageRun({
    actorUserId: 'alice',
    jobId: job.id,
    ...lease,
    requestId: 'stage-exp-1',
    stageId: 'overview',
    result: { overview: '大千世界' },
    expectedRevision: lease.revision
  });
  const stage2 = await repo.appendStageRun({
    actorUserId: 'alice',
    jobId: job.id,
    ...lease,
    requestId: 'stage-exp-2',
    stageId: 'entities',
    result: { characters: [{ name: '牧尘' }] },
    expectedRevision: stage1.revision
  });
  await repo.complete({ actorUserId: 'alice', jobId: job.id, ...lease, expectedRevision: stage2.revision });
  const jsonRes = mockRes();
  await queryService.handleExport({ url: '/api/dissections/' + job.id + '/export?format=json' }, jsonRes, job.id);
  assert.equal(jsonRes.statusCode, 200);
  assert.ok(jsonRes.headers['Content-Type'].includes('application/json'));
  assert.ok(jsonRes.headers['Content-Disposition'].includes('dissection-' + job.id + '.json'));
  const exported = JSON.parse(jsonRes.data);
  assert.equal(exported.id, job.id);
  assert.equal(exported.sourceText, undefined);
  const mdRes = mockRes();
  await queryService.handleExport({ url: '/api/dissections/' + job.id + '/export?format=markdown' }, mdRes, job.id);
  assert.equal(mdRes.statusCode, 200);
  assert.ok(mdRes.headers['Content-Type'].includes('text/markdown'));
  assert.ok(mdRes.data.includes('# 导出小说'));
  assert.ok(mdRes.data.includes('## 概览'));
  const docxRes = mockRes();
  await queryService.handleExport({ url: '/api/dissections/' + job.id + '/export?format=docx' }, docxRes, job.id);
  assert.equal(docxRes.statusCode, 200);
  assert.ok(docxRes.headers['Content-Type'].includes('wordprocessingml.document'));
  assert.ok(Buffer.isBuffer(docxRes.data));
  assert.ok(docxRes.data.length > 500);
});

test('restart persistence preserves queryable data across repository reloads', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-dissection-restart-'));
  const fileRepo = new JsonFileRepository(directory);
  try {
    await fileRepo.accounts.put(null, { id: 'account:alice', kind: 'account', userId: 'alice', email: 'alice@test.com', role: 'user' }, 0);
    const repo = new JsonDissectionRepository(fileRepo, { inputService: helpers, resultService: resultHelpers, phases: ['overview', 'entities'] });
    const job = await repo.create({
      actorUserId: 'alice',
      requestId: 'req-restart-1',
      title: '持久化任务',
      sourceText: '第一章 纪元。天地初开。'
    });
    const lease = await repo.acquireLease({ actorUserId: 'alice', jobId: job.id, workerId: 'w4', leaseMs: 10000 });
    const stage1 = await repo.appendStageRun({
      actorUserId: 'alice',
      jobId: job.id,
      ...lease,
      requestId: 'stage-res-1',
      stageId: 'overview',
      result: { overview: '天地初开', characters: [{ name: '盘古', count: 100 }] },
      expectedRevision: lease.revision
    });
    await repo.appendStageRun({
      actorUserId: 'alice',
      jobId: job.id,
      ...lease,
      requestId: 'stage-res-2',
      stageId: 'entities',
      result: { characters: [{ name: '女娲', count: 90 }] },
      expectedRevision: stage1.revision
    });
    await fileRepo.close();
    const reopenedFileRepo = new JsonFileRepository(directory);
    try {
      const reopenedDissectionRepo = new JsonDissectionRepository(reopenedFileRepo, {
        inputService: helpers,
        resultService: resultHelpers,
        phases: ['overview', 'entities']
      });
      const queryData = await reopenedDissectionRepo.getQueryData({ actorUserId: 'alice', jobId: job.id });
      assert.equal(queryData.job.id, job.id);
      assert.equal(queryData.job.title, '持久化任务');
      assert.ok(queryData.stages.length >= 2);
      const searchFound = await reopenedDissectionRepo.searchUnits({ actorUserId: 'alice', jobId: job.id, query: '天地初开' });
      assert.equal(searchFound.items.length, 1);
    } finally {
      await reopenedFileRepo.close();
    }
  } finally {
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch (_) {}
  }
});

test('searchUnits enforces authentication and access before short or empty query check', async t => {
  const { repo, fileRepo } = await createFixture(t);
  const job = await repo.create({
    actorUserId: 'alice',
    requestId: 'req-search-auth',
    title: '权限测试',
    sourceText: '第一章 天下无双。神州大地。'
  });

  // 匿名/未登录：短查询与空查询均必须拒绝 401
  await assert.rejects(
    repo.searchUnits({ actorUserId: 'non_existent_user', jobId: job.id, query: '' }),
    err => err.code === 'UNAUTHENTICATED' && (err.status === 401 || err.statusCode === 401)
  );
  await assert.rejects(
    repo.searchUnits({ actorUserId: '', jobId: job.id, query: '天' }),
    err => err.code === 'UNAUTHENTICATED' && (err.status === 401 || err.statusCode === 401)
  );

  // 跨用户：短查询与空查询均必须拒绝 404
  await assert.rejects(
    repo.searchUnits({ actorUserId: 'bob', jobId: job.id, query: '' }),
    err => err.code === 'FORBIDDEN' && (err.status === 404 || err.statusCode === 404)
  );
  await assert.rejects(
    repo.searchUnits({ actorUserId: 'bob', jobId: job.id, query: '天' }),
    err => err.code === 'FORBIDDEN' && (err.status === 404 || err.statusCode === 404)
  );

  // 软删除/删除后：短查询与空查询均必须拒绝 404
  const deletedJob = await repo.create({
    actorUserId: 'alice',
    requestId: 'req-search-del',
    title: '软删除任务',
    sourceText: '第一章 飞升。'
  });
  await repo.delete({ actorUserId: 'alice', jobId: deletedJob.id, expectedRevision: deletedJob.revision });
  await assert.rejects(
    repo.searchUnits({ actorUserId: 'alice', jobId: deletedJob.id, query: '' }),
    err => err.code === 'DISSECTION_NOT_FOUND' && (err.status === 404 || err.statusCode === 404)
  );
  await assert.rejects(
    repo.searchUnits({ actorUserId: 'alice', jobId: deletedJob.id, query: '飞' }),
    err => err.code === 'DISSECTION_NOT_FOUND' && (err.status === 404 || err.statusCode === 404)
  );

  // 软删除标记 (deleted: true)
  const softJob = await repo.create({
    actorUserId: 'alice',
    requestId: 'req-search-soft',
    title: '软删除任务2',
    sourceText: '第一章 陨落。'
  });
  await fileRepo.transaction([null, '__molan_dissections_v1__'], tx => {
    const idx = tx.get('__molan_dissections_v1__', 'novels', 'dissection:index:' + softJob.id);
    tx.put('__molan_dissections_v1__', 'novels', { ...idx, deleted: true }, idx.revision);
  });
  await assert.rejects(
    repo.searchUnits({ actorUserId: 'alice', jobId: softJob.id, query: '' }),
    err => err.code === 'DISSECTION_NOT_FOUND' && (err.status === 404 || err.statusCode === 404)
  );
  await assert.rejects(
    repo.searchUnits({ actorUserId: 'alice', jobId: softJob.id, query: '陨' }),
    err => err.code === 'DISSECTION_NOT_FOUND' && (err.status === 404 || err.statusCode === 404)
  );

  // 合法所有者：空查询和短查询鉴权后安全返回
  const emptyRes = await repo.searchUnits({ actorUserId: 'alice', jobId: job.id, query: '' });
  assert.deepEqual(emptyRes.items, []);
  assert.equal(emptyRes.query, '');
  const shortRes = await repo.searchUnits({ actorUserId: 'alice', jobId: job.id, query: '天' });
  assert.deepEqual(shortRes.items, []);
  assert.equal(shortRes.query, '天');
});

test('export rejects when integrity validator is missing or incomplete, without faking complete from non-empty result', async t => {
  const { repo } = await createFixture(t);
  const job = await repo.create({
    actorUserId: 'alice',
    requestId: 'req-exp-val',
    title: '导出验证',
    sourceText: '第一章 开始。'
  });
  const lease = await repo.acquireLease({ actorUserId: 'alice', jobId: job.id, workerId: 'w-val', leaseMs: 10000 });
  const stage = await repo.appendStageRun({
    actorUserId: 'alice',
    jobId: job.id,
    ...lease,
    requestId: 'stage-exp-val-1',
    stageId: 'overview',
    result: { overview: '已有结果，但无验证器' },
    expectedRevision: lease.revision
  });
  await repo.appendStageRun({
    actorUserId: 'alice',
    jobId: job.id,
    ...lease,
    requestId: 'stage-exp-val-2',
    stageId: 'entities',
    result: { characters: [{ name: '主角' }] },
    expectedRevision: stage.revision
  });
  const current = await repo.get({ actorUserId: 'alice', jobId: job.id });
  const completed = await repo.complete({ actorUserId: 'alice', jobId: job.id, ...lease, expectedRevision: current.revision });
  assert.equal(completed.status, 'completed');
  assert.ok(Object.keys(completed.result).length > 0);

  function mockRes() {
    return {
      statusCode: 200,
      headers: {},
      data: null,
      writeHead(code, h) { this.statusCode = code; this.headers = h; },
      end(body) { this.data = body; }
    };
  }

  // 1. 未提供 hasCompleteContent 验证器（缺少依赖），即使 result 非空且 status=completed 也必须拒绝 409
  const noValidatorService = createNativeDissectionQueryService({
    repository: repo,
    getAuthUser: () => ({ user: { userId: 'alice' } }),
    json: (res, code, obj) => { res.statusCode = code; res.data = obj; }
  });
  const res1 = mockRes();
  await noValidatorService.handleExport({ url: '/api/dissections/' + job.id + '/export' }, res1, job.id);
  assert.equal(res1.statusCode, 409);
  assert.equal(res1.data.code, 'DISSECTION_INCOMPLETE');

  // 2. 提供验证器但判定不完整，必须拒绝 409
  const failingValidatorService = createNativeDissectionQueryService({
    repository: repo,
    getAuthUser: () => ({ user: { userId: 'alice' } }),
    json: (res, code, obj) => { res.statusCode = code; res.data = obj; },
    hasCompleteContent: () => false
  });
  const res2 = mockRes();
  await failingValidatorService.handleExport({ url: '/api/dissections/' + job.id + '/export' }, res2, job.id);
  assert.equal(res2.statusCode, 409);
  assert.equal(res2.data.code, 'DISSECTION_INCOMPLETE');

  // 3. 提供真实完整性验证器且通过后，允许导出
  const validService = createNativeDissectionQueryService({
    repository: repo,
    getAuthUser: () => ({ user: { userId: 'alice' } }),
    json: (res, code, obj) => { res.statusCode = code; res.data = obj; },
    hasCompleteContent: (res) => Boolean(res && res.overview)
  });
  const res3 = mockRes();
  await validService.handleExport({ url: '/api/dissections/' + job.id + '/export?format=json' }, res3, job.id);
  assert.equal(res3.statusCode, 200);
});

test('entities and foreshadows preserve real zero, use null/unknown when missing, and paginate deterministically across Chinese/Latin/special chars', async t => {
  const { repo } = await createFixture(t);
  const job = await repo.create({
    actorUserId: 'alice',
    requestId: 'req-ent-det',
    title: '确定性实体与伏笔测试',
    sourceText: '正文一段'
  });
  const lease = await repo.acquireLease({ actorUserId: 'alice', jobId: job.id, workerId: 'w-det', leaseMs: 10000 });

  const characters = [
    { id: 'c_zh_1', name: '林动', count: 10, status: 'confirmed' },
    { id: 'c_zh_2', name: '青檀', count: 10, status: 'confirmed' },
    { id: 'c_en_1', name: 'Alice', count: 5 },
    { id: 'c_en_2', name: 'Bob', count: 5 },
    { id: 'c_spec_1', name: '★星神★', count: 5, status: 'candidate' },
    { id: 'c_spec_2', name: '·神秘客·', count: 0, status: 'confirmed' },
    { id: 'c_zero_2', name: '无名小卒', count: 0 },
    { id: 'c_null_1', name: '云中隐士' },
    { id: 'c_null_2', name: '@观察者#', status: 'candidate' }
  ];

  const foreshadowing = [
    { id: 'f_zero', title: '零置信度伏笔', confidence: 0, strength: 'weak', status: 'setup' },
    { id: 'f_missing', title: '缺失元数据伏笔' },
    { id: 'f_full', title: '完整伏笔', confidence: 0.95, strength: 'strong', status: 'resolved' }
  ];

  await repo.appendStageRun({
    actorUserId: 'alice',
    jobId: job.id,
    ...lease,
    requestId: 'stage-det-1',
    stageId: 'entities',
    result: { characters, foreshadowing },
    expectedRevision: lease.revision
  });

  function mockRes() {
    return {
      statusCode: 200,
      headers: {},
      data: null,
      writeHead(code, h) { this.statusCode = code; this.headers = h; },
      end(body) { this.data = body; }
    };
  }

  const queryService = createNativeDissectionQueryService({
    repository: repo,
    getAuthUser: () => ({ user: { userId: 'alice' } }),
    json: (res, code, obj) => { res.statusCode = code; res.data = obj; }
  });

  // 1. 验证 foreshadows 缺 confidence/strength null、status unknown，真实零保留
  const foresRes = mockRes();
  await queryService.handleForeshadows({ url: '/api/dissections/' + job.id + '/foreshadows' }, foresRes, job.id);
  assert.equal(foresRes.statusCode, 200);
  const fZero = foresRes.data.items.find(x => x.id === 'f_zero');
  assert.equal(fZero.confidence, 0);
  assert.equal(fZero.strength, 'weak');
  assert.equal(fZero.status, 'setup');

  const fMissing = foresRes.data.items.find(x => x.id === 'f_missing');
  assert.equal(fMissing.confidence, null);
  assert.equal(fMissing.strength, null);
  assert.equal(fMissing.status, 'unknown');

  const fFull = foresRes.data.items.find(x => x.id === 'f_full');
  assert.equal(fFull.confidence, 0.95);
  assert.equal(fFull.strength, 'strong');
  assert.equal(fFull.status, 'resolved');

  // 2. 验证 entities 缺 mention_count 用 null、status unknown，真实零保留
  // 并且使用 limit: 2 遍历分页，验证跨中英特殊字符多页无重复无丢失
  const collected = [];
  let cursor = '';
  let pageCount = 0;
  while (true) {
    pageCount++;
    const res = mockRes();
    const url = '/api/dissections/' + job.id + '/entities?limit=2' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    await queryService.handleEntities({ url }, res, job.id);
    assert.equal(res.statusCode, 200);
    assert.ok(res.data.items.length <= 2);
    collected.push(...res.data.items);
    if (!res.data.next) break;
    cursor = res.data.next;
    assert.ok(pageCount <= 10, '分页过多，可能出现死循环');
  }

  assert.equal(collected.length, characters.length);
  const seenIds = new Set(collected.map(x => x.id));
  assert.equal(seenIds.size, characters.length);

  const spec2 = collected.find(x => x.id === 'c_spec_2');
  assert.equal(spec2.mention_count, 0);
  assert.equal(spec2.status, 'confirmed');

  const zero2 = collected.find(x => x.id === 'c_zero_2');
  assert.equal(zero2.mention_count, 0);
  assert.equal(zero2.status, 'unknown');

  const null1 = collected.find(x => x.id === 'c_null_1');
  assert.equal(null1.mention_count, null);
  assert.equal(null1.status, 'unknown');

  const null2 = collected.find(x => x.id === 'c_null_2');
  assert.equal(null2.mention_count, null);
  assert.equal(null2.status, 'candidate');

  // 验证排序：非空数值降序排在前，null 计数排在最后
  const firstNullIdx = collected.findIndex(x => x.mention_count === null);
  assert.ok(firstNullIdx >= 0);
  for (let i = firstNullIdx; i < collected.length; i++) {
    assert.equal(collected[i].mention_count, null, 'null 计数必须排在最后');
  }
  for (let i = 0; i < firstNullIdx - 1; i++) {
    assert.ok(collected[i].mention_count >= collected[i + 1].mention_count);
  }
  const zeroIdx = collected.findIndex(x => x.mention_count === 0);
  assert.ok(zeroIdx < firstNullIdx);
});

test('coverage distinguishes authentic domain statistics from resultCounts and preserves null/real zero', async t => {
  const { repo } = await createFixture(t);
  const job = await repo.create({
    actorUserId: 'alice',
    requestId: 'req-cov-auth',
    title: '覆盖率台账测试',
    sourceText: '第一章 宗门。第二章 远行。'
  });
  const lease = await repo.acquireLease({ actorUserId: 'alice', jobId: job.id, workerId: 'w-cov', leaseMs: 10000 });

  await repo.appendStageRun({
    actorUserId: 'alice',
    jobId: job.id,
    ...lease,
    requestId: 'stage-cov-1',
    stageId: 'overview',
    result: {
      characters: [{ id: 'c1', name: '林动' }, { id: 'c2', name: '青檀' }],
      storyTree: [{ id: 'e1', title: '大比' }, { id: 'e2', title: '夺冠' }, { id: 'e3', title: '离家' }],
      foreshadowing: [{ id: 'f1', title: '祖符' }],
      volumeSummaries: [{ id: 'v1', title: '第一卷' }]
    },
    expectedRevision: lease.revision
  });

  function mockRes() {
    return {
      statusCode: 200,
      headers: {},
      data: null,
      writeHead(code, h) { this.statusCode = code; this.headers = h; },
      end(body) { this.data = body; }
    };
  }

  const queryService = createNativeDissectionQueryService({
    repository: repo,
    getAuthUser: () => ({ user: { userId: 'alice' } }),
    json: (res, code, obj) => { res.statusCode = code; res.data = obj; }
  });

  // 1. 无 pipeline 权威台账时：权威领域统计全部为 null，不得拿 characters/storyTree 伪装
  const res1 = mockRes();
  await queryService.handleCoverage({ url: '/api/dissections/' + job.id + '/coverage' }, res1, job.id);
  assert.equal(res1.statusCode, 200);
  const cov1 = res1.data.coverage;
  assert.equal(cov1.entities, null);
  assert.equal(cov1.events, null);
  assert.equal(cov1.foreshadows, null);
  assert.equal(cov1.summaries, null);
  assert.equal(cov1.candidates, null);
  assert.equal(cov1.mentions, null);
  assert.equal(cov1.claims, null);
  assert.equal(cov1.edges, null);
  assert.equal(cov1.states, null);
  assert.equal(cov1.factCoverage, null);
  assert.equal(cov1.authoritySource, 'missing');
  assert.equal(cov1.source, 'native-result');

  assert.ok(cov1.resultCounts);
  assert.equal(cov1.resultCounts.entities, 2);
  assert.equal(cov1.resultCounts.events, 3);
  assert.equal(cov1.resultCounts.foreshadows, 1);
  assert.equal(cov1.resultCounts.summaries, 1);
  assert.equal(cov1.resultCounts.source, 'native-result');

  // 2. 当存在 pipeline 权威统计，包含真实零 (entities: 0, factCoverage: 0) 时，真实零必须保留
  const job2 = await repo.create({
    actorUserId: 'alice',
    requestId: 'req-cov-pipe',
    title: '权威流水线任务',
    sourceText: '第一章 苍穹。'
  });
  const fileRepo = repo.repository;
  await fileRepo.transaction([null, '__molan_dissections_v1__'], tx => {
    const row = tx.get('__molan_dissections_v1__', 'novels', 'dissection:job:' + job2.id);
    tx.put('__molan_dissections_v1__', 'novels', {
      ...row,
      meta: {
        pipeline: {
          aggregated: true,
          factCoverage: 0,
          entities: 0,
          events: 5,
          candidates: 12,
          mentions: 88,
          claims: 3,
          foreshadows: 0,
          edges: 1,
          states: 2,
          validationStatus: 'passed'
        }
      }
    }, row.revision);
  });

  const res2 = mockRes();
  await queryService.handleCoverage({ url: '/api/dissections/' + job2.id + '/coverage' }, res2, job2.id);
  assert.equal(res2.statusCode, 200);
  const cov2 = res2.data.coverage;
  assert.equal(cov2.aggregated, true);
  assert.equal(cov2.factCoverage, 0);
  assert.equal(cov2.entities, 0);
  assert.equal(cov2.foreshadows, 0);
  assert.equal(cov2.events, 5);
  assert.equal(cov2.candidates, 12);
  assert.equal(cov2.mentions, 88);
  assert.equal(cov2.validationStatus, 'passed');
  assert.equal(cov2.authoritySource, 'pipeline-meta');
  assert.equal(cov2.source, 'pipeline-meta');
});

test('safe parsers reject boolean, whitespace, array, negative, float counts and preserve real zero', () => {
  assert.equal(parseSafeNumberOrNull(true), null);
  assert.equal(parseSafeNumberOrNull(false), null);
  assert.equal(parseSafeNumberOrNull(''), null);
  assert.equal(parseSafeNumberOrNull('   '), null);
  assert.equal(parseSafeNumberOrNull('\t\r\n'), null);
  assert.equal(parseSafeNumberOrNull([]), null);
  assert.equal(parseSafeNumberOrNull([1]), null);
  assert.equal(parseSafeNumberOrNull({}), null);
  assert.equal(parseSafeNumberOrNull(0), 0);
  assert.equal(parseSafeNumberOrNull('0'), 0);
  assert.equal(parseSafeNumberOrNull(42), 42);
  assert.equal(parseSafeNumberOrNull('42'), 42);
  assert.equal(parseSafeNumberOrNull(-5), -5);
  assert.equal(parseSafeNumberOrNull(3.14), 3.14);

  assert.equal(parseSafeNonNegativeIntegerOrNull(true), null);
  assert.equal(parseSafeNonNegativeIntegerOrNull(false), null);
  assert.equal(parseSafeNonNegativeIntegerOrNull(''), null);
  assert.equal(parseSafeNonNegativeIntegerOrNull('   '), null);
  assert.equal(parseSafeNonNegativeIntegerOrNull([]), null);
  assert.equal(parseSafeNonNegativeIntegerOrNull({}), null);
  assert.equal(parseSafeNonNegativeIntegerOrNull(-1), null);
  assert.equal(parseSafeNonNegativeIntegerOrNull('-1'), null);
  assert.equal(parseSafeNonNegativeIntegerOrNull(1.5), null);
  assert.equal(parseSafeNonNegativeIntegerOrNull('2.7'), null);
  assert.equal(parseSafeNonNegativeIntegerOrNull(0), 0);
  assert.equal(parseSafeNonNegativeIntegerOrNull('0'), 0);
  assert.equal(parseSafeNonNegativeIntegerOrNull(10), 10);
  assert.equal(parseSafeNonNegativeIntegerOrNull('10'), 10);

  assert.equal(parseSafeRatioOrNull(true), null);
  assert.equal(parseSafeRatioOrNull(false), null);
  assert.equal(parseSafeRatioOrNull(''), null);
  assert.equal(parseSafeRatioOrNull('   '), null);
  assert.equal(parseSafeRatioOrNull([]), null);
  assert.equal(parseSafeRatioOrNull({}), null);
  assert.equal(parseSafeRatioOrNull(-0.1), null);
  assert.equal(parseSafeRatioOrNull(1.1), null);
  assert.equal(parseSafeRatioOrNull(2), null);
  assert.equal(parseSafeRatioOrNull(0), 0);
  assert.equal(parseSafeRatioOrNull('0'), 0);
  assert.equal(parseSafeRatioOrNull(1), 1);
  assert.equal(parseSafeRatioOrNull('1'), 1);
  assert.equal(parseSafeRatioOrNull(0.85), 0.85);
  assert.equal(parseSafeRatioOrNull('0.85'), 0.85);
});

test('dissection query service rejects invalid counts and ratios across coverage, entities, and foreshadows while preserving real zero and null', async t => {
  const { repo } = await createFixture(t);
  const job = await repo.create({
    actorUserId: 'alice',
    requestId: 'req-safe-parse-1',
    title: '安全解析测试',
    sourceText: '正文'
  });
  const lease = await repo.acquireLease({ actorUserId: 'alice', jobId: job.id, workerId: 'w-safe', leaseMs: 10000 });
  await repo.appendStageRun({
    actorUserId: 'alice',
    jobId: job.id,
    ...lease,
    requestId: 'stage-safe-1',
    stageId: 'entities',
    result: {
      characters: [
        { id: 'c_zero', name: '真实零角色', count: 0 },
        { id: 'c_str_zero', name: '字符零角色', count: '0' },
        { id: 'c_bool_true', name: '布尔真角色', count: true },
        { id: 'c_bool_false', name: '布尔假角色', count: false },
        { id: 'c_empty', name: '空白角色', count: '   ' },
        { id: 'c_arr', name: '数组角色', count: [10] },
        { id: 'c_neg', name: '负数角色', count: -3 },
        { id: 'c_float', name: '小数角色', count: 4.5 }
      ],
      foreshadowing: [
        { id: 'f_zero', title: '零置信度', confidence: 0 },
        { id: 'f_str_zero', title: '字符零置信度', confidence: '0' },
        { id: 'f_valid', title: '有效置信度', confidence: 0.75 },
        { id: 'f_bool', title: '布尔置信度', confidence: true },
        { id: 'f_empty', title: '空白置信度', confidence: '  ' },
        { id: 'f_arr', title: '数组置信度', confidence: [0.5] },
        { id: 'f_neg', title: '负数置信度', confidence: -0.2 },
        { id: 'f_overflow', title: '超范围置信度', confidence: 1.5 }
      ]
    },
    expectedRevision: lease.revision
  });
  function mockRes() {
    return {
      statusCode: 200,
      headers: {},
      data: null,
      writeHead(code, h) { this.statusCode = code; this.headers = h; },
      end(body) { this.data = body; }
    };
  }
  const queryService = createNativeDissectionQueryService({
    repository: repo,
    getAuthUser: () => ({ user: { userId: 'alice' } }),
    json: (res, code, obj) => { res.statusCode = code; res.data = obj; }
  });
  const entRes = mockRes();
  await queryService.handleEntities({ url: '/api/dissections/' + job.id + '/entities?limit=20' }, entRes, job.id);
  assert.equal(entRes.statusCode, 200);
  const findChar = id => entRes.data.items.find(x => x.id === id);
  assert.equal(findChar('c_zero').mention_count, 0);
  assert.equal(findChar('c_str_zero').mention_count, 0);
  assert.equal(findChar('c_bool_true').mention_count, null);
  assert.equal(findChar('c_bool_false').mention_count, null);
  assert.equal(findChar('c_empty').mention_count, null);
  assert.equal(findChar('c_arr').mention_count, null);
  assert.equal(findChar('c_neg').mention_count, null);
  assert.equal(findChar('c_float').mention_count, null);

  const foresRes = mockRes();
  await queryService.handleForeshadows({ url: '/api/dissections/' + job.id + '/foreshadows?limit=20' }, foresRes, job.id);
  assert.equal(foresRes.statusCode, 200);
  const findFores = id => foresRes.data.items.find(x => x.id === id);
  assert.equal(findFores('f_zero').confidence, 0);
  assert.equal(findFores('f_str_zero').confidence, 0);
  assert.equal(findFores('f_valid').confidence, 0.75);
  assert.equal(findFores('f_bool').confidence, null);
  assert.equal(findFores('f_empty').confidence, null);
  assert.equal(findFores('f_arr').confidence, null);
  assert.equal(findFores('f_neg').confidence, null);
  assert.equal(findFores('f_overflow').confidence, null);

  const fileRepo = repo.repository;
  await fileRepo.transaction([null, '__molan_dissections_v1__'], tx => {
    const row = tx.get('__molan_dissections_v1__', 'novels', 'dissection:job:' + job.id);
    tx.put('__molan_dissections_v1__', 'novels', {
      ...row,
      meta: {
        pipeline: {
          aggregated: true,
          batchTotal: null,
          batchDone: null,
          factCoverage: 1.5,
          entities: true,
          candidates: '   ',
          mentions: [10],
          events: -4,
          summaries: 3.2
        }
      }
    }, row.revision);
  });
  const covRes = mockRes();
  await queryService.handleCoverage({ url: '/api/dissections/' + job.id + '/coverage' }, covRes, job.id);
  assert.equal(covRes.statusCode, 200);
  const cov = covRes.data.coverage;
  assert.equal(cov.batchTotal, null);
  assert.equal(cov.batchDone, null);
  assert.equal(cov.factCoverage, null);
  assert.equal(cov.entities, null);
  assert.equal(cov.candidates, null);
  assert.equal(cov.mentions, null);
  assert.equal(cov.events, null);
  assert.equal(cov.summaries, null);
});

test('compareEntityDeterministic uses binary string comparison instead of localeCompare', () => {
  const e1 = { canonical_name: 'a', id: '1', mention_count: 5 };
  const e2 = { canonical_name: 'b', id: '2', mention_count: 5 };
  assert.equal(compareEntityDeterministic(e1, e2), -1);
  assert.equal(compareEntityDeterministic(e2, e1), 1);
  assert.equal(compareEntityDeterministic(e1, { ...e1 }), 0);

  const c1 = { canonical_name: 'a', id: '1', mention_count: null };
  const c2 = { canonical_name: 'a', id: '1', mention_count: 0 };
  assert.equal(compareEntityDeterministic(c1, c2), 1);
  assert.equal(compareEntityDeterministic(c2, c1), -1);

  const s1 = { canonical_name: 'A', id: '1', mention_count: 0 };
  const s2 = { canonical_name: 'a', id: '1', mention_count: 0 };
  assert.equal(compareEntityDeterministic(s1, s2), -1);
  assert.equal(compareEntityDeterministic(s2, s1), 1);
});
