BEGIN;

ALTER TABLE luna.jobs
  ADD COLUMN IF NOT EXISTS legacy_id text;

CREATE UNIQUE INDEX IF NOT EXISTS luna_jobs_legacy_id_idx
  ON luna.jobs (legacy_id)
  WHERE legacy_id IS NOT NULL AND legacy_id <> '';

COMMIT;
