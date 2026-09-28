BEGIN;

-- Keep mutable usage and administrator audit rows in the same protected
-- runtime row bridge used by the legacy SQLite-compatible code path.
-- sqlite_* remains immutable evidence; this only seeds the active snapshot.
INSERT INTO luna.runtime_dissection_rows
  (owner_actor_id, owner_user_id, source_table, row_key, dissection_id,
   document, cells, row_sha256, value_sha256, source_run_id, source_row_no)
SELECT COALESCE(l.owner_actor_id, account.id,
                'f39e3fb9-0a43-5bf7-9d0a-dc70a574e66b'::uuid),
       COALESCE(NULLIF(l.owner_user_id, ''), account.legacy_user_id,
                'usr_d2b36e0707fecb544e2e9232f9b8b114'),
       l.table_name, l.row_key, '', l.document, l.cells,
       l.row_sha256, l.value_sha256, l.run_id, l.row_no
FROM luna.sqlite_legacy_rows l
JOIN luna.sqlite_migration_runs run ON run.id = l.run_id
LEFT JOIN luna.runtime_accounts account
  ON account.legacy_user_id = COALESCE(l.document ->> 'user_id', l.document ->> 'actor_user_id')
  OR lower(account.email) = lower(COALESCE(l.document ->> 'user_email', l.document ->> 'admin_email', ''))
WHERE run.status = 'completed' AND run.active
  AND l.table_name IN ('token_usage', 'model_usage', 'admin_audit')
ON CONFLICT (owner_actor_id, source_table, row_key) DO UPDATE SET
  owner_user_id = EXCLUDED.owner_user_id,
  document = EXCLUDED.document,
  cells = EXCLUDED.cells,
  row_sha256 = EXCLUDED.row_sha256,
  value_sha256 = EXCLUDED.value_sha256,
  source_run_id = EXCLUDED.source_run_id,
  source_row_no = EXCLUDED.source_row_no,
  deleted_at = NULL,
  updated_at = now();

COMMIT;
