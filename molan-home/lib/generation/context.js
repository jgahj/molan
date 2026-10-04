'use strict';

const { GenerationError } = require('./errors');
const { hashValue } = require('./manifest');
const { estimateTokens, DEFAULT_PROVIDER_CONTEXT_LIMITS } = require('./context-budget');
const { getModelCapability } = require('../model/model-registry');

const CONTEXT_VERSION = '4';
const CONTEXT_STRATEGY_VERSION = 'deterministic-context-compiler-v5';
const CONTEXT_LAYERS = Object.freeze([
  'L0_current', 'L1_scene', 'L2_chapter', 'L3_recent',
  'L4_volume', 'L5_facts', 'L6_world_axioms', 'L7_causal_debt'
]);

const BLOCK_TO_LAYER = Object.freeze({
  sceneContract: 'L0_current', immediateTimeline: 'L0_current', instruction: 'L0_current',
  currentTask: 'L0_current', requiredPayoff: 'L0_current', requiredCausalPayoff: 'L0_current',
  scenes: 'L1_scene', scenePlan: 'L1_scene', location: 'L1_scene',
  chapterContract: 'L2_chapter', chapterGoal: 'L2_chapter',
  recentChapters: 'L3_recent', previousEnding: 'L3_recent',
  volumeState: 'L4_volume', arcGoals: 'L4_volume', distantPlot: 'L4_volume',
  characters: 'L5_facts', relationships: 'L5_facts', hardState: 'L5_facts',
  factLedger: 'L5_facts', historicalFacts: 'L5_facts',
  worldRules: 'L6_world_axioms', worldProhibitions: 'L6_world_axioms',
  povKnowledge: 'L6_world_axioms', forbiddenKnowledge: 'L6_world_axioms',
  axioms: 'L6_world_axioms', styleSamples: 'L6_world_axioms', genreMechanisms: 'L6_world_axioms',
  activeCausalDebt: 'L7_causal_debt', causalDebt: 'L7_causal_debt',
  distantCausalDebtSummary: 'L7_causal_debt', foreshadows: 'L7_causal_debt', promises: 'L7_causal_debt'
});

const PRIORITY = Object.freeze({
  sceneContract: 0, currentTask: 0, instruction: 0, chapterGoal: 0, requiredPayoff: 0, requiredCausalPayoff: 0,
  hardState: 0, povKnowledge: 0, forbiddenKnowledge: 0, worldProhibitions: 0,
  worldRules: 0, axioms: 0, immediateTimeline: 0, chapterContract: 0,
  characters: 1, location: 1, relationships: 1, volumeState: 1, scenes: 1, scenePlan: 1,
  activeCausalDebt: 1, causalDebt: 1,
  recentChapters: 2, previousEnding: 2, foreshadows: 2, styleSamples: 2, genreMechanisms: 2,
  distantPlot: 3, distantCausalDebtSummary: 3, historicalFacts: 3
});
const BLOCK_ORDER = Object.freeze([
  'sceneContract', 'currentTask', 'instruction', 'chapterGoal', 'requiredPayoff', 'requiredCausalPayoff',
  'hardState', 'povKnowledge', 'forbiddenKnowledge', 'worldProhibitions', 'worldRules', 'axioms',
  'immediateTimeline', 'chapterContract', 'characters', 'location', 'relationships', 'volumeState',
  'scenes', 'scenePlan', 'activeCausalDebt', 'causalDebt', 'recentChapters', 'previousEnding',
  'foreshadows', 'styleSamples', 'genreMechanisms', 'distantPlot', 'distantCausalDebtSummary', 'historicalFacts'
]);

function asText(content) {
  if (typeof content === 'string') return content;
  return JSON.stringify(content);
}

function listValues(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  return [value];
}

function normalizeTag(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
}

function tagsFrom(value) {
  if (Array.isArray(value)) return value.flatMap(tagsFrom);
  if (value == null || value === '') return [];
  if (typeof value === 'string') return value.split(/[,，;；|/\s]+/).map(normalizeTag).filter(Boolean);
  if (typeof value === 'object') return tagsFrom(value.id || value.name || value.tag || value.value);
  return [normalizeTag(value)].filter(Boolean);
}

