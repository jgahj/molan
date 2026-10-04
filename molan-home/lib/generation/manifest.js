'use strict';

const crypto = require('node:crypto');

/** 递归排序对象键，保持同一输入得到同一序列化结果。 */
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = stableValue(value[key]);
    return result;
  }, {});
}

/** 计算 JSON 值的 SHA-256，供上下文、合同和正文校验使用。 */
function hashValue(value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(stableValue(value));
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
