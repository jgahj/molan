BEGIN;

-- Finalize a job's reservation while the worker still owns the same
-- transaction.  A provider-unknown result deliberately leaves the
-- reservation untouched in the unknown state for manual reconciliation.
CREATE OR REPLACE FUNCTION luna.finalize_job_budget(
  target_workspace uuid,
  target_project uuid,
  target_job uuid,
  target_state text,
  target_actual_minor bigint DEFAULT 0,
  target_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
DECLARE
  reservation luna.budget_reservations%ROWTYPE;
  budget_limit bigint;
  used_minor bigint := 0;
  reserved_minor bigint := 0;
  actual_minor bigint := greatest(0, coalesce(target_actual_minor, 0));
  period_value date;
  ledger_metadata jsonb := coalesce(target_metadata, '{}'::jsonb);
BEGIN
  SELECT br.* INTO reservation
  FROM luna.budget_reservations br
  WHERE br.workspace_id = target_workspace
    AND br.project_id = target_project
    AND br.job_id = target_job
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'none';
  END IF;

  IF reservation.state IN ('settled', 'released') THEN
    RETURN reservation.state;
  END IF;
  IF target_state = 'provider_unknown' OR reservation.state = 'unknown' THEN
    IF reservation.state <> 'unknown' THEN
      UPDATE luna.budget_reservations
      SET state = 'unknown', updated_at = now()
      WHERE workspace_id = target_workspace
        AND project_id = target_project
        AND id = reservation.id;
    END IF;
    RETURN 'unknown';
  END IF;
  IF target_state IN ('failed', 'cancelled') THEN
    UPDATE luna.budget_reservations
    SET state = 'released', updated_at = now()
    WHERE workspace_id = target_workspace
      AND project_id = target_project
      AND id = reservation.id;
    INSERT INTO luna.billing_ledger
      (workspace_id, project_id, id, reservation_id, amount_minor, entry_type, metadata)
    VALUES (
      target_workspace, target_project,
      md5('ledger:release:' || reservation.id::text)::uuid,
      reservation.id, reservation.amount_minor, 'release',
      ledger_metadata || jsonb_build_object('jobId', target_job, 'state', target_state)
    )
    ON CONFLICT DO NOTHING;
    RETURN 'released';
  END IF;
  IF target_state <> 'succeeded' THEN
    RETURN reservation.state;
  END IF;

  period_value := coalesce(reservation.period_start, current_date);
  SELECT b.limit_minor INTO budget_limit
  FROM luna.budgets b
  WHERE b.workspace_id = target_workspace
    AND b.project_id = target_project
    AND b.period_start = period_value
  FOR UPDATE;
  IF budget_limit IS NOT NULL THEN
    SELECT coalesce(sum(bl.amount_minor), 0)::bigint INTO used_minor
    FROM luna.billing_ledger bl
    JOIN luna.budget_reservations charged
      ON charged.workspace_id = bl.workspace_id
     AND charged.project_id = bl.project_id
     AND charged.id = bl.reservation_id
    WHERE bl.workspace_id = target_workspace
      AND bl.project_id = target_project
      AND bl.entry_type = 'charge'
      AND charged.period_start = period_value;
    SELECT coalesce(sum(br.amount_minor), 0)::bigint INTO reserved_minor
    FROM luna.budget_reservations br
    WHERE br.workspace_id = target_workspace
      AND br.project_id = target_project
      AND br.state = 'reserved'
      AND br.id <> reservation.id
      AND br.period_start = period_value;
    -- The actual provider charge is authoritative.  If the estimate was
    -- insufficient for the remaining budget, keep the result unknown rather
    -- than silently undercharging or releasing money that may be owed.
    IF used_minor + reserved_minor + actual_minor > budget_limit THEN
      UPDATE luna.budget_reservations
      SET state = 'unknown', updated_at = now()
      WHERE workspace_id = target_workspace
        AND project_id = target_project
        AND id = reservation.id;
      RETURN 'unknown';
    END IF;
  END IF;

  UPDATE luna.budget_reservations
  SET state = 'settled', updated_at = now()
  WHERE workspace_id = target_workspace
    AND project_id = target_project
    AND id = reservation.id;
  INSERT INTO luna.billing_ledger
    (workspace_id, project_id, id, reservation_id, amount_minor, entry_type, metadata)
  VALUES (
    target_workspace, target_project,
    md5('ledger:charge:' || reservation.id::text)::uuid,
    reservation.id, actual_minor, 'charge',
    ledger_metadata || jsonb_build_object('jobId', target_job)
  )
  ON CONFLICT DO NOTHING;
  IF reservation.amount_minor > actual_minor THEN
    INSERT INTO luna.billing_ledger
      (workspace_id, project_id, id, reservation_id, amount_minor, entry_type, metadata)
    VALUES (
      target_workspace, target_project,
      md5('ledger:release:' || reservation.id::text)::uuid,
      reservation.id, reservation.amount_minor - actual_minor, 'release',
      ledger_metadata || jsonb_build_object('jobId', target_job)
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN 'settled';
END
$$;

ALTER FUNCTION luna.finalize_job_budget(uuid, uuid, uuid, text, bigint, jsonb)
  OWNER TO novel_acl_owner;
REVOKE ALL ON FUNCTION luna.finalize_job_budget(uuid, uuid, uuid, text, bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION luna.finalize_job_budget(uuid, uuid, uuid, text, bigint, jsonb) TO novel_worker;

-- Worker terminal writes and billing finalization must be one atomic action.
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
  billing_state text;
  effective_state text := next_state;
  effective_error text := coalesce(next_error_code, '');
BEGIN
  IF next_state NOT IN ('succeeded', 'failed', 'cancelled', 'provider_unknown') THEN
    RAISE EXCEPTION 'worker terminal state is invalid' USING ERRCODE = '22023';
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
    target_workspace, target_project, target_job, next_state, 0,
    jsonb_build_object('worker', target_worker)
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
    jsonb_build_object('worker', target_worker, 'fencingToken', target_fencing,
      'errorCode', effective_error, 'billingState', billing_state)
  );
  event_id := md5(target_job::text || ':' || current_job.revision::text || ':' || effective_state)::uuid;
  INSERT INTO luna.outbox(
    workspace_id, project_id, id, aggregate_type, aggregate_id, aggregate_revision,
    event_seq, event_type, payload, job_id
  )
  VALUES (
    target_workspace, target_project, event_id, 'job', target_job, current_job.revision,
    next_sequence, 'job.' || effective_state,
    jsonb_build_object('jobId', target_job, 'state', effective_state,
      'revision', current_job.revision, 'billingState', billing_state), target_job
  )
  ON CONFLICT (workspace_id, project_id, aggregate_type, aggregate_id, aggregate_revision, event_seq) DO NOTHING;
  RETURN true;
END
$$;

ALTER FUNCTION luna.finish_job(uuid, uuid, uuid, uuid, integer, bigint, text, jsonb, text)
  OWNER TO novel_acl_owner;
REVOKE ALL ON FUNCTION luna.finish_job(uuid, uuid, uuid, uuid, integer, bigint, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION luna.finish_job(uuid, uuid, uuid, uuid, integer, bigint, text, jsonb, text) TO novel_worker;

-- Creation-core success writes the Bible and settles its reservation in the
-- same worker transaction.  The legacy function remains the single source of
-- truth for Bible/CAS writes; this wrapper adds billing and idempotent cost.
CREATE OR REPLACE FUNCTION luna.finish_creation_core_job_v2(
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
  target_bible_hash text,
  target_cost_minor bigint DEFAULT 0
)
RETURNS TABLE(finished boolean, bible_revision bigint, billing_state text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
DECLARE
  completed record;
  job_state text;
  reservation_state text;
  finalized_state text;
  next_sequence bigint;
BEGIN
  SELECT * INTO completed
  FROM luna.finish_creation_core_job(
    target_worker, target_workspace, target_project, target_job,
    target_attempt, target_fencing, target_book, target_book_legacy,
    target_bible_legacy, target_bible, target_bible_hash
  );
  IF NOT coalesce(completed.finished, false) THEN
    finished := false;
    bible_revision := coalesce(completed.bible_revision, 0);
    billing_state := 'none';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT state INTO job_state
  FROM luna.jobs
  WHERE workspace_id = target_workspace AND project_id = target_project AND id = target_job;
  SELECT state INTO reservation_state
  FROM luna.budget_reservations
  WHERE workspace_id = target_workspace AND project_id = target_project AND job_id = target_job
  FOR UPDATE;
  IF job_state = 'succeeded' THEN
    finalized_state := luna.finalize_job_budget(
      target_workspace, target_project, target_job, 'succeeded',
      greatest(0, coalesce(target_cost_minor, 0)),
      jsonb_build_object('source', 'creation-core-worker')
    );
    IF finalized_state = 'settled' AND reservation_state = 'reserved' THEN
      UPDATE luna.creation_books
      SET spent_cost = spent_cost + greatest(0, coalesce(target_cost_minor, 0))::numeric / 100,
          updated_at = now()
      WHERE workspace_id = target_workspace AND project_id = target_project AND id = target_book;
    END IF;
    IF finalized_state = 'unknown' THEN
      UPDATE luna.jobs
      SET state = 'provider_unknown', error_code = 'budget_reconciliation_required',
          revision = revision + 1, updated_at = now()
      WHERE workspace_id = target_workspace AND project_id = target_project AND id = target_job;
      SELECT coalesce(max(event_seq), 0) + 1 INTO next_sequence
      FROM luna.job_events
      WHERE workspace_id = target_workspace AND project_id = target_project AND job_id = target_job;
      INSERT INTO luna.job_events(workspace_id, project_id, job_id, event_seq, state, payload)
      VALUES (target_workspace, target_project, target_job, next_sequence, 'provider_unknown',
        jsonb_build_object('source', 'creation-core-worker', 'reason', 'budget_reconciliation_required'));
      finished := false;
    ELSE
      finished := true;
    END IF;
  ELSIF job_state = 'cancelled' THEN
    finalized_state := luna.finalize_job_budget(
      target_workspace, target_project, target_job, 'cancelled', 0,
      jsonb_build_object('source', 'creation-core-worker')
    );
    finished := true;
  ELSE
    finalized_state := 'none';
    finished := true;
  END IF;
  bible_revision := coalesce(completed.bible_revision, 0);
  billing_state := coalesce(finalized_state, 'none');
  RETURN NEXT;
END
$$;

ALTER FUNCTION luna.finish_creation_core_job_v2(uuid, uuid, uuid, uuid, integer, bigint, uuid, text, text, jsonb, text, bigint)
  OWNER TO novel_acl_owner;
REVOKE ALL ON FUNCTION luna.finish_creation_core_job_v2(uuid, uuid, uuid, uuid, integer, bigint, uuid, text, text, jsonb, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION luna.finish_creation_core_job_v2(uuid, uuid, uuid, uuid, integer, bigint, uuid, text, text, jsonb, text, bigint) TO novel_worker;

-- Optional queue qualification keeps independent worker smoke/operations from
-- consuming an unrelated tenant's queued work.  An empty kind preserves the
-- existing global queue behavior for the normal worker daemon.
CREATE OR REPLACE FUNCTION luna.claim_next_job(
  target_worker uuid,
  lease_seconds integer DEFAULT 600,
  target_kind text DEFAULT ''
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
    AND (coalesce(target_kind, '') = '' OR queued_job.kind = target_kind)
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
  ON CONFLICT ON CONSTRAINT job_dispatch_pkey DO UPDATE
    SET claimed_by = excluded.claimed_by, claimed_at = excluded.claimed_at;
  SELECT coalesce(max(job_event.event_seq), 0) + 1 INTO next_sequence
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

ALTER FUNCTION luna.claim_next_job(uuid, integer, text) OWNER TO novel_acl_owner;
REVOKE ALL ON FUNCTION luna.claim_next_job(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION luna.claim_next_job(uuid, integer, text) TO novel_worker;

COMMIT;
