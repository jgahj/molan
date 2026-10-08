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
    auditResult = {},
    contract = {},
    compositionSpec = null
  } = params;

  if (!ledger || typeof ledger.recordEvent !== 'function') {
    throw new TypeError('reconcileChapterDebts 需要有效的 StoryDebtLedger 实例');
  }

  const chapterNo = Number(params.chapterNo ?? params.chapterInfo?.chapterNo ?? contract.chapterNo ?? 1) || 1;
  const chapterId = String(params.chapterId ?? params.chapterInfo?.chapterId ?? contract.chapterId ?? '').trim();
  const text = String(params.draftText ?? params.chapterInfo?.draftText ?? '').trim();

  const eventsRecorded = [];
  const debtsUpdated = [];
  const debtsCreated = [];
  const processedDebtIds = new Set();

  // 1. 处理显式声明的结算动作 (Declared Resolutions)
  const rawDeclared = params.declaredResolutions
    || params.chapterInfo?.declaredResolutions
    || params.options?.declaredResolutions
    || contract.declaredResolutions
    || [];
  const declaredResolutions = Array.isArray(rawDeclared) ? rawDeclared : [rawDeclared];

  for (const item of declaredResolutions) {
    const debtId = item.debtId || item.debt_id;
    if (!debtId) continue;
    const existing = ledger.getDebt(debtId);
    if (!existing) continue;

    const action = String(item.action || 'PAID').toUpperCase();

    // 若债务已处于 PAID 终态且声明动作亦为 PAID，视为已结清，幂等跳过以避免抛出状态机拒绝异常
    if (existing.status === DEBT_STATUSES.PAID && action === DEBT_EVENT_TYPES.PAID) {
      processedDebtIds.add(debtId);
      continue;
    }

    let record = null;
    const opts = {
      chapterNo,
      chapterId,
      evidence: item.evidence || '',
      notes: item.notes || `第 ${chapterNo} 章显式结算声明`,
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
    } else if (action === DEBT_EVENT_TYPES.PROPOSED_RESOLUTION) {
      record = ledger.proposeResolution(debtId, opts);
    }

    if (record) {
      eventsRecorded.push(record.event);
      debtsUpdated.push(record.debt);
      processedDebtIds.add(debtId);
    }
  }

  // 2. 处理形式语义验证确权通道 (Formal Semantic Verification)
  const rawSemantic = params.semanticVerification
    || params.options?.semanticVerification
    || params.chapterInfo?.semanticVerification
    || auditResult.semanticVerification
    || auditResult.verifiedResolutions
    || contract.semanticVerification;

  const semanticVerifications = [];
  if (rawSemantic) {
    if (Array.isArray(rawSemantic)) {
      for (const item of rawSemantic) {
        if (typeof item === 'string') {
          semanticVerifications.push({ debtId: item, evidence: '', notes: '形式语义验证确权' });
        } else if (item && typeof item === 'object') {
          const debtId = item.debtId || item.debt_id;
          if (debtId && item.verified !== false) {
            semanticVerifications.push({
              debtId,
              evidence: item.evidence || '',
              notes: item.notes || '形式语义验证确权'
            });
          }
        }
      }
    } else if (typeof rawSemantic === 'object') {
      if (Array.isArray(rawSemantic.verifiedDebts)) {
        for (const debtId of rawSemantic.verifiedDebts) {
          if (debtId) {
            semanticVerifications.push({
              debtId,
              evidence: rawSemantic.evidence || '',
              notes: rawSemantic.notes || '形式语义验证确权'
            });
          }
        }
      } else if (rawSemantic.debtId || rawSemantic.debt_id) {
        const debtId = rawSemantic.debtId || rawSemantic.debt_id;
        if (debtId && rawSemantic.verified !== false) {
          semanticVerifications.push({
            debtId,
            evidence: rawSemantic.evidence || '',
            notes: rawSemantic.notes || '形式语义验证确权'
          });
        }
      }
    }
  }

  for (const item of semanticVerifications) {
    if (processedDebtIds.has(item.debtId)) continue;
    const existing = ledger.getDebt(item.debtId);
    if (!existing) continue;

    // 若债务已处于 PAID 终态，形式语义验证通道视为已确权，幂等跳过
    if (existing.status === DEBT_STATUSES.PAID) {
      processedDebtIds.add(item.debtId);
      continue;
    }

    const record = ledger.payDebt(item.debtId, {
      chapterNo,
      chapterId,
      evidence: item.evidence || '形式语义验证通过',
      notes: item.notes || `第 ${chapterNo} 章形式语义验证确认偿还`,
      operator: 'semantic_verification'
    });

    if (record) {
      eventsRecorded.push(record.event);
      debtsUpdated.push(record.debt);
      processedDebtIds.add(item.debtId);
    }
  }

  // 3. 基于正文引文和关键词的启发式核销检测 (Heuristic Evidence Match -> PROPOSED_RESOLUTION)
  const openDebts = ledger.getOpenDebts();

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
      // 核心门禁：启发式匹配降级为提出提议 (PROPOSED_RESOLUTION)，严禁直接置为 PAID
      const record = ledger.proposeResolution(debt.debt_id, {
        chapterNo,
        chapterId,
        evidence: matchedSnippet,
        notes: `紧邻检测到解决动词【${matchedSignalWord}】与关键标的词汇（候选解决提议，待显式声明或形式语义验证确认）`,
        operator: 'heuristic_audit'
      });

      eventsRecorded.push(record.event);
      debtsUpdated.push(record.debt);
      processedDebtIds.add(debt.debt_id);
    }
  }

  // 4. 处理显式声明的新增债务 (Declared Debts To Create)
  const rawDebtsToCreate = params.declaredDebtsToCreate
    || params.chapterInfo?.declaredDebtsToCreate
    || [];
  const declaredDebtsToCreate = Array.isArray(rawDebtsToCreate) ? rawDebtsToCreate : [rawDebtsToCreate];

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
