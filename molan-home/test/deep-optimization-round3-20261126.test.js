'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const MOLAN_HOME = path.resolve(__dirname, '..');

test('Round3-#1: 7个营销/文档页已移除阻断首屏的 Google Fonts 并共享外移 brand-tokens.css（stamp v3）', () => {
  const brandCssPath = path.join(MOLAN_HOME, 'pages', 'brand-tokens.css');
  assert.ok(fs.existsSync(brandCssPath), 'pages/brand-tokens.css 必须存在');
  const brandCss = fs.readFileSync(brandCssPath, 'utf8');
  assert.ok(Buffer.byteLength(brandCss, 'utf8') > 3000, 'brand-tokens.css 应包含完整品牌设计变量');

  const twPages = ['about.html', 'blog.html', 'contact.html', 'docs.html', 'features.html', 'pricing.html', 'tools.html'];
  for (const p of twPages) {
    const html = fs.readFileSync(path.join(MOLAN_HOME, 'pages', p), 'utf8');
    assert.ok(!html.includes('fonts.googleapis.com'), `pages/${p} 不得再请求阻断首屏的 fonts.googleapis.com`);
    assert.ok(!html.includes('fonts.gstatic.com'), `pages/${p} 不得再预连接 fonts.gstatic.com`);
    assert.ok(!html.includes('data-vd-inlined-stylesheet="../colors_and_type.css"'), `pages/${p} 不得再重复内联 colors_and_type.css`);
    assert.match(html, /<link rel="stylesheet" href="\.\/brand-tokens\.css\?v=[^"]+">/);
  }

  const stampScript = fs.readFileSync(path.join(MOLAN_HOME, 'scripts', 'check-frontend-stamp.mjs'), 'utf8');
  assert.ok(stampScript.includes("'pages/brand-tokens.css'"), 'check-frontend-stamp.mjs 应守护 pages/brand-tokens.css');
});

