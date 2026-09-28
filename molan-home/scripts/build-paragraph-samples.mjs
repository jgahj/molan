import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { anonymizeParagraphSample } = require('../lib/character-material.js');

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const RESOURCE_ROOT = path.resolve(REPO_ROOT, '..', '资源库');
const ARCHIVE_DIR_NAME = '小说原本';
const DEFAULT_ARCHIVE_ROOT = path.join(RESOURCE_ROOT, ARCHIVE_DIR_NAME);
const DEFAULT_OUTPUT_PATH = path.join(REPO_ROOT, 'data', 'paragraph-samples.json');

// 段落样本构建规则：每桶取前 3 本、每本抽 4 个段落组、组内 3-5 个自然段、总长 300-800 字。
// 短段落风格的书（平均段长约 30 字）在 3-5 段内无法达到 300 字下限，此时允许把窗口
// 扩展到硬上限 15 段以满足字数约束；300-800 字约束始终不变。
export const PARAGRAPH_SAMPLE_RULES = Object.freeze({
  booksPerBucket: 3,
  groupsPerBook: 4,
  minGroupChars: 300,
  maxGroupChars: 800,
  minParagraphsPerGroup: 3,
  maxParagraphsPerGroup: 5,
  maxParagraphsPerGroupHardCap: 15,
  maxSingleParagraphChars: 600,
  dialogueRatioThreshold: 0.4,
  appearanceKeywordHits: 3
});

// 章节卷标题行（含“第X章/节/卷/回/部/集/幕”与常见独立标题），命中即整组跳过。
const CHAPTER_TITLE_PATTERN = /^\s*(?:第[〇零一二三四五六七八九十百千万0-9]{1,12}\s*[章节卷回部集幕]|正文卷|序章|楔子|尾声|番外)/u;
const CJK_CHAR_PATTERN = /[\u4e00-\u9fff]/gu;
const DIALOGUE_OPEN_CHAR = '“';
const DIALOGUE_CLOSE_CHAR = '”';
const PARAGRAPH_JOINER = '\n\n';
// 外貌启发式关键词：整组命中 >= 3 处判定为 appearance 维度。
const APPEARANCE_KEYWORDS = Object.freeze(['脸', '眼', '眉', '唇', '手指', '身形', '皮肤', '发丝', '衣着', '衣袍', '长裙', '胡须']);
// 声音维度：关键词后紧跟（允许少量过渡字）左引号，视为引语前缀。
const VOICE_QUOTE_PREFIX_PATTERN = /(?:声音|语气|嗓音|开口|低吼|轻笑)[^“”]{0,6}“/u;
// 与 lib/character-material.js 的 SENSITIVE_PATTERN 口径保持一致，构建期排除显性内容段落组。
const SENSITIVE_PATTERN = /露骨|下身|阴茎|阴部|乳房|乳头|性交|做爱|高潮|插入|性器官|呻吟|床笫|媾合|肉棒|精液|裸身|裸体|春药|发情|淫靡|潮吹|奸淫/i;

/**
 * 判断目标路径是否落在指定目录内部（含恰好等于该目录本身），
 * 用于确保输出文件永远不会写进资源库（输出路径守卫）。
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
 * 判断一个自然段是否为有效正文段落：排除章节标题行、纯数字行/分隔线行
 * （以“至少包含 2 个中文字符”代替显式数字判断）以及超长无换行的段落。
 */
function isProseParagraph(text) {
  if (CHAPTER_TITLE_PATTERN.test(text)) return false;
  const cjkMatches = text.match(CJK_CHAR_PATTERN);
  if (!cjkMatches || cjkMatches.length < 2) return false;
  if (text.length > PARAGRAPH_SAMPLE_RULES.maxSingleParagraphChars) return false;
  return true;
}

/**
 * 把整本书的原始文本切分为带有效标记的自然段序列：非空行各为一个自然段，
 * 空行仅作分隔符忽略；无效段落保留在序列中以打断段落组的连续性。
 */
