'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createGenreProfile, checkForbiddenAssumptions, compileGenrePolicy } = require('../lib/composition/profiles/genre-profile');
const { createStyleProfile, modulateStyle, normalizeStyleVector, compileStylePolicy } = require('../lib/composition/profiles/style-profile');
const { createChapterGoalProfile, normalizeStateDelta, compileGoalPolicy } = require('../lib/composition/profiles/chapter-goal-profile');
const { createFocusProfile, normalizeBudgetWeights, calculateCharacterBudgets, compileFocusPolicy } = require('../lib/composition/profiles/focus-profile');
const { createHookProfile, normalizePayoffHorizon, toCausalDebtRegistration, compileHookPolicy } = require('../lib/composition/profiles/hook-profile');
const {
  defaultProfileRegistry,
  ProfileRegistry,
  ProfileResolutionError,
  SEED_GENRES,
  SEED_STYLES,
  SEED_GOALS,
  SEED_FOCUSES,
  SEED_HOOKS,
  StoryEngineRegistry,
  defaultStoryEngineRegistry,
  SEED_STORY_ENGINES,
  ReaderPromiseRegistry,
  defaultReaderPromiseRegistry,
  SEED_READER_PROMISES
} = require('../lib/composition/profiles/profile-registry');
const { createStoryEngineProfile, createReaderPromiseProfile } = require('../lib/composition/models/data-schemas');
const { evaluateCompatibility } = require('../lib/composition/compiler/compatibility-matrix');
const { compileChapterStrategy } = require('../lib/composition/compiler/strategy-compiler');
const contentEngine = require('../lib/generation/content-engine');

// ===========================================================================
// 原有基础测试用例 (保真回归)
// ===========================================================================

test('Composition Profiles: GenreProfile 强制解耦人设与违禁假设', () => {
  const gp = createGenreProfile({
    id: 'xuanhuan_pure',
    name: '纯玄幻',
    family: 'xuanhuan',
    background: ['灵气', '宗门'],
    coreConflicts: ['资源竞争']
  });

  assert.equal(gp.id, 'xuanhuan_pure');
  assert.ok(gp.forbiddenAssumptions.length >= 4);
  assert.ok(gp.forbiddenAssumptions.some(f => f.includes('严禁预设主角')));

  // 测试禁止硬编码人设入侵
  const checkPass = checkForbiddenAssumptions('主角在宗门藏经阁寻找低阶法术', gp);
  assert.equal(checkPass.passed, true);

  const checkFail = checkForbiddenAssumptions('佳云泽面对师尊顾凝欣冷笑一声', gp);
  assert.equal(checkFail.passed, false);
  assert.ok(checkFail.violations[0].includes('硬编码'));

  const directive = compileGenrePolicy(gp);
  assert.ok(directive.includes('【题材策略·纯玄幻】'));
  assert.ok(directive.includes('【题材边界绝不假定】'));
});

test('Composition Profiles: StyleProfile 11维量化向量与局部文风调制', () => {
  const sp = createStyleProfile({
    id: 'laobai',
    name: '老白文风',
    baseVector: {
      narrativeDensity: 0.85,
      shortSentenceRatio: 0.60,
      averageSentenceLength: 20.0
    }
  });

  assert.equal(sp.baseVector.narrativeDensity, 0.85);
  assert.equal(sp.baseVector.shortSentenceRatio, 0.60);

  // 局部文风调制（例如高潮章）
  const modulated = modulateStyle(sp.baseVector, {
    shortSentenceRatio: +0.20,
    averageSentenceLength: -5.0,
    emotionalIntensity: +0.30
  });

  assert.equal(modulated.shortSentenceRatio, 0.80);
  assert.equal(modulated.averageSentenceLength, 15.0);
  assert.equal(modulated.emotionalIntensity, 0.80);
  assert.equal(modulated.narrativeDensity, 0.85); // 基础值保持

  const policy = compileStylePolicy(sp, { shortSentenceRatio: +0.20 });
  assert.ok(policy.includes('短句比例: 80%'));
  assert.ok(policy.includes('【文风质感策略·老白文风】'));
});

