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
const { auditDraft } = require('./generation/deterministic-audit');
const { assembleContext } = require('./generation/context');
const { buildGenerationManifest, hashValue } = require('./generation/manifest');
const { resolveGenre } = require('./genre/resolver');
const { buildGenreProfile } = require('./genre/profile');
const { compileStyleBundle } = require('./style/style-bundle');
const scenePlanner = require('./scene-planner');

const DEFAULT_BASELINE_DIR = path.join(__dirname, '..', 'data', 'genre-baselines');
const MAX_REVISION_ROUNDS = 2;

/** 读取题材基线文件；优先尝试同类可比 Benchmark，按精确名、包含关系依次匹配。 */
function loadGenreBaseline(genre, baselineDir = DEFAULT_BASELINE_DIR, criteria = {}) {
  let wanted = String(genre || '').trim();
  if (!wanted || wanted.toLowerCase() === 'auto') return null;

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
        const chapterChars = Array.isArray(m.chapterChars)
          && m.chapterChars.length === 2
          && m.chapterChars.every(Number.isFinite)
          ? m.chapterChars
          : null;
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
            chapterCharsP25: chapterChars ? chapterChars[0] : undefined,
            chapterCharsP75: chapterChars ? chapterChars[1] : undefined,
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

/** 根据题材基线生成样本统计观察块（注入起草 system，≤ 300 字）。 */
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
  if (Number.isFinite(structure.chapterCharsP25) && Number.isFinite(structure.chapterCharsP75)) {
    lines.push('- 同题材样本章长中间区间约 ' + structure.chapterCharsP25 + '～' + structure.chapterCharsP75 + ' 字，仅作统计参考，实际篇幅以本章目标为准。');
  }
  if (structure.openingModeDistribution) {
    const top = Object.entries(structure.openingModeDistribution).sort((a, b) => b[1] - a[1])[0];
    const label = { dialogue: '对白直接切入', scene: '具体场景动作切入', exposition: '设定交代切入' }[top && top[0]] || '';
    if (label) lines.push('- 同题材样本常见开篇方式：' + label + '（占 ' + Math.round(top[1] * 100) + '%，仅供观察，不要求采用）。');
  }
  lines.push('- 对白长度、描写方式和章末落点只描述样本分布，不是质量门槛；按人物表达目的与本章合同取舍，不强制统一比例或套路。');
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
    return evidenceLibrary.GENRES.includes(norm) ? norm : wanted;
  }
  const t = String(text || '');
  if (/凡人|长春功|灵根|修仙|修真|仙侠|散修|药园|练气|筑基|金丹|灵气|口诀|丹药|采药|七玄门|神手谷|宗门|道友|法宝|元婴|玄幻|斗气|武魂/i.test(t)) return '玄幻';
  if (/怪谈|规则|诡异|解密|民俗|惊悚|循环|不可名状|老宅|缝尸|捞尸/i.test(t)) return '悬疑脑洞';
  if (/赛博|星舰|深空|跃迁|智脑|机甲|机械义体|废土|辐射|避难所|末世|丧尸|星际/i.test(t)) return '科幻末世';
  if (/朝廷|大明|大秦|边军|锦衣卫|皇帝|科举|漕运|藩王|历史|军垦/i.test(t)) return '历史脑洞';
  if (/甜宠|校草|学霸|暗恋|总裁|婚恋|恋爱|女频|校园/i.test(t)) return '青春甜宠';
  if (/商战|资本|重仓|并购|职场|名利|首富|金融|重生|武馆|气血|基因|高武|都市/i.test(t)) return '都市高武';
  return null;
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
  const comparableRange = baselinePack?.comparableBenchmark?.metrics_target?.chapterChars;
  const baselineTarget = Number(baselinePack?.structureBaseline?.chapterCharsMean)
    || (Array.isArray(comparableRange) && comparableRange.length === 2 ? (Number(comparableRange[0]) + Number(comparableRange[1])) / 2 : 0);
  const targetWords = Number(params.targetWords) || baselineTarget;
  const hard = metrics.hardConstraintChecks(text, { targetWords, tolerance: 0.15, knownEntities: known, maxNewNames: 8 });
  const fingerprint = metrics.computeTextFingerprint(text);
  const styleDistance = baselinePack ? metrics.computeStyleDistance(fingerprint, baselinePack.baseline) : null;
  const structure = metrics.computeStructureStats(text);
  let correction = null;
  try { correction = require('../correction-policy').scanUniversalCorrectionRisks(text, { genre, limit: 40 }); } catch (_) { correction = null; }
  let modelIssues = { issues: [], dropped: [], acceptedCount: 0, droppedCount: 0 };
  const incompleteReasons = [];
  const context = String(params.compiledContextText || JSON.stringify({ plan: params.planText || '', contract: params.contract || {}, ledger: params.factLedger || { byEntity: params.byEntity || {} }, previousEnding: params.previousEnding || '', continuity: params.continuity || {}, memoryContext: params.memoryContext || null }));
  let parsed = null;
  let stageChange = '';
  let summary = '';
  let stateDelta = { timeline: [], relations: [], characters: [], world: [] };
  let outlineImpact = { status: 'unplanned', addressed: [], deferred: [], unresolved: [] };
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
        const verifiedState = verifiedStateDelta(text, parsed.stateDelta);
        stateDelta = verifiedState.delta;
        if (verifiedState.invalidCount) incompleteReasons.push('unverified_state_delta');
        const verifiedOutline = verifiedOutlineImpact(text, parsed.outlineImpact, params);
        outlineImpact = verifiedOutline.impact;
        if (verifiedOutline.invalidCount) incompleteReasons.push('unverified_outline_impact');
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
  const stageChangeRequired = params.requireStageChange === true || params.contract?.requireStageChange === true;
  const ledger = verifiedLedgerDelta(text, parsed && parsed.factLedgerDelta);
  if (ledger.invalidCount) incompleteReasons.push('unverified_ledger_evidence');
  const blocking = issues.some(item => ['blocker', 'high', 'medium'].includes(item.severity) && !String(item.category).startsWith('correction:'));
  return {
    passed: incompleteReasons.length === 0 && !blocking && !(stageChangeRequired && noStageChange),
    needsRevision: issues.some(item => item.paragraphIndex && ['blocker', 'high', 'medium'].includes(item.severity)) && !['content_too_short', 'context_budget_exceeded', 'model_not_available'].some(r => incompleteReasons.includes(r)),
    status: incompleteReasons.length ? 'incomplete' : blocking || (stageChangeRequired && noStageChange) ? 'needs_review' : 'passed',
    incompleteReasons, contentHash: review.textHash(text), coverage: parsed && parsed.coverage || {},
    coveredChars: parsed ? text.length : 0, humanReviewStatus: 'pending',
    factLedgerDelta: ledger.delta,
    invalidLedgerEvidence: ledger.invalidEvidence,
    stateDelta,
    outlineImpact,
    issues,
    droppedIssues: modelIssues.dropped,
    stageChange, noStageChange, stageChangeRequired, summary,
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
  let deterministicAudit = deterministicAuditFor(text, params);
  if (!deterministicAudit.passed) {
    return { text, audit: deterministicAudit, deterministicAudit, rounds, calls, usage: aggregateUsage(calls), status: 'needs_review', humanReviewStatus: 'pending' };
  }
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
    const candidateDeterministicAudit = deterministicAuditFor(revision.revisedText, params);
    if (!candidateDeterministicAudit.passed) {
      rounds.push({ round, accepted: false, reason: 'deterministic_gate_failed', deterministicAudit: candidateDeterministicAudit, usage: revision.usage });
      break;
    }
    const candidate = await evidenceAudit(tracked, auth, { ...params, text: revision.revisedText });
    const accepted = candidate.status !== 'incomplete' && auditPenalty(candidate) < auditPenalty(before);
    rounds.push({ round, accepted, review: revision.review, issuesBefore: before.issues.length, issuesAfter: candidate.issues.length, candidateAudit: candidate, usage: revision.usage });
    if (!accepted) break;
    text = revision.revisedText;
    audit = candidate;
    deterministicAudit = candidateDeterministicAudit;
  }
  return { text, audit, deterministicAudit, rounds, calls, usage: aggregateUsage(calls), status: audit.passed ? 'passed' : 'needs_review', humanReviewStatus: 'pending' };
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

