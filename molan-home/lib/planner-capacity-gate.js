'use strict';

/**
 * planner-capacity-gate.js
 * ---------------------------------------------------------------------------
 * 单章戏剧事件容量门禁与智能拆章编排器 (Planner Capacity Gate - OPT-SCENE-001)
 *
 * 核心设计目标：
 * 1. 根治 DEF-PACING-002：单章事件容量超载（2400字塞入7个大事件，无呼吸留白）；
 * 2. 根治 DEF-PACING-001：因字数紧迫导致的机械硬切（如无过渡直接“三日后”）；
 * 3. 门禁规则：
 *    - 2~3 事件：最佳心流（每个事件 700~1000 字，留白从容）；
 *    - 4~5 事件：偏密集（需压缩并强制保留 10~15% 呼吸留白）；
 *    - >= 6 事件：严重过载（触发自动分章建议或自动拆章分流）；
 * 4. 智能拆章分流 (Chapter Partitioning)：将超载大纲拆解为多章节连贯规格链。
 * ---------------------------------------------------------------------------
 */

const CAPACITY_RULES = Object.freeze({
  optimalEventsMin: 2,
  optimalEventsMax: 3,
  denseEventsThreshold: 4,
  overloadEventsThreshold: 6,
  minWordsPerEvent: 600,
  recommendedDowntimeRatio: 0.12 // 12% 呼吸留白
});

/**
 * 评估单章大纲事件容量
 * @param {Array<string|Object>} events 事件节点列表
 * @param {number} targetWordCount 目标字数
 * @returns {Object} 容量评估报告
 */
function evaluateChapterCapacity(events = [], targetWordCount = 2400) {
  const eventList = Array.isArray(events) ? events : [];
  const count = eventList.length;
  const charsPerEvent = count > 0 ? Math.round(targetWordCount / count) : targetWordCount;

  let status = 'optimal';
  let issue = null;
  let recommendation = null;
  let requiresPartitioning = false;

  if (count >= CAPACITY_RULES.overloadEventsThreshold) {
    status = 'overload';
    requiresPartitioning = true;
    issue = `单章大纲事件严重过载 (${count} 个事件)，单事件仅分配 ~${charsPerEvent} 字 (远低于 ${CAPACITY_RULES.minWordsPerEvent} 字安全阈值)，必然引发严重节奏过紧、紧绷无呼吸留白 (DEF-PACING-002) 与机械时空硬切 (DEF-PACING-001)。`;
    recommendation = `建议将大纲拆解为 ${Math.ceil(count / CAPACITY_RULES.optimalEventsMax)} 个连贯章节，激活智能拆章分流器 (partitionChapterEvents) 释放留白空间。`;
  } else if (count >= CAPACITY_RULES.denseEventsThreshold) {
    status = 'dense';
    requiresPartitioning = false;
    issue = `单章大纲事件偏密集 (${count} 个事件)，单事件篇幅 ~${charsPerEvent} 字。`;
    recommendation = `需严格在交接处注入 10~15% 呼吸留白镜头，防止读者持续紧绷疲劳。`;
  } else {
    status = 'optimal';
    requiresPartitioning = false;
    issue = null;
    recommendation = `事件容量适中，可从容书写情绪沉淀与动作细节。`;
  }

  const downtimeChars = Math.round(targetWordCount * CAPACITY_RULES.recommendedDowntimeRatio);
  const narrativeChars = targetWordCount - downtimeChars;

  return {
    status,
    count,
    nodeCount: count,
    targetWordCount,
    charsPerEvent,
    charsPerNode: charsPerEvent,
    downtimeChars,
    narrativeChars,
    requiresPartitioning,
    issue,
    recommendation
  };
}

/**
 * 将严重过载的大纲事件智能拆解为多章节连贯流水线
 * @param {Array<string|Object>} events 原始大纲事件
 * @param {Object} options 配置项 (maxPerChapter 默认为 3)
 * @returns {Array<Object>} 拆分后的章节规格清单
 */
function partitionChapterEvents(events = [], options = {}) {
  const maxPerChapter = options.maxPerChapter || CAPACITY_RULES.optimalEventsMax;
  const targetWordsPerChapter = options.targetWordsPerChapter || 2400;
  const eventList = Array.isArray(events) ? events : [];

  if (eventList.length <= maxPerChapter) {
    return [{
      chapterIndex: 1,
      events: eventList,
      targetWordCount: targetWordsPerChapter,
      isSplit: false,
      incomingHook: null,
      outgoingHook: '本章自然收尾'
    }];
  }

  const chapters = [];
  let currentEvents = [];
  let chapterIndex = 1;

  for (let i = 0; i < eventList.length; i++) {
    currentEvents.push(eventList[i]);

    if (currentEvents.length === maxPerChapter || i === eventList.length - 1) {
      const isLast = i === eventList.length - 1;
      const nextEvent = !isLast ? eventList[i + 1] : null;
      const nextDesc = typeof nextEvent === 'string' ? nextEvent : (nextEvent?.text || nextEvent?.title || '');

      chapters.push({
        chapterIndex,
        events: [...currentEvents],
        targetWordCount: targetWordsPerChapter,
        isSplit: true,
        incomingHook: chapterIndex === 1 ? null : `承接前章余波，局势进一步发酵`,
        outgoingHook: !isLast ? `为下一章【${nextDesc.slice(0, 18)}...】埋下强烈行动悬念与时空蓄势` : '阶段终局收束'
      });

      currentEvents = [];
      chapterIndex += 1;
    }
  }

  return chapters;
}

module.exports = {
  CAPACITY_RULES,
  evaluateChapterCapacity,
  partitionChapterEvents
};
