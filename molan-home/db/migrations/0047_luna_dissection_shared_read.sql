BEGIN;

CREATE OR REPLACE FUNCTION luna.read_dissection_share(target_token text)
RETURNS TABLE(access text, share jsonb, task jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = luna, pg_catalog
AS $$
DECLARE
  share_document jsonb;
  task_id text;
  owner_id uuid;
  actor_email text;
BEGIN
  IF target_token !~ '^[A-Za-z0-9_-]{16,128}$' THEN RETURN; END IF;
  SELECT row.document, row.dissection_id, row.owner_actor_id
    INTO share_document, task_id, owner_id
    FROM luna.runtime_dissection_rows row
    WHERE row.source_table = 'dissection_shares' AND row.row_key = target_token
      AND row.deleted_at IS NULL;
  IF share_document IS NULL THEN RETURN; END IF;
  IF COALESCE((share_document->>'expires_at')::bigint, 0) > 0
     AND (share_document->>'expires_at')::bigint <= floor(extract(epoch FROM clock_timestamp()) * 1000) THEN
    RETURN QUERY SELECT 'expired'::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;
  IF COALESCE(share_document->>'grantee_email', '') <> '' THEN
    SELECT lower(email) INTO actor_email FROM luna.runtime_accounts WHERE id = luna.actor_id();
    IF actor_email IS NULL THEN
      RETURN QUERY SELECT 'auth_required'::text, NULL::jsonb, NULL::jsonb;
      RETURN;
    END IF;
    IF actor_email <> lower(share_document->>'grantee_email') THEN
      RETURN QUERY SELECT 'forbidden'::text, NULL::jsonb, NULL::jsonb;
      RETURN;
    END IF;
  END IF;
  RETURN QUERY SELECT 'allowed'::text, share_document,
    jsonb_build_object('id', record.id, 'title', record.title, 'depth', record.depth,
      'result', record.result_json::jsonb,
      'meta', jsonb_build_object('wordCount', record.meta_json::jsonb->'wordCount',
        'chapterCount', record.meta_json::jsonb->'chapterCount', 'sampleCount', record.meta_json::jsonb->'sampleCount'),
      'createdAt', record.created_at_value, 'updatedAt', record.updated_at_value)
    FROM luna.runtime_dissections record WHERE record.id = task_id AND record.owner_actor_id = owner_id;
END;
$$;

CREATE OR REPLACE FUNCTION luna.list_member_dissection_shares()
RETURNS TABLE(share jsonb, task jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path = luna, pg_catalog
AS $$
  SELECT row.document,
    jsonb_build_object('id', record.id, 'title', record.title, 'depth', record.depth,
      'wordCount', record.meta_json::jsonb->'wordCount',
      'chapterCount', record.meta_json::jsonb->'chapterCount', 'updatedAt', record.updated_at_value)
  FROM luna.runtime_dissection_rows row
  JOIN luna.runtime_dissections record ON record.id = row.dissection_id AND record.owner_actor_id = row.owner_actor_id
  JOIN luna.runtime_accounts actor ON actor.id = luna.actor_id()
  WHERE row.source_table = 'dissection_shares' AND row.deleted_at IS NULL
    AND lower(row.document->>'grantee_email') = lower(actor.email)
    AND record.status = 'completed'
    AND (COALESCE((row.document->>'expires_at')::bigint, 0) = 0
      OR (row.document->>'expires_at')::bigint > floor(extract(epoch FROM clock_timestamp()) * 1000))
  ORDER BY (row.document->>'created_at')::bigint DESC LIMIT 100
$$;

ALTER FUNCTION luna.read_dissection_share(text) OWNER TO novel_acl_owner;
ALTER FUNCTION luna.list_member_dissection_shares() OWNER TO novel_acl_owner;
REVOKE ALL ON FUNCTION luna.read_dissection_share(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.list_member_dissection_shares() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION luna.read_dissection_share(text), luna.list_member_dissection_shares() TO novel_app;
COMMIT;
