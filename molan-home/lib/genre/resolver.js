'use strict';

const GENRE_ALIASES = Object.freeze({
  '玄幻': ['玄幻', '仙侠', '修真', '修仙', '宗门', '灵气'],
  '都市': ['都市', '职场', '商战', '现实', '日常', '职场'],
  '悬疑': ['悬疑', '推理', '惊悚', '规则怪谈', '侦探'],
  '历史': ['历史', '古代', '架空王朝', '朝堂'],
  '言情': ['言情', '恋爱', '甜宠', ' romance '],
  '科幻': ['科幻', '赛博', '星际', '机甲', '末世'],
  '西幻': ['西幻', '奇幻', '魔法', '骑士', '精灵'],
  '轻小说': ['轻小说', '校园', '异世界', '日系']
});

/** 从显式题材或用户输入生成带置信度的候选，不使用默认玄幻兜底。 */
function resolveGenre(input = {}) {
  const explicit = String(input.genre || '').trim();
  if (explicit && explicit !== 'auto') {
    const matched = Object.keys(GENRE_ALIASES).find(genre => genre === explicit || GENRE_ALIASES[genre].includes(explicit));
    if (matched) return { status: 'resolved', confidence: 1, genre: matched, subgenre: String(input.subgenre || '') };
  }
  const text = [input.title, input.userInstruction, input.prompt, ...(Array.isArray(input.messages) ? input.messages.map(item => item && item.content) : [])]
    .filter(Boolean).join('\n').toLowerCase();
  const candidates = Object.entries(GENRE_ALIASES).map(([genre, aliases]) => {
    const hits = aliases.filter(alias => text.includes(alias.toLowerCase()));
    return { genre, confidence: Math.min(0.98, hits.length ? 0.55 + hits.length * 0.12 : 0), evidence: hits };
  }).filter(item => item.confidence > 0).sort((a, b) => b.confidence - a.confidence || a.genre.localeCompare(b.genre));
  if (!candidates.length) return { status: 'uncertain', confidence: 0, candidates: [] };
  if (candidates[0].confidence >= 0.85) return { status: 'resolved', ...candidates[0], subgenre: '' };
  if (candidates[0].confidence >= 0.6) return { status: 'needs_choice', confidence: candidates[0].confidence, candidates: candidates.slice(0, 3) };
  return { status: 'uncertain', confidence: candidates[0].confidence, candidates: candidates.slice(0, 3) };
}

module.exports = { GENRE_ALIASES, resolveGenre };
