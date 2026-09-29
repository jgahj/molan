'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { STYLE_DNA, ARCHETYPE_TO_STYLE_DNA, resolveStyleDNA, toStyleDNA } = require('../lib/style/style-dna');
const { compileStyleBundle, BUNDLE_VERSION, deterministicStringify } = require('../lib/style/style-bundle');
const { STYLE_ARCHETYPES, getArchetypeStyleDNA } = require('../lib/style-archetypes');
const styleSystem = require('../lib/style-system');

test('P3: STYLE_DNA 基础风格基因定义完备', () => {
  assert.ok(Object.keys(STYLE_DNA).length >= 8);
  for (const [key, dna] of Object.entries(STYLE_DNA)) {
    assert.ok(dna.sentence, `${key} 缺少 sentence 属性`);
    assert.ok(dna.pacing, `${key} 缺少 pacing 属性`);
    assert.ok(dna.emotion, `${key} 缺少 emotion 属性`);
    assert.ok(dna.dialogue, `${key} 缺少 dialogue 属性`);
    assert.equal(typeof dna.metaphorDensity, 'number', `${key} metaphorDensity 应为数值`);
  }
});

test('P3: 10 大核心 StyleArchetype 全部正确映射并绑定规范 StyleDNA', () => {
  const archetypeKeys = Object.keys(STYLE_ARCHETYPES);
  assert.equal(archetypeKeys.length, 10, '应包含 10 大核心网文风格原型');

  for (const id of archetypeKeys) {
    const archetype = STYLE_ARCHETYPES[id];
    assert.ok(archetype.styleDnaKey, `${id} 缺少 styleDnaKey 属性`);
    assert.ok(STYLE_DNA[archetype.styleDnaKey], `${id} 的 styleDnaKey ${archetype.styleDnaKey} 不在 STYLE_DNA 中`);
    assert.deepEqual(archetype.styleDna, STYLE_DNA[archetype.styleDnaKey]);

    const dna = getArchetypeStyleDNA(id);
    assert.ok(dna, `getArchetypeStyleDNA(${id}) 应返回有效 DNA`);
    assert.deepEqual(dna, STYLE_DNA[archetype.styleDnaKey]);
  }
});

test('P3: resolveStyleDNA 统一支持中文标签、原型键名与对象输入', () => {
  // 1. 中文标签
  const resLabel = resolveStyleDNA('史诗');
  assert.equal(resLabel.status, 'resolved');
  assert.deepEqual(resLabel.dna, STYLE_DNA['史诗']);

  // 2. 原型键名
  const resArch = resolveStyleDNA('epic_grandeur');
  assert.equal(resArch.status, 'resolved');
  assert.equal(resArch.styleDnaKey, '史诗');
  assert.deepEqual(resArch.dna, STYLE_DNA['史诗']);

  // 3. 原型对象输入
  const resObj = resolveStyleDNA({ styleArchetype: 'humorous_sand_sculpture' });
  assert.equal(resObj.status, 'resolved');
  assert.equal(resObj.styleDnaKey, '诙谐');
  assert.deepEqual(resObj.dna, STYLE_DNA['诙谐']);

  // 4. 未知输入要求选择
  const resUnknown = resolveStyleDNA('未知怪诞文风');
  assert.equal(resUnknown.status, 'needs_choice');
  assert.ok(resUnknown.candidates.length >= 8);
});

test('P3: compileStyleBundle 输出规范包含 version 与校验 Hash', () => {
  const bundle = compileStyleBundle({
    style: '冷峻',
    genreProfile: { genre: '悬疑' },
    narrativeProfile: { pacing: 'tight' }
  });

  assert.equal(bundle.status, 'resolved');
  assert.equal(bundle.version, BUNDLE_VERSION);
  assert.equal(typeof bundle.hash, 'string');
  assert.equal(bundle.hash.length, 64, 'SHA256 hash 长度应为 64');
  assert.ok(bundle.prompt.includes('STYLE DNA'));
});

test('P3: 文风包匹配确定性：多次计算与键顺序变化必须产出恒定一致的 Hash', () => {
  const inputA = {
    style: 'epic_grandeur',
    genreProfile: { genre: '玄幻', subgenre: '东方玄幻' },
    narrativeProfile: { mode: 'ascending', tension: 8 },
    characterVoices: [
      { characterId: 'hero', speech: { directness: 0.8, formality: 0.3 } }
    ]
  };

  // 改变对象属性插入顺序的等价输入
  const inputB = {
    narrativeProfile: { tension: 8, mode: 'ascending' },
    characterVoices: [
      { speech: { formality: 0.3, directness: 0.8 }, characterId: 'hero' }
    ],
    genreProfile: { subgenre: '东方玄幻', genre: '玄幻' },
    style: 'epic_grandeur'
  };

  const bundleA = compileStyleBundle(inputA);
  const bundleB = compileStyleBundle(inputB);

  assert.equal(bundleA.hash, bundleB.hash, '对象键顺序不同但内容相同时，编译出的 Hash 必须严格恒定');
  assert.equal(bundleA.prompt, bundleB.prompt);
  assert.equal(bundleA.bundleId, bundleB.bundleId);

  // 反复 50 次计算验证幂等稳定性
  for (let i = 0; i < 50; i++) {
    const run = compileStyleBundle(inputA);
    assert.equal(run.hash, bundleA.hash);
  }
});

test('P3: styleSystem.compileStyleBundle 输出包含 version 和 hash', () => {
  const profiles = [
    {
      id: 'p1',
      revision: 1,
      level: 'novel_narrative',
      hardRules: ['第三人称受限'],
      softPreferences: { pace: 'steady' },
      positiveSamples: ['剑鸣如水。'],
      checkRules: {}
    }
  ];

  const compiled = styleSystem.compileStyleBundle(profiles, {});
  assert.equal(compiled.version, 'style-bundle-v1');
  assert.equal(typeof compiled.hash, 'string');
  assert.equal(compiled.hash.length, 64);
});
