'use strict';
const resources = require('../lib/project-resources');
const projectPackage = require('../lib/project-package');
const postgresData = require('../lib/postgres-repository');
function fail(code, status) { throw Object.assign(new Error(code), { code, statusCode: status }); }
const publicResource = row => ({ ...row, status: row.deleted ? 'deleted' : 'active', deletedAt: row.deleted ? row.updatedAt : null, etag: `"resource-${row.id}-${row.revision}"` });
function revision(req, body, resourceId) {
  const header = req.headers['if-match'];
  if (header === undefined && body.revision === undefined) fail('VERSION_REQUIRED', 428);
  let value;
  if (header !== undefined) {
    const raw = String(header).trim();
    const prefix = `"resource-${resourceId}-`;
    if (!raw.startsWith(prefix) || !/^\d+"$/.test(raw.slice(prefix.length))) fail('INVALID_IF_MATCH', 400);
    value = Number(raw.slice(prefix.length, -1));
  } else {
    if (typeof body.revision !== 'number') fail('INVALID_REVISION', 400);
    value = body.revision;
  }
  if (!Number.isSafeInteger(value) || value < 1) fail('INVALID_REVISION', 400);
  return value;
}
function createNativeProjectService({ repository, getAuthUser, readBody, json }) {
  async function packageDispatch(req, res, projectId, action) {
    const auth = await getAuthUser(req); if (!auth?.user) fail('UNAUTHORIZED', 401);
    if (!repository.readProjectPackageSnapshot || !repository.restoreProjectPackageSnapshot) fail('PROJECT_PACKAGE_UNAVAILABLE', 503);
    const snapshot = await repository.readProjectPackageSnapshot({ userId: auth.user.userId, projectId });
    if (action === 'export') {
      const state = snapshot.novel.state;
      return { ok: true, package: projectPackage.exportProjectPackage({ projectId, workspaceId: snapshot.novel.workspaceId, ownerUserId: snapshot.access.owner_user_id, state, assets: { creationAssets: state.creationAssets || {}, projectResources: snapshot.resources }, versions: state.history || [] }) };
    }
    const body = await readBody(req); if (!body || typeof body !== 'object' || Array.isArray(body)) fail('INVALID_REQUEST_BODY', 400);
    const input = body.package || body;
    const result = projectPackage.importProjectPackage(input, { mode: action === 'restore' ? 'apply' : 'preflight', targetProjectId: projectId, targetWorkspaceId: snapshot.novel.workspaceId, existingIds: { projectIds: action === 'restore' ? [] : [projectId] } });
    if (action === 'import') return { ok: result.ok, preflight: result };
    if (!result.ok || !result.state || !Array.isArray(result.state.volumes)) fail('PACKAGE_RESTORE_PREFLIGHT_FAILED', 422);
    return repository.restoreProjectPackageSnapshot({ userId: auth.user.userId, projectId, expectedRevision: body.revision, state: result.state, resources: result.assets?.projectResources || [] });
  }
  async function target(body) {
    const account = body.userId ? await repository.getAccount(String(body.userId).trim()) : await repository.getAccount({ email: String(body.email || '').trim().toLowerCase() });
    if (!account) fail('ACCOUNT_NOT_FOUND', 404);
    return account.userId;
  }
  async function memberDetails(rows) {
    return Promise.all(rows.map(async member => { const account = await repository.getAccount(member.userId); return { userId: member.userId, email: account?.email, name: account?.name, role: member.role, canSpend: Boolean(member.canSpend), canExport: Boolean(member.canExport) }; }));
  }
  async function dispatch(req, res, pathname) {
    const packageMatch = pathname.match(/^\/api\/novels\/(n_[A-Za-z0-9_]+)\/package(?:\/(import|restore))?$/);
    if (packageMatch) {
      try { const action = packageMatch[2] || 'export'; if (action === 'export' && req.method !== 'GET' || action !== 'export' && req.method !== 'POST') fail('METHOD_NOT_ALLOWED', 405); const output = await packageDispatch(req, res, packageMatch[1], action); json(res, action === 'import' && !output.ok ? 409 : 200, output); } catch (error) { json(res, error.code === 'REVISION_CONFLICT' ? 412 : error.statusCode || error.status || 422, { ok: false, code: error.code || 'PROJECT_PACKAGE_FAILED', error: error.message }); } return true;
    }
    const workspace = pathname.match(/^\/api\/workspaces(?:\/([A-Za-z0-9_-]+)\/(members|projects)(?:\/(n_[A-Za-z0-9_]+)\/members)?)?$/);
    const resource = pathname.match(/^\/api\/novels\/(n_[A-Za-z0-9_]+)\/resources\/([A-Za-z0-9_-]+)(?:\/([A-Za-z0-9_-]+)(?:\/history(?:\/(\d+)\/restore)?)?)?$/);
    if (!workspace && !resource) return false;
    try {
      const auth = await getAuthUser(req); if (!auth?.user) fail('UNAUTHORIZED', 401);
      const userId = auth.user.userId;
      const body = req.method === 'GET' ? {} : await readBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail('INVALID_REQUEST_BODY', 400);
      let value, status = 200;
      if (workspace) {
        const [, workspaceId, section, projectId] = workspace;
        if (!workspaceId) {
          if (req.method === 'GET') value = { ok: true, workspaces: await repository.listWorkspaces(userId) };
          else if (req.method === 'POST') { const name = String(body.name || '').trim(); if (!name || name.length > 120) fail('INVALID_WORKSPACE_NAME', 422); const created = await repository.createWorkspace(userId, name); value = { ok: true, workspaceId: created.id, name: created.name }; status = 201; }
          else fail('METHOD_NOT_ALLOWED', 405);
        } else {
          const accessible = (await repository.listWorkspaces(userId)).some(w => w.id === workspaceId);
          if (!accessible) fail('WORKSPACE_NOT_FOUND', 404);
          if (projectId) {
            const access = await repository.getAccess({ userId, projectId, workspaceId }); if (!access) fail('PROJECT_NOT_FOUND', 404);
            if (req.method === 'GET') value = { ok: true, members: await memberDetails(await repository.listProjectMembers({ userId, projectId })) };
            else if (['POST', 'PATCH', 'DELETE'].includes(req.method)) {
              const targetUserId = await target(body);
              if (req.method === 'DELETE') { await repository.deactivateProjectMember({ userId, projectId, targetUserId }); value = { ok: true, userId: targetUserId }; }
              else {
                if (body.transferOwner) {
                  value = await repository.upsertProjectMember({ userId, projectId, targetUserId, role: 'owner', canSpend: true, canExport: true, transferOwner: true, expectedAclRevision: body.aclRevision == null ? null : Number(body.aclRevision) });
                } else value = await repository.upsertProjectMember({ userId, projectId, targetUserId, role: body.role, canSpend: body.canSpend === true, canExport: body.canExport === true, expectedAclRevision: body.aclRevision == null ? null : Number(body.aclRevision) });
              }
            } else fail('METHOD_NOT_ALLOWED', 405);
          } else if (section === 'projects') {
            if (req.method !== 'GET') fail('METHOD_NOT_ALLOWED', 405);
            const projects = await repository.list({ userId, workspaceId });
            value = { ok: true, projects: await Promise.all(projects.map(async p => { const access = await repository.getAccess({ userId, projectId: p.id, workspaceId }); return { workspaceId, projectId: p.id, title: p.title, role: access.role, canSpend: Number(access.can_spend) === 1, canExport: Number(access.can_export) === 1, updatedAt: p.updatedAt }; })) };
          } else if (req.method === 'GET') {
            if (!repository.listWorkspaceMembers) fail('WORKSPACE_MEMBERS_UNAVAILABLE', 503);
            value = { ok: true, members: await memberDetails(await repository.listWorkspaceMembers(userId, workspaceId)) };
          } else if (['POST', 'PATCH', 'DELETE'].includes(req.method)) {
            const targetUserId = await target(body);
            if (req.method === 'DELETE') { if (!repository.deactivateWorkspaceMember) fail('WORKSPACE_MEMBERS_UNAVAILABLE', 503); value = await repository.deactivateWorkspaceMember(userId, workspaceId, targetUserId); }
            else value = await repository.upsertWorkspaceMember(userId, workspaceId, targetUserId, body.role || 'member');
          } else fail('METHOD_NOT_ALLOWED', 405);
        }
      } else {
        const [, projectId, rawKind, id, targetRevision] = resource;
        const kind = resources.normalizeKind(rawKind);
        const access = await repository.getAccess({ userId, projectId }); if (!access) fail('PROJECT_NOT_FOUND', 404);
        const history = pathname.includes('/history');
        const rows = await repository.listResources({ userId, projectId, kind, includeDeleted: history || req.method !== 'GET' || new URL(req.url, 'http://x').searchParams.get('includeDeleted') === '1' });
        const existing = id ? rows.find(r => r.id === id) : null;
        if (id && !existing) fail('RESOURCE_NOT_FOUND', 404);
        if (history) {
          const versions = await repository.listResourceVersions({ userId, projectId, id });
          if (req.method === 'GET' && !targetRevision) value = { ok: true, versions };
          else if (req.method === 'POST' && targetRevision) { const version = versions.find(v => v.revision === Number(targetRevision)); if (!version) fail('RESOURCE_VERSION_MISSING', 404); value = await repository.saveResource({ userId, projectId, id, kind, payload: version.payload, expectedRevision: revision(req, body, id), reason: body.changeReason || '恢复历史版本' }); }
          else fail('METHOD_NOT_ALLOWED', 405);
        } else if (req.method === 'GET') {
          value = id ? { ok: true, resource: publicResource(existing) } : { ok: true, resources: rows.map(publicResource) };
          if (id && res.setHeader) res.setHeader('ETag', value.resource.etag);
        } else if (req.method === 'POST' && !id) { value = await repository.saveResource({ userId, projectId, kind, id: body.id, payload: body.payload, expectedRevision: 0, reason: body.changeReason }); status = 201; }
        else if (['PATCH', 'POST'].includes(req.method) && id) value = await repository.saveResource({ userId, projectId, kind, id, payload: req.method === 'POST' ? existing.payload : body.payload, expectedRevision: revision(req, body, id), reason: body.changeReason });
        else if (req.method === 'DELETE' && id) value = await repository.deleteResource({ userId, projectId, id, expectedRevision: revision(req, body, id) });
        else fail('METHOD_NOT_ALLOWED', 405);
        if (value.resource) value.resource = publicResource(value.resource);
      }
      json(res, status, value); return true;
    } catch (error) {
      const status = error.code === 'ACL_REVISION_CONFLICT' || error.code === 'REVISION_CONFLICT' && Boolean(resource?.[3]) ? 412 : error.statusCode || error.status || 500;
      json(res, status, { ok: false, error: error.message, code: error.code }); return true;
    }
  }
  return { dispatch };
}
module.exports = { createNativeProjectService };
