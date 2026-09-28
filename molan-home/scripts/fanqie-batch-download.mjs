import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  archiveGroupForGenre,
  canonicalizeRawGenre,
  canonicalizeRawGenres,
  canonicalizeSourceUrl,
  evaluateArchiveRecord,
  evaluateAuthorization,
  normalizeAudience,
  normalizeAuthorization,
  normalizeCompletionStatus,
  normalizeContentScope,
  normalizePlatform,
  normalizeRanking,
  platformWorkIdFromUrl,
  validatePlatformMetadata,
  verifyLocalEvidenceReference
} from '../../资源库/scripts/corpus-utils.mjs';
import {
  buildArchiveRelativePath,
  writeFetchMetadata
} from '../../资源库/scripts/fetch-novel.mjs';
import { readFetchMetadata } from '../../资源库/scripts/build-manifest.mjs';

const RESOURCE_ROOT = path.resolve(import.meta.dirname, '..', '..', '资源库');
const ARCHIVE_ROOT = path.join(RESOURCE_ROOT, '小说原本');
const DRIVER_PATH = path.resolve(import.meta.dirname, 'fanqie-project-driver.py');
const DEFAULT_INPUT = path.join(RESOURCE_ROOT, '番茄授权作品清单.json');
const DEFAULT_REPORT = path.join(RESOURCE_ROOT, 'fanqie-batch-report.json');
const DEFAULT_PROJECT_ROOT = path.join(RESOURCE_ROOT, 'third-party', 'fanqienovel-downloader');
const EXPECTED_PROJECT_COMMIT = '4cbb46e9038f2d714407745898380cf02c629deb';
const PROJECT_REPOSITORY = 'https://github.com/ying-ck/fanqienovel-downloader';
const MIN_DELAY_MS = 2000;

/** 读取批量下载命令行参数，并默认开启 18 类硬配额门禁。
 * 参数：argv 为 process.argv.slice(2)。
 * 返回值：规范化后的批处理选项对象。
 */
