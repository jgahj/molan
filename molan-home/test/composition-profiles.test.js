'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createGenreProfile, checkForbiddenAssumptions, compileGenrePolicy } = require('../lib/composition/profiles/genre-profile');
const { createStyleProfile, modulateStyle, normalizeStyleVector, compileStylePolicy } = require('../lib/composition/profiles/style-profile');
const { createChapterGoalProfile, normalizeStateDelta, compileGoalPolicy } = require('../lib/composition/profiles/chapter-goal-profile');
const { createFocusProfile, normalizeBudgetWeights, calculateCharacterBudgets, compileFocusPolicy } = require('../lib/composition/profiles/focus-profile');
const { createHookProfile, normalizePayoffHorizon, toCausalDebtRegistration, compileHookPolicy } = require('../lib/composition/profiles/hook-profile');
const { defaultProfileRegistry, ProfileRegistry } = require('../lib/composition/profiles/profile-registry');

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
