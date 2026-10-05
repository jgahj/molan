'use strict';

/**
 * @file factorized-extractor.js
 * 因子化小说正交分析与多标签加权标注引擎 (Factorized Fiction Analysis)
 * 
 * 核心设计原则：
 * 1. 杜绝简单单标签粗暴分类，支持【多标签分类 + 主目标 + 次目标权重】；
 * 2. 控制变量正交提取 (Orthogonal Disentangling)：
 *    - 剥离文风：分离题材与情节骨架，测量纯净的 11 维句长、短句比与对白密度；
 *    - 剥离目标：寻找章节内的状态跃迁 (State Delta) 与不可逆因果转移；
 *    - 剥离钩子：定位末尾 300 字内的缺口类型与强度；
 * 3. 产出可存入数据库/供策略编译器检索的章节因子特征对象 (ChapterFeatures)。
 */

const { normalizeStyleVector } = require('../profiles/style-profile');

/**
 * 针对单章节正文执行因子化特征抽取
 * @param {string} chapterText 章节正文文本
 * @param {Object} metadata 上下文元数据（如作品题材、章节号等）
 * @returns {Object} 因子化特征包 (ChapterFeatures)
 */
function extractChapterFactors(chapterText = '', metadata = {}) {
  const content = String(chapterText || '').trim();
  const totalChars = content.length;
  if (!totalChars) {
    throw new TypeError('extractChapterFactors 正文不能为空');
  }

  // 1. 文风正交因子测算 (11 维物理指标)
  const sentences = content.split(/[。！？!?\n]+/).map(s => s.trim()).filter(Boolean);
  const sentenceCount = Math.max(1, sentences.length);
  const avgSentenceLen = Number((totalChars / sentenceCount).toFixed(1));
  const shortSentences = sentences.filter(s => s.length <= 15).length;
  const shortSentenceRatio = Number((shortSentences / sentenceCount).toFixed(3));

  // 对白占比
  const dialogueMatches = content.match(/“[^”]+”|"([^"]+)"|‘[^’]+’/g) || [];
  const dialogueCharCount = dialogueMatches.reduce((acc, d) => acc + d.length, 0);
  const dialogueRatio = Number((dialogueCharCount / totalChars).toFixed(3));

  // 动作与物理动词密度指标
  const actionVerbs = (content.match(/撞|砸|劈|退|抽|按|扣|崩|裂|刺|撕|握|抵|踩/g) || []).length;
  const actionDensity = Math.min(1.0, Number((actionVerbs / Math.max(10, totalChars / 100)).toFixed(3)));

  // 疑问与悬念词条密度
  const questionMarks = (content.match(/[？?]/g) || []).length;
  const suspenseKeywords = (content.match(/到底|为何|秘密|残缺|疑云|异样|冷笑|暗藏/g) || []).length;
  const mysteryIntensity = Math.min(1.0, Number(((questionMarks * 2 + suspenseKeywords) / Math.max(5, sentenceCount / 10)).toFixed(3)));

  // 2. 多目标加权推断 (Primary + Secondary Goals with Weights)
  let primaryGoal = 'plot_progression';
  const secondaryGoals = [];

  if (actionDensity >= 0.45 || (content.match(/杀|死|刀|剑|拳|轰|斩/g) || []).length >= 15) {
    primaryGoal = 'conflict_push';
    if (mysteryIntensity >= 0.35) {
      secondaryGoals.push({ id: 'info_reveal', weight: 0.40 });
    }
    if (dialogueRatio >= 0.30) {
      secondaryGoals.push({ id: 'dialogue_game', weight: 0.30 });
    }
  } else if (mysteryIntensity >= 0.40 || (content.match(/证据|密信|真相|身世|发现|原来/g) || []).length >= 8) {
    primaryGoal = 'info_reveal';
    if (dialogueRatio >= 0.35) {
      secondaryGoals.push({ id: 'dialogue_game', weight: 0.45 });
    }
  } else if (dialogueRatio >= 0.42) {
    primaryGoal = 'dialogue_game';
    secondaryGoals.push({ id: 'conflict_push', weight: 0.35 });
  } else {
    primaryGoal = 'balanced_narrative';
  }

  // 3. 镜头笔墨预算正交分解 (Focus Breakdown)
  const focusVector = {
    dialogue: dialogueRatio,
    action: actionDensity * 0.4,
    setting: Number(Math.max(0.05, Math.min(0.35, 1.0 - dialogueRatio - (actionDensity * 0.4) - 0.2)).toFixed(3)),
    conflict: actionDensity >= 0.3 ? 0.30 : 0.15,
    character: 0.20,
    emotion: Number(Math.max(0.05, Math.min(0.30, 0.25 - (actionDensity * 0.1))).toFixed(3)),
    foreshadowing: mysteryIntensity >= 0.3 ? 0.10 : 0.05
  };

  // 4. 末尾钩子因子抽取 (Tail 300 chars)
  const tailText = content.slice(-300);
  let tailHookType = 'anticipation';
  let tailGapType = 'expectation_gap';
  let hookStrength = 0.65;

  if (/[？?]/.test(tailText) || /为何|怎么会|究竟是谁|居然是他/i.test(tailText)) {
    tailHookType = 'suspense';
    tailGapType = 'information_gap';
    hookStrength = 0.85;
  } else if (/突然|杀至|破门|轰然|倒飞|来不及/i.test(tailText)) {
    tailHookType = 'crisis';
    tailGapType = 'danger_gap';
    hookStrength = 0.88;
  } else if (/反转|圈套|不是|竟然是|算计/i.test(tailText)) {
    tailHookType = 'twist';
    tailGapType = 'expectation_gap';
    hookStrength = 0.82;
  }

  // 5. 结果契约与意图抽取 (Outcome Contract)
  const outcomeContract = {
    stateDelta: {
      stateBefore: '章节开端情境',
      events: secondaryGoals.map(g => `推进【${g.id}】`),
      stateAfter: primaryGoal === 'conflict_push' ? '冲突激化并产生阶段性对抗结果' : (primaryGoal === 'info_reveal' ? '关键物证/信息浮出水面' : '局面不可逆推进'),
      invalidIfRemoved: '若删除本章，后续因果链断裂'
    },
    readerEffect: {
      knowledgeDelta: mysteryIntensity >= 0.3 ? '获得关键反常线索' : '掌握人物行动意图',
      emotionalShift: actionDensity >= 0.4 ? '紧张压迫感' : '探究与悬念好奇'
    },
    characterEffect: {
      motivationDelta: '目标明确化',
      beliefShift: mysteryIntensity >= 0.4 ? '对原有常识产生怀疑' : ''
    }
  };

  return Object.freeze({
    totalChars,
    sentenceCount,
    primaryGoal,
    secondaryGoals,
    focusVector,
    outcomeContract,
    tailHook: {
      type: tailHookType,
      gapType: tailGapType,
      strength: hookStrength,
      tailSnippet: tailText.slice(-80)
    },
    stylometry: normalizeStyleVector({
      averageSentenceLength: avgSentenceLen,
      shortSentenceRatio,
      dialogueRatio,
      informationDensity: Number(Math.min(1.0, 0.5 + mysteryIntensity * 0.4).toFixed(3))
    }),
    metadata: {
      novelTitle: metadata.title || '',
      chapterNo: metadata.chapterNo || null,
      genre: metadata.genre || 'universal'
    }
  });
}

/**
 * 将章节瞬态文风失真与作者稳定文风基因剥离 (Style Disentangling)
 * @param {Object} chapterStylometry 当前章节测算的表层向量
 * @param {string} chapterGoal 当前章节目标 (如 conflict_push)
 * @returns {Object} 修正剥离后的作者纯净基准向量
 */
function disentangleStyleFromGoal(chapterStylometry = {}, chapterGoal = 'balanced_narrative') {
  const corrected = { ...chapterStylometry };
  // 若属于激烈战斗冲突章，短句比通常会临时飙升 +0.15~0.20，基线文风需反向平抑
  if (chapterGoal === 'conflict_push' || chapterGoal === 'action_combat') {
    if (corrected.shortSentenceRatio != null) {
      corrected.shortSentenceRatio = Math.max(0.1, Number((corrected.shortSentenceRatio - 0.15).toFixed(3)));
    }
    if (corrected.averageSentenceLength != null) {
      corrected.averageSentenceLength = Number((corrected.averageSentenceLength + 3.5).toFixed(1));
    }
  }
  return normalizeStyleVector(corrected);
}

module.exports = {
  extractChapterFactors,
  disentangleStyleFromGoal
};
