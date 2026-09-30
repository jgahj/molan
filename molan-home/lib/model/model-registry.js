'use strict';

/**
 * model-registry.js
 * ---------------------------------------------------------------------------
 * 统一大模型能力注册表 (Unified Model Capability Registry)
 *
 * 遵循第十六、四十一、四十二条规范：
 * 1. 唯一管理模型上下文上限 (contextWindow)、最大输出 (maxOutputTokens)；
 * 2. 标明推理模式 (reasoning)、JSON 结构化、流式与 Seed 支持；
 * 3. 杜绝 if (model.includes('gpt')) 等散落逻辑。
 * ---------------------------------------------------------------------------
 */

const MODEL_REGISTRY = new Map([
  ['gpt-5.6-luna', {
    modelId: 'gpt-5.6-luna',
    displayName: 'Luna 创作旗舰 (GPT-5.6-Luna)',
    contextWindow: 128000,
    maxOutputTokens: 16000,
    supportsReasoning: true,
    reasoningModes: ['low', 'medium', 'high'],
    supportsJson: true,
    supportsSeed: true,
    supportsCaching: true,
    supportsStream: true,
    recommendedRole: 'writer',
    tokenizer: 'o200k_base',
    cjkTokenRatio: 0.70,
    nonCjkTokenRatio: 0.30
  }],
  ['gpt-4o', {
    modelId: 'gpt-4o',
    displayName: 'OpenAI GPT-4o',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsReasoning: false,
    reasoningModes: [],
    supportsJson: true,
    supportsSeed: true,
    supportsCaching: true,
    supportsStream: true,
    recommendedRole: 'general',
    tokenizer: 'o200k_base',
    cjkTokenRatio: 0.72,
    nonCjkTokenRatio: 0.30
  }],
  ['gpt-4o-mini', {
    modelId: 'gpt-4o-mini',
    displayName: 'OpenAI GPT-4o-Mini',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsReasoning: false,
    reasoningModes: [],
    supportsJson: true,
    supportsSeed: true,
    supportsCaching: true,
    supportsStream: true,
    recommendedRole: 'judge',
    tokenizer: 'o200k_base',
    cjkTokenRatio: 0.72,
    nonCjkTokenRatio: 0.30
  }],
  ['gpt-4', {
    modelId: 'gpt-4',
    displayName: 'OpenAI GPT-4',
    contextWindow: 32768,
    maxOutputTokens: 4096,
    supportsReasoning: false,
    reasoningModes: [],
    supportsJson: true,
    supportsSeed: false,
    supportsCaching: false,
    supportsStream: true,
    recommendedRole: 'general',
    tokenizer: 'cl100k_base',
    cjkTokenRatio: 0.85,
    nonCjkTokenRatio: 0.32
  }],
  ['claude-3-5-sonnet', {
    modelId: 'claude-3-5-sonnet',
    displayName: 'Anthropic Claude 3.5 Sonnet',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    supportsReasoning: false,
    reasoningModes: [],
    supportsJson: true,
    supportsSeed: false,
    supportsCaching: true,
    supportsStream: true,
    recommendedRole: 'writer',
    tokenizer: 'claude',
    cjkTokenRatio: 0.75,
    nonCjkTokenRatio: 0.30
  }],
  ['claude-3-opus', {
    modelId: 'claude-3-opus',
    displayName: 'Anthropic Claude 3 Opus',
    contextWindow: 200000,
    maxOutputTokens: 4096,
    supportsReasoning: false,
    reasoningModes: [],
    supportsJson: true,
    supportsSeed: false,
    supportsCaching: false,
    supportsStream: true,
    recommendedRole: 'planner',
    tokenizer: 'claude',
    cjkTokenRatio: 0.78,
    nonCjkTokenRatio: 0.30
  }],
  ['deepseek-chat', {
    modelId: 'deepseek-chat',
    displayName: 'DeepSeek V3',
    contextWindow: 64000,
    maxOutputTokens: 8192,
    supportsReasoning: false,
    reasoningModes: [],
    supportsJson: true,
    supportsSeed: true,
    supportsCaching: true,
    supportsStream: true,
    recommendedRole: 'general',
    tokenizer: 'deepseek',
    cjkTokenRatio: 0.72,
    nonCjkTokenRatio: 0.28
  }],
  ['deepseek-reasoner', {
    modelId: 'deepseek-reasoner',
    displayName: 'DeepSeek R1',
    contextWindow: 64000,
    maxOutputTokens: 8192,
    supportsReasoning: true,
    reasoningModes: ['default'],
    supportsJson: false,
    supportsSeed: false,
    supportsCaching: true,
    supportsStream: true,
    recommendedRole: 'judge',
    tokenizer: 'deepseek',
    cjkTokenRatio: 0.72,
    nonCjkTokenRatio: 0.28
  }],
  ['qwen-plus', {
    modelId: 'qwen-plus',
    displayName: '通义千问 Plus',
    contextWindow: 128000,
    maxOutputTokens: 8192,
    supportsReasoning: false,
    reasoningModes: [],
    supportsJson: true,
    supportsSeed: true,
    supportsCaching: false,
    supportsStream: true,
    recommendedRole: 'general',
    tokenizer: 'qwen',
    cjkTokenRatio: 0.68,
    nonCjkTokenRatio: 0.28
  }],
  ['qwen-max', {
    modelId: 'qwen-max',
    displayName: '通义千问 Max',
    contextWindow: 32768,
    maxOutputTokens: 8192,
    supportsReasoning: false,
    reasoningModes: [],
    supportsJson: true,
    supportsSeed: true,
    supportsCaching: false,
    supportsStream: true,
    recommendedRole: 'writer',
    tokenizer: 'qwen',
    cjkTokenRatio: 0.68,
    nonCjkTokenRatio: 0.28
  }],
  ['standard-local', {
    modelId: 'standard-local',
    displayName: '本地离线模型',
    contextWindow: 32768,
    maxOutputTokens: 4096,
    supportsReasoning: false,
    reasoningModes: [],
    supportsJson: true,
    supportsSeed: false,
    supportsCaching: false,
    supportsStream: true,
    recommendedRole: 'general',
    tokenizer: 'standard',
    cjkTokenRatio: 0.75,
    nonCjkTokenRatio: 0.30
  }],
  ['default', {
    modelId: 'default',
    displayName: '默认兜底配置',
    contextWindow: 64000,
    maxOutputTokens: 8192,
    supportsReasoning: false,
    reasoningModes: [],
    supportsJson: true,
    supportsSeed: false,
    supportsCaching: false,
    supportsStream: true,
    recommendedRole: 'general',
    tokenizer: 'standard',
    cjkTokenRatio: 0.75,
    nonCjkTokenRatio: 0.30
  }]
]);

