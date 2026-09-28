import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const plan = JSON.parse(fs.readFileSync(path.join(directory, 'implementation-plan.json'), 'utf8'));
const requirementCounts = { A: 7, B: 7, C: 11, D: 13, E: 6, F: 5 };
const expectedRequirementIds = Object.entries(requirementCounts).flatMap(([prefix, count]) =>
  Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1).padStart(2, '0')}`));
const expectedCaseCounts = { SEC: 12, DATA: 10, CON: 8, AI: 8, MIG: 6, OPS: 6 };
const expectedCaseIds = Object.entries(expectedCaseCounts).flatMap(([prefix, count]) =>
  Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(2, '0')}`));
const expectedTaskIds = Array.from({ length: 15 }, (_, index) => `T${String(index).padStart(2, '0')}`);

assert.equal(plan.status, 'PLANNING_ONLY');
assert.equal(plan.implementationVerified, false);
assert.equal(plan.runtimeVerified, false);
assert.equal(plan.caseInitialStatus, 'NOT_RUN');
assert.equal(plan.progressTracking.planIsBaseline, true);
assert.equal(plan.progressTracking.resultsBelongToEvidenceNotThisPlan, true);
assert.deepEqual(plan.caseFamilies, expectedCaseCounts);
assert.equal(plan.databaseDecision.multiUserTarget, 'PostgreSQL 18');
assert.equal(plan.databaseDecision.productionMigrationExecuted, false);
assert.equal(plan.databaseDecision.workspaceAdminImplicitProjectAccess, false);
assert.equal(plan.databaseDecision.platformOperatorImplicitContentAccess, false);
assert.equal(plan.roles.defaultDeny, true);
assert.equal(plan.policyContract.approvalDefault, 'author_owned');
assert.equal(plan.policyContract.twoPersonApprovalOptional, true);
assert.equal(plan.policyContract.reviewerCanExecuteFormalCommit, false);
assert.equal(plan.policyContract.generationRequiresCanSpend, true);
assert.equal(plan.policyContract.exportRequiresCurrentCanExport, true);
assert.equal(plan.policyContract.downloadMediatedByApplication, true);
assert.deepEqual(plan.policyContract.formalCommitRoles, ['owner', 'admin', 'editor']);
assert.deepEqual(plan.policyContract.generationRoles, ['owner', 'admin', 'editor']);
assert.deepEqual(plan.policyContract.exportEligibleRoles, ['owner', 'admin', 'editor']);
assert.deepEqual(plan.policyContract.exportDefaultRoles, ['owner', 'admin']);
assert.equal(plan.policyContract.errors.missingIfMatch, 428);
assert.equal(plan.policyContract.errors.staleIfMatch, 412);
assert.equal(plan.policyContract.errors.insufficientBudget, 409);
assert.ok(plan.policyContract.jobStates.includes('provider_unknown'));
assert.ok(!plan.policyContract.jobStates.includes('unknown'));
assert.equal(plan.acceptanceStages.engineeringWorkPackage, 'T13');
assert.equal(plan.acceptanceStages.realProviderWorkPackage, 'T14');
assert.deepEqual(plan.acceptanceStages.engineeringDeferredCaseIds, ['AI-08']);
assert.deepEqual(plan.acceptanceStages.realProviderCaseIds, ['AI-08']);
assert.equal(plan.acceptanceStages.deferredDoesNotMeanPassed, true);
assert.equal(plan.apiContract.manualChangeSetDoesNotRequireProviderCall, true);
assert.equal(plan.apiContract.projectDataOperationCount, 24);
assert.equal(plan.apiContract.controlPlaneOperationCount, 15);

for (const name of ['README.md', 'DATABASE_AND_API.md', 'ACCEPTANCE_PLAYBOOK.md']) {
  const content = fs.readFileSync(path.join(directory, name), 'utf8');
  assert.ok(content.length > 100, `Empty document: ${name}`);
  assert.ok(!content.includes('\ufffd'), `Invalid UTF-8 text: ${name}`);
  assert.ok(!content.split(/\r?\n/).some(line => /[ \t]+$/.test(line)), `Trailing whitespace: ${name}`);
}

const databaseDocument = fs.readFileSync(path.join(directory, 'DATABASE_AND_API.md'), 'utf8');
const apiRows = [...databaseDocument.matchAll(/^\| (\d+) \| (GET|POST|PATCH|DELETE) `([^`]+)` \|/gm)];
assert.equal(apiRows.length, plan.apiContract.projectDataOperationCount);
assert.equal(new Set(apiRows.map(match => `${match[2]} ${match[3]}`)).size, apiRows.length);
assert.deepEqual(apiRows.map(match => Number(match[1])), Array.from({ length: 24 }, (_, index) => index + 1));
const readme = fs.readFileSync(path.join(directory, 'README.md'), 'utf8');
const controlRows = [...readme.matchAll(/^\| (GET|POST|PATCH|DELETE) `(\/api\/v2\/[^`]+)` \|/gm)];
assert.equal(controlRows.length, plan.apiContract.controlPlaneOperationCount);
assert.equal(new Set(controlRows.map(match => `${match[1]} ${match[2]}`)).size, controlRows.length);

