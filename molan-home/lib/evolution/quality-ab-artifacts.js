'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { hashJson } = require('./replay-manifest');

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function pointer(value, location) {
  if (location === '') return value;
  if (!location.startsWith('/')) throw new Error('evidence_pointer_invalid');
  for (const part of location.slice(1).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) throw new Error('evidence_pointer_missing');
    value = value[key];
  }
  if (value === null || value === '' || value === undefined) throw new Error('evidence_pointer_empty');
  return value;
}

/** Resolve immutable local artifacts; absolute paths, symlinks and traversal are rejected. */
function createArtifactResolver(directory) {
  const root = fs.realpathSync(directory);
  const manifestBytes = fs.readFileSync(path.join(root, 'artifacts.json'));
  const manifest = JSON.parse(manifestBytes);
  if (manifest.schemaVersion !== 'quality-ab-artifact-index-v1' || !Array.isArray(manifest.artifacts)) throw new Error('artifact_index_invalid');
  const records = new Map();
  for (const record of manifest.artifacts) {
    if (!record.id || records.has(record.id) || !/^[a-f0-9]{64}$/.test(record.sha256 || '') ||
        typeof record.path !== 'string' || path.isAbsolute(record.path)) throw new Error('artifact_record_invalid');
    records.set(record.id, record);
  }
  const cache = new Map();
  function load(id) {
    if (cache.has(id)) return cache.get(id);
    const record = records.get(id);
    if (!record) throw new Error(`artifact_missing:${id}`);
    const resolved = fs.realpathSync(path.resolve(root, record.path));
    const relative = path.relative(root, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`artifact_outside_root:${id}`);
    // Resolve each component so junctions cannot silently change source provenance.
    let cursor = root;
    for (const part of path.relative(root, path.resolve(root, record.path)).split(path.sep)) {
      cursor = path.join(cursor, part);
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`artifact_symlink:${id}`);
    }
    const bytes = fs.readFileSync(resolved);
    if (sha256(bytes) !== record.sha256) throw new Error(`artifact_hash_mismatch:${id}`);
    const item = { record, bytes, json: record.kind === 'json' ? JSON.parse(bytes.toString('utf8')) : null };
    cache.set(id, item);
    return item;
  }
  function resolve(ref) {
    const separator = String(ref).indexOf('#');
    if (separator < 1) throw new Error(`evidence_reference_invalid:${ref}`);
    const item = load(ref.slice(0, separator));
    const location = ref.slice(separator + 1);
    if (!item.json) {
      if (location || !item.bytes.length) throw new Error('text_evidence_pointer_invalid');
      return item.bytes.toString('utf8');
    }
    return pointer(item.json, location);
  }
  return { load, resolve, manifestHash: sha256(manifestBytes), artifactCount: records.size };
}

