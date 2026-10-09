'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  buildCanonicalOutlineContext,
  createGenerationService,
  extractAuthoritativeChapters
} = require('../services/generation-service');
const {
  assembleContext,
  formatOutlineContextMarkdown,
  BLOCK_TO_LAYER,
  PRIORITY
} = require('../lib/generation/context');

test('ADV-01: buildCanonicalOutlineContext with empty object {} defaults correctly', () => {
  const result = buildCanonicalOutlineContext({});
  assert.ok(result, 'Result must exist');
  assert.ok(result.chapter, 'chapter must exist');
  assert.equal(result.chapter.chapterNo, 1, 'Default chapterNo must be 1');
  assert.equal(result.chapter.title, '第1章', 'Default title must be 第1章');
  assert.deepEqual(result.chapter.beats, [], 'Default beats must be []');
  assert.deepEqual(result.chapter.scenes, [], 'Default scenes must be []');
  assert.equal(result.chapter.summary, '', 'Default summary must be empty string');
  assert.deepEqual(result.chapter.sceneDirectives, [], 'Default sceneDirectives must be []');

  assert.ok(result.volume, 'volume must exist');
  assert.equal(result.volume.volumeNo, 1);
  assert.equal(result.volume.volumeId, 'vol_1');
  assert.equal(result.volume.title, '第1卷');
  assert.equal(result.volume.goal, '');
  assert.deepEqual(result.volume.arcGoals, []);
  assert.equal(result.volume.volumePlan, '');

  assert.ok(result.dependencies, 'dependencies must exist');
  assert.deepEqual(result.dependencies.prerequisiteEvents, []);
  assert.deepEqual(result.dependencies.foreshadows, []);
  assert.deepEqual(result.dependencies.causalDebts, []);
  assert.deepEqual(result.dependencies.nextChapterInterface, { hookGoal: '', unresolvedTension: '' });

  assert.ok(result.meta, 'meta must exist');
  assert.equal(result.meta.revision, 1);
  assert.equal(result.meta.completenessTier, 'goal_only');
  assert.equal(typeof result.meta.outlineHash, 'string');
  assert.equal(result.meta.outlineHash.length, 64);
});

test('ADV-02: Adversarial null/primitive input robustness in buildCanonicalOutlineContext', () => {
  let nullError = null;
  let nullResult = null;
  try {
    nullResult = buildCanonicalOutlineContext(null);
  } catch (err) {
    nullError = err;
  }
  assert.equal(nullError, null, 'Calling buildCanonicalOutlineContext(null) must not throw TypeError');
  assert.ok(nullResult, 'Calling buildCanonicalOutlineContext(null) must return valid canonical object');
  assert.equal(typeof nullResult.chapter, 'object');

  const undefResult = buildCanonicalOutlineContext(undefined);
  assert.ok(undefResult, 'undefined uses default parameter cleanly');

  const numResult = buildCanonicalOutlineContext(12345);
  assert.ok(numResult, 'Primitive number does not crash');
});

test('ADV-03: Null and malformed subfields inside input handled safely', () => {
  const result = buildCanonicalOutlineContext({
    chapter: null,
    volume: null,
    dependencies: null,
    meta: null,
    novelState: null,
    biblePayload: null,
    request: null,
    contract: null,
    previous: null,
    factLedger: null,
    chapterContext: null
  });
  assert.ok(result, 'Must handle null subfields gracefully');
  assert.equal(result.chapter.chapterNo, 1);
  assert.equal(result.volume.volumeNo, 1);
  assert.equal(result.meta.completenessTier, 'goal_only');
  assert.equal(result.meta.outlineHash.length, 64);
});

