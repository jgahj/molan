'use strict';

/**
 * 创书领域业务处理函数工厂
 * @param {object} deps - 显式依赖注入表
 * @returns {object} 包含创书核心处理函数与状态的工厂实例
 */
function createCreationBookHandlers(deps) {
  const {
    json,
    readBody,
    respondError,
    respondPostgresError,
    requestError,
    getAuthUser,
    getUserByEmail,
    requireSqliteForPublic,
    dbReady,
    POSTGRES_MODE,
    postgresRepository,
    postgresActor,
    projectScope,
    callMolanChat,
    creditCostForUser,
    currentDefaultModel,
    creationCoreJobs,
    sweepCreationCoreJobs,
    persistCreationCoreJob,
    runCreationCoreJob,
    nativeSkillCatalog,
    loadBuiltinSkills,
    loadUserSkills,
    loadGlobalSkills,
    dissectionSkillAuditPayload,
    CREATION_PLAN_BATCH_SIZE = 10
  } = deps;

  const getDb = () => (typeof deps.getDatabase === 'function' ? deps.getDatabase() : deps.db);

  // 依赖安全绑定：支持顶层传入或从服务聚合对象解构
  const loadCreationBookForAuth = deps.loadCreationBookForAuth || (deps.creationBookService && deps.creationBookService.loadCreationBookForAuth);
  const loadCreationBook = deps.loadCreationBook || (deps.creationBookService && deps.creationBookService.loadCreationBook);
  const canSpendCreationBook = deps.canSpendCreationBook || (deps.creationBookService && deps.creationBookService.canSpendCreationBook);
  const loadCurrentBiblePayload = deps.loadCurrentBiblePayload || (deps.creationBookService && deps.creationBookService.loadCurrentBiblePayload) || deps.creationBibleForBook || (deps.creationBookService && deps.creationBookService.creationBibleForBook);
  const creationCoreRunningJobForBook = deps.creationCoreRunningJobForBook || (deps.creationBookService && deps.creationBookService.creationCoreRunningJobForBook);
  const creationBibleForBook = deps.creationBibleForBook || (deps.creationBookService && deps.creationBookService.creationBibleForBook);
  const saveCreationBibleVersion = deps.saveCreationBibleVersion || (deps.creationBookService && deps.creationBookService.saveCreationBibleVersion);
  const insertCreationBookPlaceholder = deps.insertCreationBookPlaceholder || (deps.creationBookService && deps.creationBookService.insertCreationBookPlaceholder);
  const publicCreationBook = deps.publicCreationBook || (deps.creationBookService && deps.creationBookService.publicCreationBook);

  const normalizeCreationPlan = deps.normalizeCreationPlan || (deps.creationPlanService && deps.creationPlanService.normalizeCreationPlan);
  const creationPlanCoverage = deps.creationPlanCoverage || (deps.creationPlanService && deps.creationPlanService.creationPlanCoverage);
  const creationPlanExpansionPrompt = deps.creationPlanExpansionPrompt || (deps.creationPlanService && deps.creationPlanService.creationPlanExpansionPrompt);
  const normalizeCreationExpansionChapter = deps.normalizeCreationExpansionChapter || (deps.creationPlanService && deps.creationPlanService.normalizeCreationExpansionChapter);
  const creationChapterNumber = deps.creationChapterNumber || (deps.creationPlanService && deps.creationPlanService.creationChapterNumber);
  const creationChapterIsUsable = deps.creationChapterIsUsable || (deps.creationPlanService && deps.creationPlanService.creationChapterIsUsable);
  const mergeCreationExpansionPayload = deps.mergeCreationExpansionPayload || (deps.creationPlanService && deps.creationPlanService.mergeCreationExpansionPayload);
  const reviewCreationPlan = deps.reviewCreationPlan || (deps.creationPlanService && deps.creationPlanService.reviewCreationPlan);
  const normalizeCreationPlanReviewModel = deps.normalizeCreationPlanReviewModel || (deps.creationPlanService && deps.creationPlanService.normalizeCreationPlanReviewModel);
  const applyCreationPlanPatches = deps.applyCreationPlanPatches || (deps.creationPlanService && deps.creationPlanService.applyCreationPlanPatches);
  const mergeCreationPlanReview = deps.mergeCreationPlanReview || (deps.creationPlanService && deps.creationPlanService.mergeCreationPlanReview);
  const creationChapterContext = deps.creationChapterContext || (deps.creationPlanService && deps.creationPlanService.creationChapterContext);
  const contractFieldsSubstantive = deps.contractFieldsSubstantive || (deps.creationPlanService && deps.creationPlanService.contractFieldsSubstantive) || (deps.creationContractHelpers && deps.creationContractHelpers.contractFieldsSubstantive);
  const deterministicContractValidation = deps.deterministicContractValidation || (deps.creationPlanService && deps.creationPlanService.deterministicContractValidation);
  const creationBibleSeedValidation = deps.creationBibleSeedValidation || (deps.creationPlanService && deps.creationPlanService.creationBibleSeedValidation);
  const creationForbiddenTerms = deps.creationForbiddenTerms || (deps.creationPlanService && deps.creationPlanService.creationForbiddenTerms);
  const creationPlanProjection = deps.creationPlanProjection || (deps.creationPlanService && deps.creationPlanService.creationPlanProjection);

  const resolveCreationModelId = deps.resolveCreationModelId || (deps.creationContractHelpers && deps.creationContractHelpers.resolveCreationModelId) || (body => (body && body.modelId) || (typeof currentDefaultModel === 'function' ? currentDefaultModel() : 'gpt-5.6-luna'));

  const creationPlanReviewsInFlight = deps.creationPlanReviewsInFlight || new Set();

  function creationReviewUsageCost(user, modelId, usage) {
    const direct = Number(usage && usage.creditCost);
    if (Number.isFinite(direct) && direct >= 0) return direct;
    const tokens = Number(usage && usage.totalTokens);
    if (Number.isFinite(tokens) && tokens >= 0 && typeof creditCostForUser === 'function') {
      try { return creditCostForUser(user, modelId, tokens); } catch (_) {}
    }
    return 0;
  }

  function creationExpansionUsageCost(user, modelId, usages) {
    return (Array.isArray(usages) ? usages : []).reduce((total, usage) => total + creationReviewUsageCost(user, modelId, usage), 0);
  }

  async function creationSkillForUser(user, skillId) {
    if (typeof deps.creationSkillForUser === 'function') {
      return deps.creationSkillForUser(user, skillId);
    }
    const id = String(skillId || '').trim();
    if (!id) return null;
    if (POSTGRES_MODE && typeof nativeSkillCatalog === 'function') {
      const catalog = await nativeSkillCatalog(user);
      return catalog.userSkills.find(skill => skill && skill.id === id)
        || catalog.globalSkills.find(skill => skill && skill.id === id)
        || (typeof loadBuiltinSkills === 'function' ? loadBuiltinSkills().find(skill => skill && skill.id === id) : null)
        || null;
    }
    const email = String(user && user.email || '').trim().toLowerCase();
    return (email && typeof loadUserSkills === 'function' ? loadUserSkills(email) : []).find(skill => skill && skill.id === id)
      || (typeof loadGlobalSkills === 'function' ? loadGlobalSkills().find(skill => skill && skill.id === id) : null)
      || (typeof loadBuiltinSkills === 'function' ? loadBuiltinSkills().find(skill => skill && skill.id === id) : null)
      || null;
  }

  async function requestCreationPlanSemanticReview(authToken, user, payload, modelId, phaseLabel) {
    const projection = typeof creationPlanProjection === 'function' ? creationPlanProjection(payload) : payload;
    const defaultModel = typeof currentDefaultModel === 'function' ? currentDefaultModel() : 'gpt-5.6-luna';
    const output = await callMolanChat(authToken, user, {
      thinking: false, reasoningEffort: 'none',
      system: '你是新书创作规划的多层审核器。输入只包含原创新书的结构规划，原书正文、来源结构和来源专名已经排除。请分别检查 structure、worldbuilding、characters、mainline、conflict、reward、chapter、originality 八层。只返回合法 JSON，不要 Markdown。issues 每项必须包含 layer、code、severity(blocker|warning|info)、message、field、suggestion。只有确定会阻断创作的错误才使用 blocker；信息不足使用 warning。在 reward 与 conflict 层必须额外检查跨批节奏连续性：章纲的 hookType 是否相邻章重复同类、emotionIntensity 是否连续 3 章低于 5、是否存在超过 4 章未兑现主要爽点（payoffGap），违反以 warning 报出并给出调整建议。章节与场景数组为了控制输入长度只展示首尾节选，不能根据节选判断中间条目缺失；章节覆盖必须以 coverage.missingChapterCount、coverage.invalidChapterCount、coverage.duplicateChapterCount 和 planningState.resourceCounts 为准。可以提出有限 patches，但只允许修改 bookPremise、architecture、opening、authorDna、goldenFinger、worldbuilding、worldRules、map、characters、characterLibrary、mainline、storyTree、conflictChain、rewardChain、relationships、volumePlan、arcPlan、chapterPlan、scenePlan、foreshadowLedger、reviewPlan、divergenceMatrix、timeline 这些规划字段，禁止修改 sourceStructure、forbiddenCopy、provenance、权限、版本或其他系统字段。patches 每项格式为 {op:"replace|add",path:"/字段/路径",value:...}。',
      userPrompt: '审核阶段：' + String(phaseLabel || '首次审核') + '\n创作规划（只含新书结构资产）：\n' + JSON.stringify(projection) + '\n\n请返回：{status:"passed|needs_revision|blocked",summary:"",issues:[{layer,code,severity,message,field,suggestion}],patches:[{op,path,value}],layers:[{layer,status,issues:[]}]}。不要复述输入中的原书内容，也不要生成正文。',
      maxTokens: 3200,
      jsonMode: true,
      modelId: modelId || defaultModel,
      internalModel: true,
      temperature: 0.15,
      stage: 'single'
    });
    const review = output.json && typeof output.json === 'object' && !Array.isArray(output.json)
      ? normalizeCreationPlanReviewModel(output.json)
      : normalizeCreationPlanReviewModel({ status: 'unavailable', summary: '模型未返回可解析的规划审核 JSON' });
    return { review, usage: output.usage || null };
  }

  async function handleCreationCoreJobCreate(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (!requireSqliteForPublic(req, res)) return;
    if (!dbReady()) return json(res, 503, { error: '云端存储未启用' });
    let body = {}; try { body = await readBody(req).catch(() => ({})); } catch (_) {}
    const bookId = String(body.creationRequestId || '').trim();
    if (!/^cb_[A-Za-z0-9_]{1,80}$/.test(bookId)) return json(res, 400, { error: '创作书请求 id 非法' });
    const system = String(body.system || '');
    const userPrompt = String(body.userPrompt || '');
    if (!system.trim() || !userPrompt.trim()) return json(res, 400, { error: '创书任务缺少生成提示词' });
    if (system.length + userPrompt.length > 4 * 1024 * 1024) return json(res, 413, { error: '创书提示词过大' });
    const email = auth.user.email;
    const title = String(body.title || '未命名小说').slice(0, 120);
    const genre = String(body.genre || '').slice(0, 120);
    const plan = normalizeCreationPlan({ ...(body.plan || {}), title, genre: body.genre || (body.plan && body.plan.genre) });
    const sourceProfile = body.sourceProfile && typeof body.sourceProfile === 'object' && !Array.isArray(body.sourceProfile) ? body.sourceProfile : {};
    const modelId = String(body.modelId || '').trim();
    const existingBook = loadCreationBookForAuth(bookId, auth, projectScope ? projectScope.WRITE_ROLES : undefined);
    if (existingBook) {
      if (typeof canSpendCreationBook === 'function' && !canSpendCreationBook(existingBook, auth)) {
        return json(res, 403, { error: '当前账户没有该创作书的生成额度权限', code: 'spend_forbidden' });
      }
      const existingBible = loadCurrentBiblePayload(bookId);
      if (existingBible) return json(res, 200, { ok: true, reused: true, status: 'done', bookId, bibleVersion: existingBible.version });
      const running = typeof creationCoreRunningJobForBook === 'function' ? creationCoreRunningJobForBook(bookId, email, auth.user.userId) : null;
      if (running) return json(res, 200, { ok: true, jobId: running.id, status: 'running' });
    }
    if (typeof sweepCreationCoreJobs === 'function') sweepCreationCoreJobs();
    const ownerUserId = String(auth.user.userId || (projectScope && projectScope.stableUserId ? projectScope.stableUserId(email) : email)).trim();
    const workspaceId = projectScope && projectScope.personalWorkspaceId ? projectScope.personalWorkspaceId(ownerUserId) : '';
    const jobId = 'cj_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const job = {
      id: jobId, userEmail: email, userId: ownerUserId, workspaceId, projectId: '', authToken: String(req?.headers?.authorization || ''),
      bookId, title, genre, plan, sourceProfile,
      sourceDissectionId: String(body.sourceDissectionId || '').slice(0, 80),
      modelId, system, userPrompt,
      status: 'running', cancelRequested: false, receivedChars: 0,
      startedAt: Date.now(), updatedAt: Date.now(), error: '', code: '', bibleVersion: 0, creditCost: null
    };
    if (creationCoreJobs) creationCoreJobs.set(jobId, job);
    if (typeof persistCreationCoreJob === 'function') persistCreationCoreJob(job);
    if (!existingBook && typeof insertCreationBookPlaceholder === 'function') {
      const inserted = insertCreationBookPlaceholder(email, { bookId, title, plan, sourceDissectionId: job.sourceDissectionId, ownerUserId, workspaceId });
      if (!inserted.ok) {
        if (creationCoreJobs) creationCoreJobs.delete(jobId);
        return json(res, inserted.code === 'creation_book_conflict' ? 409 : 500, { error: inserted.error || '创书任务创建失败', code: inserted.code || 'core_job_create_failed' });
      }
    }
    job.controller = new AbortController();
    if (typeof runCreationCoreJob === 'function') void runCreationCoreJob(job);
    return json(res, 200, { ok: true, jobId, status: 'running', bookId });
  }

  async function handlePostgresCreationCoreJobCreate(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const body = await readBody(req);
    const bookId = String(body.creationRequestId || body.creationBookId || body.bookId || '').trim();
    if (!/^cb_[A-Za-z0-9_]{1,80}$/.test(bookId)) return json(res, 400, { error: '创作书请求 id 非法' });
    const system = String(body.system || '');
    const userPrompt = String(body.userPrompt || '');
    if (!system.trim() || !userPrompt.trim()) return json(res, 400, { error: '创书任务缺少生成提示词' });
    if (system.length + userPrompt.length > 4 * 1024 * 1024) return json(res, 413, { error: '创书提示词过大' });
    const providerMode = String(body.providerMode || 'platform').trim().toLowerCase();
    if (!['local-stub', 'platform'].includes(providerMode)) {
      return json(res, 422, { error: 'PG 创书供应商模式无效', code: 'provider_mode_invalid' });
    }
    const actorId = typeof postgresActor === 'function' ? postgresActor(auth) : (auth.user && auth.user.userId);
    const title = String(body.title || '未命名小说').trim().slice(0, 120) || '未命名小说';
    const genre = String(body.genre || '').trim().slice(0, 120);
    const plan = normalizeCreationPlan({ ...(body.plan || {}), title, genre: body.genre || (body.plan && body.plan.genre) });
    const requestedProjectId = String(body.novelId || body.projectId || '').trim();
    let workspaceId = String(body.workspaceId || '').trim();
    let projectId = requestedProjectId;
    if (requestedProjectId) {
      const access = await postgresRepository.getProjectAccess(actorId, requestedProjectId, workspaceId);
      if (!access) return json(res, 404, { error: '关联小说不存在或无权写入' });
      if (!projectScope.WRITE_ROLES.has(access.role)) return json(res, 403, { error: '当前账户无权创建创书任务', code: 'forbidden' });
      workspaceId = access.workspace_id;
      projectId = access.project_id;
    } else {
      projectId = `n_creation_${bookId.replace(/[^A-Za-z0-9]/g, '').slice(0, 48)}`;
      workspaceId = workspaceId || (projectScope && projectScope.personalWorkspaceId ? projectScope.personalWorkspaceId(actorId) : '');
    }
    const sourceProfile = body.sourceProfile && typeof body.sourceProfile === 'object' && !Array.isArray(body.sourceProfile)
      ? body.sourceProfile
      : {};
    const jobId = String(body.creationJobId || body.jobId || `cj_${bookId}`).trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(jobId)) return json(res, 422, { error: '创书任务 id 非法', code: 'invalid_job_id' });
    const budgetLimit = Math.max(0, Number(body.budgetLimit || plan.budgetLimit) || 0);
    const budgetAmountMinor = Math.max(0, Math.floor(Number(
      body.budgetReservationMinor ?? body.maxCostMinor ?? (budgetLimit > 0 ? budgetLimit * 100 : 0)
    ) || 0));
    if (providerMode === 'platform' && budgetAmountMinor < 1) {
      return json(res, 409, { error: '真实模型任务必须先设置可验证的预算上限', code: 'budget_required' });
    }
    const budgetPeriodStart = String(body.budgetPeriodStart || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const budgetPeriodEnd = String(body.budgetPeriodEnd || '').slice(0, 10);
    const existing = await postgresRepository.getJob(actorId, jobId);
    if (existing && existing.state === 'provider_unknown') {
      return json(res, 409, { ok: false, status: existing.state, code: 'provider_unknown' });
    }
    if (existing && ['queued', 'claimed', 'running', 'succeeded'].includes(existing.state)) {
      return json(res, 200, { ok: true, reused: true, jobId: existing.id, status: existing.state, bookId });
    }
    const inputPayload = {
      providerMode,
      userId: actorId,
      workspaceLegacyId: workspaceId,
      projectLegacyId: projectId,
      modelId: String(body.modelId || '').trim().slice(0, 120),
      bookId,
      bibleId: String(body.bibleId || `bible_${bookId}`).slice(0, 160),
      title,
      genre,
      plan,
      sourceProfile,
      sourceDissectionId: String(body.sourceDissectionId || '').slice(0, 160),
      system,
      userPrompt
    };
    const job = await postgresRepository.upsertJob({
      userId: actorId,
      workspaceId,
      projectId,
      jobId,
      kind: 'creation-core',
      state: 'queued',
      input: inputPayload,
      inputPayload,
      result: { bookId },
      requireSpend: budgetAmountMinor > 0,
      creationBook: {
        bookId,
        title,
        plan,
        sourceBriefId: String(body.sourceDissectionId || body.sourceBriefId || '').slice(0, 160),
        budgetLimit
      },
      budgetReservation: budgetAmountMinor > 0 ? {
        reservationId: String(body.reservationId || `reservation_${jobId}`),
        amountMinor: budgetAmountMinor,
        limitMinor: Math.max(budgetAmountMinor, Math.floor(Number(body.projectBudgetLimitMinor) || 0)),
        periodStart: budgetPeriodStart,
        periodEnd: budgetPeriodEnd || undefined,
        currency: String(body.currency || 'CREDIT')
      } : null
    });
    return json(res, 202, { ok: true, jobId: job.id, status: job.state, bookId, workspaceId, projectId });
  }

  async function handleCreationBookPlanExpand(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (!requireSqliteForPublic(req, res)) return;
    const book = typeof loadCreationBookForAuth === 'function'
      ? loadCreationBookForAuth(id, auth, projectScope ? projectScope.WRITE_ROLES : undefined)
      : loadCreationBook(id, auth.user.email);
    if (!book) return json(res, 404, { error: '创作书不存在或无权访问' });
    if (typeof canSpendCreationBook === 'function' && !canSpendCreationBook(book, auth)) {
      return json(res, 403, { error: '当前账户没有该创作书的生成额度权限', code: 'spend_forbidden' });
    }
    let body = {}; try { body = await readBody(req).catch(() => ({})); } catch (_) {}
    const current = creationBibleForBook(book.id);
    if (!current || !current.bibleId || !current.payload) return json(res, 404, { error: '创作圣经不存在' });
    const requestedVersion = body.baseBibleVersion;
    if (requestedVersion !== undefined && requestedVersion !== null && requestedVersion !== '' && Number(requestedVersion) !== Number(current.version)) {
      return json(res, 409, { error: '创作圣经已更新，请读取最新版本后继续扩展', code: 'needs_rebase', currentVersion: current.version });
    }
    const coverage = creationPlanCoverage(current.payload);
    if (coverage.ready) {
      return json(res, 200, { ok: true, done: true, phase: 'completed', progress: coverage, bible: { bibleId: current.bibleId, version: current.version, payload: current.payload }, cost: 0 });
    }
    const phase = coverage.resourcesReady ? 'chapters' : 'resources';
    const batchSize = Math.max(8, Math.min(CREATION_PLAN_BATCH_SIZE, Math.floor(Number(body.batchSize) || CREATION_PLAN_BATCH_SIZE)));
    const startChapterNo = phase === 'chapters' ? coverage.nextChapterNo : 0;
    const endChapterNo = phase === 'chapters' ? Math.min(coverage.plan.totalChapters, startChapterNo + batchSize - 1) : 0;
    const user = (getUserByEmail ? getUserByEmail(auth.user.email) : null) || { email: auth.user.email };
    const modelId = resolveCreationModelId({ modelId: body.modelId || coverage.plan.modelId });
    const selectedSkill = await creationSkillForUser(user, coverage.plan.skillId);
    if (coverage.plan.skillId && (!selectedSkill || selectedSkill.complete === false || !String(selectedSkill.instruction || '').trim())) {
      return json(res, 422, { error: '创书 Skill 未完整加载，无法继续扩展规划', code: 'skill_unavailable' });
    }
    const skillAudit = selectedSkill && typeof dissectionSkillAuditPayload === 'function' ? dissectionSkillAuditPayload(selectedSkill) : null;
    const usages = [];
    let candidatePayload = null;
    let failureMessage = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let expansion;
      try {
        expansion = await callMolanChat(String(req?.headers?.authorization || ''), user, {
          thinking: false, reasoningEffort: 'none',
          system: phase === 'resources'
            ? '你是新书创作圣经资源扩展器。只负责补齐原创设定资产，必须返回符合字段的 JSON。第二次尝试时请避免复用已有名称，并严格满足每个缺口数量。'
            : '你是新书长篇章纲扩展器。只负责生成连续、具体、可执行的章节蓝图，必须返回符合字段的 JSON。第二次尝试时请逐项检查章节号和七个核心字段。',
          userPrompt: creationPlanExpansionPrompt(current.payload, phase, startChapterNo, endChapterNo, coverage) + (attempt ? '\n上一次返回未通过结构校验；本次必须重新生成完整且不重复的结果。' : ''),
          maxTokens: phase === 'resources' ? 9000 : 6500,
          jsonMode: true,
          modelId,
          internalModel: true,
          temperature: phase === 'resources' ? 0.35 : 0.3,
          stage: 'writing',
          skillId: selectedSkill ? selectedSkill.id : '',
          skillAudit
        });
      } catch (error) {
        failureMessage = String(error && error.message || error || '规划扩展模型调用失败').slice(0, 300);
        break;
      }
      if (expansion && expansion.usage) usages.push(expansion.usage);
      const generated = expansion && expansion.json && typeof expansion.json === 'object' && !Array.isArray(expansion.json) ? expansion.json : null;
      if (!generated) { failureMessage = '规划扩展模型未返回可解析的 JSON'; continue; }
      if (phase === 'chapters') {
        const rawChapters = Array.isArray(generated.chapters) ? generated.chapters : Array.isArray(generated.chapterPlan) ? generated.chapterPlan : [];
        const normalized = rawChapters.map((item, index) => normalizeCreationExpansionChapter(item, startChapterNo + index));
        const expected = [];
        for (let chapterNo = startChapterNo; chapterNo <= endChapterNo; chapterNo += 1) expected.push(chapterNo);
        const actual = normalized.map(item => creationChapterNumber(item));
        const complete = normalized.length === expected.length
          && new Set(actual).size === expected.length
          && expected.every(chapterNo => actual.includes(chapterNo))
          && normalized.every(item => creationChapterIsUsable(item));
        if (!complete) {
          failureMessage = '第 ' + startChapterNo + ' 至第 ' + endChapterNo + ' 章的章纲数量、章号或核心字段不完整';
          continue;
        }
        candidatePayload = mergeCreationExpansionPayload(current.payload, { chapters: normalized }, phase, coverage.plan.totalChapters);
      } else {
        const nextPayload = mergeCreationExpansionPayload(current.payload, generated, phase, coverage.plan.totalChapters);
        const nextCoverage = creationPlanCoverage(nextPayload);
        const beforeTotal = Object.values(coverage.counts).reduce((sum, value) => sum + Number(value || 0), 0);
        const afterTotal = Object.values(nextCoverage.counts).reduce((sum, value) => sum + Number(value || 0), 0);
        if (afterTotal <= beforeTotal) {
          failureMessage = '本批没有补充新的创作资产，请重新生成';
          continue;
        }
        candidatePayload = nextPayload;
      }
      break;
    }
    const cost = creationExpansionUsageCost(user, modelId, usages);
    if (!candidatePayload) {
      const failedPayload = JSON.parse(JSON.stringify(current.payload));
      failedPayload.planningState = {
        ...(failedPayload.planningState && typeof failedPayload.planningState === 'object' ? failedPayload.planningState : {}),
        status: 'failed', phase, completedThrough: coverage.completedThrough, nextChapterNo: coverage.nextChapterNo,
        resourceTargets: coverage.targets, resourceCounts: coverage.counts,
        lastError: failureMessage || '规划扩展失败', updatedAt: Date.now()
      };
      const savedFailure = saveCreationBibleVersion(book, current, failedPayload, '规划扩展失败记录', auth.user.email, cost);
      if (savedFailure.conflict) return json(res, 409, { error: '创作圣经已更新，请重新读取后继续扩展', code: 'needs_rebase', currentVersion: current.version });
      if (savedFailure.budgetExceeded) return json(res, 402, { error: '本次规划扩展会超过预算上限', code: 'budget_exceeded', budgetLimit: savedFailure.budgetLimit, spentCost: savedFailure.spentCost, additionalCost: savedFailure.additionalCost });
      return json(res, 422, { error: failureMessage || '规划扩展失败，请重试', code: 'plan_batch_invalid', phase, progress: coverage, bibleVersion: savedFailure.bibleVersion, cost });
    }
    const nextCoverage = creationPlanCoverage(candidatePayload);
    candidatePayload.planningState = {
      ...(current.payload.planningState && typeof current.payload.planningState === 'object' ? current.payload.planningState : {}),
      schemaVersion: '1.0', status: nextCoverage.ready ? 'completed' : 'running',
      phase: nextCoverage.resourcesReady ? (nextCoverage.chaptersReady ? 'completed' : 'chapters') : 'resources',
      totalChapters: nextCoverage.plan.totalChapters, volumeCount: nextCoverage.plan.volumeCount,
      batchSize, completedThrough: nextCoverage.completedThrough, nextChapterNo: nextCoverage.nextChapterNo,
      resourceTargets: nextCoverage.targets, resourceCounts: nextCoverage.counts,
      lastBatch: { phase, startChapterNo, endChapterNo, count: phase === 'chapters' ? endChapterNo - startChapterNo + 1 : null, completedAt: Date.now() },
      lastError: null, updatedAt: Date.now()
    };
    const summary = phase === 'chapters' ? '分批补全第 ' + startChapterNo + '-' + endChapterNo + ' 章章纲' : '分批补全创作资源';
    const saved = saveCreationBibleVersion(book, current, candidatePayload, summary, auth.user.email, cost);
    if (saved.conflict) return json(res, 409, { error: '创作圣经已更新，请重新读取最新版本后继续扩展', code: 'needs_rebase', currentVersion: current.version });
    if (saved.budgetExceeded) return json(res, 402, { error: '本次规划扩展会超过预算上限', code: 'budget_exceeded', budgetLimit: saved.budgetLimit, spentCost: saved.spentCost, additionalCost: saved.additionalCost });
    return json(res, 200, {
      ok: true, done: nextCoverage.ready, phase, batch: { startChapterNo, endChapterNo, count: phase === 'chapters' ? endChapterNo - startChapterNo + 1 : null },
      progress: nextCoverage, bible: { bibleId: current.bibleId, version: saved.bibleVersion, payload: candidatePayload }, cost
    });
  }

  async function handleCreationBookLinkNovel(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const book = loadCreationBookForAuth(id, auth, projectScope ? projectScope.WRITE_ROLES : undefined);
    if (!book) return json(res, 404, { error: '创作书不存在或无权访问' });
    let body = {}; try { body = await readBody(req).catch(() => ({})); } catch (_) {}
    const novelId = String(body.novelId || '').trim();
    if (!/^n_[A-Za-z0-9]{1,30}$/.test(novelId)) return json(res, 400, { error: '小说 id 非法' });
    const actorUserId = String(auth.user.userId || (projectScope && projectScope.stableUserId ? projectScope.stableUserId(auth.user.email) : auth.user.email)).trim();
    const db = getDb();
    const access = projectScope ? projectScope.getNovelAccess(db, novelId, actorUserId) : null;
    if (projectScope && !projectScope.canAccess(access, projectScope.WRITE_ROLES)) return json(res, 404, { error: '小说不存在或无权访问' });
    if (db) {
      db.prepare(`UPDATE creation_books
        SET novel_id = ?, workspace_id = ?, project_id = ?, updated_at = ?
        WHERE id = ?`).run(novelId, access ? access.workspace_id : '', access ? access.project_id : '', Date.now(), id);
      const updated = db.prepare('SELECT * FROM creation_books WHERE id = ?').get(id);
      return json(res, 200, { ok: true, book: publicCreationBook(updated || book) });
    }
    return json(res, 200, { ok: true, book: publicCreationBook(book) });
  }

  async function handleCreationBookBiblePut(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const book = loadCreationBookForAuth(id, auth, projectScope ? projectScope.WRITE_ROLES : undefined);
    if (!book) return json(res, 404, { error: '新书不存在或无权访问' });
    let body = {}; try { body = await readBody(req).catch(() => ({})); } catch (_) {}
    const payload = body.bible && typeof body.bible === 'object' ? body.bible : {};
    const changeSummary = String(body.changeSummary || '用户修订').slice(0, 200);
    const current = loadCurrentBiblePayload(book.id);
    if (!current) return json(res, 404, { error: '创作圣经不存在' });
    const saved = saveCreationBibleVersion(book, current, payload, changeSummary, auth.user.email, 0);
    if (saved.conflict) return json(res, 409, { error: '创作圣经已更新，请基于最新版本重新合并', code: 'needs_rebase', currentVersion: current.version });
    if (saved.budgetExceeded) return json(res, 402, { error: '本次创作圣经保存会超过预算上限', code: 'budget_exceeded', budgetLimit: saved.budgetLimit, spentCost: saved.spentCost, additionalCost: saved.additionalCost });
    return json(res, 200, { ok: true, bibleVersion: saved.bibleVersion, payloadHash: saved.payloadHash });
  }

  async function handleCreationBookPlanReview(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const actorKey = auth.user.userId || (projectScope && projectScope.stableUserId
      ? projectScope.stableUserId(auth.user.email)
      : auth.user.email);
    const key = `${actorKey}:${id}`;
    if (creationPlanReviewsInFlight.has(key)) return json(res, 409, { error: '规划审核仍在进行', code: 'creation_review_pending' });
    creationPlanReviewsInFlight.add(key);
    try {
      return await runCreationBookPlanReview(req, res, id);
    } finally {
      creationPlanReviewsInFlight.delete(key);
    }
  }

  async function runCreationBookPlanReview(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const book = typeof loadCreationBookForAuth === 'function'
      ? loadCreationBookForAuth(id, auth, projectScope ? projectScope.WRITE_ROLES : undefined)
      : loadCreationBook(id, auth.user.email);
    if (!book) return json(res, 404, { error: '新书不存在或无权访问' });
    if (typeof canSpendCreationBook === 'function' && !canSpendCreationBook(book, auth)) {
      return json(res, 403, { error: '当前账户没有该创作书的生成额度权限', code: 'spend_forbidden' });
    }
    let body = {};
    try { body = await readBody(req).catch(() => ({})); } catch (_) {}
    const current = creationBibleForBook(book.id);
    if (!current || !current.bibleId || !current.payload) return json(res, 404, { error: '创作圣经不存在' });
    const user = (getUserByEmail ? getUserByEmail(auth.user.email) : null) || { email: auth.user.email };
    const modelId = resolveCreationModelId(body);
    const localReview = reviewCreationPlan(current.payload);
    const baseVersion = Number(body.baseVersion) || 0;
    const storedResult = current.payload.qualityState && current.payload.qualityState.planReviewResult;
    if (baseVersion > 0 && storedResult && storedResult.baseVersion === baseVersion && storedResult.bibleVersion === Number(current.version)) {
      return json(res, 200, { ...storedResult, reused: true, bible: { bibleId: current.bibleId, version: current.version, payload: current.payload } });
    }
    if (baseVersion > 0 && baseVersion !== Number(current.version)) return json(res, 409, { error: '创作圣经已更新，请从最新断点继续', code: 'needs_rebase' });
    let semanticReview = normalizeCreationPlanReviewModel({ status: 'unavailable', summary: '语义审核尚未完成' });
    let initialUsage = null;
    let revisionUsage = null;
    let modelError = '';
    try {
      const semantic = await requestCreationPlanSemanticReview(String(req?.headers?.authorization || ''), user, current.payload, modelId, '首次审核');
      semanticReview = semantic.review;
      initialUsage = semantic.usage;
    } catch (error) {
      modelError = String(error && error.message || error || '模型审核失败').slice(0, 300);
      semanticReview = normalizeCreationPlanReviewModel({ status: 'unavailable', summary: '语义审核失败，请稍后重试' });
    }

    let revisedPayload = current.payload;
    let finalLocalReview = localReview;
    let finalSemanticReview = semanticReview;
    const autoRevise = body.autoRevise === true;
    const revision = { requested: autoRevise, applied: [], rejected: [], changed: false, reviewedAfterRevision: false };
    if (autoRevise && semanticReview.patches && semanticReview.patches.length) {
      const patchResult = applyCreationPlanPatches(current.payload, semanticReview.patches);
      revision.applied = patchResult.applied;
      revision.rejected = patchResult.rejected;
      revision.changed = patchResult.changed;
      if (patchResult.changed) {
        revisedPayload = patchResult.payload;
        finalLocalReview = reviewCreationPlan(revisedPayload);
        revision.reviewedAfterRevision = true;
        try {
          const semantic = await requestCreationPlanSemanticReview(String(req?.headers?.authorization || ''), user, revisedPayload, modelId, '自动修订后复核');
          finalSemanticReview = semantic.review;
          revisionUsage = semantic.usage;
        } catch (error) {
          modelError = modelError || String(error && error.message || error || '修订后复核失败').slice(0, 300);
          finalSemanticReview = normalizeCreationPlanReviewModel({ status: 'unavailable', summary: '自动修订已完成，但修订后语义复核失败' });
        }
      }
    }

    const finalReview = mergeCreationPlanReview(localReview, finalSemanticReview, finalLocalReview);
    let storedPayload;
    try { storedPayload = JSON.parse(JSON.stringify(revisedPayload)); } catch (_) { storedPayload = { ...revisedPayload }; }
    storedPayload.qualityState = {
      ...(storedPayload.qualityState && typeof storedPayload.qualityState === 'object' ? storedPayload.qualityState : {}),
      planReviewStatus: finalReview.status,
      planReviewSummary: finalReview.summary,
      planReviewIssues: finalReview.issues,
      planReviewResult: {
        baseVersion: Number(current.version),
        bibleVersion: Number(current.version) + 1,
        review: finalReview,
        revision,
        cost: 0,
        modelError,
        reviewedAt: Date.now()
      },
      updatedAt: Date.now()
    };
    const additionalCost = creationReviewUsageCost(user, modelId, initialUsage) + (revisionUsage ? creationReviewUsageCost(user, modelId, revisionUsage) : 0);
    storedPayload.qualityState.planReviewResult.cost = additionalCost;
    const changeSummary = revision.changed ? '规划审核并自动应用白名单修订' : '规划审核记录';
    const saved = saveCreationBibleVersion(book, current, storedPayload, changeSummary, auth.user.email, additionalCost);
    if (saved.conflict) return json(res, 409, { error: '创作圣经已更新，请重新读取后再审核', code: 'needs_rebase', currentVersion: current.version });
    if (saved.budgetExceeded) return json(res, 402, { error: '本次规划审核会超过预算上限', code: 'budget_exceeded', budgetLimit: saved.budgetLimit, spentCost: saved.spentCost, additionalCost: saved.additionalCost });
    revision.summary = revision.changed ? '已应用 ' + revision.applied.length + ' 条白名单修订并完成复核' : autoRevise ? '没有可安全自动应用的白名单修订' : '未启用自动修订';
    return json(res, 200, {
      ok: true,
      review: finalReview,
      revision,
      bibleVersion: saved.bibleVersion,
      payloadHash: saved.payloadHash,
      cost: additionalCost,
      modelError,
      bible: { bibleId: current.bibleId, version: saved.bibleVersion, payload: storedPayload }
    });
  }

  async function handleCreationBookChapterContract(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const book = loadCreationBookForAuth(id, auth, projectScope ? projectScope.WRITE_ROLES : undefined);
    if (!book) return json(res, 404, { error: '创作书不存在或无权访问' });
    if (typeof canSpendCreationBook === 'function' && !canSpendCreationBook(book, auth)) {
      return json(res, 403, { error: '当前账户没有该创作书的生成额度权限', code: 'spend_forbidden' });
    }
    let body = {}; try { body = await readBody(req).catch(() => ({})); } catch (_) {}
    const current = creationBibleForBook(book.id);
    const chapterNo = Math.max(1, Number(body.chapterNo) || Number(book.current_chapter_no || 0) + 1);
    const context = creationChapterContext(current.payload, chapterNo);
    const previousEnding = String(body.previousEnding || '').slice(-2400);
    const user = (getUserByEmail ? getUserByEmail(auth.user.email) : null) || { email: auth.user.email };
    const creationModelId = resolveCreationModelId(body);
    const contractOutput = await callMolanChat(String(req?.headers?.authorization || ''), user, {
      thinking: false, reasoningEffort: 'none',
      system: '你是原创长篇小说章节合同策划器。只使用新书创作圣经，不得引用来源原文、来源人物或来源专属事件。只返回 JSON。字段必须包含 chapterNo,goal,protagonistAction,opposition,informationChange,escalation,irreversibleResult,characterStateChanges,foreshadowActions,continuityInputs,continuityOutputs,mustAvoid。主线优先于副线，副线只能服务主线。',
      userPrompt: '新书创作圣经上下文：\n' + JSON.stringify(context) + '\n上一章结尾：\n' + previousEnding + '\n用户本章要求：\n' + String(body.prompt || '').slice(0, 600) + '\n请生成第 ' + chapterNo + ' 章合同。',
      maxTokens: 2400, jsonMode: true, modelId: creationModelId, internalModel: true, temperature: 0.35, stage: 'writing', disableTimeout: true
    });
    const contract = contractOutput.json;
    if (!contract || !contract.goal) return json(res, 200, { ok: false, error: '章节合同生成失败，请重试' });
    const firstCheck = typeof contractFieldsSubstantive === 'function' ? contractFieldsSubstantive(contract) : { ok: true };
    if (!firstCheck.ok) {
      const retryOutput = await callMolanChat(String(req?.headers?.authorization || ''), user, {
        thinking: false, reasoningEffort: 'none',
        system: '你是原创长篇小说章节合同策划器。只使用新书创作圣经，不得引用来源原文、来源人物或来源专属事件。只返回 JSON。字段必须包含 chapterNo,goal,protagonistAction,opposition,informationChange,escalation,irreversibleResult,characterStateChanges,foreshadowActions,continuityInputs,continuityOutputs,mustAvoid。合同字段必须包含具体人物名、具体行动和具体后果，禁止空泛表述。',
        userPrompt: '新书创作圣经上下文：\n' + JSON.stringify(context) + '\n上一章结尾：\n' + previousEnding + '\n用户本章要求：\n' + String(body.prompt || '').slice(0, 600) + '\n请生成第 ' + chapterNo + ' 章合同。',
        maxTokens: 2400, jsonMode: true, modelId: creationModelId, internalModel: true, temperature: 0.35, stage: 'writing', disableTimeout: true
      });
      const retryContract = retryOutput.json;
      if (retryContract && retryContract.goal && (typeof contractFieldsSubstantive !== 'function' || contractFieldsSubstantive(retryContract).ok)) {
        const normalized = { ...retryContract, chapterNo, source: 'creation-bible', bibleVersion: current.version };
        return json(res, 200, { ok: true, contract: normalized, validation: deterministicContractValidation(normalized), usage: retryOutput.usage || null, retried: true });
      }
      return json(res, 422, { ok: false, error: '章节合同自校验未通过（' + firstCheck.field + '：' + firstCheck.reason + '），已重试仍不合格', validation: deterministicContractValidation(contract || {}) });
    }
    const normalized = { ...contract, chapterNo, source: 'creation-bible', bibleVersion: current.version };
    return json(res, 200, { ok: true, contract: normalized, validation: deterministicContractValidation(normalized), usage: contractOutput.usage || null });
  }

  async function handleCreationBookRegenerateAsset(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (typeof dbReady === 'function' && !dbReady()) return json(res, 503, { error: '云端存储未启用' });
    const book = loadCreationBookForAuth(id, auth, projectScope ? projectScope.WRITE_ROLES : undefined);
    if (!book) return json(res, 404, { error: '创作书不存在或无权访问' });
    if (typeof canSpendCreationBook === 'function' && !canSpendCreationBook(book, auth)) {
      return json(res, 403, { error: '当前账户没有该创作书的生成额度权限', code: 'spend_forbidden' });
    }
    let body = {}; try { body = await readBody(req).catch(() => ({})); } catch (_) {}
    const asset = String(body.asset || '').trim();
    if (!['characters', 'worldRules'].includes(asset)) return json(res, 400, { error: '不支持重生成的资产类型' });
    const current = loadCurrentBiblePayload(book.id);
    if (!current || !current.payload) return json(res, 404, { error: '创作圣经不存在' });
    const name = String(body.name || '').trim().slice(0, 60);
    const guidance = String(body.guidance || '').trim().slice(0, 600);
    const user = (getUserByEmail ? getUserByEmail(auth.user.email) : null) || { email: auth.user.email };
    let userPrompt = '';
    if (asset === 'characters') {
      if (!name) return json(res, 400, { error: '请指定要重生成的角色名' });
      const existing = (Array.isArray(current.payload.characters) ? current.payload.characters : []).find(item => item && String(item.name || '') === name);
      if (!existing) return json(res, 404, { error: '角色不存在：' + name });
      userPrompt = '只重写创作圣经中人物「' + name + '」的卡片，其余人物与全部世界观资产保持不变。\n当前卡片：' + JSON.stringify(existing) + '\n全书相关上下文（必须保持一致）：' + JSON.stringify({ relationships: (current.payload.relationships || []).slice(0, 30), mainline: current.payload.mainline || {}, goldenFinger: current.payload.goldenFinger || {}, worldRules: (current.payload.worldRules || []).slice(0, 12) }) + (guidance ? '\n作者要求：' + guidance : '') + '\n人物卡必须包含演绎层：voice{samples:[2-3句标志性台词],taboo:绝不会说的话,habit:句式习惯}、tell:[{when,how:外露动作}]、wound:软肋、stance:[{toward,current,evolution}]、emotionStyle:克制型|外放型|转移型。\n输出格式：{"character":{"name","role","goal","conflict","flaw","arc","relationships":["与某人的关系：当前状态"],"voice":{"samples":[],"taboo","habit"},"tell":[{"when","how"}],"wound","stance":[{"toward","current","evolution"}],"emotionStyle"}}';
    } else {
      userPrompt = '只重写创作圣经的“世界规则”数组（代价/副作用/限制/规则，全部原创且互相自洽），其余资产保持不变。\n当前世界规则：' + JSON.stringify((current.payload.worldRules || []).slice(0, 40)) + '\n金手指与世界观背景（必须一致）：' + JSON.stringify({ goldenFinger: current.payload.goldenFinger || {}, worldbuilding: (current.payload.worldbuilding || []).slice(0, 16) }) + (guidance ? '\n作者要求：' + guidance : '') + '\n输出格式：{"worldRules":[{"rule","limit","consequence","scope"}]}';
    }
    const result = await callMolanChat(String(req?.headers?.authorization || ''), user, {
      thinking: false, reasoningEffort: 'none',
      system: '你是原创小说创作圣经的资产修订器。只输出合法 JSON，不写正文。必须与已有资产保持一致，禁止引入原书专名或破坏既有因果。',
      userPrompt,
      maxTokens: asset === 'characters' ? 1200 : 2000,
      jsonMode: true,
      modelId: resolveCreationModelId({ modelId: body.modelId }),
      internalModel: true,
      temperature: 0.5,
      stage: 'writing'
    }).catch(error => { respondError(res, error, 502); return null; });
    if (!result) return;
    const patch = result.json;
    const newPayload = JSON.parse(JSON.stringify(current.payload));
    if (asset === 'characters') {
      const card = patch && patch.character;
      if (!card || !String(card.name || '').trim()) return json(res, 502, { error: '重生成未返回有效人物卡，请重试' });
      const list = Array.isArray(newPayload.characters) ? newPayload.characters : [];
      const index = list.findIndex(item => item && String(item.name || '') === name);
      if (index >= 0) list[index] = card; else list.push(card);
      newPayload.characters = list;
    } else {
      if (!patch || !Array.isArray(patch.worldRules) || !patch.worldRules.length) return json(res, 502, { error: '重生成未返回有效世界规则，请重试' });
      newPayload.worldRules = patch.worldRules.slice(0, 60).map(item => ({ rule: String(item && item.rule || '').slice(0, 200), limit: String(item && item.limit || '').slice(0, 200), consequence: String(item && item.consequence || '').slice(0, 200), scope: String(item && item.scope || '').slice(0, 120) }));
    }
    const seedGate = typeof creationBibleSeedValidation === 'function' ? creationBibleSeedValidation(newPayload, typeof creationForbiddenTerms === 'function' ? creationForbiddenTerms(newPayload) : []) : { ok: true };
    if (!seedGate.ok) return json(res, 422, { error: seedGate.hits && seedGate.hits.length ? '重生成结果命中原书禁止复制项，请调整要求后重试' : seedGate.nameOverlaps && seedGate.nameOverlaps.length ? '人物姓名共享汉字，请重命名其中之一后重试' : '重生成结果结构不完整，请重试', code: seedGate.hits && seedGate.hits.length ? 'forbidden_entity_hit' : seedGate.nameOverlaps && seedGate.nameOverlaps.length ? 'character_name_overlap' : 'incomplete_generation', hits: seedGate.hits, missing: seedGate.missing });
    const cost = Math.max(0, Number(result.usage && result.usage.creditCost) || 0);
    const saved = saveCreationBibleVersion(book, current, newPayload, '重生成资产：' + asset + (name ? '·' + name : ''), auth.user.email, cost);
    if (saved.conflict) return json(res, 409, { error: '创作圣经已更新，请刷新后重试', code: 'needs_rebase' });
    if (saved.budgetExceeded) return json(res, 402, { error: '重生成会超过预算上限', code: 'budget_exceeded' });
    return json(res, 200, { ok: true, bibleVersion: saved.bibleVersion, asset, name });
  }

  return {
    // 动作短名别名
    coreJobCreate: handleCreationCoreJobCreate,
    postgresCoreJobCreate: handlePostgresCreationCoreJobCreate,
    planExpand: handleCreationBookPlanExpand,
    linkNovel: handleCreationBookLinkNovel,
    biblePut: handleCreationBookBiblePut,
    planReview: handleCreationBookPlanReview,
    runCreationBookPlanReview,
    chapterContract: handleCreationBookChapterContract,
    regenerateAsset: handleCreationBookRegenerateAsset,
    creationPlanReviewsInFlight,

    // 完整具名函数
    handleCreationCoreJobCreate,
    handlePostgresCreationCoreJobCreate,
    handleCreationBookPlanExpand,
    handleCreationBookLinkNovel,
    handleCreationBookBiblePut,
    handleCreationBookPlanReview,
    runCreationBookPlanReview,
    handleCreationBookChapterContract,
    handleCreationBookRegenerateAsset,
    resolveCreationModelId
  };
}

module.exports = { createCreationBookHandlers };
