const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'completion-import.js'), 'utf8');

test('创书在生成新作品状态后重新绑定会话并使用固定云端 id', () => {
  assert.match(source, /flowSession = captureImportSession\(\);/);
  assert.match(source, /const pendingNovelId = \/\^n_\[A-Za-z0-9\]\{1,30\}\$\/.+creationNovelId\(\)/);
  assert.match(source, /body: \{ id: pendingNovelId, state: novelState, title: novelState\.title \}/);
  assert.match(source, /requestCreationBackend\('\/api\/novels'/);
});

test('创书结果展示不等待余额、用量和作品列表刷新', () => {
  assert.match(source, /核心创作包已在服务端生成并保存/);
  assert.match(source, /setWaitPhase\('正在保存新作品'\);/);
  assert.match(source, /void Promise\.allSettled\(\[[\s\S]*refreshBackendUser[\s\S]*loadBackendUsage[\s\S]*loadBackendNovels/);
  // 禁止“await Promise.all([...refreshBackendUser()...loadBackendUsage()...])”阻塞结果展示
  // （[^\\]]* 限定同一括号内，避免跨调用点误伤）
  assert.doesNotMatch(source, /await Promise\.all\(\[[^\]]*refreshBackendUser\(\)[^\]]*loadBackendUsage\(\)/);
});

test('创书云端保存有有限等待并允许网络超时后继续编辑', () => {
  assert.match(source, /controller\.abort\(\)/);
  assert.match(source, /error\.code === 'CREATION_BACKEND_TIMEOUT' \|\| error\.name === 'TypeError'/);
  assert.match(source, /云端保存响应较慢，请稍后点击保存同步/);
});

test('创书保存后重新绑定当前作品会话，避免按钮清理被旧快照跳过', () => {
  assert.match(source, /previewState\.novelRevision = Number\.isInteger\(Number\(saved\.revision\)\) \? Number\(saved\.revision\) : null;\s*flowSession = captureImportSession\(\);/);
  assert.match(source, /previewState\.novelRevision = null;\s*flowSession = captureImportSession\(\);/);
});

test('每次打开操作弹窗都会清理上一次请求遗留的禁用状态', () => {
  const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(indexSource, /const confirmButton = document\.getElementById\('confirmModal'\);\s*confirmButton\.disabled = false;/);
});

test('编辑器入口统一使用新版 index.html#editor 并保留旧链接兼容跳转', () => {
  const rootSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const dashboardSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'home-dashboard.js'), 'utf8');
  const novelsSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'novels.js'), 'utf8');
  const dissectSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'dissect.js'), 'utf8');
  const shellSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'molan-shell.js'), 'utf8');
  const legacyEditor = fs.readFileSync(path.join(__dirname, '..', 'pages', 'editor.html'), 'utf8');
  const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.doesNotMatch(rootSource, /\.\/pages\/editor\.html/);
  assert.match(dashboardSource, /\.\/index\.html#editor/);
  assert.match(novelsSource, /\.\.\/index\.html\?' \+ query\.toString\(\) \+ '#editor'/);
  assert.match(dissectSource, /\.\.\/index\.html\?from=dissect#editor/);
  assert.match(shellSource, /key === 'editor' \? '\.\.\/index\.html#editor'/);
  assert.match(legacyEditor, /new URL\('\.\.\/index\.html'/);
  assert.match(legacyEditor, /target\.hash = params\.get\('panel'\) === 'resources'/);
  assert.match(indexSource, /initialEditorNovelId/);
  assert.match(indexSource, /initialEditorAction === 'new'/);
  assert.match(indexSource, /initialEditorPrompt/);
});
