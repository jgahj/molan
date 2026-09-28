'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateClimaxShockGate,
  runGenreNarrativeAudits,
  generateMicroPatchPrompt
} = require('../lib/genre-narrative-audit');
const { applyHunkPatch } = require('../lib/pipeline-coordinator');

test('OPT-AUDIT-001: 叙事质感门禁拦截与微补丁提示词生成 (DEF-DESC-001)', () => {
  // 缺乏物理受力特写的高潮场景 (点到即止)
  const weakScene = '神灵大手从虚空按下。张若尘笑了笑，收起长剑转身离开。';
  const auditRes = evaluateClimaxShockGate(weakScene, { isClimax: true, intensity: 8 }, '玄幻修真');

  assert.equal(auditRes.passed, false);
  assert.equal(auditRes.issue.category, 'emotional_climax');

  // 生成微补丁修饰指令
  const patchPrompt = generateMicroPatchPrompt(auditRes, weakScene, '玄幻修真');
  assert.equal(patchPrompt.required, true);
  assert.equal(patchPrompt.targetCategory, 'emotional_climax');
  assert.ok(patchPrompt.promptDirective.includes('DEF-DESC-001'));
  assert.ok(patchPrompt.promptDirective.includes('骨骼受力微鸣') || patchPrompt.promptDirective.includes('物理受力'));
});

test('OPT-AUDIT-001: 门禁合格场景零补丁放行', () => {
  const robustScene = '神灵大手横压而下，青石地面寸寸崩碎。张若尘骨骼微鸣，嘴角溢血，暴退三步！满座皆惊，全场死寂！';
  const auditRes = evaluateClimaxShockGate(robustScene, { isClimax: true, intensity: 8 }, '玄幻修真');

  assert.equal(auditRes.passed, true);
  const patchPrompt = generateMicroPatchPrompt(auditRes, robustScene, '玄幻修真');
  assert.equal(patchPrompt.required, false);
  assert.equal(patchPrompt.promptDirective, null);
});

test('OPT-AUDIT-001 + OPT-ARCH-001: 闭环自愈流水线联动 (Audit -> MicroPatch -> HunkPatch -> Pass)', () => {
  let draft = '虚空崩塌。张若尘笑了笑，自称是地姥女婿，随后离开。';

  // 1. 初次后置质检拦截
  const firstAudit = evaluateClimaxShockGate(draft, { isClimax: true, intensity: 8 }, '玄幻修真');
  assert.equal(firstAudit.passed, false);

  // 2. 触发微补丁生成
  const patchPrompt = generateMicroPatchPrompt(firstAudit, draft, '玄幻修真');
  assert.equal(patchPrompt.required, true);

  // 3. 执行局部增量 Hunk 补丁替换（无需全书3000字重写）
  const patchResult = applyHunkPatch(draft, {
    searchSnippet: '张若尘笑了笑，自称是地姥女婿',
    replacementSnippet: '神灵威压如十万大山倾塌，地面寸寸龟裂。张若尘骨骼微鸣，嘴角溢血暴退三步，暗自调息平复狂跳的心脏，强撑着冷笑道：“天阁目的夫婿可不是好惹的！”'
  });

  assert.equal(patchResult.success, true);
  draft = patchResult.patchedText;

  // 4. 二次复验门禁：完美放行！
  const secondAudit = evaluateClimaxShockGate(draft, { isClimax: true, intensity: 8 }, '玄幻修真');
  assert.equal(secondAudit.passed, true);
});
