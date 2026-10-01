const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const testDataDir = require('./helpers/local-runtime').createLocalRuntime();
const { normalizeUsage, buildUsageSummary, creditCostForTokens, creditCostForUser, normalizeModelCreditRate, savePlatformModelRates, savePlatformModelRate, reservationCostForRequest, planCreditReservation, creditMultiplierForUser, normalizeUserRole, isAdminUser, recordTokenUsage, reserveCredits, settleTokenUsage, getUsageSummary, reasoningEffortsForModel, splitDynamicPrompt, validateChatMessages, serializedMessageBytes, stablePromptCacheKey, buildSkillAudit, stripSkillBlocks, prepareSkillMessagesForUpstream, canChooseModel, currentDefaultModel, resolveModelForUser, createPasswordRecord, verifyPassword, hashSessionToken, getAuthUser, sessions, loadSessions, flushSessionsSync, saveUser, estimateTextTokenUpperBound, promptTokenUpperBound, contextWindowTokensForModel, planContextWindow, reservationTokenUpperBound, loadBuiltinSkills, uniqueSkillsById, skillPromptFiles, skillPromptInstruction, autoFixJson, salvageDissectionStageResult, emptyDissectionResult, normalizeDissectionStageResult, dissectionResultView, mergeDissectionResult, dissectionResultHasContent, dissectionResultHasCompleteContent, dissectionStageMissingFields, dissectionResultMissingFields, normalizeDissectionInput } = require('../server');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const homeSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const editorSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'editor.js'), 'utf8');
const dissectSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'dissect.js'), 'utf8');
const completionImportSource = fs.readFileSync(path.join(__dirname, '..', 'completion-import.js'), 'utf8');

