'use strict';

const { GenerationError } = require('./errors');
const { hashValue } = require('./manifest');

const CHANGE_TYPES = new Set([
  'externalEvent', 'information', 'relationship', 'character', 'resource', 'goal', 'knowledge', 'causal'
]);

/** 规范化章节合同，保留题材、风格、视角、知识边界、状态和字数预算。 */
function normalizeChapterContract(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new GenerationError('CONTRACT_INVALID', '章节合同格式无效', { status: 422 });
  }
  const rawGoal = input.chapterGoal || input.goal || (input.compositionSpec && (input.compositionSpec.chapterGoal?.name || input.compositionSpec.chapterGoal?.id || input.compositionSpec.chapterGoal)) || '';
  const contract = {
    ...input,
    chapterId: String(input.chapterId || ''),
    chapterGoal: String(rawGoal).trim(),
    genreProfileId: String(input.genreProfileId || (input.compositionSpec && (input.compositionSpec.genre?.id || input.compositionSpec.genre)) || ''),
    styleBundleId: String(input.styleBundleId || (input.compositionSpec && (input.compositionSpec.style?.id || input.compositionSpec.style)) || ''),
    compositionSpec: input.compositionSpec && typeof input.compositionSpec === 'object' ? input.compositionSpec : null,
    stateSnapshotHash: String(input.stateSnapshotHash || input.storyStateSnapshotHash || ''),
    pov: String(input.pov || 'third-limited'),
    viewpointCharacter: String(input.viewpointCharacter || ''),
    allowedKnowledge: Array.isArray(input.allowedKnowledge) ? input.allowedKnowledge.map(String) : [],
    forbiddenKnowledge: Array.isArray(input.forbiddenKnowledge) ? input.forbiddenKnowledge.map(String) : [],
    characters: Array.isArray(input.characters) ? input.characters.map(String) : [],
    relationshipChange: input.relationshipChange && typeof input.relationshipChange === 'object' ? input.relationshipChange : {},
    informationReveal: Array.isArray(input.informationReveal) ? input.informationReveal.map(String) : [],
    causalDebt: Array.isArray(input.causalDebt) ? input.causalDebt.map(String) : [],
    requiredPayoff: Array.isArray(input.requiredPayoff) ? input.requiredPayoff.map(String) : [],
    mustNot: Array.isArray(input.mustNot) ? input.mustNot.map(String) : [],
    allowedChanges: Array.isArray(input.allowedChanges) ? input.allowedChanges.filter(value => CHANGE_TYPES.has(String(value))).map(String) : [],
    scenes: Array.isArray(input.scenes) ? input.scenes.map((scene, index) => ({
      sceneId: String(scene && (scene.sceneId || scene.id) || `scene_${index + 1}`),
      purpose: String(scene && scene.purpose || ''),
      goal: String(scene && scene.goal || ''),
      characters: Array.isArray(scene && scene.characters) ? scene.characters.map(String) : [],
      location: String(scene && scene.location || ''),
      knowledgeBoundary: scene && scene.knowledgeBoundary || {},
      emotion: scene && scene.emotion || {},
      mustAdvance: Array.isArray(scene && scene.mustAdvance) ? scene.mustAdvance.map(String) : []
    })) : [],
    tension: input.tension && typeof input.tension === 'object' ? input.tension : {},
    wordBudget: input.wordBudget && typeof input.wordBudget === 'object' ? input.wordBudget : {}
  };
  const target = Number(contract.wordBudget.targetChars) || 0;
  const min = Number(contract.wordBudget.minChars) || 0;
  const max = Number(contract.wordBudget.maxChars) || 0;
  if (!contract.chapterGoal) throw new GenerationError('CONTRACT_INVALID', '章节合同缺少 chapterGoal', { status: 422 });
  if (min && max && min > max) throw new GenerationError('CONTRACT_INVALID', '章节合同字数下限大于上限', { status: 422 });
  if (target && ((min && target < min) || (max && target > max))) {
    throw new GenerationError('CONTRACT_INVALID', '章节合同目标字数不在允许范围内', { status: 422 });
  }
  return contract;
}

/** 判断正文是否至少推进一种叙事状态，避免所有题材都强制外部事件或爽点。 */
function validateNarrativeChange(changes, policy = {}) {
  const active = Array.isArray(changes) ? changes.filter(item => item && item.changed !== false) : [];
  const allowed = new Set(Array.isArray(policy.allowedChanges) && policy.allowedChanges.length
    ? policy.allowedChanges.map(String)
    : [...CHANGE_TYPES]);
  const matched = active.filter(item => allowed.has(String(item.type || '')));
  return { passed: matched.length > 0, matched, rejected: active.filter(item => !allowed.has(String(item.type || ''))) };
}

/** 计算章节合同的不可变摘要，供 generation manifest 和提交检查使用。 */
function contractHash(contract) {
  return hashValue(normalizeChapterContract(contract));
}

module.exports = { CHANGE_TYPES, normalizeChapterContract, validateNarrativeChange, contractHash };
