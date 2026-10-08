'use strict';

/**
 * @file phase2-engine-enhancements.test.js
 * Phase 2 引擎架构 P0/P1 改进项专项验证套件：
 * 1. P0-2: 修复预算与数值边界 || 失真 (?? nullish coalescing)
 * 2. P0-5: Hook Debt ID 确定性幂等化 (SHA-256 slice)
 * 3. P0-3: Attention 裁剪顺序重排并设立保底水位线 (immediateContextFloorTokens)
 * 4. P0-1: Attention 真实安全送入模型上下文 (带 !includes 幂等去重)
 * 5. P1-7: 实验结果持久化 (ExperimentEngine JSONL 追加写日志与启动恢复)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { compileChapterStrategy } = require('../lib/composition/compiler/strategy-compiler');
const { buildDraftRequest, compileDraftPrompt } = require('../lib/generation/content-engine');
const {
  createHookProfile,
  generateHookDebtId,
  toCausalDebtRegistration
} = require('../lib/composition/profiles/hook-profile');
const {
  tierAttention,
  computeImmediateContextFloorTokens,
  FINAL_BUDGET_ASSERT
} = require('../lib/composition/compiler/attention-tiering');
const { ExperimentEngine } = require('../lib/composition/evaluation/experiment-engine');
const { defaultProfileRegistry } = require('../lib/composition/profiles/profile-registry');

describe('Phase 2 Engine Enhancements & Robustness Verification', () => {

  // =========================================================================
  // 1. P0-2 修复预算与数值边界 || 失真
  // =========================================================================
  describe('P0-2: Numerical & Budget Boundary ?? Invariant Protection', () => {
    it('1.1: options.maxTotalTokens = 0 is strictly respected by strategy-compiler and throws BUDGET_EXCEEDED instead of resetting to 6000', () => {
      const spec = defaultProfileRegistry.resolveCompositionSpec({
        genre: 'xuanhuan_cautious',
        style: 'laobai_restrained',
        chapterGoal: 'info_reveal',
        focus: 'dialogue_game',
        hook: 'suspense_clue'
      });

      assert.throws(
        () => {
          compileChapterStrategy({
            spec,
            options: { maxTotalTokens: 0 }
          });
        },
        (err) => {
          assert.strictEqual(err.code, 'BUDGET_EXCEEDED');
          return true;
        },
        'maxTotalTokens = 0 must trigger BUDGET_EXCEEDED rather than being masked as 6000'
      );
    });

    it('1.2: buildDraftRequest strictly preserves temperature = 0, topP = 0, seed = 0 without defaulting to fallback values', () => {
      const draftReq = buildDraftRequest({
        request: {
          targetChars: 2000,
          modelId: 'test-model',
          modelParams: {
            temperature: 0,
            topP: 0,
            seed: 0,
            maxTokens: 500
          }
        },
        contract: { chapterGoal: '核心潜伏' }
      });

      assert.strictEqual(draftReq.temperature, 0, 'temperature: 0 must be preserved, not defaulted to 0.75');
      assert.strictEqual(draftReq.topP, 0, 'topP: 0 must be preserved, not defaulted to null');
      assert.strictEqual(draftReq.seed, 0, 'seed: 0 must be preserved, not defaulted to null');
      assert.strictEqual(draftReq.maxTokens, 500, 'maxTokens: 500 must be preserved');
    });

    it('1.3: options-level temperature = 0, topP = 0, seed = 0 are preserved when req.modelParams is omitted', () => {
      const draftReq = buildDraftRequest({
        request: { targetChars: 2000, modelId: 'test-model' },
        contract: { chapterGoal: '核心潜伏' },
        temperature: 0,
        topP: 0,
        seed: 0
      });

      assert.strictEqual(draftReq.temperature, 0, 'options.temperature: 0 must be preserved');
      assert.strictEqual(draftReq.topP, 0, 'options.topP: 0 must be preserved');
      assert.strictEqual(draftReq.seed, 0, 'options.seed: 0 must be preserved');
    });

    it('1.4: toCausalDebtRegistration and generateHookDebtId strictly preserve chapterNo = 0', () => {
      const profile = createHookProfile({ id: 'h_prologue', name: '序章钩', type: 'crisis' });
      const reg = toCausalDebtRegistration(profile, {
        projectId: 'proj_zero',
        chapterNo: 0
      });

      assert.strictEqual(reg.createdChapterNo, 0, 'createdChapterNo must be 0 for prologue/chapter 0');
      assert.strictEqual(reg.targetPayoffChapterNo, 3, 'targetPayoffChapterNo must be 0 + maxChapters(3)');
      const expectedId = generateHookDebtId({
        projectId: 'proj_zero',
        chapterNo: 0,
        profileId: 'h_prologue'
      });
      assert.strictEqual(reg.debtId, expectedId, 'debtId must hash chapterNo 0 deterministically');
    });
  });

  // =========================================================================
  // 2. P0-5 Hook Debt ID 确定性幂等化
  // =========================================================================
  describe('P0-5: Deterministic SHA-256 Hook Debt ID Generation', () => {
    it('2.1: Identical inputs produce identical debtId across repeated calls (no Date.now jitter)', () => {
      const profile = createHookProfile({
        id: 'hook_cipher_box',
        name: '秘匣线索钩',
        type: 'suspense',
        payoffHorizon: 'medium'
      });

      const ctx = {
        projectId: 'novel_proj_42',
        chapterId: 'ch_105',
        chapterNo: 105,
        clue: '血色青铜残片'
      };

      const reg1 = toCausalDebtRegistration(profile, ctx);
      const reg2 = toCausalDebtRegistration(profile, ctx);

      assert.strictEqual(reg1.debtId, reg2.debtId, 'Debt ID must be completely deterministic');
      assert.ok(reg1.debtId.startsWith('hook_debt_'), 'Debt ID must preserve standard prefix');
      assert.ok(reg1.debtId.endsWith('_hook_cipher_box'), 'Debt ID must include profile.id');
    });

    it('2.2: Different chapterNo or projectId generates distinctly different debtId slices', () => {
      const idA = generateHookDebtId({
        projectId: 'proj_A',
        chapterId: 'ch_1',
        chapterNo: 1,
        profileId: 'hook_1',
        hookSeed: 'seed_1'
      });
      const idB = generateHookDebtId({
        projectId: 'proj_A',
        chapterId: 'ch_1',
        chapterNo: 2, // chapterNo differs
        profileId: 'hook_1',
        hookSeed: 'seed_1'
      });
      const idC = generateHookDebtId({
        projectId: 'proj_B', // projectId differs
        chapterId: 'ch_1',
        chapterNo: 1,
        profileId: 'hook_1',
        hookSeed: 'seed_1'
      });

      assert.notStrictEqual(idA, idB);
      assert.notStrictEqual(idA, idC);
      assert.notStrictEqual(idB, idC);
    });

    it('2.3: Replay / recovery with preset debtId preserves callers preset ID', () => {
      const profile = createHookProfile({
        id: 'hook_test',
        name: '测试钩',
        type: 'crisis'
      });

      const reg = toCausalDebtRegistration(profile, {
        chapterId: 'ch_1',
        debtId: 'custom_fixed_debt_999'
      });

      assert.strictEqual(reg.debtId, 'custom_fixed_debt_999');
    });
  });

  // =========================================================================
  // 3. P0-3 Attention 裁剪顺序重排并设立保底水位线
  // =========================================================================
  describe('P0-3: Immediate Context Floor & Pruning Reorder Defense', () => {
    it('3.1: computeImmediateContextFloorTokens calculates correct floor bounds', () => {
      // 6000 tokens: 10% is 600, clamped to min(256, 600) = 256
      assert.strictEqual(computeImmediateContextFloorTokens(6000), 256);
      // 1000 tokens: 10% is 100, clamped to min(256, max(64, 100)) = 100
      assert.strictEqual(computeImmediateContextFloorTokens(1000), 100);
      // 400 tokens: 10% is 40, clamped to min(256, max(64, 40)) = 64
      assert.strictEqual(computeImmediateContextFloorTokens(400), 64);
      // 50 tokens: clamped to maxTotalTokens = 50
      assert.strictEqual(computeImmediateContextFloorTokens(50), 50);
      // 0 tokens: returns 0
      assert.strictEqual(computeImmediateContextFloorTokens(0), 0);
    });

    it('3.2: Under tight 400-token budget, Tier 4 immediate context is protected and NOT wiped out; under extreme crunch, Tier 1 is suppressed first', () => {
      const permanentText = '永驻世界法则设定：万物归一，因果不灭。'.repeat(10);
      const strategyText = [
        '【P0 绝对事实】：篇幅限制 3000 字',
        '【叙事视角准则】：第三人称限制视角',
        '【状态跃迁契约】：章前潜伏，章后破局',
        '【题材边界绝不假定】：绝不假定拥有免死护甲',
        '额外长篇策略描述'.repeat(15)
      ].join('\n\n');
      const immediateText = '现场即时承接：主角在山门前驻足，天降大雨，青石板泛着冷光。'.repeat(6);

      const res400 = tierAttention({
        permanentContext: permanentText,
        chapterStrategy: strategyText,
        immediateContext: immediateText,
        maxTotalTokens: 400
      });

      assert.ok(res400.metrics.totalTokens <= 400, 'Total tokens must satisfy <= 400');
      assert.strictEqual(res400.metrics.withinBudget, true);

      // Verify Tier 4 immediate context is retained!
      assert.ok(res400.tier4Immediate.length > 0, 'Tier 4 immediate context must NOT be completely cleared');
      assert.ok(res400.metrics.tier4Tokens >= res400.metrics.immediateContextFloorTokens,
        `Tier 4 tokens (${res400.metrics.tier4Tokens}) should meet floor (${res400.metrics.immediateContextFloorTokens})`);

      // Under 70 tokens (where summarized Tier 1 + floor Tier 4 exceeds budget):
      // Verify Tier 1 permanent context is suppressed first to protect Tier 4 immediate context
      const res70 = tierAttention({
        permanentContext: permanentText,
        chapterStrategy: strategyText,
        immediateContext: immediateText,
        maxTotalTokens: 70
      });

      assert.ok(res70.metrics.totalTokens <= 70, 'Total tokens must satisfy <= 70');
      assert.ok(res70.metrics.pruningActions.includes('suppressed_tier1_for_critical_budget'),
        'Tier 1 must be suppressed first to protect Tier 4 immediate context');
      assert.ok(res70.tier4Immediate.length > 0, 'Tier 4 must be protected and NOT wiped out');
      assert.strictEqual(res70.tier1Permanent, '', 'Tier 1 must be suppressed to 0 tokens');
    });

    it('3.3: Invariant holds under extreme crunch without throw', () => {
      const res = tierAttention({
        permanentContext: '永驻设定'.repeat(20),
        chapterStrategy: '【P0 绝对事实】：3000字\n【状态跃迁契约】：章前初始->章后推进'.repeat(10),
        immediateContext: '即时前情细节描述'.repeat(20),
        maxTotalTokens: 80
      });

      assert.ok(res.metrics.totalTokens <= 80, 'Must strictly satisfy <= 80 tokens');
      assert.strictEqual(FINAL_BUDGET_ASSERT(res.metrics.totalTokens, 80), true);
    });
  });

  // =========================================================================
  // 4. P0-1 Attention 真实安全送入模型上下文（带幂等去重）
  // =========================================================================
  describe('P0-1: Attention Integration into Draft Request with Idempotency', () => {
    it('4.1: buildDraftRequest integrates Tier 3 evidence cards into userPrompt with !includes idempotency', () => {
      const evidenceCard = {
        name: '反击蓄势律',
        rule: '承受第三次重击时必有反震动作',
        pattern: '受击->卸力->蓄势->暴击'
      };

      const attentionPayload = {
        tier1Permanent: '【永驻设定】：天道崩塌',
        tier2Strategy: '【本章策略】：暗中试探',
        tier3Evidence: '【参考策略卡 1·反击蓄势律】：\n· 规则：承受第三次重击时必有反震动作',
        tier4Immediate: '【即时上下文】：主角站在雨中'
      };

      const draftReq = buildDraftRequest({
        request: { targetChars: 2000, modelId: 'writer-gpt' },
        contract: { chapterGoal: '暗中试探' },
        prompt: {
          systemPrompt: '你是小说写作者。\n\n【本章策略】：暗中试探',
          userPrompt: '【即时上下文】：主角站在雨中\n\n请直接输出正文。',
          wordBudget: { target: 2000, summary: '2000字' },
          attention: attentionPayload
        }
      });

      // 1. Verify Tier 3 Evidence is safely integrated into userPrompt
      assert.ok(draftReq.userPrompt.includes('【参考策略卡 1·反击蓄势律】'), 'userPrompt must include Tier 3 evidence');
      assert.ok(draftReq.userPrompt.includes('承受第三次重击时必有反震动作'), 'userPrompt must include card rule');

      // 2. Verify Tier 1 Permanent is safely integrated into system
      assert.ok(draftReq.system.includes('【永驻设定】：天道崩塌'), 'system must include Tier 1 permanent');

      // 3. Verify Idempotence: re-running buildDraftRequest on the already merged result does not duplicate text
      const secondPass = buildDraftRequest({
        request: { targetChars: 2000, modelId: 'writer-gpt' },
        contract: { chapterGoal: '暗中试探' },
        prompt: {
          systemPrompt: draftReq.system,
          userPrompt: draftReq.userPrompt,
          wordBudget: { target: 2000, summary: '2000字' },
          attention: attentionPayload
        }
      });

      // Count occurrences of card name
      const matches = secondPass.userPrompt.match(/反击蓄势律/g) || [];
      assert.strictEqual(matches.length, 1, 'Card must appear exactly once, without duplicate bloating');
    });

    it('4.2: assertContextBudget accurately inspects the merged prompt containing evidence cards', () => {
      const largeEvidence = '超长策略卡规约'.repeat(50);
      const draftReq = buildDraftRequest({
        request: { targetChars: 2000, modelId: 'writer-gpt' },
        contract: { chapterGoal: '突破' },
        prompt: {
          systemPrompt: '系统指令',
          userPrompt: '用户前情',
          wordBudget: { target: 2000, summary: '2000字' },
          attention: {
            tier3Evidence: largeEvidence
          }
        }
      });

      // The promptBudget breakdown tokens must reflect the large evidence inclusion
      assert.ok(draftReq.promptBudget, 'promptBudget must be generated');
      assert.ok(draftReq.promptBudget.breakdown.promptTokens > 50,
        'Prompt token count must account for merged attention content');
    });

    it('4.3: buildDraftRequest prevents duplicate bloat when strategyIR has abstractEvidenceCards lowered by ir-lowering', () => {
      const { createStrategyCard } = require('../lib/composition/corpus/evidence-catalog');
      const card = createStrategyCard({
        id: 'rule_parry_test',
        name: '格挡反击律',
        rule: '承受第三次重击时必有反震动作',
        abstractPattern: '受击->卸力->蓄势->暴击',
        evidenceStrength: 'A'
      });

      const strategyIR = {
        metadata: { version: '1.0' },
        irDigest: 'test_digest_idempotency',
        abstractEvidenceCards: [card],
        bookIdentity: { genre: { name: '玄幻' } },
        hardConstraints: { narrativePov: '第三人称' }
      };

      const req = buildDraftRequest({
        request: { strategyIR, targetChars: 2000, modelId: 'writer-gpt' }
      });

      const occurrences = (req.userPrompt.match(/承受第三次重击时必有反震动作/g) || []).length;
      assert.strictEqual(occurrences, 1, 'Card rule must appear exactly once, without double expansion from ir-lowering and buildDraftRequest');
    });
  });

  // =========================================================================
  // 5. P1-7 实验结果持久化（Experiment Engine）
  // =========================================================================
  describe('P1-7: Experiment Engine Synergy Records Persistence & Recovery', () => {
    it('5.1: recordCompatibilitySynergy appends JSONL record to disk and restores upon restart', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-exp-test-'));
      const logFile = path.join(tmpDir, 'synergy-log.jsonl');

      try {
        const engine1 = new ExperimentEngine({ persistencePath: logFile });

        await engine1.recordCompatibilitySynergy({
          tuple: {
            genre: 'xuanhuan_cautious',
            style: 'laobai_restrained',
            chapterGoal: 'conflict_push',
            focus: 'action',
            hook: 'crisis'
          },
          strategyId: 'rule_parry_riposte',
          observedLift: 0.22
        });

        await engine1.recordCompatibilitySynergy({
          tuple: {
            genre: 'urban_mystery',
            style: 'hardboiled',
            chapterGoal: 'info_reveal',
            focus: 'clue',
            hook: 'suspense'
          },
          strategyId: 'rule_shadow_drop',
          observedLift: 0.15
        });

        // Verify disk file exists and has 2 lines
        assert.ok(fs.existsSync(logFile), 'JSONL file must exist on disk');
        const content = fs.readFileSync(logFile, 'utf8');
        const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
        assert.strictEqual(lines.length, 2, 'File must contain 2 JSONL records');

        // Spin up fresh ExperimentEngine instance with the same persistence file
        const engine2 = new ExperimentEngine({ persistencePath: logFile });

        // Verify state is fully restored
        assert.strictEqual(engine2.synergyRecords.size, 2, 'Restored engine must load 2 records');
        const key1 = 'xuanhuan_cautious::laobai_restrained::conflict_push::action::crisis::rule_parry_riposte';
        assert.strictEqual(engine2.getSynergyLift(key1), 0.22, 'Lift value must be restored accurately');
        const key2 = 'urban_mystery::hardboiled::info_reveal::clue::suspense::rule_shadow_drop';
        assert.strictEqual(engine2.getSynergyLift(key2), 0.15, 'Lift value must be restored accurately');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('5.2: Corrupt / malformed lines in JSONL are skipped gracefully without crashing load', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-exp-corrupt-'));
      const logFile = path.join(tmpDir, 'synergy-corrupt.jsonl');

      try {
        const validRecord = JSON.stringify({
          key: 'g::s::g::f::h::rule_1',
          observedLift: 0.10
        });
        fs.writeFileSync(logFile, `${validRecord}\n{ INVALID_JSON_LINE\n{"partial": true}\n`, 'utf8');

        const engine = new ExperimentEngine({ persistencePath: logFile });
        assert.strictEqual(engine.synergyRecords.size, 1, 'Should load only valid records, skipping corrupt lines');
        assert.strictEqual(engine.getSynergyLift('g::s::g::f::h::rule_1'), 0.10);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('5.3: getSynergyLift supports tuple object lookup and flushSynergyRecords writes snapshot', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-exp-flush-'));
      const logFile = path.join(tmpDir, 'synergy-flush.jsonl');

      try {
        const engine = new ExperimentEngine({ persistencePath: logFile });
        const tuple = {
          genre: 'xuanhuan',
          style: 'restrained',
          chapterGoal: 'push',
          focus: 'action',
          hook: 'cliffhanger'
        };

        engine.synergyRecords.set('xuanhuan::restrained::push::action::cliffhanger::rule_99', 0.42);

        // Object lookup
        const lift = engine.getSynergyLift({ tuple, strategyId: 'rule_99' });
        assert.strictEqual(lift, 0.42, 'Object tuple lookup should resolve correct lift');

        // Snapshot flush
        const flushedCount = engine.flushSynergyRecords();
        assert.strictEqual(flushedCount, 1, 'Flushed count should equal in-memory size');
        assert.ok(fs.existsSync(logFile), 'Snapshot file should exist');

        const content = fs.readFileSync(logFile, 'utf8');
        assert.ok(content.includes('0.42'), 'Snapshot file should contain flushed lift');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  // =========================================================================
  // 6. P0-4: Profile Registry allowUnresolved & Strict Mode Invariant
  // =========================================================================
  describe('P0-4: Profile Registry allowUnresolved & Inferred Default Invariant', () => {
    it('6.1: allowUnresolved = true returns structured unresolved profile when dimensions omitted', () => {
      const spec = defaultProfileRegistry.resolveCompositionSpec({
        genre: 'xuanhuan_cautious'
      }, { allowUnresolved: true });

      assert.strictEqual(spec.genre.id, 'xuanhuan_cautious');
      assert.strictEqual(spec.style.resolved, false, 'Style must be unresolved');
      assert.strictEqual(spec.style.mode, 'unresolved');
      assert.strictEqual(spec.style.reason, 'style_not_selected');
      assert.strictEqual(spec.chapterGoal.resolved, false);
      assert.strictEqual(spec.focus.resolved, false);
      assert.strictEqual(spec.hook.resolved, false);
    });

    it('6.2: standard mode maintains inferred defaults preventing downstream crashes', () => {
      const spec = defaultProfileRegistry.resolveCompositionSpec({
        genre: 'xuanhuan_cautious'
      });

      assert.strictEqual(spec.style.id, 'laobai_restrained');
      assert.strictEqual(spec.profileModes.style, 'inferred');
      assert.ok(typeof spec.style.name === 'string');
    });

    it('6.3: strict mode strictly throws ProfileResolutionError when dimensions omitted', () => {
      assert.throws(
        () => defaultProfileRegistry.resolveCompositionSpec({ genre: 'xuanhuan_cautious' }, { strict: true }),
        (err) => err.name === 'ProfileResolutionError' && err.dimension === 'style'
      );
    });
  });

  // =========================================================================
  // 7. P0-6 & P1-2: L1 Structural Truth Evaluation & RenderedPromptPackage
  // =========================================================================
  describe('P0-6 & P1-2: Structural Truth Evaluation & RenderedPromptPackage', () => {
    it('7.1: evaluateCandidate incorporates L1 debt reconciliation bonus and flags speculative tension discount', async () => {
      const engine = new ExperimentEngine();

      // Case A: With real debt resolution
      const resWithRecon = await engine.evaluateCandidate({
        text: '刀光破空，他侧身闪过，反手刺出。',
        debtReconciliation: {
          status: 'reconciled',
          resolvedDebts: [{ debtId: 'hook_1' }]
        }
      });

      assert.ok(resWithRecon.l1Structural.hasStructuralVerification, 'Must flag structural verification');
      assert.ok(resWithRecon.l1Structural.structuralCausalBonus > 0, 'Must award causal bonus for resolved debts');

      // Case B: Speculative tension keyword stuffing without state delta or debt resolution
      const resSpeculative = await engine.evaluateCandidate({
        text: '死战！生死存亡！极度危险的危机与杀机！千钧一发！',
        debtReconciliation: {
          status: 'pending',
          resolvedDebts: []
        },
        stateDelta: { stateBefore: '原地', stateAfter: '原地' }
      });

      assert.ok(resSpeculative.l1Structural.speculativeTensionDiscount > 0, 'Must apply speculative tension discount when keywords stuffed without state change');
      assert.ok(resSpeculative.l0Prescreen.tensionHits >= 3, 'Must record L0 prescreen tension hits');
    });

    it('7.2: buildDraftRequest outputs structured renderedPromptPackage', () => {
      const spec = defaultProfileRegistry.resolveCompositionSpec({
        genre: 'xuanhuan_cautious',
        style: 'laobai_restrained',
        chapterGoal: 'conflict_push',
        focus: 'action',
        hook: 'crisis'
      });

      const draftReq = buildDraftRequest({
        request: { compositionSpec: spec },
        contract: { chapterGoal: '推进', wordBudget: { target: 2000 } }
      });

      assert.ok(draftReq.renderedPromptPackage, 'Must output renderedPromptPackage');
      assert.strictEqual(draftReq.renderedPromptPackage.schemaVersion, 'rendered-prompt-package-v1');
      assert.strictEqual(typeof draftReq.renderedPromptPackage.system, 'string');
      assert.strictEqual(typeof draftReq.renderedPromptPackage.userPrompt, 'string');
      assert.ok(Array.isArray(draftReq.renderedPromptPackage.messages));
    });
  });

});