test('Composition Profiles: ChapterGoalProfile 状态变化模型 (State Delta)', () => {
  const gp = createChapterGoalProfile({
    id: 'info_reveal',
    name: '信息揭露',
    readerEffect: ['获得新线索'],
    defaultStateDelta: {
      stateBefore: '误以为凶手是A',
      events: ['发现物证信件'],
      stateAfter: '证实凶手是B',
      invalidIfRemoved: '后续追捕B缺乏因果'
    }
  });

  assert.equal(gp.defaultStateDelta.invalidIfRemoved, '后续追捕B缺乏因果');

  const policy = compileGoalPolicy(gp);
  assert.ok(policy.includes('【本章核心目标·信息揭露】'));
  assert.ok(policy.includes('【状态跃迁契约 (State Delta)】'));
  assert.ok(policy.includes('章前状态：误以为凶手是A'));
  assert.ok(policy.includes('存在性检验：若删除本章，必须导致【后续追捕B缺乏因果】失效！'));
});

test('Composition Profiles: FocusProfile 7维镜头预算归一化与字数拆分', () => {
  const fp = createFocusProfile({
    id: 'combat',
    name: '动作搏杀',
    budgetWeights: {
      conflict: 0.30,
      action: 0.30,
      character: 0.10,
      dialogue: 0.10,
      setting: 0.10,
      emotion: 0.05,
      foreshadowing: 0.05
    }
  });

  const budgets = calculateCharacterBudgets(fp.budgetWeights, 3000);
  assert.equal(budgets.conflict.targetChars, 900);
  assert.equal(budgets.action.targetChars, 900);
  assert.equal(budgets.dialogue.targetChars, 300);

  const policy = compileFocusPolicy(fp, 3000);
  assert.ok(policy.includes('【本章镜头与笔墨预算分配·动作搏杀】'));
  assert.ok(policy.includes('约 900 字'));
});

test('Composition Profiles: HookProfile 兑现周期与因果债管理器联动', () => {
  const hp = createHookProfile({
    id: 'suspense_seal',
    name: '未死之人信物钩',
    type: 'suspense',
    strength: 0.82,
    payoffHorizon: 'medium',
    exampleSnippet: '信件落款是已故三年的恩师'
  });

  assert.equal(hp.payoffHorizon.span, 'medium');
  assert.equal(hp.payoffHorizon.maxChapters, 6);

  const debt = toCausalDebtRegistration(hp, { chapterId: 'ch_10', chapterNo: 10, clue: '恩师印信' });
  assert.equal(debt.createdChapterNo, 10);
  assert.equal(debt.targetPayoffChapterNo, 16);
  assert.equal(debt.status, 'active');

  const policy = compileHookPolicy(hp, debt);
  assert.ok(policy.includes('【本章钩子策略·未死之人信物钩】'));
  assert.ok(policy.includes(hp.payoffHorizon.label));
});

test('Composition Profiles: ProfileRegistry 自动解析 5 维输入并推导系统 7 维', () => {
  const registry = defaultProfileRegistry;
  const spec = registry.resolveCompositionSpec({
    genre: 'xuanhuan_cautious',
    style: 'laobai_restrained',
    chapterGoal: 'info_reveal',
    focus: 'dialogue_game',
    hook: 'suspense_clue',
    targetChars: 3200
  });

  assert.equal(spec.genre.name, '凡人谨慎修真');
  assert.equal(spec.style.name, '老白冷硬克制');
  assert.equal(spec.chapterGoal.name, '信息揭露');
  assert.equal(spec.focus.name, '对话机锋博弈');
  assert.equal(spec.hook.name, '物证异样悬念钩');
  assert.equal(spec.targetChars, 3200);

  // 验证系统自动推导出的 7 维属性
  assert.equal(spec.derived.informationFlow, 'partial_reveal');
  assert.equal(spec.derived.conflictMode, 'verbal_sparring');
  assert.ok(spec.derived.readerPromise.length > 0);
});

