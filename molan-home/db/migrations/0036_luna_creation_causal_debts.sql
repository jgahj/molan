BEGIN;

-- Causal debts are first-class creation data.  They must move with the
-- creation book and remain visible only through the project's RLS scope.
CREATE TABLE IF NOT EXISTS luna.creation_causal_debts (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  book_id uuid NOT NULL,
  id text NOT NULL,
  origin_chapter integer NOT NULL CHECK (origin_chapter > 0),
  type text NOT NULL CHECK (type IN ('major', 'arc', 'micro')),
  debt_category text NOT NULL DEFAULT 'general',
  seed text NOT NULL CHECK (length(btrim(seed)) > 0),
  immediate_cost text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'matured', 'redeemed', 'settled')),
  maturation_chapter integer NOT NULL CHECK (maturation_chapter > 0),
  payoff_tier integer NOT NULL DEFAULT 1 CHECK (payoff_tier > 0),
  suggested_payoff_action text NOT NULL DEFAULT '',
  redeemed_chapter integer,
  payoff_action text NOT NULL DEFAULT '',
  redeemed_at timestamptz,
  settled_reason text NOT NULL DEFAULT '',
  settled_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, book_id, id),
  FOREIGN KEY (workspace_id, project_id, book_id)
    REFERENCES luna.creation_books(workspace_id, project_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS creation_causal_debts_active_idx
  ON luna.creation_causal_debts
    (workspace_id, project_id, book_id, status, maturation_chapter, origin_chapter);
CREATE INDEX IF NOT EXISTS creation_causal_debts_seed_idx
  ON luna.creation_causal_debts
    (workspace_id, project_id, book_id, seed);

ALTER TABLE luna.creation_causal_debts OWNER TO novel_acl_owner;
ALTER TABLE luna.creation_causal_debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE luna.creation_causal_debts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS luna_scope_creation_causal_debts ON luna.creation_causal_debts;
CREATE POLICY luna_scope_creation_causal_debts ON luna.creation_causal_debts
  FOR ALL TO novel_app
  USING (luna.can_project(workspace_id, project_id))
  WITH CHECK (luna.can_project(workspace_id, project_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON luna.creation_causal_debts TO novel_app;
GRANT SELECT ON luna.creation_causal_debts TO novel_worker;

COMMIT;
