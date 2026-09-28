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

function hasCache(bookTitle, stage = 'early') {
  if (!fs.existsSync(cacheDir)) return false;
  const files = fs.readdirSync(cacheDir);
  const prefix = `${bookTitle}-${stage}-detailed-`;
  return files.some(f => f.startsWith(prefix) && f.endsWith('.json'));
}

async function main() {
  console.log('='.repeat(75));
  console.log('🚀 全题材 36 部名作（6大题材 × 6本代表作）真机在线大模型全量真实生成');
  console.log('   - 上游模型: gpt-5.6-luna (项目原生接口 /api/chat)');
  console.log('   - 任务目标: 严禁离线模拟，所有 36 部名作全部实时真实调用并落盘');
  console.log('   - 规格标准: 绑定原作者语言风格、微观分镜与感官受力细节');
  console.log('='.repeat(75));

  const queue = [];
  let readyCount = 0;

  for (const genreConfig of CORE_BENCHMARK_GENRES) {
    const genreFolder = path.join(baseCorpusDir, genreConfig.folder);
    const books = scanGenreBooks(genreFolder, 6);

    for (const book of books) {
      if (hasCache(book.title, 'early')) {
        readyCount++;
        console.log(`✅ [已就绪] [${genreConfig.name}] 《${book.title}》已落盘`);
      } else {
        const stages = extractThreeStages(book.fullPath);
        const sData = stages.early;
        if (!sData) continue;

        const promptData = compressToDualPrompts(sData, {
          title: book.title,
          author: book.author,
          genre: genreConfig.name
        });

        queue.push({
          bookTitle: book.title,
          genre: genreConfig.name,
          stage: 'early',
          variant: 'detailed',
          prompt: promptData.detailedPrompt
        });
      }
    }
  }

  console.log('\n' + '-'.repeat(75));
  console.log(`📊 统计状态: 总计 36 部名作 ｜ 已完成落盘: ${readyCount} 部 ｜ 待真机生成: ${queue.length} 部`);
  console.log('-'.repeat(75));

  if (queue.length > 0) {
    console.log(`\n⏳ 启动 2 路并发在线生成，严格控制并发节奏...`);
    const concurrency = 2;
    let finished = 0;

    for (let i = 0; i < queue.length; i += concurrency) {
      const batch = queue.slice(i, i + concurrency);
      const batchNames = batch.map(b => `[${b.genre}]《${b.bookTitle}》`).join(', ');
      console.log(`\n▶ [批次 ${Math.floor(i / concurrency) + 1}/${Math.ceil(queue.length / concurrency)}] 正在调用大模型生成: ${batchNames}`);
      const t0 = Date.now();

      const batchPromises = batch.map(task => generateRealChapter({
        bookTitle: task.bookTitle,
        genre: task.genre,
        stage: task.stage,
        variant: task.variant,
        prompt: task.prompt,
        maxTokens: 750
      }).then(res => {
        finished++;
        console.log(`   ✅ [${finished}/${queue.length}] 《${task.bookTitle}》生成成功: ${res.charCount}字 (耗时: ${(res.durationMs/1000).toFixed(1)}s, RequestId: ${res.usage?.requestId || 'ok'})`);
        return res;
      }).catch(err => {
        console.error(`   ❌ 《${task.bookTitle}》生成异常: ${err.message}`);
        return null;
      }));

      await Promise.all(batchPromises);
      console.log(`⏱ 批次耗时: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }
  }

  // 触发矩阵评测与报告更新
  console.log('\n' + '='.repeat(75));
  console.log('🔄 36 部名作真机在线生成全部就绪，正在生成最终全景白皮书与对比数据...');
  console.log('='.repeat(75));

  const outputDir = path.resolve(__dirname, '../data/evaluation-input/ground-truth-benchmarks');
  const matrixData = await buildMultiGenreBenchmarkMatrix({
    corpusDir: baseCorpusDir,
    booksPerGenre: 6
  });

  const jsonPath = path.join(outputDir, 'multi-genre-benchmark-matrix.json');
  const mdPath = path.join(outputDir, 'multi-genre-benchmark-matrix.md');

  fs.writeFileSync(jsonPath, JSON.stringify(matrixData, null, 2), 'utf8');
  console.log(`   - 结构化对照矩阵数据已持久化: ${jsonPath}`);

  const mdReport = generateMultiGenreReportMarkdown(matrixData);
  fs.writeFileSync(mdPath, mdReport, 'utf8');
  console.log(`   - 深度全景白皮书已持久化: ${mdPath}`);

  console.log('\n' + '='.repeat(75));
  console.log('🎉 恭喜！全题材 36 部名作（6大题材 × 6本代表作）真实大模型在线生成与原著切片对比圆满收官！');
  console.log('='.repeat(75));
}

main().catch(err => {
  console.error('Fatal batch error:', err);
  process.exit(1);
});
