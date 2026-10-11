BEGIN;

-- 补齐项目成员与资料联合索引，优化打开小说与关联查询性能
CREATE INDEX IF NOT EXISTS luna_project_members_project_user_active_idx
  ON luna.project_members(project_id, user_id, active);

CREATE INDEX IF NOT EXISTS luna_project_profiles_scope_lookup_idx
  ON luna.project_profiles(workspace_id, project_id, revision DESC);

CREATE INDEX IF NOT EXISTS luna_project_resources_kind_updated_idx
  ON luna.project_resources(workspace_id, project_id, kind, updated_at DESC);

COMMIT;
