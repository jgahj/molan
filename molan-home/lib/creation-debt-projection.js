'use strict';

function projectDebts(debts, chapterNo) {
  const rows = structuredClone(debts);
  for (const debt of rows) {
    if (!['active', 'matured'].includes(debt.status)) continue;
    if (debt.type === 'micro' && chapterNo - debt.originChapter > 5) {
      debt.status = 'settled';
      debt.settledReason = '自然沉降为角色生活履历背景';
    } else if (chapterNo >= debt.maturationChapter) debt.status = 'matured';
  }
  for (const type of ['major', 'arc', 'micro']) {
    const active = rows.filter(debt => debt.type === type && ['active', 'matured'].includes(debt.status));
    for (const debt of active.slice(0, Math.max(0, active.length - 3))) debt.status = 'settled';
  }
  const active = rows.filter(debt => debt.status === 'active');
  const matured = rows.filter(debt => debt.status === 'matured');
  const lines = [];
  if (active.length || matured.length) {
    lines.push('【跨章节因果债务与细节复利】');
    if (matured.length) lines.push('【本章已成熟、建议兑现的因果伏笔】');
    for (const debt of matured) lines.push(`- [债务${debt.id}·第${debt.originChapter}章] ${debt.seed}${debt.suggestedPayoffAction ? `；建议：${debt.suggestedPayoffAction}` : ''}`);
    if (active.length) lines.push('【当前潜伏中、可呼应的未平账目】');
    for (const debt of active) lines.push(`- [第${debt.originChapter}章·${debt.type}] ${debt.seed}（预计第${debt.maturationChapter}章成熟）`);
  }
  return { allDebts: rows, active, matured, allActiveCount: active.length + matured.length,
    majorDebts: active.filter(debt => debt.type === 'major'), arcDebts: active.filter(debt => debt.type === 'arc'),
    microDebts: active.filter(debt => debt.type === 'micro'), block: lines.join('\n').slice(0, 1800) };
}
module.exports = { projectDebts };
