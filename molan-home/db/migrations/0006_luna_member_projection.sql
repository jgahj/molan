BEGIN;

DROP FUNCTION IF EXISTS luna.list_workspace_members(uuid);

CREATE OR REPLACE FUNCTION luna.list_workspace_members(target_workspace uuid)
RETURNS TABLE(user_id uuid, legacy_id text, role text, active boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
  SELECT wm.user_id, u.legacy_id, wm.role, wm.active
  FROM luna.workspace_members wm
  JOIN luna.users u ON u.id = wm.user_id
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

CREATE OR REPLACE FUNCTION luna.list_project_members(
  target_workspace uuid,
  target_project uuid
)
RETURNS TABLE(
  user_id uuid,
  legacy_id text,
  role text,
  active boolean,
  can_spend boolean,
  can_export boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
  SELECT
    pm.user_id,
    u.legacy_id,
    pm.role,
    pm.active,
    (pm.role IN ('owner', 'admin')
      OR COALESCE(spend_grant.granted, false)),
    (pm.role IN ('owner', 'admin')
      OR COALESCE(export_grant.granted, false))
  FROM luna.project_members pm
  JOIN luna.users u ON u.id = pm.user_id
  LEFT JOIN luna.project_capability_grants spend_grant
    ON spend_grant.workspace_id = pm.workspace_id
   AND spend_grant.project_id = pm.project_id
   AND spend_grant.user_id = pm.user_id
   AND spend_grant.capability = 'canSpend'
  LEFT JOIN luna.project_capability_grants export_grant
    ON export_grant.workspace_id = pm.workspace_id
   AND export_grant.project_id = pm.project_id
   AND export_grant.user_id = pm.user_id
   AND export_grant.capability = 'canExport'
  WHERE pm.workspace_id = target_workspace
    AND pm.project_id = target_project
    AND pm.active
    AND EXISTS (
      SELECT 1
      FROM luna.project_members actor_members
      WHERE actor_members.workspace_id = target_workspace
        AND actor_members.project_id = target_project
        AND actor_members.user_id = luna.actor_id()
        AND actor_members.active
    )
  ORDER BY pm.created_at ASC
$$;

ALTER FUNCTION luna.list_workspace_members(uuid) OWNER TO novel_acl_owner;
ALTER FUNCTION luna.list_project_members(uuid, uuid) OWNER TO novel_acl_owner;

REVOKE ALL ON FUNCTION luna.list_workspace_members(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.list_project_members(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION luna.list_workspace_members(uuid) TO novel_app;
GRANT EXECUTE ON FUNCTION luna.list_project_members(uuid, uuid) TO novel_app;

COMMIT;
