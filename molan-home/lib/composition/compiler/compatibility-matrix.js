'use strict';

/**
 * @file compatibility-matrix.js
 * 创作组合兼容性矩阵与自适应微调推荐引擎
 * 
 * 核心设计原则：
 * 1. 评估“题材 × 文风 × 章节目标 × 侧重点”的协同契合度；
 * 2. 划分为四档：compatible (极高) / compatible_with_adjustment (建议微调) / rare (罕见奇招) / conflict (潜在张力)；
 * 3. 始终遵循【用户最高控制权原则】：绝不硬性拦截，而是输出建议性的局部文风调制建议（Recommended Modulation）。
 */

/**
 * 评估组合契合度并给出自适应微调建议
 * @param {Object} spec CompositionSpec 规范对象
 * @returns {Object} 兼容性评估结果
 */
function evaluateCompatibility(spec = {}) {
  const genre = spec.genre || {};
  const style = spec.style || {};
  const goal = spec.chapterGoal || {};
  const focus = spec.focus || {};

  const genreId = String(genre.id || genre.family || '');
  const styleId = String(style.id || '');
  const goalId = String(goal.id || '');
  const focusId = String(focus.id || '');

  let baseScore = 0.90;
  const observations = [];
  const recommendedModulation = {};

  // 1. 文风 vs 章节目标 协同分析
  if (styleId.includes('minimalist') || styleId.includes('qingleng')) {
    if (goalId === 'conflict_push' || goalId === 'face_slap') {
      baseScore -= 0.15;
      observations.push('【清冷写意文风】遇【激烈冲突/打脸目标】：存在行文疏离与情节爆点之间的张力');
      recommendedModulation.shortSentenceRatio = +0.15;
      recommendedModulation.averageSentenceLength = -4.0;
      recommendedModulation.emotionalIntensity = +0.18;
      recommendedModulation.dialogueRatio = +0.08;
    }
  }

  if (styleId.includes('fast_paced') || styleId.includes('cool')) {
    if (goalId === 'worldview_setup' || goalId === 'farming') {
      baseScore -= 0.12;
      observations.push('【快节奏爽文风】遇【慢热铺陈/种田目标】：需要适当放缓步调以容纳扎实细节');
      recommendedModulation.shortSentenceRatio = -0.10;
      recommendedModulation.averageSentenceLength = +3.0;
      recommendedModulation.settingRatio = +0.10;
    }
  }

  // 2. 侧重点 vs 章节目标 协同分析
  if (goalId === 'conflict_push' && focusId === 'dialogue_game') {
    observations.push('【冲突推进目标】采用【对话博弈侧重】：将形成智斗对峙、以言辞交锋推动不可逆决裂的高级质感');
    baseScore += 0.05;
  }

  if (goalId === 'info_reveal' && focusId === 'action_combat') {
    observations.push('【信息揭露目标】遇【动作搏杀侧重】：建议在搏杀对抗的间隙通过物证搜取或逼供撬出真相');
    recommendedModulation.informationDensity = +0.15;
  }

  // 3. 题材 vs 文风 协同分析
  if (genreId.includes('scifi') && styleId.includes('laobai')) {
    observations.push('【硬核科幻】遇【老白冷硬】：天然高契合度，极易呈现冷峻硬核工业质感');
    baseScore += 0.05;
  }

  const finalScore = Math.max(0.20, Math.min(1.0, Number(baseScore.toFixed(2))));
  let status = 'compatible';
  if (finalScore >= 0.85) status = 'compatible';
  else if (finalScore >= 0.70) status = 'compatible_with_adjustment';
  else if (finalScore >= 0.50) status = 'rare';
  else status = 'conflict';

  return Object.freeze({
    score: finalScore,
    status,
    isCompatible: finalScore >= 0.70,
    observations,
    recommendedModulation: Object.keys(recommendedModulation).length ? recommendedModulation : null,
    summary: status === 'compatible'
      ? '该组合高度自然协同，各项策略原子形成正向合力。'
      : (status === 'compatible_with_adjustment'
        ? '该组合具备良好叙事张力，建议采纳推荐的局部文风微调以获得最佳质感。'
        : '该组合具有前卫的反差碰撞，系统将无条件服从用户意图并注入防护边界。')
  });
}

module.exports = {
  evaluateCompatibility
};
