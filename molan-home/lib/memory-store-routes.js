'use strict';

const TYPE_MAP = { propositions: 'proposition', evidence: 'evidence', plans: 'plan', foreshadows: 'foreshadow', commitments: 'commitment', disclosures: 'disclosure', events: 'event', transitions: 'transition' };
const { canAccess, WRITE_ROLES } = require('./project-scope');
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
function fail(code, status) { throw Object.assign(new Error(code), { code, statusCode: status }); }
function publicOperation(operation) {
  return {
    ...operation,
    operation_type: operation.operationType,
    record_id: operation.recordId,
    after_state_json: JSON.stringify(operation.after),
    before_state_json: operation.before === null ? null : JSON.stringify(operation.before),
    reverted: operation.reverted ? 1 : 0
  };
}
async function body(req) {
  let text = ''; for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 16 * 1024 * 1024) fail('REQUEST_TOO_LARGE', 413); }
  let data; try { data = text ? JSON.parse(text) : {}; } catch (_) { fail('INVALID_REQUEST_BODY', 400); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('INVALID_REQUEST_BODY', 400);
  return data;
}
async function dispatch(req, res, pathname, getAuthUser, services) {
  const store = services.memoryStore;
  if (!store) return false;
  const runMatch = pathname.match(/^\/api\/runs\/([A-Za-z0-9_-]+)(\/events)?$/);
  if (runMatch) {
    if (req.method !== 'GET') return false;
    try {
      const auth = await getAuthUser(req); if (!auth?.user) fail('UNAUTHORIZED', 401);
      const query = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
      json(res, 200, await store.getRun({ userId: auth.user.userId, runId: runMatch[1], events: Boolean(runMatch[2]), after: query.after }));
      return true;
    } catch (error) {
      if (error.code === 'RUN_NOT_FOUND') return false;
      json(res, error.statusCode || 500, { ok: false, code: error.code || 'MEMORY_INTERNAL_ERROR' }); return true;
    }
  }
  const match = pathname.match(/^\/api\/books\/([A-Za-z0-9_-]+)\/(memory(?:\/.*)?|cognition|timeline|context(?:\/.*)?|rewrite|impact-analysis|projections(?:\/.*)?|workbench|manuscripts(?:\/.*)?|styles(?:\/.*)?|style-audits|generations(?:\/.*)?)$/);
  if (!match) return false;
  try {
    const auth = await getAuthUser(req); if (!auth?.user) fail('UNAUTHORIZED', 401);
    const [, bookId, route] = match;
    const query = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
    const data = req.method === 'POST' ? await body(req) : {};
    const input = { ...query, ...data, userId: auth.user.userId, bookId };
    delete input.projectId;
    delete input.workspaceId;
    if (req.method !== 'GET' && req.method !== 'POST') fail('METHOD_NOT_ALLOWED', 405);
    let result, status = 200, response;
    const cs = route.match(/^memory\/changesets\/([A-Za-z0-9_-]+)(?:\/(approve|commit))?$/);
    const revert = route.match(/^memory\/operations\/([A-Za-z0-9_-]+)\/revert$/);
    const cancel = route.match(/^generations\/([A-Za-z0-9_-]+)\/cancel$/);
    const styleVersions = route.match(/^styles\/([A-Za-z0-9_-]+)\/versions$/);
    if (route === 'styles' || route.startsWith('styles/')) {
      if (!services.styleProfileStore) fail('STYLE_PROFILE_STORE_UNAVAILABLE', 503);
      if (route !== 'styles' && !styleVersions) fail('ROUTE_NOT_FOUND', 404);
      if (styleVersions && req.method !== 'GET') fail('METHOD_NOT_ALLOWED', 405);
      const access = await store.getAccess({ userId: auth.user.userId, bookId });
      if (req.method === 'POST' && !canAccess(access, WRITE_ROLES)) fail('FORBIDDEN', 403);
      const projectId = String(access.projectId || access.project_id || bookId);
      const branchId = String(input.branchId || 'main');
      const styleScope = { projectId, userId: auth.user.userId, bookId, branchId };
      if (styleVersions) {
        const versions = await services.styleProfileStore.getStyleProfileVersions({ ...styleScope, profileId: styleVersions[1] });
        response = { ok: true, bookId, profileId: styleVersions[1], versions };
      } else if (req.method === 'GET') {
        const styles = await services.styleProfileStore.getStyleProfiles({ ...styleScope, level: input.level || undefined });
        response = { ok: true, bookId, styles };
      } else {
        if (input.id && input.expectedRevision === undefined) fail('VERSION_REQUIRED', 428);
        response = await services.styleProfileStore.upsertStyleProfile({
          ...input, ...styleScope, branchId: String(input.branchId || branchId), approvedBy: auth.user.userId
        });
      }
    }
    else if (req.method === 'GET' && route === 'memory') { result = await store.getMemory(input); response = { ok: true, bookId, memory: result }; }
    else if (req.method === 'GET' && route === 'cognition') response = { ok: true, bookId, cognitions: await store.getCognition(input) };
    else if (req.method === 'GET' && route === 'timeline') response = { ok: true, bookId, timeline: await store.getTimeline(input) };
    else if (req.method === 'POST' && route === 'memory/extract') response = { ok: true, bookId, ...await store.extract(input) };
    else if (req.method === 'POST' && route === 'memory/changesets') { response = { ok: true, changeset: await store.createChangeset(input) }; status = 201; }
    else if (cs && req.method === 'GET' && !cs[2]) {
      const changeset = await store.getChangeset({ ...input, changesetId: cs[1] });
      if (changeset.source) changeset.source = { ...changeset.source, manuscript_id: changeset.source.manuscriptId };
      response = { ok: true, changeset };
    }
    else if (cs && req.method === 'POST' && cs[2] === 'approve') response = await store.approveChangeset({ ...input, changesetId: cs[1] });
    else if (cs && req.method === 'POST' && cs[2] === 'commit') {
      const raw = req.headers['if-match']; if (raw !== undefined && (String(raw).trim() === '*' || String(raw).startsWith('W/') || !/^"?([A-Za-z0-9_.-]+)"?$/.test(String(raw).trim()))) fail('INVALID_IF_MATCH', 400);
      response = await store.commitChangeset({ ...input, changesetId: cs[1], ifMatch: raw === undefined ? undefined : String(raw).trim().replace(/^"|"$/g, ''), idempotencyKey: req.headers['idempotency-key'] || data.idempotencyKey });
    }
    else if (revert && req.method === 'POST') response = await store.revertOperation({ ...input, operationId: revert[1] });
    else if (req.method === 'GET' && route === 'memory/operations') response = { ok: true, operations: (await store.listOperations(input)).map(publicOperation) };
    else if (req.method === 'GET' && route === 'memory/records') {
      if (!Object.hasOwn(TYPE_MAP, input.type)) fail('INVALID_MEMORY_TYPE', 422);
      const records = await store.getRecords({ ...input, type: TYPE_MAP[input.type] }); const offset = Math.max(0, Number(input.offset) || 0);
      response = { ok: true, records, offset, nextOffset: records.length === 100 ? offset + 100 : null };
    }
    else if (req.method === 'GET' && route === 'generations') response = { ok: true, run: await store.getGeneration(input) };
    else if (req.method === 'POST' && cancel) response = { ok: true, run: await store.cancelGeneration({ ...input, runId: cancel[1] }) };
    else if (req.method === 'POST' && ['generations', 'context/assemble'].includes(route)) {
      const scope = await store.getAccess({ ...input, bookId });
      const trustedInput = { ...input, ...scope, userId: auth.user.userId, bookId };
      const styleProfiles = services.styleProfileStore ? await services.styleProfileStore.getStyleProfiles({ ...trustedInput, projectId: scope.projectId, bookId }) : [];
      const contextInput = { ...trustedInput, styleProfiles };
      response = route === 'generations' ? { ok: true, run: await store.generate(contextInput, services.generate ? (params, guard) => services.generate(auth.user, params, guard) : null) }
        : { ok: true, bookId, manifest: await store.assembleContext(contextInput) };
    }
    else if (req.method === 'GET' && route.startsWith('context/')) response = { ok: true, bookId, manifest: await store.getContextManifest({ ...input, manifestId: route.slice(8) }) };
    else if (req.method === 'POST' && route === 'rewrite') response = await store.rewrite(input);
    else if (req.method === 'POST' && route === 'style-audits') {
      const scope = await store.getAccess(input);
      const manuscript = input.manuscriptRevisionId ? await store.getManuscript({ ...input, manuscriptId: input.manuscriptRevisionId }) : null;
      if (!services.styleProfileStore) fail('STYLE_PROFILE_STORE_UNAVAILABLE', 503);
      const profiles = await services.styleProfileStore.getStyleProfiles({ ...input, ...scope, userId: auth.user.userId, bookId, projectId: scope.projectId, branchId: manuscript?.branchId || input.branchId || 'main' });
      const style = require('./style-system');
      const bundle = style.compileStyleBundle(profiles, input.sceneContext || {});
      const text = manuscript ? manuscript.content : input.text;
      const audit = style.auditTextStyle(text, { deterministicRules: bundle.checkRules, semanticContext: { voiceConstraints: bundle.voiceConstraints } });
      audit.coverage = { deterministic: 'checked', semantic: 'heuristic_only' };
      audit.requiresSemanticReview = true;
      audit.contentHash = require('./memory-system').computeTextHash(text);
      audit.styleVersions = bundle.profileVersions;
      response = { ok: true, bookId, audit };
    }
    else if (req.method === 'POST' && route === 'impact-analysis') response = { ok: true, bookId, impact: await store.analyzeImpact(input) };
    else if (req.method === 'GET' && route === 'projections') response = { ok: true, bookId, projections: await store.getProjections(input) };
    else if (req.method === 'POST' && route === 'projections/verify') response = { ok: true, bookId, verification: await store.getProjections(input) };
    else if (req.method === 'POST' && route === 'projections/process') response = { ok: true, projections: await store.processProjections(input) };
    else if (req.method === 'GET' && route === 'workbench') {
      const state = await store.workbenchState(input);
      state.manuscripts = state.manuscripts.map(m => ({ ...m, text: m.content }));
      state.changesets = state.changesets.map(cs => ({ ...cs, committed_at: cs.committedAt || null, approval_status: cs.approvalStatus, base_state_version: cs.baseStateVersion, candidate_hash: cs.candidateHash, created_at: cs.createdAt, source: cs.source ? { manuscript_id: cs.source.manuscriptId } : null }));
      response = { ok: true, ...state };
    }
    else if (req.method === 'POST' && route === 'manuscripts') { const manuscript = await store.saveManuscript(input); response = { ok: true, manuscript: { ...manuscript, text: manuscript.content } }; status = 201; }
    else if (req.method === 'GET' && route.startsWith('manuscripts/')) { const manuscript = await store.getManuscript({ ...input, manuscriptId: route.slice(12) }); response = { ok: true, manuscript: { ...manuscript, text: manuscript.content } }; }
    else fail('ROUTE_NOT_FOUND', 404);
    json(res, status, response); return true;
  } catch (error) { json(res, error.statusCode || error.status || 500, { ok: false, code: error.code || 'MEMORY_INTERNAL_ERROR', error: error.statusCode ? error.message : '记忆服务处理失败' }); return true; }
}
module.exports = { dispatch };
