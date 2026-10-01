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
    dispatch,
    computeDissectionStats,
    checkRecordOwner
  };
}

module.exports = { createPostgresDissectionReadService };
