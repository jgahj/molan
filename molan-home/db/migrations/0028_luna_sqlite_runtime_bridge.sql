BEGIN;

-- The sqlite_* tables are immutable migration evidence. Runtime writes use
-- these PostgreSQL-owned projections so a new account, skill, or dissection
-- never changes the source hashes recorded for the SQLite snapshot.
CREATE TABLE IF NOT EXISTS luna.runtime_accounts (
  id uuid PRIMARY KEY REFERENCES luna.users(id) ON DELETE RESTRICT,
  legacy_user_id text NOT NULL UNIQUE,
  email text NOT NULL,
  name text NOT NULL DEFAULT '',
  avatar text NOT NULL DEFAULT '',
  bio text NOT NULL DEFAULT '',
  default_model text NOT NULL DEFAULT '',
  salt text NOT NULL DEFAULT '',
  pwd text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'normal',
  level text NOT NULL DEFAULT 'normal',
  plan text NOT NULL DEFAULT 'normal',
  credits numeric NOT NULL DEFAULT 0,
  spent numeric NOT NULL DEFAULT 0,
  created_at_text text NOT NULL DEFAULT '',
  source_run_id uuid REFERENCES luna.sqlite_migration_runs(id) ON DELETE RESTRICT,
  source_row_no bigint,
  source_row_sha256 text NOT NULL DEFAULT '',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  cells jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS luna_runtime_accounts_email_idx
  ON luna.runtime_accounts (lower(email));
CREATE INDEX IF NOT EXISTS luna_runtime_accounts_role_idx
  ON luna.runtime_accounts (role);

CREATE TABLE IF NOT EXISTS luna.runtime_user_skills (
  owner_user_id uuid NOT NULL REFERENCES luna.users(id) ON DELETE RESTRICT,
  owner_user_legacy_id text NOT NULL DEFAULT '',
  owner_email text NOT NULL,
  id text NOT NULL,
  name text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  instruction text NOT NULL DEFAULT '',
  files_json text NOT NULL DEFAULT '[]',
  size bigint NOT NULL DEFAULT 0,
  updated_at_value bigint NOT NULL DEFAULT 0,
  source_run_id uuid REFERENCES luna.sqlite_migration_runs(id) ON DELETE RESTRICT,
  source_row_no bigint,
  source_row_sha256 text NOT NULL DEFAULT '',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  cells jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, id)
);

CREATE INDEX IF NOT EXISTS luna_runtime_user_skills_owner_idx
  ON luna.runtime_user_skills (owner_user_id, updated_at_value DESC, id ASC);