// ===========================================================================
// Suite 1: Strict Profile Resolution & Fallback Elimination (R3)
// ===========================================================================

test('R3 Suite 1.1: getGenre 未知标识返回 null，杜绝静默回退到 SEED_GENRES[0]', () => {
  const result = defaultProfileRegistry.getGenre('invalid_genre');
  assert.equal(result, null);
  assert.notEqual(result, SEED_GENRES[0]);
});

test('R3 Suite 1.2: getGenre 在 strict: true 时严格抛出 ProfileResolutionError', () => {
  assert.throws(
    () => defaultProfileRegistry.getGenre('invalid_genre', { strict: true }),
    (err) => {
      assert.ok(err instanceof ProfileResolutionError);
      assert.equal(err.name, 'ProfileResolutionError');
      assert.equal(err.dimension, 'genre');
      assert.equal(err.query, 'invalid_genre');
      assert.ok(Array.isArray(err.available) && err.available.length > 0);
      assert.ok(err.available.includes('xuanhuan_cautious'));
      return true;
    }
  );
});

test('R3 Suite 1.3: 空字符串与 null 查询安全返回 null，消除子串 includes("") 漏洞', () => {
  assert.equal(defaultProfileRegistry.getGenre(''), null);
  assert.equal(defaultProfileRegistry.getGenre('   '), null);
  assert.equal(defaultProfileRegistry.getGenre(null), null);
  assert.equal(defaultProfileRegistry.getGenre(undefined), null);

  assert.throws(
    () => defaultProfileRegistry.getGenre('', { strict: true }),
    (err) => {
      assert.ok(err instanceof ProfileResolutionError);
      assert.equal(err.dimension, 'genre');
      return true;
    }
  );
});

test('R3 Suite 1.4: getStyle / getGoal / getFocus / getHook 严格解析与回退消除对称覆盖', () => {
  // 默认返回 null
  assert.equal(defaultProfileRegistry.getStyle('invalid_style'), null);
  assert.equal(defaultProfileRegistry.getGoal('invalid_goal'), null);
  assert.equal(defaultProfileRegistry.getFocus('invalid_focus'), null);
  assert.equal(defaultProfileRegistry.getHook('invalid_hook'), null);

  // 空值安全返回 null
  assert.equal(defaultProfileRegistry.getStyle(''), null);
  assert.equal(defaultProfileRegistry.getGoal(''), null);
  assert.equal(defaultProfileRegistry.getFocus(''), null);
  assert.equal(defaultProfileRegistry.getHook(''), null);

  // strict 选项抛出异常
  assert.throws(
    () => defaultProfileRegistry.getStyle('invalid_style', { strict: true }),
    err => err instanceof ProfileResolutionError && err.dimension === 'style'
  );
  assert.throws(
    () => defaultProfileRegistry.getGoal('invalid_goal', { strict: true }),
    err => err instanceof ProfileResolutionError && err.dimension === 'goal'
  );
  assert.throws(
    () => defaultProfileRegistry.getFocus('invalid_focus', { strict: true }),
    err => err instanceof ProfileResolutionError && err.dimension === 'focus'
  );
  assert.throws(
    () => defaultProfileRegistry.getHook('invalid_hook', { strict: true }),
    err => err instanceof ProfileResolutionError && err.dimension === 'hook'
  );
});

test('R3 Suite 1.5: resolveCompositionSpec 显式提供未注册 Profile 查询时严格阻断抛错', () => {
  assert.throws(
    () => defaultProfileRegistry.resolveCompositionSpec({ genre: 'unknown_xyz' }),
    (err) => {
      assert.ok(err instanceof ProfileResolutionError);
      assert.equal(err.dimension, 'genre');
      assert.equal(err.query, 'unknown_xyz');
      return true;
    }
  );

  assert.throws(
    () => defaultProfileRegistry.resolveCompositionSpec({
      genre: 'xuanhuan_cautious',
      style: 'nonexistent_style'
    }),
    (err) => {
      assert.ok(err instanceof ProfileResolutionError);
      assert.equal(err.dimension, 'style');
      return true;
    }
  );
});

