'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { analyzeHumanTexture, AI_CLICHE_RULES } = require('../lib/style/human-texture');

test('P1 Human Texture - identifies clichés and provides replacement windows', () => {
  const textWithCliches = `
他嘴角勾起一抹玩味的弧度，目光在场中逡巡。
指腹反复摩挲着腰间的佩剑，心中涌起一股暖流。
周围的空气仿佛在此刻凝固了，旁观者倒吸了一口凉气。
`;

  const result = analyzeHumanTexture(textWithCliches);
  assert.equal(result.passed, false);
  assert.ok(result.score < 80);
  assert.ok(result.cliches.length >= 4);

  // 验证替换窗口数据结构完整性
  assert.ok(result.replacementWindows.length >= 4);
  for (const win of result.replacementWindows) {
    assert.ok(typeof win.startOffset === 'number' && win.startOffset >= 0);
    assert.ok(typeof win.endOffset === 'number' && win.endOffset > win.startOffset);
    assert.ok(typeof win.quote === 'string' && win.quote.length > 0);
    assert.ok(typeof win.issue === 'string');
    assert.ok(typeof win.suggestedPatch === 'string');
    // 确认切片匹配
    assert.equal(textWithCliches.slice(win.startOffset, win.endOffset), win.quote);
  }
});

test('P1 Human Texture - detects repetitive paragraph openings', () => {
  const repetitiveText = `
他推开了沉重的大门，走向院落深处。
他拿起了桌上的密信，借着月光细细端详。
他长叹了一口气，决定在拂晓前离开宗门。
`;

  const result = analyzeHumanTexture(repetitiveText);
  assert.ok(result.structuralIssues.some(issue => issue.type === 'paragraph_lead_repetition'));
  assert.ok(result.score < 100);
});

test('P1 Human Texture - clean literary text passes with high score', () => {
  const cleanProse = `
暮色如铅，压在青灰色的屋檐上。檐角铜铃在晚风中轻轻晃动，发出沉闷的单音。
裴寂放下手中的茶盏，瓷盖与盏口相扣，发出一声脆响。
窗外竹影摇曳，夜雨已在不知不觉中落了下来。
`;

  const result = analyzeHumanTexture(cleanProse);
  assert.equal(result.passed, true);
  assert.equal(result.score, 100);
  assert.equal(result.cliches.length, 0);
  assert.equal(result.structuralIssues.length, 0);
  assert.equal(result.replacementWindows.length, 0);
});
