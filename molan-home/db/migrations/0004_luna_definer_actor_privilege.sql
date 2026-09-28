BEGIN;

GRANT EXECUTE ON FUNCTION luna.actor_id() TO novel_acl_owner;

COMMIT;