test('R3 Suite 1.6: resolveCompositionSpec 在 allowUnresolved: true 时记录显式未决描述符', () => {
  const spec = defaultProfileRegistry.resolveCompositionSpec(
    { genre: 'unknown_xyz', style: 'custom_unregistered' },
    { allowUnresolved: true }
  );

  assert.equal(spec.genre.resolved, false);
  assert.equal(spec.genre.query, 'unknown_xyz');
  assert.equal(spec.genre.error, 'Unregistered profile');
  assert.equal(spec.profileModes.genre, 'unresolved');

  assert.equal(spec.style.resolved, false);
  assert.equal(spec.style.query, 'custom_unregistered');
  assert.equal(spec.profileModes.style, 'unresolved');
});

// ===========================================================================
// Suite 2: Profile Mode Tracking Across All 7 Dimensions (R3)
// ===========================================================================

test('R3 Suite 2.1: 全部显式指定 7 维时，profileModes 全量标记为 explicit', () => {
  const spec = defaultProfileRegistry.resolveCompositionSpec({
    genre: 'xuanhuan_cautious',
    style: 'laobai_restrained',
    chapterGoal: 'info_reveal',
    focus: 'dialogue_game',
    hook: 'suspense_clue',
    storyEngine: 'resource_competition',
    readerPromises: ['underdog_triumph']
  });

  assert.equal(spec.profileModes.genre, 'explicit');
  assert.equal(spec.profileModes.style, 'explicit');
  assert.equal(spec.profileModes.goal, 'explicit');
  assert.equal(spec.profileModes.chapterGoal, 'explicit');
  assert.equal(spec.profileModes.focus, 'explicit');
  assert.equal(spec.profileModes.hook, 'explicit');
  assert.equal(spec.profileModes.storyEngine, 'explicit');
  assert.equal(spec.profileModes.readerPromises, 'explicit');
  assert.equal(spec.profileModes.readerPromise, 'explicit');
});

test('R3 Suite 2.2: 缺省 storyEngine 与 readerPromises 时，自动推导标记为 inferred', () => {
  const spec = defaultProfileRegistry.resolveCompositionSpec({
    genre: 'urban_investigation',
    style: 'laobai_restrained',
    goal: 'info_reveal',
    focus: 'dialogue_game',
    hook: 'suspense_clue'
  });

  assert.equal(spec.profileModes.genre, 'explicit');
  assert.equal(spec.profileModes.style, 'explicit');
  assert.equal(spec.profileModes.goal, 'explicit');
  assert.equal(spec.profileModes.storyEngine, 'inferred');
  assert.equal(spec.profileModes.readerPromises, 'inferred');
  // 检查推导出来的引擎符合题材配置
  assert.equal(spec.storyEngine.id, 'mystery_unravelling');
});

test('R3 Suite 2.3: lockedDimensions 声明的维度标记为 locked', () => {
  const spec = defaultProfileRegistry.resolveCompositionSpec({
    genre: 'xuanhuan_cautious',
    style: 'laobai_restrained',
    chapterGoal: 'info_reveal',
    focus: 'dialogue_game',
    hook: 'suspense_clue',
    lockedDimensions: ['genre', 'style']
  });

  assert.equal(spec.profileModes.genre, 'locked');
  assert.equal(spec.profileModes.style, 'locked');
  assert.equal(spec.profileModes.goal, 'explicit');
  assert.equal(spec.profileModes.focus, 'explicit');
});

test('R3 Suite 2.4: adaptiveDimensions 声明的维度标记为 adaptive', () => {
  const spec = defaultProfileRegistry.resolveCompositionSpec({
    genre: 'xuanhuan_cautious',
    style: 'laobai_restrained',
    chapterGoal: 'info_reveal',
    focus: 'dialogue_game',
    hook: 'suspense_clue',
    adaptiveDimensions: ['focus', 'hook']
  });

  assert.equal(spec.profileModes.focus, 'adaptive');
  assert.equal(spec.profileModes.hook, 'adaptive');
  assert.equal(spec.profileModes.genre, 'explicit');
});

