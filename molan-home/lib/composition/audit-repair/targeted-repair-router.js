'use strict';

/**
 * @file targeted-repair-router.js
 * 审计维度到定向微创修复策略路由引擎 (Targeted Repair Router)
 * 
 * 核心设计原则：
 * 1. 彻底根除“单点缺陷导致整章推倒重写”的严重浪费与剧情漂移；
 * 2. 建立精准的 Audit Dimension -> Repair Strategy 映射矩阵：
 *    - Style fail     -> 仅针对句式僵硬或修辞偏离段落做局部文风微调
 *    - Hook fail      -> 仅针对末尾 1~2 段重构缺口与张力
 *    - Fact fail      -> 仅针对物证/时间/知识违背的精确语句打局部补丁
 *    - AI flavor fail -> 触发微创手术物理替换或局部修辞重写
 *    - Goal fail      -> 定位核心转折段落重写关键抉择，保留其余上下文
 */

const REPAIR_STRATEGIES = Object.freeze({
  STYLE_LOCAL_REWRITE: 'style_local_rewrite',
  HOOK_TAIL_RECONSTRUCT: 'hook_tail_reconstruct',
  FACT_SURGICAL_PATCH: 'fact_surgical_patch',
  AI_FLAVOR_SURGICAL_REPLACE: 'ai_flavor_surgical_replace',
  GOAL_BEAT_REWRITE: 'goal_beat_rewrite',
  WORD_BUDGET_ADJUST: 'word_budget_adjust'
});

/**
 * 根据审计发现的 Issue 路由到最精简的微创修复策略
 * @param {Object} issue 审计阻断项对象
 * @param {string} draft 当前草稿正文
 * @param {Object} context 上下文与章节合同
 * @returns {Object} 定向修复指令包
 */
function routeRepairStrategy(issue = {}, draft = '', context = {}) {
  const content = String(draft || '');
  const dimension = String(issue.dimension || issue.category || '').toLowerCase();
  const quote = String(issue.quote || issue.evidence || '').trim();

  // 1. 钩子缺陷 -> 仅修章末收束
  if (dimension.includes('hook') || dimension.includes('ending')) {
    const tailStart = Math.max(0, content.length - 400);
    const tailWindow = content.slice(tailStart);
    return {
      strategy: REPAIR_STRATEGIES.HOOK_TAIL_RECONSTRUCT,
      scope: 'tail_window',
      targetWindow: { quote: tailWindow, start: tailStart, end: content.length },
      repairInstruction: '保持前文全部剧情与动作事实不变，仅重新撰写最后 1~2 段收尾。必须依照钩子策略，以具体的未解之谜、物证异样或突发危机收束，留下强烈的阅读悬念。',
      requiresFullRegeneration: false
    };
  }

  // 2. AI 笔调套路缺陷 -> 微创修辞替换
  if (dimension.includes('ai_flavor') || dimension.includes('flavor') || dimension.includes('cliche')) {
    return {
      strategy: REPAIR_STRATEGIES.AI_FLAVOR_SURGICAL_REPLACE,
      scope: 'phrase_replacement',
      targetWindow: { quote, start: quote ? content.indexOf(quote) : -1 },
      repairInstruction: `将套路词句【${quote}】改写为符合当前文风的具体动作或器物物理受力描写，严禁使用任何模板化套话。`,
      requiresFullRegeneration: false
    };
  }

  // 3. 事实冲突或禁载知识泄露 -> 微创局部补丁
  if (dimension.includes('fact') || dimension.includes('knowledge') || dimension.includes('pov')) {
    const quoteIndex = quote ? content.indexOf(quote) : -1;
    let windowText = quote;
    if (quoteIndex !== -1) {
      const start = Math.max(0, quoteIndex - 60);
      const end = Math.min(content.length, quoteIndex + quote.length + 60);
      windowText = content.slice(start, end);
    }
    return {
      strategy: REPAIR_STRATEGIES.FACT_SURGICAL_PATCH,
      scope: 'surgical_patch',
      targetWindow: { quote: windowText, start: quoteIndex },
      repairInstruction: `修复语句中的事实矛盾或视点越界：严禁泄露禁载知识【${issue.problem || ''}】，仅替换冲突语句，严禁篡改窗口外的事实。`,
      requiresFullRegeneration: false
    };
  }

  // 4. 文风或句式方差不足 -> 段落级文风调制
  if (dimension.includes('style') || dimension.includes('language') || dimension.includes('rhythm')) {
    return {
      strategy: REPAIR_STRATEGIES.STYLE_LOCAL_REWRITE,
      scope: 'paragraph_stylometry',
      targetWindow: { quote },
      repairInstruction: '调整目标段落的句长方差与对白穿插微动作，遵循【动作-对白交错律】，消除单调排比或大段干瘪旁白。',
      requiresFullRegeneration: false
    };
  }

  // 5. 核心目标未达成 -> 针对性转折幕重写
  if (dimension.includes('goal') || dimension.includes('causality')) {
    return {
      strategy: REPAIR_STRATEGIES.GOAL_BEAT_REWRITE,
      scope: 'core_beat',
      targetWindow: { quote },
      repairInstruction: `重新落实本章未达成的状态跃迁：必须交代出【${issue.problem || '关键因果变化'}】，让章后状态不可逆地推进。`,
      requiresFullRegeneration: false
    };
  }

  // 默认兜底：局部微创修复
  return {
    strategy: REPAIR_STRATEGIES.FACT_SURGICAL_PATCH,
    scope: 'localized_default',
    targetWindow: { quote },
    repairInstruction: `针对问题【${issue.problem || '特定缺陷'}】执行定向局部改写，保持其余剧情上下文不变。`,
    requiresFullRegeneration: false
  };
}

module.exports = {
  routeRepairStrategy,
  REPAIR_STRATEGIES
};
