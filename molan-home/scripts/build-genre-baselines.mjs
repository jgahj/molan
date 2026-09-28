// 题材基线构建：从资源库范本按题材抽取前 N 章，统计 9 字段指纹 + 结构维度，写入 data/genre-baselines/<题材>.json。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const metrics = require('../lib/benchmark-metrics.js');
const { GENRES, decodeSource, extractCompleteChapters, sha256, OFFSET_UNIT } = require('../lib/genre-evidence.js');

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const ARCHIVE_ROOT = path.resolve(REPO_ROOT, '..', '资源库', '小说原本');
const OUTPUT_DIR = path.join(REPO_ROOT, 'data', 'genre-baselines');

/** 解析命令行：--genres 玄幻,都市高武 --books 20 --chapters 3。 */
function parseArgs(argv) {
  const options = { genres: [], books: 20, chapters: 3 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--genres' && argv[index + 1]) options.genres = argv[++index].split(/[，,]/).map(item => item.trim()).filter(Boolean);
    else if (arg === '--books' && argv[index + 1]) options.books = Number(argv[++index]);
    else if (arg === '--chapters' && argv[index + 1]) options.chapters = Number(argv[++index]);
    else if (arg === '--encoding' && argv[index + 1]) options.encoding = argv[++index];
    else throw new Error(`不支持的参数：${arg}`);
  }
  if (![options.books, options.chapters].every(value => Number.isInteger(value) && value > 0)) throw new Error('books/chapters 必须为正整数');
  return options;
}

/** 从文本中切出前 count 章正文，章数不足则返回空数组。 */
export function extractChapters(text, count) {
  return extractCompleteChapters(text, count);
}

