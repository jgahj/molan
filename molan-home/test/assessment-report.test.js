'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { VALIDITY_CHECKS } = require('../lib/evaluation-validity-gate');
const { buildAssessmentReport, renderAssessmentMarkdown } = require('../lib/assessment-report');

test('assessment report preserves required sections and unknowns without input', () => {
  const report = buildAssessmentReport();
  const markdown = renderAssessmentMarkdown(report);

  assert.equal(report.schemaVersion, 'molan-assessment-v1');
  assert.equal(report.evaluationStatus, 'INCONCLUSIVE');
  assert.ok(report.unknowns.includes('assessment_input_not_provided'));
  assert.equal([...markdown.matchAll(/^## \d+\./gm)].length, 15);
});

test('assessment report derives paired status from bound validity evidence', () => {
  const report = buildAssessmentReport({
    evaluation_mode: 'P3_BLIND_AB',
    evidence: [{
      runId: 'RUN-1', taskId: 'TASK-1', chapterIndex: 1, paragraphIndex: 2,
      evidenceId: 'EV-1', sourceFile: 'sample.md', textHash: 'sha256:abc',
      verified: true, quote: '关键证据'
    }],
    validity_checks: Object.fromEntries(VALIDITY_CHECKS.map(checkId => [checkId, {
        status: 'PASS',
        evidence_refs: ['EV-1']
      }]))
  });

  assert.equal(report.evaluationStatus, 'VALID_FOR_PAIRED_AB');
  assert.equal(report.evidence[0].verified, true);
});

test('assessment report redacts overlong quoted evidence and records the gap', () => {
  const report = buildAssessmentReport({
    evidence: [{ evidenceId: 'EV-2', verified: true, quote: '甲'.repeat(21) }]
  });

  assert.equal(report.evidence[0].quote, null);
  assert.equal(report.evidence[0].verified, false);
  assert.ok(report.unknowns.includes('evidence[0].quote_exceeds_20_han_characters'));
});
