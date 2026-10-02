const assert = require('node:assert/strict');
const test = require('node:test');

process.env.MOLAN_DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'molan-open-skills-'));
process.env.MOLAN_REQUIRE_SQLITE = '0';
process.env.MOLAN_PUBLIC_MODE = '0';

const { server, initDB } = require('../server');

let baseUrl = '';
let alice = null;
let bob = null;
let openSkillId = '';

async function request(path, options) {
  const opts = options || {};
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.token ? { Authorization: 'Bearer ' + opts.token } : {}, opts.headers || {});
  const response = await fetch(baseUrl + path, Object.assign({}, opts, { headers }));
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

test.before(async () => {
  initDB({ databaseFactory: require('../lib/pure-js-database').PureJsDatabase });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = 'http://127.0.0.1:' + address.port;
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
});

test('public skills stay private until published and can be viewed anonymously', async () => {
  const initial = await request('/api/open-skills');
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.data.skills, []);

  const registerAlice = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: 'alice-open@example.com', password: '123456', name: 'Alice' }) });
  const registerBob = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: 'bob-open@example.com', password: '123456', name: 'Bob' }) });
  assert.equal(registerAlice.status, 200);
  assert.equal(registerBob.status, 200);
  alice = registerAlice.data;
  bob = registerBob.data;

  const created = await request('/api/open-skills', { method: 'POST', token: alice.token, body: JSON.stringify({ name: '对白节奏', description: '控制对白节奏和动作反应', instruction: '每段对白都要有明确的说话目的。' }) });
  assert.equal(created.status, 200);
  openSkillId = created.data.skill.id;
  assert.equal(created.data.skill.isOwner, true);
  assert.equal(created.data.skill.ownerEmail, undefined);

  const publicList = await request('/api/open-skills');
  assert.equal(publicList.status, 200);
  assert.equal(publicList.data.skills.length, 1);
  assert.equal(publicList.data.skills[0].author, 'Alice');
  assert.equal(publicList.data.skills[0].instruction, undefined);

  const detail = await request('/api/open-skills/' + encodeURIComponent(openSkillId));
  assert.equal(detail.status, 200);
  assert.equal(detail.data.skill.instruction, '每段对白都要有明确的说话目的。');
});

test('download requires login and copies the skill to the downloading user only', async () => {
  const guestDownload = await request('/api/open-skills/' + encodeURIComponent(openSkillId) + '/download', { method: 'POST', body: '{}' });
  assert.equal(guestDownload.status, 401);

  const downloaded = await request('/api/open-skills/' + encodeURIComponent(openSkillId) + '/download', { method: 'POST', token: bob.token, body: '{}' });
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.data.skill.name, '对白节奏');

  const bobSkills = await request('/api/skills', { token: bob.token });
  assert.equal(bobSkills.status, 200);
  assert.equal(bobSkills.data.filter(skill => skill.source === 'user' && skill.name === '对白节奏').length, 1);

  const aliceSkills = await request('/api/skills', { token: alice.token });
  assert.equal(aliceSkills.data.filter(skill => skill.source === 'user' && skill.name === '对白节奏').length, 0);
});

test('personal skills persist in the cloud and stay isolated by account', async () => {
  const uploaded = await request('/api/skills/import', {
    method: 'POST',
    token: alice.token,
    body: JSON.stringify({
      name: '长篇节奏',
      description: '控制章节推进速度',
      instruction: '每个场景都要推动冲突或改变信息。',
      files: ['SKILL.md', 'references/rhythm.md'],
      slug: 'local-long-form'
    })
  });
  assert.equal(uploaded.status, 200);
  assert.equal(uploaded.data.skill.id, uploaded.data.id);
  assert.deepEqual(uploaded.data.skill.files, ['SKILL.md', 'references/rhythm.md']);

  const aliceSkills = await request('/api/skills', { token: alice.token });
  const bobSkills = await request('/api/skills', { token: bob.token });
  assert.equal(aliceSkills.data.filter(skill => skill.source === 'user' && skill.name === '长篇节奏').length, 1);
  assert.equal(bobSkills.data.filter(skill => skill.source === 'user' && skill.name === '长篇节奏').length, 0);

  const updated = await request('/api/skills/import', {
    method: 'POST',
    token: alice.token,
    body: JSON.stringify({ name: '长篇节奏', description: '已更新', instruction: '每章结尾必须留下可验证的新问题。', slug: 'local-long-form' })
  });
  assert.equal(updated.status, 200);
  const reloaded = await request('/api/skills', { token: alice.token });
  const saved = reloaded.data.find(skill => skill.id === uploaded.data.id);
  assert.equal(saved.description, '已更新');
  assert.equal(saved.instruction, '每章结尾必须留下可验证的新问题。');
});

