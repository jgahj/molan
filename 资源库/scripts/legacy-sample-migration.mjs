import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseSourceMarkdown } from '../../molan-home/scripts/build-character-material-index.mjs';
import { splitChapters } from './build-manifest.mjs';
import {
  buildSourceLookup,
  canonicalizeSourceUrl,
  corpusTextHash,
  enrichCorpusRow,
  logicalWorkId,
  normalizeCorpusText
} from './corpus-utils.mjs';

const RESOURCE_ROOT = path.resolve(import.meta.dirname, '..');
const DEFAULT_INPUT = path.join(RESOURCE_ROOT, '人物描写素材库_真实抓取版.md');
const DEFAULT_SOURCES = path.join(RESOURCE_ROOT, '人物描写素材库_来源清单.json');
const DEFAULT_MANIFEST = path.join(RESOURCE_ROOT, 'manifest.json');
const DEFAULT_OUTPUT = path.join(RESOURCE_ROOT, 'legacy-sample-migration-report.json');

/** 计算文件或文本的完整 SHA-256，供迁移结果绑定原书和样本证据。
 * 参数：value 为 Buffer 或字符串。
 * 返回值：完整的小写十六进制 SHA-256 字符串。
 */
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** 读取 JSON 文件，失败时抛出带文件路径的错误。
 * 参数：filePath 为 JSON 文件路径。
 * 返回值：解析后的 JSON 值。
 */
