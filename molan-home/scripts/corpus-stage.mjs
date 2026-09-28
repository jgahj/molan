import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const DEFAULT_RESOURCE_ROOT = path.resolve(REPO_ROOT, '..', '资源库');
const DEFAULT_ARCHIVE_ROOT = path.join(DEFAULT_RESOURCE_ROOT, '小说原本');
const DEFAULT_OUTPUT_ROOT = DEFAULT_RESOURCE_ROOT;

export const THRESHOLDS = Object.freeze({
  minimumFileBytes: 100 * 1024,
  minimumChapters: 10,
  minimumCoverage: 0.6,
  partialCoverage: 0.95,
  puaRate: 0.001,
  mojibakeRate: 0.01,
  shortChapterChars: 500,
  shortChapterRatio: 0.35,
  shortAttackChapterRate: 0.3,
  emptyChapterRate: 0.4,
  duplicateParagraphRate: 0.5,
  watermarkLineRate: 0.005
});

const FANQIE_CATEGORY_TARGETS = Object.freeze({
  traditionalFantasy: ['传统玄幻', '玄幻脑洞'],
  xianxia: ['东方仙侠'],
  urbanXianxia: ['都市修真'],
  westernFantasy: ['西方奇幻'],
  urbanHigh武: ['都市高武'],
  urban: ['都市日常', '都市脑洞', '都市种田', '战神赘婿'],
  history: ['历史脑洞', '历史古代'],
  military: ['抗战谍战'],
  mystery: ['悬疑脑洞(男)', '女频悬疑', '悬疑脑洞(女)'],
  scienceFiction: ['科幻末世(男)', '科幻末世(女)'],
  game: ['游戏体育(男)', '游戏体育(女)'],
  lightNovel: ['男频衍生', '动漫衍生'],
  femaleDerivative: ['女频衍生'],
  femaleFantasy: ['玄幻言情'],
  ancientRomance: ['古风世情', '种田', '宫斗宅斗', '古言脑洞'],
  modernRomance: ['快穿', '现言脑洞', '民国言情', '星光璀璨', '豪门总裁', '青春甜宠'],
  femaleUrban: ['职场婚恋', '年代']
});

const FANQIE_CATEGORY_LOOKUP = Object.freeze(Object.fromEntries(
  Object.entries(FANQIE_CATEGORY_TARGETS).flatMap(([target, categories]) => categories.map(category => [category, target]))
));

const CATEGORY_TO_GENRE = Object.freeze({
  traditionalFantasy: { target: '玄幻', rawGenres: ['玄幻'], primaryGenre: '玄幻', audience: '男频' },
  xianxia: { target: '仙侠', rawGenres: ['仙侠'], primaryGenre: '仙侠', audience: '男频' },
  urbanXianxia: { target: '仙侠', rawGenres: ['仙侠', '都市'], primaryGenre: '仙侠', audience: '男频' },
  westernFantasy: { target: '奇幻', rawGenres: ['奇幻'], primaryGenre: '奇幻', audience: '男频' },
  urbanHigh武: { target: '都市', rawGenres: ['都市', '玄幻'], primaryGenre: '都市', audience: '男频' },
  urban: { target: '都市', rawGenres: ['都市'], primaryGenre: '都市', audience: '男频' },
  history: { target: '历史', rawGenres: ['历史'], primaryGenre: '历史', audience: '男频' },
  military: { target: '军事', rawGenres: ['惊险'], primaryGenre: '惊险', audience: '男频' },
  mystery: { target: '悬疑灵异', rawGenres: ['悬疑'], primaryGenre: '悬疑', audience: '男频' },
  scienceFiction: { target: '科幻', rawGenres: ['科幻'], primaryGenre: '科幻', audience: '男频' },
  game: { target: '游戏', rawGenres: ['游戏', '体育'], primaryGenre: '游戏', audience: '男频' },
  lightNovel: { target: '轻小说', rawGenres: ['动漫'], primaryGenre: '动漫', audience: '男频' },
  femaleDerivative: { target: '女频衍生', rawGenres: ['言情衍生'], primaryGenre: '言情', audience: '女频' },
  femaleFantasy: { target: '女频补充/玄幻言情', rawGenres: ['玄幻', '言情'], primaryGenre: '言情', audience: '女频' },
  ancientRomance: { target: '女频补充/古言', rawGenres: ['古言'], primaryGenre: '古言', audience: '女频' },
  modernRomance: { target: '女频补充/现言', rawGenres: ['现言'], primaryGenre: '现言', audience: '女频' },
  femaleUrban: { target: '女频补充/都市', rawGenres: ['都市'], primaryGenre: '都市', audience: '女频' }
});

const WATERMARK_PATTERNS = Object.freeze([
  /shukuge/iu,
  /365小说/iu,
  /www\.shukuge\.com/iu,
  /笔趣阁/iu,
  /sobqg/iu,
  /最新章节/iu,
  /本章完/iu,
  /求收藏|求月票|求订阅/iu
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function firstText(...values) {
  return values.map(value => String(value ?? '').trim()).find(Boolean) || '';
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function foldText(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, '').toLocaleLowerCase();
}

export function normalizeTitle(value) {
  return String(value ?? '')
    .replace(/\.txt$/iu, '')
    .replace(/^\d+[-_]/u, '')
    .replace(/[【\[].*?(?:搜|笔趣|www\.).*?[】\]]/iu, '')
    .replace(/\s*[（(][^）)]*(?:章|卷|部|篇)[^）)]*[）)]\s*$/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function parseFilenameMetadata(fileName, header = {}) {
  const base = normalizeTitle(path.basename(String(fileName || '')));
  const match = base.match(/^(.*)\s+-\s+(.+)$/u);
  const title = firstText(header.title, match?.[1], base);
  const author = firstText(header.author, match?.[2]);
  return { title, author };
}

export function parseLegacyHeader(text) {
  const lines = String(text ?? '').replace(/^\uFEFF/u, '').split(/\r?\n/u).slice(0, 8);
  const find = pattern => lines.find(line => pattern.test(line))?.replace(/^\s*(?:小说名|书名|作者|作者名)\s*[：:]\s*/u, '').trim() || '';
  const title = find(/^\s*(?:小说名|书名)\s*[：:]/u);
  const author = find(/^\s*(?:作者|作者名)\s*[：:]/u);
  return { title, author };
}

function walkFiles(root) {
  if (!fs.existsSync(root)) return [];
  const result = [];
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile() && /\.txt$/iu.test(entry.name)) result.push(fullPath);
    }
  };
  visit(root);
  return result.sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

function relativeSlash(root, filePath) {
  return path.relative(root, filePath).replace(/\\/gu, '/');
}

function sourceCategoryFor(relativePath) {
  return relativePath.split('/').filter(Boolean)[0] || '';
}

export function classifyArchiveFile(relativePath, header = {}) {
  const category = sourceCategoryFor(relativePath);
  if (FANQIE_CATEGORY_LOOKUP[category]) return { platform: '番茄', sourceCategory: category };
  if (header.title || header.author) return { platform: '番茄', sourceCategory: category };
  if (relativePath.split('/').length > 1) return { platform: '起点', sourceCategory: category };
  return { platform: 'unknown', sourceCategory: category };
}

function desiredPathFor({ platform, sourceCategory, title, author, relativePath }) {
  const safeName = [title, author].filter(Boolean).join(' - ') + '.txt';
  if (!title || !author) return { target: '', reason: 'title_or_author_missing' };
  if (platform === '起点') return { target: `${sourceCategory}/${safeName}`, reason: 'qidian_filename_contract' };
  const targetInfo = CATEGORY_TO_GENRE[FANQIE_CATEGORY_LOOKUP[sourceCategory]];
  if (!targetInfo) return { target: '', reason: 'fanqie_category_unmapped' };
  return { target: `${targetInfo.target}/${safeName}`, reason: 'fanqie_category_contract' };
}

