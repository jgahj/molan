'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createGenerationHandlers } = require('../routes/generation-handlers');
const { createGenerationRoutes } = require('../routes/generation');

test('createGenerationHandlers: models, billing, health and webchat behave correctly', async () => {
  let adjustedCredits = 0;
  let chatCalled = false;

  const mockDb = {
    prepare: (sql) => {
      if (sql.includes('UPDATE accounts SET credits')) {
        return { run: (credits) => { adjustedCredits += credits; } };
      }
      if (sql.includes('SELECT COUNT(*) AS n FROM novels')) {
        return { get: () => ({ n: 42 }) };
      }
      return { run: () => {}, get: () => ({}) };
    }
  };

  let currentBody = {};
  const deps = {
    json: (_res, status, body) => ({ status, body }),
    readBody: async () => currentBody,
    respondError: (_res, err) => ({ status: 500, error: err }),
    respondPostgresError: (_res, err) => ({ status: 500, error: err }),
    requestError: (status, msg) => {
      const err = new Error(msg);
      err.status = status;
      return err;
    },
    getAuthUser: () => ({ user: { userId: 'u1', email: 'user@test.local', role: 'user' } }),
    isAdminUser: () => false,
    normalizeUserRole: () => 'user',
    canChooseModel: () => true,
    currentDefaultModel: () => 'gpt-5.6-luna',
    PLATFORM_MODELS: [
      { id: 'm1', name: 'Luna', provider: 'openai', model: 'gpt-5.6-luna', supportsThinking: true, supportsReasoning: true, promptCaching: true }
    ],
    loadPlatformModels: () => [],
    reasoningEffortsForModel: () => ['low', 'high'],
    contextWindowTokensForModel: () => 128000,
    estimateBillingForUser: (_user, body) => ({ tokens: 2000, credits: 2, model: body.model }),
    PUBLIC_MODE: false,
    POSTGRES_MODE: false,
    dbReady: () => true,
    getDatabase: () => mockDb,
    getUserByEmail: () => ({ email: 'user@test.local', credits: 1000 }),
    publicUser: u => ({ email: u.email, credits: u.credits }),
    chatAdmission: { activeCount: () => 3 },
    postgresHealth: { available: true },
    DEEPSEEK_KEY: 'test-key',
    chatHandler: () => { chatCalled = true; return { ok: true }; },
    benchmarkHandler: () => ({ benchmark: true }),
    generationRunsHandler: async () => ({ runs: true }),
    generationRunErrorHandler: () => {},
    legacyGenerationChatHandler: () => {}
  };

  const handlers = createGenerationHandlers(deps);
  assert.equal(typeof handlers.handleModels, 'function');
  assert.equal(typeof handlers.handleBillingEstimate, 'function');
  assert.equal(typeof handlers.handleBillingTopup, 'function');
  assert.equal(typeof handlers.handleHealth, 'function');
  assert.equal(typeof handlers.handleWebChat, 'function');
  assert.equal(typeof handlers.handleWebChatStatus, 'function');
  assert.equal(typeof handlers.handleChat, 'function');

  // 1. Models
  const modelsRes = handlers.handleModels({}, {});
  assert.equal(modelsRes.status, 200);
  assert.equal(modelsRes.body.models.length, 1);
  assert.equal(modelsRes.body.models[0].id, 'm1');
  assert.equal(modelsRes.body.access.defaultModel, 'gpt-5.6-luna');

  // 2. Billing Estimate
  currentBody = { model: 'm1', prompt: '写一段故事' };
  const estRes = await handlers.handleBillingEstimate({}, {});
  assert.equal(estRes.status, 200);
  assert.equal(estRes.body.credits, 2);

  // 3. Billing Topup
  currentBody = { credits: 1000 };
  const topupRes = await handlers.handleBillingTopup({}, {});
  assert.equal(topupRes.status, 200);
  assert.equal(topupRes.body.credits, 1000);
  assert.equal(adjustedCredits, 1000);

  // 4. Health
  const healthRes = await handlers.handleHealth({}, {});
  assert.equal(healthRes.status, 200);
  assert.equal(healthRes.body.ok, true);
  assert.equal(healthRes.body.db, 'ready');
  assert.equal(healthRes.body.activeChatStreams, 3);

  // 5. WebChat (410 deprecated)
  const webChatRes = handlers.handleWebChat({}, {});
  assert.equal(webChatRes.status, 410);

  const webChatStatusRes = handlers.handleWebChatStatus({}, {});
  assert.equal(webChatStatusRes.status, 200);
  assert.equal(webChatStatusRes.body.available, false);

  // 6. Chat delegation
  handlers.handleChat({}, {});
  assert.equal(chatCalled, true);
});

test('createGenerationRoutes integrates cleanly with generationHandlers', async () => {
  const dispatched = [];
  const mockHandlers = {
    chat: () => { dispatched.push('chat'); },
    models: () => { dispatched.push('models'); },
    billingEstimate: () => { dispatched.push('billingEstimate'); },
    billingTopup: () => { dispatched.push('billingTopup'); },
    health: async () => { dispatched.push('health'); },
    webChat: () => { dispatched.push('webChat'); },
    webChatStatus: () => { dispatched.push('webChatStatus'); },
    benchmark: () => { dispatched.push('benchmark'); },
    generationRuns: async () => { dispatched.push('generationRuns'); },
    generationRunError: () => {},
    legacyGenerationChat: {}
  };

  const routes = createGenerationRoutes(mockHandlers);

  assert.equal(routes.dispatchBeforeProxy({}, {}, '/api/benchmark/run'), true);
  assert.equal(routes.dispatchBeforeProxy({}, {}, '/api/generation-runs'), true);

  assert.equal(await routes.dispatchCore({ method: 'POST' }, {}, '/api/chat'), true);
  assert.equal(await routes.dispatchCore({ method: 'GET' }, {}, '/api/models'), true);
  assert.equal(await routes.dispatchCore({ method: 'POST' }, {}, '/api/billing/estimate'), true);
  assert.equal(await routes.dispatchCore({ method: 'POST' }, {}, '/api/billing/topup'), true);
  assert.equal(await routes.dispatchCore({ method: 'GET' }, {}, '/api/health'), true);

  assert.equal(routes.dispatchWebChat({ method: 'POST' }, {}, '/api/web-chat'), true);
  assert.equal(routes.dispatchWebChat({ method: 'GET' }, {}, '/api/web-chat/status'), true);

  assert.deepEqual(dispatched, [
    'benchmark', 'generationRuns',
    'chat', 'models', 'billingEstimate', 'billingTopup', 'health',
    'webChat', 'webChatStatus'
  ]);
});
