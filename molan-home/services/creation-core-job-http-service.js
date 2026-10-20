'use strict';

// PG-only 收敛后：创书核心任务读写统一走 postgresRepository；
// 原内存 Map + SQLite 回查的 legacy handler 已删除。
function createCreationCoreJobHttpService({ creationCoreJobs, getAuthUser, json, postgresActor, postgresCreationCoreJobView, postgresRepository }) {
  async function handleCreationCoreJobGet(req, res, jobId) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const job = await postgresRepository.getJob(postgresActor(auth), jobId);
    if (!job) return json(res, 404, { error: '创书任务不存在或无权访问', code: 'core_job_missing' });
    json(res, 200, { ok: true, job: postgresCreationCoreJobView(job) });
  }
  async function handleCreationCoreJobCancel(req, res, jobId) {
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
        errorCode: 'cancel_requested',
        // 2026-10-19 P2-1：仅当任务仍处于未终止状态才允许写入取消；
        // 若 worker 在快照读取后已完成，这里返回其真实终态而不覆盖。
        expectedStates: ['queued', 'claimed', 'running']
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
  return { get: handleCreationCoreJobGet, cancel: handleCreationCoreJobCancel };
}
module.exports = { createCreationCoreJobHttpService };
