BEGIN;

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
  SELECT queued_job.* INTO selected_job
  FROM luna.jobs queued_job
  WHERE queued_job.state = 'queued'
  ORDER BY queued_job.created_at ASC, queued_job.id ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  UPDATE luna.jobs current_job
  SET state = 'claimed',
      attempt_no = current_job.attempt_no + 1,
      fencing_token = current_job.fencing_token + 1,
      revision = current_job.revision + 1,
      lease_owner = target_worker,
      lease_until = lease_until_value,
      updated_at = now()
  WHERE current_job.workspace_id = selected_job.workspace_id
    AND current_job.project_id = selected_job.project_id
    AND current_job.id = selected_job.id
    AND current_job.state = 'queued'
  RETURNING current_job.* INTO selected_job;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  INSERT INTO luna.job_dispatch(workspace_id, project_id, job_id, queue, claimed_by, claimed_at)
  VALUES (selected_job.workspace_id, selected_job.project_id, selected_job.id, selected_job.kind, target_worker, now())
  ON CONFLICT (workspace_id, project_id, job_id) DO UPDATE
    SET claimed_by = excluded.claimed_by, claimed_at = excluded.claimed_at;
  SELECT COALESCE(MAX(job_event.event_seq), 0) + 1 INTO next_sequence
  FROM luna.job_events job_event
  WHERE job_event.workspace_id = selected_job.workspace_id
    AND job_event.project_id = selected_job.project_id
    AND job_event.job_id = selected_job.id;
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

ALTER FUNCTION luna.claim_next_job(uuid, integer) OWNER TO novel_acl_owner;

REVOKE ALL ON FUNCTION luna.claim_next_job(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION luna.claim_next_job(uuid, integer) TO novel_worker;

COMMIT;
