#!/usr/bin/env node
'use strict';

/**
 * @file quadrant-batch-runner.mjs
 * 四象限对照实验批处理生成与质量比对调度脚本
 * 
 * 用法：
 *   node scripts/quadrant-batch-runner.mjs --dry-run
 *   node scripts/quadrant-batch-runner.mjs --mock --limit=10
 *   node scripts/quadrant-batch-runner.mjs --quadrant=A --category=都市 --dry-run
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const { QuadrantBatchRunner, QuadrantQualityEvaluator } = require('../lib/composition/corpus/prompt-experiment-runner');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    quadrant: 'all',
    category: null,
    limit: null,
    dryRun: false,
    mock: false,
    resume: true,
    concurrency: 2,
    evaluate: false,
    confirmPhase1Approved: false,
    experimentDir: null
  };

  for (const arg of args) {
    if (arg.startsWith('--quadrant=')) {
      options.quadrant = arg.split('=')[1];
    } else if (arg.startsWith('--category=')) {
      options.category = arg.split('=')[1];
    } else if (arg.startsWith('--limit=')) {
      options.limit = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--concurrency=')) {
      options.concurrency = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--experiment-dir=')) {
      options.experimentDir = path.resolve(arg.split('=')[1]);
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--mock') {
      options.mock = true;
    } else if (arg === '--no-resume') {
      options.resume = false;
    } else if (arg === '--evaluate') {
      options.evaluate = true;
    } else if (arg === '--confirm-phase1-approved') {
      options.confirmPhase1Approved = true;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs();
  console.log('================================================================');
  console.log('   四象限对照实验批处理调度与质量评估系统 (Phase 2 Runner)');
  console.log('================================================================');
  console.log(`目标象限: ${options.quadrant}`);
  if (options.category) console.log(`指定题材: ${options.category}`);
  if (options.limit) console.log(`样本限制: ${options.limit}`);
  console.log(`并发线程: ${options.concurrency}`);
  console.log(`执行模式: ${options.dryRun ? 'DRY-RUN (试跑预检)' : (options.mock ? 'MOCK (模拟生成与评测)' : 'LIVE (真实大模型)')}`);
  console.log(`断点续传: ${options.resume ? '开启' : '关闭'}`);
  console.log('----------------------------------------------------------------');

  const runner = new QuadrantBatchRunner({
    experimentDir: options.experimentDir || path.resolve(__dirname, '../data/corpus-prompt-experiments'),
    concurrency: options.concurrency
  });

  const startTime = Date.now();
  const summary = await runner.runBatch(options);
  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('----------------------------------------------------------------');
  console.log(`调度完成！模式: ${summary.mode}，任务总数: ${summary.totalTasks}，已完成: ${summary.completedTasks}，跳过(已存在): ${summary.skippedTasks}，耗时: ${durationSec}s`);

  if (summary.evaluationSummary) {
    console.log('\n================ 四象限质量比对评估汇总 ================\n');
    console.log('| 象限 | 组别定义 | 样本数 | 平均字数 | 篇幅比 | 11D文风距离 | 动作密度 | AI味风险 | 综合得分 |');
    console.log('| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |');
    const names = {
      A: '实验组 A (墨阑全链路 + 极简Prompt)',
      B: '实验组 B (墨阑全链路 + 完整Prompt)',
      C: '对照组 C (大模型直出 + 极简Prompt)',
      D: '对照组 D (大模型直出 + 完整Prompt)'
    };
    for (const q of ['A', 'B', 'C', 'D']) {
      const st = summary.evaluationSummary[q];
      if (st && st.totalSamples > 0) {
        console.log(`| ${q} | ${names[q]} | ${st.totalSamples} | ${st.avgCharCount} | ${st.avgLengthRatio} | ${st.avgStyleDistance} | ${st.avgActionDensity} | ${st.avgAiFlavorRisk} | ${st.avgCompositeScore} |`);
      }
    }
    console.log('\n=======================================================\n');
  }

  // 记录运行报告
  const reportPath = path.join(runner.experimentDir, 'batch_execution_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`批处理执行报告已保存至: ${reportPath}`);
}

main().catch(err => {
  console.error('Batch Execution Error:', err.message);
  process.exit(1);
});
