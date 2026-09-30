'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdminService } = require('../services/admin-service');

test('admin platform mutations reject missing evidence before persistence or cache mutation', async () => {
  const skills = [{ id: 'existing', name: 'Existing', instruction: 'old' }];
  let writes = 0;
  let resolveResponse;
  const service = createAdminService({
    getAuthUser: () => ({ user: { email: 'admin@example.test' } }),
    isAdminUser: () => true,
    readBody: async req => req.body,
    loadGlobalSkills: () => skills,
    makeGlobalSkill: (body, previous) => ({ ...previous, ...body }),
    decodePathParam: value => value,
    findPlatformModel: () => ({ id: 'model' }),
    saveModelPolicy: () => { writes++; },
    saveGlobalSkills: () => { writes++; },
    dbReady: () => true,
    requireSqliteForPublic: () => true,
    respondError: (res, error) => resolveResponse(error),
    json: () => resolveResponse(null)
  });
  async function reject(method, body, id) {
    const response = new Promise(resolve => { resolveResponse = resolve; });
    service[method]({ body }, {}, id);
    const error = await response;
    assert.equal(error?.code, 'QUALITY_PROMOTION_BLOCKED');
    assert.equal(writes, 0);
    assert.deepEqual(skills, [{ id: 'existing', name: 'Existing', instruction: 'old' }]);
  }
  await reject('handleAdminModelsPatch', { defaultModel: 'model' });
  await reject('handleAdminSkillCreate', { id: 'new', instruction: 'new' });
  await reject('handleAdminSkillPatch', { instruction: 'new' }, 'existing');
  await reject('handleAdminSkillDelete', {}, 'existing');
});
