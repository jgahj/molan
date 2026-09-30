const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

require('./helpers/local-runtime').createLocalRuntime();
const server = require('../server');
const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const importSource = fs.readFileSync(path.join(__dirname, '..', 'completion-import.js'), 'utf8');
const editorSource = fs.readFileSync(path.join(__dirname, '..', 'completion-editor.js'), 'utf8');
const serverSource = ['server.js', 'services/creation-book-service.js', 'services/creation-core-job-runtime.js', 'services/creation-core-job-http-service.js'].map(file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n');
const novelWriteSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'novel-write-handlers.js'), 'utf8');

test('创书有独立任务入口并展示可持续查看的实时进度', () => {
  assert.match(indexSource, /data-page="creation"/);
  assert.match(indexSource, /creation:\s*\(\) =>/);
  assert.match(indexSource, /data-import-action="creation-new"/);
  assert.match(importSource, /function creationPage\(\)/);
  assert.match(importSource, /id="creationTaskList"/);
  assert.match(importSource, /function beginCreationTask\(input\)/);
  assert.match(importSource, /已产出 \$\{received\.toLocaleString\(\)\} 字符/);
  assert.match(importSource, /data-import-action="creation-cancel"/);
  assert.match(importSource, /renderers\.creation = creationPage/);
});

test('创书页面只保留头部的新建创书入口', () => {
  const pageStart = importSource.indexOf('function creationPage()');
  const pageEnd = importSource.indexOf('\n  function captureImportSession', pageStart);
  const pageSource = importSource.slice(pageStart, pageEnd);
  assert.equal((pageSource.match(/data-import-action="creation-new"/g) || []).length, 0);
  assert.equal((pageSource.match(/data-page="dissect"/g) || []).length, 1);
  assert.equal((indexSource.match(/data-import-action="creation-new"/g) || []).length, 1);
});

test('创书计划把章数、卷数、保留级别和线索权重归一化为可执行合同', () => {
  const plan = server.normalizeCreationPlan({
    totalChapters: 18,
    volumeCount: 3,
    chapterWordTarget: 3200,
    retention: { opening: 'keep', goldenFinger: 'tune', architecture: 'rewrite', rhythm: 'tune' },
    lines: [{ id: 'mystery', label: '谜团线', weight: 1 }, { id: 'revenge', label: '复仇线', weight: 0.7 }]
  });
  assert.equal(plan.totalChapters, 18);
  assert.equal(plan.volumeCount, 3);
  assert.equal(plan.chaptersPerVolume, 6);
  assert.deepEqual(plan.retention, { opening: 'keep', goldenFinger: 'tune', architecture: 'rewrite', rhythm: 'tune' });
  assert.equal(plan.lines[0].role, 'primary');
  assert.equal(plan.lines[1].weight, 0.7);
  assert.ok(server.creationPlanRules(plan).every(rule => /不迁移原作该项|功能节点顺序一致|具体事件链相似度/.test(rule.keep + rule.rewrite)));
});

test('1000 章创书会计算出足够的分卷、资源和故事弧目标', () => {
  const targets = server.creationPlanTargets({ totalChapters: 1000, volumeCount: 10 });
  assert.equal(targets.chapters, 1000);
  assert.equal(targets.volumes, 10);
  assert.equal(targets.characters, 14);
  assert.equal(targets.worldbuilding, 24);
  assert.equal(targets.worldRules, 18);
  assert.equal(targets.mapNodes, 25);
  assert.equal(targets.arcPlan, 50);
  assert.equal(targets.conflictChain, 50);
  assert.equal(targets.rewardChain, 50);
});

test('创书覆盖检查能识别章纲缺号、重复号和核心字段缺失', () => {
  const chapter = chapterNo => ({ chapterNo, title: `章节${chapterNo}`, goal: '确认本章具体目标', protagonistAction: '主角执行一项具体行动', opposition: '阻力迫使主角改变计划', informationChange: '获得新的关键信息', result: '行动造成不可逆结果', hook: '章末留下下一步问题' });
  const coverage = server.creationPlanCoverage({
    creationPlan: { totalChapters: 3, volumeCount: 1 },
    chapterPlan: [chapter(1), chapter(1), { chapterNo: 2, title: '残缺章节', goal: '只有目标' }]
  });
  assert.deepEqual(coverage.missingChapters, [3]);
  assert.deepEqual(coverage.invalidChapters, [2]);
  assert.deepEqual(coverage.duplicateChapters, [1]);
  assert.equal(coverage.completedThrough, 1);
  assert.equal(coverage.chaptersReady, false);
});

test('分批扩展会按卷名合并卷纲，并按章号合并章纲', () => {
  const chapter = chapterNo => ({ chapterNo, title: `章节${chapterNo}` });
  const volumes = server.__test.mergeCreationVolumes(
    [{ title: '第一卷', goal: '旧目标' }],
    [{ title: '第一卷', goal: '更新后的目标' }, { title: '第二卷', goal: '新目标' }]
  );
  assert.equal(volumes.length, 2);
  assert.equal(volumes[0].goal, '更新后的目标');
  const chapters = server.__test.mergeCreationChapterPlan([chapter(1), chapter(3)], [chapter(2)], 3);
  assert.deepEqual(chapters.map(item => item.chapterNo), [1, 2, 3]);
});

