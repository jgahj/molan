'use strict';

const crypto = require('node:crypto');
const projectMaterialSchema = require('./project-material-schema');

const RESOURCE_TYPES = new Set([
  'profile', 'worldbuilding', 'world-rule', 'culture', 'history-event', 'power-system',
  'character', 'relation', 'item', 'ability', 'term', 'outline', 'storyline',
  'plot-node', 'scene', 'event', 'place', 'faction', 'calendar', 'foreshadow', 'timeline',
  'material', 'highlight', 'writing-task', 'issue', 'manuscript', 'publication'
]);

/** 创作全套资料七大板块分类映射 */
const RESOURCE_CATEGORIES = Object.freeze({
  basic_positioning: ['profile'],
  worldbuilding: ['worldbuilding', 'place', 'faction', 'calendar', 'world-rule', 'culture', 'history-event', 'power-system'],
  characters: ['character', 'relation'],
  plot_outlines: ['outline', 'storyline', 'plot-node', 'scene'],
  special_materials: ['item', 'ability', 'term', 'material', 'highlight', 'foreshadow'],
  writing_management: ['timeline', 'writing-task', 'issue', 'manuscript'],
  publication: ['publication']
});
const RESOURCE_FIELD_TYPES = Object.freeze({
  profile: { title: 'string', subtitle: 'string', penName: 'string', genre: 'string', theme: 'string', tone: 'string', targetReader: 'string', sellingPoints: 'string', completionPlan: 'string', shortSynopsis: 'string', longSynopsis: 'string', targetWordCount: 'number', targetChapterCount: 'number' },
  worldbuilding: { title: 'string', era: 'string', fundamentalRules: 'string', geography: 'json', factions: 'json', calendar: 'json', specialRules: 'string' },
  place: { name: 'string', parentId: 'id', region: 'string', terrain: 'string', climate: 'string', description: 'string', coordinates: 'json', travelEdges: 'json' },
  faction: { name: 'string', goals: 'json', resources: 'json', members: 'json', description: 'string', status: 'string' },
  calendar: { name: 'string', definition: 'json', eras: 'json', units: 'json', origin: 'string' },
  culture: { title: 'string', customs: 'string', law: 'string', currency: 'string', language: 'string', religion: 'string', classSystem: 'string' },
  'history-event': { title: 'string', storyTime: 'string', description: 'string', consequences: 'string', sourceRefs: 'json' },
  'power-system': { title: 'string', levels: 'json', ceiling: 'string', limits: 'string', costs: 'string', progression: 'string', applicability: 'string', notApplicable: 'boolean', notApplicableReason: 'string' },
  storyline: { title: 'string', kind: 'string', goal: 'string', milestones: 'json', ending: 'string', continuityId: 'id' },
  manuscript: { title: 'string', kind: 'string', chapterId: 'id', continuityId: 'id', canonApplicability: 'string', numberingPolicy: 'string', text: 'string' },
  publication: { title: 'string', coverCopy: 'string', tags: 'array', category: 'string', chapterTitlePlan: 'string', readerInteraction: 'string', plotPreview: 'string', completionNote: 'string', extrasPlan: 'string' },
  character: { name: 'string', role: 'string', age: 'stringOrNumber', appearance: 'string', personality: 'string', goals: 'string', arc: 'string', voice: 'string', notes: 'string', identity: 'string', strengths: 'string', flaws: 'string', obsession: 'string', boundary: 'string', family: 'string', trauma: 'string', abilities: 'json', equipment: 'json', appearanceOrder: 'json' },
  relation: { sourceId: 'id', targetId: 'id', relationType: 'string', status: 'string', storyTime: 'string', description: 'string' },
  'world-rule': { name: 'string', rule: 'string', limit: 'string', consequence: 'string', scope: 'string', sourceRefs: 'array' },
  foreshadow: { title: 'string', plantPlan: 'string', payoffPlan: 'string', status: 'string', setupChapter: 'id', targetChapter: 'id', evidence: 'array', deferralReason: 'string' },
  timeline: { title: 'string', storyTime: 'string', narrativeOrder: 'number', recordedAt: 'string', timezone: 'string', description: 'string', sourceRefs: 'array' },
  'writing-task': { title: 'string', status: 'string', chapterId: 'id', blocker: 'string', nextAction: 'string', assigneeId: 'id' },
  issue: { title: 'string', severity: 'string', status: 'string', description: 'string', evidenceRefs: 'array', affectedRefs: 'array', resolution: 'string' },
  item: { name: 'string', ownerId: 'id', placeId: 'id', state: 'string', notes: 'string' },
  ability: { name: 'string', effect: 'string', preconditions: 'string', cost: 'string', limit: 'string', systemId: 'id' },
  term: { canonicalName: 'string', aliases: 'array', definition: 'string', scope: 'string', disambiguation: 'string' },
  material: { title: 'string', placeId: 'id', weather: 'string', timeCondition: 'string', povCondition: 'string', text: 'string' },
  highlight: { title: 'string', text: 'string', speakerId: 'id', sceneId: 'id', usageStatus: 'string', source: 'string' },
  scene: { title: 'string', placeId: 'id', povId: 'id', storyTime: 'string', goal: 'string', conflict: 'string', stateChange: 'string' },
  'plot-node': { title: 'string', kind: 'string', parentId: 'id', goal: 'string', obstacle: 'string', result: 'string', chapterRange: 'string', wordCount: 'number', events: 'json', climax: 'string', highlights: 'json', castIds: 'array', foreshadowActions: 'json', endingMode: 'string', hook: 'string', transition: 'string' },
  outline: { title: 'string', premise: 'string', mainline: 'string', endingPromise: 'string' },
  event: { title: 'string', storyTime: 'string', description: 'string', participants: 'array', sourceRefs: 'array' }
});
const RESOURCE_ENUMS = Object.freeze({
  manuscript: { kind: ['chapter', 'extra', 'afterword'] },
  foreshadow: { status: ['planned', 'planted', 'reinforced', 'partial', 'resolved', 'abandoned'] },
  'writing-task': { status: ['planned', 'drafting', 'review', 'blocked', 'done'] },
  issue: { severity: ['info', 'warning', 'blocker'], status: ['open', 'in_review', 'resolved', 'wont_fix'] },
  highlight: { usageStatus: ['unused', 'planned', 'used'] }
});
const READ_ROLES = new Set(['owner', 'admin', 'editor', 'reviewer', 'viewer']);
const WRITE_ROLES = new Set(['owner', 'admin', 'editor']);
const REVIEW_WRITE_TYPES = new Set(['issue']);

