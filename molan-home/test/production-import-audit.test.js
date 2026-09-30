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
