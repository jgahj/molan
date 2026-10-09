'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCreationBookRoutes } = require('../routes/creation-books');
const { createCreationBookHandlers } = require('../routes/creation-book-handlers');

function createMockHandlerTracker() {
  const calls = [];
  const handlerNames = [
    'list', 'postgresList', 'create', 'postgresCreate',
    'coreJobCreate', 'postgresCoreJobCreate', 'coreJobGet', 'coreJobCancel',
    'bibleGet', 'postgresBibleGet', 'biblePut', 'postgresBiblePut',
    'state', 'postgresState', 'planExpand', 'postgresPlanExpand',
    'planReview', 'postgresPlanReview', 'linkNovel', 'postgresLinkNovel',
    'chapterContract', 'postgresChapterContract', 'chapterAudit', 'postgresAudit',
    'commit', 'postgresCommit', 'qualityReport', 'postgresQualityReport',
    'debts', 'postgresDebts', 'regenerateAsset', 'postgresRegenerateAsset'
  ];

  const handlers = {
    respondError: (res, err) => { calls.push(['respondError', err]); },
    respondPostgresError: (res, err) => { calls.push(['respondPostgresError', err]); }
  };

  for (const name of handlerNames) {
    handlers[name] = async (req, res, id) => {
      calls.push([name, id]);
      return { ok: true, name, id };
    };
  }

  return { handlers, calls };
}

test('createCreationBookRoutes correctly dispatches in non-PostgreSQL mode', async () => {
  const { handlers, calls } = createMockHandlerTracker();
  const router = createCreationBookRoutes({ postgresMode: false, handlers });

  const res = {};
  assert.equal(await router({ method: 'GET' }, res, '/api/creation-books'), true);
  assert.equal(calls.at(-1)[0], 'list');

  assert.equal(await router({ method: 'POST' }, res, '/api/creation-books'), true);
  assert.equal(calls.at(-1)[0], 'create');

  assert.equal(await router({ method: 'POST' }, res, '/api/creation-books/core-jobs'), true);
  assert.equal(calls.at(-1)[0], 'coreJobCreate');

  assert.equal(await router({ method: 'GET' }, res, '/api/creation-books/core-jobs/cj_999'), true);
  assert.equal(calls.at(-1)[0], 'coreJobGet');
  assert.equal(calls.at(-1)[1], 'cj_999');

  assert.equal(await router({ method: 'DELETE' }, res, '/api/creation-books/core-jobs/cj_999'), true);
  assert.equal(calls.at(-1)[0], 'coreJobCancel');

  assert.equal(await router({ method: 'POST' }, res, '/api/creation-books/cb_1/plan-expand'), true);
  assert.equal(calls.at(-1)[0], 'planExpand');

  assert.equal(await router({ method: 'GET' }, res, '/api/creation-books/cb_1/bible'), true);
  assert.equal(calls.at(-1)[0], 'bibleGet');

  assert.equal(await router({ method: 'PUT' }, res, '/api/creation-books/cb_1/bible'), true);
  assert.equal(calls.at(-1)[0], 'biblePut');

  assert.equal(await router({ method: 'GET' }, res, '/api/creation-books/cb_1/state'), true);
  assert.equal(calls.at(-1)[0], 'state');

  assert.equal(await router({ method: 'POST' }, res, '/api/creation-books/cb_1/plan-review'), true);
  assert.equal(calls.at(-1)[0], 'planReview');

  assert.equal(await router({ method: 'POST' }, res, '/api/creation-books/cb_1/link-novel'), true);
  assert.equal(calls.at(-1)[0], 'linkNovel');

  assert.equal(await router({ method: 'POST' }, res, '/api/creation-books/cb_1/chapter-contract'), true);
  assert.equal(calls.at(-1)[0], 'chapterContract');

  assert.equal(await router({ method: 'POST' }, res, '/api/creation-books/cb_1/audit'), true);
  assert.equal(calls.at(-1)[0], 'chapterAudit');

  assert.equal(await router({ method: 'POST' }, res, '/api/creation-books/cb_1/commit'), true);
  assert.equal(calls.at(-1)[0], 'commit');

  assert.equal(await router({ method: 'GET' }, res, '/api/creation-books/cb_1/quality-report'), true);
  assert.equal(calls.at(-1)[0], 'qualityReport');

  assert.equal(await router({ method: 'GET' }, res, '/api/creation-books/cb_1/debts'), true);
  assert.equal(calls.at(-1)[0], 'debts');

  assert.equal(await router({ method: 'POST' }, res, '/api/creation-books/cb_1/regenerate-asset'), true);
  assert.equal(calls.at(-1)[0], 'regenerateAsset');

  assert.equal(await router({ method: 'GET' }, res, '/api/unrelated'), false);
});

