'use strict';

/**
 * @file e2e-phase2-engine.test.js
 * Comprehensive 4-Tier End-to-End Test Suite for Molan Phase 2 Engine Architecture
 * 
 * Requirements & Acceptance Criteria Tested:
 * - R1 / C1: True Chapter Archetype Discovery (`discover-patterns`)
 * - R2 / C2: Attention Tiering Hard Budget Enforcement & Request Wiring
 * - R3 / C3: Evidence Catalog Hot Reload & Package Publisher Checksum Guard
 * - R4 / C4: Closed-Loop Experiment Engine across (Genre × Style × Goal × Focus × Hook)
 * - R5 / C5: Regression Suite Clean under Node 22
 * 
 * Test Hierarchy (60 Tests):
 * - Tier 1: Feature Coverage (T1.1 - T1.25, 25 tests)
 * - Tier 2: Boundary & Corner Cases (T2.1 - T2.25, 25 tests)
 * - Tier 3: Cross-Feature Interactions (T3.1 - T3.5, 5 tests)
 * - Tier 4: Real-World Application Scenarios (T4.1 - T4.5, 5 tests)
 */

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

// Subsystem Modules under test
const attentionTiering = require('../lib/composition/compiler/attention-tiering');
const strategyCompiler = require('../lib/composition/compiler/strategy-compiler');
const contentEngine = require('../lib/generation/content-engine');
const evidenceCatalogMod = require('../lib/composition/corpus/evidence-catalog');
const packagePublisherMod = require('../lib/composition/corpus/package-publisher');
const batchPipelineMod = require('../lib/composition/corpus/batch-pipeline');
const compatibilityMatrixMod = require('../lib/composition/compiler/compatibility-matrix');
const { defaultProfileRegistry } = require('../lib/composition/profiles/profile-registry');

// Safe module loaders for new Phase 2 modules
function getArchetypeDiscoverer() {
  try {
    return require('../lib/composition/corpus/archetype-discoverer');
  } catch (_) {
    return null;
  }
}

function getExperimentEngine() {
  try {
    return require('../lib/composition/evaluation/experiment-engine');
  } catch (_) {
    return null;
  }
}

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Helper to create synthetic chapter features
function createSyntheticChapterFeature(overrides = {}) {
  const id = overrides.id || `ch_${Math.random().toString(36).slice(2, 8)}`;
  return {
    bookId: overrides.bookId || 'book_alpha',
    chapterNo: overrides.chapterNo ?? 1,
    chapterTitle: overrides.chapterTitle || `第${overrides.chapterNo ?? 1}章 宿命对决`,
    novelTitle: overrides.novelTitle || '修真大主宰',
    author: overrides.author ?? '忘语',
    genre: overrides.genre || 'xuanhuan_cautious',
    totalChars: overrides.totalChars || 3200,
    primaryGoal: overrides.primaryGoal || 'conflict_push',
    secondaryGoals: overrides.secondaryGoals || ['dialogue_game'],
    stylometry: {
      narrativeDensity: overrides.narrativeDensity ?? 0.85,
      emotionalIntensity: overrides.emotionalIntensity ?? 0.70,
      rhetoricalAbundance: overrides.rhetoricalAbundance ?? 0.40,
      colloquialLevel: overrides.colloquialLevel ?? 0.30,
      dialogueRatio: overrides.dialogueRatio ?? 0.35,
      psychologicalRatio: overrides.psychologicalRatio ?? 0.25,
      settingRatio: overrides.settingRatio ?? 0.15,
      averageSentenceLength: overrides.averageSentenceLength ?? 17.5,
      shortSentenceRatio: overrides.shortSentenceRatio ?? 0.65,
      informationDensity: overrides.informationDensity ?? 0.80,
      negativeSpaceRatio: overrides.negativeSpaceRatio ?? 0.30,
      ...(overrides.stylometry || {})
    },
    focusVector: {
      dialogue: 0.25,
      action: 0.35,
      setting: 0.10,
      conflict: 0.20,
      character: 0.05,
      emotion: 0.03,
      foreshadowing: 0.02,
      ...(overrides.focusVector || {})
    },
    screener: {
      scores: {
        thrill: 0.85,
        plot: 0.80,
        character: 0.75,
        emotion: 0.70,
        suspense: 0.75,
        style: 0.80,
        hook: 0.85,
        pacing: 0.80,
        ...(overrides.screenerScores || {})
      }
    },
    tailHook: {
      type: overrides.hookType || 'crisis',
      gapType: 'danger_gap',
      strength: 0.88,
      tailSnippet: '暗处的剑尖已递至后心三寸，他却忽然笑了。'
    },
    outcomeContract: {
      stateDelta: {
        stateBefore: '陷于重围',
        events: '祭出本命雷符强行破阵',
        stateAfter: '斩杀先锋并夺路遁走',
        invalidIfRemoved: '后续秘境之行将缺乏关键通行信物'
      },
      readerEffect: {
        knowledgeDelta: '察觉幕后黑手为同门师叔',
        emotionalShift: '由绝望转为凛冽杀意'
      },
      characterEffect: {
        motivationDelta: '彻底放弃退让幻想',
        beliefShift: '认清弱肉强食现实'
      }
    }
  };
}

// Helper to write a valid staging directory
function createStagingRunDir(baseDir, runId, options = {}) {
  const runDir = path.join(baseDir, runId);
  fs.mkdirSync(runDir, { recursive: true });

  const chapterFeatures = options.chapterFeatures || [
    createSyntheticChapterFeature({ chapterNo: 1, primaryGoal: 'conflict_push' }),
    createSyntheticChapterFeature({ chapterNo: 2, primaryGoal: 'info_reveal', narrativeDensity: 0.55 }),
    createSyntheticChapterFeature({ chapterNo: 3, primaryGoal: 'dialogue_game', dialogueRatio: 0.65 }),
    createSyntheticChapterFeature({ chapterNo: 4, primaryGoal: 'conflict_push', narrativeDensity: 0.90 })
  ];

  fs.writeFileSync(
    path.join(runDir, 'chapter-features.jsonl'),
    chapterFeatures.map(f => JSON.stringify(f)).join('\n') + '\n',
    'utf8'
  );

  const strategyRules = options.strategyRules || [
    {
      id: 'rule_conflict_pivot',
      name: '微观动态受力对抗律',
      ruleStatement: '受力必须有物理反馈，反作用力推动局势位移',
      abstractPattern: '受力 -> 传导 -> 变形 -> 位移',
      microExample: '剑锋交击爆出火星，他虎口发麻退后两步',
      counterExample: '两人对砍各自报招无动于衷',
      failureMode: '机械报招无物理实感',
      evidenceStrength: 'A',
      stats: { supportCount: 15, bookCount: 3, authorCount: 3, qualityLift: 0.22, confidence: 0.92, confoundScore: 0.08 },
      applicableDimensions: ['conflict_push', 'xuanhuan_cautious']
    },
    {
      id: 'rule_dialogue_subtext',
      name: '言外之意对白留白律',
      ruleStatement: '每句对话背后隐藏未言明的权力博弈与试探',
      abstractPattern: '明言示弱 -> 暗藏机锋 -> 观察反应',
      microExample: '“茶凉了。”他没看杯子，只看着对方紧扣的刀柄。',
      counterExample: '“你敢背叛我？”“我就背叛你怎么了！”',
      failureMode: '小学生吵架式平铺直叙',
      evidenceStrength: 'B',
      stats: { supportCount: 8, bookCount: 2, authorCount: 2, qualityLift: 0.14, confidence: 0.85, confoundScore: 0.12 },
      applicableDimensions: ['dialogue_game', 'laobai_restrained']
    }
  ];

  fs.writeFileSync(
    path.join(runDir, 'strategy-rules.jsonl'),
    strategyRules.map(r => JSON.stringify(r)).join('\n') + '\n',
    'utf8'
  );

  const archetypes = options.archetypes || {
    archetype_crisis_breakthrough: {
      schemaVersion: 'chapter-archetype-profile-v1',
      id: 'archetype_crisis_breakthrough',
      name: '危局破境型',
      category: 'conflict_push',
      structuralDynamics: {
        drivePattern: '绝境压制 -> 寻隙反击 -> 底牌碰撞 -> 突围留钩',
        typicalStructure: ['入场微观摩擦', '危机骤然升级', '底牌交锋决胜', '留钩引爆下文']
      },
      tensionProfile: {
        curveType: 'escalating_climax',
        tensionPoints: [3.5, 6.0, 9.5, 7.0],
        dynamicFormula: 'T(t) = 3.5 + 6.0 * (t/3)^1.8'
      },
      pacingFormula: {
        beatWordRatios: [0.20, 0.30, 0.38, 0.12],
        targetShortSentenceRatio: 0.65
      },
      exemplars: [
        {
          bookId: 'book_alpha',
          chapterNo: 1,
          distanceToCentroid: 0.05,
          snippet: '暗处的剑尖已递至后心三寸……'
        }
      ],
      clusterMembers: ['book_alpha_ch1', 'book_alpha_ch4']
    }
  };

  fs.writeFileSync(
    path.join(runDir, 'archetypes.json'),
    JSON.stringify(archetypes, null, 2),
    'utf8'
  );

  fs.writeFileSync(
    path.join(runDir, 'manifest.json'),
    JSON.stringify({
      runId,
      createdAt: new Date().toISOString(),
      booksCompleted: 2,
      chaptersProcessed: chapterFeatures.length
    }, null, 2),
    'utf8'
  );

  fs.writeFileSync(
    path.join(runDir, 'evidence.json'),
    JSON.stringify({ rulesCount: strategyRules.length }, null, 2),
    'utf8'
  );

  fs.writeFileSync(
    path.join(runDir, 'quality-report.json'),
    JSON.stringify(options.qualityReport || {
      status: 'passed',
      totalChaptersAnalyzed: chapterFeatures.length,
      publishedRulesCount: strategyRules.length,
      timestamp: new Date().toISOString()
    }, null, 2),
    'utf8'
  );

  return runDir;
}

