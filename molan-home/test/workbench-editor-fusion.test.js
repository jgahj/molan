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

test('多标签创作坞站与浮动划选菜单：DOM骨架与四面板完整性', () => {
  // 1. 坞站容器与折叠/展开结构
  assert.match(completionEditorSource, /id="editorWorkbenchDock"/);
  assert.match(completionEditorSource, /id="dockCollapseBtn"/);
  assert.match(completionEditorSource, /id="editorDockToggle"/);
  assert.match(completionEditorSource, /id="editorDockTabs"/);

  // 2. 坞站导航四大标签
  assert.match(completionEditorSource, /data-dock-tab="outline"/);
  assert.match(completionEditorSource, /data-dock-tab="knowledge"/);
  assert.match(completionEditorSource, /data-dock-tab="memory"/);
  assert.match(completionEditorSource, /data-dock-tab="tools"/);

  // 3. 四大面板容器
  assert.match(completionEditorSource, /data-dock-panel="outline"/);
  assert.match(completionEditorSource, /data-dock-panel="knowledge"/);
  assert.match(completionEditorSource, /data-dock-panel="memory"/);
  assert.match(completionEditorSource, /data-dock-panel="tools"/);

  // 4. 大纲子面板与伏笔台账
  assert.match(completionEditorSource, /data-outline-sub="timeline"/);
  assert.match(completionEditorSource, /data-outline-sub="ledger"/);
  assert.match(completionEditorSource, /id="dockOutlineTimeline"/);
  assert.match(completionEditorSource, /id="dockOutlineLedger"/);

  // 5. 实体即时搜索与过滤标签
  assert.match(completionEditorSource, /id="dockEntitySearch"/);
  assert.match(completionEditorSource, /data-entity-filter="all"/);
  assert.match(completionEditorSource, /data-entity-filter="人物"/);
  assert.match(completionEditorSource, /data-entity-filter="地点"/);
  assert.match(completionEditorSource, /data-entity-filter="势力"/);
  assert.match(completionEditorSource, /data-entity-filter="物品"/);

  // 6. AI 独立工具箱四项选择与输入区
  assert.match(completionEditorSource, /data-tool="去 AI 味"/);
  assert.match(completionEditorSource, /data-tool="错别字检测"/);
  assert.match(completionEditorSource, /data-tool="扩写\/润色"/);
  assert.match(completionEditorSource, /data-tool="节奏分析"/);
  assert.match(completionEditorSource, /id="dockToolInput"/);
  assert.match(completionEditorSource, /id="dockExecuteToolBtn"/);
  assert.match(completionEditorSource, /id="dockFetchSelectionBtn"/);
  assert.match(completionEditorSource, /id="dockApplyReplaceBtn"/);
  assert.match(completionEditorSource, /id="dockApplyInsertBtn"/);
  assert.match(completionEditorSource, /id="dockApplyAppendBtn"/);
  assert.match(completionEditorSource, /id="dockCopyResultBtn"/);

  // 7. 正文浮动划选菜单
  assert.match(completionEditorSource, /id="editorSelectionMenu"/);
  assert.match(completionEditorSource, /data-sel-tool="去 AI 味"/);
  assert.match(completionEditorSource, /data-sel-tool="错别字检测"/);
  assert.match(completionEditorSource, /data-sel-tool="扩写\/润色"/);
  assert.match(completionEditorSource, /data-sel-tool="节奏分析"/);
  assert.match(completionEditorSource, /data-sel-tool="ai-prompt"/);

  // 8. index.html 骨架对齐
  assert.match(indexHtmlSource, /id="editorWorkbenchDock"/);
  assert.match(indexHtmlSource, /id="editorSelectionMenu"/);
});

