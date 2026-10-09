'use strict';

const nodeCrypto = require('node:crypto');

/**
 * 递归裁剪拆书迁移包的深层嵌套数据，保证单字段不超过预算限制。
 */
function compactDissectionTransferValue(value, profile, depth) {
  const currentDepth = Number(depth) || 0;
  const maxDepth = Number(profile.maxDepth) || 3;
  const maxArray = Number(profile.maxArray) || 8;
  const maxKeys = Number(profile.maxKeys) || 16;
  const maxString = Number(profile.maxString) || 400;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > maxString ? value.slice(0, maxString) + '...' : value;
  if (typeof value !== 'object') return value;
  if (currentDepth >= maxDepth) return '[nested content omitted]';
  if (Array.isArray(value)) return value.slice(0, maxArray).map(item => compactDissectionTransferValue(item, profile, currentDepth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, maxKeys).map(([key, item]) => [key, compactDissectionTransferValue(item, profile, currentDepth + 1)]));
}

/**
 * 将任意对象紧凑序列化为不超过指定字数的 JSON 字符串。
 */
function dissectionTransferJson(value, maxChars) {
  const limit = Math.max(240, Number(maxChars) || 1200);
  const profiles = [
    { maxDepth: 4, maxArray: 24, maxKeys: 32, maxString: 800 },
    { maxDepth: 3, maxArray: 12, maxKeys: 20, maxString: 420 },
    { maxDepth: 2, maxArray: 6, maxKeys: 10, maxString: 180 }
  ];
  for (const profile of profiles) {
    try {
      const text = JSON.stringify(compactDissectionTransferValue(value, profile, 0));
      if (text && text.length <= limit) return text;
    } catch (_) {}
  }
  return JSON.stringify({ status: 'omitted', reason: 'field exceeds transfer budget' });
}

/**
 * 构造拆书结果的 Markdown 全文。
 */
function dissectionMarkdown(record, resultViewFn) {
  const viewFn = typeof resultViewFn === 'function' ? resultViewFn : (res => res);
  const result = viewFn(record.result);
  const lines = ['# ' + record.title, '', '> 拆书模式：' + record.depth + ' · 样本：' + (record.meta && record.meta.sampleCount || 0) + ' 个片段', ''];
  const add = (title, value) => { lines.push('## ' + title, '', typeof value === 'string' ? value : '```json\n' + JSON.stringify(value || [], null, 2) + '\n```', ''); };
  add('概览', result.overview); add('全书框架', result.framework);
  add('结构划分（起承转合）', result.storyStructure);
  add('开篇节奏', result.opening); add('金手指', result.goldenFinger); add('文章架构', result.architecture);
  add('人物', result.characters); add('反派体系', result.antagonists); add('次要功能角色', result.minorRoles);
  add('关系', result.relationships);
  add('世界观', result.worldbuilding); add('时间线', result.timeline); add('大纲', result.outline); add('伏笔', result.foreshadowing);
  add('可迁移文风', result.styleProfile); add('创作技法', result.craftConstraints); add('证据账本', result.evidenceLedger);
  add('作者 DNA', result.authorDna);
  add('反转套路', result.reversalPatterns);
  add('新书规划资产', {
    mainline: result.mainline,
    characterLibrary: result.characterLibrary,
    worldRules: result.worldRules,
    storyTree: result.storyTree,
    conflictChain: result.conflictChain,
    rewardChain: result.rewardChain,
    volumePlan: result.volumePlan,
    arcPlan: result.arcPlan,
    chapterPlan: result.chapterPlan,
    scenePlan: result.scenePlan,
    foreshadowPlan: result.foreshadowPlan,
    reviewPlan: result.reviewPlan
  });
  add('题材与卖点', { genre: result.genre, sellingPoints: result.sellingPoints });
  add('情绪与爽点', result.emotion);
  add('冲突统计', result.conflictStats);
  add('章节目录', result.chapterIndex);
  add('可复用模板', result.reusableTemplates);
  add('句式指纹', result.sentenceFingerprint);
  add('逻辑漏洞', result.logicFlaws);
  lines.push('## 边界说明', '', '原书专属的角色、剧情、世界观和术语不会自动导入新小说；仿写默认只应用已确认的文风与创作技法。');
  return lines.join('\n');
}

/**
 * 拆书领域处理器工厂
 * @param {object} deps - 显式依赖注入表
 * @returns {object} 包含所有拆书路由处理器的方法映射
 */
