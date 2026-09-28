import pg from 'pg';
import fs from 'fs';

const password = fs.readFileSync(process.env.LOCALAPPDATA + '/molan-postgresql/postgres-password.txt', 'utf8').trim();

const client = new pg.Client({
  host: '127.0.0.1',
  port: 55432,
  user: 'postgres',
  password,
  database: 'molan_v2_dev_20260915'
});

await client.connect();

console.log('Synchronizing runtime bridge tables from active migration run...');

// 1. runtime_accounts
const resAcc = await client.query(`
INSERT INTO luna.runtime_accounts
  (id, legacy_user_id, email, name, avatar, bio, default_model, salt, pwd,
   role, level, plan, credits, spent, created_at_text, source_run_id,
   source_row_no, source_row_sha256, document, cells)
SELECT a.actor_id, a.user_id, a.email, a.name, a.avatar, a.bio, a.default_model,
       a.salt, a.pwd, a.role, a.level, a.plan, a.credits, a.spent,
       a.created_at_text, a.source_run_id, a.source_row_no,
       a.source_row_sha256, a.document, a.cells
FROM luna.sqlite_accounts a
JOIN luna.sqlite_migration_runs r ON r.id = a.source_run_id
WHERE r.status = 'completed' AND r.active
ON CONFLICT (id) DO UPDATE SET
  legacy_user_id = EXCLUDED.legacy_user_id, email = EXCLUDED.email, name = EXCLUDED.name,
  avatar = EXCLUDED.avatar, bio = EXCLUDED.bio, default_model = EXCLUDED.default_model,
  salt = EXCLUDED.salt, pwd = EXCLUDED.pwd, role = EXCLUDED.role, level = EXCLUDED.level,
  plan = EXCLUDED.plan, credits = EXCLUDED.credits, spent = EXCLUDED.spent,
  created_at_text = EXCLUDED.created_at_text, source_run_id = EXCLUDED.source_run_id,
  source_row_no = EXCLUDED.source_row_no, source_row_sha256 = EXCLUDED.source_row_sha256,
  document = EXCLUDED.document, cells = EXCLUDED.cells, updated_at = now();
`);
console.log('runtime_accounts synchronized, rowCount:', resAcc.rowCount);

// 2. runtime_user_skills
const resUserSkills = await client.query(`
INSERT INTO luna.runtime_user_skills
  (owner_user_id, owner_user_legacy_id, owner_email, id, name, description,
   instruction, files_json, size, updated_at_value, source_run_id,
   source_row_no, source_row_sha256, document, cells)
SELECT s.owner_actor_id, s.owner_user_id, s.user_email, s.id, s.name,
       s.description, s.instruction, s.files_json, s.size,
       COALESCE(s.updated_at_value, 0), s.source_run_id, s.source_row_no,
       s.source_row_sha256, s.document, s.cells
FROM luna.sqlite_user_skills s
JOIN luna.sqlite_migration_runs r ON r.id = s.source_run_id
WHERE r.status = 'completed' AND r.active
ON CONFLICT (owner_user_id, id) DO UPDATE SET
  owner_user_legacy_id = EXCLUDED.owner_user_legacy_id, owner_email = EXCLUDED.owner_email,
  name = EXCLUDED.name, description = EXCLUDED.description, instruction = EXCLUDED.instruction,
  files_json = EXCLUDED.files_json, size = EXCLUDED.size, updated_at_value = EXCLUDED.updated_at_value,
  source_run_id = EXCLUDED.source_run_id, source_row_no = EXCLUDED.source_row_no,
  source_row_sha256 = EXCLUDED.source_row_sha256, document = EXCLUDED.document,
  cells = EXCLUDED.cells, updated_at = now();
`);
console.log('runtime_user_skills synchronized, rowCount:', resUserSkills.rowCount);

// 3. runtime_global_skills
const resGlobalSkills = await client.query(`
INSERT INTO luna.runtime_global_skills
  (id, name, description, instruction, targets_json, enabled,
   created_at_value, updated_at_value, source_run_id, source_row_no,
   source_row_sha256, files_json, document, cells)
SELECT s.id, s.name, s.description, s.instruction, s.targets_json, s.enabled,
       COALESCE(s.created_at_value, 0), COALESCE(s.updated_at_value, 0),
       s.source_run_id, s.source_row_no, s.source_row_sha256, s.files_json,
       s.document, s.cells
FROM luna.sqlite_global_skills s
JOIN luna.sqlite_migration_runs r ON r.id = s.source_run_id
WHERE r.status = 'completed' AND r.active
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, instruction = EXCLUDED.instruction,
  targets_json = EXCLUDED.targets_json, enabled = EXCLUDED.enabled,
  created_at_value = EXCLUDED.created_at_value, updated_at_value = EXCLUDED.updated_at_value,
  source_run_id = EXCLUDED.source_run_id, source_row_no = EXCLUDED.source_row_no,
  source_row_sha256 = EXCLUDED.source_row_sha256, files_json = EXCLUDED.files_json,
  document = EXCLUDED.document, cells = EXCLUDED.cells, updated_at = now();
`);
console.log('runtime_global_skills synchronized, rowCount:', resGlobalSkills.rowCount);

// 4. runtime_open_skills
const resOpenSkills = await client.query(`
INSERT INTO luna.runtime_open_skills
  (owner_user_id, owner_user_legacy_id, owner_email, id, name, description,
   instruction, files_json, status, downloads, created_at_value,
   updated_at_value, source_run_id, source_row_no, source_row_sha256,
   document, cells)
SELECT s.owner_actor_id, s.owner_user_id, s.owner_email, s.id, s.name,
       s.description, s.instruction, s.files_json, s.status, s.downloads,
       COALESCE(s.created_at_value, 0), COALESCE(s.updated_at_value, 0),
       s.source_run_id, s.source_row_no, s.source_row_sha256, s.document,
       s.cells
FROM luna.sqlite_open_skills s
JOIN luna.sqlite_migration_runs r ON r.id = s.source_run_id
WHERE r.status = 'completed' AND r.active
ON CONFLICT (id) DO UPDATE SET
  owner_user_id = EXCLUDED.owner_user_id, owner_user_legacy_id = EXCLUDED.owner_user_legacy_id,
  owner_email = EXCLUDED.owner_email, name = EXCLUDED.name, description = EXCLUDED.description,
  instruction = EXCLUDED.instruction, files_json = EXCLUDED.files_json, status = EXCLUDED.status,
  downloads = EXCLUDED.downloads, created_at_value = EXCLUDED.created_at_value,
  updated_at_value = EXCLUDED.updated_at_value, source_run_id = EXCLUDED.source_run_id,
  source_row_no = EXCLUDED.source_row_no, source_row_sha256 = EXCLUDED.source_row_sha256,
  document = EXCLUDED.document, cells = EXCLUDED.cells, updated_at = now();
`);
console.log('runtime_open_skills synchronized, rowCount:', resOpenSkills.rowCount);

// 5. Send NOTIFY to luna_account_mutations so any listening server refreshes cache immediately
await client.query("NOTIFY luna_account_mutations, 'sync'");
console.log('Sent NOTIFY luna_account_mutations');

await client.end();
