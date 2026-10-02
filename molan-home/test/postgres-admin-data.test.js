'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdminService } = require('../services/admin-service');

function fixture(rowsOrOptions = {}) {
  const isLegacyCall = Array.isArray(rowsOrOptions);
  const options = isLegacyCall ? { rows: rowsOrOptions } : rowsOrOptions;
  const responses = [];
  const calls = [];
  const rows = options.rows || [];
  const repo = {
    runtimeAdminDataRows: async (...args) => { calls.push(args); return rows; },
    runtimeAdminGetNovel: async (...args) => { calls.push(['runtimeAdminGetNovel', ...args]); return options.novel || null; },
    runtimeAdminWriteNovel: async (input) => {
      calls.push(['runtimeAdminWriteNovel', input]);
      if (options.throwNovel) throw options.throwNovel;
      return options.writeNovelResult || { revision: (Number(input.expectedRevision) || 1) + 1 };
    },
    runtimeAdminWriteUserSkill: async (input) => {
      calls.push(['runtimeAdminWriteUserSkill', input]);
      if (options.throwUserSkill) throw options.throwUserSkill;
      return options.userSkillRow || { id: input.skillId, name: input.skill?.name || 'Skill', instruction: input.skill?.instruction || 'text', updated_at_value: 100 };
    },
    runtimeAdminDeleteUserSkill: async (input) => {
      calls.push(['runtimeAdminDeleteUserSkill', input]);
      return options.deleteUserSkillChanges ?? 1;
    },
    runtimeListGlobalSkills: async (...args) => {
      calls.push(['runtimeListGlobalSkills', ...args]);
      return options.globalSkillsRows || [{ id: 'g1', name: 'G1', instruction: 'prompt', enabled: true }];
    },
    runtimeReplaceGlobalSkills: async (...args) => {
      calls.push(['runtimeReplaceGlobalSkills', ...args]);
      return true;
    },
    runtimeAdminWriteOpenSkill: async (input) => {
      calls.push(['runtimeAdminWriteOpenSkill', input]);
      if (options.throwOpenSkill) throw options.throwOpenSkill;
      return options.openSkillRow || { id: input.skillId, name: input.record?.name || 'Open 1', owner_email: 'author@test.invalid' };
    },
    runtimeAdminDeleteOpenSkill: async (input) => {
      calls.push(['runtimeAdminDeleteOpenSkill', input]);
      return options.deleteOpenSkillChanges ?? 1;
    },
    runtimeAdminWriteDissection: async (input) => {
      calls.push(['runtimeAdminWriteDissection', input]);
      return options.dissectionRow || { id: input.id, title: input.record?.title || 'D1', actual_credits: input.record?.actualCredits ?? null };
    },
    runtimeAdminDeleteDissection: async (input) => {
      calls.push(['runtimeAdminDeleteDissection', input]);
      return options.deleteDissectionChanges ?? 1;
    },
    runtimeAdminWriteTokenUsage: async (input) => {
      calls.push(['runtimeAdminWriteTokenUsage', input]);
      if (options.throwTokenUsage) throw options.throwTokenUsage;
      return options.tokenUsageDoc || { request_id: input.requestId, user_email: 'u@test.invalid', credit_cost: input.patch?.creditCost ?? 5 };
    },
    runtimeAdminUpdateAccount: async (input) => {
      calls.push(['runtimeAdminUpdateAccount', input]);
      return options.accountRow || { email: input.email, role: input.role || 'normal', credits: input.credits || 100 };
    },
    runtimeAccountByEmail: async (...args) => {
      calls.push(['runtimeAccountByEmail', ...args]);
      return options.accountRow || { id: 'uuid-1', legacy_user_id: 'u1', email: args[0], role: 'normal', credits: 100 };
    },
    ...options.postgresRepository
  };

  const service = createAdminService({
    POSTGRES_MODE: true,
    ADMIN_DATA_TYPES: new Set(['accounts', 'novels', 'user-skills', 'global-skills', 'open-skills', 'builtin-skills', 'dissections', 'token-usage']),
    ACCOUNT_ROLES: new Set(['normal', 'vip', 'admin']),
    MAX_NOVEL_STATE_BYTES: 10 * 1024 * 1024,
    getAuthUser: () => (options.authUser !== undefined ? options.authUser : { user: { userId: 'admin-id', email: 'admin@test.invalid', role: 'admin' } }),
    isAdminUser: (user) => (options.isAdmin !== undefined ? options.isAdmin(user) : (user && user.role === 'admin')),
    dbReady: () => true,
    getDatabase: () => { throw new Error('旧存储不可调用'); },
    loadUsers: () => { throw new Error('旧存储不可调用'); },
    saveUser: () => { throw new Error('旧存储不可调用'); },
    loadAllUserSkillRecords: () => { throw new Error('旧存储不可调用'); },
    saveAllUserSkillRecords: () => { throw new Error('旧存储不可调用'); },
    loadGlobalSkills: () => { throw new Error('旧存储不可调用'); },
    saveGlobalSkills: () => { throw new Error('旧存储不可调用'); },
    findOpenSkill: () => { throw new Error('旧存储不可调用'); },
    updateOpenSkill: () => { throw new Error('旧存储不可调用'); },
    deleteOpenSkill: () => { throw new Error('旧存储不可调用'); },
    deleteDissectionCascade: () => { throw new Error('旧存储不可调用'); },
    getUserByEmail: () => { throw new Error('旧存储不可调用'); },
    isConfiguredAdminEmail: () => false,
    normalizeUserRole: (u) => u?.role || 'normal',
    postgresRepository: repo,
    postgresRuntimeUserFromRow: row => ({ ...row, userId: row.legacy_user_id || row.id }),
    postgresRuntimeSkillFromRow: row => ({ id: row.id, name: row.name, instruction: row.instruction, enabled: row.enabled }),
    skillIdsFromAudit: () => [],
    storedSkillAudit: () => ({}),
    emptyCorrectionAudit: () => ({}),
    roundCreditValue: value => (value == null ? null : Number(value)),
    calcWordCount: () => 1234,
    sanitizeNovelStateForStorage: s => s,
    adminDataJson: (val) => JSON.stringify(val),
    dissectionRecordFromDb: r => r,
    findPlatformModel: () => ({ id: 'm1' }),
    builtinSkillsForAdmin: () => [{ id: 'b1', name: 'Builtin 1', description: 'desc', size: 100 }],
    makeGlobalSkill: (record, current) => ({ ...current, ...record }),
    json: (response, status, body) => responses.push({ status, body }),
    respondError: (response, error) => {
      const status = error.statusCode || error.status || 500;
      responses.push({ status, body: { error: error.message, code: error.code } });
    },
    requestError: (status, message) => {
      const err = new Error(message);
      err.status = status;
      return err;
    },
    readBody: async (req) => req.body || {}
  });

  return { service, responses, calls };
}

