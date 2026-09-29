'use strict';

const crypto = require('node:crypto');
const { GenerationError } = require('./errors');
const { isTerminal, transition } = require('./state-machine');

/** 初始化本地生成任务、阶段、幂等键和事件日志表。 */
function ensureSqliteSchema(db) {
  if (!db || typeof db.exec !== 'function') throw new TypeError('SQLite 数据库不可用');
  db.exec(`
    CREATE TABLE IF NOT EXISTS generation_runs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT '', project_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL, chapter_id TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL, pipeline_version TEXT NOT NULL,
      attempt_no INTEGER NOT NULL DEFAULT 0, idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL, input_json TEXT NOT NULL, manifest_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT NOT NULL DEFAULT '{}', error_code TEXT NOT NULL DEFAULT '', error_detail TEXT NOT NULL DEFAULT '',
      reserved_cost_minor INTEGER NOT NULL DEFAULT 0, actual_cost_minor INTEGER NOT NULL DEFAULT 0,
      cancel_requested INTEGER NOT NULL DEFAULT 0, pause_requested INTEGER NOT NULL DEFAULT 0,
      lease_owner TEXT, lease_until INTEGER,
      fencing_token INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, finished_at INTEGER,
      UNIQUE (workspace_id, project_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_generation_runs_project_updated ON generation_runs(workspace_id, project_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_generation_runs_actor_state ON generation_runs(actor_user_id, state, updated_at DESC);
    CREATE TABLE IF NOT EXISTS generation_stage_runs (
      generation_id TEXT NOT NULL, stage TEXT NOT NULL, attempt_no INTEGER NOT NULL,
      status TEXT NOT NULL, input_hash TEXT NOT NULL DEFAULT '', output_hash TEXT NOT NULL DEFAULT '',
      prompt_tokens INTEGER, completion_tokens INTEGER, reasoning_tokens INTEGER, cached_tokens INTEGER,
      reserved_cost_minor INTEGER NOT NULL DEFAULT 0, actual_cost_minor INTEGER NOT NULL DEFAULT 0,
      provider_request_id TEXT NOT NULL DEFAULT '', error_code TEXT NOT NULL DEFAULT '',
      started_at INTEGER, finished_at INTEGER,
      PRIMARY KEY (generation_id, stage, attempt_no),
      FOREIGN KEY (generation_id) REFERENCES generation_runs(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS generation_run_events (
      generation_id TEXT NOT NULL, event_seq INTEGER NOT NULL, state TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL,
      PRIMARY KEY (generation_id, event_seq),
      FOREIGN KEY (generation_id) REFERENCES generation_runs(id) ON DELETE CASCADE
    );
  `);
  const runColumns = new Set(db.prepare('PRAGMA table_info(generation_runs)').all().map(row => String(row.name)));
  if (!runColumns.has('reserved_cost_minor')) db.exec('ALTER TABLE generation_runs ADD COLUMN reserved_cost_minor INTEGER NOT NULL DEFAULT 0');
  if (!runColumns.has('actual_cost_minor')) db.exec('ALTER TABLE generation_runs ADD COLUMN actual_cost_minor INTEGER NOT NULL DEFAULT 0');
  if (!runColumns.has('pause_requested')) db.exec('ALTER TABLE generation_runs ADD COLUMN pause_requested INTEGER NOT NULL DEFAULT 0');
}

/** 把数据库行转换成不暴露内部输入正文的公开任务对象。 */
function publicRun(row) {
  if (!row) return null;
  let manifest = {}, result = {};
  try { manifest = JSON.parse(String(row.manifest_json || '{}')); } catch (_) {}
  try { result = JSON.parse(String(row.result_json || '{}')); } catch (_) {}
  return {
    id: String(row.id), workspaceId: String(row.workspace_id || ''), projectId: String(row.project_id),
    chapterId: String(row.chapter_id || ''), state: String(row.state),
    pipelineVersion: String(row.pipeline_version), attemptNo: Number(row.attempt_no) || 0,
    manifest, result, errorCode: String(row.error_code || ''), errorDetail: String(row.error_detail || ''),
    reservedCostMinor: Number(row.reserved_cost_minor) || 0, actualCostMinor: Number(row.actual_cost_minor) || 0,
    cancelRequested: Number(row.cancel_requested) === 1, pauseRequested: Number(row.pause_requested) === 1,
    fencingToken: Number(row.fencing_token) || 0,
    createdAt: Number(row.created_at) || 0, updatedAt: Number(row.updated_at) || 0,
    finishedAt: row.finished_at == null ? null : Number(row.finished_at)
  };
}

