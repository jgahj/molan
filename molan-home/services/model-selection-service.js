'use strict';

const OFFICIAL_REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

function createModelSelectionService({ findPlatformModel, normalizeUserRole, currentDefaultModel }) {
  function canChooseModel(user) {
    const role = normalizeUserRole(user);
    return role === 'vip' || role === 'admin';
  }

  function resolveModelForUser(user, requestedModel) {
    const defaultModel = currentDefaultModel();
    if (!canChooseModel(user)) return defaultModel;
    const requested = String(requestedModel || '').trim();
    const matched = findPlatformModel(requested);
    return matched ? matched.id : defaultModel;
  }

  function reasoningEffortsForModel(pm) {
    if (!pm) return [];
    const model = String(pm.model || pm.id || '').toLowerCase();
    if (/^gpt-6-luna$/.test(model)) return ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
    if (!pm.supportsReasoning) return [];
    if (/gemini/i.test(model) || pm.group === 'gemini') return ['low', 'medium', 'high'];
    if (/grok-4\.6/i.test(model)) return ['low', 'medium', 'high', 'xhigh'];
    if (/grok/i.test(model) || pm.group === 'grok') return ['low', 'medium', 'high'];
    if (Array.isArray(pm.reasoningEfforts) && pm.reasoningEfforts.length) {
      return pm.reasoningEfforts.filter(value => OFFICIAL_REASONING_EFFORTS.has(value));
    }
    if (/gpt-5\.6/.test(model)) return ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
    if (/gpt-5\.(2|4|5)/.test(model)) return ['none', 'low', 'medium', 'high', 'xhigh'];
    return ['none', 'low', 'medium', 'high'];
  }

  function normalizeReasoningEffort(pm, value) {
    if (!pm || !pm.supportsReasoning || value == null || value === '') return null;
    const effort = String(value).trim().toLowerCase();
    const isGemini = pm.group === 'gemini' || /gemini/i.test(String(pm.model || pm.id || ''));
    const isGrok = pm.group === 'grok' || /grok/i.test(String(pm.model || pm.id || ''));
    if ((isGemini || isGrok) && effort === 'none') return 'low';
    if (!reasoningEffortsForModel(pm).includes(effort)) {
      const supported = reasoningEffortsForModel(pm);
      throw new Error('当前模型支持的推理强度为：' + supported.join('、'));
    }
    return effort;
  }

  return { canChooseModel, resolveModelForUser, reasoningEffortsForModel, normalizeReasoningEffort };
}

module.exports = { createModelSelectionService };
