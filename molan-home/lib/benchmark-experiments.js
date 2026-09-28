'use strict';

const { createHash, randomBytes } = require('node:crypto');

const REVIEW_DIMENSIONS = ['originality', 'narrative', 'characters', 'continuity'];
const STATE_DIMENSIONS = ['relations', 'knowledge', 'foreshadowing'];
const GENRES = ['玄幻', '都市高武', '悬疑诡秘', '青春甜宠', '历史脑洞', '科幻末世'];
const HASH_PATTERN = /^[a-f0-9]{64}$/;

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined || (typeof value === 'number' && !Number.isFinite(value))) {
      throw new Error('仅允许有限、可序列化 JSON 数据');
    }
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function hashValue(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value), 'utf8').digest('hex');
}

function textContentHash(text) {
  return hashValue(String(text).normalize('NFKC').replace(/^\s*(?:#{1,6}\s*)?(?:第[一二三四五六七八九十百零\d]+章|chapter\s*\d+|ch\d+)[^\n]*\n/iu, '').replace(/\s+/gu, ''));
}

function clone(value) {
  return JSON.parse(canonicalJson(value));
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function validateSuite(suite, regression) {
  requireValue(suite?.schemaVersion === 1 && suite.genres?.length === 6, '固定套件须含六题材');
  requireValue(canonicalJson(suite.genres.map(item => item.genre).sort()) === canonicalJson([...GENRES].sort()), '题材集合不符');
  const routeIds = new Set();
  for (const genre of suite.genres) {
    requireValue(genre.routes?.length === 2, `${genre.genre}须有两条原创路线`);
    for (const route of genre.routes) {
      requireValue(!routeIds.has(route.id) && route.chapters?.length >= 3 && route.premise && route.cast?.length && route.stateChecks?.length === 3, '路线重复或缺少固定前三章/状态计划');
      routeIds.add(route.id);
    }
  }
  requireValue(suite.p4?.length === 2 && new Set(suite.p4.map(item => item.genre)).size === 2, 'P4须两题材');
  for (const selected of suite.p4) {
    const route = suite.genres.find(item => item.genre === selected.genre)?.routes.find(item => item.id === selected.routeId);
    requireValue(selected.chapters === 10 && route?.chapters.length === 10, 'P4须固定十章');
  }
  requireValue(Array.isArray(regression) && regression.length === 18 && new Set(regression.map(item => item.id)).size === 18, 'P3须18条唯一原创题');
  for (const genre of suite.genres) {
    const items = regression.filter(item => item.genre === genre.genre);
    requireValue(items.length === 3, `${genre.genre}须三条P3题`);
    for (const item of items) {
      requireValue(genre.routes.some(route => route.id === item.routeId) && item.prompt?.trim() && item.acceptanceCriteria?.semanticChecks?.length, 'P3缺提示/语义标准或路线不匹配');
      requireValue(!/孟奇|真慧|程千帆|塞西尔|高文|李木田|通崖|项平|玄宣|少林|克莱恩|韩立|曹操|荀彧|任峻|名家最高|爱潜水的乌贼/.test(JSON.stringify(item)), 'P3含已知原作专名或模仿指令');
    }
  }
  return true;
}

function buildExperimentPlan(suite, regression, phase = 'P0') {
  validateSuite(suite, regression);
  requireValue(['P0', 'P3', 'P4'].includes(phase), 'phase须为P0/P3/P4');
  const tasks = [];
  for (const genre of suite.genres) {
    for (const route of genre.routes) {
      const chapterCount = phase === 'P0' ? 3 : phase === 'P4'
        ? suite.p4.find(item => item.genre === genre.genre && item.routeId === route.id)?.chapters || 0 : 0;
      const entries = phase === 'P3' ? regression.filter(item => item.genre === genre.genre && item.routeId === route.id)
        : route.chapters.slice(0, chapterCount).map((event, index) => ({
          id: `${phase}-${route.id}-${index + 1}`,
          chapterIndex: index + 1,
          title: `${route.title}·第${index + 1}章`,
          prompt: `原创小说《${route.title}》第${index + 1}章：${event}\n写${suite.targetWords.join('~')}汉字，直接输出正文。遵守已知信息、关系与伏笔状态，不照搬现成作品。`,
          targetWords: suite.targetWords,
          acceptanceCriteria: { minChars: 2000, maxChars: 3000, semanticChecks: route.stateChecks }
        }));
      for (const item of entries) {
        tasks.push({
          id: item.id, phase, genre: genre.genre, familyId: genre.familyId, routeId: route.id,
          seriesId: phase === 'P3' ? item.id : `${phase}-${route.id}`,
          chapterIndex: item.chapterIndex || 1, title: item.title, prompt: item.prompt,
          targetWords: item.targetWords, acceptanceCriteria: item.acceptanceCriteria,
          premise: route.premise, cast: route.cast,
          stateChecks: phase === 'P3' ? item.acceptanceCriteria.semanticChecks : route.stateChecks,
          chapterPlan: phase === 'P3' ? [item.prompt] : route.chapters.slice(0, chapterCount)
        });
      }
    }
  }
  const arms = phase === 'P3' ? ['control', 'candidate'] : phase === 'P0' ? ['control'] : ['candidate'];
  return clone({
    schemaVersion: 1, suiteId: suite.id, suiteHash: hashValue({ suite, regression }),
    phase, arms, contextPolicy: 'arm-local-continuation',
    contextCaveat: phase === 'P3' ? '独立单章的双臂使用完全相同的计划、合同、空ledger和模型控制参数；处理差异是固定控制prompt与生产管线。'
      : phase === 'P0' ? '仅固定控制prompt起草基线，无候选输出，不是A/B或完整历史主链路实测。'
        : '仅生产candidate，各系列按章序独立累积已确认ledger，不是A/B。',
    tasks, expectedTasks: tasks.length, expectedPairs: phase === 'P3' ? tasks.length : 0, expectedGenerations: tasks.length * arms.length,
    plannedStatus: 'not_executed'
  });
}

function validateConfig(config) {
  requireValue(config?.model?.trim() && config.pipelineVersion?.trim(), '必须显式记录model及pipelineVersion');
  const parameters = config.parameters;
  requireValue(parameters && Number.isFinite(parameters.temperature) && parameters.temperature >= 0 && parameters.temperature <= 1.5 &&
    Number.isInteger(parameters.maxRounds) && parameters.maxRounds >= 0 && parameters.maxRounds <= 2 &&
    parameters.topP === null && parameters.maxTokens === null && parameters.seed === null,
  'v2须显式temperature/maxRounds；服务未开放topP/maxTokens/seed，必须填null，不冒充已控制');
  requireValue(config.control?.kind === 'fixed_control_prompt' && config.control.historicalPipelineReplay === false &&
    config.control.prompt?.trim() && config.control.sourceCommit && config.control.sourcePath &&
    config.control.promptHash === hashValue(config.control.prompt), '固定控制prompt缺来源或哈希不符');
  return true;
}

function accumulateLedger(records) {
  const ledger = { schemaVersion: 1, rules: [], promises: [], byEntity: {}, lastFactChapter: 0 };
  for (const record of records) {
    requireValue(record.status === 'completed' && record.audit?.passed === true &&
      record.audit.contentHash === record.textHash, '仅可累积审计确认且哈希相符的章节');
    const delta = record.audit.factLedgerDelta;
    requireValue(delta && Array.isArray(delta.newRules) && Array.isArray(delta.newPromises) &&
      delta.byEntity && typeof delta.byEntity === 'object' && Array.isArray(delta.updates), '缺少明确ledger增量');
    const pushFacts = (target, source, kind) => {
      requireValue(Array.isArray(source), 'ledger事实须为数组');
      for (const fact of source) {
        requireValue(fact?.text?.trim() && fact.quote?.trim() && record.text.includes(fact.quote), 'ledger事实缺逐字正文证据');
        target.push({
          ...clone(fact), id: fact.id || `fact_${hashValue({ key: record.key, kind, fact }).slice(0, 24)}`,
          chapterNo: record.chapterIndex, status: fact.status || (kind === 'promise' ? 'open' : 'active'),
          sourceTextHash: record.textHash
        });
      }
    };
    pushFacts(ledger.rules, delta.newRules, 'rule');
    pushFacts(ledger.promises, delta.newPromises, 'promise');
    for (const [name, facts] of Object.entries(delta.byEntity)) {
      requireValue(!['__proto__', 'constructor', 'prototype'].includes(name), '非法实体键');
      if (!Object.hasOwn(ledger.byEntity, name)) ledger.byEntity[name] = [];
      pushFacts(ledger.byEntity[name], facts, name);
    }
    for (const update of delta.updates) {
      requireValue(update?.id && ['paid', 'superseded'].includes(update.status) &&
        update.quote?.trim() && record.text.includes(update.quote), 'ledger更新缺证据或状态不合法');
      const matches = [...ledger.rules, ...ledger.promises, ...Object.values(ledger.byEntity).flat()].filter(fact => fact.id === update.id);
      requireValue(matches.length === 1, 'ledger更新目标不存在或不唯一');
      matches[0].status = update.status;
      matches[0].updateEvidence = { quote: update.quote, chapterNo: record.chapterIndex, textHash: record.textHash };
    }
    ledger.lastFactChapter = record.chapterIndex;
  }
  return ledger;
}

function buildGenerationParams(plan, config, task, arm, records, experimentId) {
  const contextArm = plan.contextPolicy === 'paired-control-history' ? 'control' : arm;
  const previousChapters = records.filter(record => record.arm === contextArm && record.seriesId === task.seriesId &&
    record.chapterIndex < task.chapterIndex && record.status === 'completed')
    .sort((left, right) => left.chapterIndex - right.chapterIndex);
  requireValue(previousChapters.length === task.chapterIndex - 1, '缺少前章，禁止跳章续写');
  const factLedger = accumulateLedger(previousChapters);
  const contract = {
    premise: task.premise, characters: task.cast, chapterIndex: task.chapterIndex,
    objective: task.prompt, acceptanceCriteria: task.acceptanceCriteria
  };
  const continuity = {
    policy: plan.contextPolicy, stateChecks: task.stateChecks,
    confirmedChapters: previousChapters.map(record => ({ chapterIndex: record.chapterIndex, textHash: record.textHash, summary: record.audit.summary || '', stageChange: record.audit.stageChange || '' })),
    previousEndingPolicy: 'last-1200-codepoints-explicit-excerpt'
  };
  const previousEnding = Array.from(previousChapters.at(-1)?.text || '').slice(-1200).join('');
  const params = {
    requestId: `bench_${hashValue({ experimentId, taskId: task.id, arm })}`,
    modelId: config.model, temperature: config.parameters.temperature, maxRounds: config.parameters.maxRounds,
    genre: task.genre, familyId: task.familyId, routeId: task.routeId,
    chapterIndex: task.chapterIndex, targetWords: Math.round((task.targetWords[0] + task.targetWords[1]) / 2),
    prompt: task.prompt, contract, factLedger, previousEnding, continuity,
    planText: task.chapterPlan.join('\n'), characters: task.cast,
    localStorage: true, persist: false,
    control: arm === 'control', controlSystem: arm === 'control' ? config.control.prompt : ''
  };
  return clone(params);
}

function usageComplete(usage) {
  if (!usage || typeof usage !== 'object') return false;
  const input = usage.inputTokens ?? usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokens;
  const output = usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens ?? usage.completionTokens;
  return Number.isFinite(input) && input >= 0 && Number.isFinite(output) && output >= 0;
}

function generationEvidence(response, params) {
  const missing = [];
  if (!usageComplete(response.usage) && !(response.usage?.complete === true && Array.isArray(response.calls) && response.calls.length &&
    response.calls.every(call => usageComplete(call?.usage)))) missing.push('aggregate_usage_input_output');
  if (response.usage?.complete !== true) missing.push('usage_complete');
  if (!response.audit || typeof response.audit !== 'object') missing.push('audit');
  if (!Array.isArray(response.calls) || !response.calls.length) missing.push('calls');
  for (const [index, call] of (Array.isArray(response.calls) ? response.calls : []).entries()) {
    if (!call || !(call.model || call.modelId) || !call.parameters || !usageComplete(call.usage) ||
        !HASH_PATTERN.test(call.requestHash || '') || !HASH_PATTERN.test(call.textHash || call.outputHash || '')) {
      missing.push(`calls[${index}].model_parameters_usage_hashes`);
    } else {
      for (const key of ['temperature', 'maxTokens', 'topP', 'seed']) {
        if (!Object.hasOwn(call.parameters, key)) missing.push(`calls[${index}].parameters.${key}`);
      }
    }
  }
  if (response.protocol !== 'benchmark-local-v2') missing.push('protocol');
  if (response.audit?.contentHash !== hashValue(response.text ?? '')) missing.push('audit_content_hash');
  for (const dimension of ['state', 'knowledge', 'payoff', 'relation', 'reasoning', 'redundancy', 'continuity']) {
    if (response.audit?.coverage?.[dimension] !== 'checked') missing.push(`audit.coverage.${dimension}`);
  }
  if (!response.audit?.factLedgerDelta) missing.push('fact_ledger_delta');
  return missing;
}

function verifyCheckpoint(state, plan, config) {
  requireValue(state.schemaVersion === 1 && state.planHash === hashValue(plan) && state.configHash === hashValue(config), '续跑的计划/模型参数/控制prompt已改变');
  requireValue(state.planHash === hashValue(state.plan) && state.configHash === hashValue(state.config), '账本配置哈希不符');
  const keys = new Set();
  for (const record of state.records) {
    requireValue(!keys.has(record.key), '账本含重复任务');
    keys.add(record.key);
    const task = plan.tasks.find(item => item.id === record.taskId);
    requireValue(task && plan.arms.includes(record.arm), '账本存在未知任务或臂');
    requireValue(record.key === `${record.taskId}:${record.arm}` && record.seriesId === task.seriesId &&
      record.chapterIndex === task.chapterIndex, '账本任务索引不符');
    const expected = buildGenerationParams(plan, config, task, record.arm, state.records, state.experimentId);
    requireValue(record.requestHash === hashValue(record.params) && record.requestHash === hashValue(expected), '请求哈希不符');
    if (Object.hasOwn(record, 'text')) requireValue(record.textHash === hashValue(record.text), '正文哈希不符');
    if (record.response) requireValue(record.responseHash === hashValue(record.response) &&
      canonicalJson(record.audit) === canonicalJson(record.response.audit ?? null) &&
      canonicalJson(record.usage) === canonicalJson(record.response.usage ?? null) &&
      canonicalJson(record.calls) === canonicalJson(record.response.calls ?? null) &&
      record.text === (typeof record.response.text === 'string' ? record.response.text : ''), '响应/审计/用量凭证不符');
    requireValue(['in_flight', 'uncertain', 'failed', 'audit_failed', 'completed'].includes(record.status), '未知执行状态');
  }
  return true;
}

async function runExperiment(options, dependencies = {}) {
  const { plan, config, dryRun = true, checkpoint = null } = options;
  validateConfig(config);
  requireValue(plan.tasks?.length === plan.expectedTasks && Array.isArray(plan.arms) &&
    canonicalJson(plan.arms) === canonicalJson(plan.phase === 'P3' ? ['control', 'candidate'] : plan.phase === 'P0' ? ['control'] : ['candidate']) &&
    plan.expectedPairs === (plan.phase === 'P3' ? plan.tasks.length : 0) &&
    plan.expectedGenerations === plan.tasks.length * plan.arms.length &&
    new Set(plan.tasks.map(task => task.id)).size === plan.tasks.length, '执行计划计数不符');
  const now = dependencies.now || (() => new Date().toISOString());
  const state = checkpoint ? clone(checkpoint) : {
    schemaVersion: 1, experimentId: options.experimentId || randomBytes(16).toString('hex'),
    planHash: hashValue(plan), configHash: hashValue(config), plan, config,
    createdAt: now(), status: 'not_executed', executed: false, records: []
  };
  verifyCheckpoint(state, plan, config);
  if (dryRun) return clone({ ...state, status: 'not_executed', dryRun: true, executed: false, resumePreview: Boolean(checkpoint) });
  requireValue(typeof dependencies.generateChapter === 'function' && typeof dependencies.saveCheckpoint === 'function', '实跑必须注入generateChapter及持久化saveCheckpoint');
  const save = async () => {
    state.updatedAt = now();
    await dependencies.saveCheckpoint(clone(state));
  };
  for (const record of state.records) {
    if (record.status === 'in_flight') {
      record.status = 'uncertain';
      record.reason = '上次调用中断，可能已产生用量；须人工核对，不自动重试';
      state.status = 'blocked_uncertain';
      await save();
    }
  }
  if (state.records.some(record => record.status !== 'completed')) {
    state.status = state.records.some(record => record.status === 'uncertain') ? 'blocked_uncertain'
      : state.records.some(record => record.status === 'audit_failed') ? 'audit_failed' : 'failed';
    return clone(state);
  }
  const limit = options.maxCalls ?? Infinity;
  requireValue(limit === Infinity || (Number.isInteger(limit) && limit >= 0), 'maxCalls须非负整数');
  let madeCalls = 0;
  for (const [taskIndex, task] of plan.tasks.entries()) {
    const order = taskIndex % 2 ? [...plan.arms].reverse() : plan.arms;
    for (const arm of order) {
      const key = `${task.id}:${arm}`;
      if (state.records.some(record => record.key === key)) continue;
      if (madeCalls >= limit) {
        state.status = 'paused';
        await save();
        return clone(state);
      }
      const params = buildGenerationParams(plan, config, task, arm, state.records, state.experimentId);
      const record = {
        key, taskId: task.id, seriesId: task.seriesId, chapterIndex: task.chapterIndex, arm,
        params, requestHash: hashValue(params), status: 'in_flight', startedAt: now()
      };
      state.records.push(record);
      state.status = 'running';
      state.executed = true;
      await save();
      let response;
      try {
        response = clone(await dependencies.generateChapter(clone(params)));
      } catch {
        record.status = 'uncertain';
        record.reason = '调用抛错或响应不可解析；可能已扣用量，不自动重试，请核对本机服务日志';
        record.finishedAt = now();
        state.status = 'blocked_uncertain';
        await save();
        return clone(state);
      }
      madeCalls += 1;
      record.response = response;
      record.responseHash = hashValue(response);
      record.text = typeof response?.text === 'string' ? response.text : '';
      record.textHash = hashValue(record.text);
      record.contentHash = textContentHash(record.text);
      record.usage = response?.usage ?? null;
      record.calls = response?.calls ?? null;
      record.audit = response?.audit ?? null;
      record.missingEvidence = generationEvidence(response || {}, params);
      record.evidenceStatus = record.missingEvidence.length ? 'missing_evidence' : 'complete';
      record.reviewStatus = 'pending_review';
      record.finishedAt = now();
      if ((Array.isArray(record.calls) && record.calls.some(call => ['started', 'in_flight', 'failed_or_unknown', 'unknown'].includes(call?.status))) ||
        response?.audit?.incompleteReasons?.some(reason => /failed_or_unknown/.test(reason))) {
        record.status = 'uncertain';
        record.reason = '管线内含不确定调用，保留正文与用量但不续跑';
        state.status = 'blocked_uncertain';
        await save();
        return clone(state);
      }
      if (response?.status === 'needs_review') {
        record.status = 'audit_failed';
        record.reviewStatus = 'pending_review';
        record.reason = record.text.trim() ? '生成有正文但模型审计未通过；结果保留，不提交ledger，不续写'
          : '起草未返回正文或有效用量；真实失败响应保留，不提交ledger，不计通过';
        state.status = 'audit_failed';
        await save();
        return clone(state);
      }
      if (response?.status !== 'passed' || !record.text.trim()) {
        record.status = response?.status === 'failed' ? 'failed' : 'uncertain';
        record.reason = '服务未明确完成且返回非空正文，禁止自动重试';
        state.status = record.status === 'failed' ? 'failed' : 'blocked_uncertain';
        await save();
        return clone(state);
      }
      if (response.audit?.passed !== true || response.audit.contentHash !== record.textHash) {
        record.status = 'audit_failed';
        record.reason = '缺少绑定正文的通过审计，停止续写';
        state.status = 'audit_failed';
        await save();
        return clone(state);
      }
      record.status = 'completed';
      try {
        const ledgerArm = plan.contextPolicy === 'paired-control-history' ? 'control' : arm;
        record.ledgerAfter = accumulateLedger([...state.records.filter(item => item.arm === ledgerArm && item.seriesId === task.seriesId &&
          item.chapterIndex < task.chapterIndex), record]);
        record.ledgerAfterHash = hashValue(record.ledgerAfter);
      } catch {
        record.status = 'audit_failed';
        record.reason = 'ledger增量证据或更新目标无效，停止续写';
        state.status = 'audit_failed';
        await save();
        return clone(state);
      }
      record.reviewStatus = 'pending_review';
      await save();
    }
  }
  state.status = state.records.some(record => record.missingEvidence?.length) ? 'missing_evidence' : 'pending_review';
  state.completedGenerations = state.records.length;
  state.reviewStatus = 'pending_review';
  await save();
  return clone(state);
}

function createLocalGenerator(options = {}) {
  const endpoint = new URL(options.endpoint || 'http://127.0.0.1:3000/api/benchmark/generate');
  requireValue(endpoint.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(endpoint.hostname) &&
    !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash &&
    endpoint.pathname === '/api/benchmark/generate', 'HTTP仅允许数字回环地址的/api/benchmark/generate，不允许重定向或云端');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  return async function generateChapter(params) {
    requireValue(params.localStorage === true && params.persist === false, '必须localStorage:true且persist:false');
    const capabilityResponse = await fetchImpl(`${endpoint.origin}/api/benchmark/capabilities`, {
      redirect: 'error', signal: AbortSignal.timeout(10000)
    });
    requireValue(capabilityResponse.ok, '本机capabilities不可用');
    const capabilities = await capabilityResponse.json();
    requireValue(capabilities.protocol === 'benchmark-local-v2' && capabilities.localStorage === true &&
      capabilities.cloudProxy === false, '服务未保证仅本地存储，拒绝请求');
    const response = await fetchImpl(endpoint.href, {
      method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: canonicalJson(params),
      signal: AbortSignal.timeout(options.timeoutMs || 900000)
    });
    if (!response.ok) throw new Error(`本机生成返回HTTP ${response.status}；不重试`);
    return response.json();
  };
}

function makeBlindReview(state, options = {}) {
  verifyCheckpoint(state, state.plan, state.config);
  requireValue(state.plan.phase === 'P3' && state.plan.arms.length === 2, '匿名A/B仅开放P3；P0/P4单臂保持pending_review，不伪造配对');
  requireValue(!state.dryRun && state.executed && state.records.length === state.plan.expectedGenerations &&
    state.records.every(record => record.status === 'completed'), '未执行或未完成配对，不可导出盲评');
  const salt = options.salt || randomBytes(32).toString('hex');
  const packet = { schemaVersion: 1, kind: 'molan-blind-review', packetId: hashValue(`${salt}:packet`), dimensions: REVIEW_DIMENSIONS, items: [] };
  const mapping = { schemaVersion: 1, kind: 'private-blind-key', experimentId: state.experimentId, items: [] };
  for (const task of state.plan.tasks) {
    const itemId = hashValue(`${salt}:${task.id}`).slice(0, 24);
    const seriesId = hashValue(`${salt}:series:${task.seriesId}`).slice(0, 24);
    const swapped = parseInt(hashValue(`${salt}:order:${task.seriesId}`).slice(0, 2), 16) % 2 === 1;
    const arms = swapped ? ['candidate', 'control'] : ['control', 'candidate'];
    const candidates = {};
    const privateCandidates = {};
    for (const [index, arm] of arms.entries()) {
      const label = index === 0 ? 'A' : 'B';
      const record = state.records.find(item => item.taskId === task.id && item.arm === arm);
      const forbidden = [state.config.model, ...(record.calls || []).map(call => call?.model || call?.modelId)].filter(Boolean);
      requireValue(!forbidden.some(identity => record.text.toLowerCase().includes(identity.toLowerCase())) &&
        !/\b(?:openai|chatgpt|deepseek|claude|gemini|qwen|gpt-\d|as an ai)\b|作为.{0,8}(?:语言模型|人工智能)/iu.test(record.text),
      '正文含模型身份线索，禁止直接导出盲评；须另建可追溯脱敏稿，不改原文');
      candidates[label] = { text: record.text, textHash: record.textHash };
      privateCandidates[label] = { key: record.key, arm, requestHash: record.requestHash, textHash: record.textHash };
    }
    packet.items.push({ itemId, seriesId, genre: task.genre, chapterIndex: task.chapterIndex, prompt: task.prompt, candidates });
    mapping.items.push({ itemId, taskId: task.id, candidates: privateCandidates });
  }
  packet.items.sort((left, right) => left.seriesId.localeCompare(right.seriesId) || left.chapterIndex - right.chapterIndex);
  packet.packetHash = hashValue(packet);
  mapping.packetId = packet.packetId;
  mapping.packetHash = packet.packetHash;
  return { packet, mapping };
}

function validateHumanReview(packet, review) {
  const errors = [];
  const { packetHash, ...body } = packet;
  if (packetHash !== hashValue(body)) errors.push('盲评包哈希不符');
  if (review?.kind !== 'molan-human-review' || review.packetHash !== packetHash || review.packetId !== packet.packetId ||
    !review.reviewer?.trim() || !review.reviewedAt || !Number.isFinite(Date.parse(review.reviewedAt))) errors.push('缺少真人身份、时间或包绑定');
  if (review?.items?.length !== packet.items.length || new Set(review?.items?.map(item => item.itemId)).size !== packet.items.length) errors.push('人工结果数量不符或重复');
  for (const item of packet.items) {
    const result = review?.items?.find(entry => entry.itemId === item.itemId);
    if (!result || !['A', 'B', 'tie', 'neither'].includes(result.preference) || !result.reason?.trim()) {
      errors.push(`${item.itemId}:缺选择或理由`);
      continue;
    }
    for (const label of ['A', 'B']) {
      const response = result.candidates?.[label];
      if (response?.textHash !== item.candidates[label].textHash) errors.push(`${item.itemId}:${label}:正文绑定不符`);
      for (const dimension of REVIEW_DIMENSIONS) {
        if (!Number.isInteger(response?.scores?.[dimension]) || response.scores[dimension] < 1 || response.scores[dimension] > 5) errors.push(`${item.itemId}:${label}:${dimension}:未评分`);
      }
      for (const dimension of STATE_DIMENSIONS) {
        const check = response?.stateChecks?.[dimension];
        if (!check || !['pass', 'fail'].includes(check.status) || !check.evidence?.trim() ||
          !item.candidates[label].text.includes(check.evidence)) errors.push(`${item.itemId}:${label}:${dimension}:缺逐字状态证据`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

function bindHumanReview(state, packet, mapping, review) {
  const validation = validateHumanReview(packet, review);
  requireValue(validation.valid, validation.errors.join('; '));
  requireValue(mapping.experimentId === state.experimentId && mapping.packetHash === packet.packetHash &&
    mapping.items.length === packet.items.length && new Set(mapping.items.map(item => item.itemId)).size === packet.items.length, '私钥映射不属于本次运行');
  const entries = [];
  for (const item of review.items) {
    const mapped = mapping.items.find(entry => entry.itemId === item.itemId);
    for (const label of ['A', 'B']) {
      const bound = mapped?.candidates[label];
      const record = state.records.find(entry => entry.key === bound?.key);
      requireValue(record && record.textHash === item.candidates[label].textHash && record.requestHash === bound.requestHash &&
        record.taskId === mapped.taskId && record.arm === bound.arm, '映射与原始账本不符');
      entries.push({
        key: record.key, seriesId: record.seriesId, arm: record.arm, chapterIndex: record.chapterIndex,
        textHash: record.textHash, reviewer: review.reviewer, reviewedAt: review.reviewedAt,
        scores: item.candidates[label].scores, stateChecks: item.candidates[label].stateChecks,
        preference: item.preference, reason: item.reason, status: 'reviewed'
      });
    }
  }
  requireValue(new Set(entries.map(entry => entry.key)).size === state.records.length, '映射重复或未覆盖正文');
  return { schemaVersion: 1, status: 'reviewed', packetHash: packet.packetHash, entries };
}

function validateChapterReviews(chapters, semanticAudit, humanReview) {
  const missingEvidence = [];
  const failures = [];
  for (const chapter of chapters) {
    for (const [kind, source] of [['semantic', semanticAudit], ['human', humanReview]]) {
      const matched = (source?.entries || []).filter(entry => entry.chapterIndex === chapter.chapterIndex && entry.textHash === chapter.textHash);
      const entry = matched.length === 1 ? matched[0] : null;
      if (!entry || source.status !== 'reviewed' || entry.status !== 'reviewed' ||
        !entry.reviewer?.trim() || !Number.isFinite(Date.parse(entry.reviewedAt))) {
        missingEvidence.push(`${kind}:chapter_${chapter.chapterIndex}:review`);
        continue;
      }
      for (const dimension of STATE_DIMENSIONS) {
        const check = entry.stateChecks?.[dimension];
        if (!check || !['pass', 'fail'].includes(check.status) || !check.evidence?.trim() || !chapter.text.includes(check.evidence)) {
          missingEvidence.push(`${kind}:chapter_${chapter.chapterIndex}:${dimension}`);
        } else if (check.status === 'fail') failures.push(`${kind}:chapter_${chapter.chapterIndex}:${dimension}`);
      }
      if (kind === 'human' && (!entry.reason?.trim() || !['A', 'B', 'tie', 'neither'].includes(entry.preference) ||
        REVIEW_DIMENSIONS.some(dimension => !Number.isInteger(entry.scores?.[dimension]) || entry.scores[dimension] < 1 || entry.scores[dimension] > 5))) {
        missingEvidence.push(`human:chapter_${chapter.chapterIndex}:scores_reason`);
      }
    }
  }
  if (!chapters.length) missingEvidence.push('semantic_and_human_reviews');
  return { status: failures.length ? 'failed' : missingEvidence.length ? 'pending_review' : 'reviewed', missingEvidence, failures };
}

module.exports = {
  REVIEW_DIMENSIONS, STATE_DIMENSIONS, canonicalJson, hashValue, textContentHash,
  validateSuite, buildExperimentPlan, validateConfig, accumulateLedger, buildGenerationParams,
  usageComplete, generationEvidence, verifyCheckpoint, runExperiment, createLocalGenerator,
  makeBlindReview, validateHumanReview, bindHumanReview, validateChapterReviews
};
