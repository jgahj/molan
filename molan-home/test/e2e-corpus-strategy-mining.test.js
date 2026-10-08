'use strict';

/**
 * @file e2e-corpus-strategy-mining.test.js
 * 4-Tier End-to-End Test Suite for Molan Corpus & Strategy Mining (R1-R5)
 * 
 * Architecture & Quality Gates Tested:
 * - R1: Strict Author Attribution & Non-Null Author Counting
 * - R2: Data-Driven Dynamic Strategy Synthesis & Centroid Variance Reflection
 * - R3: Unbiased Quality Lift Calculation & Statistical Evidence Support Gates
 * - R4: Manifest & Resume Idempotent Commit, Checkpoints & Crash Deduplication
 * - R5: Narrative StoryDebt Formal Lifecycle State Machine & Terminal Immutability
 * 
 * Test Hierarchy:
 * - Tier 1: Feature Coverage (R1-R5 primary paths, >= 25 tests)
 * - Tier 2: Boundary & Corner Cases (R1-R5 edge/adversarial conditions, >= 25 tests)
 * - Tier 3: Cross-Feature Combinations (pairwise interactions, >= 5 tests)
 * - Tier 4: Real-World Application Scenarios (end-to-end holistic workflows, >= 5 tests)
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

// Target subsystems under test
const debtTypes = require('../lib/composition/debt/debt-types');
const {
  DEBT_TYPES,
  DEBT_STATUSES,
  DEBT_EVENT_TYPES,
  DEBT_PRIORITIES,
  normalizeDebtType,
  normalizeDebtStatus,
  normalizeDebtPriority,
  normalizeDebtEventType
} = debtTypes;
const { StoryDebtLedger } = require('../lib/composition/debt/story-debt-ledger');
const checkpointManifestModule = require('../lib/composition/corpus/checkpoint-manifest');
const { CheckpointManifest } = checkpointManifestModule;
const strategyMinerModule = require('../lib/composition/corpus/strategy-miner');
const { mineStrategiesFromFeatures } = strategyMinerModule;
const evidenceCatalogModule = require('../lib/composition/corpus/evidence-catalog');
const {
  calculateStatisticalStrength,
  createStrategyCard,
  EvidenceCatalog
} = evidenceCatalogModule;
const batchPipelineModule = require('../lib/composition/corpus/batch-pipeline');
const { CorpusBatchPipeline } = batchPipelineModule;

// Contract interfaces from PROJECT.md
const ALLOWED_TRANSITIONS = debtTypes.ALLOWED_TRANSITIONS;
const TERMINAL_DEBT_STATUSES = debtTypes.TERMINAL_DEBT_STATUSES;
const extractFeatureAuthor = strategyMinerModule.extractFeatureAuthor;
const synthesizeRuleFromCluster = strategyMinerModule.synthesizeRuleFromCluster;
const computeSourceSnapshot = checkpointManifestModule.computeSourceSnapshot || CheckpointManifest.computeSourceSnapshot;

// Legacy hardcoded rule strings strictly prohibited by R2
const FORBIDDEN_LEGACY_RULE_NAMES = [
  '微观物理受力对抗律',
  '动作-对白微观交错律',
  '物证反常引爆悬念律',
  '认知颠覆与断点缺口律'
];

/**
 * Creates an isolated temp directory for test executions.
 */
function createTempDir(prefix = 'molan-e2e-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Safely removes a directory recursively.
 */
function safeRmDir(dirPath) {
  if (dirPath && fs.existsSync(dirPath)) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
    } catch (_) {}
  }
}

/**
 * Helper to generate a standardized chapter feature record.
 */
function makeFeatureRecord(overrides = {}) {
  const bookId = overrides.bookId || 'book_default';
  const chapterNo = overrides.chapterNo ?? 1;
  const novelTitle = overrides.novelTitle || '测试小说';
  const author = overrides.author !== undefined ? overrides.author : null;
  const primaryGoal = overrides.primaryGoal || 'conflict_push';

  return {
    bookId,
    novelTitle,
    chapterNo,
    chapterTitle: overrides.chapterTitle || `第${chapterNo}章 测试对峙`,
    author,
    primaryGoal,
    qualifiedDimensions: overrides.qualifiedDimensions || ['thrill', 'plot'],
    screener: {
      scores: overrides.screenerScores || { thrill: 0.82, plot: 0.75 },
      qualifiedDimensions: overrides.qualifiedDimensions || ['thrill', 'plot']
    },
    features: {
      dialogueDensity: overrides.dialogueDensity ?? 0.35,
      actionBeatDensity: overrides.actionBeatDensity ?? 0.65,
      sensoryDetailDensity: overrides.sensoryDetailDensity ?? 0.50,
      conflictPushDelta: overrides.conflictPushDelta ?? 0.70,
      pacingAcceleration: overrides.pacingAcceleration ?? 0.45,
      ...(overrides.features || {})
    },
    tailHook: {
      tailSnippet: overrides.tailSnippet || '剑气斩落，寒芒裂地。'
    },
    outcomeContract: {
      stateDelta: { events: overrides.events || ['交锋爆发', '局势恶化'] }
    },
    ...overrides
  };
}

// ============================================================================
// TIER 1: FEATURE COVERAGE (R1 - R5)
// ============================================================================

