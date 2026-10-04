'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const configPath = path.join(__dirname, '..', 'data', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

test('Gemini upstream models configured correctly in data/config.json', () => {
  const geminiModels = config.platformModels.filter(m => m.group === 'gemini');
  assert.equal(geminiModels.length, 4, '必须配置 4 个 Gemini 平台模型');

  const expectedIds = ['gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash', 'gemini-3.1-pro'];
  for (const id of expectedIds) {
    const item = geminiModels.find(m => m.id === id);
    assert.ok(item, `必须包含平台模型 ${id}`);
    assert.equal(item.baseURL, 'http://8.138.128.184:8080/v1');
    assert.equal(item.apiKey, 'sk-b9d518af8735cb46b0c173b63ff5363df21c85394890ba3e7fd47e7b3d127b9c');
    assert.equal(item.provider, 'openai-compat');
    assert.equal(item.contextWindowTokens, 1000000);
    assert.equal(item.supportsReasoning, true);
    assert.equal(item.supportsThinking, true);
    assert.deepEqual(item.reasoningEfforts, ['low', 'medium', 'high'], `${id} 必须配置 3 档思考强度 ['low', 'medium', 'high']`);
  }
});

test('Gemini reasoning efforts and upstream model resolution', () => {
  const { reasoningEffortsForModel, normalizeReasoningEffort } = require('../server');
  const { resolveUpstreamModelForReasoning } = require('../services/chat-service');

  const flash38 = { id: 'gemini-3.8-flash', group: 'gemini', supportsReasoning: true };
  const pro31 = { id: 'gemini-3.1-pro', group: 'gemini', supportsReasoning: true };
  const nonGemini = { id: 'gpt-6-luna', group: 'gpt', model: 'gpt-6-luna', supportsReasoning: true };

  // 1. Verify 3-tier efforts for Gemini
  assert.deepEqual(reasoningEffortsForModel(flash38), ['low', 'medium', 'high']);
  assert.deepEqual(reasoningEffortsForModel(pro31), ['low', 'medium', 'high']);

  // 2. Normalization: none maps to low for Gemini
  assert.equal(normalizeReasoningEffort(flash38, 'none'), 'low');
  assert.equal(normalizeReasoningEffort(flash38, 'low'), 'low');
  assert.equal(normalizeReasoningEffort(flash38, 'medium'), 'medium');
  assert.equal(normalizeReasoningEffort(flash38, 'high'), 'high');
  assert.throws(() => normalizeReasoningEffort(flash38, 'max'), /当前模型支持的推理强度为/);

  // 3. Dynamic upstream model mapping
  assert.equal(resolveUpstreamModelForReasoning(flash38, 'low'), 'gemini-3.8-flash-low');
  assert.equal(resolveUpstreamModelForReasoning(flash38, 'medium'), 'gemini-3.8-flash-medium');
  assert.equal(resolveUpstreamModelForReasoning(flash38, 'high'), 'gemini-3.8-flash-high');
  assert.equal(resolveUpstreamModelForReasoning(flash38, null), 'gemini-3.8-flash-medium');

  // 3.1 Pro: medium maps to high since sub2api has low and high
  assert.equal(resolveUpstreamModelForReasoning(pro31, 'low'), 'gemini-3.1-pro-low');
  assert.equal(resolveUpstreamModelForReasoning(pro31, 'medium'), 'gemini-3.1-pro-high');
  assert.equal(resolveUpstreamModelForReasoning(pro31, 'high'), 'gemini-3.1-pro-high');

  // If model already had -high suffix in config, it correctly strips and re-appends
  const flash37WithSuffix = { id: 'gemini-3.7-flash', model: 'gemini-3.7-flash-high', group: 'gemini', supportsReasoning: true };
  assert.equal(resolveUpstreamModelForReasoning(flash37WithSuffix, 'low'), 'gemini-3.7-flash-low');
  assert.equal(resolveUpstreamModelForReasoning(flash37WithSuffix, 'medium'), 'gemini-3.7-flash-medium');
  assert.equal(resolveUpstreamModelForReasoning(flash37WithSuffix, 'high'), 'gemini-3.7-flash-high');

  // Non-gemini passes through unchanged
  assert.equal(resolveUpstreamModelForReasoning(nonGemini, 'high'), 'gpt-6-luna');
});

