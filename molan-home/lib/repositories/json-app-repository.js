'use strict';

const crypto = require('node:crypto');
const { JsonFileRepository } = require('./json-file-repository');
const { stableUserId, personalWorkspaceId, scopePublic, canAccess, WRITE_ROLES } = require('../project-scope');
const { matchesTokenUsageReservation } = require('../token-usage-idempotency');
const resourceRules = require('../project-resources');

const INDEX = '__molan_app_index_v1__';
const fail = (code, status, message = code) => { throw Object.assign(new Error(message), { code, status, statusCode: status }); };
const key = (kind, id) => `${kind}:${id}`;
const clone = value => structuredClone(value);
const money = value => Math.round(Number(value) * 10000) / 10000;
const usageScope = input => input.projectId || `__molan_usage_${crypto.createHash('sha256').update(String(input.userId)).digest('hex')}`;
function countWords(state) {
  return (state.volumes || []).reduce((total, volume) => total + (volume.chapters || []).reduce((sum, chapter) =>
    sum + (chapter.scenes || []).reduce((n, scene) => n + String(scene.content || '').replace(/\s/g, '').length, 0), 0), 0);
}
function accessFrom(project, userId, includeDeleted = false) {
  const member = project?.members?.[userId];
  if (!project || !member?.active || !includeDeleted && project.status !== 'active') return null;
  return {
    workspace_id: project.workspaceId, project_id: project.id, user_id: userId,
    owner_user_id: project.ownerUserId, role: member.role, active: 1,
    can_spend: member.canSpend ? 1 : 0, can_export: member.canExport ? 1 : 0,
    acl_revision: project.aclRevision, status: project.status
  };
}
function publicNovel(project, access) {
  return { id: project.id, title: project.title, state: clone(project.state), wordCount: project.wordCount,
    createdAt: project.createdAt, updatedAt: project.updatedAt, revision: project.contentRevision,
    workspaceId: project.workspaceId, projectId: project.id, scope: scopePublic(access) };
}
function validateReferences(tx, projectId, payload, kind) {
  const refs = resourceRules.projectMaterialSchema.collectReferences(payload, kind);
  function visit(value, isReference = false) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(child => visit(child, isReference)); return; }
    const id = value.resourceId || value.id;
    const targetKind = String(value.resourceKind || value.kind || '').toLowerCase();
    if (isReference && id && resourceRules.RESOURCE_TYPES.has(targetKind)) refs.push({ id, kind: targetKind });
    for (const [field, child] of Object.entries(value)) visit(child, isReference || /(?:^references?$|Refs$|^parentRef$|^targetRef$)/i.test(field));
  }
  visit(payload);
  for (const ref of refs) {
    const target = tx.get(projectId, 'novels', key('resource', ref.id));
    if (!target || target.deleted || ref.kind && target.resourceKind !== ref.kind) fail('REFERENCE_NOT_FOUND', 422);
  }
}

class JsonAppRepository {
  constructor(directory, options = {}) {
    this.repository = options.repository || new JsonFileRepository(directory, options.repositoryOptions);
    this.ownsRepository = !options.repository;
    this.maxNovelsPerUser = options.maxNovelsPerUser || 100;
    this.maxNovelStateBytes = options.maxNovelStateBytes || 16 * 1024 * 1024;
    this.guardNovelWrite = options.guardNovelWrite || null;
    this.onNovelChanged = options.onNovelChanged || null;
    this.now = options.now || Date.now;
    this.backend = 'json';
  }

