import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourcePlan = JSON.parse(fs.readFileSync(path.join(sourceDirectory, 'implementation-plan.json'), 'utf8'));
const sourceReport = path.resolve(sourceDirectory, sourcePlan.sourceRequirements);

/** 复制纯文档夹具，只在本轮创建的系统临时目录内修改及清理。 */
function createFixture(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-plan-contract-'));
  context.after(() => {
    const resolved = path.resolve(directory);
    const temporaryRoot = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(resolved.startsWith(temporaryRoot));
    assert.ok(path.basename(resolved).startsWith('molan-plan-contract-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  for (const name of ['README.md', 'DATABASE_AND_API.md', 'ACCEPTANCE_PLAYBOOK.md', 'validate-plan.mjs']) {
    fs.copyFileSync(path.join(sourceDirectory, name), path.join(directory, name));
  }
  fs.copyFileSync(sourceReport, path.join(directory, 'source-report.md'));
  const plan = structuredClone(sourcePlan);
  plan.sourceRequirements = 'source-report.md';
  const save = () => fs.writeFileSync(path.join(directory, 'implementation-plan.json'), JSON.stringify(plan), 'utf8');
  save();
  return { directory, plan, save };
}

/** 执行的是文档校验器，不加载应用、模型或数据库。 */
function runFixture(fixture) {
  const result = spawnSync(process.execPath, [path.join(fixture.directory, 'validate-plan.mjs')], {
    encoding: 'utf8',
    timeout: 10000
  });
  assert.equal(result.error, undefined);
  return result;
}

test('完整实施包仅证明文档结构，不声称数据库或软件通过', context => {
  const result = runFixture(createFixture(context));
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.requirementGroups, 49);
  assert.equal(report.fixedSystemCases, 50);
  assert.equal(report.workPackages, 15);
  assert.equal(report.projectApiOperations, 24);
  assert.equal(report.controlPlaneApiOperations, 15);
  assert.equal(report.implementationVerified, false);
  assert.equal(report.runtimeVerified, false);
  assert.equal(report.databaseMigrationExecuted, false);
});

const invalidPlans = [
  ['需求缺项', plan => { plan.requirements.pop(); }],
  ['工作包ID重复', plan => { plan.workPackages[1].id = plan.workPackages[0].id; }],
  ['工作包依赖成环', plan => { plan.workPackages[0].dependsOn = ['T14']; }],
  ['引用不存在用例', plan => { plan.workPackages[0].testSelectors = ['SEC-99']; }],
  ['伪称运行已验证', plan => { plan.runtimeVerified = true; }],
  ['工作区管理员隐式读取私有项目', plan => { plan.databaseDecision.workspaceAdminImplicitProjectAccess = true; }],
  ['过期If-Match错误码漂移', plan => { plan.policyContract.errors.staleIfMatch = 409; }],
  ['真实供应商案例延期被当作通过', plan => { plan.acceptanceStages.deferredDoesNotMeanPassed = false; }],
  ['reviewer获得正式提交权限', plan => { plan.policyContract.reviewerCanExecuteFormalCommit = true; }],
  ['逻辑字段清单为空', plan => { plan.requirements[0].fieldPaths = []; }]
];

for (const [name, mutate] of invalidPlans) {
  test(`拒绝${name}`, context => {
    const fixture = createFixture(context);
    mutate(fixture.plan);
    fixture.save();
    assert.notEqual(runFixture(fixture).status, 0);
  });
}

test('拒绝验收案例标题缺失', context => {
  const fixture = createFixture(context);
  const filename = path.join(fixture.directory, 'ACCEPTANCE_PLAYBOOK.md');
  const text = fs.readFileSync(filename, 'utf8').replace(/^### SEC-01\b/m, '### REMOVED-01');
  fs.writeFileSync(filename, text, 'utf8');
  assert.notEqual(runFixture(fixture).status, 0);
});

test('拒绝用例缺少实际证据要求', context => {
  const fixture = createFixture(context);
  const filename = path.join(fixture.directory, 'ACCEPTANCE_PLAYBOOK.md');
  const text = fs.readFileSync(filename, 'utf8');
  const start = text.indexOf('### SEC-01 ');
  const end = text.indexOf('### SEC-02 ', start);
  assert.ok(start >= 0 && end > start);
  const changed = text.slice(start, end).replace('**证据**', '**遗漏**');
  fs.writeFileSync(filename, text.slice(0, start) + changed + text.slice(end), 'utf8');
  assert.notEqual(runFixture(fixture).status, 0);
});

test('拒绝缺少数据库契约文件', context => {
  const fixture = createFixture(context);
  fs.unlinkSync(path.join(fixture.directory, 'DATABASE_AND_API.md'));
  assert.notEqual(runFixture(fixture).status, 0);
});

test('拒绝损坏的JSON', context => {
  const fixture = createFixture(context);
  fs.writeFileSync(path.join(fixture.directory, 'implementation-plan.json'), '{broken', 'utf8');
  assert.notEqual(runFixture(fixture).status, 0);
});