/** 创建带项目复合主键和不可变版本的结构化资料表。 */
function initializeSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS project_resources (
    workspace_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    id TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    revision INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    PRIMARY KEY (workspace_id, project_id, id),
    UNIQUE (workspace_id, project_id, kind, id),
    FOREIGN KEY (workspace_id, project_id) REFERENCES novel_projects(workspace_id, project_id)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS project_resource_versions (
    workspace_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    changed_by TEXT NOT NULL,
    change_reason TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, project_id, resource_id, revision),
    FOREIGN KEY (workspace_id, project_id, resource_id)
      REFERENCES project_resources(workspace_id, project_id, id)
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_project_resources_kind ON project_resources(workspace_id, project_id, kind, status, updated_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_project_resource_versions ON project_resource_versions(workspace_id, project_id, resource_id, revision DESC)');
}

/** 校验资源类型，防止通用路由被用作任意表名执行器。 */
function normalizeKind(kind) {
  const value = String(kind || '').trim().toLowerCase();
  if (!RESOURCE_TYPES.has(value)) {
    const error = new Error('不支持的资料类型');
    error.code = 'resource_kind_invalid';
    error.status = 422;
    throw error;
  }
  return value;
}

/** 生成资源ID；调用方有稳定ID时优先保留，缺失时由内容和时间生成。 */
function normalizeId(value, kind) {
  const candidate = String(value || '').trim();
  if (candidate) {
    if (candidate.length > 160 || /[\u0000-\u001f\u007f]/.test(candidate)) {
      const error = new Error('资料 ID 格式无效');
      error.code = 'resource_id_invalid';
      error.status = 422;
      throw error;
    }
    return candidate;
  }
  return `${kind}_${crypto.randomUUID().replace(/-/g, '')}`;
}

/** 校验结构化资料负载，支持题材不适用理由强制校验与拒绝空对象。 */
function invalidPayload(message, code = 'resource_payload_invalid') {
  const error = new Error(message);
  error.code = code;
  error.status = 422;
  return error;
}

function matchesFieldType(value, type) {
  if (type === 'string') return typeof value === 'string';
  if (type === 'id') return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
  if (type === 'stringOrNumber') return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'array') return Array.isArray(value);
  if (type === 'json') return value !== null && typeof value === 'object';
  return true;
}

