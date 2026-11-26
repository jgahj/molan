'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { AsyncLocalStorage } = require('node:async_hooks');
const projectScope = require('./project-scope');
const projectPackage = require('./project-package');
const projectResources = require('./project-resources');
const { GenerationError } = require('./generation/errors');
const { hashValue } = require('./generation/manifest');
const { matchesTokenUsageReservation } = require('./token-usage-idempotency');
const { createPostgresLabJobMethods } = require('./repositories/postgres-lab-job-methods');
const { createPostgresGenerationRunMethods } = require('./repositories/postgres-generation-run-methods');
const { createPostgresAuthSessionMethods } = require('./repositories/postgres-auth-session-methods');
const { createPostgresCreationBookMethods } = require('./repositories/postgres-creation-book-methods');
const { createPostgresRuntimeDissectionMethods } = require('./repositories/postgres-runtime-dissection-methods');
const { debugWarn } = require('../services/json-persistence-service');
const {
  parseStoredSkillFiles, normalizeSkillRuntimeFiles, skillFileNames,
  skillRuntimeFilesComplete, serializeSkillFiles
} = require('../services/skill-service').createSkillService({
  SKILL_MAX_FILES: 500,
  SKILL_MAX_FILE_BYTES: 5 * 1024 * 1024,
  SKILL_MAX_TOTAL_BYTES: 12 * 1024 * 1024,
  requestError: (status, message) => repositoryError('invalid_skill_files', message, status)
});

let Pool = null;
let Client = null;
try {
  ({ Pool, Client } = require('pg'));
} catch (_) {}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_ID_PATTERN = /^[^\u0000-\u001f\u007f]{1,256}$/;
const RESOURCE_KINDS = new Set(projectResources.RESOURCE_TYPES);
const PROJECT_READ_ROLES = new Set(['owner', 'admin', 'editor', 'reviewer', 'viewer']);
const PROJECT_WRITE_ROLES = new Set(['owner', 'admin', 'editor']);
const JOB_STATES = new Set(['queued', 'claimed', 'running', 'cancel_requested', 'cancelled', 'succeeded', 'failed', 'provider_unknown']);
const GENERATION_SAFE_STATES = new Set([
  'created', 'request_validated', 'genre_resolved', 'style_resolved', 'context_built',
  'contract_validated', 'pre_generation_guard', 'scene_planning'
]);
const GENERATION_ACTIVE_STATES = [
  ...GENERATION_SAFE_STATES, 'generating', 'draft_received', 'deterministic_audit', 'semantic_audit',
  'quality_audit', 'revision', 'cancel_requested', 'committing'
];

