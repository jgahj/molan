'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateEntityTreeConsistency,
  compileStoryBiblePrompt
} = require('../lib/story-bible-schema');

test('OPT-DATA-001: 实体代际冲突拦截 (DEF-CONSIST-001)', () => {
  // 注入严重违规用例：张若尘是地姥女婿
  const badKinshipGraph = {
    relations: [
      { subject: '张若尘', predicate: '女婿', object: '地姥' },
      { subject: '姑射静', predicate: '母女', object: '姑射云琉' }
    ]
  };

  const auditResult = validateEntityTreeConsistency(badKinshipGraph);
  assert.equal(auditResult.valid, false);
  assert.ok(auditResult.errors.length > 0);
  assert.ok(auditResult.errors[0].includes('地姥为神尊级老祖宗'));
  assert.ok(auditResult.errors[0].includes('代际称谓严重冲突'));
});

test('OPT-DATA-001: 道具状态自相矛盾拦截', () => {
  const badItemGraph = {
    items: [
      { name: '黑晶', heldBy: '张若尘', status: 'left_behind' }
    ]
  };

  const auditResult = validateEntityTreeConsistency(badItemGraph);
  assert.equal(auditResult.valid, false);
  assert.ok(auditResult.errors[0].includes('道具状态机自相矛盾'));
});

test('OPT-DATA-001: 正规实体图谱放行与 Prompt 编译', () => {
  const cleanGraph = {
    relations: [
      { subject: '张若尘', predicate: '夫婿', object: '姑射静' },
      { subject: '姑射云琉', predicate: '母神', object: '姑射静' },
      { subject: '地姥', predicate: '老祖宗', object: '罗祖云山界' }
    ],
    items: [
      { name: '黑晶', heldBy: '魔窟', status: 'left_behind' }
    ]
  };

  const auditResult = validateEntityTreeConsistency(cleanGraph);
  assert.equal(auditResult.valid, true);
  assert.equal(auditResult.errors.length, 0);

  const prompt = compileStoryBiblePrompt(cleanGraph);
  assert.ok(prompt.includes('OPT-DATA-001'));
  assert.ok(prompt.includes('【老祖宗】：地姥'));
  assert.ok(prompt.includes('【母神】：姑射云琉'));
  assert.ok(prompt.includes('【天阁目（指婚对象）】：姑射静'));
  assert.ok(prompt.includes('【绝对严禁写成地姥女婿】'));
});
