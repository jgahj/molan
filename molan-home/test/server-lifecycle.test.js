'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createServerLifecycleService } = require('../services/server-lifecycle-service');

function fixture(overrides = {}) {
  const calls = [];
  const runtime = new EventEmitter();
  runtime.env = {};
  runtime.exit = code => calls.push(['exit', code]);
  const server = new EventEmitter();
  server.listen = (port, host, callback) => {
    calls.push(['listen', port, host]);
    server.listening = true;
    callback();
  };
  server.address = () => ({ port: 12345 });
  server.close = callback => { calls.push('http-close'); server.listening = false; callback(); };
  const timer = { callback: null, cleared: false };
  const deps = {
    server, runtime, postgresMode: false, nativeJsonMode: true, port: 12345, host: '127.0.0.1', maxConnections: 64,
    initializeStorage: async () => { calls.push('initialize'); },
    preparePostgres: async () => { calls.push('pg-ready'); },
    prepareLocal: async () => { calls.push('local-ready'); },
    flushSessions: () => { calls.push('sessions'); },
    flushWrites: async () => { calls.push('writes'); },
    closeStorage: async () => { calls.push('storage-close'); },
    stopLocalWorkers: () => { calls.push('workers-stop'); },
    logger: { log() {}, warn() {}, error() {} },
    timers: { setTimeout(callback) { timer.callback = callback; return { unref() {} }; }, clearTimeout() { timer.cleared = true; } },
    ...overrides
  };
  return { calls, runtime, server, timer, lifecycle: createServerLifecycleService(deps) };
}

test('原生仓储完成恢复后才监听，重复关闭只执行一次', async () => {
  const f = fixture();
  await f.lifecycle.start();
  assert.deepEqual(f.calls.slice(0, 3), ['initialize', 'local-ready', ['listen', 12345, '127.0.0.1']]);
  await Promise.all([f.lifecycle.shutdown('test'), f.lifecycle.shutdown('again')]);
  assert.equal(f.calls.filter(call => call === 'storage-close').length, 1);
  assert.equal(f.timer.cleared, true);
  assert.equal(f.runtime.exitCode, undefined);
});

test('生产环境没有 PG 时拒绝初始化及监听', async () => {
  const f = fixture();
  f.runtime.env.NODE_ENV = 'production';
  await assert.rejects(f.lifecycle.start(), { code: 'PRODUCTION_POSTGRES_REQUIRED' });
  assert.deepEqual(f.calls, []);
});

test('PG 初始化失败不降级，关闭所有存储并保留失败退出状态', async () => {
  const f = fixture({ postgresMode: true, preparePostgres: async () => { throw new Error('connection refused'); } });
  await f.lifecycle.start();
  assert.equal(f.runtime.exitCode, 1);
  assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === 'listen'), false);
  assert.equal(f.calls.includes('local-ready'), false);
  assert.equal(f.calls.includes('storage-close'), true);
});

test('会话和写回失败仍释放仓储，退出保持非零', async () => {
  let closed = false;
  const f = fixture({
    flushSessions() { throw new Error('session EIO'); },
    flushWrites: async () => { throw new Error('pg flush EIO'); },
    closeStorage: async () => { closed = true; }
  });
  await f.lifecycle.start();
  await f.lifecycle.shutdown('test');
  assert.equal(closed, true);
  assert.equal(f.runtime.exitCode, 1);
});

test('关闭超时不会把尚未完成的持久化报告为成功', async () => {
  let finish;
  const f = fixture({ closeStorage: () => new Promise(resolve => { finish = resolve; }) });
  await f.lifecycle.start();
  const closing = f.lifecycle.shutdown('test');
  while (!finish) await Promise.resolve();
  f.timer.callback();
  assert.equal(f.runtime.exitCode, 1);
  assert.deepEqual(f.calls.at(-1), ['exit', 1]);
  finish();
  await closing;
});

test('初始化中收到退出信号，先等初始化结束再关闭且不监听', async () => {
  let finish;
  const f = fixture({ initializeStorage: () => new Promise(resolve => { finish = resolve; }) });
  const starting = f.lifecycle.start();
  f.runtime.emit('SIGTERM');
  assert.equal(f.calls.includes('storage-close'), false);
  finish();
  await starting;
  await f.lifecycle.shutdown('again');
  assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === 'listen'), false);
  assert.equal(f.calls.includes('storage-close'), true);
});
