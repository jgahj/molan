import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const RESOURCE_ROOT = path.resolve(REPO_ROOT, '..', '资源库');
const ARCHIVE_DIR_NAME = '小说原本';
const DEFAULT_ARCHIVE_ROOT = path.join(RESOURCE_ROOT, ARCHIVE_DIR_NAME);
const DEFAULT_OUTPUT_PATH = path.join(REPO_ROOT, 'data', 'style-fingerprints.json');

export const FINGERPRINT_RULES = Object.freeze({
  defaultSampleSize: 2,
  minimumTotalChars: 1,
  sentenceLenMeanMin: 10,
  sentenceLenMeanMax: 60,
  dialogueRatioMin: 0.05,
  dialogueRatioMax: 0.9
});

const SENTENCE_SPLIT_PATTERN = /(?<=[。！？])/u;
const SENTENCE_TERMINATORS = new Set(['。', '！', '？']);
const DIALOGUE_OPEN_CHAR = '“';
const DIALOGUE_CLOSE_CHAR = '”';
const COMMA_CHAR = '，';
const PERIOD_CHAR = '。';
const SIMILE_PATTERN = /像|仿佛|宛如|如同|好似|恍若/gu;
const WHITESPACE_PATTERN = /\s+/gu;
const STOP_PUNCTUATION_PATTERN = /[\p{P}\p{S}]/gu;

/**
 * 将数值四舍五入到指定小数位，避免输出浮点噪声。
 */
function roundTo(value, digits = 4) {
  return Number((Number(value) || 0).toFixed(digits));
}

/**
 * 统计某个单字符在文本中出现的次数。
 */
function countChar(text, char) {
  let count = 0;
  let index = text.indexOf(char);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(char, index + 1);
  }
  return count;
}

/**
 * 创建风格指纹流式累积器，承载跨行、跨块的全部统计状态。
 */
export function createStyleAccumulator() {
  return {
    totalChars: 0,
    sentenceCount: 0,
    sentenceLenSum: 0,
    sentenceLenSumSq: 0,
    pendingSentenceLen: 0,
    paragraphCount: 0,
    paragraphLenSum: 0,
    paragraphLenSumSq: 0,
    currentParagraphLen: 0,
    inDialogue: false,
    currentTurnLen: 0,
    dialogueCharCount: 0,
    dialogueTurnCount: 0,
    dialogueTurnLenSum: 0,
    commaCount: 0,
    periodCount: 0,
    simileHitCount: 0,
    bigramTotal: 0,
    bigramTypes: new Set(),
    pendingBigramChar: ''
  };
}

/**
 * 记录一个已完成句子的长度，并更新句长的一阶与二阶累积量。
 */
function recordSentence(acc, length) {
  acc.sentenceCount += 1;
  acc.sentenceLenSum += length;
  acc.sentenceLenSumSq += length * length;
}

/**
 * 记录一个已完成段落的长度，并更新段长的一阶与二阶累积量。
 */
function recordParagraph(acc, length) {
  acc.paragraphCount += 1;
  acc.paragraphLenSum += length;
  acc.paragraphLenSumSq += length * length;
}

/**
 * 将一行正文喂入累积器：按空行切段、按句终符切句、成对引号状态机、
 * 逗号句号计数、比喻词命中以及去停用标点后的字符 bigram 统计。
 */
