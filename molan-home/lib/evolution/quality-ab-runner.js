'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { hashJson } = require('./replay-manifest');
const { sha256 } = require('./quality-ab-artifacts');
const { QUALITY_DIMENSIONS } = require('../quality-vectors');
const VERSION_FIELDS = ['pipelineVersion', 'promptVersion', 'genreProfileVersion', 'styleVersion'];

function planEvaluation(plan) {
  if (plan?.schemaVersion !== 'quality-ab-live-plan-v1' || !Array.isArray(plan.tasks) || !plan.tasks.length) throw new Error('live_plan_invalid');
  if (!plan.binding?.model || plan.binding.modelParametersHash !== hashJson(plan.modelParameters || {})) throw new Error('model_parameters_binding_invalid');
  for (const field of ['evaluatorVersion', 'reviewerVersion']) if (!plan.binding[field]) throw new Error('evaluation_version_required');
  for (const arm of ['baseline', 'candidate']) for (const field of VERSION_FIELDS) if (!plan.versions?.[arm]?.[field]) throw new Error('generation_versions_required');
  if (!Number.isInteger(plan.maxOutputTokens) || plan.maxOutputTokens < 1) throw new Error('max_output_tokens_required');
  if (['max_tokens', 'max_completion_tokens', 'messages', 'model', 'stream', 'n', 'tools', 'tool_choice'].some(field => Object.hasOwn(plan.modelParameters || {}, field))) throw new Error('reserved_model_parameters');
  if (!plan.pricing?.currency || !Number.isFinite(plan.pricing.inputPerMillion) || !Number.isFinite(plan.pricing.outputPerMillion) || plan.pricing.inputPerMillion < 0 || plan.pricing.outputPerMillion < 0) throw new Error('explicit_pricing_required');
  let upperInputTokens = 0;
  const ids = new Set();
  for (const task of plan.tasks) {
    if (!task.task_id || ids.has(task.task_id) || !task.snapshot || task.input_hash !== hashJson(task.snapshot)) throw new Error('task_snapshot_binding_invalid');
    ids.add(task.task_id);
    for (const arm of ['baseline', 'candidate']) {
      if (typeof task.prompts?.[arm] !== 'string' || !task.prompts[arm].trim()) throw new Error('arm_prompt_required');
      upperInputTokens += Buffer.byteLength(task.prompts[arm], 'utf8') + 256;
      // The judge receives the original task plus each generated output.
      upperInputTokens += Buffer.byteLength(task.judgePrompt || '', 'utf8') + Buffer.byteLength(JSON.stringify(task.snapshot), 'utf8') + plan.maxOutputTokens * 4 + 512;
    }
    if (!task.judgePrompt) throw new Error('judge_prompt_required');
  }
  const calls = plan.tasks.length * 4;
  const upperOutputTokens = calls * plan.maxOutputTokens;
  return { schemaVersion: 'quality-ab-call-plan-v1', planHash: hashJson(plan), taskCount: plan.tasks.length, generationCalls: plan.tasks.length * 2, evaluationCalls: plan.tasks.length * 2, totalCalls: calls, currency: plan.pricing.currency, inputTokenUpperEstimate: upperInputTokens, outputTokenLimit: upperOutputTokens, estimatedMaximumCost: (upperInputTokens * plan.pricing.inputPerMillion + upperOutputTokens * plan.pricing.outputPerMillion) / 1e6, estimateMethod: 'utf8-bytes-plus-framing-and-output-token-reserve', actualModelUsage: null };
}

