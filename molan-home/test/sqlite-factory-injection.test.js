'use strict';

/**
 * 锚点测试（2026-10-16 PG-only 收敛后反转）：
 *
 * 原为 2026-10-15 P0 回归测试，守护 initDB 的 databaseFactory 注入接线
 * （resolveLocalDatabaseFactory 优先原生 node:sqlite、回退纯 JS 引擎、
 * 工厂缺失显式报错）。按 PG-only 收敛决策（docs/postgres-only-checkpoint-20261002.md），
 * 本地 SQLite 引导已整体拔除：initDB 为 no-op，存储就绪由 initializePostgresRuntime 负责；
 * 生产环境缺少 PG 配置时由 server-lifecycle-service 抛 PRODUCTION_POSTGRES_REQUIRED 拒绝启动
 * （该安全语义由 test/server-lifecycle.test.js 守护）。
 *
 * 本测试的锚点随之反转：由"守住接线存在"变为"守住接线已拔除"，防止遗留代码回潮。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('PG-only 收敛：本地 SQLite 工厂接线已拔除', () => {
  assert.doesNotMatch(server, /resolveLocalDatabaseFactory/, '工厂解析函数不得回潮');
  assert.doesNotMatch(server, /initDB\(\{ databaseFactory/, 'databaseFactory 注入调用不得回潮');
  assert.doesNotMatch(server, /未注入 databaseFactory/, '工厂缺失报错日志不得回潮');
  assert.doesNotMatch(server, /require\('\.\/lib\/pure-js-database'\)/, '纯 JS 引擎 require 不得回潮');
  assert.doesNotMatch(server, /require\('node:sqlite'\)/, '原生 node:sqlite require 不得回潮');
  assert.match(server, /function initDB\(options = \{\}\) \{\s*\n\s*\/\/ PG-only 收敛[\s\S]*?return true;/, 'initDB 必须保持 PG-only no-op 形态');
});

test('行为验证：node:sqlite 可用时工厂契约可建库可读写', () => {
  let DatabaseSync = null;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch (_) {
    return test.skip('node:sqlite 在当前运行时不可用，跳过');
  }
  if (typeof DatabaseSync !== 'function') return test.skip('node:sqlite 在当前运行时不可用，跳过');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE factory_probe (a INTEGER)');
    db.prepare('INSERT INTO factory_probe (a) VALUES (?)').run(1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM factory_probe').get().n, 1);
  } finally {
    db.close();
  }
});