function extractParagraphSequence(content) {
  const lines = String(content || '').replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  const paragraphs = [];
  for (const line of lines) {
    const text = line.trim();
    if (!text) continue;
    paragraphs.push({ text, valid: isProseParagraph(text) });
  }
  return paragraphs;
}

/**
 * 用状态机统计一段文本中成对引号（“”）内部的字符数与完整对话轮数，
 * 未闭合的引号不计入，避免半截对话污染对话占比。
 */
function countDialogueStats(text) {
  let inDialogue = false;
  let currentLen = 0;
  let charCount = 0;
  let turnCount = 0;
  for (const ch of String(text || '')) {
    if (ch === DIALOGUE_OPEN_CHAR) {
      inDialogue = true;
      currentLen = 0;
    } else if (ch === DIALOGUE_CLOSE_CHAR) {
      if (inDialogue) {
        charCount += currentLen;
        turnCount += 1;
        inDialogue = false;
      }
      currentLen = 0;
    } else if (inDialogue) {
      currentLen += 1;
    }
  }
  return { charCount, turnCount };
}

/**
 * 统计某个关键词在文本中出现的次数（不使用正则，避免特殊字符转义问题）。
 */
function countKeywordOccurrences(text, keyword) {
  let count = 0;
  let start = 0;
  while (true) {
    const index = text.indexOf(keyword, start);
    if (index < 0) break;
    count += 1;
    start = index + keyword.length;
  }
  return count;
}

/**
 * 按启发式规则为段落组标注描写维度：
 * 对话占比 > 0.4 → dialogue；外貌关键词命中 >= 3 处 → appearance；
 * 声音类关键词作为引语前缀 → voice；否则 → action。
 */
function classifyParagraphDimension(text, dialogueRatio) {
  if (dialogueRatio > PARAGRAPH_SAMPLE_RULES.dialogueRatioThreshold) return 'dialogue';
  const appearanceHits = APPEARANCE_KEYWORDS.reduce((sum, keyword) => sum + countKeywordOccurrences(text, keyword), 0);
  if (appearanceHits >= PARAGRAPH_SAMPLE_RULES.appearanceKeywordHits) return 'appearance';
  if (VOICE_QUOTE_PREFIX_PATTERN.test(text)) return 'voice';
  return 'action';
}

/**
 * 在自然段序列上做不重叠滑窗，枚举候选段落组：从每个起点自小到大扩展窗口，
 * 优先取能达到 300 字下限的最小段数（常规书为 3-5 段）；短段落风格的书允许
 * 继续扩展到硬上限 15 段补足字数。组内段落必须全部有效，拼接总长一旦超过
 * 800 字立即停止扩展（继续加段只会更长）。
 */
function collectCandidateGroups(paragraphs, rules = PARAGRAPH_SAMPLE_RULES) {
  const groups = [];
  const { minParagraphsPerGroup, maxParagraphsPerGroupHardCap, minGroupChars, maxGroupChars } = rules;
  let start = 0;
  while (start < paragraphs.length) {
    if (!paragraphs[start].valid) {
      start += 1;
      continue;
    }
    let formed = null;
    for (let size = minParagraphsPerGroup; size <= maxParagraphsPerGroupHardCap; size += 1) {
      const end = start + size;
      if (end > paragraphs.length) break;
      if (paragraphs.slice(start, end).some(item => !item.valid)) break;
      const text = paragraphs.slice(start, end).map(item => item.text).join(PARAGRAPH_JOINER);
      if (text.length > maxGroupChars) break;
      if (text.length >= minGroupChars) {
        formed = { start, end, text, charCount: text.length, paragraphCount: size };
        break;
      }
    }
    if (formed) {
      groups.push(formed);
      start = formed.end;
    } else {
      start += 1;
    }
  }
  return groups;
}

/**
 * 从候选段落组中挑选每本的优质组：先剔除显性敏感内容，再按分层优先级抽取——
 * 1) 3-5 段规范形态且含对话；2) 3-5 段规范形态；3) 含对话（短段落书的扩展组）；
 * 4) 其余候选。同层内等距抽取保证覆盖全书不同位置，高层不足时逐层补齐。
 */
