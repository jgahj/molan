BEGIN;

CREATE TABLE IF NOT EXISTS luna.generation_runs (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES luna.users(id),
  chapter_id text NOT NULL DEFAULT '',
  pipeline_version text NOT NULL,
  state text NOT NULL CHECK (state IN (
    'created','request_validated','genre_resolved','style_resolved','context_built',
    'contract_validated','pre_generation_guard','scene_planning','generating','draft_received',
    'deterministic_audit','semantic_audit','quality_audit','revision','waiting_author','committing',
    'committed','cancel_requested','cancelled','paused','failed','provider_unknown','needs_human','rejected'
  )),
  attempt_no integer NOT NULL DEFAULT 0 CHECK (attempt_no >= 0),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_id text NOT NULL DEFAULT '',
  provider_model text NOT NULL DEFAULT '',
  provider_request_id text NOT NULL DEFAULT '',
  context_hash text NOT NULL DEFAULT '',
  contract_hash text NOT NULL DEFAULT '',
  prompt_hash text NOT NULL DEFAULT '',
  output_hash text NOT NULL DEFAULT '',
  reserved_cost_minor bigint NOT NULL DEFAULT 0 CHECK (reserved_cost_minor >= 0),
  actual_cost_minor bigint NOT NULL DEFAULT 0 CHECK (actual_cost_minor >= 0),
  cancel_requested boolean NOT NULL DEFAULT false,
  pause_requested boolean NOT NULL DEFAULT false,
  lease_owner uuid,
  lease_until timestamptz,
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  error_code text NOT NULL DEFAULT '',
  error_detail text NOT NULL DEFAULT '',
  started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  PRIMARY KEY (workspace_id, project_id, id),
  UNIQUE (workspace_id, project_id, idempotency_key),
  FOREIGN KEY (workspace_id, project_id) REFERENCES luna.projects(workspace_id, id),
  CHECK ((lease_owner IS NULL) = (lease_until IS NULL))
);

CREATE INDEX IF NOT EXISTS luna_generation_project_updated_idx
  ON luna.generation_runs (workspace_id, project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS luna_generation_actor_state_idx
  ON luna.generation_runs (requested_by, state, updated_at DESC);

CREATE TABLE IF NOT EXISTS luna.generation_stage_runs (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  stage text NOT NULL,
  attempt_no integer NOT NULL DEFAULT 1 CHECK (attempt_no > 0),
  status text NOT NULL CHECK (status IN ('running','completed','failed','unknown','skipped')),
  input_hash text NOT NULL DEFAULT '',
  output_hash text NOT NULL DEFAULT '',
  prompt_tokens bigint,
  completion_tokens bigint,
  reasoning_tokens bigint,
  cached_tokens bigint,
  reserved_cost_minor bigint NOT NULL DEFAULT 0 CHECK (reserved_cost_minor >= 0),
  actual_cost_minor bigint NOT NULL DEFAULT 0 CHECK (actual_cost_minor >= 0),
  provider_request_id text NOT NULL DEFAULT '',
  error_code text NOT NULL DEFAULT '',
  started_at timestamptz,
  finished_at timestamptz,
  PRIMARY KEY (workspace_id, project_id, generation_id, stage, attempt_no),
  FOREIGN KEY (workspace_id, project_id, generation_id)
    REFERENCES luna.generation_runs(workspace_id, project_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS luna.generation_idempotency (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  generation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, idempotency_key),
  FOREIGN KEY (workspace_id, project_id, generation_id)
    REFERENCES luna.generation_runs(workspace_id, project_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS luna.generation_run_events (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  event_seq bigint NOT NULL CHECK (event_seq > 0),
  state text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, generation_id, event_seq),
  FOREIGN KEY (workspace_id, project_id, generation_id)
    REFERENCES luna.generation_runs(workspace_id, project_id, id) ON DELETE CASCADE
);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['generation_runs','generation_stage_runs','generation_idempotency','generation_run_events'] LOOP
    EXECUTE format('ALTER TABLE luna.%I OWNER TO novel_acl_owner', table_name);
    EXECUTE format('ALTER TABLE luna.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE luna.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON luna.%I', 'luna_scope_' || table_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I ON luna.%I FOR ALL TO novel_app USING (luna.can_project(workspace_id, project_id)) WITH CHECK (luna.can_project(workspace_id, project_id))',
      'luna_scope_' || table_name, table_name
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON luna.%I TO novel_app', table_name);
  END LOOP;
END
$$;

COMMIT;
