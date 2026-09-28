// 稀缺场景定向再平衡：从更多书目召回带有目标关键词的段落，补齐打脸、情感、修炼样本。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import flavorDetector from '../lib/ai-flavor-detector.js';
import { extractBookSamples, listArchiveBuckets } from './build-paragraph-samples.mjs';

const require = createRequire(import.meta.url);
const { anonymizeParagraphSample } = require('../lib/character-material.js');
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const DEFAULT_ARCHIVE_ROOT = path.resolve(REPO_ROOT, '..', '资源库', '小说原本');
const DEFAULT_OUTPUT_PATH = path.join(REPO_ROOT, 'data', 'paragraph-samples.json');
const TARGET_SCENE_RULES = Object.freeze({
  '打脸': ['打脸', '震惊', '哗然', '倒吸', '不敢相信', '目瞪口呆', '鸦雀无声'],
  '情感': ['温柔', '泪水', '思念', '心动', '愧疚', '牵挂', '拥抱', '鼻尖一酸'],
  '修炼': ['修炼', '灵气', '真气', '吐纳', '经脉', '突破', '境界', '功法', '丹药', '炼化']
});
const SENSITIVE_PATTERN = /露骨|下身|阴茎|阴部|乳房|乳头|性交|做爱|高潮|插入|性器官|呻吟|床笫|媾合|肉棒|精液|裸身|裸体|春药|发情|淫靡|潮吹|奸淫/i;

/** 读取命令行中带值的选项，缺省时返回稳定的再平衡参数。 */
function readOption(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) return fallback;
  const value = Number(args[index + 1]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/** 统计关键词命中次数，目标场景只要求命中一个关键词即可入候选池。 */
function keywordHits(text, keywords) {
  const source = String(text || '');
  return keywords.reduce((total, keyword) => {
    let count = 0;
    let offset = source.indexOf(keyword);
    while (offset >= 0) {
      count += 1;
      offset = source.indexOf(keyword, offset + keyword.length);
    }
    return total + count;
  }, 0);
}

/** 按稀缺场景的宽松关键词规则标注段落，未命中时保留原有粗标结果。 */
function classifyTargetScene(text, fallback) {
  for (const [sceneType, keywords] of Object.entries(TARGET_SCENE_RULES)) {
    if (keywordHits(text, keywords) >= 1) return sceneType;
  }
  return fallback || '日常';
}

/** 读取现有段落库并校验最小结构，损坏文件直接阻断而不覆盖原数据。 */
function loadSamplePayload(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return { error: `样本库读取失败：${error.message}` };
  }
  if (!parsed || !Array.isArray(parsed.buckets)) return { error: '样本库缺少 buckets 数组' };
  return { payload: parsed };
}

/** 以临时文件加重命名写入再平衡结果，避免进程中断留下半截 JSON。 */
function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

/** 为现有样本重新计算场景统计与桶计数，兼容旧版本没有元数据的样本库。 */
function refreshSceneMetadata(payload) {
  const sceneTypes = {};
  let totalSamples = 0;
  for (const bucket of payload.buckets) {
    const samples = Array.isArray(bucket.samples) ? bucket.samples : [];
    samples.forEach(sample => {
      sample.sceneType = sample.sceneType || '日常';
      sceneTypes[sample.sceneType] = (sceneTypes[sample.sceneType] || 0) + 1;
    });
    bucket.sampleCount = samples.length;
    totalSamples += samples.length;
  }
  payload.totalSamples = totalSamples;
  payload.sceneTypes = sceneTypes;
  payload.schemaVersion = 'paragraph-samples-2';
  payload.generatedAt = Date.now();
  return payload;
}

