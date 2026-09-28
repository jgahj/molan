'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COMPARISON_DIMENSIONS,
  loadBlindReviewInputs,
  compareNovelQualityBlind,
  generateComparisonReportMarkdown
} = require('../lib/blind-review-comparator');

test('盲测评审引擎：自动加载资产并校验 25 维完整性', () => {
  const inputs = loadBlindReviewInputs();
  assert.ok(inputs.generatedProfile, '应加载 GeneratedNovelProfile');
  assert.ok(inputs.benchmarkProfile, '应加载 BenchmarkProfile');

  assert.equal(COMPARISON_DIMENSIONS.length, 25, '必须严格定义 25 个比较维度');

  const report = compareNovelQualityBlind(
    inputs.generatedProfile,
    inputs.benchmarkProfile,
    inputs.genreBaselines
  );

  assert.equal(report.dimensions.length, 25, '评测产物必须全量覆盖 25 个维度');

  // 验证每个维度的键值与名称映射
  COMPARISON_DIMENSIONS.forEach((expectedDim, idx) => {
    const actualDim = report.dimensions[idx];
    assert.equal(actualDim.key, expectedDim.key);
    assert.equal(actualDim.dimension, expectedDim.name);
  });
});

test('盲测评审引擎：严格三层逻辑隔离 (事实/判断/推测) 断言', () => {
  const inputs = loadBlindReviewInputs();
  const report = compareNovelQualityBlind(
    inputs.generatedProfile,
    inputs.benchmarkProfile,
    inputs.genreBaselines
  );

  for (const d of report.dimensions) {
    // 1. 事实差异 (Fact)
    assert.ok(d.gap.fact, `维度【${d.dimension}】必须提供事实差异说明`);
    assert.ok(d.gap.fact.length >= 10, `维度【${d.dimension}】事实说明需充分详实`);

    // 2. 判断 (Judgement)
    assert.ok(d.gap.judgement, `维度【${d.dimension}】必须提供专业判断`);
    assert.ok(d.gap.judgement.length >= 10, `维度【${d.dimension}】判断需充分详实`);

    // 3. 推测 (Speculation)
    assert.ok(d.gap.speculation, `维度【${d.dimension}】必须提供机理推测假说`);
    assert.ok(d.gap.speculation.length >= 10, `维度【${d.dimension}】推测需充分详实`);

    // 严重度与置信度
    assert.ok(['advantage', 'neutral', 'minor', 'moderate', 'major'].includes(d.severity));
    assert.ok(typeof d.confidence === 'number' && d.confidence >= 0.8 && d.confidence <= 1.0);

    // 证据
    assert.ok(Array.isArray(d.evidence) && d.evidence.length >= 1, `维度【${d.dimension}】必须有证据引用`);
    assert.ok(d.evidence.every(e => e.quote && e.source));
  }
});

test('盲测评审引擎：客观真实发掘生成小说优于 Benchmark 的关键项', () => {
  const inputs = loadBlindReviewInputs();
  const report = compareNovelQualityBlind(
    inputs.generatedProfile,
    inputs.benchmarkProfile,
    inputs.genreBaselines
  );

  assert.ok(Array.isArray(report.generatedNovelAdvantages), '必须输出生成小说优势列表');
  assert.ok(report.generatedNovelAdvantages.length >= 5, '应至少识别出 5 项生成小说的客观优势');

  const advantageKeys = report.generatedNovelAdvantages.map(a => a.dimension);
  // 检验预期具备明显现代快节奏优势的维度
  assert.ok(advantageKeys.includes('对话'), '生成小说的对白机锋与现代感应识别为优势');
  assert.ok(advantageKeys.includes('钩子'), '生成小说的章末点击钩子应识别为优势');
  assert.ok(advantageKeys.includes('空洞内容'), '生成小说的零注水高净值应识别为优势');
  assert.ok(advantageKeys.includes('场景有效性'), '生成小说的场景饱和度应识别为优势');

  for (const adv of report.generatedNovelAdvantages) {
    assert.ok(adv.concreteFact, '优势必须有具体事实支撑');
    assert.ok(adv.advantageSummary, '优势必须有专业判断');
    assert.ok(adv.evidenceSnippet, '优势必须有文本片段佐证');
  }
});

test('盲测评审引擎：Markdown 综合报告生成与结构完整性', () => {
  const inputs = loadBlindReviewInputs();
  const report = compareNovelQualityBlind(
    inputs.generatedProfile,
    inputs.benchmarkProfile,
    inputs.genreBaselines
  );

  const markdown = generateComparisonReportMarkdown(report);
  assert.ok(markdown.includes('经典名家 Benchmark 与 AI 生成小说双向质量盲测评审报告'));
  assert.ok(markdown.includes('特别呈报：生成小说（B）实际上优于 Benchmark（A）的地方'));
  assert.ok(markdown.includes('25 维盲测评审逐项详录'));
  assert.ok(markdown.includes('评审核心摘要总结'));

  // 必须包含全部 25 维
  COMPARISON_DIMENSIONS.forEach(d => {
    assert.ok(markdown.includes(d.name), `Markdown 报告中必须包含维度【${d.name}】`);
  });
});
