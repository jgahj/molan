BEGIN;

CREATE TABLE IF NOT EXISTS luna.story_memory_branches (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  book_id uuid NOT NULL,
  branch_id text NOT NULL,
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, book_id, branch_id),
  FOREIGN KEY (workspace_id, project_id, book_id)
    REFERENCES luna.creation_books(workspace_id, project_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS luna.story_memory_records (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  book_id uuid NOT NULL,
  branch_id text NOT NULL,
  record_type text NOT NULL CHECK (record_type IN (
    'proposition', 'evidence', 'fact', 'cognition', 'event', 'transition', 'plan',
    'commitment', 'foreshadow', 'temporal_relation', 'disclosure', 'automation_policy'
  )),
  id text NOT NULL,
  timeline_id text NOT NULL DEFAULT 't0',
  cycle_id text NOT NULL DEFAULT 'c0',
  status text NOT NULL DEFAULT 'active',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_by uuid NOT NULL REFERENCES luna.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, book_id, branch_id, record_type, id),
  UNIQUE (workspace_id, project_id, book_id, branch_id, id),
  FOREIGN KEY (workspace_id, project_id, book_id)
    REFERENCES luna.creation_books(workspace_id, project_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS story_memory_records_lookup_idx
  ON luna.story_memory_records (workspace_id, project_id, book_id, branch_id, record_type, status, created_at DESC);
CREATE INDEX IF NOT EXISTS story_memory_records_timeline_idx
  ON luna.story_memory_records (workspace_id, project_id, book_id, branch_id, timeline_id, cycle_id, record_type);

CREATE TABLE IF NOT EXISTS luna.story_memory_record_versions (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  book_id uuid NOT NULL,
  branch_id text NOT NULL,
  record_type text NOT NULL,
  record_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  changeset_id text NOT NULL DEFAULT '',
  changed_by uuid NOT NULL REFERENCES luna.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, book_id, branch_id, record_type, record_id, revision),
  FOREIGN KEY (workspace_id, project_id, book_id)
    REFERENCES luna.creation_books(workspace_id, project_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS luna.story_memory_changesets (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  book_id uuid NOT NULL,
  branch_id text NOT NULL,
  id text NOT NULL,
  base_state_version bigint NOT NULL CHECK (base_state_version > 0),
  candidate_hash text NOT NULL DEFAULT '',
  operations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(operations) = 'array'),
  dependencies jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(dependencies) = 'array'),
  risk_level text NOT NULL DEFAULT 'low',
  audit_report jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(audit_report) = 'object'),
  approval_policy text NOT NULL DEFAULT 'author_owned' CHECK (approval_policy IN ('author_owned', 'two_person')),
  approval_status text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  approved_by uuid REFERENCES luna.users(id),
  approved_at timestamptz,
  committed_at timestamptz,
  created_by uuid NOT NULL REFERENCES luna.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, book_id, branch_id, id),
  FOREIGN KEY (workspace_id, project_id, book_id)
    REFERENCES luna.creation_books(workspace_id, project_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS story_memory_changesets_recent_idx
  ON luna.story_memory_changesets (workspace_id, project_id, book_id, branch_id, created_at DESC);

CREATE TABLE IF NOT EXISTS luna.story_memory_approvals (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  book_id uuid NOT NULL,
  branch_id text NOT NULL,
  changeset_id text NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  content_hash text NOT NULL,
  actor_id uuid NOT NULL REFERENCES luna.users(id),
  status text NOT NULL CHECK (status IN ('approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, book_id, branch_id, changeset_id, sequence),
  FOREIGN KEY (workspace_id, project_id, book_id, branch_id, changeset_id)
    REFERENCES luna.story_memory_changesets(workspace_id, project_id, book_id, branch_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS luna.story_memory_commit_receipts (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  book_id uuid NOT NULL,
  branch_id text NOT NULL,
  actor_id uuid NOT NULL REFERENCES luna.users(id),
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 1 AND 200),
  request_hash text NOT NULL,
  changeset_id text NOT NULL,
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, book_id, branch_id, actor_id, request_key),
  FOREIGN KEY (workspace_id, project_id, book_id, branch_id, changeset_id)
    REFERENCES luna.story_memory_changesets(workspace_id, project_id, book_id, branch_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS luna.story_memory_operations (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  book_id uuid NOT NULL,
  branch_id text NOT NULL,
  id text NOT NULL,
  changeset_id text NOT NULL,
  operation_type text NOT NULL,
  record_type text NOT NULL,
  record_id text NOT NULL,
  before_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  reverted boolean NOT NULL DEFAULT false,
  revert_reason text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES luna.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, book_id, branch_id, id),
  FOREIGN KEY (workspace_id, project_id, book_id, branch_id, changeset_id)
    REFERENCES luna.story_memory_changesets(workspace_id, project_id, book_id, branch_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS story_memory_operations_target_idx
  ON luna.story_memory_operations (workspace_id, project_id, book_id, branch_id, record_type, record_id, created_at DESC);

CREATE TABLE IF NOT EXISTS luna.story_memory_outbox (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  book_id uuid NOT NULL,
  branch_id text NOT NULL,
  id text NOT NULL,
  event_id text NOT NULL,
  state_version bigint NOT NULL CHECK (state_version > 0),
  projection_type text NOT NULL,
  projection_schema_version integer NOT NULL DEFAULT 1 CHECK (projection_schema_version > 0),
  payload_hash text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, book_id, branch_id, id),
  UNIQUE (workspace_id, project_id, book_id, branch_id, event_id, projection_type, state_version),
  FOREIGN KEY (workspace_id, project_id, book_id)
    REFERENCES luna.creation_books(workspace_id, project_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS story_memory_outbox_pending_idx
  ON luna.story_memory_outbox (workspace_id, project_id, book_id, branch_id, state_version)
  WHERE status IN ('queued', 'failed');

CREATE TABLE IF NOT EXISTS luna.story_memory_manuscripts (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  book_id uuid NOT NULL,
  branch_id text NOT NULL,
  id text NOT NULL,
  chapter_id text NOT NULL DEFAULT '',
  scene_id text NOT NULL DEFAULT '',
  revision integer NOT NULL CHECK (revision > 0),
  content text NOT NULL,
  content_hash text NOT NULL,
  source_hash text NOT NULL DEFAULT '',
  novel_revision bigint NOT NULL DEFAULT 0,
  config_hash text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES luna.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, book_id, branch_id, id),
  UNIQUE (workspace_id, project_id, book_id, branch_id, chapter_id, scene_id, revision),
  FOREIGN KEY (workspace_id, project_id, book_id)
    REFERENCES luna.creation_books(workspace_id, project_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS luna.story_memory_manuscript_heads (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  book_id uuid NOT NULL,
  branch_id text NOT NULL,
  chapter_id text NOT NULL,
  scene_id text NOT NULL DEFAULT '',
  current_id text NOT NULL,
  accepted_id text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  PRIMARY KEY (workspace_id, project_id, book_id, branch_id, chapter_id, scene_id),
  FOREIGN KEY (workspace_id, project_id, book_id, branch_id, current_id)
    REFERENCES luna.story_memory_manuscripts(workspace_id, project_id, book_id, branch_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, book_id)
    REFERENCES luna.creation_books(workspace_id, project_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS luna.story_memory_changeset_sources (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  book_id uuid NOT NULL,
  branch_id text NOT NULL,
  changeset_id text NOT NULL,
  manuscript_id text NOT NULL,
  binding_hash text NOT NULL,
  PRIMARY KEY (workspace_id, project_id, book_id, branch_id, changeset_id),
  FOREIGN KEY (workspace_id, project_id, book_id, branch_id, changeset_id)
    REFERENCES luna.story_memory_changesets(workspace_id, project_id, book_id, branch_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, book_id, branch_id, manuscript_id)
    REFERENCES luna.story_memory_manuscripts(workspace_id, project_id, book_id, branch_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS luna.story_memory_context_manifests (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  book_id uuid NOT NULL,
  branch_id text NOT NULL,
  id text NOT NULL,
  state_version bigint NOT NULL CHECK (state_version > 0),
  writing_package jsonb NOT NULL CHECK (jsonb_typeof(writing_package) = 'object'),
  audit_package jsonb NOT NULL CHECK (jsonb_typeof(audit_package) = 'object'),
  included_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  budget_tokens integer NOT NULL CHECK (budget_tokens > 0),
  input_hash text NOT NULL,
  model_id text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES luna.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, book_id, branch_id, id),
  FOREIGN KEY (workspace_id, project_id, book_id)
    REFERENCES luna.creation_books(workspace_id, project_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS luna.story_memory_rewrite_contracts (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  book_id uuid NOT NULL,
  branch_id text NOT NULL,
  id text NOT NULL,
  candidate_hash text NOT NULL DEFAULT '',
  contract jsonb NOT NULL CHECK (jsonb_typeof(contract) = 'object'),
  created_by uuid NOT NULL REFERENCES luna.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, book_id, branch_id, id),
  FOREIGN KEY (workspace_id, project_id, book_id)
    REFERENCES luna.creation_books(workspace_id, project_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS luna.story_memory_rewrite_reviews (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  book_id uuid NOT NULL,
  branch_id text NOT NULL,
  id text NOT NULL,
  manuscript_id text NOT NULL,
  contract_id text NOT NULL,
  candidate_hash text NOT NULL,
  passed boolean NOT NULL DEFAULT false,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES luna.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, book_id, branch_id, id),
  FOREIGN KEY (workspace_id, project_id, book_id, branch_id, manuscript_id)
    REFERENCES luna.story_memory_manuscripts(workspace_id, project_id, book_id, branch_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, book_id, branch_id, contract_id)
    REFERENCES luna.story_memory_rewrite_contracts(workspace_id, project_id, book_id, branch_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS luna.story_memory_projection_snapshots (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  book_id uuid NOT NULL,
  branch_id text NOT NULL,
  state_version bigint NOT NULL CHECK (state_version > 0),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  payload_hash text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, book_id, branch_id),
  FOREIGN KEY (workspace_id, project_id, book_id)
    REFERENCES luna.creation_books(workspace_id, project_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS luna.story_memory_invalidations (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  book_id uuid NOT NULL,
  branch_id text NOT NULL,
  id text NOT NULL,
  manuscript_id text NOT NULL,
  reason text NOT NULL,
  created_by uuid NOT NULL REFERENCES luna.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, book_id, branch_id, id),
  UNIQUE (workspace_id, project_id, book_id, branch_id, manuscript_id, reason),
  FOREIGN KEY (workspace_id, project_id, book_id, branch_id, manuscript_id)
    REFERENCES luna.story_memory_manuscripts(workspace_id, project_id, book_id, branch_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS luna.story_memory_run_events (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  book_id uuid NOT NULL,
  branch_id text NOT NULL,
  sequence bigint GENERATED ALWAYS AS IDENTITY,
  run_id text NOT NULL,
  type text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sequence),
  FOREIGN KEY (workspace_id, project_id, book_id)
    REFERENCES luna.creation_books(workspace_id, project_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS story_memory_run_events_scope_idx
  ON luna.story_memory_run_events (workspace_id, project_id, book_id, run_id, sequence);

CREATE TABLE IF NOT EXISTS luna.story_memory_generation_runs (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  book_id uuid NOT NULL,
  branch_id text NOT NULL,
  id text NOT NULL,
  actor_id uuid NOT NULL REFERENCES luna.users(id),
  request_id text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'provider_unknown', 'cancel_requested', 'cancelled')),
  manifest_id text NOT NULL,
  input jsonb NOT NULL CHECK (jsonb_typeof(input) = 'object'),
  result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object'),
  calls integer NOT NULL DEFAULT 0 CHECK (calls >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, book_id, branch_id, id),
  UNIQUE (workspace_id, project_id, book_id, branch_id, actor_id, request_id),
  FOREIGN KEY (workspace_id, project_id, book_id, branch_id, manifest_id)
    REFERENCES luna.story_memory_context_manifests(workspace_id, project_id, book_id, branch_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS luna.style_profiles (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  book_id uuid NOT NULL,
  branch_id text NOT NULL DEFAULT 'main',
  id text NOT NULL,
  name text NOT NULL,
  level text NOT NULL DEFAULT 'novel_narrative'
    CHECK (level IN ('author_preference', 'novel_narrative', 'character_voice', 'scene_mode', 'task_temporary')),
  target_entity_id text NOT NULL DEFAULT '',
  target_scene_type text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES luna.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, book_id, branch_id, id),
  FOREIGN KEY (workspace_id, project_id, book_id)
    REFERENCES luna.creation_books(workspace_id, project_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS style_profiles_scope_idx
  ON luna.style_profiles (workspace_id, project_id, book_id, branch_id, level, active, created_at);

CREATE TABLE IF NOT EXISTS luna.style_profile_versions (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  book_id uuid NOT NULL,
  branch_id text NOT NULL,
  profile_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  hard_rules jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(hard_rules) = 'array'),
  soft_preferences jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(soft_preferences) = 'object'),
  positive_samples jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(positive_samples) = 'array'),
  negative_samples jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(negative_samples) = 'array'),
  check_rules jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(check_rules) = 'object'),
  revision_strategy jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(revision_strategy) = 'object'),
  approved_by uuid NOT NULL REFERENCES luna.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, book_id, branch_id, profile_id, revision),
  FOREIGN KEY (workspace_id, project_id, book_id, branch_id, profile_id)
    REFERENCES luna.style_profiles(workspace_id, project_id, book_id, branch_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS luna.style_bindings (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  book_id uuid NOT NULL,
  branch_id text NOT NULL,
  id text NOT NULL,
  profile_id text NOT NULL,
  target_type text NOT NULL DEFAULT 'novel',
  target_id text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, book_id, branch_id, id),
  FOREIGN KEY (workspace_id, project_id, book_id, branch_id, profile_id)
    REFERENCES luna.style_profiles(workspace_id, project_id, book_id, branch_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS style_bindings_target_idx
  ON luna.style_bindings (workspace_id, project_id, book_id, branch_id, target_type, target_id);

CREATE TABLE IF NOT EXISTS luna.style_anchor_samples (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  book_id uuid NOT NULL,
  branch_id text NOT NULL,
  id text NOT NULL,
  profile_id text NOT NULL,
  sample_type text NOT NULL DEFAULT 'positive' CHECK (sample_type IN ('positive', 'negative')),
  text text NOT NULL,
  critique text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by uuid NOT NULL REFERENCES luna.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, book_id, branch_id, id),
  FOREIGN KEY (workspace_id, project_id, book_id, branch_id, profile_id)
    REFERENCES luna.style_profiles(workspace_id, project_id, book_id, branch_id, id) ON DELETE RESTRICT
);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'story_memory_branches', 'story_memory_records', 'story_memory_record_versions',
    'story_memory_changesets', 'story_memory_approvals', 'story_memory_commit_receipts',
    'story_memory_operations', 'story_memory_outbox', 'story_memory_manuscripts',
    'story_memory_manuscript_heads', 'story_memory_changeset_sources',
    'story_memory_context_manifests', 'story_memory_rewrite_contracts',
    'story_memory_rewrite_reviews', 'story_memory_projection_snapshots',
    'story_memory_invalidations', 'story_memory_run_events', 'story_memory_generation_runs',
    'style_profiles', 'style_profile_versions', 'style_bindings', 'style_anchor_samples'
  ] LOOP
    EXECUTE format('ALTER TABLE luna.%I OWNER TO novel_acl_owner', table_name);
    EXECUTE format('ALTER TABLE luna.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE luna.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON luna.%I', 'luna_scope_' || table_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I ON luna.%I FOR ALL TO novel_app USING (luna.can_project(workspace_id, project_id)) WITH CHECK (luna.can_project(workspace_id, project_id))',
      'luna_scope_' || table_name, table_name
    );
  END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  luna.story_memory_branches,
  luna.story_memory_records,
  luna.story_memory_record_versions,
  luna.story_memory_changesets,
  luna.story_memory_approvals,
  luna.story_memory_commit_receipts,
  luna.story_memory_operations,
  luna.story_memory_outbox,
  luna.story_memory_manuscripts,
  luna.story_memory_manuscript_heads,
  luna.story_memory_changeset_sources,
  luna.story_memory_context_manifests,
  luna.story_memory_rewrite_contracts,
  luna.story_memory_rewrite_reviews,
  luna.story_memory_projection_snapshots,
  luna.story_memory_invalidations,
  luna.story_memory_run_events,
  luna.story_memory_generation_runs,
  luna.style_profiles,
  luna.style_profile_versions,
  luna.style_bindings,
  luna.style_anchor_samples
TO novel_app;
GRANT USAGE, SELECT ON SEQUENCE luna.story_memory_run_events_sequence_seq TO novel_app;

COMMIT;
