'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createDebtKnowledgeHandlers } = require('../routes/debt-knowledge-handlers');
const { createAdminHandlers } = require('../routes/admin-handlers');
const { createKnowledgeRoutes } = require('../routes/knowledge');
const { createAdminRoutes } = require('../routes/admin');

test('createDebtKnowledgeHandlers: debts get, create, settle, extract and style/health behave correctly', async () => {
  const debtsStore = {
    active: [{ id: 'debt_1', debtType: 'unpaid_favor', summary: '欠人情', status: 'active' }],
    settled: []
  };

  const mockDebtTracker = {
    getDebts: (_bookId, _chapterNo) => ({ active: debtsStore.active, settled: debtsStore.settled, allDebts: debtsStore.active }),
    recordDebt: (_bookId, input) => {
      const d = { id: 'debt_2', ...input, status: 'active' };
      debtsStore.active.push(d);
      return d;
    },
    settleDebt: (_bookId, debtId, reason) => {
      const idx = debtsStore.active.findIndex(d => d.id === debtId);
      if (idx === -1) return null;
      const [d] = debtsStore.active.splice(idx, 1);
      d.status = 'settled';
      d.settledReason = reason;
      debtsStore.settled.push(d);
      return d;
    },
    extractPotentialDebts: (text, chapterNo) => [
      { debtType: 'unresolved_conflict', summary: text.slice(0, 20), chapterNo }
    ]
  };

  let currentBody = {};
  const deps = {
    json: (_res, status, body) => ({ status, body }),
    readBody: async () => currentBody,
    respondError: (_res, err) => ({ status: 500, error: err }),
    queryParamsFromUrl: () => ({ chapterNo: '3' }),
    getAuthUser: () => ({ user: { userId: 'u_admin', email: 'admin@test.local' } }),
    postgresActor: () => 'u_admin',
    postgresRepository: {
      getCausalDebts: async () => ({ allDebts: debtsStore.active }),
      recordCausalDebt: async (data) => ({ debt: { id: 'pg_debt_1', ...data } }),
      settleCausalDebt: async (data) => ({ debt: { id: data.debtId, status: 'settled' } })
    },
    getCreationDebtTracker: () => mockDebtTracker,
    buildDebtPromptInjection: () => '【因果债务注入】',
    extractPotentialDebts: (text, chapterNo) => [{ debtType: 'threat', summary: text.slice(0, 10), chapterNo }],
    detectNovelStyle: (text) => ({ primaryStyle: 'xuanhuan', confidence: 0.95, textLen: text.length }),
    evaluateChapterHealth: (text) => ({ score: 92, passed: true, charCount: text.length })
  };

  const handlers = createDebtKnowledgeHandlers(deps);
  assert.equal(typeof handlers.handleCausalDebtsGet, 'function');
  assert.equal(typeof handlers.handleCausalDebtCreate, 'function');
  assert.equal(typeof handlers.handleCausalDebtSettle, 'function');
  assert.equal(typeof handlers.handleCausalDebtsExtract, 'function');
  assert.equal(typeof handlers.handleStyleDetect, 'function');
  assert.equal(typeof handlers.handleChapterHealthCheck, 'function');

  // 1. Test getDebts
  const getRes = handlers.handleCausalDebtsGet({}, {}, 'book_1');
  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.ok, true);
  assert.equal(getRes.body.active.length, 1);

  // 2. Test createDebt
  currentBody = { debtType: 'blood_debt', summary: '宗门仇怨' };
  const createRes = await handlers.handleCausalDebtCreate({}, {}, 'book_1');
  assert.equal(createRes.status, 200);
  assert.equal(createRes.body.debt.id, 'debt_2');

  // 3. Test settleDebt
  currentBody = { debtId: 'debt_1', reason: '大仇已报' };
  const settleRes = await handlers.handleCausalDebtSettle({}, {}, 'book_1');
  assert.equal(settleRes.status, 200);
  assert.equal(settleRes.body.debt.status, 'settled');

  // 4. Test extract
  currentBody = { text: '少了一钱碎银，不准立户。', chapterNo: 3 };
  const extractRes = await handlers.handleCausalDebtsExtract({}, {}, 'book_1');
  assert.equal(extractRes.status, 200);
  assert.equal(extractRes.body.count, 1);

  // 5. Test styleDetect
  currentBody = { text: '少年自大荒而出，一步踏破九天。' };
  const styleRes = await handlers.handleStyleDetect({}, {});
  assert.equal(styleRes.status, 200);
  assert.equal(styleRes.body.primaryStyle, 'xuanhuan');

  // 6. Test healthCheck
  currentBody = { text: '清晨的阳光洒在古道上。' };
  const healthRes = await handlers.handleChapterHealthCheck({}, {});
  assert.equal(healthRes.status, 200);
  assert.equal(healthRes.body.health.score, 92);
});

