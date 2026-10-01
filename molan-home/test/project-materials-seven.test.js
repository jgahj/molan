'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const projectResources = require('../lib/project-resources');
const { JsonAppRepository } = require('../lib/repositories/json-app-repository');
const { createNativeProjectService } = require('../services/native-project-service');

async function createHarness(t, projectIds = ['n_materials']) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-project-materials-'));
  const repository = new JsonAppRepository(directory);
  t.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await repository.saveAccount({ userId: 'author', email: 'author@example.test' });
  for (const id of projectIds) {
    await repository.create({ id, user: { userId: 'author', email: 'author@example.test' }, state: { title: id, volumes: [] } });
  }
  let actor = 'author';
  const service = createNativeProjectService({
    repository,
    getAuthUser: () => ({ user: { userId: actor } }),
    readBody: async req => req.body || {},
    json: (res, status, body) => { res.status = status; res.body = body; }
  });
  const call = async (method, url, body, headers = {}) => {
    const res = { setHeader(name, value) { this[name] = value; } };
    const handled = await service.dispatch({ method, url, body, headers }, res, new URL(url, 'http://x').pathname);
    assert.equal(handled, true, `${method} ${url} should be handled by the native project service`);
    return res;
  };
  return { repository, call, setActor: value => { actor = value; } };
}

test('小说七大资料板块完整覆盖与分类映射', () => {
  const cats = projectResources.RESOURCE_CATEGORIES;
  assert.ok(cats.basic_positioning.includes('profile'));
  assert.ok(cats.worldbuilding.includes('worldbuilding') && cats.worldbuilding.includes('power-system'));
  assert.ok(cats.characters.includes('character') && cats.characters.includes('relation'));
  assert.ok(cats.plot_outlines.includes('outline') && cats.plot_outlines.includes('scene'));
  assert.ok(cats.special_materials.includes('item') && cats.special_materials.includes('foreshadow'));
  assert.ok(cats.writing_management.includes('timeline') && cats.writing_management.includes('writing-task'));
  assert.ok(cats.publication.includes('publication'));
});

test('native资料支持七大板块生命周期、CAS、软删除恢复与项目隔离', async t => {
  const { call } = await createHarness(t, ['n_materials', 'n_other']);
  const root = '/api/novels/n_materials/resources';
  const pubPayload = {
    coverCopy: '万界沉浮，唯剑独尊！2026玄幻年度力作',
    tags: ['东方玄幻', '热血', '无敌流', '杀伐果断'],
    category: '玄幻-东方玄幻',
    plannedChapterTitles: ['第一章 青云剑出', '第二章 剑气惊龙', '第三章 试剑天下'],
    readerInteractions: [{ triggerChapter: 3, question: '下一章会选择哪门古剑？', targetCommentSection: '第3章末尾' }],
    afterwordPlanning: { plannedExtras: ['番外一：老剑圣的往事'], completionTestimonialOutline: '感谢读者陪伴。' }
  };

  let result = await call('POST', `${root}/publication`, { id: 'pub-main-001', payload: pubPayload });
  assert.equal(result.status, 201);
  assert.equal(result.body.resource.revision, 1);
  assert.equal(result.body.resource.payload.coverCopy, pubPayload.coverCopy);

  const updatedPayload = { ...pubPayload, coverCopy: '万界沉浮，唯剑破苍穹！' };
  result = await call('PATCH', `${root}/publication/pub-main-001`, { payload: updatedPayload, revision: 1 });
  assert.equal(result.status, 200);
  assert.equal(result.body.resource.revision, 2);
  result = await call('PATCH', `${root}/publication/pub-main-001`, { payload: updatedPayload, revision: 1 });
  assert.equal(result.status, 412);

  result = await call('DELETE', `${root}/publication/pub-main-001`, { revision: 2 });
  assert.equal(result.status, 200);
  assert.equal(result.body.revision, 3);
  result = await call('GET', `${root}/publication`);
  assert.equal(result.body.resources.length, 0);
  result = await call('GET', `${root}/publication?includeDeleted=1`);
  assert.equal(result.body.resources.length, 1);
  assert.equal(result.body.resources[0].status, 'deleted');

  result = await call('POST', `${root}/publication/pub-main-001`, { revision: 3, changeReason: '重新启用发布规划' });
  assert.equal(result.status, 200);
  assert.equal(result.body.resource.status, 'active');
  assert.equal(result.body.resource.revision, 4);
  result = await call('POST', `${root}/publication/pub-main-001`, { revision: 4 });
  assert.equal(result.status, 412, 'resource restore only applies to a soft-deleted row');
  result = await call('GET', '/api/novels/n_other/resources/publication/pub-main-001');
  assert.equal(result.status, 404);
});

