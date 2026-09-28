'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectNovelQualityDefects, generateDefectReportMarkdown } = require('../lib/defect-detector');

test('historical defect rules do not apply without an explicit supported sample', () => {
  const result = detectNovelQualityDefects({
    generatedProfile: { metadata: { value: { title: 'unrelated sample' } } }
  });

  assert.equal(result.status, 'NEEDS_MORE_DATA');
  assert.equal(result.scope, 'unsupported_sample');
  assert.deepEqual(result.defects, []);
  assert.ok(Object.values(result.defect_vector.values).every(value => value === null));
  assert.match(generateDefectReportMarkdown(result), /NEEDS_MORE_DATA/);
});

test('a historical sample ID does not authorize rules against a different profile', () => {
  const result = detectNovelQualityDefects({
    sample_id: 'yueyuan-2026-09-10',
    generatedProfile: {
      metadata: { value: { title: 'different work' } },
      provenance: { generation_version: 'other-version' }
    }
  });

  assert.equal(result.status, 'NEEDS_MORE_DATA');
  assert.deepEqual(result.defects, []);
  assert.ok(result.missing_evidence.includes('generated_profile.title'));
  assert.ok(result.missing_evidence.includes('generated_profile.provenance.generation_version'));
});