/** 扫描更多书目的段落候选并将稀缺场景补齐到目标数量，返回再平衡统计。 */
export function rebalanceParagraphSamples(options = {}) {
  const archiveRoot = path.resolve(options.archiveRoot || DEFAULT_ARCHIVE_ROOT);
  const outputPath = path.resolve(options.outputPath || DEFAULT_OUTPUT_PATH);
  const target = readOption(options.args || [], '--target', Number(options.target) || 300);
  const booksPerBucket = readOption(options.args || [], '--books-per-bucket', Number(options.booksPerBucket) || 20);
  const groupsPerBook = readOption(options.args || [], '--groups-per-book', Number(options.groupsPerBook) || 40);
  const maxFlavorScore = readOption(options.args || [], '--max-flavor-score', Number(options.maxFlavorScore) || 45);
  if (!fs.existsSync(archiveRoot) || !fs.statSync(archiveRoot).isDirectory()) return { status: 'blocked', reason: 'archive_root_missing', archiveRoot, outputPath };
  const loaded = loadSamplePayload(outputPath);
  if (loaded.error) return { status: 'blocked', reason: loaded.error, archiveRoot, outputPath };
  const payload = loaded.payload;
  const bucketByName = new Map(payload.buckets.map(bucket => [String(bucket.bucket || ''), bucket]));
  const existingIds = new Set();
  const existingTexts = new Set();
  const counts = Object.fromEntries(Object.keys(TARGET_SCENE_RULES).map(scene => [scene, 0]));
  for (const bucket of payload.buckets) {
    const samples = Array.isArray(bucket.samples) ? bucket.samples : [];
    for (const sample of samples) {
      if (sample.id) existingIds.add(String(sample.id));
      if (sample.text) existingTexts.add(String(sample.text).slice(0, 100));
      if (sample.text && !sample.anonymizedText) {
        sample.anonymizedText = anonymizeParagraphSample(sample.text, sample.filePath || `${bucket.bucket}/${sample.sourceTitle || sample.id || existingIds.size}`).anonymizedText;
      }
      const sceneType = String(sample.sceneType || '日常');
      if (Object.prototype.hasOwnProperty.call(counts, sceneType)) counts[sceneType] += 1;
    }
  }
  const candidates = Object.fromEntries(Object.keys(TARGET_SCENE_RULES).map(scene => [scene, []]));
  let scannedBooks = 0;
  for (const archiveBucket of listArchiveBuckets(archiveRoot)) {
    const files = archiveBucket.files.slice(0, booksPerBucket);
    for (const fileName of files) {
      scannedBooks += 1;
      const samples = extractBookSamples(archiveRoot, archiveBucket.bucket, fileName, {
        booksPerBucket: 1,
        groupsPerBook,
        minGroupChars: 300,
        maxGroupChars: 800,
        minParagraphsPerGroup: 3,
        maxParagraphsPerGroup: 5,
        maxParagraphsPerGroupHardCap: 15
      });
      for (const sample of samples) {
        const sceneType = classifyTargetScene(sample.text, sample.sceneType);
        if (!Object.prototype.hasOwnProperty.call(candidates, sceneType)) continue;
        if (SENSITIVE_PATTERN.test(sample.text || '')) continue;
        const flavor = flavorDetector.computeAiFlavorScore(sample.text || '');
        const flavorScore = Number(flavor && flavor.score) || 0;
        if (flavorScore > maxFlavorScore || existingIds.has(String(sample.id)) || existingTexts.has(String(sample.text || '').slice(0, 100))) continue;
        sample.sceneType = sceneType;
        sample.flavorScore = flavorScore;
        sample.anonymizedText = sample.anonymizedText || anonymizeParagraphSample(sample.text, sample.filePath || `${archiveBucket.bucket}/${fileName}`).anonymizedText;
        candidates[sceneType].push(sample);
      }
    }
  }
  const added = Object.fromEntries(Object.keys(TARGET_SCENE_RULES).map(scene => [scene, 0]));
  for (const sceneType of Object.keys(TARGET_SCENE_RULES)) {
    const need = Math.max(0, target - counts[sceneType]);
    for (const sample of candidates[sceneType].slice(0, need)) {
      const bucketName = String(sample.bucket || '');
      const bucket = bucketByName.get(bucketName) || (() => {
        const created = { bucket: bucketName, sampleCount: 0, samples: [] };
        payload.buckets.push(created);
        bucketByName.set(bucketName, created);
        return created;
      })();
      bucket.samples.push(sample);
      existingIds.add(String(sample.id));
      existingTexts.add(String(sample.text || '').slice(0, 100));
      counts[sceneType] += 1;
      added[sceneType] += 1;
    }
  }
  refreshSceneMetadata(payload);
  writeJsonAtomic(outputPath, payload);
  return { status: 'ready', outputPath, target, booksPerBucket, groupsPerBook, maxFlavorScore, scannedBooks, before: counts, added, sceneTypes: payload.sceneTypes, totalSamples: payload.totalSamples };
}

/** 解析命令行参数并执行一次定向再平衡，失败时返回非零退出码。 */
export function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('用法：node scripts/build-paragraph-samples-targeted.mjs [--target 300] [--books-per-bucket 20] [--groups-per-book 40] [--max-flavor-score 45]');
    return 0;
  }
  const result = rebalanceParagraphSamples({ args: argv });
  if (result.status === 'blocked') {
    console.error(`[targeted] 构建被阻断：${result.reason}`);
    return 2;
  }
  console.log(`[targeted] 扫描 ${result.scannedBooks} 本，新增 ${JSON.stringify(result.added)}，场景分布 ${JSON.stringify(result.sceneTypes)}`);
  console.log(`[targeted] 已写入 ${result.outputPath}`);
  return 0;
}

if (path.resolve(process.argv[1] || '') === SCRIPT_PATH) process.exitCode = main();
