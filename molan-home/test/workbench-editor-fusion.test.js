'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const completionEditorSource = fs.readFileSync(path.join(__dirname, '..', 'completion-editor.js'), 'utf8');
const indexHtmlSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const storyWorkbenchHtml = fs.readFileSync(path.join(__dirname, '..', 'pages', 'story-workbench.html'), 'utf8');
const storyWorkbenchJs = fs.readFileSync(path.join(__dirname, '..', 'pages', 'story-workbench.js'), 'utf8');
const projectDocsJs = fs.readFileSync(path.join(__dirname, '..', 'pages', 'project-docs.js'), 'utf8');

test('工作台与AI编辑器联动：常驻Dock与四大面板定义', () => {
  // 1. 常驻Tab标签栏
  assert.match(completionEditorSource, /class="editor-ai-dock-tabs"/);
  assert.match(completionEditorSource, /data-dock="chat"[\s\S]*?AI助手/);
  assert.match(completionEditorSource, /data-dock="memory"[\s\S]*?故事记忆/);
  assert.match(completionEditorSource, /data-dock="docs"[\s\S]*?全套资料/);
  assert.match(completionEditorSource, /data-dock="outline"[\s\S]*?细纲伏笔/);

  // 2. 对应Dock视图容器
  assert.match(completionEditorSource, /data-ai-dock-view="chat"/);
  assert.match(completionEditorSource, /data-ai-dock-view="memory"/);
  assert.match(completionEditorSource, /data-ai-dock-view="docs"/);
  assert.match(completionEditorSource, /data-ai-dock-view="outline"/);

  // 3. 切换方法
  assert.match(completionEditorSource, /function switchAiDock\(dockName\)/);
  assert.match(completionEditorSource, /function renderMemoryDockView\(\)/);
  assert.match(completionEditorSource, /function renderDocsDockView\(\)/);
  assert.match(completionEditorSource, /function renderOutlineDockView\(\)/);
});

test('工作台与AI编辑器联动：/boost 与 /browser 核心功能与快捷指令', () => {
  // 1. /boost 全景增强方法与芯片
  assert.match(completionEditorSource, /function boostContextToPrompt\(\)/);
  assert.match(completionEditorSource, /data-completion-action="boost-context"/);
  assert.match(completionEditorSource, /🚀 全景联动增强 \/boost/);
  assert.match(completionEditorSource, /【项目创作工作台 · \/boost 全景智能联动增强】/);

  // 2. /browser 全景工作台方法与芯片
  assert.match(completionEditorSource, /function openFullWorkbenchBrowser\(\)/);
  assert.match(completionEditorSource, /data-completion-action="open-full-workbench-browser"/);
  assert.match(completionEditorSource, /全屏工作台 \/browser/);

  // 3. 提示词输入框快捷命令监听
  assert.match(completionEditorSource, /val === '\/boost'/);
  assert.match(completionEditorSource, /val === '\/browser'/);
  assert.match(completionEditorSource, /val === '\/memory'/);
  assert.match(completionEditorSource, /val === '\/docs'/);
});

test('工作台与AI编辑器联动：条目一键引用至AI提示词 (citeTextToPrompt)', () => {
  // 1. citeTextToPrompt 声明
  assert.match(completionEditorSource, /function citeTextToPrompt\(citeContent, sourceTitle = ''\)/);

  // 2. 各视图与弹窗均包含引用按钮
  assert.match(completionEditorSource, /data-completion-cite-to-prompt/);
  assert.match(completionEditorSource, /引用至AI/);

  // 3. 事件委托捕获引用点击
  assert.match(completionEditorSource, /const citeBtn = event\.target\.closest\('\[data-completion-cite-to-prompt\]'\);/);
});

test('工作台与AI编辑器联动：AI结果沉淀至工作台全套资料库', () => {
  // 1. AI结果操作行包含沉淀资料按钮
  assert.match(completionEditorSource, /data-completion-ai-save-dossier/);
  assert.match(completionEditorSource, /沉淀资料/);

  // 2. openQuickSaveDossierModal 函数定义与委托
  assert.match(completionEditorSource, /function openQuickSaveDossierModal\(resultIndex\)/);
  assert.match(completionEditorSource, /const saveDossierBtn = event\.target\.closest\('\[data-completion-ai-save-dossier\]'\);/);
});

