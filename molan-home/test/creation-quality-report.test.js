'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCreationQualityReport } = require('../lib/creation-quality-report');

test('quality report keeps missing audit counts unknown and latest evidence bound to content', () => {
  const valid = { id: 'a1', chapterNo: 1, contentHash: 'hash-1', createdAt: 1,
    evidence: { protocol: 'generation-v2-audit-v1', generationId: 'run-1', chapterNo: 1,
      contentHash: 'hash-1', passed: true, deterministicAudit: { passed: true, blockerCount: 0 },
      semanticAudit: { passed: true, issues: [{ category: 'experience', severity: 'warning' }] },
      quality: { qualityVector: { language: { value: null, status: 'NOT_MEASURED' } } } } };
  const missing = { id: 'a2', chapterNo: 2, contentHash: 'hash-2', createdAt: 2 };
  let report = buildCreationQualityReport([missing, valid]);
  assert.equal(report.summary.passedCount, 1);
  assert.equal(report.summary.unmeasuredCount, 1);
  assert.equal(report.summary.blockerTotal, null);
  assert.equal(report.chapters[1].passed, null);
  assert.equal(report.chapters[0].experienceCount, 1);
  assert.deepEqual(report.chapters[0].qualityVector.language, { value: null, status: 'NOT_MEASURED' });
  assert.equal(report.chapters[0].evidenceSource.generationId, 'run-1');
  assert.equal(report.chapters[0].evidenceStatus, 'JUDGED');
  const contradictory = structuredClone(valid);
  contradictory.evidence.semanticAudit.passed = false;
  assert.equal(buildCreationQualityReport([contradictory]).chapters[0].passed, null);
  report = buildCreationQualityReport([valid, { ...valid, id: 'a3', createdAt: 3, contentHash: 'different' }]);
  assert.equal(report.chapters.length, 1);
  assert.equal(report.chapters[0].evidenceStatus, 'NOT_MEASURED');
  assert.equal(report.summary.passedCount, 0);
});

test('quality report weak streak requires consecutive measured failing chapters', () => {
  const row = chapterNo => ({ id: `a${chapterNo}`, chapterNo, contentHash: 'hash', createdAt: chapterNo,
    evidence: { protocol: 'generation-v2-audit-v1', chapterNo, contentHash: 'hash', passed: false,
      deterministicAudit: { passed: false, blockerCount: 1 }, semanticAudit: { passed: true, blockerCount: 0 } } });
  const report = buildCreationQualityReport([row(1), row(3), row(4)]);
  assert.deepEqual(report.summary.weakStreakChapters, [3, 4]);
  assert.equal(report.summary.blockerTotal, 3);
});
