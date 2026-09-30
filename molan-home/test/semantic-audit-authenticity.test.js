'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { auditSemantics, screenDeterministicSemantics, verifyQuoteInText } = require('../lib/generation/semantic-audit');
const { preservesMeaning, applyLocalRevision } = require('../lib/generation/revision');

test('P4 真实语义审计: 第一人称视点全知越界拦截并绑定真实 Quote', async () => {
  const badText = `我握紧手中的短刀，看着前方的黑衣人。他心里暗想我其实早已体力不支，嘴角露出一丝冷笑。`;

  const result = await auditSemantics({
    draft: badText,
    contract: {
      pov: 'first-person',
      viewpointCharacter: '我',
      chapterGoal: '突围'
    }
  });

  assert.equal(result.passed, false, '全知越界必须判定审计不通过');
  assert.equal(result.blockerCount, 1, '必须准确记录1个阻断项');
  assert.equal(result.issues[0].category, 'pov');
  assert.equal(result.issues[0].severity, 'blocker');
  assert.equal(result.issues[0].status, 'verified');
  assert.ok(badText.includes(result.issues[0].quote), 'Quote 必须在正文中逐字存在');
  assert.equal(result.dimensions.povBoundary.value < 0.5, true, '视点越界后 povBoundary 维度分值必须降低');
});

test('P4 真实语义审计: 禁载知识泄露精准拦截', async () => {
  const leakText = `陆羽站在古井边，沉思片刻。传国玉玺在古井下，这一点他早已心知肚明。`;

  const result = await auditSemantics({
    draft: leakText,
    contract: {
      pov: 'third-limited',
      viewpointCharacter: '陆羽',
      forbiddenKnowledge: [{ id: 'k1', fact: '传国玉玺在古井下' }]
    }
  });

  assert.equal(result.passed, false);
  assert.equal(result.blockerCount, 1);
  assert.equal(result.issues[0].category, 'knowledge');
  assert.ok(result.issues[0].quote.includes('传国玉玺在古井下'));
});

test('P4 真实语义审计: 正常合格正文通过审计并生成真实依据', async () => {
  const goodText = `陆羽站在古井旁，冷雨打湿了石栏。
“少爷，我们要找的东西真在这里？”老仆提着风灯，低声问道。
陆羽没有回答，只是伸手探入冰冷的井水，指尖触到了一块凸起的石砖。`;

  const result = await auditSemantics({
    draft: goodText,
    contract: {
      pov: 'third-limited',
      viewpointCharacter: '陆羽',
      chapterGoal: '探寻古井暗记'
    }
  });

  assert.equal(result.passed, true);
  assert.equal(result.blockerCount, 0);
  assert.equal(result.dimensions.povBoundary.status, 'MEASURED');
  assert.equal(result.dimensions.dialogue.status, 'MEASURED');
  assert.ok(result.dimensions.dialogue.evidence[0].includes('对白字数占比'));
});

test('P4 局修 Invariant Snapshot: 严厉拦截否定极性反转（反“他没有杀她”改“他杀了她”）', () => {
  // 案例 1: 否定变肯定 -> 致命剧情反转，必须拒绝
  const flipped = preservesMeaning({
    before: '他没有杀她，只是拿走了她身上的玉佩。',
    after: '他杀了她，只是拿走了她身上的玉佩。',
    protectedTerms: ['玉佩']
  });

  assert.equal(flipped.passed, false, '否定极性反转必须判定未通过');
  assert.ok(flipped.missing.some(m => m.includes('否定极性反转')));

  // 案例 2: 保留否定极性的正常词汇替换 -> 放行
  const preserved = preservesMeaning({
    before: '他没有杀她，只是拿走了她身上的玉佩。',
    after: '他并未伤害她，只是取走了她身上的玉佩。',
    protectedTerms: ['玉佩']
  });

  assert.equal(preserved.passed, true, '保持否定极性与受保护词应放行');

  // 案例 3: 数字丢失 -> 拒绝
  const numberLost = preservesMeaning({
    before: '他从怀中取出 3 枚银针。',
    after: '他从怀中取出银针。',
    protectedTerms: []
  });

  assert.equal(numberLost.passed, false, '数字丢失必须拦截');
  assert.ok(numberLost.missing.includes('3'));
});
