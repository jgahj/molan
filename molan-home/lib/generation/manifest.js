'use strict';

const crypto = require('node:crypto');

/** 递归排序对象键，保持同一输入得到同一序列化结果（具备循环引用、BigInt、Symbol、Date/Set/Map 及异常 Getter 免疫保护）。 */
function stableValue(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return null;
  if (typeof value !== 'object') return value;

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map(v => stableValue(v, seen));
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  }
  if (value instanceof RegExp) {
    return value.toString();
  }
  if (value instanceof Set) {
    return Array.from(value).map(v => stableValue(v, seen));
  }
  if (value instanceof Map) {
    const entries = Array.from(value.entries()).map(([k, v]) => [String(k), stableValue(v, seen)]);
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    return Object.fromEntries(entries);
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, code: value.code };
  }

  let keys = [];
  try {
    keys = Object.keys(value).sort();
  } catch (_) {
    return String(value);
  }

  return keys.reduce((result, key) => {
    try {
      const val = value[key];
      if (val !== undefined) result[key] = stableValue(val, seen);
    } catch (_) {
      result[key] = '[Unreadable]';
    }
    return result;
  }, {});
}

/** 计算 JSON 值的 SHA-256，供上下文、合同和正文校验使用。 */
function hashValue(value) {
  let serialized;
  if (typeof value === 'string') {
    serialized = value;
  } else {
    try {
      serialized = JSON.stringify(stableValue(value));
    } catch (_) {
      serialized = String(value);
    }
  }
  return crypto.createHash('sha256').update(String(serialized == null ? '' : serialized), 'utf8').digest('hex');
}

/** 为一次生成记录代码、模型、提示、状态与输出版本指纹。 */
function buildGenerationManifest(input = {}) {
  const manifest = {
    schemaVersion: 1,
    generationId: String(input.generationId || ''),
    projectId: String(input.projectId || ''),
    branchId: String(input.branchId || 'main'),
    chapterId: String(input.chapterId || ''),
    codeVersion: String(input.codeVersion || 'unknown'),
    pipelineVersion: String(input.pipelineVersion || 'generation-v2.1'),
    genreEngineVersion: String(input.genreEngineVersion || 'genre-1'),
    styleVersion: String(input.styleVersion || 'style-1'),
    benchmarkVersion: String(input.benchmarkVersion || 'benchmark-1'),
    modelId: String(input.modelId || ''),
    providerModel: String(input.providerModel || ''),
    promptVersion: String(input.promptVersion || 'writer-1'),
    storyBibleVersion: Number(input.storyBibleVersion) || 0,
    stateVersion: Number(input.stateVersion) || 0,
    stateSnapshotHash: String(input.stateSnapshotHash || ''),
    styleBundleHash: String(input.styleBundleHash || ''),
    genreBundleHash: String(input.genreBundleHash || ''),
    contextHash: String(input.contextHash || ''),
    contractHash: String(input.contractHash || ''),
    promptHash: String(input.promptHash || ''),
    outputHash: String(input.outputHash || ''),
    createdAt: Number(input.createdAt) || Date.now()
  };
  return Object.freeze(manifest);
}

module.exports = { stableValue, hashValue, buildGenerationManifest };
