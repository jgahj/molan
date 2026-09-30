'use strict';

const crypto = require('node:crypto');
const { canAccess, WRITE_ROLES } = require('../lib/project-scope');
const resources = require('../lib/project-resources');
function fail(code, status, message = code) { throw Object.assign(new Error(message), { code, status }); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function createNativeCreationService({ repository, getAuthUser, readBody, json,
  normalizeCreationPlan, normalizeBiblePayload, creationBibleSeedValidation, creationForbiddenTerms,
  creationChapterContext, deterministicContractValidation, contractFieldsSubstantive, generateChapterContract }) {
  for (const fn of [normalizeCreationPlan, normalizeBiblePayload, creationBibleSeedValidation, creationForbiddenTerms]) {
    if (typeof fn !== 'function') throw new TypeError('Creation validation dependencies are required');
  }
  async function scope(auth, body, url, bookId) {
    const projectId = String(body.projectId || body.novelId || url.searchParams.get('projectId') || url.searchParams.get('novelId') || '').trim();
    if (body.projectId && body.novelId && body.projectId !== body.novelId) fail('INVALID_SCOPE', 422);
    const workspaceId = String(body.workspaceId || url.searchParams.get('workspaceId') || '').trim();
    if (bookId) {
      const resolved = await repository.resolveScope({ userId: auth.user.userId, bookId });
      const projectClaims = [body.projectId, body.novelId, url.searchParams.get('projectId'), url.searchParams.get('novelId')].filter(Boolean);
      const workspaceClaims = [body.workspaceId, url.searchParams.get('workspaceId')].filter(Boolean);
      if (projectClaims.some(value => String(value).trim() !== resolved.projectId) ||
          workspaceClaims.some(value => String(value).trim() !== resolved.workspaceId)) fail('BOOK_NOT_FOUND', 404);
      return resolved;
    }
    if (!projectId) fail('CREATION_PROJECT_SCOPE_REQUIRED', 422, '必须提供关联项目 projectId 或 novelId');
    return { userId: auth.user.userId, projectId, workspaceId, bookId };
  }
  function validate(payload) {
    if (!object(payload)) fail('invalid_bible_payload', 422, '创作圣经负载非法');
    const gate = creationBibleSeedValidation(payload, creationForbiddenTerms(payload));
    if (!gate.ok) throw Object.assign(new Error('创作圣经校验未通过'), { status: 422,
      code: gate.hits?.length ? 'forbidden_entity_hit' : gate.nameOverlaps?.length ? 'character_name_overlap' : 'incomplete_generation',
      hits: gate.hits, missing: gate.missing });
  }
  async function dispatch(req, res, pathname) {
    const match = pathname.match(/^\/api\/creation-books(?:\/([A-Za-z0-9_]+)(?:\/(bible|state|chapter-contract|debts))?)?$/);
    if (!match || match[1] === 'core-jobs') return false;
    try {
      const auth = await getAuthUser(req);
      if (!auth?.user) fail('UNAUTHORIZED', 401, '请先登录');
      const url = new URL(req.url, 'http://localhost');
      const body = req.method === 'GET' ? {} : await readBody(req);
      if (!object(body)) fail('INVALID_REQUEST_BODY', 400);
      const [, id, section] = match;
      const input = await scope(auth, body, url, id);
      if (req.method !== 'GET') {
        const access = await repository.app.getAccess(input);
        if (!canAccess(access, WRITE_ROLES) || !resources.canMutate(access, 'manuscript')) fail('FORBIDDEN', 404, '关联小说不存在或无权写入');
      }
      let value;
      if (id && section === 'debts' && req.method === 'GET') {
        const raw = url.searchParams.get('chapterNo');
        const chapterNo = raw == null ? undefined : Number(raw);
        if (chapterNo != null && (!Number.isSafeInteger(chapterNo) || chapterNo < 1)) fail('INVALID_CHAPTER_NO', 422);
        value = { ok: true, ...(await repository.debts({ ...input, chapterNo })) };
      } else if (id && section === 'chapter-contract' && req.method === 'POST') {
        if (![creationChapterContext, deterministicContractValidation, contractFieldsSubstantive, generateChapterContract].every(fn => typeof fn === 'function')) {
          throw new TypeError('Native creation contract dependencies are required');
        }
        const snapshot = await repository.contractContext(input);
        const chapterNo = body.chapterNo ?? snapshot.book.currentChapterNo + 1;
        if (!Number.isSafeInteger(chapterNo) || chapterNo < 1) fail('INVALID_CHAPTER_NO', 422);
        const context = creationChapterContext(snapshot.bible.payload, chapterNo);
        const debtContext = await repository.debts({ ...input, chapterNo });
        let output, contract, validation, retried = false;
        const providerAttempts = [];
        for (let attempt = 0; attempt < 2; attempt++) {
          output = await generateChapterContract({ auth, authToken: String(req.headers.authorization || ''), body,
            chapterNo, context, previous: snapshot.previous, debts: debtContext,
            baseline: snapshot.baseline, attempt, previousEnding: String(body.previousEnding || '').slice(-2400),
            prompt: String(body.prompt || '').slice(0, 600) });
          providerAttempts.push({ attempt: attempt + 1, usage: output?.usage || null });
          if (output?.unknown === true || ['failed_or_unknown', 'usage_missing', 'provider_unknown'].includes(output?.status) ||
              ['pending', 'unknown', 'provider_unknown'].includes(output?.usage?.billingStatus)) {
            fail('PROVIDER_UNKNOWN', 502, '供应商结果或费用未知，已停止重试');
          }
          contract = output?.json || output?.contract;
          if (!object(contract)) contract = {};
          contract = { ...contract, chapterNo, source: 'creation-bible', bibleVersion: snapshot.bible.version,
            stateVersion: snapshot.baseline.stateVersion, baseRevision: snapshot.baseline.baseRevision, planHash: snapshot.baseline.planHash };
          validation = deterministicContractValidation(contract);
          if (contractFieldsSubstantive(contract).ok && validation.blockerCount === 0) break;
          retried = true;
        }
        if (!contractFieldsSubstantive(contract).ok || validation.blockerCount > 0) {
          json(res, 422, { ok: false, error: '章节合同自校验未通过，已重试仍不合格', validation });
          return true;
        }
        const saved = await repository.saveContractCAS({ ...input, contract, baseline: snapshot.baseline, validation, providerAttempts });
        value = { ok: true, contract, validation, usage: output?.usage || null, providerAttempts, ...saved, ...(retried ? { retried: true } : {}) };
      } else if (!id && req.method === 'GET') value = { ok: true, books: (await repository.list(input)).sort((a, b) => b.updatedAt - a.updatedAt) };
      else if (!id && req.method === 'POST') {
        const bookId = String(body.creationBookId || body.bookId || `cb_${crypto.randomUUID().replace(/-/g, '')}`).trim();
        if (!/^cb_[A-Za-z0-9_]{1,80}$/.test(bookId)) fail('INVALID_CREATION_BOOK_ID', 400, '创作书请求 id 非法');
        input.bookId = bookId;
        let existing;
        try { existing = await repository.read(input); } catch (error) { if (error.code !== 'BOOK_NOT_FOUND') throw error; }
        if (existing) {
          const bible = await repository.readBible(input);
          value = { ok: true, reused: true, book: { ...existing, bibleVersion: bible.version, stateVersion: existing.currentStateVersion }, bible: bible.payload };
        } else {
          const title = String(body.title || '未命名小说').slice(0, 120);
          const plan = normalizeCreationPlan({ ...(object(body.plan) ? body.plan : {}), title, genre: body.genre || body.plan?.genre });
          const payload = object(body.bible) ? body.bible : object(body.payload) ? body.payload : normalizeBiblePayload(body);
          validate(payload);
          const initialCost = body.initialCost ?? 0;
          if (typeof initialCost !== 'number' || !Number.isFinite(initialCost) || initialCost < 0) fail('INVALID_COST', 422);
          if (plan.budgetLimit > 0 && initialCost > plan.budgetLimit + 1e-9) fail('budget_exceeded', 402);
          await repository.create({ ...input, title, plan, payload, initialCost, sourceDissectionId: body.sourceDissectionId || body.sourceBriefId });
          const book = await repository.read(input);
          const bible = await repository.readBible(input);
          value = { ok: true, book: { ...book, bibleVersion: bible.version, stateVersion: book.currentStateVersion }, bible: bible.payload };
        }
      } else if (id && (!section || ['bible', 'state'].includes(section)) && req.method === 'GET') {
        const book = await repository.read(input);
        const bible = await repository.readBible(input);
        value = { ok: true, book, bible };
        if (section === 'state') {
          const raw = url.searchParams.get('chapterNo');
          const upTo = raw == null ? 0 : Number(raw);
          if (!Number.isSafeInteger(upTo) || upTo < 0) fail('INVALID_CHAPTER_NO', 422);
          value.snapshots = (await repository.snapshots({ ...input, upTo })).slice(0, 200);
        }
      } else if (id && section === 'bible' && req.method === 'PUT') {
        validate(body.bible);
        const expectedVersion = body.bibleVersion ?? body.revision;
        if (expectedVersion == null) fail('VERSION_REQUIRED', 428);
        if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) fail('INVALID_REVISION', 422);
        const saved = await repository.saveBibleCAS({ ...input, expectedVersion, payload: body.bible,
          changeSummary: String(body.changeSummary || '用户修订').slice(0, 200) });
        value = { ok: true, bibleVersion: saved.version,
          payloadHash: crypto.createHash('sha256').update(JSON.stringify(saved.payload)).digest('hex') };
      } else fail('METHOD_NOT_ALLOWED', 405);
      json(res, 200, value);
    } catch (error) {
      const code = error.code === 'REVISION_CONFLICT' ? 'needs_rebase' : error.code;
      const status = error.code === 'FORBIDDEN' ? 404 : error.status || error.statusCode || 500;
      json(res, status, { ok: false, code, error: error.message, ...(error.hits ? { hits: error.hits, missing: error.missing } : {}) });
    }
    return true;
  }
  return { dispatch };
}
module.exports = { createNativeCreationService };
