'use strict';

const crypto = require('node:crypto');
const { GenerationError } = require('./errors');
const projectResources = require('../project-resources');
const { validateCommitAudit, saveCommitReceipt, finishCommitReceipt } = require('../benchmark-commit');
const { deriveGenerationCommitProjection } = require('./commit-projection');
const { validateGenerationAuditEvidence } = require('./audit-evidence');

function fail(code, message, status = 409) {
  throw new GenerationError(code, message, { status });
}

function parseJson(value, fallback = {}) {
  try { return JSON.parse(String(value || '')); } catch (_) { return fallback; }
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function commitSqliteChapter(db, input = {}) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('SQLite 数据库不可用');
  const run = input.run || {};
  const request = input.request || {};
  const result = run.result || {};
  const submitted = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
    ? input.payload : {};
  const payload = submitted.payload && typeof submitted.payload === 'object' && !Array.isArray(submitted.payload)
    ? { ...submitted, ...submitted.payload } : submitted;
  const bookId = String(request.creationBookId || '').trim();
  const projectId = String(run.projectId || '');
  const workspaceId = String(run.workspaceId || '');
  const actorUserId = String(input.actorUserId || run.actorUserId || '');
  const content = String(input.text || '');
  const contentHash = sha256(content);
  const chapterMatch = String(request.chapterId || '').match(/(\d+)/);
  const chapterNo = Math.max(1, Number(result.contract && result.contract.chapterNo || chapterMatch && chapterMatch[1]) || 1);
  const baseStateRaw = payload.baseStateVersion ?? (request.storyContext && (request.storyContext.stateVersion ?? request.storyContext.baseRevision));
  const baseStateVersion = Number(baseStateRaw);
  const expectedProjectRevision = Number(payload.expectedRevision ?? (request.storyContext && request.storyContext.baseRevision));
  const sceneId = String(request.sceneId || '');
  const chapterId = String(request.chapterId || '');
  const novelId = String(request.novelId || projectId);

  if (!bookId) fail('STATE_CONFLICT', '生成请求缺少 creationBookId，不能写入正式章节');
  if (!content.trim() || contentHash !== String(result.outputHash || '')) fail('STATE_CONFLICT', '提交正文摘要与审计版本不一致');
  if (payload.content != null && String(payload.content) !== content) fail('STATE_CONFLICT', '提交正文与 payload.content 不一致');
  if (payload.projectId && String(payload.projectId) !== projectId) fail('STATE_CONFLICT', '提交项目与生成任务不一致');
  if (payload.chapterId && request.chapterId && String(payload.chapterId) !== String(request.chapterId)) fail('STATE_CONFLICT', '提交章节与生成任务不一致');
  if (payload.sceneId && request.sceneId && String(payload.sceneId) !== String(request.sceneId)) fail('STATE_CONFLICT', '提交场景与生成任务不一致');
  if (!Number.isInteger(baseStateVersion) || baseStateVersion < 0) fail('STATE_CONFLICT', '提交必须提供有效的 baseStateVersion');
  if (!Number.isInteger(expectedProjectRevision) || expectedProjectRevision < 0) fail('STATE_CONFLICT', '提交必须提供已读取的作品 revision');
  const requestedStateVersion = Number(request.storyContext && (request.storyContext.stateVersion ?? request.storyContext.baseStateVersion));
  const requestedProjectRevision = Number(request.storyContext && request.storyContext.baseRevision);
  if (!Number.isInteger(requestedStateVersion) || requestedStateVersion !== baseStateVersion ||
      !Number.isInteger(requestedProjectRevision) || requestedProjectRevision !== expectedProjectRevision) {
    fail('STATE_CONFLICT', '提交基线与生成时读取的作品状态不一致');
  }
  const knownBaseHash = String(request.storyContext && request.storyContext.baseHash || '');
  if (payload.baseHash && knownBaseHash && String(payload.baseHash) !== knownBaseHash) {
    fail('STATE_CONFLICT', '提交场景正文与生成时读取的基线不一致');
  }

  const deterministic = result.audit || result.deterministicAudit || {};
  const semantic = result.semanticAudit || {};
  const semanticEvidence = semantic.audit || {};
  const quality = result.quality || {};
  const pipelineStatus = String(result.benchmark && result.benchmark.status || '');
  const audited = deterministic.passed === true && semantic.passed === true && semanticEvidence.passed === true &&
    quality.passed === true && quality.qualityVector && typeof quality.qualityVector === 'object' &&
    Object.keys(quality.qualityVector).length > 0 && (!pipelineStatus || pipelineStatus === 'passed');
  if (!audited) fail('AUDIT_BLOCKED', '生成正文尚未通过服务端审计，不能正式提交');
  const evidenceCheck = validateGenerationAuditEvidence({
    generationId: run.id, chapterNo, content, contentHash, result
  });
  if (!evidenceCheck.ok) fail('AUDIT_BLOCKED', evidenceCheck.message);

  const creationContract = result.contract || request.chapterContract || request.contract || {};
  const now = Date.now();
  const snapshotId = `snap_${bookId}_${chapterNo}_${baseStateVersion + 1}`;
  const auditId = `cca_generation_${String(run.id || '').replace(/[^A-Za-z0-9_]/g, '_')}`;
  let book;
  let nextStateVersion;
  let nextProjectRevision;
  let auditPayload;
  let projection;
  let receipt;
  let access;

  db.exec('BEGIN IMMEDIATE');
  try {
    const existingReceipt = db.prepare('SELECT * FROM benchmark_commit_receipts WHERE book_id = ? AND chapter_no = ?')
      .get(bookId, chapterNo);
    if (existingReceipt) {
      if (String(existingReceipt.content_hash) !== contentHash) fail('STATE_CONFLICT', '该章节已提交不同正文', 409);
      db.exec('COMMIT');
      const debtStatus = finishCommitReceipt(db, existingReceipt, input.recordDebts || (() => {}));
      return {
        committed: true, idempotent: true, snapshotId: existingReceipt.snapshot_id,
        stateVersion: Number(existingReceipt.state_version), currentStateVersion: Number(existingReceipt.state_version),
        chapterNo, contentHash, debtStatus
      };
    }

    book = db.prepare(`SELECT * FROM creation_books
      WHERE id = ? AND project_id = ? AND workspace_id = ?`).get(bookId, projectId, workspaceId);
    if (!book) fail('STATE_CONFLICT', '创作书与生成任务项目不匹配', 409);
    const bookOwner = String(book.owner_user_id || '');
    if (actorUserId && bookOwner && bookOwner !== actorUserId) {
      const projectAccess = input.projectAccess;
      if (!projectAccess || !projectResources.canMutate(projectAccess, 'manuscript')) {
        fail('STATE_CONFLICT', '当前账户无权提交此创作书', 403);
      }
    }
    access = input.projectAccess;
    if (!access || !projectResources.canMutate(access, 'manuscript')) fail('STATE_CONFLICT', '当前账户无权修改项目章节', 403);

    const baseChapterNo = Number(book.current_chapter_no) || 0;
    const currentStateVersion = Number(book.current_state_version) || 0;
    if (chapterNo !== baseChapterNo + 1 || currentStateVersion !== baseStateVersion) {
      fail('STATE_CONFLICT', '章节或故事状态版本已变化，请重新读取后提交', 409);
    }

    const novel = db.prepare(`SELECT state_json, revision FROM novels
      WHERE id = ? AND workspace_id = ? AND project_id = ?`).get(novelId, workspaceId, projectId);
    if (!novel) fail('STATE_CONFLICT', '作品状态不存在，不能提交章节', 409);
    const projectRevision = Number(novel.revision) || 0;
    if (projectRevision !== expectedProjectRevision) fail('STATE_CONFLICT', '作品 revision 已变化，请重新读取后提交', 409);

    const bibleRow = db.prepare(`SELECT b.id AS bible_id, v.version, v.payload_json
      FROM creation_bibles b JOIN creation_bible_versions v ON v.bible_id = b.id
      WHERE b.book_id = ? ORDER BY v.version DESC LIMIT 1`).get(bookId);
    if (!bibleRow) fail('STATE_CONFLICT', '创作圣经不存在，不能提交章节', 409);
    const bibleVersion = Number(bibleRow.version) || 1;
    if (payload.bibleVersion != null && Number(payload.bibleVersion) !== bibleVersion) fail('STATE_CONFLICT', '创作圣经版本已变化，请重新审计', 409);
    if (payload.stateVersion != null && Number(payload.stateVersion) !== currentStateVersion) fail('STATE_CONFLICT', '审计故事状态版本已过期', 409);

    const previousRow = db.prepare(`SELECT character_states_json, relationship_states_json, world_states_json,
        timeline_json, open_foreshadows_json, recent_facts_json, outline_impact_json
      FROM creation_state_snapshots
      WHERE book_id = ? AND state_version <= ?
      ORDER BY state_version DESC LIMIT 1`).get(bookId, currentStateVersion);
    const previousSnapshot = previousRow ? {
      characterStates: parseJson(previousRow.character_states_json),
      relationshipStates: parseJson(previousRow.relationship_states_json),
      worldStates: parseJson(previousRow.world_states_json),
      timeline: parseJson(previousRow.timeline_json, []),
      openForeshadows: parseJson(previousRow.open_foreshadows_json, []),
      recentFacts: parseJson(previousRow.recent_facts_json, []),
      outlineImpact: parseJson(previousRow.outline_impact_json)
    } : {};
    projection = deriveGenerationCommitProjection({ result, text: content, previousSnapshot, chapterNo });

    const audit = {
      ...evidenceCheck.evidence,
      protocol: 'generation-v2-audit-v1',
      factLedgerDelta: projection.factLedgerDelta,
      projection: {
        characterStates: projection.characterStates,
        relationshipStates: projection.relationshipStates,
        worldStates: projection.worldStates,
        timeline: projection.timeline,
        openForeshadows: projection.openForeshadows,
        recentFacts: projection.recentFacts,
        causalDebts: projection.causalDebts,
        outlineImpact: projection.outlineImpact
      }
    };
    auditPayload = audit;
    const auditRecord = {
      content_hash: contentHash,
      passed: 1,
      quality_gate: 'passed',
      originality_status: 'passed',
      blocker_count: 0,
      result_json: JSON.stringify(audit)
    };
    const checkedAudit = validateCommitAudit(auditRecord, { content, contentHash });
    if (!checkedAudit.ok) fail('AUDIT_BLOCKED', '服务端审计证据与提交正文不一致');

    const biblePayload = parseJson(bibleRow.payload_json, {});
    const creationPlan = biblePayload && biblePayload.creationPlan || {};
    const planHash = sha256(JSON.stringify(creationPlan));
    if (payload.planHash && String(payload.planHash) !== planHash) fail('STATE_CONFLICT', '章节规划已变化，请重新审计', 409);
    const nextBibleVersion = bibleVersion;
    nextStateVersion = currentStateVersion + 1;
    nextProjectRevision = projectRevision + 1;
    const actualCost = Math.max(0, Number(run.actualCostMinor) || 0) / 100;
    const budgetLimit = Math.max(0, Number(book.budget_limit) || 0);
    const spentCost = Math.max(0, Number(book.spent_cost) || 0);
    if (budgetLimit > 0 && spentCost + actualCost > budgetLimit + 1e-9) fail('BUDGET_EXCEEDED', '本次提交会超过创作预算', 402);

    db.prepare(`INSERT INTO creation_chapter_audits
      (id,book_id,user_email,chapter_no,content_hash,passed,quality_gate,originality_status,blocker_count,
       audit_credit_cost,result_json,created_at,bible_version,state_version,context_hash,delta_hash,plan_hash,
       actor_user_id,workspace_id,project_id)
      VALUES (?,?,?,?,?,1,'passed','passed',0,0,?,?,?,?,?,?,?,?,?,?)`)
      .run(auditId, bookId, String(input.userEmail || book.user_email || ''), chapterNo, contentHash,
        JSON.stringify(audit), now, nextBibleVersion, currentStateVersion,
        String(payload.contextHash || result.contextHash || ''), String(payload.deltaHash || ''), planHash,
        actorUserId, workspaceId, projectId);

    if (sceneId) {
      const state = JSON.parse(String(novel.state_json || '{}'));
      const located = require('./scene-patch').locateScene(state, chapterId, sceneId);
      if (!located) fail('STATE_CONFLICT', '作品中的章节或场景不存在，无法写入正文', 409);
      const currentText = String(located.scene.content == null ? '' : located.scene.content);
      if (!knownBaseHash || require('./scene-patch').hashSceneText(currentText) !== knownBaseHash) {
        fail('STATE_CONFLICT', '场景基线正文已变化，请重新读取后提交', 409);
      }
      if (typeof input.guardNovelWrite === 'function') input.guardNovelWrite(novelId, expectedProjectRevision);
      located.scene.content = content;
      const sanitizedState = typeof input.sanitizeNovelState === 'function' ? input.sanitizeNovelState(state) : state;
      const nextState = JSON.stringify(sanitizedState);
      const maxStateBytes = Math.max(1024, Number(input.maxNovelStateBytes) || 8 * 1024 * 1024);
      if (Buffer.byteLength(nextState, 'utf8') > maxStateBytes) fail('CONTEXT_OVERFLOW', '作品状态超过存储上限', 413);
      const updateNovel = db.prepare(`UPDATE novels SET state_json = ?, word_count = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND workspace_id = ? AND project_id = ? AND revision = ?`)
        .run(nextState, typeof input.calcWordCount === 'function' ? input.calcWordCount(sanitizedState) : content.length,
          now, novelId, workspaceId, projectId, expectedProjectRevision);
      if (Number(updateNovel.changes || 0) !== 1) fail('STATE_CONFLICT', '作品 revision 已变化，请重新读取后提交', 409);
      if (typeof input.invalidateChangedSources === 'function') input.invalidateChangedSources(novelId);
    } else {
      const updateNovel = db.prepare(`UPDATE novels SET updated_at = ?, revision = revision + 1
        WHERE id = ? AND workspace_id = ? AND project_id = ? AND revision = ?`)
        .run(now, novelId, workspaceId, projectId, expectedProjectRevision);
      if (Number(updateNovel.changes || 0) !== 1) fail('STATE_CONFLICT', '作品 revision 已变化，请重新读取后提交', 409);
    }

    const manuscriptId = `manuscript:${bookId}:chapter:${chapterNo}`;
    const currentManuscript = db.prepare(`SELECT * FROM project_resources
      WHERE workspace_id = ? AND project_id = ? AND kind = 'manuscript' AND id = ?`).get(workspaceId, projectId, manuscriptId);
    const manuscriptRevision = currentManuscript ? Number(currentManuscript.revision) + 1 : 1;
    const manuscriptPayload = projectResources.normalizePayload({
      title: String(payload.title || creationContract.title || `第${chapterNo}章`),
      kind: 'chapter', chapterId: chapterId || manuscriptId,
      continuityId: 'main', canonApplicability: 'canon', numberingPolicy: 'sequential',
      text: content, hash: contentHash, status: 'committed', revision: manuscriptRevision,
      creationBookId: bookId, stateVersion: nextStateVersion
    }, access, 'manuscript');
    projectResources.validateResourceReferences(db, access, manuscriptPayload, 'manuscript');
    const serializedManuscript = JSON.stringify(manuscriptPayload);
    if (currentManuscript) {
      const updated = db.prepare(`UPDATE project_resources SET payload_json = ?, revision = ?, status = 'active', deleted_at = NULL, updated_at = ?
        WHERE workspace_id = ? AND project_id = ? AND id = ? AND kind = 'manuscript' AND revision = ?`)
        .run(serializedManuscript, manuscriptRevision, now, workspaceId, projectId, manuscriptId, Number(currentManuscript.revision));
      if (Number(updated.changes || 0) !== 1) fail('STATE_CONFLICT', '章节资料版本已变化，请重新读取后提交', 409);
    } else {
      db.prepare(`INSERT INTO project_resources
        (workspace_id,project_id,id,kind,payload_json,revision,status,created_by,created_at,updated_at)
        VALUES (?,?,?,'manuscript',?,1,'active',?,?,?)`)
        .run(workspaceId, projectId, manuscriptId, serializedManuscript, actorUserId, now, now);
    }
    db.prepare(`INSERT INTO project_resource_versions
      (workspace_id,project_id,resource_id,revision,payload_json,changed_by,change_reason,created_at)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(workspaceId, projectId, manuscriptId, manuscriptRevision, serializedManuscript, actorUserId, 'Generation V2 章节提交', now);

    db.prepare(`INSERT INTO creation_state_snapshots
      (id,book_id,chapter_no,bible_version,state_version,character_states_json,relationship_states_json,
       world_states_json,timeline_json,open_foreshadows_json,recent_facts_json,outline_impact_json,content_ref,content_hash,
       audit_status,created_at,actor_user_id,workspace_id,project_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'passed',?,?,?,?)`)
      .run(snapshotId, bookId, chapterNo, bibleVersion, nextStateVersion,
        JSON.stringify(projection.characterStates), JSON.stringify(projection.relationshipStates),
        JSON.stringify(projection.worldStates), JSON.stringify(projection.timeline),
        JSON.stringify(projection.openForeshadows), JSON.stringify(projection.recentFacts),
        JSON.stringify(projection.outlineImpact),
        String(payload.contentRef || '').slice(0, 500), contentHash, now, actorUserId, workspaceId, projectId);

    const updateBook = db.prepare(`UPDATE creation_books
      SET current_state_version = ?, current_chapter_no = ?, spent_cost = spent_cost + ?, updated_at = ?
      WHERE id = ? AND workspace_id = ? AND project_id = ? AND current_state_version = ? AND current_chapter_no = ?`)
      .run(nextStateVersion, chapterNo, actualCost, now, bookId, workspaceId, projectId, baseStateVersion, baseChapterNo);
    if (Number(updateBook.changes || 0) !== 1) fail('STATE_CONFLICT', '创作状态已更新，请重新读取后提交', 409);

    saveCommitReceipt(db, {
      snapshotId, bookId, chapterNo, stateVersion: nextStateVersion,
      contentHash, content, ledgerDelta: projection.factLedgerDelta
    });
    if (run.id && run.fencingToken != null) {
      const storedRun = db.prepare(`SELECT result_json, state, lease_owner, fencing_token, lease_until
        FROM generation_runs WHERE id = ? AND project_id = ? AND actor_user_id = ?
          AND (? = '' OR workspace_id = ?)`)
        .get(String(run.id), projectId, actorUserId, workspaceId, workspaceId);
      if (!storedRun || storedRun.state !== 'committing' || String(storedRun.lease_owner || '') !== String(run.leaseOwner || '') ||
          Number(storedRun.fencing_token) !== Number(run.fencingToken) || Number(storedRun.lease_until) <= now) {
        fail('STATE_CONFLICT', 'Generation Run 提交租约已变化', 409);
      }
      const storedResult = parseJson(storedRun.result_json, {});
      const commitReceipt = {
        committed: true, snapshotId, stateVersion: nextStateVersion, currentStateVersion: nextStateVersion,
        chapterNo, contentHash, projectRevision: nextProjectRevision
      };
      const updatedRun = db.prepare(`UPDATE generation_runs SET result_json = ?, updated_at = ?
        WHERE id = ? AND state = 'committing' AND lease_owner = ? AND fencing_token = ? AND lease_until > ?`)
        .run(JSON.stringify({ ...storedResult, commitReceipt }), now, String(run.id), String(run.leaseOwner || ''), Number(run.fencingToken), now);
      if (Number(updatedRun.changes || 0) !== 1) fail('STATE_CONFLICT', 'Generation Run 提交租约已变化', 409);
    }
    db.prepare('UPDATE novel_projects SET updated_at = ? WHERE workspace_id = ? AND project_id = ?')
      .run(now, workspaceId, projectId);
    db.exec('COMMIT');
    receipt = db.prepare('SELECT * FROM benchmark_commit_receipts WHERE snapshot_id = ?').get(snapshotId);
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }

  const debtStatus = finishCommitReceipt(db, receipt, input.recordDebts || (() => {}));
  return {
    committed: true, idempotent: false, snapshotId, stateVersion: nextStateVersion,
    currentStateVersion: nextStateVersion, chapterNo, contentHash,
    projectRevision: nextProjectRevision, spentCost: (Number(book.spent_cost) || 0) + Math.max(0, Number(run.actualCostMinor) || 0) / 100,
    debtStatus
  };
}

module.exports = { commitSqliteChapter };