function readOptions(argv) {
  const options = {
    input: DEFAULT_INPUT,
    report: DEFAULT_REPORT,
    projectRoot: DEFAULT_PROJECT_ROOT,
    python: process.env.FANQIE_PYTHON || 'python',
    delayMs: MIN_DELAY_MS,
    maxWorks: 0,
    validateOnly: false,
    requireQuota: true,
    allowOverwrite: false,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') options.input = path.resolve(argv[++index]);
    else if (arg === '--report') options.report = path.resolve(argv[++index]);
    else if (arg === '--project-root') options.projectRoot = path.resolve(argv[++index]);
    else if (arg === '--python') options.python = String(argv[++index] || '').trim() || 'python';
    else if (arg === '--delay') {
      const seconds = Number(argv[++index]);
      if (!Number.isFinite(seconds) || seconds < 2) throw new Error('--delay 必须是至少 2 秒的数字');
      options.delayMs = Math.round(seconds * 1000);
    } else if (arg === '--max-works') {
      const count = Number(argv[++index]);
      if (!Number.isInteger(count) || count < 0) throw new Error('--max-works 必须是非负整数');
      options.maxWorks = count;
    } else if (arg === '--validate-only') options.validateOnly = true;
    else if (arg === '--allow-incomplete') options.requireQuota = false;
    else if (arg === '--allow-overwrite') options.allowOverwrite = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

/** 输出输入清单的最小字段约定，避免把空数组或口头授权当成可下载任务。
 * 参数：无。
 * 返回值：命令行帮助文本。
 */
function usageText() {
  return [
    '用法：node molan-home/scripts/fanqie-batch-download.mjs [选项]',
    '',
    '默认读取：资源库/番茄授权作品清单.json',
    '清单格式：{ "schemaVersion": "fanqie-authorized-work-list-1", "works": [...] }',
    '每项至少包含：workId、title、author、genres、primaryGenre、authorization、completionEvidenceRef、fullWorkEvidenceRef、ranking。',
    '授权证据（authorization）必须包含 status、scope、evidenceRef、evidenceSha256、rightsHolder、license，及三项允许用途布尔值。',
    'ranking 必须包含 ranks、type、metric、capturedAt、evidenceRef、evidenceSha256。证据路径均相对于资源库目录。',
    '',
    '选项：--input <json> --project-root <仓库目录> --python <python> --delay <秒>',
    '      --validate-only --allow-incomplete --allow-overwrite --max-works <数量>'
  ].join('\n');
}

/** 读取 JSON 作品清单并确认顶层包含 works 数组。
 * 参数：inputPath 为清单文件路径。
 * 返回值：作品原始对象数组。
 */
function readWorkList(inputPath) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取作品清单：${inputPath}；${error.message}`);
  }
  const works = Array.isArray(value) ? value : value?.works;
  if (!Array.isArray(works)) throw new Error(`作品清单缺少 works 数组：${inputPath}`);
  return works;
}

/** 计算本地证据文件的完整哈希，并拒绝 URL、越界路径和短哈希。
 * 参数：reference 为资源库内相对路径；expectedHash 为声明的 SHA-256；label 为证据名称。
 * 返回值：证据校验结果和可读失败信息。
 */
function verifyEvidence(reference, expectedHash, label) {
  const ref = String(reference || '').trim();
  const hash = String(expectedHash || '').trim().toLowerCase();
  if (!ref) return { verified: false, sha256: '', reason: `${label}缺失` };
  if (!/^[a-f0-9]{64}$/u.test(hash)) return { verified: false, sha256: '', reason: `${label}必须使用完整 SHA-256` };
  const result = verifyLocalEvidenceReference(ref, hash, RESOURCE_ROOT);
  return { ...result, reason: result.verified ? '' : `${label}${result.reason}` };
}

/** 规范化并校验单项作品的身份、题材、完结、授权和榜单证据。
 * 参数：item 为清单中的作品对象；index 为清单下标；config 为资源库配额配置。
 * 返回值：{ work, issues }，issues 非空时 work 为 null。
 */
function normalizeWork(item, index, config) {
  const source = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
  const issues = [];
  const workId = String(source.workId || source.platformWorkId || source.novelId || '').trim();
  const title = String(source.title || source.work_title || source.bookName || '').replace(/^《|》$/gu, '').trim();
  const author = String(source.author || '').trim();
  if (!/^\d+$/u.test(workId)) issues.push('workId 必须是数字');
  if (!title) issues.push('title 缺失');
  if (!author) issues.push('author 缺失');

  const sourceUrl = canonicalizeSourceUrl(source.sourceUrl || source.url || (workId ? `https://fanqienovel.com/page/${workId}` : ''));
  let host = '';
  try {
    host = new URL(sourceUrl).hostname.toLowerCase();
  } catch (_) {
    issues.push('sourceUrl 不是有效 URL');
  }
  if (host && !/(?:^|\.)fanqienovel\.com$/u.test(host)) issues.push('sourceUrl 必须是番茄公开目录页');
  const platform = normalizePlatform(source.platform || '番茄');
  if (platform !== '番茄') issues.push('platform 必须是番茄');
  const urlWorkId = platformWorkIdFromUrl(sourceUrl, '番茄');
  if (urlWorkId && workId && urlWorkId !== workId) issues.push('sourceUrl 与 workId 不一致');

  const genres = canonicalizeRawGenres(source.genres || source.genre || [], config);
  const primaryGenre = canonicalizeRawGenre(source.primaryGenre || (genres.length === 1 ? genres[0] : ''), config);
  if (!genres.length) issues.push('genres 缺失');
  if (genres.some(genre => !config.rawGenres.includes(genre))) issues.push('genres 含不在 18 类清单内的题材');
  if (genres.length > 1 && !primaryGenre) issues.push('多题材作品必须指定 primaryGenre');
  if (primaryGenre && !genres.includes(primaryGenre)) issues.push('primaryGenre 必须包含在 genres 中');
  if (primaryGenre && !config.rawGenres.includes(primaryGenre)) issues.push('primaryGenre 不在 18 类清单内');
  const bucket = archiveGroupForGenre(primaryGenre || genres[0], config);
  if (!bucket) issues.push('无法根据 primaryGenre 生成原书归档组');

  const authorizationInput = normalizeAuthorization(source);
  const authorizationEvidence = verifyEvidence(
    authorizationInput.evidenceRef,
    authorizationInput.evidenceSha256,
    '授权证据'
  );
  const authorization = {
    ...authorizationInput,
    evidenceVerified: authorizationEvidence.verified,
    evidenceSha256: authorizationEvidence.sha256 || authorizationInput.evidenceSha256
  };
  const authorizationCheck = evaluateAuthorization(authorization, config.authorizationPolicy || {});
  if (!authorizationCheck.usable) issues.push(`授权门禁：${authorizationCheck.reason}`);

  const completionStatus = normalizeCompletionStatus(source.completionStatus || source.status || '');
  if (completionStatus !== 'completed') issues.push('completionStatus 必须明确为已完结');
  const completionEvidenceRef = String(source.completionEvidenceRef || source.completion_evidence_ref || '').trim();
  const completionEvidenceSha256 = String(source.completionEvidenceSha256 || source.completion_evidence_sha256 || '').trim().toLowerCase();
  const completionEvidence = verifyEvidence(completionEvidenceRef, completionEvidenceSha256, '完结证据');
  if (config.requireCompletionEvidenceVerification === true && !completionEvidence.verified) issues.push(completionEvidence.reason);

  const fullWorkEvidenceRef = String(source.fullWorkEvidenceRef || source.full_work_evidence_ref || '').trim();
  const fullWorkEvidenceSha256 = String(source.fullWorkEvidenceSha256 || source.full_work_evidence_sha256 || '').trim().toLowerCase();
  const fullWorkEvidence = verifyEvidence(fullWorkEvidenceRef, fullWorkEvidenceSha256, '全文证据');
  if (config.requireFullWorkEvidence === true && !fullWorkEvidence.verified) issues.push(fullWorkEvidence.reason);

  const catalogEvidenceRef = String(source.catalogEvidenceRef || source.catalog_evidence_ref || '').trim();
  const catalogEvidenceSha256 = String(source.catalogEvidenceSha256 || source.catalog_evidence_sha256 || '').trim().toLowerCase();
  const catalogEvidence = catalogEvidenceRef
    ? verifyEvidence(catalogEvidenceRef, catalogEvidenceSha256, '目录证据')
    : { verified: true, sha256: '', reason: '' };
  if (catalogEvidenceRef && !catalogEvidence.verified) issues.push(catalogEvidence.reason);

  const ranking = normalizeRanking(source);
  const rankValues = Object.values(ranking.ranks || {}).filter(value => Number.isFinite(Number(value)) && Number(value) > 0);
  if (!rankValues.length) issues.push('ranking 缺少正整数排名');
  if (!ranking.type) issues.push('ranking.type 缺失');
  if (!ranking.metric) issues.push('ranking.metric 缺失');
  if (!ranking.capturedAt || !Number.isFinite(Date.parse(ranking.capturedAt))) issues.push('ranking.capturedAt 无效');
  const rankingEvidence = verifyEvidence(ranking.evidenceRef, ranking.evidenceSha256, '榜单证据');
  if (config.requireRankingEvidence !== false && !rankingEvidence.verified) issues.push(rankingEvidence.reason);
  const contentScope = normalizeContentScope(source.contentScope || 'full_work');
  if (contentScope !== 'full_work') issues.push('contentScope 必须是 full_work');

  return {
    work: issues.length ? null : {
      index,
      workId,
      title,
      author,
      sourceUrl,
      platform,
      platformWorkId: workId,
      sourceWorkId: String(source.sourceWorkId || `novel-${workId}`).trim(),
      canonicalWorkId: String(source.canonicalWorkId || source.sourceWorkId || `novel-${workId}`).trim(),
      canonicalWorkIdExplicit: Boolean(String(source.canonicalWorkId || '').trim()),
      rawGenres: genres,
      primaryGenre,
      audience: normalizeAudience(source.audience || source.targetAudience || ''),
      bucket,
      authorization,
      completionStatus,
      completionEvidenceRef,
      completionEvidenceSha256: completionEvidence.sha256 || completionEvidenceSha256,
      fullWorkEvidenceRef,
      fullWorkEvidenceSha256: fullWorkEvidence.sha256 || fullWorkEvidenceSha256,
      catalogEvidenceRef,
      catalogEvidenceSha256: catalogEvidence.sha256 || catalogEvidenceSha256,
      ranking
    },
    issues
  };
}

/** 校验作品清单的唯一身份并计算 18 类原题材配额缺口。
 * 参数：items 为原始作品对象数组；config 为资源库配额配置。
 * 返回值：规范化作品、逐行错误和配额统计。
 */
function validateWorkList(items, config) {
  const works = [];
  const errors = [];
  const seenWorkIds = new Set();
  const seenLogicalIds = new Set();
  for (const [index, item] of items.entries()) {
    const normalized = normalizeWork(item, index, config);
    if (normalized.issues.length) {
      errors.push({ index, title: String(item?.title || item?.work_title || ''), issues: normalized.issues });
      continue;
    }
    if (seenWorkIds.has(normalized.work.workId)) {
      errors.push({ index, title: normalized.work.title, issues: ['workId 重复'] });
      continue;
    }
    if (seenLogicalIds.has(normalized.work.canonicalWorkId)) {
      errors.push({ index, title: normalized.work.title, issues: ['canonicalWorkId 重复'] });
      continue;
    }
    seenWorkIds.add(normalized.work.workId);
    seenLogicalIds.add(normalized.work.canonicalWorkId);
    works.push(normalized.work);
  }
  const targetPerGenre = Number(config.rawGenreTargetBooks || 20);
  const byGenre = Object.fromEntries(config.rawGenres.map(genre => [genre, 0]));
  for (const work of works) byGenre[work.primaryGenre] += 1;
  const missingByGenre = Object.fromEntries(config.rawGenres
    .filter(genre => byGenre[genre] < targetPerGenre)
    .map(genre => [genre, targetPerGenre - byGenre[genre]]));
  const quota = {
    targetPerGenre,
    targetUniqueWorks: Number(config.uniqueUsableBookTarget || config.rawGenres.length * targetPerGenre),
    validUniqueWorks: works.length,
    byGenre,
    missingByGenre,
    complete: Object.keys(missingByGenre).length === 0 && works.length >= Number(config.uniqueUsableBookTarget || 360)
  };
  return { works, errors, quota };
}

/** 校验下载器仓库存在且固定在指定提交，避免执行未审阅版本。
 * 参数：projectRoot 为下载器仓库根目录。
 * 返回值：通过校验的完整提交哈希。
 */
function verifyProject(projectRoot) {
  if (!fs.existsSync(path.join(projectRoot, 'src', 'main.py'))) throw new Error(`找不到下载器入口：${projectRoot}`);
  let commit;
  try {
    commit = execFileSync('git', ['-C', projectRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().toLowerCase();
  } catch (error) {
    throw new Error(`无法读取下载器提交：${error.message}`);
  }
  if (commit !== EXPECTED_PROJECT_COMMIT) throw new Error(`下载器提交不匹配：实际 ${commit || '空值'}，要求 ${EXPECTED_PROJECT_COMMIT}`);
  return commit;
}

/** 顺序启动 Python 驱动器，并把上游项目的进度和错误转发到当前终端。
 * 参数：options 为批处理选项；work 为规范化作品；archivePath、resultPath 为输出路径。
 * 返回值：解析后的单本抓取结果 JSON。
 */
function runProjectDriver(options, work, archivePath, resultPath) {
  return new Promise((resolve, reject) => {
    const args = [
      DRIVER_PATH,
      '--project-root', options.projectRoot,
      '--work-id', work.workId,
      '--source-url', work.sourceUrl,
      '--title', work.title,
      '--author', work.author,
      '--output', archivePath,
      '--result', resultPath,
      '--delay-ms', String(options.delayMs)
    ];
    if (options.allowOverwrite) args.push('--allow-overwrite');
    const child = spawn(options.python, args, {
      cwd: options.projectRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    child.stdout.on('data', chunk => process.stdout.write(chunk));
    child.stderr.on('data', chunk => {
      const text = String(chunk);
      stderr = `${stderr}${text}`.slice(-4000);
      process.stderr.write(chunk);
    });
    child.on('error', error => reject(error));
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`下载器退出码 ${code}：${stderr.trim() || '未提供错误信息'}`));
        return;
      }
      try {
        resolve(JSON.parse(fs.readFileSync(resultPath, 'utf8')));
      } catch (error) {
        reject(new Error(`下载器完成但结果 JSON 不可读取：${error.message}`));
      }
    });
  });
}

