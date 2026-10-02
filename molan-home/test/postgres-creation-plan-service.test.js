'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createPostgresCreationPlanService } = require('../services/postgres-creation-plan-service');

function harness(overrides = {}) {
  const calls = { model: 0, writes: [], links: 0 };
  const creationPlanReviewsInFlight = new Set();
  let access = { active: true, role: 'editor', can_spend: true };
  let current = { bibleId: 'bible', version: 1, payload: { characters: [], worldRules: [] } };
  const book = { id: 'book', projectId: 'project', workspaceId: 'workspace', budgetLimit: 10, spentCost: 2 };
  const repository = {
    async getCreationBible() { return { book, bible: current }; },
    async getProjectAccess() { return access; },
    async putCreationBible(input) {
      calls.writes.push(input);
      if (overrides.writeError) throw overrides.writeError;
      current = { ...current, version: input.expectedRevision + 1, payload: input.payload };
      return { bibleVersion: current.version, payloadHash: 'hash' };
    },
    async linkCreationBook() { calls.links += 1; return { ok: true }; }
  };
  const coverage = payload => {
    const ready = payload.expanded === true;
    return {
      ready,
      resourcesReady: ready,
      chaptersReady: ready,
      plan: { totalChapters: 12, volumeCount: 1, modelId: 'model', skillId: '' },
      nextChapterNo: ready ? 13 : 1,
      completedThrough: ready ? 12 : 0,
      targets: { characters: 1 },
      counts: { characters: ready ? 1 : 0 },
      missingChapterCount: ready ? 0 : 12
    };
  };
  const service = createPostgresCreationPlanService({
    getAuthUser: req => req.auth === undefined ? { user: { userId: 'user', email: 'user@example.test' } } : req.auth,
    json: (res, status, body) => {
      res.status = status;
      res.body = body;
      return { status, body };
    },
    postgresRepository: repository,
    postgresActor: auth => auth.user.userId,
    readBody: async req => req.body || {},
    CREATION_PLAN_BATCH_SIZE: 20,
    creationPlanCoverage: coverage,
    getUserByEmail: () => { throw new Error('PG planning cannot read the account cache'); },
    resolveCreationModelId: () => 'model',
    creationSkillForUser: () => null,
    dissectionSkillAuditPayload: () => null,
    callMolanChat: async () => {
      calls.model += 1;
      return overrides.callResult || { json: { characters: [{ name: '新人物' }] }, usage: { creditCost: 3, billingStatus: 'exact', totalTokens: 20 } };
    },
    creationPlanExpansionPrompt: () => 'expand',
    normalizeCreationExpansionChapter: value => value,
    creationChapterNumber: value => value.chapterNo,
    creationChapterIsUsable: () => true,
    mergeCreationExpansionPayload: (payload, generated) => ({ ...payload, ...generated, expanded: true }),
    projectScope: { stableUserId: email => email },
    creationPlanReviewsInFlight,
    reviewCreationPlan: () => ({ status: 'passed', issues: [], blockerCount: 0, warningCount: 0 }),
    normalizeCreationPlanReviewModel: review => ({ patches: [], issues: [], ...review }),
    requestCreationPlanSemanticReview: overrides.requestReview || (async () => ({ review: { status: 'passed', summary: 'ok', patches: [] }, usage: { creditCost: 2 } })),
    applyCreationPlanPatches: payload => ({ payload, applied: [], rejected: [], changed: false }),
    mergeCreationPlanReview: () => ({ status: 'passed', issues: [], blockerCount: 0, warningCount: 0, reviewedAt: 1 }),
    creationBibleSeedValidation: () => ({ ok: true, hits: [], nameOverlaps: [], missing: [] }),
    creationForbiddenTerms: () => []
  });
  return {
    service, calls, repository, creationPlanReviewsInFlight,
    setAccess(value) { access = value; },
    current() { return current; }
  };
}

const request = (body = {}, auth) => ({
  body,
  auth,
  headers: { authorization: 'Bearer test' }
});

test('PG creation planning checks write and spend permission before model calls', async () => {
  const h = harness();
  h.setAccess({ active: true, role: 'viewer', can_spend: true });
  const expand = await h.service.handlePostgresCreationBookPlanExpand(request(), {}, 'book');
  const review = await h.service.handlePostgresCreationBookPlanReview(request(), {}, 'book');
  const regenerate = await h.service.handlePostgresCreationBookRegenerateAsset(request({ asset: 'worldRules' }), {}, 'book');
  assert.equal(expand.status, 403);
  assert.equal(review.status, 403);
  assert.equal(regenerate.status, 403);
  assert.equal(h.calls.model, 0);
  assert.equal(h.calls.writes.length, 0);
  assert.equal(h.creationPlanReviewsInFlight.size, 0);

  h.setAccess({ active: true, role: 'editor', can_spend: false });
  const noSpend = await h.service.handlePostgresCreationBookPlanExpand(request(), {}, 'book');
  assert.equal(noSpend.status, 403);
  assert.equal(h.calls.model, 0);
});

