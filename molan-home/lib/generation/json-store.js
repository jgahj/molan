'use strict';

const crypto = require('node:crypto');
const { JsonFileRepository } = require('../repositories/json-file-repository');
const { GenerationError } = require('./errors');
const { isTerminal, transition } = require('./state-machine');

const GENERATION_INDEX_SCOPE = '__molan_generation_index_v1__';
const GENERATION_RECORD_KIND = 'generation-run-v1';
const INDEX_RECORD_KIND = 'generation-run-index-v1';
const SAFE_STATES = new Set([
  'created', 'request_validated', 'genre_resolved', 'style_resolved', 'context_built',
  'contract_validated', 'pre_generation_guard', 'scene_planning'
]);
const ACTIVE_STATES = new Set([
  ...SAFE_STATES, 'generating', 'draft_received', 'deterministic_audit', 'semantic_audit',
  'quality_audit', 'revision', 'cancel_requested', 'committing'
]);

function cloneJson(value, fallback = {}) {
  const serialized = JSON.stringify(value === undefined ? fallback : value);
  if (serialized === undefined) throw new TypeError('生成任务数据必须是可序列化 JSON');
  return JSON.parse(serialized);
}

function generationError(code, message, status = 409) {
  return new GenerationError(code, message, { status });
}

function publicRun(row) {
  if (!row) return null;
  return {
    id: String(row.id), workspaceId: String(row.workspaceId || ''), projectId: String(row.projectId),
    chapterId: String(row.chapterId || ''), state: String(row.state),
    pipelineVersion: String(row.pipelineVersion), attemptNo: Number(row.attemptNo) || 0,
    manifest: cloneJson(row.manifest || {}), result: cloneJson(row.result || {}),
    errorCode: String(row.errorCode || ''), errorDetail: String(row.errorDetail || ''),
    reservedCostMinor: Number(row.reservedCostMinor) || 0, actualCostMinor: Number(row.actualCostMinor) || 0,
    costStatus: row.costStatus || 'pending',
    cancelRequested: row.cancelRequested === true, pauseRequested: row.pauseRequested === true,
    fencingToken: Number(row.fencingToken) || 0,
    createdAt: Number(row.createdAt) || 0, updatedAt: Number(row.updatedAt) || 0,
    finishedAt: row.finishedAt == null ? null : Number(row.finishedAt)
  };
}

function nowFrom(input) { return Number(input && input.now) || Date.now(); }
function leaseTtl(input) { return Math.max(15000, Math.min(300000, Number(input && input.ttlMs) || 90000)); }
function actorId(input) { return String(input && input.actorUserId || ''); }
function projectId(input) {
  const id = String(input && input.projectId || '');
  if (!id) throw Object.assign(new TypeError('projectId is required'), { code: 'INVALID_SCOPE', status: 422 });
  if (id === GENERATION_INDEX_SCOPE) throw Object.assign(new TypeError('projectId is reserved'), { code: 'INVALID_SCOPE', status: 422 });
  return id;
}
function runId(input) { return String(input && input.id || ''); }
function matchesScope(row, input) {
  return Boolean(row && row.kind === GENERATION_RECORD_KIND && row.id === runId(input) &&
    row.projectId === String(input.projectId || '') && row.actorUserId === actorId(input) &&
    (!input.workspaceId || row.workspaceId === String(input.workspaceId)));
}
function findRun(repository, input) {
  if (!runId(input)) return null;
  const scope = projectId(input);
  const row = repository.generation.get(scope, runId(input));
  return row;
}
function hasLease(input) { return input && input.fencingToken != null; }
function leaseMatches(row, input, now, active = true) {
  return String(row.leaseOwner || '') === String(input.leaseOwner || '') &&
    Number(row.fencingToken) === (Number(input.fencingToken) || 0) &&
    (!active || Number(row.leaseUntil) > now);
}
function appendRunEvent(row, state, payload, now) {
  row.events ||= [];
  const sequence = row.events.reduce((max, item) => Math.max(max, Number(item.sequence) || 0), 0) + 1;
  row.events.push({ sequence, state: String(state), payload: cloneJson(payload || {}), createdAt: now });
  return sequence;
}
function eventPayload(event) { return cloneJson(event || {}); }
function nullableNumber(value) { return value == null ? null : Number(value); }

