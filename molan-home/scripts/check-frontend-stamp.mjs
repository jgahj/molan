#!/usr/bin/env node
/**
 * check-frontend-stamp.mjs — 前端缓存戳联动校验（CI 门禁）
 *
 * 背景：services/static-service.js 对带 ?v= 版本戳的静态资源返回
 * `max-age=31536000, immutable`。一旦前端文件内容变更而 index.html 的
 * 版本戳未同步升级，回访用户的浏览器将无限期持有旧文件——历史上
 * 2026-10-12 的编辑器安全加固即因此未触达回访用户。
 *
 * 规则：自“引入当前版本戳的那次提交”起，任何受缓存戳保护的前端文件
 * 不得再发生变更；否则退出码 1 并指出应升级 index.html 中的版本戳。
 *
 * 用法：
 *   node scripts/check-frontend-stamp.mjs            # 校验工作区/HEAD
 *   node scripts/check-frontend-stamp.mjs <base>     # 校验 base..HEAD（CI）
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_HTML = path.join(REPO_ROOT, 'index.html');

/** 受版本戳保护的前端资产（与 index.html 动态加载清单 + tokens.css 保持一致） */
const STAMPED_ASSETS = [
  'index.html',
  'app.js',
  'app-boot.js',
  'completion-library.js',
  'completion-editor.js',
  'completion-import.js',
  'completion-platform.js',
  'completion-admin.js',
  'workspace-completion.js',
  'correction-policy.js',
  'pages/tokens.css',
  'assets/lucide.min.js',
  'assets/tailwind-browser.js',
];

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

function gitLines(args) {
  const out = git(args);
  return out ? out.split('\n').filter(Boolean) : [];
}

function main() {
  const base = process.argv[2] || 'HEAD';

  // 1. 读取 index.html 中的当前版本戳（取 completion 脚本清单那处， tokens.css 与其一致）
  const html = readFileSync(INDEX_HTML, 'utf8');
  const stampMatch = html.match(/const v = '([^']+)'/);
  if (!stampMatch) {
    console.error('[stamp-guard] index.html 中未找到 `const v = \'...\'` 版本戳声明');
    process.exit(1);
  }
  const stamp = stampMatch[1];

  // 2. 找到引入当前版本戳的提交（在该字符串首次出现的提交）
  let stampCommit;
  try {
    stampCommit = git(['log', '--max-count=1', '--format=%H', `-S${stamp}`, '--', 'index.html']);
  } catch {
    stampCommit = '';
  }
  if (!stampCommit) {
    // 版本戳尚未提交（首次引入场景）：退化为“工作区内 index.html 有未提交改动则放行”
    const dirty = gitLines(['status', '--porcelain', '--', 'index.html']);
    if (dirty.length > 0) {
      console.log(`[stamp-guard] 版本戳 ${stamp} 尚未提交，index.html 有未提交改动 → 视为本次引入，放行`);
      process.exit(0);
    }
    console.error(`[stamp-guard] 无法定位版本戳 ${stamp} 的引入提交，且 index.html 无未提交改动`);
    process.exit(1);
  }

  // 3. 检查 stampCommit..base 之间受保护资产是否有变更
  const range = base === 'HEAD' ? `${stampCommit}..HEAD` : `${stampCommit}..${base}`;
  let changed = [];
  try {
    changed = gitLines(['diff', '--name-only', range, '--', ...STAMPED_ASSETS]);
  } catch (err) {
    console.error(`[stamp-guard] git diff 失败：${err.message}`);
    process.exit(1);
  }

  if (changed.length > 0) {
    console.error(`[stamp-guard] ✗ 前端资产在版本戳 ${stamp}（引入于 ${stampCommit.slice(0, 8)}）之后发生变更：`);
    for (const f of changed) console.error(`  - ${f}`);
    console.error('[stamp-guard] 请升级 index.html 中的版本戳（const v = \'<新戳>\' 与 tokens.css 链接同步）后重新提交。');
    process.exit(1);
  }

  // 4. 附加校验：工作区内受保护资产有未提交改动而 index.html 干净时同样拦截
  const dirtyAssets = gitLines(['status', '--porcelain', '--', ...STAMPED_ASSETS.filter(a => a !== 'index.html')]);
  const dirtyIndex = gitLines(['status', '--porcelain', '--', 'index.html']);
  if (dirtyAssets.length > 0 && dirtyIndex.length === 0) {
    console.error('[stamp-guard] ✗ 受保护前端资产有未提交变更，但 index.html（版本戳所在）无改动：');
    for (const f of dirtyAssets) console.error(`  - ${f}`);
    console.error('[stamp-guard] 请先升级版本戳再提交。');
    process.exit(1);
  }

  console.log(`[stamp-guard] ✓ 版本戳 ${stamp} 与受保护前端资产一致（范围 ${range}）`);
  process.exit(0);
}

main();