CREATE TABLE IF NOT EXISTS luna.runtime_global_skills (
  id text PRIMARY KEY,
  name text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  instruction text NOT NULL DEFAULT '',
  targets_json text NOT NULL DEFAULT '["all"]',
  enabled boolean NOT NULL DEFAULT true,
  created_at_value bigint NOT NULL DEFAULT 0,
  updated_at_value bigint NOT NULL DEFAULT 0,
  source_run_id uuid REFERENCES luna.sqlite_migration_runs(id) ON DELETE RESTRICT,
  source_row_no bigint,
  source_row_sha256 text NOT NULL DEFAULT '',
  files_json text NOT NULL DEFAULT '{}',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  cells jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS luna_runtime_global_skills_enabled_idx
  ON luna.runtime_global_skills (enabled, updated_at_value DESC, id ASC);

CREATE TABLE IF NOT EXISTS luna.runtime_open_skills (
  owner_user_id uuid NOT NULL REFERENCES luna.users(id) ON DELETE RESTRICT,
  owner_user_legacy_id text NOT NULL DEFAULT '',
  owner_email text NOT NULL,
  id text PRIMARY KEY,
  name text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  instruction text NOT NULL DEFAULT '',
  files_json text NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'published',
  downloads bigint NOT NULL DEFAULT 0,
  created_at_value bigint NOT NULL DEFAULT 0,
  updated_at_value bigint NOT NULL DEFAULT 0,
  source_run_id uuid REFERENCES luna.sqlite_migration_runs(id) ON DELETE RESTRICT,
  source_row_no bigint,
  source_row_sha256 text NOT NULL DEFAULT '',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  cells jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS luna_runtime_open_skills_public_idx
  ON luna.runtime_open_skills (status, updated_at_value DESC, id ASC);
CREATE INDEX IF NOT EXISTS luna_runtime_open_skills_owner_idx
  ON luna.runtime_open_skills (owner_user_id, updated_at_value DESC, id ASC);

CREATE TABLE IF NOT EXISTS luna.runtime_dissections (
  id text PRIMARY KEY,
  owner_actor_id uuid NOT NULL REFERENCES luna.users(id) ON DELETE RESTRICT,
  owner_user_id text NOT NULL DEFAULT '',
  user_email text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  source_type text NOT NULL DEFAULT '',
  source_name text NOT NULL DEFAULT '',
  source_text text NOT NULL DEFAULT '',
  depth text NOT NULL DEFAULT 'standard',
  purpose text NOT NULL DEFAULT 'new-writer',
  selected_model text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'queued',
  phase text NOT NULL DEFAULT 'queued',
  phase_index integer NOT NULL DEFAULT 0,
  progress integer NOT NULL DEFAULT 0,
  estimated_credits numeric NOT NULL DEFAULT 0,
  actual_credits numeric NOT NULL DEFAULT 0,
  result_json text NOT NULL DEFAULT '{}',
  meta_json text NOT NULL DEFAULT '{}',
  error text NOT NULL DEFAULT '',
  cancel_requested boolean NOT NULL DEFAULT false,
  created_at_value bigint NOT NULL DEFAULT 0,
  updated_at_value bigint NOT NULL DEFAULT 0,
  revision bigint NOT NULL DEFAULT 0,
  source_run_id uuid REFERENCES luna.sqlite_migration_runs(id) ON DELETE RESTRICT,
  source_row_no bigint,
  source_row_sha256 text NOT NULL DEFAULT '',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  cells jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS luna_runtime_dissections_owner_idx
  ON luna.runtime_dissections (owner_actor_id, updated_at_value DESC, id ASC);
CREATE INDEX IF NOT EXISTS luna_runtime_dissections_status_idx
  ON luna.runtime_dissections (owner_actor_id, status, updated_at_value DESC, id ASC);

CREATE TABLE IF NOT EXISTS luna.runtime_dissection_rows (
  owner_actor_id uuid NOT NULL REFERENCES luna.users(id) ON DELETE RESTRICT,
  owner_user_id text NOT NULL DEFAULT '',
  source_table text NOT NULL,
  row_key text NOT NULL,
  dissection_id text NOT NULL DEFAULT '',
  document jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(document) = 'object'),
  cells jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(cells) = 'array'),
  row_sha256 text NOT NULL DEFAULT '',
  value_sha256 text NOT NULL DEFAULT '',
  source_run_id uuid REFERENCES luna.sqlite_migration_runs(id) ON DELETE RESTRICT,
  source_row_no bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (owner_actor_id, source_table, row_key)
);

CREATE INDEX IF NOT EXISTS luna_runtime_dissection_rows_lookup_idx
  ON luna.runtime_dissection_rows (owner_actor_id, source_table, dissection_id, updated_at DESC);

-- Rows without a reliable owner still need a real actor for the runtime RLS
-- projection. Keep this fixed system subject separate from ordinary accounts so
-- the original SQLite cells and ownership evidence remain unchanged.
INSERT INTO luna.users (id, legacy_id)
VALUES ('f39e3fb9-0a43-5bf7-9d0a-dc70a574e66b'::uuid, 'usr_d2b36e0707fecb544e2e9232f9b8b114')
ON CONFLICT (id) DO UPDATE SET legacy_id = COALESCE(luna.users.legacy_id, EXCLUDED.legacy_id);

UPDATE luna.sqlite_dissection_live_rows l
SET owner_actor_id = d.owner_actor_id,
    owner_user_id = d.owner_user_id
FROM luna.sqlite_dissections d
WHERE l.owner_actor_id IS NULL
  AND d.source_run_id = l.source_run_id
  AND COALESCE(l.document ->> 'dissection_id', l.document ->> 'dissectionId', '') = d.id;

UPDATE luna.sqlite_dissection_live_rows
SET owner_actor_id = 'f39e3fb9-0a43-5bf7-9d0a-dc70a574e66b'::uuid,
    owner_user_id = 'usr_d2b36e0707fecb544e2e9232f9b8b114'
WHERE owner_actor_id IS NULL;

-- Copy the active snapshot once. The original rows remain available for
-- reconciliation and retain their exact SQLite cells and hashes.
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

INSERT INTO luna.runtime_dissections
  (id, owner_actor_id, owner_user_id, user_email, title, source_type,
   source_name, source_text, depth, purpose, selected_model, status, phase,
   phase_index, progress, estimated_credits, actual_credits, result_json,
   meta_json, error, cancel_requested, created_at_value, updated_at_value,
   revision, source_run_id, source_row_no, source_row_sha256, document, cells)
SELECT d.id, d.owner_actor_id, d.owner_user_id, d.user_email, d.title,
       d.source_type, d.source_name, d.source_text, d.depth, d.purpose,
       d.selected_model, d.status, d.phase, d.phase_index, d.progress,
       d.estimated_credits, d.actual_credits, d.result_json, d.meta_json,
       d.error, d.cancel_requested, COALESCE(d.created_at_value, 0),
       COALESCE(d.updated_at_value, 0), d.revision, d.source_run_id,
       d.source_row_no, d.source_row_sha256, d.document, d.cells
FROM luna.sqlite_dissections d
JOIN luna.sqlite_migration_runs r ON r.id = d.source_run_id
WHERE r.status = 'completed' AND r.active
ON CONFLICT (id) DO UPDATE SET
  owner_actor_id = EXCLUDED.owner_actor_id, owner_user_id = EXCLUDED.owner_user_id,
  user_email = EXCLUDED.user_email, title = EXCLUDED.title, source_type = EXCLUDED.source_type,
  source_name = EXCLUDED.source_name, source_text = EXCLUDED.source_text, depth = EXCLUDED.depth,
  purpose = EXCLUDED.purpose, selected_model = EXCLUDED.selected_model, status = EXCLUDED.status,
  phase = EXCLUDED.phase, phase_index = EXCLUDED.phase_index, progress = EXCLUDED.progress,
  estimated_credits = EXCLUDED.estimated_credits, actual_credits = EXCLUDED.actual_credits,
  result_json = EXCLUDED.result_json, meta_json = EXCLUDED.meta_json, error = EXCLUDED.error,
  cancel_requested = EXCLUDED.cancel_requested, created_at_value = EXCLUDED.created_at_value,
  updated_at_value = EXCLUDED.updated_at_value, revision = EXCLUDED.revision,
  source_run_id = EXCLUDED.source_run_id, source_row_no = EXCLUDED.source_row_no,
  source_row_sha256 = EXCLUDED.source_row_sha256, document = EXCLUDED.document,
  cells = EXCLUDED.cells, updated_at = now();

INSERT INTO luna.runtime_dissection_rows
  (owner_actor_id, owner_user_id, source_table, row_key, dissection_id,
   document, cells, row_sha256, value_sha256, source_run_id, source_row_no)
SELECT COALESCE(l.owner_actor_id, 'f39e3fb9-0a43-5bf7-9d0a-dc70a574e66b'::uuid),
       COALESCE(NULLIF(l.owner_user_id, ''), 'usr_d2b36e0707fecb544e2e9232f9b8b114'),
       l.source_table, l.row_key,
       COALESCE(l.document ->> 'dissection_id', l.document ->> 'dissectionId', ''), l.document, l.cells,
       l.row_sha256, l.value_sha256, l.source_run_id, l.source_row_no
FROM luna.sqlite_dissection_live_rows l
JOIN luna.sqlite_migration_runs r ON r.id = l.source_run_id
WHERE r.status = 'completed' AND r.active
ON CONFLICT (owner_actor_id, source_table, row_key) DO UPDATE SET
  owner_user_id = EXCLUDED.owner_user_id, dissection_id = EXCLUDED.dissection_id,
  document = EXCLUDED.document, cells = EXCLUDED.cells, row_sha256 = EXCLUDED.row_sha256,
  value_sha256 = EXCLUDED.value_sha256, source_run_id = EXCLUDED.source_run_id,
  source_row_no = EXCLUDED.source_row_no, deleted_at = NULL, updated_at = now();

CREATE OR REPLACE FUNCTION luna.runtime_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM luna.runtime_accounts a
    WHERE a.id = luna.actor_id() AND a.role = 'admin'
  )
