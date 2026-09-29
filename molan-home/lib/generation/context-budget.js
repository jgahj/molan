'use strict';

const { GenerationError } = require('./errors');

const DEFAULT_PROVIDER_CONTEXT_LIMITS = Object.freeze({
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4': 32768,
  'claude-3-5-sonnet': 200000,
  'claude-3-opus': 200000,
  'deepseek-chat': 64000,
  'deepseek-reasoner': 64000,
  'qwen-plus': 32768,
  'qwen-max': 32768,
  'standard-local': 32768,
  'default': 32768
});

/**
 * 估算文本 Token 数量。
 * 中文字符约 1.2~1.5 chars/token，标点与空白约 1 char/token，英文单词约 1 word/1.3 tokens。
 */
function estimateTokens(value) {
  if (value == null) return 0;
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (!str) return 0;
  const cjkMatches = str.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const nonCjkCount = str.length - cjkCount;
  return Math.ceil(cjkCount * 0.75 + nonCjkCount * 0.3);
}

/**
 * 计算精确上下文预算边界：
 * systemTokens + contextTokens + contractTokens + promptTokens + outputReserve <= providerContextLimit
 */
function calculateContextBudget({
  system = '',
  context = '',
  contract = null,
  prompt = '',
  targetWords = 2400,
  modelId = '',
  providerContextLimit = null
} = {}) {
  const systemTokens = estimateTokens(system);
  const contextTokens = estimateTokens(context);
  const contractTokens = contract ? estimateTokens(contract) : 0;
  const promptTokens = estimateTokens(prompt);
  const targetChars = Number(targetWords) || 2400;
  const outputReserve = Math.ceil(targetChars * 1.6);

  const limit = Number(providerContextLimit) ||
    DEFAULT_PROVIDER_CONTEXT_LIMITS[modelId] ||
    DEFAULT_PROVIDER_CONTEXT_LIMITS.default;

  const totalRequired = systemTokens + contextTokens + contractTokens + promptTokens + outputReserve;
  const margin = limit - totalRequired;
  const fits = margin >= 0;

  return {
    fits,
    margin,
    limit,
    totalRequired,
    breakdown: {
      systemTokens,
      contextTokens,
      contractTokens,
      promptTokens,
      outputReserve
    }
  };
}

/**
 * 校验上下文预算；超出硬限制时抛出显式 CONTEXT_OVERFLOW 异常。
 */
function assertContextBudget(options = {}) {
  const budget = calculateContextBudget(options);
  if (!budget.fits) {
    throw new GenerationError(
      'CONTEXT_OVERFLOW',
      `上下文超过供应商硬上限（需 ${budget.totalRequired} tokens，上限 ${budget.limit} tokens，超出 ${Math.abs(budget.margin)} tokens），未静默裁剪`,
      {
        status: 413,
        details: budget
      }
    );
  }
  return budget;
}

/**
 * 校验关键事实与硬状态实体未被静默遗漏。
 * 若上下文编排中遗漏了必需块，触发阻断硬失败。
 */
function validateCriticalFacts({ contextPlan = {}, requiredFactIds = [] } = {}) {
  const omitted = Array.isArray(contextPlan.omittedBlocks) ? contextPlan.omittedBlocks : [];
  const required = Array.isArray(requiredFactIds) ? requiredFactIds : [];
  const missing = required.filter(id => omitted.includes(id));

  if (missing.length > 0) {
    return {
      ok: false,
      code: 'OMITTED_CRITICAL_FACTS',
      message: `关键创作事实未纳入生成上下文：${missing.join(', ')}`,
      omittedFacts: missing
    };
  }

  return { ok: true, omittedFacts: [] };
}

module.exports = {
  DEFAULT_PROVIDER_CONTEXT_LIMITS,
  estimateTokens,
  calculateContextBudget,
  assertContextBudget,
  validateCriticalFacts
};
