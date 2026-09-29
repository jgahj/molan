'use strict';

const { GenerationError } = require('./errors');
const { hashValue } = require('./manifest');

const CONTEXT_VERSION = '3';
const PRIORITY = Object.freeze({
  sceneContract: 0, hardState: 0, povKnowledge: 0, immediateTimeline: 0, activeCausalDebt: 0,
  characters: 1, location: 1, worldRules: 1, relationships: 1, volumeState: 1,
  recentChapters: 2, foreshadows: 2, styleSamples: 2,
  distantPlot: 3, historicalFacts: 3
});

/** 按固定优先级压缩故事上下文并保留可重放的裁剪记录。 */
function assembleContext(input = {}, options = {}) {
  const maxChars = Math.max(1000, Number(options.maxChars) || 48000);
  const rawBlocks = [];
  for (const [key, priority] of Object.entries(PRIORITY)) {
    const content = input[key];
    if (content == null || content === '') continue;
    const normalized = typeof content === 'string' ? content : JSON.stringify(content);
    rawBlocks.push({ id: key, priority, required: priority === 0, content: normalized, plainText: typeof content === 'string' });
  }
  const ordered = rawBlocks.sort((a, b) => a.priority - b.priority);
  let remaining = maxChars;
  const includedBlocks = [];
  const truncatedBlocks = [];
  const omittedBlocks = [];
  for (const block of ordered) {
    if (block.content.length <= remaining) {
      includedBlocks.push({ id: block.id, content: block.content });
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
      includedBlocks.push({ id: block.id, content: block.content.slice(0, end) });
      truncatedBlocks.push(block.id);
      remaining -= end;
    } else {
      omittedBlocks.push(block.id);
    }
  }
  const contextText = includedBlocks.map(block => `[${block.id}]\n${block.content}`).join('\n\n');
  const contextPlan = {
    contextPlanVersion: CONTEXT_VERSION,
    requiredBlocks: ordered.filter(block => block.required).map(block => block.id),
    includedBlocks: includedBlocks.map(block => block.id),
    truncatedBlocks,
    omittedBlocks,
    promptTokens: Math.ceil(contextText.length / 2),
    dynamicTokens: Math.ceil(contextText.length / 2),
    outputReserve: Math.max(0, Number(options.outputReserve) || 0),
    contextHash: hashValue(contextText)
  };
  return { text: contextText, blocks: includedBlocks, contextPlan };
}

module.exports = { CONTEXT_VERSION, PRIORITY, assembleContext };
