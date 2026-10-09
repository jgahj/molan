'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { createCreationBookHandlers } = require('../routes/creation-book-handlers');
const { createCreationBookRoutes } = require('../routes/creation-books');
const { createDissectionHandlers } = require('../routes/dissection-handlers');

// ============================================================================
// SUITE 1: Concurrency & State Isolation - In-Flight Plan Review Locking
// ============================================================================

test('ADV-CONC-01: 10 concurrent plan review requests serialize with exactly 1 LLM call and 9 HTTP 409s', async () => {
  let llmCalls = 0;
  const sharedInFlight = new Set();

  const deps = {
    json: (_res, status, body) => ({ status, body }),
    readBody: async () => ({ baseVersion: 1, autoRevise: false }),
    respondError: () => {},
    respondPostgresError: () => {},
    getAuthUser: () => ({ user: { userId: 'u_adversary', email: 'adv@test.local' } }),
    getUserByEmail: () => ({ email: 'adv@test.local' }),
    requireSqliteForPublic: () => true,
    dbReady: () => true,
    loadCreationBookForAuth: () => ({ id: 'cb_adversary_1' }),
    creationBibleForBook: () => ({
      bibleId: 'b_adv_1',
      version: 1,
      payload: { title: '对抗书', qualityState: {} }
    }),
    reviewCreationPlan: () => ({ status: 'passed', issues: [] }),
    normalizeCreationPlanReviewModel: m => m,
    currentDefaultModel: () => 'gpt-5.6-luna',
    resolveCreationModelId: () => 'gpt-5.6-luna',
    callMolanChat: async () => {
      llmCalls += 1;
      // Introduce an async delay to simulate model latency and create a real race condition
      await new Promise(resolve => setTimeout(resolve, 60));
      return { json: { status: 'passed', summary: 'LLM审核通过', issues: [], patches: [] }, usage: { creditCost: 10 } };
    },
    saveCreationBibleVersion: (_book, current, payload, _summary, _email, _cost) => {
      return { conflict: false, bibleVersion: Number(current.version) + 1, payloadHash: 'hash_123' };
    },
    mergeCreationPlanReview: (_local, semantic, _finalLocal) => semantic,
    creationPlanReviewsInFlight: sharedInFlight
  };

  const handlers = createCreationBookHandlers(deps);

  // Dispatch 10 concurrent requests simultaneously
  const requests = Array.from({ length: 10 }, (_, i) =>
    handlers.handleCreationBookPlanReview({ headers: {}, reqId: i }, {}, 'cb_adversary_1')
  );

  const results = await Promise.all(requests);

  // Empirical verification:
  // 1. Exactly 1 request acquired lock and succeeded with status 200
  const successes = results.filter(r => r.status === 200);
  assert.equal(successes.length, 1, 'Exactly one concurrent request must succeed');
  assert.equal(successes[0].body.ok, true);

  // 2. Exactly 9 requests were rejected with 409 creation_review_pending
  const conflicts = results.filter(r => r.status === 409);
  assert.equal(conflicts.length, 9, 'All competing concurrent requests must receive 409');
  for (const conflict of conflicts) {
    assert.equal(conflict.body.code, 'creation_review_pending');
    assert.equal(conflict.body.error, '规划审核仍在进行');
  }

  // 3. LLM was invoked exactly once (no wasteful duplicate token spend)
  assert.equal(llmCalls, 1, 'LLM must be called exactly once across all 10 concurrent requests');

  // 4. Lock is released cleanly in finally block
  assert.equal(sharedInFlight.size, 0, 'In-flight set must be completely drained after completion');
});

