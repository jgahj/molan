BEGIN;
CREATE TABLE IF NOT EXISTS luna.runtime_admin_audit (
  id text PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES luna.users(id),
  admin_email text NOT NULL,
  action text NOT NULL,
  target text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_value bigint NOT NULL
);
ALTER TABLE luna.runtime_admin_audit OWNER TO novel_acl_owner;
ALTER TABLE luna.runtime_admin_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE luna.runtime_admin_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY luna_runtime_admin_audit_read ON luna.runtime_admin_audit
  FOR SELECT TO novel_app USING (luna.runtime_is_admin());
CREATE POLICY luna_runtime_admin_audit_write ON luna.runtime_admin_audit
  FOR INSERT TO novel_app WITH CHECK (actor_id = luna.actor_id() AND luna.runtime_is_admin());
GRANT SELECT, INSERT ON luna.runtime_admin_audit TO novel_app;
CREATE INDEX luna_runtime_admin_audit_time_idx ON luna.runtime_admin_audit (created_at_value DESC, id);
COMMIT;
