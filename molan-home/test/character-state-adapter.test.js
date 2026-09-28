'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  HUMAN_TEXTURE_TEMPLATES,
  buildCharacterStateContract,
  compileCharacterStateDirectives
} = require('../lib/character-state-adapter');

test('Character State Adapter：主角多维心智与人性弱点契约构建 (DEF-CHAR-001)', () => {
  const contract = buildCharacterStateContract('张若尘', '俗世神话', { dangerLevel: 'high' });

  assert.equal(contract.isProtagonist, true);
  assert.ok(contract.emotionalStates.includes('防备'));
  assert.ok(contract.emotionalStates.includes('担忧') || contract.emotionalStates.includes('心虚'));
  assert.ok(contract.textureSignals.includes('hesitation'));
  assert.ok(contract.textureSignals.includes('somatic_stress'));
  assert.ok(contract.textureSignals.includes('save_face'));

  assert.ok(contract.promptDirective.includes('DEF-CHAR-001'));
  assert.ok(contract.promptDirective.includes('严禁写成绝对冰冷'));
  assert.ok(contract.promptDirective.includes('生理应激'));
});

test('Character State Adapter：配角交互契约与指令编译', () => {
  const characters = [
    { name: '张若尘', role: '主角' },
    { name: '姑射静', role: '天阁目' }
  ];

  const directives = compileCharacterStateDirectives(characters, { dangerLevel: 'high' });

  assert.ok(directives.includes('### 【人物动态心智与人性弱点契约 (Character State Machine Enforced)】'));
  assert.ok(directives.includes('张若尘 人设立体度'));
  assert.ok(directives.includes('姑射静 交互契约'));
});

test('OPT-CHAR-001: 动态情态锚点提取与高危场景生理应激 (DEF-CHAR-001)', () => {
  const { getDynamicCharacterContext } = require('../lib/character-state-adapter');


  // 高危神灵威压场景 (张若尘)
  const highTension = getDynamicCharacterContext('张若尘', 'HIGH');
  assert.equal(highTension.tensionLevel, 'HIGH');
  assert.equal(highTension.isProtagonist, true);
  assert.ok(highTension.physicalReaction.includes('手心微汗') || highTension.physicalReaction.includes('肌肉骤紧'));
  assert.ok(highTension.psychologicalVulnerability.includes('疯子') || highTension.psychologicalVulnerability.includes('强行撑住面子'));
  assert.ok(highTension.textureSignals.includes('somatic_stress'));
  assert.ok(highTension.promptSnippet.includes('OPT-CHAR-001'));

  // 平和日常交涉场景 (张若尘)
  const medTension = getDynamicCharacterContext('张若尘', 'MEDIUM');
  assert.equal(medTension.tensionLevel, 'MEDIUM');
  assert.ok(medTension.physicalReaction.includes('从容') || medTension.physicalReaction.includes('指尖'));
});