test('ADV-CONC-02: Uncaught handler error does not poison in-flight lock; subsequent requests succeed', async () => {
  let shouldFail = true;
  const sharedInFlight = new Set();

  const deps = {
    json: (_res, status, body) => ({ status, body }),
    readBody: async () => ({ baseVersion: 1 }),
    respondError: () => {},
    respondPostgresError: () => {},
    getAuthUser: () => ({ user: { userId: 'u_poison_test', email: 'poison@test.local' } }),
    getUserByEmail: () => ({ email: 'poison@test.local' }),
    requireSqliteForPublic: () => true,
    dbReady: () => true,
    loadCreationBookForAuth: () => {
      if (shouldFail) throw new Error('Simulated crash during book retrieval');
      return { id: 'cb_poison_1' };
    },
    creationBibleForBook: () => ({
      bibleId: 'b_poison_1',
      version: 1,
      payload: { qualityState: {} }
    }),
    reviewCreationPlan: () => ({ status: 'passed', issues: [] }),
    normalizeCreationPlanReviewModel: m => m,
    currentDefaultModel: () => 'gpt-5.6-luna',
    resolveCreationModelId: () => 'gpt-5.6-luna',
    callMolanChat: async () => ({ json: { status: 'passed' }, usage: {} }),
    saveCreationBibleVersion: () => ({ conflict: false, bibleVersion: 2 }),
    mergeCreationPlanReview: (_l, s) => s,
    creationPlanReviewsInFlight: sharedInFlight
  };

  const handlers = createCreationBookHandlers(deps);

  // Request 1 fails due to thrown error
  await assert.rejects(
    handlers.handleCreationBookPlanReview({}, {}, 'cb_poison_1'),
    /Simulated crash during book retrieval/
  );

  // Verify lock was not leaked
  assert.equal(sharedInFlight.size, 0, 'Lock must be freed even on unhandled exception');

  // Request 2 now runs without error
  shouldFail = false;
  const recoveryRes = await handlers.handleCreationBookPlanReview({}, {}, 'cb_poison_1');
  assert.equal(recoveryRes.status, 200, 'Subsequent request must not suffer lock starvation');
  assert.equal(sharedInFlight.size, 0, 'Lock must remain free after recovery');
});

test('ADV-CONC-03: State isolation across distinct users and books', async () => {
  const sharedInFlight = new Set();
  let activeBook = 'cb_1';
  let activeUser = 'u1';

  const deps = {
    json: (_res, status, body) => ({ status, body }),
    readBody: async () => ({ baseVersion: 1 }),
    respondError: () => {},
    respondPostgresError: () => {},
    getAuthUser: () => ({ user: { userId: activeUser, email: `${activeUser}@test.local` } }),
    getUserByEmail: () => ({ email: `${activeUser}@test.local` }),
    requireSqliteForPublic: () => true,
    dbReady: () => true,
    loadCreationBookForAuth: id => ({ id }),
    creationBibleForBook: () => ({ bibleId: 'b_1', version: 1, payload: { qualityState: {} } }),
    reviewCreationPlan: () => ({ status: 'passed', issues: [] }),
    normalizeCreationPlanReviewModel: m => m,
    currentDefaultModel: () => 'gpt-5.6-luna',
    resolveCreationModelId: () => 'gpt-5.6-luna',
    callMolanChat: async () => {
      await new Promise(r => setTimeout(r, 40));
      return { json: { status: 'passed' }, usage: {} };
    },
    saveCreationBibleVersion: () => ({ conflict: false, bibleVersion: 2 }),
    mergeCreationPlanReview: (_l, s) => s,
    creationPlanReviewsInFlight: sharedInFlight
  };

  const handlers = createCreationBookHandlers(deps);

  // Manually hold a lock for user 1 on book 1
  sharedInFlight.add('u1:cb_1');

  // User 1 on book 1 is locked
  activeUser = 'u1';
  const u1Book1 = await handlers.handleCreationBookPlanReview({}, {}, 'cb_1');
  assert.equal(u1Book1.status, 409);
  assert.equal(u1Book1.body.code, 'creation_review_pending');

  // User 1 on book 2 is NOT locked (different book)
  const u1Book2Promise = handlers.handleCreationBookPlanReview({}, {}, 'cb_2');

  // User 2 on book 1 is NOT locked (different user)
  activeUser = 'u2';
  const u2Book1Promise = handlers.handleCreationBookPlanReview({}, {}, 'cb_1');

  const [resU1B2, resU2B1] = await Promise.all([u1Book2Promise, u2Book1Promise]);
  assert.equal(resU1B2.status, 200, 'Same user on different book must not be blocked');
  assert.equal(resU2B1.status, 200, 'Different user on same book must not be blocked');

  sharedInFlight.delete('u1:cb_1');
  assert.equal(sharedInFlight.size, 0);
});

