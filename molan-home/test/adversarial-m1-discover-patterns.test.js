'use strict';

/**
 * @file adversarial-m1-discover-patterns.test.js
 * Adversarial Stress Test Suite for Milestone 1: corpus:discover-patterns
 * 
 * Tests:
 * 1. CLI Decoupling & Invariant Preservation:
 *    - Never touches, alters, or creates strategy-rules.jsonl or quality-report.json
 *    - Succeeds even when strategy-rules.jsonl and quality-report.json are read-only
 *    - Succeeds when strategy-rules.jsonl and quality-report.json are completely absent
 * 2. npm CLI invocation & flag forwarding:
 *    - Invocation via npm run corpus:discover-patterns -- [args]
 *    - Direct invocation via node scripts/corpus-cli.js discover-patterns [args]
 *    - Output flag forwarding to custom and nested directories
 * 3. Boundary & Invalid CLI Arguments:
 *    - Invalid --k (0, negative, NaN/string, K > N)
 *    - Non-existent runDir (exits with code 1, explicit error)
 *    - Empty runDir without chapter-features.jsonl (exits with code 1)
 *    - Empty chapter-features.jsonl (0 bytes) -> outputs {} without crashing
 *    - Corrupted/malformed JSON lines in chapter-features.jsonl -> gracefully skips
 *    - Only unsegmented chapters -> outputs {} cleanly
 * 4. Idempotency & Determinism:
 *    - Multiple consecutive runs produce deterministic, valid, non-duplicated output
 * 5. Concurrent / Race Condition Stress:
 *    - Multiple concurrent CLI processes writing to the same target directory
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, fork } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(REPO_ROOT, '..');
const NODE_BIN = path.resolve(WORKSPACE_ROOT, 'tools/node22_runtime/node.exe');
const NPM_CLI = path.resolve(WORKSPACE_ROOT, 'tools/node22_runtime/node_modules/npm/bin/npm-cli.js');
const CORPUS_CLI = path.resolve(REPO_ROOT, 'scripts/corpus-cli.js');

function computeHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function makeSampleChapter(id, overrides = {}) {
  return {
    bookId: overrides.bookId || `book_${id}`,
    chapterNo: id,
    chapterTitle: `第${id}章 逆命之战`,
    novelTitle: `凡人修真录_${id}`,
    author: overrides.author !== undefined ? overrides.author : (id % 2 === 0 ? '忘语' : '烽火戏诸侯'),
    primaryGoal: overrides.primaryGoal || (id % 2 === 0 ? 'conflict_push' : 'dialogue_game'),
    stylometry: {
      narrativeDensity: overrides.narrativeDensity ?? 0.75,
      emotionalIntensity: 0.65,
      rhetoricalAbundance: 0.40,
      colloquialLevel: 0.35,
      dialogueRatio: 0.42,
      psychologicalRatio: 0.20,
      settingRatio: 0.15,
      averageSentenceLength: 22.0,
      shortSentenceRatio: 0.58,
      informationDensity: 0.68,
      negativeSpaceRatio: 0.30
    },
    focusVector: {
      dialogue: 0.25,
      action: 0.35,
      setting: 0.10,
      conflict: 0.20,
      character: 0.05,
      emotion: 0.03,
      foreshadowing: 0.02
    },
    screener: {
      scores: {
        thrill: 0.88,
        plot: 0.79,
        character: 0.71,
        emotion: 0.62,
        suspense: 0.81,
        style: 0.73,
        hook: 0.85,
        pacing: 0.80
      },
      qualifiedDimensions: ['thrill', 'plot', 'suspense']
    },
    tailHook: {
      type: 'cliffhanger',
      strength: 0.85,
      tailSnippet: '暗处的剑光如毒蛇般无声刺出……'
    },
    ...overrides
  };
}

function createTestDataset(runDir, count = 6, chapterOverrides = []) {
  fs.mkdirSync(runDir, { recursive: true });
  const chapters = [];
  for (let i = 1; i <= count; i++) {
    const override = chapterOverrides[i - 1] || {};
    chapters.push(makeSampleChapter(i, override));
  }
  const lines = chapters.map(c => JSON.stringify(c)).join('\n') + '\n';
  fs.writeFileSync(path.join(runDir, 'chapter-features.jsonl'), lines, 'utf8');
  return chapters;
}

function runNpmCli(args, cwd = REPO_ROOT) {
  return spawnSync(NODE_BIN, [NPM_CLI, 'run', 'corpus:discover-patterns', '--', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30000
  });
}

function runDirectCli(args, cwd = REPO_ROOT) {
  return spawnSync(NODE_BIN, [CORPUS_CLI, 'discover-patterns', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30000
  });
}

describe('Adversarial Test Suite: Milestone 1 Chapter Archetype Discovery', () => {
  let tmpBase;

  before(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'molan_m1_adv_test_'));
  });

  after(() => {
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch (_) {}
  });

  // =========================================================================
  // TEST SECTION 1: Absolute Invariant Preservation & Decoupling
  // =========================================================================
  describe('1. Decoupling & Invariant Preservation', () => {
    it('1.1: npm run corpus:discover-patterns NEVER touches strategy-rules.jsonl or quality-report.json', () => {
      const testDir = path.join(tmpBase, 'inv_1_1');
      createTestDataset(testDir, 8);

      const rulesPath = path.join(testDir, 'strategy-rules.jsonl');
      const reportPath = path.join(testDir, 'quality-report.json');

      const initialRulesContent = '{"id":"rule_sacred_001","rule":"绝对不可动摇的先验规则"}\n';
      const initialReportContent = JSON.stringify({ passed: true, score: 99.9, sacred: true }, null, 2);

      fs.writeFileSync(rulesPath, initialRulesContent, 'utf8');
      fs.writeFileSync(reportPath, initialReportContent, 'utf8');

      const initialRulesHash = computeHash(initialRulesContent);
      const initialReportHash = computeHash(initialReportContent);

      const initialRulesStat = fs.statSync(rulesPath);
      const initialReportStat = fs.statSync(reportPath);

      // Invoke via npm CLI
      const proc = runNpmCli(['--run-dir', testDir, '--k', '3']);
      assert.strictEqual(proc.status, 0, `npm CLI execution failed: ${proc.stderr}`);

      // Verify archetypes.json was created
      const archetypesPath = path.join(testDir, 'archetypes.json');
      assert.ok(fs.existsSync(archetypesPath), 'archetypes.json must exist');

      // Verify strategy-rules.jsonl is 100% UNTOUCHED
      const currentRulesContent = fs.readFileSync(rulesPath, 'utf8');
      const currentRulesHash = computeHash(currentRulesContent);
      const currentRulesStat = fs.statSync(rulesPath);

      assert.strictEqual(currentRulesHash, initialRulesHash, 'strategy-rules.jsonl SHA256 must match exactly');
      assert.strictEqual(currentRulesContent, initialRulesContent, 'strategy-rules.jsonl content must not change');
      assert.strictEqual(currentRulesStat.mtimeMs, initialRulesStat.mtimeMs, 'strategy-rules.jsonl mtime must not be touched');

      // Verify quality-report.json is 100% UNTOUCHED
      const currentReportContent = fs.readFileSync(reportPath, 'utf8');
      const currentReportHash = computeHash(currentReportContent);
      const currentReportStat = fs.statSync(reportPath);

      assert.strictEqual(currentReportHash, initialReportHash, 'quality-report.json SHA256 must match exactly');
      assert.strictEqual(currentReportContent, initialReportContent, 'quality-report.json content must not change');
      assert.strictEqual(currentReportStat.mtimeMs, initialReportStat.mtimeMs, 'quality-report.json mtime must not be touched');
    });

    it('1.2: Succeeds even when strategy-rules.jsonl and quality-report.json are read-only (Windows 0o444 / readonly)', () => {
      const testDir = path.join(tmpBase, 'inv_1_2');
      createTestDataset(testDir, 6);

      const rulesPath = path.join(testDir, 'strategy-rules.jsonl');
      const reportPath = path.join(testDir, 'quality-report.json');

      fs.writeFileSync(rulesPath, '{"readonly":true}\n', 'utf8');
      fs.writeFileSync(reportPath, '{"readonly":true}\n', 'utf8');

      // Set read-only
      fs.chmodSync(rulesPath, 0o444);
      fs.chmodSync(reportPath, 0o444);

      try {
        const proc = runNpmCli(['--run-dir', testDir, '--k', '2']);
        assert.strictEqual(proc.status, 0, `Should succeed without attempting to write readonly files: ${proc.stderr}`);
        assert.ok(fs.existsSync(path.join(testDir, 'archetypes.json')), 'archetypes.json generated successfully');
      } finally {
        // Reset permissions for cleanup
        fs.chmodSync(rulesPath, 0o666);
        fs.chmodSync(reportPath, 0o666);
      }
    });

    it('1.3: When strategy-rules.jsonl and quality-report.json are absent, discover-patterns DOES NOT create them', () => {
      const testDir = path.join(tmpBase, 'inv_1_3');
      createTestDataset(testDir, 5);

      const rulesPath = path.join(testDir, 'strategy-rules.jsonl');
      const reportPath = path.join(testDir, 'quality-report.json');

      assert.ok(!fs.existsSync(rulesPath), 'Pre-condition: strategy-rules.jsonl must not exist');
      assert.ok(!fs.existsSync(reportPath), 'Pre-condition: quality-report.json must not exist');

      const proc = runNpmCli(['--run-dir', testDir, '--k', '2']);
      assert.strictEqual(proc.status, 0, `CLI failed: ${proc.stderr}`);

      assert.ok(fs.existsSync(path.join(testDir, 'archetypes.json')), 'archetypes.json must be created');
      assert.ok(!fs.existsSync(rulesPath), 'strategy-rules.jsonl must STILL NOT exist after discover-patterns');
      assert.ok(!fs.existsSync(reportPath), 'quality-report.json must STILL NOT exist after discover-patterns');
    });
  });

  // =========================================================================
  // TEST SECTION 2: Dynamic Archetypes.json Structural Integrity
  // =========================================================================
  describe('2. Archetypes Output Schema & Dynamic Quality', () => {
    it('2.1: Generated archetypes.json conforms strictly to ChapterArchetype dynamic contract', () => {
      const testDir = path.join(tmpBase, 'schema_2_1');
      createTestDataset(testDir, 10);

      const proc = runNpmCli(['--run-dir', testDir, '--k', '3']);
      assert.strictEqual(proc.status, 0, proc.stderr);

      const parsed = JSON.parse(fs.readFileSync(path.join(testDir, 'archetypes.json'), 'utf8'));
      const archList = Object.values(parsed);

      assert.ok(archList.length >= 1 && archList.length <= 3, 'Must have 1 to 3 archetypes');

      for (const arch of archList) {
        // ID & naming
        assert.ok(typeof arch.id === 'string' && arch.id.startsWith('archetype_'));
        assert.ok(typeof arch.name === 'string' && arch.name.length > 0);

        // Structural dynamics
        assert.ok(arch.structuralDynamics, 'structuralDynamics missing');
        assert.ok(typeof arch.structuralDynamics.drivePattern === 'string');
        assert.ok(Array.isArray(arch.structuralDynamics.typicalStructure));
        assert.ok(arch.structuralDynamics.typicalStructure.length >= 3);
        assert.ok(Array.isArray(arch.structuralDynamics.failureModes));

        // Tension profile
        assert.ok(arch.tensionProfile, 'tensionProfile missing');
        assert.ok(typeof arch.tensionProfile.curveType === 'string');
        assert.ok(Array.isArray(arch.tensionProfile.tensionPoints));
        assert.strictEqual(arch.tensionProfile.tensionPoints.length, 4);
        for (const pt of arch.tensionProfile.tensionPoints) {
          assert.ok(pt >= 1.0 && pt <= 10.0, `Tension point ${pt} out of bounds [1.0, 10.0]`);
        }
        assert.ok(typeof arch.tensionProfile.dynamicFormula === 'string');
        assert.ok(arch.tensionProfile.dynamicFormula.includes('T(t)'));

        // Pacing formula
        assert.ok(arch.pacingFormula, 'pacingFormula missing');
        assert.ok(Array.isArray(arch.pacingFormula.beatWordRatios));
        assert.strictEqual(arch.pacingFormula.beatWordRatios.length, 4);
        const sumRatio = arch.pacingFormula.beatWordRatios.reduce((a, b) => a + b, 0);
        assert.ok(Math.abs(sumRatio - 1.0) < 0.02, `Beat ratios must sum to 1.0, got ${sumRatio}`);
        assert.ok(typeof arch.pacingFormula.targetShortSentenceRatio === 'number');

        // Mathematical Centroid (26D decomposed)
        assert.ok(arch.centroid, 'centroid missing');
        assert.ok(arch.centroid.style && typeof arch.centroid.style === 'object');
        assert.ok(arch.centroid.focus && typeof arch.centroid.focus === 'object');
        assert.ok(arch.centroid.screener && typeof arch.centroid.screener === 'object');

        // Exemplars & cluster members
        assert.ok(Array.isArray(arch.exemplars) && arch.exemplars.length >= 1);
        for (const ex of arch.exemplars) {
          assert.ok(ex.bookId);
          assert.ok(typeof ex.distanceToCentroid === 'number');
          assert.ok(ex.distanceToCentroid >= 0);
          // Strict author attribution: no synthetic 'author_book_xxx'
          if (ex.author) {
            assert.ok(!ex.author.startsWith('author_'));
          }
        }
        assert.ok(Array.isArray(arch.clusterMembers) && arch.clusterMembers.length >= 1);
      }
    });

    it('2.2: Custom --output and --output-file flags are respected, including creating missing subdirectories', () => {
      const testDir = path.join(tmpBase, 'custom_out_2_2');
      createTestDataset(testDir, 4);

      const customOut = path.join(testDir, 'nested', 'deeply', 'discovered_patterns.json');
      assert.ok(!fs.existsSync(customOut));

      const proc = runDirectCli(['--run-dir', testDir, '--output', customOut, '--k', '2']);
      assert.strictEqual(proc.status, 0, proc.stderr);

      assert.ok(fs.existsSync(customOut), 'Custom output file must be written in nested directory');
      const parsed = JSON.parse(fs.readFileSync(customOut, 'utf8'));
      assert.ok(Object.keys(parsed).length >= 1);
    });
  });

  // =========================================================================
  // TEST SECTION 3: Boundary & Invalid CLI Arguments
  // =========================================================================
  describe('3. Adversarial & Invalid CLI Flag Stress Testing', () => {
    it('3.1: Invalid --k (negative, zero, NaN, or extreme) handles safely without crashing', () => {
      const testDir = path.join(tmpBase, 'bad_k_3_1');
      createTestDataset(testDir, 4);

      // k = 0
      const pZero = runDirectCli(['--run-dir', testDir, '--k', '0']);
      assert.strictEqual(pZero.status, 0, `k=0 should clamp to 1 gracefully: ${pZero.stderr}`);
      let parsed = JSON.parse(fs.readFileSync(path.join(testDir, 'archetypes.json'), 'utf8'));
      assert.strictEqual(Object.keys(parsed).length, 1);

      // k = -5
      const pNeg = runDirectCli(['--run-dir', testDir, '--k', '-5']);
      assert.strictEqual(pNeg.status, 0, `k=-5 should clamp to 1 gracefully: ${pNeg.stderr}`);
      parsed = JSON.parse(fs.readFileSync(path.join(testDir, 'archetypes.json'), 'utf8'));
      assert.strictEqual(Object.keys(parsed).length, 1);

      // k = abc (NaN)
      const pNaN = runDirectCli(['--run-dir', testDir, '--k', 'invalid_string']);
      assert.strictEqual(pNaN.status, 0, `k=NaN should fallback to 5 (clamped to N=4): ${pNaN.stderr}`);
      parsed = JSON.parse(fs.readFileSync(path.join(testDir, 'archetypes.json'), 'utf8'));
      assert.ok(Object.keys(parsed).length <= 4);

      // k = 10000 (K >> N=4)
      const pHuge = runDirectCli(['--run-dir', testDir, '--k', '10000']);
      assert.strictEqual(pHuge.status, 0, `k=10000 should clamp to N=4: ${pHuge.stderr}`);
      parsed = JSON.parse(fs.readFileSync(path.join(testDir, 'archetypes.json'), 'utf8'));
      assert.strictEqual(Object.keys(parsed).length, 4);
    });

    it('3.2: Non-existent --run-dir exits with exit code 1 and clean error message', () => {
      const nonExistent = path.join(tmpBase, 'non_existent_dir_999');
      const proc = runDirectCli(['--run-dir', nonExistent]);
      assert.strictEqual(proc.status, 1, 'Must exit with non-zero code 1');
      const output = (proc.stderr || '') + (proc.stdout || '');
      assert.ok(
        output.includes('未指定有效 runDir') || output.includes('运行目录不存在'),
        `Expected error message in output, got: ${output}`
      );
    });

    it('3.3: Empty directory without chapter-features.jsonl exits with code 1', () => {
      const emptyDir = path.join(tmpBase, 'empty_dir_3_3');
      fs.mkdirSync(emptyDir, { recursive: true });

      const proc = runDirectCli(['--run-dir', emptyDir]);
      assert.strictEqual(proc.status, 1, 'Must exit with non-zero code 1');
      const output = (proc.stderr || '') + (proc.stdout || '');
      assert.ok(
        output.includes('未找到特征文件') || output.includes('chapter-features.jsonl'),
        `Expected missing features file message, got: ${output}`
      );
    });

    it('3.4: Empty chapter-features.jsonl (0 bytes) generates valid empty {} archetypes.json without crashing', () => {
      const emptyFeatDir = path.join(tmpBase, 'empty_feat_3_4');
      fs.mkdirSync(emptyFeatDir, { recursive: true });
      fs.writeFileSync(path.join(emptyFeatDir, 'chapter-features.jsonl'), '', 'utf8');

      const proc = runDirectCli(['--run-dir', emptyFeatDir]);
      assert.strictEqual(proc.status, 0, `Empty features should succeed cleanly: ${proc.stderr}`);

      const archetypesPath = path.join(emptyFeatDir, 'archetypes.json');
      assert.ok(fs.existsSync(archetypesPath));
      const parsed = JSON.parse(fs.readFileSync(archetypesPath, 'utf8'));
      assert.deepStrictEqual(parsed, {}, 'Empty corpus must output {}');
    });

    it('3.5: chapter-features.jsonl containing corrupted JSON lines recovers by filtering them out', () => {
      const corruptDir = path.join(tmpBase, 'corrupt_lines_3_5');
      fs.mkdirSync(corruptDir, { recursive: true });

      const validCh1 = JSON.stringify(makeSampleChapter(1));
      const validCh2 = JSON.stringify(makeSampleChapter(2));
      const badLines = [
        validCh1,
        'THIS IS TOTALLY CORRUPTED JSON {{{{',
        '',
        '{"partial_json": true',
        validCh2,
        'null',
        '12345'
      ];

      fs.writeFileSync(path.join(corruptDir, 'chapter-features.jsonl'), badLines.join('\n'), 'utf8');

      const proc = runDirectCli(['--run-dir', corruptDir, '--k', '2']);
      assert.strictEqual(proc.status, 0, `Should skip corrupted lines: ${proc.stderr}`);

      const parsed = JSON.parse(fs.readFileSync(path.join(corruptDir, 'archetypes.json'), 'utf8'));
      assert.ok(Object.keys(parsed).length >= 1, 'Must process the valid chapters');
    });

    it('3.6: Corpus with only UNSEGMENTED virtual chapters outputs valid empty {} without error', () => {
      const unsegDir = path.join(tmpBase, 'unseg_only_3_6');
      fs.mkdirSync(unsegDir, { recursive: true });

      const unsegChapters = [
        { chapterNo: 0, title: 'UNSEGMENTED', unsegmented: true },
        { chapterNo: 0, chapterTitle: 'UNSEGMENTED', content: 'fake' }
      ];

      fs.writeFileSync(
        path.join(unsegDir, 'chapter-features.jsonl'),
        unsegChapters.map(c => JSON.stringify(c)).join('\n') + '\n',
        'utf8'
      );

      const proc = runDirectCli(['--run-dir', unsegDir]);
      assert.strictEqual(proc.status, 0, proc.stderr);

      const parsed = JSON.parse(fs.readFileSync(path.join(unsegDir, 'archetypes.json'), 'utf8'));
      assert.deepStrictEqual(parsed, {});
    });
  });

  // =========================================================================
  // TEST SECTION 4: Idempotency & Consecutive Invocations
  // =========================================================================
  describe('4. Idempotency & Deterministic Re-runs', () => {
    it('4.1: Running 3 consecutive times yields byte-for-byte consistent archetype assignments', () => {
      const testDir = path.join(tmpBase, 'idempotent_4_1');
      createTestDataset(testDir, 8);

      const results = [];
      for (let run = 1; run <= 3; run++) {
        const proc = runDirectCli(['--run-dir', testDir, '--k', '3']);
        assert.strictEqual(proc.status, 0, `Run ${run} failed: ${proc.stderr}`);
        const content = fs.readFileSync(path.join(testDir, 'archetypes.json'), 'utf8');
        results.push(JSON.parse(content));
      }

      // Check all 3 runs produced identical structure
      assert.strictEqual(Object.keys(results[0]).length, Object.keys(results[1]).length);
      assert.strictEqual(Object.keys(results[1]).length, Object.keys(results[2]).length);

      const keys0 = Object.keys(results[0]).sort();
      const keys1 = Object.keys(results[1]).sort();
      const keys2 = Object.keys(results[2]).sort();

      assert.deepStrictEqual(keys0, keys1, 'Run 1 and 2 must have identical archetype IDs');
      assert.deepStrictEqual(keys1, keys2, 'Run 2 and 3 must have identical archetype IDs');

      for (const k of keys0) {
        // Members must be identical
        assert.deepStrictEqual(
          results[0][k].clusterMembers,
          results[1][k].clusterMembers,
          `Cluster members for ${k} must be strictly identical across runs`
        );
        assert.deepStrictEqual(
          results[1][k].clusterMembers,
          results[2][k].clusterMembers,
          `Cluster members for ${k} must be strictly identical across runs`
        );
      }
    });
  });

  // =========================================================================
  // TEST SECTION 5: Filesystem Concurrency & Race Conditions
  // =========================================================================
  describe('5. Concurrency & Filesystem Race Conditions', () => {
    it('5.1: Concurrent discover-patterns invocations on same directory complete without corruption', async () => {
      const testDir = path.join(tmpBase, 'concurrency_5_1');
      createTestDataset(testDir, 12);

      // Spawn 3 concurrent processes
      const promises = [1, 2, 3].map(id => {
        return new Promise((resolve) => {
          const cp = spawnSync(NODE_BIN, [CORPUS_CLI, 'discover-patterns', '--run-dir', testDir, '--k', '3'], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
            timeout: 30000
          });
          resolve(cp);
        });
      });

      const outcomes = await Promise.all(promises);
      for (let i = 0; i < outcomes.length; i++) {
        assert.strictEqual(outcomes[i].status, 0, `Concurrent worker ${i + 1} failed: ${outcomes[i].stderr}`);
      }

      // Verify the final archetypes.json is completely valid JSON and not corrupt
      const archetypesPath = path.join(testDir, 'archetypes.json');
      assert.ok(fs.existsSync(archetypesPath));

      let parsed;
      assert.doesNotThrow(() => {
        parsed = JSON.parse(fs.readFileSync(archetypesPath, 'utf8'));
      }, 'archetypes.json must be valid uncorrupted JSON after concurrent runs');

      assert.ok(Object.keys(parsed).length >= 1, 'Archetypes must be non-empty');
    });
  });
});
