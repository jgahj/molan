BEGIN;

ALTER TABLE luna.auth_sessions
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'client';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'luna.auth_sessions'::regclass
      AND conname = 'auth_sessions_scope_check'
  ) THEN
    ALTER TABLE luna.auth_sessions
      ADD CONSTRAINT auth_sessions_scope_check
      CHECK (scope IN ('client', 'admin'));
  END IF;
END
$$;

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
BEGIN
  IF target_user IS NULL
    OR target_token_hash IS NULL
    OR target_token_hash !~ '^[0-9a-f]{64}$'
    OR target_scope NOT IN ('client', 'admin')
    OR target_expires_at <= now()
    OR target_legacy_id IS NULL
    OR length(btrim(target_legacy_id)) = 0 THEN
    RAISE EXCEPTION 'auth session input is invalid' USING ERRCODE = '22023';
  END IF;
  INSERT INTO luna.users(id, legacy_id)
  VALUES (target_user, btrim(target_legacy_id))
  ON CONFLICT (id) DO UPDATE
    SET legacy_id = COALESCE(luna.users.legacy_id, excluded.legacy_id);
  INSERT INTO luna.auth_sessions(id, user_id, token_hash, scope, expires_at, revoked_at)
  VALUES (target_session, target_user, lower(target_token_hash), target_scope, target_expires_at, NULL);
  PERFORM pg_notify(
    'molan_auth_session',
    json_build_object(
      'event', 'created',
      'tokenHash', lower(target_token_hash),
      'userId', target_user,
      'legacyId', btrim(target_legacy_id),
      'scope', target_scope,
      'expiresAt', extract(epoch FROM target_expires_at) * 1000
    )::text
  );
END
$$;

CREATE OR REPLACE FUNCTION luna.list_auth_sessions()
RETURNS TABLE(token_hash text, user_id uuid, legacy_id text, scope text, expires_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
  SELECT auth_session.token_hash, auth_session.user_id, app_user.legacy_id,
         auth_session.scope, auth_session.expires_at
  FROM luna.auth_sessions auth_session
  JOIN luna.users app_user ON app_user.id = auth_session.user_id
  WHERE auth_session.revoked_at IS NULL
    AND auth_session.expires_at > now()
$$;

CREATE OR REPLACE FUNCTION luna.revoke_auth_session(target_token_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE luna.auth_sessions
  SET revoked_at = now()
  WHERE token_hash = lower(target_token_hash)
    AND revoked_at IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected = 1 THEN
    PERFORM pg_notify('molan_auth_session', json_build_object('event', 'revoked', 'tokenHash', lower(target_token_hash))::text);
  END IF;
  RETURN affected = 1;
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
BEGIN
  UPDATE luna.auth_sessions
  SET revoked_at = now()
  WHERE user_id = target_user
    AND revoked_at IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN
    PERFORM pg_notify('molan_auth_session', json_build_object('event', 'user_revoked', 'userId', target_user)::text);
  END IF;
  RETURN affected;
END
$$;

ALTER FUNCTION luna.create_auth_session(uuid, uuid, text, text, text, timestamptz) OWNER TO novel_acl_owner;
ALTER FUNCTION luna.list_auth_sessions() OWNER TO novel_acl_owner;
ALTER FUNCTION luna.revoke_auth_session(text) OWNER TO novel_acl_owner;
ALTER FUNCTION luna.revoke_auth_sessions(uuid) OWNER TO novel_acl_owner;

REVOKE ALL ON FUNCTION luna.create_auth_session(uuid, uuid, text, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.list_auth_sessions() FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.revoke_auth_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.revoke_auth_sessions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION luna.create_auth_session(uuid, uuid, text, text, text, timestamptz) TO novel_app;
GRANT EXECUTE ON FUNCTION luna.list_auth_sessions() TO novel_app;
GRANT EXECUTE ON FUNCTION luna.revoke_auth_session(text) TO novel_app;
GRANT EXECUTE ON FUNCTION luna.revoke_auth_sessions(uuid) TO novel_app;

COMMIT;
