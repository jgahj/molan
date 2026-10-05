'use strict';

/**
 * @file debt-projection.js
 * 章节叙事债务快照投影器 (Chapter Debt Projection)
 * 
 * 核心设计目标：
 * 1. 解决【模型注意力分散】：绝不让模型无差别阅读全书数百条债务，而是精选压缩至当前章节最相关的 ~8 条；
 * 2. 5 维结构化快照分层：
 *    - urgent: 到期必兑现债 / 逾期危急债 / P0 级债务
 *    - dueSoon: 临近兑现窗口期债 (expected_payoff_from <= 当前章 <= expected_payoff_to)
 *    - activeCharacterDebts: 本章出场人物关联的人物债与关系债
 *    - openHooks: 待呼应收束的即时/短线钩子
 *    - longTermForeshadows: 远期伏笔与读者预期（防冲突、适度点题）
 * 3. 产出可直接输入创作编译器 (Strategy Compiler) 与章节合同的规范结构。
 */

const { DEBT_TYPES, DEBT_STATUSES, DEBT_PRIORITIES } = require('./debt-types');

/**
 * 为指定章节投影精炼的债务快照
 * @param {Object} ledger StoryDebtLedger 实例
 * @param {Object} options
 * @returns {Object} 章节专属债务快照
 */
