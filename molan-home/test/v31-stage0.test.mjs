import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildRuntimeContract } from '../scripts/export-runtime-contract.mjs';
import { buildQuotaContract } from '../scripts/export-quota-contract.mjs';
import { buildRuntimeCompatibilityIndex } from '../scripts/build-character-material-v31.mjs';
import { validateRuntimeCompatibility } from '../scripts/validate-runtime-compat.mjs';
import { validateMaterialSafety } from '../scripts/validate-material-safety.mjs';
import { validateQuota } from '../scripts/validate-quota.mjs';
import {
  buildPromptSet,
  deterministicBlindOrder,
  evaluateGenerationPairs,
  runGenerationEvaluation,
  validatePromptSet,
  writePromptSet
} from '../scripts/generation-eval.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_INDEX = path.join(REPO_ROOT, 'lib', 'character-material', 'index.json');
const SOURCE_REPORT = path.join(REPO_ROOT, 'lib', 'character-material', 'quality-report.json');
const SOURCE_RUNTIME = path.join(REPO_ROOT, 'lib', 'character-material.js');
const SOURCE_RUNTIME_CONTEXT = path.join(REPO_ROOT, 'lib', 'character-material-context.cjs');
const SOURCE_QUOTA = path.resolve(REPO_ROOT, '..', '资源库', 'quota-config.json');
// 需要复制约 112MB 的 index.json 到临时目录，默认跳过；`npm run test:slow` 或 MOLAN_SLOW_TESTS=1 时执行。
const SLOW = process.env.MOLAN_SLOW_TESTS === '1';
const slowTest = (name, fn) => (SLOW ? test(name, fn) : test.skip(name + '（慢测试，需 MOLAN_SLOW_TESTS=1）', fn));

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-v31-stage0-test-'));
  const indexPath = path.join(root, 'lib', 'character-material', 'index.json');
  const reportPath = path.join(root, 'lib', 'character-material', 'quality-report.json');
  const runtimePath = path.join(root, 'lib', 'character-material.js');
  const runtimeContextPath = path.join(root, 'lib', 'character-material-context.cjs');
  const quotaPath = path.join(root, '资源库', 'quota-config.json');
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.mkdirSync(path.dirname(quotaPath), { recursive: true });
  fs.copyFileSync(SOURCE_INDEX, indexPath);
  fs.copyFileSync(SOURCE_REPORT, reportPath);
  fs.copyFileSync(SOURCE_RUNTIME, runtimePath);
  fs.copyFileSync(SOURCE_RUNTIME_CONTEXT, runtimeContextPath);
  fs.copyFileSync(SOURCE_QUOTA, quotaPath);
  return { root, indexPath, reportPath, runtimePath, quotaPath };
}

function makeQuotaFixture(config) {
  const cells = [];
  for (const archetype of config.archetypes) {
    for (const bucket of Object.keys(config.genreBuckets)) {
      cells.push({
        archetype,
        bucket,
        effectiveChars: 12000,
        chars: 12000,
        targetChars: 25000,
        perBookCapChars: 3750,
        perBookEffectiveChars: { 'book-a': 3000, 'book-b': 3000, 'book-c': 3000, 'book-d': 3000 }
      });
    }
  }
  return {
    configVersion: config.version,
    cells,
    perBookCapChars: 3750,
    perBookCapViolations: [],
    platformCoverage: {
      enforced: false,
      pass: true,
      overall: {
        charCount: 480000,
        platforms: [
          { platform: '起点', charCount: 240000, charShare: 0.5 },
          { platform: '番茄', charCount: 240000, charShare: 0.5 }
        ],
        maxSinglePlatformShare: 0.5
      },
      focusSlices: []
    },
    hardFloorCells: [],
    totalUniqueChars: 480000
  };
}

function makeRichRecord(id, text) {
  const record = {
    schemaVersion: 'corpus-v3.1-rich-1',
    source: {
      sourceWorkId: `work-${id}`,
      canonicalWorkId: `work-${id}`,
      platform: '起点',
      title: `测试作品-${id}`,
      author: `测试作者-${id}`,
      completionStatus: 'completed'
    },
    person: {
      personId: `person-${id}`,
      canonicalName: `内部人物-${id}`,
      primaryArchetype: '冷静理智型',
      archetypeDistribution: { '冷静理智型': 1 },
      stateArchetype: []
    },
    sample: {
      id,
      rawText: text,
      safeText: text,
      auditText: text,
      dimension: 'dialogue',
      secondaryDimensions: [],
      scene: ['试探'],
      relationship: ['暧昧对象'],
      emotionalState: ['紧张'],
      surfaceIntent: '询问',
      subtext: null,
      subtextEvidence: [],
      subtextConfidence: 0,
      humanTextureSignals: [],
      humanTextureEvidence: {},
      htlEvidence: {},
      microPatterns: [],
      microPatternDetails: [],
      antiPatterns: [],
      evidence: { chapterIndex: 1, paragraphIndex: 1, charStart: 0, charEnd: text.length }
    },
    safety: {
      forbiddenTerms: [],
      forbiddenTermLayers: { coreTerms: [], localTerms: [], globalRiskTerms: [] },
      residualTerms: [],
      residualTermsByTrack: { safeText: [], auditText: [] },
      anonymizationScore: 1,
      textOverlap: { blocked: false }
    },
    quality: { confidence: 1, grade: 'A', criteriaMet: [], reasons: [], labelErrors: [] }
  };
  return record;
}

