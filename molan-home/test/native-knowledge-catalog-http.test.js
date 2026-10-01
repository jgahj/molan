'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { getGenreCatalog } = require('../lib/genre/genre-registry');
const { listSupportedModels } = require('../lib/model/model-registry');
const { getStyleCatalog } = require('../lib/style/style-registry');
const { createNativeKnowledgeCatalogService } = require('../services/native-knowledge-catalog-service');

test('native registry catalog HTTP responses match the legacy knowledge routes', async t => {
  const service = createNativeKnowledgeCatalogService({
    json(res, status, value) {
      const body = JSON.stringify(value);
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(body)
      });
      res.end(body);
    }
  });
  const server = http.createServer((req, res) => {
    const handled = service.dispatch(req, res, new URL(req.url, 'http://localhost').pathname);
    if (!handled) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));

  const base = `http://127.0.0.1:${server.address().port}`;
  const contracts = [
    ['/api/genre-catalog?unused=1', { ok: true, catalog: getGenreCatalog() }],
    ['/api/model-capabilities', { ok: true, models: listSupportedModels() }],
    ['/api/style-catalog', { ok: true, catalog: getStyleCatalog() }]
  ];
  for (const [url, expected] of contracts) {
    const response = await fetch(base + url);
    assert.equal(response.status, 200, url);
    assert.match(response.headers.get('content-type') || '', /^application\/json; charset=utf-8$/i);
    assert.deepEqual(await response.json(), expected, url);
  }

  const unsupportedMethod = await fetch(base + '/api/genre-catalog', { method: 'POST' });
  assert.equal(unsupportedMethod.status, 404);
});
