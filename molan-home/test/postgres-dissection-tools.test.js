'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const names = ['handleDissectionCreativeBrief', 'handleDissectionCreationContext', 'handleDissectionChapterContract',
  'handleDissectionAudit', 'handleDissectionImitate', 'handleDissectionDiagnose', 'handleDissectionsCompare'];

function fixture(overrides = {}) {
  const calls = { reads: [], contexts: [], writes: [], models: [], responses: [] };
  const record = { id: 'd_tools', ownerUserId: 'owner', userEmail: 'owner@example.test', status: 'completed',
    depth: 'standard', result: { characters: [], foreshadowing: [], sellingPoints: [] }, meta: {}, revision: 7 };
  const forbidden = () => { throw new Error('legacy path invoked'); };
  const context = {
    POSTGRES_MODE: true, Math, Number, String, Date, Object, Array, Set, JSON, Promise,
    getAuthUser: () => ({ user: { userId: 'owner', email: record.userEmail } }),
    loadDissectionRecordAsync: async (id, email, actor) => {
      calls.reads.push([id, email, actor]);
      return { ...record, id };
    },
    getPostgresDissectionPipelineStore: () => ({
      dissectionContextForChapter: async (task, chapter) => {
        calls.contexts.push([task.id, chapter]);
        return { arcs: [], characterStates: [], timeline: [], foreshadows: [] };
      }
    }),
    readBody: async req => req.body || {},
    callMolanChat: async (_authorization, user, options) => {
      calls.models.push([user, options]);
      return { json: { brief: { targetGenre: '合成题材' }, goal: '寻找账本', issues: [], passage: '合成片段' }, text: '{}' };
    },
    saveDissectionRecordAsync: async task => { calls.writes.push(task); },
    json: (_res, status, body) => { calls.responses.push({ status, body }); },
    respondError: (_res, error) => { calls.responses.push({ status: error.status || 500, error }); },
    loadDissectionRecord: forbidden, updateDissectionRecord: forbidden, getUserByEmail: forbidden,
    requireSqliteForPublic: forbidden, dissectionContextForChapter: forbidden,
    dissectionResultHasCompleteContent: () => true,
    dissectionResultView: value => value,
    dissectionTransferJson: value => JSON.stringify(value),
    currentDefaultModel: () => 'synthetic-model',
    dissectionSkillAuditPayload: () => ({ skills: [{ id: 'dissection' }] }),
    queryParamsFromUrl: () => ({ chapterNo: 2 }),
    pipelineBatchCharsFor: () => 12000,
    deterministicContractValidation: () => ({ passed: true }),
    checkForbiddenTerms: () => [],
    safeJsonParse: JSON.parse,
    ...overrides
  };
  vm.createContext(context);
  for (const name of [...names, 'handleDissectionApply', 'handleDissectionRebuild', 'handleDissectionExtract']) {
    const declaration = source.indexOf('function ' + name + '(');
    assert.ok(declaration >= 0);
    const start = source.lastIndexOf('\n', declaration) + 1;
    const end = source.indexOf('\n}', declaration);
    assert.ok(end > declaration);
    vm.runInContext(source.slice(start, end + 2), context);
  }
  return { context, calls, record };
}

test('actual PG dissection tool handlers read native records and contexts without legacy access or real models', async () => {
  const harness = fixture();
  for (const name of names) {
    const body = name === 'handleDissectionsCompare' ? { ids: ['d_first', 'd_second'] } : { chapterNo: 2, content: '合成正文' };
    await harness.context[name]({ headers: {}, body, url: '/synthetic' }, {}, 'd_tools');
    assert.equal(harness.calls.responses.at(-1).status, 200, name);
  }
  assert.equal(harness.calls.models.length, 6);
  assert.ok(harness.calls.reads.every(read => read[2] === 'owner'));
  assert.equal(harness.calls.contexts.length, 3);
  assert.equal(harness.calls.writes.length, 1);
  assert.equal(harness.calls.writes[0].expectedRevision, 7);
});

test('PG tool owner misses and corrupt native reads never dispatch a model', async () => {
  const harness = fixture({ loadDissectionRecordAsync: async () => null });
  for (const name of names) {
    await harness.context[name]({ headers: {}, body: { ids: ['d_first', 'd_second'] } }, {}, 'd_tools');
    assert.equal(harness.calls.responses.at(-1).status, 404, name);
  }
  assert.equal(harness.calls.models.length, 0);
  const corrupted = fixture({ loadDissectionRecordAsync: async () => { throw new Error('corrupt persisted record'); } });
  await assert.rejects(corrupted.context.handleDissectionChapterContract({ headers: {} }, {}, 'd_tools'), /corrupt/);
  assert.equal(corrupted.calls.models.length, 0);
});

test('PG brief CAS failure and unknown model result cannot report persistence success or retry', async () => {
  const conflict = fixture({ saveDissectionRecordAsync: async () => { throw Object.assign(new Error('CAS conflict'), { status: 409 }); } });
  await assert.rejects(conflict.context.handleDissectionCreativeBrief({ headers: {} }, {}, 'd_tools'), /CAS conflict/);
  assert.equal(conflict.calls.models.length, 1);
  assert.equal(conflict.calls.responses.length, 0);
  let attempts = 0;
  const unknown = fixture({ callMolanChat: async () => { attempts++; throw new Error('provider unknown'); } });
  await assert.rejects(unknown.context.handleDissectionCreativeBrief({ headers: {} }, {}, 'd_tools'), /provider unknown/);
  assert.equal(attempts, 1);
  assert.equal(unknown.calls.writes.length, 0);
});

test('PG portable apply and graph rebuild never use legacy storage or dispatch models', async () => {
  const operations = [];
  const harness = fixture({
    getPostgresDissectionPipelineStore: () => ({
      buildDissectionEntities: async () => { operations.push('entities'); return 2; },
      buildDissectionEvents: async () => { operations.push('events'); return 1; },
      buildEntityStates: async () => { operations.push('states'); return 2; },
      buildEventEdges: async () => { operations.push('edges'); return 1; },
      storeDissectionForeshadows: async () => { operations.push('foreshadows'); }
    }),
    getPostgresDissectionReadService: () => ({ computeDissectionStats: async () => ({ entities: 2 }) }),
    buildDissectionEntities: () => { throw new Error('legacy graph'); }
  });
  await harness.context.handleDissectionApply({ body: {} }, {}, 'd_tools');
  assert.equal(harness.calls.responses.at(-1).body.mode, 'portable-profile');
  await harness.context.handleDissectionRebuild({ url: '/synthetic' }, {}, 'd_tools');
  assert.equal(harness.calls.responses.at(-1).status, 200);
  assert.deepEqual(operations, ['entities', 'events', 'states', 'edges', 'foreshadows']);
  assert.equal(harness.calls.models.length, 0);
});

test('PG document extraction is storage-independent and awaits extraction completion', async () => {
  const harness = fixture({
    Buffer,
    textExtract: { isExtractable: () => true, extractDocument: async () => ({ text: '合成正文', title: '合成书', format: 'docx' }) }
  });
  await harness.context.handleDissectionExtract({ body: { name: 'synthetic.docx', base64: Buffer.from('synthetic').toString('base64') } }, {});
  assert.equal(harness.calls.responses.at(-1).body.text, '合成正文');
  assert.equal(harness.calls.reads.length, 0);
});
