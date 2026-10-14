'use strict';

/**
 * auth-attempt-limiter.js — 认证尝试限流器（IP 维度 + 失败升级退避）
 *
 * 背景与历史缺陷：
 *   1) 生产环境经 Nginx 反代（proxy_pass 127.0.0.1:3000），Node 侧
 *      req.socket.remoteAddress 恒为反代地址，"按 IP 限流"退化为全局限流——
 *      任一用户 10 分钟内登录满 20 次即全员 429。故必须解析
 *      X-Forwarded-For 还原真实客户端 IP。
 *   2) XFF 取最右（最后一条）条目：Nginx 的 $proxy_add_x_forwarded_for 会把
 *      真实客户端 IP 追加到客户端伪造串的末尾，取最右可防伪造轮换绕过；
 *      无 XFF 时回退 socket.remoteAddress。
 *   3) 原实现只按"尝试次数"计数且成功不清零：正常用户被共享 NAT 牵连，
 *      爆破者却可按固定节奏持续尝试。现改为失败计数升级——
 *      连续失败达到软阈值收紧额度，达到硬阈值直接阻断至窗口结束；
 *      登录成功立即清零失败计数。
 */

const DEFAULT_FAILURE_SOFT_LIMIT = 5;   // 连续失败达到该数：窗口额度收紧为 1/4
const DEFAULT_FAILURE_HARD_LIMIT = 10;  // 连续失败达到该数：窗口内直接阻断
const DEFAULT_MAX_ENTRIES = 20000;      // 记录条数上限，防止内存无限增长

function normalizeIp(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  // 去掉 IPv6 映射 IPv4 前缀（::ffff:1.2.3.4 -> 1.2.3.4）与方括号端口（[::1]:8080）
  let ip = raw.replace(/^\[(.+)\]:\d+$/, '$1').replace(/^::ffff:/i, '');
  // 裸 IPv4:port 形式
  const v4 = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (v4) ip = v4[1];
  return ip.slice(0, 64);
}

function isValidIp(ip) {
  if (!ip) return false;
  if (ip.includes(':')) return /^[0-9a-fA-F:]+(?:%\w+)?$/.test(ip);
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip);
}

/**
 * 解析客户端真实 IP：
 *  - 优先取 X-Forwarded-For 最右有效条目（受信反代写入的真实客户端）；
 *  - 无 XFF 时回退 req.socket.remoteAddress；
 *  - 都没有时返回 'unknown'（共享桶，宁紧勿松）。
 */
function resolveClientIp(req) {
  const headers = (req && req.headers) || {};
  const xff = headers['x-forwarded-for'] || headers['X-Forwarded-For'];
  if (typeof xff === 'string' && xff.trim()) {
    const parts = xff.split(',').map(normalizeIp).filter(isValidIp);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  const direct = normalizeIp(req && req.socket && req.socket.remoteAddress);
  return isValidIp(direct) ? direct : 'unknown';
}

function createAuthAttemptLimiter({
  windowMs = 10 * 60 * 1000,
  now = Date.now,
  failureSoftLimit = DEFAULT_FAILURE_SOFT_LIMIT,
  failureHardLimit = DEFAULT_FAILURE_HARD_LIMIT,
  maxEntries = DEFAULT_MAX_ENTRIES,
} = {}) {
  const attempts = new Map();
  const cleanupTimer = setInterval(() => {
    const currentTime = now();
    for (const [key, item] of attempts.entries()) {
      if (currentTime - item.startedAt >= windowMs * 2) attempts.delete(key);
    }
  }, windowMs);
  cleanupTimer.unref();

  function keyOf(req, scope) {
    return String(scope || 'default') + '|' + resolveClientIp(req);
  }

  function getRecord(key, currentTime) {
    let record = attempts.get(key);
    if (!record || currentTime - record.startedAt >= windowMs) {
      if (attempts.size >= maxEntries) {
        // 简易驱逐：先清已过期的，仍满则驱逐最早写入的一条
        for (const [k, item] of attempts.entries()) {
          if (currentTime - item.startedAt >= windowMs) attempts.delete(k);
        }
        if (attempts.size >= maxEntries) {
          const oldest = attempts.keys().next().value;
          if (oldest !== undefined) attempts.delete(oldest);
        }
      }
      record = { startedAt: currentTime, count: 0, failures: 0 };
      attempts.set(key, record);
    }
    return record;
  }

  /** 当前生效额度：失败达到软阈值后收紧为 1/4（至少 1），硬阈值直接 0 */
  function effectiveLimit(record, limit) {
    if (record.failures >= failureHardLimit) return 0;
    if (record.failures >= failureSoftLimit) return Math.max(1, Math.floor(limit / 4));
    return limit;
  }

  /**
   * 尝试准入（计入一次尝试）。
   * 返回是否放行；拒绝时可配合 retryAfterSeconds() 输出 Retry-After。
   */
  function allow(req, scope, limit) {
    const currentTime = now();
    const record = getRecord(keyOf(req, scope), currentTime);
    if (record.count >= effectiveLimit(record, limit)) return false;
    record.count += 1;
    return true;
  }

  /** 认证失败：累计失败计数（触发升级退避） */
  function recordFailure(req, scope) {
    const currentTime = now();
    const record = getRecord(keyOf(req, scope), currentTime);
    record.failures += 1;
    return record.failures;
  }

  /** 认证成功：清零失败计数与尝试计数，避免牵连后续正常登录 */
  function recordSuccess(req, scope) {
    const record = attempts.get(keyOf(req, scope));
    if (record) {
      record.failures = 0;
      record.count = 0;
    }
  }

  /** 距离窗口重置的秒数（供 Retry-After 头） */
  function retryAfterSeconds(req, scope) {
    const record = attempts.get(keyOf(req, scope));
    if (!record) return 0;
    const remain = windowMs - (now() - record.startedAt);
    return remain > 0 ? Math.ceil(remain / 1000) : 0;
  }

  /** 仅供测试/诊断：当前记录数 */
  function size() {
    return attempts.size;
  }

  return {
    allow,
    recordFailure,
    recordSuccess,
    retryAfterSeconds,
    resolveClientIp,
    size,
    close() { clearInterval(cleanupTimer); }
  };
}

module.exports = { createAuthAttemptLimiter, resolveClientIp, normalizeIp, isValidIp };
