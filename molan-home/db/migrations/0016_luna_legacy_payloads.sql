BEGIN;

CREATE TABLE IF NOT EXISTS luna.legacy_payloads (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  source_kind text NOT NULL,
  legacy_id text NOT NULL,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL REFERENCES luna.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, id),
  UNIQUE (workspace_id, project_id, source_kind, legacy_id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES luna.projects(workspace_id, id)
);

CREATE INDEX IF NOT EXISTS luna_legacy_payloads_kind_idx
  ON luna.legacy_payloads (workspace_id, project_id, source_kind, updated_at DESC);

ALTER TABLE luna.legacy_payloads OWNER TO novel_acl_owner;
ALTER TABLE luna.legacy_payloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE luna.legacy_payloads FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS luna_scope_legacy_payloads ON luna.legacy_payloads;
CREATE POLICY luna_scope_legacy_payloads ON luna.legacy_payloads
  FOR ALL TO novel_app
  USING (luna.can_project(workspace_id, project_id))
  WITH CHECK (luna.can_project(workspace_id, project_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON luna.legacy_payloads TO novel_app;

COMMIT;
