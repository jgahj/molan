'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const MOLAN_HOME = path.resolve(__dirname, '..');

test('Round2-#1 & #3: cloud-proxy-service 与 model-transport-service 复用连接池、清理超时定时器并暴露 close()', async () => {
  // 1. cloud-proxy-service: 不再逐请求 new http(s).Agent，而是共享 Agent 并支持 close()
  const cloudProxySrc = fs.readFileSync(path.join(MOLAN_HOME, 'services', 'cloud-proxy-service.js'), 'utf8');
  assert.match(cloudProxySrc, /const sharedHttpAgent = new http\.Agent\(/);
  assert.match(cloudProxySrc, /const sharedHttpsAgent = new https\.Agent\(/);
  assert.doesNotMatch(cloudProxySrc, /const agent = new \(target\.protocol/, '禁止在 handleCloudProxy 内逐请求新建 Agent');

  const { createCloudProxyService } = require('../services/cloud-proxy-service');
  const proxySvc = createCloudProxyService({
    CLOUD_API_BASE: '',
    CLOUD_API_BASE_ERROR: '',
    DISSECTION_MAX_BODY_BYTES: 1024 * 1024,
    MAX_JSON_BODY_BYTES: 1024 * 1024,
    UPSTREAM_IDLE_TIMEOUT_MS: 30000,
    isLocalOpenAccess: () => true,
    json: () => {},
    readBody: async () => ({}),
    responseCors: () => ({})
  });
  assert.equal(typeof proxySvc.close, 'function');
  proxySvc.close();

  // 2. model-transport-service: 共享连接池 + connectTimer unref & error/close 清理 + close()
  const transportSrc = fs.readFileSync(path.join(MOLAN_HOME, 'services', 'model-transport-service.js'), 'utf8');
  assert.match(transportSrc, /^const net = require\('node:net'\);/m, 'net 应在模块顶层静态引入');
  assert.match(transportSrc, /connectTimer\.unref/);
  assert.match(transportSrc, /request\.once\('close', clearConnectTimer\)/);
  assert.match(transportSrc, /request\.once\('error', clearConnectTimer\)/);
  assert.match(transportSrc, /socket\.once\('close', clearConnectTimer\)/);

  const { createModelTransportService } = require('../services/model-transport-service');
  const seenAgents = [];
  const fakeHttp = {
    Agent: http.Agent,
    request(opts) {
      seenAgents.push(opts.agent);
      const req = new EventEmitter();
      req.setTimeout = () => {};
      req.destroy = () => {};
      return req;
    }
  };
  const transport = createModelTransportService({
    UPSTREAM_CONNECT_TIMEOUT_MS: 5000,
    UPSTREAM_IDLE_TIMEOUT_MS: 30000,
    http: fakeHttp,
    https: { Agent: http.Agent, request: fakeHttp.request },
    providerUrlGuard: {
      validateProviderTarget: async (url) => ({
        url: new URL(url),
        hostname: '127.0.0.1',
        port: 8080,
        addresses: [{ address: '127.0.0.1', family: 4 }],
        lookup: (_h, _o, cb) => cb(null, '127.0.0.1', 4)
      })
    },
    tls: {}
  });
  assert.equal(typeof transport.close, 'function');
  await new Promise((resolve, reject) => {
    transport.openUpstream('http://127.0.0.1:8080/v1/chat', '', { headers: {} }, (err, req) => {
      if (err) return reject(err);
      req.emit('error', new Error('simulated early abort'));
      resolve();
    });
  });
  await new Promise((resolve, reject) => {
    transport.openUpstream('http://127.0.0.1:8080/v1/chat', '', { headers: {} }, (err, req) => {
      if (err) return reject(err);
      req.emit('close');
      resolve();
    });
  });
  assert.equal(seenAgents.length, 2);
  assert.ok(seenAgents[0] && seenAgents[0] === seenAgents[1], '多次直连请求必须复用同一个 sharedHttpAgent');
  transport.close();

  // server.js 停机时调用两者的 close()
  const serverSrc = fs.readFileSync(path.join(MOLAN_HOME, 'server.js'), 'utf8');
  assert.match(serverSrc, /closeCloudProxy\(\)/);
  assert.match(serverSrc, /closeModelTransport\(\)/);
});

test('Round2-#2: observability rateBuckets 与 auth-account locallyRevokedSessions 均具备上限淘汰防 OOM', () => {
  // 1. observability-service
  const { createObservabilityService } = require('../services/observability-service');
  let fakeNow = 1_000_000;
  const obs = createObservabilityService({ now: () => fakeNow, maxRateBuckets: 4 });
  for (let i = 0; i < 12; i++) {
    const res = obs.recordClientError(`10.0.0.${i}`, { type: 'error', message: `err-${i}` });
    assert.equal(res.accepted, true);
  }
  const obsSrc = fs.readFileSync(path.join(MOLAN_HOME, 'services', 'observability-service.js'), 'utf8');
  assert.match(obsSrc, /const MAX_RATE_BUCKETS = 10000;/);
  assert.match(obsSrc, /while \(rateBuckets\.size >= maxRateBuckets\)/);

  // 2. auth-account-service
  const authSrc = fs.readFileSync(path.join(MOLAN_HOME, 'services', 'auth-account-service.js'), 'utf8');
  assert.match(authSrc, /const MAX_LOCALLY_REVOKED_SESSIONS = 10000;/);
  assert.match(authSrc, /while \(locallyRevokedSessions\.size >= MAX_LOCALLY_REVOKED_SESSIONS\)/);
});

test('Round2-#4 & #10a: PG 0052 索引迁移、syncStructuredResourceProjection 批量锁与 CreationBook 子仓储拆分', () => {
  // 1. 0052 迁移文件满足非破坏性事务契约
  const migPath = path.join(MOLAN_HOME, 'db', 'migrations', '0052_luna_hot_lookup_indexes.sql');
  assert.ok(fs.existsSync(migPath), '应存在 0052_luna_hot_lookup_indexes.sql');
  const migSql = fs.readFileSync(migPath, 'utf8');
  assert.match(migSql, /\bBEGIN;/);
  assert.match(migSql, /\bCOMMIT;/);
  assert.match(migSql, /luna_auth_sessions_user_id_idx/);
  assert.match(migSql, /luna_auth_sessions_active_expires_idx/);
  assert.match(migSql, /luna_workspace_members_user_active_idx/);

  // 2. syncStructuredResourceProjection 使用批量 ANY($3::uuid[]) FOR UPDATE 而非逐条 SELECT
  const repoPath = path.join(MOLAN_HOME, 'lib', 'postgres-repository.js');
  const repoSrc = fs.readFileSync(repoPath, 'utf8');
  const repoLines = repoSrc.split(/\r?\n/).length;
  assert.ok(repoLines < 5900, `拆分 CreationBook 子仓储后 postgres-repository.js 应小于 5900 行，实际 ${repoLines}`);
  assert.match(repoSrc, /WHERE workspace_id = \$1::uuid AND project_id = \$2::uuid[\s\S]{0,60}AND id = ANY\(\$3::uuid\[\]\)[\s\S]{0,60}ORDER BY id ASC[\s\S]{0,40}FOR UPDATE/);

  // 3. CreationBook 子仓储导出 17 个公共方法且不泄漏内部事务辅助函数
  const cbPath = path.join(MOLAN_HOME, 'lib', 'repositories', 'postgres-creation-book-methods.js');
  assert.ok(fs.existsSync(cbPath), '应存在 lib/repositories/postgres-creation-book-methods.js');
  const { createPostgresRepository } = require('../lib/postgres-repository');
  const repo = createPostgresRepository({
    env: { MOLAN_DB_BACKEND: 'postgres', MOLAN_PG_HOST: '127.0.0.1', MOLAN_PG_DATABASE: 'molan' }
  });
  try {
    const expectedMethods = [
      'listCreationBooks', 'createCreationBook', 'createCreationBookPlaceholder', 'linkCreationBook',
      'getCreationBible', 'withCreationBookTransaction', 'getCausalDebts', 'recordCausalDebt',
      'settleCausalDebt', 'findStoryMemoryRun', 'putCreationBible', 'getCreationState',
      'getCreationQualityReport', 'getCreationPackageData', 'createChapterAudit',
      'createGenerationChapterAudit', 'commitChapter'
    ];
    for (const m of expectedMethods) {
      assert.equal(typeof repo[m], 'function', `PG 仓储应继续暴露 ${m}`);
    }
    assert.equal('ensureCreationBookPlaceholderForClient' in repo, false, '内部辅助函数不得泄漏为公共 API');
    assert.equal('reserveJobBudgetForClient' in repo, false, '内部辅助函数不得泄漏为公共 API');
  } finally {
    repo.close().catch(() => {});
  }
});

test('Round2-#7 & #8: genre-engine 管线与语料 LRU 缓存、后台拆书定时器 unref() 与可配轮询间隔', () => {
  const genreSrc = fs.readFileSync(path.join(MOLAN_HOME, 'lib', 'genre-engine.js'), 'utf8');
  assert.match(genreSrc, /PIPELINE_CACHE_MAX_ENTRIES/);
  assert.match(genreSrc, /CORPUS_CACHE_MAX_ENTRIES\s*=\s*3/);
  assert.match(genreSrc, /function loadPipelineLibraryIndex\(\)/);

  const genreEngine = require('../lib/genre-engine');
  const p1 = genreEngine.loadPipelineForRoute('yuanshi');
  const p2 = genreEngine.loadPipelineForRoute('yuanshi');
  assert.strictEqual(p1, p2, '相同 route 的管线配置应命中内存 LRU 缓存返回同一对象引用');

  const aggSrc = fs.readFileSync(path.join(MOLAN_HOME, 'services', 'dissection-pipeline-aggregation-service.js'), 'utf8');
  assert.match(aggSrc, /MOLAN_DISSECTION_CANCEL_POLL_MS/);
  assert.match(aggSrc, /timer\.unref\(\)/);

  const workerSrc = fs.readFileSync(path.join(MOLAN_HOME, 'services', 'native-dissection-worker.js'), 'utf8');
  assert.match(workerSrc, /renewalTimer\.unref\(\)/);
});

test('Round2-#5, #6, #9 & #10b-d: Tailwind 静态化、全部子页版本戳+defer、前台可见性轮询守卫、启动脚本与根目录归档', () => {
  // 1. Tailwind 运行时已彻底替换为预编译静态 CSS
  const twCssPath = path.join(MOLAN_HOME, 'pages', 'tailwind-static.css');
  assert.ok(fs.existsSync(twCssPath), 'pages/tailwind-static.css 必须存在');
  const twCss = fs.readFileSync(twCssPath, 'utf8');
  assert.ok(Buffer.byteLength(twCss, 'utf8') > 10 * 1024 && Buffer.byteLength(twCss, 'utf8') < 100 * 1024);
  assert.equal(fs.existsSync(path.join(MOLAN_HOME, 'assets', 'tailwind-browser.js')), false, '死包 assets/tailwind-browser.js 应已删除');

  // 2. 所有 pages/*.html 本地 CSS/JS 均携带 ?v= 版本戳且非主题初始化脚本均带 defer
  const pagesDir = path.join(MOLAN_HOME, 'pages');
  const htmlFiles = fs.readdirSync(pagesDir).filter(f => f.endsWith('.html'));
  assert.ok(htmlFiles.length >= 20);
  for (const f of htmlFiles) {
    const html = fs.readFileSync(path.join(pagesDir, f), 'utf8');
    assert.ok(!html.includes('tailwind-browser.js'), `pages/${f} 不得再引用 tailwind-browser.js`);
    for (const m of html.matchAll(/<(?:script\b[^>]*\bsrc|link\b[^>]*\bhref)="([^"]+)"[^>]*>/gi)) {
      const tag = m[0];
      const url = m[1];
      if (/^(https?:|mailto:|#|data:)/i.test(url)) continue;
      if (tag.startsWith('<link') && !/rel="stylesheet"/i.test(tag)) continue;
      assert.match(url, /\?v=/, `pages/${f} 本地资源缺少 ?v= 版本戳: ${tag}`);
      if (tag.startsWith('<script') && !(f === 'editor.html' && /\.\/js\/editor\.js\?/.test(url))) {
        assert.match(tag, /\bdefer\b/, `pages/${f} 外部脚本应启用 defer: ${tag}`);
      }
    }
  }
  const twPages = ['about.html', 'blog.html', 'contact.html', 'docs.html', 'features.html', 'pricing.html', 'tools.html'];
  for (const p of twPages) {
    const html = fs.readFileSync(path.join(pagesDir, p), 'utf8');
    assert.match(html, /<link rel="stylesheet" href="\.\/tailwind-static\.css\?v=[^"]+">/);
  }

  // 3. 前端核心轮询器具备 document.hidden 与 visibilitychange 守卫
  for (const rel of ['app-boot.js', 'completion-import.js', 'pages/dissect.js', 'pages/editor.js']) {
    const src = fs.readFileSync(path.join(MOLAN_HOME, rel), 'utf8');
    assert.match(src, /document\.hidden/, `${rel} 应检查 document.hidden 暂停后台轮询`);
    assert.match(src, /visibilitychange/, `${rel} 应监听 visibilitychange 在切回前台时立即同步`);
  }

  // 4. 启动脚本已清理废弃 --experimental-sqlite，根目录历史分析报告已归档至 docs/archive/
  const bat = fs.readFileSync(path.join(MOLAN_HOME, 'start-node22.bat'), 'utf8');
  const ps1 = fs.readFileSync(path.join(MOLAN_HOME, 'start-node22-pg.ps1'), 'utf8');
  assert.ok(!bat.includes('--experimental-sqlite'), 'start-node22.bat 不应再携带 --experimental-sqlite');
  assert.ok(!ps1.includes('--experimental-sqlite'), 'start-node22-pg.ps1 不应再携带 --experimental-sqlite');
  assert.ok(fs.existsSync(path.join(MOLAN_HOME, 'docs', 'archive', '深度审查报告-2026-10-19.md')));
  assert.ok(fs.existsSync(path.join(MOLAN_HOME, 'HANDOVER.md')));
  assert.ok(fs.existsSync(path.join(MOLAN_HOME, 'ARCHITECTURE.md')));
});
