'use strict';

function createDissectionQueryService({ dbReady, dissectionResultView, getAuthUser, json, loadDissectionRecord, getDatabase }) {
  function queryParamsFromUrl(url) {
    const idx = String(url || '').indexOf('?');
    const out = {};
    if (idx < 0) return out;
    new URLSearchParams(String(url).slice(idx + 1)).forEach((v, k) => { out[k] = v; });
    return out;
  }

  function dissectionPipelineStats(record) {
    const p = (record.meta && record.meta.pipeline) || {};
    let entities = 0, candidates = 0, mentions = 0, events = 0, summaries = 0, claims = 0, units = 0, foreshadows = 0, edges = 0, states = 0;
    if (dbReady()) {
      try { entities = getDatabase().prepare('SELECT COUNT(*) n FROM dissection_entities WHERE dissection_id=?').get(record.id).n || 0; } catch (_) {}
      try { candidates = getDatabase().prepare("SELECT COUNT(*) n FROM dissection_entities WHERE dissection_id=? AND status='candidate'").get(record.id).n || 0; } catch (_) {}
      try { mentions = getDatabase().prepare('SELECT COUNT(*) n FROM dissection_entity_mentions WHERE dissection_id=?').get(record.id).n || 0; } catch (_) {}
      try { events = getDatabase().prepare('SELECT COUNT(*) n FROM dissection_events WHERE dissection_id=?').get(record.id).n || 0; } catch (_) {}
      try { summaries = getDatabase().prepare('SELECT COUNT(*) n FROM dissection_summaries WHERE dissection_id=?').get(record.id).n || 0; } catch (_) {}
      try { claims = getDatabase().prepare('SELECT COUNT(*) n FROM dissection_claims WHERE dissection_id=?').get(record.id).n || 0; } catch (_) {}
      try { units = getDatabase().prepare('SELECT COUNT(*) n FROM dissection_units WHERE dissection_id=?').get(record.id).n || 0; } catch (_) {}
      try { foreshadows = getDatabase().prepare('SELECT COUNT(*) n FROM dissection_foreshadows WHERE dissection_id=?').get(record.id).n || 0; } catch (_) {}
      try { edges = getDatabase().prepare('SELECT COUNT(*) n FROM dissection_event_edges WHERE dissection_id=?').get(record.id).n || 0; } catch (_) {}
      try { states = getDatabase().prepare('SELECT COUNT(*) n FROM dissection_entity_states WHERE dissection_id=?').get(record.id).n || 0; } catch (_) {}
    }
    return {
      unitTotal: p.unitTotal || units, unitCompleted: p.unitCompleted || 0,
      factCoverage: Number(p.factCoverage || 0), batchTotal: p.batchTotal || 0, batchDone: p.batchDone || 0,
      failedBatches: p.failedBatches || [], aggregated: !!p.aggregated, validationStatus: p.validationStatus || null,
      entities, candidates, mentions, events, summaries, claims, foreshadows, edges, states
    };
  }

  function handleDissectionCoverage(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const record = loadDissectionRecord(id, auth.user.email);
    if (!record) return json(res, 404, { error: '拆书任务不存在或无权访问' });
    json(res, 200, { ok: true, coverage: dissectionPipelineStats(record) });
  }

  function handleDissectionUnitsPage(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const record = loadDissectionRecord(id, auth.user.email);
    if (!record) return json(res, 404, { error: '拆书任务不存在或无权访问' });
    const q = queryParamsFromUrl(req.url);
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    const cursor = Number(q.cursor) || 0;
    if (!dbReady()) return json(res, 200, { ok: true, items: [], next: '' });
    const rows = getDatabase().prepare('SELECT id,parent_id,unit_type,ordinal,title,source_start,source_end,char_count,token_estimate FROM dissection_units WHERE dissection_id=? AND ordinal > ? ORDER BY ordinal ASC LIMIT ?').all(id, cursor, limit + 1);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    json(res, 200, { ok: true, items, next: hasMore ? items[items.length - 1].ordinal : '' });
  }

  function handleDissectionEntitiesPage(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const record = loadDissectionRecord(id, auth.user.email);
    if (!record) return json(res, 404, { error: '拆书任务不存在或无权访问' });
    const q = queryParamsFromUrl(req.url);
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    if (!dbReady()) return json(res, 200, { ok: true, items: [], next: '' });
    let cursor = null;
    const rawCursor = String(q.cursor || '').trim();
    if (rawCursor) {
      try {
        const decoded = JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8'));
        if (decoded && Number.isFinite(Number(decoded.mentionCount))) cursor = { mentionCount: Number(decoded.mentionCount), canonicalName: String(decoded.canonicalName || ''), id: String(decoded.id || '') };
      } catch (_) {
        const legacy = Number(rawCursor);
        if (Number.isFinite(legacy)) cursor = { mentionCount: legacy, canonicalName: '', id: '' };
      }
    }
    const sql = cursor
      ? 'SELECT id,canonical_name,entity_type,first_unit_id,last_unit_id,mention_count,status FROM dissection_entities WHERE dissection_id=? AND (mention_count < ? OR (mention_count = ? AND (canonical_name > ? OR (canonical_name = ? AND id > ?)))) ORDER BY mention_count DESC, canonical_name ASC, id ASC LIMIT ?'
      : 'SELECT id,canonical_name,entity_type,first_unit_id,last_unit_id,mention_count,status FROM dissection_entities WHERE dissection_id=? ORDER BY mention_count DESC, canonical_name ASC, id ASC LIMIT ?';
    const rows = cursor
      ? getDatabase().prepare(sql).all(id, cursor.mentionCount, cursor.mentionCount, cursor.canonicalName, cursor.canonicalName, cursor.id, limit + 1)
      : getDatabase().prepare(sql).all(id, limit + 1);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    const next = hasMore && last
      ? Buffer.from(JSON.stringify({ mentionCount: Number(last.mention_count) || 0, canonicalName: String(last.canonical_name || ''), id: String(last.id || '') })).toString('base64url')
      : '';
    json(res, 200, { ok: true, items, next });
  }

  function handleDissectionForeshadowsPage(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const record = loadDissectionRecord(id, auth.user.email);
    if (!record) return json(res, 404, { error: '拆书任务不存在或无权访问' });
    const q = queryParamsFromUrl(req.url);
    const limit = Math.min(300, Math.max(1, Number(q.limit) || 50));
    const cursor = Number(q.cursor) || 0;
    // ★ 阶段2 · 伏笔生命周期：优先读 dissection_foreshadows 台账（含埋设/回收章、相关实体、置信度），回退 result
    let list = [];
    if (dbReady()) {
      try {
        list = getDatabase().prepare('SELECT id,title,description,status,strength,setup_chapter,payoff_chapter,related_entity_ids,evidence_ids,confidence FROM dissection_foreshadows WHERE dissection_id = ?').all(id)
          .map(r => ({ id: r.id, title: r.title, description: r.description, status: r.status, strength: r.strength, setupChapter: r.setup_chapter, payoffChapter: r.payoff_chapter, relatedEntityIds: JSON.parse(r.related_entity_ids || '[]'), evidenceIds: JSON.parse(r.evidence_ids || '[]'), confidence: r.confidence }));
      } catch (_) { list = []; }
    }
    if (!list.length) {
      const result = dissectionResultView(record.result);
      list = Array.isArray(result.foreshadowing) ? result.foreshadowing : [];
    }
    if (q.status) list = list.filter(f => String(f.status) === q.status);
    const items = list.slice(cursor, cursor + limit);
    json(res, 200, { ok: true, total: list.length, items, next: cursor + items.length < list.length ? cursor + items.length : '' });
  }

  function handleDissectionSummariesPage(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const record = loadDissectionRecord(id, auth.user.email);
    if (!record) return json(res, 404, { error: '拆书任务不存在或无权访问' });
    const q = queryParamsFromUrl(req.url);
    const limit = Math.min(300, Math.max(1, Number(q.limit) || 50));
    const cursor = Number(q.cursor) || 0;
    const type = String(q.type || 'volume');
    // ★ 阶段2 · 四级分层摘要查询：chapter / arc / volume / book
    // 优先读 summaries 表（result_json 只是物化视图，不作为唯一事实来源），缺省回退到 result。
    let list = [];
    if (dbReady()) {
      try {
        const rows = getDatabase().prepare('SELECT id, owner_id, content_json, child_ids_json FROM dissection_summaries WHERE dissection_id = ? AND summary_type = ? ORDER BY rowid ASC').all(record.id, type);
        list = rows.map(r => { let c = {}; try { c = JSON.parse(r.content_json || '{}'); } catch (_) {} return { id: r.id, ownerId: r.owner_id, childIds: JSON.parse(r.child_ids_json || '[]'), ...c }; });
      } catch (_) { list = []; }
    }
    if (!list.length) {
      const result = dissectionResultView(record.result);
      if (type === 'chapter') list = result.chapterSummaries || [];
      else if (type === 'arc') list = result.arcSummaries || [];
      else if (type === 'book') list = result.bookSummary ? [result.bookSummary] : [];
      else list = result.volumeSummaries || [];
    }
    const items = list.slice(cursor, cursor + limit);
    json(res, 200, { ok: true, type, total: list.length, items, next: cursor + items.length < list.length ? cursor + items.length : '' });
  }

  function handleDissectionValidation(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const record = loadDissectionRecord(id, auth.user.email);
    if (!record) return json(res, 404, { error: '拆书任务不存在或无权访问' });
    const result = dissectionResultView(record.result);
    json(res, 200, { ok: true, validation: result.validation || { conclusion: 'unknown' }, stats: dissectionPipelineStats(record) });
  }

  function handleDissectionSearch(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const record = loadDissectionRecord(id, auth.user.email);
    if (!record) return json(res, 404, { error: '拆书任务不存在或无权访问' });
    const q = queryParamsFromUrl(req.url);
    const keyword = String(q.q || '').trim();
    if (!dbReady() || keyword.length < 2) return json(res, 200, { ok: true, items: [], query: keyword });
    try {
      const rows = getDatabase().prepare("SELECT ordinal, unit_type, title, snippet(dissection_units_fts, 4, '[', ']', '…', 28) AS snip FROM dissection_units_fts WHERE dissection_units_fts MATCH ? AND dissection_id = ? ORDER BY rank LIMIT 30").all('"' + keyword.replace(/"/g, '') + '"', id);
      json(res, 200, { ok: true, items: rows.map(r => ({ ordinal: r.ordinal, unitType: r.unit_type, title: r.title, snippet: r.snip })), query: keyword });
    } catch (_) {
      // FTS 语法错误时降级 LIKE 模糊匹配
      const rows = getDatabase().prepare("SELECT id, unit_type, ordinal, title FROM dissection_units WHERE dissection_id=? AND text LIKE ? ORDER BY ordinal ASC LIMIT 30").all(id, '%' + keyword + '%');
      json(res, 200, { ok: true, items: rows.map(r => ({ ordinal: r.ordinal, unitType: r.unit_type, title: r.title, snippet: r.title })), query: keyword });
    }
  }

  return { queryParamsFromUrl, dissectionPipelineStats, handleDissectionCoverage, handleDissectionUnitsPage, handleDissectionEntitiesPage, handleDissectionForeshadowsPage, handleDissectionSummariesPage, handleDissectionValidation, handleDissectionSearch };
}

module.exports = { createDissectionQueryService };
