'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findFamilyByRoute,
  findFamilyBySubcategory,
  getCanonicalRoute,
  getLegacyRoute,
  GENRE_FAMILIES_WITH_ROUTES,
  ROUTE_DEFINITIONS
} = require('../lib/genre/genre-route-index');
const styleDetector = require('../lib/style-detector');
const { planScenes } = require('../lib/scene-planner');

test('genre-route-index: 规范化覆盖全部母类与双向路由（canonical 与 legacy）', () => {
  assert.ok(ROUTE_DEFINITIONS.length >= 20, '定义了至少 20 种典型写作机制路由');

  for (const def of ROUTE_DEFINITIONS) {
    const fromCanonical = findFamilyByRoute(def.canonical);
    assert.ok(fromCanonical, `必须可通过 canonical route「${def.canonical}」反查母类`);
    assert.equal(fromCanonical.familyId, def.familyId);
    assert.equal(fromCanonical.familyTitle, def.familyTitle);

    const fromLegacy = findFamilyByRoute(def.legacy);
    assert.ok(fromLegacy, `必须可通过 legacy route「${def.legacy}」反查母类`);
    assert.equal(fromLegacy.familyId, def.familyId);
    assert.equal(fromLegacy.familyTitle, def.familyTitle);

    assert.equal(getCanonicalRoute(def.legacy), def.canonical);
    assert.equal(getLegacyRoute(def.canonical), def.legacy);
  }
});

test('genre-route-index: GENRE_FAMILIES_WITH_ROUTES 包含有效 routes 字段，杜绝 fObj.routes 为空', () => {
  for (const [key, family] of Object.entries(GENRE_FAMILIES_WITH_ROUTES)) {
    assert.ok(Array.isArray(family.routes), `母类「${key}」必须具备有效 routes 数组`);
    assert.ok(family.routes.length > 0, `母类「${key}」routes 数组不可为空`);
    for (const r of family.routes) {
      assert.ok(r.value, 'route 必须具有 value');
      assert.ok(r.legacyValue, 'route 必须具有 legacyValue');
    }
  }
});

test('style-detector: 路线反查使用 canonical genre-route-index，杜绝 routes 反查失效', () => {
  // 通过 canonical route 反查玄幻
  const result1 = styleDetector.detectNovelStyle('普通对话', { genreRoute: 'cautious_survival' });
  assert.equal(result1.genreFamily, '玄幻修真');

  // 通过 legacy route 反查都市高武
  const result2 = styleDetector.detectNovelStyle('普通对话', { genreRoute: 'urban_grind' });
  assert.equal(result2.genreFamily, '都市高武');

  // 通过 legacy route 反查悬疑惊悚
  const result3 = styleDetector.detectNovelStyle('普通对话', { genreRoute: 'laoshiren' });
  assert.equal(result3.genreFamily, '悬疑惊悚');

  // 通过 legacy route 反查西方奇幻
  const result4 = styleDetector.detectNovelStyle('普通对话', { genreRoute: 'sequence_cost' });
  assert.equal(result4.genreFamily, '西方奇幻');
});

test('scene-planner: 支持参数化 pacingPolicy 动态控制转场、留白与呼吸', () => {
  const nodes = [
    '第一场戏：宗门弟子交涉',
    '第二场戏：战后休整与反思',
    '三日后，第三场戏：跨越秘境禁区'
  ];

  // 1. 自定义 pacingPolicy 扩大呼吸与转场
  const customPolicy = {
    transitionRange: [20, 50],
    breathingAllowed: true,
    breathingRange: [80, 160],
    actionDensity: { min: 0.1, max: 0.5 }
  };

  const plan = planScenes(nodes, { pacingPolicy: customPolicy });
  const bridgeScene = plan.scenes.find(s => s.requiresTransitionBridge);
  assert.ok(bridgeScene, '应检测到时空位移');
  assert.match(bridgeScene.transitionBridgeDirective, /50 字以内/);

  const downtimeScene = plan.scenes.find(s => s.allocateDowntime);
  assert.ok(downtimeScene, '应分配呼吸留白');
  assert.match(downtimeScene.downtimeDirective, /80~160 字/);

  // 2. 紧凑型场景策略禁用呼吸留白
  const tightPolicy = {
    breathingAllowed: false,
    transitionRange: [10, 25]
  };
  const tightPlan = planScenes(nodes, { pacingPolicy: tightPolicy });
  assert.equal(tightPlan.scenesWithDowntimeBudget, 0, '禁用 breathingAllowed 时不应产生呼吸留白');
});
