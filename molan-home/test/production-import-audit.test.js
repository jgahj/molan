'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('生产导入隔离审计: lib/generation/* 与 server.js 严禁引用 legacy/ 或已废弃调度器', async () => {
  const { runProductionImportAudit } = await import('../scripts/production-import-audit.mjs');
  const result = runProductionImportAudit();

  assert.equal(result.passed, true, `发现非法历史导入: ${JSON.stringify(result.violations)}`);
  assert.ok(result.productionFilesCount >= 20, '生产文件扫描数量不应少于20个');
});

test('生产导入隔离审计: 兼容期白名单必须显式登记且条目受控', async () => {
  const { COMPAT_WHITELIST } = await import('../scripts/production-import-audit.mjs');

  // 白名单必须显式导出：例外即债务，可审计、可收敛（双模式收敛任务完成后归零）。
  assert.ok(COMPAT_WHITELIST instanceof Set, '兼容白名单必须显式导出以便审查');
  assert.ok(
    COMPAT_WHITELIST.size <= 2,
    `兼容白名单不应无限扩大（当前 ${COMPAT_WHITELIST.size} 条；新增豁免必须先过评审）`
  );
  for (const entry of COMPAT_WHITELIST) {
    assert.match(entry, /^server\.js:\d+:const \{ (?:DatabaseSync|PureJsDatabase) \} = require\('/, `白名单条目必须锚定 server.js 启动路径工厂（file:line:code）: ${entry}`);
  }
});
