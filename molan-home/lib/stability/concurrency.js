'use strict';

/**
 * 项目级并发锁管理器 (Project Concurrency Lock Manager)
 *
 * 核心规范：
 * - 单项目单运行锁：同一项目下，同一时间至多允许 1 个活跃的生成任务 (Generation Run)；
 * - 单项目单修订锁：同一项目下，同一时间至多允许 1 个活跃的局部修订 (Local Revision)；
 * - 租期与超时回收 (TTL)：默认 10 分钟自动过期，杜绝异常退出导致的死锁；
 * - 冲突错误码：发生并发竞争时统一抛出 CONCURRENCY_LOCKED (409 Conflict)，客户端可带退避重试。
 */

const { GenerationError } = require('../generation/errors');

const DEFAULT_RUN_LOCK_TTL_MS = 10 * 60 * 1000;       // 生成任务锁默认 10 分钟
const DEFAULT_REVISION_LOCK_TTL_MS = 5 * 60 * 1000;    // 修订锁默认 5 分钟

class ConcurrencyManager {
  constructor() {
    this.runLocks = new Map();       // projectId -> { runId, acquiredAt, expiresAt }
    this.revisionLocks = new Map();  // projectId -> { revisionId, acquiredAt, expiresAt }
  }

  /** 获取项目的生成任务并发锁。 */
  acquireRunLock(projectId, runId, options = {}) {
    const pId = String(projectId || '').trim();
    const rId = String(runId || '').trim();
    if (!pId || !rId) {
      throw new TypeError('acquireRunLock 需要有效的 projectId 和 runId');
    }

    const ttlMs = Number(options.ttlMs) || DEFAULT_RUN_LOCK_TTL_MS;
    const now = Date.now();
    const existing = this.runLocks.get(pId);

    // 检查是否已有活跃锁且未过期
    if (existing && existing.expiresAt > now) {
      if (existing.runId === rId) {
        // 同一任务续期
        existing.expiresAt = now + ttlMs;
        return { acquired: true, runId: rId, renewed: true, expiresAt: existing.expiresAt };
      }

      const remainingSec = Math.max(1, Math.ceil((existing.expiresAt - now) / 1000));
      if (options.throwOnConflict !== false) {
        throw new GenerationError(
          'CONCURRENCY_LOCKED',
          `项目「${pId}」当前有正在进行的生成任务「${existing.runId}」，锁将在 ${remainingSec} 秒后过期`,
          {
            status: 409,
            retryable: true,
            details: {
              projectId: pId,
              activeRunId: existing.runId,
              requestedRunId: rId,
              remainingSeconds: remainingSec
            }
          }
        );
      }
      return { acquired: false, activeRunId: existing.runId, remainingSeconds: remainingSec };
    }

    // 赋予新锁或接管已过期锁
    const newLock = {
      runId: rId,
      acquiredAt: now,
      expiresAt: now + ttlMs
    };
    this.runLocks.set(pId, newLock);
    return { acquired: true, runId: rId, renewed: false, expiresAt: newLock.expiresAt };
  }

  /** 释放项目的生成任务并发锁。仅锁持有者有权主动释放。 */
  releaseRunLock(projectId, runId) {
    const pId = String(projectId || '').trim();
    const rId = String(runId || '').trim();
    const existing = this.runLocks.get(pId);

    if (existing) {
      if (!rId || existing.runId === rId || existing.expiresAt <= Date.now()) {
        this.runLocks.delete(pId);
        return true;
      }
      return false; // 非锁持有者不能释放活跃锁
    }
    return true;
  }

  /** 获取项目的修订任务并发锁。 */
  acquireRevisionLock(projectId, revisionId, options = {}) {
    const pId = String(projectId || '').trim();
    const revId = String(revisionId || '').trim();
    if (!pId || !revId) {
      throw new TypeError('acquireRevisionLock 需要有效的 projectId 和 revisionId');
    }

    const ttlMs = Number(options.ttlMs) || DEFAULT_REVISION_LOCK_TTL_MS;
    const now = Date.now();
    const existing = this.revisionLocks.get(pId);

    if (existing && existing.expiresAt > now) {
      if (existing.revisionId === revId) {
        existing.expiresAt = now + ttlMs;
        return { acquired: true, revisionId: revId, renewed: true, expiresAt: existing.expiresAt };
      }

      const remainingSec = Math.max(1, Math.ceil((existing.expiresAt - now) / 1000));
      if (options.throwOnConflict !== false) {
        throw new GenerationError(
          'CONCURRENCY_LOCKED',
          `项目「${pId}」当前有正在进行的局部修订「${existing.revisionId}」，锁将在 ${remainingSec} 秒后过期`,
          {
            status: 409,
            retryable: true,
            details: {
              projectId: pId,
              activeRevisionId: existing.revisionId,
              requestedRevisionId: revId,
              remainingSeconds: remainingSec
            }
          }
        );
      }
      return { acquired: false, activeRevisionId: existing.revisionId, remainingSeconds: remainingSec };
    }

    const newLock = {
      revisionId: revId,
      acquiredAt: now,
      expiresAt: now + ttlMs
    };
    this.revisionLocks.set(pId, newLock);
    return { acquired: true, revisionId: revId, renewed: false, expiresAt: newLock.expiresAt };
  }

  /** 释放项目的修订任务并发锁。 */
  releaseRevisionLock(projectId, revisionId) {
    const pId = String(projectId || '').trim();
    const revId = String(revisionId || '').trim();
    const existing = this.revisionLocks.get(pId);

    if (existing) {
      if (!revId || existing.revisionId === revId || existing.expiresAt <= Date.now()) {
        this.revisionLocks.delete(pId);
        return true;
      }
      return false;
    }
    return true;
  }

  /** 查询项目的锁状态。 */
  getLockStatus(projectId) {
    const pId = String(projectId || '').trim();
    const now = Date.now();
    const runLock = this.runLocks.get(pId);
    const revLock = this.revisionLocks.get(pId);

    return {
      projectId: pId,
      runLock: runLock && runLock.expiresAt > now ? { ...runLock } : null,
      revisionLock: revLock && revLock.expiresAt > now ? { ...revLock } : null,
      isBusy: Boolean((runLock && runLock.expiresAt > now) || (revLock && revLock.expiresAt > now))
    };
  }

  /** 清除指定项目的所有锁。 */
  clearProjectLocks(projectId) {
    const pId = String(projectId || '').trim();
    this.runLocks.delete(pId);
    this.revisionLocks.delete(pId);
  }

  /** 清空所有锁（供测试重置）。 */
  clearAllLocks() {
    this.runLocks.clear();
    this.revisionLocks.clear();
  }
}

// 导出一个默认单例
const defaultConcurrencyManager = new ConcurrencyManager();

module.exports = {
  ConcurrencyManager,
  defaultConcurrencyManager,
  DEFAULT_RUN_LOCK_TTL_MS,
  DEFAULT_REVISION_LOCK_TTL_MS
};