function verifiedStateDelta(text, source) {
  const empty = { timeline: [], relations: [], characters: [], world: [] };
  let invalidCount = 0;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return { delta: empty, invalidCount: 1 };
  const normalize = (key, requireEntity) => {
    if (!Array.isArray(source[key])) { invalidCount += 1; return []; }
    return source[key].slice(0, 64).flatMap(item => {
      const quote = String(item && item.quote || '').trim();
      const location = review.locateQuote(text, quote, item && item.paragraphIndex);
      const label = String(item && (item.entity || item.text) || '').trim().slice(0, 240);
      const description = String(item && item.text || '').trim().slice(0, 500);
      if (!location || !location.found || !description || (requireEntity && (!label || !quote.includes(label)))) {
        invalidCount += 1;
        return [];
      }
      const entry = { text: description, quote, paragraphIndex: location.paragraphIndex };
      if (requireEntity) entry.entity = label;
      if (key === 'timeline') {
        entry.location = String(item.location || '').trim().slice(0, 160);
        entry.participants = Array.isArray(item.participants)
          ? item.participants.map(value => String(value || '').trim()).filter(Boolean).slice(0, 12) : [];
      }
      if (key === 'characters') {
        const lifeStatus = String(item.lifeStatus || 'unknown');
        entry.lifeStatus = ['alive', 'dead', 'unknown'].includes(lifeStatus) ? lifeStatus : 'unknown';
        entry.location = String(item.location || '').trim().slice(0, 160);
      }
      return [entry];
    });
  };
  const delta = {
    timeline: normalize('timeline', false),
    relations: normalize('relations', true),
    characters: normalize('characters', true),
    world: normalize('world', true)
  };
  return { delta, invalidCount };
}

