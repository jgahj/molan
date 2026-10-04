'use strict';

const { ERROR_CATALOG, ALL_ERROR_CODES, getErrorDefinition } = require('../stability/error-catalog');

const ERROR_CODES = ALL_ERROR_CODES;

const PUBLIC_MESSAGES = Object.freeze(
  Object.fromEntries(Object.entries(ERROR_CATALOG).map(([code, def]) => [code, def.userMessage]))
);

/** 用稳定错误码描述生成链的可恢复失败。 */
class GenerationError extends Error {
  constructor(code, message, options = {}) {
    const def = getErrorDefinition(code);
    super(String(message || def.userMessage || code || '生成任务失败'));
    this.name = 'GenerationError';
    this.code = ERROR_CODES.includes(String(code)) ? String(code) : 'MODEL_CONTENT_BLOCKED';
    this.status = Number(options.status) || def.httpStatus || 500;
    this.retryable = options.retryable !== undefined ? Boolean(options.retryable) : def.retryable;
    this.unknown = options.unknown !== undefined ? Boolean(options.unknown) : def.unknown;
    this.resolutionGuidance = options.resolutionGuidance || def.resolutionGuidance;
    this.category = options.category || def.category;
    this.details = options.details && typeof options.details === 'object' ? options.details : undefined;
  }
}

/** 将外部异常收敛成不会泄露供应商响应正文的公开错误。 */
function toPublicError(error) {
  const code = ERROR_CODES.includes(String(error && error.code)) ? String(error.code) : 'MODEL_CONTENT_BLOCKED';
  const def = getErrorDefinition(code);
  return {
    code,
    message: PUBLIC_MESSAGES[code] || '生成任务失败',
    retryable: Boolean(error && error.retryable !== undefined ? error.retryable : def.retryable),
    unknown: Boolean(error && error.unknown !== undefined ? error.unknown : def.unknown),
    resolutionGuidance: def.resolutionGuidance
  };
}

module.exports = { ERROR_CODES, PUBLIC_MESSAGES, GenerationError, toPublicError };
