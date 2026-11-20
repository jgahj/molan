'use strict';
// 自检闸门（humanize gate）单元测试：未达标自动多轮改写、跨轮诊断传递、择优下发、无重复正文。
// 闸门默认关闭，仅在 MOLAN_HUMANIZE_GATE_ROUNDS / input.humanizeGateMaxRounds 显式开启时启用。

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { createChatService } = require('../services/chat-service');
const { resolveFingerprintProfile } = require('../lib/style-fingerprint');
const correctionPolicy = require('../correction-policy');
const { buildCharacterMaterialBlock, buildLivingProseExemplarBlock } = require('../lib/character-material');
const { createHumanizePolicyService } = require('../services/humanize-policy-service');
const { buildHumanizeLexiconBlock } = require('../lib/ai-flavor-detector');
const UNIVERSAL_CORRECTION_MARKER = '<!-- molan-universal-correction-policy-v1 -->';

const humanizeService = createHumanizePolicyService({
  buildHumanizeLexiconBlock,
  UNIVERSAL_CORRECTION_MARKER,
  UNIVERSAL_CORRECTION_POLICY_PROMPT: correctionPolicy.UNIVERSAL_CORRECTION_POLICY_PROMPT
});

// 三轮文本：初稿(第1遍) -> 改写轮1(未达标) -> 改写轮2(达标)。
const DRAFT_TEXT = '便利店里陷入死一般的寂静，她嘴角勾起一抹弧度，所有人同时转头看过来。';
const ROUND1_TEXT = '雨点顺着玻璃往下滑，她把塑料袋递过去，顺手抹了把桌上的水。';
const ROUND2_TEXT = '便利店门口的雨没停。她拎着塑料袋走过去，往他那边递了一把，说先擦擦。他接过手，纸袋窸窣响了一声，两个人谁都没再提刚才那句。';