test('preserves every uploaded Skill file through reload and public download', async () => {
  const runtimeFiles = {
    'SKILL.md': '---\nname: full-folder\n---\n主规则',
    'references/rhythm.md': '节奏参考',
    'assets/style-profile.schema.json': '{"type":"object"}',
    'agents/openai.yaml': 'interface:\n  display_name: full-folder'
  };
  const uploaded = await request('/api/skills/import', {
    method: 'POST',
    token: alice.token,
    body: JSON.stringify({
      name: '完整文件夹技能',
      description: '保留全部文件内容',
      instruction: '主规则\n\n### Skill file: `references/rhythm.md`\n\n节奏参考\n\n### Skill file: `assets/style-profile.schema.json`\n\n{"type":"object"}',
      files: Object.keys(runtimeFiles),
      runtimeFiles,
      fileManifest: Object.keys(runtimeFiles).map(path => ({ path, type: 'text', size: runtimeFiles[path].length })),
      slug: 'full-folder'
    })
  });
  assert.equal(uploaded.status, 200);
  assert.equal(uploaded.data.skill.runtimeFiles['assets/style-profile.schema.json'], runtimeFiles['assets/style-profile.schema.json']);

  const reloaded = await request('/api/skills', { token: alice.token });
  const saved = reloaded.data.find(skill => skill.id === uploaded.data.id);
  assert.ok(saved);
  assert.deepEqual(saved.files.sort(), Object.keys(runtimeFiles).sort());
  assert.equal(saved.runtimeFiles['references/rhythm.md'], runtimeFiles['references/rhythm.md']);
  assert.equal(saved.runtimeFiles['agents/openai.yaml'], runtimeFiles['agents/openai.yaml']);

  const published = await request('/api/open-skills', {
    method: 'POST',
    token: alice.token,
    body: JSON.stringify({ name: '完整公开技能', instruction: '公开指令', files: Object.keys(runtimeFiles), runtimeFiles, fileManifest: Object.keys(runtimeFiles).map(path => ({ path, type: 'text', size: runtimeFiles[path].length })) })
  });
  assert.equal(published.status, 200);
  const detail = await request('/api/open-skills/' + encodeURIComponent(published.data.skill.id));
  assert.equal(detail.status, 200);
  assert.equal(detail.data.skill.runtimeFiles['assets/style-profile.schema.json'], runtimeFiles['assets/style-profile.schema.json']);
  const downloaded = await request('/api/open-skills/' + encodeURIComponent(published.data.skill.id) + '/download', { method: 'POST', token: bob.token, body: '{}' });
  assert.equal(downloaded.status, 200);
  const bobAfterDownload = await request('/api/skills', { token: bob.token });
  const copied = bobAfterDownload.data.find(skill => skill.id === downloaded.data.skill.id);
  assert.equal(copied.runtimeFiles['references/rhythm.md'], runtimeFiles['references/rhythm.md']);
});

test('only the owner can edit or withdraw an open skill', async () => {
  const forbidden = await request('/api/open-skills/' + encodeURIComponent(openSkillId), { method: 'PATCH', token: bob.token, body: JSON.stringify({ description: 'unauthorized' }) });
  assert.equal(forbidden.status, 403);

  const withdrawn = await request('/api/open-skills/' + encodeURIComponent(openSkillId), { method: 'PATCH', token: alice.token, body: JSON.stringify({ status: 'withdrawn' }) });
  assert.equal(withdrawn.status, 200);
  assert.equal(withdrawn.data.skill.status, 'withdrawn');

  const hidden = await request('/api/open-skills/' + encodeURIComponent(openSkillId));
  assert.equal(hidden.status, 404);
  const mine = await request('/api/open-skills?scope=mine', { token: alice.token });
  assert.equal(mine.status, 200);
  assert.equal(mine.data.skills[0].status, 'withdrawn');
});