const sourceReport = fs.readFileSync(path.resolve(directory, plan.sourceRequirements), 'utf8');
const sourceIds = [...sourceReport.matchAll(/^\| ([A-F]\d{2}) \|/gm)].map(match => match[1]);
assert.deepEqual(sourceIds.sort(), [...expectedRequirementIds].sort());

const tasks = new Map(plan.workPackages.map(task => [task.id, task]));
assert.equal(tasks.size, plan.workPackages.length, 'Duplicate work package');
assert.deepEqual([...tasks.keys()].sort(), expectedTaskIds);
const visiting = new Set();
const visited = new Set();
const executionOrder = [];

/** 校验工作包依赖，不执行其中任何数据库或业务操作。 */
function visitTask(taskId) {
  assert.ok(tasks.has(taskId), `Unknown dependency: ${taskId}`);
  assert.ok(!visiting.has(taskId), `Dependency cycle: ${taskId}`);
  if (visited.has(taskId)) return;
  visiting.add(taskId);
  const task = tasks.get(taskId);
  assert.equal(task.status, 'PLANNED', `Handoff task must not claim runtime completion: ${taskId}`);
  assert.ok(typeof task.ownerRole === 'string' && task.ownerRole.trim(), `Missing owner: ${taskId}`);
  for (const field of ['fileScopes', 'preconditions', 'deliverables', 'definitionOfDone', 'testSelectors']) {
    assert.ok(Array.isArray(task[field]) && task[field].length, `Missing ${field}: ${taskId}`);
    assert.ok(task[field].every(value => typeof value === 'string' && value.trim()), `Empty ${field}: ${taskId}`);
  }
  for (const selector of task.testSelectors) {
    const family = /^([A-Z]+)-\*$/.exec(selector);
    assert.ok(family ? Object.hasOwn(expectedCaseCounts, family[1]) : expectedCaseIds.includes(selector), `Unknown test selector: ${selector}`);
  }
  assert.ok(Array.isArray(task.dependsOn), `Missing dependencies: ${taskId}`);
  for (const dependency of task.dependsOn) visitTask(dependency);
  visiting.delete(taskId);
  visited.add(taskId);
  executionOrder.push(taskId);
}

for (const taskId of expectedTaskIds) visitTask(taskId);

assert.deepEqual(plan.requirements.map(item => item.id).sort(), [...expectedRequirementIds].sort());
assert.equal(new Set(plan.requirements.map(item => item.id)).size, 49);
for (const requirement of plan.requirements) {
  assert.ok(tasks.has(requirement.workPackage), `Missing requirement task: ${requirement.id}`);
  for (const field of ['label', 'view', 'invariant']) {
    assert.ok(typeof requirement[field] === 'string' && requirement[field].trim(), `Missing ${field}: ${requirement.id}`);
  }
  for (const field of ['objects', 'fieldPaths']) {
    assert.ok(Array.isArray(requirement[field]) && requirement[field].length, `Missing ${field}: ${requirement.id}`);
    assert.ok(requirement[field].every(value => typeof value === 'string' && value.trim()), `Empty ${field}: ${requirement.id}`);
  }
  assert.equal(requirement.acceptanceInstance, `DATA-01/${requirement.id}`);
}

const acceptance = fs.readFileSync(path.join(directory, 'ACCEPTANCE_PLAYBOOK.md'), 'utf8');
const actualCaseIds = [...acceptance.matchAll(/^### ((?:SEC|DATA|CON|AI|MIG|OPS)-\d{2})\b/gm)].map(match => match[1]);
assert.equal(actualCaseIds.length, 50, 'Expected exactly 50 fixed system case headings');
assert.equal(new Set(actualCaseIds).size, 50, 'Duplicate acceptance case heading');
assert.deepEqual(actualCaseIds.sort(), [...expectedCaseIds].sort());
const caseHeaders = [...acceptance.matchAll(/^### ((?:SEC|DATA|CON|AI|MIG|OPS)-\d{2})\b/gm)];
for (const [index, header] of caseHeaders.entries()) {
  const body = acceptance.slice(header.index, caseHeaders[index + 1]?.index ?? acceptance.length);
  for (const field of ['前置', '动作', '预期', '证据']) {
    assert.ok(body.includes(`**${field}**`), `Missing case ${field}: ${header[1]}`);
  }
}

console.log(JSON.stringify({
  result: 'PLAN_STRUCTURE_VALID',
  requirementGroups: 49,
  parameterizedFunctionalInstances: 49,
  fixedSystemCases: 50,
  workPackages: 15,
  projectApiOperations: apiRows.length,
  controlPlaneApiOperations: controlRows.length,
  dependencyOrder: executionOrder,
  implementationVerified: false,
  runtimeVerified: false,
  databaseMigrationExecuted: false,
  warning: 'This command validates only the planning documents and references. It is not application, database, security, performance or literary acceptance.'
}, null, 2));
