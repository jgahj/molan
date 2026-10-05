'use strict';

/**
 * @file debt-reconciliation.js
 * 章节生成后债务对账与总账闭环推进器 (Chapter Debt Reconciliation)
 * 
 * 核心架构定位：
 * 1. 作为章节审计输出与总账更新之间的硬接口；
 * 2. 审查章节生成正文与审计结果，核销本章已回收伏笔 (PAID/PARTIALLY_PAID)；
 * 3. 推进本章已激化矛盾 (ESCALATED/REFRAMED)；
 * 4. 自动捕获章末新埋设钩子或新因果，登记入账 (CREATED)；
 * 5. 产出可审计的对账报告。
 */

const { DEBT_TYPES, DEBT_EVENT_TYPES, DEBT_STATUSES } = require('./debt-types');

/**
 * 执行章节债务对账
 * @param {Object} params
 * @returns {Object} 对账结果报告
 */
function reconcileChapterDebts(params = {}) {
  const {
    ledger,
    chapterNo = 1,
    chapterId = '',
    draftText = '',
    auditResult = {},
    contract = {},
    compositionSpec = null,
    declaredResolutions = [],
    declaredDebtsToCreate = []
  } = params;

  if (!ledger || typeof ledger.recordEvent !== 'function') {
    throw new TypeError('reconcileChapterDebts 需要有效的 StoryDebtLedger 实例');
  }

  const text = String(draftText || '').trim();
  const eventsRecorded = [];
  const debtsUpdated = [];
  const debtsCreated = [];

  // 1. 处理显式声明的结算动作 (Declared Resolutions)
  for (const item of declaredResolutions) {
    const debtId = item.debtId || item.debt_id;
    if (!debtId) continue;
    const existing = ledger.getDebt(debtId);
    if (!existing) continue;

    const action = String(item.action || 'PAID').toUpperCase();
    let record = null;
    const opts = {
      chapterNo,
      chapterId,
      evidence: item.evidence || '',
      notes: item.notes || `第 ${chapterNo} 章结算`,
      operator: 'reconciliation'
    };

    if (action === DEBT_EVENT_TYPES.PAID) {
      record = ledger.payDebt(debtId, opts);
    } else if (action === DEBT_EVENT_TYPES.PARTIALLY_PAID) {
      record = ledger.partiallyPayDebt(debtId, opts);
    } else if (action === DEBT_EVENT_TYPES.ESCALATED) {
      record = ledger.escalateDebt(debtId, opts);
    } else if (action === DEBT_EVENT_TYPES.REFRAMED) {
      record = ledger.reframeDebt(debtId, { ...opts, payload: item.payload || {} });
    } else if (action === DEBT_EVENT_TYPES.DEFERRED) {
      record = ledger.deferDebt(debtId, opts);
    }

    if (record) {
      eventsRecorded.push(record.event);
      debtsUpdated.push(record.debt);
    }
  }

  // 2. 基于正文引文和关键词的启发式核销检测 (Heuristic Evidence Match)
  const openDebts = ledger.getOpenDebts();
  const processedDebtIds = new Set(declaredResolutions.map(r => r.debtId || r.debt_id));

  for (const debt of openDebts) {
    if (processedDebtIds.has(debt.debt_id)) continue;

    // 针对本章提及的人物、实体或物证进行局部紧邻高精度匹配 (防止仅提主角名字导致全书因果被误核销)
    const targetEntity = debt.target_entity_id;
    const rawTokens = (debt.summary || '').split(/[^\u4e00-\u9fa5a-zA-Z0-9]+/).filter(Boolean);
    const bigramSet = new Set();
    const stopWords = new Set(['对于', '关于', '为了', '如果', '并且', '以及', '没有', '不是']);
    for (const t of rawTokens) {
      if (t.length >= 2 && t.length <= 4 && !stopWords.has(t)) bigramSet.add(t);
      for (let i = 0; i <= t.length - 2; i++) {
        const bg = t.slice(i, i + 2);
        if (!stopWords.has(bg)) bigramSet.add(bg);
      }
    }
    const summaryKeywords = Array.from(bigramSet);
    if (!summaryKeywords.length || text.length === 0) continue;

    const resolutionSignals = ['终于说出', '道出真相', '归还', '交还', '斩杀', '彻底击碎', '解开当年', '原来如此', '真相大白', '履行承诺', '兑现誓言'];

    let matchedSnippet = null;
    let matchedSignalWord = null;

    for (const sig of resolutionSignals) {
      let searchIdx = 0;
      while ((searchIdx = text.indexOf(sig, searchIdx)) !== -1) {
        const winStart = Math.max(0, searchIdx - 100);
        const winEnd = Math.min(text.length, searchIdx + sig.length + 100);
        const windowText = text.slice(winStart, winEnd);

        const matchedInWindow = summaryKeywords.filter(kw => windowText.includes(kw));
        const hasEntityInWindow = targetEntity ? windowText.includes(targetEntity) : true;
        // 至少 2 个具象关键词在紧邻窗口命中（或单短词 summary 全中）且实体吻合
        const hasStrongSubjectMatch = matchedInWindow.length >= 2 || (summaryKeywords.length === 1 && matchedInWindow.length === 1);

        if (hasStrongSubjectMatch && hasEntityInWindow) {
          matchedSnippet = windowText;
          matchedSignalWord = sig;
          break;
        }
        searchIdx += sig.length;
      }
      if (matchedSnippet) break;
    }

    if (matchedSnippet && matchedSignalWord) {
      const record = ledger.payDebt(debt.debt_id, {
        chapterNo,
        chapterId,
        evidence: matchedSnippet,
        notes: `紧邻检测到解决动词【${matchedSignalWord}】与关键标的词汇`,
        operator: 'heuristic_audit'
      });

      eventsRecorded.push(record.event);
      debtsUpdated.push(record.debt);
      processedDebtIds.add(debt.debt_id);
    }
  }

  // 3. 处理显式声明的新增债务 (Declared Debts To Create)
  for (const newDebtInput of declaredDebtsToCreate) {
    const created = ledger.createDebt(newDebtInput, {
      chapterNo,
      chapterId,
      operator: 'reconciliation',
      evidence: newDebtInput.evidence || '',
      notes: newDebtInput.notes || `第 ${chapterNo} 章新增债务`
    });
    debtsCreated.push(created);
  }

  // 4. 从合同或构图规格自动发现新钩子 (Hook Auto-Harvesting)
  const hookToCreate = contract.debtTracking?.debtsToCreate || compositionSpec?.hook?.debtTracking?.debtsToCreate;
  if (Array.isArray(hookToCreate)) {
    for (const item of hookToCreate) {
      const summary = typeof item === 'string' ? item : item.summary;
      if (!summary) continue;

      const created = ledger.createDebt({
        debtType: item.debtType || DEBT_TYPES.HOOK,
        summary,
        created_at_chapter: chapterNo,
        expected_payoff_from: Number(item.expectedPayoffFrom || chapterNo + 1),
        expected_payoff_to: Number(item.expectedPayoffTo || chapterNo + 4),
        priority: item.priority || 'normal',
        creation_evidence: item.evidence || text.slice(-200)
      }, {
        chapterNo,
        chapterId,
        notes: `从第 ${chapterNo} 章末尾自动挂载的新钩子`
      });

      debtsCreated.push(created);
    }
  }

  return Object.freeze({
    chapterNo,
    chapterId,
    reconciledCount: eventsRecorded.length,
    eventsRecorded: Object.freeze(eventsRecorded),
    debtsUpdated: Object.freeze(debtsUpdated),
    debtsCreated: Object.freeze(debtsCreated)
  });
}

module.exports = {
  reconcileChapterDebts
};
