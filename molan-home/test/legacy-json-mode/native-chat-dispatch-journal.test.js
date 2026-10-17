'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { JsonAppRepository } = require('../lib/repositories/json-app-repository');
const { createNativeBillingService, buildUsageSummary } = require('../services/native-billing-service');
const { createChatService } = require('../services/chat-service');
const { matchesTokenUsageReservation } = require('../lib/token-usage-idempotency');

function fakeResponse() {
  const res = new EventEmitter();
  res.headersSent = false;
  res.writableEnded = false;
  res.destroyed = false;
  res.statusCode = 200;
  res._headers = {};
  res._chunks = [];
  res.setHeader = (k, v) => { res._headers[k.toLowerCase()] = v; };
  res.getHeader = k => res._headers[k.toLowerCase()];
  res.writeHead = (code, headers = {}) => {
    res.statusCode = code;
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.headersSent = true;
    return res;
  };
  res.write = chunk => {
    if (!res.headersSent) res.writeHead(200);
    res._chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    return true;
  };
  res.end = chunk => {
    if (chunk) res.write(chunk);
    res.writableEnded = true;
    res.emit('finish');
    return res;
  };
  res.output = () => res._chunks.join('');
  return res;
}

function fakeRequest(headers = {}, body = {}) {
  const req = new EventEmitter();
  req.method = 'POST';
  req.url = '/api/chat';
  req.headers = headers;
  req._body = JSON.stringify(body);
  return req;
}

test('dispatch boundary persistence failure prevents provider call on first pass and preserves un-dispatched refund', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-dispatch-fail-1-'));
  const repository = new JsonAppRepository(directory);
  t.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const user = await repository.saveAccount({ email: 'dispatch1@test.local', userId: 'user-fail-1', role: 'normal', credits: 10 });
  const billingService = createNativeBillingService({
    repository,
    isAdminUser: u => u.role === 'admin',
    creditCostForUser: (_u, _m, tokens) => tokens / 1000,
    roundCreditValue: x => Math.round(x * 10000) / 10000,
    toTokenCount: v => Number.isSafeInteger(v) && v >= 0 ? v : null,
    matchesTokenUsageReservation
  });

  let providerCalls = 0;
  const chatService = createChatService({
    getDatabase: () => null,
    getEnvironment: () => ({}),
    getDeepseekKey: () => 'fake-key',
    getDeepseekUrl: () => 'http://provider.local/v1',
    getProxyUrl: () => '',
    POSTGRES_MODE: false,
    getAuthUser: () => ({ user: { ...user, userId: user.userId, email: user.email } }),
    requireSqliteForPublic: () => true,
    allowChatRate: () => true,
    acquireChatSlot: () => true,
    releaseChatSlot: () => {},
    json: (res, code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    },
    readBody: req => Promise.resolve(req._body),
    respondError: (res, err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    },
    CHAT_MAX_JSON_BODY_BYTES: 64 * 1024,
    nativeSkillCatalog: null,
    appRepository: () => repository,
    projectScope: { stableUserId: email => email },
    isAdminUser: u => u.role === 'admin',
    INTERNAL_MODEL_ROUTE_KEY: 'test-route-key',
    INTERNAL_MODEL_ROUTE_HEADER: 'x-internal-route-key',
    generationV2Enabled: false,
    validateChatMessages: msgs => msgs,
    splitDynamicPrompt: msgs => msgs,
    detectNovelStyle: () => null,
    adaptIpContinuationMessages: msgs => msgs,
    DEFAULT_WRITING_SKILL_ID: 'none',
    loadEditorOnlyWritingSkill: () => null,
    ensureEditorOnlyWritingSkill: () => null,
    editorOnlySkillAuditRequest: () => null,
    ensureDefaultWritingSkill: () => null,
    addDefaultWritingSkillAudit: () => {},
    buildSkillAudit: () => ({ status: 'passed', skills: [], forwarding: { skills: [] } }),
    prepareSkillMessagesForUpstream: (_auth, msgs, audit) => ({ messages: msgs, skillAudit: audit }),
    correctionPolicyEnabled: () => false,
    isTwoPassHumanizeEnabled: () => false,
    loadEditorOnlyCorrectionLibrary: () => null,
    CORRECTION_PRIOR_TEXT_MAX_CHARS: 1000,
    lastUserMessageText: () => 'test message',
    injectEditorOnlyCorrectionLibrary: msgs => msgs,
    EDITOR_ONLY_CORRECTION_VERSION: '1.0',
    EDITOR_ONLY_CORRECTION_FILE_DEFAULT: '',
    UNIVERSAL_CORRECTION_POLICY_VERSION: '1.0',
    UNIVERSAL_CORRECTION_STAGES: [],
    injectUniversalCorrectionPolicy: msgs => msgs,
    emptyEditorOnlyCharacterMaterialResult: () => ({ audit: { enabled: false }, messages: [] }),
    buildCharacterMaterialBlock: () => ({ audit: { enabled: false }, messages: [] }),
    isMatureCharacterMaterialEnabledForNovel: () => false,
    reviewCharacterMaterialSamples: () => Promise.resolve({ approvedIds: [], audit: { required: false } }),
    calculateCharacterMaterialRhythmDeviation: () => ({ available: false, exceeded: false }),
    scanCharacterMaterialOverlap: () => ({ blocked: false }),
    injectPromptInjectionGuard: msgs => msgs,
    resolveFingerprintProfile: () => null,
    buildRhythmTargetBlock: () => '',
    appendSystemBlock: (sys, blk) => (sys ? sys + '\n' + blk : blk),
    planContextWindow: () => ({
      ok: true,
      messages: [{ role: 'user', content: 'hello' }],
      promptTokens: 10,
      contextWindowTokens: 4096,
      requestedMaxTokens: 100,
      fixedPromptTokens: 10,
      originalDynamicPromptTokens: 0,
      dynamicPromptTokens: 0,
      dynamicPromptBudget: 1000,
      dynamicPromptTruncated: false,
      overflowTokens: 0,
      fixedPromptExceeded: false,
      availableCompletionTokens: 100,
      cappedByContext: false
    }),
    sanitizeSystemForUpstream: s => s,
    internalModelIdFromRequest: () => 'test-model',
    resolveModelForUser: () => 'test-model',
    findPlatformModel: () => ({ id: 'test-model', name: 'test-model', model: 'test-model', provider: 'openai-compat', apiKey: 'test-key', baseURL: 'http://provider.local/v1' }),
    currentDefaultModel: () => 'test-model',
    buildHumanizePassMessages: () => [],
    mergeUsageSum: (a, b) => ({ totalTokens: (a?.totalTokens || 0) + (b?.totalTokens || 0) }),
    computeAiFlavorScore: () => ({ passed: true, score: 0 }),
    summarizeAiFlavorVerdict: () => ({ passed: true }),
    addPromptCacheBreakpoint: msgs => msgs,
    normalizeReasoningEffort: () => null,
    stablePromptCacheKey: () => '',
    reserveCredits: (u, m, pm, reqId, cost, audit, hash, scope, opts) => billingService.reserveCredits(u, m, pm, reqId, cost, audit, hash, scope, opts),
    planCreditReservation: () => ({ ok: true, reservedCost: 2, maxTokens: 100, reservationTokenLimit: 200, cappedByBalance: false }),
    normalizeUsage: u => ({ totalTokens: u?.total_tokens ?? null, promptTokens: u?.prompt_tokens ?? null, completionTokens: u?.completion_tokens ?? null, cachedTokens: 0, cacheWriteTokens: 0, usageSource: u ? 'upstream' : 'unavailable' }),
    estimateTextTokenUpperBound: t => String(t || '').length,
    creditCostForUser: (_u, _m, tokens) => tokens / 1000,
    roundCreditValue: x => Math.round(x * 10000) / 10000,
    emptyCorrectionAudit: () => ({ status: 'none' }),
    scanUniversalCorrectionRisks: () => ({ status: 'none' }),
    recordCorrectionHits: () => {},
    settleTokenUsage: ev => billingService.settleTokenUsage(ev),
    openUpstream: (_url, _proxy, _options, onUpstream) => {
      providerCalls++;
      const upstream = new EventEmitter();
      upstream.write = () => {};
      upstream.end = () => {};
      upstream.destroy = () => {};
      setImmediate(() => onUpstream(null, upstream));
    },
    responseCors: () => ({}),
    UPSTREAM_MAX_RESPONSE_BYTES: 1024 * 1024,
    UPSTREAM_SSE_BUFFER_BYTES: 64 * 1024,
    UPSTREAM_QUALITY_SCAN_MAX_CHARS: 10000,
    UPSTREAM_TOTAL_TIMEOUT_MS: 5000,
    LIVE_BILLING_EVENT_INTERVAL_MS: 1000,
    // 注入写盘失败：首遍派发边界持久化抛出异常
    recordDispatchAttempt: async () => {
      throw new Error('DISK_FULL: simulated dispatch journal write failure');
    }
  });

  const reqId1 = 'req_' + '1'.repeat(40);
  const req = fakeRequest(
    { 'idempotency-key': reqId1, 'x-internal-route-key': 'test-route-key' },
    { messages: [{ role: 'user', content: 'hello' }] }
  );
  const res = fakeResponse();

  chatService.handleChat(req, res);
  await new Promise(resolve => res.on('finish', resolve));

  // 1. 写盘失败则禁止调用供应商
  assert.equal(providerCalls, 0, 'Upstream provider must NEVER be called if dispatch boundary write fails');
  assert.equal(res.statusCode, 500);
  const responseJson = JSON.parse(res.output());
  assert.equal(responseJson.code, 'DISPATCH_PERSISTENCE_FAILED');

  // 2. 预占未派发，首次写盘失败立即释放预占，credits 立即恢复为 10
  assert.equal((await repository.getAccount(user.userId)).credits, 10);

  // 3. 已派发未知不能退款
  const heldReqId = 'req_' + 'be1d'.padEnd(40, '0');
  await billingService.reserveCredits(user, 'test-model', 'test-model', heldReqId, 2, {}, 'hash', null);
  assert.equal((await repository.getAccount(user.userId)).credits, 8);
  await repository.recordDispatchAttempt({ userId: user.userId, requestId: heldReqId, pass: 1, stage: 'single_pass' });
  const heldRow = await repository.lookupTokenUsage({ userId: user.userId, requestId: heldReqId });
  assert.equal(heldRow.status, 'dispatched');
  await assert.rejects(
    () => repository.settleTokenUsage({ userId: user.userId, requestId: heldReqId, actualCost: 0, outcome: 'dispatch_failed' }),
    /CANNOT_REFUND_DISPATCHED_UNKNOWN/
  );
  assert.equal((await repository.getAccount(user.userId)).credits, 8);
});