export function planReorganization(fileRecords, options = {}) {
  const archiveRoot = String(options.archiveRoot || '').replace(/[\\/]$/u, '');
  const resourceRoot = options.resourceRoot || path.dirname(archiveRoot);
  const files = [];
  const unresolvedFiles = [];
  const targetOwners = new Map();
  for (const input of [...(fileRecords || [])].sort((a, b) => String(a.path || '').localeCompare(String(b.path || ''), 'zh-CN'))) {
    const sourcePath = String(input.path || input.filePath || '');
    const relativePath = String(input.relativePath || relativeSlash(archiveRoot, sourcePath));
    const header = input.header || {};
    const identity = parseFilenameMetadata(sourcePath, header);
    const classification = classifyArchiveFile(relativePath, header);
    const targetPlan = desiredPathFor({ ...classification, ...identity, relativePath });
    const file = {
      id: `archive-${sha256(relativePath).slice(0, 16)}`,
      from: relativePath,
      fromPath: relativePath,
      to: targetPlan.target,
      toPath: targetPlan.target,
      title: identity.title,
      author: identity.author,
      platform: classification.platform,
      sourceCategory: classification.sourceCategory,
      bytes: numberOrNull(input.bytes),
      sha256: String(input.sha256 || ''),
      action: targetPlan.target ? (relativePath === targetPlan.target ? 'keep' : 'move') : 'unresolved',
      reason: targetPlan.reason
    };
    if (input.isTestDuplicate === true || /^测试(?:[\\/]|$)/u.test(relativePath)) {
      file.action = 'exclude';
      file.reason = 'test_duplicate_requires_manual_cleanup';
      file.to = '';
      file.toPath = '';
    } else if (file.bytes !== null && file.bytes < THRESHOLDS.minimumFileBytes) {
      file.action = 'quarantine';
      file.reason = 'file_below_100KB';
      file.to = `_quarantine/${path.basename(relativePath)}`;
      file.toPath = file.to;
    }
    if (file.action === 'unresolved') unresolvedFiles.push({ id: file.id, from: file.from, reason: file.reason });
    if (file.to) {
      const previous = targetOwners.get(file.to);
      if (previous) {
        file.action = 'conflict';
        file.reason = 'target_path_collision';
        unresolvedFiles.push({ id: file.id, from: file.from, reason: file.reason, target: file.to, conflictsWith: previous });
      } else targetOwners.set(file.to, file.id);
    }
    files.push(file);
  }
  return {
    schemaVersion: 'corpus-reorganize-report-1',
    status: unresolvedFiles.length || !files.length ? 'pending' : 'ready',
    pendingReasons: !files.length ? ['no_txt_files'] : [],
    archiveRoot: relativeSlash(resourceRoot, archiveRoot) || '.',
    files,
    unresolvedFiles,
    summary: {
      fileCount: files.length,
      moveCount: files.filter(file => file.action === 'move').length,
      keepCount: files.filter(file => file.action === 'keep').length,
      quarantineCount: files.filter(file => file.action === 'quarantine').length,
      excludedCount: files.filter(file => file.action === 'exclude').length,
      unresolvedCount: unresolvedFiles.length
    }
  };
}

export function buildReorganizeReport({ archiveRoot, resourceRoot } = {}) {
  if (!archiveRoot || !fs.existsSync(archiveRoot)) {
    return { schemaVersion: 'corpus-reorganize-report-1', status: 'blocked', reason: 'archive_root_missing', files: [], unresolvedFiles: [] };
  }
  const records = walkFiles(archiveRoot).map(filePath => {
    const bytes = fs.statSync(filePath).size;
    const handle = fs.openSync(filePath, 'r');
    const prefix = Buffer.alloc(Math.min(64 * 1024, bytes));
    fs.readSync(handle, prefix, 0, prefix.length, 0);
    fs.closeSync(handle);
    const header = parseLegacyHeader(prefix.toString('utf8'));
    return {
      path: filePath,
      relativePath: relativeSlash(archiveRoot, filePath),
      bytes,
      sha256: '',
      header
    };
  });
  return planReorganization(records, { archiveRoot, resourceRoot: resourceRoot || path.dirname(archiveRoot) });
}

function arrayFrom(value) {
  return Array.isArray(value) ? value : [];
}

export function flattenRankManifest(manifest, platform) {
  const rows = [];
  const manifestRankEvidence = isObject(manifest?.rankEvidence) ? manifest.rankEvidence : {};
  for (const category of arrayFrom(manifest?.categories)) {
    const categoryRankEvidence = isObject(category?.rankEvidence) ? category.rankEvidence : {};
    for (const [rankType, values] of Object.entries(category?.ranks || {})) {
      for (const [index, item] of arrayFrom(values).entries()) {
        const row = isObject(item) ? item : {};
        const rowRanking = isObject(row.ranking) ? row.ranking : {};
        const rankEvidence = mergeObjects(manifestRankEvidence, categoryRankEvidence, row.rankEvidence);
        const id = firstText(row.id, row.bookId, row.workId, row.platformWorkId);
        if (!id) continue;
        rows.push({
          platform,
          platformWorkId: id,
          title: firstText(row.title, row.bookName),
          author: firstText(row.author),
          category: firstText(category.name, row.category),
          rawGenres: arrayFrom(row.rawGenres || row.genres || row.genre).map(String).filter(Boolean),
          rankType,
          rank: numberOrNull(row.rank) ?? index + 1,
          wordNumber: numberOrNull(row.wordNumber),
          creationStatus: firstText(row.creationStatus, row.status),
          readCount: firstText(row.readCount),
          rankEvidenceRef: firstText(row.rankEvidenceRef, row.rank_evidence_ref, rowRanking.rankEvidenceRef, rowRanking.rank_evidence_ref, rankEvidence.evidenceRef, rankEvidence.ref),
          rankEvidenceSha256: firstHash([
            row.rankEvidenceSha256,
            row.rank_evidence_sha256,
            rowRanking.rankEvidenceSha256,
            rowRanking.rank_evidence_sha256,
            rankEvidence.evidenceSha256,
            rankEvidence.sha256,
            rankEvidence.hash
          ]),
          rankEvidenceVerified: firstBoolean([
            row.rankEvidenceVerified,
            row.rank_evidence_verified,
            rowRanking.rankEvidenceVerified,
            rowRanking.rank_evidence_verified,
            rankEvidence.verified,
            rankEvidence.evidenceVerified
          ]),
          rankCapturedAt: firstPresent([
            row.rankCapturedAt,
            row.rank_captured_at,
            rowRanking.rankCapturedAt,
            rowRanking.rank_captured_at,
            rankEvidence.capturedAt,
            rankEvidence.collectedAt
          ]),
          rankSourceUrl: firstText(row.rankSourceUrl, row.rank_source_url, rowRanking.rankSourceUrl, rowRanking.rank_source_url, rankEvidence.sourceUrl, rankEvidence.url),
          manifestOrder: rows.length
        });
      }
    }
  }
  return rows;
}

function dedupeRankRows(rows) {
  const rankPriority = { 畅销榜: 0, 新书榜: 1 };
  const map = new Map();
  for (const row of rows) {
    const old = map.get(`${row.platform}:${row.platformWorkId}`);
    if (!old || (rankPriority[row.rankType] ?? 99) < (rankPriority[old.rankType] ?? 99)) map.set(`${row.platform}:${row.platformWorkId}`, row);
  }
  return [...map.values()].sort((a, b) => a.manifestOrder - b.manifestOrder);
}

function progressRows(progress) {
  if (Array.isArray(progress)) return progress.map(item => [firstText(item?.bookId, item?.id), item]);
  if (isObject(progress?.works)) return Object.entries(progress.works);
  if (isObject(progress?.done)) return Object.entries(progress.done).map(([key, value]) => [key, { status: 'done', path: value }]);
  return Object.entries(progress || {});
}

