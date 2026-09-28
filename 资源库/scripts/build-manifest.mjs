import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  archiveGroupForGenre,
  canonicalizeSourceUrl,
  evaluateArchiveRecord,
  evaluateAuthorization,
  logicalWorkId,
  normalizeCompletionStatus,
  normalizeContentScope,
  normalizePlatform,
  normalizeRanking,
  normalizeSourceRecord,
  sourceNovelIdFromUrl,
  validatePlatformMetadata,
  verifyLocalEvidenceReference
} from './corpus-utils.mjs';

const RESOURCE_ROOT = path.resolve(import.meta.dirname, '..');
const ARCHIVE_ROOT = path.join(RESOURCE_ROOT, '小说原本');
const CONFIG_PATH = path.join(RESOURCE_ROOT, 'quota-config.json');
const BLOCKLIST_PATH = path.join(RESOURCE_ROOT, 'ip-blocklist.json');
const SOURCE_LIST_PATH = path.join(RESOURCE_ROOT, '人物描写素材库_来源清单.json');
const FETCH_METADATA_ROOT = path.join(RESOURCE_ROOT, '.fetch-metadata');
const DEFAULT_OUTPUT = path.join(RESOURCE_ROOT, 'manifest.json');

/** 读取 JSON 文件并把文件路径附加到错误信息中。
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

/** 计算文件内容的完整 SHA-256，用于 manifest 追溯而不是手填摘要。
 * 参数：value 为字符串或 Buffer 内容。
 * 返回值：小写十六进制 SHA-256 字符串。
 */
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** 将原书文件名规整为可用于合并分卷的作品名。
 * 参数：fileName 为原书文件名。
 * 返回值：去掉扩展名、编号和站点噪声后的标题。
 */
function normalizeTitle(fileName) {
  return String(fileName || '')
    .replace(/\.txt$/i, '')
    .replace(/^\d+[-_]/, '')
    .replace(/[【\[].*?(搜|笔趣|www\.).*?[】\]]/gi, '')
    .replace(/\s*\([^)]*(?:章|卷|部)[^)]*\)\s*$/u, '')
    .replace(/\s*[（(]\d+\s*[-—至]\s*\d+\s*[章节卷部集篇回][^）)]*[）)]\s*$/u, '')
    .replace(/\s+/g, '')
    .trim();
}

/** 根据目录父目录或已知旧书名推断四个配额桶之一。
 * 参数：filePath 为原书文件路径，config 为配额配置。
 * 返回值：题材桶名称，无法推断时返回空字符串。
 */
function inferBucket(filePath, config) {
  const relative = path.relative(ARCHIVE_ROOT, filePath);
  const parent = path.dirname(relative).split(/[\\/]/).filter(Boolean)[0] || '';
  if (Object.prototype.hasOwnProperty.call(config.genreBuckets, parent)) return parent;
  const title = normalizeTitle(path.basename(filePath));
  if (/蛊真人|逆天邪神/u.test(title)) return '男频玄幻';
  return '';
}

/** 根据原书路径推断独立归档组，保留 raw/<题材> 与四个聚合桶的目录信息。
 * 参数：filePath 为原书文件路径；config 为配额配置。
 * 返回值：归档组相对目录名；无法推断时返回空字符串。
 */
function inferArchiveGroup(filePath, config) {
  const relative = path.relative(ARCHIVE_ROOT, filePath).replace(/\\/gu, '/');
  const parts = relative.split('/').filter(Boolean);
  if (!parts.length) return '';
  if (parts[0] === 'raw' && parts[1]) return `raw/${parts[1]}`;
  if (Object.prototype.hasOwnProperty.call(config.genreBuckets || {}, parts[0])) return parts[0];
  const title = normalizeTitle(path.basename(filePath));
  const rawGenres = Array.isArray(config.rawGenres) ? config.rawGenres : [];
  const matchedGenre = rawGenres.find(genre => title.includes(genre));
  return matchedGenre ? archiveGroupForGenre(matchedGenre, config) : '';
}

/** 把阿拉伯数字或常见中文数字章节号转换为可排序的整数。
 * 参数：value 为章节标题中的数字文本。
 * 返回值：可解析时返回章节号，否则返回 null。
 */
