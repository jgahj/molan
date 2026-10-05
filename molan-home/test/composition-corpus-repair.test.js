'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { defaultEvidenceCatalog } = require('../lib/composition/corpus/evidence-catalog');
const { extractChapterFactors } = require('../lib/composition/corpus/factorized-extractor');
const { routeRepairStrategy, REPAIR_STRATEGIES } = require('../lib/composition/audit-repair/targeted-repair-router');
const { humanizeWithStyle } = require('../lib/composition/audit-repair/style-aware-humanizer');

test('Composition Corpus: 证据库强度过滤 (只允许 A/B 级进入生产)', () => {
  const cards = defaultEvidenceCatalog.findRelevantCards({
    dimensions: ['dialogue_game'],
    minStrength: 'B'
  });

  assert.ok(cards.length >= 1);
  assert.ok(cards.every(c => c.evidenceStrength === 'A' || c.evidenceStrength === 'B'));
  assert.ok(cards[0].name.includes('动作-对白交错律'));
  assert.ok(cards[0].microExample.length > 0);
  assert.ok(cards[0].failureMode.length > 0);
});

test('Composition Corpus: 多目标加权与正交因子抽取', () => {
  const prose = `
    李巡将染血的断刀插在青石砖缝中，抬眼看向对面负手而立的黑袍人。
    “三年前雁门关那一役，军饷到底落进了谁的口袋？”他的声音嘶哑，指骨因脱力而微微发颤。
    黑袍人沉默地扯下一截袖袍，露出一枚泛着焦黑痕迹的铜符。
    风声穿过长巷，血腥味在冰冷的雨幕中迅速散开。
    “你真以为，当年想让镇守使死的人，只有朝堂上那位？”
    李巡瞳孔微缩，死死盯住那枚铜符上的暗刻——那是他生父生前从不离身的私印！
    为何这枚私印会出现在刺客手里？
  `;

  const factors = extractChapterFactors(prose, { title: '寒夜刀客', chapterNo: 15 });

  assert.ok(factors.totalChars > 100);
  assert.ok(factors.primaryGoal === 'conflict_push' || factors.primaryGoal === 'info_reveal');
  assert.ok(factors.tailHook.type === 'suspense');
  assert.equal(factors.tailHook.gapType, 'information_gap');
  assert.ok(factors.stylometry.shortSentenceRatio > 0);
  assert.ok(factors.stylometry.dialogueRatio > 0);
});

test('Composition Targeted Repair: 审计维度精准映射至微创策略', () => {
  const mockDraft = '前文剧情...在长街之上，主角面对强敌陷入苦战。结尾平淡无奇地收工回家了。';

  // 1. 钩子缺陷 -> 映射到末尾重构
  const hookPlan = routeRepairStrategy({ dimension: 'hook', problem: '章末缺少悬念缺口' }, mockDraft);
  assert.equal(hookPlan.strategy, REPAIR_STRATEGIES.HOOK_TAIL_RECONSTRUCT);
  assert.equal(hookPlan.requiresFullRegeneration, false);

  // 2. 事实冲突 -> 映射到微创补丁
  const factPlan = routeRepairStrategy({ dimension: 'fact', quote: '主角早在十年前就已经突破金丹' }, mockDraft);
  assert.equal(factPlan.strategy, REPAIR_STRATEGIES.FACT_SURGICAL_PATCH);
  assert.equal(factPlan.requiresFullRegeneration, false);

  // 3. AI 套路词 -> 映射到物理微动动作替换
  const aiFlavorPlan = routeRepairStrategy({ dimension: 'ai_flavor', quote: '嘴角勾起一抹森然的弧度' }, mockDraft);
  assert.equal(aiFlavorPlan.strategy, REPAIR_STRATEGIES.AI_FLAVOR_SURGICAL_REPLACE);
  assert.equal(aiFlavorPlan.requiresFullRegeneration, false);
});

test('Composition Style-Aware Humanizer: 针对老白文风消解套路词与冗余感叹号', () => {
  const aiText = '不得不说，与此同时，他嘴角勾起一抹玩味的弧度！倒吸一口凉气！他心中充满了绝望。';
  const result = humanizeWithStyle(aiText, {
    styleProfile: { id: 'laobai_restrained' }
  });

  assert.ok(!result.text.includes('不得不说'));
  assert.ok(!result.text.includes('与此同时'));
  assert.ok(!result.text.includes('嘴角勾起一抹'));
  assert.ok(!result.text.includes('倒吸一口凉气'));
  assert.ok(!result.text.includes('心中充满了'));
  assert.ok(result.changeCount >= 3);
});
