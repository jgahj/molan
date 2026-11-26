'use strict';

/**
 * PostgreSQL 会话与认证上下文（Auth Session & Single-TX Request Auth）子仓储方法集。
 * 自 lib/postgres-repository.js 领域化拆出，所有 SQL 均通过父仓储注入的事务边界执行。
 */
function createPostgresAuthSessionMethods({
  internalUuid,
  normalizeLegacyId,
  withTransaction,
  withWorkerTransaction,
  subscribeChannel
}) {
  /** 在共享 PostgreSQL 中创建会话，只保存 token 摘要，不保存明文 token。 */
  async function createAuthSession(input) {
    return withTransaction('', async client => {
      await client.query(
        `SELECT luna.create_auth_session(
          $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::timestamptz
        )`,
        [
          internalUuid(normalizeLegacyId(input.sessionId, 'sessionId')),
          internalUuid(normalizeLegacyId(input.userId, 'userId')),
          normalizeLegacyId(input.legacyId || input.userId, 'legacyId'),
          String(input.tokenHash || '').toLowerCase(),
          String(input.scope || 'client'),
          new Date(Number(input.expiresAt))
        ]
      );
      return { ok: true };
    });
  }

  /** 独立 worker 为任务所有者创建短期应用会话，沿用 worker 角色权限而不提升为应用角色。 */
  async function createWorkerAuthSession(input) {
    return withWorkerTransaction(async client => {
      await client.query(
        `SELECT luna.create_auth_session(
          $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::timestamptz
        )`,
        [
          internalUuid(normalizeLegacyId(input.sessionId, 'sessionId')),
          internalUuid(normalizeLegacyId(input.userId, 'userId')),
          normalizeLegacyId(input.legacyId || input.userId, 'legacyId'),
          String(input.tokenHash || '').toLowerCase(),
          String(input.scope || 'client'),
          new Date(Number(input.expiresAt))
        ]
      );
      return { ok: true };
    });
  }

  /** 读取共享会话摘要，启动新实例时恢复全部尚未过期会话。 */
  async function listAuthSessions() {
    return withTransaction('', async client => {
      const result = await client.query('SELECT * FROM luna.list_auth_sessions()');
      return result.rows.map(row => ({
        tokenHash: String(row.token_hash || ''),
        userId: String(row.legacy_id || row.user_id || ''),
        scope: String(row.scope || 'client'),
        expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : 0
      }));
    });
  }

  async function requestAuthSession(tokenHash) {
    const hash = String(tokenHash || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) return null;
    return withTransaction('', async client => {
      const result = await client.query('SELECT * FROM luna.request_auth_session($1::text) LIMIT 1', [hash]);
      const row = result.rows[0];
      return row ? {
        tokenHash: row.token_hash, userId: row.legacy_id || row.user_id,
        scope: row.scope, expiresAt: new Date(row.expires_at).getTime()
      } : null;
    });
  }

  /**
   * 单事务单查询获取会话与账户行，将每次已登录请求鉴权往返从 2 次独立事务（14 次 SQL 往返）
   * 压缩至 1 次事务 1 条 LATERAL 联表查询，保持 PostgreSQL 强一致性且零陈旧缓存。
   */
  async function requestAuthContext(tokenHash) {
    const hash = String(tokenHash || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) return null;
    return withTransaction('', async client => {
      const result = await client.query(
        `SELECT s.token_hash, s.user_id, s.legacy_id, s.scope, s.expires_at,
                to_jsonb(a) AS account_row
         FROM luna.request_auth_session($1::text) s
         LEFT JOIN LATERAL luna.runtime_account_by_user_id(COALESCE(s.legacy_id, s.user_id::text)) a ON true
         LIMIT 1`,
        [hash]
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        session: {
          tokenHash: row.token_hash,
          userId: row.legacy_id || row.user_id,
          scope: row.scope,
          expiresAt: new Date(row.expires_at).getTime()
        },
        account: row.account_row && typeof row.account_row === 'object' ? row.account_row : null
      };
    });
  }

  /** 撤销一个共享会话并广播给其他应用实例。 */
  async function revokeAuthSession(tokenHash) {
    return withTransaction('', async client => {
      const result = await client.query(
        'SELECT luna.revoke_auth_session($1::text) AS revoked',
        [String(tokenHash || '').toLowerCase()]
      );
      return result.rows[0] && (result.rows[0].revoked === true || result.rows[0].revoked === 't');
    });
  }

  /** 撤销独立 worker 创建的短期应用会话。 */
  async function revokeWorkerAuthSession(tokenHash) {
    return withWorkerTransaction(async client => {
      const result = await client.query(
        'SELECT luna.revoke_auth_session($1::text) AS revoked',
        [String(tokenHash || '').toLowerCase()]
      );
      return result.rows[0] && (result.rows[0].revoked === true || result.rows[0].revoked === 't');
    });
  }

  /** 撤销某个稳定用户的全部共享会话并广播给其他应用实例。 */
  async function revokeAuthSessions(userId) {
    return withTransaction('', async client => {
      const result = await client.query(
        'SELECT luna.revoke_auth_sessions($1::uuid) AS revoked',
        [internalUuid(normalizeLegacyId(userId, 'userId'))]
      );
      return Number(result.rows[0] && result.rows[0].revoked) || 0;
    });
  }

  /** 订阅共享会话失效事件，避免多实例继续接受已退出或已撤销 token。 */
  async function subscribeAuthSessionInvalidation(callback) {
    return subscribeChannel('molan_auth_session', callback);
  }

  return {
    createAuthSession,
    createWorkerAuthSession,
    listAuthSessions,
    requestAuthSession,
    requestAuthContext,
    revokeAuthSession,
    revokeWorkerAuthSession,
    revokeAuthSessions,
    subscribeAuthSessionInvalidation
  };
}

module.exports = { createPostgresAuthSessionMethods };
