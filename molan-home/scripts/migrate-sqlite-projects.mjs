import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');
const projectScope = require('../lib/project-scope.js');
const projectPackage = require('../lib/project-package.js');
const { createPostgresRepository } = require('../lib/postgres-repository.js');

/** 解析旧库迁移参数，默认只读盘点，不执行目标库写入。 */
function parseArguments(argv) {
  const result = { apply: false, source: '', report: '', backup: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--apply') result.apply = true;
    else if (value === '--source') result.source = argv[++index] || '';
    else if (value === '--report') result.report = argv[++index] || '';
    else if (value === '--backup') result.backup = argv[++index] || '';
  }
  return result;
}

/** 拒绝把受保护原文目录误当作迁移源。 */
function assertAllowedSource(sourcePath) {
  const normalized = path.resolve(sourcePath).toLowerCase();
  const protectedNames = ['\\books\\', '\\raws\\', '\\deploy_tmp\\', '\\tmp-booktest\\'];
  if (protectedNames.some(name => normalized.includes(name))) {
    throw new Error('迁移源位于受保护原文目录，已拒绝执行');
  }
}

/** 读取 JSON 状态并保留解析失败原因，不把坏数据静默变为空对象。 */
function parseState(value) {
  try {
    const state = JSON.parse(String(value || '{}'));
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('state必须是对象');
    return { state, error: '' };
  } catch (error) {
    return { state: null, error: String(error && error.message || 'state解析失败') };
  }
}

/** 读取旧表中的任意 JSON 列，保留无效文本的错误状态。 */
function parseLegacyJson(value, fallback) {
  try {
    return { value: JSON.parse(String(value ?? JSON.stringify(fallback))), error: '' };
  } catch (error) {
    return { value: fallback, error: String(error && error.message || 'JSON解析失败') };
  }
}

/** 为旧创作表准备统一的项目级迁移容器。 */
function emptyCreationMigrationData() {
  return {
    books: [],
    bibles: [],
    bibleVersions: [],
    snapshots: [],
    audits: [],
    jobs: [],
    legacyPayloads: []
  };
}

/** 生成项目级分组键，避免同一旧项目 ID 在不同工作区互相覆盖。 */
function migrationProjectKey(workspaceId, projectId) {
  return `${String(workspaceId || '')}\u0000${String(projectId || '')}`;
}

/** 根据旧行的稳定用户字段解析迁移归属，不根据显示名或近似邮箱合并。 */
function resolveLegacyOwner(row, accountByEmail, accountByUserId) {
  const rowUserId = String(row && (row.owner_user_id || row.user_id) || '').trim();
  const email = String(row && (row.user_email || row.email) || '').trim().toLowerCase();
  const account = accountByUserId.get(rowUserId) || accountByEmail.get(email);
  return {
    userId: rowUserId || String(account && account.user_id || '').trim() || (email ? projectScope.stableUserId(email) : ''),
    email,
    account
  };
}

/** 将旧记录挂入已有项目或创建仅用于恢复的合成项目，避免未归属数据静默丢失。 */
function ensureLegacyProject(projects, projectByKey, input) {
  const ownerUserId = String(input.ownerUserId || '').trim();
  if (!ownerUserId) return null;
  let workspaceId = String(input.workspaceId || '').trim() || projectScope.personalWorkspaceId(ownerUserId);
  let projectId = String(input.projectId || '').trim();
  const exact = projectId ? projectByKey.get(migrationProjectKey(workspaceId, projectId)) : null;
  if (exact) return exact;
  const fallback = projectId
    ? projects.find(project => project.projectId === projectId && project.ownerUserId === ownerUserId)
    : null;
  if (fallback) return fallback;
  if (!projectId) projectId = `n_legacy_${ownerUserId.replace(/[^A-Za-z0-9]/g, '').slice(0, 40) || 'owner'}`;
  workspaceId = workspaceId || projectScope.personalWorkspaceId(ownerUserId);
  const synthetic = {
    projectId,
    workspaceId,
    ownerUserId,
    ownerEmail: String(input.ownerEmail || '').trim().toLowerCase(),
    ownerKnown: true,
    ownerName: String(input.ownerName || '').trim(),
    title: String(input.title || '历史数据恢复项目').trim() || '历史数据恢复项目',
    revision: 0,
    state: {
      title: String(input.title || '历史数据恢复项目').trim() || '历史数据恢复项目',
      migrationSource: String(input.migrationSource || 'sqlite-legacy')
    },
    stateError: '',
    sourceHash: '',
    resources: [],
    members: [],
    creation: emptyCreationMigrationData(),
    synthetic: true
  };
  projects.push(synthetic);
  projectByKey.set(migrationProjectKey(workspaceId, projectId), synthetic);
  return synthetic;
}