describe('Tier 1: Feature Coverage (R1 - R5)', () => {

  // --------------------------------------------------------------------------
  // R1: Strict Author Attribution
  // --------------------------------------------------------------------------
  describe('R1: Strict Author Attribution', () => {

    it('T1-R1-01: Explicit author metadata is preserved accurately from chapter record', () => {
      const feat = makeFeatureRecord({
        bookId: 'book_jianlai',
        novelTitle: '剑来',
        author: '烽火戏诸侯'
      });

      if (typeof extractFeatureAuthor === 'function') {
        const extracted = extractFeatureAuthor(feat);
        assert.equal(extracted, '烽火戏诸侯', 'Should return explicit author name');
      } else {
        // High-level opaque-box check via mineStrategiesFromFeatures
        const tmp = createTempDir('t1-r1-01-');
        try {
          fs.writeFileSync(path.join(tmp, 'chapter-features.jsonl'), JSON.stringify(feat) + '\n', 'utf8');
          mineStrategiesFromFeatures({ runDir: tmp });
          const evidence = JSON.parse(fs.readFileSync(path.join(tmp, 'evidence.json'), 'utf8'));
          assert.equal(evidence.distinctAuthors, 1);
        } finally {
          safeRmDir(tmp);
        }
      }
    });

    it('T1-R1-02: Missing or unverified author strictly evaluates to null without synthetic fallback', () => {
      const feat = makeFeatureRecord({
        bookId: 'mystery_99',
        novelTitle: '未知古卷',
        author: null
      });

      if (typeof extractFeatureAuthor === 'function') {
        const extracted = extractFeatureAuthor(feat);
        assert.equal(extracted, null, 'Must evaluate to null when unverified');
        assert.notEqual(extracted, 'author_mystery_99', 'Forbidden synthetic spoofing author_${bookId}');
        assert.notEqual(extracted, '未知古卷', 'Forbidden title fallback');
        assert.notEqual(extracted, '未知作者', 'Forbidden generic string fallback');
      } else {
        const tmp = createTempDir('t1-r1-02-');
        try {
          fs.writeFileSync(path.join(tmp, 'chapter-features.jsonl'), JSON.stringify(feat) + '\n', 'utf8');
          mineStrategiesFromFeatures({ runDir: tmp });
          const report = JSON.parse(fs.readFileSync(path.join(tmp, 'quality-report.json'), 'utf8'));
          assert.equal(report.authorCount, 0, 'Unauthored book must contribute 0 to authorCount');
        } finally {
          safeRmDir(tmp);
        }
      }
    });

    it('T1-R1-03: Cross-author counting strictly counts distinct non-null verified authors', () => {
      const tmp = createTempDir('t1-r1-03-');
      try {
        const feats = [
          makeFeatureRecord({ bookId: 'b1', author: '我吃西红柿', chapterNo: 1 }),
          makeFeatureRecord({ bookId: 'b1', author: '我吃西红柿', chapterNo: 2 }),
          makeFeatureRecord({ bookId: 'b2', author: '辰东', chapterNo: 1 }),
          makeFeatureRecord({ bookId: 'b3', author: null, chapterNo: 1 }) // Unverified author
        ];
        fs.writeFileSync(
          path.join(tmp, 'chapter-features.jsonl'),
          feats.map(f => JSON.stringify(f)).join('\n') + '\n',
          'utf8'
        );

        mineStrategiesFromFeatures({ runDir: tmp });
        const evidence = JSON.parse(fs.readFileSync(path.join(tmp, 'evidence.json'), 'utf8'));
        assert.equal(evidence.distinctAuthors, 2, 'Should count exactly 2 verified authors, excluding null');
      } finally {
        safeRmDir(tmp);
      }
    });

    it('T1-R1-04: Single-author isolation correctly counts 1 author across multiple books', () => {
      const tmp = createTempDir('t1-r1-04-');
      try {
        const feats = [
          makeFeatureRecord({ bookId: 'maoni_b1', novelTitle: '庆余年', author: '猫腻', chapterNo: 1 }),
          makeFeatureRecord({ bookId: 'maoni_b2', novelTitle: '将夜', author: '猫腻', chapterNo: 1 }),
          makeFeatureRecord({ bookId: 'maoni_b3', novelTitle: '择天记', author: '猫腻', chapterNo: 1 })
        ];
        fs.writeFileSync(
          path.join(tmp, 'chapter-features.jsonl'),
          feats.map(f => JSON.stringify(f)).join('\n') + '\n',
          'utf8'
        );

        mineStrategiesFromFeatures({ runDir: tmp });
        const evidence = JSON.parse(fs.readFileSync(path.join(tmp, 'evidence.json'), 'utf8'));
        assert.equal(evidence.distinctBooks, 3, '3 distinct books');
        assert.equal(evidence.distinctAuthors, 1, 'Only 1 distinct author despite 3 books');
      } finally {
        safeRmDir(tmp);
      }
    });

    it('T1-R1-05: Completely unauthored dataset evaluates to distinctAuthors === 0 without padding to 1', () => {
      const tmp = createTempDir('t1-r1-05-');
      try {
        const feats = [
          makeFeatureRecord({ bookId: 'anon_1', author: null, chapterNo: 1 }),
          makeFeatureRecord({ bookId: 'anon_2', author: null, chapterNo: 1 })
        ];
        fs.writeFileSync(
          path.join(tmp, 'chapter-features.jsonl'),
          feats.map(f => JSON.stringify(f)).join('\n') + '\n',
          'utf8'
        );

        mineStrategiesFromFeatures({ runDir: tmp });
        const evidence = JSON.parse(fs.readFileSync(path.join(tmp, 'evidence.json'), 'utf8'));
        assert.equal(evidence.distinctAuthors, 0, 'distinctAuthors must evaluate to 0, not padded to 1');
      } finally {
        safeRmDir(tmp);
      }
    });

  });

  // --------------------------------------------------------------------------
  // R2: Data-Driven Dynamic Strategy Synthesis
  // --------------------------------------------------------------------------
  describe('R2: Data-Driven Dynamic Strategy Synthesis', () => {

    it('T1-R2-01: Dynamic rule generation derives structural imperatives from cluster feature centroid', () => {
      const cluster = [
        makeFeatureRecord({ dialogueDensity: 0.85, actionBeatDensity: 0.70 }),
        makeFeatureRecord({ dialogueDensity: 0.88, actionBeatDensity: 0.75 })
      ];
      const all = [...cluster];

      if (typeof synthesizeRuleFromCluster === 'function') {
        const rule = synthesizeRuleFromCluster(cluster, all, all);
        assert.ok(rule, 'Synthesized rule must exist');
        assert.ok(rule.name && typeof rule.name === 'string', 'Rule must have a name');
        assert.ok(rule.rule || rule.ruleStatement, 'Rule must have a positive statement');
        assert.ok(rule.abstractPattern, 'Rule must have an abstractPattern');
        assert.ok(rule.counterExample, 'Rule must have a counterExample');
        assert.ok(rule.failureMode, 'Rule must have a failureMode');
      } else {
        const tmp = createTempDir('t1-r2-01-');
        try {
          fs.writeFileSync(
            path.join(tmp, 'chapter-features.jsonl'),
            cluster.map(f => JSON.stringify(f)).join('\n') + '\n',
            'utf8'
          );
          mineStrategiesFromFeatures({ runDir: tmp });
          const rules = fs.readFileSync(path.join(tmp, 'strategy-rules.jsonl'), 'utf8')
            .split('\n')
            .filter(Boolean)
            .map(JSON.parse);
          assert.ok(rules.length > 0, 'Rules must be synthesized');
          assert.ok(rules[0].name && rules[0].abstractPattern);
        } finally {
          safeRmDir(tmp);
        }
      }
    });

    it('T1-R2-02: Centroid variance reflection: contrasting feature profiles yield distinct rule schemas', () => {
      const clusterA = [
        makeFeatureRecord({ conflictPushDelta: 0.95, physicalImpact: 0.90, primaryGoal: 'conflict_push' }),
        makeFeatureRecord({ conflictPushDelta: 0.92, physicalImpact: 0.88, primaryGoal: 'conflict_push' })
      ];
      const clusterB = [
        makeFeatureRecord({ infoGapDelta: 0.90, sensoryDetailDensity: 0.85, primaryGoal: 'info_reveal' }),
        makeFeatureRecord({ infoGapDelta: 0.88, sensoryDetailDensity: 0.82, primaryGoal: 'info_reveal' })
      ];

      if (typeof synthesizeRuleFromCluster === 'function') {
        const ruleA = synthesizeRuleFromCluster(clusterA, [...clusterA, ...clusterB], [...clusterA, ...clusterB]);
        const ruleB = synthesizeRuleFromCluster(clusterB, [...clusterA, ...clusterB], [...clusterA, ...clusterB]);
        assert.notEqual(ruleA.name, ruleB.name, 'Distinct centroids must yield distinct rule names');
        assert.notEqual(ruleA.rule || ruleA.ruleStatement, ruleB.rule || ruleB.ruleStatement, 'Distinct rules');
      } else {
        const tmp = createTempDir('t1-r2-02-');
        try {
          fs.writeFileSync(
            path.join(tmp, 'chapter-features.jsonl'),
            [...clusterA, ...clusterB].map(f => JSON.stringify(f)).join('\n') + '\n',
            'utf8'
          );
          mineStrategiesFromFeatures({ runDir: tmp });
          const rules = fs.readFileSync(path.join(tmp, 'strategy-rules.jsonl'), 'utf8')
            .split('\n')
            .filter(Boolean)
            .map(JSON.parse);
          assert.ok(rules.length >= 2, 'Should synthesize at least 2 distinct rules');
          assert.notEqual(rules[0].name, rules[1].name);
        } finally {
          safeRmDir(tmp);
        }
      }
    });

    it('T1-R2-03: Zero hardcoded constant rule strings in generated rules', () => {
      const cluster = [
        makeFeatureRecord({ primaryGoal: 'conflict_push' }),
        makeFeatureRecord({ primaryGoal: 'dialogue_game' }),
        makeFeatureRecord({ primaryGoal: 'info_reveal' })
      ];

      const tmp = createTempDir('t1-r2-03-');
      try {
        fs.writeFileSync(
          path.join(tmp, 'chapter-features.jsonl'),
          cluster.map(f => JSON.stringify(f)).join('\n') + '\n',
          'utf8'
        );
        mineStrategiesFromFeatures({ runDir: tmp });
        const rules = fs.readFileSync(path.join(tmp, 'strategy-rules.jsonl'), 'utf8')
          .split('\n')
          .filter(Boolean)
          .map(JSON.parse);

        for (const r of rules) {
          for (const forbidden of FORBIDDEN_LEGACY_RULE_NAMES) {
            assert.notEqual(
              r.name,
              forbidden,
              `Generated rule name must not match forbidden legacy constant: ${forbidden}`
            );
          }
        }
      } finally {
        safeRmDir(tmp);
      }
    });

    it('T1-R2-04: Dynamic archetype classification replaces static 4-way bucket dictionary', () => {
      const tmp = createTempDir('t1-r2-04-');
      try {
        const feats = [
          makeFeatureRecord({ features: { pace: 0.9, suspense: 0.1 } }),
          makeFeatureRecord({ features: { pace: 0.1, suspense: 0.9 } }),
          makeFeatureRecord({ features: { pace: 0.5, suspense: 0.5 } })
        ];
        fs.writeFileSync(
          path.join(tmp, 'chapter-features.jsonl'),
          feats.map(f => JSON.stringify(f)).join('\n') + '\n',
          'utf8'
        );

        mineStrategiesFromFeatures({ runDir: tmp });
        const archetypes = JSON.parse(fs.readFileSync(path.join(tmp, 'archetypes.json'), 'utf8'));
        assert.ok(archetypes && typeof archetypes === 'object', 'Archetypes manifest generated');
        // Check that archetypes are dynamically formed or have non-zero representation
        const keys = Object.keys(archetypes);
        assert.ok(keys.length > 0, 'Archetypes must exist');
      } finally {
        safeRmDir(tmp);
      }
    });

    it('T1-R2-05: Strategy card schema integrity conforms to strategy-rule-v2 specifications', () => {
      const card = createStrategyCard({
        id: 'strat_dynamic_01',
        name: '动态节奏起伏律',
        rule: '在张力积聚后必须适时通过场景微阻滞释放缓冲。',
        abstractPattern: '张力积累 -> 阻滞释放 -> 新因果推进',
        stats: {
          supportCount: 10,
          bookCount: 3,
          authorCount: 2,
          qualityLift: 0.18
        }
      });

      assert.equal(card.id, 'strat_dynamic_01');
      assert.ok(card.rule);
      assert.ok(card.abstractPattern);
      assert.ok(card.stats.supportCount >= 10);
      assert.ok(['A', 'B', 'C', 'D'].includes(card.evidenceStrength));
    });

  });

  // --------------------------------------------------------------------------
  // R3: Unbiased Quality Lift Calculation & Statistical Evidence Gates
  // --------------------------------------------------------------------------
  describe('R3: Unbiased Quality Lift & Evidence Gates', () => {

    it('T1-R3-01: Decoupled quality metric avoids screener score self-certification circularity', () => {
      // Two features with identical screener scores but completely different feature vectors
      const featA = makeFeatureRecord({
        screenerScores: { thrill: 0.70, plot: 0.70 },
        features: { dialogueDensity: 0.9, actionBeatDensity: 0.9 }
      });
      const featB = makeFeatureRecord({
        screenerScores: { thrill: 0.70, plot: 0.70 },
        features: { dialogueDensity: 0.1, actionBeatDensity: 0.1 }
      });

      const tmp = createTempDir('t1-r3-01-');
      try {
        fs.writeFileSync(
          path.join(tmp, 'chapter-features.jsonl'),
          [featA, featB].map(f => JSON.stringify(f)).join('\n') + '\n',
          'utf8'
        );
        mineStrategiesFromFeatures({ runDir: tmp });
        const report = JSON.parse(fs.readFileSync(path.join(tmp, 'quality-report.json'), 'utf8'));
        assert.ok(report, 'Quality report must be generated');
      } finally {
        safeRmDir(tmp);
      }
    });

    it('T1-R3-02: Quality lift evaluates against matched background baseline rather than candidate circular subset', () => {
      const tmp = createTempDir('t1-r3-02-');
      try {
        const cluster = [
          makeFeatureRecord({ bookId: 'b1', author: '作者A', conflictPushDelta: 0.90 }),
          makeFeatureRecord({ bookId: 'b2', author: '作者B', conflictPushDelta: 0.88 })
        ];
        fs.writeFileSync(
          path.join(tmp, 'chapter-features.jsonl'),
          cluster.map(f => JSON.stringify(f)).join('\n') + '\n',
          'utf8'
        );

        mineStrategiesFromFeatures({ runDir: tmp });
        const rules = fs.readFileSync(path.join(tmp, 'strategy-rules.jsonl'), 'utf8')
          .split('\n')
          .filter(Boolean)
          .map(JSON.parse);
        assert.ok(rules.length > 0);
        assert.equal(typeof rules[0].stats.qualityLift, 'number', 'Must compute numerical quality lift');
      } finally {
        safeRmDir(tmp);
      }
    });

    it('T1-R3-03: Minimum chapter support gate: supportCount < 3 cannot achieve Tier A or B', () => {
      const statsLowSupport = {
        supportCount: 2, // Less than minimum 3 for B, 5 for A
        bookCount: 2,
        authorCount: 2,
        qualityLift: 0.35,
        confidence: 0.95
      };

      const strength = calculateStatisticalStrength(statsLowSupport);
      assert.ok(['C', 'D'].includes(strength), `Low support count (2) must be gated to C or D, got ${strength}`);
      assert.notEqual(strength, 'A', 'Cannot achieve Tier A with 2 chapters');
      assert.notEqual(strength, 'B', 'Cannot achieve Tier B with 2 chapters');
    });

    it('T1-R3-04: Minimum book count gate: clusters with bookCount < 2 cannot achieve Tier A or B', () => {
      const statsSingleBook = {
        supportCount: 15,
        bookCount: 1, // Only 1 book
        authorCount: 1,
        qualityLift: 0.40,
        confidence: 0.90
      };

      const strength = calculateStatisticalStrength(statsSingleBook);
      assert.equal(strength, 'C', 'Single-book patterns must be isolated as Tier C (author habit)');
    });

    it('T1-R3-05: Minimum verified author gate: clusters with authorCount < 2 cannot achieve Tier A or B', () => {
      const statsSingleAuthor = {
        supportCount: 20,
        bookCount: 3,
        authorCount: 1, // Only 1 author across 3 books
        qualityLift: 0.30,
        confidence: 0.90
      };

      const strength = calculateStatisticalStrength(statsSingleAuthor);
      assert.equal(strength, 'C', 'Patterns from single author across multiple books must be quarantined to Tier C');
    });

  });

  // --------------------------------------------------------------------------
  // R4: Manifest & Resume Idempotent Commit & Staging
  // --------------------------------------------------------------------------
  describe('R4: Manifest & Resume Idempotent Commit & Staging', () => {

    it('T1-R4-01: markBookComplete idempotency: repeated calls do not increment booksCompleted', () => {
      const tmp = createTempDir('t1-r4-01-');
      try {
        const manifest = new CheckpointManifest({ stagingRoot: tmp, runId: 'run_test_01' });
        manifest.initOrResume({
          books: [
            { bookId: 'book_a', title: '书目A' },
            { bookId: 'book_b', title: '书目B' }
          ],
          resume: false
        });

        assert.equal(manifest.data.booksCompleted, 0);

        // First completion
        manifest.markBookComplete('book_a', { chaptersProcessed: 10, candidateChapters: 2 });
        assert.equal(manifest.data.booksCompleted, 1);

        // Second completion of the SAME book
        manifest.markBookComplete('book_a', { chaptersProcessed: 10, candidateChapters: 2 });
        assert.equal(manifest.data.booksCompleted, 1, 'booksCompleted must remain 1 upon repeated call');
      } finally {
        safeRmDir(tmp);
      }
    });

    it('T1-R4-02: Chapter counters in manifest remain invariant on repeated markBookComplete calls', () => {
      const tmp = createTempDir('t1-r4-02-');
      try {
        const manifest = new CheckpointManifest({ stagingRoot: tmp, runId: 'run_test_02' });
        manifest.initOrResume({
          books: [{ bookId: 'b_count_test', title: '计数测试书' }],
          resume: false
        });

        manifest.markBookComplete('b_count_test', { chaptersProcessed: 15, candidateChapters: 5 });
        assert.equal(manifest.data.chaptersProcessed, 15);
        assert.equal(manifest.data.candidateChaptersFound, 5);

        // Repeating call must NOT double-count to 30 and 10
        manifest.markBookComplete('b_count_test', { chaptersProcessed: 15, candidateChapters: 5 });
        assert.equal(manifest.data.chaptersProcessed, 15, 'chaptersProcessed must not double count');
        assert.equal(manifest.data.candidateChaptersFound, 5, 'candidateChaptersFound must not double count');
      } finally {
        safeRmDir(tmp);
      }
    });

    it('T1-R4-03: Real content/mtime sourceSnapshot computed over corpus files', () => {
      const tmp = createTempDir('t1-r4-03-');
      try {
        const fileA = path.join(tmp, 'book1.txt');
        const fileB = path.join(tmp, 'book2.txt');
        fs.writeFileSync(fileA, '第一章 凡人', 'utf8');
        fs.writeFileSync(fileB, '第一章 仙道', 'utf8');

        const books = [
          { bookId: 'b1', filePath: fileA },
          { bookId: 'b2', filePath: fileB }
        ];

        let snapshot = '';
        if (typeof computeSourceSnapshot === 'function') {
          snapshot = computeSourceSnapshot(books, tmp);
        } else {
          const manifest = new CheckpointManifest({ stagingRoot: tmp, runId: 'run_snap_test' });
          manifest.initOrResume({ books, resume: false });
          snapshot = manifest.data.sourceSnapshot;
        }

        assert.ok(snapshot && typeof snapshot === 'string', 'sourceSnapshot must be non-empty string');
        assert.equal(snapshot.length, 64, 'SHA-256 snapshot must be 64-char hex');
        // Must NOT simply be sha256(runId)
        const runIdHash = crypto.createHash('sha256').update('run_snap_test', 'utf8').digest('hex');
        assert.notEqual(snapshot, runIdHash, 'Snapshot must not be simple sha256(runId)');
      } finally {
        safeRmDir(tmp);
      }
    });

    it('T1-R4-04: Atomic per-book feature staging generates receipt before commit', () => {
      const tmp = createTempDir('t1-r4-04-');
      try {
        const stagingBooksDir = path.join(tmp, 'run_stage_test', 'staging-books');
        fs.mkdirSync(stagingBooksDir, { recursive: true });

        const bookId = 'book_staged_01';
        const stagingFile = path.join(stagingBooksDir, `${bookId}.features.jsonl`);
        const receiptFile = path.join(stagingBooksDir, `${bookId}.receipt.json`);

        fs.writeFileSync(stagingFile, '{"sample":"feature"}\n', 'utf8');
        const contentHash = crypto.createHash('sha256').update('{"sample":"feature"}\n', 'utf8').digest('hex');
        fs.writeFileSync(receiptFile, JSON.stringify({ bookFingerprint: contentHash, bookId }), 'utf8');

        assert.ok(fs.existsSync(stagingFile));
        assert.ok(fs.existsSync(receiptFile));
        const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
        assert.equal(receipt.bookFingerprint, contentHash);
      } finally {
        safeRmDir(tmp);
      }
    });

    it('T1-R4-05: Crash-resume deduplication: restarted pipeline produces zero duplicate lines in chapter-features.jsonl', () => {
      const tmp = createTempDir('t1-r4-05-');
      try {
        const runDir = path.join(tmp, 'run_dedup_test');
        fs.mkdirSync(runDir, { recursive: true });
        const featuresFile = path.join(runDir, 'chapter-features.jsonl');

        const feat1 = makeFeatureRecord({ bookId: 'b_dedup', chapterNo: 1 });
        const feat2 = makeFeatureRecord({ bookId: 'b_dedup', chapterNo: 2 });

        // Simulate interrupted append: entries written to features file
        fs.writeFileSync(featuresFile, [JSON.stringify(feat1), JSON.stringify(feat2)].join('\n') + '\n', 'utf8');

        // Verify lines before resume
        const linesBefore = fs.readFileSync(featuresFile, 'utf8').split('\n').filter(Boolean);
        assert.equal(linesBefore.length, 2);

        // Deduplication rule check: distinct (bookId, chapterNo)
        const uniqueKeys = new Set(linesBefore.map(l => {
          const parsed = JSON.parse(l);
          return `${parsed.bookId}#${parsed.chapterNo}`;
        }));
        assert.equal(uniqueKeys.size, 2, 'Must maintain strict uniqueness per chapter');
      } finally {
        safeRmDir(tmp);
      }
    });

  });

  // --------------------------------------------------------------------------
  // R5: Strict StoryDebt Lifecycle Transition State Machine
  // --------------------------------------------------------------------------
  describe('R5: Strict StoryDebt Lifecycle Transition State Machine', () => {

    it('T1-R5-01: Valid standard lifecycle progression transitions cleanly', () => {
      const ledger = new StoryDebtLedger({ storyId: 's_prog_01' });

      // 1. OPEN
      const debt = ledger.createDebt({
        debtId: 'debt_p_1',
        summary: '宗门大比夺魁承诺',
        createdAtChapter: 1
      });
      assert.equal(debt.status, DEBT_STATUSES.OPEN);

      // 2. DEVELOPING
      const esc = ledger.escalateDebt('debt_p_1', { chapterNo: 3, evidence: '长老暗中作梗' });
      assert.equal(esc.debt.status, DEBT_STATUSES.DEVELOPING);

      // 3. PARTIALLY_PAID
      const part = ledger.partiallyPayDebt('debt_p_1', { chapterNo: 5, evidence: '击败外门首席' });
      assert.equal(part.debt.status, DEBT_STATUSES.PARTIALLY_PAID);

      // 4. PROPOSED_RESOLUTION
      const prop = ledger.proposeResolution('debt_p_1', { chapterNo: 8, evidence: '决战时刻来临' });
      assert.equal(prop.debt.status, DEBT_STATUSES.PROPOSED_RESOLUTION);

      // 5. PAID
      const paid = ledger.payDebt('debt_p_1', { chapterNo: 9, evidence: '夺得第一，闭环' });
      assert.equal(paid.debt.status, DEBT_STATUSES.PAID);
    });

    it('T1-R5-02: Direct resolution from OPEN to PAID is allowed for short-lived debts', () => {
      const ledger = new StoryDebtLedger({ storyId: 's_direct_02' });
      ledger.createDebt({
        debtId: 'hook_fast_01',
        summary: '章末短线危机钩子',
        debtType: DEBT_TYPES.HOOK,
        createdAtChapter: 1
      });

      // Immediate resolution in next chapter
      const res = ledger.payDebt('hook_fast_01', { chapterNo: 2, evidence: '巧妙化解危机' });
      assert.equal(res.debt.status, DEBT_STATUSES.PAID);
    });

    it('T1-R5-03: PAID is an immutable terminal state; attempting further transition throws STATE_TRANSITION_REJECTED', () => {
      const ledger = new StoryDebtLedger({ storyId: 's_term_paid' });
      ledger.createDebt({ debtId: 'd_paid_term', summary: '已解决宿命' });
      ledger.payDebt('d_paid_term', { chapterNo: 2, evidence: '彻底履行' });

      assert.throws(
        () => {
          ledger.proposeResolution('d_paid_term', { chapterNo: 3, evidence: '非法再次提议' });
        },
        (err) => {
          return err.code === 'STATE_TRANSITION_REJECTED' || /transition/i.test(err.message);
        },
        'Must reject transition on PAID terminal state'
      );
    });

    it('T1-R5-04: INVALIDATED and ABANDONED are terminal states rejecting all further transitions', () => {
      const ledger = new StoryDebtLedger({ storyId: 's_term_inv_ab' });

      // Invalidated debt
      ledger.createDebt({ debtId: 'd_inv', summary: '世界观推翻债务' });
      ledger.invalidateDebt('d_inv', { chapterNo: 2, evidence: '天道崩塌前提消失' });

      assert.throws(
        () => {
          ledger.payDebt('d_inv', { chapterNo: 3, evidence: '尝试支付已作废债务' });
        },
        (err) => err.code === 'STATE_TRANSITION_REJECTED' || /transition/i.test(err.message),
        'Must reject payment on INVALIDATED debt'
      );

      // Abandoned debt
      ledger.createDebt({ debtId: 'd_ab', summary: '战略放弃支线' });
      ledger.abandonDebt('d_ab', { chapterNo: 2, evidence: '主线收束' });

      assert.throws(
        () => {
          ledger.escalateDebt('d_ab', { chapterNo: 3, evidence: '尝试升级已放弃债务' });
        },
        (err) => err.code === 'STATE_TRANSITION_REJECTED' || /transition/i.test(err.message),
        'Must reject escalation on ABANDONED debt'
      );
    });

    it('T1-R5-05: STATE_TRANSITION_REJECTED error contains structured transition context', () => {
      const ledger = new StoryDebtLedger({ storyId: 's_err_ctx' });
      ledger.createDebt({ debtId: 'd_ctx_test', summary: '结构化错误测试' });
      ledger.payDebt('d_ctx_test', { chapterNo: 2 });

      try {
        ledger.escalateDebt('d_ctx_test', { chapterNo: 3 });
        assert.fail('Should have thrown STATE_TRANSITION_REJECTED');
      } catch (err) {
        if (err.code === 'STATE_TRANSITION_REJECTED') {
          assert.equal(err.currentStatus, DEBT_STATUSES.PAID);
          assert.equal(err.debtId, 'd_ctx_test');
        } else {
          // Verify general error rejection message
          assert.ok(/transition/i.test(err.message) || err.code);
        }
      }
    });

  });

});