test('Server model selection service resolves Gemini models and aliases', () => {
  const { findPlatformModel, resolveModelForUser, canChooseModel } = require('../server');
  
  const vipUser = { email: 'vip@test.com', role: 'vip' };
  assert.ok(canChooseModel(vipUser));

  // Canonical resolution
  assert.equal(resolveModelForUser(vipUser, 'gemini-3.6-flash'), 'gemini-3.6-flash');
  assert.equal(resolveModelForUser(vipUser, 'gemini-3.7-flash'), 'gemini-3.7-flash');
  assert.equal(resolveModelForUser(vipUser, 'gemini-3.8-flash'), 'gemini-3.8-flash');
  assert.equal(resolveModelForUser(vipUser, 'gemini-3.1-pro'), 'gemini-3.1-pro');

  // Alias resolution
  assert.equal(resolveModelForUser(vipUser, 'gemini3.6f'), 'gemini-3.6-flash');
  assert.equal(resolveModelForUser(vipUser, 'gemini-3.6f'), 'gemini-3.6-flash');
  assert.equal(resolveModelForUser(vipUser, 'gemini3.7f'), 'gemini-3.7-flash');
  assert.equal(resolveModelForUser(vipUser, 'gemini3.8f'), 'gemini-3.8-flash');
  assert.equal(resolveModelForUser(vipUser, 'gemini3.1pro'), 'gemini-3.1-pro');
  assert.equal(resolveModelForUser(vipUser, '3.1pro'), 'gemini-3.1-pro');

  // Direct lookup
  const pm = findPlatformModel('gemini3.7f');
  assert.ok(pm);
  assert.equal(pm.id, 'gemini-3.7-flash');
  assert.equal(pm.baseURL, 'http://8.138.128.184:8080/v1');
});

test('p.orschefky8@gmail.com is recognized as configured admin and can choose models', () => {
  const { isAdminUser, normalizeUserRole, canChooseModel } = require('../server');
  const user = { email: 'p.orschefky8@gmail.com' };
  assert.ok(isAdminUser(user), 'p.orschefky8@gmail.com 必须为管理员');
  assert.equal(normalizeUserRole(user), 'admin', '角色必须为 admin');
  assert.ok(canChooseModel(user), '管理员必须可以选择模型');
});

