'use strict';

/**
 * @file composition-archetype-discovery.test.js
 * Comprehensive Unit and Integration Test Suite for Chapter Archetype Discovery (Milestone 1 / R1)
 * 
 * Verifies:
 * 1. 26D continuous feature vector extraction and normalization
 * 2. Deterministic K-Means with adaptive K (K_eff = min(K, N)) and deterministic MaxMin initialization
 * 3. Mathematical centroid calculation across 26 dimensions
 * 4. Dynamic synthesis of ChapterArchetypeProfile entities (structural dynamics, tension curves, pacing formulas, exemplars)
 * 5. Strict author attribution integrity in archetype exemplars (zero synthetic author spoofing)
 * 6. Pipeline decoupling: runDiscoverPatterns executes without touching strategy-rules.jsonl
 * 7. CLI flag parsing and option forwarding (--k, --clusters, --min-cluster-size, --output, --run-dir)
 * 8. Edge cases: empty corpus, single chapter, N < K, extreme outliers, missing dimensions, unsegmented filtering
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  VECTOR_26D_DIMENSIONS,
  clamp,
  extract26DVector,
  extractChapterFeatureVector,
  calculateEuclideanDistance,
  calculateRmseDistance,
  clusterChaptersDeterministic,
  synthesizeChapterArchetypeProfile,
  discoverChapterArchetypes
} = require('../lib/composition/corpus/archetype-discoverer');

const { CorpusBatchPipeline } = require('../lib/composition/corpus/batch-pipeline');
const { parseArgs } = require('../scripts/corpus-cli');
const { mineStrategiesFromFeatures } = require('../lib/composition/corpus/strategy-miner');

function createSampleChapter(overrides = {}) {
  const chapterNo = overrides.chapterNo ?? 1;
  const bookId = overrides.bookId || 'book_alpha';
  return {
    bookId,
    chapterNo,
    chapterTitle: overrides.chapterTitle || `第${chapterNo}章 寒夜惊变`,
    novelTitle: overrides.novelTitle || '九霄仙旅',
    author: overrides.author !== undefined ? overrides.author : '忘语',
    genre: overrides.genre || 'xuanhuan',
    totalChars: overrides.totalChars || 3100,
    primaryGoal: overrides.primaryGoal || 'conflict_push',
    secondaryGoals: overrides.secondaryGoals || ['dialogue_game'],
    stylometry: {
      narrativeDensity: overrides.narrativeDensity ?? 0.82,
      emotionalIntensity: overrides.emotionalIntensity ?? 0.68,
      rhetoricalAbundance: overrides.rhetoricalAbundance ?? 0.45,
      colloquialLevel: overrides.colloquialLevel ?? 0.32,
      dialogueRatio: overrides.dialogueRatio ?? 0.38,
      psychologicalRatio: overrides.psychologicalRatio ?? 0.22,
      settingRatio: overrides.settingRatio ?? 0.18,
      averageSentenceLength: overrides.averageSentenceLength ?? 18.0,
      shortSentenceRatio: overrides.shortSentenceRatio ?? 0.62,
      informationDensity: overrides.informationDensity ?? 0.75,
      negativeSpaceRatio: overrides.negativeSpaceRatio ?? 0.35,
      ...(overrides.stylometry || {})
    },
    focusVector: {
      dialogue: overrides.focus_dialogue ?? 0.22,
      action: overrides.focus_action ?? 0.30,
      setting: overrides.focus_setting ?? 0.12,
      conflict: overrides.focus_conflict ?? 0.24,
      character: overrides.focus_character ?? 0.05,
      emotion: overrides.focus_emotion ?? 0.04,
      foreshadowing: overrides.focus_foreshadowing ?? 0.03,
      ...(overrides.focusVector || {})
    },
    screener: {
      scores: {
        thrill: overrides.thrill ?? 0.86,
        plot: overrides.plot ?? 0.78,
        character: overrides.character ?? 0.72,
        emotion: overrides.emotion ?? 0.65,
        suspense: overrides.suspense ?? 0.80,
        style: overrides.style ?? 0.70,
        hook: overrides.hook ?? 0.84,
        pacing: overrides.pacing ?? 0.82,
        ...(overrides.screenerScores || {})
      },
      qualifiedDimensions: overrides.qualifiedDimensions || ['thrill', 'plot', 'suspense']
    },
    tailHook: {
      type: overrides.hookType || 'cliffhanger',
      strength: overrides.hookStrength ?? 0.88,
      tailSnippet: overrides.tailSnippet || '门闩忽然发出轻微的咯吱声，一只没有指甲的惨白手掌自门缝间缓缓探入……'
    }
  };
}

describe('Milestone 1: Chapter Archetype Discovery Unit & Integration Suite', () => {
  let tmpSuiteDir;

  before(() => {
    tmpSuiteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'molan_m1_discovery_suite_'));
  });

  after(() => {
    try {
      fs.rmSync(tmpSuiteDir, { recursive: true, force: true });
    } catch (_) {}
  });

  // =========================================================================
  // GROUP 1: 26D Feature Vector Extraction
  // =========================================================================
  describe('Group 1: 26D Feature Vector Extraction & Continuous Normalization', () => {
    it('1.1: Extracts exact 26 dimensions matching VECTOR_26D_DIMENSIONS', () => {
      assert.strictEqual(VECTOR_26D_DIMENSIONS.length, 26, 'Vector space must have exactly 26 dimensions');
      const chapter = createSampleChapter();
      const vec = extract26DVector(chapter);

      assert.ok(vec instanceof Float64Array, 'Vector must be a Float64Array');
      assert.strictEqual(vec.length, 26, 'Vector length must be exactly 26');

      for (let i = 0; i < 26; i++) {
        assert.ok(!Number.isNaN(vec[i]), `Dimension ${i} (${VECTOR_26D_DIMENSIONS[i]}) must not be NaN`);
        assert.ok(vec[i] >= 0.0 && vec[i] <= 1.0, `Dimension ${i} (${VECTOR_26D_DIMENSIONS[i]}) must be in [0, 1], got ${vec[i]}`);
      }
    });

    it('1.2: Normalizes averageSentenceLength [6, 60] -> [0, 1] linearly', () => {
      const chMin = createSampleChapter({ averageSentenceLength: 6.0 });
      const vecMin = extract26DVector(chMin);
      assert.strictEqual(vecMin[7], 0.0, 'Sentence length 6 should map to 0.0');

      const chMax = createSampleChapter({ averageSentenceLength: 60.0 });
      const vecMax = extract26DVector(chMax);
      assert.strictEqual(vecMax[7], 1.0, 'Sentence length 60 should map to 1.0');

      const chMid = createSampleChapter({ averageSentenceLength: 33.0 });
      const vecMid = extract26DVector(chMid);
      assert.strictEqual(Number(vecMid[7].toFixed(3)), 0.500, 'Sentence length 33 should map to 0.500');

      // Clamps outside [6, 60]
      const chExtremeLow = createSampleChapter({ averageSentenceLength: 2.0 });
      assert.strictEqual(extract26DVector(chExtremeLow)[7], 0.0);

      const chExtremeHigh = createSampleChapter({ averageSentenceLength: 120.0 });
      assert.strictEqual(extract26DVector(chExtremeHigh)[7], 1.0);
    });

    it('1.3: Imputes missing and sparse properties safely with valid defaults', () => {
      const sparseChapter = {
        bookId: 'sparse_book_01',
        chapterNo: 3
      };
      const vec = extract26DVector(sparseChapter);
      assert.strictEqual(vec.length, 26);
      for (let i = 0; i < 26; i++) {
        assert.ok(!Number.isNaN(vec[i]), `Sparse dimension ${i} must not be NaN`);
        assert.ok(vec[i] >= 0.0 && vec[i] <= 1.0, `Sparse dimension ${i} must be in [0, 1]`);
      }
    });

    it('1.4: Alias extractChapterFeatureVector behaves identically to extract26DVector', () => {
      const chapter = createSampleChapter({ narrativeDensity: 0.91 });
      const v1 = extract26DVector(chapter);
      const v2 = extractChapterFeatureVector(chapter);
      assert.deepStrictEqual(Array.from(v1), Array.from(v2));
    });
  });

  // =========================================================================
  // GROUP 2: Deterministic K-Means & Centroid Mathematics
  // =========================================================================
  describe('Group 2: Deterministic K-Means with Adaptive K & Centroid Calculation', () => {
    it('2.1: Deterministic MaxMin initialization produces 100% identical clusters across 5 runs', () => {
      const chapters = [
        createSampleChapter({ chapterNo: 1, narrativeDensity: 0.9, thrill: 0.9 }),
        createSampleChapter({ chapterNo: 2, narrativeDensity: 0.2, dialogueRatio: 0.8 }),
        createSampleChapter({ chapterNo: 3, narrativeDensity: 0.8, suspense: 0.9 }),
        createSampleChapter({ chapterNo: 4, narrativeDensity: 0.3, dialogueRatio: 0.7 }),
        createSampleChapter({ chapterNo: 5, narrativeDensity: 0.85, thrill: 0.85 }),
        createSampleChapter({ chapterNo: 6, settingRatio: 0.7, psychologicalRatio: 0.6 })
      ];

      const run1 = clusterChaptersDeterministic(chapters, 3);
      for (let i = 0; i < 4; i++) {
        const runN = clusterChaptersDeterministic(chapters, 3);
        assert.strictEqual(runN.k, run1.k);
        assert.strictEqual(runN.clusters.length, run1.clusters.length);
        for (let c = 0; c < run1.clusters.length; c++) {
          assert.strictEqual(runN.clusters[c].members.length, run1.clusters[c].members.length);
          assert.deepStrictEqual(
            runN.clusters[c].members.map(m => m.index),
            run1.clusters[c].members.map(m => m.index),
            'Member assignments must be strictly deterministic across iterations'
          );
        }
      }
    });

    it('2.2: Adaptive K clamps K_eff = min(K, N) cleanly without crashing when N < K', () => {
      const twoChapters = [
        createSampleChapter({ chapterNo: 1 }),
        createSampleChapter({ chapterNo: 2 })
      ];

      const res = clusterChaptersDeterministic(twoChapters, 5);
      assert.strictEqual(res.k, 2, 'Requested K=5 with N=2 must clamp K_eff=2');
      assert.strictEqual(res.clusters.length, 2);
    });

    it('2.3: Single chapter N = 1 produces 1 cluster whose centroid equals the chapter vector', () => {
      const singleChapter = createSampleChapter({ chapterNo: 1, narrativeDensity: 0.73 });
      const expectedVector = extract26DVector(singleChapter);

      const res = clusterChaptersDeterministic([singleChapter], 1);
      assert.strictEqual(res.k, 1);
      assert.strictEqual(res.clusters.length, 1);

      const centroid = res.clusters[0].centroid;
      for (let d = 0; d < 26; d++) {
        assert.strictEqual(
          Number(centroid[d].toFixed(6)),
          Number(expectedVector[d].toFixed(6)),
          `Dimension ${d} of single-sample centroid must match point vector`
        );
      }
    });

    it('2.4: Centroid mathematically matches component-wise mean mu_k = (1 / |C_k|) * sum(V_i)', () => {
      const ch1 = createSampleChapter({ chapterNo: 1, narrativeDensity: 0.40, dialogueRatio: 0.20 });
      const ch2 = createSampleChapter({ chapterNo: 2, narrativeDensity: 0.60, dialogueRatio: 0.40 });
      const v1 = extract26DVector(ch1);
      const v2 = extract26DVector(ch2);

      const res = clusterChaptersDeterministic([ch1, ch2], 1); // Force into 1 cluster
      const centroid = res.clusters[0].centroid;

      for (let d = 0; d < 26; d++) {
        const expectedMean = (v1[d] + v2[d]) / 2;
        assert.ok(
          Math.abs(centroid[d] - expectedMean) < 1e-9,
          `Centroid dimension ${d} must equal arithmetic mean`
        );
      }
    });

    it('2.5: Members within each cluster are sorted by distanceToCentroid ascending', () => {
      const chapters = [
        createSampleChapter({ chapterNo: 1, narrativeDensity: 0.80 }),
        createSampleChapter({ chapterNo: 2, narrativeDensity: 0.82 }),
        createSampleChapter({ chapterNo: 3, narrativeDensity: 0.95 })
      ];

      const res = clusterChaptersDeterministic(chapters, 1);
      const members = res.clusters[0].members;
      for (let i = 1; i < members.length; i++) {
        assert.ok(
          members[i].distanceToCentroid >= members[i - 1].distanceToCentroid,
          'Members must be ranked in ascending order of distance to centroid'
        );
      }
    });

    it('2.6: Filters out UNSEGMENTED virtual chunks (chapterNo === 0 or title UNSEGMENTED)', () => {
      const mixed = [
        createSampleChapter({ chapterNo: 1 }),
        { chapterNo: 0, title: 'UNSEGMENTED', content: '虚拟片段' },
        { chapterNo: 2, unsegmented: true, title: 'UNSEGMENTED' },
        createSampleChapter({ chapterNo: 3 })
      ];

      const res = clusterChaptersDeterministic(mixed, 3);
      assert.strictEqual(res.k, 2, 'Only 2 valid chapters should be clustered');
      const allMembers = res.clusters.flatMap(c => c.members);
      assert.strictEqual(allMembers.length, 2);
    });
  });

  // =========================================================================
  // GROUP 3: Dynamic ChapterArchetypeProfile Synthesis
  // =========================================================================
  describe('Group 3: Dynamic ChapterArchetypeProfile Synthesis & Schema Conformance', () => {
    it('3.1: Profile adheres to schemaVersion chapter-archetype-profile-v1 with all required fields', () => {
      const ch = createSampleChapter({ chapterNo: 1 });
      const clusterRes = clusterChaptersDeterministic([ch], 1);
      const profile = synthesizeChapterArchetypeProfile(clusterRes.clusters[0]);

      assert.strictEqual(profile.schemaVersion, 'chapter-archetype-profile-v1');
      assert.ok(typeof profile.id === 'string' && profile.id.length > 0, 'id must be non-empty string');
      assert.ok(typeof profile.name === 'string' && profile.name.length > 0, 'name must be non-empty string');
      assert.ok(typeof profile.drivePattern === 'string' && profile.drivePattern.length > 0, 'drivePattern must be non-empty string');
      assert.ok(Array.isArray(profile.typicalStructure) && profile.typicalStructure.length >= 3, 'typicalStructure must have >= 3 stages');
      assert.ok(Array.isArray(profile.failureModes), 'failureModes must be an array');
    });

    it('3.2: structuralDynamics exposes drivePattern, typicalStructure, and failureModes', () => {
      const ch = createSampleChapter({ chapterNo: 1 });
      const clusterRes = clusterChaptersDeterministic([ch], 1);
      const profile = synthesizeChapterArchetypeProfile(clusterRes.clusters[0]);

      assert.ok(profile.structuralDynamics, 'structuralDynamics must exist');
      assert.strictEqual(profile.structuralDynamics.drivePattern, profile.drivePattern);
      assert.deepStrictEqual(profile.structuralDynamics.typicalStructure, profile.typicalStructure);
      assert.ok(profile.structuralDynamics.typicalStructure.length >= 3);
    });

    it('3.3: tensionProfile tensionPoints are strictly bounded in [1.0, 10.0] with dynamicFormula', () => {
      const chapters = [
        createSampleChapter({ chapterNo: 1, thrill: 0.95, conflict: 0.4 }),
        createSampleChapter({ chapterNo: 2, thrill: 0.85, suspense: 0.9 })
      ];
      const clusterRes = clusterChaptersDeterministic(chapters, 1);
      const profile = synthesizeChapterArchetypeProfile(clusterRes.clusters[0]);

      assert.ok(profile.tensionProfile, 'tensionProfile must exist');
      assert.ok(profile.tensionProfile.curveType, 'curveType must be defined');
      assert.ok(Array.isArray(profile.tensionProfile.tensionPoints), 'tensionPoints must be array');
      assert.strictEqual(profile.tensionProfile.tensionPoints.length, 4, 'Must have 4 beat tension points');

      for (const tp of profile.tensionProfile.tensionPoints) {
        assert.ok(typeof tp === 'number' && !Number.isNaN(tp), 'Tension point must be numeric');
        assert.ok(tp >= 1.0 && tp <= 10.0, `Tension point ${tp} must be in [1.0, 10.0]`);
      }

      assert.ok(typeof profile.tensionProfile.dynamicFormula === 'string', 'dynamicFormula must be string');
      assert.ok(profile.tensionProfile.dynamicFormula.includes('T(t)'), 'dynamicFormula must contain T(t)');
      assert.ok(Array.isArray(profile.tensionProfile.beats) && profile.tensionProfile.beats.length === 4);
    });

    it('3.4: pacingFormula beatWordRatios sum exactly to 1.00 and targetShortSentenceRatio is valid', () => {
      const ch = createSampleChapter({ chapterNo: 1, shortSentenceRatio: 0.65 });
      const clusterRes = clusterChaptersDeterministic([ch], 1);
      const profile = synthesizeChapterArchetypeProfile(clusterRes.clusters[0]);

      assert.ok(profile.pacingFormula, 'pacingFormula must exist');
      const ratios = profile.pacingFormula.beatWordRatios;
      assert.ok(Array.isArray(ratios), 'beatWordRatios must be an array');
      assert.strictEqual(ratios.length, 4, 'Must have 4 beat ratios');

      const sum = ratios.reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(sum - 1.00) < 0.01, `Beat ratios must sum to 1.00, got ${sum}`);

      assert.ok(typeof profile.pacingFormula.targetShortSentenceRatio === 'number');
      assert.ok(profile.pacingFormula.targetShortSentenceRatio >= 0.25 && profile.pacingFormula.targetShortSentenceRatio <= 0.85);

      assert.ok(profile.pacingFormula.sampleWordBudget, 'sampleWordBudget must exist');
      assert.strictEqual(profile.pacingFormula.sampleWordBudget.targetChars, 3000);
      assert.strictEqual(profile.pacingFormula.sampleWordBudget.beatChars.length, 4);
    });

    it('3.5: exemplars are ranked by distanceToCentroid and strictly preserve author attribution without spoofing', () => {
      const chVerified = createSampleChapter({ chapterNo: 1, author: '我吃西红柿' });
      const chUnverified = createSampleChapter({ chapterNo: 2, author: null });
      const chFakeSpoof = createSampleChapter({ chapterNo: 3, author: 'author_book_alpha' }); // spoof attempt

      const clusterRes = clusterChaptersDeterministic([chVerified, chUnverified, chFakeSpoof], 1);
      const profile = synthesizeChapterArchetypeProfile(clusterRes.clusters[0]);

      assert.ok(Array.isArray(profile.exemplars), 'exemplars must be array');
      assert.ok(profile.exemplars.length >= 1);

      // Verify authors
      const authMap = Object.fromEntries(profile.exemplars.map(e => [e.chapterNo, e.author]));
      assert.strictEqual(authMap[1], '我吃西红柿', 'Verified author must be retained');
      assert.strictEqual(authMap[2], null, 'Missing author must evaluate to null');
      assert.strictEqual(authMap[3], null, 'Synthetic spoofed author must evaluate to null');

      // Check distanceToCentroid
      for (const ex of profile.exemplars) {
        assert.ok(typeof ex.distanceToCentroid === 'number');
        assert.ok(ex.distanceToCentroid >= 0);
        assert.ok(ex.snippet && ex.snippet.length > 0, 'Exemplar must carry snippet');
      }
    });

    it('3.6: centroid breakdown contains style, focus, screener with zero NaN values', () => {
      const ch = createSampleChapter();
      const clusterRes = clusterChaptersDeterministic([ch], 1);
      const profile = synthesizeChapterArchetypeProfile(clusterRes.clusters[0]);

      assert.ok(profile.centroid, 'centroid must exist');
      assert.ok(profile.centroid.style, 'centroid.style must exist');
      assert.ok(profile.centroid.focus, 'centroid.focus must exist');
      assert.ok(profile.centroid.screener, 'centroid.screener must exist');
      assert.ok(profile.centroid.dynamics, 'centroid.dynamics alias must exist');

      for (const [key, val] of Object.entries(profile.centroid.style)) {
        assert.ok(!Number.isNaN(val), `centroid.style.${key} must not be NaN`);
      }
      for (const [key, val] of Object.entries(profile.centroid.focus)) {
        assert.ok(!Number.isNaN(val), `centroid.focus.${key} must not be NaN`);
      }
      for (const [key, val] of Object.entries(profile.centroid.screener)) {
        assert.ok(!Number.isNaN(val), `centroid.screener.${key} must not be NaN`);
      }
    });
  });

  // =========================================================================
  // GROUP 4: Programmatic API & Decoupled Execution
  // =========================================================================
  describe('Group 4: Programmatic API & Pipeline Decoupling', () => {
    it('4.1: discoverChapterArchetypes reads chapter-features.jsonl and outputs archetypes.json', async () => {
      const runDir = path.join(tmpSuiteDir, 'run_prog_4_1');
      fs.mkdirSync(runDir, { recursive: true });

      const chapters = [
        createSampleChapter({ chapterNo: 1, primaryGoal: 'conflict_push' }),
        createSampleChapter({ chapterNo: 2, primaryGoal: 'dialogue_game' }),
        createSampleChapter({ chapterNo: 3, primaryGoal: 'info_reveal' })
      ];

      fs.writeFileSync(
        path.join(runDir, 'chapter-features.jsonl'),
        chapters.map(c => JSON.stringify(c)).join('\n') + '\n',
        'utf8'
      );

      const res = await discoverChapterArchetypes({ runDir, k: 2 });
      assert.ok(res && res.archetypes, 'Must return object with archetypes');
      assert.strictEqual(res.metadata.k, 2);
      assert.strictEqual(res.metadata.totalChapters, 3);

      const archetypesPath = path.join(runDir, 'archetypes.json');
      assert.ok(fs.existsSync(archetypesPath), 'archetypes.json must be written to runDir');

      const parsed = JSON.parse(fs.readFileSync(archetypesPath, 'utf8'));
      const keys = Object.keys(parsed);
      assert.ok(keys.length >= 1, 'At least 1 archetype must be generated');
      assert.ok(parsed[keys[0]].structuralDynamics);
      assert.ok(parsed[keys[0]].tensionProfile);
      assert.ok(parsed[keys[0]].pacingFormula);
    });

    it('4.2: Pipeline runDiscoverPatterns decouples from runBuildStrategy without touching strategy-rules.jsonl', async () => {
      const runDir = path.join(tmpSuiteDir, 'run_decouple_4_2');
      fs.mkdirSync(runDir, { recursive: true });

      const chapters = [
        createSampleChapter({ chapterNo: 1 }),
        createSampleChapter({ chapterNo: 2 })
      ];

      fs.writeFileSync(
        path.join(runDir, 'chapter-features.jsonl'),
        chapters.map(c => JSON.stringify(c)).join('\n') + '\n',
        'utf8'
      );

      // Write mock existing strategy-rules.jsonl
      const existingRulesContent = JSON.stringify({ id: 'rule_original_pre_existing', rule: '初始规则' }) + '\n';
      fs.writeFileSync(path.join(runDir, 'strategy-rules.jsonl'), existingRulesContent, 'utf8');

      const pipeline = new CorpusBatchPipeline({ baseDir: tmpSuiteDir });
      const res = await pipeline.runDiscoverPatterns({ runDir, k: 2 });

      assert.ok(res, 'runDiscoverPatterns must complete');
      assert.ok(fs.existsSync(path.join(runDir, 'archetypes.json')), 'archetypes.json must be created');

      const afterRulesContent = fs.readFileSync(path.join(runDir, 'strategy-rules.jsonl'), 'utf8');
      assert.strictEqual(
        afterRulesContent,
        existingRulesContent,
        'runDiscoverPatterns must NOT modify or overwrite strategy-rules.jsonl'
      );
    });

    it('4.3: strategy-miner preserves existing archetypes.json generated by discover-patterns', () => {
      const runDir = path.join(tmpSuiteDir, 'run_miner_compat_4_3');
      fs.mkdirSync(runDir, { recursive: true });

      const chapters = [
        createSampleChapter({ chapterNo: 1, primaryGoal: 'conflict_push' }),
        createSampleChapter({ chapterNo: 2, primaryGoal: 'dialogue_game' })
      ];

      fs.writeFileSync(
        path.join(runDir, 'chapter-features.jsonl'),
        chapters.map(c => JSON.stringify(c)).join('\n') + '\n',
        'utf8'
      );

      // Pre-generate authentic archetypes.json
      discoverChapterArchetypes({ runDir, k: 2 });
      const beforeArchetypes = JSON.parse(fs.readFileSync(path.join(runDir, 'archetypes.json'), 'utf8'));

      // Run strategy miner
      const minerRes = mineStrategiesFromFeatures({ runDir });
      assert.ok(minerRes, 'mineStrategiesFromFeatures must succeed');

      const afterArchetypes = JSON.parse(fs.readFileSync(path.join(runDir, 'archetypes.json'), 'utf8'));
      assert.deepStrictEqual(
        Object.keys(afterArchetypes),
        Object.keys(beforeArchetypes),
        'Strategy miner must preserve existing dynamic archetypes without reverting to dummy placeholder'
      );
    });
  });

  // =========================================================================
  // GROUP 5: CLI Flags & Options Parsing
  // =========================================================================
  describe('Group 5: CLI Options & Flag Forwarding', () => {
    it('5.1: parseArgs parses --k, --clusters, --min-cluster-size, --output, --run-dir', () => {
      const args = [
        'discover-patterns',
        '--run-dir', '/tmp/custom-run',
        '--k', '4',
        '--min-cluster-size', '2',
        '--output', '/tmp/custom-archetypes.json'
      ];

      const opts = parseArgs(args);
      assert.strictEqual(opts.command, 'discover-patterns');
      assert.strictEqual(opts.runDir, '/tmp/custom-run');
      assert.strictEqual(opts.k, 4);
      assert.strictEqual(opts.clusters, 4);
      assert.strictEqual(opts.minClusterSize, 2);
      assert.strictEqual(opts.output, '/tmp/custom-archetypes.json');
      assert.strictEqual(opts.outputFile, '/tmp/custom-archetypes.json');
    });

    it('5.2: parseArgs parses aliases --clusters, --min-support, --output-file', () => {
      const args = [
        'cluster',
        '--clusters', '3',
        '--min-support', '1',
        '--output-file', 'out.json'
      ];

      const opts = parseArgs(args);
      assert.strictEqual(opts.command, 'cluster');
      assert.strictEqual(opts.k, 3);
      assert.strictEqual(opts.clusters, 3);
      assert.strictEqual(opts.minClusterSize, 1);
      assert.strictEqual(opts.outputFile, 'out.json');
    });
  });

  // =========================================================================
  // GROUP 6: Edge & Stress Cases
  // =========================================================================
  describe('Group 6: Edge & Extreme Cases', () => {
    it('6.1: Empty corpus features file returns empty manifest without unhandled crash', async () => {
      const runDir = path.join(tmpSuiteDir, 'run_empty_6_1');
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, 'chapter-features.jsonl'), '', 'utf8');

      const res = await discoverChapterArchetypes({ runDir, k: 3 });
      assert.ok(res && res.archetypes);
      assert.strictEqual(Object.keys(res.archetypes).length, 0);
      assert.strictEqual(res.metadata.count, 0);

      const parsed = JSON.parse(fs.readFileSync(path.join(runDir, 'archetypes.json'), 'utf8'));
      assert.deepStrictEqual(parsed, {});
    });

    it('6.2: Extreme feature outliers (all 0s vs all 1s) compute distance without division by zero', async () => {
      const runDir = path.join(tmpSuiteDir, 'run_extremes_6_2');
      fs.mkdirSync(runDir, { recursive: true });

      const zerosChapter = {
        bookId: 'b_zero',
        chapterNo: 1,
        stylometry: { narrativeDensity: 0, averageSentenceLength: 6, shortSentenceRatio: 0 },
        focusVector: { dialogue: 0, action: 0, setting: 0, conflict: 0, character: 0, emotion: 0, foreshadowing: 0 },
        screener: { scores: { thrill: 0, plot: 0, character: 0, emotion: 0, suspense: 0, style: 0, hook: 0, pacing: 0 } }
      };

      const onesChapter = {
        bookId: 'b_ones',
        chapterNo: 2,
        stylometry: { narrativeDensity: 1, averageSentenceLength: 60, shortSentenceRatio: 1 },
        focusVector: { dialogue: 1, action: 1, setting: 1, conflict: 1, character: 1, emotion: 1, foreshadowing: 1 },
        screener: { scores: { thrill: 1, plot: 1, character: 1, emotion: 1, suspense: 1, style: 1, hook: 1, pacing: 1 } }
      };

      fs.writeFileSync(
        path.join(runDir, 'chapter-features.jsonl'),
        [JSON.stringify(zerosChapter), JSON.stringify(onesChapter)].join('\n') + '\n',
        'utf8'
      );

      const res = await discoverChapterArchetypes({ runDir, k: 2 });
      assert.strictEqual(Object.keys(res.archetypes).length, 2);

      for (const arch of Object.values(res.archetypes)) {
        for (const [k, v] of Object.entries(arch.centroid.style)) {
          assert.ok(!Number.isNaN(v), `Centroid style ${k} must not be NaN`);
        }
      }
    });

    it('6.3: Non-existent runDir throws clear error', async () => {
      assert.throws(
        () => discoverChapterArchetypes({ runDir: path.join(tmpSuiteDir, 'does_not_exist_xyz') }),
        (err) => String(err.message).includes('无法找到特征文件')
      );
    });
  });
});