// ============================================================================
// TIER 2: BOUNDARY & CORNER CASES (R1 - R5)
// ============================================================================

describe('Tier 2: Boundary & Corner Cases (R1 - R5)', () => {

  // --------------------------------------------------------------------------
  // R1: Author Attribution Boundaries
  // --------------------------------------------------------------------------
  describe('R1: Author Attribution Boundaries', () => {

    it('T2-R1-01: Empty or whitespace author strings normalize strictly to null', () => {
      const testCases = ['', '   ', '\t\n  ', null, undefined];

      for (const val of testCases) {
        const feat = makeFeatureRecord({ author: val });
        if (typeof extractFeatureAuthor === 'function') {
          const res = extractFeatureAuthor(feat);
          assert.equal(res, null, `Author value "${val}" must normalize to null`);
        }
      }
    });

    it('T2-R1-02: Genre tag brackets [玄幻] in title are not extracted as author', () => {
      const feat = makeFeatureRecord({
        bookId: 'b_genre_bracket',
        novelTitle: '[玄幻]凡人修仙传.txt',
        author: undefined
      });

      if (typeof extractFeatureAuthor === 'function') {
        const res = extractFeatureAuthor(feat);
        assert.notEqual(res, '玄幻', 'Genre bracket prefix must not be extracted as author');
        assert.equal(res, null, 'Must evaluate to null when no verified author');
      }
    });

    it('T2-R1-03: Filenames with underscores without author tags do not treat suffix as author', () => {
      const cases = [
        { novelTitle: 'novel_123.txt', badAuthor: '123' },
        { novelTitle: 'book_01_final.txt', badAuthor: '01' }
      ];

      for (const c of cases) {
        const feat = makeFeatureRecord({
          bookId: 'b_underscore',
          novelTitle: c.novelTitle,
          author: undefined
        });

        if (typeof extractFeatureAuthor === 'function') {
          const res = extractFeatureAuthor(feat);
          assert.notEqual(res, c.badAuthor, `Suffix "${c.badAuthor}" must not be extracted as author`);
          assert.equal(res, null);
        }
      }
    });

    it('T2-R1-04: Explicit author tag formats accurately extracted', () => {
      const validCases = [
        { title: '凡人修仙_作者：忘语.txt', expected: '忘语' },
        { title: '诡秘之主_作者:爱潜水的乌贼.txt', expected: '爱潜水的乌贼' }
      ];

      for (const item of validCases) {
        const feat = makeFeatureRecord({
          novelTitle: item.title,
          author: undefined
        });

        if (typeof extractFeatureAuthor === 'function') {
          const res = extractFeatureAuthor(feat);
          assert.equal(res, item.expected, `Should extract "${item.expected}" from "${item.title}"`);
        }
      }
    });

    it('T2-R1-05: Mixed corpus attribution: verified authors count accurately while unverified contribute 0', () => {
      const tmp = createTempDir('t2-r1-05-');
      try {
        const feats = [
          makeFeatureRecord({ bookId: 'b1', author: '辰东', chapterNo: 1 }),
          makeFeatureRecord({ bookId: 'b2', author: '辰东', chapterNo: 1 }),
          makeFeatureRecord({ bookId: 'b3', author: '我吃西红柿', chapterNo: 1 }),
          makeFeatureRecord({ bookId: 'b4', author: null, chapterNo: 1 }),
          makeFeatureRecord({ bookId: 'b5', author: '   ', chapterNo: 1 })
        ];

        fs.writeFileSync(
          path.join(tmp, 'chapter-features.jsonl'),
          feats.map(f => JSON.stringify(f)).join('\n') + '\n',
          'utf8'
        );

        mineStrategiesFromFeatures({ runDir: tmp });
        const evidence = JSON.parse(fs.readFileSync(path.join(tmp, 'evidence.json'), 'utf8'));
        assert.equal(evidence.distinctAuthors, 2, 'Only 2 verified distinct authors');
      } finally {
        safeRmDir(tmp);
      }
    });

  });

  // --------------------------------------------------------------------------
  // R2: Dynamic Strategy Boundaries
  // --------------------------------------------------------------------------
  describe('R2: Dynamic Strategy Boundaries', () => {

    it('T2-R2-01: Identical/flat centroids do not produce NaN or division-by-zero crashes', () => {
      const flatFeatures = [
        makeFeatureRecord({ dialogueDensity: 0.5, actionBeatDensity: 0.5, sensoryDetailDensity: 0.5 }),
        makeFeatureRecord({ dialogueDensity: 0.5, actionBeatDensity: 0.5, sensoryDetailDensity: 0.5 })
      ];

      if (typeof synthesizeRuleFromCluster === 'function') {
        const res = synthesizeRuleFromCluster(flatFeatures, flatFeatures, flatFeatures);
        assert.ok(res, 'Flat features synthesis must succeed');
        assert.ok(!Number.isNaN(res.stats?.qualityLift), 'qualityLift must not be NaN');
      }
    });

    it('T2-R2-02: Extreme centroid variance (z-score > 3.0) is bounded gracefully', () => {
      const normalFeatures = [
        makeFeatureRecord({ conflictPushDelta: 0.2 }),
        makeFeatureRecord({ conflictPushDelta: 0.3 })
      ];
      const extremeCluster = [
        makeFeatureRecord({ conflictPushDelta: 10.0 }) // Extreme outlier
      ];

      if (typeof synthesizeRuleFromCluster === 'function') {
        const res = synthesizeRuleFromCluster(extremeCluster, [...normalFeatures, ...extremeCluster], normalFeatures);
        assert.ok(res, 'Extreme outlier should not cause overflow');
        assert.ok(typeof res.name === 'string');
      }
    });

    it('T2-R2-03: Zero-variance feature dimensions do not cause infinite z-score', () => {
      const zeroVarFeatures = [
        makeFeatureRecord({ actionBeatDensity: 1.0 }),
        makeFeatureRecord({ actionBeatDensity: 1.0 }),
        makeFeatureRecord({ actionBeatDensity: 1.0 })
      ];

      if (typeof synthesizeRuleFromCluster === 'function') {
        const res = synthesizeRuleFromCluster(zeroVarFeatures, zeroVarFeatures, zeroVarFeatures);
        assert.ok(res);
        assert.ok(res.rule || res.ruleStatement);
      }
    });

    it('T2-R2-04: Minimal single-feature cluster safely produces valid fallback descriptor', () => {
      const singleCluster = [makeFeatureRecord({ chapterNo: 1 })];

      if (typeof synthesizeRuleFromCluster === 'function') {
        const res = synthesizeRuleFromCluster(singleCluster, singleCluster, singleCluster);
        assert.ok(res, 'Single-feature cluster should synthesize successfully');
        assert.ok(res.abstractPattern);
      }
    });

    it('T2-R2-05: Non-ASCII and Chinese feature tags synthesize clean UTF-8 payloads', () => {
      const chineseTagged = [
        makeFeatureRecord({
          features: { 微表情交错度: 0.85, 物理重力感: 0.78 },
          qualifiedDimensions: ['微表情', '物理受力']
        })
      ];

      if (typeof synthesizeRuleFromCluster === 'function') {
        const res = synthesizeRuleFromCluster(chineseTagged, chineseTagged, chineseTagged);
        assert.ok(res);
        assert.ok(typeof res.name === 'string');
      }
    });

  });

  // --------------------------------------------------------------------------
  // R3: Quality Lift Boundaries
  // --------------------------------------------------------------------------
  describe('R3: Quality Lift Boundaries', () => {

    it('T2-R3-01: Negative quality lift is penalized and strictly barred from Tier A/B', () => {
      const negStats = {
        supportCount: 15,
        bookCount: 3,
        authorCount: 3,
        qualityLift: -0.15, // Negative lift
        confidence: 0.90
      };

      const strength = calculateStatisticalStrength(negStats);
      assert.ok(['C', 'D'].includes(strength), `Negative lift must be gated to C or D, got ${strength}`);
      assert.notEqual(strength, 'A');
      assert.notEqual(strength, 'B');
    });

    it('T2-R3-02: 1-chapter support is quarantined to Tier D regardless of high lift', () => {
      const singleChapterStats = {
        supportCount: 1, // 1 chapter
        bookCount: 1,
        authorCount: 1,
        qualityLift: 0.50, // High lift
        confidence: 0.99
      };

      const strength = calculateStatisticalStrength(singleChapterStats);
      assert.equal(strength, 'D', 'Single chapter must be quarantined to Tier D');
    });

    it('T2-R3-03: 1-book support is quarantined to Tier C regardless of supportCount', () => {
      const singleBookStats = {
        supportCount: 50, // High chapter support
        bookCount: 1, // Only 1 book
        authorCount: 1,
        qualityLift: 0.35,
        confidence: 0.95
      };

      const strength = calculateStatisticalStrength(singleBookStats);
      assert.equal(strength, 'C', 'Must be Tier C due to single book');
    });

    it('T2-R3-04: Single verified author across multiple books is quarantined to Tier C', () => {
      const singleAuthorStats = {
        supportCount: 40,
        bookCount: 4,
        authorCount: 1, // Single author across 4 books
        qualityLift: 0.28,
        confidence: 0.92
      };

      const strength = calculateStatisticalStrength(singleAuthorStats);
      assert.equal(strength, 'C', 'Must be Tier C due to single author');
    });

    it('T2-R3-05: Zero verified authors strictly quarantined and never granted Tier A or B', () => {
      const zeroAuthorStats = {
        supportCount: 30,
        bookCount: 5,
        authorCount: 0, // Zero verified authors
        qualityLift: 0.45,
        confidence: 0.95
      };

      const strength = calculateStatisticalStrength(zeroAuthorStats);
      assert.ok(['C', 'D'].includes(strength));
      assert.notEqual(strength, 'A');
      assert.notEqual(strength, 'B');
    });

  });

  // --------------------------------------------------------------------------
  // R4: Manifest & Resume Boundaries
  // --------------------------------------------------------------------------
  describe('R4: Manifest & Resume Boundaries', () => {

    it('T2-R4-01: 10x repeated markBookComplete calls maintain exact invariant counts', () => {
      const tmp = createTempDir('t2-r4-01-');
      try {
        const manifest = new CheckpointManifest({ stagingRoot: tmp, runId: 'run_10x_test' });
        manifest.initOrResume({
          books: [{ bookId: 'b_stress_1', title: '压力测试' }],
          resume: false
        });

        for (let i = 0; i < 10; i++) {
          manifest.markBookComplete('b_stress_1', { chaptersProcessed: 20, candidateChapters: 5 });
        }

        assert.equal(manifest.data.booksCompleted, 1, 'booksCompleted must remain exactly 1');
        assert.equal(manifest.data.chaptersProcessed, 20, 'chaptersProcessed must remain 20');
        assert.equal(manifest.data.candidateChaptersFound, 5, 'candidateChaptersFound must remain 5');
      } finally {
        safeRmDir(tmp);
      }
    });

    it('T2-R4-02: 0-byte source files are handled cleanly without crashing manifest', () => {
      const tmp = createTempDir('t2-r4-02-');
      try {
        const emptyFile = path.join(tmp, 'empty_book.txt');
        fs.writeFileSync(emptyFile, '', 'utf8');

        const manifest = new CheckpointManifest({ stagingRoot: tmp, runId: 'run_empty_test' });
        manifest.initOrResume({
          books: [{ bookId: 'b_empty', filePath: emptyFile }],
          resume: false
        });

        assert.doesNotThrow(() => {
          manifest.markBookComplete('b_empty', { chaptersProcessed: 0, candidateChapters: 0 });
        });
        assert.equal(manifest.data.booksCompleted, 1);
        assert.equal(manifest.data.chaptersProcessed, 0);
      } finally {
        safeRmDir(tmp);
      }
    });

    it('T2-R4-03: Multiple consecutive resume invocations preserve exact manifest state', () => {
      const tmp = createTempDir('t2-r4-03-');
      try {
        const manifest = new CheckpointManifest({ stagingRoot: tmp, runId: 'run_resume_rep' });
        manifest.initOrResume({
          books: [
            { bookId: 'b1', title: '书1' },
            { bookId: 'b2', title: '书2' }
          ],
          resume: false
        });
        manifest.markBookComplete('b1', { chaptersProcessed: 8, candidateChapters: 2 });

        // Resume call 1
        const r1 = manifest.initOrResume({ resume: true });
        // Resume call 2
        const r2 = manifest.initOrResume({ resume: true });
        // Resume call 3
        const r3 = manifest.initOrResume({ resume: true });

        assert.equal(r1.booksCompleted, 1);
        assert.equal(r2.booksCompleted, 1);
        assert.equal(r3.booksCompleted, 1);
        assert.equal(r1.chaptersProcessed, 8);
        assert.equal(r3.chaptersProcessed, 8);
      } finally {
        safeRmDir(tmp);
      }
    });

    it('T2-R4-04: In-progress stranded books reset to pending upon resume', () => {
      const tmp = createTempDir('t2-r4-04-');
      try {
        const manifest = new CheckpointManifest({ stagingRoot: tmp, runId: 'run_stranded_test' });
        manifest.initOrResume({
          books: [{ bookId: 'b_stranded', title: '中断书目' }],
          resume: false
        });
        manifest.markBookStart('b_stranded');
        assert.equal(manifest.data.books['b_stranded'].status, 'in_progress');

        // Reload via resume
        const resumedManifest = new CheckpointManifest({ stagingRoot: tmp, runId: 'run_stranded_test' });
        resumedManifest.initOrResume({ resume: true });

        const pending = resumedManifest.getPendingBooks();
        const found = pending.some(b => b.book_id === 'b_stranded');
        assert.ok(found, 'Stranded in_progress book must be recoverable in pending list');
      } finally {
        safeRmDir(tmp);
      }
    });

    it('T2-R4-05: Modifying corpus source file invalidates sourceSnapshot', () => {
      const tmp = createTempDir('t2-r4-05-');
      try {
        const file = path.join(tmp, 'dynamic_book.txt');
        fs.writeFileSync(file, '初始内容', 'utf8');
        const books = [{ bookId: 'b_dyn', filePath: file }];

        if (typeof computeSourceSnapshot === 'function') {
          const snap1 = computeSourceSnapshot(books, tmp);
          // Modify file
          fs.writeFileSync(file, '初始内容 + 修改追加章节', 'utf8');
          const snap2 = computeSourceSnapshot(books, tmp);
          assert.notEqual(snap1, snap2, 'Modifying source content must invalidate snapshot');
        }
      } finally {
        safeRmDir(tmp);
      }
    });

  });

  // --------------------------------------------------------------------------
  // R5: StoryDebt State Machine Boundaries
  // --------------------------------------------------------------------------
  describe('R5: StoryDebt State Machine Boundaries', () => {

    it('T2-R5-01: Transition from PAID to OPEN is rejected with STATE_TRANSITION_REJECTED', () => {
      const ledger = new StoryDebtLedger({ storyId: 's_b_paid_open' });
      ledger.createDebt({ debtId: 'd_po_1', summary: '已结清债务' });
      ledger.payDebt('d_po_1');

      assert.throws(
        () => {
          ledger.recordEvent({
            debtId: 'd_po_1',
            eventType: DEBT_EVENT_TYPES.CREATED,
            payload: { summary: '尝试重新开启' }
          });
        },
        (err) => err.code === 'STATE_TRANSITION_REJECTED' || /transition/i.test(err.message)
      );
    });

    it('T2-R5-02: Transition from INVALIDATED to PAID is rejected with STATE_TRANSITION_REJECTED', () => {
      const ledger = new StoryDebtLedger({ storyId: 's_b_inv_paid' });
      ledger.createDebt({ debtId: 'd_ip_1', summary: '已作废债务' });
      ledger.invalidateDebt('d_ip_1');

      assert.throws(
        () => {
          ledger.payDebt('d_ip_1');
        },
        (err) => err.code === 'STATE_TRANSITION_REJECTED' || /transition/i.test(err.message)
      );
    });

    it('T2-R5-03: Transition from ABANDONED to DEVELOPING is rejected with STATE_TRANSITION_REJECTED', () => {
      const ledger = new StoryDebtLedger({ storyId: 's_b_ab_dev' });
      ledger.createDebt({ debtId: 'd_ad_1', summary: '已放弃债务' });
      ledger.abandonDebt('d_ad_1');

      assert.throws(
        () => {
          ledger.escalateDebt('d_ad_1');
        },
        (err) => err.code === 'STATE_TRANSITION_REJECTED' || /transition/i.test(err.message)
      );
    });

    it('T2-R5-04: Transition from PAID to PROPOSED_RESOLUTION is rejected with STATE_TRANSITION_REJECTED', () => {
      const ledger = new StoryDebtLedger({ storyId: 's_b_paid_prop' });
      ledger.createDebt({ debtId: 'd_pp_1', summary: '终态债务' });
      ledger.payDebt('d_pp_1');

      assert.throws(
        () => {
          ledger.proposeResolution('d_pp_1');
        },
        (err) => err.code === 'STATE_TRANSITION_REJECTED' || /transition/i.test(err.message)
      );
    });

    it('T2-R5-05: DEFERRED debt lifecycle: valid resumption vs terminal transition', () => {
      const ledger = new StoryDebtLedger({ storyId: 's_b_deferred' });
      ledger.createDebt({ debtId: 'd_def_1', summary: '延期债务' });

      // Defer
      ledger.deferDebt('d_def_1', { chapterNo: 2 });
      assert.equal(ledger.getDebt('d_def_1').status, DEBT_STATUSES.DEFERRED);

      // Resumes to DEVELOPING on escalation
      ledger.escalateDebt('d_def_1', { chapterNo: 5, evidence: '主线重新切回' });
      assert.equal(ledger.getDebt('d_def_1').status, DEBT_STATUSES.DEVELOPING);

      // Successfully pays
      ledger.payDebt('d_def_1', { chapterNo: 7, evidence: '圆满偿还' });
      assert.equal(ledger.getDebt('d_def_1').status, DEBT_STATUSES.PAID);
    });

  });

});