export function accumulateStyleLine(acc, line) {
  const compact = String(line ?? '').replace(WHITESPACE_PATTERN, '');
  if (!compact) {
    if (acc.currentParagraphLen > 0) {
      recordParagraph(acc, acc.currentParagraphLen);
      acc.currentParagraphLen = 0;
    }
    return;
  }
  acc.totalChars += compact.length;
  acc.currentParagraphLen += compact.length;

  const fragments = compact.split(SENTENCE_SPLIT_PATTERN);
  for (const fragment of fragments) {
    if (!fragment) continue;
    if (SENTENCE_TERMINATORS.has(fragment.charAt(fragment.length - 1))) {
      recordSentence(acc, acc.pendingSentenceLen + fragment.length);
      acc.pendingSentenceLen = 0;
    } else {
      acc.pendingSentenceLen += fragment.length;
    }
  }

  acc.commaCount += countChar(compact, COMMA_CHAR);
  acc.periodCount += countChar(compact, PERIOD_CHAR);

  const simileHits = compact.match(SIMILE_PATTERN);
  if (simileHits) acc.simileHitCount += simileHits.length;

  for (let index = 0; index < compact.length; index += 1) {
    const ch = compact.charAt(index);
    if (ch === DIALOGUE_OPEN_CHAR) {
      acc.inDialogue = true;
      acc.currentTurnLen = 0;
    } else if (ch === DIALOGUE_CLOSE_CHAR) {
      if (acc.inDialogue) {
        acc.dialogueTurnCount += 1;
        acc.dialogueTurnLenSum += acc.currentTurnLen;
        acc.dialogueCharCount += acc.currentTurnLen;
        acc.inDialogue = false;
        acc.currentTurnLen = 0;
      }
    } else if (acc.inDialogue) {
      acc.currentTurnLen += 1;
    }
  }

  const filtered = compact.replace(STOP_PUNCTUATION_PATTERN, '');
  let previous = acc.pendingBigramChar;
  for (let index = 0; index < filtered.length; index += 1) {
    const ch = filtered.charAt(index);
    if (previous) {
      acc.bigramTotal += 1;
      acc.bigramTypes.add(previous + ch);
    }
    previous = ch;
  }
  if (filtered.length) acc.pendingBigramChar = previous;
}

/**
 * 在单个文件读取结束时收尾：落记录残余句与残余段、丢弃未闭合的对话轮，
 * 并重置跨文件不应延续的状态（bigram 前导字符）。
 */
export function finishStyleFile(acc) {
  if (acc.pendingSentenceLen > 0) {
    recordSentence(acc, acc.pendingSentenceLen);
    acc.pendingSentenceLen = 0;
  }
  if (acc.currentParagraphLen > 0) {
    recordParagraph(acc, acc.currentParagraphLen);
    acc.currentParagraphLen = 0;
  }
  acc.inDialogue = false;
  acc.currentTurnLen = 0;
  acc.pendingBigramChar = '';
}

/**
 * 以 readline 流式读取一个 txt 文件并累积风格统计量，避免整书载入内存。
 */
export async function accumulateStyleFile(acc, filePath) {
  const rl = readline.createInterface({ input: fs.createReadStream(filePath, 'utf8'), crlfDelay: Infinity });
  try {
    for await (const line of rl) accumulateStyleLine(acc, line);
  } finally {
    rl.close();
  }
  finishStyleFile(acc);
}

/**
 * 将累积器汇总为最终指纹对象：句长/段长均值与总体标准差、对话占比、
 * 对话轮均值、逗号句号比、bigram ttr、每千字比喻词，并做合理性校验。
 */
export function finalizeFingerprint(acc) {
  const sentenceMean = acc.sentenceCount > 0 ? acc.sentenceLenSum / acc.sentenceCount : 0;
  const sentenceStd = acc.sentenceCount > 1 ? Math.sqrt(Math.max(0, acc.sentenceLenSumSq / acc.sentenceCount - sentenceMean * sentenceMean)) : 0;
  const paragraphMean = acc.paragraphCount > 0 ? acc.paragraphLenSum / acc.paragraphCount : 0;
  const paragraphStd = acc.paragraphCount > 1 ? Math.sqrt(Math.max(0, acc.paragraphLenSumSq / acc.paragraphCount - paragraphMean * paragraphMean)) : 0;
  const fingerprint = {
    sentenceLenMean: roundTo(sentenceMean, 4),
    sentenceLenStd: roundTo(sentenceStd, 4),
    paragraphLenMean: roundTo(paragraphMean, 4),
    paragraphLenStd: roundTo(paragraphStd, 4),
    dialogueRatio: acc.totalChars > 0 ? roundTo(acc.dialogueCharCount / acc.totalChars, 6) : 0,
    dialogueTurnMean: acc.dialogueTurnCount > 0 ? roundTo(acc.dialogueTurnLenSum / acc.dialogueTurnCount, 4) : 0,
    commaPeriodRatio: acc.periodCount > 0 ? roundTo(acc.commaCount / acc.periodCount, 4) : null,
    ttr: acc.bigramTotal > 0 ? roundTo(acc.bigramTypes.size / acc.bigramTotal, 6) : 0,
    similePerKilo: acc.totalChars > 0 ? roundTo(acc.simileHitCount * 1000 / acc.totalChars, 4) : 0,
    warning: []
  };
  if (fingerprint.sentenceLenMean < FINGERPRINT_RULES.sentenceLenMeanMin || fingerprint.sentenceLenMean > FINGERPRINT_RULES.sentenceLenMeanMax) {
    fingerprint.warning.push('sentenceLenMeanOutOfRange');
  }
  if (fingerprint.dialogueRatio < FINGERPRINT_RULES.dialogueRatioMin || fingerprint.dialogueRatio > FINGERPRINT_RULES.dialogueRatioMax) {
    fingerprint.warning.push('dialogueRatioOutOfRange');
  }
  return fingerprint;
}