function parseChapterNumber(value) {
  const source = String(value || '').trim();
  const chapterMatch = source.match(/^第\s*([0-9零一二三四五六七八九十百千万两〇○]+)\s*[章节回卷集部篇]/u);
  const numberText = chapterMatch ? chapterMatch[1] : '';
  const arabic = numberText.match(/^\d+$/u);
  if (arabic) return Number(arabic[0]);
  if (!numberText || !/[零一二三四五六七八九十百千万两〇○]/u.test(numberText)) return null;
  const digits = { '零': 0, '〇': 0, '○': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  const units = { '十': 10, '百': 100, '千': 1000, '万': 10000 };
  let total = 0;
  let section = 0;
  let number = 0;
  for (const char of numberText) {
    if (Object.prototype.hasOwnProperty.call(digits, char)) number = digits[char];
    else if (units[char]) {
      section += (number || 1) * units[char];
      number = 0;
      if (units[char] === 10000) {
        total += section;
        section = 0;
      }
    }
  }
  return total + section + number || null;
}

/** 将正文拆成章节并只保留每章字数与范围，不把完整正文重复写入 manifest。
 * 参数：text 为原书 UTF-8 文本。
 * 返回值：章节数组，每项含标题、章节号、字数和正文偏移。
 */
function splitChapters(text) {
  const source = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const matches = [];
  const pattern = /^(第\s*[0-9零一二三四五六七八九十百千万两〇○]+\s*[章节回卷集部篇].*|番外.*|序章.*)$/gmu;
  let match;
  while ((match = pattern.exec(source))) matches.push({ title: match[1].trim(), start: match.index, end: pattern.lastIndex });
  if (!matches.length) return [{ title: '全文', number: null, chars: source.replace(/\s/g, '').length, start: 0, end: source.length }];
  return matches.map((item, index) => {
    const bodyStart = item.end;
    const bodyEnd = index + 1 < matches.length ? matches[index + 1].start : source.length;
    return {
      title: item.title,
      number: parseChapterNumber(item.title),
      unit: (item.title.match(/^第\s*[0-9零一二三四五六七八九十百千万两〇○]+\s*([章节回卷集部篇])/u) || [])[1] || null,
      chars: source.slice(bodyStart, bodyEnd).replace(/\s/g, '').length,
      start: item.start,
      end: bodyEnd
    };
  });
}

/** 统计前三万字内每个 IP 组命中的不同角色名，作为同人风险门禁。
 * 参数：text 为原书文本，blocklist 为 IP 分组配置。
 * 返回值：包含 isFanfiction、命中组和命中名称的判定对象。
 */
function detectFanfiction(text, blocklist) {
  const sample = String(text || '').slice(0, 30000);
  const hits = [];
  for (const group of Array.isArray(blocklist?.groups) ? blocklist.groups : []) {
    const names = [...new Set((group.names || []).filter(name => name && sample.includes(name)))];
    if (names.length >= Number(blocklist.minDistinctNames || 2)) hits.push({ id: group.id, title: group.title, names });
  }
  return { isFanfiction: hits.length > 0, hits };
}

/** 统计前一万字论坛/问答特征密度，避免把非小说文本混入样本。
 * 参数：text 为原书文本，config 为含质量门禁阈值的配额配置。
 * 返回值：包含 forumLike、命中次数、密度和命中词的判定对象。
 */
function detectForumLike(text, config) {
  const sample = String(text || '').slice(0, Number(config.qualityGates.forumSampleChars || 10000));
  const terms = ['怎么办', '求助', '请问', '内容：', '回复', '楼主', '采纳'];
  const hits = [];
  for (const term of terms) {
    const count = sample.split(term).length - 1;
    if (count > 0) hits.push({ term, count });
  }
  const totalHits = hits.reduce((sum, item) => sum + item.count, 0);
  const densityPerKChars = totalHits / Math.max(1, sample.replace(/\s/g, '').length / 1000);
  return {
    forumLike: densityPerKChars > Number(config.qualityGates.forumFeatureDensityPerKChars || 1.5),
    densityPerKChars: Number(densityPerKChars.toFixed(4)),
    hits
  };
}

/** 检测连续短章和不连续的数字章节范围，形成完整性门禁结果。
 * 参数：chapters 为 splitChapters 返回的章节数组，config 为质量门禁配置。
 * 返回值：包含 incomplete、短章序列、章节均值和疑似缺章范围的对象。
 */
function detectIncomplete(chapters, config) {
  const lengths = chapters.map(chapter => chapter.chars);
  const meanChars = lengths.length ? lengths.reduce((sum, value) => sum + value, 0) / lengths.length : 0;
  const shortLimit = Number(config.qualityGates.shortChapterChars || 500);
  const relativeLimit = Number(config.qualityGates.shortChapterRelativeToMean || 0.35);
  const runLimit = Number(config.qualityGates.shortChapterRun || 3);
  let run = 0;
  let shortRun = [];
  for (const chapter of chapters) {
    const isShort = chapter.chars < shortLimit && (meanChars === 0 || chapter.chars <= meanChars * relativeLimit);
    if (isShort) {
      run += 1;
      shortRun.push(chapter.title);
      if (run >= runLimit) break;
    } else {
      run = 0;
      shortRun = [];
    }
  }
  const numberedChapters = chapters.filter(chapter => Number.isInteger(chapter.number));
  const units = new Set(numberedChapters.map(chapter => chapter.unit).filter(Boolean));
  const canInferMissingRanges = units.size === 1 && units.has('章');
  const numeric = canInferMissingRanges ? numberedChapters.map(chapter => chapter.number).sort((left, right) => left - right) : [];
  const missingRanges = [];
  for (let index = 1; index < numeric.length; index += 1) {
    if (numeric[index] - numeric[index - 1] > 1) missingRanges.push({ start: numeric[index - 1] + 1, end: numeric[index] - 1 });
  }
  return {
    incomplete: shortRun.length >= runLimit || missingRanges.length > 0,
    meanChars: Number(meanChars.toFixed(2)),
    shortChapterRun: shortRun,
    missingRanges
  };
}

/** 从来源清单按作品名寻找原书来源 URL和平台信息。
 * 参数：sourceList 为人物描写素材库来源清单，title 为规范化作品名。
 * 返回值：匹配到的来源元数据，未匹配时返回 null。
 */
function findSourceMetadata(sourceList, title, sourceUrl = '', sourceNovelId = '') {
  const target = normalizeTitle(title);
  const targetUrl = canonicalizeSourceUrl(sourceUrl);
  const targetNovelId = String(sourceNovelId || sourceNovelIdFromUrl(sourceUrl) || '').trim();
  const infos = (Array.isArray(sourceList?.sources) ? sourceList.sources : []).map(normalizeSourceRecord);
  const exactMatches = infos.filter(info => (
    (targetUrl && info.sourceUrl === targetUrl)
    || (targetNovelId && info.sourceNovelId === targetNovelId)
  ));
  const titleMatches = target
    ? infos.filter(info => normalizeTitle(info.title) === target)
    : [];
  const unique = values => [...new Map(values.map(info => [info.sourceWorkId, info])).values()];
  const exact = unique(exactMatches);
  const titled = unique(titleMatches);
  // 目录 URL或作品 ID是强归属证据；同名的其他平台作品不能使强匹配失效。
  const matches = exact.length ? exact : titled;
  if (matches.length !== 1) return null;
  const info = matches[0];
  return {
    sourceWorkId: info.sourceWorkId || null,
    canonicalWorkId: info.canonicalWorkId || info.sourceWorkId || null,
    canonicalWorkIdExplicit: info.canonicalWorkIdExplicit === true,
    sourceUrl: info.sourceUrl || null,
    platform: normalizePlatform(info.platform || '') || null,
    platformWorkId: info.platformWorkId || '',
    sourceNovelId: info.sourceNovelId || null,
    author: info.author || '',
    genres: info.genres,
    primaryGenre: info.primaryGenre || '',
    audience: info.audience || '',
    repository: info.repository || '',
    sourcePath: info.sourcePath || '',
    commitSha: info.commitSha || '',
    licenseEvidenceRef: info.licenseEvidenceRef || '',
    licenseEvidenceSha256: info.licenseEvidenceSha256 || '',
    licenseEvidenceVerified: info.licenseEvidenceVerified === true,
    platformMetadataVerified: info.platformMetadataVerified === true,
    platformMetadataReasons: Array.isArray(info.platformMetadataReasons) ? info.platformMetadataReasons : [],
    ranking: info.ranking || {},
    authorization: info.authorization || {},
    completionStatus: info.completionStatus || '',
    completionEvidenceRef: info.completionEvidenceRef || '',
    completionEvidenceVerified: info.completionEvidenceVerified === true,
    completionObservedAt: info.completionObservedAt || '',
    contentScope: info.contentScope || '',
    fullWorkEvidenceRef: info.fullWorkEvidenceRef || '',
    fullWorkEvidenceVerified: info.fullWorkEvidenceVerified === true,
    expectedChapterCount: info.expectedChapterCount || 0,
    fetchedChapterCount: info.fetchedChapterCount || 0,
    chapterCoverage: info.chapterCoverage,
    contentHash: info.contentHash || ''
  };
}

/** 读取抓取脚本写入的 sidecar，并按相对归档路径建立索引。
 * 参数：root 为抓取元数据目录。
 * 返回值：以归档相对路径为键的抓取记录 Map。
 */
function readFetchMetadata(root = FETCH_METADATA_ROOT) {
  const metadata = new Map();
  if (!fs.existsSync(root)) return metadata;
  for (const name of fs.readdirSync(root)) {
    if (!String(name).toLowerCase().endsWith('.json')) continue;
    try {
      const value = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
      const filePath = String(value?.filePath || '').replace(/\\/g, '/').replace(/^\.\//u, '');
      if (filePath) {
        metadata.set(filePath, {
          ...value,
          metadataPath: path.relative(RESOURCE_ROOT, path.join(root, name)).replace(/\\/g, '/')
        });
      }
    } catch (_) {
      // 单个 sidecar 损坏时保留原书扫描结果，不阻断整个 manifest 重建。
    }
  }
  return metadata;
}

/** 校验资源库内证据文件，并在生产配置下要求证据哈希为完整 SHA-256。
 * 参数：reference 为证据文件相对路径；expectedHash 为记录中的哈希；config 为配额配置。
 * 返回值：包含 verified、sha256 和 reason 的证据校验结果。
 */
function verifyEvidence(reference, expectedHash, config) {
  const expected = String(expectedHash || '').trim().toLowerCase();
  if (config.requireFullSha256 === true && !/^[a-f0-9]{64}$/u.test(expected)) {
    return { verified: false, resolvedPath: '', sha256: '', reason: 'evidence_hash_not_full' };
  }
  return verifyLocalEvidenceReference(reference, expected, RESOURCE_ROOT);
}

/** 选择分卷中最新且格式有效的抓取时间。
 * 参数：parts 为分卷档案数组。
 * 返回值：ISO 时间字符串，没有有效时间时返回 null。
 */
function latestFetchedAt(parts) {
  const values = parts
    .map(part => part.fetchedAt)
    .filter(value => value && Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  return values.length ? values[values.length - 1] : null;
}

/** 扫描原书目录并对单个文件执行三道质量门禁。
 * 参数：filePath 为原书文件路径，config 为配额配置，blocklist 为 IP 配置，sourceList 为来源清单，fetchMetadata 为抓取 sidecar。
 * 返回值：单文件档案及其章节质量结果。
 */
function inspectArchiveFile(filePath, config, blocklist, sourceList, fetchMetadata = null) {
  const buffer = fs.readFileSync(filePath);
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const chapters = splitChapters(text);
  const fanfiction = detectFanfiction(text, blocklist);
  const forum = detectForumLike(text, config);
  const integrity = detectIncomplete(chapters, config);
  const adLineCount = text.split(/\r?\n/).filter(line => /笔趣阁|搜笔趣阁|www\./i.test(line)).length;
  const title = normalizeTitle(path.basename(filePath));
  const source = findSourceMetadata(sourceList, title, fetchMetadata?.sourceUrl || '', fetchMetadata?.sourceNovelId || '');
  const contentHash = sha256(buffer);
  const metadataHash = String(fetchMetadata?.contentHash || '').trim().toLowerCase();
  const metadataMatches = !!fetchMetadata && (!metadataHash || contentHash.startsWith(metadataHash));
  const verifiedMetadata = metadataMatches ? fetchMetadata : null;
  const chapterMetadata = Array.isArray(verifiedMetadata?.chapters) ? verifiedMetadata.chapters : [];
  const chapterRecords = chapters.map((chapter, index) => {
    const metadata = chapterMetadata[index] && typeof chapterMetadata[index] === 'object' ? chapterMetadata[index] : {};
    return {
      ...chapter,
      chapterId: String(metadata.chapterId || metadata.id || '').trim(),
      url: canonicalizeSourceUrl(metadata.url || metadata.chapterUrl || '')
    };
  });
  const rawGenres = [...new Set([
    ...(Array.isArray(verifiedMetadata?.rawGenres) ? verifiedMetadata.rawGenres : []),
    ...(source?.genres || [])
  ])];
  const sourceNovelIdValue = verifiedMetadata?.sourceNovelId || source?.sourceNovelId || null;
  const sourceWorkId = verifiedMetadata?.sourceWorkId || source?.sourceWorkId || (sourceNovelIdValue ? `novel-${sourceNovelIdValue}` : null);
  const canonicalWorkId = verifiedMetadata?.canonicalWorkId
    || source?.canonicalWorkId
    || sourceWorkId
    || null;
  const metadataAuthorization = verifiedMetadata?.authorization && Object.values(verifiedMetadata.authorization).some(Boolean)
    ? verifiedMetadata.authorization
    : null;
  const authorizationSource = metadataAuthorization || source?.authorization || {};
  const preliminaryAuthorization = evaluateAuthorization(authorizationSource, config.authorizationPolicy || {});
  const authorizationEvidence = verifyEvidence(
    preliminaryAuthorization.authorization.evidenceRef,
    preliminaryAuthorization.authorization.evidenceSha256,
    config
  );
  const authorization = {
    ...preliminaryAuthorization.authorization,
    evidenceVerified: authorizationEvidence.verified,
    evidenceSha256: authorizationEvidence.sha256 || preliminaryAuthorization.authorization.evidenceSha256
  };
  const authorizationCheck = evaluateAuthorization(authorization, config.authorizationPolicy || {});
  const partial = verifiedMetadata?.quality?.partial === true || verifiedMetadata?.partial === true;
  const completionStatus = normalizeCompletionStatus(verifiedMetadata?.completionStatus || source?.completionStatus || '');
  const contentScope = normalizeContentScope(verifiedMetadata?.contentScope || source?.contentScope || '');
  const declaredExpectedChapterCount = Number(verifiedMetadata?.expectedChapterCount || source?.expectedChapterCount || 0);
  const declaredFetchedChapterCount = Number(verifiedMetadata?.fetchedChapterCount || source?.fetchedChapterCount || 0);
  const chapterCountDeclared = verifiedMetadata?.chapterCountDeclared === true
    || source?.chapterCountDeclared === true;
  const expectedChapterCount = Number.isFinite(declaredExpectedChapterCount) && declaredExpectedChapterCount > 0
    ? declaredExpectedChapterCount
    : config.requireFullWork === true ? 0 : chapters.length;
  const fetchedChapterCount = Number.isFinite(declaredFetchedChapterCount) && declaredFetchedChapterCount > 0
    ? declaredFetchedChapterCount
    : chapters.length;
  const chapterCoverage = expectedChapterCount > 0 ? Number((fetchedChapterCount / expectedChapterCount).toFixed(6)) : null;
  const completionEvidenceRef = verifiedMetadata?.completionEvidenceRef || source?.completionEvidenceRef || '';
  const completionEvidenceSha256 = verifiedMetadata?.completionEvidenceSha256 || source?.completionEvidenceSha256 || '';
  const completionEvidence = verifyEvidence(completionEvidenceRef, completionEvidenceSha256, config);
  const fullWorkEvidenceRef = verifiedMetadata?.fullWorkEvidenceRef || source?.fullWorkEvidenceRef || '';
  const fullWorkEvidenceSha256 = verifiedMetadata?.fullWorkEvidenceSha256 || source?.fullWorkEvidenceSha256 || '';
  const fullWorkEvidence = verifyEvidence(fullWorkEvidenceRef, fullWorkEvidenceSha256, config);
  const catalogSnapshot = verifiedMetadata?.catalogSnapshot && typeof verifiedMetadata.catalogSnapshot === 'object'
    ? verifiedMetadata.catalogSnapshot
    : null;
  const catalogEvidenceRef = verifiedMetadata?.catalogEvidenceRef || source?.catalogEvidenceRef || '';
  const catalogEvidenceSha256 = verifiedMetadata?.catalogEvidenceSha256 || source?.catalogEvidenceSha256 || '';
  const catalogEvidence = catalogEvidenceRef
    ? verifyEvidence(catalogEvidenceRef, catalogEvidenceSha256, config)
    : { verified: Boolean(catalogSnapshot?.snapshotSha256), reason: catalogSnapshot?.snapshotSha256 ? 'metadata_catalog_snapshot' : 'catalog_snapshot_missing', sha256: catalogSnapshot?.snapshotSha256 || '' };
  const platformMetadata = validatePlatformMetadata({
    sourceUrl: verifiedMetadata?.sourceUrl || source?.sourceUrl || '',
    platform: verifiedMetadata?.platform || source?.platform || '',
    platformWorkId: verifiedMetadata?.platformWorkId || source?.platformWorkId || '',
    repository: verifiedMetadata?.repository || source?.repository || '',
    sourcePath: verifiedMetadata?.sourcePath || source?.sourcePath || '',
    commitSha: verifiedMetadata?.commitSha || source?.commitSha || '',
    licenseEvidenceRef: verifiedMetadata?.licenseEvidenceRef || source?.licenseEvidenceRef || '',
    licenseEvidenceSha256: verifiedMetadata?.licenseEvidenceSha256 || source?.licenseEvidenceSha256 || '',
    ranking: verifiedMetadata?.ranking || source?.ranking || {},
    catalogSnapshot
  }, {
    evidenceRoot: RESOURCE_ROOT,
    requireRanking: true,
    requireRankingEvidence: config.requireRankingEvidence !== false
  });
  const reasons = [];
  if (fanfiction.isFanfiction) reasons.push('isFanfiction');
  if (forum.forumLike) reasons.push('forumLike');
  if (integrity.incomplete) reasons.push('incomplete');
  if (partial) reasons.push('partial');
  if (!authorizationCheck.usable) reasons.push('authorizationUnverified');
  if (config.requireCompletedWork === true && completionStatus !== 'completed') reasons.push('completionUnverified');
  if (config.requireCompletionEvidenceVerification === true && !completionEvidence.verified) reasons.push('completionEvidenceUnverified');
  if (config.requireFullWorkEvidence === true && !fullWorkEvidence.verified) reasons.push('fullWorkEvidenceUnverified');
  if (config.requireChapterSetEvidence === true && !catalogEvidence.verified) reasons.push('chapterSetEvidenceUnverified');
  if (!platformMetadata.verified) reasons.push('platformMetadataUnverified');
  const archiveEligibility = evaluateArchiveRecord({
    filePath: path.relative(RESOURCE_ROOT, filePath).replace(/\\/g, '/'),
    authorization,
    completionStatus,
    completionEvidenceRef,
    completionEvidenceVerified: completionEvidence.verified,
    contentScope,
    fullWorkEvidenceRef,
    fullWorkEvidenceVerified: fullWorkEvidence.verified,
    catalogSnapshot,
    catalogEvidenceVerified: catalogEvidence.verified,
    catalogEvidenceRef,
    catalogEvidenceSha256: catalogEvidence.sha256 || catalogEvidenceSha256,
    expectedChapterCount,
    fetchedChapterCount,
    chapterCountDeclared,
    chapterCoverage,
    chapters: chapterRecords,
    contentHash,
    quality: { incomplete: integrity.incomplete, partial },
    platformMetadataVerified: platformMetadata.verified,
    partial
  }, config);
  reasons.push(...archiveEligibility.reasons.filter(reason => !reasons.includes(reason)));
  return {
    originalFileName: path.basename(filePath),
    title,
    author: verifiedMetadata?.author || source?.author || '',
    bucket: inferBucket(filePath, config),
    archiveGroup: verifiedMetadata?.archiveGroup || inferArchiveGroup(filePath, config),
    genreBucket: verifiedMetadata?.genreBucket || inferBucket(filePath, config),
    filePath: path.relative(RESOURCE_ROOT, filePath).replace(/\\/g, '/'),
    sourceUrl: verifiedMetadata?.sourceUrl || source?.sourceUrl || null,
    platform: platformMetadata.platform || verifiedMetadata?.platform || source?.platform || null,
    platformWorkId: platformMetadata.platformWorkId || verifiedMetadata?.platformWorkId || source?.platformWorkId || '',
    sourceWorkId,
    canonicalWorkId,
    canonicalWorkIdExplicit: verifiedMetadata?.canonicalWorkIdExplicit === true || source?.canonicalWorkIdExplicit === true,
    sourceNovelId: sourceNovelIdValue,
    sourceKind: verifiedMetadata?.sourceKind || source?.sourceKind || (platformMetadata.platform === 'GitHub' ? 'github' : platformMetadata.platform ? 'platform' : ''),
    rawGenres,
    primaryGenre: verifiedMetadata?.primaryGenre || source?.primaryGenre || (rawGenres.length === 1 ? rawGenres[0] : ''),
    audience: verifiedMetadata?.audience || source?.audience || '',
    repository: platformMetadata.repository || verifiedMetadata?.repository || source?.repository || '',
    sourcePath: platformMetadata.sourcePath || verifiedMetadata?.sourcePath || source?.sourcePath || '',
    commitSha: platformMetadata.commitSha || verifiedMetadata?.commitSha || source?.commitSha || '',
    licenseEvidenceRef: platformMetadata.licenseEvidenceRef || verifiedMetadata?.licenseEvidenceRef || source?.licenseEvidenceRef || '',
    licenseEvidenceSha256: platformMetadata.licenseEvidenceSha256 || verifiedMetadata?.licenseEvidenceSha256 || source?.licenseEvidenceSha256 || '',
    licenseEvidenceVerified: platformMetadata.licenseEvidenceVerified === true,
    platformMetadataVerified: platformMetadata.verified,
    platformMetadataReasons: platformMetadata.reasons,
    ranking: platformMetadata.ranking && Object.keys(platformMetadata.ranking).length
      ? platformMetadata.ranking
      : verifiedMetadata?.ranking || source?.ranking || {},
    parser: verifiedMetadata?.parser || source?.parser || null,
    authorization,
    completionStatus,
    completionEvidenceRef,
    completionEvidenceVerified: completionEvidence.verified,
    completionEvidenceSha256: completionEvidence.sha256 || completionEvidenceSha256,
    completionObservedAt: verifiedMetadata?.completionObservedAt || source?.completionObservedAt || '',
    contentScope,
    fullWorkEvidenceRef,
    fullWorkEvidenceVerified: fullWorkEvidence.verified,
    fullWorkEvidenceSha256: fullWorkEvidence.sha256 || fullWorkEvidenceSha256,
    catalogSnapshot,
    catalogEvidenceRef,
    catalogEvidenceSha256: catalogEvidence.sha256 || catalogEvidenceSha256,
    expectedChapterCount,
    fetchedChapterCount,
    chapterCountDeclared,
    chapterCoverage,
    fetchedAt: verifiedMetadata?.fetchedAt || null,
    observedAt: new Date().toISOString(),
    totalChars: text.replace(/\s/g, '').length,
    chapterCount: chapters.length,
    chapterRange: (() => {
      const values = chapters.filter(chapter => chapter.unit === '章' && Number.isInteger(chapter.number)).map(chapter => chapter.number);
      return values.length ? { start: Math.min(...values), end: Math.max(...values) } : { start: null, end: null };
    })(),
    contentHash,
    metadataPath: verifiedMetadata?.metadataPath || null,
    quality: {
      isFanfiction: fanfiction.isFanfiction,
      forumLike: forum.forumLike,
      incomplete: integrity.incomplete,
      partial,
      reasons,
      fanfictionHits: fanfiction.hits,
      forumMetrics: forum,
      integrity,
      adLineCount,
      fetchMetadataMatched: metadataMatches,
      authorizationVerified: authorizationCheck.usable,
      authorizationReason: authorizationCheck.reason,
      authorizationEvidenceReason: authorizationEvidence.reason,
      authorizationMissingFields: authorizationCheck.missingFields,
      platformMetadataVerified: platformMetadata.verified,
      platformMetadataReasons: platformMetadata.reasons,
      completionVerified: completionStatus === 'completed',
      completionReason: completionStatus !== 'completed'
        ? 'completion_status_missing_or_unverified'
        : completionEvidence.verified ? 'completed' : completionEvidence.reason,
      completionEvidenceVerified: archiveEligibility.completionEvidenceVerified,
      completionEvidenceReason: completionEvidence.reason,
      fullWorkVerified: archiveEligibility.fullWorkVerified,
      fullWorkEvidenceVerified: archiveEligibility.fullWorkEvidenceVerified,
      fullWorkEvidenceReason: fullWorkEvidence.reason,
      catalogEvidenceVerified: catalogEvidence.verified,
      catalogEvidenceReason: catalogEvidence.reason,
      chapterSetMatches: archiveEligibility.chapterSetMatches,
      chapterOrderMatches: archiveEligibility.chapterOrderMatches,
      contentHashVerified: archiveEligibility.contentHashVerified,
      platformAdapter: verifiedMetadata?.parser || source?.parser || null
    },
    excludeFromCorpus: reasons.length > 0,
    chapters: chapterRecords.map(chapter => ({
      title: chapter.title,
      number: chapter.number,
      unit: chapter.unit,
      chars: chapter.chars,
      chapterId: chapter.chapterId,
      url: chapter.url
    }))
  };
}

/** 解析无来源身份分卷文件名中的章节范围，供保守归并使用。
 * 参数：fileName 为原书文件名。
 * 返回值：包含 start、end 的范围对象；无法确认时返回 null。
 */
function parseFilenameChapterRange(fileName) {
  const source = String(fileName || '');
  const match = source.match(/[（(]\s*(\d+)\s*[-—至]\s*(\d+)\s*(?:章节?|回|卷|部|集|篇)?\s*[）)]/u);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start
    ? { start, end }
    : null;
}

/** 判断原书记录是否已经具备可用于逻辑作品归并的外部身份。
 * 参数：file 为单个原书档案。
 * 返回值：存在规范作品、来源、URL或作者身份时返回 true。
 */
function hasArchiveIdentity(file) {
  return Boolean(
    file?.canonicalWorkId
      || file?.sourceWorkId
      || file?.sourceNovelId
      || file?.sourceUrl
      || String(file?.author || '').trim()
  );
}

/** 判断一组无身份分卷是否可以按同名且不重叠的文件名范围保守归并。
 * 参数：parts 为待判断的原书档案数组。
 * 返回值：至少两份同名、带明确且不重叠章节范围的分卷返回 true。
 */
function canInferRangeMerge(parts) {
  const values = Array.isArray(parts) ? parts : [];
  if (values.length < 2 || values.some(hasArchiveIdentity)) return false;
  const titles = new Set(values.map(part => normalizeTitle(part.originalFileName || part.title)));
  if (titles.size !== 1 || [...titles][0] === '') return false;
  const ranges = values.map(part => parseFilenameChapterRange(part.originalFileName || part.filePath));
  if (ranges.some(range => !range)) return false;
  const sorted = ranges.slice().sort((left, right) => left.start - right.start || left.end - right.end);
  return sorted.every((range, index) => index === 0 || range.start > sorted[index - 1].end);
}

/** 合并多个分卷的目录快照，保留跨分卷章节顺序和重复 ID 证据。
 * 参数：parts 为已按归档路径排序的分卷档案数组。
 * 返回值：合并后的目录快照；任一分卷没有目录快照时返回 null。
 */
function mergeCatalogSnapshots(parts) {
  const snapshots = (Array.isArray(parts) ? parts : [])
    .map(part => part?.catalogSnapshot)
    .filter(snapshot => snapshot && typeof snapshot === 'object');
  if (!snapshots.length || snapshots.length !== (Array.isArray(parts) ? parts.length : 0)) return null;
  const chapterIds = snapshots.flatMap(snapshot => Array.isArray(snapshot.chapterIds)
    ? snapshot.chapterIds.map(value => String(value || '').trim()).filter(Boolean)
    : []);
  const duplicateChapterIds = [];
  const seen = new Set();
  for (const snapshot of snapshots) {
    for (const id of Array.isArray(snapshot.duplicateChapterIds) ? snapshot.duplicateChapterIds : []) duplicateChapterIds.push(String(id || '').trim());
  }
  for (const id of chapterIds) {
    if (seen.has(id)) duplicateChapterIds.push(id);
    seen.add(id);
  }
  const chapters = snapshots.flatMap(snapshot => Array.isArray(snapshot.chapters)
    ? snapshot.chapters.map(chapter => ({ ...chapter }))
    : (Array.isArray(snapshot.chapterIds) ? snapshot.chapterIds.map(id => ({ chapterId: String(id || '').trim() })) : []));
  const snapshot = {
    sourceUrl: snapshots[0].sourceUrl || '',
    capturedAt: snapshots[0].capturedAt || '',
    chapterCount: chapterIds.length,
    chapterIds,
    chapters
  };
  return {
    ...snapshot,
    duplicateChapterIds: [...new Set(duplicateChapterIds.filter(Boolean))],
    snapshotSha256: sha256(JSON.stringify(snapshot))
  };
}

/** 按来源身份归并原书，并对无身份的同名章节范围分卷做保守合并。
 * 参数：archiveFiles 为扫描得到的逐文件原书档案数组。
 * 返回值：以逻辑归并键为键、原书档案数组为值的 Map。
 */
function buildArchiveGroups(archiveFiles) {
  const files = Array.isArray(archiveFiles) ? archiveFiles : [];
  const rangeTitles = new Set();
  const byTitle = new Map();
  for (const file of files) {
    if (hasArchiveIdentity(file)) continue;
    const title = normalizeTitle(file.originalFileName || file.title);
    if (!title) continue;
    if (!byTitle.has(title)) byTitle.set(title, []);
    byTitle.get(title).push(file);
  }
  for (const [title, parts] of byTitle) {
    if (canInferRangeMerge(parts)) rangeTitles.add(title);
  }
  const groups = new Map();
  for (const file of files) {
    const title = normalizeTitle(file.originalFileName || file.title);
    const key = hasArchiveIdentity(file)
      ? file.canonicalWorkId
        ? `canonical:${file.canonicalWorkId}`
        : file.sourceWorkId
          ? `work:${file.sourceWorkId}`
          : file.sourceNovelId
            ? `novel:${file.sourceNovelId}`
            : file.sourceUrl
              ? `url:${canonicalizeSourceUrl(file.sourceUrl)}`
              : `title:${title}|author:${String(file.author || '').trim()}`
      : rangeTitles.has(title)
        ? `range-title:${title}`
        : `unresolved:${title}|hash:${file.contentHash}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(file);
  }
  return groups;
}

/** 合并同一作品的分卷档案，保留每个文件并报告跨分卷缺口。
 * 参数：parts 为同一规范作品名的文件档案数组，config 为配额配置。
 * 返回值：manifest 中的一条逻辑作品记录。
 */
function mergeBookParts(parts, config) {
  const sorted = [...parts].sort((left, right) => left.filePath.localeCompare(right.filePath, 'zh-CN'));
  const title = sorted[0].title;
  const ranges = sorted.flatMap(part => {
    const numbers = part.chapters.filter(chapter => chapter.unit === '章').map(chapter => chapter.number).filter(Number.isInteger);
    return numbers.length ? [{ start: Math.min(...numbers), end: Math.max(...numbers) }] : [];
  }).sort((left, right) => left.start - right.start);
  const missingRanges = [];
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].start - ranges[index - 1].end > 1) missingRanges.push({ start: ranges[index - 1].end + 1, end: ranges[index].start - 1 });
  }
  const firstSource = sorted.find(part => part.sourceUrl);
  const contentHash = sha256(sorted.map(part => `${part.filePath}:${part.contentHash}`).join('|'));
  const reasons = [...new Set(sorted.flatMap(part => part.quality.reasons))];
  if (missingRanges.length) reasons.push('missingRanges');
  const rawGenres = [...new Set(sorted.flatMap(part => Array.isArray(part.rawGenres) ? part.rawGenres : []))];
  const sourcePart = sorted.find(part => part.sourceUrl || part.sourceNovelId);
  const sourceWorkPart = sorted.find(part => part.sourceWorkId);
  const canonicalWorkPart = sorted.find(part => part.canonicalWorkId);
  const author = sorted.find(part => part.author)?.author || '';
  const sourceWorkId = sourceWorkPart?.sourceWorkId || null;
  const canonicalWorkId = canonicalWorkPart?.canonicalWorkId || sourceWorkId || null;
  const authorizationPart = sorted.find(part => Object.values(part.authorization || {}).some(Boolean));
  const authorizationChecks = sorted.map(part => evaluateAuthorization(part.authorization, config.authorizationPolicy || {}));
  const authorizationVerified = authorizationChecks.every(item => item.usable);
  const completionStatuses = sorted.map(part => normalizeCompletionStatus(part.completionStatus || ''));
  const completionVerified = config.requireCompletedWork !== true || completionStatuses.every(status => status === 'completed');
  const completionEvidenceVerified = sorted.every(part => part.completionEvidenceVerified === true);
  const expectedChapterCount = sorted.reduce((sum, part) => sum + (Number(part.expectedChapterCount) || part.chapterCount || 0), 0);
  const fetchedChapterCount = sorted.reduce((sum, part) => sum + (Number(part.fetchedChapterCount) || part.chapterCount || 0), 0);
  const chapterCoverage = expectedChapterCount > 0 ? Number((fetchedChapterCount / expectedChapterCount).toFixed(6)) : null;
  const contentScope = sorted.every(part => part.contentScope === 'full_work') && (chapterCoverage === null || chapterCoverage >= 1) && !sorted.some(part => part.partial)
    ? 'full_work'
    : sorted.some(part => part.contentScope === 'partial' || part.partial) ? 'partial' : '';
  const fullWorkEvidenceVerified = sorted.every(part => part.fullWorkEvidenceVerified === true);
  const fullWorkVerified = sorted.every(part => part.quality.fullWorkVerified === true) && !missingRanges.length;
  const contentHashVerified = sorted.every(part => part.quality.contentHashVerified === true);
  const catalogEvidenceVerified = config.requireChapterSetEvidence !== true
    || sorted.every(part => part.catalogEvidenceVerified === true);
  const chapterSetMatches = config.requireChapterSetEvidence !== true
    || sorted.every(part => part.quality.chapterSetMatches === true);
  const chapterOrderMatches = config.requireChapterOrderEvidence !== true
    || sorted.every(part => part.quality.chapterOrderMatches === true);
  const chapterCountDeclared = sorted.every(part => part.chapterCountDeclared === true);
  const platformMetadataVerified = sorted.every(part => part.platformMetadataVerified !== false);
  const platformMetadataReasons = [...new Set(sorted.flatMap(part => Array.isArray(part.platformMetadataReasons) ? part.platformMetadataReasons : []))];
  const primaryGenre = sorted.find(part => part.primaryGenre)?.primaryGenre || (rawGenres.length === 1 ? rawGenres[0] : '');
  if (!completionVerified && !reasons.includes('completionUnverified')) reasons.push('completionUnverified');
  const logicalId = canonicalWorkId || sourceWorkId || (firstSource?.sourceUrl ? canonicalizeSourceUrl(firstSource.sourceUrl) : '') || `${title}|${author}|${contentHash}`;
  const rangeInferred = canInferRangeMerge(sorted);
  return {
    id: `book-${sha256(logicalId).slice(0, 12)}`,
    title,
    author,
    bucket: sorted.find(part => part.bucket)?.bucket || '',
    archiveGroup: sorted.find(part => part.archiveGroup)?.archiveGroup || '',
    genreBucket: sorted.find(part => part.genreBucket)?.genreBucket || sorted.find(part => part.bucket)?.bucket || '',
    sourceUrl: firstSource?.sourceUrl || null,
    platform: firstSource?.platform || null,
    platformWorkId: sorted.find(part => part.platformWorkId)?.platformWorkId || '',
    sourceWorkId,
    canonicalWorkId,
    canonicalWorkIdExplicit: sorted.some(part => part.canonicalWorkIdExplicit === true),
    identityConfidence: canonicalWorkId || sourceWorkId || author ? 'identified' : rangeInferred ? 'range-inferred' : 'content-hash-only',
    mergeEvidence: rangeInferred ? 'same-title-non-overlapping-filename-ranges' : '',
    sourceNovelId: sourcePart?.sourceNovelId || null,
    sourceKind: sorted.find(part => part.sourceKind)?.sourceKind || '',
    sourceWorkIds: [...new Set(sorted.map(part => part.sourceWorkId).filter(Boolean))],
    platforms: [...new Set(sorted.map(part => part.platform).filter(Boolean))],
    rawGenres,
    primaryGenre,
    audience: sorted.find(part => part.audience)?.audience || '',
    repository: sorted.find(part => part.repository)?.repository || '',
    sourcePath: sorted.find(part => part.sourcePath)?.sourcePath || '',
    commitSha: sorted.find(part => part.commitSha)?.commitSha || '',
    licenseEvidenceRef: sorted.find(part => part.licenseEvidenceRef)?.licenseEvidenceRef || '',
    licenseEvidenceSha256: sorted.find(part => part.licenseEvidenceSha256)?.licenseEvidenceSha256 || '',
    licenseEvidenceVerified: sorted.every(part => part.licenseEvidenceVerified !== false),
    platformMetadataVerified,
    platformMetadataReasons,
    ranking: sorted.find(part => Object.keys(part.ranking || {}).length > 0)?.ranking || {},
    parser: sorted.find(part => part.parser)?.parser || null,
    parsers: sorted.map(part => part.parser).filter(Boolean),
    authorization: authorizationPart?.authorization || {},
    completionStatus: completionStatuses.length && completionStatuses.every(status => status === 'completed') ? 'completed' : completionStatuses.find(status => status) || '',
    completionEvidenceRef: sorted.find(part => part.completionEvidenceRef)?.completionEvidenceRef || '',
    completionEvidenceVerified,
    completionEvidenceSha256: sorted.find(part => part.completionEvidenceSha256)?.completionEvidenceSha256 || '',
    completionObservedAt: sorted.find(part => part.completionObservedAt)?.completionObservedAt || '',
    contentScope,
    fullWorkEvidenceRef: sorted.find(part => part.fullWorkEvidenceRef)?.fullWorkEvidenceRef || '',
    fullWorkEvidenceVerified,
    fullWorkEvidenceSha256: sorted.find(part => part.fullWorkEvidenceSha256)?.fullWorkEvidenceSha256 || '',
    catalogSnapshot: mergeCatalogSnapshots(sorted),
    catalogEvidenceVerified,
    catalogEvidenceRef: sorted.find(part => part.catalogEvidenceRef)?.catalogEvidenceRef || '',
    catalogEvidenceSha256: sorted.find(part => part.catalogEvidenceSha256)?.catalogEvidenceSha256 || '',
    chapterSetMatches,
    chapterOrderMatches,
    expectedChapterCount,
    fetchedChapterCount,
    chapterCountDeclared,
    chapterCoverage,
    fetchedAt: latestFetchedAt(sorted),
    observedAt: new Date().toISOString(),
    totalChars: sorted.reduce((sum, part) => sum + part.totalChars, 0),
    chapterCount: sorted.reduce((sum, part) => sum + part.chapterCount, 0),
    contentHash,
    quality: {
      isFanfiction: sorted.some(part => part.quality.isFanfiction),
      forumLike: sorted.some(part => part.quality.forumLike),
      incomplete: sorted.some(part => part.quality.incomplete) || missingRanges.length > 0,
      partial: sorted.some(part => part.quality.partial === true),
      authorizationVerified,
      authorizationReason: authorizationChecks.find(item => !item.usable)?.reason || 'verified',
      reasons,
      completionVerified,
      completionReason: completionVerified ? 'completed' : 'completion_status_missing_or_unverified',
      completionEvidenceVerified,
      fullWorkVerified,
      fullWorkEvidenceVerified,
      catalogEvidenceVerified,
      chapterSetMatches,
      chapterOrderMatches,
      contentHashVerified,
      platformMetadataVerified,
      platformMetadataReasons,
      missingRanges,
      partsWithWarnings: sorted.filter(part => part.excludeFromCorpus).map(part => part.filePath)
    },
    excludeFromCorpus: reasons.length > 0,
    contributedCells: [],
    parts: sorted.map(part => ({
      filePath: part.filePath,
      originalFileName: part.originalFileName,
      author: part.author,
      sourceWorkId: part.sourceWorkId,
      canonicalWorkId: part.canonicalWorkId,
      canonicalWorkIdExplicit: part.canonicalWorkIdExplicit === true,
      sourceUrl: part.sourceUrl,
      platform: part.platform,
      platformWorkId: part.platformWorkId || '',
      sourceNovelId: part.sourceNovelId,
      sourceKind: part.sourceKind || '',
      rawGenres: part.rawGenres,
      primaryGenre: part.primaryGenre,
      audience: part.audience,
      repository: part.repository,
      sourcePath: part.sourcePath,
      commitSha: part.commitSha || '',
      licenseEvidenceRef: part.licenseEvidenceRef || '',
      licenseEvidenceSha256: part.licenseEvidenceSha256 || '',
      licenseEvidenceVerified: part.licenseEvidenceVerified === true,
      platformMetadataVerified: part.platformMetadataVerified !== false,
      platformMetadataReasons: Array.isArray(part.platformMetadataReasons) ? part.platformMetadataReasons : [],
      ranking: part.ranking,
      parser: part.parser || null,
      authorization: part.authorization,
      completionStatus: part.completionStatus,
      completionEvidenceRef: part.completionEvidenceRef,
      completionEvidenceVerified: part.completionEvidenceVerified === true,
      completionEvidenceSha256: part.completionEvidenceSha256 || '',
      completionObservedAt: part.completionObservedAt,
      contentScope: part.contentScope,
      fullWorkEvidenceRef: part.fullWorkEvidenceRef,
      fullWorkEvidenceVerified: part.fullWorkEvidenceVerified === true,
      fullWorkEvidenceSha256: part.fullWorkEvidenceSha256 || '',
      catalogSnapshot: part.catalogSnapshot || null,
      catalogEvidenceVerified: part.catalogEvidenceVerified === true,
      catalogEvidenceRef: part.catalogEvidenceRef || '',
      catalogEvidenceSha256: part.catalogEvidenceSha256 || '',
      archiveGroup: part.archiveGroup || '',
      genreBucket: part.genreBucket || part.bucket || '',
      expectedChapterCount: part.expectedChapterCount,
      fetchedChapterCount: part.fetchedChapterCount,
      chapterCoverage: part.chapterCoverage,
      fetchedAt: part.fetchedAt,
      totalChars: part.totalChars,
      chapterCount: part.chapterCount,
      chapterRange: part.chapterRange,
      contentHash: part.contentHash,
      metadataPath: part.metadataPath,
      quality: part.quality,
      chapters: Array.isArray(part.chapters) ? part.chapters : [],
      excludeFromCorpus: part.excludeFromCorpus
    }))
  };
}

/** 读取命令行参数并提供资源库扫描和输出路径。
 * 参数：argv 为 process.argv.slice(2)。
 * 返回值：规范化后的选项对象。
 */
function readOptions(argv) {
  const options = { root: ARCHIVE_ROOT, output: DEFAULT_OUTPUT };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--root') options.root = path.resolve(argv[++index]);
    else if (argv[index] === '--output') options.output = path.resolve(argv[++index]);
  }
  return options;
}

/** 构建原书 manifest，按逻辑作品合并分卷并保留逐文件档案。
 * 参数：options 为 readOptions 返回的路径选项。
 * 返回值：写入 manifest.json 的对象。
 */
function buildManifest(options) {
  const config = {
    ...readJson(CONFIG_PATH),
    resourceRoot: RESOURCE_ROOT,
    archiveRoot: ARCHIVE_ROOT,
    revalidateArchiveEvidence: true
  };
  const blocklist = readJson(BLOCKLIST_PATH);
  const sourceList = fs.existsSync(SOURCE_LIST_PATH) ? readJson(SOURCE_LIST_PATH) : { sources: [] };
  const fetchMetadata = readFetchMetadata();
  const filePaths = fs.existsSync(options.root)
    ? fs.readdirSync(options.root, { recursive: true }).filter(file => String(file).toLowerCase().endsWith('.txt')).map(file => path.join(options.root, file))
    : [];
  const archiveFiles = filePaths.map(filePath => {
    const relativePath = path.relative(RESOURCE_ROOT, filePath).replace(/\\/g, '/');
    return inspectArchiveFile(filePath, config, blocklist, sourceList, fetchMetadata.get(relativePath) || null);
  });
  const groups = buildArchiveGroups(archiveFiles);
  const books = [...groups.values()].map(parts => mergeBookParts(parts, config));
  const manifest = {
    schemaVersion: 'corpus-v3-manifest-1',
    generatedAt: new Date().toISOString(),
    sourcePolicy: '只登记本地原书档案；优先读取同哈希抓取 sidecar，来源 URL、时间和授权证据未知时保留 null，不虚构抓取事实。',
    archiveRoot: path.relative(RESOURCE_ROOT, options.root).replace(/\\/g, '/'),
    mergePolicy: '优先按显式 canonicalWorkId、来源作品 ID、作品 ID、来源 URL或作者合并；无来源身份时仅对同名且文件名章节范围明确且不重叠的分卷做范围推断合并，其余按内容哈希隔离，所有原文件保留在 parts 和 archiveFiles 中。',
    books,
    archiveFiles,
    summary: {
      logicalBookCount: books.length,
      archiveFileCount: archiveFiles.length,
      excludedBookCount: books.filter(book => book.excludeFromCorpus).length,
      partialBookCount: books.filter(book => book.quality.partial).length,
      usableBookCount: books.filter(book => evaluateArchiveRecord(book, config).usable).length,
      authorizationVerifiedBookCount: books.filter(book => book.quality.authorizationVerified === true).length,
      authorizationUnverifiedBookCount: books.filter(book => book.quality.authorizationVerified !== true).length,
      unattributedArchiveFileCount: archiveFiles.filter(file => !file.sourceUrl && !file.sourceNovelId).length,
      totalChars: books.reduce((sum, book) => sum + book.totalChars, 0),
      incompleteBooks: books.filter(book => book.quality.incomplete).map(book => ({ id: book.id, title: book.title, missingRanges: book.quality.missingRanges }))
    }
  };
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const manifest = buildManifest(readOptions(process.argv.slice(2)));
  console.log(JSON.stringify(manifest.summary, null, 2));
}

export {
  normalizeTitle,
  splitChapters,
  detectFanfiction,
  detectForumLike,
  detectIncomplete,
  inspectArchiveFile,
  mergeBookParts,
  buildArchiveGroups,
  buildManifest,
  readFetchMetadata
};
