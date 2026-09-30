import crypto from 'node:crypto';
import fs from 'node:fs';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');
const { Pool } = require('pg');
const projectPackage = require('../../lib/project-package.js');
const projectScope = require('../../lib/project-scope.js');
const { readConfig } = require('../../lib/postgres-repository.js');

/** 解析只读对账参数。 */
function parseArguments(argv) {
  const result = { source: '' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--source') result.source = argv[index + 1] || '';
    index += argv[index] === '--source' ? 1 : 0;
  }
  return result;
}

/** 判断旧 SQLite 表是否存在。 */
function tableExists(database, tableName) {
  return Boolean(database.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`
  ).get(tableName));
}

/** 读取旧表数量，不因可选表缺失中断对账。 */
function tableCount(database, tableName) {
  return tableExists(database, tableName)
    ? Number(database.prepare(`SELECT COUNT(*) AS n FROM ${tableName}`).get().n) || 0
    : 0;
}

/** 读取旧项目清单用于稳定作用域和 state 哈希对照。 */
function loadSourceProjects(database) {
  if (!tableExists(database, 'novels')) return [];
  return database.prepare('SELECT id, user_email, workspace_id, project_id, state_json FROM novels ORDER BY id').all().map(row => {
    const ownerUserId = projectScope.stableUserId(row.user_email);
    return {
      projectId: String(row.project_id || row.id),
      workspaceId: String(row.workspace_id || projectScope.personalWorkspaceId(ownerUserId)),
      ownerUserId,
      state: JSON.parse(String(row.state_json || '{}'))
    };
  });
}

/** 生成旧创作域的稳定记录数量和兼容负载分类预期。 */
function sourceSummary(database) {
  return {
    projects: tableCount(database, 'novels'),
    creationBooks: tableCount(database, 'creation_books'),
    creationBibles: tableCount(database, 'creation_bibles'),
    creationBibleVersions: tableCount(database, 'creation_bible_versions'),
    creationStateSnapshots: tableCount(database, 'creation_state_snapshots'),
    creationChapterAudits: tableCount(database, 'creation_chapter_audits'),
    creationCoreJobs: tableCount(database, 'creation_core_jobs'),
    tokenUsage: tableCount(database, 'token_usage'),
    modelUsage: tableCount(database, 'model_usage')
  };
}

/** 从 PostgreSQL 读取项目和创作域的脱敏对账结果。 */
async function reconcile(sourcePath) {
  if (!fs.existsSync(sourcePath)) throw new Error('SQLite 对账源不存在：' + sourcePath);
  const sourceDatabase = new DatabaseSync(sourcePath, { readOnly: true });
  const sourceProjects = loadSourceProjects(sourceDatabase);
  const sourceCounts = sourceSummary(sourceDatabase);
  const sourceBooks = tableExists(sourceDatabase, 'creation_books')
    ? sourceDatabase.prepare('SELECT id, bible_id FROM creation_books ORDER BY id').all()
    : [];
  const sourceVersions = tableExists(sourceDatabase, 'creation_bible_versions')
    ? sourceDatabase.prepare('SELECT id, bible_id, version FROM creation_bible_versions ORDER BY id').all()
    : [];
  const sourceSnapshots = tableExists(sourceDatabase, 'creation_state_snapshots')
    ? sourceDatabase.prepare('SELECT id FROM creation_state_snapshots ORDER BY id').all()
    : [];
  sourceDatabase.close();

  const environment = { ...process.env, MOLAN_PG_ENABLED: '1' };
  if (environment.MOLAN_PG_PASSWORD_FILE && !environment.MOLAN_PG_PASSWORD) {
    environment.MOLAN_PG_PASSWORD = fs.readFileSync(environment.MOLAN_PG_PASSWORD_FILE, 'utf8').trim();
  }
  const settings = readConfig(environment);
  if (!settings.enabled) throw new Error('未配置 PostgreSQL');
  const pool = new Pool(settings.config);
  const profileResult = await pool.query(
    `SELECT w.legacy_id AS workspace_id, p.legacy_id AS project_id, pp.payload
     FROM luna.project_profiles pp
     JOIN luna.projects p ON p.workspace_id = pp.workspace_id AND p.id = pp.project_id
     JOIN luna.workspaces w ON w.id = p.workspace_id`
  );
  const profileMap = new Map(profileResult.rows.map(row => [
    `${String(row.workspace_id)}\u0000${String(row.project_id)}`,
    row.payload
  ]));
  const mismatchProjects = [];
  for (const project of sourceProjects) {
    const target = profileMap.get(`${project.workspaceId}\u0000${project.projectId}`);
    if (!target || projectPackage.sha256(project.state) !== projectPackage.sha256(target)) {
      mismatchProjects.push(project.projectId);
    }
  }
  const targetCounts = {
    projects: Number((await pool.query('SELECT COUNT(*)::integer AS n FROM luna.projects')).rows[0].n) || 0,
    projectProfiles: Number((await pool.query('SELECT COUNT(*)::integer AS n FROM luna.project_profiles')).rows[0].n) || 0,
    creationBooks: Number((await pool.query('SELECT COUNT(*)::integer AS n FROM luna.creation_books')).rows[0].n) || 0,
    creationBibles: Number((await pool.query('SELECT COUNT(*)::integer AS n FROM luna.creation_bibles')).rows[0].n) || 0,
    contextSnapshots: Number((await pool.query('SELECT COUNT(*)::integer AS n FROM luna.context_snapshots')).rows[0].n) || 0,
    legacyPayloads: Number((await pool.query('SELECT COUNT(*)::integer AS n FROM luna.legacy_payloads')).rows[0].n) || 0
  };
  const legacyGroups = await pool.query(
    `SELECT source_kind, COUNT(*)::integer AS n
     FROM luna.legacy_payloads
     GROUP BY source_kind
     ORDER BY source_kind`
  );
  const creationChecks = {
    books: [],
    bibleVersions: [],
    snapshots: []
  };
  for (const book of sourceBooks) {
    const target = await pool.query(
      `SELECT cb.legacy_id, cb.project_id
       FROM luna.creation_books cb
       WHERE cb.legacy_id = $1::text`,
      [String(book.id)]
    );
    if (!target.rows.length) creationChecks.books.push(String(book.id));
  }
  for (const version of sourceVersions) {
    const target = await pool.query(
      `SELECT cb.legacy_id
       FROM luna.creation_bibles cb
       WHERE cb.legacy_id = $1::text AND cb.revision = $2::bigint`,
      [String(version.bible_id), Number(version.version)]
    );
    if (!target.rows.length) creationChecks.bibleVersions.push(String(version.id));
  }
  for (const snapshot of sourceSnapshots) {
    const target = await pool.query(
      `SELECT legacy_id
       FROM luna.context_snapshots
       WHERE legacy_id = $1::text`,
      [String(snapshot.id)]
    );
    if (!target.rows.length) creationChecks.snapshots.push(String(snapshot.id));
  }
  const expectedLegacyGroups = {
    'creation-book': sourceCounts.creationBooks,
    'creation-bible': sourceCounts.creationBibles,
    'creation-bible-version': sourceCounts.creationBibleVersions,
    'creation-state-snapshot': sourceCounts.creationStateSnapshots,
    'creation-chapter-audit': sourceCounts.creationChapterAudits,
    'creation-core-job': sourceCounts.creationCoreJobs,
    'token-usage': sourceCounts.tokenUsage,
    'model-usage': sourceCounts.modelUsage
  };
  const actualLegacyGroups = Object.fromEntries(legacyGroups.rows.map(row => [String(row.source_kind), Number(row.n) || 0]));
  const legacyGroupMismatches = Object.entries(expectedLegacyGroups)
    .filter(([sourceKind, count]) => Number(actualLegacyGroups[sourceKind] || 0) !== count)
    .map(([sourceKind, expected]) => ({ sourceKind, expected, actual: Number(actualLegacyGroups[sourceKind] || 0) }));
  await pool.end();
  return {
    ok: mismatchProjects.length === 0 &&
      creationChecks.books.length === 0 &&
      creationChecks.bibleVersions.length === 0 &&
      creationChecks.snapshots.length === 0 &&
      legacyGroupMismatches.length === 0,
    sourceCounts,
    targetCounts,
    profileChecked: sourceProjects.length,
    mismatchProjects,
    creationChecks,
    legacyGroupMismatches
  };
}

const argumentsValue = parseArguments(process.argv.slice(2));
const sourcePath = argumentsValue.source || process.env.MOLAN_SQLITE_PATH || '';
reconcile(sourcePath)
  .then(result => {
    process.stdout.write(JSON.stringify(result) + '\n');
    if (!result.ok) process.exitCode = 1;
  })
  .catch(error => {
    process.stderr.write(JSON.stringify({
      ok: false,
      code: String(error && error.code || 'postgres_migration_reconcile_failed'),
      error: String(error && error.message || 'PG 迁移对账失败')
    }) + '\n');
    process.exitCode = 1;
  });
