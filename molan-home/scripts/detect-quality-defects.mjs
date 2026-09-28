#!/usr/bin/env node
'use strict';

/**
 * detect-quality-defects.mjs
 * ---------------------------------------------------------------------------
 * 小说质量缺陷检测器运行脚本
 * ---------------------------------------------------------------------------
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const {
  HISTORICAL_SAMPLE_ID,
  loadDefectDetectionInputs,
  detectNovelQualityDefects,
  generateDefectReportMarkdown
} = require('../lib/defect-detector');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

async function main() {
  console.log('=== [小说质量缺陷检测器] 启动 ===\n');

  const sampleId = option('--sample-id');
  if (sampleId !== HISTORICAL_SAMPLE_ID) {
    const blocked = detectNovelQualityDefects({ sample_id: sampleId });
    console.log(JSON.stringify(blocked, null, 2));
    return;
  }

  // 1. 自动载入资产
  console.log('[1/4] 正在加载历史样例资产与生成记录...');
  const inputs = loadDefectDetectionInputs({ sampleId });
  console.log(`  ✓ 目标小说: 《${inputs.generatedProfile?.metadata?.value?.title || '月圆夜前的布局'}》`);
  console.log(`  ✓ 生成模型: ${inputs.writer.model} (技能: ${inputs.writer.skill})`);
  console.log(`  ✓ 历史校验状态: ${inputs.historicalValidation.status}`);

  // 2. 执行缺陷检测与分类
  console.log('\n[2/4] 执行多维缺陷扫描与反向实质损害证明 (A-E 分类)...');
  const defectResult = detectNovelQualityDefects(inputs);
  console.log(`  ✓ 检出实质缺陷: ${defectResult.totalDefectsDetected} 项 (A类: ${defectResult.summaryBySeverity.A}, B类: ${defectResult.summaryBySeverity.B}, C类: ${defectResult.summaryBySeverity.C}, D类: ${defectResult.summaryBySeverity.D})`);
  console.log(`  ✓ 识别保护 E 类非缺陷 (风格差异): ${defectResult.nonDefectCount} 项`);

  // 3. 持久化输出
  const requestedOutputDir = option('--out-dir');
  if (!requestedOutputDir) {
    console.log('\n[3/4] 未提供 --out-dir；结果只输出到控制台，不写入文件。');
    console.log(JSON.stringify(defectResult, null, 2));
    return;
  }
  console.log('\n[3/4] 正在将历史样例报告写入新目录 (JSON & Markdown)...');
  const outputDir = path.resolve(requestedOutputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const jsonPath = path.join(outputDir, 'defects.json');
  fs.writeFileSync(jsonPath, JSON.stringify(defectResult, null, 2), { encoding: 'utf8', flag: 'wx' });
  console.log(`  ✓ 结构化数据保存至: ${jsonPath}`);

  const mdReport = generateDefectReportMarkdown(defectResult);
  const mdPath = path.join(outputDir, 'defects.md');
  fs.writeFileSync(mdPath, mdReport, { encoding: 'utf8', flag: 'wx' });
  console.log(`  ✓ 缺陷白皮书保存至: ${mdPath}`);

  // 4. 控制台呈报排序概览
  console.log('\n========================================================================================');
  console.log('📋 【缺陷综合优先级排序表 (严重度 × 影响范围 × 修复价值)】');
  console.log('========================================================================================');
  console.log('| 排名 | 缺陷ID        | 严重度等级        | 分类                 | 综合得分 | 症状概要');
  console.log('| ---- | ------------- | ----------------- | -------------------- | -------- | ------------------------------------------------');

  defectResult.defects.forEach((d, idx) => {
    const rf = d.ranking_factors;
    const scoreStr = d.severity === 'E' ? '保真免修' : `${rf.severity_score}×${rf.scope_score}×${rf.fix_value_score}=${String(rf.priority_score).padEnd(2)}`;
    console.log(`| ${String(idx + 1).padStart(4)} | ${d.defect_id.padEnd(13)} | ${d.severity_label.padEnd(17)} | ${d.category.padEnd(20)} | ${scoreStr.padEnd(8)} | ${d.symptom.slice(0, 32)}...`);
  });

  console.log('\n========================================================================================');
  console.log('🛡️ 【E 类非缺陷（风格差异）特别保护名单（严禁修复！）】');
  console.log('========================================================================================');
  defectResult.defects.filter(d => d.severity === 'E').forEach((nd, i) => {
    console.log(`  ${i + 1}. [${nd.defect_id}] ${nd.category}: ${nd.symptom}`);
    console.log(`     论证理由: ${nd.reader_impact.detailed_analysis}\n`);
  });

  console.log('✅ 缺陷检测与优先级排期全部完成！正文未直接修改，可直接指导后续优化决策。');
}

main().catch(err => {
  console.error('执行异常:', err);
  process.exit(1);
});