test('ADV-04: Extreme / Non-string / Non-numeric chapterNo normalization', () => {
  const cases = [
    { in: -1, exp: 1 },
    { in: 0, exp: 1 },
    { in: '0', exp: 1 },
    { in: '-5', exp: 1 },
    { in: NaN, exp: 1 },
    { in: Infinity, exp: 1 },
    { in: -Infinity, exp: 1 },
    { in: 'not-a-number', exp: 1 },
    { in: {}, exp: 1 },
    { in: [], exp: 1 },
    { in: null, exp: 1 },
    { in: undefined, exp: 1 },
    { in: '42', exp: 42 },
    { in: 42.99, exp: 42 },
    { in: '999999999', exp: 999999999 }
  ];

  for (const tc of cases) {
    const res = buildCanonicalOutlineContext({ chapter: { chapterNo: tc.in } });
    assert.equal(res.chapter.chapterNo, tc.exp, `For chapterNo=${String(tc.in)}, expected ${tc.exp}, got ${res.chapter.chapterNo}`);
  }
});

test('ADV-05: Missing and malformed volumePlan evaluation', () => {
  const cases = [
    { volume: {} },
    { volume: { volumePlan: null } },
    { volume: { volumePlan: undefined } },
    { volume: { volumePlan: '' } },
    { volume: { volumePlan: { nested: 'plan' } } }
  ];

  for (const tc of cases) {
    const res = buildCanonicalOutlineContext(tc);
    assert.ok(res.volume, 'volume must exist');
    assert.equal(typeof res.volume.volumePlan, 'string', 'volumePlan must evaluate to string');
  }
});

test('ADV-06: Extreme text size (120k chars) and unusual unicode/control characters', () => {
  const hugeText = '道可道非常道名可名非常名'.repeat(10000); // 120,000 chars
  const strangeChars = '🔥🐉⚔️【】《》\u0000\u200B\uFEFF\t\r\n\uD83D\uDE00<script>alert("xss")</script>\'"`';

  const res = buildCanonicalOutlineContext({
    chapter: {
      title: strangeChars,
      goal: hugeText,
      beats: [hugeText.slice(0, 500), strangeChars],
      scenes: [{ goal: strangeChars }]
    },
    volume: {
      volumePlan: hugeText.slice(0, 1000)
    }
  });

  assert.equal(res.meta.completenessTier, 'full_scenes');
  assert.equal(typeof res.meta.outlineHash, 'string');
  assert.equal(res.meta.outlineHash.length, 64);

  const md = formatOutlineContextMarkdown(res);
  assert.ok(md.includes('【当前章节目标与核心节拍】'));
  assert.ok(md.includes(strangeChars));
});

test('ADV-07: Circular objects in scenes throw expectedly during hash serialization', () => {
  const circularScene = { goal: '循环场景测试' };
  circularScene.nested = circularScene;

  assert.throws(
    () => buildCanonicalOutlineContext({ chapter: { scenes: [circularScene] } }),
    /Converting circular structure to JSON/,
    'Circular reference inside scenes should be detected during JSON serialization'
  );
});

