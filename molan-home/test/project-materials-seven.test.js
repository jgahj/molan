'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const projectResources = require('../lib/project-resources');

function createTestDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE IF NOT EXISTS novel_projects (
    workspace_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    PRIMARY KEY (workspace_id, project_id)
  )`);
  db.exec("INSERT INTO novel_projects (workspace_id, project_id) VALUES ('ws-1', 'proj-1'), ('ws-1', 'proj-2'), ('ws-2', 'proj-3')");
  projectResources.initializeSchema(db);
  return db;
}

test('小说全套资料七大板块完整覆盖与分类映射', () => {
  const cats = projectResources.RESOURCE_CATEGORIES;
  assert.ok(cats.basic_positioning.includes('profile'), '板块一：作品基础定位');
  assert.ok(cats.worldbuilding.includes('worldbuilding') && cats.worldbuilding.includes('power-system'), '板块二：世界观设定');
  assert.ok(cats.characters.includes('character') && cats.characters.includes('relation'), '板块三：人物设定');
  assert.ok(cats.plot_outlines.includes('outline') && cats.plot_outlines.includes('scene'), '板块四：剧情大纲');
  assert.ok(cats.special_materials.includes('item') && cats.special_materials.includes('foreshadow'), '板块五：专项细节设定');
  assert.ok(cats.writing_management.includes('timeline') && cats.writing_management.includes('writing-task'), '板块六：写作执行与管理');
  assert.ok(cats.publication.includes('publication'), '板块七：发布与后期');
});

test('七大板块代表资料完整生命周期（创建、CAS更新、版本历史、软删、恢复与租户隔离）', () => {
  const db = createTestDatabase();
  const access = {
    workspace_id: 'ws-1',
    project_id: 'proj-1',
    role: 'owner',
    active: 1
  };
  const actorId = 'user-author-1';

  // 1. 创建板块七：发布与后期资料 (publication)
  const pubPayload = {
    coverCopy: '万界沉浮，唯剑独尊！2026玄幻年度力作',
    tags: ['东方玄幻', '热血', '无敌流', '杀伐果断'],
    category: '玄幻-东方玄幻',
    plannedChapterTitles: ['第一章 青云剑出', '第二章 剑气惊龙', '第三章 试剑天下'],
    readerInteractions: [
      { triggerChapter: 3, question: '大家觉得主角下一章会选择哪门古剑？', targetCommentSection: '第3章末尾' }
    ],
    afterwordPlanning: {
      plannedExtras: ['番外一：老剑圣的往事', '番外二：少女时期的师妹'],
      completionTestimonialOutline: '感谢读者陪伴，这一程风雨同舟...'
    }
  };

  const createdPub = projectResources.createResource(db, access, 'publication', pubPayload, actorId, 'pub-main-001', '初始化发布与后期规划');
  assert.equal(createdPub.ok, true);
  assert.equal(createdPub.resource.id, 'pub-main-001');
  assert.equal(createdPub.resource.revision, 1);
  assert.equal(createdPub.resource.payload.coverCopy, pubPayload.coverCopy);

  // 2. CAS 版本更新
  const updatedPayload = {
    ...pubPayload,
    coverCopy: '万界沉浮，唯剑破苍穹！'
  };
  const updateRes = projectResources.updateResource(db, access, 'publication', 'pub-main-001', updatedPayload, 1, actorId, '优化封面宣传语');
  assert.equal(updateRes.ok, true);
  assert.equal(updateRes.resource.revision, 2);
  assert.equal(updateRes.resource.payload.coverCopy, '万界沉浮，唯剑破苍穹！');

  // 3. 过期版本更新必须被拒绝 (CAS conflict)
  const staleUpdate = projectResources.updateResource(db, access, 'publication', 'pub-main-001', updatedPayload, 1, actorId, '冲突更新');
  assert.equal(staleUpdate.ok, false);
  assert.equal(staleUpdate.code, 'revision_conflict');

  // 4. 软删除与列表隐藏
  const delRes = projectResources.deleteResource(db, access, 'publication', 'pub-main-001', 2, actorId, '下线草案');
  assert.equal(delRes.ok, true);

  const activeList = projectResources.listResources(db, { workspaceId: 'ws-1', projectId: 'proj-1' }, 'publication', false);
  assert.equal(activeList.length, 0, '默认不列出已软删记录');

  const allList = projectResources.listResources(db, { workspaceId: 'ws-1', projectId: 'proj-1' }, 'publication', true);
  assert.equal(allList.length, 1, 'includeDeleted为true时返回软删记录');

  // 5. 恢复记录
  const restoreRes = projectResources.restoreResource(db, access, 'publication', 'pub-main-001', 3, actorId, '重新启用发布规划');
  assert.equal(restoreRes.ok, true);
  assert.equal(restoreRes.resource.status, 'active');
  assert.equal(restoreRes.resource.revision, 4);

  // 6. 跨项目隔离验证
  const otherProjectAccess = {
    workspace_id: 'ws-1',
    project_id: 'proj-2',
    role: 'owner',
    active: 1
  };
  const otherGet = projectResources.getResource(db, otherProjectAccess, 'publication', 'pub-main-001');
  assert.equal(otherGet, null, '同租户其他项目无法读取私有资料');
});

test('资料契约校验常用字段类型、地点类型与未知扩展保留', () => {
  const db = createTestDatabase();
  const access = { workspace_id: 'ws-1', project_id: 'proj-1', role: 'owner', active: 1 };
  const place = projectResources.createResource(db, access, 'place', {
    name: '北境渡口', parentId: 'region-north', terrain: '河谷', customMapData: { grid: [1, 2] }
  }, 'user-author-1', 'place-north', '建立地点');
  assert.equal(place.ok, true);
  assert.deepEqual(place.resource.payload.customMapData, { grid: [1, 2] });

  const invalid = projectResources.createResource(db, access, 'character', {
    name: 17, age: 24
  }, 'user-author-1', 'character-invalid-field', '无效人物');
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, 'resource_field_type_invalid');

  const crossProject = projectResources.createResource(db, access, 'scene', {
    title: '异界入口', references: [{ kind: 'place', id: 'place-north', projectId: 'proj-2' }]
  }, 'user-author-1', 'scene-cross-project', '跨项目引用');
  assert.equal(crossProject.ok, false);
  assert.equal(crossProject.code, 'REFERENCE_CROSS_PROJECT_FORBIDDEN');
  const missingReference = projectResources.createResource(db, access, 'scene', {
    title: '不存在的地点', references: [{ kind: 'place', id: 'place-missing' }]
  }, 'user-author-1', 'scene-missing-reference', '缺失引用');
  assert.equal(missingReference.ok, false);
  assert.equal(missingReference.code, 'REFERENCE_NOT_FOUND');
  db.close();
});

test('资源历史按项目读取，恢复历史内容会产生新revision且拒绝过期写入', () => {
  const db = createTestDatabase();
  const access = { workspace_id: 'ws-1', project_id: 'proj-1', role: 'owner', active: 1 };
  const created = projectResources.createResource(db, access, 'place', { name: '旧渡口' }, 'author', 'place-history', '创建');
  const updated = projectResources.updateResource(db, access, 'place', 'place-history', { name: '新渡口' }, 1, 'author', '改名');
  assert.equal(updated.ok, true);

  const versions = projectResources.listResourceVersions(db, access, 'place', 'place-history');
  assert.deepEqual(versions.map(version => version.revision), [2, 1]);
  assert.equal(versions[0].changeReason, '改名');

  const restored = projectResources.restoreResourceVersion(db, access, 'place', 'place-history', 1, 2, 'author');
  assert.equal(restored.ok, true);
  assert.equal(restored.resource.revision, 3);
  assert.equal(restored.resource.payload.name, '旧渡口');
  assert.equal(projectResources.restoreResourceVersion(db, access, 'place', 'place-history', 1, 2, 'author').code, 'revision_conflict');
  assert.deepEqual(projectResources.listResourceVersions(db, access, 'place', 'place-history').map(version => version.revision), [3, 2, 1]);

  const otherAccess = { workspace_id: 'ws-1', project_id: 'proj-2', role: 'owner', active: 1 };
  assert.equal(projectResources.listResourceVersions(db, otherAccess, 'place', 'place-history'), null);
  assert.equal(created.resource.payload.name, '旧渡口');
  db.close();
});
