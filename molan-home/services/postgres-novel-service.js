'use strict';

function createPostgresNovelService(dependencies) {
  const {
    getAuthUser, json, getPostgresRepository, readBody, requestError, projectScope,
    sanitizeNovelStateForStorage, calcWordCount, maxNovelStateBytes, crypto, novelListSummary
  } = dependencies;
  const postgresRepository = () => getPostgresRepository();

  /** 将 PostgreSQL 错误以稳定业务码返回，避免把驱动详情暴露给浏览器。 */
  function respondPostgresError(res, error) {
    const status = Number(error && error.status) || 503;
    const code = String(error && error.code || 'request_failed');
    json(res, status, { error: error && error.message ? error.message : 'PostgreSQL 操作失败', code });
  }

  /** 取得当前请求对应的稳定用户 ID，不使用可变邮箱作为数据归属。 */
  function postgresActor(auth) {
    return String(auth && auth.user && (auth.user.userId || projectScope.stableUserId(auth.user.email)) || '').trim();
  }

  /** 将 PostgreSQL 项目资料转换为旧小说列表接口兼容的轻量摘要。 */
  function postgresNovelListSummary(project, profile) {
    const state = profile && profile.state && typeof profile.state === 'object' ? profile.state : {};
    const serializedState = JSON.stringify(state);
    return novelListSummary({
      id: project.projectId,
      workspace_id: project.workspaceId,
      project_id: project.projectId,
      title: project.title || profile && profile.title || '未命名小说',
      state_json: serializedState,
      word_count: calcWordCount(state),
      created_at: profile && profile.createdAt || 0,
      updated_at: profile && profile.updatedAt || project.updatedAt || 0,
      revision: profile && profile.revision || 0,
      state_bytes: Buffer.byteLength(serializedState, 'utf8')
    });
  }

  /** PG 模式下读取作品列表，项目资料由 project_profiles 作为唯一 state 来源。 */
  async function handlePostgresNovelList(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    const userId = postgresActor(auth);
    const workspaces = await postgresRepository().listWorkspaces(userId);
    const projectGroups = await Promise.all(workspaces.map(workspace => postgresRepository().listProjects(userId, workspace.id)));
    const projects = projectGroups.flat();
    const profiles = await Promise.all(projects.map(project => postgresRepository().getProfile(userId, project.projectId, project.workspaceId)));
    json(res, 200, {
      ok: true,
      novels: projects.map((project, index) => postgresNovelListSummary(project, profiles[index]))
    });
  }

  /** PG 模式下读取一本作品的完整资料和项目权限摘要。 */
  async function handlePostgresNovelGet(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    if (!id || !/^n_[A-Za-z0-9]{1,30}$/.test(id)) return json(res, 400, { error: '小说 id 非法' });
    const profile = await postgresRepository().getProfile(postgresActor(auth), id);
    if (!profile) return json(res, 404, { error: '小说不存在或无权访问' });
    const state = sanitizeNovelStateForStorage(profile.state || {});
    json(res, 200, {
      ok: true,
      novel: {
        id,
        title: profile.title || state.title || '未命名小说',
        wordCount: calcWordCount(state),
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        revision: profile.revision,
        workspaceId: profile.access.workspace_id,
        projectId: profile.access.project_id,
        scope: projectScope.scopePublic(profile.access),
        state
      }
    });
  }

  /** PG 模式下保存整本 state，带版本号的请求才允许覆盖已有资料。 */
  async function handlePostgresNovelSave(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    if (!id || !/^n_[A-Za-z0-9]{1,30}$/.test(id)) return json(res, 400, { error: '小说 id 非法' });
    const body = await readBody(req);
    const rawState = body && body.state;
    const title = String(body && body.title || rawState && rawState.title || '未命名小说').slice(0, 200);
    if (!rawState || typeof rawState !== 'object' || !Array.isArray(rawState.volumes)) throw requestError(422, 'state 非法');
    const state = sanitizeNovelStateForStorage(rawState);
    const stateJson = JSON.stringify(state);
    if (Buffer.byteLength(stateJson, 'utf8') > maxNovelStateBytes) {
      throw requestError(413, '单本小说数据过大，最多支持 ' + Math.floor(maxNovelStateBytes / 1024 / 1024) + ' MB');
    }
    const revision = body.revision == null ? null : Number(body.revision);
    if (revision !== null && (!Number.isInteger(revision) || revision < 0)) throw requestError(422, 'revision 非法');
    const actorId = postgresActor(auth);
    const existingProfile = body.workspaceId ? null : await postgresRepository().getProfile(actorId, id);
    const saved = await postgresRepository().saveProfile({
      userId: actorId,
      workspaceId: String(body.workspaceId || existingProfile && existingProfile.access && existingProfile.access.workspace_id || '').trim(),
      projectId: id,
      title,
      state,
      expectedRevision: revision,
      wordCount: calcWordCount(state)
    });
    json(res, 200, saved);
  }

  /** PG 模式下把拆书角色写入作品设定，并通过 profile revision 防止覆盖并发编辑。 */
  async function handlePostgresNovelImportCharacters(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    if (!id || !/^n_[A-Za-z0-9]{1,30}$/.test(id)) return json(res, 400, { error: '小说 id 非法' });
    const body = await readBody(req);
    const chars = Array.isArray(body && body.characters) ? body.characters : [];
    if (!chars.length) return json(res, 400, { error: '请提供角色' });
    const userId = postgresActor(auth);
    const profile = await postgresRepository().getProfile(userId, id);
    if (!profile || !projectScope.canAccess(profile.access, projectScope.WRITE_ROLES)) {
      return json(res, 404, { error: '小说不存在或无权访问' });
    }
    const state = sanitizeNovelStateForStorage(profile.state || {});
    state.knowledge = state.knowledge && typeof state.knowledge === 'object' && !Array.isArray(state.knowledge)
      ? state.knowledge
      : {};
    const entities = state.knowledge.entities && typeof state.knowledge.entities === 'object' && !Array.isArray(state.knowledge.entities)
      ? state.knowledge.entities
      : {};
    let added = 0;
    chars.forEach(character => {
      const name = String(character && character.name || '').trim();
      if (!name) return;
      const entityId = 'ent_' + crypto.createHash('sha1').update(id + '|' + name).digest('hex').slice(0, 14);
      if (entities[entityId]) return;
      entities[entityId] = {
        id: entityId,
        name,
        type: 'character',
        description: [character.function, character.goal, character.conflict, character.arc]
          .map(value => String(value || '')).filter(Boolean).join('；'),
        source: 'dissection',
        createdAt: Date.now()
      };
      added += 1;
    });
    state.knowledge.entities = entities;
    if (Buffer.byteLength(JSON.stringify(state), 'utf8') > maxNovelStateBytes) {
      return json(res, 413, { error: '单本小说数据过大，最多支持 ' + Math.floor(maxNovelStateBytes / 1024 / 1024) + ' MB' });
    }
    const expectedRevision = body.revision == null ? Number(profile.revision) || 0 : Number(body.revision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) return json(res, 400, { error: 'revision 非法' });
    const saved = await postgresRepository().saveProfile({
      userId,
      workspaceId: profile.access.workspace_id,
      projectId: id,
      title: profile.title || state.title || '未命名小说',
      state,
      expectedRevision,
      wordCount: calcWordCount(state)
    });
    json(res, 200, { ok: true, added, total: Object.keys(entities).length, revision: saved.revision });
  }

  /** PG 模式下创建作品，服务端生成的项目 ID 与 legacy_id 同时保持稳定。 */
  async function handlePostgresNovelCreate(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    const body = await readBody(req);
    const rawState = body && body.state;
    const title = String(body && body.title || rawState && rawState.title || '未命名小说').slice(0, 200);
    if (!rawState || typeof rawState !== 'object' || !Array.isArray(rawState.volumes)) throw requestError(422, 'state 非法');
    const state = sanitizeNovelStateForStorage(rawState);
    const stateJson = JSON.stringify(state);
    if (Buffer.byteLength(stateJson, 'utf8') > maxNovelStateBytes) {
      throw requestError(413, '单本小说数据过大，最多支持 ' + Math.floor(maxNovelStateBytes / 1024 / 1024) + ' MB');
    }
    const id = String(body.id || ('n_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)));
    if (!/^n_[A-Za-z0-9]{1,30}$/.test(id)) throw requestError(422, 'id 非法');
    const revision = body.revision == null ? null : Number(body.revision);
    if (revision !== null && (!Number.isInteger(revision) || revision < 0)) throw requestError(422, 'revision 非法');
    const actorId = postgresActor(auth);
    const existingProfile = body.workspaceId ? null : await postgresRepository().getProfile(actorId, id);
    const saved = await postgresRepository().saveProfile({
      userId: actorId,
      workspaceId: String(body.workspaceId || existingProfile && existingProfile.access && existingProfile.access.workspace_id || '').trim(),
      projectId: id,
      title,
      state,
      expectedRevision: revision,
      wordCount: calcWordCount(state)
    });
    json(res, 200, saved);
  }

  /** PG 模式下软删除作品，正文和资料仍由数据库保留。 */
  async function handlePostgresNovelDelete(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    if (!id || !/^n_[A-Za-z0-9]{1,30}$/.test(id)) return json(res, 400, { error: '小说 id 非法' });
    json(res, 200, await postgresRepository().deleteProject(postgresActor(auth), id));
  }

  /** PG 模式下恢复软删除作品，恢复授权在数据库安全函数中再次校验。 */
  async function handlePostgresNovelRestore(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    if (!id || !/^n_[A-Za-z0-9]{1,30}$/.test(id)) return json(res, 400, { error: '小说 id 非法' });
    json(res, 200, await postgresRepository().restoreProject(postgresActor(auth), id));
  }

  return {
    handlePostgresNovelList,
    handlePostgresNovelGet,
    handlePostgresNovelSave,
    handlePostgresNovelImportCharacters,
    handlePostgresNovelCreate,
    handlePostgresNovelDelete,
    handlePostgresNovelRestore,
    postgresNovelListSummary,
    postgresActor,
    respondPostgresError
  };
}

module.exports = { createPostgresNovelService };