test('keeps universal and mode-specific Skills in both client pipelines', () => {
  const activeModePattern = /function activeSkillsForMode\(mode\)[\s\S]*?return candidates\.filter\(skill => \{[\s\S]*?return modes\.includes\(mode\) \|\| modes\.includes\('all'\);/;
  assert.match(appSource, activeModePattern);
  assert.match(editorSource, activeModePattern);
});

test('preserves a complete writing draft when the humanizer stage fails', () => {
  for (const source of [appSource, editorSource]) {
    assert.match(source, /if \(draft && handlers\.onReplaceText\) handlers\.onReplaceText\(draft\)/);
    assert.match(source, /partialText: draft/);
  }
});

test('keeps Luna as the default and routes editor AI calls through one model', () => {
  assert.match(serverSource, /findPlatformModel\('gpt-5\.6-luna'\)/);
  assert.match(appSource, /let HOME_DEFAULT_MODEL = 'gpt-5\.6-luna'/);
  assert.match(editorSource, /let SERVER_DEFAULT_MODEL = 'gpt-5\.6-luna'/);
  assert.match(editorSource, /body\.model = currentUnifiedModel\(\)/);
});

test('records the supported pipeline stage in Skill audit metadata', () => {
  assert.match(serverSource, /const stage = \['skill_analysis', 'writing', 'humanizer', 'single'\]/);
  assert.match(serverSource, /skillAudit = \{ \.\.\.skillAudit, stage \}/);
  assert.match(serverSource, /stage: String\(skillAudit\.stage \|\| 'single'\)/);
});

test('runs Skill planning when requested and applies universal correction to every writing task', () => {
  for (const source of [appSource, editorSource]) {
    assert.match(source, /const shouldAnalyzeSkill = opts\.analyzeSkill === true/);
    assert.match(source, /const shouldHumanize = \(opts\.humanize === true \|\| payload\.humanize === true\)/);
    assert.match(source, /const shouldCorrection = mode === 'write' && opts\.correction !== false && payload\.correction !== false/);
    assert.match(source, /if \(!shouldAnalyzeSkill && !shouldHumanize && !shouldCorrection\) \{\s*return streamChat/);
    assert.match(source, /messages: appendAnalysisContext\(payload\.messages\)/);
  }
});

test('chapter generation records the staged workflow and synchronizes chapter state', () => {
  assert.match(editorSource, /chapterCalls: \[\]/);
  assert.match(editorSource, /先核对写作 Skill、纠错库、上一章和章节调用表/);
  assert.match(editorSource, /validateChapterDraft\(buf/);
  assert.match(editorSource, /syncChapterStateAfterCommit\(/);
  assert.match(editorSource, /target\.callId/);
  assert.match(editorSource, /chat-msg-workflow/);
});

test('recalls task-relevant novel context instead of sending the entire manuscript', () => {
  assert.match(editorSource, /function buildDynamicContext\(taskText\)/);
  assert.match(editorSource, /scoreContextEntity\(entity, seedLower, terms, explicit\)/);
  assert.match(editorSource, /currentText\.slice\(-4200\)/);
  assert.doesNotMatch(editorSource, /addBlock\('完整正文'/);
  assert.doesNotMatch(editorSource, /addBlock\('完整知识库实体'/);
});

test('defaults writing requests to high reasoning when the user has no override', () => {
  assert.match(editorSource, /state\.settings\.reasoningEffort\) \|\| \(skillMode === 'write' \? 'high' : ''\)/);
});

test('keeps raw model reasoning separate from the visible Skill analysis', () => {
  assert.match(editorSource, /chat-msg-skill-analysis/);
  assert.match(editorSource, /chat-msg-thinking-panel/);
  assert.match(appSource, /skill-analysis/);
  assert.match(appSource, /det\.open = false/);
});

test('home streaming reads final finish reasons and provider reasoning aliases', () => {
  assert.match(appSource, /setFinishReason\(usage\.finishReason\)/);
  assert.match(appSource, /usage\.status === 'truncated'/);
  assert.match(appSource, /choice\.delta\.reasoning_content \|\| choice\.delta\.reasoning \|\| choice\.delta\.thinking/);
});

test('does not reintroduce the removed silent material/context caps', () => {
  assert.doesNotMatch(appSource, /MATERIAL_CAP|FILE_CAP/);
  assert.doesNotMatch(editorSource, /MATERIAL_CAP|FILE_CAP/);
});

test('loads the fiction style skill with its referenced runtime files', () => {
  const skill = loadBuiltinSkills().find(item => item && item.id === 'extract-transform-fiction-style');
  assert.ok(skill);
  assert.match(skill.instruction, /mode: apply/);
  assert.match(skill.instruction, /references\/feature-schema\.md/);
  assert.match(skill.instruction, /assets\/style-profile\.schema\.json/);
  assert.match(skill.instruction, /assets\/portable-style-skill-template\.md/);
  assert.ok(skill.files.includes('SKILL.md'));
  assert.ok(skill.files.includes('references/feature-schema.md'));
  assert.ok(skill.files.includes('agents/openai.yaml'));
  assert.equal(typeof skill.runtimeFiles['SKILL.md'], 'string');
  assert.equal(typeof skill.runtimeFiles['assets/style-profile.schema.json'], 'string');
  assert.equal(skill.complete, true);

  const root = path.join(__dirname, '..', 'skills', 'extract-transform-fiction-style');
  const entries = [];
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    if (entry.isFile()) entries.push(path.relative(root, absolute).replace(/\\/g, '/'));
  });
  walk(root);
  assert.deepEqual([...skill.files].sort(), entries.sort());
  entries.forEach(relative => {
    const raw = fs.readFileSync(path.join(root, relative));
    if (raw.includes(0)) return;
    assert.equal(skill.runtimeFiles[relative], raw.toString('utf8'));
  });
});

test('normalizes structured dissection aliases and rejects an empty result', () => {
  const normalized = normalizeDissectionStageResult({
    dissection_map: {
      overview: { positioning: '成长型玄幻', summary: '主角在压力中获得主动权。' },
      world_building: [{ name: '宗门体系', summary: '以等级和资源制造冲突。' }]
    },
    style_profile: { summary: '近距离限知视角，节奏随冲突收紧。' },
    craft_constraints: [{ name: '章末钩子', rule: '用具体未决问题推动下一章。' }]
  });
  assert.ok(normalized);
  assert.equal(normalized.overview.positioning, '成长型玄幻');
  assert.equal(normalized.worldbuilding[0].name, '宗门体系');
  assert.equal(normalized.styleProfile.summary, '近距离限知视角，节奏随冲突收紧。');
  assert.equal(mergeDissectionResult(emptyDissectionResult(), normalized).craftConstraints.length, 1);
  assert.equal(dissectionResultHasContent(normalized), true);
  const emptyStage = normalizeDissectionStageResult({ overview: {}, worldbuilding: [], styleProfile: { version: '1.0', confidence: 0 } });
  assert.ok(emptyStage);
  assert.equal(dissectionResultHasContent(emptyStage), false);
});

test('repairs a model response with a missing opening quote on an object key', () => {
  const repaired = autoFixJson('{"overview":{"positioning":"成长型玄幻",\n  sellingPoints":["雨夜追杀"]},"framework":{"mainline":"进入宗门"}}');
  assert.ok(repaired);
  assert.deepEqual(repaired.overview.sellingPoints, ['雨夜追杀']);
  assert.equal(repaired.framework.mainline, '进入宗门');

  const repairedArray = autoFixJson('{"opening":{"beats":[{"position":"第一章","event":"危机"},\n  "position":"第二章",\n  protagonistGoal":"继续调查"}]}}');
  assert.ok(repairedArray);
  assert.equal(repairedArray.opening.beats[1].position, '第二章');
  assert.equal(repairedArray.opening.beats[1].protagonistGoal, '继续调查');

  const repairedMembers = autoFixJson('{"characters":[{"name":"沈砚","firstAppearance":第一章开篇，雨夜醒来"}],"worldbuilding":[{"category":"item","name":"青冥草","detail":"试炼目标","significance":"任务"\n {"category":"item","name":"断玉佩","detail":"留下的信物","significance":"悬念"}],"evidenceLedger":[{"type":"sample","observation":"发生冲突","confidence":0.8,"status":"candidate}]}');
  assert.ok(repairedMembers);
  assert.equal(repairedMembers.characters[0].firstAppearance, '第一章开篇，雨夜醒来');
  assert.equal(repairedMembers.worldbuilding.length, 2);
  assert.equal(repairedMembers.evidenceLedger[0].status, 'candidate');
});

test('salvages stage fields independently when one top-level JSON section is damaged', () => {
  const salvaged = salvageDissectionStageResult('{"characters":[{"name":"主角"}],"relationships":[{"from":"主角","to":"对手"}],"worldbuilding":[{"category":"location","name":"城门"}],"evidenceLedger":[{"source":"#1","observation":"冲突早出现"}]}', 'entities');
  assert.ok(salvaged);
  assert.equal(salvaged.characters[0].name, '主角');
  assert.equal(salvaged.worldbuilding[0].name, '城门');
  assert.equal(salvaged.evidenceLedger[0].source, '#1');
});

test('requires all dissection stages and accepts an explicit absent golden finger', () => {
  const incomplete = {
    overview: { positioning: '都市悬疑' }, framework: { mainline: '调查真相' }, dissectionMap: { repeatedPatterns: ['逐步升级'] },
    architecture: { structuralPattern: '三段推进' }, opening: { hook: '异常来电' },
    characters: [{ name: '主角' }], evidenceLedger: [{ source: '片段 1', observation: '冲突早出现' }],
    outline: [{ position: '开篇', goal: '查明来源' }], styleProfile: { summary: '近距离限知' }
  };
  assert.equal(dissectionResultHasCompleteContent(incomplete), false);
  assert.ok(dissectionResultMissingFields(incomplete).includes('structure: goldenFinger'));
  assert.ok(dissectionResultMissingFields(incomplete).includes('validate: validation'));
  assert.ok(dissectionStageMissingFields('structure', { articleArchitecture: { structuralPattern: '三段推进' }, openingRhythm: { hook: '异常来电' }, golden_finger: { exists: false, type: 'none' } }).length === 0);

  const complete = {
    ...incomplete,
    goldenFinger: { exists: false, type: 'none', confidence: 0.9 },
    emotion: { emotionCurve: [{ position: '第3章', intensity: 7, type: '紧张' }] },
    validation: { notes: ['字段齐全，金手指明确判定为不存在'], missingFields: [], portableRules: [] },
    foreshadowing: []
  };
  assert.equal(dissectionResultHasCompleteContent(complete), true);
});

test('allows creation to use completed dissection list summaries and validates details before generation', () => {
  assert.match(completionImportSource, /function dissectionTaskAvailableForCreation\(task\)/);
  assert.match(completionImportSource, /task\.hasResult === true && !Object\.prototype\.hasOwnProperty\.call\(task, 'result'\)/);
  assert.match(completionImportSource, /tasks = creationDissectionTasks\(backendState\.tasks\)/);
  assert.match(completionImportSource, /const detail = await requestCreationBackend\(`\/api\/dissections\/\$\{encodeURIComponent\(taskId\)\}`/);
});

test('keeps long creation requests alive without wall-clock timeouts', () => {
  // 核心包已改为服务端任务；规划扩展/审核按“拆书创书不设超时”原则取消固定时长。
  assert.match(completionImportSource, /'\/api\/creation-books\/core-jobs'/);
  assert.match(completionImportSource, /, 0, null\);/);
  assert.match(serverSource, /MOLAN_UPSTREAM_IDLE_TIMEOUT_MS', 0, 0, 600000\)/);
  assert.match(completionImportSource, /waitTimer = window\.setInterval\(updateWaitLabel, 1000\)/);
  assert.match(homeSource, /let timedOut = false/);
  assert.match(homeSource, /timeoutError\.code = 'REQUEST_TIMEOUT'/);
  assert.match(completionImportSource, /const hasTimeout = Number\(timeoutMs\) > 0;/);
});

test('reports timeout only from an upstream timeout marker', () => {
  assert.match(homeSource, /chunk\.molan_error/);
  assert.match(homeSource, /\[408, 504\]\.includes\(response\.status\)/);
  assert.match(homeSource, /error\.code = 'REQUEST_TIMEOUT'/);
});

test('prefers populated dissection aliases and records normalized source files', () => {
  const view = dissectionResultView({ architecture: {}, articleArchitecture: { structuralPattern: '阶段递进' }, opening: {}, openingRhythm: { hook: '突发事件' } });
  assert.equal(view.architecture.structuralPattern, '阶段递进');
  assert.equal(view.opening.hook, '突发事件');

  const input = normalizeDissectionInput({
    files: [
      { name: 'a.txt', text: '第一章\n相同内容', size: 18, encoding: 'gb18030' },
      { name: 'b.txt', text: '第一章\n相同内容', size: 18, encoding: 'utf-8' },
      { name: 'empty.txt', text: '', size: 0 }
    ],
    text: '补充样文'
  });
  assert.match(input.source, /文件：a\.txt/);
  assert.match(input.source, /粘贴内容/);
  assert.equal(input.sourceFiles.filter(item => item.included).length, 1);
  assert.equal(input.duplicateFileCount, 1);
  assert.equal(input.ignoredFileCount, 1);
  assert.equal(input.sourceFiles.find(item => item.name === 'a.txt').encoding, 'gb18030');
  assert.match(input.sourceFiles.find(item => item.name === 'a.txt').sha1, /^[a-f0-9]{40}$/);
});

test('binds the dedicated dissection Skill to every analysis stage', () => {
  assert.match(serverSource, /extract-transform-fiction-style/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'services', 'skill-service.js'), 'utf8'), /promptInstruction \|\| skill\.instruction/);
  assert.match(serverSource, /promptFiles: skillPromptFilesForRun/);
  assert.match(serverSource, /stage: 'skill_analysis'/);
  assert.match(serverSource, /reasoningEffort: 'none'/);
  assert.match(dissectSource, /拆书结果不完整/);
  assert.match(dissectSource, /重新分析/);
  assert.match(dissectSource, /文本编码无法识别/);
  assert.match(serverSource, /stageInput/);
});

test('bundles the writing and task Skills once with complete manifests', () => {
  const skills = loadBuiltinSkills();
  const ids = skills.map(item => item && item.id).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ['extract-transform-fiction-style', 'humanizer', 'mars-style-pure-xuanhuan-writing', 'write-high-tension-fiction']) {
    const skill = skills.find(item => item && item.id === id);
    assert.ok(skill, 'missing bundled Skill: ' + id);
    assert.equal(skill.complete, true);
    assert.ok(skill.files.includes('SKILL.md'));
    assert.ok(skill.promptFiles.includes('SKILL.md'));
    assert.ok(skill.promptInstruction.length > 0);
  }
});

test('deduplicates built-in, global, and personal Skill ids by priority', () => {
  const result = uniqueSkillsById([
    { id: 'same', source: 'builtin', name: 'same skill' },
    { id: 'global-same', source: 'global', name: 'same skill' },
    { id: 'user-0123456789ab-local-same-skill', source: 'user', name: 'same skill' },
    { id: 'other', source: 'builtin', name: 'other' }
  ]);
  assert.deepEqual(result.map(item => item.id), ['user-0123456789ab-local-same-skill', 'other']);
  assert.equal(result[0].name, 'same skill');
  assert.equal(result[0].source, 'user');
});

test('strictly verifies the exact Skill instruction and file manifest in a prompt', () => {
  const skill = loadBuiltinSkills().find(item => item && item.id === 'extract-transform-fiction-style');
  assert.ok(skill);
  const encodedId = encodeURIComponent(skill.id);
  const messages = [{
    role: 'system',
    content: '[MOLAN_SKILL_BLOCK_BEGIN id=' + encodedId + ']\n' + skill.instruction + '\n[MOLAN_SKILL_BLOCK_END id=' + encodedId + ']'
  }];
  const audit = buildSkillAudit({ user: { email: 'skill-audit@example.com' } }, messages, {
    version: 1,
    skills: [{ id: skill.id, name: skill.name, files: skill.files, fileManifest: skill.fileManifest }]
  });
  assert.equal(audit.status, 'verified');
  assert.deepEqual(audit.actualSkillIds, [skill.id]);
  assert.equal(audit.skills[0].verification, 'server-match');
  assert.equal(audit.skills[0].instructionHash.length, 64);
  assert.ok(audit.skills[0].fileHashes.length >= 3);
  assert.equal(stripSkillBlocks(messages)[0].content.includes('MOLAN_SKILL_BLOCK'), false);
});

test('keeps the complete Skill instruction and text files in the upstream prompt', () => {
  const skill = loadBuiltinSkills().find(item => item && item.id === 'extract-transform-fiction-style');
  assert.ok(skill);
  const encodedId = encodeURIComponent(skill.id);
  const messages = [{
    role: 'system',
    content: '[MOLAN_SKILL_BLOCK_BEGIN id=' + encodedId + ']\n' + skill.instruction + '\n[MOLAN_SKILL_BLOCK_END id=' + encodedId + ']'
  }, { role: 'user', content: '请按 dissect 模式分析样本。' }];
  const audit = buildSkillAudit({ user: { email: 'skill-forwarding@example.com' } }, messages, {
    version: 1,
    skills: [{ id: skill.id, name: skill.name, files: skill.files, fileManifest: skill.fileManifest }]
  });
  assert.equal(audit.status, 'verified');
  const prepared = prepareSkillMessagesForUpstream({ user: { email: 'skill-forwarding@example.com' } }, messages, audit);
  assert.equal(prepared.skillAudit.forwarding.status, 'verified');
  assert.deepEqual(prepared.skillAudit.forwarding.skills[0].forwardedTextFiles.sort(), [
    'assets/portable-style-skill-template.md',
    'assets/style-profile.schema.json',
    'agents/openai.yaml',
    'references/correction-patterns.md',
    'references/feature-schema.md',
    'references/interaction-workflow.md',
    'references/portability-spec.md'
  ].sort());
  assert.match(prepared.messages[0].content, /mode: apply/);
  assert.match(prepared.messages[0].content, /references\/feature-schema\.md/);
  assert.doesNotMatch(prepared.messages[0].content, /MOLAN_SKILL_BLOCK_BEGIN/);
});

test('audits the complete Skill directory and forwards instruction-bearing files', () => {
  const skill = loadBuiltinSkills().find(item => item && item.id === 'extract-transform-fiction-style');
  assert.ok(skill);
  assert.deepEqual(skillPromptFiles(skill), skill.promptFiles);
  assert.equal(skillPromptInstruction(skill), skill.promptInstruction);
  // ★ P1-5 · 仓库级元数据（agents/ 运行器配置）保留在 files 审计清单中，但不进入 prompt 注入
  assert.ok(skill.files.includes('agents/openai.yaml'));
  assert.ok(!skill.promptFiles.includes('agents/openai.yaml'));
  assert.deepEqual([...skill.promptFiles].sort(), [...skill.files].filter(file => !file.startsWith('agents/')).sort());
  assert.match(skill.promptInstruction, /\"required\":\s*\[/);

  const encodedId = encodeURIComponent(skill.id);
  const messages = [{
    role: 'system',
    content: '[MOLAN_SKILL_BLOCK_BEGIN id=' + encodedId + ']\n' + skill.promptInstruction + '\n[MOLAN_SKILL_BLOCK_END id=' + encodedId + ']'
  }, { role: 'user', content: '请按 apply 模式改写当前文本。' }];
  const audit = buildSkillAudit({ user: { email: 'skill-prompt@example.com' } }, messages, {
    version: 1,
    skills: [{ id: skill.id, name: skill.name, files: skill.files, fileManifest: skill.fileManifest, promptFiles: skill.promptFiles }]
  });
  assert.equal(audit.status, 'verified');
  const prepared = prepareSkillMessagesForUpstream({ user: { email: 'skill-prompt@example.com' } }, messages, audit);
  const forwarding = prepared.skillAudit.forwarding.skills[0];
  assert.equal(forwarding.status, 'verified');
  // agents/openai.yaml 未选入 promptFiles，进入 omitted 清单而非注入上游提示词
  assert.deepEqual([...forwarding.omittedTextFiles].sort(), ['agents/openai.yaml']);
  assert.deepEqual([...forwarding.forwardedTextFiles].sort(), skill.promptFiles.filter(file => file !== 'SKILL.md').sort());
  assert.match(prepared.messages[0].content, /\"required\":\s*\[/);
});

test('accepts a verified Skill prompt subset for staged dissection', () => {
  const skill = loadBuiltinSkills().find(item => item && item.id === 'extract-transform-fiction-style');
  assert.ok(skill);
  const promptFiles = ['SKILL.md', 'references/feature-schema.md', 'assets/style-profile.schema.json'];
  const encodedId = encodeURIComponent(skill.id);
  const messages = [{
    role: 'system',
    content: '[MOLAN_SKILL_BLOCK_BEGIN id=' + encodedId + ']\n' + skillPromptInstruction(skill, promptFiles) + '\n[MOLAN_SKILL_BLOCK_END id=' + encodedId + ']'
  }, { role: 'user', content: '<!-- molan-dynamic-context-v2 -->\n请按 dissect 模式分析样本。' }];
  const audit = buildSkillAudit({ user: { email: 'dissection-skill@example.com' } }, messages, {
    version: 1,
    skills: [{ id: skill.id, name: skill.name, files: skill.files, fileManifest: skill.fileManifest, promptFiles }]
  });
  assert.equal(audit.status, 'verified');
  assert.equal(audit.skills[0].verification, 'server-match');
  const prepared = prepareSkillMessagesForUpstream({ user: { email: 'dissection-skill@example.com' } }, messages, audit);
  assert.equal(prepared.skillAudit.forwarding.status, 'verified');
  assert.deepEqual(prepared.skillAudit.forwarding.skills[0].forwardedTextFiles.sort(), [
    'assets/style-profile.schema.json',
    'references/feature-schema.md'
  ].sort());
  assert.ok(prepared.skillAudit.forwarding.skills[0].omittedTextFiles.length > 0);
});

test('marks a tampered Skill prompt as unverified', () => {
  const skill = loadBuiltinSkills().find(item => item && item.id === 'extract-transform-fiction-style');
  const encodedId = encodeURIComponent(skill.id);
  const messages = [{
    role: 'system',
    content: '[MOLAN_SKILL_BLOCK_BEGIN id=' + encodedId + ']\ntampered instruction\n[MOLAN_SKILL_BLOCK_END id=' + encodedId + ']'
  }];
  const audit = buildSkillAudit({ user: { email: 'skill-audit@example.com' } }, messages, {
    skills: [{ id: skill.id, name: skill.name, files: skill.files, fileManifest: skill.fileManifest }]
  });
  assert.equal(audit.status, 'unverified');
  assert.equal(audit.skills[0].verification, 'instruction-mismatch');
});

test('marks a declared Skill that is absent from the prompt as unverified', () => {
  const skill = loadBuiltinSkills().find(item => item && item.id === 'extract-transform-fiction-style');
  assert.ok(skill);
  const audit = buildSkillAudit({ user: { email: 'skill-audit@example.com' } }, [], {
    version: 1,
    skills: [{ id: skill.id, name: skill.name, files: skill.files, fileManifest: skill.fileManifest }]
  });
  assert.equal(audit.status, 'unverified');
  assert.equal(audit.skills[0].verification, 'declared-not-in-prompt');
});

test('normalizes OpenAI-compatible usage and reasoning details', () => {
  assert.deepEqual(normalizeUsage({
    prompt_tokens: 120,
    completion_tokens: 80,
    completion_tokens_details: { reasoning_tokens: 30 },
    total_tokens: 200
  }), {
    promptTokens: 120,
    completionTokens: 80,
    reasoningTokens: 30,
    totalTokens: 200,
    cachedTokens: null,
    cacheWriteTokens: null,
    usageSource: 'upstream'
  });
});

test('supports input/output aliases and derives total only from returned counts', () => {
  assert.deepEqual(normalizeUsage({ input_tokens: 12, output_tokens: 8 }), {
    promptTokens: 12,
    completionTokens: 8,
    reasoningTokens: null,
    totalTokens: 20,
    cachedTokens: null,
    cacheWriteTokens: null,
    usageSource: 'upstream'
  });
  assert.equal(normalizeUsage({}).totalTokens, null);
  assert.equal(normalizeUsage({}).usageSource, 'unavailable');
});

test('aggregates precise and unavailable requests separately', () => {
  assert.deepEqual(buildUsageSummary([
    { promptTokens: 10, completionTokens: 5, reasoningTokens: 2, totalTokens: 15 },
    { promptTokens: null, completionTokens: null, reasoningTokens: null, totalTokens: null }
  ]), {
    totalTokens: 15,
    promptTokens: 10,
    completionTokens: 5,
    reasoningTokens: 2,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    requestCount: 2,
    preciseRequestCount: 1,
    usageUnavailableCount: 1,
    inputTokens: 10,
    outputTokens: 5,
    cacheHitRate: 0
  });
});

test('normalizes provider prompt-cache accounting', () => {
  assert.deepEqual(normalizeUsage({
    prompt_tokens: 2400,
    completion_tokens: 120,
    total_tokens: 2520,
    prompt_tokens_details: { cached_tokens: 2048, cache_write_tokens: 0 }
  }), {
    promptTokens: 2400,
    completionTokens: 120,
    reasoningTokens: null,
    totalTokens: 2520,
    cachedTokens: 2048,
    cacheWriteTokens: 0,
    usageSource: 'upstream'
  });
});

test('calculates cache hit rate from provider prompt counts', () => {
  const summary = buildUsageSummary([
    { promptTokens: 2400, completionTokens: 120, totalTokens: 2520, cachedTokens: 2048, cacheWriteTokens: 0 },
    { promptTokens: 1000, completionTokens: 100, totalTokens: 1100, cachedTokens: 500, cacheWriteTokens: 500 }
  ]);
  assert.equal(summary.cachedTokens, 2548);
  assert.equal(summary.cacheWriteTokens, 500);
  assert.equal(summary.cacheHitRate, 0.7494);
});

test('keeps dynamic context after the cache breakpoint', () => {
  const messages = splitDynamicPrompt([
    { role: 'system', content: 'stable rules\n\n<!-- molan-dynamic-context-v2 -->\nprivate novel state' },
    { role: 'user', content: 'current request' }
  ]);
  assert.deepEqual(messages, [
    { role: 'system', content: 'stable rules' },
    { role: 'system', content: 'private novel state' },
    { role: 'user', content: 'current request' }
  ]);
});

test('supports dynamic dissection context in a user message', () => {
  const messages = splitDynamicPrompt([
    { role: 'system', content: 'stable rules' },
    { role: 'user', content: '<!-- molan-dynamic-context-v2 -->\nprivate novel state' },
    { role: 'user', content: '请只返回 JSON' }
  ]);
  assert.deepEqual(messages, [
    { role: 'system', content: 'stable rules' },
    { role: 'user', content: 'private novel state' },
    { role: 'user', content: '请只返回 JSON' }
  ]);
  const plan = planContextWindow({ provider: 'openai-compat', contextWindowTokens: 4096 }, messages, 512);
  assert.equal(plan.dynamicPromptTruncated, false);
  assert.ok(plan.dynamicPromptTokens > 0);
});

test('preserves the planning task while trimming oversized dynamic context', () => {
  const marker = '<!-- molan-dynamic-context-v2 -->';
  const messages = splitDynamicPrompt([
    { role: 'system', content: '章节执行卡规划规则' },
    { role: 'user', content: `用户任务：规划下一章的章节执行卡\n\n${marker}\n${'当前作品上下文'.repeat(20000)}` }
  ]);
  const plan = planContextWindow(
    { provider: 'openai-compat', contextWindowTokens: 16384 },
    messages,
    900
  );
  assert.equal(plan.ok, true);
  assert.equal(plan.dynamicPromptTruncated, true);
  assert.ok(plan.dynamicPromptTokens < plan.originalDynamicPromptTokens);
  assert.equal(plan.messages.some(message => String(message.content || '').includes(marker)), false);
  assert.match(plan.messages[1].content, /用户任务：规划下一章的章节执行卡/);
});

test('does not let later empty dissection fields erase earlier stage results', () => {
  const prior = {
    ...emptyDissectionResult(),
    framework: { mainline: '主角主动调查真相' },
    evidenceLedger: [{ source: '片段 1', observation: '危机在开篇出现' }]
  };
  const merged = mergeDissectionResult(prior, { framework: [], evidenceLedger: [], validation: { uncertain: [], conflicts: [], notes: [] } });
  assert.deepEqual(merged.framework, prior.framework);
  assert.deepEqual(merged.evidenceLedger, prior.evidenceLedger);
});

test('rejects placeholder-only dissection stages and accepts empty validation lists', () => {
  assert.ok(dissectionStageMissingFields('map', {
    overview: { positioning: 'unknown' },
    framework: { mainline: 'unknown' },
    dissectionMap: { summary: '未提供正文或人物材料' }
  }).length > 0);
  assert.equal(dissectionStageMissingFields('validate', {
    validation: { uncertain: [], conflicts: [], notes: [], missingFields: [], portableRules: [] }
  }).length, 0);
});

test('bounds oversized chat messages while keeping their front and valid UTF-8', () => {
  assert.deepEqual(validateChatMessages([
    { role: 'system', content: 'stable rules' },
    { role: 'user', content: 'current request' }
  ]), [
    { role: 'system', content: 'stable rules' },
    { role: 'user', content: 'current request' }
  ]);
  assert.throws(() => validateChatMessages([{ role: 'unknown', content: 'x' }]), /消息角色不受支持/);
  assert.throws(() => validateChatMessages(Array.from({ length: 129 }, () => ({ role: 'user', content: 'x' }))), /消息数量过多/);
  const ascii = 'x'.repeat(2 * 1024 * 1024 + 1);
  const boundedAscii = validateChatMessages([{ role: 'user', content: ascii }]);
  assert.equal(boundedAscii.length, 1);
  assert.ok(serializedMessageBytes(boundedAscii[0]) <= 2 * 1024 * 1024);
  assert.ok(boundedAscii[0].content.startsWith('x'.repeat(200)));
  assert.match(boundedAscii[0].content, /已保留前部内容/);

  const cjk = '前'.repeat(900000) + '😀尾部';
  const boundedCjk = validateChatMessages([{ role: 'user', content: cjk }]);
  assert.ok(serializedMessageBytes(boundedCjk[0]) <= 2 * 1024 * 1024);
  assert.ok(boundedCjk[0].content.startsWith('前'.repeat(200)));
  assert.match(boundedCjk[0].content, /已保留前部内容/);
  assert.doesNotMatch(boundedCjk[0].content, /�/);
});

test('uses official reasoning effort values per GPT family', () => {
  assert.deepEqual(reasoningEffortsForModel({ id: 'gpt-5.6', model: 'gpt-5.6', supportsReasoning: true }), [
    'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'
  ]);
  assert.deepEqual(reasoningEffortsForModel({ id: 'gpt-5.5', model: 'gpt-5.5', supportsReasoning: true }), [
    'none', 'low', 'medium', 'high', 'xhigh'
  ]);
});

test('提示缓存按稳定账户隔离，并区分不同私有前缀', () => {
  const shared = [{ role: 'system', content: 'shared stable instructions' }];
  const privatePrefix = [{ role: 'system', content: 'private skill instructions' }];
  assert.notEqual(stablePromptCacheKey('a@example.com', 'gpt-5.6', shared), stablePromptCacheKey('b@example.com', 'gpt-5.6', shared));
  assert.notEqual(stablePromptCacheKey('a@example.com', 'gpt-5.6', shared), stablePromptCacheKey('a@example.com', 'gpt-5.6', privatePrefix));
});

test('credit cost is calculated from exact total tokens', () => {
  assert.equal(creditCostForTokens('unknown-model', 1000), 0.18);
  assert.equal(creditCostForTokens('gpt-5.6-luna', 15111), 2.72);
  assert.equal(creditCostForTokens('unknown-model', null), 0);
});

test('estimates CJK prompts as tokens instead of UTF-8 bytes', () => {
  const content = '玄天宗与叶辰在山门前交谈，轮回神玉的气息引起了长老注意。'.repeat(100);
  const messages = [{ role: 'system', content }, { role: 'user', content: '请继续创作。' }];
  const byteLength = Buffer.byteLength(JSON.stringify(messages), 'utf8');
  const textEstimate = estimateTextTokenUpperBound(content);
  const promptEstimate = promptTokenUpperBound(messages);
  const reservation = reservationTokenUpperBound(messages, 8192);
  assert.ok(textEstimate > content.length);
  assert.ok(textEstimate < byteLength);
  assert.ok(promptEstimate < byteLength);
  assert.equal(reservation, promptEstimate + 8192 + 128);
});

test('plans output against the selected model context window', () => {
  assert.equal(contextWindowTokensForModel({ provider: 'deepseek' }), 65536);
  assert.equal(contextWindowTokensForModel({ provider: 'openai-compat', contextWindowTokens: 16384 }), 16384);

  const capped = planContextWindow(
    { provider: 'openai-compat', contextWindowTokens: 16384 },
    [{ role: 'user', content: '请继续写作。' }],
    20000
  );
  assert.equal(capped.ok, true);
  assert.equal(capped.cappedByContext, true);
  assert.ok(capped.maxTokens >= 256);
  assert.ok(capped.maxTokens < 20000);

  const exceeded = planContextWindow(
    { provider: 'openai-compat', contextWindowTokens: 16384 },
    [{ role: 'system', content: '玄'.repeat(11000) }],
    8192
  );
  assert.equal(exceeded.ok, false);
  assert.equal(exceeded.code, 'context_window_exceeded');
  assert.equal(exceeded.contextWindowTokens, 16384);
});

test('preserves fixed Skill context while trimming only dynamic novel context', () => {
  const marker = '<!-- molan-dynamic-context-v2 -->';
  const messages = splitDynamicPrompt([
    { role: 'system', content: '完整 Skill 与系统规则\n\n' + marker + '\n' + '当前作品动态内容'.repeat(20000) },
    { role: 'user', content: '继续写作' }
  ]);
  const plan = planContextWindow(
    { provider: 'openai-compat', contextWindowTokens: 16384 },
    messages,
    4096
  );
  assert.equal(plan.ok, true);
  assert.equal(plan.dynamicPromptTruncated, true);
  assert.ok(plan.dynamicPromptTokens < plan.originalDynamicPromptTokens);
  assert.ok(plan.fixedPromptTokens > 0);
  assert.equal(plan.messages.some(message => String(message.content || '').includes(marker)), false);
  assert.match(plan.messages[0].content, /完整 Skill 与系统规则/);
  assert.ok(plan.promptTokens + 512 + plan.maxTokens <= plan.contextWindowTokens);
});

test('reports fixed prompt overflow instead of dropping complete Skill context', () => {
  const plan = planContextWindow(
    { provider: 'openai-compat', contextWindowTokens: 4096 },
    [{ role: 'system', content: '完整 Skill 与素材'.repeat(5000) }],
    256
  );
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'context_window_exceeded');
  assert.equal(plan.fixedPromptExceeded, true);
  assert.ok(plan.fixedPromptTokens > plan.contextWindowTokens);
  assert.ok(plan.overflowTokens > 0);
});

test('admin can update a model rate and the account multiplier remains effective', () => {
  const configFile = path.join(testDataDir, 'config.json');
  const previousConfig = fs.readFileSync(configFile, 'utf8');
  const config = JSON.parse(previousConfig);
  const modelConfig = config.platformModels && config.platformModels[0];
  assert.ok(modelConfig && modelConfig.id);
  const modelId = modelConfig.id;
  const originalRate = Number(modelConfig.creditsPer1k);
  assert.equal(normalizeModelCreditRate(originalRate), originalRate);
  try {
    const updated = savePlatformModelRate(modelId, originalRate * 2);
    assert.equal(updated.modelId, modelId);
    assert.equal(updated.creditsPer1k, Math.round(originalRate * 2 * 10000) / 10000);
    const base = creditCostForTokens(modelId, 1000);
    assert.equal(creditCostForUser({ email: 'normal-rate-test@example.com', role: 'normal' }, modelId, 1000), Math.round(base * 2 * 100) / 100);
    assert.equal(creditCostForUser({ email: 'vip-rate-test@example.com', role: 'vip' }, modelId, 1000), base);
    assert.throws(() => normalizeModelCreditRate(0), /0\.01/);
    assert.throws(() => normalizeModelCreditRate(1000.01), /1000/);
  } finally {
    try { savePlatformModelRate(modelId, originalRate); } catch (_) {}
    fs.writeFileSync(configFile, previousConfig, 'utf8');
  }
});

test('updates multiple model rates atomically', () => {
  const configFile = path.join(testDataDir, 'config.json');
  const previousConfig = fs.readFileSync(configFile, 'utf8');
  const config = JSON.parse(previousConfig);
  const modelConfigs = (config.platformModels || []).filter(item => item && item.id).slice(0, 2);
  assert.ok(modelConfigs.length >= 2);
  const originals = modelConfigs.map(item => ({ modelId: item.id, creditsPer1k: Number(item.creditsPer1k) }));
  const updates = originals.map((item, index) => ({ modelId: item.modelId, creditsPer1k: item.creditsPer1k + index + 0.25 }));
  try {
    const saved = savePlatformModelRates(updates);
    assert.deepEqual(saved.map(item => item.modelId), updates.map(item => item.modelId));
    const changedConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    updates.forEach(item => {
      const current = changedConfig.platformModels.find(model => model.id === item.modelId);
      assert.equal(current.creditsPer1k, item.creditsPer1k);
    });

    const beforeInvalid = fs.readFileSync(configFile, 'utf8');
    assert.throws(() => savePlatformModelRates([
      updates[0],
      { modelId: updates[1].modelId, creditsPer1k: 0 }
    ]), /0\.01/);
    assert.equal(fs.readFileSync(configFile, 'utf8'), beforeInvalid);
  } finally {
    savePlatformModelRates(originals);
    fs.writeFileSync(configFile, previousConfig, 'utf8');
  }
});

test('caps a low-balance request before the upstream stream starts', () => {
  const user = { email: 'budget@example.com', role: 'normal', credits: 1 };
  const plan = planCreditReservation(user, 'unknown-model', [{ role: 'user', content: 'hello' }], 4000);
  assert.equal(plan.ok, true);
  assert.equal(plan.cappedByBalance, true);
  assert.ok(plan.maxTokens < 4000);
  assert.ok(plan.reservedCost <= user.credits);
});

test('configured administrator has unlimited credits', () => {
  assert.equal(isAdminUser('1271055010@qq.com'), true);
  assert.equal(isAdminUser('regular-user@example.com'), false);
});

test('applies account-level credit multipliers', () => {
  const normal = { email: 'normal@example.com', role: 'normal' };
  const vip = { email: 'vip@example.com', role: 'vip' };
  const admin = { email: '1271055010@qq.com', role: 'admin' };
  assert.equal(normalizeUserRole({ email: 'legacy@example.com', plan: 'free' }), 'normal');
  assert.equal(normalizeUserRole({ email: 'legacy-vip@example.com', role: 'normal', level: 'vip' }), 'vip');
  assert.equal(normalizeUserRole({ email: 'legacy-admin@example.com', role: 'normal', plan: 'admin' }), 'admin');
  assert.equal(creditMultiplierForUser(normal), 2);
  assert.equal(creditMultiplierForUser(vip), 1);
  assert.equal(creditMultiplierForUser(admin), 0);
  assert.equal(creditCostForUser(normal, 'unknown-model', 1000), 0.36);
  assert.equal(creditCostForUser(vip, 'unknown-model', 1000), 0.18);
  assert.equal(creditCostForUser(admin, 'unknown-model', 1000), 0);
});

test('isolates model selection by account role', () => {
  const normal = { email: 'normal@example.com', role: 'normal' };
  const vip = { email: 'vip@example.com', role: 'vip' };
  const admin = { email: 'admin@example.com', role: 'admin' };
  const defaultModel = currentDefaultModel();

  assert.equal(canChooseModel(normal), false);
  assert.equal(canChooseModel(vip), true);
  assert.equal(canChooseModel(admin), true);
  assert.equal(resolveModelForUser(normal, 'gpt-5.6-luna'), defaultModel);
  assert.equal(resolveModelForUser(vip, 'gpt-5.6-luna'), 'gpt-5.6-luna');
  assert.equal(resolveModelForUser(admin, 'gpt-5.6-luna'), 'gpt-5.6-luna');
  assert.equal(resolveModelForUser(vip, 'model-does-not-exist'), defaultModel);
});

test('deduplicates usage events by request id in fallback storage', () => {
  const usageFile = path.join(testDataDir, 'token_usage.json');
  const existed = fs.existsSync(usageFile);
  const previous = existed ? fs.readFileSync(usageFile, 'utf8') : null;
  const requestId = 'test_dedupe_' + Date.now();
  const event = {
    requestId,
    userEmail: 'token-test@example.com',
    modelId: 'unknown-model',
    providerModel: 'unknown-model',
    promptTokens: 10,
    completionTokens: 5,
    reasoningTokens: null,
    totalTokens: 15,
    usageSource: 'upstream',
    status: 'completed',
    createdAt: Date.now(),
    durationMs: 10,
    creditCost: 1
  };
  try {
    assert.equal(recordTokenUsage(event), true);
    assert.equal(recordTokenUsage(event), false);
    assert.equal(getUsageSummary(event.userEmail, false).totalTokens, 15);
  } finally {
    if (existed) fs.writeFileSync(usageFile, previous, 'utf8');
    else if (fs.existsSync(usageFile)) fs.unlinkSync(usageFile);
  }
});

test('persists Skill audit metadata in the usage ledger fallback', () => {
  const usageFile = path.join(testDataDir, 'token_usage.json');
  const existed = fs.existsSync(usageFile);
  const previous = existed ? fs.readFileSync(usageFile, 'utf8') : null;
  const email = 'skill-ledger-test@example.com';
  const requestId = 'skill-audit_' + Date.now();
  try {
    assert.equal(recordTokenUsage({
      requestId,
      userEmail: email,
      modelId: 'unknown-model',
      providerModel: 'unknown-model',
      promptTokens: 10,
      completionTokens: 5,
      reasoningTokens: null,
      totalTokens: 15,
      usageSource: 'upstream',
      status: 'completed',
      createdAt: Date.now(),
      durationMs: 10,
      creditCost: 1,
      skillAudit: { version: 1, status: 'verified', audited: true, promptHash: 'a'.repeat(64), actualSkillIds: ['skill-a'], declaredSkillIds: ['skill-a'], skills: [], forwarding: { status: 'verified', skills: [{ id: 'skill-a', forwardedTextFiles: ['SKILL.md', 'references/rules.md'] }] } },
      messagesHash: 'b'.repeat(64)
    }), true);
    const recent = getUsageSummary(email, 1).recent[0];
    assert.deepEqual(recent.skillIds, ['skill-a']);
    assert.equal(recent.skillAuditStatus, 'verified');
    assert.equal(recent.skillForwardingStatus, 'verified');
    assert.equal(recent.skillForwardedFileCount, 2);
    assert.equal(recent.messagesHash, 'b'.repeat(64));
  } finally {
    if (existed) fs.writeFileSync(usageFile, previous, 'utf8');
    else if (fs.existsSync(usageFile)) fs.unlinkSync(usageFile);
  }
});

test('uses scrypt for new passwords and upgrades legacy SHA-256 records', () => {
  const record = createPasswordRecord('correct horse battery staple');
  assert.match(record.pwd, /^scrypt\$/);
  assert.deepEqual(verifyPassword('correct horse battery staple', { salt: record.salt, pwd: record.pwd }), { ok: true, needsUpgrade: false });
  assert.equal(verifyPassword('wrong password', { salt: record.salt, pwd: record.pwd }).ok, false);

  const salt = 'legacy-test-salt';
  const legacy = { salt, pwd: crypto.createHash('sha256').update('old-password:' + salt).digest('hex') };
  assert.deepEqual(verifyPassword('old-password', legacy), { ok: true, needsUpgrade: true });
  assert.equal(verifyPassword('wrong-password', legacy).ok, false);
});

test('migrates legacy session tokens to expiring hashes', () => {
  const sessionsFile = path.join(testDataDir, 'sessions.json');
  const existed = fs.existsSync(sessionsFile);
  const previous = existed ? fs.readFileSync(sessionsFile, 'utf8') : null;
  const rawToken = 'legacy-session-token-' + Date.now();
  try {
    fs.writeFileSync(sessionsFile, JSON.stringify([[rawToken, 'session-test@example.com']]), 'utf8');
    loadSessions();
    assert.equal(sessions.has(hashSessionToken(rawToken)), true);
    assert.equal(sessions.has(rawToken), false);
    flushSessionsSync();
    const persisted = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
    assert.equal(persisted[0].tokenHash, hashSessionToken(rawToken));
    assert.equal(Object.prototype.hasOwnProperty.call(persisted[0], 'token'), false);
    assert.equal(persisted[0].scope, 'client');

    const adminToken = 'admin-session-token-' + Date.now();
    fs.writeFileSync(sessionsFile, JSON.stringify([{ tokenHash: hashSessionToken(adminToken), email: 'session-test@example.com', expiresAt: Date.now() + 60000, scope: 'admin' }]), 'utf8');
    loadSessions();
    assert.equal(sessions.get(hashSessionToken(adminToken)).scope, 'admin');

    fs.writeFileSync(sessionsFile, JSON.stringify([{ tokenHash: hashSessionToken('expired'), email: 'expired@example.com', expiresAt: Date.now() - 1 }]), 'utf8');
    loadSessions();
    assert.equal(sessions.size, 0);
    flushSessionsSync();
  } finally {
    sessions.clear();
    if (existed) fs.writeFileSync(sessionsFile, previous, 'utf8');
    else if (fs.existsSync(sessionsFile)) fs.unlinkSync(sessionsFile);
  }
});

test('keeps client and admin session scopes isolated', () => {
  const email = 'session-scope-test@example.com';
  const clientToken = 'client-scope-token-' + Date.now();
  const adminToken = 'admin-scope-token-' + Date.now();
  const previousSessions = new Map(sessions);
  const requestFor = token => ({ headers: { authorization: 'Bearer ' + token } });
  try {
    sessions.clear();
    sessions.set(hashSessionToken(clientToken), { email, expiresAt: Date.now() + 60000, scope: 'client' });
    sessions.set(hashSessionToken(adminToken), { email, expiresAt: Date.now() + 60000, scope: 'admin' });

    assert.ok(getAuthUser(requestFor(clientToken), 'client'));
    assert.equal(getAuthUser(requestFor(clientToken), 'admin'), null);
    assert.ok(getAuthUser(requestFor(adminToken), 'admin'));
    assert.equal(getAuthUser(requestFor(adminToken), 'client'), null);
  } finally {
    sessions.clear();
    previousSessions.forEach((record, tokenHash) => sessions.set(tokenHash, record));
  }
});

test('reserves credits atomically and holds reservation when usage is missing', () => {
  const usersFile = path.join(testDataDir, 'users.json');
  const usageFile = path.join(testDataDir, 'token_usage.json');
  const previousUsers = fs.readFileSync(usersFile, 'utf8');
  const usageExisted = fs.existsSync(usageFile);
  const previousUsage = usageExisted ? fs.readFileSync(usageFile, 'utf8') : null;
  const email = 'credit-concurrency-test@example.com';
  const user = { email, name: 'credit test', salt: 'test', pwd: 'test', role: 'normal', level: 'normal', plan: 'normal', credits: 1, spent: 0, createdAt: new Date().toISOString() };
  try {
    saveUser(user);
    const estimated = reservationCostForRequest(user, 'unknown-model', [{ role: 'user', content: 'hello' }], 1000);
    assert.ok(estimated > 0);
    assert.equal(reserveCredits(user, 'unknown-model', 'unknown-model', 'reserve-a', 0.8, null, 'a'.repeat(64)).ok, true);
    assert.equal(reserveCredits(user, 'unknown-model', 'unknown-model', 'reserve-a', 0.2, null, 'a'.repeat(64)).existing, true);
    assert.equal(reserveCredits(user, 'unknown-model', 'unknown-model', 'reserve-probe', 0, null, 'c'.repeat(64), null, { lookupOnly: true }).missing, true);
    assert.equal(reserveCredits(user, 'other-model', 'other-model', 'reserve-a', 0.8, null, 'a'.repeat(64)).conflict, true);
    assert.equal(reserveCredits(user, 'unknown-model', 'unknown-model', 'reserve-a', 0.8, null, 'b'.repeat(64)).conflict, true);
    assert.equal(reserveCredits(user, 'unknown-model', 'unknown-model', 'reserve-b', 0.8).ok, false);

    const pending = settleTokenUsage({ requestId: 'reserve-a', userEmail: email, modelId: 'unknown-model', providerModel: 'unknown-model', promptTokens: null, completionTokens: null, reasoningTokens: null, totalTokens: null, cachedTokens: null, cacheWriteTokens: null, usageSource: 'unavailable', status: 'usage_unavailable', createdAt: Date.now(), durationMs: 1 });
    assert.equal(pending.creditCost, 0);
    assert.equal(pending.billingStatus, 'pending');
    const savedUsers = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    const saved = savedUsers.find(item => item.email === email);
    assert.equal(saved.credits, 0.2);
    assert.equal(saved.spent, 0);
  } finally {
    fs.writeFileSync(usersFile, previousUsers, 'utf8');
    if (usageExisted) fs.writeFileSync(usageFile, previousUsage, 'utf8');
    else if (fs.existsSync(usageFile)) fs.unlinkSync(usageFile);
  }
});

test('releases a credit reservation when the upstream is unreachable', () => {
  const usersFile = path.join(testDataDir, 'users.json');
  const usageFile = path.join(testDataDir, 'token_usage.json');
  const previousUsers = fs.readFileSync(usersFile, 'utf8');
  const usageExisted = fs.existsSync(usageFile);
  const previousUsage = usageExisted ? fs.readFileSync(usageFile, 'utf8') : null;
  const email = 'upstream-error-credit-test@example.com';
  const user = { email, name: 'upstream error test', salt: 'test', pwd: 'test', role: 'normal', level: 'normal', plan: 'normal', credits: 2, spent: 0, createdAt: new Date().toISOString() };
  try {
    saveUser(user);
    assert.equal(reserveCredits(user, 'unknown-model', 'unknown-model', 'upstream-error-a', 1.25).ok, true);
    const settled = settleTokenUsage({ requestId: 'upstream-error-a', userEmail: email, modelId: 'unknown-model', providerModel: 'unknown-model', promptTokens: null, completionTokens: null, reasoningTokens: null, totalTokens: null, cachedTokens: null, cacheWriteTokens: null, usageSource: 'unavailable', status: 'upstream_error', createdAt: Date.now(), durationMs: 1 });
    assert.equal(settled.creditCost, 0);
    assert.equal(settled.billingStatus, 'released');
    const savedUsers = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    const saved = savedUsers.find(item => item.email === email);
    assert.equal(saved.credits, 2);
    assert.equal(saved.spent, 0);
  } finally {
    fs.writeFileSync(usersFile, previousUsers, 'utf8');
    if (usageExisted) fs.writeFileSync(usageFile, previousUsage, 'utf8');
    else if (fs.existsSync(usageFile)) fs.unlinkSync(usageFile);
  }
});