/** 从旧 SQLite 的创作、任务和用量表按项目分组，完整记录无法建模的原始行。 */
function loadLegacyCreationData(database, projects, accountByEmail, accountByUserId) {
  const projectByKey = new Map();
  for (const project of projects) {
    project.creation = project.creation || emptyCreationMigrationData();
    projectByKey.set(migrationProjectKey(project.workspaceId, project.projectId), project);
  }
  const sourceProjectCount = projects.length;
  const unassigned = [];
  const unassignedRecords = [];
  const bookContextById = new Map();
  const bibleContextById = new Map();
  const recordUnassigned = (sourceKind, legacyId, payload) => {
    const summary = { sourceKind, legacyId: String(legacyId || '') };
    unassigned.push(summary);
    unassignedRecords.push({ ...summary, payload });
  };

  const attachLegacyRecord = (project, sourceKind, legacyId, payload) => {
    if (!project || !legacyId) {
      recordUnassigned(sourceKind, legacyId, payload);
      return;
    }
    project.creation.legacyPayloads.push({ sourceKind, legacyId: String(legacyId), payload });
  };
  const projectForBook = row => {
    const owner = resolveLegacyOwner(row, accountByEmail, accountByUserId);
    const requestedProjectId = String(row && (row.project_id || row.novel_id) || '').trim();
    const ownerProject = requestedProjectId
      ? projects.find(project => project.projectId === requestedProjectId && project.ownerUserId === owner.userId)
      : null;
    const workspaceId = String(row && row.workspace_id || '').trim() || String(ownerProject && ownerProject.workspaceId || '') || projectScope.personalWorkspaceId(owner.userId);
    const projectId = requestedProjectId || `n_creation_${String(row && row.id || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 48)}`;
    return ensureLegacyProject(projects, projectByKey, {
      workspaceId,
      projectId,
      ownerUserId: owner.userId,
      ownerEmail: owner.email,
      ownerName: owner.account && owner.account.name,
      title: String(row && row.title || '历史创作书'),
      migrationSource: 'creation-book'
    });
  };

  if (tableExists(database, 'creation_books')) {
    const rows = database.prepare('SELECT * FROM creation_books ORDER BY updated_at ASC, id ASC').all();
    for (const row of rows) {
      const project = projectForBook(row);
      const owner = resolveLegacyOwner(row, accountByEmail, accountByUserId);
      const plan = parseLegacyJson(row.plan_json, {});
      const book = {
        id: String(row.id || ''),
        title: String(row.title || ''),
        bibleId: String(row.bible_id || ''),
        sourceBriefId: String(row.source_brief_id || ''),
        currentStateVersion: Number(row.current_state_version) || 0,
        currentChapterNo: Number(row.current_chapter_no) || 0,
        status: String(row.status || 'draft'),
        visibility: String(row.visibility || 'private'),
        budgetLimit: Number(row.budget_limit) || 0,
        spentCost: Number(row.spent_cost) || 0,
        ownerUserId: owner.userId,
        createdAt: Number(row.created_at) || 0,
        updatedAt: Number(row.updated_at) || 0,
        plan: plan.value,
        planError: plan.error,
        raw: row
      };
      if (!project || !book.id || plan.error) {
        if (project) attachLegacyRecord(project, 'creation-book', book.id, row);
        continue;
      }
      project.creation.books.push(book);
      bookContextById.set(book.id, { project, book });
      attachLegacyRecord(project, 'creation-book', book.id, row);
    }
  }

  if (tableExists(database, 'creation_bibles')) {
    const rows = database.prepare('SELECT * FROM creation_bibles ORDER BY updated_at ASC, id ASC').all();
    for (const row of rows) {
      const context = bookContextById.get(String(row.book_id || ''));
      if (!context) {
        recordUnassigned('creation-bible', row.id, row);
        continue;
      }
      const bible = {
        id: String(row.id || ''),
        bibleId: String(row.id || ''),
        bookId: context.book.id,
        currentVersion: Number(row.current_version) || 0,
        status: String(row.status || 'draft'),
        createdAt: Number(row.created_at) || 0,
        updatedAt: Number(row.updated_at) || 0,
        raw: row
      };
      context.project.creation.bibles.push(bible);
      bibleContextById.set(bible.bibleId, context);
      attachLegacyRecord(context.project, 'creation-bible', bible.id, row);
    }
  }

  if (tableExists(database, 'creation_bible_versions')) {
    const rows = database.prepare('SELECT * FROM creation_bible_versions ORDER BY bible_id ASC, version ASC, id ASC').all();
    for (const row of rows) {
      const context = bibleContextById.get(String(row.bible_id || ''));
      if (!context) {
        recordUnassigned('creation-bible-version', row.id, row);
        continue;
      }
      const payload = parseLegacyJson(row.payload_json, {});
      const version = {
        id: String(row.id || ''),
        bibleId: String(row.bible_id || ''),
        bookId: context.book.id,
        version: Number(row.version) || 0,
        payload: payload.value,
        payloadError: payload.error,
        payloadHash: String(row.payload_hash || ''),
        sourceBriefId: String(row.source_brief_id || ''),
        parentVersion: Number(row.parent_version) || 0,
        changeSummary: String(row.change_summary || ''),
        createdByUserId: resolveLegacyOwner(row, accountByEmail, accountByUserId).userId,
        createdAt: Number(row.created_at) || 0,
        raw: row
      };
      context.project.creation.bibleVersions.push(version);
      attachLegacyRecord(context.project, 'creation-bible-version', version.id, row);
    }
  }

  if (tableExists(database, 'creation_state_snapshots')) {
    const rows = database.prepare('SELECT * FROM creation_state_snapshots ORDER BY book_id ASC, state_version ASC, id ASC').all();
    const jsonFields = [
      ['character_states_json', 'characterStates', {}],
      ['relationship_states_json', 'relationshipStates', {}],
      ['world_states_json', 'worldStates', {}],
      ['timeline_json', 'timeline', []],
      ['open_foreshadows_json', 'openForeshadows', []],
      ['recent_facts_json', 'recentFacts', []]
    ];
    for (const row of rows) {
      const context = bookContextById.get(String(row.book_id || ''));
      if (!context) {
        recordUnassigned('creation-state-snapshot', row.id, row);
        continue;
      }
      const payload = {
        chapterNo: Number(row.chapter_no) || 0,
        contentRef: String(row.content_ref || ''),
        contentHash: String(row.content_hash || ''),
        auditStatus: String(row.audit_status || 'draft')
      };
      let payloadError = '';
      for (const [column, key, fallback] of jsonFields) {
        const parsed = parseLegacyJson(row[column], fallback);
        payload[key] = parsed.value;
        if (parsed.error) payloadError = `${column}: ${parsed.error}`;
      }
      const snapshot = {
        id: String(row.id || ''),
        bookId: context.book.id,
        bibleVersion: Number(row.bible_version) || 0,
        stateVersion: Number(row.state_version) || 0,
        payload,
        payloadError,
        createdByUserId: String(row.actor_user_id || '').trim() || context.book.ownerUserId,
        createdAt: Number(row.created_at) || 0,
        raw: row
      };
      context.project.creation.snapshots.push(snapshot);
      attachLegacyRecord(context.project, 'creation-state-snapshot', snapshot.id, row);
    }
  }

  if (tableExists(database, 'creation_chapter_audits')) {
    const rows = database.prepare('SELECT * FROM creation_chapter_audits ORDER BY book_id ASC, created_at ASC, id ASC').all();
    for (const row of rows) {
      const context = bookContextById.get(String(row.book_id || ''));
      if (!context) {
        recordUnassigned('creation-chapter-audit', row.id, row);
        continue;
      }
      const result = parseLegacyJson(row.result_json, {});
      const audit = {
        id: String(row.id || ''),
        bookId: context.book.id,
        chapterNo: Number(row.chapter_no) || 0,
        contentHash: String(row.content_hash || ''),
        passed: Number(row.passed) === 1,
        qualityGate: String(row.quality_gate || ''),
        originalityStatus: String(row.originality_status || ''),
        blockerCount: Number(row.blocker_count) || 0,
        result: result.value,
        resultError: result.error,
        createdByUserId: String(row.actor_user_id || '').trim() || context.book.ownerUserId,
        createdAt: Number(row.created_at) || 0,
        status: String(row.status || ''),
        raw: row
      };
      context.project.creation.audits.push(audit);
      attachLegacyRecord(context.project, 'creation-chapter-audit', audit.id, row);
    }
  }

  if (tableExists(database, 'creation_core_jobs')) {
    const rows = database.prepare('SELECT * FROM creation_core_jobs ORDER BY updated_at ASC, id ASC').all();
    for (const row of rows) {
      const context = bookContextById.get(String(row.book_id || ''));
      const owner = resolveLegacyOwner(row, accountByEmail, accountByUserId);
      const project = context && context.project || ensureLegacyProject(projects, projectByKey, {
        workspaceId: String(row.workspace_id || '').trim() || projectScope.personalWorkspaceId(owner.userId),
        projectId: String(row.project_id || '').trim() || `n_legacy_job_${String(row.id || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 40)}`,
        ownerUserId: owner.userId,
        ownerEmail: owner.email,
        title: String(row.title || '历史创书任务'),
        migrationSource: 'creation-core-job'
      });
      if (!project) {
        recordUnassigned('creation-core-job', row.id, row);
        continue;
      }
      const job = {
        id: String(row.id || ''),
        bookId: context ? context.book.id : String(row.book_id || ''),
        userId: String(row.user_id || '').trim() || owner.userId,
        modelId: String(row.model_id || ''),
        title: String(row.title || ''),
        genre: String(row.genre || ''),
        status: String(row.status || ''),
        receivedChars: Number(row.received_chars) || 0,
        startedAt: Number(row.started_at) || 0,
        updatedAt: Number(row.updated_at) || 0,
        error: String(row.error || ''),
        code: String(row.code || ''),
        bibleVersion: Number(row.bible_version) || 0,
        creditCost: row.credit_cost == null ? null : Number(row.credit_cost),
        raw: row
      };
      project.creation.jobs.push(job);
      attachLegacyRecord(project, 'creation-core-job', job.id, row);
    }
  }

  const loadUsage = (tableName, sourceKind, idColumn) => {
    if (!tableExists(database, tableName)) return;
    const rows = database.prepare('SELECT * FROM ' + tableName + ' ORDER BY created_at ASC, ' + idColumn + ' ASC').all();
    for (const row of rows) {
      const owner = resolveLegacyOwner(
        sourceKind === 'model-usage' && !row.user_email
          ? { ...row, user_email: tokenOwnerByRequest.get(String(row.request_id || '')) || '' }
          : row,
        accountByEmail,
        accountByUserId
      );
      const requestedProjectId = String(row.project_id || '').trim();
      const existingProject = requestedProjectId
        ? projects.find(project => project.projectId === requestedProjectId && project.ownerUserId === owner.userId)
        : null;
      const project = ensureLegacyProject(projects, projectByKey, {
        workspaceId: String(row.workspace_id || '').trim() || String(existingProject && existingProject.workspaceId || '') || projectScope.personalWorkspaceId(owner.userId),
        projectId: requestedProjectId || `n_legacy_usage_${owner.userId.replace(/[^A-Za-z0-9]/g, '').slice(0, 40) || 'owner'}`,
        ownerUserId: owner.userId,
        ownerEmail: owner.email,
        title: '历史模型用量归档',
        migrationSource: sourceKind
      });
      if (!project) {
        recordUnassigned(sourceKind, row[idColumn], row);
        continue;
      }
      attachLegacyRecord(project, sourceKind, String(row[idColumn] || ''), row);
    }
  };
  const tokenOwnerByRequest = new Map();
  if (tableExists(database, 'token_usage')) {
    database.prepare('SELECT request_id, user_email FROM token_usage').all().forEach(row => {
      tokenOwnerByRequest.set(String(row.request_id || ''), String(row.user_email || '').trim().toLowerCase());
    });
  }
  loadUsage('token_usage', 'token-usage', 'request_id');
  loadUsage('model_usage', 'model-usage', 'request_id');

  return {
    sourceProjectCount,
    syntheticProjectCount: Math.max(0, projects.length - sourceProjectCount),
    unassigned,
    unassignedRecords
  };
}

