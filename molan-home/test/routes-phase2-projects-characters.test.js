'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createCharacterHandlers } = require('../routes/character-handlers');
const { createProjectAssetHandlers } = require('../routes/project-asset-handlers');
const { createProjectRoutes } = require('../routes/projects');

test('createCharacterHandlers: list, patch, merge, export and novel import behave correctly', async () => {
  const pgRows = [
    {
      row_key: 'c1', dissection_id: 'd1',
      document: JSON.stringify({ id: 'c1', name: '林枫', function: '主角', goal: '复仇', conflict: '弱小', arc: '逆袭', first_appearance: '第1章', notes: '隐忍', dissection_id: 'd1', created_at: 1000 })
    },
    {
      row_key: 'c2', dissection_id: 'd1',
      document: { id: 'c2', name: '林风', function: '配角', goal: '保命', conflict: '牵连', arc: '牺牲', first_appearance: '第2章', notes: '同宗', dissection_id: 'd1', created_at: 1001 }
    }
  ];

  let patched = null;
  let mergedArgs = null;
  const postgresRepository = {
    runtimeListCharacterLibrary: async () => pgRows,
    runtimePatchCharacter: async (userId, id, body) => {
      patched = { userId, id, body };
      return { row_key: id, document: JSON.stringify({ ...JSON.parse(pgRows[0].document), name: body.name }) };
    },
    runtimeMergeCharacters: async (userId, fromNames, intoName) => {
      mergedArgs = { userId, fromNames, intoName };
      return 1;
    }
  };

  let currentBody = { name: '林枫_新' };
  const mockDb = {
    prepare(sql) {
      if (sql.includes('SELECT id,user_email,owner_user_id,workspace_id,project_id,state_json,revision FROM novels WHERE id = ?')) {
        return {
          get: (id) => ({
            id, user_email: 'user@test.local', owner_user_id: 'u1',
            workspace_id: 'ws1', project_id: 'p1', revision: 2,
            state_json: JSON.stringify({ knowledge: { entities: {} } })
          })
        };
      }
      if (sql.includes('UPDATE novels')) {
        return { run: () => ({ changes: 1 }) };
      }
      return { all: () => [], get: () => null, run: () => ({ changes: 1 }) };
    }
  };

  const deps = {
    json: (_res, status, body) => ({ status, body }),
    readBody: async () => currentBody,
    respondError: (_res, err) => ({ status: 500, error: err }),
    getAuthUser: () => ({ user: { userId: 'u1', email: 'user@test.local' } }),
    requireSqliteForPublic: () => true,
    dbReady: () => true,
    db: mockDb,
    postgresRepository,
    projectScope: {
      WRITE_ROLES: new Set(['owner', 'admin', 'editor']),
      getNovelAccess: () => ({ role: 'owner', workspace_id: 'ws1', project_id: 'p1' }),
      canAccess: () => true
    },
    sanitizeNovelStateForStorage: s => s,
    responseCors: () => ({})
  };

  const handlers = createCharacterHandlers(deps);
  assert.equal(typeof handlers.charactersList, 'function');
  assert.equal(typeof handlers.charactersPatch, 'function');
  assert.equal(typeof handlers.charactersMerge, 'function');
  assert.equal(typeof handlers.charactersExport, 'function');
  assert.equal(typeof handlers.novelImportCharacters, 'function');

  // Test List (PG)
  const listRes = await handlers.handleCharactersList({}, {});
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.characters.length, 2);
  assert.equal(listRes.body.characters[0].name, '林枫');
  assert.equal(listRes.body.characters[0].firstAppearance, '第1章');
  assert.equal(listRes.body.characters[1].name, '林风');

  // Test Patch (PG)
  const patchRes = await handlers.handleCharactersPatch({}, {}, 'c1');
  assert.equal(patchRes.status, 200);
  assert.equal(patchRes.body.character.name, '林枫_新');
  assert.deepEqual(patched, { userId: 'u1', id: 'c1', body: { name: '林枫_新' } });

  // Test Merge (PG)
  currentBody = { fromNames: ['林风'], intoName: '林枫' };
  const mergeRes = await handlers.handleCharactersMerge({}, {});
  assert.equal(mergeRes.status, 200);
  assert.equal(mergeRes.body.merged, 1);
  assert.deepEqual(mergedArgs, { userId: 'u1', fromNames: ['林风'], intoName: '林枫' });

  // Test Export (PG, json format)
  let exportHead = null;
  let exportPayload = '';
  const exportRes = {
    writeHead: (status, headers) => { exportHead = { status, headers }; },
    end: (payload) => { exportPayload = payload; }
  };
  await handlers.handleCharactersExport({ url: 'http://localhost/api/characters/export?format=json' }, exportRes);
  assert.equal(exportHead.status, 200);
  assert.equal(exportHead.headers['Content-Type'], 'application/json; charset=utf-8');
  const exported = JSON.parse(exportPayload);
  assert.equal(exported.length, 2);
  assert.equal(exported[0].name, '林枫');

  // Test Novel Import (legacy sqlite path retained for router fallback)
  currentBody = { characters: [{ name: '叶天', function: '主角' }] };
  const importRes = await handlers.handleNovelImportCharacters({}, {}, 'n_novel1');
  assert.equal(importRes.status, 200);
  assert.equal(importRes.body.ok, true);
  assert.equal(importRes.body.added, 1);
  assert.equal(importRes.body.revision, 3);
});

