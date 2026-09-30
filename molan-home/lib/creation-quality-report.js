'use strict';

function countBlockers(audit) {
  if (!audit || typeof audit !== 'object') return null;
  if (Number.isSafeInteger(audit.blockerCount) && audit.blockerCount >= 0) return audit.blockerCount;
  if (Array.isArray(audit.issues)) return audit.issues.filter(issue => issue?.severity === 'blocker').length;
  return null;
}

function buildCreationQualityReport(records) {
  const latest = new Map();
  for (const row of [...records].sort((a, b) => a.createdAt - b.createdAt || String(a.id).localeCompare(String(b.id)))) {
    const evidence = row.evidence;
    const deterministic = evidence?.deterministicAudit;
    const semantic = evidence?.semanticAudit;
    const counts = [countBlockers(deterministic), countBlockers(semantic)];
    const measured = evidence?.protocol === 'generation-v2-audit-v1' &&
      evidence.contentHash === row.contentHash && evidence.chapterNo === row.chapterNo &&
      typeof evidence.passed === 'boolean' && typeof deterministic?.passed === 'boolean' &&
      typeof semantic?.passed === 'boolean' && counts.every(count => count !== null);
    const issues = [...(Array.isArray(deterministic?.issues) ? deterministic.issues : []),
      ...(Array.isArray(semantic?.issues) ? semantic.issues : [])];
    latest.set(row.chapterNo, { chapterNo: row.chapterNo,
      passed: measured ? evidence.passed : null,
      blockerCount: measured ? counts.reduce((sum, count) => sum + count, 0) : null,
      experienceCount: measured ? issues.filter(issue => issue?.category === 'experience').length : null,
      lineEditCount: measured ? issues.filter(issue => issue?.category === 'lineedit').length : null,
      categories: [...new Set(issues.map(issue => issue?.category).filter(Boolean))].sort(),
      auditedAt: row.createdAt, evidenceStatus: measured ? 'MEASURED' : 'NOT_MEASURED',
      evidenceSource: { auditId: row.id, generationId: evidence?.generationId || null, contentHash: row.contentHash },
      qualityVector: evidence?.quality?.qualityVector || evidence?.quality?.vector || null });
  }
  const chapters = [...latest.values()].sort((a, b) => a.chapterNo - b.chapterNo);
  let weakStreak = [], current = [];
  const categoryTotals = {};
  for (const chapter of chapters) {
    if (chapter.passed === false || chapter.blockerCount > 0) {
      if (current.length && chapter.chapterNo !== current[current.length - 1] + 1) current = [];
      current.push(chapter.chapterNo);
      if (current.length > weakStreak.length) weakStreak = [...current];
    } else current = [];
    for (const category of chapter.categories) categoryTotals[category] = (categoryTotals[category] || 0) + 1;
  }
  return { ok: true, summary: { chapterCount: chapters.length,
    passedCount: chapters.filter(chapter => chapter.passed === true).length,
    unmeasuredCount: chapters.filter(chapter => chapter.evidenceStatus === 'NOT_MEASURED').length,
    blockerTotal: chapters.some(chapter => chapter.blockerCount === null) ? null : chapters.reduce((sum, chapter) => sum + chapter.blockerCount, 0),
    weakStreakChapters: weakStreak, categoryTotals }, chapters };
}

module.exports = { buildCreationQualityReport };