/** 组装与现有 manifest 兼容的番茄抓取 sidecar记录。
 * 参数：work 为规范化清单作品；result 为 Python 驱动器结果；archiveRelativePath 为归档相对路径；config 为配额配置。
 * 返回值：待写入抓取 sidecar 的记录对象。
 */
function buildFetchRecord(work, result, archiveRelativePath, config) {
  const completionStatus = normalizeCompletionStatus(result.status);
  if (completionStatus !== 'completed') throw new Error(`上游目录状态不是已完结：${result.status || '未知'}`);
  const catalogSnapshot = result.catalogSnapshot && typeof result.catalogSnapshot === 'object'
    ? result.catalogSnapshot
    : null;
  if (!catalogSnapshot || !Array.isArray(catalogSnapshot.chapterIds) || !catalogSnapshot.chapterIds.length) {
    throw new Error('下载器结果缺少有效目录快照');
  }
  const platformMetadata = validatePlatformMetadata({
    sourceUrl: work.sourceUrl,
    platform: '番茄',
    platformWorkId: work.platformWorkId,
    ranking: work.ranking,
    catalogSnapshot
  }, {
    evidenceRoot: RESOURCE_ROOT,
    requireRanking: true,
    requireRankingEvidence: config.requireRankingEvidence !== false
  });
  const record = {
    schemaVersion: 'fetch-result-fanqie-project-1',
    title: result.title,
    author: work.author,
    bucket: work.bucket,
    archiveGroup: work.bucket,
    genreBucket: config.sourceBucketMap?.[work.primaryGenre] || null,
    sourceUrl: work.sourceUrl,
    platform: '番茄',
    platformWorkId: work.platformWorkId,
    sourceWorkId: work.sourceWorkId,
    canonicalWorkId: work.canonicalWorkId,
    canonicalWorkIdExplicit: work.canonicalWorkIdExplicit,
    sourceNovelId: work.workId,
    sourceKind: 'platform',
    rawGenres: work.rawGenres,
    primaryGenre: work.primaryGenre,
    audience: work.audience,
    completionStatus,
    completionEvidenceRef: work.completionEvidenceRef,
    completionEvidenceVerified: true,
    completionEvidenceSha256: work.completionEvidenceSha256,
    completionObservedAt: result.fetchedAt,
    contentScope: 'full_work',
    fullWorkEvidenceRef: work.fullWorkEvidenceRef,
    fullWorkEvidenceVerified: true,
    fullWorkEvidenceSha256: work.fullWorkEvidenceSha256,
    catalogEvidenceRef: work.catalogEvidenceRef,
    catalogEvidenceSha256: work.catalogEvidenceSha256 || catalogSnapshot.snapshotSha256,
    catalogSnapshot,
    ranking: platformMetadata.ranking,
    parser: {
      adapterId: `fanqienovel-downloader@${EXPECTED_PROJECT_COMMIT}`,
      catalogStrategy: 'src/main.py:down_zj',
      bodyStrategy: 'src/main.py:down_text',
      fallbackUsed: false,
      repository: PROJECT_REPOSITORY,
      commitSha: EXPECTED_PROJECT_COMMIT
    },
    chapterCountDeclared: true,
    expectedChapterCount: Number(result.chapterCount),
    fetchedChapterCount: Number(result.fetchedChapterCount),
    chapterCoverage: 1,
    authorization: work.authorization,
    partial: false,
    fetchedAt: result.fetchedAt,
    filePath: archiveRelativePath,
    totalChars: Number(result.totalChars),
    chapterCount: Number(result.chapterCount),
    chapters: result.chapters,
    contentHash: String(result.contentHash || '').toLowerCase(),
    quality: {
      partial: false,
      incomplete: false,
      contentHashVerified: true,
      platformMetadataVerified: platformMetadata.verified,
      platformMetadataReasons: platformMetadata.reasons,
      reasons: platformMetadata.verified ? [] : ['platformMetadataUnverified']
    },
    platformMetadataVerified: platformMetadata.verified,
    platformMetadataReasons: platformMetadata.reasons,
    archiveAction: result.archiveAction,
    allowOverwrite: false,
    contributedCells: []
  };
  const archiveCheck = evaluateArchiveRecord(record, {
    ...config,
    resourceRoot: RESOURCE_ROOT,
    archiveRoot: ARCHIVE_ROOT,
    revalidateArchiveEvidence: true
  });
  record.quality.archivePreflight = {
    usable: archiveCheck.usable,
    reasons: archiveCheck.reasons
  };
  record.quality.reasons = archiveCheck.reasons;
  record.excludeFromCorpus = !archiveCheck.usable;
  return record;
}

