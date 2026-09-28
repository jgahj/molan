import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildIndex as buildCorpusIndex } from '../../molan-home/scripts/build-character-material-index.mjs';
import {
  buildSourceLookup as buildUnifiedSourceLookup,
  calculateRawGenreCoverage,
  corpusSampleKey,
  countCorpusChars,
  enrichCorpusRow,
  logicalWorkId,
  normalizeCorpusText,
  primaryGenreBucket,
  splitRawGenres
} from './corpus-utils.mjs';

const RESOURCE_ROOT = path.resolve(import.meta.dirname, '..');
const DEFAULT_INPUT = path.join(RESOURCE_ROOT, '人物描写素材库_真实抓取版.md');
const DEFAULT_SOURCES = path.join(RESOURCE_ROOT, '人物描写素材库_来源清单.json');
const DEFAULT_CONFIG = path.join(RESOURCE_ROOT, 'quota-config.json');
const DEFAULT_OUTPUT = path.join(RESOURCE_ROOT, 'quota-gap-report.json');

const DIMENSION_IDS = new Set(['外貌', '神态', '动作', '语言', '口头禅', '心理']);

/** 读取 JSON 文件并在文件不存在或内容损坏时抛出可定位的错误。
 * 参数：filePath 为 JSON 文件路径。
 * 返回值：解析后的 JavaScript 值。
 */
