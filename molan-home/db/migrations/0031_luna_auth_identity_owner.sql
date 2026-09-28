BEGIN;

-- Authentication identities are written by the security-definer account
-- registration function, so keep this control table with the ACL owner.
ALTER TABLE luna.auth_identities OWNER TO novel_acl_owner;

COMMIT;
