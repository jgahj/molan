BEGIN;

GRANT SELECT, INSERT, UPDATE ON
  luna.users,
  luna.workspaces,
  luna.workspace_members,
  luna.projects,
  luna.project_members,
  luna.project_capability_grants
TO novel_acl_owner;

COMMIT;
