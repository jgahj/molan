'use strict';

const crypto = require('node:crypto');
const domain = require('./memory-domain');

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function changesetHash(changeset) {
  return hash([
    changeset.id, changeset.book_id, changeset.branch_id, changeset.base_state_version,
    changeset.candidate_hash, changeset.operations_json, changeset.dependencies_json,
    changeset.risk_level, changeset.audit_report_json
  ]);
}

function initializeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_branch_heads (
      book_id TEXT NOT NULL, branch_id TEXT NOT NULL,
      state_version INTEGER NOT NULL CHECK (state_version > 0),
      PRIMARY KEY (book_id, branch_id)
    );
    CREATE TABLE IF NOT EXISTS memory_approvals (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, changeset_id TEXT NOT NULL,
      content_hash TEXT NOT NULL, actor_id TEXT NOT NULL, status TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_approval_changeset ON memory_approvals(changeset_id, sequence);
    CREATE TABLE IF NOT EXISTS memory_commit_receipts (
      book_id TEXT NOT NULL, branch_id TEXT NOT NULL, actor_id TEXT NOT NULL,
      request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
      changeset_id TEXT NOT NULL, receipt_json TEXT NOT NULL,
      PRIMARY KEY (book_id, branch_id, actor_id, request_key)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_receipt_changeset ON memory_commit_receipts(changeset_id);
  `);
}

function validateOperations(db, changeset, operations) {
  if (!Array.isArray(operations) || operations.length > 1000) return 'INVALID_MEMORY_OPERATION';
  const tables = {
    INSERT_FACT: 'world_fact_decisions',
    INSERT_COGNITION: 'character_cognition',
    STATE_TRANSITION: 'state_transitions'
  };
  for (const operation of operations) {
    if (!operation || (!Object.hasOwn(tables, operation.type) && !Object.hasOwn(domain.DEFINITIONS, operation.type)) ||
        !operation.payload || typeof operation.payload !== 'object' || Array.isArray(operation.payload)) {
      return 'INVALID_MEMORY_OPERATION';
    }
    const payload = operation.payload;
    if ((payload.bookId && payload.bookId !== changeset.book_id) ||
        (payload.branchId && payload.branchId !== changeset.branch_id)) return 'MEMORY_REFERENCE_INVALID';
    if (Object.hasOwn(domain.DEFINITIONS, operation.type)) {
      const conflict = domain.validateDomainOperation(db, operation, changeset, operations);
      if (conflict) return conflict;
      continue;
    }
    if (payload.id && db.prepare(`SELECT id FROM ${tables[operation.type]} WHERE id = ?`).get(payload.id)) {
      return 'MEMORY_RECORD_EXISTS';
    }
    const propositionId = operation.type === 'INSERT_FACT' ? payload.propositionId
      : operation.type === 'INSERT_COGNITION' ? payload.targetExpressionId : null;
    if (operation.type !== 'STATE_TRANSITION' && (!propositionId ||
        !db.prepare('SELECT id FROM memory_propositions WHERE id = ? AND book_id = ? AND branch_id = ?')
          .get(propositionId, changeset.book_id, changeset.branch_id))) return 'MEMORY_REFERENCE_INVALID';
    if (operation.type === 'STATE_TRANSITION' && !payload.entityId) return 'INVALID_MEMORY_OPERATION';
    if (operation.type === 'INSERT_COGNITION' && !payload.holderEntityId) return 'INVALID_MEMORY_OPERATION';
    for (const field of ['supportingEvidenceIds', 'opposingEvidenceIds', 'sourceEvidenceIds']) {
      if (payload[field] !== undefined && !Array.isArray(payload[field])) return 'INVALID_MEMORY_OPERATION';
      for (const evidenceId of payload[field] || []) {
        const evidence = db.prepare('SELECT * FROM memory_evidence WHERE id = ? AND book_id = ? AND branch_id = ?')
          .get(evidenceId, changeset.book_id, changeset.branch_id);
        if (!evidence || (propositionId && evidence.proposition_id !== propositionId)) return 'MEMORY_REFERENCE_INVALID';
        const anchor = JSON.parse(evidence.source_anchor_json);
        if (anchor.chapterRevisionId) {
          const manuscript = db.prepare('SELECT * FROM memory_manuscripts WHERE id = ? AND book_id = ? AND branch_id = ?')
            .get(anchor.chapterRevisionId, changeset.book_id, changeset.branch_id);
          if (!manuscript || manuscript.content_hash !== anchor.contentHash ||
              !Number.isInteger(anchor.startOffset) || !Number.isInteger(anchor.endOffset) ||
              anchor.startOffset < 0 || anchor.endOffset > manuscript.content.length || anchor.startOffset >= anchor.endOffset ||
              manuscript.content.slice(anchor.startOffset, anchor.endOffset) !== anchor.quote ||
              db.prepare('SELECT id FROM memory_invalidations WHERE manuscript_id = ?').get(manuscript.id)) return 'EVIDENCE_ANCHOR_INVALID';
          const source = db.prepare('SELECT manuscript_id FROM memory_changeset_sources WHERE changeset_id = ?').get(changeset.id);
          const accepted = db.prepare('SELECT accepted_id FROM memory_manuscript_heads WHERE accepted_id = ?').get(manuscript.id);
          if (!accepted && (!source || source.manuscript_id !== manuscript.id)) return 'EVIDENCE_CANDIDATE_NOT_SELECTED';
        }
      }
    }
    for (const eventId of [payload.eventId, payload.sourceEventId].filter(Boolean)) {
      const existsInDb = db.prepare('SELECT id FROM story_events WHERE id = ? AND book_id = ? AND branch_id = ?')
        .get(eventId, changeset.book_id, changeset.branch_id);
      const existsInOps = operations.some(o => o.type === 'INSERT_EVENT' && o.payload && o.payload.id === eventId);
      if (!existsInDb && !existsInOps) return 'CHANGESET_DEPENDENCY_MISSING';
    }
    if (payload.supersedesId) {
      const existsInDb = db.prepare('SELECT id FROM world_fact_decisions WHERE id = ? AND book_id = ? AND branch_id = ?')
        .get(payload.supersedesId, changeset.book_id, changeset.branch_id);
      const existsInOps = operations.some(o => o.type === 'INSERT_FACT' && o.payload && o.payload.id === payload.supersedesId);
      if (!existsInDb && !existsInOps) return 'CHANGESET_DEPENDENCY_MISSING';
    }
    if (operation.type === 'INSERT_FACT') {
      if (payload.verdict && !['true', 'false', 'undetermined'].includes(payload.verdict)) return 'INVALID_MEMORY_OPERATION';
      const decisions = db.prepare(`SELECT * FROM world_fact_decisions
        WHERE book_id = ? AND branch_id = ? AND proposition_id = ? AND timeline_id = ? AND cycle_id = ? AND status = 'confirmed'`)
        .all(changeset.book_id, changeset.branch_id, payload.propositionId, payload.timelineId || 't0', payload.cycleId || 'c0');
      const overlaps = previous => !(
        payload.validIntervalEnd && previous.valid_interval_start && payload.validIntervalEnd <= previous.valid_interval_start ||
        previous.valid_interval_end && payload.validIntervalStart && previous.valid_interval_end <= payload.validIntervalStart
      );
      if (decisions.some(previous => previous.id !== payload.supersedesId && overlaps(previous) &&
          previous.verdict !== 'undetermined' && (payload.verdict || 'true') !== 'undetermined' &&
          previous.verdict !== (payload.verdict || 'true'))) return 'FACT_CONFLICT';
    }
  }
  const dependencies = JSON.parse(changeset.dependencies_json);
  if (!Array.isArray(dependencies)) return 'CHANGESET_DEPENDENCY_MISSING';
  for (const dependency of dependencies) {
    if (typeof dependency !== 'string' || !db.prepare(`SELECT id FROM memory_changesets
      WHERE id = ? AND book_id = ? AND branch_id = ? AND committed_at IS NOT NULL`)
      .get(dependency, changeset.book_id, changeset.branch_id)) return 'CHANGESET_DEPENDENCY_MISSING';
  }
  return null;
}

function prepareCommit(db, changeset, actorId, options = {}) {
  if (options.actorRole === 'reviewer' || options.actorRole === 'viewer') {
    return { code: 'FORBIDDEN' };
  }
  const contentHash = changesetHash(changeset);
  const requestKey = options.idempotencyKey || changeset.id;
  if (typeof requestKey !== 'string' || requestKey.length > 200) return { code: 'INVALID_IDEMPOTENCY_KEY' };
  const requestHash = hash([changeset.id, contentHash, options.candidateHash ?? null, options.expectedStateVersion ?? null]);
  const previous = db.prepare(`SELECT * FROM memory_commit_receipts
    WHERE book_id = ? AND branch_id = ? AND actor_id = ? AND request_key = ?`)
    .get(changeset.book_id, changeset.branch_id, actorId, requestKey);
  if (previous) return previous.request_hash === requestHash
    ? { replay: { ...JSON.parse(previous.receipt_json), replayed: true } }
    : { code: 'IDEMPOTENCY_CONFLICT' };
  if (changeset.committed_at) {
    const committed = db.prepare('SELECT request_hash, receipt_json FROM memory_commit_receipts WHERE changeset_id = ? LIMIT 1').get(changeset.id);
    if (committed && committed.request_hash !== requestHash) return { code: 'IDEMPOTENCY_CONFLICT' };
    if (!committed) return { code: 'LEGACY_COMMIT_REQUIRES_RECONCILIATION' };
    db.prepare('INSERT INTO memory_commit_receipts VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(changeset.book_id, changeset.branch_id, actorId, requestKey, requestHash, changeset.id, committed.receipt_json);
    return { replay: { ...JSON.parse(committed.receipt_json), replayed: true } };
  }
  if (changeset.approval_status !== 'approved') return { code: 'changeset_not_approved' };
  const approval = db.prepare('SELECT * FROM memory_approvals WHERE changeset_id = ? ORDER BY sequence DESC LIMIT 1').get(changeset.id);
  if (!approval || approval.status !== 'approved' || approval.content_hash !== contentHash) return { code: 'APPROVAL_STALE' };

  const audit = JSON.parse(changeset.audit_report_json || '{}');
  const policy = options.approvalPolicy || changeset.approval_policy || audit.approvalPolicy || 'author_owned';
  if (policy === 'two_person') {
    if (approval.actor_id === audit.proposedBy) {
      return { code: 'INDEPENDENT_REVIEW_REQUIRED' };
    }
  }

  // 6 维基线版本统一检查：正文、圣经、计划、故事状态、文风、披露策略及ACL
  if (options.expectedNovelRevision !== undefined) {
    const novel = db.prepare('SELECT revision FROM novels WHERE id = ?').get(changeset.book_id);
    if (novel && Number(options.expectedNovelRevision) !== Number(novel.revision)) {
      return { code: 'BASELINE_STALE' };
    }
  }
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
  if (options.expectedBibleVersion !== undefined && tables.has('creation_bibles')) {
    const bible = db.prepare(`SELECT bible.current_version FROM creation_books book
      JOIN creation_bibles bible ON bible.id = book.bible_id WHERE book.novel_id = ? LIMIT 1`).get(changeset.book_id);
    if (bible && Number(options.expectedBibleVersion) !== Number(bible.current_version)) {
      return { code: 'BASELINE_STALE' };
    }
  }
  if (options.expectedPlanVersion !== undefined && tables.has('creation_books')) {
    const book = db.prepare('SELECT current_state_version FROM creation_books WHERE novel_id = ? LIMIT 1').get(changeset.book_id);
    if (book && Number(options.expectedPlanVersion) !== Number(book.current_state_version)) {
      return { code: 'BASELINE_STALE' };
    }
  }
  if (options.expectedStyleVersion !== undefined && tables.has('style_profiles')) {
    const style = db.prepare('SELECT revision FROM style_profiles WHERE book_id = ? AND branch_id = ? AND active = 1 ORDER BY updated_at DESC LIMIT 1')
      .get(changeset.book_id, changeset.branch_id);
    if (style && Number(options.expectedStyleVersion) !== Number(style.revision)) {
      return { code: 'BASELINE_STALE' };
    }
  }
  if (options.expectedDisclosurePolicyVersion !== undefined && tables.has('disclosure_policies')) {
    const pol = db.prepare('SELECT COUNT(*) as count FROM disclosure_policies WHERE book_id = ? AND branch_id = ?')
      .get(changeset.book_id, changeset.branch_id);
    if (pol && Number(options.expectedDisclosurePolicyVersion) !== Number(pol.count)) {
      return { code: 'BASELINE_STALE' };
    }
  }
  if (options.expectedAclRevision !== undefined && tables.has('novel_projects')) {
    const project = db.prepare('SELECT acl_revision FROM novel_projects WHERE project_id = ? LIMIT 1').get(changeset.book_id);
    if (project && Number(options.expectedAclRevision) !== Number(project.acl_revision)) {
      return { code: 'BASELINE_STALE' };
    }
  }

  const sourceConflict = require('./memory-workflow').validateSource(db, changeset);
  if (sourceConflict) return { code: sourceConflict };
  if (options.candidateHash !== undefined && options.candidateHash !== changeset.candidate_hash) return { code: 'CONTENT_VERSION_CONFLICT' };
  const head = db.prepare('SELECT state_version FROM memory_branch_heads WHERE book_id = ? AND branch_id = ?')
    .get(changeset.book_id, changeset.branch_id);
  const legacy = db.prepare(`SELECT MAX(base_state_version + 1) AS version FROM memory_changesets
    WHERE book_id = ? AND branch_id = ? AND committed_at IS NOT NULL`).get(changeset.book_id, changeset.branch_id);
  const stateVersion = head ? head.state_version : legacy.version || 1;
  if (changeset.base_state_version !== stateVersion ||
      (options.expectedStateVersion !== undefined && options.expectedStateVersion !== stateVersion)) {
    return { code: 'MEMORY_VERSION_CONFLICT' };
  }
  const operations = JSON.parse(changeset.operations_json);
  const code = validateOperations(db, changeset, operations);
  return code ? { code } : { requestKey, requestHash, operations };
}

function saveReceipt(db, changeset, actorId, prepared, receipt) {
  db.prepare(`INSERT INTO memory_branch_heads VALUES (?, ?, ?)
    ON CONFLICT(book_id, branch_id) DO UPDATE SET state_version = excluded.state_version`)
    .run(changeset.book_id, changeset.branch_id, receipt.stateVersion);
  db.prepare('INSERT INTO memory_commit_receipts VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(changeset.book_id, changeset.branch_id, actorId, prepared.requestKey,
      prepared.requestHash, changeset.id, JSON.stringify(receipt));
}

module.exports = { initializeSchema, changesetHash, prepareCommit, saveReceipt };
