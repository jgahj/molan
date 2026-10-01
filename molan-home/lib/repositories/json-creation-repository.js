'use strict';

const crypto = require('node:crypto');
const { canAccess, WRITE_ROLES } = require('../project-scope');
const resources = require('../project-resources');
const { deriveGenerationCommitProjection } = require('../generation/commit-projection');
const { validateGenerationAuditEvidence } = require('../generation/audit-evidence');
const { locateScene, hashSceneText } = require('../generation/scene-patch');
const { projectDebts } = require('../creation-debt-projection');

const clone = value => structuredClone(value);
const hash = value => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
const key = (kind, id) => `creation-${kind}:${id}`;
const INDEX = '__molan_creation_index_v1__';
const OWNER_BOOK_SCOPE = 'owner-book';
const ownerBookScope = (userId, bookId) => `__molan_creation_owner_v1_${hash(JSON.stringify([userId, bookId]))}`;
function fail(code, status = 409) { throw Object.assign(new Error(code), { code, status, statusCode: status }); }
function integer(value) { return Number.isSafeInteger(value) && value >= 0; }
function identifier(value) { if (typeof value !== 'string' || !value.trim() || value.length > 256) fail('INVALID_ID', 422); return value; }
function publicBook(row) {
  const { kind, revision, scopeKind, storageScope, ...book } = row;
  return { ...book, id: row.bookId, revision };
}

/** Creation records share the project's transaction and ACL authority with native novels. */
class JsonCreationRepository {
  constructor(app, options = {}) {
    if (!app?.repository) throw new TypeError('JsonAppRepository is required');
    this.app = app;
    this.repository = app.repository;
    this.now = options.now || Date.now;
    // Hooks receive the same transaction; external side effects cannot be made atomic here.
    this.onCommit = options.onCommit || null;
  }

  access(tx, input, write = false) {
    identifier(input.projectId);
    identifier(input.userId);
    const project = tx.get(input.projectId, 'novels', input.projectId);
    const member = project?.members?.[input.userId];
    if (project?.kind !== 'novel' || project.status !== 'active' || !member?.active ||
        input.workspaceId && input.workspaceId !== project.workspaceId) fail('FORBIDDEN', 403);
    const access = { project_id: project.id, workspace_id: project.workspaceId,
      user_id: input.userId, role: member.role, active: 1 };
    if (write && (!canAccess(access, WRITE_ROLES) || !resources.canMutate(access, 'manuscript'))) fail('FORBIDDEN', 403);
    return project;
  }

  book(tx, input, write = false) {
    identifier(input.bookId);
    if (input.scopeKind === OWNER_BOOK_SCOPE) {
      identifier(input.userId);
      const expectedScope = ownerBookScope(input.userId, input.bookId);
      if (input.storageScope !== expectedScope) fail('BOOK_NOT_FOUND', 404);
      const index = tx.get(INDEX, 'novels', key('book', input.bookId));
      if (index?.kind !== 'creation-book-index' || index.scopeKind !== OWNER_BOOK_SCOPE ||
          index.ownerUserId !== input.userId || index.storageScope !== expectedScope) fail('BOOK_NOT_FOUND', 404);
      const row = tx.get(expectedScope, 'novels', key('book', input.bookId));
      if (row?.kind !== 'creation-book' || row.scopeKind !== OWNER_BOOK_SCOPE || row.ownerUserId !== input.userId ||
          row.storageScope !== expectedScope) fail('BOOK_NOT_FOUND', 404);
      return { project: null, row };
    }
    const project = this.access(tx, input, write);
    const row = tx.get(input.projectId, 'novels', key('book', input.bookId));
    if (row?.kind !== 'creation-book' || row.projectId !== project.id || row.workspaceId !== project.workspaceId) fail('BOOK_NOT_FOUND', 404);
    return { project, row };
  }