function normalizePayload(payload, access = null, kind = '') {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw invalidPayload('资料负载必须是 JSON 对象');
  }
  const schema = RESOURCE_FIELD_TYPES[kind] || {};
  for (const [field, type] of Object.entries(schema)) {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) continue;
    if (!matchesFieldType(payload[field], type)) {
      throw invalidPayload(`资料字段 ${field} 类型无效，应为 ${type}`, 'resource_field_type_invalid');
    }
  }
  for (const [field, allowedValues] of Object.entries(RESOURCE_ENUMS[kind] || {})) {
    if (payload[field] !== undefined && !allowedValues.includes(payload[field])) {
      throw invalidPayload(`资料字段 ${field} 的取值无效`, 'resource_field_value_invalid');
    }
  }
  try {
    projectMaterialSchema.validatePayload(kind, payload);
  } catch (error) {
    throw invalidPayload(error.message || '资料字段无效', error.code || 'requirement_field_invalid');
  }
  if (payload.notApplicable === true) {
    if (!payload.notApplicableReason || typeof payload.notApplicableReason !== 'string' || !payload.notApplicableReason.trim()) {
      throw invalidPayload('题材不适用字段必须提供明确不适用理由', 'NOT_APPLICABLE_REASON_REQUIRED');
    }
  }
  if (access) {
    const projectId = String(access.project_id || access.project_legacy_id || access.project_uuid || '');
    const workspaceId = String(access.workspace_id || access.workspace_legacy_id || access.workspace_uuid || '');
    const inspectScope = value => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (child && (key === 'projectId' || key === 'targetProjectId') && String(child) !== projectId) {
          throw invalidPayload('禁止跨项目引用资料', 'REFERENCE_CROSS_PROJECT_FORBIDDEN');
        }
        if (child && (key === 'workspaceId' || key === 'targetWorkspaceId') && String(child) !== workspaceId) {
          throw invalidPayload('禁止跨工作区引用资料', 'REFERENCE_CROSS_WORKSPACE_FORBIDDEN');
        }
        inspectScope(child);
      }
    };
    inspectScope(payload);
  }
  return payload;
}

function validateResourceReferences(db, access, payload, kind = '') {
  const referenceKeys = /(?:^references?$|Refs$|^parentRef$|^targetRef$)/i;
  const projectId = access.project_id;
  const workspaceId = access.workspace_id;
  function visit(value, inReference) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(item => visit(item, inReference));
      return;
    }
    const refKind = String(value.resourceKind || value.kind || '').trim().toLowerCase();
    const refId = String(value.resourceId || value.id || '').trim();
    if (inReference && refId && RESOURCE_TYPES.has(refKind)) {
      const exists = db.prepare(`SELECT 1 FROM project_resources
        WHERE workspace_id = ? AND project_id = ? AND kind = ? AND id = ? AND deleted_at IS NULL`)
        .get(workspaceId, projectId, refKind, refId);
      if (!exists) throw invalidPayload(`项目内资料引用不存在或已归档：${refKind}/${refId}`, 'REFERENCE_NOT_FOUND');
    }
    for (const [key, child] of Object.entries(value)) visit(child, inReference || referenceKeys.test(key));
  }
  visit(payload, false);
  const requirementKind = kind ? normalizeKind(kind) : '';
  const references = requirementKind ? projectMaterialSchema.collectReferences(payload, requirementKind) : [];
  for (const reference of references) {
    const target = db.prepare(`SELECT kind FROM project_resources
      WHERE workspace_id = ? AND project_id = ? AND id = ? AND deleted_at IS NULL`)
      .get(workspaceId, projectId, reference.id);
    if (!target || reference.kind && target.kind !== reference.kind) {
      throw invalidPayload(`项目内资料引用不存在或类型不匹配：${reference.kind || '*'} / ${reference.id}`, 'REFERENCE_NOT_FOUND');
    }
  }
}

/** 将数据库行转换为安全的资源对象。 */
function publicResource(row) {
  let payload = {};
  try { payload = JSON.parse(row.payload_json || '{}'); } catch (_) {}
  return {
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    id: row.id,
    kind: row.kind,
    revision: Number(row.revision) || 1,
    status: row.status,
    payload,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null,
    etag: `"resource-${row.id}-${Number(row.revision) || 1}"`
  };
}

