BEGIN;

CREATE TABLE IF NOT EXISTS luna.sqlite_migration_runs (
  id uuid PRIMARY KEY,
  source_path text NOT NULL,
  source_bytes bigint NOT NULL CHECK (source_bytes >= 0),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_integrity text NOT NULL,
  source_manifest_sha256 text,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  active boolean NOT NULL DEFAULT false,
  table_count bigint NOT NULL DEFAULT 0,
  row_count bigint NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text NOT NULL DEFAULT '',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS luna_sqlite_one_active_run
  ON luna.sqlite_migration_runs (active)
  WHERE active;

CREATE TABLE IF NOT EXISTS luna.sqlite_table_catalog (
  run_id uuid NOT NULL REFERENCES luna.sqlite_migration_runs(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  object_type text NOT NULL CHECK (object_type IN ('table', 'view', 'index', 'trigger')),
  table_name text NOT NULL,
  create_sql text,
  columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  indexes jsonb NOT NULL DEFAULT '[]'::jsonb,
  triggers jsonb NOT NULL DEFAULT '[]'::jsonb,
  row_count bigint NOT NULL DEFAULT 0,
  row_sha256 text NOT NULL DEFAULT '' CHECK (row_sha256 = '' OR row_sha256 ~ '^[0-9a-f]{64}$'),
  value_sha256 text NOT NULL DEFAULT '' CHECK (value_sha256 = '' OR value_sha256 ~ '^[0-9a-f]{64}$'),
  column_hashes jsonb NOT NULL DEFAULT '{}'::jsonb,
  type_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  migrated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, table_name),
  UNIQUE (run_id, ordinal)
);

CREATE TABLE IF NOT EXISTS luna.sqlite_legacy_rows (
  run_id uuid NOT NULL REFERENCES luna.sqlite_migration_runs(id) ON DELETE RESTRICT,
  table_name text NOT NULL,
  row_no bigint NOT NULL CHECK (row_no > 0),
  row_key text NOT NULL DEFAULT '',
  row_sha256 text NOT NULL CHECK (row_sha256 ~ '^[0-9a-f]{64}$'),
  value_sha256 text NOT NULL CHECK (value_sha256 ~ '^[0-9a-f]{64}$'),
  cells jsonb NOT NULL CHECK (jsonb_typeof(cells) = 'array'),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  owner_actor_id uuid,
  owner_user_id text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, table_name, row_no)
);

CREATE INDEX IF NOT EXISTS luna_sqlite_legacy_rows_table_idx
  ON luna.sqlite_legacy_rows (run_id, table_name, row_no);
CREATE INDEX IF NOT EXISTS luna_sqlite_legacy_rows_owner_idx
  ON luna.sqlite_legacy_rows (run_id, owner_actor_id, table_name, row_no);
CREATE INDEX IF NOT EXISTS luna_sqlite_legacy_rows_dissection_idx
  ON luna.sqlite_legacy_rows (run_id, table_name, ((document ->> 'dissection_id')));

CREATE TABLE IF NOT EXISTS luna.sqlite_accounts (
  source_run_id uuid NOT NULL REFERENCES luna.sqlite_migration_runs(id) ON DELETE RESTRICT,
  source_row_no bigint NOT NULL,
  actor_id uuid NOT NULL REFERENCES luna.users(id),
  user_id text NOT NULL,
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
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  cells jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_row_sha256 text NOT NULL CHECK (source_row_sha256 ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_run_id, source_row_no),
  UNIQUE (source_run_id, email)
);

CREATE INDEX IF NOT EXISTS luna_sqlite_accounts_email_idx
  ON luna.sqlite_accounts (source_run_id, lower(email));
CREATE INDEX IF NOT EXISTS luna_sqlite_accounts_actor_idx
  ON luna.sqlite_accounts (source_run_id, actor_id);