$$;

CREATE OR REPLACE FUNCTION luna.runtime_accounts_all()
RETURNS SETOF luna.runtime_accounts
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
  SELECT a.* FROM luna.runtime_accounts a ORDER BY a.email ASC
$$;

CREATE OR REPLACE FUNCTION luna.runtime_account_by_email(target_email text)
RETURNS SETOF luna.runtime_accounts
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
  SELECT a.* FROM luna.runtime_accounts a
  WHERE lower(a.email) = lower(COALESCE(target_email, ''))
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION luna.runtime_account_by_user_id(target_user_id text)
RETURNS SETOF luna.runtime_accounts
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
  SELECT a.* FROM luna.runtime_accounts a
  WHERE a.legacy_user_id = COALESCE(target_user_id, '')
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION luna.runtime_register_account(
  target_user uuid,
  target_legacy_id text,
  target_email text,
  target_name text,
  target_avatar text,
  target_bio text,
  target_default_model text,
  target_salt text,
  target_pwd text,
  target_role text,
  target_credits numeric,
  target_spent numeric,
  target_created_at_text text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
BEGIN
  IF target_user IS NULL OR target_legacy_id IS NULL OR length(btrim(target_legacy_id)) = 0
     OR target_email IS NULL OR length(btrim(target_email)) = 0
     OR target_salt IS NULL OR target_pwd IS NULL THEN
    RAISE EXCEPTION 'account input is invalid' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM luna.runtime_accounts WHERE lower(email) = lower(btrim(target_email))) THEN
    RAISE EXCEPTION 'account email already exists' USING ERRCODE = '23505';
  END IF;
  INSERT INTO luna.users(id, legacy_id)
    VALUES (target_user, btrim(target_legacy_id))
    ON CONFLICT (id) DO UPDATE
      SET legacy_id = COALESCE(luna.users.legacy_id, excluded.legacy_id);
  INSERT INTO luna.auth_identities(issuer, subject, user_id)
    VALUES ('molan', lower(btrim(target_email)), target_user)
    ON CONFLICT (issuer, subject) DO UPDATE SET user_id = excluded.user_id;
  INSERT INTO luna.runtime_accounts
    (id, legacy_user_id, email, name, avatar, bio, default_model, salt, pwd,
     role, level, plan, credits, spent, created_at_text, created_at, updated_at)
  VALUES
    (target_user, btrim(target_legacy_id), lower(btrim(target_email)),
     coalesce(target_name, ''), coalesce(target_avatar, ''), coalesce(target_bio, ''),
     coalesce(target_default_model, ''), target_salt, target_pwd,
     coalesce(nullif(target_role, ''), 'normal'), coalesce(nullif(target_role, ''), 'normal'),
     coalesce(nullif(target_role, ''), 'normal'), greatest(coalesce(target_credits, 0), 0),
     greatest(coalesce(target_spent, 0), 0), coalesce(target_created_at_text, ''), now(), now());