/** 判断当前项目角色能否修改指定资料类型。 */
function canMutate(access, kind) {
  if (!access || !access.active) return false;
  if (WRITE_ROLES.has(String(access.role || ''))) return true;
  return String(access.role || '') === 'reviewer' && REVIEW_WRITE_TYPES.has(kind);
}

/** 列出指定项目的资料，默认隐藏软删除记录。 */
function listResources(db, scope, kind, includeDeleted = false) {
  const normalizedKind = normalizeKind(kind);
  const rows = db.prepare(`SELECT * FROM project_resources
    WHERE workspace_id = ? AND project_id = ? AND kind = ?
      AND (? = 1 OR deleted_at IS NULL)
    ORDER BY updated_at DESC, id ASC`).all(scope.workspaceId, scope.projectId, normalizedKind, includeDeleted ? 1 : 0);
  return rows.map(publicResource);
}

/** 创建资源并写入首个不可变版本。 */
function createResource(db, access, kind, payload, actorId, id, reason) {
  const normalizedKind = normalizeKind(kind);
  if (!canMutate(access, normalizedKind)) return { ok: false, code: 'forbidden' };
  const resourceId = normalizeId(id, normalizedKind);
  const now = Date.now();
  let serialized;
  try {
    const normalizedPayload = normalizePayload(payload, access, normalizedKind);
    validateResourceReferences(db, access, normalizedPayload, normalizedKind);
    serialized = JSON.stringify(normalizedPayload);
  } catch (error) {
    return { ok: false, code: error.code || 'resource_payload_invalid' };
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO project_resources
      (workspace_id, project_id, id, kind, payload_json, revision, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, 'active', ?, ?, ?)`)
      .run(access.workspace_id, access.project_id, resourceId, normalizedKind, serialized, actorId, now, now);
    db.prepare(`INSERT INTO project_resource_versions
      (workspace_id, project_id, resource_id, revision, payload_json, changed_by, change_reason, created_at)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?)`)
      .run(access.workspace_id, access.project_id, resourceId, serialized, actorId, String(reason || '创建资料'), now);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    if (String(error && error.message || '').includes('UNIQUE')) return { ok: false, code: 'resource_conflict' };
    throw error;
  }
  return { ok: true, resource: getResource(db, access, normalizedKind, resourceId) };
}

/** 按项目和类型读取单条资料，防止跨项目ID碰撞。 */
function getResource(db, access, kind, id, includeDeleted = false) {
  const normalizedKind = normalizeKind(kind);
  const row = db.prepare(`SELECT * FROM project_resources
    WHERE workspace_id = ? AND project_id = ? AND kind = ? AND id = ?
      AND (? = 1 OR deleted_at IS NULL)`).get(access.workspace_id, access.project_id, normalizedKind, String(id || ''), includeDeleted ? 1 : 0);
  return row ? publicResource(row) : null;
}

function publicVersion(row) {
  let payload = {};
  try { payload = JSON.parse(row.payload_json || '{}'); } catch (_) {}
  return {
    revision: Number(row.revision) || 1,
    payload,
    changedBy: row.changed_by,
    changeReason: row.change_reason || '',
    createdAt: row.created_at
  };
}

/** 读取同一项目、同一资源的不可变版本；已归档资源也保留可读历史。 */
function listResourceVersions(db, access, kind, id, limit = 100) {
  const normalizedKind = normalizeKind(kind);
  if (!access || !access.active || !READ_ROLES.has(String(access.role || ''))) return null;
  const resourceId = String(id || '');
  const exists = db.prepare(`SELECT 1 FROM project_resources
    WHERE workspace_id = ? AND project_id = ? AND kind = ? AND id = ?`)
    .get(access.workspace_id, access.project_id, normalizedKind, resourceId);
  if (!exists) return null;
  const pageSize = Math.max(1, Math.min(200, Math.floor(Number(limit) || 100)));
  return db.prepare(`SELECT revision, payload_json, changed_by, change_reason, created_at
    FROM project_resource_versions
    WHERE workspace_id = ? AND project_id = ? AND resource_id = ?
    ORDER BY revision DESC LIMIT ?`)
    .all(access.workspace_id, access.project_id, resourceId, pageSize).map(publicVersion);
}

/** 将指定历史负载作为新版本恢复，使用当前revision做CAS且不覆盖旧版本。 */
function restoreResourceVersion(db, access, kind, id, targetRevision, expectedRevision, actorId, reason) {
  const normalizedKind = normalizeKind(kind);
  if (!canMutate(access, normalizedKind)) return { ok: false, code: 'forbidden' };
  const expected = Number(expectedRevision);
  const target = Number(targetRevision);
  if (!Number.isInteger(expected) || expected < 1) return { ok: false, code: 'revision_required' };
  if (!Number.isInteger(target) || target < 1) return { ok: false, code: 'history_revision_invalid' };
  const resourceId = String(id || '');
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = db.prepare(`SELECT * FROM project_resources
      WHERE workspace_id = ? AND project_id = ? AND kind = ? AND id = ?`)
      .get(access.workspace_id, access.project_id, normalizedKind, resourceId);
    if (!current) {
      db.exec('ROLLBACK');
      return { ok: false, code: 'resource_missing' };
    }
    if (Number(current.revision) !== expected) {
      db.exec('ROLLBACK');
      return { ok: false, code: 'revision_conflict', current: publicResource(current) };
    }
    const historical = db.prepare(`SELECT payload_json FROM project_resource_versions
      WHERE workspace_id = ? AND project_id = ? AND resource_id = ? AND revision = ?`)
      .get(access.workspace_id, access.project_id, resourceId, target);
    if (!historical) {
      db.exec('ROLLBACK');
      return { ok: false, code: 'resource_version_missing' };
    }
    let payload;
    try {
      payload = normalizePayload(JSON.parse(historical.payload_json), access, normalizedKind);
      validateResourceReferences(db, access, payload, normalizedKind);
    } catch (error) {
      db.exec('ROLLBACK');
      return { ok: false, code: error.code || 'resource_payload_invalid' };
    }
    const serialized = JSON.stringify(payload);
    const nextRevision = expected + 1;
    const now = Date.now();
    const changed = db.prepare(`UPDATE project_resources
      SET payload_json = ?, status = 'active', revision = ?, deleted_at = NULL, updated_at = ?
      WHERE workspace_id = ? AND project_id = ? AND kind = ? AND id = ? AND revision = ?`)
      .run(serialized, nextRevision, now, access.workspace_id, access.project_id, normalizedKind, resourceId, expected);
    if (Number(changed.changes || 0) !== 1) {
      db.exec('ROLLBACK');
      return { ok: false, code: 'revision_conflict' };
    }
    db.prepare(`INSERT INTO project_resource_versions
      (workspace_id, project_id, resource_id, revision, payload_json, changed_by, change_reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(access.workspace_id, access.project_id, resourceId, nextRevision, serialized, actorId,
        String(reason || `恢复历史版本 v${target}`), now);
    db.exec('COMMIT');
    return { ok: true, resource: getResource(db, access, normalizedKind, resourceId) };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }
}