slowTest('Stage 0 snapshots and runtime validators use the copied old index only', () => {
  const fixture = makeFixture();
  try {
    const runtimeContract = buildRuntimeContract({
      indexPath: fixture.indexPath,
      reportPath: fixture.reportPath,
      runtimeSourcePath: fixture.runtimePath
    });
    assert.equal(runtimeContract.pass, true);
    assert.equal(runtimeContract.contract.sampleMinChars, 12);
    assert.equal(runtimeContract.contract.sampleMaxChars, 140);
    assert.equal(runtimeContract.contract.strongSampleMax, 2);
    assert.equal(runtimeContract.probe.normalizedLongLength, 140);
    assert.equal(runtimeContract.probe.shortSampleAccepted, false);
    assert.equal(runtimeContract.probe.strongSampleCount, 2);
    assert.equal(runtimeContract.schema.sample.text.minChars, 12);

    const quotaContract = buildQuotaContract({
      quotaConfigPath: fixture.quotaPath,
      indexPath: fixture.indexPath,
      reportPath: fixture.reportPath
    });
    assert.equal(quotaContract.pass, true);
    assert.equal(quotaContract.thresholds.cellHardFloor, 12000);
    assert.equal(quotaContract.thresholds.cellTarget, 25000);
    assert.equal(quotaContract.thresholds.perBookCellCapPct, 0.15);
    assert.equal(quotaContract.expected.cellCount, 40);

    const runtimeResult = validateRuntimeCompatibility({ indexPath: fixture.indexPath, reportPath: fixture.reportPath });
    assert.equal(runtimeResult.pass, true);
    assert.equal(runtimeResult.checks.normalizedLoad, true);
    assert.equal(runtimeResult.checks.strongSampleLimit.pass, true);

    const safetyResult = validateMaterialSafety({ indexPath: fixture.indexPath, reportPath: fixture.reportPath });
    assert.equal(safetyResult.pass, true);
    assert.equal(safetyResult.checks.continuousOverlap12.pass, true);

    const quotaResult = validateQuota({
      quotaConfigPath: fixture.quotaPath,
      indexPath: fixture.indexPath,
      reportPath: fixture.reportPath
    });
    assert.equal(quotaResult.pass, false);
    assert.equal(quotaResult.checks.hardFloor.failures.length, 40);
    assert.match(quotaResult.errors.join('\n'), /hard floor/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('Compatibility Builder filters invalid records and deduplicates across accepted samples', () => {
  const sourceText = '他把手机扣在桌上过了一会儿才抬头看她的眼睛。';
  const result = buildRuntimeCompatibilityIndex([
    makeRichRecord('first', sourceText),
    makeRichRecord('overlap', `前文${sourceText}后文`),
    makeRichRecord('short', '他沉默了。')
  ]);
  const audit = result.audit.compatibilityBuilder;
  assert.equal(audit.sourceRecordCount, 3);
  assert.equal(audit.compatibleSampleCount, 1);
  assert.equal(audit.rejectedSampleCount, 2);
  assert.deepEqual(result.general.samples.map(sample => sample.id), ['first']);
  assert.ok(audit.rejectedSamples.some(sample => sample.id === 'overlap' && sample.reasons.includes('runtime_sample_overlap')));
  assert.ok(audit.rejectedSamples.some(sample => sample.id === 'short'));
  assert.equal(Object.hasOwn(result.general.samples[0], 'rawText'), false);
});

slowTest('quota validator checks hard floor, 15 percent cap and platform character counts', () => {
  const fixture = makeFixture();
  try {
    const config = JSON.parse(fs.readFileSync(fixture.quotaPath, 'utf8'));
    config.platformCoverage = { enforce: false, maxSinglePlatformShare: 0.6 };
    config.focusSlices = [];
    const report = { version: config.version, quota: makeQuotaFixture(config), profileRelease: {}, publicationGate: {} };
    fs.writeFileSync(fixture.quotaPath, `${JSON.stringify(config)}\n`, 'utf8');
    fs.writeFileSync(fixture.reportPath, `${JSON.stringify(report)}\n`, 'utf8');
    const passing = validateQuota({ quotaConfigPath: fixture.quotaPath, indexPath: fixture.indexPath, reportPath: fixture.reportPath });
    assert.equal(passing.pass, true);
    assert.equal(passing.checks.hardFloor.pass, true);
    assert.equal(passing.checks.perBook15Percent.pass, true);
    assert.equal(passing.checks.platformChars.overall.platformCharTotal, 480000);

    report.quota.cells[0].perBookEffectiveChars['book-a'] = 3751;
    fs.writeFileSync(fixture.reportPath, `${JSON.stringify(report)}\n`, 'utf8');
    const failing = validateQuota({ quotaConfigPath: fixture.quotaPath, indexPath: fixture.indexPath, reportPath: fixture.reportPath });
    assert.equal(failing.pass, false);
    assert.equal(failing.checks.perBook15Percent.pass, false);
    assert.equal(failing.checks.perBook15Percent.violations.length, 1);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('fixed prompt catalog contains 20 categories and exactly 60 prompts', () => {
  const prompts = buildPromptSet();
  const validation = validatePromptSet(prompts);
  assert.equal(validation.pass, true);
  assert.equal(prompts.length, 60);
  assert.equal(new Set(prompts.map(prompt => prompt.category)).size, 20);
  for (const category of new Set(prompts.map(prompt => prompt.category))) {
    assert.equal(prompts.filter(prompt => prompt.category === category).length, 3);
  }
});

test('generation evaluator is deterministic and marks absent model outputs pending', () => {
  const prompts = buildPromptSet();
  const evalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-v31-eval-pending-'));
  const pending = runGenerationEvaluation({
    outputDir: evalRoot,
    promptsPath: path.join(evalRoot, 'missing-prompts.jsonl'),
    baselinePath: path.join(evalRoot, 'baseline.jsonl'),
    materialPath: path.join(evalRoot, 'material.jsonl')
  });
  try {
    assert.equal(pending.pass, false);
    assert.equal(pending.report.status, 'pending');
    assert.equal(pending.metrics.pendingPairCount, 60);
    assert.equal(pending.scores.every(row => row.status === 'pending' && row.scores === null), true);

    const baseline = prompts.map(prompt => ({ promptId: prompt.promptId, output: '她看了看门口，把手机放回桌上，过了一会儿才开口说明自己的决定。' }));
    const material = prompts.map(prompt => ({ promptId: prompt.promptId, output: '她先核对桌上的文件，又把杯子移到手边。“你说吧。”她抬头看着对方，没有急着回答。' }));
    const first = evaluateGenerationPairs({ prompts, baseline, material, seed: 20260828 });
    const second = evaluateGenerationPairs({ prompts, baseline, material, seed: 20260828 });
    assert.deepEqual(first, second);
    assert.equal(first.every(row => row.status === 'scored'), true);
    assert.equal(first.every(row => row.claimable === false), true);
    assert.equal(first.some(row => row.blindOrder.join('') === 'AB'), true);
    assert.equal(first.some(row => row.blindOrder.join('') === 'BA'), true);
    assert.notDeepEqual(deterministicBlindOrder('prompt-001', 1), deterministicBlindOrder('prompt-001', 2));
  } finally {
    fs.rmSync(evalRoot, { recursive: true, force: true });
  }
});

test('generation CLI writes prompts and pending reports only inside the requested directory', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-v31-eval-cli-'));
  const scriptPath = path.join(REPO_ROOT, 'scripts', 'generation-eval.mjs');
  try {
    const run = spawnSync(process.execPath, [scriptPath, '--write', '--out-dir', outputDir, '--seed', '20260828'], {
      cwd: path.resolve(REPO_ROOT, '..'),
      encoding: 'utf8'
    });
    assert.equal(run.status, 1);
    const promptPath = path.join(outputDir, 'prompts.jsonl');
    const scoresPath = path.join(outputDir, 'scores.jsonl');
    const metricsPath = path.join(outputDir, 'metrics.json');
    const reportPath = path.join(outputDir, 'report.json');
    assert.equal(fs.existsSync(promptPath), true);
    assert.equal(fs.readFileSync(promptPath, 'utf8').trim().split(/\r?\n/u).length, 60);
    assert.equal(JSON.parse(fs.readFileSync(metricsPath, 'utf8')).status, 'pending');
    assert.equal(JSON.parse(fs.readFileSync(reportPath, 'utf8')).claimable, false);
    assert.equal(fs.readFileSync(scoresPath, 'utf8').trim().split(/\r?\n/u).every(line => JSON.parse(line).status === 'pending'), true);
    assert.equal(fs.existsSync(path.join(outputDir, 'baseline.jsonl')), false);
    assert.equal(fs.existsSync(path.join(outputDir, 'material.jsonl')), false);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('writePromptSet writes the fixed JSONL set to tmp only', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-v31-prompts-'));
  const promptPath = path.join(root, 'eval', 'prompts.jsonl');
  try {
    const result = writePromptSet(promptPath);
    assert.equal(result.promptCount, 60);
    assert.equal(validatePromptSet(fs.readFileSync(promptPath, 'utf8').trim().split(/\r?\n/u).map(line => JSON.parse(line))).pass, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
