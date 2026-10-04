'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getGenreCatalog, getGenreFamily, resolveGenreFamilyId, normalizeGenreRoute } = require('../lib/genre/genre-registry');
const { getModelCapability, estimateTokensWithCapability, listSupportedModels } = require('../lib/model/model-registry');
const { calculateContextBudget } = require('../lib/generation/context-budget');

test('P2: Genre Registry 唯一真理源覆盖 9 大母类且包含通用现实', () => {
  const catalog = getGenreCatalog();
  const keys = Object.keys(catalog);
  assert.equal(keys.length, 9, '题材母类必须严格为 9 类');
  assert.ok(catalog.universal, '必须包含通用现实母类 (universal)');
  assert.equal(catalog.universal.title, '通用现实');
  assert.ok(catalog.xuanhuan);
  assert.ok(catalog.urban_martial);
  assert.ok(catalog.scifi_apocalypse);
  assert.ok(catalog.suspense);
  assert.ok(catalog.history);
  assert.ok(catalog.western_fantasy);
  assert.ok(catalog.ancient_romance);
  assert.ok(catalog.modern_romance);

  // 验证路由机制解耦
  for (const [fKey, family] of Object.entries(catalog)) {
    assert.ok(family.routes.length > 0, `${fKey} 必须有可用路由`);
    for (const r of family.routes) {
      assert.ok(r.mechanism, `路由 ${r.value} 必须具有可计算写作机制描述`);
      assert.doesNotMatch(r.value, /[《》]/, `路由标识 ${r.value} 不得包含书名号`);
    }
  }

  // 验证双向别名解析
  assert.equal(resolveGenreFamilyId('仙侠'), 'xuanhuan');
  assert.equal(resolveGenreFamilyId('现实'), 'universal');
  assert.equal(resolveGenreFamilyId('未知题材'), 'universal');
  assert.equal(normalizeGenreRoute('xuanhuan', 'fanren'), 'cautious_survival');
});

test('P2: Model Capability Registry 纳管 gpt-5.6-luna 并提供精准上下文边界', () => {
  const lunaCap = getModelCapability('gpt-5.6-luna');
  assert.equal(lunaCap.modelId, 'gpt-5.6-luna');
  assert.equal(lunaCap.contextWindow, 128000, 'gpt-5.6-luna 上下文必须为 128000');
  assert.equal(lunaCap.maxOutputTokens, 16000);
  assert.equal(lunaCap.supportsReasoning, true);

  const supported = listSupportedModels();
  assert.ok(supported.some(m => m.modelId === 'gpt-5.6-luna'));
  assert.ok(supported.some(m => m.modelId === 'claude-3-5-sonnet'));

  // 验证 context-budget 接入注册表，不再回退到 32768
  const budget = calculateContextBudget({
    modelId: 'gpt-5.6-luna',
    system: '你是创作者。',
    context: '前情提要。',
    targetChars: 3000
  });

  assert.equal(budget.limit, 128000, 'Context Budget 必须识别 gpt-5.6-luna 的 128000 上限');
  assert.ok(budget.fits);
  assert.ok(budget.margin > 120000);
});

test('Model Capability Registry 支持 Gemini 3.6f~3.8f 及 3.1pro 模型与别名解析', () => {
  const models = ['gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash', 'gemini-3.1-pro'];
  for (const mId of models) {
    const cap = getModelCapability(mId);
    assert.equal(cap.contextWindow, 1000000, `${mId} 上下文必须为 1,000,000 tokens`);
    assert.ok(cap.supportsReasoning, `${mId} 必须支持推理强度设置`);
  }

  // 验证别名映射解析
  assert.equal(getModelCapability('gemini3.6f').displayName, 'Gemini 3.6 Flash (3.6f)');
  assert.equal(getModelCapability('gemini-3.6f').contextWindow, 1000000);
  assert.equal(getModelCapability('gemini3.7f').displayName, 'Gemini 3.7 Flash (3.7f)');
  assert.equal(getModelCapability('gemini3.8f').displayName, 'Gemini 3.8 Flash (3.8f)');
  assert.equal(getModelCapability('gemini3.1pro').displayName, 'Gemini 3.1 Pro (3.1pro)');
  assert.equal(getModelCapability('3.1pro').displayName, 'Gemini 3.1 Pro (3.1pro)');

  // 验证 context-budget 识别 Gemini 百万级上下文
  const budget = calculateContextBudget({
    modelId: 'gemini-3.7-flash',
    system: '你是创作者。',
    context: '超长小说上下文...',
    targetChars: 10000
  });
  assert.equal(budget.limit, 1000000, 'Context Budget 必须识别 gemini-3.7-flash 的 1M 上限');
  assert.ok(budget.fits);
  assert.ok(budget.margin > 900000);
});
