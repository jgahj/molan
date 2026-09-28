'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  HISTORICAL_SAMPLE_ID,
  analyzeRootCauses,
  generateRootCauseReportMarkdown
} = require('../lib/root-cause-analyzer');

test('root cause rules do not apply to an unlabelled sample', () => {
  const report = analyzeRootCauses({
    defectRegistry: { defects: [{ defect_id: 'DEF-PIPE-001', severity: 'B' }] }
  });

  assert.equal(report.status, 'NEEDS_MORE_DATA');
  assert.equal(report.overallVerdict, null);
  assert.equal(report.meta.systemicAttributionRatio, null);
  assert.deepEqual(report.unmappedDefectIds, ['DEF-PIPE-001']);
});

test('unmapped defects block a global root cause verdict and percentage', () => {
  const report = analyzeRootCauses({
    sample_id: HISTORICAL_SAMPLE_ID,
    defectRegistry: { defects: [{ defect_id: 'DEF-OTHER-001', severity: 'B' }] }
  });

  assert.equal(report.status, 'NEEDS_MORE_DATA');
  assert.equal(report.meta.coverageStatus, 'PARTIAL');
  assert.equal(report.meta.systemicAttributionRatio, null);
  assert.equal(report.overallVerdict, null);
  assert.deepEqual(report.unmappedDefectIds, ['DEF-OTHER-001']);
  assert.doesNotMatch(generateRootCauseReportMarkdown(report), /100%/);
});
