import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

/**
 * 生产代码架构导入门禁 (Production Import Audit)
 * 严格执行约束：
 * 1. server.js 和 lib/generation/* 严禁引用 legacy/ 或历史生成调度器；
 * 2. 杜绝将历史实验逻辑或已废弃管线带回生产生成主链。
 */
export function runProductionImportAudit() {
  const productionFiles = [];

  // 1. 收集生产代码
  const serverPath = path.join(rootDir, 'server.js');
  if (fs.existsSync(serverPath)) productionFiles.push(serverPath);

  // 抽离后的路由和服务同样属于生产链，不能借模块化绕过导入门禁。
  function collect(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(filename);
      else if (/\.(?:js|mjs|cjs)$/.test(entry.name)) productionFiles.push(filename);
    }
  }
  for (const relative of ['lib/generation', 'lib/repositories', 'routes', 'services']) {
    collect(path.join(rootDir, relative));
  }

  const forbiddenPatterns = [
    { pattern: /require\s*\(\s*['"][^'"]*legacy[^'"]*['"]\s*\)/, desc: '引用 legacy 历史模块' },
    { pattern: /import\s+.*from\s+['"][^'"]*legacy[^'"]*['"]/, desc: '引用 legacy 历史模块' },
    { pattern: /require\s*\(\s*['"][^'"]*pipeline-coordinator['"]\s*\)/, desc: '引用已废弃的 pipeline-coordinator' },
    { pattern: /import\s+.*from\s+['"][^'"]*pipeline-coordinator['"]/, desc: '引用已废弃的 pipeline-coordinator' },
    { pattern: /require\s*\(\s*['"][^'"]*generation-pipeline-coordinator['"]\s*\)/, desc: '引用已废弃的 generation-pipeline-coordinator' },
    { pattern: /import\s+.*from\s+['"][^'"]*generation-pipeline-coordinator['"]/, desc: '引用已废弃的 generation-pipeline-coordinator' }
  ];

  const violations = [];

  for (const filePath of productionFiles) {
    const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 忽略纯注释行
      if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) continue;

      for (const { pattern, desc } of forbiddenPatterns) {
        if (pattern.test(line)) {
          violations.push({
            file: relPath,
            line: i + 1,
            code: line.trim(),
            desc
          });
        }
      }
    }
  }

  return {
    passed: violations.length === 0,
    productionFilesCount: productionFiles.length,
    violations
  };
}

if (process.argv[1] && process.argv[1].endsWith('production-import-audit.mjs')) {
  console.log('🔍 执行生产架构导入依赖审计 (Production Import Audit)...');
  const res = runProductionImportAudit();
  console.log(`  已扫描生产核心文件: ${res.productionFilesCount} 个`);
  if (!res.passed) {
    console.error('❌ 生产代码依赖审计未通过，发现非法引用：');
    for (const v of res.violations) {
      console.error(`  - ${v.file}:${v.line} [${v.desc}] -> ${v.code}`);
    }
    process.exit(1);
  }
  console.log('✅ 生产代码依赖隔离合规，无任何反向引入 legacy/ 或已废弃调度器。');
  process.exit(0);
}
