'use strict';

const crypto = require('node:crypto');

const WORKSPACE_ROLES = new Set(['owner', 'admin', 'member']);
const PROJECT_ROLES = new Set(['owner', 'admin', 'editor', 'reviewer', 'viewer']);
const WRITE_ROLES = new Set(['owner', 'admin', 'editor']);
const DELETE_ROLES = new Set(['owner']);

/** 为本地旧账户生成不会因显示名变化而改变的稳定用户标识。 */
function stableUserId(email) {
  const normalized = String(email || '').trim().toLowerCase();
  return normalized ? `usr_${crypto.createHash('sha256').update(`molan-user:${normalized}`, 'utf8').digest('hex').slice(0, 32)}` : '';
}

/** 为个人工作区生成稳定标识；多人工作区的ID由创建事务生成。 */
function personalWorkspaceId(userId) {
  const normalized = String(userId || '').trim();
  return normalized ? `ws_${crypto.createHash('sha256').update(`molan-workspace:${normalized}`, 'utf8').digest('hex').slice(0, 32)}` : '';
}

/** 创建多用户作用域表；只做加法，不删除旧小说或旧账户数据。 */
function initializeSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, user_id),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
    FOREIGN KEY (user_id) REFERENCES accounts(user_id)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS novel_projects (
    workspace_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    acl_revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, project_id),
    UNIQUE (project_id),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
    FOREIGN KEY (owner_user_id) REFERENCES accounts(user_id)
  )`);
  const projectColumns = db.prepare('PRAGMA table_info(novel_projects)').all().map(row => row.name);
  if (!projectColumns.includes('acl_revision')) db.exec('ALTER TABLE novel_projects ADD COLUMN acl_revision INTEGER NOT NULL DEFAULT 1');
  db.exec(`CREATE TABLE IF NOT EXISTS project_members (
    workspace_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner','admin','editor','reviewer','viewer')),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    can_spend INTEGER NOT NULL DEFAULT 0 CHECK (can_spend IN (0,1)),
    can_export INTEGER NOT NULL DEFAULT 0 CHECK (can_export IN (0,1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, project_id, user_id),
    FOREIGN KEY (workspace_id, project_id) REFERENCES novel_projects(workspace_id, project_id),
    FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_members(workspace_id, user_id),
    CHECK (role IN ('owner','admin') OR can_spend IN (0,1)),
    CHECK (role IN ('owner','admin') OR can_export IN (0,1))
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id, active)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id, active)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(workspace_id, project_id, active)');
}

