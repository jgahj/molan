BEGIN;

ALTER TABLE luna.audits
  ADD COLUMN IF NOT EXISTS generation_id uuid,
  ADD COLUMN IF NOT EXISTS chapter_no integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'luna_audits_generation_binding_check'
      AND conrelid = 'luna.audits'::regclass
  ) THEN
    ALTER TABLE luna.audits
      ADD CONSTRAINT luna_audits_generation_binding_check
      CHECK ((generation_id IS NULL) = (chapter_no IS NULL));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'luna_audits_generation_run_fk'
      AND conrelid = 'luna.audits'::regclass
  ) THEN
    ALTER TABLE luna.audits
      ADD CONSTRAINT luna_audits_generation_run_fk
      FOREIGN KEY (workspace_id, project_id, generation_id)
      REFERENCES luna.generation_runs(workspace_id, project_id, id);
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS luna_audits_generation_uidx
  ON luna.audits (workspace_id, project_id, generation_id)
  WHERE generation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS luna_audits_chapter_idx
  ON luna.audits (workspace_id, project_id, chapter_no, created_at DESC);

COMMIT;