function sceneTagsFor(input, options) {
  const tags = [
    ...tagsFrom(options.sceneTags),
    ...tagsFrom(input.sceneTags),
    ...tagsFrom(input.sceneContract && (input.sceneContract.sceneTags || input.sceneContract.tags || input.sceneContract.sceneType)),
    ...tagsFrom(input.sceneContract && input.sceneContract.scenes && input.sceneContract.scenes.flatMap(scene => [scene && scene.sceneTags, scene && scene.tags, scene && scene.sceneType])),
    ...tagsFrom(input.scenePlan && input.scenePlan.scenes && input.scenePlan.scenes.flatMap(scene => [scene.sceneTags, scene.tags, scene.sceneType])),
    ...tagsFrom(input.scenes && input.scenes.flatMap(scene => [scene && scene.sceneTags, scene && scene.tags, scene && scene.sceneType]))
  ];
  return [...new Set(tags)].sort();
}

function mechanismList(source) {
  if (Array.isArray(source)) return { items: source, wrap: items => items };
  if (!source || typeof source !== 'object') return null;
  for (const key of ['items', 'mechanisms', 'rules']) {
    if (Array.isArray(source[key])) return { items: source[key], wrap: items => ({ ...source, [key]: items }) };
  }
  return null;
}

function selectGenreMechanisms(source, sceneTags) {
  const list = mechanismList(source);
  if (!list) return { value: source, decisions: [], filtered: false };
  const hasApplicabilityMetadata = list.items.some(item => item && typeof item === 'object' && (
    tagsFrom(item.sceneTags || item.sceneTypes || item.tags || item.sceneType || item.tag).length > 0 ||
    item.core === true || item.generic === true || item.always === true || item.scope != null
  ));
  if (!hasApplicabilityMetadata) {
    return {
      value: source,
      decisions: list.items.map((item, index) => ({
        id: String(item && (item.id || item.mechanismId || item.sourceId || item.name) || `mechanism-${index + 1}`),
        decision: 'included', reason: 'legacy-unclassified-preserved'
      })),
      filtered: false
    };
  }
  const selected = [];
  const decisions = [];
  for (const [index, item] of list.items.entries()) {
    const id = String(item && (item.id || item.mechanismId || item.sourceId || item.name) || `mechanism-${index + 1}`);
    const tags = tagsFrom(item && (item.sceneTags || item.sceneTypes || item.tags || item.sceneType || item.tag));
    const scope = normalizeTag(item && item.scope);
    const generic = Boolean(item && (item.core === true || item.generic === true || item.always === true ||
      ['core', 'generic', 'universal', 'always'].includes(scope)));
    if (generic) {
      selected.push(item);
      decisions.push({ id, decision: 'included', reason: 'generic-core' });
    } else if (!tags.length) {
      decisions.push({ id, decision: 'excluded', reason: 'missing-scene-tags-and-not-core' });
    } else if (!sceneTags.length) {
      decisions.push({ id, decision: 'excluded', reason: 'scene-tags-missing' });
    } else if (tags.some(tag => sceneTags.includes(tag))) {
      selected.push(item);
      decisions.push({ id, decision: 'included', reason: 'scene-tag-match', matchedTags: tags.filter(tag => sceneTags.includes(tag)) });
    } else {
      decisions.push({ id, decision: 'excluded', reason: 'no-scene-tag-match' });
    }
  }
  return { value: list.wrap(selected), decisions, filtered: true };
}

function getDebtItems(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return null;
  for (const key of ['items', 'debts', 'active', 'causalDebts']) {
    if (Array.isArray(value[key])) return value[key];
  }
  return null;
}