/** 确保账户拥有个人工作区；不改变既有工作区成员关系。 */
function ensureUserWorkspace(db, user) {
  const userId = String(user && user.userId || '').trim();
  if (!userId) return null;
  const workspaceId = personalWorkspaceId(userId);
  const now = Date.now();
  db.prepare('INSERT OR IGNORE INTO workspaces (id, owner_user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(workspaceId, userId, `${String(user.name || user.email || '个人用户').trim()}的工作区`, now, now);
  db.prepare(`INSERT OR IGNORE INTO workspace_members
    (workspace_id, user_id, role, active, created_at, updated_at)
    VALUES (?, ?, 'owner', 1, ?, ?)`).run(workspaceId, userId, now, now);
  return workspaceId;
}

/** 确保小说绑定项目作用域；新建项目时仅赋当前账户owner。 */
function ensureNovelProject(db, user, novelId, title = '', requestedWorkspaceId = '') {
  const userId = String(user && user.userId || '').trim();
  const projectId = String(novelId || '').trim();
  if (!userId || !projectId) return null;
  const requested = String(requestedWorkspaceId || '').trim();
  const workspaceId = requested && getWorkspaceAccess(db, requested, userId)
    ? requested
    : ensureUserWorkspace(db, user);
  if (!workspaceId) return null;
  const now = Date.now();
  db.prepare(`INSERT OR IGNORE INTO novel_projects
    (workspace_id, project_id, owner_user_id, title, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?)`).run(workspaceId, projectId, userId, String(title || ''), now, now);
  const project = db.prepare('SELECT workspace_id, project_id, owner_user_id FROM novel_projects WHERE project_id = ?').get(projectId);
  if (!project || project.owner_user_id !== userId) return project || null;
  db.prepare(`INSERT OR IGNORE INTO project_members
    (workspace_id, project_id, user_id, role, active, can_spend, can_export, created_at, updated_at)
    VALUES (?, ?, ?, 'owner', 1, 1, 1, ?, ?)`).run(project.workspace_id, project.project_id, userId, now, now);
  db.prepare('UPDATE novel_projects SET title = ?, updated_at = ? WHERE workspace_id = ? AND project_id = ?')
    .run(String(title || ''), now, project.workspace_id, project.project_id);
  const novelColumns = db.prepare('PRAGMA table_info(novels)').all().map(row => row.name);
  if (novelColumns.includes('owner_user_id')) {
    db.prepare('UPDATE novels SET workspace_id = ?, project_id = ?, owner_user_id = ? WHERE id = ?')
      .run(project.workspace_id, project.project_id, userId, project.project_id);
  } else {
    db.prepare('UPDATE novels SET workspace_id = ?, project_id = ? WHERE id = ?')
      .run(project.workspace_id, project.project_id, project.project_id);
  }
  return { ...project, workspaceId: project.workspace_id, projectId: project.project_id, userId };
}

/** 将旧的email所有权映射到稳定用户、个人工作区和项目成员。 */
function migrateExistingScopes(db) {
  const accounts = db.prepare('SELECT email, user_id, name FROM accounts WHERE user_id IS NOT NULL AND user_id <> ?').all('');
  for (const account of accounts) ensureUserWorkspace(db, { email: account.email, name: account.name, userId: account.user_id });
  const novels = db.prepare('SELECT id, user_email, title, workspace_id, project_id FROM novels').all();
  for (const novel of novels) {
    const account = db.prepare('SELECT email, user_id, name FROM accounts WHERE email = ?').get(String(novel.user_email || '').toLowerCase());
    if (!account || !account.user_id) continue;
    const scope = ensureNovelProject(db, account, novel.id, novel.title);
    if (!scope) continue;
    db.prepare('UPDATE novels SET workspace_id = ?, project_id = ? WHERE id = ?')
      .run(scope.workspaceId, scope.projectId, novel.id);
  }
}

/** 返回当前账户在小说项目中的显式成员和能力；不存在则为null。 */
function getNovelAccess(db, novelId, userId) {
  const projectId = String(novelId || '').trim();
  const actorId = String(userId || '').trim();
  if (!projectId || !actorId) return null;
  return db.prepare(`SELECT pm.workspace_id, pm.project_id, pm.user_id, pm.role, pm.active,
      pm.can_spend, pm.can_export, np.owner_user_id, np.status, np.acl_revision
    FROM project_members pm
    JOIN novel_projects np ON np.workspace_id = pm.workspace_id AND np.project_id = pm.project_id
    JOIN workspace_members wm ON wm.workspace_id = pm.workspace_id AND wm.user_id = pm.user_id AND wm.active = 1
    WHERE pm.project_id = ? AND pm.user_id = ? AND pm.active = 1 AND np.status = 'active'`).get(projectId, actorId) || null;
}

/** 返回用户在工作区的有效成员身份；工作区身份不自动等于项目成员。 */
function getWorkspaceAccess(db, workspaceId, userId) {
  return db.prepare(`SELECT workspace_id, user_id, role, active
    FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND active = 1`)
    .get(String(workspaceId || ''), String(userId || '')) || null;
}

/** 创建自定义工作区并在同一事务中建立首位owner。 */
function createWorkspace(db, user, name) {
  const userId = String(user && user.userId || '').trim();
  const workspaceName = String(name || '').trim();
  if (!userId || !workspaceName) return { ok: false, code: 'invalid_workspace' };
  const workspaceId = `ws_${crypto.randomUUID().replace(/-/g, '')}`;
  const now = Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO workspaces (id, owner_user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(workspaceId, userId, workspaceName, now, now);
    db.prepare(`INSERT INTO workspace_members
      (workspace_id, user_id, role, active, created_at, updated_at)
      VALUES (?, ?, 'owner', 1, ?, ?)`).run(workspaceId, userId, now, now);
    db.exec('COMMIT');
    return { ok: true, workspaceId, name: workspaceName };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }
}

/** 列出工作区成员，不返回认证凭据或会话信息。 */
function listWorkspaceMembers(db, workspaceId) {
  return db.prepare(`SELECT wm.user_id, wm.role, wm.active, a.email, a.name
    FROM workspace_members wm JOIN accounts a ON a.user_id = wm.user_id
    WHERE wm.workspace_id = ? AND wm.active = 1 ORDER BY wm.created_at ASC`).all(String(workspaceId || ''));
}

/** 管理工作区成员；admin不能授予或修改owner/admin。 */
function upsertWorkspaceMember(db, actorAccess, workspaceId, targetUserId, role) {
  const normalizedRole = String(role || '').trim();
  if (!actorAccess || !actorAccess.active || !['owner', 'admin'].includes(actorAccess.role)) return { ok: false, code: 'forbidden' };
  if (!['admin', 'member'].includes(normalizedRole) || normalizedRole === 'admin' && actorAccess.role !== 'owner') {
    return { ok: false, code: 'role_not_allowed' };
  }
  const target = db.prepare('SELECT user_id FROM accounts WHERE user_id = ?').get(String(targetUserId || ''));
  if (!target) return { ok: false, code: 'account_missing' };
  const workspace = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(String(workspaceId || ''));
  if (!workspace) return { ok: false, code: 'workspace_missing' };
  const now = Date.now();
  db.prepare(`INSERT INTO workspace_members
    (workspace_id, user_id, role, active, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
    ON CONFLICT(workspace_id, user_id) DO UPDATE SET
      role = excluded.role, active = 1, updated_at = excluded.updated_at`)
    .run(String(workspaceId || ''), target.user_id, normalizedRole, now, now);
  db.prepare('UPDATE workspaces SET updated_at = ? WHERE id = ?').run(now, String(workspaceId || ''));
  return { ok: true, workspaceId: String(workspaceId || ''), userId: target.user_id, role: normalizedRole };
}

/** 撤销工作区成员；保留owner，避免工作区失去所有者。 */
function deactivateWorkspaceMember(db, actorAccess, workspaceId, targetUserId) {
  if (!actorAccess || !actorAccess.active || !['owner', 'admin'].includes(actorAccess.role)) return { ok: false, code: 'forbidden' };
  const target = db.prepare('SELECT role, active FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
    .get(String(workspaceId || ''), String(targetUserId || ''));
  if (!target || Number(target.active) !== 1) return { ok: false, code: 'member_missing' };
  if (target.role === 'owner' || actorAccess.role === 'admin' && target.role === 'admin') return { ok: false, code: 'owner_or_admin_protected' };
  db.prepare('UPDATE workspace_members SET active = 0, updated_at = ? WHERE workspace_id = ? AND user_id = ?')
    .run(Date.now(), String(workspaceId || ''), String(targetUserId || ''));
  db.prepare('UPDATE novel_projects SET acl_revision = acl_revision + 1, updated_at = ? WHERE workspace_id = ?')
    .run(Date.now(), String(workspaceId || ''));
  return { ok: true, workspaceId: String(workspaceId || ''), userId: String(targetUserId || '') };
}

/** 列出用户已显式加入的项目，不暴露同工作区未加入的私有项目。 */
function listAccessibleProjects(db, workspaceId, userId) {
  return db.prepare(`SELECT np.workspace_id, np.project_id, np.title, np.status,
      pm.role, pm.can_spend, pm.can_export, np.updated_at
    FROM novel_projects np
    JOIN project_members pm ON pm.workspace_id = np.workspace_id AND pm.project_id = np.project_id
    JOIN workspace_members wm ON wm.workspace_id = np.workspace_id AND wm.user_id = pm.user_id AND wm.active = 1
    WHERE np.workspace_id = ? AND pm.user_id = ? AND pm.active = 1 AND np.status = 'active'
    ORDER BY np.updated_at DESC`).all(String(workspaceId || ''), String(userId || ''));
}

/** 在项目成员表中增加或更新成员；管理员不能授予owner/admin。 */
function upsertProjectMember(db, actorAccess, workspaceId, projectId, targetUserId, role, canSpend, canExport, transferOwner = false, expectedAclRevision = null) {
  const normalizedRole = String(role || '').trim();
  if (!canAccess(actorAccess, new Set(['owner', 'admin']))) return { ok: false, code: 'forbidden' };
  if (transferOwner && normalizedRole !== 'owner') return { ok: false, code: 'role_not_allowed' };
  if (!PROJECT_ROLES.has(normalizedRole) || normalizedRole === 'owner' && actorAccess.role !== 'owner' ||
    normalizedRole === 'admin' && actorAccess.role !== 'owner') return { ok: false, code: 'role_not_allowed' };
  const project = db.prepare('SELECT workspace_id, project_id, owner_user_id, status FROM novel_projects WHERE workspace_id = ? AND project_id = ?')
    .get(String(workspaceId || ''), String(projectId || ''));
  if (!project || project.status !== 'active') return { ok: false, code: 'project_missing' };
  const workspaceMember = db.prepare('SELECT active FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
    .get(project.workspace_id, String(targetUserId || ''));
  if (!workspaceMember || Number(workspaceMember.active) !== 1) return { ok: false, code: 'workspace_member_required' };
  const targetId = String(targetUserId || '');
  const existingOwner = db.prepare(`SELECT user_id FROM project_members
    WHERE workspace_id = ? AND project_id = ? AND role = 'owner' AND active = 1`).get(project.workspace_id, project.project_id);
  const currentAclRevision = Number(db.prepare('SELECT acl_revision FROM novel_projects WHERE workspace_id = ? AND project_id = ?').get(project.workspace_id, project.project_id).acl_revision) || 1;
  if (expectedAclRevision !== null && Number(expectedAclRevision) !== currentAclRevision) return { ok: false, code: 'acl_conflict', currentAclRevision };
  if (normalizedRole === 'owner' && project.owner_user_id !== targetId && !transferOwner) return { ok: false, code: 'owner_transfer_required' };
  if (normalizedRole !== 'owner' && existingOwner && existingOwner.user_id === targetId && !transferOwner) return { ok: false, code: 'owner_required' };
  const now = Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    if (transferOwner && project.owner_user_id !== targetId) {
      if (existingOwner && existingOwner.user_id !== targetId) {
        db.prepare(`UPDATE project_members
          SET role = 'admin', can_spend = 1, can_export = 1, updated_at = ?
          WHERE workspace_id = ? AND project_id = ? AND user_id = ? AND role = 'owner' AND active = 1`)
          .run(now, project.workspace_id, project.project_id, existingOwner.user_id);
      }
      db.prepare('UPDATE novel_projects SET owner_user_id = ? WHERE workspace_id = ? AND project_id = ?')
        .run(targetId, project.workspace_id, project.project_id);
    }
    db.prepare(`INSERT INTO project_members
      (workspace_id, project_id, user_id, role, active, can_spend, can_export, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, project_id, user_id) DO UPDATE SET
        role = excluded.role, active = 1, can_spend = excluded.can_spend,
        can_export = excluded.can_export, updated_at = excluded.updated_at`)
      .run(project.workspace_id, project.project_id, targetId, normalizedRole,
        normalizedRole === 'owner' || normalizedRole === 'admin' ? 1 : (normalizedRole === 'editor' && canSpend) ? 1 : 0,
        normalizedRole === 'owner' || normalizedRole === 'admin' ? 1 : (normalizedRole === 'editor' && canExport) ? 1 : 0, now, now);
    const aclUpdate = db.prepare(`UPDATE novel_projects
      SET acl_revision = acl_revision + 1, updated_at = ?
      WHERE workspace_id = ? AND project_id = ? AND acl_revision = ?`)
      .run(now, project.workspace_id, project.project_id, currentAclRevision);
    if (Number(aclUpdate.changes || 0) !== 1) {
      db.exec('ROLLBACK');
      return { ok: false, code: 'acl_conflict', currentAclRevision };
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }
  const aclRevision = Number(db.prepare('SELECT acl_revision FROM novel_projects WHERE workspace_id = ? AND project_id = ?').get(project.workspace_id, project.project_id).acl_revision) || currentAclRevision + 1;
  return { ok: true, workspaceId: project.workspace_id, projectId: project.project_id, userId: targetId, role: normalizedRole, aclRevision };
}

/** 撤销项目成员访问；禁止撤掉唯一有效owner。 */
function deactivateProjectMember(db, actorAccess, workspaceId, projectId, targetUserId) {
  if (!canAccess(actorAccess, new Set(['owner', 'admin']))) return { ok: false, code: 'forbidden' };
  const target = db.prepare('SELECT role, active FROM project_members WHERE workspace_id = ? AND project_id = ? AND user_id = ?')
    .get(String(workspaceId || ''), String(projectId || ''), String(targetUserId || ''));
  if (!target || Number(target.active) !== 1) return { ok: false, code: 'member_missing' };
  if (target.role === 'owner') return { ok: false, code: 'owner_required' };
  db.prepare('UPDATE project_members SET active = 0, updated_at = ? WHERE workspace_id = ? AND project_id = ? AND user_id = ?')
    .run(Date.now(), String(workspaceId || ''), String(projectId || ''), String(targetUserId || ''));
  db.prepare('UPDATE novel_projects SET acl_revision = acl_revision + 1, updated_at = ? WHERE workspace_id = ? AND project_id = ?')
    .run(Date.now(), String(workspaceId || ''), String(projectId || ''));
  return { ok: true };
}

/** 判断访问者是否拥有指定操作角色和额外能力；reviewer/viewer 即使被写入标志也绝不获得支出与导出能力。 */
function canAccess(access, roles = PROJECT_ROLES, capability = '') {
  if (!access || !access.active || !roles.has(String(access.role || ''))) return false;
  if (capability === 'spend') {
    if (access.role === 'reviewer' || access.role === 'viewer') return false;
    if (Number(access.can_spend) !== 1) return false;
  }
  if (capability === 'export') {
    if (access.role === 'reviewer' || access.role === 'viewer') return false;
    if (Number(access.can_export) !== 1) return false;
  }
  return true;
}

/** 返回旧小说接口可用的稳定作用域摘要，供响应和审计关联使用。 */
function scopePublic(access) {
  if (!access) return null;
  const isLimited = access.role === 'reviewer' || access.role === 'viewer';
  return {
    workspaceId: access.workspace_id,
    projectId: access.project_id,
    role: access.role,
    canSpend: !isLimited && Number(access.can_spend) === 1,
    canExport: !isLimited && Number(access.can_export) === 1,
    aclVersion: Number(access.acl_revision) || 1
  };
}

module.exports = {
  WORKSPACE_ROLES,
  PROJECT_ROLES,
  WRITE_ROLES,
  DELETE_ROLES,
  stableUserId,
  personalWorkspaceId,
  initializeSchema,
  ensureUserWorkspace,
  ensureNovelProject,
  migrateExistingScopes,
  getNovelAccess,
  getWorkspaceAccess,
  createWorkspace,
  listWorkspaceMembers,
  upsertWorkspaceMember,
  deactivateWorkspaceMember,
  listAccessibleProjects,
  upsertProjectMember,
  deactivateProjectMember,
  canAccess,
  scopePublic
};
