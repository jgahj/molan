'use strict';

// 墨阑风格指纹库（CJS，供 server.js require）。
// 职责：懒加载 data/style-fingerprints.json（题材语料统计基线，schema 见 scripts/build-style-fingerprints.mjs），
// 按题材解析指纹画像（命中桶全部书的指纹均值，无匹配回退全局均值），
// 并生成可注入 system 提示的正面节奏目标指令块。
// 数据文件缺失或损坏时安静降级（返回 null / 空字符串），绝不抛错。

const fs = require('node:fs');
const path = require('node:path');

// 指纹数据文件默认路径（molan-home/data/style-fingerprints.json）。
const DEFAULT_FINGERPRINT_FILE = path.join(__dirname, '..', 'data', 'style-fingerprints.json');

// 指纹画像字段清单，与 scripts/build-style-fingerprints.mjs 的 finalizeFingerprint 输出保持一致。
const PROFILE_FIELDS = [
  'sentenceLenMean',
  'sentenceLenStd',
  'paragraphLenMean',
  'paragraphLenStd',
  'dialogueRatio',
  'dialogueTurnMean',
  'commaPeriodRatio',
  'ttr',
  'similePerKilo'
];

// 指纹缓存三态：undefined=尚未加载，null=已尝试加载但文件缺失/损坏，对象=加载成功。
let fingerprintCache;
// 当前指纹文件路径（默认常量；_internals.setFingerprintFilePath 可覆盖以便测试）。
let fingerprintFilePath = DEFAULT_FINGERPRINT_FILE;

/**
 * 懒加载并进程内缓存 data/style-fingerprints.json。
 * 文件缺失、JSON 损坏或结构不合法（books 非数组/为空）时缓存并返回 null，不抛错。
 * @returns {object|null} 指纹数据对象（含 schemaVersion/books 等），失败返回 null
 */
function loadStyleFingerprints() {
  if (fingerprintCache !== undefined) return fingerprintCache;
  try {
    const parsed = JSON.parse(fs.readFileSync(fingerprintFilePath, 'utf8'));
    if (!parsed || !Array.isArray(parsed.books) || parsed.books.length === 0) {
      fingerprintCache = null;
      return null;
    }
    fingerprintCache = parsed;
    return parsed;
  } catch {
    fingerprintCache = null;
    return null;
  }
}

/**
 * 归一化题材词：转小写并去掉全部空白，用于忽略大小写与空格的匹配。
 * @param {string} genre 题材字符串（如 '仙侠'、'都市'）
 * @returns {string} 归一化后的键（空输入返回空字符串）
 */
function normalizeGenreKey(genre) {
  return String(genre == null ? '' : genre).toLowerCase().replace(/\s+/g, '');
}

/**
 * 判断请求题材词与目标词（桶名或 primaryGenre）是否双向包含命中：
 * 请求词包含目标，或目标包含请求词（比较前均忽略大小写与空格）。
 * @param {string} request 请求题材词
 * @param {string} target 目标词（books[].bucket 或 books[].primaryGenre）
 * @returns {boolean} 命中返回 true
 */
function matchesGenre(request, target) {
  const req = normalizeGenreKey(request);
  const tgt = normalizeGenreKey(target);
  if (!req || !tgt) return false;
  return req.includes(tgt) || tgt.includes(req);
}

/**
 * 将数值四舍五入到固定小数位；非有限数值返回 null。
 * @param {*} value 待清洗的数值
 * @param {number} [digits=4] 保留小数位
 * @returns {number|null} 清洗后的数值
 */
function roundTo(value, digits = 4) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Number(num.toFixed(digits));
}

/**
 * 中位数 3 倍截尾均值：先求中位数，仅对落在 [median/3, median*3] 区间内的值求均值，
 * 抑制个别离群书（如某本 sentenceLenStd 异常大）污染桶均值；
 * 数值少于 4 个时直接返回算术均值（样本过少，保持原行为），全部值被剔除时回退为全部值的算术均值。
 * @param {Array<number>} values 有效数值数组（至少 1 个元素）
 * @returns {number} 截尾均值
 */
function trimmedMean(values) {
  const arithmeticMean = values.reduce((sum, v) => sum + v, 0) / values.length;
  if (values.length < 4) return arithmeticMean;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
  const kept = values.filter(v => v >= median / 3 && v <= median * 3);
  if (kept.length === 0) return arithmeticMean;
  return kept.reduce((sum, v) => sum + v, 0) / kept.length;
}

/**
 * 聚合一组书的指纹均值：逐字段采用「中位数 3 倍截尾均值」（见 trimmedMean），
 * 跳过 null 与非有限数值（如 commaPeriodRatio 可为 null），全部无效的字段记 null。
 * @param {Array<object>} books 指纹数据中的书籍记录数组（含 fingerprint 字段）
 * @returns {object} 画像对象，键为 PROFILE_FIELDS，值为截尾均值或 null
 */
