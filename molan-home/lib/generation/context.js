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
  scenes: 'L1_scene', scenePlan: 'L1_scene', currentScenePlan: 'L1_scene', sceneDirectives: 'L1_scene', location: 'L1_scene',
  outlineContext: 'L2_chapter',
  chapterContract: 'L2_chapter', chapterGoal: 'L2_chapter', currentChapterOutline: 'L2_chapter',
  chapterOutline: 'L2_chapter', outline: 'L2_chapter', chapterContext: 'L2_chapter',
  chapterPlan: 'L2_chapter', outlineDependencies: 'L2_chapter', planText: 'L2_chapter',
  storyPlans: 'L2_chapter',
  recentChapters: 'L3_recent', previousEnding: 'L3_recent', nextChapterOutline: 'L3_recent', adjacentChapterSummaries: 'L3_recent',
  volumeState: 'L4_volume', arcGoals: 'L4_volume', volumeOutline: 'L4_volume', currentVolumeOutline: 'L4_volume',
  bookOutlineSummary: 'L4_volume', distantPlot: 'L4_volume',
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
  outlineContext: 0,
  currentChapterOutline: 0, chapterOutline: 0, currentScenePlan: 0, sceneDirectives: 0,
  characters: 1, location: 1, relationships: 1, volumeState: 1, scenes: 1, scenePlan: 1,
  chapterContext: 1, chapterPlan: 1, outline: 1, outlineDependencies: 1, volumeOutline: 1, currentVolumeOutline: 1, arcGoals: 1,
  storyPlans: 1,
  activeCausalDebt: 1, causalDebt: 1,
  recentChapters: 2, previousEnding: 2, nextChapterOutline: 2, adjacentChapterSummaries: 2, bookOutlineSummary: 2,
  planText: 2, foreshadows: 2, styleSamples: 2, genreMechanisms: 2,
  distantPlot: 3, distantCausalDebtSummary: 3, historicalFacts: 3
});
const BLOCK_ORDER = Object.freeze([
  'sceneContract', 'currentTask', 'instruction', 'chapterContract', 'chapterGoal',
  'outlineContext',
  'currentChapterOutline', 'chapterOutline', 'outline', 'requiredPayoff', 'requiredCausalPayoff',
  'hardState', 'povKnowledge', 'forbiddenKnowledge', 'worldProhibitions', 'worldRules', 'axioms',
  'immediateTimeline', 'currentScenePlan', 'sceneDirectives', 'scenes', 'scenePlan', 'location',
  'chapterContext', 'chapterPlan', 'storyPlans', 'outlineDependencies', 'characters', 'relationships',
  'volumeOutline', 'currentVolumeOutline', 'volumeState', 'arcGoals', 'activeCausalDebt', 'causalDebt',
  'recentChapters', 'previousEnding', 'nextChapterOutline', 'adjacentChapterSummaries',
  'bookOutlineSummary', 'planText', 'foreshadows', 'styleSamples', 'genreMechanisms',
  'distantPlot', 'distantCausalDebtSummary', 'historicalFacts'
]);

function asText(content) {
  if (typeof content === 'string') return content;
  try {
    return JSON.stringify(content);
  } catch (_) {
    return String(content);
  }
}

