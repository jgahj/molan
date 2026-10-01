'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const benchmarkCommit = require('../lib/benchmark-commit');

const clone = value => structuredClone(value);
const isRecord = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const sha256 = value => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
const settledStatuses = new Set(['exact', 'settled']);

function settledCost(usage) {
  const cost = usage && usage.creditCost;
  const status = String(usage && usage.billingStatus || '').toLowerCase();
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 && settledStatuses.has(status) ? cost : null;
}

function completeSemanticEvidence(audit, content) {
  const delta = audit && audit.factLedgerDelta;
  return isRecord(audit) && audit.passed === true && audit.status === 'passed' &&
    Array.isArray(audit.incompleteReasons) && audit.incompleteReasons.length === 0 &&
    audit.contentHash === sha256(content) && isRecord(delta) &&
    Array.isArray(delta.newRules) && Array.isArray(delta.newPromises) && Array.isArray(delta.updates) &&
    isRecord(delta.byEntity) && Object.values(delta.byEntity).every(Array.isArray);
}

function projectBenchmarkLocalState(semanticAudit, chapterNo) {
  const delta = isRecord(semanticAudit && semanticAudit.factLedgerDelta) ? semanticAudit.factLedgerDelta : {};
  const causalDebts = [
    ...(Array.isArray(delta.newPromises) ? delta.newPromises : []).map(item => ({
      type: 'arc', seed: String(item && item.text || '').trim(), quote: String(item && item.quote || ''), originChapter: chapterNo
    })),
    ...(Array.isArray(delta.newRules) ? delta.newRules : []).filter(item => /代价|副作用|损失/.test(String(item && item.kind || '')))
      .map(item => ({ type: 'micro', seed: String(item && item.text || '').trim(), quote: String(item && item.quote || ''), originChapter: chapterNo }))
  ].filter(item => item.seed).slice(0, 12);
  return {
    stateDelta: clone(semanticAudit && semanticAudit.stateDelta || {}),
    outlineImpact: clone(semanticAudit && semanticAudit.outlineImpact || {}),
    factLedgerDelta: clone(delta),
    causalDebts
  };
}

