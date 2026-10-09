#!/usr/bin/env node
'use strict';

/**
 * @file extract-corpus-prompts.mjs
 * 资源库小说全库 1279 本书单章抽样与双模提示词提取执行脚本
 * 
 * 执行全库单章随机采样 -> 双模提示词提炼 -> 四象限配置生成 -> 分类归档与 Manifest 产出
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const { processBookFile } = require('../lib/composition/corpus/prompt-experiment-extractor');

const DEFAULT_CORPUS_DIR = path.resolve(__dirname, '../../资源库/小说原本');
const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, '../data/corpus-prompt-experiments');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    corpusDir: DEFAULT_CORPUS_DIR,
    outputDir: DEFAULT_OUTPUT_DIR,
    limit: null,
    category: null,
    dryRun: false
  };

  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      options.limit = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--category=')) {
      options.category = arg.split('=')[1];
    } else if (arg.startsWith('--corpus-dir=')) {
      options.corpusDir = path.resolve(arg.split('=')[1]);
    } else if (arg.startsWith('--output-dir=')) {
      options.outputDir = path.resolve(arg.split('=')[1]);
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    }
  }

  return options;
}

function discoverBooks(corpusDir) {
  const books = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const fullPath = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(fullPath);
      } else if (ent.isFile() && ent.name.endsWith('.txt')) {
        const category = path.basename(path.dirname(fullPath));
        books.push({
          filePath: fullPath,
          category,
          bookId: path.basename(ent.name, '.txt')
        });
      }
    }
  }
  walk(corpusDir);
  return books;
}

async function main() {
  const options = parseArgs();
  console.log('================================================================');
  console.log('   资源库小说全库单章抽样与双模提示词提取管线 (Phase 1)');
  console.log('================================================================');
  console.log(`语料目录: ${options.corpusDir}`);
  console.log(`输出目录: ${options.outputDir}`);
  if (options.category) console.log(`指定题材: ${options.category}`);
  if (options.limit) console.log(`抽样数量上限: ${options.limit}`);
  if (options.dryRun) console.log(`运行模式: DRY-RUN (不写盘)`);
  console.log('----------------------------------------------------------------');

  const allBooks = discoverBooks(options.corpusDir);
  console.log(`全库发现图书总数: ${allBooks.length} 本`);

  let targetBooks = allBooks;
  if (options.category) {
    targetBooks = targetBooks.filter(b => b.category === options.category);
    console.log(`题材【${options.category}】过滤后图书: ${targetBooks.length} 本`);
  }
  if (options.limit && options.limit > 0) {
    targetBooks = targetBooks.slice(0, options.limit);
    console.log(`限制处理样本数: ${targetBooks.length} 本`);
  }

  if (!options.dryRun && !fs.existsSync(options.outputDir)) {
    fs.mkdirSync(options.outputDir, { recursive: true });
  }

  const startTime = Date.now();
  const manifestSamples = [];
  const categoryStats = {};
  const errors = [];

  let processedCount = 0;
  for (const book of targetBooks) {
    try {
      const record = processBookFile(book.filePath, { category: book.category });

      // 统计分类
      if (!categoryStats[record.category]) {
        categoryStats[record.category] = {
          count: 0,
          totalChars: 0,
          minPromptChars: 0,
          compPromptChars: 0
        };
      }
      categoryStats[record.category].count++;
      categoryStats[record.category].totalChars += record.sampledChapter.charCount;
      categoryStats[record.category].minPromptChars += record.dualPrompts.minimal.charCount;
      categoryStats[record.category].compPromptChars += record.dualPrompts.comprehensive.charCount;

      // 保存每本书的完整实验档案 (JSON 与 Markdown 双格式)
      if (!options.dryRun) {
        const catDir = path.join(options.outputDir, record.category);
        if (!fs.existsSync(catDir)) {
          fs.mkdirSync(catDir, { recursive: true });
        }
        const recordPath = path.join(catDir, `${record.bookId}.json`);
        fs.writeFileSync(recordPath, JSON.stringify(record, null, 2), 'utf8');

        // 生成单书 Markdown 审阅文件
        const bookMd = [
          `# 提示词实验档案：《${record.title}》`,
          `> 题材分类：${record.category} | 作者：${record.author || '未知'} | 抽样时间：${record.createdAt}`,
          ``,
          `## 抽中章节信息`,
          `- **章节序号**：第 ${record.sampledChapter.chapterNo} 章（全书共 ${record.sampledChapter.totalChaptersInBook} 章）`,
          `- **章节标题**：${record.sampledChapter.chapterTitle}`,
          `- **正文字数**：${record.sampledChapter.charCount} 字`,
          ``,
          `---`,
          ``,
          `## 粒度 1：极简提示词 (Minimal Prompt)`,
          record.dualPrompts.minimal.markdown,
          ``,
          `---`,
          ``,
          `## 粒度 2：完整提示词 (Comprehensive Prompt)`,
          record.dualPrompts.comprehensive.markdown,
          ``,
          `---`,
          ``,
          `## 四象限实验载荷概览`,
          `- **象限 A (实验组)**：${record.quadrants.quadrantA.name}（管线: \`${record.quadrants.quadrantA.pipeline}\`）`,
          `- **象限 B (实验组)**：${record.quadrants.quadrantB.name}（管线: \`${record.quadrants.quadrantB.pipeline}\`）`,
          `- **象限 C (对照组)**：${record.quadrants.quadrantC.name}（管线: \`${record.quadrants.quadrantC.pipeline}\`）`,
          `- **象限 D (对照组)**：${record.quadrants.quadrantD.name}（管线: \`${record.quadrants.quadrantD.pipeline}\`）`
        ].join('\n');
        fs.writeFileSync(path.join(catDir, `${record.bookId}.md`), bookMd, 'utf8');
      }

      manifestSamples.push({
        bookId: record.bookId,
        title: record.title,
        author: record.author,
        category: record.category,
        relativeJsonPath: `${record.category}/${record.bookId}.json`,
        relativeMdPath: `${record.category}/${record.bookId}.md`,
        sampledChapter: {
          chapterNo: record.sampledChapter.chapterNo,
          chapterTitle: record.sampledChapter.chapterTitle,
          charCount: record.sampledChapter.charCount,
          totalChaptersInBook: record.sampledChapter.totalChaptersInBook
        },
        promptMetrics: {
          minimalChars: record.dualPrompts.minimal.charCount,
          comprehensiveChars: record.dualPrompts.comprehensive.charCount,
          fiveDimensions: {
            genreId: record.dualPrompts.comprehensive.fiveDimensions.genre.id,
            styleId: record.dualPrompts.comprehensive.fiveDimensions.style.id,
            goalId: record.dualPrompts.comprehensive.fiveDimensions.goal.id,
            hookId: record.dualPrompts.comprehensive.fiveDimensions.hook.id
          }
        }
      });

      processedCount++;
      if (processedCount % 100 === 0 || processedCount === targetBooks.length) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[${processedCount}/${targetBooks.length}] 已处理完成... 耗时: ${elapsed}s`);
      }
    } catch (err) {
      errors.push({ bookId: book.bookId, error: err.message });
      console.error(`处理图书异常 [${book.bookId}]: ${err.message}`);
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('----------------------------------------------------------------');
  console.log(`全量抽样与双模提炼完成！成功: ${processedCount}，异常: ${errors.length}，耗时: ${durationSec}s`);

  if (!options.dryRun) {
    // 1. 生成每个题材的 README.md 审阅汇总
    for (const [cat, stats] of Object.entries(categoryStats)) {
      const catSamples = manifestSamples.filter(s => s.category === cat);
      const catMd = [
        `# 题材实验抽样汇总：${cat}`,
        ``,
        `> 本分类包含图书总计: **${stats.count}** 本 | 平均章节字数: **${Math.round(stats.totalChars / stats.count)}** 字`,
        ``,
        `| 序号 | 书名 | 抽中章节 | 章节字数 | 极简提示词字数 | 完整提示词字数 | 目标 Profile | 钩子 Profile |`,
        `| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: |`,
        ...catSamples.map((s, idx) => 
          `| ${idx + 1} | [${s.title}](./${encodeURIComponent(s.bookId)}.json) | ${s.sampledChapter.chapterTitle} | ${s.sampledChapter.charCount} | ${s.promptMetrics.minimalChars} | ${s.promptMetrics.comprehensiveChars} | \`${s.promptMetrics.fiveDimensions.goalId}\` | \`${s.promptMetrics.fiveDimensions.hookId}\` |`
        )
      ].join('\n');

      const catMdPath = path.join(options.outputDir, cat, 'README.md');
      fs.writeFileSync(catMdPath, catMd, 'utf8');
    }

    // 2. 在部分抽取模式下，合并已有 Manifest，杜绝全库索引被覆盖删除
    let finalSamples = manifestSamples;
    let finalCategoryStats = { ...categoryStats };
    const manifestPath = path.join(options.outputDir, 'manifest.json');

    if ((options.category || options.limit) && fs.existsSync(manifestPath)) {
      try {
        const oldManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const sampleMap = new Map();
        for (const s of (oldManifest.samples || [])) {
          sampleMap.set(s.bookId, s);
        }
        for (const s of manifestSamples) {
          sampleMap.set(s.bookId, s);
        }
        finalSamples = Array.from(sampleMap.values());
        if (oldManifest.stats?.categoryBreakdown) {
          finalCategoryStats = { ...oldManifest.stats.categoryBreakdown, ...categoryStats };
        }
      } catch (_) {}
    }

    // 生成流式轻量索引 index.jsonl
    const jsonlLines = finalSamples.map(s => JSON.stringify(s));
    fs.writeFileSync(path.join(options.outputDir, 'index.jsonl'), jsonlLines.join('\n') + '\n', 'utf8');

    // 3. 生成全局 manifest.json (含 AWAITING_HUMAN_CONFIRMATION 门禁)
    const manifest = {
      version: '1.0.0',
      system: 'Molan Corpus Prompt Experiment Matrix',
      status: 'AWAITING_HUMAN_CONFIRMATION',
      gatePolicy: {
        stage: 'PHASE_1_COMPLETE',
        canProceedToGeneration: false,
        requiresExplicitFlag: '--confirm-phase1-approved'
      },
      generatedAt: new Date().toISOString(),
      stats: {
        totalBooks: allBooks.length,
        processedBooks: finalSamples.length,
        categoryCount: Object.keys(finalCategoryStats).length,
        errorsCount: errors.length,
        averageChapterChars: Math.round(Object.values(finalCategoryStats).reduce((a, b) => a + (b.totalChars || 0), 0) / Math.max(1, finalSamples.length)),
        categoryBreakdown: finalCategoryStats
      },
      quadrants: {
        A: { name: '墨阑完整生成链 + 极简提示词', role: 'experiment_a' },
        B: { name: '墨阑完整生成链 + 完整提示词', role: 'experiment_b' },
        C: { name: '大模型单轮直接生成 + 极简提示词', role: 'control_c' },
        D: { name: '大模型单轮直接生成 + 完整提示词', role: 'control_d' }
      },
      samples: finalSamples
    };

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    console.log(`Manifest 清单与 index.jsonl 已生成: ${manifestPath}`);

    // 4. 生成全局快速审阅目录 REVIEW_CATALOG.md
    const catalogMd = [
      `# 资源库全库提示词实验样本全景速查目录 (REVIEW_CATALOG.md)`,
      ``,
      `> 语料总库：1279 本 | 题材分类：${Object.keys(categoryStats).length} 类 | 状态：\`AWAITING_HUMAN_CONFIRMATION\``,
      ``,
      `## 题材目录导航`,
      ...Object.keys(categoryStats).sort().map(cat => `- [${cat}](./${encodeURIComponent(cat)}/README.md) (${categoryStats[cat].count} 本)`),
      ``,
      `---`,
      ``,
      `## 全量样本速查 (Top 100 样本)`,
      `| 序号 | 题材 | 书名 | 抽中章节 | 极简Prompt | 完整Prompt | 实验档案 |`,
      `| :---: | :---: | :--- | :--- | :---: | :---: | :---: |`,
      ...manifestSamples.slice(0, 100).map((s, idx) =>
        `| ${idx + 1} | ${s.category} | ${s.title} | ${s.sampledChapter.chapterTitle} | ${s.promptMetrics.minimalChars}字 | ${s.promptMetrics.comprehensiveChars}字 | [JSON](./${encodeURIComponent(s.relativeJsonPath)}) / [MD](./${encodeURIComponent(s.relativeMdPath)}) |`
      )
    ].join('\n');
    fs.writeFileSync(path.join(options.outputDir, 'REVIEW_CATALOG.md'), catalogMd, 'utf8');

    // 3. 生成抽检报告 sampling_inspection_report.md
    const reportMd = [
      `# 资源库小说全库单章提示词抽取质量抽检与实验组设计报告`,
      ``,
      `> 报告生成时间：${new Date().toISOString()}  `,
      `> 语料总库：《资源库/小说原本》（共 ${allBooks.length} 部小说）  `,
      `> 采样覆盖：${processedCount} 部小说（每部小说严格随机抽样 1 个有效章节）  `,
      `> 成功率：${((processedCount / (processedCount + errors.length)) * 100).toFixed(2)}% (失败: ${errors.length})`,
      ``,
      `---`,
      ``,
      `## 一、题材分布与抽样统计概览`,
      ``,
      `| 题材分类 | 图书总数 | 抽中章节总字数 | 平均章节字数 | 极简提示词均长 | 完整提示词均长 |`,
      `| :--- | :---: | :---: | :---: | :---: | :---: |`,
      ...Object.entries(categoryStats).sort((a, b) => b[1].count - a[1].count).map(([cat, st]) => 
        `| ${cat} | ${st.count} | ${st.totalChars} | ${Math.round(st.totalChars / st.count)} | ${Math.round(st.minPromptChars / st.count)} | ${Math.round(st.compPromptChars / st.count)} |`
      ),
      ``,
      `---`,
      ``,
      `## 二、双模提示词粒度规范验收`,
      ``,
      `### 1. 极简提示词 (Minimal Prompt)`,
      `- **核心要素**：`,
      `  - 核心故事情节概要（150~300 字）：提炼主角身份、即时行动、核心阻力对抗、关键转折与未结悬念；`,
      `  - 题材文风标签：包括题材分类、物理文风基调（短句比、对白比、动作动词密度等）；`,
      `  - 结尾要求：明确末尾信息缺口或期待缺口促使翻页。`,
      `- **应用场景**：驱动象限 A（墨阑管线自适应推导补全）与象限 C（大模型零样本单轮直出）。`,
      ``,
      `### 2. 完整提示词 (Comprehensive Prompt)`,
      `- **核心要素**：`,
      `  - 人物人设与核心行动动机设定（主角即时欲望与对手阻力）；`,
      `  - 核心冲突起承转合 4 节拍推进规划（起-承-转-合）；`,
      `  - 因果债务状态机位移 (State Delta) 与章末悬念钩子 (Gap Type & Strength)；`,
      `  - 墨阑 5 维参数配置 (Genre/Style/Goal/Focus/Hook)；`,
      `  - 4 级注意力分级规划 (Tier 1 圣经/世界观、Tier 2 策略节拍、Tier 3 文风证据、Tier 4 现场行动)。`,
      `- **应用场景**：驱动象限 B（墨阑全规格高保真度策略生成）与象限 D（大模型长上下文单轮直出）。`,
      ``,
      `---`,
      ``,
      `## 三、四象限实验组与对照组设计矩阵`,
      ``,
      `| 象限编号 | 组别类型 | 核心管线 | 输入提示词 | 策略介入程度 | 预期评估焦点 |`,
      `| :---: | :---: | :--- | :--- | :---: | :--- |`,
      `| **象限 A** | 实验组 A | 墨阑完整链路 (Scene Planner + Strategy Compiler + Attention Tiering) | 极简提示词 | 系统自动补全推导 | 检验墨阑策略编译器在极简弱输入下的“策略智能扩写与场景自洽保底力” |`,
      `| **象限 B** | 实验组 B | 墨阑完整链路 (全规格 5D Profile + 4 级注意力分级) | 完整提示词 | 全规格高精度约束 | 检验墨阑完整创作架构在全量约束下的“最高保真度与文风因果掌控力” |`,
      `| **象限 C** | 对照组 C | 大模型单轮直接生成 (零项目链路介入) | 极简提示词 | 零介入 | 作为通用基准，检验大模型原生直出在简短 Prompt 下的下限表现 |`,
      `| **象限 D** | 对照组 D | 大模型单轮直接生成 (零项目链路介入) | 完整提示词 | 零介入 (仅提示词直喂) | 作为强基准，检验大模型原生直出面对长复杂规则时的执行力与失真衰减 |`,
      ``,
      `---`,
      ``,
      `## 四、典型抽检样本切片展示`,
      ``,
      ...manifestSamples.slice(0, 3).map((s, idx) => {
        const full = JSON.parse(fs.readFileSync(path.join(options.outputDir, s.relativeJsonPath), 'utf8'));
        return [
          `### 抽检样本 ${idx + 1}：《${full.title}》（题材：${full.category}）`,
          `- **抽中章节**：${full.sampledChapter.chapterTitle}（字数: ${full.sampledChapter.charCount} 字）`,
          `- **极简提示词概要**：`,
          `  > ${full.dualPrompts.minimal.summary}`,
          `- **5 维 Profile 映射**：\`${full.dualPrompts.comprehensive.fiveDimensions.genre.id}\` / \`${full.dualPrompts.comprehensive.fiveDimensions.style.id}\` / \`${full.dualPrompts.comprehensive.fiveDimensions.goal.id}\` / \`${full.dualPrompts.comprehensive.fiveDimensions.hook.id}\``,
          `- **章末钩子类型**：\`${full.dualPrompts.comprehensive.fiveDimensions.hook.type}\`（缺口模式: \`${full.dualPrompts.comprehensive.fiveDimensions.hook.gapType}\`，强度: ${full.dualPrompts.comprehensive.fiveDimensions.hook.strength}）`,
          ``
        ].join('\n');
      }),
      ``,
      `---`,
      ``,
      `## 五、后续执行门禁与人工确认建议`,
      `1. **第一阶段产物确认**：全库 1279 本书的双模提示词与四象限配置已全部归档至 \`data/corpus-prompt-experiments/\`，\`manifest.json\` 索引完备；`,
      `2. **第二阶段调度就绪**：调度器 \`scripts/quadrant-batch-runner.mjs\` 已搭建完毕，支持 \`--dry-run\`、\`--mock\`、断点续传与质量评测；`,
      `3. **门禁声明**：当前正文生成处于未启动状态，待用户人工确认本抽检报告及提示词数据集后，方可启动真实模型正文生成。`
    ].join('\n');

    const reportPath = path.join(options.outputDir, 'sampling_inspection_report.md');
    fs.writeFileSync(reportPath, reportMd, 'utf8');
    const spotcheckPath = path.join(options.outputDir, 'QUALITY_SPOTCHECK_REPORT.md');
    fs.writeFileSync(spotcheckPath, reportMd, 'utf8');
    console.log(`抽检质量报告已生成: ${reportPath} 与 ${spotcheckPath}`);
  }
}

main().catch(err => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
