'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createPostgresCreationHttpService } = require('../services/postgres-creation-http-service');
const { createCreationPlanService } = require('../services/creation-plan-service');

const planService = createCreationPlanService({
  CREATION_LINE_IDS: new Set(),
  CREATION_OPENING_STRATEGIES: new Set(),
  CREATION_PLAN_BATCH_SIZE: 10,
  CREATION_PLAN_PATCH_ROOTS: new Set(),
  CREATION_PLAN_PATCH_ROOT_KINDS: {},
  CREATION_PLAN_REVIEW_LAYERS: new Set(),
  CREATION_RETENTION_LEVELS: new Set(),
  SOMATIC_REFLEX_PATTERN: /$^/,
  computeEventChainLCS: () => 0,
  computeMapTopologySimilarity: () => 0,
  computeRoleCombinationJaccard: () => 0,
  normalizeAuthorDna: v => v || {},
  sha256Text: v => String(v || '')
});

function makeService({ body, books = [], bibleByBook = new Map(), onCreate }) {
  const forbidden = () => { throw new Error('legacy storage must not be called'); };
  return createPostgresCreationHttpService({
    getAuthUser: () => ({ user: { userId: 'u_local' } }),
    postgresActor: auth => auth.user.userId,
    json: (res, status, payload) => Object.assign(res, { status, body: payload }),
    readBody: async () => body,
    normalizeBiblePayload: planService.normalizeBiblePayload,
    creationBibleSeedValidation: planService.creationBibleSeedValidation,
    creationForbiddenTerms: planService.creationForbiddenTerms,
    normalizeCreationPlan: planService.normalizeCreationPlan,
    postgresRepository: {
      getProfile: async (_actor, id) => (id === 'n_editor_1' ? { access: { workspace_id: 'w_1' } } : null),
      listCreationBooks: async () => books,
      getCreationBible: async (_actor, bookId) => bibleByBook.get(bookId) || null,
      createCreationBook: async input => {
        if (onCreate) onCreate(input);
        return {
          reused: false,
          book: { id: input.bookId, title: input.title, novelId: input.projectId, currentStateVersion: 0 },
          bible: { version: 1, payload: input.payload }
        };
      }
    },
    handleCreationBooksList: forbidden,
    handleCreationBookBibleGet: forbidden,
    handleCreationBookBiblePut: forbidden,
    handleCreationBookState: forbidden,
    handleCreationBookChapterAudit: forbidden,
    handleCreationBookChapterContract: forbidden,
    handleCreationBookCommit: forbidden
  });
}

test('standard creation-books POST still enforces full creationBibleSeedValidation', async () => {
  const res = {};
  const svc = makeService({
    body: { title: '测试小说', novelId: 'n_editor_1', bible: { characters: [], map: { nodes: [] }, goldenFinger: { type: '' } } }
  });
  await svc.handlePostgresCreationBooksCreate({}, res);
  assert.equal(res.status, 422);
  assert.equal(res.body.code, 'incomplete_generation');
  assert.equal(res.body.error, '创作圣经结构不完整');
});

test('editorBootstrap=true allows sparse editor novel bible while keeping forbidden/overlap checks', async () => {
  let createdInput = null;
  const res = {};
  const svc = makeService({
    body: {
      title: '海沙流',
      novelId: 'n_editor_1',
      editorBootstrap: true,
      bible: {
        characters: [{ name: '李修文', role: '主角' }],
        worldbuilding: [],
        map: { nodes: [{ name: '深水埗', type: '地点' }], edges: [] },
        goldenFinger: { type: '' }
      }
    },
    onCreate: input => { createdInput = input; }
  });
  await svc.handlePostgresCreationBooksCreate({}, res);
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.book.id);
  assert.equal(createdInput.projectId, 'n_editor_1');
  assert.equal(createdInput.payload.characters[0].name, '李修文');

  // Overlapping character names must still be blocked even during editorBootstrap
  const overlapRes = {};
  const overlapSvc = makeService({
    body: {
      title: '重字测试',
      novelId: 'n_editor_1',
      editorBootstrap: true,
      bible: {
        characters: [{ name: '林远' }, { name: '林风' }],
        map: { nodes: [] },
        goldenFinger: { type: '' }
      }
    }
  });
  await overlapSvc.handlePostgresCreationBooksCreate({}, overlapRes);
  assert.equal(overlapRes.status, 422);
  assert.equal(overlapRes.body.code, 'character_name_overlap');
});

test('editorBootstrap=true reuses existing creation book already linked to novelId', async () => {
  const res = {};
  let createCalled = false;
  const existingBook = { id: 'cb_existing', title: '已有书', novelId: 'n_editor_1', currentStateVersion: 2 };
  const svc = makeService({
    body: { title: '已有书', novelId: 'n_editor_1', editorBootstrap: true },
    books: [existingBook],
    bibleByBook: new Map([['cb_existing', { bible: { version: 3, payload: { characters: [] } } }]]),
    onCreate: () => { createCalled = true; }
  });
  await svc.handlePostgresCreationBooksCreate({}, res);
  assert.equal(createCalled, false);
  assert.equal(res.status, 200);
  assert.equal(res.body.reused, true);
  assert.equal(res.body.book.id, 'cb_existing');
  assert.equal(res.body.book.bibleVersion, 3);
});

test('completion-editor.js sends editorBootstrap and reads creationData.book.id', () => {
  const code = fs.readFileSync(path.resolve(__dirname, '../completion-editor.js'), 'utf8');
  assert.match(code, /function buildEditorSeedBible\(state, prompt\)/);
  assert.match(code, /editorBootstrap:\s*true/);
  assert.match(code, /creationData\.book && creationData\.book\.id/);
});
