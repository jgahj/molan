'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readConfig } = require('../lib/postgres-repository');

test('isolated PG admin data HTTP: native PG list/get/patch/delete, zero legacy store calls, 403, CAS & billing safety', {
  skip: process.env.MOLAN_PG_ADMIN_DATA_ACCEPTANCE !== '1' && process.env.MOLAN_PG_ACCEPTANCE !== '1',
  timeout: 30000
}, async () => {
  const settings = readConfig(process.env);
  assert.ok(settings.enabled && /test|acceptance/i.test(settings.config.database || ''));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-pg-admin-data-http-'));
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
      if (/\b(accounts|token_usage|user_skills|global_skills|open_skills|admin_audit|dissections|dissection_shares|character_library|novels)\b/i.test(String(sql))) {
        forbiddenAccess++;
        throw new Error('Admin data accessed legacy SQL: ' + sql);
      }
      return originalPrepare.call(this, sql, ...args);
    };

    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    listening = true;
    const address = `http://127.0.0.1:${app.server.address().port}`;

    const request = async (route, { method = 'GET', token, body } = {}) => {
      const response = await fetch(address + route, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json'
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return { status: response.status, body: await response.json() };
    };

    const register = async (prefix = 'user') => {
      const suffix = crypto.randomBytes(12).toString('hex');
      const email = `${prefix}-${suffix}@example.test`;
      const result = await request('/api/auth/register', {
        method: 'POST',
        body: { email, password: suffix, name: '验收用户' }
      });
      assert.equal(result.status, 200);
      return { ...result.body, password: suffix, email };
    };

    // 1. 普通用户与管理员创建
    const normalUser = await register('normal');
    const adminUser = await register('admin');

    const adminAccount = await app.postgresRepository.runtimeAccountByUserId(adminUser.user.userId);
    await app.postgresRepository.runtimeUpdateAccount({
      actorUserId: adminUser.user.userId,
      userId: adminUser.user.userId,
      email: adminUser.user.email,
      name: '系统管理员',
      salt: adminAccount.salt,
      pwd: adminAccount.pwd,
      role: 'admin',
      preserveFinancials: true
    });

    const adminLogin = await request('/api/admin/auth/login', {
      method: 'POST',
      body: { email: adminUser.user.email, password: adminUser.password }
    });
    assert.equal(adminLogin.status, 200);
    const adminToken = adminLogin.body.token;

    // 2. 普通用户访问 admin data 接口直接 403
    const forbiddenList = await request('/api/admin/data?type=accounts', { token: normalUser.token });
    assert.equal(forbiddenList.status, 401);
    const forbiddenPatch = await request('/api/admin/data', {
      method: 'PATCH',
      token: normalUser.token,
      body: { type: 'accounts', id: normalUser.email, record: { name: '非法修改' } }
    });
    assert.equal(forbiddenPatch.status, 401);
    const forbiddenDelete = await request('/api/admin/data', {
      method: 'DELETE',
      token: normalUser.token,
      body: { type: 'novels', id: 'n1' }
    });
    assert.equal(forbiddenDelete.status, 401);
    const normalAdminToken = crypto.randomBytes(24).toString('hex');
    await app.postgresRepository.createAuthSession({
      sessionId: crypto.randomUUID(),
      userId: normalUser.user.userId,
      tokenHash: app.hashSessionToken(normalAdminToken),
      scope: 'admin',
      expiresAt: Date.now() + 600000
    });
    const forbiddenRole = await request('/api/admin/data?type=accounts', { token: normalAdminToken });
    assert.equal(forbiddenRole.status, 403);
    const novelId = 'n_admin' + crypto.randomBytes(6).toString('hex');
    const createdNovel = await request('/api/novels', {
      method: 'POST', token: normalUser.token,
      body: { id: novelId, state: { title: '转移前', volumes: [] } }
    });
    assert.equal(createdNovel.status, 200, JSON.stringify(createdNovel.body));
    const profile = await app.postgresRepository.getProfile(normalUser.user.userId, novelId);
    const transfer = await request('/api/admin/data', {
      method: 'PATCH', token: adminToken,
      body: { type: 'novels', id: novelId, expectedRevision: profile.revision,
        record: { title: '转移后', userEmail: adminUser.email, state: { title: '转移后', volumes: [] } } }
    });
    assert.equal(transfer.status, 200, JSON.stringify(transfer.body));
    const staleTransfer = await request('/api/admin/data', {
      method: 'PATCH', token: adminToken,
      body: { type: 'novels', id: novelId, expectedRevision: profile.revision,
        record: { title: '旧覆盖', state: { title: '旧覆盖', volumes: [] } } }
    });
    assert.equal(staleTransfer.status, 412);
    const transferredProfile = await app.postgresRepository.getProfile(adminUser.user.userId, novelId);
    assert.equal(transferredProfile.state.title, '转移后');
    await assert.rejects(app.postgresRepository.runtimeAdminWriteNovel({
      actorUserId: normalUser.user.userId, id: novelId,
      expectedRevision: transferredProfile.revision, title: '越权', state: { title: '越权', volumes: [] }
    }), error => error.status === 403);
    const missingDeleteRevision = await request('/api/admin/data', {
      method: 'DELETE', token: adminToken, body: { type: 'novels', id: novelId }
    });
    assert.equal(missingDeleteRevision.status, 428);
    const staleDeleteRevision = await request('/api/admin/data', {
      method: 'DELETE', token: adminToken,
      body: { type: 'novels', id: novelId, expectedRevision: profile.revision }
    });
    assert.equal(staleDeleteRevision.status, 412);
    const deletedNovel = await request('/api/admin/data', {
      method: 'DELETE', token: adminToken,
      body: { type: 'novels', id: novelId, expectedRevision: transferredProfile.revision }
    });
    assert.equal(deletedNovel.status, 200);
    assert.equal(deletedNovel.body.deleted, 1);
    const accountBefore = await app.postgresRepository.runtimeAccountByUserId(normalUser.user.userId);
    const usageId = 'admin_billing_' + crypto.randomBytes(8).toString('hex');
    await app.postgresRepository.runtimeReserveTokenUsage({
      actorUserId: normalUser.user.userId, requestId: usageId, reservedCost: 2,
      document: { request_id: usageId, user_email: normalUser.email, model_id: 'synthetic-local', total_tokens: null,
        status: 'reserved', reserved_cost: 2, credit_cost: null }
    });
    await assert.rejects(app.postgresRepository.runtimeAdminWriteTokenUsage({
      actorUserId: adminUser.user.userId, requestId: usageId, patch: { creditCost: 1 }
    }), error => error.status === 409);
    await app.postgresRepository.runtimeSettleTokenUsage({
      actorUserId: normalUser.user.userId, requestId: usageId, reservedCost: 2,
      holdReservation: true, document: { total_tokens: null }
    });
    const unknown = await app.postgresRepository.runtimeAdminWriteTokenUsage({
      actorUserId: adminUser.user.userId, requestId: usageId, patch: { creditCost: null }
    });
    assert.equal(unknown.credit_cost, null);
    await assert.rejects(app.postgresRepository.runtimeAdminWriteTokenUsage({
      actorUserId: adminUser.user.userId, requestId: usageId, patch: { creditCost: 1 }
    }), error => error.code === 'usage_evidence_required');
    const auditId = 'audit_billing_' + crypto.randomBytes(8).toString('hex');
    await app.postgresRepository.runtimeAdminWriteTokenUsage({
      actorUserId: adminUser.user.userId, requestId: usageId,
      patch: { creditCost: 1, totalTokens: 30 },
      audit: { id: auditId, actorEmail: adminUser.email, action: 'billing.acceptance', target: usageId, details: { synthetic: true } }
    });
    const accountSettled = await app.postgresRepository.runtimeAccountByUserId(normalUser.user.userId);
    assert.equal(Number(accountSettled.credits), Number(accountBefore.credits) - 1);
    assert.equal(Number(accountSettled.spent), Number(accountBefore.spent) + 1);
    await assert.rejects(app.postgresRepository.runtimeAdminWriteTokenUsage({
      actorUserId: adminUser.user.userId, requestId: usageId, patch: { creditCost: 2 },
      audit: { id: auditId, actorEmail: adminUser.email, action: 'duplicate', target: usageId }
    }));
    const afterRollback = await app.postgresRepository.runtimeAccountByUserId(normalUser.user.userId);
    assert.equal(Number(afterRollback.credits), Number(accountSettled.credits));
    assert.equal(Number(afterRollback.spent), Number(accountSettled.spent));
    await app.postgresRepository.runtimeAdminWriteTokenUsage({
      actorUserId: adminUser.user.userId, requestId: usageId, patch: { creditCost: 1 }
    });
    assert.equal(Number((await app.postgresRepository.runtimeAccountByUserId(normalUser.user.userId)).spent), Number(accountSettled.spent));

    // 3. 管理员分页列出所有类型（全部走 PG）
    const allTypes = ['accounts', 'novels', 'user-skills', 'global-skills', 'open-skills', 'dissections', 'token-usage', 'builtin-skills'];
    for (const type of allTypes) {
      const res = await request('/api/admin/data?type=' + type, { token: adminToken });
      assert.equal(res.status, 200, `List ${type} failed: ${JSON.stringify(res.body)}`);
      assert.ok(Array.isArray(res.body.rows));
      assert.ok(res.body.pagination);
    }

    // 4. 只读与不可删除类型防线测试 (409)
    const builtinPatch = await request('/api/admin/data', {
      method: 'PATCH',
      token: adminToken,
      body: { type: 'builtin-skills', id: 'some-builtin', record: { instruction: 'new' } }
    });
    assert.equal(builtinPatch.status, 409);

    const builtinDelete = await request('/api/admin/data', {
      method: 'DELETE',
      token: adminToken,
      body: { type: 'builtin-skills', id: 'some-builtin' }
    });
    assert.equal(builtinDelete.status, 409);

    const accountDelete = await request('/api/admin/data', {
      method: 'DELETE',
      token: adminToken,
      body: { type: 'accounts', id: normalUser.email }
    });
    assert.equal(accountDelete.status, 409);

    const tokenUsageDelete = await request('/api/admin/data', {
      method: 'DELETE',
      token: adminToken,
      body: { type: 'token-usage', id: 'req-nonexistent' }
    });
    assert.equal(tokenUsageDelete.status, 409);

    // 5. Open Skill 原生 PG 写与删
    const openSkillId = 'open-' + crypto.randomBytes(8).toString('hex');
    await app.postgresRepository.runtimeUpsertOpenSkill({
      actorUserId: adminUser.user.userId,
      ownerUserId: adminUser.user.userId,
      ownerEmail: adminUser.email,
      skill: {
      id: openSkillId,
      name: '初始开放技能',
      description: '描述',
      instruction: '初始指令',
      status: 'published'
      }
    });

    const openSkillPatch = await request('/api/admin/data', {
      method: 'PATCH',
      token: adminToken,
      body: {
        type: 'open-skills',
        id: openSkillId,
        record: { name: '已修改开放技能', instruction: '新指令内容' }
      }
    });
    assert.equal(openSkillPatch.status, 200);
    assert.equal(openSkillPatch.body.record.name, '已修改开放技能');

    const openSkillDelete = await request('/api/admin/data', {
      method: 'DELETE',
      token: adminToken,
      body: { type: 'open-skills', id: openSkillId }
    });
    assert.equal(openSkillDelete.status, 200);
    assert.equal(openSkillDelete.body.deleted, 1);

    // 6. User Skill 原生 PG 单项定位、更新与删除
    const userSkillId = 'user-sk-' + crypto.randomBytes(8).toString('hex');
    await app.postgresRepository.runtimeUpsertUserSkill({
      actorUserId: normalUser.user.userId,
      ownerEmail: normalUser.email,
      skill: {
      id: userSkillId,
      name: '个人技能1',
      instruction: '个人指令'
      }
    });

    const userSkillPatch = await request('/api/admin/data', {
      method: 'PATCH',
      token: adminToken,
      body: {
        type: 'user-skills',
        id: userSkillId,
        owner: normalUser.email,
        record: { name: '个人技能已改', instruction: '新个人指令' }
      }
    });
    assert.equal(userSkillPatch.status, 200);
    assert.equal(userSkillPatch.body.record.name, '个人技能已改');

    const userSkillDelete = await request('/api/admin/data', {
      method: 'DELETE',
      token: adminToken,
      body: {
        type: 'user-skills',
        id: userSkillId,
        owner: normalUser.email
      }
    });
    assert.equal(userSkillDelete.status, 200);
    assert.equal(userSkillDelete.body.deleted, 1);

    // 7. Dissection 原生 PG 写与删（保持 actualCredits=null 及 worker fence）
    const dissectionId = 'diss-' + crypto.randomBytes(8).toString('hex');
    await app.postgresRepository.runtimeInsertDissection({
      id: dissectionId,
      actorUserId: normalUser.user.userId,
      ownerUserId: normalUser.user.userId,
      userEmail: normalUser.email,
      title: '拆书测试',
      sourceType: 'text',
      sourceName: '片段',
      sourceText: '这是拆书测试的文本内容',
      status: 'queued'
    });

    const dissectionPatch = await request('/api/admin/data', {
      method: 'PATCH',
      token: adminToken,
      body: {
        type: 'dissections',
        id: dissectionId,
        record: { title: '拆书更新后', actualCredits: null }
      }
    });
    assert.equal(dissectionPatch.status, 200);
    assert.equal(dissectionPatch.body.record.title, '拆书更新后');
    assert.equal(dissectionPatch.body.record.actualCredits, null);

    const dissectionDelete = await request('/api/admin/data', {
      method: 'DELETE',
      token: adminToken,
      body: { type: 'dissections', id: dissectionId }
    });
    assert.equal(dissectionDelete.status, 200);
    assert.equal(dissectionDelete.body.deleted, 1);

    // 8. 验证零旧存储/SQLite访问
    assert.equal(forbiddenAccess, 0, 'In POSTGRES_MODE, no legacy SQL tables may be touched!');
  } finally {
    prototype.prepare = originalPrepare;
    if (listening) {
      await new Promise(resolve => app.server.close(resolve));
    }
    await app.postgresRepository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
