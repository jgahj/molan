'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { VALIDITY_CHECKS, checkValidityGate } = require('../lib/evaluation-validity-gate');

const evidenceIds = ['EV-1'];

function checks(status = 'PASS', refs = ['EV-1']) {
  return Object.fromEntries(VALIDITY_CHECKS.map(checkId => [checkId, {
    status,
    evidence_refs: refs
  }]));
}

test('paired A/B status requires all seven evidence-backed checks', () => {
  const result = checkValidityGate({
    mode: 'P3_BLIND_AB',
    checks: checks(),
    evidenceIds
  });

  assert.equal(result.evaluation_status, 'VALID_FOR_PAIRED_AB');
  assert.deepEqual(result.missing_checks, []);
});

test('a claimed PASS with an unbound reference remains unassessed', () => {
  const result = checkValidityGate({
    mode: 'P3_BLIND_AB',
    checks: checks('PASS', ['EV-MISSING']),
    evidenceIds
  });

  assert.equal(result.evaluation_status, 'INCONCLUSIVE');
  assert.equal(result.checks.task_fit.status, 'NOT_ASSESSED');
  assert.ok(result.missing_checks.includes('human_review_integrity'));
});

test('descriptive validity does not require paired A/B checks', () => {
  const result = checkValidityGate({
    mode: 'CORPUS_PROFILE',
    checks: checks(),
    evidenceIds
  });

  assert.equal(result.evaluation_status, 'VALID_FOR_DESCRIPTIVE');
  assert.ok(!result.required_checks.includes('paired_manifest_integrity'));
});

test('an evidenced integrity violation invalidates the evaluation', () => {
  const result = checkValidityGate({
    mode: 'P3_BLIND_AB',
    checks: checks(),
    evidenceIds,
    invalidityFindings: [{ code: 'blind_mapping_leak', evidence_refs: ['EV-1'] }]
  });

  assert.equal(result.evaluation_status, 'EVALUATION_INVALID');
  assert.equal(result.verified_invalidity_findings.length, 1);
});

test('an invalidity claim without a recognized, bound reference cannot pass the gate', () => {
  const result = checkValidityGate({
    mode: 'P3_BLIND_AB',
    checks: checks(),
    evidenceIds,
    invalidityFindings: [{ code: 'unrecognized_issue', evidence_refs: ['EV-1'] }]
  });

  assert.equal(result.evaluation_status, 'INCONCLUSIVE');
  assert.deepEqual(result.unverified_invalidity_findings, ['unrecognized_issue']);
});

test('different genre labels require a versioned mapping with bound evidence', () => {
  const input = {
    mode: 'P3_BLIND_AB',
    checks: checks(),
    evidenceIds,
    genreMapping: {
      source_genre: '悬疑诡秘',
      target_genre: '悬疑脑洞',
      status: 'UNVERIFIED'
    }
  };
  const blocked = checkValidityGate(input);

  assert.equal(blocked.evaluation_status, 'INCONCLUSIVE');
  assert.equal(blocked.genre_mapping_status, 'GENRE_MAPPING_UNVERIFIED');
  assert.ok(blocked.missing_checks.includes('task_fit'));

  input.genreMapping = {
    source_genre: '悬疑诡秘',
    target_genre: '悬疑脑洞',
    status: 'VERIFIED',
    mapping_id: 'GENRE-MAP-1',
    evidence_refs: ['EV-1']
  };
  assert.equal(checkValidityGate(input).evaluation_status, 'VALID_FOR_PAIRED_AB');
});
