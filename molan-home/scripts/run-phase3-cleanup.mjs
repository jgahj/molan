import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const molanHomeDir = path.resolve(__dirname, '..');
const dataDir = path.join(molanHomeDir, 'data');
const dbPath = path.join(dataDir, 'molan.db');

const timestamp = Date.now();
const backupPath = path.join(dataDir, `molan.db.backup-${timestamp}`);

// 1. 备份 molan.db
fs.copyFileSync(dbPath, backupPath);
console.log(`[Backup] Created DB backup at: ${backupPath} (size: ${fs.statSync(backupPath).size} bytes)`);

// 2. 打开 SQLite
const db = new DatabaseSync(dbPath);
const beforePageCount = db.prepare('PRAGMA page_count').get().page_count;
const beforeFreelist = db.prepare('PRAGMA freelist_count').get().freelist_count;
const beforeSize = fs.statSync(dbPath).size;
console.log(`[Before] Size: ${beforeSize} bytes (${(beforeSize / 1024 / 1024).toFixed(2)} MB), Pages: ${beforePageCount}, Freelist Pages: ${beforeFreelist}`);

// 3. 清理已过期 sessions
const expiredSess = db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').run(Date.now());
console.log(`[Sessions] Deleted expired auth_sessions: ${expiredSess.changes}`);

// 4. 清理测试账号生成的假小说
const fakeNovels = db.prepare("DELETE FROM novels WHERE user_email != '1271055010@qq.com'").run();
console.log(`[Novels] Deleted fake novels from test accounts: ${fakeNovels.changes}`);

// 5. 清理失败拆书记录
const failedDiss = db.prepare("DELETE FROM dissections WHERE status = 'failed'").run();
console.log(`[Dissections] Deleted failed dissections: ${failedDiss.changes}`);

// 6. 执行 VACUUM 释放物理空洞与碎片页
console.log('[Vacuum] Executing SQLite VACUUM; ...');
db.exec('VACUUM;');
console.log('[Vacuum] SQLite VACUUM completed.');

const afterPageCount = db.prepare('PRAGMA page_count').get().page_count;
const afterFreelist = db.prepare('PRAGMA freelist_count').get().freelist_count;
db.close();

const afterSize = fs.statSync(dbPath).size;
const freedBytes = beforeSize - afterSize;
console.log(`[After] Size: ${afterSize} bytes (${(afterSize / 1024 / 1024).toFixed(2)} MB), Pages: ${afterPageCount}, Freelist Pages: ${afterFreelist}`);
console.log(`[Freed] Successfully reclaimed: ${freedBytes} bytes (${(freedBytes / 1024 / 1024).toFixed(2)} MB)`);

// 7. 清空 sessions.json
const sessJsonPath = path.join(dataDir, 'sessions.json');
fs.writeFileSync(sessJsonPath, '[]\n', 'utf8');
console.log('[Sessions] Emptied sessions.json');

// 8. 归档已弃用 Legacy 文件
const archiveDir = path.join(dataDir, 'legacy-archive');
if (!fs.existsSync(archiveDir)) {
  fs.mkdirSync(archiveDir, { recursive: true });
}

const legacyFiles = [
  'users.json',
  'admin_audit.json',
  'global_skills.json',
  'quality_issue_map.json',
  'genre_sampling_6books.json'
];

for (const lf of legacyFiles) {
  const src = path.join(dataDir, lf);
  const dest = path.join(archiveDir, lf);
  if (fs.existsSync(src)) {
    fs.renameSync(src, dest);
    console.log(`[Archive] Moved legacy file ${lf} -> legacy-archive/${lf}`);
  }
}

const archiveReadme = `# Legacy Data Archive (历史平铺数据归档)

此目录保留项目早期使用的平铺 JSON 数据文件，现已全量迁移至 SQLite / Postgres 数据库仓储与原生服务：
- \`users.json\`: 历史平铺账户数据（现由 SQLite accounts 表持久化）
- \`admin_audit.json\`: 历史管理员审计日志（现由 SQLite admin_audit 表持久化）
- \`global_skills.json\`: 历史全局技能配置（现由 SQLite global_skills 表持久化）
- \`quality_issue_map.json\`: 历史问题诊断映射字典（已被单元测试与 inplace-sanitizer 取代）
- \`genre_sampling_6books.json\`: 历史题材抽样清单
`;
fs.writeFileSync(path.join(archiveDir, 'README.md'), archiveReadme, 'utf8');
console.log('[Archive] Created legacy-archive/README.md');

console.log('[Success] Phase 3 cleanup and vacuum completed successfully.');