/** 事务化创建任务；同键同请求返回已有任务，同键异请求返回 409。 */
function createRun(db, input) {
  ensureSqliteSchema(db);
  const now = Number(input.now) || Date.now();
  const scope = [String(input.workspaceId || ''), String(input.projectId || ''), String(input.idempotencyKey || '')];
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db.prepare(`SELECT * FROM generation_runs WHERE workspace_id = ? AND project_id = ? AND idempotency_key = ?`).get(...scope);
    if (existing) {
      if (String(existing.actor_user_id) !== String(input.actorUserId || '')) {
        throw new GenerationError('IDEMPOTENCY_KEY_REUSED', '该幂等键已被项目其他成员使用', { status: 409 });
      }
      if (String(existing.request_hash) !== String(input.requestHash || '')) {
        throw new GenerationError('IDEMPOTENCY_KEY_REUSED', '同一 Idempotency-Key 不能用于不同请求', { status: 409 });
      }
      db.exec('COMMIT');
      return { run: publicRun(existing), idempotent: true };
    }
    const id = String(input.id || crypto.randomUUID());
    const serialized = JSON.stringify(input.request || {});
    db.prepare(`INSERT INTO generation_runs
      (id, workspace_id, project_id, actor_user_id, chapter_id, state, pipeline_version,
       attempt_no, idempotency_key, request_hash, input_json, manifest_json, result_json,
       created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'created', ?, 0, ?, ?, ?, ?, '{}', ?, ?)`)
      .run(id, scope[0], scope[1], String(input.actorUserId || ''), String(input.chapterId || ''),
        String(input.pipelineVersion || 'generation-v2.1'), scope[2], String(input.requestHash || ''),
        serialized, JSON.stringify(input.manifest || {}), now, now);
    db.prepare(`INSERT INTO generation_run_events(generation_id,event_seq,state,payload_json,created_at)
      VALUES (?,1,'created',?,?)`).run(id, JSON.stringify({ message: '生成任务已创建' }), now);
    db.exec('COMMIT');
    return { run: publicRun(db.prepare('SELECT * FROM generation_runs WHERE id = ?').get(id)), idempotent: false };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }
}

/** 在项目和用户作用域内读取任务，避免通过任务 ID 跨项目访问。 */
function getRun(db, input) {
  ensureSqliteSchema(db);
  const row = db.prepare(`SELECT * FROM generation_runs WHERE id = ? AND project_id = ? AND actor_user_id = ?
    AND (? = '' OR workspace_id = ?)`)
    .get(String(input.id || ''), String(input.projectId || ''), String(input.actorUserId || ''),
      String(input.workspaceId || ''), String(input.workspaceId || ''));
  return publicRun(row);
}

/** 按任务 ID 和创建者查找任务；路由随后仍会校验当前项目成员权限。 */
function getRunById(db, input) {
  ensureSqliteSchema(db);
  const row = db.prepare(`SELECT * FROM generation_runs WHERE id = ? AND actor_user_id = ?`)
    .get(String(input.id || ''), String(input.actorUserId || ''));
  return publicRun(row);
}

/** 仅供服务端恢复 worker 使用，读取公开任务对象之外的私有请求快照。 */
function getRunInput(db, input) {
  ensureSqliteSchema(db);
  const row = db.prepare(`SELECT input_json FROM generation_runs WHERE id = ? AND project_id = ? AND actor_user_id = ?
    AND (? = '' OR workspace_id = ?)`)
    .get(String(input.id || ''), String(input.projectId || ''), String(input.actorUserId || ''),
      String(input.workspaceId || ''), String(input.workspaceId || ''));
  if (!row) return null;
  try { return JSON.parse(String(row.input_json || '{}')); } catch (_) { return null; }
}

