'use strict';

/**
 * 范文对标生成管线（服务端）：
 * - 题材基线读取（data/genre-baselines/<题材>.json，缺失时回退指纹聚合）
 * - 证据审稿：模型 issue 必须携带可逐字回查的 quote，加确定性硬约束与题材分层纠错扫描
 * - 局部修订：只改问题段，修订后复核旧问题是否消失、是否越权改动
 * 所有模型调用通过 deps.callModel(auth, options) 注入，本文件不直连上游。
 */
const fs = require('node:fs');
const path = require('node:path');
const metrics = require('./benchmark-metrics');
const review = require('./evidence-review');
const scope = require('./genre-rule-scope');
const { sanitizeSystemForUpstream } = require('./ip-continuation-adapter');
const { sanitizeAiFlavor } = require('./genre-engine');
const benchmarkDatabase = require('./benchmark-database');

const DEFAULT_BASELINE_DIR = path.join(__dirname, '..', 'data', 'genre-baselines');
const MAX_REVISION_ROUNDS = 2;

/** 读取题材基线文件；优先尝试同类可比 Benchmark，按精确名、包含关系依次匹配。 */
function loadGenreBaseline(genre, baselineDir = DEFAULT_BASELINE_DIR, criteria = {}) {
  let wanted = String(genre || '').trim();
  if (wanted.toLowerCase() === 'auto') wanted = '玄幻';
  if (!wanted) return null;

  let loaded = null;
  if (fs.existsSync(baselineDir)) {
    const files = fs.readdirSync(baselineDir).filter(name => name.endsWith('.json') && name !== 'index.json');
    const names = files.map(name => name.replace(/\.json$/, ''));
    const exact = names.find(name => name === wanted);
    const partial = exact || names.find(name => wanted.includes(name) || name.includes(wanted));
    if (partial) {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(baselineDir, partial + '.json'), 'utf8'));
        if (parsed && parsed.baseline) {
          loaded = { genre: partial, baseline: parsed.baseline, structureBaseline: parsed.structureBaseline || null, bookCount: parsed.bookCount || 0 };
        }
      } catch (_) {}
    }
  }

  // 优先挂载同类可比基准（若独立基准文件缺失，由此提供保底特征）
  try {
    const compBm = benchmarkDatabase.findComparableBenchmark({
      genre: loaded?.genre || wanted,
      subgenre: criteria.subgenre || wanted,
      protagonistType: criteria.protagonistType,
      prompt: criteria.prompt
    });
    if (compBm) {
      if (!loaded) {
        const m = compBm.metrics_target || {};
        loaded = {
          genre: compBm.subgenre || wanted,
          baseline: {
            sentenceLenMean: { mean: m.sentenceLenMean, stdDev: m.sentenceLenStd },
            sentenceLenStd: { mean: m.sentenceLenStd },
            paragraphLenMean: { mean: m.paragraphLenMean },
            dialogueRatio: { mean: m.dialogueRatio },
            dialogueTurnMean: { mean: m.dialogueTurnMean },
            commaPeriodRatio: { mean: m.commaPeriodRatio },
            ttr: { mean: m.ttr },
            similePerKilo: { mean: m.similePerKilo }
          },
          structureBaseline: {
            chapterCharsMean: 2500,
            chapterCharsP25: m.chapterChars?.[0] || 2125,
            chapterCharsP75: m.chapterChars?.[1] || 2875,
            openingModeDistribution: { scene: 0.85, dialogue: 0.15 }
          },
          bookCount: compBm.sample_count || 10
        };
      }
      loaded.comparableBenchmark = compBm;
    }
  } catch (_) {}

  return loaded;
}

