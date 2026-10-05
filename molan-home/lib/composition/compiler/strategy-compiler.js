'use strict';

/**
 * @file strategy-compiler.js
 * 创作策略编译器 (Creation Strategy Compiler)
 * 
 * 核心架构定位：
 * 1. 替代脆弱且易漂移的“万能长 Prompt 模板”，作为工业化提示词编译器；
 * 2. 接收 CompositionSpec、创作圣经、章节合同与实时语料证据，编译出具有 P0~P8 严格优先级梯队的策略指令；
 * 3. 严格遵循【注意力分层】与【确定性编译】纪律：相同输入必定产出相同策略。
 */

const crypto = require('node:crypto');
const { compileGenrePolicy } = require('../profiles/genre-profile');
const { compileStylePolicy } = require('../profiles/style-profile');
const { compileGoalPolicy } = require('../profiles/chapter-goal-profile');
const { compileFocusPolicy } = require('../profiles/focus-profile');
const { compileHookPolicy } = require('../profiles/hook-profile');
const { evaluateCompatibility } = require('./compatibility-matrix');
const { tierAttention } = require('./attention-tiering');

function sha256(val) {
  return crypto.createHash('sha256').update(String(val || ''), 'utf8').digest('hex');
}

/**
 * 编译章节创作策略 (Compile Chapter Creation Strategy)
 * @param {Object} params
 * @returns {Object} 编译好的分级提示词结构体
 */
function compileChapterStrategy(params = {}) {
  const {
    spec,
    bible = null,
    chapterContract = {},
    chapterContext = '',
    evidenceCards = [],
    debtContext = null,
    options = {}
  } = params;

  if (!spec || typeof spec !== 'object') {
    throw new TypeError('compileChapterStrategy 需要有效的 CompositionSpec');
  }

  // 1. 兼容性矩阵评估与自适应调制参数获取
  const compatibility = evaluateCompatibility(spec);
  const effectiveModulation = spec.localStyleModulation || compatibility.recommendedModulation || null;

  // 2. 提取并计算字数预算
  const targetChars = Number(spec.targetChars || chapterContract.wordBudget?.targetChars || 3000);
  const minChars = Number(chapterContract.wordBudget?.minChars || Math.round(targetChars * 0.85));
  const maxChars = Number(chapterContract.wordBudget?.maxChars || Math.round(targetChars * 1.15));

  // 3. 构建 P0 ~ P8 优先级阶梯块 (Priority Cascade)
  const cascade = {};

  // P0: 绝对事实与物理围栏
  const forbiddenKnowledge = Array.isArray(chapterContract.forbiddenKnowledge) && chapterContract.forbiddenKnowledge.length
    ? `\n· 本章绝对禁载泄露知识：${chapterContract.forbiddenKnowledge.join('、')}`
    : '';
  const povText = spec.derived?.narrativePov || chapterContract.pov || '第三人称限制视角';
  cascade.P0_HARD_CONSTRAINTS = [
    '【P0 绝对事实与物理围栏（最高指令，不得违反）】',
    `· 篇幅字数硬性预算：基准 ${targetChars} 字（允许范围：${minChars} ~ ${maxChars} 字）`,
    `· 叙事视角准则：${povText}（严禁全知越界，严禁旁白窥探非视点角色内心）`,
    forbiddenKnowledge,
    '· 只写原创小说正文，严禁输出任何大纲、总结、问候语或解释性旁白。'
  ].filter(Boolean).join('\n');

  // P1: 用户明确指令
  cascade.P1_USER_DIRECTIVE = spec.userInstruction
    ? `【P1 用户明确不可变指令（高于常规模板规则）】\n${spec.userInstruction}`
    : '【P1 用户明确指令】\n紧扣当前章节任务推进，以现场因果为第一驱动力。';

  // P2: 创作圣经
  const bibleSummary = bible && typeof bible === 'object'
    ? `世界底层运行法则：${bible.worldRuleSummary || bible.title || '统一世界观'} | 核心受众基调：${bible.audience || '大众'}`
    : '';
  cascade.P2_CREATION_BIBLE = bibleSummary
    ? `【P2 创作圣经·全局基因】\n${bibleSummary}`
    : '';

  // P3: 本章核心目标与状态跃迁
  cascade.P3_CHAPTER_OBJECTIVE = compileGoalPolicy(spec.chapterGoal, spec.stateDelta);

  // P4: 题材叙事契约
  cascade.P4_GENRE_POLICY = compileGenrePolicy(spec.genre);

  // P5: 文风策略与局部调制
  cascade.P5_STYLE_POLICY = compileStylePolicy(spec.style, effectiveModulation);

  // P6: 镜头与笔墨预算分配
  cascade.P6_FOCUS_BUDGET = compileFocusPolicy(spec.focus, targetChars);

  // P7: 结尾钩子与因果债务
  cascade.P7_HOOK_POLICY = compileHookPolicy(spec.hook, debtContext);

  // P8: 因子化参考策略卡与失败模式反例
  const cards = Array.isArray(evidenceCards) ? evidenceCards : [];
  cascade.P8_EVIDENCE = cards.length
    ? `【P8 语料策略示范与警戒】\n${cards.slice(0, 3).map(c => `· 规则：${c.rule || ''}\n· 警戒反例：${c.failureMode || ''}`).join('\n\n')}`
    : '';

  // 4. 注意力分级打包 (Attention Tiering)
  const systemBlocks = [
    cascade.P0_HARD_CONSTRAINTS,
    cascade.P4_GENRE_POLICY,
    cascade.P5_STYLE_POLICY,
    cascade.P6_FOCUS_BUDGET,
    cascade.P7_HOOK_POLICY,
    '【镜头摄像机执行准则】：遵循【动作-对白交错律】（每句关键台词必须穿插对方微表情或微动作），严禁空洞套话，严禁角色内心自报家门。'
  ].filter(Boolean).join('\n\n');

  const userBlocks = [
    '【前情与环境上下文】\n' + (typeof chapterContext === 'string' ? chapterContext : JSON.stringify(chapterContext)),
    cascade.P1_USER_DIRECTIVE,
    cascade.P3_CHAPTER_OBJECTIVE,
    cascade.P8_EVIDENCE
  ].filter(Boolean).join('\n\n');

  const attention = tierAttention({
    permanentContext: cascade.P2_CREATION_BIBLE,
    chapterStrategy: systemBlocks,
    evidenceCards,
    immediateContext: userBlocks,
    maxTotalTokens: options.maxTokens || 6000
  });

  const digest = sha256(systemBlocks + '\n---\n' + userBlocks);

  return Object.freeze({
    systemPrompt: systemBlocks,
    userPrompt: userBlocks,
    wordBudget: {
      target: targetChars,
      min: minChars,
      max: maxChars,
      summary: `${minChars} ~ ${maxChars} 字（基准 ${targetChars} 字）`
    },
    priorityCascade: Object.freeze(cascade),
    compatibility,
    attentionMetrics: attention.metrics,
    effectiveModulation,
    digest
  });
}

module.exports = {
  compileChapterStrategy
};
