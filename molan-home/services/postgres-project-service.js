'use strict';

function createPostgresProjectService({ getAuthUser, json, postgresRepository, readBody, postgresActor, getUserById, getUserByEmail }) {
  /** PG 模式下维护结构化资料，所有读写都绑定项目和 revision。 */
  async function handlePostgresResources(req, res, projectId, kind, resourceId = '') {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    const userId = postgresActor(auth);
    const workspaceId = String(new URL(req.url, 'http://molan.local').searchParams.get('workspaceId') || '').trim();
    const parseResourceRevision = value => {
      const raw = String(value || '').trim();
      const match = raw.match(/(\d+)"?$/);
      return match ? Number(match[1]) : NaN;
    };
    if (req.method === 'GET') {
      const result = await postgresRepository.listResources(userId, projectId, kind, resourceId, workspaceId, new URL(req.url, 'http://molan.local').searchParams.get('includeDeleted') === '1');
      if (result === null || resourceId && !result) return json(res, 404, { error: '资料不存在或无权访问' });
      if (resourceId && result.etag) res.setHeader('ETag', result.etag);
      return json(res, 200, resourceId ? { ok: true, resource: result } : { ok: true, resources: result });
    }
    if (req.method === 'POST' && !resourceId) {
      const body = await readBody(req);
      return json(res, 201, await postgresRepository.createResource({
        userId, workspaceId, projectId, kind, id: body.id, payload: body.payload, changeReason: body.changeReason
      }));
    }
    if (!resourceId || !['PATCH', 'DELETE', 'POST'].includes(req.method)) return json(res, 405, { error: '方法不支持' });
    const body = await readBody(req).catch(() => ({}));
    const expectedRevision = parseResourceRevision(req.headers['if-match'] || body.revision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) return json(res, 428, { error: '资料操作需要有效 If-Match 版本' });
    if (req.method === 'POST') {
      const result = await postgresRepository.restoreResource({
        userId, workspaceId, projectId, kind, resourceId, expectedRevision, changeReason: body.changeReason
      });
      if (!result.ok) return json(res, result.code === 'revision_conflict' ? 412 : result.code === 'forbidden' ? 403 : 404, { error: '资料恢复失败', code: result.code, current: result.current });
      return json(res, 200, result);
    }
    if (req.method === 'PATCH') {
      const result = await postgresRepository.updateResource({
        userId, workspaceId, projectId, kind, resourceId, payload: body.payload, expectedRevision, changeReason: body.changeReason
      });
      if (!result.ok) return json(res, result.code === 'revision_conflict' ? 412 : result.code === 'forbidden' ? 403 : 404, { error: '资料更新失败', code: result.code, current: result.current });
      return json(res, 200, result);
    }
    const result = await postgresRepository.deleteResource({
      userId, workspaceId, projectId, kind, resourceId, expectedRevision, changeReason: body.changeReason
    });
    if (!result.ok) return json(res, result.code === 'revision_conflict' ? 412 : result.code === 'forbidden' ? 403 : 404, { error: '资料删除失败', code: result.code, current: result.current });
    return json(res, 200, result);
  }

  async function handlePostgresResourceHistory(req, res, projectId, kind, resourceId, targetRevision = 0) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    const userId = postgresActor(auth);
    const query = new URL(req.url, 'http://molan.local').searchParams;
    const workspaceId = String(query.get('workspaceId') || '').trim();
    if (req.method === 'GET') {
      const versions = await postgresRepository.listResourceVersions({ userId, workspaceId, projectId, kind, resourceId });
      if (versions === null) return json(res, 404, { error: '资料不存在或无权访问' });
      return json(res, 200, { ok: true, versions });
    }
    if (req.method !== 'POST' || !targetRevision) return json(res, 405, { error: '方法不支持' });
    const body = await readBody(req).catch(() => ({}));
    const raw = String(req.headers['if-match'] || body.revision || '').trim();
    const match = raw.match(/(\d+)"?$/);
    const expectedRevision = match ? Number(match[1]) : NaN;
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) return json(res, 428, { error: '历史版本恢复需要有效 If-Match 版本' });
    const result = await postgresRepository.restoreResourceVersion({
      userId, workspaceId, projectId, kind, resourceId, targetRevision, expectedRevision,
      changeReason: body.changeReason
    });
    if (!result.ok) return json(res, result.code === 'revision_conflict' ? 412 : result.code === 'forbidden' ? 403 : 404, { error: '历史版本恢复失败', code: result.code, current: result.current });
    return json(res, 200, result);
  }

  /** PG 模式下列出当前用户所属工作区。 */
  async function handlePostgresWorkspaceList(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    json(res, 200, { ok: true, workspaces: await postgresRepository.listWorkspaces(postgresActor(auth)) });
  }

  /** PG 模式下创建工作区，数据库函数保证首位 owner 原子建立。 */
  async function handlePostgresWorkspaceCreate(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    const body = await readBody(req);
    json(res, 201, await postgresRepository.createWorkspace(postgresActor(auth), body.name));
  }

  /** PG 模式下读取或变更工作区成员，目标身份先从本地认证账户映射到稳定 userId。 */
  async function handlePostgresWorkspaceMembers(req, res, workspaceId) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    const userId = postgresActor(auth);
    if (req.method === 'GET') {
      const members = await postgresRepository.listWorkspaceMembers(userId, workspaceId);
      return json(res, 200, { ok: true, members: await Promise.all(members.map(async member => {
        const account = await getUserById(member.userId);
        return { userId: member.userId, email: account && account.email || '', name: account && account.name || '', role: member.role };
      })) });
    }
    const body = await readBody(req);
    const account = body.userId ? await getUserById(body.userId) : await getUserByEmail(String(body.email || '').trim().toLowerCase());
    if (!account) return json(res, 404, { error: '目标账户不存在' });
    if (req.method === 'DELETE') {
      return json(res, 200, await postgresRepository.deactivateWorkspaceMember(userId, workspaceId, account.userId));
    }
    if (!['POST', 'PATCH'].includes(req.method)) return json(res, 405, { error: '方法不支持' });
    return json(res, 200, await postgresRepository.upsertWorkspaceMember(userId, workspaceId, account.userId, body.role || 'member'));
  }

  /** PG 模式下列出工作区内的显式项目成员可见项目。 */
  async function handlePostgresWorkspaceProjectList(req, res, workspaceId) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    json(res, 200, { ok: true, projects: await postgresRepository.listProjects(postgresActor(auth), workspaceId) });
  }

  /** PG 模式下维护项目成员和 canSpend/canExport 独立能力。 */
  async function handlePostgresNovelMembers(req, res, workspaceId, projectId) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    const userId = postgresActor(auth);
    if (req.method === 'GET') {
      const members = await postgresRepository.listProjectMembers(userId, workspaceId, projectId);
      return json(res, 200, { ok: true, members: await Promise.all(members.map(async member => {
        const account = await getUserById(member.userId);
        return { userId: member.userId, name: account && account.name || '', role: member.role, canSpend: member.canSpend, canExport: member.canExport };
      })) });
    }
    const body = await readBody(req);
    const account = body.userId ? await getUserById(body.userId) : await getUserByEmail(String(body.email || '').trim().toLowerCase());
    if (!account) return json(res, 404, { error: '目标账户不存在' });
    if (req.method === 'DELETE') {
      return json(res, 200, await postgresRepository.deactivateProjectMember(userId, workspaceId, projectId, account.userId));
    }
    if (!['POST', 'PATCH'].includes(req.method)) return json(res, 405, { error: '方法不支持' });
    return json(res, 200, await postgresRepository.upsertProjectMember(
      userId,
      workspaceId,
      projectId,
      account.userId,
      body.role,
      body.canSpend === true,
      body.canExport === true,
      body.transferOwner === true,
      body.aclRevision == null ? null : Number(body.aclRevision)
    ));
  }
  return { handlePostgresResources, handlePostgresResourceHistory, handlePostgresWorkspaceList, handlePostgresWorkspaceCreate, handlePostgresWorkspaceMembers, handlePostgresWorkspaceProjectList, handlePostgresNovelMembers };
}

module.exports = { createPostgresProjectService };
