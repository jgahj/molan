'use strict';

function createPostgresDissectionMutationService(dependencies) {
  const {
    postgresRepository,
    readBody,
    getAuthUser,
    postgresActor,
    json,
    respondPostgresError,
    rowToRecord,
    publicRecord,
    computeStats,
    getActiveDissection,
    releaseUserSlot,
    acquireUserSlot,
    scheduleStartDissection,
    planRetry,
    resolveModel,
    hasCompleteContent,
    postgresPipelineStore,
    normalizeDissectionInput,
    buildDissectionChunks,
    chooseDissectionChunks,
    dissectionContext,
    dissectionWordCount,
    creditCostForUser,
    estimateBillingTokens,
    pipelineEstimatedTokensFor,
    dissectionSkillRecord,
    dissectionSkillPromptFiles,
    dissectionId,
    emptyDissectionResult,
    DISSECTION_MAX_BODY_BYTES = 25 * 1024 * 1024,
    DISSECTION_MAX_SOURCE_CHARS = 10000000,
    PIPELINE_MIN_CHAPTERS = 5,
    SKILL_AUDIT_VERSION = 1,
    crypto = require('node:crypto')
  } = dependencies;
  const batchQueues = new Map();

  function parseBatchQueueMarker(row) {
    if (row.meta_json === undefined || row.meta_json === null) return false;
    try {
      const meta = typeof row.meta_json === 'string' ? JSON.parse(row.meta_json) : row.meta_json;
      return !meta || typeof meta !== 'object' || Array.isArray(meta) || meta.batchQueued === true;
    } catch (_) { return true; }
  }

  function parseDoc(row) {
    let document = row && row.document;
    if (typeof document === 'string') {
      try { document = JSON.parse(document); } catch (_) { document = null; }
    }
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw Object.assign(new Error('拆书账本记录损坏'), { code: 'corrupt_document', status: 500 });
    }
    return document;
  }

  async function markStartupFailure(actor, dissectionId, error) {
    const row = await postgresRepository.runtimeGetDissection(actor, dissectionId);
    if (!row || row.status !== 'queued' || row.cancel_requested || row.worker_id) return;
    await postgresRepository.runtimeUpdateDissection({
      ...rowToRecord(row), ownerUserId: actor, status: 'failed',
      expectedRevision: Number(row.revision),
      error: String(error && error.message || '拆书任务启动失败').slice(0, 1000),
      updatedAt: Date.now()
    });
  }

  async function handleCreate(request, response, options = {}) {
    const send = options.capture || ((status, payload) => json(response, status, payload));
    const auth = getAuthUser(request);
    if (!auth) {
      return send(401, { error: '请先登录后再使用拆书功能' });
    }
    const actor = postgresActor(auth);
    const userEmail = String(auth.user && auth.user.email || '').trim().toLowerCase();

    let body;
    try {
      body = options.body === undefined ? await readBody(request, DISSECTION_MAX_BODY_BYTES) : options.body;
    } catch (readError) {
      if (readError && readError.status) {
        return send(readError.status, { error: readError.message });
      }
      return send(400, { error: '请求体解析失败' });
    }

    let sourceInfo;
    try {
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return send(400, { error: '请求体必须是 JSON 对象' });
      }
      if (typeof normalizeDissectionInput !== 'function' || typeof resolveModel !== 'function') {
        return send(503, { error: '拆书创建服务尚未就绪' });
      }
      const requiredFunctions = [
        buildDissectionChunks, chooseDissectionChunks, dissectionContext, dissectionWordCount,
        estimateBillingTokens, creditCostForUser, dissectionSkillRecord,
        dissectionSkillPromptFiles, dissectionId, emptyDissectionResult, hasCompleteContent
      ];
      if (requiredFunctions.some(value => typeof value !== 'function') ||
          (body.run !== false && (typeof acquireUserSlot !== 'function' || typeof scheduleStartDissection !== 'function'))) {
        return send(503, { error: '拆书创建服务依赖尚未就绪' });
      }
      sourceInfo = normalizeDissectionInput(body);
    } catch (normError) {
      return send(400, { error: normError.message || '输入格式错误' });
    }

    const source = sourceInfo.source;
    if (!source || !source.trim()) {
      return send(400, { error: '请上传至少一个文本文件或粘贴正文' });
    }
    if (source.length > DISSECTION_MAX_SOURCE_CHARS) {
      return send(413, { error: '拆书原文过大，当前最多支持约 ' + Math.floor(DISSECTION_MAX_SOURCE_CHARS / 10000) / 100 + ' 万字' });
    }

    let createdId = '';
    let userSlotHeld = false;
    if (body.run !== false && typeof acquireUserSlot === 'function') {
      if (!acquireUserSlot(userEmail)) {
        return send(409, { error: '你已有正在运行的拆书任务，请完成或取消后再创建新的任务' });
      }
      userSlotHeld = true;
    }

    try {
      const sourceType = ['file', 'folder', 'text'].includes(String(body.sourceType || ''))
        ? String(body.sourceType)
        : (Array.isArray(body.files) && body.files.length > 1 ? 'folder' : 'text');
      const depth = ['quick', 'standard', 'deep'].includes(String(body.depth || '')) ? String(body.depth) : 'standard';
      const purpose = ['new-writer', 'advanced', 'problem'].includes(String(body.purpose || '')) ? String(body.purpose) : 'new-writer';
      const title = String(body.title || body.sourceName || '未命名拆书').trim().slice(0, 120) || '未命名拆书';
      const selectedModel = resolveModel(auth.user, body.model || body.selectedModel);

      const chunks = typeof buildDissectionChunks === 'function' ? buildDissectionChunks(source) : [];
      const selected = typeof chooseDissectionChunks === 'function' ? chooseDissectionChunks(chunks, depth) : chunks;
      const sampleChars = typeof dissectionContext === 'function' ? dissectionContext(selected).length : source.length;
      const chapterIds = new Set(chunks.map(chunk => chunk.chapterId).filter(id => /^chapter-/.test(String(id || ''))));
      const chapterCount = chapterIds.size || chunks.length;
      const fileCount = (sourceInfo.sourceFiles || []).filter(file => file.included).length;

      const pipelineCandidate = depth === 'deep' && chapterCount >= PIPELINE_MIN_CHAPTERS;
      if (pipelineCandidate && (!postgresPipelineStore || typeof pipelineEstimatedTokensFor !== 'function')) {
        throw Object.assign(new Error('深度拆书流水线尚未就绪'), { status: 503 });
      }
      let estimatedTokens = typeof estimateBillingTokens === 'function'
        ? estimateBillingTokens({ task: 'dissection', chars: sampleChars, depth })
        : 10000;
      if (pipelineCandidate && typeof pipelineEstimatedTokensFor === 'function') {
        estimatedTokens = pipelineEstimatedTokensFor({ selectedModel }, chapterCount);
      }

      const now = Date.now();
      const sourceHash = crypto.createHash('sha1').update(source).digest('hex');

      // 检查 PG 缓存复用
      const existingDissections = await postgresRepository.runtimeListDissections(actor);
      const cached = existingDissections.find(row => {
        if (row.status !== 'completed' || row.depth !== depth || row.purpose !== purpose) return false;
        let meta = {};
        try { meta = typeof row.meta_json === 'string' ? JSON.parse(row.meta_json) : row.meta_json; } catch (_) { return false; }
        let result;
        try { result = typeof row.result_json === 'string' ? JSON.parse(row.result_json) : row.result_json; } catch (_) { return false; }
        return meta && typeof meta === 'object' && !Array.isArray(meta) &&
          result && typeof result === 'object' && !Array.isArray(result) &&
          meta.sourceHash === sourceHash &&
          typeof hasCompleteContent === 'function' && hasCompleteContent(result, depth);
      });

      if (cached) {
        let cachedResult = {};
        cachedResult = typeof cached.result_json === 'string' ? JSON.parse(cached.result_json) : cached.result_json;
        const cachedId = typeof dissectionId === 'function' ? dissectionId() : ('d_' + Date.now().toString(36));
        const cachedRecord = {
          id: cachedId,
          ownerUserId: actor,
          userEmail,
          title,
          sourceType,
          sourceName: String(body.sourceName || title).slice(0, 200),
          sourceText: source,
          depth,
          purpose,
          selectedModel,
          status: 'completed',
          phase: 'completed',
          phaseIndex: 0,
          progress: 100,
          estimatedCredits: 0,
          actualCredits: 0,
          result: cachedResult,
          meta: {
            wordCount: typeof dissectionWordCount === 'function' ? dissectionWordCount(source) : source.length,
            chapterCount,
            fileCount,
            chunkCount: chunks.length,
            sampleCount: selected.length,
            sampleChars,
            removedNoiseChars: sourceInfo.removedNoiseChars || 0,
            sourceFiles: sourceInfo.sourceFiles || [],
            sourceHash,
            cacheHit: true,
            cachedFrom: cached.id
          },
          error: '',
          cancelRequested: false,
          createdAt: now,
          updatedAt: now
        };

        await postgresRepository.runtimeInsertDissection(cachedRecord);
        if (userSlotHeld && typeof releaseUserSlot === 'function') {
          releaseUserSlot(userEmail);
          userSlotHeld = false;
        }
        return send(202, {
          ok: true,
          cached: true,
          cachedFrom: cached.id,
          task: publicRecord(cachedRecord, false)
        });
      }

      const newId = typeof dissectionId === 'function' ? dissectionId() : ('d_' + Date.now().toString(36));
      const skill = typeof dissectionSkillRecord === 'function' ? dissectionSkillRecord() : { id: 'dissection' };
      const skillPromptFilesForRun = typeof dissectionSkillPromptFiles === 'function' ? dissectionSkillPromptFiles(skill) : [];

      const estimatedCredits = typeof creditCostForUser === 'function'
        ? creditCostForUser(auth.user, selectedModel, estimatedTokens)
        : 0;

      const record = {
        id: newId,
        ownerUserId: actor,
        userEmail,
        title,
        sourceType,
        sourceName: String(body.sourceName || title).slice(0, 200),
        sourceText: source,
        depth,
        purpose,
        selectedModel,
        status: 'queued',
        phase: 'queued',
        phaseIndex: 0,
        progress: 0,
        estimatedCredits,
        actualCredits: 0,
        result: typeof emptyDissectionResult === 'function' ? emptyDissectionResult() : {},
        meta: {
          wordCount: typeof dissectionWordCount === 'function' ? dissectionWordCount(source) : source.length,
          chapterCount,
          fileCount,
          chunkCount: chunks.length,
          sampleCount: selected.length,
          sampleChars,
          removedNoiseChars: sourceInfo.removedNoiseChars || 0,
          sourceFiles: sourceInfo.sourceFiles || [],
          sourceHash,
          stageInput: {},
          stageUsage: {},
          estimatedTokens,
          dissectionSkill: {
            id: skill.id,
            name: skill.name || skill.id,
            files: Array.isArray(skill.files) ? skill.files : [],
            promptFiles: skillPromptFilesForRun,
            auditVersion: SKILL_AUDIT_VERSION
          }
        },
        error: '',
        cancelRequested: false,
        createdAt: now,
        updatedAt: now
      };

      if (options.batch) record.meta = { ...record.meta, batchQueued: true };
      await postgresRepository.runtimeInsertDissection(record);
      createdId = record.id;
      if (pipelineCandidate && postgresPipelineStore) {
        await postgresPipelineStore.initializeDissectionPipeline(actor, record, pipelineCandidate);
        await postgresRepository.runtimeUpdateDissection(record);
      }

      if (body.run !== false && typeof scheduleStartDissection === 'function') {
        const token = String(request.headers && request.headers.authorization || '');
        const scheduled = scheduleStartDissection(record.id, userEmail, token);
        if (scheduled && typeof scheduled.catch === 'function') {
          scheduled.catch(async error => {
            try { await markStartupFailure(actor, record.id, error); }
            catch (persistError) { console.error('[postgres-dissection] startup persistence failure:', persistError.code || persistError.message); }
          });
        }
      }
      userSlotHeld = false;

      return send(202, { ok: true, task: publicRecord(record, false) });
    } catch (createError) {
      if (createdId) {
        try { await markStartupFailure(actor, createdId, createError); }
        catch (persistError) { console.error('[postgres-dissection] create failure persistence:', persistError.code || persistError.message); }
      }
      if (userSlotHeld && typeof releaseUserSlot === 'function') {
        releaseUserSlot(userEmail);
        userSlotHeld = false;
      }
      if (options.capture) return send(createError.status || 503, { error: createError.message, code: createError.code || 'pg_error' });
      return respondPostgresError(response, createError);
    }
  }

  async function handleBatch(request, response) {
    const auth = getAuthUser(request);
    if (!auth) return json(response, 401, { error: '请先登录' });
    const body = await readBody(request, DISSECTION_MAX_BODY_BYTES);
    const tasks = Array.isArray(body?.tasks) ? body.tasks.slice(0, 20) : [];
    if (!tasks.length) return json(response, 400, { error: '请提供至少一个拆解任务' });
    if (body.run !== false && (typeof acquireUserSlot !== 'function' || typeof scheduleStartDissection !== 'function')) {
      return json(response, 503, { error: '批量拆书调度依赖尚未就绪' });
    }
    const actor = postgresActor(auth);
    const created = [];
    const errors = [];
    for (const [index, task] of tasks.entries()) {
      if (!task || typeof task !== 'object' || Array.isArray(task)) {
        errors.push({ index, status: 400, error: '任务必须是对象' });
        continue;
      }
      await handleCreate(request, response, {
        body: { ...task, run: false },
        batch: true,
        capture: (status, payload) => {
          if (status === 202 && payload.task) created.push(payload.task);
          else errors.push({ index, status, error: payload.error, code: payload.code });
        }
      });
    }
    const queued = created.filter(task => task.status === 'queued');
    if (body.run !== false && queued.length) {
      const previous = batchQueues.get(actor) || Promise.resolve();
      const execution = previous.catch(() => {}).then(async () => {
        for (const task of queued) {
          while (true) {
            const latest = await postgresRepository.runtimeGetDissection(actor, task.id);
            if (!latest || latest.status !== 'queued' || latest.cancel_requested) break;
            const ownerTasks = await postgresRepository.runtimeListDissections(actor);
            const occupied = ownerTasks.some(row => row.worker_id && new Date(row.worker_lease_until).getTime() > Date.now());
            if (occupied || !acquireUserSlot(auth.user.email)) {
              await new Promise(resolve => setTimeout(resolve, 1000));
              continue;
            }
            try {
              await scheduleStartDissection(task.id, auth.user.email, String(request.headers?.authorization || ''));
            } catch (error) {
              await markStartupFailure(actor, task.id, error);
            }
            break;
          }
        }
      });
      batchQueues.set(actor, execution);
      execution.catch(error => {
        console.error('[postgres-dissection] batch execution failed:', error.code || 'batch_failed');
      }).finally(() => {
        if (batchQueues.get(actor) === execution) batchQueues.delete(actor);
      });
    }
    return json(response, created.length ? 202 : 400, { ok: created.length > 0, count: created.length, tasks: created, errors });
  }

  async function handleDelete(request, response, dissectionId) {
    const auth = getAuthUser(request);
    if (!auth) {
      return json(response, 401, { error: '请先登录' });
    }
    const actor = postgresActor(auth);
    const userEmail = String(auth.user && auth.user.email || '').trim().toLowerCase();

    try {
      const record = await postgresRepository.runtimeGetDissection(actor, dissectionId);
      if (!record) return json(response, 404, { error: '拆书任务不存在或无权访问' });
      const active = typeof getActiveDissection === 'function' ? getActiveDissection(dissectionId) : null;
      const deletedCount = await postgresRepository.runtimeDeleteDissection(actor, dissectionId);
      if (deletedCount === 0) {
        return json(response, 404, { error: '拆书任务不存在或无权访问' });
      }
      if (active && active.controller) active.controller.abort();
      const batchQueued = parseBatchQueueMarker(record);
      if (!active && record.status === 'queued' && !batchQueued && typeof releaseUserSlot === 'function') {
        releaseUserSlot(userEmail);
      }
      return json(response, 200, { ok: true, deleted: deletedCount });
    } catch (deleteError) {
      return respondPostgresError(response, deleteError);
    }
  }

  async function handleCancel(request, response, dissectionId) {
    const auth = getAuthUser(request);
    if (!auth) {
      return json(response, 401, { error: '请先登录' });
    }
    const actor = postgresActor(auth);
    let updatedRow;
    try {
      updatedRow = await postgresRepository.runtimeRequestDissectionCancel(actor, dissectionId);
    } catch (repositoryError) {
      return respondPostgresError(response, repositoryError);
    }
    if (!updatedRow) {
      return json(response, 404, { error: '拆书任务不存在或无权访问' });
    }

    const activeDissection = typeof getActiveDissection === 'function' ? getActiveDissection(dissectionId) : null;
    const isTerminalNoop = updatedRow.isNoop === true || updatedRow.wasCancelled === false;
    if (!isTerminalNoop && activeDissection && activeDissection.controller && typeof activeDissection.controller.abort === 'function') {
      activeDissection.controller.abort();
    } else if (updatedRow.wasQueued && !parseBatchQueueMarker(updatedRow)) {
      const userEmail = updatedRow.user_email || (auth.user && auth.user.email);
      if (typeof releaseUserSlot === 'function' && userEmail) {
        releaseUserSlot(userEmail);
      }
    }

    const record = rowToRecord(updatedRow);
    if (updatedRow.estimated_credits === null) {
      record.estimatedCredits = null;
    }
    if (updatedRow.actual_credits === null) {
      record.actualCredits = null;
    }
    let stats = {};
    if (typeof computeStats === 'function') {
      try {
        stats = await computeStats(actor, dissectionId, record);
      } catch (statsError) {
        return respondPostgresError(response, statsError);
      }
    }
    const task = publicRecord(record, true, stats);
    return json(response, 200, { ok: true, task });
  }

  async function handleRetry(request, response, dissectionId) {
    const auth = getAuthUser(request);
    if (!auth) {
      return json(response, 401, { error: '请先登录' });
    }

    const actor = postgresActor(auth);
    let currentRow;
    try {
      currentRow = await postgresRepository.runtimeGetDissection(actor, dissectionId);
    } catch (repositoryError) {
      return respondPostgresError(response, repositoryError);
    }
    if (!currentRow) {
      return json(response, 404, { error: '拆书任务不存在或无权访问' });
    }
    const rowOwner = String(currentRow.owner_user_id || '').trim();
    if (!rowOwner || rowOwner !== actor) {
      return json(response, 404, { error: '拆书任务不存在或无权访问' });
    }

    const activeDissection = typeof getActiveDissection === 'function' ? getActiveDissection(dissectionId) : null;
    if (activeDissection) {
      return json(response, 409, { error: '任务仍在停止，请稍后再重试' });
    }

    const record = rowToRecord(currentRow);
    let isCompletedIncomplete = false;
    if (record.status === 'completed' && planRetry && typeof planRetry.hasCompleteContent === 'function') {
      isCompletedIncomplete = !planRetry.hasCompleteContent(record.result, record.depth);
    }

    const isRetryable = ['failed', 'cancelled', 'interrupted', 'needs_review'].includes(record.status) || isCompletedIncomplete;
    if (!isRetryable) {
      return json(response, 409, { error: '当前任务不需要重试' });
    }

    let retryState = {};
    if (typeof planRetry === 'function') {
      try {
        retryState = await planRetry(actor, record, currentRow);
      } catch (planError) {
        return respondPostgresError(response, planError);
      }
    }
    retryState.allowCompletedRetry = isCompletedIncomplete;
    retryState.expectedRevision = Number(currentRow.revision);

    const userEmail = currentRow.user_email || (auth.user && auth.user.email);
    let slotAcquired = false;
    if (typeof acquireUserSlot === 'function') {
      const acquireResult = acquireUserSlot(userEmail);
      if (!acquireResult) {
        return json(response, 409, { error: '你已有正在运行的拆书任务，请完成或取消后再重试' });
      }
      slotAcquired = true;
    }

    let updatedRow;
    try {
      updatedRow = await postgresRepository.runtimeRequeueDissection(actor, dissectionId, retryState);
    } catch (requeueError) {
      if (slotAcquired && typeof releaseUserSlot === 'function' && userEmail) {
        releaseUserSlot(userEmail);
        slotAcquired = false;
      }
      return respondPostgresError(response, requeueError);
    }

    const updatedRecord = rowToRecord(updatedRow);
    if (updatedRow.estimated_credits === null) {
      updatedRecord.estimatedCredits = null;
    }
    if (updatedRow.actual_credits === null) {
      updatedRecord.actualCredits = null;
    }
    let stats = {};
    if (typeof computeStats === 'function') {
      try {
        stats = await computeStats(actor, dissectionId, updatedRecord);
      } catch (statsError) {
        if (slotAcquired && typeof releaseUserSlot === 'function' && userEmail) {
          releaseUserSlot(userEmail);
          slotAcquired = false;
        }
        try {
          await markStartupFailure(actor, dissectionId, statsError);
        } catch (_) {}
        return respondPostgresError(response, statsError);
      }
    }

    if (typeof scheduleStartDissection === 'function') {
      const authorizationHeader = String(request.headers && request.headers.authorization || '');
      try {
        const scheduleResult = scheduleStartDissection(dissectionId, userEmail, authorizationHeader);
        if (scheduleResult && typeof scheduleResult.catch === 'function') {
          scheduleResult.catch(async asyncError => {
            try {
              await markStartupFailure(actor, dissectionId, asyncError);
            } catch (_) {}
            console.error('[postgres-dissection] scheduleStartDissection async failure:', asyncError);
          });
        }
      } catch (syncScheduleError) {
        if (slotAcquired && typeof releaseUserSlot === 'function' && userEmail) {
          releaseUserSlot(userEmail);
          slotAcquired = false;
        }
        try {
          await markStartupFailure(actor, dissectionId, syncScheduleError);
        } catch (_) {}
        return respondPostgresError(response, syncScheduleError);
      }
    }

    const task = publicRecord(updatedRecord, false, stats);
    return json(response, 202, { ok: true, task });
  }

  async function handlePatch(request, response, dissectionId) {
    const auth = getAuthUser(request);
    if (!auth) {
      return json(response, 401, { error: '请先登录' });
    }
    const actor = postgresActor(auth);
    let body;
    try {
      body = await readBody(request);
    } catch (readError) {
      if (readError && readError.status) {
        return json(response, readError.status, { error: readError.message });
      }
      return json(response, 400, { error: '请求体解析失败' });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json(response, 400, { error: '请求体必须是 JSON 对象' });
    }
    try {
      const updatedRow = await postgresRepository.runtimePatchDissectionMetadata(actor, dissectionId, body);
      if (!updatedRow) {
        return json(response, 404, { error: '拆书任务不存在或无权修改' });
      }
      const record = rowToRecord(updatedRow);
      if (updatedRow.estimated_credits === null) {
        record.estimatedCredits = null;
      }
      if (updatedRow.actual_credits === null) {
        record.actualCredits = null;
      }
      const stats = await computeStats(actor, dissectionId, record);
      const task = publicRecord(record, false, stats);
      return json(response, 200, { ok: true, task });
    } catch (error) {
      return respondPostgresError(response, error);
    }
  }

  async function handleSyncCharacters(request, response, dissectionId) {
    const auth = getAuthUser(request);
    if (!auth) {
      return json(response, 401, { error: '请先登录' });
    }
    const actor = postgresActor(auth);
    const row = await postgresRepository.runtimeGetDissection(actor, dissectionId);
    if (!row) {
      return json(response, 404, { error: '拆书任务不存在或无权访问' });
    }
    const record = rowToRecord(row);
    if (record.status !== 'completed') {
      return json(response, 409, { error: '请先完成拆书' });
    }
    if (!postgresPipelineStore) {
      return json(response, 500, { error: 'Postgres pipeline store 未启用' });
    }
    try {
      const synced = await postgresPipelineStore.syncCharactersToLibrary(actor, record);
      return json(response, 200, { ok: true, synced });
    } catch (error) {
      return respondPostgresError(response, error);
    }
  }

  async function handleVersions(request, response, dissectionId) {
    const auth = getAuthUser(request);
    if (!auth) {
      return json(response, 401, { error: '请先登录' });
    }
    const actor = postgresActor(auth);
    const row = await postgresRepository.runtimeGetDissection(actor, dissectionId);
    if (!row) {
      return json(response, 404, { error: '拆书任务不存在或无权访问' });
    }
    const record = rowToRecord(row);

    if (request.method === 'POST') {
      const body = await readBody(request);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return json(response, 400, { error: '请求体必须是 JSON 对象' });
      }
      const label = String((body && body.label) || ('快照 ' + new Date().toLocaleString('zh-CN'))).slice(0, 80);
      const vid = 'dv_' + crypto.randomBytes(8).toString('hex');
      const now = Date.now();
      await postgresRepository.runtimeUpsertDissectionRows(actor, [{
        rowKey: vid,
        dissectionId,
        sourceTable: 'dissection_versions',
        document: {
          id: vid,
          dissection_id: dissectionId,
          user_email: record.userEmail,
          label,
          result: record.result || {},
          created_at: now
        }
      }]);
      return json(response, 200, { ok: true, versionId: vid, label });
    }

    const versionRows = await postgresRepository.runtimeListDissectionRows(actor, dissectionId, 'dissection_versions');
    const versions = versionRows.map(r => {
      const doc = parseDoc(r);
      return {
        id: doc.id || r.row_key,
        label: doc.label || '',
        created_at: doc.created_at || doc.createdAt || 0
      };
    }).sort((a, b) => b.created_at - a.created_at);
    return json(response, 200, { ok: true, versions });
  }

  async function handleVersion(request, response, dissectionId, vid) {
    const auth = getAuthUser(request);
    if (!auth) {
      return json(response, 401, { error: '请先登录' });
    }
    const actor = postgresActor(auth);
    const row = await postgresRepository.runtimeGetDissection(actor, dissectionId);
    if (!row) {
      return json(response, 404, { error: '拆书任务不存在或无权访问' });
    }
    const record = rowToRecord(row);
    const versionRows = await postgresRepository.runtimeListDissectionRows(actor, dissectionId, 'dissection_versions');
    const target = versionRows.find(r => r.row_key === vid || parseDoc(r).id === vid);
    if (!target) {
      return json(response, 404, { error: '版本不存在' });
    }
    const doc = parseDoc(target);

    if (request.method === 'GET') {
      return json(response, 200, {
        ok: true,
        version: {
          id: doc.id || target.row_key,
          label: doc.label || '',
          createdAt: doc.created_at || doc.createdAt || 0,
          result: doc.result || {}
        }
      });
    }

    if (request.method === 'POST') {
      if (record.status === 'running' || record.status === 'queued') {
        return json(response, 409, { error: '任务正在运行，不能恢复旧版本' });
      }
      record.result = doc.result || {};
      record.expectedRevision = Number(row.revision);
      await postgresRepository.runtimeUpdateDissection(record);
      return json(response, 200, { ok: true, restored: true });
    }

    if (request.method === 'DELETE') {
      await postgresRepository.runtimeDeleteDissectionRow(actor, dissectionId, 'dissection_versions', target.row_key);
      return json(response, 200, { ok: true });
    }

    return json(response, 405, { error: '方法不支持' });
  }

  async function handleShare(request, response, dissectionId) {
    const auth = getAuthUser(request);
    if (!auth) {
      return json(response, 401, { error: '请先登录' });
    }
    const actor = postgresActor(auth);
    const row = await postgresRepository.runtimeGetDissection(actor, dissectionId);
    if (!row) {
      return json(response, 404, { error: '拆书任务不存在或无权访问' });
    }
    const record = rowToRecord(row);
    if (record.status !== 'completed') {
      return json(response, 409, { error: '请先完成拆书再分享' });
    }

    if (request.method === 'GET') {
      const shareRows = await postgresRepository.runtimeListDissectionRows(actor, dissectionId, 'dissection_shares');
      const shares = shareRows.map(r => {
        const doc = parseDoc(r);
        return {
          token: doc.token || r.row_key,
          granteeEmail: doc.grantee_email || doc.granteeEmail || '',
          role: doc.role || 'view',
          expiresAt: doc.expires_at || doc.expiresAt || 0,
          createdAt: doc.created_at || doc.createdAt || 0
        };
      }).sort((a, b) => b.createdAt - a.createdAt);
      return json(response, 200, { ok: true, shares });
    }

    const p = await readBody(request);
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      return json(response, 400, { error: '请求体必须是 JSON 对象' });
    }
    const emails = Array.isArray(p.emails) ? p.emails.map(String).map(s => s.trim().toLowerCase()).filter(Boolean).slice(0, 20) : [];
    const role = ['view', 'edit'].includes(String(p.role || '')) ? String(p.role) : 'view';
    const expires = Date.now() + 30 * 24 * 3600 * 1000;
    const now = Date.now();

    if (emails.length) {
      const created = [];
      const rows = [];
      emails.forEach(email => {
        if (email === String(record.userEmail || '').toLowerCase()) return;
        const token = crypto.randomBytes(12).toString('hex');
        rows.push({
          rowKey: token,
          dissectionId,
          sourceTable: 'dissection_shares',
          document: {
            token,
            dissection_id: dissectionId,
            user_email: record.userEmail,
            grantee_email: email,
            role,
            created_at: now,
            expires_at: expires
          }
        });
        created.push({ token, granteeEmail: email, role, shareUrl: '/shared/dissection/' + token, expiresAt: expires });
      });
      if (rows.length) {
        await postgresRepository.runtimeUpsertDissectionRows(actor, rows);
      }
      return json(response, 200, { ok: true, shares: created });
    }

    const token = crypto.randomBytes(12).toString('hex');
    await postgresRepository.runtimeUpsertDissectionRows(actor, [{
      rowKey: token,
      dissectionId,
      sourceTable: 'dissection_shares',
      document: {
        token,
        dissection_id: dissectionId,
        user_email: record.userEmail,
        grantee_email: '',
        role: 'view',
        created_at: now,
        expires_at: expires
      }
    }]);
    return json(response, 200, { ok: true, token, shareUrl: '/shared/dissection/' + token, expiresAt: expires });
  }

  async function handleShareDelete(request, response, dissectionId, token) {
    const auth = getAuthUser(request);
    if (!auth) {
      return json(response, 401, { error: '请先登录' });
    }
    const actor = postgresActor(auth);
    const row = await postgresRepository.runtimeGetDissection(actor, dissectionId);
    if (!row) {
      return json(response, 404, { error: '拆书任务不存在或无权访问' });
    }
    const shareRows = await postgresRepository.runtimeListDissectionRows(actor, dissectionId, 'dissection_shares');
    const target = shareRows.find(r => r.row_key === token || parseDoc(r).token === token);
    if (!target) {
      return json(response, 404, { error: '分享链接不存在' });
    }

    await postgresRepository.runtimeDeleteDissectionRow(actor, dissectionId, 'dissection_shares', target.row_key);
    return json(response, 200, { ok: true, token });
  }

  async function dispatch(request, response, pathname) {
    const p = String(pathname || '').trim().replace(
      /^\/api\/dissection\/(d_[A-Za-z0-9_-]+)(?=\/)/, '/api/dissections/$1'
    );
    if (request.method === 'POST' && p === '/api/dissections/batch') {
      await handleBatch(request, response);
      return true;
    }

    // POST /api/dissections (创建)
    if (request.method === 'POST' && (p === '/api/dissections' || p === '/api/dissections/')) {
      await handleCreate(request, response);
      return true;
    }

    // PATCH /api/dissections/:id
    if (request.method === 'PATCH') {
      const patchMatch = p.match(/^\/api\/dissections\/(d_[A-Za-z0-9_-]+)$/);
      if (patchMatch) {
        await handlePatch(request, response, patchMatch[1]);
        return true;
      }
      return false;
    }

    // DELETE /api/dissections/:id
    if (request.method === 'DELETE') {
      const deleteMatch = p.match(/^\/api\/dissections\/(d_[A-Za-z0-9_-]+)$/);
      if (deleteMatch) {
        await handleDelete(request, response, deleteMatch[1]);
        return true;
      }
      const shareDeleteMatch = p.match(/^\/api\/dissections\/(d_[A-Za-z0-9_-]+)\/(?:share|shares)\/([A-Za-z0-9_-]+)$/);
      if (shareDeleteMatch) {
        await handleShareDelete(request, response, shareDeleteMatch[1], shareDeleteMatch[2]);
        return true;
      }
      const versionDeleteMatch = p.match(/^\/api\/dissections\/(d_[A-Za-z0-9_-]+)\/versions\/([A-Za-z0-9_-]+)$/);
      if (versionDeleteMatch) {
        await handleVersion(request, response, versionDeleteMatch[1], versionDeleteMatch[2]);
        return true;
      }
      return false;
    }

    // POST
    if (request.method === 'POST') {
      const cancelMatch = p.match(/^\/api\/dissections\/(d_[A-Za-z0-9_-]+)\/cancel$/);
      if (cancelMatch) {
        await handleCancel(request, response, cancelMatch[1]);
        return true;
      }
      const retryMatch = p.match(/^\/api\/dissections\/(d_[A-Za-z0-9_-]+)\/retry$/);
      if (retryMatch) {
        await handleRetry(request, response, retryMatch[1]);
        return true;
      }
      const syncCharsMatch = p.match(/^\/api\/dissections\/(d_[A-Za-z0-9_-]+)\/(?:sync-characters|characters\/sync)$/);
      if (syncCharsMatch) {
        await handleSyncCharacters(request, response, syncCharsMatch[1]);
        return true;
      }
      const versionsPostMatch = p.match(/^\/api\/dissections\/(d_[A-Za-z0-9_-]+)\/versions$/);
      if (versionsPostMatch) {
        await handleVersions(request, response, versionsPostMatch[1]);
        return true;
      }
      const versionRestoreMatch = p.match(/^\/api\/dissections\/(d_[A-Za-z0-9_-]+)\/versions\/([A-Za-z0-9_-]+)(?:\/restore)?$/);
      if (versionRestoreMatch) {
        await handleVersion(request, response, versionRestoreMatch[1], versionRestoreMatch[2]);
        return true;
      }
      const sharePostMatch = p.match(/^\/api\/dissections\/(d_[A-Za-z0-9_-]+)\/(?:share|shares)$/);
      if (sharePostMatch) {
        await handleShare(request, response, sharePostMatch[1]);
        return true;
      }
      return false;
    }

    // GET
    if (request.method === 'GET') {
      const versionsGetMatch = p.match(/^\/api\/dissections\/(d_[A-Za-z0-9_-]+)\/versions$/);
      if (versionsGetMatch) {
        await handleVersions(request, response, versionsGetMatch[1]);
        return true;
      }
      const versionGetMatch = p.match(/^\/api\/dissections\/(d_[A-Za-z0-9_-]+)\/versions\/([A-Za-z0-9_-]+)$/);
      if (versionGetMatch) {
        await handleVersion(request, response, versionGetMatch[1], versionGetMatch[2]);
        return true;
      }
      const shareGetMatch = p.match(/^\/api\/dissections\/(d_[A-Za-z0-9_-]+)\/(?:share|shares)$/);
      if (shareGetMatch) {
        await handleShare(request, response, shareGetMatch[1]);
        return true;
      }
      return false;
    }

    return false;
  }

  return {
    handleCreate,
    handleBatch,
    handleDelete,
    handlePatch,
    handleCancel,
    handleRetry,
    handleSyncCharacters,
    handleVersions,
    handleVersion,
    handleShare,
    handleShareDelete,
    dispatch
  };
}

module.exports = { createPostgresDissectionMutationService };