test('two-pass chat failsafe: pass 2 dispatch write failure prevents pass 2 provider call and falls back to pass 1 draft', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-dispatch-fail-2-'));
  const repository = new JsonAppRepository(directory);
  t.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const user = await repository.saveAccount({ email: 'dispatch2@test.local', userId: 'user-fail-2', role: 'normal', credits: 10 });
  const billingService = createNativeBillingService({
    repository,
    isAdminUser: u => u.role === 'admin',
    creditCostForUser: (_u, _m, tokens) => tokens / 1000,
    roundCreditValue: x => Math.round(x * 10000) / 10000,
    toTokenCount: v => Number.isSafeInteger(v) && v >= 0 ? v : null,
    matchesTokenUsageReservation
  });

  let pass1Calls = 0;
  let pass2Calls = 0;

  const chatService = createChatService({
    getDatabase: () => null,
    getEnvironment: () => ({}),
    getDeepseekKey: () => 'fake-key',
    getDeepseekUrl: () => 'http://provider.local/v1',
    getProxyUrl: () => '',
    POSTGRES_MODE: false,
    getAuthUser: () => ({ user: { ...user, userId: user.userId, email: user.email } }),
    requireSqliteForPublic: () => true,
    allowChatRate: () => true,
    acquireChatSlot: () => true,
    releaseChatSlot: () => {},
    json: (res, code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    },
    readBody: req => Promise.resolve(req._body),
    respondError: (res, err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    },
    CHAT_MAX_JSON_BODY_BYTES: 64 * 1024,
    nativeSkillCatalog: null,
    appRepository: () => repository,
    projectScope: { stableUserId: email => email },
    isAdminUser: u => u.role === 'admin',
    INTERNAL_MODEL_ROUTE_KEY: 'test-route-key',
    INTERNAL_MODEL_ROUTE_HEADER: 'x-internal-route-key',
    generationV2Enabled: false,
    validateChatMessages: msgs => msgs,
    splitDynamicPrompt: msgs => msgs,
    detectNovelStyle: () => null,
    adaptIpContinuationMessages: msgs => msgs,
    DEFAULT_WRITING_SKILL_ID: 'none',
    loadEditorOnlyWritingSkill: () => null,
    ensureEditorOnlyWritingSkill: () => null,
    editorOnlySkillAuditRequest: () => null,
    ensureDefaultWritingSkill: () => null,
    addDefaultWritingSkillAudit: () => {},
    buildSkillAudit: () => ({ status: 'passed', skills: [], forwarding: { skills: [] } }),
    prepareSkillMessagesForUpstream: (_auth, msgs, audit) => ({ messages: msgs, skillAudit: audit }),
    correctionPolicyEnabled: () => false,
    isTwoPassHumanizeEnabled: () => true, // 启用两遍模式
    loadEditorOnlyCorrectionLibrary: () => null,
    CORRECTION_PRIOR_TEXT_MAX_CHARS: 1000,
    lastUserMessageText: () => 'test message',
    injectEditorOnlyCorrectionLibrary: msgs => msgs,
    EDITOR_ONLY_CORRECTION_VERSION: '1.0',
    EDITOR_ONLY_CORRECTION_FILE_DEFAULT: '',
    UNIVERSAL_CORRECTION_POLICY_VERSION: '1.0',
    UNIVERSAL_CORRECTION_STAGES: [],
    injectUniversalCorrectionPolicy: msgs => msgs,
    emptyEditorOnlyCharacterMaterialResult: () => ({ audit: { enabled: false }, messages: [] }),
    buildCharacterMaterialBlock: () => ({ audit: { enabled: false }, messages: [] }),
    isMatureCharacterMaterialEnabledForNovel: () => false,
    reviewCharacterMaterialSamples: () => Promise.resolve({ approvedIds: [], audit: { required: false } }),
    calculateCharacterMaterialRhythmDeviation: () => ({ available: false, exceeded: false }),
    scanCharacterMaterialOverlap: () => ({ blocked: false }),
    injectPromptInjectionGuard: msgs => msgs,
    resolveFingerprintProfile: () => null,
    buildRhythmTargetBlock: () => '',
    appendSystemBlock: (sys, blk) => (sys ? sys + '\n' + blk : blk),
    planContextWindow: () => ({
      ok: true,
      messages: [{ role: 'user', content: 'hello' }],
      promptTokens: 10,
      contextWindowTokens: 4096,
      requestedMaxTokens: 100,
      fixedPromptTokens: 10,
      originalDynamicPromptTokens: 0,
      dynamicPromptTokens: 0,
      dynamicPromptBudget: 1000,
      dynamicPromptTruncated: false,
      overflowTokens: 0,
      fixedPromptExceeded: false,
      availableCompletionTokens: 100,
      cappedByContext: false
    }),
    sanitizeSystemForUpstream: s => s,
    internalModelIdFromRequest: () => 'test-model',
    resolveModelForUser: () => 'test-model',
    findPlatformModel: () => ({ id: 'test-model', name: 'test-model', model: 'test-model', provider: 'openai-compat', apiKey: 'test-key', baseURL: 'http://provider.local/v1' }),
    currentDefaultModel: () => 'test-model',
    buildHumanizePassMessages: () => [{ role: 'user', content: 'rewrite' }],
    mergeUsageSum: (a, b) => ({ totalTokens: (a?.totalTokens || 0) + (b?.totalTokens || 0) }),
    // 初稿未达标，必须触发第二遍改写
    computeAiFlavorScore: text => ({ passed: text.includes('perfect'), score: text.includes('perfect') ? 10 : 85 }),
    summarizeAiFlavorVerdict: () => ({ passed: false }),
    addPromptCacheBreakpoint: msgs => msgs,
    normalizeReasoningEffort: () => null,
    stablePromptCacheKey: () => '',
    reserveCredits: (u, m, pm, reqId, cost, audit, hash, scope, opts) => billingService.reserveCredits(u, m, pm, reqId, cost, audit, hash, scope, opts),
    planCreditReservation: () => ({ ok: true, reservedCost: 2, maxTokens: 100, reservationTokenLimit: 200, cappedByBalance: false }),
    normalizeUsage: u => ({ totalTokens: u?.total_tokens ?? null, promptTokens: u?.prompt_tokens ?? null, completionTokens: u?.completion_tokens ?? null, cachedTokens: 0, cacheWriteTokens: 0, usageSource: u ? 'upstream' : 'unavailable' }),
    estimateTextTokenUpperBound: t => String(t || '').length,
    creditCostForUser: (_u, _m, tokens) => tokens / 1000,
    roundCreditValue: x => Math.round(x * 10000) / 10000,
    emptyCorrectionAudit: () => ({ status: 'none' }),
    scanUniversalCorrectionRisks: () => ({ status: 'none' }),
    recordCorrectionHits: () => {},
    settleTokenUsage: ev => billingService.settleTokenUsage(ev),
    openUpstream: (_url, _proxy, _options, onUpstream) => {
      if (pass1Calls === 0) {
        pass1Calls++;
        const upstream = new EventEmitter();
        upstream.write = () => {};
        upstream.end = () => {};
        upstream.destroy = () => {};
        const upRes = new EventEmitter();
        upRes.statusCode = 200;
        setImmediate(() => {
          onUpstream(null, upstream);
          _options.onResponse(upRes);
          upRes.emit('data', Buffer.from('data: ' + JSON.stringify({ choices: [{ delta: { content: '第一遍初稿正文' } }] }) + '\n\n'));
          upRes.emit('data', Buffer.from('data: ' + JSON.stringify({ usage: { total_tokens: 15, prompt_tokens: 10, completion_tokens: 5 } }) + '\n\n'));
          upRes.emit('end');
        });
      } else {
        pass2Calls++;
        assert.fail('Pass 2 provider must NOT be called if pass 2 dispatch write failed');
      }
    },
    responseCors: () => ({}),
    UPSTREAM_MAX_RESPONSE_BYTES: 1024 * 1024,
    UPSTREAM_SSE_BUFFER_BYTES: 64 * 1024,
    UPSTREAM_QUALITY_SCAN_MAX_CHARS: 10000,
    UPSTREAM_TOTAL_TIMEOUT_MS: 5000,
    LIVE_BILLING_EVENT_INTERVAL_MS: 1000,
    // 注入：第一遍成功持久化，第二遍持久化失败
    recordDispatchAttempt: async input => {
      if (input.pass === 1) {
        return repository.recordDispatchAttempt(input);
      }
      throw new Error('DISK_FULL: simulated pass 2 journal write failure');
    }
  });

  const reqId2 = 'req_' + '2'.repeat(40);
  const req = fakeRequest(
    { 'idempotency-key': reqId2, 'x-internal-route-key': 'test-route-key' },
    { messages: [{ role: 'user', content: 'write chapter' }] }
  );
  const res = fakeResponse();

  chatService.handleChat(req, res);
  await new Promise(resolve => res.on('finish', resolve));

  assert.equal(pass1Calls, 1, 'First pass was dispatched');
  assert.equal(pass2Calls, 0, 'Second pass was forbidden from calling provider');
  assert.ok(res.output().includes('第一遍初稿正文'), 'Falls back to first pass text');

  // 第一遍的派发记录被持久化
  const reservation = await repository.lookupTokenUsage({ userId: user.userId, requestId: reqId2 });
  assert.equal(reservation.attempts.length, 1);
  assert.equal(reservation.attempts[0].pass, 1);
});

