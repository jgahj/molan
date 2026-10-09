'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDissectionRoutes } = require('../routes/dissections');
const {
  createDissectionHandlers,
  compactDissectionTransferValue,
  dissectionTransferJson,
  dissectionMarkdown
} = require('../routes/dissection-handlers');

function createMockDeps(overrides = {}) {
  const calls = {
    json: [],
    respondError: [],
    models: [],
    reads: [],
    writes: []
  };

  const deps = {
    json: (res, status, body) => {
      calls.json.push({ status, body });
      if (res && typeof res.json === 'function') res.json({ status, body });
    },
    readBody: async req => req.body || {},
    respondError: (res, error, status = 500) => {
      calls.respondError.push({ status, error });
    },
    requestError: (status, message) => Object.assign(new Error(message), { status }),
    decodePathParam: p => decodeURIComponent(p),
    responseCors: () => ({}),
    getAuthUser: () => ({ token: 'mock-token', user: { userId: 'u_1', email: 'author@test.local' } }),
    requireSqliteForPublic: () => true,
    POSTGRES_MODE: false,
    dbReady: () => false,
    getUserByEmail: email => ({ email, userId: 'u_1' }),
    postgresRepository: {},
    loadDissectionRecord: id => ({ id, userEmail: 'author@test.local', ownerUserId: 'u_1', status: 'completed', depth: 'standard', result: {} }),
    loadDissectionRecordAsync: async id => {
      calls.reads.push(id);
      return { id, userEmail: 'author@test.local', ownerUserId: 'u_1', status: 'completed', depth: 'standard', result: {} };
    },
    saveDissectionRecordAsync: async rec => { calls.writes.push(rec); },
    updateDissectionRecord: () => {},
    insertDissectionRecord: () => {},
    findCachedDissectionRecord: () => null,
    acquireDissectionUserSlot: () => true,
    releaseDissectionUserSlot: () => {},
    activeDissections: new Map(),
    deleteDissectionCascade: () => 1,
    dissectionRecordsFromJson: () => [],
    writeJsonFile: () => {},
    DISSECTION_FILE: 'mock-dissection.json',
    dissectionRecordFromDb: row => row,
    migrateLegacyPipelineRecord: row => row,
    dissectionPublicRecord: rec => ({ id: rec.id, title: rec.title || 'test', status: rec.status }),
    textExtract: {
      isExtractable: name => /\.(docx|epub)$/i.test(name),
      extractDocument: async () => ({ text: 'extracted text', title: 'title', format: 'docx' })
    },
    normalizeDissectionInput: body => ({ source: body.content || body.text || 'source text', sourceFiles: [] }),
    buildDissectionChunks: () => [{ chapterId: 'chapter-1', text: 'chunk 1' }],
    chooseDissectionChunks: chunks => chunks,
    dissectionContext: chunks => chunks.map(c => c.text).join(' '),
    dissectionWordCount: () => 100,
    estimateBillingTokens: () => 500,
    pipelineEstimatedTokensFor: () => 2000,
    creditCostForUser: () => 1,
    resolveModelForUser: () => 'gpt-5.6-luna',
    currentDefaultModel: () => 'gpt-5.6-luna',
    dissectionId: () => 'd_test_' + Date.now(),
    emptyDissectionResult: () => ({ characters: [], foreshadowing: [] }),
    dissectionResultView: res => res || {},
    dissectionResultHasCompleteContent: () => true,
    firstIncompleteDissectionPhase: () => 0,
    dissectionPhaseIdsForDepth: () => ['extract', 'validate'],
    pipelineEnabled: () => false,
    initializeDissectionPipeline: () => {},
    startDissectionJob: () => {},
    dissectionSkillRecord: () => ({ id: 'skill-1', name: 'skill' }),
    dissectionSkillPromptFiles: () => [],
    dissectionSkillAuditPayload: () => ({ skills: [] }),
    SKILL_AUDIT_VERSION: 1,
    callMolanChat: async (_auth, _user, options) => {
      calls.models.push(options);
      return { json: { brief: { targetGenre: '都市' }, goal: '推进目标', passed: true, issues: [] }, text: '{}' };
    },
    safeJsonParse: text => { try { return JSON.parse(text); } catch (_) { return null; } },
    dissectionContextForChapter: () => ({ arcs: [], characterStates: [], timeline: [], foreshadows: [] }),
    getPostgresDissectionPipelineStore: () => ({
      dissectionContextForChapter: async () => ({ arcs: [], characterStates: [], timeline: [], foreshadows: [] }),
      buildDissectionEntities: async () => 1,
      buildDissectionEvents: async () => 1,
      buildEntityStates: async () => 1,
      buildEventEdges: async () => 1,
      storeDissectionForeshadows: async () => {}
    }),
    deterministicContractValidation: () => ({ passed: true }),
    pipelineBatchCharsFor: () => 12000,
    checkForbiddenTerms: () => [],
    dissectionDocx: { buildDissectionDocx: () => Buffer.from('docx') },
    queryParamsFromUrl: () => ({}),
    projectScope: { stableUserId: email => email },
    buildDissectionEntities: () => 1,
    buildDissectionEvents: () => 1,
    buildEntityStates: () => 1,
    buildEventEdges: () => 1,
    storeDissectionForeshadows: () => {},
    loadDissectionUnits: () => [],
    createDissectionBatches: () => 1,
    dissectionPipelineStats: () => ({ units: 1 }),
    getPostgresDissectionReadService: () => ({
      computeDissectionStats: async () => ({ count: 1 })
    }),
    syncCharactersToLibrary: () => 2,
    dissectionQueryHandlers: {
      handleDissectionCoverage: () => {},
      handleDissectionUnitsPage: () => {},
      handleDissectionEntitiesPage: () => {},
      handleDissectionForeshadowsPage: () => {},
      handleDissectionSummariesPage: () => {},
      handleDissectionValidation: () => {},
      handleDissectionSearch: () => {}
    },
    ...overrides
  };

  return { deps, calls };
}

