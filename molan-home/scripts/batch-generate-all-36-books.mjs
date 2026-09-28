import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { scanGenreBooks, extractThreeStages, compressToDualPrompts } = require('../lib/ground-truth-extractor.js');
const { generateRealChapter } = require('../lib/real-novel-generator.js');
const { CORE_BENCHMARK_GENRES, buildMultiGenreBenchmarkMatrix, generateMultiGenreReportMarkdown } = require('../lib/multi-genre-benchmark-matrix.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baseCorpusDir = path.resolve(__dirname, '../../资源库/小说原本');
const cacheDir = path.resolve(__dirname, '../data/evaluation-input/ground-truth-benchmarks/real-generated-chapters');

if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}

function hasCache(bookTitle, stage, variant) {
  if (!fs.existsSync(cacheDir)) return false;
  const files = fs.readdirSync(cacheDir);
  const prefix = `${bookTitle}-${stage}-${variant}-`;
  return files.some(f => f.startsWith(prefix) && f.endsWith('.json'));
}

async function main() {
  console.log('='.repeat(75));
  console.log('🚀 全题材 36 部名作（6题材 × 6本）真机在线大模型批量生成启动器');
  console.log('   - 上游模型: gpt-5.6-luna (真实调用 /api/chat)');
  console.log('   - 覆盖题材: 玄幻、都市、仙侠、悬疑灵异、历史脑洞、青春甜宠');
  console.log('   - 规格要求: 每题材不少于 6 本，每本双版本（详细版 vs 粗略版）');
  console.log('='.repeat(75));

  const allTasks = [];
  let alreadyCachedCount = 0;

  for (const genreConfig of CORE_BENCHMARK_GENRES) {
    const genreFolder = path.join(baseCorpusDir, genreConfig.folder);
    const books = scanGenreBooks(genreFolder, 6);

    console.log(`\n📂 检查题材 [${genreConfig.name}] -> 匹配 ${books.length} 部名作:`);

    for (const book of books) {
      const stages = extractThreeStages(book.fullPath);
      const sData = stages.early;
      if (!sData) continue;

      const promptData = compressToDualPrompts(sData, {
        title: book.title,
        author: book.author,
        genre: genreConfig.name
      });

      // 检查详细版
      const detailedCached = hasCache(book.title, 'early', 'detailed');
      if (detailedCached) {
        alreadyCachedCount++;
        console.log(`   - 《${book.title}》(detailed): 已就绪 ✅`);
      } else {
        allTasks.push({
          bookTitle: book.title,
          genre: genreConfig.name,
          stage: 'early',
          variant: 'detailed',
          prompt: promptData.detailedPrompt
        });
      }

      // 检查粗略版
      const coarseCached = hasCache(book.title, 'early', 'coarse');
      if (coarseCached) {
        alreadyCachedCount++;
        console.log(`   - 《${book.title}》(coarse): 已就绪 ✅`);
      } else {
        allTasks.push({
          bookTitle: book.title,
          genre: genreConfig.name,
          stage: 'early',
          variant: 'coarse',
          prompt: promptData.coarsePrompt
        });
      }
    }
  }

  const totalPossible = 36 * 2;
  console.log('\n' + '-'.repeat(75));
  console.log(`📊 任务队列统计:`);
  console.log(`   - 总需求任务数: ${totalPossible} 篇 (36 本 × 2 版本)`);
  console.log(`   - 本地已生成数: ${alreadyCachedCount} 篇`);
  console.log(`   - 待真机生成数: ${allTasks.length} 篇`);
  console.log('-'.repeat(75));

  if (allTasks.length === 0) {
    console.log('🎉 所有 36 部名作的双版本真机生成已全部就绪！');
  } else {
    console.log(`⏳ 开始执行真机大模型生成任务队列（控制并发数 2，防上游 429 限流）...`);
    const concurrency = 2;
    let completedCount = 0;

    for (let i = 0; i < allTasks.length; i += concurrency) {
      const batch = allTasks.slice(i, i + concurrency);
      const batchStr = batch.map(b => `${b.genre}-《${b.bookTitle}》(${b.variant})`).join(', ');
      console.log(`\n▶ [批次 ${Math.floor(i / concurrency) + 1}/${Math.ceil(allTasks.length / concurrency)}] 正在生成: ${batchStr}`);
      const t0 = Date.now();

      const promises = batch.map(task => generateRealChapter({
        bookTitle: task.bookTitle,
        genre: task.genre,
        stage: task.stage,
        variant: task.variant,
        prompt: task.prompt,
        maxTokens: 750
      }).then(res => {
        completedCount++;
        const tag = res.isFromCache ? '命中缓存' : '在线生成';
        console.log(`   ✅ [${tag}] [${completedCount}/${allTasks.length}] 《${task.bookTitle}》(${task.variant}): ${res.charCount}字 (耗时: ${(res.durationMs/1000).toFixed(1)}s)`);
        return res;
      }).catch(err => {
        console.error(`   ❌ 《${task.bookTitle}》(${task.variant}) 生成失败: ${err.message}`);
        return null;
      }));

      await Promise.all(promises);
      console.log(`⏱ 批次耗时: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }
  }

  // 生成完成后自动重新运行全量矩阵汇总并更新白皮书
  console.log('\n' + '='.repeat(75));
  console.log('🔄 正在基于 100% 真实的 36 部小说双版本生成结果重构对照矩阵与白皮书...');
  console.log('='.repeat(75));

  const outputDir = path.resolve(__dirname, '../data/evaluation-input/ground-truth-benchmarks');
  const matrixData = await buildMultiGenreBenchmarkMatrix({
    corpusDir: baseCorpusDir,
    booksPerGenre: 6
  });

  const jsonPath = path.join(outputDir, 'multi-genre-benchmark-matrix.json');
  const mdPath = path.join(outputDir, 'multi-genre-benchmark-matrix.md');

  fs.writeFileSync(jsonPath, JSON.stringify(matrixData, null, 2), 'utf8');
  console.log(`   - 结构化矩阵已更新: ${jsonPath}`);

  const mdReport = generateMultiGenreReportMarkdown(matrixData);
  fs.writeFileSync(mdPath, mdReport, 'utf8');
  console.log(`   - 全景白皮书已更新: ${mdPath}`);

  console.log('\n' + '='.repeat(75));
  console.log('🎉 全题材 36 部名作（每题材 6 本）真实大模型在线生成与三角对照评测圆满完成！');
  console.log('='.repeat(75));
}

main().catch(err => {
  console.error('Fatal batch execution error:', err);
  process.exit(1);
});
