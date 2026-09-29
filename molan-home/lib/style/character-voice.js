'use strict';

/** 限定人物声音合同的数值范围和文本列表长度。 */
function normalizeCharacterVoice(input = {}) {
  const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
  const speech = input.speech || {};
  const behavior = input.behavior || {};
  const subtext = input.subtext || {};
  return {
    characterId: String(input.characterId || ''),
    speech: {
      sentenceLength: String(speech.sentenceLength || 'varied'),
      directness: clamp(speech.directness), humor: clamp(speech.humor),
      formality: clamp(speech.formality), questionFrequency: clamp(speech.questionFrequency)
    },
    behavior: { hesitation: clamp(behavior.hesitation), riskAversion: clamp(behavior.riskAversion), impulsiveness: clamp(behavior.impulsiveness) },
    subtext: { frequency: clamp(subtext.frequency), directEmotion: clamp(subtext.directEmotion) },
    physicalTells: (Array.isArray(input.physicalTells) ? input.physicalTells : []).map(String).slice(0, 12),
    verbalHabits: (Array.isArray(input.verbalHabits) ? input.verbalHabits : []).map(String).slice(0, 12),
    taboos: (Array.isArray(input.taboos) ? input.taboos : []).map(String).slice(0, 20)
  };
}

/** 根据关系类型提供对话语气修正，避免一个人物面对所有关系使用同一声音。 */
function normalizeRelationshipVoice(input = {}) {
  return {
    sourceCharacterId: String(input.sourceCharacterId || ''),
    targetCharacterId: String(input.targetCharacterId || ''),
    relationshipType: String(input.relationshipType || ''),
    trust: Math.max(-1, Math.min(1, Number(input.trust) || 0)),
    formalityShift: Math.max(-1, Math.min(1, Number(input.formalityShift) || 0)),
    directnessShift: Math.max(-1, Math.min(1, Number(input.directnessShift) || 0)),
    subtextReason: String(input.subtextReason || '').slice(0, 300)
  };
}

module.exports = { normalizeCharacterVoice, normalizeRelationshipVoice };