END
$$;

-- Runtime bootstrap and reconciliation reads use SECURITY DEFINER functions so
-- the application never needs to bypass RLS on the projection tables. These
-- functions are intentionally separate from the write paths below.
CREATE OR REPLACE FUNCTION luna.runtime_user_skills_all()
RETURNS SETOF luna.runtime_user_skills
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
  SELECT s.* FROM luna.runtime_user_skills s
  ORDER BY s.owner_email ASC, s.updated_at_value DESC, s.id ASC
$$;

CREATE OR REPLACE FUNCTION luna.runtime_global_skills_all()
RETURNS SETOF luna.runtime_global_skills
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
  SELECT s.* FROM luna.runtime_global_skills s
  ORDER BY s.updated_at_value DESC, s.id ASC
$$;

CREATE OR REPLACE FUNCTION luna.runtime_open_skills_all()
RETURNS SETOF luna.runtime_open_skills
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
  SELECT s.* FROM luna.runtime_open_skills s
  ORDER BY s.updated_at_value DESC, s.id ASC
$$;

CREATE OR REPLACE FUNCTION luna.runtime_dissections_all()
RETURNS SETOF luna.runtime_dissections
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
  SELECT d.* FROM luna.runtime_dissections d
  ORDER BY d.updated_at_value DESC, d.id ASC
