'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CanonCache } = require('../lib/generation/canon-cache');
const { StyleProfileCache } = require('../lib/style/style-profile-cache');
const { GenreBaselineCache } = require('../lib/genre/genre-baseline-cache');

test('P1 Caches - CanonCache handles TTL, LRU eviction, and deterministic keys', async () => {
  const cache = new CanonCache({ maxEntries: 2, defaultTtlMs: 50 });
  const key1 = cache.computeKey('proj_1', 'ch_1', 1, 'hash_abc');
  const key2 = cache.computeKey('proj_1', 'ch_2', 1, 'hash_def');
  const key3 = cache.computeKey('proj_1', 'ch_3', 1, 'hash_ghi');

  assert.equal(key1, 'canon:proj_1:ch_1:v1:hash_abc');

  cache.set(key1, { characters: ['叶凌天'] });
  cache.set(key2, { characters: ['苏清璇'] });
  assert.equal(cache.size(), 2);

  // 命中 key1
  const hit1 = cache.get(key1);
  assert.deepEqual(hit1, { characters: ['叶凌天'] });

  // 插入第三个条目，应按 LRU 淘汰最久未访问的 key2
  cache.set(key3, { characters: ['楚狂人'] });
  assert.equal(cache.size(), 2);
  assert.equal(cache.has(key2), false); // key2 已被淘汰
  assert.equal(cache.has(key1), true);
  assert.equal(cache.has(key3), true);

  // 验证 stats
  const stats = cache.getStats();
  assert.ok(stats.evictions >= 1);
  assert.ok(stats.hits >= 1);

  // 验证 TTL 过期
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(cache.get(key1), null);
  assert.equal(cache.has(key1), false);
});

test('P1 Caches - StyleProfileCache handles profile storage and metrics', async () => {
  const cache = new StyleProfileCache({ maxEntries: 5, defaultTtlMs: 50 });
  const key = cache.computeKey('proj_2', 'source_hash_xyz', 2);
  assert.equal(key, 'style_profile:proj_2:source_hash_xyz:v2');

  cache.set(key, { archetype: 'cold_irony', pace: 'compact' });
  assert.equal(cache.has(key), true);
  assert.deepEqual(cache.get(key), { archetype: 'cold_irony', pace: 'compact' });

  // 等待 TTL 过期
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(cache.get(key), null);
});

test('P1 Caches - GenreBaselineCache stores baselines and mechanisms', () => {
  const cache = new GenreBaselineCache({ maxEntries: 10, defaultTtlMs: 10000 });
  const key = cache.computeKey('xuanhuan', 'oriental_cultivation', 'golden_core', 1);
  assert.equal(key, 'genre_baseline:xuanhuan:oriental_cultivation:golden_core:v1');

  cache.set(key, {
    genre: '玄幻修真',
    pacingPolicy: { transitionRange: [10, 40], breathingAllowed: true }
  });

  assert.equal(cache.has(key), true);
  const baseline = cache.get(key);
  assert.equal(baseline.genre, '玄幻修真');
  assert.equal(baseline.pacingPolicy.breathingAllowed, true);

  cache.clear();
  assert.equal(cache.size(), 0);
  assert.equal(cache.has(key), false);
});
