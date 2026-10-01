'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const routes = require('../lib/memory-routes');

test('JSON memory misses never enter SQL or legacy style dispatch', async () => {
  const db = new Proxy({}, { get() { throw new Error('Legacy database accessed'); } });
  const styleProfileStore = new Proxy({}, { get() { throw new Error('Legacy style dispatch accessed'); } });
  for (const pathname of ['/api/books/n_test/unsupported', '/api/runs/missing']) {
    let status;
    let body;
    const res = { writeHead(value) { status = value; }, end(value) { body = JSON.parse(value); } };
    const handled = await routes.dispatch({ method: 'GET', url: pathname }, res, pathname, db,
      async () => ({ user: { userId: 'actor' } }), { backend: 'json', styleProfileStore,
        memoryStore: { getRun: async () => { throw Object.assign(new Error('Missing'), { code: 'RUN_NOT_FOUND' }); } } });
    assert.equal(handled, true);
    assert.equal(status, 404);
    assert.equal(body.code, 'NATIVE_MEMORY_ROUTE_NOT_FOUND');
  }
});

test('JSON unknown memory routes still require authentication', async () => {
  let status;
  const res = { writeHead(value) { status = value; }, end() {} };
  assert.equal(await routes.dispatch({ method: 'GET', url: '/api/books/n_test/unsupported' }, res,
    '/api/books/n_test/unsupported', null, async () => null, { backend: 'json' }), true);
  assert.equal(status, 401);
});
