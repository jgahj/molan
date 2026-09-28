'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const completionEditorSource = fs.readFileSync(path.join(__dirname, '..', 'completion-editor.js'), 'utf8');
const indexHtmlSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('completion-editor.js 集成了长篇记忆与文风稳定工作台 (openMemoryWorkbenchModal)', () => {
  // 1. 函数声明与参数支持 (initialTab, initialText)
  assert.match(completionEditorSource, /async function openMemoryWorkbenchModal\(initialTab = 'cognition', initialText = ''\)/);
  
  // 2. 六大核心 Tab 完整覆盖
  assert.match(completionEditorSource, /data-mwb-tab="cognition">人物私下认知 vs 表现/);
  assert.match(completionEditorSource, /data-mwb-tab="facts">世界事实与披露策略/);
  assert.match(completionEditorSource, /data-mwb-tab="timeline">时间系统与伏笔台账/);
  assert.match(completionEditorSource, /data-mwb-tab="style">文风监控与改写审查/);
  assert.match(completionEditorSource, /data-mwb-tab="changesets">变更集确认与正式提交/);
  assert.match(completionEditorSource, /data-mwb-tab="impact">修改影响分析/);

  // 3. API 调用闭环
  assert.match(completionEditorSource, /\/api\/books\/\$\{encodeURIComponent\(bookId\)\}\/workbench/);
  assert.match(completionEditorSource, /\/api\/books\/\$\{encodeURIComponent\(bookId\)\}\/cognition/);
  assert.match(completionEditorSource, /\/api\/books\/\$\{encodeURIComponent\(bookId\)\}\/timeline/);
  assert.match(completionEditorSource, /\/api\/books\/\$\{encodeURIComponent\(bookId\)\}\/styles/);
  assert.match(completionEditorSource, /\/api\/books\/\$\{encodeURIComponent\(bookId\)\}\/memory/);
  assert.match(completionEditorSource, /\/api\/books\/\$\{encodeURIComponent\(bookId\)\}\/style-audits/);
  assert.match(completionEditorSource, /\/api\/books\/\$\{encodeURIComponent\(bookId\)\}\/memory\/extract/);
  assert.match(completionEditorSource, /\/api\/books\/\$\{encodeURIComponent\(bookId\)\}\/memory\/changesets\/\$\{encodeURIComponent\(csId\)\}\/approve/);
  assert.match(completionEditorSource, /\/api\/books\/\$\{encodeURIComponent\(bookId\)\}\/memory\/changesets\/\$\{encodeURIComponent\(csId\)\}\/commit/);
  assert.match(completionEditorSource, /\/api\/books\/\$\{encodeURIComponent\(bookId\)\}\/impact-analysis/);
});

test('completion-editor.js 集成了全套资料库七大板块工作台 (openMaterialsSevenWorkbenchModal) 与插正文功能', () => {
  // 1. 存在七大板块全景工作台定义
  assert.match(completionEditorSource, /async function openMaterialsSevenWorkbenchModal\(\)/);
  
  // 2. 覆盖七大板块定义
  assert.match(completionEditorSource, /SEVEN_SECTIONS/);
  assert.match(completionEditorSource, /一、作品基础定位/);
  assert.match(completionEditorSource, /二、世界观设定/);
  assert.match(completionEditorSource, /三、人物设定/);
  assert.match(completionEditorSource, /四、剧情大纲/);
  assert.match(completionEditorSource, /五、专项细节设定/);
  assert.match(completionEditorSource, /六、写作执行与管理/);
  assert.match(completionEditorSource, /七、发布与后期/);

  // 3. 支持一键插正文
  assert.match(completionEditorSource, /function insertTextToEditor\(insertContent\)/);
  assert.match(completionEditorSource, /insertTextToEditor\(/);
});

test('completion-editor.js 工具栏与 AI 结果操作行包含直达入口与委托事件', () => {
  // 1. 编辑器顶部工具栏按钮
  assert.match(completionEditorSource, /data-completion-action="open-memory-workbench"/);
  assert.match(completionEditorSource, /data-completion-action="open-materials-seven"/);

  // 2. 正文编辑工具栏图标
  assert.match(completionEditorSource, /title="故事记忆、人物认知与文风稳定工作台"/);
  assert.match(completionEditorSource, /title="小说创作全套资料库（七大板块）"/);

  // 3. AI 结果操作行按钮
  assert.match(completionEditorSource, /data-completion-ai-memory-extract/);
  assert.match(completionEditorSource, /data-completion-ai-style-audit/);

  // 4. 事件委托中处理 AI 结果提取与质检并跳转工作台
  assert.match(completionEditorSource, /const aiMemoryExtract = event\.target\.closest\('\[data-completion-ai-memory-extract\]'\);/);
  assert.match(completionEditorSource, /void openMemoryWorkbenchModal\('changesets', text\);/);
  assert.match(completionEditorSource, /const aiStyleAudit = event\.target\.closest\('\[data-completion-ai-style-audit\]'\);/);
  assert.match(completionEditorSource, /void openMemoryWorkbenchModal\('style', text\);/);
});

test('index.html 导航与页面集成故事记忆中心与全套资料中心', () => {
  // 1. 侧边栏包含故事记忆与全套资料链接
  assert.match(indexHtmlSource, /data-page="story-workbench"/);
  assert.match(indexHtmlSource, /data-page="project-docs"/);

  // 2. 页面配置 pages 包含元数据
  assert.match(indexHtmlSource, /'story-workbench':\s*\{\s*eyebrow:\s*'STORY MEMORY'/);
  assert.match(indexHtmlSource, /'project-docs':\s*\{\s*eyebrow:\s*'PROJECT DOSSIER'/);

  // 3. resourcesPage 包含快捷入口按钮
  assert.match(indexHtmlSource, /data-page="story-workbench">\$\{icon\('brain'\)\}故事记忆工作台/);
  assert.match(indexHtmlSource, /data-page="project-docs">\$\{icon\('layers'\)\}全套创作资料/);

  // 4. renderPage 统一拦截跳转与作品绑定
  assert.match(indexHtmlSource, /if \(page === 'story-workbench'\) \{/);
  assert.match(indexHtmlSource, /if \(page === 'project-docs'\) \{/);
  assert.match(indexHtmlSource, /pages\/story-workbench\.html\?nid=/);
  assert.match(indexHtmlSource, /pages\/project-docs\.html\?nid=/);
});
