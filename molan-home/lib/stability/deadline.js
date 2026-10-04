'use strict';

/**
 * 任务与阶段死线监视器 (Deadline & Stage Timeout Monitor)
 *
 * 核心保障：
 * - 全局运行死线：一次完整章节生成周期（规划、撰写、多轮审计、修订）总体上限为 8~10 分钟；
 * - 细分子阶段死线：每个子阶段拥有独立的超时限制，杜绝无限卡死在某一挂起阶段；
 * - 超时错误码：阶段超时抛出 STAGE_TIMEOUT (504)，全局超时抛出 RUN_TIMEOUT (504)。
 */

const { GenerationError } = require('../generation/errors');

const DEFAULT_TOTAL_TIMEOUT_MS = 10 * 60 * 1000; // 全局 10 分钟

const DEFAULT_STAGE_TIMEOUTS_MS = Object.freeze({
  context_compilation: 30 * 1000,
  scene_planning: 60 * 1000,
  writer: 5 * 60 * 1000,
  deterministic_audit: 45 * 1000,
  semantic_audit: 60 * 1000,
  quality_audit: 45 * 1000,
  revision: 2 * 60 * 1000
});

class DeadlineTracker {
  constructor(options = {}) {
    this.totalTimeoutMs = Number(options.totalTimeoutMs) || DEFAULT_TOTAL_TIMEOUT_MS;
    this.stageTimeouts = { ...DEFAULT_STAGE_TIMEOUTS_MS, ...(options.stageTimeouts || {}) };
    this.startedAt = Number(options.startedAt) || Date.now();
    this.overallDeadline = this.startedAt + this.totalTimeoutMs;
    this.currentStage = null;
    this.stageStartedAt = 0;
  }

  /** 获取全局剩余毫秒数。 */
  getRemainingTotalMs() {
    return Math.max(0, this.overallDeadline - Date.now());
  }

  /** 获取已执行毫秒数。 */
  getElapsedMs() {
    return Math.max(0, Date.now() - this.startedAt);
  }

  /** 校验是否已超出全局死线。超期时抛出 RUN_TIMEOUT。 */
  checkTotalDeadline() {
    const now = Date.now();
    if (now >= this.overallDeadline) {
      const elapsedSec = Math.round((now - this.startedAt) / 1000);
      throw new GenerationError(
        'RUN_TIMEOUT',
        `生成任务已执行 ${elapsedSec} 秒，超出全局死线 (${Math.round(this.totalTimeoutMs / 1000)} 秒)`,
        {
          status: 504,
          unknown: true,
          retryable: false,
          details: {
            startedAt: this.startedAt,
            elapsedMs: now - this.startedAt,
            totalTimeoutMs: this.totalTimeoutMs
          }
        }
      );
    }
  }

  /** 标记进入一个新阶段。 */
  startStage(stageName, customTimeoutMs) {
    this.checkTotalDeadline();
    this.currentStage = String(stageName);
    this.stageStartedAt = Date.now();
    this.currentStageTimeout = Number(customTimeoutMs) || this.stageTimeouts[stageName] || 60000;
  }

  /** 标记完成当前阶段。 */
  endStage(stageName) {
    if (this.currentStage === String(stageName)) {
      this.currentStage = null;
      this.stageStartedAt = 0;
    }
  }

  /** 校验当前正在执行的阶段是否超时。 */
  checkStageDeadline(stageName) {
    this.checkTotalDeadline();
    const name = String(stageName || this.currentStage || '');
    if (!name || this.stageStartedAt === 0) return;

    const timeout = this.stageTimeouts[name] || 60000;
    const now = Date.now();
    const elapsed = now - this.stageStartedAt;

    if (elapsed >= timeout) {
      throw new GenerationError(
        'STAGE_TIMEOUT',
        `阶段「${name}」已耗时 ${Math.round(elapsed / 1000)} 秒，超出阶段时限 (${Math.round(timeout / 1000)} 秒)`,
        {
          status: 504,
          unknown: true,
          retryable: false,
          details: {
            stage: name,
            elapsedMs: elapsed,
            timeoutMs: timeout
          }
        }
      );
    }
  }

  /** 在阶段与全局死线双重监控下执行 Promise。 */
  async withTimeout(stageName, taskFn, customTimeoutMs) {
    this.startStage(stageName, customTimeoutMs);
    const stageTimeout = this.currentStageTimeout;
    const remainingTotal = this.getRemainingTotalMs();
    // 取当前阶段限时与全局剩余时间的较小值
    const effectiveTimeout = Math.min(stageTimeout, remainingTotal);

    let timer = null;
    try {
      const raceResult = await Promise.race([
        Promise.resolve().then(taskFn),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            if (this.getRemainingTotalMs() <= 0) {
              reject(new GenerationError('RUN_TIMEOUT', `生成任务整体超时`, { status: 504, unknown: true }));
            } else {
              reject(new GenerationError('STAGE_TIMEOUT', `阶段「${stageName}」执行超时 (${Math.round(effectiveTimeout / 1000)} 秒)`, {
                status: 504,
                unknown: true,
                details: { stage: stageName, timeoutMs: effectiveTimeout }
              }));
            }
          }, effectiveTimeout);
        })
      ]);
      return raceResult;
    } finally {
      if (timer) clearTimeout(timer);
      this.endStage(stageName);
    }
  }
}

function createDeadlineTracker(options) {
  return new DeadlineTracker(options);
}

module.exports = {
  DeadlineTracker,
  createDeadlineTracker,
  DEFAULT_TOTAL_TIMEOUT_MS,
  DEFAULT_STAGE_TIMEOUTS_MS
};
