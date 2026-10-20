'use strict';

/**
 * @file postgres-job-ownership-guard.test.js
 * P0-3 / P2-1 防再发回归（2026-10-19 深度审查）：
 *  - getJob / getJobBudget 曾无属主过滤（IDOR：任意登录用户可读/取消他人任务），
 *    与 scripts/postgres-job-smoke.mjs「未授权用户必须拿到 null」的自家契约矛盾；
 *  - 取消路径曾「先 getJob 快照再无条件 upsertJob」，可把 worker 刚写入的终态覆盖回旧值。
 * 行为级验证需真实 PG（部署后执行 `npm run db:pg:job-smoke`，其中 :32-33 的隔离断言即本回归）；
 * 本文件以源码锚点防回潮，并固化取消路径的 expectedStates 守卫契约。
 */

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'postgres-repository.js'), 'utf8');
const cancelServiceSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'creation-core-job-http-service.js'), 'utf8');

function sourceOf(source, fnName) {
  const start = source.indexOf(`async function ${fnName}(`);
  assert.ok(start > 0, `postgres-repository 应包含 ${fnName}`);
  return source.slice(start, start + 2200);
}

test('P0-3 防再发：getJob 必须带 project_members 属主过滤', () => {
  const src = sourceOf(repoSource, 'getJob');
  assert.match(src, /JOIN luna\.project_members pm/, 'getJob 查询缺少 project_members 归属 JOIN');
  assert.match(src, /pm\.user_id = \$2::uuid AND pm\.active/, 'getJob 未按当前 actor 过滤成员资格');
});

test('P0-3 防再发：getJobBudget 必须带 project_members 属主过滤', () => {
  const src = sourceOf(repoSource, 'getJobBudget');
  assert.match(src, /JOIN luna\.project_members pm/, 'getJobBudget 查询缺少 project_members 归属 JOIN');
  assert.match(src, /pm\.user_id = \$2::uuid AND pm\.active/, 'getJobBudget 未按当前 actor 过滤成员资格');
});

test('P2-1 防再发：upsertJob 支持 expectedStates 乐观状态机守卫', () => {
  const start = repoSource.indexOf('async function upsertJob(');
  assert.ok(start > 0, 'postgres-repository 应包含 upsertJob');
  const src = repoSource.slice(start, start + 3000);
  assert.match(src, /expectedStates/, 'upsertJob 缺少 expectedStates 守卫');
  assert.match(src, /staleStateGuard: true/, '陈旧快照拒绝路径应标记 staleStateGuard');
});

test('P2-1 防再发：取消端点必须携带 expectedStates（不得无条件覆盖任务状态）', () => {
  const cancelStart = cancelServiceSource.indexOf('async function handleCreationCoreJobCancel(');
  assert.ok(cancelStart > 0, 'creation-core-job-http-service 应包含取消 handler');
  const src = cancelServiceSource.slice(cancelStart, cancelStart + 1600);
  assert.match(src, /expectedStates:\s*\['queued',\s*'claimed',\s*'running'\]/,
    '取消 upsertJob 必须限定 queued/claimed/running，防止覆盖 worker 已写入的终态');
});
