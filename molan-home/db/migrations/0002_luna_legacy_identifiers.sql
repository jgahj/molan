BEGIN;

ALTER TABLE luna.users
  ADD COLUMN IF NOT EXISTS legacy_id text;

ALTER TABLE luna.workspaces
  ADD COLUMN IF NOT EXISTS legacy_id text;

ALTER TABLE luna.projects
  ADD COLUMN IF NOT EXISTS legacy_id text;

ALTER TABLE luna.project_resources
  ADD COLUMN IF NOT EXISTS legacy_id text;

CREATE UNIQUE INDEX IF NOT EXISTS luna_users_legacy_id_idx
  ON luna.users (legacy_id)
  WHERE legacy_id IS NOT NULL AND legacy_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS luna_workspaces_legacy_id_idx
  ON luna.workspaces (legacy_id)
  WHERE legacy_id IS NOT NULL AND legacy_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS luna_projects_legacy_id_idx
  ON luna.projects (legacy_id)
  WHERE legacy_id IS NOT NULL AND legacy_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS luna_resources_legacy_id_idx
  ON luna.project_resources (workspace_id, project_id, kind, legacy_id)
  WHERE legacy_id IS NOT NULL AND legacy_id <> '';

CREATE OR REPLACE FUNCTION luna.ensure_actor(target_user uuid, target_legacy_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
DECLARE
  actor uuid := luna.actor_id();
BEGIN
  IF actor IS NULL OR target_user IS NULL OR actor <> target_user THEN
    RAISE EXCEPTION 'actor identity mismatch' USING ERRCODE = '42501';
  END IF;
  INSERT INTO luna.users(id, legacy_id)
    VALUES (target_user, NULLIF(btrim(target_legacy_id), ''))
  ON CONFLICT (id) DO UPDATE
    SET legacy_id = COALESCE(luna.users.legacy_id, excluded.legacy_id);
END
$$;

CREATE OR REPLACE FUNCTION luna.create_workspace_legacy(
  target_workspace uuid,
  workspace_name text,
  target_legacy_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
DECLARE
  actor uuid := luna.actor_id();
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'authenticated actor is required' USING ERRCODE = '28000';
  END IF;
  IF target_workspace IS NULL OR workspace_name IS NULL OR length(btrim(workspace_name)) = 0 THEN
    RAISE EXCEPTION 'workspace data is invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM luna.ensure_actor(actor, NULL);
  INSERT INTO luna.workspaces(id, name, legacy_id)
    VALUES (target_workspace, btrim(workspace_name), NULLIF(btrim(target_legacy_id), ''));
  INSERT INTO luna.workspace_members(workspace_id, user_id, role)
    VALUES (target_workspace, actor, 'owner');
END
$$;

CREATE OR REPLACE FUNCTION luna.create_project_legacy(
  target_workspace uuid,
  target_project uuid,
  project_title text,
  target_legacy_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
DECLARE
  actor uuid := luna.actor_id();
BEGIN
  IF actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM luna.workspace_members
    WHERE workspace_id = target_workspace
      AND user_id = actor
      AND active
      AND role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'workspace management permission is required' USING ERRCODE = '42501';
  END IF;
  INSERT INTO luna.projects(workspace_id, id, title, legacy_id)
    VALUES (target_workspace, target_project, coalesce(btrim(project_title), ''), NULLIF(btrim(target_legacy_id), ''));
  INSERT INTO luna.project_members(workspace_id, project_id, user_id, role)
    VALUES (target_workspace, target_project, actor, 'owner');
END
$$;

CREATE OR REPLACE FUNCTION luna.grant_workspace_member(
  target_workspace uuid,
  target_user uuid,
  target_legacy_id text,
  target_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
DECLARE
  actor uuid := luna.actor_id();
  actor_role text;
BEGIN
  SELECT role INTO actor_role
  FROM luna.workspace_members
  WHERE workspace_id = target_workspace AND user_id = actor AND active
  FOR UPDATE;
  IF actor_role IS NULL OR actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'workspace member management permission is required' USING ERRCODE = '42501';
  END IF;
  IF target_role NOT IN ('admin', 'member')
    OR (target_role = 'admin' AND actor_role <> 'owner') THEN
    RAISE EXCEPTION 'workspace role is not allowed' USING ERRCODE = '42501';
  END IF;
  INSERT INTO luna.users(id, legacy_id)
    VALUES (target_user, NULLIF(btrim(target_legacy_id), ''))
  ON CONFLICT (id) DO UPDATE
    SET legacy_id = COALESCE(luna.users.legacy_id, excluded.legacy_id);
  INSERT INTO luna.workspace_members(workspace_id, user_id, role, active)
    VALUES (target_workspace, target_user, target_role, true)
  ON CONFLICT (workspace_id, user_id) DO UPDATE
    SET role = excluded.role, active = true, updated_at = now();
END
$$;

CREATE OR REPLACE FUNCTION luna.revoke_workspace_member(
  target_workspace uuid,
  target_user uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
DECLARE
  actor uuid := luna.actor_id();
  actor_role text;
  target_role text;
BEGIN
  SELECT role INTO actor_role
  FROM luna.workspace_members
  WHERE workspace_id = target_workspace AND user_id = actor AND active
  FOR UPDATE;
  SELECT role INTO target_role
  FROM luna.workspace_members
  WHERE workspace_id = target_workspace AND user_id = target_user AND active
  FOR UPDATE;
  IF actor_role IS NULL OR actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'workspace member management permission is required' USING ERRCODE = '42501';
  END IF;
  IF target_role IS NULL OR target_role = 'owner'
    OR (actor_role = 'admin' AND target_role = 'admin') THEN
    RAISE EXCEPTION 'workspace member cannot be revoked' USING ERRCODE = '23514';
  END IF;
  UPDATE luna.workspace_members
  SET active = false, updated_at = now()
  WHERE workspace_id = target_workspace AND user_id = target_user;
  UPDATE luna.projects
  SET acl_revision = acl_revision + 1, updated_at = now()
  WHERE workspace_id = target_workspace;
END
$$;

CREATE OR REPLACE FUNCTION luna.grant_project_member(
  target_workspace uuid,
  target_project uuid,
  target_user uuid,
  target_legacy_id text,
  target_role text,
  target_can_spend boolean,
  target_can_export boolean,
  transfer_owner boolean,
  expected_acl_revision bigint
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
DECLARE
  actor uuid := luna.actor_id();
  actor_role text;
  current_owner uuid;
  current_acl bigint;
BEGIN
  SELECT acl_revision INTO current_acl
  FROM luna.projects
  WHERE workspace_id = target_workspace AND id = target_project AND status = 'active'
  FOR UPDATE;
  IF current_acl IS NULL THEN
    RAISE EXCEPTION 'project is missing' USING ERRCODE = 'P0002';
  END IF;
  SELECT role INTO actor_role
  FROM luna.project_members
  WHERE workspace_id = target_workspace AND project_id = target_project
    AND user_id = actor AND active
  FOR UPDATE;
  IF actor_role IS NULL OR actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'project member management permission is required' USING ERRCODE = '42501';
  END IF;
  IF expected_acl_revision IS NOT NULL AND expected_acl_revision <> current_acl THEN
    RAISE EXCEPTION 'project ACL revision conflict' USING ERRCODE = '40001';
  END IF;
  IF target_role NOT IN ('owner', 'admin', 'editor', 'reviewer', 'viewer')
    OR (actor_role = 'admin' AND target_role IN ('owner', 'admin'))
    OR (target_role = 'owner' AND actor_role <> 'owner') THEN
    RAISE EXCEPTION 'project role is not allowed' USING ERRCODE = '42501';
  END IF;
  IF transfer_owner AND target_role <> 'owner' THEN
    RAISE EXCEPTION 'owner transfer requires owner role' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM luna.workspace_members
    WHERE workspace_id = target_workspace AND user_id = target_user AND active
  ) THEN
    RAISE EXCEPTION 'target workspace member is required' USING ERRCODE = '23514';
  END IF;
  INSERT INTO luna.users(id, legacy_id)
    VALUES (target_user, NULLIF(btrim(target_legacy_id), ''))
  ON CONFLICT (id) DO UPDATE
    SET legacy_id = COALESCE(luna.users.legacy_id, excluded.legacy_id);
  SELECT user_id INTO current_owner
  FROM luna.project_members
  WHERE workspace_id = target_workspace AND project_id = target_project
    AND role = 'owner' AND active
  FOR UPDATE;
  IF target_role = 'owner' AND current_owner IS DISTINCT FROM target_user THEN
    IF NOT transfer_owner THEN
      RAISE EXCEPTION 'owner transfer is required' USING ERRCODE = '42501';
    END IF;
    UPDATE luna.project_members
    SET role = 'admin', updated_at = now()
    WHERE workspace_id = target_workspace AND project_id = target_project
      AND user_id = current_owner AND role = 'owner' AND active;
    UPDATE luna.projects
    SET acl_revision = acl_revision + 1, updated_at = now()
    WHERE workspace_id = target_workspace AND id = target_project;
  ELSIF target_role <> 'owner' AND current_owner = target_user THEN
    RAISE EXCEPTION 'project must retain an owner' USING ERRCODE = '23514';
  END IF;
  INSERT INTO luna.project_members(workspace_id, project_id, user_id, role, active)
    VALUES (target_workspace, target_project, target_user, target_role, true)
  ON CONFLICT (workspace_id, project_id, user_id) DO UPDATE
    SET role = excluded.role, active = true, updated_at = now();
  INSERT INTO luna.project_capability_grants(workspace_id, project_id, user_id, capability, granted)
    VALUES
      (target_workspace, target_project, target_user, 'canSpend', target_can_spend),
      (target_workspace, target_project, target_user, 'canExport', target_can_export)
  ON CONFLICT (workspace_id, project_id, user_id, capability) DO UPDATE
    SET granted = excluded.granted, updated_at = now();
  UPDATE luna.projects
  SET acl_revision = acl_revision + 1, updated_at = now()
  WHERE workspace_id = target_workspace AND id = target_project;
  RETURN (SELECT acl_revision FROM luna.projects WHERE workspace_id = target_workspace AND id = target_project);
END
$$;

CREATE OR REPLACE FUNCTION luna.revoke_project_member(
  target_workspace uuid,
  target_project uuid,
  target_user uuid
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
DECLARE
  actor uuid := luna.actor_id();
  actor_role text;
  target_role text;
  next_acl bigint;
BEGIN
  SELECT role INTO actor_role
  FROM luna.project_members
  WHERE workspace_id = target_workspace AND project_id = target_project
    AND user_id = actor AND active
  FOR UPDATE;
  SELECT role INTO target_role
  FROM luna.project_members
  WHERE workspace_id = target_workspace AND project_id = target_project
    AND user_id = target_user AND active
  FOR UPDATE;
  IF actor_role IS NULL OR actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'project member management permission is required' USING ERRCODE = '42501';
  END IF;
  IF target_role IS NULL OR target_role = 'owner' THEN
    RAISE EXCEPTION 'project owner cannot be revoked' USING ERRCODE = '23514';
  END IF;
  IF actor_role = 'admin' AND target_role = 'admin' THEN
    RAISE EXCEPTION 'project admin cannot be revoked by admin' USING ERRCODE = '42501';
  END IF;
  UPDATE luna.project_members
  SET active = false, updated_at = now()
  WHERE workspace_id = target_workspace AND project_id = target_project AND user_id = target_user;
  UPDATE luna.projects
  SET acl_revision = acl_revision + 1, updated_at = now()
  WHERE workspace_id = target_workspace AND id = target_project
  RETURNING acl_revision INTO next_acl;
  RETURN next_acl;
END
$$;

CREATE OR REPLACE FUNCTION luna.list_workspace_members(target_workspace uuid)
RETURNS TABLE(user_id uuid, role text, active boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
  SELECT wm.user_id, wm.role, wm.active
  FROM luna.workspace_members wm
  WHERE wm.workspace_id = target_workspace
    AND EXISTS (
      SELECT 1
      FROM luna.workspace_members actor_members
      WHERE actor_members.workspace_id = target_workspace
        AND actor_members.user_id = luna.actor_id()
        AND actor_members.active
    )
  ORDER BY wm.created_at ASC
$$;

CREATE OR REPLACE FUNCTION luna.project_access(
  target_workspace uuid,
  target_project uuid
)
RETURNS TABLE(
  workspace_uuid uuid,
  project_uuid uuid,
  workspace_legacy_id text,
  project_legacy_id text,
  title text,
  project_status text,
  project_revision bigint,
  acl_revision bigint,
  role text,
  can_spend boolean,
  can_export boolean,
  owner_user_id uuid,
  owner_legacy_id text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
  SELECT
    p.workspace_id,
    p.id,
    w.legacy_id,
    p.legacy_id,
    p.title,
    p.status,
    p.revision,
    p.acl_revision,
    actor_member.role,
    (actor_member.role IN ('owner', 'admin')
      OR COALESCE(spend_grant.granted, false)),
    (actor_member.role IN ('owner', 'admin')
      OR COALESCE(export_grant.granted, false)),
    owner_member.user_id,
    owner_user.legacy_id
  FROM luna.projects p
  JOIN luna.workspaces w ON w.id = p.workspace_id
  JOIN luna.workspace_members actor_workspace
    ON actor_workspace.workspace_id = p.workspace_id
   AND actor_workspace.user_id = luna.actor_id()
   AND actor_workspace.active
  JOIN luna.project_members actor_member
    ON actor_member.workspace_id = p.workspace_id
   AND actor_member.project_id = p.id
   AND actor_member.user_id = luna.actor_id()
   AND actor_member.active
  JOIN luna.project_members owner_member
    ON owner_member.workspace_id = p.workspace_id
   AND owner_member.project_id = p.id
   AND owner_member.role = 'owner'
   AND owner_member.active
  JOIN luna.users owner_user ON owner_user.id = owner_member.user_id
  LEFT JOIN luna.project_capability_grants spend_grant
    ON spend_grant.workspace_id = p.workspace_id
   AND spend_grant.project_id = p.id
   AND spend_grant.user_id = luna.actor_id()
   AND spend_grant.capability = 'canSpend'
  LEFT JOIN luna.project_capability_grants export_grant
    ON export_grant.workspace_id = p.workspace_id
   AND export_grant.project_id = p.id
   AND export_grant.user_id = luna.actor_id()
   AND export_grant.capability = 'canExport'
  WHERE p.workspace_id = target_workspace
    AND p.id = target_project
    AND p.status <> 'deleted'
$$;

CREATE OR REPLACE FUNCTION luna.restore_project(
  target_workspace uuid,
  target_project uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
DECLARE
  actor uuid := luna.actor_id();
  restored boolean := false;
  affected_rows integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM luna.project_members
    WHERE workspace_id = target_workspace
      AND project_id = target_project
      AND user_id = actor
      AND role = 'owner'
      AND active
  ) THEN
    RAISE EXCEPTION 'project owner permission is required' USING ERRCODE = '42501';
  END IF;
  UPDATE luna.projects
  SET status = 'active', updated_at = now(), revision = revision + 1
  WHERE workspace_id = target_workspace
    AND id = target_project
    AND status = 'deleted';
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  restored := affected_rows > 0;
  RETURN restored;
END
$$;

CREATE OR REPLACE FUNCTION luna.restore_project_by_id(target_project uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
DECLARE
  actor uuid := luna.actor_id();
  affected_rows integer := 0;
BEGIN
  UPDATE luna.projects p
  SET status = 'active', updated_at = now(), revision = revision + 1
  WHERE p.id = target_project
    AND p.status = 'deleted'
    AND EXISTS (
      SELECT 1
      FROM luna.project_members pm
      WHERE pm.workspace_id = p.workspace_id
        AND pm.project_id = p.id
        AND pm.user_id = actor
        AND pm.role = 'owner'
        AND pm.active
    );
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows > 0;
END
$$;

ALTER FUNCTION luna.ensure_actor(uuid, text) OWNER TO novel_acl_owner;
ALTER FUNCTION luna.create_workspace_legacy(uuid, text, text) OWNER TO novel_acl_owner;
ALTER FUNCTION luna.create_project_legacy(uuid, uuid, text, text) OWNER TO novel_acl_owner;
ALTER FUNCTION luna.grant_workspace_member(uuid, uuid, text, text) OWNER TO novel_acl_owner;
ALTER FUNCTION luna.revoke_workspace_member(uuid, uuid) OWNER TO novel_acl_owner;
ALTER FUNCTION luna.grant_project_member(uuid, uuid, uuid, text, text, boolean, boolean, boolean, bigint) OWNER TO novel_acl_owner;
ALTER FUNCTION luna.revoke_project_member(uuid, uuid, uuid) OWNER TO novel_acl_owner;
ALTER FUNCTION luna.list_workspace_members(uuid) OWNER TO novel_acl_owner;
ALTER FUNCTION luna.project_access(uuid, uuid) OWNER TO novel_acl_owner;
ALTER FUNCTION luna.restore_project(uuid, uuid) OWNER TO novel_acl_owner;
ALTER FUNCTION luna.restore_project_by_id(uuid) OWNER TO novel_acl_owner;

REVOKE ALL ON FUNCTION luna.ensure_actor(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.create_workspace_legacy(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.create_project_legacy(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.grant_workspace_member(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.revoke_workspace_member(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.grant_project_member(uuid, uuid, uuid, text, text, boolean, boolean, boolean, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.revoke_project_member(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.list_workspace_members(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.project_access(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.restore_project(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.restore_project_by_id(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION luna.ensure_actor(uuid, text) TO novel_app;
GRANT EXECUTE ON FUNCTION luna.create_workspace_legacy(uuid, text, text) TO novel_app;
GRANT EXECUTE ON FUNCTION luna.create_project_legacy(uuid, uuid, text, text) TO novel_app;
GRANT EXECUTE ON FUNCTION luna.grant_workspace_member(uuid, uuid, text, text) TO novel_app;
GRANT EXECUTE ON FUNCTION luna.revoke_workspace_member(uuid, uuid) TO novel_app;
GRANT EXECUTE ON FUNCTION luna.grant_project_member(uuid, uuid, uuid, text, text, boolean, boolean, boolean, bigint) TO novel_app;
GRANT EXECUTE ON FUNCTION luna.revoke_project_member(uuid, uuid, uuid) TO novel_app;
GRANT EXECUTE ON FUNCTION luna.list_workspace_members(uuid) TO novel_app;
GRANT EXECUTE ON FUNCTION luna.project_access(uuid, uuid) TO novel_app;
GRANT EXECUTE ON FUNCTION luna.restore_project(uuid, uuid) TO novel_app;
GRANT EXECUTE ON FUNCTION luna.restore_project_by_id(uuid) TO novel_app;

COMMIT;
