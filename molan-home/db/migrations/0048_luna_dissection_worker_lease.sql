BEGIN;
ALTER TABLE luna.runtime_dissections
  ADD COLUMN worker_id text NOT NULL DEFAULT '',
  ADD COLUMN worker_fence bigint NOT NULL DEFAULT 0,
  ADD COLUMN worker_lease_until timestamptz;

CREATE OR REPLACE FUNCTION luna.enforce_dissection_worker_fence()
RETURNS trigger LANGUAGE plpgsql SET search_path = luna, pg_catalog AS $$
DECLARE
  parent luna.runtime_dissections;
  target_id text;
  context_id text := current_setting('app.dissection_id', true);
  context_worker text := current_setting('app.dissection_worker', true);
  context_fence text := current_setting('app.dissection_fence', true);
BEGIN
  IF TG_TABLE_NAME = 'runtime_dissections' THEN
    target_id := OLD.id;
    parent := OLD;
    IF COALESCE(context_id, '') <> target_id THEN RETURN NEW; END IF;
  ELSE
    target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.dissection_id ELSE NEW.dissection_id END;
    IF COALESCE(target_id, '') = '' THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END IF;
    IF (CASE WHEN TG_OP = 'DELETE' THEN OLD.source_table ELSE NEW.source_table END)
      IN ('dissection_shares', 'dissection_versions', 'token_usage', 'model_usage', 'admin_audit') THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END IF;
    SELECT * INTO parent FROM luna.runtime_dissections WHERE id = target_id FOR UPDATE;
    IF parent.worker_id = '' AND COALESCE(context_id, '') <> target_id THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END IF;
  END IF;
  IF COALESCE(context_id, '') <> target_id OR COALESCE(context_worker, '') = ''
     OR parent.worker_id <> context_worker
     OR parent.worker_fence::text <> COALESCE(context_fence, '')
     OR parent.worker_lease_until IS NULL OR parent.worker_lease_until <= clock_timestamp() THEN
    RAISE EXCEPTION 'Dissection worker lease lost' USING ERRCODE = '40001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER luna_dissection_worker_parent_fence
  BEFORE UPDATE ON luna.runtime_dissections
  FOR EACH ROW EXECUTE FUNCTION luna.enforce_dissection_worker_fence();
CREATE TRIGGER luna_dissection_worker_child_fence
  BEFORE INSERT OR UPDATE OR DELETE ON luna.runtime_dissection_rows
  FOR EACH ROW EXECUTE FUNCTION luna.enforce_dissection_worker_fence();

CREATE OR REPLACE FUNCTION luna.recover_expired_dissection_workers()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = luna, pg_catalog AS $$
DECLARE recovered integer;
BEGIN
  UPDATE luna.runtime_dissections
  SET status = 'interrupted', error = '服务中断；请确认后继续，不会自动重发未知模型请求',
      worker_id = '', worker_lease_until = NULL, worker_fence = worker_fence + 1,
      revision = revision + 1, updated_at = now()
  WHERE status IN ('running', 'queued') AND cancel_requested = false
    AND ((worker_lease_until IS NOT NULL AND worker_lease_until <= clock_timestamp())
      OR (worker_id = '' AND updated_at < clock_timestamp() - interval '5 minutes'));
  GET DIAGNOSTICS recovered = ROW_COUNT;
  RETURN recovered;
END;
$$;
ALTER FUNCTION luna.recover_expired_dissection_workers() OWNER TO novel_acl_owner;
REVOKE ALL ON FUNCTION luna.recover_expired_dissection_workers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION luna.recover_expired_dissection_workers() TO novel_app;
COMMIT;
