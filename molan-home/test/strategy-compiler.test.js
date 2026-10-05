'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { defaultProfileRegistry } = require('../lib/composition/profiles/profile-registry');
const { evaluateCompatibility } = require('../lib/composition/compiler/compatibility-matrix');
const { tierAttention } = require('../lib/composition/compiler/attention-tiering');
const { compileChapterStrategy } = require('../lib/composition/compiler/strategy-compiler');

test('Strategy Compiler: 兼容性矩阵对张力组合输出建议且不阻断', () => {
  const spec = defaultProfileRegistry.resolveCompositionSpec({
    genre: 'xuanhuan_cautious',
    style: 'lyrical_minimalist', // 清冷写意
    chapterGoal: 'conflict_push',   // 激烈冲突
    focus: 'action_combat',        // 动作搏杀
    hook: 'crisis_imminent'
  });

  const compat = evaluateCompatibility(spec);
  assert.equal(compat.isCompatible, true);
  assert.equal(compat.status, 'compatible_with_adjustment');
  assert.ok(compat.observations.length >= 1);
  assert.ok(compat.recommendedModulation !== null);
  // 建议提升短句比与情绪浓度以适配冲突
  assert.ok(compat.recommendedModulation.shortSentenceRatio > 0);
  assert.ok(compat.recommendedModulation.emotionalIntensity > 0);
});

test('Strategy Compiler: 注意力分级打包与 Token 监控', () => {
  const attention = tierAttention({
    permanentContext: '世界观规则：修仙无情，灵气枯竭',
    chapterStrategy: '本章策略指令',
    evidenceCards: [
      { name: '卡片1', rule: '白描动作', pattern: '受力形变', evidenceStrength: 'A' },
      { name: '卡片2', rule: '对白交错', pattern: '微表情反差', evidenceStrength: 'B' },
      { name: '劣质卡', rule: '偶然现象', pattern: '单章特例', evidenceStrength: 'D' } // 应该被过滤
    ],
    immediateContext: '主角站在大殿之外',
    maxTotalTokens: 4000
  });

  assert.equal(attention.metrics.selectedCardCount, 2); // 仅 A、B 级被选中
  assert.ok(attention.metrics.withinBudget);
  assert.ok(attention.tier3Evidence.includes('卡片1'));
  assert.ok(attention.tier3Evidence.includes('卡片2'));
  assert.ok(!attention.tier3Evidence.includes('劣质卡'));
});

test('Strategy Compiler: 完整编译输出 P0~P8 优先级梯队并保持确定性', () => {
  const spec = defaultProfileRegistry.resolveCompositionSpec({
    genre: 'xuanhuan_cautious',
    style: 'laobai_restrained',
    chapterGoal: 'info_reveal',
    focus: 'dialogue_game',
    hook: 'suspense_clue',
    targetChars: 3000,
    userInstruction: '本章主角必须在对话中故意示弱，诱使对方说漏嘴。'
  });

  const compiled = compileChapterStrategy({
    spec,
    bible: { title: '太虚道录', worldRuleSummary: '宗门割据，长生为虚' },
    chapterContract: {
      forbiddenKnowledge: ['幕后黑手的真实境界'],
      pov: '第三人称限制视角（主角）'
    },
    chapterContext: '前情提要：主角潜入外门坊市茶楼。',
    evidenceCards: [
      { rule: '用物证细节引爆悬念', failureMode: '直接旁白宣布答案', evidenceStrength: 'A' }
    ]
  });

  // 1. 验证优先级阶梯完整性
  const p = compiled.priorityCascade;
  assert.ok(p.P0_HARD_CONSTRAINTS.includes('基准 3000 字'));
  assert.ok(p.P0_HARD_CONSTRAINTS.includes('幕后黑手的真实境界'));
  assert.ok(p.P1_USER_DIRECTIVE.includes('故意示弱'));
  assert.ok(p.P2_CREATION_BIBLE.includes('宗门割据'));
  assert.ok(p.P3_CHAPTER_OBJECTIVE.includes('【本章核心目标·信息揭露】'));
  assert.ok(p.P4_GENRE_POLICY.includes('【题材策略·凡人谨慎修真】'));
  assert.ok(p.P5_STYLE_POLICY.includes('【文风质感策略·老白冷硬克制】'));
  assert.ok(p.P6_FOCUS_BUDGET.includes('【本章镜头与笔墨预算分配·对话机锋博弈】'));
  assert.ok(p.P7_HOOK_POLICY.includes('【本章钩子策略·物证异样悬念钩】'));
  assert.ok(p.P8_EVIDENCE.includes('直接旁白宣布答案'));

  // 2. 验证系统提示词与用户提示词结构
  assert.ok(compiled.systemPrompt.includes('【P0 绝对事实与物理围栏'));
  assert.ok(compiled.userPrompt.includes('【P1 用户明确不可变指令'));
  assert.ok(compiled.userPrompt.includes('故意示弱'));

  // 3. 验证确定性编译（相同输入产生相同摘要哈希）
  const compiledAgain = compileChapterStrategy({
    spec,
    bible: { title: '太虚道录', worldRuleSummary: '宗门割据，长生为虚' },
    chapterContract: {
      forbiddenKnowledge: ['幕后黑手的真实境界'],
      pov: '第三人称限制视角（主角）'
    },
    chapterContext: '前情提要：主角潜入外门坊市茶楼。',
    evidenceCards: [
      { rule: '用物证细节引爆悬念', failureMode: '直接旁白宣布答案', evidenceStrength: 'A' }
    ]
  });

  assert.equal(compiled.digest, compiledAgain.digest);
});
