'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCreationCoreJobHttpService } = require('../services/creation-core-job-http-service');

function fixture(repository) {
  const controller = new AbortController();
  const active = { id: 'cj_test', userId: 'owner', controller };
  const handlers = createCreationCoreJobHttpService({
    POSTGRES_MODE: true,
    creationCoreJobs: new Map([['cj_test', active]]),
    getAuthUser: request => request.auth,
    postgresActor: auth => auth.user.userId,
    postgresRepository: repository,
    json: (response, status, body) => Object.assign(response, { status, body }),
    postgresCreationCoreJobView: job => job,
    dbReady: () => { throw new Error('legacy database forbidden'); },
    getDatabase: () => { throw new Error('legacy database forbidden'); }
  });
  return { handlers, active, request: { auth: { user: { userId: 'owner' } } } };
}

test('PG core task GET ignores local active cache and reads authoritative visibility', async () => {
  const instance = fixture({ getJob: async () => null });
  const response = {};
  await instance.handlers.get(instance.request, response, 'cj_test');
  assert.equal(response.status, 404);
  assert.equal(instance.active.controller.signal.aborted, false);
});

test('PG core task cancellation commits before aborting the local controller', async () => {
  let active;
  const instance = fixture({
    getJob: async () => ({ id: 'cj_test', state: 'running', workspaceId: 'workspace', projectId: 'project' }),
    upsertJob: async input => {
      assert.equal(active.controller.signal.aborted, false);
      assert.equal(input.state, 'cancel_requested');
      return { state: 'cancel_requested' };
    }
  });
  active = instance.active;
  const response = {};
  await instance.handlers.cancel(instance.request, response, 'cj_test');
  assert.equal(response.status, 200);
  assert.equal(active.controller.signal.aborted, true);
});

test('failed PG core cancellation never aborts or acknowledges success', async () => {
  const outage = new Error('PG unavailable');
  const instance = fixture({
    getJob: async () => ({ id: 'cj_test', state: 'running' }),
    upsertJob: async () => { throw outage; }
  });
  const response = {};
  await assert.rejects(instance.handlers.cancel(instance.request, response, 'cj_test'), error => error === outage);
  assert.equal(instance.active.controller.signal.aborted, false);
  assert.deepEqual(response, {});
});

test('unknown provider state is not converted into cancelled or re-dispatched', async () => {
  const instance = fixture({
    getJob: async () => ({ id: 'cj_test', state: 'provider_unknown' }),
    upsertJob: async () => { throw new Error('terminal task must not be rewritten'); }
  });
  const response = {};
  await instance.handlers.cancel(instance.request, response, 'cj_test');
  assert.deepEqual(response, { status: 200, body: { ok: true, status: 'provider_unknown' } });
  assert.equal(instance.active.controller.signal.aborted, false);
});