/** 根据题材基线生成正面节奏目标块（注入起草 system，≤ 300 字）。 */
function buildBaselineTargetBlock(baselinePack) {
  if (!baselinePack || !baselinePack.baseline) return '';
  if (baselinePack.comparableBenchmark) {
    return benchmarkDatabase.buildComparablePromptTarget(baselinePack.comparableBenchmark);
  }
  const base = baselinePack.baseline;
  const structure = baselinePack.structureBaseline || {};
  const num = (stat, digits = 1) => stat && Number.isFinite(Number(stat.mean)) ? Number(stat.mean).toFixed(digits) : null;
  const lines = ['【题材节奏基准（来自 ' + (baselinePack.bookCount || 0) + ' 本同题材范本前三章统计，写作时靠近而非机械复刻）】'];
  if (num(base.sentenceLenMean)) lines.push('- 句长均值约 ' + num(base.sentenceLenMean) + ' 字，句长波动 ' + num(base.sentenceLenStd) + '；段长均值约 ' + num(base.paragraphLenMean) + ' 字。');
  if (num(base.dialogueRatio)) lines.push('- 对白占比约 ' + Math.round(Number(base.dialogueRatio.mean) * 100) + '%，单轮对白约 ' + num(base.dialogueTurnMean) + ' 字。');
  if (Number.isFinite(structure.singleSentenceParagraphRatio)) lines.push('- 单句短段占比约 ' + Math.round(structure.singleSentenceParagraphRatio * 100) + '%：短段是常态，不是缺陷；直接心理句占比约 ' + Math.round((structure.directPsychRatio || 0) * 100) + '%，允许有个人声音的直接心理。');
  if (Number.isFinite(structure.chapterCharsP25)) lines.push('- 章长参考区间 ' + structure.chapterCharsP25 + '–' + structure.chapterCharsP75 + ' 字。');
  if (structure.openingModeDistribution) {
    const top = Object.entries(structure.openingModeDistribution).sort((a, b) => b[1] - a[1])[0];
    const label = { dialogue: '对白直接切入', scene: '具体场景动作切入', exposition: '设定交代切入' }[top && top[0]] || '';
    if (label) lines.push('- 同题材范本开篇最常见方式：' + label + '（占 ' + Math.round(top[1] * 100) + '%）。');
  }
  lines.push('- 【篇幅硬预算与节奏控制】：单章正文严格控制在 2200～2800 字区间（基准目标 2500 字）。达到目标篇幅前应主动收束本章主线矛盾并制造章末钩子，严禁漫无边际扩写或膨胀至 3000 字以上。');
  lines.push('- 【单轮对白饱满度目标】：单轮对话目标 15～30 字（同题材基准均值 21 字），严禁以机械单字或无信息量短句敷衍交锋，保持人物言语博弈质感。');
  lines.push('- 【新实体前置空间登场契约（Entity Grounding）】：任何执行关键决策、展开对话或改变局面的角色，登场前必须至少有空间位置或视线引出（如身处位置、衣着轮廓、脚步声或同伴提及），严禁未经任何空间铺垫突然空降做出重大行动。');
  lines.push('- 【爽点爆发与战利品即时验货】：冲突交锋高潮处，对手必须有具象生理/心理挫败反应（如脸色惨白、冷汗、踉跄倒退、失声骇然或鲜血喷出），严禁平淡退场；主角获取战利品/机缘（储物袋、残卷、灵石等）时必须有当场触感验货细节（入手冰凉/温热微沉、神念探入扫视或揣入怀中），形成确凿即时正向反馈。');
  lines.push('- 统计只描述样本，不是文学质量门槛；章末按局面兑现决定是否留问题，人物密度按可理解性判断，不强制段落比例或人名数量。');
  return lines.join('\n');
}

/** 从合同/账本/上下文收集已知实体名，用于新专名与登场门禁统计。 */
function collectKnownEntities(context = {}) {
  const names = new Set();
  const push = value => { const text = String(value || '').trim(); if (text && text.length <= 12) names.add(text); };
  for (const character of Array.isArray(context.characters) ? context.characters : []) push(typeof character === 'string' ? character : character && character.name);
  if (context.continuity && Array.isArray(context.continuity.characters)) {
    for (const character of context.continuity.characters) push(typeof character === 'string' ? character : character && character.name);
  }
  if (context.contract && Array.isArray(context.contract.characters)) {
    for (const character of context.contract.characters) push(typeof character === 'string' ? character : character && character.name);
  }
  for (const name of Object.keys(context.byEntity || {})) push(name);
  for (const name of Array.isArray(context.knownEntities) ? context.knownEntities : []) push(name);
  if (context.contract && typeof context.contract === 'object') push(context.contract.viewpoint);
  return [...names];
}

