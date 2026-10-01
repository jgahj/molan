BEGIN;

ALTER TABLE luna.runtime_dissections
  ALTER COLUMN estimated_credits DROP NOT NULL,
  ALTER COLUMN estimated_credits DROP DEFAULT,
  ALTER COLUMN actual_credits DROP NOT NULL,
  ALTER COLUMN actual_credits DROP DEFAULT;

COMMIT;
