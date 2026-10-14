'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { __test } = require('../server');

test('仅放行明确列出的客户端 WAL 和搜索静态资源', () => {
  for (const asset of [
    '/lib/client/local-wal.js',
    '/lib/client/search-index.js',
    '/lib/client/search-worker.js',
    '/lib/client/generation-runs.js'
  ]) assert.equal(__test.isPublicStaticPath(asset), true, asset);
  for (const asset of [
    '/lib/client/other.js',
    '/lib/generation/scene-patch.js',
    '/lib/postgres-repository.js',
    '/server.js'
  ]) assert.equal(__test.isPublicStaticPath(asset), false, asset);
});

test('静态资源服务对 HTML 和客户端 JS 强化抗缓存响应头，带版本号时启用 immutable 强缓存', () => {
  const { createStaticService } = require('../services/static-service');
  const service = createStaticService({
    MIME: { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png' },
    PUBLIC_DIR: __dirname,
    PUBLIC_ROOT_FILES: new Set(),
    STATIC_CACHE_MAX_BYTES: 0,
    STATIC_COMPRESSIBLE_EXT: new Set(),
    STATIC_COMPRESS_MIN_BYTES: 1024,
    fs: require('fs'),
    path: require('path'),
    responseCors: () => ({ 'Access-Control-Allow-Origin': '*' }),
    zlib: require('zlib')
  });

  function mockRes() {
    let statusCode = 0;
    let headers = {};
    return {
      writeHead(code, h) { statusCode = code; headers = h; },
      end() {},
      getHeader(k) { return headers[k]; },
      getHeaders() { return headers; },
      getStatusCode() { return statusCode; }
    };
  }

  // 1. HTML 请求应始终返回 no-cache, no-store, must-revalidate 且包含 Pragma: no-cache
  const htmlRes = mockRes();
  service.sendStatic({ headers: {} }, htmlRes, '.html', true, '"123-456"', { data: Buffer.from('<html></html>') }, false);
  assert.equal(htmlRes.getStatusCode(), 200);
  assert.match(htmlRes.getHeader('Cache-Control'), /no-cache,\s*no-store,\s*must-revalidate/);
  assert.equal(htmlRes.getHeader('Pragma'), 'no-cache');
  assert.equal(htmlRes.getHeader('Expires'), '0');

  // 2. 带 ?v= 版本戳的静态文件应返回 public, max-age=31536000, immutable
  const versionedRes = mockRes();
  service.sendStatic({ headers: {} }, versionedRes, '.js', true, '"abc-def"', { data: Buffer.from('console.log(1)') }, true);
  assert.equal(versionedRes.getStatusCode(), 200);
  assert.equal(versionedRes.getHeader('Cache-Control'), 'public, max-age=31536000, immutable');

  // 3. 未带版本戳的 JS 文件应返回 no-cache, no-store, must-revalidate 防陈旧缓存
  const unversionedJsRes = mockRes();
  service.sendStatic({ headers: {} }, unversionedJsRes, '.js', true, '"789-xyz"', { data: Buffer.from('console.log(2)') }, false);
  assert.equal(unversionedJsRes.getStatusCode(), 200);
  assert.match(unversionedJsRes.getHeader('Cache-Control'), /no-cache,\s*no-store,\s*must-revalidate/);

  // 4. 普通非 HTML/JS 文件（如图片）保留常规缓存
  const imgRes = mockRes();
  service.sendStatic({ headers: {} }, imgRes, '.png', false, '"img-123"', { data: Buffer.from('fake-png') }, false);
  assert.equal(imgRes.getStatusCode(), 200);
  assert.equal(imgRes.getHeader('Cache-Control'), 'public, max-age=86400');
});

test('index.html 与 app-boot.js 引用的外部脚本均包含统一的 Cache-Busting 版本参数', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
  const boot = fs.readFileSync(path.resolve(__dirname, '../app-boot.js'), 'utf8');

  // 检查 tokens.css 带版本号
  assert.match(html, /tokens\.css\?v=[a-zA-Z0-9_-]+/);
  // 外移后的引导脚本同样带版本号
  assert.match(html, /app-boot\.js\?v=[a-zA-Z0-9_-]+/);

  // 首屏 4 个核心补全脚本在 index.html 中均带版本号
  const eagerScripts = [
    'completion-library.js',
    'completion-editor.js',
    'completion-platform.js',
    'workspace-completion.js'
  ];
  for (const script of eagerScripts) {
    const pattern = new RegExp(`${script}\\?v=`);
    assert.ok(pattern.test(html), `index.html 中 ${script} 必须附带 ?v= 版本号查询参数`);
  }

  // 2026-10-14 懒加载：import/admin 脚本改由 app-boot.js 按路由加载，
  // 版本戳在运行时从 app-boot 自身 URL 自读取后拼接，不得硬编码过期戳
  const lazyScripts = ['completion-import.js', 'completion-admin.js'];
  for (const script of lazyScripts) {
    assert.ok(boot.includes(script), `app-boot.js 懒加载表必须注册 ${script}`);
  }
  assert.match(boot, /FRONTEND_STAMP \? `\$\{src\}\?v=\$\{FRONTEND_STAMP\}` : src/, '懒加载 URL 必须运行时拼接自读取版本戳');
  // 旧版全量加载清单不得残留（防止回退到首屏全载）
  assert.ok(!/completion-import\.js\?v=/.test(html), 'completion-import.js 不得再出现于 index.html 首屏清单');
  assert.ok(!/completion-admin\.js\?v=/.test(html), 'completion-admin.js 不得再出现于 index.html 首屏清单');
});
