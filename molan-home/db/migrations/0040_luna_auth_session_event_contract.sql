BEGIN;

CREATE OR REPLACE FUNCTION luna.create_auth_session(
  target_session uuid,
  target_user uuid,
  target_legacy_id text,
  target_token_hash text,
  target_scope text,
  target_expires_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
DECLARE
  stable_user_id text;
BEGIN
  IF target_user IS NULL
    OR target_token_hash IS NULL
    OR target_token_hash !~ '^[0-9a-f]{64}$'
    OR target_scope IS NULL
    OR target_scope NOT IN ('client', 'admin')
    OR target_expires_at IS NULL
    OR target_expires_at <= now()
    OR target_legacy_id IS NULL
    OR length(btrim(target_legacy_id)) = 0 THEN
    RAISE EXCEPTION 'auth session input is invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO luna.users(id, legacy_id)
  VALUES (target_user, btrim(target_legacy_id))
  ON CONFLICT (id) DO UPDATE
    SET legacy_id = COALESCE(luna.users.legacy_id, excluded.legacy_id);

  SELECT legacy_id INTO stable_user_id FROM luna.users WHERE id = target_user;
  INSERT INTO luna.auth_sessions(id, user_id, token_hash, scope, expires_at, revoked_at)
  VALUES (target_session, target_user, lower(target_token_hash), target_scope, target_expires_at, NULL);

  PERFORM pg_notify(
    'molan_auth_session',
    json_build_object(
      'event', 'created',
      'userId', stable_user_id,
      'sessionId', target_session,
      'tokenHash', lower(target_token_hash),
      'scope', target_scope,
      'reason', 'created',
      'revokedAt', NULL,
      'expiresAt', extract(epoch FROM target_expires_at) * 1000
    )::text
  );
END
$$;

CREATE OR REPLACE FUNCTION luna.revoke_auth_session(target_token_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
DECLARE
  revoked_session luna.auth_sessions%ROWTYPE;
  stable_user_id text;
BEGIN
  UPDATE luna.auth_sessions
  SET revoked_at = now()
  WHERE token_hash = lower(target_token_hash)
    AND revoked_at IS NULL
  RETURNING * INTO revoked_session;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT legacy_id INTO stable_user_id FROM luna.users WHERE id = revoked_session.user_id;
  PERFORM pg_notify(
    'molan_auth_session',
    json_build_object(
      'event', 'revoked',
      'userId', stable_user_id,
      'sessionId', revoked_session.id,
      'tokenHash', revoked_session.token_hash,
      'scope', revoked_session.scope,
      'reason', 'logout',
      'revokedAt', extract(epoch FROM revoked_session.revoked_at) * 1000
    )::text
  );
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION luna.revoke_auth_sessions(target_user uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
DECLARE
  affected integer;
  stable_user_id text;
  v_revoked_at timestamptz := now();
BEGIN
  SELECT legacy_id INTO stable_user_id FROM luna.users WHERE id = target_user;
  UPDATE luna.auth_sessions
  SET revoked_at = v_revoked_at
  WHERE user_id = target_user
    AND revoked_at IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN
    PERFORM pg_notify(
      'molan_auth_session',
      json_build_object(
        'event', 'user_revoked',
        'userId', stable_user_id,
        'sessionId', NULL,
        'tokenHash', NULL,
        'scope', NULL,
        'reason', 'logout_all',
        'revokedAt', extract(epoch FROM v_revoked_at) * 1000
      )::text
    );
  END IF;
  RETURN affected;
END
$$;

ALTER FUNCTION luna.create_auth_session(uuid, uuid, text, text, text, timestamptz) OWNER TO novel_acl_owner;
ALTER FUNCTION luna.revoke_auth_session(text) OWNER TO novel_acl_owner;
ALTER FUNCTION luna.revoke_auth_sessions(uuid) OWNER TO novel_acl_owner;

REVOKE ALL ON FUNCTION luna.create_auth_session(uuid, uuid, text, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.revoke_auth_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.revoke_auth_sessions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION luna.create_auth_session(uuid, uuid, text, text, text, timestamptz) TO novel_app;
GRANT EXECUTE ON FUNCTION luna.revoke_auth_session(text) TO novel_app;
GRANT EXECUTE ON FUNCTION luna.revoke_auth_sessions(uuid) TO novel_app;

COMMIT;