  async listAccounts() {
    return (await this.repository.accounts.list(null)).filter(row => row.kind === 'account' && !row.deleted)
      .map(({ kind, ...row }) => row);
  }
  async getAccount(input) {
    const userId = typeof input === 'string' ? input : input.userId;
    if (userId) {
      const row = await this.repository.accounts.get(null, key('account', userId));
      return row?.kind === 'account' && !row.deleted ? { ...row, id: row.userId } : null;
    }
    const email = String(input.email || '').trim().toLowerCase();
    return (await this.listAccounts()).find(row => row.email === email) || null;
  }
  async saveAccount(input, expectedRevision) {
    const email = String(input.email || '').trim().toLowerCase();
    if (!email) fail('INVALID_ACCOUNT', 422);
    for (const field of ['credits', 'spent']) {
      if (input[field] !== undefined && (!Number.isFinite(input[field]) || input[field] < 0)) fail('INVALID_ACCOUNT', 422);
    }
    const userId = input.userId || stableUserId(email);
    const workspaceId = personalWorkspaceId(userId);
    return this.repository.transaction([null, INDEX], tx => {
      const duplicate = tx.list(null, 'accounts').find(row => row.kind === 'account' && row.email === email && row.userId !== userId);
      if (duplicate) fail('ACCOUNT_EXISTS', 409);
      const previous = tx.get(null, 'accounts', key('account', userId));
      const saved = tx.put(null, 'accounts', { ...previous, ...clone(input), id: key('account', userId), kind: 'account',
        email, userId, createdAt: previous?.createdAt || this.now() }, expectedRevision);
      if (!tx.get(INDEX, 'novels', key('workspace', workspaceId))) {
        tx.put(INDEX, 'novels', { id: key('workspace', workspaceId), kind: 'workspace', workspaceId,
          ownerUserId: userId, name: `${input.name || email}的工作区`, members: { [userId]: { role: 'owner', active: true } } }, 0);
      }
      return { ...saved, id: userId };
    });
  }

  async listWorkspaces(userId) {
    return (await this.repository.novels.list(INDEX)).filter(row => row.kind === 'workspace' && row.members[userId]?.active)
      .map(row => ({ id: row.workspaceId, name: row.name, ownerUserId: row.ownerUserId, role: row.members[userId].role }));
  }
  async createWorkspace(userId, name) {
    if (!await this.getAccount(userId)) fail('ACCOUNT_NOT_FOUND', 404);
    const workspaceId = `ws_${crypto.randomUUID().replace(/-/g, '')}`;
    await this.repository.novels.put(INDEX, { id: key('workspace', workspaceId), kind: 'workspace', workspaceId,
      ownerUserId: userId, name: String(name || '').slice(0, 200), members: { [userId]: { role: 'owner', active: true } } }, 0);
    return { id: workspaceId, name: String(name || '').slice(0, 200), ownerUserId: userId, role: 'owner' };
  }
  async upsertWorkspaceMember(userId, workspaceId, targetUserId, role) {
    if (!['admin', 'member'].includes(role)) fail('INVALID_ROLE', 422);
    return this.repository.transaction([null, INDEX], tx => {
      const workspace = tx.get(INDEX, 'novels', key('workspace', workspaceId));
      if (!workspace?.members[userId]?.active || !['owner', 'admin'].includes(workspace.members[userId].role)) fail('FORBIDDEN', 403);
      if (targetUserId === workspace.ownerUserId) fail('OWNER_REQUIRED', 409);
      if (!tx.get(null, 'accounts', key('account', targetUserId))) fail('ACCOUNT_NOT_FOUND', 404);
      workspace.members[targetUserId] = { role, active: true };
      tx.put(INDEX, 'novels', workspace, workspace.revision);
      return { ok: true, userId: targetUserId, role };
    });
  }

