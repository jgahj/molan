BEGIN;

CREATE FUNCTION luna.runtime_admin_transfer_project_owner(target_workspace uuid, target_project uuid, target_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = luna, pg_catalog AS $$
BEGIN
  IF NOT luna.runtime_is_admin() THEN
    RAISE EXCEPTION 'platform administrator required' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM luna.projects
    WHERE workspace_id = target_workspace AND id = target_project AND status = 'active'
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'project is missing' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM luna.runtime_accounts WHERE id = target_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'target account is missing' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO luna.workspace_members(workspace_id, user_id, role, active)
    VALUES (target_workspace, target_user, 'member', true)
  ON CONFLICT (workspace_id, user_id) DO UPDATE SET active = true, updated_at = now();
  UPDATE luna.project_members SET role = 'admin', updated_at = now()
    WHERE workspace_id = target_workspace AND project_id = target_project
      AND active AND role = 'owner' AND user_id <> target_user;
  INSERT INTO luna.project_members(workspace_id, project_id, user_id, role, active)
    VALUES (target_workspace, target_project, target_user, 'owner', true)
  ON CONFLICT (workspace_id, project_id, user_id) DO UPDATE
    SET role = 'owner', active = true, updated_at = now();
  INSERT INTO luna.project_capability_grants(workspace_id, project_id, user_id, capability, granted)
    VALUES (target_workspace, target_project, target_user, 'canSpend', true),
           (target_workspace, target_project, target_user, 'canExport', true)
  ON CONFLICT (workspace_id, project_id, user_id, capability) DO UPDATE
    SET granted = true, updated_at = now();
  UPDATE luna.projects SET acl_revision = acl_revision + 1, updated_at = now()
    WHERE workspace_id = target_workspace AND id = target_project;
END
$$;
ALTER FUNCTION luna.runtime_admin_transfer_project_owner(uuid, uuid, uuid) OWNER TO novel_acl_owner;
REVOKE ALL ON FUNCTION luna.runtime_admin_transfer_project_owner(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION luna.runtime_admin_transfer_project_owner(uuid, uuid, uuid) TO novel_app;

COMMIT;
