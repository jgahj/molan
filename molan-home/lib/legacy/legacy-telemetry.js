'use strict';

/**
 * @file legacy-telemetry.js
 * 历史废弃模块调用遥测器 (Legacy Usage Telemetry)
 *
 * 核心目标：
 * 1. 监控历史/废弃管线与过渡接口的调用来源、频次与调用时间；
 * 2. 避免粗暴删除旧接口引发老版本前端/脚本 404，提供平滑生命周期治理观测；
 * 3. 统计连续无调用周期（如 30 天无调用），作为物理移除的真实依据。
 */

class LegacyUsageTelemetry {
  constructor() {
    this._records = new Map();
  }

  /**
   * 记录一次历史组件调用
   * @param {string} moduleName 模块名或端点名
   * @param {Object} [details] 附加调用上下文（caller, method, path 等）
   * @returns {Object} 当前模块累计统计
   */
  record(moduleName, details = {}) {
    const key = String(moduleName || 'unknown_legacy_module');
    const now = Date.now();
    const existing = this._records.get(key) || {
      moduleName: key,
      callCount: 0,
      firstUsedAt: now,
      lastUsedAt: now,
      recentCalls: []
    };

    existing.callCount += 1;
    existing.lastUsedAt = now;
    if (details && typeof details === 'object') {
      existing.recentCalls.push({
        timestamp: now,
        ...details
      });
      if (existing.recentCalls.length > 20) {
        existing.recentCalls.shift();
      }
    }

    this._records.set(key, existing);
    return { ...existing };
  }

  /**
   * 获取指定模块或全量统计
   * @param {string} [moduleName]
   * @returns {Object|null}
   */
  getStats(moduleName) {
    if (moduleName) {
      const rec = this._records.get(String(moduleName));
      return rec ? { ...rec, recentCalls: [...rec.recentCalls] } : null;
    }
    const result = {};
    for (const [k, v] of this._records.entries()) {
      result[k] = { ...v, recentCalls: [...v.recentCalls] };
    }
    return result;
  }

  /**
   * 重置遥测记录（主要用于测试）
   */
  reset() {
    this._records.clear();
  }
}

const legacyUsageTelemetry = new LegacyUsageTelemetry();

module.exports = {
  legacyUsageTelemetry,
  LegacyUsageTelemetry
};
