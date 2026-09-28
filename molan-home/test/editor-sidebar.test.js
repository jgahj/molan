const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const editorHtml = fs.readFileSync(path.join(__dirname, '..', 'pages', 'editor.html'), 'utf8');
const editorSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'editor.js'), 'utf8');
const completionEditorSource = fs.readFileSync(path.join(__dirname, '..', 'completion-editor.js'), 'utf8');
const homeSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const sidebarViews = {
  sheji: 'sbSheji',
  resources: 'sbResources',
  foreshadow: 'sbForeshadow',
  dagang: 'sbDagang',
  xigang: 'sbXigang',
  ai: 'sbAI',
  aidetect: 'sbAIDetect',
  recycle: 'sbRecycle',
  search: 'sbSearch'
};

test('keeps every editor sidebar tab mapped to its own view', () => {
  for (const [tab, view] of Object.entries(sidebarViews)) {
    assert.match(editorHtml, new RegExp('data-tab="' + tab + '"'));
    assert.match(editorHtml, new RegExp('id="' + view + '"'));
    assert.match(editorSource, new RegExp(tab + ": '" + view + "'"));
  }
});

test('uses accurate sidebar labels and exposes the matching workflows', () => {
  assert.match(editorHtml, /data-tab="xigang">章节目录/);
  assert.match(editorHtml, /aria-label="编辑器辅助面板"/);
  assert.match(editorSource, /function renderSidebarOutline\(\) \{[\s\S]*?ensureOutlineChapters\(\)/);
  assert.match(editorSource, /id="sidebarOutlineEdit"/);
  assert.match(editorSource, /kind: 'manuscript'/);
  assert.match(editorSource, /<option value="manuscript">正文<\/option>/);
  assert.match(editorSource, /item\.kind === 'manuscript'\) gotoChapter\(item\.id\)/);
});

test('keeps the visible editor model value aligned with its label and shared switcher', () => {
  assert.match(editorHtml, /<option value="gpt-5\.6-luna">GPT-5\.6 Luna<\/option>/);
  assert.match(editorSource, /function renderModelSelectOptions\(\)/);
  assert.match(editorSource, /function switchUnifiedModel\(modelId\)/);
});

test('exposes an explicit chapter creation entry for every volume', () => {
  assert.match(completionEditorSource, /function renderAddChapterButton\(volume\)/);
  assert.match(completionEditorSource, /class="button completion-add-chapter"/);
  assert.match(completionEditorSource, /data-completion-action="add-chapter"/);
  assert.match(completionEditorSource, /function addChapter\(volumeId\)/);
  assert.match(completionEditorSource, /scenes: \[\{ id: uid\('scene'\), name: '场景一', content: '' \}\]/);
});

test('keeps the AI assistant on the live chat array after persisting a prompt', () => {
  const start = completionEditorSource.indexOf('async function sendEditorAI()');
  const end = completionEditorSource.indexOf('\n  function resultAt(', start);
  assert.ok(start >= 0 && end > start, 'sendEditorAI should remain a standalone workflow');
  const source = completionEditorSource.slice(start, end);
  assert.match(source, /let records = chatRecords\(\);/);
  assert.match(source, /records\.push\(\{ kind: 'user', text: prompt \}\);[\s\S]*?persistEditorChatSession\(\);[\s\S]*?records = chatRecords\(\);/);
  assert.match(source, /records\.push\(\{ kind: 'assistant', text: '正在生成…' \}\);/);
});

test('recomputes the assistant index after trimming a full chat history', () => {
  const start = completionEditorSource.indexOf('async function sendEditorAI()');
  const end = completionEditorSource.indexOf('\n  function resultAt(', start);
  const source = completionEditorSource.slice(start, end);
  assert.match(source, /records\.push\(\{ kind: 'assistant', text: '正在生成…' \}\);[\s\S]*?trimCompletionHistory\(records\);[\s\S]*?const assistantIndex = records\.length - 1;/);
});

test('restores the editor thinking control and universal correction request', () => {
  assert.match(completionEditorSource, /data-completion-thinking-control/);
  assert.match(completionEditorSource, /COMPLETION_OFFICIAL_REASONING = \['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'\]/);
  assert.match(completionEditorSource, /correctionPolicy: true/);
  assert.match(completionEditorSource, /disableClientTimeout: true/);
  assert.doesNotMatch(completionEditorSource, /timeoutMs: 120000/);
  assert.match(homeSource, /options\.disableClientTimeout === true/);
  assert.match(completionEditorSource, /requestOptions\.reasoningEffort = thinkingControl\.value/);
  assert.match(completionEditorSource, /requestOptions\.thinking = thinkingControl\.value === 'on'/);
  assert.match(homeSource, /if \(options\.reasoningEffort != null\) body\.reasoningEffort = options\.reasoningEffort/);
  assert.match(homeSource, /else if \(body\.stage === 'writing'\) body\.correctionPolicy = true/);
});

test('streams editor deltas and keeps the generic chapter workflow stateful', () => {
  assert.match(homeSource, /options\.onDelta\(delta, answer\)/);
  assert.match(completionEditorSource, /chapterContracts: \{\}/);
  assert.match(completionEditorSource, /generationRuns: \[\]/);
  assert.match(completionEditorSource, /async function runChapterWorkflow\(/);
  assert.match(completionEditorSource, /jsonMode: true, returnUsage: true/);
  assert.match(completionEditorSource, /workflowStage: 'ready'/);
});