function inferGenre(genre, text = '') {
  let wanted = String(genre || '').trim();
  if (wanted && wanted.toLowerCase() !== 'auto') {
    const evidenceLibrary = require('./genre-evidence');
    const norm = evidenceLibrary.normalizeGenre ? evidenceLibrary.normalizeGenre(wanted) : wanted;
    if (evidenceLibrary.GENRES.includes(norm)) return norm;
  }
  const t = String(text || '');
  if (/凡人|长春功|灵根|修仙|修真|仙侠|散修|药园|练气|筑基|金丹|灵气|口诀|丹药|采药|七玄门|神手谷|宗门|道友|法宝|元婴|玄幻|斗气|武魂/i.test(t)) return '玄幻';
  if (/怪谈|规则|诡异|解密|民俗|惊悚|循环|不可名状|老宅|缝尸|捞尸/i.test(t)) return '悬疑脑洞';
  if (/赛博|星舰|深空|跃迁|智脑|机甲|机械义体|废土|辐射|避难所|末世|丧尸|星际/i.test(t)) return '科幻末世';
  if (/朝廷|大明|大秦|边军|锦衣卫|皇帝|科举|漕运|藩王|历史|军垦/i.test(t)) return '历史脑洞';
  if (/甜宠|校草|学霸|暗恋|总裁|婚恋|恋爱|女频|校园/i.test(t)) return '青春甜宠';
  if (/商战|资本|重仓|并购|职场|名利|首富|金融|重生|武馆|气血|基因|高武|都市/i.test(t)) return '都市高武';
  return '玄幻';
}

/**
 * 证据审稿：确定性检查 + 模型审稿（quote 回查）。
 * params: { text, genre, contract, knownEntities, characters, byEntity, targetWords, planText }
 */
