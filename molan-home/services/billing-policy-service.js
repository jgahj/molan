'use strict';

// Exact provider usage and conservative preflight estimates share one billing policy.
function createBillingPolicyService({ findPlatformModel, PRICING, creditMultiplierForUser, resolveModelForUser }) {
  function toTokenCount(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value);
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
    return null;
  }
  
  function firstTokenCount(...values) {
    for (const value of values) {
      const n = toTokenCount(value);
      if (n !== null) return n;
    }
    return null;
  }
  
  // The provider usage object is the only source treated as exact. Never estimate from text.
  function normalizeUsage(raw) {
    if (!raw || typeof raw !== 'object') {
        return { promptTokens: null, completionTokens: null, reasoningTokens: null, totalTokens: null, cachedTokens: null, cacheWriteTokens: null, usageSource: 'unavailable' };
    }
    const promptTokens = firstTokenCount(raw.prompt_tokens, raw.input_tokens, raw.promptTokens, raw.inputTokens);
    const completionTokens = firstTokenCount(raw.completion_tokens, raw.output_tokens, raw.completionTokens, raw.outputTokens);
    const details = raw.completion_tokens_details || raw.output_tokens_details || {};
    const reasoningTokens = firstTokenCount(
      details.reasoning_tokens,
      details.reasoningTokens,
      raw.reasoning_tokens,
      raw.reasoningTokens
    );
    const promptDetails = raw.prompt_tokens_details || raw.input_tokens_details || {};
    const cachedTokens = firstTokenCount(promptDetails.cached_tokens, promptDetails.cachedTokens);
    const cacheWriteTokens = firstTokenCount(promptDetails.cache_write_tokens, promptDetails.cacheWriteTokens);
    let totalTokens = firstTokenCount(raw.total_tokens, raw.totalTokens);
    if (totalTokens === null && promptTokens !== null && completionTokens !== null) totalTokens = promptTokens + completionTokens;
    const hasAny = [promptTokens, completionTokens, reasoningTokens, totalTokens].some(v => v !== null);
    return { promptTokens, completionTokens, reasoningTokens, totalTokens, cachedTokens, cacheWriteTokens, usageSource: hasAny ? 'upstream' : 'unavailable' };
  }
  
  function creditCostForTokens(modelId, totalTokens) {
    const tokens = toTokenCount(totalTokens);
    if (tokens === null || tokens <= 0) return 0;
    const pm = findPlatformModel(modelId);
    const rate = (pm && typeof pm.creditsPer1k === 'number') ? pm.creditsPer1k : (PRICING.fallbackCreditsPer1k || 1);
    return Math.max(0.01, Math.round(rate * tokens / 1000 * 100) / 100);
  }
  
  function creditCostForUser(user, modelId, totalTokens) {
    const base = creditCostForTokens(modelId, totalTokens);
    if (!base) return 0;
    return Math.round(base * creditMultiplierForUser(user) * 100) / 100;
  }
  
  // All AI entry points use the same conservative estimate before a request
  // starts. The final ledger still uses provider usage when it is available.
  function estimateBillingTokens(input) {
    const body = input && typeof input === 'object' ? input : {};
    const explicit = toTokenCount(body.tokens || body.estimatedTokens);
    if (explicit !== null) return Math.min(20000000, Math.max(1, explicit));
    const chars = Math.max(0, Math.min(20000000, Number(body.chars || body.promptChars || 0) || 0));
    const task = String(body.task || body.kind || 'chat').toLowerCase();
    const depth = ['quick', 'standard', 'deep'].includes(String(body.depth || '')) ? String(body.depth) : 'standard';
    let completionTokens = Math.max(256, Math.min(128000, Math.floor(Number(body.completionTokens || body.maxTokens || 2048) || 2048)));
    if (task === 'dissection') {
      // 拆书会按六个阶段重复发送样本和阶段提示。旧估算只计算了一次
      // 输入，导致用户看到的预算远低于真实消耗，普通账户容易在中途耗尽。
      const stagePromptTokens = Math.ceil(chars / 3) + 9000;
      const stageOutputTokens = depth === 'deep' ? 7000 : 5000;
      return Math.min(20000000, Math.max(1, 6 * (stagePromptTokens + stageOutputTokens)));
    } else if (task === 'extract') {
      completionTokens = depth === 'deep' ? 5 * 6000 : 5 * 4000;
    } else if (task === 'report' || task === 'consistency') {
      completionTokens = Math.min(completionTokens, 5000);
    }
    return Math.min(20000000, Math.max(1, Math.ceil(chars / 3 + completionTokens)));
  }
  
  function estimateBillingForUser(user, input) {
    const body = input && typeof input === 'object' ? input : {};
    const modelId = resolveModelForUser(user, body.model);
    const model = findPlatformModel(modelId);
    const estimatedTokens = estimateBillingTokens(body);
    return {
      modelId,
      modelName: model ? model.name : modelId,
      estimatedTokens,
      estimatedCredits: creditCostForUser(user, modelId, estimatedTokens)
    };
  }
  return { toTokenCount, firstTokenCount, normalizeUsage, creditCostForTokens, creditCostForUser, estimateBillingTokens, estimateBillingForUser };
}

module.exports = { createBillingPolicyService };
