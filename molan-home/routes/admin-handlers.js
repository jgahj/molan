'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');

/**
 * 纠错库与管理审计业务处理函数工厂
 * @param {object} deps - 显式依赖注入表
 * @returns {object} 包含纠错库管理与素材审计核心处理函数的工厂实例
 */
function createAdminHandlers(deps) {
  const {
    json,
    readBody,
    respondError,
    requestError,
    getAuthUser,
    requireAdmin,
    getCorrectionLibrary,
    scanUniversalCorrectionRisks,
    loadCorrectionHits,
    correctionLibraryLib,
    CORRECTION_INBOX_FILE,
    CORRECTION_PRIOR_TEXT_MAX_CHARS = 60000,
    CHAT_MAX_JSON_BODY_BYTES = 512 * 1024,
    characterMaterialAuditState,
    loadCharacterMaterialAuditReport,
    evaluateCharacterMaterialApprovalGates,
    characterMaterialAuditMetrics,
    writeJsonFile,
    resetCharacterMaterialIndexCache,
    appendAdminAudit,
    CHARACTER_MATERIAL_APPROVAL_FILE,
    buildCorrectionScriptPath
  } = deps;

  function correctionLibrarySummary(library) {
    if (!library) return null;
    const scenes = (correctionLibraryLib && Array.isArray(correctionLibraryLib.SCENE_PROFILES))
      ? correctionLibraryLib.SCENE_PROFILES
      : [];
    return {
      title: library.title,
      version: library.version,
      path: library.path,
      bytes: library.bytes,
      stats: library.stats,
      warnings: library.warnings,
      rules: (library.rules || []).map(rule => ({
        id: rule.id,
        category: rule.category,
        must: rule.must,
        badExample: rule.badExample
      })),
      blacklist: library.blacklist,
      scenes: scenes.map(scene => ({ id: scene.id, label: scene.label, ruleIds: scene.ruleIds }))
    };
  }

  /** GET /api/correction-library：读取纠错库结构化摘要。 */
  function handleCorrectionLibrarySummary(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    const library = typeof getCorrectionLibrary === 'function' ? getCorrectionLibrary() : null;
    if (!library) return json(res, 503, { error: '纠错库不可用' });
    const summary = correctionLibrarySummary(library);
    const params = new URL(req.url, 'http://localhost').searchParams;
    if (params.get('cases') === '1') {
      summary.cases = (library.cases || []).map(item => ({
        id: item.id,
        chapter: item.chapter,
        type: item.type,
        before: item.before,
        after: item.after,
        principle: item.principle,
        source: item.source
      }));
    }
    return json(res, 200, { ok: true, library: summary });
  }

  /** POST /api/correction-library/scan：正文纠错扫描。 */
  function handleCorrectionLibraryScan(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    return readBody(req, CHAT_MAX_JSON_BODY_BYTES).then(body => {
      const input = body && typeof body === 'object' ? body : {};
      const text = String(input.text || '');
      if (!text.trim()) throw (typeof requestError === 'function' ? requestError(400, '正文为空') : new Error('正文为空'));
      const scanFn = typeof scanUniversalCorrectionRisks === 'function'
        ? scanUniversalCorrectionRisks
        : require('../correction-policy').scanUniversalCorrectionRisks;
      const audit = scanFn(text, {
        genre: String(input.genre || '').trim(),
        priorText: String(input.priorText || '').slice(0, CORRECTION_PRIOR_TEXT_MAX_CHARS),
        limit: Math.min(200, Math.max(1, Number(input.limit) || 120))
      });
      return json(res, 200, { ok: true, audit });
    }).catch(error => respondError(res, error));
  }

  /** POST /api/correction-library/inbox：回流条目登记。 */
  function handleCorrectionLibraryInbox(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    return readBody(req).then(body => {
      const input = body && typeof body === 'object' ? body : {};
      const lib = correctionLibraryLib || require('../lib/correction-library');
      const entry = lib.appendInbox(CORRECTION_INBOX_FILE, { ...input, user: auth.user.email, source: 'user' });
      const pending = lib.readInbox(CORRECTION_INBOX_FILE).length;
      return json(res, 200, { ok: true, entry, pending });
    }).catch(error => respondError(res, error));
  }

  /** GET /api/correction-library/inbox：待合并回流队列。 */
  function handleCorrectionLibraryInboxList(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    const lib = correctionLibraryLib || require('../lib/correction-library');
    const pending = lib.readInbox(CORRECTION_INBOX_FILE);
    return json(res, 200, { ok: true, pending, count: pending.length });
  }

  /** GET /api/correction-library/stats：纠错库全量统计。 */
  function handleCorrectionLibraryStats(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    const library = typeof getCorrectionLibrary === 'function' ? getCorrectionLibrary() : null;
    if (!library) return json(res, 503, { error: '纠错库不可用' });
    const hits = typeof loadCorrectionHits === 'function' ? loadCorrectionHits() : {};
    const lib = correctionLibraryLib || require('../lib/correction-library');
    const pending = lib.readInbox(CORRECTION_INBOX_FILE);
    const blacklistCount = (library.blacklist || []).reduce((acc, cat) => acc + (cat.phrases ? cat.phrases.length : 0), 0);
    return json(res, 200, {
      ok: true,
      stats: {
        version: library.version,
        ruleCount: (library.rules || []).length,
        caseCount: (library.cases || []).length,
        userCaseCount: (library.cases || []).filter(c => c.source === 'user').length,
        blacklistCount,
        checkCount: (library.checks || []).length,
        inboxPending: pending.length,
        hits: {
          totalRequests: hits.totalRequests || 0,
          passedRequests: hits.passedRequests || 0,
          updatedAt: hits.updatedAt || 0
        }
      }
    });
  }

  /** POST /api/correction-library/merge：合并回流并重新编译。 */
  function handleCorrectionLibraryMerge(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    const scriptPath = buildCorrectionScriptPath || path.join(__dirname, '..', 'scripts', 'build-correction-library.mjs');
    execFile(process.execPath, [scriptPath, '--merge-inbox'], (error, stdout, stderr) => {
      if (error) {
        return json(res, 500, { ok: false, error: '合并失败: ' + (error.message || String(error)), stderr });
      }
      const lib = correctionLibraryLib || require('../lib/correction-library');
      lib.clearCorrectionLibraryCache();
      const updatedLibrary = typeof getCorrectionLibrary === 'function' ? getCorrectionLibrary() : null;
      return json(res, 200, {
        ok: true,
        message: '合并完成',
        stdout: stdout ? stdout.trim() : '',
        version: updatedLibrary ? updatedLibrary.version : '',
        inboxPending: lib.readInbox(CORRECTION_INBOX_FILE).length
      });
    });
  }

  /** GET /api/admin/character-material/audit：返回素材审批清单。 */
  function handleCharacterMaterialAudit(req, res) {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const state = typeof characterMaterialAuditState === 'function' ? characterMaterialAuditState() : null;
      return json(res, 200, state);
    } catch (error) {
      return respondError(res, error, 503);
    }
  }

  /** PATCH /api/admin/character-material/audit：持久化素材审批结果并发布。 */
  function handleCharacterMaterialAuditPatch(req, res) {
    const auth = typeof requireAdmin === 'function' ? requireAdmin(req, res) : null;
    if (!auth) return;
    return readBody(req).then(async body => {
      const report = typeof loadCharacterMaterialAuditReport === 'function' ? loadCharacterMaterialAuditReport() : {};
      const sampleList = (report.manualReview && Array.isArray(report.manualReview.samples)) ? report.manualReview.samples : [];
      const samples = sampleList.map(sample => ({ id: String(sample.id || '') }));
      const sampleIds = new Set(samples.map(sample => sample.id));
      const reviewedIds = [...new Set(Array.isArray(body.reviewedIds) ? body.reviewedIds.map(String).filter(id => sampleIds.has(id)) : [])];
      const requestedExcludedIds = Array.isArray(body.excludedIds) ? body.excludedIds : body.residualIds;
      const residualIds = [...new Set(Array.isArray(requestedExcludedIds) ? requestedExcludedIds.map(String).filter(id => sampleIds.has(id)) : [])];
      const missingIds = samples.filter(sample => !reviewedIds.includes(sample.id)).map(sample => sample.id);
      const metrics = typeof characterMaterialAuditMetrics === 'function' ? characterMaterialAuditMetrics(sampleList, residualIds) : { publishableCount: 0, residualRate: 1 };
      const requestedApproved = body.approved === true;
      const releaseGates = typeof evaluateCharacterMaterialApprovalGates === 'function' ? evaluateCharacterMaterialApprovalGates(report) : {};
      const reportSourceHash = String(report.sourceHash || '').trim();
      if (requestedApproved && !reportSourceHash) {
        throw (typeof requestError === 'function' ? requestError(422, '质量报告缺少 sourceHash，不能绑定审批结果') : new Error('质量报告缺少 sourceHash，不能绑定审批结果'));
      }
      if (requestedApproved && !releaseGates.publicationApprovalReady) {
        const reason = !releaseGates.profileReleasePass
          ? '画像发布门禁未通过，不能发布 strong'
          : `Markdown 发布门禁未通过：${(releaseGates.publicationGateReasons || []).join('、') || '缺少有效门禁结果'}`;
        throw (typeof requestError === 'function' ? requestError(422, reason) : new Error(reason));
      }
      if (requestedApproved && (missingIds.length || metrics.publishableCount < 1 || metrics.residualRate >= 0.02)) {
        const reason = missingIds.length ? `还有 ${missingIds.length} 条抽检样本未标记为已检查` : '专名残留率必须低于 2% 才能发布';
        throw (typeof requestError === 'function' ? requestError(422, reason) : new Error(reason));
      }
      const approval = {
        version: report.version,
        sourceHash: reportSourceHash,
        approved: requestedApproved && !!reportSourceHash && missingIds.length === 0 && metrics.publishableCount > 0 && metrics.residualRate < 0.02,
        reviewedIds,
        residualIds,
        excludedIds: residualIds,
        residualRate: metrics.residualRate,
        rawResidualRate: sampleList.length ? Number((sampleList.filter(sample => Array.isArray(sample.residualTerms) && sample.residualTerms.length > 0).length / sampleList.length).toFixed(4)) : 0,
        approvalMode: body.approvalMode === 'agent' ? 'agent' : 'admin',
        approvedBy: auth.user.email,
        approvedAt: Date.now()
      };
      if (typeof writeJsonFile === 'function') writeJsonFile(CHARACTER_MATERIAL_APPROVAL_FILE, approval);
      if (typeof resetCharacterMaterialIndexCache === 'function') resetCharacterMaterialIndexCache();
      if (typeof appendAdminAudit === 'function') {
        await appendAdminAudit(auth.user.email, approval.approved ? 'character-material.approve' : 'character-material.review', `character-material:${report.version}`, {
          version: report.version,
          reviewedCount: reviewedIds.length,
          sampleCount: samples.length,
          excludedCount: metrics.excludedCount,
          residualCount: metrics.residualCount,
          residualRate: metrics.residualRate,
          published: approval.approved
        });
      }
      const state = typeof characterMaterialAuditState === 'function' ? characterMaterialAuditState() : {};
      return json(res, 200, { ...state, saved: true });
    }).catch(error => respondError(res, error));
  }

  return {
    // 动作短名 (供 routes/admin.js 使用)
    correctionSummary: handleCorrectionLibrarySummary,
    correctionStats: handleCorrectionLibraryStats,
    correctionScan: handleCorrectionLibraryScan,
    correctionInboxList: handleCorrectionLibraryInboxList,
    correctionInbox: handleCorrectionLibraryInbox,
    correctionMerge: handleCorrectionLibraryMerge,
    characterAudit: handleCharacterMaterialAudit,
    characterAuditPatch: handleCharacterMaterialAuditPatch,

    // 具名全称
    handleCorrectionLibrarySummary,
    handleCorrectionLibraryStats,
    handleCorrectionLibraryScan,
    handleCorrectionLibraryInboxList,
    handleCorrectionLibraryInbox,
    handleCorrectionLibraryMerge,
    handleCharacterMaterialAudit,
    handleCharacterMaterialAuditPatch,
    correctionLibrarySummary
  };
}

module.exports = {
  createAdminHandlers
};