function createDissectionHandlers(deps) {
  const {
    json,
    readBody,
    respondError,
    requestError,
    decodePathParam,
    responseCors,
    getAuthUser,
    requireSqliteForPublic,
    POSTGRES_MODE,
    dbReady,
    getUserByEmail,
    postgresRepository,
    loadDissectionRecord,
    loadDissectionRecordAsync,
    saveDissectionRecordAsync,
    updateDissectionRecord,
    insertDissectionRecord,
    findCachedDissectionRecord,
    acquireDissectionUserSlot,
    releaseDissectionUserSlot,
    activeDissections,
    deleteDissectionCascade,
    dissectionRecordsFromJson,
    writeJsonFile,
    DISSECTION_FILE,
    dissectionRecordFromDb,
    migrateLegacyPipelineRecord,
    dissectionPublicRecord,
    textExtract,
    normalizeDissectionInput,
    buildDissectionChunks,
    chooseDissectionChunks,
    dissectionContext,
    dissectionWordCount,
    estimateBillingTokens,
    pipelineEstimatedTokensFor,
    creditCostForUser,
    resolveModelForUser,
    currentDefaultModel,
    dissectionId,
    emptyDissectionResult,
    dissectionResultView,
    dissectionResultHasCompleteContent,
    firstIncompleteDissectionPhase,
    dissectionPhaseIdsForDepth,
    pipelineEnabled,
    initializeDissectionPipeline,
    startDissectionJob,
    dissectionSkillRecord,
    dissectionSkillPromptFiles,
    dissectionSkillAuditPayload,
    SKILL_AUDIT_VERSION,
    callMolanChat,
    safeJsonParse,
    dissectionContextForChapter,
    getPostgresDissectionPipelineStore,
    deterministicContractValidation,
    pipelineBatchCharsFor,
    checkForbiddenTerms,
    dissectionDocx,
    queryParamsFromUrl,
    projectScope,
    buildDissectionEntities,
    buildDissectionEvents,
    buildEntityStates,
    buildEventEdges,
    storeDissectionForeshadows,
    loadDissectionUnits,
    createDissectionBatches,
    dissectionPipelineStats,
    getPostgresDissectionReadService,
    syncCharactersToLibrary,
    dissectionQueryHandlers = {},
    DISSECTION_MAX_BODY_BYTES = 25 * 1024 * 1024,
    DISSECTION_MAX_SOURCE_CHARS = 3000000,
    PIPELINE_MIN_CHAPTERS = 20
  } = deps;

  const crypto = deps.crypto || nodeCrypto;
  const getDb = () => (typeof deps.getDatabase === 'function' ? deps.getDatabase() : deps.db);

  function handleDissectionExtract(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (!POSTGRES_MODE && !requireSqliteForPublic(req, res)) return;
    return readBody(req, 25 * 1024 * 1024).then(body => {
      const name = String((body && body.name) || '').slice(0, 200);
      const base64 = String((body && body.base64) || '');
      if (!textExtract.isExtractable(name)) return json(res, 400, { error: '仅支持 DOCX / EPUB 文件，PDF 与图片因 OCR 误差已被拒绝' });
      let buffer;
      try { buffer = Buffer.from(base64, 'base64'); } catch (_) { return json(res, 400, { error: '文件数据无效' }); }
      if (!buffer.length) return json(res, 400, { error: '文件为空' });
      return textExtract.extractDocument(name, buffer).then(out => {
        json(res, 200, { ok: true, text: out.text, title: out.title, format: out.format });
      }).catch(err => {
        const msg = String((err && err.message) || err || '解析失败');
        json(res, 400, { error: /PDF|IMAGE/i.test(msg) ? 'PDF 与图片因 OCR 误差已被拒绝，请上传 DOCX / EPUB / TXT' : ('文件解析失败：' + msg) });
      });
    }).catch(e => respondError(res, e));
  }

  function handleDissectionCreate(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录后再使用拆书功能' });
    if (!requireSqliteForPublic(req, res)) return;
    let userSlotHeld = false;
    readBody(req, DISSECTION_MAX_BODY_BYTES).then(body => {
      const sourceInfo = normalizeDissectionInput(body);
      const source = sourceInfo.source;
      if (!source) throw new Error('请上传至少一个文本文件或粘贴正文');
      if (source.length > DISSECTION_MAX_SOURCE_CHARS) throw requestError(413, '拆书原文过大，当前最多支持约 ' + Math.floor(DISSECTION_MAX_SOURCE_CHARS / 10000) / 100 + ' 万字');
      if (!acquireDissectionUserSlot(auth.user.email)) return json(res, 409, { error: '你已有正在运行的拆书任务，请完成或取消后再创建新的任务' });
      userSlotHeld = true;
      const sourceType = ['file', 'folder', 'text'].includes(String(body.sourceType || '')) ? String(body.sourceType) : (Array.isArray(body.files) && body.files.length > 1 ? 'folder' : 'text');
      const depth = ['quick', 'standard', 'deep'].includes(String(body.depth || '')) ? String(body.depth) : 'standard';
      const purpose = ['new-writer', 'advanced', 'problem'].includes(String(body.purpose || '')) ? String(body.purpose) : 'new-writer';
      const title = String(body.title || body.sourceName || '未命名拆书').trim().slice(0, 120) || '未命名拆书';
      const selectedModel = resolveModelForUser(auth.user, body.model);
      const skill = dissectionSkillRecord();
      const skillPromptFilesForRun = dissectionSkillPromptFiles(skill);
      const chunks = buildDissectionChunks(source);
      const selected = chooseDissectionChunks(chunks, depth);
      const sampleChars = dissectionContext(selected).length;
      const chapterIds = new Set(chunks.map(chunk => chunk.chapterId).filter(id => /^chapter-/.test(String(id || ''))));
      const chapterCount = chapterIds.size || chunks.length;
      const fileCount = sourceInfo.sourceFiles.filter(file => file.included).length;
      let estimatedTokens = estimateBillingTokens({ task: 'dissection', chars: sampleChars, depth });
      const pipelineCandidate = depth === 'deep' && chapterCount >= PIPELINE_MIN_CHAPTERS;
      if (pipelineCandidate) estimatedTokens = pipelineEstimatedTokensFor({ selectedModel }, chapterCount);
      const now = Date.now();
      const sourceHash = crypto.createHash('sha1').update(source).digest('hex');
      const cached = findCachedDissectionRecord(auth.user.email, sourceHash, depth, purpose, auth.user.userId);
      if (cached) {
        const cachedRecord = {
          id: dissectionId(), userEmail: auth.user.email, ownerUserId: auth.user.userId, title, sourceType,
          sourceName: String(body.sourceName || title).slice(0, 200), sourceText: source,
          depth, purpose, selectedModel, status: 'completed', phase: 'completed', phaseIndex: 0, progress: 100,
          estimatedCredits: 0, actualCredits: 0,
          result: JSON.parse(JSON.stringify(cached.result || {})),
          meta: {
            wordCount: dissectionWordCount(source), chapterCount, fileCount,
            chunkCount: chunks.length, sampleCount: selected.length, sampleChars,
            removedNoiseChars: sourceInfo.removedNoiseChars || 0,
            sourceFiles: sourceInfo.sourceFiles,
            duplicateFileCount: sourceInfo.duplicateFileCount,
            ignoredFileCount: sourceInfo.ignoredFileCount,
            pastedChars: sourceInfo.pastedChars,
            pastedIncluded: sourceInfo.pastedIncluded,
            sourceHash, cacheHit: true, cachedFrom: cached.id,
            dissectionSkill: { id: skill.id, name: skill.name || skill.id, auditVersion: SKILL_AUDIT_VERSION }
          }, error: '', cancelRequested: false, createdAt: now, updatedAt: now
        };
        insertDissectionRecord(cachedRecord);
        releaseDissectionUserSlot(auth.user.email);
        userSlotHeld = false;
        return json(res, 202, { ok: true, cached: true, cachedFrom: cached.id, task: dissectionPublicRecord(cachedRecord, false) });
      }
      const record = {
        id: dissectionId(), userEmail: auth.user.email, ownerUserId: auth.user.userId, title, sourceType,
        sourceName: String(body.sourceName || title).slice(0, 200), sourceText: source,
        depth, purpose, selectedModel, status: 'queued', phase: 'queued', phaseIndex: 0, progress: 0,
        estimatedCredits: creditCostForUser(auth.user, selectedModel, estimatedTokens), actualCredits: 0,
        result: emptyDissectionResult(), meta: {
          wordCount: dissectionWordCount(source), chapterCount, fileCount,
          chunkCount: chunks.length, sampleCount: selected.length, sampleChars,
          removedNoiseChars: sourceInfo.removedNoiseChars || 0,
          sourceFiles: sourceInfo.sourceFiles,
          duplicateFileCount: sourceInfo.duplicateFileCount,
          ignoredFileCount: sourceInfo.ignoredFileCount,
          pastedChars: sourceInfo.pastedChars,
          pastedIncluded: sourceInfo.pastedIncluded,
          sourceHash,
          stageInput: {}, stageUsage: {}, estimatedTokens,
          dissectionSkill: {
            id: skill.id,
            name: skill.name || skill.id,
            files: Array.isArray(skill.files) ? skill.files : [],
            promptFiles: skillPromptFilesForRun,
            auditVersion: SKILL_AUDIT_VERSION
          }
        }, error: '', cancelRequested: false, createdAt: now, updatedAt: now
      };
      initializeDissectionPipeline(record, pipelineCandidate);
      insertDissectionRecord(record);
      const token = String(req.headers.authorization || '');
      setImmediate(() => startDissectionJob(record.id, auth.user.email, token));
      userSlotHeld = false;
      json(res, 202, { ok: true, task: dissectionPublicRecord(record, false) });
    }).catch(e => {
      if (userSlotHeld) {
        releaseDissectionUserSlot(auth.user.email);
        userSlotHeld = false;
      }
      respondError(res, e);
    });
  }

  function handleDissectionList(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (!requireSqliteForPublic(req, res)) return;
    const userId = String(auth.user.userId || projectScope.stableUserId(auth.user.email)).trim();
    const email = String(auth.user.email || '').trim().toLowerCase();
    let rows;
    const db = getDb();
    if (dbReady() && db) rows = db.prepare(`SELECT * FROM dissections
      WHERE owner_user_id = ? OR (owner_user_id = '' AND user_email = ?)
      ORDER BY updated_at DESC LIMIT 50`).all(userId, email).map(dissectionRecordFromDb).map(migrateLegacyPipelineRecord);
    else rows = dissectionRecordsFromJson().filter(item => item.ownerUserId === userId || !item.ownerUserId && item.userEmail === email).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50).map(migrateLegacyPipelineRecord);
    json(res, 200, { ok: true, tasks: rows.map(row => dissectionPublicRecord(row, false)) });
  }

  function handleDissectionGet(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (!requireSqliteForPublic(req, res)) return;
    const record = loadDissectionRecord(id, auth.user.email);
    if (!record) return json(res, 404, { error: '拆书任务不存在或无权访问' });
    json(res, 200, { ok: true, task: dissectionPublicRecord(record) });
  }

  function handleDissectionCancel(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (!requireSqliteForPublic(req, res)) return;
    const record = loadDissectionRecord(id, auth.user.email);
    if (!record) return json(res, 404, { error: '拆书任务不存在或无权访问' });
    if (['completed', 'failed', 'cancelled'].includes(record.status)) return json(res, 200, { ok: true, task: dissectionPublicRecord(record) });
    const wasQueued = record.status === 'queued';
    record.cancelRequested = true;
    record.status = 'cancelled';
    record.error = '任务已取消，可从当前阶段继续';
    updateDissectionRecord(record);
    const active = activeDissections && activeDissections.get(id);
    if (active) active.controller.abort();
    else if (wasQueued) releaseDissectionUserSlot(auth.user.email);
    json(res, 200, { ok: true, task: dissectionPublicRecord(record) });
  }

  function handleDissectionRetry(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (!requireSqliteForPublic(req, res)) return;
    const record = loadDissectionRecord(id, auth.user.email);
    if (!record) return json(res, 404, { error: '拆书任务不存在或无权访问' });
    if (activeDissections && activeDissections.has(id)) return json(res, 409, { error: '任务仍在停止，请稍后再重试' });
    const incompleteCompleted = record.status === 'completed' && !dissectionResultHasCompleteContent(record.result, record.depth);
    if (!['failed', 'cancelled', 'interrupted', 'needs_review'].includes(record.status) && !incompleteCompleted) return json(res, 409, { error: '当前任务不需要重试' });
    if (!acquireDissectionUserSlot(auth.user.email)) return json(res, 409, { error: '你已有正在运行的拆书任务，请完成或取消后再重试' });
    let retrySlotHeld = true;
    try {
      if (pipelineEnabled(record)) {
        record.phaseIndex = 0;
        record.phase = 'extract';
        record.progress = 0;
      } else {
        const retryIndex = firstIncompleteDissectionPhase(record.result, record.depth);
        record.phaseIndex = retryIndex;
        const phaseIds = dissectionPhaseIdsForDepth(record.depth);
        record.phase = phaseIds[retryIndex] || phaseIds[phaseIds.length - 1] || 'validate';
        record.progress = Math.min(99, Math.round(retryIndex / Math.max(1, phaseIds.length) * 100));
      }
      record.meta = { ...(record.meta || {}), stageUsage: { ...(record.meta && record.meta.stageUsage || {}) }, retryCount: Math.max(0, Number(record.meta && record.meta.retryCount) || 0) + 1 };
      record.status = 'queued';
      record.error = '';
      record.cancelRequested = false;
      updateDissectionRecord(record);
      setImmediate(() => startDissectionJob(record.id, auth.user.email, String(req.headers.authorization || '')));
      retrySlotHeld = false;
      json(res, 202, { ok: true, task: dissectionPublicRecord(record) });
    } catch (error) {
      if (retrySlotHeld) releaseDissectionUserSlot(auth.user.email);
      respondError(res, error);
    }
  }

  function handleDissectionDelete(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (!requireSqliteForPublic(req, res)) return;
    const record = loadDissectionRecord(id, auth.user.email);
    const active = activeDissections && activeDissections.get(id);
    if (active) active.controller.abort();
    let deleted = 0;
    if (dbReady()) deleted = deleteDissectionCascade(id, auth.user.email);
    else {
      const previous = dissectionRecordsFromJson();
      const next = previous.filter(item => !(item.id === id && item.userEmail === auth.user.email));
      deleted = previous.length - next.length;
      if (deleted) writeJsonFile(DISSECTION_FILE, next);
    }
    if (!active && deleted > 0 && record && record.status === 'queued') releaseDissectionUserSlot(auth.user.email);
    json(res, 200, { ok: true });
  }

  function handleDissectionExport(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (!requireSqliteForPublic(req, res)) return;
    const record = loadDissectionRecord(id, auth.user.email);
    if (!record) return json(res, 404, { error: '拆书任务不存在或无权访问' });
    if (record.status !== 'completed' || !dissectionResultHasCompleteContent(record.result, record.depth)) return json(res, 409, { error: '拆书结果不完整，请先重新分析' });
    const format = new URL(req.url, 'http://localhost').searchParams.get('format') || 'json';
    if (format === 'markdown') {
      const body = dissectionMarkdown(record, dissectionResultView);
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="dissection-' + record.id + '.md"', 'Content-Length': Buffer.byteLength(body), ...responseCors(res) });
      return res.end(body);
    }
    if (format === 'docx') {
      try {
        const body = dissectionDocx.buildDissectionDocx(record, dissectionResultView(record.result));
        res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': 'attachment; filename="dissection-' + record.id + '.docx"', 'Content-Length': body.length, ...responseCors(res) });
        return res.end(body);
      } catch (e) { return json(res, 500, { error: 'Word 导出失败：' + String((e && e.message) || e) }); }
    }
    const body = JSON.stringify({ ...dissectionPublicRecord(record), sourceText: undefined }, null, 2);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="dissection-' + record.id + '.json"', 'Content-Length': Buffer.byteLength(body), ...responseCors(res) });
    res.end(body);
  }

  async function handleDissectionApply(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (!POSTGRES_MODE && !requireSqliteForPublic(req, res)) return;
    let body = {};
    if (POSTGRES_MODE) body = await readBody(req);
    else { try { body = await readBody(req).catch(() => ({})); } catch (_) {} }
    const record = await loadDissectionRecordAsync(id, auth.user.email, auth.user.userId);
    if (!record) return json(res, 404, { error: '拆书任务不存在或无权访问' });
    if (record.status !== 'completed' || !dissectionResultHasCompleteContent(record.result, record.depth)) return json(res, 409, { error: '拆书结果不完整，请先重新分析' });
    const result = dissectionResultView(record.result);
    json(res, 200, {
      ok: true,
      mode: 'portable-profile',
      styleProfile: result.styleProfile || {},
      authorDna: result.authorDna || {},
      craftConstraints: result.craftConstraints || [],
      opening: result.opening || {},
      goldenFinger: result.goldenFinger || {},
      architecture: result.architecture || {},
      framework: result.framework || {},
      outline: result.outline || [],
      foreshadowing: result.foreshadowing || [],
      genre: result.genre || {},
      sellingPoints: result.sellingPoints || [],
      reusableTemplates: result.reusableTemplates || {},
      characterLibrary: result.characterLibrary || result.characters || [],
      mainline: result.mainline || {},
      worldRules: result.worldRules || [],
      storyTree: result.storyTree || [],
      conflictChain: result.conflictChain || [],
      rewardChain: result.rewardChain || [],
      volumePlan: result.volumePlan || [],
      arcPlan: result.arcPlan || [],
      chapterPlan: result.chapterPlan || [],
      scenePlan: result.scenePlan || [],
      foreshadowPlan: result.foreshadowPlan || result.foreshadowing || [],
      reviewPlan: result.reviewPlan || {},
      canonConstraints: [],
      sourceBoundary: { excluded: true, note: '只返回可迁移内容，不带入原书专属人物、地点、剧情、物品和术语' }
    });
  }

  async function handleDissectionCreativeBrief(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (!POSTGRES_MODE && !requireSqliteForPublic(req, res)) return;
    const record = await loadDissectionRecordAsync(id, auth.user.email, auth.user.userId);
    if (!record) return json(res, 404, { error: '拆书任务不存在或无权访问' });
    if (!record.result || !dissectionResultHasCompleteContent(record.result, record.depth)) return json(res, 409, { error: '拆书结果不完整，请先重新分析' });
    const result = dissectionResultView(record.result);
    let body = {};
    if (POSTGRES_MODE) body = await readBody(req);
    else try { body = await readBody(req).catch(() => ({})); } catch (_) {}
    const genre = String(body.genre || '').trim();
    const direction = String(body.direction || '').trim();
    const keepLevel = String(body.keepLevel || 'skin');
    const keepText = keepLevel === 'adapt'
      ? '适度改编：保持整体架构与金手指成长逻辑，可微调开篇角度、配角设定与部分支线'
      : keepLevel === 'big'
        ? '大幅创新：保持核心成长曲线与节奏结构，可调整金手指细节与世界观设定'
        : '换皮微创新：开篇节奏、金手指机制、整体架构与节奏结构基本保持一致，仅替换皮相并做微创新';
    const genreText = (!genre || genre === '__same__' || genre === '与原作一致') ? '与原作一致（完全保留骨架与题材，只换皮）' : ('用户选择题材：' + genre);
    const transferBlock = [
      '【题材】' + dissectionTransferJson(result.genre || {}, 600),
      '【开篇节奏】' + dissectionTransferJson(result.opening || {}, 1000),
      '【金手指机制】' + dissectionTransferJson(result.goldenFinger || {}, 1000),
      '【文章架构】' + dissectionTransferJson(result.architecture || {}, 1000),
      '【作者 DNA】' + dissectionTransferJson(result.authorDna || {}, 1200),
      '【情绪与爽点】' + dissectionTransferJson(result.emotion || {}, 1000),
      '【证据账本】' + dissectionTransferJson(result.evidenceLedger || [], 800),
      '【卖点】' + dissectionTransferJson((result.sellingPoints || []).slice(0, 5), 600),
      '【可复用模板】' + dissectionTransferJson(result.reusableTemplates || {}, 1000),
      '【未回收伏笔数】' + (Array.isArray(result.foreshadowing) ? result.foreshadowing.filter(f => ['planned', 'partial', 'abandoned', 'planted'].includes(f.status)).length : 0)
    ].join('\n');
    const user = POSTGRES_MODE ? auth.user : (getUserByEmail ? getUserByEmail(auth.user.email) : null) || { email: auth.user.email };
    const { json: briefJson } = await callMolanChat(String(req.headers.authorization || ''), user, {
      thinking: false, reasoningEffort: 'none',
      system: '你是资深网文新书策划师。基于原书拆书观察，为一部"换皮微创新"新作生成完整创作包，只返回 JSON。严格区分可迁移的作者 DNA/结构功能与原书专属 canon：只迁移写法、节奏、冲突机制和读者回报，不得把原书人物、地点、势力、物品、术语、事件顺序写进新书。硬性要求：1) forbiddenCopy 必须显式列出原书专属禁止复制项；2) 新书世界观、人物、关系、地图、金手指具体机制和剧情节点全部原创；3) 人物必须有目标、缺陷、阻力和弧光；4) 主线、故事树、冲突链、回报链必须能落到章节和场景；5) 所有规则/判断附适用范围、证据引用和置信度，证据不足标 candidate；6) 不输出原文长摘录；7) 各字段内容精炼扼要，数组每项简明扼要，输出紧凑有效 JSON。',
      userPrompt: genreText + '；' + keepText + '；微创新方向：' + (direction || '仅做适度微创新') + '\n\n可迁移拆书观察（各字段已在结构边界内压缩，未切断 JSON）：\n' + transferBlock + '\n\n输出格式：{"brief":{"targetGenre":"","targetReader":"","pacingModel":"","openingApproach":"","conflictEscalation":"","growthReward":"","transferableStyle":[""],"forbiddenCopy":["原书专属禁止项"],"microInnovation":"","userGenre":"' + genre + '"},"authorDna":{"summary":"","dimensions":[{"name":"","observation":"","transferable":true,"scope":[],"exceptions":[],"evidenceRefs":[],"confidence":0.7}],"rules":[{"axis":"","rule":"","ruleType":"preference","scope":[],"exceptions":[],"evidenceRefs":[],"confidence":0.7,"status":"candidate"}],"forbiddenPatterns":[],"unknowns":[],"confidence":0.7},"worldbuilding":[{"category":"","name":"","detail":"","function":""}],"characterLibrary":[{"name":"","role":"","goal":"","flaw":"","arc":"","relationships":[]}],"mainline":{"premise":"","goal":"","escalation":"","endingPromise":""},"storyTree":[{"node":"","parent":"","goal":"","conflict":"","result":"","chapterRange":""}],"conflictChain":[{"stage":"","source":"","pressure":"","choice":"","cost":"","chapterRange":""}],"rewardChain":[{"stage":"","setup":"","payoff":"","cost":"","chapterRange":""}],"volumePlan":[{"volume":"","goal":"","turningPoint":"","endingHook":""}],"arcPlan":[{"arc":"","goal":"","opposition":"","turn":"","payoff":"","chapterRange":""}],"chapterPlan":[{"chapterNo":1,"title":"","goal":"","protagonistAction":"","opposition":"","informationChange":"","result":"","hook":"","line":""}],"scenePlan":[{"chapterNo":1,"sceneNo":1,"purpose":"","viewpoint":"","goal":"","conflict":"","turn":"","exitHook":""}],"foreshadowPlan":[{"id":"","plantIn":"","payoffIn":"","desc":"","strength":"medium","status":"planned"}],"reviewPlan":{"layers":["structure","worldbuilding","characters","mainline","conflict","reward","chapter","originality"],"checks":[{"layer":"","check":"","passCriteria":""}]},"creationNotes":""}',
      maxTokens: 3500, jsonMode: true, modelId: currentDefaultModel() || 'gpt-5.6-luna', internalModel: true, temperature: 0.5, stage: 'skill_analysis', skillAudit: dissectionSkillAuditPayload ? dissectionSkillAuditPayload() : undefined
    });
    if (briefJson && briefJson.brief) {
      record.meta = { ...(record.meta || {}), creativeBrief: { ...briefJson, sourceDissectionId: id, createdAt: Date.now() } };
      await saveDissectionRecordAsync({ ...record, expectedRevision: record.revision });
    }
    json(res, 200, { ok: !!(briefJson && briefJson.brief), brief: briefJson && briefJson.brief ? briefJson : { error: '简报生成失败，请重试' } });
  }

  async function handleDissectionCreationContext(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const record = await loadDissectionRecordAsync(id, auth.user.email, auth.user.userId);
    if (!record) return json(res, 404, { error: '拆书任务不存在或无权访问' });
    const q = queryParamsFromUrl(req.url);
    const chapterNo = Number(q.chapterNo) || 0;
    const snapshot = POSTGRES_MODE
      ? await getPostgresDissectionPipelineStore().dissectionContextForChapter(record, chapterNo)
      : dissectionContextForChapter(record, chapterNo);
    json(res, 200, { ok: true, context: snapshot });
  }

  async function handleDissectionChapterContract(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const record = await loadDissectionRecordAsync(id, auth.user.email, auth.user.userId);
    if (!record) return json(res, 404, { error: '拆书任务不存在或无权访问' });
    let body = {};
    if (POSTGRES_MODE) body = await readBody(req);
    else try { body = await readBody(req).catch(() => ({})); } catch (_) {}
    const chapterNo = Math.max(1, Number(body.chapterNo) || 1);
    const snapshot = POSTGRES_MODE
      ? await getPostgresDissectionPipelineStore().dissectionContextForChapter(record, body.upTo || chapterNo)
      : dissectionContextForChapter(record, body.upTo || chapterNo);
    const inputBlock = [
      '本章目标：' + String(body.goal || '推进主线 / 深化冲突').slice(0, 200),
      '创作方向：' + String(body.direction || '与既有节奏一致').slice(0, 200),
      '上一章结尾：' + String(body.prevEnding || '').slice(0, 500),
      '当前故事弧：' + JSON.stringify(snapshot.currentArc || snapshot.arcs[0] || {}),
      '相关人物状态：' + JSON.stringify(snapshot.characterStates.slice(0, 8)),
      '未回收伏笔（可埋设/推进/回收）：' + JSON.stringify(snapshot.foreshadows.slice(0, 10)),
      '时间线（近期事件）：' + JSON.stringify(snapshot.timeline.slice(-12))
    ].join('\n');
    const user = POSTGRES_MODE ? auth.user : (getUserByEmail ? getUserByEmail(auth.user.email) : null) || { email: auth.user.email };
    const { json: contract } = await callMolanChat(String(req.headers.authorization || ''), user, {
      thinking: false, reasoningEffort: 'none',
      system: '你是网文章节合同策划师。基于当前故事弧、人物状态、时间线与未回收伏笔，为第 ' + chapterNo + ' 章生成结构化合同。只返回 JSON，字段严格：{chapterNo,goal,protagonistAction,opposition,informationChange,escalation,irreversibleResult,characterStateChanges:[{name,change}],foreshadowActions:[{id,action:"plant|advance|payoff",desc}],continuityInputs:[],continuityOutputs:[],mustAvoid:[]}。mustAvoid 必须包含不能违背的前文事实；未回收伏笔只能选部分在本章推进，不能无证据回收。',
      userPrompt: inputBlock + '\n\n输出严格 JSON，不要解释。',
      maxTokens: 3000, jsonMode: true, modelId: currentDefaultModel() || 'gpt-5.6-luna', internalModel: true, temperature: 0.4, stage: 'skill_analysis', skillAudit: dissectionSkillAuditPayload ? dissectionSkillAuditPayload() : undefined
    });
    if (!contract || !contract.goal) return json(res, 200, { ok: false, error: '合同生成失败，请重试' });
    const validation = deterministicContractValidation(contract);
    json(res, 200, { ok: true, contract: { ...contract, chapterNo }, validation });
  }

  async function handleDissectionAudit(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const record = await loadDissectionRecordAsync(id, auth.user.email, auth.user.userId);
    if (!record) return json(res, 404, { error: '拆书任务不存在或无权访问' });
    let body = {};
    if (POSTGRES_MODE) body = await readBody(req);
    else try { body = await readBody(req).catch(() => ({})); } catch (_) {}
    const chapterNo = Math.max(1, Number(body.chapterNo) || 1);
    const content = String(body.content || '');
    const contract = (body.contract && typeof body.contract === 'object') ? body.contract : {};
    const snapshot = POSTGRES_MODE
      ? await getPostgresDissectionPipelineStore().dissectionContextForChapter(record, body.upTo || chapterNo)
      : dissectionContextForChapter(record, body.upTo || chapterNo);
    const auditBudget = Math.max(12000, Math.min(30000, pipelineBatchCharsFor ? pipelineBatchCharsFor(record) : 12000));
    const auditText = content.length <= auditBudget
      ? content
      : [
        '【正文开头】\n' + content.slice(0, Math.floor(auditBudget / 3)),
        '【正文中段】\n' + content.slice(Math.floor((content.length - auditBudget / 3) / 2), Math.floor((content.length + auditBudget / 3) / 2)),
        '【正文结尾】\n' + content.slice(-Math.floor(auditBudget / 3))
      ].join('\n\n');
    const auditInput = [
      '待审计正文（原文 ' + content.length + ' 字，送审覆盖 ' + auditText.length + ' 字；超长正文按开头/中段/结尾分段保留）：\n' + auditText,
      '本章合同：' + JSON.stringify(contract).slice(0, 2500),
      '人物状态基线（审计前）：' + JSON.stringify(snapshot.characterStates.slice(0, 10)),
      '未回收伏笔台账：' + JSON.stringify(snapshot.foreshadows.slice(0, 15)),
      '时间线（前文事实）：' + JSON.stringify(snapshot.timeline.slice(-15))
    ].join('\n');
    const user = POSTGRES_MODE ? auth.user : (getUserByEmail ? getUserByEmail(auth.user.email) : null) || { email: auth.user.email };
    const { json: audit } = await callMolanChat(String(req.headers.authorization || ''), user, {
      thinking: false, reasoningEffort: 'none',
      system: '你是网文连续性审计师。对照章节合同、人物状态、时间线事实与伏笔台账，检查正文的连续性错误。只返回 JSON：{passed:boolean,issues:[{severity:"blocker|warning|info",category:"continuity|character|timeline|foreshadow|style|other",position:"",description:"",suggestion:""}],summary:"",revisionHint:"若存在 blocker 级问题，给出定向重写建议"}。只有所有 blocker 级问题都为零才允许 passed=true；伏笔只有在正文明确给出回收证据时才算回收。',
      userPrompt: auditInput + '\n\n输出严格 JSON，不要解释。',
      maxTokens: 3000, jsonMode: true, modelId: currentDefaultModel() || 'gpt-5.6-luna', internalModel: true, temperature: 0.2, stage: 'skill_analysis', skillAudit: dissectionSkillAuditPayload ? dissectionSkillAuditPayload() : undefined
    });
    const issues = (audit && Array.isArray(audit.issues)) ? audit.issues : [];
    const forbidden = (body && Array.isArray(body.forbiddenCopy)) ? body.forbiddenCopy : [];
    if (forbidden.length && checkForbiddenTerms) issues.push(...checkForbiddenTerms(content, forbidden));
    const blockers = issues.filter(i => String(i.severity) === 'blocker');
    json(res, 200, {
      ok: true,
      audit: {
        passed: !!audit && blockers.length === 0,
        summary: (audit && audit.summary) || '',
        revisionHint: (audit && audit.revisionHint) || '',
        issues: issues.slice(0, 40),
        blockerCount: blockers.length
      }
    });
  }

  async function handleDissectionRebuild(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const record = await loadDissectionRecordAsync(id, auth.user.email, auth.user.userId);
    if (!record) return json(res, 404, { error: '拆书任务不存在或无权访问' });
    const stage = String((queryParamsFromUrl(req.url).stage) || 'entity_resolution');
    if (POSTGRES_MODE) {
      const store = getPostgresDissectionPipelineStore();
      let rebuilt;
      if (stage === 'entity_resolution' || stage === 'graph') {
        rebuilt = {
          entities: await store.buildDissectionEntities(record),
          events: await store.buildDissectionEvents(record),
          states: await store.buildEntityStates(record),
          edges: await store.buildEventEdges(record)
        };
        const result = dissectionResultView(record.result);
        if (Array.isArray(result.foreshadowing)) await store.storeDissectionForeshadows(record, result.foreshadowing);
      } else if (stage === 'units') {
        const units = await store.loadDissectionUnits(record);
        rebuilt = { units: units.length, batches: await store.createDissectionBatches(record, units) };
      } else return json(res, 400, { error: '不支持的重建阶段' });
      const stats = await getPostgresDissectionReadService().computeDissectionStats(auth.user.userId, id, record);
      return json(res, 200, { ok: true, stage, rebuilt, stats });
    }
    let rebuilt = null;
    if (stage === 'entity_resolution' || stage === 'graph') {
      rebuilt = { entities: buildDissectionEntities(record), events: buildDissectionEvents(record), states: buildEntityStates(record), edges: buildEventEdges(record) };
      const result = dissectionResultView(record.result);
      if (Array.isArray(result.foreshadowing)) { try { storeDissectionForeshadows(record, result.foreshadowing); } catch (_) {} }
    } else if (stage === 'units') {
      const units = loadDissectionUnits(record.id);
      rebuilt = { units: units.length, batches: createDissectionBatches(record, units) };
    }
    json(res, 200, { ok: true, stage, rebuilt, stats: dissectionPipelineStats(record) });
  }

  async function handleDissectionImitate(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (!POSTGRES_MODE && !requireSqliteForPublic(req, res)) return;
    const record = await loadDissectionRecordAsync(id, auth.user.email, auth.user.userId);
    if (!record) return json(res, 404, { error: '拆书任务不存在或无权访问' });
    if (record.status !== 'completed') return json(res, 409, { error: '请先完成拆书' });
    return readBody(req, 1 * 1024 * 1024).then(body => {
      const r = dissectionResultView(record.result);
      const scene = String(body.scene || '').slice(0, 500);
      const length = Math.min(4000, Math.max(200, Number(body.length) || 800));
      const isOpening = String(body.templateType || '') === 'opening';
      const styleJson = JSON.stringify({
        styleProfile: r.styleProfile, craftConstraints: r.craftConstraints,
        reusableTemplates: r.reusableTemplates, opening: r.opening, goldenFinger: r.goldenFinger, genre: r.genre
      });
      const system = '你是模仿写作助手。给定一部小说的可迁移文风画像、创作技法与模板，请严格模仿其风格写一段约' + length + '字的中文' + (isOpening ? '开篇' : '场景') + '。只返回 JSON：{passage:"模仿正文（纯文本，不要解释、不要标题）", techniqueNotes:["应用的技法/模板"], appliedTemplates:["使用的模板名"]}。禁止复制原书专有名词与长段落，只迁移文风与技法。';
      const userPrompt = '可迁移素材：\n' + styleJson + '\n\n写作要求：' + (scene || ('一个体现该文风典型节奏的' + (isOpening ? '开篇章节' : '场景'))) + '\n字数约：' + length;
      const user = POSTGRES_MODE ? auth.user : (getUserByEmail ? getUserByEmail(auth.user.email) : null) || { email: auth.user.email };
      return callMolanChat(String(req.headers.authorization || ''), user, {
        system, userPrompt, maxTokens: Math.ceil(length * 2.4), jsonMode: true, modelId: currentDefaultModel() || 'gpt-5.6-luna', internalModel: true, temperature: 0.85
      }).then(out => {
        const j = out.json || safeJsonParse(out.text) || {};
        json(res, 200, {
          ok: true,
          passage: String(j.passage || out.text || '').slice(0, 9000),
          techniqueNotes: Array.isArray(j.techniqueNotes) ? j.techniqueNotes.slice(0, 10) : [],
          appliedTemplates: Array.isArray(j.appliedTemplates) ? j.appliedTemplates.slice(0, 10) : []
        });
      }).catch(e => json(res, 502, { error: '仿写失败：' + String((e && e.message) || e) }));
    }).catch(e => respondError(res, e));
  }

  async function handleDissectionDiagnose(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (!POSTGRES_MODE && !requireSqliteForPublic(req, res)) return;
    const record = await loadDissectionRecordAsync(id, auth.user.email, auth.user.userId);
    if (!record) return json(res, 404, { error: '拆书任务不存在或无权访问' });
    if (record.status !== 'completed') return json(res, 409, { error: '请先完成拆书' });
    return readBody(req, 2 * 1024 * 1024).then(body => {
      const r = dissectionResultView(record.result);
      const benchmark = String(body.benchmark || '').slice(0, 6000);
      const focus = String(body.focus || '').slice(0, 200);
      const system = '你是资深小说诊断师。基于拆书结果，从【开篇钩子、节奏密度、人物塑造、冲突设计、情绪与爽点、文风技法】六个维度评估本书，给出可量化评分(0-10)、判定、问题与可执行建议。' + (benchmark ? '同时与用户对标的文本进行对比诊断。' : '') + '只返回 JSON：{overallScore:0-10, dimensions:[{name,score,verdict,issues:[],suggestions:[]}], topRisks:[], actionPlan:[]}。';
      const summary = {
        overview: r.overview, framework: r.framework, opening: r.opening, architecture: r.architecture,
        goldenFinger: r.goldenFinger, characters: r.characters, conflictStats: r.conflictStats, emotion: r.emotion,
        styleProfile: r.styleProfile, sentenceFingerprint: r.sentenceFingerprint, sellingPoints: r.sellingPoints,
        logicFlaws: r.logicFlaws, genre: r.genre
      };
      const userPrompt = '作品标题：' + record.title + '\n拆书结果摘要：\n' + JSON.stringify(summary, null, 1).slice(0, 12000) + (benchmark ? '\n\n对标文本：\n' + benchmark : '') + (focus ? '\n\n重点关注：' + focus : '');
      const user = POSTGRES_MODE ? auth.user : (getUserByEmail ? getUserByEmail(auth.user.email) : null) || { email: auth.user.email };
      return callMolanChat(String(req.headers.authorization || ''), user, {
        system, userPrompt, maxTokens: 4000, jsonMode: true, modelId: currentDefaultModel() || 'gpt-5.6-luna', internalModel: true, temperature: 0.4
      }).then(out => {
        const j = out.json || safeJsonParse(out.text) || {};
        json(res, 200, { ok: true, diagnosis: j });
      }).catch(e => json(res, 502, { error: '诊断失败：' + String((e && e.message) || e) }));
    }).catch(e => respondError(res, e));
  }

  function handleDissectionsCompare(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (!POSTGRES_MODE && !requireSqliteForPublic(req, res)) return;
    return readBody(req, 1 * 1024 * 1024).then(async body => {
      const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(String).filter(Boolean))].slice(0, 6) : [];
      if (ids.length < 2) return json(res, 400, { error: '请至少选择 2 本已完成拆书进行对比' });
      const focus = String(body.focus || '').slice(0, 200);
      const records = (await Promise.all(ids.map(did => loadDissectionRecordAsync(did, auth.user.email, auth.user.userId)))).filter(Boolean);
      if (records.length < 2) return json(res, 404, { error: '找不到足够的拆书记录' });
      if (records.some(record => record.status !== 'completed')) return json(res, 409, { error: '请先完成所选拆书' });
      const books = records.map(rec => {
        const r = dissectionResultView(rec.result);
        const fp = r.sentenceFingerprint || {};
        const cs = r.conflictStats || {};
        return {
          id: rec.id, title: rec.title,
          genre: r.genre, sellingPoints: r.sellingPoints,
          fingerprint: { avgSentenceLen: fp.avgSentenceLen, shortLongRatio: fp.shortLongRatio, dialogueRatio: fp.dialogueRatio, actionRatio: fp.actionRatio },
          conflictTotal: cs.total,
          emotionNote: { sellingPointTypes: (r.emotion && r.emotion.sellingPointTypes) || [], curveSample: (r.emotion && r.emotion.emotionCurve || []).slice(0, 8) },
          framework: r.framework, styleProfile: r.styleProfile,
          charactersCount: Array.isArray(r.characters) ? r.characters.length : 0
        };
      });
      const system = '你是文学对比分析师。对比以下多部作品的拆书结果，输出横向对比报告。只返回 JSON：{summary, matrix:[{id,title,genre,sellingPoints,avgSentenceLen,dialogueRatio,conflictTotal,emotionNote}], byDimension:{题材定位差异,卖点差异,文风量化对比,情绪爽点策略,结构差异}, recommendations:[]}。';
      const userPrompt = '对比重点：' + (focus || '综合差异与各自可借鉴点') + '\n\n作品数据：\n' + JSON.stringify(books, null, 1).slice(0, 14000);
      const user = POSTGRES_MODE ? auth.user : (getUserByEmail ? getUserByEmail(auth.user.email) : null) || { email: auth.user.email };
      return callMolanChat(String(req.headers.authorization || ''), user, {
        system, userPrompt, maxTokens: 4000, jsonMode: true, modelId: currentDefaultModel() || 'gpt-5.6-luna', internalModel: true, temperature: 0.4
      }).then(out => {
        const j = out.json || safeJsonParse(out.text) || {};
        json(res, 200, { ok: true, comparison: j, books });
      }).catch(e => json(res, 502, { error: '对比失败：' + String((e && e.message) || e) }));
    }).catch(e => respondError(res, e));
  }

  function handleDissectionsBatch(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (!requireSqliteForPublic(req, res)) return;
    readBody(req, DISSECTION_MAX_BODY_BYTES).then(body => {
      const tasks = Array.isArray(body.tasks) ? body.tasks.slice(0, 20) : [];
      if (!tasks.length) return json(res, 400, { error: '请提供至少一个拆解任务' });
      const created = [];
      tasks.forEach(task => {
        if (!task || typeof task !== 'object') return;
        const sourceInfo = normalizeDissectionInput(task);
        const source = sourceInfo.source;
        if (!source) return;
        if (source.length > DISSECTION_MAX_SOURCE_CHARS) return;
        const depth = ['quick', 'standard', 'deep'].includes(String(task.depth || '')) ? String(task.depth) : 'standard';
        const purpose = ['new-writer', 'advanced', 'problem'].includes(String(task.purpose || '')) ? String(task.purpose) : 'new-writer';
        const title = String(task.title || task.sourceName || '未命名拆书').trim().slice(0, 120) || '未命名拆书';
        const selectedModel = resolveModelForUser(auth.user, task.model);
        const skill = dissectionSkillRecord();
        const chunks = buildDissectionChunks(source);
        const selected = chooseDissectionChunks(chunks, depth);
        const sampleChars = dissectionContext(selected).length;
        const pipelineCandidate = depth === 'deep' && chunks.length >= PIPELINE_MIN_CHAPTERS;
        const estimatedTokens = pipelineCandidate
          ? pipelineEstimatedTokensFor({ selectedModel }, chunks.length)
          : estimateBillingTokens({ task: 'dissection', chars: sampleChars, depth });
        const now = Date.now();
        const sourceHash = crypto.createHash('sha1').update(source).digest('hex');
        const cached = findCachedDissectionRecord(auth.user.email, sourceHash, depth, purpose, auth.user.userId);
        if (cached) {
          const cachedRecord = {
            id: dissectionId(), userEmail: auth.user.email, ownerUserId: auth.user.userId, title, sourceType: 'text',
            sourceName: String(task.sourceName || title).slice(0, 200), sourceText: source,
            depth, purpose, selectedModel, status: 'completed', phase: 'completed', phaseIndex: 0, progress: 100,
            estimatedCredits: 0, actualCredits: 0,
            result: JSON.parse(JSON.stringify(cached.result || {})),
            meta: {
              wordCount: dissectionWordCount(source), chapterCount: chunks.length, chunkCount: chunks.length,
              sampleCount: selected.length, sampleChars, sourceFiles: [],
              removedNoiseChars: sourceInfo.removedNoiseChars || 0,
              sourceHash, cacheHit: true, cachedFrom: cached.id,
              dissectionSkill: { id: skill.id, name: skill.name || skill.id, auditVersion: SKILL_AUDIT_VERSION }
            }, error: '', cancelRequested: false, createdAt: now, updatedAt: now
          };
          insertDissectionRecord(cachedRecord);
          created.push(dissectionPublicRecord(cachedRecord, false));
          return;
        }
        const record = {
          id: dissectionId(), userEmail: auth.user.email, ownerUserId: auth.user.userId, title, sourceType: 'text',
          sourceName: String(task.sourceName || title).slice(0, 200), sourceText: source,
          depth, purpose, selectedModel, status: 'queued', phase: 'queued', phaseIndex: 0, progress: 0,
          estimatedCredits: creditCostForUser(auth.user, selectedModel, estimatedTokens), actualCredits: 0, result: emptyDissectionResult(),
          meta: {
            wordCount: dissectionWordCount(source), chapterCount: chunks.length, chunkCount: chunks.length,
            sampleCount: selected.length, sampleChars, sourceFiles: [],
            removedNoiseChars: sourceInfo.removedNoiseChars || 0,
            sourceHash, stageInput: {}, stageUsage: {}, estimatedTokens,
            dissectionSkill: { id: skill.id, name: skill.name || skill.id, auditVersion: SKILL_AUDIT_VERSION }
          }, error: '', cancelRequested: false, createdAt: now, updatedAt: now
        };
        initializeDissectionPipeline(record, pipelineCandidate);
        insertDissectionRecord(record);
        created.push(dissectionPublicRecord(record, false));
        setImmediate(() => startDissectionJob(record.id, auth.user.email, String(req.headers.authorization || '')));
      });
      json(res, 202, { ok: true, count: created.length, tasks: created });
    }).catch(e => respondError(res, e));
  }

  function handleDissectionPatch(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (!requireSqliteForPublic(req, res)) return;
    const record = loadDissectionRecord(id, auth.user.email);
    if (!record) return json(res, 404, { error: '拆书任务不存在或无权访问' });
    readBody(req).then(p => {
      if (p.title !== undefined) {
        const title = String(p.title).trim().slice(0, 120);
        if (title) record.title = title;
      }
      const meta = record.meta && typeof record.meta === 'object' ? { ...record.meta } : {};
      if (p.tags !== undefined) {
        const tags = Array.isArray(p.tags) ? p.tags.map(String).map(s => s.trim()).filter(Boolean).slice(0, 20) : [];
        meta.tags = tags;
      }
      if (p.folder !== undefined) meta.folder = String(p.folder).trim().slice(0, 60);
      record.meta = meta;
      updateDissectionRecord(record);
      json(res, 200, { ok: true, task: dissectionPublicRecord(record, false) });
    }).catch(e => respondError(res, e));
  }

  function handleDissectionCharactersSync(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (!requireSqliteForPublic(req, res)) return;
    const record = loadDissectionRecord(id, auth.user.email);
    if (!record) return json(res, 404, { error: '拆书任务不存在或无权访问' });
    if (record.status !== 'completed') return json(res, 409, { error: '请先完成拆书' });
    try {
      const n = syncCharactersToLibrary(record);
      json(res, 200, { ok: true, synced: n });
    } catch (e) {
      json(res, 500, { error: '同步角色失败：' + String((e && e.message) || e) });
    }
  }

  function handleDissectionShare(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (!requireSqliteForPublic(req, res)) return;
    const record = loadDissectionRecord(id, auth.user.email);
    if (!record) return json(res, 404, { error: '拆书任务不存在或无权访问' });
    if (record.status !== 'completed') return json(res, 409, { error: '请先完成拆书再分享' });
    if (!dbReady()) return json(res, 503, { error: '云端存储不可用' });
    const db = getDb();
    if (req.method === 'GET') {
      const rows = db.prepare('SELECT token,dissection_id,user_email,grantee_email,role,expires_at,created_at FROM dissection_shares WHERE dissection_id = ? AND user_email = ? ORDER BY created_at DESC').all(record.id, auth.user.email);
      return json(res, 200, { ok: true, shares: rows.map(r => ({ token: r.token, granteeEmail: r.grantee_email || '', role: r.role || 'view', expiresAt: r.expires_at, createdAt: r.created_at })) });
    }
    readBody(req).then(p => {
      const emails = Array.isArray(p.emails) ? p.emails.map(String).map(s => s.trim().toLowerCase()).filter(Boolean).slice(0, 20) : [];
      const role = ['view', 'edit'].includes(String(p.role || '')) ? String(p.role) : 'view';
      const expires = Date.now() + 30 * 24 * 3600 * 1000;
      const created = [];
      if (emails.length) {
        emails.forEach(email => {
          if (email === auth.user.email.toLowerCase()) return;
          const token = crypto.randomBytes(12).toString('hex');
          db.prepare('INSERT INTO dissection_shares (token,dissection_id,user_email,grantee_email,role,created_at,expires_at) VALUES (?,?,?,?,?,?,?)').run(token, record.id, auth.user.email, email, role, Date.now(), expires);
          created.push({ token, granteeEmail: email, role, shareUrl: '/shared/dissection/' + token, expiresAt: expires });
        });
        return json(res, 200, { ok: true, shares: created });
      }
      const token = crypto.randomBytes(12).toString('hex');
      db.prepare('INSERT INTO dissection_shares (token,dissection_id,user_email,grantee_email,role,created_at,expires_at) VALUES (?,?,?,?,?,?,?)').run(token, record.id, auth.user.email, '', 'view', Date.now(), expires);
      json(res, 200, { ok: true, token, shareUrl: '/shared/dissection/' + token, expiresAt: expires });
    }).catch(e => respondError(res, e));
  }

  function handleDissectionShareDelete(req, res, id, token) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (!requireSqliteForPublic(req, res)) return;
    if (!dbReady()) return json(res, 503, { error: '云端存储不可用' });
    const record = loadDissectionRecord(id, auth.user.email);
    if (!record) return json(res, 404, { error: '拆书任务不存在或无权访问' });
    let shareToken;
    try { shareToken = decodePathParam(token); } catch (error) { return respondError(res, error); }
    const db = getDb();
    const deleted = Number(db.prepare('DELETE FROM dissection_shares WHERE token = ? AND dissection_id = ? AND user_email = ?').run(shareToken, record.id, auth.user.email).changes || 0);
    if (!deleted) return json(res, 404, { error: '分享链接不存在' });
    json(res, 200, { ok: true, token: shareToken });
  }

  async function handleSharedDissectionsList(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (POSTGRES_MODE) {
      const rows = await postgresRepository.runtimeListMemberDissectionShares(auth.user.userId);
      return json(res, 200, { ok: true, shared: rows.map(row => ({
        token: row.share.token, role: row.share.role || 'view', sharedAt: row.share.created_at,
        expiresAt: row.share.expires_at, task: row.task
      })) });
    }
    if (!requireSqliteForPublic(req, res)) return;
    if (!dbReady()) return json(res, 503, { error: '云端存储不可用' });
    const db = getDb();
    const rows = db.prepare("SELECT token,dissection_id,user_email,role,created_at,expires_at FROM dissection_shares WHERE grantee_email = ? AND (expires_at = 0 OR expires_at > ?) ORDER BY created_at DESC LIMIT 100").all(auth.user.email.toLowerCase(), Date.now());
    const items = [];
    rows.forEach(r => {
      const record = loadDissectionRecord(r.dissection_id, r.user_email);
      if (!record || record.status !== 'completed') return;
      items.push({
        token: r.token, role: r.role || 'view', sharedAt: r.created_at, expiresAt: r.expires_at,
        task: { id: record.id, title: record.title, depth: record.depth, wordCount: record.meta && record.meta.wordCount || 0, chapterCount: record.meta && record.meta.chapterCount || 0, updatedAt: record.updatedAt }
      });
    });
    json(res, 200, { ok: true, shared: items });
  }

  async function handleSharedDissectionGet(req, res, token) {
    if (POSTGRES_MODE) {
      const auth = getAuthUser(req) || getAuthUser(req, 'admin');
      const row = await postgresRepository.runtimeReadDissectionShare(auth?.user?.userId || '', token);
      if (!row) return json(res, 404, { error: '分享链接无效或已失效' });
      if (row.access === 'expired') return json(res, 410, { error: '分享链接已过期' });
      if (row.access === 'auth_required') return json(res, 401, { error: '请登录后访问该成员分享' });
      if (row.access !== 'allowed') return json(res, 403, { error: '该分享链接未授权给当前账户' });
      return json(res, 200, { ok: true, shared: { ...row.task, result: dissectionResultView(row.task.result) } });
    }
    if (!dbReady()) return json(res, 503, { error: '云端存储不可用' });
    const db = getDb();
    const row = db.prepare('SELECT * FROM dissection_shares WHERE token = ?').get(token);
    if (!row) return json(res, 404, { error: '分享链接无效或已失效' });
    if (row.expires_at && row.expires_at < Date.now()) return json(res, 410, { error: '分享链接已过期' });
    if (row.grantee_email) {
      const auth = getAuthUser(req) || getAuthUser(req, 'admin');
      const email = auth && auth.user && String(auth.user.email || '').trim().toLowerCase();
      if (!email || email !== String(row.grantee_email || '').trim().toLowerCase()) {
        return json(res, auth ? 403 : 401, { error: auth ? '该分享链接未授权给当前账户' : '请登录后访问该成员分享' });
      }
    }
    const record = loadDissectionRecord(row.dissection_id, row.user_email);
    if (!record) return json(res, 404, { error: '原拆书任务不存在' });
    const r = dissectionResultView(record.result);
    json(res, 200, { ok: true, shared: {
      id: record.id, title: record.title, depth: record.depth,
      meta: { wordCount: record.meta && record.meta.wordCount, chapterCount: record.meta && record.meta.chapterCount, sampleCount: record.meta && record.meta.sampleCount },
      result: r, createdAt: record.createdAt
    } });
  }

  function handleDissectionVersions(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (!requireSqliteForPublic(req, res)) return;
    const record = loadDissectionRecord(id, auth.user.email);
    if (!record) return json(res, 404, { error: '拆书任务不存在或无权访问' });
    const db = getDb();
    if (req.method === 'POST') {
      if (!dbReady()) return json(res, 503, { error: '云端存储不可用' });
      readBody(req).then(p => {
        const label = String((p && p.label) || ('快照 ' + new Date().toLocaleString('zh-CN'))).slice(0, 80);
        const vid = 'dv_' + crypto.randomBytes(8).toString('hex');
        db.prepare('INSERT INTO dissection_versions (id,dissection_id,user_email,label,result_json,created_at) VALUES (?,?,?,?,?,?)').run(vid, record.id, auth.user.email, label, JSON.stringify(record.result || {}), Date.now());
        json(res, 200, { ok: true, versionId: vid, label });
      }).catch(e => respondError(res, e));
      return;
    }
    if (!dbReady()) return json(res, 503, { error: '云端存储不可用' });
    const rows = db.prepare('SELECT id,label,created_at FROM dissection_versions WHERE dissection_id = ? AND user_email = ? ORDER BY created_at DESC').all(record.id, auth.user.email);
    json(res, 200, { ok: true, versions: rows });
  }

  function handleDissectionVersion(req, res, id, vid) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (!requireSqliteForPublic(req, res)) return;
    const record = loadDissectionRecord(id, auth.user.email);
    if (!record) return json(res, 404, { error: '拆书任务不存在或无权访问' });
    if (!dbReady()) return json(res, 503, { error: '云端存储不可用' });
    const db = getDb();
    if (req.method === 'GET') {
      const row = db.prepare('SELECT * FROM dissection_versions WHERE id = ? AND user_email = ?').get(vid, auth.user.email);
      if (!row) return json(res, 404, { error: '版本不存在' });
      let result = {};
      try { result = JSON.parse(row.result_json || '{}'); } catch (_) {}
      return json(res, 200, { ok: true, version: { id: row.id, label: row.label, createdAt: row.created_at, result } });
    }
    if (req.method === 'POST') {
      const row = db.prepare('SELECT * FROM dissection_versions WHERE id = ? AND user_email = ?').get(vid, auth.user.email);
      if (!row) return json(res, 404, { error: '版本不存在' });
      let result = {};
      try { result = JSON.parse(row.result_json || '{}'); } catch (_) {}
      record.result = result;
      updateDissectionRecord(record);
      return json(res, 200, { ok: true, restored: true });
    }
    if (req.method === 'DELETE') {
      db.prepare('DELETE FROM dissection_versions WHERE id = ? AND user_email = ?').run(vid, auth.user.email);
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { error: '方法不支持' });
  }

  return {
    // 映射至 routes/dissections.js 路由器
    extract: handleDissectionExtract,
    create: handleDissectionCreate,
    list: handleDissectionList,
    export: handleDissectionExport,
    apply: handleDissectionApply,
    creativeBrief: handleDissectionCreativeBrief,
    creationContext: handleDissectionCreationContext,
    chapterContract: handleDissectionChapterContract,
    audit: handleDissectionAudit,
    coverage: dissectionQueryHandlers.handleDissectionCoverage,
    units: dissectionQueryHandlers.handleDissectionUnitsPage,
    entities: dissectionQueryHandlers.handleDissectionEntitiesPage,
    foreshadows: dissectionQueryHandlers.handleDissectionForeshadowsPage,
    summaries: dissectionQueryHandlers.handleDissectionSummariesPage,
    validation: dissectionQueryHandlers.handleDissectionValidation,
    search: dissectionQueryHandlers.handleDissectionSearch,
    rebuild: handleDissectionRebuild,
    patch: handleDissectionPatch,
    get: handleDissectionGet,
    cancel: handleDissectionCancel,
    retry: handleDissectionRetry,
    remove: handleDissectionDelete,
    imitate: handleDissectionImitate,
    diagnose: handleDissectionDiagnose,
    syncCharacters: handleDissectionCharactersSync,
    share: handleDissectionShare,
    shareDelete: handleDissectionShareDelete,
    versions: handleDissectionVersions,
    version: handleDissectionVersion,
    compare: handleDissectionsCompare,
    batch: handleDissectionsBatch,
    sharedList: handleSharedDissectionsList,
    respondError: deps.respondError,

    // 查询类端点透传或默认回退
    coverage: deps.handleDissectionCoverage || deps.coverage || (() => {}),
    units: deps.handleDissectionUnitsPage || deps.units || (() => {}),
    entities: deps.handleDissectionEntitiesPage || deps.entities || (() => {}),
    foreshadows: deps.handleDissectionForeshadowsPage || deps.foreshadows || (() => {}),
    summaries: deps.handleDissectionSummariesPage || deps.summaries || (() => {}),
    validation: deps.handleDissectionValidation || deps.validation || (() => {}),
    search: deps.handleDissectionSearch || deps.search || (() => {}),

    // 跨域供 routes/projects.js 调用
    sharedDissectionGet: handleSharedDissectionGet,

    // 兼容具名函数
    handleDissectionExtract,
    handleDissectionCreate,
    handleDissectionList,
    handleDissectionGet,
    handleDissectionCancel,
    handleDissectionRetry,
    handleDissectionDelete,
    handleDissectionExport,
    handleDissectionApply,
    handleDissectionCreativeBrief,
    handleDissectionCreationContext,
    handleDissectionChapterContract,
    handleDissectionAudit,
    handleDissectionRebuild,
    handleDissectionImitate,
    handleDissectionDiagnose,
    handleDissectionsCompare,
    handleDissectionsBatch,
    handleDissectionPatch,
    handleDissectionCharactersSync,
    handleDissectionShare,
    handleDissectionShareDelete,
    handleSharedDissectionsList,
    handleSharedDissectionGet,
    handleDissectionVersions,
    handleDissectionVersion
  };
}

module.exports = {
  createDissectionHandlers,
  compactDissectionTransferValue,
  dissectionTransferJson,
  dissectionMarkdown
};