test('createCreationBookRoutes correctly dispatches in PostgreSQL mode', async () => {
  const { handlers, calls } = createMockHandlerTracker();
  const router = createCreationBookRoutes({ postgresMode: true, handlers });

  const res = {};
  assert.equal(await router({ method: 'GET' }, res, '/api/creation-books'), true);
  assert.equal(calls.at(-1)[0], 'postgresList');

  assert.equal(await router({ method: 'POST' }, res, '/api/creation-books'), true);
  assert.equal(calls.at(-1)[0], 'postgresCreate');

  assert.equal(await router({ method: 'POST' }, res, '/api/creation-books/core-jobs'), true);
  assert.equal(calls.at(-1)[0], 'postgresCoreJobCreate');

  assert.equal(await router({ method: 'POST' }, res, '/api/creation-books/cb_1/plan-expand'), true);
  assert.equal(calls.at(-1)[0], 'postgresPlanExpand');

  assert.equal(await router({ method: 'GET' }, res, '/api/creation-books/cb_1/bible'), true);
  assert.equal(calls.at(-1)[0], 'postgresBibleGet');

  assert.equal(await router({ method: 'PUT' }, res, '/api/creation-books/cb_1/bible'), true);
  assert.equal(calls.at(-1)[0], 'postgresBiblePut');

  assert.equal(await router({ method: 'POST' }, res, '/api/creation-books/cb_1/plan-review'), true);
  assert.equal(calls.at(-1)[0], 'postgresPlanReview');

  assert.equal(await router({ method: 'POST' }, res, '/api/creation-books/cb_1/chapter-contract'), true);
  assert.equal(calls.at(-1)[0], 'postgresChapterContract');

  assert.equal(await router({ method: 'POST' }, res, '/api/creation-books/cb_1/audit'), true);
  assert.equal(calls.at(-1)[0], 'postgresAudit');

  assert.equal(await router({ method: 'POST' }, res, '/api/creation-books/cb_1/commit'), true);
  assert.equal(calls.at(-1)[0], 'postgresCommit');

  assert.equal(await router({ method: 'GET' }, res, '/api/creation-books/cb_1/quality-report'), true);
  assert.equal(calls.at(-1)[0], 'postgresQualityReport');

  assert.equal(await router({ method: 'GET' }, res, '/api/creation-books/cb_1/debts'), true);
  assert.equal(calls.at(-1)[0], 'postgresDebts');

  assert.equal(await router({ method: 'POST' }, res, '/api/creation-books/cb_1/regenerate-asset'), true);
  assert.equal(calls.at(-1)[0], 'postgresRegenerateAsset');
});

test('createCreationBookHandlers factory instantiates handlers and enforces concurrency lock', async () => {
  let inFlightRun = 0;
  const finishPromise = new Promise(resolve => { setTimeout(resolve, 50); });

  const deps = {
    json: (_res, status, body) => ({ status, body }),
    readBody: async () => ({ baseVersion: 1 }),
    respondError: () => {},
    respondPostgresError: () => {},
    getAuthUser: () => ({ user: { userId: 'u_test', email: 'u@test.local' } }),
    getUserByEmail: () => ({ email: 'u@test.local' }),
    requireSqliteForPublic: () => true,
    dbReady: () => true,
    loadCreationBookForAuth: () => ({ id: 'book_1' }),
    creationBibleForBook: () => ({
      bibleId: 'b_1',
      version: 1,
      payload: { qualityState: { planReviewResult: { baseVersion: 1, bibleVersion: 1 } } }
    }),
    reviewCreationPlan: () => ({ status: 'passed', issues: [] }),
    normalizeCreationPlanReviewModel: m => m,
    currentDefaultModel: () => 'gpt-5.6-luna',
    resolveCreationModelId: () => 'gpt-5.6-luna'
  };

  const handlers = createCreationBookHandlers(deps);
  assert.equal(typeof handlers.handleCreationCoreJobCreate, 'function');
  assert.equal(typeof handlers.handleCreationBookPlanReview, 'function');
  assert.equal(typeof handlers.runCreationBookPlanReview, 'function');
  assert.ok(handlers.creationPlanReviewsInFlight instanceof Set);

  // Directly verify concurrency locking on handleCreationBookPlanReview
  handlers.creationPlanReviewsInFlight.add('u_test:book_1');
  const lockedRes = await handlers.handleCreationBookPlanReview({}, {}, 'book_1');
  assert.equal(lockedRes.body.code, 'creation_review_pending');
  handlers.creationPlanReviewsInFlight.delete('u_test:book_1');
});
