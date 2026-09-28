import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildMultiGenreBenchmarkMatrix,
  generateMultiGenreReportMarkdown
} = require('../lib/multi-genre-benchmark-matrix.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baseDir = path.resolve(__dirname, '..');

async function main() {
  console.log('='.repeat(75));
  console.log('📚 网络小说原本全题材三阶段双粒度对照评测矩阵 (Ground Truth Benchmark)');
  console.log('='.repeat(75));

  const outputDir = path.join(baseDir, 'data/evaluation-input/ground-truth-benchmarks');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('1. 正在启动跨题材（每题材 >= 6 本，覆盖前/中/后三阶段）全量真机提取与三角评测...');
  const matrixData = await buildMultiGenreBenchmarkMatrix({
    corpusDir: path.resolve(baseDir, '../资源库/小说原本'),
    booksPerGenre: 6
  });

  console.log('\n2. 正在持久化评测结果资产...');
  const jsonPath = path.join(outputDir, 'multi-genre-benchmark-matrix.json');
  const mdPath = path.join(outputDir, 'multi-genre-benchmark-matrix.md');

  fs.writeFileSync(jsonPath, JSON.stringify(matrixData, null, 2), 'utf8');
  console.log(`   - 结构化矩阵数据已写入: ${path.relative(baseDir, jsonPath)}`);

  const mdReport = generateMultiGenreReportMarkdown(matrixData);
  fs.writeFileSync(mdPath, mdReport, 'utf8');
  console.log(`   - 深度全景白皮书已写入: ${path.relative(baseDir, mdPath)}`);

  console.log('\n' + '-'.repeat(75));
  console.log('📊 全题材真机评测矩阵核心汇总:');
  console.log(`   - 覆盖题材总数: ${matrixData.meta.totalGenres}`);
  console.log(`   - 参评名家小说总数: ${matrixData.meta.totalBooksTested} (每题材 >= 6 本)`);
  console.log(`   - 三阶段对照组总数: ${matrixData.meta.totalChapterStageComparisons} 组`);
  console.log('-'.repeat(75));

  for (const [gName, s] of Object.entries(matrixData.genreSummaries)) {
    console.log(`▶ [${gName}]: ${s.booksCount} 本 (${s.comparisonsCount} 组) | 详细版距原著: ${s.avgDistDetailedToOriginal} | 粗略版距原著: ${s.avgDistCoarseToOriginal} | PSI 敏感度: ${s.avgPromptSensitivityIndex} (逼近提升 +${s.detailedImprovementRate}%)`);
  }

  console.log('\n' + '='.repeat(75));
  console.log('✅ 全题材三阶段双粒度评测矩阵执行圆满完成！');
  console.log('='.repeat(75));
}

main().catch(err => {
  console.error('❌ 执行评测矩阵失败:', err);
  process.exit(1);
});
