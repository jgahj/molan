BEGIN;

-- 补齐会话注销/过期清理与用户工作区查询高频二级索引，避免随数据增长退化为全表扫描
CREATE INDEX IF NOT EXISTS luna_auth_sessions_user_id_idx
  ON luna.auth_sessions(user_id);

CREATE INDEX IF NOT EXISTS luna_auth_sessions_active_expires_idx
  ON luna.auth_sessions(expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS luna_workspace_members_user_active_idx
  ON luna.workspace_members(user_id, active);

COMMIT;
