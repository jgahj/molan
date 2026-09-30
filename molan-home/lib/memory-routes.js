'use strict';

/**
 * 墨阑长篇记忆与文风稳定系统 · HTTP 服务路由适配层
 * 
 * 落地方案第十二章 18 个 API 接口：
 *  1. GET    /api/books/:bookId/memory
 *  2. POST   /api/books/:bookId/memory/extract
 *  3. GET    /api/books/:bookId/memory/changesets/:id
 *  4. POST   /api/books/:bookId/memory/changesets/:id/approve
 *  5. POST   /api/books/:bookId/memory/changesets/:id/commit
 *  6. POST   /api/books/:bookId/memory/operations/:id/revert
 *  7. GET    /api/books/:bookId/cognition
 *  8. GET    /api/books/:bookId/timeline
 *  9. POST   /api/books/:bookId/context/assemble
 * 10. GET    /api/books/:bookId/context/:manifestId
 * 11. GET    /api/books/:bookId/styles
 * 12. POST   /api/books/:bookId/styles
 * 13. POST   /api/books/:bookId/style-audits
 * 14. POST   /api/books/:bookId/rewrite
 * 15. POST   /api/books/:bookId/impact-analysis
 * 16. GET    /api/books/:bookId/projections
 * 17. POST   /api/books/:bookId/projections/verify
 * 18. GET    /api/runs/:runId  及  GET /api/runs/:runId/events
 */

const memorySystem = require('./memory-system');
const styleSystem = require('./style-system');
const projectScope = require('./project-scope');
const workflow = require('./memory-workflow');
const domain = require('./memory-domain');
const generation = require('./memory-generation');

/**
 * 辅助读取 HTTP 请求体（JSON）。
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 16 * 1024 * 1024) {
        reject(new Error('请求体过大'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        const parseError = new Error('请求体必须是有效的 JSON 格式');
        parseError.statusCode = 400;
        reject(parseError);
      }
    });
    req.on('error', reject);
  });
}

/**
 * 辅助 JSON 返回。
 */
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

/**
 * 权限验证辅助函数。
 */
function verifyAccess(req, res, getAuthUser, db, bookId, requireWrite = false) {
  const auth = getAuthUser(req);
  if (!auth || !auth.user) {
    sendJson(res, 401, { ok: false, error: '未登录', code: 'UNAUTHORIZED' });
    return null;
  }
  const access = projectScope.getNovelAccess(db, bookId, auth.user.userId);
  if (!access) {
    sendJson(res, 404, { ok: false, code: 'BOOK_NOT_FOUND' });
    return null;
  }
  if (requireWrite && !projectScope.canAccess(access, projectScope.WRITE_ROLES)) {
    sendJson(res, 403, { ok: false, code: 'FORBIDDEN' });
    return null;
  }
  return auth.user;
}

function styleStoreScope(store, db, user, bookId, options = {}) {
  if (store.backend === 'postgres') return { ...options, userId: user.userId, bookId };
  const access = projectScope.getNovelAccess(db, bookId, user.userId);
  if (!access) workflow.fail('BOOK_NOT_FOUND', 404);
  return { ...options, projectId: String(access.project_id), bookId };
}

