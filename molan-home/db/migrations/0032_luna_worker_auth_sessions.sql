BEGIN;

-- Worker only creates short-lived sessions for the owner of a claimed job so
-- the model gateway can apply the same account and billing rules as HTTP.
GRANT EXECUTE ON FUNCTION luna.create_auth_session(uuid, uuid, text, text, text, timestamptz) TO novel_worker;
GRANT EXECUTE ON FUNCTION luna.revoke_auth_session(text) TO novel_worker;

COMMIT;
