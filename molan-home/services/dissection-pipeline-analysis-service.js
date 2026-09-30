'use strict';

function createDissectionPipelineAnalysisService({ PIPELINE_EVENT_TYPE_MAP, PIPELINE_FACT_UNIT_TYPES, dbReady, dissectionFieldHasUsableContent, dissectionResultMissingFields, dissectionResultView, ensureDissectionAuthorDna, findPlatformModel, hasMeaningfulDissectionContent , getDatabase }) {
  function isPipelineFactUnit(unit) {
    return !!unit && PIPELINE_FACT_UNIT_TYPES.has(String(unit.unitType || ''));
  }

  function pipelineBatchCharsFor(record) {
    let ctx = 128000;
    try {
      const pm = findPlatformModel(record && record.selectedModel);
      if (pm && Number(pm.contextWindowTokens) > 0) ctx = Number(pm.contextWindowTokens);
    } catch (_) {}
    const inputTokens = Math.max(6000, Math.floor(ctx * 0.68) - 5000);
    const chars = Math.min(24000, Math.max(4000, Math.floor(inputTokens / 1.3)));
    return chars;
  }

  function pipelineEstimatedTokensFor(record, unitCount) {
    const batchChars = pipelineBatchCharsFor(record);
    const perBatchUnits = Math.max(1, Math.floor(batchChars / 3500));
    const batchCount = Math.max(1, Math.ceil(Math.max(1, Number(unitCount) || 0) / perBatchUnits));
    return Math.round(batchCount * (batchChars * 0.55 + 4500)) + 120000;
  }

  function pipelineAggregationInputChars(record) {
    let ctx = 128000;
    try {
      const pm = findPlatformModel(record && record.selectedModel);
      if (pm && Number(pm.contextWindowTokens) > 0) ctx = Number(pm.contextWindowTokens);
    } catch (_) {}
    return Math.min(24000, Math.max(7000, Math.floor(ctx * 0.32)));
  }

  function pipelineTextChunks(text, maxChars) {
    const source = String(text || '');
    const limit = Math.max(1000, Number(maxChars) || 10000);
    if (!source) return [];
    const lines = source.split('\n');
    const chunks = [];
    let current = '';
    lines.forEach(line => {
      const value = String(line || '');
      if (value.length > limit) {
        if (current) { chunks.push(current); current = ''; }
        for (let i = 0; i < value.length; i += limit) chunks.push(value.slice(i, i + limit));
        return;
      }
      if (current && current.length + value.length + 1 > limit) {
        chunks.push(current);
        current = '';
      }
      current += (current ? '\n' : '') + value;
    });
    if (current) chunks.push(current);
    return chunks;
  }

  function normalizePipelineEventType(value) {
    const v = String(value || '').trim();
    if (!v) return '日常';
    if (PIPELINE_EVENT_TYPE_MAP[v]) return PIPELINE_EVENT_TYPE_MAP[v];
    if (/冲突|战斗|对战|打脸|虐|危机|阴谋|陷害|追杀|挑衅|羞辱|获胜|胜利|碾压/.test(v)) return '冲突';
    if (/突破|升级|修炼|进阶|实力|强化/.test(v)) return '升级';
    if (/伏笔|秘密|线索|真相|身世|戒指|异火|地图|传承|身份/.test(v)) return '伏笔推进';
    if (/金手指|外挂|系统|功法|斗技|拜师/.test(v)) return '金手指';
    if (/对话|交谈|谈判|商谈|质问/.test(v)) return '对话';
    if (/反转|背叛|反杀|揭露|揭穿/.test(v)) return '反转';
    return '日常';
  }

  function normalizeDissectionUnitId(raw) {
    const v = String(raw || '').trim();
    const m = v.match(/^(preface|volume|chapter|scene|segment)-\d+/i);
    return m ? m[0] : v;
  }

  function normalizeEntityName(name) {
    let v = String(name || '').trim();
    v = v.replace(/\(candidate\)/gi, '').trim();
    v = v.replace(/[\s，。！？、；：·'"“”]/g, '');
    v = v.replace(/^(?:老头|老丈|少年|少女|老者|青年|男子|女子|小孩|丫鬟|老仆|护卫|首领|长老|宗主|家主|城主|院长|老师|师父|师尊|族长|少爷|小姐|姑娘|小子|那人|此人)/, '');
    return v;
  }

  function attachPipelineCoverage(list, expected) {
    const items = Array.isArray(list) ? list : [];
    const expectedCount = Math.max(0, Number(expected) || 0);
    const completed = items.filter(item => item && item.covered === true && item.status !== 'needs_review').length;
    const coverage = {
      expected: expectedCount,
      completed,
      missing: Math.max(0, expectedCount - completed),
      ratio: expectedCount ? Number((completed / expectedCount).toFixed(4)) : 0,
      complete: expectedCount === completed
    };
    Object.defineProperty(items, 'coverage', { value: coverage, enumerable: false, configurable: true });
    return items;
  }

  function pipelineSummaryCoverage(list, expected) {
    if (list && list.coverage) return list.coverage;
    return attachPipelineCoverage(list, expected).coverage;
  }

  function legacyPipelineCharacterAggregation(result) {
    const view = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
    if (Object.prototype.hasOwnProperty.call(view, 'characterAggregation')) return null;
    if (!Array.isArray(view.characters)) return null;
    const characters = view.characters.filter(item => hasMeaningfulDissectionContent(item, 'character'));
    if (!characters.length) return null;
    return {
      expected: characters.length,
      completed: characters.length,
      batchTotal: 0,
      batchCompleted: 0,
      sourceCount: characters.length,
      status: 'legacy',
      source: 'legacy-character-records',
      complete: true
    };
  }

  function normalizePipelineAggregationResult(result) {
    const view = dissectionResultView(result);
    const legacy = legacyPipelineCharacterAggregation(view);
    const normalized = legacy ? { ...view, characterAggregation: legacy } : view;
    return ensureDissectionAuthorDna(normalized);
  }

  function pipelineAggregationMissingFields(result) {
    const view = normalizePipelineAggregationResult(result);
    const required = ['overview', 'framework', 'dissectionMap', 'architecture', 'opening', 'goldenFinger', 'evidenceLedger', 'timeline', 'outline', 'foreshadowing', 'styleProfile', 'authorDna', 'craftConstraints', 'emotion'];
    const missing = required.filter(key => !dissectionFieldHasUsableContent(key, view[key]));
    if (!dissectionFieldHasUsableContent('characters', view.characters) && !dissectionFieldHasUsableContent('worldbuilding', view.worldbuilding)) missing.push('characters / worldbuilding');
    const coverage = view.summaryCoverage && typeof view.summaryCoverage === 'object' ? view.summaryCoverage : {};
    ['chapter', 'arc', 'volume', 'book'].forEach(key => {
      const item = coverage[key];
      if (!item || item.complete !== true) missing.push(key + 'Summaries coverage');
    });
    if (coverage.volumeDigestComplete !== true) missing.push('volumeDigest coverage');
    if (!view.bookSummary || !view.bookSummary.coverage || view.bookSummary.coverage.complete !== true) missing.push('bookSummary');
    if (!view.characterAggregation || view.characterAggregation.complete !== true) missing.push('characters aggregation coverage');
    return [...new Set(missing)];
  }

  function normalizeLegacyPipelineRecord(record) {
    if (!record || !record.meta || typeof record.meta !== 'object' || !record.meta.pipeline) return null;
    if (!['needs_review', 'completed'].includes(String(record.status || ''))) return null;
    const pipeline = record.meta.pipeline;
    const unitTotal = Number(pipeline.unitTotal) || 0;
    const unitCompleted = Number(pipeline.unitCompleted) || 0;
    const rawResult = dissectionResultView(record.result);
    const legacy = legacyPipelineCharacterAggregation(rawResult);
    if (!legacy || unitTotal <= 0 || unitCompleted < unitTotal) return null;
    const priorValidation = rawResult.validation && typeof rawResult.validation === 'object' && !Array.isArray(rawResult.validation)
      ? rawResult.validation
      : null;
    const failedBatchCount = Array.isArray(pipeline.failedBatches)
      ? pipeline.failedBatches.length
      : Math.max(0, Number(pipeline.failedBatches ?? (priorValidation && priorValidation.failedBatches)) || 0);
    if (failedBatchCount > 0) return null;
    const normalizedResult = normalizePipelineAggregationResult(rawResult);
    if (!priorValidation || dissectionResultMissingFields(normalizedResult, record.depth).length || pipelineAggregationMissingFields(normalizedResult).length) return null;
    const validation = {
      ...priorValidation,
      conclusion: 'passed',
      missingFields: [],
      coverage: Math.max(0, Math.min(1, Number(priorValidation.coverage) || (unitTotal ? unitCompleted / unitTotal : 0))),
      unitTotal,
      unitCompleted,
      failedBatches: 0,
      notes: [...(Array.isArray(priorValidation.notes) ? priorValidation.notes : []), '兼容历史结果：根据已有角色档案补齐人物聚合元数据。']
    };
    const next = {
      ...record,
      result: { ...normalizedResult, validation },
      meta: {
        ...record.meta,
        pipeline: {
          ...pipeline,
          aggregated: true,
          aggregationComplete: true,
          validationStatus: 'passed',
          needsReview: false,
          unitCompleted,
          factCoverage: Math.max(0, Math.min(1, Number(pipeline.factCoverage) || (unitTotal ? unitCompleted / unitTotal : 0))),
          failedBatches: [],
          missingFields: [],
          legacyCharacterAggregation: true
        }
      }
    };
    if (String(record.status) === 'needs_review') {
      next.status = 'completed';
      next.phase = 'completed';
      next.progress = 100;
    }
    return next;
  }

  function buildPipelineEmotionCurve(facts) {
    const curve = [];
    facts.forEach(item => {
      const spots = Array.isArray(item.fact.spot_feeling) ? item.fact.spot_feeling : [];
      let intensity = 5;
      let type = '平稳';
      if (spots.length) {
        const peak = spots.reduce((a, b) => Math.max(a, Number(b && b.intensity) || 0), 0);
        intensity = Math.max(1, Math.min(10, peak || 5));
        const big = spots.find(s => (s && s.type) === '大高潮');
        if (big) type = '高潮';
        else if (spots.some(s => (s && s.type) === '虐点')) type = '悲伤';
        else if (spots.some(s => (s && s.type) === '爽点')) type = '满足';
      }
      const events = Array.isArray(item.fact.chapter_events) ? item.fact.chapter_events : [];
      if (type === '平稳' && events.some(e => ['冲突', '反转'].includes(e && e.type))) type = '紧张';
      curve.push({ position: '第' + item.chapterNo + '章', intensity, type });
    });
    return curve;
  }

  function buildPipelineConflictStats(facts) {
    const counts = { 人际冲突: 0, 实力冲突: 0, 阴谋冲突: 0, 内心冲突: 0 };
    const TYPE_MAP = { 冲突: '人际冲突', 反转: '阴谋冲突' };
    const examples = {};
    facts.forEach(item => {
      const events = Array.isArray(item.fact.chapter_events) ? item.fact.chapter_events : [];
      events.forEach(e => {
        const t = TYPE_MAP[e && e.type] || '';
        if (!t) return;
        counts[t] += 1;
        if (!examples[t]) examples[t] = '第' + item.chapterNo + '章';
      });
      (Array.isArray(item.fact.spot_feeling) ? item.fact.spot_feeling : []).forEach(s => {
        if (s && (s.type === '爽点' || s.type === '大高潮')) {
          counts['实力冲突'] += 1;
          if (!examples['实力冲突']) examples['实力冲突'] = '第' + item.chapterNo + '章';
        }
      });
    });
    const types = Object.keys(counts).filter(k => counts[k] > 0).map(k => ({ type: k, count: counts[k], examplePosition: examples[k] || '' }));
    return { types, total: types.reduce((a, t) => a + t.count, 0) };
  }

  function buildPipelineSpotStats(facts) {
    const typeCount = {};
    const examples = {};
    facts.forEach(item => {
      (Array.isArray(item.fact.spot_feeling) ? item.fact.spot_feeling : []).forEach(s => {
        const t = String(s && s.type || '爽点');
        typeCount[t] = (typeCount[t] || 0) + 1;
        if (!examples[t]) examples[t] = '第' + item.chapterNo + '章';
      });
    });
    return {
      sellingPointTypes: Object.keys(typeCount).map(t => ({ type: t, count: typeCount[t], examplePosition: examples[t] })),
      total: Object.values(typeCount).reduce((a, b) => a + b, 0)
    };
  }

  function buildPipelineCharacters(facts) {
    // name -> { name, appearances: [{chapter_no, behavior, emotion}], newAt: 首次登场章 }
    const map = new Map();
    facts.forEach(item => {
      (Array.isArray(item.fact.character_appear) ? item.fact.character_appear : []).forEach(c => {
        const name = String(c && c.name || '').trim();
        if (!name) return;
        if (!map.has(name)) map.set(name, { name, appearances: [], newAt: 0, count: 0 });
         const rec = map.get(name);
         rec.count += 1;
         if (!rec.newAt) rec.newAt = item.chapterNo;
         rec.appearances.push({ chapter_no: item.chapterNo, behavior: String(c.behavior || ''), emotion: String(c.emotion || '') });
       });
     });
     return [...map.values()];
   }

  function samplePipelineCharacterAppearances(appearances, maxItems) {
    const rows = Array.isArray(appearances) ? appearances : [];
    const limit = Math.max(2, Number(maxItems) || 32);
    if (rows.length <= limit) return rows.slice();
    const indexes = new Set([0, rows.length - 1]);
    const slots = limit - 2;
    for (let i = 1; i <= slots; i += 1) indexes.add(Math.round(i * (rows.length - 1) / (slots + 1)));
    return [...indexes].sort((a, b) => a - b).map(index => rows[index]);
  }

  function buildPipelineCharacterFallback(character) {
    const samples = samplePipelineCharacterAppearances(character && character.appearances, 8);
    const evidence = samples.map(item => {
      const behavior = String(item && item.behavior || '').trim();
      const emotion = String(item && item.emotion || '').trim();
      const detail = [behavior, emotion ? '情绪：' + emotion : ''].filter(Boolean).join('；');
      return detail ? '第' + (Number(item && item.chapter_no) || 0) + '章：' + detail.slice(0, 90) : '';
    }).filter(Boolean);
    return {
      name: String(character && character.name || ''),
      function: '事实记录角色',
      goal: '',
      conflict: '',
      arc: evidence.length ? '基于事实行为样本：' + evidence.join('；') : '仅有出场提及，暂无足够证据归纳人物弧光',
      firstAppearance: character && character.newAt ? '第' + character.newAt + '章' : '未知'
    };
  }

  function buildPipelineClues(facts) {
    const clues = [];
    facts.forEach(item => {
      (Array.isArray(item.fact.plot_clue) ? item.fact.plot_clue : []).forEach(c => {
        clues.push({
          desc: String(c && c.desc || '').trim(),
          planted: item.chapterNo,
          recoveredAt: (c && c.recovered) ? item.chapterNo : 0,
          ref: String(c && c.ref || '')
        });
      });
    });
    return clues.filter(c => c.desc);
  }

  function buildPipelineOutline(facts) {
    return facts.map(item => {
      const events = Array.isArray(item.fact && item.fact.chapter_events) ? item.fact.chapter_events.filter(e => e && (e.event || e.result)) : [];
      if (!events.length) return null;
      const first = events[0] || {};
      const last = events[events.length - 1] || first;
      return {
        position: '第' + item.chapterNo + '章',
        goal: String(first.event || '').slice(0, 120),
        obstacle: String(first.preState || '').slice(0, 120),
        result: String(last.result || last.postState || last.event || '').slice(0, 120),
        line: '主线',
        evidenceRefs: item.chapterId ? [item.chapterId] : []
      };
    }).filter(Boolean);
  }

  function buildPipelineEvidenceLedger(record, facts) {
    if (!dbReady()) return [];
    const rows = getDatabase().prepare('SELECT unit_id,claim_type,predicate,object_value,evidence_type,source_start,source_end,confidence,status FROM dissection_claims WHERE dissection_id = ? ORDER BY source_start ASC, rowid ASC').all(record.id);
    if (rows.length) return rows.map(row => ({
      type: String(row.claim_type || 'claim'),
      source: String(row.unit_id || ''),
      observation: String(row.object_value || row.predicate || '').slice(0, 240),
      inferredRule: String(row.predicate || '').slice(0, 240),
      evidenceType: String(row.evidence_type || 'direct'),
      sourceStart: Number(row.source_start) || 0,
      sourceEnd: Number(row.source_end) || 0,
      confidence: Number(row.confidence) > 0 ? Number(row.confidence) : 0.6,
      status: String(row.status || 'confirmed')
    }));
    return facts.flatMap(item => (Array.isArray(item.fact && item.fact.chapter_events) ? item.fact.chapter_events : []).map(event => ({
      type: 'event',
      source: item.chapterId || 'chapter-' + item.chapterNo,
      observation: String(event && (event.event || event.result) || '').slice(0, 240),
      inferredRule: '章节事件',
      evidenceType: 'direct',
      confidence: 0.5,
      status: 'candidate'
    }))).filter(item => item.observation);
  }

  function pipelineSpotDistribution(facts) {
    const bucket = {};
    const BUCKET = 20;
    facts.forEach(item => {
      const b = Math.ceil(item.chapterNo / BUCKET) * BUCKET;
      const key = '第' + Math.max(1, b - BUCKET + 1) + '-' + b + '章';
      const n = (Array.isArray(item.fact.spot_feeling) ? item.fact.spot_feeling : []).length;
      bucket[key] = (bucket[key] || 0) + n;
    });
    return Object.keys(bucket).map(k => ({ position: k, count: bucket[k] }));
  }

  function pipelineTensionFromCurve(curve) {
    const tensionPeaks = [];
    const coolPoints = [];
    for (let i = 0; i < curve.length; i += 1) {
      const c = curve[i];
      const v = Number(c.intensity) || 5;
      const prev = i > 0 ? Number(curve[i - 1].intensity) || 5 : 5;
      const next = i < curve.length - 1 ? Number(curve[i + 1].intensity) || 5 : 5;
      if (v >= 8 && v > prev) tensionPeaks.push({ peak: c.position, setup: '', pressure: '', turn: '', release: '', lengthChars: 0 });
      if (v <= 3 && v <= prev && v <= next) coolPoints.push({ position: c.position, cause: '', duration: '约 ' + Math.max(1, countBelow3(curve, i)) + ' 章', recovery: '' });
    }
    return { tensionPeaks, coolPoints };
  }

  function countBelow3(curve, from) {
    let n = 0;
    for (let i = from; i < curve.length && (Number(curve[i].intensity) || 5) <= 3; i += 1) n += 1;
    return n;
  }

  return { isPipelineFactUnit, pipelineBatchCharsFor, pipelineEstimatedTokensFor, pipelineAggregationInputChars, pipelineTextChunks, normalizePipelineEventType, normalizeDissectionUnitId, normalizeEntityName, attachPipelineCoverage, pipelineSummaryCoverage, legacyPipelineCharacterAggregation, normalizePipelineAggregationResult, pipelineAggregationMissingFields, normalizeLegacyPipelineRecord, buildPipelineEmotionCurve, buildPipelineConflictStats, buildPipelineSpotStats, buildPipelineCharacters, samplePipelineCharacterAppearances, buildPipelineCharacterFallback, buildPipelineClues, buildPipelineOutline, buildPipelineEvidenceLedger, pipelineSpotDistribution, pipelineTensionFromCurve, countBelow3 };
}

module.exports = { createDissectionPipelineAnalysisService };