function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取 JSON：${filePath}；${error.message}`);
  }
}

/** 规范化作品标题，避免用卷号、文件扩展名或站点噪声进行错误归属。
 * 参数：value 为作品标题或归档文件名。
 * 返回值：用于精确比较的标题。
 */
function normalizeTitle(value) {
  return String(value || '')
    .replace(/\.txt$/iu, '')
    .replace(/^《|》$/gu, '')
    .replace(/^\d+[-_]/u, '')
    .replace(/[【\[].*?(搜|笔趣|www\.).*?[】\]]/giu, '')
    .replace(/\s*[(（][^)]*(?:章|卷|部|集|篇|回)[^)]*[)）]\s*$/u, '')
    .replace(/\s+/gu, '')
    .trim();
}

/** 把 manifest 逻辑作品展开为可定位的单文件记录，并保留逻辑作品 ID。
 * 参数：manifest 为原书 manifest 对象。
 * 返回值：每个原书归档文件一条记录的数组。
 */
function flattenManifestRecords(manifest) {
  const books = Array.isArray(manifest?.books) ? manifest.books : [];
  return books.flatMap(book => {
    const parts = Array.isArray(book.parts) && book.parts.length ? book.parts : [book];
    return parts.map(part => {
      const record = { ...book, ...part };
      return {
        ...record,
        bookId: String(book.id || '').trim(),
        filePath: String(part.filePath || book.filePath || '').replace(/\\/gu, '/').replace(/^\.\//u, ''),
        canonicalWorkId: String(part.canonicalWorkId || book.canonicalWorkId || '').trim(),
        sourceWorkId: String(part.sourceWorkId || book.sourceWorkId || '').trim(),
        sourceNovelId: String(part.sourceNovelId || book.sourceNovelId || '').trim(),
        sourceUrl: canonicalizeSourceUrl(part.sourceUrl || book.sourceUrl || ''),
        title: String(part.title || book.title || part.originalFileName || '').trim(),
        chapters: Array.isArray(part.chapters) ? part.chapters : Array.isArray(book.chapters) ? book.chapters : []
      };
    });
  });
}

/** 按来源作品 ID、来源 URL、平台作品 ID或精确书名查找归档文件。
 * 参数：row 为旧样本；info 为 enrichCorpusRow 生成的来源信息；records 为展开后的 manifest 文件记录。
 * 返回值：包含 matched、ambiguous 和 records 的归属结果。
 */
function findArchiveRecords(row, info, records) {
  const sourceUrl = canonicalizeSourceUrl(info.sourceUrl || row.sourceUrl || '');
  const sourceNovelId = String(info.sourceNovelId || '').trim();
  const sourceWorkId = String(info.sourceWorkId || '').trim();
  const title = normalizeTitle(info.title || row.title);
  const strategies = [
    ['sourceNovelId', record => sourceNovelId && record.sourceNovelId === sourceNovelId],
    ['sourceUrl', record => sourceUrl && record.sourceUrl === sourceUrl],
    ['sourceWorkId', record => sourceWorkId && (record.sourceWorkId === sourceWorkId || record.canonicalWorkId === sourceWorkId)],
    ['title', record => title && normalizeTitle(record.title) === title]
  ];
  for (const [strategy, predicate] of strategies) {
    const matches = records.filter(predicate);
    if (matches.length) return { strategy, matched: matches.length === 1, ambiguous: matches.length > 1, records: matches };
  }
  return { strategy: '', matched: false, ambiguous: false, records: [] };
}

/** 在归档文件中查找旧样本文本，并返回 UTF-16 偏移和所属章节。
 * 参数：archiveText 为归档文件正文；needle 为规范化旧样本文本；record 为 manifest 文件记录。
 * 返回值：文本位置、章节元数据和匹配方式；无法精确回读时返回 reason。
 */
function locateLegacyText(archiveText, needle, record) {
  const text = String(archiveText || '').replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
  const candidate = normalizeCorpusText(needle);
  const startOffset = candidate ? text.indexOf(candidate) : -1;
  if (startOffset < 0) return { matched: false, reason: 'legacy_text_not_found_exactly' };
  const endOffset = startOffset + candidate.length;
  const chapters = splitChapters(text);
  const chapterIndex = chapters.findIndex(chapter => startOffset >= chapter.start && startOffset < chapter.end);
  if (chapterIndex < 0) return { matched: false, reason: 'chapter_for_legacy_text_not_found' };
  const chapter = chapters[chapterIndex];
  const declaredChapter = Array.isArray(record?.chapters) ? record.chapters[chapterIndex] || {} : {};
  const chapterId = String(declaredChapter.chapterId || declaredChapter.chapterid || declaredChapter.id || '').trim();
  const chapterUrl = canonicalizeSourceUrl(declaredChapter.url || declaredChapter.chapterUrl || '');
  return {
    matched: true,
    chapterIndex,
    chapterId,
    chapterUrl,
    chapterTitle: chapter.title || '',
    startOffset,
    endOffset,
    offsetUnit: 'utf16-code-unit'
  };
}

/** 迁移一条旧样本，严格区分已归属、可回读和完整验证三个状态。
 * 参数：row 为旧 Markdown 样本；index 为样本序号；lookup 为来源查找表；records 为 manifest 文件记录；resourceRoot 为资源库根目录。
 * 返回值：不含正文的迁移表记录。
 */
function migrateSample(row, index, lookup, records, resourceRoot) {
  const info = enrichCorpusRow(row, lookup);
  const legacyText = normalizeCorpusText(row.text);
  const sampleId = `legacy-${String(index + 1).padStart(5, '0')}-${corpusTextHash(`${row.archetype}|${row.dimension}|${legacyText}`)}`;
  const base = {
    legacySampleId: sampleId,
    archetype: row.archetype || '',
    dimension: row.dimension || '',
    title: row.title || '',
    author: row.author || '',
    sourceUrl: info.sourceUrl || row.sourceUrl || '',
    sourceWorkId: info.sourceWorkId || '',
    canonicalWorkId: '',
    rawGenres: info.rawGenres || [],
    primaryGenre: info.primaryGenre || '',
    sourceFile: '',
    chapterId: '',
    chapterUrl: '',
    startOffset: null,
    endOffset: null,
    contentHash: '',
    candidateTextSha256: sha256(legacyText),
    offsetUnit: '',
    verified: false,
    status: 'unmatched',
    reason: 'archive_not_attributed'
  };
  const attribution = findArchiveRecords(row, info, records);
  if (attribution.ambiguous) return { ...base, status: 'ambiguous', reason: 'archive_attribution_ambiguous' };
  if (!attribution.matched) return base;
  const record = attribution.records[0];
  const relativePath = record.filePath;
  const filePath = path.resolve(resourceRoot, relativePath);
  const relativeToRoot = path.relative(resourceRoot, filePath);
  const archiveRoot = path.resolve(resourceRoot, '小说原本');
  const relativeToArchive = path.relative(archiveRoot, filePath);
  if (!relativePath || relativeToRoot === '..' || relativeToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToRoot)
    || relativeToArchive === '..' || relativeToArchive.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToArchive)) {
    return { ...base, canonicalWorkId: logicalWorkId(record, ''), status: 'unreadable', reason: 'archive_file_outside_root' };
  }
  let buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch (_) {
    return { ...base, canonicalWorkId: logicalWorkId(record, ''), sourceFile: relativePath, status: 'unreadable', reason: 'archive_file_missing' };
  }
  const actualContentHash = sha256(buffer);
  const declaredContentHash = String(record.contentHash || '').trim().toLowerCase();
  const contentHashVerified = /^[a-f0-9]{64}$/u.test(declaredContentHash) && actualContentHash === declaredContentHash;
  const location = locateLegacyText(buffer.toString('utf8'), legacyText, record);
  if (!location.matched) {
    return {
      ...base,
      canonicalWorkId: logicalWorkId(record, ''),
      sourceFile: relativePath,
      contentHash: actualContentHash,
      status: 'matched',
      reason: location.reason
    };
  }
  const completeEvidence = contentHashVerified && Boolean(location.chapterId) && Boolean(location.chapterUrl);
  return {
    ...base,
    canonicalWorkId: logicalWorkId(record, ''),
    sourceFile: relativePath,
    chapterId: location.chapterId,
    chapterTitle: location.chapterTitle,
    chapterUrl: location.chapterUrl,
    startOffset: location.startOffset,
    endOffset: location.endOffset,
    contentHash: actualContentHash,
    offsetUnit: location.offsetUnit,
    verified: completeEvidence,
    status: completeEvidence ? 'verified' : 'matched',
    reason: completeEvidence ? 'verified' : !contentHashVerified ? 'archive_content_hash_unverified' : 'chapter_metadata_unverified'
  };
}

/** 生成旧样本归属迁移报告，不改写旧样本或原书归档。
 * 参数：options 可提供 resourceRoot、input、sourceList、manifest 或其文件路径。
 * 返回值：包含逐样本迁移表和汇总状态的报告对象。
 */
export function buildMigrationReport(options = {}) {
  const resourceRoot = path.resolve(options.resourceRoot || RESOURCE_ROOT);
  const input = options.input || path.join(resourceRoot, '人物描写素材库_真实抓取版.md');
  const sourceList = options.sourceList || readJson(options.sources || path.join(resourceRoot, '人物描写素材库_来源清单.json'));
  const manifest = options.manifest || readJson(options.manifestPath || path.join(resourceRoot, 'manifest.json'));
  const markdown = fs.readFileSync(input, 'utf8');
  const rows = parseSourceMarkdown(markdown);
  const lookup = buildSourceLookup(sourceList);
  const records = flattenManifestRecords(manifest);
  const samples = rows.map((row, index) => migrateSample(row, index, lookup, records, resourceRoot));
  const byReason = {};
  for (const sample of samples) byReason[sample.reason] = (byReason[sample.reason] || 0) + 1;
  const verified = samples.filter(sample => sample.verified).length;
  const attributed = samples.filter(sample => sample.status !== 'unmatched' && sample.status !== 'ambiguous').length;
  return {
    schemaVersion: 'legacy-sample-migration-v1',
    generatedAt: new Date().toISOString(),
    policy: '旧 Markdown 只有在 manifest 精确归属、原书文件哈希、候选文本、章节 ID、章节 URL和偏移均可回读时才标记 verified；其余只留在诊断区。',
    inputs: {
      corpusPath: path.relative(resourceRoot, input).replace(/\\/g, '/'),
      corpusSha256: sha256(markdown),
      sourceRecordCount: Array.isArray(sourceList.sources) ? sourceList.sources.length : 0,
      archivedLogicalWorks: Array.isArray(manifest.books) ? manifest.books.length : 0,
      archivedFiles: records.length
    },
    summary: {
      totalSamples: samples.length,
      attributedSamples: attributed,
      verifiedSamples: verified,
      unmatchedSamples: samples.filter(sample => sample.status === 'unmatched').length,
      ambiguousSamples: samples.filter(sample => sample.status === 'ambiguous').length,
      byReason
    },
    samples
  };
}

/** 解析迁移报告命令行参数。
 * 参数：argv 为 process.argv.slice(2)。
 * 返回值：输入、来源、manifest和输出路径选项。
 */
function readOptions(argv) {
  const options = { input: DEFAULT_INPUT, sources: DEFAULT_SOURCES, manifestPath: DEFAULT_MANIFEST, output: DEFAULT_OUTPUT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') options.input = path.resolve(argv[++index]);
    else if (arg === '--sources') options.sources = path.resolve(argv[++index]);
    else if (arg === '--manifest') options.manifestPath = path.resolve(argv[++index]);
    else if (arg === '--output') options.output = path.resolve(argv[++index]);
  }
  return options;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const options = readOptions(process.argv.slice(2));
  const report = buildMigrationReport(options);
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report.summary, null, 2));
}
