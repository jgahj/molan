'use strict';

/**
 * 拆书流水线聚合服务（自 server.js 下沉，行为逐字节保持不变）。
 * 职责：四级分层摘要（章节→故事弧→分卷→全书）+ 全局聚合报告，
 *       含 PG 落库、模型调用与用量记账，失败严格抛锟（PG-only 收敛后不再吞错降级）。
 * 原实现：server.js buildChapterSummaries/buildVolumeSummaries/buildArcSummaries/
 *         buildPipelineVolumeDigest/buildBookSummary/callDissectionPipelineModel/
 *         recordPipelineUsageAsync/pipelineChat/runPipelineAggregation。
 * server.js 保留 runPipelineAggregation 委托桩（startPipelineJob 沙箱测试经自由变量解析注入 mock）。
 */
function createDissectionPipelineAggregationService(deps) {
  const {
    activeDissections,
    attachPipelineCoverage,
    buildAuthorDnaFromDissectionParts,
    buildPipelineCharacterFallback,
    buildPipelineCharacters,
    buildPipelineClues,
    buildPipelineConflictStats,
    buildPipelineEmotionCurve,
    buildPipelineEvidenceLedger,
    buildPipelineOutline,
    buildPipelineSpotStats,
    callMolanChat,
    checkDissectionActiveInPostgres,
    currentDefaultModel,
    dissectionFieldHasUsableContent,
    emptyDissectionResult,
    getPostgresDissectionPipelineStore,
    normalizeAuthorDna,
    normalizeEntityName,
    pipelineAggregationInputChars,
    pipelineAggregationMissingFields,
    pipelineSpotDistribution,
    pipelineSummaryCoverage,
    pipelineTensionFromCurve,
    pipelineTextChunks,
    postgresRepository,
    projectScope,
    safeJsonParse,
    samplePipelineCharacterAppearances,
    saveDissectionRecordAsync,
    startPipelineJob,
    toTokenCount,
  } = deps || {};

async function buildChapterSummaries(record, authToken, owner) {
  const store = getPostgresDissectionPipelineStore();
  const chapters = await store.loadDissectionChapters(record);
  if (!chapters.length) return [];
  const facts = await store.loadAllChapterFacts(record);
  const factByNo = new Map(facts.map(f => [f.chapterNo, f]));
  const out = [];
  const summaryMap = new Map();
  const batchSize = 15;
  for (let i = 0; i < chapters.length; i += batchSize) {
    const slice = chapters.slice(i, i + batchSize);
    const rows = slice.map(c => {
      const f = factByNo.get(c.chapter_no);
      const events = (f && Array.isArray(f.fact.chapter_events) ? f.fact.chapter_events : []).slice(0, 5).map(e => e.event || '').join('；');
      return '第' + c.chapter_no + '章(' + (c.title || '') + ')：' + (events || '（本章无显著事件）');
    }).join('\n');
    if (!rows) continue;
    try {
      const json = await pipelineChat(record, authToken, owner,
        '你是小说章节摘要器。为每章生成一条 ≤40 字的客观摘要，只概括本章实际发生的事，不评价文笔。只返回 JSON：{"summaries":[{"chapterNo":章号,"summary":"摘要"}]}，顺序与输入一致，不得漏章。',
        '请为以下章节生成摘要：\n' + rows, 2500);
      if (json && Array.isArray(json.summaries)) json.summaries.forEach(s => { if (s && s.chapterNo) summaryMap.set(Number(s.chapterNo), String(s.summary || '').slice(0, 90)); });
    } catch (error) { throw error; }
  }
  const now = Date.now();
  chapters.forEach(c => {
    const summary = String(summaryMap.get(c.chapter_no) || '').trim();
    const covered = !!summary;
    const id = 'cs_' + record.id + '_' + c.chapter_no;
    out.push({ chapterNo: c.chapter_no, title: c.title, summary, covered, status: covered ? 'ok' : 'needs_review' });
  });
  if (store) await store.saveSummaries(record, 'chapter', out.map((summary, index) => ({
    id: 'cs_' + record.id + '_' + summary.chapterNo, ownerId: chapters[index].chapter_id,
    childIds: [chapters[index].chapter_id], content: summary,
    coverage: { covered: summary.covered, expected: 1, completed: summary.covered ? 1 : 0 },
    status: summary.status
  })));
  return attachPipelineCoverage(out, chapters.length);
}

// ★ 阶段2 · 分层摘要：分卷摘要（优先用单元模型识别出的 volume 边界，否则按章节均分）
async function buildVolumeSummaries(record, authToken, owner, chapterSummaries) {
  const store = getPostgresDissectionPipelineStore();
  const chapters = await store.loadDissectionChapters(record);
  if (!chapters.length) return [];
  const summaryMap = new Map((chapterSummaries || []).map(s => [s.chapterNo, s.summary]));
  // 卷边界：优先 volume 单元；否则每 60 章一卷
  const volumeBands = [];
  const units = await store.loadDissectionUnits(record);
  const volUnits = units.filter(u => String(u.unitType) === 'volume');
  if (volUnits.length >= 2) {
    // volume 单元的章节由 parentId 分组；此处简化按 volume 单元在 units 中的顺序切章节区间
    const volOrdinals = volUnits.map(v => v.ordinal);
    for (let i = 0; i < volUnits.length; i += 1) {
      const fromOrd = volUnits[i].ordinal;
      const toOrd = i + 1 < volUnits.length ? volUnits[i + 1].ordinal : 999999;
      const bandChapters = chapters.filter(c => {
        const u = units.find(x => x.unitId === c.chapter_id);
        return u && u.ordinal >= fromOrd && u.ordinal < toOrd;
      });
      if (bandChapters.length) volumeBands.push({ title: volUnits[i].title, chapters: bandChapters.map(c => c.chapter_no) });
    }
  }
  if (!volumeBands.length) {
    const per = 60;
    for (let i = 0; i < chapters.length; i += per) {
      volumeBands.push({ title: '第 ' + (i / per + 1) + ' 卷', chapters: chapters.slice(i, i + per).map(c => c.chapter_no) });
    }
  }
  const out = [];
  const now = Date.now();
  for (const band of volumeBands) {
    const rows = band.chapters.map(no => '第' + no + '章：' + (summaryMap.get(no) || '')).join('\n');
    let content = null;
    try {
      const json = await pipelineChat(record, authToken, owner,
        '你是网文分卷拆书分析师。下面是一卷内各章摘要，请归纳该卷：核心目标、主要冲突、剧情拐点、卷末留白/钩子。只返回 JSON：{volume,chapters,goal,turningPoints,mainConflicts,endingHook}。',
        '卷《' + band.title + '》（第' + band.chapters[0] + '-' + band.chapters[band.chapters.length - 1] + '章）章节摘要：\n' + rows, 2500);
      if (json && (json.goal || (Array.isArray(json.turningPoints) && json.turningPoints.length) || (Array.isArray(json.mainConflicts) && json.mainConflicts.length) || json.endingHook)) content = json;
    } catch (error) { throw error; }
    const covered = !!content;
    if (!content) content = { volume: band.title, chapters: band.chapters.length, goal: '', turningPoints: [], mainConflicts: [], endingHook: '' };
    content = { ...content, volume: content.volume || band.title, chapters: content.chapters || band.chapters.length, chapterFrom: band.chapters[0], chapterTo: band.chapters[band.chapters.length - 1] };
    const id = 'vs_' + record.id + '_' + out.length;
    const childIds = chapters.filter(c => band.chapters.includes(c.chapter_no)).map(c => c.chapter_id);
    out.push({ id, ...content, covered, status: covered ? 'ok' : 'needs_review' });
  }
  if (store) await store.saveSummaries(record, 'volume', out.map((summary, index) => ({
    id: summary.id, ownerId: 'volume-' + index, content: summary,
    childIds: chapters.filter(chapter => chapter.chapter_no >= summary.chapterFrom && chapter.chapter_no <= summary.chapterTo).map(chapter => chapter.chapter_id),
    coverage: { covered: summary.covered, expected: 1, completed: summary.covered ? 1 : 0 },
    status: summary.status
  })));
  return attachPipelineCoverage(out, volumeBands.length);
}

// ★ 阶段2 · 故事弧摘要：连续章节归并为故事弧（约 30 章/弧），每弧只读章节摘要生成概括，
// 是"章节 → 故事弧 → 分卷 → 全书"四级分层中的第二级。落 summaries 表 summary_type='arc'。
async function buildArcSummaries(record, authToken, owner, chapterSummaries) {
  const store = getPostgresDissectionPipelineStore();
  const chapters = await store.loadDissectionChapters(record);
  if (!chapters.length) return [];
  const summaryMap = new Map((chapterSummaries || []).map(s => [s.chapterNo, s.summary]));
  const ARCS_PER = 30;
  const bands = [];
  for (let i = 0; i < chapters.length; i += ARCS_PER) {
    const slice = chapters.slice(i, i + ARCS_PER);
    if (!slice.length) break;
    bands.push({ from: slice[0].chapter_no, to: slice[slice.length - 1].chapter_no, nos: slice.map(c => c.chapter_no) });
  }
  const out = [];
  const now = Date.now();
  for (let i = 0; i < bands.length; i += 1) {
    const band = bands[i];
    const rows = band.nos.map(no => '第' + no + '章：' + (summaryMap.get(no) || '')).join('\n');
    if (!rows.trim()) continue;
    let content = null;
    try {
      const json = await pipelineChat(record, authToken, owner,
        '你是网文故事弧拆书分析师。下面是一段连续章节的摘要（第 ' + (i + 1) + ' 个故事弧），请归纳：该弧核心冲突、主角目标、关键转折、弧末留白/悬念、与前后弧的衔接。只返回 JSON：{arc,range,coreConflict,protagonistGoal,turningPoints,endingHook,nextHook}。',
        '故事弧（第' + band.from + '-' + band.to + '章）章节摘要：\n' + rows, 2500);
      if (json && (json.coreConflict || json.protagonistGoal || (Array.isArray(json.turningPoints) && json.turningPoints.length) || json.endingHook)) content = json;
    } catch (error) { throw error; }
    const covered = !!content;
    if (!content) content = { arc: '故事弧 ' + (i + 1), range: band.from + '-' + band.to, coreConflict: '', protagonistGoal: '', turningPoints: [], endingHook: '', nextHook: '' };
    content = { ...content, arc: content.arc || ('故事弧 ' + (i + 1)), range: content.range || (band.from + '-' + band.to), chapterFrom: band.from, chapterTo: band.to };
    const id = 'as_' + record.id + '_' + i;
    const childIds = chapters.filter(c => band.nos.includes(c.chapter_no)).map(c => c.chapter_id);
    out.push({ id, ...content, covered, status: covered ? 'ok' : 'needs_review' });
  }
  if (store) await store.saveSummaries(record, 'arc', out.map((summary, index) => ({
    id: summary.id, ownerId: 'arc-' + index, content: summary,
    childIds: chapters.filter(chapter => chapter.chapter_no >= summary.chapterFrom && chapter.chapter_no <= summary.chapterTo).map(chapter => chapter.chapter_id),
    coverage: { covered: summary.covered, expected: 1, completed: summary.covered ? 1 : 0 },
    status: summary.status
  })));
  return attachPipelineCoverage(out, bands.length);
}

// ★ 阶段2 · 全书摘要：只读分卷摘要 + 冲突/情绪统计 + 伏笔台账，生成全书地图与总结。
// 是四级分层的最上层，禁止回读全部原文。落 summaries 表 summary_type='book'。
async function buildPipelineVolumeDigest(record, authToken, owner, volumeSummaries) {
  const rows = (volumeSummaries || []).map(v => '【' + (v.volume || v.id) + '】第' + v.chapterFrom + '-' + v.chapterTo + '章：目标 ' + (v.goal || '') + '；拐点 ' + (Array.isArray(v.turningPoints) ? v.turningPoints.join('、') : '') + '；冲突 ' + (Array.isArray(v.mainConflicts) ? v.mainConflicts.join('、') : '') + '；钩子 ' + (v.endingHook || ''));
  const source = rows.join('\n');
  const chunks = pipelineTextChunks(source, pipelineAggregationInputChars(record));
  if (chunks.length <= 1) return { text: source, complete: true, sourceCount: rows.length, digestCount: rows.length ? 1 : 0 };
  const digests = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const json = await pipelineChat(record, authToken, owner,
      '你是全书结构摘要压缩器。输入是一批连续分卷摘要，必须覆盖其中每一卷的目标、拐点、冲突和卷末钩子。只返回 JSON：{"digest":"不超过 900 字的结构性归纳","ranges":["覆盖的章节范围"]}。不得凭空补写，无法确认的内容标 candidate。',
      '第' + (i + 1) + '/' + chunks.length + ' 批分卷摘要：\n' + chunks[i], 3000);
    if (!json || !String(json.digest || '').trim()) return { text: digests.join('\n'), complete: false, sourceCount: rows.length, digestCount: digests.length };
    digests.push('【分卷归并批次 ' + (i + 1) + '】' + String(json.digest).trim() + (Array.isArray(json.ranges) && json.ranges.length ? '（范围：' + json.ranges.join('、') + '）' : ''));
  }
  return { text: digests.join('\n'), complete: true, sourceCount: rows.length, digestCount: digests.length };
}

