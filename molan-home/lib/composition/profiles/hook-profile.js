'use strict';

/**
 * @file hook-profile.js
 * 章节钩子核心 Profile 契约模型 (Hook Profile)
 * 
 * 核心设计原则：
 * 1. 拆分钩子位置 (开篇/幕中/章末) 与多维度缺口 (信息差/危机差/情绪差/期待差)；
 * 2. 引入【兑现周期 (payoff_horizon)】，避免章章无脑高频疲劳轰炸；
 * 3. 深度联动 Molan 现有因果债务系统 (Causal Debt / Hook Debt Manager)。
 */

const HOOK_TYPES = Object.freeze([
  'crisis',        // 危机钩：强敌压境、生死千钧一发
  'suspense',      // 悬念钩：物证异样、未解之谜、颠覆认知
  'twist',         // 反转钩：胜局变杀局、盟友倒戈、规则更迭
  'anticipation',  // 期待钩：明日大比、突破在即、全场瞩目
  'emotional'      // 情感钩：防线失守、决裂或羁绊升华
]);

const GAP_TYPES = Object.freeze([
  'danger_gap',       // 生存与危险缺口
  'information_gap',  // 知识与真相缺口
  'expectation_gap',  // 认知与结果预期缺口
  'emotional_gap'     // 情感与态度缺口
]);

/**
 * 校验并规范化兑现周期
 * @param {Object|string} rawHorizon
 * @returns {Object} 规范化兑现周期对象
 */
function normalizePayoffHorizon(rawHorizon) {
  if (typeof rawHorizon === 'string') {
    switch (rawHorizon) {
      case 'immediate':
      case 'short':
        return { span: 'short', minChapters: 1, maxChapters: 2, label: '短钩子 (1~2章内兑现)' };
      case 'medium':
        return { span: 'medium', minChapters: 3, maxChapters: 6, label: '中钩子 (3~6章内回收)' };
      case 'long':
        return { span: 'long', minChapters: 10, maxChapters: 30, label: '长线大钩 (大单元卷末兑现)' };
      default:
        return { span: 'short', minChapters: 1, maxChapters: 2, label: '短钩子 (1~2章内兑现)' };
    }
  }

  const input = rawHorizon || {};
  const min = Math.max(1, Number(input.minChapters) || 1);
  const max = Math.max(min, Number(input.maxChapters) || 3);
  return {
    span: max <= 2 ? 'short' : (max <= 8 ? 'medium' : 'long'),
    minChapters: min,
    maxChapters: max,
    label: `${min}~${max}章内兑现`
  };
}

/**
 * 创建合规的 HookProfile 实体
 * @param {Object} options
 * @returns {Object} 冻结的 HookProfile 实体
 */
function createHookProfile(options = {}) {
  const input = options || {};
  const id = String(input.id || '').trim();
  const name = String(input.name || '').trim();
  const type = HOOK_TYPES.includes(input.type) ? input.type : 'suspense';

  if (!id) throw new TypeError('HookProfile 必须具备唯一 id');
  if (!name) throw new TypeError('HookProfile 必须具备人类可读 name');

  const placement = ['opening', 'mid_chapter', 'ending'].includes(input.placement)
    ? input.placement
    : 'ending';
  const gapType = GAP_TYPES.includes(input.gapType) ? input.gapType : 'information_gap';
  const strength = Math.max(0.1, Math.min(1.0, Number(input.strength) || 0.75));
  const payoffHorizon = normalizePayoffHorizon(input.payoffHorizon);

  const profile = {
    schemaVersion: 'hook-profile-v1',
    id,
    name,
    type,
    placement,
    gapType,
    strength,
    payoffHorizon,
    directiveTemplate: String(input.directiveTemplate || ''),
    exampleSnippet: String(input.exampleSnippet || ''),
    description: String(input.description || ''),
    metadata: typeof input.metadata === 'object' && input.metadata !== null ? { ...input.metadata } : {}
  };

  return Object.freeze(profile);
}

/**
 * 构造用于存入 Molan 因果债管理器的注册载荷
 * @param {Object} profile 
 * @param {Object} chapterContext
 * @returns {Object} Causal Debt 载荷对象
 */
function toCausalDebtRegistration(profile, chapterContext = {}) {
  if (!profile) return null;
  return {
    debtId: `hook_debt_${Date.now()}_${profile.id}`,
    chapterId: String(chapterContext.chapterId || ''),
    hookId: profile.id,
    hookType: profile.type,
    gapType: profile.gapType,
    strength: profile.strength,
    createdChapterNo: Number(chapterContext.chapterNo) || 1,
    targetPayoffChapterNo: (Number(chapterContext.chapterNo) || 1) + profile.payoffHorizon.maxChapters,
    payoffHorizon: profile.payoffHorizon,
    status: 'active',
    clueOrIncident: String(chapterContext.clue || chapterContext.summary || profile.exampleSnippet || '')
  };
}

/**
 * 编译钩子策略指令块 (Hook Policy Directive)
 * @param {Object} profile 
 * @param {Object} debtContext 当前已有因果债上下文
 * @returns {string}
 */
function compileHookPolicy(profile, debtContext = null) {
  if (!profile) return '';
  const posText = profile.placement === 'ending' ? '章末收尾' : (profile.placement === 'opening' ? '开篇破局' : '幕间转折');
  
  const lines = [
    `【本章钩子策略·${profile.name}】（位置：${posText} | 强度：${(profile.strength * 100).toFixed(0)}%）`,
    `缺口类型：${profile.gapType} | 预期兑现周期：${profile.payoffHorizon.label}`,
    profile.directiveTemplate ? `执行要求：${profile.directiveTemplate}` : '',
    profile.exampleSnippet ? `示范范例：${profile.exampleSnippet}` : '',
    debtContext && debtContext.clueOrIncident ? `【联动因果债】：本钩子必须绑定线索【${debtContext.clueOrIncident}】` : ''
  ].filter(Boolean);

  return lines.join('\n');
}

module.exports = {
  createHookProfile,
  normalizePayoffHorizon,
  toCausalDebtRegistration,
  compileHookPolicy,
  HOOK_TYPES,
  GAP_TYPES
};