/** 移除 PG 读取时生成的通用资料投影字段，避免迁移重跑误报 state 冲突。 */
function stripDerivedResourceProjection(state) {
  const nextState = JSON.parse(JSON.stringify(state && typeof state === 'object' ? state : {}));
  delete nextState.projectResources;
  return nextState;
}

/** 计算排除派生资料投影后的旧项目哈希，用于安全重跑和冲突判断。 */
function migrationStateHash(state) {
  return projectPackage.sha256(stripDerivedResourceProjection(state));
}

/** 判断源 state 是否已有某资料的正文表示，避免把数据库派生资源误报为源数据冲突。 */
function stateContainsResource(state, resource) {
  const resourceId = String(resource && resource.id || '');
  if (!resourceId) return false;
  if (resource.kind === 'character') {
    return Boolean(state && state.knowledge && state.knowledge.entities && !Array.isArray(state.knowledge.entities) && state.knowledge.entities[resourceId]);
  }
  if (resource.kind === 'relation') return Boolean(state && state.knowledge && Array.isArray(state.knowledge.edges) && state.knowledge.edges.some(item => item && item.id === resourceId));
  if (resource.kind === 'foreshadow') return Boolean(Array.isArray(state && state.foreshadows) && state.foreshadows.some(item => item && item.id === resourceId));
  if (resource.kind === 'timeline') return Boolean(Array.isArray(state && state.timeline) && state.timeline.some(item => item && item.id === resourceId));
  const assetKeys = { worldbuilding: 'worldbuilding', 'world-rule': 'worldRules', culture: 'cultures', 'history-event': 'history', 'power-system': 'powerSystems', item: 'items', ability: 'abilities', term: 'terms', material: 'materials', highlight: 'highlights', 'writing-task': 'writingTasks', issue: 'issues' };
  const assetKey = assetKeys[resource.kind];
  return Boolean(assetKey && state && state.creationAssets && Array.isArray(state.creationAssets[assetKey]) && state.creationAssets[assetKey].some(item => item && item.id === resourceId));
}

