import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { scanGenreBooks, extractThreeStages, compressToDualPrompts } = require('../lib/ground-truth-extractor.js');
const { generateRealChapter } = require('../lib/real-novel-generator.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baseCorpusDir = path.resolve(__dirname, '../../资源库/小说原本');

// 剩余 4 大核心主战题材代表作清单
const TARGET_JOBS = [
  // 1. 都市
  {
    genre: '都市',
    bookTitle: '1984：从破产川菜馆开始',
    filename: '1984：从破产川菜馆开始 - 轻语江湖.txt',
    stages: ['early']
  },
  // 2. 悬疑灵异
  {
    genre: '悬疑灵异',
    bookTitle: '一个民间阴阳先生的真实经历',
    filename: '一个民间阴阳先生的真实经历.txt',
    stages: ['early']
  },
  // 3. 历史脑洞
  {
    genre: '历史脑洞',
    bookTitle: '三国：开局项羽模板，你当谋士？',
    filename: '三国：开局项羽模板，你当谋士？.txt',
    stages: ['early']
  },
  // 4. 青春甜宠
  {
    genre: '青春甜宠',
    bookTitle: '坏兄妹',
    filename: '坏兄妹.txt',
    stages: ['early']
  }
];

async function main() {
  console.log('='.repeat(70));
  console.log('🚀 启动全题材真机小说生成批处理 Part 2 (Model: gpt-5.6-luna / Endpoint: /api/chat)');
  console.log('='.repeat(70));

  const tasks = [];

  for (const job of TARGET_JOBS) {
    const filePath = path.join(baseCorpusDir, job.genre, job.filename);
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️ 文件不存在: ${filePath}`);
      continue;
    }

    const stages = extractThreeStages(filePath);
    for (const stageKey of job.stages) {
      const sData = stages[stageKey];
      if (!sData) continue;

      const promptData = compressToDualPrompts(sData, {
        title: job.bookTitle,
        author: stages.author || '名家',
        genre: job.genre
      });

      // 详细版
      tasks.push({
        bookTitle: job.bookTitle,
        genre: job.genre,
        stage: stageKey,
        variant: 'detailed',
        prompt: promptData.detailedPrompt
      });

      // 粗略版
      tasks.push({
        bookTitle: job.bookTitle,
        genre: job.genre,
        stage: stageKey,
        variant: 'coarse',
        prompt: promptData.coarsePrompt
      });
    }
  }

  console.log(`📋 共规划 ${tasks.length} 个真机生成任务，开始并行并发执行...`);

  // 并发控制：每次 2 个并发任务
  const concurrency = 2;
  const results = [];

  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    console.log(`\n⏳ 正在执行批次 [${Math.floor(i / concurrency) + 1}/${Math.ceil(tasks.length / concurrency)}]: ${batch.map(b => `${b.bookTitle}(${b.stage}-${b.variant})`).join(', ')}`);
    const t0 = Date.now();

    const batchPromises = batch.map(t => generateRealChapter({
      bookTitle: t.bookTitle,
      genre: t.genre,
      stage: t.stage,
      variant: t.variant,
      prompt: t.prompt,
      maxTokens: 1200
    }).then(res => {
      console.log(`   ✅ [${res.isFromCache ? '命中缓存' : '实时生成'}] 《${t.bookTitle}》(${t.stage}-${t.variant}): ${res.charCount}字 (耗时: ${(res.durationMs/1000).toFixed(1)}s)`);
      return res;
    }).catch(err => {
      console.error(`   ❌ 《${t.bookTitle}》(${t.stage}-${t.variant}) 失败: ${err.message}`);
      return null;
    }));

    const batchRes = await Promise.all(batchPromises);
    results.push(...batchRes);
    console.log(`⏱ 批次耗时: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  const successCount = results.filter(r => r && r.ok).length;
  console.log('\n' + '='.repeat(70));
  console.log(`🏁 真机生成批处理 Part 2 完成: 成功 ${successCount} / ${tasks.length} 任务`);
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('Fatal batch error:', err);
  process.exit(1);
});
