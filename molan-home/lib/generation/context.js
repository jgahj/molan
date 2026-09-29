'use strict';

const { GenerationError } = require('./errors');
const { hashValue } = require('./manifest');
const { estimateTokens, DEFAULT_PROVIDER_CONTEXT_LIMITS } = require('./context-budget');

const CONTEXT_VERSION = '4';

/**
 * 8 大固定上下文层级 (Context Layers)
 * L0 current: 当前场景/微观目标/即时指令
 * L1 scene: 场景规划与当前场次
 * L2 chapter: 章节合同与本章核心目标
 * L3 recent: 近期章节承接与上一章结尾
 * L4 volume: 分卷大纲与长线走向
 * L5 facts: 实体状态、人物关系与硬状态事实账本
 * L6 world axioms: 世界法则、视角知识与禁忌
 * L7 causal debt: 活跃因果债务与伏笔
 */
const CONTEXT_LAYERS = Object.freeze([
  'L0_current',
  'L1_scene',
  'L2_chapter',
  'L3_recent',
  'L4_volume',
  'L5_facts',
  'L6_world_axioms',
  'L7_causal_debt'
]);

/** 块标识到 Context Layer 的标准映射 */
const BLOCK_TO_LAYER = Object.freeze({
  sceneContract: 'L0_current',
  immediateTimeline: 'L0_current',
  instruction: 'L0_current',
  currentTask: 'L0_current',

  scenes: 'L1_scene',
  scenePlan: 'L1_scene',
  location: 'L1_scene',

  chapterContract: 'L2_chapter',
  chapterGoal: 'L2_chapter',

  recentChapters: 'L3_recent',
  previousEnding: 'L3_recent',

  volumeState: 'L4_volume',
  arcGoals: 'L4_volume',
  distantPlot: 'L4_volume',

  characters: 'L5_facts',
  relationships: 'L5_facts',
  hardState: 'L5_facts',
  factLedger: 'L5_facts',
  historicalFacts: 'L5_facts',

  worldRules: 'L6_world_axioms',
  povKnowledge: 'L6_world_axioms',
  forbiddenKnowledge: 'L6_world_axioms',
  axioms: 'L6_world_axioms',
  styleSamples: 'L6_world_axioms',

  activeCausalDebt: 'L7_causal_debt',
  causalDebt: 'L7_causal_debt',
  foreshadows: 'L7_causal_debt',
  promises: 'L7_causal_debt'
});

const PRIORITY = Object.freeze({
  sceneContract: 0, hardState: 0, povKnowledge: 0, immediateTimeline: 0, activeCausalDebt: 0, chapterContract: 0,
  characters: 1, location: 1, worldRules: 1, relationships: 1, volumeState: 1, scenes: 1, scenePlan: 1,
  recentChapters: 2, previousEnding: 2, foreshadows: 2, styleSamples: 2,
  distantPlot: 3, historicalFacts: 3
});