function progressById(progress) {
  return new Map(progressRows(progress).filter(([id]) => id).map(([id, value]) => [String(id), isObject(value) ? value : { path: value }]));
}

function progressFor(progressMap, row) {
  return progressMap.get(row.platformWorkId)
    || progressMap.get(`${row.title}|${row.author}`)
    || progressMap.get(`${foldText(row.title)}|${foldText(row.author)}`)
    || null;
}

function metadataById(metadata) {
  const entries = isObject(metadata) && !Array.isArray(metadata)
    ? (isObject(metadata.books) ? Object.entries(metadata.books) : Object.entries(metadata))
    : arrayFrom(metadata).map(item => [firstText(item?.bookId, item?.id, item?.platformWorkId), item]);
  return new Map(entries.filter(([id]) => id).map(([id, value]) => [String(id), isObject(value) ? value : {}]));
}

function statusFor(value, platform) {
  const status = String(value ?? '').trim().toLowerCase();
  if (platform === '番茄') {
    if (['0', 'completed', 'complete', '已完结', '完结', '完本'].includes(status)) return 'completed';
    if (['1', 'serializing', 'ongoing', '连载', '连载中'].includes(status)) return 'serializing';
  }
  if (['completed', 'complete', '已完结', '完结', '完本'].includes(status)) return 'completed';
  if (['serializing', 'ongoing', '连载', '连载中'].includes(status)) return 'serializing';
  return 'unknown';
}

function mergeObjects(...values) {
  return Object.assign({}, ...values.filter(isObject));
}

function firstPresent(values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== '') ?? null;
}

function firstBoolean(values) {
  return values.find(value => typeof value === 'boolean') ?? null;
}