function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取 JSON：${filePath}；${error.message}`);
  }
}

/** 校验配额配置的类型目录、数值范围和原题材映射，避免报告建立在手填错误上。
 * 参数：config 为 quota-config.json 的解析结果。
 * 返回值：校验通过时返回 config 本身。
 */
function validateConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('配额配置必须是对象');
  if (!Array.isArray(config.archetypes) || config.archetypes.length !== 10) {
    throw new Error('配额配置必须包含 10 类人物类型');
  }
  const buckets = config.genreBuckets;
  if (!buckets || typeof buckets !== 'object' || Object.keys(buckets).length !== 4) {
    throw new Error('配额配置必须包含 4 个题材桶');
  }
  const bucketNames = new Set(Object.keys(buckets));
  for (const [bucket, genres] of Object.entries(buckets)) {
    if (!Array.isArray(genres) || genres.length === 0) throw new Error(`题材桶没有原题材：${bucket}`);
  }
  const numericFields = ['cellMinChars', 'cellHardFloor', 'perBookCellCapPct', 'archetypeMinChars'];
  for (const field of numericFields) {
    if (!Number.isFinite(Number(config[field])) || Number(config[field]) <= 0) {
      throw new Error(`配额配置数值无效：${field}`);
    }
  }
  const range = config.bucketTargetRange;
  if (!Array.isArray(range) || range.length !== 2 || range[0] < 0 || range[1] > 1 || range[0] > range[1]) {
    throw new Error('题材桶占比范围无效');
  }
  const sourceMap = config.sourceBucketMap;
  if (!sourceMap || typeof sourceMap !== 'object') throw new Error('缺少 sourceBucketMap');
  if (!Array.isArray(config.rawGenres) || config.rawGenres.length !== 18 || new Set(config.rawGenres).size !== 18) {
    throw new Error('配额配置必须保留 18 个互不重复的原题材');
  }
  for (const genre of config.rawGenres) {
    if (!Object.prototype.hasOwnProperty.call(sourceMap, genre)) throw new Error(`原题材缺少 sourceBucketMap：${genre}`);
  }
  for (const [genre, bucket] of Object.entries(sourceMap)) {
    if (bucket !== null && !bucketNames.has(bucket)) throw new Error(`原题材映射到未知题材桶：${genre} -> ${bucket}`);
  }
  const declaredBucketGenres = new Set(Object.values(buckets).flatMap(genres => genres));
  for (const genre of config.rawGenres) {
    const bucket = sourceMap[genre];
    if (bucket !== null && !declaredBucketGenres.has(genre)) {
      throw new Error(`sourceBucketMap 的反向映射未在题材桶声明：${genre} -> ${bucket}`);
    }
  }
  for (const [bucket, genres] of Object.entries(buckets)) {
    for (const genre of genres) {
      if (sourceMap[genre] !== bucket) throw new Error(`题材桶映射不一致：${genre} -> ${sourceMap[genre] || '未映射'}，应为 ${bucket}`);
    }
  }
  const archiveGroupMap = config.archiveGroupMap;
  if (!archiveGroupMap || typeof archiveGroupMap !== 'object' || Array.isArray(archiveGroupMap)) {
    throw new Error('缺少 archiveGroupMap');
  }
  for (const genre of config.rawGenres) {
    const archiveGroup = String(archiveGroupMap[genre] || '').trim().replace(/\\/gu, '/');
    if (!archiveGroup || archiveGroup.startsWith('/') || archiveGroup.includes('..')) {
      throw new Error(`原题材缺少安全的 archiveGroupMap：${genre}`);
    }
  }
  if (!['tagged', 'primary', 'primary-or-explicit'].includes(config.rawGenreCountMode)) {
    throw new Error('rawGenreCountMode 必须是 tagged、primary 或 primary-or-explicit');
  }
  const minimumFields = ['rawGenreMinimumSampleChars', 'rawGenreMinimumSampleWorks', 'rawGenreMinimumSampleCount'];
  for (const field of minimumFields) {
    if (!Number.isFinite(Number(config[field])) || Number(config[field]) < 0) {
      throw new Error(`${field} 必须是不小于 0 的数字`);
    }
  }
  return config;
}

/** 规范化语料文本，统一空白并移除 Markdown 引用符号。
 * 参数：value 为待清洗的文本。
 * 返回值：单行、去首尾空白的文本。
 */
function normalizeText(value) {
  return normalizeCorpusText(value);
}

/** 解析一个人物类型下的样本标题，提取作品名和作者。
 * 参数：line 为 Markdown 样本标题行。
 * 返回值：包含 title 和 author 的对象。
 */
function parseSampleHeading(line) {
  const body = String(line || '').replace(/^\*\*|\*\*$/g, '').replace(/^\d+\.\s*/, '').trim();
  const separator = body.lastIndexOf(' · ');
  if (separator < 0) return { title: body.replace(/^《|》$/g, ''), author: '' };
  return {
    title: body.slice(0, separator).trim().replace(/^《|》$/g, ''),
    author: body.slice(separator + 3).trim()
  };
}

/** 解析样本元数据行，提取原题材和原文定位 URL。
 * 参数：line 为样本元数据引用行。
 * 返回值：包含 genre、sourceUrl 和 signals 的对象。
 */
function parseSampleMetadata(line) {
  const source = normalizeText(line);
  const genre = (source.match(/^题材：([^；]+)；/) || [])[1] || '';
  const sourceUrl = (source.match(/\[原文定位\]\(([^)]+)\)/) || [])[1] || '';
  const signalText = (source.match(/规则信号：(.+)$/) || [])[1] || '';
  const signals = signalText === '无' ? [] : signalText.split(/[、,，\s]+/).filter(Boolean);
  return { genre: genre.trim(), sourceUrl, signals };
}

/** 解析真实抓取版 Markdown，只读取十类人物下的六个维度样本。
 * 参数：markdown 为人物描写素材库 Markdown 内容。
 * 返回值：按渲染条目返回样本数组。
 */
function parseCorpus(markdown) {
  const rows = [];
  const lines = String(markdown || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  let archetype = '';
  let dimension = '';
  let pending = null;
  const flush = () => {
    if (!pending || !pending.text) return;
    rows.push({ ...pending, text: normalizeText(pending.text) });
    pending = null;
  };
  for (const line of lines) {
    const typeMatch = line.match(/^##\s+(.+?)\s*$/);
    if (typeMatch) {
      flush();
      archetype = typeMatch[1].trim();
      dimension = '';
      continue;
    }
    const dimensionMatch = line.match(/^###\s+(.+?)\s*$/);
    if (dimensionMatch && DIMENSION_IDS.has(dimensionMatch[1].trim())) {
      flush();
      dimension = dimensionMatch[1].trim();
      continue;
    }
    if (/^\*\*\d+\.\s+.+\*\*$/.test(line) && archetype && dimension) {
      flush();
      pending = { ...parseSampleHeading(line), archetype, dimension, text: '', metadata: null };
      continue;
    }
    if (!pending || !line.startsWith('>')) continue;
    if (!pending.metadata) {
      pending.metadata = parseSampleMetadata(line);
      Object.assign(pending, pending.metadata);
    } else {
      pending.text += ` ${line.replace(/^>\s?/, '')}`;
    }
  }
  flush();
  return rows.filter(row => row.archetype && row.dimension && row.text);
}

/** 为一段样本生成稳定哈希，用于跨描写维度去重和审计。
 * 参数：text 为清洗后的样本文本。
 * 返回值：十六进制 SHA-256 前 16 位。
 */
function textHash(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex').slice(0, 16);
}

/** 把来源清单中的目录 URL、章节 URL和作品 ID建立为同一查找表。
 * 参数：manifest 为人物描写素材库来源清单对象。
 * 返回值：以 URL 为键的来源元数据 Map。
 */
function buildSourceLookup(manifest) {
  return buildUnifiedSourceLookup(manifest);
}

/** 从样本元数据和来源清单合并原题材，确保题材映射不会依赖单一字段。
 * 参数：row 为 Markdown 样本，lookup 为来源 URL 查找表。
 * 返回值：去重后的原题材数组。
 */
function resolveRawGenres(row, lookup) {
  const source = lookup.get(row.sourceUrl);
  const values = [row.genre, ...(source?.genres || [])];
  return [...new Set(values.flatMap(value => String(value || '').split(/[、,，\s]+/).filter(Boolean)))];
}

/** 将样本映射到题材桶并生成唯一计数键，保持跨维度文本只计一次。
 * 参数：rows 为解析样本，lookup 为来源查找表，config 为配额配置。
 * 返回值：去重后的可计量样本、重复数和未映射题材统计。
 */
function normalizeSamples(rows, lookup, config) {
  const unique = new Map();
  const unmapped = new Map();
  let duplicateRows = 0;
  let missingSourceMetadata = 0;
  for (const row of rows) {
    const enriched = enrichCorpusRow(row, lookup);
    const source = lookup.get(enriched.sourceUrl);
    if (!source) missingSourceMetadata += 1;
    const rawGenres = enriched.rawGenres || resolveRawGenres(enriched, lookup);
    const bucket = primaryGenreBucket(rawGenres, config);
    for (const genre of rawGenres) {
      if (!(genre in config.sourceBucketMap) || config.sourceBucketMap[genre] === null) {
        unmapped.set(genre, (unmapped.get(genre) || 0) + countCorpusChars(row.text));
      }
    }
    if (!bucket) continue;
    const sourceWork = logicalWorkId(enriched, enriched.sourceUrl || `${enriched.title}|${enriched.author}`);
    const normalizedRow = { ...enriched, canonicalWorkId: enriched.canonicalWorkId || sourceWork, sourceWorkId: enriched.sourceWorkId || sourceWork };
    const key = corpusSampleKey(normalizedRow, enriched.text);
    if (unique.has(key)) {
      duplicateRows += 1;
      const current = unique.get(key);
      current.dimensions.add(enriched.dimension);
      continue;
    }
    unique.set(key, {
      key,
      archetype: enriched.archetype,
      bucket,
      sourceWork,
      sourceWorkId: normalizedRow.sourceWorkId,
      canonicalWorkId: normalizedRow.canonicalWorkId,
      sourceUrl: enriched.sourceUrl,
      title: source?.title || enriched.title,
      text: enriched.text,
      dimensions: new Set([enriched.dimension]),
      rawGenres
    });
  }
  return {
    samples: [...unique.values()],
    duplicateRows,
    missingSourceMetadata,
    unmappedGenres: [...unmapped.entries()].map(([genre, chars]) => ({ genre, chars }))
  };
}

/** 计算四十个交叉格的原始字数、15%单书上限后的有效字数和缺口状态。
 * 参数：samples 为唯一可计量样本，config 为配额配置。
 * 返回值：交叉格数组、单书超限记录和硬下限记录。
 */
function calculateCells(samples, config) {
  const capChars = Math.floor(config.cellMinChars * config.perBookCellCapPct);
  const cells = [];
  const violations = [];
  const hardFloorCells = [];
  for (const archetype of config.archetypes) {
    for (const bucket of Object.keys(config.genreBuckets)) {
      const selected = samples.filter(sample => sample.archetype === archetype && sample.bucket === bucket);
      const byBook = new Map();
      for (const sample of selected) {
        byBook.set(sample.sourceWork, (byBook.get(sample.sourceWork) || 0) + countCorpusChars(sample.text));
      }
      const rawUniqueChars = [...byBook.values()].reduce((sum, value) => sum + value, 0);
      const currentChars = [...byBook.values()].reduce((sum, value) => sum + Math.min(value, capChars), 0);
      for (const [sourceWork, chars] of byBook) {
        if (chars > capChars) violations.push({ archetype, bucket, sourceWork, chars, capChars });
      }
      const gapChars = Math.max(0, config.cellMinChars - currentChars);
      const status = currentChars >= config.cellMinChars
        ? 'met'
        : currentChars >= config.cellHardFloor ? 'hard-floor'
          : 'gap';
      const cell = {
        archetype,
        bucket,
        currentChars,
        rawUniqueChars,
        targetChars: config.cellMinChars,
        gapChars,
        status,
        sampleCount: selected.length,
        sourceWorkCount: byBook.size,
        perBookCapChars: capChars
      };
      cells.push(cell);
      if (status === 'hard-floor') hardFloorCells.push(cell);
    }
  }
  return { cells, capChars, violations, hardFloorCells };
}

/** 汇总题材桶、人物类型、未映射原题材和质量计数，形成可复核的缺口报告。
 * 参数：cells 为交叉格结果，samples 为唯一样本，normalization 为去重结果，config 为配置。
 * 返回值：报告 summary 对象。
 */
function calculateSummary(cells, samples, normalization, config) {
  const byBucket = {};
  const byArchetype = {};
  for (const bucket of Object.keys(config.genreBuckets)) byBucket[bucket] = { currentChars: 0, targetChars: config.cellMinChars * config.archetypes.length, share: 0 };
  for (const archetype of config.archetypes) byArchetype[archetype] = { currentChars: 0, targetChars: config.archetypeMinChars, gapChars: 0 };
  for (const cell of cells) {
    byBucket[cell.bucket].currentChars += cell.currentChars;
    byArchetype[cell.archetype].currentChars += cell.currentChars;
  }
  const totalChars = Object.values(byBucket).reduce((sum, item) => sum + item.currentChars, 0);
  for (const item of Object.values(byBucket)) item.share = totalChars ? Number((item.currentChars / totalChars).toFixed(4)) : 0;
  for (const item of Object.values(byArchetype)) item.gapChars = Math.max(0, item.targetChars - item.currentChars);
  const worstCells = [...cells].sort((left, right) => right.gapChars - left.gapChars).slice(0, 10);
  return {
    totalCurrentChars: totalChars,
    totalGap: cells.reduce((sum, cell) => sum + cell.gapChars, 0),
    totalUniqueSamples: samples.length,
    worstCells,
    byBucket,
    byArchetype,
    unmappedGenres: normalization.unmappedGenres,
    unmappedPolicy: config.unmappedGenrePolicy
  };
}

/** 读取命令行参数并提供语料、来源、配置和报告输出路径。
 * 参数：argv 为 process.argv.slice(2)。
 * 返回值：规范化后的路径选项对象。
 */
function readOptions(argv) {
  const options = { input: DEFAULT_INPUT, sources: DEFAULT_SOURCES, config: DEFAULT_CONFIG, output: DEFAULT_OUTPUT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') options.input = path.resolve(argv[++index]);
    else if (arg === '--sources') options.sources = path.resolve(argv[++index]);
    else if (arg === '--config') options.config = path.resolve(argv[++index]);
    else if (arg === '--output') options.output = path.resolve(argv[++index]);
  }
  return options;
}

/** 生成并写入配额缺口报告，所有计数均来自当前语料和来源清单的计算。
 * 参数：options 为 readOptions 返回的路径选项。
 * 返回值：写入的报告对象。
 */
function buildReport(options) {
  const markdown = fs.readFileSync(options.input, 'utf8');
  const config = validateConfig(readJson(options.config));
  const sourceList = readJson(options.sources);
  const rows = parseCorpus(markdown);
  const legacyNormalization = normalizeSamples(rows, buildSourceLookup(sourceList), config);
  const legacyCells = calculateCells(legacyNormalization.samples, config);
  const legacySummary = calculateSummary(legacyCells.cells, legacyNormalization.samples, legacyNormalization, config);
  // 缺口报告直接复用最终建库结果，避免两条管线对过滤、去重和作品 ID各算一套。
  const corpus = buildCorpusIndex(markdown, {
    sources: options.sources,
    quotaConfig: options.config
  });
  const quota = corpus.report.quota;
  const summary = quota.summary;
  const report = {
    version: config.version,
    generatedAt: new Date().toISOString(),
    inputs: {
      corpusPath: path.relative(RESOURCE_ROOT, options.input),
      sourcesPath: path.relative(RESOURCE_ROOT, options.sources),
      configPath: path.relative(RESOURCE_ROOT, options.config),
      corpusSha256: crypto.createHash('sha256').update(markdown).digest('hex'),
      sourceCount: Array.isArray(sourceList.sources) ? sourceList.sources.length : 0
    },
    counting: config.counting,
    quality: {
      renderedRows: rows.length,
      legacyUniqueMappedSamples: legacyNormalization.samples.length,
      uniqueMappedSamples: corpus.report.profiles.uniqueSamples,
      duplicateRowsAcrossDimensions: corpus.report.counts.duplicate,
      missingSourceMetadata: corpus.report.source.missingSourceMetadata,
      filtered: corpus.report.counts
    },
    cells: quota.cells,
    summary,
    legacyDiagnostic: {
      policy: '仅用于量化旧 Markdown 的题材偏科，不代表授权、完结、归档或可发布资格。',
      cells: legacyCells.cells,
      summary: legacySummary,
      quality: {
        renderedRows: rows.length,
        uniqueMappedSamples: legacyNormalization.samples.length,
        duplicateRowsAcrossDimensions: legacyNormalization.duplicateRows,
        missingSourceMetadata: legacyNormalization.missingSourceMetadata,
        unmappedGenres: legacyNormalization.unmappedGenres
      }
    },
    rawGenreCoverage: corpus.report.rawGenreCoverage,
    quota,
    source: corpus.report.source
  };
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const report = buildReport(readOptions(process.argv.slice(2)));
  console.log(JSON.stringify({
    version: report.version,
    renderedRows: report.quality.renderedRows,
    legacyUniqueMappedSamples: report.quality.legacyUniqueMappedSamples,
    strictUniqueMappedSamples: report.quality.uniqueMappedSamples,
    legacyCurrentChars: report.legacyDiagnostic.summary.totalCurrentChars,
    strictTotalGap: report.summary.totalGap
  }, null, 2));
}

export {
  validateConfig,
  parseCorpus,
  normalizeSamples,
  calculateCells,
  buildReport
};
