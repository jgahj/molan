import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 规范化语料文本中的 Markdown 引用符和空白。
 * 参数：value 为待处理的原始文本。
 * 返回值：适合比较、抽取和统计的单行文本。
 */
export function normalizeCorpusText(value) {
  return String(value || '')
    .replace(/^>\s?/gmu, '')
    .replace(/\u0000/g, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * 计算统一的可计量字数，去掉空白但保留标点以兼容现有素材口径。
 * 参数：value 为清洗后的文本。
 * 返回值：按 Unicode 码点计数的非空白字符数。
 */
export function countCorpusChars(value) {
  return Array.from(String(value || '').replace(/\s+/gu, '')).length;
}

/**
 * 为文本生成稳定的短哈希，供去重键和审计引用使用。
 * 参数：value 为任意文本或可转为字符串的值。
 * 返回值：SHA-256 的前 16 位十六进制字符串。
 */
export function corpusTextHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

/** 为语料文本生成完整 SHA-256，供证据绑定、复核缓存和原文回放校验使用。
 * 参数：value 为任意文本或可转为字符串的值。
 * 返回值：完整的小写 SHA-256 十六进制字符串。
 */
export function corpusTextSha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

/** 比较目录和抓取结果中的章节 ID 顺序，防止乱序章节通过集合匹配门禁。
 * 参数：expected 为目录章节 ID 数组；actual 为实际抓取章节 ID 数组。
 * 返回值：两个数组长度相同且每个位置的章节 ID 都相同时返回 true。
 */
export function chapterIdsMatchInOrder(expected, actual) {
  const expectedIds = Array.isArray(expected) ? expected : [];
  const actualIds = Array.isArray(actual) ? actual : [];
  return expectedIds.length === actualIds.length
    && expectedIds.every((id, index) => id === actualIds[index]);
}

/** 校验资源库内的本地证据文件并返回其完整哈希，拒绝越过资源库根目录或使用未核验外部引用。
 * 参数：reference 为相对资源库根目录的证据路径；expectedHash 为可选的 SHA-256 全量或前缀；root 为资源库根目录。
 * 返回值：包含 verified、resolvedPath、sha256 和 reason 的证据校验结果。
 */
export function verifyLocalEvidenceReference(reference, expectedHash = '', root = '') {
  const source = String(reference || '').trim();
  const base = String(root || '').trim();
  if (!source) return { verified: false, resolvedPath: '', sha256: '', reason: 'evidence_reference_missing' };
  if (!base || /^[a-z][a-z\d+.-]*:\/\//iu.test(source)) {
    return { verified: false, resolvedPath: '', sha256: '', reason: 'evidence_reference_not_local' };
  }
  const resolvedPath = path.resolve(base, source);
  const relative = path.relative(path.resolve(base), resolvedPath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return { verified: false, resolvedPath, sha256: '', reason: 'evidence_reference_outside_root' };
  }
  let stat;
  try {
    stat = fs.statSync(resolvedPath);
  } catch (_) {
    return { verified: false, resolvedPath, sha256: '', reason: 'evidence_file_missing' };
  }
  if (!stat.isFile()) return { verified: false, resolvedPath, sha256: '', reason: 'evidence_reference_not_file' };
  const digest = crypto.createHash('sha256').update(fs.readFileSync(resolvedPath)).digest('hex');
  const expected = String(expectedHash || '').trim().toLowerCase();
  if (expected && (!/^[a-f0-9]{16,64}$/iu.test(expected) || !digest.startsWith(expected))) {
    return { verified: false, resolvedPath, sha256: digest, reason: 'evidence_hash_mismatch' };
  }
  return { verified: true, resolvedPath, sha256: digest, reason: 'verified' };
}

/**
 * 把来源题材字段拆成去重后的原题材标签。
 * 参数：value 为使用顿号、逗号、斜杠或空白分隔的题材字符串。
 * 返回值：原题材标签数组。
 */
export function splitRawGenres(value) {
  return [...new Set(String(value || '').split(/[、,，/／|\s]+/u).map(item => item.trim()).filter(Boolean))];
}

/** 把市场标签归一到用户要求的 18 个原题材，保留未配置标签供审计而不静默丢弃。
 * 参数：value 为单个题材标签；config 为包含 rawGenreAliases 的配额配置。
 * 返回值：归一化后的题材标签。
 */
export function canonicalizeRawGenre(value, config = {}) {
  let current = String(value || '').trim();
  const aliases = config?.rawGenreAliases && typeof config.rawGenreAliases === 'object'
    ? config.rawGenreAliases
    : {};
  const seen = new Set();
  while (current && Object.prototype.hasOwnProperty.call(aliases, current) && !seen.has(current)) {
    seen.add(current);
    current = String(aliases[current] || '').trim();
  }
  return current;
}

/** 归一化并去重一组原题材标签，供主归属和 18 类覆盖统计使用。
 * 参数：value 为题材数组或分隔字符串；config 为配额配置。
 * 返回值：归一化后的题材标签数组。
 */
export function canonicalizeRawGenres(value, config = {}) {
  const values = Array.isArray(value) ? value : splitRawGenres(value);
  return [...new Set(values.map(item => canonicalizeRawGenre(item, config)).filter(Boolean))];
}

/**
 * 规范化来源 URL，便于目录页、章节页和带片段 URL 使用同一个查找键。
 * 参数：value 为来源 URL。
 * 返回值：去掉片段和末尾斜杠的绝对 URL；无法解析时返回原字符串。
 */
export function canonicalizeSourceUrl(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  try {
    const url = new URL(source);
    url.hash = '';
    url.pathname = url.pathname.replace(/\/$/u, '') || '/';
    return url.href;
  } catch (_) {
    return source.replace(/#.*$/u, '').replace(/\/$/u, '');
  }
}

/**
 * 从 URL 查询参数中提取常见的作品 ID。
 * 参数：value 为目录页或章节页 URL。
 * 返回值：作品 ID 字符串；无法提取时返回空字符串。
 */
export function sourceNovelIdFromUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return String(url.searchParams.get('novelid') || url.searchParams.get('bookId') || url.searchParams.get('book_id') || '').trim();
  } catch (_) {
    return '';
  }
}

/** 取得用于配额、去重和增量处理的逻辑作品 ID。
 * 参数：item 为来源、样本、manifest 作品或分卷对象；fallback 为没有任何 ID 时的回退值。
 * 返回值：优先返回显式 canonicalWorkId，否则返回来源作品 ID或回退值。
 */
export function logicalWorkId(item, fallback = '') {
  const source = item && typeof item === 'object' ? item : {};
  return String(
    source.canonicalWorkId
      || source.canonical_work_id
      || source.sourceWorkId
      || source.source_work_id
      || (source.sourceNovelId ? `novel-${source.sourceNovelId}` : '')
      || source.sourceNovelId
      || fallback
      || ''
  ).trim();
}

/**
 * 根据来源 URL推断平台名称，只用于审计和覆盖统计，不绕过站点限制。
 * 参数：value 为来源 URL。
 * 返回值：平台标识或空字符串。
 */
export function platformFromSourceUrl(value) {
  try {
    const host = new URL(String(value || '')).hostname.toLowerCase();
    if (host.includes('jjwxc')) return '晋江';
    if (host.includes('github')) return 'GitHub';
    if (host.includes('qimao') || host.includes('7mao')) return '七猫';
    if (host.includes('fanqienovel') || host.includes('fanqie')) return '番茄';
    if (host.includes('qidian')) return '起点';
    return host;
  } catch (_) {
    return '';
  }
}

/** 规范化平台名称，统一来源清单、抓取参数和 manifest 的平台值。
 * 参数：value 为平台名称、域名或常见英文别名。
 * 返回值：七猫、番茄、起点、晋江、GitHub 或原始平台名称。
 */
export function normalizePlatform(value) {
  const source = String(value || '').trim();
  const lower = source.toLowerCase();
  if (/七猫|qimao|7mao/u.test(lower)) return '七猫';
  if (/番茄|fanqie/u.test(lower)) return '番茄';
  if (/起点|qidian/u.test(lower)) return '起点';
  if (/晋江|jjwxc/u.test(lower)) return '晋江';
  if (/github|git hub/u.test(lower)) return 'GitHub';
  return source;
}

/** 从七猫、番茄、起点目录 URL 提取作品 ID，避免用章节 ID代替作品身份。
 * 参数：value 为目录页或章节页 URL；platform 为可选的平台名称。
 * 返回值：可回读的作品 ID；无法从 URL 得出时返回空字符串。
 */
export function platformWorkIdFromUrl(value, platform = '') {
  const source = String(value || '').trim();
  if (!source) return '';
  try {
    const url = new URL(source);
    const normalizedPlatform = normalizePlatform(platform || platformFromSourceUrl(source));
    const queryKeys = new Set(['novelid', 'novel_id', 'bookid', 'book_id', 'novelid']);
    for (const [key, rawValue] of url.searchParams.entries()) {
      if (!queryKeys.has(key.toLowerCase())) continue;
      const candidate = decodeURIComponent(String(rawValue || '')).trim();
      if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(candidate)) return candidate;
    }
    const patterns = {
      '七猫': /\/(?:shuku|book|novel|detail)\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})(?:\/|$)/iu,
      '番茄': /\/(?:page|book|novel)\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})(?:\/|$)/iu,
      '起点': /\/(?:info|book|novel)\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})(?:\/|$)/iu
    };
    const match = patterns[normalizedPlatform]?.exec(decodeURIComponent(url.pathname));
    return match?.[1] || '';
  } catch (_) {
    return '';
  }
}