/** 按固定优先级与 8 大分层压缩故事上下文并保留可重放的裁剪记录。 */
function assembleContext(input = {}, options = {}) {
  const maxChars = Math.max(1000, Number(options.maxChars) || 48000);
  const rawBlocks = [];
  for (const [key, content] of Object.entries(input)) {
    if (content == null || content === '') continue;
    const priority = PRIORITY[key] !== undefined ? PRIORITY[key] : 2;
    const layer = BLOCK_TO_LAYER[key] || 'L5_facts';
    const normalized = typeof content === 'string' ? content : JSON.stringify(content);
    rawBlocks.push({
      id: key,
      layer,
      priority,
      required: priority === 0,
      content: normalized,
      plainText: typeof content === 'string'
    });
  }
  const ordered = rawBlocks.sort((a, b) => a.priority - b.priority);
  let remaining = maxChars;
  const includedBlocks = [];
  const truncatedBlocks = [];
  const omittedBlocks = [];
  for (const block of ordered) {
    if (block.content.length <= remaining) {
      includedBlocks.push({ id: block.id, layer: block.layer, content: block.content });
      remaining -= block.content.length;
      continue;
    }
    if (block.required) {
      throw new GenerationError('CONTEXT_OVERFLOW', `必要上下文 ${block.id} 超出预算`, { status: 413, details: { maxChars } });
    }
    const boundary = block.plainText
      ? Math.max(block.content.lastIndexOf('\n\n', remaining), block.content.lastIndexOf('\n', remaining), block.content.lastIndexOf('。', remaining), block.content.lastIndexOf('. ', remaining))
      : -1;
    if (!block.required && boundary >= 200) {
      const end = boundary + 1;
      includedBlocks.push({ id: block.id, layer: block.layer, content: block.content.slice(0, end) });
      truncatedBlocks.push(block.id);
      remaining -= end;
    } else {
      omittedBlocks.push(block.id);
    }
  }

  const contextText = includedBlocks.map(block => `[${block.id}]\n${block.content}`).join('\n\n');

  // 构建统一的 8 层分层结构与 Token 统计
  const layers = {};
  const layerTokens = {};
  for (const l of CONTEXT_LAYERS) {
    layers[l] = [];
    layerTokens[l] = 0;
  }
  for (const b of includedBlocks) {
    const l = b.layer || 'L5_facts';
    if (!layers[l]) layers[l] = [];
    layers[l].push(b.id);
    const tokens = estimateTokens(b.content);
    layerTokens[l] = (layerTokens[l] || 0) + tokens;
  }

  const provider = String(options.provider || 'default');
  const model = String(options.model || options.modelId || 'default');
  const hardLimit = Number(options.hardLimit || options.providerContextLimit) ||
    DEFAULT_PROVIDER_CONTEXT_LIMITS[model] ||
    DEFAULT_PROVIDER_CONTEXT_LIMITS.default;
  const outputReserve = Math.max(0, Number(options.outputReserve) || Math.ceil((Number(options.targetWords) || 2400) * 1.6));
  const systemTokens = estimateTokens(options.system || options.systemPrompt || '');

  // 映射 token 归属
  const contractTokens = (layerTokens.L0_current || 0) + (layerTokens.L2_chapter || 0);
  const memoryTokens = (layerTokens.L5_facts || 0) + (layerTokens.L7_causal_debt || 0);
  const storyTokens = (layerTokens.L1_scene || 0) + (layerTokens.L4_volume || 0) + (layerTokens.L6_world_axioms || 0);
  const recentTokens = layerTokens.L3_recent || 0;
  const contextTokens = memoryTokens + storyTokens + recentTokens;
  const promptTokens = contractTokens + contextTokens;
  const dynamicTokens = contextTokens;
  const availableInputTokens = Math.max(0, hardLimit - outputReserve - systemTokens);
  const totalRequired = systemTokens + contractTokens + contextTokens + outputReserve;
  const fits = totalRequired <= hardLimit;
  const margin = hardLimit - totalRequired;

  const contextPlan = {
    contextPlanVersion: CONTEXT_VERSION,
    provider,
    model,
    hardLimit,
    outputReserve,
    systemTokens,
    contractTokens,
    memoryTokens,
    storyTokens,
    recentTokens,
    availableInputTokens,
    layers,
    layerTokens,
    requiredBlocks: ordered.filter(block => block.required).map(block => block.id),
    includedBlocks: includedBlocks.map(block => block.id),
    truncatedBlocks,
    omittedBlocks,
    promptTokens,
    dynamicTokens,
    totalRequired,
    fits,
    margin,
    contextHash: hashValue(contextText)
  };

  return { text: contextText, blocks: includedBlocks, contextPlan };
}

module.exports = {
  CONTEXT_VERSION,
  CONTEXT_LAYERS,
  BLOCK_TO_LAYER,
  PRIORITY,
  assembleContext
};
