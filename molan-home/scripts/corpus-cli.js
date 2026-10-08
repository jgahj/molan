#!/usr/bin/env node
'use strict';

/**
 * @file corpus-cli.js
 * 1279 部小说离线因子化与策略知识库构建独立 CLI 工具 (Corpus Batch CLI)
 * 
 * 支持命令：
 * - extract: 执行两阶段章节初筛与深度因子化抽取
 * - build-strategy: 基于特征挖掘统计学策略规则与证据评级
 * - discover-patterns: 聚类章节运作原型
 * - quality-report: 生成阶段质量门禁报告
 * - publish: 原子发布通过质量门禁的知识包至生产环境
 * 
 * 示例用法：
 * npm run corpus:extract
 * npm run corpus:extract -- --book-id xxx --category 玄幻 --resume --workers 4
 * npm run corpus:build-strategy
 * npm run corpus:publish
 */

const path = require('node:path');
const { CorpusBatchPipeline } = require('../lib/composition/corpus/batch-pipeline');

function parseArgs(args) {
  const options = {
    command: 'extract',
    bookId: null,
    category: null,
    resume: false,
    workers: 2,
    limit: null,
    dryRun: false,
    sourceDir: null,
    outputDir: null,
    runId: null,
    runDir: null,
    k: null,
    clusters: null,
    minClusterSize: null,
    output: null,
    outputFile: null,
    version: null,
    stage1Only: false
  };

  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--book-id' && args[i + 1]) {
      options.bookId = args[++i];
    } else if (arg === '--category' && args[i + 1]) {
      options.category = args[++i];
    } else if (arg === '--resume') {
      options.resume = true;
    } else if (arg === '--no-resume') {
      options.resume = false;
    } else if (arg === '--workers' && args[i + 1]) {
      options.workers = parseInt(args[++i], 10);
    } else if (arg === '--limit' && args[i + 1]) {
      options.limit = parseInt(args[++i], 10);
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--source-dir' && args[i + 1]) {
      options.sourceDir = args[++i];
    } else if (arg === '--output-dir' && args[i + 1]) {
      options.outputDir = args[++i];
    } else if (arg === '--run-id' && args[i + 1]) {
      options.runId = args[++i];
    } else if (arg === '--run-dir' && args[i + 1]) {
      options.runDir = args[++i];
    } else if ((arg === '--k' || arg === '--clusters') && args[i + 1]) {
      const parsedK = parseInt(args[++i], 10);
      options.k = parsedK;
      options.clusters = parsedK;
    } else if ((arg === '--min-cluster-size' || arg === '--min-support') && args[i + 1]) {
      options.minClusterSize = parseInt(args[++i], 10);
    } else if ((arg === '--output' || arg === '--output-file') && args[i + 1]) {
      const parsedOut = args[++i];
      options.output = parsedOut;
      options.outputFile = parsedOut;
    } else if (arg === '--version' && args[i + 1]) {
      options.version = args[++i];
    } else if (arg === '--stage1-only') {
      options.stage1Only = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  if (positional.length > 0) {
    options.command = positional[0];
  }

  return options;
}

function printUsage() {
  console.log(`
Molan 离线小说语料批处理与策略知识库构建 CLI

用法：
  node scripts/corpus-cli.js <command> [options]
  npm run corpus:<command> -- [options]

支持命令：
  extract             两阶段章节抽取（第一阶段便宜初筛 + 第二阶段深度正交因子化）
  build-strategy      挖掘统计学策略规则并执行 A/B/C/D 级证据评级
  discover-patterns   聚类章节运作原型 (Chapter Archetypes)
  quality-report      生成数据与规则质量审查报告
  publish             原子发布已验证知识包至生产运行目录

参数选项：
  --book-id <id>      指定单一书目 ID
  --category <name>   指定题材分类 (如 玄幻, 仙侠, 悬疑)
  --resume            启用断点续跑 (默认开启)
  --no-resume         不续跑，强制从头开始
  --workers <n>       并发 worker 数 (默认 2, 最大 8)
  --limit <n>         最多处理书目数量
  --dry-run           干跑模式，仅扫描与检查状态，不执行实际抽取
  --source-dir <dir>  指定只读原始语料目录
  --output-dir <dir>  指定 staging 输出目录
  --run-id <id>       指定特定批处理运行 ID
  --run-dir <dir>     指定特定批处理运行目录 (直接指定路径)
  --k, --clusters <n> 指定原型聚类簇数 (默认 5，自适应钳制至有效样本数)
  --min-cluster-size <n> 指定每簇最小样本数
  --output, --output-file <file> 指定 archetypes.json 输出文件路径
  --stage1-only       仅执行第一阶段初筛
  --help, -h          打印本帮助信息
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printUsage();
    process.exit(0);
  }

  const pipeline = new CorpusBatchPipeline({
    sourceDir: options.sourceDir,
    stagingRoot: options.outputDir,
    runId: options.runId,
    runDir: options.runDir,
    workers: options.workers
  });

  console.log(`[CorpusCLI] 启动命令: ${options.command} (Workers: ${options.workers}, Resume: ${options.resume})`);

  try {
    let result;
    switch (options.command) {
      case 'extract':
        result = await pipeline.runExtract(options);
        break;
      case 'build-strategy':
        result = await pipeline.runBuildStrategy(options);
        break;
      case 'discover-patterns':
      case 'cluster':
        result = await pipeline.runDiscoverPatterns(options);
        break;
      case 'quality-report':
        result = await pipeline.runQualityReport(options);
        break;
      case 'publish':
        result = await pipeline.runPublish(options);
        break;
      default:
        console.error(`未知命令: ${options.command}`);
        printUsage();
        process.exit(1);
    }

    console.log('[CorpusCLI] 执行成功:');
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`[CorpusCLI] 执行失败: ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  main
};
