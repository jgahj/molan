'use strict';

/**
 * 文风特征与画像缓存 (Style Profile Cache)
 *
 * 核心设计：
 * - 缓存键结构：`style_profile:${projectId}:${sourceHash}:v${analyzerVersion || 1}`
 * - 内存管理：LRU 淘汰 + TTL 超时机制；
 * - 统计监控：提供 hitCount, missCount, size, hitRate 指标。
 */

const crypto = require('node:crypto');

const DEFAULT_MAX_ENTRIES = 300;
const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000; // 默认 2 小时

class StyleProfileCache {
  constructor(options = {}) {
    this.maxEntries = Number(options.maxEntries) || DEFAULT_MAX_ENTRIES;
    this.defaultTtlMs = Number(options.defaultTtlMs) || DEFAULT_TTL_MS;
    this.map = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      evictions: 0
    };
  }

  /** 计算文风画像缓存的确定性键。 */
  computeKey(projectId, sourceHash = '', analyzerVersion = 1) {
    const p = String(projectId || '').trim() || 'default_project';
    const s = String(sourceHash || '').trim() || 'nohash';
    const v = String(analyzerVersion || '1').trim();
    return `style_profile:${p}:${s}:v${v}`;
  }

  /** 获取缓存画像。 */
  get(key) {
    const entry = this.map.get(key);
    if (!entry) {
      this.stats.misses += 1;
      return null;
    }

    const now = Date.now();
    if (entry.expiresAt && entry.expiresAt <= now) {
      this.map.delete(key);
      this.stats.misses += 1;
      return null;
    }

    entry.lastAccessed = now;
    this.map.delete(key);
    this.map.set(key, entry);

    this.stats.hits += 1;
    return entry.value;
  }

  /** 写入文风画像缓存。 */
  set(key, value, options = {}) {
    const now = Date.now();
    const ttlMs = Number(options.ttlMs) || this.defaultTtlMs;
    const expiresAt = ttlMs > 0 ? now + ttlMs : 0;

    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
        this.stats.evictions += 1;
      }
    }

    this.map.set(key, {
      value,
      expiresAt,
      lastAccessed: now
    });
    this.stats.sets += 1;
    return true;
  }

  /** 检查键是否存在且未过期。 */
  has(key) {
    const entry = this.map.get(key);
    if (!entry) return false;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return false;
    }
    return true;
  }

  /** 删除指定键。 */
  delete(key) {
    return this.map.delete(key);
  }

  /** 清空所有文风缓存。 */
  clear() {
    this.map.clear();
    this.stats = { hits: 0, misses: 0, sets: 0, evictions: 0 };
  }

  /** 当前条目数量。 */
  size() {
    return this.map.size;
  }

  /** 导出统计数据。 */
  getStats() {
    return {
      ...this.stats,
      size: this.map.size,
      hitRate: this.stats.hits + this.stats.misses > 0
        ? Number((this.stats.hits / (this.stats.hits + this.stats.misses)).toFixed(4))
        : 0
    };
  }
}

const defaultStyleProfileCache = new StyleProfileCache();

module.exports = {
  StyleProfileCache,
  defaultStyleProfileCache
};
