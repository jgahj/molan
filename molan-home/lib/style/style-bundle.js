'use strict';

const crypto = require('node:crypto');
const { resolveStyleDNA } = require('./style-dna');
const { normalizeCharacterVoice, normalizeRelationshipVoice } = require('./character-voice');

const BUNDLE_VERSION = 'style-bundle-v1';

/** 递归按键排序序列化，确保跨平台与多轮运行哈希严格恒定 */
function deterministicStringify(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(deterministicStringify).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + deterministicStringify(obj[k])).join(',') + '}';
}

/** 合并题材、叙事、文风、人物声音和场景要求，生成稳定的提示块顺序与校验 Hash。 */
function compileStyleBundle(input = {}) {
  const styleSource = input.style || input.styleDna || input.archetype || input.styleArchetype || {};
  const style = resolveStyleDNA(styleSource);
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

  const prompt = parts.map(([name, value]) => `${name}\n${deterministicStringify(value)}`).join('\n\n');
  const hash = crypto.createHash('sha256').update(prompt, 'utf8').digest('hex');
  const bundleId = `${input.genreProfile && input.genreProfile.genre || 'genre'}:${style.styleId}:${hash.slice(0, 8)}`;

  return {
    version: BUNDLE_VERSION,
    hash,
    status: 'resolved',
    bundleId,
    style,
    parts: parts.map(([name]) => name),
    prompt
  };
}

module.exports = { compileStyleBundle, BUNDLE_VERSION, deterministicStringify };

