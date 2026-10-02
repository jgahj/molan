BEGIN;

CREATE OR REPLACE FUNCTION luna.request_auth_session(target_token_hash text)
RETURNS TABLE(token_hash text, user_id uuid, legacy_id text, scope text, expires_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
  SELECT auth_session.token_hash, auth_session.user_id, app_user.legacy_id,
         auth_session.scope, auth_session.expires_at
  FROM luna.auth_sessions auth_session
  JOIN luna.users app_user ON app_user.id = auth_session.user_id
  WHERE auth_session.token_hash = target_token_hash
    AND target_token_hash ~ '^[0-9a-f]{64}$'
    AND auth_session.revoked_at IS NULL
    AND auth_session.expires_at > now()
$$;

ALTER FUNCTION luna.request_auth_session(text) OWNER TO novel_acl_owner;
REVOKE ALL ON FUNCTION luna.request_auth_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION luna.request_auth_session(text) TO novel_app;

COMMIT;
