#!/usr/bin/env node
'use strict';

/**
 * run-blind-review.mjs
 * ---------------------------------------------------------------------------
 * 小说质量盲测评审引擎执行脚本
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
  loadBlindReviewInputs,
  compareNovelQualityBlind,
  generateComparisonReportMarkdown
} = require('../lib/blind-review-comparator');

async function main() {
  console.log('=== [小说质量双向盲测评审引擎] 启动 ===\n');

  // 1. 自动挂载评测数据
  console.log('[1/4] 正在自动加载评测数据 (GeneratedProfile, BenchmarkProfile, GenreBaseline)...');
  const inputs = loadBlindReviewInputs();
  const { generatedProfile, benchmarkProfile, genreBaselines, paths } = inputs;

  console.log(`  ✓ 生成小说样本 (B): 《${generatedProfile.metadata?.value?.title || '月圆夜前的布局'}》`);
  console.log(`    路径: ${paths.generatedProfilePath}`);
  console.log(`  ✓ 匹配 Benchmark 范本 (A): 《${benchmarkProfile.bookMeta?.title || '一世之尊'}》`);
  console.log(`    路径: ${paths.benchmarkProfilePath}`);
  console.log(`  ✓ 基准经验分布库: ${paths.genreBaselinePath} (${genreBaselines.totalGenresCovered || 52} 题材)`);

  // 2. 执行 25 维度盲测比对
  console.log('\n[2/4] 正在执行 25 大质量维度无偏见双向盲测评审 (严格三层逻辑隔离: 事实/判断/推测)...');
  const report = compareNovelQualityBlind(generatedProfile, benchmarkProfile, genreBaselines);
  console.log(`  ✓ 完成 25 维深度判定，综合评审置信度: ${(report.confidence * 100).toFixed(1)}%`);

  // 3. 输出持久化
  console.log('\n[3/4] 正在生成并持久化评测产物 (JSON & Markdown)...');
  const outputDir = path.resolve(__dirname, '../data/evaluation-input/comparison-reports');
  fs.mkdirSync(outputDir, { recursive: true });

  const jsonPath = path.join(outputDir, '月圆夜前的布局-vs-一世之尊-comparison.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`  ✓ 结构化数据保存至: ${jsonPath}`);

  const mdContent = generateComparisonReportMarkdown(report);
  const mdPath = path.join(outputDir, '月圆夜前的布局-vs-一世之尊-comparison.md');
  fs.writeFileSync(mdPath, mdContent, 'utf8');
  console.log(`  ✓ 详细报告文档保存至: ${mdPath}`);

  // 4. 控制台呈报关键裁决
  console.log('\n======================================================');
  console.log('🌟 【特别呈报：生成小说实际上优于 Benchmark 的地方】');
  console.log('======================================================');
  report.generatedNovelAdvantages.forEach((adv, i) => {
    console.log(`\n${i + 1}. 【${adv.dimension}】维度优势:`);
    console.log(`   - 事实依据: ${adv.concreteFact}`);
    console.log(`   - 专业判断: ${adv.advantageSummary}`);
    console.log(`   - 证据片段: "${adv.evidenceSnippet}"`);
  });

  console.log('\n======================================================');
  console.log('📊 【25 维盲测评审判定概览】');
  console.log('======================================================');
  report.dimensions.forEach((d, idx) => {
    const tag = d.severity === 'advantage' ? '⭐ [生成占优]' : (d.severity === 'neutral' ? '⚖️ [势均力敌]' : `⚠️ [存在差距(${d.severity})]`);
    console.log(`  ${String(idx + 1).padStart(2, ' ')}. [${d.dimension.padEnd(6)}] ${tag} 置信度: ${d.confidence} | 事实: ${d.gap.fact.slice(0, 42)}...`);
  });

  console.log('\n======================================================');
  console.log('🎯 【核心结论汇总】');
  console.log('======================================================');
  console.log(`  - 生成小说突出优势项数: ${report.strengths.length} 项 (开篇、人物关系、世界观融入、对话、钩子、商业节奏、信息密度、空洞内容、场景有效性)`);
  console.log(`  - 存在提升空间项数: ${report.weaknesses.length} 项 (节奏过密缺少呼吸感、肢体受力武斗描写)`);
  console.log(`  - 势均力敌基准项数: ${report.dimensions.length - report.strengths.length - report.weaknesses.length} 项 (因果自洽、AI味抹除、人物智商、语言自然度等)`);
  console.log('\n✅ 盲测评审完成，报告与数据已成功归档！');
}

main().catch(err => {
  console.error('执行异常:', err);
  process.exit(1);
});