function buildService({ gateRounds, scoreByText, texts }) {
  const acpModel = {
    id: 'gpt-6-luna', name: 'GPT-6 Luna', group: 'gpt', provider: 'openai-compat',
    model: 'gpt-6-luna', apiKey: 'test-key', baseURL: 'http://127.0.0.1:1/v1',
    supportsReasoning: false, promptCaching: false
  };
  const calls = [];
  const service = createChatService({
    getDatabase: () => null,
    getEnvironment: () => ({ MOLAN_HUMANIZE_GATE_ROUNDS: gateRounds }),
    getDeepseekKey: () => '', getDeepseekUrl: () => '', getProxyUrl: () => '',
    POSTGRES_MODE: false, postgresRepository: { enabled: false }, postgresActor: () => 'u_1',
    getAuthUser: () => ({ user: { userId: 'u_1', email: 'test@local' } }),
    requireSqliteForPublic: () => false, allowChatRate: () => true,
    acquireChatSlot: () => true, releaseChatSlot: () => {},
    json: (res, code, data) => { res.statusCode = code; res.body = data; },
    readBody: async () => ({
      model: 'gpt-6-luna', stage: 'writing', genre: '都市', targetChars: 400,
      messages: [{ role: 'system', content: '小说正文创作任务' }, { role: 'user', content: '写便利店避雨互动正文' }]
    }),
    respondError: (_res, err) => { throw err; },
    CHAT_MAX_JSON_BODY_BYTES: 1024 * 1024,
    nativeSkillCatalog: async () => null,
    appRepository: () => ({ recordDispatchAttempt: async () => ({ ok: true, authorized: true }) }),
    projectScope: { stableUserId: x => x }, isAdminUser: () => true,
    INTERNAL_MODEL_ROUTE_KEY: 'internal-secret', INTERNAL_MODEL_ROUTE_HEADER: 'x-molan-internal-route',
    generationV2Enabled: () => true, validateChatMessages: m => m, splitDynamicPrompt: m => m,
    detectNovelStyle: () => '', adaptIpContinuationMessages: m => m,
    DEFAULT_WRITING_SKILL_ID: 'writing', loadEditorOnlyWritingSkill: () => null,
    ensureEditorOnlyWritingSkill: m => ({ messages: m, injected: false }),
    editorOnlySkillAuditRequest: () => ({}), ensureDefaultWritingSkill: m => ({ messages: m, injected: false }),
    addDefaultWritingSkillAudit: () => ({}), buildSkillAudit: () => ({ skills: [] }),
    prepareSkillMessagesForUpstream: (_auth, m, skillAudit) => ({ messages: m, skillAudit }),
    correctionPolicyEnabled: () => false, isTwoPassHumanizeEnabled: () => true,
    loadEditorOnlyCorrectionLibrary: () => null, CORRECTION_PRIOR_TEXT_MAX_CHARS: 1000,
    lastUserMessageText: () => '', injectEditorOnlyCorrectionLibrary: m => m,
    EDITOR_ONLY_CORRECTION_VERSION: '1.0', EDITOR_ONLY_CORRECTION_FILE_DEFAULT: '',
    UNIVERSAL_CORRECTION_POLICY_VERSION: '1.0', UNIVERSAL_CORRECTION_STAGES: [],
    injectUniversalCorrectionPolicy: m => m,
    emptyEditorOnlyCharacterMaterialResult: () => ({ messages: [], audit: {} }),
    buildCharacterMaterialBlock, isMatureCharacterMaterialEnabledForNovel: () => false,
    reviewCharacterMaterialSamples: async () => ({ approvedIds: [], audit: { required: false } }),
    calculateCharacterMaterialRhythmDeviation: () => 0,
    scanCharacterMaterialOverlap: () => ({ blocked: false, overlapFragments: [], leakedTerms: [] }),
    injectPromptInjectionGuard: m => m, resolveFingerprintProfile,
    buildRhythmTargetBlock: () => '', appendSystemBlock: humanizeService.appendSystemBlock,
    planContextWindow: (_pm, msgs, reqMax) => ({
      ok: true, messages: msgs, promptTokens: 100, contextWindowTokens: 1000000,
      availableCompletionTokens: reqMax || 8192, dynamicPromptTruncated: false
    }),
    sanitizeSystemForUpstream: s => s, internalModelIdFromRequest: () => '',
    resolveModelForUser: () => 'gpt-6-luna', findPlatformModel: () => acpModel,
    currentDefaultModel: () => 'gpt-6-luna',
    buildHumanizePassMessages: humanizeService.buildHumanizePassMessages,
    mergeUsageSum: humanizeService.mergeUsageSum,
    computeAiFlavorScore: text => scoreByText(text),
    summarizeAiFlavorVerdict: humanizeService.summarizeAiFlavorVerdict,
    addPromptCacheBreakpoint: m => m, normalizeReasoningEffort: (_pm, v) => v || '',
    stablePromptCacheKey: () => 'k', reserveCredits: async () => ({ ok: true }),
    planCreditReservation: () => ({ ok: true, maxTokens: 8192, reservedCost: 0 }),
    normalizeUsage: u => ({ promptTokens: u && u.prompt_tokens || 0, completionTokens: u && u.completion_tokens || 0, totalTokens: u && u.total_tokens || 0 }),
    estimateTextTokenUpperBound: () => 200, creditCostForUser: () => 0, roundCreditValue: v => v,
    emptyCorrectionAudit: () => ({}), scanUniversalCorrectionRisks: correctionPolicy.scanUniversalCorrectionRisks,
    recordCorrectionHits: () => {}, settleTokenUsage: async () => ({ ok: true }),
    openUpstream: (url, proxy, reqOpts, cb) => {
      const req = new EventEmitter();
      let buf = '';
      req.write = c => { buf += c; };
      req.destroy = () => {};
      req.end = () => {
        const parsed = JSON.parse(buf);
        const text = texts[calls.length] || texts[texts.length - 1];
        calls.push(parsed);
        const upRes = new EventEmitter();
        upRes.statusCode = 200; upRes.setEncoding = () => {}; upRes.resume = () => {};
        reqOpts.onResponse(upRes);
        upRes.emit('data', `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
        upRes.emit('data', 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n');
        upRes.emit('data', 'data: [DONE]\n\n');
        upRes.emit('end');
      };
      cb(null, req);
      return req;
    },
    openAcpUpstream: () => { throw new Error('ACP must not be used'); },
    responseCors: () => ({}),
    UPSTREAM_MAX_RESPONSE_BYTES: 1024 * 1024, UPSTREAM_SSE_BUFFER_BYTES: 65536,
    UPSTREAM_QUALITY_SCAN_MAX_CHARS: 10000, UPSTREAM_TOTAL_TIMEOUT_MS: 30000,
    LIVE_BILLING_EVENT_INTERVAL_MS: 5000
  });
  return { service, calls };
}

async function run(service) {
  let sseOut = '';
  let finishRes;
  const donePromise = new Promise(resolve => { finishRes = resolve; });
  const res = {
    headersSent: false, writableEnded: false, destroyed: false,
    on: () => {}, once: () => {}, setHeader: () => {},
    writeHead: () => { res.headersSent = true; },
    write: chunk => { sseOut += chunk; },
    end: () => { res.writableEnded = true; finishRes(); }
  };
  await service.handleChat({ headers: { 'x-molan-internal-route': 'internal-secret' }, on: () => {}, once: () => {} }, res);
  if (res.body) throw new Error('handleChat early json: ' + JSON.stringify(res.body));
  if (!res.writableEnded) await donePromise;
  const usageEvent = sseOut.split('\n\n').map(l => l.replace(/^data: /, '')).filter(l => l.startsWith('{'))
    .map(l => { try { return JSON.parse(l); } catch (_) { return null; } })
    .find(j => j && j.molan_usage);
  const controlEvents = sseOut.split('\n\n').map(l => l.replace(/^data: /, '')).filter(l => l.startsWith('{'))
    .map(l => { try { return JSON.parse(l); } catch (_) { return null; } })
    .filter(j => j && j.molan_rewrite);
  const contentChunks = sseOut.split('\n\n').map(l => l.replace(/^data: /, '')).filter(l => l.startsWith('{'))
    .map(l => { try { return JSON.parse(l); } catch (_) { return null; } })
    .filter(j => j && j.choices && j.choices[0] && j.choices[0].delta && typeof j.choices[0].delta.content === 'string')
    .map(j => j.choices[0].delta.content);
  return { sseOut, usageEvent, controlEvents, content: contentChunks.join('') };
}

test('自检闸门：未达标自动多轮改写，达标后择优下发一次，无重复正文', async () => {
  const scoreByText = text => {
    if (text === DRAFT_TEXT) return { score: 40, passed: false, metrics: { structuralRiskTotal: 1, zhuqueSignals: {} }, details: { blockHits: [{ term: '死一般的寂静' }], llmGlueHits: [] } };
    if (text === ROUND1_TEXT) return { score: 30, passed: false, metrics: { structuralRiskTotal: 0, zhuqueSignals: {} }, details: { blockHits: [], llmGlueHits: [] } };
    return { score: 8, passed: true, metrics: { structuralRiskTotal: 0, zhuqueSignals: { bigramTtr: 0.8 } }, details: { blockHits: [], llmGlueHits: [] } };
  };
  const { service, calls } = buildService({
    gateRounds: '2', scoreByText,
    texts: [DRAFT_TEXT, ROUND1_TEXT, ROUND2_TEXT]
  });
  const out = await run(service);
  assert.ok(calls.length >= 2, '应发生至少一次改写重试');
  assert.ok(out.controlEvents.some(e => e.molan_rewrite.phase === 'gate_retry'), '应发出 gate_retry 控制事件');
  assert.equal(out.content.includes(ROUND2_TEXT), true, '最终下发的应是达标轮（第2轮）文本');
  assert.equal(out.content.includes(ROUND1_TEXT), false, '不应重复下发未达标的第1轮文本');
  const gate = out.usageEvent && out.usageEvent.molan_usage.aiFlavor.rewrite.gate;
  assert.ok(gate, 'rewriteMeta 应记录 gate 信息');
  assert.equal(gate.enabled, true);
  assert.equal(gate.reached, true);
  assert.deepEqual(gate.roundScores, [30, 8]);
});

test('自检闸门：轮次用尽仍未达标时下发历史最优，不空转', async () => {
  const scoreByText = text => {
    if (text === DRAFT_TEXT) return { score: 40, passed: false, metrics: { structuralRiskTotal: 1, zhuqueSignals: {} }, details: { blockHits: [{ term: 'x' }], llmGlueHits: [] } };
    return { score: 25, passed: false, metrics: { structuralRiskTotal: 0, zhuqueSignals: {} }, details: { blockHits: [], llmGlueHits: [] } };
  };
  const { service, calls } = buildService({
    gateRounds: '1', scoreByText,
    texts: [DRAFT_TEXT, ROUND1_TEXT, ROUND2_TEXT]
  });
  const out = await run(service);
  assert.equal(out.content.includes(ROUND1_TEXT), true, '未达标但轮次用尽，下发已产出的改写稿');
  const gate = out.usageEvent && out.usageEvent.molan_usage.aiFlavor.rewrite.gate;
  assert.equal(gate.reached, false);
  assert.equal(gate.roundsRun, 1, 'maxRounds=1 时仅跑 1 轮改写');
});

test('自检闸门：轮数=0 时保持单轮行为，零回归', async () => {
  const scoreByText = () => ({ score: 8, passed: true, metrics: { structuralRiskTotal: 0, zhuqueSignals: { bigramTtr: 0.8 } }, details: { blockHits: [], llmGlueHits: [] } });
  const { service, calls } = buildService({
    gateRounds: '0', scoreByText,
    texts: [DRAFT_TEXT, ROUND1_TEXT]
  });
  const out = await run(service);
  assert.equal(calls.length, 2, '闸门关闭：仅初稿 + 1 轮改写');
  assert.ok(!out.controlEvents.some(e => e.molan_rewrite.phase === 'gate_retry'), '不应有 gate_retry');
});
