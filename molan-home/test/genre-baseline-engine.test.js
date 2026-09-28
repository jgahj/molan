'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const {
  GENRE_METRIC_DEFINITIONS,
  computeDistributionStats,
  evaluateWithContext,
  loadGenreQualityBaselines,
  getGenreBaseline,
  getDetectionModeClassification
} = require('../lib/genre-baseline-engine');

test('GenreBaselineEngine: 18 项质量指标覆盖与七维统计分布校验', async t => {
  await t.test('18 项核心指标元数据定义完整', () => {
    const requiredKeys = [
      'chapter_length',
      'scene_count',
      'conflict_density',
      'information_density',
      'hook_density',
      'emotion_variation',
      'shuangdian_density',
      'dialogue_ratio',
      'description_ratio',
      'psychological_ratio',
      'character_count',
      'new_setting_density',
      'new_character_density',
      'foreshadow_count',
      'foreshadow_payoff_rate',
      'causal_density',
      'event_progression_speed',
      'consecutive_flat_chapters'
    ];

    assert.equal(Object.keys(GENRE_METRIC_DEFINITIONS).length, 18, '必须严格覆盖 18 个指标');
    for (const key of requiredKeys) {
      assert.ok(GENRE_METRIC_DEFINITIONS[key], `必须包含指标: ${key}`);
      const def = GENRE_METRIC_DEFINITIONS[key];
      assert.ok(def.displayName, `${key} 缺少 displayName`);
      assert.ok(def.detectionMode, `${key} 缺少 detectionMode`);
      assert.ok(def.contextualNotes, `${key} 缺少 contextualNotes`);
    }
  });

  await t.test('七维统计分布计算工具：P25, P50, P75, 均值, 方差, IQR 与异常边界', () => {
    const sampleNumbers = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const stats = computeDistributionStats(sampleNumbers);

    assert.equal(stats.sample_count, 10);
    assert.equal(stats.mean, 55);
    assert.equal(stats.p50, 55, '中位数应为 55');
    assert.equal(stats.p25, 32.5);
    assert.equal(stats.p75, 77.5);
    assert.equal(stats.iqr, 45);
    assert.ok(stats.std > 0, '标准差应大于 0');
    assert.ok(stats.outlierUpper > stats.p75, '异常上限应大于 P75');
  });

  await t.test('成功加载 genre-quality-baselines.json 且各题材均包含全部 18 项指标', () => {
    const db = loadGenreQualityBaselines();
    assert.ok(db, '基准数据库应成功加载');
    assert.ok(db.totalGenresCovered >= 8, '至少应覆盖 8 大叙事母类');

    const xuanhuan = getGenreBaseline('玄幻修真');
    assert.ok(xuanhuan, '必须包含玄幻修真基准');
    assert.ok(xuanhuan.metrics, '玄幻修真必须包含 metrics');

    for (const metricKey of Object.keys(GENRE_METRIC_DEFINITIONS)) {
      const mRecord = xuanhuan.metrics[metricKey];
      assert.ok(mRecord, `玄幻修真基线必须包含指标: ${metricKey}`);
      assert.ok(typeof mRecord.p25 === 'number', `${metricKey} 必须有 p25`);
      assert.ok(typeof mRecord.p50 === 'number', `${metricKey} 必须有 p50 (中位数)`);
      assert.ok(typeof mRecord.p75 === 'number', `${metricKey} 必须有 p75`);
      assert.ok(typeof mRecord.mean === 'number', `${metricKey} 必须有 mean`);
      assert.ok(typeof mRecord.std === 'number', `${metricKey} 必须有 std`);
      assert.ok(Array.isArray(mRecord.outlierBounds), `${metricKey} 必须有 outlierBounds`);
      assert.ok(typeof mRecord.sample_count === 'number', `${metricKey} 必须有 sample_count`);
      assert.ok(typeof mRecord.confidence === 'number', `${metricKey} 必须有 confidence`);
      assert.ok(typeof mRecord.contextualNotes === 'string', `${metricKey} 必须有 contextualNotes`);
    }
  });
});

