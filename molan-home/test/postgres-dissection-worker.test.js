'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createPostgresRepository, readConfig } = require('../lib/postgres-repository');
const { createPostgresDissectionPipelineStore } = require('../services/postgres-dissection-pipeline-store');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function workerFixture(overrides = {}) {
  const calls = [];
  const record = {
    id: 'd_worker', ownerUserId: 'owner', userEmail: 'owner@example.test',
    status: 'queued', depth: 'deep', meta: {}, result: {}, actualCredits: null
  };
  const batches = Array.from({ length: 3 }, (_, index) => ({
    batch_no: index + 1, chapter_from: index * 2 + 1, chapter_to: index * 2 + 2, status: 'queued'
  }));
  const units = Array.from({ length: 6 }, (_, index) => ({ unitId: `unit-${index + 1}`, unitType: 'chapter' }));
  const store = {
    pipelineEnabled: async () => true,
    loadDissectionUnits: async () => units,
    loadDissectionBatches: async () => batches.map(batch => ({ ...batch })),
    ensurePipelineRun: async () => 'run_worker',
    updateBatchStatus: async (_record, number, status) => {
      calls.push(['batch', number, status]);
      batches[number - 1].status = status;
    },
    updatePipelineRunProgress: async () => { calls.push(['progress']); },
    syncCharactersToLibrary: async () => { calls.push(['characters']); }
  };
  const context = {
    POSTGRES_MODE: true, AbortController, Map, Math, Number, String, Date, Object, Array, Set,
    setTimeout, activeDissections: new Map(),
    loadDissectionRecordAsync: async () => ({ ...record }),
    saveDissectionRecordAsync: async next => { Object.assign(record, next); calls.push(['save', next.status]); },
    getPostgresDissectionPipelineStore: () => store,
    postgresRepository: { runtimeAccountByEmail: async () => ({ email: record.userEmail }) },
    postgresRuntimeUserFromRow: row => row,
    resolveModelForUser: () => 'permitted-model',
    dissectionPublicRecord: () => ({ isComplete: false }),
    waitForDissectionCapacity: async () => { calls.push(['capacity']); },
    dissectionScheduler: { releaseCapacity: () => { calls.push(['release-capacity']); } },
    releaseDissectionUserSlot: () => { calls.push(['release-user']); },
    dissectionSkillRecord: () => ({ id: 'dissection', files: [] }),
    dissectionSkillAuditPayload: () => ({ skills: [{ id: 'dissection' }] }),
    dissectionSkillPromptFiles: () => ['SKILL.md'],
    SKILL_AUDIT_VERSION: 1,
    isPipelineFactUnit: () => true,
    extractBatchFacts: async (_token, _owner, _record, batch) => { calls.push(['extract', batch.batch_no]); return 2; },
    runPipelineAggregation: async () => ({ characters: [{ name: '合成人物' }], validation: { conclusion: 'passed' } }),
    pipelineAggregationMissingFields: () => [],
    mergeDissectionResult: (prior, next) => ({ ...prior, ...next }),
    ...overrides
  };
  const startPipeline = source.indexOf('async function startPipelineJob(');
  const endPipeline = source.indexOf('async function loadDissectionRecordAsync(', startPipeline);
  const startOrdinary = source.indexOf('async function startDissectionJob(');
  const endOrdinary = source.indexOf('function recoverDissectionJobs(', startOrdinary);
  assert.ok(startPipeline >= 0 && endPipeline > startPipeline && endOrdinary > startOrdinary);
  vm.createContext(context);
  vm.runInContext(source.slice(startPipeline, endPipeline) + '\n' + source.slice(startOrdinary, endOrdinary), context);
  return { context, record, batches, calls, store };
}

