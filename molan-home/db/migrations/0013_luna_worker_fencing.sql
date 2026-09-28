BEGIN;

ALTER TABLE luna.jobs
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS luna.job_dispatch (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  queue text NOT NULL DEFAULT 'default',
  claimed_by uuid,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, job_id),
  FOREIGN KEY (workspace_id, project_id, job_id)
    REFERENCES luna.jobs(workspace_id, project_id, id)
);

CREATE INDEX IF NOT EXISTS luna_job_dispatch_queue_idx
  ON luna.job_dispatch (queue, created_at, claimed_by);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'novel_worker') THEN
    CREATE ROLE novel_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

ALTER TABLE luna.job_dispatch OWNER TO novel_acl_owner;
ALTER TABLE luna.job_dispatch ENABLE ROW LEVEL SECURITY;
ALTER TABLE luna.job_dispatch FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION luna.claim_next_job(
  target_worker uuid,
  lease_seconds integer DEFAULT 600
)
RETURNS TABLE(
  workspace_id uuid,
  project_id uuid,
  job_id uuid,
  kind text,
  attempt_no integer,
  fencing_token bigint,
  revision bigint,
  input_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
DECLARE
  selected_job luna.jobs%ROWTYPE;
  next_sequence bigint;
  lease_until_value timestamptz := now() + make_interval(secs => greatest(30, least(86400, lease_seconds)));
BEGIN
  IF target_worker IS NULL THEN
    RAISE EXCEPTION 'worker identity is required' USING ERRCODE = '28000';
  END IF;
  SELECT j.* INTO selected_job
  FROM luna.jobs j
  WHERE j.state = 'queued'
  ORDER BY j.created_at ASC, j.id ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  UPDATE luna.jobs
  SET state = 'claimed',
      attempt_no = attempt_no + 1,
      fencing_token = fencing_token + 1,
      revision = revision + 1,
      lease_owner = target_worker,
      lease_until = lease_until_value,
      updated_at = now()
  WHERE workspace_id = selected_job.workspace_id
    AND project_id = selected_job.project_id
    AND id = selected_job.id
    AND state = 'queued'
  RETURNING * INTO selected_job;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  INSERT INTO luna.job_dispatch(workspace_id, project_id, job_id, queue, claimed_by, claimed_at)
  VALUES (selected_job.workspace_id, selected_job.project_id, selected_job.id, selected_job.kind, target_worker, now())
  ON CONFLICT (workspace_id, project_id, job_id) DO UPDATE
    SET claimed_by = excluded.claimed_by, claimed_at = excluded.claimed_at;
  SELECT COALESCE(MAX(event_seq), 0) + 1 INTO next_sequence
  FROM luna.job_events
  WHERE workspace_id = selected_job.workspace_id
    AND project_id = selected_job.project_id
    AND job_id = selected_job.id;
  INSERT INTO luna.job_events(workspace_id, project_id, job_id, event_seq, state, payload)
  VALUES (
    selected_job.workspace_id, selected_job.project_id, selected_job.id, next_sequence,
    'claimed', jsonb_build_object('worker', target_worker, 'fencingToken', selected_job.fencing_token)
  );
  workspace_id := selected_job.workspace_id;
  project_id := selected_job.project_id;
  job_id := selected_job.id;
  kind := selected_job.kind;
  attempt_no := selected_job.attempt_no;
  fencing_token := selected_job.fencing_token;
  revision := selected_job.revision;
  input_hash := selected_job.input_hash;
  RETURN NEXT;
END
$$;

CREATE OR REPLACE FUNCTION luna.heartbeat_job(
  target_worker uuid,
  target_workspace uuid,
  target_project uuid,
  target_job uuid,
  target_attempt integer,
  target_fencing bigint,
  lease_seconds integer DEFAULT 600
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
DECLARE
  affected_rows integer := 0;
BEGIN
  UPDATE luna.jobs
  SET lease_until = now() + make_interval(secs => greatest(30, least(86400, lease_seconds))),
      revision = revision + 1,
      updated_at = now()
  WHERE workspace_id = target_workspace
    AND project_id = target_project
    AND id = target_job
    AND state IN ('claimed', 'running')
    AND attempt_no = target_attempt
    AND fencing_token = target_fencing
    AND lease_owner = target_worker
    AND lease_until > now();
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows = 1;
END
$$;

CREATE OR REPLACE FUNCTION luna.finish_job(
  target_worker uuid,
  target_workspace uuid,
  target_project uuid,
  target_job uuid,
  target_attempt integer,
  target_fencing bigint,
  next_state text,
  next_result jsonb DEFAULT NULL,
  next_error_code text DEFAULT ''
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
DECLARE
  affected_rows integer := 0;
  current_job luna.jobs%ROWTYPE;
  next_sequence bigint;
  event_id uuid;
BEGIN
  IF next_state NOT IN ('succeeded', 'failed', 'cancelled', 'provider_unknown') THEN
    RAISE EXCEPTION 'worker terminal state is invalid' USING ERRCODE = '22023';
  END IF;
  UPDATE luna.jobs
  SET state = next_state,
      result = next_result,
      error_code = left(coalesce(next_error_code, ''), 120),
      lease_owner = NULL,
      lease_until = NULL,
      revision = revision + 1,
      updated_at = now()
  WHERE workspace_id = target_workspace
    AND project_id = target_project
    AND id = target_job
    AND state IN ('claimed', 'running', 'cancel_requested')
    AND attempt_no = target_attempt
    AND fencing_token = target_fencing
    AND lease_owner = target_worker
    AND lease_until > now();
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RETURN false;
  END IF;
  SELECT * INTO current_job
  FROM luna.jobs
  WHERE workspace_id = target_workspace AND project_id = target_project AND id = target_job;
  SELECT COALESCE(MAX(event_seq), 0) + 1 INTO next_sequence
  FROM luna.job_events
  WHERE workspace_id = target_workspace AND project_id = target_project AND job_id = target_job;
  INSERT INTO luna.job_events(workspace_id, project_id, job_id, event_seq, state, payload)
  VALUES (
    target_workspace, target_project, target_job, next_sequence, next_state,
    jsonb_build_object('worker', target_worker, 'fencingToken', target_fencing, 'errorCode', coalesce(next_error_code, ''))
  );
  event_id := (md5(target_job::text || ':' || current_job.revision::text || ':' || next_state))::uuid;
  INSERT INTO luna.outbox(
    workspace_id, project_id, id, aggregate_type, aggregate_id, aggregate_revision,
    event_seq, event_type, payload, job_id
  )
  VALUES (
    target_workspace, target_project, event_id, 'job', target_job, current_job.revision,
    next_sequence, 'job.' || next_state,
    jsonb_build_object('jobId', target_job, 'state', next_state, 'revision', current_job.revision),
    target_job
  )
  ON CONFLICT (workspace_id, project_id, aggregate_type, aggregate_id, aggregate_revision, event_seq) DO NOTHING;
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION luna.record_provider_attempt(
  target_workspace uuid,
  target_project uuid,
  target_job uuid,
  target_attempt integer,
  provider_request text,
  attempt_state text,
  usage_payload jsonb DEFAULT NULL,
  cost_minor_value bigint DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
DECLARE
  attempt_id uuid := (md5(target_job::text || ':' || target_attempt::text))::uuid;
BEGIN
  IF attempt_state NOT IN ('started', 'succeeded', 'failed', 'unknown') THEN
    RAISE EXCEPTION 'provider attempt state is invalid' USING ERRCODE = '22023';
  END IF;
  INSERT INTO luna.provider_attempts(
    workspace_id, project_id, id, job_id, attempt_no, provider_request_id,
    state, usage, cost_minor
  )
  VALUES (
    target_workspace, target_project, attempt_id, target_job, target_attempt,
    left(coalesce(provider_request, ''), 240), attempt_state, usage_payload, cost_minor_value
  )
  ON CONFLICT (workspace_id, project_id, job_id, attempt_no) DO UPDATE
    SET provider_request_id = excluded.provider_request_id,
        state = excluded.state,
        usage = excluded.usage,
        cost_minor = excluded.cost_minor;
  RETURN attempt_id;
END
$$;

ALTER FUNCTION luna.claim_next_job(uuid, integer) OWNER TO novel_acl_owner;
ALTER FUNCTION luna.heartbeat_job(uuid, uuid, uuid, uuid, integer, bigint, integer) OWNER TO novel_acl_owner;
ALTER FUNCTION luna.finish_job(uuid, uuid, uuid, uuid, integer, bigint, text, jsonb, text) OWNER TO novel_acl_owner;
ALTER FUNCTION luna.record_provider_attempt(uuid, uuid, uuid, integer, text, text, jsonb, bigint) OWNER TO novel_acl_owner;

REVOKE ALL ON FUNCTION luna.claim_next_job(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.heartbeat_job(uuid, uuid, uuid, uuid, integer, bigint, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.finish_job(uuid, uuid, uuid, uuid, integer, bigint, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.record_provider_attempt(uuid, uuid, uuid, integer, text, text, jsonb, bigint) FROM PUBLIC;

GRANT USAGE ON SCHEMA luna TO novel_worker;
GRANT EXECUTE ON FUNCTION luna.claim_next_job(uuid, integer) TO novel_worker;
GRANT EXECUTE ON FUNCTION luna.heartbeat_job(uuid, uuid, uuid, uuid, integer, bigint, integer) TO novel_worker;
GRANT EXECUTE ON FUNCTION luna.finish_job(uuid, uuid, uuid, uuid, integer, bigint, text, jsonb, text) TO novel_worker;
GRANT EXECUTE ON FUNCTION luna.record_provider_attempt(uuid, uuid, uuid, integer, text, text, jsonb, bigint) TO novel_worker;

COMMIT;
