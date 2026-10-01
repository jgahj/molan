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
    computeStats
  } = dependencies;

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

  async function dispatch(request, response, pathname) {
    if (request.method !== 'PATCH') {
      return false;
    }
    const match = String(pathname || '').match(/^\/api\/dissections\/(d_[A-Za-z0-9_-]+)$/);
    if (!match) {
      return false;
    }
    await handlePatch(request, response, match[1]);
    return true;
  }

  return {
    handlePatch,
    dispatch
  };
}

module.exports = { createPostgresDissectionMutationService };