function getFirstFiniteNum(...vals) {
  for (const v of vals) {
    if (v == null || typeof v === 'boolean' || typeof v === 'symbol' || Array.isArray(v)) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (typeof v === 'bigint') {
      const num = Number(v);
      if (Number.isFinite(num)) return num;
      continue;
    }
    if (typeof v === 'object') {
      if (v.chapterNo != null && typeof v.chapterNo !== 'symbol' && Number.isFinite(Number(v.chapterNo))) return Number(v.chapterNo);
      if (v.chapterNumber != null && typeof v.chapterNumber !== 'symbol' && Number.isFinite(Number(v.chapterNumber))) return Number(v.chapterNumber);
      if (v.revision != null && typeof v.revision !== 'symbol' && Number.isFinite(Number(v.revision))) return Number(v.revision);
      continue;
    }
    const num = Number(v);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function toCleanId(val) {
  if (val == null || typeof val === 'boolean' || typeof val === 'symbol') return null;
  if (typeof val === 'bigint') return String(val);
  if (typeof val === 'object') {
    if (val.id != null && typeof val.id !== 'object' && typeof val.id !== 'symbol') return String(val.id).trim();
    if (val.chapterId != null && typeof val.chapterId !== 'object' && typeof val.chapterId !== 'symbol') return String(val.chapterId).trim();
    if (val.name != null && typeof val.name !== 'object' && typeof val.name !== 'symbol') return String(val.name).trim();
    return null;
  }
  const s = String(val).trim();
  return (s !== '' && s !== '[object Object]') ? s : null;
}

function toCleanHash(val) {
  if (val == null || typeof val === 'boolean' || typeof val === 'number' || typeof val === 'symbol' || typeof val === 'bigint') return null;
  if (typeof val === 'object') {
    if (val.sha256 && typeof val.sha256 === 'string') return val.sha256.trim();
    if (val.hash && typeof val.hash === 'string') return val.hash.trim();
    if (val.digest && typeof val.digest === 'string') return val.digest.trim();
    return null;
  }
  const s = String(val).trim();
  return (s !== '' && s !== '[object Object]') ? s : null;
}

function safeItemString(item) {
  if (item == null || typeof item === 'symbol') return '';
  if (typeof item === 'bigint') return String(item);
  if (typeof item !== 'object') return String(item).trim();
  if (item.id != null && typeof item.id !== 'object' && typeof item.id !== 'symbol' && String(item.id).trim() !== '') return String(item.id).trim();
  if (item.name != null && typeof item.name !== 'object' && typeof item.name !== 'symbol' && String(item.name).trim() !== '') return String(item.name).trim();
  if (item.title != null && typeof item.title !== 'object' && typeof item.title !== 'symbol' && String(item.title).trim() !== '') return String(item.title).trim();
  if (item.key != null && typeof item.key !== 'object' && typeof item.key !== 'symbol' && String(item.key).trim() !== '') return String(item.key).trim();
  if (item.event != null && typeof item.event !== 'object' && typeof item.event !== 'symbol' && String(item.event).trim() !== '') return String(item.event).trim();
  if (item.description != null && typeof item.description !== 'object' && typeof item.description !== 'symbol' && String(item.description).trim() !== '') return String(item.description).trim();
  try {
    return JSON.stringify(item);
  } catch (_) {
    return Object.keys(item).join(',');
  }
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
  const safeOptions = options && typeof options === 'object' ? options : {};
  const safeInput = input && typeof input === 'object' ? input : {};
  const tags = [
    ...tagsFrom(safeOptions.sceneTags),
    ...tagsFrom(safeInput.sceneTags),
    ...tagsFrom(safeInput.sceneContract && (safeInput.sceneContract.sceneTags || safeInput.sceneContract.tags || safeInput.sceneContract.sceneType)),
    ...tagsFrom(safeInput.sceneContract && safeInput.sceneContract.scenes && safeInput.sceneContract.scenes.flatMap(scene => [scene && scene.sceneTags, scene && scene.tags, scene && scene.sceneType])),
    ...tagsFrom(safeInput.scenePlan && safeInput.scenePlan.scenes && safeInput.scenePlan.scenes.flatMap(scene => [scene.sceneTags, scene.tags, scene.sceneType])),
    ...tagsFrom(safeInput.scenes && safeInput.scenes.flatMap(scene => [scene && scene.sceneTags, scene && scene.tags, scene && scene.sceneType]))
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

function getCurrentChapter(input, options = {}) {
  const safeOptions = options && typeof options === 'object' ? options : {};
  const safeInput = input && typeof input === 'object' ? input : {};
  const contract = safeInput.sceneContract || safeInput.chapterContract || {};
  const volumeState = safeInput.volumeState && typeof safeInput.volumeState === 'object' ? safeInput.volumeState : {};
  const chapterContext = safeInput.chapterContext && typeof safeInput.chapterContext === 'object' ? safeInput.chapterContext : {};
  return getFirstFiniteNum(
    safeOptions.currentChapterNo, safeOptions.chapterNo, safeOptions.chapterNumber,
    safeInput.currentChapterNo, safeInput.chapterNo, safeInput.chapterNumber,
    contract.currentChapterNo, contract.chapterNo, contract.chapterNumber,
    volumeState.currentChapterNo, volumeState.chapterNo,
    chapterContext.chapterNo, chapterContext.chapterNumber
  );
}

function getCurrentVolumeId(input, options) {
  const safeOptions = options && typeof options === 'object' ? options : {};
  const safeInput = input && typeof input === 'object' ? input : {};
  const contract = safeInput.sceneContract || {};
  const volume = safeInput.volumeState && typeof safeInput.volumeState === 'object' ? safeInput.volumeState : {};
  return String(safeOptions.currentVolumeId || safeInput.currentVolumeId || safeInput.volumeId ||
    contract.currentVolumeId || contract.volumeId || volume.currentVolumeId || volume.volumeId || volume.id || '');
}

function getCurrentCharacters(input, options) {
  const safeOptions = options && typeof options === 'object' ? options : {};
  const safeInput = input && typeof input === 'object' ? input : {};
  const contract = safeInput.sceneContract || {};
  const values = [safeOptions.currentCharacterIds, contract.currentCharacterIds, contract.characters,
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
    const alias = aliases.find(key => input[key] != null && getDebtItems(input[key]) !== null);
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
  if (block && block.id === 'storyPlans' && typeof block.content !== 'string') {
    return `[storyPlans]\n${formatStoryPlansMarkdown(block.content)}`;
  }
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

function formatOutlineContextMarkdown(data) {
  if (typeof data === 'string') return data.trim();
  if (!data || typeof data !== 'object') return String(data || '');

  const ch = data.chapter && typeof data.chapter === 'object' ? data.chapter : {};
  const vol = data.volume && typeof data.volume === 'object' ? data.volume : {};
  const dep = data.dependencies && typeof data.dependencies === 'object' ? data.dependencies : {};

  const lines = [];

  // Helper for filtering sparse / nullish list items and rendering with 1-based indexing
  const formatList = (arr, extractFn) => {
    if (!Array.isArray(arr) || arr.length === 0) return '';
    const validItems = [];
    for (const item of arr) {
      if (item == null || item === '') continue;
      if (typeof item === 'string') {
        const trimmed = item.trim();
        if (trimmed && trimmed !== 'null' && trimmed !== 'undefined' && trimmed !== '{}') {
          validItems.push(trimmed);
        }
      } else if (typeof item === 'object') {
        if (Object.keys(item).length === 0) continue;
        const extracted = extractFn ? extractFn(item) : '';
        const str = typeof extracted === 'string'
          ? extracted.trim()
          : (extracted && typeof extracted === 'object' && Object.keys(extracted).length > 0 ? JSON.stringify(extracted) : String(extracted || ''));
        if (str && str !== 'null' && str !== 'undefined' && str !== '{}') {
          validItems.push(str);
        }
      } else {
        const str = String(item).trim();
        if (str && str !== 'null' && str !== 'undefined') {
          validItems.push(str);
        }
      }
    }
    if (validItems.length === 0) return '';
    return validItems.map((val, i) => `${i + 1}. ${val}`).join('；');
  };

  // Section 1: 当前章节目标与核心节拍
  lines.push('【当前章节目标与核心节拍】');
  const chapterNo = ch.chapterNo != null ? ch.chapterNo : 1;
  const chapterTitle = ch.title ? `《${ch.title}》` : '';
  lines.push(`- 章节定位：第 ${chapterNo} 章${chapterTitle}`);

  if (ch.goal) lines.push(`- 核心目标：${ch.goal}`);

  const clientOutline = ch.clientOutline || ch.outline;
  if (ch.summary && ch.summary !== ch.goal && ch.summary !== clientOutline) {
    lines.push(`- 章节概要：${ch.summary}`);
  }

  const beatsStr = formatList(ch.beats, b => b.title || b.name || b.beat || JSON.stringify(b));
  if (beatsStr) lines.push(`- 关键节拍：${beatsStr}`);

  const scenesStr = formatList(ch.scenes, s => s.goal || s.title || s.name || JSON.stringify(s));
  if (scenesStr) lines.push(`- 场景规划：${scenesStr}`);

  const dirStr = formatList(ch.sceneDirectives, d => d.directive || d.instruction || d.desc || JSON.stringify(d));
  if (dirStr) lines.push(`- 镜头与动作指令：${dirStr}`);

  if (clientOutline) {
    const clientStr = typeof clientOutline === 'string'
      ? clientOutline.trim()
      : (typeof clientOutline === 'object' && Object.keys(clientOutline).length > 0 ? JSON.stringify(clientOutline) : '');
    if (clientStr) {
      lines.push(`- 现场细纲约束：${clientStr}`);
    }
  }

  // Section 2: 所属卷与剧情主线弧线
  lines.push('');
  lines.push('【所属卷与剧情主线弧线】');
  const volParts = [];
  if (vol.volumeNo != null || vol.title) {
    const volNoStr = vol.volumeNo != null ? `第 ${vol.volumeNo} 卷` : '';
    const volTitleStr = vol.title ? `·${vol.title}` : '';
    const combined = `${volNoStr}${volTitleStr}`.trim();
    if (combined) volParts.push(combined);
  }
  if (vol.goal && String(vol.goal).trim()) volParts.push(`(卷目标：${vol.goal})`);
  if (volParts.length > 0) {
    lines.push(`- 所属卷：${volParts.join(' ')}`);
  } else {
    lines.push('- 所属卷：全书主线');
  }

  const arcStr = Array.isArray(vol.arcGoals)
    ? formatList(vol.arcGoals, a => a.goal || a.title || a.name || JSON.stringify(a))
    : (typeof vol.arcGoals === 'string' && vol.arcGoals.trim() ? vol.arcGoals.trim() : '');
  if (arcStr) {
    lines.push(`- 剧情弧线：${arcStr}`);
  }

  if (vol.volumePlan && vol.volumePlan !== vol.goal) {
    const planStr = typeof vol.volumePlan === 'string'
      ? vol.volumePlan.trim()
      : (typeof vol.volumePlan === 'object' && Object.keys(vol.volumePlan).length > 0 ? JSON.stringify(vol.volumePlan) : '');
    if (planStr) {
      lines.push(`- 卷推进规划：${planStr}`);
    }
  }

  // Section 3: 前置因果依赖与下章承接接口 (Hardened: avoid dangling empty headers)
  const depLines = [];

  const prereqStr = formatList(dep.prerequisiteEvents, p => p.description || p.event || p.title || JSON.stringify(p));
  if (prereqStr) depLines.push(`- 前置依赖：${prereqStr}`);

  const fStr = formatList(dep.foreshadows, f => f.name || f.description || f.title || JSON.stringify(f));
  if (fStr) depLines.push(`- 关键伏笔：${fStr}`);

  const dStr = formatList(dep.causalDebts, d => d.description || d.promise || d.debt || JSON.stringify(d));
  if (dStr) depLines.push(`- 因果债务：${dStr}`);

  const nextIface = dep.nextChapterInterface || dep.nextChapter || {};
  const nextParts = [];
  if (nextIface.chapterNo != null && String(nextIface.chapterNo).trim() !== '') nextParts.push(`第 ${nextIface.chapterNo} 章`);
  if (nextIface.title && String(nextIface.title).trim() !== '') nextParts.push(`《${nextIface.title}》`);
  if (nextIface.hookGoal && String(nextIface.hookGoal).trim() !== '') nextParts.push(`核心钩子：${nextIface.hookGoal}`);
  if (nextIface.unresolvedTension && String(nextIface.unresolvedTension).trim() !== '') nextParts.push(`未解悬念：${nextIface.unresolvedTension}`);
  if (nextIface.goal && !nextIface.hookGoal && String(nextIface.goal).trim() !== '') nextParts.push(`承接目标：${nextIface.goal}`);
  if (nextParts.length > 0) {
    depLines.push(`- 下章承接：${nextParts.join('，')}`);
  }

  if (depLines.length > 0) {
    lines.push('');
    lines.push('【前置因果依赖与下章承接接口】');
    lines.push(...depLines);
  }

  return lines.join('\n').trim();
}

function formatStoryPlansMarkdown(data) {
  if (typeof data === 'string') return data.trim();
  let items = [];
  if (Array.isArray(data)) {
    items = data;
  } else if (data && typeof data === 'object') {
    if (Array.isArray(data.plans)) items = data.plans;
    else if (Array.isArray(data.items)) items = data.items;
    else items = [data];
  }
  if (items.length === 0) return '';
  const lines = [];
  for (let i = 0; i < items.length; i++) {
    const plan = items[i];
    if (plan == null) continue;
    if (Array.isArray(plan)) continue;
    if (typeof plan === 'string') {
      const s = plan.trim();
      if (s) lines.push(`- 计划 ${i + 1}: ${s}`);
      continue;
    }
    if (typeof plan !== 'object') {
      lines.push(`- 计划 ${i + 1}: ${plan}`);
      continue;
    }
    const title = String(plan.title || `计划 ${i + 1}`).trim();
    const explicitRange = plan.targetChapterRange ?? plan.target_chapter_range;
    const explicitChNo = plan.chapterNo ?? plan.chapter_no;
    const range = String(explicitRange != null ? explicitRange : (explicitChNo != null ? explicitChNo : '')).trim();
    let participants = plan.participants ?? plan.participantIds ?? plan.participant_ids ?? plan.participant_ids_json ?? [];
    if (typeof participants === 'string') {
      try { participants = JSON.parse(participants); } catch (_) { participants = []; }
    }
    const participantList = (Array.isArray(participants) ? participants : [])
      .map(p => String(p && typeof p === 'object' ? (p.name || p.id || p.characterId || '') : (p != null ? p : '')).trim())
      .filter(Boolean);

    const metaParts = [];
    if (range) {
      metaParts.push(`目标章节: ${range}`);
    }
    if (participantList.length > 0) {
      metaParts.push(`涉及人物: ${participantList.join(', ')}`);
    }
    const metaStr = metaParts.length > 0 ? `(${metaParts.join(', ')})` : '';
    lines.push(`- 计划 ${i + 1}: 【${title}】${metaStr}`.trimEnd());
    const content = String(plan.content || plan.summary || plan.planText || plan.plan_text || '').trim();
    if (content) {
      lines.push(`  规划要求: ${content}`);
    }
  }
  return lines.join('\n').trim();
}

/** 按模型 Token 预算与八层优先级编译上下文，并记录可重放决策。 */
function assembleContext(input = {}, options = {}) {
  const originalInput = input && typeof input === 'object' ? input : {};
  const safeOptions = options && typeof options === 'object' ? options : {};
  const prepared = { ...originalInput };
  const sceneTags = sceneTagsFor(prepared, safeOptions);
  const mechanismSource = safeOptions.genreMechanisms ?? prepared.genreMechanisms ??
    (mechanismList(prepared.mechanisms) ? prepared.mechanisms : null);
  delete prepared.mechanisms;
  const mechanismSelection = mechanismSource == null
    ? { value: null, decisions: [], filtered: false }
    : selectGenreMechanisms(mechanismSource, sceneTags);
  if (mechanismSelection.value != null) prepared.genreMechanisms = mechanismSelection.value;
  const debtSelection = splitCausalDebt(prepared, safeOptions);

  // 规范化与去重章节大纲字段：
  if (prepared.outlineContext) {
    // 1. 安全同步现场大纲至 outlineContext（防止就地修改冻结对象引发 TypeError 崩溃）
    if (prepared.currentChapterOutline && typeof prepared.outlineContext === 'object') {
      const oc = prepared.outlineContext;
      const ocChapter = oc.chapter && typeof oc.chapter === 'object' ? oc.chapter : null;
      const ocClient = ocChapter?.clientOutline;
      if (!ocClient) {
        const safeChapter = ocChapter ? { ...ocChapter } : {};
        if (typeof prepared.currentChapterOutline === 'string') {
          safeChapter.clientOutline = prepared.currentChapterOutline;
        } else if (typeof prepared.currentChapterOutline === 'object') {
          safeChapter.clientOutline = prepared.currentChapterOutline.outline ||
            prepared.currentChapterOutline.summary ||
            prepared.currentChapterOutline;
        }
        prepared.outlineContext = {
          ...oc,
          chapter: safeChapter
        };
      }
    }

    // 2. 无条件强力清除所有旧的大纲别名字段，杜绝任何形态下的重复序列化与 double-JSON 入模
    delete prepared.chapterOutline;
    delete prepared.chapterContext;
    delete prepared.chapterPlan;
    delete prepared.planText;
    delete prepared.currentChapterOutline;
    delete prepared.outline;
    delete prepared.outlineDependencies;
    delete prepared.nextChapterOutline;

    // 3. 现场 continuity 净化：剥离已编译入模的 outline 与 nextChapter，杜绝 raw JSON 泄露
    if (prepared.continuity && typeof prepared.continuity === 'object') {
      const sanitizedContinuity = { ...prepared.continuity };
      delete sanitizedContinuity.outline;
      delete sanitizedContinuity.currentChapterOutline;
      delete sanitizedContinuity.chapterOutline;
      delete sanitizedContinuity.chapterPlan;
      delete sanitizedContinuity.nextChapter;
      delete sanitizedContinuity.nextChapterOutline;
      if (Object.keys(sanitizedContinuity).length === 0) {
        delete prepared.continuity;
      } else {
        prepared.continuity = sanitizedContinuity;
      }
    }
  }

  if (prepared.chapterContext && prepared.chapterPlan) {
    if (prepared.chapterPlan === prepared.chapterContext || JSON.stringify(prepared.chapterPlan) === JSON.stringify(prepared.chapterContext)) {
      delete prepared.chapterPlan;
    }
  }
  if (prepared.chapterContext && prepared.planText) {
    const contextStr = typeof prepared.chapterContext === 'string' ? prepared.chapterContext : JSON.stringify(prepared.chapterContext);
    if (contextStr.startsWith(prepared.planText) || prepared.planText.startsWith(contextStr) || prepared.planText === contextStr) {
      delete prepared.planText;
    }
  } else if (prepared.chapterPlan && prepared.planText) {
    const planStr = typeof prepared.chapterPlan === 'string' ? prepared.chapterPlan : JSON.stringify(prepared.chapterPlan);
    if (planStr.startsWith(prepared.planText) || prepared.planText.startsWith(planStr) || prepared.planText === planStr) {
      delete prepared.planText;
    }
  }
  if (prepared.currentChapterOutline && prepared.chapterOutline && prepared.currentChapterOutline === prepared.chapterOutline) {
    delete prepared.chapterOutline;
  }

  const rawBlocks = [];
  for (const [key, content] of Object.entries(prepared)) {
    if (key === 'sceneTags' || content == null || content === '' || (Array.isArray(content) && content.length === 0) ||
      (typeof content === 'object' && !Array.isArray(content) && Object.keys(content).length === 0)) continue;
    if ([
      'activeCausalDebts', 'causalDebt', 'causalDebts', 'mechanisms',
      'outlineImpact', 'outlineRevision', 'outlineHash', 'stateDeltaCommitted', 'stateDelta',
      'outlineAudit', 'contextPlan', 'replayManifest', 'contextTruncationReasons',
      'outlineDependenciesIncluded', 'outlineDependencies', 'dependencies',
      'impact', 'revision', 'planRevision',
      'chapterId', 'chapterNo', 'chapterNumber', 'currentChapterNo', 'currentChapterId',
      'currentVolumeId', 'volumeId', 'volumeNo',
      'requiredOutlineIncluded', 'outlineBlockTokens'
    ].includes(key)) continue;
    const priority = PRIORITY[key] !== undefined ? PRIORITY[key] : 2;
    const isOutlineContext = key === 'outlineContext';
    const isStoryPlans = key === 'storyPlans';
    const contentText = isOutlineContext ? formatOutlineContextMarkdown(content)
      : isStoryPlans ? formatStoryPlansMarkdown(content)
      : asText(content);
    rawBlocks.push({
      id: key,
      layer: BLOCK_TO_LAYER[key] || 'L5_facts',
      priority,
      required: priority === 0,
      content: contentText,
      plainText: isOutlineContext || isStoryPlans || typeof content === 'string'
    });
  }
  const orderIndex = new Map(BLOCK_ORDER.map((id, index) => [id, index]));
  rawBlocks.sort((a, b) => a.priority - b.priority ||
    (orderIndex.get(a.id) ?? BLOCK_ORDER.length) - (orderIndex.get(b.id) ?? BLOCK_ORDER.length) || a.id.localeCompare(b.id));

  const model = String(safeOptions.model || safeOptions.modelId || 'default');
  const provider = String(safeOptions.provider || 'default');
  const modelCapability = getModelCapability(model);
  const hardLimit = Number(safeOptions.hardLimit || safeOptions.providerContextLimit) ||
    DEFAULT_PROVIDER_CONTEXT_LIMITS[model] || modelCapability.contextWindow;
  const outputReserve = outputReserveFor(safeOptions, model);
  const system = String(safeOptions.system || safeOptions.systemPrompt || '');
  const prompt = String(safeOptions.prompt || '');
  const systemTokens = estimateTokens(system, model);
  const inputPromptTokens = estimateTokens(prompt, model);
  const externalContractTokens = safeOptions.contract == null ? 0 : estimateTokens(safeOptions.contract, model);
  const wrapperPrefix = String(safeOptions.contextWrapperPrefix || '');
  const wrapperSuffix = String(safeOptions.contextWrapperSuffix || '');
  const messageEnvelopeTokens = estimateTokens('<|system|>\n<|user|>\n<|assistant|>\n', model);
  const renderedWrapperTokens = estimateTokens(wrapperPrefix + wrapperSuffix, model) + messageEnvelopeTokens;
  const reservedInputTokens = Math.max(0, Number(safeOptions.reservedInputTokens ?? safeOptions.promptReserveTokens ?? 1024) || 0);
  const availableInputTokens = Math.max(0, hardLimit - outputReserve - systemTokens - inputPromptTokens - externalContractTokens - renderedWrapperTokens - reservedInputTokens);
  const maxChars = Math.max(1000, Number(safeOptions.maxChars) || 48000);
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
  const outlineBlockKeys = ['outlineContext', 'currentChapterOutline', 'chapterOutline', 'chapterContext', 'outline'];
  const outlineBlockIncluded = includedBlocks.some(block => outlineBlockKeys.includes(block.id));
  const outlineBlockTokens = includedBlocks
    .filter(block => outlineBlockKeys.includes(block.id))
    .reduce((sum, block) => sum + estimateTokens(renderBlock(block), model), 0);

  const rawOutline = prepared.outlineContext ||
    (typeof prepared.currentChapterOutline === 'object' ? prepared.currentChapterOutline : null) ||
    prepared.chapterContext || {};

  const resolvedChapterId = toCleanId(safeOptions.chapterId) ??
    toCleanId(safeOptions.currentChapterId) ??
    toCleanId(originalInput.chapterId) ??
    toCleanId(originalInput.currentChapterId) ??
    toCleanId(rawOutline.chapterId) ??
    toCleanId(rawOutline.id) ??
    toCleanId(rawOutline.chapter && rawOutline.chapter.id) ??
    toCleanId(rawOutline.chapter && rawOutline.chapter.chapterId) ??
    toCleanId(prepared.chapterContract && (prepared.chapterContract.chapterId ?? prepared.chapterContract.id)) ??
    toCleanId(prepared.sceneContract && (prepared.sceneContract.chapterId ?? prepared.sceneContract.id)) ??
    null;

  const resolvedChapterNo = getFirstFiniteNum(
    safeOptions.chapterNo, safeOptions.currentChapterNo, safeOptions.chapterNumber,
    originalInput.chapterNo, originalInput.currentChapterNo, originalInput.chapterNumber,
    rawOutline.chapterNo, rawOutline.chapterNumber,
    rawOutline.chapter && (rawOutline.chapter.chapterNo ?? rawOutline.chapter.chapterNumber),
    prepared.chapterContract && (prepared.chapterContract.chapterNo ?? prepared.chapterContract.currentChapterNo),
    prepared.sceneContract && (prepared.sceneContract.chapterNo ?? prepared.sceneContract.currentChapterNo),
    debtSelection.currentChapterNo
  );

  const outlineRevision = getFirstFiniteNum(
    safeOptions.outlineRevision, safeOptions.planRevision, safeOptions.revision,
    originalInput.outlineRevision, originalInput.planRevision, originalInput.revision,
    rawOutline.planRevision, rawOutline.revision,
    rawOutline.chapter && (rawOutline.chapter.planRevision ?? rawOutline.chapter.revision),
    rawOutline.provenance && rawOutline.provenance.revision
  );

  const outlineHash = toCleanHash(safeOptions.outlineHash) ??
    toCleanHash(originalInput.outlineHash) ??
    toCleanHash(rawOutline.outlineHash) ??
    toCleanHash(rawOutline.hash) ??
    toCleanHash(rawOutline.chapter && rawOutline.chapter.outlineHash) ??
    toCleanHash(rawOutline.provenance && rawOutline.provenance.outlineHash) ??
    null;

  const rawDependencies = safeOptions.outlineDependenciesIncluded ?? safeOptions.outlineDependencies ?? safeOptions.dependencies ??
    rawOutline.dependencies ?? (rawOutline.chapter && rawOutline.chapter.dependencies) ??
    originalInput.outlineDependenciesIncluded ?? originalInput.outlineDependencies ?? originalInput.dependencies ?? [];
  const outlineDependenciesIncluded = (Array.isArray(rawDependencies) ? rawDependencies : (rawDependencies != null && rawDependencies !== '' ? [rawDependencies] : []))
    .map(safeItemString)
    .filter(Boolean);

  const rawImpact = (safeOptions.outlineImpact && typeof safeOptions.outlineImpact === 'object' && !Array.isArray(safeOptions.outlineImpact))
    ? safeOptions.outlineImpact
    : ((rawOutline.outlineImpact && typeof rawOutline.outlineImpact === 'object' && !Array.isArray(rawOutline.outlineImpact))
      ? rawOutline.outlineImpact
      : ((rawOutline.impact && typeof rawOutline.impact === 'object' && !Array.isArray(rawOutline.impact))
        ? rawOutline.impact
        : ((originalInput.outlineImpact && typeof originalInput.outlineImpact === 'object' && !Array.isArray(originalInput.outlineImpact))
          ? originalInput.outlineImpact
          : ((originalInput.impact && typeof originalInput.impact === 'object' && !Array.isArray(originalInput.impact))
            ? originalInput.impact
            : {}))));
  const toArr = val => {
    if (Array.isArray(val)) return val.map(safeItemString).filter(Boolean);
    if (val != null && val !== '') {
      const s = safeItemString(val);
      return s ? [s] : [];
    }
    return [];
  };
  const outlineImpact = {
    ...rawImpact,
    completed: toArr(rawImpact.completed),
    deferred: toArr(rawImpact.deferred),
    changed: toArr(rawImpact.changed),
    omitted: toArr(rawImpact.omitted)
  };

  const contextTruncationReasons = blockDecisions
    .filter(decision => decision.decision !== 'included')
    .map(decision => ({
      blockId: decision.id,
      layer: decision.layer,
      decision: decision.decision,
      reason: decision.reason
    }));

  const stateDeltaCommitted = Boolean(
    safeOptions.stateDeltaCommitted ||
    originalInput.stateDeltaCommitted ||
    safeOptions.stateDelta ||
    originalInput.stateDelta ||
    (prepared.stateDelta && typeof prepared.stateDelta === 'object' && Object.keys(prepared.stateDelta).length > 0)
  );

  const outlineAudit = {
    resolvedChapterId,
    resolvedChapterNo,
    outlineRevision,
    outlineHash,
    requiredOutlineIncluded: outlineBlockIncluded,
    outlineBlockTokens,
    outlineDependenciesIncluded,
    outlineImpact,
    contextTruncationReasons,
    stateDeltaCommitted
  };

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
    outlineAudit,
    resolvedChapterId,
    resolvedChapterNo,
    outlineRevision,
    outlineHash,
    requiredOutlineIncluded: outlineBlockIncluded,
    outlineBlockTokens,
    outlineDependenciesIncluded,
    outlineImpact,
    contextTruncationReasons,
    stateDeltaCommitted,
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
      },
      outlineAudit,
      resolvedChapterId,
      resolvedChapterNo,
      outlineRevision,
      outlineHash,
      requiredOutlineIncluded: outlineBlockIncluded,
      outlineBlockTokens,
      outlineDependenciesIncluded,
      outlineImpact,
      contextTruncationReasons,
      stateDeltaCommitted
    }
  };

  if (!contextPlan.fits) {
    contextOverflow('必要上下文与预留空间超过模型硬上限', {
      hardLimit, totalRequired, margin, model, provider, outputReserve,
      renderedContextTokens, omittedBlocks
    });
  }
  return { text: contextText, blocks: includedBlocks, contextPlan, outlineAudit };
}

module.exports = {
  CONTEXT_VERSION,
  CONTEXT_STRATEGY_VERSION,
  CONTEXT_LAYERS,
  BLOCK_TO_LAYER,
  PRIORITY,
  BLOCK_ORDER,
  assembleContext,
  selectGenreMechanisms,
  splitCausalDebt,
  formatOutlineContextMarkdown,
  formatStoryPlansMarkdown
};
