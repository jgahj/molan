'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdminService } = require('../services/admin-service');

test('admin platform mutations reject missing evidence before persistence or cache mutation', async () => {
  // PG-only 收敛后：global skills 读写统一走 postgresRepository runtime* 接口；
  // 门禁（assertPlatformConfigPromotion）必须在任何持久化调用之前抛错。
  const storedRows = [{ id: 'existing', name: 'Existing', instruction: 'old' }];
  let replaceCalls = 0;
  let modelPolicyWrites = 0;
  let resolveResponse;
  const service = createAdminService({
    getAuthUser: () => ({ user: { email: 'admin@example.test', userId: 'admin-1' } }),
    isAdminUser: () => true,
    readBody: async req => req.body,
    makeGlobalSkill: (body, previous) => ({ ...previous, ...body }),
    decodePathParam: value => value,
    findPlatformModel: () => ({ id: 'model' }),
    saveModelPolicy: () => { modelPolicyWrites++; },
    postgresRepository: {
      runtimeListGlobalSkills: async () => storedRows.map(row => ({ ...row })),
      runtimeReplaceGlobalSkills: async () => { replaceCalls++; return []; }
    },
    postgresRuntimeSkillFromRow: row => ({ ...row }),
    respondError: (res, error) => resolveResponse(error),
    json: () => resolveResponse(null)
  });
  async function reject(method, body, id) {
    const response = new Promise(resolve => { resolveResponse = resolve; });
    service[method]({ body }, {}, id);
    const error = await response;
    assert.equal(error?.code, 'QUALITY_PROMOTION_BLOCKED');
    assert.equal(replaceCalls, 0);
    assert.equal(modelPolicyWrites, 0);
    assert.deepEqual(storedRows, [{ id: 'existing', name: 'Existing', instruction: 'old' }]);
  }
  await reject('handleAdminModelsPatch', { defaultModel: 'model' });
  await reject('handleAdminSkillCreate', { id: 'new', instruction: 'new' });
  await reject('handleAdminSkillPatch', { instruction: 'new' }, 'existing');
  await reject('handleAdminSkillDelete', {}, 'existing');
});
