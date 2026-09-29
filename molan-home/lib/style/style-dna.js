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

/** 将用户风格选择转换为语言机制，不把作者姓名写进生成指令。 */
function resolveStyleDNA(input = {}) {
  const label = String(input.style || input.label || '').trim();
  const explicit = input.dna && typeof input.dna === 'object' ? input.dna : null;
  const dna = explicit || STYLE_DNA[label];
  if (!dna) return { status: 'needs_choice', label, candidates: Object.keys(STYLE_DNA) };
  return { status: 'resolved', styleId: String(input.styleId || label || 'custom'), dna: { ...dna }, sourceBookStyleId: String(input.sourceBookStyleId || '') };
}

module.exports = { STYLE_DNA, resolveStyleDNA };
