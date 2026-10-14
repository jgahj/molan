'use strict';

/**
 * auth-attempt-limiter 专项测试
 * 覆盖：XFF 客户端 IP 还原（防伪造）、IP 归一化、作用域隔离、窗口重置、
 *       失败升级退避（软收紧/硬阻断）、成功清零、Retry-After、容量驱逐。
 */

const test = require('node:test');
const assert = require('node:assert');
const { createAuthAttemptLimiter, resolveClientIp, normalizeIp } = require('../services/auth-attempt-limiter');

function reqWith({ ip, xff } = {}) {
  const headers = {};
  if (xff !== undefined) headers['x-forwarded-for'] = xff;
  return { headers, socket: { remoteAddress: ip } };
}

test('XFF 取最右条目：Nginx 追加的真实客户端 IP 优先于伪造串', () => {
  const req = reqWith({ ip: '127.0.0.1', xff: '1.2.3.4, 10.0.0.9' });
  assert.equal(resolveClientIp(req), '10.0.0.9');
});

test('无 XFF 时回退 socket.remoteAddress', () => {
  const req = reqWith({ ip: '203.0.113.7' });
  assert.equal(resolveClientIp(req), '203.0.113.7');
});

test('XFF 全部非法时回退 remoteAddress；两者都缺时为 unknown', () => {
  assert.equal(resolveClientIp(reqWith({ ip: '198.51.100.2', xff: 'garbage, ???' })), '198.51.100.2');
  assert.equal(resolveClientIp({ headers: {}, socket: {} }), 'unknown');
});

test('IP 归一化：IPv6 映射 IPv4、方括号端口、IPv4:端口', () => {
  assert.equal(normalizeIp('::ffff:127.0.0.1'), '127.0.0.1');
  assert.equal(normalizeIp('[::1]:8080'), '::1');
  assert.equal(normalizeIp('10.1.2.3:5678'), '10.1.2.3');
  assert.equal(normalizeIp('2001:db8::1'), '2001:db8::1');
});

test('作用域相互隔离，窗口结束后计数重置', () => {
  let now = 1000;
  const limiter = createAuthAttemptLimiter({ windowMs: 100, now: () => now });
  try {
    const req = reqWith({ ip: '127.0.0.1' });
    assert.equal(limiter.allow(req, 'login', 2), true);
    assert.equal(limiter.allow(req, 'login', 2), true);
    assert.equal(limiter.allow(req, 'login', 2), false);
    assert.equal(limiter.allow(req, 'register', 1), true);
    now += 100;
    assert.equal(limiter.allow(req, 'login', 2), true);
  } finally {
    limiter.close();
  }
});

test('不同 XFF 客户端（经反代）落入不同桶，互不挤占', () => {
  let now = 5000;
  const limiter = createAuthAttemptLimiter({ windowMs: 1000, now: () => now });
  try {
    const a = reqWith({ ip: '127.0.0.1', xff: '1.1.1.1' });
    const b = reqWith({ ip: '127.0.0.1', xff: '2.2.2.2' });
    assert.equal(limiter.allow(a, 'login', 1), true);
    assert.equal(limiter.allow(a, 'login', 1), false);
    assert.equal(limiter.allow(b, 'login', 1), true);
  } finally {
    limiter.close();
  }
});

test('连续失败达到软阈值后额度收紧为 1/4', () => {
  let now = 0;
  const limiter = createAuthAttemptLimiter({ windowMs: 10000, now: () => now, failureSoftLimit: 5, failureHardLimit: 10 });
  try {
    const req = reqWith({ ip: '9.9.9.9' });
    for (let i = 0; i < 5; i += 1) limiter.recordFailure(req, 'login');
    // 收紧后额度 = max(1, floor(20/4)) = 5
    for (let i = 0; i < 5; i += 1) assert.equal(limiter.allow(req, 'login', 20), true);
    assert.equal(limiter.allow(req, 'login', 20), false);
  } finally {
    limiter.close();
  }
});

test('连续失败达到硬阈值后窗口内直接阻断', () => {
  let now = 0;
  const limiter = createAuthAttemptLimiter({ windowMs: 10000, now: () => now, failureSoftLimit: 5, failureHardLimit: 10 });
  try {
    const req = reqWith({ ip: '9.9.9.9' });
    for (let i = 0; i < 10; i += 1) limiter.recordFailure(req, 'login');
    assert.equal(limiter.allow(req, 'login', 20), false);
    // 硬阻断不受普通额度放宽影响
    now += 100;
    assert.equal(limiter.allow(req, 'login', 20), false);
  } finally {
    limiter.close();
  }
});

test('登录成功清零失败计数，后续恢复完整额度', () => {
  let now = 0;
  const limiter = createAuthAttemptLimiter({ windowMs: 10000, now: () => now, failureSoftLimit: 5, failureHardLimit: 10 });
  try {
    const req = reqWith({ ip: '9.9.9.9' });
    for (let i = 0; i < 5; i += 1) limiter.recordFailure(req, 'login');
    assert.equal(limiter.allow(req, 'login', 20), true);
    limiter.recordSuccess(req, 'login');
    // 清零后：失败计数归零、尝试计数归零 → 完整 20 次额度
    for (let i = 0; i < 20; i += 1) assert.equal(limiter.allow(req, 'login', 20), true);
    assert.equal(limiter.allow(req, 'login', 20), false);
  } finally {
    limiter.close();
  }
});

test('retryAfterSeconds 返回窗口剩余秒数', () => {
  let now = 0;
  const limiter = createAuthAttemptLimiter({ windowMs: 60000, now: () => now });
  try {
    const req = reqWith({ ip: '9.9.9.9' });
    assert.equal(limiter.retryAfterSeconds(req, 'login'), 0);
    limiter.allow(req, 'login', 1);
    limiter.allow(req, 'login', 1);
    now += 20000;
    assert.equal(limiter.retryAfterSeconds(req, 'login'), 40);
    now += 50000;
    assert.equal(limiter.retryAfterSeconds(req, 'login'), 0);
  } finally {
    limiter.close();
  }
});

test('超过 maxEntries 时驱逐最旧记录且不抛错', () => {
  let now = 0;
  const limiter = createAuthAttemptLimiter({ windowMs: 100000, now: () => now, maxEntries: 3 });
  try {
    for (let i = 1; i <= 6; i += 1) {
      limiter.allow(reqWith({ ip: `10.0.0.${i}` }), 'login', 5);
    }
    assert.ok(limiter.size() <= 3, `size=${limiter.size()}`);
  } finally {
    limiter.close();
  }
});

test('json 助手支持自定义响应头（Retry-After 透传）', () => {
  const { createHttpRequestService } = require('../services/http-request-service');
  const service = createHttpRequestService({
    MAX_JSON_BODY_BYTES: 1024 * 1024,
    responseCors: () => ({}),
    shouldFlushWrites: () => false,
    flushWrites: () => Promise.resolve()
  });
  let captured = null;
  const res = {
    headersSent: false, writableEnded: false, destroyed: false, req: { method: 'POST' },
    writeHead(status, headers) { captured = { status, headers }; },
    end() {}
  };
  service.json(res, 429, { error: '操作过于频繁，请稍后再试' }, { 'Retry-After': '137' });
  assert.equal(captured.status, 429);
  assert.equal(captured.headers['Retry-After'], '137');
  assert.equal(captured.headers['Content-Type'], 'application/json; charset=utf-8');
});