/** 规范化 GitHub 仓库标识，只保留 owner/repository 形式。
 * 参数：value 为仓库 URL、owner/repository 或 git remote 字符串。
 * 返回值：规范化后的 owner/repository；格式不合法时返回空字符串。
 */
export function normalizeGitHubRepository(value) {
  let source = String(value || '').trim().replace(/[?#].*$/u, '').replace(/\/$/u, '');
  source = source.replace(/^git@github\.com:/iu, '').replace(/^git\+?/iu, '');
  const urlMatch = source.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+\/[^/]+)$/iu);
  if (urlMatch) source = urlMatch[1];
  const match = source.match(/^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/u);
  return match ? `${match[1]}/${match[2]}` : '';
}

/** 从 GitHub 网页或 raw URL 提取 owner/repository，供来源一致性校验。
 * 参数：value 为 GitHub 仓库、blob 或 raw 文件 URL。
 * 返回值：owner/repository 标识；无法识别时返回空字符串。
 */
export function githubRepositoryFromUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const host = url.hostname.toLowerCase();
    if (host !== 'github.com' && host !== 'www.github.com' && host !== 'raw.githubusercontent.com') return '';
    const parts = decodeURIComponent(url.pathname).split('/').filter(Boolean);
    return parts.length >= 2 ? normalizeGitHubRepository(`${parts[0]}/${parts[1]}`) : '';
  } catch (_) {
    return '';
  }
}

/** 规范化 GitHub 仓库内文件路径，拒绝绝对路径和目录穿越。
 * 参数：value 为仓库内相对文件路径。
 * 返回值：斜杠分隔的安全相对路径；不合法时返回空字符串。
 */