/** 按白名单状态迁移更新任务并追加有序事件。 */
function updateRun(db, input) {
  ensureSqliteSchema(db);
  const now = Number(input.now) || Date.now();
  let row = null;
  db.exec('BEGIN IMMEDIATE');
  try {
    row = db.prepare(`SELECT * FROM generation_runs WHERE id = ? AND project_id = ? AND actor_user_id = ?
      AND (? = '' OR workspace_id = ?)`)
      .get(String(input.id || ''), String(input.projectId || ''), String(input.actorUserId || ''),
        String(input.workspaceId || ''), String(input.workspaceId || ''));
    if (!row) throw new GenerationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', { status: 404 });
    const next = transition(publicRun(row), input.state, now);
    const resultJson = input.result === undefined ? row.result_json : JSON.stringify(input.result || {});
    const error = input.error || {};
    const manifestJson = input.manifest === undefined ? row.manifest_json : JSON.stringify(input.manifest || {});
    const hasLease = input.fencingToken != null;
    const updated = db.prepare(`UPDATE generation_runs SET state = ?, result_json = ?, manifest_json = ?, error_code = ?, error_detail = ?,
      updated_at = ?, finished_at = ?, cancel_requested = CASE WHEN ? = 'cancel_requested' THEN 1 ELSE cancel_requested END
      WHERE id = ? AND state = ? AND (? = 0 OR (lease_owner = ? AND fencing_token = ? AND lease_until > ?))`)
      .run(next.state, resultJson, manifestJson, String(error.code || row.error_code || ''), String(error.message || row.error_detail || '').slice(0, 1000),
        now, isTerminal(next.state) ? now : row.finished_at, next.state, row.id, row.state,
        hasLease ? 1 : 0, String(input.leaseOwner || ''), Number(input.fencingToken) || 0, now);
    if (Number(updated.changes) !== 1) throw new GenerationError('STATE_CONFLICT', hasLease ? '生成任务租约已过期或被替换' : '生成任务状态已被其他操作更新', { status: 409 });
    const seq = Number(db.prepare('SELECT coalesce(max(event_seq),0)+1 AS seq FROM generation_run_events WHERE generation_id = ?').get(row.id).seq);
    db.prepare(`INSERT INTO generation_run_events(generation_id,event_seq,state,payload_json,created_at) VALUES (?,?,?,?,?)`)
      .run(row.id, seq, next.state, JSON.stringify(input.event || {}), now);
    db.exec('COMMIT');
    return getRun(db, { id: row.id, projectId: row.project_id, actorUserId: row.actor_user_id, workspaceId: row.workspace_id });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }
}

/** 为同一任务追加不改变任务状态的进度事件。 */
function appendEvent(db, input) {
  ensureSqliteSchema(db);
  const hasLease = input.fencingToken != null;
  const now = Number(input.now) || Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare(`SELECT id,state FROM generation_runs WHERE id = ? AND project_id = ? AND actor_user_id = ?
      AND (? = '' OR workspace_id = ?) AND (? = 0 OR (lease_owner = ? AND fencing_token = ? AND lease_until > ?))`)
      .get(String(input.id || ''), String(input.projectId || ''), String(input.actorUserId || ''),
        String(input.workspaceId || ''), String(input.workspaceId || ''), hasLease ? 1 : 0,
        String(input.leaseOwner || ''), Number(input.fencingToken) || 0, now);
    if (!row) throw new GenerationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', { status: 404 });
    const sequence = Number(db.prepare(`SELECT coalesce(max(event_seq),0)+1 AS seq FROM generation_run_events WHERE generation_id = ?`).get(row.id).seq);
    db.prepare(`INSERT INTO generation_run_events(generation_id,event_seq,state,payload_json,created_at) VALUES (?,?,?,?,?)`)
      .run(row.id, sequence, row.state, JSON.stringify(input.event || {}), now);
    db.exec('COMMIT');
    return { sequence, state: row.state, createdAt: now };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }
}

