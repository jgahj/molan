'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const test = require('node:test');

const MOLAN_HOME = path.resolve(__dirname, '..');

test('P0-2: 本地模式仅对受信任本地 Origin 下发 CORS/PNA，拒绝外部站点跨站接管', async () => {
  const keys = [
    'MOLAN_DATA_DIR', 'MOLAN_CONFIG_DIR', 'MOLAN_LOCAL_ONLY',
    'MOLAN_PUBLIC_MODE', 'MOLAN_LOCAL_OPEN_ACCESS', 'MOLAN_PG_ENABLED'
  ];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-cors-guard-'));
  process.env.MOLAN_DATA_DIR = dir;
  process.env.MOLAN_CONFIG_DIR = dir;
  process.env.MOLAN_LOCAL_ONLY = '1';
  process.env.MOLAN_PUBLIC_MODE = '0';
  process.env.MOLAN_LOCAL_OPEN_ACCESS = '1';
  process.env.MOLAN_PG_ENABLED = '0';

  const serverPath = require.resolve('../server');
  delete require.cache[serverPath];
  const mod = require('../server');
  await new Promise(resolve => mod.server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${mod.server.address().port}`;
  try {
    // 1. 第三方恶意站点发起跨域请求：既不得反射 ACAO/PNA，也不得自动放行本地免登录
    const evilRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Origin: 'https://evil.example' }
    });
    assert.equal(evilRes.headers.get('access-control-allow-origin'), null, '不得向公网外部站点反射 ACAO');
    assert.equal(evilRes.headers.get('access-control-allow-private-network'), null, '不得向公网外部站点下发 PNA 放行');
    assert.equal(evilRes.status, 401, '携带外部恶意 Origin 时不得自动授予本地免登录管理员身份');

    // 2. 本地 localhost 来源正常放行
    const localRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Origin: 'http://localhost:3000' }
    });
    assert.equal(localRes.headers.get('access-control-allow-origin'), 'http://localhost:3000');
    assert.equal(localRes.status, 200);
  } finally {
    await new Promise(resolve => mod.server.close(resolve));
    delete require.cache[serverPath];
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('P0-3 & P1-2: PG 仓储绑定 pool.on(error)、statement_timeout、共享重连 LISTEN 与单事务 requestAuthContext', async () => {
  const { EventEmitter } = require('node:events');
  const { readConfig, createPostgresRepository } = require('../lib/postgres-repository');

  const cfg = readConfig({
    MOLAN_PG_ENABLED: '1',
    MOLAN_PG_HOST: '127.0.0.1',
    MOLAN_PG_DATABASE: 'molan_test'
  });
  assert.equal(cfg.config.application_name, 'molan-server');
  assert.equal(cfg.config.statement_timeout, 30000);

  const queries = [];
  let poolErrorListeners = 0;
  let listenClientCount = 0;

  class MockClient extends EventEmitter {
    async connect() { listenClientCount++; }
    async query(sql, params) {
      const text = String(sql).trim();
      queries.push({ text, params });
      if (text.includes('LEFT JOIN LATERAL luna.runtime_account_by_user_id')) {
        return {
          rows: [{
            token_hash: 'a'.repeat(64),
            user_id: 'u-1',
            legacy_id: 'usr_1',
            scope: 'client',
            expires_at: new Date(Date.now() + 60000).toISOString(),
            account_row: { legacy_user_id: 'usr_1', email: 'a@test.local', name: '作者', role: 'normal' }
          }]
        };
      }
      return { rows: [] };
    }
    async end() {}
    release() {}
  }

  class MockPool extends EventEmitter {
    on(event, listener) {
      if (event === 'error') poolErrorListeners++;
      return super.on(event, listener);
    }
    async connect() { return new MockClient(); }
    async end() {}
  }

  const repo = createPostgresRepository({
    env: { MOLAN_PG_ENABLED: '1', MOLAN_PG_RUNTIME_ROLE: 'novel_app' },
    Pool: MockPool,
    Client: MockClient
  });

  assert.ok(poolErrorListeners >= 1, '必须注册 pool.on(error) 防止空闲连接断开击溃进程');
  // 触发 pool error 不应抛未捕获异常
  repo.pool.emit('error', new Error('simulated idle disconnect'));

  // 单事务 requestAuthContext
  const ctx = await repo.requestAuthContext('a'.repeat(64));
  assert.ok(ctx && ctx.session && ctx.account);
  assert.equal(ctx.session.userId, 'usr_1');
  assert.equal(ctx.account.email, 'a@test.local');
  const beginCount = queries.filter(q => q.text === 'BEGIN').length;
  assert.equal(beginCount, 1, 'requestAuthContext 必须在单次事务内完成会话与账户读取');

  // 两个 LISTEN 订阅复用同一条独立 Client，不占业务 Pool
  await repo.subscribeAuthSessionInvalidation(() => {});
  await repo.subscribeRuntimeInvalidation(() => {});
  assert.equal(listenClientCount, 1, 'auth 与 runtime 通知必须复用同一条独立 LISTEN 连接');

  await repo.close();
});

test('P0-4 & P0-5: creation-core-job 修复正则且禁写 /tmp、platform-config 原子 0600 落盘、PG 模式退出关闭 ACP', async () => {
  const coreJobSrc = fs.readFileSync(path.join(MOLAN_HOME, 'services', 'creation-core-job-runtime.js'), 'utf8');
  assert.doesNotMatch(coreJobSrc, /\/tmp\/corejob-debug/, '禁止向全局 /tmp 明文写入系统提示词与用户大纲');
  assert.doesNotMatch(coreJobSrc, /\.replace\(\/s\+\/g/, '禁止残留误删字母 s 的 /s+/g 正则拼写错误');
  assert.match(coreJobSrc, /\.replace\(\/\\s\+\/g,\s*' '\)/);

  const cfgSrc = fs.readFileSync(path.join(MOLAN_HOME, 'services', 'platform-model-config-service.js'), 'utf8');
  assert.doesNotMatch(cfgSrc, /PLATFORM_CONFIG_FILE \+ '\.tmp'/, '禁止使用固定 .tmp 文件名并发互踩');
  assert.match(cfgSrc, /writeJsonAtomicSync|uniqueTempPath/);
  assert.match(cfgSrc, /0o600/);

  // server-lifecycle 在 postgresMode: true 下优雅退出也必须调用 stopLocalWorkers（关闭 ACP 子进程）
  const { EventEmitter } = require('node:events');
  const { createServerLifecycleService } = require('../services/server-lifecycle-service');
  let stoppedWorkers = 0;
  const runtime = new EventEmitter();
  runtime.env = {};
  runtime.exit = () => {};
  const srv = new EventEmitter();
  srv.listen = (_p, _h, cb) => { srv.listening = true; cb(); };
  srv.address = () => ({ port: 3456 });
  srv.close = cb => { srv.listening = false; cb(); };
  const lifecycle = createServerLifecycleService({
    server: srv, runtime, postgresMode: true, nativeJsonMode: false, port: 3456, host: '127.0.0.1', maxConnections: 64,
    initializeStorage: async () => {},
    preparePostgres: async () => {},
    prepareLocal: async () => {},
    flushSessions: () => {},
    flushWrites: async () => {},
    closeStorage: async () => {},
    stopLocalWorkers: () => { stoppedWorkers++; },
    logger: { log() {}, warn() {}, error() {} }
  });
  await lifecycle.start();
  await lifecycle.shutdown('SIGTERM');
  assert.equal(stoppedWorkers, 1, 'PG 模式优雅退出时也必须调用 stopLocalWorkers 回收 ACP 子进程');
});

test('P1-1, P1-3 & P1-4: 静态服务 304 协商与字节账本、API JSON 压缩、model-call 懒查库、local-style mtime 缓存与扩展指纹', async () => {
  // 1. static-service 304 + 编码 ETag + 压缩体积记账
  const { createStaticService } = require('../services/static-service');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-static-opt-'));
  const sampleHtml = '<html><body>' + '墨阑小说创作工作台测试正文。'.repeat(200) + '</body></html>';
  fs.writeFileSync(path.join(tmpDir, 'index.html'), sampleHtml, 'utf8');
  try {
    const svc = createStaticService({
      MIME: { '.html': 'text/html; charset=utf-8' },
      PUBLIC_DIR: tmpDir,
      PUBLIC_ROOT_FILES: new Set(['/index.html']),
      STATIC_CACHE_MAX_BYTES: 1024 * 1024,
      STATIC_COMPRESSIBLE_EXT: new Set(['.html']),
      STATIC_COMPRESS_MIN_BYTES: 256,
      fs, path, responseCors: () => ({ Vary: 'Origin' }), zlib
    });
    const srv = http.createServer((req, res) => svc.serveStatic(req, res));
    await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${srv.address().port}/index.html`;
    try {
      const r1 = await fetch(url, { headers: { 'Accept-Encoding': 'gzip' } });
      assert.equal(r1.status, 200);
      assert.doesNotMatch(r1.headers.get('cache-control') || '', /\bno-store\b/);
      const etag = r1.headers.get('etag');
      assert.ok(etag && etag.includes('gzip'), `压缩响应 ETag 应包含编码标识，实际 ${etag}`);
      assert.ok(svc.getCacheBytes() > Buffer.byteLength(sampleHtml), '静态缓存字节账本应计入压缩副本大小');

      const r2 = await fetch(url, { headers: { 'Accept-Encoding': 'gzip', 'If-None-Match': etag } });
      assert.equal(r2.status, 304, '带匹配 ETag 的 HTML 应命中 304 Not Modified');
    } finally {
      await new Promise(resolve => srv.close(resolve));
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // 2. http-request-service 对 >=2KB JSON 启用 gzip/br 压缩
  const { createHttpRequestService } = require('../services/http-request-service');
  const httpSvc = createHttpRequestService({
    MAX_JSON_BODY_BYTES: 1024 * 1024,
    responseCors: () => ({ Vary: 'Origin' }),
    shouldFlushWrites: () => false,
    flushWrites: async () => {}
  });
  let capturedHeaders = null;
  let capturedBody = null;
  const mockRes = {
    req: { method: 'GET', headers: { 'accept-encoding': 'gzip, deflate' } },
    headersSent: false, writableEnded: false, destroyed: false,
    writeHead(_s, h) { capturedHeaders = h; },
    end(b) { capturedBody = b; }
  };
  const bigObj = { ok: true, chapters: Array.from({ length: 60 }, (_, i) => ({ id: i, text: '玄幻修仙正文内容重复片段'.repeat(10) })) };
  httpSvc.json(mockRes, 200, bigObj);
  assert.equal(capturedHeaders['Content-Encoding'], 'gzip');
  assert.match(capturedHeaders.Vary, /Accept-Encoding/);
  assert.deepEqual(JSON.parse(zlib.gunzipSync(capturedBody).toString('utf8')), bigObj);

  // 3. local-style-service mtime 缓存与 16 维扩展基线字段
  const { createLocalStyleService, LOCAL_BASELINE_FIELDS } = require('../services/local-style-service');
  assert.ok(LOCAL_BASELINE_FIELDS.includes('sentenceLenCv'));
  assert.ok(LOCAL_BASELINE_FIELDS.includes('directPsychPerKilo'));
  let readCount = 0;
  const fakeFs = {
    statSync: () => ({ mtimeMs: 123456789 }),
    readFileSync: () => {
      readCount++;
      return JSON.stringify({
        books: [{
          bucket: '仙侠', primaryGenre: '仙侠',
          fingerprint: { sentenceLenMean: 18, sentenceLenCv: 0.72, directPsychPerKilo: 0.5 }
        }]
      });
    }
  };
  let baselineOut = null;
  const styleSvc = createLocalStyleService({
    fs: fakeFs, path, assetDirectory: '/mock',
    json: (_r, _s, body) => { baselineOut = body; }
  });
  styleSvc.handleLocalStyleBaseline({}, {}, new URLSearchParams('bucket=仙侠'));
  styleSvc.handleLocalStyleBaseline({}, {}, new URLSearchParams('bucket=仙侠'));
  assert.equal(readCount, 1, '文件未变更时应复用内存缓存而不重复同步 readFileSync');
  assert.ok(baselineOut.baseline.sentenceLenCv, '基线接口应暴露新建的 sentenceLenCv 突发度字段');
  assert.ok(baselineOut.baseline.directPsychPerKilo, '基线接口应暴露 directPsychPerKilo 指标');

  // 4. model-call-service 无 skillAudit 时不调用 nativeSkillCatalog
  const modelCallSrc = fs.readFileSync(path.join(MOLAN_HOME, 'services', 'model-call-service.js'), 'utf8');
  assert.doesNotMatch(modelCallSrc, /console\.error\('\[callMolanChat\]/, '应移除残留的每请求 console.error 诊断打印');
  assert.match(modelCallSrc, /if \(skillAudit\)[\s\S]{0,400}await nativeSkillCatalog\(user\)/);
});

test('P0-6, P1-3 & P2: 前端 CSS 外移（index.html < 12KB）、lucide/boot-scripts defer、死图清理与 train_unsloth v2 对齐', () => {
  const indexHtml = fs.readFileSync(path.join(MOLAN_HOME, 'index.html'), 'utf8');
  const indexBytes = Buffer.byteLength(indexHtml, 'utf8');
  assert.ok(indexBytes < 12 * 1024, `index.html 抽离内联 CSS 后应小于 12KB，实际 ${indexBytes} bytes`);
  assert.match(indexHtml, /<link rel="stylesheet" href="\.\/pages\/app-shell\.css\?v=20261126_deep_opt_v1">/);
  assert.match(indexHtml, /<script src="\.\/assets\/lucide\.min\.js\?v=20261126_deep_opt_v1" defer><\/script>/);
  assert.match(indexHtml, /<script src="\.\/boot-scripts\.js\?v=20261126_deep_opt_v1" defer><\/script>/);
  assert.ok(fs.existsSync(path.join(MOLAN_HOME, 'pages', 'app-shell.css')));
  assert.ok(fs.existsSync(path.join(MOLAN_HOME, 'pages', 'editor-inline.css')));

  // 死图与废弃索引已清理
  assert.equal(fs.existsSync(path.join(MOLAN_HOME, 'assets', 'login-writing-room.png')), false);
  const lucideSrc = fs.readFileSync(path.join(MOLAN_HOME, 'assets', 'lucide.min.js'), 'utf8');
  assert.doesNotMatch(lucideSrc, /sourceMappingURL=lucide\.min\.js\.map/);

  // train_unsloth.py 已同步升级至 v2
  const trainPy = fs.readFileSync(path.join(MOLAN_HOME, 'training', 'train_unsloth.py'), 'utf8');
  assert.match(trainPy, /SFTConfig/);
  assert.match(trainPy, /train_on_responses_only/);
  assert.match(trainPy, /val_sharegpt\.jsonl/);
  assert.match(trainPy, /find_latest_checkpoint/);
  assert.match(trainPy, /maximum_memory_usage=0\.4/);

  // server.js 路由单例与静态短路
  const srvSrc = fs.readFileSync(path.join(MOLAN_HOME, 'server.js'), 'utf8');
  assert.match(srvSrc, /function getDomainRoutes\(\)/);
  assert.match(srvSrc, /!u\.startsWith\('\/api\/'\)\) \{\s*return serveStatic\(req, res\);/);
  assert.doesNotMatch(srvSrc, /const emailCodes = new Map\(\)/);
});
