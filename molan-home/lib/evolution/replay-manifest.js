'use strict';

const { createHash } = require('node:crypto');

const ARTIFACT_NAMES = ['bible', 'outline', 'chapterContract', 'contextSnapshot'];

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined || (typeof value === 'number' && !Number.isFinite(value))) {
      throw new TypeError('Replay 输入必须是有限、可序列化的 JSON 值');
    }
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Replay 输入只允许普通 JSON 对象');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function hashJson(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function requiredString(value, field) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new TypeError(`${field} 必填`);
  return normalized;
}

function normalizedArtifact(name, artifact) {
  const ref = requiredString(artifact && (artifact.ref || artifact.artifactRef), `${name}.ref`);
  if (!artifact || !Object.hasOwn(artifact, 'snapshot')) throw new TypeError(`${name}.snapshot 必填`);
  return { ref, hash: hashJson(artifact.snapshot) };
}

function manifestPayload(input) {
  const artifacts = Object.fromEntries(ARTIFACT_NAMES.map(name => [name, normalizedArtifact(name, input.artifacts && input.artifacts[name])]));
  const parameters = input.parameters;
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    throw new TypeError('parameters 必须是 JSON 对象');
  }
  canonicalJson(parameters);
  return {
    schemaVersion: 'generation-replay-manifest-v1',
    sourceGenerationId: requiredString(input.sourceGenerationId, 'sourceGenerationId'),
    pipelineVersion: requiredString(input.pipelineVersion, 'pipelineVersion'),
    promptVersion: requiredString(input.promptVersion, 'promptVersion'),
    genreProfileVersion: requiredString(input.genreProfileVersion, 'genreProfileVersion'),
    styleVersion: requiredString(input.styleVersion, 'styleVersion'),
    model: requiredString(input.model, 'model'),
    parameters: JSON.parse(canonicalJson(parameters)),
    artifact_refs: Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [key, value.ref])),
    artifact_hashes: Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [key, value.hash])),
    contextHash: artifacts.contextSnapshot.hash,
    contractHash: artifacts.chapterContract.hash
  };
}

function buildReplayManifest(input = {}) {
  const payload = manifestPayload(input);
  return { ...payload, manifestHash: hashJson(payload) };
}

function verifyReplayManifest(manifest, artifacts = {}) {
  if (!manifest || manifest.schemaVersion !== 'generation-replay-manifest-v1') {
    return { status: 'invalid_manifest', valid: false, mismatches: ['manifest.schemaVersion'] };
  }
  const mismatches = [];
  for (const field of ['sourceGenerationId', 'pipelineVersion', 'promptVersion', 'genreProfileVersion', 'styleVersion', 'model']) {
    if (typeof manifest[field] !== 'string' || !manifest[field].trim()) mismatches.push(field);
  }
  if (!manifest.parameters || typeof manifest.parameters !== 'object' || Array.isArray(manifest.parameters)) {
    mismatches.push('parameters');
  }
  if (!manifest.artifact_refs || typeof manifest.artifact_refs !== 'object' ||
      !manifest.artifact_hashes || typeof manifest.artifact_hashes !== 'object') {
    mismatches.push('artifact_metadata');
  }
  for (const name of ARTIFACT_NAMES) {
    const artifact = artifacts[name];
    if (!artifact || String(artifact.ref || artifact.artifactRef || '') !== manifest.artifact_refs?.[name]) {
      mismatches.push(`${name}.ref`);
      continue;
    }
    let actualHash;
    try {
      actualHash = hashJson(Object.hasOwn(artifact, 'snapshot') ? artifact.snapshot : artifact.value);
    } catch {
      mismatches.push(`${name}.snapshot`);
      continue;
    }
    if (!/^[a-f0-9]{64}$/.test(String(manifest.artifact_hashes?.[name] || '')) ||
        actualHash !== manifest.artifact_hashes[name]) mismatches.push(`${name}.hash`);
  }
  if (manifest.contextHash !== manifest.artifact_hashes?.contextSnapshot) mismatches.push('contextHash');
  if (manifest.contractHash !== manifest.artifact_hashes?.chapterContract) mismatches.push('contractHash');
  try {
    const expectedManifestHash = hashJson(Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'manifestHash')));
    if (expectedManifestHash !== manifest.manifestHash) mismatches.push('manifestHash');
  } catch {
    mismatches.push('manifestHash');
  }
  return { status: mismatches.length ? 'mismatch' : 'verified', valid: mismatches.length === 0, mismatches };
}

/** Create a replay variant changing only the prompt or pipeline version. */
function buildReplayVariant(manifest, overrides = {}) {
  const allowed = new Set(['pipelineVersion', 'promptVersion']);
  const unknown = Object.keys(overrides).filter(key => !allowed.has(key));
  if (unknown.length) throw new TypeError(`Replay 变量不支持改变: ${unknown.join(', ')}`);
  const payload = Object.fromEntries(Object.entries(manifest || {}).filter(([key]) => key !== 'manifestHash'));
  if (payload.schemaVersion !== 'generation-replay-manifest-v1') throw new TypeError('无效的 Replay Manifest');
  const expectedManifestHash = hashJson(payload);
  if (expectedManifestHash !== manifest.manifestHash) throw new TypeError('Replay Manifest 哈希校验失败');
  if (Object.hasOwn(overrides, 'pipelineVersion')) payload.pipelineVersion = requiredString(overrides.pipelineVersion, 'pipelineVersion');
  if (Object.hasOwn(overrides, 'promptVersion')) payload.promptVersion = requiredString(overrides.promptVersion, 'promptVersion');
  payload.sourceManifestHash = manifest.manifestHash;
  return { ...payload, manifestHash: hashJson(payload) };
}

module.exports = {
  ARTIFACT_NAMES,
  canonicalJson,
  hashJson,
  buildReplayManifest,
  verifyReplayManifest,
  buildReplayVariant
};