/** 读取任务阶段清单用于 UI 进度和断线恢复。 */
function listStages(db, input) {
  ensureSqliteSchema(db);
  return db.prepare(`SELECT s.* FROM generation_stage_runs s
    JOIN generation_runs r ON r.id = s.generation_id
    WHERE s.generation_id = ? AND r.project_id = ? AND r.actor_user_id = ?
      AND (? = '' OR r.workspace_id = ?)
    ORDER BY s.started_at, s.stage, s.attempt_no`)
    .all(String(input.generationId || ''), String(input.projectId || ''), String(input.actorUserId || ''),
      String(input.workspaceId || ''), String(input.workspaceId || '')).map(row => ({
      stage: String(row.stage), attemptNo: Number(row.attempt_no) || 1, status: String(row.status),
      inputHash: String(row.input_hash || ''), outputHash: String(row.output_hash || ''),
      promptTokens: row.prompt_tokens == null ? null : Number(row.prompt_tokens),
      completionTokens: row.completion_tokens == null ? null : Number(row.completion_tokens),
      reasoningTokens: row.reasoning_tokens == null ? null : Number(row.reasoning_tokens),
      cachedTokens: row.cached_tokens == null ? null : Number(row.cached_tokens),
      reservedCostMinor: Number(row.reserved_cost_minor) || 0,
      actualCostMinor: Number(row.actual_cost_minor) || 0, providerRequestId: String(row.provider_request_id || ''),
      errorCode: String(row.error_code || ''), startedAt: Number(row.started_at) || 0,
      finishedAt: row.finished_at == null ? null : Number(row.finished_at)
    }));
}

/** 持久化阶段输入输出摘要、用量和失败码，禁止记录供应商密钥。 */
function recordStage(db, input) {
  ensureSqliteSchema(db);
  const hasLease = input.fencingToken != null;
  const now = Number(input.now) || Date.now();
  const stageNow = Number(input.finishedAt) || now;
  db.exec('BEGIN IMMEDIATE');
  try {
    const parent = db.prepare(`SELECT id FROM generation_runs WHERE id = ? AND project_id = ? AND actor_user_id = ?
      AND (? = '' OR workspace_id = ?) AND (? = 0 OR (lease_owner = ? AND fencing_token = ? AND lease_until > ?))`)
      .get(String(input.generationId), String(input.projectId || ''), String(input.actorUserId || ''),
        String(input.workspaceId || ''), String(input.workspaceId || ''), hasLease ? 1 : 0,
        String(input.leaseOwner || ''), Number(input.fencingToken) || 0, now);
    if (!parent) throw new GenerationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', { status: 404 });
    db.prepare(`INSERT INTO generation_stage_runs
      (generation_id,stage,attempt_no,status,input_hash,output_hash,prompt_tokens,completion_tokens,reasoning_tokens,cached_tokens,
       reserved_cost_minor,actual_cost_minor,provider_request_id,error_code,started_at,finished_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(generation_id,stage,attempt_no) DO UPDATE SET status=excluded.status, output_hash=excluded.output_hash,
        prompt_tokens=excluded.prompt_tokens, completion_tokens=excluded.completion_tokens,
        reasoning_tokens=excluded.reasoning_tokens, cached_tokens=excluded.cached_tokens,
        reserved_cost_minor=excluded.reserved_cost_minor,
        actual_cost_minor=excluded.actual_cost_minor, provider_request_id=excluded.provider_request_id,
        error_code=excluded.error_code, finished_at=excluded.finished_at`)
      .run(String(input.generationId), String(input.stage), Number(input.attemptNo) || 1, String(input.status || 'completed'),
        String(input.inputHash || ''), String(input.outputHash || ''), input.promptTokens == null ? null : Number(input.promptTokens),
        input.completionTokens == null ? null : Number(input.completionTokens), input.reasoningTokens == null ? null : Number(input.reasoningTokens),
        input.cachedTokens == null ? null : Number(input.cachedTokens), Number(input.reservedCostMinor) || 0, Number(input.actualCostMinor) || 0,
        String(input.providerRequestId || ''), String(input.errorCode || ''), Number(input.startedAt) || now,
        input.finishedAt == null ? null : Number(input.finishedAt));
    const updated = db.prepare(`UPDATE generation_runs SET
        reserved_cost_minor = (SELECT coalesce(sum(reserved_cost_minor),0) FROM generation_stage_runs WHERE generation_id = ?),
        actual_cost_minor = (SELECT coalesce(sum(actual_cost_minor),0) FROM generation_stage_runs WHERE generation_id = ?),
        updated_at = MAX(updated_at, ?)
      WHERE id = ? AND (? = 0 OR (lease_owner = ? AND fencing_token = ? AND lease_until > ?))`)
      .run(String(input.generationId), String(input.generationId), stageNow, String(input.generationId),
        hasLease ? 1 : 0, String(input.leaseOwner || ''), Number(input.fencingToken) || 0, now);
    if (Number(updated.changes) !== 1) throw new GenerationError('STATE_CONFLICT', '生成任务租约已过期或被替换', { status: 409 });
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }
}

