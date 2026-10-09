'use strict';

/**
 * 因果债务与风格健康知识库业务处理函数工厂
 * @param {object} deps - 显式依赖注入表
 * @returns {object} 包含因果债务与文风检测处理函数的工厂实例
 */
function createDebtKnowledgeHandlers(deps) {
  const {
    json,
    readBody,
    respondError,
    queryParamsFromUrl,
    getAuthUser,
    postgresActor,
    postgresRepository,
    getCreationDebtTracker,
    buildDebtPromptInjection,
    extractPotentialDebts,
    detectNovelStyle,
    evaluateChapterHealth
  } = deps;

  function handleStyleDetect(req, res) {
    return readBody(req).then(body => {
      const input = body && typeof body === 'object' ? body : {};
      const text = String(input.text || '');
      const context = input.context && typeof input.context === 'object' ? input.context : {};
      const result = typeof detectNovelStyle === 'function'
        ? detectNovelStyle(text, context)
        : require('../lib/style-detector').detectNovelStyle(text, context);
      return json(res, 200, { ok: true, ...result });
    }).catch(error => respondError(res, error));
  }

  function handleChapterHealthCheck(req, res) {
    return readBody(req).then(body => {
      const input = body && typeof body === 'object' ? body : {};
      const text = String(input.text || '');
      const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {};
      const options = input.options && typeof input.options === 'object' ? input.options : {};
      const health = typeof evaluateChapterHealth === 'function'
        ? evaluateChapterHealth(text, metadata, options)
        : require('../lib/prose-health-evaluator').evaluateChapterHealth(text, metadata, options);
      return json(res, 200, { ok: true, health });
    }).catch(error => respondError(res, error));
  }

  const parseQuery = url => {
    if (typeof queryParamsFromUrl === 'function') {
      try { return queryParamsFromUrl(url); } catch (_) {}
    }
    return Object.fromEntries(new URL(url || '', 'http://localhost').searchParams.entries());
  };

  function handleCausalDebtsGet(req, res, bookId) {
    const tracker = typeof getCreationDebtTracker === 'function' ? getCreationDebtTracker() : deps.creationDebtTracker;
    const q = parseQuery(req.url);
    const chapterNo = Math.max(1, Number(q.chapterNo) || 1);
    const debts = tracker.getDebts(bookId, chapterNo);
    return json(res, 200, { ok: true, bookId, chapterNo, ...debts });
  }

  async function handlePostgresCausalDebtsGet(req, res, bookId) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const q = parseQuery(req.url);
    const chapterNo = Math.max(1, Number(q.chapterNo) || 1);
    const userId = typeof postgresActor === 'function' ? postgresActor(auth) : (auth.user && auth.user.userId);
    const debts = await postgresRepository.getCausalDebts({ userId, bookId, chapterNo });
    const injectionBuilder = typeof buildDebtPromptInjection === 'function'
      ? buildDebtPromptInjection
      : require('../lib/causal-debt-tracker').buildDebtPromptInjection;
    return json(res, 200, {
      ok: true,
      bookId,
      chapterNo,
      block: injectionBuilder(debts.allDebts, chapterNo).slice(0, 1800),
      ...debts
    });
  }

  async function handlePostgresCausalDebtCreate(req, res, bookId) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const body = await readBody(req);
    const userId = typeof postgresActor === 'function' ? postgresActor(auth) : (auth.user && auth.user.userId);
    const debt = await postgresRepository.recordCausalDebt({ ...body, userId, bookId });
    return json(res, 200, { ok: true, bookId, debt: debt.debt });
  }

  async function handlePostgresCausalDebtSettle(req, res, bookId) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const body = await readBody(req);
    const userId = typeof postgresActor === 'function' ? postgresActor(auth) : (auth.user && auth.user.userId);
    const debt = await postgresRepository.settleCausalDebt({ ...body, userId, bookId });
    if (!debt) return json(res, 404, { error: '未找到指定债务或已被平账' });
    return json(res, 200, { ok: true, bookId, debt: debt.debt });
  }

  async function handlePostgresCausalDebtsExtract(req, res, bookId) {
    const input = await readBody(req);
    const chapterNo = Math.max(1, Number(input.chapterNo) || 1);
    const extractor = typeof extractPotentialDebts === 'function'
      ? extractPotentialDebts
      : require('../lib/causal-debt-tracker').extractPotentialDebts;
    const extracted = extractor(String(input.text || ''), chapterNo);
    return json(res, 200, { ok: true, bookId, chapterNo, count: extracted.length, debts: extracted });
  }

  function handleCausalDebtCreate(req, res, bookId) {
    return readBody(req).then(body => {
      const input = body && typeof body === 'object' ? body : {};
      const tracker = typeof getCreationDebtTracker === 'function' ? getCreationDebtTracker() : deps.creationDebtTracker;
      const debt = tracker.recordDebt(bookId, input);
      return json(res, 200, { ok: true, bookId, debt });
    }).catch(error => respondError(res, error));
  }

  function handleCausalDebtSettle(req, res, bookId) {
    return readBody(req).then(body => {
      const input = body && typeof body === 'object' ? body : {};
      const tracker = typeof getCreationDebtTracker === 'function' ? getCreationDebtTracker() : deps.creationDebtTracker;
      const debtId = input.debtId;
      const reason = input.reason || input.settledReason || '已平账';
      const debt = tracker.settleDebt(bookId, debtId, reason);
      if (!debt) return json(res, 404, { error: '未找到指定债务或已被平账' });
      return json(res, 200, { ok: true, bookId, debt });
    }).catch(error => respondError(res, error));
  }

  function handleCausalDebtsExtract(req, res, bookId) {
    return readBody(req).then(body => {
      const input = body && typeof body === 'object' ? body : {};
      const tracker = typeof getCreationDebtTracker === 'function' ? getCreationDebtTracker() : deps.creationDebtTracker;
      const text = String(input.text || '');
      const chapterNo = Math.max(1, Number(input.chapterNo) || 1);
      const extracted = tracker.extractPotentialDebts(text, chapterNo);
      return json(res, 200, { ok: true, bookId, chapterNo, count: extracted.length, debts: extracted });
    }).catch(error => respondError(res, error));
  }

  return {
    // 短名别名 (供 routes/knowledge.js 直接使用)
    styleDetect: handleStyleDetect,
    chapterHealthCheck: handleChapterHealthCheck,
    debtsGet: handleCausalDebtsGet,
    postgresDebtsGet: handlePostgresCausalDebtsGet,
    debtCreate: handleCausalDebtCreate,
    postgresDebtCreate: handlePostgresCausalDebtCreate,
    debtSettle: handleCausalDebtSettle,
    postgresDebtSettle: handlePostgresCausalDebtSettle,
    debtsExtract: handleCausalDebtsExtract,
    postgresDebtsExtract: handlePostgresCausalDebtsExtract,

    // 具名全称
    handleStyleDetect,
    handleChapterHealthCheck,
    handleCausalDebtsGet,
    handlePostgresCausalDebtsGet,
    handlePostgresCausalDebtCreate,
    handlePostgresCausalDebtSettle,
    handlePostgresCausalDebtsExtract,
    handleCausalDebtCreate,
    handleCausalDebtSettle,
    handleCausalDebtsExtract
  };
}

module.exports = {
  createDebtKnowledgeHandlers
};
