'use strict';

const MIN_TIMEOUT_MS = 30000;
const DEFAULT_TIMEOUT_MS = 180000;
const MAX_TIMEOUT_MS = 900000;
const GENERATION_TOKENS_PER_SECOND = 15;

/** 按正文输出预算计算评测模型调用的有界超时，并支持环境变量覆盖。 */
function calculateBenchmarkCallTimeoutMs(options = {}, env = process.env) {
  const configuredTimeoutMs = Number(env.MOLAN_BENCHMARK_CALL_TIMEOUT_MS);
  if (Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0) {
    return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.ceil(configuredTimeoutMs)));
  }

  const stage = String(options.stage || '').trim().toLowerCase();
  const longCall = options.disableTimeout === true || stage === 'writing';
  const maxTokens = Math.max(2000, Number(options.maxTokens) || 2000);
  const estimatedTimeoutMs = longCall
    ? DEFAULT_TIMEOUT_MS + Math.ceil(maxTokens / GENERATION_TOKENS_PER_SECOND * 1000)
    : DEFAULT_TIMEOUT_MS;

  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, estimatedTimeoutMs));
}

module.exports = { calculateBenchmarkCallTimeoutMs };
