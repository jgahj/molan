'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const configPath = path.join(__dirname, '..', 'data', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

test('Grok models configured correctly in data/config.json', () => {
  const grokModels = config.platformModels.filter(m => m.group === 'grok');
  assert.equal(grokModels.length, 2, '必须配置 2 个 Grok 平台模型');

  const g45 = grokModels.find(m => m.id === 'grok-4.5');
  assert.ok(g45, '必须包含 grok-4.5');
  assert.equal(g45.baseURL, 'https://8888.name/v1');
  assert.equal(g45.apiKey, 'sk-9bb77996e9133a97efe77c8c1796483d66d754a7f14298ab61fcd8027e7da4a8');
  assert.equal(g45.provider, 'openai-compat');
  assert.equal(g45.supportsReasoning, true);
  assert.deepEqual(g45.reasoningEfforts, ['low', 'medium', 'high']);

  const g46 = grokModels.find(m => m.id === 'grok-4.6');
  assert.ok(g46, '必须包含 grok-4.6');
  assert.equal(g46.baseURL, 'https://8888.name/v1');
  assert.equal(g46.apiKey, 'sk-9bb77996e9133a97efe77c8c1796483d66d754a7f14298ab61fcd8027e7da4a8');
  assert.equal(g46.provider, 'openai-compat');
  assert.equal(g46.supportsReasoning, true);
  assert.deepEqual(g46.reasoningEfforts, ['low', 'medium', 'high', 'xhigh']);
});

test('Server model selection service resolves Grok models and aliases', () => {
  const { findPlatformModel, resolveModelForUser, canChooseModel, reasoningEffortsForModel, normalizeReasoningEffort } = require('../server');
  
  const vipUser = { email: 'vip@test.com', role: 'vip' };
  assert.ok(canChooseModel(vipUser));

  // Canonical resolution
  assert.equal(resolveModelForUser(vipUser, 'grok-4.5'), 'grok-4.5');
  assert.equal(resolveModelForUser(vipUser, 'grok-4.6'), 'grok-4.6');

  // Alias resolution
  assert.equal(resolveModelForUser(vipUser, 'grok4.5'), 'grok-4.5');
  assert.equal(resolveModelForUser(vipUser, 'grok45'), 'grok-4.5');
  assert.equal(resolveModelForUser(vipUser, 'grok4.6'), 'grok-4.6');
  assert.equal(resolveModelForUser(vipUser, 'grok46'), 'grok-4.6');

  // Direct lookup
  const pm45 = findPlatformModel('grok4.5');
  assert.ok(pm45);
  assert.equal(pm45.id, 'grok-4.5');
  assert.equal(pm45.baseURL, 'https://8888.name/v1');

  // Reasoning efforts
  assert.deepEqual(reasoningEffortsForModel(pm45), ['low', 'medium', 'high']);
  const pm46 = findPlatformModel('grok-4.6');
  assert.deepEqual(reasoningEffortsForModel(pm46), ['low', 'medium', 'high', 'xhigh']);

  // Normalization
  assert.equal(normalizeReasoningEffort(pm45, 'none'), 'low');
  assert.equal(normalizeReasoningEffort(pm45, 'medium'), 'medium');
  assert.equal(normalizeReasoningEffort(pm46, 'xhigh'), 'xhigh');
});

test('Model Capability Registry supports Grok models', () => {
  const { getModelCapability } = require('../lib/model/model-registry');

  const cap45 = getModelCapability('grok-4.5');
  assert.equal(cap45.displayName, 'xAI Grok 4.5');
  assert.equal(cap45.contextWindow, 131072);
  assert.ok(cap45.supportsReasoning);
  assert.deepEqual(cap45.reasoningModes, ['low', 'medium', 'high']);

  const cap46 = getModelCapability('grok-4.6');
  assert.equal(cap46.displayName, 'xAI Grok 4.6');
  assert.equal(cap46.contextWindow, 131072);
  assert.ok(cap46.supportsReasoning);
  assert.deepEqual(cap46.reasoningModes, ['low', 'medium', 'high', 'xhigh']);

  // Alias lookup
  assert.equal(getModelCapability('grok4.5').displayName, 'xAI Grok 4.5');
  assert.equal(getModelCapability('grok46').displayName, 'xAI Grok 4.6');
});
