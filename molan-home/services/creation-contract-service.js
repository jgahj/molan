'use strict';

const CONTRACT_CLICHE_BLOCKLIST = ['主角变强', '敌人出现', '发生冲突', '展开战斗', '实力提升', '危机降临'];

function createCreationContractService({ findPlatformModel, currentDefaultModel }) {
  if (typeof findPlatformModel !== 'function' || typeof currentDefaultModel !== 'function') {
    throw new TypeError('Creation contract model dependencies are required');
  }

  function resolveCreationModelId(body) {
    const requested = String(body && (body.modelId || body.model) || '').trim();
    return findPlatformModel(requested) ? requested : currentDefaultModel();
  }

  function contractFieldsSubstantive(contract) {
    const value = contract && typeof contract === 'object' ? contract : {};
    const fields = ['goal', 'protagonistAction', 'opposition', 'irreversibleResult'];
    for (const field of fields) {
      const text = String(value[field] || '').trim();
      if (text.length < 8) return { ok: false, field, reason: '字段过短或为空' };
      for (const phrase of CONTRACT_CLICHE_BLOCKLIST) {
        if (text.includes(phrase)) return { ok: false, field, reason: '命中套话短语：' + phrase };
      }
    }
    return { ok: true };
  }

  return { resolveCreationModelId, contractFieldsSubstantive, CONTRACT_CLICHE_BLOCKLIST };
}

module.exports = { createCreationContractService };
