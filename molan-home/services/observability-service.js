'use strict';

/**
 * observability-service.js — 轻量可观测性服务
 *
 * 背景（2026-10-14 优化）：服务端此前仅有零散 console.error，无结构化日志、
 * 无指标端点、无前端错误回收通道——线上问题"看不见、查不到、聚不了"。
 * 本服务提供三件套（零外部依赖）：
 *   1. logEvent(level, event, fields)：结构化 JSON 日志行（stdout，便于采集）；
 *   2. 进程指标计数器：请求数 / 5xx 数 / 认证失败数 / 未捕获异常数；
 *   3. 客户端错误回收：环形缓冲（最近 100 条，按 IP 限流 10 条/分钟），
 *      供 /api/metrics（管理员）与排障使用。
 */

const MAX_CLIENT_ERRORS = 100;
const CLIENT_ERROR_RATE = { windowMs: 60 * 1000, max: 10 };

function createObservabilityService({ now = Date.now } = {}) {
  const counters = {
    startedAt: now(),
    requests: 0,
    serverErrors: 0,
    authFailures: 0,
    clientErrors: 0,
    clientErrorsDropped: 0
  };
  const clientErrors = [];
  const rateBuckets = new Map();

  /** 结构化日志：单行 JSON，级别 + 事件 + 上下文字段 */
  function logEvent(level, event, fields = {}) {
    const line = JSON.stringify({
      ts: new Date(now()).toISOString(),
      level: String(level || 'info'),
      event: String(event || 'unspecified'),
      ...fields
    });
    if (level === 'error' || level === 'warn') console.error(line);
    else console.log(line);
    return line;
  }

  function countRequest() { counters.requests += 1; }
  function countServerError() { counters.serverErrors += 1; }
  function countAuthFailure() { counters.authFailures += 1; }

  /**
   * 记录一条客户端错误（前端 window.onerror / unhandledrejection 上报）。
   * 限流：每 IP 每分钟最多 10 条；缓冲满时丢弃最旧。
   */
  function recordClientError(ip, payload = {}) {
    const currentTime = now();
    const key = String(ip || 'unknown');
    const bucket = rateBuckets.get(key);
    if (!bucket || currentTime - bucket.startedAt >= CLIENT_ERROR_RATE.windowMs) {
      rateBuckets.set(key, { startedAt: currentTime, count: 1 });
    } else if (bucket.count >= CLIENT_ERROR_RATE.max) {
      counters.clientErrorsDropped += 1;
      return { accepted: false, reason: 'rate_limited' };
    } else {
      bucket.count += 1;
    }
    const entry = {
      at: new Date(currentTime).toISOString(),
      ip: key,
      type: String(payload.type || 'error').slice(0, 40),
      message: String(payload.message || '').slice(0, 500),
      source: String(payload.source || '').slice(0, 300),
      line: Number(payload.line) || null,
      href: String(payload.href || '').slice(0, 300)
    };
    clientErrors.push(entry);
    while (clientErrors.length > MAX_CLIENT_ERRORS) clientErrors.shift();
    counters.clientErrors += 1;
    return { accepted: true };
  }

  function getMetrics() {
    return {
      ...counters,
      uptimeSeconds: Math.round((now() - counters.startedAt) / 1000),
      memory: process.memoryUsage ? {
        rss: process.memoryUsage().rss,
        heapUsed: process.memoryUsage().heapUsed
      } : null,
      clientErrorBuffer: clientErrors.length,
      recentClientErrors: clientErrors.slice(-10)
    };
  }

  /** 仅供测试：清理限流桶 */
  function resetRateBuckets() { rateBuckets.clear(); }

  return {
    logEvent,
    countRequest,
    countServerError,
    countAuthFailure,
    recordClientError,
    getMetrics,
    resetRateBuckets
  };
}

module.exports = { createObservabilityService };
