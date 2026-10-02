'use strict';

function createCreationCoreJobHttpService({ creationCoreJobFromDbRow, creationCoreJobPublic, creationCoreJobs, dbReady, getAuthUser, json, persistCreationCoreJob, postgresActor, postgresCreationCoreJobView, postgresRepository, projectScope, getDatabase, POSTGRES_MODE }) {
  async function handlePostgresCreationCoreJobGet(req, res, jobId) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const job = await postgresRepository.getJob(postgresActor(auth), jobId);
    if (!job) return json(res, 404, { error: '创书任务不存在或无权访问', code: 'core_job_missing' });
    json(res, 200, { ok: true, job: postgresCreationCoreJobView(job) });
  }
  async function handlePostgresCreationCoreJobCancel(req, res, jobId) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const job = await postgresRepository.getJob(postgresActor(auth), jobId);
    if (!job) return json(res, 404, { error: '创书任务不存在或无权访问', code: 'core_job_missing' });
    if (['running', 'claimed', 'queued'].includes(job.state)) {
      const next = await postgresRepository.upsertJob({
        userId: postgresActor(auth),
        workspaceId: job.workspaceId,
        projectId: job.projectId,
        jobId: job.id,
        kind: 'creation-core',
        state: 'cancel_requested',
        workerId: `server-${process.pid}`,
        attemptNo: job.attemptNo,
        fencingToken: job.fencingToken,
        inputHash: job.inputHash,
        result: job.result,
        errorCode: 'cancel_requested'
      });
      const activeJob = creationCoreJobs.get(String(jobId || ''));
      if (next.state === 'cancel_requested' && activeJob && activeJob.userId === postgresActor(auth)) {
        activeJob.cancelRequested = true;
        activeJob.status = 'cancelling';
        if (activeJob.controller) activeJob.controller.abort();
      }
      return json(res, 200, { ok: true, status: next.state === 'cancel_requested' ? 'cancelling' : next.state });
    }
    json(res, 200, { ok: true, status: job.state });
  }
  function handleCreationCoreJobGet(req, res, jobId) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const key = String(jobId || '');
    const actorUserId = String(auth.user.userId || projectScope.stableUserId(auth.user.email)).trim();
    const job = creationCoreJobs.get(key);
    const row = !job && dbReady() ? getDatabase().prepare(`SELECT * FROM creation_core_jobs
      WHERE id = ? AND (user_id = ? OR (user_id = '' AND user_email = ?))`).get(key, actorUserId, String(auth.user.email || '').toLowerCase()) : null;
    if ((!job && !row) || job && job.userId && job.userId !== actorUserId || job && !job.userId && job.userEmail !== auth.user.email) {
      return json(res, 404, { error: '创书任务不存在或已过期', code: 'core_job_missing' });
    }
    json(res, 200, { ok: true, job: job ? creationCoreJobPublic(job) : creationCoreJobFromDbRow(row) });
  }
  function handleCreationCoreJobCancel(req, res, jobId) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const key = String(jobId || '');
    const actorUserId = String(auth.user.userId || projectScope.stableUserId(auth.user.email)).trim();
    const job = creationCoreJobs.get(key);
    const row = !job && dbReady() ? getDatabase().prepare(`SELECT * FROM creation_core_jobs
      WHERE id = ? AND (user_id = ? OR (user_id = '' AND user_email = ?))`).get(key, actorUserId, String(auth.user.email || '').toLowerCase()) : null;
    if ((!job && !row) || job && job.userId && job.userId !== actorUserId || job && !job.userId && job.userEmail !== auth.user.email) {
      return json(res, 404, { error: '创书任务不存在或已过期' });
    }
    if (!job) return json(res, 409, { ok: false, status: row.status, code: row.status === 'provider_unknown' ? 'provider_unknown' : 'core_job_not_running' });
    if (job.status === 'running') {
      job.cancelRequested = true;
      if (job.controller) { try { job.controller.abort(); } catch (_) {} }
      persistCreationCoreJob({ ...job, status: 'cancelling', updatedAt: Date.now() });
      json(res, 200, { ok: true, status: 'cancelling' });
    } else {
      json(res, 200, { ok: true, status: job.status });
    }
  }
  return { get: POSTGRES_MODE ? handlePostgresCreationCoreJobGet : handleCreationCoreJobGet, cancel: POSTGRES_MODE ? handlePostgresCreationCoreJobCancel : handleCreationCoreJobCancel };
}
module.exports = { createCreationCoreJobHttpService };