test('createProjectAssetHandlers: export, import, restore and prompt compilation behave correctly', async () => {
  const profile = {
    title: '修罗武神',
    access: { workspace_id: 'ws1', project_id: 'p1', owner_user_id: 'u1', role: 'owner' },
    state: { title: '修罗武神', volumes: [] }
  };

  const deps = {
    json: (_res, status, body) => ({ status, body }),
    readBody: async () => ({ package: { version: '1.0' }, revision: 1 }),
    respondError: (_res, err) => ({ status: 500, error: err }),
    respondPostgresError: (_res, err) => ({ status: 500, error: err }),
    getAuthUser: () => ({ user: { userId: 'u1', email: 'user@test.local' } }),
    postgresActor: () => 'u1',
    postgresRepository: {
      getProfile: async () => profile,
      listExportableChapters: async () => [{ chapterNo: 1, title: '第1章', text: '风起云涌' }],
      listAllResources: async () => [],
      getCreationPackageData: async () => ({}),
      restorePackage: async () => ({ ok: true, revision: 2 })
    },
    projectScope: {
      PROJECT_ROLES: new Set(['owner', 'admin', 'editor', 'viewer']),
      WRITE_ROLES: new Set(['owner', 'admin', 'editor']),
      canAccess: () => true
    },
    projectPackage: {
      exportProjectPackage: () => ({ meta: { exported: true } }),
      importProjectPackage: (_pkg, opts) => opts.mode === 'preflight'
        ? { ok: true, warnings: [] }
        : { ok: true, state: { title: '修罗武神', volumes: [] } }
    },
    parseNovelExportRange: () => ({ ok: true, range: null }),
    sendNovelExport: (_res, _id, state, chapters) => ({ ok: true, stateTitle: state.title, chapterCount: chapters.length }),
    sanitizeNovelStateForStorage: s => s
  };

  const handlers = createProjectAssetHandlers(deps);
  assert.equal(typeof handlers.postgresNovelExport, 'function');
  assert.equal(typeof handlers.postgresPackageExport, 'function');
  assert.equal(typeof handlers.postgresPackageImport, 'function');
  assert.equal(typeof handlers.postgresPackageRestore, 'function');
  assert.equal(typeof handlers.novelPromptCompilation, 'function');

  // Test Export
  const exportRes = await handlers.handlePostgresNovelExport({ url: 'http://localhost/api/novels/n_1/export' }, {}, 'n_1');
  assert.equal(exportRes.ok, true);
  assert.equal(exportRes.stateTitle, '修罗武神');
  assert.equal(exportRes.chapterCount, 1);

  // Test Package Export
  const pkgExportRes = await handlers.handlePostgresPackageExport({}, {}, 'n_1');
  assert.equal(pkgExportRes.status, 200);
  assert.equal(pkgExportRes.body.package.meta.exported, true);

  // Test Package Import Preflight
  const pkgImportRes = await handlers.handlePostgresPackageImport({}, {}, 'n_1');
  assert.equal(pkgImportRes.status, 200);
  assert.equal(pkgImportRes.body.ok, true);

  // Test Package Restore
  const pkgRestoreRes = await handlers.handlePostgresPackageRestore({}, {}, 'n_1');
  assert.equal(pkgRestoreRes.status, 200);
  assert.equal(pkgRestoreRes.body.revision, 2);

  // Test Novel Prompt Compilation GET
  const promptBlocksRes = await handlers.handleNovelPromptCompilation({ method: 'GET' }, {});
  assert.equal(promptBlocksRes.status, 200);
  assert.equal(promptBlocksRes.body.ok, true);
  assert.ok(promptBlocksRes.body.blocks);
});

test('createProjectRoutes integrates cleanly with character and project asset handlers', async () => {
  const routedCalls = [];
  const charHandlers = {
    charactersList: async () => { routedCalls.push('charactersList'); },
    charactersExport: async () => { routedCalls.push('charactersExport'); },
    charactersMerge: async () => { routedCalls.push('charactersMerge'); },
    charactersPatch: async () => { routedCalls.push('charactersPatch'); },
    novelImportCharacters: async () => { routedCalls.push('novelImportCharacters'); }
  };
  const assetHandlers = {
    postgresNovelExport: async () => { routedCalls.push('postgresNovelExport'); },
    postgresPackageExport: async () => { routedCalls.push('postgresPackageExport'); },
    postgresPackageImport: async () => { routedCalls.push('postgresPackageImport'); },
    postgresPackageRestore: async () => { routedCalls.push('postgresPackageRestore'); }
  };

  const dispatchProject = createProjectRoutes({
    postgresMode: true,
    handlers: {
      ...charHandlers,
      ...assetHandlers,
      respondPostgresError: () => {}
    }
  });

  const req = { method: 'GET' };
  const res = {};

  assert.equal(await dispatchProject(req, res, '/api/characters'), true);
  assert.equal(routedCalls[0], 'charactersList');

  assert.equal(await dispatchProject(req, res, '/api/characters/export'), true);
  assert.equal(routedCalls[1], 'charactersExport');

  assert.equal(await dispatchProject({ method: 'POST' }, res, '/api/characters/merge'), true);
  assert.equal(routedCalls[2], 'charactersMerge');

  assert.equal(await dispatchProject({ method: 'PATCH' }, res, '/api/characters/c_123'), true);
  assert.equal(routedCalls[3], 'charactersPatch');

  assert.equal(await dispatchProject(req, res, '/api/novels/n_123/package'), true);
  assert.equal(routedCalls[4], 'postgresPackageExport');
});