test('process interruption or post-response write failure recovers as provider_unknown, reaper does not refund, idempotent settlement succeeds', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-interrupt-recover-'));
  let repository = new JsonAppRepository(directory);
  t.after(async () => {
    if (repository) await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const user = await repository.saveAccount({ email: 'interrupt@test.local', userId: 'user-interrupt', role: 'normal', credits: 10 });
  const billingService = createNativeBillingService({
    repository,
    isAdminUser: u => u.role === 'admin',
    creditCostForUser: (_u, _m, tokens) => tokens / 1000,
    roundCreditValue: x => Math.round(x * 10000) / 10000,
    toTokenCount: v => Number.isSafeInteger(v) && v >= 0 ? v : null,
    matchesTokenUsageReservation
  });

  // 1. 预占 3 积分
  await billingService.reserveCredits(user, 'model-1', 'provider-model', 'req_interrupt_1', 3, {}, 'hash', null);
  assert.equal((await repository.getAccount(user.userId)).credits, 7);

  // 2. 真实派发点持久化派发边界
  const dispatchRes = await repository.recordDispatchAttempt({
    userId: user.userId,
    requestId: 'req_interrupt_1',
    pass: 1,
    stage: 'first_pass'
  });
  assert.equal(dispatchRes.ok, true);
  assert.equal(dispatchRes.status, 'dispatched');

  // 3. 模拟进程中断（未结算直接重启，重新实例化 JsonAppRepository）
  await repository.close();
  repository = new JsonAppRepository(directory);

  // 4. 重启后调用启动中断恢复接口 recoverInterruptedUsage
  const recoverRes = await repository.recoverInterruptedUsage();
  assert.equal(recoverRes.recovered, 1);
  const recovered = await repository.lookupTokenUsage({ userId: user.userId, requestId: 'req_interrupt_1' });
  assert.equal(recovered.status, 'provider_unknown');
  assert.equal(recovered.attempts.length, 1);

  // 5. 过期 reaper 不退款！
  const reaped = await repository.releaseStaleTokenUsage({ before: Date.now() + 60000 });
  assert.equal(reaped.released, 0, 'Reaper must NOT refund dispatched request');
  assert.equal((await repository.getAccount(user.userId)).credits, 7, 'Credits remain held');

  // 6. 用量列表查询费用未知 null
  const rows = await repository.listTokenUsage({ userId: user.userId });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actualCost, null, 'Actual cost must be null');
  assert.equal(rows[0].usage.creditCost, null);

  // 7. 后续完整用量幂等结算：1000 tokens = 1 credit，退还多余预占 2 credits
  const newBillingService = createNativeBillingService({
    repository,
    isAdminUser: u => u.role === 'admin',
    creditCostForUser: (_u, _m, tokens) => tokens / 1000,
    roundCreditValue: x => Math.round(x * 10000) / 10000,
    toTokenCount: v => Number.isSafeInteger(v) && v >= 0 ? v : null,
    matchesTokenUsageReservation
  });

  const settled = await newBillingService.settleTokenUsage({
    userId: user.userId,
    requestId: 'req_interrupt_1',
    modelId: 'model-1',
    totalTokens: 1000,
    promptTokens: 800,
    completionTokens: 200,
    status: 'succeeded'
  });
  assert.equal(settled.creditCost, 1);
  assert.equal(settled.billingStatus, 'exact');
  assert.equal((await repository.getAccount(user.userId)).credits, 9, '7 + (3 - 1) = 9');

  // 8. 重复结算幂等
  const duplicate = await newBillingService.settleTokenUsage({
    userId: user.userId,
    requestId: 'req_interrupt_1',
    modelId: 'model-1',
    totalTokens: 1000,
    promptTokens: 800,
    completionTokens: 200,
    status: 'succeeded'
  });
  assert.equal(duplicate.recorded, false);
  assert.equal(duplicate.creditCost, 1);
  assert.equal((await repository.getAccount(user.userId)).credits, 9);
});

test('buildUsageSummary aggregates partial total into usageUnavailableCount and never increments preciseRequestCount', () => {
  const summary = buildUsageSummary([
    { promptTokens: 100, completionTokens: 50, totalTokens: 150, status: 'succeeded' },
    { promptTokens: '20', completionTokens: '10', totalTokens: '30', providerUsageIncomplete: true, status: 'aborted' },
    { promptTokens: 50, completionTokens: 0, totalTokens: 50, status: 'provider_unknown', billingStatus: 'pending' },
    { promptTokens: null, completionTokens: null, totalTokens: null, status: 'usage_unavailable' }
  ]);

  assert.equal(summary.requestCount, 4);
  assert.equal(summary.preciseRequestCount, 1);
  assert.equal(summary.usageUnavailableCount, 3);
  assert.equal(summary.totalTokens, 230);
  assert.equal(summary.promptTokens, 170);
  assert.equal(summary.completionTokens, 60);
});