/** 将任意稳定的墨阑标识映射为可逆性不依赖数据库的 UUID 格式。 */
function internalUuid(value) {
  const normalized = String(value || '').trim();
  if (!normalized) throw repositoryError('invalid_id', '标识不能为空', 422);
  if (UUID_PATTERN.test(normalized)) return normalized.toLowerCase();
  const digest = crypto.createHash('sha256').update(`molan-pg-id:${normalized}`, 'utf8').digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** 校验并保留对外稳定标识，禁止控制字符和过长值进入数据库映射。 */
function normalizeLegacyId(value, fieldName = 'id') {
  const normalized = String(value || '').trim();
  if (!LEGACY_ID_PATTERN.test(normalized)) throw repositoryError('invalid_id', `${fieldName}格式无效`, 422);
  return normalized;
}

/** 从环境变量或项目外密码文件读取连接密码，不把密码写入日志或仓库。 */
function readPassword(env) {
  if (env.MOLAN_PG_PASSWORD) return String(env.MOLAN_PG_PASSWORD);
  const passwordFile = String(env.MOLAN_PG_PASSWORD_FILE || '').trim();
  if (!passwordFile) return undefined;
  try { return fs.readFileSync(passwordFile, 'utf8').trim() || undefined; } catch (_) { return undefined; }
}

/** 读取 PostgreSQL 配置，只接受显式的墨阑数据库开关，避免误连未知数据库。 */
function readConfig(env = process.env) {
  const enabled = env.MOLAN_DB_BACKEND === 'postgres' ||
    env.MOLAN_PG_ENABLED === '1' ||
    Boolean(String(env.MOLAN_PG_URL || '').trim()) ||
    Boolean(String(env.MOLAN_PG_DATABASE || '').trim());
  if (!enabled) return { enabled: false };
  const connectionString = String(env.MOLAN_PG_URL || '').trim();
  const config = connectionString
    ? { connectionString }
    : {
        host: String(env.MOLAN_PG_HOST || '127.0.0.1'),
        port: Number(env.MOLAN_PG_PORT || 5432),
        database: String(env.MOLAN_PG_DATABASE || 'molan'),
        user: String(env.MOLAN_PG_USER || 'novel_runtime'),
        password: readPassword(env)
      };
  const rawStatementTimeout = env.MOLAN_PG_STATEMENT_TIMEOUT_MS;
  const parsedStatementTimeout = rawStatementTimeout === undefined || rawStatementTimeout === ''
    ? 30000
    : Math.floor(Number(rawStatementTimeout));
  const statementTimeout = Number.isFinite(parsedStatementTimeout) && parsedStatementTimeout > 0
    ? Math.min(300000, Math.max(1000, parsedStatementTimeout))
    : undefined;
  return {
    enabled: true,
    config: {
      ...config,
      max: Math.min(32, Math.max(1, Math.floor(Number(env.MOLAN_PG_POOL_MAX) || 8))),
      min: 0,
      connectionTimeoutMillis: Math.min(30000, Math.max(1000, Math.floor(Number(env.MOLAN_PG_CONNECT_TIMEOUT_MS) || 5000))),
      idleTimeoutMillis: Math.min(300000, Math.max(1000, Math.floor(Number(env.MOLAN_PG_IDLE_TIMEOUT_MS) || 30000))),
      application_name: String(env.MOLAN_PG_APPLICATION_NAME || 'molan-server').trim() || 'molan-server',
      ...(statementTimeout ? { statement_timeout: statementTimeout } : {}),
      ssl: env.MOLAN_PG_SSL === '1' ? { rejectUnauthorized: env.MOLAN_PG_SSL_REJECT_UNAUTHORIZED !== '0' } : undefined
    },
    runtimeRole: String(env.MOLAN_PG_RUNTIME_ROLE || 'novel_app').trim(),
    workerRole: String(env.MOLAN_PG_WORKER_ROLE || 'novel_worker').trim()
  };
}

/** 创建不暴露驱动细节的数据库错误，供 HTTP 层转换为稳定业务码。 */
function repositoryError(code, message, status = 500) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

/** 将 PostgreSQL 错误转换为不泄露 SQL、连接串和其他租户信息的业务错误。 */
function translateDatabaseError(error) {
  if (!error) return repositoryError('pg_unavailable', 'PostgreSQL 操作失败', 503);
  if (error.status && error.code && !/^[0-9A-Z]{5}$/.test(String(error.code))) return error;
  const code = String(error.code || '');
  if (code === '23505') return repositoryError('resource_conflict', '资料或项目标识已存在', 409);
  if (code === '40001') return repositoryError('revision_conflict', '数据已被其他操作更新，请重新读取后重试', 412);
  if (code === '42501') return repositoryError('forbidden', '当前账户无权执行此操作', 403);
  if (code === '23514') return repositoryError('invalid_operation', '当前操作违反项目约束', 409);
  if (code === 'P0002') return repositoryError('resource_missing', '项目或资料不存在', 404);
  if (code === '28P01' || code === '3D000' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT') {
    return repositoryError('pg_unavailable', 'PostgreSQL 当前不可用', 503);
  }
  const translated = repositoryError('pg_operation_failed', 'PostgreSQL 操作失败', 503);
  translated.databaseCode = code;
  translated.databaseMessage = String(error.message || '').slice(0, 240);
  return translated;
}

/** 将 JSONB 驱动值安全转换为对象，坏数据直接阻断而不是静默覆盖。 */
function parseJsonValue(value) {
  if (value && typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

/** 将 JSONB 任意文档恢复为对象、数组或标量，迁移数据不得因类型转换丢失。 */
function parseJsonDocument(value) {
  if (value !== null && typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch (_) { return null; }
}

/** 计算正文或 JSON 负载的 SHA-256，数据库只接受完整十六进制哈希。 */
function jsonHash(value) {
  const source = typeof value === 'string' ? value : JSON.stringify(value === undefined ? {} : value);
  return crypto.createHash('sha256').update(source, 'utf8').digest('hex');
}

/** 生成资源 ETag，客户端只能使用当前项目内的资源版本进行 CAS。 */
function resourceEtag(id, revision) {
  return `"resource-${String(id)}-${Number(revision) || 1}"`;
}

/** 将 PostgreSQL 资源行转换为前端稳定的资料对象。 */
function publicResource(row) {
  const id = String(row.legacy_id || row.id || '');
  const revision = Number(row.revision) || 1;
  return {
    workspaceId: String(row.workspace_legacy_id || row.workspace_id || ''),
    projectId: String(row.project_legacy_id || row.project_id || ''),
    id,
    kind: String(row.kind || ''),
    revision,
    status: String(row.status || 'active'),
    payload: parseJsonValue(row.payload),
    createdBy: String(row.created_by_legacy_id || row.created_by || ''),
    createdAt: row.created_at ? new Date(row.created_at).getTime() : 0,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : 0,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).getTime() : null,
    etag: resourceEtag(id, revision)
  };
}

/** 将资料中心资源投影到正文上下文，保留资源表作为稳定 ID 的权威来源。 */
const { mergeResourcesIntoState } = require('./project-resource-projection');

/** 将安全定义访问函数的结果转换为统一项目作用域摘要。 */
function publicAccess(row) {
  if (!row) return null;
  return {
    workspace_id: String(row.workspace_legacy_id || row.workspace_uuid || ''),
    project_id: String(row.project_legacy_id || row.project_uuid || ''),
    workspace_uuid: String(row.workspace_uuid || ''),
    project_uuid: String(row.project_uuid || ''),
    owner_user_id: String(row.owner_legacy_id || row.owner_user_id || ''),
    title: String(row.title || ''),
    status: String(row.project_status || 'active'),
    role: String(row.role || ''),
    active: true,
    can_spend: row.can_spend === true || row.can_spend === 't',
    can_export: row.can_export === true || row.can_export === 't',
    acl_revision: Number(row.acl_revision) || 1,
    revision: Number(row.project_revision) || 1
  };
}

/** 将持久化任务行转换为不含提示词和凭据的任务状态。 */
function publicJob(row) {
  if (!row) return null;
  return {
    id: String(row.legacy_id || row.id || ''),
    workspaceId: String(row.workspace_legacy_id || row.workspace_id || ''),
    projectId: String(row.project_legacy_id || row.project_id || ''),
    state: String(row.state || 'queued'),
    attemptNo: Number(row.attempt_no) || 0,
    fencingToken: Number(row.fencing_token) || 0,
    revision: Number(row.revision) || 1,
    inputHash: String(row.input_hash || ''),
    result: parseJsonValue(row.result),
    errorCode: String(row.error_code || ''),
    createdAt: row.created_at ? new Date(row.created_at).getTime() : 0,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : 0,
    leaseUntil: row.lease_until ? new Date(row.lease_until).getTime() : null
  };
}

/** 将生成任务转换为不含请求输入和操作者内部 UUID 的公开快照。 */
function publicGenerationRun(row) {
  if (!row) return null;
  return {
    id: String(row.id || ''),
    workspaceId: String(row.workspace_legacy_id || row.workspace_id || ''),
    projectId: String(row.project_legacy_id || row.project_id || ''),
    chapterId: String(row.chapter_id || ''),
    state: String(row.state || ''),
    pipelineVersion: String(row.pipeline_version || ''),
    attemptNo: Number(row.attempt_no) || 0,
    manifest: parseJsonValue(row.manifest),
    result: parseJsonValue(row.result),
    errorCode: String(row.error_code || ''),
    errorDetail: String(row.error_detail || ''),
    reservedCostMinor: Number(row.reserved_cost_minor) || 0,
    actualCostMinor: Number(row.actual_cost_minor) || 0,
    cancelRequested: row.cancel_requested === true || row.cancel_requested === 't',
    pauseRequested: row.pause_requested === true || row.pause_requested === 't',
    fencingToken: Number(row.fencing_token) || 0,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : 0,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : 0,
    finishedAt: row.finished_at ? new Date(row.finished_at).getTime() : null
  };
}

/** 只有持有当前有效 owner/token 的 worker 才能写入带围栏的运行数据。 */
function assertGenerationLease(row, input, now) {
  if (input.fencingToken == null) return;
  const leaseUntil = !row || row.lease_until == null ? 0 : new Date(row.lease_until).getTime();
  const valid = row && String(row.lease_owner || '').toLowerCase() === String(input.leaseOwner || '').toLowerCase() &&
    Number(row.fencing_token) === Number(input.fencingToken) && leaseUntil > now;
  if (!valid) throw new GenerationError('STATE_CONFLICT', '生成任务租约已过期或被替换', { status: 409 });
}

function generationNow(input) {
  const supplied = Number(input && input.now);
  return Number.isFinite(supplied) && supplied > 0 ? supplied : Date.now();
}

function generationLeaseTtl(input) {
  return Math.max(15000, Math.min(300000, Number(input && input.ttlMs) || 90000));
}

/** 判断项目成员是否拥有指定动作权限。 */
function hasRole(access, roles) {
  return Boolean(access && access.active && roles.has(String(access.role || '')));
}

/** 校验动态 SQL 中的角色名，只允许迁移配置声明的角色。 */
function quoteIdentifier(value) {
  const normalized = String(value || '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
    throw repositoryError('invalid_role', 'PostgreSQL 运行角色格式无效', 500);
  }
  return `"${normalized.replace(/"/g, '""')}"`;
}

/** 创建使用同一连接完成事务的 PostgreSQL 资料仓储。 */
function createPostgresRepository(options = {}) {
  const dissectionWorkerContext = new AsyncLocalStorage();
  const transactionContext = new AsyncLocalStorage();
  const environment = options.env || process.env;
  const settings = readConfig(environment);
  const PoolConstructor = options.Pool || Pool;
  if (!settings.enabled) {
    return {
      enabled: false,
      available: false,
      async initialize() { return { enabled: false, available: false }; },
      async close() {},
      async health() { return { enabled: false, available: false }; }
    };
  }
  if (!PoolConstructor) {
    const unavailable = repositoryError('pg_driver_missing', 'PostgreSQL 驱动未安装', 503);
    return {
      enabled: true,
      available: false,
      error: unavailable,
      async initialize() { throw unavailable; },
      async close() {},
      async health() { return { enabled: true, available: false, error: unavailable.code }; }
    };
  }

  const pool = new PoolConstructor(settings.config);
  if (typeof pool.on === 'function') {
    pool.on('error', error => {
      debugWarn('pg-pool', 'idle client error', error);
    });
  }
  const ClientConstructor = options.Client || (!options.Pool ? Client : null);
  let closed = false;
  let listenClient = null;
  let listenClientStandalone = false;
  let listenConnectPromise = null;
  let listenReconnectTimer = null;
  let listenBackoffMs = 1000;
  const listenChannels = new Map();

  function scheduleListenReconnect() {
    if (closed || listenReconnectTimer || listenChannels.size === 0) return;
    const delay = listenBackoffMs;
    listenBackoffMs = Math.min(30000, listenBackoffMs * 2);
    listenReconnectTimer = setTimeout(() => {
      listenReconnectTimer = null;
      if (closed || listenChannels.size === 0) return;
      void ensureListenClient().catch(err => {
        debugWarn('pg-listen', 'reconnect failed', err);
        scheduleListenReconnect();
      });
    }, delay);
    if (typeof listenReconnectTimer.unref === 'function') listenReconnectTimer.unref();
  }

  function detachListenClient(client) {
    if (listenClient !== client) return;
    const standalone = listenClientStandalone;
    listenClient = null;
    listenClientStandalone = false;
    try {
      if (standalone && typeof client.end === 'function') void client.end().catch(() => {});
      else if (typeof client.release === 'function') client.release(true);
    } catch (_) {}
  }

  /** 共享单条独立 LISTEN 长连接（不占业务 Pool 配额），断连后自动指数退避重连并重新 LISTEN。 */
  async function ensureListenClient() {
    if (closed) throw repositoryError('pg_closed', 'PostgreSQL 仓储已关闭', 503);
    if (listenClient) return listenClient;
    if (listenConnectPromise) return listenConnectPromise;
    listenConnectPromise = (async () => {
      let client = null;
      let standalone = false;
      try {
        if (ClientConstructor) {
          const listenConfig = { ...settings.config };
          delete listenConfig.statement_timeout;
          client = new ClientConstructor(listenConfig);
          await client.connect();
          standalone = true;
        } else {
          client = await pool.connect();
          standalone = false;
        }
        if (settings.runtimeRole && settings.runtimeRole !== 'none') {
          await client.query(`SET ROLE ${quoteIdentifier(settings.runtimeRole)}`);
        }
        if (typeof client.on === 'function') {
          client.on('notification', message => {
            const handlers = listenChannels.get(String(message && message.channel || ''));
            if (!handlers || handlers.size === 0) return;
            let parsed;
            try { parsed = JSON.parse(message.payload || '{}'); }
            catch (err) { debugWarn('pg-notify', 'invalid notification payload', err); return; }
            for (const cb of handlers) {
              try { cb(parsed); } catch (err) { debugWarn('pg-notify', 'listener callback error', err); }
            }
          });
          client.on('error', err => {
            debugWarn('pg-listen', 'listen client error', err);
            detachListenClient(client);
            scheduleListenReconnect();
          });
          client.on('end', () => {
            detachListenClient(client);
            scheduleListenReconnect();
          });
        }
        for (const ch of listenChannels.keys()) {
          await client.query(`LISTEN ${quoteIdentifier(ch)}`);
        }
        listenClient = client;
        listenClientStandalone = standalone;
        listenBackoffMs = 1000;
        return client;
      } catch (error) {
        if (client) {
          try {
            if (standalone && typeof client.end === 'function') void client.end().catch(() => {});
            else if (typeof client.release === 'function') client.release(true);
          } catch (_) {}
        }
        throw translateDatabaseError(error);
      } finally {
        listenConnectPromise = null;
      }
    })();
    return listenConnectPromise;
  }

  async function subscribeChannel(channel, callback) {
    if (typeof callback !== 'function') return;
    const ch = String(channel || '').trim();
    if (!ch) return;
    let set = listenChannels.get(ch);
    const isNewChannel = !set;
    if (!set) {
      set = new Set();
      listenChannels.set(ch, set);
    }
    set.add(callback);
    const client = await ensureListenClient();
    if (isNewChannel) {
      try {
        await client.query(`LISTEN ${quoteIdentifier(ch)}`);
      } catch (error) {
        set.delete(callback);
        if (set.size === 0) listenChannels.delete(ch);
        throw translateDatabaseError(error);
      }
    }
  }

  /** 在事务结束后清理连接上的角色和事务级作用域，避免池连接串租户。 */
  async function resetClient(client, destroy) {
    if (destroy) {
      client.release(true);
      return;
    }
    try {
      await client.query('RESET ROLE');
      await client.query('RESET ALL');
      client.release();
    } catch (_) {
      client.release(true);
    }
  }

  /** 以 actor 作用域执行完整事务，所有仓储 SQL 共享一个专属连接。 */
  async function withTransaction(actorId, operation) {
    if (closed) throw repositoryError('pg_closed', 'PostgreSQL 仓储已关闭', 503);
    const existing = transactionContext.getStore();
    if (existing && existing.client) {
      const requestedActorId = actorId ? internalUuid(actorId) : '';
      if (requestedActorId !== existing.internalActorId) {
        throw repositoryError('transaction_actor_conflict', '事务内禁止切换账户身份', 403);
      }
      return operation(existing.client, existing.internalActorId);
    }
    const client = await pool.connect().catch(error => { throw translateDatabaseError(error); });
    let destroy = false;
    try {
      if (settings.runtimeRole && settings.runtimeRole !== 'none') {
        await client.query(`SET ROLE ${quoteIdentifier(settings.runtimeRole)}`);
      }
      await client.query('BEGIN');
      const internalActorId = actorId ? internalUuid(actorId) : '';
      await client.query('SELECT set_config($1, $2, true)', ['app.user_id', internalActorId]);
      const worker = dissectionWorkerContext.getStore();
      if (worker) {
        await client.query(
          "SELECT set_config('app.dissection_id', $1, true), set_config('app.dissection_worker', $2, true), set_config('app.dissection_fence', $3, true)",
          [worker.dissectionId, worker.workerId, String(worker.fence)]
        );
      }
      const value = await transactionContext.run({ client, internalActorId }, () => operation(client, internalActorId));
      await client.query('COMMIT');
      return value;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {
        destroy = true;
      }
      const translated = translateDatabaseError(error);
      if (translated !== error && error && /^[0-9A-Z]{5}$/.test(String(error.code || ''))) {
        translated.databaseCode = String(error.code);
        translated.databaseMessage = String(error.message || '').slice(0, 240);
      }
      throw translated;
    } finally {
      await resetClient(client, destroy);
    }
  }

  /** 使用独立 worker 角色执行任务领取和围栏写回，不附带用户项目 GUC。 */
  async function withWorkerTransaction(operation) {
    if (closed) throw repositoryError('pg_closed', 'PostgreSQL 仓储已关闭', 503);
    const client = await pool.connect().catch(error => { throw translateDatabaseError(error); });
    let destroy = false;
    try {
      if (settings.workerRole && settings.workerRole !== 'none') {
        await client.query(`SET ROLE ${quoteIdentifier(settings.workerRole)}`);
      }
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.user_id', '']);
      const value = await operation(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {
        destroy = true;
      }
      const translated = translateDatabaseError(error);
      if (translated !== error && error && /^[0-9A-Z]{5}$/.test(String(error.code || ''))) {
        translated.databaseCode = String(error.code);
        translated.databaseMessage = String(error.message || '').slice(0, 240);
      }
      throw translated;
    } finally {
      await resetClient(client, destroy);
    }
  }

  /** 写入当前认证用户映射，确保稳定 userId 与内部 UUID 一一对应。 */
  async function ensureActor(client, userId) {
    const legacyId = normalizeLegacyId(userId, 'userId');
    await client.query('SELECT luna.ensure_actor($1::uuid, $2::text)', [internalUuid(legacyId), legacyId]);
    return internalUuid(legacyId);
  }

  /** 查询当前 actor 对某个项目的显式成员权限。 */
  async function accessForClient(client, projectId, workspaceId = '') {
    const internalProjectId = internalUuid(normalizeLegacyId(projectId, 'projectId'));
    let internalWorkspaceId = workspaceId ? internalUuid(normalizeLegacyId(workspaceId, 'workspaceId')) : '';
    if (!internalWorkspaceId) {
      const projectResult = await client.query(
        `SELECT workspace_id
         FROM luna.projects
         WHERE id = $1::uuid AND status <> 'deleted'
         LIMIT 1`,
        [internalProjectId]
      );
      internalWorkspaceId = projectResult.rows[0] && String(projectResult.rows[0].workspace_id || '');
    }
    if (!internalWorkspaceId) return null;
    const result = await client.query(
      'SELECT * FROM luna.project_access($1::uuid, $2::uuid)',
      [internalWorkspaceId, internalProjectId]
    );
    return publicAccess(result.rows[0] || null);
  }

  /** 确保工作区和项目存在，并且创建者在事务内成为唯一初始 owner。 */
  async function ensureScope(client, input) {
    const userId = normalizeLegacyId(input.userId, 'userId');
    const projectId = normalizeLegacyId(input.projectId, 'projectId');
    const workspaceId = normalizeLegacyId(
      input.workspaceId || projectScope.personalWorkspaceId(userId),
      'workspaceId'
    );
    const actorUuid = await ensureActor(client, userId);
    const workspaceUuid = internalUuid(workspaceId);
    const workspaceResult = await client.query(
      `SELECT w.id, w.legacy_id, w.name, wm.role
       FROM luna.workspaces w
       JOIN luna.workspace_members wm
         ON wm.workspace_id = w.id AND wm.user_id = $2::uuid AND wm.active
       WHERE w.id = $1::uuid
       LIMIT 1`,
      [workspaceUuid, actorUuid]
    );
    if (!workspaceResult.rows.length) {
      await client.query(
        'SELECT luna.create_workspace_legacy($1::uuid, $2::text, $3::text)',
        [workspaceUuid, String(input.workspaceName || '个人工作区').trim() || '个人工作区', workspaceId]
      );
    }
    const projectUuid = internalUuid(projectId);
    const projectResult = await client.query(
      `SELECT p.id, p.legacy_id, p.title, p.status, p.revision, p.acl_revision, pm.role
       FROM luna.projects p
       JOIN luna.project_members pm
         ON pm.workspace_id = p.workspace_id
        AND pm.project_id = p.id
        AND pm.user_id = $3::uuid
        AND pm.active
       WHERE p.workspace_id = $1::uuid AND p.id = $2::uuid
       LIMIT 1`,
      [workspaceUuid, projectUuid, actorUuid]
    );
    if (!projectResult.rows.length) {
      await client.query(
        'SELECT luna.create_project_legacy($1::uuid, $2::uuid, $3::text, $4::text)',
        [workspaceUuid, projectUuid, String(input.title || '').slice(0, 200), projectId]
      );
    }
    const access = await accessForClient(client, projectId, workspaceId);
    if (!access) throw repositoryError('forbidden', '项目不存在或当前账户未获授权', 404);
    return { access, workspaceId, projectId, workspaceUuid, projectUuid };
  }

  /** 查询项目资料表中的全部资源，统一附带外部稳定 ID。 */
  async function resourcesForClient(client, access, kind = '', includeDeleted = false) {
    const values = [access.workspace_uuid, access.project_uuid];
    const conditions = ['r.workspace_id = $1::uuid', 'r.project_id = $2::uuid'];
    if (kind) {
      values.push(kind);
      conditions.push(`r.kind = $${values.length}::text`);
    }
    if (!includeDeleted) conditions.push('r.deleted_at IS NULL');
    const result = await client.query(
      `SELECT r.*, w.legacy_id AS workspace_legacy_id, p.legacy_id AS project_legacy_id,
              creator.legacy_id AS created_by_legacy_id
       FROM luna.project_resources r
       JOIN luna.workspaces w ON w.id = r.workspace_id
       JOIN luna.projects p ON p.id = r.project_id AND p.workspace_id = r.workspace_id
       LEFT JOIN luna.users creator ON creator.id = r.created_by
       WHERE ${conditions.join(' AND ')}
       ORDER BY r.updated_at DESC, r.legacy_id ASC, r.id ASC`,
      values
    );
    return result.rows.map(publicResource);
  }

  /** 查询单个资料的当前版本，用于 CAS 冲突响应。 */
  async function resourceForClient(client, access, kind, resourceId, includeDeleted = false) {
    const values = [access.workspace_uuid, access.project_uuid, kind, internalUuid(resourceId)];
    const deletedCondition = includeDeleted ? '' : 'AND r.deleted_at IS NULL';
    const result = await client.query(
      `SELECT r.*, w.legacy_id AS workspace_legacy_id, p.legacy_id AS project_legacy_id,
              creator.legacy_id AS created_by_legacy_id
       FROM luna.project_resources r
       JOIN luna.workspaces w ON w.id = r.workspace_id
       JOIN luna.projects p ON p.id = r.project_id AND p.workspace_id = r.workspace_id
       LEFT JOIN luna.users creator ON creator.id = r.created_by
       WHERE r.workspace_id = $1::uuid AND r.project_id = $2::uuid
         AND r.kind = $3::text AND r.id = $4::uuid ${deletedCondition}
       LIMIT 1`,
      values
    );
    return result.rows[0] ? publicResource(result.rows[0]) : null;
  }

  function normalizeProjectResourcePayload(payload, access, kind) {
    try {
      return projectResources.normalizePayload(payload, access, kind);
    } catch (error) {
      throw repositoryError(error.code || 'resource_payload_invalid', error.message || '资料负载无效', error.status || 422);
    }
  }

  async function validateProjectResourceReferences(client, access, payload, resourceKind = '') {
    const referenceKeys = /(?:^references?$|Refs$|^parentRef$|^targetRef$)/i;
    async function visit(value, inReference) {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        for (const item of value) await visit(item, inReference);
        return;
      }
      const kind = String(value.resourceKind || value.kind || '').trim().toLowerCase();
      const id = String(value.resourceId || value.id || '').trim();
      if (inReference && id && RESOURCE_KINDS.has(kind)) {
        const result = await client.query(`SELECT 1 FROM luna.project_resources
          WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND id = $3::uuid
            AND legacy_id = $4::text AND kind = $5::text AND deleted_at IS NULL`,
        [access.workspace_uuid, access.project_uuid, internalUuid(id), id, kind]);
        if (!result.rows.length) throw repositoryError('REFERENCE_NOT_FOUND', `项目内资料引用不存在或已归档：${kind}/${id}`, 422);
      }
      for (const [key, child] of Object.entries(value)) await visit(child, inReference || referenceKeys.test(key));
    }
    await visit(payload, false);
    const references = resourceKind
      ? projectResources.projectMaterialSchema.collectReferences(payload, resourceKind)
      : [];
    for (const reference of references) {
      const values = [access.workspace_uuid, access.project_uuid, internalUuid(reference.id), reference.id];
      const kindCondition = reference.kind ? 'AND kind = $5::text' : '';
      if (reference.kind) values.push(reference.kind);
      const result = await client.query(`SELECT kind FROM luna.project_resources
        WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND id = $3::uuid
          AND legacy_id = $4::text AND deleted_at IS NULL ${kindCondition}
        LIMIT 1`, values);
      if (!result.rows.length) {
        throw repositoryError('REFERENCE_NOT_FOUND', `项目内资料引用不存在或类型不匹配：${reference.kind || '*'} / ${reference.id}`, 422);
      }
    }
  }

  /** 检查 PG 目标架构、RLS 和运行角色是否可用。 */
  async function health() {
    if (closed) return { enabled: true, available: false, error: 'pg_closed' };
    const client = await pool.connect().catch(error => { throw translateDatabaseError(error); });
    try {
      const result = await client.query(
        `SELECT current_database() AS database,
                current_setting('server_version') AS server_version,
                current_user AS current_user,
                (SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'luna')::integer AS table_count`
      );
      return { enabled: true, available: true, ...result.rows[0] };
    } catch (error) {
      throw translateDatabaseError(error);
    } finally {
      client.release();
    }
  }

  const authSessionMethods = createPostgresAuthSessionMethods({
    internalUuid,
    normalizeLegacyId,
    withTransaction,
    withWorkerTransaction,
    subscribeChannel
  });
  const {
    createAuthSession,
    createWorkerAuthSession,
    listAuthSessions,
    requestAuthSession,
    requestAuthContext,
    revokeAuthSession,
    revokeWorkerAuthSession,
    revokeAuthSessions,
    subscribeAuthSessionInvalidation
  } = authSessionMethods;

  /** 启动时验证 PostgreSQL 目标函数存在，不执行业务写入。 */
  async function initialize() {
    const result = await health();
    if (Number(result.table_count) < 34) {
      throw repositoryError('pg_schema_incomplete', 'PostgreSQL 目标 schema 未完成迁移', 503);
    }
    const client = await pool.connect().catch(error => { throw translateDatabaseError(error); });
    let roleSet = false;
    try {
      // 启动检查也必须使用受限运行角色；登录角色明确 NOINHERIT，只负责建立连接。
      if (settings.runtimeRole && settings.runtimeRole !== 'none') {
        await client.query(`SET ROLE ${quoteIdentifier(settings.runtimeRole)}`);
        roleSet = true;
      }
      const runtime = await client.query(`
        SELECT to_regclass('luna.runtime_accounts') IS NOT NULL AS accounts_ready,
               to_regclass('luna.runtime_user_skills') IS NOT NULL AS user_skills_ready,
               to_regclass('luna.runtime_global_skills') IS NOT NULL AS global_skills_ready,
               to_regclass('luna.runtime_open_skills') IS NOT NULL AS open_skills_ready,
               to_regclass('luna.runtime_dissections') IS NOT NULL AS dissections_ready,
               to_regclass('luna.runtime_dissection_rows') IS NOT NULL AS rows_ready,
               to_regprocedure('luna.runtime_accounts_all()') IS NOT NULL AS account_reader_ready,
               to_regprocedure('luna.runtime_user_skills_all()') IS NOT NULL AS user_skill_reader_ready,
               to_regprocedure('luna.runtime_dissections_all()') IS NOT NULL AS dissection_reader_ready,
               to_regprocedure('luna.request_auth_session(text)') IS NOT NULL AS request_auth_ready,
               to_regprocedure('luna.download_open_skill(text)') IS NOT NULL AS skill_download_ready,
               to_regclass('luna.runtime_admin_audit') IS NOT NULL AS admin_audit_ready,
               to_regprocedure('luna.read_dissection_share(text)') IS NOT NULL AS shared_read_ready,
               to_regprocedure('luna.recover_expired_dissection_workers()') IS NOT NULL AS worker_lease_ready`);
      const row = runtime.rows[0] || {};
      if (![row.accounts_ready, row.user_skills_ready, row.global_skills_ready,
        row.open_skills_ready, row.dissections_ready, row.rows_ready,
        row.account_reader_ready, row.user_skill_reader_ready, row.dissection_reader_ready, row.request_auth_ready, row.skill_download_ready,
        row.admin_audit_ready, row.shared_read_ready, row.worker_lease_ready]
        .every(value => value === true || value === 't')) {
        throw repositoryError('pg_runtime_schema_incomplete', 'PostgreSQL 运行时投影尚未完成迁移', 503);
      }
    } catch (error) {
      throw translateDatabaseError(error);
    } finally {
      if (roleSet) {
        try {
          await client.query('RESET ROLE');
          client.release();
        } catch (_) {
          client.release(true);
        }
      } else {
        client.release();
      }
    }
    return result;
  }

  /** 列出当前用户显式加入的工作区。 */
  async function listWorkspaces(userId) {
    return withTransaction(userId, async client => {
      const actorUuid = await ensureActor(client, userId);
      const result = await client.query(
        `SELECT w.id, w.legacy_id, w.name, wm.role, w.created_at, w.updated_at
         FROM luna.workspaces w
         JOIN luna.workspace_members wm
           ON wm.workspace_id = w.id AND wm.user_id = $1::uuid AND wm.active
         ORDER BY w.updated_at DESC`,
        [actorUuid]
      );
      return result.rows.map(row => ({
        id: String(row.legacy_id || row.id),
        name: String(row.name || ''),
        role: String(row.role || ''),
        createdAt: row.created_at ? new Date(row.created_at).getTime() : 0,
        updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : 0
      }));
    });
  }

  /** 创建新的工作区，只把当前稳定用户设为 owner。 */
  async function createWorkspace(userId, name) {
    const workspaceName = String(name || '').trim();
    if (!workspaceName) throw repositoryError('invalid_workspace', '工作区名称不能为空', 422);
    const workspaceId = `ws_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
    return withTransaction(userId, async client => {
      await ensureActor(client, userId);
      await client.query(
        'SELECT luna.create_workspace_legacy($1::uuid, $2::text, $3::text)',
        [internalUuid(workspaceId), workspaceName.slice(0, 120), workspaceId]
      );
      return { ok: true, workspaceId, name: workspaceName.slice(0, 120) };
    });
  }

  /** 列出工作区内当前用户显式获准的项目，工作区管理员不自动发现私有项目。 */
  async function listProjects(userId, workspaceId) {
    return withTransaction(userId, async client => {
      const actorUuid = await ensureActor(client, userId);
      const normalizedWorkspaceId = normalizeLegacyId(workspaceId, 'workspaceId');
      const result = await client.query(
        `SELECT w.legacy_id AS workspace_legacy_id, p.legacy_id AS project_legacy_id,
                p.title, p.status, p.updated_at, p.acl_revision, pm.role,
                (pm.role IN ('owner', 'admin')
                  OR COALESCE(spend_grant.granted, false)) AS can_spend,
                (pm.role IN ('owner', 'admin')
                  OR COALESCE(export_grant.granted, false)) AS can_export
         FROM luna.projects p
         JOIN luna.workspaces w ON w.id = p.workspace_id
         JOIN luna.project_members pm
           ON pm.workspace_id = p.workspace_id
          AND pm.project_id = p.id
          AND pm.user_id = $2::uuid
          AND pm.active
         LEFT JOIN luna.project_capability_grants spend_grant
           ON spend_grant.workspace_id = p.workspace_id
          AND spend_grant.project_id = p.id
          AND spend_grant.user_id = $2::uuid
          AND spend_grant.capability = 'canSpend'
         LEFT JOIN luna.project_capability_grants export_grant
           ON export_grant.workspace_id = p.workspace_id
          AND export_grant.project_id = p.id
          AND export_grant.user_id = $2::uuid
          AND export_grant.capability = 'canExport'
         WHERE w.id = $1::uuid AND p.status = 'active'
         ORDER BY p.updated_at DESC`,
        [internalUuid(normalizedWorkspaceId), actorUuid]
      );
      return result.rows.map(row => ({
        workspaceId: String(row.workspace_legacy_id || normalizedWorkspaceId),
        projectId: String(row.project_legacy_id || ''),
        title: String(row.title || ''),
        role: String(row.role || ''),
        canSpend: row.can_spend === true || row.can_spend === 't',
        canExport: row.can_export === true || row.can_export === 't',
        updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : 0,
        aclRevision: Number(row.acl_revision) || 1
      }));
    });
  }

  /** 读取项目权限，不返回未授权项目是否存在的额外信息。 */
  async function getProjectAccess(userId, projectId, workspaceId = '') {
    return withTransaction(userId, async client => {
      await ensureActor(client, userId);
      return accessForClient(client, projectId, workspaceId);
    });
  }

  /** 列出工作区成员，使用安全定义函数避免 workspace_members 自身 RLS 递归。 */
  async function listWorkspaceMembers(userId, workspaceId) {
    return withTransaction(userId, async client => {
      await ensureActor(client, userId);
      const result = await client.query(
        'SELECT user_id, legacy_id, role, active FROM luna.list_workspace_members($1::uuid)',
        [internalUuid(normalizeLegacyId(workspaceId, 'workspaceId'))]
      );
      return result.rows.map(row => ({
        userId: String(row.legacy_id || row.user_id || ''),
        role: String(row.role || ''),
        active: row.active === true || row.active === 't'
      }));
    });
  }

  /** 增加或更新工作区成员，并由数据库函数校验 owner/admin 权限。 */
  async function upsertWorkspaceMember(userId, workspaceId, targetUserId, role) {
    return withTransaction(userId, async client => {
      await ensureActor(client, userId);
      await client.query(
        'SELECT luna.grant_workspace_member($1::uuid, $2::uuid, $3::text, $4::text)',
        [
          internalUuid(normalizeLegacyId(workspaceId, 'workspaceId')),
          internalUuid(normalizeLegacyId(targetUserId, 'userId')),
          normalizeLegacyId(targetUserId, 'userId'),
          String(role || 'member')
        ]
      );
      return { ok: true, workspaceId: String(workspaceId), userId: String(targetUserId), role: String(role || 'member') };
    });
  }

  /** 撤销工作区成员访问，数据库函数保证 owner 和管理员保护规则。 */
  async function deactivateWorkspaceMember(userId, workspaceId, targetUserId) {
    return withTransaction(userId, async client => {
      await ensureActor(client, userId);
      await client.query(
        'SELECT luna.revoke_workspace_member($1::uuid, $2::uuid)',
        [internalUuid(normalizeLegacyId(workspaceId, 'workspaceId')), internalUuid(normalizeLegacyId(targetUserId, 'userId'))]
      );
      return { ok: true, workspaceId: String(workspaceId), userId: String(targetUserId) };
    });
  }

  /** 列出项目成员及其独立的支出和导出能力。 */
  async function listProjectMembers(userId, workspaceId, projectId) {
    return withTransaction(userId, async client => {
      await ensureActor(client, userId);
      const access = await accessForClient(client, projectId, workspaceId);
      if (!hasRole(access, PROJECT_READ_ROLES)) throw repositoryError('not_found', '项目不存在或无权访问', 404);
      const result = await client.query(
        `SELECT user_id, legacy_id, role, active, can_spend, can_export
         FROM luna.list_project_members($1::uuid, $2::uuid)`,
        [access.workspace_uuid, access.project_uuid]
      );
      return result.rows.map(row => ({
        userId: String(row.legacy_id || row.user_id || ''),
        role: String(row.role || ''),
        active: row.active === true || row.active === 't',
        canSpend: row.can_spend === true || row.can_spend === 't' || ['owner', 'admin'].includes(String(row.role || '')),
        canExport: row.can_export === true || row.can_export === 't' || ['owner', 'admin'].includes(String(row.role || ''))
      }));
    });
  }

  /** 增加或更新项目成员，并使用 ACL revision 保护并发改权。 */
  async function upsertProjectMember(userId, workspaceId, projectId, targetUserId, role, canSpend, canExport, transferOwner, expectedAclRevision) {
    return withTransaction(userId, async client => {
      await ensureActor(client, userId);
      const result = await client.query(
        `SELECT luna.grant_project_member(
          $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text,
          $6::boolean, $7::boolean, $8::boolean, $9::bigint
        ) AS acl_revision`,
        [
          internalUuid(normalizeLegacyId(workspaceId, 'workspaceId')),
          internalUuid(normalizeLegacyId(projectId, 'projectId')),
          internalUuid(normalizeLegacyId(targetUserId, 'userId')),
          normalizeLegacyId(targetUserId, 'userId'),
          String(role || ''),
          canSpend === true,
          canExport === true,
          transferOwner === true,
          expectedAclRevision == null ? null : Number(expectedAclRevision)
        ]
      );
      return {
        ok: true,
        workspaceId: String(workspaceId),
        projectId: String(projectId),
        userId: String(targetUserId),
        role: String(role || ''),
        aclRevision: Number(result.rows[0] && result.rows[0].acl_revision) || 1
      };
    });
  }

  /** 撤销项目成员，数据库函数保证不能移除唯一 owner。 */
  async function deactivateProjectMember(userId, workspaceId, projectId, targetUserId) {
    return withTransaction(userId, async client => {
      await ensureActor(client, userId);
      const result = await client.query(
        'SELECT luna.revoke_project_member($1::uuid, $2::uuid, $3::uuid) AS acl_revision',
        [
          internalUuid(normalizeLegacyId(workspaceId, 'workspaceId')),
          internalUuid(normalizeLegacyId(projectId, 'projectId')),
          internalUuid(normalizeLegacyId(targetUserId, 'userId'))
        ]
      );
      return {
        ok: true,
        workspaceId: String(workspaceId),
        projectId: String(projectId),
        userId: String(targetUserId),
        aclRevision: Number(result.rows[0] && result.rows[0].acl_revision) || 1
      };
    });
  }

  /** 读取项目权威资料状态，完整 state 只保存在 project_profiles。 */
  async function getProfile(userId, projectId, workspaceId = '') {
    return withTransaction(userId, async client => {
      await ensureActor(client, userId);
      const access = await accessForClient(client, projectId, workspaceId);
      if (!access) return null;
      const result = await client.query(
        `SELECT pp.revision, pp.payload, pp.created_at, pp.updated_at,
                p.created_at AS project_created_at, p.updated_at AS project_updated_at
         FROM luna.project_profiles pp
         JOIN luna.projects p ON p.workspace_id = pp.workspace_id AND p.id = pp.project_id
         WHERE pp.workspace_id = $1::uuid AND pp.project_id = $2::uuid
         LIMIT 1`,
        [access.workspace_uuid, access.project_uuid]
      );
      const row = result.rows[0];
      const resources = await resourcesForClient(client, access, '', true);
      return {
        access,
        state: mergeResourcesIntoState(row ? parseJsonValue(row.payload) : {}, resources),
        revision: row ? Number(row.revision) || 1 : 0,
        createdAt: row && row.project_created_at ? new Date(row.project_created_at).getTime() : 0,
        updatedAt: row && row.updated_at
          ? new Date(row.updated_at).getTime()
          : access.updated_at || 0,
        title: access.title
      };
    });
  }

  /** 仅在 actor 具有项目导出能力时读取已提交章节正文。 */
  async function listExportableChapters(userId, projectId, workspaceId = '') {
    return withTransaction(userId, async client => {
      await ensureActor(client, userId);
      const access = await accessForClient(client, projectId, workspaceId);
      if (!projectScope.canAccess(access, projectScope.PROJECT_ROLES, 'export')) {
        throw repositoryError('export_forbidden', '小说不存在或无权导出', 404);
      }
      const chapterNoText = "ci.delta->>'chapterNo'";
      const chapterNoIsPositiveInteger = `${chapterNoText} ~ '^[1-9][0-9]{0,8}$'`;
      const chapterNoValue = `CASE WHEN ${chapterNoIsPositiveInteger} THEN (${chapterNoText})::integer END`;
      const result = await client.query(
        `SELECT ${chapterNoValue} AS chapter_no,
                mr.body, mr.body_hash
         FROM luna.commits c
         JOIN luna.commit_items ci
           ON ci.workspace_id = c.workspace_id AND ci.project_id = c.project_id AND ci.commit_id = c.id
         JOIN luna.manuscripts m
           ON m.workspace_id = ci.workspace_id AND m.project_id = ci.project_id AND m.id = ci.manuscript_id
         JOIN luna.manuscript_revisions mr
           ON mr.workspace_id = ci.workspace_id AND mr.project_id = ci.project_id
          AND mr.manuscript_id = ci.manuscript_id AND mr.revision = ci.after_revision
         WHERE c.workspace_id = $1::uuid AND c.project_id = $2::uuid
           AND c.status = 'committed' AND m.kind = 'chapter'
           AND ${chapterNoIsPositiveInteger}
         ORDER BY ${chapterNoValue} ASC,
                  ci.after_revision DESC, c.committed_at DESC`,
        [access.workspace_uuid, access.project_uuid]
      );
      const latestByChapter = new Map();
      for (const row of result.rows) {
        const chapterNo = Number(row.chapter_no);
        const content = String(row.body || '');
        const expectedHash = String(row.body_hash || '').toLowerCase();
        const actualHash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
        if (!Number.isInteger(chapterNo) || chapterNo < 1 || latestByChapter.has(chapterNo)) continue;
        if (!expectedHash || actualHash !== expectedHash) {
          throw repositoryError('export_content_blocked', '章节正文校验失败，已阻止导出', 409);
        }
        latestByChapter.set(chapterNo, { chapterNo, content });
      }
      return Array.from(latestByChapter.values());
    });
  }

  /** 从编辑器 state 提取对应资料正文，避免 profile 保存覆盖结构化资料权威值。 */
  function resourcePayloadFromState(state, resource) {
    const resourceId = String(resource && resource.id || '');
    const resourcePayload = resource && resource.payload && typeof resource.payload === 'object' && !Array.isArray(resource.payload)
      ? resource.payload
      : {};
    const entities = state && state.knowledge && state.knowledge.entities;
    const entity = Array.isArray(entities)
      ? entities.find(item => item && String(item.id || '') === resourceId)
      : entities && typeof entities === 'object' ? entities[resourceId] : null;
    const relation = state && state.knowledge && Array.isArray(state.knowledge.edges)
      ? state.knowledge.edges.find(item => item && String(item.id || '') === resourceId)
      : null;
    const listValues = {
      foreshadow: state && Array.isArray(state.foreshadows) ? state.foreshadows : [],
      timeline: state && Array.isArray(state.timeline) ? state.timeline : []
    };
    const assetKeys = {
      worldbuilding: 'worldbuilding',
      'world-rule': 'worldRules',
      culture: 'cultures',
      'history-event': 'history',
      'power-system': 'powerSystems',
      item: 'items',
      ability: 'abilities',
      term: 'terms',
      material: 'materials',
      highlight: 'highlights',
      'writing-task': 'writingTasks',
      issue: 'issues'
    };
    let current = entity;
    if (resource.kind === 'relation') current = relation;
    if (resource.kind === 'foreshadow' || resource.kind === 'timeline') {
      current = listValues[resource.kind].find(item => item && String(item.id || '') === resourceId);
    }
    if (assetKeys[resource.kind]) {
      const assets = state && state.creationAssets && Array.isArray(state.creationAssets[assetKeys[resource.kind]])
        ? state.creationAssets[assetKeys[resource.kind]]
        : [];
      current = assets.find(item => item && String(item.id || '') === resourceId);
    }
    if (!current || typeof current !== 'object' || Array.isArray(current)) return resourcePayload;
    return { ...resourcePayload, ...current, id: resourceId };
  }

  /** 按资源版本 CAS 同步旧编辑器投影，冲突时回滚 profile 与资源的整笔更新（批量预查消除 N+1 往返）。 */
  async function syncStructuredResourceProjection(client, access, state, actorUuid) {
    const resources = state && Array.isArray(state.projectResources) ? state.projectResources : [];
    const prepared = [];
    for (const resource of resources) {
      const kind = String(resource && resource.kind || '').trim().toLowerCase();
      const resourceId = String(resource && resource.id || '').trim();
      if (!RESOURCE_KINDS.has(kind) || !resourceId) continue;
      const payload = resourcePayloadFromState(state, resource);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
      prepared.push({
        resource,
        kind,
        resourceId,
        uuid: internalUuid(resourceId),
        payload,
        serialized: JSON.stringify(payload),
        expectedRevision: Number(resource.revision)
      });
    }
    if (!prepared.length) return;
    const uniqueUuids = [...new Set(prepared.map(item => item.uuid))];
    const existingResult = await client.query(
      `SELECT id, kind, revision, payload, status, deleted_at
       FROM luna.project_resources
       WHERE workspace_id = $1::uuid AND project_id = $2::uuid
         AND id = ANY($3::uuid[])
       ORDER BY id ASC
       FOR UPDATE`,
      [access.workspace_uuid, access.project_uuid, uniqueUuids]
    );
    const existingByKey = new Map();
    for (const row of existingResult.rows) {
      existingByKey.set(`${String(row.kind || '').toLowerCase()}:${String(row.id || '').toLowerCase()}`, row);
    }
    for (const item of prepared) {
      const { resource, kind, resourceId, uuid, payload, serialized, expectedRevision } = item;
      const rowKey = `${kind}:${uuid.toLowerCase()}`;
      const currentRow = existingByKey.get(rowKey);
      if (!currentRow) {
        await client.query(
          `INSERT INTO luna.project_resources
            (workspace_id, project_id, id, legacy_id, kind, payload, revision, status, created_by, deleted_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::jsonb, 1, 'active', $7::uuid, NULL)`,
          [access.workspace_uuid, access.project_uuid, uuid, resourceId, kind, serialized, actorUuid]
        );
        await client.query(
          `INSERT INTO luna.project_resource_versions
            (workspace_id, project_id, resource_id, revision, payload, changed_by, change_reason)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 1, $4::jsonb, $5::uuid, '编辑器 state 同步')`,
          [access.workspace_uuid, access.project_uuid, uuid, serialized, actorUuid]
        );
        existingByKey.set(rowKey, { id: uuid, kind, revision: 1, payload, status: 'active', deleted_at: null });
        continue;
      }
      if (Number.isInteger(expectedRevision) && expectedRevision > 0 && Number(currentRow.revision) !== expectedRevision) {
        throw repositoryError('revision_conflict', '结构化资料已被其他设备更新，请重新读取后保存', 412);
      }
      if (
        projectPackage.sha256(parseJsonDocument(currentRow.payload)) === projectPackage.sha256(payload) &&
        String(currentRow.status || 'active') === String(resource.status || 'active')
      ) continue;
      const nextRevision = Number(currentRow.revision) + 1;
      const nextStatus = ['active', 'archived', 'deleted'].includes(String(resource.status || ''))
        ? String(resource.status)
        : 'active';
      await client.query(
        `UPDATE luna.project_resources
         SET payload = $5::jsonb, revision = $6::bigint, status = $7::text,
             deleted_at = CASE WHEN $7::text = 'deleted' THEN now() ELSE NULL END, updated_at = now()
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid
           AND kind = $3::text AND id = $4::uuid AND revision = $8::bigint`,
        [access.workspace_uuid, access.project_uuid, kind, uuid, serialized, nextRevision, nextStatus, currentRow.revision]
      );
      await client.query(
        `INSERT INTO luna.project_resource_versions
          (workspace_id, project_id, resource_id, revision, payload, changed_by, change_reason)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::jsonb, $6::uuid, '编辑器 state 同步')`,
        [access.workspace_uuid, access.project_uuid, uuid, nextRevision, serialized, actorUuid]
      );
      existingByKey.set(rowKey, { id: uuid, kind, revision: nextRevision, payload, status: nextStatus, deleted_at: nextStatus === 'deleted' ? new Date() : null });
    }
  }

  /** 保存整本作品 state，首次创建和后续覆盖均在同一事务内完成并支持 CAS。 */
  async function saveProfile(input) {
    const payload = input && input.state;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw repositoryError('invalid_state', '作品 state 非法', 422);
    }
    const title = String(input.title || payload.title || '未命名小说').trim().slice(0, 200) || '未命名小说';
    return withTransaction(input.userId, async client => {
      const scope = await ensureScope(client, {
        userId: input.userId,
        workspaceId: input.workspaceId,
        workspaceName: input.workspaceName,
        projectId: input.projectId,
        title
      });
      if (!hasRole(scope.access, PROJECT_WRITE_ROLES)) throw repositoryError('forbidden', '当前账户无权修改该项目', 403);
      const serialized = JSON.stringify(payload);
      const current = await client.query(
        `SELECT revision
         FROM luna.project_profiles
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid
         FOR UPDATE`,
        [scope.workspaceUuid, scope.projectUuid]
      );
      const expectedRevision = input.expectedRevision == null ? null : Number(input.expectedRevision);
      let revision;
      if (!current.rows.length) {
        if (expectedRevision != null && expectedRevision !== 0) {
          throw repositoryError('revision_conflict', '作品资料版本已变化，请重新读取', 412);
        }
        const inserted = await client.query(
          `INSERT INTO luna.project_profiles
            (workspace_id, project_id, revision, payload, changed_by)
           VALUES ($1::uuid, $2::uuid, 1, $3::jsonb, $4::uuid)
           RETURNING revision`,
          [scope.workspaceUuid, scope.projectUuid, serialized, internalUuid(input.userId)]
        );
        revision = Number(inserted.rows[0].revision) || 1;
        await client.query(
          `UPDATE luna.projects
           SET title = $3::text, revision = GREATEST(revision, $4::bigint), updated_at = now()
           WHERE workspace_id = $1::uuid AND id = $2::uuid`,
          [scope.workspaceUuid, scope.projectUuid, title, revision]
        );
      } else {
        if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
          throw repositoryError('revision_required', '保存作品资料必须提供当前 revision', 428);
        }
        const updated = await client.query(
          `UPDATE luna.project_profiles
           SET payload = $3::jsonb, revision = revision + 1, changed_by = $4::uuid, updated_at = now()
           WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND revision = $5::bigint
           RETURNING revision`,
          [scope.workspaceUuid, scope.projectUuid, serialized, internalUuid(input.userId), expectedRevision]
        );
        if (!updated.rows.length) throw repositoryError('revision_conflict', '作品已在其他设备更新，请重新读取最新版本', 412);
        revision = Number(updated.rows[0].revision) || expectedRevision + 1;
        await client.query(
          `UPDATE luna.projects
           SET title = $3::text, revision = $4::bigint, updated_at = now()
           WHERE workspace_id = $1::uuid AND id = $2::uuid`,
          [scope.workspaceUuid, scope.projectUuid, title, revision]
        );
      }
      await syncStructuredResourceProjection(client, scope.access, payload, internalUuid(input.userId));
      return {
        ok: true,
        id: scope.projectId,
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        wordCount: Number(input.wordCount) || 0,
        updatedAt: Date.now(),
        revision
      };
    });
  }

  /** 在 profile JSONB 内按场景路径更新正文，避免回写客户端读取的整本旧 state。 */
  async function patchProfileScene(input) {
    const userId = normalizeLegacyId(input && input.userId, 'userId');
    const expectedRevision = Number(input && input.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      throw repositoryError('revision_required', '场景差量必须提供当前 revision', 428);
    }
    const { locateScene, hashSceneText, applySceneOperations } = require('./generation/scene-patch');
    return withTransaction(userId, async client => {
      const actorUuid = await ensureActor(client, userId);
      const access = await accessForClient(client, input.projectId, input.workspaceId || '');
      if (!hasRole(access, PROJECT_WRITE_ROLES)) throw repositoryError('not_found', '小说不存在或无权访问', 404);
      const profileResult = await client.query(
        `SELECT revision, payload FROM luna.project_profiles
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid
         FOR UPDATE`,
        [access.workspace_uuid, access.project_uuid]
      );
      if (!profileResult.rows.length) throw repositoryError('not_found', '小说不存在或无权访问', 404);
      const row = profileResult.rows[0];
      const revision = Number(row.revision) || 0;
      if (revision !== expectedRevision) throw repositoryError('revision_conflict', '小说 revision 已变化，请重新读取', 409);
      const state = parseJsonValue(row.payload);
      const located = locateScene(state, input.chapterId, input.sceneId);
      if (!located) throw repositoryError('scene_not_found', '指定章节或场景不存在', 404);
      const currentText = String(located.scene.content == null ? '' : located.scene.content);
      if (hashSceneText(currentText) !== String(input.baseHash || '').toLowerCase()) {
        throw repositoryError('base_hash_conflict', '场景正文已变化，请重新读取后合并', 409);
      }
      const nextText = applySceneOperations(currentText, input.operations);
      const byteLimit = Math.max(0, Number(input.maxStateBytes) || 0);
      located.scene.content = nextText;
      if (byteLimit && Buffer.byteLength(JSON.stringify(state), 'utf8') > byteLimit) {
        throw repositoryError('state_too_large', '单本小说数据过大', 413);
      }
      const updated = await client.query(
        `UPDATE luna.project_profiles
         SET payload = jsonb_set(payload, $3::text[], to_jsonb($4::text), true),
             revision = revision + 1, changed_by = $5::uuid, updated_at = now()
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND revision = $6::bigint
         RETURNING revision`,
        [access.workspace_uuid, access.project_uuid, located.path, nextText, actorUuid, expectedRevision]
      );
      if (!updated.rows.length) throw repositoryError('revision_conflict', '小说 revision 已变化，请重新读取', 409);
      const nextRevision = Number(updated.rows[0].revision) || expectedRevision + 1;
      await client.query(
        `UPDATE luna.projects SET revision = $3::bigint, updated_at = now()
         WHERE workspace_id = $1::uuid AND id = $2::uuid`,
        [access.workspace_uuid, access.project_uuid, nextRevision]
      );
      return {
        ok: true, id: String(input.projectId), workspaceId: access.workspace_id,
        projectId: String(input.projectId), revision: nextRevision,
        contentHash: hashSceneText(nextText)
      };
    });
  }

  /** 软删除项目并保留正文、资料和历史，只有 owner 可以执行。 */
  async function deleteProject(userId, projectId, workspaceId = '') {
    return withTransaction(userId, async client => {
      await ensureActor(client, userId);
      const access = await accessForClient(client, projectId, workspaceId);
      if (!access) throw repositoryError('not_found', '项目不存在或无权访问', 404);
      if (access.role !== 'owner') throw repositoryError('forbidden', '只有项目 owner 可以删除作品', 403);
      const result = await client.query(
        `UPDATE luna.projects
         SET status = 'deleted', revision = revision + 1, updated_at = now()
         WHERE workspace_id = $1::uuid AND id = $2::uuid AND status = 'active'`,
        [access.workspace_uuid, access.project_uuid]
      );
      return { ok: true, id: String(projectId), deleted: result.rowCount };
    });
  }

  /** 恢复软删除项目，恢复动作由 PostgreSQL 安全定义函数校验 owner。 */
  async function restoreProject(userId, projectId) {
    return withTransaction(userId, async client => {
      await ensureActor(client, userId);
      const result = await client.query(
        'SELECT luna.restore_project_by_id($1::uuid) AS restored',
        [internalUuid(normalizeLegacyId(projectId, 'projectId'))]
      );
      const restored = result.rows[0] && (result.rows[0].restored === true || result.rows[0].restored === 't');
      const access = restored ? await accessForClient(client, projectId) : null;
      return {
        ok: true,
        id: String(projectId),
        restored,
        workspaceId: access ? access.workspace_id : '',
        projectId: String(projectId)
      };
    });
  }

  /** 读取当前项目的全部资料资源，供导出和生成上下文使用。 */
  async function listAllResources(userId, projectId, workspaceId = '', includeDeleted = true) {
    return withTransaction(userId, async client => {
      await ensureActor(client, userId);
      const access = await accessForClient(client, projectId, workspaceId);
      if (!access) return null;
      return resourcesForClient(client, access, '', includeDeleted);
    });
  }

  /** 按项目类型读取资料列表或单条资料。 */
  async function listResources(userId, projectId, kind, resourceId = '', workspaceId = '', includeDeleted = false) {
    const normalizedKind = String(kind || '').trim().toLowerCase();
    if (!RESOURCE_KINDS.has(normalizedKind)) throw repositoryError('resource_kind_invalid', '不支持的资料类型', 422);
    return withTransaction(userId, async client => {
      await ensureActor(client, userId);
      const access = await accessForClient(client, projectId, workspaceId);
      if (!access || !hasRole(access, PROJECT_READ_ROLES)) return null;
      if (resourceId) return resourceForClient(client, access, normalizedKind, resourceId, includeDeleted);
      return resourcesForClient(client, access, normalizedKind, includeDeleted);
    });
  }

  async function listResourceVersions(input) {
    const kind = String(input.kind || '').trim().toLowerCase();
    if (!RESOURCE_KINDS.has(kind)) throw repositoryError('resource_kind_invalid', '不支持的资料类型', 422);
    return withTransaction(input.userId, async client => {
      await ensureActor(client, input.userId);
      const access = await accessForClient(client, input.projectId, input.workspaceId);
      if (!access || !hasRole(access, PROJECT_READ_ROLES)) return null;
      const resource = await resourceForClient(client, access, kind, input.resourceId, true);
      if (!resource) return null;
      const result = await client.query(
        `SELECT rv.revision, rv.payload, rv.change_reason, rv.created_at,
                actor.legacy_id AS changed_by_legacy_id
         FROM luna.project_resource_versions rv
         LEFT JOIN luna.users actor ON actor.id = rv.changed_by
         WHERE rv.workspace_id = $1::uuid AND rv.project_id = $2::uuid AND rv.resource_id = $3::uuid
         ORDER BY rv.revision DESC LIMIT 200`,
        [access.workspace_uuid, access.project_uuid, internalUuid(input.resourceId)]
      );
      return result.rows.map(row => ({
        revision: Number(row.revision) || 1,
        payload: parseJsonValue(row.payload),
        changedBy: String(row.changed_by_legacy_id || ''),
        changeReason: String(row.change_reason || ''),
        createdAt: row.created_at ? new Date(row.created_at).getTime() : 0
      }));
    });
  }

  async function restoreResourceVersion(input) {
    const kind = String(input.kind || '').trim().toLowerCase();
    if (!RESOURCE_KINDS.has(kind)) throw repositoryError('resource_kind_invalid', '不支持的资料类型', 422);
    const expectedRevision = Number(input.expectedRevision);
    const targetRevision = Number(input.targetRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw repositoryError('revision_required', '历史版本恢复必须提供当前revision', 428);
    if (!Number.isInteger(targetRevision) || targetRevision < 1) throw repositoryError('history_revision_invalid', '目标历史版本无效', 422);
    return withTransaction(input.userId, async client => {
      await ensureActor(client, input.userId);
      const access = await accessForClient(client, input.projectId, input.workspaceId);
      if (!access || !hasRole(access, PROJECT_WRITE_ROLES) && !(access.role === 'reviewer' && kind === 'issue')) {
        throw repositoryError('forbidden', '当前账户无权恢复该资料', 403);
      }
      const current = await resourceForClient(client, access, kind, input.resourceId, true);
      if (!current) return { ok: false, code: 'resource_missing' };
      if (current.revision !== expectedRevision) return { ok: false, code: 'revision_conflict', current };
      const historical = await client.query(
        `SELECT payload FROM luna.project_resource_versions
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid
           AND resource_id = $3::uuid AND revision = $4::bigint`,
        [access.workspace_uuid, access.project_uuid, internalUuid(input.resourceId), targetRevision]
      );
      if (!historical.rows.length) return { ok: false, code: 'resource_version_missing' };
      const payload = normalizeProjectResourcePayload(parseJsonValue(historical.rows[0].payload), access, kind);
      await validateProjectResourceReferences(client, access, payload, kind);
      const serialized = JSON.stringify(payload);
      const nextRevision = expectedRevision + 1;
      const changed = await client.query(
        `UPDATE luna.project_resources
         SET payload = $5::jsonb, status = 'active', deleted_at = NULL,
             revision = revision + 1, updated_at = now()
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid
           AND id = $3::uuid AND kind = $4::text AND revision = $6::bigint
         RETURNING revision`,
        [access.workspace_uuid, access.project_uuid, internalUuid(input.resourceId), kind, serialized, expectedRevision]
      );
      if (!changed.rowCount) return { ok: false, code: 'revision_conflict', current: await resourceForClient(client, access, kind, input.resourceId, true) };
      await client.query(
        `INSERT INTO luna.project_resource_versions
          (workspace_id, project_id, resource_id, revision, payload, changed_by, change_reason)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::jsonb, $6::uuid, $7::text)`,
        [access.workspace_uuid, access.project_uuid, internalUuid(input.resourceId), nextRevision, serialized,
          internalUuid(input.userId), String(input.changeReason || `恢复历史版本 v${targetRevision}`)]
      );
      return { ok: true, resource: await resourceForClient(client, access, kind, input.resourceId) };
    });
  }

  /** 创建结构化资料并写入不可变首版本。 */
  async function createResource(input) {
    const normalizedKind = String(input.kind || '').trim().toLowerCase();
    if (!RESOURCE_KINDS.has(normalizedKind)) throw repositoryError('resource_kind_invalid', '不支持的资料类型', 422);
    if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
      throw repositoryError('resource_payload_invalid', '资料负载必须是 JSON 对象', 422);
    }
    const resourceId = normalizeLegacyId(input.id || `${normalizedKind}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`, 'resourceId');
    const status = ['active', 'archived', 'deleted'].includes(String(input.status || ''))
      ? String(input.status)
      : 'active';
    return withTransaction(input.userId, async client => {
      await ensureActor(client, input.userId);
      const access = await accessForClient(client, input.projectId, input.workspaceId);
      if (!access || !hasRole(access, PROJECT_WRITE_ROLES) && !(access.role === 'reviewer' && normalizedKind === 'issue')) {
        throw repositoryError('forbidden', '当前账户无权创建该资料', 403);
      }
      const payload = normalizeProjectResourcePayload(input.payload, access, normalizedKind);
      await validateProjectResourceReferences(client, access, payload, normalizedKind);
      const serialized = JSON.stringify(payload);
      await client.query(
        `INSERT INTO luna.project_resources
          (workspace_id, project_id, id, legacy_id, kind, payload, revision, status, created_by, deleted_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::jsonb, 1, $7::text, $8::uuid, $9::timestamptz)`,
        [access.workspace_uuid, access.project_uuid, internalUuid(resourceId), resourceId, normalizedKind, serialized, status, internalUuid(input.userId), status === 'deleted' ? new Date() : null]
      );
      await client.query(
        `INSERT INTO luna.project_resource_versions
          (workspace_id, project_id, resource_id, revision, payload, changed_by, change_reason)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 1, $4::jsonb, $5::uuid, $6::text)`,
        [access.workspace_uuid, access.project_uuid, internalUuid(resourceId), serialized, internalUuid(input.userId), String(input.changeReason || '创建资料')]
      );
      return { ok: true, resource: await resourceForClient(client, access, normalizedKind, resourceId) };
    });
  }

  /** 使用 If-Match revision 更新资料，并保留旧版本记录。 */
  async function updateResource(input) {
    const normalizedKind = String(input.kind || '').trim().toLowerCase();
    if (!RESOURCE_KINDS.has(normalizedKind)) throw repositoryError('resource_kind_invalid', '不支持的资料类型', 422);
    if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
      throw repositoryError('resource_payload_invalid', '资料负载必须是 JSON 对象', 422);
    }
    const expectedRevision = Number(input.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw repositoryError('revision_required', '资料更新必须提供当前 revision', 428);
    return withTransaction(input.userId, async client => {
      await ensureActor(client, input.userId);
      const access = await accessForClient(client, input.projectId, input.workspaceId);
      if (!access || !hasRole(access, PROJECT_WRITE_ROLES) && !(access.role === 'reviewer' && normalizedKind === 'issue')) {
        throw repositoryError('forbidden', '当前账户无权更新该资料', 403);
      }
      const payload = normalizeProjectResourcePayload(input.payload, access, normalizedKind);
      await validateProjectResourceReferences(client, access, payload, normalizedKind);
      const serialized = JSON.stringify(payload);
      const updated = await client.query(
        `UPDATE luna.project_resources
         SET payload = $5::jsonb, revision = revision + 1, updated_at = now()
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid
           AND id = $3::uuid AND kind = $4::text AND revision = $6::bigint
           AND deleted_at IS NULL
         RETURNING revision`,
        [access.workspace_uuid, access.project_uuid, internalUuid(input.resourceId), normalizedKind, serialized, expectedRevision]
      );
      if (!updated.rows.length) {
        const current = await resourceForClient(client, access, normalizedKind, input.resourceId, true);
        if (!current) throw repositoryError('resource_missing', '资料不存在或已删除', 404);
        return { ok: false, code: 'revision_conflict', current };
      }
      const revision = Number(updated.rows[0].revision) || expectedRevision + 1;
      await client.query(
        `INSERT INTO luna.project_resource_versions
          (workspace_id, project_id, resource_id, revision, payload, changed_by, change_reason)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::jsonb, $6::uuid, $7::text)`,
        [access.workspace_uuid, access.project_uuid, internalUuid(input.resourceId), revision, serialized, internalUuid(input.userId), String(input.changeReason || '更新资料')]
      );
      return { ok: true, resource: await resourceForClient(client, access, normalizedKind, input.resourceId) };
    });
  }

  /** 软删除资料，保留当前版本和历史版本链。 */
  async function deleteResource(input) {
    const kind = String(input.kind || '').trim().toLowerCase();
    if (!RESOURCE_KINDS.has(kind)) throw repositoryError('resource_kind_invalid', '不支持的资料类型', 422);
    const expectedRevision = Number(input.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw repositoryError('revision_required', '资料删除必须提供当前 revision', 428);
    return withTransaction(input.userId, async client => {
      await ensureActor(client, input.userId);
      const access = await accessForClient(client, input.projectId, input.workspaceId);
      if (!access || !hasRole(access, PROJECT_WRITE_ROLES)) throw repositoryError('forbidden', '当前账户无权删除该资料', 403);
      const result = await client.query(
        `UPDATE luna.project_resources
         SET status = 'deleted', deleted_at = now(), revision = revision + 1, updated_at = now()
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid
           AND id = $3::uuid AND kind = $4::text AND revision = $5::bigint
           AND deleted_at IS NULL`,
        [access.workspace_uuid, access.project_uuid, internalUuid(input.resourceId), kind, expectedRevision]
      );
      if (!result.rowCount) {
        const current = await resourceForClient(client, access, kind, input.resourceId, true);
        if (!current) throw repositoryError('resource_missing', '资料不存在或已删除', 404);
        return { ok: false, code: 'revision_conflict', current };
      }
      const current = await resourceForClient(client, access, kind, input.resourceId, true);
      await client.query(
        `INSERT INTO luna.project_resource_versions
          (workspace_id, project_id, resource_id, revision, payload, changed_by, change_reason)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::jsonb, $6::uuid, $7::text)`,
        [access.workspace_uuid, access.project_uuid, internalUuid(input.resourceId), current.revision, JSON.stringify(current.payload), internalUuid(input.userId), String(input.changeReason || '删除资料')]
      );
      return { ok: true, resource: current };
    });
  }

  /** 恢复软删除资料并追加恢复版本，不重置资料 ID。 */
  async function restoreResource(input) {
    const kind = String(input.kind || '').trim().toLowerCase();
    if (!RESOURCE_KINDS.has(kind)) throw repositoryError('resource_kind_invalid', '不支持的资料类型', 422);
    const expectedRevision = Number(input.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw repositoryError('revision_required', '资料恢复必须提供当前 revision', 428);
    return withTransaction(input.userId, async client => {
      await ensureActor(client, input.userId);
      const access = await accessForClient(client, input.projectId, input.workspaceId);
      if (!access || !hasRole(access, PROJECT_WRITE_ROLES)) throw repositoryError('forbidden', '当前账户无权恢复该资料', 403);
      const result = await client.query(
        `UPDATE luna.project_resources
         SET status = 'active', deleted_at = NULL, revision = revision + 1, updated_at = now()
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid
           AND id = $3::uuid AND kind = $4::text AND revision = $5::bigint
           AND deleted_at IS NOT NULL`,
        [access.workspace_uuid, access.project_uuid, internalUuid(input.resourceId), kind, expectedRevision]
      );
      if (!result.rowCount) {
        const current = await resourceForClient(client, access, kind, input.resourceId, true);
        if (!current) throw repositoryError('resource_missing', '资料不存在或未处于删除状态', 404);
        return { ok: false, code: 'revision_conflict', current };
      }
      const current = await resourceForClient(client, access, kind, input.resourceId, true);
      await client.query(
        `INSERT INTO luna.project_resource_versions
          (workspace_id, project_id, resource_id, revision, payload, changed_by, change_reason)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::jsonb, $6::uuid, $7::text)`,
        [access.workspace_uuid, access.project_uuid, internalUuid(input.resourceId), current.revision, JSON.stringify(current.payload), internalUuid(input.userId), String(input.changeReason || '恢复资料')]
      );
      return { ok: true, resource: current };
    });
  }

  /** 恢复导出包中的创作域版本和兼容负载，运行中任务统一转为待核对状态。 */
  async function restoreCreationPackageData(client, access, input, actorUuid) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return;
    const books = Array.isArray(input.books) ? input.books : [];
    const bibleVersions = Array.isArray(input.bibleVersions) ? input.bibleVersions : [];
    const snapshots = Array.isArray(input.snapshots) ? input.snapshots : [];
    const jobs = Array.isArray(input.jobs) ? input.jobs : [];
    const jobInputs = Array.isArray(input.jobInputs) ? input.jobInputs : [];
    const legacyPayloads = Array.isArray(input.legacyPayloads) ? input.legacyPayloads : [];
    const ownerUuid = internalUuid(access.owner_user_id || actorUuid);
    const dateValue = value => {
      const timestamp = Number(value);
      return Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp) : new Date();
    };
    const statusMap = { active: 'ready', ready: 'ready', draft: 'draft', generating: 'generating', archived: 'archived' };
    const bookIds = new Map();
    for (const source of books) {
      const bookId = normalizeLegacyId(source && source.id, 'bookId');
      const internalBookId = internalUuid(bookId);
      const status = statusMap[String(source.status || '').toLowerCase()] || 'draft';
      const plan = source.plan && typeof source.plan === 'object' && !Array.isArray(source.plan) ? source.plan : {};
      const current = await client.query(
        `SELECT owner_user_id, title, status, plan, current_state_version, current_chapter_no,
                source_brief_id, budget_limit, spent_cost
         FROM luna.creation_books
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND id = $3::uuid
         FOR UPDATE`,
        [access.workspace_uuid, access.project_uuid, internalBookId]
      );
      if (current.rows.length) {
        const row = current.rows[0];
        const same = String(row.owner_user_id) === ownerUuid &&
          String(row.title || '') === String(source.title || '') &&
          String(row.status || '') === status &&
          projectPackage.sha256(parseJsonDocument(row.plan) || {}) === projectPackage.sha256(plan) &&
          Number(row.current_state_version) === Math.max(0, Number(source.currentStateVersion) || 0) &&
          Number(row.current_chapter_no) === Math.max(0, Number(source.currentChapterNo) || 0) &&
          Number(row.budget_limit) === Math.max(0, Number(source.budgetLimit) || 0) &&
          Number(row.spent_cost) === Math.max(0, Number(source.spentCost) || 0);
        if (!same) throw repositoryError('restore_conflict', `创作书 ${bookId} 已存在不同版本`, 409);
      } else {
        await client.query(
          `INSERT INTO luna.creation_books
            (workspace_id, project_id, id, legacy_id, owner_user_id, title, status, plan,
             revision, source_brief_id, current_state_version, current_chapter_no,
             budget_limit, spent_cost, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::uuid, $6::text, $7::text, $8::jsonb,
                   1, $9::text, $10::bigint, $11::integer, $12::numeric, $13::numeric,
                   $14::timestamptz, $15::timestamptz)`,
          [
            access.workspace_uuid, access.project_uuid, internalBookId, bookId, ownerUuid,
            String(source.title || '').slice(0, 200), status, JSON.stringify(plan),
            String(source.sourceBriefId || '').slice(0, 160),
            Math.max(0, Number(source.currentStateVersion) || 0),
            Math.max(0, Number(source.currentChapterNo) || 0),
            Math.max(0, Number(source.budgetLimit) || 0),
            Math.max(0, Number(source.spentCost) || 0),
            dateValue(source.createdAt), dateValue(source.updatedAt || source.createdAt)
          ]
        );
      }
      bookIds.set(bookId, internalBookId);
    }
    for (const source of bibleVersions) {
      const bookId = normalizeLegacyId(source && source.bookId, 'bookId');
      const internalBookId = bookIds.get(bookId);
      const revision = Number(source && source.version);
      const bibleId = normalizeLegacyId(source && source.bibleId, 'bibleId');
      if (!internalBookId || !Number.isInteger(revision) || revision < 1) {
        throw repositoryError('restore_invalid', '恢复包中的 Bible 版本引用无效', 422);
      }
      const payload = source.payload === undefined ? {} : source.payload;
      const current = await client.query(
        `SELECT payload
         FROM luna.creation_bibles
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid
           AND book_id = $3::uuid AND revision = $4::bigint
         FOR UPDATE`,
        [access.workspace_uuid, access.project_uuid, internalBookId, revision]
      );
      if (current.rows.length) {
        if (projectPackage.sha256(parseJsonDocument(current.rows[0].payload)) !== projectPackage.sha256(payload)) {
          throw repositoryError('restore_conflict', `Bible ${bibleId} v${revision} 已存在不同版本`, 409);
        }
        continue;
      }
      await client.query(
        `INSERT INTO luna.creation_bibles
          (workspace_id, project_id, book_id, legacy_id, revision, payload, payload_hash, changed_by, created_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::bigint, $6::jsonb, $7::text, $8::uuid, $9::timestamptz)`,
        [
          access.workspace_uuid, access.project_uuid, internalBookId, bibleId, revision,
          JSON.stringify(payload), jsonHash(payload), actorUuid, dateValue(source.createdAt)
        ]
      );
    }
    for (const source of snapshots) {
      const snapshotId = normalizeLegacyId(source && source.id, 'snapshotId');
      const payload = source.payload && typeof source.payload === 'object' && !Array.isArray(source.payload) ? source.payload : {};
      const internalSnapshotId = internalUuid(snapshotId);
      const current = await client.query(
        `SELECT legacy_id, input_hash, payload
         FROM luna.context_snapshots
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND id = $3::uuid
         FOR UPDATE`,
        [access.workspace_uuid, access.project_uuid, internalSnapshotId]
      );
      const inputHash = projectPackage.sha256(payload);
      if (current.rows.length) {
        if (projectPackage.sha256(parseJsonDocument(current.rows[0].payload)) !== inputHash) {
          throw repositoryError('restore_conflict', `状态快照 ${snapshotId} 已存在不同版本`, 409);
        }
        continue;
      }
      await client.query(
        `INSERT INTO luna.context_snapshots
          (workspace_id, project_id, id, legacy_id, bible_revision, state_revision, input_hash, payload, created_by, created_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::bigint, $6::bigint, $7::text, $8::jsonb, $9::uuid, $10::timestamptz)`,
        [
          access.workspace_uuid, access.project_uuid, internalSnapshotId, snapshotId,
          Math.max(0, Number(source.bibleVersion) || 0), Math.max(0, Number(source.stateVersion) || 0),
          inputHash, JSON.stringify(payload), actorUuid, dateValue(source.createdAt)
        ]
      );
    }
    const importedJobs = new Map();
    for (const source of jobs) {
      const jobId = normalizeLegacyId(source && source.id, 'jobId');
      const internalJobId = internalUuid(jobId);
      const originalState = String(source.state || 'failed');
      const state = ['queued', 'claimed', 'running'].includes(originalState) ? 'provider_unknown' : JOB_STATES.has(originalState) ? originalState : 'failed';
      const inputHash = /^[0-9a-f]{64}$/i.test(String(source.inputHash || ''))
        ? String(source.inputHash).toLowerCase()
        : jsonHash({ jobId });
      const result = source.result && typeof source.result === 'object' && !Array.isArray(source.result) ? source.result : null;
      const current = await client.query(
        `SELECT state, input_hash, result
         FROM luna.jobs
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND id = $3::uuid
         FOR UPDATE`,
        [access.workspace_uuid, access.project_uuid, internalJobId]
      );
      if (current.rows.length) {
        if (
          String(current.rows[0].state) !== state ||
          String(current.rows[0].input_hash) !== inputHash ||
          projectPackage.sha256(parseJsonDocument(current.rows[0].result)) !== projectPackage.sha256(result)
        ) {
          throw repositoryError('restore_conflict', `任务 ${jobId} 已存在不同状态`, 409);
        }
      } else {
        await client.query(
          `INSERT INTO luna.jobs
            (workspace_id, project_id, id, legacy_id, requested_by, kind, state, attempt_no,
             fencing_token, input_hash, result, error_code, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::uuid, 'restored', $6::text, 0,
                   0, $7::text, $8::jsonb, $9::text, $10::timestamptz, $11::timestamptz)`,
          [
            access.workspace_uuid, access.project_uuid, internalJobId, jobId, actorUuid, state,
            inputHash, result === null ? null : JSON.stringify(result), String(source.errorCode || '').slice(0, 120),
            dateValue(source.createdAt), dateValue(source.updatedAt || source.createdAt)
          ]
        );
        await client.query(
          `INSERT INTO luna.job_events
            (workspace_id, project_id, job_id, event_seq, state, payload)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 1, $4::text, $5::jsonb)`,
          [access.workspace_uuid, access.project_uuid, internalJobId, state, JSON.stringify({ source: 'package-restore', originalState })]
        );
      }
      importedJobs.set(jobId, internalJobId);
    }
    for (const source of jobInputs) {
      const jobId = normalizeLegacyId(source && source.jobId, 'jobId');
      const internalJobId = importedJobs.get(jobId) || internalUuid(jobId);
      const payload = source.payload === undefined ? null : source.payload;
      const inputHash = projectPackage.sha256(payload);
      const current = await client.query(
        `SELECT payload_hash
         FROM luna.job_inputs
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND job_id = $3::uuid
         FOR UPDATE`,
        [access.workspace_uuid, access.project_uuid, internalJobId]
      );
      if (current.rows.length) {
        if (String(current.rows[0].payload_hash) !== inputHash) throw repositoryError('restore_conflict', `任务 ${jobId} 的输入已变化`, 409);
        continue;
      }
      await client.query(
        `INSERT INTO luna.job_inputs
          (workspace_id, project_id, job_id, payload, payload_hash, created_by)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5::text, $6::uuid)`,
        [access.workspace_uuid, access.project_uuid, internalJobId, JSON.stringify(payload), inputHash, actorUuid]
      );
    }
    for (const source of legacyPayloads) {
      const sourceKind = normalizeLegacyId(source && source.sourceKind, 'sourceKind');
      const legacyId = normalizeLegacyId(source && source.legacyId, 'legacyId');
      const payload = source.payload === undefined ? null : source.payload;
      const inputHash = projectPackage.sha256(payload);
      const current = await client.query(
        `SELECT payload_hash
         FROM luna.legacy_payloads
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid
           AND source_kind = $3::text AND legacy_id = $4::text
         FOR UPDATE`,
        [access.workspace_uuid, access.project_uuid, sourceKind, legacyId]
      );
      if (current.rows.length) {
        if (
          String(current.rows[0].payload_hash) !== inputHash &&
          String(current.rows[0].payload_hash) !== jsonHash(payload)
        ) {
          throw repositoryError('restore_conflict', `兼容负载 ${sourceKind}/${legacyId} 已变化`, 409);
        }
        continue;
      }
      await client.query(
        `INSERT INTO luna.legacy_payloads
          (workspace_id, project_id, id, source_kind, legacy_id, payload, payload_hash, created_by)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::jsonb, $7::text, $8::uuid)`,
        [
          access.workspace_uuid, access.project_uuid, internalUuid(`${sourceKind}:${legacyId}`),
          sourceKind, legacyId, JSON.stringify(payload), inputHash, actorUuid
        ]
      );
    }
  }

  /** 原子恢复项目资料包，作品 state 与结构化资源不会出现半恢复状态。 */
  async function restorePackage(input) {
    const state = input && input.state;
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      throw repositoryError('invalid_state', '恢复包中的作品 state 非法', 422);
    }
    const resources = input && Array.isArray(input.resources) ? input.resources : [];
    const creation = input && input.creation && typeof input.creation === 'object' && !Array.isArray(input.creation)
      ? input.creation
      : null;
    if (resources.length > 10000) throw repositoryError('resource_count_exceeded', '恢复包资料数量超过限制', 413);
    const title = String(input.title || state.title || '未命名小说').trim().slice(0, 200) || '未命名小说';
    const expectedRevision = Number(input.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw repositoryError('revision_required', '整包恢复必须提供当前作品 revision', 428);
    }
    return withTransaction(input.userId, async client => {
      await ensureActor(client, input.userId);
      const access = await accessForClient(client, input.projectId, input.workspaceId);
      if (!access) throw repositoryError('not_found', '项目不存在或无权恢复', 404);
      if (!['owner', 'admin'].includes(access.role)) throw repositoryError('forbidden', '只有项目管理员可以恢复整包资料', 403);
      const profile = await client.query(
        `SELECT revision
         FROM luna.project_profiles
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid
         FOR UPDATE`,
        [access.workspace_uuid, access.project_uuid]
      );
      const serialized = JSON.stringify(state);
      let revision;
      if (!profile.rows.length) {
        if (expectedRevision !== 0) throw repositoryError('revision_conflict', '作品资料版本已变化，请重新读取', 412);
        const inserted = await client.query(
          `INSERT INTO luna.project_profiles
            (workspace_id, project_id, revision, payload, changed_by)
           VALUES ($1::uuid, $2::uuid, 1, $3::jsonb, $4::uuid)
           RETURNING revision`,
          [access.workspace_uuid, access.project_uuid, serialized, internalUuid(input.userId)]
        );
        revision = Number(inserted.rows[0].revision) || 1;
      } else {
        if (expectedRevision < 1 || Number(profile.rows[0].revision) !== expectedRevision) {
          throw repositoryError('revision_conflict', '作品已在其他设备更新，请重新读取最新版本', 412);
        }
        const updated = await client.query(
          `UPDATE luna.project_profiles
           SET payload = $3::jsonb, revision = revision + 1, changed_by = $4::uuid, updated_at = now()
           WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND revision = $5::bigint
           RETURNING revision`,
          [access.workspace_uuid, access.project_uuid, serialized, internalUuid(input.userId), expectedRevision]
        );
        if (!updated.rows.length) throw repositoryError('revision_conflict', '作品已在其他设备更新，请重新读取最新版本', 412);
        revision = Number(updated.rows[0].revision) || expectedRevision + 1;
      }
      await client.query(
        `UPDATE luna.projects
         SET title = $3::text, revision = $4::bigint, updated_at = now()
         WHERE workspace_id = $1::uuid AND id = $2::uuid`,
        [access.workspace_uuid, access.project_uuid, title, revision]
      );
      for (const source of resources) {
        if (!source || typeof source !== 'object') continue;
        const kind = String(source.kind || '').trim().toLowerCase();
        if (!RESOURCE_KINDS.has(kind)) throw repositoryError('resource_kind_invalid', '恢复包包含不支持的资料类型', 422);
        const resourceId = normalizeLegacyId(source.id, 'resourceId');
        const payload = source.payload && typeof source.payload === 'object' && !Array.isArray(source.payload)
          ? source.payload
          : {};
        const serializedPayload = JSON.stringify(payload);
        const deleted = String(source.status || '') === 'deleted';
        const current = await client.query(
          `SELECT revision, payload, status, deleted_at
           FROM luna.project_resources
           WHERE workspace_id = $1::uuid AND project_id = $2::uuid
             AND id = $3::uuid AND kind = $4::text
           FOR UPDATE`,
          [access.workspace_uuid, access.project_uuid, internalUuid(resourceId), kind]
        );
        if (!current.rows.length) {
          await client.query(
            `INSERT INTO luna.project_resources
              (workspace_id, project_id, id, legacy_id, kind, payload, revision, status, created_by, deleted_at)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::jsonb, 1, $7::text, $8::uuid, $9::timestamptz)`,
            [access.workspace_uuid, access.project_uuid, internalUuid(resourceId), resourceId, kind, serializedPayload, deleted ? 'deleted' : 'active', internalUuid(input.userId), deleted ? new Date() : null]
          );
          await client.query(
            `INSERT INTO luna.project_resource_versions
              (workspace_id, project_id, resource_id, revision, payload, changed_by, change_reason)
             VALUES ($1::uuid, $2::uuid, $3::uuid, 1, $4::jsonb, $5::uuid, '资料包恢复')`,
            [access.workspace_uuid, access.project_uuid, internalUuid(resourceId), serializedPayload, internalUuid(input.userId)]
          );
          continue;
        }
        const currentRow = current.rows[0];
        const currentPayload = parseJsonValue(currentRow.payload);
        const currentDeleted = currentRow.deleted_at !== null || String(currentRow.status || '') === 'deleted';
        if (JSON.stringify(currentPayload) === serializedPayload && currentDeleted === deleted) continue;
        const nextRevision = Number(currentRow.revision) + 1;
        await client.query(
          `UPDATE luna.project_resources
           SET payload = $5::jsonb, revision = $6::bigint, status = $7::text,
               deleted_at = $8::timestamptz, updated_at = now()
           WHERE workspace_id = $1::uuid AND project_id = $2::uuid
             AND id = $3::uuid AND kind = $4::text AND revision = $9::bigint`,
          [access.workspace_uuid, access.project_uuid, internalUuid(resourceId), kind, serializedPayload, nextRevision, deleted ? 'deleted' : 'active', deleted ? new Date() : null, currentRow.revision]
        );
        await client.query(
          `INSERT INTO luna.project_resource_versions
            (workspace_id, project_id, resource_id, revision, payload, changed_by, change_reason)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::jsonb, $6::uuid, '资料包恢复')`,
          [access.workspace_uuid, access.project_uuid, internalUuid(resourceId), nextRevision, serializedPayload, internalUuid(input.userId)]
        );
      }
      await restoreCreationPackageData(client, access, creation, internalUuid(input.userId));
      return { ok: true, id: String(input.projectId), revision, restored: true };
    });
  }

  /** 在项目作用域创建或更新持久任务，并按状态变化追加不可变事件。 */
  async function upsertJob(input) {
    const jobId = normalizeLegacyId(input.jobId, 'jobId');
    const jobState = String(input.state || 'queued');
    if (!JOB_STATES.has(jobState)) throw repositoryError('invalid_job_state', '任务状态无效', 422);
    const projectId = normalizeLegacyId(input.projectId || `n_job_${jobId.replace(/[^A-Za-z0-9]/g, '').slice(0, 28)}`, 'projectId');
    const inputHash = /^[0-9a-f]{64}$/i.test(String(input.inputHash || ''))
      ? String(input.inputHash).toLowerCase()
      : jsonHash(input.input || {});
    const workerId = String(input.workerId || 'molan-worker').trim();
    const workerUuid = internalUuid(workerId);
    const attemptNo = Math.max(0, Math.floor(Number(input.attemptNo) || (['claimed', 'running'].includes(jobState) ? 1 : 0)));
    const fencingToken = Math.max(0, Math.floor(Number(input.fencingToken) || (['claimed', 'running'].includes(jobState) ? 1 : 0)));
    const leaseMs = Math.min(24 * 60 * 60 * 1000, Math.max(30 * 1000, Math.floor(Number(input.leaseMs) || 10 * 60 * 1000)));
    return withTransaction(input.userId, async client => {
      const scope = await ensureScope(client, {
        userId: input.userId,
        workspaceId: input.workspaceId,
        projectId,
        title: String(input.title || '任务项目').slice(0, 200)
      });
      if (!hasRole(scope.access, PROJECT_WRITE_ROLES)) throw repositoryError('forbidden', '当前账户无权创建项目任务', 403);
      if (input.requireSpend === true && !scope.access.can_spend) throw repositoryError('spend_forbidden', '当前账户没有任务支出权限', 403);
      if (input.creationBook && typeof input.creationBook === 'object') {
        await ensureCreationBookPlaceholderForClient(client, scope, {
          ...input.creationBook,
          userId: input.userId
        });
      }
      const current = await client.query(
        `SELECT *
         FROM luna.jobs
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND legacy_id = $3::text
         FOR UPDATE`,
        [scope.workspaceUuid, scope.projectUuid, jobId]
      );
      if (current.rows.length && current.rows[0].state === 'provider_unknown' && ['queued', 'claimed', 'running'].includes(jobState)) {
        throw repositoryError('provider_unknown', '任务结果未知，必须人工核对后才能创建新尝试', 409);
      }
      // 2026-10-19 深度审查 P2-1：乐观状态机守卫。调用方可声明 expectedStates，
      // 仅当锁定行状态仍在期望集合内才允许覆盖；否则视为陈旧快照写入（例如取消路径
      // 快照早于 worker 完成），直接返回数据库当前真实行，杜绝丢更新。
      const expectedStates = Array.isArray(input.expectedStates) && input.expectedStates.length
        ? input.expectedStates.map(state => String(state))
        : null;
      if (expectedStates && current.rows.length && !expectedStates.includes(String(current.rows[0].state))) {
        return { ...publicJob(current.rows[0]), budgetReservation: null, staleStateGuard: true };
      }
      const leaseUntil = ['claimed', 'running'].includes(jobState) ? new Date(Date.now() + leaseMs) : null;
      const resultJson = input.result === undefined || input.result === null ? null : JSON.stringify(input.result);
      let row;
      if (!current.rows.length) {
        const inserted = await client.query(
          `INSERT INTO luna.jobs
            (workspace_id, project_id, id, legacy_id, requested_by, kind, state,
             attempt_no, fencing_token, lease_owner, lease_until, input_hash, result, error_code)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::uuid, $6::text, $7::text,
                   $8::integer, $9::bigint, $10::uuid, $11::timestamptz, $12::text, $13::jsonb, $14::text)
           RETURNING *`,
          [
            scope.workspaceUuid, scope.projectUuid, internalUuid(jobId), jobId, internalUuid(input.userId),
            String(input.kind || 'writing').slice(0, 120), jobState, attemptNo, fencingToken,
            ['claimed', 'running'].includes(jobState) ? workerUuid : null, leaseUntil, inputHash, resultJson, String(input.errorCode || '').slice(0, 120)
          ]
        );
        row = inserted.rows[0];
      } else {
        const updated = await client.query(
          `UPDATE luna.jobs
           SET state = $5::text,
               attempt_no = GREATEST(attempt_no, $6::integer),
               fencing_token = GREATEST(fencing_token, $7::bigint),
               revision = revision + 1,
               lease_owner = $8::uuid, lease_until = $9::timestamptz,
               result = $10::jsonb, error_code = $11::text, updated_at = now()
           WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND id = $3::uuid AND legacy_id = $4::text
           RETURNING *`,
          [
            scope.workspaceUuid, scope.projectUuid, internalUuid(jobId), jobId, jobState,
            attemptNo, fencingToken, ['claimed', 'running'].includes(jobState) ? workerUuid : null,
            leaseUntil, resultJson, String(input.errorCode || '').slice(0, 120)
          ]
        );
        row = updated.rows[0];
      }
      if (input.inputPayload !== undefined) {
        let serializedInput;
        let inputPayloadHash;
        try {
          serializedInput = JSON.stringify(input.inputPayload);
          inputPayloadHash = projectPackage.sha256(input.inputPayload);
        } catch (_) {
          throw repositoryError('job_input_invalid', '任务输入无法序列化', 422);
        }
        const currentInput = await client.query(
          `SELECT payload_hash
           FROM luna.job_inputs
           WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND job_id = $3::uuid
           FOR UPDATE`,
          [scope.workspaceUuid, scope.projectUuid, internalUuid(jobId)]
        );
        if (currentInput.rows.length) {
          if (String(currentInput.rows[0].payload_hash) !== inputPayloadHash) {
            throw repositoryError('idempotency_conflict', '同一任务的输入负载不一致', 409);
          }
        } else {
          await client.query(
            `INSERT INTO luna.job_inputs
              (workspace_id, project_id, job_id, payload, payload_hash, created_by)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5::text, $6::uuid)`,
            [scope.workspaceUuid, scope.projectUuid, internalUuid(jobId), serializedInput, inputPayloadHash, internalUuid(input.userId)]
          );
        }
      }
      const reservedBudget = await reserveJobBudgetForClient(client, scope, row.id, input);
      const eventSequence = await client.query(
        `SELECT COALESCE(MAX(event_seq), 0) + 1 AS next_seq
         FROM luna.job_events
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND job_id = $3::uuid`,
        [scope.workspaceUuid, scope.projectUuid, internalUuid(jobId)]
      );
      await client.query(
        `INSERT INTO luna.job_events
          (workspace_id, project_id, job_id, event_seq, state, payload)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::text, $6::jsonb)`,
        [
          scope.workspaceUuid, scope.projectUuid, internalUuid(jobId),
          Number(eventSequence.rows[0].next_seq) || 1, jobState,
          JSON.stringify({ errorCode: String(input.errorCode || ''), result: input.result === undefined ? null : input.result })
        ]
      );
      return { ...publicJob(row), budgetReservation: reservedBudget };
    });
  }

  /** 读取当前用户可见的持久任务，结果未知状态不会被隐藏或自动改写。
   * 2026-10-19 深度审查 P0-3：补属主过滤（project_members 活跃成员），
   * 修复任意登录用户可凭 jobId 越权读取/取消他人任务的 IDOR。
   * 契约与 scripts/postgres-job-smoke.mjs「未授权用户必须拿到 null」一致。 */
  async function getJob(userId, jobId) {
    return withTransaction(userId, async client => {
      const actorUuid = await ensureActor(client, userId);
      const result = await client.query(
        `SELECT j.*, p.legacy_id AS project_legacy_id, w.legacy_id AS workspace_legacy_id
         FROM luna.jobs j
         JOIN luna.projects p ON p.workspace_id = j.workspace_id AND p.id = j.project_id
         JOIN luna.workspaces w ON w.id = j.workspace_id
         JOIN luna.project_members pm
           ON pm.workspace_id = j.workspace_id AND pm.project_id = j.project_id
          AND pm.user_id = $2::uuid AND pm.active
         WHERE j.legacy_id = $1::text
         ORDER BY j.updated_at DESC
         LIMIT 1`,
        [normalizeLegacyId(jobId, 'jobId'), actorUuid]
      );
      return result.rows[0] ? publicJob(result.rows[0]) : null;
    });
  }

  /** 读取任务预算预占和追加账本，供后台对账与 worker 验收使用。（含与 getJob 一致的属主过滤） */
  async function getJobBudget(userId, jobId) {
    return withTransaction(userId, async client => {
      const actorUuid = await ensureActor(client, userId);
      const result = await client.query(
        `SELECT br.id, br.amount_minor, br.state, br.period_start,
                coalesce(jsonb_agg(jsonb_build_object(
                  'entryType', bl.entry_type, 'amountMinor', bl.amount_minor,
                  'createdAt', bl.created_at
                ) ORDER BY bl.created_at) FILTER (WHERE bl.id IS NOT NULL), '[]'::jsonb) AS ledger
         FROM luna.jobs j
         JOIN luna.budget_reservations br
           ON br.workspace_id = j.workspace_id AND br.project_id = j.project_id AND br.job_id = j.id
         LEFT JOIN luna.billing_ledger bl
           ON bl.workspace_id = br.workspace_id AND bl.project_id = br.project_id AND bl.reservation_id = br.id
         JOIN luna.project_members pm
           ON pm.workspace_id = j.workspace_id AND pm.project_id = j.project_id
          AND pm.user_id = $2::uuid AND pm.active
         WHERE j.legacy_id = $1::text
         GROUP BY br.id, br.amount_minor, br.state, br.period_start
         LIMIT 1`,
        [normalizeLegacyId(jobId, 'jobId'), actorUuid]
      );
      if (!result.rows[0]) return null;
      return {
        id: String(result.rows[0].id),
        amountMinor: Number(result.rows[0].amount_minor) || 0,
        state: String(result.rows[0].state || ''),
        periodStart: result.rows[0].period_start ? new Date(result.rows[0].period_start).toISOString().slice(0, 10) : '',
        ledger: parseJsonValue(result.rows[0].ledger) || []
      };
    });
  }

  /** 仅允许持有有效租约的独立 worker 读取任务输入，避免提示词走普通任务回包。 */
  async function getJobInput(input) {
    return withWorkerTransaction(async client => {
      const result = await client.query(
        `SELECT luna.read_job_input($1::uuid, $2::uuid, $3::uuid, $4::uuid) AS payload`,
        [
          internalUuid(normalizeLegacyId(input.workerId, 'workerId')),
          internalUuid(normalizeLegacyId(input.workspaceId, 'workspaceId')),
          internalUuid(normalizeLegacyId(input.projectId, 'projectId')),
          internalUuid(normalizeLegacyId(input.jobId, 'jobId'))
        ]
      );
      return result.rows[0] && parseJsonDocument(result.rows[0].payload);
    });
  }

  /** 使用任务租约完成 PG 创书核心任务，生成 Bible 后才把任务推进为成功。 */
  async function finishCreationCoreJob(input) {
    const payload = input.bible && typeof input.bible === 'object' && !Array.isArray(input.bible)
      ? input.bible
      : null;
    if (!payload) throw repositoryError('job_result_invalid', '创书任务结果必须是 JSON 对象', 422);
    const payloadHash = /^[0-9a-f]{64}$/i.test(String(input.bibleHash || ''))
      ? String(input.bibleHash).toLowerCase()
      : jsonHash(payload);
    return withWorkerTransaction(async client => {
      const result = await client.query(
        `SELECT finished, bible_revision, billing_state
         FROM luna.finish_creation_core_job_v2(
           $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::integer, $6::bigint,
           $7::uuid, $8::text, $9::text, $10::jsonb, $11::text, $12::bigint
         )`,
        [
          internalUuid(normalizeLegacyId(input.workerId, 'workerId')),
          internalUuid(normalizeLegacyId(input.workspaceId, 'workspaceId')),
          internalUuid(normalizeLegacyId(input.projectId, 'projectId')),
          internalUuid(normalizeLegacyId(input.jobId, 'jobId')),
          Number(input.attemptNo),
          Number(input.fencingToken),
          internalUuid(normalizeLegacyId(input.bookId, 'bookId')),
          normalizeLegacyId(input.bookId, 'bookId'),
          normalizeLegacyId(input.bibleId || `bible_${input.bookId}`, 'bibleId'),
          JSON.stringify(payload),
          payloadHash,
          Math.max(0, Math.floor(Number(input.costMinor) || 0))
        ]
      );
      return {
        finished: result.rows[0] && (result.rows[0].finished === true || result.rows[0].finished === 't'),
        bibleVersion: Number(result.rows[0] && result.rows[0].bible_revision) || 0,
        billingState: String(result.rows[0] && result.rows[0].billing_state || 'none')
      };
    });
  }

  /** 按项目读取旧系统兼容数据，供迁移报告和人工裁决恢复。 */
  async function getLegacyPayload(userId, sourceKind, legacyId, projectId, workspaceId = '') {
    return withTransaction(userId, async client => {
      await ensureActor(client, userId);
      const access = await accessForClient(client, projectId, workspaceId);
      if (!access) return null;
      const result = await client.query(
        `SELECT payload, payload_hash, source_kind, legacy_id, created_at, updated_at
         FROM luna.legacy_payloads
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid
           AND source_kind = $3::text AND legacy_id = $4::text
         LIMIT 1`,
        [access.workspace_uuid, access.project_uuid, normalizeLegacyId(sourceKind, 'sourceKind'), normalizeLegacyId(legacyId, 'legacyId')]
      );
      if (!result.rows[0]) return null;
      return {
        sourceKind: String(result.rows[0].source_kind),
        legacyId: String(result.rows[0].legacy_id),
        payload: parseJsonDocument(result.rows[0].payload),
        payloadHash: String(result.rows[0].payload_hash || ''),
        createdAt: result.rows[0].created_at ? new Date(result.rows[0].created_at).getTime() : 0,
        updatedAt: result.rows[0].updated_at ? new Date(result.rows[0].updated_at).getTime() : 0
      };
    });
  }

  /** 按项目保存旧系统未正式建模的完整 payload，稳定 ID 冲突时拒绝覆盖。 */
  async function storeLegacyPayload(input) {
    const sourceKind = normalizeLegacyId(input.sourceKind, 'sourceKind');
    const legacyId = normalizeLegacyId(input.legacyId, 'legacyId');
    const projectId = normalizeLegacyId(input.projectId || `n_legacy_${sourceKind.replace(/[^A-Za-z0-9]/g, '').slice(0, 16)}`, 'projectId');
    const serialized = JSON.stringify(input.payload === undefined ? null : input.payload);
    const payloadHash = jsonHash(input.payload === undefined ? null : input.payload);
    return withTransaction(input.userId, async client => {
      const scope = await ensureScope(client, {
        userId: input.userId,
        workspaceId: input.workspaceId,
        projectId,
        title: String(input.title || '迁移兼容项目').slice(0, 200)
      });
      if (!hasRole(scope.access, PROJECT_WRITE_ROLES)) throw repositoryError('forbidden', '当前账户无权保存迁移兼容数据', 403);
      const current = await client.query(
        `SELECT payload_hash
         FROM luna.legacy_payloads
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid
           AND source_kind = $3::text AND legacy_id = $4::text
         FOR UPDATE`,
        [scope.workspaceUuid, scope.projectUuid, sourceKind, legacyId]
      );
      if (current.rows.length) {
        if (String(current.rows[0].payload_hash) !== payloadHash) {
          throw repositoryError('legacy_payload_conflict', '迁移兼容数据已存在不同版本', 409);
        }
        return { ok: true, id: legacyId, sourceKind, idempotent: true, payloadHash };
      }
      await client.query(
        `INSERT INTO luna.legacy_payloads
          (workspace_id, project_id, id, source_kind, legacy_id, payload, payload_hash, created_by)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::jsonb, $7::text, $8::uuid)`,
        [scope.workspaceUuid, scope.projectUuid, internalUuid(`${sourceKind}:${legacyId}`), sourceKind, legacyId, serialized, payloadHash, internalUuid(input.userId)]
      );
      return { ok: true, id: legacyId, sourceKind, idempotent: false, payloadHash };
    });
  }

  /** 在单一事务中导入旧 SQLite 创作域，专用表保存可用字段，原始行进入兼容区。 */
  async function importLegacyProjectData(input) {
    const projectId = normalizeLegacyId(input.projectId, 'projectId');
    const workspaceId = normalizeLegacyId(input.workspaceId, 'workspaceId');
    const books = Array.isArray(input.creationBooks) ? input.creationBooks : [];
    const bibles = Array.isArray(input.creationBibles) ? input.creationBibles : [];
    const bibleVersions = Array.isArray(input.creationBibleVersions) ? input.creationBibleVersions : [];
    const snapshots = Array.isArray(input.creationStateSnapshots) ? input.creationStateSnapshots : [];
    const audits = Array.isArray(input.creationChapterAudits) ? input.creationChapterAudits : [];
    const jobs = Array.isArray(input.creationCoreJobs) ? input.creationCoreJobs : [];
    const legacyPayloads = Array.isArray(input.legacyPayloads) ? input.legacyPayloads : [];
    const summary = {
      books: { created: 0, skipped: 0, conflicts: 0, invalid: 0 },
      bibleVersions: { created: 0, skipped: 0, conflicts: 0, invalid: 0 },
      snapshots: { created: 0, skipped: 0, conflicts: 0, invalid: 0 },
      audits: { created: 0, skipped: 0, conflicts: 0, invalid: 0 },
      jobs: { created: 0, skipped: 0, conflicts: 0, invalid: 0 },
      legacyPayloads: { created: 0, skipped: 0, conflicts: 0, invalid: 0 },
      conflicts: [],
      errors: []
    };
    return withTransaction(input.userId, async client => {
      await ensureActor(client, input.userId);
      const access = await accessForClient(client, projectId, workspaceId);
      if (!access || !hasRole(access, PROJECT_WRITE_ROLES)) {
        throw repositoryError('forbidden', '当前账户无权导入项目创作数据', 403);
      }
      const bookStates = new Map();
      const bibleBooks = new Map();
      const dateValue = value => {
        const timestamp = Number(value);
        return Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp) : new Date();
      };
      const userUuid = async value => ensureActor(client, normalizeLegacyId(value || input.userId, 'createdBy'));
      const saveLegacyPayload = async record => {
        const sourceKind = String(record && record.sourceKind || '').trim();
        const legacyId = String(record && record.legacyId || '').trim();
        if (!sourceKind || !legacyId || !record || !Object.prototype.hasOwnProperty.call(record, 'payload')) {
          summary.legacyPayloads.invalid += 1;
          return;
        }
        const normalizedKind = normalizeLegacyId(sourceKind, 'sourceKind');
        const normalizedId = normalizeLegacyId(legacyId, 'legacyId');
        const payload = record.payload === undefined ? null : record.payload;
        let serialized;
        let payloadHash;
        try {
          serialized = JSON.stringify(payload);
          payloadHash = jsonHash(payload);
        } catch (_) {
          summary.legacyPayloads.invalid += 1;
          summary.errors.push(`兼容负载 ${sourceKind}/${legacyId} 无法序列化`);
          return;
        }
        const current = await client.query(
          `SELECT payload_hash
           FROM luna.legacy_payloads
           WHERE workspace_id = $1::uuid AND project_id = $2::uuid
             AND source_kind = $3::text AND legacy_id = $4::text
           FOR UPDATE`,
          [access.workspace_uuid, access.project_uuid, normalizedKind, normalizedId]
        );
        if (current.rows.length) {
          if (String(current.rows[0].payload_hash) === payloadHash) {
            summary.legacyPayloads.skipped += 1;
          } else {
            summary.legacyPayloads.conflicts += 1;
            summary.conflicts.push({ type: 'legacy_payload', sourceKind: normalizedKind, legacyId: normalizedId });
          }
          return;
        }
        await client.query(
          `INSERT INTO luna.legacy_payloads
            (workspace_id, project_id, id, source_kind, legacy_id, payload, payload_hash, created_by)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::jsonb, $7::text, $8::uuid)`,
          [
            access.workspace_uuid, access.project_uuid, internalUuid(`${normalizedKind}:${normalizedId}`),
            normalizedKind, normalizedId, serialized, payloadHash, internalUuid(input.userId)
          ]
        );
        summary.legacyPayloads.created += 1;
      };

      for (const book of books) {
        const bookId = String(book && (book.id || book.legacyId) || '').trim();
        if (!bookId) {
          summary.books.invalid += 1;
          continue;
        }
        const normalizedBookId = normalizeLegacyId(bookId, 'creationBookId');
        const statusMap = { active: 'ready', ready: 'ready', draft: 'draft', generating: 'generating', archived: 'archived' };
        const status = statusMap[String(book.status || '').toLowerCase()] || 'draft';
        const plan = book.plan === undefined ? {} : book.plan;
        const ownerUserId = String(book.ownerUserId || input.userId).trim() || input.userId;
        const ownerUuid = await userUuid(ownerUserId);
        const internalBookId = internalUuid(normalizedBookId);
        const current = await client.query(
          `SELECT *
           FROM luna.creation_books
           WHERE workspace_id = $1::uuid AND project_id = $2::uuid
             AND (id = $3::uuid OR legacy_id = $4::text)
           LIMIT 1
           FOR UPDATE`,
          [access.workspace_uuid, access.project_uuid, internalBookId, normalizedBookId]
        );
        let accepted = false;
        if (current.rows.length) {
          const row = current.rows[0];
          const same = String(row.legacy_id || normalizedBookId) === normalizedBookId &&
            String(row.owner_user_id || '') === ownerUuid &&
            String(row.title || '') === String(book.title || '') &&
            String(row.status || '') === status &&
            projectPackage.sha256(parseJsonDocument(row.plan) || {}) === projectPackage.sha256(plan) &&
            Number(row.current_state_version) === Math.max(0, Number(book.currentStateVersion) || 0) &&
            Number(row.current_chapter_no) === Math.max(0, Number(book.currentChapterNo) || 0);
          if (same) {
            summary.books.skipped += 1;
            accepted = true;
          } else {
            summary.books.conflicts += 1;
            summary.conflicts.push({ type: 'creation_book', id: normalizedBookId });
          }
        } else {
          await client.query(
            `INSERT INTO luna.creation_books
              (workspace_id, project_id, id, legacy_id, owner_user_id, title, status, plan,
               revision, source_brief_id, current_state_version, current_chapter_no,
               budget_limit, spent_cost, created_at, updated_at)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::uuid, $6::text, $7::text, $8::jsonb,
                     1, $9::text, $10::bigint, $11::integer, $12::numeric, $13::numeric,
                     $14::timestamptz, $15::timestamptz)`,
            [
              access.workspace_uuid, access.project_uuid, internalBookId, normalizedBookId, ownerUuid,
              String(book.title || '').slice(0, 200), status, JSON.stringify(plan),
              String(book.sourceBriefId || '').slice(0, 160),
              Math.max(0, Number(book.currentStateVersion) || 0),
              Math.max(0, Number(book.currentChapterNo) || 0),
              Math.max(0, Number(book.budgetLimit) || 0),
              Math.max(0, Number(book.spentCost) || 0),
              dateValue(book.createdAt), dateValue(book.updatedAt || book.createdAt)
            ]
          );
          summary.books.created += 1;
          accepted = true;
        }
        bookStates.set(normalizedBookId, { internalBookId, ownerUserId, accepted });
        const bibleId = String(book.bibleId || '').trim();
        if (bibleId) bibleBooks.set(bibleId, normalizedBookId);
      }

      for (const bible of bibles) {
        const bibleId = String(bible && (bible.id || bible.bibleId || bible.legacyId) || '').trim();
        if (!bibleId) continue;
        const bookId = String(bible.bookId || bible.creationBookId || '').trim();
        if (bookId && !bibleBooks.has(bibleId)) bibleBooks.set(bibleId, bookId);
      }

      for (const version of bibleVersions) {
        const bibleId = String(version && (version.bibleId || version.legacyBibleId) || '').trim();
        const bookId = String(version && (version.bookId || bibleBooks.get(bibleId) || '') || '').trim();
        const bookState = bookStates.get(bookId);
        const revision = Number(version && (version.version || version.revision));
        if (!bibleId || !bookState || !bookState.accepted || !Number.isInteger(revision) || revision < 1) {
          summary.bibleVersions.invalid += 1;
          continue;
        }
        const payload = version.payload === undefined ? {} : version.payload;
        const legacyBibleId = normalizeLegacyId(bibleId, 'bibleId');
        const current = await client.query(
          `SELECT payload
           FROM luna.creation_bibles
           WHERE workspace_id = $1::uuid AND project_id = $2::uuid
             AND book_id = $3::uuid AND revision = $4::bigint
           FOR UPDATE`,
          [access.workspace_uuid, access.project_uuid, bookState.internalBookId, revision]
        );
        if (current.rows.length) {
          if (projectPackage.sha256(parseJsonDocument(current.rows[0].payload)) === projectPackage.sha256(payload)) {
            summary.bibleVersions.skipped += 1;
          } else {
            summary.bibleVersions.conflicts += 1;
            summary.conflicts.push({ type: 'creation_bible_version', bibleId: legacyBibleId, revision });
          }
          continue;
        }
        await client.query(
          `INSERT INTO luna.creation_bibles
            (workspace_id, project_id, book_id, legacy_id, revision, payload, payload_hash, changed_by, created_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::bigint, $6::jsonb, $7::text, $8::uuid, $9::timestamptz)`,
          [
            access.workspace_uuid, access.project_uuid, bookState.internalBookId, legacyBibleId, revision,
            JSON.stringify(payload), jsonHash(payload), await userUuid(version.createdByUserId || bookState.ownerUserId),
            dateValue(version.createdAt)
          ]
        );
        summary.bibleVersions.created += 1;
      }

      for (const snapshot of snapshots) {
        const snapshotId = String(snapshot && (snapshot.id || snapshot.legacyId) || '').trim();
        const bookId = String(snapshot && (snapshot.bookId || '') || '').trim();
        const bookState = bookStates.get(bookId);
        const stateVersion = Math.max(0, Number(snapshot && snapshot.stateVersion) || 0);
        if (!snapshotId || !bookState || !bookState.accepted) {
          summary.snapshots.invalid += 1;
          continue;
        }
        const payload = snapshot.payload && typeof snapshot.payload === 'object' && !Array.isArray(snapshot.payload)
          ? snapshot.payload
          : {};
        const normalizedSnapshotId = normalizeLegacyId(snapshotId, 'snapshotId');
        const internalSnapshotId = internalUuid(normalizedSnapshotId);
        const inputHash = projectPackage.sha256(payload);
        const current = await client.query(
          `SELECT legacy_id, input_hash, payload
           FROM luna.context_snapshots
           WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND id = $3::uuid
           FOR UPDATE`,
          [access.workspace_uuid, access.project_uuid, internalSnapshotId]
        );
        if (current.rows.length) {
          const row = current.rows[0];
          if (
            (String(row.input_hash) === inputHash || String(row.input_hash) === jsonHash(payload)) &&
            projectPackage.sha256(parseJsonDocument(row.payload)) === projectPackage.sha256(payload)
          ) {
            summary.snapshots.skipped += 1;
          } else {
            summary.snapshots.conflicts += 1;
            summary.conflicts.push({ type: 'creation_snapshot', id: normalizedSnapshotId });
          }
          continue;
        }
        await client.query(
          `INSERT INTO luna.context_snapshots
            (workspace_id, project_id, id, legacy_id, bible_revision, state_revision, input_hash, payload, created_by, created_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::bigint, $6::bigint, $7::text, $8::jsonb, $9::uuid, $10::timestamptz)`,
          [
            access.workspace_uuid, access.project_uuid, internalSnapshotId, normalizedSnapshotId,
            Math.max(0, Number(snapshot.bibleVersion) || 0), stateVersion, inputHash, JSON.stringify(payload),
            await userUuid(snapshot.createdByUserId || bookState.ownerUserId), dateValue(snapshot.createdAt)
          ]
        );
        summary.snapshots.created += 1;
      }

      for (const audit of audits) {
        const auditId = String(audit && (audit.id || audit.auditId) || '').trim();
        const bookId = String(audit && audit.bookId || '').trim();
        const bookState = bookStates.get(bookId);
        const subjectHash = String(audit && (audit.contentHash || audit.subjectHash) || '').toLowerCase();
        if (!auditId || !bookState || !bookState.accepted || !/^[0-9a-f]{64}$/.test(subjectHash)) {
          summary.audits.invalid += 1;
          continue;
        }
        const status = audit.status === 'provider_unknown'
          ? 'provider_unknown'
          : Number(audit.passed) === 1 || audit.passed === true
            ? 'passed'
            : String(audit.qualityGate || '').toLowerCase() === 'needs_review' ? 'needs_review' : 'blocked';
        const result = audit.result && typeof audit.result === 'object' && !Array.isArray(audit.result) ? audit.result : {};
        const normalizedAuditId = normalizeLegacyId(auditId, 'auditId');
        const internalAuditId = internalUuid(normalizedAuditId);
        const current = await client.query(
          `SELECT subject_hash, status, result
           FROM luna.audits
           WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND id = $3::uuid
           FOR UPDATE`,
          [access.workspace_uuid, access.project_uuid, internalAuditId]
        );
        if (current.rows.length) {
          const row = current.rows[0];
          if (String(row.subject_hash) === subjectHash && String(row.status) === status && projectPackage.sha256(parseJsonDocument(row.result)) === projectPackage.sha256(result)) {
            summary.audits.skipped += 1;
          } else {
            summary.audits.conflicts += 1;
            summary.conflicts.push({ type: 'creation_audit', id: normalizedAuditId });
          }
          continue;
        }
        await client.query(
          `INSERT INTO luna.audits
            (workspace_id, project_id, id, subject_hash, status, result, created_by, created_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::jsonb, $7::uuid, $8::timestamptz)`,
          [
            access.workspace_uuid, access.project_uuid, internalAuditId, subjectHash, status, JSON.stringify(result),
            await userUuid(audit.createdByUserId || bookState.ownerUserId), dateValue(audit.createdAt)
          ]
        );
        summary.audits.created += 1;
      }

      for (const job of jobs) {
        const jobId = String(job && (job.id || job.jobId) || '').trim();
        const bookId = String(job && job.bookId || '').trim();
        const bookState = bookStates.get(bookId);
        if (!jobId || !bookState || !bookState.accepted) {
          summary.jobs.invalid += 1;
          continue;
        }
        const sourceStatus = String(job.status || '').toLowerCase();
        const state = sourceStatus === 'done' || sourceStatus === 'succeeded'
          ? 'succeeded'
          : sourceStatus === 'failed' ? 'failed'
            : sourceStatus === 'cancelled' ? 'cancelled'
              : sourceStatus === 'provider_unknown' ? 'provider_unknown'
                : 'provider_unknown';
        const jobResult = {
          bookId,
          receivedChars: Math.max(0, Number(job.receivedChars) || 0),
          bibleVersion: Math.max(0, Number(job.bibleVersion) || 0),
          creditCost: Number.isFinite(Number(job.creditCost)) ? Number(job.creditCost) : null
        };
        const inputHash = /^[0-9a-f]{64}$/i.test(String(job.inputHash || ''))
          ? String(job.inputHash).toLowerCase()
          : jsonHash({ bookId, title: String(job.title || ''), modelId: String(job.modelId || '') });
        const normalizedJobId = normalizeLegacyId(jobId, 'jobId');
        const internalJobId = internalUuid(normalizedJobId);
        const current = await client.query(
          `SELECT state, input_hash, result
           FROM luna.jobs
           WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND id = $3::uuid
           FOR UPDATE`,
          [access.workspace_uuid, access.project_uuid, internalJobId]
        );
        if (current.rows.length) {
          const row = current.rows[0];
          if (String(row.state) === state && String(row.input_hash) === inputHash && projectPackage.sha256(parseJsonDocument(row.result)) === projectPackage.sha256(jobResult)) {
            summary.jobs.skipped += 1;
          } else {
            summary.jobs.conflicts += 1;
            summary.conflicts.push({ type: 'creation_job', id: normalizedJobId });
          }
          continue;
        }
        const createdBy = await userUuid(job.userId || bookState.ownerUserId);
        await client.query(
          `INSERT INTO luna.jobs
            (workspace_id, project_id, id, legacy_id, requested_by, kind, state, attempt_no,
             fencing_token, input_hash, result, error_code, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::uuid, 'creation-core', $6::text, 0,
                   0, $7::text, $8::jsonb, $9::text, $10::timestamptz, $11::timestamptz)`,
          [
            access.workspace_uuid, access.project_uuid, internalJobId, normalizedJobId,
            createdBy, state, inputHash, JSON.stringify(jobResult),
            String(job.code || '').slice(0, 120), dateValue(job.startedAt || job.updatedAt), dateValue(job.updatedAt || job.startedAt)
          ]
        );
        await client.query(
          `INSERT INTO luna.job_events
            (workspace_id, project_id, job_id, event_seq, state, payload)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 1, $4::text, $5::jsonb)`,
          [
            access.workspace_uuid, access.project_uuid, internalJobId, state,
            JSON.stringify({ source: 'legacy-import', originalStatus: sourceStatus })
          ]
        );
        summary.jobs.created += 1;
      }

      for (const record of legacyPayloads) await saveLegacyPayload(record);
      return summary;
    });
  }

  /** 原子领取一个 queued 任务，返回 worker 写回所需的 scope、attempt 和 fencing。 */
  async function claimNextJob(workerId, leaseSeconds = 600, kind = '', workspaceId = '', projectId = '') {
    return withWorkerTransaction(async client => {
      const scopedWorkspace = String(workspaceId || '').trim();
      const scopedProject = String(projectId || '').trim();
      const scoped = scopedWorkspace && scopedProject;
      const result = await client.query(
        scoped
          ? 'SELECT * FROM luna.claim_next_job_scoped($1::uuid, $2::integer, $3::text, $4::uuid, $5::uuid)'
          : 'SELECT * FROM luna.claim_next_job($1::uuid, $2::integer, $3::text)',
        scoped
          ? [
            internalUuid(normalizeLegacyId(workerId, 'workerId')),
            Math.max(30, Math.min(86400, Math.floor(Number(leaseSeconds) || 600))),
            String(kind || '').slice(0, 120),
            internalUuid(normalizeLegacyId(scopedWorkspace, 'workspaceId')),
            internalUuid(normalizeLegacyId(scopedProject, 'projectId'))
          ]
          : [
            internalUuid(normalizeLegacyId(workerId, 'workerId')),
            Math.max(30, Math.min(86400, Math.floor(Number(leaseSeconds) || 600))),
            String(kind || '').slice(0, 120)
          ]
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        workspaceId: String(row.workspace_id || ''),
        projectId: String(row.project_id || ''),
        jobId: String(row.job_id || ''),
        kind: String(row.kind || ''),
        attemptNo: Number(row.attempt_no) || 0,
        fencingToken: Number(row.fencing_token) || 0,
        revision: Number(row.revision) || 1,
        inputHash: String(row.input_hash || '')
      };
    });
  }

  /** 续租任务，旧 worker 或旧 fencing token 续租会返回 false。 */
  async function heartbeatJob(input) {
    return withWorkerTransaction(async client => {
      const result = await client.query(
        `SELECT luna.heartbeat_job(
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::integer, $6::bigint, $7::integer
        ) AS renewed`,
        [
          internalUuid(normalizeLegacyId(input.workerId, 'workerId')),
          internalUuid(normalizeLegacyId(input.workspaceId, 'workspaceId')),
          internalUuid(normalizeLegacyId(input.projectId, 'projectId')),
          internalUuid(normalizeLegacyId(input.jobId, 'jobId')),
          Number(input.attemptNo),
          Number(input.fencingToken),
          Math.max(30, Math.min(86400, Math.floor(Number(input.leaseSeconds) || 600)))
        ]
      );
      return result.rows[0] && (result.rows[0].renewed === true || result.rows[0].renewed === 't');
    });
  }

  /** 使用 attempt/fencing 完成任务或标记 provider_unknown，旧 worker 写回会被拒绝。 */
  async function finishJob(input) {
    const state = String(input.state || '');
    if (!['succeeded', 'failed', 'cancelled', 'provider_unknown'].includes(state)) {
      throw repositoryError('invalid_job_state', 'worker 终态无效', 422);
    }
    const requestedCostMinor = input.actualCostMinor ?? input.costMinor;
    const actualCostMinor = requestedCostMinor == null
      ? null
      : Math.max(0, Math.floor(Number(requestedCostMinor) || 0));
    return withWorkerTransaction(async client => {
      const result = await client.query(
        `SELECT luna.finish_job_v2(
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::integer, $6::bigint,
          $7::text, $8::jsonb, $9::text, $10::bigint
        ) AS finished`,
        [
          internalUuid(normalizeLegacyId(input.workerId, 'workerId')),
          internalUuid(normalizeLegacyId(input.workspaceId, 'workspaceId')),
          internalUuid(normalizeLegacyId(input.projectId, 'projectId')),
          internalUuid(normalizeLegacyId(input.jobId, 'jobId')),
          Number(input.attemptNo),
          Number(input.fencingToken),
          state,
          input.result === undefined || input.result === null ? null : JSON.stringify(input.result),
          String(input.errorCode || ''),
          actualCostMinor
        ]
      );
      return result.rows[0] && (result.rows[0].finished === true || result.rows[0].finished === 't');
    });
  }

  /** 持久化供应商 attempt，允许同一任务 attempt 重放而不重复插入。 */
  async function recordProviderAttempt(input) {
    const state = String(input.state || '');
    if (!['started', 'succeeded', 'failed', 'unknown'].includes(state)) {
      throw repositoryError('invalid_provider_attempt', '供应商 attempt 状态无效', 422);
    }
    return withWorkerTransaction(async client => {
      const result = await client.query(
        `SELECT luna.record_provider_attempt(
          $1::uuid, $2::uuid, $3::uuid, $4::integer, $5::text, $6::text, $7::jsonb, $8::bigint
        ) AS attempt_id`,
        [
          internalUuid(normalizeLegacyId(input.workspaceId, 'workspaceId')),
          internalUuid(normalizeLegacyId(input.projectId, 'projectId')),
          internalUuid(normalizeLegacyId(input.jobId, 'jobId')),
          Number(input.attemptNo),
          String(input.providerRequestId || ''),
          state,
          input.usage === undefined || input.usage === null ? null : JSON.stringify(input.usage),
          input.costMinor == null ? null : Math.floor(Number(input.costMinor) || 0)
        ]
      );
      return String(result.rows[0] && result.rows[0].attempt_id || '');
    });
  }

  /** 预占项目预算，按任务唯一键幂等并在同一事务内锁定预算行。 */
  async function reserveBudget(input) {
    const amountMinor = Math.max(0, Math.floor(Number(input.amountMinor) || 0));
    if (amountMinor < 1) throw repositoryError('invalid_amount', '预算预占金额必须为正整数', 422);
    const periodStart = String(input.periodStart || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const parsedPeriodStart = Date.parse(`${periodStart}T00:00:00Z`);
    if (!Number.isFinite(parsedPeriodStart)) throw repositoryError('invalid_period', '预算周期开始日期无效', 422);
    const defaultPeriodEnd = new Date(parsedPeriodStart + 86400000).toISOString().slice(0, 10);
    const periodEnd = String(input.periodEnd || defaultPeriodEnd).slice(0, 10);
    if (periodEnd <= periodStart) throw repositoryError('invalid_period', '预算周期结束日期必须晚于开始日期', 422);
    const currency = String(input.currency || 'CREDIT').slice(0, 20);
    return withTransaction(input.userId, async client => {
      const scope = await ensureScope(client, {
        userId: input.userId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        title: String(input.title || '预算项目').slice(0, 200)
      });
      if (!scope.access.can_spend) throw repositoryError('spend_forbidden', '当前账户没有项目支出权限', 403);
      const job = await client.query(
        `SELECT id
         FROM luna.jobs
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND legacy_id = $3::text
         LIMIT 1`,
        [scope.workspaceUuid, scope.projectUuid, normalizeLegacyId(input.jobId, 'jobId')]
      );
      if (!job.rows.length) throw repositoryError('job_missing', '预算必须绑定已持久化任务', 404);
      const reservationId = normalizeLegacyId(input.reservationId || `reservation_${input.jobId}`, 'reservationId');
      const existing = await client.query(
        `SELECT *
         FROM luna.budget_reservations
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid
           AND (id = $3::uuid OR job_id = $4::uuid)
         LIMIT 1
         FOR UPDATE`,
        [scope.workspaceUuid, scope.projectUuid, internalUuid(reservationId), job.rows[0].id]
      );
      if (existing.rows.length) {
        const current = existing.rows[0];
        if (Number(current.amount_minor) !== amountMinor) throw repositoryError('idempotency_conflict', '同一任务的预算预占金额不一致', 409);
        return {
          ok: true,
          id: String(input.reservationId || reservationId),
          jobId: String(input.jobId),
          amountMinor: Number(current.amount_minor) || 0,
          state: String(current.state || ''),
          idempotent: true
        };
      }
      let budget = await client.query(
        `SELECT *
         FROM luna.budgets
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND period_start = $3::date
         FOR UPDATE`,
        [scope.workspaceUuid, scope.projectUuid, periodStart]
      );
      if (!budget.rows.length) {
        const limitMinor = Math.max(0, Math.floor(Number(input.limitMinor) || 0));
        if (!limitMinor) throw repositoryError('budget_missing', '项目预算尚未设置', 409);
        await client.query(
          `INSERT INTO luna.budgets
            (workspace_id, project_id, period_start, period_end, limit_minor, currency)
           VALUES ($1::uuid, $2::uuid, $3::date, $4::date, $5::bigint, $6::text)`,
          [scope.workspaceUuid, scope.projectUuid, periodStart, periodEnd, limitMinor, currency]
        );
        budget = await client.query(
          `SELECT *
           FROM luna.budgets
           WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND period_start = $3::date
           FOR UPDATE`,
          [scope.workspaceUuid, scope.projectUuid, periodStart]
        );
      }
      const usage = await client.query(
        `SELECT
           COALESCE((SELECT SUM(ledger.amount_minor)
             FROM luna.billing_ledger ledger
             JOIN luna.budget_reservations ledger_reservation
               ON ledger_reservation.workspace_id = ledger.workspace_id
              AND ledger_reservation.project_id = ledger.project_id
              AND ledger_reservation.id = ledger.reservation_id
             WHERE ledger.workspace_id = $1::uuid AND ledger.project_id = $2::uuid
               AND ledger.entry_type = 'charge'
               AND (ledger_reservation.period_start = $3::date OR ledger_reservation.period_start IS NULL)), 0)::bigint AS used_minor,
           COALESCE((SELECT SUM(amount_minor) FROM luna.budget_reservations
             WHERE workspace_id = $1::uuid AND project_id = $2::uuid
               AND state = 'reserved'
               AND (period_start = $3::date OR period_start IS NULL)), 0)::bigint AS reserved_minor`,
        [scope.workspaceUuid, scope.projectUuid, periodStart]
      );
      const usedMinor = Number(usage.rows[0].used_minor) || 0;
      const reservedMinor = Number(usage.rows[0].reserved_minor) || 0;
      const limitMinor = Number(budget.rows[0].limit_minor) || 0;
      if (usedMinor + reservedMinor + amountMinor > limitMinor) {
        throw repositoryError('budget_exceeded', '本次任务预算预占超过项目额度', 402);
      }
      await client.query(
        `INSERT INTO luna.budget_reservations
          (workspace_id, project_id, id, job_id, amount_minor, state, period_start)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::bigint, 'reserved', $6::date)`,
        [scope.workspaceUuid, scope.projectUuid, internalUuid(reservationId), job.rows[0].id, amountMinor, periodStart]
      );
      return { ok: true, id: String(input.reservationId || reservationId), jobId: String(input.jobId), amountMinor, state: 'reserved', idempotent: false };
    });
  }

  /** 结算预算预占，追加 charge/release 账本记录并拒绝未知状态自动结算。 */
  async function settleBudget(input) {
    const actualMinor = Math.max(0, Math.floor(Number(input.actualMinor) || 0));
    return withTransaction(input.userId, async client => {
      await ensureActor(client, input.userId);
      const reservation = await client.query(
        `SELECT br.*, p.legacy_id AS project_legacy_id, w.legacy_id AS workspace_legacy_id
         FROM luna.budget_reservations br
         JOIN luna.projects p ON p.workspace_id = br.workspace_id AND p.id = br.project_id
         JOIN luna.workspaces w ON w.id = br.workspace_id
         WHERE br.id = $1::uuid
         FOR UPDATE OF br`,
        [internalUuid(normalizeLegacyId(input.reservationId, 'reservationId'))]
      );
      if (!reservation.rows.length) throw repositoryError('reservation_missing', '预算预占不存在或无权访问', 404);
      const current = reservation.rows[0];
      const access = await accessForClient(client, current.project_id, current.workspace_id);
      if (!access || !access.can_spend) throw repositoryError('spend_forbidden', '当前账户没有项目支出权限', 403);
      const currentState = String(current.state || '');
      if (currentState === 'settled') return { ok: true, id: String(input.reservationId), state: currentState, actualMinor, idempotent: true };
      if (currentState !== 'reserved') throw repositoryError('provider_unknown', '未知供应商结果必须人工核对，不能自动结算', 409);
      const chargeId = internalUuid(`ledger:charge:${input.reservationId}`);
      await client.query(
        `UPDATE luna.budget_reservations
         SET state = 'settled', updated_at = now()
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND id = $3::uuid`,
        [current.workspace_id, current.project_id, current.id]
      );
      await client.query(
        `INSERT INTO luna.billing_ledger
          (workspace_id, project_id, id, reservation_id, amount_minor, entry_type, metadata)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::bigint, 'charge', $6::jsonb)`,
        [current.workspace_id, current.project_id, chargeId, current.id, actualMinor, JSON.stringify({ jobId: String(input.jobId || ''), settledBy: String(input.userId) })]
      );
      const reservedMinor = Number(current.amount_minor) || 0;
      if (reservedMinor > actualMinor) {
        await client.query(
          `INSERT INTO luna.billing_ledger
            (workspace_id, project_id, id, reservation_id, amount_minor, entry_type, metadata)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::bigint, 'release', $6::jsonb)`,
          [current.workspace_id, current.project_id, internalUuid(`ledger:release:${input.reservationId}`), current.id, reservedMinor - actualMinor, JSON.stringify({ jobId: String(input.jobId || '') })]
        );
      }
      return {
        ok: true,
        id: String(input.reservationId),
        state: 'settled',
        reservedMinor,
        actualMinor,
        idempotent: false
      };
    });
  }

  /** 释放尚未调用供应商的预算预占，追加 release 账本且保持幂等。 */
  async function releaseBudget(input) {
    return withTransaction(input.userId, async client => {
      await ensureActor(client, input.userId);
      const reservation = await client.query(
        `SELECT *
         FROM luna.budget_reservations
         WHERE id = $1::uuid
         FOR UPDATE`,
        [internalUuid(normalizeLegacyId(input.reservationId, 'reservationId'))]
      );
      if (!reservation.rows.length) throw repositoryError('reservation_missing', '预算预占不存在或无权访问', 404);
      const current = reservation.rows[0];
      const access = await accessForClient(client, current.project_id, current.workspace_id);
      if (!access || !access.can_spend) throw repositoryError('spend_forbidden', '当前账户没有项目支出权限', 403);
      if (String(current.state) === 'released') return { ok: true, id: String(input.reservationId), state: 'released', idempotent: true };
      if (String(current.state) !== 'reserved') throw repositoryError('provider_unknown', '未知或已结算的预算不能自动释放', 409);
      await client.query(
        `UPDATE luna.budget_reservations
         SET state = 'released', updated_at = now()
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND id = $3::uuid`,
        [current.workspace_id, current.project_id, current.id]
      );
      await client.query(
        `INSERT INTO luna.billing_ledger
          (workspace_id, project_id, id, reservation_id, amount_minor, entry_type, metadata)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::bigint, 'release', $6::jsonb)`,
        [current.workspace_id, current.project_id, internalUuid(`ledger:release:${input.reservationId}`), current.id, Number(current.amount_minor) || 0, JSON.stringify({ releasedBy: String(input.userId) })]
      );
      return { ok: true, id: String(input.reservationId), state: 'released', idempotent: false };
    });
  }

  const creationBookBundle = createPostgresCreationBookMethods({
    PROJECT_WRITE_ROLES,
    UUID_PATTERN,
    internalUuid,
    normalizeLegacyId,
    repositoryError,
    parseJsonValue,
    parseJsonDocument,
    jsonHash,
    hasRole,
    withTransaction,
    ensureActor,
    accessForClient,
    ensureScope,
    publicJob
  });
  const { ensureCreationBookPlaceholderForClient, reserveJobBudgetForClient } = creationBookBundle;
  const creationBookMethods = creationBookBundle.methods;

  async function notifyRuntimeChanged(client, kind, id = '') {
    try {
      await client.query('SELECT pg_notify($1::text, $2::text)', [
        'molan_runtime_changed', JSON.stringify({ kind: String(kind || 'runtime'), id: String(id || '') })
      ]);
    } catch (_) {
      // NOTIFY is an optimization for other instances; a successful write
      // must not be rolled back merely because an optional notification failed.
    }
  }

  /** 读取运行时投影的完整快照，原始 sqlite_* 证据表不参与业务读写。 */
  async function loadRuntimeState() {
    return withTransaction('', async client => {
      const [accounts, userSkills, globalSkills, openSkills, dissections, dissectionRows] = await Promise.all([
        client.query('SELECT * FROM luna.runtime_accounts_all()'),
        client.query('SELECT * FROM luna.runtime_user_skills_all()'),
        client.query('SELECT * FROM luna.runtime_global_skills_all()'),
        client.query('SELECT * FROM luna.runtime_open_skills_all()'),
        client.query('SELECT * FROM luna.runtime_dissections_all()'),
        client.query('SELECT * FROM luna.runtime_dissection_rows_all()')
      ]);
      return {
        accounts: accounts.rows,
        userSkills: userSkills.rows,
        globalSkills: globalSkills.rows,
        openSkills: openSkills.rows,
        dissections: dissections.rows,
        dissectionRows: dissectionRows.rows
      };
    });
  }

  /** 分页读取运行时投影，避免大体量拆书 JSON 一次性进入 Node 堆。 */
  async function loadRuntimeStateChunked(onChunk, options = {}) {
    if (typeof onChunk !== 'function') throw repositoryError('invalid_callback', 'PostgreSQL 运行时分块回调无效', 500);
    const dissectionPageSize = Math.min(20, Math.max(1, Math.floor(Number(options.dissectionPageSize) || 2)));
    const rowPageSize = Math.min(2000, Math.max(50, Math.floor(Number(options.rowPageSize) || 512)));
    return withTransaction('', async client => {
      const [accounts, userSkills, globalSkills, openSkills] = await Promise.all([
        client.query('SELECT * FROM luna.runtime_accounts_all()'),
        client.query('SELECT * FROM luna.runtime_user_skills_all()'),
        client.query('SELECT * FROM luna.runtime_global_skills_all()'),
        client.query('SELECT * FROM luna.runtime_open_skills_all()')
      ]);
      const counts = {
        accounts: accounts.rows.length,
        userSkills: userSkills.rows.length,
        globalSkills: globalSkills.rows.length,
        openSkills: openSkills.rows.length,
        dissections: 0,
        dissectionRows: 0
      };
      await onChunk({
        accounts: accounts.rows,
        userSkills: userSkills.rows,
        globalSkills: globalSkills.rows,
        openSkills: openSkills.rows,
        dissections: [],
        dissectionRows: []
      });

      const paging = await client.query(`
        SELECT to_regprocedure('luna.runtime_dissections_page(bigint,text,integer)') IS NOT NULL AS dissections_page_ready,
               to_regprocedure('luna.runtime_dissection_rows_page(uuid,text,text,integer)') IS NOT NULL AS rows_page_ready`);
      const useKeyset = paging.rows[0] &&
        (paging.rows[0].dissections_page_ready === true || paging.rows[0].dissections_page_ready === 't') &&
        (paging.rows[0].rows_page_ready === true || paging.rows[0].rows_page_ready === 't');

      if (useKeyset) {
        let afterUpdated = null;
        let afterDissectionId = '';
        for (;;) {
          const result = await client.query(
            'SELECT * FROM luna.runtime_dissections_page($1::bigint, $2::text, $3::integer)',
            [afterUpdated, afterDissectionId, dissectionPageSize]
          );
          if (!result.rows.length) break;
          counts.dissections += result.rows.length;
          await onChunk({ accounts: [], userSkills: [], globalSkills: [], openSkills: [], dissections: result.rows, dissectionRows: [] });
          const last = result.rows[result.rows.length - 1];
          afterUpdated = String(last.updated_at_value || '0');
          afterDissectionId = String(last.id || '');
        }

        let afterOwner = null;
        let afterSource = '';
        let afterRow = '';
        for (;;) {
          const result = await client.query(
            'SELECT * FROM luna.runtime_dissection_rows_page($1::uuid, $2::text, $3::text, $4::integer)',
            [afterOwner, afterSource, afterRow, rowPageSize]
          );
          if (!result.rows.length) break;
          counts.dissectionRows += result.rows.length;
          await onChunk({ accounts: [], userSkills: [], globalSkills: [], openSkills: [], dissections: [], dissectionRows: result.rows });
          const last = result.rows[result.rows.length - 1];
          afterOwner = String(last.owner_actor_id || '');
          afterSource = String(last.source_table || '');
          afterRow = String(last.row_key || '');
        }
      } else {
        // 兼容尚未应用 0030 迁移的旧目标，确保服务仍可从原有函数完成加载。
        for (let offset = 0; ; offset += dissectionPageSize) {
          const result = await client.query(
            'SELECT * FROM luna.runtime_dissections_all() OFFSET $1::integer LIMIT $2::integer',
            [offset, dissectionPageSize]
          );
          if (!result.rows.length) break;
          counts.dissections += result.rows.length;
          await onChunk({ accounts: [], userSkills: [], globalSkills: [], openSkills: [], dissections: result.rows, dissectionRows: [] });
        }
        for (let offset = 0; ; offset += rowPageSize) {
          const result = await client.query(
            'SELECT * FROM luna.runtime_dissection_rows_all() OFFSET $1::integer LIMIT $2::integer',
            [offset, rowPageSize]
          );
          if (!result.rows.length) break;
          counts.dissectionRows += result.rows.length;
          await onChunk({ accounts: [], userSkills: [], globalSkills: [], openSkills: [], dissections: [], dissectionRows: result.rows });
        }
      }
      return counts;
    });
  }

  async function runtimeAccountByEmail(email) {
    return withTransaction('', async client => {
      const result = await client.query(
        'SELECT * FROM luna.runtime_account_by_email($1::text) LIMIT 1',
        [String(email || '').trim().toLowerCase()]
      );
      return result.rows[0] || null;
    });
  }

  async function runtimeAccountByUserId(userId) {
    return withTransaction('', async client => {
      const result = await client.query(
        'SELECT * FROM luna.runtime_account_by_user_id($1::text) LIMIT 1',
        [String(userId || '').trim()]
      );
      return result.rows[0] || null;
    });
  }

  async function appendAdminAuditInTx(client, item) {
    if (!item || typeof item !== 'object') return null;
    const auditId = item.id || ('audit_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20));
    await client.query(
      `INSERT INTO luna.runtime_admin_audit
        (id, actor_id, admin_email, action, target, detail, created_at_value)
       VALUES ($1::text, luna.actor_id(), $2::text, $3::text, $4::text, $5::jsonb, $6::bigint)`,
      [auditId, String(item.adminEmail || item.actorEmail || ''), String(item.action || ''), String(item.target || ''), JSON.stringify(item.detail || item.details || {}), Number(item.createdAt) || Date.now()]
    );
    return { ...item, id: auditId };
  }

  async function runtimeAppendAdminAudit(actorUserId, item) {
    return withTransaction(actorUserId, async client => {
      return appendAdminAuditInTx(client, item);
    });
  }

  async function runtimeListAdminAudit(actorUserId, limit = 100) {
    return withTransaction(actorUserId, async client => {
      const result = await client.query(
        `SELECT id, admin_email AS "adminEmail", action, target, detail, created_at_value AS "createdAt"
         FROM luna.runtime_admin_audit ORDER BY created_at_value DESC, id LIMIT $1::integer`,
        [Math.min(200, Math.max(1, Number(limit) || 100))]
      );
      return result.rows.map(row => ({ ...row, createdAt: Number(row.createdAt) }));
    });
  }

  async function runtimeListAccounts(actorUserId) {
    return withTransaction(actorUserId, async client => {
      const admin = await client.query('SELECT luna.runtime_is_admin() AS is_admin');
      if (!(admin.rows[0] && (admin.rows[0].is_admin === true || admin.rows[0].is_admin === 't'))) {
        throw repositoryError('forbidden', '当前账户没有管理员权限', 403);
      }
      const result = await client.query('SELECT * FROM luna.runtime_accounts_all()');
      return result.rows;
    });
  }

  /** 注册新账户；密码摘要只从服务端传入，数据库函数完成唯一性校验。 */
  async function runtimeRegisterAccount(input) {
    const email = String(input.email || '').trim().toLowerCase();
    const userId = normalizeLegacyId(input.userId, 'userId');
    return withTransaction('', async client => {
      await client.query(
        `SELECT luna.runtime_register_account(
          $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text,
          $7::text, $8::text, $9::text, $10::text, $11::numeric, $12::numeric,
          $13::text
        )`,
        [
          internalUuid(userId), userId, email, String(input.name || '').slice(0, 120),
          String(input.avatar || ''), String(input.bio || '').slice(0, 500),
          String(input.defaultModel || '').slice(0, 120), String(input.salt || ''),
          String(input.pwd || ''), String(input.role || 'normal'),
          Math.max(0, Number(input.credits) || 0), Math.max(0, Number(input.spent) || 0),
          String(input.createdAtText || input.createdAt || '')
        ]
      );
      const result = await client.query('SELECT * FROM luna.runtime_account_by_email($1::text) LIMIT 1', [email]);
      await notifyRuntimeChanged(client, 'account', userId);
      return result.rows[0] || null;
    });
  }

  /** 更新账户资料或管理员字段，使用数据库 RLS 判断目标账户权限。 */
  async function runtimeUpdateAccount(input) {
    const actorUserId = normalizeLegacyId(input.actorUserId || input.userId, 'actorUserId');
    const targetUserId = normalizeLegacyId(input.userId, 'userId');
    return withTransaction(actorUserId, async client => {
      const target = internalUuid(targetUserId);
      if (input.role !== undefined) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('molan-account-roles', 0))");
        const current = await client.query('SELECT role FROM luna.runtime_accounts WHERE id = $1::uuid FOR UPDATE', [target]);
        if (current.rows[0]?.role === 'admin' && input.role !== 'admin') {
          const admins = await client.query("SELECT count(*)::integer AS count FROM luna.runtime_accounts WHERE role = 'admin'");
          if (Number(admins.rows[0]?.count) <= 1) {
            throw repositoryError('last_admin', '不能删除最后一个管理员', 409);
          }
        }
      }
      const values = [
        target, String(input.name || '').slice(0, 120), String(input.avatar || ''),
        String(input.bio || '').slice(0, 500), String(input.defaultModel || '').slice(0, 120),
        String(input.salt || ''), String(input.pwd || ''), String(input.role || 'normal'),
        String(input.level || input.role || 'normal'), String(input.plan || input.role || 'normal'),
        Math.max(0, Number(input.credits) || 0), Math.max(0, Number(input.spent) || 0),
        String(input.createdAtText || input.createdAt || '')
      ];
      const profileValues = values.slice(0, 10).concat(values[12]);
      const result = await client.query(
        input.preserveFinancials === true
          ? `UPDATE luna.runtime_accounts
             SET name = $2::text, avatar = $3::text, bio = $4::text,
                 default_model = $5::text, salt = $6::text, pwd = $7::text,
                 role = $8::text, level = $9::text, plan = $10::text,
                 created_at_text = $11::text, updated_at = now()
             WHERE id = $1::uuid
             RETURNING *`
          : `UPDATE luna.runtime_accounts
             SET name = $2::text, avatar = $3::text, bio = $4::text,
                 default_model = $5::text, salt = $6::text, pwd = $7::text,
                 role = $8::text, level = $9::text, plan = $10::text,
                 credits = $11::numeric, spent = CASE WHEN $14::boolean THEN spent ELSE $12::numeric END,
                 created_at_text = $13::text, updated_at = now()
             WHERE id = $1::uuid
             RETURNING *`,
        input.preserveFinancials === true ? profileValues : [...values, input.preserveSpent === true]
      );
      if (!result.rows.length) throw repositoryError('not_found', '账户不存在或无权更新', 404);
      await notifyRuntimeChanged(client, 'account', targetUserId);
      return result.rows[0];
    });
  }

  /** 只更新账户资料，余额和累计消费由数据库保留当前值，避免覆盖并发计费。 */
  async function runtimeUpdateAccountProfile(input) {
    const actorUserId = normalizeLegacyId(input.actorUserId || input.userId, 'actorUserId');
    const targetUserId = normalizeLegacyId(input.userId, 'userId');
    return withTransaction(actorUserId, async client => {
      const result = await client.query(
        `UPDATE luna.runtime_accounts
         SET name = $2::text, avatar = $3::text, bio = $4::text,
             default_model = $5::text, updated_at = now()
         WHERE id = $1::uuid
         RETURNING *`,
        [internalUuid(targetUserId), String(input.name || '').slice(0, 120), String(input.avatar || ''),
          String(input.bio || '').slice(0, 500), String(input.defaultModel || '').slice(0, 120)]
      );
      if (!result.rows.length) throw repositoryError('not_found', '账户不存在或无权更新', 404);
      await notifyRuntimeChanged(client, 'account-profile', targetUserId);
      return result.rows[0];
    });
  }

  /**
   * 匿名化注销：清除个人资料与密码，释放邮箱，保留账户主键以满足 ON DELETE RESTRICT 外键，
   * 作品与用量账本继续以匿名数据保留。管理员账户在 SQL 条件中被排除。
   */
  async function runtimeDeactivateAccount(input) {
    const targetUserId = normalizeLegacyId(input.userId, 'userId');
    return withTransaction(targetUserId, async client => {
      const target = internalUuid(targetUserId);
      const tombstone = `deleted-${target.replace(/-/g, '')}@deleted.molan.invalid`;
      const result = await client.query(
        `UPDATE luna.runtime_accounts
         SET email = $2::text, name = '已注销用户', avatar = '', bio = '', default_model = '',
             salt = '', pwd = '!deactivated', role = 'normal', level = 'normal', plan = 'normal',
             credits = 0, updated_at = now()
         WHERE id = $1::uuid AND role <> 'admin'
         RETURNING id`,
        [target, tombstone]
      );
      if (!result.rows.length) throw repositoryError('not_found', '账户不存在或不允许注销', 404);
      await notifyRuntimeChanged(client, 'account', targetUserId);
      return { userId: targetUserId, tombstoneEmail: tombstone };
    });
  }

  /** 账户余额使用原子增量更新，避免多个实例基于旧缓存覆盖积分。 */
  async function runtimeAdjustCredits(input) {
    const actorUserId = normalizeLegacyId(input.actorUserId || input.userId, 'actorUserId');
    const targetUserId = normalizeLegacyId(input.userId, 'userId');
    const delta = Number(input.delta) || 0;
    return withTransaction(actorUserId, async client => {
      const result = await client.query(
        `UPDATE luna.runtime_accounts
         SET credits = GREATEST(0, credits + $2::numeric),
             spent = GREATEST(0, spent + $3::numeric), updated_at = now()
         WHERE id = $1::uuid AND role <> 'admin'
         RETURNING *`,
        [internalUuid(targetUserId), delta, Number(input.spentDelta) || 0]
      );
      if (!result.rows.length) throw repositoryError('not_found', '账户不存在或余额更新被拒绝', 404);
      await notifyRuntimeChanged(client, 'account', targetUserId);
      return result.rows[0];
    });
  }

  /** 在 PG 同一事务内预占 AI 积分并写入 token_usage 兼容行，幂等键为 request_id。 */
  async function runtimeReserveTokenUsage(input) {
    const actorUserId = normalizeLegacyId(input.actorUserId || input.userId, 'actorUserId');
    const requestId = String(input.requestId || '').trim();
    const reserve = Math.max(0, Number(input.reservedCost) || 0);
    if (!requestId) throw repositoryError('invalid_token_reservation', 'Token 预占参数无效', 422);
    const document = input.document && typeof input.document === 'object' ? input.document : {};
    const cells = Array.isArray(input.cells) ? input.cells : [];
    return withTransaction(actorUserId, async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('token-usage:' || $1::text, 0))", [requestId]);
      const existing = await client.query(
        `SELECT document FROM luna.runtime_dissection_rows
         WHERE owner_actor_id = luna.actor_id() AND source_table = 'token_usage'
           AND row_key = $1::text AND deleted_at IS NULL
         FOR UPDATE`, [requestId]
      );
      const accountResult = await client.query(
        `SELECT role, credits FROM luna.runtime_accounts WHERE id = luna.actor_id() FOR UPDATE`
      );
      if (!accountResult.rows.length) throw repositoryError('not_found', '账户不存在或不能预占积分', 404);
      const isAdmin = String(accountResult.rows[0].role || '') === 'admin';
      if (existing.rows.length) {
        const current = parseJsonDocument(existing.rows[0].document) || {};
        const identity = { ...document };
        delete identity.reserved_cost;
        delete identity.reservedCost;
        if (!matchesTokenUsageReservation(current, identity)) {
          return { ok: false, conflict: true, reservedCost: reserve };
        }
        return {
          ok: true, existing: true, reservedCost: Number(current.reserved_cost) || reserve,
          remainingCredits: null, document: current
        };
      }
      if (input.lookupOnly === true) {
        return { ok: true, existing: false, missing: true, reservedCost: reserve };
      }
      let remainingCredits = Number(accountResult.rows[0].credits) || 0;
      if (!isAdmin && reserve > 0) {
        const account = await client.query(
          `UPDATE luna.runtime_accounts
           SET credits = credits - $1::numeric, updated_at = now()
           WHERE id = luna.actor_id() AND role <> 'admin' AND credits >= $1::numeric
           RETURNING credits`, [reserve]
        );
        if (!account.rows.length) return { ok: false, reservedCost: reserve };
        remainingCredits = Number(account.rows[0].credits) || 0;
      }
      const hash = jsonHash(document);
      await client.query(
        `INSERT INTO luna.runtime_dissection_rows
          (owner_actor_id, owner_user_id, source_table, row_key, dissection_id,
           document, cells, row_sha256, value_sha256, deleted_at, updated_at)
         VALUES (luna.actor_id(), $1::text, 'token_usage', $2::text, '', $3::jsonb, $4::jsonb, $5::text, $5::text, NULL, now())`,
        [actorUserId, requestId, JSON.stringify(document), JSON.stringify(cells), hash]
      );
      await notifyRuntimeChanged(client, 'token-reserved', requestId);
      return {
        ok: true, existing: false, reservedCost: reserve,
        remainingCredits, document
      };
    });
  }

  function hasValidExactTokenCount(value) {
    if (value === null || value === undefined || typeof value === 'boolean') return false;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '' || !/^\d+$/.test(trimmed)) return false;
      const n = Number(trimmed);
      return Number.isSafeInteger(n) && n >= 0;
    }
    if (typeof value === 'number') {
      return Number.isSafeInteger(value) && value >= 0;
    }
    return false;
  }

  async function runtimeRecordDispatchAttempt(input = {}) {
    const actorUserId = normalizeLegacyId(input.actorUserId || input.userId, 'actorUserId');
    const requestId = String(input.requestId || '').trim();
    if (!requestId) throw repositoryError('invalid_dispatch_attempt', '派发边界缺少 request_id', 422);
    const pass = Number(input.pass) || 1;
    const stage = String(input.stage || (pass === 1 ? 'first_pass' : 'second_pass'));
    const attemptId = String(input.attemptId || input.attempt_id || '').trim();
    return withTransaction(actorUserId, async client => {
      const existing = await client.query(
        `SELECT document FROM luna.runtime_dissection_rows
         WHERE owner_actor_id = luna.actor_id() AND source_table = 'token_usage'
           AND row_key = $1::text AND deleted_at IS NULL
         FOR UPDATE`, [requestId]
      );
      if (!existing.rows.length) {
        throw repositoryError('reservation_not_found', '费用预占不存在，无法记录派发边界', 404);
      }
      const current = parseJsonDocument(existing.rows[0].document) || {};
      const currentStatus = String(current.status || '');
      if (currentStatus === 'settled' || currentStatus === 'succeeded' || currentStatus === 'completed' || (current.credit_cost != null && currentStatus !== 'reserved' && currentStatus !== 'dispatched')) {
        return { ok: false, authorized: false, status: 'settled', rejected: true, code: 'RESERVATION_ALREADY_SETTLED', idempotent: true };
      }
      if (currentStatus === 'released' || currentStatus === 'aborted') {
        return { ok: false, authorized: false, status: currentStatus, rejected: true, code: 'RESERVATION_ALREADY_RELEASED', idempotent: true };
      }
      if (currentStatus === 'provider_unknown') {
        return { ok: false, authorized: false, status: 'provider_unknown', rejected: true, code: 'RESERVATION_PROVIDER_UNKNOWN', idempotent: true, attempts: current.dispatch_attempts || [] };
      }
      const attempts = Array.isArray(current.dispatch_attempts) ? [...current.dispatch_attempts] : [];
      if (attemptId && attempts.some(a => (a.attemptId === attemptId || a.attempt_id === attemptId))) {
        return { ok: false, authorized: false, duplicate: true, status: currentStatus, attempts, idempotent: true };
      }
      const newAttemptId = attemptId || `${requestId}_att_${pass}_${attempts.length + 1}`;
      const leaseMs = Number(input.leaseMs) || 120000;
      const leaseUntil = Number(input.leaseUntil) || (Date.now() + leaseMs);
      const attempt = {
        attemptId: newAttemptId,
        attempt_id: newAttemptId,
        pass,
        stage,
        dispatched_at: new Date().toISOString(),
        lease_until: leaseUntil,
        model_id: input.modelId || current.model_id || '',
        provider_model: input.providerModel || current.provider_model || ''
      };
      attempts.push(attempt);
      const nextStatus = currentStatus === 'reserved' ? 'dispatched' : currentStatus;
      const nextDocument = {
        ...current,
        status: nextStatus,
        dispatched: true,
        lease_until: leaseUntil,
        instance_id: input.instanceId || '',
        dispatch_attempts: attempts,
        updated_at: Date.now()
      };
      const hash = jsonHash(nextDocument);
      await client.query(
        `UPDATE luna.runtime_dissection_rows
         SET document = $2::jsonb, row_sha256 = $3::text, value_sha256 = $3::text, updated_at = now()
         WHERE owner_actor_id = luna.actor_id() AND source_table = 'token_usage'
           AND row_key = $1::text`,
        [requestId, JSON.stringify(nextDocument), hash]
      );
      await notifyRuntimeChanged(client, 'token-dispatched', requestId);
      return { ok: true, authorized: true, pass, stage, status: nextStatus, attemptId: newAttemptId, attempts, idempotent: false };
    });
  }

  /** 在 PG 同一事务内结算或释放 token 预占，并保存完整用量行。 */
  async function runtimeSettleTokenUsage(input) {
    const actorUserId = normalizeLegacyId(input.actorUserId || input.userId, 'actorUserId');
    const requestId = String(input.requestId || '').trim();
    if (!requestId) throw repositoryError('invalid_token_usage', 'Token 用量缺少 request_id', 422);
    const requestedActualCost = Math.max(0, Number(input.actualCost) || 0);
    const document = input.document && typeof input.document === 'object' ? input.document : {};
    const cells = Array.isArray(input.cells) ? input.cells : [];
    const isAdmin = input.isAdmin === true;
    return withTransaction(actorUserId, async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('token-usage:' || $1::text, 0))", [requestId]);
      const existing = await client.query(
        `SELECT document FROM luna.runtime_dissection_rows
         WHERE owner_actor_id = luna.actor_id() AND source_table = 'token_usage'
           AND row_key = $1::text AND deleted_at IS NULL
         FOR UPDATE`, [requestId]
      );
      if (existing.rows.length) {
        const current = parseJsonDocument(existing.rows[0].document) || {};
        const currentStatus = String(current.status || '');
        const reserved = Math.max(0, Number(current.reserved_cost) || Number(input.reservedCost) || 0);
        if (currentStatus === 'provider_unknown' && input.holdReservation === true) {
          return { recorded: false, creditCost: null, status: currentStatus, billingStatus: 'pending', document: current };
        }
        if ((currentStatus === 'reserved' || currentStatus === 'dispatched') && input.holdReservation === true) {
          const pendingDocument = {
            ...current,
            ...document,
            status: 'provider_unknown',
            provider_unknown_diagnostic: String(document.provider_unknown_diagnostic || document.status || 'usage_unavailable'),
            credit_cost: null,
            reserved_cost: reserved
          };
          const hash = jsonHash(pendingDocument);
          await client.query(
            `UPDATE luna.runtime_dissection_rows
             SET document = $2::jsonb, cells = $3::jsonb, row_sha256 = $4::text,
                 value_sha256 = $4::text, updated_at = now()
             WHERE owner_actor_id = luna.actor_id() AND source_table = 'token_usage'
               AND row_key = $1::text`,
            [requestId, JSON.stringify(pendingDocument), JSON.stringify(cells), hash]
          );
          await notifyRuntimeChanged(client, 'token-provider-unknown', requestId);
          return { recorded: true, creditCost: null, status: 'provider_unknown', billingStatus: 'pending', document: pendingDocument };
        }
        const rawTokens = document.total_tokens !== undefined ? document.total_tokens : document.totalTokens;
        const isIncomplete = Boolean(document.provider_usage_incomplete === true || document.providerUsageIncomplete === true);
        const hasExactUsage = hasValidExactTokenCount(rawTokens) && !isIncomplete;
        if ((currentStatus === 'provider_unknown' || currentStatus === 'dispatched') && !hasExactUsage) {
          return { recorded: false, creditCost: null, status: currentStatus, billingStatus: 'pending', document: current };
        }
        if (currentStatus !== 'reserved' && currentStatus !== 'provider_unknown' && currentStatus !== 'dispatched') {
          return {
            recorded: false,
            creditCost: current.credit_cost == null ? null : Number(current.credit_cost),
            status: currentStatus,
            document: current
          };
        }
        const actualCost = Math.min(reserved || requestedActualCost, requestedActualCost);
        if (!isAdmin && reserved) {
          const account = await client.query(
            `UPDATE luna.runtime_accounts
             SET credits = GREATEST(0, credits + $1::numeric - $2::numeric),
                 spent = GREATEST(0, spent + $2::numeric), updated_at = now()
             WHERE id = luna.actor_id() AND role <> 'admin'
             RETURNING credits`, [reserved, actualCost]
          );
          if (!account.rows.length) throw repositoryError('not_found', '账户不存在或余额结算被拒绝', 404);
        }
        const finalDocument = { ...current, ...document, credit_cost: actualCost, reserved_cost: reserved };
        const hash = jsonHash(finalDocument);
        await client.query(
          `UPDATE luna.runtime_dissection_rows
           SET document = $2::jsonb, cells = $3::jsonb, row_sha256 = $4::text,
               value_sha256 = $4::text, updated_at = now()
           WHERE owner_actor_id = luna.actor_id() AND source_table = 'token_usage'
             AND row_key = $1::text`,
          [requestId, JSON.stringify(finalDocument), JSON.stringify(cells), hash]
        );
        await notifyRuntimeChanged(client, 'token-settled', requestId);
        return { recorded: true, creditCost: actualCost, status: String(finalDocument.status || '') };
      }
      if (input.holdReservation === true) {
        throw repositoryError('token_reservation_missing', '未知供应商结果缺少费用预占，无法安全暂存', 409);
      }
      const hash = jsonHash(document);
      await client.query(
        `INSERT INTO luna.runtime_dissection_rows
          (owner_actor_id, owner_user_id, source_table, row_key, dissection_id,
           document, cells, row_sha256, value_sha256, deleted_at, updated_at)
         VALUES (luna.actor_id(), $1::text, 'token_usage', $2::text, '', $3::jsonb, $4::jsonb, $5::text, $5::text, NULL, now())`,
        [actorUserId, requestId, JSON.stringify(document), JSON.stringify(cells), hash]
      );
      await notifyRuntimeChanged(client, 'token-recorded', requestId);
      return { recorded: true, creditCost: Number(document.credit_cost) || requestedActualCost, status: String(document.status || '') };
    });
  }

  /** 释放超时且仍处于 reserved 的 token 预占，调用方必须提供管理员 actor。 */
  async function runtimeReleaseStaleTokenUsage(input = {}) {
    const actorUserId = normalizeLegacyId(input.actorUserId, 'actorUserId');
    const cutoff = Number(input.cutoff) || Date.now();
    const callerInstanceId = String(input.instanceId || '').trim();
    const now = Date.now();
    return withTransaction(actorUserId, async client => {
      const result = await client.query(
        `SELECT owner_actor_id, owner_user_id, row_key, document
         FROM luna.runtime_dissection_rows
         WHERE source_table = 'token_usage' AND deleted_at IS NULL
         FOR UPDATE`
      );
      let released = 0;
      for (const row of result.rows) {
        const document = parseJsonDocument(row.document) || {};
        const rowTime = Number(document.updated_at || document.created_at || 0);
        if (!(rowTime > 0) || rowTime >= cutoff) continue;
        if (String(document.status || '') === 'dispatched') {
          const leaseUntil = Number(document.lease_until || document.leaseUntil || 0);
          const isOtherInstance = Boolean(document.instance_id && (!callerInstanceId || document.instance_id !== callerInstanceId));
          if (isOtherInstance && leaseUntil > now) continue;
          if (document.instance_id && leaseUntil > now) continue;
          const next = {
            ...document,
            status: 'provider_unknown',
            credit_cost: null,
            provider_unknown_diagnostic: 'recovered_from_stale_dispatch'
          };
          const hash = jsonHash(next);
          await client.query(
            `UPDATE luna.runtime_dissection_rows
             SET document = $3::jsonb, row_sha256 = $4::text, value_sha256 = $4::text, updated_at = now()
             WHERE owner_actor_id = $1::uuid AND source_table = 'token_usage' AND row_key = $2::text`,
            [String(row.owner_actor_id || ''), String(row.row_key || ''), JSON.stringify(next), hash]
          );
          continue;
        }
        if (String(document.status || '') !== 'reserved') continue;
        const reserved = Math.max(0, Number(document.reserved_cost) || 0);
        if (reserved) {
          await client.query(
            `UPDATE luna.runtime_accounts
             SET credits = credits + $2::numeric, updated_at = now()
             WHERE legacy_user_id = $1::text AND role <> 'admin'`, [String(row.owner_user_id || ''), reserved]
          );
        }
        const next = { ...document, status: 'aborted', usage_source: 'unavailable', credit_cost: 0 };
        const hash = jsonHash(next);
        await client.query(
          `UPDATE luna.runtime_dissection_rows
           SET document = $3::jsonb, row_sha256 = $4::text, value_sha256 = $4::text, updated_at = now()
           WHERE owner_actor_id = $1::uuid AND source_table = 'token_usage' AND row_key = $2::text`,
          [String(row.owner_actor_id || ''), String(row.row_key || ''), JSON.stringify(next), hash]
        );
        released += 1;
      }
      if (released) await notifyRuntimeChanged(client, 'token-stale-released', String(released));
      return released;
    });
  }

  async function runtimeRecoverInterruptedUsage(input = {}) {
    const actorUserId = normalizeLegacyId(input.actorUserId || input.userId, 'actorUserId');
    const cutoff = input.cutoff !== undefined && input.cutoff !== null ? Number(input.cutoff) : null;
    const callerInstanceId = String(input.instanceId || '').trim();
    const now = Date.now();
    return withTransaction(actorUserId, async client => {
      const result = await client.query(
        `SELECT owner_actor_id, owner_user_id, row_key, document
         FROM luna.runtime_dissection_rows
         WHERE source_table = 'token_usage' AND deleted_at IS NULL
         FOR UPDATE`
      );
      let recovered = 0;
      for (const row of result.rows) {
        const document = parseJsonDocument(row.document) || {};
        if (String(document.status || '') !== 'dispatched') continue;
        const rowTime = Number(document.updated_at || document.created_at || 0);
        const leaseUntil = Number(document.lease_until || document.leaseUntil || 0);
        const isOtherInstance = Boolean(document.instance_id && (!callerInstanceId || document.instance_id !== callerInstanceId));
        if (isOtherInstance && leaseUntil > now) continue;
        if (isOtherInstance && cutoff !== null && rowTime > 0 && rowTime >= cutoff) continue;
        if (leaseUntil > now && !isOtherInstance && cutoff !== null && rowTime > 0 && rowTime >= cutoff) continue;
        if (cutoff !== null && rowTime > 0 && rowTime >= cutoff) continue;
        const next = {
          ...document,
          status: 'provider_unknown',
          credit_cost: null,
          provider_unknown_diagnostic: 'recovered_from_interruption'
        };
        const hash = jsonHash(next);
        await client.query(
          `UPDATE luna.runtime_dissection_rows
           SET document = $3::jsonb, row_sha256 = $4::text, value_sha256 = $4::text, updated_at = now()
           WHERE owner_actor_id = $1::uuid AND source_table = 'token_usage' AND row_key = $2::text`,
          [String(row.owner_actor_id || ''), String(row.row_key || ''), JSON.stringify(next), hash]
        );
        recovered += 1;
      }
      if (recovered) await notifyRuntimeChanged(client, 'token-interrupted-recovered', String(recovered));
      return { recovered };
    });
  }

  async function runtimeListUserSkills(actorUserId) {
    return withTransaction(actorUserId, async client => {
      const result = await client.query(
        `SELECT * FROM luna.runtime_user_skills
         WHERE owner_user_id = luna.actor_id()
         ORDER BY updated_at_value DESC, id ASC`
      );
      return result.rows;
    });
  }

  function runtimeSkillFields(skill, fallbackFiles = '[]') {
    const value = skill && typeof skill === 'object' ? skill : {};
    const filesJson = typeof value.files_json === 'string'
      ? value.files_json
      : typeof value.filesJson === 'string' ? value.filesJson
        : JSON.stringify(Array.isArray(value.files) ? value.files : fallbackFiles === '{}' ? {} : []);
    const document = value.document && typeof value.document === 'object'
      ? value.document
      : {
          id: String(value.id || ''), name: String(value.name || value.id || ''),
          description: String(value.description || ''), instruction: String(value.instruction || ''),
          files_json: filesJson
        };
    const cells = Array.isArray(value.cells) ? value.cells : [];
    return {
      id: String(value.id || '').trim(), name: String(value.name || value.id || '').slice(0, 120),
      description: String(value.description || '').slice(0, 500), instruction: String(value.instruction || '').slice(0, 1000000),
      filesJson, document: JSON.stringify(document), cells: JSON.stringify(cells),
      size: Math.max(0, Number(value.size) || String(value.instruction || '').length),
      updatedAt: Math.max(0, Number(value.updated_at_value ?? value.updatedAt) || Date.now())
    };
  }

  async function runtimeUpsertUserSkill(input) {
    const actorUserId = normalizeLegacyId(input.actorUserId, 'actorUserId');
    const skill = runtimeSkillFields(input.skill);
    if (!skill.id || !skill.instruction) throw new Error('Skill 名称和指令不能为空');
    return withTransaction(actorUserId, async client => {
      const result = await client.query(
        `INSERT INTO luna.runtime_user_skills
          (owner_user_id, owner_user_legacy_id, owner_email, id, name, description,
           instruction, files_json, size, updated_at_value, document, cells, updated_at)
         VALUES (luna.actor_id(), $1::text, $2::text, $3::text, $4::text, $5::text,
                 $6::text, $7::text, $8::bigint, $9::bigint, $10::jsonb, $11::jsonb, now())
         ON CONFLICT (owner_user_id, id) DO UPDATE SET
           name = EXCLUDED.name, description = EXCLUDED.description,
           instruction = EXCLUDED.instruction, files_json = EXCLUDED.files_json,
           size = EXCLUDED.size, updated_at_value = EXCLUDED.updated_at_value,
           document = EXCLUDED.document, cells = EXCLUDED.cells, updated_at = now()
         RETURNING *`,
        [actorUserId, String(input.ownerEmail || '').trim().toLowerCase(),
          skill.id, skill.name, skill.description, skill.instruction, skill.filesJson,
          skill.size, skill.updatedAt, skill.document, skill.cells]
      );
      await notifyRuntimeChanged(client, 'user-skills', actorUserId);
      return result.rows[0];
    });
  }

  async function runtimeReplaceUserSkills(input) {
    const actorUserId = normalizeLegacyId(input.actorUserId || input.ownerUserId, 'actorUserId');
    const ownerUserId = normalizeLegacyId(input.ownerUserId, 'ownerUserId');
    const ownerEmail = String(input.ownerEmail || '').trim().toLowerCase();
    return withTransaction(actorUserId, async client => {
      await client.query('DELETE FROM luna.runtime_user_skills WHERE owner_user_id = $1::uuid', [internalUuid(ownerUserId)]);
      for (const rawSkill of Array.isArray(input.skills) ? input.skills : []) {
        const skill = runtimeSkillFields(rawSkill, '[]');
        if (!skill.id || !skill.instruction) continue;
        await client.query(
          `INSERT INTO luna.runtime_user_skills
            (owner_user_id, owner_user_legacy_id, owner_email, id, name, description,
             instruction, files_json, size, updated_at_value, document, cells, updated_at)
           VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text,
                   $7::text, $8::text, $9::bigint, $10::bigint, $11::jsonb, $12::jsonb, now())
           ON CONFLICT (owner_user_id, id) DO UPDATE SET
             owner_user_legacy_id = EXCLUDED.owner_user_legacy_id, owner_email = EXCLUDED.owner_email,
             name = EXCLUDED.name, description = EXCLUDED.description, instruction = EXCLUDED.instruction,
             files_json = EXCLUDED.files_json, size = EXCLUDED.size, updated_at_value = EXCLUDED.updated_at_value,
             document = EXCLUDED.document, cells = EXCLUDED.cells, updated_at = now()`,
          [internalUuid(ownerUserId), ownerUserId, ownerEmail, skill.id, skill.name, skill.description,
            skill.instruction, skill.filesJson, skill.size, skill.updatedAt, skill.document, skill.cells]
        );
      }
      await notifyRuntimeChanged(client, 'user-skills', ownerUserId);
      const result = await client.query(
        `SELECT * FROM luna.runtime_user_skills WHERE owner_user_id = $1::uuid ORDER BY updated_at_value DESC, id ASC`,
        [internalUuid(ownerUserId)]
      );
      return result.rows;
    });
  }

  async function runtimeListGlobalSkills(actorUserId = '') {
    return withTransaction(actorUserId, async client => {
      const result = await client.query('SELECT * FROM luna.runtime_global_skills ORDER BY updated_at_value DESC, id ASC');
      return result.rows;
    });
  }

  async function runtimeReplaceGlobalSkills(actorUserId, skills, expectedRows, audit) {
    const actor = normalizeLegacyId(actorUserId, 'actorUserId');
    return withTransaction(actor, async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('molan-global-skills', 0))");
      if (expectedRows !== undefined) {
        const current = await client.query('SELECT * FROM luna.runtime_global_skills ORDER BY updated_at_value DESC, id ASC');
        if (JSON.stringify(current.rows) !== JSON.stringify(expectedRows)) {
          throw repositoryError('revision_conflict', '全局 Skill 已变化，请重新加载', 409);
        }
      }
      await client.query('DELETE FROM luna.runtime_global_skills');
      for (const rawSkill of Array.isArray(skills) ? skills : []) {
        const skill = runtimeSkillFields(rawSkill, '{}');
        if (!skill.id || !skill.instruction) continue;
        const value = rawSkill && typeof rawSkill === 'object' ? rawSkill : {};
        const targetsJson = typeof value.targets_json === 'string'
          ? value.targets_json : JSON.stringify(Array.isArray(value.targets) ? value.targets : ['all']);
        await client.query(
          `INSERT INTO luna.runtime_global_skills
            (id, name, description, instruction, targets_json, enabled, created_at_value,
             updated_at_value, files_json, document, cells, updated_at)
           VALUES ($1::text, $2::text, $3::text, $4::text, $5::text, $6::boolean,
                   $7::bigint, $8::bigint, $9::text, $10::jsonb, $11::jsonb, now())
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name, description = EXCLUDED.description, instruction = EXCLUDED.instruction,
             targets_json = EXCLUDED.targets_json, enabled = EXCLUDED.enabled,
             updated_at_value = EXCLUDED.updated_at_value, files_json = EXCLUDED.files_json,
             document = EXCLUDED.document, cells = EXCLUDED.cells, updated_at = now()`,
          [skill.id, skill.name, skill.description, skill.instruction, targetsJson, value.enabled !== false,
            Math.max(0, Number(value.created_at_value ?? value.createdAt) || skill.updatedAt), skill.updatedAt,
            skill.filesJson, skill.document, skill.cells]
        );
      }
      if (audit) await appendAdminAuditInTx(client, audit);
      await notifyRuntimeChanged(client, 'global-skills');
      const result = await client.query('SELECT * FROM luna.runtime_global_skills ORDER BY updated_at_value DESC, id ASC');
      return result.rows;
    });
  }

  async function runtimeListOpenSkills(actorUserId = '') {
    return withTransaction(actorUserId, async client => {
      const result = await client.query('SELECT * FROM luna.runtime_open_skills ORDER BY updated_at_value DESC, id ASC');
      return result.rows;
    });
  }

  async function runtimeGetOpenSkill(actorUserId, skillId) {
    return withTransaction(actorUserId || '', async client => {
      const result = await client.query('SELECT * FROM luna.runtime_open_skills WHERE id = $1::text LIMIT 1', [String(skillId || '')]);
      return result.rows[0] || null;
    });
  }

  async function runtimeUpsertOpenSkill(input) {
    const actorUserId = normalizeLegacyId(input.actorUserId || input.ownerUserId, 'actorUserId');
    const ownerUserId = normalizeLegacyId(input.ownerUserId || actorUserId, 'ownerUserId');
    const value = input.skill && typeof input.skill === 'object' ? input.skill : input;
    const skill = runtimeSkillFields(value, '[]');
    if (!skill.id || !skill.instruction) throw repositoryError('invalid_skill', 'Skill 内容不能为空', 422);
    return withTransaction(actorUserId, async client => {
      if (input.expectedUpdatedAt !== undefined) {
        const current = await client.query(
          'SELECT updated_at_value FROM luna.runtime_open_skills WHERE id = $1::text FOR UPDATE',
          [skill.id]
        );
        if (!current.rows[0]) throw repositoryError('not_found', '开放 Skill 不存在', 404);
        if (Number(current.rows[0].updated_at_value) !== input.expectedUpdatedAt) {
          throw repositoryError('revision_conflict', '开放 Skill 已变化，请重新加载', 409);
        }
        skill.updatedAt = Math.max(skill.updatedAt, input.expectedUpdatedAt + 1);
      }
      const result = await client.query(
        `INSERT INTO luna.runtime_open_skills
          (owner_user_id, owner_user_legacy_id, owner_email, id, name, description, instruction,
           files_json, status, downloads, created_at_value, updated_at_value, document, cells, updated_at)
         VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text,
                 $8::text, $9::text, $10::bigint, $11::bigint, $12::bigint, $13::jsonb, $14::jsonb, now())
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, description = EXCLUDED.description, instruction = EXCLUDED.instruction,
           files_json = EXCLUDED.files_json, status = EXCLUDED.status, updated_at_value = EXCLUDED.updated_at_value,
           document = EXCLUDED.document, cells = EXCLUDED.cells, updated_at = now()
         RETURNING *`,
        [internalUuid(ownerUserId), ownerUserId, String(input.ownerEmail || value.ownerEmail || '').trim().toLowerCase(),
          skill.id, skill.name, skill.description, skill.instruction, skill.filesJson,
          String(value.status || 'published'), Math.max(0, Number(value.downloads) || 0),
          Math.max(0, Number(value.created_at_value ?? value.createdAt) || skill.updatedAt), skill.updatedAt,
          skill.document, skill.cells]
      );
      await notifyRuntimeChanged(client, 'open-skills', skill.id);
      return result.rows[0] || null;
    });
  }

  async function runtimeDeleteOpenSkill(actorUserId, skillId) {
    return withTransaction(actorUserId, async client => {
      const result = await client.query('DELETE FROM luna.runtime_open_skills WHERE id = $1::text RETURNING id', [String(skillId || '')]);
      if (result.rows.length) await notifyRuntimeChanged(client, 'open-skills', skillId);
      return result.rows.length;
    });
  }

  /** 下载公开 Skill 与个人副本在同一事务内完成，下载计数不会丢失。 */
  async function runtimeDownloadOpenSkill(input) {
    const actorUserId = normalizeLegacyId(input.actorUserId, 'actorUserId');
    const ownerEmail = String(input.ownerEmail || '').trim().toLowerCase();
    const copiedId = normalizeLegacyId(input.copiedId, 'copiedId');
    return withTransaction(actorUserId, async client => {
      const source = await client.query('SELECT * FROM luna.download_open_skill($1::text)', [String(input.skillId || '')]);
      const sourceRow = source.rows[0];
      if (!sourceRow) throw repositoryError('not_found', '公开 Skill 不存在或未发布', 404);
      const copied = await client.query(
        `INSERT INTO luna.runtime_user_skills
          (owner_user_id, owner_user_legacy_id, owner_email, id, name, description, instruction,
           files_json, size, updated_at_value, document, cells, updated_at)
         VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text,
                 $8::text, $9::bigint, $10::bigint, $11::jsonb, $12::jsonb, now())
         ON CONFLICT (owner_user_id, id) DO UPDATE SET
           name = EXCLUDED.name, description = EXCLUDED.description, instruction = EXCLUDED.instruction,
           files_json = EXCLUDED.files_json, size = EXCLUDED.size, updated_at_value = EXCLUDED.updated_at_value,
           document = EXCLUDED.document, cells = EXCLUDED.cells, updated_at = now()
         RETURNING *`,
        [internalUuid(actorUserId), actorUserId, ownerEmail, copiedId, sourceRow.name, sourceRow.description,
          sourceRow.instruction, sourceRow.files_json, String(sourceRow.instruction || '').length,
          Number(sourceRow.updated_at_value) || Date.now(), sourceRow.document, sourceRow.cells]
      );
      await notifyRuntimeChanged(client, 'open-skill-download', String(input.skillId || ''));
      return { source: sourceRow, copied: copied.rows[0] || null };
    });
  }

  const runtimeDissectionMethods = createPostgresRuntimeDissectionMethods({
    internalUuid,
    normalizeLegacyId,
    repositoryError,
    parseJsonDocument,
    parseJsonValue,
    jsonHash,
    withTransaction,
    ensureActor,
    notifyRuntimeChanged,
    dissectionWorkerContext,
    appendAdminAuditInTx,
    hasValidExactTokenCount,
    runtimeUpdateAccount,
    mergeResourcesIntoState,
    resourcesForClient,
    syncStructuredResourceProjection,
    parseStoredSkillFiles,
    normalizeSkillRuntimeFiles,
    skillFileNames,
    skillRuntimeFilesComplete,
    serializeSkillFiles
  });

  const generationRunMethods = createPostgresGenerationRunMethods({
    UUID_PATTERN,
    PROJECT_READ_ROLES,
    PROJECT_WRITE_ROLES,
    GENERATION_SAFE_STATES,
    GENERATION_ACTIVE_STATES,
    internalUuid,
    normalizeLegacyId,
    repositoryError,
    parseJsonValue,
    parseJsonDocument,
    publicGenerationRun,
    assertGenerationLease,
    generationNow,
    generationLeaseTtl,
    hasRole,
    withTransaction,
    ensureActor,
    accessForClient,
    notifyRuntimeChanged
  });

  /** 订阅其他应用实例的运行时投影变更，收到通知后由服务刷新内存只读缓存。 */
  async function subscribeRuntimeInvalidation(callback) {
    return subscribeChannel('molan_runtime_changed', callback);
  }

  /** 关闭 PostgreSQL 连接池，供服务优雅退出和测试清理使用。 */
  async function close() {
    if (closed) return;
    closed = true;
    if (listenReconnectTimer) {
      clearTimeout(listenReconnectTimer);
      listenReconnectTimer = null;
    }
    listenChannels.clear();
    if (listenClient) {
      const client = listenClient;
      const standalone = listenClientStandalone;
      listenClient = null;
      listenClientStandalone = false;
      try {
        if (standalone && typeof client.end === 'function') await client.end().catch(() => {});
        else if (typeof client.release === 'function') client.release(true);
      } catch (_) {}
    }
    await pool.end();
  }

  return {
    enabled: true,
    available: true,
    pool,
    internalUuid,
    normalizeLegacyId,
    initialize,
    health,
    close,
    loadRuntimeState,
    loadRuntimeStateChunked,
    runtimeAccountByEmail,
    runtimeAccountByUserId,
    runtimeListAccounts,
    runtimeAppendAdminAudit,
    runtimeListAdminAudit,
    runtimeRegisterAccount,
    runtimeUpdateAccount,
    runtimeUpdateAccountProfile,
    runtimeDeactivateAccount,
    runtimeAdjustCredits,
    runtimeReserveTokenUsage,
    runtimeRecordDispatchAttempt,
    recordDispatchAttempt: runtimeRecordDispatchAttempt,
    runtimeSettleTokenUsage,
    runtimeReleaseStaleTokenUsage,
    runtimeRecoverInterruptedUsage,
    recoverInterruptedUsage: runtimeRecoverInterruptedUsage,
    runtimeListUserSkills,
    runtimeUpsertUserSkill,
    runtimeReplaceUserSkills,
    runtimeListGlobalSkills,
    runtimeReplaceGlobalSkills,
    runtimeListOpenSkills,
    runtimeGetOpenSkill,
    runtimeUpsertOpenSkill,
    runtimeDeleteOpenSkill,
    runtimeDownloadOpenSkill,
    ...runtimeDissectionMethods,
    subscribeRuntimeInvalidation,
    listWorkspaces,
    createWorkspace,
    listProjects,
    getProjectAccess,
    createAuthSession,
    requestAuthSession,
    requestAuthContext,
    createWorkerAuthSession,
    listAuthSessions,
    revokeAuthSession,
    revokeWorkerAuthSession,
    revokeAuthSessions,
    subscribeAuthSessionInvalidation,
    listWorkspaceMembers,
    upsertWorkspaceMember,
    deactivateWorkspaceMember,
    listProjectMembers,
    upsertProjectMember,
    deactivateProjectMember,
    getProfile,
    listExportableChapters,
    saveProfile,
    patchProfileScene,
    deleteProject,
    restoreProject,
    listAllResources,
    listResources,
    listResourceVersions,
    restoreResourceVersion,
    createResource,
    updateResource,
    deleteResource,
    restoreResource,
    restorePackage,
    upsertJob,
    getJob,
    getJobBudget,
    getJobInput,
    finishCreationCoreJob,
    getLegacyPayload,
    storeLegacyPayload,
    importLegacyProjectData,
    claimNextJob,
    heartbeatJob,
    finishJob,
    recordProviderAttempt,
    reserveBudget,
    settleBudget,
    releaseBudget,
    ...creationBookMethods,
    ...generationRunMethods,
    ...createPostgresLabJobMethods({ withTransaction, withWorkerTransaction, internalUuid })
  };
}

module.exports = {
  UUID_PATTERN,
  RESOURCE_KINDS,
  internalUuid,
  normalizeLegacyId,
  mergeResourcesIntoState,
  readConfig,
  createPostgresRepository,
  repositoryError,
  translateDatabaseError
};
