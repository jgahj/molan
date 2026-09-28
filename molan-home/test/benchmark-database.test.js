'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const benchmarkDatabase = require('../lib/benchmark-database');
const benchmarkPipeline = require('../lib/benchmark-pipeline');

test('Benchmark 数据库：基础加载与完整性校验', async (t) => {
  await t.test('成功加载基准数据库索引与各层数据', () => {
    const summary = benchmarkDatabase.getDatabaseSummary();
    assert.equal(summary.status, 'ready', '数据库应为 ready 状态');
    assert.ok(summary.totalBenchmarks >= 60, '基准条目总数应不少于 60 条');
    assert.equal(summary.countsByLevel.Level1_Family, 8, '应包含 8 个叙事母类基准');
    assert.equal(summary.countsByLevel.Level2_Subgenre, 48, '应包含 48 个细分题材基准');
    assert.ok(summary.countsByLevel.Level4_Pacing >= 9, '应包含不少于 9 个流派人设高阶基准');
  });

  await t.test('零原文泄漏安全断言：所有 Sample Books 均不得包含大段正文', () => {
    const all = benchmarkDatabase.listBenchmarks();
    assert.ok(all.length > 0);
    for (const bm of all) {
      assert.ok(Array.isArray(bm.sample_books), `${bm.benchmark_id} 必须包含 sample_books 数组`);
      for (const book of bm.sample_books) {
        assert.equal(typeof book.title, 'string', '书籍必须有 title');
        assert.equal(typeof book.author, 'string', '书籍必须有 author');
        assert.equal(book.text, undefined, `${bm.benchmark_id} 中书籍【${book.title}】不得包含 text 字段`);
        assert.equal(book.content, undefined, `${bm.benchmark_id} 中书籍【${book.title}】不得包含 content 字段`);
        assert.equal(book.body, undefined, `${bm.benchmark_id} 中书籍【${book.title}】不得包含 body 字段`);
      }
    }
  });

  await t.test('18 维特征与核心度量完整性校验', () => {
    const all = benchmarkDatabase.listBenchmarks();
    for (const bm of all) {
      assert.ok(bm.benchmark_id, '必须有 benchmark_id');
      assert.ok(bm.level, '必须有 level');
      assert.ok(bm.genre, '必须有 genre');
      assert.ok(bm.subgenre, '必须有 subgenre');
      assert.ok(bm.structure, '必须有 structure');
      assert.ok(bm.narrative_type, '必须有 narrative_type');
      assert.ok(bm.pacing_type, '必须有 pacing_type');
      assert.ok(bm.world_type, '必须有 world_type');
      assert.ok(bm.protagonist_type, '必须有 protagonist_type');
      assert.ok(bm.core_conflict, '必须有 core_conflict');
      assert.ok(bm.golden_finger_type, '必须有 golden_finger_type');
      assert.ok(bm.metrics_target, '必须有 metrics_target');
      assert.ok(Number.isFinite(bm.metrics_target.sentenceLenMean), '句长均值必须为有效数值');
      assert.ok(Number.isFinite(bm.metrics_target.dialogueRatio), '对白比例必须为有效数值');
      assert.ok(Number.isFinite(bm.metrics_target.dialogueTurnMean), '单轮对白均值必须为有效数值');
      assert.ok(Array.isArray(bm.metrics_target.chapterChars), '单章篇幅区间必须为数组');
      assert.equal(bm.metrics_target.chapterChars.length, 2, '单章篇幅区间必须包含 [P25, P75]');
      assert.ok(Number.isFinite(bm.confidence), '置信度必须为有效数值');
    }
  });
});

