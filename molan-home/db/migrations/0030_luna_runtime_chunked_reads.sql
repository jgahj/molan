BEGIN;

-- 分块读取只服务于启动时的派生兼容缓存，不改变 PostgreSQL 权威数据。
CREATE OR REPLACE FUNCTION luna.runtime_dissections_page(
  after_updated bigint,
  after_id text,
  page_size integer
)
RETURNS SETOF luna.runtime_dissections
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
  SELECT d.*
  FROM luna.runtime_dissections d
  WHERE after_updated IS NULL
     OR d.updated_at_value < after_updated
     OR (d.updated_at_value = after_updated AND d.id > coalesce(after_id, ''))
  ORDER BY d.updated_at_value DESC, d.id ASC
  LIMIT greatest(1, least(20, coalesce(page_size, 2)))
$$;

CREATE OR REPLACE FUNCTION luna.runtime_dissection_rows_page(
  after_owner uuid,
  after_source text,
  after_row text,
  page_size integer
)
RETURNS SETOF luna.runtime_dissection_rows
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = luna, pg_catalog
AS $$
  SELECT r.*
  FROM luna.runtime_dissection_rows r
  WHERE r.deleted_at IS NULL
    AND (
      after_owner IS NULL
      OR r.owner_actor_id > after_owner
      OR (r.owner_actor_id = after_owner AND r.source_table > coalesce(after_source, ''))
      OR (r.owner_actor_id = after_owner
          AND r.source_table = coalesce(after_source, '')
          AND r.row_key > coalesce(after_row, ''))
    )
  ORDER BY r.owner_actor_id, r.source_table, r.row_key
  LIMIT greatest(50, least(2000, coalesce(page_size, 512)))
$$;

ALTER FUNCTION luna.runtime_dissections_page(bigint, text, integer) OWNER TO novel_acl_owner;
ALTER FUNCTION luna.runtime_dissection_rows_page(uuid, text, text, integer) OWNER TO novel_acl_owner;
REVOKE ALL ON FUNCTION luna.runtime_dissections_page(bigint, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION luna.runtime_dissection_rows_page(uuid, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION luna.runtime_dissections_page(bigint, text, integer) TO novel_app;
GRANT EXECUTE ON FUNCTION luna.runtime_dissection_rows_page(uuid, text, text, integer) TO novel_app;

COMMIT;
