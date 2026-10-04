'use strict';

/**
 * word-budget.js
 * ---------------------------------------------------------------------------
 * 字数预算解析引擎：
 * 核心法则：【用户指令绝对优先，无显式指令时再默认按 2500~3500 字一章】
 * ---------------------------------------------------------------------------
 */

const DEFAULT_CHAPTER_MIN_WORDS = 2500;
const DEFAULT_CHAPTER_MAX_WORDS = 3500;
const DEFAULT_CHAPTER_TARGET_WORDS = 3000;

function parseChineseNumber(str) {
  if (!str) return 0;
  const clean = String(str).trim();
  if (/^[0-9]+$/.test(clean)) return parseInt(clean, 10);
  const map = { '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  let total = 0;
  let temp = 0;
  for (const ch of clean) {
    if (map[ch] !== undefined) {
      temp = map[ch];
    } else if (ch === '千') {
      total += (temp || 1) * 1000;
      temp = 0;
    } else if (ch === '百') {
      total += (temp || 1) * 100;
      temp = 0;
    } else if (ch === '十') {
      total += (temp || 1) * 10;
      temp = 0;
    } else if (ch === '万') {
      total = (total + temp) * 10000;
      temp = 0;
    }
  }
  return total + temp;
}

/**
 * 解析用户字数预算
 * @param {string} text 用户输入的提示词、大纲或正文指令
 * @param {Object} [options] 外部传入选项
 * @returns {Object} { hasUserInstruction: boolean, min: number, max: number, target: number, source: string, summary: string }
 */
function resolveWordBudget(text, options = {}) {
  const s = String(text || '');

  // 1. 优先扫描用户提示词中的显式字数指令（用户在聊天框或指令里写下的要求具有最高仲裁权）
  
  // 1.1 范围型：1800-2200字 / 2000~3000字 / 两千到三千字 / 篇幅约2000至2500字
  const rangeMatch = s.match(/(?:字数约?|篇幅约?|目标约?|控制在约?)?\s*([0-9]{3,5}|[一二两三四五六七八九千百]+)\s*(?:[-—~～至到]|到\s*)\s*([0-9]{3,5}|[一二两三四五六七八九千百]+)\s*字/);
  if (rangeMatch) {
    const minVal = parseChineseNumber(rangeMatch[1]);
    const maxVal = parseChineseNumber(rangeMatch[2]);
    if (minVal > 0 && maxVal > 0 && minVal <= maxVal && minVal >= 300) {
      const target = Math.round((minVal + maxVal) / 2);
      return {
        hasUserInstruction: true,
        min: minVal,
        max: maxVal,
        target,
        source: 'prompt_range',
        summary: `用户指定篇幅：${minVal} ~ ${maxVal} 字（目标约 ${target} 字）`
      };
    }
  }

  // 1.2 下限型：不少于3000字 / 至少2500字 / 大于4000字
  const atLeastMatch = s.match(/(?:不少于|至少|起码|大于)\s*([0-9]{3,5}|[一二两三四五六七八九千百]+)\s*字/);
  if (atLeastMatch) {
    const val = parseChineseNumber(atLeastMatch[1]);
    if (val >= 300 && val <= 30000) {
      const min = val;
      const max = Math.round(val * 1.25);
      const target = Math.round(val * 1.1);
      return {
        hasUserInstruction: true,
        min,
        max,
        target,
        source: 'prompt_at_least',
        summary: `用户指定篇幅：不少于 ${min} 字（目标约 ${target} 字）`
      };
    }
  }

  // 1.3 上限型：不超过4000字 / 3000字以内 / 至多2000字
  const atMostMatch = s.match(/(?:不超过|至多|少于|小于)\s*([0-9]{3,5}|[一二两三四五六七八九千百]+)\s*字|([0-9]{3,5}|[一二两三四五六七八九千百]+)\s*字(?:以内|以下)/);
  if (atMostMatch) {
    const val = parseChineseNumber(atMostMatch[1] || atMostMatch[2]);
    if (val >= 300 && val <= 30000) {
      const min = Math.round(val * 0.75);
      const max = val;
      const target = Math.round(val * 0.9);
      return {
        hasUserInstruction: true,
        min,
        max,
        target,
        source: 'prompt_at_most',
        summary: `用户指定篇幅：不超过 ${max} 字（目标约 ${target} 字）`
      };
    }
  }

  // 1.4 单一明确字数：写个1500字 / 3000字左右 / 字数2000 / 篇幅4000字
  const singleMatch = s.match(/(?:写|扩写|续写|字数|篇幅|约|大约|目标)?\s*([0-9]{3,5}|[一二两三四五六七八九千百]+)\s*字(?:左右|上下)?/);
  if (singleMatch) {
    const val = parseChineseNumber(singleMatch[1]);
    const isChapterHeading = new RegExp('第\\s*' + singleMatch[1] + '\\s*[章节回]').test(s);
    if (val >= 300 && val <= 30000 && !isChapterHeading) {
      const min = Math.round(val * 0.85);
      const max = Math.round(val * 1.15);
      return {
        hasUserInstruction: true,
        min,
        max,
        target: val,
        source: 'prompt_single',
        summary: `用户指定篇幅：约 ${val} 字（允许 ${min} ~ ${max} 字）`
      };
    }
  }

  // 2. 检查 options 中是否有显式用户指令
  if (options && typeof options === 'object') {
    if (options.targetMin && options.targetMax) {
      const min = Number(options.targetMin);
      const max = Number(options.targetMax);
      if (min > 0 && max > 0) {
        return {
          hasUserInstruction: true,
          min,
          max,
          target: Math.round((min + max) / 2),
          source: 'options_range',
          summary: `配置指定篇幅：${min} ~ ${max} 字`
        };
      }
    }
    const explicitVal = Number(options.targetWords || options.targetChars || options.wordTarget || options.chapterWordTarget);
    if (explicitVal > 0 && explicitVal !== DEFAULT_CHAPTER_TARGET_WORDS) {
      const min = Math.round(explicitVal * 0.85);
      const max = Math.round(explicitVal * 1.15);
      return {
        hasUserInstruction: true,
        min,
        max,
        target: explicitVal,
        source: 'options_target',
        summary: `配置指定篇幅：约 ${explicitVal} 字（允许 ${min} ~ ${max} 字）`
      };
    }
  }

  // 3. 用户未提供任何字数指令 -> 严格默认 2500~3500 字一章
  return {
    hasUserInstruction: false,
    min: DEFAULT_CHAPTER_MIN_WORDS,
    max: DEFAULT_CHAPTER_MAX_WORDS,
    target: DEFAULT_CHAPTER_TARGET_WORDS,
    source: 'default_chapter_budget',
    summary: `默认章节篇幅：${DEFAULT_CHAPTER_MIN_WORDS} ~ ${DEFAULT_CHAPTER_MAX_WORDS} 字一章（基准约 ${DEFAULT_CHAPTER_TARGET_WORDS} 字）`
  };
}

module.exports = {
  DEFAULT_CHAPTER_MIN_WORDS,
  DEFAULT_CHAPTER_MAX_WORDS,
  DEFAULT_CHAPTER_TARGET_WORDS,
  parseChineseNumber,
  resolveWordBudget
};