async function dispatchStyleProfileStore(req, res, urlPath, db, getAuthUser, services) {
  const store = services.styleProfileStore;
  if (!store) return false;
  const profileMatch = urlPath.match(/^\/api\/books\/([A-Za-z0-9_-]+)\/styles$/);
  const versionsMatch = urlPath.match(/^\/api\/books\/([A-Za-z0-9_-]+)\/styles\/([A-Za-z0-9_-]+)\/versions$/);
  if (!profileMatch && !versionsMatch) return false;
  const bookId = (profileMatch || versionsMatch)[1];
  const supported = profileMatch && (req.method === 'GET' || req.method === 'POST') ||
    versionsMatch && req.method === 'GET';
  if (!supported) return false;

  let user;
  if (store.backend === 'postgres') {
    const auth = getAuthUser(req);
    user = auth && auth.user;
    if (!user || !user.userId) {
      sendJson(res, 401, { ok: false, error: '未登录', code: 'UNAUTHORIZED' });
      return true;
    }
  } else {
    user = verifyAccess(req, res, getAuthUser, db, bookId, req.method === 'POST');
    if (!user) return true;
  }

  const parsedUrl = new URL(req.url, 'http://localhost');
  const query = Object.fromEntries(parsedUrl.searchParams.entries());
  const branchId = String(query.branchId || 'main');
  if (versionsMatch) {
    const versions = await store.getStyleProfileVersions(styleStoreScope(store, db, user, bookId, {
      profileId: versionsMatch[2], branchId
    }));
    sendJson(res, 200, { ok: true, bookId, profileId: versionsMatch[2], versions });
    return true;
  }
  if (req.method === 'GET') {
    const styles = await store.getStyleProfiles(styleStoreScope(store, db, user, bookId, {
      branchId, level: query.level || undefined
    }));
    sendJson(res, 200, { ok: true, bookId, styles });
    return true;
  }
  const body = await requestBody(req);
  if (body.id && body.expectedRevision === undefined) workflow.fail('VERSION_REQUIRED', 428);
  const result = await store.upsertStyleProfile(styleStoreScope(store, db, user, bookId, {
    ...body,
    bookId,
    branchId: String(body.branchId || branchId),
    approvedBy: user.userId || user.email
  }));
  sendJson(res, 200, result);
  return true;
}

async function getStoredStyleProfiles(store, db, user, bookId, options = {}) {
  return store.getStyleProfiles(styleStoreScope(store, db, user, bookId, options));
}

/**
 * 记忆与文风核心路由分发器。
 * 匹配返回 true 并处理，未匹配返回 false。
 */
async function dispatch(req, res, urlPath, db, getAuthUser, services = {}) {
  if (services.memoryStore && await require('./memory-store-routes').dispatch(req, res, urlPath, getAuthUser, services)) return true;
  if (services.styleProfileStore) {
    try {
      if (await dispatchStyleProfileStore(req, res, urlPath, db, getAuthUser, services)) return true;
    } catch (error) {
      sendJson(res, error.statusCode || error.status || 500, {
        ok: false,
        code: error.code || 'STYLE_PROFILE_ERROR',
        error: error.statusCode || error.status ? error.message : '文风档案服务处理失败'
      });
      return true;
    }
  }
  if (services.backend === 'postgres') {
    if (!services.postgresMemoryBridge || typeof services.postgresMemoryBridge.dispatch !== 'function') {
      sendJson(res, 503, { ok: false, code: 'PG_MEMORY_BRIDGE_UNAVAILABLE', error: 'PostgreSQL 记忆仓储尚未就绪' });
      return true;
    }
    return services.postgresMemoryBridge.dispatch(req, res, urlPath, getAuthUser, services);
  }
  try {
    return await dispatchInternal(req, res, urlPath, db, getAuthUser, services);
  } catch (error) {
    sendJson(res, error.statusCode || 500, { ok: false, code: error.code || 'MEMORY_INTERNAL_ERROR',
      error: error.statusCode ? error.message : '记忆服务处理失败，未确认提交请使用原请求标识查询' });
    return true;
  }
}

async function requestBody(req) {
  const body = await readJsonBody(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)) workflow.fail('INVALID_REQUEST_BODY', 400);
  return body;
}

