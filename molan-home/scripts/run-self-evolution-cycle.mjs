'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { executeEvolutionCycle } = require('../lib/self-evolution-controller.js');

/** 读取命令行的单值参数。 */
function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

/** 读取显式闭环输入包；默认路径缺失时保持空输入。 */
function loadInput() {
  const inputPath = option('--input') || path.join(__dirname, '..', 'data', 'evaluation-input', 'evolution-cycle-input.json');
  if (!fs.existsSync(inputPath)) return { input: {}, inputPath, inputFound: false };
  return { input: JSON.parse(fs.readFileSync(inputPath, 'utf8')), inputPath, inputFound: true };
}

/** 汇总闭环结果并只写入用户指定的新文件。 */
function main() {
  const { input, inputPath, inputFound } = loadInput();
  const report = executeEvolutionCycle(input);
  report.input = { path: path.resolve(inputPath), found: inputFound };

  const outputPath = option('--out');
  if (outputPath) {
    const resolved = path.resolve(outputPath);
    fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`写入新报告：${resolved}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error && error.message || error}\n`);
  process.exitCode = 1;
}
