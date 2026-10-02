'use strict';

function queryParamsFromUrl(url) {
  const idx = String(url || '').indexOf('?');
  const out = {};
  if (idx < 0) return out;
  new URLSearchParams(String(url).slice(idx + 1)).forEach((v, k) => { out[k] = v; });
  return out;
}

function defaultMarkdown(record, resultView) {
  const result = resultView ? resultView(record.result) : (record.result || {});
  const lines = [
    '# ' + (record.title || '未命名拆书'),
    '',
    '> 拆书模式：' + (record.depth || 'standard') + ' · 样本：' + (record.meta && record.meta.sampleCount || 0) + ' 个片段',
    ''
  ];
  const add = (title, value) => {
    lines.push('## ' + title, '', typeof value === 'string' ? value : '```json\n' + JSON.stringify(value || [], null, 2) + '\n```', '');
  };
  add('概览', result.overview);
  add('全书框架', result.framework);
  add('结构划分（起承转合）', result.storyStructure);
  add('开篇节奏', result.opening);
  add('金手指', result.goldenFinger);
  add('文章架构', result.architecture);
  add('人物', result.characters);
  add('反派体系', result.antagonists);
  add('次要功能角色', result.minorRoles);
  add('关系', result.relationships);
  add('世界观', result.worldbuilding);
  add('时间线', result.timeline);
  add('大纲', result.outline);
  add('伏笔', result.foreshadowing);
  add('可迁移文风', result.styleProfile);
  add('创作技法', result.craftConstraints);
  add('证据账本', result.evidenceLedger);
  add('作者 DNA', result.authorDna);
  add('反转套路', result.reversalPatterns);
  add('新书规划资产', {
    mainline: result.mainline,
    characterLibrary: result.characterLibrary,
    worldRules: result.worldRules,
    storyTree: result.storyTree,
    conflictChain: result.conflictChain,
    rewardChain: result.rewardChain,
    volumePlan: result.volumePlan,
    arcPlan: result.arcPlan,
    chapterPlan: result.chapterPlan,
    scenePlan: result.scenePlan,
    foreshadowPlan: result.foreshadowPlan,
    reviewPlan: result.reviewPlan
  });
  add('题材与卖点', { genre: result.genre, sellingPoints: result.sellingPoints });
  add('情绪与爽点', result.emotion);
  add('冲突统计', result.conflictStats);
  add('章节目录', result.chapterIndex);
  add('可复用模板', result.reusableTemplates);
  add('句式指纹', result.sentenceFingerprint);
  add('逻辑漏洞', result.logicFlaws);
  lines.push('## 边界说明', '', '原书专属的角色、剧情、世界观和术语不会自动导入新小说；仿写默认只应用已确认的文风与创作技法。');
  return lines.join('\n');
}

function compareEntityDeterministic(a, b) {
  const aCount = a?.mention_count ?? null;
  const bCount = b?.mention_count ?? null;
  if (aCount !== null && bCount === null) return -1;
  if (aCount === null && bCount !== null) return 1;
  if (aCount !== null && bCount !== null && aCount !== bCount) {
    return bCount - aCount;
  }
  const aName = String(a?.canonical_name || '');
  const bName = String(b?.canonical_name || '');
  if (aName < bName) return -1;
  if (aName > bName) return 1;
  const aId = String(a?.id || '');
  const bId = String(b?.id || '');
  if (aId < bId) return -1;
  if (aId > bId) return 1;
  return 0;
}

