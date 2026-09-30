import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { compareQualityVectors } = require('../lib/evolution/quality-vector-ab.js');

/** 解析 CLI 的命名参数。 */
function readOption(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] || null;
}

/** 读取显式输入的已保存 A/B 结果。 */
function readInput(inputPath) {
  const resolved = path.resolve(inputPath);
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

/** 将报告输出到标准输出或用户指定的新文件。 */
function writeReport(report, outputPath) {
  const content = `${JSON.stringify(report, null, 2)}\n`;
  if (!outputPath) {
    process.stdout.write(content);
    return;
  }
  const resolved = path.resolve(outputPath);
  fs.writeFileSync(resolved, content, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`报告已写入：${resolved}\n`);
}

/** 只比较落盘结果，不发起模型请求或产生推理费用。 */
function main() {
  const inputPath = readOption('--input');
  if (!inputPath) throw new TypeError('必须提供 --input <saved-results.json>');
  const input = readInput(inputPath);
  const report = compareQualityVectors(input);
  writeReport(report, readOption('--out'));
  if (report.status !== 'PROMOTION_READY') process.exitCode = report.status === 'REJECTED' ? 1 : 2;
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error && error.message || error}\n`);
  process.exitCode = 1;
}