/** 使用强制revision进行局部更新，旧版本不覆盖新资料。 */
function updateResource(db, access, kind, id, payload, expectedRevision, actorId, reason) {
  const normalizedKind = normalizeKind(kind);
  if (!canMutate(access, normalizedKind)) return { ok: false, code: 'forbidden' };
  const expected = Number(expectedRevision);
  if (!Number.isInteger(expected) || expected < 1) return { ok: false, code: 'revision_required' };
  const current = db.prepare(`SELECT * FROM project_resources
    WHERE workspace_id = ? AND project_id = ? AND kind = ? AND id = ? AND deleted_at IS NULL`)
    .get(access.workspace_id, access.project_id, normalizedKind, String(id || ''));
  if (!current) return { ok: false, code: 'resource_missing' };
  if (Number(current.revision) !== expected) return { ok: false, code: 'revision_conflict', current: publicResource(current) };
  const nextRevision = expected + 1;
  let serialized;
  try {
    const normalizedPayload = normalizePayload(payload, access, normalizedKind);
    validateResourceReferences(db, access, normalizedPayload, normalizedKind);
    serialized = JSON.stringify(normalizedPayload);
  } catch (error) {
    return { ok: false, code: error.code || 'resource_payload_invalid' };
  }
  const now = Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = db.prepare(`UPDATE project_resources
      SET payload_json = ?, revision = ?, updated_at = ?
      WHERE workspace_id = ? AND project_id = ? AND kind = ? AND id = ? AND revision = ? AND deleted_at IS NULL`)
      .run(serialized, nextRevision, now, access.workspace_id, access.project_id, normalizedKind, String(id || ''), expected);
    if (Number(result.changes || 0) !== 1) {
      db.exec('ROLLBACK');
      return { ok: false, code: 'revision_conflict' };
    }
    db.prepare(`INSERT INTO project_resource_versions
      (workspace_id, project_id, resource_id, revision, payload_json, changed_by, change_reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(access.workspace_id, access.project_id, String(id || ''), nextRevision, serialized, actorId, String(reason || '更新资料'), now);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }
  return { ok: true, resource: getResource(db, access, normalizedKind, id) };
}

/** 软删除资料并保留历史，删除前由服务层完成引用影响检查。 */
function deleteResource(db, access, kind, id, expectedRevision, actorId, reason) {
  const normalizedKind = normalizeKind(kind);
  if (!canMutate(access, normalizedKind)) return { ok: false, code: 'forbidden' };
  const expected = Number(expectedRevision);
  if (!Number.isInteger(expected) || expected < 1) return { ok: false, code: 'revision_required' };
  const now = Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = db.prepare(`UPDATE project_resources
      SET status = 'deleted', deleted_at = ?, revision = revision + 1, updated_at = ?
      WHERE workspace_id = ? AND project_id = ? AND kind = ? AND id = ? AND revision = ? AND deleted_at IS NULL`)
      .run(now, now, access.workspace_id, access.project_id, normalizedKind, String(id || ''), expected);
    if (Number(result.changes || 0) !== 1) {
      db.exec('ROLLBACK');
      return { ok: false, code: 'revision_conflict' };
    }
    const current = db.prepare('SELECT * FROM project_resources WHERE workspace_id = ? AND project_id = ? AND id = ?')
      .get(access.workspace_id, access.project_id, String(id || ''));
    db.prepare(`INSERT INTO project_resource_versions
      (workspace_id, project_id, resource_id, revision, payload_json, changed_by, change_reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(access.workspace_id, access.project_id, String(id || ''), current.revision, current.payload_json, actorId, String(reason || '删除资料'), now);
    db.exec('COMMIT');
    return { ok: true, resource: publicResource(current) };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }
}

/** 恢复软删除资料并追加新版本，不覆盖原历史。 */
function restoreResource(db, access, kind, id, expectedRevision, actorId, reason) {
  const normalizedKind = normalizeKind(kind);
  if (!canMutate(access, normalizedKind)) return { ok: false, code: 'forbidden' };
  const expected = Number(expectedRevision);
  if (!Number.isInteger(expected) || expected < 1) return { ok: false, code: 'revision_required' };
  const now = Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = db.prepare(`UPDATE project_resources
      SET status = 'active', deleted_at = NULL, revision = revision + 1, updated_at = ?
      WHERE workspace_id = ? AND project_id = ? AND kind = ? AND id = ? AND revision = ? AND deleted_at IS NOT NULL`)
      .run(now, access.workspace_id, access.project_id, normalizedKind, String(id || ''), expected);
    if (Number(result.changes || 0) !== 1) {
      db.exec('ROLLBACK');
      return { ok: false, code: 'revision_conflict' };
    }
    const current = db.prepare('SELECT * FROM project_resources WHERE workspace_id = ? AND project_id = ? AND id = ?')
      .get(access.workspace_id, access.project_id, String(id || ''));
    db.prepare(`INSERT INTO project_resource_versions
      (workspace_id, project_id, resource_id, revision, payload_json, changed_by, change_reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(access.workspace_id, access.project_id, String(id || ''), current.revision, current.payload_json, actorId, String(reason || '恢复资料'), now);
    db.exec('COMMIT');
    return { ok: true, resource: publicResource(current) };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }
}

module.exports = {
  RESOURCE_TYPES,
  RESOURCE_CATEGORIES,
  RESOURCE_FIELD_TYPES,
  projectMaterialSchema,
  READ_ROLES,
  WRITE_ROLES,
  REVIEW_WRITE_TYPES,
  initializeSchema,
  normalizeKind,
  normalizePayload,
  publicResource,
  canMutate,
  listResources,
  createResource,
  getResource,
  listResourceVersions,
  restoreResourceVersion,
  validateResourceReferences,
  updateResource,
  deleteResource,
  restoreResource
};