test('createAdminHandlers: correction library and material audit behave correctly', async () => {
  const mockLibrary = {
    title: '通用网文纠错库',
    version: '2026.10',
    path: '/mock/path',
    bytes: 1024,
    stats: { rules: 5 },
    warnings: [],
    rules: [{ id: 'r1', category: 'flavor', must: '避免过度修饰', badExample: '极度的愤怒' }],
    blacklist: [],
    cases: [{ id: 'c1', chapter: 1, type: 'style', before: 'a', after: 'b', principle: 'p', source: 'user' }]
  };

  const inboxEntries = [];
  const mockCorrectionLib = {
    SCENE_PROFILES: [{ id: 'battle', label: '战斗场景', ruleIds: ['r1'] }],
    appendInbox: (_file, entry) => {
      inboxEntries.push(entry);
      return entry;
    },
    readInbox: () => inboxEntries,
    clearCorrectionLibraryCache: () => {}
  };

  let currentBody = {};
  const deps = {
    json: (_res, status, body) => ({ status, body }),
    readBody: async () => currentBody,
    respondError: (_res, err) => ({ status: 500, error: err }),
    requestError: (status, msg) => {
      const err = new Error(msg);
      err.status = status;
      return err;
    },
    getAuthUser: () => ({ user: { userId: 'u_admin', email: 'admin@test.local' } }),
    requireAdmin: () => ({ user: { userId: 'u_admin', email: 'admin@test.local' } }),
    getCorrectionLibrary: () => mockLibrary,
    scanUniversalCorrectionRisks: (_text, _opts) => ({ risks: [], passed: true }),
    loadCorrectionHits: () => ({ totalRequests: 100, passedRequests: 95 }),
    correctionLibraryLib: mockCorrectionLib,
    CORRECTION_INBOX_FILE: '/mock/inbox.jsonl',
    characterMaterialAuditState: () => ({ version: '2026.10', published: true }),
    loadCharacterMaterialAuditReport: () => ({
      version: '2026.10',
      sourceHash: 'hash_abc',
      manualReview: { samples: [{ id: 's1', residualTerms: [] }] }
    }),
    evaluateCharacterMaterialApprovalGates: () => ({ publicationApprovalReady: true, profileReleasePass: true }),
    characterMaterialAuditMetrics: () => ({ publishableCount: 1, residualRate: 0, residualIds: [], excludedIds: [] }),
    writeJsonFile: () => {},
    resetCharacterMaterialIndexCache: () => {},
    appendAdminAudit: async () => {},
    CHARACTER_MATERIAL_APPROVAL_FILE: '/mock/material.json'
  };

  const handlers = createAdminHandlers(deps);
  assert.equal(typeof handlers.handleCorrectionLibrarySummary, 'function');
  assert.equal(typeof handlers.handleCorrectionLibraryScan, 'function');
  assert.equal(typeof handlers.handleCorrectionLibraryInbox, 'function');
  assert.equal(typeof handlers.handleCorrectionLibraryInboxList, 'function');
  assert.equal(typeof handlers.handleCorrectionLibraryStats, 'function');
  assert.equal(typeof handlers.handleCharacterMaterialAudit, 'function');
  assert.equal(typeof handlers.handleCharacterMaterialAuditPatch, 'function');

  // Test summary
  const summaryRes = handlers.handleCorrectionLibrarySummary({ url: '/api/correction-library?cases=1' }, {});
  assert.equal(summaryRes.status, 200);
  assert.equal(summaryRes.body.library.version, '2026.10');
  assert.equal(summaryRes.body.library.cases.length, 1);

  // Test inbox append and list
  currentBody = { before: '极其恐怖', after: '恐怖', principle: '精简' };
  const inboxRes = await handlers.handleCorrectionLibraryInbox({}, {});
  assert.equal(inboxRes.status, 200);
  assert.equal(inboxRes.body.pending, 1);

  const inboxListRes = handlers.handleCorrectionLibraryInboxList({}, {});
  assert.equal(inboxListRes.status, 200);
  assert.equal(inboxListRes.body.count, 1);

  // Test stats
  const statsRes = handlers.handleCorrectionLibraryStats({}, {});
  assert.equal(statsRes.status, 200);
  assert.equal(statsRes.body.stats.ruleCount, 1);

  // Test material audit
  const auditRes = handlers.handleCharacterMaterialAudit({}, {});
  assert.equal(auditRes.status, 200);
  assert.equal(auditRes.body.published, true);

  // Test material audit patch
  currentBody = { approved: true, reviewedIds: ['s1'], residualIds: [] };
  const patchRes = await handlers.handleCharacterMaterialAuditPatch({}, {});
  assert.equal(patchRes.status, 200);
  assert.equal(patchRes.body.saved, true);
});