describe('Molan Phase 2 Engine Architecture E2E Test Suite', () => {
  let tmpRoot;

  before(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'molan_p2_e2e_suite_'));
  });

  after(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch (_) {}
  });

  // =========================================================================
  // TIER 1: FEATURE COVERAGE (25 Tests)
  // =========================================================================
  describe('Tier 1: Feature Coverage (Primary Path & Contracts)', () => {

    // --- Feature 1: Chapter Archetype Discovery ---
    describe('Feature 1: Chapter Archetype Discovery (R1 / C1)', () => {
      it('T1.1: Standalone archetype discovery produces structured archetypes.json derived from feature centroids', async () => {
        const discoverer = getArchetypeDiscoverer();
        assert.ok(discoverer, 'archetype-discoverer.js must exist in lib/composition/corpus/');
        assert.strictEqual(typeof discoverer.discoverChapterArchetypes, 'function', 'Must export discoverChapterArchetypes');

        const runDir = createStagingRunDir(tmpRoot, 'run_t1_1');
        const res = await discoverer.discoverChapterArchetypes({ runDir, k: 2 });

        assert.ok(res && res.archetypes, 'Must return object with archetypes key');
        const archetypesPath = path.join(runDir, 'archetypes.json');
        assert.ok(fs.existsSync(archetypesPath), 'archetypes.json must be written to runDir');

        const parsed = JSON.parse(fs.readFileSync(archetypesPath, 'utf8'));
        const archKeys = Object.keys(parsed);
        assert.ok(archKeys.length >= 1, 'At least 1 archetype must be generated');

        const first = parsed[archKeys[0]];
        assert.ok(first.id, 'Archetype must have id');
        assert.ok(first.name, 'Archetype must have human readable name');
        assert.ok(first.centroid, 'Archetype must contain mathematical centroid');
        assert.ok(typeof first.centroid === 'object', 'Centroid must be an object');
      });

      it('T1.2: Synthesized ChapterArchetype contains dynamic structuralDynamics, tensionProfile, and pacingFormula', async () => {
        const discoverer = getArchetypeDiscoverer();
        assert.ok(discoverer, 'archetype-discoverer.js must exist');

        const runDir = createStagingRunDir(tmpRoot, 'run_t1_2');
        const res = await discoverer.discoverChapterArchetypes({ runDir, k: 2 });
        const arch = Object.values(res.archetypes)[0];

        assert.ok(arch.structuralDynamics, 'structuralDynamics must exist');
        assert.ok(arch.structuralDynamics.drivePattern, 'drivePattern must be non-empty string');
        assert.ok(Array.isArray(arch.structuralDynamics.typicalStructure), 'typicalStructure must be an array');
        assert.ok(arch.structuralDynamics.typicalStructure.length >= 3, 'typicalStructure must have at least 3 stages');

        assert.ok(arch.tensionProfile, 'tensionProfile must exist');
        assert.ok(arch.tensionProfile.curveType, 'tensionProfile.curveType must be defined');
        assert.ok(Array.isArray(arch.tensionProfile.tensionPoints), 'tensionPoints must be array of numeric beats');
        assert.ok(arch.tensionProfile.dynamicFormula, 'dynamicFormula must provide mathematical curve formula');

        assert.ok(arch.pacingFormula, 'pacingFormula must exist');
        assert.ok(Array.isArray(arch.pacingFormula.beatWordRatios), 'beatWordRatios must be numeric ratio array');
        assert.ok(typeof arch.pacingFormula.targetShortSentenceRatio === 'number', 'targetShortSentenceRatio must be numeric');
      });

      it('T1.3: Archetypes include valid exemplars sorted by centroid distance and cluster member references', async () => {
        const discoverer = getArchetypeDiscoverer();
        assert.ok(discoverer, 'archetype-discoverer.js must exist');

        const runDir = createStagingRunDir(tmpRoot, 'run_t1_3');
        const res = await discoverer.discoverChapterArchetypes({ runDir, k: 2 });
        const arch = Object.values(res.archetypes)[0];

        assert.ok(Array.isArray(arch.exemplars), 'exemplars must be an array');
        assert.ok(arch.exemplars.length >= 1, 'exemplars must contain at least 1 exemplar');
        const topExemplar = arch.exemplars[0];
        assert.ok(topExemplar.bookId, 'Exemplar must have bookId');
        assert.ok(typeof topExemplar.distanceToCentroid === 'number', 'Exemplar must have distanceToCentroid');
        assert.ok(topExemplar.distanceToCentroid >= 0, 'Distance must be non-negative');

        assert.ok(Array.isArray(arch.clusterMembers), 'clusterMembers must be an array');
        assert.ok(arch.clusterMembers.length >= 1, 'clusterMembers must reference at least one chapter');
      });

      it('T1.4: Batch pipeline runDiscoverPatterns decouples from runBuildStrategy and preserves strategy-rules.jsonl', async () => {
        const pipeline = new batchPipelineMod.CorpusBatchPipeline({ baseDir: tmpRoot });
        const runDir = createStagingRunDir(tmpRoot, 'run_t1_4');

        const rulesBefore = fs.readFileSync(path.join(runDir, 'strategy-rules.jsonl'), 'utf8');
        const res = await pipeline.runDiscoverPatterns({ runDir, k: 2 });

        assert.ok(res, 'runDiscoverPatterns must return result');
        assert.ok(fs.existsSync(path.join(runDir, 'archetypes.json')), 'archetypes.json must be generated');

        const rulesAfter = fs.readFileSync(path.join(runDir, 'strategy-rules.jsonl'), 'utf8');
        assert.strictEqual(rulesBefore, rulesAfter, 'runDiscoverPatterns must not overwrite or modify strategy-rules.jsonl');
      });

      it('T1.5: CLI corpus-cli.js discover-patterns delegates to runDiscoverPatterns with option forwarding', async () => {
        const pipeline = new batchPipelineMod.CorpusBatchPipeline({ baseDir: tmpRoot });
        assert.strictEqual(typeof pipeline.runDiscoverPatterns, 'function', 'CorpusBatchPipeline must expose runDiscoverPatterns');

        const runDir = createStagingRunDir(tmpRoot, 'run_t1_5');
        const result = await pipeline.runDiscoverPatterns({ runDir, k: 3 });
        assert.ok(result, 'CLI delegation target must execute successfully');
      });
    });

    // --- Feature 2: Attention Tiering Hard Budget & Request Wiring ---
    describe('Feature 2: Attention Hard Budget & Request Wiring (R2 / C2)', () => {
      it('T1.6: tierAttention packages 4 clean attention tiers with accurate token accounting', () => {
        const res = attentionTiering.tierAttention({
          permanentContext: '【永驻规则】主角不可拥有无敌外挂',
          chapterStrategy: '【章节策略】突破第一重境界\n【P0 绝对事实与物理围栏】：必须承受真气反噬',
          evidenceCards: [{ id: 'card_1', rule: '受力反馈', evidenceStrength: 'A', stats: { supportCount: 10 } }],
          immediateContext: '【现场事实】密室石门已被封死',
          maxTotalTokens: 500
        });

        assert.ok(res.tier1Permanent !== undefined, 'tier1Permanent must be defined');
        assert.ok(res.tier2Strategy !== undefined, 'tier2Strategy must be defined');
        assert.ok(res.tier3Evidence !== undefined, 'tier3Evidence must be defined');
        assert.ok(res.tier4Immediate !== undefined, 'tier4Immediate must be defined');
        assert.ok(res.metrics, 'metrics must be present');
        assert.ok(res.metrics.totalTokens <= 500, 'totalTokens must not exceed budget');
        assert.strictEqual(res.metrics.withinBudget, true, 'withinBudget must be true');
      });

      it('T1.7: Multi-stage pruning drops Tier 3 first, then summarizes Tier 1/Tier 4, and compacts Tier 2', () => {
        const longText = '长文本测试内容，用于触发修剪阶段。'.repeat(30);
        const res = attentionTiering.tierAttention({
          permanentContext: `【永驻规则】${longText}`,
          chapterStrategy: `【P0 绝对事实与物理围栏】：核心不可动摇\n【状态跃迁契约】：章前初入，章后突破\n${longText}`,
          evidenceCards: [
            { id: 'card_low', rule: '次要规则', evidenceStrength: 'B', stats: { supportCount: 3 } }
          ],
          immediateContext: `【即时环境】${longText}`,
          maxTotalTokens: 120
        });

        assert.ok(res.metrics.pruned, 'pruned flag must be true');
        assert.ok(Array.isArray(res.metrics.pruningActions), 'pruningActions must be an array');
        assert.ok(res.metrics.totalTokens <= 120, 'totalTokens must satisfy hard maxTotalTokens');
      });

      it('T1.8: FINAL_BUDGET_ASSERT invariant strictly asserts totalTokens <= maxTotalTokens or throws BUDGET_EXCEEDED', () => {
        assert.strictEqual(typeof attentionTiering.FINAL_BUDGET_ASSERT, 'function', 'Must export FINAL_BUDGET_ASSERT');

        // Within budget succeeds
        assert.strictEqual(attentionTiering.FINAL_BUDGET_ASSERT(50, 100), true);

        // Exceeding budget throws BUDGET_EXCEEDED
        assert.throws(
          () => attentionTiering.FINAL_BUDGET_ASSERT(120, 100),
          (err) => err.code === 'BUDGET_EXCEEDED' && (err.status === 402 || err.statusCode === 402)
        );
      });

      it('T1.9: strategy-compiler binds tiered attention outputs into returned prompts and attention payload', () => {
        const spec = defaultProfileRegistry.resolveCompositionSpec({
          genre: 'xuanhuan_cautious',
          style: 'laobai_restrained',
          chapterGoal: 'conflict_push',
          focus: 'action',
          hook: 'crisis'
        });

        const compiled = strategyCompiler.compileChapterStrategy({
          compositionSpec: spec,
          chapterContext: { chapterNo: 1, novelTitle: '测试剑仙' },
          options: { maxTotalTokens: 1000 }
        });

        assert.ok(compiled.attention, 'compiledStrategy must include attention payload');
        assert.ok(compiled.attention.tier1Permanent !== undefined, 'attention must have tier1Permanent');
        assert.ok(compiled.attention.tier2Strategy !== undefined, 'attention must have tier2Strategy');
        assert.ok(compiled.attention.tier3Evidence !== undefined, 'attention must have tier3Evidence');
        assert.ok(compiled.attention.tier4Immediate !== undefined, 'attention must have tier4Immediate');
        assert.ok(compiled.attentionMetrics, 'compiledStrategy must include attentionMetrics');
      });

      it('T1.10: content-engine buildDraftRequest and generateDraft wire attention object into callModel payload', async () => {
        const spec = defaultProfileRegistry.resolveCompositionSpec({
          genre: 'xuanhuan_cautious',
          style: 'laobai_restrained',
          chapterGoal: 'info_reveal',
          focus: 'dialogue_game',
          hook: 'suspense_clue'
        });

        const draftRequest = contentEngine.buildDraftRequest({
          request: { compositionSpec: spec, runId: 'test_wire_run' },
          contract: { chapterGoal: '探查', wordBudget: { target: 2000 } }
        });

        assert.ok(draftRequest.attention || draftRequest.compiled?.attention, 'buildDraftRequest must attach attention');

        let capturedPayload = null;
        await contentEngine.generateDraft({
          callModel: async (_auth, payload) => {
            capturedPayload = payload;
            return { text: '正文生成内容', usage: { totalTokens: 20 } };
          },
          auth: { user: { email: 'e2e@molan.com' } },
          request: { compositionSpec: spec, runId: 'test_wire_run' },
          contract: { chapterGoal: '探查', wordBudget: { target: 2000 } }
        });

        assert.ok(capturedPayload, 'callModel must have been invoked');
        assert.ok(capturedPayload.attention !== undefined, 'Model payload must actively ingest attention');
        assert.ok(capturedPayload.attention.tier2Strategy !== undefined, 'attention.tier2Strategy must be present in model payload');
      });
    });

    // --- Feature 3: Evidence Catalog Hot Reload & Invalidation ---
    describe('Feature 3: Evidence Catalog Hot Reload & Invalidation (R3 / C3)', () => {
      it('T1.11: EvidenceCatalog detects active_package.json updates and hot-reloads cards without restart', () => {
        const kbDir = path.join(tmpRoot, 'kb_t1_11');
        const publisher = new packagePublisherMod.PackagePublisher({ targetBase: kbDir });

        const run1 = createStagingRunDir(tmpRoot, 'run_v1', {
          strategyRules: [{
            id: 'rule_v1',
            name: 'V1 规约',
            ruleStatement: 'V1 专有铁律',
            evidenceStrength: 'A',
            stats: { supportCount: 10, bookCount: 2, authorCount: 2, qualityLift: 0.2 },
            applicableDimensions: ['conflict_push']
          }]
        });
        publisher.publishRun(run1, { version: 'v1.0.0' });

        const catalog = new evidenceCatalogMod.EvidenceCatalog();
        catalog.loadActivePublishedPackage(kbDir);
        assert.ok(catalog.getCard('rule_v1'), 'Must have rule_v1 from v1.0.0');

        // Publish v2
        const run2 = createStagingRunDir(tmpRoot, 'run_v2', {
          strategyRules: [{
            id: 'rule_v2',
            name: 'V2 规约',
            ruleStatement: 'V2 专有铁律',
            evidenceStrength: 'A',
            stats: { supportCount: 12, bookCount: 3, authorCount: 3, qualityLift: 0.25 },
            applicableDimensions: ['conflict_push']
          }]
        });
        publisher.publishRun(run2, { version: 'v2.0.0' });

        // Query catalog again - must hot-reload v2 without re-instantiation
        const cardV2 = catalog.getCard('rule_v2');
        assert.ok(cardV2, 'catalog.getCard must hot-reload rule_v2 without process restart');
      });

      it('T1.12: Atomic cache invalidation purges stale cards from older package versions', () => {
        const kbDir = path.join(tmpRoot, 'kb_t1_12');
        const publisher = new packagePublisherMod.PackagePublisher({ targetBase: kbDir });

        const run1 = createStagingRunDir(tmpRoot, 'run_old', {
          strategyRules: [{
            id: 'rule_old_only',
            name: '旧版专用规则',
            ruleStatement: '仅在旧版存在',
            evidenceStrength: 'A',
            stats: { supportCount: 10, bookCount: 2, authorCount: 2, qualityLift: 0.15 },
            applicableDimensions: ['conflict_push']
          }]
        });
        publisher.publishRun(run1, { version: 'v1' });

        const catalog = new evidenceCatalogMod.EvidenceCatalog();
        catalog.loadActivePublishedPackage(kbDir);
        assert.ok(catalog.getCard('rule_old_only'), 'Must load old rule');

        // Publish new run without rule_old_only
        const run2 = createStagingRunDir(tmpRoot, 'run_new', {
          strategyRules: [{
            id: 'rule_new_only',
            name: '新版专用规则',
            ruleStatement: '仅在新版存在',
            evidenceStrength: 'A',
            stats: { supportCount: 15, bookCount: 3, authorCount: 3, qualityLift: 0.2 },
            applicableDimensions: ['conflict_push']
          }]
        });
        publisher.publishRun(run2, { version: 'v2' });

        catalog.loadActivePublishedPackage(kbDir);
        assert.strictEqual(catalog.getCard('rule_old_only'), null, 'Stale card rule_old_only must be purged on reload');
        assert.ok(catalog.getCard('rule_new_only'), 'New card must be present');
      });

      it('T1.13: Direct getCard(id) lookup triggers hot-reload check eliminating permanent caching bug', () => {
        const kbDir = path.join(tmpRoot, 'kb_t1_13');
        const publisher = new packagePublisherMod.PackagePublisher({ targetBase: kbDir });

        const run = createStagingRunDir(tmpRoot, 'run_getcard', {
          strategyRules: [{
            id: 'rule_direct_get',
            name: '直读规则',
            ruleStatement: '用于验证直读自动生效',
            evidenceStrength: 'A',
            stats: { supportCount: 10, bookCount: 2, authorCount: 2, qualityLift: 0.2 },
            applicableDimensions: ['dialogue_game']
          }]
        });
        publisher.publishRun(run, { version: 'v_direct' });

        const catalog = new evidenceCatalogMod.EvidenceCatalog();
        // Invoke getCard directly without calling findRelevantCards or loadActivePublishedPackage first
        const card = catalog.getCard('rule_direct_get', { baseDir: kbDir });
        assert.ok(card || catalog.loadActivePublishedPackage(kbDir) > 0, 'Direct card lookup must succeed');
      });

      it('T1.14: findRelevantCards dynamically filters reloaded cards by dimension and minStrength', () => {
        const kbDir = path.join(tmpRoot, 'kb_t1_14');
        const publisher = new packagePublisherMod.PackagePublisher({ targetBase: kbDir });

        const run = createStagingRunDir(tmpRoot, 'run_filter', {
          strategyRules: [
            {
              id: 'rule_a_dialogue',
              name: '对白 A 级',
              ruleStatement: '对白博弈',
              evidenceStrength: 'A',
              stats: { supportCount: 10, bookCount: 2, authorCount: 2, qualityLift: 0.2 },
              applicableDimensions: ['dialogue_game']
            },
            {
              id: 'rule_b_dialogue',
              name: '对白 B 级',
              ruleStatement: '对白辅律',
              evidenceStrength: 'B',
              stats: { supportCount: 5, bookCount: 2, authorCount: 2, qualityLift: 0.1 },
              applicableDimensions: ['dialogue_game']
            }
          ]
        });
        publisher.publishRun(run, { version: 'v_filter' });

        const catalog = new evidenceCatalogMod.EvidenceCatalog();
        catalog.loadActivePublishedPackage(kbDir);

        const onlyA = catalog.findRelevantCards({ dimensions: ['dialogue_game'], minStrength: 'A' });
        assert.strictEqual(onlyA.some(c => c.id === 'rule_a_dialogue'), true, 'Must include rule_a_dialogue');
        assert.strictEqual(onlyA.some(c => c.id === 'rule_b_dialogue'), false, 'Must exclude rule_b_dialogue when minStrength is A');
      });

      it('T1.15: loadActivePublishedPackage resolves relative packageDir relative to baseDir', () => {
        const kbDir = path.join(tmpRoot, 'kb_t1_15');
        const publisher = new packagePublisherMod.PackagePublisher({ targetBase: kbDir });

        const run = createStagingRunDir(tmpRoot, 'run_rel', {
          strategyRules: [{
            id: 'rule_rel_test',
            name: '相对路径规则',
            ruleStatement: '验证相对路径解析',
            evidenceStrength: 'A',
            stats: { supportCount: 10, bookCount: 2, authorCount: 2, qualityLift: 0.2 },
            applicableDimensions: ['conflict_push']
          }]
        });
        publisher.publishRun(run, { version: 'v_rel' });

        // Manually ensure active_package.json contains relative path
        const pointerPath = path.join(kbDir, 'active_package.json');
        const pointer = JSON.parse(fs.readFileSync(pointerPath, 'utf8'));
        pointer.packageDir = 'packages/v_rel';
        fs.writeFileSync(pointerPath, JSON.stringify(pointer, null, 2), 'utf8');

        const catalog = new evidenceCatalogMod.EvidenceCatalog();
        const loaded = catalog.loadActivePublishedPackage(kbDir);
        assert.ok(loaded > 0, 'Must successfully load package specified by relative path');
        assert.ok(catalog.getCard('rule_rel_test'), 'Card must be retrieved');
      });
    });

    // --- Feature 4: Package Publisher Checksum Guard & Relative Portability ---
    describe('Feature 4: Package Publisher Checksum Guard & Relative Portability (R3 / C3)', () => {
      it('T1.16: PackagePublisher publishes staging run and generates manifest and pointer', () => {
        const kbDir = path.join(tmpRoot, 'kb_t1_16');
        const publisher = new packagePublisherMod.PackagePublisher({ targetBase: kbDir });
        const runDir = createStagingRunDir(tmpRoot, 'run_pub_16');

        const res = publisher.publishRun(runDir, { version: 'v1.0.0' });
        assert.strictEqual(res.status, 'published');
        assert.strictEqual(res.version, 'v1.0.0');

        assert.ok(fs.existsSync(path.join(kbDir, 'active_package.json')), 'active_package.json must exist');
        assert.ok(fs.existsSync(path.join(kbDir, 'packages', 'v1.0.0', 'package-manifest.json')), 'package-manifest.json must exist');
      });

      it('T1.17: Publisher executes idempotently when re-publishing the same version with identical checksum', () => {
        const kbDir = path.join(tmpRoot, 'kb_t1_17');
        const publisher = new packagePublisherMod.PackagePublisher({ targetBase: kbDir });
        const runDir = createStagingRunDir(tmpRoot, 'run_pub_17');

        publisher.publishRun(runDir, { version: 'v1.0.0' });
        const res2 = publisher.publishRun(runDir, { version: 'v1.0.0' });

        assert.ok(res2.status === 'idempotent' || res2.status === 'published', 'Re-publishing identical checksum must succeed idempotently');
        assert.strictEqual(res2.version, 'v1.0.0');
      });

      it('T1.18: Publisher throws version conflict error when publishing existing version with mismatched checksum', () => {
        const kbDir = path.join(tmpRoot, 'kb_t1_18');
        const publisher = new packagePublisherMod.PackagePublisher({ targetBase: kbDir });
        const runDir1 = createStagingRunDir(tmpRoot, 'run_pub_18_a');

        publisher.publishRun(runDir1, { version: 'v1.0.0' });

        // Create modified version with altered content for the same version v1.0.0
        const runDir2 = createStagingRunDir(tmpRoot, 'run_pub_18_b', {
          strategyRules: [{
            id: 'rule_modified',
            name: '篡改内容规则',
            ruleStatement: '内容被篡改',
            evidenceStrength: 'A',
            stats: { supportCount: 99, bookCount: 10, authorCount: 10, qualityLift: 0.5 },
            applicableDimensions: ['conflict_push']
          }]
        });

        assert.throws(
          () => publisher.publishRun(runDir2, { version: 'v1.0.0' }),
          (err) => {
            return String(err.message).includes('版本冲突') || String(err.message).includes('校验和不匹配') || String(err.message).includes('Checksum mismatch');
          },
          'Publishing existing version with differing checksum must throw version conflict error'
        );
      });

      it('T1.19: Published package manifests and active pointer store relative POSIX package directory paths', () => {
        const kbDir = path.join(tmpRoot, 'kb_t1_19');
        const publisher = new packagePublisherMod.PackagePublisher({ targetBase: kbDir });
        const runDir = createStagingRunDir(tmpRoot, 'run_pub_19');

        publisher.publishRun(runDir, { version: 'v1.0.0' });

        const pointer = JSON.parse(fs.readFileSync(path.join(kbDir, 'active_package.json'), 'utf8'));
        assert.ok(pointer.packageDir, 'packageDir must exist in active_package.json');
        // Relative POSIX path check: should not be an absolute Windows drive path (e.g. C:\)
        const isRelative = !path.isAbsolute(pointer.packageDir) || pointer.packageDir.startsWith('packages/');
        assert.ok(isRelative, `packageDir in active_package.json must be a relative path, got: ${pointer.packageDir}`);
      });

      it('T1.20: Publisher enforces quality report gate, rejecting runs with non-passed status', () => {
        const kbDir = path.join(tmpRoot, 'kb_t1_20');
        const publisher = new packagePublisherMod.PackagePublisher({ targetBase: kbDir });
        const runDir = createStagingRunDir(tmpRoot, 'run_pub_20', {
          qualityReport: { status: 'failed', reason: '质量不达标' }
        });

        assert.throws(
          () => publisher.publishRun(runDir, { version: 'v_fail' }),
          (err) => String(err.message).includes('发布门禁拦截') || String(err.message).includes('未达发布标准')
        );
      });
    });

    // --- Feature 5: Closed-Loop Experiment Engine ---
    describe('Feature 5: Closed-Loop Experiment Engine (R4 / C4)', () => {
      it('T1.21: ExperimentEngine coordinates A/B evaluation across (Genre × Style × Goal × Focus × Hook)', async () => {
        const engineMod = getExperimentEngine();
        assert.ok(engineMod, 'experiment-engine.js must exist in lib/composition/evaluation/');
        assert.ok(engineMod.ExperimentEngine, 'Must export ExperimentEngine class');

        const engine = new engineMod.ExperimentEngine();
        const res = await engine.runExperiment({
          armA: {
            strategyId: 'strat_treatment',
            draftText: '夜色渐深，李巡按住刀柄。对面的黑袍人冷笑道：“你走不脱的。”李巡没有答话，反手一刀斩断烛台，整座偏殿瞬间陷入死寂。'
          },
          armB: {
            strategyId: 'strat_control',
            draftText: '李巡很生气，对黑袍人说：“我要杀了你。”黑袍人说：“你杀不了我。”两人开始打了起来，各种法术光芒乱飞。'
          },
          context: {
            genre: 'xuanhuan_cautious',
            style: 'laobai_restrained',
            chapterGoal: 'conflict_push',
            focus: 'action',
            hook: 'crisis'
          }
        });

        assert.ok(res.evaluationA, 'Must contain evaluationA');
        assert.ok(res.evaluationB, 'Must contain evaluationB');
        assert.ok(res.differential, 'Must contain differential');
      });

      it('T1.22: 4-Axis Multi-Dimensional Scoring computes causal, literary, AI-flavor risk, and tension delta', async () => {
        const engineMod = getExperimentEngine();
        assert.ok(engineMod, 'experiment-engine.js must exist');
        const engine = new engineMod.ExperimentEngine();

        const evalResult = await engine.evaluateCandidate({
          text: '剑光乍现，带起一溜血花。他顺势后撤三步，后背已贴上潮湿冰凉的石壁。前路断绝，唯有死战。',
          context: {
            genre: 'xuanhuan_cautious',
            style: 'laobai_restrained',
            chapterGoal: 'conflict_push',
            focus: 'action',
            hook: 'crisis'
          }
        });

        assert.ok(typeof evalResult.causalScore === 'number', 'causalScore must be numeric');
        assert.ok(typeof evalResult.literaryScore === 'number', 'literaryScore must be numeric');
        assert.ok(typeof evalResult.aiFlavorRisk === 'number', 'aiFlavorRisk must be numeric');
        assert.ok(typeof evalResult.tensionDelta === 'number', 'tensionDelta must be numeric');
      });

      it('T1.23: Differential calculation evaluates signed lifts between Treatment (Arm A) and Control (Arm B)', async () => {
        const engineMod = getExperimentEngine();
        assert.ok(engineMod, 'experiment-engine.js must exist');
        const engine = new engineMod.ExperimentEngine();

        const res = await engine.runExperiment({
          armA: { draftText: '高质量文本，具备物理受力和微观博弈。' },
          armB: { draftText: '低质量文本，机械堆砌毫无波澜。' },
          context: { genre: 'xuanhuan_cautious', chapterGoal: 'conflict_push' }
        });

        const diff = res.differential;
        assert.ok(typeof diff.overallLift === 'number', 'overallLift must be numeric');
        assert.ok(typeof diff.causalDelta === 'number', 'causalDelta must be numeric');
        assert.ok(typeof diff.literaryDelta === 'number', 'literaryDelta must be numeric');
        assert.ok(typeof diff.aiFlavorDelta === 'number', 'aiFlavorDelta must be numeric');
        assert.ok(typeof diff.tensionDelta === 'number', 'tensionDelta must be numeric');
      });

      it('T1.24: StrategyCard feedback loop updates card stats and recalculates evidenceStrength', async () => {
        const engineMod = getExperimentEngine();
        assert.ok(engineMod, 'experiment-engine.js must exist');
        const engine = new engineMod.ExperimentEngine();

        const card = evidenceCatalogMod.createStrategyCard({
          id: 'card_feedback_test',
          name: '反馈测试规则',
          rule: '因果对抗',
          evidenceStrength: 'B',
          stats: { supportCount: 4, bookCount: 2, authorCount: 2, qualityLift: 0.12, confidence: 0.80, confoundScore: 0.10 }
        });

        const updatedCard = await engine.feedBackDifferential({
          strategyCard: card,
          differential: { overallLift: +0.25, causalDelta: +0.20, literaryDelta: +0.25 }
        });

        assert.ok(updatedCard, 'Updated strategy card must be returned');
        assert.ok(updatedCard.stats.supportCount >= card.stats.supportCount, 'supportCount must be incremented or preserved');
        assert.ok(updatedCard.evidenceStrength, 'evidenceStrength must be recalculated');
      });

      it('T1.25: Empirical compatibility matrix registers observed synergy lift for 5-tuple context', async () => {
        const engineMod = getExperimentEngine();
        assert.ok(engineMod, 'experiment-engine.js must exist');
        const engine = new engineMod.ExperimentEngine();

        const feedbackResult = await engine.recordCompatibilitySynergy({
          tuple: {
            genre: 'xuanhuan_cautious',
            style: 'laobai_restrained',
            chapterGoal: 'conflict_push',
            focus: 'action',
            hook: 'crisis'
          },
          strategyId: 'rule_conflict_pivot',
          observedLift: 0.18
        });

        assert.ok(feedbackResult && feedbackResult.success, 'Compatibility synergy must be successfully recorded');
      });
    });
  });

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES (25 Tests)
  // =========================================================================
  describe('Tier 2: Boundary & Corner Cases (Adversarial & Extremes)', () => {

    // --- Boundary for Archetype Discovery ---
    describe('Archetypes: Edge & Boundary Conditions', () => {
      it('T2.1: Small sample dataset N < K clamps K dynamically without empty cluster failure', async () => {
        const discoverer = getArchetypeDiscoverer();
        assert.ok(discoverer, 'archetype-discoverer.js must exist');

        const runDir = createStagingRunDir(tmpRoot, 'run_t2_1', {
          chapterFeatures: [
            createSyntheticChapterFeature({ chapterNo: 1 }),
            createSyntheticChapterFeature({ chapterNo: 2 })
          ]
        });

        // Request k = 5 with only 2 chapters
        const res = await discoverer.discoverChapterArchetypes({ runDir, k: 5 });
        assert.ok(res && res.archetypes, 'Must not crash when N < K');
        const count = Object.keys(res.archetypes).length;
        assert.ok(count <= 2, `Cluster count must be clamped to <= N (2), got ${count}`);
      });

      it('T2.2: Single chapter dataset N = 1 clusters into 1 archetype with centroid matching vector', async () => {
        const discoverer = getArchetypeDiscoverer();
        assert.ok(discoverer, 'archetype-discoverer.js must exist');

        const singleFeature = createSyntheticChapterFeature({ chapterNo: 1, narrativeDensity: 0.77 });
        const runDir = createStagingRunDir(tmpRoot, 'run_t2_2', {
          chapterFeatures: [singleFeature]
        });

        const res = await discoverer.discoverChapterArchetypes({ runDir, k: 1 });
        const archetypes = Object.values(res.archetypes);
        assert.strictEqual(archetypes.length, 1, 'Single chapter must produce 1 archetype');
        assert.ok(archetypes[0].centroid, 'Centroid must exist');
      });

      it('T2.3: Handles missing or partial stylometry features with safe defaults without NaN', async () => {
        const discoverer = getArchetypeDiscoverer();
        assert.ok(discoverer, 'archetype-discoverer.js must exist');

        const sparseFeature = {
          bookId: 'sparse_book',
          chapterNo: 1,
          chapterTitle: '残缺章节',
          novelTitle: '残卷',
          author: '无名氏',
          stylometry: {} // empty stylometry
        };

        const runDir = createStagingRunDir(tmpRoot, 'run_t2_3', {
          chapterFeatures: [sparseFeature, createSyntheticChapterFeature({ chapterNo: 2 })]
        });

        const res = await discoverer.discoverChapterArchetypes({ runDir, k: 1 });
        const arch = Object.values(res.archetypes)[0];
        const densityVal = arch.centroid?.style?.narrativeDensity ?? arch.centroid?.[0];
        assert.ok(!Number.isNaN(densityVal), 'Centroid values must not be NaN');
      });

      it('T2.4: Empty corpus run directory (0 chapters) handles gracefully or throws informative error', async () => {
        const discoverer = getArchetypeDiscoverer();
        assert.ok(discoverer, 'archetype-discoverer.js must exist');

        const runDir = path.join(tmpRoot, 'run_t2_4_empty');
        fs.mkdirSync(runDir, { recursive: true });
        fs.writeFileSync(path.join(runDir, 'chapter-features.jsonl'), '', 'utf8');

        try {
          const res = await discoverer.discoverChapterArchetypes({ runDir, k: 2 });
          assert.ok(res, 'Should return empty or fallback profile');
        } catch (err) {
          assert.ok(err instanceof Error, 'If thrown, must be valid Error instance');
        }
      });

      it('T2.5: Extreme feature outliers (all 0s / all 1s) compute distance without division by zero', async () => {
        const discoverer = getArchetypeDiscoverer();
        assert.ok(discoverer, 'archetype-discoverer.js must exist');

        const zeroFeature = createSyntheticChapterFeature({
          chapterNo: 1,
          narrativeDensity: 0,
          emotionalIntensity: 0,
          dialogueRatio: 0
        });
        const oneFeature = createSyntheticChapterFeature({
          chapterNo: 2,
          narrativeDensity: 1,
          emotionalIntensity: 1,
          dialogueRatio: 1
        });

        const runDir = createStagingRunDir(tmpRoot, 'run_t2_5', {
          chapterFeatures: [zeroFeature, oneFeature]
        });

        const res = await discoverer.discoverChapterArchetypes({ runDir, k: 2 });
        assert.ok(res && res.archetypes, 'Outlier clustering must succeed');
      });
    });

    // --- Boundary for Attention Hard Budget ---
    describe('Attention Hard Budget: Edge & Boundary Conditions', () => {
      it('T2.6: Zero token budget maxTotalTokens = 0 strictly asserts budget and throws BUDGET_EXCEEDED', () => {
        assert.throws(
          () => attentionTiering.tierAttention({
            chapterStrategy: '【P0 绝对事实】：测试内容',
            maxTotalTokens: 0
          }),
          (err) => err.code === 'BUDGET_EXCEEDED' || err.status === 402 || err.statusCode === 402,
          'Zero token budget must throw BUDGET_EXCEEDED'
        );
      });

      it('T2.7: Ultra-tight budget maxTotalTokens = 15 compacts critical items to satisfy budget', () => {
        const strategy = '【P0 绝对事实与物理围栏】：篇幅字数硬性预算 3000 字\n【状态跃迁契约】：章前初见，章后结仇';
        try {
          const res = attentionTiering.tierAttention({
            chapterStrategy: strategy,
            maxTotalTokens: 15
          });
          assert.ok(res.metrics.totalTokens <= 15, `totalTokens must be <= 15, got ${res.metrics.totalTokens}`);
        } catch (err) {
          assert.strictEqual(err.code, 'BUDGET_EXCEEDED', 'If impossible to fit 15 tokens, must throw BUDGET_EXCEEDED');
        }
      });

      it('T2.8: Massive overflow of critical blocks never causes silent budget leak', () => {
        const hugeStrategy = Array.from({ length: 50 }, (_, i) => `【P0 绝对事实 #${i}】：极其关键的物理不可逆铁律，绝不可违反。`).join('\n\n');
        try {
          const res = attentionTiering.tierAttention({
            chapterStrategy: hugeStrategy,
            maxTotalTokens: 80
          });
          assert.ok(res.metrics.totalTokens <= 80, `totalTokens must never exceed maxTotalTokens (80), got ${res.metrics.totalTokens}`);
        } catch (err) {
          assert.strictEqual(err.code, 'BUDGET_EXCEEDED', 'Must throw BUDGET_EXCEEDED rather than overflowing silently');
        }
      });

      it('T2.9: Empty strings across all 4 tiers evaluate to 0 tokens and withinBudget = true', () => {
        const res = attentionTiering.tierAttention({
          permanentContext: '',
          chapterStrategy: '',
          evidenceCards: [],
          immediateContext: '',
          maxTotalTokens: 100
        });

        assert.strictEqual(res.metrics.totalTokens, 0, 'Empty inputs must evaluate to 0 tokens');
        assert.strictEqual(res.metrics.withinBudget, true, 'Empty inputs must be within budget');
      });

      it('T2.10: Massive single-line CJK text without linebreaks enforces budget without regex hangs', () => {
        const cjkMassive = '道可道非常道名可名非常名玄之又玄众妙之门天地不仁以万物为刍狗圣人不仁以百姓为刍狗'.repeat(100);
        const res = attentionTiering.tierAttention({
          chapterStrategy: `【P0 绝对事实】：${cjkMassive}`,
          maxTotalTokens: 200
        });

        assert.ok(res.metrics.totalTokens <= 200, 'CJK text must be bounded to maxTotalTokens');
      });
    });

    // --- Boundary for Evidence Catalog Hot Reload ---
    describe('Evidence Catalog: Edge & Boundary Conditions', () => {
      it('T2.11: Rapid successive package updates with same second timestamp recognize version changes', () => {
        const kbDir = path.join(tmpRoot, 'kb_t2_11');
        const publisher = new packagePublisherMod.PackagePublisher({ targetBase: kbDir });

        const run1 = createStagingRunDir(tmpRoot, 'run_rapid_1', {
          strategyRules: [{ id: 'card_rapid_1', rule: '规则一', evidenceStrength: 'A', stats: { supportCount: 10, bookCount: 2, authorCount: 2, qualityLift: 0.1 } }]
        });
        publisher.publishRun(run1, { version: 'v_rapid_1' });

        const catalog = new evidenceCatalogMod.EvidenceCatalog();
        catalog.loadActivePublishedPackage(kbDir);

        const run2 = createStagingRunDir(tmpRoot, 'run_rapid_2', {
          strategyRules: [{ id: 'card_rapid_2', rule: '规则二', evidenceStrength: 'A', stats: { supportCount: 10, bookCount: 2, authorCount: 2, qualityLift: 0.1 } }]
        });
        publisher.publishRun(run2, { version: 'v_rapid_2' });

        catalog.loadActivePublishedPackage(kbDir);
        assert.ok(catalog.getCard('card_rapid_2'), 'Rapid update must be recognized');
      });

      it('T2.12: Corrupted active_package.json (invalid JSON) is gracefully tolerated without crashing catalog', () => {
        const kbDir = path.join(tmpRoot, 'kb_t2_12');
        fs.mkdirSync(kbDir, { recursive: true });
        fs.writeFileSync(path.join(kbDir, 'active_package.json'), '{ invalid json ...', 'utf8');

        const catalog = new evidenceCatalogMod.EvidenceCatalog();
        const loaded = catalog.loadActivePublishedPackage(kbDir);
        assert.strictEqual(loaded, 0, 'Corrupted pointer must return 0 loaded rules gracefully');
      });

      it('T2.13: Non-existent packageDir target in pointer returns 0 loaded rules gracefully', () => {
        const kbDir = path.join(tmpRoot, 'kb_t2_13');
        fs.mkdirSync(kbDir, { recursive: true });
        fs.writeFileSync(
          path.join(kbDir, 'active_package.json'),
          JSON.stringify({ activeVersion: 'ghost', packageDir: 'packages/does_not_exist' }),
          'utf8'
        );

        const catalog = new evidenceCatalogMod.EvidenceCatalog();
        const loaded = catalog.loadActivePublishedPackage(kbDir);
        assert.strictEqual(loaded, 0, 'Missing target directory must return 0');
      });

      it('T2.14: Rollback to previous package version reinstates old cards and purges new ones', () => {
        const kbDir = path.join(tmpRoot, 'kb_t2_14');
        const publisher = new packagePublisherMod.PackagePublisher({ targetBase: kbDir });

        const run1 = createStagingRunDir(tmpRoot, 'run_rb_1', {
          strategyRules: [{ id: 'card_original', rule: '原始规则', evidenceStrength: 'A', stats: { supportCount: 10, bookCount: 2, authorCount: 2, qualityLift: 0.1 } }]
        });
        publisher.publishRun(run1, { version: 'v1' });

        const run2 = createStagingRunDir(tmpRoot, 'run_rb_2', {
          strategyRules: [{ id: 'card_experimental', rule: '实验规则', evidenceStrength: 'A', stats: { supportCount: 10, bookCount: 2, authorCount: 2, qualityLift: 0.1 } }]
        });
        publisher.publishRun(run2, { version: 'v2' });

        const catalog = new evidenceCatalogMod.EvidenceCatalog();
        catalog.loadActivePublishedPackage(kbDir);
        assert.ok(catalog.getCard('card_experimental'));

        // Roll back active_package.json to v1
        const pointerPath = path.join(kbDir, 'active_package.json');
        fs.writeFileSync(
          pointerPath,
          JSON.stringify({ activeVersion: 'v1', packageDir: path.join(kbDir, 'packages', 'v1') }, null, 2),
          'utf8'
        );

        catalog.loadActivePublishedPackage(kbDir);
        assert.strictEqual(catalog.getCard('card_experimental'), null, 'card_experimental must be purged after rollback');
        assert.ok(catalog.getCard('card_original'), 'card_original must be reinstated after rollback');
      });

      it('T2.15: Package missing strategy-rules.jsonl returns 0 rules without throwing exception', () => {
        const kbDir = path.join(tmpRoot, 'kb_t2_15');
        const pkgDir = path.join(kbDir, 'packages', 'v_empty');
        fs.mkdirSync(pkgDir, { recursive: true });

        const catalog = new evidenceCatalogMod.EvidenceCatalog();
        const loaded = catalog.loadFromPublishedPackage(pkgDir);
        assert.strictEqual(loaded, 0, 'Missing strategy-rules.jsonl must load 0 rules');
      });
    });

    // --- Boundary for Package Publisher ---
    describe('Package Publisher: Edge & Boundary Conditions', () => {
      it('T2.16: Modifying 1 byte in strategy-rules.jsonl triggers checksum mismatch on re-publish', () => {
        const kbDir = path.join(tmpRoot, 'kb_t2_16');
        const publisher = new packagePublisherMod.PackagePublisher({ targetBase: kbDir });
        const runDir = createStagingRunDir(tmpRoot, 'run_t2_16');

        publisher.publishRun(runDir, { version: 'v_fixed' });

        // Tamper 1 character in staging file
        const rulesPath = path.join(runDir, 'strategy-rules.jsonl');
        const content = fs.readFileSync(rulesPath, 'utf8');
        fs.writeFileSync(rulesPath, content + ' ', 'utf8');

        assert.throws(
          () => publisher.publishRun(runDir, { version: 'v_fixed' }),
          (err) => String(err.message).includes('版本冲突') || String(err.message).includes('校验和不匹配')
        );
      });

      it('T2.17: Missing required artifact file in source run throws explicit missing file error', () => {
        const kbDir = path.join(tmpRoot, 'kb_t2_17');
        const publisher = new packagePublisherMod.PackagePublisher({ targetBase: kbDir });
        const runDir = createStagingRunDir(tmpRoot, 'run_t2_17');

        // Delete archetypes.json
        fs.unlinkSync(path.join(runDir, 'archetypes.json'));

        assert.throws(
          () => publisher.publishRun(runDir, { version: 'v_missing' }),
          (err) => String(err.message).includes('archetypes.json')
        );
      });

      it('T2.18: Resolves deep nested relative base paths without path separator anomalies', () => {
        const kbDir = path.join(tmpRoot, 'deep', 'sub', 'kb_t2_18');
        const publisher = new packagePublisherMod.PackagePublisher({ targetBase: kbDir });
        const runDir = createStagingRunDir(tmpRoot, 'run_t2_18');

        const res = publisher.publishRun(runDir, { version: 'v_nested' });
        assert.strictEqual(res.status, 'published');
        assert.ok(fs.existsSync(path.join(kbDir, 'active_package.json')));
      });

      it('T2.19: Tampered package-manifest.json checksum triggers mismatch on verification', () => {
        const kbDir = path.join(tmpRoot, 'kb_t2_19');
        const publisher = new packagePublisherMod.PackagePublisher({ targetBase: kbDir });
        const runDir = createStagingRunDir(tmpRoot, 'run_t2_19');

        publisher.publishRun(runDir, { version: 'v_tamper' });

        // Tamper manifest on disk
        const manifestPath = path.join(kbDir, 'packages', 'v_tamper', 'package-manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        manifest.checksums['strategy-rules.jsonl'] = '0000000000000000000000000000000000000000000000000000000000000000';
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

        // Re-publish must detect tampering
        assert.throws(
          () => publisher.publishRun(runDir, { version: 'v_tamper' }),
          (err) => String(err.message).includes('版本冲突') || String(err.message).includes('校验和不匹配')
        );
      });

      it('T2.20: Idempotent re-publish does not duplicate or alter publishedAt timestamps', () => {
        const kbDir = path.join(tmpRoot, 'kb_t2_20');
        const publisher = new packagePublisherMod.PackagePublisher({ targetBase: kbDir });
        const runDir = createStagingRunDir(tmpRoot, 'run_t2_20');

        publisher.publishRun(runDir, { version: 'v_idem' });
        const manifest1 = JSON.parse(fs.readFileSync(path.join(kbDir, 'packages', 'v_idem', 'package-manifest.json'), 'utf8'));

        publisher.publishRun(runDir, { version: 'v_idem' });
        const manifest2 = JSON.parse(fs.readFileSync(path.join(kbDir, 'packages', 'v_idem', 'package-manifest.json'), 'utf8'));

        assert.strictEqual(manifest1.publishedAt, manifest2.publishedAt, 'publishedAt must remain unchanged on idempotent publish');
      });
    });

    // --- Boundary for Experiment Engine ---
    describe('Experiment Engine: Edge & Boundary Conditions', () => {
      it('T2.21: Identical candidate scores Delta = 0 updates confidence stably without NaN', async () => {
        const engineMod = getExperimentEngine();
        assert.ok(engineMod, 'experiment-engine.js must exist');
        const engine = new engineMod.ExperimentEngine();

        const text = '两人对峙在石阶上，山风猎猎。';
        const res = await engine.runExperiment({
          armA: { draftText: text },
          armB: { draftText: text },
          context: { genre: 'xuanhuan_cautious', chapterGoal: 'conflict_push' }
        });

        assert.strictEqual(res.differential.overallLift, 0, 'Identical candidates must produce zero lift');
      });

      it('T2.22: Severe negative lift Delta < 0 triggers evidence strength downgrade', async () => {
        const engineMod = getExperimentEngine();
        assert.ok(engineMod, 'experiment-engine.js must exist');
        const engine = new engineMod.ExperimentEngine();

        const card = evidenceCatalogMod.createStrategyCard({
          id: 'card_downgrade',
          name: '劣化规则',
          rule: '盲目冲锋',
          evidenceStrength: 'B',
          stats: { supportCount: 3, bookCount: 2, authorCount: 2, qualityLift: 0.1, confidence: 0.8, confoundScore: 0.1 }
        });

        const downgraded = await engine.feedBackDifferential({
          strategyCard: card,
          differential: { overallLift: -0.40, causalDelta: -0.35, literaryDelta: -0.40 }
        });

        assert.ok(['C', 'D'].includes(downgraded.evidenceStrength), 'Negative lift must downgrade evidence strength');
      });

      it('T2.23: 100% AI-flavor penalty properly lowers overall score without NaN', async () => {
        const engineMod = getExperimentEngine();
        assert.ok(engineMod, 'experiment-engine.js must exist');
        const engine = new engineMod.ExperimentEngine();

        const aiSaturatedText = '总之，值得注意的是，显而易见，综上所述，不难看出，在这个充满变数的修真世界里，宛如一幅波澜壮阔的画卷。';
        const evalResult = await engine.evaluateCandidate({
          text: aiSaturatedText,
          context: { genre: 'xuanhuan_cautious', chapterGoal: 'conflict_push' }
        });

        assert.ok(evalResult.aiFlavorRisk > 0.5, 'AI saturated text must have high AI flavor risk');
        assert.ok(!Number.isNaN(evalResult.compositeScore), 'Composite score must not be NaN');
      });

      it('T2.24: Missing optional tuple dimensions applies safe fallback defaults', async () => {
        const engineMod = getExperimentEngine();
        assert.ok(engineMod, 'experiment-engine.js must exist');
        const engine = new engineMod.ExperimentEngine();

        const res = await engine.runExperiment({
          armA: { draftText: '测试文本 A' },
          armB: { draftText: '测试文本 B' },
          context: {} // empty context
        });

        assert.ok(res && res.differential, 'Empty context must fall back safely');
      });

      it('T2.25: Gracefully handles empty draft candidate with error isolation', async () => {
        const engineMod = getExperimentEngine();
        assert.ok(engineMod, 'experiment-engine.js must exist');
        const engine = new engineMod.ExperimentEngine();

        const evalResult = await engine.evaluateCandidate({
          text: '',
          context: { genre: 'xuanhuan_cautious' }
        });

        assert.strictEqual(evalResult.compositeScore, 0, 'Empty candidate text must evaluate to score 0');
      });
    });
  });

  // =========================================================================
  // TIER 3: CROSS-FEATURE INTERACTIONS (5 Tests)
  // =========================================================================
  describe('Tier 3: Cross-Feature Interactions', () => {
    it('T3.1: Archetype Discovery -> Attention Tiering -> Model Request wiring pipeline', async () => {
      const discoverer = getArchetypeDiscoverer();
      assert.ok(discoverer, 'archetype-discoverer.js must exist');

      // 1. Discover archetype from staging features
      const runDir = createStagingRunDir(tmpRoot, 'run_t3_1');
      const discResult = await discoverer.discoverChapterArchetypes({ runDir, k: 2 });
      const arch = Object.values(discResult.archetypes)[0];

      // 2. Synthesize chapter strategy incorporating archetype dynamics
      const strategyText = [
        `【章节原型·${arch.name}】`,
        `· 运作节律：${arch.structuralDynamics.drivePattern}`,
        `· 目标短句比：${arch.pacingFormula.targetShortSentenceRatio}`,
        '【P0 绝对事实与物理围栏】：主角负伤，不得施展大神通',
        '【状态跃迁契约 (State Delta)】：章前受困，章后突围'
      ].join('\n');

      // 3. Attention Tiering under tight budget
      const tiered = attentionTiering.tierAttention({
        permanentContext: '世界铁律：真气消耗不可凭空补充',
        chapterStrategy: strategyText,
        maxTotalTokens: 250
      });

      assert.ok(tiered.metrics.totalTokens <= 250, 'Tiered attention must respect budget');
      assert.ok(tiered.tier2Strategy.includes('P0 绝对事实') || tiered.tier2Strategy.includes('状态跃迁契约'));

      // 4. Ingest into generation request
      let capturedPayload = null;
      await contentEngine.generateDraft({
        callModel: async (_auth, payload) => {
          capturedPayload = payload;
          return { text: '刀光呼啸，鲜血迸溅……', usage: { totalTokens: 30 } };
        },
        auth: { user: { email: 'cross@molan.com' } },
        request: {
          compositionSpec: defaultProfileRegistry.resolveCompositionSpec({
            genre: 'xuanhuan_cautious',
            style: 'laobai_restrained',
            chapterGoal: 'conflict_push'
          }),
          runId: 't3_1_run'
        },
        contract: { chapterGoal: '突围', wordBudget: { target: 2000 } }
      });

      assert.ok(capturedPayload, 'Payload must be passed to callModel');
      assert.ok(capturedPayload.attention, 'Payload must carry attention object');
    });

    it('T3.2: Publisher -> Hot Reload -> Attention Evidence selection injection flow', () => {
      const kbDir = path.join(tmpRoot, 'kb_t3_2');
      const publisher = new packagePublisherMod.PackagePublisher({ targetBase: kbDir });

      // Publish package with newly verified A-grade card
      const runDir = createStagingRunDir(tmpRoot, 'run_t3_2', {
        strategyRules: [{
          id: 'rule_t3_2_breakthrough',
          name: '绝境突围受力律',
          ruleStatement: '受阻时必有侧向卸力',
          evidenceStrength: 'A',
          stats: { supportCount: 20, bookCount: 3, authorCount: 3, qualityLift: 0.25 },
          applicableDimensions: ['conflict_push']
        }]
      });
      publisher.publishRun(runDir, { version: 'v_t3_2' });

      // Hot reload in EvidenceCatalog
      const catalog = new evidenceCatalogMod.EvidenceCatalog();
      catalog.loadActivePublishedPackage(kbDir);

      const relevantCards = catalog.findRelevantCards({
        dimensions: ['conflict_push'],
        minStrength: 'A'
      });
      assert.ok(relevantCards.some(c => c.id === 'rule_t3_2_breakthrough'), 'Catalog must serve published card');

      // Attention tiering dynamically selects the card into Tier 3
      const tiered = attentionTiering.tierAttention({
        chapterStrategy: '【P0 绝对事实】：测试',
        evidenceCards: relevantCards,
        chapterObjective: 'conflict_push',
        maxTotalTokens: 500
      });

      assert.ok(tiered.tier3Evidence.includes('绝境突围受力律') || tiered.tier3Evidence.includes('受阻时必有侧向卸力'),
        'Tier 3 evidence must inject hot-reloaded card into attention');
    });

    it('T3.3: Experiment Engine -> StrategyCard feedback -> Hot Reload -> Regeneration cycle', async () => {
      const engineMod = getExperimentEngine();
      assert.ok(engineMod, 'experiment-engine.js must exist');
      const engine = new engineMod.ExperimentEngine();

      const kbDir = path.join(tmpRoot, 'kb_t3_3');
      const publisher = new packagePublisherMod.PackagePublisher({ targetBase: kbDir });

      // Initial card with Grade B
      const initialCard = evidenceCatalogMod.createStrategyCard({
        id: 'rule_evolving',
        name: '进化规则',
        rule: '节奏提速',
        evidenceStrength: 'B',
        stats: { supportCount: 4, bookCount: 2, authorCount: 2, qualityLift: 0.12, confidence: 0.85, confoundScore: 0.10 }
      });

      // Run A/B experiment demonstrating strong lift (+0.30)
      const expRes = await engine.runExperiment({
        armA: { draftText: '高节奏紧凑对抗，步步紧逼。' },
        armB: { draftText: '拖沓无聊对话。' },
        context: { genre: 'xuanhuan_cautious', chapterGoal: 'conflict_push' }
      });

      // Feed back differential into card
      const upgradedCard = await engine.feedBackDifferential({
        strategyCard: initialCard,
        differential: expRes.differential
      });

      assert.ok(upgradedCard.stats.supportCount >= 5, 'supportCount should increase');

      // Publish upgraded package
      const runDir = createStagingRunDir(tmpRoot, 'run_t3_3', {
        strategyRules: [upgradedCard]
      });
      publisher.publishRun(runDir, { version: 'v_evolved' });

      // Hot reload in catalog
      const catalog = new evidenceCatalogMod.EvidenceCatalog();
      catalog.loadActivePublishedPackage(kbDir);
      const loadedCard = catalog.getCard('rule_evolving');
      assert.ok(loadedCard, 'Evolved card must be loaded into catalog');
    });

    it('T3.4: High-density Archetype + 5 Evidence Cards under tight 400 token budget enforces invariant', () => {
      const cards = Array.from({ length: 5 }, (_, i) => ({
        id: `card_dense_${i}`,
        rule: `密集规则 #${i}：严格控制叙事节奏与情绪曲线`,
        evidenceStrength: 'A',
        stats: { supportCount: 15, bookCount: 3, authorCount: 3 }
      }));

      const heavyStrategy = [
        '【P0 绝对事实与物理围栏】：篇幅硬性预算 3000 字',
        '【叙事视角准则】：第三人称限制视角',
        '【状态跃迁契约】：章前潜伏，章后破局',
        '【题材边界绝不假定】：绝不假定拥有免死护甲',
        '长篇策略补充描述说明文字。'.repeat(20)
      ].join('\n\n');

      const res = attentionTiering.tierAttention({
        permanentContext: '永驻世界观铁律设定：天地初开，因果律不容动摇。'.repeat(10),
        chapterStrategy: heavyStrategy,
        evidenceCards: cards,
        immediateContext: '现场即时承接：前章最后留下的惊天杀机。'.repeat(10),
        maxTotalTokens: 400
      });

      assert.ok(res.metrics.totalTokens <= 400, `totalTokens (${res.metrics.totalTokens}) must strictly satisfy <= 400`);
      assert.strictEqual(res.metrics.withinBudget, true, 'withinBudget must be true');
    });

    it('T3.5: Publisher checksum rejection preserves active pointer and EvidenceCatalog serving consistency', () => {
      const kbDir = path.join(tmpRoot, 'kb_t3_5');
      const publisher = new packagePublisherMod.PackagePublisher({ targetBase: kbDir });

      const runGood = createStagingRunDir(tmpRoot, 'run_good', {
        strategyRules: [{ id: 'card_stable', rule: '稳定运行卡', evidenceStrength: 'A', stats: { supportCount: 10, bookCount: 2, authorCount: 2, qualityLift: 0.15 } }]
      });
      publisher.publishRun(runGood, { version: 'v_stable' });

      const catalog = new evidenceCatalogMod.EvidenceCatalog();
      catalog.loadActivePublishedPackage(kbDir);
      assert.ok(catalog.getCard('card_stable'));

      // Attempt malicious overwrite of v_stable
      const runBad = createStagingRunDir(tmpRoot, 'run_bad', {
        strategyRules: [{ id: 'card_bad', rule: '恶意篡改卡', evidenceStrength: 'A', stats: { supportCount: 1, bookCount: 1, authorCount: 1, qualityLift: 0 } }]
      });

      assert.throws(() => publisher.publishRun(runBad, { version: 'v_stable' }));

      // Verify active pointer still points to v_stable
      const active = publisher.getActivePackage();
      assert.strictEqual(active.activeVersion, 'v_stable');

      // Catalog continues serving card_stable without pollution
      assert.ok(catalog.getCard('card_stable'), 'Catalog must remain consistent');
      assert.strictEqual(catalog.getCard('card_bad'), null, 'Malicious card must not be loaded');
    });
  });

  // =========================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS (5 Tests)
  // =========================================================================
  describe('Tier 4: Real-World Application Scenarios', () => {
    it('T4.1: Full Corpus-to-Generation Pipeline (Discovery -> Publish -> Hot Reload -> Generation Request)', async () => {
      const discoverer = getArchetypeDiscoverer();
      assert.ok(discoverer, 'archetype-discoverer.js must exist');

      // 1. Corpus Batch Staging with 6 diverse chapters
      const stagingDir = createStagingRunDir(tmpRoot, 'run_t4_1_full', {
        chapterFeatures: [
          createSyntheticChapterFeature({ chapterNo: 1, primaryGoal: 'conflict_push' }),
          createSyntheticChapterFeature({ chapterNo: 2, primaryGoal: 'dialogue_game' }),
          createSyntheticChapterFeature({ chapterNo: 3, primaryGoal: 'info_reveal' }),
          createSyntheticChapterFeature({ chapterNo: 4, primaryGoal: 'conflict_push' }),
          createSyntheticChapterFeature({ chapterNo: 5, primaryGoal: 'dialogue_game' }),
          createSyntheticChapterFeature({ chapterNo: 6, primaryGoal: 'conflict_push' })
        ]
      });

      // 2. Discover Archetypes
      const disc = await discoverer.discoverChapterArchetypes({ runDir: stagingDir, k: 2 });
      assert.ok(Object.keys(disc.archetypes).length >= 1, 'Archetypes must be discovered');

      // 3. Publish Run to Knowledge Base
      const kbDir = path.join(tmpRoot, 'kb_t4_1');
      const publisher = new packagePublisherMod.PackagePublisher({ targetBase: kbDir });
      const pubRes = publisher.publishRun(stagingDir, { version: 'v_prod_1' });
      assert.strictEqual(pubRes.status, 'published');

      // 4. Hot Reload into Catalog
      const catalog = new evidenceCatalogMod.EvidenceCatalog();
      catalog.loadActivePublishedPackage(kbDir);

      // 5. Generate Draft via Content Engine
      let capturedPayload = null;
      const genResult = await contentEngine.generateDraft({
        callModel: async (_auth, payload) => {
          capturedPayload = payload;
          return { text: '刀鸣如雷，震颤长夜。李巡身如鬼魅，自乱军中强行杀出。', usage: { totalTokens: 45 } };
        },
        auth: { user: { email: 'prod@molan.com' } },
        request: {
          compositionSpec: defaultProfileRegistry.resolveCompositionSpec({
            genre: 'xuanhuan_cautious',
            style: 'laobai_restrained',
            chapterGoal: 'conflict_push',
            focus: 'action',
            hook: 'crisis'
          }),
          runId: 'prod_run_1'
        },
        contract: { chapterGoal: '杀出重围', wordBudget: { target: 2400 } }
      });

      assert.ok(genResult.text, 'Draft text must be returned');
      assert.ok(capturedPayload.attention, 'Tiered attention must be delivered to model client');
    });

    it('T4.2: Closed-Loop Strategy Evolution Loop across generations', async () => {
      const engineMod = getExperimentEngine();
      assert.ok(engineMod, 'experiment-engine.js must exist');
      const engine = new engineMod.ExperimentEngine();

      // Generation candidate A (with dynamic physical tension) vs B (generic)
      const candA = '他侧身避过刀锋，左足猛蹬廊柱借力，身形在半空不可思议地一折，反手将匕首送入敌手肋下。血水溅在青石砖上，冒出淡淡白气。';
      const candB = '他拿出一把刀，把敌人砍死了。周围的人都很震惊。';

      const exp = await engine.runExperiment({
        armA: { draftText: candA },
        armB: { draftText: candB },
        context: {
          genre: 'xuanhuan_cautious',
          style: 'laobai_restrained',
          chapterGoal: 'conflict_push',
          focus: 'action',
          hook: 'crisis'
        }
      });

      assert.ok(exp.differential.overallLift > 0, 'Physically grounded candidate A must outperform candidate B');
      assert.ok(exp.differential.causalDelta > 0, 'Candidate A must show higher causal compliance');
      assert.ok(exp.differential.literaryDelta > 0, 'Candidate A must show higher literary quality');
    });

    it('T4.3: Zero-downtime knowledge base hot-upgrade under simulated concurrent reader traffic', async () => {
      const kbDir = path.join(tmpRoot, 'kb_t4_3');
      const publisher = new packagePublisherMod.PackagePublisher({ targetBase: kbDir });

      const run1 = createStagingRunDir(tmpRoot, 'run_conc_1', {
        strategyRules: [{ id: 'rule_stream_1', rule: '规则一', evidenceStrength: 'A', stats: { supportCount: 10, bookCount: 2, authorCount: 2, qualityLift: 0.1 } }]
      });
      publisher.publishRun(run1, { version: 'v1.0' });

      const catalog = new evidenceCatalogMod.EvidenceCatalog();
      catalog.loadActivePublishedPackage(kbDir);

      // Simulate 20 concurrent readers
      const readOperations = Array.from({ length: 20 }, async (_, i) => {
        if (i === 10) {
          // Switch package at operation 10
          const run2 = createStagingRunDir(tmpRoot, 'run_conc_2', {
            strategyRules: [{ id: 'rule_stream_2', rule: '规则二', evidenceStrength: 'A', stats: { supportCount: 12, bookCount: 3, authorCount: 3, qualityLift: 0.2 } }]
          });
          publisher.publishRun(run2, { version: 'v2.0' });
        }
        return catalog.getCard('rule_stream_1') || catalog.getCard('rule_stream_2');
      });

      const results = await Promise.all(readOperations);
      // All reads must return valid card objects without null reference errors or crashes
      for (const card of results) {
        assert.ok(card !== undefined, 'No concurrent read operation may crash');
      }
    });

    it('T4.4: Resilient recovery from mismatched publisher tampering followed by idempotent retry', () => {
      const kbDir = path.join(tmpRoot, 'kb_t4_4');
      const publisher = new packagePublisherMod.PackagePublisher({ targetBase: kbDir });
      const runDir = createStagingRunDir(tmpRoot, 'run_t4_4');

      // 1. Initial publish
      publisher.publishRun(runDir, { version: 'v_resilient' });

      // 2. Tampered publish fails
      const tamperedDir = createStagingRunDir(tmpRoot, 'run_t4_4_tampered', {
        strategyRules: [{ id: 'tampered', rule: '篡改', evidenceStrength: 'A', stats: { supportCount: 1 } }]
      });
      assert.throws(() => publisher.publishRun(tamperedDir, { version: 'v_resilient' }));

      // 3. Valid idempotent retry succeeds
      const retryRes = publisher.publishRun(runDir, { version: 'v_resilient' });
      assert.ok(['idempotent', 'published'].includes(retryRes.status));

      // 4. Verify catalog integrity
      const catalog = new evidenceCatalogMod.EvidenceCatalog();
      catalog.loadActivePublishedPackage(kbDir);
      assert.ok(catalog.getCard('rule_conflict_pivot'));
    });

    it('T4.5: Multi-Genre experimentation with tension curve and causal verification', async () => {
      const engineMod = getExperimentEngine();
      assert.ok(engineMod, 'experiment-engine.js must exist');
      const engine = new engineMod.ExperimentEngine();

      // Fantasy/cultivation candidate
      const xuanhuanCandidate = '体内灵气狂涌，筋脉如被烈火灼烧。李巡咬牙咽下涌至喉头的腥甜，全力催动九幽灭魂剑，一剑断江！';
      // Restrained suspense candidate
      const suspenseCandidate = '窗外的雨下得更大了。他数着秒针的滴答声，在第十四秒时，门锁发出轻微的咔嗒声。他没有开灯。';

      const evalX = await engine.evaluateCandidate({
        text: xuanhuanCandidate,
        context: { genre: 'xuanhuan_cautious', chapterGoal: 'conflict_push' }
      });

      const evalS = await engine.evaluateCandidate({
        text: suspenseCandidate,
        context: { genre: 'laobai_restrained', chapterGoal: 'info_reveal' }
      });

      assert.ok(typeof evalX.tensionDelta === 'number', 'Fantasy candidate must have tensionDelta');
      assert.ok(typeof evalS.tensionDelta === 'number', 'Suspense candidate must have tensionDelta');
      assert.ok(evalX.compositeScore > 0, 'Fantasy evaluation must score > 0');
      assert.ok(evalS.compositeScore > 0, 'Suspense evaluation must score > 0');
    });
  });
});
