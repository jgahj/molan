'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonAppRepository } = require('../lib/repositories/json-app-repository');

test('JSON application repository enforces project ACL, CAS, soft deletion and idempotent ledger', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-json-app-'));
  const app = new JsonAppRepository(directory);
  t.after(async () => { await app.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const owner = { userId: 'usr-owner', email: 'owner@example.test', name: 'Owner', role: 'normal', credits: 10, spent: 0 };
  await app.saveAccount(owner);
  const created = await app.create({ user: owner, id: 'n_apprepo1', title: '仓储测试', state: { title: '仓储测试', volumes: [] } });
  assert.equal(created.revision, 0);
  assert.equal((await app.read({ userId: owner.userId, projectId: created.id })).title, '仓储测试');
  await assert.rejects(app.saveCAS({ userId: owner.userId, projectId: created.id, title: '冲突', state: { volumes: [] }, expectedRevision: 9 }), { code: 'REVISION_CONFLICT' });
  const updated = await app.saveCAS({ userId: owner.userId, projectId: created.id, title: '第二版', state: { volumes: [] }, expectedRevision: 0 });
  assert.equal(updated.revision, 1);
  await assert.rejects(app.create({ user: owner, id: created.id, expectedRevision: 0,
    state: { volumes: [] } }), { code: 'REVISION_CONFLICT' });
  const first = await app.settleLedger({ userId: owner.userId, projectId: created.id, idempotencyKey: 'cost-1', costMinor: 125, detail: { provider: 'test' } });
  const replay = await app.settleLedger({ userId: owner.userId, projectId: created.id, idempotencyKey: 'cost-1', costMinor: 125, detail: { provider: 'test' } });
  assert.equal(first.idempotent, false);
  assert.equal(replay.idempotent, true);
  assert.equal((await app.getAccount(owner.userId)).credits, 8.75);
  const tokenHash = 'a'.repeat(64);
  await app.createAuthSession({ userId: owner.userId, tokenHash, expiresAt: Date.now() + 60000 });
  assert.equal((await app.getAuthSession(tokenHash)).user.email, owner.email);
  await app.revokeAuthSession(tokenHash);
  assert.equal(await app.getAuthSession(tokenHash), null);
  const reservation = { userId: owner.userId, userEmail: owner.email, projectId: created.id,
    workspaceId: created.workspaceId, modelId: 'test', providerModel: 'test', messagesHash: 'b'.repeat(64),
    requestId: 'provider-call-1', reservedCost: 2 };
  await app.reserveTokenUsage(reservation);
  assert.equal((await app.reserveTokenUsage(reservation)).idempotent, true);
  assert.equal((await app.getAccount(owner.userId)).credits, 6.75);
  await app.settleTokenUsage({ userId: owner.userId, projectId: created.id, requestId: reservation.requestId, actualCost: 0.5 });
  assert.equal((await app.getAccount(owner.userId)).credits, 8.25);
  assert.equal((await app.settleTokenUsage({ userId: owner.userId, projectId: created.id,
    requestId: reservation.requestId, actualCost: 0.5 })).idempotent, true);
  await assert.rejects(app.settleTokenUsage({ userId: owner.userId, projectId: created.id,
    requestId: reservation.requestId, actualCost: 0.6 }), { code: 'IDEMPOTENCY_KEY_REUSED' });
  const chat = { ...reservation, requestId: 'account-chat', projectId: '', workspaceId: '', reservedCost: 1 };
  await app.reserveTokenUsage(chat);
  assert.equal((await app.lookupTokenUsage(chat)).status, 'reserved');
  assert.equal(await app.lookupTokenUsage({ ...chat, projectId: created.id }), null);
  await app.settleTokenUsage({ ...chat, actualCost: 0.2 });
  assert.equal((await app.listTokenUsage({ userId: owner.userId })).length, 2);
  const accountRevision = (await app.getAccount(owner.userId)).revision;
  await app.adjustCredits({ userId: owner.userId, delta: 0.2, expectedRevision: accountRevision });
  await assert.rejects(app.adjustCredits({ userId: owner.userId, delta: 1, expectedRevision: accountRevision }), { code: 'REVISION_CONFLICT' });
  const abandoned = { ...chat, requestId: 'abandoned-chat', reservedCost: 0.5 };
  await app.reserveTokenUsage(abandoned);
  assert.equal((await app.releaseStaleTokenUsage({ before: Date.now() + 1 })).released, 1);
  await assert.rejects(app.settleTokenUsage({ ...abandoned, actualCost: 0 }), { code: 'RESERVATION_ALREADY_RELEASED' });
  await app.softDelete({ userId: owner.userId, projectId: created.id });
  assert.equal(await app.read({ userId: owner.userId, projectId: created.id }), null);
  await app.restore({ userId: owner.userId, projectId: created.id });
  assert.equal((await app.read({ userId: owner.userId, projectId: created.id })).title, '第二版');
  await app.saveAccount({ userId: 'usr-viewer', email: 'viewer@example.test', credits: 0 });
  await app.upsertWorkspaceMember(owner.userId, created.workspaceId, 'usr-viewer', 'member');
  await app.upsertProjectMember({ userId: owner.userId, projectId: created.id, targetUserId: 'usr-viewer',
    role: 'viewer', canSpend: true, canExport: true, expectedAclRevision: 1 });
  const viewerAccess = await app.getAccess({ userId: 'usr-viewer', projectId: created.id });
  assert.equal(viewerAccess.can_spend, 0);
  assert.equal(viewerAccess.can_export, 0);
  await assert.rejects(app.saveCAS({ userId: 'usr-viewer', projectId: created.id, expectedRevision: 1, state: { volumes: [] } }), { code: 'FORBIDDEN' });
  await app.deactivateProjectMember({ userId: owner.userId, projectId: created.id, targetUserId: 'usr-viewer' });
  assert.equal(await app.read({ userId: 'usr-viewer', projectId: created.id }), null);
  const resource = await app.saveResource({ userId: owner.userId, projectId: created.id, id: 'char-one', kind: 'character', payload: { name: '人物甲' } });
  assert.equal(resource.resource.revision, 1);
  await assert.rejects(app.saveResource({ userId: owner.userId, projectId: created.id, id: 'char-one', kind: 'character',
    payload: { name: '冲突人物' }, expectedRevision: 0 }), { code: 'REVISION_CONFLICT' });
  await app.saveResource({ userId: owner.userId, projectId: created.id, id: 'char-one', kind: 'character',
    payload: { name: '人物修订' }, expectedRevision: 1 });
  assert.deepEqual((await app.listResourceVersions({ userId: owner.userId, projectId: created.id, id: 'char-one' })).map(row => row.revision), [2, 1]);
  await app.close();
  const reopened = new JsonAppRepository(directory);
  try {
    assert.equal((await reopened.read({ userId: owner.userId, projectId: created.id })).revision, 1);
    assert.equal((await reopened.getAccount(owner.userId)).credits, 8.25);
    assert.equal((await reopened.listResources({ userId: owner.userId, projectId: created.id }))[0].payload.name, '人物修订');
  } finally { await reopened.close(); }
});
