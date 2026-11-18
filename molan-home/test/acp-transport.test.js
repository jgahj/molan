'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAcpTransportService, selectConfigOptionValue, compileAcpPromptFromMessages } = require('../services/acp-transport-service');
const { createChatService, resolveUpstreamModelForReasoning } = require('../services/chat-service');
const { getModelCapability, estimatePromptTokens } = require('../lib/model/model-registry');
const { calculateContextBudget } = require('../lib/generation/context-budget');

function writeMockAcpScript(dir, mode = 'normal') {
  const file = path.join(dir, `mock-acp-${mode}.js`);
  const code = `
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let turnCount = 0;
function send(obj) { process.stdout.write(JSON.stringify(obj) + '\\n'); }
rl.on('line', line => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } });
  } else if (msg.method === 'session/new') {
    if (${JSON.stringify(mode)} === 'unauth') {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'Authentication required' } });
      return;
    }
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        sessionId: 'sess_' + (++turnCount),
        configOptions: [
          {
            id: 'model',
            category: 'model',
            currentValue: 'gemini-3.8-flash-medium',
            options: [
              { value: 'gemini-4-hydrogen-high', name: 'Gemini 4 Hydrogen (High)' },
              { value: 'gemini-4-hydrogen-xhigh', name: 'Gemini 4 Hydrogen (XHigh)' },
              { value: 'claude-opus-5-5-high', name: 'Claude Opus 5.5 (High)' },
              { value: 'claude-sonnet-5-5-high', name: 'Claude Sonnet 5.5 (High)' }
            ]
          },
          {
            id: 'thought_level',
            category: 'thought_level',
            currentValue: 'medium',
            options: [
              { value: 'low', name: 'Low' },
              { value: 'medium', name: 'Medium' },
              { value: 'high', name: 'High' },
              { value: 'xhigh', name: 'XHigh' }
            ]
          }
        ]
      }
    });
  } else if (msg.method === 'session/set_config_option') {
    send({ jsonrpc: '2.0', id: msg.id, result: { configOptions: [] } });
  } else if (msg.method === 'session/prompt') {
    const sid = msg.params.sessionId;
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: sid, update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '思考中' } } } });
    send({ jsonrpc: '2.0', id: 9001, method: 'session/request_permission', params: { sessionId: sid, options: [{ optionId: 'reject_always', kind: 'reject_always' }] } });
    setTimeout(() => {
      const promptText = String((msg.params.prompt && msg.params.prompt[0] && msg.params.prompt[0].text) || '');
      const reply = promptText.includes('二遍改写') ? '这是精修后的纯正中文小说正文。' : '这是林砚在矿坑里的第一段初稿正文。';
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: sid, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: reply } } } });
      send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn', usage: { inputTokens: 120, outputTokens: 45, thoughtTokens: 15 } } });
    }, 15);
  } else if (msg.id != null && !msg.method) {
    // response from client to request_permission
  }
});
`;
  fs.writeFileSync(file, code, 'utf8');
  return file;
}

test('Model registry & context budget recognize official Antigravity ACP flagship models', () => {
  const h4 = getModelCapability('gemini-4-hydrogen');
  assert.equal(h4.contextWindow, 1000000);
  assert.equal(h4.supportsReasoning, true);
  assert.deepEqual(h4.reasoningModes, ['low', 'medium', 'high']);

  const opus55 = getModelCapability('claude-opus-5-5-high');
  assert.equal(opus55.contextWindow, 200000);
  assert.equal(opus55.tokenizer, 'claude');

  const budget = calculateContextBudget({
    modelId: 'gemini-4-hydrogen',
    system: '创作指令',
    context: '前情提要',
    targetChars: 3000
  });
  assert.equal(budget.limit, 1000000);
  assert.ok(budget.fits);
});

test('ACP helper selects configOptions accurately and preserves system/json directives', () => {
  const opts = [
    { id: 'model', category: 'model', currentValue: 'a', options: [{ value: 'gemini-4-hydrogen-high' }, { value: 'claude-opus-5-5-high' }] },
    { id: 'thought_level', category: 'thought_level', currentValue: 'medium', options: [{ value: 'low' }, { value: 'high' }] }
  ];
  const updates = selectConfigOptionValue(opts, 'gemini-4-hydrogen', 'high');
  assert.deepEqual(updates, [
    { configId: 'model', value: 'gemini-4-hydrogen-high' },
    { configId: 'thought_level', value: 'high' }
  ]);

  const compiled = compileAcpPromptFromMessages([
    { role: 'system', content: 'P0 约束' },
    { role: 'user', content: '续写第十二章' }
  ], { jsonMode: true });
  assert.match(compiled.promptText, /P0 约束/);
  assert.match(compiled.promptText, /合法 JSON 对象/);
});

