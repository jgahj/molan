'use strict';

const { resolveStyleDNA } = require('./style-dna');
const { normalizeCharacterVoice, normalizeRelationshipVoice } = require('./character-voice');

/** 合并题材、叙事、文风、人物声音和场景要求，生成稳定的提示块顺序。 */
function compileStyleBundle(input = {}) {
  const style = resolveStyleDNA(input.style || {});
  if (style.status !== 'resolved') return { status: 'needs_choice', style };
  const parts = [
    ['GENRE PROFILE', input.genreProfile || {}],
    ['NARRATIVE PROFILE', input.narrativeProfile || {}],
    ['STYLE DNA', style.dna],
    ['CHARACTER VOICE', (Array.isArray(input.characterVoices) ? input.characterVoices : []).map(normalizeCharacterVoice)],
    ['RELATIONSHIP VOICE', (Array.isArray(input.relationshipVoices) ? input.relationshipVoices : []).map(normalizeRelationshipVoice)],
    ['SCENE PROFILE', input.sceneProfile || {}],
    ['COMMERCIAL PROFILE', input.commercialProfile || {}]
  ];
  const prompt = parts.map(([name, value]) => `${name}\n${JSON.stringify(value)}`).join('\n\n');
  return { status: 'resolved', style, parts: parts.map(([name]) => name), prompt, bundleId: `${input.genreProfile && input.genreProfile.genre || 'genre'}:${style.styleId}` };
}

module.exports = { compileStyleBundle };
