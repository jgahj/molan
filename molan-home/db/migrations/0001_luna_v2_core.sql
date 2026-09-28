BEGIN;

CREATE SCHEMA IF NOT EXISTS luna;

CREATE TABLE IF NOT EXISTS luna.schema_migrations (
  version text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS luna.users (
  id uuid PRIMARY KEY,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS luna.auth_identities (
  issuer text NOT NULL,
  subject text NOT NULL,
  user_id uuid NOT NULL REFERENCES luna.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, subject)
);

CREATE TABLE IF NOT EXISTS luna.auth_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES luna.users(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS luna.workspaces (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS luna.workspace_members (
  workspace_id uuid NOT NULL REFERENCES luna.workspaces(id),
  user_id uuid NOT NULL REFERENCES luna.users(id),
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS luna.projects (
  workspace_id uuid NOT NULL REFERENCES luna.workspaces(id),
  id uuid NOT NULL,
  title text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  acl_revision bigint NOT NULL DEFAULT 1 CHECK (acl_revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS luna.project_members (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'reviewer', 'viewer')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, user_id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES luna.projects(workspace_id, id),
  FOREIGN KEY (workspace_id, user_id) REFERENCES luna.workspace_members(workspace_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS luna_one_project_owner
  ON luna.project_members (workspace_id, project_id)
  WHERE active AND role = 'owner';

CREATE TABLE IF NOT EXISTS luna.project_capability_grants (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  capability text NOT NULL CHECK (capability IN ('canSpend', 'canExport')),
  granted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, user_id, capability),
  FOREIGN KEY (workspace_id, project_id, user_id)
    REFERENCES luna.project_members(workspace_id, project_id, user_id)
);

CREATE TABLE IF NOT EXISTS luna.project_profiles (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  changed_by uuid NOT NULL REFERENCES luna.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES luna.projects(workspace_id, id)
);

CREATE TABLE IF NOT EXISTS luna.project_resources (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'worldbuilding', 'world-rule', 'culture', 'history-event', 'power-system',
    'character', 'relation', 'item', 'ability', 'term', 'outline', 'storyline',
    'plot-node', 'scene', 'event', 'foreshadow', 'timeline', 'material',
    'highlight', 'writing-task', 'issue'
  )),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
  created_by uuid NOT NULL REFERENCES luna.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (workspace_id, project_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES luna.projects(workspace_id, id)
);

CREATE TABLE IF NOT EXISTS luna.project_resource_versions (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  payload jsonb NOT NULL,
  changed_by uuid NOT NULL REFERENCES luna.users(id),
  change_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, resource_id, revision),
  FOREIGN KEY (workspace_id, project_id, resource_id)
    REFERENCES luna.project_resources(workspace_id, project_id, id)
);

CREATE TABLE IF NOT EXISTS luna.entities (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('character', 'place', 'faction', 'item', 'ability', 'term', 'rule')),
  name text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  deleted_at timestamptz,
  created_by uuid NOT NULL REFERENCES luna.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES luna.projects(workspace_id, id)
);

CREATE TABLE IF NOT EXISTS luna.relations (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  source_id uuid NOT NULL,
  target_id uuid NOT NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  deleted_at timestamptz,
  created_by uuid NOT NULL REFERENCES luna.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, id),
  FOREIGN KEY (workspace_id, project_id, source_id)
    REFERENCES luna.entities(workspace_id, project_id, id),
  FOREIGN KEY (workspace_id, project_id, target_id)
    REFERENCES luna.entities(workspace_id, project_id, id)
);

CREATE TABLE IF NOT EXISTS luna.plot_nodes (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  parent_id uuid,
  kind text NOT NULL CHECK (kind IN ('book', 'volume', 'arc', 'chapter', 'scene', 'event')),
  sort_key integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  deleted_at timestamptz,
  created_by uuid NOT NULL REFERENCES luna.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES luna.projects(workspace_id, id),
  FOREIGN KEY (workspace_id, project_id, parent_id)
    REFERENCES luna.plot_nodes(workspace_id, project_id, id),
  UNIQUE (workspace_id, project_id, parent_id, sort_key)
);

CREATE TABLE IF NOT EXISTS luna.foreshadows (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'planted', 'reinforced', 'deferred', 'partial', 'paid', 'abandoned')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by uuid NOT NULL REFERENCES luna.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES luna.projects(workspace_id, id)
);

CREATE TABLE IF NOT EXISTS luna.manuscripts (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'chapter'
    CHECK (kind IN ('chapter', 'extra', 'afterword', 'parallel')),
  continuity_id text NOT NULL DEFAULT 'main',
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  head_revision bigint NOT NULL DEFAULT 1 CHECK (head_revision > 0),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'review', 'approved', 'committed', 'archived')),
  deleted_at timestamptz,
  created_by uuid NOT NULL REFERENCES luna.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES luna.projects(workspace_id, id)
);

