'use strict';

function createPostgresDissectionReadService(dependencies) {
  const {
    postgresRepository,
    getAuthUser,
    postgresActor,
    json,
    respondPostgresError,
    rowToRecord,
    publicRecord,
    buildMarkdown,
    buildDocx,
    resultView,
    hasCompleteContent,
    responseCors
  } = dependencies;

  function compareStrings(a, b) {
    const s1 = String(a || '');
    const s2 = String(b || '');
    if (s1 === s2) return 0;
    return s1 > s2 ? 1 : -1;
  }

  function parseNonNegativeInt(val) {
    if (typeof val === 'boolean') return null;
    if (val === null || val === undefined) return null;
    if (typeof val === 'object') return null;
    if (typeof val === 'string') {
      if (!/^\s*\d+\s*$/.test(val)) return null;
    }
    const num = Number(val);
    if (!Number.isSafeInteger(num) || num < 0) return null;
    return num;
  }

  function parseCoverage(val) {
    if (typeof val === 'boolean') return null;
    if (val === null || val === undefined) return null;
    if (typeof val === 'object') return null;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (!trimmed || isNaN(Number(trimmed))) return null;
    }
    const num = Number(val);
    if (!Number.isFinite(num) || num < 0 || num > 1) return null;
    return num;
  }

  function parseBoolean(val) {
    if (typeof val === 'boolean') return val;
    return null;
  }

  function parseConfidence(doc) {
    const val = doc && (doc.confidence !== undefined ? doc.confidence : doc.confidenceScore);
    if (val === null || val === undefined) return null;
    if (typeof val !== 'number' && typeof val !== 'string') return null;
    if (typeof val === 'string' && !val.trim()) return null;
    const num = Number(val);
    if (!Number.isFinite(num) || num < 0 || num > 1) return null;
    return num;
  }

  function queryParamsFromUrl(url) {
    const idx = String(url || '').indexOf('?');
    const out = {};
    if (idx < 0) return out;
    new URLSearchParams(String(url).slice(idx + 1)).forEach((v, k) => { out[k] = v; });
    return out;
  }

  function getRowDocument(row) {
    if (!row) return {};
    if (typeof row.document === 'object' && row.document !== null) return row.document;
    if (typeof row.document === 'string') {
      try { return JSON.parse(row.document); } catch (_) { return {}; }
    }
    return {};
  }

  function checkRecordOwner(row, auth, actor) {
    const rowOwnerUserId = String(row.owner_user_id || row.ownerUserId || '').trim();
    const rowUserEmail = String(row.user_email || row.userEmail || '').trim().toLowerCase();
    const authUserEmail = String(auth && auth.user && auth.user.email || '').trim().toLowerCase();
    if (rowOwnerUserId) {
      return rowOwnerUserId === actor;
    }
    return rowUserEmail === authUserEmail;
  }

  async function computeDissectionStats(actor, id, record) {
    const rows = await postgresRepository.runtimeListDissectionRows(actor, id);
    if (!Array.isArray(rows)) {
      throw Object.assign(new Error('PostgreSQL 拆书台账必须返回数组'), { status: 500, code: 'invalid_rows_format' });
    }
    let entities = 0, candidates = 0, mentions = 0, events = 0, summaries = 0;
    let claims = 0, units = 0, foreshadows = 0, edges = 0, states = 0;

    for (const row of rows) {
      const table = String(row.source_table || row.sourceTable || '');
      if (table === 'dissection_entities') {
        entities += 1;
        const doc = getRowDocument(row);
        if (doc.status === 'candidate') {
          candidates += 1;
        }
      } else if (table === 'dissection_entity_mentions') {
        mentions += 1;
      } else if (table === 'dissection_events') {
        events += 1;
      } else if (table === 'dissection_summaries') {
        summaries += 1;
      } else if (table === 'dissection_claims') {
        claims += 1;
      } else if (table === 'dissection_units') {
        units += 1;
      } else if (table === 'dissection_foreshadows') {
        foreshadows += 1;
      } else if (table === 'dissection_event_edges') {
        edges += 1;
      } else if (table === 'dissection_entity_states') {
        states += 1;
      }
    }

    const p = (record && record.meta && record.meta.pipeline) || {};
    return {
      unitTotal: parseNonNegativeInt(p.unitTotal),
      unitCompleted: parseNonNegativeInt(p.unitCompleted),
      factCoverage: parseCoverage(p.factCoverage),
      batchTotal: parseNonNegativeInt(p.batchTotal),
      batchDone: parseNonNegativeInt(p.batchDone),
      failedBatches: Array.isArray(p.failedBatches) ? p.failedBatches : null,
      aggregated: parseBoolean(p.aggregated),
      validationStatus: typeof p.validationStatus === 'string' && p.validationStatus.trim() ? p.validationStatus.trim() : null,
      entities,
      candidates,
      mentions,
      events,
      summaries,
      claims,
      units,
      foreshadows,
      edges,
      states
    };
  }

  async function handleList(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const actor = postgresActor(auth);
    try {
      const rows = await postgresRepository.runtimeListDissections(actor);
      if (!Array.isArray(rows)) {
        throw Object.assign(new Error('PostgreSQL 拆书列表必须返回数组'), { status: 500, code: 'invalid_list_format' });
      }
      const sliced = rows.slice(0, 50);
      const tasks = await Promise.all(sliced.map(async row => {
        const record = rowToRecord(row);
        if (row.estimated_credits === null) record.estimatedCredits = null;
        if (row.actual_credits === null) record.actualCredits = null;
        const stats = await computeDissectionStats(actor, record.id, record);
        return publicRecord(record, false, stats);
      }));
      return json(res, 200, { ok: true, tasks });
    } catch (error) {
      return respondPostgresError(res, error);
    }
  }

  async function handleGet(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const actor = postgresActor(auth);
    try {
      const row = await postgresRepository.runtimeGetDissection(actor, id);
      if (!row) return json(res, 404, { error: '拆书任务不存在或无权访问' });
      if (!checkRecordOwner(row, auth, actor)) {
        return json(res, 404, { error: '拆书任务不存在或无权访问' });
      }
      const record = rowToRecord(row);
      if (row.estimated_credits === null) record.estimatedCredits = null;
      if (row.actual_credits === null) record.actualCredits = null;
      const stats = await computeDissectionStats(actor, id, record);
      const task = publicRecord(record, true, stats);
      return json(res, 200, { ok: true, task });
    } catch (error) {
      return respondPostgresError(res, error);
    }
  }

  async function handleExport(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const actor = postgresActor(auth);
    try {
      const row = await postgresRepository.runtimeGetDissection(actor, id);
      if (!row) return json(res, 404, { error: '拆书任务不存在或无权访问' });
      if (!checkRecordOwner(row, auth, actor)) {
        return json(res, 404, { error: '拆书任务不存在或无权访问' });
      }
      const record = rowToRecord(row);
      if (row.estimated_credits === null) record.estimatedCredits = null;
      if (row.actual_credits === null) record.actualCredits = null;

      let isComplete = false;
      try {
        isComplete = typeof hasCompleteContent === 'function' && Boolean(hasCompleteContent(record.result, record.depth));
      } catch (_) {
        isComplete = false;
      }

      if (record.status !== 'completed' || !isComplete) {
        return json(res, 409, { error: '拆书结果不完整，请先重新分析' });
      }

      const urlObj = new URL(req.url, 'http://localhost');
      const format = String(urlObj.searchParams.get('format') || 'json').toLowerCase();

      if (format === 'markdown') {
        const body = buildMarkdown(record);
        res.writeHead(200, {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': 'attachment; filename="dissection-' + record.id + '.md"',
          'Content-Length': Buffer.byteLength(body),
          ...responseCors(res)
        });
        return res.end(body);
      }

      if (format === 'docx') {
        try {
          const body = buildDocx(record, typeof resultView === 'function' ? resultView(record.result) : record.result);
          res.writeHead(200, {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'Content-Disposition': 'attachment; filename="dissection-' + record.id + '.docx"',
            'Content-Length': body.length,
            ...responseCors(res)
          });
          return res.end(body);
        } catch (e) {
          return json(res, 500, { error: 'Word 导出失败：' + String((e && e.message) || e) });
        }
      }

      const stats = await computeDissectionStats(actor, id, record);
      const pub = publicRecord(record, true, stats);
      const exportData = { ...pub };
      delete exportData.sourceText;
      const body = JSON.stringify(exportData, null, 2);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="dissection-' + record.id + '.json"',
        'Content-Length': Buffer.byteLength(body),
        ...responseCors(res)
      });
      return res.end(body);
    } catch (error) {
      return respondPostgresError(res, error);
    }
  }

  async function handleCoverage(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const actor = postgresActor(auth);
    try {
      const row = await postgresRepository.runtimeGetDissection(actor, id);
      if (!row) return json(res, 404, { error: '拆书任务不存在或无权访问' });
      if (!checkRecordOwner(row, auth, actor)) {
        return json(res, 404, { error: '拆书任务不存在或无权访问' });
      }
      const record = rowToRecord(row);
      const coverage = await computeDissectionStats(actor, id, record);
      return json(res, 200, { ok: true, coverage });
    } catch (error) {
      return respondPostgresError(res, error);
    }
  }

  async function handleValidation(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const actor = postgresActor(auth);
    try {
      const row = await postgresRepository.runtimeGetDissection(actor, id);
      if (!row) return json(res, 404, { error: '拆书任务不存在或无权访问' });
      if (!checkRecordOwner(row, auth, actor)) {
        return json(res, 404, { error: '拆书任务不存在或无权访问' });
      }
      const record = rowToRecord(row);
      const view = typeof resultView === 'function' ? resultView(record.result) : (record.result || {});
      const validation = (view && view.validation) || (record.result && record.result.validation) || { conclusion: 'unknown' };
      const stats = await computeDissectionStats(actor, id, record);
      return json(res, 200, { ok: true, validation, stats });
    } catch (error) {
      return respondPostgresError(res, error);
    }
  }

  async function handleUnits(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const actor = postgresActor(auth);
    try {
      const row = await postgresRepository.runtimeGetDissection(actor, id);
      if (!row) return json(res, 404, { error: '拆书任务不存在或无权访问' });
      if (!checkRecordOwner(row, auth, actor)) {
        return json(res, 404, { error: '拆书任务不存在或无权访问' });
      }
      const q = queryParamsFromUrl(req.url);
      const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
      const cursor = Number(q.cursor) || 0;

      const rows = await postgresRepository.runtimeListDissectionRows(actor, id);
      if (!Array.isArray(rows)) {
        throw Object.assign(new Error('PostgreSQL 拆书台账必须返回数组'), { status: 500, code: 'invalid_rows_format' });
      }

      const matched = [];
      for (const r of rows) {
        const table = String(r.source_table || r.sourceTable || '');
        if (table === 'dissection_units') {
          const doc = getRowDocument(r);
          const ordinal = Number(doc.ordinal !== undefined ? doc.ordinal : r.ordinal) || 0;
          matched.push({
            id: String(doc.id || r.id || ''),
            parent_id: doc.parent_id !== undefined ? doc.parent_id : (doc.parentId !== undefined ? doc.parentId : null),
            unit_type: String(doc.unit_type || doc.unitType || 'scene'),
            ordinal,
            title: String(doc.title || ''),
            source_start: doc.source_start !== undefined ? doc.source_start : (doc.sourceStart !== undefined ? doc.sourceStart : null),
            source_end: doc.source_end !== undefined ? doc.source_end : (doc.sourceEnd !== undefined ? doc.sourceEnd : null),
            char_count: doc.char_count !== undefined ? doc.char_count : (doc.charCount !== undefined ? doc.charCount : (doc.text ? doc.text.length : 0)),
            token_estimate: doc.token_estimate !== undefined ? doc.token_estimate : (doc.tokenEstimate !== undefined ? doc.tokenEstimate : null)
          });
        }
      }

      matched.sort((a, b) => a.ordinal - b.ordinal || compareStrings(a.id, b.id));
      const filtered = matched.filter(u => u.ordinal > cursor);
      const hasMore = filtered.length > limit;
      const items = filtered.slice(0, limit);
      const next = hasMore && items.length > 0 ? items[items.length - 1].ordinal : '';
      return json(res, 200, { ok: true, items, next });
    } catch (error) {
      return respondPostgresError(res, error);
    }
  }

  async function handleEntities(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const actor = postgresActor(auth);
    try {
      const row = await postgresRepository.runtimeGetDissection(actor, id);
      if (!row) return json(res, 404, { error: '拆书任务不存在或无权访问' });
      if (!checkRecordOwner(row, auth, actor)) {
        return json(res, 404, { error: '拆书任务不存在或无权访问' });
      }
      const q = queryParamsFromUrl(req.url);
      const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));

      let cursor = null;
      const rawCursor = String(q.cursor || '').trim();
      if (rawCursor) {
        try {
          const decoded = JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8'));
          if (decoded && Number.isFinite(Number(decoded.mentionCount))) {
            cursor = {
              mentionCount: Number(decoded.mentionCount),
              canonicalName: String(decoded.canonicalName || ''),
              id: String(decoded.id || '')
            };
          }
        } catch (_) {
          const legacy = Number(rawCursor);
          if (Number.isFinite(legacy)) {
            cursor = { mentionCount: legacy, canonicalName: '', id: '' };
          }
        }
      }

      const rows = await postgresRepository.runtimeListDissectionRows(actor, id);
      if (!Array.isArray(rows)) {
        throw Object.assign(new Error('PostgreSQL 拆书台账必须返回数组'), { status: 500, code: 'invalid_rows_format' });
      }

      const matched = [];
      for (const r of rows) {
        const table = String(r.source_table || r.sourceTable || '');
        if (table === 'dissection_entities') {
          const doc = getRowDocument(r);
          matched.push({
            id: String(doc.id || r.id || ''),
            canonical_name: String(doc.canonical_name || doc.canonicalName || doc.name || ''),
            entity_type: String(doc.entity_type || doc.entityType || 'character'),
            first_unit_id: doc.first_unit_id !== undefined ? doc.first_unit_id : (doc.firstUnitId !== undefined ? doc.firstUnitId : null),
            last_unit_id: doc.last_unit_id !== undefined ? doc.last_unit_id : (doc.lastUnitId !== undefined ? doc.lastUnitId : null),
            mention_count: Number(doc.mention_count !== undefined ? doc.mention_count : (doc.mentionCount !== undefined ? doc.mentionCount : 0)) || 0,
            status: String(doc.status || 'confirmed')
          });
        }
      }

      matched.sort((a, b) => {
        if (b.mention_count !== a.mention_count) return b.mention_count - a.mention_count;
        const nameDiff = compareStrings(a.canonical_name, b.canonical_name);
        if (nameDiff !== 0) return nameDiff;
        return compareStrings(a.id, b.id);
      });

      let filtered = matched;
      if (cursor) {
        filtered = matched.filter(item => {
          if (item.mention_count < cursor.mentionCount) return true;
          if (item.mention_count === cursor.mentionCount) {
            const nameDiff = compareStrings(item.canonical_name, cursor.canonicalName);
            if (nameDiff > 0) return true;
            if (nameDiff === 0) {
              return compareStrings(item.id, cursor.id) > 0;
            }
          }
          return false;
        });
      }

      const hasMore = filtered.length > limit;
      const items = filtered.slice(0, limit);
      const last = items[items.length - 1];
      const next = hasMore && last
        ? Buffer.from(JSON.stringify({
            mentionCount: Number(last.mention_count) || 0,
            canonicalName: String(last.canonical_name || ''),
            id: String(last.id || '')
          })).toString('base64url')
        : '';

      return json(res, 200, { ok: true, items, next });
    } catch (error) {
      return respondPostgresError(res, error);
    }
  }

  async function handleForeshadows(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const actor = postgresActor(auth);
    try {
      const row = await postgresRepository.runtimeGetDissection(actor, id);
      if (!row) return json(res, 404, { error: '拆书任务不存在或无权访问' });
      if (!checkRecordOwner(row, auth, actor)) {
        return json(res, 404, { error: '拆书任务不存在或无权访问' });
      }
      const q = queryParamsFromUrl(req.url);
      const limit = Math.min(300, Math.max(1, Number(q.limit) || 50));
      const cursor = Math.max(0, Number(q.cursor) || 0);

      const rows = await postgresRepository.runtimeListDissectionRows(actor, id);
      if (!Array.isArray(rows)) {
        throw Object.assign(new Error('PostgreSQL 拆书台账必须返回数组'), { status: 500, code: 'invalid_rows_format' });
      }

      let list = [];
      for (const r of rows) {
        const table = String(r.source_table || r.sourceTable || '');
        if (table === 'dissection_foreshadows') {
          const doc = getRowDocument(r);
          let relatedEntityIds = [];
          if (Array.isArray(doc.related_entity_ids)) relatedEntityIds = doc.related_entity_ids;
          else if (Array.isArray(doc.relatedEntityIds)) relatedEntityIds = doc.relatedEntityIds;
          else if (typeof doc.related_entity_ids === 'string') {
            try { relatedEntityIds = JSON.parse(doc.related_entity_ids); } catch (_) {}
          } else if (typeof doc.relatedEntityIds === 'string') {
            try { relatedEntityIds = JSON.parse(doc.relatedEntityIds); } catch (_) {}
          }

          let evidenceIds = [];
          if (Array.isArray(doc.evidence_ids)) evidenceIds = doc.evidence_ids;
          else if (Array.isArray(doc.evidenceIds)) evidenceIds = doc.evidenceIds;
          else if (typeof doc.evidence_ids === 'string') {
            try { evidenceIds = JSON.parse(doc.evidence_ids); } catch (_) {}
          } else if (typeof doc.evidenceIds === 'string') {
            try { evidenceIds = JSON.parse(doc.evidenceIds); } catch (_) {}
          }

          list.push({
            id: String(doc.id || r.id || ''),
            title: String(doc.title || ''),
            description: String(doc.description || ''),
            status: String(doc.status || 'open'),
            strength: String(doc.strength || 'subtle'),
            setupChapter: doc.setup_chapter !== undefined ? doc.setup_chapter : (doc.setupChapter !== undefined ? doc.setupChapter : null),
            payoffChapter: doc.payoff_chapter !== undefined ? doc.payoff_chapter : (doc.payoffChapter !== undefined ? doc.payoffChapter : null),
            relatedEntityIds,
            evidenceIds,
            confidence: parseConfidence(doc)
          });
        }
      }

      if (!list.length) {
        const record = rowToRecord(row);
        const result = typeof resultView === 'function' ? resultView(record.result) : (record.result || {});
        list = Array.isArray(result.foreshadowing) ? result.foreshadowing : [];
      }

      if (q.status) {
        list = list.filter(f => String(f.status) === q.status);
      }

      const items = list.slice(cursor, cursor + limit);
      const next = cursor + items.length < list.length ? cursor + items.length : '';
      return json(res, 200, { ok: true, total: list.length, items, next });
    } catch (error) {
      return respondPostgresError(res, error);
    }
  }

  async function handleSummaries(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const actor = postgresActor(auth);
    try {
      const row = await postgresRepository.runtimeGetDissection(actor, id);
      if (!row) return json(res, 404, { error: '拆书任务不存在或无权访问' });
      if (!checkRecordOwner(row, auth, actor)) {
        return json(res, 404, { error: '拆书任务不存在或无权访问' });
      }
      const q = queryParamsFromUrl(req.url);
      const limit = Math.min(300, Math.max(1, Number(q.limit) || 50));
      const cursor = Math.max(0, Number(q.cursor) || 0);
      const type = String(q.type || 'volume');

      const rows = await postgresRepository.runtimeListDissectionRows(actor, id);
      if (!Array.isArray(rows)) {
        throw Object.assign(new Error('PostgreSQL 拆书台账必须返回数组'), { status: 500, code: 'invalid_rows_format' });
      }

      const matchedRows = [];
      for (const r of rows) {
        const table = String(r.source_table || r.sourceTable || '');
        if (table === 'dissection_summaries') {
          const doc = getRowDocument(r);
          const summaryType = String(doc.summary_type || doc.summaryType || doc.type || '');
          if (summaryType === type) {
            matchedRows.push({ r, doc });
          }
        }
      }

      matchedRows.sort((a, b) => {
        const orderA = Number(a.r.source_row_no !== undefined ? a.r.source_row_no : (a.r.sourceRowNo !== undefined ? a.r.sourceRowNo : 0));
        const orderB = Number(b.r.source_row_no !== undefined ? b.r.source_row_no : (b.r.sourceRowNo !== undefined ? b.r.sourceRowNo : 0));
        return orderA - orderB;
      });

      let list = [];
      for (const { r, doc } of matchedRows) {
        let childIds = [];
        if (Array.isArray(doc.child_ids)) childIds = doc.child_ids;
        else if (Array.isArray(doc.childIds)) childIds = doc.childIds;
        else if (typeof doc.child_ids === 'string') {
          try { childIds = JSON.parse(doc.child_ids); } catch (_) {}
        } else if (typeof doc.child_ids_json === 'string') {
          try { childIds = JSON.parse(doc.child_ids_json); } catch (_) {}
        }

        let content = {};
        if (typeof doc.content === 'object' && doc.content !== null) {
          content = doc.content;
        } else if (typeof doc.content_json === 'string') {
          try { content = JSON.parse(doc.content_json); } catch (_) {}
        } else {
          content = { ...doc };
          delete content.id;
          delete content.owner_id;
          delete content.ownerId;
          delete content.child_ids;
          delete content.childIds;
          delete content.child_ids_json;
          delete content.summary_type;
          delete content.summaryType;
          delete content.type;
        }

        list.push({
          id: String(doc.id || r.id || ''),
          ownerId: doc.owner_id !== undefined ? doc.owner_id : (doc.ownerId !== undefined ? doc.ownerId : null),
          childIds,
          ...content
        });
      }

      if (!list.length) {
        const record = rowToRecord(row);
        const result = typeof resultView === 'function' ? resultView(record.result) : (record.result || {});
        if (type === 'chapter') list = Array.isArray(result.chapterSummaries) ? result.chapterSummaries : [];
        else if (type === 'arc') list = Array.isArray(result.arcSummaries) ? result.arcSummaries : [];
        else if (type === 'book') list = result.bookSummary ? [result.bookSummary] : [];
        else list = Array.isArray(result.volumeSummaries) ? result.volumeSummaries : [];
      }

      const items = list.slice(cursor, cursor + limit);
      const next = cursor + items.length < list.length ? cursor + items.length : '';
      return json(res, 200, { ok: true, type, total: list.length, items, next });
    } catch (error) {
      return respondPostgresError(res, error);
    }
  }

  async function handleSearch(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const actor = postgresActor(auth);
    try {
      const row = await postgresRepository.runtimeGetDissection(actor, id);
      if (!row) return json(res, 404, { error: '拆书任务不存在或无权访问' });
      if (!checkRecordOwner(row, auth, actor)) {
        return json(res, 404, { error: '拆书任务不存在或无权访问' });
      }
      const q = queryParamsFromUrl(req.url);
      const keyword = String(q.q || '').trim();
      if (keyword.length < 2) {
        return json(res, 200, { ok: true, items: [], query: keyword });
      }

      const rows = await postgresRepository.runtimeListDissectionRows(actor, id);
      if (!Array.isArray(rows)) {
        throw Object.assign(new Error('PostgreSQL 拆书台账必须返回数组'), { status: 500, code: 'invalid_rows_format' });
      }

      const matched = [];
      for (const r of rows) {
        const table = String(r.source_table || r.sourceTable || '');
        if (table === 'dissection_units') {
          const doc = getRowDocument(r);
          const text = String(doc.text !== undefined ? doc.text : (doc.source_text !== undefined ? doc.source_text : (doc.content !== undefined ? doc.content : '')));
          const title = String(doc.title || '');
          const ordinal = Number(doc.ordinal !== undefined ? doc.ordinal : r.ordinal) || 0;
          const unitType = String(doc.unit_type || doc.unitType || 'scene');

          const idx = text.indexOf(keyword);
          if (idx >= 0) {
            const start = Math.max(0, idx - 15);
            const end = Math.min(text.length, idx + keyword.length + 15);
            const prefix = start > 0 ? '…' : '';
            const suffix = end < text.length ? '…' : '';
            const snippet = prefix + text.slice(start, idx) + '[' + text.slice(idx, idx + keyword.length) + ']' + text.slice(idx + keyword.length, end) + suffix;
            matched.push({
              ordinal,
              unitType,
              title,
              snippet
            });
          }
        }
      }

      matched.sort((a, b) => a.ordinal - b.ordinal);
      const items = matched.slice(0, 30);
      return json(res, 200, { ok: true, items, query: keyword });
    } catch (error) {
      return respondPostgresError(res, error);
    }
  }

  async function dispatch(req, res, u) {
    if (req.method !== 'GET') return false;
    if (u === '/api/dissections' || u === '/api/dissections/') {
      await handleList(req, res);
      return true;
    }
    const exportMatch = u.match(/^\/api\/dissections\/(d_[A-Za-z0-9_-]+)\/export$/);
    if (exportMatch) {
      await handleExport(req, res, exportMatch[1]);
      return true;
    }
    const coverageMatch = u.match(/^\/api\/dissections\/(d_[A-Za-z0-9_-]+)\/coverage$/);
    if (coverageMatch) {
      await handleCoverage(req, res, coverageMatch[1]);
      return true;
    }
    const unitsMatch = u.match(/^\/api\/dissections\/(d_[A-Za-z0-9_-]+)\/units$/);
    if (unitsMatch) {
      await handleUnits(req, res, unitsMatch[1]);
      return true;
    }
    const entitiesMatch = u.match(/^\/api\/dissections\/(d_[A-Za-z0-9_-]+)\/entities$/);
    if (entitiesMatch) {
      await handleEntities(req, res, entitiesMatch[1]);
      return true;
    }
    const foreshadowsMatch = u.match(/^\/api\/dissections\/(d_[A-Za-z0-9_-]+)\/foreshadows$/);
    if (foreshadowsMatch) {
      await handleForeshadows(req, res, foreshadowsMatch[1]);
      return true;
    }
    const summariesMatch = u.match(/^\/api\/dissections\/(d_[A-Za-z0-9_-]+)\/summaries$/);
    if (summariesMatch) {
      await handleSummaries(req, res, summariesMatch[1]);
      return true;
    }
    const validationMatch = u.match(/^\/api\/dissections\/(d_[A-Za-z0-9_-]+)\/validation$/);
    if (validationMatch) {
      await handleValidation(req, res, validationMatch[1]);
      return true;
    }
    const searchMatch = u.match(/^\/api\/dissections\/(d_[A-Za-z0-9_-]+)\/search$/);
    if (searchMatch) {
      await handleSearch(req, res, searchMatch[1]);
      return true;
    }
    const getMatch = u.match(/^\/api\/dissections\/(d_[A-Za-z0-9_-]+)$/);
    if (getMatch) {
      await handleGet(req, res, getMatch[1]);
      return true;
    }
    return false;
  }

  return {
    handleList,
    handleGet,
    handleExport,
    handleCoverage,
    handleUnits,
    handleEntities,
    handleForeshadows,
    handleSummaries,
    handleValidation,
    handleSearch,
    dispatch,
    computeDissectionStats,
    checkRecordOwner
  };
}

module.exports = { createPostgresDissectionReadService };
