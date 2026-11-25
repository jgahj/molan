'use strict';

/**
 * PostgreSQL 生成运行态（Generation Run FSM / Lease / Stage / Event）子仓储方法集。
 * 自 lib/postgres-repository.js 领域化拆出，所有 SQL 均通过父仓储注入的事务边界执行，
 * 对外方法签名与行为 100% 保持不变。
 */

const crypto = require('node:crypto');
const { GenerationError } = require('../generation/errors');

function createPostgresGenerationRunMethods({
  UUID_PATTERN,
  PROJECT_READ_ROLES,
  PROJECT_WRITE_ROLES,
  GENERATION_SAFE_STATES,
  GENERATION_ACTIVE_STATES,
  internalUuid,
  normalizeLegacyId,
  repositoryError,
  parseJsonValue,
  parseJsonDocument,
  publicGenerationRun,
  assertGenerationLease,
  generationNow,
  generationLeaseTtl,
  hasRole,
  withTransaction,
  ensureActor,
  accessForClient,
  notifyRuntimeChanged
}) {
  /** 在项目 ACL 内创建可恢复的生成任务，并处理同键重放。 */
  async function createGenerationRun(input) {
    const userId = normalizeLegacyId(input.actorUserId || input.userId, 'actorUserId');
    const generationId = String(input.id || crypto.randomUUID()).trim();
    if (!UUID_PATTERN.test(generationId)) throw repositoryError('invalid_id', 'generationId格式无效', 422);
    const requestHash = String(input.requestHash || '');
    if (!/^[0-9a-f]{64}$/.test(requestHash)) throw repositoryError('invalid_request_hash', '生成请求摘要无效', 422);
    return withTransaction(userId, async client => {
      const actorUuid = await ensureActor(client, userId);
      const access = await accessForClient(client, input.projectId, input.workspaceId || '');
      if (!hasRole(access, PROJECT_WRITE_ROLES)) throw repositoryError('forbidden', '当前账户无权在该项目生成正文', 403);
      if (!access.can_spend) throw repositoryError('spend_forbidden', '当前账户没有该项目的生成额度权限', 403);
      const existing = await client.query(
        `SELECT r.*, w.legacy_id AS workspace_legacy_id, p.legacy_id AS project_legacy_id
         FROM luna.generation_runs r
         JOIN luna.workspaces w ON w.id = r.workspace_id
         JOIN luna.projects p ON p.workspace_id = r.workspace_id AND p.id = r.project_id
         WHERE r.workspace_id = $1::uuid AND r.project_id = $2::uuid AND r.idempotency_key = $3::text
         LIMIT 1`,
        [access.workspace_uuid, access.project_uuid, String(input.idempotencyKey || '')]
      );
      if (existing.rows.length) {
        const row = existing.rows[0];
        if (String(row.requested_by) !== actorUuid || String(row.request_hash) !== requestHash) {
          throw repositoryError('idempotency_conflict', '该幂等键已用于其他请求', 409);
        }
        return { run: publicGenerationRun(row), idempotent: true };
      }
      const inserted = await client.query(
        `INSERT INTO luna.generation_runs
          (workspace_id, project_id, id, requested_by, chapter_id, pipeline_version, state,
           idempotency_key, request_hash, input, manifest, model_id, provider_model)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::text,'created',
           $7::text,$8::text,$9::jsonb,$10::jsonb,$11::text,$12::text)
         ON CONFLICT (workspace_id, project_id, idempotency_key) DO NOTHING
         RETURNING *`,
        [access.workspace_uuid, access.project_uuid, generationId, actorUuid, String(input.chapterId || ''),
          String(input.pipelineVersion || 'generation-v2.1'), String(input.idempotencyKey || ''), requestHash,
          JSON.stringify(input.request || {}), JSON.stringify(input.manifest || {}), String(input.modelId || ''),
          String(input.providerModel || '')]
      );
      if (!inserted.rows.length) {
        const raced = await client.query(
          `SELECT * FROM luna.generation_runs
           WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND idempotency_key = $3::text
           LIMIT 1`,
          [access.workspace_uuid, access.project_uuid, String(input.idempotencyKey || '')]
        );
        const row = raced.rows[0];
        if (!row || String(row.requested_by) !== actorUuid || String(row.request_hash) !== requestHash) {
          throw repositoryError('idempotency_conflict', '该幂等键已用于其他请求', 409);
        }
        return { run: publicGenerationRun(row), idempotent: true };
      }
      await client.query(
        `INSERT INTO luna.generation_idempotency
          (workspace_id, project_id, idempotency_key, request_hash, generation_id)
         VALUES ($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid)`,
        [access.workspace_uuid, access.project_uuid, String(input.idempotencyKey || ''), requestHash, generationId]
      );
      await client.query(
        `INSERT INTO luna.generation_run_events
          (workspace_id, project_id, generation_id, event_seq, state, payload)
         VALUES ($1::uuid,$2::uuid,$3::uuid,1,'created',$4::jsonb)`,
        [access.workspace_uuid, access.project_uuid, generationId, JSON.stringify({ message: '生成任务已创建' })]
      );
      const row = await client.query(
        `SELECT r.*, w.legacy_id AS workspace_legacy_id, p.legacy_id AS project_legacy_id
         FROM luna.generation_runs r
         JOIN luna.workspaces w ON w.id = r.workspace_id
         JOIN luna.projects p ON p.workspace_id = r.workspace_id AND p.id = r.project_id
         WHERE r.workspace_id = $1::uuid AND r.project_id = $2::uuid AND r.id = $3::uuid`,
        [access.workspace_uuid, access.project_uuid, generationId]
      );
      return { run: publicGenerationRun(row.rows[0]), idempotent: false };
    });
  }

  /** 按项目、作者和 generation ID 读取任务，不返回其他成员的提示词快照。 */
  async function getGenerationRun(input) {
    const userId = normalizeLegacyId(input.actorUserId || input.userId, 'actorUserId');
    return withTransaction(userId, async client => {
      const actorUuid = await ensureActor(client, userId);
      const access = await accessForClient(client, input.projectId, input.workspaceId || '');
      if (!hasRole(access, PROJECT_READ_ROLES)) return null;
      const result = await client.query(
        `SELECT r.*, w.legacy_id AS workspace_legacy_id, p.legacy_id AS project_legacy_id
         FROM luna.generation_runs r
         JOIN luna.workspaces w ON w.id = r.workspace_id
         JOIN luna.projects p ON p.workspace_id = r.workspace_id AND p.id = r.project_id
         WHERE r.workspace_id = $1::uuid AND r.project_id = $2::uuid
           AND r.id = $3::uuid AND r.requested_by = $4::uuid
         LIMIT 1`,
        [access.workspace_uuid, access.project_uuid, internalUuid(input.id), actorUuid]
      );
      return publicGenerationRun(result.rows[0]);
    });
  }

  /** 按任务 ID 和创建者读取可访问的 generation run，供不带 projectId 的 URL 使用。 */
  async function getGenerationRunById(input) {
    const userId = normalizeLegacyId(input.actorUserId || input.userId, 'actorUserId');
    return withTransaction(userId, async client => {
      const actorUuid = await ensureActor(client, userId);
      const result = await client.query(
        `SELECT r.*, w.legacy_id AS workspace_legacy_id, p.legacy_id AS project_legacy_id
         FROM luna.generation_runs r
         JOIN luna.workspaces w ON w.id = r.workspace_id
         JOIN luna.projects p ON p.workspace_id = r.workspace_id AND p.id = r.project_id
         WHERE r.id = $1::uuid AND r.requested_by = $2::uuid
         LIMIT 1`,
        [internalUuid(input.id), actorUuid]
      );
      return publicGenerationRun(result.rows[0]);
    });
  }

  /** 仅供任务 worker 读取私有请求快照。 */
  async function getGenerationRunInput(input) {
    const userId = normalizeLegacyId(input.actorUserId || input.userId, 'actorUserId');
    return withTransaction(userId, async client => {
      const actorUuid = await ensureActor(client, userId);
      const access = await accessForClient(client, input.projectId, input.workspaceId || '');
      if (!hasRole(access, PROJECT_READ_ROLES)) return null;
      const result = await client.query(
        `SELECT input FROM luna.generation_runs
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid
           AND id = $3::uuid AND requested_by = $4::uuid LIMIT 1`,
        [access.workspace_uuid, access.project_uuid, internalUuid(input.id), actorUuid]
      );
      return result.rows.length ? parseJsonDocument(result.rows[0].input) : null;
    });
  }

  /** 以递增 fencing token 抢占一个待执行或待提交任务的租约。 */
  async function acquireGenerationRunLease(input) {
    const userId = normalizeLegacyId(input.actorUserId || input.userId, 'actorUserId');
    const owner = String(input.leaseOwner || '').trim();
    if (!UUID_PATTERN.test(owner)) throw repositoryError('invalid_lease_owner', '生成任务租约 owner 无效', 422);
    const now = generationNow(input);
    const leaseUntil = now + generationLeaseTtl(input);
    return withTransaction(userId, async client => {
      const actorUuid = await ensureActor(client, userId);
      const access = await accessForClient(client, input.projectId, input.workspaceId || '');
      if (!hasRole(access, PROJECT_WRITE_ROLES)) throw new GenerationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', { status: 404 });
      const id = internalUuid(input.id);
      const current = await client.query(
        `SELECT r.*, w.legacy_id AS workspace_legacy_id, p.legacy_id AS project_legacy_id
         FROM luna.generation_runs r
         JOIN luna.workspaces w ON w.id = r.workspace_id
         JOIN luna.projects p ON p.workspace_id = r.workspace_id AND p.id = r.project_id
         WHERE r.workspace_id = $1::uuid AND r.project_id = $2::uuid
           AND r.id = $3::uuid AND r.requested_by = $4::uuid FOR UPDATE OF r`,
        [access.workspace_uuid, access.project_uuid, id, actorUuid]
      );
      const row = current.rows[0];
      if (!row) throw new GenerationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', { status: 404 });
      const commitLease = String(input.leasePurpose || '') === 'commit';
      const allowedStates = commitLease ? new Set(['waiting_author', 'committing']) : new Set(['created']);
      const currentLeaseUntil = row.lease_until == null ? 0 : new Date(row.lease_until).getTime();
      if (!allowedStates.has(String(row.state)) || currentLeaseUntil > now) {
        return { acquired: false, run: publicGenerationRun(row) };
      }
      const updated = await client.query(
        `UPDATE luna.generation_runs
         SET lease_owner = $5::uuid, lease_until = to_timestamp($6::double precision / 1000),
             fencing_token = fencing_token + 1, updated_at = GREATEST(updated_at, to_timestamp($7::double precision / 1000))
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND id = $3::uuid
           AND requested_by = $4::uuid AND state = $8::text AND fencing_token = $9::bigint
           AND (lease_until IS NULL OR lease_until <= to_timestamp($7::double precision / 1000))
         RETURNING fencing_token`,
        [access.workspace_uuid, access.project_uuid, id, actorUuid, owner, leaseUntil, now,
          String(row.state), Number(row.fencing_token) || 0]
      );
      if (!updated.rows.length) return { acquired: false, run: publicGenerationRun(row) };
      return { acquired: true, fencingToken: Number(updated.rows[0].fencing_token), leaseUntil };
    });
  }

  /** 租约续期要求 owner/token 仍匹配且当前租约尚未过期。 */
  async function renewGenerationRunLease(input) {
    const userId = normalizeLegacyId(input.actorUserId || input.userId, 'actorUserId');
    const now = generationNow(input);
    const leaseUntil = now + generationLeaseTtl(input);
    return withTransaction(userId, async client => {
      const actorUuid = await ensureActor(client, userId);
      const access = await accessForClient(client, input.projectId, input.workspaceId || '');
      if (!hasRole(access, PROJECT_WRITE_ROLES)) return false;
      const result = await client.query(
        `UPDATE luna.generation_runs
         SET lease_until = to_timestamp($7::double precision / 1000),
             updated_at = GREATEST(updated_at, to_timestamp($8::double precision / 1000))
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND id = $3::uuid
           AND requested_by = $4::uuid AND lease_owner::text = $5::text AND fencing_token = $6::bigint
           AND lease_until > to_timestamp($8::double precision / 1000)
           AND state NOT IN ('committed','cancelled','failed','provider_unknown','rejected')`,
        [access.workspace_uuid, access.project_uuid, internalUuid(input.id), actorUuid,
          String(input.leaseOwner || ''), Number(input.fencingToken) || 0, leaseUntil, now]
      );
      return Number(result.rowCount) === 1;
    });
  }

  /** 释放操作只能清除调用者持有的当前 fencing token。 */
  async function releaseGenerationRunLease(input) {
    const userId = normalizeLegacyId(input.actorUserId || input.userId, 'actorUserId');
    const now = generationNow(input);
    return withTransaction(userId, async client => {
      const actorUuid = await ensureActor(client, userId);
      const access = await accessForClient(client, input.projectId, input.workspaceId || '');
      if (!hasRole(access, PROJECT_WRITE_ROLES)) return false;
      const result = await client.query(
        `UPDATE luna.generation_runs
         SET lease_owner = NULL, lease_until = NULL,
             updated_at = GREATEST(updated_at, to_timestamp($7::double precision / 1000))
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND id = $3::uuid
           AND requested_by = $4::uuid AND lease_owner::text = $5::text AND fencing_token = $6::bigint`,
        [access.workspace_uuid, access.project_uuid, internalUuid(input.id), actorUuid,
          String(input.leaseOwner || ''), Number(input.fencingToken) || 0, now]
      );
      return Number(result.rowCount) === 1;
    });
  }

  /** 在同一事务内更新状态并追加有序事件。 */
  async function updateGenerationRun(input) {
    const userId = normalizeLegacyId(input.actorUserId || input.userId, 'actorUserId');
    return withTransaction(userId, async client => {
      const actorUuid = await ensureActor(client, userId);
      const access = await accessForClient(client, input.projectId, input.workspaceId || '');
      if (!hasRole(access, PROJECT_WRITE_ROLES)) throw repositoryError('forbidden', '当前账户无权更新该生成任务', 403);
      const id = internalUuid(input.id);
      const current = await client.query(
        `SELECT * FROM luna.generation_runs
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid
           AND id = $3::uuid AND requested_by = $4::uuid FOR UPDATE`,
        [access.workspace_uuid, access.project_uuid, id, actorUuid]
      );
      const row = current.rows[0];
      if (!row) throw new GenerationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', { status: 404 });
      const now = generationNow(input);
      assertGenerationLease(row, input, now);
      const { transition, isTerminal } = require('../generation/state-machine');
      const next = transition({ state: row.state }, input.state, now);
      const hasResult = input.result !== undefined;
      const hasManifest = input.manifest !== undefined;
      const hasLease = input.fencingToken != null;
      const error = input.error || {};
      const updatedRun = await client.query(
        `UPDATE luna.generation_runs SET state = $5::text,
           result = CASE WHEN $6::boolean THEN $7::jsonb ELSE result END,
           manifest = CASE WHEN $8::boolean THEN $9::jsonb ELSE manifest END,
           error_code = $10::text, error_detail = $11::text,
           cancel_requested = cancel_requested OR $12::boolean,
           updated_at = GREATEST(updated_at, to_timestamp($17::double precision / 1000)),
           finished_at = CASE WHEN $13::boolean THEN to_timestamp($17::double precision / 1000) ELSE finished_at END
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND id = $3::uuid
           AND requested_by = $4::uuid AND state = $14::text
           AND ($15::bigint IS NULL OR (lease_owner::text = $16::text AND fencing_token = $15::bigint
             AND lease_until > to_timestamp($17::double precision / 1000)))`,
        [access.workspace_uuid, access.project_uuid, id, actorUuid, next.state, hasResult,
          JSON.stringify(input.result || {}), hasManifest, JSON.stringify(input.manifest || {}),
          String(error.code || row.error_code || ''), String(error.message || row.error_detail || '').slice(0, 1000),
          next.state === 'cancel_requested', isTerminal(next.state), row.state,
          hasLease ? Number(input.fencingToken) || 0 : null, hasLease ? String(input.leaseOwner || '') : null, now]
      );
      if (Number(updatedRun.rowCount) !== 1) {
        throw new GenerationError('STATE_CONFLICT', hasLease
          ? '生成任务租约已过期或被替换'
          : '生成任务状态已被其他操作更新', { status: 409 });
      }
      const sequence = await client.query(
        `SELECT coalesce(max(event_seq),0)+1 AS next_seq FROM luna.generation_run_events
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND generation_id = $3::uuid`,
        [access.workspace_uuid, access.project_uuid, id]
      );
      await client.query(
        `INSERT INTO luna.generation_run_events
          (workspace_id, project_id, generation_id, event_seq, state, payload)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::text,$6::jsonb)`,
        [access.workspace_uuid, access.project_uuid, id, sequence.rows[0].next_seq, next.state, JSON.stringify(input.event || {})]
      );
      if (next.state === 'cancel_requested') await notifyRuntimeChanged(client, 'generation-cancel', id.toString());
      const updated = await client.query(
        `SELECT r.*, w.legacy_id AS workspace_legacy_id, p.legacy_id AS project_legacy_id
         FROM luna.generation_runs r
         JOIN luna.workspaces w ON w.id = r.workspace_id
         JOIN luna.projects p ON p.workspace_id = r.workspace_id AND p.id = r.project_id
         WHERE r.workspace_id = $1::uuid AND r.project_id = $2::uuid
           AND r.id = $3::uuid AND r.requested_by = $4::uuid`,
        [access.workspace_uuid, access.project_uuid, id, actorUuid]
      );
      return publicGenerationRun(updated.rows[0]);
    });
  }

  /** 写入阶段摘要和用量；不持久化上游密钥或完整提示内容。 */
  async function recordGenerationStage(input) {
    const userId = normalizeLegacyId(input.actorUserId || input.userId, 'actorUserId');
    return withTransaction(userId, async client => {
      const actorUuid = await ensureActor(client, userId);
      const access = await accessForClient(client, input.projectId, input.workspaceId || '');
      if (!hasRole(access, PROJECT_WRITE_ROLES)) throw repositoryError('forbidden', '当前账户无权记录该生成阶段', 403);
      const now = generationNow(input);
      const parent = await client.query(
        `SELECT * FROM luna.generation_runs
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid
           AND id = $3::uuid AND requested_by = $4::uuid FOR UPDATE`,
        [access.workspace_uuid, access.project_uuid, internalUuid(input.generationId), actorUuid]
      );
      if (!parent.rows.length) throw new GenerationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', { status: 404 });
      assertGenerationLease(parent.rows[0], input, now);
      const result = await client.query(
        `INSERT INTO luna.generation_stage_runs
          (workspace_id, project_id, generation_id, stage, attempt_no, status, input_hash, output_hash,
           prompt_tokens, completion_tokens, reasoning_tokens, cached_tokens, reserved_cost_minor,
           actual_cost_minor, provider_request_id, error_code, started_at, finished_at)
         SELECT r.workspace_id, r.project_id, r.id, $5::text, $6::integer, $7::text, $8::text, $9::text,
           $10::bigint, $11::bigint, $12::bigint, $13::bigint, $14::bigint, $15::bigint, $16::text,
           $17::text, to_timestamp($18::double precision / 1000),
           CASE WHEN $19::bigint IS NULL THEN NULL ELSE to_timestamp($19::double precision / 1000) END
         FROM luna.generation_runs r
         WHERE r.workspace_id = $1::uuid AND r.project_id = $2::uuid
           AND r.id = $3::uuid AND r.requested_by = $4::uuid
         ON CONFLICT (workspace_id, project_id, generation_id, stage, attempt_no) DO UPDATE SET
           status = EXCLUDED.status, output_hash = EXCLUDED.output_hash,
           prompt_tokens = EXCLUDED.prompt_tokens, completion_tokens = EXCLUDED.completion_tokens,
           reasoning_tokens = EXCLUDED.reasoning_tokens, cached_tokens = EXCLUDED.cached_tokens,
           reserved_cost_minor = EXCLUDED.reserved_cost_minor, actual_cost_minor = EXCLUDED.actual_cost_minor,
           provider_request_id = EXCLUDED.provider_request_id,
           error_code = EXCLUDED.error_code, finished_at = EXCLUDED.finished_at
         RETURNING generation_id`,
        [access.workspace_uuid, access.project_uuid, internalUuid(input.generationId), actorUuid,
          String(input.stage || ''), Math.max(1, Number(input.attemptNo) || 1), String(input.status || 'completed'),
          String(input.inputHash || ''), String(input.outputHash || ''), input.promptTokens == null ? null : Number(input.promptTokens),
          input.completionTokens == null ? null : Number(input.completionTokens), input.reasoningTokens == null ? null : Number(input.reasoningTokens),
          input.cachedTokens == null ? null : Number(input.cachedTokens), Math.max(0, Number(input.reservedCostMinor) || 0),
          Math.max(0, Number(input.actualCostMinor) || 0), String(input.providerRequestId || ''), String(input.errorCode || ''),
          Number(input.startedAt) || Date.now(), input.finishedAt == null ? null : Number(input.finishedAt)]
      );
      if (!result.rows.length) throw new GenerationError(input.fencingToken == null ? 'RUN_NOT_FOUND' : 'STATE_CONFLICT',
        input.fencingToken == null ? '生成任务不存在或无权访问' : '生成任务租约已过期或被替换', { status: input.fencingToken == null ? 404 : 409 });
      const costUpdate = await client.query(
        `UPDATE luna.generation_runs r
         SET reserved_cost_minor = COALESCE((
               SELECT sum(s.reserved_cost_minor) FROM luna.generation_stage_runs s
               WHERE s.workspace_id = r.workspace_id AND s.project_id = r.project_id AND s.generation_id = r.id
             ), 0),
             actual_cost_minor = COALESCE((
               SELECT sum(s.actual_cost_minor) FROM luna.generation_stage_runs s
               WHERE s.workspace_id = r.workspace_id AND s.project_id = r.project_id AND s.generation_id = r.id
             ), 0),
             updated_at = GREATEST(r.updated_at, to_timestamp($6::double precision / 1000))
         WHERE r.workspace_id = $1::uuid AND r.project_id = $2::uuid AND r.id = $3::uuid
           AND ($4::bigint IS NULL OR (r.lease_owner::text = $5::text AND r.fencing_token = $4::bigint
             AND r.lease_until > to_timestamp($6::double precision / 1000)))`,
        [access.workspace_uuid, access.project_uuid, internalUuid(input.generationId),
          input.fencingToken == null ? null : Number(input.fencingToken) || 0,
          input.fencingToken == null ? null : String(input.leaseOwner || ''), now]
      );
      if (Number(costUpdate.rowCount) !== 1) throw new GenerationError('STATE_CONFLICT', '生成任务租约已过期或被替换', { status: 409 });
      return true;
    });
  }

  /** Provider 调用前消费暂停请求或原子转入 generating。 */
  async function beginGenerationProvider(input) {
    const userId = normalizeLegacyId(input.actorUserId || input.userId, 'actorUserId');
    const now = generationNow(input);
    return withTransaction(userId, async client => {
      const actorUuid = await ensureActor(client, userId);
      const access = await accessForClient(client, input.projectId, input.workspaceId || '');
      if (!hasRole(access, PROJECT_WRITE_ROLES)) throw new GenerationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', { status: 404 });
      const id = internalUuid(input.id);
      const current = await client.query(
        `SELECT r.*, w.legacy_id AS workspace_legacy_id, p.legacy_id AS project_legacy_id
         FROM luna.generation_runs r
         JOIN luna.workspaces w ON w.id = r.workspace_id
         JOIN luna.projects p ON p.workspace_id = r.workspace_id AND p.id = r.project_id
         WHERE r.workspace_id = $1::uuid AND r.project_id = $2::uuid
           AND r.id = $3::uuid AND r.requested_by = $4::uuid FOR UPDATE OF r`,
        [access.workspace_uuid, access.project_uuid, id, actorUuid]
      );
      const row = current.rows[0];
      if (!row) throw new GenerationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', { status: 404 });
      if (input.fencingToken == null) throw new GenerationError('STATE_CONFLICT', 'Provider 请求必须持有生成任务租约', { status: 409 });
      assertGenerationLease(row, input, now);
      if (String(row.state) === 'paused') return { paused: true, run: publicGenerationRun(row) };
      const paused = row.pause_requested === true || row.pause_requested === 't';
      const { transition } = require('../generation/state-machine');
      const next = transition({ state: row.state }, paused ? 'paused' : 'generating', now);
      const changed = await client.query(
        `UPDATE luna.generation_runs
         SET state = $5::text, pause_requested = false,
             started_at = COALESCE(started_at, to_timestamp($8::double precision / 1000)),
             updated_at = GREATEST(updated_at, to_timestamp($8::double precision / 1000)), finished_at = NULL
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND id = $3::uuid
           AND requested_by = $4::uuid AND state = $6::text AND lease_owner::text = $7::text
           AND fencing_token = $9::bigint AND lease_until > to_timestamp($8::double precision / 1000)`,
        [access.workspace_uuid, access.project_uuid, id, actorUuid, next.state, String(row.state),
          String(input.leaseOwner || ''), now, Number(input.fencingToken) || 0]
      );
      if (Number(changed.rowCount) !== 1) throw new GenerationError('STATE_CONFLICT', '生成任务租约已过期或被替换', { status: 409 });
      const sequence = await client.query(
        `SELECT coalesce(max(event_seq),0)+1 AS next_seq FROM luna.generation_run_events
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND generation_id = $3::uuid`,
        [access.workspace_uuid, access.project_uuid, id]
      );
      const message = paused ? '已在 Provider 请求前安全暂停' : '正在生成正文';
      await client.query(
        `INSERT INTO luna.generation_run_events
          (workspace_id, project_id, generation_id, event_seq, state, payload, created_at)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::text,$6::jsonb,to_timestamp($7::double precision / 1000))`,
        [access.workspace_uuid, access.project_uuid, id, sequence.rows[0].next_seq, next.state, JSON.stringify({ message }), now]
      );
      const updated = await client.query(
        `SELECT r.*, w.legacy_id AS workspace_legacy_id, p.legacy_id AS project_legacy_id
         FROM luna.generation_runs r
         JOIN luna.workspaces w ON w.id = r.workspace_id
         JOIN luna.projects p ON p.workspace_id = r.workspace_id AND p.id = r.project_id
         WHERE r.workspace_id = $1::uuid AND r.project_id = $2::uuid AND r.id = $3::uuid`,
        [access.workspace_uuid, access.project_uuid, id]
      );
      return { paused, run: publicGenerationRun(updated.rows[0]) };
    });
  }

  /** 暂停只在尚未开始 Provider 调用的安全边界生效。 */
  async function requestGenerationPause(input) {
    const userId = normalizeLegacyId(input.actorUserId || input.userId, 'actorUserId');
    const now = generationNow(input);
    return withTransaction(userId, async client => {
      const actorUuid = await ensureActor(client, userId);
      const access = await accessForClient(client, input.projectId, input.workspaceId || '');
      if (!hasRole(access, PROJECT_WRITE_ROLES)) throw new GenerationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', { status: 404 });
      const id = internalUuid(input.id);
      const current = await client.query(
        `SELECT r.*, w.legacy_id AS workspace_legacy_id, p.legacy_id AS project_legacy_id
         FROM luna.generation_runs r
         JOIN luna.workspaces w ON w.id = r.workspace_id
         JOIN luna.projects p ON p.workspace_id = r.workspace_id AND p.id = r.project_id
         WHERE r.workspace_id = $1::uuid AND r.project_id = $2::uuid
           AND r.id = $3::uuid AND r.requested_by = $4::uuid FOR UPDATE OF r`,
        [access.workspace_uuid, access.project_uuid, id, actorUuid]
      );
      const row = current.rows[0];
      if (!row) throw new GenerationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', { status: 404 });
      if (String(row.state) === 'paused') return publicGenerationRun(row);
      if (!GENERATION_SAFE_STATES.has(String(row.state))) {
        throw new GenerationError('STATE_CONFLICT', String(row.state) === 'generating'
          ? 'Provider 请求已开始，当前不能暂停；任务状态不会伪装成 paused'
          : '当前阶段不能安全暂停生成任务', { status: 409 });
      }
      const activeLease = Boolean(row.lease_owner && row.lease_until && new Date(row.lease_until).getTime() > now);
      const { transition } = require('../generation/state-machine');
      const nextState = activeLease ? String(row.state) : transition({ state: row.state }, 'paused', now).state;
      const changed = await client.query(
        `UPDATE luna.generation_runs
         SET state = $5::text, pause_requested = $6::boolean,
             updated_at = GREATEST(updated_at, to_timestamp($8::double precision / 1000))
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND id = $3::uuid
           AND requested_by = $4::uuid AND state = $7::text AND fencing_token = $9::bigint`,
        [access.workspace_uuid, access.project_uuid, id, actorUuid, nextState, activeLease, String(row.state), now,
          Number(row.fencing_token) || 0]
      );
      if (Number(changed.rowCount) !== 1) throw new GenerationError('STATE_CONFLICT', '生成任务状态已变化，请刷新后重试', { status: 409 });
      const sequence = await client.query(
        `SELECT coalesce(max(event_seq),0)+1 AS next_seq FROM luna.generation_run_events
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND generation_id = $3::uuid`,
        [access.workspace_uuid, access.project_uuid, id]
      );
      const message = activeLease ? '已请求暂停，将在 Provider 请求前执行' : '任务已暂停';
      await client.query(
        `INSERT INTO luna.generation_run_events
          (workspace_id, project_id, generation_id, event_seq, state, payload, created_at)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::text,$6::jsonb,to_timestamp($7::double precision / 1000))`,
        [access.workspace_uuid, access.project_uuid, id, sequence.rows[0].next_seq, nextState, JSON.stringify({ message }), now]
      );
      const updated = await client.query(
        `SELECT r.*, w.legacy_id AS workspace_legacy_id, p.legacy_id AS project_legacy_id
         FROM luna.generation_runs r
         JOIN luna.workspaces w ON w.id = r.workspace_id
         JOIN luna.projects p ON p.workspace_id = r.workspace_id AND p.id = r.project_id
         WHERE r.workspace_id = $1::uuid AND r.project_id = $2::uuid AND r.id = $3::uuid`,
        [access.workspace_uuid, access.project_uuid, id]
      );
      return publicGenerationRun(updated.rows[0]);
    });
  }

  /** 安全恢复从 Provider 前边界重新排队，并推进 fencing token。 */
  async function resumeGenerationRun(input) {
    const userId = normalizeLegacyId(input.actorUserId || input.userId, 'actorUserId');
    const now = generationNow(input);
    return withTransaction(userId, async client => {
      const actorUuid = await ensureActor(client, userId);
      const access = await accessForClient(client, input.projectId, input.workspaceId || '');
      if (!hasRole(access, PROJECT_WRITE_ROLES)) throw new GenerationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', { status: 404 });
      const id = internalUuid(input.id);
      const current = await client.query(
        `SELECT r.*, w.legacy_id AS workspace_legacy_id, p.legacy_id AS project_legacy_id
         FROM luna.generation_runs r
         JOIN luna.workspaces w ON w.id = r.workspace_id
         JOIN luna.projects p ON p.workspace_id = r.workspace_id AND p.id = r.project_id
         WHERE r.workspace_id = $1::uuid AND r.project_id = $2::uuid
           AND r.id = $3::uuid AND r.requested_by = $4::uuid FOR UPDATE OF r`,
        [access.workspace_uuid, access.project_uuid, id, actorUuid]
      );
      const row = current.rows[0];
      if (!row) throw new GenerationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', { status: 404 });
      if (String(row.state) !== 'paused') throw new GenerationError('STATE_CONFLICT', '只有已安全暂停的任务可以恢复', { status: 409 });
      if (row.lease_owner && row.lease_until && new Date(row.lease_until).getTime() > now) {
        throw new GenerationError('STATE_CONFLICT', '暂停操作尚未释放 worker 租约，请稍后重试', { status: 409 });
      }
      const { transition } = require('../generation/state-machine');
      const next = transition({ state: row.state }, 'created', now);
      const changed = await client.query(
        `UPDATE luna.generation_runs
         SET state = $5::text, pause_requested = false, attempt_no = attempt_no + 1,
             lease_owner = NULL, lease_until = NULL, fencing_token = fencing_token + 1,
             updated_at = GREATEST(updated_at, to_timestamp($7::double precision / 1000)), finished_at = NULL
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND id = $3::uuid
           AND requested_by = $4::uuid AND state = 'paused' AND fencing_token = $6::bigint
           AND (lease_until IS NULL OR lease_until <= to_timestamp($7::double precision / 1000))`,
        [access.workspace_uuid, access.project_uuid, id, actorUuid, next.state, Number(row.fencing_token) || 0, now]
      );
      if (Number(changed.rowCount) !== 1) throw new GenerationError('STATE_CONFLICT', '暂停任务已被其他 worker 更新', { status: 409 });
      const sequence = await client.query(
        `SELECT coalesce(max(event_seq),0)+1 AS next_seq FROM luna.generation_run_events
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND generation_id = $3::uuid`,
        [access.workspace_uuid, access.project_uuid, id]
      );
      await client.query(
        `INSERT INTO luna.generation_run_events
          (workspace_id, project_id, generation_id, event_seq, state, payload, created_at)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::text,$6::jsonb,to_timestamp($7::double precision / 1000))`,
        [access.workspace_uuid, access.project_uuid, id, sequence.rows[0].next_seq, next.state,
          JSON.stringify({ message: '任务已恢复，将从 Provider 前安全边界重新执行' }), now]
      );
      const updated = await client.query(
        `SELECT r.*, w.legacy_id AS workspace_legacy_id, p.legacy_id AS project_legacy_id
         FROM luna.generation_runs r
         JOIN luna.workspaces w ON w.id = r.workspace_id
         JOIN luna.projects p ON p.workspace_id = r.workspace_id AND p.id = r.project_id
         WHERE r.workspace_id = $1::uuid AND r.project_id = $2::uuid AND r.id = $3::uuid`,
        [access.workspace_uuid, access.project_uuid, id]
      );
      return publicGenerationRun(updated.rows[0]);
    });
  }

  /** 通过事务性提交 outbox 和正文 revision 识别已完成的提交。 */
  async function findGenerationCommitReceipt(client, row, result, request) {
    const bookId = String(request.creationBookId || request.bookId || '').trim();
    const chapterId = String(request.chapterId || row.chapter_id || '');
    const chapterMatch = chapterId.match(/(\d+)/);
    const contract = request.chapterContract || request.contract || {};
    const chapterNo = Math.max(1, Number(contract.chapterNo || request.chapterNo || chapterMatch && chapterMatch[1]) || 1);
    const outputHash = String(result.outputHash || '').toLowerCase();
    if (!bookId || !/^[a-f0-9]{64}$/.test(outputHash)) return null;
    const manuscriptId = internalUuid(`manuscript:${bookId}:chapter:${chapterNo}`);
    const receipt = await client.query(
      `SELECT o.payload, o.aggregate_revision, o.aggregate_id
       FROM luna.outbox o
       JOIN luna.commit_items ci
         ON ci.workspace_id = o.workspace_id AND ci.project_id = o.project_id AND ci.commit_id = o.commit_id
       JOIN luna.manuscript_revisions mr
         ON mr.workspace_id = ci.workspace_id AND mr.project_id = ci.project_id
        AND mr.manuscript_id = ci.manuscript_id AND mr.revision = ci.after_revision
       JOIN luna.context_snapshots cs
         ON cs.workspace_id = o.workspace_id AND cs.project_id = o.project_id
        AND cs.legacy_id = o.payload->>'snapshotId'
       WHERE o.workspace_id = $1::uuid AND o.project_id = $2::uuid
         AND o.aggregate_type = 'commit' AND o.event_type = 'commit.committed'
         AND ci.manuscript_id = $3::uuid AND ci.delta->>'chapterNo' = $4::text
         AND ci.delta->>'contentHash' = $5::text AND mr.body_hash = $5::text
         AND o.payload->>'chapterNo' = $4::text AND o.payload->>'contentHash' = $5::text
         AND cs.state_revision = o.aggregate_revision AND cs.payload->>'contentHash' = $5::text
       LIMIT 1`,
      [row.workspace_id, row.project_id, manuscriptId, String(chapterNo), outputHash]
    );
    const match = receipt.rows[0];
    if (!match) return null;
    const payload = parseJsonValue(match.payload);
    return {
      snapshotId: String(payload.snapshotId || ''),
      stateVersion: Number(match.aggregate_revision) || 0,
      commitId: String(match.aggregate_id || ''),
      contentHash: outputHash,
      committed: true
    };
  }

  /** 仅恢复 actor 可见且 lease 已过期的任务；不自动重发 Provider 请求。 */
  async function recoverExpiredGenerationRuns(input) {
    const userId = normalizeLegacyId(input.actorUserId || input.userId, 'actorUserId');
    const now = generationNow(input);
    return withTransaction(userId, async client => {
      const actorUuid = await ensureActor(client, userId);
      const workspaceUuid = input.workspaceId ? internalUuid(normalizeLegacyId(input.workspaceId, 'workspaceId')) : null;
      const projectUuid = input.projectId ? internalUuid(normalizeLegacyId(input.projectId, 'projectId')) : null;
      const expired = await client.query(
        `SELECT r.* FROM luna.generation_runs r
         WHERE r.requested_by = $1::uuid AND r.state = ANY($2::text[])
           AND r.lease_owner IS NOT NULL AND r.lease_until <= to_timestamp($5::double precision / 1000)
           AND ($3::uuid IS NULL OR r.workspace_id = $3::uuid)
           AND ($4::uuid IS NULL OR r.project_id = $4::uuid)
         ORDER BY r.updated_at, r.id FOR UPDATE OF r SKIP LOCKED`,
        [actorUuid, GENERATION_ACTIVE_STATES, workspaceUuid, projectUuid, now]
      );
      const counts = { paused: 0, providerUnknown: 0, waitingAuthor: 0, committed: 0 };
      for (const row of expired.rows) {
        const state = String(row.state || '');
        let target;
        let errorCode = String(row.error_code || '');
        let errorDetail = String(row.error_detail || '');
        const result = parseJsonDocument(row.result) || {};
        if (state === 'committing') {
          const request = parseJsonDocument(row.input) || {};
          const receipt = await findGenerationCommitReceipt(client, row, result, request);
          if (receipt) {
            target = 'committed';
            result.commitReceipt = receipt;
            errorCode = '';
            errorDetail = '';
            counts.committed += 1;
          } else {
            target = 'waiting_author';
            errorCode = '';
            errorDetail = '';
            counts.waitingAuthor += 1;
          }
        } else if (GENERATION_SAFE_STATES.has(state)) {
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
        const changed = await client.query(
          `UPDATE luna.generation_runs
           SET state = $5::text, result = $6::jsonb, error_code = $7::text, error_detail = $8::text,
               pause_requested = false, lease_owner = NULL, lease_until = NULL,
               fencing_token = fencing_token + 1,
               updated_at = to_timestamp($9::double precision / 1000),
               finished_at = CASE WHEN $5::text IN ('committed','provider_unknown')
                 THEN to_timestamp($9::double precision / 1000) ELSE NULL END
           WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND id = $3::uuid
             AND requested_by = $4::uuid AND state = $10::text AND fencing_token = $11::bigint
             AND lease_owner IS NOT NULL AND lease_until <= to_timestamp($9::double precision / 1000)
           RETURNING state`,
          [row.workspace_id, row.project_id, row.id, actorUuid, target, JSON.stringify(result), errorCode,
            errorDetail, now, state, Number(row.fencing_token) || 0]
        );
        if (!changed.rows.length) continue;
        const sequence = await client.query(
          `SELECT coalesce(max(event_seq),0)+1 AS next_seq FROM luna.generation_run_events
           WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND generation_id = $3::uuid`,
          [row.workspace_id, row.project_id, row.id]
        );
        const message = target === 'paused' ? '进程中断后安全恢复；任务已暂停，等待作者继续'
          : target === 'committed' ? '已从提交回执恢复完成状态'
            : target === 'waiting_author' ? '提交事务未落回执，可安全重新确认提交'
              : 'Provider 阶段结果未知，已停止自动重试';
        await client.query(
          `INSERT INTO luna.generation_run_events
            (workspace_id, project_id, generation_id, event_seq, state, payload, created_at)
           VALUES ($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::text,$6::jsonb,to_timestamp($7::double precision / 1000))`,
          [row.workspace_id, row.project_id, row.id, sequence.rows[0].next_seq, target,
            JSON.stringify({ message, recovery: true }), now]
        );
      }
      return counts;
    });
  }

  /** 按 generation run 的作者和项目作用域读取持久化阶段记录。 */
  async function listGenerationStages(input) {
    const userId = normalizeLegacyId(input.actorUserId || input.userId, 'actorUserId');
    return withTransaction(userId, async client => {
      const actorUuid = await ensureActor(client, userId);
      const access = await accessForClient(client, input.projectId, input.workspaceId || '');
      if (!hasRole(access, PROJECT_READ_ROLES)) return [];
      const result = await client.query(
        `SELECT s.* FROM luna.generation_stage_runs s
         JOIN luna.generation_runs r ON r.workspace_id = s.workspace_id AND r.project_id = s.project_id AND r.id = s.generation_id
         WHERE s.workspace_id = $1::uuid AND s.project_id = $2::uuid
           AND s.generation_id = $3::uuid AND r.requested_by = $4::uuid
         ORDER BY s.started_at, s.stage, s.attempt_no`,
        [access.workspace_uuid, access.project_uuid, internalUuid(input.generationId), actorUuid]
      );
      return result.rows.map(row => ({
        stage: String(row.stage || ''), attemptNo: Number(row.attempt_no) || 1, status: String(row.status || ''),
        inputHash: String(row.input_hash || ''), outputHash: String(row.output_hash || ''),
        promptTokens: row.prompt_tokens == null ? null : Number(row.prompt_tokens),
        completionTokens: row.completion_tokens == null ? null : Number(row.completion_tokens),
        reasoningTokens: row.reasoning_tokens == null ? null : Number(row.reasoning_tokens),
        cachedTokens: row.cached_tokens == null ? null : Number(row.cached_tokens),
        reservedCostMinor: Number(row.reserved_cost_minor) || 0,
        actualCostMinor: Number(row.actual_cost_minor) || 0, providerRequestId: String(row.provider_request_id || ''),
        errorCode: String(row.error_code || ''), startedAt: row.started_at ? new Date(row.started_at).getTime() : 0,
        finishedAt: row.finished_at ? new Date(row.finished_at).getTime() : null
      }));
    });
  }

  /** 按事件序号读取生成进度，未授权项目和其他作者任务统一返回空列表。 */
  async function listGenerationEvents(input) {
    const userId = normalizeLegacyId(input.actorUserId || input.userId, 'actorUserId');
    return withTransaction(userId, async client => {
      const actorUuid = await ensureActor(client, userId);
      const access = await accessForClient(client, input.projectId, input.workspaceId || '');
      if (!hasRole(access, PROJECT_READ_ROLES)) return [];
      const result = await client.query(
        `SELECT e.event_seq,e.state,e.payload,e.created_at
         FROM luna.generation_run_events e
         JOIN luna.generation_runs r ON r.workspace_id = e.workspace_id AND r.project_id = e.project_id AND r.id = e.generation_id
         WHERE e.workspace_id = $1::uuid AND e.project_id = $2::uuid
           AND e.generation_id = $3::uuid AND r.requested_by = $4::uuid
           AND e.event_seq > $5::bigint
         ORDER BY e.event_seq LIMIT $6::integer`,
        [access.workspace_uuid, access.project_uuid, internalUuid(input.generationId), actorUuid,
          Math.max(0, Number(input.after) || 0), Math.min(500, Math.max(1, Number(input.limit) || 100))]
      );
      return result.rows.map(row => ({
        sequence: Number(row.event_seq), state: String(row.state || ''), payload: parseJsonValue(row.payload),
        createdAt: row.created_at ? new Date(row.created_at).getTime() : 0
      }));
    });
  }

  /** 为任务追加运行进度，不改变 FSM 状态。 */
  async function appendGenerationEvent(input) {
    const userId = normalizeLegacyId(input.actorUserId || input.userId, 'actorUserId');
    return withTransaction(userId, async client => {
      const actorUuid = await ensureActor(client, userId);
      const access = await accessForClient(client, input.projectId, input.workspaceId || '');
      if (!hasRole(access, PROJECT_WRITE_ROLES)) throw repositoryError('forbidden', '当前账户无权写入生成事件', 403);
      const id = internalUuid(input.id);
      const now = generationNow(input);
      const run = await client.query(
        `SELECT * FROM luna.generation_runs
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid
           AND id = $3::uuid AND requested_by = $4::uuid FOR UPDATE`,
        [access.workspace_uuid, access.project_uuid, id, actorUuid]
      );
      if (!run.rows.length) throw new GenerationError('RUN_NOT_FOUND', '生成任务不存在或无权访问', { status: 404 });
      assertGenerationLease(run.rows[0], input, now);
      const sequence = await client.query(
        `SELECT coalesce(max(event_seq),0)+1 AS next_seq FROM luna.generation_run_events
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND generation_id = $3::uuid`,
        [access.workspace_uuid, access.project_uuid, id]
      );
      const createdAt = input.now == null ? Date.now() : now;
      await client.query(
        `INSERT INTO luna.generation_run_events
          (workspace_id, project_id, generation_id, event_seq, state, payload, created_at)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::text,$6::jsonb,to_timestamp($7::double precision / 1000))`,
        [access.workspace_uuid, access.project_uuid, id, sequence.rows[0].next_seq, String(run.rows[0].state),
          JSON.stringify(input.event || {}), input.now == null ? createdAt : now]
      );
      return { sequence: Number(sequence.rows[0].next_seq), state: String(run.rows[0].state), createdAt };
    });
  }

  return {
    createGenerationRun,
    getGenerationRun,
    getGenerationRunById,
    getGenerationRunInput,
    updateGenerationRun,
    acquireGenerationRunLease,
    renewGenerationRunLease,
    releaseGenerationRunLease,
    beginGenerationProvider,
    requestGenerationPause,
    resumeGenerationRun,
    recoverExpiredGenerationRuns,
    appendGenerationEvent,
    recordGenerationStage,
    listGenerationStages,
    listGenerationEvents
  };
}

module.exports = { createPostgresGenerationRunMethods };
