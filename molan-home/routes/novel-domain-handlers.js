'use strict';

function createNovelDomainHandlers({ repository, getAuthUser, readBody, json, respondError, sanitizeNovelState, summarizeNovel }) {
  const validId = id => typeof id === 'string' && /^n_[A-Za-z0-9]{1,30}$/.test(id);
  async function execute(req, res, operation) {
    try {
      const auth = await getAuthUser(req);
      if (!auth) return json(res, 401, { error: '未登录' });
      return await operation(auth.user);
    } catch (error) {
      return respondError(res, error);
    }
  }
  function validateId(res, id) {
    if (validId(id)) return true;
    json(res, 400, { error: '小说 id 非法' });
    return false;
  }
  function prepareState(body) {
    if (!body.state || typeof body.state !== 'object' || !Array.isArray(body.state.volumes)) {
      throw Object.assign(new Error('state 非法'), { status: 400 });
    }
    return sanitizeNovelState(body.state);
  }
  function savedResponse(result) {
    return { ok: true, id: result.id, workspaceId: result.workspaceId, projectId: result.projectId,
      wordCount: result.wordCount, updatedAt: result.updatedAt, revision: result.revision };
  }
  function handleNovelList(req, res) {
    return execute(req, res, async user => {
      const novels = await repository.list({ userId: user.userId });
      return json(res, 200, { ok: true, novels: novels.map(summarizeNovel || (novel => {
        const { state, ...summary } = novel;
        return summary;
      })) });
    });
  }
  function handleNovelGet(req, res, id) {
    return execute(req, res, async user => {
      if (!validateId(res, id)) return;
      const novel = await repository.read({ userId: user.userId, projectId: id });
      if (!novel) return json(res, 404, { error: '小说不存在或无权访问' });
      return json(res, 200, { ok: true, novel: { ...novel, state: sanitizeNovelState(novel.state) } });
    });
  }
  function handleNovelCreate(req, res) {
    return execute(req, res, async user => {
      const body = await readBody(req);
      if (body.id && !validateId(res, body.id)) return;
      const result = await repository.create({ user, id: body.id, workspaceId: String(body.workspaceId || '').trim(),
        title: body.title, state: prepareState(body) });
      return json(res, 200, savedResponse(result));
    });
  }
  function handleNovelSave(req, res, id) {
    return execute(req, res, async user => {
      if (!validateId(res, id)) return;
      const body = await readBody(req);
      const state = prepareState(body);
      const access = await repository.getAccess({ userId: user.userId, projectId: id });
      if (!access) {
        const result = await repository.create({ user, id, title: body.title, state });
        return json(res, 200, savedResponse(result));
      }
      const expectedRevision = body.revision == null ? null : Number(body.revision);
      if (expectedRevision != null && (!Number.isInteger(expectedRevision) || expectedRevision < 0)) {
        throw Object.assign(new Error('revision 非法'), { status: 400 });
      }
      const result = await repository.saveCAS({ userId: user.userId, projectId: id, title: body.title, state, expectedRevision });
      return json(res, 200, savedResponse(result));
    });
  }
  function handleNovelDelete(req, res, id) {
    return execute(req, res, async user => {
      if (!validateId(res, id)) return;
      return json(res, 200, await repository.softDelete({ userId: user.userId, projectId: id }));
    });
  }
  function handleNovelRestore(req, res, id) {
    return execute(req, res, async user => {
      if (!validateId(res, id)) return;
      return json(res, 200, await repository.restore({ userId: user.userId, projectId: id }));
    });
  }
  return { handleNovelList, handleNovelGet, handleNovelCreate, handleNovelSave, handleNovelDelete, handleNovelRestore };
}

module.exports = { createNovelDomainHandlers };