function aggregateProfile(books) {
  const profile = {};
  for (const field of PROFILE_FIELDS) {
    const values = [];
    for (const book of books) {
      const num = Number(book && book.fingerprint ? book.fingerprint[field] : null);
      if (Number.isFinite(num)) values.push(num);
    }
    profile[field] = values.length > 0
      ? roundTo(trimmedMean(values), 4)
      : null;
  }
  return profile;
}

/**
 * 按题材解析指纹画像：在 books[].bucket 与 books[].primaryGenre 上做双向包含匹配，
 * 命中至少 1 本则聚合命中书的指纹均值；无匹配回退全局全部书均值；数据不可用返回 null。
 * @param {string} genre 题材字符串（如 '仙侠'、'都市'、'言情'）
 * @returns {object|null} { matchedBucket, bookCount, profile }，数据缺失时为 null
 */
function resolveFingerprintProfile(genre) {
  const data = loadStyleFingerprints();
  if (!data) return null;
  const matched = data.books.filter(book =>
    matchesGenre(genre, book && book.bucket) || matchesGenre(genre, book && book.primaryGenre)
  );
  const useMatched = matched.length > 0;
  const books = useMatched ? matched : data.books;
  const buckets = [];
  for (const book of books) {
    const bucket = book && book.bucket;
    if (bucket && !buckets.includes(bucket)) buckets.push(bucket);
  }
  return {
    matchedBucket: useMatched ? buckets.join('、') : null,
    bookCount: books.length,
    profile: aggregateProfile(books)
  };
}

/**
 * 基于指纹画像生成正面节奏目标中文指令块（注入 system 用）：
 * 6-8 行简短指令，总字数控制在 250 字内，含前导换行；画像缺失时返回空字符串。
 * @param {string} genre 题材字符串
 * @returns {string} 节奏目标指令块（含前导换行），无数据时为 ''
 */
function buildRhythmTargetBlock(genre) {
  const resolved = resolveFingerprintProfile(genre);
  const profile = resolved ? resolved.profile : null;
  if (!profile) return '';
  const sentenceMean = Number(profile.sentenceLenMean);
  const sentenceStd = Number(profile.sentenceLenStd);
  const dialogueRatio = Number(profile.dialogueRatio);
  const dialogueTurnMean = Number(profile.dialogueTurnMean);
  const paragraphMean = Number(profile.paragraphLenMean);
  const commaPeriodRatio = Number(profile.commaPeriodRatio);
  const similePerKilo = Number(profile.similePerKilo);
  const lines = ['【节奏目标（来自题材语料统计基线）】'];
  if (Number.isFinite(sentenceMean) && sentenceMean > 0) {
    const stdText = Number.isFinite(sentenceStd) && sentenceStd > 0 ? `、标准差约 ${Math.round(sentenceStd)}` : '';
    lines.push(`句长均值约 ${Math.round(sentenceMean)} 字${stdText}，长短句交错，忌句长均匀。`);
  }
  if (Number.isFinite(dialogueRatio) && dialogueRatio > 0) {
    const turnText = Number.isFinite(dialogueTurnMean) && dialogueTurnMean > 0 ? `，单轮对白约 ${Math.round(dialogueTurnMean)} 字` : '';
    lines.push(`对话占比约 ${Math.round(dialogueRatio * 100)}%${turnText}，对白与叙述穿插推进。`);
  }
  if (Number.isFinite(paragraphMean) && paragraphMean > 0 && Number.isFinite(sentenceMean) && sentenceMean > 0) {
    lines.push(`段落平均约 ${(paragraphMean / sentenceMean).toFixed(1)} 句，允许长短段错落，不写等长段。`);
  }
  if (Number.isFinite(commaPeriodRatio) && commaPeriodRatio > 0) {
    lines.push(`逗号句号比约 ${commaPeriodRatio.toFixed(1)}，善用逗号调节气息。`);
  }
  if (Number.isFinite(similePerKilo) && similePerKilo > 0) {
    lines.push(`每千字比喻词不超过 ${similePerKilo.toFixed(1)} 次。`);
  }
  lines.push('以数据为目标自然写作，不要机械凑数。');
  return `\n${lines.join('\n')}`;
}

/**
 * 清空指纹缓存（仅供测试）：下一次 loadStyleFingerprints 将重新读盘。
 * @returns {void}
 */
function resetCache() {
  fingerprintCache = undefined;
}

/**
 * 覆盖指纹文件路径并清空缓存（仅供测试）：用于指向缺失/损坏文件验证降级行为。
 * @param {string} filePath 新的指纹文件绝对路径
 * @returns {void}
 */
function setFingerprintFilePath(filePath) {
  fingerprintFilePath = String(filePath);
  fingerprintCache = undefined;
}

module.exports = {
  loadStyleFingerprints,
  resolveFingerprintProfile,
  buildRhythmTargetBlock
};

// 内部钩子：仅供单元测试覆盖路径、清缓存与直接检验匹配/聚合逻辑。
module.exports._internals = {
  DEFAULT_FINGERPRINT_FILE,
  PROFILE_FIELDS,
  resetCache,
  setFingerprintFilePath,
  normalizeGenreKey,
  matchesGenre,
  aggregateProfile
};
