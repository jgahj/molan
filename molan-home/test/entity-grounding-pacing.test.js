'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const review = require('../lib/evidence-review');
const pipeline = require('../lib/benchmark-pipeline');

test('checkEntityGrounding 检测未前置空间锚定的突发行动/决策角色', () => {
  const textWithUngroundedActor = [
    '暴雨倾盆，货船在黑夜的风浪中剧烈摇晃，船工们奋力拉紧缆绳。',
    '陈西风沉声下令：“弃船，所有人带上账册乘救生筏离开！”',
    '水手们面面相觑，没有人敢违抗他的命令。'
  ].join('\n');

  // 已知实体只有张拂潇，陈西风未交代位置和身份直接下达重大决策
  const issues = review.checkEntityGrounding(textWithUngroundedActor, {
    knownEntities: ['张拂潇']
  });

  assert.equal(issues.length, 1);
  assert.equal(issues[0].name, '陈西风');
  assert.equal(issues[0].paragraphIndex, 2);
  assert.ok(issues[0].quote.includes('陈西风'));
  assert.ok(issues[0].problem.includes('未经前置登场交代'));
  assert.ok(issues[0].fixHint.includes('空间引出'));
});

test('checkEntityGrounding 对有空间物理锚定的登场角色放行', () => {
  const textWithGroundedActor = [
    '暴雨倾盆，货船在黑夜的风浪中剧烈摇晃，船工们奋力拉紧缆绳。',
    '陈西风身穿青色军雨衣，站在船尾甲板上，冷冷注视着海面的浮木。',
    '“弃船，所有人带上账册乘救生筏离开！”他沉声吩咐道。'
  ].join('\n');

  // 陈西风在登场段有明确物理空间锚定（站在船尾甲板上、身穿青色军雨衣）
  const issues = review.checkEntityGrounding(textWithGroundedActor, {
    knownEntities: ['张拂潇']
  });

  assert.equal(issues.length, 0);
});

test('buildBaselineTargetBlock 保留题材样本统计但不注入通用套路门禁', () => {
  const baselinePack = {
    bookCount: 20,
    genre: '玄幻',
    baseline: {
      sentenceLenMean: { mean: 22.5 },
      sentenceLenStd: { mean: 12.3 },
      paragraphLenMean: { mean: 65.4 },
      dialogueRatio: { mean: 0.32 },
      dialogueTurnMean: { mean: 21.5 }
    },
    structureBaseline: {
      chapterCharsP25: 2200,
      chapterCharsP75: 2800,
      singleSentenceParagraphRatio: 0.18,
      directPsychRatio: 0.08
    }
  };

  const block = pipeline.buildBaselineTargetBlock(baselinePack);
  assert.ok(block.includes('2200～2800 字'));
  assert.ok(block.includes('仅作统计参考，实际篇幅以本章目标为准'));
  assert.ok(block.includes('对白长度、描写方式和章末落点只描述样本分布'));
  assert.ok(!block.includes('篇幅硬预算'));
  assert.ok(!block.includes('Entity Grounding'));
  assert.ok(!block.includes('战利品即时验货'));
});

test('checkPayoffExecution 检测高潮冲突中对手缺乏身心受挫与战利品缺乏验货', () => {
  const textMissingReactionAndLootCheck = [
    '演武场上杀意弥漫，赵执事冷笑一声悍然出手，狂暴真气直取张拂潇咽喉。',
    '张拂潇侧身避过，反手一掌击中其右肩，赵执事当即认输并退下台去。',
    '张拂潇从容拿到了属于胜利者的储物袋，随后转身离开大殿。'
  ].join('\n');

  const issues = review.checkPayoffExecution(textMissingReactionAndLootCheck);
  assert.equal(issues.length, 2);
  const opponentIssue = issues.find(i => i.category === 'payoff:missing_opponent_reaction');
  const lootIssue = issues.find(i => i.category === 'payoff:missing_loot_validation');
  assert.ok(opponentIssue, '应命中缺少对手具象身心受挫反应');
  assert.ok(lootIssue, '应命中缺少战利品验货触感反馈');
});

test('checkPayoffExecution 对具备对手身心受挫与即时触感验货的文本放行', () => {
  const compliantText = [
    '演武场上杀意弥漫，赵执事冷笑一声悍然出手，狂暴真气直取张拂潇咽喉。',
    '张拂潇侧身避过，雷弧凝聚掌心，重重击中其右肩，狂暴雷劲轰然炸开。',
    '赵执事面色惨白，倒退数步，喷出一口逆血，瞳孔骤缩失声惊呼：“雷灵根？！”',
    '张拂潇俯身拾起地上的储物袋，指尖摩挲其上冰凉微沉的兽皮纹理，神念探入扫视一番，确认无误后从容揣入怀中。'
  ].join('\n');

  const issues = review.checkPayoffExecution(compliantText);
  assert.equal(issues.length, 0);
});

test('evidenceAudit 对严重超篇幅生成给出聚焦修剪提示', async () => {
  const lines = [];
  for (let i = 0; i < 60; i++) {
    lines.push('第' + i + '段，风浪愈发狂暴，货船在夜色中艰难前行，水手们各司其职不敢有丝毫松懈。');
  }
  const longText = lines.join('\n');
  const targetWords = 1000;
  const usage = { totalTokens: 100, creditCost: 0.01, status: 'completed' };
  const checked = Object.fromEntries(review.REVIEW_DIMENSIONS.map(dimension => [dimension, 'checked']));
  const clean = () => ({ issues: [], stageChange: '推进', summary: '正常', coverage: checked, factLedgerDelta: { newRules: [], newPromises: [], byEntity: {}, updates: [] } });

  const audit = await pipeline.evidenceAudit({
    callModel: async () => ({ json: clean(), usage })
  }, null, { text: longText, targetWords, genre: '玄幻' });

  const wordCountIssue = audit.issues.find(i => i.category === 'hard:word_count');
  assert.ok(wordCountIssue, '应命中 word_count 硬约束');
  assert.ok(wordCountIssue.fixHint.includes('聚焦修剪'), '应提供聚焦修剪提示');
});