function firstNumber(values) {
  for (const value of values) {
    if (value === undefined || value === null || String(value).trim() === '') continue;
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return null;
}

function firstHash(values) {
  const value = firstPresent(values);
  const normalized = value === null ? '' : String(value).trim().toLowerCase();
  return /^[a-f0-9]{64}$/u.test(normalized) ? normalized : null;
}

function fieldValues(sources, keys) {
  return sources.flatMap(source => keys.map(key => source?.[key]));
}

function normalizeEvidence({ records = [], sources = [], statusSources = sources, statusKeys = ['status'], refKeys = ['evidenceRef', 'ref', 'reference'], verifiedKeys = ['verified', 'evidenceVerified'], hashKeys = ['evidenceSha256', 'sha256', 'hash'] } = {}) {
  const merged = mergeObjects(...records);
  const status = firstPresent(fieldValues(statusSources, statusKeys));
  const evidenceRef = firstPresent(fieldValues(sources, refKeys));
  const verified = firstBoolean(fieldValues(sources, verifiedKeys));
  const evidenceSha256 = firstHash(fieldValues(sources, hashKeys));
  return {
    ...merged,
    status: status === null ? 'unknown' : String(status).trim(),
    verified: verified === true,
    evidenceRef,
    evidenceSha256
  };
}

function completionStatusFor(platform, values) {
  for (const value of values) {
    const status = statusFor(value, platform);
    if (status !== 'unknown') return status;
  }
  return 'unknown';
}

function reportEntries(report) {
  return arrayFrom(report?.files || report?.entries).map(file => ({
    ...file,
    path: firstText(file.path, file.toPath, file.to, file.currentPath, file.fromPath, file.from)
  }));
}

function findReportFile(row, reportFiles) {
  const titleKey = foldText(row.title);
  const authorKey = foldText(row.author);
  const exact = reportFiles.find(file => file.action !== 'quarantine' && file.action !== 'exclude'
    && (foldText(file.title) === titleKey && (!authorKey || foldText(file.author) === authorKey)));
  if (exact) return exact;
  return reportFiles.find(file => foldText(path.basename(file.path)) === foldText(`${row.title} - ${row.author}.txt`));
}

function sourceRecord(row, file, platform, metadata, progress) {
  const sourceId = `${platform === '起点' ? 'qidian' : 'fanqie'}-${row.platformWorkId}`;
  const genre = platform === '番茄' ? CATEGORY_TO_GENRE[FANQIE_CATEGORY_LOOKUP[row.category]] : {
    target: row.category,
    rawGenres: row.rawGenres.length ? row.rawGenres : [row.category],
    primaryGenre: row.category,
    audience: '男频'
  };
  const metadataRecord = isObject(metadata) ? metadata : {};
  const progressRecord = isObject(progress) ? progress : {};
  const merged = { ...progressRecord, ...metadataRecord };
  const metadataQuality = isObject(metadataRecord.quality) ? metadataRecord.quality : {};
  const progressQuality = isObject(progressRecord.quality) ? progressRecord.quality : {};
  const metadataIntegrity = isObject(metadataRecord.integrity) ? metadataRecord.integrity : {};
  const progressIntegrity = isObject(progressRecord.integrity) ? progressRecord.integrity : {};
  const metadataAuthorization = mergeObjects(
    metadataRecord.authorizationEvidence,
    metadataRecord.authorization
  );
  const progressAuthorization = mergeObjects(
    progressRecord.authorizationEvidence,
    progressRecord.authorization
  );
  const authorizationSources = [
    metadataAuthorization,
    progressAuthorization,
    { authorizationStatus: metadataRecord.authorizationStatus },
    { authorizationStatus: progressRecord.authorizationStatus }
  ];
  const authorization = normalizeEvidence({
    records: [progressAuthorization, metadataAuthorization],
    sources: authorizationSources,
    statusSources: authorizationSources,
    statusKeys: ['status', 'authorizationStatus'],
    refKeys: ['evidenceRef', 'authorizationEvidenceRef', 'authorization_evidence_ref'],
    verifiedKeys: ['verified', 'evidenceVerified', 'authorizationVerified', 'authorizationEvidenceVerified'],
    hashKeys: ['evidenceSha256', 'evidenceSHA256', 'authorizationEvidenceSha256', 'authorization_evidence_sha256']
  });
  authorization.evidenceVerified = authorization.verified;

  const metadataCompletionEvidence = isObject(metadataRecord.completionEvidence) ? metadataRecord.completionEvidence : {};
  const progressCompletionEvidence = isObject(progressRecord.completionEvidence) ? progressRecord.completionEvidence : {};
  const completionEvidenceSources = [
    metadataCompletionEvidence,
    progressCompletionEvidence,
    metadataRecord,
    progressRecord,
    { completionEvidenceStatus: metadataRecord.completionEvidenceStatus },
    { completionEvidenceStatus: progressRecord.completionEvidenceStatus },
    metadataIntegrity,
    progressIntegrity,
    metadataQuality,
    progressQuality
  ];
  const completionEvidence = normalizeEvidence({
    records: [progressCompletionEvidence, metadataCompletionEvidence],
    sources: completionEvidenceSources,
    statusSources: [
      metadataCompletionEvidence,
      progressCompletionEvidence,
      { completionEvidenceStatus: metadataRecord.completionEvidenceStatus },
      { completionEvidenceStatus: progressRecord.completionEvidenceStatus }
    ],
    statusKeys: ['status', 'completionEvidenceStatus'],
    refKeys: ['evidenceRef', 'completionEvidenceRef', 'completion_evidence_ref'],
    verifiedKeys: ['verified', 'evidenceVerified', 'completionEvidenceVerified', 'completion_evidence_verified'],
    hashKeys: ['evidenceSha256', 'sha256', 'completionEvidenceSha256', 'completion_evidence_sha256']
  });

  const metadataFullWorkEvidence = mergeObjects(
    metadataQuality.fullWorkEvidence,
    metadataIntegrity.fullWorkEvidence,
    metadataRecord.fullWork,
    metadataRecord.fullWorkEvidence
  );
  const progressFullWorkEvidence = mergeObjects(
    progressQuality.fullWorkEvidence,
    progressIntegrity.fullWorkEvidence,
    progressRecord.fullWork,
    progressRecord.fullWorkEvidence
  );
  const fullWorkEvidenceSources = [
    metadataFullWorkEvidence,
    progressFullWorkEvidence,
    metadataRecord,
    progressRecord,
    { fullWorkEvidenceStatus: metadataRecord.fullWorkEvidenceStatus },
    { fullWorkEvidenceStatus: progressRecord.fullWorkEvidenceStatus },
    metadataIntegrity,
    progressIntegrity,
    metadataQuality,
    progressQuality
  ];
  const fullWorkEvidence = normalizeEvidence({
    records: [progressFullWorkEvidence, metadataFullWorkEvidence],
    sources: fullWorkEvidenceSources,
    statusSources: [
      metadataFullWorkEvidence,
      progressFullWorkEvidence,
      { fullWorkEvidenceStatus: metadataRecord.fullWorkEvidenceStatus },
      { fullWorkEvidenceStatus: progressRecord.fullWorkEvidenceStatus }
    ],
    statusKeys: ['status', 'fullWorkEvidenceStatus'],
    refKeys: ['evidenceRef', 'fullWorkEvidenceRef', 'full_work_evidence_ref'],
    verifiedKeys: ['verified', 'evidenceVerified', 'fullWorkEvidenceVerified', 'full_work_evidence_verified', 'fullWorkVerified'],
    hashKeys: ['evidenceSha256', 'sha256', 'fullWorkEvidenceSha256', 'full_work_evidence_sha256']
  });

  const catalogEvidenceSources = [
    metadataRecord.catalogEvidence,
    progressRecord.catalogEvidence,
    metadataRecord,
    progressRecord
  ];
  const catalogEvidence = normalizeEvidence({
    records: [progressRecord.catalogEvidence, metadataRecord.catalogEvidence],
    sources: catalogEvidenceSources,
    statusSources: [
      { catalogEvidenceStatus: metadataRecord.catalogEvidenceStatus },
      { catalogEvidenceStatus: progressRecord.catalogEvidenceStatus }
    ],
    statusKeys: ['catalogEvidenceStatus'],
    refKeys: ['evidenceRef', 'catalogEvidenceRef', 'catalog_evidence_ref'],
    verifiedKeys: ['verified', 'evidenceVerified', 'catalogEvidenceVerified', 'catalog_evidence_verified'],
    hashKeys: ['evidenceSha256', 'sha256', 'catalogEvidenceSha256', 'catalog_evidence_sha256']
  });
  const ranking = {
    ...mergeObjects(row.ranking, progressRecord.ranking, metadataRecord.ranking),
    rankType: row.rankType || null,
    rank: row.rank ?? null,
    readCount: row.readCount || null,
    rankEvidenceRef: row.rankEvidenceRef || null,
    rankEvidenceSha256: row.rankEvidenceSha256 || null,
    rankEvidenceVerified: row.rankEvidenceVerified === true,
    rankCapturedAt: row.rankCapturedAt || null,
    rankSourceUrl: row.rankSourceUrl || null
  };
  const expectedChapterCount = firstNumber([
    metadataRecord.expectedChapterCount,
    progressRecord.expectedChapterCount,
    metadataIntegrity.expectedChapterCount,
    progressIntegrity.expectedChapterCount,
    metadataQuality.expectedChapterCount,
    progressQuality.expectedChapterCount
  ]);
  const fetchedChapterCount = firstNumber([
    metadataRecord.fetchedChapterCount,
    progressRecord.fetchedChapterCount,
    metadataIntegrity.fetchedChapterCount,
    progressIntegrity.fetchedChapterCount,
    metadataQuality.fetchedChapterCount,
    progressQuality.fetchedChapterCount
  ]);
  const chapterCoverage = firstNumber([
    metadataRecord.chapterCoverage,
    progressRecord.chapterCoverage,
    metadataIntegrity.chapterCoverage,
    progressIntegrity.chapterCoverage,
    metadataQuality.chapterCoverage,
    progressQuality.chapterCoverage
  ]);
  const chapterCountDeclared = firstBoolean([
    metadataRecord.chapterCountDeclared,
    progressRecord.chapterCountDeclared,
    metadataIntegrity.chapterCountDeclared,
    progressIntegrity.chapterCountDeclared,
    metadataQuality.chapterCountDeclared,
    progressQuality.chapterCountDeclared
  ]);
  const partial = firstBoolean([
    metadataRecord.partial,
    progressRecord.partial,
    metadataIntegrity.partial,
    progressIntegrity.partial,
    metadataQuality.partial,
    progressQuality.partial
  ]);
  const incomplete = firstBoolean([
    metadataRecord.incomplete,
    progressRecord.incomplete,
    metadataIntegrity.incomplete,
    progressIntegrity.incomplete,
    metadataQuality.incomplete,
    progressQuality.incomplete
  ]);
  const contentScope = firstPresent([
    metadataRecord.contentScope,
    progressRecord.contentScope,
    metadataIntegrity.contentScope,
    progressIntegrity.contentScope,
    metadataQuality.contentScope,
    progressQuality.contentScope
  ]);
  const contentHash = firstHash([
    metadataRecord.contentHash,
    metadataRecord.content_hash,
    progressRecord.contentHash,
    progressRecord.content_hash,
    metadataIntegrity.contentHash,
    progressIntegrity.contentHash,
    metadataQuality.contentHash,
    progressQuality.contentHash,
    metadataRecord.sourceContentHash,
    progressRecord.sourceContentHash,
    file?.contentHash,
    file?.sha256
  ]);
  const sourceContentHash = firstHash([
    metadataRecord.sourceContentHash,
    metadataRecord.source_content_sha256,
    metadataRecord.contentHashSha256,
    progressRecord.sourceContentHash,
    progressRecord.source_content_sha256,
    progressRecord.contentHashSha256,
    contentHash
  ]);
  const sourceTextHash = firstHash([
    metadataRecord.sourceTextHash,
    metadataRecord.source_text_hash,
    progressRecord.sourceTextHash,
    progressRecord.source_text_hash
  ]);
  const contentHashVerified = firstBoolean([
    metadataRecord.contentHashVerified,
    progressRecord.contentHashVerified,
    metadataIntegrity.contentHashVerified,
    progressIntegrity.contentHashVerified,
    metadataQuality.contentHashVerified,
    progressQuality.contentHashVerified
  ]);
  const quality = mergeObjects(progressQuality, metadataQuality);
  const integrity = {
    ...mergeObjects(progressIntegrity, metadataIntegrity),
    status: firstPresent([
      metadataIntegrity.status,
      progressIntegrity.status,
      metadataQuality.status,
      progressQuality.status
    ]) || 'unknown',
    chapterCountDeclared,
    expectedChapterCount,
    fetchedChapterCount,
    chapterCoverage,
    contentScope,
    partial,
    incomplete,
    contentHash,
    contentHashVerified: contentHashVerified === true
  };
  const completionStatus = completionStatusFor(platform, [
    metadataRecord.completionStatus,
    metadataRecord.completion_status,
    progressRecord.completionStatus,
    progressRecord.completion_status,
    metadataRecord.creationStatus,
    progressRecord.creationStatus,
    metadataRecord.status,
    progressRecord.status,
    row.creationStatus,
    row.status,
    metadataRecord.completion,
    progressRecord.completion
  ]);
  return {
    sourceWorkId: sourceId,
    canonicalWorkId: sourceId,
    sourceNovelId: row.platformWorkId,
    platform,
    platformWorkId: row.platformWorkId,
    title: firstText(row.title, merged.title, file?.title),
    author: firstText(row.author, merged.author, file?.author),
    category: firstText(genre?.target, row.category),
    rawGenres: arrayFrom(genre?.rawGenres).map(String),
    primaryGenre: firstText(genre?.primaryGenre),
    audience: firstText(genre?.audience),
    rankType: row.rankType,
    rank: row.rank,
    readCount: row.readCount || null,
    rankEvidenceRef: row.rankEvidenceRef || null,
    rankEvidenceSha256: row.rankEvidenceSha256 || null,
    rankEvidenceVerified: row.rankEvidenceVerified === true,
    rankCapturedAt: row.rankCapturedAt || null,
    rankSourceUrl: row.rankSourceUrl || null,
    wordNumber: row.wordNumber ?? numberOrNull(merged.wordNumber),
    completionStatus,
    completionEvidenceRef: completionEvidence.evidenceRef,
    completionEvidenceVerified: completionEvidence.verified,
    completionEvidenceSha256: completionEvidence.evidenceSha256,
    completionObservedAt: firstPresent([
      metadataRecord.completionObservedAt,
      progressRecord.completionObservedAt,
      metadataRecord.completion_observed_at,
      progressRecord.completion_observed_at
    ]),
    contentScope,
    expectedChapterCount,
    fetchedChapterCount,
    chapterCountDeclared,
    chapterCoverage,
    partial,
    incomplete,
    contentHash,
    contentHashVerified: contentHashVerified === true,
    sourceContentHash,
    sourceTextHash,
    fullWorkEvidenceRef: fullWorkEvidence.evidenceRef,
    fullWorkEvidenceVerified: fullWorkEvidence.verified,
    fullWorkEvidenceSha256: fullWorkEvidence.evidenceSha256,
    fileSha256: firstHash([file?.sha256]),
    quality,
    integrity,
    ranking,
    catalogSnapshot: metadataRecord.catalogSnapshot || progressRecord.catalogSnapshot || null,
    catalogEvidenceRef: catalogEvidence.evidenceRef,
    catalogEvidenceVerified: catalogEvidence.verified,
    catalogEvidenceSha256: catalogEvidence.evidenceSha256,
    filePath: firstText(file?.toPath, file?.to, file?.path),
    sourceCategory: row.category,
    sourceInputs: {
      rankManifest: true,
      downloadProgress: Boolean(progress),
      bookMetadata: platform === '起点' ? Boolean(metadata) : null,
      reorganizationReport: Boolean(file)
    },
    authorization,
    fullWorkEvidence
  };
}

function sourcePendingReasons(source) {
  const reasons = [];
  const authorizationVerified = source.authorization?.verified === true || source.authorization?.evidenceVerified === true;
  if (!authorizationVerified || !source.authorization?.evidenceRef || !isSha256(source.authorization?.evidenceSha256)) reasons.push('authorization_evidence_pending');
  if (source.rankEvidenceVerified !== true || !source.rankEvidenceRef || !isSha256(source.rankEvidenceSha256)) reasons.push('rank_evidence_pending');
  if (!source.rankCapturedAt) reasons.push('rank_provenance_pending');
  if (source.completionStatus !== 'completed') reasons.push('completion_status_pending');
  if (source.completionEvidenceVerified !== true || !source.completionEvidenceRef || !isSha256(source.completionEvidenceSha256)) reasons.push('completion_evidence_pending');
  if (source.contentScope !== 'full_work') reasons.push('full_work_scope_pending');
  if (source.fullWorkEvidence?.verified !== true || !source.fullWorkEvidence?.evidenceRef || !isSha256(source.fullWorkEvidence?.evidenceSha256)) reasons.push('full_work_evidence_pending');
  if (!isSha256(source.contentHash) || source.contentHashVerified !== true) reasons.push('content_integrity_pending');
  return reasons;
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/u.test(String(value ?? '').trim().toLowerCase());
}

function sourceQualityGateReasons(source, report, actualContentHash = '') {
  const reasons = sourcePendingReasons(source);
  const sourceQuality = isObject(source.quality) ? source.quality : {};
  const partial = source.partial === true || sourceQuality.partial === true || report?.metrics?.partial === true
    || (Number.isFinite(Number(report?.metrics?.chapterCoverage)) && Number(report.metrics.chapterCoverage) < 1);
  const incomplete = source.incomplete === true || sourceQuality.incomplete === true;
  if (partial) reasons.push('partial_source_not_admissible');
  if (incomplete) reasons.push('incomplete_source_not_admissible');
  if (report?.metrics?.emptyChapterCount > 0) reasons.push('locked_chapters_present');
  if (Array.isArray(report?.metrics?.shortAttackWindows) && report.metrics.shortAttackWindows.length) reasons.push('short_attack_not_admissible');
  if (actualContentHash && isSha256(source.contentHash) && String(source.contentHash).toLowerCase() !== actualContentHash) reasons.push('content_hash_mismatch');
  if (report?.status === 'pending') reasons.push(...arrayFrom(report.pendingReasons).map(reason => `quality_${reason}`));
  if (report?.status === 'rejected') reasons.push(...arrayFrom(report.blockingReasons).map(reason => `quality_${reason}`));
  return [...new Set(reasons)];
}

function sourceProvenance(source) {
  return {
    filePath: source.filePath || null,
    rank: {
      rankType: source.rankType || null,
      rank: source.rank ?? null,
      readCount: source.readCount || null,
      evidenceRef: source.rankEvidenceRef || null,
      evidenceSha256: source.rankEvidenceSha256 || null,
      verified: source.rankEvidenceVerified === true,
      capturedAt: source.rankCapturedAt || null,
      sourceUrl: source.rankSourceUrl || null
    },
    authorization: source.authorization || null,
    completion: {
      status: source.completionStatus || null,
      evidenceRef: source.completionEvidenceRef || null,
      evidenceSha256: source.completionEvidenceSha256 || null,
      verified: source.completionEvidenceVerified === true
    },
    fullWork: source.fullWorkEvidence || {
      evidenceRef: source.fullWorkEvidenceRef || null,
      evidenceSha256: source.fullWorkEvidenceSha256 || null,
      verified: source.fullWorkEvidenceVerified === true
    },
    content: {
      scope: source.contentScope || null,
      expectedChapterCount: source.expectedChapterCount ?? null,
      fetchedChapterCount: source.fetchedChapterCount ?? null,
      chapterCoverage: source.chapterCoverage ?? null,
      contentHash: source.contentHash || null,
      contentHashVerified: source.contentHashVerified === true,
      sourceContentHash: source.sourceContentHash || null,
      sourceTextHash: source.sourceTextHash || null
    }
  };
}

export function linkSourceMetadata(inputs = {}) {
  const required = [
    ['qidianRankManifest', inputs.qidianRankManifest],
    ['shukugeDownloadProgress', inputs.shukugeDownloadProgress],
    ['fanqieRankManifest', inputs.fanqieRankManifest],
    ['fanqieDownloadProgress', inputs.fanqieDownloadProgress],
    ['qidianBookMetadata', inputs.qidianBookMetadata],
    ['reorganizationReport', inputs.reorganizationReport]
  ];
  const missingInputs = required.filter(([, value]) => value === null || value === undefined).map(([name]) => name);
  const inputErrors = required.filter(([, value]) => isObject(value) && value.__parseError).map(([name, value]) => `${name}: ${value.__parseError}`);
  if (isObject(inputs.reorganizationReport) && inputs.reorganizationReport.status === 'blocked') inputErrors.push('reorganizationReport: blocked');
  const reportFiles = reportEntries(inputs.reorganizationReport);
  const qidianProgress = progressById(inputs.shukugeDownloadProgress || {});
  const fanqieProgress = progressById(inputs.fanqieDownloadProgress || {});
  const qidianMetadata = metadataById(inputs.qidianBookMetadata || {});
  const qidianRows = dedupeRankRows(flattenRankManifest(inputs.qidianRankManifest || {}, '起点'));
  const fanqieRows = dedupeRankRows(flattenRankManifest(inputs.fanqieRankManifest || {}, '番茄'));
  const noRankRecords = !qidianRows.length && !fanqieRows.length;
  const linked = [];
  const unlinkedFiles = [];
  for (const row of [...qidianRows, ...fanqieRows]) {
    const progress = progressFor(row.platform === '起点' ? qidianProgress : fanqieProgress, row);
    const metadata = row.platform === '起点' ? qidianMetadata.get(row.platformWorkId) : null;
    const progressTitle = firstText(progress?.title, progress?.bookName);
    const effectiveRow = { ...row, title: firstText(row.title, progressTitle), category: firstText(row.category, progress?.category) };
    const progressFile = firstText(progress?.path, progress?.filePath, progress?.archivePath);
    const file = findReportFile(effectiveRow, reportFiles) || (progressFile ? {
      path: progressFile,
      toPath: progressFile,
      title: effectiveRow.title,
      author: effectiveRow.author,
      action: 'keep'
    } : null);
    if (!file) {
      unlinkedFiles.push({ platform: row.platform, platformWorkId: row.platformWorkId, title: effectiveRow.title, author: effectiveRow.author, reason: 'archive_file_not_linked' });
      continue;
    }
    linked.push(sourceRecord(effectiveRow, file, row.platform, metadata, progress));
  }
  const knownPaths = new Set(linked.map(item => item.filePath));
  for (const file of reportFiles) if (file.action !== 'exclude' && file.action !== 'quarantine' && file.path && !knownPaths.has(file.path)) {
    unlinkedFiles.push({ file: file.path, title: file.title, author: file.author, reason: 'rank_manifest_not_linked' });
  }
  const crossPlatformDuplicates = [];
  const qidianKeys = new Set(linked.filter(row => row.platform === '起点').map(row => `${foldText(row.title)}|${foldText(row.author)}`));
  const filtered = linked.filter(row => {
    const key = `${foldText(row.title)}|${foldText(row.author)}`;
    if (row.platform === '番茄' && qidianKeys.has(key)) {
      crossPlatformDuplicates.push({ sourceWorkId: row.sourceWorkId, duplicateOfPlatform: '起点', title: row.title, author: row.author });
      return false;
    }
    return true;
  });
  const sourceEvidencePendingReasons = [...new Set(filtered.flatMap(sourcePendingReasons))];
  return {
    schemaVersion: 'corpus-source-metadata-1',
    status: inputErrors.length ? 'blocked' : missingInputs.length || unlinkedFiles.length || noRankRecords || sourceEvidencePendingReasons.length ? 'pending' : 'ready',
    inputErrors,
    missingInputs,
    pendingReasons: [
      ...(noRankRecords ? ['rank_manifests_empty'] : []),
      ...sourceEvidencePendingReasons
    ],
    unlinkedFiles,
    crossPlatformDuplicates,
    sources: filtered,
    summary: {
      sourceCount: filtered.length,
      qidianCount: filtered.filter(row => row.platform === '起点').length,
      fanqieCount: filtered.filter(row => row.platform === '番茄').length,
      completedCount: filtered.filter(row => row.completionStatus === 'completed').length,
      pendingCompletionCount: filtered.filter(row => row.completionStatus === 'unknown').length
    }
  };
}

function contentCharacters(text) {
  return Array.from(String(text ?? '')).filter(char => !/\s/u.test(char));
}

function chapterMatches(text) {
  const source = String(text ?? '').replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
  const pattern = /^\s*(第\s*[0-9零一二三四五六七八九十百千万两〇○]+\s*[章节回卷集部篇].*|序章.*|楔子.*|番外.*|尾声.*)\s*$/gmu;
  const matches = [...source.matchAll(pattern)];
  if (!matches.length) return [{ index: 1, title: '全文', text: source, chars: contentCharacters(source).length, parsed: false }];
  return matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : source.length;
    const body = source.slice(start, end);
    return { index: index + 1, title: match[1].trim(), text: body, chars: contentCharacters(body).length, parsed: true };
  });
}

