BEGIN;

ALTER TABLE luna.story_memory_generation_runs
  DROP CONSTRAINT IF EXISTS story_memory_generation_runs_status_check;
ALTER TABLE luna.story_memory_generation_runs
  ADD CONSTRAINT story_memory_generation_runs_status_check
  CHECK (status IN ('queued', 'running', 'succeeded', 'needs_review', 'failed',
                    'provider_unknown', 'cancel_requested', 'cancelled'));

CREATE TABLE IF NOT EXISTS luna.story_memory_extractions (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  book_id uuid NOT NULL,
  branch_id text NOT NULL,
  manuscript_id text NOT NULL,
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_by uuid NOT NULL REFERENCES luna.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, book_id, branch_id, manuscript_id),
  FOREIGN KEY (workspace_id, project_id, book_id, branch_id, manuscript_id)
    REFERENCES luna.story_memory_manuscripts(workspace_id, project_id, book_id, branch_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS luna.story_memory_compensations (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  book_id uuid NOT NULL,
  branch_id text NOT NULL,
  operation_id text NOT NULL,
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt) = 'object'),
  created_by uuid NOT NULL REFERENCES luna.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, book_id, branch_id, operation_id),
  FOREIGN KEY (workspace_id, project_id, book_id, branch_id, operation_id)
    REFERENCES luna.story_memory_operations(workspace_id, project_id, book_id, branch_id, id) ON DELETE RESTRICT
);

ALTER TABLE luna.story_memory_extractions OWNER TO novel_acl_owner;
ALTER TABLE luna.story_memory_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE luna.story_memory_extractions FORCE ROW LEVEL SECURITY;
CREATE POLICY luna_scope_story_memory_extractions ON luna.story_memory_extractions
  FOR ALL TO novel_app
  USING (luna.can_project(workspace_id, project_id))
  WITH CHECK (luna.can_project(workspace_id, project_id));

ALTER TABLE luna.story_memory_compensations OWNER TO novel_acl_owner;
ALTER TABLE luna.story_memory_compensations ENABLE ROW LEVEL SECURITY;
ALTER TABLE luna.story_memory_compensations FORCE ROW LEVEL SECURITY;
CREATE POLICY luna_scope_story_memory_compensations ON luna.story_memory_compensations
  FOR ALL TO novel_app
  USING (luna.can_project(workspace_id, project_id))
  WITH CHECK (luna.can_project(workspace_id, project_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  luna.story_memory_extractions,
  luna.story_memory_compensations
TO novel_app;

COMMIT;
