'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonAppRepository } = require('../lib/repositories/json-app-repository');
const projectResources = require('../lib/project-resources');
const schema = require('../lib/project-material-schema');

const expectedIds = [
  'A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07',
  'B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07',
  'C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08', 'C09', 'C10', 'C11',
  'D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09', 'D10', 'D11', 'D12', 'D13',
  'E01', 'E02', 'E03', 'E04', 'E05', 'E06', 'F01', 'F02', 'F03', 'F04', 'F05'
];

async function fixture(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-material-schema-'));
  const repository = new JsonAppRepository(directory);
  context.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const user = await repository.saveAccount({ userId: 'schema-author', email: 'schema@test.local' });
  await repository.create({ id: 'n_schema', user, state: { volumes: [] } });
  return { repository, scope: { userId: user.userId, projectId: 'n_schema' } };
}

function sample(field) {
  if (field.type === 'reference') return '';
  if (field.type === 'references') return [];
  if (field.type === 'json') return {};
  if (field.type === 'array') return [];
  if (field.type === 'number') return 1;
  if (field.type === 'boolean') return true;
  return `样例-${field.path}`;
}

test('运行时字段契约覆盖规划中的全部49项且与资料类型一致', () => {
  const plan = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'luna-novel-platform-v2', 'implementation-plan.json'), 'utf8'));
  assert.equal(schema.requirements.length, 49);
  assert.deepEqual(schema.requirements.map(item => item.id), expectedIds);
  assert.deepEqual(schema.requirements.map(item => ({ id: item.id, fieldPaths: item.fieldPaths })),
    plan.requirements.map(item => ({ id: item.id, fieldPaths: item.fieldPaths })));
  for (const requirement of schema.requirements) {
    assert.ok(projectResources.RESOURCE_TYPES.has(requirement.kind), `${requirement.id} 资料类型已注册`);
    assert.ok(requirement.fields.length > 0, `${requirement.id} 至少有一个可编辑字段`);
    assert.deepEqual(requirement.fieldPaths, requirement.fields.map(field => field.path));
    const payload = {
      requirementIds: [requirement.id],
      requirementData: Object.fromEntries(requirement.fields.map(field => [field.path, sample(field)]))
    };
    assert.equal(schema.validatePayload(requirement.kind, payload), payload, `${requirement.id} 字段类型通过`);
    assert.deepEqual(JSON.parse(JSON.stringify(payload)), payload, `${requirement.id} JSON 导出/重载保真`);
  }
  for (const category of schema.categories) {
    assert.ok(schema.requirementsForCategory(category.id).length > 0, `${category.id} 有资料入口`);
  }
});

test('49项资料逐项创建、CAS更新、重新读取和历史版本往返', async context => {
  const { repository, scope } = await fixture(context);
    for (const requirement of schema.requirements) {
      const resourceId = `data01-${requirement.id.toLowerCase()}`;
      const requirementData = Object.fromEntries(requirement.fields.map(field => [field.path, sample(field)]));
      requirementData['extensions.preserved'] = { source: requirement.id };
      const payload = { requirementIds: [requirement.id], requirementData };
      const created = await repository.saveResource({ ...scope, kind: requirement.kind, payload, id: resourceId, expectedRevision: 0, reason: 'DATA-01 fixture' });
      assert.equal(created.ok, true, `${requirement.id} creates`);
      assert.equal(created.resource.revision, 1);

      const updatedPayload = {
        ...created.resource.payload,
        requirementData: { ...created.resource.payload.requirementData, 'extensions.updated': true }
      };
      const updated = await repository.saveResource({ ...scope, kind: requirement.kind, id: resourceId, payload: updatedPayload, expectedRevision: 1, reason: 'DATA-01 CAS update' });
      assert.equal(updated.ok, true, `${requirement.id} updates`);
      assert.equal(updated.resource.revision, 2);

      const reopened = (await repository.listResources({ ...scope, kind: requirement.kind })).find(resource => resource.id === resourceId);
      assert.equal(reopened.revision, 2, `${requirement.id} reopens at latest revision`);
      assert.deepEqual(reopened.payload.requirementData['extensions.preserved'], { source: requirement.id });
      assert.equal(reopened.payload.requirementData['extensions.updated'], true);
      assert.deepEqual(
        (await repository.listResourceVersions({ ...scope, id: resourceId })).map(version => version.revision),
        [2, 1],
        `${requirement.id} retains immutable history`
      );
    }
});

test('资料中心将49项运行时schema加载到真实表单入口', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'pages', 'project-docs.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '..', 'pages', 'project-docs.js'), 'utf8');
  assert.match(page, /id="requirementSelect"/);
  assert.match(page, /\.\.\/lib\/project-material-schema\.js/);
  assert.match(script, /requirementsForCategory/);
  assert.match(script, /requirementData/);
});

test('需求类型错误被拒绝而未知扩展字段保持不变', () => {
  assert.throws(
    () => schema.validatePayload('character', { requirementIds: ['A01'], requirementData: {} }),
    error => error.code === 'requirement_kind_mismatch'
  );
  assert.throws(
    () => schema.validatePayload('profile', { requirementIds: ['A01'], requirementData: { 'profile.targetWordRange': 22 } }),
    error => error.code === 'requirement_field_type_invalid'
  );
  const payload = { requirementIds: ['A01'], requirementData: { 'profile.title': '书名', 'extensions.custom': { x: 1 } } };
  assert.equal(schema.validatePayload('profile', payload), payload);
  assert.deepEqual(payload.requirementData['extensions.custom'], { x: 1 });
});

test('异步仓储可复用同一资料字段规范化与权限作用域校验', () => {
  assert.equal(typeof projectResources.normalizePayload, 'function');
  const payload = { requirementIds: ['C01'], requirementData: { 'person.name': '阿岚' } };
  const access = { project_id: 'project-schema', workspace_id: 'ws-schema' };
  assert.equal(projectResources.normalizePayload(payload, access, 'character'), payload);
  assert.throws(
    () => projectResources.normalizePayload({ ...payload, targetProjectId: 'other-project' }, access, 'character'),
    error => error.code === 'REFERENCE_CROSS_PROJECT_FORBIDDEN'
  );
});
