'use strict';

function createCreationCoreJobRuntime({ CREATION_CORE_JOB_MAX_MS, CREATION_CORE_JOB_TTL_MS, POSTGRES_MODE, callMolanChat, creationBibleSeedValidation, creationForbiddenTerms, dbReady, deleteCreationBookPlaceholder, fs, getUserByEmail, normalizeBiblePayload, postgresRepository, projectScope, saveCreationBookFirstBible, sha256Text, getDatabase }) {
  const creationCoreJobs = new Map();
  const postgresJobSyncQueues = new Map();
  function creationCoreJobPublic(job) {
    return {
      id: job.id, status: job.status, bookId: job.bookId || '', modelId: job.modelId,
      title: job.title, genre: job.genre, receivedChars: job.receivedChars || 0,
      startedAt: job.startedAt, updatedAt: job.updatedAt,
      error: job.error || '', code: job.code || '',
      hits: Array.isArray(job.hits) ? job.hits : [],
      missing: Array.isArray(job.missing) ? job.missing : [],
      bibleVersion: job.bibleVersion || 0,
      creditCost: Number.isFinite(job.creditCost) ? job.creditCost : null
    };
  }
  function creationCoreJobFromDbRow(row) {
    if (!row) return null;
    return creationCoreJobPublic({
      id: row.id, status: row.status, bookId: row.book_id, modelId: row.model_id,
      title: row.title, genre: row.genre, receivedChars: row.received_chars,
      startedAt: row.started_at, updatedAt: row.updated_at, error: row.error, code: row.code,
      bibleVersion: row.bible_version, creditCost: row.credit_cost
    });
  }
  function postgresJobStateForCreation(job) {
    const status = String(job && job.status || '').toLowerCase();
    if (status === 'done' || status === 'succeeded') return 'succeeded';
    if (status === 'cancelling' || status === 'cancel_requested') return 'cancel_requested';
    if (status === 'cancelled') return 'cancelled';
    if (status === 'failed' || status === 'provider_unknown') return status === 'provider_unknown' ? 'provider_unknown' : 'failed';
    return 'running';
  }
  function persistPostgresCreationJob(job) {
    if (!POSTGRES_MODE || !postgresRepository.enabled || !job || !job.userId || !job.id) return;
    const projectId = String(job.projectId || `n_job_${String(job.bookId || job.id).replace(/[^A-Za-z0-9]/g, '').slice(0, 28)}`);
    const workspaceId = String(job.workspaceId || projectScope.personalWorkspaceId(job.userId));
    const state = postgresJobStateForCreation(job);
    const syncInput = {
      userId: job.userId,
      workspaceId,
      projectId,
      jobId: job.id,
      kind: 'creation-core',
      state,
      workerId: `server-${process.pid}`,
      attemptNo: 1,
      fencingToken: 1,
      inputHash: sha256Text(String(job.system || '') + '\u0000' + String(job.userPrompt || '')),
      result: {
        bookId: String(job.bookId || ''),
        bibleVersion: Number(job.bibleVersion) || 0,
        receivedChars: Number(job.receivedChars) || 0,
        creditCost: Number.isFinite(Number(job.creditCost)) ? Number(job.creditCost) : null
      },
      errorCode: String(job.code || '').slice(0, 120)
    };
    const previous = postgresJobSyncQueues.get(job.id) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() => postgresRepository.upsertJob(syncInput))
      .catch(error => {
        console.error('[creation-pg] 任务状态同步失败 job=' + job.id + ': ' + String(error && error.message || '数据库不可用'));
      });
    postgresJobSyncQueues.set(job.id, next);
    void next;
  }
  function persistCreationCoreJob(job) {
    if (!dbReady() || !job) return;
    getDatabase().prepare(`INSERT INTO creation_core_jobs
      (id,book_id,user_email,model_id,title,genre,status,received_chars,started_at,updated_at,error,code,bible_version,credit_cost,user_id,workspace_id,project_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status, received_chars = excluded.received_chars,
        updated_at = excluded.updated_at, error = excluded.error, code = excluded.code,
        bible_version = excluded.bible_version, credit_cost = excluded.credit_cost,
        user_id = excluded.user_id, workspace_id = excluded.workspace_id, project_id = excluded.project_id`)
      .run(job.id, job.bookId || '', job.userEmail || '', job.modelId || '', job.title || '', job.genre || '',
        job.status || 'running', Number(job.receivedChars) || 0, Number(job.startedAt) || Date.now(),
        Number(job.updatedAt) || Date.now(), job.error || '', job.code || '', Number(job.bibleVersion) || 0,
        Number.isFinite(Number(job.creditCost)) ? Number(job.creditCost) : null,
        job.userId || projectScope.stableUserId(job.userEmail), job.workspaceId || projectScope.personalWorkspaceId(job.userId || projectScope.stableUserId(job.userEmail)), job.projectId || '');
    persistPostgresCreationJob(job);
  }
  function postgresCreationCoreJobView(job) {
    const result = job && job.result && typeof job.result === 'object' ? job.result : {};
    const status = job.state === 'succeeded' ? 'done'
      : job.state === 'cancel_requested' ? 'cancelling'
        : job.state;
    return {
      id: job.id,
      status,
      bookId: String(result.bookId || ''),
      modelId: '',
      title: '',
      genre: '',
      receivedChars: Number(result.receivedChars) || 0,
      startedAt: job.createdAt,
      updatedAt: job.updatedAt,
      error: job.errorCode || '',
      code: job.errorCode || '',
      bibleVersion: Number(result.bibleVersion) || 0,
      creditCost: Number.isFinite(Number(result.creditCost)) ? Number(result.creditCost) : null
    };
  }
  function recoverPostgresCreationJobs() {
    if (!POSTGRES_MODE || !postgresRepository.enabled || !dbReady()) return;
    try {
      const rows = getDatabase().prepare(`SELECT id, book_id, user_id, workspace_id, project_id, status, error, code,
        received_chars, started_at, updated_at, bible_version, credit_cost
        FROM creation_core_jobs WHERE status = 'provider_unknown'`).all();
      rows.forEach(row => persistPostgresCreationJob({
        id: row.id,
        bookId: row.book_id,
        userId: row.user_id,
        workspaceId: row.workspace_id,
        projectId: row.project_id,
        status: row.status,
        error: row.error,
        code: row.code,
        receivedChars: row.received_chars,
        startedAt: row.started_at,
        updatedAt: row.updated_at,
        bibleVersion: row.bible_version,
        creditCost: row.credit_cost
      }));
    } catch (error) {
      console.error('[creation-pg] 遗留任务恢复同步失败：' + String(error && error.message || '数据库不可用'));
    }
  }
  function creationCoreRunningJobForBook(bookId, email, userId = '') {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const actorUserId = String(userId || projectScope.stableUserId(normalizedEmail)).trim();
    for (const job of creationCoreJobs.values()) {
      if (job.bookId === bookId && (job.userId === actorUserId || (!job.userId && job.userEmail === normalizedEmail)) && job.status === 'running') return job;
    }
    if (dbReady()) {
      const row = getDatabase().prepare(`SELECT * FROM creation_core_jobs
        WHERE book_id = ? AND (user_id = ? OR (user_id = '' AND user_email = ?)) AND status = 'running'
        ORDER BY updated_at DESC LIMIT 1`).get(bookId, actorUserId, normalizedEmail);
      if (row) return creationCoreJobFromDbRow(row);
    }
    return null;
  }
  function sweepCreationCoreJobs() {
    const now = Date.now();
    for (const [id, job] of creationCoreJobs) {
      if (job.status === 'running') {
        if (now - job.startedAt > CREATION_CORE_JOB_MAX_MS) {
          if (job.controller) { try { job.controller.abort(); } catch (_) {} }
          job.status = 'failed';
          job.error = '服务端生成超时，请用「重试」续跑';
          job.code = 'core_job_timeout';
          job.updatedAt = now;
          persistCreationCoreJob(job);
          deleteCreationBookPlaceholder(job.bookId, job.userEmail);
        }
        continue;
      }
      if (now - job.updatedAt > CREATION_CORE_JOB_TTL_MS) creationCoreJobs.delete(id);
    }
  }
  function finalizeCreationCoreJob(job, patch) {
    Object.assign(job, patch, { updatedAt: Date.now() });
    persistCreationCoreJob(job);
  }
  async function runCreationCoreJob(job) {
    try {
      const user = getUserByEmail(job.userEmail) || { email: job.userEmail };
      const result = await callMolanChat(job.authToken, user, {
        system: job.system,
        userPrompt: job.userPrompt,
        modelId: job.modelId,
        internalModel: true,
        stage: 'writing',
        jsonMode: true,
        maxTokens: 9000,
        controller: job.controller
      });
      if (job.cancelRequested) { finalizeCreationCoreJob(job, { status: 'cancelled', error: '用户取消了本次生成' }); deleteCreationBookPlaceholder(job.bookId, job.userEmail); return; }
      // ★ callMolanChat 返回 { text, json, usage }：jsonMode 下 json 已解析，直接使用
      let text = String(result && result.text || '').trim();
      let generated = (result && result.json && typeof result.json === 'object' && !Array.isArray(result.json)) ? result.json : null;
      if (!text && !generated) {
        // 空输出重试一次：个别上游偶发空响应
        const retry = await callMolanChat(job.authToken, user, {
          system: job.system,
          userPrompt: job.userPrompt,
          modelId: job.modelId,
          stage: 'writing',
          jsonMode: true,
          maxTokens: 9000,
          controller: job.controller
        }).catch(() => null);
        if (retry) {
          text = String(retry.text || '').trim();
          generated = (retry.json && typeof retry.json === 'object' && !Array.isArray(retry.json)) ? retry.json : null;
        }
      }
      job.receivedChars = text.length;
      job.updatedAt = Date.now();
      persistCreationCoreJob(job);
      if (!generated) {
        try { generated = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()); } catch (_) {}
        if (!generated || typeof generated !== 'object' || Array.isArray(generated)) {
          const start = text.indexOf('{'); const end = text.lastIndexOf('}');
          if (start >= 0 && end > start) { try { generated = JSON.parse(text.slice(start, end + 1)); } catch (_) {} }
        }
      }
      if (!generated || typeof generated !== 'object' || Array.isArray(generated)) {
        deleteCreationBookPlaceholder(job.bookId, job.userEmail);
        const rawSnippet = (text.slice(0, 220) + '……' + text.slice(-220)).replace(/s+/g, ' ');
        console.error('[creation] 核心包非 JSON 输出 job=' + job.id + ' len=' + text.length + ' head=' + text.slice(0, 120));
        try { fs.writeFileSync('/tmp/corejob-debug-' + job.id + '.json', JSON.stringify({ system: job.system, userPrompt: job.userPrompt, modelId: job.modelId, outputLen: text.length })); } catch (_) {}
        finalizeCreationCoreJob(job, { status: 'failed', code: 'invalid_json', error: '创书模型返回的内容不是有效 JSON（输出 ' + text.length + ' 字符，开头：' + rawSnippet.slice(0, 200) + '）' });
        return;
      }
      const payload = normalizeBiblePayload({ title: job.title, genre: job.genre, plan: job.plan, sourceDissectionId: job.sourceDissectionId, sourceProfile: job.sourceProfile, generated });
      const seedGate = creationBibleSeedValidation(payload, creationForbiddenTerms(payload));
      if (!seedGate.ok) {
        deleteCreationBookPlaceholder(job.bookId, job.userEmail);
        finalizeCreationCoreJob(job, {
          status: 'failed',
          code: seedGate.hits.length ? 'forbidden_entity_hit' : seedGate.nameOverlaps && seedGate.nameOverlaps.length ? 'character_name_overlap' : 'incomplete_generation',
          error: seedGate.hits.length ? '生成内容命中了原书禁止复制项，请重新生成或修改后重试' : seedGate.nameOverlaps && seedGate.nameOverlaps.length ? '人物姓名共享汉字，请重命名其中之一后重试' : '生成内容结构不完整，请重新生成后重试',
          hits: seedGate.hits, missing: seedGate.missing
        });
        return;
      }
      const cost = Math.max(0, Number(result && result.usage && result.usage.creditCost) || 0);
      const budgetLimit = Number(job.plan && job.plan.budgetLimit) || 0;
      if (budgetLimit > 0 && cost > budgetLimit + 1e-9) {
        deleteCreationBookPlaceholder(job.bookId, job.userEmail);
        finalizeCreationCoreJob(job, { status: 'failed', code: 'budget_exceeded', error: `生成消耗 ${cost.toFixed(2)} 积分已超过预算上限 ${budgetLimit}，请调整预算或模型`, creditCost: cost });
        return;
      }
      const saved = saveCreationBookFirstBible(job.userEmail, {
        bookId: job.bookId, title: job.title, plan: job.plan, sourceDissectionId: job.sourceDissectionId,
        payload, initialCost: cost, ownerUserId: job.userId, workspaceId: job.workspaceId, projectId: job.projectId
      });
      if (!saved.ok) {
        deleteCreationBookPlaceholder(job.bookId, job.userEmail);
        finalizeCreationCoreJob(job, { status: 'failed', code: saved.code || 'save_failed', error: saved.error || '创作圣经保存失败' });
        return;
      }
      finalizeCreationCoreJob(job, { status: 'done', bookId: saved.bookId, bibleVersion: saved.version, creditCost: cost, error: '', code: '' });
    } catch (error) {
      if (job.cancelRequested) { finalizeCreationCoreJob(job, { status: 'cancelled', error: '用户取消了本次生成' }); deleteCreationBookPlaceholder(job.bookId, job.userEmail); return; }
      deleteCreationBookPlaceholder(job.bookId, job.userEmail);
      finalizeCreationCoreJob(job, { status: 'failed', code: (error && error.code) || 'core_job_failed', error: (error && error.message) || '服务端创书任务失败' });
    }
  }
  const timer = setInterval(sweepCreationCoreJobs, 5 * 60 * 1000); timer.unref();
  return { creationCoreJobs, creationCoreJobPublic, creationCoreJobFromDbRow, postgresJobStateForCreation, persistPostgresCreationJob, persistCreationCoreJob, postgresCreationCoreJobView, recoverPostgresCreationJobs, creationCoreRunningJobForBook, sweepCreationCoreJobs, finalizeCreationCoreJob, runCreationCoreJob, close: () => clearInterval(timer) };
}
module.exports = { createCreationCoreJobRuntime };

