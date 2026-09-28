'use strict';

const crypto = require('node:crypto');

function digest(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function fail(code, statusCode = 409) {
  throw Object.assign(new Error(code), { code, statusCode });
}

function transaction(db, action) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function initializeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_manuscripts (
      id TEXT PRIMARY KEY, book_id TEXT NOT NULL, branch_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL, scene_id TEXT NOT NULL, revision INTEGER NOT NULL,
      content TEXT NOT NULL, content_hash TEXT NOT NULL, source_hash TEXT NOT NULL,
      novel_revision INTEGER NOT NULL, config_hash TEXT NOT NULL, created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(book_id, branch_id, chapter_id, scene_id, revision)
    );
    CREATE TABLE IF NOT EXISTS memory_manuscript_heads (
      book_id TEXT NOT NULL, branch_id TEXT NOT NULL, chapter_id TEXT NOT NULL, scene_id TEXT NOT NULL,
      current_id TEXT NOT NULL, accepted_id TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL,
      PRIMARY KEY(book_id, branch_id, chapter_id, scene_id)
    );
    CREATE TABLE IF NOT EXISTS memory_changeset_sources (
      changeset_id TEXT PRIMARY KEY, manuscript_id TEXT NOT NULL, binding_hash TEXT NOT NULL,
      FOREIGN KEY(manuscript_id) REFERENCES memory_manuscripts(id)
    );
    CREATE TABLE IF NOT EXISTS memory_extractions (
      manuscript_id TEXT PRIMARY KEY, result_json TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_projection_snapshots (
      book_id TEXT NOT NULL, branch_id TEXT NOT NULL, state_version INTEGER NOT NULL,
      schema_version INTEGER NOT NULL, payload_hash TEXT NOT NULL, payload_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL, PRIMARY KEY(book_id, branch_id)
    );
    CREATE TABLE IF NOT EXISTS memory_run_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, book_id TEXT NOT NULL, branch_id TEXT NOT NULL,
      run_id TEXT NOT NULL, type TEXT NOT NULL, data_json TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_run_events ON memory_run_events(book_id, run_id, sequence);
    CREATE TABLE IF NOT EXISTS memory_invalidations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, book_id TEXT NOT NULL, branch_id TEXT NOT NULL,
      manuscript_id TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL,
      UNIQUE(book_id, branch_id, manuscript_id, reason)
    );
  `);
}

function stateVersion(db, bookId, branchId = 'main') {
  const head = db.prepare('SELECT state_version FROM memory_branch_heads WHERE book_id = ? AND branch_id = ?').get(bookId, branchId);
  const legacy = db.prepare(`SELECT MAX(base_state_version + 1) AS version FROM memory_changesets
    WHERE book_id = ? AND branch_id = ? AND committed_at IS NOT NULL`).get(bookId, branchId);
  return head ? head.state_version : legacy.version || 1;
}

function emitEvent(db, bookId, branchId, runId, type, data = {}) {
  db.prepare('INSERT INTO memory_run_events (book_id, branch_id, run_id, type, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(bookId, branchId, runId, type, JSON.stringify(data), Date.now());
}

function getNovel(db, bookId) {
  const novel = db.prepare('SELECT * FROM novels WHERE id = ?').get(bookId);
  if (!novel) fail('BOOK_NOT_FOUND', 404);
  return { ...novel, state: JSON.parse(novel.state_json) };
}

function targetContent(state, chapterId, sceneId = '') {
  const matches = (state.volumes || []).flatMap(volume => volume.chapters || []).filter(chapter => chapter.id === chapterId);
  if (matches.length !== 1) fail('CHAPTER_NOT_FOUND', 422);
  const chapter = matches[0];
  if (!sceneId) {
    if (chapter.scenes && chapter.scenes.length) fail('SCENE_REQUIRED', 422);
    return chapter;
  }
  const scenes = (chapter.scenes || []).filter(scene => scene.id === sceneId);
  if (scenes.length !== 1) fail('SCENE_NOT_FOUND', 422);
  return scenes[0];
}

function configHash(db, bookId, branchId) {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
  const profiles = tables.has('style_profiles')
    ? db.prepare('SELECT id, revision, active FROM style_profiles WHERE book_id = ? AND branch_id = ? ORDER BY id').all(bookId, branchId) : [];
  const resources = tables.has('project_resources')
    ? db.prepare('SELECT id, revision, status FROM project_resources WHERE project_id = ? ORDER BY id').all(bookId) : [];
  const policies = db.prepare('SELECT * FROM disclosure_policies WHERE book_id = ? AND branch_id = ? ORDER BY id').all(bookId, branchId);
  const bibles = tables.has('creation_books') && tables.has('creation_bibles')
    ? db.prepare(`SELECT book.id, book.plan_json, book.current_state_version, bible.current_version
      FROM creation_books book LEFT JOIN creation_bibles bible ON bible.id = book.bible_id
      WHERE book.novel_id = ? AND book.project_id = ? ORDER BY book.id`).all(bookId, bookId) : [];
  return digest({ profiles, resources, policies, bibles });
}

function publicManuscript(row) {
  if (!row) return null;
  return {
    id: row.id, bookId: row.book_id, branchId: row.branch_id, chapterId: row.chapter_id,
    sceneId: row.scene_id, revision: row.revision, text: row.content, contentHash: row.content_hash,
    novelRevision: row.novel_revision, createdBy: row.created_by, createdAt: row.created_at
  };
}

function renderManuscript(text) {
  return text.split('\n').map(line => `<p>${line.replace(/&/g, '&amp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}</p>`).join('');
}

function guardNovelWrite(db, bookId, expectedRevision) {
  const managed = db.prepare("SELECT accepted_id FROM memory_manuscript_heads WHERE book_id = ? AND branch_id = 'main' AND accepted_id <> '' LIMIT 1").get(bookId);
  if (!managed) return;
  if (!Number.isInteger(expectedRevision)) fail('VERSION_REQUIRED', 428);
  if (getNovel(db, bookId).revision !== expectedRevision) fail('CONTENT_VERSION_CONFLICT');
}

function invalidateChangedSources(db, bookId) {
  const novel = getNovel(db, bookId);
  const accepted = db.prepare(`SELECT manuscript.* FROM memory_manuscripts manuscript
    JOIN memory_manuscript_heads head ON head.accepted_id = manuscript.id
    WHERE manuscript.book_id = ? AND manuscript.branch_id = 'main'`).all(bookId);
  const changed = [];
  for (const manuscript of accepted) {
    let current;
    try { current = targetContent(novel.state, manuscript.chapter_id, manuscript.scene_id); } catch (_) {}
    if (current && String(current.content || '') === renderManuscript(manuscript.content)) continue;
    const inserted = db.prepare(`INSERT OR IGNORE INTO memory_invalidations
      (book_id, branch_id, manuscript_id, reason, created_at) VALUES (?, 'main', ?, 'SOURCE_EDITED_OUTSIDE_COMMIT', ?)`)
      .run(bookId, manuscript.id, Date.now());
    if (inserted.changes) changed.push(manuscript.id);
  }
  if (changed.length) {
    const version = stateVersion(db, bookId) + 1;
    db.prepare(`INSERT INTO memory_branch_heads VALUES (?, 'main', ?)
      ON CONFLICT(book_id, branch_id) DO UPDATE SET state_version = excluded.state_version`).run(bookId, version);
    const eventId = 'invalidate_' + crypto.randomUUID();
    const payload = JSON.stringify({ manuscriptIds: changed, stateVersion: version });
    db.prepare(`INSERT INTO memory_outbox
      (id, event_id, book_id, branch_id, state_version, projection_type, payload_hash, payload_json, status, created_at, updated_at)
      VALUES (?, ?, ?, 'main', ?, 'causal_debts_and_snapshots', ?, ?, 'queued', ?, ?)`)
      .run('outbox_' + crypto.randomUUID(), eventId, bookId, version, digest(payload), payload, Date.now(), Date.now());
    emitEvent(db, bookId, 'main', eventId, 'SOURCE_INVALIDATED', { manuscriptIds: changed, stateVersion: version });
  }
  return changed;
}

function saveManuscript(db, bookId, actorId, input) {
  if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 2000000) fail('INVALID_MANUSCRIPT', 422);
  if (!Number.isInteger(input.expectedRevision) || !Number.isInteger(input.expectedNovelRevision)) fail('VERSION_REQUIRED', 428);
  const branchId = input.branchId || 'main';
  return transaction(db, () => {
    const novel = getNovel(db, bookId);
    if (novel.revision !== input.expectedNovelRevision) fail('CONTENT_VERSION_CONFLICT');
    const target = targetContent(novel.state, input.chapterId, input.sceneId || '');
    const head = db.prepare(`SELECT * FROM memory_manuscript_heads
      WHERE book_id = ? AND branch_id = ? AND chapter_id = ? AND scene_id = ?`)
      .get(bookId, branchId, input.chapterId, input.sceneId || '');
    if ((head ? head.revision : 0) !== input.expectedRevision) fail('CONTENT_VERSION_CONFLICT');
    const revision = input.expectedRevision + 1;
    const id = `manuscript_${crypto.randomUUID()}`;
    db.prepare('INSERT INTO memory_manuscripts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, bookId, branchId, input.chapterId, input.sceneId || '', revision, input.text,
        digest(input.text), digest(String(target.content || '')), novel.revision,
        configHash(db, bookId, branchId), actorId, Date.now());
    db.prepare(`INSERT INTO memory_manuscript_heads VALUES (?, ?, ?, ?, ?, '', ?)
      ON CONFLICT(book_id, branch_id, chapter_id, scene_id)
      DO UPDATE SET current_id = excluded.current_id, revision = excluded.revision`)
      .run(bookId, branchId, input.chapterId, input.sceneId || '', id, revision);
    emitEvent(db, bookId, branchId, id, 'CANDIDATE_SAVED', { revision });
    return publicManuscript(db.prepare('SELECT * FROM memory_manuscripts WHERE id = ?').get(id));
  });
}

function getManuscript(db, bookId, manuscriptId) {
  const row = db.prepare('SELECT * FROM memory_manuscripts WHERE book_id = ? AND id = ?').get(bookId, manuscriptId);
  if (!row) fail('MANUSCRIPT_NOT_FOUND', 404);
  return row;
}

function sourceBinding(manuscript) {
  return digest([manuscript.id, manuscript.content_hash, manuscript.config_hash,
    manuscript.novel_revision, manuscript.source_hash, manuscript.revision]);
}

function validateSource(db, changeset) {
  const source = db.prepare('SELECT * FROM memory_changeset_sources WHERE changeset_id = ?').get(changeset.id);
  if (!source) return null;
  const manuscript = getManuscript(db, changeset.book_id, source.manuscript_id);
  if (manuscript.branch_id !== changeset.branch_id || manuscript.content_hash !== changeset.candidate_hash ||
      digest(manuscript.content) !== manuscript.content_hash || sourceBinding(manuscript) !== source.binding_hash ||
      JSON.parse(changeset.audit_report_json).sourceBinding !== source.binding_hash) return 'CONTENT_VERSION_CONFLICT';
  const head = db.prepare(`SELECT * FROM memory_manuscript_heads
    WHERE book_id = ? AND branch_id = ? AND chapter_id = ? AND scene_id = ?`)
    .get(manuscript.book_id, manuscript.branch_id, manuscript.chapter_id, manuscript.scene_id);
  if (!head || head.current_id !== manuscript.id) return 'CONTENT_VERSION_CONFLICT';
  const novel = getNovel(db, manuscript.book_id);
  if (novel.revision !== manuscript.novel_revision ||
      digest(String(targetContent(novel.state, manuscript.chapter_id, manuscript.scene_id).content || '')) !== manuscript.source_hash) {
    return 'CONTENT_VERSION_CONFLICT';
  }
  if (configHash(db, manuscript.book_id, manuscript.branch_id) !== manuscript.config_hash) return 'CONFIG_VERSION_CONFLICT';
  return null;
}

function createBoundChangeset(db, bookId, actorId, input) {
  return transaction(db, () => {
    const manuscript = getManuscript(db, bookId, input.manuscriptRevisionId);
    let rewriteReview = null;
    if (input.requireRewriteReview) {
      if (!input.rewriteReviewId) fail('REWRITE_REVIEW_REQUIRED', 428);
      rewriteReview = db.prepare(`SELECT * FROM rewrite_reviews
        WHERE book_id = ? AND branch_id = ? AND id = ?`)
        .get(bookId, manuscript.branch_id, input.rewriteReviewId);
      if (!rewriteReview) fail('REWRITE_REVIEW_REQUIRED', 428);
      if (rewriteReview.manuscript_revision_id !== manuscript.id || rewriteReview.candidate_hash !== manuscript.content_hash) {
        fail('REWRITE_REVIEW_VERSION_CONFLICT');
      }
      if (Number(rewriteReview.passed) !== 1) fail('REWRITE_CONSTRAINTS_FAILED');
    }
    const binding = sourceBinding(manuscript);
    const changeset = require('./memory-system').createChangeset(db, {
      bookId, branchId: manuscript.branch_id, baseStateVersion: stateVersion(db, bookId, manuscript.branch_id),
      candidateHash: manuscript.content_hash, operations: input.operations || [],
      dependencies: input.dependencies || [], riskLevel: 'requires_author_confirmation',
      approvalPolicy: input.approvalPolicy || 'author_owned',
      auditReport: {
        sourceBinding: binding, reviewMode: 'author_review_required', proposedBy: actorId,
        approvalPolicy: input.approvalPolicy || 'author_owned',
        ...(rewriteReview ? { rewriteReviewId: rewriteReview.id, rewriteContractId: rewriteReview.contract_id } : {})
      }
    });
    db.prepare('INSERT INTO memory_changeset_sources VALUES (?, ?, ?)').run(changeset.id, manuscript.id, binding);
    const row = db.prepare('SELECT * FROM memory_changesets WHERE id = ?').get(changeset.id);
    const conflict = validateSource(db, row);
    if (conflict) fail(conflict);
    emitEvent(db, bookId, manuscript.branch_id, changeset.id, 'MEMORY_PENDING_APPROVAL', {
      manuscriptId: manuscript.id, ...(rewriteReview ? { rewriteReviewId: rewriteReview.id } : {})
    });
    return changeset;
  });
}

function extractSavedManuscript(db, bookId, manuscriptId) {
  return transaction(db, () => {
    const manuscript = getManuscript(db, bookId, manuscriptId);
    const previous = db.prepare('SELECT result_json FROM memory_extractions WHERE manuscript_id = ?').get(manuscriptId);
    if (previous) return JSON.parse(previous.result_json);
    const result = require('./memory-system').extractPropositionsAndEvidence(manuscript.content, {
      bookId, branchId: manuscript.branch_id, chapterRevisionId: manuscriptId,
      sceneId: manuscript.scene_id, disclosurePosition: manuscript.chapter_id
    });
    for (const proposition of result.propositions) {
      db.prepare(`INSERT INTO memory_propositions (id, book_id, branch_id, expression_type, display_text, created_at)
        VALUES (?, ?, ?, 'text', ?, ?)`).run(proposition.id, bookId, manuscript.branch_id, proposition.displayText, Date.now());
    }
    for (const evidence of result.evidence) {
      db.prepare(`INSERT INTO memory_evidence (id, book_id, branch_id, proposition_id, source_type, source_entity_id,
        modality, stance, source_anchor_json, story_time_ref, disclosure_position, extraction_confidence, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(evidence.id, bookId, manuscript.branch_id,
        evidence.propositionId, evidence.sourceType, evidence.sourceEntityId, evidence.modality, evidence.stance,
        JSON.stringify(evidence.sourceAnchor), evidence.storyTimeRef, evidence.disclosurePosition, evidence.extractionConfidence, Date.now());
    }
    db.prepare('INSERT INTO memory_extractions VALUES (?, ?, ?)').run(manuscriptId, JSON.stringify(result), Date.now());
    emitEvent(db, bookId, manuscript.branch_id, manuscriptId, 'MEMORY_EXTRACTED', { count: result.evidence.length });
    return result;
  });
}

function acceptManuscript(db, changeset) {
  const source = db.prepare('SELECT manuscript_id FROM memory_changeset_sources WHERE changeset_id = ?').get(changeset.id);
  if (!source) return {};
  const manuscript = getManuscript(db, changeset.book_id, source.manuscript_id);
  const novel = getNovel(db, changeset.book_id);
  const target = targetContent(novel.state, manuscript.chapter_id, manuscript.scene_id);
  if (manuscript.branch_id === 'main') {
    target.content = renderManuscript(manuscript.content);
    const stateJson = JSON.stringify(novel.state);
    const wordCount = (novel.state.volumes || []).flatMap(volume => volume.chapters || [])
      .flatMap(chapter => chapter.scenes || [chapter])
      .reduce((count, scene) => count + String(scene.content || '').replace(/<[^>]*>/g, '').replace(/\s/g, '').length, 0);
    const saved = db.prepare('UPDATE novels SET state_json = ?, revision = revision + 1, word_count = ?, updated_at = ? WHERE id = ? AND revision = ?')
      .run(stateJson, wordCount, Date.now(), changeset.book_id, manuscript.novel_revision);
    if (saved.changes !== 1) fail('CONTENT_VERSION_CONFLICT');
  }
  const previous = db.prepare(`SELECT accepted_id FROM memory_manuscript_heads
    WHERE book_id = ? AND branch_id = ? AND chapter_id = ? AND scene_id = ?`)
    .get(changeset.book_id, manuscript.branch_id, manuscript.chapter_id, manuscript.scene_id);
  if (previous.accepted_id && previous.accepted_id !== manuscript.id) {
    db.prepare(`INSERT OR IGNORE INTO memory_invalidations (book_id, branch_id, manuscript_id, reason, created_at)
      VALUES (?, ?, ?, 'SOURCE_REVISED', ?)`).run(changeset.book_id, manuscript.branch_id, previous.accepted_id, Date.now());
  }
  db.prepare(`UPDATE memory_manuscript_heads SET accepted_id = ?
    WHERE book_id = ? AND branch_id = ? AND chapter_id = ? AND scene_id = ?`)
    .run(manuscript.id, changeset.book_id, manuscript.branch_id, manuscript.chapter_id, manuscript.scene_id);
  emitEvent(db, changeset.book_id, manuscript.branch_id, changeset.id, 'MANUSCRIPT_COMMITTED', { manuscriptId: manuscript.id });
  return { manuscriptRevisionId: manuscript.id, manuscriptHash: manuscript.content_hash,
    novelRevision: novel.revision + (manuscript.branch_id === 'main' ? 1 : 0) };
}

function projectionPayload(db, bookId, branchId) {
  const tables = ['world_fact_decisions', 'character_cognition', 'story_events', 'state_transitions',
    'story_plans', 'conditional_commitments', 'story_foreshadows', 'temporal_relations'];
  const payload = {};
  for (const table of tables) payload[table] = db.prepare(`SELECT * FROM ${table} WHERE book_id = ? AND branch_id = ? ORDER BY id`).all(bookId, branchId);
  payload.manuscripts = db.prepare(`SELECT chapter_id, scene_id, accepted_id FROM memory_manuscript_heads
    WHERE book_id = ? AND branch_id = ? AND accepted_id <> '' ORDER BY chapter_id, scene_id`).all(bookId, branchId);
  payload.invalidations = db.prepare('SELECT manuscript_id, reason FROM memory_invalidations WHERE book_id = ? AND branch_id = ? ORDER BY id').all(bookId, branchId);
  return payload;
}

function verifyProjections(db, bookId, branchId = 'main') {
  const version = stateVersion(db, bookId, branchId);
  const snapshot = db.prepare('SELECT * FROM memory_projection_snapshots WHERE book_id = ? AND branch_id = ?').get(bookId, branchId);
  const pending = db.prepare(`SELECT count(*) AS count FROM memory_outbox
    WHERE book_id = ? AND branch_id = ? AND status IN ('queued', 'processing')`).get(bookId, branchId).count;
  const failed = db.prepare("SELECT count(*) AS count FROM memory_outbox WHERE book_id = ? AND branch_id = ? AND status = 'failed'").get(bookId, branchId).count;
  let status = snapshot && snapshot.state_version === version ? 'SYNCED' : 'PENDING_PROJECTION';
  if (failed) status = 'PROJECTION_FAILED';
  if (snapshot && (digest(snapshot.payload_json) !== snapshot.payload_hash || snapshot.schema_version !== 1 ||
      (snapshot.state_version === version && digest(projectionPayload(db, bookId, branchId)) !== snapshot.payload_hash))) status = 'PROJECTION_DRIFT';
  return { bookId, branchId, status, synced: status === 'SYNCED', expectedStateVersion: version,
    projectedStateVersion: snapshot ? snapshot.state_version : null, pendingOutboxCount: pending, failedOutboxCount: failed, verifiedAt: Date.now() };
}

function processProjections(db, bookId, branchId = 'main') {
  return transaction(db, () => {
    const status = verifyProjections(db, bookId, branchId);
    if (status.status === 'PROJECTION_DRIFT') return status;
    const jobs = db.prepare("SELECT * FROM memory_outbox WHERE book_id = ? AND branch_id = ? AND status IN ('queued', 'failed') ORDER BY state_version, created_at")
      .all(bookId, branchId);
    for (const job of jobs) {
      if (digest(job.payload_json) !== job.payload_hash || job.state_version > status.expectedStateVersion || job.attempt_count >= 5) {
        db.prepare("UPDATE memory_outbox SET status = 'failed', last_error = 'PROJECTION_PAYLOAD_INVALID_OR_RETRY_LIMIT', updated_at = ? WHERE id = ?")
          .run(Date.now(), job.id);
        return verifyProjections(db, bookId, branchId);
      }
    }
    const payload = JSON.stringify(projectionPayload(db, bookId, branchId));
    db.prepare(`INSERT INTO memory_projection_snapshots VALUES (?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(book_id, branch_id) DO UPDATE SET state_version = excluded.state_version,
      schema_version = 1, payload_hash = excluded.payload_hash, payload_json = excluded.payload_json, updated_at = excluded.updated_at
      WHERE memory_projection_snapshots.state_version <= excluded.state_version`)
      .run(bookId, branchId, status.expectedStateVersion, digest(payload), payload, Date.now());
    for (const job of jobs) {
      db.prepare("UPDATE memory_outbox SET status = 'completed', attempt_count = attempt_count + 1, last_error = '', updated_at = ? WHERE id = ?")
        .run(Date.now(), job.id);
      emitEvent(db, bookId, branchId, job.event_id, 'PROJECTION_SYNCED', { stateVersion: status.expectedStateVersion });
    }
    return verifyProjections(db, bookId, branchId);
  });
}

function workbenchState(db, bookId, branchId = 'main') {
  const novel = getNovel(db, bookId);
  const chapters = (novel.state.volumes || []).flatMap(volume => (volume.chapters || []).flatMap(chapter =>
    (chapter.scenes && chapter.scenes.length ? chapter.scenes : [chapter]).map(scene => ({
      chapterId: chapter.id, sceneId: scene === chapter ? '' : scene.id,
      title: [volume.title, chapter.title, scene === chapter ? '' : scene.name || scene.title].filter(Boolean).join(' / '),
      content: String(scene.content || '')
    }))));
  return {
    bookId, branchId, title: novel.state.title, novelRevision: novel.revision,
    stateVersion: stateVersion(db, bookId, branchId), chapters,
    manuscripts: db.prepare(`SELECT manuscript.* FROM memory_manuscripts manuscript
      JOIN memory_manuscript_heads head ON head.current_id = manuscript.id
      WHERE manuscript.book_id = ? AND manuscript.branch_id = ? ORDER BY manuscript.created_at DESC`)
      .all(bookId, branchId).map(publicManuscript),
    changesets: db.prepare(`SELECT id, candidate_hash, approval_status, base_state_version, committed_at, created_at
      FROM memory_changesets WHERE book_id = ? AND branch_id = ? ORDER BY created_at DESC LIMIT 100`).all(bookId, branchId),
    projections: verifyProjections(db, bookId, branchId),
    invalidations: db.prepare('SELECT * FROM memory_invalidations WHERE book_id = ? AND branch_id = ? ORDER BY id DESC LIMIT 100').all(bookId, branchId)
  };
}

module.exports = { initializeSchema, stateVersion, emitEvent, saveManuscript, getManuscript, publicManuscript,
  createBoundChangeset, extractSavedManuscript, validateSource, acceptManuscript, projectionPayload,
  verifyProjections, processProjections, workbenchState, transaction, fail, digest, configHash,
  guardNovelWrite, invalidateChangedSources };
