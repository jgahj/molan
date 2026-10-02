'use strict';

const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PureJsDatabase } = require('../pure-js-database');

/** 创建带持久化正文、租约续期和 fencing token 的 Soak 内存/文件存储。 */
function createSqliteSoakStore(filePath, options = {}) {
  if (typeof filePath !== 'string' || !filePath.trim()) throw new TypeError('Soak SQLite 路径必填');
  const leaseMs = Math.max(1000, Number(options.leaseMs) || 30000);
  const renewMs = Math.min(leaseMs - 1, Math.max(250, Number(options.renewMs) || Math.floor(leaseMs / 3)));
  const acquireTimeoutMs = Math.max(0, Number(options.acquireTimeoutMs) || 0);
  const databasePath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new PureJsDatabase(databasePath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
  db.exec(`CREATE TABLE IF NOT EXISTS long_form_soak_runs (
    task_id TEXT PRIMARY KEY,
    state_json TEXT,
    lease_owner TEXT,
    lease_until INTEGER NOT NULL DEFAULT 0,
    fencing_token INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`);

  /** 读取指定长篇任务的最后一个持久化状态。 */
  async function load(taskId) {
    const row = db.prepare('SELECT state_json FROM long_form_soak_runs WHERE task_id = ?').get(String(taskId));
    return row && row.state_json ? JSON.parse(row.state_json) : null;
  }

  /** 仅允许当前未过期租约持有者按 fencing token 写入状态。 */
  async function save(taskId, state, lease = {}) {
    const serialized = JSON.stringify(state);
    if (typeof serialized !== 'string') throw new TypeError('Soak 状态必须是可序列化 JSON');
    const result = db.prepare(`UPDATE long_form_soak_runs SET state_json = ?, updated_at = ?
      WHERE task_id = ? AND lease_owner = ? AND fencing_token = ? AND lease_until > ?`)
      .run(serialized, Date.now(), String(taskId), String(lease.leaseOwner || ''), Number(lease.fencingToken), Date.now());
    if (Number(result.changes) !== 1) throw new Error('SOAK_LEASE_LOST');
  }

  /** 使用数据库租约串行运行同一任务，并在回调期间续约。 */
  async function withLease(taskId, work, leaseOptions = {}) {
    if (typeof work !== 'function') throw new TypeError('Soak lease callback 必须是函数');
    const key = String(taskId);
    const owner = randomUUID();
    const deadline = Date.now() + acquireTimeoutMs;
    let fencingToken;
    while (fencingToken == null) {
      if (leaseOptions.signal && leaseOptions.signal.aborted) throw abortError();
      const now = Date.now();
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare(`INSERT OR IGNORE INTO long_form_soak_runs (task_id, updated_at) VALUES (?, ?)`)
          .run(key, now);
        const row = db.prepare('SELECT lease_owner, lease_until, fencing_token FROM long_form_soak_runs WHERE task_id = ?').get(key);
        if (row.lease_owner && Number(row.lease_until) > now) {
          db.exec('ROLLBACK');
          if (now >= deadline) throw new Error('SOAK_LEASE_HELD');
          await delay(Math.min(100, Math.max(1, deadline - now)), leaseOptions.signal);
          continue;
        }
        fencingToken = Number(row.fencing_token) + 1;
        db.prepare(`UPDATE long_form_soak_runs SET lease_owner = ?, lease_until = ?, fencing_token = ?, updated_at = ? WHERE task_id = ?`)
          .run(owner, now + leaseMs, fencingToken, now, key);
        db.exec('COMMIT');
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch (_) {}
        throw error;
      }
    }

    const leaseAbort = new AbortController();
    const signals = [leaseAbort.signal, leaseOptions.signal].filter(Boolean);
    const signal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);
    let lost = false;
    const renewTimer = setInterval(() => {
      try {
        const result = db.prepare(`UPDATE long_form_soak_runs SET lease_until = ?, updated_at = ?
          WHERE task_id = ? AND lease_owner = ? AND fencing_token = ? AND lease_until > ?`)
          .run(Date.now() + leaseMs, Date.now(), key, owner, fencingToken, Date.now());
        if (Number(result.changes) === 1) return;
      } catch (_) {
        lost = true;
        leaseAbort.abort();
        return;
      }
      if (!lost) {
        lost = true;
        leaseAbort.abort();
      }
    }, renewMs);
    if (typeof renewTimer.unref === 'function') renewTimer.unref();
    try {
      const result = await work({ fencingToken: String(fencingToken), leaseOwner: owner, signal });
      if (lost) throw new Error('SOAK_LEASE_LOST');
      return result;
    } finally {
      clearInterval(renewTimer);
      db.prepare(`UPDATE long_form_soak_runs SET lease_owner = NULL, lease_until = 0, updated_at = ?
        WHERE task_id = ? AND lease_owner = ? AND fencing_token = ?`)
        .run(Date.now(), key, owner, fencingToken);
    }
  }

  /** 关闭当前 SQLite 连接。 */
  function close() {
    db.close();
  }

  return { load, save, withLease, close };
}

/** 等待租约释放，同时响应外部取消。 */
function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const finish = callback => value => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', cancel);
      callback(value);
    };
    const done = finish(resolve);
    const fail = finish(reject);
    const timer = setTimeout(done, milliseconds);
    if (!signal) return;
    const cancel = () => {
      fail(abortError());
    };
    signal.addEventListener('abort', cancel, { once: true });
  });
}

/** 生成统一的取消异常。 */
function abortError() {
  const error = new Error('Soak 任务已取消');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

module.exports = { createSqliteSoakStore };
