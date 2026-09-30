'use strict';

function createCreationDebtService({ CausalDebtTracker, DATA_DIR, path, getAuthUser, json, loadCreationBookForAuth, projectScope, queryParamsFromUrl, getDatabase, recoverPendingCommitDebts }) {
  let tracker;
  function getTracker() {
    if (!tracker) tracker = new CausalDebtTracker({ storeDir: path.join(DATA_DIR, 'causal-debts') });
    return tracker;
  }
  function recordChapterCausalDebts(bookId, chapterNo, content, ledgerDelta) {
    const current = getTracker();
    const store = current.loadBookDebts(bookId);
    const existing = new Set((store.debts || []).map(d => String(d.seed || '').trim()).filter(Boolean));
    const candidates = [];
    const delta = ledgerDelta && typeof ledgerDelta === 'object' ? ledgerDelta : {};
    (Array.isArray(delta.newPromises) ? delta.newPromises : []).forEach(p => {
      const seed = String(p && (p.text || p) || '').trim().slice(0, 80);
      if (seed) candidates.push({ type: 'arc', seed, immediateCost: '第' + chapterNo + '章立下的承诺/威胁' });
    });
    (Array.isArray(delta.newRules) ? delta.newRules : []).forEach(r => {
      const kind = String(r && r.kind || ''); const seed = String(r && r.text || '').trim().slice(0, 80);
      if (seed && /代价|副作用/.test(kind)) candidates.push({ type: 'micro', seed, immediateCost: '第' + chapterNo + '章付出的' + kind });
    });
    current.extractPotentialDebts(content, chapterNo).forEach(c => candidates.push(c));
    const added = [];
    for (const candidate of candidates) {
      if (added.length >= 4 || !candidate.seed || existing.has(candidate.seed)) continue;
      existing.add(candidate.seed);
      added.push(current.recordDebt(bookId, { ...candidate, originChapter: chapterNo }));
    }
    const { active, matured } = current.getActiveDebts(bookId, chapterNo + 1);
    return { added: added.map(d => ({ id: d.id, type: d.type, seed: d.seed, maturationChapter: d.maturationChapter })), activeCount: active.length, maturedCount: matured.length };
  }
  function handleCreationBookDebts(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const book = loadCreationBookForAuth(id, auth, projectScope.PROJECT_ROLES);
    if (!book) return json(res, 404, { error: '创作书不存在或无权访问' });
    const q = queryParamsFromUrl(req.url);
    const chapterNo = Math.max(1, Number(q.chapterNo) || (Number(book.current_chapter_no) || 0) + 1);
    const recovery = recoverPendingCommitDebts(getDatabase(), book.id, recordChapterCausalDebts);
    const current = getTracker();
    const { active, matured } = current.getActiveDebts(book.id, chapterNo);
    const block = current.buildDebtPromptInjection(book.id, chapterNo);
    json(res, 200, { ok: true, chapterNo, block: block.slice(0, 1800), active, matured, recovery });
  }
  return { recordChapterCausalDebts, handleCreationBookDebts, getCreationDebtTracker: getTracker };
}
module.exports = { createCreationDebtService };