test('结构原创门禁对禁止复制项和相似度阈值分别给出阻断或待抽取状态', () => {
  const pending = server.creationOriginalityGate({}, {}, []);
  assert.equal(pending.status, 'pending');
  assert.ok(pending.missing.includes('eventChainSimilarity'));

  const blocked = server.creationOriginalityGate({}, { structureMetrics: {
    eventChainSimilarity: 0.4,
    roleCombinationSimilarity: 0.2,
    mapTopologySimilarity: 0.2,
    relationshipGraphSimilarity: 0.2,
    goldenFingerMechanismSimilarity: 0.2
  } }, []);
  assert.equal(blocked.status, 'blocked');
  assert.match(blocked.issues[0].description, /eventChainSimilarity/);
});

test('主创书表单和编辑器主链路包含真实的模型、Skill、预算与 CAS 入口', () => {
  assert.match(importSource, /creationTotalChapters/);
  assert.match(importSource, /creationVolumeCount/);
  assert.match(importSource, /creationOpeningRetention/);
  assert.match(importSource, /creationModelSelect/);
  assert.match(importSource, /creationSkillSelect/);
  assert.match(importSource, /creationBudget/);
  assert.match(importSource, /\/api\/creation-books/);
  assert.match(importSource, /novelState\.creationBookId = String\(creationBook\.id\)/);
  assert.match(editorSource, /\/chapter-contract/);
  assert.match(editorSource, /\/audit/);
  assert.match(editorSource, /contentHash/);
  assert.match(editorSource, /baseStateVersion/);
  assert.match(editorSource, /creationBookLinked/);
});

