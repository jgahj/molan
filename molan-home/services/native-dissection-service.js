'use strict';

const { createNativeDissectionQueryService } = require('./native-dissection-query-service');

function createNativeDissectionService({
  repository,
  getAuthUser,
  readBody,
  json,
  respondError,
  worker,
  resolveModel,
  queryService,
  buildMarkdown,
  buildDocx,
  resultView,
  hasCompleteContent,
  responseCors
}) {
  const query = queryService || createNativeDissectionQueryService({
    repository,
    getAuthUser,
    json,
    respondError,
    buildMarkdown,
    buildDocx,
    resultView,
    hasCompleteContent,
    responseCors
  });
  const run = action => (req, res, id) => Promise.resolve().then(() => action(req, res, id)).catch(error => {
    if (error && error.code === 'FORBIDDEN') return json(res, 404, { error: '拆书任务不存在或无权访问', code: 'DISSECTION_NOT_FOUND' });
    return respondError(res, error);
  });
  function auth(req, res) { const value = getAuthUser(req); if (!value) json(res, 401, { error: '请先登录' }); return value; }
  const list = run(async (req, res) => {
    const value = auth(req, res); if (!value) return;
    json(res, 200, { ok: true, dissections: await repository.list({ actorUserId: value.user.userId }) });
  });
  const get = run(async (req, res, id) => {
    const value = auth(req, res); if (!value) return;
    const item = await repository.get({ actorUserId: value.user.userId, jobId: decodeURIComponent(id) });
    json(res, 200, { ok: true, dissection: item });
  });
  const create = run(async (req, res) => {
    const value = auth(req, res); if (!value) return;
    const body = await readBody(req);
    const item = await repository.create({ actorUserId: value.user.userId, requestId: body.requestId,
      id: body.id, projectId: body.projectId, sourceText: body.text || body.sourceText, title: body.title,
      selectedModel: resolveModel(value.user, body.model || body.selectedModel), depth: body.depth, purpose: body.purpose, versions: body.versions });
    json(res, 200, { ok: true, dissection: item });
    if (body.run !== false) void worker.execute({ actorUserId: value.user.userId, jobId: item.id,
      authToken: String(req.headers.authorization || '') }).catch(error => console.error('[native-dissection]', error.code || error.message));
  });
  const retry = run(async (req, res, id) => {
    const value = auth(req, res); if (!value) return;
    const jobId = decodeURIComponent(id);
    const item = await repository.get({ actorUserId: value.user.userId, jobId });
    void worker.execute({ actorUserId: value.user.userId, jobId, authToken: String(req.headers.authorization || '') }).catch(error => console.error('[native-dissection]', error.code || error.message));
    json(res, 202, { ok: true, dissection: item });
  });
  const patch = run(async (req, res, id) => {
    const value = auth(req, res); if (!value) return;
    const body = await readBody(req);
    const { revision, ...patch } = body;
    const item = await repository.update({ actorUserId: value.user.userId, jobId: decodeURIComponent(id), patch, expectedRevision: revision });
    json(res, 200, { ok: true, dissection: item });
  });
  const cancel = run(async (req, res, id) => {
    const value = auth(req, res); if (!value) return;
    const body = await readBody(req);
    const item = await repository.cancel({ actorUserId: value.user.userId, jobId: decodeURIComponent(id), expectedRevision: body.revision });
    json(res, 200, { ok: true, dissection: item });
  });
  const remove = run(async (req, res, id) => {
    const value = auth(req, res); if (!value) return;
    const body = await readBody(req);
    await repository.delete({ actorUserId: value.user.userId, jobId: decodeURIComponent(id), expectedRevision: body.revision });
    json(res, 200, { ok: true, deleted: 1 });
  });
  const units = run(async (req, res, id) => {
    const value = auth(req, res); if (!value) return;
    const url = new URL(req.url, 'http://localhost');
    const result = await repository.listUnits({ actorUserId: value.user.userId, jobId: decodeURIComponent(id), cursor: url.searchParams.get('cursor'), limit: Number(url.searchParams.get('limit')) || 50 });
    json(res, 200, { ok: true, ...result });
  });
  return {
    list,
    get,
    create,
    patch,
    cancel,
    remove,
    units,
    retry,
    export: query.handleExport,
    coverage: query.handleCoverage,
    entities: query.handleEntities,
    foreshadows: query.handleForeshadows,
    summaries: query.handleSummaries,
    validation: query.handleValidation,
    search: query.handleSearch,
    queryService: query,
    dispatch: query.dispatch
  };
}
module.exports = { createNativeDissectionService };
