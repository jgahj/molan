const crypto = require('node:crypto');
const { createChatStreamRuntime } = require('./chat-stream-runtime');
const { sanitizeUserPrompt } = require('../lib/ip-continuation-adapter');

function resolveUpstreamModelForReasoning(pm, eff) {
  const isGemini = pm && (pm.group === 'gemini' || /gemini/i.test(String(pm.model || pm.id)));
  if (!isGemini) return (pm && (pm.model || pm.id)) || '';
  const base = String(pm.model || pm.id || '').replace(/-(low|medium|high)$/i, '');
  const effort = String(eff || 'medium').toLowerCase();
  if (effort === 'low') return `${base}-low`;
  if (effort === 'high') return `${base}-high`;
  if (effort === 'medium') {
    if (/gemini-3\.1-pro/i.test(base)) return `${base}-high`;
    return `${base}-medium`;
  }
  return `${base}-high`;
}

function createChatService({
  getDatabase,
  getEnvironment,
  getDeepseekKey,
  getDeepseekUrl,
  getProxyUrl,
  POSTGRES_MODE,
  postgresRepository,
  postgresActor,
  getAuthUser,
  requireSqliteForPublic,
  allowChatRate,
  acquireChatSlot,
  releaseChatSlot,
  json,
  readBody,
  respondError,
  CHAT_MAX_JSON_BODY_BYTES,
  nativeSkillCatalog,
  appRepository,
  projectScope,
  isAdminUser,
  INTERNAL_MODEL_ROUTE_KEY,
  INTERNAL_MODEL_ROUTE_HEADER,
  generationV2Enabled,
  validateChatMessages,
  splitDynamicPrompt,
  detectNovelStyle,
  adaptIpContinuationMessages,
  DEFAULT_WRITING_SKILL_ID,
  loadEditorOnlyWritingSkill,
  ensureEditorOnlyWritingSkill,
  editorOnlySkillAuditRequest,
  ensureDefaultWritingSkill,
  addDefaultWritingSkillAudit,
  buildSkillAudit,
  prepareSkillMessagesForUpstream,
  correctionPolicyEnabled,
  isTwoPassHumanizeEnabled,
  loadEditorOnlyCorrectionLibrary,
  CORRECTION_PRIOR_TEXT_MAX_CHARS,
  lastUserMessageText,
  injectEditorOnlyCorrectionLibrary,
  EDITOR_ONLY_CORRECTION_VERSION,
  EDITOR_ONLY_CORRECTION_FILE_DEFAULT,
  UNIVERSAL_CORRECTION_POLICY_VERSION,
  UNIVERSAL_CORRECTION_STAGES,
  injectUniversalCorrectionPolicy,
  emptyEditorOnlyCharacterMaterialResult,
  buildCharacterMaterialBlock,
  isMatureCharacterMaterialEnabledForNovel,
  reviewCharacterMaterialSamples,
  calculateCharacterMaterialRhythmDeviation,
  scanCharacterMaterialOverlap,
  injectPromptInjectionGuard,
  resolveFingerprintProfile,
  buildRhythmTargetBlock,
  appendSystemBlock,
  planContextWindow,
  sanitizeSystemForUpstream,
  internalModelIdFromRequest,
  resolveModelForUser,
  findPlatformModel,
  currentDefaultModel,
  buildHumanizePassMessages,
  mergeUsageSum,
  computeAiFlavorScore,
  summarizeAiFlavorVerdict,
  addPromptCacheBreakpoint,
  normalizeReasoningEffort,
  stablePromptCacheKey,
  reserveCredits,
  planCreditReservation,
  normalizeUsage,
  estimateTextTokenUpperBound,
  creditCostForUser,
  roundCreditValue,
  emptyCorrectionAudit,
  scanUniversalCorrectionRisks,
  recordCorrectionHits,
  settleTokenUsage,
  openUpstream,
  responseCors,
  UPSTREAM_MAX_RESPONSE_BYTES,
  UPSTREAM_SSE_BUFFER_BYTES,
  UPSTREAM_QUALITY_SCAN_MAX_CHARS,
  UPSTREAM_TOTAL_TIMEOUT_MS,
  LIVE_BILLING_EVENT_INTERVAL_MS,
  recordDispatchAttempt: customRecordDispatchAttempt
}) {
  const resolveDispatchAttemptRecorder = () => {
    if (typeof customRecordDispatchAttempt === 'function') return customRecordDispatchAttempt;
    const repo = typeof appRepository === 'function' ? appRepository() : appRepository;
    if (repo && typeof repo.recordDispatchAttempt === 'function') {
      return input => repo.recordDispatchAttempt(input);
    }
    return null;
  };
  function handleChat(req, res, legacyGenerationHandoff = null) {
    // SaaS：必须登录，积分绑定到具体用户（未登录拒绝）
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录后再使用 AI 功能' });
    if (!requireSqliteForPublic(req, res)) return;
    if (!allowChatRate(auth.user)) {
      res.setHeader('Retry-After', '60');
      return json(res, 429, { error: 'AI 请求过于频繁，请稍后再试' });
    }
    if (!acquireChatSlot(auth.user)) {
      res.setHeader('Retry-After', '10');
      return json(res, 429, { error: '当前 AI 并发较高，请稍后再试' });
    }
    let chatSlotHeld = true;
    const releaseSlot = () => {
      if (!chatSlotHeld) return;
      chatSlotHeld = false;
      releaseChatSlot(auth.user);
    };

    return readBody(req, CHAT_MAX_JSON_BODY_BYTES).then(async payload => {
      const nativeCatalog = POSTGRES_MODE || getEnvironment().MOLAN_APP_STORE === 'json'
        ? await nativeSkillCatalog(auth.user) : null;
      const db = getDatabase();
      const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
      const requestedProjectId = String(input.projectId || input.novelId || '').trim();
      let chatScope = null;
      if (requestedProjectId) {
        const actorUserId = (typeof postgresActor === 'function' ? postgresActor(auth) : (auth.user && auth.user.userId)) || '';
        let access = null;
        if (POSTGRES_MODE && postgresRepository) {
          try {
            access = await postgresRepository.getProjectAccess(actorUserId, requestedProjectId);
            if (!access) {
              const profile = await postgresRepository.getProfile(actorUserId, requestedProjectId);
              if (profile && profile.access) {
                access = profile.access;
              } else {
                const saved = await postgresRepository.saveProfile({
                  userId: actorUserId,
                  projectId: requestedProjectId,
                  title: '未命名作品',
                  state: { _formatVersion: 3, title: '未命名作品', volumes: [] }
                });
                access = (saved && saved.access) || (await postgresRepository.getProjectAccess(actorUserId, requestedProjectId));
              }
            }
          } catch (_) {}
        } else if (!POSTGRES_MODE && getEnvironment().MOLAN_APP_STORE === 'json') {
          access = await appRepository().getAccess({ userId: auth.user.userId, projectId: requestedProjectId });
        } else if (db) {
          access = projectScope.getNovelAccess(db, requestedProjectId, auth.user.userId);
          if (!access && getEnvironment().MOLAN_APP_STORE !== 'json') {
            try {
              const novel = db.prepare('SELECT id, user_email, owner_user_id, title FROM novels WHERE id = ?').get(requestedProjectId);
              if (novel) {
                const isOwner = (novel.user_email && String(novel.user_email).toLowerCase() === String(auth.user.email || '').toLowerCase()) ||
                                (novel.owner_user_id && novel.owner_user_id === auth.user.userId) ||
                                (!novel.owner_user_id && !novel.user_email);
                if (isOwner || (typeof isAdminUser === 'function' && isAdminUser(auth.user))) {
                  projectScope.ensureNovelProject(db, auth.user, requestedProjectId, novel.title || '未命名作品');
                  access = projectScope.getNovelAccess(db, requestedProjectId, auth.user.userId);
                }
              } else {
                projectScope.ensureNovelProject(db, auth.user, requestedProjectId, '未命名作品');
                access = projectScope.getNovelAccess(db, requestedProjectId, auth.user.userId);
              }
            } catch (_) {}
          }
        }
        if (!projectScope.canAccess(access, projectScope.WRITE_ROLES, 'spend')) {
          releaseSlot();
          return json(res, 404, { error: '项目不存在或当前账户无权发起生成' });
        }
        chatScope = { workspaceId: access.workspace_id, projectId: access.project_id };
      }
      const internalRouteAuthorized = Boolean(INTERNAL_MODEL_ROUTE_KEY) &&
        String(req.headers[INTERNAL_MODEL_ROUTE_HEADER] || '') === INTERNAL_MODEL_ROUTE_KEY;
      const explicitChapterWriting = input.creationMode === true || String(input.stage || '').trim().toLowerCase() === 'writing';
      if (!internalRouteAuthorized && input.editorOnly !== true && explicitChapterWriting &&
          generationV2Enabled(getEnvironment(), auth.user.userId || projectScope.stableUserId(auth.user.email))) {
        releaseSlot();
        if (typeof legacyGenerationHandoff !== 'function') {
          return json(res, 503, { error: 'Generation V2 写章入口不可用', code: 'generation_v2_unavailable' });
        }
        return await legacyGenerationHandoff(req, res, auth, input);
      }
      const benchmarkProtocol = input.benchmarkProtocol === 'benchmark-local-v2' && req.headers[INTERNAL_MODEL_ROUTE_HEADER] === INTERNAL_MODEL_ROUTE_KEY;
      const editorOnly = input.editorOnly === true;
      let validatedMessages = validateChatMessages(splitDynamicPrompt(Array.isArray(input.messages) ? input.messages : []));
      validatedMessages = validatedMessages.map(m => {
        if (m && m.role === 'user' && typeof m.content === 'string') {
          const cleaned = sanitizeUserPrompt(m.content);
          return { ...m, content: cleaned };
        }
        return m;
      });

      const userText = (Array.isArray(validatedMessages) ? validatedMessages : [])
        .filter(m => m && m.role === 'user')
        .map(m => String(m.content || ''))
        .join('\n');
      const isCreationTask = input.creationMode === true ||
        /生成.*?章节|生成.*?小说|创作第.*?节|续写.*?章|写一章|写完整章节|正文（约\d+.*?字）|正文撰写任务|剧情节点|主要人物|世界观/i.test(userText);

      const requestedStage = String(input.stage || '').trim().toLowerCase();
      const stage = ['skill_analysis', 'writing', 'humanizer', 'single'].includes(requestedStage)
        ? requestedStage
        : (isCreationTask ? 'writing' : 'single');

      function inferGenreFromInput(inputObj, msgs) {
        const explicit = String(inputObj && inputObj.genre || '').trim();
        if (explicit && explicit !== 'auto') return explicit;
        const t = (Array.isArray(msgs) ? msgs : [])
          .filter(m => m && m.role === 'user')
          .map(m => String(m.content || ''))
          .join('\n');
        try {
          const detected = detectNovelStyle(t, { genreFamily: explicit });
          if (detected && detected.genreFamily) {
            if (detected.genreFamily === '玄幻修真') return '玄幻';
            if (detected.genreFamily === '都市高武') return '都市';
            if (detected.genreFamily === '科幻末世') return '科幻';
            if (detected.genreFamily === '悬疑惊悚') return '悬疑';
            if (detected.genreFamily === '历史古代') return '历史';
            if (detected.genreFamily === '通用现实' || detected.genreFamily === 'universal') return 'universal';
            return detected.genreFamily;
          }
        } catch (_) {}
        if (/玄幻|仙侠|修真|修仙|大圣|神境|神尊|道痕|魔窟|日晷|天魔|万古|斗破|遮天|完美世界|凡人|法宝|灵气|宗门|蛊仙|气海/i.test(t)) {
          return '玄幻';
        }
        if (/都市|商战|神豪|重生|年代|体制/i.test(t)) {
          return '都市';
        }
        if (/科幻|赛博|星际|机甲/i.test(t)) {
          return '科幻';
        }
        if (/悬疑|惊悚|规则怪谈|民俗/i.test(t)) {
          return '悬疑';
        }
        return 'universal';
      }
      const effectiveGenre = inferGenreFromInput(input, validatedMessages) || 'universal';

      if (isCreationTask || stage === 'writing') {
        const hasSystem = validatedMessages.some(m => m && m.role === 'system');
        if (!hasSystem) {
          if (input.system && typeof input.system === 'string' && input.system.trim()) {
            validatedMessages.unshift({
              role: 'system',
              content: input.system.trim()
            });
          } else {
            validatedMessages = adaptIpContinuationMessages(validatedMessages, {
              creationMode: true,
              stylePreset: input.stylePreset || effectiveGenre
            });
          }
        }
        // ★ 真实注入从【小说创作分类体系完整手册】与 1276 部小说沉淀的三大维度创作指令
        const {
          compileFullWritingSpecification
        } = require('../lib/generation/corpus-archetypes');

        const effectiveNovelGenre = input.novelGenre || input.genreFamily || '';
        const effectiveStyle = input.writingStyle || input.styleArchetype || '';
        const effectiveChapterFunction = input.chapterFunction || '';
        const effectiveFocus = input.chapterFocus || 'balanced';
        const effectiveEndingHook = input.endingHook || '';

        // ★ 字数预算与全维度规范：用户指令绝对最高优先，无指令时默认 2500~3500 字一章
        const lastUser = validatedMessages.slice().reverse().find(m => m && m.role === 'user');
        const userPromptText = lastUser && typeof lastUser.content === 'string' ? lastUser.content : '';

        const fullSpec = compileFullWritingSpecification({
          genre: effectiveNovelGenre,
          writingStyle: effectiveStyle,
          chapterFunction: effectiveChapterFunction,
          chapterFocus: effectiveFocus,
          endingHook: effectiveEndingHook,
          characters: input.characters,
          userPrompt: userPromptText,
          wordBudget: input.wordBudget || { targetWords: input.targetWords, targetChars: input.targetChars }
        });

        if (fullSpec && fullSpec.directive) {
          const sysIdx = validatedMessages.findIndex(m => m && m.role === 'system');
          if (sysIdx >= 0) {
            validatedMessages[sysIdx].content += '\n\n' + fullSpec.directive;
          } else {
            validatedMessages.unshift({ role: 'system', content: fullSpec.directive });
          }
        }
      }
      const defaultSkillApplied = !editorOnly && (stage === 'writing' || stage === 'humanizer');
      let skillAuditRequestValue = input.skillAudit;
      let editorSkill = null;
      let appliedDefaultSkillId = DEFAULT_WRITING_SKILL_ID;
      if (editorOnly) {
        editorSkill = loadEditorOnlyWritingSkill();
        const ensured = ensureEditorOnlyWritingSkill(validatedMessages, editorSkill);
        validatedMessages = ensured.messages;
        // 编辑器不信任客户端声明，审计清单由服务端从 canonical 目录重建。
        skillAuditRequestValue = editorOnlySkillAuditRequest(editorSkill);
      } else if (defaultSkillApplied && input.jsonMode !== true) {
        const ensured = ensureDefaultWritingSkill(validatedMessages, stage, effectiveGenre);
        validatedMessages = ensured.messages;
        skillAuditRequestValue = addDefaultWritingSkillAudit(skillAuditRequestValue, ensured.skill);
        appliedDefaultSkillId = ensured.skill && ensured.skill.id || DEFAULT_WRITING_SKILL_ID;
      }
      let skillAudit = buildSkillAudit(auth, validatedMessages, skillAuditRequestValue, { editorOnly, canonicalSkill: editorSkill, catalog: nativeCatalog });
      skillAudit = { ...skillAudit, stage };
      skillAudit.editorOnly = editorOnly;
      skillAudit.defaultWritingSkill = defaultSkillApplied && input.jsonMode !== true
        ? { id: appliedDefaultSkillId, applied: true }
        : { id: DEFAULT_WRITING_SKILL_ID, applied: false };
      if (skillAudit.skills.length && skillAudit.status !== 'verified') {
        releaseSlot();
        return json(res, 422, {
          error: 'Skill 审计未通过：技能没有完整加载并实际注入本次请求，请重新加载后重试',
          code: 'skill_audit_failed',
          skillAudit: {
            status: skillAudit.status,
            skills: skillAudit.skills.map(skill => ({
              id: skill.id,
              name: skill.name,
              verification: skill.verification,
              occurrences: skill.occurrences
            }))
          }
        });
      }
      let preparedMessages;
      try {
        preparedMessages = prepareSkillMessagesForUpstream(auth, validatedMessages, skillAudit, { editorOnly, canonicalSkill: editorSkill, catalog: nativeCatalog });
      } catch (error) {
        releaseSlot();
        return respondError(res, error);
      }
      let correctionEnabled = editorOnly ? input.jsonMode !== true : correctionPolicyEnabled(stage, input);
      if (benchmarkProtocol) correctionEnabled = false;
      // 结构化 JSON 输出（拆书/创书等）不受散文质量策略干扰，避免注入的纠错文本污染 JSON 合法性。
      if (input && input.jsonMode) correctionEnabled = false;
      // 两遍生成：第一遍（生成遍）不注入纠错库——负面约束堆叠会让模型边写边自我审查，
      // 句式保守化正是 AI 味的主要来源；纠错库移到第二遍（humanize 遍）再注入。
      const twoPassHumanize = isTwoPassHumanizeEnabled(stage, input);
      if (twoPassHumanize) correctionEnabled = false;
      // Skill 注入和通用纠错库可能扩大 system message，最终发往上游前再做一次前部保留。
      const editorCorrectionLibrary = editorOnly && correctionEnabled ? loadEditorOnlyCorrectionLibrary() : null;
      const correctionRequestText = lastUserMessageText(preparedMessages.messages);
      const correctionPriorText = String(input && input.correctionPriorText || '').slice(0, CORRECTION_PRIOR_TEXT_MAX_CHARS);
      let editorCorrectionRender = null;
      let messages = validateChatMessages(editorOnly
        ? injectEditorOnlyCorrectionLibrary(preparedMessages.messages, editorCorrectionLibrary, correctionEnabled, { requestText: correctionRequestText, onRender: render => { editorCorrectionRender = render; } })
        : injectUniversalCorrectionPolicy(preparedMessages.messages, correctionEnabled));
      skillAudit = preparedMessages.skillAudit;
      skillAudit = {
        ...skillAudit,
        correctionPolicy: editorOnly
          ? {
            enabled: correctionEnabled,
            version: editorCorrectionLibrary ? editorCorrectionLibrary.version : EDITOR_ONLY_CORRECTION_VERSION,
            libraryVersion: editorCorrectionLibrary && editorCorrectionLibrary.structured ? editorCorrectionLibrary.structured.version : '',
            source: editorCorrectionLibrary ? 'canonical-file' : 'canonical-file-unavailable',
            path: editorCorrectionLibrary ? editorCorrectionLibrary.path : EDITOR_ONLY_CORRECTION_FILE_DEFAULT,
            sha256: editorCorrectionLibrary ? editorCorrectionLibrary.sha256 : '',
            mode: editorCorrectionRender ? editorCorrectionRender.mode : '',
            scenes: editorCorrectionRender ? editorCorrectionRender.scenes : [],
            caseIds: editorCorrectionRender ? editorCorrectionRender.caseIds : [],
            referenceCount: editorCorrectionRender ? editorCorrectionRender.referenceCount : 0,
            promptChars: editorCorrectionRender ? editorCorrectionRender.text.length : 0
          }
          : correctionEnabled ? {
            version: UNIVERSAL_CORRECTION_POLICY_VERSION,
            scope: 'all-users-all-novels',
            stages: [...UNIVERSAL_CORRECTION_STAGES]
          } : { enabled: false }
      };
      const materialHint = !editorOnly && input.characterMaterial && typeof input.characterMaterial === 'object' && !Array.isArray(input.characterMaterial)
        ? input.characterMaterial
        : {};
      const characterMaterialEligible = !editorOnly && input.jsonMode !== true
        && materialHint.proseTask === true
        && (stage === 'writing' || stage === 'humanizer');
      const generationContextText = messages
        .filter(message => message && message.role === 'user' && typeof message.content === 'string')
        .slice(-3)
        .map(message => message.content)
        .join('\n')
        .slice(-1600);
      const characterMaterialRequest = characterMaterialEligible
        ? { ...materialHint, query: materialHint.query || generationContextText, proseTask: materialHint.proseTask !== false }
        : { enabled: false, proseTask: false };
      const characterMaterialResult = editorOnly
        ? emptyEditorOnlyCharacterMaterialResult()
        : buildCharacterMaterialBlock({
          ...auth,
          characterMaterialAdmin: isAdminUser(auth.user),
          characterMaterialMatureAllowed: isMatureCharacterMaterialEnabledForNovel(auth.user, materialHint.novelId)
        }, characterMaterialRequest);
      skillAudit = {
        ...skillAudit,
        characterMaterial: characterMaterialResult.audit
      };
      const isChapterWriting = (stage === 'writing') || input.creationMode === true || (Array.isArray(validatedMessages) ? validatedMessages : []).some(m =>
        m && (
          (m.role === 'system' && (
            m.content.includes('【四大去AI味') ||
            m.content.includes('顶级商业中文小说名家作家')
          )) ||
          (m.role === 'user' && /生成.*?章节|生成.*?小说|创作第.*?节|续写.*?章|写一章|写完整章节|正文撰写任务|剧情推演|大纲[：:]|剧情节点|主要人物|世界观/i.test(m.content))
        )
      );
      const temperature = typeof input.temperature === 'number' && Number.isFinite(input.temperature)
        ? input.temperature
        : (isChapterWriting ? 0.82 : (stage === 'writing' ? 0.82 : 0.85));
      const presencePenalty = typeof input.presence_penalty === 'number' && Number.isFinite(input.presence_penalty)
        ? input.presence_penalty
        : (isChapterWriting ? 0.08 : undefined);
      const frequencyPenalty = typeof input.frequency_penalty === 'number' && Number.isFinite(input.frequency_penalty)
        ? input.frequency_penalty
        : (isChapterWriting ? 0.08 : undefined);
      const requestedMaxTokens = Number(input.max_tokens || input.max_completion_tokens || 8192);
      let max_tokens = Number.isFinite(requestedMaxTokens) ? Math.max(1, Math.min(128000, Math.floor(requestedMaxTokens))) : 8192;
      if (isChapterWriting && max_tokens < 8192) {
        max_tokens = 8192;
      }

      // 平台模型路由：前端只传 model（平台 id），服务端取自己的 key 转发。
      // 安全：忽略前端传入的 source / apiKey，用户无法注入自有 key 绕过平台计费。
      const requestedModel = input.model || '';
      const internalModelId = internalModelIdFromRequest(req, input);
      const modelId = internalModelId || resolveModelForUser(auth.user, requestedModel);
      const isModelDowngraded = Boolean(requestedModel && requestedModel !== modelId && !internalModelId);
      const pm = findPlatformModel(modelId) || findPlatformModel(currentDefaultModel());
      if (!pm) { releaseSlot(); json(res, 500, { error: '服务端未配置平台模型' }); return; }
      const isOpenAI = pm.provider === 'openai-compat';
      const apiKey = isOpenAI ? (pm.apiKey || '') : getDeepseekKey();
      if (!apiKey) { releaseSlot(); json(res, 500, { error: '平台模型「' + pm.name + '」尚未配置密钥，请联系管理员' }); return; }
      const targetURL = isOpenAI
        ? (pm.baseURL.replace(/\/+$/, '') + '/chat/completions')
        : getDeepseekUrl();
      const isGemini = pm.group === 'gemini' || /gemini/i.test(String(pm.model || pm.id));
      let reasoningEffort = null;
      if (pm.supportsReasoning) {
        reasoningEffort = normalizeReasoningEffort(pm, input.reasoningEffort);
        if (!reasoningEffort && /^gpt-6-luna$/i.test(String(pm.model || pm.id))) {
          reasoningEffort = (input.stage === 'skill_analysis' || input.stage === 'planning') ? 'max' : 'medium';
        } else if (!reasoningEffort && isGemini) {
          reasoningEffort = (input.stage === 'skill_analysis' || input.stage === 'planning') ? 'high' : 'medium';
        }
      }
      const model = resolveUpstreamModelForReasoning(pm, reasoningEffort);
      const isLocalOrHostTarget = /^(https?:\/\/)?(127\.0\.0\.1|localhost|8\.138\.128\.184|::1)(:\d+)?(\/|$)/i.test(targetURL);
      const effectiveProxy = isOpenAI && getProxyUrl() && !isLocalOrHostTarget ? getProxyUrl() : '';
      const characterMaterialReview = editorOnly
        ? { approvedIds: [], audit: { required: false, status: 'disabled_for_editor_only', checkedCount: 0, passedCount: 0, rejectedCount: 0, calls: [] } }
        : await reviewCharacterMaterialSamples(String(req.headers.authorization || ''), auth.user, characterMaterialResult, messages, modelId);
      if (characterMaterialReview.audit.required) {
        const approvedSampleIds = new Set(characterMaterialReview.approvedIds);
        const reviewedMaterial = buildCharacterMaterialBlock({
          ...auth,
          characterMaterialAdmin: isAdminUser(auth.user),
          characterMaterialMatureAllowed: isMatureCharacterMaterialEnabledForNovel(auth.user, materialHint.novelId)
        }, characterMaterialRequest, { sampleIds: [...approvedSampleIds] });
        reviewedMaterial.audit = { ...reviewedMaterial.audit, sampleReview: characterMaterialReview.audit };
        Object.assign(characterMaterialResult, reviewedMaterial);
      }
      if (characterMaterialResult.messages.length) {
        const firstUserIndex = messages.findIndex(message => message && message.role === 'user');
        const insertAt = firstUserIndex >= 0 ? firstUserIndex : messages.length;
        messages = validateChatMessages([
          ...messages.slice(0, insertAt),
          ...characterMaterialResult.messages,
          ...messages.slice(insertAt)
        ]);
      }
      messages = injectPromptInjectionGuard(messages, stage, input.jsonMode === true);
      // 两遍生成：生成遍注入正面节奏目标（来自资源库题材指纹统计基线），替代负面纠错约束。
      let twoPassProfile = null;
      if (twoPassHumanize && !editorOnly) {
        const twoPassGenre = String(
          (characterMaterialRequest && characterMaterialRequest.genre)
          || (materialHint && materialHint.genre)
          || (input && input.genre)
          || ''
        ).trim();
        const fingerprintMatched = resolveFingerprintProfile(twoPassGenre);
        twoPassProfile = (fingerprintMatched && fingerprintMatched.profile) || null;
        const rhythmBlock = buildRhythmTargetBlock(twoPassGenre);
        if (rhythmBlock) messages = appendSystemBlock(messages, rhythmBlock);
      }
      skillAudit.characterMaterial = characterMaterialResult.audit;
      const contextPlan = planContextWindow(pm, messages, max_tokens);
      if (!contextPlan.ok) {
        releaseSlot();
        return json(res, 413, {
          error: contextPlan.fixedPromptExceeded
            ? '当前模型窗口无法容纳完整 Skill、素材和系统提示，请减少 Skill/素材或切换到更大窗口的模型后重试'
            : '当前模型上下文窗口不足，请减少作品上下文或切换到更大窗口的模型后重试',
          code: contextPlan.code,
          modelId,
          contextWindowTokens: contextPlan.contextWindowTokens,
          promptTokens: contextPlan.promptTokens,
          fixedPromptTokens: contextPlan.fixedPromptTokens,
          originalDynamicPromptTokens: contextPlan.originalDynamicPromptTokens,
          dynamicPromptTokens: contextPlan.dynamicPromptTokens,
          dynamicPromptBudget: contextPlan.dynamicPromptBudget,
          dynamicPromptTruncated: contextPlan.dynamicPromptTruncated,
          characterMaterialTokens: contextPlan.characterMaterialTokens,
          originalCharacterMaterialTokens: contextPlan.originalCharacterMaterialTokens,
          characterMaterialSamplesRemovedByBudget: contextPlan.characterMaterialSamplesRemovedByBudget,
          characterMaterialRulesReducedByBudget: contextPlan.characterMaterialRulesReducedByBudget,
          requiredOutputTokens: contextPlan.requestedMaxTokens,
          overflowTokens: contextPlan.overflowTokens,
          availableCompletionTokens: contextPlan.availableCompletionTokens,
          fixedPromptExceeded: contextPlan.fixedPromptExceeded
        });
      }
      messages = contextPlan.messages;
      // ★ IP 合规净化：将 system 消息中的显式书名（《凡人修仙传》）和作者真名（忘语）
      //   替换为纯题材机理描述，避免上游大模型触发版权安全过滤拒答。
      messages = messages.map(m => {
        if (m && m.role === 'system' && typeof m.content === 'string') {
          const sanitized = sanitizeSystemForUpstream(m.content);
          return sanitized !== m.content ? { ...m, content: sanitized } : m;
        }
        return m;
      });
      max_tokens = contextPlan.maxTokens;
      characterMaterialResult.audit = {
        ...characterMaterialResult.audit,
        sampleCount: contextPlan.characterMaterialSamplesRemovedByBudget ? 0 : characterMaterialResult.audit.sampleCount,
        sampleSources: contextPlan.characterMaterialSamplesRemovedByBudget ? [] : characterMaterialResult.audit.sampleSources,
        samplesRemovedByBudget: !!contextPlan.characterMaterialSamplesRemovedByBudget,
        rulesReducedByBudget: !!contextPlan.characterMaterialRulesReducedByBudget
      };
      skillAudit.characterMaterial = characterMaterialResult.audit;

      // 请求体统一带 stream_options.include_usage，便于服务端按 token 扣减积分
      let bodyObj;
      if (isOpenAI) {
        const officialMessages = addPromptCacheBreakpoint(messages, pm);
        bodyObj = { model, messages: officialMessages, stream: true, stream_options: { include_usage: true } };
        if (pm.supportsReasoning) {
          if (reasoningEffort) bodyObj.reasoning_effort = reasoningEffort;
          bodyObj.max_completion_tokens = max_tokens;
          if (typeof temperature === 'number' && (!/^gpt-6-luna$/i.test(String(pm.model || pm.id)) || reasoningEffort === 'none')) bodyObj.temperature = temperature;
        } else {
          bodyObj.temperature = temperature;
          bodyObj.max_tokens = max_tokens;
        }
        if (pm.promptCaching) {
          bodyObj.prompt_cache_key = stablePromptCacheKey(auth.user.email, modelId, messages);
          if (pm.promptCacheMode === 'explicit') bodyObj.prompt_cache_options = { mode: 'explicit' };
        }
      } else {
        bodyObj = { model, messages, stream: true, temperature, max_tokens, stream_options: { include_usage: true } };
        if (pm.supportsThinking) bodyObj.thinking = { type: input.thinking === true ? 'enabled' : 'disabled' };
      }
      if (presencePenalty !== undefined) bodyObj.presence_penalty = presencePenalty;
      if (frequencyPenalty !== undefined) bodyObj.frequency_penalty = frequencyPenalty;
      // ★ JSON 输出模式：拆书等结构化任务通过 input.jsonMode 开启，让上游强制返回合法 JSON
      if (input.jsonMode) {
        bodyObj.response_format = { type: 'json_object' };
        // DeepSeek JSON 模式要求提示中包含 "json" 字样，此处补一个系统提示片段
        const firstSystem = bodyObj.messages.findIndex(m => m && m.role === 'system' && typeof m.content === 'string');
        const jsonHint = '你必须在回复中输出一个合法的 JSON 对象（不要 Markdown 围栏，不要额外解释）。';
        if (firstSystem >= 0) bodyObj.messages[firstSystem] = { ...bodyObj.messages[firstSystem], content: String(bodyObj.messages[firstSystem].content || '') + '\n\n' + jsonHint };
        else bodyObj.messages.unshift({ role: 'system', content: jsonHint });
      }
      const requestedRequestId = internalRouteAuthorized
        ? String(input.requestId || req.headers['idempotency-key'] || '').trim()
        : '';
      if (requestedRequestId && !/^req_[a-f0-9]{40}$/i.test(requestedRequestId)) {
        releaseSlot();
        return json(res, 400, { error: '内部 Provider 请求幂等键格式无效', code: 'INVALID_IDEMPOTENCY_KEY' });
      }
      const requestId = requestedRequestId || 'req_' + crypto.randomBytes(20).toString('hex');
      const requestPayloadHash = crypto.createHash('sha256').update(JSON.stringify(bodyObj), 'utf8').digest('hex');
      const existingReservation = await reserveCredits(auth.user, modelId, model, requestId, 0, skillAudit, requestPayloadHash, chatScope, { lookupOnly: true });
      if (!existingReservation.ok) {
        releaseSlot();
        if (existingReservation.conflict) {
          return json(res, 409, { error: 'Provider 幂等键已绑定到不同请求内容', code: 'IDEMPOTENCY_KEY_REUSED' });
        }
        return json(res, 402, { error: '积分不足，请前往价格页充值或升级套餐' });
      }
      if (existingReservation.existing) {
        releaseSlot();
        return json(res, 409, {
          error: 'Provider 请求已受理；请查询 Generation Run 状态，不要重新调用模型',
          code: 'PROVIDER_UNKNOWN', unknown: true, requestId
        });
      }

      const creditPlan = planCreditReservation(auth.user, modelId, messages, max_tokens);
      if (!creditPlan.ok) {
        releaseSlot();
        return json(res, 402, { error: '当前积分不足以覆盖本次输入，请充值后再试' });
      }
      max_tokens = creditPlan.maxTokens;
      if (Object.prototype.hasOwnProperty.call(bodyObj, 'max_completion_tokens')) bodyObj.max_completion_tokens = max_tokens;
      if (Object.prototype.hasOwnProperty.call(bodyObj, 'max_tokens')) bodyObj.max_tokens = max_tokens;

      // Some OpenAI-compatible relays expose GPT-5.6 but have not implemented
      // explicit prompt-cache fields yet. Keep one plain-request fallback for
      // that narrow 400 response; never retry arbitrary upstream failures.
      const cacheFallbackBodyObj = isOpenAI && pm.promptCaching && pm.promptCacheMode === 'explicit'
        ? { ...bodyObj, messages }
        : null;
      if (cacheFallbackBodyObj) {
        delete cacheFallbackBodyObj.prompt_cache_key;
        delete cacheFallbackBodyObj.prompt_cache_options;
      }
      const body = JSON.stringify(bodyObj);

      const reservedCost = creditPlan.reservedCost;
      const reservation = await reserveCredits(auth.user, modelId, model, requestId, reservedCost, skillAudit, requestPayloadHash, chatScope);
      if (!reservation.ok) {
        releaseSlot();
        if (reservation.conflict) {
          return json(res, 409, { error: 'Provider 幂等键已绑定到不同请求内容', code: 'IDEMPOTENCY_KEY_REUSED' });
        }
        return json(res, 402, { error: '积分不足，请前往价格页充值或升级套餐' });
      }
      if (reservation.existing) {
        releaseSlot();
        return json(res, 409, {
          error: 'Provider 请求已受理；请查询 Generation Run 状态，不要重新调用模型',
          code: 'PROVIDER_UNKNOWN', unknown: true, requestId
        });
      }
      const startedAt = Date.now();
      let lastUsage = null;
      let upstreamFinishReason = null;
      let providerRequestSent = false;
      let providerResponseReceived = false;
      let attemptSeq = 0;
      let finalized = false;
      let upstreamRef = null;
      let responseClosed = false;
      let dispatchPending = false;
      let pendingAbortStatus = null;
      let keepAliveTimer = null;
      let requestDeadlineTimer = null;
      function cleanupKeepAlive() {
        if (keepAliveTimer) {
          clearInterval(keepAliveTimer);
          keepAliveTimer = null;
        }
      }
      function cleanupRequestDeadline() {
        if (requestDeadlineTimer) {
          clearTimeout(requestDeadlineTimer);
          requestDeadlineTimer = null;
        }
      }
      const promptTokens = contextPlan.promptTokens;
      const contextWindowTokens = contextPlan.contextWindowTokens;
      const reservationTokenLimit = creditPlan.reservationTokenLimit;
      let streamedOutputText = '';
      let streamedContentText = '';
      let correctionAudit = emptyCorrectionAudit(correctionEnabled);
      let lastBillingAt = 0;
      // 两遍生成状态：第一遍文本/用量在第二遍开始前存档，第二遍失败时回退初稿。
      let firstPassText = '';
      let firstPassUsage = null;
      let secondPassActive = false;
      let aiFlavorFirstPass = null;
      let aiFlavorSecondPass = null;
      let rewriteMeta = null;
      // The reservation already holds the full cost of the safe output budget,
      // and max_tokens/max_completion_tokens is sent upstream as the hard cap.
      // Do not stop from a text-length estimate: CJK tokenization varies by
      // provider, and that estimate can cut a sentence before finish_reason.

      /** 判断当前 HTTP 响应是否仍可安全写入流式数据。 */
      function canWriteResponse() {
        return !responseClosed && !finalized && !res.writableEnded && !res.destroyed;
      }

      /** 标记客户端连接已关闭并释放上游请求与计费占用。 */
      function closeClientResponse() {
        cleanupKeepAlive();
        if (responseClosed) return;
        responseClosed = true;
        if (dispatchPending) return;
        if (!finalized) finalizeUsage('aborted');
        if (upstreamRef) { try { upstreamRef.destroy(); } catch (_) {} }
      }

      /**
       * 以 OpenAI 兼容的 SSE 增量格式向前端下发一段文本（两遍模式下初稿达标时使用）。
       * 按约 240 字切片，保持与真实流式输出一致的渲染节奏。
       */
      function flushDraftAsSSE(text) {
        if (!canWriteResponse() || !res.headersSent) return;
        let content = String(text || '');
        try {
          const { sanitizeInPlace } = require('../lib/generation/inplace-sanitizer');
          content = sanitizeInPlace(content).text;
        } catch (_) {}
        if (!content) { try { res.write('data: [DONE]\n\n'); } catch (_) {} return; }
        const CHUNK = 240;
        for (let i = 0; i < content.length; i += CHUNK) {
          if (!canWriteResponse()) return;
          try {
            res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: content.slice(i, i + CHUNK) } }] }) + '\n\n');
          } catch (_) { return; }
        }
        try { res.write('data: [DONE]\n\n'); } catch (_) {}
      }

      function parseStreamLine(line) {
        if (!line.startsWith('data:')) return;
        const d = line.slice(5).trim();
        if (!d || d === '[DONE]') return null;
        try {
          const j = JSON.parse(d);
          if (j && j.usage && typeof j.usage === 'object') lastUsage = j.usage;
          const choice = j && j.choices && j.choices[0];
          if (choice && choice.finish_reason && choice.finish_reason !== 'stop') upstreamFinishReason = String(choice.finish_reason);
          const delta = choice && choice.delta;
          if (delta) {
            if (typeof delta.content === 'string') {
              streamedOutputText += delta.content;
              streamedContentText += delta.content;
            }
            if (typeof delta.reasoning_content === 'string') streamedOutputText += delta.reasoning_content;
          }
          return j;
        } catch (_) { return null; }
      }

      function liveBillingTokens() {
        const exact = normalizeUsage(lastUsage).totalTokens;
        return exact === null ? Math.min(reservationTokenLimit, promptTokens + estimateTextTokenUpperBound(streamedOutputText)) : exact;
      }

      function sendBilling(status, force) {
        if (!canWriteResponse() || !res.headersSent) return;
        const now = Date.now();
        if (!force && now - lastBillingAt < LIVE_BILLING_EVENT_INTERVAL_MS) return;
        lastBillingAt = now;
        const estimatedTokens = liveBillingTokens();
        const estimatedCreditCost = creditCostForUser(auth.user, modelId, estimatedTokens);
        const forwarding = skillAudit.forwarding && typeof skillAudit.forwarding === 'object' ? skillAudit.forwarding : {};
        const forwardedFileCount = Array.isArray(forwarding.skills)
          ? forwarding.skills.reduce((total, skill) => total + (Array.isArray(skill && skill.forwardedTextFiles) ? skill.forwardedTextFiles.length : 0), 0)
          : 0;
        try {
          res.write('data: ' + JSON.stringify({ molan_billing: {
            requestId,
            status: status || 'streaming',
            modelId,
            downgraded: isModelDowngraded,
            requestedModel: isModelDowngraded ? requestedModel : undefined,
            downgradedFrom: isModelDowngraded ? requestedModel : undefined,
            contextWindowTokens,
            promptTokens,
            fixedPromptTokens: contextPlan.fixedPromptTokens,
            dynamicPromptTokens: contextPlan.dynamicPromptTokens,
            dynamicPromptTruncated: !!contextPlan.dynamicPromptTruncated,
            characterMaterial: {
              enabled: !!characterMaterialResult.audit.enabled,
              ruleCount: Number(characterMaterialResult.audit.ruleCount) || 0,
              sampleCount: Number(characterMaterialResult.audit.sampleCount) || 0,
              samplesRemovedByBudget: !!characterMaterialResult.audit.samplesRemovedByBudget
            },
            maxOutputTokens: max_tokens,
            cappedByContext: !!contextPlan.cappedByContext,
            estimatedTokens,
            estimatedCreditCost,
            reservedCost,
            cappedByBalance: !!creditPlan.cappedByBalance,
            remainingReserved: Math.max(0, roundCreditValue(reservedCost - estimatedCreditCost)),
            remainingCredits: reservation.remainingCredits == null ? null : reservation.remainingCredits,
            skillAuditStatus: String(skillAudit.status || 'none'),
            skillForwardingStatus: String(forwarding.status || 'not-recorded'),
            skillForwardedFileCount: forwardedFileCount,
            correctionPolicyVersion: editorOnly
              ? (correctionEnabled ? (editorCorrectionLibrary ? editorCorrectionLibrary.version : EDITOR_ONLY_CORRECTION_VERSION) : '')
              : correctionEnabled ? UNIVERSAL_CORRECTION_POLICY_VERSION : twoPassHumanize ? UNIVERSAL_CORRECTION_POLICY_VERSION + ' (two-pass: second pass)' : '',
            correctionStatus: correctionAudit.status,
            twoPassHumanize: !!twoPassHumanize,
            editorOnly
          } }) + '\n\n');
        } catch (_) {}
      }

      function finalizeUsage(status) {
        cleanupKeepAlive();
        cleanupRequestDeadline();
        if (finalized) return null;
        finalized = true;
        releaseSlot();
        const qualityScanText = streamedContentText.length > UPSTREAM_QUALITY_SCAN_MAX_CHARS
          ? streamedContentText.slice(0, UPSTREAM_QUALITY_SCAN_MAX_CHARS)
          : streamedContentText;
        const qualityScanTruncated = qualityScanText.length < streamedContentText.length;
        // 题材分层扫描：请求携带 genre 时按题材过滤仅对特定题材成立的纠错规则（lib/genre-rule-scope）。
        correctionAudit = correctionEnabled
          ? scanUniversalCorrectionRisks(qualityScanText, { genre: String(input && input.genre || '').trim(), priorText: correctionPriorText })
          : emptyCorrectionAudit(false);
        if (correctionEnabled && status === 'completed') recordCorrectionHits(correctionAudit, { editorOnly, stage });
        const materialSamples = Array.isArray(characterMaterialResult.samples)
          ? characterMaterialResult.samples
          : characterMaterialResult.retrieval && Array.isArray(characterMaterialResult.retrieval.samples)
            ? characterMaterialResult.retrieval.samples
            : [];
        const materialOverlap = characterMaterialResult.audit.enabled
          ? scanCharacterMaterialOverlap(
            qualityScanText,
            characterMaterialResult.audit.samplesRemovedByBudget ? [] : materialSamples,
            characterMaterialResult.audit.samplesRemovedByBudget ? [] : materialSamples.flatMap(sample => Array.isArray(sample.forbiddenTerms) ? sample.forbiddenTerms : [])
          )
          : { checkedSampleCount: 0, overlapFragments: [], leakedTerms: [], blocked: false };
        const rhythmDeviation = characterMaterialResult.audit.profileAvailable
          ? calculateCharacterMaterialRhythmDeviation(qualityScanText, characterMaterialResult.retrieval && characterMaterialResult.retrieval.profile)
          : { available: false, exceeded: false };
        const characterMaterial = {
          ...characterMaterialResult.audit,
          overlap: materialOverlap,
          rhythmDeviation,
          blocked: !!materialOverlap.blocked
        };
        skillAudit = {
          ...skillAudit,
          correctionAudit,
          characterMaterial
        };
        const usage = twoPassHumanize
          ? normalizeUsage(mergeUsageSum(firstPassUsage, lastUsage))
          : normalizeUsage(lastUsage);
        const settledStatus = status === 'completed' && upstreamFinishReason === 'length' ? 'truncated' : status;
        const finalStatus = settledStatus === 'completed' && characterMaterial.blocked
          ? 'material_overlap'
          : settledStatus === 'completed' && !streamedContentText.trim()
          ? 'empty_output'
          : settledStatus === 'completed' && usage.totalTokens === null
            ? 'usage_unavailable'
            : settledStatus;
        const event = {
          requestId,
          userEmail: auth.user.email,
          userId: auth.user.userId || projectScope.stableUserId(auth.user.email),
          workspaceId: chatScope && chatScope.workspaceId || '',
          projectId: chatScope && chatScope.projectId || '',
          modelId,
          providerModel: model,
          contextWindowTokens,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          reasoningTokens: usage.reasoningTokens,
          totalTokens: usage.totalTokens,
          cachedTokens: usage.cachedTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
          usageSource: usage.usageSource,
          providerRequestSent,
          providerResponseReceived,
          providerUsageIncomplete: twoPassHumanize && secondPassActive &&
            (normalizeUsage(firstPassUsage).totalTokens === null || normalizeUsage(lastUsage).totalTokens === null),
          terminationStatus: settledStatus,
          status: finalStatus,
          finishReason: upstreamFinishReason || (finalStatus === 'empty_output' ? 'empty_output' : null),
          createdAt: startedAt,
          durationMs: Math.max(0, Date.now() - startedAt),
          creditCost: creditCostForUser(auth.user, modelId, usage.totalTokens),
          reservedCost,
          estimatedTokens: liveBillingTokens(),
          estimatedCreditCost: creditCostForUser(auth.user, modelId, liveBillingTokens()),
          correctionAudit,
          characterMaterial,
          qualityScan: {
            maxChars: UPSTREAM_QUALITY_SCAN_MAX_CHARS,
            scannedChars: qualityScanText.length,
            truncated: qualityScanTruncated
          },
          skillAudit,
          messagesHash: skillAudit.promptHash,
          editorOnly
        };
        // 两遍生成的 AI 味检测报告随 molan_usage 下发，供前端与回归评测消费（不静默放行）。
        if (twoPassHumanize) {
          event.aiFlavor = {
            twoPass: true,
            firstPass: summarizeAiFlavorVerdict(aiFlavorFirstPass),
            secondPass: summarizeAiFlavorVerdict(aiFlavorSecondPass),
            rewrite: rewriteMeta
          };
        }
        const finishResponse = () => {
          if (!responseClosed && res.headersSent && !res.writableEnded && !res.destroyed) {
            try { res.write('data: ' + JSON.stringify({ molan_usage: event }) + '\n\n'); } catch (_) {}
            try { res.end(); } catch (_) {}
          }
        };
        try {
          const settlement = settleTokenUsage(event);
          if (settlement && typeof settlement.then === 'function') {
            settlement.then(result => {
              event.creditCost = result.creditCost;
              event.billingStatus = result.billingStatus;
              finishResponse();
            }).catch(error => {
              console.error('Token usage persistence failed:', error && error.message || error);
              event.creditCost = null;
              event.billingStatus = 'persistence_failed';
              finishResponse();
            });
            return event;
          }
          event.creditCost = settlement.creditCost;
          event.billingStatus = settlement.billingStatus;
        } catch (e) {
          console.error('Token usage persistence failed:', e.message);
          event.creditCost = null;
          event.billingStatus = 'persistence_failed';
        }
        finishResponse();
        return event;
      }

      async function immediateReleaseReservation(reason) {
        try {
          if (typeof settleTokenUsage === 'function') {
            const releaseEvent = {
              requestId,
              userId: auth.user.userId || (projectScope && projectScope.stableUserId ? projectScope.stableUserId(auth.user.email) : auth.user.email),
              userEmail: auth.user.email,
              projectId: chatScope && chatScope.projectId || '',
              workspaceId: chatScope && chatScope.workspaceId || '',
              modelId,
              providerModel: model,
              status: reason || 'dispatch_failed',
              totalTokens: null,
              providerRequestSent: false,
              providerResponseReceived: false,
              creditCost: 0,
              reservedCost
            };
            const result = settleTokenUsage(releaseEvent);
            if (result && typeof result.then === 'function') await result;
          }
        } catch (releaseErr) {
          console.error('[chat] immediate reservation release failed:', releaseErr && releaseErr.message || releaseErr);
        }
      }

      req.on('aborted', () => {
        closeClientResponse();
      });
      res.on('close', () => {
        closeClientResponse();
      });
      res.on('error', () => {
        closeClientResponse();
      });
      let cacheFallbackAttempted = false;
      function isUnsupportedCacheError(statusCode, text) {
        if (statusCode !== 400 || !cacheFallbackBodyObj) return false;
        return /prompt[ _-]?cache|cache[ _-]?(breakpoint|options|key)/i.test(String(text || ''));
      }
      function upstreamErrorMessage(statusCode, text) {
        try {
          const parsed = JSON.parse(String(text || ''));
          const detail = parsed && parsed.error;
          return (detail && (detail.message || detail.type)) || detail || parsed.message || ('上游模型返回 HTTP ' + statusCode);
        } catch (_) {
          return String(text || '').trim().slice(0, 1000) || ('上游模型返回 HTTP ' + statusCode);
        }
      }
      function isContextWindowError(text) {
        return /context\s*(?:window|length)|maximum\s+context|input\s+exceeds|too\s+many\s+tokens/i.test(String(text || ''));
      }
      function abortUpstreamRequest(status, code, message, httpStatus) {
        if (finalized || responseClosed) return;
        if (dispatchPending) {
          responseClosed = true;
          pendingAbortStatus = status;
          return;
        }
        finalizeUsage(status);
        if (upstreamRef) {
          try { upstreamRef.destroy(new Error(message)); } catch (_) {}
        }
        if (res.headersSent && !res.writableEnded && !res.destroyed) {
          try { res.write('data: ' + JSON.stringify({ molan_error: { code, message, requestId } }) + '\n\n'); } catch (_) {}
        }
        if (!res.headersSent && !res.writableEnded && !res.destroyed) {
          json(res, httpStatus || 502, {
            error: message,
            code,
            requestId,
            ...(code === 'upstream_timeout' ? { timeoutMs: UPSTREAM_TOTAL_TIMEOUT_MS } : {}),
            ...(code === 'upstream_response_too_large' ? { maxBytes: UPSTREAM_MAX_RESPONSE_BYTES } : {}),
            ...(code === 'upstream_sse_buffer_overflow' ? { maxBytes: UPSTREAM_SSE_BUFFER_BYTES } : {})
          });
        }
      }
      /**
       * 构造第二遍（humanize 遍）的上游请求体：改写消息集 + 收敛后的改写预算。
       * max_tokens 压到初稿长度上限（下限 768），控制两遍总成本。
       */
      function buildSecondPassBody(draft) {
        const secondMessages = buildHumanizePassMessages(draft);
        const secondMaxTokens = Math.min(max_tokens, Math.max(768, estimateTextTokenUpperBound(draft)));
        if (isOpenAI) {
          const officialMessages = addPromptCacheBreakpoint(secondMessages, pm);
          const obj = { model, messages: officialMessages, stream: true, stream_options: { include_usage: true } };
          if (pm.supportsReasoning) {
            if (reasoningEffort) obj.reasoning_effort = reasoningEffort;
            obj.max_completion_tokens = secondMaxTokens;
          } else {
            obj.temperature = temperature;
            obj.max_tokens = secondMaxTokens;
          }
          if (pm.promptCaching) {
            obj.prompt_cache_key = stablePromptCacheKey(auth.user.email, modelId, secondMessages);
            if (pm.promptCacheMode === 'explicit') obj.prompt_cache_options = { mode: 'explicit' };
          }
          if (presencePenalty !== undefined) obj.presence_penalty = presencePenalty;
          if (frequencyPenalty !== undefined) obj.frequency_penalty = frequencyPenalty;
          return obj;
        }
        const obj = { model, messages: secondMessages, stream: true, temperature, max_tokens: secondMaxTokens, stream_options: { include_usage: true } };
        if (pm.supportsThinking) obj.thinking = { type: input.thinking === true ? 'enabled' : 'disabled' };
        if (presencePenalty !== undefined) obj.presence_penalty = presencePenalty;
        if (frequencyPenalty !== undefined) obj.frequency_penalty = frequencyPenalty;
        return obj;
      }

      /**
       * 第一遍（生成遍）流结束：AI 味检测达标则直接下发初稿；超标则触发第二遍改写。
       * 第二遍失败或无输出时回退初稿，保证用户始终拿到完整正文。
       */
      function handleFirstPassEnd() {
        if (finalized || responseClosed) return;
        firstPassText = streamedContentText;
        firstPassUsage = lastUsage;
        aiFlavorFirstPass = computeAiFlavorScore(firstPassText, twoPassProfile);
        const forceHumanize = Boolean(input.forceHumanizePass === true || input.alwaysHumanize === true);
        if (!firstPassText.trim() || (aiFlavorFirstPass && aiFlavorFirstPass.passed && !forceHumanize)) {
          rewriteMeta = { applied: false, reason: aiFlavorFirstPass && aiFlavorFirstPass.passed ? 'first_pass_passed' : 'empty_draft' };
          flushDraftAsSSE(firstPassText);
          finalizeUsage('completed');
          return;
        }
        // AI 味超标 → 通知前端进入改写遍（信息性事件，未识别该事件的前端可安全忽略），再发起第二遍。
        secondPassActive = true;
        lastUsage = null;
        if (canWriteResponse()) {
          try {
            res.write('data: ' + JSON.stringify({ molan_rewrite: { phase: 'begin', firstPassScore: aiFlavorFirstPass.score } }) + '\n\n');
          } catch (_) { closeClientResponse(); return; }
        }
        streamedContentText = '';
        streamedOutputText = '';
        const secondBodyObj = buildSecondPassBody(firstPassText);
        sendUpstream(JSON.stringify(secondBodyObj), {
          pass: 2,
          stage: 'second_pass',
          attemptId: `${requestId}_att_p2_1_${Date.now()}`,
          passthrough: true,
          fallbackBody: null,
          onStreamEnd: handleSecondPassEnd,
          onError: errReason => {
            if (!streamedContentText.trim()) {
              streamedContentText = firstPassText;
              streamedOutputText = firstPassText;
              flushDraftAsSSE(firstPassText);
              rewriteMeta = { applied: 'failed', reason: errReason || 'upstream_error', fallback: 'first_pass', firstPassScore: aiFlavorFirstPass.score };
            }
            finalizeUsage('upstream_error');
          }
        });
      }

      /**
       * 第二遍（humanize 遍）流结束：对改写结果复检，记录两轮报告后收尾。
       */
      function handleSecondPassEnd() {
        if (finalized || responseClosed) return;
        aiFlavorSecondPass = computeAiFlavorScore(streamedContentText, twoPassProfile);
        if (!streamedContentText.trim()) {
          // 改写遍空输出：回退初稿，避免 empty_output。
          streamedContentText = firstPassText;
          streamedOutputText = firstPassText;
          flushDraftAsSSE(firstPassText);
          rewriteMeta = { applied: 'fallback', reason: 'empty_rewrite', fallback: 'first_pass', firstPassScore: aiFlavorFirstPass.score };
        } else {
          rewriteMeta = {
            applied: true,
            firstPassScore: aiFlavorFirstPass ? aiFlavorFirstPass.score : null,
            secondPassScore: aiFlavorSecondPass ? aiFlavorSecondPass.score : null,
            passedAfter: !!(aiFlavorSecondPass && aiFlavorSecondPass.passed)
          };
        }
        finalizeUsage('completed');
      }

      /**
       * 发起上游流式请求。opts.passthrough=false 时不向前端透传（两遍模式第一遍缓冲），
       * opts.onStreamEnd/onError 覆盖默认的收尾行为，opts.fallbackBody 覆盖缓存降级请求体。
       */
      const chatStreamRuntime = createChatStreamRuntime({
        maxResponseBytes: UPSTREAM_MAX_RESPONSE_BYTES, maxBufferBytes: UPSTREAM_SSE_BUFFER_BYTES,
        onLimit: (code, message) => abortUpstreamRequest(code, code, message, 502),
        onChunk: chunk => {
          if (canWriteResponse()) {
            try { res.write(chunk); } catch (_) { closeClientResponse(); return false; }
          }
        },
        onLine: (line, tail) => { parseStreamLine(line); if (!tail) sendBilling('streaming', false); }
      });
      async function sendUpstream(requestBody, opts) {
        const options = opts || {};
        const pass = options.pass || (secondPassActive ? 2 : 1);
        const isRetry = Boolean(options.isRetry);
        const retryCount = Number(options.retryCount || 0);
        const defaultStage = pass === 2 ? 'second_pass' : (twoPassHumanize ? 'first_pass' : 'single_pass');
        const stage = options.stage || (isRetry ? `${defaultStage}_cache_retry` : defaultStage);
        const attemptId = options.attemptId || `${requestId}_att_p${pass}_seq${++attemptSeq}_${Date.now()}`;
        const passthrough = options.passthrough !== false;
        const fallbackBody = Object.prototype.hasOwnProperty.call(options, 'fallbackBody') ? options.fallbackBody : cacheFallbackBodyObj;
        const onStreamEnd = options.onStreamEnd || (() => finalizeUsage('completed'));
        const onUpstreamError = options.onError || null;

        const recordDispatch = resolveDispatchAttemptRecorder();
        if (typeof recordDispatch !== 'function') {
          console.error('[chat] missing dispatch attempt recorder, failing closed');
          if (pass === 2 || providerRequestSent) {
            if (onUpstreamError) onUpstreamError('dispatch_recorder_missing');
            else finalizeUsage('upstream_error');
            return;
          }
          await immediateReleaseReservation('dispatch_recorder_missing');
          cleanupRequestDeadline();
          releaseSlot();
          if (!responseClosed && !res.headersSent && !res.writableEnded && !res.destroyed) {
            json(res, 500, {
              error: '缺少派发记录器或仓储方法，已中止模型调用',
              code: 'DISPATCH_RECORDER_REQUIRED'
            });
          }
          return;
        }

        let recordResult;
        dispatchPending = true;
        try {
          recordResult = await recordDispatch({
            userId: auth.user.userId || (projectScope && projectScope.stableUserId ? projectScope.stableUserId(auth.user.email) : auth.user.email),
            userEmail: auth.user.email,
            projectId: chatScope && chatScope.projectId || '',
            workspaceId: chatScope && chatScope.workspaceId || '',
            requestId,
            attemptId,
            modelId,
            providerModel: model,
            pass,
            stage,
            reservedCost,
            leaseMs: Math.max(120000, (UPSTREAM_TOTAL_TIMEOUT_MS || 0) + 30000)
          });
        } catch (dispatchErr) {
          dispatchPending = false;
          console.error(`[chat] pass ${pass} dispatch boundary persistence failed:`, dispatchErr && dispatchErr.message || dispatchErr);
          if (pass === 2 || providerRequestSent) {
            if (onUpstreamError) onUpstreamError('dispatch_persistence_failed');
            else finalizeUsage('upstream_error');
            return;
          }
          await immediateReleaseReservation('dispatch_persistence_failed');
          cleanupRequestDeadline();
          releaseSlot();
          if (!responseClosed && !res.headersSent && !res.writableEnded && !res.destroyed) {
            json(res, 500, {
              error: '派发边界持久化失败，已中止模型调用',
              code: 'DISPATCH_PERSISTENCE_FAILED'
            });
          }
          return;
        } finally {
          dispatchPending = false;
        }

        if (finalized || responseClosed) {
          cleanupRequestDeadline();
          releaseSlot();
          if (pass === 2 || providerRequestSent) {
            if (onUpstreamError) onUpstreamError('aborted_during_dispatch');
            else if (!finalized) finalizeUsage(pendingAbortStatus || 'aborted');
          } else {
            if (!finalized) finalizeUsage(pendingAbortStatus || 'aborted');
          }
          if (!res.headersSent && !res.writableEnded && !res.destroyed) {
            json(res, pendingAbortStatus === 'upstream_timeout' ? 504 : 499, {
              error: pendingAbortStatus === 'upstream_timeout' ? '上游模型请求超过服务端总时限' : '客户端已取消请求',
              code: pendingAbortStatus || 'client_closed',
              requestId
            });
          }
          return;
        }

        if (!recordResult || recordResult.ok !== true || recordResult.authorized === false ||
            recordResult.status === 'settled' || recordResult.status === 'released' ||
            recordResult.duplicate === true) {
          console.error(`[chat] dispatch attempt rejected:`, recordResult);
          if (pass === 2 || providerRequestSent) {
            if (onUpstreamError) onUpstreamError('dispatch_unauthorized');
            else finalizeUsage('upstream_error');
            return;
          }
          if (!recordResult || recordResult.status !== 'settled') {
            await immediateReleaseReservation('dispatch_unauthorized');
          }
          cleanupRequestDeadline();
          releaseSlot();
          if (!responseClosed && !res.headersSent && !res.writableEnded && !res.destroyed) {
            json(res, 409, {
              error: '派发未获授权或已被处理，已中止模型调用',
              code: recordResult && recordResult.duplicate ? 'DUPLICATE_DISPATCH_ATTEMPT' : 'DISPATCH_UNAUTHORIZED'
            });
          }
          return;
        }

        if (finalized || responseClosed) return;
        try {
          openUpstream(targetURL, effectiveProxy, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey,
            'Accept': 'text/event-stream', 'Idempotency-Key': requestId, 'X-Molan-Request-Id': requestId
          },
          onResponse: upRes => {
            providerResponseReceived = true;
            if (finalized || responseClosed) { try { upRes.resume(); } catch (_) {} return; }
            const upstreamHttpError = upRes.statusCode < 200 || upRes.statusCode >= 300;
            if (upstreamHttpError) {
              let errorText = '';
              upRes.setEncoding('utf8');
              upRes.on('data', chunk => { errorText += chunk; });
              upRes.on('end', () => {
                if (!cacheFallbackAttempted && fallbackBody && isUnsupportedCacheError(upRes.statusCode, errorText)) {
                  cacheFallbackAttempted = true;
                  sendUpstream(JSON.stringify(fallbackBody), {
                    ...options,
                    isRetry: true,
                    retryCount: retryCount + 1,
                    stage: `${stage}_cache_retry`,
                    attemptId: `${requestId}_att_p${pass}_retry_${retryCount + 1}_${Date.now()}`
                  });
                  return;
                }
                const upstreamMessage = upstreamErrorMessage(upRes.statusCode, errorText);
                const contextError = isContextWindowError(upstreamMessage) || isContextWindowError(errorText);
                if (onUpstreamError) {
                  onUpstreamError(contextError ? 'context_window_exceeded' : 'upstream_error');
                  return;
                }
                finalizeUsage(contextError ? 'context_window_exceeded' : 'upstream_error');
                if (!responseClosed && !res.headersSent && !res.writableEnded && !res.destroyed) {
                  if (contextError) {
                    json(res, 413, {
                      error: contextPlan.fixedPromptExceeded
                        ? '上游模型拒绝了完整 Skill、素材和系统提示，请减少 Skill/素材或切换模型后重试'
                        : '上游模型拒绝了本次上下文，请减少作品上下文或切换模型后重试',
                      code: 'context_window_exceeded',
                      modelId,
                      contextWindowTokens,
                      promptTokens,
                      fixedPromptTokens: contextPlan.fixedPromptTokens,
                      originalDynamicPromptTokens: contextPlan.originalDynamicPromptTokens,
                      dynamicPromptTokens: contextPlan.dynamicPromptTokens,
                      dynamicPromptBudget: contextPlan.dynamicPromptBudget,
                      dynamicPromptTruncated: contextPlan.dynamicPromptTruncated,
                      requiredOutputTokens: contextPlan.requestedMaxTokens,
                      overflowTokens: contextPlan.overflowTokens,
                      fixedPromptExceeded: contextPlan.fixedPromptExceeded,
                      availableCompletionTokens: contextPlan.availableCompletionTokens
                    });
                  } else {
                    json(res, Math.min(599, Math.max(400, upRes.statusCode || 502)), { error: upstreamMessage });
                  }
                }
              });
              upRes.on('error', e => {
                if (finalized || responseClosed) return;
                if (onUpstreamError) { onUpstreamError('upstream_error'); return; }
                finalizeUsage('upstream_error');
                if (!res.headersSent && !res.writableEnded && !res.destroyed) json(res, 502, { error: '上游模型调用失败：' + e.message });
              });
              return;
            }
            // 两遍模式第二遍发起时客户端响应头已发送，此时不得重复 writeHead，
            // 也不重复下发 reserved 计费事件（第一遍已发送），否则触发 ERR_HTTP_HEADERS_SENT 崩溃。
            if (!responseClosed && !res.headersSent && !res.writableEnded && !res.destroyed) {
              const sseHeaders = {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache, no-transform',
                'Connection': 'keep-alive',
                'X-Molan-Model': model,
                'X-Molan-Request-Id': requestId,
                'Access-Control-Expose-Headers': 'X-Molan-Model, X-Molan-Request-Id, X-Molan-Model-Downgraded, X-Molan-Requested-Model, X-Molan-Resolved-Model',
                ...responseCors(res)
              };
              if (isModelDowngraded) {
                sseHeaders['X-Molan-Model-Downgraded'] = 'true';
                sseHeaders['X-Molan-Requested-Model'] = encodeURIComponent(requestedModel);
                sseHeaders['X-Molan-Resolved-Model'] = encodeURIComponent(modelId);
              }
              res.writeHead(200, sseHeaders);
              sendBilling('reserved', true);
              if (!keepAliveTimer) {
                keepAliveTimer = setInterval(() => {
                  if (canWriteResponse() && res.headersSent) {
                    try { res.write(': ping\n\n'); } catch (_) { cleanupKeepAlive(); }
                  } else {
                    cleanupKeepAlive();
                  }
                }, 10000);
                keepAliveTimer.unref();
              }
            }
            upRes.on('data', chunk => {
              chatStreamRuntime.push(chunk, passthrough);
            });
            upRes.on('end', () => {
              if (finalized || responseClosed) return;
              chatStreamRuntime.finish();
              onStreamEnd();
            });
            upRes.on('error', () => {
              if (finalized || responseClosed) return;
              if (onUpstreamError) { onUpstreamError('upstream_error'); return; }
              finalizeUsage('upstream_error');
            });
          }
        }, (err, upstream) => {
          if (err) {
            if (finalized || responseClosed) return;
            if (onUpstreamError) { onUpstreamError('upstream_error'); return; }
            finalizeUsage('upstream_error');
            if (!res.headersSent && !res.writableEnded && !res.destroyed) json(res, 502, { error: '代理连接失败：' + err.message });
            return;
          }
          upstreamRef = upstream;
          if (finalized || responseClosed) { try { upstream.destroy(); } catch (_) {} return; }
          upstream.on('error', e => {
            if (finalized || responseClosed) return;
            if (onUpstreamError) { onUpstreamError('upstream_error'); return; }
            finalizeUsage('upstream_error');
            if (!res.headersSent && !res.writableEnded && !res.destroyed) json(res, 502, { error: '上游模型调用失败：' + e.message });
          });
          upstream.once('finish', () => { providerRequestSent = true; });
          upstream.write(requestBody); upstream.end();
        });
      } catch (syncErr) {
        console.error('[chat] synchronous openUpstream throw:', syncErr && syncErr.message || syncErr);
        if (pass === 2 || providerRequestSent) {
          if (onUpstreamError) onUpstreamError('upstream_sync_throw');
          else finalizeUsage('upstream_error');
          return;
        }
        finalizeUsage('upstream_error');
        cleanupRequestDeadline();
        releaseSlot();
        if (!responseClosed && !res.headersSent && !res.writableEnded && !res.destroyed) {
          json(res, 502, { error: '上游调用同步异常：' + (syncErr && syncErr.message || syncErr) });
        }
        return;
      }
    }
      requestDeadlineTimer = setTimeout(() => {
        abortUpstreamRequest('upstream_timeout', 'upstream_timeout', '上游模型请求超过服务端总时限', 504);
      }, UPSTREAM_TOTAL_TIMEOUT_MS);
      requestDeadlineTimer.unref();
      // 两遍模式：第一遍缓冲不透传，流结束后按 AI 味检测结果决定下发初稿或触发改写遍。
      sendUpstream(body, twoPassHumanize
        ? { pass: 1, stage: 'first_pass', attemptId: `${requestId}_att_p1_1_${Date.now()}`, passthrough: false, onStreamEnd: handleFirstPassEnd }
        : { pass: 1, stage: 'single_pass', attemptId: `${requestId}_att_p1_1_${Date.now()}` }
      );
    }).catch(e => {
      releaseSlot();
      console.error('[chat] request failed:', e && e.stack || e);
      respondError(res, e);
    });
  }

  /* 平台模型列表（不含密钥，安全下发前端） */
  return { handleChat };
}

module.exports = { createChatService, resolveUpstreamModelForReasoning };