async function buildBookSummary(record, authToken, owner, volumeSummaries, extra) {
  const volBrief = extra && extra.volumeDigest && typeof extra.volumeDigest.text === 'string'
    ? extra.volumeDigest.text
    : (volumeSummaries || []).map(v => '【' + (v.volume || v.id) + '】第' + v.chapterFrom + '-' + v.chapterTo + '章：目标 ' + (v.goal || '') + '；拐点 ' + (Array.isArray(v.turningPoints) ? v.turningPoints.join('、') : '') + '；钩子 ' + (v.endingHook || '')).join('\n');
  const conflictBrief = extra && extra.conflictStats ? JSON.stringify(extra.conflictStats) : '';
  const foreshadowBrief = extra && Array.isArray(extra.foreshadowing)
    ? '未回收 ' + extra.foreshadowing.filter(f => ['planned', 'partial', 'planted', 'abandoned'].includes(f.status)).length + ' 条 / 已回收 ' + extra.foreshadowing.filter(f => f.status === 'recovered').length + ' 条' : '';
  let content = null;
  try {
    const json = await pipelineChat(record, authToken, owner,
      '你是资深网文全书拆书分析师。基于全书分卷摘要与统计，生成全书地图与总结（聚合层，允许全局总结）。只返回 JSON：{bookMap:{overallArc,mainTheme,threeActStructure,themeLine,charArcSummary},bookSummary:"全书一句话总结",majorTurningPoints:[{chapter,event,impact}],openThreads:[{desc,status}],unsolvedMysteries:[],nextBookHook}。openThreads 与 unsolvedMysteries 必须基于伏笔台账如实填写，严禁默认全部回收。',
      '《' + record.title + '》全书（' + (extra && extra.chapterCount || '') + ' 章）。\n冲突统计：' + conflictBrief + '\n伏笔状态：' + foreshadowBrief + '\n分卷摘要：\n' + (volBrief || '（无分卷摘要）'), 4000);
    if (json && json.bookMap && json.bookSummary) content = json;
  } catch (error) { throw error; }
  const covered = !!content;
  if (!content) content = { bookMap: { overallArc: '', mainTheme: '', threeActStructure: '', themeLine: '', charArcSummary: '' }, bookSummary: '', majorTurningPoints: [], openThreads: [], unsolvedMysteries: [], nextBookHook: '' };
  content = { ...content, coverage: { expected: 1, completed: covered ? 1 : 0, complete: covered } };
  await getPostgresDissectionPipelineStore().saveSummaries(record, 'book', [{
    id: 'bs_' + record.id, ownerId: record.id, content,
    childIds: (volumeSummaries || []).map(volume => volume.id || ''),
    coverage: { covered, expected: 1, completed: covered ? 1 : 0 },
    status: covered ? 'ok' : 'needs_review'
  }]);
  return content;
}

