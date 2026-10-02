'use strict';

/** PostgreSQL creation HTTP contracts over injected domain services. */
function createPostgresCreationHttpService({
  getAuthUser,
  json,
  postgresRepository,
  postgresActor,
  readBody,
  normalizeBiblePayload,
  creationBibleSeedValidation,
  creationForbiddenTerms,
  normalizeCreationPlan,
  creationChapterContext,
  deterministicContractValidation,
  buildDebtPromptInjection,
  handleCreationBooksList,
  handleCreationBookBibleGet,
  handleCreationBookBiblePut,
  handleCreationBookState,
  handleCreationBookChapterAudit,
  handleCreationBookChapterContract,
  handleCreationBookCommit
}) {
  /** PG 模式下列出创作书，创作书与项目成员权限保持同一作用域。 */
  async function handlePostgresCreationBooksList(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const books = await postgresRepository.listCreationBooks(postgresActor(auth));
    return json(res, 200, { ok: true, books });
  }

  /** PG 模式下创建创作书和首版圣经，支持关联已有项目或创建独立创作项目。 */
  async function handlePostgresCreationBooksCreate(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const body = await readBody(req);
    const bookId = String(body.creationBookId || body.bookId || ('cb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7))).trim();
    if (!/^cb_[A-Za-z0-9_]{1,80}$/.test(bookId)) return json(res, 422, { error: '创作书请求 id 非法' });
    const title = String(body.title || '未命名小说').trim().slice(0, 120) || '未命名小说';
    const novelId = String(body.novelId || '').trim();
    const actorId = postgresActor(auth);
    const linkedProfile = novelId ? await postgresRepository.getProfile(actorId, novelId) : null;
    if (novelId && !linkedProfile) return json(res, 404, { error: '关联小说不存在或无权写入' });
    let payload = body.bible && typeof body.bible === 'object' && !Array.isArray(body.bible)
      ? body.bible
      : body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
        ? body.payload
        : normalizeBiblePayload(body);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return json(res, 422, { error: '创作圣经负载非法', code: 'invalid_bible_payload' });
    const seedGate = creationBibleSeedValidation(payload, creationForbiddenTerms(payload));
    if (!seedGate.ok) {
      return json(res, 422, {
        error: seedGate.hits.length ? '生成内容命中了禁止复制项' : '创作圣经结构不完整',
        code: seedGate.hits.length ? 'forbidden_entity_hit' : 'incomplete_generation',
        hits: seedGate.hits, missing: seedGate.missing
      });
    }
    const plan = body.plan && typeof body.plan === 'object' && !Array.isArray(body.plan)
      ? normalizeCreationPlan({ ...body.plan, title, genre: body.genre || body.plan.genre })
      : normalizeCreationPlan({ title, genre: body.genre });
    const result = await postgresRepository.createCreationBook({
      userId: actorId,
      workspaceId: String(body.workspaceId || linkedProfile && linkedProfile.access.workspace_id || '').trim(),
      projectId: novelId || String(body.projectId || '').trim(),
      bookId,
      bibleId: String(body.bibleId || '').trim(),
      title,
      plan,
      sourceBriefId: String(body.sourceDissectionId || body.sourceBriefId || '').slice(0, 160),
      budgetLimit: Number(body.budgetLimit || plan.budgetLimit) || 0,
      initialCost: Number(body.initialCost) || 0,
      payload
    });
    json(res, 200, {
      ok: true,
      reused: result.reused,
      book: { ...result.book, bibleVersion: result.bible && result.bible.version || 0, stateVersion: result.book.currentStateVersion },
      bible: result.bible && result.bible.payload || {}
    });
  }

  /** PG 模式下读取创作圣经当前版本。 */
  async function handlePostgresCreationBookBibleGet(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const result = await postgresRepository.getCreationBible(postgresActor(auth), id);
    if (!result) return json(res, 404, { error: '创作书不存在或无权访问' });
    if (!result.bible) return json(res, 404, { error: '创作圣经不存在或无权访问' });
    json(res, 200, { ok: true, book: { ...result.book, bibleVersion: result.bible.version, stateVersion: result.book.currentStateVersion }, bible: result.bible });
  }

  /** PG 模式下以 Bible revision 保存手工修订。 */
  async function handlePostgresCreationBookBiblePut(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (!await postgresRepository.getCreationBible(postgresActor(auth), id)) return json(res, 404, { error: '创作书不存在或无权访问' });
    const body = await readBody(req);
    const payload = body.bible && typeof body.bible === 'object' && !Array.isArray(body.bible) ? body.bible : {};
    const expectedRevision = body.bibleVersion == null ? Number(body.revision) : Number(body.bibleVersion);
    const saved = await postgresRepository.putCreationBible({
      userId: postgresActor(auth),
      bookId: id,
      payload,
      expectedRevision
    });
    json(res, 200, saved);
  }

  /** PG 模式下读取创作书的 Bible 和正文状态快照。 */
  async function handlePostgresCreationBookState(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const params = new URL(req.url, 'http://molan.local').searchParams;
    const result = await postgresRepository.getCreationState(postgresActor(auth), id, Number(params.get('chapterNo')) || 0);
    if (!result) return json(res, 404, { error: '创作书不存在或无权访问' });
    json(res, 200, { ok: true, ...result });
  }

  /** PG 旧审计入口缺少 Generation V2 证据时只登记待复核状态。 */
  async function handlePostgresCreationBookAudit(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (!await postgresRepository.getCreationBible(postgresActor(auth), id)) return json(res, 404, { error: '创作书不存在或无权访问' });
    const body = await readBody(req);
    const audit = await postgresRepository.createChapterAudit({
      userId: postgresActor(auth),
      bookId: id,
      chapterNo: Number(body.chapterNo) || 1,
      content: String(body.content || ''),
      contentHash: String(body.contentHash || ''),
      auditId: String(body.auditId || '')
    });
    json(res, 200, audit);
  }

  /** PG 模式下生成可执行的本章合同，不调用模型且只从当前 Bible 读取事实。 */
  async function handlePostgresCreationBookChapterContract(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const body = await readBody(req);
    const result = await postgresRepository.getCreationBible(postgresActor(auth), id);
    if (!result || !result.bible) return json(res, 404, { error: '创作圣经不存在或无权访问' });
    const chapterNo = Math.max(1, Number(body.chapterNo) || Number(result.book.currentChapterNo || 0) + 1);
    const context = creationChapterContext(result.bible.payload, chapterNo);
    const prompt = String(body.prompt || '').trim();
    const contract = {
      chapterNo,
      goal: String(context.goal || prompt || `围绕${context.title}推进一个不可逆选择`).slice(0, 1000),
      protagonistAction: String(prompt || `主角必须在第${chapterNo}章主动验证当前目标并承担行动后果`).slice(0, 1000),
      opposition: String((context.mainline && (context.mainline.opposition || context.mainline.goal)) || '既有规则与现实阻力同时收紧').slice(0, 1000),
      informationChange: '本章结束时至少改变一项人物认知或世界事实',
      escalation: '行动成本高于上一章，且留下下一章可验证的后果',
      irreversibleResult: '本章形成不能无代价撤回的结果',
      characterStateChanges: [],
      foreshadowActions: [],
      continuityInputs: context.openForeshadows || [],
      continuityOutputs: [],
      mustAvoid: []
    };
    json(res, 200, { ok: true, contract: { ...contract, source: 'creation-bible', bibleVersion: result.bible.version }, validation: deterministicContractValidation(contract), usage: null });
  }

  /** PG 模式下提交章节正文，先验证真实审计哈希，再原子写入快照、commit 和正文版本。 */
  async function handlePostgresCreationBookCommit(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (!await postgresRepository.getCreationBible(postgresActor(auth), id)) return json(res, 404, { error: '创作书不存在或无权访问' });
    const body = await readBody(req);
    const committed = await postgresRepository.commitChapter({
      ...body,
      userId: postgresActor(auth),
      bookId: id,
      content: String(body.content || ''),
      contentHash: String(body.contentHash || ''),
      auditId: String(body.auditId || ''),
      chapterNo: Number(body.chapterNo) || 1
    });
    json(res, 200, committed);
  }

  /** PG quality reports use persisted book-scoped audit evidence. */
  async function handlePostgresCreationBookQualityReport(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const report = await postgresRepository.getCreationQualityReport(postgresActor(auth), id);
    if (!report) return json(res, 404, { error: '创作书不存在或无权访问' });
    json(res, 200, report);
  }


  /** PG 模式下读取创作书债务，并从关系表生成下一章提示块。 */
  async function handlePostgresCreationBookDebts(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const params = new URL(req.url, 'http://molan.local').searchParams;
    const result = await postgresRepository.getCausalDebts({
      userId: postgresActor(auth),
      bookId: id,
      chapterNo: Math.max(1, Number(params.get('chapterNo')) || 1)
    });
    const chapterNo = Math.max(1, Number(params.get('chapterNo')) || 1);
    json(res, 200, { ok: true, bookId: id, chapterNo, block: buildDebtPromptInjection(result.allDebts, chapterNo).slice(0, 1800), ...result });
  }
  return { handlePostgresCreationBooksList, handlePostgresCreationBooksCreate, handlePostgresCreationBookBibleGet, handlePostgresCreationBookBiblePut, handlePostgresCreationBookState, handlePostgresCreationBookAudit, handlePostgresCreationBookChapterContract, handlePostgresCreationBookCommit, handlePostgresCreationBookQualityReport, handlePostgresCreationBookDebts };
}

module.exports = { createPostgresCreationHttpService };
