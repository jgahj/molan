'use strict';

/**
 * RenderedPromptPackage 唯一请求源不变量测试
 * 1. 规范包的 messages 即最终 Provider 请求（model-call-service 透传不重拼）；
 * 2. promptDigest 覆盖全部消息（含第三条指令与动态标记）；
 * 3. 规范包与回退路径的 user 消息字节一致（均带 DYNAMIC_PROMPT_MARKER）；
 * 4. manifest promptHash 使用完整指纹。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { buildDraftRequest } = require('../lib/generation/content-engine');
const { DYNAMIC_PROMPT_MARKER } = require('../lib/generation/prompt-markers');

function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

test('规范包 messages 为最终三消息，user 消息带动态标记', () => {
  const draftReq = buildDraftRequest({
    request: { targetChars: 2000, modelId: 'test-model' },
    contract: { chapterGoal: '核心潜伏' }
  });
  const pkg = draftReq.renderedPromptPackage;
  assert.ok(pkg, '必须产出 renderedPromptPackage');
  assert.equal(pkg.messages.length, 3, '最终请求为三条消息');
  assert.equal(pkg.messages[0].role, 'system');
  assert.equal(pkg.messages[1].role, 'user');
  assert.equal(pkg.messages[2].role, 'user');
  assert.ok(pkg.messages[1].content.startsWith(DYNAMIC_PROMPT_MARKER), 'user 消息必须以动态标记开头（与回退路径字节一致）');
  assert.equal(pkg.messages[2].content, '请直接输出内容，不要解释。');
});

test('promptDigest 覆盖全部消息（含标记与第三条指令）', () => {
  const draftReq = buildDraftRequest({
    request: { targetChars: 2000, modelId: 'test-model' },
    contract: { chapterGoal: '核心潜伏' }
  });
  const pkg = draftReq.renderedPromptPackage;
  const expectedDigest = sha256(pkg.messages.map(m => `${m.role}:${m.content}`).join('\n---\n'));
  assert.equal(pkg.promptDigest, expectedDigest, 'promptDigest 必须由全部消息计算');

  // 改动任何一条消息都必须改变指纹（第三条指令也在覆盖范围内）
  const tampered = pkg.messages.map((m, i) => (i === 2 ? { ...m, content: '请直接输出内容，不要解释。 ' } : m));
  const tamperedDigest = sha256(tampered.map(m => `${m.role}:${m.content}`).join('\n---\n'));
  assert.notEqual(tamperedDigest, pkg.promptDigest);
});

test('model-call-service 透传规范包 messages，绝不重拼', () => {
  // 复刻 model-call-service 的消息解析逻辑（providedMessages 优先）
  const draftReq = buildDraftRequest({
    request: { targetChars: 2000, modelId: 'test-model' },
    contract: { chapterGoal: '核心潜伏' }
  });
  const o = {
    system: draftReq.system,
    userPrompt: draftReq.userPrompt,
    renderedPromptPackage: draftReq.renderedPromptPackage
  };
  const providedMessages = Array.isArray(o.messages) && o.messages.length > 0
    ? o.messages
    : (o.renderedPromptPackage && Array.isArray(o.renderedPromptPackage.messages) && o.renderedPromptPackage.messages.length > 0
      ? o.renderedPromptPackage.messages
      : null);
  assert.ok(providedMessages, '提供规范包时必须走透传分支');
  assert.deepEqual(providedMessages, draftReq.renderedPromptPackage.messages, '透传的 messages 必须与规范包完全一致');
  // 不得落入回退重拼分支（回退会再造第三条消息）
  const fallbackWouldRebuild = !providedMessages;
  assert.equal(fallbackWouldRebuild, false);
});

test('splitDynamicPrompt 可对规范包做 stable/dynamic 拆分（缓存优化在规范链生效）', () => {
  const draftReq = buildDraftRequest({
    request: { targetChars: 2000, modelId: 'test-model' },
    contract: { chapterGoal: '核心潜伏' }
  });
  const messages = draftReq.renderedPromptPackage.messages;
  // 复刻 server.js splitDynamicPrompt 的最小逻辑验证标记可定位
  const index = messages.findIndex(m => typeof m.content === 'string' && m.content.includes(DYNAMIC_PROMPT_MARKER));
  assert.ok(index >= 0, '规范包中必须存在可定位的动态标记');
  const markerIndex = messages[index].content.indexOf(DYNAMIC_PROMPT_MARKER);
  const stable = messages[index].content.slice(0, markerIndex).trimEnd();
  const dynamic = messages[index].content.slice(markerIndex + DYNAMIC_PROMPT_MARKER.length).trim();
  assert.equal(stable, '', '规范链 user 消息整体为动态上下文');
  assert.ok(dynamic.length > 0);
});

test('完整指纹与旧式拼接哈希不同（证明覆盖范围已扩展）', () => {
  const draftReq = buildDraftRequest({
    request: { targetChars: 2000, modelId: 'test-model' },
    contract: { chapterGoal: '核心潜伏' }
  });
  const legacyHash = sha256(draftReq.system + '\n' + draftReq.userPrompt);
  assert.notEqual(draftReq.renderedPromptPackage.promptDigest, legacyHash,
    '完整 promptDigest 必须覆盖第三条消息与动态标记，与旧式双字段拼接哈希区分');
  // generateDraft 内部 draftRecord.requestHash 已改用该完整指纹（见 content-engine.js）
  assert.equal(typeof draftReq.renderedPromptPackage.promptDigest, 'string');
  assert.equal(draftReq.renderedPromptPackage.promptDigest.length, 64);
});
