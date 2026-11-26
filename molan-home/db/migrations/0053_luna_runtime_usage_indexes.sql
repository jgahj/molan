BEGIN;

-- 补齐管理后台全量用量台账与按拆书任务聚合查询的高频部分索引，避免随 runtime_dissection_rows 增长退化为全表扫描
CREATE INDEX IF NOT EXISTS luna_runtime_dissection_rows_token_usage_active_idx
  ON luna.runtime_dissection_rows (updated_at DESC)
  WHERE source_table = 'token_usage' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS luna_runtime_dissection_rows_owner_dissection_idx
  ON luna.runtime_dissection_rows (owner_actor_id, dissection_id)
  WHERE deleted_at IS NULL;

COMMIT;