export function normalizeGitHubSourcePath(value) {
  const source = String(value || '').trim().replace(/\\/gu, '/').replace(/^\.\//u, '');
  if (!source || source.startsWith('/') || source.split('/').includes('..') || /[\u0000-\u001f]/u.test(source)) return '';
  return source;
}

/** 规范化作品受众标签，供复合题材画像和平台覆盖统计使用。
 * 参数：value 为来源记录或创作请求中的受众文本。
 * 返回值：统一的“女频”“男频”或“未标注”标签。
 */
export function normalizeAudience(value) {
  const source = String(value || '').trim().toLowerCase();
  if (/女频|女性|female|women/u.test(source)) return '女频';
  if (/男频|男性|male|men/u.test(source)) return '男频';
  return source ? '未标注' : '';
}

/** 规范化作品完结状态，避免把抓取成功、平台连载状态和质量完整性混为一谈。
 * 参数：value 为来源记录中的完结状态文本。
 * 返回值：completed、ongoing、abandoned、unknown 或空字符串。
 */
export function normalizeCompletionStatus(value) {
  const source = String(value || '').trim().toLowerCase();
  if (!source) return '';
  if (/未完结|未完成|未结束|不完整|尚未(?:完结|完成)|incomplete|unfinished|uncompleted|not[ -]?(?:finished|complete(?:d)?)/iu.test(source)) return 'ongoing';
  if (/弃坑|停更|abandoned|dropped/iu.test(source)) return 'abandoned';
  if (/完结|完本|已完结|(?:^|[^a-z])completed?(?:$|[^a-z])|(?:^|[^a-z])finished(?:$|[^a-z])|(?:^|[^a-z])done(?:$|[^a-z])/iu.test(source)) return 'completed';
  if (/连载|更新中|ongoing|serial|writing/u.test(source)) return 'ongoing';
  return 'unknown';
}

/** 规范化原书内容范围，区分全文归档、节选和未知范围。
 * 参数：value 为来源或归档记录中的内容范围文本。
 * 返回值：full_work、partial、unknown 或空字符串。
 */
export function normalizeContentScope(value) {
  const source = String(value || '').trim().toLowerCase();
  if (!source) return '';
  if (/full[_ -]?work|全文|整本|完整(?:文本|作品)?|complete[_ -]?text/iu.test(source)) return 'full_work';
  if (/partial|excerpt|sample|节选|片段|限章|试读/iu.test(source)) return 'partial';
  return 'unknown';
}

/** 将逻辑作品展开为需要逐文件回读的原书记录。
 * 参数：record 为 manifest 逻辑作品或单文件记录。
 * 返回值：带继承元数据但各自保留 filePath、contentHash 的单文件记录数组。
 */
function archiveEvidenceRecords(record) {
  const source = record && typeof record === 'object' ? record : {};
  const parts = Array.isArray(source.parts) && source.parts.length ? source.parts : [source];
  return parts.map(part => {
    const value = part && typeof part === 'object' ? part : {};
    const merged = { ...source, ...value };
    if (!Object.prototype.hasOwnProperty.call(value, 'filePath')) merged.filePath = '';
    if (!Object.prototype.hasOwnProperty.call(value, 'contentHash')) merged.contentHash = '';
    return merged;
  });
}

/** 生成目录快照参与签名的稳定载荷，排除快照自身的哈希和诊断字段。
 * 参数：snapshot 为抓取或 manifest 中的 catalogSnapshot 对象。
 * 返回值：与抓取脚本一致的目录快照签名载荷。
 */
function catalogSnapshotPayload(snapshot) {
  const value = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const chapterIds = Array.isArray(value.chapterIds)
    ? value.chapterIds.map(item => String(item || '').trim()).filter(Boolean)
    : [];
  const chapters = Array.isArray(value.chapters)
    ? value.chapters.map(chapter => ({
      chapterId: String(chapter?.chapterId || chapter?.id || '').trim(),
      title: String(chapter?.title || '').trim(),
      url: canonicalizeSourceUrl(chapter?.url || chapter?.chapterUrl || '')
    }))
    : chapterIds.map(chapterId => ({ chapterId, title: '', url: '' }));
  return {
    sourceUrl: canonicalizeSourceUrl(value.sourceUrl || ''),
    capturedAt: String(value.capturedAt || '').trim(),
    chapterCount: Number.isFinite(Number(value.chapterCount)) ? Number(value.chapterCount) : chapterIds.length,
    chapterIds,
    chapters
  };
}

/** 重新读取归档文件、授权证据和目录快照，防止最终建库信任 manifest 中的布尔字段。
 * 参数：record 为 manifest 逻辑作品或单文件记录；config 为包含 resourceRoot、archiveRoot 的严格建库配置。
 * 返回值：包含逐文件哈希、证据哈希、目录快照哈希和失败原因的重验结果。
 */
export function verifyArchiveRecordEvidence(record, config = {}) {
  if (config.revalidateArchiveEvidence !== true) {
    return { enabled: false, usable: true, reasons: [], files: [], evidence: {}, catalogSnapshotHashVerified: false };
  }
  const source = record && typeof record === 'object' ? record : {};
  const resourceRootValue = String(config.resourceRoot || config.evidenceRoot || '').trim();
  if (!resourceRootValue) {
    return { enabled: true, usable: false, reasons: ['archive_evidence_root_missing'], files: [], evidence: {}, catalogSnapshotHashVerified: false };
  }
  const resourceRoot = path.resolve(resourceRootValue);
  const archiveRoot = path.resolve(String(config.archiveRoot || path.join(resourceRoot, '小说原本')));
  const reasons = [];
  const files = [];
  const expectedContentHash = value => String(value || '').trim().toLowerCase();
  for (const item of archiveEvidenceRecords(source)) {
    const relativePath = String(item.filePath || '').replace(/\\/gu, '/').replace(/^\.\//u, '');
    const filePath = path.resolve(resourceRoot, relativePath);
    const relativeToArchive = path.relative(archiveRoot, filePath);
    const insideArchive = Boolean(relativePath)
      && relativeToArchive !== '..'
      && !relativeToArchive.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativeToArchive);
    if (!insideArchive) {
      reasons.push(relativePath ? 'archive_file_outside_root' : 'archive_file_path_missing');
      files.push({ filePath: relativePath, verified: false, reason: relativePath ? 'archive_file_outside_root' : 'archive_file_path_missing' });
      continue;
    }
    let buffer;
    try {
      buffer = fs.readFileSync(filePath);
    } catch (_) {
      reasons.push('archive_file_missing');
      files.push({ filePath: relativePath, verified: false, reason: 'archive_file_missing' });
      continue;
    }
    const actualSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const declaredSha256 = expectedContentHash(item.contentHash);
    const fullHash = /^[a-f0-9]{64}$/iu.test(declaredSha256);
    const hashMatches = fullHash && actualSha256 === declaredSha256;
    const fileResult = {
      filePath: relativePath,
      verified: hashMatches,
      reason: hashMatches ? 'verified' : !fullHash ? 'archive_content_hash_missing_or_not_full' : 'archive_content_hash_mismatch',
      actualSha256,
      declaredSha256
    };
    files.push(fileResult);
    if (!hashMatches) reasons.push(fileResult.reason);
  }
  if (Array.isArray(source.parts) && source.parts.length > 0) {
    const parts = archiveEvidenceRecords(source)
      .slice()
      .sort((left, right) => String(left.filePath || '').localeCompare(String(right.filePath || ''), 'zh-CN'));
    const logicalHash = crypto.createHash('sha256')
      .update(parts.map(item => `${String(item.filePath || '').replace(/\\/gu, '/')}:${expectedContentHash(item.contentHash)}`).join('|'))
      .digest('hex');
    const declaredLogicalHash = expectedContentHash(source.contentHash);
    if (!/^[a-f0-9]{64}$/iu.test(declaredLogicalHash) || declaredLogicalHash !== logicalHash) reasons.push('logical_content_hash_mismatch');
  } else if (files.length === 1 && expectedContentHash(source.contentHash) && files[0].actualSha256 !== expectedContentHash(source.contentHash)) {
    reasons.push('archive_content_hash_mismatch');
  }

  const policy = config.authorizationPolicy && typeof config.authorizationPolicy === 'object' ? config.authorizationPolicy : {};
  const requiredEvidence = (reference, hash, required) => {
    const evidenceRef = String(reference || '').trim();
    const evidenceHash = String(hash || '').trim().toLowerCase();
    if (!evidenceRef) return { verified: false, sha256: '', reason: required ? 'evidence_file_missing' : 'evidence_not_required' };
    if (!/^[a-f0-9]{64}$/iu.test(evidenceHash)) return { verified: false, sha256: '', reason: 'evidence_hash_missing_or_not_full' };
    const result = verifyLocalEvidenceReference(evidenceRef, evidenceHash, resourceRoot);
    return {
      ...result,
      verified: result.verified && result.sha256 === evidenceHash,
      reason: result.verified && result.sha256 === evidenceHash ? 'verified' : result.reason || 'evidence_hash_mismatch'
    };
  };
  const authorization = normalizeAuthorization(source.authorization);
  const completionEvidence = requiredEvidence(
    source.completionEvidenceRef || source.completion_evidence_ref,
    source.completionEvidenceSha256 || source.completion_evidence_sha256,
    config.requireCompletionEvidenceVerification === true
  );
  const fullWorkEvidence = requiredEvidence(
    source.fullWorkEvidenceRef || source.full_work_evidence_ref,
    source.fullWorkEvidenceSha256 || source.full_work_evidence_sha256,
    config.requireFullWorkEvidence === true
  );
  const authorizationEvidence = requiredEvidence(
    authorization.evidenceRef,
    authorization.evidenceSha256,
    policy.requiredForArchiveUse !== false
  );
  const catalogSnapshot = source.catalogSnapshot && typeof source.catalogSnapshot === 'object' ? source.catalogSnapshot : null;
  const catalogPayload = catalogSnapshot ? catalogSnapshotPayload(catalogSnapshot) : null;
  const catalogDeclaredHash = String(catalogSnapshot?.snapshotSha256 || '').trim().toLowerCase();
  const catalogIds = catalogPayload?.chapterIds || [];
  const catalogChapters = catalogPayload?.chapters || [];
  const catalogSnapshotHashVerified = Boolean(catalogPayload)
    && /^[a-f0-9]{64}$/iu.test(catalogDeclaredHash)
    && crypto.createHash('sha256').update(JSON.stringify(catalogPayload)).digest('hex') === catalogDeclaredHash
    && catalogPayload.chapterCount === catalogIds.length
    && catalogChapters.length === catalogIds.length
    && catalogChapters.every((chapter, index) => chapter.chapterId === catalogIds[index]);
  const catalogEvidenceRef = source.catalogEvidenceRef || source.catalog_evidence_ref || '';
  const catalogEvidence = catalogEvidenceRef
    ? requiredEvidence(catalogEvidenceRef, source.catalogEvidenceSha256 || source.catalog_evidence_sha256, true)
    : { verified: catalogSnapshotHashVerified, sha256: catalogDeclaredHash, reason: catalogSnapshotHashVerified ? 'snapshot_verified' : 'catalog_snapshot_hash_mismatch' };
  const platformMetadataChecks = archiveEvidenceRecords(source).map(item => validatePlatformMetadata(item, {
    evidenceRoot: resourceRoot,
    requireRanking: true,
    requireRankingEvidence: config.requireRankingEvidence !== false
  }));
  const platformMetadata = platformMetadataChecks[0] || validatePlatformMetadata(source, {
    evidenceRoot: resourceRoot,
    requireRanking: true,
    requireRankingEvidence: config.requireRankingEvidence !== false
  });
  for (const check of platformMetadataChecks) {
    if (!check.verified) reasons.push(...check.reasons.map(reason => `platform_${reason}`));
  }
  const evidence = { authorization: authorizationEvidence, completion: completionEvidence, fullWork: fullWorkEvidence, catalog: catalogEvidence };
  if (policy.requiredForArchiveUse !== false && !authorizationEvidence.verified) reasons.push(`authorization_${authorizationEvidence.reason}`);
  if (config.requireCompletionEvidenceVerification === true && !completionEvidence.verified) reasons.push(`completion_${completionEvidence.reason}`);
  if (config.requireFullWorkEvidence === true && !fullWorkEvidence.verified) reasons.push(`full_work_${fullWorkEvidence.reason}`);
  if (config.requireChapterSetEvidence === true && (!catalogSnapshotHashVerified || !catalogEvidence.verified)) reasons.push('catalog_snapshot_hash_mismatch');
  return {
    enabled: true,
    usable: reasons.length === 0,
    reasons: [...new Set(reasons)],
    resourceRoot,
    archiveRoot,
    files,
    fileHashVerified: files.length > 0 && files.every(item => item.verified),
    evidence,
    catalogSnapshotHashVerified,
    catalogPayload,
    platformMetadata,
    platformMetadataChecks
  };
}

/** 检查原书记录是否具备完整文本、完结、哈希和授权证据。
 * 参数：record 为 manifest 或来源清单中的作品记录；config 为配额和质量配置。
 * 返回值：包含 usable、reasons 和各项门禁结果的审计对象。
 */
export function evaluateArchiveRecord(record, config = {}) {
  const source = record && typeof record === 'object' ? record : {};
  const quality = source.quality && typeof source.quality === 'object' ? source.quality : {};
  const rawGenreValues = Array.isArray(source.rawGenres)
    ? source.rawGenres
    : Array.isArray(source.genres) ? source.genres : splitRawGenres(source.genre);
  const rawGenres = canonicalizeRawGenres(rawGenreValues, config);
  const primaryGenre = canonicalizeRawGenre(source.primaryGenre, config);
  const archiveEvidence = config.revalidateArchiveEvidence === true
    ? verifyArchiveRecordEvidence(source, config)
    : null;
  const platformMetadata = archiveEvidence?.platformMetadata || validatePlatformMetadata(source, {
    evidenceRoot: config.resourceRoot || config.evidenceRoot || '',
    requireRanking: true,
    requireRankingEvidence: config.requireRankingEvidence !== false
  });
  const authorizationEvidence = archiveEvidence?.evidence?.authorization;
  const authorizationInput = authorizationEvidence
    ? {
      ...normalizeAuthorization(source.authorization),
      evidenceVerified: authorizationEvidence.verified === true,
      evidenceSha256: authorizationEvidence.sha256 || normalizeAuthorization(source.authorization).evidenceSha256
    }
    : source.authorization;
  const authorization = evaluateAuthorization(authorizationInput, config.authorizationPolicy || {});
  const completionStatus = normalizeCompletionStatus(source.completionStatus || source.completion_status || '');
  const completionVerified = config.requireCompletedWork !== true || completionStatus === 'completed';
  const completionEvidence = String(source.completionEvidenceRef || source.completion_evidence_ref || '').trim();
  const checkedCompletionEvidence = archiveEvidence?.evidence?.completion;
  const completionEvidenceVerified = config.requireCompletionEvidence !== true
    || (Boolean(completionEvidence)
      && (config.requireCompletionEvidenceVerification !== true
        || (checkedCompletionEvidence ? checkedCompletionEvidence.verified === true : source.completionEvidenceVerified === true)));
  const contentScope = normalizeContentScope(source.contentScope || source.content_scope || '');
  const expectedChapterCount = Number(source.expectedChapterCount || source.expected_chapter_count || source.totalChapterCount || 0);
  const fetchedChapterCount = Number(source.fetchedChapterCount || source.fetched_chapter_count || source.chapterCount || 0);
  const chapterCountDeclared = source.chapterCountDeclared === true || source.chapter_count_declared === true;
  const declaredCoverage = Number(source.chapterCoverage ?? source.chapter_coverage);
  const chapterCoverage = Number.isFinite(declaredCoverage)
    ? declaredCoverage
    : expectedChapterCount > 0 ? fetchedChapterCount / expectedChapterCount : null;
  const fullWorkEvidenceRef = String(source.fullWorkEvidenceRef || source.full_work_evidence_ref || '').trim();
  const checkedFullWorkEvidence = archiveEvidence?.evidence?.fullWork;
  const fullWorkEvidenceVerified = config.requireFullWorkEvidence !== true
    || (Boolean(fullWorkEvidenceRef)
      && (checkedFullWorkEvidence ? checkedFullWorkEvidence.verified === true : source.fullWorkEvidenceVerified === true));
  const catalogSnapshot = source.catalogSnapshot && typeof source.catalogSnapshot === 'object'
    ? source.catalogSnapshot
    : null;
  const catalogEvidenceHash = String(catalogSnapshot?.snapshotSha256 || '').trim().toLowerCase();
  const catalogChapterIds = (catalogSnapshot?.chapterIds || []).map(value => String(value || '').trim()).filter(Boolean);
  const declaredChapterIds = [
    ...(Array.isArray(source.chapters) ? source.chapters : []),
    ...(Array.isArray(source.parts) ? source.parts.flatMap(part => Array.isArray(part?.chapters) ? part.chapters : []) : [])
  ].map(chapter => String(chapter?.chapterId || chapter?.chapterid || chapter?.chapter_id || chapter?.id || '').trim()).filter(Boolean);
  const fetchedChapterIds = declaredChapterIds;
  const expectedChapterCountMatchesCatalog = config.requireChapterSetEvidence !== true
    || (expectedChapterCount > 0 && catalogChapterIds.length > 0 && expectedChapterCount === catalogChapterIds.length);
  const chapterOrderMatches = chapterIdsMatchInOrder(catalogChapterIds, fetchedChapterIds);
  const catalogSnapshotHashVerified = archiveEvidence
    ? archiveEvidence.catalogSnapshotHashVerified === true
    : /^[a-f0-9]{64}$/iu.test(catalogEvidenceHash);
  const chapterSetMatches = catalogSnapshotHashVerified
    && catalogChapterIds.length > 0
    && Array.isArray(catalogSnapshot?.duplicateChapterIds)
    && catalogSnapshot.duplicateChapterIds.length === 0
    && expectedChapterCountMatchesCatalog
    && fetchedChapterIds.length === catalogChapterIds.length
    && catalogChapterIds.every(id => fetchedChapterIds.includes(id))
    && (config.requireChapterOrderEvidence !== true || chapterOrderMatches);
  const catalogEvidenceVerified = config.requireChapterSetEvidence !== true
    || (chapterSetMatches && (!archiveEvidence || archiveEvidence.evidence?.catalog?.verified === true));
  const hasVerifiedChapterCoverage = expectedChapterCount > 0
    && fetchedChapterCount > 0
    && chapterCoverage !== null
    && chapterCoverage >= 1;
  const chapterCountEvidenceVerified = config.requireDeclaredChapterCount !== true || chapterCountDeclared;
  const fullWorkVerified = config.requireFullWork !== true
    || (contentScope === 'full_work'
      && hasVerifiedChapterCoverage
      && chapterCountEvidenceVerified
      && fullWorkEvidenceVerified
      && source.partial !== true
      && quality.partial !== true);
  const contentHash = String(source.contentHash || source.content_hash || '').trim();
  const contentHashPattern = config.requireFullSha256 === true ? /^[a-f0-9]{64}$/iu : /^[a-f0-9]{16,64}$/iu;
  const contentHashVerified = (config.requireContentHash !== true || contentHashPattern.test(contentHash))
    && (!archiveEvidence || archiveEvidence.fileHashVerified === true);
  const primaryGenreVerified = config.rawGenreRequiresDistinctPrimary !== true
    || (rawGenres.length > 0 && rawGenres.length === 1 && primaryGenre === rawGenres[0])
    || (rawGenres.length > 1 && rawGenres.includes(primaryGenre));
  const reasons = [];
  if (source.excludeFromCorpus === true) reasons.push('archive_excluded');
  if (quality.incomplete === true) reasons.push('incomplete');
  if (quality.partial === true || source.partial === true) reasons.push('partial');
  if (!completionVerified) reasons.push('completionUnverified');
  if (!completionEvidenceVerified) reasons.push(completionEvidence ? 'completionEvidenceUnverified' : 'completionEvidenceMissing');
  if (config.requireFullWorkEvidence === true && !fullWorkEvidenceVerified) reasons.push(fullWorkEvidenceRef ? 'fullWorkEvidenceUnverified' : 'fullWorkEvidenceMissing');
  if (config.requireChapterSetEvidence === true && (!catalogEvidenceVerified || !chapterSetMatches)) reasons.push('chapterSetEvidenceUnverified');
  if (config.requireChapterOrderEvidence === true && catalogChapterIds.length > 0 && !chapterOrderMatches) reasons.push('chapterOrderMismatch');
  if (!platformMetadata.verified) reasons.push('platformMetadataUnverified');
  if (!expectedChapterCountMatchesCatalog) reasons.push('expectedChapterCountMismatch');
  if (!hasVerifiedChapterCoverage && config.requireFullWork === true) reasons.push('chapterCoverageUnverified');
  if (!chapterCountEvidenceVerified && config.requireFullWork === true) reasons.push('chapterCountEvidenceMissing');
  if (!fullWorkVerified) reasons.push('fullWorkUnverified');
  if (!contentHashVerified) reasons.push('contentHashMissing');
  if (!primaryGenreVerified) reasons.push('primaryGenreUnverified');
  if (!authorization.usable) reasons.push(authorization.reason);
  if (archiveEvidence) reasons.push(...archiveEvidence.reasons);
  return {
    usable: reasons.length === 0,
    reasons: [...new Set(reasons)],
    authorization,
    completionStatus,
    completionVerified,
    completionEvidenceVerified,
    fullWorkEvidenceRef,
    fullWorkEvidenceVerified,
    catalogSnapshot,
    catalogSnapshotHashVerified,
    archiveEvidence,
    catalogEvidenceVerified,
    chapterSetMatches,
    chapterOrderMatches,
    expectedChapterCountMatchesCatalog,
    contentScope,
    expectedChapterCount: Number.isFinite(expectedChapterCount) ? expectedChapterCount : 0,
    fetchedChapterCount: Number.isFinite(fetchedChapterCount) ? fetchedChapterCount : 0,
    chapterCountDeclared,
    chapterCoverage,
    hasVerifiedChapterCoverage,
    chapterCountEvidenceVerified,
    fullWorkVerified,
    contentHashVerified,
    platformMetadata,
    rawGenres,
    primaryGenre,
    primaryGenreVerified
  };
}

/** 规范化榜单信息并保留排名口径和采集时间，供热度排序而非授权判定使用。
 * 参数：item 为来源清单记录或其中的 ranking 对象。
 * 返回值：包含分题材排名、排名类型、指标和采集时间的对象；没有证据时返回空对象。
 */
export function normalizeRanking(item) {
  const source = item && typeof item === 'object' ? item : {};
  const nested = source.ranking && typeof source.ranking === 'object'
    ? source.ranking
    : source.rankingInfo && typeof source.rankingInfo === 'object' ? source.rankingInfo : {};
  const rawRanks = source.ranks && typeof source.ranks === 'object'
    ? source.ranks
    : nested.ranks && typeof nested.ranks === 'object' ? nested.ranks : {};
  const ranks = Object.fromEntries(Object.entries(rawRanks)
    .map(([key, value]) => [String(key).trim(), Number(value)])
    .filter(([key, value]) => key && Number.isFinite(value) && value > 0));
  const directRank = Number(source.rank ?? nested.rank);
  if (Number.isFinite(directRank) && directRank > 0 && !Object.prototype.hasOwnProperty.call(ranks, 'overall')) ranks.overall = directRank;
  const evidenceSha256 = String(source.rankEvidenceSha256 || source.rank_evidence_sha256
    || nested.evidenceSha256 || nested.evidence_sha256 || '').trim().toLowerCase();
  const evidenceVerified = source.rankEvidenceVerified === true
    || source.rank_evidence_verified === true
    || nested.evidenceVerified === true
    || nested.evidence_verified === true;
  const result = {
    ranks,
    type: String(source.rankType || nested.type || '').trim(),
    metric: String(source.rankMetric || nested.metric || '').trim(),
    capturedAt: String(source.rankCapturedAt || nested.capturedAt || '').trim(),
    evidenceRef: String(source.rankEvidenceRef || nested.evidenceRef || '').trim(),
    evidenceSha256,
    evidenceVerified
  };
  const hasRankValues = Object.keys(ranks).length > 0;
  const hasMetadata = [result.type, result.metric, result.capturedAt, result.evidenceRef].some(Boolean);
  return hasRankValues || hasMetadata ? result : {};
}

/** 从来源记录或授权对象中提取可审计的授权元数据，不把平台位置当作授权结论。
 * 参数：item 为来源清单记录、sidecar 记录或 authorization 对象。
 * 返回值：授权范围、证据引用和有效期组成的普通对象或空对象。
 */
export function normalizeAuthorization(item) {
  const source = item && typeof item === 'object' ? item : {};
  const nestedCandidate = source.authorization || source.license_info || null;
  const nested = typeof nestedCandidate === 'object' && !Array.isArray(nestedCandidate) ? nestedCandidate : null;
  const hasAuthorizationFields = ['scope', 'evidenceRef', 'evidence', 'evidence_url', 'evidenceSha256', 'evidence_sha256', 'expiresAt', 'expires_at', 'rightsHolder', 'rights_holder', 'license', 'archiveUseAllowed', 'archive_use_allowed', 'modelProcessingAllowed', 'model_processing_allowed', 'runtimeUseAllowed', 'runtime_use_allowed', 'redistributionAllowed', 'redistribution_allowed']
    .some(key => Object.prototype.hasOwnProperty.call(source, key));
  const value = nested || (hasAuthorizationFields ? source : {});
  if (typeof nestedCandidate === 'string' && !hasAuthorizationFields) return { status: nestedCandidate.trim() };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return {
    status: String(value.status || '').trim(),
    scope: String(value.scope || '').trim(),
    evidenceRef: String(value.evidenceRef || value.evidence || value.evidence_url || '').trim(),
    evidenceSha256: String(value.evidenceSha256 || value.evidence_sha256 || '').trim().toLowerCase(),
    evidenceVerified: value.evidenceVerified === true || value.evidence_verified === true,
    expiresAt: String(value.expiresAt || value.expires_at || '').trim(),
    rightsHolder: String(value.rightsHolder || value.rights_holder || '').trim(),
    license: String(value.license || '').trim(),
    archiveUseAllowed: value.archiveUseAllowed === true || value.archive_use_allowed === true,
    modelProcessingAllowed: value.modelProcessingAllowed === true || value.model_processing_allowed === true,
    redistributionAllowed: value.redistributionAllowed === true || value.redistribution_allowed === true,
    runtimeUseAllowed: value.runtimeUseAllowed === true || value.runtime_use_allowed === true
  };
}

/** 校验平台作品身份、目录快照、榜单元数据和 GitHub 固定版本证据。
 * 参数：value 为来源、抓取 sidecar 或 manifest 作品记录；options.evidenceRoot 为本地证据根目录。
 * 返回值：规范化平台字段、许可证证据结果和可写入质量报告的失败原因。
 */
export function validatePlatformMetadata(value, options = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const sourceUrl = canonicalizeSourceUrl(source.sourceUrl || source.url || '');
  const declaredPlatform = normalizePlatform(source.platform || '');
  const inferredPlatform = normalizePlatform(platformFromSourceUrl(sourceUrl));
  const platform = declaredPlatform || inferredPlatform;
  const reasons = [];
  if (declaredPlatform && inferredPlatform && declaredPlatform !== inferredPlatform) reasons.push('platformMismatch');

  const workIdPlatforms = new Set(['七猫', '番茄', '起点']);
  const platformWorkId = String(source.platformWorkId || source.platform_work_id || source.platformBookId || source.platform_book_id || '').trim()
    || platformWorkIdFromUrl(sourceUrl, platform);
  const ranking = normalizeRanking(source);
  const snapshot = source.catalogSnapshot && typeof source.catalogSnapshot === 'object' ? source.catalogSnapshot : null;
  const catalogIds = Array.isArray(snapshot?.chapterIds)
    ? snapshot.chapterIds.map(item => String(item || '').trim()).filter(Boolean)
    : [];
  const requireRankingEvidence = options.requireRankingEvidence !== false;
  let rankingEvidence = {
    verified: false,
    resolvedPath: '',
    sha256: ranking.evidenceSha256 || '',
    reason: 'rankingEvidenceNotRequired'
  };

  if (workIdPlatforms.has(platform)) {
    if (!sourceUrl) reasons.push('platformSourceUrlMissing');
    if (!platformWorkId) reasons.push('platformWorkIdMissing');
    else if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(platformWorkId)) reasons.push('platformWorkIdInvalid');
    const urlWorkId = platformWorkIdFromUrl(sourceUrl, platform);
    if (urlWorkId && platformWorkId && urlWorkId !== platformWorkId) reasons.push('platformWorkIdMismatch');
    if (!snapshot) reasons.push('catalogSnapshotMissing');
    else {
      const snapshotHash = String(snapshot.snapshotSha256 || '').trim().toLowerCase();
      const snapshotCount = Number(snapshot.chapterCount);
      if (!/^[a-f0-9]{64}$/u.test(snapshotHash)) reasons.push('catalogSnapshotHashMissing');
      if (!String(snapshot.capturedAt || '').trim()) reasons.push('catalogSnapshotTimeMissing');
      if (!Number.isInteger(snapshotCount) || snapshotCount <= 0 || snapshotCount !== catalogIds.length) reasons.push('catalogChapterCountMissingOrMismatch');
    }
    if (options.requireRanking !== false) {
      const rankValues = Object.values(ranking.ranks || {}).filter(item => Number.isFinite(Number(item)) && Number(item) > 0);
      if (!rankValues.length) reasons.push('rankingValueMissing');
      if (!ranking.type) reasons.push('rankingTypeMissing');
      if (!ranking.metric) reasons.push('rankingMetricMissing');
      if (!ranking.capturedAt || !Number.isFinite(Date.parse(ranking.capturedAt))) reasons.push('rankingTimeMissingOrInvalid');
      if (!ranking.evidenceRef) reasons.push('rankingEvidenceMissing');
      if (requireRankingEvidence) {
        const evidenceRoot = String(options.evidenceRoot || options.resourceRoot || '').trim();
        if (!/^[a-f0-9]{64}$/u.test(ranking.evidenceSha256)) {
          reasons.push('rankingEvidenceHashMissingOrNotFull');
          rankingEvidence = {
            verified: false,
            resolvedPath: '',
            sha256: ranking.evidenceSha256 || '',
            reason: 'ranking_evidence_hash_missing_or_not_full'
          };
        } else if (!evidenceRoot || !ranking.evidenceRef) {
          reasons.push('rankingEvidenceUnverified');
          rankingEvidence = {
            verified: false,
            resolvedPath: '',
            sha256: ranking.evidenceSha256,
            reason: evidenceRoot ? 'ranking_evidence_reference_missing' : 'evidence_root_missing'
          };
        } else {
          rankingEvidence = verifyLocalEvidenceReference(ranking.evidenceRef, ranking.evidenceSha256, evidenceRoot);
          if (!rankingEvidence.verified || rankingEvidence.sha256 !== ranking.evidenceSha256) reasons.push('rankingEvidenceUnverified');
        }
      }
    }
  }

  const repositoryInput = source.repository || source.repo || '';
  const repository = normalizeGitHubRepository(repositoryInput);
  const commitSha = String(source.commitSha || source.commit_sha || source.commit || '').trim().toLowerCase();
  const sourcePath = normalizeGitHubSourcePath(source.sourcePath || source.source_path || source.path || '');
  const licenseEvidenceRef = String(source.licenseEvidenceRef || source.license_evidence_ref || '').trim();
  const declaredLicenseEvidenceSha256 = String(source.licenseEvidenceSha256 || source.license_evidence_sha256 || '').trim().toLowerCase();
  let licenseEvidence = { verified: false, resolvedPath: '', sha256: '', reason: 'licenseEvidenceNotRequired' };
  if (platform === 'GitHub') {
    if (!sourceUrl) reasons.push('githubSourceUrlMissing');
    const urlRepository = githubRepositoryFromUrl(sourceUrl);
    if (!repository) reasons.push('githubRepositoryMissingOrInvalid');
    if (urlRepository && repository && urlRepository.toLowerCase() !== repository.toLowerCase()) reasons.push('githubRepositoryMismatch');
    if (!/^[a-f0-9]{40}$/u.test(commitSha)) reasons.push('githubCommitShaMissingOrNotFull');
    if (!sourcePath) reasons.push('githubSourcePathMissingOrInvalid');
    if (!licenseEvidenceRef) reasons.push('githubLicenseEvidenceMissing');
    if (!/^[a-f0-9]{64}$/u.test(declaredLicenseEvidenceSha256)) reasons.push('githubLicenseEvidenceHashMissingOrNotFull');
    const evidenceRoot = String(options.evidenceRoot || options.resourceRoot || '').trim();
    licenseEvidence = evidenceRoot && licenseEvidenceRef && /^[a-f0-9]{64}$/u.test(declaredLicenseEvidenceSha256)
      ? verifyLocalEvidenceReference(licenseEvidenceRef, declaredLicenseEvidenceSha256, evidenceRoot)
      : {
        verified: false,
        resolvedPath: '',
        sha256: '',
        reason: evidenceRoot ? 'githubLicenseEvidenceUnverified' : 'evidenceRootMissing'
      };
    if (!licenseEvidence.verified || licenseEvidence.sha256 !== declaredLicenseEvidenceSha256) reasons.push('githubLicenseEvidenceUnverified');
  }

  return {
    verified: reasons.length === 0,
    platform,
    inferredPlatform,
    sourceUrl,
    platformWorkId,
    repository,
    sourcePath,
    commitSha,
    licenseEvidenceRef,
    licenseEvidenceSha256: licenseEvidence.sha256 || declaredLicenseEvidenceSha256,
    licenseEvidenceVerified: licenseEvidence.verified === true,
    ranking: {
      ...ranking,
      evidenceSha256: rankingEvidence.sha256 || ranking.evidenceSha256 || '',
      evidenceVerified: requireRankingEvidence && (platform === '七猫' || platform === '番茄' || platform === '起点')
        ? rankingEvidence.verified === true
        : ranking.evidenceVerified === true
    },
    rankingEvidence,
    catalogSnapshot: snapshot,
    licenseEvidence,
    reasons: [...new Set(reasons)]
  };
}