CREATE TABLE IF NOT EXISTS luna.manuscript_revisions (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  manuscript_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  body text NOT NULL,
  body_hash text NOT NULL CHECK (body_hash ~ '^[0-9a-f]{64}$'),
  changed_by uuid NOT NULL REFERENCES luna.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, manuscript_id, revision),
  FOREIGN KEY (workspace_id, project_id, manuscript_id)
    REFERENCES luna.manuscripts(workspace_id, project_id, id)
);

ALTER TABLE luna.manuscripts
  DROP CONSTRAINT IF EXISTS manuscripts_head_revision_fk;

ALTER TABLE luna.manuscripts
  ADD CONSTRAINT manuscripts_head_revision_fk
  FOREIGN KEY (workspace_id, project_id, id, head_revision)
  REFERENCES luna.manuscript_revisions(workspace_id, project_id, manuscript_id, revision)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS luna.creation_books (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES luna.users(id),
  title text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'generating', 'ready', 'archived')),
  plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES luna.projects(workspace_id, id)
);

CREATE TABLE IF NOT EXISTS luna.creation_bibles (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  book_id uuid NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  changed_by uuid NOT NULL REFERENCES luna.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, book_id, revision),
  FOREIGN KEY (workspace_id, project_id, book_id)
    REFERENCES luna.creation_books(workspace_id, project_id, id)
);

CREATE TABLE IF NOT EXISTS luna.context_snapshots (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  bible_revision bigint NOT NULL,
  state_revision bigint NOT NULL,
  input_hash text NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES luna.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES luna.projects(workspace_id, id)
);

CREATE TABLE IF NOT EXISTS luna.audits (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  context_snapshot_id uuid,
  subject_hash text NOT NULL CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('passed', 'needs_review', 'blocked', 'provider_unknown')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES luna.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES luna.projects(workspace_id, id),
  FOREIGN KEY (workspace_id, project_id, context_snapshot_id)
    REFERENCES luna.context_snapshots(workspace_id, project_id, id)
);

CREATE TABLE IF NOT EXISTS luna.commits (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  base_project_revision bigint NOT NULL,
  audit_id uuid,
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'approved', 'committed', 'rejected', 'unknown')),
  proposed_by uuid NOT NULL REFERENCES luna.users(id),
  committed_by uuid REFERENCES luna.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  PRIMARY KEY (workspace_id, project_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES luna.projects(workspace_id, id),
  FOREIGN KEY (workspace_id, project_id, audit_id)
    REFERENCES luna.audits(workspace_id, project_id, id)
);

CREATE TABLE IF NOT EXISTS luna.commit_items (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  commit_id uuid NOT NULL,
  item_no integer NOT NULL CHECK (item_no > 0),
  manuscript_id uuid,
  resource_id uuid,
  before_revision bigint,
  after_revision bigint,
  delta jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (workspace_id, project_id, commit_id, item_no),
  FOREIGN KEY (workspace_id, project_id, commit_id)
    REFERENCES luna.commits(workspace_id, project_id, id),
  FOREIGN KEY (workspace_id, project_id, manuscript_id)
    REFERENCES luna.manuscripts(workspace_id, project_id, id),
  FOREIGN KEY (workspace_id, project_id, resource_id)
    REFERENCES luna.project_resources(workspace_id, project_id, id),
  CHECK ((manuscript_id IS NOT NULL) <> (resource_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS luna.jobs (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES luna.users(id),
  kind text NOT NULL,
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'claimed', 'running', 'cancel_requested', 'cancelled', 'succeeded', 'failed', 'provider_unknown')),
  attempt_no integer NOT NULL DEFAULT 0 CHECK (attempt_no >= 0),
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  lease_owner uuid,
  lease_until timestamptz,
  input_hash text NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  result jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES luna.projects(workspace_id, id),
  CHECK ((lease_owner IS NULL) = (lease_until IS NULL)),
  CHECK (state NOT IN ('claimed', 'running') OR (lease_owner IS NOT NULL AND attempt_no > 0 AND fencing_token > 0))
);

CREATE TABLE IF NOT EXISTS luna.job_events (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  event_seq bigint NOT NULL CHECK (event_seq > 0),
  state text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, job_id, event_seq),
  FOREIGN KEY (workspace_id, project_id, job_id)
    REFERENCES luna.jobs(workspace_id, project_id, id)
);