async function evidenceAudit(deps, auth, params = {}) {
  const text = String(params.text || '');
  const genre = inferGenre(params.genre, [params.prompt, text, params.contract && params.contract.goal].join(' '));
  const baselinePack = loadGenreBaseline(genre);
  const known = collectKnownEntities(params);
  const targetWords = Number(params.targetWords) || (baselinePack && baselinePack.structureBaseline && baselinePack.structureBaseline.chapterCharsMean) || 0;
  const hard = metrics.hardConstraintChecks(text, { targetWords, tolerance: 0.15, knownEntities: known, maxNewNames: 8 });
  const fingerprint = metrics.computeTextFingerprint(text);
  const styleDistance = baselinePack ? metrics.computeStyleDistance(fingerprint, baselinePack.baseline) : null;
  const structure = metrics.computeStructureStats(text);
  let correction = null;
  try { correction = require('../correction-policy').scanUniversalCorrectionRisks(text, { genre, limit: 40 }); } catch (_) { correction = null; }
  let modelIssues = { issues: [], dropped: [], acceptedCount: 0, droppedCount: 0 };
  const incompleteReasons = [];
  const context = JSON.stringify({ plan: params.planText || '', contract: params.contract || {}, ledger: params.factLedger || { byEntity: params.byEntity || {} }, previousEnding: params.previousEnding || '', continuity: params.continuity || {}, memoryContext: params.memoryContext || null });
  let parsed = null;
  let stageChange = '';
  let summary = '';
  let usage = null;
  const minChars = Number(params.minChars) || Math.max(300, Math.floor((targetWords || 2500) * 0.7));
  if (hard.chars < minChars) incompleteReasons.push('content_too_short');
  if (text.length > 32000 || context.length > 24000) incompleteReasons.push('context_budget_exceeded');
  if (!deps || typeof deps.callModel !== 'function') incompleteReasons.push('model_not_available');
  if (!incompleteReasons.length) {
    try {
      const runtime = genreRuntime(genre);
      const output = await deps.callModel(auth, {
        system: review.EVIDENCE_AUDIT_SYSTEM + '\n' + (runtime.reviewBlock || ''),
        userPrompt: '【只读合同与已提交事实】\n' + context + '\n【完整正文（段号对应原始行）】\n' + JSON.stringify(review.indexedParagraphs(text).map(item => ({ paragraphIndex: item.index, text: item.raw }))),
        maxTokens: 5000, jsonMode: true, temperature: 0.1, thinking: false, reasoningEffort: 'none', stage: 'single',
        modelId: params.modelId, genre, disableTimeout: true
      });
      usage = output && output.usage || null;
      if (!hasUsage(usage)) incompleteReasons.push('usage_missing');
      parsed = output && output.json;
      if (!parsed || !Array.isArray(parsed.issues) || typeof parsed.stageChange !== 'string' || typeof parsed.summary !== 'string') incompleteReasons.push('invalid_review_schema');
      else {
        modelIssues = review.validateIssues(text, parsed.issues);
        stageChange = parsed.stageChange.trim();
        summary = parsed.summary.trim();
        if (modelIssues.droppedCount) incompleteReasons.push('unverified_issue_evidence');
        if (!stageChange) incompleteReasons.push('stage_change_missing');
        for (const dimension of review.REVIEW_DIMENSIONS) if (!parsed.coverage || parsed.coverage[dimension] !== 'checked') incompleteReasons.push('coverage_' + dimension);
        const delta = parsed.factLedgerDelta;
        if (!delta || !['newRules', 'newPromises', 'updates'].every(key => Array.isArray(delta[key])) || !delta.byEntity || typeof delta.byEntity !== 'object' || Array.isArray(delta.byEntity) || Object.values(delta.byEntity).some(values => !Array.isArray(values))) incompleteReasons.push('invalid_ledger_schema');
        const committed = params.factLedger || {};
        const facts = [...(committed.rules || []), ...(committed.promises || []), ...Object.values(committed.byEntity || {}).filter(Array.isArray).flat()];
        for (const update of delta && Array.isArray(delta.updates) ? delta.updates : []) {
          if (!update || facts.filter(fact => fact && fact.id === update.id).length !== 1) incompleteReasons.push('unknown_ledger_update');
        }
      }
    } catch (error) {
      incompleteReasons.push(error && error.code === 'context_budget_exceeded' ? error.code : 'model_call_failed_or_unknown');
    }
  }
  const hardIssues = hard.issues.map(item => {
    let fixHint = '';
    if (item.code === 'word_count') {
      fixHint = hard.chars > (targetWords || 2500)
        ? '篇幅超出预算区间（建议 2200～2800 字），建议对冗余环境描写、拖沓心理或旁枝末节进行聚焦修剪'
        : '篇幅不足预算区间，建议展开人物交锋动作与现场感官细节';
    }
    return {
      severity: item.severity === 'blocker' ? 'blocker' : item.severity === 'warning' ? 'medium' : 'low',
      category: 'hard:' + item.code,
      quote: '',
      problem: item.detail,
      reason: '确定性检查',
      fixHint,
      samples: item.samples || null,
      paragraphIndex: null
    };
  });
  const groundingIssues = (params.checkGrounding !== false && (params.checkGrounding === true || known.length > 0))
    ? review.checkEntityGrounding(text, { knownEntities: known })
    : [];
  const payoffIssues = (params.checkPayoff === true || (params.checkPayoff !== false && params.expectPayoff === true))
    ? review.checkPayoffExecution(text, { genre, expectPayoff: params.expectPayoff })
    : [];
  const correctionIssues = correction && Array.isArray(correction.findings) ? correction.findings.slice(0, 12).map(item => ({ severity: item.severity === 'high' ? 'medium' : 'low', category: 'correction:' + item.ruleId, quote: item.text, problem: item.label, reason: '题材纠错库命中', fixHint: '改为具体动作或删除套话', paragraphIndex: (review.locateQuote(text, item.text).paragraphIndex || null) })) : [];
  const issues = [...modelIssues.issues, ...hardIssues, ...groundingIssues, ...payoffIssues, ...correctionIssues];
  const noStageChange = stageChange && /^(?:无|没有|无变化|无实质变化)/.test(stageChange);
  const ledger = verifiedLedgerDelta(text, parsed && parsed.factLedgerDelta);
  if (ledger.invalidCount) incompleteReasons.push('unverified_ledger_evidence');
  const blocking = issues.some(item => ['blocker', 'high', 'medium'].includes(item.severity) && !String(item.category).startsWith('correction:'));
  return {
    passed: incompleteReasons.length === 0 && !blocking && !noStageChange,
    needsRevision: issues.some(item => item.paragraphIndex && ['blocker', 'high', 'medium'].includes(item.severity)) && !['content_too_short', 'context_budget_exceeded', 'model_not_available'].some(r => incompleteReasons.includes(r)),
    status: incompleteReasons.length ? 'incomplete' : blocking || noStageChange ? 'needs_review' : 'passed',
    incompleteReasons, contentHash: review.textHash(text), coverage: parsed && parsed.coverage || {},
    coveredChars: parsed ? text.length : 0, humanReviewStatus: 'pending',
    factLedgerDelta: ledger.delta,
    invalidLedgerEvidence: ledger.invalidEvidence,
    issues,
    droppedIssues: modelIssues.dropped,
    stageChange, noStageChange, summary,
    hard: { passed: hard.passed, chars: hard.chars, newNames: hard.newNames, repeatedSentences: hard.repeatedSentences, duplicateParagraphs: hard.duplicateParagraphs.length },
    correction: correction ? { status: correction.status, findingCount: correction.findingCount, genreFamily: correction.genreFamily, skippedRuleIds: correction.skippedRuleIds, matchedRuleIds: correction.matchedRuleIds } : null,
    fingerprint, styleDistance, structure,
    baseline: baselinePack ? { genre: baselinePack.genre, bookCount: baselinePack.bookCount } : null,
    usage
  };
}

