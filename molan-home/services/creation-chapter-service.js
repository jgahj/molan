'use strict';

const benchmarkCommit = require('../lib/benchmark-commit');
const { buildCreationQualityReport } = require('../lib/creation-quality-report');

const SETTLED_BILLING_STATUSES = new Set(['exact', 'settled']);

function createCreationChapterService(dependencies) {
  const {
    benchmarkPipeline,
    canSpendCreationBook,
    callMolanChat,
    checkForbiddenTerms,
    computeRetentionCompliance,
    computeStructuralSimilarity,
    creationBibleForBook,
    creationForbiddenTerms,
    creationOriginalityGate,
    currentDefaultModel,
    dbReady,
    deterministicContractValidation,
    evaluateSomaticGate,
    getAuthUser,
    getDatabase,
    getUserByEmail,
    json,
    loadCreationBookForAuth,
    loadCreationSnapshots,
    loadCurrentBiblePayload,
    projectScope,
    readBody,
    recordChapterCausalDebts,
    resolveModelForUser,
    runGenreNarrativeAudits,
    sha256Text,
    logger
  } = dependencies;

  function settledProviderCreditCost(usage) {
    const creditCost = usage && usage.creditCost;
    const status = String(usage && usage.billingStatus || '').toLowerCase();
    if (typeof creditCost !== 'number' || !Number.isFinite(creditCost) || creditCost < 0 || !SETTLED_BILLING_STATUSES.has(status)) return null;
    return creditCost;
  }

  function isRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  function hasFactLedgerDelta(value) {
    return isRecord(value) &&
      Array.isArray(value.newRules) &&
      Array.isArray(value.newPromises) &&
      Array.isArray(value.updates) &&
      isRecord(value.byEntity) &&
      Object.values(value.byEntity).every(Array.isArray);
  }

  function hasCompleteSemanticEvidence(audit, content) {
    return isRecord(audit) && audit.passed === true && audit.status === 'passed' &&
      Array.isArray(audit.incompleteReasons) && audit.incompleteReasons.length === 0 &&
      String(audit.contentHash || '') === sha256Text(content) &&
      hasFactLedgerDelta(audit.factLedgerDelta);
  }

  async function handleCreationBookChapterAudit(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const book = loadCreationBookForAuth(id, auth, projectScope.WRITE_ROLES);
    if (!book) return json(res, 404, { error: '创作书不存在或无权访问' });
    if (!canSpendCreationBook(book, auth)) return json(res, 403, { error: '当前账户没有该创作书的生成额度权限', code: 'spend_forbidden' });
    let body = {}; try { body = await readBody(req).catch(() => ({})); } catch (_) {}
    const content = String(body.content || '');
    const chapterNo = Math.max(1, Number(body.chapterNo) || 1);
    const current = creationBibleForBook(book.id);
    const database = getDatabase();
    const issues = [];
    if (!content.trim()) issues.push({ severity: 'blocker', category: 'content', description: '正文为空', suggestion: '生成正文后再提交' });
    else if (content.replace(/\s/g, '').length < 300) issues.push({ severity: 'blocker', category: 'content', description: '正文少于 300 字', suggestion: '补充完整场景' });
    const forbiddenIssues = checkForbiddenTerms(content, creationForbiddenTerms(current.payload));
    issues.push(...forbiddenIssues);
    const contract = body.contract && typeof body.contract === 'object' ? body.contract : {};
    const contractValidation = deterministicContractValidation({ chapterNo, ...contract });
    contractValidation.findings.forEach(item => issues.push({ severity: item.severity, category: 'contract', description: item.description, suggestion: '修订章节合同或正文' }));
    const targetWords = Number(current.payload && current.payload.taskConstraints && current.payload.taskConstraints.chapterWordTarget) || 2000;
    const actualWords = content.replace(/\s/g, '').length;
    if (actualWords > 0 && (actualWords < targetWords * 0.7 || actualWords > targetWords * 1.3)) {
      issues.push({ severity: 'warning', category: 'pacing', description: '字数 ' + actualWords + ' 偏离目标 ' + targetWords + ' 超过 ±30%', suggestion: actualWords > targetWords ? '删减过渡句与重复状态描写，压缩至 ' + Math.round(targetWords * 0.9) + '-' + Math.round(targetWords * 1.1) + ' 字' : '补充场景细节至 ' + Math.round(targetWords * 0.9) + '-' + Math.round(targetWords * 1.1) + ' 字' });
    }
    {
      const paras = content.split(/\n+/).map(p => p.trim()).filter(p => p.length >= 12);
      const seenPrefix = new Map();
      const dupParas = [];
      paras.forEach((p, idx) => {
        const key = p.slice(0, 20);
        if (seenPrefix.has(key)) dupParas.push({ first: seenPrefix.get(key), second: idx + 1, text: key });
        else seenPrefix.set(key, idx + 1);
      });
      if (dupParas.length) {
        issues.push({ severity: 'blocker', category: 'redundancy', description: '发现 ' + dupParas.length + ' 处疑似重复段落（如「' + (dupParas[0].text || '') + '…」）', suggestion: '删除重复段落，只保留首处并合并差异信息' });
      }
      const sentences = content.split(/(?<=[。！？])/u).map(x => x.trim()).filter(x => x.length >= 15);
      const sentCount = new Map();
      sentences.forEach(x => { const k = x.slice(0, 18); sentCount.set(k, (sentCount.get(k) || 0) + 1); });
      const repeatedSentences = [...sentCount.entries()].filter(([k, n]) => n >= 3);
      if (repeatedSentences.length) {
        issues.push({ severity: 'warning', category: 'redundancy', description: repeatedSentences.length + ' 个句子/状态短语重复出现 3 次以上（如「' + repeatedSentences[0][0] + '…」），疑似状态复述', suggestion: '状态首次详写，后续只写变化量' });
      }
    }
    const somaticGate = evaluateSomaticGate(content, contract);
    if (somaticGate.issue) issues.push({ ...somaticGate.issue, severity: 'warning', heuristicOnly: true });
    const genreAudits = runGenreNarrativeAudits(content, contract, String(body.genre || current.payload.genre || ''));
    if (genreAudits.issues && genreAudits.issues.length) {
      issues.push(...genreAudits.issues.map(item => ({ ...item, heuristicOnly: true })));
    }
    const user = getUserByEmail(auth.user.email) || { email: auth.user.email };
    const creationModelId = resolveModelForUser(user, body.modelId || currentDefaultModel());
    const factLedger = body.factLedger && typeof body.factLedger === 'object' && !Array.isArray(body.factLedger) ? body.factLedger : null;
    const semanticAudit = await benchmarkPipeline.evidenceAudit({
      callModel: (_auth, options) => callMolanChat(String(req.headers.authorization || ''), user, { ...options, requireComplete: true })
    }, auth, {
      text: content, contract, factLedger, modelId: creationModelId, targetWords,
      genre: String(body.genre || current.payload.genre || ''),
      continuity: {
        premise: current.payload.bookPremise,
        worldRules: current.payload.worldRules || [],
        characters: (current.payload.characters || []).filter(item => content.includes(String(item.name || '')) || String(contract.viewpoint || '').includes(String(item.name || ''))),
        relationships: current.payload.relationships || [],
        goldenFinger: current.payload.goldenFinger,
        openForeshadows: (current.payload.foreshadowLedger || []).filter(item => item && !['paid', 'resolved'].includes(item.status)),
        previousSnapshots: loadCreationSnapshots(book.id, 0).slice(0, 2)
      }
    });
    const auditOutput = { json: semanticAudit, usage: semanticAudit && semanticAudit.usage || null };
    const auditUsage = auditOutput.usage || null;
    const auditCreditCost = settledProviderCreditCost(auditUsage);
    const modelAudit = isRecord(semanticAudit) ? semanticAudit : {};
    const semanticIssues = Array.isArray(modelAudit.issues) ? modelAudit.issues : [];
    issues.push(...semanticIssues.map(item => ({ ...item, description: item.problem, suggestion: item.fixHint })));
    if (modelAudit.status === 'incomplete' || !hasCompleteSemanticEvidence(modelAudit, content)) {
      if (modelAudit.status === 'incomplete') issues.push({ severity: 'blocker', category: 'review_coverage', description: '语义审计未完成：' + (Array.isArray(modelAudit.incompleteReasons) ? modelAudit.incompleteReasons.join('、') : '') });
    }
    const snapshots = loadCreationSnapshots(book.id, 0).slice(0, 200);
    const structuralSimilarity = computeStructuralSimilarity(current.payload, snapshots);
    if (structuralSimilarity.blocked) {
      issues.push({ severity: 'blocker', category: 'originality', metric: 'structural', eventChainLcsRatio: structuralSimilarity.eventChainLcsRatio, functionSetJaccard: structuralSimilarity.functionSetJaccard, description: '结构级相似度过高（事件链 LCS ' + (structuralSimilarity.eventChainLcsRatio == null ? 'N/A' : structuralSimilarity.eventChainLcsRatio.toFixed(2)) + ' / 功能集合 Jaccard ' + (structuralSimilarity.functionSetJaccard == null ? 'N/A' : structuralSimilarity.functionSetJaccard.toFixed(2)) + '），疑似结构级抄袭', suggestion: '重写本章的事件编排与人物功能分配，避免照搬源书骨架' });
    }
    const originality = creationOriginalityGate(current.payload, modelAudit, forbiddenIssues, snapshots);
    originality.issues.forEach(item => issues.push(item));
    const retentionCompliance = computeRetentionCompliance(current.payload, snapshots, current.payload.sourceStructure || {});
    retentionCompliance.items.forEach(item => {
      if (item.status === 'violated') issues.push({ severity: 'warning', category: 'retention', key: item.key, description: item.detail, suggestion: '请对照拆书骨架，尽量保全保留级对应的结构特征' });
    });
    if (auditCreditCost !== null && retentionCompliance.violatedCount > 0) {
      try {
        const qs = current.payload.qualityState && typeof current.payload.qualityState === 'object' ? current.payload.qualityState : {};
        const retentionIssues = Array.isArray(qs.retentionIssues) ? qs.retentionIssues : [];
        retentionIssues.push({ auditAt: Date.now(), chapterNo, items: retentionCompliance.items.map(i => ({ key: i.key, level: i.level, status: i.status, detail: i.detail })) });
        current.payload.qualityState = { ...qs, retentionIssues: retentionIssues.slice(-50) };
        const nextBibleVersion = current.version + 1;
        const now = Date.now();
        database.exec('BEGIN');
        try {
          const cas = database.prepare('UPDATE creation_bibles SET current_version = ?, updated_at = ? WHERE id = ? AND current_version = ?')
            .run(nextBibleVersion, now, current.bibleId, current.version);
          if (Number(cas.changes || 0) !== 1) {
            database.exec('ROLLBACK');
            return json(res, 409, { error: '圣经已被其他请求更新，请基于最新版本重新审计', code: 'audit_baseline_stale' });
          }
          database.prepare('INSERT INTO creation_bible_versions (id,bible_id,version,payload_json,payload_hash,source_brief_id,parent_version,change_summary,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
            .run('bv_' + current.bibleId + '_' + nextBibleVersion, current.bibleId, nextBibleVersion, JSON.stringify(current.payload), sha256Text(JSON.stringify(current.payload)), book.source_brief_id, current.version, '审计累计保留符合度问题（版本 +1）', auth.user.email, now);
          database.exec('COMMIT');
          current.version = nextBibleVersion;
        } catch (error) { try { database.exec('ROLLBACK'); } catch (_) {} throw error; }
      } catch (error) {
        logger.error('[creation] 审计累计 retention 问题失败 book=' + book.id + ':', error && error.message || error);
        return json(res, 500, { error: '章节审计状态保存失败', code: 'audit_persist_failed' });
      }
    }
    const blockers = issues.filter(item => String(item && item.severity) === 'blocker');
    const auditPassed = blockers.length === 0 && hasCompleteSemanticEvidence(modelAudit, content) && auditCreditCost !== null && !!content.trim();
    const causalDebts = { status: 'pending_commit' };
    const qualityGate = !auditPassed || originality.status === 'blocked' ? 'blocked' : originality.status === 'passed' ? 'passed' : 'passed_with_structural_pending';
    const factLedgerDelta = hasFactLedgerDelta(modelAudit.factLedgerDelta) ? modelAudit.factLedgerDelta : null;
    const bibleVersion = Number(current.version) || 0;
    const stateVersion = Number(book.current_state_version) || 0;
    const planHash = sha256Text(JSON.stringify(current.payload && current.payload.creationPlan || {}));
    const contextHash = sha256Text(JSON.stringify({ bookId: book.id, chapterNo, bibleVersion, stateVersion, planHash, genre: body.genre || current.payload.genre || '', targetWords, contract, factLedger, continuity: { premise: current.payload.bookPremise, worldRules: current.payload.worldRules || [], relationships: current.payload.relationships || [], openForeshadows: current.payload.foreshadowLedger || [] } }));
    const deltaHash = sha256Text(JSON.stringify(factLedgerDelta));
    const auditPayload = { passed: auditPassed, qualityGate, originality, structuralSimilarity, retentionCompliance, summary: modelAudit.summary || (blockers.length ? '存在阻断问题' : originality.status === 'pending' ? '确定性审计通过，结构级原创审计待事件抽取' : '确定性审计通过'), issues: issues.slice(0, 60), blockerCount: blockers.length, unverifiedIssueCount: issues.filter(item => item && item.unverified).length, contentLength: content.length, targetWords, somaticGate: somaticGate.metrics, causalDebts, source: 'creation-bible', bibleVersion, stateVersion, planHash, contextHash, deltaHash, factLedgerDelta };
    Object.assign(auditPayload, { protocol: 'benchmark-local-v2', contentHash: sha256Text(content), semanticAudit, status: auditPassed ? 'passed' : 'needs_review', humanReviewStatus: 'pending' });
    if (auditCreditCost === null) {
      return json(res, 502, { error: '供应商费用未知，章节审计未保存', code: 'PROVIDER_COST_UNKNOWN', audit: auditPayload, usage: auditOutput.usage || null });
    }
    try {
      if (dbReady()) {
        database.prepare(`INSERT INTO creation_chapter_audits
          (id,book_id,user_email,chapter_no,content_hash,passed,quality_gate,originality_status,blocker_count,
           audit_credit_cost,result_json,created_at,bible_version,state_version,context_hash,delta_hash,plan_hash,
           actor_user_id,workspace_id,project_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(
            'cca_' + book.id + '_' + chapterNo + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            book.id, auth.user.email, chapterNo, sha256Text(content), auditPassed ? 1 : 0, qualityGate,
            String(originality.status || ''), blockers.length, auditCreditCost, JSON.stringify(auditPayload), Date.now(),
            bibleVersion, stateVersion, contextHash, deltaHash, planHash,
            String(auth.user.userId || projectScope.stableUserId(auth.user.email)),
            book.workspace_id || '', book.project_id || book.novel_id || '');
      }
    } catch (error) {
      logger.error('[creation] 章节审计结果落库失败 book=' + book.id + ' chapter=' + chapterNo + ':', error && error.message || error);
      return json(res, 500, { error: '章节审计结果保存失败', code: 'audit_persist_failed' });
    }
    json(res, 200, { ok: true, audit: auditPayload, usage: auditOutput.usage || null });
  }

  async function handleCreationBookCommit(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const book = loadCreationBookForAuth(id, auth, projectScope.WRITE_ROLES);
    if (!book) return json(res, 404, { error: '新书不存在或无权访问' });
    let body = {}; try { body = await readBody(req).catch(() => ({})); } catch (_) {}
    const chapterNo = Math.max(1, Number(body.chapterNo) || 1);
    if (String(body.auditStatus || '').trim() && String(body.auditStatus).trim() !== 'passed') return json(res, 409, { error: '章节审计未通过，不能提交正式状态', code: 'audit_blocked' });
    const database = getDatabase();
    const replayed = benchmarkCommit.replayCommit(database, id, { ...body, chapterNo }, recordChapterCausalDebts);
    if (replayed) return json(res, replayed.ok ? 200 : 409, { ...replayed, spentCost: Number(book.spent_cost) || 0, currentStateVersion: Number(book.current_state_version) || 0 });
    let auditRecord = null;
    try {
      if (dbReady()) auditRecord = database.prepare('SELECT content_hash, passed, quality_gate, originality_status, blocker_count, audit_credit_cost, bible_version, state_version, context_hash, delta_hash, plan_hash, result_json FROM creation_chapter_audits WHERE book_id = ? AND chapter_no = ? ORDER BY created_at DESC LIMIT 1').get(id, chapterNo);
    } catch (error) { logger.error('[creation] 读取章节审计记录失败 book=' + id + ':', error && error.message || error); }
    if (!auditRecord) return json(res, 409, { error: '该章节尚未在服务端完成审计，请先运行章节审计', code: 'audit_missing' });
    const commitCheck = benchmarkCommit.validateCommitAudit(auditRecord, body);
    if (!commitCheck.ok) return json(res, 409, { error: '正文或审计证据已变化，请对实际提交正文重新审稿', code: commitCheck.code });
    const serverAuditCost = settledProviderCreditCost(commitCheck.audit.semanticAudit && commitCheck.audit.semanticAudit.usage);
    const persistedAuditCost = Number(auditRecord.audit_credit_cost);
    if (commitCheck.audit.protocol === 'benchmark-local-v2' &&
        (!hasCompleteSemanticEvidence(commitCheck.audit.semanticAudit, body.content) || serverAuditCost === null ||
         !Number.isFinite(persistedAuditCost) || persistedAuditCost < 0 || Math.abs(persistedAuditCost - serverAuditCost) > 1e-9)) {
      return json(res, 409, { error: '最近一次章节审计缺少可提交的成本或证据', code: 'audit_blocked' });
    }
    if (Number(auditRecord.blocker_count || 0) > 0 || String(auditRecord.quality_gate || '') === 'blocked' || String(auditRecord.originality_status || '') === 'blocked' || Number(auditRecord.passed) !== 1) {
      return json(res, 409, { error: '最近一次章节审计未通过，请修订正文并重新审计后再提交', code: 'audit_blocked', blockerCount: Number(auditRecord.blocker_count || 0) });
    }
    const expectedChapterNo = Number(book.current_chapter_no || 0) + 1;
    if (chapterNo !== expectedChapterNo) return json(res, 409, { error: '章节必须按顺序提交，请先读取最新创作状态', code: 'needs_rebase', expectedChapterNo });
    if (!String(body.contentHash || '').trim()) return json(res, 422, { error: '缺少正文 contentHash，不能提交状态' });
    const baseRaw = body.baseStateVersion;
    const baseStateVersion = (baseRaw === undefined || baseRaw === null || baseRaw === '')
      ? (Number(book.current_state_version) || 0)
      : Math.max(0, Number(baseRaw) || 0);
    const nextStateVersion = baseStateVersion + 1;
    const bible = loadCurrentBiblePayload(book.id);
    const currentPlanHash = sha256Text(JSON.stringify(bible && bible.payload && bible.payload.creationPlan || {}));
    const audit = commitCheck.audit;
    if (!bible || Number(auditRecord.bible_version) !== Number(bible.version) ||
      Number(auditRecord.state_version) !== Number(book.current_state_version) ||
      audit.bibleVersion !== Number(bible.version) ||
      audit.stateVersion !== Number(book.current_state_version) ||
      audit.planHash !== currentPlanHash ||
      String(body.contextHash || '') !== String(audit.contextHash || '') ||
      String(body.deltaHash || '') !== String(audit.deltaHash || '') ||
      String(body.planHash || '') !== currentPlanHash) {
      return json(res, 409, { error: '圣经、规划、状态或审计上下文已过期，请基于最新版本重新审计', code: 'audit_baseline_stale' });
    }
    const serverKnownCost = Number(auditRecord.audit_credit_cost) || 0;
    const actualCost = Math.max(Math.max(0, Number(body.actualCost) || 0), serverKnownCost);
    const budgetLimit = Math.max(0, Number(book.budget_limit) || 0);
    const spentCost = Math.max(0, Number(book.spent_cost) || 0);
    if (budgetLimit > 0 && spentCost + actualCost > budgetLimit + 1e-9) {
      return json(res, 402, { error: '本次提交会超过创作预算，请提高预算或暂停本章提交', code: 'budget_exceeded', budgetLimit, spentCost, actualCost, remaining: Math.max(0, budgetLimit - spentCost) });
    }
    const now = Date.now();
    const snapshotId = 'snap_' + id + '_' + chapterNo + '_' + nextStateVersion;
    database.exec('BEGIN');
    try {
      database.prepare(`INSERT OR REPLACE INTO creation_state_snapshots
        (id,book_id,chapter_no,bible_version,state_version,character_states_json,relationship_states_json,
         world_states_json,timeline_json,open_foreshadows_json,recent_facts_json,content_ref,content_hash,
         audit_status,created_at,actor_user_id,workspace_id,project_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(snapshotId, id, chapterNo, bible ? bible.version : 0, nextStateVersion,
          JSON.stringify(body.characterStates || {}), JSON.stringify(body.relationshipStates || {}), JSON.stringify(body.worldStates || {}),
          JSON.stringify(body.timeline || []), JSON.stringify(body.openForeshadows || []), JSON.stringify(body.recentFacts || []),
          String(body.contentRef || '').slice(0, 500), String(body.contentHash || '').slice(0, 200), String(body.auditStatus || 'committed'), now,
          String(auth.user.userId || projectScope.stableUserId(auth.user.email)), book.workspace_id || '', book.project_id || book.novel_id || '');
      const result = database.prepare('UPDATE creation_books SET current_state_version = ?, current_chapter_no = ?, spent_cost = spent_cost + ?, updated_at = ? WHERE id = ? AND current_state_version = ?')
        .run(nextStateVersion, chapterNo, actualCost, now, id, baseStateVersion);
      if (Number(result.changes) === 0) { database.exec('ROLLBACK'); return json(res, 409, { error: '状态版本冲突：他人已提交新版本，请基于最新状态重新生成（needs_rebase）' }); }
      benchmarkCommit.saveCommitReceipt(database, { snapshotId, bookId: id, chapterNo, stateVersion: nextStateVersion, contentHash: body.contentHash, content: body.content, ledgerDelta: commitCheck.audit.factLedgerDelta });
      database.exec('COMMIT');
    } catch (error) { database.exec('ROLLBACK'); logger.error('[creation] 提交章节失败 book=' + id + ' chapter=' + chapterNo + ':', error); return json(res, 500, { error: '章节提交失败，请稍后重试', code: 'internal_error' }); }
    const receipt = database.prepare('SELECT * FROM benchmark_commit_receipts WHERE snapshot_id = ?').get(snapshotId);
    const debtStatus = benchmarkCommit.finishCommitReceipt(database, receipt, recordChapterCausalDebts);
    json(res, 200, { ok: true, stateVersion: nextStateVersion, currentStateVersion: nextStateVersion, spentCost: spentCost + actualCost, snapshotId, debtStatus });
  }

  async function handleCreationBookQualityReport(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (!dbReady()) return json(res, 503, { error: '云端存储未启用' });
    const book = loadCreationBookForAuth(id, auth, projectScope.PROJECT_ROLES);
    if (!book) return json(res, 404, { error: '创作书不存在或无权访问' });
    const rows = getDatabase().prepare('SELECT id, chapter_no, content_hash, result_json, created_at FROM creation_chapter_audits WHERE book_id = ? ORDER BY chapter_no ASC, created_at ASC').all(String(id));
    const records = rows.map(row => {
      let evidence = null;
      try { evidence = JSON.parse(row.result_json || 'null'); } catch (_) {}
      return { id: String(row.id || ''), chapterNo: Number(row.chapter_no) || 0, contentHash: String(row.content_hash || ''), createdAt: Number(row.created_at) || 0, evidence };
    });
    json(res, 200, buildCreationQualityReport(records));
  }

  return { handleCreationBookChapterAudit, handleCreationBookCommit, handleCreationBookQualityReport };
}

module.exports = { createCreationChapterService };
