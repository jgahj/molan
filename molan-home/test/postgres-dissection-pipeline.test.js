'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createPostgresDissectionPipelineStore } = require('../services/postgres-dissection-pipeline-store');
const { createPostgresRepository, readConfig } = require('../lib/postgres-repository');

function units() {
  return Array.from({ length: 6 }, (_, index) => ({
    unitId: `chapter-${index + 1}`, unitType: 'chapter', ordinal: index + 1,
    title: `合成第${index + 1}章`, text: '人物甲在渡口寻找账本。',
    sourceStart: index * 16, sourceEnd: (index + 1) * 16, charCount: 16
  }));
}

function storeFor(repository) {
  return createPostgresDissectionPipelineStore({
    postgresRepository: repository, buildDissectionUnits: units,
    dissectionWordCount: text => text.length,
    isPipelineFactUnit: unit => unit.unitType === 'chapter',
    normalizeEntityName: name => name.trim(),
    normalizePipelineEventType: type => type === '虐点' ? '冲突' : type || '日常',
    pipelineBatchCharsFor: () => 4000, toTokenCount: value => value == null ? null : Number(value),
    PIPELINE_BATCH_MAX_CHAPTERS: 2, PIPELINE_MIN_CHAPTERS: 5, crypto
  });
}

function memoryFixture() {
  const rows = new Map();
  const calls = [];
  const key = row => `${row.sourceTable}|${row.rowKey}`;
  const repository = {
    runtimeGetDissection: async () => ({ id: 'd_pipeline' }),
    runtimeListDissectionRows: async (actor, id, table) => {
      calls.push(['list', actor, id, table]);
      return [...rows.values()].filter(row => row.dissectionId === id && row.sourceTable === table)
        .map(row => ({ row_key: row.rowKey, document: row.document }));
    },
    runtimeUpsertDissectionRows: async (actor, values) => {
      calls.push(['upsert', actor, values]);
      for (const row of values) rows.set(key(row), row);
    },
    runtimeSyncCharactersToLibrary: async (actor, values) => {
      calls.push(['sync-characters', actor, values]);
      for (const row of values) if (!rows.has(key(row))) rows.set(key(row), row);
      return values.length;
    },
    runtimeReplaceDissectionTables: async input => {
      calls.push(['replace-tables', input]);
      for (const group of input.tableGroups) {
        for (const [rowKey, row] of rows) {
          if (row.dissectionId === input.dissectionId && row.sourceTable === group.sourceTable) rows.delete(rowKey);
        }
        for (const row of group.rows) rows.set(key(row), row);
      }
    },
    runtimeReplaceDissectionRows: async input => {
      await repository.runtimeReplaceDissectionTables({
        ...input, tableGroups: [{ sourceTable: input.sourceTable, rows: input.rows }]
      });
    },
    runtimeReplaceDissectionSummaries: async input => {
      calls.push(['summary-replace', input]);
      for (const [rowKey, row] of rows) {
        if (row.dissectionId === input.dissectionId && row.sourceTable === 'dissection_summaries' &&
            row.document.summary_type === input.summaryType) rows.delete(rowKey);
      }
      for (const row of input.rows) rows.set(key(row), row);
    },
    runtimeListCharacterLibrary: async actor => {
      calls.push(['characters', actor]);
      return [...rows.values()].filter(row => row.sourceTable === 'character_library')
        .map(row => ({ row_key: row.rowKey, document: row.document }));
    }
  };
  const record = { id: 'd_pipeline', ownerUserId: 'owner', userEmail: 'owner@example.test', depth: 'deep', sourceText: '合成正文', meta: {} };
  return { store: storeFor(repository), repository, record, rows, calls };
}

test('PG pipeline initialization writes all units and chapters atomically then creates finite batches', async () => {
  const fixture = memoryFixture();
  await fixture.store.initializeDissectionPipeline('owner', fixture.record, true);
  assert.equal((await fixture.store.loadDissectionUnits(fixture.record)).length, 6);
  assert.equal((await fixture.store.loadDissectionChapters(fixture.record)).length, 6);
  assert.equal((await fixture.store.loadDissectionBatches(fixture.record)).length, 3);
  assert.equal(await fixture.store.pipelineEnabled(fixture.record), true);
  const replacement = fixture.calls.find(call => call[0] === 'replace-tables')[1];
  assert.deepEqual(replacement.tableGroups.map(group => group.sourceTable), [
    'dissection_units', 'dissection_chapters', 'dissection_chapter_facts', 'dissection_claims'
  ]);
});

test('PG batch facts and claims commit in one operation, normalize event types and preserve chapter numbers', async () => {
  const fixture = memoryFixture();
  const sequence = new Map(units().map((unit, index) => [unit.unitId, index + 1]));
  await fixture.store.saveBatchFactsAndClaims(fixture.record, { batch_no: 2 }, units().slice(2, 4), [
    { unitId: 'chapter-3', events: [{ title: '寻找账本', participants: ['人物甲'], type: '虐点' }] },
    { unitId: 'chapter-4', entityMentions: [{ name: '人物甲', behavior: '过渡口' }] }
  ], sequence, 'run_pipeline', 123);
  const writes = fixture.calls.filter(call => call[0] === 'upsert');
  assert.equal(writes.length, 1);
  assert.deepEqual(new Set(writes[0][2].map(row => row.sourceTable)),
    new Set(['dissection_claims', 'dissection_chapter_facts']));
  const facts = await fixture.store.loadAllChapterFacts(fixture.record);
  assert.deepEqual(facts.map(fact => fact.chapterNo), [3, 4]);
  assert.equal(facts[0].fact.chapter_events[0].type, '冲突');
});