/** 判断一条授权元数据是否足以让原书进入可用归档，拒绝只有口头声明的记录。
 * 参数：value 为授权元数据；policy 为 quota-config.json 的授权策略。
 * 返回值：包含 usable、缺失字段、过期状态和规范化授权对象的审计结果。
 */
export function evaluateAuthorization(value, policy = {}) {
  const authorization = normalizeAuthorization(value);
  if (policy.requiredForArchiveUse === false) {
    return { usable: true, reason: 'authorization_not_required', missingFields: [], expired: false, authorization };
  }
  const fields = Array.isArray(policy.evidenceFields) && policy.evidenceFields.length
    ? [...policy.evidenceFields]
    : ['authorization.status', 'authorization.scope', 'authorization.evidenceRef'];
  const values = {
    'authorization.status': authorization.status,
    'authorization.scope': authorization.scope,
    'authorization.evidenceRef': authorization.evidenceRef,
    'authorization.evidenceSha256': authorization.evidenceSha256,
    'authorization.evidenceVerified': authorization.evidenceVerified ? 'true' : '',
    'authorization.rightsHolder': authorization.rightsHolder,
    'authorization.license': authorization.license,
    'authorization.archiveUseAllowed': authorization.archiveUseAllowed ? 'true' : '',
    'authorization.modelProcessingAllowed': authorization.modelProcessingAllowed ? 'true' : '',
    'authorization.runtimeUseAllowed': authorization.runtimeUseAllowed ? 'true' : '',
    'authorization.redistributionAllowed': authorization.redistributionAllowed ? 'true' : ''
  };
  const requiredPermissions = Array.isArray(policy.requiredPermissions)
    ? policy.requiredPermissions.map(value => String(value || '').trim()).filter(Boolean)
    : [];
  for (const permission of requiredPermissions) {
    const field = permission.startsWith('authorization.') ? permission : `authorization.${permission}`;
    if (!Object.prototype.hasOwnProperty.call(values, field)) values[field] = '';
    fields.push(field);
  }
  if (policy.requireVerifiedEvidence === true) fields.push('authorization.evidenceVerified');
  const missingFields = [...new Set(fields)].filter(field => !String(values[field] || '').trim());
  const allowedStatuses = Array.isArray(policy.allowedStatuses) && policy.allowedStatuses.length
    ? policy.allowedStatuses.map(item => String(item || '').trim().toLowerCase()).filter(Boolean)
    : ['licensed', 'public_domain', 'open_license', 'cc0', 'cc_by', 'cc_by_sa'];
  const status = authorization.status.toLowerCase();
  const statusAccepted = !status || allowedStatuses.includes(status) ? true : false;
  const requiredScope = String(policy.requiredScope || '').trim().toLowerCase();
  const scopeAccepted = !requiredScope || authorization.scope.toLowerCase() === requiredScope;
  const negativeStatus = /未授权|未许可|无授权|unknown|unverified|pending|denied|revoked|expired/iu.test(authorization.status);
  const expiryTimestamp = authorization.expiresAt ? Date.parse(authorization.expiresAt) : NaN;
  const invalidExpiry = !!authorization.expiresAt && !Number.isFinite(expiryTimestamp);
  const expired = Number.isFinite(expiryTimestamp) && expiryTimestamp < Date.now();
  const usable = missingFields.length === 0
    && statusAccepted
    && scopeAccepted
    && !negativeStatus
    && !invalidExpiry
    && !expired;
  return {
    usable,
    reason: usable ? 'verified'
      : invalidExpiry ? 'authorization_expiry_invalid'
        : expired ? 'authorization_expired'
          : negativeStatus || !statusAccepted || !scopeAccepted ? 'authorization_status_rejected'
            : 'authorization_evidence_missing',
    missingFields,
    statusAccepted,
    scopeAccepted,
    allowedStatuses,
    requiredScope,
    invalidExpiry,
    expired,
    authorization
  };
}