test('createKnowledgeRoutes & createAdminRoutes integrate cleanly with Phase 3 handlers', async () => {
  const knowledgeDispatched = [];
  const mockKnowledgeHandlers = {
    localStyleSamples: () => { knowledgeDispatched.push('samples'); },
    localStyleBaseline: () => { knowledgeDispatched.push('baseline'); },
    styleDetect: () => { knowledgeDispatched.push('styleDetect'); },
    chapterHealthCheck: () => { knowledgeDispatched.push('chapterHealthCheck'); },
    debtsGet: () => { knowledgeDispatched.push('debtsGet'); },
    debtCreate: () => { knowledgeDispatched.push('debtCreate'); },
    debtSettle: () => { knowledgeDispatched.push('debtSettle'); },
    debtsExtract: () => { knowledgeDispatched.push('debtsExtract'); },
    json: () => {}
  };

  const knowledgeRouter = createKnowledgeRoutes(mockKnowledgeHandlers);
  assert.equal(knowledgeRouter.dispatch({ method: 'POST' }, {}, '/api/style/detect'), true);
  assert.equal(knowledgeRouter.dispatch({ method: 'POST' }, {}, '/api/chapter/health-check'), true);
  assert.equal(knowledgeRouter.dispatch({ method: 'GET' }, {}, '/api/causal-debts/book_1'), true);
  assert.equal(knowledgeRouter.dispatch({ method: 'POST' }, {}, '/api/causal-debts/book_1'), true);
  assert.equal(knowledgeRouter.dispatch({ method: 'POST' }, {}, '/api/causal-debts/book_1/settle'), true);
  assert.equal(knowledgeRouter.dispatch({ method: 'POST' }, {}, '/api/causal-debts/book_1/extract'), true);
  assert.deepEqual(knowledgeDispatched, ['styleDetect', 'chapterHealthCheck', 'debtsGet', 'debtCreate', 'debtSettle', 'debtsExtract']);

  const adminDispatched = [];
  const mockAdminHandlers = {
    correctionSummary: () => { adminDispatched.push('correctionSummary'); },
    correctionStats: () => { adminDispatched.push('correctionStats'); },
    correctionScan: () => { adminDispatched.push('correctionScan'); },
    correctionInboxList: () => { adminDispatched.push('correctionInboxList'); },
    correctionInbox: () => { adminDispatched.push('correctionInbox'); },
    correctionMerge: () => { adminDispatched.push('correctionMerge'); },
    characterAudit: () => { adminDispatched.push('characterAudit'); },
    characterAuditPatch: async () => { adminDispatched.push('characterAuditPatch'); }
  };

  const adminRouter = createAdminRoutes(mockAdminHandlers);
  assert.equal(await adminRouter({ method: 'GET' }, {}, '/api/correction-library'), true);
  assert.equal(await adminRouter({ method: 'GET' }, {}, '/api/correction-library/stats'), true);
  assert.equal(await adminRouter({ method: 'POST' }, {}, '/api/correction-library/scan'), true);
  assert.equal(await adminRouter({ method: 'GET' }, {}, '/api/correction-library/inbox'), true);
  assert.equal(await adminRouter({ method: 'POST' }, {}, '/api/correction-library/inbox'), true);
  assert.equal(await adminRouter({ method: 'POST' }, {}, '/api/correction-library/merge'), true);
  assert.equal(await adminRouter({ method: 'GET' }, {}, '/api/admin/character-material/audit'), true);
  assert.equal(await adminRouter({ method: 'PATCH' }, {}, '/api/admin/character-material/audit'), true);
  assert.deepEqual(adminDispatched, [
    'correctionSummary', 'correctionStats', 'correctionScan',
    'correctionInboxList', 'correctionInbox', 'correctionMerge',
    'characterAudit', 'characterAuditPatch'
  ]);
});