/** Worker 从安全状态抢占任务；每次接管推进 fencing token。 */
function acquireLease(db, input) {
  ensureSqliteSchema(db);
  const now = Number(input.now) || Date.now();
  const ttlMs = Math.max(15000, Math.min(300000, Number(input.ttlMs) || 90000));
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare(`SELECT * FROM generation_runs WHERE id = ? AND project_id = ? AND actor_user_id = ?
      AND (? = '' OR workspace_id = ?)`)
      .get(String(input.id || ''), String(input.projectId || ''), String(input.actorUserId || ''),
        String(input.workspaceId || ''), String(input.workspaceId || ''));
    if (!row) throw new GenerationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', { status: 404 });
    const commitLease = String(input.leasePurpose || '') === 'commit';
    const allowedStates = commitLease ? new Set(['waiting_author', 'committing']) : new Set(['created']);
    if (!allowedStates.has(String(row.state)) || row.lease_owner && Number(row.lease_until) > now) {
      db.exec('COMMIT');
      return { acquired: false, run: publicRun(row) };
    }
    const owner = String(input.leaseOwner || '');
    if (!owner) throw new TypeError('leaseOwner is required');
    const fencingToken = (Number(row.fencing_token) || 0) + 1;
    const updated = db.prepare(`UPDATE generation_runs SET lease_owner = ?, lease_until = ?, fencing_token = ?, updated_at = ?
      WHERE id = ? AND state = ? AND fencing_token = ? AND (lease_until IS NULL OR lease_until <= ?)`)
      .run(owner, now + ttlMs, fencingToken, now, row.id, String(row.state), Number(row.fencing_token) || 0, now);
    if (Number(updated.changes) !== 1) {
      db.exec('ROLLBACK');
      return { acquired: false, run: getRun(db, { id: row.id, projectId: row.project_id, actorUserId: row.actor_user_id, workspaceId: row.workspace_id }) };
    }
    db.exec('COMMIT');
    return { acquired: true, fencingToken, leaseUntil: now + ttlMs };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }
}

/** 续租和释放都要求 owner/token 匹配，避免旧 worker 覆盖新执行。 */
function renewLease(db, input) {
  ensureSqliteSchema(db);
  const now = Number(input.now) || Date.now();
  const ttlMs = Math.max(15000, Math.min(300000, Number(input.ttlMs) || 90000));
  const updated = db.prepare(`UPDATE generation_runs SET lease_until = ?, updated_at = MAX(updated_at, ?)
    WHERE id = ? AND lease_owner = ? AND fencing_token = ? AND lease_until > ?
      AND state NOT IN ('committed','cancelled','failed','provider_unknown','rejected')`)
    .run(now + ttlMs, now, String(input.id || ''), String(input.leaseOwner || ''), Number(input.fencingToken) || 0, now);
  return Number(updated.changes) === 1;
}

function releaseLease(db, input) {
  ensureSqliteSchema(db);
  const updated = db.prepare(`UPDATE generation_runs SET lease_owner = NULL, lease_until = NULL, updated_at = MAX(updated_at, ?)
    WHERE id = ? AND lease_owner = ? AND fencing_token = ?`)
    .run(Number(input.now) || Date.now(), String(input.id || ''), String(input.leaseOwner || ''), Number(input.fencingToken) || 0);
  return Number(updated.changes) === 1;
}

