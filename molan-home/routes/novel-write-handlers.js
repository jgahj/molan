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
  memoryWorkflow,
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

  function handleNovelSave(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    if (!requireStorage(req, res)) return;
    if (!isStorageReady()) return json(res, 503, { error: '云端存储不可用' });
    if (!id || !/^n_[A-Za-z0-9]{1,30}$/.test(id)) return json(res, 400, { error: '小说 id 非法' });
    let writeTransaction = false;
    let transactionDatabase = null;
    return readBody(req).then(body => {
      const database = getDatabase();
      transactionDatabase = database;
      const rawState = body.state;
      const title = String(body.title || (rawState && rawState.title) || '未命名小说').slice(0, 200);
      if (!rawState || typeof rawState !== 'object' || !Array.isArray(rawState.volumes)) throw new Error('state 非法');
      const state = sanitizeNovelState(rawState);
      const stateJson = JSON.stringify(state);
      const stateBytes = byteLength(stateJson, 'utf8');
      if (stateBytes > maxNovelStateBytes) throw requestError(413, '单本小说数据过大，最多支持 ' + Math.floor(maxNovelStateBytes / 1024 / 1024) + ' MB');
      const requestedRevision = body.revision == null ? null : Number(body.revision);
      if (requestedRevision !== null && (!Number.isInteger(requestedRevision) || requestedRevision < 0)) throw new Error('revision 非法');
      const timestamp = now();
      const wordCount = calcWordCount(state);
      const existing = database.prepare('SELECT user_email, owner_user_id, title, project_id FROM novels WHERE id = ?').get(id);
      let access = existing ? projectScope.getNovelAccess(database, id, auth.user.userId) : null;
      if (existing && !access && (!existing.owner_user_id && existing.user_email === auth.user.email)) {
        projectScope.ensureNovelProject(database, auth.user, id, existing.title);
        access = projectScope.getNovelAccess(database, id, auth.user.userId);
      }
      if (existing && !projectScope.canAccess(access, projectScope.WRITE_ROLES)) throw requestError(403, '无权修改此小说');
      if (existing) memoryWorkflow.guardNovelWrite(database, id, requestedRevision);
      database.exec('BEGIN IMMEDIATE');
      writeTransaction = true;
      let revision = 0;
      if (existing) {
        let result;
        if (requestedRevision === null) {
          result = database.prepare('UPDATE novels SET title = ?, state_json = ?, word_count = ?, updated_at = ?, revision = revision + 1, owner_user_id = ? WHERE id = ? AND project_id = ?')
            .run(title, stateJson, wordCount, timestamp, auth.user.userId, id, id);
        } else {
          result = database.prepare('UPDATE novels SET title = ?, state_json = ?, word_count = ?, updated_at = ?, revision = revision + 1, owner_user_id = ? WHERE id = ? AND project_id = ? AND revision = ?')
            .run(title, stateJson, wordCount, timestamp, auth.user.userId, id, id, requestedRevision);
        }
        if (Number(result.changes || 0) !== 1) throw requestError(409, '小说已在其他设备更新，请先同步最新版本');
        database.prepare('UPDATE novel_projects SET title = ?, updated_at = ? WHERE project_id = ?').run(title, timestamp, id);
        revision = Number(database.prepare('SELECT revision FROM novels WHERE id = ?').get(id).revision) || 0;
      } else {
        const count = Number(database.prepare(`SELECT COUNT(*) AS n FROM novels
          WHERE owner_user_id = ? OR (owner_user_id = '' AND user_email = ?)`).get(auth.user.userId, auth.user.email).n) || 0;
        if (count >= maxNovelsPerUser) throw requestError(409, '已达到单个账户的小说数量上限');
        database.prepare('INSERT INTO novels (id, user_email, owner_user_id, title, state_json, word_count, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)')
          .run(id, auth.user.email, auth.user.userId, title, stateJson, wordCount, timestamp, timestamp);
        projectScope.ensureNovelProject(database, auth.user, id, title);
      }
      memoryWorkflow.invalidateChangedSources(database, id);
      database.exec('COMMIT');
      writeTransaction = false;
      json(res, 200, { ok: true, id, workspaceId: (projectScope.getNovelAccess(database, id, auth.user.userId) || {}).workspace_id || '', projectId: id, wordCount, updatedAt: timestamp, revision });
    }).catch(error => {
      if (writeTransaction) transactionDatabase.exec('ROLLBACK');
      respondError(res, error);
    });
  }

  function handleNovelDelete(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    if (!requireStorage(req, res)) return;
    if (!isStorageReady()) return json(res, 503, { error: '云端存储不可用' });
    if (!id || !/^n_[A-Za-z0-9]{1,30}$/.test(id)) return json(res, 400, { error: '小说 id 非法' });
    const database = getDatabase();
    try {
      const access = projectScope.getNovelAccess(database, id, auth.user.userId);
      if (!projectScope.canAccess(access, projectScope.DELETE_ROLES)) return json(res, 403, { error: '只有作品所有者可以删除小说' });
      const result = database.prepare("UPDATE novel_projects SET status = 'deleted', updated_at = ? WHERE project_id = ? AND status = 'active'").run(now(), id);
      json(res, 200, { ok: true, deleted: result.changes || 0 });
    } catch (error) { json(res, 500, { error: error.message }); }
  }

  function handleNovelRestore(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    if (!requireStorage(req, res)) return;
    if (!isStorageReady()) return json(res, 503, { error: '云端存储不可用' });
    if (!id || !/^n_[A-Za-z0-9]{1,30}$/.test(id)) return json(res, 400, { error: '小说 id 非法' });
    const database = getDatabase();
    try {
      const row = database.prepare(`SELECT np.workspace_id, np.project_id
        FROM novel_projects np
        JOIN project_members pm ON pm.workspace_id = np.workspace_id AND pm.project_id = np.project_id
        WHERE np.project_id = ? AND np.status = 'deleted' AND pm.user_id = ? AND pm.active = 1 AND pm.role = 'owner'`).get(id, auth.user.userId);
      if (!row) return json(res, 404, { error: '小说不存在或无权恢复' });
      const result = database.prepare("UPDATE novel_projects SET status = 'active', updated_at = ? WHERE workspace_id = ? AND project_id = ? AND status = 'deleted'")
        .run(now(), row.workspace_id, row.project_id);
      json(res, 200, { ok: true, restored: Number(result.changes || 0) === 1, id, workspaceId: row.workspace_id, projectId: row.project_id });
    } catch (error) { json(res, 500, { error: error.message }); }
  }

  return { handleNovelCreate, handleNovelSave, handleNovelDelete, handleNovelRestore };
}

module.exports = { createNovelWriteHandlers };
