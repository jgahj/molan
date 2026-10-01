'use strict';

function createPostgresCreationPlanService(dependencies) {
  const {
  getAuthUser, json, postgresRepository, postgresActor, readBody,
  CREATION_PLAN_BATCH_SIZE, creationPlanCoverage, getUserByEmail,
  resolveCreationModelId, creationSkillForUser, dissectionSkillAuditPayload,
  callMolanChat, creationPlanExpansionPrompt, normalizeCreationExpansionChapter,
  creationChapterNumber, creationChapterIsUsable, mergeCreationExpansionPayload,
  projectScope, creationPlanReviewsInFlight,
  reviewCreationPlan, normalizeCreationPlanReviewModel,
  requestCreationPlanSemanticReview, applyCreationPlanPatches,
  mergeCreationPlanReview,
  creationBibleSeedValidation, creationForbiddenTerms
} = dependencies;

  const POSTGRES_CREATION_WRITE_ROLES = new Set(['owner', 'admin', 'editor']);
  const SETTLED_BILLING_STATUSES = new Set(['exact', 'settled']);

  function providerCreditCost(usage) {
    const cost = usage && usage.creditCost;
    const billingStatus = String(usage && usage.billingStatus || '').toLowerCase();
    if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0 || !SETTLED_BILLING_STATUSES.has(billingStatus)) return null;
    return cost;
  }

  function providerCostUnknown(res) {
    return json(res, 502, { error: '供应商费用未知，已停止本次规划操作', code: 'PROVIDER_COST_UNKNOWN' });
  }
  
  /** 读取 PG 创作书上下文，并在模型调用前完成项目写入/支出权限校验。 */
  async function loadPostgresCreationContext(auth, id, requireSpend = false) {
    const actor = postgresActor(auth);
    const result = await postgresRepository.getCreationBible(actor, id);
    if (!result) return null;
    const access = await postgresRepository.getProjectAccess(actor, result.book.projectId, result.book.workspaceId);
    const visible = access && access.active && POSTGRES_CREATION_WRITE_ROLES.has(String(access.role || ''));
    return {
      actor,
      access,
      forbidden: !visible || (requireSpend && !access.can_spend),
      book: result.book,
      current: result.bible ? {
        bibleId: result.bible.bibleId,
        version: result.bible.version,
        payload: result.bible.payload
      } : null
    };
  }
  
  /** 以 PG Bible revision 保存创作变更，并把可恢复的 CAS/预算错误转为旧接口语义。 */
  async function savePostgresCreationBible(context, payload, additionalCost) {
    if (typeof additionalCost !== 'number' || !Number.isFinite(additionalCost) || additionalCost < 0) {
      throw Object.assign(new Error('供应商费用未知，无法保存创作圣经'), { code: 'PROVIDER_COST_UNKNOWN', statusCode: 502 });
    }
    try {
      return await postgresRepository.putCreationBible({
        userId: context.actor,
        bookId: context.book.id,
        payload,
        expectedRevision: Number(context.current.version),
        additionalCost
      });
    } catch (error) {
      if (String(error && error.code || '') === 'revision_conflict') return { conflict: true };
      if (String(error && error.code || '') === 'budget_exceeded') {
        return {
          budgetExceeded: true,
          budgetLimit: Number(context.book.budgetLimit) || 0,
          spentCost: Number(context.book.spentCost) || 0,
          additionalCost: Math.max(0, Number(additionalCost) || 0)
        };
      }
      throw error;
    }
  }
  
  /** PG 模式下分批扩展资源或章节规划，所有版本写回走 PostgreSQL CAS。 */
  async function handlePostgresCreationBookPlanExpand(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const context = await loadPostgresCreationContext(auth, id, true);
    if (!context) return json(res, 404, { error: '创作书不存在或无权访问' });
    if (context.forbidden) return json(res, 403, { error: '当前账户没有该创作书的生成额度权限', code: 'spend_forbidden' });
    if (!context.current || !context.current.bibleId || !context.current.payload) return json(res, 404, { error: '创作圣经不存在' });
    const body = await readBody(req);
    const current = context.current;
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
    const user = getUserByEmail(auth.user.email) || { email: auth.user.email };
    const modelId = resolveCreationModelId({ modelId: body.modelId || coverage.plan.modelId });
    const selectedSkill = creationSkillForUser(user, coverage.plan.skillId);
    if (coverage.plan.skillId && (!selectedSkill || selectedSkill.complete === false || !String(selectedSkill.instruction || '').trim())) {
      return json(res, 422, { error: '创书 Skill 未完整加载，无法继续扩展规划', code: 'skill_unavailable' });
    }
    const skillAudit = selectedSkill ? dissectionSkillAuditPayload(selectedSkill) : null;
    const usages = [];
    let candidatePayload = null;
    let failureMessage = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let expansion;
      try {
        expansion = await callMolanChat(String(req.headers.authorization || ''), user, {
          thinking: false,
          reasoningEffort: 'none',
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
      return providerCostUnknown(res);
    }
    const callCost = providerCreditCost(expansion && expansion.usage);
    if (callCost === null) return providerCostUnknown(res);
    usages.push(expansion.usage);
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
  const cost = usages.reduce((total, usage) => total + usage.creditCost, 0);
    if (!candidatePayload) {
      const failedPayload = JSON.parse(JSON.stringify(current.payload));
      failedPayload.planningState = {
        ...(failedPayload.planningState && typeof failedPayload.planningState === 'object' ? failedPayload.planningState : {}),
        status: 'failed', phase, completedThrough: coverage.completedThrough, nextChapterNo: coverage.nextChapterNo,
        resourceTargets: coverage.targets, resourceCounts: coverage.counts,
        lastError: failureMessage || '规划扩展失败', updatedAt: Date.now()
      };
      const savedFailure = await savePostgresCreationBible(context, failedPayload, cost);
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
    const saved = await savePostgresCreationBible(context, candidatePayload, cost);
    if (saved.conflict) return json(res, 409, { error: '创作圣经已更新，请重新读取最新版本后继续扩展', code: 'needs_rebase', currentVersion: current.version });
    if (saved.budgetExceeded) return json(res, 402, { error: '本次规划扩展会超过预算上限', code: 'budget_exceeded', budgetLimit: saved.budgetLimit, spentCost: saved.spentCost, additionalCost: saved.additionalCost });
    json(res, 200, {
      ok: true, done: nextCoverage.ready, phase,
      batch: { startChapterNo, endChapterNo, count: phase === 'chapters' ? endChapterNo - startChapterNo + 1 : null },
      progress: nextCoverage,
      bible: { bibleId: current.bibleId, version: saved.bibleVersion, payload: candidatePayload },
      cost
    });
  }
  
  /** PG 模式下审核创作规划，模型审核结果与自动修订均写入 PG Bible 版本。 */
  async function handlePostgresCreationBookPlanReview(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const actorKey = auth.user.userId || projectScope.stableUserId(auth.user.email);
    const key = `${actorKey}:${id}`;
    if (creationPlanReviewsInFlight.has(key)) return json(res, 409, { error: '规划审核仍在进行', code: 'creation_review_pending' });
    creationPlanReviewsInFlight.add(key);
    try {
      const context = await loadPostgresCreationContext(auth, id, true);
      if (!context) return json(res, 404, { error: '新书不存在或无权访问' });
      if (context.forbidden) return json(res, 403, { error: '当前账户没有该创作书的生成额度权限', code: 'spend_forbidden' });
      const body = await readBody(req);
      const current = context.current;
      if (!current || !current.bibleId || !current.payload) return json(res, 404, { error: '创作圣经不存在' });
      const user = getUserByEmail(auth.user.email) || { email: auth.user.email };
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
      const semantic = await requestCreationPlanSemanticReview(String(req.headers.authorization || ''), user, current.payload, modelId, '首次审核');
      semanticReview = semantic.review;
      initialUsage = semantic.usage;
    } catch (error) {
      return providerCostUnknown(res);
    }
    const initialCost = providerCreditCost(initialUsage);
    if (initialCost === null) return providerCostUnknown(res);
      let revisedPayload = current.payload;
      let finalLocalReview = localReview;
      let finalSemanticReview = semanticReview;
      const autoRevise = body.autoRevise === true;
      const revision = { requested: autoRevise, applied: [], rejected: [], changed: false, reviewedAfterRevision: false };
      if (autoRevise && semanticReview.patches.length) {
        const patchResult = applyCreationPlanPatches(current.payload, semanticReview.patches);
        revision.applied = patchResult.applied;
        revision.rejected = patchResult.rejected;
        revision.changed = patchResult.changed;
        if (patchResult.changed) {
          revisedPayload = patchResult.payload;
          finalLocalReview = reviewCreationPlan(revisedPayload);
          revision.reviewedAfterRevision = true;
        try {
          const semantic = await requestCreationPlanSemanticReview(String(req.headers.authorization || ''), user, revisedPayload, modelId, '自动修订后复核');
          finalSemanticReview = semantic.review;
          revisionUsage = semantic.usage;
        } catch (error) {
          return providerCostUnknown(res);
        }
        if (providerCreditCost(revisionUsage) === null) return providerCostUnknown(res);
        }
      }
      const finalReview = mergeCreationPlanReview(localReview, finalSemanticReview, finalLocalReview);
      let storedPayload;
      try { storedPayload = JSON.parse(JSON.stringify(revisedPayload)); } catch (_) { storedPayload = {}; }
      const priorQualityState = storedPayload.qualityState && typeof storedPayload.qualityState === 'object' ? storedPayload.qualityState : {};
      storedPayload.qualityState = {
        ...priorQualityState,
        status: finalReview.status === 'passed' ? 'ready' : 'needs_revision',
        blockingIssues: finalReview.issues.filter(issue => issue.severity === 'blocker').slice(0, 30),
        planReview: {
          status: finalReview.status,
          blockerCount: finalReview.blockerCount,
          warningCount: finalReview.warningCount,
          issueCount: finalReview.issues.length,
          autoRevise,
          appliedPatchCount: revision.applied.length,
          reviewedAt: finalReview.reviewedAt
        }
      };
    const additionalCost = initialCost + (revisionUsage ? providerCreditCost(revisionUsage) : 0);
      storedPayload.qualityState.planReviewResult = { ok: true, baseVersion: Number(current.version), bibleVersion: Number(current.version) + 1, review: finalReview, revision, cost: additionalCost, modelError };
      const saved = await savePostgresCreationBible(context, storedPayload, additionalCost);
      if (saved.conflict) return json(res, 409, { error: '创作圣经已更新，请重新读取后再审核', code: 'needs_rebase', currentVersion: current.version });
      if (saved.budgetExceeded) return json(res, 402, { error: '本次规划审核会超过预算上限', code: 'budget_exceeded', budgetLimit: saved.budgetLimit, spentCost: saved.spentCost, additionalCost: saved.additionalCost });
      revision.summary = revision.changed ? '已应用 ' + revision.applied.length + ' 条白名单修订并完成复核' : autoRevise ? '没有可安全自动应用的白名单修订' : '未启用自动修订';
      return json(res, 200, {
        ok: true, review: finalReview, revision, bibleVersion: saved.bibleVersion,
        payloadHash: saved.payloadHash, cost: additionalCost, modelError,
        bible: { bibleId: current.bibleId, version: saved.bibleVersion, payload: storedPayload }
      });
    } finally {
      creationPlanReviewsInFlight.delete(key);
    }
  }
  
  /** PG 模式下把创作书原子关联到目标小说项目。 */
  async function handlePostgresCreationBookLinkNovel(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const body = await readBody(req);
    const novelId = String(body.novelId || body.projectId || '').trim();
    if (!/^n_[A-Za-z0-9]{1,30}$/.test(novelId)) return json(res, 400, { error: '小说 id 非法' });
    const result = await postgresRepository.linkCreationBook({
      userId: postgresActor(auth),
      bookId: id,
      targetProjectId: novelId,
      targetWorkspaceId: String(body.workspaceId || '').trim()
    });
    json(res, 200, result);
  }
  
  /** PG 模式下定向重生成创作资产，并以 Bible CAS 版本保存。 */
  async function handlePostgresCreationBookRegenerateAsset(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const context = await loadPostgresCreationContext(auth, id, true);
    if (!context) return json(res, 404, { error: '创作书不存在或无权访问' });
    if (context.forbidden) return json(res, 403, { error: '当前账户没有该创作书的生成额度权限', code: 'spend_forbidden' });
    const body = await readBody(req);
    const asset = String(body.asset || '').trim();
    if (!['characters', 'worldRules'].includes(asset)) return json(res, 400, { error: '不支持重生成的资产类型' });
    const current = context.current;
    if (!current || !current.payload) return json(res, 404, { error: '创作圣经不存在' });
    const name = String(body.name || '').trim().slice(0, 60);
    const guidance = String(body.guidance || '').trim().slice(0, 600);
    const user = getUserByEmail(auth.user.email) || { email: auth.user.email };
    let userPrompt = '';
    if (asset === 'characters') {
      if (!name) return json(res, 400, { error: '请指定要重生成的角色名' });
      const existing = (Array.isArray(current.payload.characters) ? current.payload.characters : []).find(item => item && String(item.name || '') === name);
      if (!existing) return json(res, 404, { error: '角色不存在：' + name });
      userPrompt = '只重写创作圣经中人物「' + name + '」的卡片，其余人物与全部世界观资产保持不变。\n当前卡片：' + JSON.stringify(existing) + '\n全书相关上下文（必须保持一致）：' + JSON.stringify({ relationships: (current.payload.relationships || []).slice(0, 30), mainline: current.payload.mainline || {}, goldenFinger: current.payload.goldenFinger || {}, worldRules: (current.payload.worldRules || []).slice(0, 12) }) + (guidance ? '\n作者要求：' + guidance : '') + '\n人物卡必须包含演绎层：voice{samples:[2-3句标志性台词],taboo:绝不会说的话,habit:句式习惯}、tell:[{when,how:外露动作}]、wound:软肋、stance:[{toward,current,evolution}]、emotionStyle:克制型|外放型|转移型。\n输出格式：{"character":{"name","role","goal","conflict","flaw","arc","relationships":["与某人的关系：当前状态"],"voice":{"samples":[],"taboo","habit"},"tell":[{"when","how"}],"wound","stance":[{"toward","current","evolution"}],"emotionStyle"}}';
    } else {
      userPrompt = '只重写创作圣经的“世界规则”数组（代价/副作用/限制/规则，全部原创且互相自洽），其余资产保持不变。\n当前世界规则：' + JSON.stringify((current.payload.worldRules || []).slice(0, 40)) + '\n金手指与世界观背景（必须一致）：' + JSON.stringify({ goldenFinger: current.payload.goldenFinger || {}, worldbuilding: (current.payload.worldbuilding || []).slice(0, 16) }) + (guidance ? '\n作者要求：' + guidance : '') + '\n输出格式：{"worldRules":[{"rule","limit","consequence","scope"}]}';
    }
  let result;
  try {
    result = await callMolanChat(String(req.headers.authorization || ''), user, {
      thinking: false,
      reasoningEffort: 'none',
      system: '你是原创小说创作圣经的资产修订器。只输出合法 JSON，不写正文。必须与已有资产保持一致，禁止引入原书专名或破坏既有因果。',
      userPrompt,
      maxTokens: asset === 'characters' ? 1200 : 2000,
      jsonMode: true,
      modelId: resolveCreationModelId({ modelId: body.modelId }),
      internalModel: true,
      temperature: 0.5,
      stage: 'writing'
    });
  } catch (error) {
    return providerCostUnknown(res);
  }
  const cost = providerCreditCost(result && result.usage);
  if (cost === null) return providerCostUnknown(res);
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
    const seedGate = creationBibleSeedValidation(newPayload, creationForbiddenTerms(newPayload));
    if (!seedGate.ok) return json(res, 422, { error: seedGate.hits.length ? '重生成结果命中原书禁止复制项，请调整要求后重试' : seedGate.nameOverlaps && seedGate.nameOverlaps.length ? '人物姓名共享汉字，请重命名其中之一后重试' : '重生成结果结构不完整，请重试', code: seedGate.hits.length ? 'forbidden_entity_hit' : seedGate.nameOverlaps && seedGate.nameOverlaps.length ? 'character_name_overlap' : 'incomplete_generation', hits: seedGate.hits, missing: seedGate.missing });
  const saved = await savePostgresCreationBible(context, newPayload, cost);
    if (saved.conflict) return json(res, 409, { error: '创作圣经已更新，请刷新后重试', code: 'needs_rebase' });
    if (saved.budgetExceeded) return json(res, 402, { error: '重生成会超过预算上限', code: 'budget_exceeded' });
    json(res, 200, { ok: true, bibleVersion: saved.bibleVersion, asset, name, cost });
  }
  
  return {
    loadPostgresCreationContext,
    savePostgresCreationBible,
    handlePostgresCreationBookPlanExpand,
    handlePostgresCreationBookPlanReview,
    handlePostgresCreationBookLinkNovel,
    handlePostgresCreationBookRegenerateAsset
  };
}

module.exports = { createPostgresCreationPlanService };