  async bookScope(input) {
    if (input.projectId) return input;
    if (input.scopeKind === OWNER_BOOK_SCOPE && input.storageScope) return input;
    return this.resolveScope({ userId: input.userId, bookId: input.bookId });
  }

  transactionScopes(input) {
    return input.scopeKind === OWNER_BOOK_SCOPE ? [INDEX, input.storageScope] : [input.projectId];
  }

  dataScope(input) {
    return input.scopeKind === OWNER_BOOK_SCOPE ? input.storageScope : input.projectId;
  }

  async withBook(input, callback) {
    const scope = await this.bookScope(input);
    return this.repository.transaction(this.transactionScopes(scope), tx => callback(tx, scope));
  }

  async projectBookScope(input) {
    let scope;
    if (input.projectId) {
      const index = await this.repository.novels.get(INDEX, key('book', input.bookId));
      if (index?.kind === 'creation-book-index' && index.scopeKind === OWNER_BOOK_SCOPE) {
        scope = await this.resolveScope({ userId: input.userId, bookId: input.bookId });
      } else return input;
    } else scope = await this.bookScope(input);
    if (!scope.projectId) {
      await this.repository.transaction(this.transactionScopes(scope), tx => this.book(tx, scope, true));
      this.requireProject(scope);
    }
    return scope;
  }

  requireProject(input) {
    if (!input.projectId) fail('CREATION_PROJECT_REQUIRED', 409, '请先将创作书关联到小说项目后再生成或提交章节');
  }

