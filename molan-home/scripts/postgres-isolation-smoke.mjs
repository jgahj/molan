import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const { createPostgresRepository, readConfig, internalUuid } = require('../lib/postgres-repository');

const settings = readConfig(process.env);
if (!settings.enabled) throw new Error('PostgreSQL must be explicitly configured');
if (settings.runtimeRole !== 'novel_app') throw new Error('RLS smoke requires novel_app role');
const repository = createPostgresRepository(process.env);
const pool = new Pool(settings.config);
const suffix = crypto.randomUUID();
const owner = `rls-owner-${suffix}`;
const stranger = `rls-stranger-${suffix}`;
const workspaceId = `rls-workspace-${suffix}`;
const projectId = `rls-project-${suffix}`;
let client;
try {
  await repository.saveProfile({ userId: owner, workspaceId, projectId, title: 'RLS smoke', state: { title: 'RLS smoke' } });
  client = await pool.connect();
  await client.query('SET ROLE novel_app');
  const role = await client.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
  assert.equal(role.rows[0].rolsuper, false);
  assert.equal(role.rows[0].rolbypassrls, false);
  const ids = [internalUuid(workspaceId), internalUuid(projectId)];
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.user_id', $1, true)", [internalUuid(stranger)]);
  const hidden = await client.query('SELECT * FROM luna.project_profiles WHERE workspace_id=$1 AND project_id=$2', ids);
  assert.equal(hidden.rowCount, 0);
  const denied = await client.query("UPDATE luna.project_profiles SET payload='{}'::jsonb WHERE workspace_id=$1 AND project_id=$2 RETURNING *", ids);
  assert.equal(denied.rowCount, 0);
  await client.query('COMMIT');
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.user_id', $1, true)", [internalUuid(owner)]);
  const visible = await client.query('SELECT payload FROM luna.project_profiles WHERE workspace_id=$1 AND project_id=$2', ids);
  assert.equal(visible.rowCount, 1);
  await client.query("UPDATE luna.project_profiles SET payload=jsonb_set(payload,'{rollbackMarker}','true'::jsonb) WHERE workspace_id=$1 AND project_id=$2", ids);
  await client.query('ROLLBACK');
  const after = await repository.getProfile(owner, projectId, workspaceId);
  assert.equal(after.state.rollbackMarker, undefined);
  // LOCAL actor state must not leak to the next transaction on a reused connection.
  const reset = await client.query("SELECT nullif(current_setting('app.user_id', true), '') AS actor");
  assert.equal(reset.rows[0].actor, null);
  process.stdout.write(JSON.stringify({ ok: true, checks: ['non-superuser-role', 'rls-read-isolation', 'rls-write-isolation', 'transaction-rollback', 'actor-guc-reset'] }) + '\n');
} finally {
  if (client) client.release();
  await pool.end();
  await repository.close();
}