async function dispatchInternal(req, res, urlPath, db, getAuthUser, services) {
  let m;
  const parsedUrl = new URL(req.url, 'http://localhost');
  const query = Object.fromEntries(parsedUrl.searchParams.entries());
  const generationMatch = urlPath.match(/^\/api\/books\/([A-Za-z0-9_-]+)\/generations(?:\/([A-Za-z0-9_-]+)\/cancel)?$/);
  if (generationMatch) {
    const [, bookId, runId] = generationMatch;
    const user = verifyAccess(req, res, getAuthUser, db, bookId, req.method !== 'GET');
    if (!user) return true;
    if (req.method === 'GET' && !runId) {
      const run = db.prepare(`SELECT * FROM memory_generation_runs
        WHERE book_id = ? AND actor_id = ? AND request_id = ? ORDER BY created_at DESC LIMIT 1`).get(bookId, user.userId, query.requestId || '');
      if (!run) workflow.fail('RUN_NOT_FOUND', 404);
      sendJson(res, 200, { ok: true, run: generation.publicRun(run) });
    } else if (req.method === 'POST' && runId) {
      sendJson(res, 200, { ok: true, run: generation.cancel(db, bookId, runId) });
    } else if (req.method === 'POST') {
      const authorize = () => projectScope.canAccess(projectScope.getNovelAccess(db, bookId, user.userId), projectScope.WRITE_ROLES, 'spend');
      if (!authorize()) workflow.fail('SPEND_FORBIDDEN', 403);
      const result = await generation.generate(db, bookId, user.userId, await requestBody(req),
        services.generate ? (params, guard) => services.generate(user, params, guard) : null, authorize);
      if (!verifyAccess(req, res, getAuthUser, db, bookId)) return true;
      sendJson(res, 200, { ok: true, run: result });
    } else workflow.fail('METHOD_NOT_ALLOWED', 405);
    return true;
  }
  const workbenchMatch = urlPath.match(/^\/api\/books\/([A-Za-z0-9_-]+)\/(workbench|manuscripts|memory\/changesets|memory\/records|memory\/operations|projections\/process)(?:\/([A-Za-z0-9_-]+))?$/);
  if (workbenchMatch) {
    const [, bookId, resource, recordId] = workbenchMatch;
    if (!['GET', 'POST'].includes(req.method)) {
      sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
      return true;
    }
    const user = verifyAccess(req, res, getAuthUser, db, bookId, req.method === 'POST');
    if (!user) return true;
    if (resource === 'workbench' && req.method === 'GET') {
      const access = projectScope.getNovelAccess(db, bookId, user.userId);
      sendJson(res, 200, { ok: true, ...workflow.workbenchState(db, bookId, query.branchId),
        canWrite: projectScope.canAccess(access, projectScope.WRITE_ROLES) });
      return true;
    }
    if (resource === 'manuscripts') {
      if (req.method === 'POST' && !recordId) {
        sendJson(res, 201, { ok: true, manuscript: workflow.saveManuscript(db, bookId, user.userId, await requestBody(req)) });
      } else if (req.method === 'GET' && recordId) {
        sendJson(res, 200, { ok: true, manuscript: workflow.publicManuscript(workflow.getManuscript(db, bookId, recordId)) });
      } else workflow.fail('ROUTE_NOT_FOUND', 404);
      return true;
    }
    if (resource === 'memory/changesets' && req.method === 'POST' && !recordId) {
      const body = await requestBody(req);
      sendJson(res, 201, { ok: true, changeset: workflow.createBoundChangeset(db, bookId, user.userId, { ...body, requireRewriteReview: true }) });
      return true;
    }
    if (resource === 'memory/records' && req.method === 'GET') {
      const tables = { propositions: 'memory_propositions', evidence: 'memory_evidence', plans: 'story_plans',
        foreshadows: 'story_foreshadows', commitments: 'conditional_commitments', disclosures: 'disclosure_policies',
        events: 'story_events', transitions: 'state_transitions' };
      if (!Object.hasOwn(tables, query.type)) workflow.fail('INVALID_MEMORY_TYPE', 422);
      const offset = Math.max(0, Number(query.offset) || 0);
      const rows = db.prepare(`SELECT * FROM ${tables[query.type]} WHERE book_id = ? AND branch_id = ? ORDER BY created_at DESC, id LIMIT 100 OFFSET ?`)
        .all(bookId, query.branchId || 'main', offset);
      sendJson(res, 200, { ok: true, records: rows, offset, nextOffset: rows.length === 100 ? offset + 100 : null });
      return true;
    }
    if (resource === 'memory/operations' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, operations: db.prepare(`SELECT * FROM memory_operations_log
        WHERE book_id = ? AND branch_id = ? ORDER BY rowid DESC LIMIT 100`).all(bookId, query.branchId || 'main') });
      return true;
    }
    if (resource === 'projections/process' && req.method === 'POST') {
      const body = await requestBody(req);
      sendJson(res, 200, { ok: true, projections: workflow.processProjections(db, bookId, body.branchId || 'main') });
      return true;
    }
    if (!(resource === 'memory/changesets' && req.method === 'GET' && recordId)) workflow.fail('ROUTE_NOT_FOUND', 404);
  }

  // 1. GET /api/books/:bookId/memory
  if (req.method === 'GET' && (m = urlPath.match(/^\/api\/books\/([A-Za-z0-9_-]+)\/memory$/))) {
    const bookId = m[1];
    const user = verifyAccess(req, res, getAuthUser, db, bookId);
    if (!user) return true;
    const memory = memorySystem.getMemory(db, bookId, query);
    sendJson(res, 200, { ok: true, bookId, memory });
    return true;
  }

  // 2. POST /api/books/:bookId/memory/extract
  if (req.method === 'POST' && (m = urlPath.match(/^\/api\/books\/([A-Za-z0-9_-]+)\/memory\/extract$/))) {
    const bookId = m[1];
    const user = verifyAccess(req, res, getAuthUser, db, bookId, true);
    if (!user) return true;
    const body = await readJsonBody(req).catch(e => ({ error: e.message }));
    if (body.error) {
      sendJson(res, 400, { ok: false, error: body.error });
      return true;
    }
    const result = body.manuscriptRevisionId
      ? workflow.extractSavedManuscript(db, bookId, body.manuscriptRevisionId)
      : memorySystem.extractPropositionsAndEvidence(body.text, { ...body, bookId });
    sendJson(res, 200, { ok: true, bookId, ...result });
    return true;
  }

  // 3. GET /api/books/:bookId/memory/changesets/:id
  if (req.method === 'GET' && (m = urlPath.match(/^\/api\/books\/([A-Za-z0-9_-]+)\/memory\/changesets\/([A-Za-z0-9_-]+)$/))) {
    const [_, bookId, changesetId] = m;
    const user = verifyAccess(req, res, getAuthUser, db, bookId);
    if (!user) return true;
    const row = db.prepare('SELECT * FROM memory_changesets WHERE book_id = ? AND id = ?').get(bookId, changesetId);
    if (!row) {
      sendJson(res, 404, { ok: false, error: '变更集不存在', code: 'CHANGESET_NOT_FOUND' });
      return true;
    }
    sendJson(res, 200, {
      ok: true,
      changeset: {
        id: row.id,
        bookId: row.book_id,
        branchId: row.branch_id,
        source: db.prepare('SELECT manuscript_id FROM memory_changeset_sources WHERE changeset_id = ?').get(row.id) || null,
        baseStateVersion: row.base_state_version,
        candidateHash: row.candidate_hash,
        approvalStatus: row.approval_status,
        operations: JSON.parse(row.operations_json || '[]'),
        dependencies: JSON.parse(row.dependencies_json || '[]'),
        auditReport: JSON.parse(row.audit_report_json || '{}'),
        committedAt: row.committed_at,
        createdAt: row.created_at
      }
    });
    return true;
  }

  // 4. POST /api/books/:bookId/memory/changesets/:id/approve
  if (req.method === 'POST' && (m = urlPath.match(/^\/api\/books\/([A-Za-z0-9_-]+)\/memory\/changesets\/([A-Za-z0-9_-]+)\/approve$/))) {
    const [_, bookId, changesetId] = m;
    const user = verifyAccess(req, res, getAuthUser, db, bookId, false);
    if (!user) return true;
    const access = projectScope.getNovelAccess(db, bookId, user.userId);
    if (!access || access.role === 'viewer') {
      sendJson(res, 403, { ok: false, code: 'FORBIDDEN', error: '只读观察者无权审批变更集' });
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid body');
    } catch (_) {
      sendJson(res, 400, { ok: false, code: 'INVALID_REQUEST_BODY' });
      return true;
    }
    const result = memorySystem.approveChangeset(db, bookId, changesetId, user.userId, body.status === undefined ? 'approved' : body.status);
    const status = result.ok ? 200
      : (result.code === 'CHANGESET_ALREADY_COMMITTED' || result.code === 'SELF_APPROVAL_FORBIDDEN' || result.code === 'CONFIG_VERSION_CONFLICT') ? 409
      : result.code === 'changeset_missing' ? 404 : 400;
    sendJson(res, status, result);
    return true;
  }

  // 5. POST /api/books/:bookId/memory/changesets/:id/commit
  if (req.method === 'POST' && (m = urlPath.match(/^\/api\/books\/([A-Za-z0-9_-]+)\/memory\/changesets\/([A-Za-z0-9_-]+)\/commit$/))) {
    const [_, bookId, changesetId] = m;
    const user = verifyAccess(req, res, getAuthUser, db, bookId, true);
    if (!user) return true;
    const access = projectScope.getNovelAccess(db, bookId, user.userId);
    if (!access || access.role === 'reviewer' || access.role === 'viewer') {
      sendJson(res, 403, { ok: false, code: 'FORBIDDEN', error: '审核员与观察者无权执行正式提交' });
      return true;
    }

    const ifMatch = req.headers['if-match'];
    if (ifMatch !== undefined) {
      const rawMatch = String(ifMatch).trim();
      if (rawMatch === '*' || rawMatch.startsWith('W/') || !/^"?([A-Za-z0-9_.-]+)"?$/.test(rawMatch)) {
        sendJson(res, 400, { ok: false, code: 'INVALID_IF_MATCH', error: 'If-Match 格式无效，禁止使用 * 或弱标签' });
        return true;
      }
    }

    let body;
    try {
      body = await readJsonBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid body');
    } catch (_) {
      sendJson(res, 400, { ok: false, code: 'INVALID_REQUEST_BODY' });
      return true;
    }
    const result = memorySystem.commitChangeset(db, bookId, changesetId, user.userId, {
      ...body,
      actorRole: access.role,
      idempotencyKey: req.headers['idempotency-key'] || body.idempotencyKey
    });
    const invalid = ['INVALID_MEMORY_OPERATION', 'MEMORY_REFERENCE_INVALID', 'CHANGESET_DEPENDENCY_MISSING'];
    const status = result.ok ? 200
      : result.code === 'changeset_missing' ? 404
      : result.code === 'FORBIDDEN' ? 403
      : result.code === 'PRECONDITION_FAILED' ? 412
      : invalid.includes(result.code) ? 422
      : 409;
    sendJson(res, status, result);
    return true;
  }

  // 6. POST /api/books/:bookId/memory/operations/:id/revert
  if (req.method === 'POST' && (m = urlPath.match(/^\/api\/books\/([A-Za-z0-9_-]+)\/memory\/operations\/([A-Za-z0-9_-]+)\/revert$/))) {
    const [_, bookId, opId] = m;
    const user = verifyAccess(req, res, getAuthUser, db, bookId, true);
    if (!user) return true;
    const body = await readJsonBody(req).catch(() => ({}));
    const result = memorySystem.revertOperation(db, bookId, opId, user.userId || user.email, body.reason);
    sendJson(res, result.ok ? 200 : 400, result);
    return true;
  }

  // 7. GET /api/books/:bookId/cognition
  if (req.method === 'GET' && (m = urlPath.match(/^\/api\/books\/([A-Za-z0-9_-]+)\/cognition$/))) {
    const bookId = m[1];
    const user = verifyAccess(req, res, getAuthUser, db, bookId);
    if (!user) return true;
    const cognitions = memorySystem.getCognition(db, bookId, query);
    sendJson(res, 200, { ok: true, bookId, cognitions });
    return true;
  }

  // 8. GET /api/books/:bookId/timeline
  if (req.method === 'GET' && (m = urlPath.match(/^\/api\/books\/([A-Za-z0-9_-]+)\/timeline$/))) {
    const bookId = m[1];
    const user = verifyAccess(req, res, getAuthUser, db, bookId);
    if (!user) return true;
    const timeline = memorySystem.getTimeline(db, bookId, query.timelineId || 't0', query.branchId || 'main', query.cycleId || 'c0');
    sendJson(res, 200, { ok: true, bookId, timeline });
    return true;
  }

  // 9. POST /api/books/:bookId/context/assemble
  if (req.method === 'POST' && (m = urlPath.match(/^\/api\/books\/([A-Za-z0-9_-]+)\/context\/assemble$/))) {
    const bookId = m[1];
    const user = verifyAccess(req, res, getAuthUser, db, bookId, true);
    if (!user) return true;
    const body = await requestBody(req);
    const styleProfiles = services.styleProfileStore
      ? await getStoredStyleProfiles(services.styleProfileStore, db, user, bookId, { branchId: body.branchId || 'main' })
      : undefined;
    const manifest = memorySystem.assembleContext(db, bookId, body, styleProfiles);
    sendJson(res, 200, { ok: true, bookId, manifest });
    return true;
  }

  // 10. GET /api/books/:bookId/context/:manifestId
  if (req.method === 'GET' && (m = urlPath.match(/^\/api\/books\/([A-Za-z0-9_-]+)\/context\/([A-Za-z0-9_-]+)$/))) {
    const [_, bookId, manifestId] = m;
    const user = verifyAccess(req, res, getAuthUser, db, bookId);
    if (!user) return true;
    const manifest = memorySystem.getContextManifest(db, bookId, manifestId);
    if (!manifest) {
      sendJson(res, 404, { ok: false, error: '上下文清单不存在', code: 'MANIFEST_NOT_FOUND' });
      return true;
    }
    sendJson(res, 200, { ok: true, bookId, manifest });
    return true;
  }

  // 11. GET /api/books/:bookId/styles
  if (req.method === 'GET' && (m = urlPath.match(/^\/api\/books\/([A-Za-z0-9_-]+)\/styles$/))) {
    const bookId = m[1];
    const user = verifyAccess(req, res, getAuthUser, db, bookId);
    if (!user) return true;
    const styles = styleSystem.getStyleProfiles(db, bookId, query);
    sendJson(res, 200, { ok: true, bookId, styles });
    return true;
  }

  // 12. POST /api/books/:bookId/styles
  if (req.method === 'POST' && (m = urlPath.match(/^\/api\/books\/([A-Za-z0-9_-]+)\/styles$/))) {
    const bookId = m[1];
    const user = verifyAccess(req, res, getAuthUser, db, bookId, true);
    if (!user) return true;
    const body = await requestBody(req);
    if (body.id && body.expectedRevision === undefined) workflow.fail('VERSION_REQUIRED', 428);
    const result = styleSystem.upsertStyleProfile(db, { ...body, bookId, approvedBy: user.userId || user.email });
    sendJson(res, 200, result);
    return true;
  }

  // 13. POST /api/books/:bookId/style-audits
  if (req.method === 'POST' && (m = urlPath.match(/^\/api\/books\/([A-Za-z0-9_-]+)\/style-audits$/))) {
    const bookId = m[1];
    const user = verifyAccess(req, res, getAuthUser, db, bookId);
    if (!user) return true;
    const body = await requestBody(req);
    const manuscript = body.manuscriptRevisionId ? workflow.getManuscript(db, bookId, body.manuscriptRevisionId) : null;
    const branchId = manuscript ? manuscript.branch_id : body.branchId || 'main';
    const profiles = services.styleProfileStore
      ? await getStoredStyleProfiles(services.styleProfileStore, db, user, bookId, { branchId })
      : styleSystem.getStyleProfiles(db, bookId, { branchId });
    const bundle = styleSystem.compileStyleBundle(profiles, body.sceneContext || {});
    const audit = styleSystem.auditTextStyle(manuscript ? manuscript.content : body.text, {
      deterministicRules: bundle.checkRules, semanticContext: { voiceConstraints: bundle.voiceConstraints }
    });
    audit.coverage = { deterministic: 'checked', semantic: 'heuristic_only' };
    audit.requiresSemanticReview = true;
    audit.contentHash = memorySystem.computeTextHash(manuscript ? manuscript.content : body.text);
    audit.styleVersions = bundle.profileVersions;
    sendJson(res, 200, { ok: true, bookId, audit });
    return true;
  }

  // 14. POST /api/books/:bookId/rewrite
  if (req.method === 'POST' && (m = urlPath.match(/^\/api\/books\/([A-Za-z0-9_-]+)\/rewrite$/))) {
    const bookId = m[1];
    const user = verifyAccess(req, res, getAuthUser, db, bookId, true);
    if (!user) return true;
    const body = await requestBody(req);
    let contract = null;
    let contractId = String(body.contractId || '').trim();
    if (body.contract && typeof body.contract === 'object' && !Array.isArray(body.contract)) {
      const suppliedId = String(body.contract.id || contractId || '').trim();
      contract = suppliedId ? memorySystem.getRewriteContract(db, bookId, suppliedId) : null;
      if (!contract) contract = memorySystem.createRewriteContract(db, {
          ...body.contract,
          bookId,
          branchId: String(body.contract.branchId || body.branchId || 'main'),
          candidateHash: body.contract.candidateHash || ''
        });
      contractId = contract.id;
    } else if (contractId) {
      contract = memorySystem.getRewriteContract(db, bookId, contractId);
    }
    if (!contract) workflow.fail('REWRITE_CONTRACT_REQUIRED', 422);
    let manuscript = null;
    if (body.manuscriptRevisionId) {
      manuscript = workflow.getManuscript(db, bookId, body.manuscriptRevisionId);
      if (contract.branchId && contract.branchId !== manuscript.branch_id) workflow.fail('REWRITE_CONTRACT_BRANCH_CONFLICT');
      if (body.candidateText !== undefined && memorySystem.computeTextHash(String(body.candidateText)) !== manuscript.content_hash) {
        workflow.fail('REWRITE_REVIEW_VERSION_CONFLICT');
      }
    }
    const candidateText = manuscript ? manuscript.content : String(body.candidateText || body.text || '');
    if (!candidateText.trim()) workflow.fail('REWRITE_CANDIDATE_REQUIRED', 422);
    const compliance = memorySystem.verifyRewriteContractCompliance(contract, candidateText);
    const candidateHash = memorySystem.computeTextHash(candidateText);
    const review = manuscript ? memorySystem.createRewriteReview(db, {
      bookId, branchId: manuscript.branch_id, manuscriptRevisionId: manuscript.id,
      contractId, candidateHash, actorId: user.userId,
      report: { passed: compliance.passed, violations: compliance.violations, coverage: { deterministic: 'checked', semantic: 'not_checked' } }
    }) : null;
    sendJson(res, 200, {
      ok: true,
      bookId,
      compliant: compliance.passed,
      violations: compliance.violations,
      candidateText,
      candidateHash,
      contractId,
      review,
      requiresHumanReview: true
    });
    return true;
  }

  // 15. POST /api/books/:bookId/impact-analysis
  if (req.method === 'POST' && (m = urlPath.match(/^\/api\/books\/([A-Za-z0-9_-]+)\/impact-analysis$/))) {
    const bookId = m[1];
    const user = verifyAccess(req, res, getAuthUser, db, bookId);
    if (!user) return true;
    const body = await readJsonBody(req).catch(() => ({}));
    const impact = memorySystem.analyzeImpact(db, bookId, body);
    sendJson(res, 200, { ok: true, bookId, impact });
    return true;
  }

  // 16. GET /api/books/:bookId/projections
  if (req.method === 'GET' && (m = urlPath.match(/^\/api\/books\/([A-Za-z0-9_-]+)\/projections$/))) {
    const bookId = m[1];
    const user = verifyAccess(req, res, getAuthUser, db, bookId);
    if (!user) return true;
    const projections = memorySystem.verifyProjections(db, bookId, query.branchId);
    sendJson(res, 200, { ok: true, bookId, projections });
    return true;
  }

  // 17. POST /api/books/:bookId/projections/verify
  if (req.method === 'POST' && (m = urlPath.match(/^\/api\/books\/([A-Za-z0-9_-]+)\/projections\/verify$/))) {
    const bookId = m[1];
    const user = verifyAccess(req, res, getAuthUser, db, bookId);
    if (!user) return true;
    const verification = memorySystem.verifyProjections(db, bookId);
    sendJson(res, 200, { ok: true, bookId, verification });
    return true;
  }

  // 18. GET /api/runs/:runId  及  GET /api/runs/:runId/events
  if (req.method === 'GET' && (m = urlPath.match(/^\/api\/runs\/([A-Za-z0-9_-]+)(\/events)?$/))) {
    const [_, runId, isEvents] = m;
    const auth = getAuthUser(req);
    if (!auth || !auth.user) {
      sendJson(res, 401, { ok: false, error: '未登录', code: 'UNAUTHORIZED' });
      return true;
    }
    // 检查核心任务记录或 outbox 记录
    let coreJob = null;
    try {
      coreJob = db.prepare('SELECT * FROM creation_core_jobs WHERE id = ?').get(runId);
    } catch (_) {}
    const outboxJob = db.prepare('SELECT * FROM memory_outbox WHERE id = ? OR event_id = ?').get(runId, runId);
    const memoryJob = db.prepare('SELECT book_id, branch_id, approval_status AS status, created_at AS updated_at FROM memory_changesets WHERE id = ?').get(runId) ||
      db.prepare("SELECT book_id, branch_id, 'candidate_saved' AS status, created_at AS updated_at FROM memory_manuscripts WHERE id = ?").get(runId);
    const generationJob = db.prepare('SELECT * FROM memory_generation_runs WHERE id = ?').get(runId);
    const job = coreJob || outboxJob || memoryJob || generationJob;
    const projectId = coreJob ? coreJob.project_id : job && job.book_id;
    const allowed = job && (projectId
      ? projectScope.getNovelAccess(db, projectId, auth.user.userId)
      : coreJob && coreJob.user_id && coreJob.user_id === auth.user.userId);
    if (!allowed) {
      sendJson(res, 404, { ok: false, code: 'RUN_NOT_FOUND' });
      return true;
    }
    const status = job.status;
    const updatedAt = job.updated_at;

    if (isEvents) {
      const cursor = Number(query.after || 0);
      if (!Number.isSafeInteger(cursor) || cursor < 0) workflow.fail('INVALID_EVENT_CURSOR', 422);
      const events = db.prepare(`SELECT sequence AS seq, type, data_json, created_at AS timestamp
        FROM memory_run_events WHERE book_id = ? AND run_id = ? AND sequence > ? ORDER BY sequence LIMIT 200`)
        .all(job.book_id, runId, cursor).map(event => ({ seq: event.seq, type: event.type, data: JSON.parse(event.data_json), timestamp: event.timestamp }));
      sendJson(res, 200, {
        ok: true,
        runId,
        events,
        eventHistoryAvailable: !coreJob,
        nextCursor: events.length ? events[events.length - 1].seq : cursor,
        snapshot: { status, updatedAt }
      });
    } else {
      sendJson(res, 200, {
        ok: true,
        runId,
        status,
        updatedAt,
        result: generationJob ? JSON.parse(generationJob.result_json) : undefined,
        details: coreJob
          ? { bookId: coreJob.book_id, receivedChars: coreJob.received_chars, code: coreJob.code }
          : { bookId: job.book_id, branchId: job.branch_id,
            stateVersion: job.state_version, projectionType: job.projection_type,
            attemptCount: job.attempt_count }
      });
    }
    return true;
  }

  return false;
}

module.exports = {
  dispatch,
  readJsonBody,
  sendJson
};
