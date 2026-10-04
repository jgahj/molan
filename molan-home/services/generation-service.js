'use strict';

function createGenerationService({
  CLOUD_API_BASE,
  DATA_DIR,
  GenerationError,
  MAX_NOVEL_STATE_BYTES,
  POSTGRES_MODE,
  attachResponseDisconnect,
  authenticateXuanhuanCloud,
  benchmarkPipeline,
  calcWordCount,
  calculateBenchmarkCallTimeoutMs,
  callMolanChat,
  canonicalResolveGenre,
  contentEngine,
  createGenerationOrchestrator,
  creationChapterContext,
  crypto,
  currentDefaultModel,
  dbReady,
  decodePathParam,
  generationManifest,
  generationProviderRequestId,
  generationRunContext,
  generationRunStore,
  generationScenePatch,
  generationV2Enabled,
  generationV2Status,
  getAuthUser,
  getUserByEmail,
  json,
  loadCreationSnapshots,
  loadCurrentBiblePayload,
  path,
  postgresActor,
  postgresRepository,
  projectScope,
  readBody,
  recordChapterCausalDebts,
  requireSqliteForPublic,
  resolveModelForUser,
  responseCors,
  sanitizeNovelStateForStorage,
  getDatabase,
  getNativeCreationRepository = () => null,
  getNativeAppRepository = () => null
}) {
  let orchestrator = null;
  const nativeCreationRepository = () => !POSTGRES_MODE && process.env.MOLAN_APP_STORE === 'json' ? getNativeCreationRepository() : null;
  const generationDatabase = () => POSTGRES_MODE ? postgresRepository : nativeCreationRepository()?.repository || getDatabase();
  function generationRunOrchestrator() {
    if (orchestrator) return orchestrator;
    const store = generationRunStore();
    orchestrator = createGenerationOrchestrator({
      store,
      db: generationDatabase(),
      onError(err, runId) {
        console.error('[generation error in orchestrator]', runId, err);
      },
      dependenciesForRun(executionContext, request) {
        const auth = executionContext.auth;
        const user = executionContext.user;
        const runId = String(executionContext.generationId || '');
        const projectId = String(executionContext.projectId || request.projectId || '');
        const workspaceId = String(executionContext.workspaceId || '');
        const actorUserId = String(executionContext.actorUserId || auth && auth.user && (auth.user.userId || projectScope.stableUserId(auth.user.email)) || '');
        const story = request.storyContext && typeof request.storyContext === 'object' ? request.storyContext : {};
        let pipelineResult = null;
        let writerCallNo = 0;
        return {
          resolveGenre: value => {
            if (value && value.genre && value.genre !== 'auto') {
              return { status: 'resolved', confidence: 1, genre: value.genre, subgenre: value.subgenre || '' };
            }
            return canonicalResolveGenre({
              genre: value && value.genre,
              subgenre: value && value.subgenre,
              title: story.title || request.novelTitle,
              userInstruction: request.userInstruction || request.prompt,
              prompt: request.prompt
            });
          },
          resolveStyle: async (value, genre) => {
            let authoritativeContext = null;
            try {
              const authoritative = await loadAuthoritativeGenerationContext({
                actorUserId, projectId, workspaceId, request: value, contract: value && value.contract
              });
              if (authoritative && authoritative.ok) {
                authoritativeContext = {
                  ...authoritative.storyContext,
                  title: (authoritative.novelState && authoritative.novelState.title) || (authoritative.storyContext && authoritative.storyContext.title),
                  styleDNA: authoritative.styleInfo?.styleDNA || authoritative.novelState?.styleDNA,
                  styleProfile: authoritative.styleInfo?.styleProfile || authoritative.novelState?.styleProfile,
                  narrativeStyle: authoritative.styleInfo?.narrativeStyle || authoritative.novelState?.narrativeStyle || authoritative.novelState?.style,
                  authorDna: authoritative.styleInfo?.authorDna || authoritative.novelState?.authorDna,
                  proseSamples: authoritative.styleInfo?.proseSamples || []
                };
              }
            } catch (authoritativeError) {}
            const { resolveStyle } = require('../lib/style/style-resolver');
            return resolveStyle({
              request: value,
              genre,
              scene: value && (value.scene || (value.storyContext && value.storyContext.currentScene) || (value.chapterContract && value.chapterContract.currentScene)),
              chapterContract: value && (value.chapterContract || value.contract),
              storyContext: value && value.storyContext,
              authoritativeContext
            });
          },
          loadAuthoritativeContext: async ({ request: runRequest, contract }) => loadAuthoritativeGenerationContext({
            actorUserId, projectId, workspaceId, request: runRequest, contract
          }),
          preGenerationGuard: async ({ request: runRequest, contract, snapshotHash }) => {
            const latest = await loadAuthoritativeGenerationContext({ actorUserId, projectId, workspaceId, request: runRequest, contract });
            if (!latest.ok) return { passed: false, snapshotHash: '', blockers: [{ issueId: 'authoritative_context_unavailable', problem: '无法重新读取项目状态或创作圣经' }] };
            if (String(latest.snapshotHash) !== String(snapshotHash || '')) {
              return { passed: false, snapshotHash: latest.snapshotHash, blockers: [{ issueId: 'state_snapshot_changed', problem: '生成准备期间作品状态发生变化，请重新读取后发起任务' }] };
            }
            const known = new Set((latest.storyContext.characters || []).map(character => String(character && (character.name || character.id) || '')).filter(Boolean));
            const declared = [...(Array.isArray(contract.characters) ? contract.characters : []), contract.viewpointCharacter].map(String).filter(Boolean);
            const unknown = known.size ? declared.filter(name => !known.has(name)) : [];
            return {
              passed: unknown.length === 0,
              snapshotHash: latest.snapshotHash,
              blockers: unknown.map(name => ({ issueId: 'unknown_contract_character', problem: `章节合同中的人物「${name}」不在服务端创作圣经中` }))
            };
          },
          planScenes: async ({ request: runRequest, contract }) => {
            const chapter = runRequest.storyContext && runRequest.storyContext.chapterContext || {};
            const outlineNodes = Array.isArray(chapter.scenePlan) && chapter.scenePlan.length
              ? chapter.scenePlan
              : [chapter.goal || contract.chapterGoal];
            return require('../lib/scene-planner').planScenes(outlineNodes, {
              targetWordCount: Number(runRequest.targetWords || contract.wordBudget.targetChars) || 2400
            });
          },
          writer: async ({ request: runRequest, contract: passedContract, scenePlan, scenes, signal, onProgress, context: passedContext, contextPlan: passedContextPlan, genre: passedGenre, style: passedStyle }) => {
            const contract = runRequest.chapterContract || runRequest.contract || passedContract || {
              chapterId: runRequest.chapterId, goal: runRequest.userInstruction || runRequest.prompt
            };
            if (typeof onProgress === 'function') onProgress({ stage: 'writing', message: '正在调用生成与审计管线' });
            try {
              pipelineResult = await contentEngine.generateDraft({
                callModel: (_auth, options) => {
                  if (signal.aborted) throw signal.reason || new Error('生成已取消');
                  const stage = String(options.stage || 'writer');
                  return callMolanChat(String(executionContext.authorization || ''), user, {
                    ...options,
                    requestId: generationProviderRequestId(runId, 'writer', stage, ++writerCallNo),
                    modelId: runRequest.modelId,
                    projectId,
                    workspaceId,
                    onProviderStart: executionContext.onProviderStart,
                    onProviderComplete: executionContext.onProviderComplete,
                    recordId: runId,
                    workflowId: runId,
                    controller: { signal },
                    requireComplete: true
                  });
                },
                auth,
                request: {
                  ...runRequest,
                  generationId: runId,
                  runId,
                  projectId,
                  workspaceId,
                  novelId: runRequest.novelId || projectId,
                  chapterId: runRequest.chapterId
                },
                contract,
                scenePlan: scenePlan || null,
                scenes: scenes || [],
                context: typeof passedContext === 'string' && passedContext ? passedContext : (runRequest.storyContext && runRequest.storyContext.planText) || '',
                contextPlan: passedContextPlan || null,
                genre: passedGenre || runRequest.genre || 'universal',
                style: (passedStyle && typeof passedStyle === 'object') ? (passedStyle.style || passedStyle.prompt || '') : (passedStyle || runRequest.style || story.styleDNA || story.styleProfile || ''),
                signal,
                onProgress
              });
            } catch (error) {
              if (error && (error.code === 'context_budget_exceeded' || error.code === 'CONTEXT_OVERFLOW')) {
                throw Object.assign(new Error(error.message || '上下文超过预算'), { code: 'CONTEXT_OVERFLOW', status: 413 });
              }
              throw error;
            }
  
            const calls = Array.isArray(pipelineResult && pipelineResult.calls) ? pipelineResult.calls : [];
            if (calls.some(call => !call || ['failed_or_unknown', 'usage_missing'].includes(String(call.status || '')))) {
              throw Object.assign(new Error('模型调用结果或用量未知；请查询任务状态，不要自动重试'), {
                code: 'PROVIDER_UNKNOWN', status: 502, unknown: true, generationCalls: calls
              });
            }
            const text = String(pipelineResult && (pipelineResult.text || pipelineResult.draft) || '').trim();
            if (!text) throw Object.assign(new Error('生成管线没有产出正文'), { code: 'MODEL_EMPTY', status: 502 });
            const usage = pipelineResult.usage || {};
            const evidence = pipelineResult.pipeline || {
              authoritative: true,
              status: String(pipelineResult.status || 'needs_review'),
              audit: pipelineResult.semanticAudit && pipelineResult.semanticAudit.audit || pipelineResult.audit || null,
              deterministicAudit: pipelineResult.deterministicAudit || null,
              contextPlan: pipelineResult.contextPlan || null,
              manifest: pipelineResult.manifest || null,
              usage,
              calls: calls.map(call => ({
                stage: String(call && call.stage || ''), modelId: String(call && call.modelId || ''),
                providerModel: String(call && call.providerModel || ''), status: String(call && call.status || ''),
                requestHash: String(call && call.requestHash || ''), outputHash: String(call && call.outputHash || ''),
                startedAt: call && call.startedAt || null, finishedAt: call && call.finishedAt || null,
                usage: call && call.usage ? {
                  requestId: String(call.usage.requestId || ''),
                  promptTokens: Number(call.usage.promptTokens ?? call.usage.prompt_tokens) || 0,
                  completionTokens: Number(call.usage.completionTokens ?? call.usage.completion_tokens) || 0,
                  reasoningTokens: Number(call.usage.reasoningTokens ?? call.usage.reasoning_tokens) || 0,
                  cachedTokens: Number(call.usage.cachedTokens ?? call.usage.cached_tokens ?? call.usage.cachedInputTokens) || 0,
                  totalTokens: Number(call.usage.totalTokens ?? call.usage.total_tokens) || 0,
                  creditCost: call.usage.creditCost == null ? null : Number(call.usage.creditCost),
                  reservedCost: Number(call.usage.reservedCost) || 0,
                  billingStatus: String(call.usage.billingStatus || ''),
                  usageSource: String(call.usage.usageSource || ''),
                  status: String(call.usage.status || '')
                } : null
              })),
              candidates: [{ contentHash: generationManifest.hashValue(text), audit: pipelineResult.semanticAudit, deterministicAudit: pipelineResult.deterministicAudit }],
              selectedHash: generationManifest.hashValue(text),
              rounds: [{ round: pipelineResult.revisionRound || 0, accepted: true, reason: 'content-engine-draft' }],
              quality: pipelineResult.quality,
              qualityVector: pipelineResult.quality && pipelineResult.quality.qualityVector,
              effectiveGenre: String(pipelineResult.effectiveGenre || (passedGenre && passedGenre.genre) || runRequest.genre || '')
            };
            return {
              text,
              usage: { totalTokens: usage.totalTokens, creditCost: usage.creditCost, callCount: usage.callCount, complete: usage.complete },
              providerRequestId: calls.map(call => call && call.usage && call.usage.requestId).filter(Boolean).join(',').slice(0, 240),
              pipeline: evidence
            };
          },
          revise: async ({ request: runRequest, issue, window, round, signal }) => {
            const revision = await callMolanChat(String(executionContext.authorization || ''), user, {
              modelId: runRequest.reviseModelId || runRequest.modelId,
              projectId, workspaceId, recordId: runId, workflowId: runId,
              requestId: generationProviderRequestId(runId, 'revision', issue && issue.issueId || 'manual', Number(round) + 1),
              controller: signal ? { signal } : undefined,
              onProviderStart: executionContext.onProviderStart,
              onProviderComplete: executionContext.onProviderComplete,
              stage: 'revision', jsonMode: true, requireComplete: true,
              maxTokens: 1800, temperature: 0.25, timeoutMs: 120000,
              system: '你是局部修订编辑。只返回严格 JSON：{"quote":"给定原句","replacement":"修订后的目标句","preservedFacts":["原文明确包含且必须保留的事实短语"]}。不得改写窗口外内容，不得增加窗口外没有依据的事实，不得改变人物身份、关系、地点、时间、数字或已发生事件。',
              userPrompt: JSON.stringify({ round: Number(round) + 1, issue: { category: issue.category, severity: issue.severity, problem: issue.problem, fixHint: issue.fixHint }, replacementWindow: window })
            });
            const value = revision && revision.json;
            if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.replacement !== 'string' || !Array.isArray(value.preservedFacts)) {
              throw new GenerationError('AUDIT_BLOCKED', '局部修订模型没有返回有效的 JSON 补丁', { status: 502 });
            }
            return { quote: String(value.quote || ''), replacement: value.replacement, preservedFacts: value.preservedFacts.map(String).slice(0, 32), usage: revision.usage || null };
          },
          reaudit: async ({ request: runRequest, contract, draft, signal, attempt }) => {
            const context = JSON.stringify({ storyContext: runRequest.storyContext || {}, chapterContract: contract || {} });
            let auditCallNo = 0;
            const result = await benchmarkPipeline.auditReviseLoop({
              callModel: (_auditAuth, modelOptions) => callMolanChat(String(executionContext.authorization || ''), user, {
                ...modelOptions, modelId: runRequest.modelId, projectId, workspaceId,
                requestId: generationProviderRequestId(runId, 'reaudit', String(modelOptions.stage || 'semantic_audit'), Number(attempt) + ++auditCallNo),
                controller: signal ? { signal } : undefined,
                onProviderStart: executionContext.onProviderStart,
                onProviderComplete: executionContext.onProviderComplete,
                recordId: runId, workflowId: runId, stage: 'semantic_audit', requireComplete: true
              })
            }, auth, {
              text: draft, context, genre: runRequest.genre, contract, chapterContract: contract,
              factLedger: runRequest.factLedger || runRequest.storyContext && runRequest.storyContext.factLedger,
              continuity: runRequest.continuity || runRequest.storyContext && runRequest.storyContext.continuity,
              previousEnding: runRequest.previousEnding || runRequest.storyContext && runRequest.storyContext.previousEnding,
              characters: runRequest.characters.length ? runRequest.characters : runRequest.storyContext && runRequest.storyContext.characters,
              targetWords: runRequest.targetWords, maxRounds: 0, modelId: runRequest.modelId
            });
            return { audit: result.audit, deterministicAudit: result.deterministicAudit, passed: result.status === 'passed', usage: result.usage };
          },
          commit: nativeCreationRepository() ? async ({ run, request: runRequest, payload, text }) => {
            return nativeCreationRepository().commitChapter({
              userId: actorUserId, projectId: run.projectId, workspaceId: run.workspaceId,
              bookId: String(runRequest.creationBookId || ''), runId: run.id, run,
              leaseOwner: run.leaseOwner, fencingToken: run.fencingToken, payload, text
            });
          } : POSTGRES_MODE ? async ({ run, request: runRequest, payload, text }) => {
            const bookId = String(runRequest.creationBookId || '').trim();
            if (!bookId) throw new GenerationError('STATE_CONFLICT', '生成请求缺少 creationBookId，不能写入正式章节', { status: 409 });
            const commitInput = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
            const detail = commitInput.payload && typeof commitInput.payload === 'object' && !Array.isArray(commitInput.payload) ? commitInput.payload : {};
            if (commitInput.projectId && String(commitInput.projectId) !== String(run.projectId)) {
              throw new GenerationError('STATE_CONFLICT', '提交项目与生成任务不一致', { status: 409 });
            }
            if ((typeof commitInput.content === 'string' && commitInput.content !== text) ||
                (typeof detail.content === 'string' && detail.content !== text)) {
              throw new GenerationError('STATE_CONFLICT', '提交正文与 payload.content 不一致', { status: 409 });
            }
            const contractValue = run.result && run.result.contract || {};
            const chapterMatch = String(runRequest.chapterId || '').match(/(\d+)/);
            const chapterNo = Math.max(1, Number(contractValue.chapterNo || chapterMatch && chapterMatch[1]) || 1);
            const expectedProjectRevision = Number(commitInput.expectedRevision);
            if (!Number.isInteger(expectedProjectRevision) || expectedProjectRevision < 1) {
              throw new GenerationError('STATE_CONFLICT', '提交必须提供已读取的 expectedRevision', { status: 409 });
            }
            const expectedStateVersion = commitInput.baseStateVersion ?? (runRequest.storyContext && (runRequest.storyContext.stateVersion ?? runRequest.storyContext.baseRevision));
            if (!Number.isInteger(Number(expectedStateVersion)) || Number(expectedStateVersion) < 0) {
              throw new GenerationError('STATE_CONFLICT', '提交必须提供已读取的 baseStateVersion', { status: 409 });
            }
            if (Number(expectedProjectRevision) !== Number(runRequest.storyContext && runRequest.storyContext.baseRevision) ||
                Number(expectedStateVersion) !== Number(runRequest.storyContext && runRequest.storyContext.stateVersion)) {
              throw new GenerationError('STATE_CONFLICT', '提交版本与服务端生成时读取的故事状态不一致，请重新生成', { status: 409 });
            }
            const knownBaseHash = String(runRequest.storyContext && (runRequest.storyContext.baseHash || runRequest.storyContext.contentHash) || '');
            if (commitInput.baseHash && knownBaseHash && String(commitInput.baseHash) !== knownBaseHash) {
              throw new GenerationError('STATE_CONFLICT', '提交基线正文已变化，请重新读取后提交', { status: 409 });
            }
            const creation = await postgresRepository.getCreationState(postgresActor(auth), bookId, 0);
            if (!creation || !creation.book || String(creation.book.projectId) !== String(run.projectId) ||
                String(creation.book.workspaceId) !== String(run.workspaceId) ||
                Number(creation.book.currentStateVersion) !== Number(expectedStateVersion)) {
              throw new GenerationError('STATE_CONFLICT', '创作书状态已变化或不属于本次项目，请重新读取后提交', { status: 409 });
            }
            const previousSnapshot = (Array.isArray(creation.snapshots) ? creation.snapshots : [])
              .filter(snapshot => Number(snapshot && snapshot.stateVersion) <= Number(expectedStateVersion))
              .sort((a, b) => Number(b && b.stateVersion) - Number(a && a.stateVersion))[0] || {};
            const projection = require('../lib/generation/commit-projection').deriveGenerationCommitProjection({
              result: run.result, text, previousSnapshot, chapterNo
            });
            const contentHash = generationManifest.hashValue(text);
            const receipt = await postgresRepository.commitChapter({
              userId: postgresActor(auth), workspaceId: run.workspaceId, projectId: run.projectId,
              generationId: run.id, runLeaseOwner: run.leaseOwner, fencingToken: run.fencingToken,
              bookId, chapterNo, content: text, contentHash,
              auditId: `audit_generation_${run.id}`,
              baseStateVersion: Number(expectedStateVersion), expectedProjectRevision,
              actualCost: Math.max(0, Number(run.actualCostMinor) || 0) / 100,
              contentRef: `manuscript:${bookId}:chapter:${chapterNo}`,
              projection
            });
            return { committed: receipt && receipt.ok === true, ...receipt };
          } : async ({ run, request: runRequest, payload, text }) => {
            const actorUserId = String(auth.user.userId || projectScope.stableUserId(auth.user.email));
            const access = projectScope.getNovelAccess(getDatabase(), projectId, actorUserId);
            if (!projectScope.canAccess(access, projectScope.WRITE_ROLES)) {
              throw new GenerationError('STATE_CONFLICT', '当前账户无权提交此项目章节', { status: 403 });
            }
            const memoryWorkflow = require('../lib/memory-workflow');
            return require('../lib/generation/sqlite-commit').commitSqliteChapter(getDatabase(), {
              run, request: runRequest, payload, text, projectAccess: access, actorUserId,
              userEmail: auth.user.email, recordDebts: recordChapterCausalDebts,
              calcWordCount, sanitizeNovelState: sanitizeNovelStateForStorage,
              maxNovelStateBytes: MAX_NOVEL_STATE_BYTES,
              guardNovelWrite: (novelId, revision) => memoryWorkflow.guardNovelWrite(getDatabase(), novelId, revision),
              invalidateChangedSources: novelId => memoryWorkflow.invalidateChangedSources(getDatabase(), novelId)
            });
          },
          getManifest: () => pipelineResult && pipelineResult.manifest || null
        };
      },
      onError: (error, runId) => console.error('[Generation V2 worker]', runId, error && error.code || error)
    });
    return orchestrator;
  }
  
  function generationRequestAuth(req) {
    return CLOUD_API_BASE ? authenticateXuanhuanCloud(req, CLOUD_API_BASE) : getAuthUser(req);
  }
  
  function generationRunError(res, error) {
    if (res.headersSent || res.writableEnded) return;
    const rawCode = String(error && error.code || 'generation_failed');
    const status = Number(error && error.status) || (rawCode === 'idempotency_conflict' ? 409 : 500);
    const idempotencyConflict = rawCode === 'idempotency_conflict';
    json(res, status, {
      ok: false,
      error: idempotencyConflict ? '该 Idempotency-Key 已用于其他请求' : String(error && error.message || '生成任务操作失败'),
      code: idempotencyConflict ? 'IDEMPOTENCY_KEY_REUSED' : rawCode
    });
  }
  
  function generationSseEvent(res, event) {
    if (res.destroyed || res.writableEnded) return false;
    const sequence = Number(event && event.sequence) || 0;
    const name = String(event && event.state || 'progress').replace(/[^a-z0-9_-]/gi, '_');
    const payload = JSON.stringify(event || {});
    return res.write(`id: ${sequence}\nevent: ${name}\ndata: ${payload}\n\n`);
  }
  
  /** 轮询持久事件表并以 SSE 下发，Last-Event-ID/after 可恢复断线游标。 */
  async function streamGenerationEvents(req, res, store, database, scope, initialCursor) {
    res.writeHead(200, {
      ...responseCors(res),
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 1000\n\n');
    let cursor = initialCursor;
    let lastHeartbeat = Date.now();
    const disconnect = attachResponseDisconnect(res, () => {
      void generationRunOrchestrator().cancelOnDisconnect(scope).catch(error => {
        console.error('[generation] SSE 断开后取消任务失败', scope.id, error && error.code || error);
      });
    });
    try {
      while (!disconnect.disconnected && !res.writableEnded) {
        const events = await store.listEvents(database, { ...scope, generationId: scope.id, after: cursor, limit: 500 });
        for (const event of events) {
          if (disconnect.disconnected || res.writableEnded) break;
          generationSseEvent(res, event);
          cursor = Number(event.sequence) || cursor;
        }
        if (disconnect.disconnected || res.writableEnded) break;
        const run = await store.getRun(database, { ...scope, id: scope.id });
        if (!run || ['waiting_author', 'needs_human', 'paused', 'committed', 'cancelled', 'failed', 'provider_unknown', 'rejected'].includes(String(run.state))) break;
        if (Date.now() - lastHeartbeat >= 15000) {
          res.write(`: heartbeat ${Date.now()}\n\n`);
          lastHeartbeat = Date.now();
        }
        await new Promise(resolve => {
          const timer = setTimeout(done, 500);
          function done() {
            clearTimeout(timer);
            res.removeListener('close', done);
            resolve();
          }
          res.once('close', done);
        });
      }
    } finally {
      disconnect.dispose();
      if (!res.destroyed && !res.writableEnded) res.end();
    }
  }
  
  async function generationProjectAccess(actorUserId, projectId, workspaceId = '') {
    if (POSTGRES_MODE) return postgresRepository.getProjectAccess(actorUserId, projectId, workspaceId);
    if (nativeCreationRepository()) return getNativeAppRepository().getAccess({ userId: actorUserId, projectId, workspaceId });
    const access = projectScope.getNovelAccess(getDatabase(), projectId, actorUserId);
    if (access && workspaceId && String(access.workspace_id) !== String(workspaceId)) return null;
    return access;
  }
  
  function generationChatChunk(runId, content = '', state = '', metadata = {}) {
    return `data: ${JSON.stringify({
      id: String(runId), object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: null }],
      generationId: String(runId), generationState: String(state || ''), ...metadata
    })}\n\n`;
  }
  
  async function streamLegacyGenerationChat(req, res, created, scope) {
    const store = generationRunStore();
    const database = generationDatabase();
    const runId = String(created.run && created.run.id || '');
    res.writeHead(200, {
      ...responseCors(res),
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Molan-Generation-Id': runId
    });
    res.write(generationChatChunk(runId, '', created.run && created.run.state, { idempotent: created.idempotent === true }));
    let lastHeartbeat = Date.now();
    const runScope = { ...scope, id: runId };
    const disconnect = attachResponseDisconnect(res, () => {
      void generationRunOrchestrator().cancelOnDisconnect(runScope).catch(error => {
        console.error('[generation] /api/chat 断开后取消任务失败', runId, error && error.code || error);
      });
    });
    try {
      let run = created.run;
      while (!disconnect.disconnected && !res.writableEnded && run && !['waiting_author', 'needs_human', 'committed', 'cancelled', 'failed', 'provider_unknown', 'rejected'].includes(String(run.state))) {
        await new Promise(resolve => setTimeout(resolve, 500));
        if (disconnect.disconnected || res.writableEnded) break;
        run = await store.getRun(database, { ...scope, id: runId });
        if (Date.now() - lastHeartbeat >= 15000 && !disconnect.disconnected && !res.writableEnded) {
          res.write(': generation heartbeat\n\n');
          lastHeartbeat = Date.now();
        }
      }
      if (disconnect.disconnected || res.writableEnded || !run) return;
      const content = String(run.result && run.result.draft || '');
      for (let index = 0; index < content.length; index += 240) {
        if (disconnect.disconnected || res.writableEnded) return;
        res.write(generationChatChunk(runId, content.slice(index, index + 240), run.state));
      }
      res.write(generationChatChunk(runId, '', run.state, {
        generationResult: { state: run.state, outputHash: String(run.result && run.result.outputHash || ''), errorCode: String(run.errorCode || '') }
      }));
      res.write('data: [DONE]\n\n');
    } catch (error) {
      if (!res.destroyed && !res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: { message: String(error && error.message || 'Generation Run 状态读取失败'), code: String(error && error.code || 'generation_failed') }, generationId: runId })}\n\n`);
        res.write('data: [DONE]\n\n');
      }
    } finally {
      disconnect.dispose();
      if (!res.destroyed && !res.writableEnded) res.end();
    }
  }
  
  async function handleLegacyGenerationChat(req, res, auth, input) {
    const actorUserId = String(auth.user.userId || projectScope.stableUserId(auth.user.email));
    const key = String(req.headers['idempotency-key'] || input.idempotencyKey || input.requestId || '').trim();
    if (!key) return json(res, 428, { error: '正式章节生成必须提供稳定的 Idempotency-Key', code: 'IDEMPOTENCY_KEY_REQUIRED' });
    const projectId = String(input.projectId || input.novelId || '').trim();
    if (!projectId) return json(res, 422, { error: '正式章节生成必须提供 projectId', code: 'CONTRACT_INVALID' });
    try {
      const access = await generationProjectAccess(actorUserId, projectId, String(input.workspaceId || ''));
      if (!access || !projectScope.canAccess(access, projectScope.WRITE_ROLES, 'spend')) {
        return json(res, 404, { error: '项目不存在或当前账户无权发起生成', code: 'forbidden' });
      }
      const userMessages = Array.isArray(input.messages) ? input.messages.filter(message => message && message.role === 'user') : [];
      const prompt = String(input.prompt || input.userInstruction || userMessages.map(message => String(message.content || '')).join('\n')).slice(0, 30000);
      const modelId = resolveModelForUser(auth.user, input.modelId || input.model || currentDefaultModel());
      const normalized = generationRunContext.normalizeGenerationRequest({
        ...input, projectId, novelId: input.novelId || projectId, modelId, prompt, userInstruction: input.userInstruction || prompt,
        idempotencyKey: key
      });
      const request = normalized.request;
      const workspaceId = String(access.workspace_id || '');
      const id = crypto.randomUUID();
      const manifest = generationManifest.buildGenerationManifest({
        generationId: id, projectId, chapterId: request.chapterId, modelId,
        promptHash: generationManifest.hashValue({ writingSystem: request.writingSystem, prompt: request.prompt })
      });
      const created = await generationRunOrchestrator().create({
        id, actorUserId, workspaceId, projectId, chapterId: request.chapterId,
        pipelineVersion: 'generation-v2.1', idempotencyKey: normalized.idempotencyKey,
        requestHash: generationRunContext.requestHash(request), request, manifest, modelId
      }, { auth, user: auth.user, authorization: String(req.headers.authorization || ''), actorUserId, projectId, workspaceId });
      const scope = { actorUserId, projectId, workspaceId };
      return await streamLegacyGenerationChat(req, res, created, scope);
    } catch (error) {
      return generationRunError(res, error);
    }
  }
  
  function generationChapterNo(request, contract, book) {
    const match = String(request && request.chapterId || '').match(/(\d+)/);
    return Math.max(1, Number(contract && contract.chapterNo || match && match[1] || Number(book && book.currentChapterNo || book && book.current_chapter_no) + 1) || 1);
  }
  
  function generationPreviousEnding(state, chapterNo) {
    const chapters = (Array.isArray(state && state.volumes) ? state.volumes : []).flatMap(volume =>
      (Array.isArray(volume && volume.chapters) ? volume.chapters : []).map(chapter => ({ ...chapter, volumeTitle: chapter.volumeTitle || volume.title || '' }))
    );
    const chapterNumber = chapter => Number(chapter && (chapter.number || chapter.chapterNo || chapter.chapterIndex))
      || Number(String(chapter && (chapter.id || chapter.chapterId || chapter.title) || '').match(/(\d+)/)?.[1]) || 0;
    const previous = chapters.find(chapter => chapterNumber(chapter) === chapterNo - 1)
      || chapters.filter(chapter => chapterNumber(chapter) > 0 && chapterNumber(chapter) < chapterNo).sort((a, b) => chapterNumber(b) - chapterNumber(a))[0];
    if (!previous) return '';
    const content = Array.isArray(previous.scenes)
      ? previous.scenes.map(scene => typeof scene === 'string' ? scene : String(scene && (scene.content || scene.text) || '')).join('\n')
      : String(previous.content || previous.text || '');
    return content.slice(-2400);
  }
  
  function generationFactLedger(snapshot) {
    const recent = Array.isArray(snapshot && snapshot.recentFacts) ? snapshot.recentFacts : [];
    const ledger = { rules: [], promises: [], updates: [], byEntity: {} };
    for (const fact of recent) {
      if (!fact || typeof fact !== 'object') continue;
      const type = String(fact.sourceType || fact.type || '');
      if (type === 'rule') ledger.rules.push(fact);
      else if (type === 'promise') ledger.promises.push(fact);
      else if (type === 'update') ledger.updates.push(fact);
      else if (type === 'entity' && fact.entity) {
        const entity = String(fact.entity);
        if (!ledger.byEntity[entity]) ledger.byEntity[entity] = [];
        ledger.byEntity[entity].push(fact);
      }
    }
    return ledger;
  }
  
  /** 只从项目权限、创作圣经、持久化快照和作品正文读取生成上下文。 */
  async function loadAuthoritativeGenerationContext(input = {}) {
    const request = input.request || {};
    const actorUserId = String(input.actorUserId || '');
    const projectId = String(input.projectId || request.projectId || '');
    const workspaceId = String(input.workspaceId || '');
    const bookId = String(request.creationBookId || '');
    if (!actorUserId || !projectId || !bookId) return { ok: false, reason: 'generation_scope_incomplete' };
    const access = await generationProjectAccess(actorUserId, projectId, workspaceId);
    if (!access || !projectScope.canAccess(access, projectScope.WRITE_ROLES, 'spend')) return { ok: false, reason: 'generation_scope_forbidden' };
  
    let book;
    let bible;
    let snapshots;
    let novelState = {};
    let projectRevision = 0;
    if (nativeCreationRepository()) {
      const scope = { userId: actorUserId, projectId, workspaceId, bookId };
      try {
        book = await nativeCreationRepository().read(scope);
        bible = await nativeCreationRepository().readBible(scope);
        snapshots = await nativeCreationRepository().snapshots(scope);
        const profile = await getNativeAppRepository().read(scope);
        if (!profile) return { ok: false, reason: 'project_state_missing' };
        novelState = profile.state;
        projectRevision = Number(profile.revision) || 0;
      } catch (error) {
        if (['BOOK_NOT_FOUND', 'FORBIDDEN'].includes(error.code)) return { ok: false, reason: 'creation_book_missing' };
        throw error;
      }
    } else if (POSTGRES_MODE) {
      const creation = await postgresRepository.getCreationState(actorUserId, bookId, 0);
      if (!creation || !creation.book || String(creation.book.projectId) !== projectId || String(creation.book.workspaceId) !== workspaceId) {
        return { ok: false, reason: 'creation_book_missing' };
      }
      const profile = await postgresRepository.getProfile(actorUserId, projectId, workspaceId);
      if (!profile) return { ok: false, reason: 'project_state_missing' };
      book = creation.book;
      bible = creation.bible;
      snapshots = Array.isArray(creation.snapshots) ? creation.snapshots : [];
      novelState = profile.state && typeof profile.state === 'object' ? profile.state : {};
      projectRevision = Number(profile.revision) || Number(access.revision) || 0;
    } else {
      const row = getDatabase().prepare(`SELECT * FROM creation_books
        WHERE id = ? AND workspace_id = ? AND project_id = ?`).get(bookId, workspaceId, projectId);
      if (!row) return { ok: false, reason: 'creation_book_missing' };
      const storedBible = loadCurrentBiblePayload(bookId);
      if (!storedBible) return { ok: false, reason: 'creation_bible_missing' };
      const novelId = String(request.novelId || projectId);
      const novel = getDatabase().prepare(`SELECT state_json, revision FROM novels
        WHERE id = ? AND workspace_id = ? AND project_id = ?`).get(novelId, workspaceId, projectId);
      if (!novel) return { ok: false, reason: 'project_state_missing' };
      book = row;
      bible = { bibleId: storedBible.bibleId, version: storedBible.version, payload: storedBible.payload };
      snapshots = loadCreationSnapshots(bookId, 0);
      try { novelState = sanitizeNovelStateForStorage(JSON.parse(String(novel.state_json || '{}'))); }
      catch (parseError) { return { ok: false, reason: 'project_state_invalid' }; }
      projectRevision = Number(novel.revision) || 0;
    }
  
    const stateVersion = Math.max(0, Number(book.currentStateVersion ?? book.current_state_version) || 0);
    const chapterNo = generationChapterNo(request, input.contract, book);
    const previous = snapshots.filter(snapshot => Number(snapshot && snapshot.stateVersion) <= stateVersion)
      .sort((a, b) => Number(b && b.stateVersion) - Number(a && a.stateVersion))[0] || {};
    const biblePayload = bible && bible.payload && typeof bible.payload === 'object' ? bible.payload : {};
    const planHash = crypto.createHash('sha256').update(JSON.stringify(biblePayload.creationPlan || {}), 'utf8').digest('hex');
    const chapterContext = creationChapterContext(biblePayload, chapterNo);
    const factLedger = generationFactLedger(previous);
    const characters = [...chapterContext.characters, ...chapterContext.characterLibrary];
    const knownNames = new Set(characters.map(character => String(character && (character.name || character.id) || '')).filter(Boolean));
    const characterStates = previous.characterStates && typeof previous.characterStates === 'object' ? previous.characterStates : {};
    for (const [name, state] of Object.entries(characterStates)) {
      if (!knownNames.has(name)) characters.push({ name, ...(state && typeof state === 'object' ? state : { state }) });
    }
    const stateSummary = {
      chapterNo, stateVersion, baseRevision: projectRevision, storyBibleVersion: Number(bible && bible.version) || 0,
      characterStates, relationshipStates: previous.relationshipStates || {}, worldStates: previous.worldStates || {},
      timeline: Array.isArray(previous.timeline) ? previous.timeline : [],
      openForeshadows: Array.isArray(previous.openForeshadows) ? previous.openForeshadows : [],
      recentFacts: Array.isArray(previous.recentFacts) ? previous.recentFacts : []
    };
    let baseHash = String(previous.contentHash || '');
    if (request.sceneId) {
      const located = require('../lib/generation/scene-patch').locateScene(novelState, request.chapterId, request.sceneId);
      if (!located) return { ok: false, reason: 'generation_scene_missing' };
      baseHash = require('../lib/generation/scene-patch').hashSceneText(located.scene.content == null ? '' : located.scene.content);
    }
    const snapshotHash = generationManifest.hashValue({
      projectId, workspaceId, bookId, projectRevision, stateVersion,
      bibleVersion: Number(bible && bible.version) || 0, planHash, previous: previous.id || previous.stateVersion || 0,
      stateSummary
    });
    const storyContext = {
      ...stateSummary,
      bibleVersion: Number(bible && bible.version) || 0,
      planHash,
      baseStateVersion: stateVersion,
      baseHash,
      contentHash: String(previous.contentHash || ''),
      previousEnding: generationPreviousEnding(novelState, chapterNo),
      chapterContext,
      chapterPlan: chapterContext,
      characters,
      factLedger,
      continuity: {
        characters, characterStates, relationships: previous.relationshipStates || {},
        worldStates: previous.worldStates || {}, worldRules: chapterContext.rules,
        timeline: stateSummary.timeline, openForeshadows: stateSummary.openForeshadows
      },
      hardState: { factLedger, characterStates, relationshipStates: previous.relationshipStates || {}, worldStates: previous.worldStates || {} },
      foreshadows: stateSummary.openForeshadows,
      activeCausalDebts: factLedger.promises,
      planText: JSON.stringify(chapterContext).slice(0, 12000)
    };
    const storedStyleDNA = biblePayload.styleDNA || biblePayload.styleDna || novelState.styleDNA || novelState.styleDna || null;
    const storedStyleProfile = biblePayload.styleProfile || novelState.styleProfile || null;
    const storedNarrativeStyle = biblePayload.narrativeStyle || novelState.narrativeStyle || novelState.style || null;
    const storedAuthorDna = biblePayload.authorDna || biblePayload.authorDNA || novelState.authorDna || null;

    const proseSamples = [];
    const extractProseFromChapters = (chapterList) => {
      if (!Array.isArray(chapterList)) return;
      for (const chapterItem of chapterList) {
        if (typeof chapterItem.content === 'string' && chapterItem.content.trim().length >= 15) {
          proseSamples.push(chapterItem.content.trim());
        }
        if (Array.isArray(chapterItem.scenes)) {
          for (const sceneItem of chapterItem.scenes) {
            if (typeof sceneItem.content === 'string' && sceneItem.content.trim().length >= 15) {
              proseSamples.push(sceneItem.content.trim());
            }
          }
        }
      }
    };
    if (Array.isArray(novelState.chapters)) {
      extractProseFromChapters(novelState.chapters);
    }
    if (Array.isArray(novelState.volumes)) {
      for (const volumeItem of novelState.volumes) {
        extractProseFromChapters(volumeItem.chapters);
      }
    }
    if (proseSamples.length === 0 && previous && typeof previous.content === 'string' && previous.content.trim().length >= 15) {
      proseSamples.push(previous.content.trim());
    }

    const styleInfo = {
      styleDNA: storedStyleDNA,
      styleProfile: storedStyleProfile,
      narrativeStyle: storedNarrativeStyle,
      authorDna: storedAuthorDna,
      proseSamples
    };

    return { ok: true, storyContext, snapshotHash, projectRevision, stateVersion, chapterNo, chapterContext, novelState, styleInfo };
  }
  
  function scenePatchError(res, error) {
    if (res.headersSent || res.writableEnded) return;
    const code = String(error && error.code || 'scene_patch_failed');
    const status = Number(error && error.status) || (code === 'revision_conflict' || code === 'base_hash_conflict' ? 409 : 500);
    json(res, status, { ok: false, error: String(error && error.message || '场景保存失败'), code });
  }
  
  function validateScenePatchBody(body) {
    const chapterId = String(body && body.chapterId || '').trim();
    const revision = Number(body && body.revision);
    const baseHash = String(body && body.baseHash || '').trim().toLowerCase();
    if (!chapterId || chapterId.length > 160) throw Object.assign(new Error('chapterId 无效'), { code: 'CONTRACT_INVALID', status: 422 });
    if (!Number.isInteger(revision) || revision < 0) throw Object.assign(new Error('场景差量必须提供有效 revision'), { code: 'revision_required', status: 428 });
    if (!/^[a-f0-9]{64}$/.test(baseHash)) throw Object.assign(new Error('场景差量必须提供 SHA-256 baseHash'), { code: 'base_hash_required', status: 428 });
    return { chapterId, revision, baseHash, operations: body && body.operations };
  }
  
  /** 对单个场景正文应用基于 revision 与正文摘要的差量补丁。 */
  async function handleNovelScenePatch(req, res, novelIdValue, sceneIdValue) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { ok: false, error: '未登录', code: 'unauthorized' });
    if (!requireSqliteForPublic(req, res)) return;
    const novelId = decodePathParam(novelIdValue);
    const sceneId = decodePathParam(sceneIdValue);
    if (!/^n_[A-Za-z0-9]{1,30}$/.test(novelId)) return json(res, 400, { ok: false, error: '小说 id 非法', code: 'invalid_novel_id' });
    if (!sceneId || sceneId.length > 160) return json(res, 400, { ok: false, error: 'sceneId 无效', code: 'invalid_scene_id' });
    try {
      const body = await readBody(req, generationScenePatch.MAX_SCENE_PATCH_BYTES + 8192);
      const patch = validateScenePatchBody(body);
      let state;
      let currentRevision;
      let access;
  
      if (POSTGRES_MODE) {
        const saved = await postgresRepository.patchProfileScene({
          userId: postgresActor(auth), projectId: novelId, chapterId: patch.chapterId,
          sceneId, expectedRevision: patch.revision, baseHash: patch.baseHash,
          operations: patch.operations, maxStateBytes: MAX_NOVEL_STATE_BYTES
        });
        return json(res, 200, { ok: true, ...saved, chapterId: patch.chapterId, sceneId });
      }
  
      if (!dbReady()) return json(res, 503, { ok: false, error: '云端存储不可用', code: 'storage_unavailable' });
      let transaction = false;
      try {
        getDatabase().exec('BEGIN IMMEDIATE');
        transaction = true;
        access = projectScope.getNovelAccess(getDatabase(), novelId, auth.user.userId);
        if (!projectScope.canAccess(access, projectScope.WRITE_ROLES)) {
          getDatabase().exec('ROLLBACK');
          transaction = false;
          return json(res, 404, { ok: false, error: '小说不存在或无权访问', code: 'project_not_found' });
        }
        const row = getDatabase().prepare(`SELECT state_json, revision FROM novels
          WHERE id = ? AND workspace_id = ? AND project_id = ?`).get(novelId, access.workspace_id, access.project_id);
        if (!row) {
          getDatabase().exec('ROLLBACK');
          transaction = false;
          return json(res, 404, { ok: false, error: '小说不存在或无权访问', code: 'project_not_found' });
        }
        currentRevision = Number(row.revision) || 0;
        if (currentRevision !== patch.revision) {
          getDatabase().exec('ROLLBACK');
          transaction = false;
          return json(res, 409, { ok: false, error: '小说 revision 已变化，请重新读取', code: 'revision_conflict', revision: currentRevision });
        }
        require('../lib/memory-workflow').guardNovelWrite(getDatabase(), novelId, patch.revision);
        try { state = sanitizeNovelStateForStorage(JSON.parse(String(row.state_json || '{}'))); }
        catch (_) { throw Object.assign(new Error('state_json 解析失败'), { code: 'invalid_state', status: 500 }); }
        const located = generationScenePatch.locateScene(state, patch.chapterId, sceneId);
        if (!located) {
          getDatabase().exec('ROLLBACK');
          transaction = false;
          return json(res, 404, { ok: false, error: '指定章节或场景不存在', code: 'scene_not_found' });
        }
        const currentText = String(located.scene.content == null ? '' : located.scene.content);
        if (generationScenePatch.hashSceneText(currentText) !== patch.baseHash) {
          getDatabase().exec('ROLLBACK');
          transaction = false;
          return json(res, 409, { ok: false, error: '场景正文已变化，请重新读取后合并', code: 'base_hash_conflict', revision: currentRevision });
        }
        located.scene.content = generationScenePatch.applySceneOperations(currentText, patch.operations);
        state = sanitizeNovelStateForStorage(state);
        const stateJson = JSON.stringify(state);
        if (Buffer.byteLength(stateJson, 'utf8') > MAX_NOVEL_STATE_BYTES) {
          getDatabase().exec('ROLLBACK');
          transaction = false;
          return json(res, 413, { ok: false, error: '单本小说数据过大', code: 'state_too_large' });
        }
        const now = Date.now();
        const result = getDatabase().prepare(`UPDATE novels SET state_json = ?, word_count = ?, updated_at = ?,
          revision = revision + 1, owner_user_id = ?
          WHERE id = ? AND workspace_id = ? AND project_id = ? AND revision = ?`)
          .run(stateJson, calcWordCount(state), now, auth.user.userId, novelId,
            access.workspace_id, access.project_id, patch.revision);
        if (Number(result.changes || 0) !== 1) {
          getDatabase().exec('ROLLBACK');
          transaction = false;
          return json(res, 409, { ok: false, error: '小说 revision 已变化，请重新读取', code: 'revision_conflict' });
        }
        getDatabase().prepare('UPDATE novel_projects SET updated_at = ? WHERE workspace_id = ? AND project_id = ?')
          .run(now, access.workspace_id, access.project_id);
        require('../lib/memory-workflow').invalidateChangedSources(getDatabase(), novelId);
        getDatabase().exec('COMMIT');
        transaction = false;
        return json(res, 200, {
          ok: true, chapterId: patch.chapterId, sceneId, revision: patch.revision + 1,
          contentHash: generationScenePatch.hashSceneText(located.scene.content)
        });
      } catch (error) {
        if (transaction) { try { getDatabase().exec('ROLLBACK'); } catch (_) {} }
        throw error;
      }
    } catch (error) {
      return scenePatchError(res, error);
    }
  }
  
  async function handleGenerationRuns(req, res, u) {
    const auth = generationRequestAuth(req);
    if (!auth) return json(res, 401, { ok: false, error: '未登录', code: 'unauthorized' });
    const actorUserId = postgresActor(auth);
    const rootPath = '/api/generation-runs';
    if (req.method === 'GET' && u === `${rootPath}/capabilities`) {
      const selectedStore = generationRunStore();
      const nativeAppStore = !POSTGRES_MODE && process.env.MOLAN_APP_STORE === 'json';
      const commit = POSTGRES_MODE
        ? typeof postgresRepository.commitChapter === 'function'
        : nativeAppStore ? typeof nativeCreationRepository()?.commitChapter === 'function'
        : dbReady() && ['creation_books', 'creation_state_snapshots', 'creation_chapter_audits', 'benchmark_commit_receipts', 'project_resources', 'novels']
          .every(name => Boolean(getDatabase().prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)));
      const generationStatus = generationV2Status(generationV2Enabled(process.env, actorUserId));
      return json(res, 200, {
        ...generationStatus,
        commit,
        pauseResume: typeof selectedStore.requestPause === 'function' && typeof selectedStore.resumeRun === 'function',
        recovery: typeof selectedStore.recoverExpiredRuns === 'function',
        storageMode: POSTGRES_MODE ? 'postgres' : nativeAppStore || process.env.MOLAN_GENERATION_STORE === 'json' ? 'json' : 'sqlite'
      });
    }
    if (!generationV2Enabled(process.env, actorUserId)) return json(res, 404, { ok: false, error: 'Generation V2 未启用', code: 'generation_v2_disabled' });
    if (!requireSqliteForPublic(req, res)) return;
    const base = u.match(/^\/api\/generation-runs\/([^/]+)$/);
    const events = u.match(/^\/api\/generation-runs\/([^/]+)\/events$/);
    const cancel = u.match(/^\/api\/generation-runs\/([^/]+)\/cancel$/);
    const pause = u.match(/^\/api\/generation-runs\/([^/]+)\/pause$/);
    const resume = u.match(/^\/api\/generation-runs\/([^/]+)\/resume$/);
    const revision = u.match(/^\/api\/generation-runs\/([^/]+)\/revision$/);
    const commit = u.match(/^\/api\/generation-runs\/([^/]+)\/commit$/);
    try {
      const orchestrator = generationRunOrchestrator();
      const store = generationRunStore();
      const database = generationDatabase();
      if (typeof orchestrator.recover === 'function') await orchestrator.recover({ actorUserId });
      if (req.method === 'POST' && u === rootPath) {
        const body = await readBody(req, 2 * 1024 * 1024 + 4096);
        const key = String(req.headers['idempotency-key'] || body.idempotencyKey || body.requestId || '').trim();
        const requestedModel = String(body.modelId || body.model || '').trim();
        const modelId = resolveModelForUser(auth.user, requestedModel || currentDefaultModel());
        if (requestedModel === 'gpt-6-luna' && modelId !== requestedModel) return json(res, 503, { ok: false, error: '平台模型目录未配置 gpt-6-luna，已停止请求以避免回退到其他模型', code: 'model_unavailable' });
        const normalized = generationRunContext.normalizeGenerationRequest({ ...body, modelId, idempotencyKey: key });
        const request = normalized.request;
        const access = await generationProjectAccess(actorUserId, request.projectId, String(body.workspaceId || ''));
        if (!projectScope.canAccess(access, projectScope.WRITE_ROLES, 'spend')) return json(res, 403, { ok: false, error: '当前账户无权在该项目生成正文', code: 'forbidden' });
        const workspaceId = String(access.workspace_id || '');
        const id = crypto.randomUUID();
        const manifest = generationManifest.buildGenerationManifest({
          generationId: id, projectId: request.projectId, chapterId: request.chapterId,
          modelId, promptHash: generationManifest.hashValue({ writingSystem: request.writingSystem, prompt: request.prompt })
        });
        const created = await orchestrator.create({
          id, actorUserId, workspaceId, projectId: request.projectId, chapterId: request.chapterId,
          pipelineVersion: 'generation-v2.1', idempotencyKey: normalized.idempotencyKey,
          requestHash: generationRunContext.requestHash(request), request, manifest, modelId
        }, { auth, user: auth.user, authorization: String(req.headers.authorization || ''), projectId: request.projectId, workspaceId });
        return json(res, created.idempotent ? 200 : 202, { ok: true, idempotent: created.idempotent, run: created.run });
      }
  
      if (!base && !events && !cancel && !pause && !resume && !revision && !commit) return json(res, 404, { ok: false, error: 'Not Found' });
      const id = decodePathParam((events || cancel || pause || resume || revision || commit || base)[1]);
      const run = await store.getRunById(database, { id, actorUserId });
      if (!run) return json(res, 404, { ok: false, error: '生成任务不存在或无权访问', code: 'RUN_NOT_FOUND' });
      const access = await generationProjectAccess(actorUserId, run.projectId, run.workspaceId);
      if (!access || !projectScope.canAccess(access, projectScope.PROJECT_ROLES)) return json(res, 404, { ok: false, error: '生成任务不存在或无权访问', code: 'RUN_NOT_FOUND' });
      const scope = { id: run.id, actorUserId, projectId: run.projectId, workspaceId: run.workspaceId };
      if (req.method === 'GET' && events) {
        const params = new URL(req.url, 'http://molan.local').searchParams;
        const afterRaw = params.get('after');
        const limitRaw = params.get('limit');
        const lastEventId = String(req.headers['last-event-id'] || '').trim();
        const cursorRaw = lastEventId || afterRaw;
        const after = cursorRaw == null || cursorRaw === '' ? 0 : Number(cursorRaw);
        const requestedLimit = limitRaw == null || limitRaw === '' ? 100 : Number(limitRaw);
        if (!Number.isSafeInteger(after) || after < 0) return json(res, 400, { ok: false, error: 'after 参数无效', code: 'invalid_cursor' });
        if (!Number.isInteger(requestedLimit) || requestedLimit < 1) return json(res, 400, { ok: false, error: 'limit 参数无效', code: 'invalid_limit' });
        const limit = Math.min(500, requestedLimit);
        if (String(req.headers.accept || '').toLowerCase().includes('text/event-stream')) {
          return streamGenerationEvents(req, res, store, database, scope, after);
        }
        const list = await store.listEvents(database, { ...scope, generationId: run.id, after, limit });
        return json(res, 200, { ok: true, events: list, hasMore: list.length === limit });
      }
      if (req.method === 'GET' && base) {
        const stages = await store.listStages(database, { ...scope, generationId: run.id });
        return json(res, 200, { ok: true, run, stages });
      }
      if (req.method === 'POST' && cancel) {
        if (!projectScope.canAccess(access, projectScope.WRITE_ROLES)) return json(res, 403, { ok: false, error: '当前账户无权取消此任务', code: 'forbidden' });
        return json(res, 200, { ok: true, run: await orchestrator.cancel(scope) });
      }
      if (req.method === 'POST' && pause) {
        if (!projectScope.canAccess(access, projectScope.WRITE_ROLES)) return json(res, 403, { ok: false, error: '当前账户无权暂停此任务', code: 'forbidden' });
        return json(res, 200, { ok: true, run: await orchestrator.pause(scope) });
      }
      if (req.method === 'POST' && resume) {
        if (!projectScope.canAccess(access, projectScope.WRITE_ROLES)) return json(res, 403, { ok: false, error: '当前账户无权恢复此任务', code: 'forbidden' });
        const resumed = await orchestrator.resume(scope, {
          auth, user: auth.user, authorization: String(req.headers.authorization || ''),
          projectId: run.projectId, workspaceId: run.workspaceId, generationId: run.id
        });
        return json(res, 202, { ok: true, run: resumed.run, resumed: true });
      }
      if (req.method === 'POST' && revision) {
        if (!projectScope.canAccess(access, projectScope.WRITE_ROLES)) return json(res, 403, { ok: false, error: '当前账户无权修订此任务', code: 'forbidden' });
        const body = await readBody(req, 256 * 1024 + 4096);
        const controller = new AbortController();
        const disconnect = attachResponseDisconnect(res, () => {
          controller.abort(new Error('修订响应已断开'));
        });
        let revised;
        try {
          revised = await orchestrator.revise({
            ...scope,
            issueId: body.issueId,
            quote: body.quote,
            replacementWindow: body.replacementWindow,
            replacement: body.replacement,
            preservedFacts: body.preservedFacts,
            outputHash: body.outputHash
          }, {
            auth, user: auth.user, authorization: String(req.headers.authorization || ''),
            projectId: run.projectId, workspaceId: run.workspaceId, generationId: run.id,
            signal: controller.signal
          });
        } finally {
          disconnect.dispose();
        }
        if (disconnect.disconnected || res.destroyed || res.writableEnded) return;
        return json(res, 200, { ok: true, run: revised.run, revision: revised.revision, idempotent: revised.idempotent });
      }
      if (req.method === 'POST' && commit) {
        if (!projectScope.canAccess(access, projectScope.WRITE_ROLES)) return json(res, 403, { ok: false, error: '当前账户无权提交此任务', code: 'forbidden' });
        const body = await readBody(req, 1024 * 1024 + 4096);
        const outputHash = String(body.outputHash || body.payload && body.payload.outputHash || '');
        const text = String(body.text ?? (body.payload && (body.payload.content || body.payload.text)) ?? '');
        const committed = await orchestrator.commit({ ...scope, outputHash, text, payload: body }, {
          auth, user: auth.user, authorization: String(req.headers.authorization || ''),
          projectId: run.projectId, workspaceId: run.workspaceId, generationId: run.id
        });
        return json(res, 200, { ok: true, run: committed.run, receipt: committed.receipt, idempotent: committed.idempotent });
      }
      return json(res, 405, { ok: false, error: 'Method Not Allowed' });
    } catch (error) {
      return generationRunError(res, error);
    }
  }
  
  async function handleBenchmark(req, res, u) {
    if (req.method === 'GET' && u === '/api/benchmark/capabilities') return json(res, 200, { protocol: 'benchmark-local-v2', localStorage: !CLOUD_API_BASE, cloudProxy: !!CLOUD_API_BASE, maxRevisionRounds: 2, humanReviewRequired: true });
    const isReadOnlyOrCompute = (req.method === 'GET') || u === '/api/benchmark/audit' || u === '/api/benchmark/baseline';
    if (CLOUD_API_BASE && !isReadOnlyOrCompute) return json(res, 409, { error: '评测批量生成与落盘存储要求仅本地存储，请在本地模式运行，不允许代理写入云端', code: 'local_storage_required' });
    const auth = await (CLOUD_API_BASE ? authenticateXuanhuanCloud(req, CLOUD_API_BASE) : getAuthUser(req));
    if (!auth) return json(res, 401, { error: '请先登录' });
    const url = new URL(req.url, 'http://molan.local');
    try {
      if (req.method === 'GET' && u === '/api/benchmark/database/summary') {
        const benchmarkDatabase = require('../lib/benchmark-database');
        return json(res, 200, { ok: true, summary: benchmarkDatabase.getDatabaseSummary() });
      }
      if (req.method === 'GET' && u === '/api/benchmark/comparable') {
        const genre = String(url.searchParams.get('genre') || '').trim();
        const subgenre = String(url.searchParams.get('subgenre') || '').trim();
        const protagonistType = String(url.searchParams.get('protagonistType') || '').trim();
        const openingMode = String(url.searchParams.get('openingMode') || '').trim();
        const prompt = String(url.searchParams.get('prompt') || '').trim();
        const benchmarkDatabase = require('../lib/benchmark-database');
        const matched = benchmarkDatabase.findComparableBenchmark({ genre, subgenre, protagonistType, openingMode, prompt });
        return json(res, 200, { ok: true, benchmark: matched, targetBlock: benchmarkDatabase.buildComparablePromptTarget(matched) });
      }
      if (req.method === 'GET' && u === '/api/benchmark/baseline') {
        let genre = String(url.searchParams.get('genre') || '').trim();
        if (!genre || genre.toLowerCase() === 'auto') genre = '通用';
        const subgenre = String(url.searchParams.get('subgenre') || '').trim();
        const protagonistType = String(url.searchParams.get('protagonistType') || '').trim();
        const prompt = String(url.searchParams.get('prompt') || '').trim();
        const pack = benchmarkPipeline.loadGenreBaseline(genre, undefined, { subgenre, protagonistType, prompt });
        const runtime = benchmarkPipeline.genreRuntime(genre);
        return json(res, 200, { ok: true, genre, family: benchmarkPipeline.resolveGenreFamily(genre), baseline: pack, targetBlock: benchmarkPipeline.buildBaselineTargetBlock(pack), runtime });
      }
      if (req.method === 'GET' && u === '/api/benchmark/profile/distribution') {
        const benchmarkDatabase = require('../lib/benchmark-database');
        const genre = String(url.searchParams.get('genre') || '').trim();
        const dist = benchmarkDatabase.getQualityProfileDistribution();
        if (genre) {
          return json(res, 200, { ok: true, genre, baseline: benchmarkDatabase.getQualityProfileBaseline(genre), abnormalBounds: benchmarkDatabase.getQualityBoundaries() });
        }
        return json(res, 200, { ok: true, distribution: dist });
      }
      if (req.method === 'GET' && u === '/api/benchmark/genre-baselines') {
        const benchmarkDatabase = require('../lib/benchmark-database');
        const genre = String(url.searchParams.get('genre') || '').trim();
        const subgenre = String(url.searchParams.get('subgenre') || '').trim();
        const classification = benchmarkDatabase.getDetectionModeClassification();
        if (genre || subgenre) {
          const baseline = benchmarkDatabase.getGenreQualityBaseline(genre, subgenre);
          return json(res, 200, { ok: true, genre: genre || '通用现实', subgenre, baseline, classification });
        }
        const allDb = benchmarkDatabase.loadGenreQualityBaselines();
        return json(res, 200, { ok: true, totalGenres: allDb?.totalGenresCovered || 0, baselines: allDb?.baselines || {}, classification });
      }
      if (req.method === 'GET' && u === '/api/benchmark/generated/list') {
        const preprocessor = require('../lib/generated-novel-preprocessor');
        const packages = preprocessor.scanGeneratedNovels();
        const list = packages.map(p => ({
          packageId: p.packageId,
          title: p.title,
          versions: p.versions,
          generationParameters: p.generationParameters,
          metadata: p.metadata,
          characters: p.characters,
          keyProps: p.keyProps,
          outlineNodesCount: p.outline.length
        }));
        return json(res, 200, { ok: true, count: list.length, packages: list });
      }
      if (req.method === 'POST' && u === '/api/benchmark/generated/preprocess') {
        const body = await readBody(req, 1000000);
        const preprocessor = require('../lib/generated-novel-preprocessor');
        const packageId = body.packageId || body.target;
        const packages = preprocessor.scanGeneratedNovels();
        const targetPkg = packageId
          ? packages.find(p => p.packageId === packageId || p.title === packageId)
          : packages[0];
        if (!targetPkg) {
          return json(res, 404, { error: '未找到指定的生成套件' });
        }
        const profile = preprocessor.generateGeneratedNovelProfile(targetPkg, {
          title: body.title || targetPkg.title,
          author: body.author,
          genre: body.genre,
          subgenre: body.subgenre
        });
        return json(res, 200, { ok: true, profile });
      }
      if (req.method === 'POST' && u === '/api/benchmark/blind-review/compare') {
        const body = await readBody(req, 1000000);
        const comparator = require('../lib/blind-review-comparator');
        const inputs = comparator.loadBlindReviewInputs({
          generatedProfilePath: body.generatedProfilePath,
          benchmarkProfilePath: body.benchmarkProfilePath,
          genreBaselinePath: body.genreBaselinePath
        });
        const genProfile = body.generatedProfile || inputs.generatedProfile;
        const bmProfile = body.benchmarkProfile || inputs.benchmarkProfile;
        const baselines = body.genreBaselines || inputs.genreBaselines;
        const report = comparator.compareNovelQualityBlind(genProfile, bmProfile, baselines);
        return json(res, 200, { ok: true, report });
      }
      if (req.method === 'POST' && u === '/api/benchmark/defects/detect') {
        const body = await readBody(req, 1000000);
        const detector = require('../lib/defect-detector');
        const inputs = detector.loadDefectDetectionInputs({
          generatedProfilePath: body.generatedProfilePath,
          comparisonReportPath: body.comparisonReportPath,
          genreBaselinePath: body.genreBaselinePath,
          benchmarkProfilePath: body.benchmarkProfilePath,
          generationDir: body.generationDir
        });
        const result = detector.detectNovelQualityDefects(inputs);
        return json(res, 200, { ok: true, result });
      }
      if (req.method === 'POST' && u === '/api/benchmark/genre-baselines/evaluate') {
        const body = await readBody(req, 200000);
        const benchmarkDatabase = require('../lib/benchmark-database');
        const { metricKey, value, genre, context } = body;
        if (!metricKey) return json(res, 400, { error: '缺少 metricKey' });
        const evaluation = benchmarkDatabase.evaluateWithContext(metricKey, value, genre, context);
        return json(res, 200, { ok: true, evaluation });
      }
      if (req.method === 'POST' && u === '/api/benchmark/profile/extract') {
        const body = await readBody(req, 1000000);
        const profiler = require('../lib/novel-quality-profiler');
        const profile = profiler.extractNovelQualityProfile(body.text || body.chapters || body.content, {
          title: body.title,
          author: body.author,
          genre: body.genre,
          subgenre: body.subgenre
        });
        return json(res, 200, { ok: true, profile });
      }
      if (req.method === 'POST' && u === '/api/benchmark/profile/compare') {
        const body = await readBody(req, 1000000);
        const profiler = require('../lib/novel-quality-profiler');
        const benchmarkDatabase = require('../lib/benchmark-database');
        let targetProfile = body.profile;
        if (!targetProfile && (body.text || body.chapters || body.content)) {
          targetProfile = profiler.extractNovelQualityProfile(body.text || body.chapters || body.content, {
            title: body.title,
            genre: body.genre,
            subgenre: body.subgenre
          });
        }
        if (!targetProfile) return json(res, 400, { error: '缺少待评测 Profile 或正文' });
        const dist = benchmarkDatabase.getQualityProfileDistribution();
        const comparison = profiler.compareQualityProfiles(targetProfile, dist);
        return json(res, 200, { ok: true, comparison });
      }
      if (req.method === 'POST' && u === '/api/quality/story-check') {
        const body = await readBody(req, 2000000);
        const { evaluateStoryQuality } = require('../lib/quality/story-quality');
        const report = evaluateStoryQuality(body.chapters || [], body.options || {});
        return json(res, 200, { ok: true, report });
      }
      if (req.method === 'POST' && u === '/api/quality/texture-check') {
        const body = await readBody(req, 1000000);
        const { analyzeHumanTexture } = require('../lib/style/human-texture');
        const result = analyzeHumanTexture(body.text || '', body.options || {});
        return json(res, 200, { ok: true, result });
      }
      if (req.method !== 'POST') return json(res, 405, { error: 'Method Not Allowed' });
      if (!['/api/benchmark/audit', '/api/benchmark/revise-loop', '/api/benchmark/generate'].includes(u)) return json(res, 404, { error: 'Not Found' });
      const body = await readBody(req, 160000);
      const user = POSTGRES_MODE || process.env.MOLAN_APP_STORE === 'json'
        ? auth.user
        : getUserByEmail(auth.user.email) || { email: auth.user.email };
      const controller = new AbortController();
      res.once('close', () => { if (!res.writableEnded) controller.abort(new Error('本地评测连接已中断')); });
      const deps = { callModel: (_auth, options) => {
        if (controller.signal.aborted) throw new Error('本地评测已中断');
        return callMolanChat(String(req.headers.authorization || ''), user, { ...options, controller, requireComplete: true, timeoutMs: calculateBenchmarkCallTimeoutMs(options) });
      } };
      const requestedModelId = String(body.modelId || '').trim();
      const resolvedModelId = resolveModelForUser(user, requestedModelId || currentDefaultModel());
      if (requestedModelId === 'gpt-6-luna' && resolvedModelId !== requestedModelId) {
        return json(res, 503, { error: '平台模型目录未配置 gpt-6-luna，已停止请求以避免回退到其他模型' });
      }
      const params = {
        text: String(body.text || body.content || ''),
        genre: String(body.genre || '').trim(),
        contract: body.contract && typeof body.contract === 'object' ? body.contract : null,
        planText: String(body.planText || ''),
        previousEnding: String(body.previousEnding || ''),
        characters: Array.isArray(body.characters) ? body.characters : [],
        byEntity: body.factLedger && typeof body.factLedger === 'object' ? body.factLedger.byEntity || null : null,
        factLedger: body.factLedger && typeof body.factLedger === 'object' ? body.factLedger : null,
        continuity: body.continuity && typeof body.continuity === 'object' ? body.continuity : null,
        knownEntities: Array.isArray(body.knownEntities) ? body.knownEntities : [],
        targetWords: Number(body.targetWords) || 0,
        novelId: String(body.novelId || '').trim(),
        creationBookId: String(body.creationBookId || '').trim(),
        modelId: resolvedModelId,
        reviseModelId: body.reviseModelId ? resolveModelForUser(user, body.reviseModelId) : '',
        writingSystem: String(body.writingSystem || ''),
        prompt: String(body.prompt || ''),
        control: body.control === true,
        controlSystem: String(body.controlSystem || ''),
        reasoningEffort: String(body.reasoningEffort || '').trim().toLowerCase(),
        temperature: Number.isFinite(body.temperature) ? Math.min(1.5, Math.max(0, body.temperature)) : 0.8,
        maxRounds: body.maxRounds == null ? 2 : Math.min(2, Math.max(0, Number(body.maxRounds) || 0))
      };
      if (params.text.length > 32000 || JSON.stringify(params.factLedger).length > 24000) return json(res, 413, { error: '正文或事实上下文超过审稿预算，未静默截断' });
      if (u === '/api/benchmark/generate') {
        if (!params.prompt.trim()) return json(res, 400, { error: '缺少本章任务' });
        const requestId = String(body.requestId || '');
        if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) return json(res, 400, { error: '生成请求必须提供稳定 requestId' });
        const result = await require('../lib/benchmark-receipts').runOnce({ directory: path.join(DATA_DIR, 'benchmark-runs'), owner: auth.user.email, requestId, params, execute: () => benchmarkPipeline.generateChapter(deps, auth, params) });
        return json(res, 200, { ok: true, ...result });
      }
      if (!params.text.trim()) return json(res, 400, { error: '正文为空' });
      if (u === '/api/benchmark/audit') return json(res, 200, { ok: true, audit: await benchmarkPipeline.evidenceAudit(deps, auth, params) });
      if (u === '/api/benchmark/revise-loop') return json(res, 200, { ok: true, ...(await benchmarkPipeline.auditReviseLoop(deps, auth, params)) });
      return json(res, 404, { error: 'Not Found' });
    } catch (error) {
      console.error('[handleBenchmark Error]:', error && error.stack || error);
      const errMsg = error.code === 'context_budget_exceeded'
        ? '上下文超出预算，请精简设定或正文'
        : (error && error.message) || '本地评测未完成；请查看本地运行记录，不自动重试未知结果';
      return json(res, error && error.status || 500, { error: errMsg, code: error && error.code || 'benchmark_failed_or_unknown', detail: error && error.message });
    }
  }
  
  
  return { generationRunOrchestrator, generationRequestAuth, generationRunError, generationSseEvent, streamGenerationEvents, generationProjectAccess, generationChatChunk, streamLegacyGenerationChat, handleLegacyGenerationChat, generationChapterNo, generationPreviousEnding, generationFactLedger, loadAuthoritativeGenerationContext, scenePatchError, validateScenePatchBody, handleNovelScenePatch, handleGenerationRuns, handleBenchmark };
}

module.exports = { createGenerationService };
