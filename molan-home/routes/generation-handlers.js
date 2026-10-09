'use strict';

/**
 * 正文生成、模型目录、计量充值与健康检查业务处理函数工厂
 * @param {object} deps - 显式依赖注入表
 * @returns {object} 包含生成领域核心处理函数的工厂实例
 */
function createGenerationHandlers(deps) {
  const {
    json,
    readBody,
    respondError,
    respondPostgresError,
    requestError,
    getAuthUser,
    isAdminUser,
    normalizeUserRole,
    canChooseModel,
    currentDefaultModel,
    PLATFORM_MODELS = [],
    loadPlatformModels,
    reasoningEffortsForModel,
    contextWindowTokensForModel,
    estimateBillingForUser,
    PUBLIC_MODE,
    POSTGRES_MODE,
    postgresRepository,
    projectScope,
    postgresRuntimeUserFromRow,
    appRepository,
    dbReady,
    getDatabase,
    getUserByEmail,
    publicUser,
    chatAdmission,
    postgresHealth,
    DEEPSEEK_KEY,
    chatHandler,
    benchmarkHandler,
    generationRunsHandler,
    generationRunErrorHandler,
    legacyGenerationChatHandler
  } = deps;

  const LOCAL_TOPUP_CREDITS = new Set([1000, 8000, 30000]);
  let healthCache = null;
  let healthCacheAt = 0;

  function handleChat(req, res, legacyGenerationHandoff = null) {
    if (typeof chatHandler === 'function') {
      return chatHandler(req, res, legacyGenerationHandoff);
    }
    return json(res, 503, { error: '对话服务未就绪' });
  }

  function handleModels(req, res) {
    const auth = getAuthUser(req);
    const role = auth ? (typeof normalizeUserRole === 'function' ? normalizeUserRole(auth.user) : 'user') : 'guest';
    const defaultModel = typeof currentDefaultModel === 'function' ? currentDefaultModel() : 'gpt-5.6-luna';
    const allowed = typeof canChooseModel === 'function' ? canChooseModel(auth && auth.user) : true;
    const modelsList = PLATFORM_MODELS.length ? PLATFORM_MODELS : (typeof loadPlatformModels === 'function' ? loadPlatformModels() : []);
    const safe = modelsList.map(m => ({
      id: m.id,
      name: m.name,
      group: m.group,
      provider: m.provider,
      model: m.model,
      supportsThinking: m.supportsThinking,
      supportsReasoning: m.supportsReasoning,
      reasoningEfforts: typeof reasoningEffortsForModel === 'function' ? reasoningEffortsForModel(m) : ['low', 'medium', 'high'],
      promptCaching: !!m.promptCaching,
      contextWindowTokens: typeof contextWindowTokensForModel === 'function' ? contextWindowTokensForModel(m) : 128000
    }));
    return json(res, 200, {
      ok: true,
      models: safe,
      access: { role, canChooseModel: allowed, defaultModel }
    });
  }

  function handleBillingEstimate(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录后查看积分预估' });
    return readBody(req, 64 * 1024).then(body => {
      const estimate = typeof estimateBillingForUser === 'function'
        ? estimateBillingForUser(auth.user, body)
        : { tokens: 1000, credits: 1 };
      return json(res, 200, { ok: true, ...estimate });
    }).catch(error => respondError(res, error));
  }

  function handleBillingTopup(req, res) {
    if (PUBLIC_MODE) return json(res, 410, { error: '充值功能暂未开放，请使用已验证的支付订单' });
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录后增加本地测试额度' });
    if (typeof isAdminUser === 'function' && isAdminUser(auth.user)) {
      return json(res, 409, { error: '管理员账户不需要充值积分' });
    }
    return readBody(req, 64 * 1024).then(async body => {
      const credits = Number(body && body.credits);
      if (!LOCAL_TOPUP_CREDITS.has(credits)) {
        throw (typeof requestError === 'function' ? requestError(400, '只支持 1000、8000 或 30000 积分档位') : new Error('只支持 1000、8000 或 30000 积分档位'));
      }
      const email = String(auth.user.email || '').trim().toLowerCase();
      let user;
      if (POSTGRES_MODE) {
        const userId = String(auth.user.userId || (projectScope && projectScope.stableUserId ? projectScope.stableUserId(email) : email));
        const row = await postgresRepository.runtimeAdjustCredits({
          actorUserId: userId, userId, delta: credits, spentDelta: 0
        });
        user = typeof postgresRuntimeUserFromRow === 'function' ? postgresRuntimeUserFromRow(row) : row;
      } else if (process.env.MOLAN_APP_STORE === 'json' && typeof appRepository === 'function') {
        user = await appRepository().adjustCredits({ userId: auth.user.userId, delta: credits });
      } else if (typeof dbReady === 'function' && dbReady()) {
        const db = typeof getDatabase === 'function' ? getDatabase() : deps.db;
        db.prepare('UPDATE accounts SET credits = credits + ? WHERE email = ? AND role <> \'admin\'').run(credits, email);
        user = typeof getUserByEmail === 'function' ? getUserByEmail(email) : null;
      } else {
        user = auth.user;
        user.credits = Math.round(((Number(user.credits) || 0) + credits) * 100) / 100;
        if (typeof deps.saveUser === 'function') deps.saveUser(user);
      }
      const pubUser = !POSTGRES_MODE && process.env.MOLAN_APP_STORE === 'json' && typeof deps.nativePublicUser === 'function'
        ? await deps.nativePublicUser(user)
        : (typeof publicUser === 'function' ? await publicUser(user) : user);
      return json(res, 200, { ok: true, creditsAdded: credits, user: pubUser, credits: user ? user.credits : 0 });
    }).catch(error => respondError(res, error));
  }

  async function handleHealth(req, res) {
    const auth = getAuthUser(req);
    const activeStreams = chatAdmission && typeof chatAdmission.activeCount === 'function' ? chatAdmission.activeCount() : 0;
    const runtime = { uptime: Math.round(process.uptime()), pid: process.pid, activeChatStreams: activeStreams };
    if (!auth && healthCache && Date.now() - healthCacheAt < 5000) return json(res, 200, { ...healthCache, ...runtime });
    let dbOk = false;
    let novelCount = 0;
    const isUserAdmin = auth && typeof isAdminUser === 'function' && isAdminUser(auth.user);
    if (POSTGRES_MODE) {
      dbOk = postgresHealth && postgresHealth.available === true;
      if (dbOk && isUserAdmin) {
        try {
          novelCount = (await postgresRepository.runtimeAdminDataRows(auth.user.userId, 'novels')).length;
        } catch (error) {
          return respondPostgresError(res, error);
        }
      }
    } else if (typeof dbReady === 'function' && dbReady()) {
      try {
        const db = typeof getDatabase === 'function' ? getDatabase() : deps.db;
        dbOk = true;
        novelCount = db.prepare('SELECT COUNT(*) AS n FROM novels').get().n;
      } catch (_) {}
    }
    const health = {
      ok: true,
      db: dbOk ? 'ready' : 'off',
      postgres: postgresHealth || { available: false },
      models: PLATFORM_MODELS.length
    };
    if (isUserAdmin) {
      Object.assign(health, { key: DEEPSEEK_KEY ? 'set' : 'missing', novels: novelCount });
    } else {
      healthCache = health;
      healthCacheAt = Date.now();
    }
    return json(res, 200, { ...(isUserAdmin ? health : healthCache), ...runtime });
  }

  function handleWebChat(req, res) {
    return json(res, 410, { error: '网页版 AI 已关闭，所有 AI 请求统一使用平台模型并按 Token 计费' });
  }

  function handleWebChatStatus(req, res) {
    return json(res, 200, { available: false, busy: false });
  }

  return {
    // 动作短名别名 (供 routes/generation.js 使用)
    chat: handleChat,
    models: handleModels,
    billingEstimate: handleBillingEstimate,
    billingTopup: handleBillingTopup,
    health: handleHealth,
    webChat: handleWebChat,
    webChatStatus: handleWebChatStatus,
    benchmark: benchmarkHandler,
    generationRuns: generationRunsHandler,
    generationRunError: generationRunErrorHandler,
    legacyGenerationChat: legacyGenerationChatHandler,

    // 具名全称
    handleChat,
    handleModels,
    handleBillingEstimate,
    handleBillingTopup,
    handleHealth,
    handleWebChat,
    handleWebChatStatus
  };
}

module.exports = {
  createGenerationHandlers
};
