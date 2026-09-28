const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-deai-stopslop-'));
process.env.MOLAN_DATA_DIR = tempDataDir;
process.env.MOLAN_CONFIG_DIR = tempDataDir;
process.env.MOLAN_REQUIRE_SQLITE = '0';
process.env.MOLAN_PUBLIC_MODE = '0';
fs.writeFileSync(path.join(tempDataDir, 'config.json'), JSON.stringify({
  modelPolicy: { defaultModel: 'deai-test-model' },
  platformModels: [{ id: 'deai-test-model', name: '去AI味测试模型', provider: 'deepseek', model: 'deai-test-model' }]
}));

const server = require('../server');

test('skills/humanizer 完整加载 stop-slop-zh 的核心规则与 references 清单', () => {
  const builtinSkills = server.loadBuiltinSkills();
  const humanizer = builtinSkills.find(s => s.id === 'humanizer');
  assert.ok(humanizer, '必须能加载 humanizer 技能');
  assert.equal(humanizer.id, 'humanizer');

  const promptFiles = server.skillPromptFiles(humanizer);
  assert.ok(promptFiles.includes('SKILL.md'), 'Prompt files 必须包含 SKILL.md');
  assert.ok(promptFiles.includes('references/phrases.md'), 'Prompt files 必须包含 references/phrases.md');
  assert.ok(promptFiles.includes('references/structures.md'), 'Prompt files 必须包含 references/structures.md');
  assert.ok(promptFiles.includes('references/examples.md'), 'Prompt files 必须包含 references/examples.md');

  const instruction = server.skillPromptInstruction(humanizer);
  assert.match(instruction, /拆排比三件套/);
  assert.match(instruction, /去名词化/);
  assert.match(instruction, /用具体的人当主语/);
  assert.match(instruction, /删金句收尾/);
  assert.match(instruction, /五维评分量规/);
  assert.match(instruction, /35\/50/);
});

test('stage=humanizer 时默认注入 humanizer (stop-slop-zh) 技能', () => {
  const messages = [
    { role: 'system', content: '系统提示' },
    { role: 'user', content: '待去 AI 味的文本。' }
  ];
  const ensured = server.ensureDefaultWritingSkill(messages, 'humanizer');
  assert.equal(ensured.injected, true);
  assert.equal(ensured.skill.id, 'humanizer');

  const blocks = server.extractSkillBlocks(ensured.messages);
  assert.equal(blocks.size, 1);
  assert.ok(blocks.has('humanizer'), '必须注入 humanizer block');
  assert.ok(!blocks.has(server.DEFAULT_WRITING_SKILL_ID), '不得注入小说正文创作技能');
});

test('stage=writing 时依然注入正文创作技能，与去 AI 味工具互不干扰', () => {
  const messages = [
    { role: 'system', content: '系统提示' },
    { role: 'user', content: '写一章正文。' }
  ];
  const ensured = server.ensureDefaultWritingSkill(messages, 'writing');
  assert.equal(ensured.injected, true);
  assert.notEqual(ensured.skill.id, 'humanizer', '正文生成不得默认注入 humanizer');
  assert.equal(ensured.skill.id, server.DEFAULT_WRITING_SKILL_ID);

  const blocks = server.extractSkillBlocks(ensured.messages);
  assert.ok(blocks.has(server.DEFAULT_WRITING_SKILL_ID));
  assert.ok(!blocks.has('humanizer'));
});

test('pages/site.js 与 pages/tools.html 中的去 AI 味工具配置对齐 stop-slop-zh', () => {
  const siteCode = fs.readFileSync(path.join(__dirname, '../pages/site.js'), 'utf8');
  assert.match(siteCode, /Stop AI Slop/);
  assert.match(siteCode, /拆排比三件套/);
  assert.match(siteCode, /去名词化/);
  assert.match(siteCode, /换抽象主语为具体细节/);
  assert.match(siteCode, /删金句收尾与抒情扩散/);
  assert.match(siteCode, /五维评分/);

  const toolsHtml = fs.readFileSync(path.join(__dirname, '../pages/tools.html'), 'utf8');
  assert.match(toolsHtml, /data-tool="deai"/);
  assert.match(toolsHtml, /data-tool="aiflavor"/);
});

test('completion-platform.js 与 index.html 中的去 AI 味工具提示词对齐 stop-slop-zh', () => {
  const platformCode = fs.readFileSync(path.join(__dirname, '../completion-platform.js'), 'utf8');
  assert.match(platformCode, /Stop AI Slop/);
  assert.match(platformCode, /拆排比三件套/);
  assert.match(platformCode, /去名词化/);

  const indexCode = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(indexCode, /Stop AI Slop/);
  assert.match(indexCode, /拆排比三件套/);
  assert.match(indexCode, /去名词化/);
});