test('native资料校验字段与引用范围', async t => {
  const { call } = await createHarness(t, ['n_materials', 'n_other']);
  const root = '/api/novels/n_materials/resources';
  let result = await call('POST', `${root}/place`, { id: 'place-north', payload: { name: '北境渡口', parentId: 'region-north', terrain: '河谷', customMapData: { grid: [1, 2] } } });
  assert.equal(result.status, 201);
  assert.deepEqual(result.body.resource.payload.customMapData, { grid: [1, 2] });

  result = await call('POST', `${root}/character`, { id: 'character-invalid-field', payload: { name: 17, age: 24 } });
  assert.equal(result.status, 422);
  assert.equal(result.body.code, 'resource_field_type_invalid');
  result = await call('POST', `${root}/scene`, { id: 'scene-cross-project', payload: { title: '跨项目入口', references: [{ kind: 'place', id: 'place-north', projectId: 'n_other' }] } });
  assert.equal(result.status, 422);
  assert.equal(result.body.code, 'REFERENCE_CROSS_PROJECT_FORBIDDEN');
  result = await call('POST', `${root}/scene`, { id: 'scene-missing-reference', payload: { title: '不存在的地点', references: [{ kind: 'place', id: 'place-missing' }] } });
  assert.equal(result.status, 422);
  assert.equal(result.body.code, 'REFERENCE_NOT_FOUND');
});

test('native历史按项目读取，恢复历史产生新revision且拒绝过期写入', async t => {
  const { call } = await createHarness(t, ['n_materials', 'n_other']);
  const pathFor = projectId => `/api/novels/${projectId}/resources/place/place-history`;
  let result = await call('POST', '/api/novels/n_materials/resources/place', { id: 'place-history', payload: { name: '旧渡口' } });
  assert.equal(result.status, 201);
  result = await call('PATCH', pathFor('n_materials'), { payload: { name: '新渡口' }, revision: 1 });
  assert.equal(result.status, 200);

  result = await call('GET', `${pathFor('n_materials')}/history`);
  assert.deepEqual(result.body.versions.map(version => version.revision), [2, 1]);
  assert.equal(result.body.versions[0].changeReason, '');
  result = await call('POST', `${pathFor('n_materials')}/history/1/restore`, { revision: 2 });
  assert.equal(result.status, 200);
  assert.equal(result.body.resource.revision, 3);
  assert.equal(result.body.resource.payload.name, '旧渡口');
  result = await call('POST', `${pathFor('n_materials')}/history/1/restore`, { revision: 2 });
  assert.equal(result.status, 412);
  result = await call('GET', `${pathFor('n_materials')}/history`);
  assert.deepEqual(result.body.versions.map(version => version.revision), [3, 2, 1]);

  result = await call('POST', '/api/novels/n_other/resources/place', { id: 'place-history', payload: { name: '另一项目的渡口' } });
  assert.equal(result.status, 201);
  result = await call('GET', `${pathFor('n_other')}/history`);
  assert.deepEqual(result.body.versions.map(version => version.revision), [1]);
  assert.equal(result.body.versions[0].payload.name, '另一项目的渡口');
});
