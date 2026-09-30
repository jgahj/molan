'use strict';

/**
 * style-registry.js
 * ---------------------------------------------------------------------------
 * 统一风格母表注册表 (Unified Style Registry)
 *
 * 遵循第十一、十二、六十二条规范：
 * 1. 唯一风格真理源 (Single Source of Truth for Prose Styles)；
 * 2. 题材 (Genre) 与风格 (Style) 解耦：
 *    - Genre 决定故事属于什么世界
 *    - Style 决定语言质感与叙事距离
 * 3. 每一个 Style Profile 包含可计算的多维特征：
 *    rhythm, syntax, diction, narration, dialogue, emotion, pacing, antiPatterns
 * ---------------------------------------------------------------------------
 */

const STYLE_CATALOG = Object.freeze({
  cold_measured: {
    id: 'cold_measured',
    title: '冷峻克制',
    aliases: ['冷峻', '冷峻克制', 'hardcore_progression', 'dark_calculating', 'scifi_hardcore'],
    description: '客观冷冽、去情绪化标签、高物理细节、暗流涌动',
    profile: {
      rhythm: { sentenceLengthP50: 20, sentenceLengthVariance: 16, dialogueRatio: 0.22 },
      syntax: { shortSentenceRatio: 0.35, longSentenceRatio: 0.15, fragmentRatio: 0.08 },
      diction: { register: 'restrained_modern', idiomDensity: 0.08, metaphorDensity: 0.18 },
      narration: { distance: 'third_limited', interiority: 'low_to_medium', perspective: 'behavioral_observation' },
      dialogue: { avgTurnLength: 16, subtextLevel: 'high', directAnswerRate: 0.35 },
      emotion: { explicitEmotion: 'low', behavioralEmotion: 'high', internalMonologue: 'minimal' },
      pacing: { microConflictInterval: 250, sceneTurnInterval: 550 },
      antiPatterns: ['generic_emotion_label', 'abstract_moral_summary', 'melodramatic_outburst']
    }
  },
  hot_blooded: {
    id: 'hot_blooded',
    title: '热血激昂',
    aliases: ['热血', '热血激昂', 'urban_face_slap', 'battle_drive'],
    description: '短促有力、压制反弹明确、动作物理感强、情绪释放坚决',
    profile: {
      rhythm: { sentenceLengthP50: 16, sentenceLengthVariance: 12, dialogueRatio: 0.32 },
      syntax: { shortSentenceRatio: 0.45, longSentenceRatio: 0.10, fragmentRatio: 0.12 },
      diction: { register: 'impactful_vernacular', idiomDensity: 0.10, metaphorDensity: 0.35 },
      narration: { distance: 'third_subjective', interiority: 'high', perspective: 'protagonist_drive' },
      dialogue: { avgTurnLength: 14, subtextLevel: 'medium', directAnswerRate: 0.65 },
      emotion: { explicitEmotion: 'medium_high', behavioralEmotion: 'high', internalMonologue: 'punchy' },
      pacing: { microConflictInterval: 180, sceneTurnInterval: 400 },
      antiPatterns: ['passive_hesitation', 'overextended_monologue', 'anticlimax_deflation']
    }
  },
  witty_humorous: {
    id: 'witty_humorous',
    title: '诙谐风趣',
    aliases: ['诙谐', '风趣', 'humorous_sand_sculpture', 'light_comedy'],
    description: '错位反转、自嘲解构、生活流对话生动、节律弹性大',
    profile: {
      rhythm: { sentenceLengthP50: 22, sentenceLengthVariance: 20, dialogueRatio: 0.42 },
      syntax: { shortSentenceRatio: 0.30, longSentenceRatio: 0.20, fragmentRatio: 0.06 },
      diction: { register: 'lively_colloquial', idiomDensity: 0.12, metaphorDensity: 0.28 },
      narration: { distance: 'third_playful', interiority: 'medium', perspective: 'ironic_distance' },
      dialogue: { avgTurnLength: 18, subtextLevel: 'medium', directAnswerRate: 0.50 },
      emotion: { explicitEmotion: 'low_medium', behavioralEmotion: 'high', internalMonologue: 'humorous_contrast' },
      pacing: { microConflictInterval: 220, sceneTurnInterval: 480 },
      antiPatterns: ['deadpan_exposition', 'heavy_pathos', 'cliche_slapstick']
    }
  },
  restrained_tension: {
    id: 'restrained_tension',
    title: '悬疑紧绷',
    aliases: ['克制', '悬疑紧绷', 'creepy_folklore', 'court_intrigue'],
    description: '留白递进、信息不对称、感官特写、环境心理投射',
    profile: {
      rhythm: { sentenceLengthP50: 24, sentenceLengthVariance: 18, dialogueRatio: 0.25 },
      syntax: { shortSentenceRatio: 0.32, longSentenceRatio: 0.22, fragmentRatio: 0.09 },
      diction: { register: 'atmospheric_literary', idiomDensity: 0.14, metaphorDensity: 0.25 },
      narration: { distance: 'third_tight_limited', interiority: 'high', perspective: 'focalized_uncertainty' },
      dialogue: { avgTurnLength: 15, subtextLevel: 'very_high', directAnswerRate: 0.30 },
      emotion: { explicitEmotion: 'minimal', behavioralEmotion: 'high', internalMonologue: 'paranoia_monitored' },
      pacing: { microConflictInterval: 260, sceneTurnInterval: 600 },
      antiPatterns: ['premature_reveal', 'omniscient_explaining', 'cheap_jump_scares']
    }
  },
  desolate_historical: {
    id: 'desolate_historical',
    title: '苍凉厚重',
    aliases: ['苍凉', '苍凉厚重', 'dynasty_weight', 'historical_tragic'],
    description: '词章古雅、制度摩擦、宿命因果、全景宏大叙事',
    profile: {
      rhythm: { sentenceLengthP50: 28, sentenceLengthVariance: 22, dialogueRatio: 0.20 },
      syntax: { shortSentenceRatio: 0.22, longSentenceRatio: 0.35, fragmentRatio: 0.04 },
      diction: { register: 'classical_historical', idiomDensity: 0.22, metaphorDensity: 0.32 },
      narration: { distance: 'third_panoramic', interiority: 'medium', perspective: 'tides_of_history' },
      dialogue: { avgTurnLength: 24, subtextLevel: 'high', directAnswerRate: 0.40 },
      emotion: { explicitEmotion: 'restrained_pathos', behavioralEmotion: 'high', internalMonologue: 'epoch_weight' },
      pacing: { microConflictInterval: 350, sceneTurnInterval: 750 },
      antiPatterns: ['modern_slang', 'frivolous_dialogue', 'anachronistic_ethics']
    }
  },
  brisk_lighthearted: {
    id: 'brisk_lighthearted',
    title: '轻快明朗',
    aliases: ['轻快', '轻快明朗', 'sweet_healing_pet', 'cozy_progression'],
    description: '句式清晰通透、情绪明朗治愈、生活细节饱满、行文不拖沓',
    profile: {
      rhythm: { sentenceLengthP50: 18, sentenceLengthVariance: 14, dialogueRatio: 0.38 },
      syntax: { shortSentenceRatio: 0.38, longSentenceRatio: 0.14, fragmentRatio: 0.05 },
      diction: { register: 'modern_accessible', idiomDensity: 0.08, metaphorDensity: 0.22 },
      narration: { distance: 'third_warm', interiority: 'medium_high', perspective: 'sympathetic_closeness' },
      dialogue: { avgTurnLength: 16, subtextLevel: 'medium', directAnswerRate: 0.70 },
      emotion: { explicitEmotion: 'warm_positive', behavioralEmotion: 'high', internalMonologue: 'gentle' },
      pacing: { microConflictInterval: 200, sceneTurnInterval: 450 },
      antiPatterns: ['grandiose_prose', 'oppressive_gloom', 'cynical_nihilism']
    }
  },
  epic_grandeur: {
    id: 'epic_grandeur',
    title: '史诗宏大',
    aliases: ['史诗', '史诗宏大', 'epic_grandeur', 'cosmic_scale'],
    description: '宏观维度、阵营博弈、阵列齐整、崇高感与秩序张力',
    profile: {
      rhythm: { sentenceLengthP50: 26, sentenceLengthVariance: 24, dialogueRatio: 0.22 },
      syntax: { shortSentenceRatio: 0.25, longSentenceRatio: 0.32, fragmentRatio: 0.06 },
      diction: { register: 'solemn_literary', idiomDensity: 0.18, metaphorDensity: 0.42 },
      narration: { distance: 'third_epic', interiority: 'medium', perspective: 'civilizational_clash' },
      dialogue: { avgTurnLength: 22, subtextLevel: 'high', directAnswerRate: 0.45 },
      emotion: { explicitEmotion: 'controlled_grandeur', behavioralEmotion: 'high', internalMonologue: 'principled' },
      pacing: { microConflictInterval: 320, sceneTurnInterval: 700 },
      antiPatterns: ['petty_bickering', 'modern_casual_quips', 'anti_climactic_brawl']
    }
  },
  naturalistic_daily: {
    id: 'naturalistic_daily',
    title: '日常生活流',
    aliases: ['日常', '生活流', 'workplace_inversion', 'daily_realism'],
    description: '真实烟火气、细致经济考据、人物对话不装腔、生活规律真实',
    profile: {
      rhythm: { sentenceLengthP50: 21, sentenceLengthVariance: 15, dialogueRatio: 0.45 },
      syntax: { shortSentenceRatio: 0.32, longSentenceRatio: 0.18, fragmentRatio: 0.05 },
      diction: { register: 'authentic_daily', idiomDensity: 0.10, metaphorDensity: 0.12 },
      narration: { distance: 'third_natural', interiority: 'medium', perspective: 'close_daily_reality' },
      dialogue: { avgTurnLength: 17, subtextLevel: 'medium', directAnswerRate: 0.60 },
      emotion: { explicitEmotion: 'understated', behavioralEmotion: 'very_high', internalMonologue: 'practical_thought' },
      pacing: { microConflictInterval: 240, sceneTurnInterval: 500 },
      antiPatterns: ['theatrical_posing', 'abstract_rhetoric', 'unearned_drama']
    }
  }
});

function getStyleCatalog() {
  return STYLE_CATALOG;
}

function resolveStyleId(input) {
  if (!input) return 'cold_measured';
  const raw = String(input.style || input.id || input || '').trim();
  for (const [id, item] of Object.entries(STYLE_CATALOG)) {
    if (id === raw || item.title === raw || (Array.isArray(item.aliases) && item.aliases.includes(raw))) {
      return id;
    }
  }
  return 'cold_measured';
}

function getStyleProfile(styleIdOrAlias) {
  const id = resolveStyleId(styleIdOrAlias);
  return STYLE_CATALOG[id] || STYLE_CATALOG.cold_measured;
}

module.exports = {
  STYLE_CATALOG,
  getStyleCatalog,
  resolveStyleId,
  getStyleProfile
};
