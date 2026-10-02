BEGIN;

CREATE OR REPLACE FUNCTION luna.download_open_skill(target_id text)
RETURNS SETOF luna.runtime_open_skills
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
BEGIN
  IF luna.actor_id() IS NULL OR NOT EXISTS (
    SELECT 1 FROM luna.runtime_accounts WHERE id = luna.actor_id()
  ) THEN
    RAISE EXCEPTION 'Authenticated account required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    UPDATE luna.runtime_open_skills
    SET downloads = downloads + 1, updated_at = now()
    WHERE id = target_id
      AND (status = 'published' OR owner_user_id = luna.actor_id() OR luna.runtime_is_admin())
    RETURNING *;
END;
$$;

ALTER FUNCTION luna.download_open_skill(text) OWNER TO novel_acl_owner;
REVOKE ALL ON FUNCTION luna.download_open_skill(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION luna.download_open_skill(text) TO novel_app;

COMMIT;