function outlineTargets(params = {}) {
  const contract = params.contract && typeof params.contract === 'object' ? params.contract
    : params.chapterContract && typeof params.chapterContract === 'object' ? params.chapterContract : {};
  const targets = [String(params.planText || '').trim(), String(contract.chapterGoal || contract.goal || '').trim()];
  for (const scene of Array.isArray(contract.scenes) ? contract.scenes : []) {
    targets.push(String(scene && scene.purpose || '').trim(), String(scene && scene.goal || '').trim());
    targets.push(...(Array.isArray(scene && scene.mustAdvance) ? scene.mustAdvance.map(String) : []));
  }
  return [...new Set(targets.map(value => value.trim()).filter(value => value.length >= 4 && value.length <= 500))];
}

function verifiedOutlineImpact(text, source, params = {}) {
  const targets = outlineTargets(params);
  const empty = { status: 'unplanned', addressed: [], deferred: [], unresolved: [] };
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      !Array.isArray(source.addressed) || !Array.isArray(source.deferred)) {
    return { impact: empty, invalidCount: 1 };
  }
  const invalidStatus = !['aligned', 'partial', 'diverged', 'unplanned'].includes(String(source.status || ''));
  let invalidCount = invalidStatus ? 1 : 0;
  const verify = values => values.slice(0, 64).flatMap(item => {
    const beat = String(item && item.text || '').trim();
    const quote = String(item && item.quote || '').trim();
    const location = review.locateQuote(text, quote, item && item.paragraphIndex);
    if (!targets.some(target => target.includes(beat)) || beat.length < 4 || !location || !location.found) {
      invalidCount += 1;
      return [];
    }
    return [{ text: beat, quote, paragraphIndex: location.paragraphIndex }];
  });
  const addressed = verify(source.addressed);
  const deferred = verify(source.deferred);
  if (!targets.length) {
    if (String(source.status) !== 'unplanned' || addressed.length || deferred.length) invalidCount += 1;
    return { impact: empty, invalidCount };
  }
  const covered = new Set([...addressed, ...deferred].map(item => item.text));
  const unresolved = targets.filter(target => ![...covered].some(item => target.includes(item) || item.includes(target)));
  const status = deferred.length || unresolved.length
    ? addressed.length ? 'partial' : 'diverged'
    : 'aligned';
  return { impact: { status, addressed, deferred, unresolved }, invalidCount };
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
  return (audit.stageChangeRequired && audit.noStageChange ? 1000 : 0) + audit.issues.reduce((total, item) => total + ({ blocker: 10000, high: 1000, medium: 100, low: 1 }[item.severity] || 1), 0);
}