test('管理员数据分页从 PG 读取，搜索字面量并保留未知费用', async () => {
  const { service, responses, calls } = fixture([
    { request_id: 'r_%', model_id: 'm', total_tokens: null, credit_cost: null, created_at: 2 },
    { request_id: 'other', model_id: 'm', total_tokens: 10, credit_cost: 1, created_at: 1 }
  ]);
  await service.adminDataList({ url: '/api/admin/data?type=token-usage&q=%25' }, {});
  assert.deepEqual(calls, [['admin-id', 'token-usage']]);
  assert.equal(responses[0].status, 200);
  assert.equal(responses[0].body.pagination.total, 1);
  assert.match(responses[0].body.rows[0].summary, /费用未知/);
});

test('管理员个人技能详情同时限定技能和所属账户', async () => {
  const { service, responses } = fixture([{ id: 'same', user_email: 'owner@test.invalid', instruction: 'text' }]);
  await service.adminDataList({ url: '/api/admin/data?type=user-skills&id=same&owner=other@test.invalid' }, {});
  assert.equal(responses[0].status, 404);
  await service.adminDataList({ url: '/api/admin/data?type=user-skills&id=same&owner=owner@test.invalid' }, {});
  assert.equal(responses[1].status, 200);
  assert.equal(responses[1].body.record.owner, 'owner@test.invalid');
});

test('非管理员访问数据接口返回 403 且不触发旧存储', async () => {
  const { service, responses } = fixture({
    authUser: { user: { userId: 'normal-user', email: 'user@test.invalid', role: 'normal' } },
    isAdmin: () => false
  });
  await service.adminDataList({ url: '/api/admin/data?type=accounts' }, {});
  assert.equal(responses[0].status, 403);
  await service.adminDataPatch({ body: { type: 'accounts', id: 'user@test.invalid' } }, {});
  assert.equal(responses[1].status, 403);
  await service.adminDataDelete({ body: { type: 'novels', id: 'n1' } }, {});
  assert.equal(responses[2].status, 403);
});