function createJsonGenerationStore(directory, options = {}) {
  const repository = options.repository || new JsonFileRepository(directory, options.repositoryOptions);
  const findCommitReceipt = typeof options.findCommitReceipt === 'function' ? options.findCommitReceipt : null;

  async function createRun(_db, value) {
    const input = value === undefined ? _db || {} : value || {};
    const scope = projectId(input);
    const workspace = String(input.workspaceId || '');
    const id = String(input.id || crypto.randomUUID());
    const idempotencyKey = String(input.idempotencyKey || '');
    const requestHash = String(input.requestHash || '');
    const now = nowFrom(input);
    const result = await repository.transaction([scope, GENERATION_INDEX_SCOPE], tx => {
      const existing = tx.list(scope, 'generation').find(row => row.kind === GENERATION_RECORD_KIND &&
        row.workspaceId === workspace && row.idempotencyKey === idempotencyKey);
      if (existing) {
        if (existing.actorUserId !== actorId(input)) {
          throw generationError('IDEMPOTENCY_KEY_REUSED', '该幂等键已被项目其他成员使用');
        }
        if (existing.requestHash !== requestHash) {
          throw generationError('IDEMPOTENCY_KEY_REUSED', '同一 Idempotency-Key 不能用于不同请求');
        }
        return { run: publicRun(existing), idempotent: true };
      }
      if (tx.get(GENERATION_INDEX_SCOPE, 'generation', id)) {
        throw generationError('STATE_CONFLICT', '生成任务 ID 已存在');
      }
      const row = tx.put(scope, 'generation', {
        kind: GENERATION_RECORD_KIND, id, workspaceId: workspace, projectId: scope,
        actorUserId: actorId(input), chapterId: String(input.chapterId || ''), state: 'created',
        pipelineVersion: String(input.pipelineVersion || 'generation-v2.1'), attemptNo: 0,
        idempotencyKey, requestHash, request: cloneJson(input.request || {}),
        manifest: cloneJson(input.manifest || {}), result: {}, errorCode: '', errorDetail: '',
        reservedCostMinor: 0, actualCostMinor: 0, cancelRequested: false, pauseRequested: false,
        leaseOwner: '', leaseUntil: null, fencingToken: 0, createdAt: now, updatedAt: now, finishedAt: null,
        stages: [], events: [{ sequence: 1, state: 'created', payload: { message: '生成任务已创建' }, createdAt: now }]
      });
      tx.put(GENERATION_INDEX_SCOPE, 'generation', {
        kind: INDEX_RECORD_KIND, id, projectId: scope, workspaceId: workspace, actorUserId: actorId(input)
      });
      return { run: publicRun(row), idempotent: false };
    });
    return result;
  }

  async function getRun(_db, value) {
    const input = value === undefined ? _db || {} : value || {};
    const row = await findRun(repository, input);
    return matchesScope(row, input) ? publicRun(row) : null;
  }

  async function getRunById(_db, value) {
    const input = value === undefined ? _db || {} : value || {};
    const id = String(input.id || '');
    if (!id) return null;
    const index = await repository.generation.get(GENERATION_INDEX_SCOPE, id);
    if (!index || index.kind !== INDEX_RECORD_KIND || index.actorUserId !== actorId(input)) return null;
    const row = await repository.generation.get(index.projectId, index.id);
    return row && row.kind === GENERATION_RECORD_KIND && row.actorUserId === actorId(input) ? publicRun(row) : null;
  }

  async function getRunInput(_db, value) {
    const input = value === undefined ? _db || {} : value || {};
    const row = await findRun(repository, input);
    return matchesScope(row, input) ? cloneJson(row.request || {}) : null;
  }

  async function updateRun(_db, value) {
    const input = value === undefined ? _db || {} : value || {};
    const scope = projectId(input), now = nowFrom(input);
    if (!runId(input)) throw generationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', 404);
    return repository.transaction([scope], tx => {
      const row = tx.get(scope, 'generation', runId(input));
      if (!matchesScope(row, input)) throw generationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', 404);
      const next = transition(publicRun(row), input.state, now);
      if (hasLease(input) && !leaseMatches(row, input, now)) {
        throw generationError('STATE_CONFLICT', '生成任务租约已过期或被替换');
      }
      const error = input.error || {};
      const updated = {
        ...row, state: next.state, updatedAt: now,
        result: input.result === undefined ? row.result : cloneJson(input.result || {}),
        manifest: input.manifest === undefined ? row.manifest : cloneJson(input.manifest || {}),
        errorCode: String(error.code || row.errorCode || ''),
        errorDetail: String(error.message || row.errorDetail || '').slice(0, 1000),
        finishedAt: isTerminal(next.state) ? now : row.finishedAt,
        cancelRequested: next.state === 'cancel_requested' ? true : row.cancelRequested
      };
      appendRunEvent(updated, next.state, input.event, now);
      return publicRun(tx.put(scope, 'generation', updated, row.revision));
    });
  }

  async function appendEvent(_db, value) {
    const input = value === undefined ? _db || {} : value || {};
    const scope = projectId(input), now = nowFrom(input);
    if (!runId(input)) throw generationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', 404);
    return repository.transaction([scope], tx => {
      const row = tx.get(scope, 'generation', runId(input));
      if (!matchesScope(row, input) || (hasLease(input) && !leaseMatches(row, input, now))) {
        throw generationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', 404);
      }
      const updated = { ...row };
      const sequence = appendRunEvent(updated, row.state, input.event, now);
      tx.put(scope, 'generation', updated, row.revision);
      return { sequence, state: row.state, createdAt: now };
    });
  }

  async function listStages(_db, value) {
    const input = value === undefined ? _db || {} : value || {};
    if (!String(input.generationId || '')) return [];
    const row = await findRun(repository, { ...input, id: input.generationId });
    if (!matchesScope(row, { ...input, id: input.generationId })) return [];
    return (row.stages || []).slice().sort((a, b) => Number(a.startedAt) - Number(b.startedAt) ||
      String(a.stage).localeCompare(String(b.stage)) || Number(a.attemptNo) - Number(b.attemptNo)).map(stage => ({
      stage: String(stage.stage), attemptNo: Number(stage.attemptNo) || 1, status: String(stage.status),
      inputHash: String(stage.inputHash || ''), outputHash: String(stage.outputHash || ''),
      promptTokens: nullableNumber(stage.promptTokens), completionTokens: nullableNumber(stage.completionTokens),
      reasoningTokens: nullableNumber(stage.reasoningTokens), cachedTokens: nullableNumber(stage.cachedTokens),
      reservedCostMinor: Number(stage.reservedCostMinor) || 0, actualCostMinor: Number(stage.actualCostMinor) || 0,
      providerRequestId: String(stage.providerRequestId || ''), errorCode: String(stage.errorCode || ''),
      startedAt: Number(stage.startedAt) || 0, finishedAt: stage.finishedAt == null ? null : Number(stage.finishedAt)
    }));
  }

  async function recordStage(_db, value) {
    const input = value === undefined ? _db || {} : value || {};
    const scope = projectId(input), now = nowFrom(input), stageNow = Number(input.finishedAt) || now;
    if (!String(input.generationId || '')) throw generationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', 404);
    return repository.transaction([scope], tx => {
      const row = tx.get(scope, 'generation', String(input.generationId || ''));
      if (!matchesScope(row, { ...input, id: input.generationId }) ||
          (hasLease(input) && !leaseMatches(row, input, now))) {
        throw generationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', 404);
      }
      const stageName = String(input.stage || '');
      const attemptNo = Number(input.attemptNo) || 1;
      const stages = (row.stages || []).slice();
      const existingIndex = stages.findIndex(stage => stage.stage === stageName && Number(stage.attemptNo) === attemptNo);
      const previous = existingIndex >= 0 ? stages[existingIndex] : null;
      const nextStage = {
        stage: stageName, attemptNo, status: String(input.status || 'completed'),
        inputHash: previous ? previous.inputHash : String(input.inputHash || ''),
        outputHash: String(input.outputHash || ''),
        promptTokens: nullableNumber(input.promptTokens), completionTokens: nullableNumber(input.completionTokens),
        reasoningTokens: nullableNumber(input.reasoningTokens), cachedTokens: nullableNumber(input.cachedTokens),
        reservedCostMinor: Number(input.reservedCostMinor) || 0, actualCostMinor: Number(input.actualCostMinor) || 0,
        costStatus: stageName.startsWith('provider:') ? input.costStatus === 'settled' && input.actualCostMinor != null &&
          Number.isFinite(Number(input.actualCostMinor)) && Number(input.actualCostMinor) >= 0 ? 'settled' : 'pending' : undefined,
        providerRequestId: String(input.providerRequestId || ''), errorCode: String(input.errorCode || ''),
        startedAt: previous ? previous.startedAt : Number(input.startedAt) || now,
        finishedAt: input.finishedAt == null ? null : Number(input.finishedAt)
      };
      if (existingIndex >= 0) stages[existingIndex] = nextStage;
      else stages.push(nextStage);
      const updated = {
        ...row, stages,
        reservedCostMinor: stages.reduce((total, stage) => total + (Number(stage.reservedCostMinor) || 0), 0),
        actualCostMinor: stages.reduce((total, stage) => total + (Number(stage.actualCostMinor) || 0), 0),
        costStatus: stages.some(stage => stage.stage.startsWith('provider:')) &&
          stages.filter(stage => stage.stage.startsWith('provider:')).every(stage => stage.status === 'completed' && stage.costStatus === 'settled')
          ? 'settled' : 'pending',
        updatedAt: Math.max(Number(row.updatedAt) || 0, stageNow)
      };
      tx.put(scope, 'generation', updated, row.revision);
    });
  }

  async function listEvents(_db, value) {
    const input = value === undefined ? _db || {} : value || {};
    if (!String(input.generationId || '')) return [];
    const row = await findRun(repository, { ...input, id: input.generationId });
    if (!matchesScope(row, { ...input, id: input.generationId })) return [];
    const after = Math.max(0, Number(input.after) || 0);
    const limit = Math.min(500, Math.max(1, Number(input.limit) || 100));
    return (row.events || []).filter(event => Number(event.sequence) > after).slice(0, limit).map(event => ({
      sequence: Number(event.sequence), state: String(event.state), payload: cloneJson(event.payload || {}),
      createdAt: Number(event.createdAt) || 0
    }));
  }

  async function acquireLease(_db, value) {
    const input = value === undefined ? _db || {} : value || {};
    const scope = projectId(input), now = nowFrom(input), ttlMs = leaseTtl(input);
    if (!runId(input)) throw generationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', 404);
    return repository.transaction([scope], tx => {
      const row = tx.get(scope, 'generation', runId(input));
      if (!matchesScope(row, input)) throw generationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', 404);
      const commitLease = String(input.leasePurpose || '') === 'commit';
      const allowedStates = commitLease ? new Set(['waiting_author', 'committing']) : new Set(['created']);
      if (!allowedStates.has(String(row.state)) || row.leaseOwner && Number(row.leaseUntil) > now) {
        return { acquired: false, run: publicRun(row) };
      }
      const owner = String(input.leaseOwner || '');
      if (!owner) throw new TypeError('leaseOwner is required');
      const fencingToken = (Number(row.fencingToken) || 0) + 1;
      const updated = { ...row, leaseOwner: owner, leaseUntil: now + ttlMs, fencingToken, updatedAt: now };
      tx.put(scope, 'generation', updated, row.revision);
      return { acquired: true, fencingToken, leaseUntil: now + ttlMs };
    });
  }

  async function renewLease(_db, value) {
    const input = value === undefined ? _db || {} : value || {};
    if (!runId(input)) return false;
    const index = await repository.generation.get(GENERATION_INDEX_SCOPE, runId(input));
    if (!index || index.kind !== INDEX_RECORD_KIND || (input.projectId && index.projectId !== String(input.projectId)) ||
        (input.actorUserId && index.actorUserId !== actorId(input))) return false;
    const now = nowFrom(input), ttlMs = leaseTtl(input);
    return repository.transaction([index.projectId], tx => {
      const row = tx.get(index.projectId, 'generation', index.id);
      if (!row || row.kind !== GENERATION_RECORD_KIND || !leaseMatches(row, input, now) || isTerminal(row.state)) return false;
      tx.put(index.projectId, 'generation', { ...row, leaseUntil: now + ttlMs, updatedAt: Math.max(Number(row.updatedAt) || 0, now) }, row.revision);
      return true;
    });
  }

  async function releaseLease(_db, value) {
    const input = value === undefined ? _db || {} : value || {};
    if (!runId(input) || !String(input.leaseOwner || '') ||
        !Number.isInteger(Number(input.fencingToken)) || Number(input.fencingToken) <= 0) return false;
    const index = await repository.generation.get(GENERATION_INDEX_SCOPE, runId(input));
    if (!index || index.kind !== INDEX_RECORD_KIND || (input.projectId && index.projectId !== String(input.projectId)) ||
        (input.actorUserId && index.actorUserId !== actorId(input))) return false;
    const now = nowFrom(input);
    return repository.transaction([index.projectId], tx => {
      const row = tx.get(index.projectId, 'generation', index.id);
      if (!row || row.kind !== GENERATION_RECORD_KIND || !leaseMatches(row, input, now, false)) return false;
      tx.put(index.projectId, 'generation', {
        ...row, leaseOwner: '', leaseUntil: null, updatedAt: Math.max(Number(row.updatedAt) || 0, now)
      }, row.revision);
      return true;
    });
  }

  async function beginProvider(_db, value) {
    const input = value === undefined ? _db || {} : value || {};
    const scope = projectId(input), now = nowFrom(input);
    if (!runId(input)) throw generationError('STATE_CONFLICT', '生成任务租约已过期或被替换');
    return repository.transaction([scope], tx => {
      const row = tx.get(scope, 'generation', runId(input));
      if (!matchesScope(row, input) || !leaseMatches(row, input, now)) {
        throw generationError('STATE_CONFLICT', '生成任务租约已过期或被替换');
      }
      const paused = row.pauseRequested === true;
      const next = transition(publicRun(row), paused ? 'paused' : 'generating', now);
      const updated = { ...row, state: next.state, pauseRequested: false, updatedAt: now, finishedAt: null };
      appendRunEvent(updated, next.state, { message: paused ? '已在 Provider 请求前安全暂停' : '正在生成正文' }, now);
      return { paused, run: publicRun(tx.put(scope, 'generation', updated, row.revision)) };
    });
  }

  async function requestPause(_db, value) {
    const input = value === undefined ? _db || {} : value || {};
    const scope = projectId(input), now = nowFrom(input);
    if (!runId(input)) throw generationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', 404);
    return repository.transaction([scope], tx => {
      const row = tx.get(scope, 'generation', runId(input));
      if (!matchesScope(row, input)) throw generationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', 404);
      if (row.state === 'paused') return publicRun(row);
      if (!SAFE_STATES.has(String(row.state))) {
        throw generationError('STATE_CONFLICT', row.state === 'generating'
          ? 'Provider 请求已开始，当前不能暂停；任务状态不会伪装成 paused'
          : '当前阶段不能安全暂停生成任务');
      }
      const activeLease = Boolean(row.leaseOwner && Number(row.leaseUntil) > now);
      const nextState = activeLease ? row.state : transition(publicRun(row), 'paused', now).state;
      const updated = {
        ...row, state: nextState, pauseRequested: activeLease, updatedAt: now,
        finishedAt: activeLease ? row.finishedAt : null
      };
      appendRunEvent(updated, nextState, {
        message: activeLease ? '已请求暂停，将在 Provider 请求前执行' : '任务已暂停'
      }, now);
      return publicRun(tx.put(scope, 'generation', updated, row.revision));
    });
  }

  async function resumeRun(_db, value) {
    const input = value === undefined ? _db || {} : value || {};
    const scope = projectId(input), now = nowFrom(input);
    if (!runId(input)) throw generationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', 404);
    return repository.transaction([scope], tx => {
      const row = tx.get(scope, 'generation', runId(input));
      if (!matchesScope(row, input)) throw generationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', 404);
      if (String(row.state) !== 'paused') throw generationError('STATE_CONFLICT', '只有已安全暂停的任务可以恢复');
      if (row.leaseOwner && Number(row.leaseUntil) > now) {
        throw generationError('STATE_CONFLICT', '暂停操作尚未释放 worker 租约，请稍后重试');
      }
      const next = transition(publicRun(row), 'created', now);
      const updated = {
        ...row, state: next.state, pauseRequested: false, attemptNo: (Number(row.attemptNo) || 0) + 1,
        leaseOwner: '', leaseUntil: null, fencingToken: (Number(row.fencingToken) || 0) + 1,
        updatedAt: now, finishedAt: null
      };
      appendRunEvent(updated, next.state, { message: '任务已恢复，将从 Provider 前安全边界重新执行' }, now);
      return publicRun(tx.put(scope, 'generation', updated, row.revision));
    });
  }

  async function recoverExpiredRuns(_db, scopeOrNow, maybeNow) {
    let filter = {};
    if (maybeNow !== undefined) filter = typeof scopeOrNow === 'object' && scopeOrNow ? { ...scopeOrNow, now: maybeNow } : { now: maybeNow };
    else if (scopeOrNow && typeof scopeOrNow === 'object') filter = scopeOrNow;
    else if (scopeOrNow !== undefined) filter = { now: scopeOrNow };
    else if (_db && typeof _db === 'object' && typeof _db.prepare !== 'function') filter = _db;
    const now = Number(filter.now) || Date.now();
    const indices = await repository.generation.list(GENERATION_INDEX_SCOPE);
    const candidates = indices.filter(index => index.kind === INDEX_RECORD_KIND &&
      (!filter.actorUserId || index.actorUserId === String(filter.actorUserId)) &&
      (!filter.workspaceId || index.workspaceId === String(filter.workspaceId)) &&
      (!filter.projectId || index.projectId === String(filter.projectId)));
    const projects = [...new Set(candidates.map(index => index.projectId))];
    const counts = { paused: 0, providerUnknown: 0, waitingAuthor: 0, committed: 0 };

    for (const scope of projects) {
      const ids = new Set(candidates.filter(index => index.projectId === scope).map(index => index.id));
      await repository.transaction([scope], async tx => {
        for (const row of tx.list(scope, 'generation')) {
          if (!ids.has(row.id) || row.kind !== GENERATION_RECORD_KIND || !ACTIVE_STATES.has(String(row.state))) continue;
          if (row.leaseUntil != null && Number(row.leaseUntil) > now) continue;
          const state = String(row.state);
          let target, errorCode = String(row.errorCode || ''), errorDetail = String(row.errorDetail || '');
          const result = cloneJson(row.result || {});
          if (state === 'committing') {
            const request = cloneJson(row.request || {});
            const outputHash = String(result.outputHash || '').toLowerCase();
            const chapterNo = Number(result.contract?.chapterNo);
            const savedReceipt = request.creationBookId && Number.isSafeInteger(chapterNo) && chapterNo > 0
              ? tx.get(scope, 'ledger', `creation-receipt:${request.creationBookId}:${chapterNo}`) : null;
            const nativeReceipt = savedReceipt?.kind === 'creation-commit-receipt' && savedReceipt.runId === row.id &&
              savedReceipt.actorUserId === row.actorUserId && savedReceipt.contentHash === outputHash &&
              crypto.createHash('sha256').update(String(savedReceipt.content), 'utf8').digest('hex') === outputHash &&
              savedReceipt.receipt?.committed === true && savedReceipt.receipt.contentHash === outputHash
              ? savedReceipt.receipt : null;
            const receipt = /^[a-f0-9]{64}$/.test(outputHash)
              ? nativeReceipt || (findCommitReceipt ? await findCommitReceipt({ run: publicRun(row), request, result, projectId: scope, transaction: tx }) : null)
              : null;
            if (receipt && String(receipt.contentHash || '').toLowerCase() === outputHash) {
              target = 'committed';
              result.commitReceipt = {
                ...cloneJson(receipt), contentHash: outputHash, committed: true
              };
              errorCode = '';
              errorDetail = '';
              counts.committed++;
            } else {
              target = 'waiting_author';
              errorCode = '';
              errorDetail = '';
              counts.waitingAuthor++;
            }
          } else if (SAFE_STATES.has(state)) {
            target = 'paused';
            errorCode = '';
            errorDetail = '';
            counts.paused++;
          } else {
            target = 'provider_unknown';
            errorCode = 'PROVIDER_UNKNOWN';
            errorDetail = '服务进程在不可重试阶段中断，结果需要核对；系统未自动重发 Provider 请求';
            counts.providerUnknown++;
          }
          const next = transition(publicRun(row), target, now);
          const updated = {
            ...row, state: next.state, result, errorCode, errorDetail, pauseRequested: false,
            leaseOwner: '', leaseUntil: null, fencingToken: (Number(row.fencingToken) || 0) + 1,
            updatedAt: now, finishedAt: target === 'committed' || target === 'provider_unknown' ? now : null
          };
          const message = target === 'paused' ? '进程中断后安全恢复；任务已暂停，等待作者继续'
            : target === 'committed' ? '已从提交回执恢复完成状态'
              : target === 'waiting_author' ? '提交事务未落回执，可安全重新确认提交'
                : 'Provider 阶段结果未知，已停止自动重试';
          appendRunEvent(updated, target, { message, recovery: true }, now);
          tx.put(scope, 'generation', updated, row.revision);
        }
      });
    }
    return counts;
  }

  return {
    createRun, getRun, getRunById, getRunInput, updateRun, appendEvent, recordStage, listStages, listEvents,
    acquireLease, renewLease, releaseLease, beginProvider, requestPause, resumeRun, recoverExpiredRuns,
    close: () => options.repository ? Promise.resolve() : repository.close()
  };
}

module.exports = { createJsonGenerationStore, publicRun, GENERATION_INDEX_SCOPE };