/** 对一个题材目录构建基线。 */
export function buildGenreBaseline(genre, options = {}) {
  if (typeof genre !== 'string' || !genre || /[\\/\u0000]/u.test(genre) || genre === '..') throw new Error('非法题材名');
  const dir = path.join(options.archiveRoot || ARCHIVE_ROOT, genre);
  if (!fs.existsSync(dir)) return { genre, status: 'missing', reason: '题材目录不存在' };
  const files = fs.readdirSync(dir).filter(name => name.toLowerCase().endsWith('.txt')).sort();
  const candidates = files.slice(0, options.books || 20);
  const books = [];
  const skipped = [];
  for (const name of candidates) {
    const filePath = path.join(dir, name);
    let chapters;
    let source;
    try {
      source = decodeSource(fs.readFileSync(filePath), { encoding: options.encoding });
      chapters = extractChapters(source.text, options.chapters || 3);
    } catch (error) {
      skipped.push({ title: name, reason: error.message });
      continue;
    }
    if (chapters.length < (options.chapters || 3)) {
      skipped.push({ title: name, reason: '缺少从第一章开始的连续完整章节及下一章边界；不以 EOF 证明完整' });
      continue;
    }
    const whole = chapters.map(chapter => chapter.body).join('\n\n');
    const fingerprint = metrics.computeTextFingerprint(whole);
    const structures = chapters.map(chapter => metrics.computeStructureStats(chapter.body));
    const nameAccumulation = [];
    const seen = new Set();
    for (const chapter of chapters) {
      for (const item of metrics.extractNameCandidates(chapter.body)) seen.add(item.name);
      nameAccumulation.push(seen.size);
    }
    books.push({ title: name.replace(/\.txt$/i, ''), filePath: path.relative(path.resolve(REPO_ROOT, '..'), filePath), source: { sha256: source.sourceSha256, decodedSha256: sha256(source.text), byteLength: source.byteLength, encoding: source.encoding, offsetUnit: OFFSET_UNIT }, chapters: chapters.map(({ body, paragraphs, ...chapter }) => ({ ...chapter, paragraphs: paragraphs.map(({ text, ...paragraph }) => paragraph) })), chapterTitles: chapters.map(chapter => chapter.title), fingerprint, chapterChars: structures.map(item => item.chars), structures, nameAccumulation });
  }
  if (!books.length) return { genre, status: 'empty', reason: '没有可解析出足够章节的范本', skipped };
  const baseline = metrics.aggregateBaseline(books.map(book => book.fingerprint));
  const allStructures = books.flatMap(book => book.structures);
  const mean = values => values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4)) : 0;
  const distribution = (values) => { const counts = {}; for (const value of values) counts[value] = (counts[value] || 0) + 1; const total = values.length || 1; return Object.fromEntries(Object.entries(counts).map(([key, count]) => [key, Number((count / total).toFixed(3))])); };
  const structureBaseline = {
    chapterCharsMean: mean(allStructures.map(item => item.chars)),
    chapterCharsP25: percentile(allStructures.map(item => item.chars), 0.25),
    chapterCharsP75: percentile(allStructures.map(item => item.chars), 0.75),
    singleSentenceParagraphRatio: mean(allStructures.map(item => item.singleSentenceParagraphRatio)),
    directPsychRatio: mean(allStructures.map(item => item.directPsychRatio)),
    onomatopoeiaParagraphRatio: mean(allStructures.map(item => item.onomatopoeiaParagraphRatio)),
    dialogueParagraphRatio: mean(allStructures.map(item => item.dialogueParagraphRatio)),
    openingModeDistribution: distribution(books.map(book => book.structures[0].openingMode)),
    endingModeDistribution: distribution(allStructures.map(item => item.endingMode)),
    nameAccumulationMean: Array.from({ length: options.chapters || 3 }, (_, index) => mean(books.map(book => book.nameAccumulation[index]).filter(Number.isFinite)))
  };
  return { schemaVersion: 2, measurementVersion: metrics.MEASUREMENT_VERSION, genre, status: 'ready', generatedAt: new Date().toISOString(), method: '完整文件严格解码；仅连续第1至N章且有下一章边界；原文不去作者注；UTF-16非空白字符计量。统计不是文学质量评分。', sampling: { method: 'sorted-file-window-without-refill', candidateLimit: options.books || 20, consideredCount: candidates.length, excludedCount: skipped.length }, limitations: ['下一章标题证明文件内边界，不证明采集原文没有缺页。', '目录/标题格式异常保守跳过；非UTF-8需显式指定编码。', '按文件名排序取样，不代表题材总体；人名与开篇/结尾分类仅启发式。'], skipped, bookCount: books.length, chaptersPerBook: options.chapters || 3, baseline, structureBaseline, books: books.map(book => ({ title: book.title, filePath: book.filePath, source: book.source, chapters: book.chapters, chapterTitles: book.chapterTitles, chapterChars: book.chapterChars, fingerprint: book.fingerprint, openingMode: book.structures[0].openingMode, endingModes: book.structures.map(item => item.endingMode) })) };
}

/** 分位数。 */
function percentile(values, ratio) {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

/** 主流程：逐题材构建并写文件，输出 index.json。 */
export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const genres = options.genres.length ? options.genres : GENRES;
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const index = [];
  for (const genre of genres) {
    const result = buildGenreBaseline(genre, options);
    fs.writeFileSync(path.join(OUTPUT_DIR, genre + '.json'), JSON.stringify(result, null, 2), 'utf8');
    index.push({ genre, status: result.status, bookCount: result.bookCount || 0, reason: result.reason || '' });
    console.log(`[genre-baseline] ${genre}: ${result.status} books=${result.bookCount || 0}`);
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, 'index.json'), JSON.stringify({ schemaVersion: 2, measurementVersion: metrics.MEASUREMENT_VERSION, generatedAt: new Date().toISOString(), genres: index }, null, 2), 'utf8');
  return 0;
}

if (path.resolve(process.argv[1] || '') === SCRIPT_PATH) process.exitCode = main();