/** 把单本成功结果写入现有抓取 sidecar，并返回可审计的处理摘要。
 * 参数：work 为规范化作品；result 为驱动器结果；archiveRelativePath 为归档相对路径；config 为配额配置；allowOverwrite 为覆盖开关。
 * 返回值：批处理报告中的单本结果对象。
 */
function persistFetchResult(work, result, archiveRelativePath, config, allowOverwrite) {
  const record = buildFetchRecord(work, result, archiveRelativePath, config);
  record.allowOverwrite = allowOverwrite;
  const metadataPath = writeFetchMetadata(record);
  record.metadataPath = path.relative(RESOURCE_ROOT, metadataPath).replace(/\\/g, '/');
  return {
    index: work.index,
    workId: work.workId,
    title: work.title,
    primaryGenre: work.primaryGenre,
    archivePath: archiveRelativePath,
    metadataPath: record.metadataPath,
    status: record.excludeFromCorpus ? 'downloaded-excluded' : 'downloaded-usable',
    qualityReasons: record.quality.reasons,
    chapterCount: record.chapterCount,
    totalChars: record.totalChars,
    contentHash: record.contentHash
  };
}

/** 写入不含正文的批量审计报告。
 * 参数：reportPath 为报告路径；report 为报告对象。
 * 返回值：无。
 */