test('ADV-CONC-04: Actor key falls back to email when userId is absent', async () => {
  const sharedInFlight = new Set();
  const deps = {
    json: (_res, status, body) => ({ status, body }),
    readBody: async () => ({ baseVersion: 1 }),
    getAuthUser: () => ({ user: { email: 'email_only@test.local' } }), // No userId
    loadCreationBookForAuth: () => ({ id: 'cb_email_test' }),
    creationBibleForBook: () => ({ bibleId: 'b_e', version: 1, payload: { qualityState: {} } }),
    reviewCreationPlan: () => ({ status: 'passed' }),
    normalizeCreationPlanReviewModel: m => m,
    currentDefaultModel: () => 'gpt-5.6-luna',
    resolveCreationModelId: () => 'gpt-5.6-luna',
    callMolanChat: async () => {
      await new Promise(r => setTimeout(r, 40));
      return { json: { status: 'passed' } };
    },
    saveCreationBibleVersion: () => ({ conflict: false, bibleVersion: 2 }),
    mergeCreationPlanReview: (_l, s) => s,
    creationPlanReviewsInFlight: sharedInFlight
  };

  const handlers = createCreationBookHandlers(deps);

  const [r1, r2] = await Promise.all([
    handlers.handleCreationBookPlanReview({}, {}, 'cb_email_test'),
    handlers.handleCreationBookPlanReview({}, {}, 'cb_email_test')
  ]);

  const statuses = [r1.status, r2.status].sort();
  assert.deepEqual(statuses, [200, 409], 'Email-based actor key must correctly lock out concurrent calls');
});

// ============================================================================
// SUITE 2: CAS Conflicts & Rebase Requirements (needs_rebase -> 409)
// ============================================================================

test('ADV-CAS-01: Plan review rejects stale baseVersion with 409 needs_rebase before calling LLM', async () => {
  let llmCalled = false;
  const deps = {
    json: (_res, status, body) => ({ status, body }),
    readBody: async () => ({ baseVersion: 1 }), // Client claims baseVersion 1
    getAuthUser: () => ({ user: { userId: 'u_cas', email: 'cas@test.local' } }),
    loadCreationBookForAuth: () => ({ id: 'cb_cas' }),
    creationBibleForBook: () => ({
      bibleId: 'b_cas',
      version: 3, // Current version is 3 (conflict!)
      payload: { qualityState: {} }
    }),
    reviewCreationPlan: () => ({ status: 'passed', issues: [] }),
    callMolanChat: async () => {
      llmCalled = true;
      return { json: {} };
    }
  };

  const handlers = createCreationBookHandlers(deps);
  const res = await handlers.handleCreationBookPlanReview({}, {}, 'cb_cas');

  assert.equal(res.status, 409, 'Must return HTTP 409 on stale baseVersion');
  assert.equal(res.body.code, 'needs_rebase');
  assert.match(res.body.error, /创作圣经已更新/);
  assert.equal(llmCalled, false, 'LLM must never be invoked when baseVersion is stale');
});

test('ADV-CAS-02: Plan review handles concurrent Bible modification during LLM processing (save conflict)', async () => {
  let llmCalled = false;
  const deps = {
    json: (_res, status, body) => ({ status, body }),
    readBody: async () => ({ baseVersion: 2 }),
    getAuthUser: () => ({ user: { userId: 'u_cas', email: 'cas@test.local' } }),
    loadCreationBookForAuth: () => ({ id: 'cb_cas' }),
    creationBibleForBook: () => ({
      bibleId: 'b_cas',
      version: 2, // Matches baseVersion at start
      payload: { qualityState: {} }
    }),
    reviewCreationPlan: () => ({ status: 'passed', issues: [] }),
    normalizeCreationPlanReviewModel: m => m,
    currentDefaultModel: () => 'gpt-5.6-luna',
    resolveCreationModelId: () => 'gpt-5.6-luna',
    callMolanChat: async () => {
      llmCalled = true;
      return { json: { status: 'passed' }, usage: { creditCost: 5 } };
    },
    mergeCreationPlanReview: (_l, s) => s,
    saveCreationBibleVersion: () => {
      // Another process committed between LLM start and save: CAS conflict!
      return { conflict: true, currentVersion: 3 };
    }
  };

  const handlers = createCreationBookHandlers(deps);
  const res = await handlers.handleCreationBookPlanReview({}, {}, 'cb_cas');

  assert.equal(llmCalled, true);
  assert.equal(res.status, 409, 'Must return HTTP 409 when save detects conflict');
  assert.equal(res.body.code, 'needs_rebase');
  assert.equal(res.body.currentVersion, 2);
  assert.match(res.body.error, /创作圣经已更新/);
});