test('评测检测模式分流：auto / hybrid / llm 三级清晰归类', async t => {
  await t.test('三级模式分类数量与原则契约校验', () => {
    const classification = getDetectionModeClassification();
    assert.equal(classification.auto.length, 8, '适合自动检测指标应为 8 项');
    assert.equal(classification.hybrid.length, 6, '适合联合判断指标应为 6 项');
    assert.equal(classification.llm.length, 4, '必须由 LLM 判断指标应为 4 项');

    // 校验特定指标归类
    const autoKeys = classification.auto.map(m => m.key);
    assert.ok(autoKeys.includes('chapter_length'), '章节长度应为 auto');
    assert.ok(autoKeys.includes('dialogue_ratio'), '对话比例应为 auto');
    assert.ok(autoKeys.includes('psychological_ratio'), '心理描写应为 auto');

    const hybridKeys = classification.hybrid.map(m => m.key);
    assert.ok(hybridKeys.includes('conflict_density'), '冲突密度应为 hybrid');
    assert.ok(hybridKeys.includes('hook_density'), '钩子密度应为 hybrid');
    assert.ok(hybridKeys.includes('shuangdian_density'), '爽点密度应为 hybrid');

    const llmKeys = classification.llm.map(m => m.key);
    assert.ok(llmKeys.includes('foreshadow_count'), '伏笔数量应为 llm');
    assert.ok(llmKeys.includes('foreshadow_payoff_rate'), '伏笔回收率应为 llm');
    assert.ok(llmKeys.includes('causal_density'), '因果密度应为 llm');
    assert.ok(llmKeys.includes('event_progression_speed'), '事件推进速度应为 llm');
  });
});

test('题材特异性差异校验：拒绝单一评分，都市 vs 玄幻 vs 言情显著分化', async t => {
  await t.test('不同题材经验分布体现真实文类差异', () => {
    const xuanhuan = getGenreBaseline('玄幻修真');
    const urban = getGenreBaseline('都市高武');

    assert.ok(xuanhuan && urban, '母类基线应全部就绪');

    // 对白比例：都市小说对话频率与人际博弈明显高于玄幻修真
    assert.ok(
      urban.metrics.dialogue_ratio.mean >= xuanhuan.metrics.dialogue_ratio.mean,
      `都市高武对白均值 (${urban.metrics.dialogue_ratio.mean}) 应高于玄幻修真 (${xuanhuan.metrics.dialogue_ratio.mean})`
    );

    // 章节长度：玄幻长篇均值显著长于都市紧凑篇幅
    assert.ok(
      xuanhuan.metrics.chapter_length.mean >= urban.metrics.chapter_length.mean,
      `玄幻章节均值 (${xuanhuan.metrics.chapter_length.mean}) 应大于等于都市 (${urban.metrics.chapter_length.mean})`
    );
  });
});

test('统计经验分布 ≠ 质量真理：情境化宽容度动态释义', async t => {
  await t.test('战后休整情境：低冲突密度不被误判为平淡缺陷', () => {
    const result = evaluateWithContext('conflict_density', 0.10, '玄幻修真', {
      isDowntime: true,
      sceneType: 'settlement'
    });

    assert.equal(result.conforming, true, '休整章应判定合规');
    assert.equal(result.contextApplied, true, '应激活情境化规则');
    assert.equal(result.status, 'justified_by_context');
    assert.match(result.explanation, /战后休整|呼吸回落/);
  });

  await t.test('闭关悟道情境：零对白或单人出场不被误判为对话缺失', () => {
    const result = evaluateWithContext('dialogue_ratio', 0.0, '玄幻修真', {
      isBreakthrough: true,
      isSolo: true
    });

    assert.equal(result.conforming, true, '悟道章应判定合规');
    assert.equal(result.contextApplied, true, '应激活情境化规则');
    assert.equal(result.status, 'justified_by_context');
    assert.match(result.explanation, /闭关修炼|单人探索/);
  });

  await t.test('大决战高潮情境：超长篇幅不被误判为注水超标', () => {
    const result = evaluateWithContext('chapter_length', 6500, '玄幻修真', {
      isClimax: true,
      isArcFinal: true
    });

    assert.equal(result.conforming, true, '决战高潮章应判定合规');
    assert.equal(result.contextApplied, true, '应激活情境化规则');
    assert.equal(result.status, 'justified_by_context');
    assert.match(result.explanation, /卷终生死决战|高潮/);
  });
});

test('未知或缺失题材不回退到玄幻或任意首项基线', () => {
  assert.equal(getGenreBaseline('不存在的题材'), null);
  assert.equal(getGenreBaseline(''), null);
  assert.equal(getGenreBaseline(undefined), null);
});
