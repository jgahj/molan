'use strict';

/**
 * 创作圣经与设定正典缓存 (Canon Cache)
 *
 * 核心设计：
 * - 缓存键结构：`canon:${projectId}:${chapterId || 'global'}:v${version || 1}:${sourceHash}`
 * - 内存管理：LRU (Least Recently Used) 淘汰策略 + TTL 超时机制，防内存泄漏；
 * - 统计监控：提供 hitCount, missCount, size, evictions 指标。
 */

const crypto = require('node:crypto');

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 默认 1 小时

function hashString(content) {
  return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}

class CanonCache {
  constructor(options = {}) {
    this.maxEntries = Number(options.maxEntries) || DEFAULT_MAX_ENTRIES;
    this.defaultTtlMs = Number(options.defaultTtlMs) || DEFAULT_TTL_MS;
    this.map = new Map(); // key -> { value, expiresAt, lastAccessed }
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      evictions: 0
    };
  }

  /** 计算正典缓存的确定性键。 */
  computeKey(projectId, chapterId = 'global', version = 1, sourceHash = '') {
    const p = String(projectId || '').trim() || 'default_project';
    const c = String(chapterId || 'global').trim();
    const v = String(version || '1').trim();
    const s = String(sourceHash || '').trim() || 'nohash';
    return `canon:${p}:${c}:v${v}:${s}`;
  }

  /** 获取缓存条目。命中时刷新访问时间并计入统计。 */
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

    // 刷新 LRU 访问
    entry.lastAccessed = now;
    // 重置 Map 顺序（删除并重新插入）
    this.map.delete(key);
    this.map.set(key, entry);

    this.stats.hits += 1;
    return entry.value;
  }

  /** 写入缓存条目。超出最大容量时按 LRU 淘汰最早未使用的条目。 */
  set(key, value, options = {}) {
    const now = Date.now();
    const ttlMs = Number(options.ttlMs) || this.defaultTtlMs;
    const expiresAt = ttlMs > 0 ? now + ttlMs : 0;

    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxEntries) {
      // 淘汰 Map 开头的第一个（最久未访问）条目
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

  /** 显式删除指定键。 */
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

const defaultCanonCache = new CanonCache();

module.exports = {
  CanonCache,
  defaultCanonCache,
  hashString
};