test('plan expansion maps a stale Bible CAS to the existing rebase response', async () => {
  const h = harness({ writeError: Object.assign(new Error('stale'), { code: 'revision_conflict' }) });
  const response = await h.service.handlePostgresCreationBookPlanExpand(request({ baseBibleVersion: 1 }), {}, 'book');
  assert.equal(h.calls.model, 1);
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'needs_rebase');
  assert.equal(h.calls.writes[0].expectedRevision, 1);
  assert.equal(h.current().version, 1);
});

test('plan expansion maps a budget rejection and reports the attempted cost', async () => {
  const h = harness({ writeError: Object.assign(new Error('over budget'), { code: 'budget_exceeded' }) });
  const response = await h.service.handlePostgresCreationBookPlanExpand(request({ baseBibleVersion: 1 }), {}, 'book');
  assert.equal(response.status, 402);
  assert.equal(response.body.code, 'budget_exceeded');
  assert.equal(response.body.budgetLimit, 10);
  assert.equal(response.body.spentCost, 2);
  assert.equal(response.body.additionalCost, 3);
});

test('unknown provider cost returns 502 without retrying or mutating the Bible', async () => {
  const expansion = harness({ callResult: { json: null, usage: null } });
  const response = await expansion.service.handlePostgresCreationBookPlanExpand(request({ baseBibleVersion: 1 }), {}, 'book');
  assert.equal(response.status, 502);
  assert.equal(response.body.code, 'PROVIDER_COST_UNKNOWN');
  assert.equal(expansion.calls.model, 1);
  assert.equal(expansion.calls.writes.length, 0);
  assert.equal(expansion.current().version, 1);

  const pending = harness({ callResult: { json: { characters: [{ name: '新人物' }] }, usage: { creditCost: 0, billingStatus: 'pending', totalTokens: 20 } } });
  const pendingResponse = await pending.service.handlePostgresCreationBookPlanExpand(request({ baseBibleVersion: 1 }), {}, 'book');
  assert.equal(pendingResponse.status, 502);
  assert.equal(pending.calls.model, 1);
  assert.equal(pending.calls.writes.length, 0);

  const regeneration = harness({ callResult: { json: { worldRules: [{ rule: '有限的规则' }] }, usage: { billingStatus: 'exact' } } });
  const regenerateResponse = await regeneration.service.handlePostgresCreationBookRegenerateAsset(request({ asset: 'worldRules' }), {}, 'book');
  assert.equal(regenerateResponse.status, 502);
  assert.equal(regenerateResponse.body.code, 'PROVIDER_COST_UNKNOWN');
  assert.equal(regeneration.calls.model, 1);
  assert.equal(regeneration.calls.writes.length, 0);
  assert.equal(regeneration.current().version, 1);
});

test('asset regeneration persists only with a settled provider cost', async () => {
  const h = harness({ callResult: { json: { worldRules: [{ rule: '有限的规则', limit: '明确边界', consequence: '承担代价', scope: '本世界' }] }, usage: { creditCost: 1.5, billingStatus: 'settled' } } });
  const response = {};
  await h.service.handlePostgresCreationBookRegenerateAsset(request({ asset: 'worldRules' }), response, 'book');
  assert.equal(response.status, 200);
  assert.equal(response.body.cost, 1.5);
  assert.equal(h.calls.writes.length, 1);
  assert.equal(h.calls.writes[0].additionalCost, 1.5);
  assert.equal(h.current().version, 2);
});

test('a failed semantic review does not settle a zero-cost Bible version', async () => {
  const h = harness({ requestReview: async () => { throw new Error('provider response was lost'); } });
  const response = await h.service.handlePostgresCreationBookPlanReview(request(), {}, 'book');
  assert.equal(response.status, 502);
  assert.equal(response.body.code, 'PROVIDER_COST_UNKNOWN');
  assert.equal(h.calls.writes.length, 0);
  assert.equal(h.current().version, 1);
  assert.equal(h.creationPlanReviewsInFlight.size, 0);
});

test('PG and local review share the injected lock, which is released after completion', async () => {
  let resolveReview;
  let reviewCalls = 0;
  const h = harness({
    requestReview: () => {
      reviewCalls += 1;
      return new Promise(resolve => { resolveReview = resolve; });
    }
  });
  const first = h.service.handlePostgresCreationBookPlanReview(request(), {}, 'book');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.creationPlanReviewsInFlight.has('user:book'), true);
  const concurrent = await h.service.handlePostgresCreationBookPlanReview(request(), {}, 'book');
  assert.equal(concurrent.status, 409);
  assert.equal(concurrent.body.code, 'creation_review_pending');
  assert.equal(reviewCalls, 1);
  resolveReview({ review: { status: 'passed', summary: 'ok', patches: [] }, usage: { creditCost: 2, billingStatus: 'exact' } });
  assert.equal((await first).status, 200);
  assert.equal(h.creationPlanReviewsInFlight.size, 0);

  const retry = h.service.handlePostgresCreationBookPlanReview(request(), {}, 'book');
  await new Promise(resolve => setImmediate(resolve));
  resolveReview({ review: { status: 'passed', summary: 'ok', patches: [] }, usage: { creditCost: 2, billingStatus: 'exact' } });
  assert.equal((await retry).status, 200);
  assert.equal(reviewCalls, 2);
  assert.equal(h.creationPlanReviewsInFlight.size, 0);
});