test('R3 Suite 2.5: spec.provenance 记录完整时间戳与冻结的 profileModes 元数据', () => {
  const spec = defaultProfileRegistry.resolveCompositionSpec({
    genre: 'scifi_hardcore',
    style: 'lyrical_minimalist',
    goal: 'conflict_push',
    focus: 'action_combat',
    hook: 'crisis_imminent'
  });

  assert.ok(spec.provenance !== undefined);
  assert.ok(typeof spec.provenance.resolvedAt === 'string');
  assert.equal(spec.provenance.registryVersion, 'composition-profile-registry-v2');
  assert.equal(spec.provenance.profileModes.genre, 'explicit');
  assert.equal(spec.provenance.profileModes.storyEngine, 'inferred');
  assert.ok(Object.isFrozen(spec.provenance));
  assert.ok(Object.isFrozen(spec.profileModes));
});

// ===========================================================================
// Suite 3: Standalone StoryEngineRegistry & Decoupling (R10)
// ===========================================================================

test('R10 Suite 3.1: StoryEngineRegistry 独立实例化并预装全部 10 个种子引擎', () => {
  const registry = new StoryEngineRegistry();
  const engines = registry.listStoryEngines();

  assert.equal(engines.length, 10);
  const ids = engines.map(e => e.id);
  assert.ok(ids.includes('resource_competition'));
  assert.ok(ids.includes('survival_evolution'));
  assert.ok(ids.includes('mystery_unravelling'));
  assert.ok(ids.includes('cat_and_mouse'));
  assert.ok(ids.includes('exploration'));
  assert.ok(ids.includes('crisis_mitigation'));
  assert.ok(ids.includes('political_intrigue'));
  assert.ok(ids.includes('dynastic_struggle'));
  assert.ok(ids.includes('growth_clash'));
  assert.ok(ids.includes('revenge_ladder'));
});

test('R10 Suite 3.2: getStoryEngine 按 ID 与中文名称双向准确解析', () => {
  const byId = defaultStoryEngineRegistry.getStoryEngine('mystery_unravelling');
  assert.ok(byId !== null);
  assert.equal(byId.id, 'mystery_unravelling');
  assert.equal(byId.name, '悬疑解构引擎');
  assert.equal(byId.driveMechanism, 'mystery');

  const byName = defaultStoryEngineRegistry.getStoryEngine('悬疑解构引擎');
  assert.ok(byName !== null);
  assert.equal(byName.id, 'mystery_unravelling');

  const bySub = defaultStoryEngineRegistry.getStoryEngine('猫鼠博弈');
  assert.ok(bySub !== null);
  assert.equal(bySub.id, 'cat_and_mouse');
});

test('R10 Suite 3.3: getStoryEngine 未知查询返回 null，strict 模式抛错', () => {
  assert.equal(defaultStoryEngineRegistry.getStoryEngine('nonexistent_engine'), null);
  assert.equal(defaultStoryEngineRegistry.getStoryEngine(''), null);

  assert.throws(
    () => defaultStoryEngineRegistry.getStoryEngine('nonexistent_engine', { strict: true }),
    (err) => {
      assert.ok(err instanceof ProfileResolutionError);
      assert.equal(err.dimension, 'storyEngine');
      assert.equal(err.query, 'nonexistent_engine');
      assert.ok(err.available.length >= 10);
      return true;
    }
  );
});

test('R10 Suite 3.4: 故事引擎动态热注册与查询检索', () => {
  const custom = createStoryEngineProfile({
    id: 'cyber_heist',
    name: '赛博大劫案引擎',
    driveMechanism: 'conquest',
    corePacingRhythm: 'burst_release',
    typicalObstacles: ['网络防火墙', '企业雇佣军'],
    primaryPayoffType: 'data_liberation'
  });

  const registry = new StoryEngineRegistry();
  registry.registerStoryEngine(custom);

  assert.equal(registry.hasStoryEngine('cyber_heist'), true);
  const fetched = registry.getStoryEngine('赛博大劫案引擎');
  assert.equal(fetched.id, 'cyber_heist');
  assert.equal(fetched.primaryPayoffType, 'data_liberation');
});

