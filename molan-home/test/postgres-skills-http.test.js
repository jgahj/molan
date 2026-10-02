'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readConfig } = require('../lib/postgres-repository');

test('isolated PG skill HTTP: direct catalog, files, owner isolation and atomic download', {
  skip: process.env.MOLAN_PG_SKILLS_ACCEPTANCE !== '1', timeout: 20000
}, async () => {
  const settings = readConfig(process.env);
  assert.ok(settings.enabled && /test|acceptance/i.test(settings.config.database || ''));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-pg-skills-http-'));
  process.env.MOLAN_DATA_DIR = directory;
  process.env.MOLAN_CONFIG_DIR = directory;
  process.env.MOLAN_LOCAL_ONLY = '1';
  process.env.MOLAN_PUBLIC_MODE = '0';
  const app = require('../server');
  const prototype = require('../lib/pure-js-database').PureJsDatabase.prototype;
  const originalPrepare = prototype.prepare;
  let forbiddenAccess = 0;
  let listening = false;
  try {
    assert.equal(app.initDB(), true);
    await app.initializePostgresRuntime();
    prototype.prepare = function (sql, ...args) {
      if (/\b(accounts|token_usage|user_skills|global_skills|open_skills|admin_audit|dissections|dissection_shares|character_library)\b/i.test(String(sql))) {
        forbiddenAccess++;
        throw new Error('Skill accessed legacy SQL');
      }
      return originalPrepare.call(this, sql, ...args);
    };
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    listening = true;
    const address = `http://127.0.0.1:${app.server.address().port}`;
    const request = async (route, { method = 'GET', token, body } = {}) => {
      const response = await fetch(address + route, {
        method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return { status: response.status, body: await response.json() };
    };
    const register = async () => {
      const suffix = crypto.randomBytes(12).toString('hex');
      const result = await request('/api/auth/register', { method: 'POST',
        body: { email: `skill-${suffix}@example.test`, password: suffix, name: '技能验收' } });
      assert.equal(result.status, 200);
      return { ...result.body, password: suffix };
    };
    const owner = await register();
    const downloader = await register();
    const adminId = 'skill-admin-' + crypto.randomBytes(12).toString('hex');
    await app.postgresRepository.runtimeRegisterAccount({
      userId: adminId, email: `${adminId}@example.test`, name: '管理验收', role: 'admin'
    });
    const ownerAccount = await app.postgresRepository.runtimeAccountByUserId(owner.user.userId);
    await app.postgresRepository.runtimeUpdateAccount({
      actorUserId: adminId, userId: owner.user.userId, email: owner.user.email,
      name: owner.user.name, salt: ownerAccount.salt, pwd: ownerAccount.pwd,
      role: 'admin', preserveFinancials: true
    });
    const adminLogin = await request('/api/admin/auth/login', { method: 'POST',
      body: { email: owner.user.email, password: owner.password } });
    assert.equal(adminLogin.status, 200);
    const adminToken = adminLogin.body.token;
    for (const type of ['accounts', 'user-skills', 'global-skills', 'open-skills', 'dissections', 'token-usage']) {
      const listing = await request('/api/admin/data?type=' + type, { token: adminToken });
      assert.equal(listing.status, 200, type + ': ' + JSON.stringify(listing.body));
      assert.ok(Array.isArray(listing.body.rows));
    }
    const adminDetail = await request('/api/admin/data?type=accounts&id=' + encodeURIComponent(owner.user.email), { token: adminToken });
    assert.equal(adminDetail.status, 200);
    const adminDataPatch = await request('/api/admin/data', { method: 'PATCH', token: adminToken,
      body: { type: 'accounts', id: downloader.user.email, record: { name: 'PG数据管理验收' } } });
    assert.equal(adminDataPatch.status, 200, JSON.stringify(adminDataPatch.body));
    assert.equal(adminDataPatch.body.record.name, 'PG数据管理验收');
    const overview = await request('/api/admin/overview?q=' + encodeURIComponent(owner.user.email), { token: adminToken });
    assert.equal(overview.status, 200);
    assert.equal(overview.body.users.length, 1);
    assert.equal(overview.body.users[0].email, owner.user.email);
    const edited = await request('/api/admin/users/' + encodeURIComponent(downloader.user.email), {
      method: 'PATCH', token: adminToken, body: { name: 'PG 管理资料' }
    });
    assert.equal(edited.status, 200);
    assert.equal((await app.postgresRepository.runtimeAccountByUserId(downloader.user.userId)).name, 'PG 管理资料');
    await assert.rejects(app.postgresRepository.runtimeListAllTokenUsage(downloader.user.userId),
      error => error.status === 403);
    const globalBefore = await app.postgresRepository.runtimeListGlobalSkills(owner.user.userId);
    assert.equal((await request('/api/admin/skills', { token: adminToken })).status, 200);
    const rejectedPromotion = await request('/api/admin/skills', { method: 'POST', token: adminToken,
      body: { name: '无证据拒绝', instruction: '不能写入' } });
    assert.ok(rejectedPromotion.status >= 400);
    assert.match(rejectedPromotion.body.error, /质量门禁/);
    assert.deepEqual(await app.postgresRepository.runtimeListGlobalSkills(owner.user.userId), globalBefore);
    await assert.rejects(app.postgresRepository.runtimeReplaceGlobalSkills(owner.user.userId, [], [{}]),
      error => error.code === 'revision_conflict');
    assert.deepEqual(await app.postgresRepository.runtimeListGlobalSkills(owner.user.userId), globalBefore);
    const payload = { name: '合成技能', instruction: '合成指令', files: ['SKILL.md', 'references/sample.md'],
      runtimeFiles: { 'SKILL.md': '合成指令', 'references/sample.md': '合成附件' } };
    const imported = await request('/api/skills/import', { method: 'POST', token: owner.token, body: payload });
    assert.equal(imported.status, 200);
    const catalog = await request('/api/skills', { token: owner.token });
    assert.equal(catalog.status, 200);
    assert.equal(catalog.body.find(skill => skill.id === imported.body.id).runtimeFiles['references/sample.md'], '合成附件');
    assert.ok(!(await request('/api/skills', { token: downloader.token })).body.some(skill => skill.id === imported.body.id));
    const published = await request('/api/open-skills', { method: 'POST', token: owner.token, body: payload });
    assert.equal(published.status, 200);
    const skillId = published.body.skill.id;
    const route = `/api/open-skills/${skillId}`;
    assert.equal((await request(route)).status, 200);
    assert.equal((await request(route, { method: 'PATCH', token: downloader.token, body: { name: '越权' } })).status, 403);
    const copied = await request(route + '/download', { method: 'POST', token: downloader.token });
    assert.equal(copied.status, 200);
    assert.equal(copied.body.source.downloads, 1);
    assert.equal(copied.body.skill.runtimeFiles['references/sample.md'], '合成附件');
    const source = await app.postgresRepository.runtimeGetOpenSkill(owner.user.userId, skillId);
    assert.equal(Number(source.downloads), 1);
    await assert.rejects(app.postgresRepository.runtimeDownloadOpenSkill({
      actorUserId: downloader.user.userId, ownerEmail: downloader.user.email, skillId, copiedId: 'x'.repeat(1000)
    }));
    assert.equal(Number((await app.postgresRepository.runtimeGetOpenSkill(owner.user.userId, skillId)).downloads), 1);
    assert.equal((await request(route, { method: 'PATCH', token: owner.token, body: { status: 'withdrawn' } })).status, 200);
    assert.equal((await request(route)).status, 404);
    assert.equal((await request(route + '/download', { method: 'POST', token: downloader.token })).status, 404);
    assert.equal((await request(route, { method: 'DELETE', token: owner.token })).status, 200);
    const audit = await request('/api/admin/audit', { token: adminToken });
    assert.equal(audit.status, 200);
    assert.ok(audit.body.audit.some(item => item.target === skillId && item.action === 'open-skill.delete'));
    await assert.rejects(app.postgresRepository.runtimeAppendAdminAudit(downloader.user.userId, {
      id: 'denied-' + crypto.randomBytes(8).toString('hex'), adminEmail: downloader.user.email,
      action: 'spoof', target: '', detail: {}, createdAt: Date.now()
    }));
    const dissectionId = 'd_share_' + crypto.randomBytes(12).toString('hex');
    await app.postgresRepository.runtimeInsertDissection({
      id: dissectionId, ownerUserId: owner.user.userId, userEmail: owner.user.email,
      title: '有限分享验收', sourceText: '不得出现在分享响应中的合成原文', status: 'completed',
      result: {}, meta: { wordCount: 16, chapterCount: 1, privateMarker: '不能公开的元数据' }
    });
    const memberToken = crypto.randomBytes(12).toString('hex');
    const publicToken = crypto.randomBytes(12).toString('hex');
    const expiredToken = crypto.randomBytes(12).toString('hex');
    await app.postgresRepository.runtimeUpsertDissectionRows(owner.user.userId, [
      { token: memberToken, grantee_email: downloader.user.email, expires_at: Date.now() + 60000 },
      { token: publicToken, grantee_email: '', expires_at: 0 },
      { token: expiredToken, grantee_email: '', expires_at: Date.now() - 1000 }
    ].map(share => ({ rowKey: share.token, dissectionId, sourceTable: 'dissection_shares',
      document: { ...share, dissection_id: dissectionId, user_email: owner.user.email, role: 'view', created_at: Date.now() } })));
    const sharedRoute = token => '/api/shared/dissection/' + token;
    assert.equal((await request(sharedRoute(memberToken))).status, 401);
    assert.equal((await request(sharedRoute(memberToken), { token: owner.token })).status, 403);
    const memberRead = await request(sharedRoute(memberToken), { token: downloader.token });
    assert.equal(memberRead.status, 200);
    assert.equal(memberRead.body.shared.id, dissectionId);
    assert.ok(!JSON.stringify(memberRead.body).includes('不得出现在分享响应'));
    assert.ok(!JSON.stringify(memberRead.body).includes('privateMarker'));
    assert.equal((await request(sharedRoute(publicToken))).status, 200);
    assert.equal((await request(sharedRoute(expiredToken))).status, 410);
    const sharedList = await request('/api/dissections/shared', { token: downloader.token });
    assert.equal(sharedList.status, 200);
    assert.ok(sharedList.body.shared.some(item => item.token === memberToken));
    assert.ok(!(await request('/api/dissections/shared', { token: owner.token })).body.shared.some(item => item.token === memberToken));
    await app.postgresRepository.runtimeDeleteDissectionRow(owner.user.userId, dissectionId, 'dissection_shares', memberToken);
    assert.equal((await request(sharedRoute(memberToken), { token: downloader.token })).status, 404);
    const contextResponse = await request(`/api/dissections/${dissectionId}/creation-context?chapterNo=1`, { token: owner.token });
    assert.equal(contextResponse.status, 200);
    assert.equal(contextResponse.body.context.upTo, 1);
    assert.equal((await request(`/api/dissections/${dissectionId}/creation-context`, { token: downloader.token })).status, 404);
    for (const tool of ['imitate', 'diagnose']) {
      assert.equal((await request(`/api/dissection/${dissectionId}/${tool}`, {
        method: 'POST', token: downloader.token, body: {}
      })).status, 404);
    }
    const batch = await request('/api/dissections/batch', { method: 'POST', token: owner.token,
      body: { run: false, tasks: [{ text: '第一章：合成批量甲。', title: '合成批量甲', depth: 'quick' },
        { text: '第一章：合成批量乙。', title: '合成批量乙', depth: 'quick' }] }
    });
    assert.equal(batch.status, 202);
    assert.equal(batch.body.count, 2);
    for (const task of batch.body.tasks) {
      assert.equal((await app.postgresRepository.runtimeGetDissection(owner.user.userId, task.id)).status, 'queued');
    }
    const firstCharacterId = 'cl_a_' + crypto.randomBytes(8).toString('hex');
    const secondCharacterId = 'cl_b_' + crypto.randomBytes(8).toString('hex');
    const characters = [
      { id: firstCharacterId, name: '合成人物甲', goal: '寻找账本', notes: '' },
      { id: secondCharacterId, name: '合成人物乙', function: '引路人', conflict: '渡口封锁' }
    ].map(character => ({ rowKey: character.id, dissectionId, sourceTable: 'character_library',
      document: { ...character, dissection_id: dissectionId, user_email: owner.user.email, created_at: Date.now() } }));
    assert.equal(await app.postgresRepository.runtimeSyncCharactersToLibrary(owner.user.userId, characters), 2);
    const library = await request('/api/characters', { token: owner.token });
    assert.equal(library.status, 200);
    assert.ok(library.body.characters.some(character => character.id === firstCharacterId));
    assert.ok(!(await request('/api/characters', { token: downloader.token })).body.characters.some(character => character.id === firstCharacterId));
    assert.equal((await request('/api/characters/' + firstCharacterId, {
      method: 'PATCH', token: downloader.token, body: { notes: '越权' }
    })).status, 404);
    const patched = await request('/api/characters/' + firstCharacterId, {
      method: 'PATCH', token: owner.token, body: { notes: '手工编辑不可被同步覆盖' }
    });
    assert.equal(patched.status, 200);
    assert.equal(await app.postgresRepository.runtimeSyncCharactersToLibrary(owner.user.userId, characters), 0);
    assert.equal((await request('/api/characters/' + firstCharacterId, {
      method: 'PATCH', token: owner.token, body: { name: '合成人物乙' }
    })).status, 409);
    await Promise.all([
      app.postgresRepository.runtimePatchCharacter(owner.user.userId, firstCharacterId, { goal: '并发目标' }),
      app.postgresRepository.runtimePatchCharacter(owner.user.userId, firstCharacterId, { arc: '并发成长' })
    ]);
    const merged = await request('/api/characters/merge', { method: 'POST', token: owner.token,
      body: { fromNames: ['合成人物甲', '合成人物乙'], intoName: '合成主角' } });
    assert.equal(merged.status, 200);
    assert.equal(merged.body.merged, 2);
    const updatedLibrary = await request('/api/characters', { token: owner.token });
    const mergedCharacter = updatedLibrary.body.characters.find(character => character.name === '合成主角');
    assert.equal(mergedCharacter.goal, '并发目标');
    assert.equal(mergedCharacter.arc, '并发成长');
    assert.equal(mergedCharacter.function, '引路人');
    assert.equal(mergedCharacter.notes, '手工编辑不可被同步覆盖');
    const exported = await request('/api/characters/export', { token: owner.token });
    assert.equal(exported.status, 200);
    assert.ok(exported.body.some(character => character.name === '合成主角'));
    const csvResponse = await fetch(address + '/api/characters/export?format=csv', {
      headers: { Authorization: `Bearer ${owner.token}` }
    });
    assert.equal(csvResponse.status, 200);
    assert.match(await csvResponse.text(), /合成主角/);
    assert.equal(forbiddenAccess, 0);
  } finally {
    prototype.prepare = originalPrepare;
    if (listening) await new Promise(resolve => app.server.close(resolve));
    await app.postgresRepository.close();
  }
});