test('chat-service does not call db.prepare when in PostgreSQL mode and db is null', async () => {
  const { createChatService } = require('../services/chat-service');
  let prepareCalled = false;
  let getProjectAccessCalled = false;
  
  const mockPostgresRepo = {
    getProjectAccess: async (userId, projectId) => {
      getProjectAccessCalled = true;
      return {
        workspace_id: 'ws_test',
        project_id: projectId,
        owner_user_id: userId,
        role: 'owner',
        active: true,
        can_spend: true,
        can_export: true
      };
    }
  };

  const service = createChatService({
    getDatabase: () => null,
    getEnvironment: () => ({ MOLAN_APP_STORE: 'postgres' }),
    getDeepseekKey: () => 'mock-key',
    getDeepseekUrl: () => 'https://mock.url',
    getProxyUrl: () => '',
    POSTGRES_MODE: true,
    postgresRepository: mockPostgresRepo,
    postgresActor: auth => auth.user.userId,
    getAuthUser: () => ({ user: { userId: 'usr_test', email: 'p.orschefky8@gmail.com' } }),
    requireSqliteForPublic: () => true,
    allowChatRate: () => true,
    acquireChatSlot: () => true,
    releaseChatSlot: () => {},
    json: (res, code, data) => { res.statusCode = code; res.body = data; },
    readBody: async () => ({ projectId: 'proj_test', messages: [{ role: 'user', content: 'test' }] }),
    respondError: () => {},
    CHAT_MAX_JSON_BODY_BYTES: 1024 * 1024,
    nativeSkillCatalog: async () => null,
    appRepository: () => null,
    projectScope: require('../lib/project-scope'),
    isAdminUser: () => true,
    INTERNAL_MODEL_ROUTE_KEY: '',
    INTERNAL_MODEL_ROUTE_HEADER: '',
    generationV2Enabled: () => false,
    validateChatMessages: () => [{ role: 'user', content: 'test' }],
    splitDynamicPrompt: () => ({}),
    detectNovelStyle: () => ({}),
    adaptIpContinuationMessages: () => [],
    DEFAULT_WRITING_SKILL_ID: 'writing',
    loadEditorOnlyWritingSkill: () => null,
    ensureEditorOnlyWritingSkill: () => ({}),
    editorOnlySkillAuditRequest: () => ({}),
    ensureDefaultWritingSkill: () => ({}),
    addDefaultWritingSkillAudit: () => ({}),
    buildSkillAudit: () => ({}),
    prepareSkillMessagesForUpstream: () => [],
    correctionPolicyEnabled: () => false,
    isTwoPassHumanizeEnabled: () => false,
    loadEditorOnlyCorrectionLibrary: () => null,
    CORRECTION_PRIOR_TEXT_MAX_CHARS: 1000,
    lastUserMessageText: () => '',
    injectEditorOnlyCorrectionLibrary: () => [],
    EDITOR_ONLY_CORRECTION_VERSION: '1.0',
    EDITOR_ONLY_CORRECTION_FILE_DEFAULT: '',
    UNIVERSAL_CORRECTION_POLICY_VERSION: '1.0',
    UNIVERSAL_CORRECTION_STAGES: [],
    injectUniversalCorrectionPolicy: () => [],
    emptyEditorOnlyCharacterMaterialResult: () => ({}),
    buildCharacterMaterialBlock: () => '',
    isMatureCharacterMaterialEnabledForNovel: () => false,
    reviewCharacterMaterialSamples: async () => ({}),
    calculateCharacterMaterialRhythmDeviation: () => 0,
    scanCharacterMaterialOverlap: () => ({}),
    injectPromptInjectionGuard: () => [],
    resolveFingerprintProfile: () => null,
    buildRhythmTargetBlock: () => '',
    appendSystemBlock: () => [],
    planContextWindow: () => 4096,
    sanitizeSystemForUpstream: () => '',
    internalModelIdFromRequest: () => '',
    resolveModelForUser: () => 'gemini-3.6-flash',
    findPlatformModel: id => ({ id, model: id, baseURL: 'http://8.138.128.184:8080/v1', apiKey: 'mock' }),
    currentDefaultModel: () => 'gemini-3.6-flash',
    buildHumanizePassMessages: () => [],
    mergeUsageSum: () => ({}),
    computeAiFlavorScore: () => 0,
    summarizeAiFlavorVerdict: () => ({}),
    addPromptCacheBreakpoint: () => [],
    normalizeReasoningEffort: () => 'medium',
    stablePromptCacheKey: () => 'cache-key',
    reserveCredits: async () => ({ ok: true }),
    planCreditReservation: () => 0,
    normalizeUsage: () => ({}),
    estimateTextTokenUpperBound: () => 100,
    creditCostForUser: () => 0,
    roundCreditValue: v => v,
    emptyCorrectionAudit: () => ({}),
    scanUniversalCorrectionRisks: () => ({}),
    recordCorrectionHits: () => {},
    settleTokenUsage: async () => ({ ok: true }),
    openUpstream: () => {},
    responseCors: () => {},
    UPSTREAM_MAX_RESPONSE_BYTES: 1024 * 1024,
    UPSTREAM_SSE_BUFFER_BYTES: 1024,
    UPSTREAM_QUALITY_SCAN_MAX_CHARS: 1024,
    UPSTREAM_TOTAL_TIMEOUT_MS: 30000,
    LIVE_BILLING_EVENT_INTERVAL_MS: 1000,
    recordDispatchAttempt: () => {}
  });

  const req = { headers: {} };
  const res = { setHeader: () => {}, writeHead: () => {}, end: () => {} };
  
  // Call handleChat - should resolve access via postgresRepository without touching db.prepare
  await service.handleChat(req, res);
  assert.ok(getProjectAccessCalled, '必须通过 postgresRepository 取得项目权限');
});

