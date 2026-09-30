'use strict';

function createProjectService({ MAX_NOVEL_STATE_BYTES, calcWordCount, dbReady, getAuthUser, json, parseNovelExportRange, postgresData, projectPackage, projectResources, projectScope, readBody, requireSqliteForPublic, sanitizeNovelStateForStorage, sendNovelExport, getDatabase }) {
  function handleNovelPackageExport(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    if (!requireSqliteForPublic(req, res)) return;
    if (!dbReady()) return json(res, 503, { error: '云端存储不可用' });
    const access = projectScope.getNovelAccess(getDatabase(), id, auth.user.userId);
    if (!projectScope.canAccess(access, new Set(['owner', 'admin', 'editor']), 'export')) return json(res, 404, { error: '小说不存在或无权导出' });
    const row = getDatabase().prepare('SELECT id, state_json FROM novels WHERE id = ? AND workspace_id = ? AND project_id = ?').get(id, access.workspace_id, access.project_id);
    if (!row) return json(res, 404, { error: '小说不存在或无权导出' });
    let state;
    try { state = JSON.parse(row.state_json || '{}'); } catch (_) { return json(res, 500, { error: '作品资料无法解析' }); }
    try {
      const resourceRows = getDatabase().prepare(`SELECT * FROM project_resources
        WHERE workspace_id = ? AND project_id = ? ORDER BY kind ASC, updated_at ASC, id ASC`)
        .all(access.workspace_id, access.project_id).map(projectResources.publicResource);
      state = postgresData.mergeResourcesIntoState(state, resourceRows);
      const packageValue = projectPackage.exportProjectPackage({
        projectId: access.project_id,
        workspaceId: access.workspace_id,
        ownerUserId: access.owner_user_id,
        state,
        assets: { creationAssets: state.creationAssets || {}, projectResources: resourceRows },
        versions: state.history || []
      });
      json(res, 200, { ok: true, package: packageValue });
    } catch (error) {
      json(res, 422, { error: error && error.message || '资料包导出失败', code: error && error.code || 'package_export_failed' });
    }
  }

  function handleNovelExport(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    if (!requireSqliteForPublic(req, res)) return;
    if (!dbReady()) return json(res, 503, { error: '云端存储不可用' });
    const access = projectScope.getNovelAccess(getDatabase(), id, auth.user.userId);
    if (!projectScope.canAccess(access, projectScope.PROJECT_ROLES, 'export')) return json(res, 404, { error: '小说不存在或无权导出' });
    const parsedRange = parseNovelExportRange(req);
    if (!parsedRange.ok) return json(res, 400, { error: '章节范围必须是有效的正整数区间', code: 'export_range_invalid' });
    const row = getDatabase().prepare('SELECT state_json FROM novels WHERE id = ? AND workspace_id = ? AND project_id = ?').get(id, access.workspace_id, access.project_id);
    if (!row) return json(res, 404, { error: '小说不存在或无权导出' });
    let state;
    try { state = JSON.parse(row.state_json || '{}'); }
    catch (_) { return json(res, 409, { error: '作品正文无法读取，已阻止导出', code: 'export_content_blocked', blocked: true }); }
    const format = new URL(req.url, 'http://localhost').searchParams.get('format');
    return sendNovelExport(res, id, state, [], format, parsedRange.range);
  }

  function restoreProjectResourceSnapshot(scope, assets, actorId) {
    const resources = assets && typeof assets === 'object' && Array.isArray(assets.projectResources)
      ? assets.projectResources
      : [];
    if (resources.length > 10000) {
      const error = new Error('资料包结构化资源数量超过限制');
      error.code = 'resource_count_exceeded';
      error.status = 413;
      throw error;
    }
    const now = Date.now();
    for (const source of resources) {
      if (!source || typeof source !== 'object') continue;
      const kind = projectResources.normalizeKind(source.kind);
      const resourceId = String(source.id || '').trim();
      if (!resourceId || resourceId.length > 160 || /[\u0000-\u001f\u007f]/.test(resourceId)) {
        const error = new Error('资料包资源 ID 无效');
        error.code = 'resource_id_invalid';
        error.status = 422;
        throw error;
      }
      const payload = source.payload && typeof source.payload === 'object' && !Array.isArray(source.payload) ? source.payload : {};
      const serialized = JSON.stringify(payload);
      const deleted = String(source.status || '') === 'deleted';
      const current = getDatabase().prepare(`SELECT * FROM project_resources
        WHERE workspace_id = ? AND project_id = ? AND kind = ? AND id = ?`)
        .get(scope.workspaceId, scope.projectId, kind, resourceId);
      if (!current) {
        getDatabase().prepare(`INSERT INTO project_resources
          (workspace_id, project_id, id, kind, payload_json, revision, status, created_by, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`)
          .run(scope.workspaceId, scope.projectId, resourceId, kind, serialized, deleted ? 'deleted' : 'active',
            actorId, now, now, deleted ? now : null);
        getDatabase().prepare(`INSERT INTO project_resource_versions
          (workspace_id, project_id, resource_id, revision, payload_json, changed_by, change_reason, created_at)
          VALUES (?, ?, ?, 1, ?, ?, ?, ?)`)
          .run(scope.workspaceId, scope.projectId, resourceId, serialized, actorId, '资料包恢复', now);
        continue;
      }
      const currentDeleted = current.deleted_at !== null;
      if (current.payload_json === serialized && currentDeleted === deleted) continue;
      const nextRevision = Number(current.revision) + 1;
      getDatabase().prepare(`UPDATE project_resources
        SET payload_json = ?, revision = ?, status = ?, updated_at = ?, deleted_at = ?
        WHERE workspace_id = ? AND project_id = ? AND kind = ? AND id = ? AND revision = ?`)
        .run(serialized, nextRevision, deleted ? 'deleted' : 'active', now, deleted ? now : null,
          scope.workspaceId, scope.projectId, kind, resourceId, current.revision);
      getDatabase().prepare(`INSERT INTO project_resource_versions
        (workspace_id, project_id, resource_id, revision, payload_json, changed_by, change_reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(scope.workspaceId, scope.projectId, resourceId, nextRevision, serialized, actorId, '资料包恢复', now);
    }
  }

  async function handleNovelPackageImport(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    if (!requireSqliteForPublic(req, res)) return;
    if (!dbReady()) return json(res, 503, { error: '云端存储不可用' });
    const access = projectScope.getNovelAccess(getDatabase(), id, auth.user.userId);
    if (!projectScope.canAccess(access, projectScope.WRITE_ROLES)) return json(res, 404, { error: '小说不存在或无权导入' });
    const body = await readBody(req).catch(() => ({}));
    const packageInput = body && body.package ? body.package : body;
    let existingIds = { projectIds: [id] };
    try {
      const rows = getDatabase().prepare('SELECT id FROM novel_projects WHERE workspace_id = ?').all(access.workspace_id);
      existingIds = { projectIds: rows.map(row => row.id) };
    } catch (_) {}
    const result = projectPackage.importProjectPackage(packageInput, {
      mode: 'preflight',
      targetProjectId: id,
      targetWorkspaceId: access.workspace_id,
      existingIds
    });
    json(res, result.ok ? 200 : 409, { ok: result.ok, preflight: result });
  }

  async function handleNovelPackageRestore(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    if (!requireSqliteForPublic(req, res)) return;
    if (!dbReady()) return json(res, 503, { error: '云端存储不可用' });
    const access = projectScope.getNovelAccess(getDatabase(), id, auth.user.userId);
    if (!projectScope.canAccess(access, new Set(['owner', 'admin']))) return json(res, 403, { error: '只有作品管理员可以恢复整包资料' });
    const body = await readBody(req).catch(() => ({}));
    const expectedRevision = Number(body.revision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) return json(res, 428, { error: '整包恢复需要当前作品 revision' });
    const packageInput = body && body.package ? body.package : body;
    const imported = projectPackage.importProjectPackage(packageInput, {
      mode: 'apply',
      targetProjectId: id,
      targetWorkspaceId: access.workspace_id,
      existingIds: { projectIds: [] }
    });
    if (!imported.ok || !imported.state || typeof imported.state !== 'object' || !Array.isArray(imported.state.volumes)) {
      return json(res, 422, { error: '资料包预检未通过，未修改当前作品', code: 'package_restore_preflight_failed', details: imported.errors || imported.conflicts || [] });
    }
    const state = sanitizeNovelStateForStorage(imported.state);
    const stateJson = JSON.stringify(state);
    if (Buffer.byteLength(stateJson, 'utf8') > MAX_NOVEL_STATE_BYTES) return json(res, 413, { error: '恢复后的作品数据过大' });
    const now = Date.now();
    getDatabase().exec('BEGIN IMMEDIATE');
    try {
      const result = getDatabase().prepare(`UPDATE novels
        SET state_json = ?, title = ?, word_count = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND workspace_id = ? AND project_id = ? AND revision = ?`)
        .run(stateJson, String(state.title || (state.outline && state.outline.book && state.outline.book.title) || '未命名小说').slice(0, 200), calcWordCount(state), now, id, access.workspace_id, access.project_id, expectedRevision);
      if (Number(result.changes || 0) !== 1) {
        getDatabase().exec('ROLLBACK');
        return json(res, 412, { error: '作品已被其他人更新，请重新读取后恢复', code: 'revision_conflict' });
      }
      restoreProjectResourceSnapshot({ workspaceId: access.workspace_id, projectId: access.project_id }, imported.assets, auth.user.userId);
      getDatabase().exec('COMMIT');
    } catch (error) {
      try { getDatabase().exec('ROLLBACK'); } catch (_) {}
      return json(res, error.status || 422, { error: error.message || '资料包恢复失败', code: error.code || 'package_restore_failed' });
    }
    const revision = Number(getDatabase().prepare('SELECT revision FROM novels WHERE id = ?').get(id).revision) || expectedRevision + 1;
    json(res, 200, { ok: true, id, revision, restored: true });
  }

  async function handleNovelResources(req, res, projectId, kind, resourceId = '') {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    if (!requireSqliteForPublic(req, res)) return;
    if (!dbReady()) return json(res, 503, { error: '云端存储不可用' });
    let normalizedKind;
    try { normalizedKind = projectResources.normalizeKind(kind); } catch (error) { return json(res, 422, { error: error.message, code: error.code }); }
    const access = projectScope.getNovelAccess(getDatabase(), projectId, auth.user.userId);
    if (!access) return json(res, 404, { error: '小说不存在或无权访问' });
    const parseResourceRevision = value => {
      const raw = String(value || '').trim();
      if (!raw || raw === '*' || /^W\//i.test(raw)) return NaN;
      const match = raw.match(/(\d+)"?$/);
      return match ? Number(match[1]) : NaN;
    };
    if (req.method === 'GET') {
      if (!projectResources.canMutate({ ...access, active: access.active }, normalizedKind) && !projectResources.READ_ROLES.has(access.role)) return json(res, 403, { error: '无权读取资料' });
      const includeDeleted = new URL(req.url, 'http://molan.local').searchParams.get('includeDeleted') === '1';
      const resources = resourceId
        ? projectResources.getResource(getDatabase(), access, normalizedKind, resourceId, includeDeleted)
        : projectResources.listResources(getDatabase(), { workspaceId: access.workspace_id, projectId: access.project_id }, normalizedKind, includeDeleted);
      if (resourceId && !resources) return json(res, 404, { error: '资料不存在或无权访问' });
      if (resourceId && resources.etag) res.setHeader('ETag', resources.etag);
      return json(res, 200, resourceId ? { ok: true, resource: resources } : { ok: true, resources });
    }
    if (req.method === 'POST' && !resourceId) {
      const body = await readBody(req).catch(() => ({}));
      const result = projectResources.createResource(getDatabase(), access, normalizedKind, body.payload, auth.user.userId, body.id, body.changeReason);
      if (!result.ok) {
        const status = result.code === 'forbidden' ? 403 : ['resource_payload_invalid', 'resource_id_invalid', 'resource_field_type_invalid', 'resource_field_value_invalid', 'NOT_APPLICABLE_REASON_REQUIRED', 'REFERENCE_CROSS_PROJECT_FORBIDDEN', 'REFERENCE_CROSS_WORKSPACE_FORBIDDEN', 'REFERENCE_NOT_FOUND'].includes(result.code) ? 422 : 409;
        return json(res, status, { error: '资料创建失败', code: result.code });
      }
      return json(res, 201, result);
    }
    if (!resourceId || !['PATCH', 'DELETE', 'POST'].includes(req.method)) return json(res, 405, { error: '方法不支持' });
    if (req.method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      const expectedRevision = parseResourceRevision(req.headers['if-match'] || body.revision);
      if (!Number.isInteger(expectedRevision) || expectedRevision < 1) return json(res, 428, { error: '资料恢复需要有效 If-Match 版本' });
      const result = projectResources.restoreResource(getDatabase(), access, normalizedKind, resourceId, expectedRevision, auth.user.userId, body.changeReason);
      if (!result.ok) return json(res, result.code === 'forbidden' ? 403 : result.code === 'revision_conflict' ? 412 : 404, { error: '资料恢复失败', code: result.code });
      return json(res, 200, result);
    }
    if (req.method === 'PATCH') {
      const body = await readBody(req).catch(() => ({}));
      const expectedRevision = parseResourceRevision(req.headers['if-match'] || body.revision);
      if (!Number.isInteger(expectedRevision) || expectedRevision < 1) return json(res, 428, { error: '资料更新需要有效 If-Match 版本' });
      const result = projectResources.updateResource(getDatabase(), access, normalizedKind, resourceId, body.payload, expectedRevision, auth.user.userId, body.changeReason);
      if (!result.ok) {
        const status = result.code === 'forbidden' ? 403 : result.code === 'revision_conflict' ? 412 : ['resource_payload_invalid', 'resource_id_invalid', 'resource_field_type_invalid', 'resource_field_value_invalid', 'NOT_APPLICABLE_REASON_REQUIRED', 'REFERENCE_CROSS_PROJECT_FORBIDDEN', 'REFERENCE_CROSS_WORKSPACE_FORBIDDEN', 'REFERENCE_NOT_FOUND'].includes(result.code) ? 422 : 404;
        return json(res, status, { error: '资料更新失败', code: result.code, current: result.current });
      }
      return json(res, 200, result);
    }
    const body = await readBody(req).catch(() => ({}));
    const expectedRevision = parseResourceRevision(req.headers['if-match'] || body.revision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) return json(res, 428, { error: '资料删除需要有效 If-Match 版本' });
    const result = projectResources.deleteResource(getDatabase(), access, normalizedKind, resourceId, expectedRevision, auth.user.userId, body.changeReason);
    if (!result.ok) return json(res, result.code === 'forbidden' ? 403 : result.code === 'revision_conflict' ? 412 : 404, { error: '资料删除失败', code: result.code });
    json(res, 200, result);
  }

  async function handleNovelResourceHistory(req, res, projectId, kind, resourceId, targetRevision = 0) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    if (!requireSqliteForPublic(req, res)) return;
    if (!dbReady()) return json(res, 503, { error: '云端存储不可用' });
    let normalizedKind;
    try { normalizedKind = projectResources.normalizeKind(kind); } catch (error) { return json(res, 422, { error: error.message, code: error.code }); }
    const access = projectScope.getNovelAccess(getDatabase(), projectId, auth.user.userId);
    if (!access) return json(res, 404, { error: '小说不存在或无权访问' });
    const resourceIdValue = String(resourceId || '');
    if (req.method === 'GET') {
      const versions = projectResources.listResourceVersions(getDatabase(), access, normalizedKind, resourceIdValue);
      if (versions === null) return json(res, 404, { error: '资料不存在或无权访问' });
      return json(res, 200, { ok: true, versions });
    }
    if (req.method !== 'POST' || !targetRevision) return json(res, 405, { error: '方法不支持' });
    const body = await readBody(req).catch(() => ({}));
    const raw = String(req.headers['if-match'] || body.revision || '').trim();
    if (!raw || raw === '*' || /^W\//i.test(raw)) return json(res, 428, { error: '历史版本恢复需要有效 If-Match 版本' });
    const match = raw.match(/(\d+)"?$/);
    const expectedRevision = match ? Number(match[1]) : NaN;
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) return json(res, 428, { error: '历史版本恢复需要有效 If-Match 版本' });
    const result = projectResources.restoreResourceVersion(getDatabase(), access, normalizedKind, resourceIdValue, targetRevision, expectedRevision, auth.user.userId, body.changeReason);
    if (!result.ok) return json(res, result.code === 'forbidden' ? 403 : result.code === 'revision_conflict' ? 412 : result.code === 'resource_version_missing' ? 404 : 422, { error: '历史版本恢复失败', code: result.code, current: result.current });
    return json(res, 200, result);
  }

  function handleWorkspaceList(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    if (!requireSqliteForPublic(req, res)) return;
    if (!dbReady()) return json(res, 503, { error: '云端存储不可用' });
    const rows = getDatabase().prepare(`SELECT w.id, w.name, wm.role, wm.active, w.created_at, w.updated_at
      FROM workspaces w JOIN workspace_members wm ON wm.workspace_id = w.id
      WHERE wm.user_id = ? AND wm.active = 1 ORDER BY w.updated_at DESC`).all(auth.user.userId);
    json(res, 200, {
      ok: true,
      workspaces: rows.map(row => ({ id: row.id, name: row.name, role: row.role, createdAt: row.created_at, updatedAt: row.updated_at }))
    });
  }

  async function handleWorkspaceCreate(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    if (!requireSqliteForPublic(req, res)) return;
    if (!dbReady()) return json(res, 503, { error: '云端存储不可用' });
    const body = await readBody(req).catch(() => ({}));
    const name = String(body.name || '').trim();
    if (!name || name.length > 120) return json(res, 422, { error: '工作区名称不能为空且不能超过120字' });
    const result = projectScope.createWorkspace(getDatabase(), auth.user, name);
    json(res, 201, result);
  }

  async function handleWorkspaceMembers(req, res, workspaceId) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    if (!requireSqliteForPublic(req, res)) return;
    if (!dbReady()) return json(res, 503, { error: '云端存储不可用' });
    const access = projectScope.getWorkspaceAccess(getDatabase(), workspaceId, auth.user.userId);
    if (!access) return json(res, 404, { error: '工作区不存在或无权访问' });
    if (req.method === 'GET') {
      return json(res, 200, { ok: true, members: projectScope.listWorkspaceMembers(getDatabase(), workspaceId).map(row => ({
        userId: row.user_id, email: row.email, name: row.name, role: row.role
      })) });
    }
    if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) return json(res, 405, { error: '方法不支持' });
    const body = await readBody(req).catch(() => ({}));
    const targetId = String(body.userId || '').trim();
    const targetEmail = String(body.email || '').trim().toLowerCase();
    const target = targetId
      ? getDatabase().prepare('SELECT user_id FROM accounts WHERE user_id = ?').get(targetId)
      : getDatabase().prepare('SELECT user_id FROM accounts WHERE email = ?').get(targetEmail);
    if (!target) return json(res, 404, { error: '目标账户不存在' });
    if (req.method === 'DELETE') {
      const result = projectScope.deactivateWorkspaceMember(getDatabase(), access, workspaceId, target.user_id);
      if (!result.ok) return json(res, result.code === 'forbidden' ? 403 : 409, { error: '工作区成员撤销失败', code: result.code });
      return json(res, 200, result);
    }
    const result = projectScope.upsertWorkspaceMember(getDatabase(), access, workspaceId, target.user_id, body.role || 'member');
    if (!result.ok) return json(res, ['forbidden', 'role_not_allowed'].includes(result.code) ? 403 : 409, { error: '工作区成员变更失败', code: result.code });
    json(res, 200, result);
  }

  function handleWorkspaceProjectList(req, res, workspaceId) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    if (!requireSqliteForPublic(req, res)) return;
    if (!dbReady()) return json(res, 503, { error: '云端存储不可用' });
    if (!projectScope.getWorkspaceAccess(getDatabase(), workspaceId, auth.user.userId)) return json(res, 404, { error: '工作区不存在或无权访问' });
    const projects = projectScope.listAccessibleProjects(getDatabase(), workspaceId, auth.user.userId);
    json(res, 200, {
      ok: true,
      projects: projects.map(row => ({
        workspaceId: row.workspace_id,
        projectId: row.project_id,
        title: row.title,
        role: row.role,
        canSpend: Number(row.can_spend) === 1,
        canExport: Number(row.can_export) === 1,
        updatedAt: row.updated_at
      }))
    });
  }

  async function handleNovelMembers(req, res, workspaceId, projectId) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    if (!requireSqliteForPublic(req, res)) return;
    if (!dbReady()) return json(res, 503, { error: '云端存储不可用' });
    const access = projectScope.getNovelAccess(getDatabase(), projectId, auth.user.userId);
    if (!access || access.workspace_id !== workspaceId) return json(res, 404, { error: '项目不存在或无权访问' });
    if (req.method === 'GET') {
      if (!projectScope.canAccess(access)) return json(res, 403, { error: '无权查看项目成员' });
      const rows = getDatabase().prepare(`SELECT pm.user_id, pm.role, pm.active, pm.can_spend, pm.can_export, a.name
        FROM project_members pm JOIN accounts a ON a.user_id = pm.user_id
        WHERE pm.workspace_id = ? AND pm.project_id = ? AND pm.active = 1 ORDER BY pm.created_at ASC`)
        .all(workspaceId, projectId);
      return json(res, 200, { ok: true, members: rows.map(row => ({ userId: row.user_id, name: row.name, role: row.role, canSpend: Number(row.can_spend) === 1, canExport: Number(row.can_export) === 1 })) });
    }
    if (req.method !== 'POST' && req.method !== 'PATCH' && req.method !== 'DELETE') return json(res, 405, { error: '方法不支持' });
    const body = await readBody(req).catch(() => ({}));
    const targetId = String(body.userId || '').trim();
    const targetEmail = String(body.email || '').trim().toLowerCase();
    const target = targetId
      ? getDatabase().prepare('SELECT user_id FROM accounts WHERE user_id = ?').get(targetId)
      : getDatabase().prepare('SELECT user_id FROM accounts WHERE email = ?').get(targetEmail);
    if (!target) return json(res, 404, { error: '目标账户不存在' });
    if (req.method === 'DELETE') {
      const result = projectScope.deactivateProjectMember(getDatabase(), access, workspaceId, projectId, target.user_id);
      if (!result.ok) return json(res, result.code === 'forbidden' ? 403 : 409, { error: '项目成员撤销失败', code: result.code });
      return json(res, 200, { ok: true, userId: target.user_id });
    }
    const result = projectScope.upsertProjectMember(getDatabase(), access, workspaceId, projectId, target.user_id,
      body.role, body.canSpend === true, body.canExport === true, body.transferOwner === true,
      body.aclRevision == null ? null : Number(body.aclRevision));
    if (!result.ok) return json(res, ['forbidden', 'role_not_allowed'].includes(result.code) ? 403 : result.code === 'acl_conflict' ? 412 : 409, { error: '项目成员变更失败', code: result.code, currentAclRevision: result.currentAclRevision });
    json(res, 200, result);
  }

  return { handleNovelPackageExport, handleNovelExport, restoreProjectResourceSnapshot, handleNovelPackageImport, handleNovelPackageRestore, handleNovelResources, handleNovelResourceHistory, handleWorkspaceList, handleWorkspaceCreate, handleWorkspaceMembers, handleWorkspaceProjectList, handleNovelMembers };
}

module.exports = { createProjectService };
