'use strict';

const { GenerationError, toPublicError } = require('./errors');
const { transition, isTerminal } = require('./state-machine');
const { buildGenerationManifest, hashValue } = require('./manifest');
const { assembleContext } = require('./context');
const { normalizeChapterContract, contractHash } = require('./contract');
const { auditDraft } = require('./deterministic-audit');
const { applyLocalRevision, MAX_REVISION_ROUNDS } = require('./revision');
const { evaluateQualityGate } = require('./quality-gate');
const { defaultConcurrencyManager } = require('../stability/concurrency');
const { createDeadlineTracker } = require('../stability/deadline');
const scenePlanner = require('../scene-planner');
const LEASE_TTL_MS = 90000;

const ACTIVE_STATES = new Set([
  'created', 'request_validated', 'genre_resolved', 'style_resolved', 'context_built',
  'contract_validated', 'pre_generation_guard', 'scene_planning', 'generating',
  'draft_received', 'deterministic_audit', 'semantic_audit', 'quality_audit', 'revision'
]);

function withIssueIds(audit, sourceHash) {
  if (!audit || !Array.isArray(audit.issues)) return audit;
  return {
    ...audit,
    issues: audit.issues.map((issue, index) => {
      const issueId = String(issue && issue.issueId || `audit_${hashValue({
        sourceHash, index, quote: issue && issue.quote || '', category: issue && issue.category || ''
      }).slice(0, 20)}`);
      return { ...issue, issueId, status: issue && issue.status || 'verified' };
    })
  };
}

function verifiedIssues(result, outputHash) {
  const audits = [result && result.audit, result && result.semanticAudit && result.semanticAudit.audit];
  const issues = audits.flatMap(audit => Array.isArray(audit && audit.issues) ? audit.issues : []);
  const unique = new Map();
  for (const issue of issues) {
    const normalized = withIssueIds({ issues: [issue] }, outputHash).issues[0];
    const id = String(issue && issue.issueId || normalized.issueId);
    if (!unique.has(id)) unique.set(id, { ...normalized, issueId: id });
  }
  return [...unique.values()];
}

function protectedTermsForRevision(request, issue) {
  const quote = String(issue && issue.quote || '');
  const terms = new Set();
  const add = value => {
    const term = typeof value === 'string' ? value.trim() : '';
    if (term.length >= 2 && term.length <= 80 && quote.includes(term)) terms.add(term);
  };
  const collectNames = values => {
    for (const value of Array.isArray(values) ? values : []) add(typeof value === 'string' ? value : value && (value.name || value.id));
  };
  const story = request && request.storyContext || {};
  collectNames(request && request.characters);
  collectNames(story.characters);
  const contract = request && (request.chapterContract || request.contract) || {};
  collectNames(contract.characters);
  for (const key of ['mustPreserve', 'requiredFacts', 'factsToPreserve', 'protectedTerms']) {
    for (const value of Array.isArray(contract[key]) ? contract[key] : []) add(typeof value === 'string' ? value : value && (value.text || value.name || value.id));
  }
  return [...terms];
}

function creditsToMinor(value) {
  const credits = Number(value);
  return Number.isFinite(credits) && credits > 0 ? Math.round(credits * 100) : 0;
}

function usageForProviderCall(call) {
  const usage = call && call.usage && typeof call.usage === 'object' ? call.usage : {};
  return {
    promptTokens: Number(usage.promptTokens ?? usage.prompt_tokens) || 0,
    completionTokens: Number(usage.completionTokens ?? usage.completion_tokens) || 0,
    reasoningTokens: Number(usage.reasoningTokens ?? usage.reasoning_tokens) || 0,
    cachedTokens: Number(usage.cachedTokens ?? usage.cached_tokens ?? usage.cachedInputTokens) || 0,
    reservedCostMinor: creditsToMinor(usage.reservedCost),
    actualCostMinor: creditsToMinor(usage.creditCost),
    costStatus: usage.creditCost != null && Number.isFinite(Number(usage.creditCost)) && Number(usage.creditCost) >= 0 &&
      ['exact', 'settled'].includes(usage.billingStatus) && call.status === 'completed' ? 'settled' : 'pending',
    providerRequestId: String(usage.requestId || call && call.providerRequestId || ''),
    status: String(call && call.status || '')
  };
}

