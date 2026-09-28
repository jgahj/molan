#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildAssessmentReport, renderAssessmentMarkdown } = require('../lib/assessment-report.js');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

function writeNew(filePath, content) {
  fs.writeFileSync(filePath, content, { encoding: 'utf8', flag: 'wx' });
}

function main() {
  const inputPath = option('--input');
  const outputDir = option('--out-dir');
  const input = inputPath ? JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8')) : {};
  const report = buildAssessmentReport(input);
  const markdown = renderAssessmentMarkdown(report);

  if (!outputDir) {
    process.stdout.write(markdown + '\n' + JSON.stringify(report, null, 2) + '\n');
    return;
  }

  const resolvedOutputDir = path.resolve(outputDir);
  fs.mkdirSync(resolvedOutputDir, { recursive: true });
  const outputs = [
    ['assessment.md', markdown + '\n'],
    ['assessment.json', JSON.stringify(report, null, 2) + '\n'],
    ['optimization-plan.json', JSON.stringify({ patches: report.patches }, null, 2) + '\n'],
    ['experiment-plan.json', JSON.stringify(report.experimentPlan, null, 2) + '\n'],
    ['evidence-index.json', JSON.stringify(report.evidence, null, 2) + '\n']
  ].map(([name, content]) => [path.join(resolvedOutputDir, name), content]);
  const existing = outputs.map(([filePath]) => filePath).filter(filePath => fs.existsSync(filePath));
  if (existing.length) throw new Error('输出文件已存在，未写入：' + existing.join(', '));
  for (const [filePath, content] of outputs) writeNew(filePath, content);
}

try {
  main();
} catch (error) {
  process.stderr.write(String(error && error.message || error) + '\n');
  process.exitCode = 1;
}