/**
 * 判断目标路径是否落在指定目录内部（含恰好等于该目录本身），
 * 用于确保输出文件永远不会写进资源库。
 */
function isInsideDirectory(target, directory) {
  const relative = path.relative(directory, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * 只读扫描 小说原本 下的一级题材子目录：返回按桶名稳定排序的桶清单，
 * 每个桶携带按文件名稳定排序的直接子级 .txt 文件名（不递归、不写入）。
 */
export function listArchiveBuckets(archiveRoot = DEFAULT_ARCHIVE_ROOT) {
  const buckets = [];
  let entries;
  try {
    entries = fs.readdirSync(archiveRoot, { withFileTypes: true });
  } catch {
    return buckets;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let names;
    try {
      names = fs.readdirSync(path.join(archiveRoot, entry.name), { withFileTypes: true });
    } catch {
      continue;
    }
    const txtNames = names
      .filter(item => item.isFile() && item.name.toLowerCase().endsWith('.txt'))
      .map(item => item.name)
      .sort();
    if (txtNames.length > 0) buckets.push({ bucket: entry.name, files: txtNames });
  }
  return buckets.sort((a, b) => (a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0));
}

/**
 * 从单个桶的文件列表中抽取前 N 本（N 不小于文件数时取全部），
 * 抽取顺序为文件名稳定排序，保证结果可复现。
 */
function sampleBucketFiles(files, sampleSize) {
  if (!Number.isFinite(sampleSize)) return files.slice();
  return files.slice(0, Math.max(0, Math.floor(sampleSize)));
}

/**
 * 依据相对资源库的文件路径生成稳定书籍 ID（book- + sha256 前 12 位十六进制）。
 */
function deriveBookId(relativePath) {
  return `book-${createHash('sha256').update(relativePath).digest('hex').slice(0, 12)}`;
}

/**
 * 以临时文件加重命名的方式原子写入 JSON，避免半截文件。
 */
function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

/**
 * 风格指纹构建主流程：只读遍历 小说原本 的一级题材子目录（bucket 取子目录名），
 * 按 sample/all 决定每桶抽取本数，逐本流式计算指纹并写入输出 JSON；
 * 对资源库全程只读，输出路径一旦指向资源库内部即阻断。
 */
export async function buildStyleFingerprints(options = {}) {
  const archiveRoot = path.resolve(options.archiveRoot || DEFAULT_ARCHIVE_ROOT);
  const outputPath = path.resolve(options.outputPath || DEFAULT_OUTPUT_PATH);
  const resourceRoot = path.dirname(archiveRoot);
  if (isInsideDirectory(outputPath, resourceRoot)) {
    return { status: 'blocked', reason: 'output_inside_resource_root', archiveRoot, outputPath };
  }
  let archiveStat = null;
  try {
    archiveStat = fs.statSync(archiveRoot);
  } catch {
    archiveStat = null;
  }
  if (!archiveStat || !archiveStat.isDirectory()) {
    return { status: 'blocked', reason: 'archive_root_missing', archiveRoot, outputPath };
  }
  const buckets = listArchiveBuckets(archiveRoot);
  if (buckets.length === 0) {
    return { status: 'blocked', reason: 'no_genre_buckets_found', archiveRoot, outputPath };
  }
  const sampleSize = options.all ? Infinity : Math.max(0, options.sample ?? FINGERPRINT_RULES.defaultSampleSize);

  const books = [];
  const skippedBooks = [];
  let processedCount = 0;
  for (const bucket of buckets) {
    for (const fileName of sampleBucketFiles(bucket.files, sampleSize)) {
      processedCount += 1;
      const relativePath = `${ARCHIVE_DIR_NAME}/${bucket.bucket}/${fileName}`;
      const record = {
        id: deriveBookId(relativePath),
        title: fileName.replace(/\.txt$/iu, ''),
        bucket: bucket.bucket,
        primaryGenre: ''
      };
      const acc = createStyleAccumulator();
      try {
        await accumulateStyleFile(acc, path.join(archiveRoot, bucket.bucket, fileName));
      } catch (error) {
        skippedBooks.push({ ...record, reason: `read_error:${error?.code || error?.message || 'unknown'}` });
        continue;
      }
      if (acc.totalChars < FINGERPRINT_RULES.minimumTotalChars) {
        skippedBooks.push({ ...record, reason: 'no_content' });
        continue;
      }
      books.push({ ...record, filePath: relativePath, fingerprint: finalizeFingerprint(acc) });
    }
  }

  const output = {
    schemaVersion: 'style-fingerprints-1',
    generatedAt: new Date().toISOString(),
    bookCount: books.length,
    books,
    skippedBooks,
    summary: {
      processedCount,
      successCount: books.length,
      skippedCount: skippedBooks.length,
      excludedBookCount: 0,
      warningCount: books.filter(book => book.fingerprint.warning.length > 0).length
    }
  };
  writeJsonAtomic(outputPath, output);
  return { status: 'ready', bucketCount: buckets.length, ...output };
}

/**
 * 解析命令行参数：--sample N（每桶抽样 N 本，默认 2）、--all（处理全部）。
 */
export function parseArgs(argv = []) {
  const options = {
    sample: FINGERPRINT_RULES.defaultSampleSize,
    all: false,
    outputPath: DEFAULT_OUTPUT_PATH
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] ?? '';
    if (arg === '--sample') {
      const value = Number(next());
      if (Number.isFinite(value) && value > 0) options.sample = Math.floor(value);
    } else if (arg === '--all') {
      options.all = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }
  return options;
}

/**
 * 向控制台输出本次构建的统计摘要：覆盖桶数、成功本数、失败列表与告警数量。
 */
function printSummary(output) {
  const summary = output.summary;
  console.log(`[style-fingerprints] 覆盖 ${output.bucketCount} 个题材桶，候选 ${summary.processedCount} 本：成功 ${summary.successCount} 本，失败 ${summary.skippedCount} 本`);
  if (summary.warningCount > 0) console.log(`[style-fingerprints] 指纹合理性告警：${summary.warningCount} 本`);
  for (const skipped of output.skippedBooks) {
    console.log(`[style-fingerprints] 失败 - ${skipped.id} ${skipped.title}（${skipped.bucket}）：${skipped.reason}`);
  }
}

/**
 * 命令行入口：解析参数、执行构建、打印统计摘要并返回退出码。
 */
export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('用法：node scripts/build-style-fingerprints.mjs [--sample N] [--all]（--sample N：每桶抽样 N 本，默认 2；--all：处理全部）');
    return 0;
  }
  const result = await buildStyleFingerprints(options);
  if (result.status === 'blocked') {
    console.error(`[style-fingerprints] 构建被阻断：${result.reason}`);
    return 2;
  }
  printSummary(result);
  console.log(`[style-fingerprints] 已写入 ${options.outputPath}`);
  return 0;
}

if (path.resolve(process.argv[1] || '') === SCRIPT_PATH) process.exitCode = await main();
