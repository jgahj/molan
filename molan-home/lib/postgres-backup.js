'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const BACKUP_KINDS = new Set(['daily', 'migration', 'predeploy']);

function connectionDetails(config = {}) {
  let source = config;
  if (config.connectionString) {
    const url = new URL(String(config.connectionString));
    source = {
      host: url.hostname,
      port: url.port || 5432,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.replace(/^\//, '')),
      sslmode: url.searchParams.get('sslmode') || '',
      ssl: config.ssl
    };
  }
  const details = {
    host: String(source.host || '127.0.0.1'),
    port: String(Number(source.port) || 5432),
    user: String(source.user || 'novel_runtime'),
    database: String(source.database || 'molan'),
    password: source.password == null ? '' : String(source.password),
    sslmode: String(source.sslmode || ((source.ssl || config.ssl) ? ((source.ssl || config.ssl).rejectUnauthorized === false ? 'require' : 'verify-full') : ''))
  };
  if (!details.database || /[\r\n]/u.test(details.database)) throw new Error('PostgreSQL database 配置无效');
  return details;
}

function pgToolEnvironment(config, base = process.env) {
  const details = connectionDetails(config);
  const environment = { ...base, PGHOST: details.host, PGPORT: details.port, PGUSER: details.user, PGDATABASE: details.database };
  if (details.password) environment.PGPASSWORD = details.password;
  else delete environment.PGPASSWORD;
  if (details.sslmode) environment.PGSSLMODE = details.sslmode;
  return environment;
}

function runPgTool(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: options.env || process.env, shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
    const stderr = [];
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
    child.once('error', error => reject(new Error(`${command} 无法启动：${error.code || 'spawn_failed'}`)));
    child.once('close', code => {
      if (code === 0) return resolve();
      const detail = Buffer.concat(stderr).toString('utf8').trim().slice(-1600);
      reject(new Error(`${command} 失败 (${code == null ? 'unknown' : code})${detail ? `：${detail}` : ''}`));
    });
  });
}

function buildDumpArgs(outputPath) {
  return ['--format=custom', '--no-owner', '--no-acl', '--file', String(outputPath)];
}

function buildRestoreArgs(database, dumpPath) {
  return ['--exit-on-error', '--single-transaction', '--no-owner', '--no-acl', '--dbname', String(database), String(dumpPath)];
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });
}

function safeTimestamp(value) {
  return new Date(value).toISOString().replace(/[:.]/g, '-');
}

async function createPostgresBackup({ config, backupDirectory, kind = 'daily', now = new Date(), runTool = runPgTool, environment = process.env } = {}) {
  if (!BACKUP_KINDS.has(kind)) throw new TypeError('Backup kind 必须为 daily、migration 或 predeploy');
  if (!String(backupDirectory || '').trim()) throw new Error('必须设置 MOLAN_PG_BACKUP_DIR');
  const root = path.resolve(String(backupDirectory));
  const projectRoot = path.resolve(__dirname, '..');
  const lexicalRoot = path.relative(projectRoot, root);
  if (lexicalRoot === '' || (!path.isAbsolute(lexicalRoot) && lexicalRoot !== '..' && !lexicalRoot.startsWith(`..${path.sep}`))) {
    throw new Error('PostgreSQL 备份目录必须位于项目 checkout 之外');
  }
  await fsp.mkdir(root, { recursive: true });
  const realRoot = await fsp.realpath(root);
  const relativeRoot = path.relative(projectRoot, realRoot);
  if (relativeRoot === '' || (!path.isAbsolute(relativeRoot) && relativeRoot !== '..' && !relativeRoot.startsWith(`..${path.sep}`))) {
    throw new Error('PostgreSQL 备份目录必须位于项目 checkout 之外');
  }
  const suffix = crypto.randomBytes(4).toString('hex');
  const baseName = `molan-postgres-${kind}-${safeTimestamp(now)}-${suffix}`;
  const outputPath = path.join(root, `${baseName}.dump`);
  const partialPath = `${outputPath}.partial`;
  const manifestPath = `${outputPath}.manifest.json`;
  const toolEnv = pgToolEnvironment(config, environment);
  const details = connectionDetails(config);
  try {
    await runTool('pg_dump', buildDumpArgs(partialPath), { env: toolEnv });
    const stats = await fsp.stat(partialPath);
    if (!stats.isFile() || stats.size < 1) throw new Error('pg_dump 输出为空');
    await runTool('pg_restore', ['--list', partialPath], { env: toolEnv });
    const sha256 = await hashFile(partialPath);
    await fsp.rename(partialPath, outputPath);
    const manifest = {
      schemaVersion: 'molan-postgres-backup-v1',
      kind,
      createdAt: new Date(now).toISOString(),
      format: 'pg_dump-custom',
      database: details.database,
      dumpFile: path.basename(outputPath),
      sizeBytes: stats.size,
      sha256
    };
    await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    return { outputPath, manifestPath, manifest };
  } catch (error) {
    await fsp.rm(partialPath, { force: true }).catch(() => {});
    await fsp.rm(outputPath, { force: true }).catch(() => {});
    await fsp.rm(manifestPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function readBackupManifest(dumpPath) {
  const absoluteDump = path.resolve(String(dumpPath || ''));
  const manifestPath = `${absoluteDump}.manifest.json`;
  const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 'molan-postgres-backup-v1' || manifest.dumpFile !== path.basename(absoluteDump)) {
    throw new Error('备份 manifest 与 dump 文件不匹配');
  }
  const stats = await fsp.stat(absoluteDump);
  if (!stats.isFile() || stats.size !== Number(manifest.sizeBytes)) throw new Error('备份文件大小与 manifest 不匹配');
  if (await hashFile(absoluteDump) !== manifest.sha256) throw new Error('备份文件 SHA-256 校验失败');
  return { dumpPath: absoluteDump, manifestPath, manifest };
}

async function restorePostgresBackupDrill({ dumpPath, targetConfig, runTool = runPgTool, environment = process.env, verifyDatabase } = {}) {
  const backup = await readBackupManifest(dumpPath);
  const target = connectionDetails(targetConfig);
  if (!/^molan_restore_drill_[a-z0-9_]+$/i.test(target.database)) {
    throw new Error('恢复演练目标数据库名必须以 molan_restore_drill_ 开头');
  }
  if (target.database === String(backup.manifest.database || '')) throw new Error('恢复演练目标不能与备份源数据库相同');
  const toolEnv = pgToolEnvironment(targetConfig, environment);
  await runTool('pg_restore', buildRestoreArgs(target.database, backup.dumpPath), { env: toolEnv });
  if (typeof verifyDatabase === 'function') await verifyDatabase(targetConfig);
  return { ok: true, database: target.database, dumpPath: backup.dumpPath, sha256: backup.manifest.sha256 };
}

module.exports = {
  BACKUP_KINDS,
  buildDumpArgs,
  buildRestoreArgs,
  connectionDetails,
  createPostgresBackup,
  pgToolEnvironment,
  readBackupManifest,
  restorePostgresBackupDrill,
  runPgTool
};