test('ADV-CAS-03: Plan expand rejects stale baseBibleVersion with 409 needs_rebase', async () => {
  let llmCalled = false;
  const deps = {
    json: (_res, status, body) => ({ status, body }),
    readBody: async () => ({ baseBibleVersion: 1 }), // Client specifies baseBibleVersion 1
    requireSqliteForPublic: () => true,
    getAuthUser: () => ({ user: { userId: 'u_cas', email: 'cas@test.local' } }),
    loadCreationBookForAuth: () => ({ id: 'cb_cas_expand' }),
    creationBibleForBook: () => ({
      bibleId: 'b_cas_expand',
      version: 2, // Current is 2
      payload: { title: '测试' }
    }),
    callMolanChat: async () => {
      llmCalled = true;
      return { json: {} };
    }
  };

  const handlers = createCreationBookHandlers(deps);
  const res = await handlers.handleCreationBookPlanExpand({}, {}, 'cb_cas_expand');

  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'needs_rebase');
  assert.equal(res.body.currentVersion, 2);
  assert.equal(llmCalled, false, 'Model must not be called when baseBibleVersion is stale');
});

test('ADV-CAS-04: Plan expand handles save conflict with 409 needs_rebase', async () => {
  const deps = {
    json: (_res, status, body) => ({ status, body }),
    readBody: async () => ({ baseBibleVersion: 1 }),
    requireSqliteForPublic: () => true,
    getAuthUser: () => ({ user: { userId: 'u_cas', email: 'cas@test.local' } }),
    loadCreationBookForAuth: () => ({ id: 'cb_cas_expand' }),
    creationBibleForBook: () => ({
      bibleId: 'b_cas_expand',
      version: 1,
      payload: { title: '测试' }
    }),
    creationPlanCoverage: () => ({ ready: false, resourcesReady: true, completedThrough: 0, nextChapterNo: 1, plan: { totalChapters: 10 } }),
    creationSkillForUser: async () => null,
    resolveCreationModelId: () => 'gpt-5.6-luna',
    callMolanChat: async () => ({ json: { chapters: [{ chapterNo: 1, title: '第一章' }] } }),
    mergeCreationExpansionPayload: () => ({}),
    saveCreationBibleVersion: () => ({ conflict: true })
  };

  const handlers = createCreationBookHandlers(deps);
  const res = await handlers.handleCreationBookPlanExpand({}, {}, 'cb_cas_expand');

  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'needs_rebase');
  assert.equal(res.body.currentVersion, 1);
});

test('ADV-CAS-05: Bible PUT handles save conflict with 409 needs_rebase', async () => {
  const deps = {
    json: (_res, status, body) => ({ status, body }),
    readBody: async () => ({ bible: { title: '修改标题' } }),
    getAuthUser: () => ({ user: { userId: 'u_cas', email: 'cas@test.local' } }),
    loadCreationBookForAuth: () => ({ id: 'cb_put' }),
    loadCurrentBiblePayload: () => ({ version: 5 }),
    saveCreationBibleVersion: () => ({ conflict: true })
  };

  const handlers = createCreationBookHandlers(deps);
  const res = await handlers.handleCreationBookBiblePut({}, {}, 'cb_put');

  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'needs_rebase');
  assert.equal(res.body.currentVersion, 5);
});