function verifyQualityArtifacts(input, directory) {
  if (!directory) return { status: 'BLOCKED', reason_codes: ['artifact_root_required'], manifestHash: null };
  const reasons = [];
  const seenCalls = new Set();
  let resolver;
  try { resolver = createArtifactResolver(directory); }
  catch (error) { return { status: 'BLOCKED', reason_codes: [String(error.message)], manifestHash: null }; }
  for (const task of input.tasks || []) {
    for (const arm of ['baseline', 'candidate']) {
      const run = task[arm];
      try {
        const saved = resolver.load(run?.artifact_id).json;
        if (!saved || saved.schemaVersion !== 'quality-ab-generation-artifact-v1') throw new Error('generation_artifact_invalid');
        for (const field of ['generationId', 'input_hash', 'binding', 'versions', 'outputHash', 'qualityVector', 'cost']) {
          if (hashJson(saved[field]) !== hashJson(run[field])) throw new Error(`generation_artifact_binding_mismatch:${field}`);
        }
        const output = resolver.load(saved.outputArtifactId);
        if (sha256(output.bytes) !== run.outputHash || !output.bytes.length) throw new Error('generation_output_hash_mismatch');
        const snapshot = resolver.load(saved.inputArtifactId).json;
        if (!snapshot || hashJson(snapshot) !== task.input_hash) throw new Error('input_snapshot_hash_mismatch');
        const evaluation = resolver.load(saved.evaluationArtifactId).json;
        if (!evaluation || hashJson(evaluation.qualityVector) !== hashJson(run.qualityVector)) throw new Error('evaluation_vector_mismatch');
        let amount = 0;
        for (const id of [saved.generationCallArtifactId, saved.evaluationCallArtifactId]) {
          if (seenCalls.has(id)) throw new Error('provider_call_reused');
          seenCalls.add(id);
          const call = resolver.load(id).json;
          if (!call || call.status !== 'RECORDED' || hashJson(call.binding) !== hashJson(run.binding) || call.response?.model !== run.binding?.model || hashJson(call.usage) !== hashJson(call.response?.usage)) throw new Error('provider_call_binding_mismatch');
          if (!call.request || call.request.model !== run.binding.model || hashJson(call.request.modelParameters || {}) !== run.binding.modelParametersHash || !Number.isInteger(call.request.max_tokens) || call.request.max_tokens < 1 || !Array.isArray(call.request.messages)) throw new Error('provider_request_binding_missing');
          if (hashJson(call.versions) !== hashJson(run.versions) || call.configurationHash !== input.configurationHashes?.[arm]) throw new Error('provider_configuration_binding_mismatch');
          const usage = call.usage, pricing = call.pricing;
          if (!Number.isInteger(usage?.prompt_tokens) || !Number.isInteger(usage?.completion_tokens) || usage.prompt_tokens < 0 || usage.completion_tokens < 0 || !Number.isFinite(pricing?.inputPerMillion) || !Number.isFinite(pricing?.outputPerMillion) || pricing.inputPerMillion < 0 || pricing.outputPerMillion < 0 || pricing.currency !== call.currency || call.currency !== run.cost?.currency) throw new Error('cost_usage_pricing_invalid');
          const recomputed = (usage.prompt_tokens * pricing.inputPerMillion + usage.completion_tokens * pricing.outputPerMillion) / 1e6;
          if (typeof call.amount !== 'number' || Math.abs(call.amount - recomputed) > 1e-10) throw new Error('provider_call_amount_mismatch');
          amount += recomputed;
        }
        if (typeof run.cost?.amount !== 'number' || Math.abs(run.cost.amount - amount) > 1e-10) throw new Error('generation_cost_amount_mismatch');
        const generationCall = resolver.load(saved.generationCallArtifactId).json;
        if (generationCall.response?.choices?.[0]?.message?.content !== output.bytes.toString('utf8')) throw new Error('provider_output_content_mismatch');
        const evaluationCall = resolver.load(saved.evaluationCallArtifactId).json;
        if (evaluationCall.request.messages?.[1]?.content !== JSON.stringify({ task: snapshot, text: output.bytes.toString('utf8') })) throw new Error('provider_evaluation_input_mismatch');
        const rawVector = JSON.parse(evaluationCall.response?.choices?.[0]?.message?.content).qualityVector;
        const withoutRefs = vector => {
          const copy = structuredClone(vector);
          for (const score of Object.values(copy?.dimensions || {})) delete score.evidence_refs;
          return copy;
        };
        if (hashJson(withoutRefs(rawVector)) !== hashJson(withoutRefs(run.qualityVector))) throw new Error('provider_evaluation_vector_mismatch');
        const refs = [...Object.values(run.qualityVector?.dimensions || {}).flatMap(score => score.evidence_refs || []), ...(run.cost?.evidence_refs || [])];
        for (const ref of refs) resolver.resolve(ref);
      } catch (error) { reasons.push(`${task.task_id}:${arm}:${error.message}`); }
    }
  }
  for (const [type, entries] of [['category', input.safety_gate?.categoryResults], ['metric', input.safety_gate?.metricValues]]) {
    for (const [name, entry] of Object.entries(entries || {})) {
      let matched = false;
      for (const ref of Array.isArray(entry?.evidence_refs) ? entry.evidence_refs : []) {
        try {
          const evidence = resolver.resolve(ref);
          if (evidence && typeof evidence === 'object' && (type === 'category'
            ? evidence.status === entry.status
            : evidence.baseline === entry.baseline && evidence.candidate === entry.candidate)) matched = true;
        } catch (error) { reasons.push(`safety:${error.message}`); }
      }
      if (!matched) reasons.push(`safety_evidence_value_mismatch:${type}:${name}`);
    }
  }
  return { status: reasons.length ? 'BLOCKED' : 'PASS', reason_codes: [...new Set(reasons)], manifestHash: resolver.manifestHash, artifactCount: resolver.artifactCount };
}

module.exports = { sha256, createArtifactResolver, verifyQualityArtifacts };
