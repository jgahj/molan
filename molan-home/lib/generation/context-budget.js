'use strict';

const { GenerationError } = require('./errors');
const { getModelCapability, estimateTokensWithCapability } = require('../model/model-registry');

const DEFAULT_PROVIDER_CONTEXT_LIMITS = new Proxy({}, {
  get: (_, prop) => getModelCapability(String(prop)).contextWindow
});

/**
 * 估算文本 Token 数量（结合模型真实能力分布）。
 */
function estimateTokens(value, modelId = 'default') {
  return estimateTokensWithCapability(value, modelId);
}

/**
 * 计算精确上下文预算边界：
 * systemTokens + contextTokens + contractTokens + promptTokens + outputReserve <= providerContextLimit
 */
function calculateContextBudget(options = {}) {
  if (options && options.contextPlan) {
    const cp = options.contextPlan;
    const modelCap = getModelCapability(cp.model || 'default');
    const limit = Number(cp.hardLimit) || modelCap.contextWindow;
    const outputReserve = Number(cp.outputReserve) || 0;
    const systemTokens = Number(cp.systemTokens) || 0;
    const contractTokens = Number(cp.contractTokens) || 0;
    const memoryTokens = Number(cp.memoryTokens) || 0;
    const storyTokens = Number(cp.storyTokens) || 0;
    const recentTokens = Number(cp.recentTokens) || 0;
    const contextTokens = memoryTokens + storyTokens + recentTokens;
    const promptTokens = Number(cp.promptTokens) || (contractTokens + contextTokens);
    const totalRequired = Number(cp.totalRequired) || (systemTokens + contractTokens + contextTokens + outputReserve);
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
        memoryTokens,
        storyTokens,
        recentTokens,
        promptTokens,
        outputReserve
      },
      contextPlan: cp
    };
  }

  const {
    system = '',
    context = '',
    contract = null,
    prompt = '',
    targetChars = options.targetChars ?? options.targetWords ?? 2400,
    modelId = '',
    providerContextLimit = null
  } = options;

  const targetCharsNumber = Number(targetChars) || 2400;
  const modelCap = getModelCapability(modelId);
  const systemTokens = estimateTokens(system, modelId);
  const contextTokens = estimateTokens(context, modelId);
  const contractTokens = contract ? estimateTokens(contract, modelId) : 0;
  const promptTokens = estimateTokens(prompt, modelId);
  const outputReserve = Math.ceil(targetCharsNumber * 1.6);

  const limit = Number(providerContextLimit) || modelCap.contextWindow;

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