/**
 * 局部修订一轮：按 issues 组装目标段，调用模型改写，复核。
 * 返回 { revisedText, review, targets, usage }。目标为空时返回原文与 accepted=true。
 */
async function localRevise(deps, auth, params = {}) {
  const text = String(params.text || '');
  const issues = (Array.isArray(params.issues) ? params.issues : []).filter(item => item && item.paragraphIndex);
  const targets = review.buildRevisionTargets(text, issues, 8);
  if (!targets.length) return { revisedText: text, targets, review: { accepted: false, reason: 'no_verified_targets' }, usage: null, skipped: true };
  const output = await deps.callModel(auth, {
    system: '你是定向修订编辑。只输出严格JSON段落补丁，不输出整篇正文；保留既定事实，不新增无依据的事实。修改仅针对可验证问题。',
    userPrompt: review.buildLocalRevisionPrompt(text, targets),
    maxTokens: 5000, jsonMode: true, temperature: 0.4, thinking: false, reasoningEffort: 'none', stage: 'single',
    modelId: params.modelId || undefined, disableTimeout: true
  });
  if (!hasUsage(output && output.usage)) return { revisedText: text, targets, review: { accepted: false, reason: 'usage_missing' }, usage: output && output.usage || null };
  return { ...review.applyParagraphPatches(text, output && output.json, targets), targets, usage: output && output.usage || null };
}

/**
 * 审稿→修订→复核闭环：最多 MAX_REVISION_ROUNDS 轮；未通过保留 needs_review，不无限重写。
 */
async function auditReviseLoop(deps, auth, params = {}) {
  let text = String(params.text || '');
  const rounds = [];
  const calls = [];
  const tracked = trackedDependencies(deps, calls);
  let audit = deps.initialAudit && deps.initialAudit.contentHash === review.textHash(text) ? deps.initialAudit : await evidenceAudit(tracked, auth, { ...params, text });
  const requested = Number(params.maxRounds ?? MAX_REVISION_ROUNDS);
  const maxRounds = Number.isFinite(requested) ? Math.max(0, Math.min(MAX_REVISION_ROUNDS, Math.floor(requested))) : MAX_REVISION_ROUNDS;
  for (let round = 1; round <= maxRounds; round += 1) {
    if (audit.passed || !audit.needsRevision) break;
    let revision;
    try { revision = await localRevise(tracked, auth, { text, issues: audit.issues, modelId: params.reviseModelId || params.modelId }); }
    catch (_) { rounds.push({ round, accepted: false, reason: 'revision_call_failed_or_unknown' }); break; }
    const before = audit;
    if (!revision.review.accepted) {
      rounds.push({ round, accepted: false, review: revision.review, issuesBefore: before.issues.length });
      break;
    }
    const candidate = await evidenceAudit(tracked, auth, { ...params, text: revision.revisedText });
    const accepted = candidate.status !== 'incomplete' && auditPenalty(candidate) < auditPenalty(before);
    rounds.push({ round, accepted, review: revision.review, issuesBefore: before.issues.length, issuesAfter: candidate.issues.length, candidateAudit: candidate, usage: revision.usage });
    if (!accepted) break;
    text = revision.revisedText;
    audit = candidate;
  }
  return { text, audit, rounds, calls, usage: aggregateUsage(calls), status: audit.passed ? 'passed' : 'needs_review', humanReviewStatus: 'pending' };
}

