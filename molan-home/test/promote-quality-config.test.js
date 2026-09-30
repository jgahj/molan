'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { compareQualityVectors } = require('../lib/evolution/quality-vector-ab');

test('promotion CLI leaves the explicit candidate config untouched when Golden provenance is blocked', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-quality-promote-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const reportPath = path.join(directory, 'report.json');
  const candidatePath = path.join(directory, 'candidate.json');
  const report = compareQualityVectors({});
  const candidate = {
    schemaVersion: 'quality-promotion-target-v1',
    qualityReportHash: report.reportHash,
    inputHash: report.inputHash,
    model: 'candidate-model',
    modelParametersHash: 'b'.repeat(64),
    versions: { pipelineVersion: 'p2', promptVersion: 'r2', genreProfileVersion: 'g2', styleVersion: 's2' }
  };
  fs.writeFileSync(reportPath, JSON.stringify(report), 'utf8');
  fs.writeFileSync(candidatePath, JSON.stringify(candidate), 'utf8');
  const original = fs.readFileSync(candidatePath, 'utf8');
  const cliPath = path.resolve(__dirname, '../scripts/promote-quality-config.mjs');
  const result = spawnSync(process.execPath, ['--no-warnings', cliPath, '--report', reportPath, '--candidate-config', candidatePath], { encoding: 'utf8' });

  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stdout, /golden_corpus_unapproved/);
  assert.equal(fs.readFileSync(candidatePath, 'utf8'), original);
  assert.deepEqual(fs.readdirSync(directory).sort(), ['candidate.json', 'report.json']);
});

test('promotion CLI rejects a missing explicit candidate path without writing files', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-quality-promote-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const reportPath = path.join(directory, 'report.json');
  fs.writeFileSync(reportPath, '{}', 'utf8');
  const cliPath = path.resolve(__dirname, '../scripts/promote-quality-config.mjs');
  const result = spawnSync(process.execPath, ['--no-warnings', cliPath, '--report', reportPath], { encoding: 'utf8' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /candidate-config/);
  assert.deepEqual(fs.readdirSync(directory), ['report.json']);
});