/**
 * 把一条来源记录整理成可跨章节复用的作品元数据。
 * 参数：source 为来源清单中的作品记录。
 * 返回值：统一的作品 ID、题材、平台和状态对象。
 */
export function normalizeSourceRecord(source) {
  const item = source && typeof source === 'object' ? source : {};
  const rawSourceUrl = item.url || item.source_url || item.sourceUrl || '';
  const sourceUrl = canonicalizeSourceUrl(rawSourceUrl);
  const platform = normalizePlatform(item.platform || platformFromSourceUrl(sourceUrl));
  const explicitPlatformWorkId = String(item.platformWorkId || item.platform_work_id || item.platformBookId || item.platform_book_id || '').trim();
  const platformWorkId = explicitPlatformWorkId || platformWorkIdFromUrl(sourceUrl, platform);
  const novelId = item.novelid == null
    ? sourceNovelIdFromUrl(sourceUrl) || (['七猫', '番茄', '起点'].includes(platform) ? platformWorkId : '')
    : String(item.novelid);
  const genres = splitRawGenres([...(Array.isArray(item.genres) ? item.genres : []), item.genre].filter(Boolean).join('、'));
  const explicitPrimaryGenre = String(item.primaryGenre || item.primary_genre || '').trim();
  const completionStatus = normalizeCompletionStatus(item.completionStatus || item.completion_status || item.work_status);
  const explicitSourceWorkId = String(item.sourceWorkId || item.source_work_id || '').trim();
  const chapters = Array.isArray(item.chapters) ? item.chapters : [];
  const sourceWorkId = explicitSourceWorkId
    || (novelId ? `novel-${novelId}` : `source-${corpusTextHash(sourceUrl || item.work_title || item.candidate_title)}`);
  const explicitCanonicalWorkId = String(item.canonicalWorkId || item.canonical_work_id || '').trim();
  return {
    sourceRecordId: String(item.id || item.source_id || '').trim(),
    sourceWorkId,
    canonicalWorkId: explicitCanonicalWorkId || sourceWorkId,
    canonicalWorkIdExplicit: Boolean(explicitCanonicalWorkId),
    sourceNovelId: novelId,
    title: String(item.work_title || item.candidate_title || '').replace(/^《|》$/gu, '').trim(),
    author: String(item.author || '').trim(),
    sourceUrl: canonicalizeSourceUrl(sourceUrl),
    genres,
    primaryGenre: explicitPrimaryGenre || (genres.length === 1 ? genres[0] : ''),
    audience: normalizeAudience(item.audience || item.targetAudience || item.target_audience),
    platform,
    platformWorkId: platformWorkId || String(item.novelid || '').trim(),
    sourceKind: String(item.source_kind || item.sourceKind || '').trim(),
    repository: String(item.repo || item.repository || '').trim(),
    sourcePath: String(item.path || item.sourcePath || '').trim(),
    commitSha: String(item.commitSha || item.commit_sha || item.commit || '').trim().toLowerCase(),
    licenseEvidenceRef: String(item.licenseEvidenceRef || item.license_evidence_ref || '').trim(),
    licenseEvidenceSha256: String(item.licenseEvidenceSha256 || item.license_evidence_sha256 || '').trim().toLowerCase(),
    licenseEvidenceVerified: item.licenseEvidenceVerified === true || item.license_evidence_verified === true,
    platformMetadataVerified: item.platformMetadataVerified === true || item.platform_metadata_verified === true,
    platformMetadataReasons: Array.isArray(item.platformMetadataReasons)
      ? item.platformMetadataReasons.map(value => String(value || '').trim()).filter(Boolean)
      : Array.isArray(item.platform_metadata_reasons)
        ? item.platform_metadata_reasons.map(value => String(value || '').trim()).filter(Boolean)
        : [],
    ranking: normalizeRanking(item),
    authorization: normalizeAuthorization(item),
    completionStatus,
    completionEvidenceRef: String(item.completionEvidenceRef || item.completion_evidence_ref || '').trim(),
    completionEvidenceVerified: item.completionEvidenceVerified === true || item.completion_evidence_verified === true,
    completionObservedAt: String(item.completionObservedAt || item.completion_observed_at || '').trim(),
    contentScope: normalizeContentScope(item.contentScope || item.content_scope || ''),
    fullWorkEvidenceRef: String(item.fullWorkEvidenceRef || item.full_work_evidence_ref || '').trim(),
    fullWorkEvidenceVerified: item.fullWorkEvidenceVerified === true || item.full_work_evidence_verified === true,
    expectedChapterCount: Number.isFinite(Number(item.expectedChapterCount || item.expected_chapter_count || item.totalChapterCount || chapters.length))
      ? Number(item.expectedChapterCount || item.expected_chapter_count || item.totalChapterCount || chapters.length)
      : 0,
    fetchedChapterCount: Number.isFinite(Number(item.fetchedChapterCount || item.fetched_chapter_count || item.chapterCount || chapters.length))
      ? Number(item.fetchedChapterCount || item.fetched_chapter_count || item.chapterCount || chapters.length)
      : 0,
    chapterCountDeclared: item.chapterCountDeclared === true || item.chapter_count_declared === true,
    chapterCoverage: Number.isFinite(Number(item.chapterCoverage ?? item.chapter_coverage))
      ? Number(item.chapterCoverage ?? item.chapter_coverage)
      : null,
    partial: item.partial === true,
    quality: item.quality && typeof item.quality === 'object' ? item.quality : null,
    totalChars: Number.isFinite(Number(item.totalChars || item.sample_chars)) ? Number(item.totalChars || item.sample_chars) : 0,
    chapterCount: Number.isFinite(Number(item.chapterCount || item.chapter_count)) ? Number(item.chapterCount || item.chapter_count) : 0,
    contentHash: String(item.contentHash || item.content_hash || item.sample_sha256 || (chapters.length ? corpusTextHash(chapters.map(chapter => String(chapter?.text || '')).join('\n')) : '')).trim(),
    status: String(item.status || '').trim(),
    chapters
  };
}

