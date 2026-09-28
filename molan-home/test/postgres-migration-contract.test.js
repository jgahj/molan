const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const migrationPath = path.join(__dirname, '..', 'db', 'migrations', '0001_luna_v2_core.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');
const migrationDirectory = path.dirname(migrationPath);

test('PostgreSQL目标迁移覆盖租户、项目、六类资料、版本、任务、费用和导出边界', () => {
  for (const table of [
    'users', 'auth_identities', 'auth_sessions', 'workspaces', 'workspace_members',
    'projects', 'project_members', 'project_capability_grants', 'project_profiles',
    'project_resources', 'project_resource_versions', 'entities', 'relations',
    'plot_nodes', 'foreshadows', 'manuscripts', 'manuscript_revisions',
    'creation_books', 'creation_bibles', 'context_snapshots', 'audits', 'commits',
    'jobs', 'job_events', 'budgets', 'budget_reservations', 'billing_ledger',
    'provider_attempts', 'export_manifests', 'export_files', 'outbox', 'api_idempotency'
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS luna\\.${table}\\b`), table);
  }
  assert.match(migration, /PRIMARY KEY \(workspace_id, project_id/);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION luna\.can_project/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /provider_unknown/);
  assert.match(migration, /CHECK \(\(job_id IS NOT NULL\) <> \(commit_id IS NOT NULL\)\)/);
});

test('PostgreSQL目标迁移不包含删除业务表或清空数据的操作', () => {
  assert.doesNotMatch(migration, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i);
});

test('后续版本化迁移只增加稳定ID和受控成员函数', () => {
  const files = fs.readdirSync(migrationDirectory).filter(file => /^\d+_.+\.sql$/i.test(file)).sort();
  assert.ok(files.includes('0002_luna_legacy_identifiers.sql'));
  assert.ok(files.includes('0006_luna_member_projection.sql'));
  assert.ok(files.includes('0010_luna_job_legacy_identifiers.sql'));
  assert.ok(files.includes('0011_luna_billing_idempotency.sql'));
  assert.ok(files.includes('0012_luna_reservation_period.sql'));
  assert.ok(files.includes('0016_luna_legacy_payloads.sql'));
  assert.ok(files.includes('0017_luna_creation_snapshot_legacy_ids.sql'));
  for (const file of files) {
    const source = fs.readFileSync(path.join(migrationDirectory, file), 'utf8');
    assert.match(source, /\bBEGIN\s*;/i, file);
    assert.match(source, /\bCOMMIT\s*;/i, file);
    assert.doesNotMatch(source, /\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i, file);
  }
  const legacyMigration = fs.readFileSync(path.join(migrationDirectory, '0002_luna_legacy_identifiers.sql'), 'utf8');
  assert.match(legacyMigration, /legacy_id/);
  assert.match(legacyMigration, /luna\.project_access/);
  assert.match(legacyMigration, /luna\.restore_project_by_id/);
});

test('资源类型扩展通过新的非破坏性迁移加入PostgreSQL', () => {
  const migrationPath = path.join(migrationDirectory, '0023_luna_resource_kinds.sql');
  const migration = fs.readFileSync(migrationPath, 'utf8');
  for (const kind of ['profile', 'place', 'faction', 'calendar', 'publication', 'manuscript']) {
    assert.match(migration, new RegExp(`'${kind}'`), kind);
  }
  assert.doesNotMatch(migration, /\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
});

test('故事记忆补充迁移覆盖提取幂等、补偿回执和生成复核状态并启用RLS', () => {
  const source = fs.readFileSync(path.join(migrationDirectory, '0025_luna_memory_runtime_support.sql'), 'utf8');
  for (const fragment of [
    'luna.story_memory_extractions', 'luna.story_memory_compensations',
    "'needs_review'", 'ENABLE ROW LEVEL SECURITY', 'FORCE ROW LEVEL SECURITY',
    'luna.can_project(workspace_id, project_id)'
  ]) assert.ok(source.includes(fragment), fragment);
  assert.doesNotMatch(source, /\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
});
