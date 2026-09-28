BEGIN;

-- Worker terminal writes accept the provider's actual cost in minor units.
-- When the caller omits it, use the cost already recorded for this attempt so
-- legacy callers cannot silently turn a successful paid attempt into a zero
-- charge.
CREATE OR REPLACE FUNCTION luna.finish_job_v2(
  target_worker uuid,
  target_workspace uuid,
  target_project uuid,
  target_job uuid,
  target_attempt integer,
  target_fencing bigint,
  next_state text,
  next_result jsonb DEFAULT NULL,
  next_error_code text DEFAULT '',
  target_actual_minor bigint DEFAULT NULL
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
  billing_state text;
  effective_state text := next_state;
  effective_error text := coalesce(next_error_code, '');
  actual_minor bigint := greatest(0, coalesce(target_actual_minor, 0));
BEGIN
  IF next_state NOT IN ('succeeded', 'failed', 'cancelled', 'provider_unknown') THEN
    RAISE EXCEPTION 'worker terminal state is invalid' USING ERRCODE = '22023';
  END IF;

  IF target_actual_minor IS NULL THEN
    SELECT greatest(0, coalesce(pa.cost_minor, 0))
    INTO actual_minor
    FROM luna.provider_attempts pa
    WHERE pa.workspace_id = target_workspace
      AND pa.project_id = target_project
      AND pa.job_id = target_job
      AND pa.attempt_no = target_attempt
    LIMIT 1;
    actual_minor := coalesce(actual_minor, 0);
  END IF;

  SELECT * INTO current_job
  FROM luna.jobs
  WHERE workspace_id = target_workspace
    AND project_id = target_project
    AND id = target_job
  FOR UPDATE;
  IF NOT FOUND
    OR current_job.state NOT IN ('claimed', 'running', 'cancel_requested')
    OR current_job.attempt_no <> target_attempt
    OR current_job.fencing_token <> target_fencing
    OR current_job.lease_owner <> target_worker
    OR current_job.lease_until <= now() THEN
    RETURN false;
  END IF;

  billing_state := luna.finalize_job_budget(
    target_workspace, target_project, target_job, next_state, actual_minor,
    jsonb_build_object('worker', target_worker, 'actualCostMinor', actual_minor)
  );
  IF billing_state = 'unknown' AND next_state <> 'provider_unknown' THEN
    effective_state := 'provider_unknown';
    effective_error := 'budget_reconciliation_required';
  END IF;

  UPDATE luna.jobs
  SET state = effective_state,
      result = next_result,
      error_code = left(effective_error, 120),
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
  SELECT coalesce(max(event_seq), 0) + 1 INTO next_sequence
  FROM luna.job_events
  WHERE workspace_id = target_workspace AND project_id = target_project AND job_id = target_job;
  INSERT INTO luna.job_events(workspace_id, project_id, job_id, event_seq, state, payload)
  VALUES (
    target_workspace, target_project, target_job, next_sequence, effective_state,
    jsonb_build_object(
      'worker', target_worker,
      'fencingToken', target_fencing,
      'errorCode', effective_error,
      'billingState', billing_state,
      'actualCostMinor', actual_minor
    )
  );
  event_id := md5(target_job::text || ':' || current_job.revision::text || ':' || effective_state)::uuid;
  INSERT INTO luna.outbox(
    workspace_id, project_id, id, aggregate_type, aggregate_id, aggregate_revision,
    event_seq, event_type, payload, job_id
  )
  VALUES (
    target_workspace, target_project, event_id, 'job', target_job, current_job.revision,
    next_sequence, 'job.' || effective_state,
    jsonb_build_object(
      'jobId', target_job,
      'state', effective_state,
      'revision', current_job.revision,
      'billingState', billing_state,
      'actualCostMinor', actual_minor
    ), target_job
  )
  ON CONFLICT (workspace_id, project_id, aggregate_type, aggregate_id, aggregate_revision, event_seq) DO NOTHING;
  RETURN true;
END
$$;

ALTER FUNCTION luna.finish_job_v2(uuid, uuid, uuid, uuid, integer, bigint, text, jsonb, text, bigint)
  OWNER TO novel_acl_owner;
REVOKE ALL ON FUNCTION luna.finish_job_v2(uuid, uuid, uuid, uuid, integer, bigint, text, jsonb, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION luna.finish_job_v2(uuid, uuid, uuid, uuid, integer, bigint, text, jsonb, text, bigint) TO novel_worker;

-- Keep the legacy API stable while making its billing path cost-aware through
-- the provider_attempts fallback above.
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
BEGIN
  RETURN luna.finish_job_v2(
    target_worker, target_workspace, target_project, target_job,
    target_attempt, target_fencing, next_state, next_result, next_error_code, NULL
  );
END
$$;

ALTER FUNCTION luna.finish_job(uuid, uuid, uuid, uuid, integer, bigint, text, jsonb, text)
  OWNER TO novel_acl_owner;
REVOKE ALL ON FUNCTION luna.finish_job(uuid, uuid, uuid, uuid, integer, bigint, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION luna.finish_job(uuid, uuid, uuid, uuid, integer, bigint, text, jsonb, text) TO novel_worker;

COMMIT;