CREATE TABLE IF NOT EXISTS luna.sqlite_dissections (
  source_run_id uuid NOT NULL REFERENCES luna.sqlite_migration_runs(id) ON DELETE RESTRICT,
  source_row_no bigint,
  owner_actor_id uuid NOT NULL REFERENCES luna.users(id),
  owner_user_id text NOT NULL DEFAULT '',
  user_email text NOT NULL DEFAULT '',
  id text NOT NULL,
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
  created_at_value bigint,
  updated_at_value bigint,
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  cells jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_row_sha256 text NOT NULL CHECK (source_row_sha256 ~ '^[0-9a-f]{64}$'),
  revision bigint NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  PRIMARY KEY (source_run_id, id)
);

CREATE INDEX IF NOT EXISTS luna_sqlite_dissections_owner_idx
  ON luna.sqlite_dissections (source_run_id, owner_actor_id, updated_at_value DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS luna_sqlite_dissections_status_idx
  ON luna.sqlite_dissections (source_run_id, owner_actor_id, status, updated_at_value DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS luna.sqlite_user_skills (
  source_run_id uuid NOT NULL REFERENCES luna.sqlite_migration_runs(id) ON DELETE RESTRICT,
  source_row_no bigint,
  owner_actor_id uuid NOT NULL REFERENCES luna.users(id),
  owner_user_id text NOT NULL DEFAULT '',
  user_email text NOT NULL,
  id text NOT NULL,
  name text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  instruction text NOT NULL DEFAULT '',
  files_json text NOT NULL DEFAULT '[]',
  size bigint NOT NULL DEFAULT 0,
  updated_at_value bigint,
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  cells jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_row_sha256 text NOT NULL CHECK (source_row_sha256 ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (source_run_id, user_email, id)
);

CREATE INDEX IF NOT EXISTS luna_sqlite_user_skills_owner_idx
  ON luna.sqlite_user_skills (source_run_id, owner_actor_id, updated_at_value DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS luna.sqlite_global_skills (
  source_run_id uuid NOT NULL REFERENCES luna.sqlite_migration_runs(id) ON DELETE RESTRICT,
  source_row_no bigint,
  id text NOT NULL,
  name text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  instruction text NOT NULL DEFAULT '',
  targets_json text NOT NULL DEFAULT '["all"]',
  enabled boolean NOT NULL DEFAULT true,
  created_at_value bigint,
  updated_at_value bigint,
  files_json text NOT NULL DEFAULT '{}',
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  cells jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_row_sha256 text NOT NULL CHECK (source_row_sha256 ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (source_run_id, id)
);

CREATE INDEX IF NOT EXISTS luna_sqlite_global_skills_enabled_idx
  ON luna.sqlite_global_skills (source_run_id, enabled, updated_at_value DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS luna.sqlite_open_skills (
  source_run_id uuid NOT NULL REFERENCES luna.sqlite_migration_runs(id) ON DELETE RESTRICT,
  source_row_no bigint,
  owner_actor_id uuid NOT NULL REFERENCES luna.users(id),
  owner_user_id text NOT NULL DEFAULT '',
  owner_email text NOT NULL,
  id text NOT NULL,
  name text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  instruction text NOT NULL DEFAULT '',
  files_json text NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'published',
  downloads bigint NOT NULL DEFAULT 0,
  created_at_value bigint,
  updated_at_value bigint,
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  cells jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_row_sha256 text NOT NULL CHECK (source_row_sha256 ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (source_run_id, id)
);

CREATE INDEX IF NOT EXISTS luna_sqlite_open_skills_public_idx
  ON luna.sqlite_open_skills (source_run_id, status, updated_at_value DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS luna_sqlite_open_skills_owner_idx
  ON luna.sqlite_open_skills (source_run_id, owner_actor_id, updated_at_value DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS luna.sqlite_dissection_live_rows (
  source_run_id uuid NOT NULL REFERENCES luna.sqlite_migration_runs(id) ON DELETE RESTRICT,
  source_table text NOT NULL,
  row_key text NOT NULL,
  owner_actor_id uuid,
  owner_user_id text NOT NULL DEFAULT '',
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  cells jsonb NOT NULL CHECK (jsonb_typeof(cells) = 'array'),
  row_sha256 text NOT NULL CHECK (row_sha256 ~ '^[0-9a-f]{64}$'),
  value_sha256 text NOT NULL CHECK (value_sha256 ~ '^[0-9a-f]{64}$'),
  source_row_no bigint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (source_run_id, source_table, row_key)
);

CREATE INDEX IF NOT EXISTS luna_sqlite_dissection_live_lookup_idx
  ON luna.sqlite_dissection_live_rows (source_run_id, source_table, owner_actor_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS luna_sqlite_dissection_live_dissection_idx
  ON luna.sqlite_dissection_live_rows (source_run_id, source_table, ((document ->> 'dissection_id')));

CREATE OR REPLACE FUNCTION luna.sqlite_legacy_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM luna.sqlite_accounts a
    JOIN luna.sqlite_migration_runs r ON r.id = a.source_run_id
    WHERE r.active AND r.status = 'completed'
      AND a.actor_id = luna.actor_id()
      AND a.role = 'admin'
  )
$$;

CREATE OR REPLACE FUNCTION luna.sqlite_legacy_visible(target_actor uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
  SELECT target_actor IS NOT NULL
    AND (target_actor = luna.actor_id() OR luna.sqlite_legacy_is_admin())
$$;

ALTER FUNCTION luna.sqlite_legacy_is_admin() OWNER TO novel_acl_owner;
ALTER FUNCTION luna.sqlite_legacy_visible(uuid) OWNER TO novel_acl_owner;
REVOKE ALL ON FUNCTION luna.sqlite_legacy_is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.sqlite_legacy_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION luna.sqlite_legacy_is_admin() TO novel_app;
GRANT EXECUTE ON FUNCTION luna.sqlite_legacy_visible(uuid) TO novel_app;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'sqlite_migration_runs', 'sqlite_table_catalog', 'sqlite_legacy_rows',
    'sqlite_accounts', 'sqlite_dissections', 'sqlite_user_skills',
    'sqlite_global_skills', 'sqlite_open_skills', 'sqlite_dissection_live_rows'
  ] LOOP
    EXECUTE format('ALTER TABLE luna.%I OWNER TO novel_acl_owner', table_name);
    EXECUTE format('ALTER TABLE luna.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE luna.%I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END
$$;

DROP POLICY IF EXISTS luna_sqlite_runs_read ON luna.sqlite_migration_runs;
CREATE POLICY luna_sqlite_runs_read ON luna.sqlite_migration_runs
  FOR SELECT TO novel_app
  USING (status = 'completed' AND active);

DROP POLICY IF EXISTS luna_sqlite_catalog_read ON luna.sqlite_table_catalog;
CREATE POLICY luna_sqlite_catalog_read ON luna.sqlite_table_catalog
  FOR SELECT TO novel_app
  USING (EXISTS (
    SELECT 1 FROM luna.sqlite_migration_runs r
    WHERE r.id = run_id AND r.status = 'completed' AND r.active
  ));

DROP POLICY IF EXISTS luna_sqlite_rows_read ON luna.sqlite_legacy_rows;
CREATE POLICY luna_sqlite_rows_read ON luna.sqlite_legacy_rows
  FOR SELECT TO novel_app
  USING (
    EXISTS (SELECT 1 FROM luna.sqlite_migration_runs r WHERE r.id = run_id AND r.status = 'completed' AND r.active)
    AND (luna.sqlite_legacy_visible(owner_actor_id) OR luna.sqlite_legacy_is_admin())
  );

DROP POLICY IF EXISTS luna_sqlite_accounts_read ON luna.sqlite_accounts;
CREATE POLICY luna_sqlite_accounts_read ON luna.sqlite_accounts
  FOR SELECT TO novel_app
  USING (luna.sqlite_legacy_visible(actor_id));
DROP POLICY IF EXISTS luna_sqlite_accounts_write ON luna.sqlite_accounts;
CREATE POLICY luna_sqlite_accounts_write ON luna.sqlite_accounts
  FOR UPDATE TO novel_app
  USING (luna.sqlite_legacy_visible(actor_id))
  WITH CHECK (luna.sqlite_legacy_visible(actor_id));

DROP POLICY IF EXISTS luna_sqlite_dissections_access ON luna.sqlite_dissections;
CREATE POLICY luna_sqlite_dissections_access ON luna.sqlite_dissections
  FOR ALL TO novel_app
  USING (
    EXISTS (SELECT 1 FROM luna.sqlite_migration_runs r WHERE r.id = source_run_id AND r.status = 'completed' AND r.active)
    AND luna.sqlite_legacy_visible(owner_actor_id)
  )
  WITH CHECK (luna.sqlite_legacy_visible(owner_actor_id));

DROP POLICY IF EXISTS luna_sqlite_user_skills_access ON luna.sqlite_user_skills;
CREATE POLICY luna_sqlite_user_skills_access ON luna.sqlite_user_skills
  FOR ALL TO novel_app
  USING (
    EXISTS (SELECT 1 FROM luna.sqlite_migration_runs r WHERE r.id = source_run_id AND r.status = 'completed' AND r.active)
    AND luna.sqlite_legacy_visible(owner_actor_id)
  )
  WITH CHECK (luna.sqlite_legacy_visible(owner_actor_id));

DROP POLICY IF EXISTS luna_sqlite_global_skills_read ON luna.sqlite_global_skills;
CREATE POLICY luna_sqlite_global_skills_read ON luna.sqlite_global_skills
  FOR SELECT TO novel_app
  USING (
    EXISTS (SELECT 1 FROM luna.sqlite_migration_runs r WHERE r.id = source_run_id AND r.status = 'completed' AND r.active)
    AND (enabled OR luna.sqlite_legacy_is_admin())
  );
DROP POLICY IF EXISTS luna_sqlite_global_skills_write ON luna.sqlite_global_skills;
CREATE POLICY luna_sqlite_global_skills_write ON luna.sqlite_global_skills
  FOR ALL TO novel_app
  USING (luna.sqlite_legacy_is_admin())
  WITH CHECK (luna.sqlite_legacy_is_admin());

DROP POLICY IF EXISTS luna_sqlite_open_skills_read ON luna.sqlite_open_skills;
CREATE POLICY luna_sqlite_open_skills_read ON luna.sqlite_open_skills
  FOR SELECT TO novel_app
  USING (
    EXISTS (SELECT 1 FROM luna.sqlite_migration_runs r WHERE r.id = source_run_id AND r.status = 'completed' AND r.active)
    AND (status = 'published' OR luna.sqlite_legacy_visible(owner_actor_id))
  );
DROP POLICY IF EXISTS luna_sqlite_open_skills_write ON luna.sqlite_open_skills;
CREATE POLICY luna_sqlite_open_skills_write ON luna.sqlite_open_skills
  FOR ALL TO novel_app
  USING (luna.sqlite_legacy_visible(owner_actor_id))
  WITH CHECK (luna.sqlite_legacy_visible(owner_actor_id));

DROP POLICY IF EXISTS luna_sqlite_live_rows_access ON luna.sqlite_dissection_live_rows;
CREATE POLICY luna_sqlite_live_rows_access ON luna.sqlite_dissection_live_rows
  FOR ALL TO novel_app
  USING (
    EXISTS (SELECT 1 FROM luna.sqlite_migration_runs r WHERE r.id = source_run_id AND r.status = 'completed' AND r.active)
    AND (luna.sqlite_legacy_visible(owner_actor_id) OR luna.sqlite_legacy_is_admin())
  )
  WITH CHECK (luna.sqlite_legacy_visible(owner_actor_id) OR luna.sqlite_legacy_is_admin());

GRANT USAGE ON SCHEMA luna TO novel_app;
GRANT SELECT ON luna.sqlite_migration_runs, luna.sqlite_table_catalog, luna.sqlite_legacy_rows TO novel_app;
GRANT SELECT, UPDATE ON luna.sqlite_accounts TO novel_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  luna.sqlite_dissections,
  luna.sqlite_user_skills,
  luna.sqlite_global_skills,
  luna.sqlite_open_skills,
  luna.sqlite_dissection_live_rows
TO novel_app;

GRANT SELECT ON
  luna.sqlite_migration_runs,
  luna.sqlite_table_catalog,
  luna.sqlite_legacy_rows,
  luna.sqlite_accounts,
  luna.sqlite_dissections,
  luna.sqlite_user_skills,
  luna.sqlite_global_skills,
  luna.sqlite_open_skills,
  luna.sqlite_dissection_live_rows
TO novel_worker;

COMMIT;