/**
 * 建立目录 URL、章节 URL和作品 ID到来源元数据的统一查找表。
 * 参数：sourceList 为来源清单对象或来源记录数组。
 * 返回值：Map，键为规范化 URL或 `novel:<id>`。
 */
export function buildSourceLookup(sourceList) {
  const rows = Array.isArray(sourceList) ? sourceList : sourceList?.sources;
  const lookup = new Map();
  for (const source of Array.isArray(rows) ? rows : []) {
    const info = normalizeSourceRecord(source);
    const register = value => {
      const key = canonicalizeSourceUrl(value);
      if (!key || lookup.get(key) === null) return;
      if (!lookup.has(key)) {
        lookup.set(key, info);
      } else if (lookup.get(key)?.sourceWorkId !== info.sourceWorkId) {
        lookup.set(key, null);
      }
    };
    register(source.url || source.source_url || source.sourceUrl);
    for (const chapter of info.chapters) register(chapter && chapter.url);
    if (info.sourceNovelId) {
      const key = `novel:${info.sourceNovelId}`;
      if (!lookup.has(key)) lookup.set(key, info);
      else if (lookup.get(key)?.sourceWorkId !== info.sourceWorkId) lookup.set(key, null);
    }
  }
  return lookup;
}

/**
 * 将素材行补齐为带作品 ID、原题材和平台的规范记录。
 * 参数：row 为 Markdown 样本；lookup 为 buildSourceLookup 返回的查找表。
 * 返回值：保留原字段并附加来源规范字段的新对象。
 */