function selectQualityGroups(candidates, count, rules = PARAGRAPH_SAMPLE_RULES) {
  const safeCandidates = candidates.filter(group => !SENSITIVE_PATTERN.test(group.text));
  const { minParagraphsPerGroup, maxParagraphsPerGroup } = rules;
  const isSpecShaped = group => group.paragraphCount >= minParagraphsPerGroup && group.paragraphCount <= maxParagraphsPerGroup;
  const hasDialogue = group => countDialogueStats(group.text).turnCount > 0;
  const tiers = [
    safeCandidates.filter(group => isSpecShaped(group) && hasDialogue(group)),
    safeCandidates.filter(group => isSpecShaped(group)),
    safeCandidates.filter(group => hasDialogue(group)),
    safeCandidates
  ];
  const picked = [];
  const usedStarts = new Set();
  for (const tier of tiers) {
    if (picked.length >= count) break;
    const pool = tier.filter(group => !usedStarts.has(group.start));
    if (!pool.length) continue;
    const remaining = count - picked.length;
    const step = Math.max(1, Math.floor(pool.length / remaining));
    for (let index = 0; picked.length < count && index * step < pool.length; index += 1) {
      const group = pool[index * step];
      picked.push(group);
      usedStarts.add(group.start);
    }
  }
  return picked;
}

/**
 * 将数值四舍五入到指定小数位，避免输出浮点噪声。
 */
function roundTo(value, digits = 4) {
  return Number((Number(value) || 0).toFixed(digits));
}

/**
 * 把一个段落组组装为最终样本记录：稳定内容哈希 ID、启发式维度、
 * 对话占比、字数、来源书名与资源库相对路径。
 */
function buildParagraphSampleRecord(bucket, fileName, group) {
  const relativePath = `${ARCHIVE_DIR_NAME}/${bucket}/${fileName}`;
  const dialogue = countDialogueStats(group.text);
  const dialogueRatio = group.charCount > 0 ? dialogue.charCount / group.charCount : 0;
  const anonymized = anonymizeParagraphSample(group.text, relativePath);
  return {
    id: `para-${createHash('sha256').update(`${relativePath}#${group.text}`).digest('hex').slice(0, 16)}`,
    bucket,
    dimension: classifyParagraphDimension(group.text, dialogueRatio),
    dialogueRatio: roundTo(dialogueRatio, 4),
    charCount: group.charCount,
    sourceTitle: fileName.replace(/\.txt$/iu, ''),
    filePath: relativePath,
    text: group.text,
    anonymizedText: anonymized.anonymizedText
  };
}

/**
 * 从单本书抽取优质段落组记录：读取全文、切分自然段、滑窗枚举候选组、
 * 按质量规则挑选；读取失败或无有效组时返回空数组。
 */