/**
 * 获取指定模型的完整能力规范
 * @param {string} modelId 模型标识
 * @returns {Object} 模型能力描述对象
 */
function getModelCapability(modelId = '') {
  const normalizedId = String(modelId || '').trim();
  if (MODEL_REGISTRY.has(normalizedId)) {
    return { ...MODEL_REGISTRY.get(normalizedId) };
  }

  // 模糊前缀匹配 (如 gpt-5.6-luna-2026 -> gpt-5.6-luna)
  for (const [id, config] of MODEL_REGISTRY) {
    if (id !== 'default' && normalizedId.startsWith(id)) {
      return { ...config, modelId: normalizedId };
    }
  }

  return { ...MODEL_REGISTRY.get('default'), modelId: normalizedId || 'default' };
}

/**
 * 估算给定文本在目标模型下的 Token 消耗
 * @param {string|Object} text 输入内容
 * @param {string} modelId 目标模型
 * @param {Object} [options] 额外参数（如 safetyMargin）
 * @returns {number} 估算 token 数量
 */
function estimateTokensWithCapability(text, modelId = 'default', options = {}) {
  if (text == null) return 0;
  const str = typeof text === 'string' ? text : JSON.stringify(text);
  if (!str) return 0;

  const capability = getModelCapability(modelId);
  const cjkMatches = str.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const nonCjkCount = str.length - cjkCount;

  const cjkRatio = capability.cjkTokenRatio || 0.75;
  const nonCjkRatio = capability.nonCjkTokenRatio || 0.30;
  const rawTokens = Math.ceil(cjkCount * cjkRatio + nonCjkCount * nonCjkRatio);

  const safetyMargin = Number(options.safetyMargin) || 1.05; // 默认 5% 安全裕度
  return Math.ceil(rawTokens * safetyMargin);
}

/**
 * 获取所有受支持的模型清单
 */
function listSupportedModels() {
  return Array.from(MODEL_REGISTRY.values()).filter(m => m.modelId !== 'default');
}

module.exports = {
  getModelCapability,
  estimateTokensWithCapability,
  listSupportedModels
};
