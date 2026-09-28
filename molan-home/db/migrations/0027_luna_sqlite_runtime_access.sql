BEGIN;

-- Runtime authentication needs a narrowly scoped lookup before an actor exists.
-- These SECURITY DEFINER functions are the only bootstrap path; the source rows
-- remain behind RLS for all ordinary project queries.
CREATE OR REPLACE FUNCTION luna.sqlite_legacy_accounts()
RETURNS SETOF luna.sqlite_accounts
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
  SELECT a.*
  FROM luna.sqlite_accounts a
  JOIN luna.sqlite_migration_runs r ON r.id = a.source_run_id
  WHERE r.status = 'completed' AND r.active
  ORDER BY a.source_row_no ASC
$$;

CREATE OR REPLACE FUNCTION luna.sqlite_legacy_account_by_email(target_email text)
RETURNS SETOF luna.sqlite_accounts
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
  SELECT a.*
  FROM luna.sqlite_accounts a
  JOIN luna.sqlite_migration_runs r ON r.id = a.source_run_id
  WHERE r.status = 'completed' AND r.active
    AND lower(a.email) = lower(COALESCE(target_email, ''))
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION luna.sqlite_legacy_account_by_user_id(target_user_id text)
RETURNS SETOF luna.sqlite_accounts
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
  SELECT a.*
  FROM luna.sqlite_accounts a
  JOIN luna.sqlite_migration_runs r ON r.id = a.source_run_id
  WHERE r.status = 'completed' AND r.active
    AND a.user_id = COALESCE(target_user_id, '')
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION luna.sqlite_legacy_accounts_for_admin()
RETURNS SETOF luna.sqlite_accounts
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
  SELECT a.*
  FROM luna.sqlite_accounts a
  JOIN luna.sqlite_migration_runs r ON r.id = a.source_run_id
  WHERE r.status = 'completed' AND r.active
    AND luna.sqlite_legacy_is_admin()
  ORDER BY a.source_row_no ASC
$$;

ALTER FUNCTION luna.sqlite_legacy_accounts() OWNER TO novel_acl_owner;
ALTER FUNCTION luna.sqlite_legacy_account_by_email(text) OWNER TO novel_acl_owner;
ALTER FUNCTION luna.sqlite_legacy_account_by_user_id(text) OWNER TO novel_acl_owner;
ALTER FUNCTION luna.sqlite_legacy_accounts_for_admin() OWNER TO novel_acl_owner;
REVOKE ALL ON FUNCTION luna.sqlite_legacy_accounts() FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.sqlite_legacy_account_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.sqlite_legacy_account_by_user_id(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.sqlite_legacy_accounts_for_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION luna.sqlite_legacy_accounts() TO novel_app;
GRANT EXECUTE ON FUNCTION luna.sqlite_legacy_account_by_email(text) TO novel_app;
GRANT EXECUTE ON FUNCTION luna.sqlite_legacy_account_by_user_id(text) TO novel_app;
GRANT EXECUTE ON FUNCTION luna.sqlite_legacy_accounts_for_admin() TO novel_app;

-- FORCE ROW LEVEL SECURITY also applies to the definer role. The role is
-- NOLOGIN and is used only by the functions above, so this does not create a
-- client-side bypass.
DROP POLICY IF EXISTS luna_sqlite_runs_definer_read ON luna.sqlite_migration_runs;
CREATE POLICY luna_sqlite_runs_definer_read ON luna.sqlite_migration_runs
  FOR SELECT TO novel_acl_owner USING (true);

DROP POLICY IF EXISTS luna_sqlite_accounts_definer_read ON luna.sqlite_accounts;
CREATE POLICY luna_sqlite_accounts_definer_read ON luna.sqlite_accounts
  FOR SELECT TO novel_acl_owner USING (true);

DROP POLICY IF EXISTS luna_sqlite_accounts_insert ON luna.sqlite_accounts;
CREATE POLICY luna_sqlite_accounts_insert ON luna.sqlite_accounts
  FOR INSERT TO novel_app
  WITH CHECK (actor_id = luna.actor_id() OR luna.sqlite_legacy_is_admin());

GRANT INSERT ON luna.sqlite_accounts TO novel_app;

COMMIT;
