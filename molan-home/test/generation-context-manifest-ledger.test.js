'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { assembleContext } = require('../lib/generation/context');
const { buildGenerationManifest } = require('../lib/generation/manifest');

test('P1 Context & Manifest - replayManifest.blocks has tokens, included, id, layer, reason', () => {
  const input = {
    currentTask: '写一段主角在演武场对决的开场',
    instruction: '重点描写剑气纵横与地面石砖碎裂',
    characters: [{ name: '叶凌天', role: 'protagonist' }],
    worldRules: '演武场受玄武结界保护，致命伤会被传送出场',
    activeCausalDebt: '欠林青璇一次承诺'
  };

  const options = {
    model: 'gpt-4o',
    targetChars: 2000,
    maxChars: 40000
  };

  const compiled = assembleContext(input, options);
  assert.ok(compiled && compiled.contextPlan);
  assert.ok(compiled.contextPlan.replayManifest);

  const blocks = compiled.contextPlan.replayManifest.blocks;
  assert.ok(Array.isArray(blocks) && blocks.length > 0);

  for (const block of blocks) {
    assert.ok(typeof block.id === 'string' && block.id.length > 0, 'block.id 必须为非空字符串');
    assert.ok(typeof block.layer === 'string' && block.layer.startsWith('L'), 'block.layer 必须为层级字符串');
    assert.ok(typeof block.tokens === 'number' && Number.isFinite(block.tokens) && block.tokens >= 0, 'block.tokens 必须为非负数值');
    assert.ok(typeof block.included === 'boolean', 'block.included 必须为布尔值');
    assert.ok(typeof block.reason === 'string', 'block.reason 必须为字符串');
  }

  // 验证必要上下文都被正确标记为 included: true
  const taskBlock = blocks.find(b => b.id === 'currentTask');
  assert.ok(taskBlock);
  assert.equal(taskBlock.included, true);
  assert.ok(taskBlock.tokens > 0);
});

test('P1 Context & Manifest - buildGenerationManifest includes styleBundleHash and genreBundleHash', () => {
  const manifest = buildGenerationManifest({
    generationId: 'gen_123',
    projectId: 'p_456',
    chapterId: 'ch_1',
    modelId: 'gpt-4o',
    styleBundleHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    genreBundleHash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  });

  assert.equal(manifest.generationId, 'gen_123');
  assert.equal(manifest.styleBundleHash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(manifest.genreBundleHash, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.ok(Object.isFrozen(manifest));
});
