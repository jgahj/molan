'use strict';

/** 将共享会话事件中的用户标识统一为稳定 userId，同时兼容旧通知字段。 */
function sessionEventUserId(event) {
  return String(event && (event.userId || event.legacyId) || '').trim();
}

/** 将 PostgreSQL 会话撤销通知应用到单实例会话缓存。 */
function applyAuthSessionInvalidation(sessions, event) {
  if (!(sessions instanceof Map) || !event || typeof event !== 'object') return false;
  if (event.event === 'revoked' && event.tokenHash) {
    sessions.delete(String(event.tokenHash).toLowerCase());
    return true;
  }
  if (event.event !== 'user_revoked') return false;
  const userId = sessionEventUserId(event);
  if (!userId) return true;
  for (const [tokenHash, record] of sessions.entries()) {
    if (record && String(record.userId || '') === userId) sessions.delete(tokenHash);
  }
  return true;
}

module.exports = { sessionEventUserId, applyAuthSessionInvalidation };
