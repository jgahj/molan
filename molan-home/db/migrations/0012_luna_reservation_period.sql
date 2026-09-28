BEGIN;

ALTER TABLE luna.budget_reservations
  ADD COLUMN IF NOT EXISTS period_start date;

CREATE INDEX IF NOT EXISTS luna_budget_reservations_period_idx
  ON luna.budget_reservations (workspace_id, project_id, period_start, state);

COMMIT;