/** Provider 请求前原子消费暂停请求，或进入 generating。 */
function beginProvider(db, input) {
  ensureSqliteSchema(db);
  const now = Number(input.now) || Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare(`SELECT * FROM generation_runs WHERE id = ? AND project_id = ? AND actor_user_id = ?
      AND (? = '' OR workspace_id = ?) AND lease_owner = ? AND fencing_token = ? AND lease_until > ?`)
      .get(String(input.id || ''), String(input.projectId || ''), String(input.actorUserId || ''),
        String(input.workspaceId || ''), String(input.workspaceId || ''), String(input.leaseOwner || ''), Number(input.fencingToken) || 0, now);
    if (!row) throw new GenerationError('STATE_CONFLICT', '生成任务租约已过期或被替换', { status: 409 });
    const paused = Number(row.pause_requested) === 1;
    const next = transition(publicRun(row), paused ? 'paused' : 'generating', now);
    db.prepare(`UPDATE generation_runs SET state = ?, pause_requested = 0, updated_at = ?, finished_at = NULL
      WHERE id = ? AND state = ? AND lease_owner = ? AND fencing_token = ?`)
      .run(next.state, now, row.id, row.state, String(input.leaseOwner || ''), Number(input.fencingToken) || 0);
    const seq = Number(db.prepare('SELECT coalesce(max(event_seq),0)+1 AS seq FROM generation_run_events WHERE generation_id = ?').get(row.id).seq);
    db.prepare(`INSERT INTO generation_run_events(generation_id,event_seq,state,payload_json,created_at) VALUES (?,?,?,?,?)`)
      .run(row.id, seq, next.state, JSON.stringify({ message: paused ? '已在 Provider 请求前安全暂停' : '正在生成正文' }), now);
    db.exec('COMMIT');
    return { paused, run: getRun(db, { id: row.id, projectId: row.project_id, actorUserId: row.actor_user_id, workspaceId: row.workspace_id }) };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }
}

/** Provider 尚未开始时受理暂停；生成中的 Provider 请求不会被标成 paused。 */
function requestPause(db, input) {
  ensureSqliteSchema(db);
  const now = Number(input.now) || Date.now();
  const safeStates = new Set(['created', 'request_validated', 'genre_resolved', 'style_resolved', 'context_built', 'contract_validated', 'pre_generation_guard', 'scene_planning']);
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare(`SELECT * FROM generation_runs WHERE id = ? AND project_id = ? AND actor_user_id = ?
      AND (? = '' OR workspace_id = ?)`)
      .get(String(input.id || ''), String(input.projectId || ''), String(input.actorUserId || ''),
        String(input.workspaceId || ''), String(input.workspaceId || ''));
    if (!row) throw new GenerationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', { status: 404 });
    const run = publicRun(row);
    if (run.state === 'paused') {
      db.exec('COMMIT');
      return run;
    }
    if (!safeStates.has(run.state)) {
      throw new GenerationError('STATE_CONFLICT', run.state === 'generating'
        ? 'Provider 请求已开始，当前不能暂停；任务状态不会伪装成 paused'
        : '当前阶段不能安全暂停生成任务', { status: 409 });
    }
    const activeLease = Boolean(row.lease_owner && Number(row.lease_until) > now);
    const nextState = activeLease ? run.state : transition(run, 'paused', now).state;
    const updated = db.prepare(`UPDATE generation_runs SET state = ?, pause_requested = ?, updated_at = ?
      WHERE id = ? AND state = ? AND fencing_token = ?`)
      .run(nextState, activeLease ? 1 : 0, now, row.id, row.state, Number(row.fencing_token) || 0);
    if (Number(updated.changes) !== 1) throw new GenerationError('STATE_CONFLICT', '生成任务状态已变化，请刷新后重试', { status: 409 });
    const seq = Number(db.prepare('SELECT coalesce(max(event_seq),0)+1 AS seq FROM generation_run_events WHERE generation_id = ?').get(row.id).seq);
    db.prepare(`INSERT INTO generation_run_events(generation_id,event_seq,state,payload_json,created_at) VALUES (?,?,?,?,?)`)
      .run(row.id, seq, nextState, JSON.stringify({ message: activeLease ? '已请求暂停，将在 Provider 请求前执行' : '任务已暂停' }), now);
    db.exec('COMMIT');
    return getRun(db, { id: row.id, projectId: row.project_id, actorUserId: row.actor_user_id, workspaceId: row.workspace_id });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }
}

