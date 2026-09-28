const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-editor-only-'));
process.env.MOLAN_DATA_DIR = tempDataDir;
process.env.MOLAN_CONFIG_DIR = tempDataDir;
process.env.MOLAN_REQUIRE_SQLITE = '0';
process.env.MOLAN_PUBLIC_MODE = '0';

const server = require('../server');

const projectRoot = path.resolve(__dirname, '..');
const sourceSkillDir = 'C:/Users/lyh/Desktop/小说专属网页/write-high-tension-fiction';
const sourceCorrectionFile = 'C:/Users/lyh/Desktop/小说专属网页/纠错库.md';
const bundledSkillDir = path.join(projectRoot, 'editor-sources', 'write-high-tension-fiction');
const bundledCorrectionFile = path.join(projectRoot, 'editor-sources', '纠错库.md');

test('editor source bundle mirrors the requested Skill and correction library', () => {
  const sourceExists = fs.existsSync(sourceSkillDir) && fs.existsSync(sourceCorrectionFile);
  const source = server.loadEditorOnlyWritingSkill({ skillDir: sourceExists ? sourceSkillDir : bundledSkillDir });
  const bundled = server.loadEditorOnlyWritingSkill({ skillDir: bundledSkillDir });
  assert.equal(source.id, server.EDITOR_ONLY_SKILL_ID);
  assert.equal(source.complete, true);
  assert.deepEqual([...source.files].sort(), [...bundled.files].sort());
  for (const file of source.files) {
    assert.equal(source.runtimeFiles[file], bundled.runtimeFiles[file], 'Skill file drift: ' + file);
  }
  const correction = server.loadEditorOnlyCorrectionLibrary({ correctionFile: sourceExists ? sourceCorrectionFile : bundledCorrectionFile });
  const bundledCorrection = server.loadEditorOnlyCorrectionLibrary({ correctionFile: bundledCorrectionFile });
  assert.equal(correction.content, bundledCorrection.content);
  assert.equal(correction.sha256, bundledCorrection.sha256);
});

test('editor requests replace foreign Skill blocks with the canonical full folder', () => {
  const skill = server.loadEditorOnlyWritingSkill({ skillDir: bundledSkillDir });
  const foreign = '[MOLAN_SKILL_BLOCK_BEGIN id=humanizer]\n外部 Skill 指令\n[MOLAN_SKILL_BLOCK_END id=humanizer]';
  const ensured = server.ensureEditorOnlyWritingSkill([
    { role: 'system', content: '基础角色\n' + foreign + '\n<!-- molan-dynamic-context-v2 -->\n当前作品事实' },
    { role: 'user', content: '请生成正文\n' + foreign },
    { role: 'user', content: [{ type: 'text', text: '多模态文本\n' + foreign }] }
  ], skill);
  const systemText = ensured.messages.filter(message => message.role === 'system').map(message => message.content).join('\n');
  assert.doesNotMatch(systemText, /外部 Skill 指令/);
  assert.match(systemText, /MOLAN_SKILL_BLOCK_BEGIN id=write-high-tension-fiction/);
  assert.match(systemText, /references\/logic-style-rules\.md/);
  const nonSystemText = ensured.messages.filter(message => message.role !== 'system').map(message => JSON.stringify(message.content)).join('\n');
  assert.doesNotMatch(nonSystemText, /外部 Skill 指令/);

  const audit = server.buildSkillAudit(
    { user: { email: 'editor-only-test@example.com' } },
    ensured.messages,
    server.editorOnlySkillAuditRequest(skill),
    { editorOnly: true, canonicalSkill: skill }
  );
  assert.equal(audit.status, 'verified');
  assert.deepEqual(audit.actualSkillIds, [server.EDITOR_ONLY_SKILL_ID]);
  const prepared = server.prepareSkillMessagesForUpstream(
    { user: { email: 'editor-only-test@example.com' } },
    ensured.messages,
    audit,
    { editorOnly: true, canonicalSkill: skill }
  );
  assert.equal(prepared.skillAudit.forwarding.status, 'verified');
  assert.equal(prepared.skillAudit.forwarding.skills.length, 1);
  assert.equal(prepared.skillAudit.forwarding.skills[0].omittedTextFiles.length, 0);
  assert.equal(prepared.messages.some(message => String(message.content || '').includes('MOLAN_SKILL_BLOCK_BEGIN')), false);
});