CREATE TABLE IF NOT EXISTS luna.budgets (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  limit_minor bigint NOT NULL CHECK (limit_minor >= 0),
  currency text NOT NULL DEFAULT 'CREDIT',
  PRIMARY KEY (workspace_id, project_id, period_start),
  FOREIGN KEY (workspace_id, project_id) REFERENCES luna.projects(workspace_id, id),
  CHECK (period_end > period_start)
);

CREATE TABLE IF NOT EXISTS luna.budget_reservations (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  job_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  state text NOT NULL CHECK (state IN ('reserved', 'settled', 'released', 'unknown')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, id),
  UNIQUE (workspace_id, project_id, job_id),
  FOREIGN KEY (workspace_id, project_id, job_id)
    REFERENCES luna.jobs(workspace_id, project_id, id)
);

CREATE TABLE IF NOT EXISTS luna.billing_ledger (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  reservation_id uuid,
  amount_minor bigint NOT NULL,
  currency text NOT NULL DEFAULT 'CREDIT',
  entry_type text NOT NULL CHECK (entry_type IN ('charge', 'release', 'refund', 'adjustment')),
  provider_attempt_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, id),
  FOREIGN KEY (workspace_id, project_id, reservation_id)
    REFERENCES luna.budget_reservations(workspace_id, project_id, id)
);

CREATE TABLE IF NOT EXISTS luna.provider_attempts (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  job_id uuid NOT NULL,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  provider_request_id text,
  state text NOT NULL CHECK (state IN ('started', 'succeeded', 'failed', 'unknown')),
  usage jsonb,
  cost_minor bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, id),
  UNIQUE (workspace_id, project_id, job_id, attempt_no),
  FOREIGN KEY (workspace_id, project_id, job_id)
    REFERENCES luna.jobs(workspace_id, project_id, id)
);

