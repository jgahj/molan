'use strict';

/**
 * @file style-aware-humanizer.js
 * 文风感知人味化处理引擎 (Style-Aware Humanizer)
 * 
 * 核心设计原则：
 * 1. 废除单一粗暴的“万能通用 Humanizer”，避免将清冷、老白或爽文风格抹平成同一种平庸腔调；
 * 2. 结构化多层人味机制：
 *    - 底层通用：消除机械式 AI 连接词（“与此同时”、“不得不说”、“值得一提的是”）
 *    - 文风专属：根据 StyleProfile 注入差异化质感（老白注入器物冷硬，爽文注入干脆断句，清冷注入留白疏离）
 *    - 目标专属：根据 ChapterGoal 强化情境本能反应（冲突章注入生理微颤，揭露章注入知觉停滞）。
 */

const UNIVERSAL_AI_CONNECTORS = [
  { pattern: /与此同时，/g, replacement: '' },
  { pattern: /不得不说，/g, replacement: '' },
  { pattern: /值得一提的是，/g, replacement: '' },
  { pattern: /仿佛在诉说着什么/g, replacement: '沉寂无声' },
  { pattern: /眼中闪过一丝不易察觉的/g, replacement: '目光微凝，掠过' },
  { pattern: /嘴角勾起一抹(?:森然|玩味|冷酷)?的弧度/g, replacement: '面无表情地抬起眼' },
  { pattern: /倒吸一口凉气/g, replacement: '呼吸蓦地一滞' },
  { pattern: /瞳孔(?:剧烈|猛然)?骤缩/g, replacement: '眼神骤冷' }
];

/**
 * 根据文风与目标定制执行人味化微创润色
 * @param {string} text 原始草稿正文
 * @param {Object} options 包含 styleProfile 与 chapterGoalProfile
 * @returns {{ text: string, changeCount: number, rulesApplied: string[] }}
 */
function humanizeWithStyle(text = '', options = {}) {
  let content = String(text || '');
  if (!content) return { text: '', changeCount: 0, rulesApplied: [] };

  const style = options.styleProfile || options.style || {};
  const goal = options.chapterGoalProfile || options.chapterGoal || {};
  const styleId = String(style.id || '');
  const goalId = String(goal.id || '');

  let changeCount = 0;
  const rulesApplied = [];

  // 1. 底层通用微创消除
  for (const item of UNIVERSAL_AI_CONNECTORS) {
    const matches = content.match(item.pattern);
    if (matches && matches.length) {
      content = content.replace(item.pattern, item.replacement);
      changeCount += matches.length;
    }
  }
  if (changeCount > 0) rulesApplied.push('通用机械式 AI 句式过滤');

  // 2. 文风专属微调
  if (styleId.includes('laobai') || styleId.includes('restrained')) {
    // 老白文风：削减无意义感叹号，削减空泛的“心中充满了”
    const exclaims = content.match(/！/g);
    if (exclaims && exclaims.length >= 5) {
      content = content.replace(/！/g, '。');
      changeCount += exclaims.length;
      rulesApplied.push('老白冷硬：平抑多余感叹号为沉稳句号');
    }
    const heartFeelings = content.match(/心中充满了[^。]+。/g);
    if (heartFeelings) {
      content = content.replace(/心中充满了([^，。]+)[，。]/g, '');
      changeCount += heartFeelings.length;
      rulesApplied.push('老白冷硬：剔除空泛内心独白概括');
    }
  } else if (styleId.includes('fast_paced') || styleId.includes('cool')) {
    // 爽文：清理拖沓冗长修饰
    const redundantModifiers = content.match(/显得格外(?:的)?/g);
    if (redundantModifiers) {
      content = content.replace(/显得格外(?:的)?/g, '');
      changeCount += redundantModifiers.length;
      rulesApplied.push('爽文节奏：压缩冗余副词修饰');
    }
  }

  // 3. 目标专属微调 (冲突 vs 揭露)
  if (goalId === 'conflict_push') {
    // 冲突章：替换“瞬间”、“刹那”高频复现
    let momentCount = 0;
    content = content.replace(/就在这一瞬间[，,]/g, () => {
      momentCount++;
      return momentCount % 2 === 1 ? '电光石火间，' : '';
    });
    if (momentCount > 0) {
      changeCount += momentCount;
      rulesApplied.push('冲突推进：消解“瞬间”高频词堆叠');
    }
  }

  return {
    text: content,
    changeCount,
    rulesApplied
  };
}

module.exports = {
  humanizeWithStyle,
  UNIVERSAL_AI_CONNECTORS
};
