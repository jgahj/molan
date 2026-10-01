'use strict';
// 两遍生成（生成遍 + humanize 改写遍）单元测试
const test = require('node:test');
const assert = require('node:assert');
const server = require('../server');
const UNIVERSAL_CORRECTION_MARKER = '<!-- molan-universal-correction-policy-v1 -->';

test('isTwoPassHumanizeEnabled：默认关闭，仅显式开启且 stage=writing 时启用', () => {
  assert.equal(server.isTwoPassHumanizeEnabled('writing', {}), false);
  assert.equal(server.isTwoPassHumanizeEnabled('writing', { twoPassHumanize: true }), true);
  assert.equal(server.isTwoPassHumanizeEnabled('writing', { twoPassHumanize: false }), false);
  assert.equal(server.isTwoPassHumanizeEnabled('writing', { jsonMode: true, twoPassHumanize: true }), false);
  assert.equal(server.isTwoPassHumanizeEnabled('single', { twoPassHumanize: true }), false);
  assert.equal(server.isTwoPassHumanizeEnabled('humanizer', { twoPassHumanize: true }), false);
  assert.equal(server.isTwoPassHumanizeEnabled('', null), false);
});

test('isTwoPassHumanizeEnabled：环境变量 MOLAN_TWO_PASS_HUMANIZE=1 时全局开启', () => {
  const prev = process.env.MOLAN_TWO_PASS_HUMANIZE;
  process.env.MOLAN_TWO_PASS_HUMANIZE = '1';
  try {
    assert.equal(server.isTwoPassHumanizeEnabled('writing', {}), true);
  } finally {
    if (prev === undefined) delete process.env.MOLAN_TWO_PASS_HUMANIZE;
    else process.env.MOLAN_TWO_PASS_HUMANIZE = prev;
  }
});

test('两遍模式下生成遍不注入纠错库（injectUniversalCorrectionPolicy 关闭）', () => {
  const messages = [{ role: 'system', content: '你是小说写作助手。' }, { role: 'user', content: '写第一章' }];
  const twoPass = server.isTwoPassHumanizeEnabled('writing', { twoPassHumanize: true });
  assert.equal(twoPass, true);
  // 第一遍 correctionEnabled=false → 不注入纠错库
  const out = server.injectUniversalCorrectionPolicy(messages, false);
  assert.equal(out[0].content.includes(UNIVERSAL_CORRECTION_MARKER), false);
});

test('buildHumanizePassMessages：system 含纠错库与改写边界，user 携带初稿全文', () => {
  const draft = '他缓缓地抬起头，眼中闪过一丝不可抑制的震撼。';
  const messages = server.buildHumanizePassMessages(draft);
  assert.equal(Array.isArray(messages), true);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[0].content.includes(UNIVERSAL_CORRECTION_MARKER), true);
  assert.equal(messages[0].content.includes('改写边界'), true);
  assert.equal(messages[1].role, 'user');
  assert.equal(messages[1].content.includes(draft), true);
});

test('appendSystemBlock：追加到既有 system；无 system 时新建', () => {
  const messages = [{ role: 'system', content: 'base' }, { role: 'user', content: 'hi' }];
  const out = server.appendSystemBlock(messages, '\n\n【节奏目标】句长 18±8 字。');
  assert.equal(out[0].content, 'base\n\n【节奏目标】句长 18±8 字。');
  assert.equal(out[1].content, 'hi');
  assert.equal(messages[0].content, 'base'); // 不改动原数组
  const noSystem = server.appendSystemBlock([{ role: 'user', content: 'hi' }], '【目标】');
  assert.equal(noSystem[0].role, 'system');
  assert.equal(noSystem[0].content, '【目标】');
  assert.equal(server.appendSystemBlock(messages, ''), messages);
});

test('mergeUsageSum：两遍用量逐字段相加，null 透传', () => {
  const a = { promptTokens: 100, completionTokens: 200, totalTokens: 300, usageSource: 'upstream' };
  const b = { promptTokens: 50, completionTokens: 150, totalTokens: 200, usageSource: 'upstream' };
  const merged = server.mergeUsageSum(a, b);
  assert.equal(merged.promptTokens, 150);
  assert.equal(merged.completionTokens, 350);
  assert.equal(merged.totalTokens, 500);
  assert.equal(server.mergeUsageSum(null, b), b);
  assert.equal(server.mergeUsageSum(a, null), a);
  assert.equal(server.mergeUsageSum(null, null), null);
  assert.equal(server.mergeUsageSum({ totalTokens: null }, { totalTokens: null }).totalTokens, null);
  assert.equal(server.mergeUsageSum({ totalTokens: undefined }, { totalTokens: null }).totalTokens, null);
  assert.equal(server.mergeUsageSum({ totalTokens: null }, { totalTokens: 0 }).totalTokens, 0);
  assert.equal(server.mergeUsageSum({ totalTokens: 7 }, { totalTokens: null }).totalTokens, 7);
});

test('injectEditorOnlyCorrectionLibrary：即使外部纠错库较旧，也自动合入 R-37/38/39 核心禁令', () => {
  const legacyLibrary = { content: '# 旧版纠错库\n无新规则。', path: 'old.md' };
  const messages = [{ role: 'system', content: '你是小说正文生成器。' }, { role: 'user', content: '开始写' }];
  const result = server.injectEditorOnlyCorrectionLibrary(messages, legacyLibrary, true);
  const sysText = result[0].content;
  assert.ok(sysText.includes('R-37'));
  assert.ok(sysText.includes('R-38'));
  assert.ok(sysText.includes('R-39'));
  assert.ok(sysText.includes('喉头一甜'));
  assert.ok(sysText.includes('气血翻涌'));
});
