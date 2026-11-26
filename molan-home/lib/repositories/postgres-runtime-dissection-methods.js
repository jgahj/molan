'use strict';

const crypto = require('node:crypto');

/**
 * PostgreSQL 运行时拆书、角色库、管理维护与模型用量台账子仓储方法集。
 * 自 lib/postgres-repository.js 领域化拆出，所有 SQL 均通过父仓储注入的事务边界执行。
 */
function createPostgresRuntimeDissectionMethods({
  internalUuid,
  normalizeLegacyId,
  repositoryError,
  parseJsonDocument,
  parseJsonValue,
  jsonHash,
  withTransaction,
  ensureActor,
  notifyRuntimeChanged,
  dissectionWorkerContext,
  appendAdminAuditInTx,
  hasValidExactTokenCount,
  runtimeUpdateAccount,
  mergeResourcesIntoState,
  resourcesForClient,
  syncStructuredResourceProjection,
  parseStoredSkillFiles,
  normalizeSkillRuntimeFiles,
  skillFileNames,
  skillRuntimeFilesComplete,
  serializeSkillFiles
}) {
  async function runtimeClaimDissectionWorker(actorUserId, dissectionId, workerId, leaseMs = 60000) {
    return withTransaction(actorUserId, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', ['dissection-owner:' + actorUserId]);
      const result = await client.query(
        `UPDATE luna.runtime_dissections
         SET worker_id = $2::text, worker_fence = worker_fence + 1,
             revision = revision + 1,
             worker_lease_until = clock_timestamp() + ($3::bigint * interval '1 millisecond')
         WHERE id = $1::text AND owner_actor_id = luna.actor_id() AND status = 'queued'
           AND cancel_requested = false AND worker_id = ''
           AND NOT EXISTS (
             SELECT 1 FROM luna.runtime_dissections active
             WHERE active.owner_actor_id = luna.actor_id() AND active.id <> $1::text
               AND active.worker_id <> '' AND active.worker_lease_until > clock_timestamp()
           )
         RETURNING worker_fence`,
        [String(dissectionId), String(workerId), Math.max(10000, Math.min(300000, Number(leaseMs) || 60000))]
      );
      return result.rows[0] ? { dissectionId: String(dissectionId), workerId: String(workerId),
        fence: Number(result.rows[0].worker_fence), actorUserId } : null;
    });
  }

  async function runtimeRenewDissectionWorker(lease) {
    return withTransaction(lease.actorUserId, async client => {
      const result = await client.query(
        `UPDATE luna.runtime_dissections SET worker_lease_until = clock_timestamp() + interval '60 seconds'
         WHERE id = $1::text AND owner_actor_id = luna.actor_id()
           AND worker_id = $2::text AND worker_fence = $3::bigint
           AND worker_lease_until > clock_timestamp() AND cancel_requested = false
           AND status IN ('queued', 'running') RETURNING id`,
        [lease.dissectionId, lease.workerId, lease.fence]
      );
      return result.rows.length === 1;
    });
  }

  async function withDissectionWorkerLease(lease, operation) {
    return dissectionWorkerContext.run(lease, operation);
  }

  async function runtimeReleaseDissectionWorker(lease) {
    return dissectionWorkerContext.run(null, () => withTransaction(lease.actorUserId, async client => {
      await client.query(
        `UPDATE luna.runtime_dissections SET worker_id = '', worker_lease_until = NULL
         WHERE id = $1::text AND owner_actor_id = luna.actor_id()
           AND worker_id = $2::text AND worker_fence = $3::bigint`,
        [lease.dissectionId, lease.workerId, lease.fence]
      );
    }));
  }

  async function runtimeRecoverExpiredDissectionWorkers() {
    return withTransaction('', async client => {
      const result = await client.query('SELECT luna.recover_expired_dissection_workers() AS recovered');
      return Number(result.rows[0]?.recovered) || 0;
    });
  }

  async function runtimeReadDissectionShare(actorUserId, token) {
    return withTransaction(actorUserId || '', async client => {
      const result = await client.query('SELECT * FROM luna.read_dissection_share($1::text)', [String(token || '')]);
      return result.rows[0] || null;
    });
  }

  async function runtimeListMemberDissectionShares(actorUserId) {
    return withTransaction(actorUserId, async client => {
      const result = await client.query('SELECT * FROM luna.list_member_dissection_shares()');
      return result.rows;
    });
  }

  async function runtimeListDissections(actorUserId) {
    return withTransaction(actorUserId, async client => {
      const result = await client.query(
        `SELECT id, owner_actor_id, owner_user_id, user_email, title, source_type, source_name,
                '' AS source_text,
                depth, purpose, selected_model, status, phase, phase_index, progress,
                estimated_credits, actual_credits, result_json, meta_json, error, cancel_requested,
                created_at_value, updated_at_value, revision, created_at, updated_at,
                worker_id, worker_fence, worker_lease_until
         FROM luna.runtime_dissections
         WHERE owner_actor_id = luna.actor_id()
         ORDER BY updated_at_value DESC, id ASC`
      );
      return result.rows;
    });
  }

  async function runtimeGetDissection(actorUserId, dissectionId) {
    return withTransaction(actorUserId, async client => {
      const result = await client.query(
        `SELECT * FROM luna.runtime_dissections
         WHERE id = $1::text AND owner_actor_id = luna.actor_id()
         LIMIT 1`, [String(dissectionId || '')]
      );
      const row = result.rows[0] || null;
      const lease = dissectionWorkerContext.getStore();
      if (lease && lease.dissectionId === String(dissectionId) &&
          (!row || row.worker_id !== lease.workerId || Number(row.worker_fence) !== lease.fence ||
            !row.worker_lease_until || new Date(row.worker_lease_until).getTime() <= Date.now())) {
        throw repositoryError('worker_lease_lost', '拆书运行权已失效，拒绝继续派发', 409);
      }
      return row;
    });
  }

  async function runtimeInsertDissection(record) {
    const ownerUserId = normalizeLegacyId(record.ownerUserId || record.userId, 'ownerUserId');
    return withTransaction(ownerUserId, async client => {
      const estimatedCredits = record.estimatedCredits === null
        ? null
        : (record.estimatedCredits === undefined ? 0 : (Number(record.estimatedCredits) || 0));
      const actualCredits = record.actualCredits === null
        ? null
        : (record.actualCredits === undefined ? 0 : (Number(record.actualCredits) || 0));
      const result = await client.query(
        `INSERT INTO luna.runtime_dissections
          (id, owner_actor_id, owner_user_id, user_email, title, source_type, source_name, source_text,
           depth, purpose, selected_model, status, phase, phase_index, progress, estimated_credits,
           actual_credits, result_json, meta_json, error, cancel_requested, created_at_value, updated_at_value,
           revision, document, cells, updated_at)
         VALUES ($1::text, $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text,
                 $9::text, $10::text, $11::text, $12::text, $13::text, $14::integer, $15::integer,
                 $16::numeric, $17::numeric, $18::text, $19::text, $20::text, $21::boolean, $22::bigint,
                 $23::bigint, 0, $24::jsonb, $25::jsonb, now())
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title, source_type = EXCLUDED.source_type, source_name = EXCLUDED.source_name,
           source_text = EXCLUDED.source_text, depth = EXCLUDED.depth, purpose = EXCLUDED.purpose,
           selected_model = EXCLUDED.selected_model, status = EXCLUDED.status, phase = EXCLUDED.phase,
           phase_index = EXCLUDED.phase_index, progress = EXCLUDED.progress,
           estimated_credits = EXCLUDED.estimated_credits, actual_credits = EXCLUDED.actual_credits,
           result_json = EXCLUDED.result_json, meta_json = EXCLUDED.meta_json,
           error = EXCLUDED.error, cancel_requested = EXCLUDED.cancel_requested,
           updated_at_value = EXCLUDED.updated_at_value, document = EXCLUDED.document,
           cells = EXCLUDED.cells, updated_at = now()
         RETURNING *`,
        [String(record.id || ''), internalUuid(ownerUserId), ownerUserId, String(record.userEmail || '').trim().toLowerCase(),
          String(record.title || ''), String(record.sourceType || ''), String(record.sourceName || ''), String(record.sourceText || ''),
          String(record.depth || 'standard'), String(record.purpose || 'new-writer'), String(record.selectedModel || ''),
          String(record.status || 'queued'), String(record.phase || 'queued'), Number(record.phaseIndex) || 0, Number(record.progress) || 0,
          estimatedCredits, actualCredits, JSON.stringify(record.result || {}),
          JSON.stringify(record.meta || {}), String(record.error || ''), record.cancelRequested === true,
          Number(record.createdAt) || Date.now(), Number(record.updatedAt) || Date.now(),
          JSON.stringify(record.document || {}), JSON.stringify(Array.isArray(record.cells) ? record.cells : [])]
      );
      await notifyRuntimeChanged(client, 'dissection', record.id);
      return result.rows[0] || null;
    });
  }

  async function runtimeUpdateDissection(record) {
    const ownerUserId = normalizeLegacyId(record.ownerUserId || record.userId, 'ownerUserId');
    return withTransaction(ownerUserId, async client => {
      const currentResult = await client.query(
        `SELECT * FROM luna.runtime_dissections
         WHERE id = $1::text AND owner_actor_id = luna.actor_id()
         FOR UPDATE`,
        [String(record.id || '')]
      );
      const currentRow = currentResult.rows[0];
      if (!currentRow) throw repositoryError('not_found', '拆书任务不存在或无权更新', 404);
      if (record.expectedRevision !== undefined &&
          (!Number.isSafeInteger(record.expectedRevision) || record.expectedRevision < 0 ||
           Number(currentRow.revision) !== record.expectedRevision)) {
        throw repositoryError('revision_conflict', '拆书任务版本已变化', 409);
      }

      const isCancelledInDb = currentRow.cancel_requested === true || currentRow.status === 'cancelled';
      if (isCancelledInDb && record.status !== 'cancelled') {
        throw repositoryError('cancelled', '拆书任务已取消，拒绝过期更新', 409);
      }

      let currentMeta = {};
      if (currentRow.meta_json === null || currentRow.meta_json === undefined || currentRow.meta_json === '') {
        throw repositoryError('corrupt_meta', '现有拆书任务元数据损坏', 500);
      }
      if (currentRow.meta_json !== null && currentRow.meta_json !== undefined && currentRow.meta_json !== '') {
        if (typeof currentRow.meta_json === 'object') {
          if (Array.isArray(currentRow.meta_json) || currentRow.meta_json === null) {
            throw repositoryError('corrupt_meta', '现有拆书任务元数据损坏', 500);
          }
          currentMeta = currentRow.meta_json;
        } else if (typeof currentRow.meta_json === 'string') {
          let parsedCurrentMeta;
          try {
            parsedCurrentMeta = JSON.parse(currentRow.meta_json);
          } catch (parseError) {
            throw repositoryError('corrupt_meta', '现有拆书任务元数据损坏', 500);
          }
          if (!parsedCurrentMeta || typeof parsedCurrentMeta !== 'object' || Array.isArray(parsedCurrentMeta)) {
            throw repositoryError('corrupt_meta', '现有拆书任务元数据损坏', 500);
          }
          currentMeta = parsedCurrentMeta;
        } else {
          throw repositoryError('corrupt_meta', '现有拆书任务元数据损坏', 500);
        }
      }

      let incomingMeta = {};
      if (record.meta === null) throw repositoryError('invalid_meta', '传入拆书任务元数据格式错误', 400);
      if (typeof record.meta === 'string') {
        let parsedIncomingMeta;
        try {
          parsedIncomingMeta = JSON.parse(record.meta);
        } catch (parseError) {
          throw repositoryError('invalid_meta', '传入拆书任务元数据格式错误', 400);
        }
        if (!parsedIncomingMeta || typeof parsedIncomingMeta !== 'object' || Array.isArray(parsedIncomingMeta)) {
          throw repositoryError('invalid_meta', '传入拆书任务元数据格式错误', 400);
        }
        incomingMeta = parsedIncomingMeta;
      } else if (record.meta !== null && record.meta !== undefined) {
        if (typeof record.meta !== 'object' || Array.isArray(record.meta)) {
          throw repositoryError('invalid_meta', '传入拆书任务元数据格式错误', 400);
        }
        incomingMeta = record.meta;
      }

      const mergedMeta = { ...currentMeta, ...incomingMeta };
      if (Object.prototype.hasOwnProperty.call(currentMeta, 'tags')) {
        mergedMeta.tags = currentMeta.tags;
      }
      if (Object.prototype.hasOwnProperty.call(currentMeta, 'folder')) {
        mergedMeta.folder = currentMeta.folder;
      }

      const preservedTitle = currentRow.title;

      let estimatedCredits = null;
      if (record.estimatedCredits !== null && record.estimatedCredits !== undefined) {
        const parsedEstimated = Number(record.estimatedCredits);
        estimatedCredits = Number.isFinite(parsedEstimated) ? parsedEstimated : 0;
      }

      let actualCredits = null;
      if (record.actualCredits !== null && record.actualCredits !== undefined) {
        const parsedActual = Number(record.actualCredits);
        actualCredits = Number.isFinite(parsedActual) ? parsedActual : 0;
      }
      if (isCancelledInDb) {
        if (currentRow.actual_credits === null) {
          actualCredits = null;
        } else {
          const currentActual = Number(currentRow.actual_credits);
          actualCredits = actualCredits !== null ? Math.max(actualCredits, currentActual) : currentActual;
        }
      }

      let effectiveStatus = String(record.status || 'queued');
      let effectiveCancelRequested = record.cancelRequested === true;
      let effectiveError = String(record.error || '');
      if (isCancelledInDb) {
        effectiveStatus = 'cancelled';
        effectiveCancelRequested = true;
        if (!effectiveError) {
          effectiveError = String(currentRow.error || '任务已取消，可从当前阶段继续');
        }
      }

      const result = await client.query(
        `UPDATE luna.runtime_dissections
         SET title = $2::text, source_type = $3::text, source_name = $4::text, source_text = $5::text,
             depth = $6::text, purpose = $7::text, selected_model = $8::text, status = $9::text,
             phase = $10::text, phase_index = $11::integer, progress = $12::integer,
             estimated_credits = $13::numeric, actual_credits = $14::numeric, result_json = $15::text,
             meta_json = $16::text, error = $17::text, cancel_requested = $18::boolean,
             owner_user_id = $19::text, updated_at_value = $20::bigint, revision = revision + 1,
             updated_at = now()
         WHERE id = $1::text AND owner_actor_id = luna.actor_id()
         RETURNING *`,
        [String(record.id || ''), preservedTitle, String(record.sourceType || ''), String(record.sourceName || ''),
          String(record.sourceText || ''), String(record.depth || 'standard'), String(record.purpose || 'new-writer'),
          String(record.selectedModel || ''), effectiveStatus, String(record.phase || 'queued'),
          Number(record.phaseIndex) || 0, Number(record.progress) || 0, estimatedCredits,
          actualCredits, JSON.stringify(record.result || {}), JSON.stringify(mergedMeta),
          effectiveError, effectiveCancelRequested, ownerUserId, Number(record.updatedAt) || Date.now()]
      );
      if (!result.rows.length) throw repositoryError('not_found', '拆书任务不存在或无权更新', 404);
      await notifyRuntimeChanged(client, 'dissection', record.id);
      return result.rows[0];
    });
  }

  async function runtimePatchDissectionMetadata(actorUserId, dissectionId, patchInput) {
    const normalizedActorUserId = normalizeLegacyId(actorUserId, 'actorUserId');
    const normalizedDissectionId = String(dissectionId || '');
    const patch = (patchInput && typeof patchInput === 'object' && !Array.isArray(patchInput)) ? patchInput : {};

    return withTransaction(normalizedActorUserId, async client => {
      const currentResult = await client.query(
        `SELECT * FROM luna.runtime_dissections
         WHERE id = $1::text AND owner_actor_id = luna.actor_id()
         FOR UPDATE`,
        [normalizedDissectionId]
      );
      const currentRow = currentResult.rows[0];
      if (!currentRow) throw repositoryError('not_found', '拆书任务不存在或无权修改', 404);

      let currentMeta = {};
      if (currentRow.meta_json === null || currentRow.meta_json === undefined || currentRow.meta_json === '') {
        throw repositoryError('corrupt_meta', '现有拆书任务元数据损坏', 500);
      }
      if (currentRow.meta_json !== null && currentRow.meta_json !== undefined && currentRow.meta_json !== '') {
        if (typeof currentRow.meta_json === 'object') {
          if (Array.isArray(currentRow.meta_json) || currentRow.meta_json === null) {
            throw repositoryError('corrupt_meta', '现有拆书任务元数据损坏', 500);
          }
          currentMeta = currentRow.meta_json;
        } else if (typeof currentRow.meta_json === 'string') {
          let parsedCurrentMeta;
          try {
            parsedCurrentMeta = JSON.parse(currentRow.meta_json);
          } catch (parseError) {
            throw repositoryError('corrupt_meta', '现有拆书任务元数据损坏', 500);
          }
          if (!parsedCurrentMeta || typeof parsedCurrentMeta !== 'object' || Array.isArray(parsedCurrentMeta)) {
            throw repositoryError('corrupt_meta', '现有拆书任务元数据损坏', 500);
          }
          currentMeta = parsedCurrentMeta;
        } else {
          throw repositoryError('corrupt_meta', '现有拆书任务元数据损坏', 500);
        }
      }

      if (patch.expectedRevision !== undefined) {
        const rawExpectedRevision = patch.expectedRevision;
        let parsedRevision = null;
        if (typeof rawExpectedRevision === 'number') {
          if (Number.isSafeInteger(rawExpectedRevision) && rawExpectedRevision >= 0) {
            parsedRevision = rawExpectedRevision;
          }
        } else if (typeof rawExpectedRevision === 'string') {
          const trimmedRevision = rawExpectedRevision.trim();
          if (/^\d+$/.test(trimmedRevision)) {
            const numericRevision = Number(trimmedRevision);
            if (Number.isSafeInteger(numericRevision) && numericRevision >= 0) {
              parsedRevision = numericRevision;
            }
          }
        }
        if (parsedRevision === null) {
          throw repositoryError('invalid_revision', 'expectedRevision 必须为合法非负整数', 400);
        }
        const currentRevision = Number(currentRow.revision) || 0;
        if (parsedRevision !== currentRevision) {
          throw repositoryError('revision_conflict', '拆书任务版本冲突，请刷新后重试', 409);
        }
      }

      let hasEffectiveChange = false;
      let nextTitle = currentRow.title;
      if (patch.title !== undefined) {
        const candidateTitle = String(patch.title).trim().slice(0, 120);
        if (candidateTitle && candidateTitle !== currentRow.title) {
          nextTitle = candidateTitle;
          hasEffectiveChange = true;
        }
      }

      const nextMeta = { ...currentMeta };
      if (patch.tags !== undefined) {
        const cleanedTags = Array.isArray(patch.tags)
          ? patch.tags.map(String).map(item => item.trim()).filter(Boolean).slice(0, 20)
          : [];
        const currentTags = Array.isArray(currentMeta.tags) ? currentMeta.tags : null;
        const tagsChanged = currentTags === null || cleanedTags.length !== currentTags.length || cleanedTags.some((tag, index) => tag !== currentTags[index]);
        if (tagsChanged) {
          nextMeta.tags = cleanedTags;
          hasEffectiveChange = true;
        }
      }

      if (patch.folder !== undefined) {
        const cleanedFolder = String(patch.folder).trim().slice(0, 60);
        const currentFolder = Object.prototype.hasOwnProperty.call(currentMeta, 'folder') ? String(currentMeta.folder || '').trim() : null;
        if (currentFolder === null || cleanedFolder !== currentFolder) {
          nextMeta.folder = cleanedFolder;
          hasEffectiveChange = true;
        }
      }

      if (!hasEffectiveChange) {
        return currentRow;
      }

      const updateResult = await client.query(
        `UPDATE luna.runtime_dissections
         SET title = $2::text, meta_json = $3::text, updated_at_value = $4::bigint,
             revision = revision + 1, updated_at = now()
         WHERE id = $1::text AND owner_actor_id = luna.actor_id()
         RETURNING *`,
        [normalizedDissectionId, nextTitle, JSON.stringify(nextMeta), Date.now()]
      );
      if (!updateResult.rows.length) throw repositoryError('not_found', '拆书任务不存在或无权修改', 404);
      await notifyRuntimeChanged(client, 'dissection', normalizedDissectionId);
      return updateResult.rows[0];
    });
  }

  async function runtimeRequestDissectionCancel(actorUserId, dissectionId) {
    const normalizedActorUserId = normalizeLegacyId(actorUserId, 'actorUserId');
    const normalizedDissectionId = String(dissectionId || '');
    return withTransaction(normalizedActorUserId, async client => {
      const currentResult = await client.query(
        `SELECT * FROM luna.runtime_dissections
         WHERE id = $1::text AND owner_actor_id = luna.actor_id()
         FOR UPDATE`,
        [normalizedDissectionId]
      );
      const currentRow = currentResult.rows[0];
      if (!currentRow) {
        throw repositoryError('not_found', '拆书任务不存在或无权访问', 404);
      }

      const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);
      if (terminalStatuses.has(currentRow.status)) {
        currentRow.wasQueued = false;
        currentRow.isNoop = true;
        currentRow.wasCancelled = false;
        return currentRow;
      }

      const wasQueued = currentRow.status === 'queued';
      const nowTimestamp = Date.now();
      const updateResult = await client.query(
        `UPDATE luna.runtime_dissections
         SET cancel_requested = true,
             status = 'cancelled',
             error = '任务已取消，可从当前阶段继续',
             updated_at_value = $2::bigint,
             revision = revision + 1,
             updated_at = now()
         WHERE id = $1::text AND owner_actor_id = luna.actor_id()
         RETURNING *`,
        [normalizedDissectionId, nowTimestamp]
      );
      if (!updateResult.rows.length) {
        throw repositoryError('not_found', '拆书任务不存在或无权访问', 404);
      }
      await notifyRuntimeChanged(client, 'dissection', normalizedDissectionId);
      const updatedRow = updateResult.rows[0];
      updatedRow.wasQueued = wasQueued;
      updatedRow.isNoop = false;
      updatedRow.wasCancelled = true;
      return updatedRow;
    });
  }

  async function runtimeRequeueDissection(actorUserId, dissectionId, retryState = {}) {
    const normalizedActorUserId = normalizeLegacyId(actorUserId, 'actorUserId');
    const normalizedDissectionId = String(dissectionId || '');
    return withTransaction(normalizedActorUserId, async client => {
      const currentResult = await client.query(
        `SELECT * FROM luna.runtime_dissections
         WHERE id = $1::text AND owner_actor_id = luna.actor_id()
         FOR UPDATE`,
        [normalizedDissectionId]
      );
      const currentRow = currentResult.rows[0];
      if (!currentRow) {
        throw repositoryError('not_found', '拆书任务不存在或无权访问', 404);
      }

      const rawRevision = retryState && retryState.expectedRevision;
      let parsedRevision = null;
      if (typeof rawRevision === 'number') {
        if (Number.isSafeInteger(rawRevision) && rawRevision >= 0) {
          parsedRevision = rawRevision;
        }
      } else if (typeof rawRevision === 'string') {
        const trimmedRevision = rawRevision.trim();
        if (/^\d+$/.test(trimmedRevision)) {
          const numericRevision = Number(trimmedRevision);
          if (Number.isSafeInteger(numericRevision) && numericRevision >= 0) {
            parsedRevision = numericRevision;
          }
        }
      }
      if (parsedRevision === null) {
        throw repositoryError('invalid_revision', 'expectedRevision 必须为非负安全整数', 400);
      }
      const currentRevisionNumber = Number(currentRow.revision) || 0;
      if (parsedRevision !== currentRevisionNumber) {
        throw repositoryError('revision_conflict', '拆书任务版本冲突，请刷新后重试', 409);
      }

      const retryableStatuses = new Set(['failed', 'cancelled', 'interrupted', 'needs_review']);
      const isCompletedAllowed = currentRow.status === 'completed' && retryState && retryState.allowCompletedRetry === true;
      if (!retryableStatuses.has(currentRow.status) && !isCompletedAllowed) {
        throw repositoryError('invalid_state', '当前任务状态不允许重试', 409);
      }

      let currentMeta = {};
      if (currentRow.meta_json === null || currentRow.meta_json === undefined || currentRow.meta_json === '') {
        throw repositoryError('corrupt_meta', '现有拆书任务元数据损坏', 500);
      }
      if (typeof currentRow.meta_json === 'object') {
        if (Array.isArray(currentRow.meta_json) || currentRow.meta_json === null) {
          throw repositoryError('corrupt_meta', '现有拆书任务元数据损坏', 500);
        }
        currentMeta = currentRow.meta_json;
      } else if (typeof currentRow.meta_json === 'string') {
        let parsedCurrentMeta;
        try {
          parsedCurrentMeta = JSON.parse(currentRow.meta_json);
        } catch (_) {
          throw repositoryError('corrupt_meta', '现有拆书任务元数据损坏', 500);
        }
        if (!parsedCurrentMeta || typeof parsedCurrentMeta !== 'object' || Array.isArray(parsedCurrentMeta)) {
          throw repositoryError('corrupt_meta', '现有拆书任务元数据损坏', 500);
        }
        currentMeta = parsedCurrentMeta;
      } else {
        throw repositoryError('corrupt_meta', '现有拆书任务元数据损坏', 500);
      }

      const updatedMeta = { ...currentMeta };
      updatedMeta.retryCount = (Number(currentMeta.retryCount) || 0) + 1;
      updatedMeta.batchQueued = false;

      const rawPhaseIndex = retryState && retryState.phaseIndex;
      const targetPhaseIndex = Number(rawPhaseIndex);
      if (!Number.isInteger(targetPhaseIndex) || targetPhaseIndex < 0) {
        throw repositoryError('invalid_phase_index', 'phaseIndex 必须为非负整数', 400);
      }
      const targetPhase = String(retryState && retryState.phase || '').trim();
      if (!targetPhase) {
        throw repositoryError('invalid_phase', 'phase 不能为空', 400);
      }
      const rawProgress = retryState && retryState.progress;
      const targetProgress = Number(rawProgress);
      if (!Number.isInteger(targetProgress) || targetProgress < 0 || targetProgress > 100) {
        throw repositoryError('invalid_progress', 'progress 必须为 0 到 100 的整数', 400);
      }
      const nowTimestamp = Date.now();

      const updateResult = await client.query(
        `UPDATE luna.runtime_dissections
         SET status = 'queued',
             worker_id = '', worker_lease_until = NULL, worker_fence = worker_fence + 1,
             cancel_requested = false,
             phase_index = $2::integer,
             phase = $3::text,
             progress = $4::integer,
             error = '',
             meta_json = $5::text,
             updated_at_value = $6::bigint,
             revision = revision + 1,
             updated_at = now()
         WHERE id = $1::text AND owner_actor_id = luna.actor_id()
         RETURNING *`,
        [normalizedDissectionId, targetPhaseIndex, targetPhase, targetProgress, JSON.stringify(updatedMeta), nowTimestamp]
      );

      if (!updateResult.rows.length) {
        throw repositoryError('not_found', '拆书任务不存在或无权访问', 404);
      }

      await notifyRuntimeChanged(client, 'dissection', normalizedDissectionId);
      return updateResult.rows[0];
    });
  }

  async function runtimeDeleteDissection(actorUserId, dissectionId) {
    return withTransaction(actorUserId, async client => {
      await client.query(
        `UPDATE luna.runtime_dissections SET worker_id = '', worker_lease_until = NULL,
           worker_fence = worker_fence + 1
         WHERE id = $1::text AND owner_actor_id = luna.actor_id()`,
        [String(dissectionId || '')]
      );
      const rows = await client.query(
        `DELETE FROM luna.runtime_dissection_rows
         WHERE owner_actor_id = luna.actor_id() AND dissection_id = $1::text`, [String(dissectionId || '')]
      );
      const result = await client.query(
        `DELETE FROM luna.runtime_dissections
         WHERE id = $1::text AND owner_actor_id = luna.actor_id() RETURNING id`,
        [String(dissectionId || '')]
      );
      if (result.rows.length) await notifyRuntimeChanged(client, 'dissection-delete', dissectionId);
      return result.rows.length + Number(rows.rowCount || 0);
    });
  }

  async function runtimeListDissectionRows(actorUserId, dissectionId, sourceTable = '') {
    return withTransaction(actorUserId, async client => {
      const values = [String(dissectionId || '')];
      const condition = sourceTable ? ' AND source_table = $2::text' : '';
      if (sourceTable) values.push(String(sourceTable));
      const result = await client.query(
        `SELECT * FROM luna.runtime_dissection_rows
         WHERE owner_actor_id = luna.actor_id() AND dissection_id = $1::text AND deleted_at IS NULL${condition}
         ORDER BY source_table ASC, source_row_no ASC NULLS LAST, row_key ASC`, values
      );
      return result.rows;
    });
  }

  async function runtimeCountDissectionRows(actorUserId, dissectionId) {
    return withTransaction(actorUserId, async client => {
      const result = await client.query(
        `SELECT
           source_table,
           count(*)::int AS count,
           count(*) FILTER (WHERE source_table = 'dissection_entities' AND (document->>'status') = 'candidate')::int AS candidate_count
         FROM luna.runtime_dissection_rows
         WHERE owner_actor_id = luna.actor_id() AND dissection_id = $1::text AND deleted_at IS NULL
         GROUP BY source_table`,
        [String(dissectionId || '')]
      );
      return result.rows;
    });
  }

  async function runtimeListCharacterLibrary(actorUserId) {
    return withTransaction(actorUserId, async client => {
      const result = await client.query(
        `SELECT * FROM luna.runtime_dissection_rows
         WHERE owner_actor_id = luna.actor_id() AND source_table = 'character_library'
           AND deleted_at IS NULL ORDER BY updated_at DESC, row_key ASC`
      );
      return result.rows;
    });
  }

  async function writeCharacterDocument(client, rowKey, document) {
    const serialized = JSON.stringify(document);
    const hash = crypto.createHash('sha256').update(serialized).digest('hex');
    const result = await client.query(
      `UPDATE luna.runtime_dissection_rows
       SET document = $2::jsonb, cells = '[]'::jsonb, row_sha256 = $3::text,
           value_sha256 = $3::text, updated_at = now()
       WHERE owner_actor_id = luna.actor_id() AND source_table = 'character_library'
         AND row_key = $1::text AND deleted_at IS NULL RETURNING *`,
      [rowKey, serialized, hash]
    );
    return result.rows[0];
  }

  function characterDocument(row) {
    const document = typeof row.document === 'string' ? JSON.parse(row.document) : row.document;
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw repositoryError('corrupt_character', '人物库文档损坏', 500);
    }
    return document;
  }

  async function runtimeSyncCharactersToLibrary(actorUserId, inputRows) {
    const actor = normalizeLegacyId(actorUserId, 'actorUserId');
    const rows = Array.isArray(inputRows) ? inputRows : [];
    return withTransaction(actor, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', ['character-library:' + actor]);
      for (const dissectionId of [...new Set(rows.map(row => String(row.dissectionId || '')))].sort()) {
        const parent = await client.query(
          `SELECT cancel_requested, status FROM luna.runtime_dissections
           WHERE id = $1::text AND owner_actor_id = luna.actor_id() FOR UPDATE`, [dissectionId]
        );
        if (!parent.rows[0]) throw repositoryError('not_found', '拆书任务不存在或无权访问', 404);
        if (parent.rows[0].cancel_requested || parent.rows[0].status === 'cancelled') throw repositoryError('cancelled', '拆书任务已取消', 409);
      }
      const existing = await client.query(
        `SELECT row_key, document->>'name' AS name FROM luna.runtime_dissection_rows
         WHERE owner_actor_id = luna.actor_id() AND source_table = 'character_library' AND deleted_at IS NULL`
      );
      const keys = new Set(existing.rows.map(row => row.row_key));
      const names = new Set(existing.rows.map(row => row.name));
      const additions = [];
      for (const row of rows) {
        const name = String(row.document?.name || '').trim();
        if (!name || keys.has(row.rowKey) || names.has(name)) continue;
        keys.add(row.rowKey);
        names.add(name);
        additions.push({ ...row, sourceTable: 'character_library' });
      }
      await insertRuntimeDissectionRows(client, actor, additions);
      if (additions.length) await notifyRuntimeChanged(client, 'character-library-sync', actor);
      return additions.length;
    });
  }

  async function runtimePatchCharacter(actorUserId, characterId, patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw repositoryError('invalid_patch', '人物修改必须为对象', 400);
    return withTransaction(actorUserId, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', ['character-library:' + actorUserId]);
      const current = await client.query(
        `SELECT * FROM luna.runtime_dissection_rows WHERE owner_actor_id = luna.actor_id()
         AND source_table = 'character_library' AND row_key = $1::text AND deleted_at IS NULL FOR UPDATE`,
        [String(characterId)]
      );
      if (!current.rows[0]) throw repositoryError('not_found', '角色不存在或无权访问', 404);
      const fields = {};
      for (const key of ['name', 'function', 'goal', 'conflict', 'arc', 'first_appearance', 'notes']) {
        if (patch[key] !== undefined) fields[key] = String(patch[key]).slice(0, key === 'name' ? 60 : 2000);
      }
      if (!Object.keys(fields).length) throw repositoryError('invalid_patch', '没有可更新的字段', 400);
      if (fields.name !== undefined) {
        fields.name = fields.name.trim();
        if (!fields.name) throw repositoryError('invalid_name', '角色名称不能为空', 400);
        const duplicate = await client.query(
          `SELECT row_key FROM luna.runtime_dissection_rows WHERE owner_actor_id = luna.actor_id()
           AND source_table = 'character_library' AND document->>'name' = $1::text
           AND row_key <> $2::text AND deleted_at IS NULL LIMIT 1`,
          [fields.name, String(characterId)]
        );
        if (duplicate.rows.length) throw repositoryError('character_conflict', '已存在同名角色', 409);
      }
      const row = await writeCharacterDocument(client, String(characterId), { ...characterDocument(current.rows[0]), ...fields });
      await notifyRuntimeChanged(client, 'character-library', characterId);
      return row;
    });
  }

  async function runtimeMergeCharacters(actorUserId, fromNames, intoName) {
    const targetName = String(intoName || '').trim().slice(0, 60);
    const names = [...new Set((Array.isArray(fromNames) ? fromNames : []).map(value => String(value).trim()).filter(Boolean))];
    if (!targetName || !names.length) throw repositoryError('invalid_merge', '请提供要合并的角色与目标角色', 400);
    return withTransaction(actorUserId, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', ['character-library:' + actorUserId]);
      const current = await client.query(
        `SELECT * FROM luna.runtime_dissection_rows WHERE owner_actor_id = luna.actor_id()
         AND source_table = 'character_library' AND document->>'name' = ANY($1::text[])
         AND deleted_at IS NULL ORDER BY row_key FOR UPDATE`, [[...names, targetName]]
      );
      let target = current.rows.find(row => characterDocument(row).name === targetName);
      const sources = current.rows.filter(row => characterDocument(row).name !== targetName);
      if (!sources.length) return 0;
      let merged = 0;
      if (!target) {
        target = sources.shift();
        merged++;
      }
      const document = { ...characterDocument(target), name: targetName };
      for (const source of sources) {
        const sourceDocument = characterDocument(source);
        for (const key of ['function', 'goal', 'conflict', 'arc', 'first_appearance', 'notes']) {
          if (!document[key] && sourceDocument[key]) document[key] = sourceDocument[key];
        }
        await client.query(
          `DELETE FROM luna.runtime_dissection_rows WHERE owner_actor_id = luna.actor_id()
           AND source_table = 'character_library' AND row_key = $1::text`, [source.row_key]
        );
        merged++;
      }
      await writeCharacterDocument(client, target.row_key, document);
      await notifyRuntimeChanged(client, 'character-library-merge', target.row_key);
      return merged;
    });
  }

  async function runtimeAdminDataRows(actorUserId, type) {
    return withTransaction(actorUserId, async client => {
      const admin = await client.query('SELECT luna.runtime_is_admin() AS is_admin');
      if (admin.rows[0]?.is_admin !== true) throw repositoryError('forbidden', '仅管理员可以查看全部数据', 403);
      const queries = {
        accounts: 'SELECT * FROM luna.runtime_accounts_all()',
        novels: `SELECT p.legacy_id AS id, account.email AS user_email, p.title, p.status,
          coalesce(profile.revision, p.revision) AS revision, profile.payload AS state,
          extract(epoch from p.created_at) * 1000 AS created_at,
          extract(epoch from coalesce(profile.updated_at, p.updated_at)) * 1000 AS updated_at
          FROM luna.projects p
          LEFT JOIN luna.project_profiles profile ON profile.workspace_id = p.workspace_id AND profile.project_id = p.id
          LEFT JOIN luna.project_members owner ON owner.workspace_id = p.workspace_id AND owner.project_id = p.id AND owner.active AND owner.role = 'owner'
          LEFT JOIN luna.runtime_accounts account ON account.id = owner.user_id WHERE p.status <> 'deleted'`,
        'user-skills': 'SELECT *, owner_email AS user_email, updated_at_value AS updated_at FROM luna.runtime_user_skills',
        'global-skills': 'SELECT *, updated_at_value AS updated_at, created_at_value AS created_at FROM luna.runtime_global_skills',
        'open-skills': 'SELECT *, updated_at_value AS updated_at FROM luna.runtime_open_skills',
        dissections: 'SELECT *, updated_at_value AS updated_at, created_at_value AS created_at FROM luna.runtime_dissections',
        'token-usage': "SELECT document FROM luna.runtime_dissection_rows WHERE source_table = 'token_usage' AND deleted_at IS NULL"
      };
      if (!Object.prototype.hasOwnProperty.call(queries, type)) throw repositoryError('invalid_type', '数据类型不合法', 400);
      const result = await client.query(queries[type]);
      if (type !== 'token-usage') return result.rows;
      return result.rows.map(row => {
        const document = typeof row.document === 'string' ? JSON.parse(row.document) : row.document;
        if (!document || typeof document !== 'object' || Array.isArray(document)) {
          throw repositoryError('corrupt_usage', '模型用量文档损坏', 500);
        }
        return document;
      });
    });
  }

  async function runtimeMaintenanceActor() {
    return withTransaction('', async client => {
      const result = await client.query('SELECT luna.runtime_maintenance_actor() AS actor');
      return result.rows[0]?.actor || '';
    });
  }

  async function runtimeAdminGetNovel(actorUserId, novelId) {
    return withTransaction(actorUserId, async client => {
      const admin = await client.query('SELECT luna.runtime_is_admin() AS is_admin');
      if (admin.rows[0]?.is_admin !== true) throw repositoryError('forbidden', '仅管理员可以管理作品', 403);
      const result = await client.query(
        `SELECT p.id, p.workspace_id, p.legacy_id, p.title, p.created_at, p.updated_at,
                profile.payload, coalesce(profile.revision, p.revision) AS revision,
                account.email AS owner_email
         FROM luna.projects p
         LEFT JOIN luna.project_profiles profile ON profile.workspace_id = p.workspace_id AND profile.project_id = p.id
         LEFT JOIN luna.project_members owner ON owner.workspace_id = p.workspace_id AND owner.project_id = p.id AND owner.active AND owner.role = 'owner'
         LEFT JOIN luna.runtime_accounts account ON account.id = owner.user_id
         WHERE p.legacy_id = $1::text AND p.status <> 'deleted'`, [String(novelId)]
      );
      const row = result.rows[0];
      if (!row) return null;
      const resources = await resourcesForClient(client, { workspace_uuid: row.workspace_id, project_uuid: row.id }, '', true);
      return {
        id: row.legacy_id, title: row.title, userEmail: row.owner_email,
        state: mergeResourcesIntoState(parseJsonValue(row.payload) || {}, resources),
        revision: Number(row.revision), createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime()
      };
    });
  }

  async function runtimeAdminWriteNovel(input) {
    return withTransaction(input.actorUserId, async client => {
      const admin = await client.query('SELECT luna.runtime_is_admin() AS is_admin');
      if (admin.rows[0]?.is_admin !== true) throw repositoryError('forbidden', '仅管理员可以管理作品', 403);
      const result = await client.query(
        `SELECT p.id, p.workspace_id, p.legacy_id, p.title, p.revision AS project_revision,
                account.email AS owner_email, account.id AS owner_user_id, account.legacy_user_id AS owner_legacy_user_id
         FROM luna.projects p
         LEFT JOIN luna.project_members owner ON owner.workspace_id = p.workspace_id AND owner.project_id = p.id AND owner.active AND owner.role = 'owner'
         LEFT JOIN luna.runtime_accounts account ON account.id = owner.user_id
         WHERE p.legacy_id = $1::text AND p.status <> 'deleted' FOR UPDATE OF p`, [String(input.id)]
      );
      const row = result.rows[0];
      if (!row) throw repositoryError('not_found', '作品不存在', 404);
      const profileResult = await client.query(
        'SELECT revision, payload FROM luna.project_profiles WHERE workspace_id = $1::uuid AND project_id = $2::uuid FOR UPDATE',
        [row.workspace_id, row.id]
      );
      const currentRevision = Number(profileResult.rows[0]?.revision ?? row.project_revision);
      if (input.expectedRevision !== undefined) {
        const expected = Number(input.expectedRevision);
        if (!Number.isSafeInteger(expected) || expected < 1) throw repositoryError('revision_required', '必须提供合法的作品 revision', 428);
        if (currentRevision !== expected) throw repositoryError('revision_conflict', '作品已被其他设备更新', 412);
      } else {
        throw repositoryError('revision_required', '必须提供当前作品 revision', 428);
      }
      if (input.delete === true) {
        await client.query("UPDATE luna.projects SET status = 'deleted', revision = revision + 1, updated_at = now() WHERE workspace_id = $1::uuid AND id = $2::uuid", [row.workspace_id, row.id]);
        if (input.audit) await appendAdminAuditInTx(client, input.audit);
        return 1;
      }
      const targetEmail = input.userEmail ? String(input.userEmail).trim().toLowerCase() : null;
      if (targetEmail && targetEmail !== String(row.owner_email || '').toLowerCase()) {
        const targetAccountResult = await client.query(
          'SELECT id, legacy_user_id, email FROM luna.runtime_accounts WHERE email = $1::text',
          [targetEmail]
        );
        const targetAccount = targetAccountResult.rows[0];
        if (!targetAccount) throw repositoryError('account_not_found', '作品所属账户不存在', 404);
        try {
          await client.query(
            'SELECT luna.runtime_admin_transfer_project_owner($1::uuid, $2::uuid, $3::uuid)',
            [row.workspace_id, row.id, targetAccount.id]
          );
        } catch (transferErr) {
          throw repositoryError('cannot_transfer_owner', '小说无法安全转移到目标账户: ' + (transferErr && transferErr.message || transferErr), 400);
        }
      }
      const nextRevision = (input.expectedRevision !== undefined ? Number(input.expectedRevision) : currentRevision) + 1;
      await client.query(
        `INSERT INTO luna.project_profiles (workspace_id, project_id, revision, payload, changed_by)
         VALUES ($1::uuid, $2::uuid, $3::bigint, $4::jsonb, luna.actor_id())
         ON CONFLICT (workspace_id, project_id) DO UPDATE SET revision = EXCLUDED.revision,
           payload = EXCLUDED.payload, changed_by = EXCLUDED.changed_by, updated_at = now()`,
        [row.workspace_id, row.id, nextRevision, JSON.stringify(input.state)]
      );
      await client.query('UPDATE luna.projects SET title = $3::text, revision = $4::bigint, updated_at = now() WHERE workspace_id = $1::uuid AND id = $2::uuid',
        [row.workspace_id, row.id, String(input.title), nextRevision]);
      await syncStructuredResourceProjection(client, { workspace_uuid: row.workspace_id, project_uuid: row.id }, input.state, internalUuid(input.actorUserId));
      if (input.audit) await appendAdminAuditInTx(client, input.audit);
      return { revision: nextRevision };
    });
  }

  async function runtimeAdminWriteUserSkill(input) {
    const actorUserId = normalizeLegacyId(input.actorUserId, 'actorUserId');
    const ownerEmail = String(input.ownerEmail || '').trim().toLowerCase();
    const skillId = String(input.skillId || '').trim();
    if (!ownerEmail || !skillId) throw repositoryError('invalid_param', '用户 Skill 缺少所属账户或 id', 400);
    return withTransaction(actorUserId, async client => {
      const admin = await client.query('SELECT luna.runtime_is_admin() AS is_admin');
      if (admin.rows[0]?.is_admin !== true) throw repositoryError('forbidden', '仅管理员可以管理用户 Skill', 403);
      const ownerRes = await client.query(
        'SELECT id, legacy_user_id, email FROM luna.runtime_accounts WHERE email = $1::text',
        [ownerEmail]
      );
      const ownerAccount = ownerRes.rows[0];
      if (!ownerAccount) throw repositoryError('account_not_found', 'Skill 所属账户不存在', 404);
      const currentRes = await client.query(
        'SELECT * FROM luna.runtime_user_skills WHERE owner_user_id = $1::uuid AND id = $2::text FOR UPDATE',
        [ownerAccount.id, skillId]
      );
      const currentRow = currentRes.rows[0];
      if (!currentRow) throw repositoryError('not_found', '用户 Skill 不存在', 404);
      if (input.expectedUpdatedAt !== undefined) {
        if (Number(currentRow.updated_at_value) !== Number(input.expectedUpdatedAt)) {
          throw repositoryError('revision_conflict', '用户 Skill 已变化，请重新加载', 409);
        }
      }
      const record = input.skill || {};
      const instruction = String(record.instruction !== undefined ? record.instruction : currentRow.instruction).replace(/\u0000/g, '').trim().slice(0, 1000000);
      if (!instruction) throw repositoryError('invalid_instruction', 'Skill 指令内容不能为空', 400);
      const name = String(record.name !== undefined ? record.name : (currentRow.name || skillId)).trim().slice(0, 120);
      if (!name) throw repositoryError('invalid_name', 'Skill 名称不能为空', 400);
      const description = String(record.description !== undefined ? record.description : (currentRow.description || '')).trim().slice(0, 500);
      const currentStoredFiles = parseStoredSkillFiles(currentRow.files_json);
      const runtimeFiles = normalizeSkillRuntimeFiles(record.runtimeFiles !== undefined ? record.runtimeFiles : currentStoredFiles.runtimeFiles, record.files !== undefined ? record.files : currentStoredFiles.files, { strict: true });
      const files = skillFileNames(runtimeFiles, record.files !== undefined ? record.files : currentStoredFiles.files);
      const fileManifest = Array.isArray(record.fileManifest) ? record.fileManifest : (currentStoredFiles.fileManifest || []);
      const complete = skillRuntimeFilesComplete(files, runtimeFiles, fileManifest);
      const filesJson = serializeSkillFiles({ files, runtimeFiles, fileManifest });
      const now = Math.max(Date.now(), Number(currentRow.updated_at_value) + 1);
      const document = {
        id: skillId, name, description, instruction, files_json: filesJson, files, runtimeFiles, fileManifest, complete
      };
      const result = await client.query(
        `UPDATE luna.runtime_user_skills
         SET name = $3::text, description = $4::text, instruction = $5::text,
             files_json = $6::text, size = $7::bigint, updated_at_value = $8::bigint,
             document = $9::jsonb, updated_at = now()
         WHERE owner_user_id = $1::uuid AND id = $2::text
         RETURNING *`,
        [ownerAccount.id, skillId, name, description, instruction, filesJson, instruction.length, now, JSON.stringify(document)]
      );
      if (input.audit) await appendAdminAuditInTx(client, input.audit);
      await notifyRuntimeChanged(client, 'user-skills', ownerAccount.legacy_user_id);
      return result.rows[0];
    });
  }

  async function runtimeAdminDeleteUserSkill(input) {
    const actorUserId = normalizeLegacyId(input.actorUserId, 'actorUserId');
    const ownerEmail = String(input.ownerEmail || '').trim().toLowerCase();
    const skillId = String(input.skillId || '').trim();
    if (!ownerEmail || !skillId) throw repositoryError('invalid_param', '用户 Skill 缺少所属账户或 id', 400);
    return withTransaction(actorUserId, async client => {
      const admin = await client.query('SELECT luna.runtime_is_admin() AS is_admin');
      if (admin.rows[0]?.is_admin !== true) throw repositoryError('forbidden', '仅管理员可以删除用户 Skill', 403);
      const ownerRes = await client.query(
        'SELECT id, legacy_user_id FROM luna.runtime_accounts WHERE email = $1::text',
        [ownerEmail]
      );
      const ownerAccount = ownerRes.rows[0];
      if (!ownerAccount) return 0;
      const result = await client.query(
        'DELETE FROM luna.runtime_user_skills WHERE owner_user_id = $1::uuid AND id = $2::text RETURNING id',
        [ownerAccount.id, skillId]
      );
      if (!result.rows.length) return 0;
      if (input.audit) await appendAdminAuditInTx(client, input.audit);
      await notifyRuntimeChanged(client, 'user-skills', ownerAccount.legacy_user_id);
      return result.rows.length;
    });
  }

  async function runtimeAdminWriteOpenSkill(input) {
    const actorUserId = normalizeLegacyId(input.actorUserId, 'actorUserId');
    const skillId = String(input.skillId || '').trim();
    if (!skillId) throw repositoryError('invalid_param', '开放 Skill 缺少 id', 400);
    return withTransaction(actorUserId, async client => {
      const admin = await client.query('SELECT luna.runtime_is_admin() AS is_admin');
      if (admin.rows[0]?.is_admin !== true) throw repositoryError('forbidden', '仅管理员可以管理开放 Skill', 403);
      const currentRes = await client.query(
        'SELECT * FROM luna.runtime_open_skills WHERE id = $1::text FOR UPDATE',
        [skillId]
      );
      const currentRow = currentRes.rows[0];
      if (!currentRow) throw repositoryError('not_found', '开放 Skill 不存在', 404);
      if (input.expectedUpdatedAt !== undefined) {
        if (Number(currentRow.updated_at_value) !== Number(input.expectedUpdatedAt)) {
          throw repositoryError('revision_conflict', '开放 Skill 已变化，请重新加载', 409);
        }
      }
      const record = input.record || {};
      const currentStoredFiles = parseStoredSkillFiles(currentRow.files_json);
      const runtimeFiles = normalizeSkillRuntimeFiles(record.runtimeFiles !== undefined ? record.runtimeFiles : currentStoredFiles.runtimeFiles, record.files !== undefined ? record.files : currentStoredFiles.files, { strict: true });
      const files = skillFileNames(runtimeFiles, record.files !== undefined ? record.files : currentStoredFiles.files);
      const fileManifest = Array.isArray(record.fileManifest) ? record.fileManifest : (currentStoredFiles.fileManifest || []);
      const filesJson = serializeSkillFiles({ files, runtimeFiles, fileManifest });
      const name = String(record.name !== undefined ? record.name : currentRow.name).trim().slice(0, 120);
      if (!name) throw repositoryError('invalid_name', 'Skill 名称不能为空', 400);
      const description = String(record.description !== undefined ? record.description : currentRow.description).trim().slice(0, 500);
      const instruction = String(record.instruction !== undefined ? record.instruction : currentRow.instruction).replace(/\u0000/g, '').trim().slice(0, 1000000);
      if (!instruction) throw repositoryError('invalid_instruction', 'Skill 指令内容不能为空', 400);
      const status = String(record.status !== undefined ? record.status : currentRow.status);
      const downloads = Math.max(0, Number(record.downloads !== undefined ? record.downloads : currentRow.downloads) || 0);
      const now = Math.max(Date.now(), Number(currentRow.updated_at_value) + 1);
      const document = { id: skillId, name, description, instruction, files_json: filesJson, files, runtimeFiles, fileManifest, status, downloads };
      const result = await client.query(
        `UPDATE luna.runtime_open_skills
         SET name = $2::text, description = $3::text, instruction = $4::text,
             files_json = $5::text, status = $6::text, downloads = $7::bigint,
             updated_at_value = $8::bigint, document = $9::jsonb, updated_at = now()
         WHERE id = $1::text
         RETURNING *`,
        [skillId, name, description, instruction, filesJson, status, downloads, now, JSON.stringify(document)]
      );
      if (input.audit) await appendAdminAuditInTx(client, input.audit);
      await notifyRuntimeChanged(client, 'open-skills', skillId);
      return result.rows[0];
    });
  }

  async function runtimeAdminDeleteOpenSkill(input) {
    const actorUserId = normalizeLegacyId(input.actorUserId, 'actorUserId');
    const skillId = String(input.skillId || '').trim();
    if (!skillId) throw repositoryError('invalid_param', '开放 Skill 缺少 id', 400);
    return withTransaction(actorUserId, async client => {
      const admin = await client.query('SELECT luna.runtime_is_admin() AS is_admin');
      if (admin.rows[0]?.is_admin !== true) throw repositoryError('forbidden', '仅管理员可以删除开放 Skill', 403);
      const result = await client.query('DELETE FROM luna.runtime_open_skills WHERE id = $1::text RETURNING id', [skillId]);
      if (!result.rows.length) return 0;
      if (input.audit) await appendAdminAuditInTx(client, input.audit);
      await notifyRuntimeChanged(client, 'open-skills', skillId);
      return result.rows.length;
    });
  }

  async function runtimeAdminWriteDissection(input) {
    const actorUserId = normalizeLegacyId(input.actorUserId, 'actorUserId');
    const dissectionId = String(input.id || '').trim();
    if (!dissectionId) throw repositoryError('invalid_param', '拆书任务缺少 id', 400);
    return withTransaction(actorUserId, async client => {
      const admin = await client.query('SELECT luna.runtime_is_admin() AS is_admin');
      if (admin.rows[0]?.is_admin !== true) throw repositoryError('forbidden', '仅管理员可以管理拆书', 403);
      const currentRes = await client.query(
        'SELECT * FROM luna.runtime_dissections WHERE id = $1::text FOR UPDATE',
        [dissectionId]
      );
      const currentRow = currentRes.rows[0];
      if (!currentRow) throw repositoryError('not_found', '拆书任务不存在', 404);
      if (input.expectedRevision !== undefined && Number(input.expectedRevision) !== Number(currentRow.revision)) {
        throw repositoryError('revision_conflict', '拆书任务已变化，请重新加载', 409);
      }
      const now = Date.now();
      const hasActiveLease = Boolean(currentRow.worker_id && currentRow.worker_lease_until && new Date(currentRow.worker_lease_until).getTime() > now);
      let workerFence = Number(currentRow.worker_fence || 0);
      let workerId = currentRow.worker_id || '';
      let workerLeaseUntil = currentRow.worker_lease_until;
      if (hasActiveLease) {
        workerFence += 1;
        workerId = '';
        workerLeaseUntil = null;
      }
      const record = input.record || {};
      const title = String(record.title !== undefined ? record.title : currentRow.title).trim().slice(0, 200);
      const sourceType = String(record.sourceType !== undefined ? record.sourceType : currentRow.source_type).slice(0, 40);
      const sourceName = String(record.sourceName !== undefined ? record.sourceName : currentRow.source_name).slice(0, 200);
      const sourceText = String(record.sourceText !== undefined ? record.sourceText : currentRow.source_text).replace(/\u0000/g, '');
      const depth = String(record.depth !== undefined ? record.depth : currentRow.depth).slice(0, 40);
      const purpose = String(record.purpose !== undefined ? record.purpose : currentRow.purpose).slice(0, 80);
      const selectedModel = String(record.selectedModel !== undefined ? record.selectedModel : currentRow.selected_model).trim().slice(0, 160);
      const status = String(record.status !== undefined ? record.status : currentRow.status).slice(0, 40);
      const phase = String(record.phase !== undefined ? record.phase : currentRow.phase).slice(0, 40);
      const phaseIndex = Math.max(0, Math.floor(Number(record.phaseIndex !== undefined ? record.phaseIndex : currentRow.phase_index) || 0));
      const progress = Math.min(100, Math.max(0, Math.floor(Number(record.progress !== undefined ? record.progress : currentRow.progress) || 0)));
      const estimatedCredits = record.estimatedCredits === undefined ? currentRow.estimated_credits : (record.estimatedCredits === null ? null : Math.max(0, Number(record.estimatedCredits) || 0));
      let actualCredits;
      if (record.actualCredits === undefined) actualCredits = currentRow.actual_credits;
      else if (record.actualCredits === null) actualCredits = null;
      else actualCredits = Math.max(0, Number(record.actualCredits) || 0);
      const error = String(record.error !== undefined ? record.error : (currentRow.error || '')).slice(0, 5000);
      const cancelRequested = record.cancelRequested !== undefined ? Boolean(record.cancelRequested) : Boolean(currentRow.cancel_requested);
      const resultJson = record.result !== undefined ? JSON.stringify(record.result || {}) : currentRow.result_json;
      const metaJson = record.meta !== undefined ? JSON.stringify(record.meta || {}) : currentRow.meta_json;
      const result = await client.query(
        `UPDATE luna.runtime_dissections
         SET title = $2::text, source_type = $3::text, source_name = $4::text, source_text = $5::text,
             depth = $6::text, purpose = $7::text, selected_model = $8::text, status = $9::text,
             phase = $10::text, phase_index = $11::integer, progress = $12::integer,
             estimated_credits = $13::numeric, actual_credits = $14::numeric, result_json = $15::text,
             meta_json = $16::text, error = $17::text, cancel_requested = $18::boolean,
             worker_id = $19::text, worker_lease_until = $20::timestamptz, worker_fence = $21::bigint,
             updated_at_value = $22::bigint, revision = revision + 1, updated_at = now()
         WHERE id = $1::text
         RETURNING *`,
        [dissectionId, title, sourceType, sourceName, sourceText, depth, purpose, selectedModel, status,
          phase, phaseIndex, progress, estimatedCredits, actualCredits, resultJson, metaJson, error, cancelRequested,
          workerId, workerLeaseUntil, workerFence, now]
      );
      if (input.audit) await appendAdminAuditInTx(client, input.audit);
      await notifyRuntimeChanged(client, 'dissection', dissectionId);
      return result.rows[0];
    });
  }

  async function runtimeAdminDeleteDissection(input) {
    const actorUserId = normalizeLegacyId(input.actorUserId, 'actorUserId');
    const dissectionId = String(input.id || '').trim();
    if (!dissectionId) throw repositoryError('invalid_param', '拆书任务缺少 id', 400);
    return withTransaction(actorUserId, async client => {
      const admin = await client.query('SELECT luna.runtime_is_admin() AS is_admin');
      if (admin.rows[0]?.is_admin !== true) throw repositoryError('forbidden', '仅管理员可以删除拆书', 403);
      const currentRes = await client.query(
        'SELECT id, worker_fence FROM luna.runtime_dissections WHERE id = $1::text FOR UPDATE',
        [dissectionId]
      );
      if (!currentRes.rows.length) return 0;
      await client.query(
        `UPDATE luna.runtime_dissections
         SET worker_id = '', worker_lease_until = NULL, worker_fence = worker_fence + 1, cancel_requested = true
         WHERE id = $1::text`,
        [dissectionId]
      );
      await client.query('DELETE FROM luna.runtime_dissection_rows WHERE dissection_id = $1::text', [dissectionId]);
      const result = await client.query('DELETE FROM luna.runtime_dissections WHERE id = $1::text RETURNING id', [dissectionId]);
      if (!result.rows.length) return 0;
      if (input.audit) await appendAdminAuditInTx(client, input.audit);
      await notifyRuntimeChanged(client, 'dissection-delete', dissectionId);
      return result.rows.length;
    });
  }

  async function runtimeAdminWriteTokenUsage(input) {
    const actorUserId = normalizeLegacyId(input.actorUserId, 'actorUserId');
    const requestId = String(input.requestId || '').trim();
    if (!requestId) throw repositoryError('invalid_param', 'Token 记录缺少 requestId', 400);
    const patch = input.patch || {};
    return withTransaction(actorUserId, async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('token-usage:' || $1::text, 0))", [requestId]);
      const admin = await client.query('SELECT luna.runtime_is_admin() AS is_admin');
      if (admin.rows[0]?.is_admin !== true) throw repositoryError('forbidden', '仅管理员可以管理 Token 用量', 403);
      const usageRes = await client.query(
        `SELECT owner_actor_id, document FROM luna.runtime_dissection_rows
         WHERE source_table = 'token_usage' AND row_key = $1::text AND deleted_at IS NULL
         FOR UPDATE`,
        [requestId]
      );
      const usageRow = usageRes.rows[0];
      if (!usageRow) throw repositoryError('not_found', 'Token 记录不存在', 404);
      const current = parseJsonDocument(usageRow.document) || {};
      if (['reserved', 'dispatched'].includes(String(current.status))) {
        throw repositoryError('usage_in_progress', '正在执行的用量记录不能由管理员改写', 409);
      }
      const userEmail = String(current.user_email || '').trim().toLowerCase();
      if (!userEmail) throw repositoryError('invalid_record', 'Token 记录缺少所属账户', 400);
      const accountRes = await client.query(
        'SELECT id, legacy_user_id, email, role, credits, spent FROM luna.runtime_accounts WHERE email = $1::text FOR UPDATE',
        [userEmail]
      );
      const account = accountRes.rows[0];
      if (!account) throw repositoryError('account_not_found', '账户不存在', 404);
      const isUserAdmin = account.role === 'admin';

      const currentCost = current.credit_cost == null ? null : Number(current.credit_cost);
      let nextCost = currentCost;
      if (patch.creditCost !== undefined) {
        if (patch.creditCost === null) {
          if (currentCost !== null) {
            throw repositoryError('invalid_cost', '已结算费用的记录不能重置为未知费用', 400);
          }
          nextCost = null;
        } else {
          const parsed = Number(patch.creditCost);
          if (!Number.isFinite(parsed) || parsed < 0) {
            throw repositoryError('invalid_cost', '积分费用不合法', 400);
          }
          nextCost = Math.round(parsed * 100) / 100;
        }
      }

      if (currentCost === null && nextCost !== null) {
        const exactTokens = patch.totalTokens !== undefined ? patch.totalTokens : current.total_tokens;
        if (!hasValidExactTokenCount(exactTokens)) {
          throw repositoryError('usage_evidence_required', '未知费用结算必须提供准确用量', 400);
        }
        const reserved = Math.max(0, Number(current.reserved_cost) || 0);
        const delta = nextCost - reserved;
        if (!isUserAdmin) {
          const debit = await client.query(
            `UPDATE luna.runtime_accounts
             SET credits = credits - $1::numeric, spent = spent + $3::numeric, updated_at = now()
             WHERE id = $2::uuid AND role <> 'admin' AND credits >= GREATEST(0, $1::numeric)
             RETURNING credits`,
            [delta, account.id, nextCost]
          );
          if (!debit.rows.length) {
            throw repositoryError('insufficient_credits', '账户积分不足，无法增加该记录的扣费', 400);
          }
        }
      } else if (currentCost !== null && nextCost !== null) {
        const delta = Math.round((nextCost - currentCost) * 100) / 100;
        if (delta > 0 && !isUserAdmin) {
          const debit = await client.query(
            `UPDATE luna.runtime_accounts
             SET credits = credits - $1::numeric, spent = spent + $1::numeric, updated_at = now()
             WHERE id = $2::uuid AND role <> 'admin' AND credits >= $1::numeric
             RETURNING credits`,
            [delta, account.id]
          );
          if (!debit.rows.length) {
            throw repositoryError('insufficient_credits', '账户积分不足，无法增加该记录的扣费', 400);
          }
        } else if (delta < 0 && !isUserAdmin) {
          await client.query(
            `UPDATE luna.runtime_accounts
             SET credits = credits + $1::numeric, spent = GREATEST(0, spent - $1::numeric), updated_at = now()
             WHERE id = $2::uuid AND role <> 'admin'`,
            [-delta, account.id]
          );
        }
      }

      const tokenSnakeMap = {
        promptTokens: 'prompt_tokens',
        completionTokens: 'completion_tokens',
        reasoningTokens: 'reasoning_tokens',
        totalTokens: 'total_tokens',
        cachedTokens: 'cached_tokens',
        cacheWriteTokens: 'cache_write_tokens'
      };
      const numberOrNull = key => {
        const snake = tokenSnakeMap[key];
        const val = patch[key] !== undefined ? patch[key] : patch[snake];
        if (val === null) return null;
        if (val === undefined) return current[snake];
        const n = Number(val);
        return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
      };

      const updatedDoc = {
        ...current,
        model_id: String(patch.modelId !== undefined ? patch.modelId : (patch.model_id !== undefined ? patch.model_id : current.model_id || '')).slice(0, 160),
        provider_model: String(patch.providerModel !== undefined ? patch.providerModel : (patch.provider_model !== undefined ? patch.provider_model : current.provider_model || '')).slice(0, 200),
        prompt_tokens: numberOrNull('promptTokens'),
        completion_tokens: numberOrNull('completionTokens'),
        reasoning_tokens: numberOrNull('reasoningTokens'),
        total_tokens: numberOrNull('totalTokens'),
        cached_tokens: numberOrNull('cachedTokens'),
        cache_write_tokens: numberOrNull('cacheWriteTokens'),
        usage_source: String(patch.usageSource !== undefined ? patch.usageSource : (patch.usage_source !== undefined ? patch.usage_source : current.usage_source || '')).slice(0, 40),
        status: currentCost === null && nextCost !== null ? 'settled' : String(patch.status !== undefined ? patch.status : current.status || '').slice(0, 40),
        duration_ms: Math.max(0, Math.floor(Number(patch.durationMs !== undefined ? patch.durationMs : (patch.duration_ms !== undefined ? patch.duration_ms : current.duration_ms)) || 0)),
        credit_cost: nextCost,
        updated_at: Date.now()
      };
      const hash = jsonHash(updatedDoc);
      await client.query(
        `UPDATE luna.runtime_dissection_rows
         SET document = $2::jsonb, cells = '[]'::jsonb, row_sha256 = $3::text, value_sha256 = $3::text, updated_at = now()
         WHERE owner_actor_id = $1::uuid AND source_table = 'token_usage' AND row_key = $4::text`,
        [usageRow.owner_actor_id, JSON.stringify(updatedDoc), hash, requestId]
      );
      if (input.audit) await appendAdminAuditInTx(client, input.audit);
      await notifyRuntimeChanged(client, 'token-usage', requestId);
      return updatedDoc;
    });
  }

  async function runtimeAdminUpdateAccount(input) {
    const actorUserId = normalizeLegacyId(input.actorUserId || input.userId, 'actorUserId');
    return withTransaction(actorUserId, async client => {
      const admin = await client.query('SELECT luna.runtime_is_admin() AS is_admin');
      if (admin.rows[0]?.is_admin !== true) throw repositoryError('forbidden', '仅管理员可以修改账户资料', 403);
      const row = await runtimeUpdateAccount(input);
      if (input.audit) await appendAdminAuditInTx(client, input.audit);
      return row;
    });
  }

  async function runtimeListAllTokenUsage(actorUserId) {
    return withTransaction(actorUserId, async client => {
      const admin = await client.query('SELECT luna.runtime_is_admin() AS is_admin');
      if (admin.rows[0]?.is_admin !== true) throw repositoryError('forbidden', '仅管理员可以查看全部用量', 403);
      const result = await client.query(
        `SELECT document FROM luna.runtime_dissection_rows
         WHERE source_table = 'token_usage' AND deleted_at IS NULL
         ORDER BY updated_at DESC, row_key ASC`
      );
      return result.rows.map(row => {
        const document = typeof row.document === 'string' ? JSON.parse(row.document) : row.document;
        if (!document || typeof document !== 'object' || Array.isArray(document)) {
          throw repositoryError('corrupt_usage', '模型用量文档损坏', 500);
        }
        return document;
      });
    });
  }

  async function runtimeListTokenUsage(actorUserId) {
    return withTransaction(actorUserId, async client => {
      const result = await client.query(
        `SELECT document FROM luna.runtime_dissection_rows
         WHERE owner_actor_id = luna.actor_id() AND source_table = 'token_usage'
           AND deleted_at IS NULL ORDER BY updated_at DESC, row_key ASC`
      );
      return result.rows.map(row => {
        const document = typeof row.document === 'string' ? JSON.parse(row.document) : row.document;
        if (!document || typeof document !== 'object' || Array.isArray(document)) {
          throw repositoryError('corrupt_usage', '模型用量文档损坏', 500);
        }
        return document;
      });
    });
  }

  async function insertRuntimeDissectionRows(client, actor, inputRows) {
      for (let start = 0; start < inputRows.length; start += 100) {
        const batch = inputRows.slice(start, start + 100);
        const values = [];
        const groups = batch.map((row, index) => {
          const value = row && typeof row === 'object' ? row : {};
          const document = value.document && typeof value.document === 'object' ? value.document : {};
          const cells = Array.isArray(value.cells) ? value.cells : [];
          const params = [
            internalUuid(actor), actor, String(value.sourceTable || '').slice(0, 120), String(value.rowKey || '').slice(0, 512),
            String(value.dissectionId || document.dissection_id || ''), JSON.stringify(document), JSON.stringify(cells),
            String(value.rowSha256 || ''), String(value.valueSha256 || ''), value.sourceRunId ? internalUuid(value.sourceRunId) : null,
            value.sourceRowNo == null ? null : Number(value.sourceRowNo)
          ];
          const placeholders = params.map((param, paramIndex) => {
            values.push(param);
            return '$' + (index * params.length + paramIndex + 1);
          });
          return `(${placeholders[0]}::uuid, ${placeholders[1]}::text, ${placeholders[2]}::text, ${placeholders[3]}::text,
            ${placeholders[4]}::text, ${placeholders[5]}::jsonb, ${placeholders[6]}::jsonb, ${placeholders[7]}::text,
            ${placeholders[8]}::text, ${placeholders[9]}::uuid, ${placeholders[10]}::bigint, NULL, now())`;
        });
        if (!groups.length) continue;
        await client.query(
          `INSERT INTO luna.runtime_dissection_rows
            (owner_actor_id, owner_user_id, source_table, row_key, dissection_id, document, cells,
             row_sha256, value_sha256, source_run_id, source_row_no, deleted_at, updated_at)
           VALUES ${groups.join(', ')}
           ON CONFLICT (owner_actor_id, source_table, row_key) DO UPDATE SET
             owner_user_id = EXCLUDED.owner_user_id, dissection_id = EXCLUDED.dissection_id,
             document = EXCLUDED.document, cells = EXCLUDED.cells, row_sha256 = EXCLUDED.row_sha256,
             value_sha256 = EXCLUDED.value_sha256, source_run_id = EXCLUDED.source_run_id,
             source_row_no = EXCLUDED.source_row_no, deleted_at = NULL, updated_at = now()`, values
        );
      }
  }

  async function runtimeUpsertDissectionRows(actorUserId, rows) {
    const actor = normalizeLegacyId(actorUserId, 'actorUserId');
    const inputRows = Array.isArray(rows) ? rows : [];
    if (!inputRows.length) return 0;
    return withTransaction(actor, async client => {
      if (inputRows.some(row => row.sourceTable === 'character_library')) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', ['character-library:' + actor]);
      }
      const dissectionIds = new Set();
      for (const row of inputRows) {
        const dId = String(row && (row.dissectionId || (row.document && row.document.dissection_id)) || '').trim();
        const sourceTable = String(row && row.sourceTable || '').trim();
        if (dId) {
          dissectionIds.add(dId);
        } else if (sourceTable !== 'character_library') {
          throw repositoryError('invalid_dissection_id', '子行必须关联有效拆书任务', 422);
        }
      }
      for (const dId of dissectionIds) {
        const parentResult = await client.query(
          `SELECT id, owner_actor_id, cancel_requested, status
           FROM luna.runtime_dissections
           WHERE id = $1::text AND owner_actor_id = luna.actor_id()
           FOR UPDATE`,
          [dId]
        );
        if (!parentResult.rows.length) {
          throw repositoryError('not_found', '拆书任务不存在或无权写入', 404);
        }
        const parent = parentResult.rows[0];
        if (parent.cancel_requested === true || parent.status === 'cancelled') {
          throw repositoryError('cancelled', '拆书任务已取消，拒绝写入子表', 409);
        }
      }
      await insertRuntimeDissectionRows(client, actor, inputRows);
      if (inputRows.length) await notifyRuntimeChanged(client, 'dissection-rows', [...dissectionIds][0] || '');
      return inputRows.length;
    });
  }

  /** 在同一事务内替换一个任务的一张运行时表，校验父任务行锁与 cancel fence。 */
  async function runtimeReplaceDissectionRows(input) {
    const actor = normalizeLegacyId(input && (input.actorUserId || input.ownerUserId), 'actorUserId');
    const dissectionId = String(input && input.dissectionId || '');
    const sourceTable = String(input && input.sourceTable || '').trim();
    if (!sourceTable) throw repositoryError('invalid_runtime_rows', '运行时拆书表标识不能为空', 422);
    const inputRows = (Array.isArray(input.rows) ? input.rows : []).map(row => ({
      ...(row && typeof row === 'object' ? row : {}), dissectionId, sourceTable
    }));
    return withTransaction(actor, async client => {
      if (dissectionId) {
        const parentResult = await client.query(
          `SELECT id, owner_actor_id, cancel_requested, status
           FROM luna.runtime_dissections
           WHERE id = $1::text AND owner_actor_id = luna.actor_id()
           FOR UPDATE`,
          [dissectionId]
        );
        if (!parentResult.rows.length) {
          throw repositoryError('not_found', '拆书任务不存在或无权写入', 404);
        }
        const parent = parentResult.rows[0];
        if (parent.cancel_requested === true || parent.status === 'cancelled') {
          throw repositoryError('cancelled', '拆书任务已取消，拒绝写入子表', 409);
        }
      } else if (sourceTable !== 'character_library') {
        throw repositoryError('invalid_dissection_id', '子行必须关联有效拆书任务', 422);
      }
      await client.query(
        `DELETE FROM luna.runtime_dissection_rows
         WHERE owner_actor_id = luna.actor_id() AND dissection_id = $1::text AND source_table = $2::text`,
        [dissectionId, sourceTable]
      );
      await insertRuntimeDissectionRows(client, actor, inputRows);
      await notifyRuntimeChanged(client, 'dissection-rows-replace', dissectionId);
      return inputRows.length;
    });
  }

  /**
   * 在同一事务内加锁父拆书记录（FOR UPDATE）并原子替换多个子表分组。
   * 校验任务存在且未取消（cancel fence），防止半套数据暴露或向已取消任务写入子行。
   */
  async function runtimeReplaceDissectionTables(actorUserId, dissectionId, tableGroups) {
    let actor, dId, groups;
    if (actorUserId && typeof actorUserId === 'object' && !dissectionId) {
      actor = normalizeLegacyId(actorUserId.actorUserId || actorUserId.ownerUserId, 'actorUserId');
      dId = String(actorUserId.dissectionId || '');
      groups = actorUserId.tableGroups;
    } else {
      actor = normalizeLegacyId(actorUserId, 'actorUserId');
      dId = String(dissectionId || '');
      groups = tableGroups;
    }
    if (!dId) throw repositoryError('invalid_dissection_id', 'dissectionId 不能为空', 422);

    let normalizedGroups = [];
    if (Array.isArray(groups)) {
      normalizedGroups = groups;
    } else if (groups && typeof groups === 'object') {
      normalizedGroups = Object.entries(groups).map(([sourceTable, rows]) => ({ sourceTable, rows }));
    }

    return withTransaction(actor, async client => {
      const parentResult = await client.query(
        `SELECT id, owner_actor_id, cancel_requested, status
         FROM luna.runtime_dissections
         WHERE id = $1::text AND owner_actor_id = luna.actor_id()
         FOR UPDATE`,
        [dId]
      );
      if (!parentResult.rows.length) {
        throw repositoryError('not_found', '拆书任务不存在或无权写入', 404);
      }
      const parent = parentResult.rows[0];
      if (parent.cancel_requested === true || parent.status === 'cancelled') {
        throw repositoryError('cancelled', '拆书任务已取消，拒绝写入子表', 409);
      }

      let totalInserted = 0;
      for (const group of normalizedGroups) {
        const sourceTable = String(group && group.sourceTable || '').trim();
        if (!sourceTable) continue;
        await client.query(
          `DELETE FROM luna.runtime_dissection_rows
           WHERE owner_actor_id = luna.actor_id() AND dissection_id = $1::text AND source_table = $2::text`,
          [dId, sourceTable]
        );
        const groupRows = (Array.isArray(group.rows) ? group.rows : []).map(row => ({
          ...(row && typeof row === 'object' ? row : {}),
          dissectionId: dId,
          sourceTable
        }));
        if (groupRows.length) {
          await insertRuntimeDissectionRows(client, actor, groupRows);
          totalInserted += groupRows.length;
        }
      }

      await notifyRuntimeChanged(client, 'dissection-tables-replace', dId);
      return totalInserted;
    });
  }

  async function runtimeDeleteDissectionRows(actorUserId, dissectionId, sourceTable = '') {
    return withTransaction(actorUserId, async client => {
      const parent = await client.query(
        `SELECT id, cancel_requested, status FROM luna.runtime_dissections
         WHERE id = $1::text AND owner_actor_id = luna.actor_id() FOR UPDATE`,
        [String(dissectionId || '')]
      );
      if (!parent.rows.length) throw repositoryError('not_found', '拆书任务不存在或无权访问', 404);
      if (parent.rows[0].cancel_requested || parent.rows[0].status === 'cancelled') {
        throw repositoryError('cancelled', '拆书任务已取消', 409);
      }
      const values = [String(dissectionId || '')];
      const condition = sourceTable ? ' AND source_table = $2::text' : '';
      if (sourceTable) values.push(String(sourceTable));
      const result = await client.query(
        `DELETE FROM luna.runtime_dissection_rows
         WHERE owner_actor_id = luna.actor_id() AND dissection_id = $1::text${condition}`,
        values
      );
      if (Number(result.rowCount || 0)) await notifyRuntimeChanged(client, 'dissection-rows-delete', dissectionId);
      return Number(result.rowCount || 0);
    });
  }

  async function runtimeRecordModelUsage(input) {
    const actor = normalizeLegacyId(input.userId, 'userId');
    const requestId = String(input.requestId || '').trim();
    if (!requestId) throw repositoryError('invalid_request_id', '模型用量缺少请求标识', 422);
    const usage = input.usage || {};
    const knownCost = usage.creditCost !== null && usage.creditCost !== undefined &&
      Number.isFinite(Number(usage.creditCost)) && Number(usage.creditCost) >= 0;
    const document = {
      request_id: requestId, user_id: actor, workspace_id: input.workspaceId || '',
      project_id: input.projectId || '', record_id: input.recordId || '',
      workflow_id: input.workflowId || '', stage: input.stage || '',
      unit_id: input.unitId || '', model: input.model || '',
      prompt_version: input.promptVersion || '',
      input_tokens: usage.promptTokens ?? usage.inputTokens ?? null,
      output_tokens: usage.completionTokens ?? usage.outputTokens ?? null,
      total_tokens: usage.totalTokens ?? null,
      cached_input_tokens: usage.cachedInputTokens ?? null,
      credit_cost: knownCost ? Number(usage.creditCost) : null,
      credit_known: knownCost ? 1 : 0,
      cost_source: knownCost ? usage.costSource || usage.creditCostSource || 'upstream_usage' : 'unknown',
      retry_count: input.retryCount || 0, latency_ms: input.latencyMs || 0,
      status: input.status || usage.status || 'usage_unavailable', created_at: Date.now()
    };
    return withTransaction(actor, async client => {
      const result = await client.query(
        `INSERT INTO luna.runtime_dissection_rows
         (owner_actor_id, owner_user_id, source_table, row_key, dissection_id, document)
         VALUES (luna.actor_id(), $1::text, 'model_usage', $2::text, '', $3::jsonb)
         ON CONFLICT (owner_actor_id, source_table, row_key) DO NOTHING`,
        [actor, requestId, JSON.stringify(document)]
      );
      if (result.rowCount) await notifyRuntimeChanged(client, 'model-usage', requestId);
      return Number(result.rowCount || 0);
    });
  }

  async function runtimeDeleteDissectionRow(actorUserId, dissectionId, sourceTable, rowKey) {
    const actor = normalizeLegacyId(actorUserId, 'actorUserId');
    return withTransaction(actor, async client => {
      const parent = await client.query(
        `SELECT id FROM luna.runtime_dissections
         WHERE id = $1::text AND owner_actor_id = luna.actor_id() FOR UPDATE`,
        [String(dissectionId || '')]
      );
      if (!parent.rows.length) throw repositoryError('not_found', '拆书任务不存在或无权访问', 404);
      const result = await client.query(
        `DELETE FROM luna.runtime_dissection_rows
         WHERE owner_actor_id = luna.actor_id() AND dissection_id = $1::text
           AND source_table = $2::text AND row_key = $3::text`,
        [String(dissectionId || ''), String(sourceTable || ''), String(rowKey || '')]
      );
      if (result.rowCount) await notifyRuntimeChanged(client, 'dissection-row-delete', dissectionId);
      return Number(result.rowCount || 0);
    });
  }

  async function runtimeReplaceDissectionSummaries(input) {
    const actor = normalizeLegacyId(input.actorUserId, 'actorUserId');
    const dissectionId = String(input.dissectionId || '');
    const summaryType = String(input.summaryType || '');
    if (!['chapter', 'arc', 'volume', 'book'].includes(summaryType)) {
      throw repositoryError('invalid_summary_type', '摘要类型无效', 422);
    }
    const rows = (Array.isArray(input.rows) ? input.rows : []).map(row => ({
      ...row, dissectionId, sourceTable: 'dissection_summaries',
      document: { ...row.document, summary_type: summaryType, summaryType }
    }));
    return withTransaction(actor, async client => {
      const parent = await client.query(
        `SELECT id, cancel_requested, status FROM luna.runtime_dissections
         WHERE id = $1::text AND owner_actor_id = luna.actor_id() FOR UPDATE`,
        [dissectionId]
      );
      if (!parent.rows.length) throw repositoryError('not_found', '拆书任务不存在或无权访问', 404);
      if (parent.rows[0].cancel_requested || parent.rows[0].status === 'cancelled') {
        throw repositoryError('cancelled', '拆书任务已取消', 409);
      }
      await client.query(
        `DELETE FROM luna.runtime_dissection_rows
         WHERE owner_actor_id = luna.actor_id() AND dissection_id = $1::text
           AND source_table = 'dissection_summaries'
           AND COALESCE(document->>'summary_type', document->>'summaryType') = $2::text`,
        [dissectionId, summaryType]
      );
      await insertRuntimeDissectionRows(client, actor, rows);
      await notifyRuntimeChanged(client, 'dissection-summaries-replace', dissectionId);
      return rows.length;
    });
  }

  return {
    runtimeListDissections,
    runtimeClaimDissectionWorker,
    runtimeRenewDissectionWorker,
    withDissectionWorkerLease,
    runtimeReleaseDissectionWorker,
    runtimeRecoverExpiredDissectionWorkers,
    runtimeReadDissectionShare,
    runtimeListMemberDissectionShares,
    runtimeGetDissection,
    runtimeInsertDissection,
    runtimeUpdateDissection,
    runtimePatchDissectionMetadata,
    runtimeRequestDissectionCancel,
    runtimeRequeueDissection,
    runtimeDeleteDissection,
    runtimeListDissectionRows,
    runtimeCountDissectionRows,
    runtimeListCharacterLibrary,
    runtimeSyncCharactersToLibrary,
    runtimePatchCharacter,
    runtimeMergeCharacters,
    runtimeListTokenUsage,
    runtimeListAllTokenUsage,
    runtimeAdminDataRows,
    runtimeMaintenanceActor,
    runtimeAdminGetNovel,
    runtimeAdminWriteNovel,
    runtimeAdminWriteUserSkill,
    runtimeAdminDeleteUserSkill,
    runtimeAdminWriteOpenSkill,
    runtimeAdminDeleteOpenSkill,
    runtimeAdminWriteDissection,
    runtimeAdminDeleteDissection,
    runtimeAdminWriteTokenUsage,
    runtimeAdminUpdateAccount,
    runtimeUpsertDissectionRows,
    runtimeReplaceDissectionRows,
    runtimeReplaceDissectionTables,
    runtimeDeleteDissectionRow,
    runtimeRecordModelUsage,
    runtimeReplaceDissectionSummaries,
    runtimeDeleteDissectionRows
  };
}

module.exports = {
  createPostgresRuntimeDissectionMethods
};