test('missing recorder or repo method fails closed and never calls upstream provider', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-dispatch-norec-'));
  const repository = new JsonAppRepository(directory);
  t.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const user = await repository.saveAccount({ email: 'norec@test.local', userId: 'user-norec', role: 'normal', credits: 10 });
  const billingService = createNativeBillingService({
    repository: {
      ...repository,
      getAccount: id => repository.getAccount(id),
      lookupTokenUsage: q => repository.lookupTokenUsage(q),
      reserveTokenUsage: q => repository.reserveTokenUsage(q),
      settleTokenUsage: q => repository.settleTokenUsage(q),
      holdTokenUsage: q => repository.holdTokenUsage(q),
      recordDispatchAttempt: undefined
    },
    isAdminUser: () => false,
    creditCostForUser: () => 1,
    roundCreditValue: x => x,
    toTokenCount: v => Number.isSafeInteger(v) && v >= 0 ? v : null,
    matchesTokenUsageReservation
  });

  await assert.rejects(
    () => billingService.recordDispatchAttempt({ requestId: 'req_test_norec', userEmail: user.email }),
    /DISPATCH_RECORDER_REQUIRED/
  );

  let providerCalled = false;
  const chatService = createChatService({
    getDatabase: () => null,
    getEnvironment: () => ({}),
    getDeepseekKey: () => 'fake-key',
    getDeepseekUrl: () => 'http://provider.local/v1',
    getProxyUrl: () => '',
    POSTGRES_MODE: false,
    getAuthUser: () => ({ user }),
    requireSqliteForPublic: () => true,
    allowChatRate: () => true,
    acquireChatSlot: () => true,
    releaseChatSlot: () => {},
    json: (res, code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    },
    readBody: req => Promise.resolve(req._body),
    respondError: (res, err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    },
    CHAT_MAX_JSON_BODY_BYTES: 64 * 1024,
    nativeSkillCatalog: null,
    appRepository: () => ({}),
    recordDispatchAttempt: null,
    projectScope: { stableUserId: email => email },
    isAdminUser: () => false,
    INTERNAL_MODEL_ROUTE_KEY: 'test-route-key',
    INTERNAL_MODEL_ROUTE_HEADER: 'x-internal-route-key',
    generationV2Enabled: false,
    validateChatMessages: msgs => msgs,
    splitDynamicPrompt: msgs => msgs,
    detectNovelStyle: () => null,
    adaptIpContinuationMessages: msgs => msgs,
    DEFAULT_WRITING_SKILL_ID: 'none',
    loadEditorOnlyWritingSkill: () => null,
    ensureEditorOnlyWritingSkill: () => null,
    editorOnlySkillAuditRequest: () => null,
    ensureDefaultWritingSkill: () => null,
    addDefaultWritingSkillAudit: () => {},
    buildSkillAudit: () => ({ status: 'passed', skills: [], forwarding: { skills: [] } }),
    prepareSkillMessagesForUpstream: (_auth, msgs, audit) => ({ messages: msgs, skillAudit: audit }),
    correctionPolicyEnabled: () => false,
    isTwoPassHumanizeEnabled: () => false,
    loadEditorOnlyCorrectionLibrary: () => null,
    CORRECTION_PRIOR_TEXT_MAX_CHARS: 1000,
    lastUserMessageText: () => 'test message',
    injectEditorOnlyCorrectionLibrary: msgs => msgs,
    EDITOR_ONLY_CORRECTION_VERSION: '1.0',
    EDITOR_ONLY_CORRECTION_FILE_DEFAULT: '',
    UNIVERSAL_CORRECTION_POLICY_VERSION: '1.0',
    UNIVERSAL_CORRECTION_STAGES: [],
    injectUniversalCorrectionPolicy: msgs => msgs,
    emptyEditorOnlyCharacterMaterialResult: () => ({ audit: { enabled: false }, messages: [] }),
    buildCharacterMaterialBlock: () => ({ audit: { enabled: false }, messages: [] }),
    isMatureCharacterMaterialEnabledForNovel: () => false,
    reviewCharacterMaterialSamples: () => Promise.resolve({ approvedIds: [], audit: { required: false } }),
    calculateCharacterMaterialRhythmDeviation: () => ({ available: false, exceeded: false }),
    scanCharacterMaterialOverlap: () => ({ blocked: false }),
    injectPromptInjectionGuard: msgs => msgs,
    resolveFingerprintProfile: () => null,
    buildRhythmTargetBlock: () => '',
    appendSystemBlock: (sys, blk) => (sys ? sys + '\n' + blk : blk),
    planContextWindow: () => ({
      ok: true, messages: [{ role: 'user', content: 'hello' }],
      promptTokens: 10, contextWindowTokens: 4096, requestedMaxTokens: 100,
      fixedPromptTokens: 10, originalDynamicPromptTokens: 0, dynamicPromptTokens: 0,
      dynamicPromptBudget: 1000, dynamicPromptTruncated: false, overflowTokens: 0,
      fixedPromptExceeded: false, availableCompletionTokens: 100, cappedByContext: false
    }),
    sanitizeSystemForUpstream: s => s,
    internalModelIdFromRequest: () => 'test-model',
    resolveModelForUser: () => 'test-model',
    findPlatformModel: () => ({ id: 'test-model', name: 'test-model', model: 'test-model', provider: 'openai-compat', apiKey: 'test-key', baseURL: 'http://provider.local/v1' }),
    currentDefaultModel: () => 'test-model',
    buildHumanizePassMessages: () => [],
    mergeUsageSum: (a, b) => ({ totalTokens: (a?.totalTokens || 0) + (b?.totalTokens || 0) }),
    computeAiFlavorScore: () => ({ passed: true, score: 0 }),
    summarizeAiFlavorVerdict: () => ({ passed: true }),
    addPromptCacheBreakpoint: msgs => msgs,
    normalizeReasoningEffort: () => null,
    stablePromptCacheKey: () => '',
    reserveCredits: (u, m, pm, reqId, cost, audit, hash, scope, opts) => billingService.reserveCredits(u, m, pm, reqId, cost, audit, hash, scope, opts),
    planCreditReservation: () => ({ ok: true, reservedCost: 2, maxTokens: 100, reservationTokenLimit: 200, cappedByBalance: false }),
    normalizeUsage: u => ({ totalTokens: u?.total_tokens ?? null, promptTokens: u?.prompt_tokens ?? null, completionTokens: u?.completion_tokens ?? null, cachedTokens: 0, cacheWriteTokens: 0, usageSource: 'unavailable' }),
    estimateTextTokenUpperBound: t => String(t || '').length,
    creditCostForUser: () => 1,
    roundCreditValue: x => x,
    emptyCorrectionAudit: () => ({ status: 'none' }),
    scanUniversalCorrectionRisks: () => ({ status: 'none' }),
    recordCorrectionHits: () => {},
    settleTokenUsage: ev => repository.settleTokenUsage({ userId: ev.userId, requestId: ev.requestId, actualCost: 0, outcome: 'dispatch_failed' }),
    openUpstream: () => { providerCalled = true; },
    responseCors: () => ({}),
    UPSTREAM_MAX_RESPONSE_BYTES: 1024 * 1024,
    UPSTREAM_SSE_BUFFER_BYTES: 64 * 1024,
    UPSTREAM_QUALITY_SCAN_MAX_CHARS: 10000,
    UPSTREAM_TOTAL_TIMEOUT_MS: 5000,
    LIVE_BILLING_EVENT_INTERVAL_MS: 1000
  });

  const req = fakeRequest({ 'idempotency-key': 'req_' + 'f'.repeat(40), 'x-internal-route-key': 'test-route-key' }, { messages: [{ role: 'user', content: 'hello' }] });
  const res = fakeResponse();
  chatService.handleChat(req, res);
  await new Promise(resolve => res.on('finish', resolve));

  assert.equal(providerCalled, false, 'Provider must not be called when recorder is missing');
  assert.equal(res.statusCode, 500);
  assert.equal(JSON.parse(res.output()).code, 'DISPATCH_RECORDER_REQUIRED');
  assert.equal((await repository.getAccount(user.userId)).credits, 10, 'Reservation immediately released');
});