test('ordinary worker reserves active identity before the first PG await and releases once on cancelled startup', async () => {
  let finishRead;
  const instance = workerFixture({
    loadDissectionRecordAsync: () => new Promise(resolve => { finishRead = resolve; })
  });
  const first = instance.context.startDissectionJob('d_worker', 'owner@example.test', 'synthetic');
  assert.equal(instance.context.activeDissections.size, 1);
  await instance.context.startDissectionJob('d_worker', 'owner@example.test', 'synthetic');
  finishRead({ ...instance.record, status: 'cancelled', cancelRequested: true });
  await first;
  assert.equal(instance.context.activeDissections.size, 0);
  assert.equal(instance.calls.filter(call => call[0] === 'release-user').length, 1);
  assert.equal(instance.calls.some(call => call[0] === 'extract'), false);
});

test('actual PG worker orchestration awaits finite batches, aggregation, character persistence and transfers slot ownership once', async () => {
  const instance = workerFixture();
  await instance.context.startDissectionJob(instance.record.id, instance.record.userEmail, 'synthetic');
  assert.equal(instance.record.status, 'completed');
  assert.deepEqual(instance.batches.map(batch => batch.status), ['completed', 'completed', 'completed']);
  assert.deepEqual(instance.calls.filter(call => call[0] === 'extract').map(call => call[1]), [1, 2, 3]);
  assert.equal(instance.calls.filter(call => call[0] === 'characters').length, 1);
  assert.equal(instance.calls.filter(call => call[0] === 'release-user').length, 1);
  assert.equal(instance.calls.filter(call => call[0] === 'release-capacity').length, 1);
  assert.equal(instance.context.activeDissections.size, 0);
});

test('PG batch provider-unknown fault never repeats extraction or enters later aggregation', async () => {
  const instance = workerFixture({
    extractBatchFacts: async () => { throw Object.assign(new Error('provider outcome unknown'), { unknown: true }); },
    runPipelineAggregation: async () => { throw new Error('must not aggregate after unknown outcome'); }
  });
  let attempts = 0;
  instance.context.extractBatchFacts = async () => { attempts++; throw Object.assign(new Error('provider outcome unknown'), { unknown: true }); };
  await instance.context.startDissectionJob(instance.record.id, instance.record.userEmail, 'synthetic');
  assert.equal(attempts, 1);
  assert.equal(instance.record.status, 'failed');
  assert.match(instance.record.error, /unknown/);
  assert.equal(instance.calls.filter(call => call[0] === 'release-user').length, 1);
  assert.equal(instance.calls.some(call => call[0] === 'characters'), false);
});

test('PG failure before pipeline handoff releases the startup identity and dispatches no provider', async () => {
  const instance = workerFixture();
  instance.store.pipelineEnabled = async () => { throw new Error('PG unavailable'); };
  await instance.context.startDissectionJob(instance.record.id, instance.record.userEmail, 'synthetic');
  assert.equal(instance.record.status, 'failed');
  assert.equal(instance.context.activeDissections.size, 0);
  assert.equal(instance.calls.filter(call => call[0] === 'release-user').length, 1);
  assert.equal(instance.calls.some(call => call[0] === 'extract'), false);
});

