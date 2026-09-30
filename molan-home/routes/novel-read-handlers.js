'use strict';

function createNovelReadHandlers({
  getDatabase,
  getAuthUser,
  requireStorage,
  isStorageReady,
  json,
  summarizeNovel,
  projectScope,
  sanitizeNovelState,
  postgresData,
  projectResources
}) {
  function handleNovelList(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    if (!requireStorage(req, res)) return;
    if (!isStorageReady()) return json(res, 503, { error: '云端存储不可用' });
    try {
      const rows = getDatabase().prepare(
        `SELECT n.id, n.workspace_id, n.project_id, n.title, n.state_json, n.word_count, n.created_at, n.updated_at, n.revision,
          LENGTH(n.state_json) AS state_bytes
         FROM novels n
         JOIN project_members pm ON pm.workspace_id = n.workspace_id AND pm.project_id = n.project_id
         JOIN novel_projects np ON np.workspace_id = n.workspace_id AND np.project_id = n.project_id AND np.status = 'active'
         WHERE pm.user_id = ? AND pm.active = 1
         ORDER BY n.updated_at DESC`
      ).all(auth.user.userId);
      json(res, 200, { ok: true, novels: rows.map(summarizeNovel) });
    } catch (error) { json(res, 500, { error: error.message }); }
  }

  function handleNovelGet(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    if (!requireStorage(req, res)) return;
    if (!isStorageReady()) return json(res, 503, { error: '云端存储不可用' });
    if (!id || !/^n_[A-Za-z0-9]{1,30}$/.test(id)) return json(res, 400, { error: '小说 id 非法' });
    try {
      const database = getDatabase();
      const row = database.prepare(
        `SELECT n.id, n.workspace_id, n.project_id, n.title, n.state_json, n.word_count, n.created_at, n.updated_at, n.revision
         FROM novels n
         JOIN project_members pm ON pm.workspace_id = n.workspace_id AND pm.project_id = n.project_id
         JOIN novel_projects np ON np.workspace_id = n.workspace_id AND np.project_id = n.project_id AND np.status = 'active'
         WHERE n.id = ? AND pm.user_id = ? AND pm.active = 1`
      ).get(id, auth.user.userId);
      if (!row) return json(res, 404, { error: '小说不存在或无权访问' });
      const access = projectScope.getNovelAccess(database, id, auth.user.userId);
      if (!projectScope.canAccess(access)) return json(res, 404, { error: '小说不存在或无权访问' });
      let state = null;
      try { state = sanitizeNovelState(JSON.parse(row.state_json)); }
      catch (_) { return json(res, 500, { error: 'state_json 解析失败' }); }
      try {
        const resources = database.prepare(`SELECT * FROM project_resources
          WHERE workspace_id = ? AND project_id = ? ORDER BY kind ASC, updated_at ASC, id ASC`)
          .all(access.workspace_id, access.project_id).map(projectResources.publicResource);
        state = postgresData.mergeResourcesIntoState(state, resources);
      } catch (_) {}
      json(res, 200, { ok: true, novel: {
        id: row.id, title: row.title, wordCount: row.word_count, createdAt: row.created_at,
        updatedAt: row.updated_at, revision: Number(row.revision) || 0,
        workspaceId: row.workspace_id, projectId: row.project_id,
        scope: projectScope.scopePublic(access), state
      } });
    } catch (error) { json(res, 500, { error: error.message }); }
  }

  return { handleNovelList, handleNovelGet };
}

module.exports = { createNovelReadHandlers };
