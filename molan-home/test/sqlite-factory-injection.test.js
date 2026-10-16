'use strict';

/**
 * 回归测试（2026-10-15 P0）：initDB 的 databaseFactory 注入接线。
 *
 * 背景：6d04c8b 将 databaseFactory 改为调用方注入后，require.main 启动分支
 * 从未注入，导致 SQLite 模式下 db 恒为 null——/api/health 报 db:"off"、
 * /api/novels 等云端写操作全部 503，且 initDB 静默 return false 无任何日志。
 * ECS 生产走 PostgreSQL 模式（initDB 提前返回）不受影响；本地/独立
 * SQLite 部署全部失效。本测试守住启动路径的工厂解析接线。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('P0 回归：独立启动路径必须注入 databaseFactory', () => {
  assert.match(
    server,
    /initDB\(\{ databaseFactory: resolveLocalDatabaseFactory\(\) \}\)/,
    'require.main 分支必须调用 initDB({ databaseFactory: resolveLocalDatabaseFactory() })'
  );
});

test('P0 回归：resolveLocalDatabaseFactory 优先原生 node:sqlite，回退纯 JS 引擎', () => {
  assert.match(server, /function resolveLocalDatabaseFactory\(\)/, '必须定义工厂解析函数');
  assert.match(server, /require\('node:sqlite'\)/, '必须优先尝试原生 node:sqlite');
  assert.match(server, /require\('\.\/lib\/pure-js-database'\)/, '必须回退纯 JS 引擎');
});

test('P0 回归：缺少工厂时必须显式报错而非静默失败', () => {
  assert.match(server, /未注入 databaseFactory，本地 SQLite 引擎未初始化/, '工厂缺失时必须打错误日志');
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