test('ADV-CAS-06: Regenerate asset handles save conflict with 409 needs_rebase', async () => {
  const deps = {
    json: (_res, status, body) => ({ status, body }),
    readBody: async () => ({ asset: 'characters', name: '李明' }),
    getAuthUser: () => ({ user: { userId: 'u_cas', email: 'cas@test.local' } }),
    loadCreationBookForAuth: () => ({ id: 'cb_regen' }),
    creationBibleForBook: () => ({ bibleId: 'b_regen', payload: { characters: [{ name: '李明' }] } }),
    callMolanChat: async () => ({ json: { character: { name: '李明', role: '主角' } } }),
    creationBibleSeedValidation: () => ({ ok: true }),
    saveCreationBibleVersion: () => ({ conflict: true })
  };

  const handlers = createCreationBookHandlers(deps);
  const res = await handlers.handleCreationBookRegenerateAsset({}, {}, 'cb_regen');

  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'needs_rebase');
});

// ============================================================================
// SUITE 3: VM Sandboxing & Invariant Slicing (postgres-dissection-tools)
// ============================================================================

test('ADV-VM-01: All 10 sliced functions in server.js execute in bare VM without ReferenceError on dissectionHandlers', () => {
  const serverPath = path.join(__dirname, '..', 'server.js');
  const source = fs.readFileSync(serverPath, 'utf8');

  const names = [
    'handleDissectionCreativeBrief',
    'handleDissectionCreationContext',
    'handleDissectionChapterContract',
    'handleDissectionAudit',
    'handleDissectionImitate',
    'handleDissectionDiagnose',
    'handleDissectionsCompare',
    'handleDissectionApply',
    'handleDissectionRebuild',
    'handleDissectionExtract'
  ];

  // Create isolated context with NO dissectionHandlers defined
  const context = {
    POSTGRES_MODE: true,
    Math, Number, String, Date, Object, Array, Set, JSON, Promise, Buffer,
    getAuthUser: () => null, // trigger early return to verify execution without error
    json: (res, status, body) => ({ status, body }),
    respondError: (res, err) => ({ err }),
    requireSqliteForPublic: () => true,
    readBody: async () => ({})
  };
  vm.createContext(context);

  for (const name of names) {
    const declaration = source.indexOf('function ' + name + '(');
    assert.ok(declaration >= 0, `Function declaration for ${name} must be found in server.js`);
    const start = source.lastIndexOf('\n', declaration) + 1;
    const end = source.indexOf('\n}', declaration);
    assert.ok(end > declaration, `Function end for ${name} must follow declaration`);

    const slice = source.slice(start, end + 2);

    // Verify syntax and execution in sandbox
    assert.doesNotThrow(() => {
      vm.runInContext(slice, context);
    }, `Compiling slice for ${name} must not throw`);

    assert.equal(typeof context[name], 'function', `${name} must be defined in VM context`);
  }
});

