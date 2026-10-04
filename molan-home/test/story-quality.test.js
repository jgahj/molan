'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateStoryQuality } = require('../lib/quality/story-quality');

test('P1 Story Quality - evaluates multi-chapter story and flags ghost characters', () => {
  const chapters = [
    { chapterNo: 1, characters: ['叶凌天', '苏清璇'], text: '第一章正文，叶凌天与苏清璇初次相遇。' },
    { chapterNo: 2, characters: ['叶凌天', '苏清璇'], text: '第二章正文，两人立下盟约。' },
    { chapterNo: 3, characters: ['叶凌天', '萧炎'], text: '第三章正文，叶凌天独自历练结识萧炎。' },
    { chapterNo: 4, characters: ['叶凌天', '林动'], text: '第四章正文，叶凌天深入秘境。' },
    { chapterNo: 5, characters: ['叶凌天'], text: '第五章正文，秘境大战爆发。' },
    { chapterNo: 6, characters: ['叶凌天', '牧尘'], text: '第六章正文，主角突破境界。' },
    { chapterNo: 7, characters: ['叶凌天'], text: '第七章正文，登临巅峰。' }
  ];

  const report = evaluateStoryQuality(chapters);
  assert.equal(report.checkpoint, 5); // >=5
  assert.equal(report.chapterCount, 7);

  // 苏清璇在第 1、2 章出场后连续 5 章未出场，判定为幽灵角色
  assert.ok(report.characterArc.ghostCharacters.length >= 1);
  const ghost = report.characterArc.ghostCharacters.find(c => c.name === '苏清璇');
  assert.ok(ghost);
  assert.equal(ghost.lastSeen, 2);
  assert.equal(ghost.absenceSpan, 5);
  assert.ok(report.recommendations.some(r => r.includes('苏清璇')));
});

test('P1 Story Quality - flags stale causal debts over 5 chapters old', () => {
  const chapters = [
    {
      chapterNo: 1,
      causalDebts: [{ id: 'debt_ancient_key', keyword: '上古钥匙之谜', plantedAt: 1, status: 'open' }],
      text: '第一章在洞府拾得上古钥匙。'
    },
    { chapterNo: 2, text: '第二章正文。' },
    { chapterNo: 3, text: '第三章正文。' },
    { chapterNo: 4, text: '第四章正文。' },
    { chapterNo: 5, text: '第五章正文。' },
    { chapterNo: 6, text: '第六章正文。' },
    { chapterNo: 7, text: '第七章正文。' }
  ];

  const report = evaluateStoryQuality(chapters);
  assert.ok(report.causalDebtLifecycle.staleCount >= 1);
  const stale = report.causalDebtLifecycle.staleDebts.find(d => d.debtId === 'debt_ancient_key');
  assert.ok(stale);
  assert.equal(stale.pendingChapters, 6);
  assert.ok(report.recommendations.some(r => r.includes('呆滞因果债')));
});

test('P1 Story Quality - detects consecutive repetitive chapter ending patterns', () => {
  const chapters = [
    { chapterNo: 1, text: '黑暗中伸出一只手，这究竟是谁？' },
    { chapterNo: 2, text: '信封上的火漆印记，难道是他？' },
    { chapterNo: 3, text: '他看着空荡荡的密室，真相到底在哪？' }
  ];

  const report = evaluateStoryQuality(chapters);
  assert.ok(report.repetitionRisk.repeatedEndingPatterns.length >= 1);
  assert.equal(report.repetitionRisk.repeatedEndingPatterns[0].punctuation, '？');
  assert.ok(report.recommendations.some(r => r.includes('章末悬念形式')));
});
