'use strict';

/**
 * 供应商熔断器 (Provider Circuit Breaker)
 *
 * 状态定义：
 * - CLOSED: 正常通信。所有请求放行。
 * - OPEN: 连续/窗口故障率超标。所有下游请求快速失败，阻断对外部供应商的洪峰调用。
 * - HALF_OPEN: 经过冷却期 (resetTimeoutMs) 后，允许有限探测请求，验证供应商是否已恢复。
 */

const { GenerationError } = require('../generation/errors');

const CIRCUIT_STATES = Object.freeze({
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN'
});

const DEFAULT_OPTIONS = Object.freeze({
  failureThreshold: 5,        // 达到熔断的连续或窗口故障数
  resetTimeoutMs: 30000,      // 熔断后冷却时间 (30 秒)
  halfOpenMaxSuccesses: 2,    // 半开试探成功次数后恢复 CLOSED
  windowSizeMs: 60000         // 统计窗口 (60 秒)
});

/** 判断错误是否属于应该计入熔断的供应商/网络/超时故障。 */
function isBreakerTriggeringError(error) {
  if (!error) return false;
  const code = String(error.code || error.errorCode || '').trim();
  const status = Number(error.status || error.statusCode || error.httpStatus || 0);

  // 显式供应商故障码
  if (['MODEL_5XX', 'MODEL_TIMEOUT', 'PROVIDER_UNKNOWN', 'USAGE_UNKNOWN', 'STAGE_TIMEOUT', 'RUN_TIMEOUT'].includes(code)) {
    return true;
  }
  // 5xx 服务端错误或超时 504
  if (status >= 500 && status < 600) {
    return true;
  }
  // 底层网络错误
  const msg = String(error.message || '').toLowerCase();
  if (msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('econnreset') ||
      msg.includes('etimedout') || msg.includes('esockettimedout') || msg.includes('socket hang up') ||
      msg.includes('network error') || msg.includes('fetch failed')) {
    return true;
  }
  return false;
}

class CircuitBreaker {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.breakers = new Map();
  }

  _getBreakerState(key) {
    let state = this.breakers.get(key);
    if (!state) {
      state = {
        state: CIRCUIT_STATES.CLOSED,
        failures: [],
        consecutiveSuccesses: 0,
        lastFailureTime: 0,
        openedAt: 0
      };
      this.breakers.set(key, state);
    }
    return state;
  }

  /** 获取当前熔断器状态，并自动处理从 OPEN 冷却过渡到 HALF_OPEN。 */
  getState(key) {
    const breaker = this._getBreakerState(key);
    const now = Date.now();

    if (breaker.state === CIRCUIT_STATES.OPEN) {
      if (now - breaker.openedAt >= this.options.resetTimeoutMs) {
        breaker.state = CIRCUIT_STATES.HALF_OPEN;
        breaker.consecutiveSuccesses = 0;
      }
    }

    return {
      state: breaker.state,
      failureCount: breaker.failures.length,
      lastFailureTime: breaker.lastFailureTime,
      nextAttemptAllowedAt: breaker.state === CIRCUIT_STATES.OPEN
        ? breaker.openedAt + this.options.resetTimeoutMs
        : now
    };
  }

  /** 判断当前目标是否允许发起外部调用。 */
  canExecute(key) {
    const info = this.getState(key);
    return info.state !== CIRCUIT_STATES.OPEN;
  }

  /** 记录一次成功调用。 */
  recordSuccess(key) {
    const breaker = this._getBreakerState(key);
    if (breaker.state === CIRCUIT_STATES.HALF_OPEN) {
      breaker.consecutiveSuccesses += 1;
      if (breaker.consecutiveSuccesses >= this.options.halfOpenMaxSuccesses) {
        breaker.state = CIRCUIT_STATES.CLOSED;
        breaker.failures = [];
        breaker.consecutiveSuccesses = 0;
      }
    } else if (breaker.state === CIRCUIT_STATES.CLOSED) {
      // 成功时清理老旧的失败记录
      const now = Date.now();
      breaker.failures = breaker.failures.filter(t => now - t < this.options.windowSizeMs);
    }
  }

  /** 记录一次调用失败，判断是否应跳入 OPEN 状态。 */
  recordFailure(key, error) {
    if (!isBreakerTriggeringError(error)) {
      // 非系统/供应商故障（如 4xx 客户端格式无效）不触发熔断器
      return;
    }

    const breaker = this._getBreakerState(key);
    const now = Date.now();
    breaker.lastFailureTime = now;

    if (breaker.state === CIRCUIT_STATES.HALF_OPEN) {
      // 半开探测失败，立即重新进入 OPEN 状态并重新计时冷却
      breaker.state = CIRCUIT_STATES.OPEN;
      breaker.openedAt = now;
      breaker.consecutiveSuccesses = 0;
      return;
    }

    // 处于 CLOSED 状态：记录失败时间戳并清除超出窗口的条目
    breaker.failures.push(now);
    breaker.failures = breaker.failures.filter(t => now - t < this.options.windowSizeMs);

    if (breaker.failures.length >= this.options.failureThreshold) {
      breaker.state = CIRCUIT_STATES.OPEN;
      breaker.openedAt = now;
      breaker.consecutiveSuccesses = 0;
    }
  }

  /** 在熔断器保护下执行异步任务，快速失败并捕获统计结果。 */
  async execute(key, taskFn) {
    if (typeof taskFn !== 'function') {
      throw new TypeError('taskFn 必须为可执行函数');
    }

    const info = this.getState(key);
    if (info.state === CIRCUIT_STATES.OPEN) {
      const waitSeconds = Math.max(1, Math.ceil((info.nextAttemptAllowedAt - Date.now()) / 1000));
      throw new GenerationError(
        'CIRCUIT_BREAKER_OPEN',
        `供应商「${key}」熔断器处于开启保护状态，请在 ${waitSeconds} 秒后重试`,
        {
          status: 503,
          retryable: false,
          details: {
            provider: key,
            state: CIRCUIT_STATES.OPEN,
            nextAttemptAllowedAt: info.nextAttemptAllowedAt
          }
        }
      );
    }

    try {
      const result = await taskFn();
      this.recordSuccess(key);
      return result;
    } catch (error) {
      this.recordFailure(key, error);
      throw error;
    }
  }

  /** 重置特定熔断器。 */
  reset(key) {
    this.breakers.delete(key);
  }

  /** 清空所有熔断器状态。 */
  clearAll() {
    this.breakers.clear();
  }
}

// 导出一个默认的全局单例，同时允许实例化独立熔断器
const defaultCircuitBreaker = new CircuitBreaker();

module.exports = {
  CIRCUIT_STATES,
  CircuitBreaker,
  defaultCircuitBreaker,
  isBreakerTriggeringError
};
