BEGIN;

CREATE TABLE luna.lab_jobs (
  owner_id uuid NOT NULL REFERENCES luna.users(id) ON DELETE RESTRICT,
  owner_legacy_id text NOT NULL CHECK (length(owner_legacy_id) BETWEEN 1 AND 256),
  job_kind text NOT NULL CHECK (job_kind IN ('reading', 'blind')),
  job_id text NOT NULL CHECK (length(job_id) BETWEEN 1 AND 256),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, job_kind, job_id),
  CHECK (payload->>'owner' = owner_legacy_id AND payload->>'id' = job_id)
);
CREATE INDEX lab_jobs_recent_idx ON luna.lab_jobs(owner_id, job_kind, updated_at DESC);
CREATE TABLE luna.lab_reference_votes (
  owner_id uuid NOT NULL REFERENCES luna.users(id) ON DELETE RESTRICT,
  scene_id text NOT NULL CHECK (length(scene_id) BETWEEN 1 AND 256),
  scores jsonb NOT NULL CHECK (jsonb_typeof(scores) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, scene_id)
);

ALTER TABLE luna.lab_jobs OWNER TO novel_acl_owner;
ALTER TABLE luna.lab_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE luna.lab_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY lab_jobs_owner ON luna.lab_jobs FOR ALL TO novel_app
  USING (owner_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (owner_id = nullif(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY lab_jobs_recovery ON luna.lab_jobs FOR SELECT TO novel_worker USING (true);
CREATE POLICY lab_jobs_recovery_update ON luna.lab_jobs FOR UPDATE TO novel_worker USING (true) WITH CHECK (true);

ALTER TABLE luna.lab_reference_votes OWNER TO novel_acl_owner;
ALTER TABLE luna.lab_reference_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE luna.lab_reference_votes FORCE ROW LEVEL SECURITY;
CREATE POLICY lab_reference_votes_owner_read ON luna.lab_reference_votes FOR SELECT TO novel_app
  USING (owner_id = nullif(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY lab_reference_votes_owner_insert ON luna.lab_reference_votes FOR INSERT TO novel_app
  WITH CHECK (owner_id = nullif(current_setting('app.user_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON luna.lab_jobs TO novel_app;
GRANT SELECT, UPDATE ON luna.lab_jobs TO novel_worker;
GRANT SELECT, INSERT ON luna.lab_reference_votes TO novel_app;

COMMIT;