function writeReport(reportPath, report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

/** 执行清单校验、固定版本下载、原书归档和批量报告生成。
 * 参数：argv 为命令行参数数组。
 * 返回值：成功返回 0；清单或下载失败返回 1。
 */
async function run(argv) {
  const options = readOptions(argv);
  if (options.help) {
    console.log(usageText());
    return 0;
  }
  const config = JSON.parse(fs.readFileSync(path.join(RESOURCE_ROOT, 'quota-config.json'), 'utf8'));
  const inputItems = readWorkList(options.input);
  const selectedItems = options.maxWorks > 0 ? inputItems.slice(0, options.maxWorks) : inputItems;
  const validation = validateWorkList(selectedItems, config);
  const report = {
    schemaVersion: 'fanqie-batch-report-1',
    generatedAt: new Date().toISOString(),
    input: path.relative(RESOURCE_ROOT, options.input).replace(/\\/g, '/'),
    projectRepository: PROJECT_REPOSITORY,
    expectedProjectCommit: EXPECTED_PROJECT_COMMIT,
    options: {
      delayMs: options.delayMs,
      maxWorks: options.maxWorks,
      validateOnly: options.validateOnly,
      requireQuota: options.requireQuota,
      allowOverwrite: options.allowOverwrite
    },
    quota: validation.quota,
    validationErrors: validation.errors,
    results: [],
    status: 'blocked'
  };
  if (validation.errors.length) {
    writeReport(options.report, report);
    throw new Error(`作品清单有 ${validation.errors.length} 项校验错误；详情见 ${options.report}`);
  }
  if (options.requireQuota && !validation.quota.complete) {
    writeReport(options.report, report);
    throw new Error(`未达到 18 类各 20 本的硬配额；详情见 ${options.report}`);
  }
  if (options.validateOnly) {
    report.status = validation.quota.complete ? 'validated' : 'validated-incomplete';
    writeReport(options.report, report);
    console.log(JSON.stringify({ status: report.status, quota: report.quota }, null, 2));
    return validation.quota.complete ? 0 : 1;
  }

  const projectCommit = verifyProject(options.projectRoot);
  const existingMetadata = readFetchMetadata();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fanqie-batch-'));
  try {
    for (const work of validation.works) {
      const archiveRelativePath = buildArchiveRelativePath(work.bucket, work.title, work.sourceWorkId);
      const archivePath = path.resolve(RESOURCE_ROOT, archiveRelativePath);
      const existing = existingMetadata.get(archiveRelativePath);
      if (fs.existsSync(archivePath) && existing?.contentHash && existing.sourceWorkId === work.sourceWorkId) {
        const actualHash = crypto.createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex');
        if (actualHash === existing.contentHash) {
          report.results.push({ index: work.index, workId: work.workId, title: work.title, primaryGenre: work.primaryGenre, archivePath: archiveRelativePath, status: 'skipped-existing', contentHash: actualHash });
          continue;
        }
      }
      if (fs.existsSync(archivePath) && !options.allowOverwrite) {
        report.results.push({ index: work.index, workId: work.workId, title: work.title, primaryGenre: work.primaryGenre, archivePath: archiveRelativePath, status: 'failed', error: '目标原书已存在且没有 --allow-overwrite' });
        continue;
      }
      const resultPath = path.join(tempRoot, `${work.index}-${work.workId}.json`);
      try {
        console.log(`[fanqie-batch] 开始 ${work.index + 1}/${validation.works.length}：《${work.title}》`);
        const result = await runProjectDriver(options, work, archivePath, resultPath);
        const persisted = persistFetchResult(work, result, archiveRelativePath, config, options.allowOverwrite);
        report.results.push({ ...persisted, projectCommit });
      } catch (error) {
        report.results.push({ index: work.index, workId: work.workId, title: work.title, primaryGenre: work.primaryGenre, archivePath: archiveRelativePath, status: 'failed', error: error.message });
      }
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  const failed = report.results.filter(item => item.status === 'failed');
  const excluded = report.results.filter(item => item.status === 'downloaded-excluded');
  report.status = failed.length ? 'completed-with-errors' : excluded.length ? 'completed-with-excluded-archives' : 'completed';
  report.summary = {
    requested: validation.works.length,
    downloaded: report.results.filter(item => String(item.status).startsWith('downloaded-')).length,
    skippedExisting: report.results.filter(item => item.status === 'skipped-existing').length,
    failed: failed.length,
    archivedExcluded: excluded.length,
    usableArchives: report.results.filter(item => item.status === 'downloaded-usable').length
  };
  writeReport(options.report, report);
  console.log(JSON.stringify({ status: report.status, summary: report.summary, report: options.report }, null, 2));
  return failed.length ? 1 : 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  run(process.argv.slice(2))
    .then(code => { process.exitCode = code; })
    .catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

export {
  buildFetchRecord,
  normalizeWork,
  readOptions,
  validateWorkList,
  usageText
};
