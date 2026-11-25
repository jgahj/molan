'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const MOLAN_HOME = path.resolve(__dirname, '..');
const jsonPersistence = require('../services/json-persistence-service');
const editorSharedCore = require('../pages/js/editor-shared-core');
const { createPostgresGenerationRunMethods } = require('../lib/repositories/postgres-generation-run-methods');

test('P0-1: boot-scripts.js 显式声明 s.async = false 且 679KB completion-editor.js 纳入路由懒加载', () => {
  const bootScripts = fs.readFileSync(path.join(MOLAN_HOME, 'boot-scripts.js'), 'utf8');
  assert.match(bootScripts, /s\.async\s*=\s*false/, '动态脚本必须显式声明 s.async = false 防止公网乱序竞态');
  assert.doesNotMatch(bootScripts, /`\.\/*completion-editor\.js\?v=/, 'completion-editor.js 不应继续在首屏强制加载');
  assert.match(bootScripts, /editor-shared-core\.js\?v=/, '应加载轻量共享核心层');

  const appBoot = fs.readFileSync(path.join(MOLAN_HOME, 'app-boot.js'), 'utf8');
  assert.match(appBoot, /'\.\/completion-editor\.js':\s*\['editor',\s*'outline',\s*'knowledge'\]/);
  assert.match(appBoot, /function loadLazyScript[\s\S]{0,300}s\.async\s*=\s*false/);
});

test('P0-2: 去 AI 味工具打通题材统计指纹选择器与自动识别（告别硬编码通用文学）', () => {
  const siteCode = fs.readFileSync(path.join(MOLAN_HOME, 'pages', 'site.js'), 'utf8');
  assert.match(siteCode, /id="ml-deai-genre"/);
  assert.match(siteCode, /function inferDeaiGenre\(/);
  assert.match(siteCode, /function fetchGenreStyleHint\(/);
  assert.doesNotMatch(siteCode, /novelGenre:\s*'通用文学'/, '朱雀深度模式不应继续硬编码通用文学');
  assert.match(siteCode, /novelGenre:\s*resolvedGenre/);
});

test('P0-3: json-persistence-service 无竞争临时文件、节流异步刷盘与受控 debugWarn', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-json-persist-'));
  try {
    const fileA = path.join(tmpDir, 'atomic.json');
    const t1 = jsonPersistence.uniqueTempPath(fileA);
    const t2 = jsonPersistence.uniqueTempPath(fileA);
    assert.notEqual(t1, t2, '并发临时文件路径必须唯一，禁止共用固定 .tmp');

    jsonPersistence.writeJsonAtomicSync(fileA, { ok: true, count: 3 });
    assert.deepEqual(JSON.parse(fs.readFileSync(fileA, 'utf8')), { ok: true, count: 3 });

    const ledgerFile = path.join(tmpDir, 'token_usage.json');
    const store = jsonPersistence.createThrottledJsonStore(ledgerFile, { debounceMs: 60, fallback: [] });
    assert.deepEqual(store.read(), []);

    store.save([{ id: 'r1', tokens: 100 }]);
    store.save([{ id: 'r1', tokens: 100 }, { id: 'r2', tokens: 250 }]);
    // 内存立即可见，无陈旧读
    assert.equal(store.read().length, 2);
    assert.equal(store.isDirty(), true);

    await store.flushAsync();
    assert.equal(store.isDirty(), false);
    const persisted = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
    assert.equal(persisted.length, 2);
    assert.equal(persisted[1].tokens, 250);

    // 受控 debugWarn：默认静默，开启 MOLAN_DEBUG=1 时输出
    const captured = [];
    const origWarn = console.warn;
    console.warn = (...args) => captured.push(args.join(' '));
    try {
      jsonPersistence.debugWarn('unit', 'should-stay-quiet', new Error('quiet'), { MOLAN_DEBUG: '0' });
      assert.equal(captured.length, 0);
      jsonPersistence.debugWarn('unit', 'should-log', new Error('boom'), { MOLAN_DEBUG: '1' });
      assert.equal(captured.length, 1);
      assert.match(captured[0], /\[molan:debug:unit\] should-log :: boom/);
    } finally {
      console.warn = origWarn;
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('P1-4: PG 仓储拆出 postgres-generation-run-methods 子模块且双编辑器共用 editor-shared-core', () => {
  const pgRepoLines = fs.readFileSync(path.join(MOLAN_HOME, 'lib', 'postgres-repository.js'), 'utf8').split('\n').length;
  assert.ok(pgRepoLines < 6800, `postgres-repository.js 拆分后行数应显著低于 6800（原 7488），实际 ${pgRepoLines}`);

  const methods = createPostgresGenerationRunMethods({
    UUID_PATTERN: /^[0-9a-f-]+$/i,
    PROJECT_READ_ROLES: new Set(['owner']),
    PROJECT_WRITE_ROLES: new Set(['owner']),
    GENERATION_SAFE_STATES: new Set(['created']),
    GENERATION_ACTIVE_STATES: ['created'],
    internalUuid: x => x,
    normalizeLegacyId: x => x,
    repositoryError: (code, msg) => new Error(`${code}:${msg}`),
    parseJsonValue: x => x,
    parseJsonDocument: x => x,
    publicGenerationRun: x => x,
    assertGenerationLease: () => {},
    generationNow: () => Date.now(),
    generationLeaseTtl: () => 30000,
    hasRole: () => true,
    withTransaction: async (_u, fn) => fn({ query: async () => ({ rows: [] }) }),
    ensureActor: async () => 'u1',
    accessForClient: async () => ({}),
    notifyRuntimeChanged: async () => {}
  });
  assert.equal(typeof methods.createGenerationRun, 'function');
  assert.equal(typeof methods.acquireGenerationRunLease, 'function');
  assert.equal(typeof methods.recoverExpiredGenerationRuns, 'function');
  assert.equal(typeof methods.appendGenerationEvent, 'function');

  // 验证 editor-shared-core 角色原型推断与双端编辑器接线
  const inferred = editorSharedCore.inferCharacterArchetype({
    tags: ['冷静', '克制'],
    notes: '处事审慎理智，从不轻举妄动'
  });
  assert.equal(inferred.archetype, '冷静理智型');
  assert.equal(inferred.source, 'inferred');

  const completionEditor = fs.readFileSync(path.join(MOLAN_HOME, 'completion-editor.js'), 'utf8');
  const standaloneEditor = fs.readFileSync(path.join(MOLAN_HOME, 'pages', 'editor.js'), 'utf8');
  assert.match(completionEditor, /globalThis\.MolanEditorShared/);
  assert.match(standaloneEditor, /globalThis\.MolanEditorShared/);
});

test('P2-6 & P2-7: HANDOVER.md 速查骨架索引置顶且历史归档无损保留', () => {
  const handover = fs.readFileSync(path.join(MOLAN_HOME, 'HANDOVER.md'), 'utf8');
  const lines = handover.split(/\r?\n/);
  const mapLine = lines.findIndex(line => line.startsWith('## 零、项目核心架构与文件骨架速查索引'));
  const firstStageLine = lines.findIndex(line => line.startsWith('## 阶段记录：'));
  assert.ok(mapLine > 0 && mapLine < 25, `速查索引必须置顶在前 25 行内，实际第 ${mapLine + 1} 行`);
  assert.ok(firstStageLine > mapLine, '所有阶段记录必须位于置顶速查索引之后');
  assert.ok(lines.length < 1500, `HANDOVER.md 主文件应保持精炼（<1500 行），实际 ${lines.length} 行`);

  const archivePath = path.join(MOLAN_HOME, 'docs', 'HANDOVER_ARCHIVE_2026.md');
  assert.equal(fs.existsSync(archivePath), true, '历史归档文件必须存在');
  const archiveLines = fs.readFileSync(archivePath, 'utf8').split(/\r?\n/).length;
  assert.ok(archiveLines > 2500, `历史归档应完整无损保留早期记录，实际 ${archiveLines} 行`);
});