/** 通过注入式步骤与持久化 store 执行服务器权威的生成状态机。 */
function createGenerationOrchestrator(options = {}) {
  const store = options.store;
  const db = options.db;
  const deps = options.dependencies || {};
  const workers = new Map();
  if (!store || !db) throw new TypeError('Generation Orchestrator 需要持久化 store 和数据库');

  /** 将一次状态迁移写入数据库并发布有序事件。 */
  async function move(scope, id, state, event, result, error, manifest) {
    return await store.updateRun(db, { ...scope, id, state, event, result, error, manifest });
  }

  /** 写入阶段状态和确定性输入输出哈希。 */
  async function stage(scope, id, name, status, input, output, details = {}) {
    await store.recordStage(db, {
      ...scope, generationId: id, stage: name, attemptNo: details.attemptNo || 1, status,
      inputHash: hashValue(input || {}), outputHash: output == null ? '' : hashValue(output),
      promptTokens: details.usage && details.usage.promptTokens,
      completionTokens: details.usage && details.usage.completionTokens,
      reasoningTokens: details.usage && details.usage.reasoningTokens,
      cachedTokens: details.usage && details.usage.cachedTokens,
      reservedCostMinor: details.reservedCostMinor,
      actualCostMinor: details.actualCostMinor,
      costStatus: details.costStatus,
      providerRequestId: details.providerRequestId,
      errorCode: details.errorCode,
      startedAt: details.startedAt,
      finishedAt: Date.now()
    });
  }

  /** 运行可重放的阶段序列；供应商结果未知时停止并禁止自动重发。 */
  async function execute(scope, id, executionContext = {}) {
    if (workers.has(id)) return workers.get(id).promise;
    if (scope && scope.projectId) {
      defaultConcurrencyManager.acquireRunLock(scope.projectId, id, { throwOnConflict: false });
    }
    const leaseOwner = require('node:crypto').randomUUID();
    let workerScope = { ...scope };
    let lease = null;
    if (typeof store.acquireLease === 'function') {
      lease = await store.acquireLease(db, { ...scope, id, leaseOwner, ttlMs: LEASE_TTL_MS });
      if (!lease || lease.acquired !== true) return lease && lease.run || await store.getRun(db, { ...scope, id });
      workerScope = { ...scope, leaseOwner, fencingToken: lease.fencingToken };
    }
    const controller = new AbortController();
    const worker = { controller, promise: null, providerStarted: false, providerInFlight: false };
    const renewTimer = lease && typeof store.renewLease === 'function'
      ? setInterval(() => {
          Promise.resolve(store.renewLease(db, { ...scope, id, leaseOwner, fencingToken: lease.fencingToken, ttlMs: LEASE_TTL_MS }))
            .then(renewed => {
              if (!renewed) controller.abort(new GenerationError('PROVIDER_UNKNOWN', '生成任务租约丢失，Provider 结果需要核对', { status: 502, unknown: true }));
            })
            .catch(() => controller.abort(new GenerationError('PROVIDER_UNKNOWN', '生成任务租约续期失败，Provider 结果需要核对', { status: 502, unknown: true })));
        }, Math.floor(LEASE_TTL_MS / 3))
      : null;
    if (renewTimer && typeof renewTimer.unref === 'function') renewTimer.unref();
    worker.promise = run(workerScope, id, controller, {
      ...executionContext,
      onProviderStart: () => {
        worker.providerStarted = true;
        worker.providerInFlight = true;
        if (typeof executionContext.onProviderStart === 'function') executionContext.onProviderStart();
      },
      onProviderComplete: () => {
        worker.providerInFlight = false;
        if (typeof executionContext.onProviderComplete === 'function') executionContext.onProviderComplete();
      }
    }).finally(async () => {
      if (renewTimer) clearInterval(renewTimer);
      if (scope && scope.projectId) {
        defaultConcurrencyManager.releaseRunLock(scope.projectId, id);
      }
      try {
        if (lease && typeof store.releaseLease === 'function') {
          await store.releaseLease(db, { ...scope, id, leaseOwner, fencingToken: lease.fencingToken });
        }
      } finally { workers.delete(id); }
    });
    workers.set(id, worker);
    return worker.promise;
  }

  /** 执行单个 generation run 并在每个阶段边界保存恢复信息。 */
  async function run(scope, id, controller, executionContext = {}) {
    let current = await store.getRun(db, { ...scope, id });
    if (!current) throw new GenerationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', { status: 404 });
    if (isTerminal(current.state) || current.state === 'waiting_author' || current.state === 'needs_human') return current;
    if (current.state === 'cancel_requested') {
      const target = Number(current.attemptNo) > 0 ? 'provider_unknown' : 'cancelled';
      return await move(scope, id, target, {
        message: target === 'provider_unknown' ? 'Provider 调用结果未知，未自动重试' : '生成已取消',
        code: target === 'provider_unknown' ? 'PROVIDER_UNKNOWN' : 'cancelled'
      }, current.result);
    }
    const request = await store.getRunInput(db, { ...scope, id });
    if (!request) throw new GenerationError('RUN_NOT_FOUND', '生成任务输入快照不存在', { status: 404 });
    const runDependencies = typeof options.dependenciesForRun === 'function'
      ? options.dependenciesForRun({ ...executionContext, signal: controller.signal }, request) || deps
      : deps;
    const assertActive = () => {
      if (controller.signal.aborted) throw controller.signal.reason || new GenerationError('MODEL_CONTENT_BLOCKED', '生成已取消', { status: 409 });
    };

    try {
      assertActive();
      if (current.state === 'created') {
        current = await move(scope, id, 'request_validated', { message: '请求已验证' });
      } else if (current.state === 'paused') {
        const resumeState = current.result && current.result.resumeCursor ? current.result.resumeCursor : 'request_validated';
        current = await move(scope, id, resumeState, { message: `从暂停点恢复: ${resumeState}` });
      }

      let genre = request.genre && request.genre !== 'auto' ? { status: 'resolved', confidence: 1, genre: request.genre } : null;
      if (!genre && runDependencies.resolveGenre) genre = await runDependencies.resolveGenre(request);
      if (!genre || genre.status !== 'resolved') {
        return await move(scope, id, 'waiting_author', { message: '题材需要确认', genre }, { genreResolution: genre || { status: 'uncertain', candidates: [] } });
      }
      current = await move(scope, id, 'genre_resolved', { message: '题材已确认', genre });

      const style = runDependencies.resolveStyle ? await runDependencies.resolveStyle(request, genre) : {
        status: request.style ? 'resolved' : 'needs_choice', style: request.style || ''
      };
      if (!style || style.status !== 'resolved') {
        return await move(scope, id, 'waiting_author', { message: '文风需要确认', style }, { genreResolution: genre, styleResolution: style || {} });
      }
      current = await move(scope, id, 'style_resolved', { message: '文风已确认', style });

      const contractInput = request.chapterContract || {
        chapterId: request.chapterId,
        chapterNo: request.chapterNo,
        chapterGoal: request.userInstruction || '推进当前章节合同中的核心目标',
        pov: request.storyContext && request.storyContext.pov || 'third-limited',
        wordBudget: request.modelParams && request.modelParams.wordBudget || {}
      };
      if (contractInput.chapterNo == null && request.chapterNo != null) {
        contractInput.chapterNo = request.chapterNo;
      }
      const contract = normalizeChapterContract(contractInput);
      if (typeof runDependencies.loadAuthoritativeContext !== 'function') {
        throw new GenerationError('MODEL_CONTENT_BLOCKED', '服务端故事状态加载器未配置');
      }
      const authoritative = await runDependencies.loadAuthoritativeContext({ request, contract });
      if (!authoritative || authoritative.ok !== true || !authoritative.storyContext) {
        throw new GenerationError('STATE_CONFLICT', '无法读取服务端权威故事状态，已停止生成', { status: 409 });
      }

      const clientStoryContext = (request && request.storyContext && typeof request.storyContext === 'object') ? request.storyContext : {};
      const clientContinuity = (clientStoryContext.continuity && typeof clientStoryContext.continuity === 'object')
        ? clientStoryContext.continuity
        : ((request.continuity && typeof request.continuity === 'object') ? request.continuity : {});

      const authStoryContext = authoritative.storyContext || {};
      const authContinuity = (authStoryContext.continuity && typeof authStoryContext.continuity === 'object') ? authStoryContext.continuity : {};

      // 深度合并 continuity：权威优先覆盖世界与人物事实，深度保留客户端现场草稿、大纲与下章规划
      const mergedContinuity = {
        ...clientContinuity,
        ...authContinuity
      };
      if (clientContinuity.currentBody && !authContinuity.currentBody) mergedContinuity.currentBody = clientContinuity.currentBody;
      if (clientContinuity.outline && !authContinuity.outline) mergedContinuity.outline = clientContinuity.outline;
      if (clientContinuity.nextChapter && !authContinuity.nextChapter) mergedContinuity.nextChapter = clientContinuity.nextChapter;
      if (clientContinuity.dossier && !authContinuity.dossier) mergedContinuity.dossier = clientContinuity.dossier;
      if (clientContinuity.history && !authContinuity.history) mergedContinuity.history = clientContinuity.history;
      if (clientContinuity.sceneName && !authContinuity.sceneName) mergedContinuity.sceneName = clientContinuity.sceneName;
      if (clientContinuity.chapterTitle && !authContinuity.chapterTitle) mergedContinuity.chapterTitle = clientContinuity.chapterTitle;

      request.storyContext = {
        ...clientStoryContext,
        ...authStoryContext,
        continuity: mergedContinuity
      };
      request.continuity = mergedContinuity;

      // 确保现场大纲和正文草稿作为独立高优先级字段提升到 storyContext 根层级
      if (mergedContinuity.outline && !request.storyContext.currentChapterOutline && !request.storyContext.chapterOutline) {
        request.storyContext.currentChapterOutline = mergedContinuity.outline;
      }
      if (mergedContinuity.currentBody && !request.storyContext.currentBody) {
        request.storyContext.currentBody = mergedContinuity.currentBody;
      }
      if (mergedContinuity.nextChapter && !request.storyContext.nextChapterOutline) {
        request.storyContext.nextChapterOutline = typeof mergedContinuity.nextChapter === 'object' && mergedContinuity.nextChapter.outline
          ? mergedContinuity.nextChapter.outline
          : mergedContinuity.nextChapter;
      }

      if (Object.hasOwn(authStoryContext, 'characters')) request.characters = authStoryContext.characters;
      if (Object.hasOwn(authStoryContext, 'factLedger')) request.factLedger = authStoryContext.factLedger;
      if (Object.hasOwn(authStoryContext, 'previousEnding')) request.previousEnding = authStoryContext.previousEnding;
      if (Object.hasOwn(authStoryContext, 'planText')) request.planText = authStoryContext.planText;
      const sourceContext = { ...(request.storyContext || {}), sceneContract: contract };
      const mechanismCandidates = request.genreMechanisms || genre.mechanisms || style.mechanisms;
      if (mechanismCandidates != null && sourceContext.genreMechanisms == null) sourceContext.genreMechanisms = mechanismCandidates;
      const targetChars = Number(contract.wordBudget && contract.wordBudget.targetChars) || 2400;
      const taskText = request.userInstruction || request.prompt || contract.chapterGoal || '推进当前章节核心目标';
      const genreTitle = typeof genre === 'object' ? genre.genre || genre.id || '通用文学' : String(genre || '通用文学');
      const styleText = typeof style === 'object' ? style.style || style.prompt || '' : String(style || '');
      const compileContext = (scenes = [], scenePlan = null) => {
        const sceneDirectives = scenePlan
          ? scenePlanner.compileSceneDirectives(scenePlan)
          : (scenes.length ? scenes.map((scene, index) => `场景 ${index + 1}: ${scene.goal || scene.purpose || scene.summary || ''}`).join('\n') : '');
        const povDirective = contract.viewpointCharacter
          ? `【限定视点与认知边界】：本章节核心视角人物为【${contract.viewpointCharacter}】。严格遵循限知视角叙事，禁止跨视角描写其余角色的内心独白或视线外行为，所有他者反应均须通过可见的外在神态、对白机锋与现场动作呈现。`
          : '';
        const qualityDirectives = [
          '【正文质感与反套路硬约束】：',
          '- 严禁脸谱化肢体套路：严禁‘嘴角勾起玩味弧度’、‘后槽牙咬得咯咯响’、‘瞳孔骤缩’、‘指节泛白’、‘深吸一口凉气’等机械描写；',
          '- 严禁抽象情绪口号：严禁‘心中涌起难以言喻的暖流/愤怒’，必须通过具体的现场肌肉反应、呼吸变重、手中道具形变或外部物候传达心理；',
          '- 严禁孤立时空硬切：严禁直接以‘三日后’硬切开篇，须有黄昏、残茶或脚步声等微观锚点过渡。'
        ].join('\n');
        const system = [
          `你是专业小说创作者。当前题材归属为【${genreTitle}】。`,
          styleText ? `【文风指导】\n${styleText}` : '',
          povDirective,
          qualityDirectives,
          '只写原创中文小说正文，不输出提纲、前言或总结。紧扣当下人物目标、阻力与现场因果，拒绝空洞套话。',
          sceneDirectives ? `【场景执行合同】\n${sceneDirectives}` : ''
        ].filter(Boolean).join('\n\n');
        const userSuffix = `\n\n【本章创作任务】\n${taskText}\n\n目标篇幅：${targetChars} 字符。请直接输出正文。`;
        const declaredScenes = request.chapterContract && Array.isArray(request.chapterContract.scenes)
          ? request.chapterContract.scenes : [];
        const sceneTags = [
          ...(Array.isArray(request.sceneTags) ? request.sceneTags : []),
          ...(Array.isArray(contract.sceneTags) ? contract.sceneTags : []),
          ...declaredScenes.flatMap(scene => [scene && scene.sceneTags, scene && scene.tags, scene && scene.sceneType]),
          ...scenes.flatMap(scene => [scene && scene.sceneTags, scene && scene.tags, scene && scene.sceneType])
        ];
        return assembleContext(sourceContext, {
          maxChars: request.modelParams && request.modelParams.contextChars,
          model: request.modelId,
          provider: request.provider,
          hardLimit: request.providerContextLimit,
          targetChars,
          maxOutputTokens: Math.max(8192, Math.min(16000, Math.ceil(targetChars * 3.5))),
          system,
          contextWrapperPrefix: '【只读故事上下文】\n',
          contextWrapperSuffix: userSuffix,
          reservedInputTokens: request.modelParams && request.modelParams.contextReserveTokens != null
            ? request.modelParams.contextReserveTokens : 1024,
          sceneTags,
          currentVolumeId: request.currentVolumeId || sourceContext.currentVolumeId || sourceContext.volumeId,
          currentChapterNo: contract.chapterNo || sourceContext.chapterContext && sourceContext.chapterContext.chapterNo,
          currentCharacterIds: contract.characters || []
        });
      };
      let context = compileContext(Array.isArray(contract.scenes) ? contract.scenes : []);
      current = await move(scope, id, 'context_built', { message: '故事上下文已编译', contextPlan: context.contextPlan }, {
        genreResolution: genre, styleResolution: style, contract, contextPlan: context.contextPlan,
        authoritativeStoryContext: request.storyContext,
        stateSnapshot: {
          snapshotHash: String(authoritative.snapshotHash || ''),
          storyContext: request.storyContext
        },
        stateSnapshotHash: String(authoritative.snapshotHash || ''),
        contractHash: contractHash(contract)
      });
      current = await move(scope, id, 'contract_validated', { message: '章节合同已校验' });
      current = await move(scope, id, 'pre_generation_guard', { message: '正在检查人物与世界状态' });

      if (typeof runDependencies.preGenerationGuard !== 'function') {
        throw new GenerationError('MODEL_CONTENT_BLOCKED', 'Pre-generation Guard 未配置');
      }
      const guard = await runDependencies.preGenerationGuard({ request, contract, context: context.text, snapshotHash: authoritative.snapshotHash });
      if (!guard || guard.passed !== true) {
        return await move(scope, id, 'needs_human', { message: '生成前检查发现阻断项', guard }, { ...current.result, guard });
      }
      if (authoritative.snapshotHash && guard.snapshotHash && String(authoritative.snapshotHash) !== String(guard.snapshotHash)) {
        return await move(scope, id, 'needs_human', { message: '生成前作品状态已变化', guard: { passed: false, blockers: [{ issueId: 'state_snapshot_changed', problem: '生成准备期间作品状态发生变化，请重新读取后发起任务' }] } }, {
          ...current.result,
          guard: { passed: false, blockers: [{ issueId: 'state_snapshot_changed', problem: '生成准备期间作品状态发生变化，请重新读取后发起任务' }] }
        });
      }

      let scenes = Array.isArray(contract.scenes) ? contract.scenes : [];
      let scenePlan = null;
      if (scenes.length) {
        await stage(scope, id, 'scene_planning', 'skipped', contract, scenes);
      } else {
        current = await move(scope, id, 'scene_planning', { message: '正在规划场景' });
        if (typeof runDependencies.planScenes !== 'function') {
          throw new GenerationError('MODEL_CONTENT_BLOCKED', 'Scene Planner 未配置');
        }
        const planned = await runDependencies.planScenes({ request, contract, context: context.text, genre, style });
        if (Array.isArray(planned)) scenes = planned;
        else if (planned && Array.isArray(planned.scenes)) { scenePlan = planned; scenes = planned.scenes; }
        if (!scenes.length) throw new GenerationError('MODEL_CONTENT_BLOCKED', 'Scene Planner 未能生成有效场景计划');
        await stage(scope, id, 'scene_planning', 'completed', contract, scenes);
      }

      context = compileContext(scenes, scenePlan);

      const promptInput = { request, contract, context: context.text, contextPlan: context.contextPlan, genre, style, scenes, scenePlan };
      const startedAt = Date.now();
      if (typeof store.beginProvider === 'function') {
        const started = await store.beginProvider(db, { ...scope, id, now: startedAt });
        if (started && started.paused) return started.run;
        current = started && started.run || current;
      } else {
        current = await move(scope, id, 'generating', { message: '正在生成正文' });
      }
      assertActive();
      if (typeof runDependencies.writer !== 'function') throw new GenerationError('MODEL_CONTENT_BLOCKED', 'Writer 未配置');
      let generated = await runDependencies.writer({ ...promptInput, signal: controller.signal, onProgress: event => {
        Promise.resolve().then(() => store.appendEvent(db, { ...scope, id, event: event || {} })).catch(() => {});
      } });
      let rawDraft = String(generated && (generated.text || generated.content) || '');
      const { sanitizeInPlace } = require('./inplace-sanitizer');
      let draft = sanitizeInPlace(rawDraft).text;
      const pipeline = generated && generated.pipeline && generated.pipeline.authoritative === true ? generated.pipeline : null;
      await stage(scope, id, 'writer', 'completed', promptInput, draft, { usage: generated && generated.usage, startedAt, providerRequestId: generated && generated.providerRequestId });
      if (pipeline && Array.isArray(pipeline.calls)) {
        for (const [index, call] of pipeline.calls.entries()) {
          const details = usageForProviderCall(call);
          const callStatus = details.status === 'completed' ? 'completed'
            : details.status === 'failed_or_unknown' || details.status === 'usage_missing' ? 'unknown' : 'failed';
          await stage(scope, id, `provider:${String(call && call.stage || 'writer').slice(0, 48)}`, callStatus,
            { requestHash: call && call.requestHash || '' }, { outputHash: call && call.outputHash || '' }, {
              attemptNo: index + 1,
              usage: call && call.usage ? {
                promptTokens: details.promptTokens, completionTokens: details.completionTokens,
                reasoningTokens: details.reasoningTokens, cachedTokens: details.cachedTokens
              } : null,
              reservedCostMinor: details.reservedCostMinor,
              actualCostMinor: details.actualCostMinor,
              costStatus: details.costStatus,
              providerRequestId: details.providerRequestId,
              startedAt: call && call.startedAt ? Date.parse(call.startedAt) : startedAt,
              errorCode: callStatus === 'unknown' ? 'PROVIDER_UNKNOWN' : ''
            });
        }
      }
      if (!draft) throw new GenerationError('MODEL_EMPTY', '模型未返回正文', { status: 502, retryable: true });
      const writerManifest = (pipeline && pipeline.manifest) || (generated && generated.manifest);
      if (!writerManifest || typeof writerManifest !== 'object') {
        throw new GenerationError('MODEL_CONTENT_BLOCKED', 'Writer 未返回可信 Generation Manifest');
      }
      const expectedChapterId = String(request.chapterId || contract.chapterId || '');
      if (String(writerManifest.generationId || '') !== id || String(writerManifest.projectId || '') !== scope.projectId ||
          String(writerManifest.chapterId || '') !== expectedChapterId ||
          String(writerManifest.outputHash || '') !== hashValue(draft) || !writerManifest.contextHash ||
          !writerManifest.contractHash || !writerManifest.promptHash || !writerManifest.pipelineVersion) {
        throw new GenerationError('MODEL_CONTENT_BLOCKED', 'Writer Manifest 与本次运行正文或上下文不匹配');
      }
      const draftManifest = writerManifest;
      // 智能检测结尾未闭合与非正常截断 (DEF-TRUNCATE-001)
      const trimmedDraft = draft.trim();
      const hasTerminalPunctuation = /[。！？……”’]$/.test(trimmedDraft);
      const isSuspectedTruncated = !hasTerminalPunctuation && trimmedDraft.length >= 300 && (Number(contract.wordBudget && contract.wordBudget.minChars) ? trimmedDraft.length < Number(contract.wordBudget.minChars) : false);

      current = await move(scope, id, 'draft_received', { message: '正文已收到' }, {
        ...current.result, draft, isSuspectedTruncated, ...(pipeline ? { benchmark: pipeline } : {}),
        contextPlan: (pipeline && pipeline.contextPlan) || context.contextPlan,
        deterministicAudit: null
      }, undefined, draftManifest);

      let revisionRound = Math.max(0, Number(current.result && current.result.revisionRound) || 0);
      let finalAudit = null;
      let semantic = null;
      let quality = null;
      while (true) {
        current = await move(scope, id, 'deterministic_audit', { message: '正在检查正文结构与证据' });
        assertActive();
        if (typeof runDependencies.deterministicAudit === 'function') {
          finalAudit = await runDependencies.deterministicAudit({
            draft, request, contract, context: context.text, signal: controller.signal, attempt: revisionRound + 1
          });
        } else if (pipeline && pipeline.deterministicAudit) {
          finalAudit = pipeline.deterministicAudit;
        } else {
          finalAudit = auditDraft({
            text: draft,
            minChars: Number(contract.wordBudget && contract.wordBudget.minChars) || 0,
            maxChars: Number(contract.wordBudget && contract.wordBudget.maxChars) || 0
          });
        }
        if (!finalAudit || typeof finalAudit !== 'object') {
          finalAudit = { passed: false, issues: [{ severity: 'blocker', status: 'verified', quote: draft.slice(0, 50), problem: '确定性审计结果无效' }] };
        }
        if (!Array.isArray(finalAudit.issues)) finalAudit.issues = [];
        if (finalAudit.blockerCount === undefined) {
          finalAudit.blockerCount = finalAudit.issues.filter(item => item && item.severity === 'blocker' && item.status !== 'unverified').length;
        }
        if (finalAudit.passed === undefined) {
          finalAudit.passed = finalAudit.blockerCount === 0 && (Number(finalAudit.unverifiedCount) || 0) === 0;
        }

        await stage(scope, id, 'deterministic_audit', finalAudit.passed ? 'completed' : 'failed', draft, finalAudit, { attemptNo: revisionRound + 1 });
        if (!finalAudit.passed) {
          const blocker = finalAudit.issues.find(item => item && item.severity === 'blocker');
          if (!blocker || blocker.status !== 'verified' || revisionRound >= MAX_REVISION_ROUNDS || typeof runDependencies.revise !== 'function') {
            return await move(scope, id, 'needs_human', { message: '确定性审计需要人工复核', audit: finalAudit }, { ...current.result, draft, audit: finalAudit });
          }
          current = await move(scope, id, 'revision', { message: `正在局部修订（${revisionRound + 1}/${MAX_REVISION_ROUNDS}）`, issueId: blocker.issueId });
          const window = require('./revision').locateReplacementWindow(draft, blocker.quote);
          if (!window.ok) return await move(scope, id, 'needs_human', { message: '审计证据无法唯一定位', reason: window.reason });
          assertActive();
          const { routeRepairStrategy } = require('../composition/audit-repair/targeted-repair-router');
          const repairPlan = routeRepairStrategy(blocker, draft, { contract, request });
          const revised = await runDependencies.revise({ request, contract, issue: blocker, window, round: revisionRound, signal: controller.signal, repairPlan });
          const applied = applyLocalRevision({
            text: draft, quote: blocker.quote, replacement: revised && revised.replacement,
            protectedTerms: revised && revised.preservedFacts, round: revisionRound
          });
          if (!applied.ok) return await move(scope, id, 'needs_human', { message: '局部修订未通过语义保留检查', revision: applied });
          draft = applied.text;
          revisionRound += 1;
          continue;
        }

        current = await move(scope, id, 'semantic_audit', { message: '正在进行语义审计' });
        assertActive();
        if (typeof runDependencies.semanticAudit === 'function') {
          semantic = await runDependencies.semanticAudit({
            draft, request, contract, context: context.text, genre, style, signal: controller.signal, attempt: revisionRound + 1
          });
        } else if (pipeline && (pipeline.semanticAudit || pipeline.audit)) {
          semantic = pipeline.semanticAudit || pipeline.audit;
        } else {
          semantic = { passed: true, status: 'NOT_REQUESTED', issues: [] };
        }
        if (!semantic || typeof semantic !== 'object') {
          semantic = { passed: false, status: 'EVALUATION_FAILED', issues: [{ severity: 'blocker', status: 'verified', quote: draft.slice(0, 50), problem: '语义审计结果无效' }] };
        }
        if (!Array.isArray(semantic.issues)) semantic.issues = [];
        if (semantic.status === 'EVALUATION_FAILED') {
          semantic.passed = false;
        } else if (semantic.passed === undefined) {
          const blockers = semantic.issues.filter(i => i && i.severity === 'blocker' && (i.status === 'verified' || !i.status));
          semantic.passed = blockers.length === 0;
        }

        const semanticAuditRecord = semantic.audit || semantic;
        await stage(scope, id, 'semantic_audit', semantic.passed ? 'completed' : 'failed', draft, semanticAuditRecord, { attemptNo: revisionRound + 1, usage: semantic.usage });
        if (!semantic.passed) {
          const blocker = semantic.issues.find(item => item && item.severity === 'blocker');
          if (!blocker || blocker.status !== 'verified' || revisionRound >= MAX_REVISION_ROUNDS || typeof runDependencies.revise !== 'function') {
            return await move(scope, id, 'needs_human', { message: '语义审计需要人工复核', audit: semanticAuditRecord }, { ...current.result, draft, audit: finalAudit, semanticAudit: semanticAuditRecord });
          }
          current = await move(scope, id, 'revision', { message: `正在局部修订（${revisionRound + 1}/${MAX_REVISION_ROUNDS}）`, issueId: blocker.issueId });
          const window = require('./revision').locateReplacementWindow(draft, blocker.quote);
          if (!window.ok) return await move(scope, id, 'needs_human', { message: '审计证据无法唯一定位', reason: window.reason });
          assertActive();
          const { routeRepairStrategy: routeRepair } = require('../composition/audit-repair/targeted-repair-router');
          const semanticRepairPlan = routeRepair(blocker, draft, { contract, request });
          const revised = await runDependencies.revise({ request, contract, issue: blocker, window, round: revisionRound, signal: controller.signal, repairPlan: semanticRepairPlan });
          const applied = applyLocalRevision({ text: draft, quote: blocker.quote, replacement: revised && revised.replacement, protectedTerms: revised && revised.preservedFacts, round: revisionRound });
          if (!applied.ok) return await move(scope, id, 'needs_human', { message: '局部修订未通过语义保留检查', revision: applied });
          draft = applied.text;
          revisionRound += 1;
          continue;
        }

        current = await move(scope, id, 'quality_audit', { message: '正在生成质量向量' });
        assertActive();
        let candidateQuality = null;
        if (typeof runDependencies.qualityAudit === 'function') {
          candidateQuality = await runDependencies.qualityAudit({
            draft, request, contract, genre, style, signal: controller.signal, attempt: revisionRound + 1
          });
        } else if (pipeline && (pipeline.quality || pipeline.qualityVector || (pipeline.audit && pipeline.audit.quality))) {
          candidateQuality = pipeline.quality || (pipeline.audit && pipeline.audit.quality) || null;
          if (!candidateQuality && pipeline.qualityVector) {
            candidateQuality = { passed: false, qualityVector: pipeline.qualityVector, status: 'NOT_MEASURED' };
          }
        }
        const qualityGateResult = evaluateQualityGate({
          draft,
          quality: candidateQuality,
          genre,
          contract,
          audit: finalAudit,
          semanticAudit: semantic
        });
        quality = qualityGateResult.quality;
        await stage(scope, id, 'quality_audit', qualityGateResult.passed ? 'completed' : 'failed', draft, quality, { attemptNo: revisionRound + 1 });
        if (!qualityGateResult.passed) {
          return await move(scope, id, 'needs_human', {
            message: qualityGateResult.reason || '质量审计需要人工复核',
            code: qualityGateResult.code || 'QUALITY_UNMEASURED',
            quality
          }, { ...current.result, draft, audit: finalAudit, semanticAudit: semantic, quality });
        }
        break;
      }

      const result = {
        ...current.result,
        draft,
        outputHash: hashValue(draft),
        contract,
        contractHash: contractHash(contract),
        contextPlan: context.contextPlan,
        contextHash: context.contextPlan.contextHash,
        genreResolution: genre,
        styleResolution: style,
        stateSnapshot: {
          snapshotHash: String(authoritative.snapshotHash || (current.result && current.result.stateSnapshotHash) || ''),
          storyContext: request.storyContext
        },
        stateSnapshotHash: String(authoritative.snapshotHash || (current.result && current.result.stateSnapshotHash) || ''),
        promptHash: (current.manifest && current.manifest.promptHash) || draftManifest.promptHash || hashValue(promptInput),
        audit: withIssueIds(finalAudit, hashValue(draft)),
        semanticAudit: semantic && semantic.audit
          ? { ...semantic, audit: withIssueIds(semantic.audit, hashValue(draft)) }
          : semantic,
        quality,
        revisionRound,
        completedAt: Date.now()
      };
      const finalManifest = {
        ...(current.manifest || {}),
        styleBundleHash: (current.manifest && current.manifest.styleBundleHash) || (style ? hashValue(style) : ''),
        genreBundleHash: (current.manifest && current.manifest.genreBundleHash) || (genre ? hashValue(genre) : ''),
        promptHash: (current.manifest && current.manifest.promptHash) || draftManifest.promptHash || hashValue(promptInput),
        stateSnapshotHash: (current.manifest && current.manifest.stateSnapshotHash) || draftManifest.stateSnapshotHash || String(authoritative.snapshotHash || ''),
        contextHash: context.contextPlan.contextHash,
        contractHash: contractHash(contract),
        outputHash: hashValue(draft)
      };
      if (String(finalManifest.outputHash || '') !== hashValue(draft)) throw new GenerationError('MODEL_CONTENT_BLOCKED', 'Writer Manifest 正文摘要发生变化');
      return await move(scope, id, 'waiting_author', { message: '审计通过，等待作者确认' }, result, undefined, finalManifest);
    } catch (error) {
      if (Array.isArray(error && error.generationCalls)) {
        for (const [index, call] of error.generationCalls.entries()) {
          const details = usageForProviderCall(call);
          const callStatus = details.status === 'failed_or_unknown' || details.status === 'usage_missing' ? 'unknown' : 'failed';
          try {
            await stage(scope, id, `provider:${String(call && call.stage || 'writer').slice(0, 48)}`, callStatus,
              { requestHash: call && call.requestHash || '' }, { outputHash: call && call.outputHash || '' }, {
                attemptNo: index + 1,
                usage: call && call.usage ? {
                  promptTokens: details.promptTokens, completionTokens: details.completionTokens,
                  reasoningTokens: details.reasoningTokens, cachedTokens: details.cachedTokens
                } : null,
                reservedCostMinor: details.reservedCostMinor,
                actualCostMinor: details.actualCostMinor,
                costStatus: details.costStatus,
                providerRequestId: details.providerRequestId,
                startedAt: call && call.startedAt ? Date.parse(call.startedAt) : Date.now(),
                errorCode: 'PROVIDER_UNKNOWN'
              });
          } catch (callError) {}
        }
      }
      const publicError = toPublicError(error);
      const state = publicError.unknown ? 'provider_unknown' : 'failed';
      const fresh = await store.getRun(db, { ...scope, id });
      if (fresh && fresh.state === 'cancel_requested') {
        const worker = workers.get(id);
        const providerUnknown = publicError.unknown || Boolean(worker && worker.providerInFlight);
        const target = providerUnknown ? 'provider_unknown' : 'cancelled';
        return await move(scope, id, target, {
          message: providerUnknown ? 'Provider 调用结果未知，未自动重试' : '生成已取消',
          code: providerUnknown ? 'PROVIDER_UNKNOWN' : 'cancelled'
        }, fresh.result, providerUnknown ? { code: 'PROVIDER_UNKNOWN', message: 'Provider 调用结果未知' } : undefined);
      }
      if (fresh && !isTerminal(fresh.state) && transitionAllows(fresh.state, state)) {
        return await move(scope, id, state, { message: publicError.message, code: publicError.code }, fresh.result, publicError);
      }
      throw error;
    }
  }

  /** 查询迁移表，避免失败处理覆盖已由取消或另一个 worker 完成的状态。 */
  function transitionAllows(from, to) {
    try { transition({ state: from }, to); return true; } catch (transitionError) { return false; }
  }

  /** 创建幂等 run 并立即排入后台执行，重复相同请求只返回原 run。 */
  async function create(input, executionContext = {}) {
    const created = await store.createRun(db, input);
    const run = created.run;
    if (run.state === 'created') {
      void execute({ projectId: input.projectId, actorUserId: input.actorUserId, workspaceId: input.workspaceId || '' }, run.id, { ...executionContext, generationId: run.id }).catch(error => {
        if (typeof options.onError === 'function') options.onError(error, run.id);
      });
    }
    return { ...created, run };
  }

  /** 仅在任务等待作者确认且正文摘要匹配时执行一次提交。 */
  async function commit(input, executionContext = {}) {
    const scope = { projectId: String(input.projectId), actorUserId: String(input.actorUserId), workspaceId: String(input.workspaceId || '') };
    const run = await store.getRun(db, { ...scope, id: input.id });
    if (!run) throw new GenerationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', { status: 404 });
    const submittedText = String(input.text || input.payload && (input.payload.text || input.payload.content) || '');
    if (!submittedText || String(input.outputHash || '') !== String(run.result.outputHash || '') || hashValue(submittedText) !== run.result.outputHash) {
      throw new GenerationError('STATE_CONFLICT', '提交正文与审计通过的版本不一致', { status: 409 });
    }
    if (run.state === 'committed') return { run, idempotent: true };
    const recoveringCommit = run.state === 'committing';
    if (run.state !== 'waiting_author' && !recoveringCommit) throw new GenerationError('STATE_CONFLICT', '生成任务尚未准备好提交', { status: 409 });
    const commitGateResult = evaluateQualityGate({
      draft: submittedText,
      quality: run.result && run.result.quality,
      genre: run.result && run.result.genreResolution,
      contract: run.result && run.result.contract,
      audit: run.result && run.result.audit,
      semanticAudit: run.result && run.result.semanticAudit
    });
    if (!commitGateResult.passed) {
      throw new GenerationError('QUALITY_UNMEASURED', commitGateResult.reason || '正文文学质量未真实测量或证据不足，不能提交正式章节', { status: 422 });
    }
    const request = await store.getRunInput(db, { ...scope, id: run.id });
    const runDependencies = typeof options.dependenciesForRun === 'function'
      ? options.dependenciesForRun(executionContext, request || {}) || deps
      : deps;
    if (typeof runDependencies.commit !== 'function') throw new GenerationError('STATE_CONFLICT', '当前运行环境没有配置正式章节提交服务', { status: 409 });
    if (typeof store.acquireLease !== 'function' || typeof store.renewLease !== 'function' || typeof store.releaseLease !== 'function') {
      throw new GenerationError('STATE_CONFLICT', '当前运行环境不支持带 fencing 的章节提交', { status: 409 });
    }
    let workerScope = scope;
    let lease = null;
    let renewTimer = null;
    let renewal = Promise.resolve();
    let leaseLost = false;
    let commitStarted = false;
    let retainLeaseForRecovery = false;
    try {
      const leaseOwner = require('node:crypto').randomUUID();
      lease = await store.acquireLease(db, { ...scope, id: run.id, leaseOwner, leasePurpose: 'commit', ttlMs: LEASE_TTL_MS });
      if (!lease || lease.acquired !== true) throw new GenerationError('STATE_CONFLICT', '提交任务正在其他 worker 中执行', { status: 409 });
      workerScope = { ...scope, leaseOwner, fencingToken: lease.fencingToken };
      renewTimer = setInterval(() => {
        renewal = Promise.resolve(store.renewLease(db, { ...scope, id: run.id, leaseOwner, fencingToken: lease.fencingToken, ttlMs: LEASE_TTL_MS }))
          .then(renewed => { if (!renewed) leaseLost = true; })
          .catch(() => { leaseLost = true; });
      }, Math.floor(LEASE_TTL_MS / 3));
      if (typeof renewTimer.unref === 'function') renewTimer.unref();
      const leasedRun = await store.getRun(db, { ...scope, id: run.id });
      if (!recoveringCommit) await move(workerScope, run.id, 'committing', { message: '正在提交正文' });
      if (leaseLost) {
        retainLeaseForRecovery = true;
        throw new GenerationError('STATE_CONFLICT', '提交任务租约已丢失，提交操作未开始', { status: 409 });
      }
      commitStarted = true;
      const receipt = await runDependencies.commit({
        run: { ...leasedRun, leaseOwner: workerScope.leaseOwner || '', fencingToken: workerScope.fencingToken },
        request, payload: input.payload, text: submittedText
      });
      if (!receipt || receipt.committed === false) throw new GenerationError('STATE_CONFLICT', '提交服务未确认写入', { status: 409 });
      const current = await store.getRun(db, { ...scope, id: run.id });
      const next = await move(workerScope, run.id, 'committed', { message: '章节已提交', receipt }, { ...current.result, commitReceipt: receipt });
      return { run: next, receipt, idempotent: false };
    } catch (error) {
      if (commitStarted) {
        retainLeaseForRecovery = true;
      } else {
        const current = await store.getRun(db, { ...scope, id: run.id });
        const target = error && error.unknown ? 'provider_unknown' : 'failed';
        if (current && transitionAllows(current.state, target)) {
          try {
            await move(workerScope, run.id, target, { message: toPublicError(error).message, code: error.code }, current.result, toPublicError(error));
          } catch (moveError) {}
        }
      }
      throw error;
    } finally {
      if (renewTimer) clearInterval(renewTimer);
      await renewal.catch(() => {});
      if (lease && !retainLeaseForRecovery && typeof store.releaseLease === 'function') {
        await store.releaseLease(db, { ...scope, id: run.id, leaseOwner: workerScope.leaseOwner, fencingToken: lease.fencingToken });
      }
    }
  }

  /** 只接受服务端审计证据中的唯一 quote，并在两轮总上限内局部修订后重新审计。 */
  async function revise(input, executionContext = {}) {
    const scope = { projectId: String(input.projectId), actorUserId: String(input.actorUserId), workspaceId: String(input.workspaceId || '') };
    const run = await store.getRun(db, { ...scope, id: input.id });
    if (!run) throw new GenerationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', { status: 404 });
    if (!['waiting_author', 'needs_human'].includes(run.state)) throw new GenerationError('STATE_CONFLICT', '当前任务状态不允许局部修订', { status: 409 });
    const result = run.result || {};
    const text = String(result.draft || '');
    if (!text || hashValue(text) !== String(result.outputHash || '')) throw new GenerationError('STATE_CONFLICT', '当前正文摘要无效，请重新读取任务', { status: 409 });
    if (!/^[a-f0-9]{64}$/i.test(String(input.outputHash || ''))) {
      throw new GenerationError('STATE_CONFLICT', '局部修订必须提供当前正文 outputHash', { status: 428 });
    }
    if (String(input.outputHash).toLowerCase() !== String(result.outputHash || '').toLowerCase()) {
      throw new GenerationError('STATE_CONFLICT', '正文已变化，请基于最新审计重新修订', { status: 409 });
    }
    const revisionRound = Math.max(0, Number(result.revisionRound) || 0);
    if (revisionRound >= MAX_REVISION_ROUNDS) throw new GenerationError('REVISION_EXHAUSTED', '局部修订已达到两轮上限', { status: 409 });
    const request = await store.getRunInput(db, { ...scope, id: run.id });
    if (!request) throw new GenerationError('RUN_NOT_FOUND', '生成任务输入快照不存在', { status: 404 });
    const issues = verifiedIssues(result, result.outputHash);
    const issue = issues.find(item => String(item.issueId) === String(input.issueId || ''));
    if (!issue || issue.status !== 'verified' || typeof issue.quote !== 'string' || issue.quote.trim().length < 6) {
      throw new GenerationError('AUDIT_BLOCKED', '修订目标不属于当前正文的已验证审计证据', { status: 409 });
    }
    if (String(input.quote || '') !== issue.quote) throw new GenerationError('STATE_CONFLICT', '修订证据与审计原文不一致', { status: 409 });
    const window = require('./revision').locateReplacementWindow(text, issue.quote);
    if (!window.ok) throw new GenerationError('AUDIT_BLOCKED', '审计证据无法在当前正文中唯一定位', { status: 409 });
    const submittedWindow = input.replacementWindow && typeof input.replacementWindow === 'object' ? input.replacementWindow : {};
    if (['before', 'target', 'after'].some(key => String(submittedWindow[key] || '') !== String(window[key] || ''))) {
      throw new GenerationError('STATE_CONFLICT', '修订窗口与服务器当前正文不一致，请重新载入任务', { status: 409 });
    }
    const runDependencies = typeof options.dependenciesForRun === 'function'
      ? options.dependenciesForRun(executionContext, request) || deps
      : deps;
    if ((!String(input.replacement || '').trim() && typeof runDependencies.revise !== 'function') || typeof runDependencies.reaudit !== 'function') {
      throw new GenerationError('STATE_CONFLICT', '当前运行环境没有配置局部修订和复审服务', { status: 409 });
    }

    await move(scope, run.id, 'revision', { message: `正在局部修订（${revisionRound + 1}/${MAX_REVISION_ROUNDS}）`, issueId: issue.issueId });
    let revision;
    if (String(input.replacement || '').trim()) {
      revision = {
        quote: issue.quote,
        replacement: String(input.replacement),
        preservedFacts: Array.isArray(input.preservedFacts) ? input.preservedFacts.map(String).slice(0, 32) : [],
        usage: null
      };
    } else {
      try {
        revision = await runDependencies.revise({ request, contract: result.contract, issue, window, round: revisionRound, signal: executionContext.signal });
      } catch (error) {
        const publicError = toPublicError(error);
        const target = publicError.unknown ? 'provider_unknown' : 'needs_human';
        const current = await store.getRun(db, { ...scope, id: run.id });
        if (current && transitionAllows(current.state, target)) {
          await move(scope, run.id, target, { message: publicError.message, code: publicError.code }, current.result, publicError);
        }
        throw error;
      }
    }
    if (revision && revision.quote != null && String(revision.quote) !== issue.quote) {
      await move(scope, run.id, 'needs_human', { message: '模型返回的修订证据与原文不一致' }, run.result);
      throw new GenerationError('AUDIT_BLOCKED', '模型返回的修订证据与原文不一致', { status: 409 });
    }
    const applied = applyLocalRevision({
      text, quote: issue.quote, replacement: revision && revision.replacement,
      protectedTerms: [...protectedTermsForRevision(request, issue), ...(Array.isArray(revision && revision.preservedFacts) ? revision.preservedFacts : [])],
      round: revisionRound
    });
    if (!applied.ok) {
      await move(scope, run.id, 'needs_human', { message: '局部修订未通过语义保留检查', revision: applied }, run.result);
      throw new GenerationError('AUDIT_BLOCKED', '局部修订未通过语义保留检查', { status: 409, details: applied });
    }

    const nextResult = {
      ...result,
      originalDraft: result.originalDraft || result.draft || text,
      draft: applied.text,
      revisions: [...(result.revisions || []), applied],
      outputHash: hashValue(applied.text),
      revisionRound: revisionRound + 1,
      lastRevision: { issueId: issue.issueId, quote: issue.quote, replacement: revision.replacement, meaning: applied.meaning, at: Date.now() }
    };
    await stage(scope, run.id, 'revision_apply', 'completed', window, { replacementHash: hashValue(revision.replacement) }, {
      attemptNo: revisionRound + 1,
      usage: revision.usage,
      reservedCostMinor: creditsToMinor(revision.usage && revision.usage.reservedCost),
      actualCostMinor: creditsToMinor(revision.usage && revision.usage.creditCost),
      providerRequestId: revision.usage && revision.usage.requestId
    });
    await move(scope, run.id, 'deterministic_audit', { message: '正在复核修订正文' }, nextResult);
    let review;
    try {
      review = await runDependencies.reaudit({ request, contract: result.contract, draft: applied.text, signal: executionContext.signal });
    } catch (error) {
      const publicError = toPublicError(error);
      const target = publicError.unknown ? 'provider_unknown' : 'needs_human';
      const current = await store.getRun(db, { ...scope, id: run.id });
      if (current && transitionAllows(current.state, target)) {
        await move(scope, run.id, target, { message: publicError.message, code: publicError.code }, nextResult, publicError);
      }
      throw error;
    }
    const deterministicAudit = review && review.deterministicAudit || auditDraft({ text: applied.text });
    const semanticAudit = withIssueIds(review && review.audit || { passed: false, issues: [] }, nextResult.outputHash);
    await stage(scope, run.id, 'deterministic_audit', deterministicAudit.passed ? 'completed' : 'failed', applied.text, deterministicAudit, { attemptNo: revisionRound + 2 });
    await move(scope, run.id, 'semantic_audit', { message: '正在复核语义证据' }, { ...nextResult, audit: deterministicAudit, semanticAudit: { passed: semanticAudit.passed === true, audit: semanticAudit, issues: semanticAudit.issues || [], usage: review && review.usage } });
    await stage(scope, run.id, 'semantic_audit', semanticAudit.passed ? 'completed' : 'failed', applied.text, semanticAudit, {
      attemptNo: revisionRound + 2,
      usage: review && review.usage,
      reservedCostMinor: creditsToMinor(review && review.usage && review.usage.reservedCost),
      actualCostMinor: creditsToMinor(review && review.usage && review.usage.creditCost)
    });
    await move(scope, run.id, 'quality_audit', { message: '正在复核修订后的质量' });
    let freshQuality = review && review.quality || null;
    if (!freshQuality && typeof runDependencies.qualityAudit === 'function') {
      try {
        freshQuality = await runDependencies.qualityAudit({
          draft: applied.text, request, contract: result.contract, genre: result.genreResolution, signal: executionContext.signal
        });
      } catch (error) {
        const publicError = toPublicError(error);
        if (publicError.unknown) {
          const current = await store.getRun(db, { ...scope, id: run.id });
          if (current && transitionAllows(current.state, 'provider_unknown')) {
            await move(scope, run.id, 'provider_unknown', { message: publicError.message, code: publicError.code }, nextResult, publicError);
          }
          throw error;
        }
      }
    }
    const revisionGate = evaluateQualityGate({
      draft: applied.text,
      quality: freshQuality,
      genre: result.genreResolution,
      contract: result.contract,
      audit: deterministicAudit,
      semanticAudit
    });
    const quality = revisionGate.quality;
    await stage(scope, run.id, 'quality_audit', revisionGate.passed ? 'completed' : 'failed', applied.text, quality, { attemptNo: revisionRound + 2 });
    const passed = deterministicAudit.passed === true && semanticAudit.passed === true && review && review.passed === true && revisionGate.passed === true;
    const finalResult = {
      ...nextResult,
      audit: deterministicAudit,
      semanticAudit: { passed: semanticAudit.passed === true, audit: semanticAudit, issues: semanticAudit.issues || [], usage: review && review.usage },
      quality
    };
    const updated = await move(scope, run.id, passed ? 'waiting_author' : 'needs_human', {
      message: passed ? '修订已通过复审，等待作者确认' : (revisionGate.passed ? '修订后仍有问题，需要人工复核' : (revisionGate.reason || '修订正文质量未真实测量或证据不足，需要人工复核')),
      code: passed ? undefined : (revisionGate.code || 'QUALITY_UNMEASURED'),
      audit: semanticAudit,
      quality
    }, finalResult);
    return { run: updated, revision: applied, idempotent: false };
  }

  /** 请求取消并中止当前供应商请求，不为未知请求自动重发。 */
  async function cancel(input) {
    const scope = { projectId: String(input.projectId), actorUserId: String(input.actorUserId), workspaceId: String(input.workspaceId || '') };
    const run = await store.getRun(db, { ...scope, id: input.id });
    if (!run) throw new GenerationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', { status: 404 });
    if (isTerminal(run.state)) return run;
    if (run.state === 'committing') throw new GenerationError('STATE_CONFLICT', '正文提交已开始，不能再取消', { status: 409 });
    if (run.state === 'cancel_requested') return run;
    const next = ['waiting_author', 'paused', 'needs_human'].includes(run.state) ? 'cancelled' : 'cancel_requested';
    const updated = await move(scope, run.id, next, { message: '已收到取消请求' });
    const worker = workers.get(run.id);
    if (worker && worker.controller) worker.controller.abort(new GenerationError('MODEL_CONTENT_BLOCKED', '用户取消了生成', { status: 409 }));
    return updated;
  }

  /** SSE 断开只取消仍在生成中的任务，保留已进入作者确认的结果。 */
  async function cancelOnDisconnect(input) {
    const scope = { projectId: String(input.projectId), actorUserId: String(input.actorUserId), workspaceId: String(input.workspaceId || '') };
    const run = await store.getRun(db, { ...scope, id: input.id });
    if (!run || !ACTIVE_STATES.has(String(run.state || ''))) return run;
    return cancel({ ...scope, id: run.id });
  }

  async function pause(input) {
    const scope = { projectId: String(input.projectId), actorUserId: String(input.actorUserId), workspaceId: String(input.workspaceId || '') };
    if (typeof store.requestPause !== 'function') throw new GenerationError('STATE_CONFLICT', '当前运行环境不支持任务暂停', { status: 409 });
    return store.requestPause(db, { ...scope, id: input.id });
  }

  async function resume(input, executionContext = {}) {
    const scope = { projectId: String(input.projectId), actorUserId: String(input.actorUserId), workspaceId: String(input.workspaceId || '') };
    if (typeof store.resumeRun !== 'function') throw new GenerationError('STATE_CONFLICT', '当前运行环境不支持任务恢复', { status: 409 });
    const run = await store.resumeRun(db, { ...scope, id: input.id });
    void execute(scope, run.id, { ...executionContext, generationId: run.id }).catch(error => {
      if (typeof options.onError === 'function') options.onError(error, run.id);
    });
    return { run, resumed: true };
  }

  async function recover(scope = {}, now = Date.now()) {
    if (typeof store.recoverExpiredRuns !== 'function') return { supported: false };
    const legacyNow = typeof scope === 'number' ? scope : null;
    const actorScope = typeof scope === 'string'
      ? { actorUserId: scope }
      : scope && typeof scope === 'object' ? scope : {};
    return { supported: true, ...(await store.recoverExpiredRuns(db, { ...actorScope, now: legacyNow || now })) };
  }

  /** 由跨实例持久通知中止本地 worker，不修改已提交的 Generation Run 状态。 */
  function abortWorker(id) {
    const worker = workers.get(String(id || ''));
    if (!worker || !worker.controller || worker.controller.signal.aborted) return false;
    worker.controller.abort(new GenerationError('CANCEL_REQUESTED', '收到跨实例取消请求', { status: 409 }));
    return true;
  }

  /**
   * 从生成任务 ID 恢复完整的重放上下文，满足 P4 验收：
   * contract, contextPlan, stateSnapshot, styleBundle, genreProfile, promptHash
   * 确保做到 replayable = true
   */
  async function getReplay(scope, id) {
    const run = await store.getRun(db, { ...scope, id });
    if (!run) throw new GenerationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', { status: 404 });
    const input = await store.getRunInput(db, { ...scope, id });
    const result = run.result || {};
    const manifest = run.manifest || {};

    const contract = result.contract || (input && (input.chapterContract || input.contract) ? normalizeChapterContract(input.chapterContract || input.contract) : null);
    const contextPlan = result.contextPlan || null;
    const stateSnapshot = result.stateSnapshot || (result.authoritativeStoryContext ? {
      snapshotHash: result.stateSnapshotHash || manifest.stateSnapshotHash || '',
      storyContext: result.authoritativeStoryContext
    } : (input && input.storyContext ? {
      snapshotHash: result.stateSnapshotHash || manifest.stateSnapshotHash || '',
      storyContext: input.storyContext
    } : null));
    const styleBundle = (result.styleResolution && (result.styleResolution.bundle || result.styleResolution.styleBundle || result.styleResolution)) ||
      (input && (input.styleBundle || input.style)) || null;
    const genreProfile = (result.genreResolution && (result.genreResolution.profile || result.genreResolution.genreProfile || result.genreResolution)) ||
      (input && (input.genreProfile || input.genre)) || null;
    const promptHash = manifest.promptHash || result.promptHash || '';

    const hasAll = Boolean(contract && contextPlan && stateSnapshot && styleBundle && genreProfile && promptHash);

    return {
      generationId: id,
      replayable: hasAll,
      contract,
      contextPlan,
      stateSnapshot,
      styleBundle,
      genreProfile,
      promptHash,
      manifest,
      outputHash: result.outputHash || manifest.outputHash || ''
    };
  }

  return { create, execute, revise, commit, cancel, cancelOnDisconnect, pause, resume, recover, abortWorker, getReplay };
}

module.exports = { createGenerationOrchestrator, ACTIVE_STATES };