/** 按章节合同执行确定性长度、重复段落和空稿门禁，不使用题材统一字数线。 */
function deterministicAuditFor(text, params = {}) {
  const contract = params.contract && typeof params.contract === 'object'
    ? params.contract
    : params.chapterContract && typeof params.chapterContract === 'object' ? params.chapterContract : {};
  const budget = contract.wordBudget && typeof contract.wordBudget === 'object'
    ? contract.wordBudget
    : params.genreBudgetProfile && typeof params.genreBudgetProfile === 'object' ? params.genreBudgetProfile : {};
  const target = Number(budget.targetChars) || Number(params.targetChars) || Number(params.targetWords) || 0;
  let minChars = Number(budget.minChars) || Number(params.minChars) || 0;
  let maxChars = Number(budget.maxChars) || Number(params.maxChars) || 0;
  if (target > 0) {
    if (!minChars) minChars = Math.ceil(target * 0.85);
    if (!maxChars) maxChars = Math.floor(target * 1.15);
  }
  return auditDraft({ text, minChars, maxChars, strictLength: minChars > 0 || maxChars > 0 });
}

/** 将服务端已验证的状态冲突挡在 Writer 调用之前。 */
function preGenerationBlockers(params = {}) {
  const guard = params.preGenerationGuard || params.preGenerationCheck;
  if (!guard || guard.passed !== false) return [];
  const source = Array.isArray(guard.blockers) ? guard.blockers
    : Array.isArray(guard.issues) ? guard.issues
      : Array.isArray(guard.findings) ? guard.findings : [];
  const issues = source.map((item, index) => ({
    issueId: String(item && item.issueId || `guard_${index + 1}`),
    category: String(item && (item.category || item.type) || 'state'),
    severity: 'blocker',
    quote: String(item && item.quote || ''),
    quoteHash: String(item && item.quoteHash || ''),
    sourceFactId: String(item && (item.sourceFactId || item.factId) || ''),
    problem: String(item && (item.problem || item.message || item.description) || '生成前状态校验未通过'),
    fixHint: String(item && (item.fixHint || item.fix) || ''),
    status: 'verified'
  }));
  if (!issues.length) issues.push({
    issueId: 'guard_1', category: 'state', severity: 'blocker', quote: '', quoteHash: '', sourceFactId: '',
    problem: String(guard.reason || '生成前状态校验未通过'), fixHint: '', status: 'verified'
  });
  return issues;
}

/** 只将合同涉及的人物状态和当前有效账目放入硬状态区。 */
function selectHardState(params, contract) {
  if (params.hardState && typeof params.hardState === 'object') return params.hardState;
  const ledger = params.factLedger && typeof params.factLedger === 'object' ? params.factLedger : {};
  const requested = [...(Array.isArray(params.characters) ? params.characters : []), ...(Array.isArray(contract.characters) ? contract.characters : [])]
    .map(item => typeof item === 'string' ? item : String(item && (item.name || item.id) || ''))
    .filter(Boolean);
  const byEntity = ledger.byEntity && typeof ledger.byEntity === 'object' ? ledger.byEntity : {};
  const selectedByEntity = {};
  if (requested.length) {
    for (const [name, facts] of Object.entries(byEntity)) {
      if (requested.includes(name)) selectedByEntity[name] = Array.isArray(facts) ? facts.slice(-30) : facts;
    }
  }
  const selected = {};
  if (Object.keys(selectedByEntity).length) selected.byEntity = selectedByEntity;
  for (const key of ['rules', 'promises']) {
    if (Array.isArray(ledger[key]) && ledger[key].length) selected[key] = ledger[key].slice(-40);
  }
  return Object.keys(selected).length ? selected : null;
}