test('unsupported-cache retry generates independent attempt ID and persists before upstream call', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-cache-retry-'));
  const repository = new JsonAppRepository(directory);
  t.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const user = await repository.saveAccount({ email: 'cacheretry@test.local', userId: 'user-cache-retry', role: 'normal', credits: 10 });
  const billingService = createNativeBillingService({
    repository,
    isAdminUser: () => false,
    creditCostForUser: (_u, _m, tokens) => tokens / 1000,
    roundCreditValue: x => Math.round(x * 10000) / 10000,
    toTokenCount: v => Number.isSafeInteger(v) && v >= 0 ? v : null,
    matchesTokenUsageReservation
  });

  let providerCalls = 0;
  const dispatchAttempts = [];

  const chatService = createChatService({
    getDatabase: () => null,
    getEnvironment: () => ({}),
    getDeepseekKey: () => 'fake-key',
    getDeepseekUrl: () => 'http://provider.local/v1',
    getProxyUrl: () => '',
    POSTGRES_MODE: false,
    getAuthUser: () => ({ user }),
    requireSqliteForPublic: () => true,
    allowChatRate: () => true,
    acquireChatSlot: () => true,
    releaseChatSlot: () => {},
    json: (res, code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    },
    readBody: req => Promise.resolve(req._body),
    respondError: (res, err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    },
    CHAT_MAX_JSON_BODY_BYTES: 64 * 1024,
    nativeSkillCatalog: null,
    appRepository: () => repository,
    recordDispatchAttempt: async input => {
      dispatchAttempts.push(input);
      return repository.recordDispatchAttempt(input);
    },
    projectScope: { stableUserId: email => email },
    isAdminUser: () => false,
    INTERNAL_MODEL_ROUTE_KEY: 'test-route-key',
    INTERNAL_MODEL_ROUTE_HEADER: 'x-internal-route-key',
    generationV2Enabled: false,
    validateChatMessages: msgs => msgs,
    splitDynamicPrompt: msgs => msgs,
    detectNovelStyle: () => null,
    adaptIpContinuationMessages: msgs => msgs,
    DEFAULT_WRITING_SKILL_ID: 'none',
    loadEditorOnlyWritingSkill: () => null,
    ensureEditorOnlyWritingSkill: () => null,
    editorOnlySkillAuditRequest: () => null,
    ensureDefaultWritingSkill: () => null,
    addDefaultWritingSkillAudit: () => {},
    buildSkillAudit: () => ({ status: 'passed', skills: [], forwarding: { skills: [] } }),
    prepareSkillMessagesForUpstream: (_auth, msgs, audit) => ({ messages: msgs, skillAudit: audit }),
    correctionPolicyEnabled: () => false,
    isTwoPassHumanizeEnabled: () => false,
    loadEditorOnlyCorrectionLibrary: () => null,
    CORRECTION_PRIOR_TEXT_MAX_CHARS: 1000,
    lastUserMessageText: () => 'test message',
    injectEditorOnlyCorrectionLibrary: msgs => msgs,
    EDITOR_ONLY_CORRECTION_VERSION: '1.0',
    EDITOR_ONLY_CORRECTION_FILE_DEFAULT: '',
    UNIVERSAL_CORRECTION_POLICY_VERSION: '1.0',
    UNIVERSAL_CORRECTION_STAGES: [],
    injectUniversalCorrectionPolicy: msgs => msgs,
    emptyEditorOnlyCharacterMaterialResult: () => ({ audit: { enabled: false }, messages: [] }),
    buildCharacterMaterialBlock: () => ({ audit: { enabled: false }, messages: [] }),
    isMatureCharacterMaterialEnabledForNovel: () => false,
    reviewCharacterMaterialSamples: () => Promise.resolve({ approvedIds: [], audit: { required: false } }),
    calculateCharacterMaterialRhythmDeviation: () => ({ available: false, exceeded: false }),
    scanCharacterMaterialOverlap: () => ({ blocked: false }),
    injectPromptInjectionGuard: msgs => msgs,
    resolveFingerprintProfile: () => null,
    buildRhythmTargetBlock: () => '',
    appendSystemBlock: (sys, blk) => (sys ? sys + '\n' + blk : blk),
    planContextWindow: () => ({
      ok: true, messages: [{ role: 'user', content: 'hello' }],
      promptTokens: 10, contextWindowTokens: 4096, requestedMaxTokens: 100,
      fixedPromptTokens: 10, originalDynamicPromptTokens: 0, dynamicPromptTokens: 0,
      dynamicPromptBudget: 1000, dynamicPromptTruncated: false, overflowTokens: 0,
      fixedPromptExceeded: false, availableCompletionTokens: 100, cappedByContext: false
    }),
    sanitizeSystemForUpstream: s => s,
    internalModelIdFromRequest: () => 'test-model',
    resolveModelForUser: () => 'test-model',
    findPlatformModel: () => ({
      id: 'test-model',
      name: 'test-model',
      model: 'test-model',
      provider: 'openai-compat',
      apiKey: 'test-key',
      baseURL: 'http://provider.local/v1',
      promptCaching: true,
      promptCacheMode: 'explicit'
    }),
    currentDefaultModel: () => 'test-model',
    buildHumanizePassMessages: () => [],
    mergeUsageSum: (a, b) => ({ totalTokens: (a?.totalTokens || 0) + (b?.totalTokens || 0) }),
    computeAiFlavorScore: () => ({ passed: true, score: 0 }),
    summarizeAiFlavorVerdict: () => ({ passed: true }),
    addPromptCacheBreakpoint: msgs => [{ ...msgs[0], cache_control: { type: 'ephemeral' } }],
    normalizeReasoningEffort: () => null,
    stablePromptCacheKey: () => 'test-cache-key',
    reserveCredits: (u, m, pm, reqId, cost, audit, hash, scope, opts) => billingService.reserveCredits(u, m, pm, reqId, cost, audit, hash, scope, opts),
    planCreditReservation: () => ({ ok: true, reservedCost: 2, maxTokens: 100, reservationTokenLimit: 200, cappedByBalance: false }),
    normalizeUsage: u => ({ totalTokens: u?.total_tokens ?? 20, promptTokens: u?.prompt_tokens ?? 10, completionTokens: u?.completion_tokens ?? 10, cachedTokens: 0, cacheWriteTokens: 0, usageSource: 'upstream' }),
    estimateTextTokenUpperBound: t => String(t || '').length,
    creditCostForUser: (_u, _m, tokens) => tokens / 1000,
    roundCreditValue: x => Math.round(x * 10000) / 10000,
    emptyCorrectionAudit: () => ({ status: 'none' }),
    scanUniversalCorrectionRisks: () => ({ status: 'none' }),
    recordCorrectionHits: () => {},
    settleTokenUsage: ev => billingService.settleTokenUsage(ev),
    openUpstream: (_url, _proxy, options, onUpstream) => {
      providerCalls++;
      const upstream = new EventEmitter();
      upstream.write = () => {};
      upstream.end = () => {};
      upstream.destroy = () => {};
      const upRes = new EventEmitter();
      upRes.setEncoding = () => {};
      if (providerCalls === 1) {
        upRes.statusCode = 400;
        setImmediate(() => {
          onUpstream(null, upstream);
          options.onResponse(upRes);
          upRes.emit('data', 'error: prompt_cache parameter is unsupported by model');
          upRes.emit('end');
        });
      } else {
        upRes.statusCode = 200;
        setImmediate(() => {
          onUpstream(null, upstream);
          options.onResponse(upRes);
          upRes.emit('data', 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'retry success' } }] }) + '\n\n');
          upRes.emit('data', 'data: ' + JSON.stringify({ usage: { total_tokens: 20, prompt_tokens: 10, completion_tokens: 10 } }) + '\n\n');
          upRes.emit('end');
        });
      }
    },
    responseCors: () => ({}),
    UPSTREAM_MAX_RESPONSE_BYTES: 1024 * 1024,
    UPSTREAM_SSE_BUFFER_BYTES: 64 * 1024,
    UPSTREAM_QUALITY_SCAN_MAX_CHARS: 10000,
    UPSTREAM_TOTAL_TIMEOUT_MS: 5000,
    LIVE_BILLING_EVENT_INTERVAL_MS: 1000
  });

  const reqId = 'req_' + 'cace'.padEnd(40, '0');
  const req = fakeRequest({ 'idempotency-key': reqId, 'x-internal-route-key': 'test-route-key' }, { messages: [{ role: 'user', content: 'test' }] });
  const res = fakeResponse();
  chatService.handleChat(req, res);
  await new Promise(resolve => res.on('finish', resolve));

  assert.equal(providerCalls, 2);
  assert.equal(dispatchAttempts.length, 2);
  assert.notEqual(dispatchAttempts[0].attemptId, dispatchAttempts[1].attemptId);
  assert.ok(dispatchAttempts[1].stage.includes('cache_retry'));

  const row = await repository.lookupTokenUsage({ userId: user.userId, requestId: reqId });
  assert.equal(row.attempts.length, 2);
  assert.equal(row.attempts[0].attemptId, dispatchAttempts[0].attemptId);
  assert.equal(row.attempts[1].attemptId, dispatchAttempts[1].attemptId);
});

