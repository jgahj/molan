BEGIN;

CREATE TABLE IF NOT EXISTS luna.job_inputs (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL REFERENCES luna.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, job_id),
  FOREIGN KEY (workspace_id, project_id, job_id)
    REFERENCES luna.jobs(workspace_id, project_id, id)
);

ALTER TABLE luna.job_inputs OWNER TO novel_acl_owner;
ALTER TABLE luna.job_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE luna.job_inputs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS luna_scope_job_inputs ON luna.job_inputs;
CREATE POLICY luna_scope_job_inputs ON luna.job_inputs
  FOR ALL TO novel_app
  USING (luna.can_project(workspace_id, project_id))
  WITH CHECK (luna.can_project(workspace_id, project_id));

GRANT SELECT, INSERT ON luna.job_inputs TO novel_app;

CREATE OR REPLACE FUNCTION luna.read_job_input(
  target_worker uuid,
  target_workspace uuid,
  target_project uuid,
  target_job uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
  SELECT ji.payload
  FROM luna.job_inputs ji
  JOIN luna.jobs j
    ON j.workspace_id = ji.workspace_id
   AND j.project_id = ji.project_id
   AND j.id = ji.job_id
  WHERE ji.workspace_id = target_workspace
    AND ji.project_id = target_project
    AND ji.job_id = target_job
    AND j.lease_owner = target_worker
    AND j.state IN ('claimed', 'running')
    AND j.lease_until > now()
  LIMIT 1
$$;

ALTER FUNCTION luna.read_job_input(uuid, uuid, uuid, uuid) OWNER TO novel_acl_owner;
REVOKE ALL ON FUNCTION luna.read_job_input(uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION luna.read_job_input(uuid, uuid, uuid, uuid) TO novel_worker;

COMMIT;