/** 安全暂停只能从尚未调用 Provider 的边界重跑，既有输入快照保持不变。 */
function resumeRun(db, input) {
  ensureSqliteSchema(db);
  const now = Number(input.now) || Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare(`SELECT * FROM generation_runs WHERE id = ? AND project_id = ? AND actor_user_id = ?
      AND (? = '' OR workspace_id = ?)`)
      .get(String(input.id || ''), String(input.projectId || ''), String(input.actorUserId || ''),
        String(input.workspaceId || ''), String(input.workspaceId || ''));
    if (!row) throw new GenerationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', { status: 404 });
    if (String(row.state) !== 'paused') throw new GenerationError('STATE_CONFLICT', '只有已安全暂停的任务可以恢复', { status: 409 });
    if (row.lease_owner && Number(row.lease_until) > now) throw new GenerationError('STATE_CONFLICT', '暂停操作尚未释放 worker 租约，请稍后重试', { status: 409 });
    const next = transition(publicRun(row), 'created', now);
    const updated = db.prepare(`UPDATE generation_runs SET state = 'created', pause_requested = 0, attempt_no = attempt_no + 1,
      lease_owner = NULL, lease_until = NULL, fencing_token = fencing_token + 1, updated_at = ?, finished_at = NULL
      WHERE id = ? AND state = 'paused' AND fencing_token = ?`)
      .run(now, row.id, Number(row.fencing_token) || 0);
    if (Number(updated.changes) !== 1) throw new GenerationError('STATE_CONFLICT', '暂停任务已被其他 worker 更新', { status: 409 });
    const seq = Number(db.prepare('SELECT coalesce(max(event_seq),0)+1 AS seq FROM generation_run_events WHERE generation_id = ?').get(row.id).seq);
    db.prepare(`INSERT INTO generation_run_events(generation_id,event_seq,state,payload_json,created_at) VALUES (?,?,?,?,?)`)
      .run(row.id, seq, next.state, JSON.stringify({ message: '任务已恢复，将从 Provider 前安全边界重新执行' }), now);
    db.exec('COMMIT');
    return getRun(db, { id: row.id, projectId: row.project_id, actorUserId: row.actor_user_id, workspaceId: row.workspace_id });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }
}

function parseStoredJson(value) {
  try { return JSON.parse(String(value || '{}')); } catch (_) { return {}; }
}