/** 比较迁移目标读取的 state 与源 state，单独忽略明确的数据库派生资源投影。 */
function migrationStateMatches(existingState, sourceState, resources) {
  const comparableExisting = stripDerivedResourceProjection(existingState);
  const comparableSource = stripDerivedResourceProjection(sourceState);
  const sourceResourceList = Array.isArray(resources) ? resources : [];
  const removeById = (list, resourceId) => Array.isArray(list) ? list.filter(item => !item || item.id !== resourceId) : list;
  const assetKeys = { worldbuilding: 'worldbuilding', 'world-rule': 'worldRules', culture: 'cultures', 'history-event': 'history', 'power-system': 'powerSystems', item: 'items', ability: 'abilities', term: 'terms', material: 'materials', highlight: 'highlights', 'writing-task': 'writingTasks', issue: 'issues' };
  for (const resource of sourceResourceList) {
    if (stateContainsResource(sourceState, resource)) continue;
    const resourceId = String(resource && resource.id || '');
    if (resource.kind === 'character' && comparableExisting.knowledge && comparableExisting.knowledge.entities) delete comparableExisting.knowledge.entities[resourceId];
    if (resource.kind === 'relation' && comparableExisting.knowledge) comparableExisting.knowledge.edges = removeById(comparableExisting.knowledge.edges, resourceId);
    if (resource.kind === 'foreshadow') comparableExisting.foreshadows = removeById(comparableExisting.foreshadows, resourceId);
    if (resource.kind === 'timeline') comparableExisting.timeline = removeById(comparableExisting.timeline, resourceId);
    if (assetKeys[resource.kind] && comparableExisting.creationAssets) comparableExisting.creationAssets[assetKeys[resource.kind]] = removeById(comparableExisting.creationAssets[assetKeys[resource.kind]], resourceId);
  }
  const removeEmptyProjectionContainers = state => {
    if (state.knowledge && state.knowledge.entities && Object.keys(state.knowledge.entities).length === 0) delete state.knowledge.entities;
    if (state.knowledge && Array.isArray(state.knowledge.edges) && state.knowledge.edges.length === 0) delete state.knowledge.edges;
    if (state.knowledge && Object.keys(state.knowledge).length === 0) delete state.knowledge;
    if (state.creationAssets && Object.keys(state.creationAssets).length === 0) delete state.creationAssets;
  };
  removeEmptyProjectionContainers(comparableExisting);
  removeEmptyProjectionContainers(comparableSource);
  return migrationStateHash(comparableExisting) === migrationStateHash(comparableSource);
}