test('PG summary replacement is subtype-scoped without stale read and whole-table replacement', async () => {
  const fixture = memoryFixture();
  await fixture.store.saveSummaries(fixture.record, 'book', [{ id: 'book', content: { bookSummary: '合成总结' } }]);
  await fixture.store.saveSummaries(fixture.record, 'chapter', [{ id: 'chapter', content: { summary: '过渡口' } }]);
  await fixture.store.saveSummaries(fixture.record, 'chapter', []);
  assert.deepEqual((await fixture.store.loadSummaries(fixture.record)).map(row => row.id), ['book']);
  assert.equal(fixture.calls.filter(call => call[0] === 'summary-replace').length, 3);
  assert.equal(fixture.calls.some(call => call[0] === 'replace-tables'), false);
});

test('PG pipeline rejects corrupt rows and nested facts rather than washing them into empty success', async () => {
  const fixture = memoryFixture();
  fixture.repository.runtimeListDissectionRows = async () => [{ document: '{' }];
  await assert.rejects(fixture.store.loadDissectionUnits(fixture.record), /损坏/);
  fixture.repository.runtimeListDissectionRows = async () => [{ document: { fact_json: '{' } }];
  await assert.rejects(fixture.store.loadAllChapterFacts(fixture.record), SyntaxError);
  fixture.repository.runtimeListDissectionRows = async () => [{ document: { fact: [] } }];
  await assert.rejects(fixture.store.loadAllChapterFacts(fixture.record), /损坏/);
});

test('PG character library queries the owner collection across dissections', async () => {
  const fixture = memoryFixture();
  fixture.record.result = { characters: [{ name: '人物甲', goal: '寻找账本' }] };
  await fixture.store.syncCharactersToLibrary(fixture.record);
  const characters = await fixture.store.listCharactersInLibrary('owner', fixture.record.userEmail);
  assert.equal(characters.length, 1);
  assert.equal(characters[0].name, '人物甲');
  assert.ok(fixture.calls.some(call => call[0] === 'characters' && call[1] === 'owner'));
});

test('real isolated PG pipeline, owner fence, subtype concurrency, single-row deletion, CAS and cancellation', {
  skip: process.env.MOLAN_PG_PIPELINE_ACCEPTANCE !== '1'
}, async () => {
  const config = readConfig(process.env);
  assert.ok(config.enabled && /test|acceptance/i.test(config.config.database || ''));
  const repository = createPostgresRepository();
  const suffix = crypto.randomBytes(8).toString('hex');
  const actor = `pipeline_${suffix}`;
  const outsider = `pipeline_other_${suffix}`;
  const record = {
    id: `d_pipeline_${suffix}`, ownerUserId: actor, userEmail: `${actor}@example.test`,
    title: '有限合成流水线', sourceText: '合成正文', depth: 'deep', status: 'queued',
    meta: {}, result: {}, actualCredits: null, createdAt: Date.now(), updatedAt: Date.now()
  };
  try {
    await repository.initialize();
    await repository.runtimeRegisterAccount({ userId: actor, email: record.userEmail, name: '合成验收' });
    await repository.runtimeRegisterAccount({ userId: outsider, email: `${outsider}@example.test`, name: '权限验收' });
    await repository.runtimeInsertDissection(record);
    const store = storeFor(repository);
    await store.initializeDissectionPipeline(actor, record, true);
    assert.equal((await store.loadDissectionUnits(record)).length, 6);
    assert.equal((await store.loadDissectionBatches(record)).length, 3);
    await Promise.all([
      store.saveSummaries(record, 'chapter', [{ id: `chapter_${suffix}`, content: { summary: '渡口' } }]),
      store.saveSummaries(record, 'book', [{ id: `book_${suffix}`, content: { bookSummary: '账本' } }])
    ]);
    assert.equal((await store.loadSummaries(record)).length, 2);
    assert.equal(await repository.runtimeGetDissection(outsider, record.id), null);
    await assert.rejects(store.storeDissectionUnits(outsider, record, units()), { code: 'not_found' });
    await repository.runtimeUpsertDissectionRows(actor, ['first', 'second'].map(label => ({
      rowKey: `${label}_${suffix}`, dissectionId: record.id, sourceTable: 'dissection_versions', document: { label }
    })));
    await repository.runtimeDeleteDissectionRow(actor, record.id, 'dissection_versions', `first_${suffix}`);
    assert.equal((await repository.runtimeListDissectionRows(actor, record.id, 'dissection_versions')).length, 1);
    const before = await repository.runtimeGetDissection(actor, record.id);
    await assert.rejects(repository.runtimeUpdateDissection({ ...record, expectedRevision: Number(before.revision) + 1 }), { code: 'revision_conflict' });
    await repository.runtimeRecordModelUsage({ userId: actor, requestId: `usage_${suffix}`, usage: { creditCost: null } });
    assert.equal(await repository.runtimeRecordModelUsage({ userId: actor, requestId: `usage_${suffix}`, usage: { creditCost: 10 } }), 0);
    await repository.runtimeRequestDissectionCancel(actor, record.id);
    await assert.rejects(store.storeDissectionUnits(record, units()), { code: 'cancelled' });
    await assert.rejects(store.saveSummaries(record, 'book', []), { code: 'cancelled' });
    assert.equal((await store.loadSummaries(record)).length, 2);
    assert.equal((await repository.runtimeGetDissection(actor, record.id)).actual_credits, null);
  } finally {
    await repository.close();
  }
});