function paragraphsOf(chapters) {
  return chapters.flatMap(chapter => chapter.text.split(/\n+/u).map(text => text.trim()).filter(Boolean));
}

function checkResult(name, observed, threshold, pass, severity, reason, status = 'checked') {
  return { name, observed, threshold, pass, severity, reason, status };
}

export function analyzeSourceQuality({ text, bytes, platform = '', metadata = {}, thresholds = THRESHOLDS } = {}) {
  const sourceText = typeof text === 'string' ? text : '';
  const chars = contentCharacters(sourceText);
  const chapters = chapterMatches(sourceText);
  const nonEmptyLines = sourceText.split(/\r?\n/u).filter(line => line.trim()).length;
  const watermarkLines = sourceText.split(/\r?\n/u).filter(line => WATERMARK_PATTERNS.some(pattern => pattern.test(line))).length;
  const puaCount = chars.filter(char => /[\uE3F8-\uE55B]/u.test(char)).length;
  const invalidCount = chars.filter(char => !/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AFA-Za-z0-9\s，。！？!?；;、：:（）()【】「」『』“”‘’"'《》〈〉…—～~,.!?%+\-_/\\:]/u.test(char)).length;
  const totalChapterChars = chapters.reduce((sum, chapter) => sum + chapter.chars, 0);
  const averageChapterChars = chapters.length ? totalChapterChars / chapters.length : 0;
  const shortFlags = chapters.map(chapter => chapter.chars < thresholds.shortChapterChars && chapter.chars < averageChapterChars * thresholds.shortChapterRatio);
  const attackWindows = [];
  for (let index = 0; index <= shortFlags.length - 3; index += 1) {
    if (shortFlags.slice(index, index + 3).every(Boolean)) attackWindows.push({ startChapter: chapters[index].index, endChapter: chapters[index + 2].index });
  }
  const paragraphs = paragraphsOf(chapters);
  const counts = new Map();
  for (const paragraph of paragraphs) counts.set(foldText(paragraph), (counts.get(foldText(paragraph)) || 0) + 1);
  const duplicateParagraphs = [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  const emptyChapterCount = chapters.filter(chapter => chapter.chars === 0).length;
  const expectedChapterCount = numberOrNull(metadata.expectedChapterCount)
    ?? (numberOrNull(metadata.wordNumber) ? Math.ceil(Number(metadata.wordNumber) / 2800) : null);
  const fetchedChapterCount = numberOrNull(metadata.fetchedChapterCount) ?? chapters.length;
  const coverage = expectedChapterCount && expectedChapterCount > 0 ? fetchedChapterCount / expectedChapterCount : null;
  const pendingReasons = [];
  if (!sourceText) pendingReasons.push('source_text_missing');
  if (!platform) pendingReasons.push('platform_missing');
  if (expectedChapterCount === null) pendingReasons.push('expected_chapter_count_missing');
  if (bytes === null || bytes === undefined) pendingReasons.push('file_size_missing');
  const checks = {
    pua: checkResult('pua', puaCount / Math.max(1, chars.length), thresholds.puaRate, platform !== '番茄' || puaCount / Math.max(1, chars.length) <= thresholds.puaRate, 'hard', platform === '番茄' ? '番茄原文 PUA 占比必须不超过 0.1%。' : '起点规则不适用 PUA 门禁。', platform === '番茄' ? 'checked' : 'not_applicable'),
    mojibake: checkResult('mojibake', invalidCount / Math.max(1, chars.length), thresholds.mojibakeRate, invalidCount / Math.max(1, chars.length) <= thresholds.mojibakeRate, 'hard', '非中文、ASCII 或常用标点字符占比必须不超过 1%。'),
    chapters: checkResult('chapters', chapters.length, thresholds.minimumChapters, chapters.length >= thresholds.minimumChapters, 'hard', '可解析章节数必须至少为 10。'),
    coverage: coverage === null
      ? checkResult('coverage', null, thresholds.minimumCoverage, null, 'hard', '缺少 expectedChapterCount 或可追溯 wordNumber，不能猜测覆盖率。', 'pending')
      : checkResult('coverage', Number(coverage.toFixed(6)), thresholds.minimumCoverage, coverage >= thresholds.minimumCoverage, 'hard', coverage < thresholds.partialCoverage ? '覆盖率达到 60% 但低于 95%，标记为 partial。' : '章节覆盖率达到 95%。'),
    shortAttack: checkResult('shortAttack', { windows: attackWindows, flaggedChapterCount: shortFlags.filter(Boolean).length, rate: shortFlags.filter(Boolean).length / Math.max(1, chapters.length) }, thresholds.shortAttackChapterRate, shortFlags.filter(Boolean).length / Math.max(1, chapters.length) <= thresholds.shortAttackChapterRate, 'hard', '连续三章低于 500 字且低于全书均值 35% 的段落视为短章攻击。'),
    emptyChapters: checkResult('emptyChapters', emptyChapterCount / Math.max(1, chapters.length), thresholds.emptyChapterRate, emptyChapterCount / Math.max(1, chapters.length) <= thresholds.emptyChapterRate, 'hard', '空章节率超过 40% 时拒绝原文。'),
    duplicateText: checkResult('duplicateText', duplicateParagraphs / Math.max(1, paragraphs.length), thresholds.duplicateParagraphRate, duplicateParagraphs / Math.max(1, paragraphs.length) <= thresholds.duplicateParagraphRate, 'hard', '段落去重后的重复率超过 50% 时拒绝原文。'),
    fileSize: checkResult('fileSize', numberOrNull(bytes), thresholds.minimumFileBytes, numberOrNull(bytes) === null ? null : Number(bytes) >= thresholds.minimumFileBytes, 'hard', '文件大小必须至少为 100KB。', numberOrNull(bytes) === null ? 'pending' : 'checked'),
    watermark: checkResult('watermark', watermarkLines / Math.max(1, nonEmptyLines), thresholds.watermarkLineRate, watermarkLines / Math.max(1, nonEmptyLines) <= thresholds.watermarkLineRate, 'hard', '盗版站水印行占比超过 0.5% 时拒绝原文。')
  };
  const blockingReasons = sourceText
    ? Object.values(checks).filter(check => check.pass === false && check.status !== 'not_applicable').map(check => check.name)
    : [];
  const warnings = [];
  if (coverage !== null && coverage < thresholds.partialCoverage && coverage >= thresholds.minimumCoverage) warnings.push('partial_coverage');
  if (emptyChapterCount > 0 && checks.emptyChapters.pass) warnings.push('paid_locked_chapters_present');
  if (attackWindows.length && checks.shortAttack.pass) warnings.push('short_attack_segment_requires_exclusion');
  const missingMetadata = !firstText(metadata.sourceWorkId, metadata.canonicalWorkId, metadata.platformWorkId);
  if (missingMetadata) pendingReasons.push('source_metadata_identity_missing');
  const status = blockingReasons.length ? 'rejected' : pendingReasons.length ? 'pending' : warnings.length ? 'admitted_with_flags' : 'admitted';
  return {
    schemaVersion: 'source-quality-report-1',
    status,
    decision: status === 'admitted' || status === 'admitted_with_flags' ? 'admit' : status,
    eligibleForAdvancedAnalysis: status === 'admitted' || status === 'admitted_with_flags',
    pendingReasons,
    blockingReasons,
    warnings,
    checks,
    metrics: {
      characterCount: chars.length,
      totalChapterChars,
      chapterCount: chapters.length,
      parsedChapterCount: chapters.filter(chapter => chapter.parsed).length,
      averageChapterChars: Number(averageChapterChars.toFixed(2)),
      emptyChapterCount,
      shortAttackWindows: attackWindows,
      duplicateParagraphCount: duplicateParagraphs,
      paragraphCount: paragraphs.length,
      watermarkLineCount: watermarkLines,
      puaCount,
      invalidCharacterCount: invalidCount,
      expectedChapterCount,
      fetchedChapterCount,
      chapterCoverage: coverage === null ? null : Number(coverage.toFixed(6)),
      partial: coverage !== null && coverage >= thresholds.minimumCoverage && coverage < thresholds.partialCoverage,
      paidLockedChapterIndexes: chapters.filter(chapter => chapter.chars === 0).map(chapter => chapter.index),
      fileBytes: numberOrNull(bytes)
    },
    evidence: {
      authorization: { status: firstText(metadata.authorization?.status, 'unknown'), verified: metadata.authorization?.verified === true, evidenceRef: metadata.authorization?.evidenceRef ?? null },
      fullWork: { status: firstText(metadata.fullWorkEvidence?.status, 'unknown'), verified: metadata.fullWorkEvidence?.verified === true, evidenceRef: metadata.fullWorkEvidence?.evidenceRef ?? null }
    }
  };
}

export function buildQualityOutputs(sources, options = {}) {
  const previous = isObject(options.previousSourceManifest) ? new Map(arrayFrom(options.previousSourceManifest.sources).map(source => [source.id, source])) : new Map();
  const qualityReports = [];
  const sourceManifest = [];
  const quarantined = [];
  let resumedCount = 0;
  for (const source of arrayFrom(sources)) {
    const filePath = options.resolveFile ? options.resolveFile(source.filePath, source) : source.filePath;
    const exists = Boolean(filePath && fs.existsSync(filePath));
    const content = exists ? fs.readFileSync(filePath, 'utf8') : '';
    const bytes = exists ? fs.statSync(filePath).size : null;
    const fingerprint = exists ? sha256(`${bytes}:${content}`) : '';
    const id = source.sourceWorkId || `file-${sha256(source.filePath || source.title || '').slice(0, 16)}`;
    const old = previous.get(id);
    const report = old?.fingerprint === fingerprint && old.quality ? old.quality : analyzeSourceQuality({ text: content, bytes, platform: source.platform, metadata: source });
    if (old?.fingerprint === fingerprint && old.quality) resumedCount += 1;
    const actualContentHash = exists ? sha256(content) : '';
    const sourceGateReasons = sourceQualityGateReasons(source, report, actualContentHash);
    const reportRejected = report.status === 'rejected';
    const admission = reportRejected ? 'rejected' : sourceGateReasons.length ? 'pending' : report.status;
    const eligibleForAdvancedAnalysis = admission === 'admitted';
    const sourceGate = {
      status: reportRejected ? 'rejected' : (sourceGateReasons.length ? 'pending' : 'pass'),
      reasons: sourceGateReasons,
      eligibleForAdvancedAnalysis
    };
    const record = {
      ...source,
      id,
      fingerprint,
      exists,
      admission,
      eligibleForAdvancedAnalysis,
      qualityReportId: id,
      sourceGate,
      quality: report
    };
    sourceManifest.push(record);
    qualityReports.push({
      id,
      sourceWorkId: source.sourceWorkId || null,
      filePath: source.filePath || null,
      fingerprint,
      sourceGate,
      provenance: sourceProvenance(record),
      ...report
    });
    if (admission === 'rejected') quarantined.push({ id, sourceWorkId: source.sourceWorkId || null, filePath: source.filePath || null, reasons: report.blockingReasons, recoverable: true });
  }
  return {
    sourceManifest: { schemaVersion: 'source-manifest-1', status: sourceManifest.some(source => source.admission === 'pending') ? 'pending' : 'ready', sources: sourceManifest, summary: { sourceCount: sourceManifest.length, admittedCount: sourceManifest.filter(source => source.eligibleForAdvancedAnalysis).length, rejectedCount: quarantined.length, pendingCount: sourceManifest.filter(source => source.admission === 'pending').length, resumedCount } },
    sourceQualityReport: { schemaVersion: 'source-quality-report-bundle-1', status: qualityReports.some(report => report.sourceGate.status !== 'pass' || report.status === 'pending') ? 'pending' : 'ready', reports: qualityReports },
    quarantineReport: { schemaVersion: 'quarantine-report-1', status: quarantined.length ? 'has_quarantine' : 'clear', entries: quarantined, summary: { count: quarantined.length } }
  };
}

function readJsonInput(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (error) { return { __parseError: error.message }; }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function isWithinRoot(candidate, root, strict = false) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (!relative) return !strict;
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

function hasParentTraversal(value) {
  return String(value ?? '').split(/[\\/]+/u).some(segment => segment === '..');
}

function resolveContainedPath(root, value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { path: '', reason: 'path_missing' };
  if (raw.includes('\0')) return { path: '', reason: 'path_invalid' };
  if (hasParentTraversal(raw)) return { path: '', reason: 'path_traversal' };
  const resolved = path.resolve(root, raw);
  if (!isWithinRoot(resolved, root, true)) return { path: resolved, reason: 'path_outside_allowed_root' };
  return { path: resolved, reason: '' };
}

export function applyReorganization(report, archiveRoot, resourceRoot = path.dirname(archiveRoot)) {
  const archiveBase = path.resolve(archiveRoot);
  const resourceBase = path.resolve(resourceRoot);
  const operations = [];
  for (const file of report.files || []) {
    if (!['move', 'quarantine'].includes(file.action)) continue;
    const quarantine = file.action === 'quarantine';
    const fromPath = firstText(file.fromPath, file.from);
    const toPath = firstText(file.toPath, file.to);
    const sourceResult = resolveContainedPath(archiveBase, fromPath);
    if (sourceResult.reason) {
      operations.push({ ...file, applied: false, reason: `source_${sourceResult.reason}` });
      continue;
    }
    const targetRoot = quarantine ? resourceBase : archiveBase;
    if (quarantine && !toPath.replace(/\\/gu, '/').startsWith('_quarantine/')) {
      operations.push({ ...file, applied: false, reason: 'quarantine_target_invalid' });
      continue;
    }
    const targetResult = resolveContainedPath(targetRoot, toPath);
    if (targetResult.reason) {
      operations.push({ ...file, applied: false, reason: `target_${targetResult.reason}` });
      continue;
    }
    const source = sourceResult.path;
    const target = targetResult.path;
    if (!isWithinRoot(archiveBase, resourceBase) && !isWithinRoot(resourceBase, archiveBase)) {
      operations.push({ ...file, applied: false, reason: 'archive_resource_roots_disjoint' });
      continue;
    }
    if (!fs.existsSync(source)) { operations.push({ ...file, applied: false, reason: 'source_missing' }); continue; }
    if (!fs.statSync(source).isFile()) { operations.push({ ...file, applied: false, reason: 'source_not_file' }); continue; }
    if (fs.existsSync(target)) { operations.push({ ...file, applied: false, reason: 'target_exists' }); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(source, target);
    operations.push({ ...file, applied: true });
  }
  return operations;
}

export function parseArgs(argv = []) {
  const options = { stage: 'all', archiveRoot: DEFAULT_ARCHIVE_ROOT, outputRoot: DEFAULT_OUTPUT_ROOT, apply: false, resume: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] || '';
    if (arg === '--stage') options.stage = next();
    else if (arg === '--archive-root') options.archiveRoot = path.resolve(next());
    else if (arg === '--output-root') options.outputRoot = path.resolve(next());
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--no-resume') options.resume = false;
    else if (arg === '--help' || arg === '-h') options.help = true;
  }
  return options;
}

function inputPaths(root) {
  return {
    qidianRankManifest: path.join(root, 'qidian-rank-manifest.json'),
    shukugeDownloadProgress: path.join(root, 'shukuge-download-progress.json'),
    fanqieRankManifest: path.join(root, 'fanqie-rank-manifest.json'),
    fanqieDownloadProgress: path.join(root, 'scripts', 'fanqie-download-progress.json'),
    qidianBookMetadata: path.join(root, 'qidian-book-metadata.json'),
    reorganizationReport: path.join(root, 'corpus-reorganize-report.json')
  };
}

export function runCorpusStages(options = {}) {
  const archiveRoot = path.resolve(options.archiveRoot || DEFAULT_ARCHIVE_ROOT);
  const outputRoot = path.resolve(options.outputRoot || DEFAULT_OUTPUT_ROOT);
  const resourceRoot = path.dirname(archiveRoot);
  const stage = String(options.stage || 'all');
  const outputs = {};
  if (['1', 'all'].includes(stage)) {
    const report = buildReorganizeReport({ archiveRoot, resourceRoot });
    if (options.apply && report.status !== 'blocked') report.applyOperations = applyReorganization(report, archiveRoot);
    outputs.reorganizationReport = report;
    if (options.write !== false) writeJsonAtomic(path.join(outputRoot, 'corpus-reorganize-report.json'), report);
  }
  const paths = { ...inputPaths(resourceRoot), ...(options.inputPaths || {}) };
  if (['2', 'all'].includes(stage)) {
    const values = Object.fromEntries(Object.entries(paths).map(([name, filePath]) => [name, name === 'reorganizationReport' && outputs.reorganizationReport ? outputs.reorganizationReport : readJsonInput(filePath)]));
    const link = linkSourceMetadata(values);
    outputs.sourceMetadata = link;
    if (options.write !== false) writeJsonAtomic(path.join(outputRoot, 'corpus-source-metadata.json'), link);
  }
  if (['3', 'all'].includes(stage)) {
    const sourceMetadata = outputs.sourceMetadata || readJsonInput(options.sourceMetadataPath || path.join(outputRoot, 'corpus-source-metadata.json'));
    const sources = arrayFrom(sourceMetadata?.sources);
    const previous = options.resume === false ? null : readJsonInput(path.join(outputRoot, 'source-manifest.json'));
    const quality = buildQualityOutputs(sources, { previousSourceManifest: previous, resolveFile: (relativePath) => path.resolve(resourceRoot, String(relativePath || '')) });
    const sourceMetadataStatus = sourceMetadata?.__parseError ? 'blocked' : sourceMetadata?.status || 'pending';
    if (sourceMetadataStatus === 'pending' || sourceMetadataStatus === 'blocked') {
      quality.sourceManifest.status = sourceMetadataStatus;
      quality.sourceManifest.pendingReasons = sourceMetadata?.missingInputs || ['source_metadata_pending'];
      quality.sourceManifest.inputErrors = sourceMetadata?.inputErrors || [];
      quality.sourceQualityReport.status = sourceMetadataStatus;
    }
    outputs.quality = quality;
    if (options.write !== false) {
      writeJsonAtomic(path.join(outputRoot, 'source-manifest.json'), quality.sourceManifest);
      writeJsonAtomic(path.join(outputRoot, 'source-quality-report.json'), quality.sourceQualityReport);
      writeJsonAtomic(path.join(outputRoot, 'quarantine-report.json'), quality.quarantineReport);
    }
  }
  return outputs;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('用法：node scripts/corpus-stage.mjs [--stage 1|2|3|all] [--archive-root path] [--output-root path] [--apply]');
    return 0;
  }
  const result = runCorpusStages(options);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(result).map(([key, value]) => [key, value.status || value.sourceManifest?.status || 'ready'])), null, 2));
  return Object.values(result).some(value => value.status === 'blocked') ? 2 : 0;
}

if (path.resolve(process.argv[1] || '') === SCRIPT_PATH) process.exitCode = main();

export { DEFAULT_ARCHIVE_ROOT, DEFAULT_OUTPUT_ROOT, FANQIE_CATEGORY_LOOKUP, CATEGORY_TO_GENRE };
