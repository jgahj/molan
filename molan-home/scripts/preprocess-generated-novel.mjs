#!/usr/bin/env node
'use strict';

/**
 * preprocess-generated-novel.mjs
 * ---------------------------------------------------------------------------
 * 运行 AI生成小说评测预处理引擎，对最新生成的作品执行深度解构与 Benchmark 同构画像生成。
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
  scanGeneratedNovels,
  generateGeneratedNovelProfile,
  validateGeneratedNovelProfile
} = require('../lib/generated-novel-preprocessor');

async function main() {
  console.log('=== [AI生成小说评测预处理引擎] 启动 ===\n');

  // 1. 自动扫描生成资源
  const generatedDir = path.resolve(__dirname, '../generated');
  console.log(`[1/4] 自动扫描生成目录: ${generatedDir}`);
  const packages = scanGeneratedNovels(generatedDir);

  if (packages.length === 0) {
    console.error('❌ 未在 generated/ 目录下找到任何有效的生成套件');
    process.exit(1);
  }

  console.log(`✓ 发现 ${packages.length} 个生成套件:`);
  packages.forEach((p, idx) => {
    console.log(`  ${idx + 1}. [${p.packageId}] 《${p.title}》 模型: ${p.generationParameters.requestedModel} 请求ID: ${p.generationParameters.requestId}`);
  });

  // 选取最新生成的作品（月圆夜前的布局-20260910）
  const targetPkg = packages[0];
  console.log(`\n[2/4] 选定处理目标: 《${targetPkg.title}》 (${targetPkg.packageId})`);
  console.log(`  - 正文字数: ${targetPkg.novelText.length} 字符`);
  console.log(`  - 提示词指纹: ${targetPkg.versions.prompt_version}`);
  console.log(`  - 模型版本: ${targetPkg.versions.model_version}`);
  console.log(`  - 故事圣经版本: ${targetPkg.versions.story_bible_version}`);
  console.log(`  - 优化策略版本: ${targetPkg.versions.optimizer_version}`);
  console.log(`  - 识别到核心角色: ${targetPkg.characters.map(c => c.name).join('、')}`);
  console.log(`  - 识别到关键道具: ${targetPkg.keyProps.join('、')}`);
  console.log(`  - 剧情节点数: ${targetPkg.outline.length} 阶段`);

  // 2. 生成同构 GeneratedNovelProfile 与 七级粒度分析树
  console.log('\n[3/4] 执行同构特征工程与七级粒度解构 (全书->卷->篇章->章节->场景->段落->句子)...');
  const profile = generateGeneratedNovelProfile(targetPkg, {
    title: targetPkg.title,
    author: `AI (${targetPkg.versions.model_version})`,
    genre: '玄幻',
    subgenre: '东方玄幻'
  });

  // 3. 契约校验
  const val = validateGeneratedNovelProfile(profile);
  if (!val.valid) {
    console.error(`❌ Profile 校验失败: ${val.error}`);
    process.exit(1);
  }
  console.log('✓ GeneratedNovelProfile 23 维度完整性与契约校验通过！');

  // 4. 持久化输出
  const outputDir = path.resolve(__dirname, '../data/evaluation-input/generated-novel-profiles');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, `${targetPkg.title}-profile.json`);
  fs.writeFileSync(outputFile, JSON.stringify(profile, null, 2), 'utf8');
  console.log(`\n[4/4] 成功持久化画像至: ${outputFile}`);

  // 5. 打印七级分析粒度与核心维度摘要
  const summary = profile.granularity_summary;
  console.log('\n=== 七级分析粒度解构摘要 ===');
  console.log(`  1. 全书 (Book): 1 部 (${summary.totalChars} 字符)`);
  console.log(`  2. 卷 (Volume): ${summary.volumes} 卷`);
  console.log(`  3. 篇章 (Arc): ${summary.arcs} 个大剧情弧`);
  console.log(`  4. 章节 (Chapter): ${summary.chapters} 章`);
  console.log(`  5. 场景 (Scene): ${summary.scenes} 个物理时空场景`);
  console.log(`  6. 段落 (Paragraph): ${summary.paragraphs} 个自然段落`);
  console.log(`  7. 句子 (Sentence): ${summary.sentences} 个语义单句`);

  console.log('\n=== 23 项核心质量指标概览 (value / evidence / confidence) ===');
  const displayFields = [
    'metadata', 'genre', 'structure', 'opening', 'pacing',
    'conflict', 'causality', 'foreshadowing', 'emotion', 'dialogue',
    'description', 'language', 'human_texture', 'hook', 'ai_flavor'
  ];

  displayFields.forEach(field => {
    const b = profile[field];
    const evItem = b.evidence[0];
    const evText = typeof evItem === 'object' ? (evItem.rationale || evItem.locationSnippet || JSON.stringify(evItem)) : String(evItem || '');
    console.log(`  - [${field.padEnd(14)}] 置信度: ${b.confidence} | 证据: ${evText.slice(0, 45)}...`);
  });

  console.log('\n=== Benchmark 机器比对初审 ===');
  const comp = profile.benchmark_comparison;
  console.log(`  - 综合质量指数: ${comp.overallQualityIndex}/100`);
  console.log(`  - 基准合规状态: ${comp.conformanceToBenchmark}`);
  console.log(`  - 检出偏离项数: ${comp.identifiedIssues.length}`);

  console.log('\n✅ 预处理全部完成！输入可直接接入后续评测流程。');
}

main().catch(err => {
  console.error('执行异常:', err);
  process.exit(1);
});
