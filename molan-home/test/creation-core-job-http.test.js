'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCreationCoreJobHttpService } = require('../services/creation-core-job-http-service');

test('core job HTTP preserves memory cancellation and PG authoritative fencing fields', async () => {
  const jobs = new Map();
  let response; let aborted = false; let updated;
  const service = createCreationCoreJobHttpService({ POSTGRES_MODE: true, creationCoreJobs: jobs,
    getAuthUser: req => ({ user: { userId: req.actor, email: `${req.actor}@test` } }),
    json: (_res, status, body) => { response = { status, body }; }, dbReady: () => false,
    projectScope: { stableUserId: value => value }, postgresActor: auth => auth.user.userId,
    creationCoreJobPublic: value => value, creationCoreJobFromDbRow: value => value,
    postgresCreationCoreJobView: value => value, persistCreationCoreJob: () => { throw new Error('PG cancellation must not write the legacy job projection'); },
    postgresRepository: { getJob: async (actor, id) => actor === 'owner' ? { id, state: 'claimed', workspaceId: 'w', projectId: 'p', attemptNo: 3, fencingToken: 7, inputHash: 'hash', result: {} } : null,
      upsertJob: async value => { updated = value; return { state: 'cancel_requested' }; } } });
  jobs.set('memory', { id: 'memory', userId: 'owner', status: 'running', controller: { abort: () => { aborted = true; } } });
  await service.cancel({ actor: 'other' }, {}, 'memory');
  assert.equal(response.status, 404);
  assert.equal(aborted, false);
  await service.cancel({ actor: 'owner' }, {}, 'memory');
  assert.equal(response.body.status, 'cancelling');
  assert.equal(aborted, true);
  assert.equal(jobs.get('memory').status, 'cancelling');
  assert.equal(updated.state, 'cancel_requested');
  await service.cancel({ actor: 'owner' }, {}, 'persisted');
  assert.equal(response.body.status, 'cancelling');
  assert.equal(updated.userId, 'owner');
  assert.equal(updated.projectId, 'p');
  assert.equal(updated.attemptNo, 3);
  assert.equal(updated.fencingToken, 7);
  await service.get({ actor: 'other' }, {}, 'persisted');
  assert.equal(response.status, 404);
});