test('editor correction injection uses the structured library tiers and keeps dynamic context order', () => {
  const correction = server.loadEditorOnlyCorrectionLibrary({ correctionFile: bundledCorrectionFile });
  assert.ok(correction.structured && correction.structured.rules.length >= 20, '结构化解析应得到全部硬规则');
  assert.ok(correction.structured.cases.length >= 200, '结构化解析应得到全部案例');
  assert.match(correction.version, /^editor-library-v2:/);
  const messages = [
    { role: 'system', content: '编辑器角色\n' + server.UNIVERSAL_CORRECTION_POLICY_PROMPT + '\n<!-- molan-dynamic-context-v2 -->\n作品事实' },
    { role: 'user', content: '写一场打斗，两人对白要有火气' }
  ];
  let render = null;
  const injected = server.injectEditorOnlyCorrectionLibrary(messages, correction, true, { requestText: messages[1].content, onRender: value => { render = value; } });
  assert.match(injected[0].content, new RegExp(server.EDITOR_ONLY_CORRECTION_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  // 不再整篇注入 Markdown：应包含核心档、黑名单档与场景档，且体量远小于原文。
  assert.match(injected[0].content, /墨阑通用纠错库/);
  assert.match(injected[0].content, /纠错库黑名单短语/);
  assert.match(injected[0].content, /场景补充｜命中：/);
  assert.match(injected[0].content, /R-46/);
  assert.ok(injected[0].content.length < correction.content.length / 2, '分档注入应显著小于整篇原文');
  assert.ok(render && render.scenes.includes('combat') && render.scenes.includes('dialogue'));
  assert.equal(render.mode, 'draft');
  assert.doesNotMatch(injected[0].content, /molan-universal-correction-policy-v1/);
  assert.ok(injected[0].content.indexOf(server.EDITOR_ONLY_CORRECTION_MARKER) < injected[0].content.indexOf('molan-dynamic-context-v2'));

  const revised = server.injectEditorOnlyCorrectionLibrary(messages, correction, true, { requestText: '请按纠错库润色这一段' });
  assert.match(revised[0].content, /对照档｜用户手动纠正案例/);
});

test('editor-only requests do not activate the two-pass style pipeline', () => {
  assert.equal(server.isTwoPassHumanizeEnabled('writing', { editorOnly: true }), false);
  const editorSource = fs.readFileSync(path.join(projectRoot, 'completion-editor.js'), 'utf8');
  const indexSource = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
  assert.match(editorSource, /editorOnly:\s*true/);
  assert.match(indexSource, /if \(options\.editorOnly === true\) body\.editorOnly = true/);
  assert.match(indexSource, /editorOnly: true, onDelta/);
});

test('editor canonical sources resolve to the cloud release locations first', () => {
  assert.equal(server.EDITOR_ONLY_SKILL_DIR_DEFAULT, '/opt/molan/editor-sources/write-high-tension-fiction');
  assert.equal(server.EDITOR_ONLY_CORRECTION_FILE_DEFAULT, '/opt/molan/editor-sources/纠错库.md');
  assert.equal(server.resolveEditorOnlySkillDir({ skillDir: bundledSkillDir }), bundledSkillDir);
  assert.equal(server.resolveEditorOnlyCorrectionFile({ correctionFile: bundledCorrectionFile }), bundledCorrectionFile);
});

test('editor prose generation extracts existing content before building the chapter contract', () => {
  const editorSource = fs.readFileSync(path.join(projectRoot, 'completion-editor.js'), 'utf8');
  const extraction = editorSource.indexOf('async function requestExistingContentExtraction');
  const workflow = editorSource.indexOf('async function runChapterWorkflow');
  const contractRequest = editorSource.indexOf('/chapter-contract', workflow);
  assert.ok(extraction >= 0);
  assert.ok(workflow >= 0);
  assert.ok(contractRequest > extraction);
  assert.ok(editorSource.indexOf('requestExistingContentExtraction({ state, context, prompt, stageNode })', workflow) < contractRequest);
  for (const field of ['protagonistAction', 'opposition', 'informationChange', 'irreversibleResult']) {
    assert.match(editorSource, new RegExp('chapterContract.*' + field));
  }
  assert.match(editorSource, /buildNovelExtractionSource\(state/);
  assert.match(editorSource, /state\.editorCanonSnapshot = cloneValue\(extraction\.canon\)/);
});
