'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  HISTORICAL_SAMPLE_ID,
  loadDefectDetectionInputs,
  detectNovelQualityDefects,
  rankDefects,
  generateDefectReportMarkdown
} = require('../lib/defect-detector');

test('缺陷检测器：读取样例资产但不加载 Benchmark 比较数据', () => {
  const inputs = loadDefectDetectionInputs({ sampleId: HISTORICAL_SAMPLE_ID });
  assert.ok(inputs.generatedProfile, '应成功加载 GeneratedNovelProfile');
  assert.equal(inputs.comparisonReport, null);
  assert.equal(inputs.genreBaselines, null);
  assert.equal(inputs.benchmarkProfile, null);
  assert.ok(inputs.generationProcess.generationLog, '应成功加载 generationLog');
  assert.ok(inputs.storyBible.characters.length >= 4, '应成功加载 Story Bible 角色');
  assert.ok(inputs.planner.nodesCount >= 5, '应成功加载 Planner 节点');
  assert.ok(inputs.writer.model, '应成功加载 Writer 模型');
  assert.equal(inputs.historicalValidation.status, 'passed', '应成功加载历史校验记录');
});

test('缺陷检测器：12项结构化全属性契约完整性断言', () => {
  const inputs = loadDefectDetectionInputs({ sampleId: HISTORICAL_SAMPLE_ID });
  const result = detectNovelQualityDefects(inputs);

  assert.ok(Array.isArray(result.defects), 'defects 必须为数组');
  assert.ok(result.defects.length >= 8, '应至少检出实质缺陷与非缺陷项共8项以上');

  const REQUIRED_FIELDS = [
    'defect_id',
    'category',
    'severity',
    'severity_label',
    'location',
    'symptom',
    'evidence',
    'expected_behavior',
    'actual_behavior',
    'benchmark_difference',
    'genre_baseline_difference',
    'reader_impact',
    'ranking_factors',
    'confidence'
  ];

  for (const d of result.defects) {
    for (const f of REQUIRED_FIELDS) {
      assert.ok(d[f] !== undefined, `缺陷【${d.defect_id}】缺少必选字段【${f}】`);
    }

    // 分级合法性
    assert.ok(['A', 'B', 'C', 'D', 'E'].includes(d.severity), `缺陷等级必须为 A-E: 实际为 ${d.severity}`);

    // location 结构完整性
    assert.ok(d.location.chapter && d.location.scene && Array.isArray(d.location.paragraph_range));
    assert.ok(d.location.snippet, `缺陷【${d.defect_id}】需提供位置文本切片`);

    // reader_impact 结构完整性
    assert.ok(typeof d.reader_impact.has_impact === 'boolean');
    assert.ok(Array.isArray(d.reader_impact.impact_types) && d.reader_impact.impact_types.length >= 1);
    assert.ok(d.reader_impact.detailed_analysis && d.reader_impact.detailed_analysis.length >= 20);

    // confidence
    assert.ok(d.confidence >= 0.8 && d.confidence <= 1.0);

    // ranking_factors
    assert.ok(typeof d.ranking_factors.priority_score === 'number');
  }
});

test('缺陷检测器：严格反向实质证明与 E 类非缺陷保护机制', () => {
  const inputs = loadDefectDetectionInputs({ sampleId: HISTORICAL_SAMPLE_ID });
  const result = detectNovelQualityDefects(inputs);

  const nonDefects = result.defects.filter(d => d.severity === 'E');
  assert.ok(nonDefects.length >= 3, '必须显式识别并保护至少3项 E 类非缺陷（风格差异）');

  const nonDefectIds = nonDefects.map(d => d.defect_id);
  assert.ok(nonDefectIds.includes('NON-DEF-001'), '对白占比高应被明确归入 E 类非缺陷保真');
  assert.ok(nonDefectIds.includes('NON-DEF-002'), '开篇即进动作冲突应被归入 E 类非缺陷保真');
  assert.ok(nonDefectIds.includes('NON-DEF-003'), '零注水高信息压缩比应被归入 E 类非缺陷保真');

  for (const nd of nonDefects) {
    assert.equal(nd.reader_impact.has_impact, false, `E类非缺陷【${nd.defect_id}】不应判定为负面影响`);
    assert.ok(nd.reader_impact.detailed_analysis.includes('严禁修复'), `E类非缺陷【${nd.defect_id}】必须有明确的严禁修复免修警示`);
    assert.equal(nd.ranking_factors.priority_score, 0, 'E类非缺陷综合排序分值必须为0');
  }

  const realDefects = result.defects.filter(d => d.severity !== 'E');
  for (const rd of realDefects) {
    if (rd.defect_id !== 'DEF-CONSIST-001') {
      assert.equal(rd.reader_impact.has_impact, true, `实质缺陷【${rd.defect_id}】必须证明实际负面影响`);
    }
  }
});

test('缺陷检测器：综合优先级排序 (严重度 × 影响范围 × 修复价值) 降序断言', () => {
  const inputs = loadDefectDetectionInputs({ sampleId: HISTORICAL_SAMPLE_ID });
  const result = detectNovelQualityDefects(inputs);

  const defects = result.defects;
  for (let i = 1; i < defects.length; i++) {
    const prev = defects[i - 1].ranking_factors.priority_score;
    const curr = defects[i].ranking_factors.priority_score;
    assert.ok(prev >= curr, `排序必须降序：prev(${prev}) 应 >= curr(${curr})`);
  }

  // 最高优先级应为管线可靠性缺陷
  assert.equal(defects[0].defect_id, 'DEF-PIPE-001', '最高优先级应为管线流式计费解析与重试缺陷');
  assert.equal(defects[0].ranking_factors.priority_score, 80);
});

test('缺陷检测器：纯审不改原则（正文绝对未被直接修改）', () => {
  const novelPath = path.resolve(__dirname, '../generated/月圆夜前的布局-20260910/月圆夜前的布局-定稿.md');
  const initialContent = fs.readFileSync(novelPath, 'utf8');
  const initialHash = crypto.createHash('sha256').update(initialContent).digest('hex');

  // 触发检测
  const inputs = loadDefectDetectionInputs({ sampleId: HISTORICAL_SAMPLE_ID });
  detectNovelQualityDefects(inputs);

  const postContent = fs.readFileSync(novelPath, 'utf8');
  const postHash = crypto.createHash('sha256').update(postContent).digest('hex');

  assert.equal(postHash, initialHash, '执行缺陷检测绝对不能直接修改小说正文');
});

test('缺陷检测器：Markdown 白皮书报告生成与完整性', () => {
  const inputs = loadDefectDetectionInputs({ sampleId: HISTORICAL_SAMPLE_ID });
  const result = detectNovelQualityDefects(inputs);
  const md = generateDefectReportMarkdown(result);

  assert.ok(md.includes('小说质量缺陷检测与结构化缺陷白皮书'));
  assert.ok(md.includes('缺陷总览与综合优先级排序表'));
  assert.ok(md.includes('结构化缺陷深度详录'));
  assert.ok(md.includes('核心修复建议与策略指导（只排不改）'));
  assert.ok(md.includes('DEF-PIPE-001'));
  assert.ok(md.includes('NON-DEF-001'));
});
