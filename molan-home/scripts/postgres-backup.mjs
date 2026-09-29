import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const { readConfig } = require('../lib/postgres-repository.js');
const { createPostgresBackup, restorePostgresBackupDrill } = require('../lib/postgres-backup.js');

function parseArguments(argv) {
  const [command = 'backup', ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--kind' && rest[i + 1]) options.kind = rest[++i];
    else if (rest[i] === '--dump' && rest[i + 1]) options.dump = rest[++i];
    else throw new Error(`未知参数：${rest[i]}`);
  }
  return { command, options };
}

function readTargetConfig(env) {
  const connectionString = String(env.MOLAN_PG_RESTORE_TARGET_URL || '').trim();
  const targetDatabase = String(env.MOLAN_PG_RESTORE_TARGET_DATABASE || '').trim();
  if (!connectionString && !targetDatabase) throw new Error('请设置 MOLAN_PG_RESTORE_TARGET_URL 或 MOLAN_PG_RESTORE_TARGET_DATABASE');
  const targetEnvironment = connectionString ? {
    ...env,
    MOLAN_PG_ENABLED: '1',
    MOLAN_PG_URL: connectionString,
    MOLAN_PG_SSL: env.MOLAN_PG_RESTORE_TARGET_SSL === '1' ? '1' : env.MOLAN_PG_SSL
  } : {
    ...env,
    MOLAN_PG_ENABLED: '1',
    MOLAN_PG_URL: '',
    MOLAN_PG_HOST: env.MOLAN_PG_RESTORE_TARGET_HOST || '127.0.0.1',
    MOLAN_PG_PORT: env.MOLAN_PG_RESTORE_TARGET_PORT || '5432',
    MOLAN_PG_DATABASE: env.MOLAN_PG_RESTORE_TARGET_DATABASE || '',
    MOLAN_PG_USER: env.MOLAN_PG_RESTORE_TARGET_USER || 'novel_runtime',
    MOLAN_PG_PASSWORD: env.MOLAN_PG_RESTORE_TARGET_PASSWORD || '',
    MOLAN_PG_PASSWORD_FILE: env.MOLAN_PG_RESTORE_TARGET_PASSWORD_FILE || ''
  };
  const settings = readConfig(targetEnvironment);
  if (!settings.enabled) throw new Error('未配置 PostgreSQL 恢复目标');
  return settings.config;
}

async function verifyRestoredDatabase(config) {
  const pool = new Pool(config);
  try {
    const result = await pool.query(`
      SELECT to_regclass('luna.schema_migrations') IS NOT NULL AS has_migrations,
             to_regclass('luna.projects') IS NOT NULL AS has_projects
    `);
    if (!result.rows[0]?.has_migrations || !result.rows[0]?.has_projects) {
      throw new Error('恢复演练未找到完整的 luna 核心表');
    }
    const migrations = await pool.query('SELECT COUNT(*)::integer AS count FROM luna.schema_migrations');
    if (Number(migrations.rows[0]?.count) < 1) throw new Error('恢复演练没有迁移记录');
  } finally {
    await pool.end();
  }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const { command, options } = parseArguments(argv);
  if (command === 'backup') {
    const settings = readConfig({ ...env, MOLAN_PG_ENABLED: '1' });
    if (!settings.enabled) throw new Error('未配置 PostgreSQL');
    const result = await createPostgresBackup({
      config: settings.config,
      backupDirectory: env.MOLAN_PG_BACKUP_DIR,
      kind: options.kind || 'daily'
    });
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
    return result;
  }
  if (command === 'restore-drill') {
    if (!options.dump) throw new Error('恢复演练必须通过 --dump 指定备份文件');
    const targetConfig = readTargetConfig(env);
    const result = await restorePostgresBackupDrill({ dumpPath: options.dump, targetConfig, verifyDatabase: verifyRestoredDatabase });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result;
  }
  if (command === 'help' || command === '--help') {
    process.stdout.write('用法：node scripts/postgres-backup.mjs backup --kind daily|migration|predeploy\n      node scripts/postgres-backup.mjs restore-drill --dump <backup.dump>\n');
    return null;
  }
  throw new Error(`未知命令：${command}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: String(error && error.message || 'PostgreSQL 运维命令失败') })}\n`);
    process.exitCode = 1;
  });
}
