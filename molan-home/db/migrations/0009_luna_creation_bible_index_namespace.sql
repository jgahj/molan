BEGIN;

DROP INDEX IF EXISTS luna.luna_creation_bibles_legacy_id_idx;

CREATE INDEX IF NOT EXISTS luna_creation_bibles_legacy_id_idx
  ON luna.creation_bibles (workspace_id, project_id, book_id, legacy_id);

COMMIT;
