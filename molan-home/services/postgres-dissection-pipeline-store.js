'use strict';

/**
 * PostgreSQL 原生拆书流水线存储服务。
 * 所有流水线状态与派生数据均持久化在 luna.runtime_dissection_rows 中，
 * 绝不使用 SQLite / getDatabase() / db.prepare / pureJs。
 */
function createPostgresDissectionPipelineStore({
  postgresRepository,
  buildDissectionUnits,
  dissectionWordCount,
  isPipelineFactUnit,
  normalizeEntityName,
  normalizePipelineEventType,
  pipelineBatchCharsFor,
  toTokenCount,
  PIPELINE_BATCH_MAX_CHAPTERS = 8,
  PIPELINE_MIN_CHAPTERS = 5,
  crypto
}) {
  if (!postgresRepository) {
    throw new Error('[postgres-dissection-pipeline-store] postgresRepository 必须提供');
  }

  function parseDoc(row) {
    if (!row) throw new Error('[postgres-dissection-pipeline-store] 行数据为空');
    let doc = row.document;
    if (typeof doc === 'string') {
      try {
        doc = JSON.parse(doc);
      } catch (err) {
        throw new Error(`[postgres-dissection-pipeline-store] 损坏的 JSON 文档: ${err.message}`);
      }
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      throw new Error('[postgres-dissection-pipeline-store] 文档非合法对象');
    }
    return doc;
  }

  function getActor(actorUserId, record) {
    const actor = String(actorUserId || (record && (record.ownerUserId || record.userId)) || '').trim();
    if (!actor) {
      throw new Error('[postgres-dissection-pipeline-store] 缺少有效的 actorUserId');
    }
    return actor;
  }

  function resolveActorAndId(actorUserId, dissectionId) {
    if (actorUserId && typeof actorUserId === 'object') {
      const rec = actorUserId;
      const actor = String(rec.ownerUserId || rec.userId || '').trim();
      const dId = String(rec.id || dissectionId || '').trim();
      if (!actor) throw new Error('[postgres-dissection-pipeline-store] 缺少有效的 actorUserId');
      if (!dId) throw new Error('[postgres-dissection-pipeline-store] 缺少有效的 dissectionId');
      return { actor, dissectionId: dId, record: rec };
    }
    const actor = String(actorUserId || '').trim();
    const dId = String(dissectionId || '').trim();
    if (!actor) throw new Error('[postgres-dissection-pipeline-store] 缺少有效的 actorUserId');
    if (!dId) throw new Error('[postgres-dissection-pipeline-store] 缺少有效的 dissectionId');
    return { actor, dissectionId: dId };
  }

  function resolveActorAndRecord(actorUserId, record) {
    if (actorUserId && typeof actorUserId === 'object' && actorUserId.id && (!record || Array.isArray(record) || typeof record !== 'object' || !record.id)) {
      const rec = actorUserId;
      const actor = String(rec.ownerUserId || rec.userId || '').trim();
      if (!actor) throw new Error('[postgres-dissection-pipeline-store] 缺少有效的 actorUserId');
      return { actor, record: rec, shifted: true };
    }
    const actor = String(actorUserId || (record && (record.ownerUserId || record.userId)) || '').trim();
    if (!actor) throw new Error('[postgres-dissection-pipeline-store] 缺少有效的 actorUserId');
    return { actor, record, shifted: false };
  }

  async function loadDissectionChapters(actorUserId, dissectionId) {
    const { actor, dissectionId: dId } = resolveActorAndId(actorUserId, dissectionId);
    const rows = await postgresRepository.runtimeListDissectionRows(actor, dId, 'dissection_chapters');
    return rows.map(r => {
      const doc = parseDoc(r);
      return {
        id: String(doc.id || r.row_key || ''),
        chapter_id: String(doc.chapter_id || doc.chapterId || ''),
        chapter_no: Number(doc.chapter_no != null ? doc.chapter_no : doc.chapterNo) || 0,
        title: String(doc.title || ''),
        text: String(doc.text || '')
      };
    }).sort((a, b) => a.chapter_no - b.chapter_no);
  }

  async function loadAllChapterFacts(actorUserId, dissectionId) {
    const { actor, dissectionId: dId } = resolveActorAndId(actorUserId, dissectionId);
    const rows = await postgresRepository.runtimeListDissectionRows(actor, dId, 'dissection_chapter_facts');
    return rows.map(r => {
      const doc = parseDoc(r);
      let fact = doc.fact;
      if (!fact && doc.fact_json) {
        fact = JSON.parse(doc.fact_json);
      }
      if (!fact || typeof fact !== 'object' || Array.isArray(fact)) {
        throw new Error('[postgres-dissection-pipeline-store] 章节事实文档损坏');
      }
      return {
        chapterId: String(doc.chapter_id || doc.chapterId || ''),
        chapterNo: Number(doc.chapter_no != null ? doc.chapter_no : doc.chapterNo) || 0,
        fact: fact && typeof fact === 'object' ? fact : {}
      };
    }).sort((a, b) => a.chapterNo - b.chapterNo);
  }

  async function loadDissectionBatches(actorUserId, dissectionId) {
    const { actor, dissectionId: dId } = resolveActorAndId(actorUserId, dissectionId);
    const rows = await postgresRepository.runtimeListDissectionRows(actor, dId, 'dissection_batch_tasks');
    return rows.map(r => {
      const doc = parseDoc(r);
      return {
        batch_no: Number(doc.batch_no != null ? doc.batch_no : doc.batchNo) || 0,
        chapter_from: Number(doc.chapter_from != null ? doc.chapter_from : doc.chapterFrom) || 0,
        chapter_to: Number(doc.chapter_to != null ? doc.chapter_to : doc.chapterTo) || 0,
        status: String(doc.status || 'queued'),
        tokens: Number(doc.tokens) || 0,
        error: String(doc.error || '')
      };
    }).sort((a, b) => a.batch_no - b.batch_no);
  }

  async function loadDissectionUnits(actorUserId, dissectionId) {
    const { actor, dissectionId: dId } = resolveActorAndId(actorUserId, dissectionId);
    const rows = await postgresRepository.runtimeListDissectionRows(actor, dId, 'dissection_units');
    return rows.map(r => {
      const doc = parseDoc(r);
      return {
        unitId: String(doc.unitId || doc.id || r.row_key || ''),
        parentId: String(doc.parentId || doc.parent_id || ''),
        unitType: String(doc.unitType || doc.unit_type || 'chapter'),
        ordinal: Number(doc.ordinal) || 0,
        title: String(doc.title || ''),
        sourceStart: Number(doc.sourceStart != null ? doc.sourceStart : doc.source_start) || 0,
        sourceEnd: Number(doc.sourceEnd != null ? doc.sourceEnd : doc.source_end) || 0,
        textHash: String(doc.textHash || doc.text_hash || ''),
        charCount: Number(doc.charCount != null ? doc.charCount : doc.char_count) || 0,
        tokenEstimate: Number(doc.tokenEstimate != null ? doc.tokenEstimate : doc.token_estimate) || 0,
        text: String(doc.text || '')
      };
    }).sort((a, b) => a.ordinal - b.ordinal);
  }

  async function storeDissectionUnits(actorUserId, record, units) {
    const resolved = resolveActorAndRecord(actorUserId, record);
    const actor = resolved.actor;
    const rec = resolved.record;
    const actualUnits = resolved.shifted ? record : units;
    const now = Date.now();
    const unitRows = [];
    const chapterRows = [];
    let chapterNo = 0;

    (Array.isArray(actualUnits) ? actualUnits : []).forEach(u => {
      const unitId = String(u.unitId || u.id);
      unitRows.push({
        rowKey: unitId,
        dissectionId: rec.id,
        sourceTable: 'dissection_units',
        sourceRowNo: Number(u.ordinal) || 0,
        document: {
          id: unitId,
          unitId,
          dissection_id: rec.id,
          parentId: String(u.parentId || ''),
          unitType: String(u.unitType || 'chapter'),
          ordinal: Number(u.ordinal) || 0,
          title: String(u.title || ''),
          sourceFile: String(u.sourceFile || ''),
          sourceStart: Number(u.sourceStart) || 0,
          sourceEnd: Number(u.sourceEnd) || 0,
          textHash: String(u.textHash || ''),
          charCount: Number(u.charCount) || 0,
          tokenEstimate: Number(u.tokenEstimate) || 0,
          text: String(u.text || ''),
          createdAt: now
        }
      });

      if (isPipelineFactUnit(u)) {
        chapterNo += 1;
        const fallbackTitle = String(u.unitType) === 'segment'
          ? '片段 ' + chapterNo
          : (String(u.unitType) === 'preface' ? '前言' : '第 ' + chapterNo + ' 章');
        const chapterRowKey = 'dc_' + rec.id + '_' + chapterNo;
        chapterRows.push({
          rowKey: chapterRowKey,
          dissectionId: rec.id,
          sourceTable: 'dissection_chapters',
          sourceRowNo: chapterNo,
          document: {
            id: chapterRowKey,
            dissection_id: rec.id,
            chapter_id: unitId,
            chapterId: unitId,
            chapter_no: chapterNo,
            chapterNo: chapterNo,
            title: String(u.title || fallbackTitle),
            text: String(u.text || ''),
            createdAt: now
          }
        });
      }
    });

    await postgresRepository.runtimeReplaceDissectionTables({
      actorUserId: actor,
      dissectionId: rec.id,
      tableGroups: [
        { sourceTable: 'dissection_units', rows: unitRows },
        { sourceTable: 'dissection_chapters', rows: chapterRows },
        { sourceTable: 'dissection_chapter_facts', rows: [] },
        { sourceTable: 'dissection_claims', rows: [] }
      ]
    });

    return Array.isArray(actualUnits) ? actualUnits.length : 0;
  }

  async function storeDissectionChapters(actorUserId, record, chunks) {
    const resolved = resolveActorAndRecord(actorUserId, record);
    const actor = resolved.actor;
    const rec = resolved.record;
    const actualChunks = resolved.shifted ? record : chunks;
    const hashFn = crypto ? (text) => crypto.createHash('sha1').update(text).digest('hex').slice(0, 16) : () => 'chunk';
    return storeDissectionUnits(actor, rec, (actualChunks || []).map((c, i) => ({
      unitId: 'chapter-' + String(i + 1).padStart(4, '0'),
      unitType: 'chapter',
      ordinal: i + 1,
      title: String(c.label || '').replace(/（续.*/, ''),
      parentId: '',
      text: String(c.text || ''),
      sourceStart: 0,
      sourceEnd: String(c.text || '').length,
      textHash: hashFn(String(c.text || '')),
      charCount: typeof dissectionWordCount === 'function' ? dissectionWordCount(String(c.text || '')) : String(c.text || '').length,
      tokenEstimate: Math.ceil(String(c.text || '').length / 1.3)
    })));
  }

  async function createDissectionBatches(actorUserId, record, units) {
    const resolved = resolveActorAndRecord(actorUserId, record);
    const actor = resolved.actor;
    const rec = resolved.record;
    const actualUnits = resolved.shifted ? record : units;
    const batchChars = typeof pipelineBatchCharsFor === 'function' ? pipelineBatchCharsFor(rec) : 12000;
    const batches = [];
    let cur = null;
    (Array.isArray(actualUnits) ? actualUnits : []).forEach((u, i) => {
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
    const batchRows = batches.map((b, idx) => {
      const batchNo = idx + 1;
      const rowKey = 'db_' + rec.id + '_' + batchNo;
      return {
        rowKey,
        dissectionId: rec.id,
        sourceTable: 'dissection_batch_tasks',
        sourceRowNo: batchNo,
        document: {
          id: rowKey,
          dissection_id: rec.id,
          batch_no: batchNo,
          batchNo: batchNo,
          chapter_from: b.from + 1,
          chapterFrom: b.from + 1,
          chapter_to: b.to + 1,
          chapterTo: b.to + 1,
          status: 'queued',
          tokens: 0,
          error: '',
          createdAt: now,
          updatedAt: now
        }
      };
    });

    await postgresRepository.runtimeReplaceDissectionRows({
      actorUserId: actor,
      dissectionId: rec.id,
      sourceTable: 'dissection_batch_tasks',
      rows: batchRows
    });

    return batchRows.length;
  }

  async function initializeDissectionPipeline(actorUserId, record, pipelineCandidate) {
    const resolved = resolveActorAndRecord(actorUserId, record);
    const actor = resolved.actor;
    const rec = resolved.record;
    const candidate = resolved.shifted ? record : pipelineCandidate;
    if (!candidate) return null;
    // 确保父记录在 PG 中先存在，才能加锁并写入子表
    const existing = await postgresRepository.runtimeGetDissection(actor, rec.id);
    if (!existing) {
      throw Object.assign(new Error('拆书任务不存在或无权初始化'), { code: 'not_found', status: 404 });
    }
    const units = buildDissectionUnits(rec.sourceText);
    await storeDissectionUnits(actor, rec, units);
    const batchTotal = await createDissectionBatches(actor, rec, units);
    const factUnitCount = units.filter(isPipelineFactUnit).length;
    rec.meta = {
      ...(rec.meta || {}),
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

  async function ensurePipelineRun(actorUserId, record, units) {
    const resolved = resolveActorAndRecord(actorUserId, record);
    const actor = resolved.actor;
    const rec = resolved.record;
    const actualUnits = resolved.shifted ? record : units;
    const now = Date.now();
    const existingRows = await postgresRepository.runtimeListDissectionRows(actor, rec.id, 'dissection_runs');
    if (existingRows.length) {
      const sorted = existingRows.slice().sort((a, b) => (parseDoc(b).createdAt || 0) - (parseDoc(a).createdAt || 0));
      const first = sorted[0];
      const doc = parseDoc(first);
      if (doc && doc.id) return doc.id;
    }
    const runId = 'run_' + rec.id + '_' + now;
    const runDoc = {
      id: runId,
      dissection_id: rec.id,
      pipeline_version: '2',
      skill_version: '2',
      prompt_version: '2',
      model_policy_version: '1',
      source_hash: String(rec.sourceHash || ''),
      status: 'running',
      unit_total: Array.isArray(actualUnits) ? actualUnits.length : 0,
      unit_completed: 0,
      fact_coverage: 0,
      created_at: now,
      updated_at: now,
      createdAt: now,
      updatedAt: now
    };
    await postgresRepository.runtimeUpsertDissectionRows(actor, [{
      rowKey: runId,
      dissectionId: rec.id,
      sourceTable: 'dissection_runs',
      document: runDoc
    }]);
    return runId;
  }

  async function updatePipelineRunProgress(actorUserId, dissectionId, runId, doneUnits, totalUnits) {
    let actor, dId, actualRunId, actualDone, actualTotal;
    if (actorUserId && typeof actorUserId === 'object' && actorUserId.id) {
      actor = String(actorUserId.ownerUserId || actorUserId.userId || '').trim();
      dId = actorUserId.id;
      actualRunId = dissectionId;
      actualDone = runId;
      actualTotal = doneUnits;
    } else {
      actor = String(actorUserId || '').trim();
      dId = dissectionId;
      actualRunId = runId;
      actualDone = doneUnits;
      actualTotal = totalUnits;
    }
    if (!actualRunId) return;
    const coverage = actualTotal > 0 ? Math.min(1, Number((actualDone / actualTotal).toFixed(4))) : 0;
    const now = Date.now();
    const rows = await postgresRepository.runtimeListDissectionRows(actor, dId, 'dissection_runs');
    const targetRow = rows.find(r => r.row_key === actualRunId || parseDoc(r).id === actualRunId);
    const currentDoc = targetRow ? parseDoc(targetRow) : {};
    const updatedDoc = {
      ...currentDoc,
      id: actualRunId,
      dissection_id: dId,
      unit_completed: actualDone,
      fact_coverage: coverage,
      status: coverage >= 1 ? 'completed' : 'running',
      updated_at: now,
      updatedAt: now
    };
    await postgresRepository.runtimeUpsertDissectionRows(actor, [{
      rowKey: actualRunId,
      dissectionId: dId,
      sourceTable: 'dissection_runs',
      document: updatedDoc
    }]);
  }

  async function updateBatchStatus(actorUserId, record, batchNo, status, tokens, error) {
    const resolved = resolveActorAndRecord(actorUserId, record);
    const actor = resolved.actor;
    const rec = resolved.record;
    const actualBatchNo = resolved.shifted ? record : batchNo;
    const actualStatus = resolved.shifted ? batchNo : status;
    const actualTokens = resolved.shifted ? status : tokens;
    const actualError = resolved.shifted ? tokens : error;
    const rowKey = 'db_' + rec.id + '_' + actualBatchNo;
    const rows = await postgresRepository.runtimeListDissectionRows(actor, rec.id, 'dissection_batch_tasks');
    const existing = rows.find(r => r.row_key === rowKey);
    const doc = existing ? parseDoc(existing) : {
      id: rowKey,
      dissection_id: rec.id,
      batch_no: actualBatchNo,
      batchNo: actualBatchNo
    };
    const now = Date.now();
    const updatedDoc = {
      ...doc,
      status: actualStatus,
      tokens: Number(actualTokens) || 0,
      error: String(actualError || '').slice(0, 500),
      updated_at: now,
      updatedAt: now
    };
    await postgresRepository.runtimeUpsertDissectionRows(actor, [{
      rowKey,
      dissectionId: rec.id,
      sourceTable: 'dissection_batch_tasks',
      sourceRowNo: actualBatchNo,
      document: updatedDoc
    }]);
  }

  async function dissectionUnitChapterMap(actorUserId, record) {
    const resolved = resolveActorAndRecord(actorUserId, record);
    const actor = resolved.actor;
    const rec = resolved.record;
    const map = new Map();
    const chapters = await loadDissectionChapters(actor, rec.id);
    chapters.forEach(c => map.set(c.chapter_id, Number(c.chapter_no) || 0));
    const units = await loadDissectionUnits(actor, rec.id);
    units.forEach(u => {
      if (!map.has(u.unitId)) map.set(u.unitId, u.ordinal);
    });
    return map;
  }

  async function saveBatchFactsAndClaims(actorUserId, record, batch, slice, unitFacts, chapterSeq, runId, usageTokens) {
    const resolved = resolveActorAndRecord(actorUserId, record);
    const actor = resolved.actor;
    const rec = resolved.record;
    const actualBatch = resolved.shifted ? record : batch;
    const actualSlice = resolved.shifted ? batch : slice;
    const actualUnitFacts = resolved.shifted ? slice : unitFacts;
    const actualChapterSeq = resolved.shifted ? unitFacts : chapterSeq;
    const actualRunId = resolved.shifted ? chapterSeq : runId;
    const actualTokens = resolved.shifted ? runId : usageTokens;
    const now = Date.now();
    const byId = new Map((actualUnitFacts || []).map(u => [String(u.unitId || '').trim(), u]));
    const claimRows = [];
    const factRows = [];
    let saved = 0;
    let c = 0;

    (Array.isArray(actualSlice) ? actualSlice : []).forEach(unit => {
      const uf = byId.get(unit.unitId) || {};
      const pushClaim = (claimType, subject, predicate, obj, status, confidence) => {
        c += 1;
        const conf = Number(confidence) > 0 && Number(confidence) <= 1 ? Number(confidence) : 0.8;
        const st = String(status || 'confirmed');
        const subj = String(subject || '').replace(/\(candidate\)/i, '').trim();
        const claimId = 'cl_' + rec.id + '_' + unit.unitId + '_' + c;
        claimRows.push({
          rowKey: claimId,
          dissectionId: rec.id,
          sourceTable: 'dissection_claims',
          document: {
            id: claimId,
            dissection_id: rec.id,
            unit_id: unit.unitId,
            unitId: unit.unitId,
            claim_type: claimType,
            claimType: claimType,
            subject_id: subj,
            subjectId: subj,
            predicate: String(predicate || ''),
            object_value: String(obj || ''),
            objectValue: String(obj || ''),
            evidence_type: 'direct',
            evidenceType: 'direct',
            source_start: Number(unit.sourceStart) || 0,
            sourceStart: Number(unit.sourceStart) || 0,
            source_end: Number(unit.sourceEnd) || 0,
            sourceEnd: Number(unit.sourceEnd) || 0,
            confidence: conf,
            status: /candidate/i.test(st) ? 'candidate' : 'confirmed',
            run_id: actualRunId,
            runId: actualRunId,
            createdAt: now
          }
        });
      };

      (Array.isArray(uf.events) ? uf.events : []).forEach(e => pushClaim('event', (Array.isArray(e.participants) && e.participants[0]) || '', '发生', e.title || e.summary || '', e.status, e.confidence));
      (Array.isArray(uf.stateChanges) ? uf.stateChanges : []).forEach(s2 => {
        const aspect = String(s2.aspect || '状态').trim();
        const isRelationship = aspect === '关系' || /关系/.test(aspect);
        const predicate = isRelationship
          ? '关系变化：' + (s2.from || '') + '→' + (s2.to || '')
          : aspect + '：' + (s2.from || '') + '→' + (s2.to || '');
        pushClaim(isRelationship ? 'relationship' : 'state_change', s2.entity || '', predicate, isRelationship ? (s2.to || '') : '', s2.status, s2.confidence);
      });
      (Array.isArray(uf.worldFacts) ? uf.worldFacts : []).forEach(w => pushClaim('world_fact', w.category || '', '设定', w.desc || '', w.status, w.confidence));
      (Array.isArray(uf.foreshadowActions) ? uf.foreshadowActions : []).forEach(f => pushClaim('foreshadow_action', f.ref || '', f.action || 'plant', f.desc || '', f.status, f.confidence));
      (Array.isArray(uf.emotionBeats) ? uf.emotionBeats : []).forEach(e => pushClaim('emotion_beat', e.type || '', '强度', String(e.intensity == null ? 5 : e.intensity) + '·' + (e.desc || ''), e.status, e.confidence));
      (Array.isArray(uf.entityMentions) ? uf.entityMentions : []).forEach(m => pushClaim('entity_mention', m.name || '', '登场', m.behavior || '', m.status, m.confidence));

      if (isPipelineFactUnit(unit)) {
        const chapterNo = (actualChapterSeq && actualChapterSeq.get ? actualChapterSeq.get(unit.unitId) : 0) || 0;
        const fact = {
          chapter_events: (Array.isArray(uf.events) ? uf.events.slice(0, 20) : []).map(e => ({ event: e.title || e.summary || '', characters: Array.isArray(e.participants) ? e.participants : [], type: normalizePipelineEventType(e.type), preState: e.preState || '', postState: e.postState || '', result: e.result || '' })),
          character_appear: (Array.isArray(uf.entityMentions) ? uf.entityMentions.slice(0, 24) : []).map(m => ({ name: m.name || '', behavior: m.behavior || '', emotion: m.emotion || '', is_new: !!m.isNew })),
          plot_clue: (Array.isArray(uf.foreshadowActions) ? uf.foreshadowActions.slice(0, 16) : []).map(f => ({ desc: f.desc || '', planted: f.action !== 'recover' && f.action !== 'payoff', recovered: f.action === 'recover' || f.action === 'payoff', ref: f.ref || '' })),
          spot_feeling: (Array.isArray(uf.emotionBeats) ? uf.emotionBeats.slice(0, 16) : []).map(e => ({ type: e.type || '', desc: e.desc || '', intensity: Number(e.intensity) || 5 })),
          world_info: (Array.isArray(uf.worldFacts) ? uf.worldFacts.slice(0, 12) : []).map(w => ({ category: w.category || '', desc: w.desc || '' }))
        };
        const factId = 'dcf_' + rec.id + '_' + chapterNo;
        factRows.push({
          rowKey: factId,
          dissectionId: rec.id,
          sourceTable: 'dissection_chapter_facts',
          sourceRowNo: chapterNo,
          document: {
            id: factId,
            dissection_id: rec.id,
            chapter_id: unit.unitId,
            chapterId: unit.unitId,
            chapter_no: chapterNo,
            chapterNo: chapterNo,
            fact_json: JSON.stringify(fact),
            fact: fact,
            tokens: Number(actualTokens) || 0,
            createdAt: now
          }
        });
      }
      saved += 1;
    });

    await postgresRepository.runtimeUpsertDissectionRows(actor, claimRows.concat(factRows));

    return saved;
  }

  async function buildDissectionEntities(actorUserId, record) {
    const resolved = resolveActorAndRecord(actorUserId, record);
    const actor = resolved.actor;
    const rec = resolved.record;
    const claimRows = await postgresRepository.runtimeListDissectionRows(actor, rec.id, 'dissection_claims');
    const mentionRows = claimRows.filter(r => {
      const doc = parseDoc(r);
      return String(doc.claim_type || doc.claimType || '') === 'entity_mention';
    }).map(r => {
      const doc = parseDoc(r);
      return {
        unit_id: String(doc.unit_id || doc.unitId || ''),
        subject_id: String(doc.subject_id || doc.subjectId || ''),
        status: String(doc.status || '')
      };
    });

    const groups = new Map();
    mentionRows.forEach(r => {
      const name = String(r.subject_id || '').trim();
      if (!name) return;
      const norm = normalizeEntityName(name);
      if (!groups.has(norm)) groups.set(norm, { names: new Map(), units: new Set(), anyCandidate: false });
      const g = groups.get(norm);
      g.names.set(name, (g.names.get(name) || 0) + 1);
      g.units.add(r.unit_id);
      if (/candidate/i.test(String(r.status || ''))) g.anyCandidate = true;
    });

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

    const now = Date.now();
    const seen = new Map();
    let e = 0, a = 0, m = 0, candidates = 0;
    const entityRowsMap = new Map();
    const aliasRows = [];
    const mentionRowsOut = [];

    mentionRows.forEach(r => {
      const name = String(r.subject_id || '').trim();
      if (!name) return;
      const norm = normalizeEntityName(name);
      const canonNorm = mergeTo.get(norm) || norm;
      let entityId = seen.get(canonNorm);
      if (!entityId) {
        e += 1;
        entityId = 'ent_' + rec.id + '_' + e;
        seen.set(canonNorm, entityId);
        const g = groups.get(canonNorm) || groups.get(norm);
        const canonicalName = g ? ([...g.names.entries()].sort((x, y) => y[1] - x[1])[0] || [name])[0] : name;
        const status = g && g.anyCandidate ? 'candidate' : 'confirmed';
        if (status === 'candidate') candidates += 1;
        entityRowsMap.set(entityId, {
          rowKey: entityId,
          dissectionId: rec.id,
          sourceTable: 'dissection_entities',
          sourceRowNo: e,
          document: {
            id: entityId,
            dissection_id: rec.id,
            canonical_name: canonicalName,
            canonicalName,
            entity_type: 'character',
            entityType: 'character',
            first_unit_id: r.unit_id,
            firstUnitId: r.unit_id,
            last_unit_id: r.unit_id,
            lastUnitId: r.unit_id,
            mention_count: 0,
            mentionCount: 0,
            status,
            notes: '',
            createdAt: now
          }
        });
      }
      const g = groups.get(canonNorm) || groups.get(norm);
      const canonicalName = g ? ([...g.names.entries()].sort((x, y) => y[1] - x[1])[0] || [name])[0] : name;
      if (name !== canonicalName) {
        a += 1;
        const aliasId = 'al_' + rec.id + '_' + a;
        aliasRows.push({
          rowKey: aliasId,
          dissectionId: rec.id,
          sourceTable: 'dissection_entity_aliases',
          sourceRowNo: a,
          document: {
            id: aliasId,
            dissection_id: rec.id,
            entity_id: entityId,
            entityId,
            alias: name,
            first_unit_id: r.unit_id,
            firstUnitId: r.unit_id,
            createdAt: now
          }
        });
      }
      m += 1;
      const mentionId = 'me_' + rec.id + '_' + m;
      mentionRowsOut.push({
        rowKey: mentionId,
        dissectionId: rec.id,
        sourceTable: 'dissection_entity_mentions',
        sourceRowNo: m,
        document: {
          id: mentionId,
          dissection_id: rec.id,
          entity_id: entityId,
          entityId,
          alias: name,
          unit_id: r.unit_id,
          unitId: r.unit_id,
          role: '',
          createdAt: now
        }
      });
    });

    // 回填 mention counts 与 first/last
    const mentionsByEntity = new Map();
    mentionRowsOut.forEach(mr => {
      const entId = mr.document.entity_id;
      if (!mentionsByEntity.has(entId)) mentionsByEntity.set(entId, []);
      mentionsByEntity.get(entId).push(mr.document.unit_id);
    });
    mentionsByEntity.forEach((unitIds, entId) => {
      const ent = entityRowsMap.get(entId);
      if (ent) {
        ent.document.mention_count = unitIds.length;
        ent.document.mentionCount = unitIds.length;
        ent.document.first_unit_id = unitIds[0];
        ent.document.firstUnitId = unitIds[0];
        ent.document.last_unit_id = unitIds[unitIds.length - 1];
        ent.document.lastUnitId = unitIds[unitIds.length - 1];
      }
    });

    await postgresRepository.runtimeReplaceDissectionTables({
      actorUserId: actor,
      dissectionId: rec.id,
      tableGroups: [
        { sourceTable: 'dissection_entities', rows: [...entityRowsMap.values()] },
        { sourceTable: 'dissection_entity_aliases', rows: aliasRows },
        { sourceTable: 'dissection_entity_mentions', rows: mentionRowsOut }
      ]
    });

    return { entities: e, aliases: a, mentions: m, candidates };
  }

  async function buildDissectionEvents(actorUserId, record) {
    const { actor, record: rec } = resolveActorAndRecord(actorUserId, record);
    const claimRows = await postgresRepository.runtimeListDissectionRows(actor, rec.id, 'dissection_claims');
    const eventClaims = claimRows.filter(r => {
      const doc = parseDoc(r);
      return String(doc.claim_type || doc.claimType || '') === 'event';
    }).map(r => parseDoc(r));

    const now = Date.now();
    const eventRows = eventClaims.map((r, idx) => {
      const n = idx + 1;
      const eventId = 'ev_' + rec.id + '_' + n;
      const title = String(r.object_value || r.objectValue || r.predicate || '').slice(0, 80);
      const participants = [r.subject_id || r.subjectId].filter(Boolean);
      return {
        rowKey: eventId,
        dissectionId: rec.id,
        sourceTable: 'dissection_events',
        sourceRowNo: n,
        document: {
          id: eventId,
          dissection_id: rec.id,
          unit_id: String(r.unit_id || r.unitId || ''),
          unitId: String(r.unit_id || r.unitId || ''),
          title,
          summary: String(r.predicate || ''),
          participants_json: JSON.stringify(participants),
          participants,
          narrative_volume: '',
          narrative_unit: String(r.unit_id || r.unitId || ''),
          world_time: '',
          pre_state: '',
          post_state: '',
          result: '',
          evidence_offset_start: Number(r.source_start != null ? r.source_start : r.sourceStart) || 0,
          evidence_offset_end: Number(r.source_end != null ? r.source_end : r.sourceEnd) || 0,
          related_event_ids: '[]',
          createdAt: now
        }
      };
    });

    await postgresRepository.runtimeReplaceDissectionTables({
      actorUserId: actor,
      dissectionId: rec.id,
      tableGroups: [
        { sourceTable: 'dissection_events', rows: eventRows },
        { sourceTable: 'dissection_event_edges', rows: [] }
      ]
    });

    return eventRows.length;
  }

  async function buildEntityStates(actorUserId, record) {
    const { actor, record: rec } = resolveActorAndRecord(actorUserId, record);
    const unitToChapter = await dissectionUnitChapterMap(actor, rec);
    const units = await loadDissectionUnits(actor, rec.id);
    const factUnits = units
      .filter(isPipelineFactUnit)
      .map(unit => ({ unit, chapterNo: Number(unitToChapter.get(unit.unitId) || 0) }))
      .filter(item => item.chapterNo > 0);
    const maxChapter = Math.max(1, ...factUnits.map(item => item.chapterNo));

    const stages = [];
    const volUnits = units.filter(u => String(u.unitType) === 'volume').sort((a, b) => a.ordinal - b.ordinal);
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
    if (!stages.length) {
      const per = 50;
      for (let s = 1; s <= maxChapter; s += per) stages.push({ key: '第 ' + Math.floor((s - 1) / per + 1) + ' 阶段', from: s, to: Math.min(maxChapter, s + per - 1) });
    }

    const entityRows = await postgresRepository.runtimeListDissectionRows(actor, rec.id, 'dissection_entities');
    const entities = entityRows.map(r => parseDoc(r));
    const claimRows = await postgresRepository.runtimeListDissectionRows(actor, rec.id, 'dissection_claims');
    const stateChanges = claimRows.filter(r => {
      const doc = parseDoc(r);
      return String(doc.claim_type || doc.claimType || '') === 'state_change';
    }).map(r => parseDoc(r));
    const relClaims = claimRows.filter(r => {
      const doc = parseDoc(r);
      return String(doc.claim_type || doc.claimType || '') === 'relationship';
    }).map(r => parseDoc(r));

    const now = Date.now();
    let n = 0;
    const stateRows = [];

    entities.forEach(ent => {
      const id = String(ent.id || '');
      const canon = String(ent.canonical_name || ent.canonicalName || '').trim();
      const changeFor = stateChanges.filter(c => String(c.subject_id || c.subjectId || '').trim() === canon);
      const relFor = relClaims.filter(c => String(c.subject_id || c.subjectId || '').trim() === canon);
      if (!changeFor.length && !relFor.length) return;

      stages.forEach(stage => {
        const changes = changeFor.filter(c => {
          const no = unitToChapter.get(c.unit_id || c.unitId) || 0;
          return no >= stage.from && no <= stage.to;
        }).map(c => String(c.predicate || '').slice(0, 120));
        const rels = relFor.filter(c => {
          const no = unitToChapter.get(c.unit_id || c.unitId) || 0;
          return no >= stage.from && no <= stage.to;
        }).map(c => {
          const s = c.subject_id || c.subjectId;
          const o = c.object_value || c.objectValue;
          return o ? s + ' ↔ ' + o : String(c.predicate || '');
        }).slice(0, 40);
        if (!changes.length && !rels.length) return;

        const snapshot = {
          statusChanges: changes.slice(0, 60),
          relationships: rels,
          at: '第' + stage.from + '-' + stage.to + '章',
          source: 'state_change/relationship claims'
        };
        n += 1;
        const stateId = 'es_' + rec.id + '_' + n;
        stateRows.push({
          rowKey: stateId,
          dissectionId: rec.id,
          sourceTable: 'dissection_entity_states',
          sourceRowNo: n,
          document: {
            id: stateId,
            dissection_id: rec.id,
            entity_id: id,
            entityId: id,
            stage_key: stage.key,
            stageKey: stage.key,
            unit_from: stage.from,
            unitFrom: stage.from,
            unit_to: stage.to,
            unitTo: stage.to,
            state_snapshot_json: JSON.stringify(snapshot),
            stateSnapshot: snapshot,
            createdAt: now
          }
        });
      });
    });

    await postgresRepository.runtimeReplaceDissectionRows({
      actorUserId: actor,
      dissectionId: rec.id,
      sourceTable: 'dissection_entity_states',
      rows: stateRows
    });

    return n;
  }

  async function buildEventEdges(actorUserId, record) {
    const { actor, record: rec } = resolveActorAndRecord(actorUserId, record);
    const eventRows = await postgresRepository.runtimeListDissectionRows(actor, rec.id, 'dissection_events');
    const events = eventRows.map(r => parseDoc(r)).sort((a, b) => (a.sourceRowNo || 0) - (b.sourceRowNo || 0));
    if (events.length < 2) {
      await postgresRepository.runtimeDeleteDissectionRows(actor, rec.id, 'dissection_event_edges');
      return 0;
    }

    const unitToChapter = await dissectionUnitChapterMap(actor, rec);
    const now = Date.now();
    const byUnit = new Map();
    events.forEach(ev => {
      const u = ev.unit_id || ev.unitId;
      if (!byUnit.has(u)) byUnit.set(u, []);
      byUnit.get(u).push(ev);
    });

    const participants = ev => {
      if (Array.isArray(ev.participants)) return ev.participants.map(String);
      const values = JSON.parse(ev.participants_json || '[]');
      if (!Array.isArray(values)) throw new Error('事件参与者文档损坏');
      return values.map(String);
    };
    const shared = (a, b) => {
      const pa = new Set(participants(a));
      return participants(b).some(p => pa.has(p));
    };

    let n = 0;
    const edgeRows = [];

    byUnit.forEach(list => {
      for (let i = 1; i < list.length; i += 1) {
        if (shared(list[i - 1], list[i])) {
          n += 1;
          const edgeId = 'de_' + rec.id + '_' + n;
          edgeRows.push({
            rowKey: edgeId,
            dissectionId: rec.id,
            sourceTable: 'dissection_event_edges',
            sourceRowNo: n,
            document: {
              id: edgeId,
              dissection_id: rec.id,
              source_event_id: list[i - 1].id,
              sourceEventId: list[i - 1].id,
              target_event_id: list[i].id,
              targetEventId: list[i].id,
              relation_type: 'co_occurs',
              relationType: 'co_occurs',
              description: '同单元共同参与者',
              createdAt: now
            }
          });
        }
      }
    });

    const ordered = events.slice().sort((a, b) => {
      const da = unitToChapter.get(a.unit_id || a.unitId) || 0;
      const db = unitToChapter.get(b.unit_id || b.unitId) || 0;
      return da - db || (a.id < b.id ? -1 : 1);
    });
    for (let i = 1; i < ordered.length; i += 1) {
      const prev = ordered[i - 1], cur = ordered[i];
      const dPrev = unitToChapter.get(prev.unit_id || prev.unitId) || 0;
      const dCur = unitToChapter.get(cur.unit_id || cur.unitId) || 0;
      if (dCur - dPrev <= 2 && dCur > 0 && shared(prev, cur)) {
        n += 1;
        const edgeId = 'de_' + rec.id + '_' + n;
        edgeRows.push({
          rowKey: edgeId,
          dissectionId: rec.id,
          sourceTable: 'dissection_event_edges',
          sourceRowNo: n,
          document: {
            id: edgeId,
            dissection_id: rec.id,
            source_event_id: prev.id,
            sourceEventId: prev.id,
            target_event_id: cur.id,
            targetEventId: cur.id,
            relation_type: 'carries_over',
            relationType: 'carries_over',
            description: '跨章节承接（共同参与者）',
            createdAt: now
          }
        });
      }
    }

    await postgresRepository.runtimeReplaceDissectionRows({
      actorUserId: actor,
      dissectionId: rec.id,
      sourceTable: 'dissection_event_edges',
      rows: edgeRows
    });

    return n;
  }

  async function storeDissectionForeshadows(actorUserId, record, foreshadowing) {
    const resolved = resolveActorAndRecord(actorUserId, record);
    const actor = resolved.actor;
    const rec = resolved.record;
    const list = Array.isArray(resolved.shifted ? record : foreshadowing) ? (resolved.shifted ? record : foreshadowing) : [];
    if (!list.length) {
      await postgresRepository.runtimeDeleteDissectionRows(actor, rec.id, 'dissection_foreshadows');
      return 0;
    }

    const now = Date.now();
    const runId = rec.pipelineRunId || '';
    const chapters = await loadDissectionChapters(actor, rec.id);
    const chapterToUnit = new Map();
    chapters.forEach(c => chapterToUnit.set(Number(c.chapter_no), c.chapter_id));

    const rows = list.map((f, i) => {
      const n = i + 1;
      const id = 'fs_' + rec.id + '_' + n;
      const status = String(f.status || 'planned');
      const setupChapter = Number(f.setupChapter) || Number(f.plantedChapter) || 0;
      const payoffChapter = Number(f.payoffChapter) || Number(f.recoveredChapter) || 0;
      const firstUnit = chapterToUnit.get(setupChapter) || String(f.firstUnitId || '');
      const payoffUnit = chapterToUnit.get(payoffChapter) || String(f.payoffUnitId || '');
      const relatedEntityIds = Array.isArray(f.relatedEntityIds) ? f.relatedEntityIds.slice(0, 40) : [];
      const evidenceIds = Array.isArray(f.evidenceIds) ? f.evidenceIds.slice(0, 80) : [];
      const confidence = Number(f.confidence) > 0 && Number(f.confidence) <= 1 ? Number(f.confidence) : 0.6;

      return {
        rowKey: id,
        dissectionId: rec.id,
        sourceTable: 'dissection_foreshadows',
        sourceRowNo: n,
        document: {
          id,
          dissection_id: rec.id,
          title: String(f.title || f.id || ('伏笔 ' + n)).slice(0, 80),
          description: String(f.description || f.expectedPayoff || '').slice(0, 500),
          status,
          strength: String(f.strength || 'medium'),
          setup_chapter: setupChapter,
          setupChapter,
          payoff_chapter: payoffChapter,
          payoffChapter,
          first_unit_id: firstUnit,
          firstUnitId: firstUnit,
          last_reinforced_unit_id: String(f.lastReinforcedUnitId || firstUnit || ''),
          lastReinforcedUnitId: String(f.lastReinforcedUnitId || firstUnit || ''),
          payoff_unit_id: payoffUnit,
          payoffUnitId: payoffUnit,
          related_entity_ids: JSON.stringify(relatedEntityIds),
          relatedEntityIds,
          evidence_ids: JSON.stringify(evidenceIds),
          evidenceIds,
          confidence,
          run_id: runId,
          runId,
          createdAt: now
        }
      };
    });

    await postgresRepository.runtimeReplaceDissectionRows({
      actorUserId: actor,
      dissectionId: rec.id,
      sourceTable: 'dissection_foreshadows',
      rows
    });

    return rows.length;
  }

  async function saveSummaries(actorUserId, dissectionId, summaryType, summaries) {
    let actor, dId, actualType, actualSummaries;
    if (actorUserId && typeof actorUserId === 'object' && actorUserId.id) {
      actor = String(actorUserId.ownerUserId || actorUserId.userId || '').trim();
      dId = actorUserId.id;
      actualType = dissectionId;
      actualSummaries = summaryType;
    } else {
      actor = String(actorUserId || '').trim();
      dId = String(dissectionId || '').trim();
      actualType = summaryType;
      actualSummaries = summaries;
    }
    const now = Date.now();
    const rows = (Array.isArray(actualSummaries) ? actualSummaries : []).map((s, idx) => {
      const summaryId = s.id || ('sum_' + dId + '_' + actualType + '_' + (idx + 1));
      return {
        rowKey: summaryId,
        dissectionId: dId,
        sourceTable: 'dissection_summaries',
        sourceRowNo: idx + 1,
        document: {
          id: summaryId,
          dissection_id: dId,
          summary_type: actualType,
          summaryType: actualType,
          owner_id: s.ownerId || s.owner_id || ('owner_' + idx),
          child_ids_json: JSON.stringify(s.childIds || s.child_ids || []),
          content_json: JSON.stringify(s.content || s),
          content: s.content || s,
          evidence_ids_json: JSON.stringify(s.evidenceIds || s.evidence_ids || []),
          coverage_json: JSON.stringify(s.coverage || {}),
          status: s.status || 'ok',
          version: Number(s.version) || 1,
          createdAt: now
        }
      };
    });

    await postgresRepository.runtimeReplaceDissectionSummaries({
      actorUserId: actor,
      dissectionId: dId,
      summaryType: actualType,
      rows
    });

    return rows.length;
  }

  async function loadSummaries(actorUserId, dissectionId, summaryType) {
    const { actor, dissectionId: dId } = resolveActorAndId(actorUserId, dissectionId);
    const actualType = (actorUserId && typeof actorUserId === 'object' && actorUserId.id) ? dissectionId : summaryType;
    const rows = await postgresRepository.runtimeListDissectionRows(actor, dId, 'dissection_summaries');
    return rows.filter(r => {
      const doc = parseDoc(r);
      return !actualType || String(doc.summary_type || doc.summaryType) === String(actualType);
    }).map(r => parseDoc(r));
  }

  async function syncCharactersToLibrary(actorUserId, record) {
    const { actor, record: rec } = resolveActorAndRecord(actorUserId, record);
    const chars = Array.isArray(rec.result && rec.result.characters) ? rec.result.characters : [];
    if (!chars.length) return 0;
    const now = Date.now();
    const userEmail = String(rec.userEmail || '').trim().toLowerCase();
    const hashFn = crypto ? (text) => crypto.createHash('sha1').update(text).digest('hex').slice(0, 16) : (t) => t.replace(/[^a-zA-Z0-9]/g, '_');

    const rows = [];
    chars.forEach(ch => {
      const name = String((ch && ch.name) || '').trim();
      if (!name) return;
      const rowKey = 'cl_' + hashFn(userEmail + '|' + name);
      rows.push({
        rowKey,
        dissectionId: rec.id,
        sourceTable: 'character_library',
        document: {
          id: rowKey,
          user_email: userEmail,
          userEmail,
          dissection_id: rec.id,
          dissectionId: rec.id,
          name,
          function: String(ch.function || ''),
          goal: String(ch.goal || ''),
          conflict: String(ch.conflict || ''),
          arc: String(ch.arc || ''),
          first_appearance: String(ch.firstAppearance || ''),
          firstAppearance: String(ch.firstAppearance || ''),
          notes: String(ch.notes || ''),
          createdAt: now
        }
      });
    });

    if (!rows.length) return 0;
    return postgresRepository.runtimeSyncCharactersToLibrary(actor, rows);
  }

  async function listCharactersInLibrary(actorUserId, userEmail) {
    const actor = getActor(actorUserId);
    // 从 runtime_dissection_rows 读取 source_table = 'character_library'
    const rows = await postgresRepository.runtimeListCharacterLibrary(actor);
    const targetEmail = String(userEmail || '').trim().toLowerCase();
    return rows.filter(r => {
      const doc = parseDoc(r);
      return !targetEmail || String(doc.user_email || doc.userEmail || '').trim().toLowerCase() === targetEmail;
    }).map(r => parseDoc(r));
  }

  async function dissectionContextForChapter(actorUserId, record, chapterNo) {
    const resolved = resolveActorAndRecord(actorUserId, record);
    const actor = resolved.actor;
    const rec = resolved.record;
    const chNo = resolved.shifted ? record : chapterNo;
    const upTo = Math.max(0, Number(chNo) || 0);
    const snapshot = { upTo, arcs: [], characterStates: [], timeline: [], foreshadows: [], volume: null, bookMap: null };

    // 故事弧摘要
    const summaryRows = await postgresRepository.runtimeListDissectionRows(actor, rec.id, 'dissection_summaries');
    const arcs = summaryRows.filter(r => {
      const doc = parseDoc(r);
      return String(doc.summary_type || doc.summaryType) === 'arc';
    }).map(r => {
      const doc = parseDoc(r);
      let c = doc.content || {};
      if (typeof c === 'string') {
        c = JSON.parse(c);
      }
      return { id: doc.id || r.row_key, ...c, range: c.range || '' };
    });
    snapshot.arcs = arcs.slice(0, 60);
    if (upTo > 0) {
      const current = arcs.find(a => {
        const m = String(a.range || '').match(/(\d+)-(\d+)/);
        return m && upTo >= Number(m[1]) && upTo <= Number(m[2]);
      });
      if (current) snapshot.currentArc = current;
    }

    // 人物状态快照
    const stateRows = await postgresRepository.runtimeListDissectionRows(actor, rec.id, 'dissection_entity_states');
    const entityRows = await postgresRepository.runtimeListDissectionRows(actor, rec.id, 'dissection_entities');
    const entityNames = new Map(entityRows.map(r => {
      const doc = parseDoc(r);
      return [doc.id || r.row_key, doc.canonical_name || doc.canonicalName || r.row_key];
    }));

    const byEntity = new Map();
    stateRows.forEach(r => {
      const doc = parseDoc(r);
      const unitFrom = Number(doc.unit_from != null ? doc.unit_from : doc.unitFrom) || 0;
      const unitTo = Number(doc.unit_to != null ? doc.unit_to : doc.unitTo) || 0;
      if (upTo > 0 && unitFrom > upTo) return;
      const entId = doc.entity_id || doc.entityId;
      if (!byEntity.has(entId)) byEntity.set(entId, []);
      let snap = doc.stateSnapshot || doc.state_snapshot_json;
      if (typeof snap === 'string') {
        snap = JSON.parse(snap);
      }
      byEntity.get(entId).push({
        stage: doc.stage_key || doc.stageKey,
        from: unitFrom,
        to: unitTo,
        state: snap || {}
      });
    });

    byEntity.forEach((states, entId) => {
      const latest = states[states.length - 1];
      snapshot.characterStates.push({
        entityId: entId,
        name: entityNames.get(entId) || entId,
        stage: latest.stage,
        at: latest.from + '-' + latest.to,
        state: latest.state,
        allStages: states.length
      });
    });

    // 事件时间线
    const unitToChapter = await dissectionUnitChapterMap(actor, rec);
    const eventRows = await postgresRepository.runtimeListDissectionRows(actor, rec.id, 'dissection_events');
    eventRows.forEach(r => {
      const doc = parseDoc(r);
      const no = unitToChapter.get(doc.unit_id || doc.unitId) || 0;
      if (upTo > 0 && no > upTo) return;
      let participants = doc.participants;
      if (!Array.isArray(participants) && doc.participants_json) {
        participants = JSON.parse(doc.participants_json);
      }
      snapshot.timeline.push({
        id: doc.id || r.row_key,
        chapterNo: no,
        title: String(doc.title || doc.summary || '').slice(0, 120),
        participants: Array.isArray(participants) ? participants.slice(0, 6) : []
      });
    });
    snapshot.timeline.sort((a, b) => a.chapterNo - b.chapterNo);
    snapshot.timeline = snapshot.timeline.slice(0, 1200);

    // 伏笔
    const foreshadowRows = await postgresRepository.runtimeListDissectionRows(actor, rec.id, 'dissection_foreshadows');
    foreshadowRows.forEach(r => {
      const doc = parseDoc(r);
      const open = ['planned', 'partial', 'planted', 'reinforced', 'unknown', 'abandoned'].includes(doc.status);
      const planted = Number(doc.setup_chapter != null ? doc.setup_chapter : doc.setupChapter) || 0;
      if (upTo > 0 && (planted > upTo || !open)) return;
      if (!open && planted === 0) return;
      snapshot.foreshadows.push({
        id: doc.id || r.row_key,
        title: doc.title,
        description: doc.description,
        status: doc.status,
        strength: doc.strength,
        setupChapter: planted,
        payoffChapter: Number(doc.payoff_chapter != null ? doc.payoff_chapter : doc.payoffChapter) || 0
      });
    });
    snapshot.foreshadows = snapshot.foreshadows.slice(0, 200);

    // 分卷 / 全书地图
    const volSummaries = summaryRows.filter(r => {
      const doc = parseDoc(r);
      return String(doc.summary_type || doc.summaryType) === 'volume';
    }).map(r => {
      const doc = parseDoc(r);
      let c = doc.content || doc.content_json;
      if (typeof c === 'string') {
        c = JSON.parse(c);
      }
      return c || {};
    });

    const bookSummaryRow = summaryRows.find(r => {
      const doc = parseDoc(r);
      return String(doc.summary_type || doc.summaryType) === 'book';
    });
    if (bookSummaryRow) {
      const doc = parseDoc(bookSummaryRow);
      let c = doc.content || doc.content_json;
      if (typeof c === 'string') {
        c = JSON.parse(c);
      }
      snapshot.bookMap = c || {};
    }

    if (upTo > 0 && volSummaries.length) {
      const ranged = volSummaries.filter(v => Number(v.chapterFrom) > 0 && Number(v.chapterTo) >= Number(v.chapterFrom));
      const current = ranged.find(v => upTo >= Number(v.chapterFrom) && upTo <= Number(v.chapterTo));
      const prior = ranged.filter(v => Number(v.chapterFrom) <= upTo).pop();
      snapshot.volume = current || prior || ranged[0] || volSummaries[0] || null;
    } else if (volSummaries.length) {
      snapshot.volume = volSummaries[0];
    }

    return snapshot;
  }

  async function pipelineEnabled(actorUserId, record) {
    const resolved = resolveActorAndRecord(actorUserId, record);
    const actor = resolved.actor;
    const rec = resolved.record;
    if (!rec || rec.depth !== 'deep') return false;
    const rows = await postgresRepository.runtimeListDissectionRows(actor, rec.id, 'dissection_units');
    const validUnitTypes = new Set(['preface', 'chapter', 'scene', 'segment']);
    let count = 0;
    for (const r of rows) {
      const doc = parseDoc(r);
      const ut = String(doc.unitType || doc.unit_type || '').trim();
      if (validUnitTypes.has(ut)) count += 1;
    }
    return count >= PIPELINE_MIN_CHAPTERS;
  }

  return {
    loadDissectionChapters,
    loadAllChapterFacts,
    loadDissectionBatches,
    loadDissectionUnits,
    storeDissectionUnits,
    storeDissectionChapters,
    createDissectionBatches,
    initializeDissectionPipeline,
    ensurePipelineRun,
    updatePipelineRunProgress,
    updateBatchStatus,
    dissectionUnitChapterMap,
    saveBatchFactsAndClaims,
    buildDissectionEntities,
    buildDissectionEvents,
    buildEntityStates,
    buildEventEdges,
    storeDissectionForeshadows,
    saveSummaries,
    loadSummaries,
    syncCharactersToLibrary,
    listCharactersInLibrary,
    dissectionContextForChapter,
    pipelineEnabled
  };
}

module.exports = { createPostgresDissectionPipelineStore };
