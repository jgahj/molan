'use strict';

/**
 * Experiment 结构真值评分专项测试
 * 验证：① 同词频下结构验证显著提分；② 词频堆砌+零推进触发投机惩罚；
 *       ③ 无结构验证时词频层仍保有排序能力（不回归）；④ 旧字段完整保留。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { ExperimentEngine } = require('../lib/composition/evaluation/experiment-engine');

const GOOD_TEXT = '烛台微亮，石壁上的血花缓缓滴落。叶凌天反手截断剑势，借着力道后撤，青石板被犁出两道浅痕。沈商按住刀柄，指节发白。';
const FLUFF_TEXT = '死战将至，杀机狂涌，危险逼近，危机四伏，变数横生，惊天动地。';

function engine() {
  return new ExperimentEngine({ persistencePath: null });
}

test('同词频文本：有结构验证（债务清偿+状态改变）显著高于无验证', async () => {
  const e = engine();
  const plain = await e.evaluateCandidate({ text: GOOD_TEXT, context: {} });
  const structured = await e.evaluateCandidate({
    text: GOOD_TEXT,
    context: {
      debtReconciliation: { status: 'reconciled', resolvedDebts: [{ id: 'd1' }, { id: 'd2' }] },
      stateDelta: { stateBefore: { trust: 1 }, stateAfter: { trust: 0 } }
    }
  });
  // 注：有验证时结构分升、词频层权重降（信任从措辞转向结构），净增益为正但非巨额
  assert.ok(structured.compositeScore > plain.compositeScore + 0.05,
    `结构化 ${structured.compositeScore} 应明确高于无验证 ${plain.compositeScore}`);
  assert.equal(structured.l1Structural.hasStructuralVerification, true);
  assert.equal(structured.structuralScore > 0.5, true);
  assert.equal(structured.scoring.weights.structural, 0.45, '有验证时结构权重 45%');
  assert.equal(plain.scoring.weights.structural, 0.10, '无验证时结构权重 10%');
});

test('投机文本：词频堆砌 + 有结构验证但零推进 → 惩罚生效且不敌真实推进', async () => {
  const e = engine();
  const stuffed = await e.evaluateCandidate({
    text: FLUFF_TEXT,
    context: {
      debtReconciliation: { status: 'open', resolvedDebts: [] },
      stateDelta: { stateBefore: { trust: 1 }, stateAfter: { trust: 1 } }
    }
  });
  const advanced = await e.evaluateCandidate({
    text: FLUFF_TEXT,
    context: {
      debtReconciliation: { status: 'reconciled', resolvedDebts: [{ id: 'd1' }] },
      stateDelta: { stateBefore: { trust: 1 }, stateAfter: { trust: 0 } }
    }
  });
  assert.equal(stuffed.l1Structural.speculativeTensionDiscount > 0, true, '零推进+词频堆砌应触发投机折扣');
  assert.equal(stuffed.scoring.speculativePenalty, 0.10, '投机直接惩罚 0.10');
  assert.ok(advanced.compositeScore > stuffed.compositeScore + 0.2,
    `真实推进 ${advanced.compositeScore} 应显著高于零推进 ${stuffed.compositeScore}`);
});

test('无结构验证时词频层保有排序能力（优质文本 > 单薄文本，不回归）', async () => {
  const e = engine();
  const good = await e.evaluateCandidate({ text: GOOD_TEXT, context: {} });
  const thin = await e.evaluateCandidate({ text: '他们打了一架。', context: {} });
  assert.ok(good.compositeScore > thin.compositeScore, `优质 ${good.compositeScore} > 单薄 ${thin.compositeScore}`);
  assert.ok(good.compositeScore > 0.5, `优质文本应过 50 分线（实测 ${good.compositeScore}）`);
});

test('AI 味惩罚仍然生效且可压低总分', async () => {
  const e = engine();
  const clean = await e.evaluateCandidate({ text: GOOD_TEXT, context: {} });
  const aiFlavored = await e.evaluateCandidate({
    text: GOOD_TEXT + '总之，值得注意的是，综上所述，不难看出，宛如一幅波澜壮阔的画卷。',
    context: {}
  });
  assert.ok(aiFlavored.aiFlavorRisk > clean.aiFlavorRisk);
  assert.ok(aiFlavored.compositeScore < clean.compositeScore, 'AI 味应压低总分');
});

test('旧返回字段完整保留（下游兼容）', async () => {
  const e = engine();
  const r = await e.evaluateCandidate({ text: GOOD_TEXT, context: {} });
  for (const key of ['causalScore', 'literaryScore', 'aiFlavorRisk', 'tensionDelta', 'compositeScore', 'l0Prescreen', 'l1Structural']) {
    assert.ok(key in r, `缺少字段 ${key}`);
  }
  assert.ok(r.l0Prescreen.causalHits >= 0 && r.l0Prescreen.sensoryHits >= 0);
  assert.equal(typeof r.compositeScore, 'number');
});
