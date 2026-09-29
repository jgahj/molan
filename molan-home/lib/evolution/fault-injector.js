'use strict';

const { GenerationError } = require('../generation/errors');

/**
 * 支持的标准故障注入类型
 */
const FAULT_TYPES = Object.freeze([
  'MODEL_TIMEOUT',
  'MODEL_429',
  'MODEL_5XX',
  'MODEL_EMPTY',
  'MODEL_CORRUPTED_JSON',
  'MODEL_TRUNCATED',
  'SQLITE_BUSY',
  'CONTEXT_OVERFLOW',
  'AUDIT_REJECTED'
]);

class FaultInjector {
  constructor(options = {}) {
    this.rules = [];
    this.injectedCounts = new Map();
    this.history = [];
    if (Array.isArray(options.rules)) {
      for (const rule of options.rules) {
        this.addRule(rule);
      }
    }
  }

  addRule(rule = {}) {
    const fault = String(rule.fault || '').trim().toUpperCase();
    if (!FAULT_TYPES.includes(fault)) {
      throw new TypeError(`不支持的故障类型: ${fault}`);
    }
    this.rules.push({
      fault,
      matcher: rule.matcher || (() => true),
      matchStage: rule.matchStage || null,
      matchChapter: rule.matchChapter || null,
      maxInjections: Number.isInteger(rule.maxInjections) ? rule.maxInjections : 1,
      injected: 0,
      customError: rule.customError || null,
      delayMs: Number(rule.delayMs) || 0
    });
    return this;
  }

  _shouldInject(rule, context = {}) {
    if (rule.injected >= rule.maxInjections) return false;
    if (rule.matchStage && context.stage && rule.matchStage !== context.stage) return false;
    if (rule.matchChapter !== null && context.chapterIndex !== undefined && rule.matchChapter !== context.chapterIndex) return false;
    if (typeof rule.matcher === 'function' && !rule.matcher(context)) return false;
    return true;
  }

  async _triggerFault(rule, context = {}) {
    rule.injected += 1;
    const count = (this.injectedCounts.get(rule.fault) || 0) + 1;
    this.injectedCounts.set(rule.fault, count);
    this.history.push({
      fault: rule.fault,
      context,
      timestamp: Date.now()
    });

    if (rule.delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, rule.delayMs));
    }

    if (rule.customError) {
      throw rule.customError;
    }

    switch (rule.fault) {
      case 'MODEL_TIMEOUT': {
        const err = new Error('模型请求超时 (ETIMEDOUT)');
        err.code = 'MODEL_TIMEOUT';
        err.status = 504;
        err.retryable = false;
        err.unknown = true;
        throw err;
      }
      case 'MODEL_429': {
        const err = new Error('模型服务限流 (429 Too Many Requests)');
        err.code = 'MODEL_429';
        err.status = 429;
        err.retryable = true;
        err.retryAfterMs = 1000;
        throw err;
      }
      case 'MODEL_5XX': {
        const err = new Error('模型供应商内部错误 (503 Service Unavailable)');
        err.code = 'MODEL_5XX';
        err.status = 503;
        err.retryable = true;
        throw err;
      }
      case 'MODEL_EMPTY': {
        return { text: '', content: '', usage: { totalTokens: 0, creditCost: 0 } };
      }
      case 'MODEL_CORRUPTED_JSON': {
        return { text: '{ "error_injected": true, "broken_json": ', content: '{ "error_injected": true, ' };
      }
      case 'MODEL_TRUNCATED': {
        return { text: '夜色深沉，剑锋未出鞘，寒意却已—', isTruncated: true };
      }
      case 'SQLITE_BUSY': {
        const err = new Error('database is locked');
        err.code = 'SQLITE_BUSY';
        err.retryable = true;
        throw err;
      }
      case 'CONTEXT_OVERFLOW': {
        const err = new Error('上下文超出最大预算限制 (hardLimit exceeded)');
        err.code = 'CONTEXT_OVERFLOW';
        err.status = 413;
        err.retryable = false;
        throw err;
      }
      case 'AUDIT_REJECTED': {
        return {
          passed: false,
          status: 'failed',
          score: 35,
          evidence_ref: 'audit:rejected:fault-injection',
          issues: [{ code: 'R-05-formulaic-metaphor', problem: '出现严重模版比喻', fix: '去除陈词滥调' }]
        };
      }
      default:
        throw new Error(`未知注入故障: ${rule.fault}`);
    }
  }

  /**
   * 包装模型/生成器调用以注入故障（自适应不同参数签名）
   */
  wrapModelCaller(originalCaller) {
    return async (...args) => {
      const first = args[0] || {};
      const second = args[1] || {};
      const input = typeof first.chapterIndex !== 'undefined' ? first : second;
      const context = {
        type: 'model',
        stage: input.stage || 'writer',
        chapterIndex: input.chapterIndex,
        input,
        args
      };
      for (const rule of this.rules) {
        if (this._shouldInject(rule, context)) {
          const result = await this._triggerFault(rule, context);
          if (result !== undefined) return result;
        }
      }
      return await originalCaller(...args);
    };
  }

  /**
   * 包装存储层以注入锁与持久化故障
   */
  wrapStore(originalStore) {
    return {
      ...originalStore,
      load: async (taskId) => {
        const context = { type: 'store', op: 'load', taskId };
        for (const rule of this.rules) {
          if (this._shouldInject(rule, context)) {
            await this._triggerFault(rule, context);
          }
        }
        return await originalStore.load(taskId);
      },
      save: async (taskId, state, meta) => {
        const context = { type: 'store', op: 'save', taskId, meta };
        for (const rule of this.rules) {
          if (this._shouldInject(rule, context)) {
            await this._triggerFault(rule, context);
          }
        }
        return await originalStore.save(taskId, state, meta);
      },
      withLease: async (taskId, work) => {
        const context = { type: 'store', op: 'withLease', taskId };
        for (const rule of this.rules) {
          if (this._shouldInject(rule, context)) {
            await this._triggerFault(rule, context);
          }
        }
        return await originalStore.withLease(taskId, work);
      }
    };
  }

  /**
   * 包装审计门禁以注入质检拒绝故障
   */
  wrapAuditor(originalAuditor) {
    return async (input) => {
      const context = {
        type: 'audit',
        chapterIndex: input.chapterIndex,
        input
      };
      for (const rule of this.rules) {
        if (this._shouldInject(rule, context)) {
          const result = await this._triggerFault(rule, context);
          if (result !== undefined) return result;
        }
      }
      return await originalAuditor(input);
    };
  }

  getInjectedCount(faultType) {
    return this.injectedCounts.get(faultType) || 0;
  }

  getTotalInjections() {
    let total = 0;
    for (const count of this.injectedCounts.values()) total += count;
    return total;
  }

  reset() {
    this.rules = [];
    this.injectedCounts.clear();
    this.history = [];
  }
}

function createFaultInjector(options = {}) {
  return new FaultInjector(options);
}

module.exports = {
  FaultInjector,
  createFaultInjector,
  FAULT_TYPES
};