test('real isolated PG worker lifecycle persists finite batches, characters and releases fenced lease', {
  skip: process.env.MOLAN_PG_WORKER_LIFECYCLE_ACCEPTANCE !== '1', timeout: 20000
}, async () => {
  const settings = readConfig();
  assert.ok(settings.enabled && /test|acceptance/i.test(settings.config.database || ''));
  const repository = createPostgresRepository();
  const storageErrors = [];
  const trackedRepository = new Proxy(repository, {
    get(target, property) {
      const value = target[property];
      if (typeof value !== 'function') return value;
      return (...args) => Promise.resolve(value(...args)).catch(error => {
        storageErrors.push({ method: property, code: error.code, databaseCode: error.databaseCode, message: error.databaseMessage || error.message });
        throw error;
      });
    }
  });
  const suffix = crypto.randomBytes(8).toString('hex');
  const actor = 'worker_' + suffix;
  const record = {
    id: 'd_worker_' + suffix, ownerUserId: actor, userEmail: actor + '@example.test',
    title: '有限合成拆书', sourceText: '六章合成正文', depth: 'deep', status: 'queued',
    meta: {}, result: {}, actualCredits: null, createdAt: Date.now(), updatedAt: Date.now()
  };
  const units = Array.from({ length: 6 }, (_, index) => ({
    unitId: 'chapter-' + (index + 1), unitType: 'chapter', ordinal: index + 1,
    title: '合成第' + (index + 1) + '章', text: '人物甲在渡口寻找账本。'
  }));
  const store = createPostgresDissectionPipelineStore({
    postgresRepository: trackedRepository, buildDissectionUnits: () => units, dissectionWordCount: text => text.length,
    isPipelineFactUnit: unit => unit.unitType === 'chapter', normalizeEntityName: name => name.trim(),
    normalizePipelineEventType: type => type || '日常', pipelineBatchCharsFor: () => 4000,
    toTokenCount: value => value == null ? null : Number(value),
    PIPELINE_BATCH_MAX_CHAPTERS: 2, PIPELINE_MIN_CHAPTERS: 5, crypto
  });
  const instance = workerFixture({
    crypto, process, setInterval, clearInterval, requestError: (status, message) => Object.assign(new Error(message), { status }),
    postgresRepository: trackedRepository, getPostgresDissectionPipelineStore: () => store,
    loadDissectionRecordAsync: async id => {
      const row = await repository.runtimeGetDissection(actor, id);
      if (!row) return null;
      return { ...record, status: row.status, cancelRequested: row.cancel_requested,
        result: row.result_json, meta: row.meta_json, actualCredits: row.actual_credits };
    },
    saveDissectionRecordAsync: task => trackedRepository.runtimeUpdateDissection(task),
    extractBatchFacts: async (_token, _owner, task, batch) => {
      instance.calls.push(['extract', batch.batch_no]);
      const selected = units.slice(batch.chapter_from - 1, batch.chapter_to);
      await store.saveBatchFactsAndClaims(task, batch, selected, selected.map(unit => ({
        unitId: unit.unitId, entityMentions: [{ name: '人物甲', behavior: '寻找账本' }]
      })), new Map(units.map((unit, index) => [unit.unitId, index + 1])), task.pipelineRunId, 123);
      return 123;
    },
    runPipelineAggregation: async task => {
      await store.saveSummaries(task, 'book', [{ id: 'book_' + suffix, content: { bookSummary: '寻找账本' } }]);
      return { characters: [{ name: '人物甲', goal: '寻找账本' }], validation: { conclusion: 'passed' } };
    }
  });
  const declaration = source.indexOf('async function runPostgresDissectionWorker(');
  const end = source.indexOf('\n}', declaration);
  vm.runInContext(source.slice(declaration, end + 2), instance.context);
  try {
    await repository.initialize();
    await repository.runtimeRegisterAccount({ userId: actor, email: record.userEmail, name: '有限合成验收' });
    await repository.runtimeInsertDissection(record);
    await store.initializeDissectionPipeline(record, true);
    await instance.context.runPostgresDissectionWorker(record.id, record.userEmail, 'synthetic-not-a-real-model');
    const persisted = await repository.runtimeGetDissection(actor, record.id);
    assert.equal(persisted.status, 'completed', persisted.error + ': ' + JSON.stringify(storageErrors));
    assert.equal(persisted.worker_id, '');
    assert.equal(persisted.actual_credits, null);
    assert.equal((await store.loadDissectionBatches(record)).filter(batch => batch.status === 'completed').length, 3);
    assert.equal((await store.loadAllChapterFacts(record)).length, 6);
    assert.equal((await store.loadSummaries(record)).length, 1);
    assert.equal((await repository.runtimeListCharacterLibrary(actor)).length, 1);
    assert.deepEqual(instance.calls.filter(call => call[0] === 'extract').map(call => call[1]), [1, 2, 3]);
    assert.equal(instance.context.activeDissections.size, 0);
    assert.equal(instance.calls.filter(call => call[0] === 'release-user').length, 1);
  } finally {
    await repository.close();
  }
});