test('工作台与AI编辑器联动：跨窗口 postMessage 双向桥梁与外壳联动条', () => {
  // 1. story-workbench.html 包含推送到AI编辑器按钮
  assert.match(storyWorkbenchHtml, /id="syncToEditor"/);
  assert.match(storyWorkbenchHtml, /推送到 AI 编辑器/);
  assert.match(storyWorkbenchHtml, /id="pushDraftToAiEditor"/);

  // 2. story-workbench.js 发送 postMessage
  assert.match(storyWorkbenchJs, /window\.parent\.postMessage\(\{ type: 'molan:navigate'/);
  assert.match(storyWorkbenchJs, /window\.parent\.postMessage\(\{\s*type: 'molan:apply-draft-to-editor'/);

  // 3. project-docs.js 返回编辑器通过 postMessage
  assert.match(projectDocsJs, /window\.parent\.postMessage\(\{ type: 'molan:navigate', page: 'editor'/);
  assert.match(projectDocsJs, /data-cite-id/);

  // 4. index.html 接收消息并联动
  assert.match(indexHtmlSource, /data\.type === 'molan:navigate'/);
  assert.match(indexHtmlSource, /data\.type === 'molan:apply-draft-to-editor'/);
  assert.match(indexHtmlSource, /class="workbench-fusion-bar"/);

  // 5. completion-editor.js 暴露宿主接收接口
  assert.match(completionEditorSource, /window\.MolanEditorApplyExternalDraft = function/);
  assert.match(completionEditorSource, /window\.MolanEditorCiteToPrompt = function/);
});

test('工作台与AI编辑器联动：知识库与资料中心全景实体聚合能力', () => {
  assert.match(completionEditorSource, /function getProjectCharacters\(state\)/);
  assert.match(completionEditorSource, /function getProjectWorldFacts\(state\)/);
  assert.match(completionEditorSource, /function getProjectForeshadows\(state\)/);

  // 验证聚合函数同时覆盖 ensureKnowledge(state)、state.entities 以及 projectDossier
  assert.match(completionEditorSource, /ensureKnowledge\(state\)/);
  assert.match(completionEditorSource, /projectDossier/);
});

test('工作台与AI编辑器联动：Slash 指令带参解析与输入体验防破坏', () => {
  // 验证 /boost 支持带参执行，而非仅严格全等
  assert.match(completionEditorSource, /val\.startsWith\('\/boost '\)/);
  assert.match(completionEditorSource, /val\.startsWith\('\/browser '\)/);

  // 验证消除了在 input 阶段过早触发覆盖用户输入的破坏性监听
  assert.doesNotMatch(completionEditorSource, /promptInput\.addEventListener\('input'[\s\S]*?val\.startsWith\('\/boost '\)/);

  // 验证全局 Enter 事件对 slash command 的安全防护
  assert.match(completionEditorSource, /if \(val\.startsWith\('\/'\)\) return;/);
});

test('工作台与AI编辑器联动：多标签页跨窗口与存储兜底流转', () => {
  // 验证 story-workbench 支持 window.opener 和 localStorage 兜底
  assert.match(storyWorkbenchJs, /window\.opener/);
  assert.match(storyWorkbenchJs, /molan_external_cite/);
  assert.match(storyWorkbenchJs, /molan_external_draft/);

  // 验证 project-docs 支持 window.opener 和 localStorage + 真实剪贴板兜底
  assert.match(projectDocsJs, /window\.opener/);
  assert.match(projectDocsJs, /molan_external_cite/);
  assert.match(projectDocsJs, /navigator\.clipboard\.writeText/);

  // 验证 index.html 监听外部 storage 广播并自动同步
  assert.match(indexHtmlSource, /event\.key === 'molan_external_cite'/);
  assert.match(indexHtmlSource, /event\.key === 'molan_external_draft'/);
});