test('创书核心包由服务端任务生成，随后顺序扩展资源和完整章纲', () => {
  assert.doesNotMatch(importSource, /creationResultMissingFields/);
  assert.match(importSource, /核心创作圣经/);
  assert.match(importSource, /chapterPlan 与 scenePlan 可以为空数组/);
  assert.match(importSource, /runCreationCoreJobWithPolling\(/);
  assert.match(importSource, /\/api\/creation-books\/core-jobs/);
  assert.match(importSource, /\/plan-expand/);
  assert.match(importSource, /baseBibleVersion/);
  assert.match(importSource, /章纲扩展中 · 已完成/);
  assert.match(importSource, /正在扩展创作资源/);
  assert.match(importSource, /正在扩展章纲/);
  assert.match(indexSource, /completion-import\.js\?v=pro-craft-6/);
});

test('创书结果优先保留用户计划书名，模型自拟名只作为备选', () => {
  assert.match(importSource, /const finalTitle = String\(creationPlan\.title \|\| value\.title \|\| title/);
  assert.match(importSource, /novelState\.alternativeTitles = \[String\(generated\.title\)/);
});

test('服务端核心包任务可刷新存活、可重连且可取消', () => {
  assert.match(serverSource, /function runCreationCoreJob\(job\)/);
  assert.match(serverSource, /creationCoreRunningJobForBook/);
  assert.match(serverSource, /creation_checkpoint_pending/);
  assert.match(serverSource, /POST'   && u === '\/api\/creation-books\/core-jobs'/);
  assert.match(serverSource, /handleCreationCoreJobCancel/);
  assert.match(serverSource, /insertCreationBookPlaceholder/);
  assert.match(serverSource, /deleteCreationBookPlaceholder/);
  assert.match(importSource, /coreJobId: String\(value\.coreJobId \|\| ''\)/);
  assert.match(importSource, /api\/creation-books\/core-jobs\/\$\{encodeURIComponent\(jobId\)\}`, \{ method: 'DELETE' \}/);
});

test('创作书合同和审计沿用编辑器选择的模型，不再固定调用 DeepSeek', () => {
  assert.equal(server.resolveCreationModelId({ modelId: 'gpt-5.6-luna' }), 'gpt-5.6-luna');
  assert.equal(server.resolveCreationModelId({ modelId: 'not-configured' }), server.currentDefaultModel());

  const contractStart = serverSource.indexOf('async function handleCreationBookChapterContract');
  const auditStart = serverSource.indexOf('async function handleCreationBookChapterAudit');
  const contractSource = serverSource.slice(contractStart, auditStart);
  const auditSource = serverSource.slice(auditStart, serverSource.indexOf('// ★ R4 · 结构原创门禁', auditStart));
  assert.match(contractSource, /modelId: creationModelId/);
  assert.doesNotMatch(contractSource, /modelId:\s*['"]deepseek-v4-/);
  assert.match(auditSource, /modelId: creationModelId/);
  assert.doesNotMatch(auditSource, /modelId:\s*['"]deepseek-v4-/);
});

test('编辑器归一化创作书合同保留服务端审计必填字段', () => {
  assert.match(editorSource, /chapterNo:\s*Math\.max\(1, Number\(source\.chapterNo\) \|\| Number\(context\.chapterNo\) \|\| 1\)/);
  assert.match(editorSource, /protagonistAction:\s*text\(contractValue\(source/);
  assert.match(editorSource, /opposition:\s*text\(contractValue\(source/);
  assert.match(editorSource, /informationChange:\s*text\(contractValue\(source/);
  assert.match(editorSource, /irreversibleResult:\s*text\(contractValue\(source/);
});

test('平台级体验：离线横幅、网络错误文案与云端作品删除入口', () => {
  assert.match(indexSource, /id="offlineBanner"/);
  assert.match(indexSource, /window\.addEventListener\('offline', updateOfflineBanner\)/);
  assert.match(indexSource, /网络已断开，请检查网络连接后重试/);
  assert.match(indexSource, /data-backend-delete=/);
  assert.match(indexSource, /function deleteBackendNovel\(id\)/);
  assert.match(novelWriteSource, /function handleNovelSave\(req, res, id\)/);
  assert.match(novelWriteSource, /AND revision = \?'/);
  assert.match(novelWriteSource, /小说已在其他设备更新，请先同步最新版本/);
  assert.match(novelWriteSource, /function handleNovelDelete\(req, res, id\)/);
  assert.match(novelWriteSource, /projectScope\.DELETE_ROLES/);
  assert.match(novelWriteSource, /function handleNovelRestore\(req, res, id\)/);
  assert.match(novelWriteSource, /pm\.role = 'owner'/);
  assert.match(serverSource, /novelSave: novelWriteHandlers\.handleNovelSave/);
  assert.match(serverSource, /novelDelete: novelWriteHandlers\.handleNovelDelete/);
  assert.match(serverSource, /novelRestore: novelWriteHandlers\.handleNovelRestore/);
});

test('编辑器长篇防漂移：文风工坊/全局规则账/事实账本注入起草与审计', () => {
  const editorSource = fs.readFileSync(path.join(__dirname, '..', 'completion-editor.js'), 'utf8');
  assert.match(editorSource, /function buildStyleKitText\(bible\)/);
  assert.match(editorSource, /function buildGlobalLedgerText\(bible\)/);
  assert.match(editorSource, /function buildFactLedgerText\(ledger, entityNames\)/);
  assert.match(editorSource, /function mergeFactLedgerDelta\(ledger, delta, chapterNo, contentHash\)/);
  assert.match(editorSource, /全书事实账本（按出场对象检索的历史事实/);
  assert.match(editorSource, /const styleKit = buildStyleKitText\(creation\)/);
  assert.match(editorSource, /factLedger: buildFactLedgerText\(state\.factLedger, characters/);
  assert.match(editorSource, /factLedger: state\.factLedger \|\| null/);
});

test('作品资料中心的定位和专项素材进入正文生成上下文并绑定当前会话', () => {
  assert.match(editorSource, /function projectDossierContextText\(state\)/);
  assert.match(editorSource, /function ensureEditorUtilityActions\(\)/);
  assert.match(editorSource, /'open-outline'/);
  assert.match(editorSource, /'open-knowledge'/);
  assert.match(editorSource, /name === 'open-outline' \|\| name === 'open-knowledge'/);
  assert.match(editorSource, /dossier: dossierText/);
  assert.match(editorSource, /作品资料中心（定位、专项素材，只读引用）/);
  assert.match(editorSource, /dossier: context\.dossier/);
  assert.match(editorSource, /clearEditorConflictDraft\(state\)/);
  assert.match(editorSource, /版本冲突，草稿已暂存/);
});

test('作品资料中心可维护定位、专项素材并执行本地资料包导入导出', () => {
  assert.match(editorSource, /function ensureProjectDossier\(state\)/);
  assert.match(editorSource, /function openProjectDossier\(\)/);
  assert.match(editorSource, /function openDossierMaterials\(kind\)/);
  assert.match(editorSource, /function exportProjectDossier\(\)/);
  assert.match(editorSource, /function importProjectDossier\(\)/);
  assert.match(editorSource, /data-completion-dossier-action="export"/);
  assert.match(editorSource, /molan-local-project-package-v1/);
  assert.match(editorSource, /worldRules: \{ label: '世界规则'/);
  assert.match(editorSource, /powerSystems: \{ label: '能力体系'/);
  assert.match(editorSource, /historyEvents: \{ label: '历史事件'/);
  assert.match(editorSource, /function stateTimeline\(state\)/);
});

test('圣经工作台：资产重生成与质量报告入口', () => {
  const importSource = fs.readFileSync(path.join(__dirname, '..', 'completion-import.js'), 'utf8');
  assert.match(importSource, /async function openCreationBibleWorkbench\(bookId\)/);
  assert.match(importSource, /data-import-action="creation-bible"/);
  assert.match(importSource, /\/regenerate-asset`, \{ method: 'POST'/);
  assert.match(importSource, /\/quality-report`/);
});
