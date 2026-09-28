import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  batchPreprocessRealGeneratedNovels,
  validateGeneratedNovelProfile
} from '../lib/generated-novel-preprocessor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baseDir = path.resolve(__dirname, '..');

console.log('=== [36部真实生成小说全量预处理引擎] 启动 ===\n');
console.log('执行原则：严格基于 ground-truth-benchmarks/real-generated-chapters 真实生成数据，绝无虚假！');

const startTime = Date.now();
const res = batchPreprocessRealGeneratedNovels({ baseDir });

console.log(`\n✓ 批量预处理完成！共处理真实小说: ${res.total} 部\n`);

// 按照题材分类展示
const genres = {};
let totalChars = 0;
let totalTokens = 0;

for (const p of res.profiles) {
  if (!genres[p.genre]) genres[p.genre] = [];
  genres[p.genre].push(p);
  totalChars += p.charCount;
}

for (const [genre, list] of Object.entries(genres)) {
  console.log(`\n========================================`);
  console.log(`题材: 【${genre}】 (真实生成 ${list.length} 本)`);
  console.log(`========================================`);
  for (const item of list) {
    // 读取完整生成的 profile 验证结构
    const profilePath = item.outPath;
    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    const val = validateGeneratedNovelProfile(profile);
    if (!val.valid) {
      console.error(`❌ [${item.bookTitle}] 契约校验失败:`, val.error);
      process.exit(1);
    }
    const reqId = item.requestId || profile.metadata.value.requestId || 'n/a';
    console.log(`✓ 《${item.bookTitle}》 [${item.stage}-${item.variant}]`);
    console.log(`    - 篇幅: ${item.charCount} 字符 | AI味: ${item.aiFlavorScore}分 | 对话比: ${(item.dialogueRatio * 100).toFixed(1)}%`);
    console.log(`    - 模型: ${item.model} | 请求ID: ${reqId}`);
    console.log(`    - 七级粒度: 全书(1) -> 卷(1) -> 篇章(${profile.granularity_summary.arcs}) -> 场景(${profile.granularity_summary.scenes}) -> 段落(${profile.granularity_summary.paragraphs}) -> 句子(${profile.granularity_summary.sentences})`);
  }
}

console.log(`\n----------------------------------------`);
console.log(`全题材 36 部真实小说总字数: ${totalChars.toLocaleString()} 字符`);
console.log(`耗时: ${Date.now() - startTime} ms`);
console.log(`索引文件: data/evaluation-input/generated-novel-profiles/index-36-real-books.json`);
console.log(`所有 36 本小说画像已固化入磁盘，供盲测、缺陷检测与根因分析系统作为绝对真值基准！\n`);
