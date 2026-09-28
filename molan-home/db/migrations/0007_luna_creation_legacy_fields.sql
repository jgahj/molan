BEGIN;

ALTER TABLE luna.creation_books
  ADD COLUMN IF NOT EXISTS legacy_id text;

ALTER TABLE luna.creation_books
  ADD COLUMN IF NOT EXISTS source_brief_id text NOT NULL DEFAULT '';

ALTER TABLE luna.creation_books
  ADD COLUMN IF NOT EXISTS current_state_version bigint NOT NULL DEFAULT 0;

ALTER TABLE luna.creation_books
  ADD COLUMN IF NOT EXISTS current_chapter_no integer NOT NULL DEFAULT 0;

ALTER TABLE luna.creation_books
  ADD COLUMN IF NOT EXISTS budget_limit numeric(20, 6) NOT NULL DEFAULT 0;

ALTER TABLE luna.creation_books
  ADD COLUMN IF NOT EXISTS spent_cost numeric(20, 6) NOT NULL DEFAULT 0;

ALTER TABLE luna.creation_bibles
  ADD COLUMN IF NOT EXISTS legacy_id text;

CREATE UNIQUE INDEX IF NOT EXISTS luna_creation_books_legacy_id_idx
  ON luna.creation_books (legacy_id)
  WHERE legacy_id IS NOT NULL AND legacy_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS luna_creation_bibles_legacy_id_idx
  ON luna.creation_bibles (legacy_id)
  WHERE legacy_id IS NOT NULL AND legacy_id <> '';

COMMIT;
