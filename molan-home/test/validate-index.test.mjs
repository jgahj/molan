import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { combineValidationResults, validatePublicationState } from '../scripts/validate-index.mjs';

const passingPublication = { pass: true, errors: [], warnings: [] };

test('final index validation requires every independent gate to pass', () => {
  const result = combineValidationResults({
    runtimeCompatibility: { pass: true, errors: [], warnings: ['report missing'] },
    materialSafety: { pass: false, errors: ['residual terms'], warnings: [] },
    quota: { pass: true, errors: [], warnings: [] },
    publication: passingPublication,
  });
  assert.equal(result.pass, false);
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.errors, ['residual terms']);
  assert.deepEqual(result.warnings, ['report missing']);
  assert.equal(result.gates.materialSafety.pass, false);
});

test('final index validation preserves malformed child results as failures', () => {
  const result = combineValidationResults({ runtimeCompatibility: null });
  assert.equal(result.pass, false);
  assert.match(result.errors[0], /did not return a result/);
  assert.match(result.errors[1], /publication validator did not return a result/);
});

test('final index validation does not turn a malformed passing child into a passing gate', () => {
  const result = combineValidationResults({
    runtimeCompatibility: { pass: true, errors: 'not-an-array', warnings: [] },
    publication: passingPublication,
  });
  assert.equal(result.pass, false);
  assert.equal(result.gates.runtimeCompatibility.pass, false);
  assert.ok(result.errors.includes('runtimeCompatibility validator returned malformed result'));
});

test('final index validation treats pass true with blocked status as blocked', () => {
  const result = combineValidationResults({
    runtimeCompatibility: { pass: true, status: 'blocked', errors: [], warnings: [] },
    publication: passingPublication,
  });
  assert.equal(result.pass, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.gates.runtimeCompatibility.pass, false);
  assert.ok(result.errors.includes('runtimeCompatibility validator reported blocked status'));
});

test('publication gate requires all actual release flags and matching report state', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-index-validation-'));
  const indexPath = path.join(tempDir, 'index.json');
  const reportPath = path.join(tempDir, 'quality-report.json');
  const index = {
    version: 'v1',
    sourceHash: 'hash-1',
    published: true,
    markdownPublished: true,
    profilesPublished: true,
  };
  const report = {
    version: 'v1',
    sourceHash: 'hash-1',
    publicationGate: { pass: true },
    profileRelease: { pass: true },
    audit: { strongSamplesPublished: true, markdownPublished: true },
  };
  try {
    fs.writeFileSync(indexPath, JSON.stringify(index), 'utf8');
    fs.writeFileSync(reportPath, JSON.stringify(report), 'utf8');
    assert.equal(validatePublicationState({ indexPath, reportPath }).pass, true);

    index.profilesPublished = false;
    fs.writeFileSync(indexPath, JSON.stringify(index), 'utf8');
    const result = validatePublicationState({ indexPath, reportPath });
    assert.equal(result.pass, false);
    assert.ok(result.errors.includes('index.profilesPublished 必须为 true'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