test('record dispatch rejects settled/released reservations and duplicate attempts do not repeat provider request', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-dispatch-auth-'));
  const repository = new JsonAppRepository(directory);
  t.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const user = await repository.saveAccount({ email: 'authcheck@test.local', userId: 'user-auth-check', role: 'normal', credits: 10 });
  const reqId = 'req_' + 'a074ce00'.padEnd(40, '0');

  await repository.reserveTokenUsage({ userId: user.userId, requestId: reqId, reservedCost: 2 });

  const first = await repository.recordDispatchAttempt({ userId: user.userId, requestId: reqId, attemptId: 'att_auth_1', pass: 1, stage: 'single_pass' });
  assert.equal(first.ok, true);
  assert.equal(first.authorized, true);

  const dup = await repository.recordDispatchAttempt({ userId: user.userId, requestId: reqId, attemptId: 'att_auth_1', pass: 1, stage: 'single_pass' });
  assert.equal(dup.ok, false);
  assert.equal(dup.authorized, false);
  assert.equal(dup.duplicate, true);

  await repository.settleTokenUsage({ userId: user.userId, requestId: reqId, actualCost: 1, outcome: 'succeeded', usage: { totalTokens: 100 } });

  const postSettle = await repository.recordDispatchAttempt({ userId: user.userId, requestId: reqId, attemptId: 'att_auth_2', pass: 2, stage: 'second_pass' });
  assert.equal(postSettle.ok, false);
  assert.equal(postSettle.authorized, false);
  assert.equal(postSettle.status, 'settled');

  // provider_unknown 状态拒绝授权新 attempt
  const reqIdUnknown = 'req_' + 'unkn0000'.padEnd(40, '0');
  await repository.reserveTokenUsage({ userId: user.userId, requestId: reqIdUnknown, reservedCost: 2 });
  await repository.recordDispatchAttempt({ userId: user.userId, requestId: reqIdUnknown, attemptId: 'att_u1', pass: 1, stage: 'single_pass' });
  await repository.holdTokenUsage({ userId: user.userId, requestId: reqIdUnknown });
  const unknownAttempt = await repository.recordDispatchAttempt({ userId: user.userId, requestId: reqIdUnknown, attemptId: 'att_u2', pass: 2, stage: 'second_pass' });
  assert.equal(unknownAttempt.ok, false);
  assert.equal(unknownAttempt.authorized, false);
  assert.equal(unknownAttempt.status, 'provider_unknown');

  // 对已派发/未知的预占，不能通过 outcome: aborted 实施 0 费用退款
  await assert.rejects(
    () => repository.settleTokenUsage({ userId: user.userId, requestId: reqIdUnknown, actualCost: 0, outcome: 'aborted' }),
    /CANNOT_REFUND_DISPATCHED_UNKNOWN/
  );
});

test('reaper only processes truly expired requests, active dispatched cannot be prematurely marked unknown', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-reaper-active-'));
  const repository = new JsonAppRepository(directory);
  t.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const user = await repository.saveAccount({ email: 'reaper@test.local', userId: 'user-reaper', role: 'normal', credits: 10 });
  const reqId = 'req_' + 'ac710000'.padEnd(40, '0');

  await repository.reserveTokenUsage({ userId: user.userId, requestId: reqId, reservedCost: 2 });
  await repository.recordDispatchAttempt({ userId: user.userId, requestId: reqId, attemptId: 'att_active_1', pass: 1, stage: 'single_pass' });

  const prematureReap = await repository.releaseStaleTokenUsage({ before: Date.now() - 60000 });
  assert.equal(prematureReap.released, 0);
  const activeRow = await repository.lookupTokenUsage({ userId: user.userId, requestId: reqId });
  assert.equal(activeRow.status, 'dispatched');

  const staleReap = await repository.releaseStaleTokenUsage({ before: Date.now() + 60000 });
  assert.equal(staleReap.released, 0);
  const staleRow = await repository.lookupTokenUsage({ userId: user.userId, requestId: reqId });
  assert.equal(staleRow.status, 'provider_unknown');
  assert.equal((await repository.getAccount(user.userId)).credits, 8);
});

test('cancellation during dispatch persistence prevents outbound provider call and protects from mis-refund', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-cancel-race-'));
  const repository = new JsonAppRepository(directory);
  t.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const user = await repository.saveAccount({ email: 'cancelrace@test.local', userId: 'user-cancel-race', role: 'normal', credits: 10 });
  const billingService = createNativeBillingService({
    repository,
    isAdminUser: () => false,
    creditCostForUser: (_u, _m, tokens) => tokens / 1000,
    roundCreditValue: x => Math.round(x * 10000) / 10000,
    toTokenCount: v => Number.isSafeInteger(v) && v >= 0 ? v : null,
    matchesTokenUsageReservation
  });

  let providerCalls = 0;
  let dispatchStarted = false;
  let finishDispatch = null;
  const dispatchPromise = new Promise(resolve => { finishDispatch = resolve; });

  const chatService = createChatService({
    getDatabase: () => null,
    getEnvironment: () => ({}),
    getDeepseekKey: () => 'fake-key',
    getDeepseekUrl: () => 'http://provider.local/v1',
    getProxyUrl: () => '',
    POSTGRES_MODE: false,
    getAuthUser: () => ({ user }),
    requireSqliteForPublic: () => true,
    allowChatRate: () => true,
    acquireChatSlot: () => true,
    releaseChatSlot: () => {},
    json: (res, code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    },
    readBody: req => Promise.resolve(req._body),
    respondError: (res, err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    },
    CHAT_MAX_JSON_BODY_BYTES: 64 * 1024,
    nativeSkillCatalog: null,
    appRepository: () => repository,
    recordDispatchAttempt: async input => {
      dispatchStarted = true;
      await dispatchPromise;
      return repository.recordDispatchAttempt(input);
    },
    projectScope: { stableUserId: email => email },
    isAdminUser: () => false,
    INTERNAL_MODEL_ROUTE_KEY: 'test-route-key',
    INTERNAL_MODEL_ROUTE_HEADER: 'x-internal-route-key',
    generationV2Enabled: false,
    validateChatMessages: msgs => msgs,
    splitDynamicPrompt: msgs => msgs,
    detectNovelStyle: () => null,
    adaptIpContinuationMessages: msgs => msgs,
    DEFAULT_WRITING_SKILL_ID: 'none',
    loadEditorOnlyWritingSkill: () => null,
    ensureEditorOnlyWritingSkill: () => null,
    editorOnlySkillAuditRequest: () => null,
    ensureDefaultWritingSkill: () => null,
    addDefaultWritingSkillAudit: () => {},
    buildSkillAudit: () => ({ status: 'passed', skills: [], forwarding: { skills: [] } }),
    prepareSkillMessagesForUpstream: (_auth, msgs, audit) => ({ messages: msgs, skillAudit: audit }),
    correctionPolicyEnabled: () => false,
    isTwoPassHumanizeEnabled: () => false,
    loadEditorOnlyCorrectionLibrary: () => null,
    CORRECTION_PRIOR_TEXT_MAX_CHARS: 1000,
    lastUserMessageText: () => 'test message',
    injectEditorOnlyCorrectionLibrary: msgs => msgs,
    EDITOR_ONLY_CORRECTION_VERSION: '1.0',
    EDITOR_ONLY_CORRECTION_FILE_DEFAULT: '',
    UNIVERSAL_CORRECTION_POLICY_VERSION: '1.0',
    UNIVERSAL_CORRECTION_STAGES: [],
    injectUniversalCorrectionPolicy: msgs => msgs,
    emptyEditorOnlyCharacterMaterialResult: () => ({ audit: { enabled: false }, messages: [] }),
    buildCharacterMaterialBlock: () => ({ audit: { enabled: false }, messages: [] }),
    isMatureCharacterMaterialEnabledForNovel: () => false,
    reviewCharacterMaterialSamples: () => Promise.resolve({ approvedIds: [], audit: { required: false } }),
    calculateCharacterMaterialRhythmDeviation: () => ({ available: false, exceeded: false }),
    scanCharacterMaterialOverlap: () => ({ blocked: false }),
    injectPromptInjectionGuard: msgs => msgs,
    resolveFingerprintProfile: () => null,
    buildRhythmTargetBlock: () => '',
    appendSystemBlock: (sys, blk) => (sys ? sys + '\n' + blk : blk),
    planContextWindow: () => ({
      ok: true, messages: [{ role: 'user', content: 'hello' }],
      promptTokens: 10, contextWindowTokens: 4096, requestedMaxTokens: 100,
      fixedPromptTokens: 10, originalDynamicPromptTokens: 0, dynamicPromptTokens: 0,
      dynamicPromptBudget: 1000, dynamicPromptTruncated: false, overflowTokens: 0,
      fixedPromptExceeded: false, availableCompletionTokens: 100, cappedByContext: false
    }),
    sanitizeSystemForUpstream: s => s,
    internalModelIdFromRequest: () => 'test-model',
    resolveModelForUser: () => 'test-model',
    findPlatformModel: () => ({ id: 'test-model', name: 'test-model', model: 'test-model', provider: 'openai-compat', apiKey: 'test-key', baseURL: 'http://provider.local/v1' }),
    currentDefaultModel: () => 'test-model',
    buildHumanizePassMessages: () => [],
    mergeUsageSum: (a, b) => ({ totalTokens: (a?.totalTokens || 0) + (b?.totalTokens || 0) }),
    computeAiFlavorScore: () => ({ passed: true, score: 0 }),
    summarizeAiFlavorVerdict: () => ({ passed: true }),
    addPromptCacheBreakpoint: msgs => msgs,
    normalizeReasoningEffort: () => null,
    stablePromptCacheKey: () => '',
    reserveCredits: (u, m, pm, reqId, cost, audit, hash, scope, opts) => billingService.reserveCredits(u, m, pm, reqId, cost, audit, hash, scope, opts),
    planCreditReservation: () => ({ ok: true, reservedCost: 2, maxTokens: 100, reservationTokenLimit: 200, cappedByBalance: false }),
    normalizeUsage: u => ({ totalTokens: u?.total_tokens ?? null, promptTokens: u?.prompt_tokens ?? null, completionTokens: u?.completion_tokens ?? null, cachedTokens: 0, cacheWriteTokens: 0, usageSource: 'unavailable' }),
    estimateTextTokenUpperBound: t => String(t || '').length,
    creditCostForUser: () => 1,
    roundCreditValue: x => x,
    emptyCorrectionAudit: () => ({ status: 'none' }),
    scanUniversalCorrectionRisks: () => ({ status: 'none' }),
    recordCorrectionHits: () => {},
    settleTokenUsage: ev => billingService.settleTokenUsage(ev),
    openUpstream: () => { providerCalls++; },
    responseCors: () => ({}),
    UPSTREAM_MAX_RESPONSE_BYTES: 1024 * 1024,
    UPSTREAM_SSE_BUFFER_BYTES: 64 * 1024,
    UPSTREAM_QUALITY_SCAN_MAX_CHARS: 10000,
    UPSTREAM_TOTAL_TIMEOUT_MS: 5000,
    LIVE_BILLING_EVENT_INTERVAL_MS: 1000
  });

  const reqId = 'req_' + 'c0a1ce'.padEnd(40, '0');
  const req = fakeRequest({ 'idempotency-key': reqId, 'x-internal-route-key': 'test-route-key' }, { messages: [{ role: 'user', content: 'hello' }] });
  const res = fakeResponse();

  chatService.handleChat(req, res);

  const waitDeadline = Date.now() + 5000;
  while (!dispatchStarted && Date.now() < waitDeadline) {
    await new Promise(r => setImmediate(r));
  }
  assert.equal(dispatchStarted, true, 'Dispatch persistence must start within bounded wait');

  req.emit('aborted');
  finishDispatch();

  let row = null;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    row = await repository.lookupTokenUsage({ userId: user.userId, requestId: reqId });
    if (row && row.status === 'provider_unknown') break;
    await new Promise(r => setTimeout(r, 10));
  }

  assert.equal(providerCalls, 0, 'Upstream must NEVER be called if aborted during dispatch persistence');
  assert.equal(row && row.status, 'provider_unknown', 'Dispatch attempt persisted before abort must be held as provider_unknown');
  assert.equal((await repository.getAccount(user.userId)).credits, 8, 'Reservation held, no erroneous refund');
});