/** 过期任务只恢复到安全边界；Provider 后的状态一律未知且不自动重试。 */
function recoverExpiredRuns(db, now = Date.now()) {
  ensureSqliteSchema(db);
  const safeStates = new Set(['created', 'request_validated', 'genre_resolved', 'style_resolved', 'context_built', 'contract_validated', 'pre_generation_guard', 'scene_planning']);
  const activeStates = ['created', 'request_validated', 'genre_resolved', 'style_resolved', 'context_built', 'contract_validated',
    'pre_generation_guard', 'scene_planning', 'generating', 'draft_received', 'deterministic_audit', 'semantic_audit',
    'quality_audit', 'revision', 'cancel_requested', 'committing'];
  const counts = { paused: 0, providerUnknown: 0, waitingAuthor: 0, committed: 0 };
  db.exec('BEGIN IMMEDIATE');
  try {
    const rows = db.prepare(`SELECT * FROM generation_runs WHERE state IN (${activeStates.map(() => '?').join(',')})
      AND (lease_until IS NULL OR lease_until <= ?)` ).all(...activeStates, now);
    for (const row of rows) {
      const state = String(row.state);
      let target;
      let errorCode = String(row.error_code || '');
      let errorDetail = String(row.error_detail || '');
      const result = parseStoredJson(row.result_json);
      if (state === 'committing') {
        const request = parseStoredJson(row.input_json);
        const chapterMatch = String(request.chapterId || '').match(/(\d+)/);
        const contract = request.chapterContract || request.contract || {};
        const chapterNo = Math.max(1, Number(contract.chapterNo || chapterMatch && chapterMatch[1]) || 1);
        const receipt = request.creationBookId && db.prepare(`SELECT * FROM benchmark_commit_receipts
          WHERE book_id = ? AND chapter_no = ?`).get(String(request.creationBookId), chapterNo);
        if (receipt && String(receipt.content_hash) === String(result.outputHash || '')) {
          target = 'committed';
          result.commitReceipt = { snapshotId: receipt.snapshot_id, stateVersion: Number(receipt.state_version), contentHash: receipt.content_hash, committed: true };
          counts.committed += 1;
        } else {
          target = 'waiting_author';
          counts.waitingAuthor += 1;
        }
      } else if (safeStates.has(state)) {
        target = 'paused';
        errorCode = '';
        errorDetail = '';
        counts.paused += 1;
      } else {
        target = 'provider_unknown';
        errorCode = 'PROVIDER_UNKNOWN';
        errorDetail = '服务进程在不可重试阶段中断，结果需要核对；系统未自动重发 Provider 请求';
        counts.providerUnknown += 1;
      }
      db.prepare(`UPDATE generation_runs SET state = ?, result_json = ?, error_code = ?, error_detail = ?,
        pause_requested = 0, lease_owner = NULL, lease_until = NULL, fencing_token = fencing_token + 1,
        updated_at = ?, finished_at = CASE WHEN ? IN ('committed','provider_unknown') THEN ? ELSE NULL END
        WHERE id = ? AND state = ? AND (lease_until IS NULL OR lease_until <= ?)`)
        .run(target, JSON.stringify(result), errorCode, errorDetail, now, target, now, row.id, state, now);
      const seq = Number(db.prepare('SELECT coalesce(max(event_seq),0)+1 AS seq FROM generation_run_events WHERE generation_id = ?').get(row.id).seq);
      const message = target === 'paused' ? '进程中断后安全恢复；任务已暂停，等待作者继续'
        : target === 'committed' ? '已从提交回执恢复完成状态'
          : target === 'waiting_author' ? '提交事务未落回执，可安全重新确认提交'
            : 'Provider 阶段结果未知，已停止自动重试';
      db.prepare(`INSERT INTO generation_run_events(generation_id,event_seq,state,payload_json,created_at) VALUES (?,?,?,?,?)`)
        .run(row.id, seq, target, JSON.stringify({ message, recovery: true }), now);
    }
    db.exec('COMMIT');
    return counts;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }
}

/** 按事件序号读取增量事件，供页面断线后继续恢复进度。 */
function listEvents(db, input) {
  ensureSqliteSchema(db);
  return db.prepare(`SELECT e.event_seq,e.state,e.payload_json,e.created_at FROM generation_run_events e
    JOIN generation_runs r ON r.id = e.generation_id
    WHERE e.generation_id = ? AND r.project_id = ? AND r.actor_user_id = ?
      AND (? = '' OR r.workspace_id = ?) AND e.event_seq > ?
    ORDER BY e.event_seq LIMIT ?`)
    .all(String(input.generationId || ''), String(input.projectId || ''), String(input.actorUserId || ''),
      String(input.workspaceId || ''), String(input.workspaceId || ''), Math.max(0, Number(input.after) || 0),
      Math.min(500, Math.max(1, Number(input.limit) || 100)))
    .map(row => {
      let payload = {};
      try { payload = JSON.parse(String(row.payload_json || '{}')); } catch (_) {}
      return { sequence: Number(row.event_seq), state: String(row.state), payload, createdAt: Number(row.created_at) || 0 };
    });
}

module.exports = {
  ensureSqliteSchema, publicRun, createRun, getRun, getRunById, getRunInput, updateRun,
  appendEvent, recordStage, listStages, listEvents, acquireLease, renewLease,
  releaseLease, beginProvider, requestPause, resumeRun, recoverExpiredRuns
};
