'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPostgresCreationHttpService } = require('../services/postgres-creation-http-service');

function service(repository) {
  const forbidden = () => { throw new Error('legacy storage must not be called'); };
  return createPostgresCreationHttpService({
    getAuthUser: () => ({ user: { userId: 'actor' } }),
    postgresActor: auth => auth.user.userId,
    json: (response, status, body) => Object.assign(response, { status, body }),
    readBody: async () => ({}),
    postgresRepository: repository,
    handleCreationBooksList: forbidden,
    handleCreationBookBibleGet: forbidden,
    handleCreationBookBiblePut: forbidden,
    handleCreationBookState: forbidden,
    handleCreationBookChapterAudit: forbidden,
    handleCreationBookChapterContract: forbidden,
    handleCreationBookCommit: forbidden
  });
}

test('empty PostgreSQL creation list is authoritative', async () => {
  const response = {};
  await service({ listCreationBooks: async () => [] }).handlePostgresCreationBooksList({}, response);
  assert.deepEqual(response, { status: 200, body: { ok: true, books: [] } });
});

test('missing or inaccessible PostgreSQL creation book never invokes legacy storage', async () => {
  const handlers = [
    'handlePostgresCreationBookBibleGet', 'handlePostgresCreationBookBiblePut',
    'handlePostgresCreationBookState', 'handlePostgresCreationBookAudit',
    'handlePostgresCreationBookChapterContract', 'handlePostgresCreationBookCommit'
  ];
  const instance = service({ getCreationBible: async () => null, getCreationState: async () => null });
  for (const handler of handlers) {
    const response = {};
    await instance[handler]({ url: '/api/creation-books/cb_missing' }, response, 'cb_missing');
    assert.equal(response.status, 404, handler);
  }
});

test('PostgreSQL creation errors propagate without an empty or legacy success', async () => {
  const outage = Object.assign(new Error('database unavailable'), { code: 'pg_unavailable' });
  const response = {};
  await assert.rejects(service({ listCreationBooks: async () => { throw outage; } })
    .handlePostgresCreationBooksList({}, response), error => error === outage);
  assert.deepEqual(response, {});
});