test('synchronous openUpstream throw is safely caught and protected as unknown without unhandled crash', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-sync-throw-'));
  const repository = new JsonAppRepository(directory);
  t.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const user = await repository.saveAccount({ email: 'syncthrow@test.local', userId: 'user-sync-throw', role: 'normal', credits: 10 });
  const billingService = createNativeBillingService({
    repository,
    isAdminUser: () => false,
    creditCostForUser: (_u, _m, tokens) => tokens / 1000,
    roundCreditValue: x => Math.round(x * 10000) / 10000,
    toTokenCount: v => Number.isSafeInteger(v) && v >= 0 ? v : null,
    matchesTokenUsageReservation
  });

  const chatService = createChatService({
    getDatabase: () => null,
    getEnvironment: () => ({}),
    getDeepseekKey: () => 'fake-key',
    getDeepseekUrl: () => 'http://provider.local/v1',
    getProxyUrl: () => '',
    POSTGRES_MODE: false,
    getAuthUser: () => ({ user }),
    requireSqliteForPublic: () => true,
    allowChatRate: () => true,
    acquireChatSlot: () => true,
    releaseChatSlot: () => {},
    json: (res, code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    },
    readBody: req => Promise.resolve(req._body),
    respondError: (res, err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    },
    CHAT_MAX_JSON_BODY_BYTES: 64 * 1024,
    nativeSkillCatalog: null,
    appRepository: () => repository,
    recordDispatchAttempt: input => repository.recordDispatchAttempt(input),
    projectScope: { stableUserId: email => email },
    isAdminUser: () => false,
    INTERNAL_MODEL_ROUTE_KEY: 'test-route-key',
    INTERNAL_MODEL_ROUTE_HEADER: 'x-internal-route-key',
    generationV2Enabled: false,
    validateChatMessages: msgs => msgs,
    splitDynamicPrompt: msgs => msgs,
    detectNovelStyle: () => null,
    adaptIpContinuationMessages: msgs => msgs,
    DEFAULT_WRITING_SKILL_ID: 'none',
    loadEditorOnlyWritingSkill: () => null,
    ensureEditorOnlyWritingSkill: () => null,
    editorOnlySkillAuditRequest: () => null,
    ensureDefaultWritingSkill: () => null,
    addDefaultWritingSkillAudit: () => {},
    buildSkillAudit: () => ({ status: 'passed', skills: [], forwarding: { skills: [] } }),
    prepareSkillMessagesForUpstream: (_auth, msgs, audit) => ({ messages: msgs, skillAudit: audit }),
    correctionPolicyEnabled: () => false,
    isTwoPassHumanizeEnabled: () => false,
    loadEditorOnlyCorrectionLibrary: () => null,
    CORRECTION_PRIOR_TEXT_MAX_CHARS: 1000,
    lastUserMessageText: () => 'test message',
    injectEditorOnlyCorrectionLibrary: msgs => msgs,
    EDITOR_ONLY_CORRECTION_VERSION: '1.0',
    EDITOR_ONLY_CORRECTION_FILE_DEFAULT: '',
    UNIVERSAL_CORRECTION_POLICY_VERSION: '1.0',
    UNIVERSAL_CORRECTION_STAGES: [],
    injectUniversalCorrectionPolicy: msgs => msgs,
    emptyEditorOnlyCharacterMaterialResult: () => ({ audit: { enabled: false }, messages: [] }),
    buildCharacterMaterialBlock: () => ({ audit: { enabled: false }, messages: [] }),
    isMatureCharacterMaterialEnabledForNovel: () => false,
    reviewCharacterMaterialSamples: () => Promise.resolve({ approvedIds: [], audit: { required: false } }),
    calculateCharacterMaterialRhythmDeviation: () => ({ available: false, exceeded: false }),
    scanCharacterMaterialOverlap: () => ({ blocked: false }),
    injectPromptInjectionGuard: msgs => msgs,
    resolveFingerprintProfile: () => null,
    buildRhythmTargetBlock: () => '',
    appendSystemBlock: (sys, blk) => (sys ? sys + '\n' + blk : blk),
    planContextWindow: () => ({
      ok: true, messages: [{ role: 'user', content: 'hello' }],
      promptTokens: 10, contextWindowTokens: 4096, requestedMaxTokens: 100,
      fixedPromptTokens: 10, originalDynamicPromptTokens: 0, dynamicPromptTokens: 0,
      dynamicPromptBudget: 1000, dynamicPromptTruncated: false, overflowTokens: 0,
      fixedPromptExceeded: false, availableCompletionTokens: 100, cappedByContext: false
    }),
    sanitizeSystemForUpstream: s => s,
    internalModelIdFromRequest: () => 'test-model',
    resolveModelForUser: () => 'test-model',
    findPlatformModel: () => ({ id: 'test-model', name: 'test-model', model: 'test-model', provider: 'openai-compat', apiKey: 'test-key', baseURL: 'http://provider.local/v1' }),
    currentDefaultModel: () => 'test-model',
    buildHumanizePassMessages: () => [],
    mergeUsageSum: (a, b) => ({ totalTokens: (a?.totalTokens || 0) + (b?.totalTokens || 0) }),
    computeAiFlavorScore: () => ({ passed: true, score: 0 }),
    summarizeAiFlavorVerdict: () => ({ passed: true }),
    addPromptCacheBreakpoint: msgs => msgs,
    normalizeReasoningEffort: () => null,
    stablePromptCacheKey: () => '',
    reserveCredits: (u, m, pm, reqId, cost, audit, hash, scope, opts) => billingService.reserveCredits(u, m, pm, reqId, cost, audit, hash, scope, opts),
    planCreditReservation: () => ({ ok: true, reservedCost: 2, maxTokens: 100, reservationTokenLimit: 200, cappedByBalance: false }),
    normalizeUsage: u => ({ totalTokens: u?.total_tokens ?? null, promptTokens: u?.prompt_tokens ?? null, completionTokens: u?.completion_tokens ?? null, cachedTokens: 0, cacheWriteTokens: 0, usageSource: 'unavailable' }),
    estimateTextTokenUpperBound: t => String(t || '').length,
    creditCostForUser: () => 1,
    roundCreditValue: x => x,
    emptyCorrectionAudit: () => ({ status: 'none' }),
    scanUniversalCorrectionRisks: () => ({ status: 'none' }),
    recordCorrectionHits: () => {},
    settleTokenUsage: ev => billingService.settleTokenUsage(ev),
    openUpstream: () => {
      throw new Error('NETWORK_INTERFACE_DOWN: immediate socket creation failed');
    },
    responseCors: () => ({}),
    UPSTREAM_MAX_RESPONSE_BYTES: 1024 * 1024,
    UPSTREAM_SSE_BUFFER_BYTES: 64 * 1024,
    UPSTREAM_QUALITY_SCAN_MAX_CHARS: 10000,
    UPSTREAM_TOTAL_TIMEOUT_MS: 5000,
    LIVE_BILLING_EVENT_INTERVAL_MS: 1000
  });

  const reqId = 'req_' + '574c7400'.padEnd(40, '0');
  const req = fakeRequest({ 'idempotency-key': reqId, 'x-internal-route-key': 'test-route-key' }, { messages: [{ role: 'user', content: 'hello' }] });
  const res = fakeResponse();

  chatService.handleChat(req, res);
  await new Promise(resolve => res.on('finish', resolve));

  assert.equal(res.statusCode, 502);

  let row = null;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    row = await repository.lookupTokenUsage({ userId: user.userId, requestId: reqId });
    if (row && row.status === 'provider_unknown') break;
    await new Promise(r => setTimeout(r, 10));
  }

  assert.equal(row && row.status, 'provider_unknown', 'Synchronous throw after dispatch must be held as provider_unknown');
  assert.equal((await repository.getAccount(user.userId)).credits, 8, 'Reservation held, not prematurely refunded');
});

