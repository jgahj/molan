BEGIN;

CREATE POLICY luna_platform_admin_projects ON luna.projects
  FOR ALL TO novel_app USING (luna.runtime_is_admin()) WITH CHECK (luna.runtime_is_admin());
CREATE POLICY luna_platform_admin_profiles ON luna.project_profiles
  FOR ALL TO novel_app USING (luna.runtime_is_admin()) WITH CHECK (luna.runtime_is_admin());
CREATE POLICY luna_platform_admin_resources ON luna.project_resources
  FOR ALL TO novel_app USING (luna.runtime_is_admin()) WITH CHECK (luna.runtime_is_admin());
CREATE POLICY luna_platform_admin_resource_versions ON luna.project_resource_versions
  FOR ALL TO novel_app USING (luna.runtime_is_admin()) WITH CHECK (luna.runtime_is_admin());
CREATE POLICY luna_platform_admin_workspaces_read ON luna.workspaces
  FOR SELECT TO novel_app USING (luna.runtime_is_admin());
CREATE POLICY luna_platform_admin_project_members_read ON luna.project_members
  FOR SELECT TO novel_app USING (luna.runtime_is_admin());

CREATE FUNCTION luna.runtime_maintenance_actor()
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = luna, pg_catalog AS $$
  SELECT legacy_user_id FROM luna.runtime_accounts WHERE role = 'admin' ORDER BY legacy_user_id LIMIT 1
$$;
ALTER FUNCTION luna.runtime_maintenance_actor() OWNER TO novel_acl_owner;
REVOKE ALL ON FUNCTION luna.runtime_maintenance_actor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION luna.runtime_maintenance_actor() TO novel_app;

COMMIT;