CREATE TABLE IF NOT EXISTS luna.export_manifests (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES luna.users(id),
  state text NOT NULL CHECK (state IN ('queued', 'ready', 'failed', 'expired', 'revoked')),
  snapshot_revision bigint NOT NULL,
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  PRIMARY KEY (workspace_id, project_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES luna.projects(workspace_id, id)
);

CREATE TABLE IF NOT EXISTS luna.export_files (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  export_id uuid NOT NULL,
  path text NOT NULL,
  byte_length bigint NOT NULL CHECK (byte_length >= 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key text NOT NULL,
  PRIMARY KEY (workspace_id, project_id, export_id, path),
  FOREIGN KEY (workspace_id, project_id, export_id)
    REFERENCES luna.export_manifests(workspace_id, project_id, id)
);

CREATE TABLE IF NOT EXISTS luna.outbox (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  aggregate_type text NOT NULL CHECK (aggregate_type IN ('job', 'commit')),
  aggregate_id uuid NOT NULL,
  aggregate_revision bigint NOT NULL CHECK (aggregate_revision > 0),
  event_seq bigint NOT NULL CHECK (event_seq > 0),
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  published_at timestamptz,
  job_id uuid,
  commit_id uuid,
  PRIMARY KEY (workspace_id, project_id, id),
  UNIQUE (workspace_id, project_id, aggregate_type, aggregate_id, aggregate_revision, event_seq),
  FOREIGN KEY (workspace_id, project_id, job_id)
    REFERENCES luna.jobs(workspace_id, project_id, id),
  FOREIGN KEY (workspace_id, project_id, commit_id)
    REFERENCES luna.commits(workspace_id, project_id, id),
  CHECK ((job_id IS NOT NULL) <> (commit_id IS NOT NULL)),
  CHECK ((aggregate_type = 'job' AND job_id = aggregate_id)
      OR (aggregate_type = 'commit' AND commit_id = aggregate_id))
);

CREATE TABLE IF NOT EXISTS luna.api_idempotency (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES luna.users(id),
  operation text NOT NULL,
  key text NOT NULL CHECK (length(key) BETWEEN 1 AND 128),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  status_code integer,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, actor_id, operation, key),
  FOREIGN KEY (workspace_id, project_id) REFERENCES luna.projects(workspace_id, id)
);

CREATE OR REPLACE FUNCTION luna.actor_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION luna.can_project(target_workspace uuid, target_project uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM luna.workspace_members wm
    JOIN luna.project_members pm
      ON pm.workspace_id = wm.workspace_id AND pm.user_id = wm.user_id
    JOIN luna.projects p
      ON p.workspace_id = pm.workspace_id AND p.id = pm.project_id
    WHERE wm.workspace_id = target_workspace
      AND pm.project_id = target_project
      AND wm.user_id = luna.actor_id()
      AND wm.active
      AND pm.active
      AND p.status <> 'deleted'
  )
$$;

CREATE OR REPLACE FUNCTION luna.create_workspace(target_workspace uuid, workspace_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
DECLARE
  actor uuid := luna.actor_id();
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'authenticated actor is required' USING ERRCODE = '28000';
  END IF;
  IF workspace_name IS NULL OR length(btrim(workspace_name)) = 0 THEN
    RAISE EXCEPTION 'workspace name is required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO luna.users(id) VALUES (actor) ON CONFLICT DO NOTHING;
  INSERT INTO luna.workspaces(id, name) VALUES (target_workspace, btrim(workspace_name));
  INSERT INTO luna.workspace_members(workspace_id, user_id, role)
    VALUES (target_workspace, actor, 'owner');
END
$$;

CREATE OR REPLACE FUNCTION luna.create_project(target_workspace uuid, target_project uuid, project_title text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
DECLARE
  actor uuid := luna.actor_id();
BEGIN
  IF actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM luna.workspace_members
    WHERE workspace_id = target_workspace AND user_id = actor
      AND active AND role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'workspace management permission is required' USING ERRCODE = '42501';
  END IF;
  INSERT INTO luna.projects(workspace_id, id, title)
    VALUES (target_workspace, target_project, coalesce(btrim(project_title), ''));
  INSERT INTO luna.project_members(workspace_id, project_id, user_id, role)
    VALUES (target_workspace, target_project, actor, 'owner');
END
$$;

CREATE OR REPLACE FUNCTION luna.transfer_project_owner(target_workspace uuid, target_project uuid, target_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
DECLARE
  actor uuid := luna.actor_id();
  current_owner uuid;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'authenticated actor is required' USING ERRCODE = '28000';
  END IF;
  SELECT pm.user_id INTO current_owner
  FROM luna.project_members pm
  WHERE pm.workspace_id = target_workspace
    AND pm.project_id = target_project
    AND pm.role = 'owner'
    AND pm.active
  FOR UPDATE;
  IF current_owner IS NULL OR current_owner <> actor THEN
    RAISE EXCEPTION 'project owner permission is required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM luna.project_members
    WHERE workspace_id = target_workspace AND project_id = target_project
      AND user_id = target_user AND active
  ) THEN
    RAISE EXCEPTION 'target project member is required' USING ERRCODE = '23514';
  END IF;
  IF current_owner = target_user THEN
    RETURN;
  END IF;
  UPDATE luna.project_members
  SET role = 'admin', updated_at = now()
  WHERE workspace_id = target_workspace AND project_id = target_project
    AND user_id = current_owner AND role = 'owner' AND active;
  UPDATE luna.project_members
  SET role = 'owner', updated_at = now()
  WHERE workspace_id = target_workspace AND project_id = target_project
    AND user_id = target_user AND active;
  UPDATE luna.projects SET acl_revision = acl_revision + 1, updated_at = now()
  WHERE workspace_id = target_workspace AND id = target_project;
END
$$;

CREATE OR REPLACE FUNCTION luna.require_project_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
DECLARE
  target_workspace uuid := coalesce(NEW.workspace_id, OLD.workspace_id);
  target_project uuid := coalesce(NEW.project_id, OLD.project_id);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM luna.project_members
    WHERE workspace_id = target_workspace AND project_id = target_project
      AND role = 'owner' AND active
  ) THEN
    RAISE EXCEPTION 'project must retain an active owner' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION luna.actor_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.can_project(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.create_workspace(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.create_project(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.transfer_project_owner(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.require_project_owner() FROM PUBLIC;

DROP TRIGGER IF EXISTS luna_project_owner_required ON luna.project_members;
CREATE CONSTRAINT TRIGGER luna_project_owner_required
AFTER INSERT OR UPDATE OR DELETE ON luna.project_members
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION luna.require_project_owner();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'novel_app') THEN
    CREATE ROLE novel_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'novel_acl_owner') THEN
    CREATE ROLE novel_acl_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;
  END IF;
END
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'project_members', 'project_capability_grants', 'project_profiles',
    'project_resources', 'project_resource_versions', 'entities', 'relations',
    'plot_nodes', 'foreshadows', 'manuscripts', 'manuscript_revisions',
    'creation_books', 'creation_bibles', 'context_snapshots', 'audits', 'commits',
    'commit_items', 'jobs', 'job_events', 'budgets', 'budget_reservations',
    'billing_ledger', 'provider_attempts', 'export_manifests', 'export_files',
    'outbox', 'api_idempotency'
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

  ALTER TABLE luna.projects ENABLE ROW LEVEL SECURITY;
  ALTER TABLE luna.projects FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS luna_scope_projects ON luna.projects;
  CREATE POLICY luna_scope_projects ON luna.projects
    FOR ALL TO novel_app
    USING (luna.can_project(workspace_id, id))
    WITH CHECK (luna.can_project(workspace_id, id));

  ALTER TABLE luna.users ENABLE ROW LEVEL SECURITY;
  ALTER TABLE luna.users FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS luna_self_user ON luna.users;
  CREATE POLICY luna_self_user ON luna.users
    FOR ALL TO novel_app
    USING (id = luna.actor_id())
    WITH CHECK (id = luna.actor_id());

  ALTER TABLE luna.auth_identities ENABLE ROW LEVEL SECURITY;
  ALTER TABLE luna.auth_identities FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS luna_self_identity ON luna.auth_identities;
  CREATE POLICY luna_self_identity ON luna.auth_identities
    FOR ALL TO novel_app
    USING (user_id = luna.actor_id())
    WITH CHECK (user_id = luna.actor_id());

  ALTER TABLE luna.auth_sessions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE luna.auth_sessions FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS luna_self_session ON luna.auth_sessions;
  CREATE POLICY luna_self_session ON luna.auth_sessions
    FOR ALL TO novel_app
    USING (user_id = luna.actor_id())
    WITH CHECK (user_id = luna.actor_id());

  ALTER TABLE luna.workspace_members ENABLE ROW LEVEL SECURITY;
  ALTER TABLE luna.workspace_members FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS luna_workspace_membership ON luna.workspace_members;
  CREATE POLICY luna_workspace_membership ON luna.workspace_members
    FOR ALL TO novel_app
    USING (user_id = luna.actor_id() AND active)
    WITH CHECK (user_id = luna.actor_id());
END
$$;

GRANT EXECUTE ON FUNCTION luna.actor_id() TO novel_app;
GRANT EXECUTE ON FUNCTION luna.can_project(uuid, uuid) TO novel_app;
GRANT EXECUTE ON FUNCTION luna.create_workspace(uuid, text) TO novel_app;
GRANT EXECUTE ON FUNCTION luna.create_project(uuid, uuid, text) TO novel_app;
GRANT EXECUTE ON FUNCTION luna.transfer_project_owner(uuid, uuid, uuid) TO novel_app;

GRANT USAGE ON SCHEMA luna TO novel_app;
GRANT SELECT ON TABLE
  luna.users,
  luna.auth_identities,
  luna.auth_sessions,
  luna.workspaces,
  luna.workspace_members,
  luna.project_members,
  luna.project_capability_grants
TO novel_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  luna.projects,
  luna.project_profiles,
  luna.project_resources,
  luna.project_resource_versions,
  luna.entities,
  luna.relations,
  luna.plot_nodes,
  luna.foreshadows,
  luna.manuscripts,
  luna.manuscript_revisions,
  luna.creation_books,
  luna.creation_bibles,
  luna.context_snapshots,
  luna.audits,
  luna.commits,
  luna.commit_items,
  luna.jobs,
  luna.job_events,
  luna.budgets,
  luna.budget_reservations,
  luna.billing_ledger,
  luna.provider_attempts,
  luna.export_manifests,
  luna.export_files,
  luna.outbox,
  luna.api_idempotency
TO novel_app;

CREATE INDEX IF NOT EXISTS luna_project_members_user_idx
  ON luna.project_members (user_id, active);
CREATE INDEX IF NOT EXISTS luna_resources_kind_idx
  ON luna.project_resources (workspace_id, project_id, kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS luna_jobs_state_idx
  ON luna.jobs (workspace_id, project_id, state, updated_at);
CREATE INDEX IF NOT EXISTS luna_manuscripts_status_idx
  ON luna.manuscripts (workspace_id, project_id, status, updated_at DESC);

COMMIT;