  async getAccess({ userId, projectId, workspaceId, includeDeleted = false }) {
    if (projectId === INDEX) return null;
    const row = await this.repository.novels.get(projectId, projectId);
    if (row?.kind !== 'novel' || workspaceId && row.workspaceId !== workspaceId) return null;
    return accessFrom(row, userId, includeDeleted);
  }
  async read(input) {
    if (input.projectId === INDEX) return null;
    const row = await this.repository.novels.get(input.projectId, input.projectId);
    const access = row?.kind === 'novel' && (!input.workspaceId || row.workspaceId === input.workspaceId)
      ? accessFrom(row, input.userId) : null;
    if (!access) return null;
    return publicNovel(row, access);
  }
  async list({ userId, workspaceId }) {
    const indices = (await this.repository.novels.list(INDEX)).filter(row => row.kind === 'project-index' &&
      (!workspaceId || row.workspaceId === workspaceId));
    const novels = await Promise.all(indices.map(row => this.read({ userId, projectId: row.projectId })));
    return novels.filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  }
  validateState(state) {
    if (!state || typeof state !== 'object' || !Array.isArray(state.volumes)) fail('INVALID_STATE', 422, 'state 非法');
    if (Buffer.byteLength(JSON.stringify(state), 'utf8') > this.maxNovelStateBytes) fail('STATE_TOO_LARGE', 413);
  }
  async create(input) {
    this.validateState(input.state);
    const userId = input.user?.userId || stableUserId(input.user?.email);
    const id = String(input.id || `n_${crypto.randomBytes(10).toString('hex')}`);
    if (!/^n_[A-Za-z0-9]{1,30}$/.test(id)) fail('INVALID_ID', 422);
    const workspaceId = input.workspaceId || personalWorkspaceId(userId);
    return this.repository.transaction([null, INDEX, id], async tx => {
      if (!tx.get(null, 'accounts', key('account', userId))) fail('ACCOUNT_NOT_FOUND', 404);
      const workspace = tx.get(INDEX, 'novels', key('workspace', workspaceId));
      if (!workspace?.members[userId]?.active) fail('FORBIDDEN', 403, '无权在指定工作区创建小说');
      const old = tx.get(id, 'novels', id);
      if (old) {
        const access = accessFrom(old, userId);
        if (!canAccess(access, WRITE_ROLES)) fail('FORBIDDEN', 403, '无权修改此小说');
        if (old.workspaceId !== workspaceId) fail('FORBIDDEN', 403);
        if (input.expectedRevision != null && (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)) fail('INVALID_REVISION', 422);
        if (input.expectedRevision != null && old.contentRevision !== input.expectedRevision) fail('REVISION_CONFLICT', 409);
        if (this.guardNovelWrite) await this.guardNovelWrite(tx, old, input);
        const updated = tx.put(id, 'novels', { ...old, title: String(input.title || input.state.title || '未命名小说').slice(0, 200),
          state: clone(input.state), wordCount: countWords(input.state), contentRevision: old.contentRevision + 1, updatedAt: this.now() }, old.revision);
        if (this.onNovelChanged) await this.onNovelChanged(tx, updated, old);
        return { ok: true, ...publicNovel(updated, access) };
      }
      const owned = tx.list(INDEX, 'novels').filter(row => row.kind === 'project-index' && row.ownerUserId === userId);
      if (owned.length >= this.maxNovelsPerUser) fail('NOVEL_LIMIT', 409);
      const now = this.now();
      const row = tx.put(id, 'novels', { id, kind: 'novel', workspaceId, ownerUserId: userId,
        userEmail: input.user.email, title: String(input.title || input.state.title || '未命名小说').slice(0, 200),
        state: clone(input.state), wordCount: countWords(input.state), contentRevision: 0, aclRevision: 1,
        status: 'active', members: { [userId]: { role: 'owner', active: true, canSpend: true, canExport: true } }, createdAt: now, updatedAt: now }, 0);
      tx.put(INDEX, 'novels', { id: key('project', id), kind: 'project-index', projectId: id, workspaceId, ownerUserId: userId }, 0);
      return { ok: true, ...publicNovel(row, accessFrom(row, userId)) };
    });
  }
  async saveCAS(input) {
    this.validateState(input.state);
    const id = input.projectId;
    return this.repository.transaction([id], async tx => {
      const old = tx.get(id, 'novels', id);
      const access = accessFrom(old, input.userId);
      if (!canAccess(access, WRITE_ROLES)) fail('FORBIDDEN', 403, '无权修改此小说');
      if (input.expectedRevision != null && (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)) fail('INVALID_REVISION', 422);
      if (input.expectedRevision != null && old.contentRevision !== input.expectedRevision) fail('REVISION_CONFLICT', 409, '小说已在其他设备更新，请先同步最新版本');
      if (this.guardNovelWrite) await this.guardNovelWrite(tx, old, input);
      const row = tx.put(id, 'novels', { ...old, title: String(input.title || input.state.title || '未命名小说').slice(0, 200),
        state: clone(input.state), wordCount: countWords(input.state), contentRevision: old.contentRevision + 1, updatedAt: this.now() }, old.revision);
      if (this.onNovelChanged) await this.onNovelChanged(tx, row, old);
      return { ok: true, ...publicNovel(row, access) };
    });
  }
  async upsertProjectMember({ userId, projectId, targetUserId, role, canSpend = false, canExport = false, expectedAclRevision }) {
    if (!['admin', 'editor', 'reviewer', 'viewer'].includes(role)) fail('INVALID_ROLE', 422);
    return this.repository.transaction([INDEX, projectId], tx => {
      const project = tx.get(projectId, 'novels', projectId);
      const access = accessFrom(project, userId);
      if (!canAccess(access, new Set(['owner', 'admin']))) fail('FORBIDDEN', 403);
      if (project.aclRevision !== expectedAclRevision) fail('ACL_REVISION_CONFLICT', 409);
      if (targetUserId === project.ownerUserId) fail('OWNER_REQUIRED', 409);
      const workspace = tx.get(INDEX, 'novels', key('workspace', project.workspaceId));
      if (!workspace?.members[targetUserId]?.active) fail('WORKSPACE_MEMBER_REQUIRED', 409);
      project.members[targetUserId] = { role, active: true, canSpend: ['admin', 'editor'].includes(role) && Boolean(canSpend),
        canExport: ['admin', 'editor'].includes(role) && Boolean(canExport) };
      project.aclRevision++;
      tx.put(projectId, 'novels', project, project.revision);
      return { ok: true, aclRevision: project.aclRevision };
    });
  }
  async softDelete({ userId, projectId }) {
    return this.repository.transaction([projectId], tx => {
      const row = tx.get(projectId, 'novels', projectId);
      if (!canAccess(accessFrom(row, userId), new Set(['owner']))) fail('FORBIDDEN', 403, '只有作品所有者可以删除小说');
      tx.put(projectId, 'novels', { ...row, status: 'deleted', updatedAt: this.now() }, row.revision);
      return { ok: true, deleted: 1 };
    });
  }
  async listProjectMembers({ userId, projectId }) {
    const project = await this.repository.novels.get(projectId, projectId);
    if (!accessFrom(project, userId)) fail('PROJECT_NOT_FOUND', 404);
    return Object.entries(project.members).filter(([, member]) => member.active)
      .map(([memberId, member]) => ({ userId: memberId, ...member }));
  }
  async deactivateProjectMember({ userId, projectId, targetUserId }) {
    return this.repository.transaction([projectId], tx => {
      const project = tx.get(projectId, 'novels', projectId);
      if (!canAccess(accessFrom(project, userId), new Set(['owner', 'admin']))) fail('FORBIDDEN', 403);
      if (project.ownerUserId === targetUserId) fail('OWNER_REQUIRED', 409);
      const member = project.members[targetUserId];
      if (member?.active) {
        project.members[targetUserId] = { ...member, active: false };
        project.aclRevision++;
        tx.put(projectId, 'novels', project, project.revision);
      }
      return { ok: true, removed: member?.active ? 1 : 0, aclRevision: project.aclRevision };
    });
  }
  async restore({ userId, projectId }) {
    return this.repository.transaction([projectId], tx => {
      const row = tx.get(projectId, 'novels', projectId);
      if (!row || row.status !== 'deleted' || !canAccess(accessFrom(row, userId, true), new Set(['owner']))) fail('NOVEL_NOT_FOUND', 404);
      tx.put(projectId, 'novels', { ...row, status: 'active', updatedAt: this.now() }, row.revision);
      return { ok: true, restored: true, id: projectId, projectId, workspaceId: row.workspaceId };
    });
  }
  async settleLedger({ userId, projectId, idempotencyKey, costMinor, detail = {} }) {
    if (!idempotencyKey || !Number.isSafeInteger(costMinor) || costMinor < 0) fail('INVALID_USAGE', 422);
    return this.repository.transaction([null, projectId], tx => {
      const project = tx.get(projectId, 'novels', projectId);
      if (!canAccess(accessFrom(project, userId), WRITE_ROLES, 'spend')) fail('FORBIDDEN', 403);
      const id = key('usage', idempotencyKey);
      const old = tx.get(projectId, 'ledger', id);
      if (old) {
        if (old.userId !== userId || old.costMinor !== costMinor || JSON.stringify(old.detail) !== JSON.stringify(detail)) fail('IDEMPOTENCY_KEY_REUSED', 409);
        return { ...old, idempotent: true };
      }
      const account = tx.get(null, 'accounts', key('account', userId));
      if (!account) fail('ACCOUNT_NOT_FOUND', 404);
      const cost = costMinor / 100;
      if (account.role !== 'admin' && Number(account.credits || 0) < cost) fail('INSUFFICIENT_CREDITS', 402);
      tx.put(null, 'accounts', { ...account, credits: account.role === 'admin' ? account.credits : Number(account.credits || 0) - cost,
        spent: Number(account.spent || 0) + cost }, account.revision);
      return { ...tx.put(projectId, 'ledger', { id, userId, costMinor, detail: clone(detail), createdAt: this.now() }, 0), idempotent: false };
    });
  }
  async createAuthSession(input) {
    if (!/^[a-f0-9]{64}$/i.test(String(input.tokenHash || '')) || !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= this.now()) {
      fail('INVALID_SESSION', 422);
    }
    if (input.scope !== undefined && !['client', 'admin'].includes(input.scope)) fail('INVALID_SESSION', 422);
    return this.repository.transaction([null], tx => {
      const account = tx.get(null, 'accounts', key('account', input.userId));
      if (!account || account.deleted) fail('ACCOUNT_NOT_FOUND', 404);
      return tx.put(null, 'accounts', { id: key('session', input.tokenHash), kind: 'session', tokenHash: input.tokenHash,
        userId: account.userId, email: account.email, scope: input.scope || 'client', expiresAt: input.expiresAt,
        revokedAt: null, createdAt: this.now() }, 0);
    });
  }
  async getAuthSession(tokenHash) {
    const row = await this.repository.accounts.get(null, key('session', tokenHash));
    if (!row || row.kind !== 'session' || row.revokedAt || row.expiresAt <= this.now()) return null;
    const account = await this.getAccount(row.userId);
    return account ? { ...row, user: account } : null;
  }
  async revokeAuthSession(tokenHash) {
    return this.repository.transaction([null], tx => {
      const row = tx.get(null, 'accounts', key('session', tokenHash));
      if (!row) return { revoked: false };
      if (!row.revokedAt) tx.put(null, 'accounts', { ...row, revokedAt: this.now() }, row.revision);
      return { revoked: true };
    });
  }
  async listAuthSessions() {
    return (await this.repository.accounts.list(null)).filter(row => row.kind === 'session' && !row.revokedAt && row.expiresAt > this.now());
  }
  async reserveTokenUsage(input) {
    if (!input.requestId || !Number.isFinite(input.reservedCost) || input.reservedCost < 0) fail('INVALID_USAGE', 422);
    const scope = usageScope(input);
    return this.repository.transaction([null, scope], tx => {
      if (input.projectId) {
        const project = tx.get(scope, 'novels', input.projectId);
        if (!canAccess(accessFrom(project, input.userId), WRITE_ROLES, 'spend')) fail('FORBIDDEN', 403);
      }
      const id = key('reservation', input.requestId);
      const old = tx.get(scope, 'generation', id);
      if (old) {
        if (!matchesTokenUsageReservation(old, input)) fail('IDEMPOTENCY_KEY_REUSED', 409);
        return { ...old, idempotent: true };
      }
      const account = tx.get(null, 'accounts', key('account', input.userId));
      if (!account || account.deleted) fail('ACCOUNT_NOT_FOUND', 404);
      const amount = Math.round(input.reservedCost * 10000) / 10000;
      if (account.role !== 'admin' && Number(account.credits || 0) < amount) fail('INSUFFICIENT_CREDITS', 402);
      tx.put(null, 'accounts', { ...account, credits: account.role === 'admin' ? account.credits : money(Number(account.credits || 0) - amount) }, account.revision);
      const row = tx.put(scope, 'generation', { ...clone(input), id, kind: 'usage-reservation',
        reservedCost: amount, status: 'reserved', createdAt: this.now(), updatedAt: this.now() }, 0);
      return { ...row, idempotent: false };
    });
  }
  async settleTokenUsage(input) {
    if (!input.requestId || !Number.isFinite(input.actualCost) || input.actualCost < 0) fail('INVALID_USAGE', 422);
    const scope = usageScope(input);
    return this.repository.transaction([null, scope], tx => {
      const reservation = tx.get(scope, 'generation', key('reservation', input.requestId));
      if (!reservation || reservation.userId !== input.userId) fail('RESERVATION_NOT_FOUND', 404);
      const amount = Math.round(input.actualCost * 10000) / 10000;
      const ledgerId = key('reservation-settlement', input.requestId);
      const previous = tx.get(scope, 'ledger', ledgerId);
      if (previous) {
        if (previous.actualCost !== amount || previous.userId !== input.userId || previous.outcome !== (input.outcome || 'succeeded')) fail('IDEMPOTENCY_KEY_REUSED', 409);
        return { ...previous, idempotent: true };
      }
      if (reservation.status !== 'reserved') fail('RESERVATION_ALREADY_RELEASED', 409);
      if (amount > reservation.reservedCost) fail('RESERVATION_LIMIT_EXCEEDED', 409);
      const account = tx.get(null, 'accounts', key('account', input.userId));
      if (!account) fail('ACCOUNT_NOT_FOUND', 404);
      tx.put(null, 'accounts', { ...account,
        credits: account.role === 'admin' ? account.credits : money(Number(account.credits || 0) + reservation.reservedCost - amount),
        spent: money(Number(account.spent || 0) + amount) }, account.revision);
      tx.put(scope, 'generation', { ...reservation, status: 'settled', updatedAt: this.now() }, reservation.revision);
      return { ...tx.put(scope, 'ledger', { id: ledgerId, kind: 'usage-settlement', userId: input.userId,
        requestId: input.requestId, reservedCost: reservation.reservedCost, actualCost: amount,
        outcome: input.outcome || 'succeeded', usage: clone(input.usage || {}), createdAt: this.now() }, 0), idempotent: false };
    });
  }
  async releaseStaleTokenUsage({ before }) {
    if (!Number.isFinite(before)) fail('INVALID_TIME', 422);
    const projects = (await this.repository.novels.list(INDEX)).filter(row => row.kind === 'project-index');
    projects.push(...(await this.listAccounts()).map(account => ({ projectId: usageScope(account) })));
    let released = 0;
    for (const { projectId } of projects) {
      released += await this.repository.transaction([null, projectId], tx => {
        let count = 0;
        for (const row of tx.list(projectId, 'generation')) {
          if (row.kind !== 'usage-reservation' || row.status !== 'reserved' || row.updatedAt >= before) continue;
          const account = tx.get(null, 'accounts', key('account', row.userId));
          if (!account) fail('ACCOUNT_NOT_FOUND', 404);
          tx.put(null, 'accounts', { ...account, credits: account.role === 'admin' ? account.credits : money(Number(account.credits || 0) + row.reservedCost) }, account.revision);
          tx.put(projectId, 'generation', { ...row, status: 'released', updatedAt: this.now() }, row.revision);
          tx.put(projectId, 'ledger', { id: key('reservation-release', row.requestId), kind: 'usage-release',
            userId: row.userId, requestId: row.requestId, reservedCost: row.reservedCost, createdAt: this.now() }, 0);
          count++;
        }
        return count;
      });
    }
    return { released };
  }
  async lookupTokenUsage(input) {
    if (!input.userId || !input.requestId) fail('INVALID_USAGE', 422);
    const row = await this.repository.generation.get(usageScope(input), key('reservation', input.requestId));
    if (row && row.userId !== input.userId) fail('IDEMPOTENCY_KEY_REUSED', 409);
    return row;
  }
  async listTokenUsage({ userId, projectId, limit = 100 }) {
    const rows = await this.summarizeTokenUsage({ userId, projectId });
    return rows.slice(0, Math.max(0, Math.min(1000, Number(limit) || 100)));
  }
  async summarizeTokenUsage({ userId, projectId }) {
    if (!userId) fail('INVALID_USAGE', 422);
    if (projectId && !await this.getAccess({ userId, projectId })) fail('FORBIDDEN', 403);
    const scopes = projectId ? [projectId] : [usageScope({ userId }),
      ...(await this.repository.novels.list(INDEX)).filter(row => row.kind === 'project-index').map(row => row.projectId)];
    const rows = [];
    for (const scope of scopes) rows.push(...(await this.repository.ledger.list(scope)).filter(row => row.kind === 'usage-settlement' && row.userId === userId));
    return rows.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  }
  async adjustCredits({ userId, delta, expectedRevision }) {
    if (!Number.isFinite(delta)) fail('INVALID_USAGE', 422);
    return this.repository.transaction([null, INDEX], tx => {
      const account = tx.get(null, 'accounts', key('account', userId));
      if (!account || account.deleted) fail('ACCOUNT_NOT_FOUND', 404);
      if (expectedRevision !== undefined && account.revision !== expectedRevision) fail('REVISION_CONFLICT', 409);
      const credits = money(Number(account.credits || 0) + delta);
      if (credits < 0) fail('INSUFFICIENT_CREDITS', 402);
      const saved = tx.put(null, 'accounts', { ...account, credits }, account.revision);
      tx.put(INDEX, 'ledger', { id: key('credit-adjustment', crypto.randomUUID()), kind: 'credit-adjustment',
        userId, delta: money(delta), balanceBefore: account.credits, balanceAfter: credits,
        accountRevision: saved.revision, createdAt: this.now() }, 0);
      return saved;
    });
  }
  async listResources({ userId, projectId, kind, includeDeleted = false }) {
    const access = await this.getAccess({ userId, projectId });
    if (!access) fail('PROJECT_NOT_FOUND', 404);
    return (await this.repository.novels.list(projectId)).filter(row => row.kind === 'resource' &&
      (!kind || row.resourceKind === kind) && (includeDeleted || !row.deleted))
      .map(row => ({ id: row.resourceId, kind: row.resourceKind, payload: clone(row.payload), revision: row.contentRevision,
        workspaceId: access.workspace_id, projectId, deleted: row.deleted, createdAt: row.createdAt, updatedAt: row.updatedAt }));
  }
  async saveResource({ userId, projectId, id, kind, payload, expectedRevision = 0, reason = '' }) {
    const normalizedKind = resourceRules.normalizeKind(kind);
    const resourceId = String(id || `${normalizedKind}_${crypto.randomBytes(8).toString('hex')}`);
    return this.repository.transaction([projectId], tx => {
      const project = tx.get(projectId, 'novels', projectId);
      const access = accessFrom(project, userId);
      if (!resourceRules.canMutate(access, normalizedKind)) fail('FORBIDDEN', 403);
      resourceRules.normalizePayload(payload, access, normalizedKind);
      validateReferences(tx, projectId, payload, normalizedKind);
      const recordId = key('resource', resourceId);
      const previous = tx.get(projectId, 'novels', recordId);
      if (previous && previous.resourceKind !== normalizedKind) fail('RESOURCE_NOT_FOUND', 404);
      if ((previous?.contentRevision || 0) !== expectedRevision) fail('REVISION_CONFLICT', 409);
      const revision = expectedRevision + 1;
      const timestamp = this.now();
      const row = tx.put(projectId, 'novels', { id: recordId, kind: 'resource', resourceId, resourceKind: normalizedKind,
        payload: clone(payload), contentRevision: revision, deleted: false, createdAt: previous?.createdAt || timestamp,
        updatedAt: timestamp }, previous?.revision || 0);
      tx.put(projectId, 'ledger', { id: key('resource-version', `${resourceId}:${revision}`), kind: 'resource-version',
        resourceId, resourceKind: normalizedKind, payload: clone(payload), contentRevision: revision, changedBy: userId,
        reason: String(reason), createdAt: timestamp }, 0);
      return { ok: true, resource: { id: resourceId, kind: normalizedKind, payload: row.payload, revision,
        projectId, workspaceId: project.workspaceId, createdAt: row.createdAt, updatedAt: timestamp, deleted: false } };
    });
  }
  async listResourceVersions({ userId, projectId, id }) {
    if (!await this.getAccess({ userId, projectId })) fail('PROJECT_NOT_FOUND', 404);
    return (await this.repository.ledger.list(projectId)).filter(row => row.kind === 'resource-version' && row.resourceId === id)
      .map(row => ({ revision: row.contentRevision, payload: row.payload, changedBy: row.changedBy,
        changeReason: row.reason, createdAt: row.createdAt })).sort((a, b) => b.revision - a.revision);
  }
  async deleteResource({ userId, projectId, id, expectedRevision }) {
    return this.repository.transaction([projectId], tx => {
      const access = accessFrom(tx.get(projectId, 'novels', projectId), userId);
      const row = tx.get(projectId, 'novels', key('resource', id));
      if (!row) fail('RESOURCE_NOT_FOUND', 404);
      if (!resourceRules.canMutate(access, row.resourceKind)) fail('FORBIDDEN', 403);
      if (row.contentRevision !== expectedRevision) fail('REVISION_CONFLICT', 409);
      tx.put(projectId, 'novels', { ...row, deleted: true, contentRevision: row.contentRevision + 1, updatedAt: this.now() }, row.revision);
      tx.put(projectId, 'ledger', { id: key('resource-version', `${id}:${row.contentRevision + 1}`), kind: 'resource-version',
        resourceId: id, resourceKind: row.resourceKind, payload: row.payload, deleted: true,
        contentRevision: row.contentRevision + 1, changedBy: userId, reason: '删除资料', createdAt: this.now() }, 0);
      return { ok: true, deleted: true, revision: row.contentRevision + 1 };
    });
  }
  close() { return this.ownsRepository ? this.repository.close() : Promise.resolve(); }
}

module.exports = { JsonAppRepository, INDEX, countWords, accessFrom, publicNovel };
