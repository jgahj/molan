'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { auditGeneralization } = require('../lib/generalization-detector.js');

/** 读取命令行的单值参数。 */
function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

/** 汇总外部泛化评测并输出独立报告。 */
function main() {
  const inputPath = option('--input') || path.join(__dirname, '..', 'data', 'evaluation-input', 'generalization-evaluation-input.json');
  const input = fs.existsSync(inputPath) ? JSON.parse(fs.readFileSync(inputPath, 'utf8')) : {};
  const report = auditGeneralization(input);
  report.input = { path: path.resolve(inputPath), found: fs.existsSync(inputPath) };

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
