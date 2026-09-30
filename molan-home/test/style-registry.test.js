'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getStyleCatalog, resolveStyleId, getStyleProfile, STYLE_CATALOG } = require('../lib/style/style-registry');

test('P2: Style Registry 纳管 8 大文风 Profile 且每类具备可计算机制', () => {
  const catalog = getStyleCatalog();
  const keys = Object.keys(catalog);
  assert.equal(keys.length, 8, '风格母类必须为 8 类');

  const requiredStyles = [
    'cold_measured',
    'hot_blooded',
    'witty_humorous',
    'restrained_tension',
    'desolate_historical',
    'brisk_lighthearted',
    'epic_grandeur',
    'naturalistic_daily'
  ];

  for (const styleId of requiredStyles) {
    const entry = catalog[styleId];
    assert.ok(entry, `缺少风格 ${styleId}`);
    assert.equal(entry.id, styleId);
    assert.ok(entry.title);
    assert.ok(Array.isArray(entry.aliases) && entry.aliases.length > 0);
    assert.ok(entry.profile, `风格 ${styleId} 缺少 profile 特征`);

    const p = entry.profile;
    assert.equal(typeof p.rhythm.sentenceLengthP50, 'number');
    assert.equal(typeof p.syntax.shortSentenceRatio, 'number');
    assert.equal(typeof p.diction.register, 'string');
    assert.equal(typeof p.narration.distance, 'string');
    assert.equal(typeof p.dialogue.avgTurnLength, 'number');
    assert.equal(typeof p.emotion.explicitEmotion, 'string');
    assert.equal(typeof p.pacing.microConflictInterval, 'number');
    assert.ok(Array.isArray(p.antiPatterns));
  }
});

test('P2: Style Registry 别名解析健全且默认安全回退', () => {
  assert.equal(resolveStyleId('冷峻'), 'cold_measured');
  assert.equal(resolveStyleId('热血激昂'), 'hot_blooded');
  assert.equal(resolveStyleId('humorous_sand_sculpture'), 'witty_humorous');
  assert.equal(resolveStyleId('日常'), 'naturalistic_daily');
  assert.equal(resolveStyleId('未知风格'), 'cold_measured');

  const profile = getStyleProfile('史诗');
  assert.equal(profile.id, 'epic_grandeur');
});
