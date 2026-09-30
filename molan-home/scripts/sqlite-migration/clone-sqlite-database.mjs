import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

/** 将文件路径安全转换为 SQLite 字符串字面量。 */
function quoteSqlitePath(filePath) {
  return `'${String(filePath).replace(/'/g, "''")}'`;
}

/** 使用 SQLite 快照复制生成一致性克隆，不直接复制可能未 checkpoint 的 WAL 主文件。 */
function cloneDatabase(sourcePath, targetPath) {
  const source = path.resolve(sourcePath);
  const target = path.resolve(targetPath);
  if (!fs.existsSync(source)) throw new Error('SQLite 源库不存在：' + source);
  if (fs.existsSync(target)) throw new Error('克隆目标已存在，拒绝覆盖：' + target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const database = new DatabaseSync(source, { readOnly: true });
  try {
    database.exec(`VACUUM INTO ${quoteSqlitePath(target)}`);
    const check = database.prepare('PRAGMA quick_check').get();
    if (!check || String(check.quick_check || '').toLowerCase() !== 'ok') throw new Error('SQLite 快照完整性检查失败');
  } finally {
    database.close();
  }
  return { source, target, bytes: fs.statSync(target).size };
}

/** 执行本地 SQLite 一致性克隆。 */
function main() {
  const sourcePath = process.argv[2] || process.env.MOLAN_SQLITE_PATH;
  const targetPath = process.argv[3] || process.env.MOLAN_SQLITE_CLONE_PATH;
  if (!sourcePath || !targetPath) throw new Error('用法：clone-sqlite-database.mjs <source> <target>');
  process.stdout.write(JSON.stringify({ ok: true, ...cloneDatabase(sourcePath, targetPath) }) + '\n');
}

try {
  main();
} catch (error) {
  process.stderr.write(JSON.stringify({
    ok: false,
    code: String(error && error.code || 'sqlite_clone_failed'),
    error: String(error && error.message || 'SQLite 克隆失败')
  }) + '\n');
  process.exitCode = 1;
}
