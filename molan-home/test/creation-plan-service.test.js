'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const server = require('../server');
const { createCreationPlanService } = require('../services/creation-plan-service');
const { createCreationBookService } = require('../services/creation-book-service');
const roots = ['bookPremise', 'architecture', 'opening', 'authorDna', 'goldenFinger', 'worldbuilding', 'worldRules', 'map', 'characters', 'characterLibrary', 'mainline', 'storyTree', 'conflictChain', 'rewardChain', 'relationships', 'volumePlan', 'arcPlan', 'chapterPlan', 'scenePlan', 'foreshadowLedger', 'reviewPlan', 'divergenceMatrix', 'timeline'];
const objectRoots = ['bookPremise', 'architecture', 'opening', 'authorDna', 'goldenFinger', 'map', 'mainline', 'reviewPlan'];
const service = createCreationPlanService({
  CREATION_RETENTION_LEVELS: new Set(['keep', 'tune', 'rewrite']),
  CREATION_LINE_IDS: new Set(['growth', 'revenge', 'romance', 'family', 'faction', 'mystery', 'survival', 'team', 'truth', 'competition']),
  CREATION_OPENING_STRATEGIES: new Set(['advisory', 'strict', 'disabled']), CREATION_PLAN_BATCH_SIZE: 20,
  CREATION_PLAN_REVIEW_LAYERS: ['structure', 'worldbuilding', 'characters', 'mainline', 'conflict', 'reward', 'chapter', 'originality'],
  CREATION_PLAN_PATCH_ROOTS: new Set(roots), CREATION_PLAN_PATCH_ROOT_KINDS: Object.fromEntries(roots.map(root => [root, objectRoots.includes(root) ? 'object' : 'array'])),
  computeEventChainLCS: server.computeEventChainLCS, computeRoleCombinationJaccard: server.computeRoleCombinationJaccard,
  computeMapTopologySimilarity: server.computeMapTopologySimilarity, sha256Text: server.sha256Text
});

test('extracted plan normalization, coverage and protected patches preserve legacy results', () => {
  const plan = { totalChapters: 120, volumeCount: 6, lines: [{ id: 'growth', label: '成长线', weight: 1 }], retention: { opening: 'keep' } };
  assert.deepEqual(service.normalizeCreationPlan(plan), server.normalizeCreationPlan(plan));
  const payload = { creationPlan: plan, chapterPlan: [{ chapterNo: 1, title: 'First', goal: 'Discover the clue', hook: 'A hidden cost' }] };
  assert.deepEqual(service.creationPlanCoverage(payload), server.creationPlanCoverage(payload));
  assert.deepEqual(service.creationPlanProjection(payload), server.creationPlanProjection(payload));
  const patches = [{ op: 'replace', path: '/chapterPlan/0/hook', value: 'A new danger' }, { op: 'replace', path: '/sourceStructure/rawText', value: 'blocked' }];
  assert.deepEqual(service.applyCreationPlanPatches(payload, patches), server.applyCreationPlanPatches(payload, patches));
});

test('extracted Bible lifecycle resolves current database and preserves CAS conflict', () => {
  let current;
  const bookService = createCreationBookService({ getDatabase: () => current, dbReady: () => true, sha256Text: server.sha256Text,
    projectScope: { stableUserId: value => value } });
  const database = label => ({ prepare: () => ({ get: () => ({ label }), run: () => ({ changes: 0 }) }), exec: () => {} });
  current = database('one'); assert.equal(bookService.loadCreationBook('book', 'a@example.test').label, 'one');
  current = database('two'); assert.equal(bookService.loadCreationBook('book', 'a@example.test').label, 'two');
  assert.deepEqual(bookService.saveCreationBibleVersion({ id: 'book', user_email: 'a@example.test' }, { bibleId: 'bible', version: 1 }, {}, 'revision', 'a@example.test', 0), { ok: false, conflict: true });
});