function hasUsage(usage) {
  return !!usage && usage.status !== 'truncated' && usage.status !== 'missing' && Number(usage.totalTokens ?? usage.total_tokens ?? usage.usage?.total_tokens) > 0;
}

function genreRuntime(genre, assetRoot = path.join(__dirname, '..', 'data')) {
  const evidenceLibrary = require('./genre-evidence');
  const wanted = evidenceLibrary.normalizeGenre ? evidenceLibrary.normalizeGenre(genre) : String(genre || '').trim();
  if (!evidenceLibrary.GENRES.includes(wanted)) return evidenceLibrary.loadGenreRuntime(wanted);
  try {
    const evidence = JSON.parse(fs.readFileSync(path.join(assetRoot, 'genre-evidence', wanted + '.json'), 'utf8'));
    const rules = JSON.parse(fs.readFileSync(path.join(assetRoot, 'genre-rules', wanted + '.json'), 'utf8'));
    return evidenceLibrary.loadGenreRuntime(wanted, { evidence, rules });
  } catch (_) {
    return evidenceLibrary.loadGenreRuntime(wanted);
  }
}

function verifiedLedgerDelta(text, source) {
  const delta = { newRules: [], newPromises: [], byEntity: {}, updates: [] };
  let invalidCount = 0;
  const invalidEvidence = [];
  const validate = values => (Array.isArray(values) ? values : []).filter(item => {
    const location = item && review.locateQuote(text, item.quote, item.paragraphIndex);
    const valid = location && location.found && (typeof item.text === 'string' && item.text.trim() || item.id && ['paid', 'superseded'].includes(item.status));
    if (!valid) {
      invalidCount += 1;
      invalidEvidence.push({ paragraphIndex: item && item.paragraphIndex || null, quote: item && item.quote || '', reason: location && !location.found ? location.reason : 'invalid_fact_schema' });
    }
    return valid;
  });
  if (source && typeof source === 'object') {
    delta.newRules = validate(source.newRules);
    delta.newPromises = validate(source.newPromises);
    delta.updates = validate(source.updates);
    for (const [name, values] of Object.entries(source.byEntity || {})) {
      if (['__proto__', 'constructor', 'prototype'].includes(name)) {
        invalidCount += 1;
        invalidEvidence.push({ paragraphIndex: null, quote: '', reason: 'invalid_entity_key' });
      } else delta.byEntity[name] = validate(values);
    }
  }
  return { delta, invalidCount, invalidEvidence };
}

function trackedDependencies(deps, calls) {
  return { ...deps, callModel: async (auth, options) => {
    const record = { stage: options.jsonMode ? 'review_or_revision' : 'draft', modelId: options.modelId || null, parameters: { temperature: options.temperature ?? 0.3, maxTokens: options.maxTokens ?? 2000, topP: options.topP ?? null, seed: options.seed ?? null, modelVersion: options.modelVersion ?? options.modelId ?? null }, parameterSource: 'pipeline-request; provider overrides not independently verified', requestHash: review.textHash(JSON.stringify(options)), startedAt: new Date().toISOString(), status: 'started', usage: null };
    calls.push(record);
    try {
      const output = await deps.callModel(auth, options);
      record.status = hasUsage(output && output.usage) ? 'completed' : 'usage_missing';
      record.usage = output && output.usage || null;
      record.providerModel = record.usage && record.usage.providerModel || null;
      record.outputHash = review.textHash(output && (output.text || JSON.stringify(output.json)) || '');
      return output;
    } catch (error) {
      record.status = 'failed_or_unknown';
      throw error;
    } finally { record.finishedAt = new Date().toISOString(); }
  } };
}

function aggregateUsage(calls) {
  return { totalTokens: calls.reduce((total, call) => total + Number(call.usage && (call.usage.totalTokens ?? call.usage.total_tokens) || 0), 0), creditCost: calls.reduce((total, call) => total + Number(call.usage && call.usage.creditCost || 0), 0), callCount: calls.length, complete: calls.every(call => call.status === 'completed'), calls };
}

