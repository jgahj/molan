'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { __test } = require('../server');

test('仅放行明确列出的客户端 WAL 和搜索静态资源', () => {
  for (const asset of [
    '/lib/client/local-wal.js',
    '/lib/client/search-index.js',
    '/lib/client/search-worker.js',
    '/lib/client/generation-runs.js'
  ]) assert.equal(__test.isPublicStaticPath(asset), true, asset);
  for (const asset of [
    '/lib/client/other.js',
    '/lib/generation/scene-patch.js',
    '/lib/postgres-repository.js',
    '/server.js'
  ]) assert.equal(__test.isPublicStaticPath(asset), false, asset);
});