test('Benchmark 分层匹配引擎：同类可比与安全降级', async (t) => {
  await t.test('Level 4 精准流派与主角原型匹配：凡人谨慎流', () => {
    const matched = benchmarkDatabase.findComparableBenchmark({
      genre: '玄幻修真',
      subgenre: '东方仙侠',
      protagonistType: '冷静理智型 / 谨慎藏拙'
    });
    assert.ok(matched);
    assert.equal(matched.matchLevel, 'Level4_Pacing');
    assert.equal(matched.benchmark_id, 'BM_L4_FANREN_CAUTIOUS');
    assert.equal(matched.downgraded, false);
    assert.ok(matched.confidence >= 0.95);
    assert.ok(matched.metrics_target.dialogueTurnMean >= 20.0, '凡人流单轮对白目标应饱满');
  });

  await t.test('Level 4 关键词意图匹配：规则怪谈', () => {
    const matched = benchmarkDatabase.findComparableBenchmark({
      genre: '悬疑惊悚',
      prompt: '主角登上一列诡异车厢，遭遇异常规则怪谈，必须遵守守则生还'
    });
    assert.ok(matched);
    assert.equal(matched.matchLevel, 'Level4_Pacing');
    assert.equal(matched.benchmark_id, 'BM_L4_SUSPENSE_RULE_HORROR');
    assert.equal(matched.downgraded, false);
  });

  await t.test('Level 2 细分题材标准匹配：战神赘婿', () => {
    const matched = benchmarkDatabase.findComparableBenchmark({
      subgenre: '战神赘婿'
    });
    assert.ok(matched);
    assert.equal(matched.matchLevel, 'Level2_Subgenre');
    assert.ok(matched.benchmark_id.includes('战神赘婿'));
    assert.equal(matched.downgraded, false);
    assert.ok(matched.sample_count >= 15);
  });

  await t.test('Level 1 安全平滑降级：稀缺或未知流派回退至叙事母类', () => {
    const matched = benchmarkDatabase.findComparableBenchmark({
      genre: '虚构的未知小众科幻机甲流'
    });
    assert.ok(matched);
    assert.equal(matched.matchLevel, 'Level1_Family');
    assert.equal(matched.genre, '科幻末世');
    assert.equal(matched.downgraded, true);
    assert.ok(matched.downgradeReason.includes('平滑降级'));
  });

  await t.test('生成提示词目标块生成 buildComparablePromptTarget', () => {
    const bm = benchmarkDatabase.getBenchmarkById('BM_L4_FANREN_CAUTIOUS');
    assert.ok(bm);
    const targetBlock = benchmarkDatabase.buildComparablePromptTarget(bm);
    assert.ok(targetBlock.includes('【同类可比基准锚点'));
    assert.ok(targetBlock.includes('篇幅硬预算'));
    assert.ok(targetBlock.includes('言语节奏与对白拉扯'));
    assert.ok(targetBlock.includes('感官具象描写'));
    assert.ok(targetBlock.length < 500, '目标块应保持紧凑（≤500字）');
  });
});

test('管线集成：benchmark-pipeline 无缝挂载同类可比基准', async (t) => {
  await t.test('loadGenreBaseline 自动注入 comparableBenchmark', () => {
    const pack = benchmarkPipeline.loadGenreBaseline('东方仙侠', undefined, {
      protagonistType: '冷静理智型 / 谨慎藏拙'
    });
    assert.ok(pack);
    assert.ok(pack.comparableBenchmark);
    assert.equal(pack.comparableBenchmark.benchmark_id, 'BM_L4_FANREN_CAUTIOUS');

    const targetBlock = benchmarkPipeline.buildBaselineTargetBlock(pack);
    assert.ok(targetBlock.includes('同类可比基准锚点'));
    assert.ok(targetBlock.includes('凡人谨慎修仙流'));
  });

  await t.test('loadGenreBaseline 对未独立切片的题材亦可由基准库平滑提供', () => {
    const pack = benchmarkPipeline.loadGenreBaseline('武侠');
    assert.ok(pack);
    assert.ok(pack.baseline);
    assert.ok(pack.baseline.sentenceLenMean);
    assert.ok(pack.comparableBenchmark);
  });
});

test('未知或缺失题材的质量特征基线不回退到其他题材', () => {
  assert.equal(benchmarkDatabase.getQualityProfileBaseline('不存在的题材'), null);
  assert.equal(benchmarkDatabase.getQualityProfileBaseline(''), null);
  assert.equal(benchmarkDatabase.getQualityProfileBaseline(undefined), null);
  assert.equal(benchmarkDatabase.findComparableBenchmark({ genre: '完全未知的架空题材' }), null);
  assert.equal(benchmarkDatabase.buildComparablePromptTarget(null), '');
});