/** 将现有六类题材映射到题材画像键，不把题材规则混入文风选择。 */
function genreProfileKey(genre) {
  return ({
    '玄幻': '玄幻', '都市高武': '都市', '悬疑脑洞': '悬疑',
    '历史脑洞': '历史', '青春甜宠': '言情', '科幻末世': '科幻'
  })[String(genre || '')] || String(genre || '');
}

/** 从已有角色声音字段编译可用于风格包的标准人物与关系契约。 */
function styleBundleVoices(params, contract) {
  const characters = [...(Array.isArray(params.characters) ? params.characters : []), ...(Array.isArray(contract.characters) ? contract.characters : [])];
  const voices = characters.filter(item => item && typeof item === 'object').map(character => {
    const voice = character.voice_contract || character.voiceContract || character.voice || {};
    return {
      characterId: String(character.id || character.name || ''),
      speech: { sentenceLength: voice.turnLengthPref || voice.turn_length_pref || voice.sentenceLengthPreference || 'varied' },
      verbalHabits: voice.styleHabits || voice.style_habits || voice.verbalHabits || voice.verbal_habits || [],
      taboos: voice.tabooWords || voice.taboo_words || voice.tabooPhrases || voice.taboo_phrases || []
    };
  });
  return {
    characterVoices: Array.isArray(params.characterVoices) ? params.characterVoices : voices,
    relationshipVoices: Array.isArray(params.relationshipVoices) ? params.relationshipVoices : []
  };
}

/** 按作者明确选择生成 Style Bundle；缺失风格时不注入虚构默认风格。 */
function buildPipelineStyleBundle(params, contract, genreProfile) {
  const selected = params.styleDNA || params.styleProfile || params.style || params.stylePreset;
  if (!selected) return null;
  const style = typeof selected === 'string' ? { style: selected } : selected;
  const voices = styleBundleVoices(params, contract);
  const result = compileStyleBundle({
    style,
    genreProfile: genreProfile || {},
    narrativeProfile: params.narrativeProfile || {},
    characterVoices: voices.characterVoices,
    relationshipVoices: voices.relationshipVoices,
    sceneProfile: params.sceneProfile || {},
    commercialProfile: params.commercialProfile || {}
  });
  return result.status === 'resolved' ? result : null;
}

