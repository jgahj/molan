BEGIN;

CREATE OR REPLACE FUNCTION luna.finish_creation_core_job(
  target_worker uuid,
  target_workspace uuid,
  target_project uuid,
  target_job uuid,
  target_attempt integer,
  target_fencing bigint,
  target_book uuid,
  target_book_legacy text,
  target_bible_legacy text,
  target_bible jsonb,
  target_bible_hash text
)
RETURNS TABLE(finished boolean, bible_revision bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
DECLARE
  current_job luna.jobs%ROWTYPE;
  current_book luna.creation_books%ROWTYPE;
  latest_revision bigint;
  next_revision bigint;
  next_event bigint;
  result_payload jsonb;
  event_id uuid;
BEGIN
  SELECT j.* INTO current_job
  FROM luna.jobs j
  WHERE j.workspace_id = target_workspace
    AND j.project_id = target_project
    AND j.id = target_job
  FOR UPDATE;
  IF NOT FOUND THEN
    finished := false;
    bible_revision := 0;
    RETURN NEXT;
    RETURN;
  END IF;
  IF current_job.state = 'succeeded' THEN
    SELECT COALESCE(MAX(cb.revision), 0) INTO latest_revision
    FROM luna.creation_bibles cb
    WHERE cb.workspace_id = target_workspace
      AND cb.project_id = target_project
      AND cb.book_id = target_book;
    finished := true;
    bible_revision := latest_revision;
    RETURN NEXT;
    RETURN;
  END IF;
  IF current_job.state NOT IN ('claimed', 'running', 'cancel_requested')
    OR current_job.attempt_no <> target_attempt
    OR current_job.fencing_token <> target_fencing
    OR current_job.lease_owner <> target_worker
    OR current_job.lease_until <= now() THEN
    finished := false;
    bible_revision := 0;
    RETURN NEXT;
    RETURN;
  END IF;
  IF current_job.state = 'cancel_requested' THEN
    UPDATE luna.jobs
    SET state = 'cancelled',
        lease_owner = NULL,
        lease_until = NULL,
        revision = revision + 1,
        updated_at = now()
    WHERE workspace_id = target_workspace
      AND project_id = target_project
      AND id = target_job;
    SELECT COALESCE(MAX(event_seq), 0) + 1 INTO next_event
    FROM luna.job_events
    WHERE workspace_id = target_workspace
      AND project_id = target_project
      AND job_id = target_job;
    INSERT INTO luna.job_events(workspace_id, project_id, job_id, event_seq, state, payload)
    VALUES (
      target_workspace, target_project, target_job, next_event, 'cancelled',
      jsonb_build_object('source', 'creation-core-worker', 'fencingToken', target_fencing)
    );
    finished := true;
    bible_revision := 0;
    RETURN NEXT;
    RETURN;
  END IF;
  IF target_bible IS NULL OR target_bible_hash IS NULL
    OR target_bible_hash !~ '^[0-9a-f]{64}$' THEN
    finished := false;
    bible_revision := 0;
    RETURN NEXT;
    RETURN;
  END IF;
  SELECT cb.* INTO current_book
  FROM luna.creation_books cb
  WHERE cb.workspace_id = target_workspace
    AND cb.project_id = target_project
    AND cb.id = target_book
    AND cb.legacy_id = target_book_legacy
    AND cb.owner_user_id = current_job.requested_by
  FOR UPDATE;
  IF NOT FOUND THEN
    finished := false;
    bible_revision := 0;
    RETURN NEXT;
    RETURN;
  END IF;
  SELECT COALESCE(MAX(cb.revision), 0) INTO latest_revision
  FROM luna.creation_bibles cb
  WHERE cb.workspace_id = target_workspace
    AND cb.project_id = target_project
    AND cb.book_id = target_book;
  IF latest_revision > 0 THEN
    UPDATE luna.jobs
    SET state = 'succeeded',
        result = jsonb_build_object('bookId', target_book_legacy, 'bibleVersion', latest_revision, 'idempotent', true),
        lease_owner = NULL,
        lease_until = NULL,
        revision = revision + 1,
        updated_at = now()
    WHERE workspace_id = target_workspace
      AND project_id = target_project
      AND id = target_job;
    finished := true;
    bible_revision := latest_revision;
    RETURN NEXT;
    RETURN;
  END IF;
  next_revision := 1;
  INSERT INTO luna.creation_bibles
    (workspace_id, project_id, book_id, legacy_id, revision, payload, payload_hash, changed_by)
  VALUES (
    target_workspace, target_project, target_book, COALESCE(NULLIF(target_bible_legacy, ''), 'bible_' || target_book_legacy),
    next_revision, target_bible, target_bible_hash, current_job.requested_by
  );
  UPDATE luna.creation_books
  SET status = 'ready',
      revision = revision + 1,
      updated_at = now()
  WHERE workspace_id = target_workspace
    AND project_id = target_project
    AND id = target_book;
  result_payload := jsonb_build_object('bookId', target_book_legacy, 'bibleVersion', next_revision, 'source', 'local-stub');
  UPDATE luna.jobs
  SET state = 'succeeded',
      result = result_payload,
      lease_owner = NULL,
      lease_until = NULL,
      revision = revision + 1,
      updated_at = now()
  WHERE workspace_id = target_workspace
    AND project_id = target_project
    AND id = target_job;
  SELECT COALESCE(MAX(event_seq), 0) + 1 INTO next_event
  FROM luna.job_events
  WHERE workspace_id = target_workspace
    AND project_id = target_project
    AND job_id = target_job;
  INSERT INTO luna.job_events(workspace_id, project_id, job_id, event_seq, state, payload)
  VALUES (
    target_workspace, target_project, target_job, next_event, 'succeeded',
    jsonb_build_object('source', 'creation-core-worker', 'bibleVersion', next_revision, 'fencingToken', target_fencing)
  );
  event_id := md5(target_job::text || ':' || current_job.revision::text || ':creation-core')::uuid;
  INSERT INTO luna.outbox(
    workspace_id, project_id, id, aggregate_type, aggregate_id, aggregate_revision,
    event_seq, event_type, payload, job_id
  )
  VALUES (
    target_workspace, target_project, event_id, 'job', target_job, current_job.revision + 1,
    next_event, 'job.succeeded', result_payload, target_job
  )
  ON CONFLICT (workspace_id, project_id, aggregate_type, aggregate_id, aggregate_revision, event_seq) DO NOTHING;
  finished := true;
  bible_revision := next_revision;
  RETURN NEXT;
END
$$;

ALTER FUNCTION luna.finish_creation_core_job(uuid, uuid, uuid, uuid, integer, bigint, uuid, text, text, jsonb, text)
  OWNER TO novel_acl_owner;
REVOKE ALL ON FUNCTION luna.finish_creation_core_job(uuid, uuid, uuid, uuid, integer, bigint, uuid, text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION luna.finish_creation_core_job(uuid, uuid, uuid, uuid, integer, bigint, uuid, text, text, jsonb, text) TO novel_worker;

COMMIT;