function getCurrentChapter(input, options) {
  const contract = input.sceneContract || {};
  const volumeState = input.volumeState && typeof input.volumeState === 'object' ? input.volumeState : {};
  const chapterContext = input.chapterContext && typeof input.chapterContext === 'object' ? input.chapterContext : {};
  const value = options.currentChapterNo ?? input.currentChapterNo ?? input.chapterNo ??
    contract.currentChapterNo ?? contract.chapterNo ?? volumeState.currentChapterNo ?? chapterContext.chapterNo ?? chapterContext.chapterNumber;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function getCurrentVolumeId(input, options) {
  const contract = input.sceneContract || {};
  const volume = input.volumeState && typeof input.volumeState === 'object' ? input.volumeState : {};
  return String(options.currentVolumeId || input.currentVolumeId || input.volumeId ||
    contract.currentVolumeId || contract.volumeId || volume.currentVolumeId || volume.volumeId || volume.id || '');
}

function getCurrentCharacters(input, options) {
  const contract = input.sceneContract || {};
  const values = [options.currentCharacterIds, contract.currentCharacterIds, contract.characters,
    contract.viewpointCharacter, contract.povCharacterId];
  const chars = new Set();
  for (const value of values) {
    for (const item of listValues(value)) {
      const id = typeof item === 'object' && item ? item.id || item.characterId || item.name : item;
      if (id != null && String(id).trim()) chars.add(String(id).trim());
    }
  }
  return [...chars].sort();
}

function debtIdOf(debt, index) {
  return String(debt && (debt.debtId || debt.id || debt.sourceId) || `debt-${index + 1}`);
}

function debtCharacters(debt) {
  return listValues(debt && (debt.characterIds || debt.relatedCharacterIds || debt.characters || debt.characterId || debt.character))
    .map(value => typeof value === 'object' && value ? value.id || value.characterId || value.name : value)
    .filter(value => value != null).map(String);
}

function summarizeDebt(debt, id) {
  const summary = typeof debt === 'string' ? debt : String(debt && (debt.summary || debt.requiredPayoff || debt.promise || debt.seed || debt.description || debt.text) || '未完成因果债务');
  const result = {
    id,
    sourceId: String(debt && (debt.sourceId || debt.debtId || debt.id) || id),
    summary: summary.slice(0, 240)
  };
  if (debt && typeof debt === 'object') {
    for (const key of ['volumeId', 'currentVolumeId', 'originChapter', 'createdAtChapter', 'dueChapter', 'status']) {
      if (debt[key] != null) result[key] = debt[key];
    }
  }
  const characters = debtCharacters(debt);
  if (characters.length) result.characterIds = [...new Set(characters)].sort();
  return result;
}

function splitCausalDebt(input, options) {
  if (!Object.hasOwn(input, 'activeCausalDebt')) {
    const aliases = ['activeCausalDebts', 'causalDebt', 'causalDebts'];
    const alias = aliases.find(key => input[key] != null);
    if (alias) input.activeCausalDebt = input[alias];
  }
  const raw = input.activeCausalDebt;
  const items = getDebtItems(raw);
  if (!items) return { decisions: [], currentVolumeId: getCurrentVolumeId(input, options), currentChapterNo: getCurrentChapter(input, options), currentCharacterIds: getCurrentCharacters(input, options) };

  const currentVolumeId = getCurrentVolumeId(input, options);
  const currentChapterNo = getCurrentChapter(input, options);
  const currentCharacterIds = getCurrentCharacters(input, options);
  const currentCharacterSet = new Set(currentCharacterIds);
  const hasWindowScope = Boolean(currentVolumeId || currentChapterNo || currentCharacterIds.length);
  const due = [];
  const window = [];
  const distant = [];
  const decisions = [];

  items.forEach((debt, index) => {
    const id = debtIdOf(debt, index);
    const debtVolumeId = String(debt && (debt.currentVolumeId || debt.volumeId) || '');
    const dueChapterRaw = debt && (debt.dueChapter ?? debt.requiredByChapter ?? debt.payoffChapter);
    const dueChapter = Number(dueChapterRaw);
    const isDue = Boolean(debt && (debt.mustPayoff === true || debt.requiredPayoff === true || debt.required === true || debt.dueThisChapter === true)) ||
      (currentChapterNo != null && Number.isFinite(dueChapter) && dueChapter > 0 && dueChapter <= currentChapterNo) ||
      ['due', 'overdue', 'required_payoff'].includes(normalizeTag(debt && debt.status));
    const characters = debtCharacters(debt);
    const involvesCurrentCharacter = characters.some(character => currentCharacterSet.has(character));
    const sameVolume = Boolean(currentVolumeId && debtVolumeId && currentVolumeId === debtVolumeId);
    if (isDue) {
      due.push(debt);
      decisions.push({ id, decision: 'required', reason: 'due-this-chapter-or-overdue' });
    } else if (!hasWindowScope) {
      window.push(debt);
      decisions.push({ id, decision: 'included-window', reason: 'scope-data-missing-retained' });
    } else if (sameVolume || involvesCurrentCharacter) {
      window.push(debt);
      decisions.push({ id, decision: 'included-window', reason: sameVolume ? 'current-volume' : 'involves-current-character' });
    } else {
      distant.push(summarizeDebt(debt, id));
      decisions.push({ id, decision: 'summarized', reason: 'outside-current-volume-and-character-window', sourceId: String(debt && (debt.sourceId || debt.debtId || debt.id) || id) });
    }
  });

  input.activeCausalDebt = window;
  if (due.length) input.requiredCausalPayoff = [...listValues(input.requiredCausalPayoff), ...due];
  if (distant.length) input.distantCausalDebtSummary = distant;
  return { decisions, currentVolumeId, currentChapterNo, currentCharacterIds };
}

function outputReserveFor(options, modelId) {
  if (options.outputReserve != null && Number.isFinite(Number(options.outputReserve))) return Math.max(0, Math.ceil(Number(options.outputReserve)));
  const model = getModelCapability(modelId);
  const targetChars = Number(options.targetChars ?? options.targetWords) || 2400;
  const requestedMax = Number(options.maxOutputTokens) || Math.min(6000, Number(model.maxOutputTokens) || 6000);
  return Math.max(0, Math.min(requestedMax, Math.ceil(targetChars * 1.8)));
}

function renderBlock(block) {
  return `[${block.id}]\n${block.content}`;
}

function contextOverflow(message, details) {
  throw new GenerationError('CONTEXT_OVERFLOW', message, { status: 413, details });
}

function fitPlainText({ block, includedBlocks, maxChars, maxContextTokens, model, wrapperPrefix, wrapperSuffix }) {
  const codePoints = Array.from(block.content);
  let low = 0;
  let high = codePoints.length;
  let best = '';
  const prefix = includedBlocks.length ? '\n\n' : '';
  const current = includedBlocks.map(renderBlock).join('\n\n');
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidateContent = codePoints.slice(0, mid).join('');
    const candidateBlock = { ...block, content: candidateContent };
    const candidateText = current + prefix + renderBlock(candidateBlock);
    const charFits = wrapperPrefix.length + candidateText.length + wrapperSuffix.length <= maxChars;
    const tokenFits = estimateTokens(candidateText, model) <= maxContextTokens;
    if (charFits && tokenFits) {
      best = candidateContent;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const boundary = Math.max(best.lastIndexOf('\n\n'), best.lastIndexOf('\n'), best.lastIndexOf('。'), best.lastIndexOf('. '));
  if (boundary >= 200) return best.slice(0, boundary + (best[boundary] === ' ' ? 1 : 0));
  return best.length >= 200 ? best : '';
}

/** 按模型 Token 预算与八层优先级编译上下文，并记录可重放决策。 */
function assembleContext(input = {}, options = {}) {
  const originalInput = input && typeof input === 'object' ? input : {};
  const prepared = { ...originalInput };
  const sceneTags = sceneTagsFor(prepared, options);
  const mechanismSource = options.genreMechanisms ?? prepared.genreMechanisms ?? prepared.mechanisms;
  const mechanismSelection = mechanismSource == null
    ? { value: null, decisions: [], filtered: false }
    : selectGenreMechanisms(mechanismSource, sceneTags);
  if (mechanismSource != null) prepared.genreMechanisms = mechanismSelection.value;
  const debtSelection = splitCausalDebt(prepared, options);

  const rawBlocks = [];
  for (const [key, content] of Object.entries(prepared)) {
    if (key === 'sceneTags' || content == null || content === '' || (Array.isArray(content) && content.length === 0) ||
      (typeof content === 'object' && !Array.isArray(content) && Object.keys(content).length === 0)) continue;
    if (['activeCausalDebts', 'causalDebt', 'causalDebts', 'mechanisms'].includes(key)) continue;
    const priority = PRIORITY[key] !== undefined ? PRIORITY[key] : 2;
    rawBlocks.push({
      id: key,
      layer: BLOCK_TO_LAYER[key] || 'L5_facts',
      priority,
      required: priority === 0,
      content: asText(content),
      plainText: typeof content === 'string'
    });
  }
  const orderIndex = new Map(BLOCK_ORDER.map((id, index) => [id, index]));
  rawBlocks.sort((a, b) => a.priority - b.priority ||
    (orderIndex.get(a.id) ?? BLOCK_ORDER.length) - (orderIndex.get(b.id) ?? BLOCK_ORDER.length) || a.id.localeCompare(b.id));

  const model = String(options.model || options.modelId || 'default');
  const provider = String(options.provider || 'default');
  const modelCapability = getModelCapability(model);
  const hardLimit = Number(options.hardLimit || options.providerContextLimit) ||
    DEFAULT_PROVIDER_CONTEXT_LIMITS[model] || modelCapability.contextWindow;
  const outputReserve = outputReserveFor(options, model);
  const system = String(options.system || options.systemPrompt || '');
  const prompt = String(options.prompt || '');
  const systemTokens = estimateTokens(system, model);
  const inputPromptTokens = estimateTokens(prompt, model);
  const externalContractTokens = options.contract == null ? 0 : estimateTokens(options.contract, model);
  const wrapperPrefix = String(options.contextWrapperPrefix || '');
  const wrapperSuffix = String(options.contextWrapperSuffix || '');
  const messageEnvelopeTokens = estimateTokens('<|system|>\n<|user|>\n<|assistant|>\n', model);
  const renderedWrapperTokens = estimateTokens(wrapperPrefix + wrapperSuffix, model) + messageEnvelopeTokens;
  const reservedInputTokens = Math.max(0, Number(options.reservedInputTokens ?? options.promptReserveTokens ?? 1024) || 0);
  const availableInputTokens = Math.max(0, hardLimit - outputReserve - systemTokens - inputPromptTokens - externalContractTokens - renderedWrapperTokens - reservedInputTokens);
  const maxChars = Math.max(1000, Number(options.maxChars) || 48000);
  const includedBlocks = [];
  const truncatedBlocks = [];
  const omittedBlocks = [];
  const blockDecisions = [];
  const maxRenderedContextTokens = availableInputTokens;

  for (const block of rawBlocks) {
    const candidateBlocks = [...includedBlocks, block];
    const candidateText = candidateBlocks.map(renderBlock).join('\n\n');
    const fullRendered = wrapperPrefix + candidateText + wrapperSuffix;
    const fitsChars = fullRendered.length <= maxChars;
    const usedTokens = estimateTokens(candidateText, model);
    const blockTokens = estimateTokens(renderBlock(block), model);
    if (fitsChars && usedTokens <= maxRenderedContextTokens) {
      includedBlocks.push(block);
      blockDecisions.push({
        id: block.id,
        layer: block.layer,
        tokens: blockTokens,
        included: true,
        required: block.required,
        decision: 'included',
        reason: 'within-budget'
      });
      continue;
    }

    if (block.required) {
      contextOverflow(`必要上下文 ${block.id} 超出模型预算，未进行裁剪`, {
        blockId: block.id, hardLimit, outputReserve, availableInputTokens,
        requiredContextTokens: usedTokens, requiredContextChars: fullRendered.length,
        maxChars, model, provider
      });
    }

    const remainingChars = Math.max(0, maxChars - wrapperPrefix.length - wrapperSuffix.length);
    const prefixText = includedBlocks.map(renderBlock).join('\n\n');
    const canTryTruncate = block.plainText && remainingChars - prefixText.length >= 240;
    const truncated = canTryTruncate ? fitPlainText({
      block, includedBlocks, maxChars, maxContextTokens: maxRenderedContextTokens,
      model, wrapperPrefix, wrapperSuffix
    }) : '';
    if (truncated) {
      const truncatedBlock = { ...block, content: truncated };
      const truncatedTokens = estimateTokens(renderBlock(truncatedBlock), model);
      includedBlocks.push(truncatedBlock);
      truncatedBlocks.push(block.id);
      blockDecisions.push({
        id: block.id,
        layer: block.layer,
        tokens: truncatedTokens,
        included: true,
        required: false,
        decision: 'truncated',
        reason: 'plain-text-boundary-fit'
      });
    } else {
      omittedBlocks.push(block.id);
      blockDecisions.push({
        id: block.id,
        layer: block.layer,
        tokens: blockTokens,
        included: false,
        required: false,
        decision: 'omitted',
        reason: fitsChars ? 'model-token-budget' : 'character-budget'
      });
    }
  }

  const contextText = includedBlocks.map(renderBlock).join('\n\n');
  const renderedContext = wrapperPrefix + contextText + wrapperSuffix;
  const renderedContextTokens = estimateTokens(contextText, model);
  const layers = {};
  const layerTokens = {};
  for (const layer of CONTEXT_LAYERS) {
    layers[layer] = [];
    layerTokens[layer] = 0;
  }
  for (const block of includedBlocks) {
    const layer = block.layer || 'L5_facts';
    layers[layer] ||= [];
    layers[layer].push(block.id);
    layerTokens[layer] = (layerTokens[layer] || 0) + estimateTokens(renderBlock(block), model);
  }

  const contractTokens = (layerTokens.L0_current || 0) + (layerTokens.L2_chapter || 0);
  const memoryTokens = (layerTokens.L5_facts || 0) + (layerTokens.L7_causal_debt || 0);
  const storyTokens = (layerTokens.L1_scene || 0) + (layerTokens.L4_volume || 0) + (layerTokens.L6_world_axioms || 0);
  const recentTokens = layerTokens.L3_recent || 0;
  const contextTokens = memoryTokens + storyTokens + recentTokens;
  const promptTokens = renderedContextTokens + inputPromptTokens + externalContractTokens;
  const totalRequired = systemTokens + inputPromptTokens + externalContractTokens + renderedWrapperTokens +
    reservedInputTokens + renderedContextTokens + outputReserve;
  const margin = hardLimit - totalRequired;
  const inputHash = hashValue({
    input: originalInput,
    mechanismSource,
    sceneTags,
    currentVolumeId: debtSelection.currentVolumeId,
    currentChapterNo: debtSelection.currentChapterNo,
    currentCharacterIds: debtSelection.currentCharacterIds,
    strategyVersion: CONTEXT_STRATEGY_VERSION
  });
  const contextHash = hashValue(contextText);
  const contextPlan = {
    contextPlanVersion: CONTEXT_VERSION,
    contextStrategyVersion: CONTEXT_STRATEGY_VERSION,
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
    renderedContextTokens,
    renderedWrapperTokens,
    reservedInputTokens,
    inputPromptTokens,
    externalContractTokens,
    layers,
    layerTokens,
    requiredBlocks: rawBlocks.filter(block => block.required).map(block => block.id),
    includedBlocks: includedBlocks.map(block => block.id),
    truncatedBlocks,
    omittedBlocks,
    promptTokens,
    dynamicTokens: contextTokens,
    totalRequired,
    fits: margin >= 0,
    margin,
    contextHash,
    replayManifest: {
      manifestVersion: 1,
      strategyVersion: CONTEXT_STRATEGY_VERSION,
      inputHash,
      contextHash,
      scene: { tags: sceneTags, mechanisms: mechanismSelection.decisions },
      causalDebt: {
        currentVolumeId: debtSelection.currentVolumeId,
        currentChapterNo: debtSelection.currentChapterNo,
        currentCharacterIds: debtSelection.currentCharacterIds,
        decisions: debtSelection.decisions
      },
      blocks: blockDecisions,
      budget: {
        provider, model, hardLimit, maxChars, outputReserve, systemTokens, inputPromptTokens,
        externalContractTokens, renderedWrapperTokens, reservedInputTokens,
        renderedContextTokens, totalRequired, margin,
        estimator: 'model-capability-cjk-ratio-v1'
      }
    }
  };

  if (!contextPlan.fits) {
    contextOverflow('必要上下文与预留空间超过模型硬上限', {
      hardLimit, totalRequired, margin, model, provider, outputReserve,
      renderedContextTokens, omittedBlocks
    });
  }
  return { text: contextText, blocks: includedBlocks, contextPlan };
}

module.exports = {
  CONTEXT_VERSION,
  CONTEXT_STRATEGY_VERSION,
  CONTEXT_LAYERS,
  BLOCK_TO_LAYER,
  PRIORITY,
  assembleContext,
  selectGenreMechanisms,
  splitCausalDebt
};
