'use strict';

const { canonicalJson, hashJson } = require('./replay-manifest');

const SHADOW_METRICS = ['quality', 'style', 'continuity', 'cost', 'latency'];

function cloneFrozenJson(value) {
  const copy = JSON.parse(canonicalJson(value));
  const freeze = item => {
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) return item;
    Object.values(item).forEach(freeze);
    return Object.freeze(item);
  };
  return freeze(copy);
}

function measuredMetrics(input = {}) {
  const metrics = {};
  for (const key of SHADOW_METRICS) {
    const value = input[key];
    metrics[key] = typeof value === 'number' && Number.isFinite(value) &&
      (!['cost', 'latency'].includes(key) || value >= 0) ? value : null;
  }
  return metrics;
}

function errorCode(error) {
  return /^[A-Z][A-Z0-9_]{1,63}$/.test(String(error && error.code || ''))
    ? error.code
    : 'SHADOW_EVALUATION_FAILED';
}

/** Run a detached candidate evaluation without passing production state or billing handles. */
async function runShadowEvaluation({
  generationId,
  contextSnapshot,
  shadowPrompt,
  promptVersion,
  model,
  parameters = {},
  generateShadow,
  evaluateShadow,
  now = () => Date.now()
} = {}) {
  if (typeof generateShadow !== 'function' || typeof evaluateShadow !== 'function') {
    throw new TypeError('必须提供 generateShadow 与 evaluateShadow');
  }
  if (!contextSnapshot || typeof contextSnapshot !== 'object' || Array.isArray(contextSnapshot)) {
    throw new TypeError('contextSnapshot 必须是独立 JSON 快照');
  }
  if (!String(generationId || '').trim() || !String(promptVersion || '').trim() || !String(model || '').trim()) {
    throw new TypeError('generationId、promptVersion 与 model 必填');
  }
  const context = cloneFrozenJson(contextSnapshot);
  const contextHash = hashJson(context);
  const prompt = String(shadowPrompt || '');
  if (!prompt.trim()) throw new TypeError('shadowPrompt 必填');
  const promptHash = hashJson(prompt);
  const startedAt = now();
  let shadowCost = null;
  try {
    const generated = await generateShadow(Object.freeze({
      mode: 'shadow',
      billableToUser: false,
      prompt,
      promptVersion: String(promptVersion || ''),
      model: String(model || ''),
      parameters: cloneFrozenJson(parameters),
      contextSnapshot: context
    }));
    const candidateText = typeof generated === 'string' ? generated
      : generated && typeof generated.text === 'string' ? generated.text : '';
    if (!candidateText.trim()) throw Object.assign(new Error('shadow output is empty'), { code: 'EMPTY_SHADOW_OUTPUT' });
    shadowCost = typeof (generated && generated.cost) === 'number' && Number.isFinite(generated.cost)
      && generated.cost >= 0 ? generated.cost : null;
    const evaluation = await evaluateShadow(Object.freeze({
      candidateText,
      contextSnapshot: context,
      mode: 'shadow'
    }));
    const endedAt = now();
    return {
      schemaVersion: 'shadow-evaluation-v1',
      generation_id: String(generationId || ''),
      status: 'completed',
      user_visible: false,
      user_billing_mutation: 'none',
      state_mutation: 'none',
      prompt_version: String(promptVersion || ''),
      prompt_hash: promptHash,
      model: String(model || ''),
      context_hash: contextHash,
      shadow_output_hash: hashJson(candidateText),
      metrics: measuredMetrics({
        ...(evaluation && evaluation.metrics || {}),
        cost: (evaluation && evaluation.metrics && evaluation.metrics.cost) ?? shadowCost,
        latency: (evaluation && evaluation.metrics && evaluation.metrics.latency) ?? Math.max(0, endedAt - startedAt)
      }),
      evaluated_at_ms: endedAt,
      evidence_refs: Array.isArray(evaluation && evaluation.evidence_refs)
        ? evaluation.evidence_refs.filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean) : []
    };
  } catch (error) {
    const endedAt = now();
    return {
      schemaVersion: 'shadow-evaluation-v1',
      generation_id: String(generationId || ''),
      status: 'failed',
      user_visible: false,
      user_billing_mutation: 'none',
      state_mutation: 'none',
      prompt_version: String(promptVersion || ''),
      prompt_hash: promptHash,
      model: String(model || ''),
      context_hash: contextHash,
      metrics: measuredMetrics({ cost: shadowCost, latency: Math.max(0, endedAt - startedAt) }),
      error_code: errorCode(error),
      evaluated_at_ms: endedAt,
      evidence_refs: []
    };
  }
}

module.exports = { SHADOW_METRICS, runShadowEvaluation };
