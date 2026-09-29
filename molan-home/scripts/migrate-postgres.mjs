import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const { readConfig } = require('../lib/postgres-repository.js');
const { createPostgresBackup } = require('../lib/postgres-backup.js');

const migrationsDirectory = path.resolve(import.meta.dirname, '..', 'db', 'migrations');

/** 解析迁移命令参数，默认只做不写库的状态检查。 */
function parseArguments(argv) {
  return {
    apply: argv.includes('--apply'),
    check: argv.includes('--check') || !argv.includes('--apply')
  };
}

/** 只允许本地目标执行迁移，避免误把本地命令指向线上数据库。 */
function assertLocalTarget(settings) {
  if (process.env.MOLAN_ALLOW_POSTGRES_MIGRATION !== '1') {
    throw new Error('执行迁移必须显式设置 MOLAN_ALLOW_POSTGRES_MIGRATION=1');
  }
  const connectionString = String(settings.config.connectionString || '').trim();
  const host = connectionString
    ? new URL(connectionString).hostname
    : String(settings.config.host || '127.0.0.1');
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  const normalizedHost = host.replace(/^\[|\]$/g, '').toLowerCase();
  const localSocketPath = normalizedHost === '/var/run/postgresql';
  if (!localHosts.has(normalizedHost) && !localSocketPath) {
    throw new Error('为保护线上数据，迁移脚本只接受本机 PostgreSQL 目标');
  }
}

/** 读取按数字前缀排序的 SQL 迁移文件。 */
function loadMigrations() {
  return fs.readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^\d+_.+\.sql$/i.test(entry.name))
    .map(entry => {
      const match = entry.name.match(/^(\d+)_/);
      const filePath = path.join(migrationsDirectory, entry.name);
      const sql = fs.readFileSync(filePath, 'utf8');
      return {
        version: entry.name.replace(/\.sql$/i, ''),
        order: Number(match[1]),
        file: entry.name,
        checksum: crypto.createHash('sha256').update(sql, 'utf8').digest('hex'),
        sql
      };
    })
    .sort((left, right) => left.order - right.order || left.file.localeCompare(right.file));
}

/** 查询已经登记的迁移版本，不把不存在的初始表误判为数据库故障。 */
async function readAppliedMigrations(client) {
  try {
    const result = await client.query('SELECT version, checksum, applied_at FROM luna.schema_migrations ORDER BY version');
    return new Map(result.rows.map(row => [String(row.version), row]));
  } catch (error) {
    if (String(error && error.code || '') === '42P01') return new Map();
    throw error;
  }
}

/** 执行单个自带事务边界的迁移，并在成功后登记校验和。 */
async function applyMigration(client, migration) {
  await client.query(migration.sql);
  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO luna.schema_migrations(version, checksum)
       VALUES ($1::text, $2::text)
       ON CONFLICT (version) DO UPDATE
       SET checksum = EXCLUDED.checksum, applied_at = now()`,
      [migration.version, migration.checksum]
    );
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  }
}

/** 检查迁移状态或在明确本地授权后应用迁移，输出不含凭据的结果摘要。 */
async function main() {
  const argumentsValue = parseArguments(process.argv.slice(2));
  const environment = { ...process.env, MOLAN_PG_ENABLED: '1' };
  if (environment.MOLAN_PG_PASSWORD_FILE && !environment.MOLAN_PG_PASSWORD) {
    environment.MOLAN_PG_PASSWORD = fs.readFileSync(environment.MOLAN_PG_PASSWORD_FILE, 'utf8').trim();
  }
  const settings = readConfig(environment);
  if (!settings.enabled) throw new Error('未配置 PostgreSQL，请设置 MOLAN_PG_URL 或 MOLAN_PG_DATABASE');
  if (argumentsValue.apply) assertLocalTarget(settings);
  const migrations = loadMigrations();
  const pool = new Pool(settings.config);
  const client = await pool.connect();
  const applied = [];
  const pending = [];
  try {
    let appliedMap = await readAppliedMigrations(client);
    const pendingMigrations = migrations.filter(migration => !appliedMap.has(migration.version));
    if (argumentsValue.apply && pendingMigrations.length) {
      const backup = await createPostgresBackup({
        config: settings.config,
        backupDirectory: process.env.MOLAN_PG_BACKUP_DIR,
        kind: 'migration'
      });
      process.stdout.write(JSON.stringify({ backup: backup.outputPath, sha256: backup.manifest.sha256 }) + '\n');
    }
    for (const migration of migrations) {
      const current = appliedMap.get(migration.version);
      if (current) {
        if (String(current.checksum) !== migration.checksum) {
          throw new Error(`迁移校验和不一致：${migration.version}`);
        }
        applied.push(migration.version);
        continue;
      }
      pending.push(migration.version);
      if (argumentsValue.apply) {
        await applyMigration(client, migration);
        appliedMap = await readAppliedMigrations(client);
        applied.push(migration.version);
      }
    }
    const tableResult = await client.query(
      `SELECT COUNT(*)::integer AS count
       FROM pg_tables
       WHERE schemaname = 'luna'`
    );
    process.stdout.write(JSON.stringify({
      ok: true,
      mode: argumentsValue.apply ? 'apply' : 'check',
      applied,
      pending: argumentsValue.apply ? [] : pending,
      tableCount: Number(tableResult.rows[0] && tableResult.rows[0].count) || 0
    }) + '\n');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => {
  process.stderr.write(JSON.stringify({
    ok: false,
    code: String(error && error.code || 'migration_failed'),
    error: String(error && error.message || 'PostgreSQL 迁移失败')
  }) + '\n');
  process.exitCode = 1;
});
