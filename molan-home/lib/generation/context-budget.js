'use strict';

const { GenerationError } = require('./errors');
const { getModelCapability, estimateTokensWithCapability } = require('../model/model-registry');

const DEFAULT_PROVIDER_CONTEXT_LIMITS = new Proxy({}, {
  get: (_, prop) => getModelCapability(String(prop)).contextWindow
});

function estimateTokens(value, modelId = 'default') {
  return estimateTokensWithCapability(value, modelId);
}

function estimateMessageEnvelopeTokens(modelId = 'default', messageCount = 2) {
  const roles = Array.from({ length: Math.max(0, Number(messageCount) || 0) }, (_, index) =>
    `<|message-${index + 1}|><|role|>${index === 0 ? 'system' : 'user'}<|content|>`).join('') + '<|assistant|>';
  return estimateTokens(roles, modelId);
}

function calculateContextBudget(options = {}) {
  if (options && options.contextPlan) {
    const cp = options.contextPlan;
    const modelCap = getModelCapability(cp.model || 'default');
    const limit = Number(cp.hardLimit) || modelCap.contextWindow;
    const outputReserve = Math.max(0, Number(cp.outputReserve) || 0);
    const systemTokens = Math.max(0, Number(cp.systemTokens) || 0);
    const contractTokens = Math.max(0, Number(cp.contractTokens) || 0);
    const memoryTokens = Math.max(0, Number(cp.memoryTokens) || 0);
    const storyTokens = Math.max(0, Number(cp.storyTokens) || 0);
    const recentTokens = Math.max(0, Number(cp.recentTokens) || 0);
    const contextTokens = memoryTokens + storyTokens + recentTokens;
    const renderedContextTokens = Math.max(0, Number(cp.renderedContextTokens) || contractTokens + contextTokens);
    const inputPromptTokens = Math.max(0, Number(cp.inputPromptTokens) || 0);
    const externalContractTokens = Math.max(0, Number(cp.externalContractTokens) || 0);
    const renderedWrapperTokens = Math.max(0, Number(cp.renderedWrapperTokens) || 0);
    const reservedInputTokens = Math.max(0, Number(cp.reservedInputTokens) || 0);
    const promptTokens = Math.max(0, Number(cp.promptTokens) || (renderedContextTokens + inputPromptTokens + externalContractTokens));
    const totalRequired = Math.max(0, Number(cp.totalRequired) || (systemTokens + renderedContextTokens + inputPromptTokens +
      externalContractTokens + renderedWrapperTokens + reservedInputTokens + outputReserve));
    const margin = limit - totalRequired;

    return {
      fits: margin >= 0,
      margin,
      limit,
      totalRequired,
      breakdown: {
        systemTokens, contextTokens, renderedContextTokens, contractTokens, memoryTokens,
        storyTokens, recentTokens, promptTokens, inputPromptTokens, externalContractTokens,
        renderedWrapperTokens, reservedInputTokens, outputReserve
      },
      contextPlan: cp
    };
  }

  const {
    system = '',
    context = '',
    contract = null,
    prompt = '',
    messages = null,
    targetChars = options.targetChars ?? options.targetWords ?? 2400,
    modelId = '',
    providerContextLimit = null
  } = options;

  const selectedModel = String(modelId || 'default');
  const targetCharsNumber = Number(targetChars) || 2400;
  const modelCap = getModelCapability(selectedModel);
  const systemTokens = estimateTokens(system, selectedModel);
  const serializedMessages = Array.isArray(messages) ? messages : null;
  let promptTokens;
  let contextTokens;
  let messageEnvelopeTokens;
  if (serializedMessages) {
    promptTokens = serializedMessages.reduce((sum, message) => sum + estimateTokens(message && message.content || '', selectedModel), 0);
    contextTokens = 0;
    messageEnvelopeTokens = estimateMessageEnvelopeTokens(selectedModel, serializedMessages.length);
  } else {
    promptTokens = estimateTokens(prompt, selectedModel);
    const contextText = String(context || '');
    const contextEmbeddedInPrompt = Boolean(contextText && String(prompt || '').includes(contextText));
    contextTokens = contextEmbeddedInPrompt ? 0 : estimateTokens(contextText, selectedModel);
    messageEnvelopeTokens = estimateMessageEnvelopeTokens(selectedModel, system ? 2 : 1);
  }
  const contractTokens = contract ? estimateTokens(contract, selectedModel) : 0;
  const requestedOutput = Number(options.maxOutputTokens);
  const outputCeiling = requestedOutput > 0 ? requestedOutput : Math.min(6000, Number(modelCap.maxOutputTokens) || 6000);
  const outputReserve = options.outputReserve != null
    ? Math.max(0, Number(options.outputReserve) || 0)
    : Math.max(0, Math.min(outputCeiling, Math.ceil(targetCharsNumber * 1.8)));

  const wrapperText = String(options.renderedWrapperText || '');
  const renderedWrapperTokens = messageEnvelopeTokens + estimateTokens(wrapperText, selectedModel);
  const limit = Number(providerContextLimit) || modelCap.contextWindow;
  const otherInputReserveTokens = Math.max(0, Number(options.reservedInputTokens ?? options.promptReserveTokens) || 0);
  const totalRequired = systemTokens + contextTokens + contractTokens + promptTokens + renderedWrapperTokens +
    otherInputReserveTokens + outputReserve;
  const margin = limit - totalRequired;

  return {
    fits: margin >= 0,
    margin,
    limit,
    totalRequired,
    breakdown: {
      systemTokens,
      contextTokens,
      contractTokens,
      promptTokens,
      outputReserve,
      renderedWrapperTokens,
      otherInputReserveTokens
    }
  };
}

function assertContextBudget(options = {}) {
  const budget = calculateContextBudget(options);
  if (!budget.fits) {
    throw new GenerationError(
      'CONTEXT_OVERFLOW',
      `上下文超过供应商硬上限（需 ${budget.totalRequired} tokens，上限 ${budget.limit} tokens，超出 ${Math.abs(budget.margin)} tokens），未静默裁剪`,
      { status: 413, details: budget }
    );
  }
  return budget;
}

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
  estimateMessageEnvelopeTokens,
  calculateContextBudget,
  assertContextBudget,
  validateCriticalFacts
};
