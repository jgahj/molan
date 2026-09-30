'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { JsonAppRepository } = require('../lib/repositories/json-app-repository');
const { JsonDissectionRepository } = require('../lib/repositories/json-dissection-repository');
const { createNativeDissectionWorker } = require('../services/native-dissection-worker');

test('native worker persists provider boundary before calling and stops unknown usage from completion', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'molan-dissection-worker-'));
  const app = new JsonAppRepository(directory);
  try {
    const user = await app.saveAccount({ email: 'worker@example.test', credits: 100 });
    const repository = new JsonDissectionRepository(app.repository, {
      phases: ['map'], inputService: { cleanDissectionText: x => x, buildDissectionUnits: text => [{ unitId: 'u1', ordinal: 1, text }] },
      resultService: { normalizeDissectionStageResult: x => x, mergeDissectionResult: (a, b) => ({ ...a, ...b }), dissectionStageMissingFields: () => [] }
    });
    const create = id => repository.create({ actorUserId: user.userId, id, requestId: id, sourceText: 'Story', selectedModel: 'test-model' });
    await create('d_success');
    let calls = 0;
    const worker = createNativeDissectionWorker({ repository, phases: ['map'], getAccount: () => app.getAccount(user.userId),
      callStage: async () => { calls++; return { json: { overview: 'Complete' }, usage: { promptTokens: 10, completionTokens: 5, creditCost: 1 } }; } });
    const result = await worker.execute({ actorUserId: user.userId, jobId: 'd_success', authToken: 'test' });
    assert.equal(result.status, 'completed');
    assert.equal(calls, 1);
    assert.equal((await repository.listCosts({ actorUserId: user.userId, jobId: 'd_success' })).length, 1);
    await create('d_unknown');
    const unknown = createNativeDissectionWorker({ repository, phases: ['map'], getAccount: () => app.getAccount(user.userId),
      callStage: async () => ({ json: { overview: 'Result' }, usage: {} }) });
    await assert.rejects(unknown.execute({ actorUserId: user.userId, jobId: 'd_unknown', authToken: 'test' }));
    assert.equal((await repository.get({ actorUserId: user.userId, jobId: 'd_unknown' })).status, 'needs_review');
    assert.equal((await repository.listCosts({ actorUserId: user.userId, jobId: 'd_unknown' })).length, 0);
  } finally { await app.close(); await fs.rm(directory, { recursive: true, force: true }); }
});
