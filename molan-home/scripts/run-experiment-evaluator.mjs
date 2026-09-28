'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { evaluateExperiment } = require('../lib/experiment-evaluator.js');

/** 读取命令行的单值参数。 */
function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

/** 只读取实验元数据和外部模型报告，不读取小说正文或基准原文。 */
function run() {
  const inputPath = option('--input');
  if (!inputPath) throw new Error('用法：node scripts/run-experiment-evaluator.mjs --input <评测包.json> [--out <新报告.json>]');

  const bundle = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
  const bundleKeys = new Set(['experiment_plan', 'external_result']);
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle) ||
      Object.keys(bundle).some(key => !bundleKeys.has(key))) {
    throw new Error('评测包只允许包含 experiment_plan 和 external_result，不要加入正文或原始对比材料。');
  }
  const plan = bundle.experiment_plan;
  const planKeys = new Set(['experiment_id', 'title', 'hypothesis']);
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) ||
      Object.keys(plan).some(key => !planKeys.has(key))) {
    throw new Error('experiment_plan 只允许包含 experiment_id、title 和 hypothesis。');
  }
  const result = evaluateExperiment({
    experimentPlan: plan,
    experimentResult: bundle.external_result
  });
  const outputPath = option('--out');
  const output = JSON.stringify(result, null, 2) + '\n';

  if (outputPath) {
    const resolved = path.resolve(outputPath);
    fs.writeFileSync(resolved, output, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write('写入新校验报告：' + resolved + '\n');
  } else {
    process.stdout.write(output);
  }

  if (result.validation_status !== 'READY_FOR_REVIEW') process.exitCode = 2;
}

try {
  run();
} catch (error) {
  process.stderr.write(String(error && error.message || error) + '\n');
  process.exitCode = 1;
}
