'use strict';

/**
 * @file creation-book-pg-wiring.test.js
 * P0-2 防再发回归（2026-10-19 深度审查）：
 * 创书 6 个 PG handler（biblePut/planExpand/planReview/linkNovel/chapterContract/regenerateAsset）
 * 曾在 server.js 解构后漏注入 createCreationBookRoutes，生产（POSTGRES_MODE 恒真）下
 * 路由 fallthrough 到 legacy handler，db=null 必现 TypeError 500，且 mock 全量注入的
 * 路由契约测试无法发现。本测试从两个方向封死该类缺陷：
 *   1. 源码级：server.js 中任何 `handlePostgresCreation*` 解构符号不得只出现一次
 *      （出现一次 = 解构后从未使用 = 漏接线信号）；
 *   2. 装配级：production 形态（postgresMode=true）下，6 个端点必须路由到注入的
 *      postgres handler，而不是 legacy handler。
 */

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const { createCreationBookRoutes } = require('../routes/creation-books');

test('P0-2 防再发：handlePostgresCreation* 解构符号在 server.js 中不得只出现一次', () => {
  const identifiers = new Set(serverSource.match(/handlePostgresCreation[A-Za-z0-9]+/g) || []);
  assert.ok(identifiers.size >= 10, `应至少发现 10 个创书 PG handler 符号，实际 ${identifiers.size}`);
  const dangling = [];
  for (const name of identifiers) {
    const count = serverSource.split(name).length - 1;
    // 出现一次 = 仅解构未使用（漏接线特征）；≥2 = 解构 + 至少一处消费（注入/委托）
    if (count < 2) dangling.push(`${name}(${count})`);
  }
  assert.deepEqual(dangling, [], `以下 PG handler 解构后未接线（漏注入信号）: ${dangling.join(', ')}`);
});

test('P0-2 防再发：createCreationBookRoutes 注入表必须包含 6 个此前漏接的 postgres 键', () => {
  const requiredKeys = [
    'postgresBiblePut', 'postgresPlanExpand', 'postgresPlanReview',
    'postgresLinkNovel', 'postgresChapterContract', 'postgresRegenerateAsset'
  ];
  // 提取 createCreationBookRoutes({ ... }) 的注入字面量
  const start = serverSource.indexOf('createCreationBookRoutes({');
  assert.ok(start > 0, 'server.js 应存在 createCreationBookRoutes 装配点');
  const block = serverSource.slice(start, start + 1600);
  for (const key of requiredKeys) {
    assert.match(block, new RegExp(`${key}:\\s*handlePostgresCreation`), `注入表缺少 ${key}`);
  }
});

function makeRes() {
  return { statusCode: 0, headers: {}, body: null };
}

function buildProductionShapeHandlers() {
  // 模拟生产装配形态：每个端点同时提供 legacy 与 postgres handler，
  // postgres handler 记录调用轨迹（POSTGRES_MODE 恒真时必须走它）。
  const calls = [];
  const legacy = name => async () => { calls.push('legacy:' + name); };
  const pg = name => async () => { calls.push('pg:' + name); };
  return {
    calls,
    handlers: {
      respondError: () => {}, respondPostgresError: () => {},
      list: legacy('list'), postgresList: pg('list'),
      create: legacy('create'), postgresCreate: pg('create'),
      bibleGet: legacy('bibleGet'), postgresBibleGet: pg('bibleGet'),
      biblePut: legacy('biblePut'), postgresBiblePut: pg('biblePut'),
      planExpand: legacy('planExpand'), postgresPlanExpand: pg('planExpand'),
      planReview: legacy('planReview'), postgresPlanReview: pg('planReview'),
      linkNovel: legacy('linkNovel'), postgresLinkNovel: pg('linkNovel'),
      chapterContract: legacy('chapterContract'), postgresChapterContract: pg('chapterContract'),
      regenerateAsset: legacy('regenerateAsset'), postgresRegenerateAsset: pg('regenerateAsset')
    }
  };
}

const ROUTES = [
  ['PUT', '/api/creation-books/cb_1/bible', 'biblePut'],
  ['POST', '/api/creation-books/cb_1/plan-expand', 'planExpand'],
  ['POST', '/api/creation-books/cb_1/plan-review', 'planReview'],
  ['POST', '/api/creation-books/cb_1/link-novel', 'linkNovel'],
  ['POST', '/api/creation-books/cb_1/chapter-contract', 'chapterContract'],
  ['POST', '/api/creation-books/cb_1/regenerate-asset', 'regenerateAsset']
];

test('P0-2 装配级：postgresMode=true 时 6 个端点必须路由到 postgres handler', async () => {
  const { calls, handlers } = buildProductionShapeHandlers();
  const dispatch = createCreationBookRoutes({ postgresMode: true, handlers });
  for (const [method, url, handlerName] of ROUTES) {
    calls.length = 0;
    const handled = await dispatch({ method }, makeRes(), url);
    assert.equal(handled, true, `${method} ${url} 应被创书路由接管`);
    assert.deepEqual(calls, ['pg:' + handlerName], `${method} ${url} 必须走 postgres handler，实际: ${calls.join(',')}`);
  }
});