  async create(input) {
    identifier(input.userId);
    identifier(input.bookId);
    if (input.bibleId != null) identifier(input.bibleId);
    if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) fail('INVALID_BIBLE', 422);
    const plan = clone(input.plan || {});
    const budgetLimit = Number(plan.budgetLimit || 0);
    const spentCost = Number(input.initialCost || 0);
    if (![budgetLimit, spentCost].every(n => Number.isFinite(n) && n >= 0)) fail('INVALID_COST', 422);
    if (!input.projectId) {
      const storageScope = ownerBookScope(input.userId, input.bookId);
      return this.repository.transaction([INDEX, storageScope], tx => {
        const bibleId = input.bibleId || `bible_${crypto.randomUUID().replace(/-/g, '')}`;
        if (tx.get(INDEX, 'novels', key('book', input.bookId)) || tx.get(INDEX, 'novels', key('bible-id', bibleId))) {
          fail('CREATION_BOOK_CONFLICT');
        }
        const now = this.now();
        tx.put(INDEX, 'novels', { id: key('book', input.bookId), kind: 'creation-book-index',
          scopeKind: OWNER_BOOK_SCOPE, ownerUserId: input.userId, storageScope }, 0);
        tx.put(INDEX, 'novels', { id: key('bible-id', bibleId), kind: 'creation-bible-index',
          scopeKind: OWNER_BOOK_SCOPE, ownerUserId: input.userId, storageScope }, 0);
        const row = tx.put(storageScope, 'novels', { id: key('book', input.bookId), kind: 'creation-book',
          scopeKind: OWNER_BOOK_SCOPE, storageScope, bookId: input.bookId, title: String(input.title || '').slice(0, 120),
          ownerUserId: input.userId, bibleId, sourceBriefId: String(input.sourceDissectionId || ''), currentStateVersion: 0,
          currentChapterNo: 0, status: 'draft', budgetLimit, spentCost, plan, createdAt: now, updatedAt: now }, 0);
        tx.put(storageScope, 'novels', { id: key('bible', input.bookId), kind: 'creation-bible', bookId: input.bookId,
          bibleId, version: 1, payload: clone(input.payload), payloadHash: hash(JSON.stringify(input.payload)), updatedAt: now }, 0);
        tx.put(storageScope, 'ledger', { id: `bv_${bibleId}_1`, kind: 'creation-bible-version', bookId: input.bookId,
          bibleId, version: 1, payload: clone(input.payload), parentVersion: 0, actorUserId: input.userId, createdAt: now }, 0);
        return { ok: true, bookId: row.bookId, bibleId, version: 1 };
      });
    }
    identifier(input.projectId);
    return this.repository.transaction([INDEX, input.projectId], tx => {
      const project = this.access(tx, input, true);
      if (tx.get(input.projectId, 'novels', key('book', input.bookId))) fail('CREATION_BOOK_CONFLICT');
      const now = this.now();
      const bibleId = input.bibleId || `bible_${crypto.randomUUID().replace(/-/g, '')}`;
      if (tx.get(INDEX, 'novels', key('book', input.bookId)) || tx.get(INDEX, 'novels', key('bible-id', bibleId))) fail('CREATION_BOOK_CONFLICT');
      tx.put(INDEX, 'novels', { id: key('book', input.bookId), kind: 'creation-book-index', projectId: project.id }, 0);
      tx.put(INDEX, 'novels', { id: key('bible-id', bibleId), kind: 'creation-bible-index', projectId: project.id }, 0);
      const row = tx.put(input.projectId, 'novels', { id: key('book', input.bookId), kind: 'creation-book',
        bookId: input.bookId, title: String(input.title || project.title || '').slice(0, 120),
        novelId: project.id, projectId: project.id, workspaceId: project.workspaceId, ownerUserId: input.userId,
        bibleId, sourceBriefId: String(input.sourceDissectionId || ''), currentStateVersion: 0, currentChapterNo: 0,
        status: 'draft', budgetLimit, spentCost, plan, createdAt: now, updatedAt: now }, 0);
      tx.put(input.projectId, 'novels', { id: key('bible', input.bookId), kind: 'creation-bible', bookId: input.bookId,
        bibleId, version: 1, payload: clone(input.payload), payloadHash: hash(JSON.stringify(input.payload)), updatedAt: now }, 0);
      tx.put(input.projectId, 'ledger', { id: `bv_${bibleId}_1`, kind: 'creation-bible-version', bookId: input.bookId,
        bibleId, version: 1, payload: clone(input.payload), parentVersion: 0, actorUserId: input.userId, createdAt: now }, 0);
      return { ok: true, bookId: row.bookId, bibleId, version: 1 };
    });
  }

  async read(input) {
    return this.withBook(input, (tx, scope) => publicBook(this.book(tx, scope).row));
  }
  async resolveScope({ userId, bookId }) {
    identifier(userId);
    identifier(bookId);
    const index = await this.repository.novels.get(INDEX, key('book', bookId));
    if (index?.kind !== 'creation-book-index') fail('BOOK_NOT_FOUND', 404);
    if (index.scopeKind === OWNER_BOOK_SCOPE) {
      if (index.ownerUserId !== userId || index.storageScope !== ownerBookScope(userId, bookId)) fail('BOOK_NOT_FOUND', 404);
      return this.repository.transaction([INDEX, index.storageScope], tx => {
        const current = tx.get(INDEX, 'novels', key('book', bookId));
        if (current?.kind !== 'creation-book-index' || current.scopeKind !== OWNER_BOOK_SCOPE ||
            current.ownerUserId !== userId || current.storageScope !== index.storageScope) fail('BOOK_NOT_FOUND', 404);
        const row = tx.get(index.storageScope, 'novels', key('book', bookId));
        if (row?.kind !== 'creation-book' || row.ownerUserId !== userId || row.storageScope !== index.storageScope) fail('BOOK_NOT_FOUND', 404);
        return { userId, bookId, scopeKind: OWNER_BOOK_SCOPE, storageScope: index.storageScope };
      });
    }
    if (!index.projectId) fail('BOOK_NOT_FOUND', 404);
    return this.repository.transaction([INDEX, index.projectId], tx => {
      const current = tx.get(INDEX, 'novels', key('book', bookId));
      if (current?.kind !== 'creation-book-index' || current.projectId !== index.projectId) fail('BOOK_NOT_FOUND', 404);
      try {
        const { project } = this.book(tx, { userId, bookId, projectId: current.projectId });
        return { userId, bookId, projectId: project.id, workspaceId: project.workspaceId };
      } catch (error) {
        if (error.code === 'FORBIDDEN' || error.code === 'BOOK_NOT_FOUND') fail('BOOK_NOT_FOUND', 404);
        throw error;
      }
    });
  }
  async list(input) {
    if (!input.projectId) {
      identifier(input.userId);
      const indexed = (await this.repository.novels.list(INDEX)).filter(row => row.kind === 'creation-book-index' &&
        row.scopeKind === OWNER_BOOK_SCOPE && row.ownerUserId === input.userId).sort((a, b) => a.id.localeCompare(b.id));
      const scopes = indexed.map(row => row.storageScope);
      return this.repository.transaction([INDEX, ...scopes], tx => {
        const current = tx.list(INDEX, 'novels').filter(row => row.kind === 'creation-book-index' &&
          row.scopeKind === OWNER_BOOK_SCOPE && row.ownerUserId === input.userId).sort((a, b) => a.id.localeCompare(b.id));
        if (JSON.stringify(current.map(row => [row.id, row.storageScope])) !==
            JSON.stringify(indexed.map(row => [row.id, row.storageScope]))) fail('REVISION_CONFLICT');
        return current.map(row => {
          const bookId = row.id.slice('creation-book:'.length);
          const book = tx.get(row.storageScope, 'novels', key('book', bookId));
          return book?.kind === 'creation-book' && book.ownerUserId === input.userId && book.storageScope === row.storageScope
            ? publicBook(book) : null;
        }).filter(Boolean);
      });
    }
    return this.repository.transaction([input.projectId], tx => {
      this.access(tx, input);
      return tx.list(input.projectId, 'novels').filter(row => row.kind === 'creation-book').map(publicBook);
    });
  }
  async readBible(input) {
    return this.withBook(input, (tx, scope) => {
      this.book(tx, scope);
      const storage = this.dataScope(scope);
      const row = tx.get(storage, 'novels', key('bible', scope.bookId));
      if (row?.kind !== 'creation-bible') fail('BIBLE_NOT_FOUND', 404);
      return { bibleId: row.bibleId, version: row.version, payload: clone(row.payload) };
    });
  }
  async qualityReport(input) {
    return this.withBook(input, (tx, scope) => {
      this.book(tx, scope);
      const records = tx.list(this.dataScope(scope), 'ledger').filter(row => row.kind === 'creation-audit' && row.bookId === scope.bookId);
      return require('../creation-quality-report').buildCreationQualityReport(records);
    });
  }
  async saveBibleCAS(input) {
    if (!integer(input.expectedVersion) || !input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) fail('INVALID_BIBLE', 422);
    return this.withBook(input, (tx, scope) => {
      this.book(tx, scope, true);
      const storage = this.dataScope(scope);
      const old = tx.get(storage, 'novels', key('bible', scope.bookId));
      if (old?.kind !== 'creation-bible') fail('BIBLE_NOT_FOUND', 404);
      if (old.version !== input.expectedVersion) fail('REVISION_CONFLICT');
      const version = old.version + 1;
      const payload = clone(input.payload);
      const now = this.now();
      tx.put(storage, 'novels', { ...old, version, payload, payloadHash: hash(JSON.stringify(payload)), updatedAt: now }, old.revision);
      tx.put(storage, 'ledger', { id: `bv_${old.bibleId}_${version}`, kind: 'creation-bible-version', bookId: scope.bookId,
        bibleId: old.bibleId, version, payload, parentVersion: old.version, actorUserId: input.userId,
        changeSummary: String(input.changeSummary || ''), createdAt: now }, 0);
      return { ok: true, bibleId: old.bibleId, version, payload };
    });
  }
  async snapshots(input) {
    return this.withBook(input, (tx, scope) => {
      this.book(tx, scope);
      return tx.list(this.dataScope(scope), 'ledger').filter(row => row.kind === 'creation-snapshot' && row.bookId === scope.bookId &&
        (!input.upTo || row.chapterNo <= input.upTo)).sort((a, b) => b.stateVersion - a.stateVersion).map(clone);
    });
  }

  async contractContext(input) {
    const scope = await this.projectBookScope(input);
    return this.repository.transaction([scope.projectId], tx => {
      const { project, row: book } = this.book(tx, scope, true);
      const member = project.members[input.userId];
      if (member.role !== 'owner' && !member.canSpend) fail('spend_forbidden', 403);
      const bible = tx.get(scope.projectId, 'novels', key('bible', input.bookId));
      if (!bible) fail('BIBLE_NOT_FOUND', 404);
      const previous = tx.list(scope.projectId, 'ledger').filter(row => row.kind === 'creation-snapshot' && row.bookId === input.bookId)
        .sort((a, b) => b.stateVersion - a.stateVersion)[0] || null;
      return { book: publicBook(book), bible: { bibleId: bible.bibleId, version: bible.version, payload: clone(bible.payload) },
        previous: clone(previous), baseline: { bibleVersion: bible.version, stateVersion: book.currentStateVersion,
          baseRevision: project.contentRevision, planHash: hash(JSON.stringify(bible.payload.creationPlan || {})) } };
    });
  }

  async saveContractCAS(input) {
    const scope = await this.projectBookScope(input);
    return this.repository.transaction([scope.projectId], tx => {
      const { project, row: book } = this.book(tx, scope, true);
      const member = project.members[input.userId];
      if (member.role !== 'owner' && !member.canSpend) fail('spend_forbidden', 403);
      const bible = tx.get(scope.projectId, 'novels', key('bible', input.bookId));
      if (input.baseline.bibleVersion !== bible.version || input.baseline.stateVersion !== book.currentStateVersion ||
          input.baseline.baseRevision !== project.contentRevision || input.baseline.planHash !== hash(JSON.stringify(bible.payload.creationPlan || {}))) fail('REVISION_CONFLICT');
      const id = `contract_${crypto.randomUUID().replace(/-/g, '')}`;
      tx.put(scope.projectId, 'ledger', { id, kind: 'creation-contract', bookId: book.bookId, contract: clone(input.contract),
        baseline: clone(input.baseline), validation: clone(input.validation), providerAttempts: clone(input.providerAttempts || []), actorUserId: input.userId, auditStatus: 'unaudited', createdAt: this.now() }, 0);
      return { contractId: id };
    });
  }

  async recordContractFailure(input) {
    if (!Number.isSafeInteger(input.chapterNo) || input.chapterNo < 1) fail('INVALID_CHAPTER_NO', 422);
    const scope = await this.projectBookScope(input);
    return this.repository.transaction([scope.projectId], tx => {
      const { project, row: book } = this.book(tx, scope, true);
      const member = project.members[input.userId];
      if (member.role !== 'owner' && !member.canSpend) fail('spend_forbidden', 403);
      const failureId = `contract_failure_${crypto.randomUUID().replace(/-/g, '')}`;
      tx.put(scope.projectId, 'ledger', {
        id: failureId,
        kind: 'creation-contract-failure',
        bookId: book.bookId,
        chapterNo: input.chapterNo,
        baseline: clone(input.baseline),
        failureEvidence: clone(input.failureEvidence),
        providerResponse: input.providerResponse == null ? null : clone(input.providerResponse),
        providerAttempts: clone(input.providerAttempts || []),
        actorUserId: input.userId,
        createdAt: this.now()
      }, 0);
      return { failureId };
    });
  }

  async debts(input) {
    return this.withBook(input, (tx, scope) => {
      const { row: book } = this.book(tx, scope);
      const storage = this.dataScope(scope);
      const chapterNo = input.chapterNo ?? book.currentChapterNo + 1;
      if (!Number.isSafeInteger(chapterNo) || chapterNo < 1) fail('INVALID_CHAPTER_NO', 422);
      const ledger = tx.list(storage, 'ledger');
      const rows = ledger.filter(row => row.kind === 'creation-debt-outbox' && row.bookId === input.bookId).sort((a, b) => a.createdAt - b.createdAt);
      const stored = ledger.filter(row => row.kind === 'creation-debt' && row.bookId === input.bookId);
      const seeds = new Set(stored.map(row => row.seed));
      let recovered = 0;
      for (const outbox of rows) {
        const materializedId = key('debt-materialized', outbox.id);
        if (tx.get(storage, 'novels', materializedId)) continue;
        for (const debt of Array.isArray(outbox.causalDebts) ? outbox.causalDebts : []) {
          const seed = String(debt.seed || '').trim().slice(0, 500);
          if (!seed || seeds.has(seed)) continue;
          seeds.add(seed);
          const type = ['major', 'arc', 'micro'].includes(debt.type) ? debt.type : 'arc';
          const originChapter = Math.max(1, Number(debt.originChapter) || 1);
          const id = `debt_${hash(`${book.bookId}:${seed}`).slice(0, 32)}`;
          const row = tx.put(storage, 'ledger', { ...clone(debt), id, kind: 'creation-debt', bookId: book.bookId,
            type, seed, originChapter, status: 'active', debtCategory: String(debt.debtCategory || 'general'),
            maturationChapter: Number(debt.maturationChapter) || originChapter + (type === 'major' ? 25 : type === 'micro' ? 3 : 10),
            recordedAt: outbox.createdAt, sourceSnapshotId: outbox.snapshotId }, 0);
          stored.push(row);
        }
        tx.put(storage, 'novels', { id: materializedId, kind: 'creation-debt-materialized',
          outboxId: outbox.id, bookId: book.bookId, createdAt: this.now() }, 0);
        recovered++;
      }
      const view = projectDebts(stored.sort((a, b) => a.recordedAt - b.recordedAt), chapterNo);
      return { chapterNo, ...view, recovery: { recovered, pending: 0 } };
    });
  }

  async commitChapter(input) {
    const scope = await this.projectBookScope(input);
    identifier(input.runId || input.run?.id);
    return this.repository.transaction([scope.projectId], async tx => {
      const { project, row: book } = this.book(tx, scope, true);
      const run = tx.get(scope.projectId, 'generation', input.runId || input.run?.id);
      const actor = input.userId;
      if (!run || run.kind !== 'generation-run-v1' || run.actorUserId !== actor || run.projectId !== project.id ||
          run.workspaceId !== project.workspaceId) fail('STATE_CONFLICT');
      const request = run.request || {};
      const result = run.result || {};
      const submitted = input.payload || {};
      const payload = submitted.payload ? { ...submitted, ...submitted.payload } : submitted;
      const content = String(input.text ?? result.draft ?? '');
      const contentHash = hash(content);
      const chapterNo = Number(result.contract?.chapterNo);
      if (request.creationBookId !== book.bookId || request.novelId && request.novelId !== project.id ||
          contentHash !== result.outputHash || content !== result.draft ||
          !integer(chapterNo) || chapterNo < 1 || payload.content != null && payload.content !== content ||
          payload.projectId && payload.projectId !== project.id || payload.chapterId && payload.chapterId !== request.chapterId ||
          payload.sceneId && payload.sceneId !== request.sceneId) fail('STATE_CONFLICT');
      const receiptId = key('receipt', `${book.bookId}:${chapterNo}`);
      const existing = tx.get(input.projectId, 'ledger', receiptId);
      if (existing) {
        if (existing.contentHash !== contentHash || existing.runId !== run.id) fail('STATE_CONFLICT');
        return { ...clone(existing.receipt), idempotent: true };
      }
      const now = this.now();
      if (run.state !== 'committing' || !Number.isFinite(run.leaseUntil) || run.leaseUntil <= now || !run.leaseOwner ||
          !Number.isSafeInteger(run.fencingToken) || run.fencingToken <= 0 ||
          run.leaseOwner !== (input.leaseOwner ?? input.run?.leaseOwner) ||
          run.fencingToken !== (input.fencingToken ?? input.run?.fencingToken)) fail('LEASE_LOST');
      const check = validateGenerationAuditEvidence({ generationId: run.id, chapterNo, content, contentHash, result });
      if (!check.ok || result.benchmark?.status && result.benchmark.status !== 'passed') fail('AUDIT_BLOCKED');
      const context = request.storyContext || {};
      const baseStateVersion = payload.baseStateVersion ?? context.stateVersion ?? context.baseStateVersion;
      const expectedRevision = payload.expectedRevision ?? context.baseRevision;
      if (!integer(baseStateVersion) || !integer(expectedRevision) || baseStateVersion !== (context.stateVersion ?? context.baseStateVersion) ||
          expectedRevision !== context.baseRevision || baseStateVersion !== book.currentStateVersion ||
          expectedRevision !== project.contentRevision || chapterNo !== book.currentChapterNo + 1) fail('STATE_CONFLICT');
      const bible = tx.get(input.projectId, 'novels', key('bible', book.bookId));
      const planHash = hash(JSON.stringify(bible?.payload?.creationPlan || {}));
      if (!bible || (context.bibleVersion ?? context.storyBibleVersion) !== bible.version || context.planHash !== planHash ||
          payload.bibleVersion != null && payload.bibleVersion !== bible.version ||
          payload.stateVersion != null && payload.stateVersion !== baseStateVersion ||
          payload.planHash && payload.planHash !== planHash ||
          payload.baseHash && payload.baseHash !== context.baseHash) fail('STATE_CONFLICT');
      const previous = tx.list(input.projectId, 'ledger').filter(row => row.kind === 'creation-snapshot' && row.bookId === book.bookId &&
        row.stateVersion <= baseStateVersion).sort((a, b) => b.stateVersion - a.stateVersion)[0] || {};
      const projection = deriveGenerationCommitProjection({ result, text: content, previousSnapshot: previous, chapterNo });
      const pendingCosts = ['pending', 'unknown', 'provider_unknown', 'needs_review'];
      if (run.actualCostMinor == null || run.costStatus !== 'settled' || pendingCosts.includes(run.usageStatus) ||
          (run.stages || []).filter(stage => String(stage.stage || '').startsWith('provider:')).some(stage =>
            stage.actualCostMinor == null || stage.costStatus !== 'settled' || pendingCosts.includes(stage.usageStatus) ||
            stage.status !== 'completed')) fail('PROVIDER_COST_PENDING');
      const cost = Number(run.actualCostMinor) / 100;
      if (!Number.isFinite(cost) || cost < 0) fail('INVALID_COST', 422);
      if (book.budgetLimit > 0 && book.spentCost + cost > book.budgetLimit + 1e-9) fail('BUDGET_EXCEEDED', 402);
      const state = clone(project.state);
      if (request.sceneId) {
        const located = locateScene(state, request.chapterId, request.sceneId);
        if (!located || !context.baseHash || hashSceneText(located.scene.content || '') !== context.baseHash) fail('STATE_CONFLICT');
        located.scene.content = content;
      }
      this.app.validateState(state);
      if (this.app.guardNovelWrite) await this.app.guardNovelWrite(tx, project, { ...input, state, expectedRevision });
      const next = tx.put(input.projectId, 'novels', { ...project, state, contentRevision: expectedRevision + 1, updatedAt: now,
        wordCount: (state.volumes || []).reduce((n, v) => n + (v.chapters || []).reduce((m, c) => m + (c.scenes || [])
          .reduce((s, scene) => s + String(scene.content || '').replace(/\s/g, '').length, 0), 0), 0) }, project.revision);
      if (this.app.onNovelChanged) await this.app.onNovelChanged(tx, next, project);
      const stateVersion = baseStateVersion + 1;
      const snapshotId = `snap_${book.bookId}_${chapterNo}_${stateVersion}`;
      const snapshot = { ...projection, id: snapshotId, kind: 'creation-snapshot', bookId: book.bookId, chapterNo, bibleVersion: bible.version,
        stateVersion, contentHash, auditStatus: 'passed', actorUserId: actor, createdAt: now };
      tx.put(input.projectId, 'ledger', snapshot, 0);
      const manuscriptId = `manuscript:${book.bookId}:chapter:${chapterNo}`;
      const prior = tx.get(input.projectId, 'novels', `resource:${manuscriptId}`);
      const revision = (prior?.contentRevision || 0) + 1;
      const manuscript = { title: String(payload.title || result.contract?.title || `Chapter ${chapterNo}`), kind: 'chapter',
        chapterId: request.chapterId || manuscriptId, continuityId: 'main', canonApplicability: 'canon', numberingPolicy: 'sequential',
        text: content, hash: contentHash, status: 'committed', revision, creationBookId: book.bookId, stateVersion };
      tx.put(input.projectId, 'novels', { id: `resource:${manuscriptId}`, kind: 'resource', resourceId: manuscriptId,
        resourceKind: 'manuscript', payload: manuscript, contentRevision: revision, deleted: false,
        createdAt: prior?.createdAt || now, updatedAt: now }, prior?.revision || 0);
      tx.put(input.projectId, 'ledger', { id: `resource-version:${manuscriptId}:${revision}`, kind: 'resource-version',
        resourceId: manuscriptId, resourceKind: 'manuscript', payload: manuscript, contentRevision: revision,
        changedBy: actor, reason: 'Generation V2 chapter commit', createdAt: now }, 0);
      tx.put(input.projectId, 'novels', { ...book, currentStateVersion: stateVersion, currentChapterNo: chapterNo,
        spentCost: book.spentCost + cost, updatedAt: now }, book.revision);
      tx.put(input.projectId, 'ledger', { id: `cca_generation_${run.id.replace(/[^A-Za-z0-9_]/g, '_')}`,
        kind: 'creation-audit', bookId: book.bookId, chapterNo, contentHash, evidence: check.evidence, projection,
        bibleVersion: bible.version, stateVersion: baseStateVersion, actorUserId: actor, createdAt: now }, 0);
      const hookResult = this.onCommit ? await this.onCommit(tx, { project: next, book, snapshot, projection, run }) : null;
      const debtStatus = hookResult?.debtsRecorded === true ? 'recorded' : 'pending';
      const receipt = { committed: true, idempotent: false, snapshotId, stateVersion, currentStateVersion: stateVersion,
        chapterNo, contentHash, projectRevision: next.contentRevision, spentCost: book.spentCost + cost,
        debtStatus: { status: debtStatus, durable: true } };
      tx.put(input.projectId, 'ledger', { id: key('debt-outbox', snapshotId), kind: 'creation-debt-outbox',
        bookId: book.bookId, snapshotId, causalDebts: clone(projection.causalDebts), ledgerDelta: clone(projection.factLedgerDelta),
        status: debtStatus, actorUserId: actor, createdAt: now }, 0);
      tx.put(input.projectId, 'ledger', { id: receiptId, kind: 'creation-commit-receipt', bookId: book.bookId,
        runId: run.id, contentHash, content, ledgerDelta: projection.factLedgerDelta, causalDebts: projection.causalDebts,
        receipt, actorUserId: actor, createdAt: now }, 0);
      tx.put(input.projectId, 'generation', { ...run, result: { ...result, commitReceipt: receipt }, updatedAt: now }, run.revision);
      return receipt;
    });
  }
}

module.exports = { JsonCreationRepository };
