'use strict';

const ERROR_CODES = Object.freeze([
  'GENRE_UNCERTAIN', 'STYLE_UNCERTAIN', 'CONTEXT_OVERFLOW', 'CONTRACT_INVALID',
  'STATE_CONFLICT', 'MODEL_TIMEOUT', 'MODEL_429', 'MODEL_5XX', 'MODEL_EMPTY',
  'MODEL_TRUNCATED', 'MODEL_CONTENT_BLOCKED', 'USAGE_UNKNOWN', 'PROVIDER_UNKNOWN',
  'AUDIT_BLOCKED', 'REVISION_EXHAUSTED', 'BUDGET_EXCEEDED',
  'IDEMPOTENCY_KEY_REUSED', 'INVALID_STATE_TRANSITION', 'RUN_NOT_FOUND'
]);

const PUBLIC_MESSAGES = Object.freeze({
  GENRE_UNCERTAIN: '请确认作品题材后继续',
  STYLE_UNCERTAIN: '请确认作品文风后继续',
  CONTEXT_OVERFLOW: '上下文超过预算，请精简后重试',
  CONTRACT_INVALID: '章节合同不完整或格式无效',
  STATE_CONFLICT: '生成任务状态已变化，请刷新后重试',
  MODEL_TIMEOUT: '模型请求超时，结果可能未知，请先查询任务状态',
  MODEL_429: '模型服务繁忙，请稍后重试',
  MODEL_5XX: '模型服务暂时不可用',
  MODEL_EMPTY: '模型未返回正文',
  MODEL_TRUNCATED: '模型返回内容不完整',
  MODEL_CONTENT_BLOCKED: '生成内容未通过服务处理',
  USAGE_UNKNOWN: '模型用量尚未确认，请勿自动重试',
  PROVIDER_UNKNOWN: '模型请求结果未知，请勿自动重试',
  AUDIT_BLOCKED: '正文未通过审计，需要人工复核',
  REVISION_EXHAUSTED: '局部修订次数已用完，需要人工复核',
  BUDGET_EXCEEDED: '创作额度不足',
  IDEMPOTENCY_KEY_REUSED: '该幂等键已用于其他请求',
  INVALID_STATE_TRANSITION: '生成任务状态冲突',
  RUN_NOT_FOUND: '生成任务不存在或无权访问'
});

/** 用稳定错误码描述生成链的可恢复失败。 */
class GenerationError extends Error {
  constructor(code, message, options = {}) {
    super(String(message || code || '生成任务失败'));
    this.name = 'GenerationError';
    this.code = ERROR_CODES.includes(String(code)) ? String(code) : 'MODEL_CONTENT_BLOCKED';
    this.status = Number(options.status) || 500;
    this.retryable = options.retryable === true;
    this.unknown = options.unknown === true;
    this.details = options.details && typeof options.details === 'object' ? options.details : undefined;
  }
}

/** 将外部异常收敛成不会泄露供应商响应正文的公开错误。 */
function toPublicError(error) {
  const code = ERROR_CODES.includes(String(error && error.code)) ? String(error.code) : 'MODEL_CONTENT_BLOCKED';
  return {
    code,
    message: PUBLIC_MESSAGES[code] || '生成任务失败',
    retryable: Boolean(error && error.retryable),
    unknown: Boolean(error && error.unknown) || ['PROVIDER_UNKNOWN', 'USAGE_UNKNOWN'].includes(code)
  };
}

module.exports = { ERROR_CODES, PUBLIC_MESSAGES, GenerationError, toPublicError };
