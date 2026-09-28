const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const editorHtml = fs.readFileSync(path.join(__dirname, '..', 'pages', 'editor.html'), 'utf8');
const editorSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'editor.js'), 'utf8');

test('local Skill/material import supports multiple text files', () => {
  assert.match(editorHtml, /id="textFilesInputR"[^>]*accept="[^"]*\.txt/);
  assert.match(editorHtml, /id="textFilesInputR"[^>]*accept="[^"]*\.md/);
  assert.match(editorHtml, /id="textFilesInputR"[^>]*multiple/);
  assert.match(editorSource, /pickViaInput\('textFilesInputR'\)/);
  assert.match(editorSource, /async function loadLocalTextFiles\(\)/);
  assert.match(editorSource, /function openLocalImportChooser\(\)/);
  assert.match(editorSource, /选择文本文件/);
  assert.match(editorSource, /if \(!skillRoots\.length && !material\.length\)/);
});

test('direct text-file imports reuse the same Skill/material ingestion path', () => {
  assert.match(editorSource, /loadLocalTextFiles\(\)[\s\S]*?ingestFiles\(files\)/);
  assert.match(editorSource, /const ltb = modal\.querySelector\('#localTextLoadBtn'\)/);
  assert.match(editorSource, /loadFolderBtnR\) loadFolderBtnR\.onclick = \(\) => openLocalImportChooser\(\)/);
  assert.match(editorSource, /TEXT_EXT = \/\\\.\(txt\|md\|markdown/);
});

test('oversized text files keep a UTF-8-safe prefix instead of being skipped', () => {
  for (const source of [appSource, editorSource]) {
    assert.match(source, /file\.slice\(0, readSize\)\.arrayBuffer\(\)/);
    assert.match(source, /已保留前部内容/);
    assert.doesNotMatch(source, /file\.size > 5 \* 1024 \* 1024\) continue/);
  }
  assert.match(appSource, /LOCAL_MATERIAL_PROMPT_LIMIT_BYTES/);
  assert.match(editorSource, /EDITOR_LOCAL_MATERIAL_PROMPT_LIMIT_BYTES/);
});
