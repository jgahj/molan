import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Pool } = require('pg');

/** 校验本地数据库角色名，防止把环境变量拼接成任意 SQL。 */
function quoteIdentifier(value) {
  const normalized = String(value || '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) throw new Error('角色名格式无效');
  return `"${normalized}"`;
}

/** 将密码转换为 SQL 字符串字面量，密码本身不会输出到终端。 */
function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** 读取连接密码文件，只在本进程内使用。 */
function readSecret(value, filePath) {
  if (value) return String(value);
  if (!filePath) return '';
  try { return fs.readFileSync(filePath, 'utf8').trim(); } catch (_) { return ''; }
}

/** 创建仅用于本机开发的非特权登录角色，并授予受限 novel_app 成员权限。 */
async function main() {
  const adminPassword = readSecret(process.env.MOLAN_PG_ADMIN_PASSWORD, process.env.MOLAN_PG_ADMIN_PASSWORD_FILE || process.env.MOLAN_PG_PASSWORD_FILE);
  const runtimeRole = String(process.env.MOLAN_PG_RUNTIME_LOGIN_ROLE || 'novel_runtime').trim();
  const grantedRole = String(process.env.MOLAN_PG_GRANTED_ROLE || 'novel_app').trim();
  const passwordFile = String(
    process.env.MOLAN_PG_RUNTIME_PASSWORD_FILE ||
    path.join(os.homedir(), 'AppData', 'Local', 'molan-postgresql', 'novel-runtime-password.txt')
  );
  const workerLoginRole = String(process.env.MOLAN_PG_WORKER_LOGIN_ROLE || 'novel_worker_runtime').trim();
  const workerRoleName = String(process.env.MOLAN_PG_WORKER_ROLE || 'novel_worker').trim();
  const workerPasswordFile = String(
    process.env.MOLAN_PG_WORKER_PASSWORD_FILE ||
    path.join(os.homedir(), 'AppData', 'Local', 'molan-postgresql', 'novel-worker-password.txt')
  );
  const runtimePassword = String(process.env.MOLAN_PG_RUNTIME_PASSWORD || readSecret('', passwordFile) || crypto.randomBytes(30).toString('base64url'));
  const workerPassword = String(process.env.MOLAN_PG_WORKER_PASSWORD || readSecret('', workerPasswordFile) || crypto.randomBytes(30).toString('base64url'));
  const pool = new Pool({
    host: String(process.env.MOLAN_PG_HOST || '127.0.0.1'),
    port: Number(process.env.MOLAN_PG_PORT || 5432),
    database: String(process.env.MOLAN_PG_DATABASE || 'molan'),
    user: String(process.env.MOLAN_PG_ADMIN_USER || 'postgres'),
    password: adminPassword || undefined,
    max: 1,
    connectionTimeoutMillis: 5000
  });
  const client = await pool.connect();
  try {
    const role = quoteIdentifier(runtimeRole);
    const inheritedRole = quoteIdentifier(grantedRole);
    const workerLogin = quoteIdentifier(workerLoginRole);
    const workerGroup = quoteIdentifier(workerRoleName);
    const workerRoleExists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [workerRoleName]);
    if (!workerRoleExists.rows.length) throw new Error(`缺少数据库角色 ${workerRoleName}，请先应用 PostgreSQL worker 迁移`);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${quoteLiteral(runtimeRole)}) THEN
          CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
        END IF;
      END
      $$;
    `);
    await client.query(`ALTER ROLE ${role} PASSWORD ${quoteLiteral(runtimePassword)}`);
    await client.query(`GRANT ${inheritedRole} TO ${role}`);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${quoteLiteral(workerLoginRole)}) THEN
          CREATE ROLE ${workerLogin} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
        END IF;
      END
      $$;
    `);
    await client.query(`ALTER ROLE ${workerLogin} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
    await client.query(`ALTER ROLE ${workerLogin} PASSWORD ${quoteLiteral(workerPassword)}`);
    await client.query(`GRANT ${workerGroup} TO ${workerLogin}`);
    fs.mkdirSync(path.dirname(passwordFile), { recursive: true });
    fs.writeFileSync(passwordFile, runtimePassword + '\n', { encoding: 'utf8', mode: 0o600 });
    fs.mkdirSync(path.dirname(workerPasswordFile), { recursive: true });
    fs.writeFileSync(workerPasswordFile, workerPassword + '\n', { encoding: 'utf8', mode: 0o600 });
    process.stdout.write(JSON.stringify({ ok: true, role: runtimeRole, workerRole: workerLoginRole, passwordFile, workerPasswordFile }) + '\n');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => {
  process.stderr.write(JSON.stringify({
    ok: false,
    code: String(error && error.code || 'postgres_role_setup_failed'),
    error: String(error && error.message || '本地 PostgreSQL 角色创建失败')
  }) + '\n');
  process.exitCode = 1;
});