export function enrichCorpusRow(row, lookup) {
  const source = row && typeof row === 'object' ? row : {};
  const url = canonicalizeSourceUrl(source.sourceUrl);
  const byUrl = lookup?.get(url);
  const novelId = sourceNovelIdFromUrl(url);
  const byNovel = novelId ? lookup?.get(`novel:${novelId}`) : null;
  const info = byUrl || byNovel || null;
  const rawGenres = [...new Set([...splitRawGenres(source.genre), ...(info?.genres || [])])];
  const sourceWorkId = info?.sourceWorkId
    || (novelId ? `novel-${novelId}` : String(source.sourceWorkId || '').trim())
    || `unresolved-${corpusTextHash(`${source.title}|${source.author}|${url}`)}`;
  const canonicalWorkId = info?.canonicalWorkId
    || String(source.canonicalWorkId || source.canonical_work_id || '').trim()
    || sourceWorkId;
  return {
    ...source,
    sourceUrl: url || String(source.sourceUrl || ''),
    sourceWorkId,
    canonicalWorkId,
    canonicalWorkIdExplicit: info?.canonicalWorkIdExplicit === true
      || Boolean(String(source.canonicalWorkId || source.canonical_work_id || '').trim()),
    sourceNovelId: info?.sourceNovelId || novelId || '',
    author: source.author || info?.author || '',
    rawGenres,
    primaryGenre: String(source.primaryGenre || info?.primaryGenre || (rawGenres.length === 1 ? rawGenres[0] : '')).trim(),
    audience: normalizeAudience(source.audience || info?.audience || ''),
    platform: info?.platform || normalizePlatform(platformFromSourceUrl(url)),
    platformWorkId: source.platformWorkId || info?.platformWorkId || '',
    sourceKind: info?.sourceKind || '',
    repository: source.repository || info?.repository || '',
    sourcePath: source.sourcePath || info?.sourcePath || '',
    commitSha: source.commitSha || info?.commitSha || '',
    licenseEvidenceRef: source.licenseEvidenceRef || info?.licenseEvidenceRef || '',
    licenseEvidenceSha256: source.licenseEvidenceSha256 || info?.licenseEvidenceSha256 || '',
    licenseEvidenceVerified: source.licenseEvidenceVerified === true || info?.licenseEvidenceVerified === true,
    platformMetadataVerified: source.platformMetadataVerified === true || info?.platformMetadataVerified === true,
    platformMetadataReasons: [...new Set([
      ...(Array.isArray(source.platformMetadataReasons) ? source.platformMetadataReasons : []),
      ...(Array.isArray(info?.platformMetadataReasons) ? info.platformMetadataReasons : [])
    ].map(value => String(value || '').trim()).filter(Boolean))],
    ranking: source.ranking || info?.ranking || {},
    authorization: info?.authorization || {},
    completionStatus: normalizeCompletionStatus(source.completionStatus || info?.completionStatus || ''),
    completionEvidenceRef: source.completionEvidenceRef || info?.completionEvidenceRef || '',
    completionEvidenceVerified: source.completionEvidenceVerified === true || info?.completionEvidenceVerified === true,
    completionObservedAt: source.completionObservedAt || info?.completionObservedAt || '',
    contentScope: normalizeContentScope(source.contentScope || info?.contentScope || ''),
    fullWorkEvidenceRef: source.fullWorkEvidenceRef || info?.fullWorkEvidenceRef || '',
    fullWorkEvidenceVerified: source.fullWorkEvidenceVerified === true || info?.fullWorkEvidenceVerified === true,
    expectedChapterCount: Number(source.expectedChapterCount || info?.expectedChapterCount || 0),
    fetchedChapterCount: Number(source.fetchedChapterCount || info?.fetchedChapterCount || 0),
    chapterCoverage: Number.isFinite(Number(source.chapterCoverage ?? info?.chapterCoverage))
      ? Number(source.chapterCoverage ?? info?.chapterCoverage)
      : null,
    partial: source.partial === true || info?.partial === true,
    quality: source.quality || info?.quality || null,
    sourceContentHash: source.sourceContentHash || info?.contentHash || '',
    sourceStatus: info?.status || ''
  };
}

/**
 * 根据唯一主归属选择聚合题材桶，缺少主归属时才按优先级保守回退。
 * 参数：genres 为原题材数组；config 为包含 sourceBucketMap 和 genreBuckets 的配置；primaryGenre 为作品主归属。
 * 返回值：主桶名称；主归属未映射或没有可映射题材时返回空字符串。
 */
export function primaryGenreBucket(genres, config, primaryGenre = '') {
  const values = canonicalizeRawGenres(genres, config);
  const explicitPrimary = canonicalizeRawGenre(primaryGenre, config);
  if (explicitPrimary) {
    const primaryBucket = config?.sourceBucketMap?.[explicitPrimary];
    return typeof primaryBucket === 'string' ? primaryBucket : '';
  }
  const priorities = Array.isArray(config?.bucketPriority) ? config.bucketPriority : Object.keys(config?.genreBuckets || {});
  for (const bucket of priorities) {
    if (values.some(genre => config?.sourceBucketMap?.[genre] === bucket)) return bucket;
  }
  return '';
}

/** 将原题材解析为原书归档组，未配置的原题材默认进入独立 raw 目录。
 * 参数：genre 为原题材或市场别名；config 为配额配置。
 * 返回值：归档组相对目录名；无法识别题材时返回空字符串。
 */
export function archiveGroupForGenre(genre, config = {}) {
  const canonical = canonicalizeRawGenre(genre, config);
  if (!canonical) return '';
  const configured = config?.archiveGroupMap && typeof config.archiveGroupMap === 'object'
    ? String(config.archiveGroupMap[canonical] || '').trim()
    : '';
  if (configured) return configured.replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, '');
  const bucket = String(config?.sourceBucketMap?.[canonical] || '').trim();
  if (bucket) return bucket;
  return `raw/${canonical}`;
}

/**
 * 规范化作品标题，供来源清单和原书 manifest 做保守归并。
 * 参数：value 为作品标题或文件归一化标题。
 * 返回值：去除书名包装、编号和空白后的标题。
 */
function normalizeCoverageTitle(value) {
  return String(value || '')
    .replace(/^《|》$/gu, '')
    .replace(/^\d+[-_]/u, '')
    .replace(/[【\[].*?(搜|笔趣|www\.).*?[】\]]/giu, '')
    .replace(/\s*[(（][^)]*(?:章|卷|部)[^)]*[)）]\s*$/u, '')
    .replace(/\s+/gu, '')
    .trim();
}

/**
 * 统计来源清单、已出现素材和原书归档在每个原题材下的数量，避免把成功来源误当成已入库作品。
 * 参数：sourceList 为来源清单；config 为配额配置；rows 为已规范化素材行；archiveManifest 为原书 manifest，可选。
 * 返回值：包含来源、素材和可用原书三层口径的原题材覆盖报告。
 */