// ★ 全局聚合层 · 本地规则统计（不调模型，零成本）

// 人物聚合只需要覆盖性行为样本，不应把同一角色数千次出场全部塞进一次提示词。
// 保留首末证据，并在中间按位置均匀取样，避免只看到开篇而丢失后期变化。




// —— 全局聚合：基于事实库生成报告（模型调用，失败逐项降级为本地规则） ——
async function callDissectionPipelineModel(authToken, owner, record, options) {
  const actor = String(record.ownerUserId || projectScope.stableUserId(record.userEmail));
  const controller = activeDissections.get(record.id)?.controller || new AbortController();
  let stopped = false;
  let pollError = null;
  let inFlightPoll = null;
  const check = async () => {
    const state = await checkDissectionActiveInPostgres(postgresRepository, actor, record.id);
    if (!state.ok || controller.signal.aborted) {
      throw Object.assign(new Error(state.message || '拆书任务已取消'), { cancelled: true, name: 'AbortError' });
    }
  };
  await check();
  const timer = setInterval(() => {
    if (stopped || inFlightPoll) return;
    inFlightPoll = check().catch(error => {
      pollError = error;
      controller.abort(error);
    }).finally(() => { inFlightPoll = null; });
  }, 1000);
  try {
    const output = await callMolanChat(authToken, owner, {
      ...options, controller, requireComplete: true
    });
    if (inFlightPoll) await inFlightPoll;
    if (pollError) throw pollError;
    await check();
    return output;
  } catch (error) {
    throw pollError || error;
  } finally {
    stopped = true;
    clearInterval(timer);
    if (inFlightPoll) await inFlightPoll;
  }
}

