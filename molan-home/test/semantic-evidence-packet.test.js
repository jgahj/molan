'use strict';

/**
 * 判官证据包专项测试：弃 slice(0,4000) 单截取，改开篇/中段/高潮/结尾四段覆盖。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDraftEvidencePacket, auditSemantics } = require('../lib/generation/semantic-audit');

test('短章（<=4000 字）直接给全文，不重复分段', () => {
  const text = '短章正文。'.repeat(100); // 500 字
  const packet = buildDraftEvidencePacket(text);
  assert.equal(packet.mode, 'full');
  assert.equal(packet.full, text);
  assert.equal(packet.totalChars, text.length);
  assert.ok(!('opening' in packet));
});

test('长章按四段覆盖，各段有界且总覆盖接近全文', () => {
  // 非重复内容，确保 indexOf 定位真实（重复文本会命中早期相同子串）
  const text = Array.from({ length: 2000 }, (_, i) => `第${i}段独特内容`).join('');
  const packet = buildDraftEvidencePacket(text);
  assert.equal(packet.mode, 'segmented');
  assert.equal(packet.totalChars, text.length);
  for (const key of ['opening', 'middle', 'climax', 'ending']) {
    assert.ok(packet[key].length > 0 && packet[key].length <= 1200, `${key} length=${packet[key].length}`);
  }
  // opening 从 0 开始，ending 到文末
  assert.equal(text.slice(0, packet.opening.length), packet.opening);
  assert.ok(text.endsWith(packet.ending), 'ending 必须覆盖到文末（章末 Hook 视野）');
  // 四段合计覆盖 > 3000 字且跨越前中后三个区域
  assert.ok(packet.opening.length + packet.middle.length + packet.climax.length + packet.ending.length > 3000);
  const midStart = text.indexOf(packet.middle);
  const climaxStart = text.indexOf(packet.climax);
  assert.ok(midStart > packet.opening.length * 0.5, 'middle 应在开篇之后');
  assert.ok(climaxStart > midStart, 'climax 应在 middle 之后');
});

test('证据包携带 stateBefore/stateAfter（提供时）', () => {
  const text = '长章'.repeat(5000);
  const packet = buildDraftEvidencePacket(text, { stateBefore: { debt: 2 }, stateAfter: { debt: 1 } });
  assert.deepEqual(packet.stateBefore, { debt: 2 });
  assert.deepEqual(packet.stateAfter, { debt: 1 });
  const bare = buildDraftEvidencePacket(text);
  assert.ok(!('stateBefore' in bare));
});

test('auditSemantics 判官 prompt 使用 evidencePacket 且不再有 draftExcerpt', async () => {
  let capturedPrompt = null;
  const text = '演武场四周古树参天。'.repeat(500); // ~6000 字长章
  const result = await auditSemantics({
    draft: text,
    contract: { chapterGoal: '对决', pov: 'third', viewpointCharacter: '叶凌天', characters: ['叶凌天'] },
    enableModelJudge: true,
    auth: { token: 't' },
    callModel: async (auth, opts) => {
      capturedPrompt = JSON.parse(opts.userPrompt);
      return { json: { issues: [] }, text: '' };
    }
  });
  assert.ok(capturedPrompt, 'callModel 应被调用');
  assert.ok(capturedPrompt.evidencePacket, 'prompt 必须包含 evidencePacket');
  assert.equal(capturedPrompt.evidencePacket.mode, 'segmented');
  assert.ok(!('draftExcerpt' in capturedPrompt), '不得再使用单截取 draftExcerpt');
  assert.equal(result.status, 'MEASURED');
  assert.equal(result.passed, true);
});

test('auditSemantics 短章走 full 模式', async () => {
  let capturedPrompt = null;
  await auditSemantics({
    draft: '短章。',
    contract: {},
    enableModelJudge: true,
    auth: { token: 't' },
    callModel: async (auth, opts) => { capturedPrompt = JSON.parse(opts.userPrompt); return { json: { issues: [] } }; }
  });
  assert.equal(capturedPrompt.evidencePacket.mode, 'full');
  assert.equal(capturedPrompt.evidencePacket.full, '短章。');
});
