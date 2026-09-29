import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY = path.resolve(path.join(ROOT, '..'));
const BASELINE_DIR = path.join(ROOT, 'data', 'evolution', 'baseline');

const { buildGoldenSuite, validateGoldenSuite } = require('../lib/evolution/golden-suite.js');
const { runFeatureAudit } = await import('./audit-features.mjs');

function runGit(args) {
  const result = spawnSync('git', args, { cwd: REPOSITORY, encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  return String(result.stdout || '').trim();
}

export async function recordBaseline() {
  const commit = runGit(['rev-parse', 'HEAD']);
  const branch = runGit(['branch', '--show-current']) || 'main';
  const timestamp = new Date().toISOString();

  process.stdout.write(`Recording baseline for commit ${commit} on ${branch}...\n`);

  // 1. Golden Suite Audit
  process.stdout.write('1. Validating Golden Suite...\n');
  const suite = buildGoldenSuite();
  const goldenValidation = validateGoldenSuite(suite);
  const goldenResult = {
    schemaVersion: 'golden-result-v1',
    commit,
    branch,
    timestamp,
    valid: goldenValidation.valid === true,
    status: goldenValidation.valid ? 'PASS' : 'FAIL',
    taskCount: goldenValidation.taskCount,
    genreCounts: goldenValidation.genreCounts,
    failures: goldenValidation.failures || [],
    fixtureStatus: suite.fixtureStatus,
    dataStatus: suite.dataStatus
  };
  await writeFile(
    path.join(BASELINE_DIR, 'golden-result.json'),
    `${JSON.stringify(goldenResult, null, 2)}\n`,
    'utf8'
  );

  // 2. Feature Contract Audit
  process.stdout.write('2. Running Feature Contract Audit...\n');
  const featureAudit = await runFeatureAudit({ root: ROOT, write: () => {} });
  const featureResult = {
    schemaVersion: 'feature-result-v1',
    commit,
    branch,
    timestamp,
    gate: featureAudit.gate,
    status: featureAudit.gate === 'PASS' ? 'PASS' : 'FAIL',
    contracts: featureAudit.results.length,
    failedContracts: featureAudit.failures,
    unknownMarkers: featureAudit.unknownMarkers,
    unmappedControls: featureAudit.unmappedControls,
    interactiveControls: {
      total: featureAudit.controlScan.total,
      mapped: featureAudit.controlScan.explicit,
      needsReview: featureAudit.controlScan.unmapped.length,
      outOfScope: featureAudit.controlScan.excluded
    },
    results: featureAudit.results
  };
  await writeFile(
    path.join(BASELINE_DIR, 'feature-result.json'),
    `${JSON.stringify(featureResult, null, 2)}\n`,
    'utf8'
  );

  process.stdout.write('3. Running Test Suite...\n');
  const args = ['--experimental-sqlite', '--no-warnings', '--test', 'test/**/*.test.js', 'test/**/*.test.mjs'];
  const testProc = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  });
  
  const stdout = testProc.stdout || '';
  const stderr = testProc.stderr || '';
  const testSummaryMatch = stdout.match(/#\s+tests\s+(\d+)[\s\S]*?#\s+pass\s+(\d+)[\s\S]*?#\s+fail\s+(\d+)[\s\S]*?#\s+cancelled\s+(\d+)[\s\S]*?#\s+skipped\s+(\d+)[\s\S]*?#\s+duration_ms\s+([\d.]+)/i);

  const testResult = {
    schemaVersion: 'test-result-v1',
    commit,
    branch,
    timestamp,
    status: testProc.status === 0 ? 'PASS' : 'FAIL',
    exitCode: testProc.status,
    totalTests: testSummaryMatch ? parseInt(testSummaryMatch[1], 10) : null,
    passed: testSummaryMatch ? parseInt(testSummaryMatch[2], 10) : null,
    failed: testSummaryMatch ? parseInt(testSummaryMatch[3], 10) : null,
    cancelled: testSummaryMatch ? parseInt(testSummaryMatch[4], 10) : null,
    skipped: testSummaryMatch ? parseInt(testSummaryMatch[5], 10) : null,
    durationMs: testSummaryMatch ? parseFloat(testSummaryMatch[6]) : null
  };
  await writeFile(
    path.join(BASELINE_DIR, 'test-result.json'),
    `${JSON.stringify(testResult, null, 2)}\n`,
    'utf8'
  );

  // 4. Generation Baseline Manifest
  process.stdout.write('4. Writing Generation Baseline Manifest...\n');
  const baselineManifest = {
    schemaVersion: 'generation-baseline-manifest-v1',
    pipelineVersion: 'generation-v2.1',
    modelId: 'gpt-5.6-luna',
    promptVersion: 'writer-v7',
    contractVersion: 'chapter-contract-v2',
    styleVersion: 'style-dna-v1',
    genreVersion: 'genre-matrix-v2',
    contextVersion: 'context-plan-v1',
    sourceCommit: commit,
    sourceBranch: branch,
    generatedAt: timestamp,
    reproducible: true,
    status: {
      tests: testResult.status,
      golden: goldenResult.status,
      features: featureResult.status
    },
    evidence: {
      codeManifest: 'code-manifest.json',
      uiManifest: 'ui-manifest.json',
      testResult: 'test-result.json',
      goldenResult: 'golden-result.json',
      featureResult: 'feature-result.json',
      sourceHashes: 'source-hashes.json'
    },
    protectedDataRead: false
  };
  await writeFile(
    path.join(BASELINE_DIR, 'generation-baseline-manifest.json'),
    `${JSON.stringify(baselineManifest, null, 2)}\n`,
    'utf8'
  );

  process.stdout.write('Baseline recorded successfully.\n');
  return {
    goldenResult,
    featureResult,
    testResult,
    baselineManifest
  };
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  recordBaseline().catch(err => {
    process.stderr.write(`RECORD BASELINE ERROR: ${String(err && err.stack || err)}\n`);
    process.exitCode = 1;
  });
}