function parseSafeNumberOrNull(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function parseSafeNonNegativeIntegerOrNull(value) {
  const num = parseSafeNumberOrNull(value);
  if (num === null) return null;
  return Number.isSafeInteger(num) && num >= 0 ? num : null;
}

function parseSafeRatioOrNull(value) {
  const num = parseSafeNumberOrNull(value);
  if (num === null) return null;
  return num >= 0 && num <= 1 ? num : null;
}

function createNativeDissectionQueryService({
  repository,
  getAuthUser,
  json,
  respondError,
  buildMarkdown,
  buildDocx,
  resultView = x => x || {},
  hasCompleteContent,
  responseCors = () => ({})
}) {
  if (!repository) throw new TypeError('repository is required');

  function auth(req, res) {
    const value = getAuthUser(req);
    if (!value || !value.user) {
      json(res, 401, { error: '请先登录' });
      return null;
    }
    return value;
  }

  function cors(res) {
    return responseCors(res) || {};
  }

  function isComplete(job) {
    if (!job || job.status !== 'completed') return false;
    if (typeof hasCompleteContent !== 'function') return false;
    return Boolean(hasCompleteContent(job.result, job.depth));
  }

  function handleCommonError(res, error) {
    if (error && (error.code === 'FORBIDDEN' || error.code === 'DISSECTION_NOT_FOUND' || error.status === 404)) {
      return json(res, 404, { error: '拆书任务不存在或无权访问', code: 'DISSECTION_NOT_FOUND' });
    }
    if (error && error.code === 'DISSECTION_INCOMPLETE') {
      return json(res, 409, { error: error.message || '拆书结果不完整，请先重新分析', code: 'DISSECTION_INCOMPLETE' });
    }
    if (typeof respondError === 'function') {
      return respondError(res, error, Number(error?.status) || 500);
    }
    return json(res, Number(error?.status) || 500, { error: error?.message || '请求失败' });
  }

  function computePipelineStats(job, unitTotal, unitCompleted) {
    const result = resultView(job.result) || {};
    const meta = (job.meta && typeof job.meta === 'object') ? job.meta : {};
    const pipeline = (meta.pipeline && typeof meta.pipeline === 'object') ? meta.pipeline : {};
    const hasPipelineMeta = Boolean(pipeline.aggregated);
    const characters = Array.isArray(result.characters) ? result.characters : (Array.isArray(result.characterLibrary) ? result.characterLibrary : []);
    const foreshadowing = Array.isArray(result.foreshadowing) ? result.foreshadowing : (Array.isArray(result.foreshadowPlan) ? result.foreshadowPlan : []);
    const summariesCount = (Array.isArray(result.chapterSummaries) ? result.chapterSummaries.length : 0) +
                           (Array.isArray(result.volumeSummaries) ? result.volumeSummaries.length : 0) +
                           (Array.isArray(result.arcSummaries) ? result.arcSummaries.length : 0) +
                           (result.bookSummary ? 1 : 0);
    const eventsCount = Array.isArray(result.storyTree) ? result.storyTree.length : (Array.isArray(result.timeline) ? result.timeline.length : 0);

    const resultCounts = {
      entities: characters.length,
      characters: characters.length,
      foreshadows: foreshadowing.length,
      foreshadowing: foreshadowing.length,
      summaries: summariesCount,
      events: eventsCount,
      source: Object.keys(result).length ? 'native-result' : 'missing'
    };

    return {
      unitTotal: Number.isSafeInteger(unitTotal) ? unitTotal : (job.unitTotal || 0),
      unitCompleted: Number.isSafeInteger(unitCompleted) ? unitCompleted : (job.unitCompleted || 0),
      factCoverage: parseSafeRatioOrNull(pipeline.factCoverage),
      batchTotal: parseSafeNonNegativeIntegerOrNull(pipeline.batchTotal),
      batchDone: parseSafeNonNegativeIntegerOrNull(pipeline.batchDone),
      failedBatches: Array.isArray(pipeline.failedBatches) ? pipeline.failedBatches : [],
      aggregated: Boolean(pipeline.aggregated),
      validationStatus: pipeline.validationStatus || (hasPipelineMeta ? 'unknown' : null),
      entities: parseSafeNonNegativeIntegerOrNull(pipeline.entities),
      candidates: parseSafeNonNegativeIntegerOrNull(pipeline.candidates),
      mentions: parseSafeNonNegativeIntegerOrNull(pipeline.mentions),
      events: parseSafeNonNegativeIntegerOrNull(pipeline.events),
      summaries: parseSafeNonNegativeIntegerOrNull(pipeline.summaries),
      claims: parseSafeNonNegativeIntegerOrNull(pipeline.claims),
      foreshadows: parseSafeNonNegativeIntegerOrNull(pipeline.foreshadows),
      edges: parseSafeNonNegativeIntegerOrNull(pipeline.edges),
      states: parseSafeNonNegativeIntegerOrNull(pipeline.states),
      source: hasPipelineMeta ? 'pipeline-meta' : (Object.keys(result).length ? 'native-result' : 'missing'),
      authoritySource: hasPipelineMeta ? 'pipeline-meta' : 'missing',
      pipelineAvailable: hasPipelineMeta,
      resultCounts
    };
  }

  async function handleExport(req, res, id) {
    const actor = auth(req, res);
    if (!actor) return;
    try {
      const jobId = decodeURIComponent(id);
      const data = await repository.getQueryData({ actorUserId: actor.user.userId, jobId });
      const job = data.job;
      if (typeof hasCompleteContent !== 'function' || !isComplete(job)) {
        return json(res, 409, { error: '拆书结果不完整，请先重新分析', code: 'DISSECTION_INCOMPLETE' });
      }
      const q = queryParamsFromUrl(req.url);
      const format = String(q.format || 'json').toLowerCase();
      if (format === 'markdown') {
        const body = buildMarkdown ? buildMarkdown(job, resultView) : defaultMarkdown(job, resultView);
        res.writeHead(200, {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': 'attachment; filename="dissection-' + job.id + '.md"',
          'Content-Length': Buffer.byteLength(body),
          ...cors(res)
        });
        return res.end(body);
      }
      if (format === 'docx') {
        const docxBuilder = buildDocx || require('../lib/dissection-docx').buildDissectionDocx;
        try {
          const view = resultView(job.result);
          const body = docxBuilder(job, view);
          res.writeHead(200, {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'Content-Disposition': 'attachment; filename="dissection-' + job.id + '.docx"',
            'Content-Length': body.length,
            ...cors(res)
          });
          return res.end(body);
        } catch (error) {
          return json(res, 500, { error: 'Word 导出失败：' + String(error?.message || error) });
        }
      }
      const { sourceText, ...payload } = job;
      const body = JSON.stringify(payload, null, 2);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="dissection-' + job.id + '.json"',
        'Content-Length': Buffer.byteLength(body),
        ...cors(res)
      });
      res.end(body);
    } catch (error) {
      handleCommonError(res, error);
    }
  }

  async function handleCoverage(req, res, id) {
    const actor = auth(req, res);
    if (!actor) return;
    try {
      const jobId = decodeURIComponent(id);
      const data = await repository.getQueryData({ actorUserId: actor.user.userId, jobId });
      const stats = computePipelineStats(data.job, data.unitTotal, data.unitCompleted);
      json(res, 200, { ok: true, coverage: stats });
    } catch (error) {
      handleCommonError(res, error);
    }
  }

  async function handleEntities(req, res, id) {
    const actor = auth(req, res);
    if (!actor) return;
    try {
      const jobId = decodeURIComponent(id);
      const data = await repository.getQueryData({ actorUserId: actor.user.userId, jobId });
      const result = resultView(data.job.result) || {};
      const q = queryParamsFromUrl(req.url);
      const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
      const rawList = [
        ...(Array.isArray(result.characters) ? result.characters : []),
        ...(Array.isArray(result.characterLibrary) ? result.characterLibrary : []),
        ...(Array.isArray(result.antagonists) ? result.antagonists : []),
        ...(Array.isArray(result.minorRoles) ? result.minorRoles : [])
      ];
      if (!rawList.length) {
        return json(res, 200, { ok: true, items: [], next: '', source: 'missing' });
      }
      const seen = new Set();
      const list = [];
      for (let i = 0; i < rawList.length; i++) {
        const item = rawList[i];
        if (!item) continue;
        const name = String(item.canonical_name || item.canonicalName || item.name || '').trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const entityId = String(item.id || `ent_${i + 1}`);
        const entityType = String(item.entity_type || item.entityType || item.role || 'character');
        const mentionCount = parseSafeNonNegativeIntegerOrNull(item.mention_count ?? item.mentionCount ?? item.count);
        const rawStatus = item.status != null ? String(item.status).trim() : '';
        const status = rawStatus ? rawStatus : 'unknown';
        const firstUnitId = String(item.first_unit_id || item.firstUnitId || '');
        const lastUnitId = String(item.last_unit_id || item.lastUnitId || '');
        list.push({
          id: entityId,
          canonical_name: name,
          entity_type: entityType,
          first_unit_id: firstUnitId,
          last_unit_id: lastUnitId,
          mention_count: mentionCount,
          status
        });
      }
      list.sort(compareEntityDeterministic);
      let cursor = null;
      const rawCursor = String(q.cursor || '').trim();
      if (rawCursor) {
        try {
          const decoded = JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8'));
          const cursorCount = decoded?.mentionCount === null ? null : parseSafeNonNegativeIntegerOrNull(decoded?.mentionCount);
          if (decoded && (decoded.mentionCount === null || cursorCount !== null)) {
            cursor = {
              mention_count: cursorCount,
              canonical_name: String(decoded.canonicalName ?? decoded.canonical_name ?? ''),
              id: String(decoded.id || '')
            };
          }
        } catch (_) {
          const legacy = parseSafeNonNegativeIntegerOrNull(rawCursor);
          if (legacy !== null) cursor = { mention_count: legacy, canonical_name: '', id: '' };
        }
      }
      let filtered = list;
      if (cursor) {
        filtered = list.filter(item => compareEntityDeterministic(item, cursor) > 0);
      }
      const hasMore = filtered.length > limit;
      const items = filtered.slice(0, limit);
      const last = items[items.length - 1];
      const next = hasMore && last
        ? Buffer.from(JSON.stringify({
            mentionCount: last.mention_count === null ? null : last.mention_count,
            canonicalName: String(last.canonical_name || ''),
            id: String(last.id || '')
          })).toString('base64url')
        : '';
      json(res, 200, { ok: true, items, next, source: 'native-result' });
    } catch (error) {
      handleCommonError(res, error);
    }
  }

  async function handleForeshadows(req, res, id) {
    const actor = auth(req, res);
    if (!actor) return;
    try {
      const jobId = decodeURIComponent(id);
      const data = await repository.getQueryData({ actorUserId: actor.user.userId, jobId });
      const result = resultView(data.job.result) || {};
      const q = queryParamsFromUrl(req.url);
      const rawList = Array.isArray(result.foreshadowing)
        ? result.foreshadowing
        : (Array.isArray(result.foreshadowPlan) ? result.foreshadowPlan : []);
      if (!rawList.length) {
        return json(res, 200, { ok: true, total: 0, items: [], next: '', source: 'missing' });
      }
      let list = rawList.map((f, i) => {
        const confidence = parseSafeRatioOrNull(f.confidence);
        const rawStatus = f.status != null ? String(f.status).trim() : '';
        const rawStrength = f.strength != null ? String(f.strength).trim() : '';
        return {
          id: String(f.id || `f_${i + 1}`),
          title: String(f.title || ''),
          description: String(f.description || ''),
          status: rawStatus ? rawStatus : 'unknown',
          strength: rawStrength ? rawStrength : null,
          setupChapter: f.setupChapter ?? f.setup_chapter ?? null,
          payoffChapter: f.payoffChapter ?? f.payoff_chapter ?? null,
          relatedEntityIds: Array.isArray(f.relatedEntityIds) ? f.relatedEntityIds : (Array.isArray(f.related_entity_ids) ? f.related_entity_ids : []),
          evidenceIds: Array.isArray(f.evidenceIds) ? f.evidenceIds : (Array.isArray(f.evidence_ids) ? f.evidence_ids : []),
          confidence
        };
      });
      if (q.status) {
        list = list.filter(item => String(item.status) === String(q.status));
      }
      const cursor = Math.max(0, Number(q.cursor) || 0);
      const limit = Math.min(300, Math.max(1, Number(q.limit) || 50));
      const items = list.slice(cursor, cursor + limit);
      const next = cursor + items.length < list.length ? cursor + items.length : '';
      json(res, 200, { ok: true, total: list.length, items, next, source: 'native-result' });
    } catch (error) {
      handleCommonError(res, error);
    }
  }

  async function handleSummaries(req, res, id) {
    const actor = auth(req, res);
    if (!actor) return;
    try {
      const jobId = decodeURIComponent(id);
      const data = await repository.getQueryData({ actorUserId: actor.user.userId, jobId });
      const result = resultView(data.job.result) || {};
      const q = queryParamsFromUrl(req.url);
      const type = String(q.type || 'volume');
      let rawList = [];
      if (type === 'chapter') rawList = Array.isArray(result.chapterSummaries) ? result.chapterSummaries : [];
      else if (type === 'arc') rawList = Array.isArray(result.arcSummaries) ? result.arcSummaries : [];
      else if (type === 'book') rawList = result.bookSummary ? (Array.isArray(result.bookSummary) ? result.bookSummary : [result.bookSummary]) : [];
      else rawList = Array.isArray(result.volumeSummaries) ? result.volumeSummaries : [];
      if (!rawList.length) {
        return json(res, 200, { ok: true, type, total: 0, items: [], next: '', source: 'missing' });
      }
      const cursor = Math.max(0, Number(q.cursor) || 0);
      const limit = Math.min(300, Math.max(1, Number(q.limit) || 50));
      const items = rawList.slice(cursor, cursor + limit);
      const next = cursor + items.length < rawList.length ? cursor + items.length : '';
      json(res, 200, { ok: true, type, total: rawList.length, items, next, source: 'native-result' });
    } catch (error) {
      handleCommonError(res, error);
    }
  }

  async function handleValidation(req, res, id) {
    const actor = auth(req, res);
    if (!actor) return;
    try {
      const jobId = decodeURIComponent(id);
      const data = await repository.getQueryData({ actorUserId: actor.user.userId, jobId });
      const result = resultView(data.job.result) || {};
      const stats = computePipelineStats(data.job, data.unitTotal, data.unitCompleted);
      const validation = result.validation || { conclusion: 'unknown', source: 'missing' };
      json(res, 200, { ok: true, validation, stats });
    } catch (error) {
      handleCommonError(res, error);
    }
  }

  async function handleSearch(req, res, id) {
    const actor = auth(req, res);
    if (!actor) return;
    try {
      const jobId = decodeURIComponent(id);
      const q = queryParamsFromUrl(req.url);
      const searchResult = await repository.searchUnits({
        actorUserId: actor.user.userId,
        jobId,
        query: q.q,
        limit: Number(q.limit) || 30
      });
      json(res, 200, { ok: true, items: searchResult.items, query: searchResult.query, source: 'native-units' });
    } catch (error) {
      handleCommonError(res, error);
    }
  }

  async function dispatch(req, res, pathname) {
    const targetPath = pathname || new URL(req.url, 'http://localhost').pathname;
    const match = targetPath.match(/^\/api\/dissections\/([A-Za-z0-9_]+)\/(export|coverage|entities|foreshadows|summaries|validation|search)$/);
    if (!match || req.method !== 'GET') return false;
    const [, id, action] = match;
    switch (action) {
      case 'export': await handleExport(req, res, id); return true;
      case 'coverage': await handleCoverage(req, res, id); return true;
      case 'entities': await handleEntities(req, res, id); return true;
      case 'foreshadows': await handleForeshadows(req, res, id); return true;
      case 'summaries': await handleSummaries(req, res, id); return true;
      case 'validation': await handleValidation(req, res, id); return true;
      case 'search': await handleSearch(req, res, id); return true;
      default: return false;
    }
  }

  return {
    handleExport,
    handleCoverage,
    handleEntities,
    handleForeshadows,
    handleSummaries,
    handleValidation,
    handleSearch,
    dispatch,
    computePipelineStats,
    queryParamsFromUrl
  };
}

module.exports = {
  createNativeDissectionQueryService,
  defaultMarkdown,
  queryParamsFromUrl,
  compareEntityDeterministic,
  parseSafeNumberOrNull,
  parseSafeNonNegativeIntegerOrNull,
  parseSafeRatioOrNull
};