test('作品列表及详情走原生 PG，更新检验 CAS 并在冲突时返回 412', async () => {
  const { service, responses, calls } = fixture({
    rows: [{ id: 'novel-1', title: '旧剑仙', revision: 2, state: { volumes: [] }, user_email: 'author@test.invalid' }],
    novel: { id: 'novel-1', title: '旧剑仙', revision: 2, state: { volumes: [] }, userEmail: 'author@test.invalid', createdAt: 1, updatedAt: 2 },
    throwNovel: Object.assign(new Error('作品已被其他设备更新'), { status: 412, code: 'revision_conflict' })
  });

  // List novels
  await service.adminDataList({ url: '/api/admin/data?type=novels' }, {});
  assert.equal(responses[0].status, 200);
  assert.equal(responses[0].body.rows[0].title, '旧剑仙');

  // Get novel detail
  await service.adminDataList({ url: '/api/admin/data?type=novels&id=novel-1' }, {});
  assert.equal(responses[1].status, 200);
  assert.equal(responses[1].body.record.id, 'novel-1');

  // Patch novel with CAS conflict
  await service.adminDataPatch({
    body: {
      type: 'novels', id: 'novel-1',
      record: { title: '新剑仙', revision: 1, state: { volumes: [{ chapters: [] }] } }
    }
  }, {});
  assert.equal(responses[2].status, 412);
  assert.match(responses[2].body.error, /其他设备更新/);
});

test('小说删除经原生 PG CAS 事务处理且不可调旧 store', async () => {
  const { service, responses, calls } = fixture({
    writeNovelResult: 1
  });
  await service.adminDataDelete({ body: { type: 'novels', id: 'novel-1', expectedRevision: 2 } }, {});
  assert.equal(responses[0].status, 200);
  assert.equal(responses[0].body.deleted, 1);
  const writeCall = calls.find(c => c[0] === 'runtimeAdminWriteNovel');
  assert.ok(writeCall);
  assert.equal(writeCall[1].delete, true);
  assert.equal(writeCall[1].id, 'novel-1');
  assert.equal(writeCall[1].audit.action, 'data.novels.delete');
});

test('个人技能修改及删除仅单项定位且同事务审计', async () => {
  const { service, responses, calls } = fixture({});
  await service.adminDataPatch({
    body: {
      type: 'user-skills', id: 'skill-x', owner: 'u@test.invalid',
      record: { name: '新技能', instruction: '新指令' }
    }
  }, {});
  assert.equal(responses[0].status, 200);
  const patchCall = calls.find(c => c[0] === 'runtimeAdminWriteUserSkill');
  assert.ok(patchCall);
  assert.equal(patchCall[1].ownerEmail, 'u@test.invalid');
  assert.equal(patchCall[1].skillId, 'skill-x');
  assert.equal(patchCall[1].audit.action, 'data.user-skills.update');

  await service.adminDataDelete({
    body: { type: 'user-skills', id: 'skill-x', owner: 'u@test.invalid' }
  }, {});
  assert.equal(responses[1].status, 200);
  const deleteCall = calls.find(c => c[0] === 'runtimeAdminDeleteUserSkill');
  assert.ok(deleteCall);
  assert.equal(deleteCall[1].ownerEmail, 'u@test.invalid');
  assert.equal(deleteCall[1].skillId, 'skill-x');
  assert.equal(deleteCall[1].audit.action, 'data.user-skills.delete');
});

test('Token 用量修改支持未知费用 null 保持，积分不足时安全回滚 400', async () => {
  const { service, responses, calls } = fixture({
    throwTokenUsage: Object.assign(new Error('账户积分不足，无法增加该记录的扣费'), { status: 400, code: 'insufficient_credits' })
  });

  // Insufficient credits rollback
  await service.adminDataPatch({
    body: {
      type: 'token-usage', id: 'req-1',
      record: { creditCost: 100 }
    }
  }, {});
  assert.equal(responses[0].status, 400);
  assert.match(responses[0].body.error, /积分不足/);

  // Success patch with null creditCost preservation
  const okFixture = fixture({
    tokenUsageDoc: { request_id: 'req-2', user_email: 'u@test.invalid', credit_cost: null, total_tokens: null }
  });
  await okFixture.service.adminDataPatch({
    body: {
      type: 'token-usage', id: 'req-2',
      record: { creditCost: null }
    }
  }, {});
  assert.equal(okFixture.responses[0].status, 200);
  assert.equal(okFixture.responses[0].body.record.creditCost, null);
});

test('只读类型 builtin-skills 及不可删除类型 accounts/token-usage 正确拒绝 409', async () => {
  const { service, responses } = fixture({});
  await service.adminDataPatch({ body: { type: 'builtin-skills', id: 'b1', record: {} } }, {});
  assert.equal(responses[0].status, 409);

  await service.adminDataDelete({ body: { type: 'builtin-skills', id: 'b1' } }, {});
  assert.equal(responses[1].status, 409);

  await service.adminDataDelete({ body: { type: 'accounts', id: 'u@test.invalid' } }, {});
  assert.equal(responses[2].status, 409);

  await service.adminDataDelete({ body: { type: 'token-usage', id: 'req-1' } }, {});
  assert.equal(responses[3].status, 409);
});
