'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ENTITY_RELATION_SCHEMA,
  parseDecoupledStream,
  assembleUpgradedGenerationPrompt,
  auditGeneratedChapter
} = require('../lib/generation-pipeline-coordinator');

test('Pipeline Coordinator：实体关系图谱校验与防混淆 Prompt (DEF-CONSIST-001)', () => {
  // 校验代际冲突
  const invalid = ENTITY_RELATION_SCHEMA.validateEntityRelations({
    relations: [{ subject: '张若尘', predicate: '女婿', object: '地姥' }]
  });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.warnings.length > 0);
  assert.ok(invalid.warnings[0].includes('地姥的女婿'));

  const valid = ENTITY_RELATION_SCHEMA.validateEntityRelations({
    relations: [{ subject: '张若尘', predicate: '夫婿', object: '姑射静' }]
  });
  assert.equal(valid.valid, true);

  const prompt = ENTITY_RELATION_SCHEMA.compileStructuredEntityPrompt();
  assert.ok(prompt.includes('【老祖宗】：地姥'));
  assert.ok(prompt.includes('【母神】：姑射云琉'));
  assert.ok(prompt.includes('【天阁目】：姑射静'));
  assert.ok(prompt.includes('绝对严禁写成地姥女婿'));
});

test('Pipeline Coordinator：流式计费控制帧多路解耦 (DEF-PIPE-001)', () => {
  const rawMockStream = [
    ': ping',
    '',
    'data: {"molan_billing":{"cost":0.02,"credit":100}}',
    '',
    'data: {"choices":[{"delta":{"content":"天色已暗，"}}]}',
    '',
    ': keep-alive',
    '',
    'data: {"choices":[{"delta":{"content":"张若尘推门而入。"}}]}',
    '',
    'data: [DONE]'
  ].join('\n');

  const parsed = parseDecoupledStream(rawMockStream);
  assert.equal(parsed.removedBillingEvents, 1, '必须过滤并提取计费帧');
  assert.equal(parsed.removedHeartbeats, 2, '必须过滤心跳包');
  assert.equal(parsed.content, '天色已暗，张若尘推门而入。');
  assert.equal(parsed.streamErrors.length, 0);
});

test('Pipeline Coordinator：全量升级 Prompt 组装断言', () => {
  const rawPrompt = `
世界观：东方玄幻，包含大圣、神灵；
主要人物：张若尘、姑射静；
剧情节点：
1. 踢门惹事
2. 救回
3. 三日后，借天魔石刻
4. 月圆夜前夕交代
  `;

  const assembled = assembleUpgradedGenerationPrompt(rawPrompt, { targetWordCount: 2400 });
  assert.ok(assembled.assembledPrompt.includes('分场景规划与时空转场契约'));
  assert.ok(assembled.assembledPrompt.includes('DEF-PACING-001'));
  assert.ok(assembled.assembledPrompt.includes('人物动态心智与人性弱点契约'));
  assert.ok(assembled.assembledPrompt.includes('DEF-CHAR-001'));
  assert.ok(assembled.assembledPrompt.includes('确定性实体关系图谱'));
  assert.ok(assembled.assembledPrompt.includes('DEF-CONSIST-001'));
  assert.ok(assembled.assembledPrompt.includes('战斗感官物理抗阻与通感门禁'));
  assert.ok(assembled.assembledPrompt.includes('DEF-DESC-001'));
});

test('Pipeline Coordinator：闭环后置质检审计 (DEF-DESC-001 & DEF-CONSIST-001)', () => {
  // 合规文本（具备物理受力描写与正确实体）
  const goodChapter = `
神灵大手横空碾碎石门，恐怖的重力形变让青石地面寸寸龟裂。神威压在肩头，张若尘骨骼微鸣，气血翻滚，暴退三步，嘴角溢出一丝血迹。
姑射静踏入神殿，冷冷质问：“你在算计老祖宗？”
张若尘在刀尖起舞，暗中调息平复剧烈的心跳，嘴上却淡然笑道：“我怕你笑场。”
离开时，他两手空空，未带走黑晶。
  `;

  const audit = auditGeneratedChapter(goodChapter);
  assert.equal(audit.entityConsistencyAudit.passed, true);
  assert.equal(audit.entityConsistencyAudit.mentionsWrongRelationship, false);
  assert.equal(audit.climaxShockAudit.passed, true);
  assert.equal(audit.passed, true);

  // 违规文本（包含错误代际与缺乏物理受力）
  const badChapter = `
神灵大手抓来。张若尘笑了笑，自称是地姥女婿。
  `;
  const badAudit = auditGeneratedChapter(badChapter);
  assert.equal(badAudit.entityConsistencyAudit.mentionsWrongRelationship, true);
  assert.equal(badAudit.passed, false);
});