async function runEvaluation(plan, options) {
  const schedule = planEvaluation(plan);
  if (!Number.isFinite(options.maxCost) || options.maxCost <= 0) throw new Error('positive_max_cost_required');
  if (schedule.estimatedMaximumCost > options.maxCost) throw new Error('planned_cost_exceeds_limit');
  if (typeof options.callModel !== 'function') throw new Error('provider_required');
  await fs.mkdir(options.directory, { recursive: false });
  const artifacts = [];
  const failures = [];
  let spent = 0;
  let unresolved = false;
  async function save(id, value, kind = 'json') {
    const filename = id + (kind === 'json' ? '.json' : '.txt');
    const bytes = Buffer.from(kind === 'json' ? JSON.stringify(value, null, 2) + '\n' : value, 'utf8');
    await fs.writeFile(path.join(options.directory, filename), bytes, { flag: 'wx' });
    artifacts.push({ id, path: filename, kind, sha256: sha256(bytes) });
    return id;
  }
  async function call(messages, id, arm) {
    if (unresolved) throw new Error('previous_call_cost_unknown');
    // Reserve a conservative ceiling before every request, including evaluation output.
    const reserve = ((Buffer.byteLength(JSON.stringify(messages), 'utf8') + 256) * plan.pricing.inputPerMillion + plan.maxOutputTokens * plan.pricing.outputPerMillion) / 1e6;
    if (spent + reserve > options.maxCost) throw new Error('remaining_budget_insufficient');
    let response;
    try { response = await options.callModel({ model: plan.binding.model, ...plan.modelParameters, max_tokens: plan.maxOutputTokens, messages, stream: false }); }
    catch (error) { unresolved = true; throw error; }
    const usage = response.usage;
    if (!Number.isInteger(usage?.prompt_tokens) || !Number.isInteger(usage?.completion_tokens) || usage.prompt_tokens < 0 || usage.completion_tokens < 0) {
      unresolved = true;
      await save(id, { response, status: 'COST_UNKNOWN' });
      throw new Error('provider_usage_missing');
    }
    const amount = (usage.prompt_tokens * plan.pricing.inputPerMillion + usage.completion_tokens * plan.pricing.outputPerMillion) / 1e6;
    spent += amount;
    await save(id, { response, usage, amount, pricing: plan.pricing, currency: plan.pricing.currency, binding: plan.binding, configurationHash: plan.configurationHashes?.[arm], versions: plan.versions[arm], request: { model: plan.binding.model, modelParameters: plan.modelParameters, max_tokens: plan.maxOutputTokens, messages }, status: spent <= options.maxCost ? 'RECORDED' : 'LIMIT_EXCEEDED' });
    if (spent > options.maxCost) { unresolved = true; throw new Error('provider_cost_exceeded_limit'); }
    if (response.model !== plan.binding.model) throw new Error('provider_model_binding_mismatch');
    const content = response.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('provider_output_empty');
    return { content, amount, usage, ledgerId: id };
  }
  const input = { schemaVersion: 'quality-vector-ab-input-v1', evaluationMode: 'saved_results_only', binding: plan.binding, versions: plan.versions, configurations: plan.configurations, configurationHashes: plan.configurationHashes, scoreScale: plan.scoreScale, golden: plan.golden, targetDimensions: plan.targetDimensions, safety_gate: plan.safety_gate, tasks: [] };
  try {
    for (const [index, task] of plan.tasks.entries()) {
      const pair = { task_id: task.task_id, genre: task.genre, input_hash: task.input_hash };
      const inputArtifactId = await save(`task-${index}-input`, task.snapshot);
      for (const arm of ['baseline', 'candidate']) {
        const prefix = `task-${index}-${arm}`;
        try {
          const generated = await call([{ role: 'user', content: task.prompts[arm] }], prefix + '-generation-call', arm);
          const outputArtifactId = await save(prefix + '-output', generated.content, 'text');
          const judged = await call([{ role: 'system', content: task.judgePrompt }, { role: 'user', content: JSON.stringify({ task: task.snapshot, text: generated.content }) }], prefix + '-evaluation-call', arm);
          const evaluation = JSON.parse(judged.content);
          const vector = evaluation.qualityVector;
          if (vector?.schemaVersion !== 'quality-vector-v2') throw new Error('evaluator_vector_invalid');
          for (const dimension of QUALITY_DIMENSIONS) {
            const entry = vector.dimensions?.[dimension];
            if (!entry || entry.status !== 'JUDGED' || !entry.explanation || entry.value !== vector.values?.[dimension]) throw new Error(`evaluator_dimension_invalid:${dimension}`);
            entry.evidence_refs = [`${prefix}-evaluation#/qualityVector/dimensions/${dimension}`, `${outputArtifactId}#`];
          }
          await save(prefix + '-evaluation', evaluation);
          const run = { generationId: crypto.randomUUID(), input_hash: task.input_hash, binding: plan.binding, versions: plan.versions[arm], outputHash: sha256(Buffer.from(generated.content, 'utf8')), qualityVector: vector, cost: { amount: generated.amount + judged.amount, currency: plan.pricing.currency, evidence_refs: [generated.ledgerId + '#/usage', judged.ledgerId + '#/usage'] }, artifact_id: prefix + '-artifact' };
          await save(run.artifact_id, { schemaVersion: 'quality-ab-generation-artifact-v1', ...run, inputArtifactId, outputArtifactId, evaluationArtifactId: prefix + '-evaluation', generationCallArtifactId: generated.ledgerId, evaluationCallArtifactId: judged.ledgerId });
          pair[arm] = run;
        } catch (error) { failures.push({ task_id: task.task_id, arm, error: String(error.message), costUnknown: unresolved }); }
        if (unresolved) {
          if (arm === 'baseline') failures.push({ task_id: task.task_id, arm: 'candidate', error: 'skipped_after_unknown_provider_cost', costUnknown: true });
          break;
        }
      }
      input.tasks.push(pair);
      if (unresolved) {
        for (const pending of plan.tasks.slice(index + 1)) for (const arm of ['baseline', 'candidate']) failures.push({ task_id: pending.task_id, arm, error: 'skipped_after_unknown_provider_cost', costUnknown: true });
        break;
      }
    }
  } finally {
    await save('results', input);
    await fs.writeFile(path.join(options.directory, 'artifacts.json'), JSON.stringify({ schemaVersion: 'quality-ab-artifact-index-v1', artifacts }, null, 2) + '\n', { flag: 'wx' });
    await fs.writeFile(path.join(options.directory, 'execution.json'), JSON.stringify({ ...schedule, status: failures.length ? 'BLOCKED' : 'COMPLETED_PENDING_COMPARISON', maxCost: options.maxCost, recordedCost: spent, costUnknown: unresolved, failures }, null, 2) + '\n', { flag: 'wx' });
  }
  return { status: failures.length ? 'BLOCKED' : 'COMPLETED_PENDING_COMPARISON', recordedCost: spent, failures };
}
module.exports = { planEvaluation, runEvaluation };
