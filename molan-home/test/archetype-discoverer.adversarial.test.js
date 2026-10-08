'use strict';

/**
 * @file archetype-discoverer.adversarial.test.js
 * Adversarial Stress & Empirical Challenge Test Suite for Archetype Discoverer (Milestone 1)
 * 
 * Tests extreme edge cases, degeneracies, malformed data, and numerical stability:
 * 1. Degenerate Datasets (N = 0, N = 1, N = 2 with K = 10, N < K, K <= 0)
 * 2. Malformed & Pathological Features (NaN, null, undefined, negative values, Infinity, type mismatches)
 * 3. Identical Vectors & Zero Variance (N identical points with K > 1, empty cluster defense)
 * 4. High-Dimensional Geometry & Extreme Outliers (all-zeros, all-ones, orthogonal axes, antipodal clusters)
 * 5. Determinism & Numerical Invariants (Centroid precision, tension in [1.0, 10.0], beat ratios sum to 1.00, zero NaN)
 * 6. File & CLI Robustness (Corrupted JSONL lines, unsegmented chapter filtering, missing fields)
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
  calculateEuclideanDistance,
  calculateRmseDistance,
  clusterChaptersDeterministic,
  synthesizeChapterArchetypeProfile,
  discoverChapterArchetypes
} = require('../lib/composition/corpus/archetype-discoverer');

function createBaseChapter(overrides = {}) {
  const chapterNo = overrides.chapterNo ?? 1;
  const bookId = overrides.bookId || 'adv_book_01';
  return {
    bookId,
    chapterNo,
    chapterTitle: overrides.chapterTitle || `第${chapterNo}章 极限对抗`,
    novelTitle: overrides.novelTitle || '混沌纪元',
    author: overrides.author !== undefined ? overrides.author : '辰东',
    genre: overrides.genre || 'xuanhuan',
    totalChars: overrides.totalChars || 3000,
    primaryGoal: overrides.primaryGoal || 'conflict_push',
    secondaryGoals: overrides.secondaryGoals || ['dialogue_game'],
    stylometry: {
      narrativeDensity: 0.8,
      emotionalIntensity: 0.7,
      rhetoricalAbundance: 0.4,
      colloquialLevel: 0.3,
      dialogueRatio: 0.35,
      psychologicalRatio: 0.2,
      settingRatio: 0.15,
      averageSentenceLength: 22.0,
      shortSentenceRatio: 0.6,
      informationDensity: 0.7,
      negativeSpaceRatio: 0.35,
      ...(overrides.stylometry || {})
    },
    focusVector: overrides.focusVector || {
      dialogue: 0.25,
      action: 0.30,
      setting: 0.10,
      conflict: 0.20,
      character: 0.05,
      emotion: 0.05,
      foreshadowing: 0.05
    },
    screener: overrides.screener || {
      scores: {
        thrill: 0.88,
        plot: 0.82,
        character: 0.75,
        emotion: 0.70,
        suspense: 0.80,
        style: 0.78,
        hook: 0.85,
        pacing: 0.80
      },
      qualifiedDimensions: ['thrill', 'plot', 'suspense', 'hook']
    },
    tailHook: overrides.tailHook || {
      strength: 0.85,
      type: 'crisis_escalation',
      tailSnippet: '暗影之中，杀机骤现！'
    },
    ...overrides
  };
}

describe('Adversarial Challenge: Chapter Archetype Discovery Engine', () => {
  let tmpSuiteDir;

  before(() => {
    tmpSuiteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adv-archetype-test-'));
  });

  after(() => {
    if (tmpSuiteDir && fs.existsSync(tmpSuiteDir)) {
      fs.rmSync(tmpSuiteDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // Challenge Dimension 1: Degenerate Datasets (N = 0, N = 1, N = 2 with K = 10)
  // =========================================================================
  describe('Dimension 1: Degenerate Datasets', () => {
    it('1.1: N = 0 empty dataset returns empty result without crashing', () => {
      const res = clusterChaptersDeterministic([], 5);
      assert.strictEqual(res.k, 0);
      assert.deepStrictEqual(res.clusters, []);
    });

    it('1.2: N = 0 with only UNSEGMENTED virtual chapters filters all out safely', () => {
      const unsegChapters = [
        { chapterNo: 0, chapterTitle: 'UNSEGMENTED', unsegmented: true },
        { chapterNo: 0, title: 'UNSEGMENTED' },
        null,
        undefined
      ];
      const res = clusterChaptersDeterministic(unsegChapters, 5);
      assert.strictEqual(res.k, 0);
      assert.deepStrictEqual(res.clusters, []);
    });

    it('1.3: N = 1 with K = 10 clamps K_eff = 1 and centroid strictly equals vector', () => {
      const ch = createBaseChapter({ chapterNo: 1 });
      const res = clusterChaptersDeterministic([ch], 10);
      assert.strictEqual(res.k, 1);
      assert.strictEqual(res.clusters.length, 1);
      const c = res.clusters[0];
      assert.strictEqual(c.members.length, 1);
      assert.strictEqual(c.members[0].distanceToCentroid, 0);
      
      const v = extract26DVector(ch);
      for (let d = 0; d < 26; d++) {
        assert.ok(Math.abs(c.centroid[d] - v[d]) < 1e-9, `Dimension ${d} should match`);
      }
    });

    it('1.4: N = 2 with K = 10 clamps K_eff = 2 without crash or division by zero', () => {
      const ch1 = createBaseChapter({ chapterNo: 1, stylometry: { narrativeDensity: 0.9 } });
      const ch2 = createBaseChapter({ chapterNo: 2, stylometry: { narrativeDensity: 0.1 } });
      const res = clusterChaptersDeterministic([ch1, ch2], 10);
      assert.strictEqual(res.k, 2);
      assert.strictEqual(res.clusters.length, 2);
      
      let totalMembers = 0;
      for (const cl of res.clusters) {
        totalMembers += cl.members.length;
        assert.ok(cl.members.length >= 1, 'Each cluster has at least 1 member');
        assert.ok(!Number.isNaN(cl.centroid[0]), 'Centroid dimension must not be NaN');
      }
      assert.strictEqual(totalMembers, 2);
    });

    it('1.5: requestedK = 0, negative (-5), or NaN gracefully clamped to valid K', () => {
      const chs = [createBaseChapter({ chapterNo: 1 }), createBaseChapter({ chapterNo: 2 })];
      
      const resZero = clusterChaptersDeterministic(chs, 0);
      assert.strictEqual(resZero.k, 1, 'K=0 should clamp to 1');

      const resNeg = clusterChaptersDeterministic(chs, -5);
      assert.strictEqual(resNeg.k, 1, 'K=-5 should clamp to 1');

      const resNan = clusterChaptersDeterministic(chs, NaN);
      assert.strictEqual(resNan.k, 2, 'K=NaN should fallback to 5 and clamp to N=2');

      const resNull = clusterChaptersDeterministic(chs, null);
      assert.strictEqual(resNull.k, 2, 'K=null should fallback to 5 and clamp to N=2');
    });
  });

  // =========================================================================
  // Challenge Dimension 2: Malformed Features & Pathological Boundary Values
  // =========================================================================
  describe('Dimension 2: Malformed & Pathological Features', () => {
    it('2.1: clamp function withstands NaN, null, undefined, strings, Infinity, -Infinity', () => {
      assert.strictEqual(clamp(NaN, 0, 1, 0.5), 0.5);
      assert.strictEqual(clamp(null, 0, 1, 0.5), 0.5);
      assert.strictEqual(clamp(undefined, 0, 1, 0.5), 0.5);
      assert.strictEqual(clamp('not_a_number', 0, 1, 0.5), 0.5);
      assert.strictEqual(clamp(-100, 0, 1, 0.5), 0);
      assert.strictEqual(clamp(100, 0, 1, 0.5), 1);
      assert.strictEqual(clamp(Infinity, 0, 1, 0.5), 1);
      assert.strictEqual(clamp(-Infinity, 0, 1, 0.5), 0);
      assert.strictEqual(clamp('0.75', 0, 1, 0.5), 0.75);
    });

    it('2.2: extract26DVector on completely empty object {} produces valid non-NaN 26D vector in [0, 1]', () => {
      const v = extract26DVector({});
      assert.strictEqual(v.length, 26);
      for (let i = 0; i < 26; i++) {
        assert.ok(!Number.isNaN(v[i]), `Vector index ${i} must not be NaN`);
        assert.ok(v[i] >= 0 && v[i] <= 1, `Vector index ${i} (${v[i]}) must be in [0, 1]`);
      }
    });

    it('2.3: Pathological averageSentenceLength (-9999, 0, 9999, NaN, Infinity) normalizes safely', () => {
      const vNeg = extract26DVector({ stylometry: { averageSentenceLength: -9999 } });
      assert.ok(vNeg[7] >= 0 && vNeg[7] <= 1 && !Number.isNaN(vNeg[7]));

      const vHuge = extract26DVector({ stylometry: { averageSentenceLength: 99999 } });
      assert.ok(vHuge[7] >= 0 && vHuge[7] <= 1 && !Number.isNaN(vHuge[7]));

      const vNan = extract26DVector({ stylometry: { averageSentenceLength: NaN } });
      assert.ok(vNan[7] >= 0 && vNan[7] <= 1 && !Number.isNaN(vNan[7]));

      const vInf = extract26DVector({ stylometry: { averageSentenceLength: Infinity } });
      assert.ok(vInf[7] >= 0 && vInf[7] <= 1 && !Number.isNaN(vInf[7]));
    });

    it('2.4: Malformed focusVector (all zeros, negative, non-numeric, null) resolves without division by zero', () => {
      const vZero = extract26DVector({
        focusVector: { dialogue: 0, action: 0, setting: 0, conflict: 0, character: 0, emotion: 0, foreshadowing: 0 }
      });
      let sumZero = 0;
      for (let i = 11; i <= 17; i++) {
        assert.ok(!Number.isNaN(vZero[i]));
        sumZero += vZero[i];
      }
      assert.ok(Math.abs(sumZero - 1.0) < 1e-4, `Focus vector sum should be 1.0, got ${sumZero}`);

      const vNeg = extract26DVector({
        focusVector: { dialogue: -5, action: -10, setting: null, conflict: 'bad', character: undefined }
      });
      for (let i = 11; i <= 17; i++) {
        assert.ok(!Number.isNaN(vNeg[i]), `Focus dim ${i} must not be NaN`);
        assert.ok(vNeg[i] >= 0 && vNeg[i] <= 1);
      }
    });

    it('2.5: All-NaN chapter object properties produce stable clean vector', () => {
      const dirty = {
        stylometry: {
          narrativeDensity: NaN,
          emotionalIntensity: NaN,
          rhetoricalAbundance: 'invalid',
          colloquialLevel: null,
          dialogueRatio: undefined,
          psychologicalRatio: -999,
          settingRatio: 999,
          averageSentenceLength: NaN,
          shortSentenceRatio: null,
          informationDensity: 'foo',
          negativeSpaceRatio: NaN
        },
        focusVector: {
          dialogue: NaN,
          action: NaN,
          setting: NaN,
          conflict: NaN,
          character: NaN,
          emotion: NaN,
          foreshadowing: NaN
        },
        screener: {
          scores: { thrill: NaN, plot: null, character: 'bad', emotion: -1, suspense: 99 }
        }
      };

      const v = extract26DVector(dirty);
      for (let d = 0; d < 26; d++) {
        assert.ok(!Number.isNaN(v[d]), `Dim ${d} should not be NaN`);
        assert.ok(v[d] >= 0.0 && v[d] <= 1.0, `Dim ${d} (${v[d]}) should be in [0, 1]`);
      }
    });
  });

  // =========================================================================
  // Challenge Dimension 3: Identical Vectors & Zero Variance
  // =========================================================================
  describe('Dimension 3: Identical Vectors & Zero Distance', () => {
    it('3.1: N = 10 identical chapters clustered with K = 3 runs without crashing or NaN', () => {
      const identicalChapters = [];
      for (let i = 0; i < 10; i++) {
        identicalChapters.push(createBaseChapter({ chapterNo: i + 1, bookId: `book_${i + 1}` }));
      }

      const res = clusterChaptersDeterministic(identicalChapters, 3);
      assert.strictEqual(res.k, 3);
      assert.strictEqual(res.clusters.length, 3);

      let totalMembers = 0;
      for (const cl of res.clusters) {
        totalMembers += cl.members.length;
        for (let d = 0; d < 26; d++) {
          assert.ok(!Number.isNaN(cl.centroid[d]), `Centroid dim ${d} must not be NaN`);
        }
      }
      assert.strictEqual(totalMembers, 10, 'All 10 items must be accounted for');
    });

    it('3.2: Dynamic profile synthesis on identical vector clusters produces valid profiles without NaN', () => {
      const identicalChapters = [];
      for (let i = 0; i < 6; i++) {
        identicalChapters.push(createBaseChapter({ chapterNo: i + 1 }));
      }
      const res = clusterChaptersDeterministic(identicalChapters, 2);
      for (const cl of res.clusters) {
        const profile = synthesizeChapterArchetypeProfile(cl);
        assert.ok(profile.id, 'Must have archetype id');
        assert.ok(Array.isArray(profile.tensionProfile.tensionPoints));
        for (const tp of profile.tensionProfile.tensionPoints) {
          assert.ok(!Number.isNaN(tp), 'Tension point must not be NaN');
          assert.ok(tp >= 1.0 && tp <= 10.0, `Tension point ${tp} must be in [1.0, 10.0]`);
        }
        for (const r of profile.pacingFormula.beatWordRatios) {
          assert.ok(!Number.isNaN(r), 'Beat ratio must not be NaN');
        }
        const ratioSum = profile.pacingFormula.beatWordRatios.reduce((a, b) => a + b, 0);
        assert.ok(Math.abs(ratioSum - 1.0) < 0.05, `Beat ratios must sum to ~1.0, got ${ratioSum}`);
      }
    });

    it('3.3: Distance between two identical chapters is strictly 0', () => {
      const ch1 = createBaseChapter({ chapterNo: 1 });
      const ch2 = createBaseChapter({ chapterNo: 2 });
      const v1 = extract26DVector(ch1);
      const v2 = extract26DVector(ch2);
      const dist = calculateEuclideanDistance(v1, v2);
      const rmse = calculateRmseDistance(v1, v2);
      assert.strictEqual(dist, 0);
      assert.strictEqual(rmse, 0);
    });
  });

  // =========================================================================
  // Challenge Dimension 4: High-Dimensional Geometry & Extreme Outliers
  // =========================================================================
  describe('Dimension 4: High-Dimensional Geometry & Extreme Outliers', () => {
    it('4.1: Extreme opposite vectors (All 0s vs All 1s) compute accurate distances', () => {
      const vZero = new Float64Array(26).fill(0.0);
      const vOne = new Float64Array(26).fill(1.0);

      const expectedEuclidean = Math.sqrt(26); // sqrt(26) ~= 5.099
      const dist = calculateEuclideanDistance(vZero, vOne);
      assert.ok(Math.abs(dist - expectedEuclidean) < 1e-9);

      const rmse = calculateRmseDistance(vZero, vOne);
      assert.ok(Math.abs(rmse - 1.0) < 1e-9, `RMSE between [0..0] and [1..1] must be exactly 1.0`);
    });

    it('4.2: Isolated extreme outlier clusters cleanly without corrupting other clusters', () => {
      const normalChapters = [];
      for (let i = 0; i < 9; i++) {
        normalChapters.push(createBaseChapter({
          chapterNo: i + 1,
          stylometry: { narrativeDensity: 0.8, shortSentenceRatio: 0.7 }
        }));
      }
      // Single extreme outlier (all features at 0 or extreme opposite)
      const outlier = createBaseChapter({
        chapterNo: 10,
        stylometry: {
          narrativeDensity: 0.01,
          emotionalIntensity: 0.01,
          rhetoricalAbundance: 0.01,
          shortSentenceRatio: 0.01,
          averageSentenceLength: 60.0
        },
        screener: {
          scores: { thrill: 0.01, plot: 0.01, character: 0.01, emotion: 0.01, suspense: 0.01, style: 0.01, hook: 0.01, pacing: 0.01 }
        }
      });

      const res = clusterChaptersDeterministic([...normalChapters, outlier], 2);
      assert.strictEqual(res.k, 2);
      
      // One of the clusters should isolate the outlier or have it with minimal distortion
      const clusterWithOutlier = res.clusters.find(c =>
        c.members.some(m => m.chapter.chapterNo === 10)
      );
      assert.ok(clusterWithOutlier, 'Outlier must be assigned to a cluster');
    });

    it('4.3: Orthogonal basis chapters cluster into distinct centroids without collapsing', () => {
      // Create 3 orthogonal chapters dominated by: 1) Conflict, 2) Suspense, 3) Dialogue
      const chConflict = createBaseChapter({
        chapterNo: 1,
        primaryGoal: 'conflict_push',
        focusVector: { dialogue: 0.05, action: 0.5, setting: 0.05, conflict: 0.35, character: 0.01, emotion: 0.01, foreshadowing: 0.03 },
        screener: { scores: { thrill: 0.95, plot: 0.85, character: 0.3, emotion: 0.3, suspense: 0.4, style: 0.5, hook: 0.7, pacing: 0.9 } }
      });

      const chSuspense = createBaseChapter({
        chapterNo: 2,
        primaryGoal: 'info_reveal',
        focusVector: { dialogue: 0.1, action: 0.05, setting: 0.1, conflict: 0.05, character: 0.1, emotion: 0.1, foreshadowing: 0.5 },
        screener: { scores: { thrill: 0.4, plot: 0.7, character: 0.4, emotion: 0.5, suspense: 0.95, style: 0.6, hook: 0.9, pacing: 0.4 } }
      });

      const chDialogue = createBaseChapter({
        chapterNo: 3,
        primaryGoal: 'dialogue_game',
        focusVector: { dialogue: 0.6, action: 0.05, setting: 0.05, conflict: 0.1, character: 0.15, emotion: 0.02, foreshadowing: 0.03 },
        screener: { scores: { thrill: 0.3, plot: 0.5, character: 0.9, emotion: 0.6, suspense: 0.3, style: 0.7, hook: 0.4, pacing: 0.5 } }
      });

      const res = clusterChaptersDeterministic([chConflict, chSuspense, chDialogue], 3);
      assert.strictEqual(res.k, 3);
      for (const cl of res.clusters) {
        assert.strictEqual(cl.members.length, 1);
        const profile = synthesizeChapterArchetypeProfile(cl);
        assert.ok(profile.id);
        assert.ok(profile.name);
      }
    });
  });

  // =========================================================================
  // Challenge Dimension 5: Determinism, Schema & Numerical Invariants
  // =========================================================================
  describe('Dimension 5: Determinism & Schema Invariants', () => {
    it('5.1: 20 repeated executions produce identical cluster assignments and exact bitwise float centroids', () => {
      const chapters = [];
      for (let i = 0; i < 15; i++) {
        chapters.push(createBaseChapter({
          chapterNo: i + 1,
          bookId: `book_${(i % 3) + 1}`,
          stylometry: {
            narrativeDensity: 0.3 + (i * 0.04),
            dialogueRatio: 0.2 + (i * 0.03)
          }
        }));
      }

      const baseline = clusterChaptersDeterministic(chapters, 3);
      for (let run = 0; run < 20; run++) {
        const nextRun = clusterChaptersDeterministic(chapters, 3);
        assert.strictEqual(nextRun.k, baseline.k);
        for (let c = 0; c < baseline.k; c++) {
          for (let d = 0; d < 26; d++) {
            assert.strictEqual(nextRun.clusters[c].centroid[d], baseline.clusters[c].centroid[d],
              `Run ${run} cluster ${c} dim ${d} must be bitwise identical`);
          }
          assert.strictEqual(nextRun.clusters[c].members.length, baseline.clusters[c].members.length);
          for (let m = 0; m < baseline.clusters[c].members.length; m++) {
            assert.strictEqual(nextRun.clusters[c].members[m].chapter.chapterNo, baseline.clusters[c].members[m].chapter.chapterNo);
          }
        }
      }
    });

    it('5.2: Invariant Check: All tension points strictly in [1.0, 10.0]', () => {
      // Test 50 diverse synthesized profiles
      for (let i = 0; i < 50; i++) {
        const randCentroid = new Float64Array(26);
        for (let d = 0; d < 26; d++) randCentroid[d] = Math.random();
        const fakeCluster = {
          clusterIndex: i,
          centroid: randCentroid,
          members: [
            {
              chapter: createBaseChapter({ chapterNo: 1 }),
              distanceToCentroid: 0.1,
              index: 0
            }
          ]
        };
        const profile = synthesizeChapterArchetypeProfile(fakeCluster);
        for (const pt of profile.tensionProfile.tensionPoints) {
          assert.ok(pt >= 1.0 && pt <= 10.0, `Tension point ${pt} must be in [1.0, 10.0]`);
        }
        for (const beat of profile.tensionProfile.beats) {
          assert.ok(beat.tension >= 1.0 && beat.tension <= 10.0);
        }
      }
    });

    it('5.3: Invariant Check: Pacing beatWordRatios sum strictly to 1.00', () => {
      for (let i = 0; i < 50; i++) {
        const randCentroid = new Float64Array(26);
        for (let d = 0; d < 26; d++) randCentroid[d] = Math.random();
        const fakeCluster = {
          clusterIndex: i,
          centroid: randCentroid,
          members: [{ chapter: createBaseChapter({ chapterNo: 1 }), distanceToCentroid: 0.1, index: 0 }]
        };
        const profile = synthesizeChapterArchetypeProfile(fakeCluster);
        const sum = profile.pacingFormula.beatWordRatios.reduce((a, b) => a + b, 0);
        assert.strictEqual(Number(sum.toFixed(2)), 1.00, `Beat ratios must sum to 1.00, got ${sum}`);
        const budgetSum = profile.pacingFormula.sampleWordBudget.beatChars.reduce((a, b) => a + b, 0);
        assert.ok(Math.abs(budgetSum - profile.pacingFormula.sampleWordBudget.targetChars) <= 5,
          `Sample beat word budget must sum close to targetChars 3000, got ${budgetSum}`);
      }
    });

    it('5.4: Invariant Check: Centroid decomposition has zero NaN across style, focus, screener, vector', () => {
      const randCentroid = new Float64Array(26);
      for (let d = 0; d < 26; d++) randCentroid[d] = Math.random();
      const profile = synthesizeChapterArchetypeProfile({
        clusterIndex: 0,
        centroid: randCentroid,
        members: [{ chapter: createBaseChapter({ chapterNo: 1 }), distanceToCentroid: 0.1, index: 0 }]
      });

      for (const [k, v] of Object.entries(profile.centroid.style)) {
        assert.ok(!Number.isNaN(v), `Centroid style ${k} is NaN`);
      }
      for (const [k, v] of Object.entries(profile.centroid.focus)) {
        assert.ok(!Number.isNaN(v), `Centroid focus ${k} is NaN`);
      }
      for (const [k, v] of Object.entries(profile.centroid.screener)) {
        assert.ok(!Number.isNaN(v), `Centroid screener ${k} is NaN`);
      }
      for (const v of profile.centroid.vector) {
        assert.ok(!Number.isNaN(v), `Centroid vector entry is NaN`);
      }
    });
  });

  // =========================================================================
  // Challenge Dimension 6: File I/O, Corrupt Data & CLI Integration
  // =========================================================================
  describe('Dimension 6: File I/O, Corrupt Data & Integration', () => {
    it('6.1: discoverChapterArchetypes ignores corrupted JSONL lines gracefully without crashing', async () => {
      const testRunDir = path.join(tmpSuiteDir, 'corrupt_test_run');
      fs.mkdirSync(testRunDir, { recursive: true });
      const featuresFile = path.join(testRunDir, 'chapter-features.jsonl');

      const lines = [
        JSON.stringify(createBaseChapter({ chapterNo: 1 })),
        '{{{ INVALID CORRUPTED JSON LINE }}}',
        JSON.stringify(createBaseChapter({ chapterNo: 2 })),
        '',
        '   ',
        JSON.stringify(createBaseChapter({ chapterNo: 3 }))
      ];
      fs.writeFileSync(featuresFile, lines.join('\n'), 'utf8');

      const res = await discoverChapterArchetypes({ runDir: testRunDir, k: 2 });
      assert.strictEqual(res.metadata.totalChapters, 3, 'Must successfully parse 3 valid lines and ignore corrupted');
      assert.strictEqual(res.metadata.k, 2);

      const outFile = path.join(testRunDir, 'archetypes.json');
      assert.ok(fs.existsSync(outFile));
      const parsedOut = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      assert.strictEqual(Object.keys(parsedOut).length, 2);
    });

    it('6.2: discoverChapterArchetypes handles completely empty file (0 bytes)', async () => {
      const testRunDir = path.join(tmpSuiteDir, 'empty_file_run');
      fs.mkdirSync(testRunDir, { recursive: true });
      const featuresFile = path.join(testRunDir, 'chapter-features.jsonl');
      fs.writeFileSync(featuresFile, '', 'utf8');

      const res = await discoverChapterArchetypes({ runDir: testRunDir, k: 5 });
      assert.strictEqual(res.metadata.totalChapters, 0);
      assert.strictEqual(res.metadata.count, 0);
      assert.strictEqual(res.metadata.k, 0);
      assert.deepStrictEqual(res.archetypes, {});

      const outFile = path.join(testRunDir, 'archetypes.json');
      assert.ok(fs.existsSync(outFile));
      const parsedOut = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      assert.deepStrictEqual(parsedOut, {});
    });

    it('6.3: Author attribution: unknown, synthetic (author_xxx, novelTitle), or empty strictly yields null', () => {
      const chSynthetic1 = createBaseChapter({ chapterNo: 1, author: 'author_book123', bookId: 'book123' });
      const chSynthetic2 = createBaseChapter({ chapterNo: 2, author: '混沌纪元', novelTitle: '混沌纪元' });
      const chUnknown1 = createBaseChapter({ chapterNo: 3, author: '未知' });
      const chUnknown2 = createBaseChapter({ chapterNo: 4, author: '佚名' });
      const chVerified = createBaseChapter({ chapterNo: 5, author: '我吃西红柿' });

      const res = clusterChaptersDeterministic([chSynthetic1, chSynthetic2, chUnknown1, chUnknown2, chVerified], 1);
      const profile = synthesizeChapterArchetypeProfile(res.clusters[0]);

      // Only verified author should be counted in authorCount
      assert.strictEqual(profile.stats.authorCount, 1);
      
      // Exemplars must have author: null for synthetic/unknown
      for (const ex of profile.exemplars) {
        if (ex.chapterNo === 5) {
          assert.strictEqual(ex.author, '我吃西红柿');
        } else {
          assert.strictEqual(ex.author, null, `Chapter ${ex.chapterNo} should have null author`);
        }
      }
    });
  });
});