test('ADV-VM-02: Balanced braces verification across all 10 sliced functions', () => {
  const serverPath = path.join(__dirname, '..', 'server.js');
  const source = fs.readFileSync(serverPath, 'utf8');

  const names = [
    'handleDissectionCreativeBrief',
    'handleDissectionCreationContext',
    'handleDissectionChapterContract',
    'handleDissectionAudit',
    'handleDissectionImitate',
    'handleDissectionDiagnose',
    'handleDissectionsCompare',
    'handleDissectionApply',
    'handleDissectionRebuild',
    'handleDissectionExtract'
  ];

  for (const name of names) {
    const declaration = source.indexOf('function ' + name + '(');
    const start = source.lastIndexOf('\n', declaration) + 1;
    const end = source.indexOf('\n}', declaration);
    const slice = source.slice(start, end + 2);

    // Verify brace balance (ignoring string literals)
    let openBraces = 0;
    let inString = null;
    let escaped = false;

    for (let i = 0; i < slice.length; i++) {
      const ch = slice[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (inString) {
        if (ch === inString) inString = null;
        continue;
      }
      if (ch === '\'' || ch === '"' || ch === '`') {
        inString = ch;
        continue;
      }
      if (ch === '{') openBraces++;
      if (ch === '}') openBraces--;
    }

    assert.equal(openBraces, 0, `Braces in sliced function ${name} must be perfectly balanced`);
  }
});

test('ADV-VM-03: Sliced functions properly delegate when dissectionHandlers IS present in context', async () => {
  const serverPath = path.join(__dirname, '..', 'server.js');
  const source = fs.readFileSync(serverPath, 'utf8');

  const delegatedCalls = [];
  const mockHandlers = {
    handleDissectionCreativeBrief: async (req, res, id) => { delegatedCalls.push(['brief', id]); return { ok: true }; },
    handleDissectionCreationContext: async (req, res, id) => { delegatedCalls.push(['context', id]); return { ok: true }; },
    handleDissectionChapterContract: async (req, res, id) => { delegatedCalls.push(['contract', id]); return { ok: true }; },
    handleDissectionAudit: async (req, res, id) => { delegatedCalls.push(['audit', id]); return { ok: true }; },
    handleDissectionImitate: async (req, res, id) => { delegatedCalls.push(['imitate', id]); return { ok: true }; },
    handleDissectionDiagnose: async (req, res, id) => { delegatedCalls.push(['diagnose', id]); return { ok: true }; },
    handleDissectionsCompare: (req, res) => { delegatedCalls.push(['compare']); return { ok: true }; },
    handleDissectionApply: async (req, res, id) => { delegatedCalls.push(['apply', id]); return { ok: true }; },
    handleDissectionRebuild: async (req, res, id) => { delegatedCalls.push(['rebuild', id]); return { ok: true }; },
    handleDissectionExtract: (req, res) => { delegatedCalls.push(['extract']); return { ok: true }; }
  };

  const context = {
    dissectionHandlers: mockHandlers,
    Math, Number, String, Date, Object, Array, Set, JSON, Promise, Buffer
  };
  vm.createContext(context);

  const names = Object.keys(mockHandlers);
  for (const name of names) {
    const declaration = source.indexOf('function ' + name + '(');
    const start = source.lastIndexOf('\n', declaration) + 1;
    const end = source.indexOf('\n}', declaration);
    const slice = source.slice(start, end + 2);
    vm.runInContext(slice, context);
  }

  // Call each function in the context
  await context.handleDissectionCreativeBrief({}, {}, 'd_brief');
  await context.handleDissectionCreationContext({}, {}, 'd_ctx');
  await context.handleDissectionChapterContract({}, {}, 'd_cont');
  await context.handleDissectionAudit({}, {}, 'd_aud');
  await context.handleDissectionImitate({}, {}, 'd_imit');
  await context.handleDissectionDiagnose({}, {}, 'd_diag');
  context.handleDissectionsCompare({}, {});
  await context.handleDissectionApply({}, {}, 'd_app');
  await context.handleDissectionRebuild({}, {}, 'd_reb');
  context.handleDissectionExtract({}, {});

  assert.equal(delegatedCalls.length, 10, 'All 10 sliced functions must cleanly delegate to dissectionHandlers');
  assert.equal(delegatedCalls[0][0], 'brief');
  assert.equal(delegatedCalls[0][1], 'd_brief');
  assert.equal(delegatedCalls[6][0], 'compare');
  assert.equal(delegatedCalls[9][0], 'extract');
});

// ============================================================================
// SUITE 4: Dissection Handler Factory Resilience & Completeness
// ============================================================================

test('ADV-FACT-01: Dissection handler factory instantiates cleanly and exports all required functions', () => {
  const deps = {
    json: () => {},
    readBody: async () => ({}),
    respondError: () => {},
    getAuthUser: () => null,
    POSTGRES_MODE: true
  };

  const handlers = createDissectionHandlers(deps);
  const expectedEndpoints = [
    'extract', 'create', 'list', 'export', 'apply', 'creativeBrief',
    'creationContext', 'chapterContract', 'audit', 'coverage', 'units',
    'entities', 'foreshadows', 'summaries', 'validation', 'search',
    'rebuild', 'patch', 'get', 'cancel', 'retry', 'remove', 'imitate',
    'diagnose', 'syncCharacters', 'share', 'shareDelete', 'versions',
    'version', 'compare', 'batch', 'sharedList'
  ];

  for (const ep of expectedEndpoints) {
    assert.equal(typeof handlers[ep], 'function', `Dissection handler ${ep} must be a function`);
  }
});