test('createDissectionHandlers exposes all expected short and legacy handler signatures', () => {
  const { deps } = createMockDeps();
  const handlers = createDissectionHandlers(deps);

  assert.equal(typeof handlers.extract, 'function');
  assert.equal(typeof handlers.create, 'function');
  assert.equal(typeof handlers.list, 'function');
  assert.equal(typeof handlers.export, 'function');
  assert.equal(typeof handlers.apply, 'function');
  assert.equal(typeof handlers.creativeBrief, 'function');
  assert.equal(typeof handlers.creationContext, 'function');
  assert.equal(typeof handlers.chapterContract, 'function');
  assert.equal(typeof handlers.audit, 'function');
  assert.equal(typeof handlers.rebuild, 'function');
  assert.equal(typeof handlers.imitate, 'function');
  assert.equal(typeof handlers.diagnose, 'function');
  assert.equal(typeof handlers.compare, 'function');
  assert.equal(typeof handlers.batch, 'function');
  assert.equal(typeof handlers.get, 'function');
  assert.equal(typeof handlers.cancel, 'function');
  assert.equal(typeof handlers.retry, 'function');
  assert.equal(typeof handlers.remove, 'function');
  assert.equal(typeof handlers.patch, 'function');
  assert.equal(typeof handlers.share, 'function');
  assert.equal(typeof handlers.shareDelete, 'function');
  assert.equal(typeof handlers.sharedList, 'function');
  assert.equal(typeof handlers.sharedDissectionGet, 'function');
  assert.equal(typeof handlers.versions, 'function');
  assert.equal(typeof handlers.version, 'function');
  assert.equal(typeof handlers.syncCharacters, 'function');

  // Legacy named bindings
  assert.equal(typeof handlers.handleDissectionExtract, 'function');
  assert.equal(typeof handlers.handleDissectionCreate, 'function');
  assert.equal(typeof handlers.handleDissectionCreativeBrief, 'function');
  assert.equal(typeof handlers.handleDissectionChapterContract, 'function');
  assert.equal(typeof handlers.handleDissectionAudit, 'function');
});

test('createDissectionRoutes dispatches extract, creativeBrief, chapterContract, and audit', async () => {
  const { deps, calls } = createMockDeps();
  const handlers = createDissectionHandlers(deps);
  const router = createDissectionRoutes(handlers);

  const res = {
    writeHead: () => {},
    end: () => {}
  };

  // 1. Extract endpoint
  const extractReq = {
    method: 'POST',
    body: { name: 'sample.docx', base64: Buffer.from('hello').toString('base64') }
  };
  const extractMatched = await router(extractReq, res, '/api/dissection/extract');
  assert.equal(extractMatched, true);
  assert.equal(calls.json.at(-1).status, 200);
  assert.equal(calls.json.at(-1).body.text, 'extracted text');

  // 2. Creative Brief endpoint
  const briefReq = {
    method: 'POST',
    headers: { authorization: 'Bearer token' },
    body: { genre: '都市异能' }
  };
  const briefMatched = await router(briefReq, res, '/api/dissections/d_123/creative-brief');
  assert.equal(briefMatched, true);
  assert.equal(calls.json.at(-1).status, 200);
  assert.equal(calls.json.at(-1).body.ok, true);
  assert.equal(calls.writes.length, 1);

  // 3. Chapter Contract endpoint
  const contractReq = {
    method: 'POST',
    headers: { authorization: 'Bearer token' },
    body: { chapterNo: 2, goal: '取得证据' }
  };
  const contractMatched = await router(contractReq, res, '/api/dissections/d_123/chapter-contract');
  assert.equal(contractMatched, true);
  assert.equal(calls.json.at(-1).status, 200);
  assert.equal(calls.json.at(-1).body.contract.chapterNo, 2);

  // 4. Audit endpoint
  const auditReq = {
    method: 'POST',
    headers: { authorization: 'Bearer token' },
    body: { chapterNo: 2, content: '正文内容' }
  };
  const auditMatched = await router(auditReq, res, '/api/dissections/d_123/audit');
  assert.equal(auditMatched, true);
  assert.equal(calls.json.at(-1).status, 200);
  assert.equal(calls.json.at(-1).body.audit.passed, true);

  // 5. Non-matching route
  const nonMatched = await router({ method: 'GET' }, res, '/api/other');
  assert.equal(nonMatched, false);
});

test('compactDissectionTransferValue, dissectionTransferJson, and dissectionMarkdown helpers work correctly', () => {
  const sample = {
    title: '测试拆书',
    depth: 'standard',
    meta: { sampleCount: 5 },
    result: {
      overview: '概览内容',
      framework: '框架',
      storyStructure: '起承转合',
      genre: { primary: '都市' }
    }
  };

  const compacted = compactDissectionTransferValue({ key: 'val', deep: { nested: 'str' } }, { maxDepth: 2 }, 0);
  assert.equal(compacted.key, 'val');

  const jsonStr = dissectionTransferJson({ array: [1, 2, 3], desc: 'test' }, 500);
  assert.ok(jsonStr.length <= 500);
  assert.ok(jsonStr.includes('array'));

  const md = dissectionMarkdown(sample);
  assert.ok(md.includes('# 测试拆书'));
  assert.ok(md.includes('## 概览'));
});
