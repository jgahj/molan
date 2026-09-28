BEGIN;

ALTER TABLE luna.users OWNER TO novel_acl_owner;
ALTER TABLE luna.auth_sessions OWNER TO novel_acl_owner;

COMMIT;