async function generateChapter(deps, auth, params = {}) {
  const calls = [];
  const tracked = trackedDependencies(deps, calls);
  const blockers = preGenerationBlockers(params);
  if (blockers.length) {
    const audit = { passed: false, status: 'blocked', contentHash: review.textHash(''), charCount: 0, issues: blockers, unverifiedCount: 0, blockerCount: blockers.length, phase: 'pre_generation_guard' };
    return { text: '', status: 'needs_review', audit, calls, usage: aggregateUsage(calls), humanReviewStatus: 'pending' };
  }
  let contract = params.contract && typeof params.contract === 'object' ? params.contract
    : params.chapterContract && typeof params.chapterContract === 'object' ? params.chapterContract : {};
  const inferredGenre = inferGenre(params.genre, [params.prompt, contract.chapterGoal || contract.goal, params.writingSystem].join(' '));
  const detectedGenre = resolveGenre({ genre: params.genre, subgenre: params.subgenre, title: params.novelTitle, userInstruction: params.prompt, prompt: params.prompt, messages: params.messages });
  const resolverGenreMap = { '玄幻': '玄幻', '都市': '都市高武', '悬疑': '悬疑脑洞', '历史': '历史脑洞', '言情': '青春甜宠', '科幻': '科幻末世' };
  const effectiveGenre = inferredGenre || (detectedGenre.status === 'resolved' ? resolverGenreMap[detectedGenre.genre] || detectedGenre.genre : null);
  const genreResolution = inferredGenre
    ? { status: 'resolved', confidence: 1, genre: genreProfileKey(inferredGenre), subgenre: String(params.subgenre || ''), source: 'existing_genre_evidence' }
    : detectedGenre;
  const runtime = genreRuntime(effectiveGenre);
  const baseline = loadGenreBaseline(effectiveGenre);
  const generationReasoningEffort = params.reasoningEffort || (/^gpt-6-luna$/i.test(String(params.modelId || '')) ? 'medium' : undefined);
  const comparableRange = baseline?.comparableBenchmark?.metrics_target?.chapterChars;
  const genreTarget = Number(baseline?.structureBaseline?.chapterCharsMean)
    || (Array.isArray(comparableRange) && comparableRange.length === 2 ? (Number(comparableRange[0]) + Number(comparableRange[1])) / 2 : 0);
  const contractBudget = contract.wordBudget && typeof contract.wordBudget === 'object' ? contract.wordBudget : {};
  const profileKey = genreProfileKey(effectiveGenre || (genreResolution.status === 'resolved' ? genreResolution.genre : ''));
  const profileTarget = Math.max(1200, Math.min(8000, Number(contractBudget.targetChars) || Number(params.targetChars) || Number(params.targetWords) || genreTarget || 2800));
  const genreProfileCandidate = buildGenreProfile({
    genre: profileKey, subgenre: params.subgenre || genreResolution.subgenre,
    targetChars: profileTarget, pov: contract.pov, tone: params.tone || params.style
  });
  const genreProfile = genreProfileCandidate.status === 'resolved' ? genreProfileCandidate : null;
  const genreBudgetProfile = contractBudget.minChars || contractBudget.maxChars || contractBudget.targetChars
    ? contractBudget
    : genreProfile && genreProfile.budgetProfile;
  const targetWords = Math.max(1200, Math.min(8000, Math.round(Number(params.targetWords) || genreTarget || genreProfile?.budgetProfile.targetChars || 2500)));
  let scenePlan = null;
  if (!Array.isArray(contract.scenes) || !contract.scenes.length) {
    const outlineNodes = Array.isArray(params.outlineNodes) ? params.outlineNodes
      : Array.isArray(params.chapterOutline) ? params.chapterOutline : [];
    if (outlineNodes.length) {
      scenePlan = scenePlanner.planScenes(outlineNodes, { targetWordCount: targetWords, genreProfile });
      contract = { ...contract, scenes: scenePlan.scenes };
    }
  }
  const sceneDirectiveBlock = scenePlan ? scenePlanner.compileSceneDirectives(scenePlan) : '';
  const styleBundle = buildPipelineStyleBundle(params, contract, genreProfile);
  const isLargeContextModel = /gpt-6|deepseek|claude|gemini|v4|v3/i.test(String(params.modelId || ''));
  const maxSystemBudget = isLargeContextModel ? 64000 : 32000;
  const maxContextBudget = isLargeContextModel ? 48000 : 32000;
  const maxPromptBudget = isLargeContextModel ? 24000 : 16000;
  let compiledContext;
  try {
    compiledContext = assembleContext({
      sceneContract: Object.keys(contract).length ? contract : null,
      hardState: selectHardState(params, contract),
      povKnowledge: contract.allowedKnowledge || contract.forbiddenKnowledge ? {
        allowed: contract.allowedKnowledge || [], forbidden: contract.forbiddenKnowledge || []
      } : null,
      immediateTimeline: params.immediateTimeline || params.timeline || params.previousEnding || null,
      activeCausalDebt: params.activeCausalDebts || params.causalDebts || (params.continuity && params.continuity.causalDebts) || null,
      characters: params.characters || contract.characters || null,
      location: params.currentLocation || params.location || (params.continuity && params.continuity.location) || null,
      worldRules: params.worldRules || (params.continuity && params.continuity.worldRules) || null,
      relationships: params.relationships || (params.continuity && params.continuity.relationships) || null,
      volumeState: params.volumeState || null,
      recentChapters: params.recentChapters || params.recentText || null,
      foreshadows: params.foreshadows || null,
      distantPlot: params.planText || null,
      historicalFacts: params.memoryContext || null
    }, { maxChars: maxContextBudget, outputReserve: Math.ceil(targetWords * 1.5) });
  } catch (error) {
    if (error && error.code === 'CONTEXT_OVERFLOW') {
      throw Object.assign(new Error('必要的章节合同或硬状态超过上下文预算，未静默裁剪'), { code: 'context_budget_exceeded', cause: error });
    }
    throw error;
  }
  const context = compiledContext.text;
  const contextPlan = compiledContext.contextPlan;
  const auditParams = {
    ...params,
    contract,
    chapterContract: contract,
    genreResolution,
    genreProfile,
    genreBudgetProfile,
    scenePlan,
    expectPayoff: params.expectPayoff === true || (Array.isArray(contract.requiredPayoff) && contract.requiredPayoff.length > 0),
    factLedger: selectHardState(params, contract) || {},
    knownEntities: collectKnownEntities(params),
    compiledContextText: context,
    contextPlan
  };
  const runtimeBlock = runtime.writingBlock || '';
  const baselineBlock = buildBaselineTargetBlock(baseline);
  const extraBlocks = [];
  if (runtimeBlock && (!params.writingSystem || !params.writingSystem.includes(runtimeBlock.slice(0, 30)))) {
    extraBlocks.push(runtimeBlock);
  }
  if (baselineBlock && (!params.writingSystem || !params.writingSystem.includes(baselineBlock.slice(0, 30)))) {
    extraBlocks.push(baselineBlock);
  }
  if (genreProfile) extraBlocks.push('【GENRE PROFILE】\n' + JSON.stringify(genreProfile));
  if (styleBundle && styleBundle.prompt && (!params.writingSystem || !params.writingSystem.includes(styleBundle.prompt.slice(0, 40)))) {
    extraBlocks.push(styleBundle.prompt);
  }
  if (sceneDirectiveBlock) extraBlocks.push(sceneDirectiveBlock);
  let system = sanitizeSystemForUpstream(params.control === true ? String(params.controlSystem || '') : [params.writingSystem || '只写原创中文小说正文，不输出提纲或说明。先落实当下人物目标、行动阻力、认知边界和局面变化。', ...extraBlocks].filter(Boolean).join('\n\n'));
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
    characters: Array.isArray(params.characters) ? params.characters : Array.isArray(contract.characters) ? contract.characters : Array.isArray(params.continuity?.characters) ? params.continuity.characters : []
  };
  const isReasoning = Boolean(generationReasoningEffort && generationReasoningEffort !== 'none');
  const maxTokensClamped = (isReasoning || /^gpt-6-luna$/i.test(String(params.modelId || '')))
    ? Math.min(12000, Math.max(8000, Math.ceil(targetWords * 3.5)))
    : Math.min(4800, Math.ceil(targetWords * 1.5));
  const minTargetWords = Math.ceil(targetWords * 0.85);
  const maxTargetWords = Math.floor(targetWords * 1.15);
  const chapterPrompt = '【只读上下文】\n' + context + '\n【本章任务】\n' + params.prompt + '\n目标篇幅：' + targetWords + ' 字；字数校验区间：' + minTargetWords + '～' + maxTargetWords + ' 字。按本章合同和叙事任务收束，不为凑字数扩写，也不因固定通用字数删去必要内容。';
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
    return { text: '', status: 'needs_review', audit: { passed: false, status: 'incomplete', incompleteReasons: ['draft_call_failed_or_unknown'] }, calls, usage: aggregateUsage(calls), contextPlan, humanReviewStatus: 'pending' };
  }
  const rawText = String(draft && draft.text || '').trim();
  const text = sanitizeAiFlavor(rawText);
  const initialDeterministicAudit = deterministicAuditFor(text, { ...params, targetWords, genreBudgetProfile });
  if (!text || !hasUsage(draft && draft.usage)) {
    const audit = { ...initialDeterministicAudit, passed: false, status: 'incomplete', incompleteReasons: [!text ? 'draft_missing' : 'usage_missing'] };
    return { text, status: 'needs_review', audit, deterministicAudit: initialDeterministicAudit, calls, usage: aggregateUsage(calls), contextPlan, humanReviewStatus: 'pending' };
  }
  if (!initialDeterministicAudit.passed) {
    return { text, status: 'needs_review', audit: { ...initialDeterministicAudit, phase: 'deterministic_audit' }, deterministicAudit: initialDeterministicAudit, calls, usage: aggregateUsage(calls), contextPlan, humanReviewStatus: 'pending' };
  }
  let selectedText = text;
  let selectedAudit = await evidenceAudit(tracked, auth, { ...auditParams, text, targetWords });
  let selectedDeterministicAudit = initialDeterministicAudit;
  const candidates = [{ contentHash: review.textHash(text), audit: selectedAudit, deterministicAudit: selectedDeterministicAudit }];
  if (params.control !== true && selectedAudit.status !== 'incomplete' && !selectedAudit.passed) {
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
      return { text: selectedText, status: 'needs_review', audit: { ...selectedAudit, passed: false, status: 'incomplete', incompleteReasons: ['alternative_call_failed_or_unknown'] }, candidates, calls, usage: aggregateUsage(calls), contextPlan, humanReviewStatus: 'pending' };
    }
    if (hasUsage(alternative && alternative.usage) && String(alternative.text || '').trim()) {
      const alternativeText = sanitizeAiFlavor(alternative.text.trim());
      const alternativeDeterministicAudit = deterministicAuditFor(alternativeText, { ...params, targetWords, genreBudgetProfile });
      if (alternativeDeterministicAudit.passed) {
        const alternativeAudit = await evidenceAudit(tracked, auth, { ...auditParams, text: alternativeText, targetWords });
        candidates.push({ contentHash: review.textHash(alternativeText), audit: alternativeAudit, deterministicAudit: alternativeDeterministicAudit });
        if (auditPenalty(alternativeAudit) < auditPenalty(selectedAudit)) {
          selectedText = alternativeText;
          selectedAudit = alternativeAudit;
          selectedDeterministicAudit = alternativeDeterministicAudit;
        }
      }
    }
  }
  const result = await auditReviseLoop({ ...deps, initialAudit: selectedAudit }, auth, { ...auditParams, text: selectedText, targetWords, maxRounds: params.control === true ? 0 : params.maxRounds });
  const allCalls = [...calls, ...result.calls];
  const totalUsage = aggregateUsage(allCalls);
  const manifest = buildGenerationManifest({
    generationId: params.generationId || params.runId,
    projectId: params.projectId || params.novelId,
    branchId: params.branchId,
    chapterId: params.chapterId || contract.chapterId,
    codeVersion: params.codeVersion,
    pipelineVersion: 'benchmark-local-v2',
    genreEngineVersion: params.genreProfileVersion || 'genre-resolver-1',
    styleVersion: params.styleVersion || styleBundle?.bundleId || contract.styleBundleId,
    benchmarkVersion: params.benchmarkVersion,
    modelId: params.modelId,
    providerModel: totalUsage.calls.find(call => call.providerModel)?.providerModel,
    promptVersion: params.promptVersion,
    storyBibleVersion: params.storyBibleVersion,
    stateVersion: params.stateVersion || params.baseRevision,
    contextHash: contextPlan.contextHash,
    contractHash: hashValue(contract),
    promptHash: review.textHash(system + '\n' + chapterPrompt),
    outputHash: review.textHash(result.text)
  });
  return { ...result, deterministicAudit: result.deterministicAudit || selectedDeterministicAudit, contextPlan, manifest, genreResolution, genreProfile, styleBundle, scenePlan, status: result.audit.passed && totalUsage.complete ? 'passed' : 'needs_review', calls: allCalls, candidates, selectedHash: selectedAudit.contentHash, usage: totalUsage, protocol: 'benchmark-local-v2', effectiveGenre, genreAssetStatus: runtime.status };
}

module.exports = { DEFAULT_BASELINE_DIR, MAX_REVISION_ROUNDS, loadGenreBaseline, buildBaselineTargetBlock, collectKnownEntities, evidenceAudit, localRevise, auditReviseLoop, generateChapter, verifiedLedgerDelta, verifiedStateDelta, verifiedOutlineImpact, outlineTargets, hasUsage, aggregateUsage, auditPenalty, deterministicAuditFor, preGenerationBlockers, genreRuntime, resolveGenreFamily: scope.resolveGenreFamily, benchmarkDatabase };