/** 判断旧 SQLite 表是否存在，以兼容早期没有资料表的数据库。 */
function tableExists(database, tableName) {
  return Boolean(database.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`
  ).get(tableName));
}

/** 读取旧项目、资料和成员，不执行任何写操作。 */
function loadLegacyProjects(sourcePath) {
  const database = new DatabaseSync(sourcePath);
  try {
    const accounts = tableExists(database, 'accounts')
      ? database.prepare('SELECT * FROM accounts').all()
      : [];
    const accountByEmail = new Map(accounts.map(account => [
      String(account.email || '').trim().toLowerCase(),
      account
    ]));
    const accountByUserId = new Map(accounts.map(account => [
      String(account.user_id || '').trim(),
      account
    ]));
    const novels = tableExists(database, 'novels') ? database.prepare('SELECT * FROM novels ORDER BY updated_at ASC, id ASC').all() : [];
    const hasResources = tableExists(database, 'project_resources');
    const hasMembers = tableExists(database, 'project_members');
    const projects = [];
    for (const novel of novels) {
      const email = String(novel.user_email || '').trim().toLowerCase();
      const account = accountByEmail.get(email);
      const ownerUserId = String(novel.owner_user_id || '').trim() || projectScope.stableUserId(email);
      const projectId = String(novel.project_id || novel.id || '').trim();
      const workspaceId = String(novel.workspace_id || projectScope.personalWorkspaceId(ownerUserId)).trim();
      const parsed = parseState(novel.state_json);
      const item = {
        projectId,
        workspaceId,
        ownerUserId,
        ownerEmail: email,
        title: String(novel.title || '未命名小说'),
        revision: Number(novel.revision) || 0,
        state: parsed.state,
        stateError: parsed.error,
        sourceHash: '',
        resources: [],
        members: [],
        creation: emptyCreationMigrationData(),
        synthetic: false
      };
      if (hasResources) {
        const rows = database.prepare(
          `SELECT * FROM project_resources
           WHERE workspace_id = ? AND project_id = ?
           ORDER BY kind ASC, updated_at ASC, id ASC`
        ).all(workspaceId, projectId);
        item.resources = rows.map(row => {
          const payload = parseState(row.payload_json);
          return {
            id: String(row.id || ''),
            kind: String(row.kind || '').trim().toLowerCase(),
            revision: Number(row.revision) || 1,
            status: String(row.status || 'active'),
            payload: payload.state,
            payloadError: payload.error
          };
        });
      }
      item.sourceHash = parsed.state ? migrationStateHash(parsed.state) : '';
      if (hasMembers) {
        const rows = database.prepare(
          `SELECT user_id, role, active, can_spend, can_export
           FROM project_members
           WHERE workspace_id = ? AND project_id = ?
           ORDER BY created_at ASC`
        ).all(workspaceId, projectId);
        item.members = rows.map(row => {
          const userId = String(row.user_id || '').trim();
          const memberAccount = accountByUserId.get(userId);
          return {
            userId: userId || (memberAccount ? projectScope.stableUserId(memberAccount.email) : ''),
            role: String(row.role || 'viewer'),
            active: Number(row.active) === 1,
            canSpend: Number(row.can_spend) === 1,
            canExport: Number(row.can_export) === 1
          };
        }).filter(member => member.userId && member.active);
      }
      projects.push({
        ...item,
        ownerKnown: Boolean(account || email),
        ownerName: account && account.name || ''
      });
    }
    const creationSummary = loadLegacyCreationData(database, projects, accountByEmail, accountByUserId);
    return {
      sourcePath,
      sourceBytes: fs.statSync(sourcePath).size,
      accountCount: accounts.length,
      projects,
      sourceProjectCount: creationSummary.sourceProjectCount,
      syntheticProjectCount: creationSummary.syntheticProjectCount,
      unassignedLegacy: creationSummary.unassigned,
      unassignedLegacyRecords: creationSummary.unassignedRecords
    };
  } finally {
    database.close();
  }
}

/** 复制旧库备份，备份已存在时拒绝覆盖，确保回退点不可被静默替换。 */
function createBackup(sourcePath, backupPath) {
  const target = path.resolve(backupPath);
  if (fs.existsSync(target)) throw new Error('备份目标已存在，拒绝覆盖：' + target);
  fs.copyFileSync(sourcePath, target);
  return { path: target, bytes: fs.statSync(target).size };
}

/** 判断目标资料是否与源资料完全一致，避免重复迁移增加无意义版本。 */
function sameResource(existing, source) {
  if (!existing) return false;
  return existing.status === source.status &&
    projectPackage.sha256(existing.payload || {}) === projectPackage.sha256(source.payload || {});
}

/** 将单个旧项目迁移到 PG；冲突只记录并跳过，不覆盖目标已有修改。 */
async function migrateProject(repository, project) {
  const result = {
    projectId: project.projectId,
    workspaceId: project.workspaceId,
    state: 'pending',
    resources: { created: 0, skipped: 0, conflicts: 0, invalid: 0 },
    members: { created: 0, skipped: 0, conflicts: 0 },
    creation: {
      books: { created: 0, skipped: 0, conflicts: 0, invalid: 0 },
      bibleVersions: { created: 0, skipped: 0, conflicts: 0, invalid: 0 },
      snapshots: { created: 0, skipped: 0, conflicts: 0, invalid: 0 },
      audits: { created: 0, skipped: 0, conflicts: 0, invalid: 0 },
      jobs: { created: 0, skipped: 0, conflicts: 0, invalid: 0 }
    },
    legacyPayloads: { created: 0, skipped: 0, conflicts: 0, invalid: 0 },
    conflicts: [],
    errors: []
  };
  if (!project.projectId || !project.ownerUserId) {
    result.state = 'invalid';
    result.errors.push('项目缺少稳定 projectId 或 ownerUserId');
    return result;
  }
  if (project.stateError || !project.state) {
    result.state = 'invalid';
    result.errors.push(project.stateError || 'state不存在');
    return result;
  }
  const existing = await repository.getProfile(project.ownerUserId, project.projectId, project.workspaceId);
  if (!existing) {
    await repository.saveProfile({
      userId: project.ownerUserId,
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      title: project.title,
      state: project.state,
      wordCount: 0
    });
    result.state = 'created';
  } else if (migrationStateMatches(existing.state || {}, project.state, project.resources)) {
    result.state = 'skipped';
  } else {
    result.state = 'conflict';
    result.conflicts.push({
      type: 'profile',
      reason: '目标项目已有不同 state，未覆盖',
      sourceHash: migrationStateHash(project.state),
      targetHash: migrationStateHash(existing.state || {}),
      resourceCount: Array.isArray(project.resources) ? project.resources.length : -1
    });
    return result;
  }
  for (const sourceResource of project.resources) {
    if (!sourceResource.id || !sourceResource.kind || sourceResource.payloadError || !sourceResource.payload) {
      result.resources.invalid += 1;
      result.errors.push(`资料 ${sourceResource.id || '(无ID)'} 负载无效`);
      continue;
    }
    const existingResource = await repository.listResources(
      project.ownerUserId,
      project.projectId,
      sourceResource.kind,
      sourceResource.id,
      project.workspaceId,
      true
    );
    if (!existingResource) {
      await repository.createResource({
        userId: project.ownerUserId,
        workspaceId: project.workspaceId,
        projectId: project.projectId,
        kind: sourceResource.kind,
        id: sourceResource.id,
        payload: sourceResource.payload,
        status: sourceResource.status,
        changeReason: '旧 SQLite 项目迁移'
      });
      result.resources.created += 1;
    } else if (sameResource(existingResource, sourceResource)) {
      result.resources.skipped += 1;
    } else {
      result.resources.conflicts += 1;
      result.conflicts.push({ type: 'resource', id: sourceResource.id, kind: sourceResource.kind, reason: '目标资料已有不同版本，未覆盖' });
    }
  }
  for (const member of project.members) {
    if (!member.userId || member.userId === project.ownerUserId || !['admin', 'editor', 'reviewer', 'viewer'].includes(member.role)) continue;
    try {
      await repository.upsertWorkspaceMember(project.ownerUserId, project.workspaceId, member.userId, 'member');
      await repository.upsertProjectMember(
        project.ownerUserId,
        project.workspaceId,
        project.projectId,
        member.userId,
        member.role,
        member.canSpend,
        member.canExport,
        false,
        null
      );
      result.members.created += 1;
    } catch (error) {
      result.members.conflicts += 1;
      result.conflicts.push({ type: 'member', userId: member.userId, reason: String(error && error.message || '成员迁移失败') });
    }
  }
  const creation = project.creation || emptyCreationMigrationData();
  if (creation.books.length || creation.bibles.length || creation.bibleVersions.length ||
      creation.snapshots.length || creation.audits.length || creation.jobs.length || creation.legacyPayloads.length) {
    const imported = await repository.importLegacyProjectData({
      userId: project.ownerUserId,
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      creationBooks: creation.books,
      creationBibles: creation.bibles,
      creationBibleVersions: creation.bibleVersions,
      creationStateSnapshots: creation.snapshots,
      creationChapterAudits: creation.audits,
      creationCoreJobs: creation.jobs,
      legacyPayloads: creation.legacyPayloads
    });
    result.creation = {
      books: imported.books,
      bibleVersions: imported.bibleVersions,
      snapshots: imported.snapshots,
      audits: imported.audits,
      jobs: imported.jobs
    };
    result.legacyPayloads = imported.legacyPayloads;
    result.conflicts.push(...imported.conflicts);
    result.errors.push(...imported.errors);
  }
  return result;
}

/** 生成只读迁移报告，包含数量、哈希和可回退信息，不包含正文内容。 */
function summarizeReport(input, options, backup, results, fatalError = '') {
  const totals = results.reduce((summary, item) => {
    summary.projects += 1;
    if (item.state === 'created') summary.created += 1;
    if (item.state === 'skipped') summary.skipped += 1;
    if (item.state === 'conflict') summary.conflicts += 1;
    if (item.state === 'invalid') summary.invalid += 1;
    summary.resourceCreated += item.resources.created;
    summary.resourceSkipped += item.resources.skipped;
    summary.resourceConflicts += item.resources.conflicts;
    summary.resourceInvalid += item.resources.invalid;
    summary.memberCreated += item.members.created;
    summary.memberConflicts += item.members.conflicts;
    for (const key of ['books', 'bibleVersions', 'snapshots', 'audits', 'jobs']) {
      summary.creation[key].created += item.creation[key].created;
      summary.creation[key].skipped += item.creation[key].skipped;
      summary.creation[key].conflicts += item.creation[key].conflicts;
      summary.creation[key].invalid += item.creation[key].invalid;
    }
    summary.legacyPayloads.created += item.legacyPayloads.created;
    summary.legacyPayloads.skipped += item.legacyPayloads.skipped;
    summary.legacyPayloads.conflicts += item.legacyPayloads.conflicts;
    summary.legacyPayloads.invalid += item.legacyPayloads.invalid;
    return summary;
  }, {
    projects: 0, created: 0, skipped: 0, conflicts: 0, invalid: 0,
    resourceCreated: 0, resourceSkipped: 0, resourceConflicts: 0, resourceInvalid: 0,
    memberCreated: 0, memberConflicts: 0,
    creation: {
      books: { created: 0, skipped: 0, conflicts: 0, invalid: 0 },
      bibleVersions: { created: 0, skipped: 0, conflicts: 0, invalid: 0 },
      snapshots: { created: 0, skipped: 0, conflicts: 0, invalid: 0 },
      audits: { created: 0, skipped: 0, conflicts: 0, invalid: 0 },
      jobs: { created: 0, skipped: 0, conflicts: 0, invalid: 0 }
    },
    legacyPayloads: { created: 0, skipped: 0, conflicts: 0, invalid: 0 }
  });
  return {
    format: 'molan-sqlite-project-migration-report',
    version: 2,
    mode: options.apply ? 'apply' : 'dry-run',
    source: {
      path: input.sourcePath,
      bytes: input.sourceBytes,
      accounts: input.accountCount,
      projects: input.sourceProjectCount || input.projects.length,
      syntheticProjects: input.syntheticProjectCount || 0,
      unassignedLegacy: Array.isArray(input.unassignedLegacy) ? input.unassignedLegacy.length : 0
    },
    backup,
    totals,
    projects: results,
    fatalError,
    generatedAt: new Date().toISOString()
  };
}

/** 将无法安全推断旧归属的行放入无人可登录的隔离项目，保留待人工认领而不错误归属。 */
async function quarantineUnassignedLegacy(repository, input, apply) {
  const records = Array.isArray(input.unassignedLegacyRecords) ? input.unassignedLegacyRecords : [];
  const summary = {
    pending: records.length,
    stored: 0,
    skipped: 0,
    conflicts: 0,
    invalid: 0,
    projectId: 'n_legacy_quarantine',
    workspaceId: 'ws_legacy_quarantine'
  };
  if (!apply || !records.length) return summary;
  for (const record of records) {
    const sourceKind = String(record && record.sourceKind || '').trim();
    const legacyId = String(record && record.legacyId || '').trim();
    if (!sourceKind || !legacyId) {
      summary.invalid += 1;
      continue;
    }
    try {
      const saved = await repository.storeLegacyPayload({
        userId: 'migration-unassigned',
        workspaceId: summary.workspaceId,
        projectId: summary.projectId,
        title: '未归属旧数据隔离区',
        sourceKind,
        legacyId,
        payload: record.payload
      });
      if (saved.idempotent) summary.skipped += 1;
      else summary.stored += 1;
    } catch (error) {
      if (String(error && error.code || '') === 'legacy_payload_conflict') summary.conflicts += 1;
      else summary.invalid += 1;
    }
  }
  return summary;
}

/** 执行旧库到 PG 的 dry-run 或显式本地迁移。 */
async function main() {
  const options = parseArguments(process.argv.slice(2));
  const sourcePath = path.resolve(options.source || process.env.MOLAN_SQLITE_PATH || path.join(process.cwd(), 'data', 'molan.db'));
  if (!fs.existsSync(sourcePath)) throw new Error('SQLite迁移源不存在：' + sourcePath);
  assertAllowedSource(sourcePath);
  const input = loadLegacyProjects(sourcePath);
  const reportPath = path.resolve(options.report || path.join(os.tmpdir(), `molan-sqlite-migration-${Date.now()}.json`));
  let backup = null;
  if (options.apply) {
    if (process.env.MOLAN_ALLOW_LOCAL_DATA_MIGRATION !== '1') {
      throw new Error('执行迁移必须显式设置 MOLAN_ALLOW_LOCAL_DATA_MIGRATION=1');
    }
    backup = createBackup(sourcePath, options.backup || `${sourcePath}.backup-${Date.now()}`);
  }
  const results = [];
  let repository = null;
  try {
    if (options.apply) {
      repository = createPostgresRepository(process.env);
      if (!repository.enabled) throw new Error('未配置 PostgreSQL 目标');
      await repository.initialize();
      for (const project of input.projects) {
        try {
          results.push(await migrateProject(repository, project));
        } catch (error) {
          results.push({
            projectId: project.projectId,
            workspaceId: project.workspaceId,
            state: 'error',
            resources: { created: 0, skipped: 0, conflicts: 0, invalid: 0 },
            members: { created: 0, skipped: 0, conflicts: 0 },
            creation: {
              books: { created: 0, skipped: 0, conflicts: 0, invalid: 0 },
              bibleVersions: { created: 0, skipped: 0, conflicts: 0, invalid: 0 },
              snapshots: { created: 0, skipped: 0, conflicts: 0, invalid: 0 },
              audits: { created: 0, skipped: 0, conflicts: 0, invalid: 0 },
              jobs: { created: 0, skipped: 0, conflicts: 0, invalid: 0 }
            },
            legacyPayloads: { created: 0, skipped: 0, conflicts: 0, invalid: 0 },
            conflicts: [],
            errors: [String(error && error.message || '项目迁移失败')]
          });
        }
      }
    } else {
      for (const project of input.projects) {
        results.push({
          projectId: project.projectId,
          workspaceId: project.workspaceId,
          state: project.stateError ? 'invalid' : 'ready',
          resources: {
            created: 0,
            skipped: 0,
            conflicts: 0,
            invalid: project.resources.filter(resource => resource.payloadError || !resource.id || !resource.kind).length
          },
          members: { created: 0, skipped: 0, conflicts: 0 },
          creation: {
            books: { created: 0, skipped: 0, conflicts: 0, invalid: project.creation.books.filter(book => book.planError || !book.id).length },
            bibleVersions: { created: 0, skipped: 0, conflicts: 0, invalid: project.creation.bibleVersions.filter(version => version.payloadError || !version.id).length },
            snapshots: { created: 0, skipped: 0, conflicts: 0, invalid: project.creation.snapshots.filter(snapshot => snapshot.payloadError || !snapshot.id).length },
            audits: { created: 0, skipped: 0, conflicts: 0, invalid: project.creation.audits.filter(audit => audit.resultError || !audit.id).length },
            jobs: { created: 0, skipped: 0, conflicts: 0, invalid: project.creation.jobs.filter(job => !job.id).length }
          },
          legacyPayloads: { created: 0, skipped: 0, conflicts: 0, invalid: project.creation.legacyPayloads.filter(record => !record.legacyId || !record.sourceKind).length },
          conflicts: [],
          errors: project.stateError ? [project.stateError] : []
        });
      }
    }
    const quarantine = await quarantineUnassignedLegacy(repository, input, options.apply);
    const report = summarizeReport(input, options, backup, results);
    report.quarantine = quarantine;
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    process.stdout.write(JSON.stringify({ ok: true, report: reportPath, totals: report.totals }) + '\n');
  } finally {
    if (repository) await repository.close();
  }
}

main().catch(error => {
  process.stderr.write(JSON.stringify({
    ok: false,
    code: String(error && error.code || 'sqlite_migration_failed'),
    error: String(error && error.message || 'SQLite项目迁移失败')
  }) + '\n');
  process.exitCode = 1;
});
