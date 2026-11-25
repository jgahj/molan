'use strict';

/**
 * 原子 JSON 落盘、高频统计节流异步刷盘与受控调试告警服务。
 *
 * 解决痛点：
 * 1. 彻底替代共享固定 `.tmp` 文件名的旧实现，采用 `${pid}.${ts}_${nonce}.tmp` 杜绝并发竞争互踩；
 * 2. 为 `token_usage.json`（622KB+）与 `correction-library/hits.json` 提供「内存即时可见 + unref 异步节流刷盘 + 进程退出同步兜底」，消除请求热路径整文件同步序列化阻塞；
 * 3. 提供受控 `debugWarn`（`MOLAN_DEBUG=1` 或 `MOLAN_LOG_SWALLOWED_ERRORS=1` 时输出结构化诊断），告别关键路径盲吞异常。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function isDebugEnabled(env = process.env) {
  return String(env && (env.MOLAN_DEBUG || env.MOLAN_LOG_SWALLOWED_ERRORS) || '') === '1';
}

function debugWarn(scope, message, error, env = process.env) {
  if (!isDebugEnabled(env)) return;
  const errText = error && (error.stack || error.message) ? String(error.message || error) : String(error || '');
  console.warn(`[molan:debug:${scope}] ${message}${errText ? ` :: ${errText}` : ''}`);
}

function uniqueTempPath(filePath) {
  const nonce = crypto.randomBytes(4).toString('hex');
  return `${filePath}.${process.pid}.${Date.now().toString(36)}_${nonce}.tmp`;
}

function writeJsonAtomicSync(filePath, data, options = {}) {
  const target = path.resolve(String(filePath));
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = uniqueTempPath(target);
  const payload = JSON.stringify(data, null, options.spaces ?? 2);
  const mode = options.mode ?? 0o600;
  let fd = null;
  try {
    fd = fs.openSync(tmp, 'w', mode);
    fs.writeFileSync(fd, payload, 'utf8');
    if (options.fsync === true) {
      try { fs.fsyncSync(fd); } catch (err) { debugWarn('json-io', 'fsyncSync skipped', err); }
    }
    fs.closeSync(fd);
    fd = null;
    try { fs.chmodSync(tmp, mode); } catch (_) {}
    fs.renameSync(tmp, target);
    try { fs.chmodSync(target, mode); } catch (_) {}
  } catch (err) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_) {}
    }
    try { fs.rmSync(tmp, { force: true }); } catch (_) {}
    throw err;
  }
}

async function writeJsonAtomicAsync(filePath, data, options = {}) {
  const target = path.resolve(String(filePath));
  const dir = path.dirname(target);
  await fs.promises.mkdir(dir, { recursive: true });
  const tmp = uniqueTempPath(target);
  const payload = JSON.stringify(data, null, options.spaces ?? 2);
  const mode = options.mode ?? 0o600;
  try {
    await fs.promises.writeFile(tmp, payload, { encoding: 'utf8', mode });
    await fs.promises.rename(tmp, target);
    try { await fs.promises.chmod(target, mode); } catch (_) {}
  } catch (err) {
    try { await fs.promises.rm(tmp, { force: true }); } catch (_) {}
    throw err;
  }
}

function createThrottledJsonStore(filePath, options = {}) {
  const target = path.resolve(String(filePath));
  const debounceMs = Math.max(50, Number(options.debounceMs) || 1200);
  const cloneFallback = () => structuredClone(options.fallback !== undefined ? options.fallback : []);

  let cache = undefined;
  let cachedMtimeMs = 0;
  let dirty = false;
  let timer = null;
  let writingPromise = null;
  let exitHookRegistered = false;

  function ensureExitHook() {
    if (exitHookRegistered) return;
    exitHookRegistered = true;
    process.once('exit', () => {
      if (dirty && cache !== undefined) {
        try {
          writeJsonAtomicSync(target, cache, { mode: options.mode ?? 0o600 });
          dirty = false;
        } catch (err) {
          debugWarn('throttled-json', `exit flush failed for ${target}`, err);
        }
      }
    });
  }

  function read() {
    if (dirty && cache !== undefined) {
      return cache;
    }
    try {
      const stat = fs.statSync(target);
      if (cache !== undefined && stat.mtimeMs === cachedMtimeMs) {
        return cache;
      }
      const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
      cache = parsed;
      cachedMtimeMs = stat.mtimeMs;
      return cache;
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        debugWarn('throttled-json', `read fallback triggered for ${target}`, err);
      }
      if (cache === undefined) cache = cloneFallback();
      return cache;
    }
  }

  async function flushAsync() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!dirty || cache === undefined) {
      if (writingPromise) await writingPromise;
      return false;
    }
    if (writingPromise) {
      await writingPromise;
      if (!dirty) return true;
    }
    const snapshot = cache;
    dirty = false;
    writingPromise = writeJsonAtomicAsync(target, snapshot, { mode: options.mode ?? 0o600 })
      .then(() => {
        try { cachedMtimeMs = fs.statSync(target).mtimeMs; } catch (_) {}
        return true;
      })
      .catch(err => {
        dirty = true;
        debugWarn('throttled-json', `async flush failed for ${target}`, err);
        return false;
      })
      .finally(() => {
        writingPromise = null;
      });
    return writingPromise;
  }

  function flushSync() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!dirty || cache === undefined) return false;
    dirty = false;
    writeJsonAtomicSync(target, cache, { mode: options.mode ?? 0o600 });
    try { cachedMtimeMs = fs.statSync(target).mtimeMs; } catch (_) {}
    return true;
  }

  function save(nextData, saveOptions = {}) {
    ensureExitHook();
    cache = nextData;
    dirty = true;
    if (saveOptions.sync === true) {
      flushSync();
      return;
    }
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void flushAsync();
    }, debounceMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  return {
    filePath: target,
    read,
    save,
    flushAsync,
    flushSync,
    isDirty: () => dirty
  };
}

module.exports = {
  isDebugEnabled,
  debugWarn,
  uniqueTempPath,
  writeJsonAtomicSync,
  writeJsonAtomicAsync,
  createThrottledJsonStore
};
