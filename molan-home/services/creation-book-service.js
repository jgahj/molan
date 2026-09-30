'use strict';

/** Creation book and Bible lifecycle; the live database is supplied lazily. */
function createCreationBookService({
  creationBibleSeedValidation,
  creationCoreRunningJobForBook,
  creationForbiddenTerms,
  dbReady,
  getAuthUser,
  getUserByEmail,
  json,
  normalizeBiblePayload,
  normalizeCreationChapterPlanRhythm,
  normalizeCreationPlan,
  projectScope,
  queryParamsFromUrl,
  readBody,
  requireSqliteForPublic,
  safeJsonParse,
  sha256Text,
  getDatabase
}) {
  function publicCreationBook(row) {
    let plan = {};
    try { plan = JSON.parse(row.plan_json || '{}'); } catch (_) {}
    return {
      id: row.id, title: row.title, novelId: row.novel_id || '', bibleId: row.bible_id, sourceBriefId: row.source_brief_id,
      currentStateVersion: row.current_state_version, currentChapterNo: row.current_chapter_no, status: row.status,
      budgetLimit: Number(row.budget_limit) || 0, spentCost: Number(row.spent_cost) || 0, plan,
      ownerUserId: row.owner_user_id || '', workspaceId: row.workspace_id || '', projectId: row.project_id || '',
      updatedAt: row.updated_at
    };
  }
  
  function loadCreationBook(id, email) {
    if (!dbReady()) return null;
    return getDatabase().prepare('SELECT * FROM creation_books WHERE id = ? AND user_email = ?').get(String(id || ''), String(email || '').toLowerCase());
  }
  
  function creationScopeForActor(email, userId, novelId = '') {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const account = getUserByEmail(normalizedEmail);
    const ownerUserId = String(userId || (account && account.userId) || projectScope.stableUserId(normalizedEmail)).trim();
    const projectId = String(novelId || '').trim();
    const access = projectId ? projectScope.getNovelAccess(getDatabase(), projectId, ownerUserId) : null;
    return {
      ownerUserId,
      workspaceId: access ? String(access.workspace_id || '') : projectScope.personalWorkspaceId(ownerUserId),
      projectId: access ? String(access.project_id || projectId) : projectId
    };
  }
  
  function loadCreationBookForAuth(id, auth, roles = projectScope.PROJECT_ROLES) {
    if (!dbReady() || !auth || !auth.user) return null;
    const book = getDatabase().prepare('SELECT * FROM creation_books WHERE id = ?').get(String(id || ''));
    if (!book) return null;
    const actorUserId = String(auth.user.userId || projectScope.stableUserId(auth.user.email)).trim();
    const linkedProjectId = String(book.novel_id || book.project_id || '').trim();
    if (linkedProjectId) {
      const access = projectScope.getNovelAccess(getDatabase(), linkedProjectId, actorUserId);
      return projectScope.canAccess(access, roles) ? book : null;
    }
    if (String(book.owner_user_id || '') === actorUserId) return book;
    if (!String(book.owner_user_id || '') && String(book.user_email || '').toLowerCase() === String(auth.user.email || '').toLowerCase()) return book;
    return null;
  }
  
  function canSpendCreationBook(book, auth) {
    if (!book || !auth || !auth.user) return false;
    const actorUserId = String(auth.user.userId || projectScope.stableUserId(auth.user.email)).trim();
    const linkedProjectId = String(book.novel_id || book.project_id || '').trim();
    if (linkedProjectId) {
      const access = projectScope.getNovelAccess(getDatabase(), linkedProjectId, actorUserId);
      return projectScope.canAccess(access, projectScope.WRITE_ROLES, 'spend');
    }
    return String(book.owner_user_id || '') === actorUserId || (
      !String(book.owner_user_id || '') &&
      String(book.user_email || '').toLowerCase() === String(auth.user.email || '').toLowerCase()
    );
  }
  
  function loadCurrentBiblePayload(bookId) {
    if (!dbReady()) return null;
    const bible = getDatabase().prepare('SELECT * FROM creation_bibles WHERE book_id = ?').get(bookId);
    if (!bible) return null;
    const row = getDatabase().prepare('SELECT payload_json, version FROM creation_bible_versions WHERE bible_id = ? ORDER BY version DESC LIMIT 1').get(bible.id);
    if (!row) return null;
    let payload = {}; try { payload = JSON.parse(row.payload_json || '{}'); } catch (_) {}
    return { bibleId: bible.id, version: Number(row.version) || 1, payload };
  }
  
  function loadCreationSnapshots(bookId, upTo) {
    if (!dbReady()) return [];
    const upto = Math.max(0, Number(upTo) || 0);
    try {
      return getDatabase().prepare('SELECT * FROM creation_state_snapshots WHERE book_id = ? AND (chapter_no <= ? OR ? = 0) ORDER BY state_version DESC').all(String(bookId || ''), upto, upto)
        .map(row => ({
          id: row.id, chapterNo: row.chapter_no, bibleVersion: row.bible_version, stateVersion: row.state_version,
          characterStates: safeJsonParse(row.character_states_json), relationshipStates: safeJsonParse(row.relationship_states_json),
          worldStates: safeJsonParse(row.world_states_json), timeline: safeJsonParse(row.timeline_json),
          openForeshadows: safeJsonParse(row.open_foreshadows_json), recentFacts: safeJsonParse(row.recent_facts_json),
          outlineImpact: safeJsonParse(row.outline_impact_json),
          contentHash: row.content_hash, auditStatus: row.audit_status, createdAt: row.created_at
        }));
    } catch (_) { return []; }
  }
  
  function saveCreationBookFirstBible(email, input) {
    if (!dbReady()) return { ok: false, error: '云端存储未启用', code: 'storage_disabled' };
    const now = Date.now();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const bookId = String(input.bookId || '').trim();
    const title = String(input.title || '未命名小说').slice(0, 120);
    const plan = input.plan && typeof input.plan === 'object' ? input.plan : {};
    const sourceDissectionId = String(input.sourceDissectionId || '');
    const payload = input.payload;
    const initialCost = Math.max(0, Number(input.initialCost) || 0);
    const scope = creationScopeForActor(normalizedEmail, input.ownerUserId || input.userId, input.novelId || input.projectId);
    const payloadHash = sha256Text(JSON.stringify(payload));
    try {
      getDatabase().exec('BEGIN');
      const existing = getDatabase().prepare(`SELECT id, bible_id
        FROM creation_books
        WHERE id = ? AND (owner_user_id = ? OR (owner_user_id = '' AND user_email = ?))`)
        .get(bookId, scope.ownerUserId, normalizedEmail);
      let bibleId;
      if (existing) {
        if (existing.bible_id && loadCurrentBiblePayload(bookId)) { getDatabase().exec('ROLLBACK'); return { ok: false, error: '创作书已存在且创作圣经已完成', code: 'already_completed' }; }
        bibleId = existing.bible_id || ('bible_' + now.toString(36) + Math.random().toString(36).slice(2, 7));
        getDatabase().prepare(`UPDATE creation_books
          SET title = ?, bible_id = ?, source_brief_id = ?, plan_json = ?, budget_limit = ?, spent_cost = ?,
              owner_user_id = ?, workspace_id = ?, project_id = ?, novel_id = ?, updated_at = ?
          WHERE id = ?`).run(
          title, bibleId, sourceDissectionId, JSON.stringify(plan), Number(plan.budgetLimit) || 0, initialCost,
          scope.ownerUserId, scope.workspaceId, scope.projectId, scope.projectId, now, bookId);
        if (!existing.bible_id) {
          getDatabase().prepare('INSERT INTO creation_bibles (id,book_id,current_version,status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
            .run(bibleId, bookId, 1, 'draft', now, now);
        }
      } else {
        bibleId = 'bible_' + now.toString(36) + Math.random().toString(36).slice(2, 7);
        getDatabase().prepare(`INSERT INTO creation_books
          (id,user_email,title,bible_id,source_brief_id,current_state_version,current_chapter_no,status,visibility,
           created_by,created_at,updated_at,novel_id,plan_json,budget_limit,spent_cost,owner_user_id,workspace_id,project_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          bookId, normalizedEmail, title, bibleId, sourceDissectionId, 0, 0, 'draft', 'private', normalizedEmail,
          now, now, scope.projectId, JSON.stringify(plan), Number(plan.budgetLimit) || 0, initialCost,
          scope.ownerUserId, scope.workspaceId, scope.projectId);
        getDatabase().prepare('INSERT INTO creation_bibles (id,book_id,current_version,status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
          .run(bibleId, bookId, 1, 'draft', now, now);
      }
      getDatabase().prepare('INSERT INTO creation_bible_versions (id,bible_id,version,payload_json,payload_hash,source_brief_id,parent_version,change_summary,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run('bv_' + bibleId + '_1', bibleId, 1, JSON.stringify(payload), payloadHash, sourceDissectionId, 0, '核心创作包首版', normalizedEmail, now);
      getDatabase().exec('COMMIT');
      return { ok: true, bookId, bibleId, version: 1 };
    } catch (e) {
      try { getDatabase().exec('ROLLBACK'); } catch (_) {}
      if (String(e && e.message || '').includes('UNIQUE')) {
        return { ok: false, error: '创作书请求 id 已被其他用户占用', code: 'creation_book_conflict' };
      }
      console.error('[creation] 首版圣经保存失败 book=' + bookId + ':', e);
      return { ok: false, error: '创建新书失败，请稍后重试', code: 'internal_error' };
    }
  }
  
  function insertCreationBookPlaceholder(email, input) {
    if (!dbReady()) return { ok: false, error: '云端存储未启用' };
    const now = Date.now();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const scope = creationScopeForActor(normalizedEmail, input.ownerUserId || input.userId, input.novelId || input.projectId);
    try {
      getDatabase().prepare(`INSERT INTO creation_books
        (id,user_email,title,bible_id,source_brief_id,status,created_by,created_at,updated_at,plan_json,budget_limit,
         owner_user_id,workspace_id,project_id,novel_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        String(input.bookId), normalizedEmail, String(input.title || '未命名小说').slice(0, 120), '',
        String(input.sourceDissectionId || ''), 'generating', normalizedEmail, now, now, JSON.stringify(input.plan || {}),
        Number(input.plan && input.plan.budgetLimit) || 0, scope.ownerUserId, scope.workspaceId, scope.projectId, scope.projectId);
      return { ok: true };
    } catch (e) {
      if (String(e && e.message || '').includes('UNIQUE')) {
        const existing = getDatabase().prepare('SELECT owner_user_id, user_email FROM creation_books WHERE id = ?').get(String(input.bookId));
        if (existing && (String(existing.owner_user_id || '') === scope.ownerUserId || (!existing.owner_user_id && String(existing.user_email || '').toLowerCase() === normalizedEmail))) return { ok: true };
        return { ok: false, error: '创作书请求 id 已被其他用户占用', code: 'creation_book_conflict' };
      }
      console.error('[creation] 占位书行创建失败 book=' + input.bookId + ':', e);
      return { ok: false, error: '创书任务创建失败' };
    }
  }
  
  function deleteCreationBookPlaceholder(bookId, email) {
    if (!dbReady() || !bookId) return;
    try {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      const scope = creationScopeForActor(normalizedEmail);
      const book = getDatabase().prepare(`SELECT * FROM creation_books
        WHERE id = ? AND (owner_user_id = ? OR (owner_user_id = '' AND user_email = ?))`)
        .get(String(bookId), scope.ownerUserId, normalizedEmail);
      if (!book || loadCurrentBiblePayload(bookId)) return;
      getDatabase().prepare(`DELETE FROM creation_books
        WHERE id = ? AND (owner_user_id = ? OR (owner_user_id = '' AND user_email = ?))`)
        .run(String(bookId), scope.ownerUserId, normalizedEmail);
    } catch (_) {}
  }
  
  async function handleCreationBooksCreate(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (!requireSqliteForPublic(req, res)) return;
    if (!dbReady()) return json(res, 503, { error: '云端存储未启用' });
    let body = {}; try { body = await readBody(req).catch(() => ({})); } catch (_) {}
    const title = String(body.title || '未命名小说').slice(0, 120);
    const plan = normalizeCreationPlan({ ...(body.plan || {}), title, genre: body.genre || body.plan && body.plan.genre });
    const initialCost = Math.max(0, Number(body.initialCost) || 0);
    if (plan.budgetLimit > 0 && initialCost > plan.budgetLimit + 1e-9) return json(res, 402, { error: '创作包已超过预算上限，请提高预算或更换模型', code: 'budget_exceeded', budgetLimit: plan.budgetLimit, actualCost: initialCost });
    const now = Date.now();
    const requestedBookId = String(body.creationBookId || '').trim();
    if (requestedBookId && !/^cb_[A-Za-z0-9_]{1,80}$/.test(requestedBookId)) return json(res, 400, { error: '创作书请求 id 非法' });
    const bookId = requestedBookId || ('cb_' + now.toString(36) + Math.random().toString(36).slice(2, 7));
    const bibleId = 'bible_' + now.toString(36) + Math.random().toString(36).slice(2, 7);
    const novelId = String(body.novelId || '').trim();
    if (novelId) {
      const access = projectScope.getNovelAccess(getDatabase(), novelId, auth.user.userId);
      if (!projectScope.canAccess(access, projectScope.WRITE_ROLES)) return json(res, 404, { error: '关联小说不存在或无权写入' });
    }
    if (requestedBookId) {
      const existingBook = loadCreationBookForAuth(bookId, auth, projectScope.WRITE_ROLES);
      if (existingBook) {
        const existingBible = loadCurrentBiblePayload(bookId);
        if (!existingBible) return json(res, 409, { error: '创作书已存在但创作圣经尚未完成，请稍后重试', code: 'creation_checkpoint_pending' });
        const publicBook = publicCreationBook(existingBook);
        return json(res, 200, {
          ok: true,
          reused: true,
          book: { ...publicBook, bibleVersion: existingBible.version, stateVersion: existingBook.current_state_version, plan: publicBook.plan, spentCost: publicBook.spentCost },
          bible: existingBible.payload
        });
      }
    }
    const payload = normalizeBiblePayload(body);
    // ★ 创建门禁（R2）：落库前确定性校验——阻止原书专属名词进入 bible、结构必须完整
    const seedGate = creationBibleSeedValidation(payload, creationForbiddenTerms(payload));
    if (!seedGate.ok) {
      return json(res, 422, {
        error: seedGate.hits.length ? '生成内容命中了原书禁止复制项，请重新生成或修改后重试' : seedGate.nameOverlaps && seedGate.nameOverlaps.length ? '人物姓名共享汉字，请重命名其中之一后重试' : '生成内容结构不完整，请重新生成后重试',
        code: seedGate.hits.length ? 'forbidden_entity_hit' : seedGate.nameOverlaps && seedGate.nameOverlaps.length ? 'character_name_overlap' : 'incomplete_generation',
        hits: seedGate.hits, missing: seedGate.missing
      });
    }
    const payloadHash = sha256Text(JSON.stringify(payload));
    const saved = saveCreationBookFirstBible(auth.user.email, {
      bookId, title, plan, sourceDissectionId: String(body.sourceDissectionId || ''), payload, initialCost,
      novelId, ownerUserId: auth.user.userId
    });
    if (!saved.ok) {
      const status = saved.code === 'internal_error' ? 500 : 409;
      return json(res, status, { error: saved.error, code: saved.code });
    }
    const bible = loadCurrentBiblePayload(saved.bookId) || { version: 1, payload };
    json(res, 200, { ok: true, book: { id: saved.bookId, bibleId: saved.bibleId, title, novelId: String(body.novelId || ''), bibleVersion: bible.version, stateVersion: 0, plan, spentCost: initialCost }, bible: bible.payload });
  }
  
  function handleCreationBooksList(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (!requireSqliteForPublic(req, res) || !dbReady()) return;
    const actorUserId = String(auth.user.userId || projectScope.stableUserId(auth.user.email)).trim();
    const normalizedEmail = String(auth.user.email || '').trim().toLowerCase();
    const rows = getDatabase().prepare(`SELECT DISTINCT cb.*
      FROM creation_books cb
      LEFT JOIN project_members pm
        ON pm.project_id = cb.novel_id AND pm.user_id = ? AND pm.active = 1
      LEFT JOIN novel_projects np
        ON np.workspace_id = pm.workspace_id AND np.project_id = pm.project_id AND np.status = 'active'
      WHERE (cb.owner_user_id = ? OR (cb.owner_user_id = '' AND cb.user_email = ?)
        OR (pm.user_id = ? AND np.project_id IS NOT NULL))
      ORDER BY cb.updated_at DESC`).all(actorUserId, actorUserId, normalizedEmail, actorUserId);
    json(res, 200, { ok: true, books: rows.map(publicCreationBook) });
  }
  
  function handleCreationBookBibleGet(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const book = loadCreationBookForAuth(id, auth, projectScope.PROJECT_ROLES);
    if (!book) return json(res, 404, { error: '新书不存在或无权访问' });
    const bible = loadCurrentBiblePayload(book.id);
    if (!bible) {
      // 占位书 + 服务端任务仍在生成：用 pending 语义告诉前端「稍后重试即可续上」。
      if (creationCoreRunningJobForBook(book.id, auth.user.email, auth.user.userId)) {
        return json(res, 409, { error: '核心创作包仍在服务端生成，请稍后重试', code: 'creation_checkpoint_pending' });
      }
      return json(res, 404, { error: '创作圣经不存在' });
    }
    json(res, 200, { ok: true, book: publicCreationBook(book), bible });
  }
  
  function handleCreationBookState(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const book = loadCreationBookForAuth(id, auth, projectScope.PROJECT_ROLES);
    if (!book) return json(res, 404, { error: '新书不存在或无权访问' });
    const q = queryParamsFromUrl(req.url);
    const upTo = Math.max(0, Number(q.chapterNo) || 0);
    const bible = loadCurrentBiblePayload(book.id);
    let snapshots = [];
    try {
      snapshots = getDatabase().prepare('SELECT * FROM creation_state_snapshots WHERE book_id = ? AND (chapter_no <= ? OR ? = 0) ORDER BY state_version DESC').all(id, upTo, upTo)
        .map(row => ({ id: row.id, chapterNo: row.chapter_no, bibleVersion: row.bible_version, stateVersion: row.state_version, characterStates: safeJsonParse(row.character_states_json), relationshipStates: safeJsonParse(row.relationship_states_json), worldStates: safeJsonParse(row.world_states_json), timeline: safeJsonParse(row.timeline_json), openForeshadows: safeJsonParse(row.open_foreshadows_json), recentFacts: safeJsonParse(row.recent_facts_json), contentHash: row.content_hash, auditStatus: row.audit_status, createdAt: row.created_at }));
    } catch (_) { snapshots = []; }
    json(res, 200, { ok: true, book: publicCreationBook(book), bible, snapshots: snapshots.slice(0, 200) });
  }
  
  function creationBibleForBook(bookId) {
    const current = loadCurrentBiblePayload(bookId);
    if (!current || !current.payload) return { bibleId: '', version: 0, payload: {} };
    if (!Array.isArray(current.payload.chapterPlan)) return current;
    return {
      ...current,
      payload: {
        ...current.payload,
        chapterPlan: normalizeCreationChapterPlanRhythm(current.payload.chapterPlan)
      }
    };
  }
  
  function saveCreationBibleVersion(book, current, payload, changeSummary, createdBy, additionalCost) {
    if (!dbReady() || !book || !current || !current.bibleId) return { ok: false, error: '创作圣经存储不可用' };
    const nextVersion = Number(current.version || 0) + 1;
    const now = Date.now();
    const ownerUserId = String(book.owner_user_id || projectScope.stableUserId(book.user_email)).trim();
    const cost = Math.max(0, Number(additionalCost) || 0);
    const budgetLimit = Math.max(0, Number(book.budget_limit) || 0);
    const spentCost = Math.max(0, Number(book.spent_cost) || 0);
    if (budgetLimit > 0 && spentCost + cost > budgetLimit + 1e-9) return { ok: false, budgetExceeded: true, budgetLimit, spentCost, additionalCost: cost };
    const payloadHash = sha256Text(JSON.stringify(payload && typeof payload === 'object' ? payload : {}));
    getDatabase().exec('BEGIN');
    try {
      const cas = getDatabase().prepare('UPDATE creation_bibles SET current_version = ?, updated_at = ? WHERE id = ? AND current_version = ?').run(nextVersion, now, current.bibleId, Number(current.version || 0));
      if (Number(cas.changes || 0) !== 1) { getDatabase().exec('ROLLBACK'); return { ok: false, conflict: true }; }
      getDatabase().prepare('INSERT INTO creation_bible_versions (id,bible_id,version,payload_json,payload_hash,source_brief_id,parent_version,change_summary,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run('bv_' + current.bibleId + '_' + nextVersion, current.bibleId, nextVersion, JSON.stringify(payload), payloadHash, book.source_brief_id, Number(current.version || 0), String(changeSummary || '创作圣经修订').slice(0, 200), String(createdBy || book.user_email || '').slice(0, 160), now);
      getDatabase().prepare(`UPDATE creation_books SET spent_cost = spent_cost + ?, updated_at = ?
        WHERE id = ? AND (owner_user_id = ? OR (owner_user_id = '' AND user_email = ?))`)
        .run(cost, now, book.id, ownerUserId, String(book.user_email || '').toLowerCase());
      getDatabase().exec('COMMIT');
    } catch (error) {
      try { getDatabase().exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
    return { ok: true, bibleVersion: nextVersion, payloadHash, additionalCost: cost };
  }

  return { publicCreationBook, loadCreationBook, creationScopeForActor, loadCreationBookForAuth, canSpendCreationBook, loadCurrentBiblePayload, loadCreationSnapshots, saveCreationBookFirstBible, insertCreationBookPlaceholder, deleteCreationBookPlaceholder, handleCreationBooksCreate, handleCreationBooksList, handleCreationBookBibleGet, handleCreationBookState, creationBibleForBook, saveCreationBibleVersion };
}

module.exports = { createCreationBookService };

