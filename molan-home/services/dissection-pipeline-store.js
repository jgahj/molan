'use strict';

function createDissectionPipelineStore({ buildDissectionUnits, dbReady, dissectionWordCount, isPipelineFactUnit, normalizeEntityName, pipelineBatchCharsFor, toTokenCount, updateDissectionRecord, PIPELINE_BATCH_MAX_CHAPTERS, crypto, getDatabase }) {
  function loadDissectionChapters(id) {
    if (!dbReady()) return [];
    return getDatabase().prepare('SELECT id,chapter_id,chapter_no,title,text FROM dissection_chapters WHERE dissection_id = ? ORDER BY chapter_no ASC').all(id);
  }

  function loadAllChapterFacts(id) {
    if (!dbReady()) return [];
    return getDatabase().prepare('SELECT chapter_id,chapter_no,fact_json FROM dissection_chapter_facts WHERE dissection_id = ? ORDER BY chapter_no ASC').all(id).map(r => {
      let fact = {};
      try { fact = JSON.parse(r.fact_json || '{}'); } catch (_) {}
      return { chapterId: String(r.chapter_id || ''), chapterNo: Number(r.chapter_no) || 0, fact };
    });
  }

  function loadDissectionBatches(id) {
    if (!dbReady()) return [];
    return getDatabase().prepare('SELECT batch_no,chapter_from,chapter_to,status,tokens,error FROM dissection_batch_tasks WHERE dissection_id = ? ORDER BY batch_no ASC').all(id);
  }

  function storeDissectionUnits(record, units) {
    if (!dbReady()) return 0;
    // ★ P1-6 · 批量入库事务化：node:sqlite 的 DatabaseSync 虽无 db.transaction()，
    // 但支持手工 BEGIN/COMMIT。逐条自动提交会让千万字拆书（上万条 INSERT）在事件循环上
    // 阻塞数百毫秒且中途失败会留下半套数据；事务化后一次提交，既快又保证原子性。
    getDatabase().exec('BEGIN IMMEDIATE');
    try {
      getDatabase().prepare('DELETE FROM dissection_units WHERE dissection_id = ?').run(record.id);
      getDatabase().prepare('DELETE FROM dissection_chapters WHERE dissection_id = ?').run(record.id);
      getDatabase().prepare('DELETE FROM dissection_chapter_facts WHERE dissection_id = ?').run(record.id);
      getDatabase().prepare('DELETE FROM dissection_claims WHERE dissection_id = ?').run(record.id);
      const now = Date.now();
      const insUnit = getDatabase().prepare('INSERT INTO dissection_units (id,dissection_id,parent_id,unit_type,ordinal,title,source_file,source_start,source_end,text_hash,char_count,token_estimate,text,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      const insChapter = getDatabase().prepare('INSERT OR REPLACE INTO dissection_chapters (id,dissection_id,chapter_id,chapter_no,title,text,created_at) VALUES (?,?,?,?,?,?,?)');
      let chapterNo = 0;
      units.forEach(u => {
        insUnit.run(String(u.unitId), record.id, String(u.parentId || ''), String(u.unitType || 'chapter'), Number(u.ordinal) || 0, String(u.title || ''), String(u.sourceFile || ''), Number(u.sourceStart) || 0, Number(u.sourceEnd) || 0, String(u.textHash || ''), Number(u.charCount) || 0, Number(u.tokenEstimate) || 0, String(u.text || ''), now);
        if (isPipelineFactUnit(u)) {
          chapterNo += 1;
          const fallbackTitle = String(u.unitType) === 'segment' ? '片段 ' + chapterNo : (String(u.unitType) === 'preface' ? '前言' : '第 ' + chapterNo + ' 章');
          insChapter.run('dc_' + record.id + '_' + chapterNo, record.id, String(u.unitId), chapterNo, String(u.title || fallbackTitle), String(u.text || ''), now);
        }
      });
      // ★ 阶段4 · 同步 FTS5 检索索引（trigram 中文子串匹配）
      try {
        getDatabase().prepare('DELETE FROM dissection_units_fts WHERE dissection_id = ?').run(record.id);
        const insFts = getDatabase().prepare('INSERT INTO dissection_units_fts (dissection_id, unit_type, ordinal, title, body) VALUES (?,?,?,?,?)');
        units.forEach(u => {
          if (!String(u.text || '').trim()) return;
          insFts.run(record.id, String(u.unitType || 'chapter'), Number(u.ordinal) || 0, String(u.title || ''), String(u.text || ''));
        });
      } catch (error) { console.error('[拆书] FTS 索引同步失败 task=' + record.id + ':', error && error.message || error); }
      getDatabase().exec('COMMIT');
    } catch (error) {
      try { getDatabase().exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
    return units.length;
  }

  function loadDissectionUnits(dissectionId) {
    if (!dbReady()) return [];
    return getDatabase().prepare('SELECT id,parent_id,unit_type,ordinal,title,source_start,source_end,text_hash,char_count,token_estimate,text FROM dissection_units WHERE dissection_id = ? ORDER BY ordinal ASC').all(dissectionId).map(r => ({
      unitId: r.id, parentId: r.parent_id, unitType: r.unit_type, ordinal: r.ordinal, title: r.title,
      sourceStart: r.source_start, sourceEnd: r.source_end, textHash: r.text_hash, charCount: r.char_count,
      tokenEstimate: r.token_estimate, text: r.text
    }));
  }

  function storeDissectionChapters(record, chunks) {
    return storeDissectionUnits(record, chunks.map((c, i) => ({
      unitId: 'chapter-' + String(i + 1).padStart(4, '0'),
      unitType: 'chapter', ordinal: i + 1, title: String(c.label || '').replace(/（续.*/, ''),
      parentId: '', text: String(c.text || ''), sourceStart: 0, sourceEnd: String(c.text || '').length,
      textHash: crypto.createHash('sha1').update(String(c.text || '')).digest('hex').slice(0, 16),
      charCount: dissectionWordCount(String(c.text || '')), tokenEstimate: Math.ceil(String(c.text || '').length / 1.3)
    })));
  }

  function createDissectionBatches(record, units) {
    if (!dbReady()) return 0;
    getDatabase().prepare('DELETE FROM dissection_batch_tasks WHERE dissection_id = ?').run(record.id);
    const batchChars = pipelineBatchCharsFor(record);
    const batches = [];
    let cur = null;
    units.forEach((u, i) => {
      const len = String(u.text || '').length;
      if (!cur || cur.chars + len > batchChars || (i - cur.from) >= PIPELINE_BATCH_MAX_CHAPTERS) {
        cur = { from: i, to: i, chars: len };
        batches.push(cur);
      } else {
        cur.to = i;
        cur.chars += len;
      }
    });
    const now = Date.now();
    let n = 0;
    // ★ P1-6 · 批次划分事务化：一次提交，避免逐条自动提交阻塞事件循环
    getDatabase().exec('BEGIN IMMEDIATE');
    try {
      batches.forEach((b, idx) => {
        getDatabase().prepare('INSERT INTO dissection_batch_tasks (id,dissection_id,batch_no,chapter_from,chapter_to,status,tokens,error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
          .run('db_' + record.id + '_' + (idx + 1), record.id, idx + 1, b.from + 1, b.to + 1, 'queued', 0, '', now, now);
        n += 1;
      });
      getDatabase().exec('COMMIT');
    } catch (error) {
      try { getDatabase().exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
    return n;
  }

  function initializeDissectionPipeline(record, pipelineCandidate) {
    if (!pipelineCandidate || !dbReady()) return null;
    const units = buildDissectionUnits(record.sourceText);
    storeDissectionUnits(record, units);
    const batchTotal = createDissectionBatches(record, units);
    const factUnitCount = units.filter(isPipelineFactUnit).length;
    record.meta = {
      ...(record.meta || {}),
      pipeline: {
        unitTotal: units.length,
        unitCompleted: 0,
        factCoverage: 0,
        chapterCount: factUnitCount,
        batchTotal,
        batchDone: 0,
        phase: 'queued',
        aggregated: false,
        aggregationComplete: false,
        failedBatches: []
      },
      unitCount: units.length
    };
    return { units, batchTotal, factUnitCount };
  }

  function recordModelUsage(opts) {
    if (!dbReady() || !opts || !opts.requestId) return;
    try {
      const usage = opts.usage && typeof opts.usage === 'object' ? opts.usage : {};
      const inputTokens = toTokenCount(usage.totalTokens) === null && usage.promptTokens != null ? Number(usage.promptTokens) || 0 : 0;
      const outTokens = usage.completionTokens != null ? Number(usage.completionTokens) || 0 : 0;
      const creditCost = Number(usage.creditCost);
      const creditKnown = Number.isFinite(creditCost) && creditCost >= 0;
      const costSource = creditKnown ? (usage.creditCostSource || usage.costSource || 'upstream_usage') : 'unknown';
      getDatabase().prepare('INSERT OR IGNORE INTO model_usage (request_id,user_id,workspace_id,project_id,record_id,workflow_id,stage,unit_id,model,prompt_version,input_tokens,output_tokens,cached_input_tokens,retry_count,latency_ms,credit_cost,status,created_at,credit_known,cost_source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(
          String(opts.requestId).slice(0, 200),
          String(opts.userId || '').slice(0, 160),
          String(opts.workspaceId || '').slice(0, 160),
          String(opts.projectId || '').slice(0, 160),
          String(opts.recordId || '').slice(0, 200),
          String(opts.workflowId || '').slice(0, 200),
          String(opts.stage || '').slice(0, 60),
          String(opts.unitId || '').slice(0, 200),
          String(opts.model || '').slice(0, 120),
          String(opts.promptVersion || '').slice(0, 80),
          Math.max(0, inputTokens || Number(usage.promptTokens) || 0),
          Math.max(0, outTokens || Number(usage.completionTokens) || 0),
          Math.max(0, Number(usage.cachedInputTokens) || 0),
          Math.max(0, Number(opts.retryCount) || 0),
          Math.max(0, Number(opts.latencyMs) || 0),
          creditKnown ? creditCost : 0,
          String(usage.status || opts.status || '').slice(0, 40),
          Date.now(),
          creditKnown ? 1 : 0,
          costSource
        );
    } catch (e) {
      console.error('[model_usage] 记账失败:', e.message);
    }
  }

  function recordPipelineUsage(record, usage, stage) {
    if (!record) return;
    const key = String(stage || 'pipeline');
    const meta = { ...(record.meta || {}) };
    const stageUsage = { ...(meta.stageUsage || {}) };
    const prior = stageUsage[key] && typeof stageUsage[key] === 'object' ? stageUsage[key] : {};
    const totalTokens = toTokenCount(usage && usage.totalTokens);
    const creditCost = Number(usage && usage.creditCost);
    if (Number.isFinite(creditCost) && creditCost >= 0) {
      record.actualCredits = Math.round(((Number(record.actualCredits) || 0) + creditCost) * 100) / 100;
    }
    stageUsage[key] = {
      mode: 'pipeline',
      requestCount: (Number(prior.requestCount) || 0) + 1,
      creditCost: Math.round(((Number(prior.creditCost) || 0) + (Number.isFinite(creditCost) && creditCost >= 0 ? creditCost : 0)) * 100) / 100,
      totalTokens: totalTokens === null ? (prior.totalTokens == null ? null : Number(prior.totalTokens)) : (Number(prior.totalTokens) || 0) + totalTokens,
      usageUnavailableCount: (Number(prior.usageUnavailableCount) || 0) + (totalTokens === null ? 1 : 0),
      status: String((usage && usage.status) || (totalTokens === null ? 'usage_unavailable' : 'completed'))
    };
    record.meta = { ...meta, stageUsage };
    updateDissectionRecord(record);
  }

  function ensurePipelineRun(record, units) {
    if (!dbReady()) return '';
    const now = Date.now();
    const run = getDatabase().prepare('SELECT id FROM dissection_runs WHERE dissection_id = ? ORDER BY created_at DESC LIMIT 1').get(record.id);
    if (run) return run.id;
    const runId = 'run_' + record.id + '_' + now;
    getDatabase().prepare('INSERT INTO dissection_runs (id,dissection_id,pipeline_version,skill_version,prompt_version,model_policy_version,source_hash,status,unit_total,unit_completed,fact_coverage,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(runId, record.id, '2', '2', '2', '1', String(record.sourceHash || ''), 'running', units.length, 0, 0, now, now);
    return runId;
  }

  function updatePipelineRunProgress(dissectionId, runId, doneUnits, totalUnits) {
    if (!dbReady() || !runId) return;
    const coverage = totalUnits > 0 ? Math.min(1, Number((doneUnits / totalUnits).toFixed(4))) : 0;
    getDatabase().prepare('UPDATE dissection_runs SET unit_completed = ?, fact_coverage = ?, updated_at = ? WHERE id = ?').run(doneUnits, coverage, Date.now(), runId);
    getDatabase().prepare('UPDATE dissection_runs SET status = ?, updated_at = ? WHERE id = ? AND status = ?').run(coverage >= 1 ? 'completed' : 'running', Date.now(), runId, 'running');
  }

  function updateBatchStatus(record, batchNo, status, tokens, error) {
    getDatabase().prepare('UPDATE dissection_batch_tasks SET status = ?, tokens = ?, error = ?, updated_at = ? WHERE dissection_id = ? AND batch_no = ?')
      .run(status, tokens || 0, String(error || '').slice(0, 500), Date.now(), record.id, batchNo);
  }

  function buildDissectionEntities(record) {
    if (!dbReady()) return { entities: 0, aliases: 0, mentions: 0, candidates: 0 };
    const rows = getDatabase().prepare("SELECT unit_id, subject_id, status FROM dissection_claims WHERE dissection_id = ? AND claim_type = 'entity_mention'").all(record.id);
    // 第一级：本地规范化分组
    const groups = new Map();
    rows.forEach(r => {
      const name = String(r.subject_id || '').trim();
      if (!name) return;
      const norm = normalizeEntityName(name);
      if (!groups.has(norm)) groups.set(norm, { names: new Map(), units: new Set(), anyCandidate: false });
      const g = groups.get(norm);
      g.names.set(name, (g.names.get(name) || 0) + 1);
      g.units.add(r.unit_id);
      if (/candidate/i.test(String(r.status || ''))) g.anyCandidate = true;
    });
    // 第二级：规则合并 —— 名称包含 + 共同出场（同单元同现 ≥1 且量级接近），拒绝仅靠描述前缀误合并
    const shareUnit = (a, b) => {
      let shared = 0;
      for (const u of a.units) { if (b.units.has(u)) { shared += 1; if (shared >= 3) return true; } }
      return shared >= 1 && a.units.size <= b.units.size * 2;
    };
    const norms = [...groups.keys()];
    const mergeTo = new Map();
    norms.forEach(n => {
      const target = norms.find(m => m !== n && m.length > n.length && m.includes(n) && groups.get(m).units.size >= 2 && shareUnit(groups.get(n), groups.get(m)));
      if (target) mergeTo.set(n, target);
    });
    // 第三级：写入 entities / aliases / mentions
    getDatabase().prepare('DELETE FROM dissection_entities WHERE dissection_id = ?').run(record.id);
    getDatabase().prepare('DELETE FROM dissection_entity_aliases WHERE dissection_id = ?').run(record.id);
    getDatabase().prepare('DELETE FROM dissection_entity_mentions WHERE dissection_id = ?').run(record.id);
    const insEntity = getDatabase().prepare('INSERT OR REPLACE INTO dissection_entities (id,dissection_id,canonical_name,entity_type,first_unit_id,last_unit_id,mention_count,status,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
    const insAlias = getDatabase().prepare('INSERT OR REPLACE INTO dissection_entity_aliases (id,dissection_id,entity_id,alias,first_unit_id,created_at) VALUES (?,?,?,?,?,?)');
    const insMention = getDatabase().prepare('INSERT OR REPLACE INTO dissection_entity_mentions (id,dissection_id,entity_id,alias,unit_id,role,created_at) VALUES (?,?,?,?,?,?,?)');
    const now = Date.now();
    const seen = new Map();
    let e = 0, a = 0, m = 0, candidates = 0;
    rows.forEach(r => {
      const name = String(r.subject_id || '').trim();
      if (!name) return;
      let norm = normalizeEntityName(name);
      const canonNorm = mergeTo.get(norm) || norm;
      let entityId = seen.get(canonNorm);
      if (!entityId) {
        e += 1;
        entityId = 'ent_' + record.id + '_' + e;
        seen.set(canonNorm, entityId);
        const g = groups.get(canonNorm) || groups.get(norm);
        const canonicalName = g ? ([...g.names.entries()].sort((x, y) => y[1] - x[1])[0] || [name])[0] : name;
        const status = g && g.anyCandidate ? 'candidate' : 'confirmed';
        if (status === 'candidate') candidates += 1;
        insEntity.run(entityId, record.id, canonicalName, 'character', r.unit_id, r.unit_id, 0, status, '', now);
      }
      const g = groups.get(canonNorm) || groups.get(norm);
      const canonicalName = g ? ([...g.names.entries()].sort((x, y) => y[1] - x[1])[0] || [name])[0] : name;
      if (name !== canonicalName) {
        a += 1;
        insAlias.run('al_' + record.id + '_' + a, record.id, entityId, name, r.unit_id, now);
      }
      m += 1;
      insMention.run('me_' + record.id + '_' + m, record.id, entityId, name, r.unit_id, '', now);
    });
    // 回填 first/last/mention_count
    const upd = getDatabase().prepare('UPDATE dissection_entities SET first_unit_id = ?, last_unit_id = ?, mention_count = ? WHERE id = ?');
    getDatabase().prepare('SELECT entity_id, COUNT(*) n, MIN(unit_id) f, MAX(unit_id) l FROM dissection_entity_mentions WHERE dissection_id = ? GROUP BY entity_id').all(record.id).forEach(r2 => upd.run(r2.f, r2.l, r2.n, r2.entity_id));
    return { entities: e, aliases: a, mentions: m, candidates };
  }

  function buildDissectionEvents(record) {
    if (!dbReady()) return 0;
    const claims = getDatabase().prepare("SELECT unit_id, subject_id, predicate, object_value, source_start, source_end FROM dissection_claims WHERE dissection_id = ? AND claim_type = 'event'").all(record.id);
    getDatabase().prepare('DELETE FROM dissection_events WHERE dissection_id = ?').run(record.id);
    getDatabase().prepare('DELETE FROM dissection_event_edges WHERE dissection_id = ?').run(record.id);
    const ins = getDatabase().prepare('INSERT OR REPLACE INTO dissection_events (id,dissection_id,unit_id,title,summary,participants_json,narrative_volume,narrative_unit,world_time,pre_state,post_state,result,evidence_offset_start,evidence_offset_end,related_event_ids,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const now = Date.now();
    let n = 0;
    claims.forEach(r => {
      n += 1;
      const title = String(r.object_value || r.predicate || '').slice(0, 80);
      ins.run('ev_' + record.id + '_' + n, record.id, r.unit_id, title, String(r.predicate || ''), JSON.stringify([r.subject_id].filter(Boolean)), '', r.unit_id, '', '', '', '', Number(r.source_start) || 0, Number(r.source_end) || 0, '[]', now);
    });
    return n;
  }

  function dissectionUnitChapterMap(record) {
    const map = new Map();
    if (dbReady()) {
      try { getDatabase().prepare('SELECT chapter_id, chapter_no FROM dissection_chapters WHERE dissection_id = ?').all(record.id).forEach(r => map.set(r.chapter_id, Number(r.chapter_no) || 0)); } catch (_) {}
    }
    try { loadDissectionUnits(record.id).forEach(u => { if (!map.has(u.unitId)) map.set(u.unitId, u.ordinal); }); } catch (_) {}
    return map;
  }

  function storeDissectionForeshadows(record, foreshadowing) {
    if (!dbReady()) return 0;
    const list = Array.isArray(foreshadowing) ? foreshadowing : [];
    getDatabase().prepare('DELETE FROM dissection_foreshadows WHERE dissection_id = ?').run(record.id);
    if (!list.length) return 0;
    const now = Date.now();
    const runId = record.pipelineRunId || '';
    const unitToChapter = dissectionUnitChapterMap(record);
    const chapterToUnit = new Map();
    if (dbReady()) {
      try { getDatabase().prepare('SELECT chapter_id, chapter_no FROM dissection_chapters WHERE dissection_id = ?').all(record.id).forEach(r => chapterToUnit.set(Number(r.chapter_no), r.chapter_id)); } catch (_) {}
    }
    const ins = getDatabase().prepare('INSERT OR REPLACE INTO dissection_foreshadows (id,dissection_id,title,description,status,strength,setup_chapter,payoff_chapter,first_unit_id,last_reinforced_unit_id,payoff_unit_id,related_entity_ids,evidence_ids,confidence,run_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    let n = 0;
    list.forEach((f, i) => {
      const id = String(f.id || 'foreshadow-' + (i + 1)).slice(0, 80);
      const status = String(f.status || 'planned');
      const setupChapter = Number(f.setupChapter) || Number(f.plantedChapter) || 0;
      const payoffChapter = Number(f.payoffChapter) || Number(f.recoveredChapter) || 0;
      const firstUnit = chapterToUnit.get(setupChapter) || String(f.firstUnitId || '');
      const payoffUnit = chapterToUnit.get(payoffChapter) || String(f.payoffUnitId || '');
      ins.run(
        'fs_' + record.id + '_' + n,
        record.id,
        String(f.title || f.id || ('伏笔 ' + (i + 1))).slice(0, 80),
        String(f.description || f.expectedPayoff || '').slice(0, 500),
        status,
        String(f.strength || 'medium'),
        setupChapter,
        payoffChapter,
        firstUnit,
        String(f.lastReinforcedUnitId || firstUnit || ''),
        payoffUnit,
        JSON.stringify(Array.isArray(f.relatedEntityIds) ? f.relatedEntityIds.slice(0, 40) : []),
        JSON.stringify(Array.isArray(f.evidenceIds) ? f.evidenceIds.slice(0, 80) : []),
        Number(f.confidence) > 0 && Number(f.confidence) <= 1 ? Number(f.confidence) : 0.6,
        runId,
        now
      );
      n += 1;
    });
    return n;
  }

  function buildEntityStates(record) {
    if (!dbReady()) return 0;
    const unitToChapter = dissectionUnitChapterMap(record);
    const units = loadDissectionUnits(record.id);
    const factUnits = units
      .filter(isPipelineFactUnit)
      .map(unit => ({ unit, chapterNo: Number(unitToChapter.get(unit.unitId) || 0) }))
      .filter(item => item.chapterNo > 0);
    const maxChapter = Math.max(1, ...factUnits.map(item => item.chapterNo));
    // 阶段边界统一使用 chapterNo；不能把 volume 的全局 ordinal 写入状态表，
    // 否则 creation-context?chapterNo= 会在多卷作品中读到错误阶段。
    const stages = [];
    try {
      const volUnits = getDatabase().prepare("SELECT ordinal, title FROM dissection_units WHERE dissection_id = ? AND unit_type = 'volume' ORDER BY ordinal ASC").all(record.id);
      if (volUnits.length >= 2) {
        volUnits.forEach((v, i) => {
          const nextOrdinal = i + 1 < volUnits.length ? Number(volUnits[i + 1].ordinal) : Number.MAX_SAFE_INTEGER;
          const inVolume = factUnits.filter(item => {
            const ordinal = Number(item.unit.ordinal) || 0;
            return ordinal > Number(v.ordinal) && ordinal < nextOrdinal;
          }).map(item => item.chapterNo);
          const previous = stages[stages.length - 1];
          const from = inVolume.length ? Math.min(...inVolume) : (previous ? previous.to + 1 : 1);
          const to = inVolume.length ? Math.max(...inVolume) : Math.max(from, previous ? Math.min(maxChapter, from + 49) : maxChapter);
          if (from <= maxChapter) stages.push({ key: String(v.title || ('第' + (i + 1) + '卷')).slice(0, 40), from, to: Math.min(maxChapter, Math.max(from, to)) });
        });
      }
    } catch (_) {}
    if (!stages.length) {
      const per = 50;
      for (let s = 1; s <= maxChapter; s += per) stages.push({ key: '第 ' + Math.floor((s - 1) / per + 1) + ' 阶段', from: s, to: Math.min(maxChapter, s + per - 1) });
    }
    getDatabase().prepare('DELETE FROM dissection_entity_states WHERE dissection_id = ?').run(record.id);
    const now = Date.now();
    const ins = getDatabase().prepare('INSERT OR REPLACE INTO dissection_entity_states (id,dissection_id,entity_id,stage_key,unit_from,unit_to,state_snapshot_json,created_at) VALUES (?,?,?,?,?,?,?,?)');
    // 每个实体的 state_change + 关系 claims 按阶段聚合
    const entities = getDatabase().prepare('SELECT id, canonical_name FROM dissection_entities WHERE dissection_id = ?').all(record.id);
    const stateChanges = getDatabase().prepare("SELECT unit_id, subject_id, predicate, object_value, status FROM dissection_claims WHERE dissection_id = ? AND claim_type = 'state_change'").all(record.id);
    const relClaims = getDatabase().prepare("SELECT unit_id, subject_id, predicate, object_value, status FROM dissection_claims WHERE dissection_id = ? AND claim_type = 'relationship'").all(record.id);
    let n = 0;
    entities.forEach(ent => {
      const id = String(ent.id || '');
      const changeFor = stateChanges.filter(c => String(c.subject_id || '').trim() === ent.canonical_name);
      const relFor = relClaims.filter(c => String(c.subject_id || '').trim() === ent.canonical_name);
      if (!changeFor.length && !relFor.length) return;
      stages.forEach(stage => {
        const changes = changeFor.filter(c => {
          const no = unitToChapter.get(c.unit_id) || 0;
          return no >= stage.from && no <= stage.to;
        }).map(c => String(c.predicate || '').slice(0, 120));
        const rels = relFor.filter(c => {
          const no = unitToChapter.get(c.unit_id) || 0;
          return no >= stage.from && no <= stage.to;
        }).map(c => (c.object_value ? c.subject_id + ' ↔ ' + c.object_value : c.predicate)).slice(0, 40);
        const snapshot = {
          statusChanges: changes.slice(0, 60),
          relationships: rels,
          at: '第' + stage.from + '-' + stage.to + '章',
          source: 'state_change/relationship claims'
        };
        if (!changes.length && !rels.length) return;
        n += 1;
        ins.run('es_' + record.id + '_' + n, record.id, id, stage.key, stage.from, stage.to, JSON.stringify(snapshot), now);
      });
    });
    return n;
  }

  function buildEventEdges(record) {
    if (!dbReady()) return 0;
    const events = getDatabase().prepare('SELECT id, unit_id, participants_json FROM dissection_events WHERE dissection_id = ? ORDER BY rowid ASC').all(record.id);
    getDatabase().prepare('DELETE FROM dissection_event_edges WHERE dissection_id = ?').run(record.id);
    if (events.length < 2) return 0;
    const unitToChapter = dissectionUnitChapterMap(record);
    const now = Date.now();
    const ins = getDatabase().prepare('INSERT OR REPLACE INTO dissection_event_edges (id,dissection_id,source_event_id,target_event_id,relation_type,description,created_at) VALUES (?,?,?,?,?,?,?)');
    const byUnit = new Map();
    events.forEach(ev => {
      if (!byUnit.has(ev.unit_id)) byUnit.set(ev.unit_id, []);
      byUnit.get(ev.unit_id).push(ev);
    });
    const participants = ev => { try { const v = JSON.parse(ev.participants_json || '[]'); return Array.isArray(v) ? v.map(String) : []; } catch (_) { return []; } };
    const shared = (a, b) => { const pa = new Set(participants(a)); return participants(b).some(p => pa.has(p)); };
    let n = 0;
    // 同单元共现
    byUnit.forEach(list => {
      for (let i = 1; i < list.length; i += 1) {
        if (shared(list[i - 1], list[i])) {
          n += 1;
          ins.run('de_' + record.id + '_' + n, record.id, list[i - 1].id, list[i].id, 'co_occurs', '同单元共同参与者', now);
        }
      }
    });
    // 相邻单元同参与者承接（因果/连续）
    const ordered = events.slice().sort((a, b) => (unitToChapter.get(a.unit_id) || 0) - (unitToChapter.get(b.unit_id) || 0) || (a.id < b.id ? -1 : 1));
    for (let i = 1; i < ordered.length; i += 1) {
      const prev = ordered[i - 1], cur = ordered[i];
      const dPrev = unitToChapter.get(prev.unit_id) || 0, dCur = unitToChapter.get(cur.unit_id) || 0;
      if (dCur - dPrev <= 2 && dCur > 0 && shared(prev, cur)) {
        n += 1;
        ins.run('de_' + record.id + '_' + n, record.id, prev.id, cur.id, 'carries_over', '跨章节承接（共同参与者）', now);
      }
    }
    return n;
  }

  return { loadDissectionChapters, loadAllChapterFacts, loadDissectionBatches, storeDissectionUnits, loadDissectionUnits, storeDissectionChapters, createDissectionBatches, initializeDissectionPipeline, recordModelUsage, recordPipelineUsage, ensurePipelineRun, updatePipelineRunProgress, updateBatchStatus, buildDissectionEntities, buildDissectionEvents, dissectionUnitChapterMap, storeDissectionForeshadows, buildEntityStates, buildEventEdges };
}

module.exports = { createDissectionPipelineStore };