test('R10 Suite 3.5: 跨题材正交组合：凡人修真题材解耦搭载猫鼠博弈故事引擎', () => {
  const spec = defaultProfileRegistry.resolveCompositionSpec({
    genre: 'xuanhuan_cautious', // 凡人谨慎修真题材
    storyEngine: 'cat_and_mouse', // 猫鼠博弈引擎（非玄幻默认引擎）
    style: 'laobai_restrained',
    goal: 'info_reveal',
    focus: 'dialogue_game',
    hook: 'suspense_clue'
  });

  // 第一公民 StoryEngine 实体
  assert.equal(spec.storyEngine.id, 'cat_and_mouse');
  assert.equal(spec.storyEngine.name, '猫鼠博弈引擎');
  assert.equal(spec.storyEngine.driveMechanism, 'competition');

  // 向后兼容字段
  assert.equal(spec.derived.storyEngine, 'cat_and_mouse');
  assert.equal(spec.profileModes.storyEngine, 'explicit');
});

// ===========================================================================
// Suite 4: Standalone ReaderPromiseRegistry & Decoupling (R10)
// ===========================================================================

test('R10 Suite 4.1: ReaderPromiseRegistry 独立实例化并预装全部 9 个种子阅读契约', () => {
  const registry = new ReaderPromiseRegistry();
  const promises = registry.listReaderPromises();

  assert.equal(promises.length, 9);
  const ids = promises.map(p => p.id);
  assert.ok(ids.includes('underdog_triumph'));
  assert.ok(ids.includes('cautious_growth'));
  assert.ok(ids.includes('solid_development'));
  assert.ok(ids.includes('defense_counterattack'));
  assert.ok(ids.includes('clue_closure'));
  assert.ok(ids.includes('rational_intelligence'));
  assert.ok(ids.includes('truth_uncover'));
  assert.ok(ids.includes('grand_vision'));
  assert.ok(ids.includes('political_chess'));
});

test('R10 Suite 4.2: getReaderPromise 按 ID、中文名与别名准确解析', () => {
  const byId = defaultReaderPromiseRegistry.getReaderPromise('underdog_triumph');
  assert.ok(byId !== null);
  assert.equal(byId.id, 'underdog_triumph');
  assert.equal(byId.name, '以弱胜强');

  const byName = defaultReaderPromiseRegistry.getReaderPromise('以弱胜强');
  assert.equal(byName.id, 'underdog_triumph');

  const byAlias = defaultReaderPromiseRegistry.getReaderPromise('逻辑严密');
  assert.equal(byAlias.id, 'rational_intelligence');
});

test('R10 Suite 4.3: resolveReaderPromises 批量解析混合 ID 与中文名称集合', () => {
  const resolved = defaultReaderPromiseRegistry.resolveReaderPromises([
    'underdog_triumph',
    '线索闭环',
    '水落石出'
  ]);

  assert.equal(resolved.length, 3);
  assert.equal(resolved[0].id, 'underdog_triumph');
  assert.equal(resolved[1].id, 'clue_closure');
  assert.equal(resolved[2].id, 'truth_uncover');
  assert.ok(resolved[0].schemaVersion === 'reader-promise-profile-v1');
});

test('R10 Suite 4.4: getReaderPromise 未知查询在 strict: true 时严格抛错', () => {
  assert.equal(defaultReaderPromiseRegistry.getReaderPromise('nonexistent_promise'), null);

  assert.throws(
    () => defaultReaderPromiseRegistry.getReaderPromise('nonexistent_promise', { strict: true }),
    (err) => {
      assert.ok(err instanceof ProfileResolutionError);
      assert.equal(err.dimension, 'readerPromises');
      assert.equal(err.query, 'nonexistent_promise');
      assert.ok(err.available.length >= 9);
      return true;
    }
  );
});