test('ACP transport streams SSE chunks, denies tool permissions, and reports usage', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-acp-test-'));
  const scriptPath = writeMockAcpScript(tmpDir, 'normal');
  const acp = createAcpTransportService({
    acpCommand: process.execPath,
    acpArgs: [scriptPath],
    sandboxDir: path.join(tmpDir, 'sandbox'),
    estimatePromptTokens
  });

  try {
    const raw = await new Promise((resolve, reject) => {
      const req = acp.openUpstream({
        modelConfig: { id: 'gemini-4-hydrogen', model: 'gemini-4-hydrogen', defaultReasoningEffort: 'high' },
        reasoningEffort: 'high',
        onResponse: res => {
          assert.equal(res.statusCode, 200);
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => resolve(data));
          res.on('error', reject);
        }
      }, (err, upstream) => {
        if (err) return reject(err);
        upstream.write(JSON.stringify({
          model: 'gemini-4-hydrogen',
          reasoning_effort: 'high',
          messages: [{ role: 'system', content: '写玄幻' }, { role: 'user', content: '继续' }]
        }));
        upstream.end();
      });
      req.on('error', reject);
    });

    assert.match(raw, /"reasoning_content":"思考中"/);
    assert.match(raw, /"content":"这是林砚在矿坑里的第一段初稿正文。"/);
    assert.match(raw, /"prompt_tokens":120/);
    assert.match(raw, /\[DONE\]/);
  } finally {
    acp.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ACP transport maps unauthenticated error (-32000) to actionable 503 ACP_AUTH_REQUIRED', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-acp-unauth-'));
  const scriptPath = writeMockAcpScript(tmpDir, 'unauth');
  const acp = createAcpTransportService({
    acpCommand: process.execPath,
    acpArgs: [scriptPath],
    sandboxDir: path.join(tmpDir, 'sandbox')
  });

  try {
    const resObj = await new Promise((resolve, reject) => {
      acp.openUpstream({
        modelConfig: { id: 'gemini-4-hydrogen', model: 'gemini-4-hydrogen' },
        onResponse: res => {
          let body = '';
          res.on('data', chunk => { body += chunk; });
          res.on('end', () => resolve({ statusCode: res.statusCode, body: JSON.parse(body) }));
        }
      }, (err, upstream) => {
        if (err) return reject(err);
        upstream.write(JSON.stringify({ model: 'gemini-4-hydrogen', messages: [{ role: 'user', content: 'hi' }] }));
        upstream.end();
      });
    });

    assert.equal(resObj.statusCode, 503);
    assert.equal(resObj.body.error.type, 'ACP_AUTH_REQUIRED');
    assert.match(resObj.body.error.message, /acp-login\.bat/);
  } finally {
    acp.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('chat-service routes antigravity-acp through openAcpUpstream cleanly without suffix mangling', async () => {
  const acpModel = {
    id: 'gemini-4-hydrogen',
    name: 'Gemini 4 Hydrogen (官方 ACP)',
    group: 'antigravity',
    provider: 'antigravity-acp',
    model: 'gemini-4-hydrogen',
    supportsReasoning: true,
    reasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
    defaultReasoningEffort: 'high',
    promptCaching: false
  };
  assert.equal(resolveUpstreamModelForReasoning(acpModel, 'high'), 'gemini-4-hydrogen');

  let capturedReq = null;
  const service = createChatService({
    getDatabase: () => null,
    getEnvironment: () => ({}),
    getDeepseekKey: () => '',
    getDeepseekUrl: () => '',
    getProxyUrl: () => '',
    POSTGRES_MODE: false,
    postgresRepository: { enabled: false },
    postgresActor: () => 'u_1',
    getAuthUser: () => ({ user: { userId: 'u_1', email: 'test@local' } }),
    requireSqliteForPublic: () => false,
    allowChatRate: () => true,
    acquireChatSlot: () => true,
    releaseChatSlot: () => {},
    json: (res, code, data) => { res.statusCode = code; res.body = data; },
    readBody: async () => ({ model: 'gemini-4-hydrogen', messages: [{ role: 'user', content: '你好' }] }),
    respondError: (_res, err) => { throw err; },
    CHAT_MAX_JSON_BODY_BYTES: 1024 * 1024,
    nativeSkillCatalog: async () => null,
    appRepository: () => ({ recordDispatchAttempt: async () => ({ ok: true, authorized: true }) }),
    projectScope: { stableUserId: x => x },
    isAdminUser: () => true,
    INTERNAL_MODEL_ROUTE_KEY: '',
    INTERNAL_MODEL_ROUTE_HEADER: '',
    generationV2Enabled: () => false,
    validateChatMessages: m => m,
    splitDynamicPrompt: m => m,
    detectNovelStyle: () => '',
    adaptIpContinuationMessages: m => m,
    DEFAULT_WRITING_SKILL_ID: 'writing',
    loadEditorOnlyWritingSkill: () => null,
    ensureEditorOnlyWritingSkill: () => ({}),
    editorOnlySkillAuditRequest: () => ({}),
    ensureDefaultWritingSkill: () => ({}),
    addDefaultWritingSkillAudit: () => ({}),
    buildSkillAudit: () => ({ skills: [] }),
    prepareSkillMessagesForUpstream: (_auth, m, skillAudit) => ({ messages: m, skillAudit }),
    correctionPolicyEnabled: () => false,
    isTwoPassHumanizeEnabled: () => false,
    loadEditorOnlyCorrectionLibrary: () => null,
    CORRECTION_PRIOR_TEXT_MAX_CHARS: 1000,
    lastUserMessageText: () => '',
    injectEditorOnlyCorrectionLibrary: m => m,
    EDITOR_ONLY_CORRECTION_VERSION: '1.0',
    EDITOR_ONLY_CORRECTION_FILE_DEFAULT: '',
    UNIVERSAL_CORRECTION_POLICY_VERSION: '1.0',
    UNIVERSAL_CORRECTION_STAGES: [],
    injectUniversalCorrectionPolicy: m => m,
    emptyEditorOnlyCharacterMaterialResult: () => ({ messages: [], audit: {} }),
    buildCharacterMaterialBlock: () => ({ messages: [], audit: {} }),
    isMatureCharacterMaterialEnabledForNovel: () => false,
    reviewCharacterMaterialSamples: async () => ({ approvedIds: [], audit: { required: false } }),
    calculateCharacterMaterialRhythmDeviation: () => 0,
    scanCharacterMaterialOverlap: () => ({}),
    injectPromptInjectionGuard: m => m,
    resolveFingerprintProfile: () => null,
    buildRhythmTargetBlock: () => '',
    appendSystemBlock: m => m,
    planContextWindow: (_pm, msgs, reqMax) => ({ ok: true, messages: msgs, promptTokens: 10, contextWindowTokens: 1000000, availableCompletionTokens: reqMax || 8192, dynamicPromptTruncated: false }),
    sanitizeSystemForUpstream: s => s,
    internalModelIdFromRequest: () => '',
    resolveModelForUser: () => 'gemini-4-hydrogen',
    findPlatformModel: () => acpModel,
    currentDefaultModel: () => 'gemini-4-hydrogen',
    buildHumanizePassMessages: () => [],
    mergeUsageSum: u => u,
    computeAiFlavorScore: () => ({ score: 10, passed: true, metrics: {}, details: {} }),
    summarizeAiFlavorVerdict: () => ({}),
    addPromptCacheBreakpoint: m => m,
    normalizeReasoningEffort: (_pm, v) => v || '',
    stablePromptCacheKey: () => 'k',
    reserveCredits: async () => ({ ok: true }),
    planCreditReservation: () => ({ ok: true, maxTokens: 8192, reservedCost: 0 }),
    normalizeUsage: u => ({ promptTokens: u && u.prompt_tokens || 0, completionTokens: u && u.completion_tokens || 0, totalTokens: u && u.total_tokens || 0 }),
    estimateTextTokenUpperBound: () => 10,
    creditCostForUser: () => 0,
    roundCreditValue: v => v,
    emptyCorrectionAudit: () => ({}),
    scanUniversalCorrectionRisks: () => ({ total: 0 }),
    recordCorrectionHits: () => {},
    settleTokenUsage: async () => ({ ok: true }),
    openUpstream: () => { throw new Error('HTTP openUpstream must not be called for antigravity-acp'); },
    openAcpUpstream: (reqOpts, cb) => {
      const { EventEmitter } = require('node:events');
      const req = new EventEmitter();
      let buf = '';
      req.write = c => { buf += c; };
      req.destroy = () => {};
      req.end = () => {
        capturedReq = JSON.parse(buf);
        const upRes = new EventEmitter();
        upRes.statusCode = 200;
        upRes.setEncoding = () => {};
        upRes.resume = () => {};
        reqOpts.onResponse(upRes);
        upRes.emit('data', 'data: {"choices":[{"delta":{"content":"ACP测试回复"}}]}\n\n');
        upRes.emit('data', 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n');
        upRes.emit('data', 'data: [DONE]\n\n');
        upRes.emit('end');
      };
      cb(null, req);
      return req;
    },
    responseCors: () => ({}),
    UPSTREAM_MAX_RESPONSE_BYTES: 1024 * 1024,
    UPSTREAM_SSE_BUFFER_BYTES: 65536,
    UPSTREAM_QUALITY_SCAN_MAX_CHARS: 10000,
    UPSTREAM_TOTAL_TIMEOUT_MS: 30000,
    LIVE_BILLING_EVENT_INTERVAL_MS: 5000
  });

  let sseOut = '';
  let finishRes;
  const donePromise = new Promise(resolve => { finishRes = resolve; });
  const res = {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    on: () => {},
    once: () => {},
    setHeader: () => {},
    writeHead: () => { res.headersSent = true; },
    write: chunk => { sseOut += chunk; },
    end: () => { res.writableEnded = true; finishRes(); }
  };

  await service.handleChat({ headers: {}, on: () => {}, once: () => {} }, res);
  if (!res.writableEnded) {
    assert.equal(res.statusCode, undefined, 'unexpected json error: ' + JSON.stringify(res.body));
    await donePromise;
  }
  assert.ok(capturedReq, 'openAcpUpstream must receive compiled OpenAI-compat request payload');
  assert.equal(capturedReq.model, 'gemini-4-hydrogen');
  assert.equal(capturedReq.reasoning_effort, 'high');
  assert.match(sseOut, /ACP测试回复/);
});