test('ADV-08: Hash determinism, avalanche uniqueness, and key-order sensitivity', () => {
  const baseInput = {
    chapter: {
      chapterId: 'chap_10',
      chapterNo: 10,
      title: '天火三玄变',
      goal: '炼化青莲地心火',
      beats: ['初入密室', '异火反噬', '药老护法'],
      scenes: [{ id: 's1', goal: '吞噬异火' }]
    },
    volume: {
      volumeId: 'vol_2',
      volumeNo: 2,
      title: '黑角域风云',
      goal: '名震黑角域',
      arcGoals: ['夺取异火', '创建势力'],
      volumePlan: '以异火为主线'
    },
    dependencies: {
      prerequisiteEvents: ['得到异火消息'],
      foreshadows: [{ id: 'f1', name: '韩枫异动' }],
      causalDebts: [{ id: 'd1', promise: '偿还云韵恩情' }],
      nextChapterInterface: { hookGoal: '突破斗王', unresolvedTension: '丹王古河来袭' }
    },
    projectRevision: 5
  };

  // 1. Identical inputs yield identical hash
  const baseRes = buildCanonicalOutlineContext(baseInput);
  for (let i = 0; i < 20; i++) {
    const iterRes = buildCanonicalOutlineContext(JSON.parse(JSON.stringify(baseInput)));
    assert.equal(iterRes.meta.outlineHash, baseRes.meta.outlineHash, `Iteration ${i} hash must match`);
  }

  // 2. Differing single property produces different hash
  const mutations = [
    input => { input.chapter.chapterNo = 11; },
    input => { input.chapter.title = '天火三玄变·破境'; },
    input => { input.chapter.goal = '炼化陨落心炎'; },
    input => { input.chapter.beats = ['初入密室', '异火反噬']; },
    input => { input.chapter.scenes[0].goal = '不同目标'; },
    input => { input.volume.volumeNo = 3; },
    input => { input.volume.title = '中州大陆'; },
    input => { input.volume.arcGoals = ['不同弧线']; },
    input => { input.volume.volumePlan = '不同规划'; },
    input => { input.dependencies.prerequisiteEvents = ['不同前置事件']; },
    input => { input.dependencies.foreshadows = [{ id: 'f2', name: '新伏笔' }]; },
    input => { input.dependencies.causalDebts = [{ id: 'd2', promise: '新债务' }]; },
    input => { input.dependencies.nextChapterInterface.hookGoal = '不同承接钩子'; },
    input => { input.dependencies.nextChapterInterface.unresolvedTension = '不同未解悬念'; },
    input => { input.projectRevision = 6; }
  ];

  const seenHashes = new Set([baseRes.meta.outlineHash]);
  for (let i = 0; i < mutations.length; i++) {
    const clone = JSON.parse(JSON.stringify(baseInput));
    mutations[i](clone);
    const mutRes = buildCanonicalOutlineContext(clone);
    assert.notEqual(
      mutRes.meta.outlineHash,
      baseRes.meta.outlineHash,
      `Mutation ${i} must produce a different hash`
    );
    assert.ok(!seenHashes.has(mutRes.meta.outlineHash), `Mutation ${i} hash must be unique among mutations`);
    seenHashes.add(mutRes.meta.outlineHash);
  }

  // 3. Key ordering sensitivity detection
  const inputA = JSON.parse(JSON.stringify(baseInput));
  inputA.chapter.scenes = [{ id: 's1', goal: '吞噬异火' }];
  const inputB = JSON.parse(JSON.stringify(baseInput));
  inputB.chapter.scenes = [{ goal: '吞噬异火', id: 's1' }];

  const hashA = buildCanonicalOutlineContext(inputA).meta.outlineHash;
  const hashB = buildCanonicalOutlineContext(inputB).meta.outlineHash;
  assert.notEqual(hashA, hashB, 'Confirmed: JSON key insertion order differences result in differing outlineHash');
});

test('ADV-09: String literal leakage detection (null, undefined, {}) in formatOutlineContextMarkdown', () => {
  const sparseOutline = {
    chapter: {
      chapterNo: 5,
      title: null,
      goal: null,
      summary: null,
      beats: [null, undefined, '有效节拍', {}],
      scenes: [null, { goal: '有效场景' }],
      sceneDirectives: [null, { directive: '特写动作' }]
    },
    volume: {
      volumeNo: null,
      title: null,
      goal: null,
      arcGoals: [null, '有效弧线'],
      volumePlan: null
    },
    dependencies: {
      prerequisiteEvents: [null, '有效依赖'],
      foreshadows: [null, { name: '有效伏笔' }],
      causalDebts: [null, { description: '有效债务' }],
      nextChapterInterface: { hookGoal: null, unresolvedTension: null }
    }
  };

  const md = formatOutlineContextMarkdown(sparseOutline);
  // Empirical verification of literal leaks prevented
  const hasNullInBeats = md.includes('1. null');
  const hasUndefinedInBeats = md.includes('2. undefined');
  const hasEmptyObjInBeats = md.includes('4. {}');

  assert.equal(hasNullInBeats, false, 'beats array with null must not leak "1. null" into markdown');
  assert.equal(hasUndefinedInBeats, false, 'beats array with undefined must not leak "2. undefined" into markdown');
  assert.equal(hasEmptyObjInBeats, false, 'beats array with {} must not leak "4. {}" into markdown');
  assert.ok(md.includes('1. 有效节拍'), 'valid beat must be rendered with index 1.');
});