test('R10 Suite 4.5: 读者契约动态热注册与集合解析', () => {
  const customPromise = createReaderPromiseProfile({
    id: 'deep_decompression',
    name: '深度解压治愈',
    coreExpectation: '在快节奏疲惫中获得情绪抚慰',
    payoffPacing: 'steady_accumulation',
    gapGenerationMechanism: 'next_comfort_scene',
    emotionalPayoff: 'warmth'
  });

  const registry = new ReaderPromiseRegistry();
  registry.registerReaderPromise(customPromise);

  const found = registry.getReaderPromise('深度解压治愈');
  assert.equal(found.id, 'deep_decompression');

  const list = registry.resolveReaderPromises(['deep_decompression', 'underdog_triumph']);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, 'deep_decompression');
  assert.equal(list[1].id, 'underdog_triumph');
});

// ===========================================================================
// Suite 5: Downstream Consumer Verification & Full Pipeline Integrity
// ===========================================================================

test('Suite 5.1: compileChapterStrategy 接受第一公民 storyEngine 与 readerPromises 并生成合法 StrategyIR', () => {
  const spec = defaultProfileRegistry.resolveCompositionSpec({
    genre: 'xuanhuan_cautious',
    style: 'laobai_restrained',
    goal: 'info_reveal',
    focus: 'dialogue_game',
    hook: 'suspense_clue',
    storyEngine: 'survival_evolution',
    readerPromises: ['underdog_triumph', 'defense_counterattack']
  });

  const compiled = compileChapterStrategy({
    spec,
    bible: { title: '太虚道录', worldRuleSummary: '灵气枯竭，生死一线' },
    chapterContract: { pov: '第三人称限制视角' },
    chapterContext: '前情提要：主角潜伏于黑风谷。'
  });

  assert.ok(compiled.strategyIR !== undefined);
  assert.equal(compiled.digest.length, 64); // SHA-256
  assert.equal(compiled.strategyIR.irDigest.length, 64);
  assert.ok(compiled.strategyIR.bookIdentity.storyEngine !== undefined);
  assert.ok(compiled.strategyIR.bookIdentity.readerPromises.length >= 2);
  assert.ok(compiled.priorityCascade.P0_HARD_CONSTRAINTS.length > 0);
});

test('Suite 5.2: evaluateCompatibility 评估包含第一公民 storyEngine 的协同效果', () => {
  const spec = defaultProfileRegistry.resolveCompositionSpec({
    genre: 'urban_investigation',
    style: 'laobai_restrained',
    goal: 'info_reveal',
    focus: 'dialogue_game',
    hook: 'suspense_clue',
    storyEngine: 'mystery_unravelling'
  });

  const result = evaluateCompatibility(spec);
  assert.equal(result.isCompatible, true);
  assert.ok(result.score !== undefined);
  assert.ok(Array.isArray(result.observations));
  assert.ok(result.observations.some(o => o.includes('悬疑') || o.includes('引擎')));
});

test('Suite 5.3: contentEngine.compileDraftPrompt 完整兼容增强版 CompositionSpec', () => {
  const spec = defaultProfileRegistry.resolveCompositionSpec({
    genre: 'ancient_court',
    style: 'laobai_restrained',
    goal: 'conflict_push',
    focus: 'dialogue_game',
    hook: 'crisis_imminent',
    storyEngine: 'political_intrigue',
    readerPromises: ['political_chess']
  });

  const promptResult = contentEngine.compileDraftPrompt({
    compositionSpec: spec,
    context: '前情提要：朝堂大理寺对峙。',
    contract: { chapterGoal: '冲突推进', wordBudget: { targetChars: 3000 } }
  });

  assert.ok(promptResult.systemPrompt.includes('【题材策略·历史古代权谋】'));
  assert.ok(promptResult.systemPrompt.includes('【文风质感策略·老白冷硬克制】'));
  assert.equal(promptResult.effectiveGenre, '历史古代权谋');
  assert.equal(promptResult.wordBudget.target, 3000);
});
