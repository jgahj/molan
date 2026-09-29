'use strict';

const STYLE_DNA = Object.freeze({
  '热血': { sentence: 'short-medium', pacing: 'driving', emotion: 'overt-but-earned', dialogue: 'decisive', metaphorDensity: 0.35 },
  '冷峻': { sentence: 'short-medium', pacing: 'measured', emotion: 'restrained', dialogue: 'subtextual', metaphorDensity: 0.18 },
  '诙谐': { sentence: 'varied', pacing: 'quick-release', emotion: 'light', dialogue: 'playful', metaphorDensity: 0.28 },
  '克制': { sentence: 'medium', pacing: 'quiet-tension', emotion: 'indirect', dialogue: 'subtextual', metaphorDensity: 0.2 },
  '苍凉': { sentence: 'medium-long', pacing: 'slow-burn', emotion: 'muted-loss', dialogue: 'sparse', metaphorDensity: 0.3 },
  '轻快': { sentence: 'short', pacing: 'brisk', emotion: 'warm', dialogue: 'frequent', metaphorDensity: 0.22 },
  '史诗': { sentence: 'varied-long', pacing: 'broad-arc', emotion: 'controlled-grandeur', dialogue: 'formal', metaphorDensity: 0.42 },
  '日常': { sentence: 'varied', pacing: 'episodic', emotion: 'naturalistic', dialogue: 'conversational', metaphorDensity: 0.12 }
});

const ARCHETYPE_TO_STYLE_DNA = Object.freeze({
  humorous_sand_sculpture: '诙谐',
  workplace_inversion: '日常',
  sweet_healing_pet: '轻快',
  hardcore_progression: '冷峻',
  urban_face_slap: '热血',
  creepy_folklore: '克制',
  court_intrigue: '克制',
  dark_calculating: '冷峻',
  scifi_hardcore: '冷峻',
  epic_grandeur: '史诗'
});

/** 将用户风格选择或题材原型转换为语言机制，不把作者姓名写进生成指令。 */
function resolveStyleDNA(input = {}) {
  let label = '';
  let archetypeId = '';

  if (typeof input === 'string') {
    label = input.trim();
  } else if (input && typeof input === 'object') {
    label = String(input.style || input.label || input.name || input.styleArchetype || input.id || '').trim();
    archetypeId = String(input.archetypeId || input.styleArchetype || input.id || '').trim();
  }

  // 1. Direct hit in STYLE_DNA
  let matchedDnaKey = Object.keys(STYLE_DNA).find(k => k === label);

  // 2. Archetype ID mapping
  if (!matchedDnaKey) {
    const archKey = archetypeId || label;
    if (ARCHETYPE_TO_STYLE_DNA[archKey]) {
      matchedDnaKey = ARCHETYPE_TO_STYLE_DNA[archKey];
      archetypeId = archKey;
    }
  }

  const explicit = input && typeof input === 'object' && input.dna && typeof input.dna === 'object' ? input.dna : null;
  const dna = explicit || (matchedDnaKey ? STYLE_DNA[matchedDnaKey] : null);

  if (!dna) {
    return {
      status: 'needs_choice',
      label,
      candidates: Object.keys(STYLE_DNA)
    };
  }

  return {
    status: 'resolved',
    styleId: String((input && input.styleId) || matchedDnaKey || label || 'custom'),
    styleDnaKey: matchedDnaKey || null,
    archetypeId: archetypeId || null,
    dna: { ...dna },
    sourceBookStyleId: String((input && input.sourceBookStyleId) || '')
  };
}

function toStyleDNA(input) {
  const res = resolveStyleDNA(input);
  return res.status === 'resolved' ? res.dna : STYLE_DNA['日常'];
}

module.exports = { STYLE_DNA, ARCHETYPE_TO_STYLE_DNA, resolveStyleDNA, toStyleDNA };

