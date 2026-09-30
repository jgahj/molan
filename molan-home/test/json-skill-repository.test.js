'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonFileRepository } = require('../lib/repositories/json-file-repository');
const { JsonAppRepository } = require('../lib/repositories/json-app-repository');
const { JsonSkillRepository } = require('../lib/repositories/json-skill-repository');

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-skill-native-'));
  const repository = new JsonFileRepository(directory);
  t.after(async () => { await repository.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const app = new JsonAppRepository(directory, { repository });
  const users = {};
  for (const [name, role] of [['alice', 'user'], ['bob', 'user'], ['admin', 'admin']]) {
    users[name] = await app.saveAccount({ email: `${name}@example.test`, role });
  }
  return { directory, repository, users, skills: new JsonSkillRepository(repository) };
}
const skill = (id = 'one') => ({ id, name: 'Skill', instruction: 'Write coherent prose.', runtimeFiles: { 'SKILL.md': 'Write coherent prose.' }, files: ['SKILL.md'], fileManifest: [], complete: true });

test('personal skill writes use owner ACL, CAS and survive restart with immutable history', async t => {
  const { directory, repository, users, skills } = await fixture(t);
  const input = { actorUserId: users.alice.userId, ownerEmail: 'ALICE@EXAMPLE.TEST', skills: [skill()], expectedRevision: 0 };
  const saved = await skills.saveUserRecords(input);
  assert.equal(saved.revision, 1);
  await assert.rejects(skills.saveUserRecords(input), { code: 'REVISION_CONFLICT' });
  await assert.rejects(skills.listUser({ actorUserId: users.bob.userId, ownerEmail: users.alice.email }), { code: 'FORBIDDEN' });
  await assert.rejects(skills.saveUserRecords({ ...input, actorUserId: users.bob.userId }), { code: 'FORBIDDEN' });
  await assert.rejects(skills.saveUserRecords({ ...input, expectedRevision: 1, skills: [{ ...skill(), runtimeFiles: { '../outside': 'bad' } }] }), { code: 'INVALID_SKILL_FILES' });
  const history = await skills.listAudit({ actorUserId: users.alice.userId });
  assert.equal(history.length, 1);
  assert.equal(history[0].snapshot.skills[0].instruction, skill().instruction);
  await repository.close();
  const reopened = new JsonFileRepository(directory);
  try { assert.equal((await new JsonSkillRepository(reopened).listUser(input)).skills.length, 1); }
  finally { await reopened.close(); }
});

test('marketplace publish, download receipt and counter commit together with owner permissions', async t => {
  const { users, skills } = await fixture(t);
  const published = await skills.saveOpen({ actorUserId: users.alice.userId, skill: skill(), expectedRevision: 0 });
  assert.equal(published.downloads, 0);
  await assert.rejects(skills.saveOpen({ actorUserId: users.bob.userId, skill: { ...published, instruction: 'attack' }, expectedRevision: 1 }), { code: 'FORBIDDEN' });
  const request = { actorUserId: users.bob.userId, id: 'one', requestId: 'download-1' };
  const [downloaded, retry] = await Promise.all([skills.downloadOpen(request), skills.downloadOpen(request)]);
  assert.deepEqual(downloaded, retry);
  assert.equal((await skills.getOpen({ id: 'one' })).downloads, 1);
  assert.equal((await skills.listUser({ actorUserId: users.bob.userId, ownerEmail: users.bob.email })).skills.length, 1);
  await assert.rejects(skills.downloadOpen({ ...request, id: 'another' }), { code: 'IDEMPOTENCY_CONFLICT' });
  const current = await skills.getOpen({ id: 'one' });
  const withdrawn = await skills.saveOpen({ actorUserId: users.alice.userId, skill: { ...current, status: 'withdrawn' }, expectedRevision: current.revision });
  assert.equal((await skills.listOpen()).length, 0);
  assert.equal((await skills.listOpen({ actorUserId: users.alice.userId })).length, 1);
  await assert.rejects(skills.downloadOpen({ ...request, requestId: 'new-download' }), { code: 'SKILL_NOT_FOUND' });
  await assert.rejects(skills.deleteOpen({ actorUserId: users.bob.userId, id: 'one', expectedRevision: withdrawn.revision }), { code: 'FORBIDDEN' });
  assert.equal(await skills.deleteOpen({ actorUserId: users.alice.userId, id: 'one', expectedRevision: withdrawn.revision }), 1);
  assert.equal((await skills.listUser({ actorUserId: users.bob.userId, ownerEmail: users.bob.email })).skills.length, 1);
});

test('global skills require canonical administrator and quality promotion evidence', async t => {
  const { users, skills } = await fixture(t);
  await assert.rejects(skills.saveGlobal({ actorUserId: users.alice.userId, skills: [skill()], expectedRevision: 0 }), { code: 'FORBIDDEN' });
  await assert.rejects(skills.saveGlobal({ actorUserId: users.admin.userId, skills: [skill()], expectedRevision: 0 }), { code: 'QUALITY_PROMOTION_BLOCKED' });
  assert.deepEqual(await skills.listGlobal(), { revision: 0, skills: [] });
});
