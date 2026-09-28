import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  HISTORICAL_SAMPLE_ID,
  loadRootCauseInputs,
  analyzeRootCauses,
  generateRootCauseReportMarkdown
} = require('../lib/root-cause-analyzer.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baseDir = path.resolve(__dirname, '..');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

async function main() {
  console.log('='.repeat(70));
  console.log('🔍 墨阑小说生成系统根因分析器 (Root Cause Analyzer)');
  console.log('='.repeat(70));

  // 1. 加载输入
  console.log('1. 正在读取显式指定的历史样例与系统模块...');
  const sampleId = option('--sample-id');
  if (sampleId !== HISTORICAL_SAMPLE_ID) {
    const report = analyzeRootCauses({ sample_id: sampleId });
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const inputs = loadRootCauseInputs({ sampleId });
  console.log(`   - 已扫描缺陷清单数: ${inputs.defectRegistry?.defects?.length || 0}`);
  console.log(`   - 已加载生成记录: ${inputs.generationRecord ? '已就绪' : '缺失'}`);
  console.log(`   - 已加载修订失败记录: ${inputs.revisionFailureRecord ? '已就绪' : '缺失'}`);
  console.log(`   - 已加载定稿校验记录: ${inputs.finalCheckRecord ? '已就绪' : '缺失'}`);
  console.log(`   - 系统基础设施探针: 记忆系统=${inputs.systemInspection.hasMemorySystem}, 人物材质=${inputs.systemInspection.hasCharacterMaterial}, 叙事门禁=${inputs.systemInspection.hasGenreNarrativeAudit}`);
  console.log(`   - 生成脚本模块挂载情况: 挂载记忆=${inputs.systemInspection.scriptMountsMemory}, 挂载人物材质=${inputs.systemInspection.scriptMountsCharacterContext}, 挂载ScenePlanner=${inputs.systemInspection.scriptUsesScenePlanner}`);

  // 2. 执行 6 层深度因果链分析
  console.log('2. 正在执行 6 层因果追踪链与 17 类根因分类判定...');
  const report = analyzeRootCauses(inputs);

  // 3. 输出到显式指定的新目录，避免覆盖既有报告。
  const requestedOutputDir = option('--out-dir');
  if (!requestedOutputDir) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const outputDir = path.resolve(requestedOutputDir);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const jsonPath = path.join(outputDir, 'root-cause.json');
  const mdPath = path.join(outputDir, 'root-cause.md');

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), { encoding: 'utf8', flag: 'wx' });
  console.log(`   - 结构化数据已写入: ${path.relative(baseDir, jsonPath)}`);

  const mdContent = generateRootCauseReportMarkdown(report);
  fs.writeFileSync(mdPath, mdContent, { encoding: 'utf8', flag: 'wx' });
  console.log(`   - 深度报告白皮书已写入: ${path.relative(baseDir, mdPath)}`);

  // 4. 控制台摘要
  console.log('\n' + '-'.repeat(70));
  console.log('📊 根因分析终局摘要:');
  console.log(`   - 分析缺陷总数: ${report.meta.totalDefectsAnalyzed}`);
  const attribution = Number.isFinite(report.meta.systemicAttributionRatio)
    ? `${Math.round(report.meta.systemicAttributionRatio * 100)}%`
    : 'UNKNOWN';
  console.log(`   - 生成系统导致的问题: ${report.meta.systemCausedDefects} (${attribution})`);
  console.log(`   - 内容本身的问题: ${report.meta.contentCausedDefects} (0%)`);
  console.log(`   - 终局裁决方向: 【${report.overallVerdict?.targetToFix || 'NEEDS_MORE_DATA'}】`);
  console.log('-'.repeat(70));

  console.log('\n逐项缺陷归因清单:');
  for (const rc of report.rootCauses) {
    console.log(`\n▶ [${rc.defect_id}]`);
    console.log(`  表面现象: ${rc.symptom.slice(0, 45)}...`);
    console.log(`  直接原因: ${rc.direct_cause.slice(0, 45)}...`);
    console.log(`  根本原因: ${rc.root_cause.slice(0, 50)}...`);
    console.log(`  根因分类: ${rc.root_cause_categories.join(' | ')}`);
    console.log(`  问题归属: ${rc.problem_attribution.classification} -> 终局建议: 【${rc.problem_attribution.final_verdict}】`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('✅ 根因分析圆满完成！');
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('❌ 执行根因分析失败:', err);
  process.exit(1);
});
