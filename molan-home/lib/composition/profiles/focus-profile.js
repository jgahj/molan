'use strict';

/**
 * @file focus-profile.js
 * 章节侧重点核心 Profile 契约模型 (Focus Profile)
 * 
 * 核心设计原则：
 * 1. 彻底摆脱模糊的“侧重人物”空话，升级为【文字/镜头预算系统】；
 * 2. 7 维正交笔墨预算配比（归一化为 1.0），精确映射至目标字数区间；
 * 3. 产出强量化的篇幅与精力分配策略（Focus Budget Policy）。
 */

const FOCUS_BUDGET_KEYS = Object.freeze([
  'conflict',       // 矛盾与冲突对抗
  'character',      // 人物塑造与言行特质
  'emotion',        // 情绪暗涌与心理波动
  'dialogue',       // 对话机锋与言语博弈
  'setting',        // 环境白描与空间氛围
  'action',         // 动作物理受力与微动作
  'foreshadowing'   // 伏笔线索与因果暗线
]);

const DEFAULT_BUDGET_WEIGHTS = Object.freeze({
  conflict: 0.20,
  character: 0.20,
  emotion: 0.15,
  dialogue: 0.20,
  setting: 0.10,
  action: 0.10,
  foreshadowing: 0.05
});

/**
 * 校验并将输入预算权重严格归一化（总和为 1.0）
 * @param {Object} rawWeights 
 * @returns {Object} 归一化后的权重对象
 */
function normalizeBudgetWeights(rawWeights = null) {
  if (!rawWeights || typeof rawWeights !== 'object' || Object.keys(rawWeights).length === 0) {
    return { ...DEFAULT_BUDGET_WEIGHTS };
  }

  const input = rawWeights;
  let sum = 0;
  const sanitized = {};

  for (const key of FOCUS_BUDGET_KEYS) {
    const w = Number(input[key]);
    sanitized[key] = Number.isFinite(w) && w >= 0 ? w : 0;
    sum += sanitized[key];
  }

  if (sum <= 0) {
    return { ...DEFAULT_BUDGET_WEIGHTS };
  }

  const normalized = {};
  for (const key of FOCUS_BUDGET_KEYS) {
    normalized[key] = Number((sanitized[key] / sum).toFixed(4));
  }

  return Object.freeze(normalized);
}

/**
 * 根据总目标字数折算各维度预期字数区间
 * @param {Object} weights 归一化权重
 * @param {number} totalChars 目标总字数
 * @returns {Object} 各维度的预期字数与区间
 */
function calculateCharacterBudgets(weights, totalChars = 3000) {
  const target = Math.max(500, Number(totalChars) || 3000);
  const w = normalizeBudgetWeights(weights);
  const budgets = {};

  for (const key of FOCUS_BUDGET_KEYS) {
    const chars = Math.round(target * w[key]);
    const minChars = Math.round(chars * 0.85);
    const maxChars = Math.round(chars * 1.15);
    budgets[key] = {
      weight: w[key],
      targetChars: chars,
      minChars,
      maxChars,
      percentageText: `${(w[key] * 100).toFixed(1)}%`
    };
  }

  return budgets;
}

const { createSoftFocusBudget } = require('../models/data-schemas');

/**
 * 创建合规的 FocusProfile 实体
 * @param {Object} options 
 * @returns {Object} 冻结的 FocusProfile 实体
 */
function createFocusProfile(options = {}) {
  const input = options || {};
  const id = String(input.id || '').trim();
  const name = String(input.name || '').trim();

  if (!id) throw new TypeError('FocusProfile 必须具备唯一 id');
  if (!name) throw new TypeError('FocusProfile 必须具备人类可读 name');

  const budgetWeights = normalizeBudgetWeights(input.budgetWeights);
  const directives = typeof input.directives === 'object' && input.directives !== null
    ? { ...input.directives }
    : {};

  // 软预算与层级划分
  const sortedKeys = [...FOCUS_BUDGET_KEYS].sort((a, b) => (budgetWeights[b] || 0) - (budgetWeights[a] || 0));
  const dominant = input.dominant || sortedKeys.filter(k => budgetWeights[k] >= 0.20);
  const supporting = input.supporting || sortedKeys.filter(k => budgetWeights[k] >= 0.10 && budgetWeights[k] < 0.20);
  const optional = input.optional || sortedKeys.filter(k => budgetWeights[k] > 0 && budgetWeights[k] < 0.10);
  const forbidden = input.forbidden || sortedKeys.filter(k => budgetWeights[k] === 0);

  const softBudget = createSoftFocusBudget({
    dominant,
    supporting,
    optional,
    forbidden,
    ranges: input.ranges
  });

  const profile = {
    schemaVersion: 'focus-profile-v2',
    id,
    name,
    budgetWeights,
    directives,
    softBudget,
    description: String(input.description || ''),
    metadata: typeof input.metadata === 'object' && input.metadata !== null ? { ...input.metadata } : {}
  };

  return Object.freeze(profile);
}

/**
 * 编译侧重点篇幅预算策略指令块 (Focus Policy Directive)
 * @param {Object} profile 
 * @param {number} targetChars 目标字数
 * @returns {string}
 */
function compileFocusPolicy(profile, targetChars = 3000) {
  if (!profile) return '';
  const breakdown = calculateCharacterBudgets(profile.budgetWeights, targetChars);
  const soft = profile.softBudget || {};
  const tiers = soft.priorityTiers || {};

  const lines = [
    `【本章镜头与笔墨预算分配·${profile.name}】（基准总字数：${targetChars} 字）`
  ];

  if (tiers.dominant && tiers.dominant.length) {
    lines.push(`· 【重点倾斜 (Dominant)】：${tiers.dominant.map(k => `${k}（预期约 ${breakdown[k]?.percentageText || '主控'}，约 ${breakdown[k]?.targetChars || 0} 字）`).join('、')}`);
  }
  if (tiers.supporting && tiers.supporting.length) {
    lines.push(`· 【辅助呼应 (Supporting)】：${tiers.supporting.map(k => `${k}（预期约 ${breakdown[k]?.percentageText || '辅助'}，约 ${breakdown[k]?.targetChars || 0} 字）`).join('、')}`);
  }
  if (tiers.optional && tiers.optional.length) {
    lines.push(`· 【克制点缀 (Optional)】：${tiers.optional.join('、')}`);
  }
  if (tiers.forbidden && tiers.forbidden.length) {
    lines.push(`· 【禁止抢戏 (Forbidden)】：严禁本章大篇幅描写 ${tiers.forbidden.join('、')}`);
  }

  lines.push('【镜头资源软预算准则】：上述配比为镜头关注倾向与软预算区间，非逐字硬性配额；严禁为凑对白比例而机械对话，重点关注主倾斜元素的情节推进力。');

  return lines.join('\n');
}

module.exports = {
  createFocusProfile,
  normalizeBudgetWeights,
  calculateCharacterBudgets,
  compileFocusPolicy,
  FOCUS_BUDGET_KEYS,
  DEFAULT_BUDGET_WEIGHTS
};
