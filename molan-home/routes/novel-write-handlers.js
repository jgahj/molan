'use strict';

function createNovelWriteHandlers({
  getDatabase,
  getAuthUser,
  requireStorage,
  isStorageReady,
  readBody,
  sanitizeNovelState,
  byteLength,
  maxNovelStateBytes,
  maxNovelsPerUser,
  calcWordCount,
  requestError,
  projectScope,
  json,
  respondError,
  now,
  random
}) {
  function handleNovelCreate(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    if (!requireStorage(req, res)) return;
    if (!isStorageReady()) return json(res, 503, { error: '云端存储不可用' });
    return readBody(req).then(body => {
      const rawState = body.state;
      const title = String(body.title || (rawState && rawState.title) || '未命名小说').slice(0, 200);
      if (!rawState || typeof rawState !== 'object' || !Array.isArray(rawState.volumes)) throw new Error('state 非法');
      const state = sanitizeNovelState(rawState);
      const stateJson = JSON.stringify(state);
      const stateBytes = byteLength(stateJson, 'utf8');
      if (stateBytes > maxNovelStateBytes) throw requestError(413, '单本小说数据过大，最多支持 ' + Math.floor(maxNovelStateBytes / 1024 / 1024) + ' MB');
      const id = body.id || ('n_' + now().toString(36) + random().toString(36).slice(2, 6));
      if (!/^n_[A-Za-z0-9]{1,30}$/.test(id)) throw new Error('id 非法');
      const timestamp = now();
      const wordCount = calcWordCount(state);
      const requestedWorkspaceId = String(body.workspaceId || '').trim();
      const database = getDatabase();
      if (requestedWorkspaceId && !projectScope.getWorkspaceAccess(database, requestedWorkspaceId, auth.user.userId)) {
        throw requestError(403, '无权在指定工作区创建小说');
      }

      const existing = database.prepare('SELECT user_email, owner_user_id, title FROM novels WHERE id = ?').get(id);
      let access = existing ? projectScope.getNovelAccess(database, id, auth.user.userId) : null;
      if (existing && !access && (!existing.owner_user_id && existing.user_email === auth.user.email)) {
        projectScope.ensureNovelProject(database, auth.user, id, existing.title);
        access = projectScope.getNovelAccess(database, id, auth.user.userId);
      }
      if (existing && !projectScope.canAccess(access, projectScope.WRITE_ROLES)) throw requestError(403, '无权修改此小说');
      let revision = 0;
      if (existing) {
        const result = database.prepare('UPDATE novels SET title = ?, state_json = ?, word_count = ?, updated_at = ?, revision = revision + 1, owner_user_id = ? WHERE id = ? AND project_id = ?')
          .run(title, stateJson, wordCount, timestamp, auth.user.userId, id, id);
        if (Number(result.changes || 0) !== 1) throw requestError(409, '小说保存冲突，请重新同步');
        database.prepare('UPDATE novel_projects SET title = ?, updated_at = ? WHERE project_id = ?').run(title, timestamp, id);
        revision = Number(database.prepare('SELECT revision FROM novels WHERE id = ?').get(id).revision) || 0;
      } else {
        const count = Number(database.prepare(`SELECT COUNT(*) AS n FROM novels
          WHERE owner_user_id = ? OR (owner_user_id = '' AND user_email = ?)`).get(auth.user.userId, auth.user.email).n) || 0;
        if (count >= maxNovelsPerUser) throw requestError(409, '已达到单个账户的小说数量上限');
        database.prepare('INSERT INTO novels (id, user_email, owner_user_id, title, state_json, word_count, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)')
          .run(id, auth.user.email, auth.user.userId, title, stateJson, wordCount, timestamp, timestamp);
      }
      projectScope.ensureNovelProject(database, auth.user, id, title, requestedWorkspaceId);
      json(res, 200, {
        ok: true, id,
        workspaceId: (projectScope.getNovelAccess(database, id, auth.user.userId) || {}).workspace_id || '',
        projectId: id, wordCount, updatedAt: timestamp, revision
      });
    }).catch(error => respondError(res, error));
  }

  return { handleNovelCreate };
}

module.exports = { createNovelWriteHandlers };
