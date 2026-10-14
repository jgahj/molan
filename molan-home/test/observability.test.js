'use strict';

/**
 * 可观测性专项测试：客户端错误回收（限流/缓冲）、指标形状、结构化日志、
 * 前端错误捕获挂载（静态断言）。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createObservabilityService } = require('../services/observability-service');

test('客户端错误：接收、入缓冲、计数', () => {
  const svc = createObservabilityService({ now: () => 1000 });
  const r1 = svc.recordClientError('1.2.3.4', { type: 'error', message: 'boom', source: 'app-boot.js', line: 10, href: '/#editor' });
  assert.equal(r1.accepted, true);
  const metrics = svc.getMetrics();
  assert.equal(metrics.clientErrors, 1);
  assert.equal(metrics.clientErrorBuffer, 1);
  assert.equal(metrics.recentClientErrors[0].message, 'boom');
  assert.equal(metrics.recentClientErrors[0].line, 10);
});

test('客户端错误：同 IP 超限流返回 429 语义', () => {
  let now = 0;
  const svc = createObservabilityService({ now: () => now });
  for (let i = 0; i < 10; i += 1) assert.equal(svc.recordClientError('9.9.9.9', { message: 'e' + i }).accepted, true);
  const blocked = svc.recordClientError('9.9.9.9', { message: 'over' });
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.reason, 'rate_limited');
  assert.equal(svc.getMetrics().clientErrorsDropped, 1);
  // 窗口过后恢复
  now += 61 * 1000;
  assert.equal(svc.recordClientError('9.9.9.9', { message: 'after-window' }).accepted, true);
});

test('客户端错误：环形缓冲上限 100，丢弃最旧', () => {
  let now = 0;
  const svc = createObservabilityService({ now: () => now });
  for (let i = 0; i < 105; i += 1) {
    svc.recordClientError(`10.0.0.${i % 250}`, { message: 'm' + i });
    now += 100; // 跨过限流窗口
  }
  const metrics = svc.getMetrics();
  assert.equal(metrics.clientErrorBuffer, 100);
  assert.equal(metrics.clientErrors, 105);
});

test('指标快照包含请求/错误/运行时长/内存', () => {
  const svc = createObservabilityService({ now: () => 1000 });
  svc.countRequest(); svc.countRequest(); svc.countServerError(); svc.countAuthFailure();
  const metrics = svc.getMetrics();
  assert.equal(metrics.requests, 2);
  assert.equal(metrics.serverErrors, 1);
  assert.equal(metrics.authFailures, 1);
  assert.equal(typeof metrics.uptimeSeconds, 'number');
  assert.ok(metrics.memory && typeof metrics.memory.rss === 'number');
});

test('结构化日志：单行 JSON，含 ts/level/event/字段', () => {
  const svc = createObservabilityService({ now: () => 1700000000000 });
  const originalError = console.error;
  let captured = '';
  console.error = line => { captured += line; };
  try {
    svc.logEvent('warn', 'client_error', { ip: '1.1.1.1', message: 'x' });
  } finally {
    console.error = originalError;
  }
  const parsed = JSON.parse(captured.trim());
  assert.equal(parsed.level, 'warn');
  assert.equal(parsed.event, 'client_error');
  assert.equal(parsed.ip, '1.1.1.1');
  assert.ok(parsed.ts);
});

test('前端挂载：app-boot.js 含 error/unhandledrejection 捕获与节流', () => {
  const boot = fs.readFileSync(path.join(__dirname, '..', 'app-boot.js'), 'utf8');
  assert.match(boot, /initClientErrorReporting/);
  assert.match(boot, /addEventListener\('error'/);
  assert.match(boot, /addEventListener\('unhandledrejection'/);
  assert.match(boot, /\/api\/client-errors/);
  assert.match(boot, /THROTTLE_MS = 5000/);
  assert.match(boot, /navigator\.sendBeacon/);
});

test('服务端接线：client-errors 与 metrics 端点存在且 metrics 限管理员', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /u === '\/api\/client-errors' && req\.method === 'POST'/);
  assert.match(server, /u === '\/api\/metrics' && req\.method === 'GET'/);
  assert.match(server, /仅管理员可查看运行指标/);
  assert.match(server, /observability\.countServerError\(\)/);
});