function projectDebtsForChapter(ledger, options = {}) {
  if (!ledger || typeof ledger.getAllDebts !== 'function') {
    throw new TypeError('projectDebtsForChapter 需要有效的 StoryDebtLedger 实例');
  }

  const currentChapter = Math.max(1, Number(options.currentChapter ?? options.chapterNo ?? 1));
  const maxDebts = Math.max(3, Math.min(20, Number(options.maxDebts ?? 8)));
  const activeCharacters = Array.isArray(options.activeCharacters)
    ? options.activeCharacters.map(c => typeof c === 'string' ? c : c.name || c.id || '').filter(Boolean)
    : [];

  const openDebts = ledger.getOpenDebts();
  const totalOpenDebts = openDebts.length;

  const urgent = [];
  const dueSoon = [];
  const activeCharacterDebts = [];
  const openHooks = [];
  const longTermForeshadows = [];

  // 计算每条债务针对本章的关联度与紧迫度得分
  const scoredDebts = openDebts.map(debt => {
    let score = 0;

    // 1. 优先级基础分
    if (debt.priority === DEBT_PRIORITIES.CRITICAL) score += 20;
    else if (debt.priority === DEBT_PRIORITIES.HIGH) score += 12;
    else if (debt.priority === DEBT_PRIORITIES.NORMAL) score += 6;
    else score += 2;

    // 2. 到期与窗口紧迫度
    const isOverdue = currentChapter > debt.expected_payoff_to;
    const isDueSoon = currentChapter >= debt.expected_payoff_from && currentChapter <= debt.expected_payoff_to;
    const isFuture = currentChapter < debt.expected_payoff_from;

    if (isOverdue) {
      score += 18 + Math.min(10, (currentChapter - debt.expected_payoff_to) * 2);
    } else if (isDueSoon) {
      score += 10;
    } else {
      score += 1;
    }

    // 3. 人物出场关联匹配
    const isCharacterMatch = activeCharacters.length > 0 && activeCharacters.some(c =>
      (debt.target_entity_id && debt.target_entity_id.includes(c)) ||
      (debt.summary && debt.summary.includes(c)) ||
      (debt.creation_evidence && debt.creation_evidence.includes(c))
    );

    if (isCharacterMatch) {
      score += [DEBT_TYPES.CHARACTER, DEBT_TYPES.RELATIONSHIP].includes(debt.debt_type) ? 14 : 8;
    }

    // 4. 钩子即时加权
    if (debt.debt_type === DEBT_TYPES.HOOK) {
      score += 5;
    }

    return { debt, score, isOverdue, isDueSoon, isFuture, isCharacterMatch };
  });

  // 排序并精选出真正进入本章的 Top N 债务 (严格限制总数，彻底杜绝模型注意力稀释)
  scoredDebts.sort((a, b) => b.score - a.score);
  const selectedItems = scoredDebts.slice(0, maxDebts);

  // 将精选的 Top N 债务归入 5 维结构快照
  for (const item of selectedItems) {
    const d = item.debt;
    const simplified = {
      debtId: d.debt_id,
      debtType: d.debt_type,
      summary: d.summary,
      priority: d.priority,
      createdChapter: d.created_at_chapter,
      expectedPayoff: `${d.expected_payoff_from}~${d.expected_payoff_to}章`,
      status: d.status,
      evidence: d.creation_evidence
    };

    if (item.isOverdue || d.priority === DEBT_PRIORITIES.CRITICAL) {
      urgent.push({ ...simplified, overdueChapters: Math.max(0, currentChapter - d.expected_payoff_to) });
    } else if (item.isCharacterMatch && [DEBT_TYPES.CHARACTER, DEBT_TYPES.RELATIONSHIP].includes(d.debt_type)) {
      activeCharacterDebts.push(simplified);
    } else if (item.isDueSoon) {
      dueSoon.push(simplified);
    } else if (d.debt_type === DEBT_TYPES.HOOK) {
      openHooks.push(simplified);
    } else {
      longTermForeshadows.push(simplified);
    }
  }

  const selectedDebts = selectedItems.map(item => ({
    debtId: item.debt.debt_id,
    debtType: item.debt.debt_type,
    summary: item.debt.summary,
    priority: item.debt.priority,
    actionAdvice: item.isOverdue
      ? `【逾期必推进】：于第${item.debt.created_at_chapter}章产生，本章已达第${currentChapter}章，必须揭开进展或兑现！`
      : (item.isDueSoon
        ? `【窗口期兑现】：处于第${item.debt.expected_payoff_from}~${item.debt.expected_payoff_to}章预期回收区间，应顺势推进。`
        : `【背景呼应】：当前章节人物/事件关联，适当点染。`),
    evidence: item.debt.creation_evidence
  }));

  // 生成提示词编译器直接可读的精炼指令文本
  const guidanceLines = [
    `【本章叙事债务快照·第 ${currentChapter} 章】(总待偿债务 ${totalOpenDebts} 条，精选聚焦 ${selectedDebts.length} 条)`,
    urgent.length ? `· 【到期与紧急债务 (Urgent)】:\n${urgent.map(u => `  - [${u.priority.toUpperCase()}] ${u.summary} (起于第${u.createdChapter}章，已逾期${u.overdueChapters}章)`).join('\n')}` : '',
    dueSoon.length ? `· 【临近兑现窗口债务 (Due Soon)】:\n${dueSoon.map(d => `  - [${d.debtType}] ${d.summary} (预期${d.expectedPayoff})`).join('\n')}` : '',
    activeCharacterDebts.length ? `· 【出场人物待解异常/承诺 (Character Debts)】:\n${activeCharacterDebts.map(c => `  - ${c.summary}`).join('\n')}` : '',
    openHooks.length ? `· 【未兑现悬念钩子 (Open Hooks)】:\n${openHooks.map(h => `  - ${h.summary}`).join('\n')}` : '',
    longTermForeshadows.length ? `· 【远期伏笔与读者预期 (Long-term Foreshadows)】:\n${longTermForeshadows.map(f => `  - ${f.summary} (预期${f.expectedPayoff})`).join('\n')}` : ''
  ].filter(Boolean);

  return Object.freeze({
    currentChapter,
    totalOpenDebts,
    selectedDebtsCount: selectedDebts.length,
    projection: {
      urgent: Object.freeze(urgent),
      dueSoon: Object.freeze(dueSoon),
      activeCharacterDebts: Object.freeze(activeCharacterDebts),
      openHooks: Object.freeze(openHooks),
      longTermForeshadows: Object.freeze(longTermForeshadows)
    },
    debtsToAddress: Object.freeze(selectedDebts),
    debtsToCreate: [],
    promptGuidance: guidanceLines.join('\n\n')
  });
}

module.exports = {
  projectDebtsForChapter
};
