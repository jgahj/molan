'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const {
  HISTORICAL_SAMPLE_ID,
  ROOT_CAUSE_CATEGORIES,
  loadRootCauseInputs,
  analyzeRootCauses,
  generateRootCauseReportMarkdown
} = require('../lib/root-cause-analyzer.js');

test('根因分析器：全量加载生成资产与系统探针', () => {
  const inputs = loadRootCauseInputs({ sampleId: HISTORICAL_SAMPLE_ID });
  assert.ok(inputs.defectRegistry, '应成功获取缺陷注册表');
  assert.ok(Array.isArray(inputs.defectRegistry.defects), '缺陷清单应为数组');
  assert.ok(inputs.generationRecord, '应成功加载生成记录');
  assert.ok(inputs.systemInspection, '应具备系统模块探针');
  assert.equal(typeof inputs.systemInspection.hasMemorySystem, 'boolean');
  assert.equal(typeof inputs.systemInspection.hasCharacterMaterial, 'boolean');
  assert.equal(typeof inputs.systemInspection.hasGenreNarrativeAudit, 'boolean');
});

test('根因分析器：6 层因果链深度追踪完整性断言', () => {
  const inputs = loadRootCauseInputs({ sampleId: HISTORICAL_SAMPLE_ID });
  const report = analyzeRootCauses(inputs);

  assert.ok(report.rootCauses.length >= 6, '实质缺陷归因分析数应不少于 6 项');

  for (const rc of report.rootCauses) {
    assert.ok(rc.defect_id, '必须有 defect_id');
    assert.ok(rc.symptom, '必须有 symptom');
    assert.ok(rc.direct_cause, '必须有 direct_cause');
    assert.ok(rc.root_cause, '必须有 root_cause');
    assert.ok(rc.cause_chain, '必须有 cause_chain 对象');

    // 严密断言 6 层追踪链逐层存在且不为空
    assert.ok(rc.cause_chain.phenomenon && rc.cause_chain.phenomenon.length > 5, '必须有现象 (Phenomenon)');
    assert.ok(rc.cause_chain.direct_cause && rc.cause_chain.direct_cause.length > 5, '必须有直接原因 (Direct Cause)');
    assert.ok(rc.cause_chain.system_cause && rc.cause_chain.system_cause.length > 5, '必须有系统原因 (System Cause)');
    assert.ok(rc.cause_chain.process_cause && rc.cause_chain.process_cause.length > 5, '必须有流程原因 (Process Cause)');
    assert.ok(rc.cause_chain.data_cause && rc.cause_chain.data_cause.length > 5, '必须有数据原因 (Data Cause)');
    assert.ok(rc.cause_chain.architectural_cause && rc.cause_chain.architectural_cause.length > 5, '必须有架构原因 (Architectural Cause)');

    assert.ok(Array.isArray(rc.affected_module) && rc.affected_module.length > 0, '必须明确受影响模块');
    assert.ok(rc.evidence && rc.evidence.length > 5, '必须有代码或数据引证');
    assert.ok(rc.confidence >= 0.8 && rc.confidence <= 1.0, '置信度必须在 0.8~1.0 之间');
    assert.ok(rc.fixability, '必须有修复可行性定级');
    assert.ok(rc.recommended_fix_type, '必须有推荐修复类型');
  }
});

test('根因分析器：17 类标准根因分类体系合规断言', () => {
  const inputs = loadRootCauseInputs({ sampleId: HISTORICAL_SAMPLE_ID });
  const report = analyzeRootCauses(inputs);
  const validCategories = new Set(Object.values(ROOT_CAUSE_CATEGORIES));

  for (const rc of report.rootCauses) {
    assert.ok(Array.isArray(rc.root_cause_categories) && rc.root_cause_categories.length > 0);
    for (const cat of rc.root_cause_categories) {
      assert.ok(validCategories.has(cat), `分类 "${cat}" 必须符合 17 类标准根因体系`);
    }
  }

  // 必须覆盖架构、模块、流程等多核心分类
  assert.ok(report.categoryDistribution[ROOT_CAUSE_CATEGORIES.SYSTEM_ARCHITECTURE] >= 3, '系统架构原因应作为高频底层根因');
  assert.ok(report.categoryDistribution[ROOT_CAUSE_CATEGORIES.SCENE_PLANNER] >= 1, '应识别出 Scene Planner 缺失');
  assert.ok(report.categoryDistribution[ROOT_CAUSE_CATEGORIES.CHARACTER] >= 1, '应识别出 Character 人设立体度机制未接入');
});

test('根因分析器：核心终局裁决（内容问题 vs 系统问题）断言', () => {
  const inputs = loadRootCauseInputs({ sampleId: HISTORICAL_SAMPLE_ID });
  const report = analyzeRootCauses(inputs);

  // 断言生成系统导致的问题占比极高（全部 6 项实质缺陷均为系统/管线层原因）
  assert.equal(report.meta.systemicAttributionRatio, 1.0, '当前所有实质缺陷均根植于生成系统');
  assert.equal(report.overallVerdict.shouldModifySystem, true, '终局裁决必须要求修改生成系统');
  assert.equal(report.overallVerdict.shouldModifyNovel, false, '终局裁决不建议单次修改小说');
  assert.ok(report.overallVerdict.executive_summary.includes('生成系统架构'), '摘要必须包含架构级论证');

  for (const rc of report.rootCauses) {
    assert.equal(rc.problem_attribution.classification, '生成系统导致的问题');
    assert.equal(rc.problem_attribution.final_verdict, '修改生成系统');
    assert.ok(rc.problem_attribution.verdict_rationale.length > 20, '必须包含详尽的裁决论证理由');
  }
});

test('根因分析器：E 类风格差异优势系统源起断言', () => {
  const inputs = loadRootCauseInputs({ sampleId: HISTORICAL_SAMPLE_ID });
  const report = analyzeRootCauses(inputs);

  assert.equal(report.stylisticOrigins.length, 4, '必须包含 4 项 E 类非缺陷的系统源起分析');
  for (const st of report.stylisticOrigins) {
    assert.ok(st.defect_id.startsWith('NON-DEF-'));
    assert.ok(st.system_origin.length > 10, '必须阐明系统生成源起');
    assert.ok(st.action_verdict.includes('严禁“修复”') || st.action_verdict.includes('严禁修复'));
  }
});

test('根因分析器：Markdown 格式白皮书排版与渲染断言', () => {
  const inputs = loadRootCauseInputs({ sampleId: HISTORICAL_SAMPLE_ID });
  const report = analyzeRootCauses(inputs);
  const markdown = generateRootCauseReportMarkdown(report);

  assert.ok(markdown.includes('# 《月圆夜前的布局》小说生成系统根因分析白皮书'));
  assert.ok(markdown.includes('## 📊 一、 根因分类分布统计'));
  assert.ok(markdown.includes('## ⚖️ 二、 核心终局裁决：修改小说 vs 修改生成系统'));
  assert.ok(markdown.includes('## 🔍 三、 逐项缺陷 6 层深度根因追踪详录'));
  assert.ok(markdown.includes('```mermaid'), '必须包含 Mermaid 因果链图表');
  assert.ok(markdown.includes('1. **现象 (Phenomenon)**:'));
  assert.ok(markdown.includes('6. **架构原因 (Architectural Cause)**:'));
  assert.ok(markdown.includes('## 🛡️ 四、 E 类“非缺陷”（风格差异优势）系统生成源起剖析'));
});