export function calculateRawGenreCoverage(sourceList, config, rows = [], archiveManifest = null) {
  const sourceRows = Array.isArray(sourceList) ? sourceList : sourceList?.sources;
  const allSources = Array.isArray(sourceRows) ? sourceRows : [];
  const successful = allSources.filter(item => String(item?.status || '').toLowerCase() === 'ok');
  const normalizeCoverageInfo = value => {
    const info = normalizeSourceRecord(value);
    return {
      ...info,
      genres: canonicalizeRawGenres(info.genres, config || {}),
      primaryGenre: canonicalizeRawGenre(info.primaryGenre, config || {})
    };
  };
  const sourceInfos = allSources.map(normalizeCoverageInfo);
  const successfulInfos = successful.map(normalizeCoverageInfo);
  const sourceByNovelId = new Map();
  const sourceByUrl = new Map();
  for (const info of sourceInfos) {
    for (const [map, key] of [[sourceByNovelId, info.sourceNovelId], [sourceByUrl, info.sourceUrl]]) {
      if (!key) continue;
      if (!map.has(key)) map.set(key, info);
      else if (map.get(key) !== null && map.get(key)?.sourceWorkId !== info.sourceWorkId) map.set(key, null);
    }
  }
  const sourceByTitle = new Map();
  for (const info of sourceInfos.filter(item => item.title)) {
    const key = normalizeCoverageTitle(info.title);
    if (!sourceByTitle.has(key)) sourceByTitle.set(key, info);
    else if (sourceByTitle.get(key) !== null && sourceByTitle.get(key)?.sourceWorkId !== info.sourceWorkId) sourceByTitle.set(key, null);
  }
  const archives = Array.isArray(archiveManifest?.books) ? archiveManifest.books : [];
  const archiveAttribution = archives.map(book => {
    const parts = Array.isArray(book.parts) ? book.parts : [];
    const sourceNovelId = String(book.sourceNovelId || parts.find(part => part.sourceNovelId)?.sourceNovelId || '');
    const sourceUrl = canonicalizeSourceUrl(book.sourceUrl || parts.find(part => part.sourceUrl)?.sourceUrl || '');
    const title = normalizeCoverageTitle(book.title || '');
    const source = (sourceNovelId && sourceByNovelId.get(sourceNovelId))
      || (sourceUrl && sourceByUrl.get(sourceUrl))
      || (title && sourceByTitle.get(title))
      || null;
    const rawGenres = canonicalizeRawGenres([
      ...(Array.isArray(book.rawGenres) ? book.rawGenres : []),
      ...parts.flatMap(part => Array.isArray(part.rawGenres) ? part.rawGenres : []),
      ...(source?.genres || [])
    ], config || {});
    const primaryGenre = canonicalizeRawGenre(
      book.primaryGenre || parts.find(part => part.primaryGenre)?.primaryGenre || source?.primaryGenre || (rawGenres.length === 1 ? rawGenres[0] : ''),
      config || {}
    );
    const authorization = Object.keys(book.authorization || {}).length
      ? book.authorization
      : source?.authorization || {};
    const archiveEligibility = evaluateArchiveRecord({
      ...book,
      authorization,
      rawGenres,
      primaryGenre
    }, config || {});
    const fallbackKey = book.canonicalWorkId
      || parts.find(part => part.canonicalWorkId)?.canonicalWorkId
      || source?.canonicalWorkId
      || source?.sourceWorkId
      || sourceNovelId
      || sourceUrl
      || `${title}|${String(book.author || '').trim()}`;
    const key = String(
      book.canonicalWorkId
        || parts.find(part => part.canonicalWorkId)?.canonicalWorkId
        || source?.canonicalWorkId
        || book.sourceWorkId
        || source?.sourceWorkId
        || sourceNovelId
        || sourceUrl
        || fallbackKey
        || `archive-${corpusTextHash(title)}`
    ).trim();
    return {
      key,
      rawGenres,
      primaryGenre,
      usable: archiveEligibility.usable,
      attributed: !!source,
      authorizationCheck: archiveEligibility.authorization,
      eligibility: archiveEligibility
    };
  });
  const usableArchiveWorks = new Set(archiveAttribution.filter(item => item.usable).map(item => item.key));
  const genreNames = Array.isArray(config?.rawGenres)
    ? config.rawGenres
    : [...new Set(Object.keys(config?.sourceBucketMap || {}))];
  const rawGenreCountMode = ['tagged', 'primary', 'primary-or-explicit'].includes(config?.rawGenreCountMode)
    ? config.rawGenreCountMode
    : 'tagged';
  const isCountedGenre = (genres, primaryGenre, genre) => {
    const values = canonicalizeRawGenres(genres, config || {});
    const primary = canonicalizeRawGenre(primaryGenre, config || {});
    if (rawGenreCountMode === 'tagged') return values.includes(genre);
    if (primary === genre) return true;
    return rawGenreCountMode === 'primary-or-explicit' && values.length === 1 && values[0] === genre;
  };
  const minimumSampleChars = Math.max(0, Number(config?.rawGenreMinimumSampleChars || 0));
  const minimumSampleWorks = Math.max(0, Number(config?.rawGenreMinimumSampleWorks || 0));
  const minimumSampleCount = Math.max(0, Number(config?.rawGenreMinimumSampleCount || 0));
  const byGenre = {};
  for (const genre of genreNames) {
    const sourceIds = new Set();
    const primarySourceIds = new Set();
    for (const info of successfulInfos) {
      if (info.genres.includes(genre)) sourceIds.add(logicalWorkId(info, info.sourceWorkId));
      if (info.primaryGenre === genre) primarySourceIds.add(logicalWorkId(info, info.sourceWorkId));
    }
    const materialIds = new Set((Array.isArray(rows) ? rows : [])
      .filter(row => canonicalizeRawGenres(row.rawGenres || splitRawGenres(row.genre), config || {}).includes(genre))
      .map(row => logicalWorkId(row, row.sourceUrl || `${row.title}|${row.author}`)));
    const primaryMaterialIds = new Set((Array.isArray(rows) ? rows : [])
      .filter(row => canonicalizeRawGenre(row.primaryGenre, config || {}) === genre)
      .map(row => logicalWorkId(row, row.sourceUrl || `${row.title}|${row.author}`)));
    const archived = archiveAttribution.filter(item => item.rawGenres.includes(genre));
    const archivedIds = new Set(archived.map(item => item.key));
    const usableArchivedIds = new Set(archived.filter(item => item.usable).map(item => item.key));
    const primaryArchivedIds = new Set(archived.filter(item => item.primaryGenre === genre).map(item => item.key));
    const primaryUsableArchivedIds = new Set(archived.filter(item => item.primaryGenre === genre && item.usable).map(item => item.key));
    const unverifiedArchivedIds = new Set(archived.filter(item => !item.authorizationCheck.usable).map(item => item.key));
    const sampleCharsByKey = new Map();
    const countedSampleCharsByKey = new Map();
    const sampleWorks = new Set();
    const countedSampleWorks = new Set();
    for (const row of Array.isArray(rows) ? rows : []) {
      const rawGenres = canonicalizeRawGenres(row.rawGenres || splitRawGenres(row.genre), config || {});
      if (!rawGenres.includes(genre)) continue;
      const workId = logicalWorkId(row, row.sourceUrl || `${row.title}|${row.author}`);
      const text = normalizeCorpusText(row.text || '');
      const sampleKey = `${workId}|${corpusTextHash(text)}`;
      if (!sampleCharsByKey.has(sampleKey)) sampleCharsByKey.set(sampleKey, countCorpusChars(text));
      sampleWorks.add(workId);
      if (isCountedGenre(rawGenres, row.primaryGenre, genre)) {
        if (!countedSampleCharsByKey.has(sampleKey)) countedSampleCharsByKey.set(sampleKey, countCorpusChars(text));
        countedSampleWorks.add(workId);
      }
    }
    const sampleChars = [...sampleCharsByKey.values()].reduce((sum, value) => sum + value, 0);
    const countedSampleChars = [...countedSampleCharsByKey.values()].reduce((sum, value) => sum + value, 0);
    const sampleCount = sampleCharsByKey.size;
    const countedSampleCount = countedSampleCharsByKey.size;
    const sampleStatus = countedSampleChars >= minimumSampleChars
      && countedSampleWorks.size >= minimumSampleWorks
      && countedSampleCount >= minimumSampleCount
      ? 'met'
      : 'gap';
    const targetBooks = Number(config?.rawGenreTargetBooks || 20);
    const countedSourceBooks = rawGenreCountMode === 'tagged'
      ? sourceIds
      : new Set(successfulInfos
        .filter(info => isCountedGenre(info.genres, info.primaryGenre, genre))
        .map(info => logicalWorkId(info, info.sourceWorkId)));
    const countedMaterialBooks = rawGenreCountMode === 'tagged'
      ? materialIds
      : new Set((Array.isArray(rows) ? rows : [])
        .filter(row => isCountedGenre(row.rawGenres || splitRawGenres(row.genre), row.primaryGenre, genre))
        .map(row => logicalWorkId(row, row.sourceUrl || `${row.title}|${row.author}`)));
    const countedArchiveItems = archived.filter(item => isCountedGenre(item.rawGenres, item.primaryGenre, genre));
    const countedArchiveBooks = new Set(countedArchiveItems.filter(item => item.usable).map(item => item.key));
    const materialBookStatus = countedMaterialBooks.size >= targetBooks ? 'met' : 'gap';
    const archiveStatus = !Array.isArray(archiveManifest?.books)
      ? 'unverified'
      : countedArchiveBooks.size >= targetBooks ? 'met' : 'gap';
    const status = config?.rawGenreRequiresUsableArchive === false
      ? materialBookStatus === 'met' && sampleStatus === 'met' ? 'met' : 'gap'
      : archiveStatus === 'met' && sampleStatus === 'met' ? 'met' : 'gap';
    byGenre[genre] = {
      targetBooks,
      successfulBooks: sourceIds.size,
      taggedSuccessfulBooks: sourceIds.size,
      primarySuccessfulBooks: primarySourceIds.size,
      countedSuccessfulBooks: countedSourceBooks.size,
      materializedBooks: materialIds.size,
      taggedMaterializedBooks: materialIds.size,
      primaryMaterializedBooks: primaryMaterialIds.size,
      countedMaterializedBooks: countedMaterialBooks.size,
      archivedBooks: archivedIds.size,
      primaryArchivedBooks: primaryArchivedIds.size,
      usableArchivedBooks: usableArchivedIds.size,
      primaryUsableArchivedBooks: primaryUsableArchivedIds.size,
      unverifiedArchivedBooks: unverifiedArchivedIds.size,
      countedUsableArchivedBooks: countedArchiveBooks.size,
      sourceGapBooks: Math.max(0, targetBooks - sourceIds.size),
      materializedGapBooks: Math.max(0, targetBooks - countedMaterialBooks.size),
      archiveGapBooks: Math.max(0, targetBooks - countedArchiveBooks.size),
      gapBooks: Math.max(0, targetBooks - (config?.rawGenreRequiresUsableArchive === false ? countedMaterialBooks.size : countedArchiveBooks.size)),
      materialStatus: materialBookStatus,
      archiveStatus,
      sampleChars,
      sampleCount,
      sampleWorkCount: sampleWorks.size,
      countedSampleChars,
      countedSampleCount,
      countedSampleWorkCount: countedSampleWorks.size,
      minimumSampleChars,
      minimumSampleWorks,
      minimumSampleCount,
      sampleStatus,
      countMode: rawGenreCountMode,
      distinctPrimaryRequired: config?.rawGenreRequiresDistinctPrimary === true,
      status
    };
  }
  return {
    targetBooks: Number(config?.rawGenreTargetBooks || 20),
    successfulSourceCount: successful.length,
    uniqueSuccessfulBooks: new Set(successfulInfos.map(info => logicalWorkId(info, info.sourceWorkId))).size,
    archiveManifestAvailable: Array.isArray(archiveManifest?.books),
    archiveBookCount: archives.length,
    usableArchiveBookCount: usableArchiveWorks.size,
    uniqueUsableArchiveWorkCount: usableArchiveWorks.size,
    unattributedArchiveBookCount: archiveAttribution.filter(item => !item.attributed).length,
    rawGenreMinimumSampleChars: minimumSampleChars,
    rawGenreMinimumSampleWorks: minimumSampleWorks,
    rawGenreMinimumSampleCount: minimumSampleCount,
    rawGenreCountMode,
    distinctPrimaryRequired: config?.rawGenreRequiresDistinctPrimary === true,
    minimumUniqueWorksRequired: Number(config?.uniqueUsableBookTarget || 0),
    overlapAllowed: rawGenreCountMode !== 'primary',
    byGenre
  };
}

/**
 * 为样本生成统一的跨维度去重键，允许同书同句只计一次但保留不同作品。
 * 参数：row 为已规范化样本行；text 为用于比较的清洗文本。
 * 返回值：稳定的去重键字符串。
 */
export function corpusSampleKey(row, text) {
  return [row?.archetype || '', logicalWorkId(row, row?.sourceUrl || `${row?.title || ''}|${row?.author || ''}`), corpusTextHash(text)].join('|');
}