function auditPenalty(audit) {
  if (!audit || audit.status === 'incomplete') return 1000000;
  return (audit.noStageChange ? 1000 : 0) + audit.issues.reduce((total, item) => total + ({ blocker: 10000, high: 1000, medium: 100, low: 1 }[item.severity] || 1), 0);
}

async function generateChapter(deps, auth, params = {}) {
  const calls = [];
  const tracked = trackedDependencies(deps, calls);
  const effectiveGenre = inferGenre(params.genre, [params.prompt, params.contract && params.contract.goal, params.writingSystem].join(' '));
  const runtime = genreRuntime(effectiveGenre);
  const baseline = loadGenreBaseline(effectiveGenre);
  const generationReasoningEffort = params.reasoningEffort || (/^gpt-6-luna$/i.test(String(params.modelId || '')) ? 'medium' : undefined);
  const targetWords = Math.max(1200, Math.min(8000, Number(params.targetWords) || 2500));
  const context = JSON.stringify({ contract: params.contract || {}, factLedger: params.factLedger || {}, previousEnding: params.previousEnding || '', continuity: params.continuity || {}, memoryContext: params.memoryContext || null });
  const runtimeBlock = runtime.writingBlock || '';
  const baselineBlock = buildBaselineTargetBlock(baseline);
  const extraBlocks = [];
  if (runtimeBlock && (!params.writingSystem || !params.writingSystem.includes(runtimeBlock.slice(0, 30)))) {
    extraBlocks.push(runtimeBlock);
  }
  if (baselineBlock && (!params.writingSystem || !params.writingSystem.includes(baselineBlock.slice(0, 30)))) {
    extraBlocks.push(baselineBlock);
  }
  let system = sanitizeSystemForUpstream(params.control === true ? String(params.controlSystem || '') : [params.writingSystem || '只写原创中文小说正文，不输出提纲或说明。先落实当下人物目标、行动阻力、认知边界和局面变化。', ...extraBlocks].filter(Boolean).join('\n\n'));
  const isLargeContextModel = /gpt-6|deepseek|claude|gemini|v4|v3/i.test(String(params.modelId || ''));
  const maxSystemBudget = isLargeContextModel ? 64000 : 32000;
  const maxContextBudget = isLargeContextModel ? 48000 : 32000;
  const maxPromptBudget = isLargeContextModel ? 24000 : 16000;
  if (!system.trim() || context.length > maxContextBudget || system.length > maxSystemBudget || String(params.prompt || '').length > maxPromptBudget) {
    if (system.length > maxSystemBudget && system.length <= maxSystemBudget * 1.15) {
      system = system.replace(/\n{3,}/g, '\n\n').trim();
    }
    if (!system.trim() || context.length > maxContextBudget || system.length > maxSystemBudget || String(params.prompt || '').length > maxPromptBudget) {
      console.error(`[generateChapter Budget Exceeded] system: ${system.length}/${maxSystemBudget}, context: ${context.length}/${maxContextBudget}, prompt: ${String(params.prompt || '').length}/${maxPromptBudget}`);
      throw Object.assign(new Error('上下文超过预算或对照提示缺失，未静默裁剪'), { code: 'context_budget_exceeded' });
    }
  }
  let draft;
  const characterMaterial = {
    proseTask: true,
    novelId: params.novelId || '',
    genre: effectiveGenre,
    characters: Array.isArray(params.characters) ? params.characters : Array.isArray(params.contract?.characters) ? params.contract.characters : Array.isArray(params.continuity?.characters) ? params.continuity.characters : []
  };
  const isReasoning = Boolean(generationReasoningEffort && generationReasoningEffort !== 'none');
  const maxTokensClamped = (isReasoning || /^gpt-6-luna$/i.test(String(params.modelId || '')))
    ? Math.min(12000, Math.max(8000, Math.ceil(targetWords * 3.5)))
    : Math.min(4800, Math.ceil(targetWords * 1.5));
  const chapterPrompt = '【只读上下文】\n' + context + '\n【本章任务】\n' + params.prompt + '\n目标篇幅：' + targetWords + '字（篇幅预算 2200～2800 字，按时利落收口）。正文到达 2400～2600 字区间必须完成本章主线冲突的阶段性收网与章末断点，严禁继续漫延到 3000 字以上。';
  try {
    draft = await tracked.callModel(auth, {
      system,
      userPrompt: chapterPrompt,
      maxTokens: maxTokensClamped,
      temperature: params.temperature ?? 0.8,
      topP: params.topP ?? null,
      seed: params.seed ?? null,
      modelVersion: params.modelVersion ?? params.modelId ?? null,
      thinking: false,
      reasoningEffort: generationReasoningEffort,
      stage: 'writing',
      characterMaterial,
      modelId: params.modelId,
      genre: effectiveGenre,
      jsonMode: false
    });
  } catch (error) {
    console.error('[generateChapter draft error]:', error && error.stack || error);
    return { text: '', status: 'needs_review', audit: { passed: false, status: 'incomplete', incompleteReasons: ['draft_call_failed_or_unknown'] }, calls, usage: aggregateUsage(calls), humanReviewStatus: 'pending' };
  }
  const rawText = String(draft && draft.text || '').trim();
  const text = sanitizeAiFlavor(rawText);
  if (!text || !hasUsage(draft && draft.usage)) return { text, status: 'needs_review', audit: { passed: false, status: 'incomplete', incompleteReasons: ['draft_or_usage_missing'] }, calls, usage: aggregateUsage(calls) };
  let selectedText = text;
  let selectedAudit = await evidenceAudit(tracked, auth, { ...params, text, targetWords });
  const candidates = [{ contentHash: review.textHash(text), audit: selectedAudit }];
  if (params.control !== true && selectedAudit.status !== 'incomplete' && (!selectedAudit.passed || selectedAudit.styleDistance && selectedAudit.styleDistance.score < 70)) {
    let alternative;
    try {
      alternative = await tracked.callModel(auth, {
        system,
        userPrompt: chapterPrompt + ' 独立构思场景展开，不改既定事实。',
        maxTokens: maxTokensClamped,
        temperature: params.temperature ?? 0.8,
        topP: params.topP ?? null,
        seed: params.seed ?? null,
        modelVersion: params.modelVersion ?? params.modelId ?? null,
        thinking: false,
        reasoningEffort: generationReasoningEffort,
        stage: 'writing',
        characterMaterial,
        modelId: params.modelId,
        genre: params.genre,
        jsonMode: false
      });
    } catch (_) {
      return { text: selectedText, status: 'needs_review', audit: { ...selectedAudit, passed: false, status: 'incomplete', incompleteReasons: ['alternative_call_failed_or_unknown'] }, candidates, calls, usage: aggregateUsage(calls), humanReviewStatus: 'pending' };
    }
    if (hasUsage(alternative && alternative.usage) && String(alternative.text || '').trim()) {
      const alternativeText = sanitizeAiFlavor(alternative.text.trim());
      const alternativeAudit = await evidenceAudit(tracked, auth, { ...params, text: alternativeText, targetWords });
      candidates.push({ contentHash: review.textHash(alternativeText), audit: alternativeAudit });
      if (auditPenalty(alternativeAudit) < auditPenalty(selectedAudit) || auditPenalty(alternativeAudit) === auditPenalty(selectedAudit) && (alternativeAudit.styleDistance?.score || 0) > (selectedAudit.styleDistance?.score || 0)) {
        selectedText = alternativeText;
        selectedAudit = alternativeAudit;
      }
    }
  }
  const result = await auditReviseLoop({ ...deps, initialAudit: selectedAudit }, auth, { ...params, text: selectedText, targetWords, maxRounds: params.control === true ? 0 : params.maxRounds });
  const allCalls = [...calls, ...result.calls];
  const totalUsage = aggregateUsage(allCalls);
  return { ...result, status: result.audit.passed && totalUsage.complete ? 'passed' : 'needs_review', calls: allCalls, candidates, selectedHash: selectedAudit.contentHash, usage: totalUsage, protocol: 'benchmark-local-v2', genreAssetStatus: runtime.status };
}

module.exports = { DEFAULT_BASELINE_DIR, MAX_REVISION_ROUNDS, loadGenreBaseline, buildBaselineTargetBlock, collectKnownEntities, evidenceAudit, localRevise, auditReviseLoop, generateChapter, verifiedLedgerDelta, hasUsage, aggregateUsage, auditPenalty, genreRuntime, resolveGenreFamily: scope.resolveGenreFamily, benchmarkDatabase };
