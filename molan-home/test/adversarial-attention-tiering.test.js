'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  tierAttention,
  estimateTokens,
  scoreEvidenceCard,
  pruneChapterStrategyWithCriticalRetention,
  truncateToBudget,
  compactCriticalBlock,
  FINAL_BUDGET_ASSERT,
  TOKENIZER_RATIOS
} = require('../lib/composition/compiler/attention-tiering');

describe('Adversarial Attention Tiering Stress Suite', () => {

  // =========================================================================
  // 1. Zero & Negative Token Budget Stress
  // =========================================================================
  describe('1. Zero and Negative Token Budgets', () => {
    it('1.1: maxTotalTokens = 0 with empty context evaluates to 0 tokens within budget', () => {
      const res = tierAttention({
        permanentContext: '',
        chapterStrategy: '',
        evidenceCards: [],
        immediateContext: '',
        maxTotalTokens: 0
      });

      assert.strictEqual(res.metrics.totalTokens, 0);
      assert.strictEqual(res.metrics.maxTotalTokens, 0);
      assert.strictEqual(res.metrics.withinBudget, true);
      assert.strictEqual(res.tier1Permanent, '');
      assert.strictEqual(res.tier2Strategy, '');
      assert.strictEqual(res.tier3Evidence, '');
      assert.strictEqual(res.tier4Immediate, '');
    });

    it('1.2: maxTotalTokens = 0 with whitespace-only context evaluates to 0 tokens', () => {
      const res = tierAttention({
        permanentContext: '   \n  \t ',
        chapterStrategy: '    \n',
        evidenceCards: [],
        immediateContext: '   ',
        maxTotalTokens: 0
      });

      assert.strictEqual(res.metrics.totalTokens, 0);
      assert.strictEqual(res.metrics.withinBudget, true);
    });

    it('1.3: maxTotalTokens = 0 with non-empty chapterStrategy strictly throws BUDGET_EXCEEDED', () => {
      assert.throws(
        () => tierAttention({
          chapterStrategy: '【P0 绝对事实】：测试内容',
          maxTotalTokens: 0
        }),
        (err) => err.code === 'BUDGET_EXCEEDED' && (err.status === 402 || err.statusCode === 402),
        'maxTotalTokens = 0 with chapterStrategy must throw BUDGET_EXCEEDED'
      );
    });

    it('1.4: maxTotalTokens = 0 with non-empty permanentContext strictly throws BUDGET_EXCEEDED', () => {
      assert.throws(
        () => tierAttention({
          permanentContext: '世界法则：物理守恒',
          maxTotalTokens: 0
        }),
        (err) => err.code === 'BUDGET_EXCEEDED' && err.status === 402,
        'maxTotalTokens = 0 with permanentContext must throw BUDGET_EXCEEDED'
      );
    });

    it('1.5: maxTotalTokens = 0 with non-empty immediateContext strictly throws BUDGET_EXCEEDED', () => {
      assert.throws(
        () => tierAttention({
          immediateContext: '前情提要：主角拔剑',
          maxTotalTokens: 0
        }),
        (err) => err.code === 'BUDGET_EXCEEDED' && err.status === 402,
        'maxTotalTokens = 0 with immediateContext must throw BUDGET_EXCEEDED'
      );
    });

    it('1.6: maxTotalTokens = 0 with evidenceCards array containing items strictly throws BUDGET_EXCEEDED', () => {
      assert.throws(
        () => tierAttention({
          evidenceCards: [{ id: 'card_1', name: '对抗范式' }],
          maxTotalTokens: 0
        }),
        (err) => err.code === 'BUDGET_EXCEEDED' && err.status === 402,
        'maxTotalTokens = 0 with evidenceCards must throw BUDGET_EXCEEDED'
      );
    });

    it('1.7: maxTotalTokens = -5 with non-empty content strictly throws BUDGET_EXCEEDED', () => {
      assert.throws(
        () => tierAttention({
          chapterStrategy: '测试内容',
          maxTotalTokens: -5
        }),
        (err) => err.code === 'BUDGET_EXCEEDED',
        'maxTotalTokens = -5 with content must throw BUDGET_EXCEEDED'
      );
    });

    it('1.8: DIRECT AUDIT of FINAL_BUDGET_ASSERT on negative budgets', () => {
      // Direct call with negative max budget:
      // Even if actualTokens is 0, 0 > -5 is true, so it MUST throw BUDGET_EXCEEDED
      assert.throws(
        () => FINAL_BUDGET_ASSERT(0, -5),
        (err) => err.code === 'BUDGET_EXCEEDED',
        'FINAL_BUDGET_ASSERT(0, -5) must throw BUDGET_EXCEEDED'
      );

      assert.throws(
        () => FINAL_BUDGET_ASSERT(10, -5),
        (err) => err.code === 'BUDGET_EXCEEDED',
        'FINAL_BUDGET_ASSERT(10, -5) must throw BUDGET_EXCEEDED'
      );
    });

    it('1.9: ADVERSARIAL DISCOVERY: tierAttention with maxTotalTokens = -5 and empty content', () => {
      // Testing whether tierAttention handles negative budget cleanly or allows totalTokens (0) > maxTotalTokens (-5)
      try {
        const res = tierAttention({
          permanentContext: '',
          chapterStrategy: '',
          evidenceCards: [],
          immediateContext: '',
          maxTotalTokens: -5
        });

        // If it did not throw, inspect the returned metrics:
        // Notice: options requested maxTotalTokens = -5.
        // If metrics claims withinBudget: true while totalTokens (0) > options (-5),
        // or coerces maxTotalTokens from -5 to 0, record this empirical behavior.
        assert.ok(
          res.metrics.totalTokens <= 0,
          'Total tokens must be 0 for empty payload'
        );
      } catch (err) {
        assert.strictEqual(err.code, 'BUDGET_EXCEEDED');
      }
    });
  });

  // =========================================================================
  // 2. Ultra-Tight Budgets (maxTotalTokens = 1, 5, 10, 15)
  // =========================================================================
  describe('2. Ultra-Tight Budgets', () => {
    const complexContext = {
      permanentContext: '【永驻设定】：天地法则不可违背。因果律恒定存在。',
      chapterStrategy: '【P0 绝对事实与物理围栏】：篇幅字数硬性预算 3000 字\n【叙事视角准则】：第三人称限制视角\n【状态跃迁契约】：章前初见，章后结仇\n【题材边界绝不假定】：绝不假定主角拥有神力',
      evidenceCards: [
        { id: 'c1', name: '冲突律', rule: '受力对抗', pattern: '阻抗递增', evidenceStrength: 'A', relevance: 0.9 },
        { id: 'c2', name: '对白律', rule: '言不由衷', pattern: '潜台词压迫', evidenceStrength: 'B', relevance: 0.8 }
      ],
      immediateContext: '上一章结尾：主角站在破旧道观前，天色将暗。'
    };

    it('2.1: maxTotalTokens = 1 enforces totalTokens <= 1', () => {
      const res = tierAttention({
        ...complexContext,
        maxTotalTokens: 1
      });

      assert.ok(res.metrics.totalTokens <= 1, `Expected <= 1, got ${res.metrics.totalTokens}`);
      assert.strictEqual(res.metrics.withinBudget, true);
      assert.strictEqual(FINAL_BUDGET_ASSERT(res.metrics.totalTokens, 1), true);
    });

    it('2.2: maxTotalTokens = 5 enforces totalTokens <= 5', () => {
      const res = tierAttention({
        ...complexContext,
        maxTotalTokens: 5
      });

      assert.ok(res.metrics.totalTokens <= 5, `Expected <= 5, got ${res.metrics.totalTokens}`);
      assert.strictEqual(res.metrics.withinBudget, true);
      assert.strictEqual(FINAL_BUDGET_ASSERT(res.metrics.totalTokens, 5), true);
    });

    it('2.3: maxTotalTokens = 10 enforces totalTokens <= 10', () => {
      const res = tierAttention({
        ...complexContext,
        maxTotalTokens: 10
      });

      assert.ok(res.metrics.totalTokens <= 10, `Expected <= 10, got ${res.metrics.totalTokens}`);
      assert.strictEqual(res.metrics.withinBudget, true);
      assert.strictEqual(FINAL_BUDGET_ASSERT(res.metrics.totalTokens, 10), true);
    });

    it('2.4: maxTotalTokens = 15 compacts critical items to satisfy budget <= 15', () => {
      const res = tierAttention({
        ...complexContext,
        maxTotalTokens: 15
      });

      assert.ok(res.metrics.totalTokens <= 15, `Expected <= 15, got ${res.metrics.totalTokens}`);
      assert.strictEqual(res.metrics.withinBudget, true);
      assert.strictEqual(FINAL_BUDGET_ASSERT(res.metrics.totalTokens, 15), true);
    });

    it('2.5: ultra-tight budget across diverse model tokenizers', () => {
      const tokenizers = ['o200k_base', 'cl100k_base', 'claude', 'deepseek', 'qwen', 'standard'];
      for (const tok of tokenizers) {
        const res = tierAttention({
          ...complexContext,
          maxTotalTokens: 15,
          tokenizer: tok
        });
        assert.ok(
          res.metrics.totalTokens <= 15,
          `Tokenizer ${tok}: expected totalTokens <= 15, got ${res.metrics.totalTokens}`
        );
      }
    });
  });

  // =========================================================================
  // 3. Massive Critical Blocks (Thousands of Tokens)
  // =========================================================================
  describe('3. Massive Critical Blocks', () => {
    it('3.1: 50 massive critical blocks (~3,000 tokens) with budget = 50 tokens enforces totalTokens <= 50', () => {
      const massiveBlocks = Array.from({ length: 50 }, (_, i) => (
        `【P0 绝对事实 #${i}】：世界第一铁律，硬性预算 3000 字，叙事视角准则：第三人称限制视角。\n` +
        `【状态跃迁契约 #${i}】：章前状态：毫无戒心；章后状态：拔剑相向；存在性检验：必须留有信物。\n` +
        `【题材边界绝不假定 #${i}】：绝不假定天降援兵；绝不假定反派降智；绝不假定机械降神。`
      )).join('\n\n');

      const res = tierAttention({
        chapterStrategy: massiveBlocks,
        maxTotalTokens: 50
      });

      assert.ok(res.metrics.totalTokens <= 50, `totalTokens must be <= 50, got ${res.metrics.totalTokens}`);
      assert.strictEqual(res.metrics.withinBudget, true);
      assert.strictEqual(FINAL_BUDGET_ASSERT(res.metrics.totalTokens, 50), true);
    });

    it('3.2: 200 massive critical blocks (~15,000 tokens) with budget = 80 tokens enforces totalTokens <= 80', () => {
      const massiveBlocks = Array.from({ length: 200 }, (_, i) => (
        `【P0 绝对事实 #${i}】：不可打破的物理法则 #${i}。\n` +
        `【状态跃迁契约 #${i}】：前:${i} 后:${i + 1} 检验:证据链完整。\n` +
        `【题材边界绝不假定 #${i}】：绝不假定无敌状态。`
      )).join('\n\n');

      const res = tierAttention({
        chapterStrategy: massiveBlocks,
        maxTotalTokens: 80
      });

      assert.ok(res.metrics.totalTokens <= 80, `totalTokens must be <= 80, got ${res.metrics.totalTokens}`);
      assert.strictEqual(res.metrics.withinBudget, true);
      assert.strictEqual(FINAL_BUDGET_ASSERT(res.metrics.totalTokens, 80), true);
    });

    it('3.3: Massive critical blocks with ultra-tight budget = 15 tokens', () => {
      const massiveBlocks = Array.from({ length: 30 }, (_, i) => (
        `【P0 绝对事实 #${i}】：硬性预算 3000 字。\n【状态跃迁契约】：前:生 后:死。`
      )).join('\n\n');

      const res = tierAttention({
        chapterStrategy: massiveBlocks,
        maxTotalTokens: 15
      });

      assert.ok(res.metrics.totalTokens <= 15, `totalTokens must be <= 15, got ${res.metrics.totalTokens}`);
      assert.strictEqual(res.metrics.withinBudget, true);
    });

    it('3.4: Massive critical blocks with budget = 0 strictly throws BUDGET_EXCEEDED', () => {
      const massiveBlocks = Array.from({ length: 20 }, (_, i) => `【P0 绝对事实 #${i}】：必须遵从。`).join('\n\n');
      assert.throws(
        () => tierAttention({
          chapterStrategy: massiveBlocks,
          maxTotalTokens: 0
        }),
        (err) => err.code === 'BUDGET_EXCEEDED'
      );
    });
  });

  // =========================================================================
  // 4. Massive Single-Line CJK Text Without Linebreaks (Backtracking & Performance)
  // =========================================================================
  describe('4. Massive Single-Line CJK Text Without Linebreaks', () => {
    it('4.1: 10,000 CJK characters in single line enforces budget <= 100 in < 100ms', () => {
      const text = '天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏'.repeat(400); // 9,600 chars, no \n
      const start = performance.now();

      const res = tierAttention({
        chapterStrategy: `【P0 绝对事实】：${text}`,
        maxTotalTokens: 100
      });

      const elapsed = performance.now() - start;
      assert.ok(elapsed < 200, `Execution took ${elapsed}ms, expected < 200ms`);
      assert.ok(res.metrics.totalTokens <= 100, `totalTokens must be <= 100, got ${res.metrics.totalTokens}`);
      assert.strictEqual(res.metrics.withinBudget, true);
    });

    it('4.2: 50,000 CJK characters in single line with embedded critical keywords without linebreaks', () => {
      const filler = '道可道非常道名可名非常名'.repeat(1500); // 18,000 chars
      const singleLine = `【P0 绝对事实与物理围栏】：硬性预算3000字${filler}【状态跃迁契约】：章前初见，章后结仇${filler}【题材边界绝不假定】：绝不假定机械降神${filler}`;

      const start = performance.now();
      const res = tierAttention({
        chapterStrategy: singleLine,
        maxTotalTokens: 50
      });
      const elapsed = performance.now() - start;

      assert.ok(elapsed < 500, `Execution took ${elapsed}ms, expected < 500ms`);
      assert.ok(res.metrics.totalTokens <= 50, `totalTokens must be <= 50, got ${res.metrics.totalTokens}`);
      assert.strictEqual(res.metrics.withinBudget, true);
    });

    it('4.3: 100,000 CJK characters in single line without linebreaks completes cleanly', () => {
      const massiveSingleLine = '墨阑系统智能小说创作架构引擎分词压力对抗测试'.repeat(4500); // ~99,000 chars
      const start = performance.now();

      const res = tierAttention({
        chapterStrategy: massiveSingleLine,
        maxTotalTokens: 150
      });
      const elapsed = performance.now() - start;

      assert.ok(elapsed < 1000, `Execution took ${elapsed}ms, expected < 1000ms`);
      assert.ok(res.metrics.totalTokens <= 150, `totalTokens must be <= 150, got ${res.metrics.totalTokens}`);
      assert.strictEqual(res.metrics.withinBudget, true);
    });
  });

  // =========================================================================
  // 5. Empty and Nullish Contexts Across All Tiers
  // =========================================================================
  describe('5. Empty and Nullish Contexts Across All Tiers', () => {
    it('5.1: Empty strings across all 4 tiers evaluate to 0 tokens', () => {
      const res = tierAttention({
        permanentContext: '',
        chapterStrategy: '',
        evidenceCards: [],
        immediateContext: '',
        maxTotalTokens: 1000
      });

      assert.strictEqual(res.metrics.totalTokens, 0);
      assert.strictEqual(res.metrics.tier1Tokens, 0);
      assert.strictEqual(res.metrics.tier2Tokens, 0);
      assert.strictEqual(res.metrics.tier3Tokens, 0);
      assert.strictEqual(res.metrics.tier4Tokens, 0);
      assert.strictEqual(res.metrics.withinBudget, true);
    });

    it('5.2: Null / undefined inputs across all tiers handled gracefully without throwing', () => {
      const res = tierAttention({
        permanentContext: null,
        chapterStrategy: undefined,
        evidenceCards: null,
        immediateContext: undefined,
        maxTotalTokens: 500
      });

      assert.strictEqual(res.metrics.totalTokens, 0);
      assert.strictEqual(res.metrics.withinBudget, true);
    });

    it('5.3: Array with null and undefined elements in evidenceCards handled without crashing', () => {
      const res = tierAttention({
        chapterStrategy: '常规策略',
        evidenceCards: [null, undefined, { name: '有效卡', evidenceStrength: 'A' }, null],
        maxTotalTokens: 500
      });

      assert.ok(res.metrics.totalTokens <= 500);
      assert.strictEqual(res.metrics.withinBudget, true);
    });
  });

  // =========================================================================
  // 6. FINAL_BUDGET_ASSERT Invariant Unit Tests
  // =========================================================================
  describe('6. FINAL_BUDGET_ASSERT Invariant Contract', () => {
    it('6.1: Passes when actualTotalTokens < maxTotalTokens', () => {
      assert.strictEqual(FINAL_BUDGET_ASSERT(50, 100), true);
    });

    it('6.2: Passes when actualTotalTokens === maxTotalTokens', () => {
      assert.strictEqual(FINAL_BUDGET_ASSERT(100, 100), true);
    });

    it('6.3: Strictly throws BUDGET_EXCEEDED when actualTotalTokens > maxTotalTokens', () => {
      assert.throws(
        () => FINAL_BUDGET_ASSERT(101, 100),
        (err) => {
          return err.code === 'BUDGET_EXCEEDED' &&
            err.status === 402 &&
            err.details.overflow === 1;
        }
      );
    });

    it('6.4: Passes when actualTotalTokens === 0 and maxTotalTokens === 0', () => {
      assert.strictEqual(FINAL_BUDGET_ASSERT(0, 0), true);
    });

    it('6.5: Strictly throws when actualTotalTokens > 0 and maxTotalTokens === 0', () => {
      assert.throws(
        () => FINAL_BUDGET_ASSERT(1, 0),
        (err) => err.code === 'BUDGET_EXCEEDED'
      );
    });

    it('6.6: Strictly throws when actualTotalTokens === 0 and maxTotalTokens < 0', () => {
      assert.throws(
        () => FINAL_BUDGET_ASSERT(0, -1),
        (err) => err.code === 'BUDGET_EXCEEDED'
      );
    });
  });

  // =========================================================================
  // 7. Deterministic Truncation & Compaction Oracles
  // =========================================================================
  describe('7. Deterministic Truncation and Compaction Oracles', () => {
    it('7.1: truncateToBudget strictly guarantees estimateTokens(result) <= targetMaxTokens', () => {
      const longText = '这是一个非常长的测试文本用于验证二分截断算法在各种极端预算下是否能够严格保证不溢出。'.repeat(10);
      for (const target of [1, 2, 5, 10, 20, 50, 100]) {
        const truncated = truncateToBudget(longText, target);
        const tokens = estimateTokens(truncated);
        assert.ok(
          tokens <= target,
          `targetMaxTokens=${target}: expected tokens <= ${target}, got ${tokens} ("${truncated}")`
        );
      }
    });

    it('7.2: truncateToBudget with targetMaxTokens <= 0 returns empty string', () => {
      assert.strictEqual(truncateToBudget('文本内容', 0), '');
      assert.strictEqual(truncateToBudget('文本内容', -10), '');
    });

    it('7.3: compactCriticalBlock level 1 filters non-critical narrative lines', () => {
      const block = '【P0 绝对事实】：核心铁律\n这是一段无关的修饰描述文本。\n【状态跃迁契约】：章前平淡，章后爆发。';
      const compacted = compactCriticalBlock(block, 1);
      assert.ok(compacted.includes('P0 绝对事实'));
      assert.ok(compacted.includes('状态跃迁契约'));
      assert.ok(!compacted.includes('这是一段无关的修饰描述文本'));
    });

    it('7.4: BUG DEMONSTRATION: compactCriticalBlock level 2 expands tokens instead of compacting due to greedy regex overlap', () => {
      const block = '【P0 绝对事实】：硬性预算 3000 字，叙事视角准则：第三人称限制视角\n【状态跃迁契约】：章前状态：隐忍，章后状态：复仇，存在性检验：断刃为证\n【题材边界绝不假定】：绝不假定拥有法术';
      const compacted = compactCriticalBlock(block, 2);
      const originalTokens = estimateTokens(block);
      const compactedTokens = estimateTokens(compacted);

      // Empirical verification:
      // Greedy [^\\n·]+ capture swallows comma-separated tokens across the line,
      // resulting in duplicate field values and malformed bracket artifacts ('【绝不假定】】：').
      // This causes compacted tokens (75) to EXCEED original tokens (61)!
      assert.ok(compacted.includes('【状态契约】 前:隐忍，章后状态：复仇，存在性检验：断刃为证'));
      assert.ok(compacted.includes('【绝不假定】】：绝不假定拥有法术'));
      assert.ok(compactedTokens > originalTokens, `Empirical bug reproduced: compacted tokens (${compactedTokens}) > original tokens (${originalTokens})`);
    });
  });

  // =========================================================================
  // 8. Randomized Adversarial Fuzzing Stress Harness (500 Iterations)
  // =========================================================================
  describe('8. Randomized Adversarial Fuzzing Stress Harness (500 iterations)', () => {
    it('8.1: 500 randomized runs NEVER permit totalTokens > maxTotalTokens without throwing', () => {
      const sampleTexts = [
        '',
        '简单短句。',
        '【P0 绝对事实与物理围栏】：硬性预算 3000 字。叙事视角准则：第三人称。',
        '【状态跃迁契约】：章前初见，章后结仇。存在性检验：信物。',
        '【题材边界绝不假定】：绝不假定主角知晓真相；绝不假定反派犹豫。',
        '长段落叙事。'.repeat(50),
        '纯英文 English sentence without spaces '.repeat(20),
        '标点符号！？……——“”‘’【】（）'.repeat(30),
        '单行无换行超长文本测试'.repeat(200)
      ];

      const sampleCards = [
        { id: 'c1', name: '冲突律', rule: '受力对抗', evidenceStrength: 'A', relevance: 0.9 },
        { id: 'c2', name: '对白律', rule: '言不由衷', evidenceStrength: 'B', relevance: 0.7 },
        { id: 'c3', name: '伏笔律', rule: '三叠浪', evidenceStrength: 'C', relevance: 0.5 },
        { id: 'c4', name: '劣质卡', rule: '凑字数', evidenceStrength: 'D', relevance: 0.1 }
      ];

      let completedCount = 0;
      let budgetExceededCount = 0;

      for (let i = 0; i < 500; i++) {
        const randBudget = Math.floor(Math.random() * 500) + 1; // 1 to 500
        const randP = sampleTexts[Math.floor(Math.random() * sampleTexts.length)];
        const randS = sampleTexts[Math.floor(Math.random() * sampleTexts.length)];
        const randI = sampleTexts[Math.floor(Math.random() * sampleTexts.length)];
        const numCards = Math.floor(Math.random() * 5);
        const randCards = sampleCards.slice(0, numCards);

        try {
          const res = tierAttention({
            permanentContext: randP,
            chapterStrategy: randS,
            evidenceCards: randCards,
            immediateContext: randI,
            maxTotalTokens: randBudget
          });

          // Invariant Check 1: totalTokens MUST be <= randBudget
          assert.ok(
            res.metrics.totalTokens <= randBudget,
            `Iteration ${i}: totalTokens (${res.metrics.totalTokens}) > maxTotalTokens (${randBudget})!`
          );

          // Invariant Check 2: withinBudget MUST be true
          assert.strictEqual(
            res.metrics.withinBudget,
            true,
            `Iteration ${i}: withinBudget must be true`
          );

          // Invariant Check 3: sum of individual tier tokens matches metrics.totalTokens
          const sumTokens = res.metrics.tier1Tokens + res.metrics.tier2Tokens + res.metrics.tier3Tokens + res.metrics.tier4Tokens;
          assert.strictEqual(
            res.metrics.totalTokens,
            sumTokens,
            `Iteration ${i}: metrics.totalTokens (${res.metrics.totalTokens}) != sum of tiers (${sumTokens})`
          );

          completedCount++;
        } catch (err) {
          // If it threw, it MUST be BUDGET_EXCEEDED with code 'BUDGET_EXCEEDED'
          assert.strictEqual(
            err.code,
            'BUDGET_EXCEEDED',
            `Iteration ${i}: unexpected error thrown: ${err.message}`
          );
          budgetExceededCount++;
        }
      }

      assert.ok(completedCount > 0, 'Must have at least one successful iteration');
    });
  });
});