function extractBookSamples(archiveRoot, bucket, fileName, rules = PARAGRAPH_SAMPLE_RULES) {
  let content;
  try {
    content = fs.readFileSync(path.join(archiveRoot, bucket, fileName), 'utf8');
  } catch {
    return [];
  }
  const paragraphs = extractParagraphSequence(content);
  if (paragraphs.length < rules.minParagraphsPerGroup) return [];
  const candidates = collectCandidateGroups(paragraphs, rules);
  return selectQualityGroups(candidates, rules.groupsPerBook, rules)
    .map(group => buildParagraphSampleRecord(bucket, fileName, group));
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
 * 段落样本构建主流程：只读遍历 小说原本 的一级题材子目录（bucket 取子目录名），
 * 每桶按文件名稳定排序取前 3 本、每本抽 4 个优质段落组，写入输出 JSON；
 * 对资源库全程只读，输出路径一旦指向资源库内部即阻断。
 */
export function buildParagraphSamples(options = {}) {
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
  const rules = { ...PARAGRAPH_SAMPLE_RULES, ...(options.rules || {}) };
  const archiveBuckets = listArchiveBuckets(archiveRoot);
  if (archiveBuckets.length === 0) {
    return { status: 'blocked', reason: 'no_genre_buckets_found', archiveRoot, outputPath };
  }

  const buckets = [];
  const dimensionDistribution = {};
  const paragraphCountDistribution = {};
  let totalSampleCount = 0;
  let processedBookCount = 0;
  let skippedBookCount = 0;
  for (const archiveBucket of archiveBuckets) {
    const bookFiles = archiveBucket.files.slice(0, rules.booksPerBucket);
    const samples = [];
    for (const fileName of bookFiles) {
      processedBookCount += 1;
      const bookSamples = extractBookSamples(archiveRoot, archiveBucket.bucket, fileName, rules);
      if (!bookSamples.length) {
        skippedBookCount += 1;
        continue;
      }
      samples.push(...bookSamples);
    }
    for (const sample of samples) {
      dimensionDistribution[sample.dimension] = (dimensionDistribution[sample.dimension] || 0) + 1;
    }
    totalSampleCount += samples.length;
    buckets.push({ bucket: archiveBucket.bucket, sampleCount: samples.length, samples });
  }

  const output = {
    schemaVersion: 'paragraph-samples-1',
    generatedAt: new Date().toISOString(),
    buckets
  };
  writeJsonAtomic(outputPath, output);
  for (const bucket of buckets) {
    for (const sample of bucket.samples) {
      const paragraphs = sample.text.split(PARAGRAPH_JOINER).length;
      const band = paragraphs <= PARAGRAPH_SAMPLE_RULES.maxParagraphsPerGroup ? '3-5段' : '6-15段';
      paragraphCountDistribution[band] = (paragraphCountDistribution[band] || 0) + 1;
    }
  }
  return {
    status: 'ready',
    outputPath,
    bucketCount: buckets.length,
    totalSampleCount,
    processedBookCount,
    skippedBookCount,
    dimensionDistribution,
    paragraphCountDistribution,
    buckets
  };
}

/**
 * 解析命令行参数：--output PATH（输出路径，默认 data/paragraph-samples.json）。
 */
export function parseArgs(argv = []) {
  const options = { outputPath: DEFAULT_OUTPUT_PATH };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] ?? '';
    if (arg === '--output') {
      const value = next();
      if (value) options.outputPath = value;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }
  return options;
}

/**
 * 向控制台输出本次构建的统计摘要：覆盖桶数、样本总数、维度分布、
 * 段落数分布（3-5 段为主，带 + 的为短段落书扩展组）与跳过本数。
 */
function printSummary(result) {
  console.log(`[paragraph-samples] 覆盖 ${result.bucketCount} 个题材桶，共 ${result.totalSampleCount} 条段落样本（处理 ${result.processedBookCount} 本，跳过 ${result.skippedBookCount} 本）`);
  const dimensions = Object.entries(result.dimensionDistribution)
    .sort((left, right) => right[1] - left[1])
    .map(([dimension, count]) => `${dimension}:${count}`);
  console.log(`[paragraph-samples] 维度分布：${dimensions.join('、') || '无'}`);
  const paragraphCounts = Object.entries(result.paragraphCountDistribution)
    .map(([band, count]) => `${band}:${count}`);
  console.log(`[paragraph-samples] 段落数分布：${paragraphCounts.join('、') || '无'}`);
}

/**
 * 命令行入口：解析参数、执行构建、打印统计摘要并返回退出码。
 */
export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('用法：node scripts/build-paragraph-samples.mjs [--output PATH]（每桶取文件名排序前 3 本，每本抽 4 个 300-800 字优质段落组）');
    return 0;
  }
  const result = buildParagraphSamples(options);
  if (result.status === 'blocked') {
    console.error(`[paragraph-samples] 构建被阻断：${result.reason}`);
    return 2;
  }
  printSummary(result);
  console.log(`[paragraph-samples] 已写入 ${result.outputPath}`);
  return 0;
}

export { classifyParagraphDimension, collectCandidateGroups, extractBookSamples };

if (path.resolve(process.argv[1] || '') === SCRIPT_PATH) process.exitCode = main();