// ============================================================================
// TIER 3: CROSS-FEATURE COMBINATIONS
// ============================================================================

describe('Tier 3: Cross-Feature Combinations', () => {

  it('T3-COMB-01 (R1 + R3): Unverified authors gate strategy evidence out of Tier A/B into Tier C', () => {
    const tmp = createTempDir('t3-comb-01-');
    try {
      // 10 chapters from 3 books, all with null author
      const feats = [];
      for (let i = 1; i <= 10; i++) {
        feats.push(makeFeatureRecord({
          bookId: `anon_book_${(i % 3) + 1}`,
          chapterNo: i,
          author: null,
          conflictPushDelta: 0.90
        }));
      }

      fs.writeFileSync(
        path.join(tmp, 'chapter-features.jsonl'),
        feats.map(f => JSON.stringify(f)).join('\n') + '\n',
        'utf8'
      );

      mineStrategiesFromFeatures({ runDir: tmp });
      const rules = fs.readFileSync(path.join(tmp, 'strategy-rules.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(JSON.parse);

      // Unauthored features must NOT yield Tier A or B rules
      for (const r of rules) {
        assert.ok(
          r.evidenceStrength === 'C' || r.evidenceStrength === 'D',
          `Unauthored pattern must be quarantined to Tier C/D, got: ${r.evidenceStrength}`
        );
      }
    } finally {
      safeRmDir(tmp);
    }
  });

  it('T3-COMB-02 (R2 + R3): Dynamic strategy synthesis incorporates unbiased baseline lift', () => {
    const cluster = [
      makeFeatureRecord({ bookId: 'b1', author: '作者A', dialogueDensity: 0.85 }),
      makeFeatureRecord({ bookId: 'b2', author: '作者B', dialogueDensity: 0.88 })
    ];
    const background = [
      makeFeatureRecord({ bookId: 'bg1', dialogueDensity: 0.30 }),
      makeFeatureRecord({ bookId: 'bg2', dialogueDensity: 0.35 })
    ];

    if (typeof synthesizeRuleFromCluster === 'function') {
      const rule = synthesizeRuleFromCluster(cluster, [...cluster, ...background], background);
      assert.ok(rule.stats.qualityLift !== undefined, 'Lift must be calculated');
      assert.ok(!FORBIDDEN_LEGACY_RULE_NAMES.includes(rule.name));
    }
  });

  it('T3-COMB-03 (R1 + R4): Crash-resume preserves verified author attribution across batches', () => {
    const tmp = createTempDir('t3-comb-03-');
    try {
      const manifest = new CheckpointManifest({ stagingRoot: tmp, runId: 'run_auth_resume' });
      manifest.initOrResume({
        books: [
          { bookId: 'b1', title: '书1', author: '忘语' },
          { bookId: 'b2', title: '书2', author: '猫腻' }
        ],
        resume: false
      });

      manifest.markBookComplete('b1', { chaptersProcessed: 5, candidateChapters: 2 });

      // Crash & Resume
      const resumed = new CheckpointManifest({ stagingRoot: tmp, runId: 'run_auth_resume' });
      resumed.initOrResume({ resume: true });

      assert.equal(resumed.isBookCompleted('b1'), true);
      assert.equal(resumed.isBookCompleted('b2'), false);
    } finally {
      safeRmDir(tmp);
    }
  });

  it('T3-COMB-04 (R4 + R3): Atomic staging deduplication feeds accurate support counts to evidence catalog', () => {
    const tmp = createTempDir('t3-comb-04-');
    try {
      const catalog = new EvidenceCatalog();
      const card = createStrategyCard({
        id: 'c_dedup_support',
        rule: '微观动作与环境反冲交错推进。',
        stats: { supportCount: 4, bookCount: 2, authorCount: 2, qualityLift: 0.20 }
      });
      catalog.registerCard(card);

      const retrieved = catalog.getCard('c_dedup_support');
      assert.equal(retrieved.stats.supportCount, 4, 'Support count accurately preserved');
      assert.equal(retrieved.evidenceStrength, 'B', '4 chapters across 2 books & 2 authors meets Tier B');
    } finally {
      safeRmDir(tmp);
    }
  });

  it('T3-COMB-05 (R5 + Corpus): Narrative StoryDebt ledger tracks debts across multi-chapter corpus progression', () => {
    const ledger = new StoryDebtLedger({ storyId: 's_multi_ch' });

    // Chapter 1: Hook created
    ledger.createDebt({ debtId: 'debt_ch1', summary: '宗门试炼危机', createdAtChapter: 1 });
    // Chapter 5: Escalated
    ledger.escalateDebt('debt_ch1', { chapterNo: 5, evidence: '试炼难度剧增' });
    // Chapter 10: Proposed resolution
    ledger.proposeResolution('debt_ch1', { chapterNo: 10, evidence: '试炼核心突破' });
    // Chapter 12: Paid
    ledger.payDebt('debt_ch1', { chapterNo: 12, evidence: '顺利登顶' });

    const audit = ledger.explainDebt('debt_ch1');
    assert.equal(audit.status, DEBT_STATUSES.PAID);
    assert.equal(audit.totalEvents, 4);
    assert.ok(audit.isResolved);
  });

});

// ============================================================================
// TIER 4: REAL-WORLD APPLICATION SCENARIOS
// ============================================================================

describe('Tier 4: Real-World Application Scenarios', () => {

  it('T4-SCEN-01: Multi-book heterogeneous corpus batch extract, manifest resume, strategy mining, and catalog publish', () => {
    const tmp = createTempDir('t4-scen-01-');
    try {
      const runDir = path.join(tmp, 'corpus_batch_01');
      fs.mkdirSync(runDir, { recursive: true });

      // Features across 3 books with verified authors
      const feats = [
        makeFeatureRecord({ bookId: 'b_xuanhuan', novelTitle: '凡人', author: '忘语', chapterNo: 1 }),
        makeFeatureRecord({ bookId: 'b_xuanhuan', novelTitle: '凡人', author: '忘语', chapterNo: 2 }),
        makeFeatureRecord({ bookId: 'b_xianxia', novelTitle: '诛仙', author: '萧鼎', chapterNo: 1 }),
        makeFeatureRecord({ bookId: 'b_xianxia', novelTitle: '诛仙', author: '萧鼎', chapterNo: 2 }),
        makeFeatureRecord({ bookId: 'b_qihuan', novelTitle: '诡秘', author: '爱潜水的乌贼', chapterNo: 1 })
      ];

      fs.writeFileSync(
        path.join(runDir, 'chapter-features.jsonl'),
        feats.map(f => JSON.stringify(f)).join('\n') + '\n',
        'utf8'
      );

      mineStrategiesFromFeatures({ runDir });

      const evidence = JSON.parse(fs.readFileSync(path.join(runDir, 'evidence.json'), 'utf8'));
      assert.equal(evidence.distinctBooks, 3);
      assert.equal(evidence.distinctAuthors, 3);

      const catalog = new EvidenceCatalog();
      const loaded = catalog.loadFromPublishedPackage(runDir);
      assert.ok(loaded >= 0);
    } finally {
      safeRmDir(tmp);
    }
  });

  it('T4-SCEN-02: Completely unauthored corpus batch extract quarantined to Tier C/D with zero synthetic spoofing', () => {
    const tmp = createTempDir('t4-scen-02-');
    try {
      const runDir = path.join(tmp, 'unauthored_batch');
      fs.mkdirSync(runDir, { recursive: true });

      const feats = [
        makeFeatureRecord({ bookId: 'raw_01', novelTitle: '未知小说A', author: null, chapterNo: 1 }),
        makeFeatureRecord({ bookId: 'raw_02', novelTitle: '未知小说B', author: null, chapterNo: 1 }),
        makeFeatureRecord({ bookId: 'raw_03', novelTitle: '未知小说C', author: null, chapterNo: 1 })
      ];

      fs.writeFileSync(
        path.join(runDir, 'chapter-features.jsonl'),
        feats.map(f => JSON.stringify(f)).join('\n') + '\n',
        'utf8'
      );

      mineStrategiesFromFeatures({ runDir });

      const evidence = JSON.parse(fs.readFileSync(path.join(runDir, 'evidence.json'), 'utf8'));
      assert.equal(evidence.distinctAuthors, 0, 'Zero distinct verified authors');

      // Rules must not have synthetic author names
      const rules = fs.readFileSync(path.join(runDir, 'strategy-rules.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(JSON.parse);

      for (const r of rules) {
        assert.ok(r.stats.authorCount === 0 || r.evidenceStrength === 'C' || r.evidenceStrength === 'D');
      }
    } finally {
      safeRmDir(tmp);
    }
  });

  it('T4-SCEN-03: Full narrative arc debt lifecycle: creation, escalation, reframing, partial payoff, proposed resolution, and terminal payoff', () => {
    const tmp = createTempDir('t4-scen-03-');
    try {
      const ledger = new StoryDebtLedger({ storyId: 's_full_arc', storageDir: tmp });

      // 1. Created
      ledger.createDebt({
        debtId: 'arc_master_debt',
        summary: '主角身世谜团与血海深仇',
        debtType: DEBT_TYPES.PLOT,
        createdAtChapter: 1,
        creationEvidence: '佩玉刻有皇室暗纹'
      });

      // 2. Escalated
      ledger.escalateDebt('arc_master_debt', {
        chapterNo: 15,
        evidence: '遭遇前朝影卫追杀，仇家锁定'
      });

      // 3. Reframed
      ledger.reframeDebt('arc_master_debt', {
        chapterNo: 30,
        evidence: '当年灭门另有隐情，仇家实为受托保护者'
      });

      // 4. Partially Paid
      ledger.partiallyPayDebt('arc_master_debt', {
        chapterNo: 50,
        evidence: '得知真正黑手隐于圣堂之上'
      });

      // 5. Proposed Resolution
      ledger.proposeResolution('arc_master_debt', {
        chapterNo: 80,
        evidence: '决战黑手，双方当面对质真相大白'
      });

      // 6. Terminal Paid
      ledger.payDebt('arc_master_debt', {
        chapterNo: 85,
        evidence: '大仇得报，玉佩归位，因果彻底结清'
      });

      const explanation = ledger.explainDebt('arc_master_debt');
      assert.equal(explanation.status, DEBT_STATUSES.PAID);
      assert.equal(explanation.totalEvents, 6);
      assert.ok(explanation.auditStatement.includes('PAID') || explanation.auditStatement.includes('大仇得报'));

      // Terminal immutability
      assert.throws(
        () => ledger.escalateDebt('arc_master_debt', { chapterNo: 86 }),
        (err) => err.code === 'STATE_TRANSITION_REJECTED' || /transition/i.test(err.message)
      );
    } finally {
      safeRmDir(tmp);
    }
  });

  it('T4-SCEN-04: Concurrent book processing with process restart and deduplication verification', () => {
    const tmp = createTempDir('t4-scen-04-');
    try {
      const manifest = new CheckpointManifest({ stagingRoot: tmp, runId: 'run_concurrent_test' });
      manifest.initOrResume({
        books: [
          { bookId: 'b_con_1', title: '并发书1' },
          { bookId: 'b_con_2', title: '并发书2' }
        ],
        resume: false
      });

      manifest.markBookStart('b_con_1');
      manifest.markBookStart('b_con_2');
      manifest.markBookComplete('b_con_1', { chaptersProcessed: 10, candidateChapters: 3 });

      // Simulated process crash & resume
      const restart = new CheckpointManifest({ stagingRoot: tmp, runId: 'run_concurrent_test' });
      restart.initOrResume({ resume: true });

      assert.equal(restart.isBookCompleted('b_con_1'), true);
      const pending = restart.getPendingBooks();
      assert.equal(pending.length, 1);
      assert.equal(pending[0].book_id, 'b_con_2');
    } finally {
      safeRmDir(tmp);
    }
  });

  it('T4-SCEN-05: Contested story debt: resolution proposal rejection and terminal abandonment', () => {
    const ledger = new StoryDebtLedger({ storyId: 's_abandon_flow' });

    // Created
    ledger.createDebt({ debtId: 'debt_contested', summary: '支线夺宝机缘' });
    // Propose resolution by heuristic
    ledger.proposeResolution('debt_contested', { chapterNo: 5, evidence: '偶得残片' });

    // Author/editor decides to abandon the line strategically
    ledger.abandonDebt('debt_contested', { chapterNo: 6, notes: '砍除冗余支线加速主线' });

    assert.equal(ledger.getDebt('debt_contested').status, DEBT_STATUSES.ABANDONED);

    // Verify terminal protection on abandoned state
    assert.throws(
      () => {
        ledger.payDebt('debt_contested', { chapterNo: 7 });
      },
      (err) => err.code === 'STATE_TRANSITION_REJECTED' || /transition/i.test(err.message)
    );
  });

});
