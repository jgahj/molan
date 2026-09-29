'use strict';

const crypto = require('node:crypto');

/** 为 Generation Run 的单次 Provider 阶段生成稳定、短小的幂等请求 ID。 */
function generationProviderRequestId(generationId, phase, stage, attempt = 1) {
  const identity = [
    String(generationId || '').trim(),
    String(phase || '').trim(),
    String(stage || '').trim(),
    String(Math.max(1, Number(attempt) || 1))
  ].join('\u0000');
  return `req_${crypto.createHash('sha256').update(identity, 'utf8').digest('hex').slice(0, 40)}`;
}

module.exports = { generationProviderRequestId };
