'use strict';

/**
 * 题材基线与机制缓存 (Genre Baseline Cache)
 *
 * 核心设计：
 * - 缓存键结构：`genre_baseline:${family}:${subgenre || 'default'}:${route || 'default'}:v${version || 1}`
 * - 内存管理：LRU 淘汰 + TTL 机制；
 * - 统计监控：提供 hitCount, missCount, size, hitRate 指标。
 */

const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000; // 默认 4 小时

class GenreBaselineCache {
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

  /** 计算题材基线缓存的确定性键。 */
  computeKey(family, subgenre = 'default', route = 'default', baselineVersion = 1) {
    const f = String(family || 'generic').trim().toLowerCase();
    const s = String(subgenre || 'default').trim().toLowerCase();
    const r = String(route || 'default').trim().toLowerCase();
    const v = String(baselineVersion || '1').trim();
    return `genre_baseline:${f}:${s}:${r}:v${v}`;
  }

  /** 获取缓存条目。 */
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

  /** 写入题材基线缓存。 */
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

  /** 清空所有缓存。 */
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

const defaultGenreBaselineCache = new GenreBaselineCache();

module.exports = {
  GenreBaselineCache,
  defaultGenreBaselineCache
};
