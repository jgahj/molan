BEGIN;

ALTER TABLE luna.context_snapshots
  ADD COLUMN IF NOT EXISTS legacy_id text;

CREATE UNIQUE INDEX IF NOT EXISTS luna_context_snapshots_legacy_id_idx
  ON luna.context_snapshots (workspace_id, project_id, legacy_id)
  WHERE legacy_id IS NOT NULL AND legacy_id <> '';

COMMIT;