$$;

CREATE OR REPLACE FUNCTION luna.runtime_dissection_rows_all()
RETURNS SETOF luna.runtime_dissection_rows
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
  SELECT r.* FROM luna.runtime_dissection_rows r
  WHERE r.deleted_at IS NULL
  ORDER BY r.owner_actor_id, r.source_table, r.row_key
$$;

ALTER FUNCTION luna.runtime_user_skills_all() OWNER TO novel_acl_owner;
ALTER FUNCTION luna.runtime_global_skills_all() OWNER TO novel_acl_owner;
ALTER FUNCTION luna.runtime_open_skills_all() OWNER TO novel_acl_owner;
ALTER FUNCTION luna.runtime_dissections_all() OWNER TO novel_acl_owner;
ALTER FUNCTION luna.runtime_dissection_rows_all() OWNER TO novel_acl_owner;

REVOKE ALL ON FUNCTION luna.runtime_user_skills_all() FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.runtime_global_skills_all() FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.runtime_open_skills_all() FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.runtime_dissections_all() FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.runtime_dissection_rows_all() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION luna.runtime_user_skills_all() TO novel_app;
GRANT EXECUTE ON FUNCTION luna.runtime_global_skills_all() TO novel_app;
GRANT EXECUTE ON FUNCTION luna.runtime_open_skills_all() TO novel_app;
GRANT EXECUTE ON FUNCTION luna.runtime_dissections_all() TO novel_app;
GRANT EXECUTE ON FUNCTION luna.runtime_dissection_rows_all() TO novel_app;

ALTER FUNCTION luna.runtime_is_admin() OWNER TO novel_acl_owner;
ALTER FUNCTION luna.runtime_accounts_all() OWNER TO novel_acl_owner;
ALTER FUNCTION luna.runtime_account_by_email(text) OWNER TO novel_acl_owner;
ALTER FUNCTION luna.runtime_account_by_user_id(text) OWNER TO novel_acl_owner;
ALTER FUNCTION luna.runtime_register_account(uuid, text, text, text, text, text, text, text, text, text, numeric, numeric, text) OWNER TO novel_acl_owner;