async function recordPipelineUsageAsync(record, usage, stage) {
  const prior = record.meta?.stageUsage?.[stage] || {};
  const costKnown = usage?.creditCost !== null && usage?.creditCost !== undefined &&
    Number.isFinite(Number(usage.creditCost)) && Number(usage.creditCost) >= 0;
  const tokens = toTokenCount(usage?.totalTokens);
  record.actualCredits = !costKnown || record.actualCredits === null
    ? null : Math.round((Number(record.actualCredits || 0) + Number(usage.creditCost)) * 100) / 100;
  const creditCost = !costKnown || prior.creditCost === null
    ? null : Math.round((Number(prior.creditCost || 0) + Number(usage.creditCost)) * 100) / 100;
  record.meta = {
    ...record.meta,
    stageUsage: {
      ...record.meta?.stageUsage,
      [stage]: {
        mode: 'pipeline', requestCount: Number(prior.requestCount || 0) + 1,
        creditCost, totalTokens: tokens === null ? null : Number(prior.totalTokens || 0) + tokens,
        usageUnavailableCount: Number(prior.usageUnavailableCount || 0) + (tokens === null ? 1 : 0),
        status: usage?.status || (tokens === null ? 'usage_unavailable' : 'completed')
      }
    }
  };
  await saveDissectionRecordAsync(record);
}