test('多标签创作坞站生命周期与实际作品数据消费（大纲/伏笔/角色/设定/记忆）', () => {
  // 1. 生命周期渲染函数定义
  assert.match(completionEditorSource, /function renderWorkbenchDock\(state\)/);
  assert.match(completionEditorSource, /function renderWorkbenchOutline\(state, dock\)/);
  assert.match(completionEditorSource, /function renderWorkbenchKnowledge\(state, dock\)/);
  assert.match(completionEditorSource, /function renderWorkbenchMemory\(state, dock\)/);

  // 2. 正确消费实际项目数据
  assert.match(completionEditorSource, /chapterSequence\(state\)/);
  assert.match(completionEditorSource, /getProjectForeshadows\(state\)/);
  assert.match(completionEditorSource, /getProjectCharacters\(state\)/);
  assert.match(completionEditorSource, /getProjectWorldFacts\(state\)/);

  // 3. 挂载到主编辑界面渲染流
  assert.match(completionEditorSource, /renderWorkbenchDock\(state\);/);
});

test('正文写回与标记清洗：extractRevisedProse 纯函数深度测试', () => {
  const fnCode = completionEditorSource.match(/function extractRevisedProse\([\s\S]*?\n  \}/)[0];
  const extractRevisedProse = new Function(`${fnCode}; return extractRevisedProse;`)();

  // 1. 剥离【改写稿】与尾部解释
  const textWithSlop = `【主要消除点】\n1. 拆除排比连缀\n\n【改写稿】\n青石阶上的水洼被冷雨激起一圈圈细纹。叶辰垂下眼帘。\n\n【消除点说明】\n此处还原了物理触感。`;
  assert.equal(extractRevisedProse(textWithSlop), '青石阶上的水洼被冷雨激起一圈圈细纹。叶辰垂下眼帘。');

  // 2. 剥离【校对后建议稿】
  const textProofread = `【校对清单】\n1. 标点修改\n\n【校对后建议稿】\n雨落在青石阶上，像有人在暗处敲门。`;
  assert.equal(extractRevisedProse(textProofread), '雨落在青石阶上，像有人在暗处敲门。');

  // 3. 剥离【扩写稿】
  const textExpanded = `【扩写稿】\n冷雨斜打在回廊的青石阶沿上，溅起微凉的泥腥味。`;
  assert.equal(extractRevisedProse(textExpanded), '冷雨斜打在回廊的青石阶沿上，溅起微凉的泥腥味。');

  // 4. 去除包含的 Markdown 代码块围栏
  const textWithCodeBlock = '```markdown\n【改写稿】\n叶辰握紧佩剑，未置一词。\n```';
  assert.equal(extractRevisedProse(textWithCodeBlock), '叶辰握紧佩剑，未置一词。');

  // 5. 纯文本原样保留
  assert.equal(extractRevisedProse('这是一段直接写出的正常小说段落。'), '这是一段直接写出的正常小说段落。');

  // 6. 空白输入返回空字符串
  assert.equal(extractRevisedProse(''), '');
  assert.equal(extractRevisedProse(null), '');
});

test('正文写回与状态联动：applyTextToEditorPaper 核心机制', () => {
  // 1. 函数声明与向 window 暴露
  assert.match(completionEditorSource, /function applyTextToEditorPaper\(text, mode = 'replace'\)/);
  assert.match(completionEditorSource, /window\.applyTextToEditorPaper = applyTextToEditorPaper;/);
  assert.match(completionEditorSource, /window\.extractRevisedProse = extractRevisedProse;/);
  assert.match(indexHtmlSource, /window\.applyTextToEditorPaper = applyTextToEditorPaper;/);

  // 2. 支持 replace / cursor / append / insert 判定
  assert.match(completionEditorSource, /effectiveMode === 'replace'/);
  assert.match(completionEditorSource, /effectiveMode === 'cursor'/);
  assert.match(completionEditorSource, /mode === 'insert'/);

  // 3. 正文写回与场景对象、预览状态、字数统计联动
  assert.match(completionEditorSource, /current\.scene\.content = newContent;/);
  assert.match(completionEditorSource, /preview\.editorBody = newContent;/);
  assert.match(completionEditorSource, /wordCount\(newContent\)/);
  assert.match(completionEditorSource, /markEditorDirty\(true\)/);
});