REVOKE ALL ON FUNCTION luna.runtime_is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.runtime_accounts_all() FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.runtime_account_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.runtime_account_by_user_id(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.runtime_register_account(uuid, text, text, text, text, text, text, text, text, text, numeric, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION luna.runtime_is_admin() TO novel_app;
GRANT EXECUTE ON FUNCTION luna.runtime_accounts_all() TO novel_app;
GRANT EXECUTE ON FUNCTION luna.runtime_account_by_email(text) TO novel_app;
GRANT EXECUTE ON FUNCTION luna.runtime_account_by_user_id(text) TO novel_app;
GRANT EXECUTE ON FUNCTION luna.runtime_register_account(uuid, text, text, text, text, text, text, text, text, text, numeric, numeric, text) TO novel_app;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'runtime_accounts', 'runtime_user_skills', 'runtime_global_skills',
    'runtime_open_skills', 'runtime_dissections', 'runtime_dissection_rows'
  ] LOOP
    EXECUTE format('ALTER TABLE luna.%I OWNER TO novel_acl_owner', table_name);
    EXECUTE format('ALTER TABLE luna.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE luna.%I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END
$$;

DROP POLICY IF EXISTS luna_runtime_accounts_definer_read ON luna.runtime_accounts;
CREATE POLICY luna_runtime_accounts_definer_read ON luna.runtime_accounts
  FOR SELECT TO novel_acl_owner USING (true);
DROP POLICY IF EXISTS luna_runtime_accounts_access ON luna.runtime_accounts;
CREATE POLICY luna_runtime_accounts_access ON luna.runtime_accounts
  FOR SELECT TO novel_app
  USING (id = luna.actor_id() OR luna.runtime_is_admin());
DROP POLICY IF EXISTS luna_runtime_accounts_write ON luna.runtime_accounts;
CREATE POLICY luna_runtime_accounts_write ON luna.runtime_accounts
  FOR UPDATE TO novel_app
  USING (id = luna.actor_id() OR luna.runtime_is_admin())
  WITH CHECK (id = luna.actor_id() OR luna.runtime_is_admin());

DROP POLICY IF EXISTS luna_runtime_user_skills_access ON luna.runtime_user_skills;
CREATE POLICY luna_runtime_user_skills_access ON luna.runtime_user_skills
  FOR ALL TO novel_app
  USING (owner_user_id = luna.actor_id() OR luna.runtime_is_admin())
  WITH CHECK (owner_user_id = luna.actor_id() OR luna.runtime_is_admin());

DROP POLICY IF EXISTS luna_runtime_global_skills_access ON luna.runtime_global_skills;
CREATE POLICY luna_runtime_global_skills_access ON luna.runtime_global_skills
  FOR SELECT TO novel_app
  USING (enabled OR luna.runtime_is_admin());
DROP POLICY IF EXISTS luna_runtime_global_skills_write ON luna.runtime_global_skills;
CREATE POLICY luna_runtime_global_skills_write ON luna.runtime_global_skills
  FOR ALL TO novel_app
  USING (luna.runtime_is_admin())
  WITH CHECK (luna.runtime_is_admin());

DROP POLICY IF EXISTS luna_runtime_open_skills_access ON luna.runtime_open_skills;
CREATE POLICY luna_runtime_open_skills_access ON luna.runtime_open_skills
  FOR SELECT TO novel_app
  USING (status = 'published' OR owner_user_id = luna.actor_id() OR luna.runtime_is_admin());
DROP POLICY IF EXISTS luna_runtime_open_skills_write ON luna.runtime_open_skills;
CREATE POLICY luna_runtime_open_skills_write ON luna.runtime_open_skills
  FOR ALL TO novel_app
  USING (owner_user_id = luna.actor_id() OR luna.runtime_is_admin())
  WITH CHECK (owner_user_id = luna.actor_id() OR luna.runtime_is_admin());

DROP POLICY IF EXISTS luna_runtime_dissections_access ON luna.runtime_dissections;
CREATE POLICY luna_runtime_dissections_access ON luna.runtime_dissections
  FOR ALL TO novel_app
  USING (owner_actor_id = luna.actor_id() OR luna.runtime_is_admin())
  WITH CHECK (owner_actor_id = luna.actor_id() OR luna.runtime_is_admin());

DROP POLICY IF EXISTS luna_runtime_dissection_rows_access ON luna.runtime_dissection_rows;
CREATE POLICY luna_runtime_dissection_rows_access ON luna.runtime_dissection_rows
  FOR ALL TO novel_app
  USING (owner_actor_id = luna.actor_id() OR luna.runtime_is_admin())
  WITH CHECK (owner_actor_id = luna.actor_id() OR luna.runtime_is_admin());

GRANT SELECT, UPDATE ON luna.runtime_accounts TO novel_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  luna.runtime_user_skills,
  luna.runtime_global_skills,
  luna.runtime_open_skills,
  luna.runtime_dissections,
  luna.runtime_dissection_rows
TO novel_app;

COMMIT;