function createNativeBenchmarkChapterService(dependencies) {
  const {
    creationRepository, benchmarkPipeline, getAuthUser, readBody, json, callMolanChat,
    dataDirectory,
    resolveModelForUser, currentDefaultModel, checkForbiddenTerms, creationForbiddenTerms,
    deterministicContractValidation, evaluateSomaticGate, runGenreNarrativeAudits,
    computeStructuralSimilarity, creationOriginalityGate, computeRetentionCompliance,
    logger = console
  } = dependencies;
  if (!creationRepository || !benchmarkPipeline || !getAuthUser || !readBody || !json || !callMolanChat) {
    throw new TypeError('Native benchmark chapter service dependencies are incomplete');
  }

  function readGenerationReceipt(ownerEmail, requestId, content) {
    if (!requestId) return null;
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) {
      throw Object.assign(new Error('generation_receipt_invalid'), { code: 'generation_receipt_invalid' });
    }
    const receiptFile = path.join(dataDirectory || process.env.MOLAN_DATA_DIR || path.join(__dirname, '..', 'data'),
      'benchmark-runs', sha256(`${ownerEmail}\n${requestId}`) + '.json');
    let receipt;
    try { receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8')); }
    catch (_) { throw Object.assign(new Error('generation_receipt_missing'), { code: 'generation_receipt_invalid' }); }
    const result = receipt && receipt.result;
    const calls = result && Array.isArray(result.calls) ? result.calls : [];
    const costs = calls.map(call => call && call.status === 'completed' ? settledCost(call.usage) : null);
    const draftCost = costs.reduce((total, cost) => total + (cost === null ? 0 : cost), 0);
    if (receipt.requestId !== requestId || !/^[a-f0-9]{64}$/i.test(String(receipt.requestHash || '')) ||
        receipt.status !== 'completed' || result?.protocol !== 'benchmark-local-v2' || result.status !== 'passed' ||
        result.usage?.complete !== true || !calls.length || costs.some(cost => cost === null) ||
        !Number.isFinite(Number(result.usage.creditCost)) || Math.abs(Number(result.usage.creditCost) - draftCost) > 1e-9 ||
        typeof result.text !== 'string' || sha256(result.text) !== sha256(content)) {
      throw Object.assign(new Error('generation_receipt_invalid'), { code: 'generation_receipt_invalid' });
    }
    return { requestId, requestHash: receipt.requestHash, outputHash: sha256(result.text), draftCost };
  }

  async function handleCreationBookChapterAudit(req, res, bookId) {
    const auth = await getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    let body = {};
    try { body = await readBody(req); } catch (_) {}
    body = isRecord(body) ? body : {};
    const content = typeof body.content === 'string' ? body.content : String(body.content || '');
    const chapterNo = Number(body.chapterNo || 1);
    if (!Number.isSafeInteger(chapterNo) || chapterNo < 1) return json(res, 422, { error: '章节号无效', code: 'invalid_chapter_no' });

    let scope;
    let context;
    try {
      scope = await creationRepository.resolveScope({ userId: auth.user.userId, bookId });
      context = await creationRepository.contractContext(scope);
    } catch (error) {
      if (error.code === 'spend_forbidden') return json(res, 403, { error: '当前账户没有该创作书的生成额度权限', code: 'spend_forbidden' });
      if (error.code === 'FORBIDDEN' || error.code === 'BOOK_NOT_FOUND') return json(res, 404, { error: '创作书不存在或无权访问' });
      throw error;
    }
    const generationRequestId = String(body.generationRequestId || '').trim();
    let generationReceipt = null;
    try { generationReceipt = readGenerationReceipt(auth.user.email, generationRequestId, content); }
    catch (error) { return json(res, 409, { error: '生成请求回执缺失或与正文、账户不匹配', code: error.code }); }

    const biblePayload = context.bible.payload || {};
    const contract = isRecord(body.contract) ? clone(body.contract) : {};
    const genre = String(body.genre || biblePayload.genre || '');
    const targetWords = Number(biblePayload.taskConstraints && biblePayload.taskConstraints.chapterWordTarget) || 2000;
    const actualWords = content.replace(/\s/g, '').length;
    const issues = [];
    if (!content.trim()) issues.push({ severity: 'blocker', category: 'content', description: '正文为空', suggestion: '生成正文后再提交' });
    else if (actualWords < 300) issues.push({ severity: 'blocker', category: 'content', description: '正文少于 300 字', suggestion: '补充完整场景' });
    if (actualWords > 0 && (actualWords < targetWords * 0.7 || actualWords > targetWords * 1.3)) {
      issues.push({ severity: 'warning', category: 'pacing', description: `字数 ${actualWords} 偏离目标 ${targetWords} 超过 ±30%`, suggestion: '调整篇幅至目标字数附近' });
    }

    const forbiddenIssues = checkForbiddenTerms ? checkForbiddenTerms(content, creationForbiddenTerms(biblePayload)) : [];
    issues.push(...forbiddenIssues);
    const contractValidation = deterministicContractValidation
      ? deterministicContractValidation({ chapterNo, ...contract }) : { findings: [] };
    for (const finding of contractValidation.findings || []) {
      issues.push({ severity: finding.severity, category: 'contract', description: finding.description, suggestion: '修订章节合同或正文' });
    }
    const somaticGate = evaluateSomaticGate ? evaluateSomaticGate(content, contract) : { metrics: null };
    if (somaticGate.issue) issues.push({ ...somaticGate.issue, severity: 'warning', heuristicOnly: true });
    const genreAudit = runGenreNarrativeAudits ? runGenreNarrativeAudits(content, contract, genre) : { issues: [] };
    issues.push(...(genreAudit.issues || []).map(item => ({ ...item, heuristicOnly: true })));

    const snapshots = await creationRepository.snapshots({ ...scope, upTo: 0 });
    const modelId = resolveModelForUser
      ? resolveModelForUser(auth.user, body.modelId || currentDefaultModel())
      : body.modelId || currentDefaultModel();
    const factLedger = isRecord(body.factLedger) ? body.factLedger : null;
    const semanticAudit = await benchmarkPipeline.evidenceAudit({
      callModel: (_ignoredAuth, options) => callMolanChat(String(req.headers.authorization || ''), auth.user,
        { ...options, requireComplete: true })
    }, auth, {
      text: content, contract, factLedger, modelId, targetWords, genre,
      continuity: {
        premise: biblePayload.bookPremise,
        worldRules: biblePayload.worldRules || [],
        characters: (biblePayload.characters || []).filter(item => content.includes(String(item.name || '')) ||
          String(contract.viewpoint || '').includes(String(item.name || ''))),
        relationships: biblePayload.relationships || [],
        goldenFinger: biblePayload.goldenFinger,
        openForeshadows: (biblePayload.foreshadowLedger || []).filter(item => item && !['paid', 'resolved'].includes(item.status)),
        previousSnapshots: snapshots.slice(0, 2)
      }
    });
    issues.push(...(Array.isArray(semanticAudit && semanticAudit.issues) ? semanticAudit.issues : [])
      .map(item => ({ ...item, description: item.problem, suggestion: item.fixHint })));
    const structuralSimilarity = computeStructuralSimilarity
      ? computeStructuralSimilarity(biblePayload, snapshots) : { blocked: false };
    if (structuralSimilarity.blocked) issues.push({ severity: 'blocker', category: 'originality', description: '结构级相似度过高', suggestion: '重写事件编排与人物功能分配' });
    const originality = creationOriginalityGate
      ? creationOriginalityGate(biblePayload, semanticAudit || {}, forbiddenIssues, snapshots)
      : { status: 'passed', issues: [] };
    issues.push(...(originality.issues || []));
    const retentionCompliance = computeRetentionCompliance
      ? computeRetentionCompliance(biblePayload, snapshots, biblePayload.sourceStructure || {})
      : { items: [], violatedCount: 0 };
    for (const item of retentionCompliance.items || []) {
      if (item.status === 'violated') issues.push({ severity: 'warning', category: 'retention', key: item.key,
        description: item.detail, suggestion: '请对照拆书骨架检查保留特征' });
    }

    const auditCost = settledCost(semanticAudit && semanticAudit.usage);
    const blockers = issues.filter(item => String(item && item.severity) === 'blocker');
    const auditPassed = blockers.length === 0 && completeSemanticEvidence(semanticAudit, content) &&
      auditCost !== null && !!content.trim() && !structuralSimilarity.blocked && originality.status !== 'blocked';
    const factLedgerDelta = semanticAudit && semanticAudit.factLedgerDelta || null;
    const baseline = context.baseline;
    const contextHash = sha256(JSON.stringify({ bookId, chapterNo, bibleVersion: baseline.bibleVersion,
      stateVersion: baseline.stateVersion, baseRevision: baseline.baseRevision, planHash: baseline.planHash,
      generationReceipt, genre, targetWords, contract, factLedger, continuity: { premise: biblePayload.bookPremise,
        worldRules: biblePayload.worldRules || [], relationships: biblePayload.relationships || [],
        openForeshadows: biblePayload.foreshadowLedger || [] } }));
    const deltaHash = sha256(JSON.stringify(factLedgerDelta));
    const auditPayload = {
      passed: auditPassed,
      qualityGate: !auditPassed || originality.status === 'blocked' ? 'blocked' : originality.status === 'passed' ? 'passed' : 'passed_with_structural_pending',
      originality, structuralSimilarity, retentionCompliance,
      summary: semanticAudit && semanticAudit.summary || (blockers.length ? '存在阻断问题' : '确定性审计通过'),
      issues: issues.slice(0, 60), blockerCount: blockers.length,
      contentLength: content.length, targetWords, somaticGate: somaticGate.metrics || null,
      source: 'creation-bible', bibleVersion: baseline.bibleVersion, stateVersion: baseline.stateVersion,
      projectRevision: baseline.baseRevision, planHash: baseline.planHash, contextHash, deltaHash, factLedgerDelta,
      generationReceipt, draftCost: generationReceipt ? generationReceipt.draftCost : 0,
      draftCostNotIncluded: !generationReceipt,
      protocol: 'benchmark-local-v2', contentHash: sha256(content), semanticAudit,
      status: auditPassed ? 'passed' : 'needs_review', humanReviewStatus: 'pending'
    };
    if (auditCost === null) return json(res, 502, { error: '供应商费用未知，章节审计未保存', code: 'PROVIDER_COST_UNKNOWN', audit: auditPayload, usage: semanticAudit && semanticAudit.usage || null });

    const auditId = `creation-audit:${bookId}:${chapterNo}:${crypto.randomUUID().replace(/-/g, '')}`;
    try {
      await creationRepository.repository.transaction([scope.projectId], tx => {
        const { project, row: book } = creationRepository.book(tx, scope, true);
        const member = project.members[auth.user.userId];
        if (member.role !== 'owner' && !member.canSpend) throw Object.assign(new Error('spend_forbidden'), { code: 'spend_forbidden', status: 403 });
        const bible = tx.get(scope.projectId, 'novels', `creation-bible:${bookId}`);
        const planHash = sha256(JSON.stringify(bible && bible.payload && bible.payload.creationPlan || {}));
        if (!bible || bible.version !== baseline.bibleVersion || book.currentStateVersion !== baseline.stateVersion ||
            project.contentRevision !== baseline.baseRevision || planHash !== baseline.planHash) {
          throw Object.assign(new Error('audit_baseline_stale'), { code: 'audit_baseline_stale', status: 409 });
        }
        tx.put(scope.projectId, 'ledger', { id: auditId, kind: 'creation-audit', bookId, chapterNo,
          contentHash: auditPayload.contentHash, passed: auditPassed, qualityGate: auditPayload.qualityGate,
          originalityStatus: originality.status || '', blockerCount: blockers.length, auditCreditCost: auditCost,
          draftCreditCost: auditPayload.draftCost, totalSettledCost: auditCost + auditPayload.draftCost,
          draftCostNotIncluded: auditPayload.draftCostNotIncluded, generationReceipt,
          evidence: clone(auditPayload), actorUserId: auth.user.userId, workspaceId: project.workspaceId,
          projectId: project.id, createdAt: Date.now() }, 0);
      });
    } catch (error) {
      if (error.code === 'audit_baseline_stale' || error.code === 'REVISION_CONFLICT') return json(res, 409, { error: '圣经、规划或状态已更新，请基于最新版本重新审稿', code: 'audit_baseline_stale' });
      if (error.code === 'FORBIDDEN' || error.code === 'BOOK_NOT_FOUND') return json(res, 404, { error: '创作书不存在或无权访问' });
      throw error;
    }
    return json(res, 200, { ok: true, audit: auditPayload, usage: semanticAudit && semanticAudit.usage || null });
  }

  async function handleCreationBookCommit(req, res, bookId) {
    const auth = await getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    let body = {};
    try { body = await readBody(req); } catch (_) {}
    body = isRecord(body) ? body : {};
    const content = typeof body.content === 'string' ? body.content : '';
    const chapterNo = Number(body.chapterNo || 1);
    if (!Number.isSafeInteger(chapterNo) || chapterNo < 1) return json(res, 422, { error: '章节号无效', code: 'invalid_chapter_no' });
    if (String(body.auditStatus || '').trim() && String(body.auditStatus).trim() !== 'passed') {
      return json(res, 409, { error: '章节审计未通过，不能提交正式状态', code: 'audit_blocked' });
    }

    let scope;
    try { scope = await creationRepository.resolveScope({ userId: auth.user.userId, bookId }); }
    catch (error) {
      if (error.code === 'FORBIDDEN' || error.code === 'BOOK_NOT_FOUND') return json(res, 404, { error: '新书不存在或无权访问' });
      throw error;
    }
    try {
      const result = await creationRepository.repository.transaction([scope.projectId], async tx => {
        const { project, row: book } = creationRepository.book(tx, scope, true);
        const member = project.members[auth.user.userId];
        if (member.role !== 'owner' && !member.canSpend) throw Object.assign(new Error('spend_forbidden'), { code: 'spend_forbidden', status: 403 });
        const receiptId = `creation-commit-receipt:${bookId}:${chapterNo}`;
        const priorReceipt = tx.get(scope.projectId, 'ledger', receiptId);
        if (priorReceipt) {
          if (priorReceipt.actorUserId !== auth.user.userId || priorReceipt.projectId !== project.id ||
              priorReceipt.workspaceId !== project.workspaceId || priorReceipt.contentHash !== sha256(content) ||
              priorReceipt.contentHash !== body.contentHash) {
            throw Object.assign(new Error('committed_content_conflict'), { code: 'committed_content_conflict', status: 409 });
          }
          if (priorReceipt.generationReceipt) {
            const currentReceipt = readGenerationReceipt(auth.user.email, priorReceipt.generationReceipt.requestId, content);
            if (currentReceipt.requestHash !== priorReceipt.generationReceipt.requestHash ||
                currentReceipt.outputHash !== priorReceipt.generationReceipt.outputHash ||
                currentReceipt.draftCost !== priorReceipt.generationReceipt.draftCost) {
              throw Object.assign(new Error('generation_receipt_invalid'), { code: 'generation_receipt_invalid', status: 409 });
            }
          }
          return { ...clone(priorReceipt.receipt), replayed: true };
        }

        const latest = tx.list(scope.projectId, 'ledger').filter(row => row.kind === 'creation-audit' &&
          row.bookId === bookId && row.chapterNo === chapterNo).sort((a, b) => b.createdAt - a.createdAt)[0];
        if (!latest) throw Object.assign(new Error('audit_missing'), { code: 'audit_missing', status: 409 });
        const audit = latest.evidence;
        const check = benchmarkCommit.validateCommitAudit({ content_hash: latest.contentHash,
          passed: latest.passed ? 1 : 0, result_json: JSON.stringify(audit) }, body);
        if (!check.ok) throw Object.assign(new Error(check.code), { code: check.code, status: 409 });
        const serverAuditCost = settledCost(audit.semanticAudit && audit.semanticAudit.usage);
        if (!completeSemanticEvidence(audit.semanticAudit, content) || serverAuditCost === null ||
            !Number.isFinite(latest.auditCreditCost) || latest.auditCreditCost < 0 ||
            Math.abs(latest.auditCreditCost - serverAuditCost) > 1e-9) {
          throw Object.assign(new Error('audit_blocked'), { code: 'audit_blocked', status: 409 });
        }
        let draftCost = 0;
        if (audit.generationReceipt) {
          const currentReceipt = readGenerationReceipt(auth.user.email, audit.generationReceipt.requestId, content);
          if (currentReceipt.requestHash !== audit.generationReceipt.requestHash ||
              currentReceipt.outputHash !== audit.generationReceipt.outputHash ||
              currentReceipt.draftCost !== audit.generationReceipt.draftCost) {
            throw Object.assign(new Error('generation_receipt_invalid'), { code: 'generation_receipt_invalid', status: 409 });
          }
          draftCost = currentReceipt.draftCost;
        } else if (audit.draftCostNotIncluded !== true) {
          throw Object.assign(new Error('audit_blocked'), { code: 'audit_blocked', status: 409 });
        }
        if (Math.abs(Number(latest.draftCreditCost || 0) - draftCost) > 1e-9 ||
            Math.abs(Number(latest.totalSettledCost || 0) - serverAuditCost - draftCost) > 1e-9) {
          throw Object.assign(new Error('audit_blocked'), { code: 'audit_blocked', status: 409 });
        }
        if (!latest.passed || latest.blockerCount > 0 || latest.qualityGate === 'blocked' || latest.originalityStatus === 'blocked') {
          throw Object.assign(new Error('audit_blocked'), { code: 'audit_blocked', status: 409 });
        }
        const bible = tx.get(scope.projectId, 'novels', `creation-bible:${bookId}`);
        const planHash = sha256(JSON.stringify(bible && bible.payload && bible.payload.creationPlan || {}));
        if (!bible || audit.bibleVersion !== bible.version || audit.stateVersion !== book.currentStateVersion ||
            audit.projectRevision !== project.contentRevision || audit.planHash !== planHash ||
            body.bibleVersion !== audit.bibleVersion || body.stateVersion !== audit.stateVersion ||
            body.baseStateVersion !== audit.stateVersion || body.projectRevision != null && body.projectRevision !== audit.projectRevision ||
            body.planHash !== audit.planHash || body.contextHash !== audit.contextHash || body.deltaHash !== audit.deltaHash) {
          throw Object.assign(new Error('audit_baseline_stale'), { code: 'audit_baseline_stale', status: 409 });
        }
        const expectedChapterNo = book.currentChapterNo + 1;
        if (chapterNo !== expectedChapterNo) throw Object.assign(new Error('needs_rebase'), { code: 'needs_rebase', status: 409, expectedChapterNo });
        if (body.baseStateVersion !== book.currentStateVersion) throw Object.assign(new Error('needs_rebase'), { code: 'needs_rebase', status: 409 });
        const cost = serverAuditCost + draftCost;
        if (book.budgetLimit > 0 && book.spentCost + cost > book.budgetLimit + 1e-9) {
          throw Object.assign(new Error('budget_exceeded'), { code: 'budget_exceeded', status: 402,
            budgetLimit: book.budgetLimit, spentCost: book.spentCost, actualCost: cost,
            remaining: Math.max(0, book.budgetLimit - book.spentCost) });
        }

        const now = Date.now();
        const stateVersion = book.currentStateVersion + 1;
        const snapshotId = `snap_${bookId}_${chapterNo}_${stateVersion}`;
        const projection = projectBenchmarkLocalState(audit.semanticAudit, chapterNo);
        tx.put(scope.projectId, 'ledger', { ...projection, id: snapshotId, kind: 'creation-snapshot', bookId, chapterNo,
          bibleVersion: bible.version, stateVersion, projectRevision: project.contentRevision + 1,
          contentHash: audit.contentHash, auditStatus: 'passed',
          actorUserId: auth.user.userId, createdAt: now }, 0);

        const manuscriptId = `manuscript:${bookId}:chapter:${chapterNo}`;
        const priorManuscript = tx.get(scope.projectId, 'novels', `resource:${manuscriptId}`);
        const manuscriptRevision = Number(priorManuscript && priorManuscript.contentRevision || 0) + 1;
        const manuscript = { title: String(body.title || audit.contract?.title || `第${chapterNo}章`), kind: 'chapter',
          chapterId: manuscriptId, continuityId: 'main', canonApplicability: 'canon', numberingPolicy: 'sequential',
          text: content, hash: audit.contentHash, status: 'committed', revision: manuscriptRevision,
          creationBookId: bookId, stateVersion };
        tx.put(scope.projectId, 'novels', { id: `resource:${manuscriptId}`, kind: 'resource', resourceId: manuscriptId,
          resourceKind: 'manuscript', payload: manuscript, contentRevision: manuscriptRevision, deleted: false,
          createdAt: priorManuscript && priorManuscript.createdAt || now, updatedAt: now }, priorManuscript && priorManuscript.revision || 0);
        tx.put(scope.projectId, 'ledger', { id: `resource-version:${manuscriptId}:${manuscriptRevision}`,
          kind: 'resource-version', resourceId: manuscriptId, resourceKind: 'manuscript', payload: manuscript,
          contentRevision: manuscriptRevision, changedBy: auth.user.userId, reason: 'benchmark-local-v2 chapter commit', createdAt: now }, 0);

        const novelState = clone(project.state);
        if (creationRepository.app.validateState) creationRepository.app.validateState(novelState);
        if (creationRepository.app.guardNovelWrite) {
          await creationRepository.app.guardNovelWrite(tx, project, { ...scope, state: novelState,
            expectedRevision: project.contentRevision });
        }
        const nextProject = tx.put(scope.projectId, 'novels', { ...project, state: novelState,
          contentRevision: project.contentRevision + 1, updatedAt: now }, project.revision);
        if (creationRepository.app.onNovelChanged) await creationRepository.app.onNovelChanged(tx, nextProject, project);
        const nextBook = tx.put(scope.projectId, 'novels', { ...book, currentStateVersion: stateVersion,
          currentChapterNo: chapterNo, spentCost: book.spentCost + cost, updatedAt: now }, book.revision);
        const receipt = { ok: true, stateVersion, currentStateVersion: stateVersion,
          projectRevision: nextProject.contentRevision, chapterNo, contentHash: audit.contentHash,
          spentCost: nextBook.spentCost, snapshotId, debtStatus: { status: 'pending', durable: true } };
        tx.put(scope.projectId, 'ledger', { id: `creation-debt-outbox:${snapshotId}`, kind: 'creation-debt-outbox',
          bookId, snapshotId, causalDebts: projection.causalDebts, ledgerDelta: projection.factLedgerDelta,
          status: 'pending', actorUserId: auth.user.userId, createdAt: now }, 0);
        tx.put(scope.projectId, 'ledger', { id: receiptId, kind: 'creation-commit-receipt', bookId, chapterNo,
          contentHash: audit.contentHash, content, projectId: project.id, workspaceId: project.workspaceId,
          actorUserId: auth.user.userId, snapshotId, stateVersion, generationReceipt: clone(audit.generationReceipt || null), receipt, createdAt: now }, 0);
        return receipt;
      });
      return json(res, 200, result);
    } catch (error) {
      if (error.code === 'audit_missing') return json(res, 409, { error: '该章节尚未在服务端完成审计，请先运行章节审计', code: 'audit_missing' });
      if (error.code === 'committed_content_conflict' || error.code === 'content_hash_invalid' ||
          error.code === 'audit_content_changed' || error.code === 'audit_evidence_missing' || error.code === 'audit_blocked') {
        return json(res, 409, { error: '正文或审计证据已变化，请对实际提交正文重新审稿', code: error.code });
      }
      if (error.code === 'audit_baseline_stale') return json(res, 409, { error: '圣经、规划、novel 或状态版本已过期，请重新审稿', code: 'audit_baseline_stale' });
      if (error.code === 'needs_rebase') return json(res, 409, { error: '章节必须按顺序提交，请先读取最新创作状态', code: 'needs_rebase', expectedChapterNo: error.expectedChapterNo });
      if (error.code === 'budget_exceeded') return json(res, 402, { error: '本次提交会超过创作预算', code: 'budget_exceeded',
        budgetLimit: error.budgetLimit, spentCost: error.spentCost, actualCost: error.actualCost, remaining: error.remaining });
      if (error.code === 'spend_forbidden') return json(res, 403, { error: '当前账户没有该创作书的生成额度权限', code: 'spend_forbidden' });
      if (error.code === 'FORBIDDEN' || error.code === 'BOOK_NOT_FOUND') return json(res, 404, { error: '新书不存在或无权访问' });
      logger.error('[creation] 原生 benchmark 章节提交失败 book=' + bookId + ':', error && error.message || error);
      throw error;
    }
  }

  return { handleCreationBookChapterAudit, handleCreationBookCommit };
}

module.exports = { createNativeBenchmarkChapterService };