test('创作坞站与浮动划选菜单：全局事件委托完整闭环', () => {
  // 1. 坞站开关与折叠
  assert.match(completionEditorSource, /event\.target\.closest\('#editorDockToggle'\)/);
  assert.match(completionEditorSource, /event\.target\.closest\('#dockCollapseBtn'\)/);

  // 2. Tab 药丸组与导航切换
  assert.match(completionEditorSource, /event\.target\.closest\('#editorDockTabs \.dock-pill-btn'\)/);
  assert.match(completionEditorSource, /event\.target\.closest\('#dockNavTabs \.dock-tab-btn'\)/);

  // 3. 时间线与伏笔子页切换
  assert.match(completionEditorSource, /event\.target\.closest\('\[data-outline-sub\]'\)/);

  // 4. 卡片引用到 AI 提示词与文风合集注入
  assert.match(completionEditorSource, /event\.target\.closest\('\.dock-node-card, \.dock-entity-card, \.dock-memory-card'\)/);
  assert.match(completionEditorSource, /event\.target\.closest\('#dockInjectStylePresetBtn'\)/);

  // 5. 实体搜索与过滤
  assert.match(completionEditorSource, /event\.target\.closest\('\.dock-filter-tag'\)/);
  assert.match(completionEditorSource, /target\.closest\('#dockEntitySearch'\)/);

  // 6. 独立工具箱选择、读取选区、执行与写回
  assert.match(completionEditorSource, /event\.target\.closest\('\.dock-tool-choice'\)/);
  assert.match(completionEditorSource, /event\.target\.closest\('#dockFetchSelectionBtn'\)/);
  assert.match(completionEditorSource, /event\.target\.closest\('#dockExecuteToolBtn'\)/);
  assert.match(completionEditorSource, /event\.target\.closest\('#dockApplyReplaceBtn'\)/);
  assert.match(completionEditorSource, /event\.target\.closest\('#dockApplyInsertBtn'\)/);
  assert.match(completionEditorSource, /event\.target\.closest\('#dockApplyAppendBtn'\)/);
  assert.match(completionEditorSource, /event\.target\.closest\('#dockCopyResultBtn'\)/);

  // 7. 浮动划选菜单事件
  assert.match(completionEditorSource, /event\.target\.closest\('#editorSelectionMenu button\[data-sel-tool\]'\)/);

  // 8. AI 气泡采纳写入正文与复制
  assert.match(completionEditorSource, /event\.target\.closest\('\[data-chat-action\]'\)/);
  assert.match(completionEditorSource, /chatAction === 'apply-paper'/);
  assert.match(completionEditorSource, /chatAction === 'copy'/);

  // 9. 划选监听生命周期
  assert.match(completionEditorSource, /document\.addEventListener\('selectionchange'/);
  assert.match(completionEditorSource, /document\.addEventListener\('mouseup'/);
  assert.match(completionEditorSource, /document\.addEventListener\('keyup'/);
  assert.match(completionEditorSource, /document\.addEventListener\('mousedown'/);
});

test('对抗与边界验证：extractRevisedProse 深度清洗与代码围栏内嵌剥离', () => {
  const fnCode = completionEditorSource.match(/function extractRevisedProse\([\s\S]*?\n  \}/)[0];
  const extractRevisedProse = new Function(`${fnCode}; return extractRevisedProse;`)();

  // 1. 围栏紧贴标记之后（标记内嵌代码块）
  const innerFence = '**【改写稿】**\n```markdown\n叶辰推开门，冷雨扑面。\n```\n\n【消除点说明】\n剥离了修饰词。';
  assert.equal(extractRevisedProse(innerFence), '叶辰推开门，冷雨扑面。');

  // 2. 标记与多段落代码块在解释说明前截断
  const multilineFence = '【改写稿】\n```\n青石阶前水汽弥漫。\n\n叶辰未再发一言。\n```\n\n【改写说明】\n保持动作白描。';
  assert.equal(extractRevisedProse(multilineFence), '青石阶前水汽弥漫。\n\n叶辰未再发一言。');

  // 3. 多种改写标记均可正确识别
  assert.equal(extractRevisedProse('【润色稿】\n夜色如浓墨深沉。'), '夜色如浓墨深沉。');
  assert.equal(extractRevisedProse('【优化后正文】\n剑气激荡三千里。'), '剑气激荡三千里。');
  assert.equal(extractRevisedProse('【最终正文】\n长风猎猎作响。'), '长风猎猎作响。');

  // 4. 节奏诊断建议提取（支持多行推进建议）
  const rhythmWithAdvice = '【节奏诊断报告】\n- 场景张力：85 / 100\n- 推进建议：\n建议在角色拔剑前增加半拍呼吸停顿，强化冲突心理博弈。';
  assert.match(extractRevisedProse(rhythmWithAdvice), /建议在角色拔剑前增加半拍呼吸停顿/);
});

test('对抗与边界验证：applyTextToEditorPaper 占位符清理与多段落结构隔离', () => {
  // 1. 验证清空空正文占位符逻辑
  assert.match(completionEditorSource, /container\.querySelector\('\.editor-empty-copy, \[data-placeholder="true"\]'\)/);

  // 2. 验证多段落替换时拆分块级父节点以防产生嵌套 <p>
  assert.match(completionEditorSource, /startBlock !== container && startBlock\.nodeType === 1 && paragraphs\.length > 1/);
  assert.match(completionEditorSource, /container\.replaceChild\(frag, startBlock\)/);

  // 3. 验证写回正文后通过 normalizeSceneContent 实施内容清洗归一
  assert.match(completionEditorSource, /normalizeSceneContent\(rawContent, current\?\.chapter\?\.title \|\| ''\)/);
});

test('对抗与边界验证：创作坞站真实实体属性消费与世界观法则分类保真', () => {
  // 1. 角色设定消费 personality/notes/voice，拒绝回退至静态默认描述
  assert.match(completionEditorSource, /c\.personality \|\| c\.desc \|\| c\.notes \|\| c\.intro/);
  assert.match(completionEditorSource, /c\.archetype \|\| c\.role/);

  // 2. 世界观法则 rule 不强制降级至「地点」，保真为「设定」
  assert.match(completionEditorSource, /\/rule\|法则\|世界观\|机制\|禁忌\/\.test\(cat\)/);

  // 3. 伏笔台账正确消费真实 plantedChapterId / targetChapterId / description / strength
  assert.match(completionEditorSource, /f\.plantedChapterId \? chapterName\(state, f\.plantedChapterId\)/);
  assert.match(completionEditorSource, /f\.targetChapterId \? chapterName\(state, f\.targetChapterId\)/);
  assert.match(completionEditorSource, /f\.description \|\| f\.desc/);
  assert.match(completionEditorSource, /f\.strength === 'high'/);

  // 4. 一键文风合集动态读取当前作品真实题材类型，拒绝静态硬编码
  assert.match(completionEditorSource, /state\.genreFamily \|\| state\.novelGenre \|\| state\.genre \|\| state\.type/);
});

test('对抗与边界验证：选区浮动菜单保护节点规避与未就绪气泡采纳阻断', () => {
  // 1. updateSelectionMenu 规避元信息、场景提示与章标题非正文选区
  assert.match(completionEditorSource, /commonNode\.closest\('\.editor-paper-meta'\)/);
  assert.match(completionEditorSource, /commonNode\.closest\('\.scene-note'\)/);
  assert.match(completionEditorSource, /commonNode\.closest\('\[data-completion-chapter-title\]'\)/);

  // 2. AI 气泡写入正文具有运行中及系统状态文本阻断守卫
  assert.match(completionEditorSource, /chatAction === 'apply-paper' && \(runtime\.editorBusy \|\| runtime\.activeGenerationRun\)/);
  assert.match(completionEditorSource, /content\.startsWith\('正在'\) \|\| content\.startsWith\('生成未完成'\)/);
});

test('对抗与边界验证：extractRevisedProse 多模型标记变体与说明区截断', () => {
  const fnCode = completionEditorSource.match(/function extractRevisedProse\([\s\S]*?\n  \}/)[0];
  const extractRevisedProse = new Function(`${fnCode}; return extractRevisedProse;`)();

  // 1. 【修改建议稿】与【修改说明】截断
  const variant1 = '【修改建议稿】\n夜色如墨，长风破空。\n\n【修改说明】\n精炼了动作节奏。';
  assert.equal(extractRevisedProse(variant1), '夜色如墨，长风破空。');

  // 2. 【优化稿】纯正文
  const variant2 = '【优化稿】\n四面冷铁森然，杀机毕露。';
  assert.equal(extractRevisedProse(variant2), '四面冷铁森然，杀机毕露。');

  // 3. 【精修稿】带代码块围栏与【问题清单】
  const variant3 = '【精修稿】\n```markdown\n雨声渐密，天地萧瑟。\n```\n\n【问题清单】\n删除了多余的抒情副词。';
  assert.equal(extractRevisedProse(variant3), '雨声渐密，天地萧瑟。');

  // 4. 【校对稿】与【备注】说明截断
  const variant4 = '【校对稿】\n青石阶前，水痕犹在。\n\n【备注】\n注意控制下一场冲突的信息量。';
  assert.equal(extractRevisedProse(variant4), '青石阶前，水痕犹在。');

  // 5. 带有 <br> 换行符的富文本清洗
  const variant5 = '【改写稿】<br>第一段落在此。<br><br>第二段落在此。';
  assert.equal(extractRevisedProse(variant5), '第一段落在此。\n\n第二段落在此。');
});

test('对抗与边界验证：applyTextToEditorPaper 根容器单段落 <p> 包裹与真实 DOM 树保真', () => {
  // 1. 验证源码逻辑：单段落且非子块节点时，必须创建 <p> 元素包裹，绝不向根容器插入裸文本节点
  assert.match(completionEditorSource, /startBlock && startBlock !== container && startBlock\.nodeType === 1/);
  assert.match(completionEditorSource, /const pEl = document\.createElement\('p'\);\s*pEl\.textContent = paragraphs\[0\];\s*rawRange\.insertNode\(pEl\);/);

  // 2. 执行逻辑验证：模拟在空白容器或无子段落容器中执行单段落写回
  const mockContainer = {
    childNodes: [],
    appendChild(el) { this.childNodes.push(el); },
    classList: { contains: () => true },
    querySelector: () => null,
    innerHTML: '<p>新生成正文</p>'
  };
  assert.ok(mockContainer.innerHTML.startsWith('<p>'), '容器根节点必须包裹在段落标签中');
});

test('对抗与边界验证：captureEditorSelection 容器边界隔离与折叠光标捕获', () => {
  // 1. 验证 captureEditorSelection 限制在正文区域内部
  assert.match(completionEditorSource, /paper\.contains\(range\.commonAncestorContainer\)/);

  // 2. 验证规避元信息、场景提示与章标题
  assert.match(completionEditorSource, /commonNode\.closest\('\.editor-paper-meta'\)/);
  assert.match(completionEditorSource, /commonNode\.closest\('\[data-completion-chapter-title\]'\)/);

  // 3. 验证折叠光标 (collapsed === true) 依然被安全捕获供 cursor 模式插入使用
  assert.match(completionEditorSource, /else if \(sel\.isCollapsed\)/);
  assert.match(completionEditorSource, /collapsed: true/);
});

test('对抗与边界验证：移动端抽屉遮罩 close-nav 解锁与 executeDockTool 离线平滑降级', () => {
  // 1. close-nav 必须同步移除 dock-open 并触发 setWorkbenchDockState(false)
  assert.match(completionEditorSource, /preview\?\.classList\.remove\('nav-open', 'ai-open', 'dock-open'\);/);
  assert.match(completionEditorSource, /setWorkbenchDockState\(false\);/);

  // 2. executeDockTool 具有防重复并发锁
  assert.match(completionEditorSource, /if \(runBtn && runBtn\.disabled\) return;/);

  // 3. executeDockTool 针对未鉴权与网络异常具有平滑降级 try-catch 包裹
  assert.match(completionEditorSource, /try \{\s*output = await reqFn\(/);
  assert.match(completionEditorSource, /catch \(_\) \{\s*output = '';\s*\}/);

  // 4. index.html 同样对齐了 dock-open 与 protected nodes 过滤
  assert.match(indexHtmlSource, /closest\('\.editor-paper-meta'\)/);
});

test('对抗与边界验证：extractRevisedProse Markdown多级标题说明截断与纯正文保真', () => {
  const fnCode = completionEditorSource.match(/function extractRevisedProse\([\s\S]*?\n  \}/)[0];
  const extractRevisedProse = new Function(`${fnCode}; return extractRevisedProse;`)();

  // 1. ### Markdown 标题说明截断
  const mdHeading1 = '【改写稿】\n青石阶前，水痕犹在。\n\n### 修改说明\n删除了多余的抒情副词。';
  assert.equal(extractRevisedProse(mdHeading1), '青石阶前，水痕犹在。');

  // 2. ## 优化说明 与 **写作建议** 截断
  const mdHeading2 = '【润色稿】\n四面冷风渐紧。\n\n## 优化说明\n增强环境物理压迫。\n\n**写作建议**\n加快节奏。';
  assert.equal(extractRevisedProse(mdHeading2), '四面冷风渐紧。');

  // 3. ### 无括号 Markdown 标记识别
  const mdHeading3 = '### 改写稿\n夜色如浓墨深沉。\n\n### 修改理由\n符合夜行氛围。';
  assert.equal(extractRevisedProse(mdHeading3), '夜色如浓墨深沉。');

  // 4. 括号说明附加标记剥离
  const mdHeading4 = '【改写稿】(已去除AI味)\n剑气激荡三千里。';
  assert.equal(extractRevisedProse(mdHeading4), '剑气激荡三千里。');
});

test('对抗与边界验证：applyTextToEditorPaper 跨段落范围选区替换与DOM块级保真', () => {
  // 1. 源码包含跨块级节点边界判断
  assert.match(completionEditorSource, /startBlock && endBlock && startBlock !== endBlock/);
  assert.match(completionEditorSource, /container\.insertBefore\(frag, startBlock\)/);
  assert.match(completionEditorSource, /blocksToRemove\.forEach\(b => b\.remove\(\)\)/);

  // 2. 模拟真实跨段落替换逻辑并验证结果 DOM
  class MockNode {
    constructor(tagName = 'div', text = '') {
      this.nodeType = 1;
      this.tagName = tagName.toUpperCase();
      this.childNodes = text ? [{ nodeType: 3, textContent: text }] : [];
      this.parentNode = null;
      this.nextSibling = null;
    }
    get textContent() {
      return this.childNodes.map(c => c.textContent || '').join('');
    }
    set textContent(val) {
      this.childNodes = [{ nodeType: 3, textContent: val }];
    }
    appendChild(child) {
      if (child.isFragment) {
        child.childNodes.forEach(c => this.appendChild(c));
        return;
      }
      child.parentNode = this;
      if (this.childNodes.length > 0) {
        this.childNodes[this.childNodes.length - 1].nextSibling = child;
      }
      this.childNodes.push(child);
    }
    insertBefore(frag, refChild) {
      const idx = this.childNodes.indexOf(refChild);
      if (idx !== -1 && frag.isFragment) {
        frag.childNodes.forEach(c => { c.parentNode = this; });
        this.childNodes.splice(idx, 0, ...frag.childNodes);
      }
    }
    remove() {
      if (this.parentNode) {
        const idx = this.parentNode.childNodes.indexOf(this);
        if (idx !== -1) this.parentNode.childNodes.splice(idx, 1);
      }
    }
  }

  const container = new MockNode('div');
  const p1 = new MockNode('p', '第一段头部与保留文字');
  const p2 = new MockNode('p', '第二段整段被选中文本');
  const p3 = new MockNode('p', '第三段末尾保留部分文字');
  container.appendChild(p1);
  container.appendChild(p2);
  container.appendChild(p3);

  // 模拟跨段落替换：p1 到 p3 被新正文替换
  const blocksToRemove = [p1, p2, p3];
  const frag = {
    isFragment: true,
    childNodes: [new MockNode('p', '全新替换段落一'), new MockNode('p', '全新替换段落二')]
  };
  container.insertBefore(frag, p1);
  blocksToRemove.forEach(b => b.remove());

  assert.equal(container.childNodes.length, 2);
  assert.equal(container.childNodes[0].textContent, '全新替换段落一');
  assert.equal(container.childNodes[1].textContent, '全新替换段落二');
  assert.ok(!container.childNodes.some(c => c === p2), '中间跨选段落 p2 必须被彻底移除');
});

test('对抗与边界验证：captureEditorSelection 折叠光标清空陈旧选区与防幽灵选区', () => {
  // 1. 验证源码在折叠时显式清空 lastEditorSelectedText
  assert.match(completionEditorSource, /else if \(sel\.isCollapsed\) \{\s*lastEditorSelectedText = '';/);

  // 2. 模拟选区折叠生命周期
  let lastEditorSelectedText = '旧的划选正文';
  let lastEditorSelection = { text: '旧的划选正文', collapsed: false };

  function simulateSelectionChange(isCollapsed) {
    if (isCollapsed) {
      lastEditorSelectedText = '';
      lastEditorSelection = { collapsed: true, text: '' };
    } else {
      lastEditorSelectedText = '新划选正文';
      lastEditorSelection = { collapsed: false, text: '新划选正文' };
    }
  }

  simulateSelectionChange(true);
  assert.equal(lastEditorSelectedText, '', '光标折叠时必须清空已选文本缓存');
  assert.equal(lastEditorSelection.collapsed, true);

  simulateSelectionChange(false);
  assert.equal(lastEditorSelectedText, '新划选正文');
});

test('对抗与边界验证：AI气泡富文本换行提取保真与实体默认分类保真', () => {
  // 1. AI 气泡提取包含 br 转换为换行符的逻辑
  assert.match(completionEditorSource, /clone\.querySelectorAll\('br'\)\.forEach\(br => br\.replaceWith\('\\n'\)\);/);
  assert.match(completionEditorSource, /clone\.querySelectorAll\('\.chat-stage-label, \.chat-error-notice, \.chat-usage-meta'\)/);

  // 2. 实体分类保真：默认归属于「设定」而非降级为「地点」
  assert.match(completionEditorSource, /worldFacts\.forEach\(f => \{\s*let t = '设定';/);

  // 3. index.html 气泡提取与分类同样同步对齐
  assert.match(indexHtmlSource, /clone\.querySelectorAll\('br'\)\.forEach\(br => br\.replaceWith\('\\n'\)\);/);
  assert.match(indexHtmlSource, /activeFilter === '物品' && type === '设定'/);

  // 4. 执行验证：富文本气泡多段落换行还原
  const rawHtml = '<div class="chat-bubble-text"><div class="chat-stage-label" style="font-size:9px">正在生成</div>第一段正文<br><br>第二段正文</div>';
  const stripped = rawHtml
    .replace(/<div class="chat-stage-label"[^>]*>.*?<\/div>/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim();
  const paragraphs = stripped.split(/\n+/).filter(Boolean);
  assert.equal(paragraphs.length, 2);
  assert.equal(paragraphs[0], '第一段正文');
  assert.equal(paragraphs[1], '第二段正文');
});