test('ADV-10: assembleContext cleans aliases, registers Priority 0 and L2_chapter', () => {
  const outlineContext = buildCanonicalOutlineContext({
    chapter: { chapterNo: 1, title: '测试章', goal: '通过测试' }
  });

  const fullInput = {
    outlineContext,
    chapterOutline: { legacy: 'should-be-deleted' },
    chapterContext: { legacy: 'should-be-deleted' },
    chapterPlan: { legacy: 'should-be-deleted' },
    planText: 'legacy text should be deleted',
    currentChapterOutline: 'legacy current outline should be deleted',
    outline: { legacy: 'should-be-deleted' },
    outlineDependencies: { legacy: 'should-be-deleted' },
    instruction: '写作指令'
  };

  const assembled = assembleContext(fullInput, { maxChars: 50000 });
  assert.ok(assembled.text, 'Assembled text must exist');

  const includedIds = assembled.blocks.map(b => b.id);
  assert.ok(includedIds.includes('outlineContext'), 'outlineContext must be included');
  assert.ok(!includedIds.includes('chapterOutline'), 'chapterOutline must be eliminated');
  assert.ok(!includedIds.includes('chapterContext'), 'chapterContext must be eliminated');
  assert.ok(!includedIds.includes('chapterPlan'), 'chapterPlan must be eliminated');
  assert.ok(!includedIds.includes('planText'), 'planText must be eliminated');
  assert.ok(!includedIds.includes('currentChapterOutline'), 'currentChapterOutline must be eliminated');
  assert.ok(!includedIds.includes('outline'), 'outline must be eliminated');
  assert.ok(!includedIds.includes('outlineDependencies'), 'outlineDependencies must be eliminated');

  const ocBlock = assembled.blocks.find(b => b.id === 'outlineContext');
  assert.equal(ocBlock.priority, 0, 'outlineContext priority must be 0');
  assert.equal(ocBlock.layer, 'L2_chapter', 'outlineContext layer must be L2_chapter');
});

test('ADV-11: assembleContext budget overflow rejection and non-object inputs', () => {
  const hugeText = '天地不仁以万物为刍狗'.repeat(5000);
  const outlineContext = buildCanonicalOutlineContext({
    chapter: { chapterNo: 1, title: '超长章', goal: hugeText }
  });

  assert.throws(
    () => assembleContext({ outlineContext }, { maxChars: 100, hardLimit: 100 }),
    /超出模型预算/,
    'assembleContext must reject overflow when required P0 block exceeds hard limit'
  );

  const resNull = assembleContext(null);
  assert.ok(resNull.contextPlan, 'assembleContext(null) must not crash');

  const resNum = assembleContext(42);
  assert.ok(resNum.contextPlan, 'assembleContext(42) must not crash');
});

test('ADV-12: extractAuthoritativeChapters boundary checks', () => {
  assert.deepEqual(extractAuthoritativeChapters(null), []);
  assert.deepEqual(extractAuthoritativeChapters(undefined), []);
  assert.deepEqual(extractAuthoritativeChapters({}), []);
  assert.deepEqual(extractAuthoritativeChapters({ volumes: null }), []);
  assert.deepEqual(extractAuthoritativeChapters({ volumes: [null, undefined, {}] }), []);
  assert.deepEqual(extractAuthoritativeChapters({ volumes: [{ chapters: [null, { id: 'c1', title: '章1' }] }] }), [
    { id: 'c1', title: '章1', volumeId: undefined, volumeTitle: undefined }
  ]);
});