test('Round3-#2 & #3 & #4: 纠错库 mtime 缓存、chat-admission 有界限流 Map、character-material 匿名化 LRU、HTTP Slowloris 加固与 noopener', async () => {
  // 1. server.js loadEditorOnlyCorrectionLibrary 具备 (path, mtimeMs, size) 缓存
  const serverSrc = fs.readFileSync(path.join(MOLAN_HOME, 'server.js'), 'utf8');
  assert.match(serverSrc, /let editorOnlyCorrectionCache = null;/);
  assert.match(serverSrc, /editorOnlyCorrectionCache\.mtimeMs === stat\.mtimeMs/);

  // 2. chat-admission-service 具备 maxRateKeys 上限淘汰且行为正常
  const { createChatAdmissionService } = require('../services/chat-admission-service');
  let fakeNow = 100000;
  const admission = createChatAdmissionService({
    stableUserId: v => v,
    requestLimit: 5,
    maxInflight: 10,
    maxPerUser: 2,
    maxRateKeys: 3,
    now: () => fakeNow
  });
  try {
    for (let i = 0; i < 8; i++) {
      assert.equal(admission.allowChatRate({ userId: `u_${i}` }), true);
    }
  } finally {
    admission.close();
  }
  const admSrc = fs.readFileSync(path.join(MOLAN_HOME, 'services', 'chat-admission-service.js'), 'utf8');
  assert.match(admSrc, /const MAX_RATE_KEYS = 10000;/);
  assert.match(admSrc, /while \(rate\.size >= maxRateKeys\)/);

  // 3. character-material.js paragraphAnonymizationCache 具备 LRU 上限
  const cmSrc = fs.readFileSync(path.join(MOLAN_HOME, 'lib', 'character-material.js'), 'utf8');
  assert.match(cmSrc, /const MAX_PARAGRAPH_ANON_SOURCES = 256;/);
  assert.match(cmSrc, /paragraphAnonymizationCache\.size >= MAX_PARAGRAPH_ANON_SOURCES/);

  // 4. server-lifecycle-service 显式配置 requestTimeout 与 maxHeadersCount 防 Slowloris
  const { createServerLifecycleService } = require('../services/server-lifecycle-service');
  const fakeRuntime = new EventEmitter();
  fakeRuntime.env = {};
  fakeRuntime.exit = () => {};
  const fakeServer = new EventEmitter();
  fakeServer.listen = (_p, _h, cb) => { fakeServer.listening = true; cb(); };
  fakeServer.address = () => ({ port: 3456 });
  fakeServer.close = cb => { fakeServer.listening = false; cb(); };
  const lifecycle = createServerLifecycleService({
    server: fakeServer, runtime: fakeRuntime, postgresMode: false, nativeJsonMode: true,
    port: 3456, host: '127.0.0.1', maxConnections: 128,
    initializeStorage: async () => {}, preparePostgres: async () => {}, prepareLocal: async () => {},
    flushSessions: () => {}, flushWrites: async () => {}, closeStorage: async () => {},
    stopLocalWorkers: () => {}, logger: { log() {}, warn() {}, error() {} }
  });
  await lifecycle.start();
  assert.equal(fakeServer.requestTimeout, 120000);
  assert.equal(fakeServer.maxHeadersCount, 100);
  await lifecycle.shutdown('test');

  // 5. completion-editor.js target="_blank" 带 rel="noopener noreferrer" 防 Tabnabbing
  const compEditorSrc = fs.readFileSync(path.join(MOLAN_HOME, 'completion-editor.js'), 'utf8');
  assert.doesNotMatch(compEditorSrc, /target="_blank"(?![^>]*rel="noopener)/, '不得存在缺少 rel="noopener" 的 target="_blank" 链接');
});

test('Round3-#5 & #6: PG 0053 部分索引迁移与 RuntimeDissection 子仓储拆解（postgres-repository.js < 4300 行）', () => {
  const migPath = path.join(MOLAN_HOME, 'db', 'migrations', '0053_luna_runtime_usage_indexes.sql');
  assert.ok(fs.existsSync(migPath), '应存在 0053_luna_runtime_usage_indexes.sql');
  const migSql = fs.readFileSync(migPath, 'utf8');
  assert.match(migSql, /\bBEGIN;/);
  assert.match(migSql, /\bCOMMIT;/);
  assert.match(migSql, /luna_runtime_dissection_rows_token_usage_active_idx/);
  assert.match(migSql, /luna_runtime_dissection_rows_owner_dissection_idx/);

  const repoPath = path.join(MOLAN_HOME, 'lib', 'postgres-repository.js');
  const repoLines = fs.readFileSync(repoPath, 'utf8').split(/\r?\n/).length;
  assert.ok(repoLines < 4300, `拆出 RuntimeDissection 子仓储后 postgres-repository.js 应小于 4300 行，实际 ${repoLines}`);

  const subRepoPath = path.join(MOLAN_HOME, 'lib', 'repositories', 'postgres-runtime-dissection-methods.js');
  assert.ok(fs.existsSync(subRepoPath), '应存在 lib/repositories/postgres-runtime-dissection-methods.js');

  const { createPostgresRepository } = require('../lib/postgres-repository');
  const repo = createPostgresRepository({
    env: { MOLAN_DB_BACKEND: 'postgres', MOLAN_PG_HOST: '127.0.0.1', MOLAN_PG_DATABASE: 'molan' }
  });
  try {
    const required = [
      'runtimeListDissections', 'runtimeClaimDissectionWorker', 'runtimeUpdateDissection',
      'runtimePatchDissectionMetadata', 'runtimeDeleteDissection', 'runtimeListCharacterLibrary',
      'runtimeListAllTokenUsage', 'runtimeAdminDataRows', 'runtimeAdminWriteNovel',
      'runtimeAdminWriteTokenUsage', 'runtimeRecordModelUsage', 'runtimeReplaceDissectionSummaries'
    ];
    for (const fn of required) {
      assert.equal(typeof repo[fn], 'function', `PG 仓储应继续暴露 ${fn}`);
    }
  } finally {
    repo.close().catch(() => {});
  }
});

test('Round3-#7: 死代码模块清理、根目录报告 JSON 归档与 package.json ci 纳入 stamp 门禁', () => {
  for (const dead of [
    'routes/novel-domain-handlers.js',
    'services/native-benchmark-chapter-service.js',
    'services/native-dissection-service.js',
    'services/native-skill-service.js'
  ]) {
    assert.equal(fs.existsSync(path.join(MOLAN_HOME, dead)), false, `零引用遗留模块 ${dead} 应已移除`);
  }
  assert.ok(fs.existsSync(path.join(MOLAN_HOME, 'docs', 'archive', 'generalization-report.json')));
  assert.ok(fs.existsSync(path.join(MOLAN_HOME, 'docs', 'archive', 'self-evolution-report.json')));

  const pkg = JSON.parse(fs.readFileSync(path.join(MOLAN_HOME, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts['audit:stamp'], 'package.json 应定义 audit:stamp 脚本');
  assert.ok(pkg.scripts.ci.includes('check-frontend-stamp.mjs'), 'npm run ci 必须串联 check-frontend-stamp.mjs');
});