test('JSON repo regression: cutoff recovery branch, cross-instance lease protection, expired recovery, and refund bypass prevention', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-json-regression-'));
  const repository = new JsonAppRepository(directory);
  t.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const user = await repository.saveAccount({ email: 'jsonreg@test.local', userId: 'user-json-reg', role: 'normal', credits: 10 });
  const scope = '__molan_usage_' + crypto.createHash('sha256').update(String(user.userId)).digest('hex');
  const now = Date.now();

  // 1. 实际触发 cutoff 恢复分支：有 cutoff 时 rowTime 正确识别
  const reqOld = 'req_' + '01d00000'.padEnd(40, '0');
  await repository.reserveTokenUsage({ userId: user.userId, requestId: reqOld, reservedCost: 2 });
  await repository.recordDispatchAttempt({ userId: user.userId, requestId: reqOld, instanceId: 'inst_local', attemptId: 'att_old', pass: 1 });
  // 人工修改其 updatedAt 为 60s 前
  await repository.repository.transaction([scope], tx => {
    const row = tx.get(scope, 'generation', `reservation:${reqOld}`);
    tx.put(scope, 'generation', { ...row, updatedAt: now - 60000 }, row.revision);
  });

  const reqRecent = 'req_' + 'rec00000'.padEnd(40, '0');
  await repository.reserveTokenUsage({ userId: user.userId, requestId: reqRecent, reservedCost: 2 });
  await repository.recordDispatchAttempt({ userId: user.userId, requestId: reqRecent, instanceId: 'inst_local', attemptId: 'att_rec', pass: 1 });
  await repository.repository.transaction([scope], tx => {
    const row = tx.get(scope, 'generation', `reservation:${reqRecent}`);
    tx.put(scope, 'generation', { ...row, updatedAt: now - 10000 }, row.revision);
  });

  const cutoffResult = await repository.recoverInterruptedUsage({
    instanceId: 'inst_local',
    cutoff: now - 30000
  });
  assert.equal(cutoffResult.recovered, 1);
  assert.equal((await repository.lookupTokenUsage({ userId: user.userId, requestId: reqOld })).status, 'provider_unknown');
  assert.equal((await repository.lookupTokenUsage({ userId: user.userId, requestId: reqRecent })).status, 'dispatched');

  // 将 reqRecent 正常结算，以便后续步骤专注测试跨实例隔离
  await repository.settleTokenUsage({
    userId: user.userId, requestId: reqRecent, actualCost: 1,
    outcome: 'succeeded', usage: { totalTokens: 100 }
  });

  // 2. 跨实例活动保护与 reaper lease：未过期其他实例不被覆盖
  const reqRemote = 'req_' + 'rem00000'.padEnd(40, '0');
  await repository.reserveTokenUsage({ userId: user.userId, requestId: reqRemote, reservedCost: 2 });
  await repository.recordDispatchAttempt({
    userId: user.userId,
    requestId: reqRemote,
    instanceId: 'inst_remote',
    attemptId: 'att_remote',
    pass: 1,
    leaseMs: 300000
  });
  await repository.repository.transaction([scope], tx => {
    const row = tx.get(scope, 'generation', `reservation:${reqRemote}`);
    tx.put(scope, 'generation', { ...row, updatedAt: now - 60000 }, row.revision);
  });

  const recoverOther = await repository.recoverInterruptedUsage({
    instanceId: 'inst_local',
    cutoff: now + 100000
  });
  assert.equal(recoverOther.recovered, 0);
  assert.equal((await repository.lookupTokenUsage({ userId: user.userId, requestId: reqRemote })).status, 'dispatched');

  const reapOther = await repository.releaseStaleTokenUsage({
    instanceId: 'inst_local',
    before: now + 100000
  });
  assert.equal(reapOther.released, 0);
  assert.equal((await repository.lookupTokenUsage({ userId: user.userId, requestId: reqRemote })).status, 'dispatched');

  // 3. 过期恢复：租约过期后正常恢复
  await repository.repository.transaction([scope], tx => {
    const row = tx.get(scope, 'generation', `reservation:${reqRemote}`);
    tx.put(scope, 'generation', { ...row, leaseUntil: now - 5000 }, row.revision);
  });
  const expiredRecover = await repository.recoverInterruptedUsage({
    instanceId: 'inst_local',
    cutoff: now
  });
  assert.equal(expiredRecover.recovered, 1);
  assert.equal((await repository.lookupTokenUsage({ userId: user.userId, requestId: reqRemote })).status, 'provider_unknown');

  // 4. null / 空串 / 布尔 / 正金额退款绕过拦截
  const reqBypass = 'req_' + 'byp00000'.padEnd(40, '0');
  await repository.reserveTokenUsage({ userId: user.userId, requestId: reqBypass, reservedCost: 2 });
  await repository.recordDispatchAttempt({ userId: user.userId, requestId: reqBypass, instanceId: 'inst_local', attemptId: 'att_byp', pass: 1 });
  const creditsBeforeBypass = (await repository.getAccount(user.userId)).credits;

  for (const bypassUsage of [
    { totalTokens: null },
    { totalTokens: '' },
    { totalTokens: '   ' },
    { totalTokens: false },
    { totalTokens: true },
    {}
  ]) {
    // 0 费用 aborted 或正金额 0.5 结算，在无完整证据时均必须被仓储拒绝
    await assert.rejects(
      () => repository.settleTokenUsage({ userId: user.userId, requestId: reqBypass, actualCost: 0, outcome: 'aborted', usage: bypassUsage }),
      /CANNOT_REFUND_DISPATCHED_UNKNOWN/
    );
    await assert.rejects(
      () => repository.settleTokenUsage({ userId: user.userId, requestId: reqBypass, actualCost: 0.5, outcome: 'succeeded', usage: bypassUsage }),
      /CANNOT_REFUND_DISPATCHED_UNKNOWN/
    );
    assert.equal((await repository.getAccount(user.userId)).credits, creditsBeforeBypass);
  }

  // 5. 明确整数/数值字符串完整证据结算及幂等
  const settleRes = await repository.settleTokenUsage({
    userId: user.userId,
    requestId: reqBypass,
    actualCost: 0.5,
    outcome: 'succeeded',
    usage: { totalTokens: '100', promptTokens: '80', completionTokens: '20' }
  });
  assert.equal(settleRes.actualCost, 0.5);
  assert.equal(settleRes.idempotent, false);
  assert.equal((await repository.getAccount(user.userId)).credits, creditsBeforeBypass + 1.5);

  const replayRes = await repository.settleTokenUsage({
    userId: user.userId,
    requestId: reqBypass,
    actualCost: 0.5,
    outcome: 'succeeded',
    usage: { totalTokens: '100', promptTokens: '80', completionTokens: '20' }
  });
  assert.equal(replayRes.idempotent, true);
  assert.equal(replayRes.actualCost, 0.5);
  assert.equal((await repository.getAccount(user.userId)).credits, creditsBeforeBypass + 1.5);
});