async function pipelineChat(record, authToken, owner, system, userPrompt, maxTokens) {
  try {
    const out = await callDissectionPipelineModel(authToken, owner, record, {
    thinking: false, reasoningEffort: 'none',
      system, userPrompt, maxTokens: maxTokens || 3000, jsonMode: true,
      modelId: record.selectedModel || currentDefaultModel() || 'gpt-5.6-luna', internalModel: true, temperature: 0.3, stage: 'skill_analysis',
      skillAudit: record && record.meta && record.meta.dissectionSkillAudit,
      // ★ Q2 · 账本维度：聚合调用按 recordId 记录
      recordId: record.id, unitId: 'aggregate', workflowId: record.pipelineRunId || ''
    });
    await recordPipelineUsageAsync(record, out.usage, 'aggregate');
    if (!out.usage || toTokenCount(out.usage.totalTokens) === null) {
      throw Object.assign(new Error('上游模型用量未知，停止聚合'), { code: 'USAGE_UNAVAILABLE', unknown: true });
    }
    return out.json || safeJsonParse(out.text) || null;
  } catch (error) {
    throw error;
  }
}



async function runPipelineAggregation(record, authToken, owner, opts) {
  const store = getPostgresDissectionPipelineStore();
  const chapters = await store.loadDissectionChapters(record);
  const facts = await store.loadAllChapterFacts(record);
  if (!facts.length) return null;
  // ★ 阶段1 · 实体消歧与事件图谱落地（本地规则，零成本）
  await store.buildDissectionEntities(record);
  await store.buildDissectionEvents(record);
  await store.buildEntityStates(record);
  await store.buildEventEdges(record);
  // ★ 阶段2 · 人物状态快照 + 事件关系图落库

  const result = emptyDissectionResult();
  result.chapterIndex = chapters.map(c => ({ index: c.chapter_no, chapterId: c.chapter_id, title: c.title, segments: 1, summary: '' }));
  result.timeline = facts
    .filter(f => Array.isArray(f.fact.chapter_events) && f.fact.chapter_events.length)
    .flatMap(f => f.fact.chapter_events.map((event, index) => ({
      position: '第' + f.chapterNo + '章·事件' + (index + 1),
      event: String(event && event.event || ''),
      goal: String(event && event.preState || ''),
      result: String(event && (event.result || event.postState) || ''),
      cost: '',
      evidenceRefs: f.chapterId ? [f.chapterId] : []
    })));
  result.outline = buildPipelineOutline(facts);
  const claims = (await postgresRepository.runtimeListDissectionRows(record.ownerUserId, record.id, 'dissection_claims')).map(row => {
    const document = typeof row.document === 'string' ? JSON.parse(row.document) : row.document;
    if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('拆书证据文档损坏');
    return document;
  });
  result.evidenceLedger = buildPipelineEvidenceLedger(record, facts, claims);
  result.dissectionMap = {
    unitCount: Number((record.meta && record.meta.pipeline && record.meta.pipeline.unitTotal) || 0),
    factCount: facts.length,
    repeatedPatterns: [],
    canonNotes: []
  };

  // 情绪 / 爽点 / 冲突 / 分布（本地统计）
  const emotionCurve = buildPipelineEmotionCurve(facts);
  const conflictStats = buildPipelineConflictStats(facts);
  const spotStats = buildPipelineSpotStats(facts);
  const tension = pipelineTensionFromCurve(emotionCurve);
  result.emotion = {
    emotionCurve,
    sellingPointTypes: spotStats.sellingPointTypes,
    sellingPointList: facts.flatMap(f => (Array.isArray(f.fact.spot_feeling) ? f.fact.spot_feeling : []).map(s => ({ position: '第' + f.chapterNo + '章', type: String(s.type || ''), description: String(s.desc || ''), setup: '' }))),
    sellingPointDistribution: pipelineSpotDistribution(facts),
    tensionPeaks: tension.tensionPeaks,
    coolPoints: tension.coolPoints,
    emotionClosure: { status: '待综合评估', suggestion: '基于全书情绪曲线生成' }
  };
  result.conflictStats = conflictStats;

  const charRows = buildPipelineCharacters(facts);
  const clueRows = buildPipelineClues(facts);

  // ★ 阶段2 · 分层摘要：章节摘要 → 故事弧摘要 → 分卷摘要 → 全书摘要（聚合输入覆盖全书，不再单次 slice 截断）
  const chapterSummaries = await buildChapterSummaries(record, authToken, owner);
  const arcSummaries = await buildArcSummaries(record, authToken, owner, chapterSummaries);
  const volumeSummaries = await buildVolumeSummaries(record, authToken, owner, chapterSummaries);
  result.chapterSummaries = chapterSummaries;
  result.arcSummaries = arcSummaries;
  result.volumeSummaries = volumeSummaries;
  result.summaryCoverage = {
    chapter: pipelineSummaryCoverage(chapterSummaries, chapters.length),
    arc: pipelineSummaryCoverage(arcSummaries, Math.ceil(chapters.length / 30)),
    volume: pipelineSummaryCoverage(volumeSummaries, volumeSummaries.length),
    book: { expected: 1, completed: 0, complete: false }
  };

  // —— 人物档案聚合：分批（每批 ≤10 角色）；行为记录均匀抽样，低置信候选保留 ——
  const sortedChars = charRows.slice().sort((a, b) => b.count - a.count);
  const requestedChars = sortedChars.slice(0, 30);
  let characters = requestedChars.map(buildPipelineCharacterFallback);
  let relationships = [];
  const CHAR_BATCH = 10;
  const allArchives = [];
  const rels = [];
  let charBatchesCompleted = 0;
  const charBatchTotal = Math.ceil(sortedChars.length / CHAR_BATCH);
  for (let bi = 0; bi < sortedChars.length; bi += CHAR_BATCH) {
    const batch = sortedChars.slice(bi, bi + CHAR_BATCH);
    if (!batch.length) break;
    const brief = batch.map(c => {
      const samples = samplePipelineCharacterAppearances(c.appearances, 32);
      const behaviorText = samples.map(a => '第' + a.chapter_no + '章:' + a.behavior + (a.emotion ? '（' + a.emotion + '）' : '')).join('；');
      const sampleNote = samples.length < c.appearances.length ? '；行为记录已按全书位置均匀抽样 ' + samples.length + '/' + c.appearances.length + ' 条' : '';
      return '角色「' + c.name + '」出场 ' + c.count + ' 次，首次第' + (c.newAt || 0) + '章。行为记录' + sampleNote + '：' + behaviorText;
    }).join('\n');
    try {
      const charJson = await pipelineChat(record, authToken, owner,
        '你是资深小说拆书聚合师。根据角色在全书各章节的行为记录，生成人物档案与关系。只返回 JSON：{characters:[{name,function,goal,conflict,arc,firstAppearance}],relationships:[{from,to,change,plotImpact}]}。arc 要概括跨章节成长弧光；同义重复的角色名请归并；出现超过 500 章未再登场又复出的要在 arc 中体现。',
         '角色行为记录：\n' + brief, 4000);
      if (charJson && Array.isArray(charJson.characters) && charJson.characters.length) {
        allArchives.push(...charJson.characters);
        charBatchesCompleted += 1;
      }
      if (charJson && Array.isArray(charJson.relationships)) rels.push(...charJson.relationships);
    } catch (error) { throw error; }
  }
  const generatedByName = new Map();
  allArchives.forEach(archive => {
    const name = String(archive && archive.name || '').trim();
    if (!name) return;
    const key = normalizeEntityName(name).toLowerCase() || name.toLowerCase();
    if (!generatedByName.has(key)) generatedByName.set(key, archive);
  });
  const expectedCharacterKeys = new Set(sortedChars.map(character => normalizeEntityName(character.name).toLowerCase() || character.name.toLowerCase()));
  const matchedCharacterCount = [...generatedByName.keys()].filter(key => expectedCharacterKeys.has(key)).length;
  const characterAggregationComplete = expectedCharacterKeys.size === 0 || (charBatchesCompleted === charBatchTotal && matchedCharacterCount >= expectedCharacterKeys.size);
  characters = requestedChars.map(character => {
    const key = normalizeEntityName(character.name).toLowerCase() || character.name.toLowerCase();
    return generatedByName.get(key) || buildPipelineCharacterFallback(character);
  });
  result.characterAggregation = {
    expected: expectedCharacterKeys.size,
    completed: matchedCharacterCount,
    batchTotal: charBatchTotal,
    batchCompleted: charBatchesCompleted,
    sourceCount: sortedChars.length,
    status: characterAggregationComplete ? 'ok' : 'needs_review',
    complete: characterAggregationComplete
  };
  relationships = rels;
  result.characters = characters;
  result.relationships = relationships;

  // —— 伏笔台账合并：分批归并（每批 ≤40 条），已回收必须要有回收章证据 ——
  let foreshadowing = [];
  const CLUE_BATCH = 40;
  for (let bi = 0; bi < clueRows.length; bi += CLUE_BATCH) {
    const batch = clueRows.slice(bi, bi + CLUE_BATCH);
    if (!batch.length) break;
    const summary = batch.map((c, i) => (i + 1) + '. 埋设第' + c.planted + '章' + (c.recoveredAt ? '，回收第' + c.recoveredAt + '章' : '') + '：' + c.desc).join('\n');
    try {
      const clueJson = await pipelineChat(record, authToken, owner,
        '你是伏笔台账合并专家。下面是一批伏笔线索（同一伏笔可能被多章提到、描述近似）。请归并合并，区分状态：recovered(已回收，必须有回收章证据) / partial(部分回收) / planned(埋设未回收) / abandoned(疑似烂尾)。只返回 JSON：{foreshadowing:[{id,setupChapter,expectedPayoff,status,strength}]}。',
         '伏笔线索（' + batch.length + ' 条）：\n' + summary, 5000);
      if (clueJson && Array.isArray(clueJson.foreshadowing)) foreshadowing.push(...clueJson.foreshadowing);
    } catch (error) { throw error; }
  }
  if (!foreshadowing.length) {
    // 降级：本地按描述前缀 + 埋设章接近归并
    const seen = new Map();
    clueRows.forEach(c => {
      const key = c.desc.slice(0, 10);
      if (!seen.has(key)) seen.set(key, { id: 'clue-' + (seen.size + 1), setupChapter: c.planted, expectedPayoff: c.desc, status: c.recoveredAt ? 'recovered' : 'planned', strength: 'medium' });
    });
    foreshadowing = [...seen.values()];
  }
  result.foreshadowing = foreshadowing;
  // ★ 阶段2 · 伏笔生命周期落库（含埋设/回收章、相关实体、证据与置信度）
  await store.storeDissectionForeshadows(record, result.foreshadowing);

  // —— 分卷 / 框架 / 概览 / 题材 / 结构：输入 = 分卷摘要（覆盖全书）+ 统计 + 曲线 ——
  const curveSample = emotionCurve.filter((_, i) => i % 5 === 0);
  const openingFacts = facts.slice(0, 40).map(f => '第' + f.chapterNo + '章:' + (Array.isArray(f.fact.chapter_events) ? f.fact.chapter_events.slice(0, 3).map(e => e.event).join('，') : '')).join('\n');
  let volumeDigest = { text: '', complete: false, sourceCount: volumeSummaries.length, digestCount: 0 };
  volumeDigest = await buildPipelineVolumeDigest(record, authToken, owner, volumeSummaries);
  const volumeBrief = volumeDigest.text || '（分卷归并失败）';
  result.summaryCoverage.volumeDigestComplete = volumeDigest.complete === true;
  const profileJson = await pipelineChat(record, authToken, owner,
    '你是资深网文拆书分析师。基于全书分卷摘要与章节统计，做全局结构分析（这是聚合层，允许全局总结）。只返回 JSON：{overview:{positioning,targetReader,sellingPoints},framework:{premise,mainline,sublines,stages,opening,firstBreakout,nextStageRhythm},storyStructure:[{stage,range,goal,keyEvents}],architecture:{premise,volumeMap:[{volume,chapters,function,goal,turningPoint}],pacingModel,mainlineTransfer,structuralPattern,transitionLogic},genre:{primary,secondary,tags}}。',
     '书名《' + record.title + '》，全书 ' + chapters.length + ' 章。\n冲突统计：' + JSON.stringify(conflictStats) + '\n爽点统计：' + JSON.stringify(spotStats) + '\n情绪曲线采样（每5章1点，共' + curveSample.length + '点）：\n' + curveSample.map(c => c.position + ':' + c.intensity).join('，') + '\n分卷摘要：\n' + (volumeBrief || '（无分卷摘要）') + '\n开篇 40 章事实：\n' + openingFacts, 5000);
  if (profileJson) {
    if (profileJson.overview) result.overview = profileJson.overview;
    if (profileJson.framework) result.framework = profileJson.framework;
    if (Array.isArray(profileJson.storyStructure)) result.storyStructure = profileJson.storyStructure;
    if (profileJson.architecture) result.architecture = profileJson.architecture;
    if (profileJson.genre) result.genre = profileJson.genre;
  }

  // —— 开篇 / 金手指 / 文风 / 模板（抽样原文 + 开篇事实）——
  const samples = [];
  const pick = (from, to, label) => chapters.filter(c => c.chapter_no >= from && c.chapter_no <= to).slice(0, 3);
  [...pick(1, 12), ...pick(Math.floor(chapters.length / 2) - 4, Math.floor(chapters.length / 2) + 4), ...pick(chapters.length - 10, chapters.length)].forEach(c => {
    if (c) samples.push('【' + c.title + '】\n' + c.text.slice(0, 900));
  });
  const styleJson = await pipelineChat(record, authToken, owner,
    '你是网文文风分析师。基于抽样的开头/中段/结尾章节原文与开篇事实，归纳可迁移文风、创作技法、开篇节奏、金手指机制与可复用模板。只返回 JSON：{styleProfile:{summary,dimensions:[{name,observation,transferable}],confidence},craftConstraints:[{rule,evidence,confidence,scope,exceptions}],opening:{hook,firstCrisis,firstBreakout,beats:[{position,event,protagonistGoal,obstacle,informationChange,tension,result,cost,line}],recommendedCadence},goldenFinger:{exists,type,entry,coreMechanism,activation,limitations},reusableTemplates:{openingTemplate,sceneTemplate,conflictEscalationTemplate,avoidList},sentenceFingerprint:{avgSentenceLen,shortLongRatio,dialogueRatio,descriptionRatio,actionRatio,psychologyRatio,highFreqPatterns},sellingPoints:[{point,evidenceRefs}]}。',
     '开篇 40 章事实：\n' + openingFacts + '\n\n抽样原文：\n' + samples.join('\n\n---\n'), 5000);
  if (styleJson) {
    if (styleJson.styleProfile) result.styleProfile = styleJson.styleProfile;
    if (styleJson.authorDna) result.authorDna = normalizeAuthorDna(styleJson.authorDna);
    if (Array.isArray(styleJson.craftConstraints)) result.craftConstraints = styleJson.craftConstraints;
    if (styleJson.opening) result.opening = styleJson.opening;
    if (styleJson.goldenFinger) result.goldenFinger = styleJson.goldenFinger;
    if (styleJson.reusableTemplates) result.reusableTemplates = styleJson.reusableTemplates;
    if (styleJson.sentenceFingerprint) result.sentenceFingerprint = styleJson.sentenceFingerprint;
    if (Array.isArray(styleJson.sellingPoints)) result.sellingPoints = styleJson.sellingPoints;
  }
  if (!dissectionFieldHasUsableContent('authorDna', result.authorDna)) {
    result.authorDna = buildAuthorDnaFromDissectionParts(result.styleProfile, result.craftConstraints, result.reusableTemplates, result.sentenceFingerprint, result.evidenceLedger);
  }

  // —— 世界观聚合（本地：world_info 合并去重）——
  const worldSeen = new Map();
  facts.forEach(f => (Array.isArray(f.fact.world_info) ? f.fact.world_info : []).forEach(w => {
    const cat = String(w && w.category || '设定');
    const desc = String(w && w.desc || '').trim();
    if (!desc) return;
    if (!worldSeen.has(cat)) worldSeen.set(cat, []);
    const arr = worldSeen.get(cat);
    if (!arr.includes(desc)) arr.push(desc);
  }));
  result.worldbuilding = [...worldSeen.entries()].map(([cat, list]) => ({ category: cat.toLowerCase(), name: list[0], detail: list.join('；'), significance: '全书累计' }));

  // ★ 阶段2 · 全书摘要（四级分层的顶层，只读分卷摘要+统计+伏笔台账，不回读原文）
  result.bookSummary = await buildBookSummary(record, authToken, owner, volumeSummaries, { conflictStats, foreshadowing: result.foreshadowing, chapterCount: chapters.length, volumeDigest });
  result.summaryCoverage.book = result.bookSummary && result.bookSummary.coverage
    ? result.bookSummary.coverage
    : { expected: 1, completed: 0, complete: false };

  // ★ 校验结论：不再硬编码 passed，基于覆盖与缺失项真实计算（门禁由 startPipelineJob 二次把关）
  const unitTotal = (opts && opts.unitTotal) || 0;
  const unitCompleted = (opts && opts.unitCompleted) || 0;
  const failedBatchCount = (opts && opts.failedBatches) || 0;
  const coverage = unitTotal > 0 ? Math.min(1, unitCompleted / unitTotal) : (facts.length ? 1 : 0);
  const incomplete = unitTotal > 0 && unitCompleted < unitTotal;
  const missingFields = pipelineAggregationMissingFields(result);
  const conclusion = incomplete || failedBatchCount > 0 || !facts.length || missingFields.length ? 'needs_review' : 'passed';
  result.validation = {
    conclusion,
    uncertain: [],
    conflicts: [],
    notes: ['基于 ' + facts.length + ' 个单元事实聚合生成，覆盖率 ' + Number(coverage.toFixed(4))],
     missingFields,
    portableRules: [],
    coverage: Number(coverage.toFixed(4)),
    unitTotal,
    unitCompleted,
    failedBatches: failedBatchCount
  };
  return result;
}
  return {
    buildChapterSummaries,
    buildVolumeSummaries,
    buildArcSummaries,
    buildPipelineVolumeDigest,
    buildBookSummary,
    callDissectionPipelineModel,
    recordPipelineUsageAsync,
    pipelineChat,
    runPipelineAggregation
  };
}

module.exports = { createDissectionPipelineAggregationService };
