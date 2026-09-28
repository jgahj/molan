import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { pathToFileURL } from 'node:url';
import {
  detectFanfiction,
  detectForumLike,
  detectIncomplete,
  splitChapters
} from './build-manifest.mjs';
import {
  archiveGroupForGenre,
  canonicalizeRawGenre,
  canonicalizeRawGenres,
  canonicalizeSourceUrl,
  chapterIdsMatchInOrder,
  corpusTextHash,
  corpusTextSha256,
  normalizeAudience,
  normalizeAuthorization,
  normalizeCompletionStatus,
  normalizeContentScope,
  normalizePlatform,
  normalizeRanking,
  platformFromSourceUrl,
  platformWorkIdFromUrl,
  sourceNovelIdFromUrl,
  splitRawGenres,
  validatePlatformMetadata,
  verifyLocalEvidenceReference
} from './corpus-utils.mjs';

const RESOURCE_ROOT = path.resolve(import.meta.dirname, '..');
const ARCHIVE_ROOT = path.join(RESOURCE_ROOT, '小说原本');
const CONFIG_PATH = path.join(RESOURCE_ROOT, 'quota-config.json');
const BLOCKLIST_PATH = path.join(RESOURCE_ROOT, 'ip-blocklist.json');
const METADATA_ROOT = path.join(RESOURCE_ROOT, '.fetch-metadata');
const DEFAULT_DELAY_MS = 2000;
const REQUEST_TIMEOUT_MS = 35000;
const USER_AGENT = 'AuthorizedCharacterCorpus/2.0 (+local licensed research)';
const PLATFORM_ADAPTERS = Object.freeze({
  '七猫': {
    id: 'qimao-html-v1',
    catalogUrlPattern: /(?:qimao|7mao|\/shuku\/|[?&](?:chapterid|chapter_id|cid)=|\/chapter\/|\/read\/)/iu,
    catalogChapterPattern: /(?:第\s*[0-9零一二三四五六七八九十百千万两〇○]+\s*[章节回卷集部篇]|番外|序章|chapter|chapterid|chapter_id|\/chapter\/|\/read\/|\/shuku\/[^/?#]+[-_][^/?#]+)/iu,
    bodyPatterns: [
      /class=["'][^"']*(?:txtBox|chapter-content|read-content|article-content)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|article)>/iu,
      /id=["'](?:chaptercontent|content)["'][^>]*>([\s\S]*?)<\/div>/iu
    ]
  },
  '番茄': {
    id: 'fanqie-html-v1',
    catalogUrlPattern: /(?:fanqienovel|\/reader\/|\/chapter\/|[?&](?:chapterid|chapter_id|item_id)=)/iu,
    catalogChapterPattern: /(?:第\s*[0-9零一二三四五六七八九十百千万两〇○]+\s*[章节回卷集部篇]|番外|序章|chapter|reader|\/reader\/|\/chapter\/|item_id)/iu,
    bodyPatterns: [
      /class=["'][^"']*(?:muye-reader-content|reader-content|chapter-content|article-content)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|article)>/iu,
      /id=["'](?:article-content|content|chaptercontent)["'][^>]*>([\s\S]*?)<\/div>/iu
    ]
  },
  '起点': {
    id: 'qidian-html-v1',
    catalogUrlPattern: /(?:qidian|\/chapter\/|\/read\/|[?&](?:chapterid|chapter_id|chapter)=)/iu,
    catalogChapterPattern: /(?:第\s*[0-9零一二三四五六七八九十百千万两〇○]+\s*[章节回卷集部篇]|番外|序章|chapter|read|\/chapter\/|\/read\/)/iu,
    bodyPatterns: [
      /class=["'][^"']*(?:j_readContent|read-content|chapter-content|read-content-wrap)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|article)>/iu,
      /id=["'](?:content|chaptercontent|j_readContent)["'][^>]*>([\s\S]*?)<\/div>/iu
    ]
  }
});

/** 读取 JSON 配置并在失败时提供文件路径。
 * 参数：filePath 为 JSON 文件路径。
 * 返回值：解析后的 JSON 对象。
 */
function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取 JSON：${filePath}；${error.message}`);
  }
}

/** 解析单书抓取命令行参数并强制执行题材桶和请求间隔约束。
 * 参数：argv 为 process.argv.slice(2)。
 * 返回值：包含 URL、桶、书名和抓取限制的选项对象。
 */
function readOptions(argv) {
  const options = {
    url: '',
    bucket: '',
    title: '',
    author: '',
    sourceWorkId: '',
    canonicalWorkId: '',
    platform: '',
    platformWorkId: '',
    repository: '',
    sourcePath: '',
    commitSha: '',
    licenseEvidenceRef: '',
    licenseEvidenceSha256: '',
    genres: [],
    primaryGenre: '',
    audience: '',
    completionStatus: '',
    completionEvidenceRef: '',
    completionEvidenceSha256: '',
    authorization: {
      status: '', scope: '', evidenceRef: '', evidenceSha256: '', evidenceVerified: false,
      expiresAt: '', rightsHolder: '', license: '', archiveUseAllowed: false,
      modelProcessingAllowed: false, redistributionAllowed: false, runtimeUseAllowed: false
    },
    contentScope: 'full_work',
    fullWorkEvidenceRef: '',
    fullWorkEvidenceSha256: '',
    catalogEvidenceRef: '',
    catalogEvidenceSha256: '',
    ranking: { rank: 0, rankType: '', rankMetric: '', rankCapturedAt: '', rankEvidenceRef: '', rankEvidenceSha256: '' },
    expectedChapterCount: 0,
    chapterCountDeclared: false,
    delayMs: DEFAULT_DELAY_MS,
    maxChapters: 0,
    allowOverwrite: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--url') options.url = argv[++index] || '';
    else if (arg === '--bucket') options.bucket = argv[++index] || '';
    else if (arg === '--title') options.title = argv[++index] || '';
    else if (arg === '--author') options.author = String(argv[++index] || '').trim();
    else if (arg === '--source-work-id') options.sourceWorkId = String(argv[++index] || '').trim();
    else if (arg === '--canonical-work-id') options.canonicalWorkId = String(argv[++index] || '').trim();
    else if (arg === '--platform') options.platform = String(argv[++index] || '').trim();
    else if (arg === '--platform-work-id') options.platformWorkId = String(argv[++index] || '').trim();
    else if (arg === '--repository' || arg === '--github-repository') options.repository = String(argv[++index] || '').trim();
    else if (arg === '--source-path') options.sourcePath = String(argv[++index] || '').trim();
    else if (arg === '--commit-sha') options.commitSha = String(argv[++index] || '').trim().toLowerCase();
    else if (arg === '--license-evidence') options.licenseEvidenceRef = String(argv[++index] || '').trim();
    else if (arg === '--license-evidence-sha256') options.licenseEvidenceSha256 = String(argv[++index] || '').trim().toLowerCase();
    else if (arg === '--genres' || arg === '--genre') options.genres = splitRawGenres(argv[++index] || '');
    else if (arg === '--primary-genre') options.primaryGenre = String(argv[++index] || '').trim();
    else if (arg === '--audience') options.audience = normalizeAudience(argv[++index] || '');
    else if (arg === '--completion-status') options.completionStatus = normalizeCompletionStatus(argv[++index] || '');
    else if (arg === '--completion-evidence') options.completionEvidenceRef = String(argv[++index] || '').trim();
    else if (arg === '--completion-evidence-sha256') options.completionEvidenceSha256 = String(argv[++index] || '').trim().toLowerCase();
    else if (arg === '--full-work-evidence') options.fullWorkEvidenceRef = String(argv[++index] || '').trim();
    else if (arg === '--full-work-evidence-sha256') options.fullWorkEvidenceSha256 = String(argv[++index] || '').trim().toLowerCase();
    else if (arg === '--catalog-evidence') options.catalogEvidenceRef = String(argv[++index] || '').trim();
    else if (arg === '--catalog-evidence-sha256') options.catalogEvidenceSha256 = String(argv[++index] || '').trim().toLowerCase();
    else if (arg === '--rank') options.ranking.rank = Number(argv[++index]);
    else if (arg === '--rank-type') options.ranking.rankType = String(argv[++index] || '').trim();
    else if (arg === '--rank-metric') options.ranking.rankMetric = String(argv[++index] || '').trim();
    else if (arg === '--rank-captured-at') options.ranking.rankCapturedAt = String(argv[++index] || '').trim();
    else if (arg === '--rank-evidence') options.ranking.rankEvidenceRef = String(argv[++index] || '').trim();
    else if (arg === '--rank-evidence-sha256') options.ranking.rankEvidenceSha256 = String(argv[++index] || '').trim().toLowerCase();
    else if (arg === '--authorization-status') options.authorization.status = String(argv[++index] || '').trim();
    else if (arg === '--authorization-scope') options.authorization.scope = String(argv[++index] || '').trim();
    else if (arg === '--authorization-evidence') options.authorization.evidenceRef = String(argv[++index] || '').trim();
    else if (arg === '--authorization-evidence-sha256') options.authorization.evidenceSha256 = String(argv[++index] || '').trim().toLowerCase();
    else if (arg === '--authorization-rights-holder') options.authorization.rightsHolder = String(argv[++index] || '').trim();
    else if (arg === '--authorization-license') options.authorization.license = String(argv[++index] || '').trim();
    else if (arg === '--authorization-archive-use') options.authorization.archiveUseAllowed = true;
    else if (arg === '--authorization-model-processing') options.authorization.modelProcessingAllowed = true;
    else if (arg === '--authorization-runtime-use') options.authorization.runtimeUseAllowed = true;
    else if (arg === '--authorization-redistribution') options.authorization.redistributionAllowed = true;
    else if (arg === '--authorization-expires') options.authorization.expiresAt = String(argv[++index] || '').trim();
    else if (arg === '--content-scope') options.contentScope = normalizeContentScope(argv[++index] || '');
    else if (arg === '--expected-chapters') {
      const count = Number(argv[++index]);
      if (!Number.isInteger(count) || count < 0) throw new Error('--expected-chapters 必须是非负整数');
      options.expectedChapterCount = count;
      options.chapterCountDeclared = count > 0;
    }
    else if (arg === '--delay') {
      const seconds = Number(argv[++index]);
      if (!Number.isFinite(seconds)) throw new Error('--delay 必须是数字');
      options.delayMs = Math.round(seconds * 1000);
    } else if (arg === '--max-chapters') {
      const count = Number(argv[++index]);
      if (!Number.isInteger(count) || count < 0) throw new Error('--max-chapters 必须是非负整数');
      options.maxChapters = count;
    } else if (arg === '--allow-overwrite') options.allowOverwrite = true;
  }
  if (!options.url || !options.bucket || !options.title) throw new Error('用法：node fetch-novel.mjs --url <目录页URL> --bucket <题材桶> --title <书名>');
  if (options.delayMs < DEFAULT_DELAY_MS) throw new Error('为遵守抓取频率约束，--delay 不得小于 2 秒');
  if (!options.genres.length) throw new Error('必须通过 --genres 提供至少一个原题材');
  if (options.genres.length > 1 && !options.primaryGenre) throw new Error('多题材作品必须通过 --primary-genre 指定唯一主归属题材');
  if (options.contentScope === 'unknown') throw new Error('--content-scope 必须是 full_work 或 partial');
  return options;
}

/** 对文件名进行安全规整，防止书名中的路径字符改变落盘位置。
 * 参数：value 为用户提供的书名。
 * 返回值：安全的 TXT 文件基名。
 */
function safeFileName(value) {
  const result = String(value || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim();
  return (result || '未命名作品').slice(0, 160);
}

/** 根据来源 URL和显式参数生成来源作品 ID及逻辑作品 ID。
 * 参数：options 为抓取命令选项；sourceUrl 为目录页最终 URL。
 * 返回值：规范化来源 URL、来源作品 ID、逻辑作品 ID和 URL作品 ID。
 */
function resolveFetchIdentity(options, sourceUrl) {
  const normalizedUrl = canonicalizeSourceUrl(sourceUrl || options.url);
  const platform = normalizePlatform(options.platform || platformFromSourceUrl(normalizedUrl || options.url));
  const platformWorkId = String(options.platformWorkId || '').trim()
    || platformWorkIdFromUrl(normalizedUrl || options.url, platform);
  const sourceNovelId = sourceNovelIdFromUrl(normalizedUrl || options.url)
    || (['七猫', '番茄', '起点'].includes(platform) ? platformWorkId : '')
    || null;
  const sourceWorkId = options.sourceWorkId
    || (sourceNovelId ? `novel-${sourceNovelId}` : `source-${sha256(normalizedUrl || options.url || options.title).slice(0, 16)}`);
  return {
    sourceUrl: normalizedUrl || String(sourceUrl || options.url || '').trim(),
    platform,
    platformWorkId,
    sourceNovelId,
    sourceWorkId,
    canonicalWorkId: options.canonicalWorkId || sourceWorkId
  };
}

/** 为单个来源生成带身份哈希的归档路径，避免同名作品或不同来源互相覆盖。
 * 参数：bucket 为运行时题材桶；title 为作品标题；sourceWorkId 为来源作品 ID。
 * 返回值：资源库内的归档相对路径。
 */
function buildArchiveRelativePath(bucket, title, sourceWorkId) {
  const identityHash = sha256(`${bucket}|${sourceWorkId}`).slice(0, 12);
  return path.join('小说原本', bucket, `${safeFileName(title)}--${identityHash}.txt`).replace(/\\/g, '/');
}

/** 检查归档文件是否可以写入，默认拒绝不同内容覆盖既有文件。
 * 参数：filePath 为目标路径；buffer 为待写入内容；allowOverwrite 为显式覆盖开关。
 * 返回值：created、reused 或 overwritten，覆盖冲突时抛出错误。
 */
function checkArchiveWrite(filePath, buffer, allowOverwrite = false) {
  if (!fs.existsSync(filePath)) return 'created';
  const existingHash = sha256(fs.readFileSync(filePath));
  const nextHash = sha256(buffer);
  if (existingHash === nextHash) return 'reused';
  if (!allowOverwrite) throw new Error(`拒绝覆盖已有不同内容的归档：${filePath}；如确认替换，请显式传入 --allow-overwrite`);
  return 'overwritten';
}

/** 创建按站点隔离的请求节流器，确保同一站点请求间隔达到最低值。
 * 参数：delayMs 为两次请求之间的最小毫秒数。
 * 返回值：包含 wait 方法和请求时间状态的对象。
 */
function createRateLimiter(delayMs) {
  const lastRequest = new Map();
  return {
    async wait(url) {
      const host = new URL(url).host;
      const previous = lastRequest.get(host) || 0;
      const waitMs = Math.max(0, delayMs - (Date.now() - previous));
      if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
      lastRequest.set(host, Date.now());
    }
  };
}

/** 按响应头字符集解码公开网页，兼容 UTF-8 与常见中文网页编码。
 * 参数：buffer 为网页二进制内容，contentType 为响应 Content-Type。
 * 返回值：解码后的字符串。
 */
function decodeResponse(buffer, contentType = '') {
  const charset = (String(contentType).match(/charset\s*=\s*([\w-]+)/i) || [])[1] || 'utf-8';
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch (_) {
    return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  }
}

/** 抓取一个公开页面，失败时最多额外重试三次并保留最后错误。
 * 参数：url 为公开页面 URL，limiter 为 createRateLimiter 返回的节流器。
 * 返回值：包含文本、最终 URL和响应头的对象。
 */
async function fetchPublicPage(url, limiter) {
  let lastError = null;
  for (let attempt = 0; attempt <= 3; attempt += 1) {
    await limiter.wait(url);
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,text/plain' },
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      return { text: decodeResponse(buffer, response.headers.get('content-type') || ''), url: response.url || url };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, Math.max(2000, 1500 * (attempt + 1))));
    }
  }
  throw new Error(`公开页面抓取失败：${url}；${lastError?.message || '未知错误'}`);
}

/** 解码 HTML 实体并把段落、换行标签还原为普通文本。
 * 参数：value 为 HTML 片段。
 * 返回值：去除标签后的文本。
 */
function decodeHtml(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' };
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (_, name) => named[name.toLowerCase()] ?? `&${name};`);
}

/** 从章节 URL 提取稳定的章节 ID，无法识别时返回空字符串。
 * 参数：value 为章节链接 URL；fallbackIndex 为目录中的零基序号。
 * 返回值：平台章节 ID或带 URL 前缀的保守身份。
 */
function chapterIdentity(value, fallbackIndex = 0) {
  try {
    const url = new URL(String(value || ''));
    const queryId = ['chapterid', 'chapterId', 'chapter_id', 'chapter', 'contentid', 'contentId', 'id']
      .map(key => url.searchParams.get(key))
      .find(item => item != null && String(item).trim() !== '');
    if (queryId) return String(queryId).trim();
    const pathId = url.pathname.match(/(?:chapter|chap|read|content|section)[/_-]([^/_?#-]+)$/iu);
    if (pathId?.[1]) return decodeURIComponent(pathId[1]).trim();
    return `url:${canonicalizeSourceUrl(url.href) || url.href || fallbackIndex}`;
  } catch (_) {
    return `index:${fallbackIndex}`;
  }
}

/** 对目录章节身份做去重和一致性检查，避免重复链接虚增全文覆盖率。
 * 参数：links 为目录解析得到的章节链接数组。
 * 返回值：包含有序章节 ID、重复 ID 和目录快照哈希的对象。
 */
function buildCatalogSnapshot(links, sourceUrl) {
  const values = Array.isArray(links) ? links : [];
  const chapterIds = values.map((link, index) => String(link.chapterId || chapterIdentity(link.url, index)).trim());
  const seen = new Set();
  const duplicateChapterIds = [];
  for (const id of chapterIds) {
    if (seen.has(id)) duplicateChapterIds.push(id);
    seen.add(id);
  }
  const snapshot = {
    sourceUrl: canonicalizeSourceUrl(sourceUrl),
    capturedAt: new Date().toISOString(),
    chapterCount: chapterIds.length,
    chapterIds,
    chapters: values.map((link, index) => ({
      chapterId: chapterIds[index],
      title: String(link.title || '').trim(),
      url: canonicalizeSourceUrl(link.url)
    }))
  };
  return {
    ...snapshot,
    duplicateChapterIds: [...new Set(duplicateChapterIds)],
    snapshotSha256: corpusTextSha256(JSON.stringify(snapshot))
  };
}

/** 按指定匹配规则从目录 HTML 提取章节链接，保留解析策略供质量报告审计。
 * 参数：html 为目录页 HTML；baseUrl 为目录页最终 URL；matcher 为平台链接匹配函数。
 * 返回值：按页面顺序返回章节链接数组。
 */
function parseChapterLinksWithMatcher(html, baseUrl, matcher) {
  const result = [];
  const seen = new Set();
  const source = String(html || '');
  const add = (href, title) => {
    if (!href) return;
    try {
      const url = new URL(decodeHtml(href), baseUrl).href;
      const cleanTitle = decodeHtml(title).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (!matcher(url, cleanTitle)) return;
      if (seen.has(url)) return;
      seen.add(url);
      result.push({
        url,
        chapterId: chapterIdentity(url, result.length),
        title: cleanTitle
      });
    } catch (_) {}
  };
  const anchorPattern = /<a\b[^>]*?(?:href|data-url)\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(source))) add(match[1], match[2]);
  const clickPattern = /(?:clickchapterid|chapterid)\s*=\s*["']?(\d+)/gi;
  while ((match = clickPattern.exec(source))) {
    try {
      const url = new URL(baseUrl);
      url.searchParams.set('chapterid', match[1]);
      add(url.href, `第${match[1]}章`);
    } catch (_) {}
  }
  return result;
}

/** 从常见目录 HTML 中提取章节链接和标题，兼容旧来源和未知平台。
 * 参数：html 为目录页 HTML；baseUrl 为目录页最终 URL。
 * 返回值：按页面顺序返回章节链接数组。
 */
function parseChapterLinks(html, baseUrl) {
  return parseChapterLinksWithMatcher(
    html,
    baseUrl,
    (url, title) => /(?:chapter|chap|read|content|noveltext|onebook)/iu.test(url) || /(?:第\s*[0-9零一二三四五六七八九十百千万两〇○]+\s*[章节回卷集部篇]|番外|序章)/iu.test(title)
  );
}

/** 按七猫、番茄或起点的独立 URL 规则提取目录，并明确记录适配器版本。
 * 参数：html 为目录页 HTML；baseUrl 为目录页最终 URL；platform 为规范化平台名。
 * 返回值：章节链接、适配器 ID、解析策略和是否使用通用回退。
 */
function parseChapterLinksForPlatform(html, baseUrl, platform) {
  const normalized = normalizePlatform(platform);
  const adapter = PLATFORM_ADAPTERS[normalized];
  if (!adapter) {
    return {
      links: parseChapterLinks(html, baseUrl),
      adapterId: 'generic-html-v1',
      catalogStrategy: 'generic-html',
      fallbackUsed: true
    };
  }
  const links = parseChapterLinksWithMatcher(html, baseUrl, (url, title) => (
    adapter.catalogUrlPattern.test(url) && adapter.catalogChapterPattern.test(`${url} ${title}`)
  ));
  return {
    links,
    adapterId: adapter.id,
    catalogStrategy: `${adapter.id}:catalog`,
    fallbackUsed: false
  };
}

/** 清洗章节 HTML 片段并清除脚本、样式、标签和站点广告行。
 * 参数：html 为章节页 HTML。
 * 返回值：清洗后的章节正文。
 */
function cleanChapterBodyFragment(html) {
  return decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/giu, '')
    .replace(/<style[\s\S]*?<\/style>/giu, '')
    .replace(/<br\s*\/?>(?=.)/giu, '\n')
    .replace(/<\/p\s*>/giu, '\n')
    .replace(/<[^>]+>/gu, '')
    .replace(/\u00a0/gu, ' ')
    .split(/\r?\n/u)
    .map(line => line.replace(/[ \t]+/gu, ' ').trim())
    .filter(line => line && !/笔趣阁|搜笔趣阁|www\./iu.test(line))
    .join('\n')
    .trim();
}

/** 提取通用章节正文并清除脚本、样式、HTML 标签和站点广告行。
 * 参数：html 为章节页 HTML。
 * 返回值：清洗后的章节正文。
 */
function extractChapterBody(html) {
  const patterns = [
    /id=["']paragraph_comment_content["'][^>]*>([\s\S]*?)<\/div>/i,
    /class=["'][^"']*noveltext[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /id=["']chaptercontent["'][^>]*>([\s\S]*?)<\/div>/i,
    /id=["']content["'][^>]*>([\s\S]*?)<\/div>/i
  ];
  let fragment = '';
  for (const pattern of patterns) {
    const match = String(html || '').match(pattern);
    if (match) {
      fragment = match[1];
      break;
    }
  }
  if (!fragment) return '';
  return cleanChapterBodyFragment(fragment);
}

/** 优先使用平台正文容器，失败时才使用通用正文提取并标记回退。
 * 参数：html 为章节页 HTML；platform 为规范化平台名。
 * 返回值：正文、正文解析策略和是否使用通用回退。
 */
function extractChapterBodyForPlatform(html, platform) {
  const adapter = PLATFORM_ADAPTERS[normalizePlatform(platform)];
  if (adapter) {
    for (const pattern of adapter.bodyPatterns) {
      const match = String(html || '').match(pattern);
      if (match?.[1]) {
        return {
          text: cleanChapterBodyFragment(match[1]),
          bodyStrategy: `${adapter.id}:body`,
          fallbackUsed: false
        };
      }
    }
  }
  return {
    text: extractChapterBody(html),
    bodyStrategy: adapter ? 'generic-html-fallback' : 'generic-html',
    fallbackUsed: Boolean(adapter)
  };
}

/** 将 GitHub 固定 commit 的单文件原文拆成章节，构造无章节 URL 的目录快照。
 * 参数：text 为固定版本文件正文；sourceUrl 为 raw GitHub 文件 URL。
 * 返回值：章节数组、目录快照和 GitHub 文件适配器审计信息。
 */
function parseGitHubFileWork(text, sourceUrl) {
  const source = String(text || '').replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
  const units = splitChapters(source);
  const chapters = units.map((unit, index) => {
    const raw = source.slice(unit.start, unit.end);
    const body = unit.title === '全文' ? raw : raw.replace(/^[^\n]*(?:\n|$)/u, '');
    return {
      title: unit.title || `第${index + 1}章`,
      chapterId: `github:${index + 1}:${corpusTextHash(unit.title || `chapter-${index + 1}`)}`,
      url: canonicalizeSourceUrl(sourceUrl),
      text: body.trim()
    };
  }).filter(chapter => chapter.text.replace(/\s/gu, '').length >= 80);
  const catalogSnapshot = buildCatalogSnapshot(chapters, sourceUrl);
  return {
    chapters,
    catalogSnapshot,
    adapterId: 'github-file-v1',
    catalogStrategy: 'github-fixed-commit-file',
    bodyStrategy: 'github-plain-text',
    fallbackUsed: false
  };
}

/** 把章节标题和正文拼成便于后续拆章的原书存档文本。
 * 参数：chapters 为包含 title、url 和 text 的章节数组。
 * 返回值：带章节标题和统一换行的完整文本。
 */
function renderArchive(chapters) {
  return chapters.map((chapter, index) => {
    const title = chapter.title || `第${index + 1}章`;
    return `${title}\n${chapter.text}`.trim();
  }).filter(Boolean).join('\n\n');
}

/** 执行三道抓取质量门禁并汇总可审计的判定原因。
 * 参数：text 为拼接后的清洗正文，chapters 为抓取章节，config 为配额配置，blocklist 为 IP 配置，options.partial 表示限章抓取。
 * 返回值：质量对象和是否排除的布尔值。
 */
function runQualityGates(text, chapters, config, blocklist, options = {}) {
  const fanfiction = detectFanfiction(text, blocklist);
  const forum = detectForumLike(text, config);
  const integrity = detectIncomplete(chapters.map(chapter => ({ ...chapter, chars: chapter.text.replace(/\s/g, '').length })), config);
  const completionStatus = normalizeCompletionStatus(options.completionStatus || '');
  const contentScope = normalizeContentScope(options.contentScope || (options.partial ? 'partial' : 'full_work'));
  const catalogSnapshot = options.catalogSnapshot && typeof options.catalogSnapshot === 'object'
    ? options.catalogSnapshot
    : null;
  const catalogIds = (catalogSnapshot?.chapterIds || []).map(value => String(value || '').trim()).filter(Boolean);
  const fetchedIds = (Array.isArray(chapters) ? chapters : [])
    .map((chapter, index) => String(chapter?.chapterId || chapterIdentity(chapter?.url, index)).trim())
    .filter(Boolean);
  const explicitExpectedChapterCount = Number(options.expectedChapterCount || 0);
  const expectedChapterCount = explicitExpectedChapterCount || catalogIds.length || chapters.length || 0;
  const fetchedChapterCount = fetchedIds.length || Number(options.fetchedChapterCount || chapters.length || 0);
  const chapterCoverage = expectedChapterCount > 0 ? fetchedChapterCount / expectedChapterCount : null;
  const expectedCountMatchesCatalog = explicitExpectedChapterCount <= 0
    || catalogIds.length === 0
    || explicitExpectedChapterCount === catalogIds.length;
  const missingChapterIds = catalogIds.filter(id => !fetchedIds.includes(id));
  const duplicateCatalogIds = Array.isArray(catalogSnapshot?.duplicateChapterIds) ? catalogSnapshot.duplicateChapterIds : [];
  const chapterOrderMatches = chapterIdsMatchInOrder(catalogIds, fetchedIds);
  const chapterSetMatches = catalogIds.length > 0
    && duplicateCatalogIds.length === 0
    && missingChapterIds.length === 0
    && fetchedIds.length === catalogIds.length
    && (config.requireChapterOrderEvidence !== true || chapterOrderMatches);
  const catalogEvidenceVerified = config.requireChapterSetEvidence !== true
    || (options.catalogEvidenceVerified !== false && Boolean(catalogSnapshot?.snapshotSha256) && chapterSetMatches);
  const completionEvidenceVerified = config.requireCompletionEvidenceVerification !== true
    || options.completionEvidenceVerified === true;
  const fullWorkEvidenceVerified = config.requireFullWorkEvidence !== true
    || options.fullWorkEvidenceVerified === true;
  const hasVerifiedChapterCoverage = expectedChapterCount > 0
    && fetchedChapterCount > 0
    && chapterCoverage !== null
    && chapterCoverage >= 1
    && (config.requireChapterSetEvidence !== true ? true : catalogEvidenceVerified);
  const chapterCountEvidenceVerified = config.requireDeclaredChapterCount !== true
    || options.chapterCountDeclared === true
    || catalogEvidenceVerified;
  const reasons = [];
  if (fanfiction.isFanfiction) reasons.push('isFanfiction');
  if (forum.forumLike) reasons.push('forumLike');
  if (integrity.incomplete) reasons.push('incomplete');
  if (options.partial === true) reasons.push('partial');
  if (config.requireCompletedWork === true && completionStatus !== 'completed') reasons.push('completionUnverified');
  if (config.requireCompletionEvidence === true && !String(options.completionEvidenceRef || '').trim()) reasons.push('completionEvidenceMissing');
  if (config.requireCompletionEvidenceVerification === true && !completionEvidenceVerified) reasons.push('completionEvidenceUnverified');
  if (config.requireFullWorkEvidence === true && !fullWorkEvidenceVerified) reasons.push('fullWorkEvidenceUnverified');
  if (config.requireFullWork === true && (contentScope !== 'full_work' || !hasVerifiedChapterCoverage)) reasons.push('fullWorkUnverified');
  if (config.requireFullWork === true && !chapterCountEvidenceVerified) reasons.push('chapterCountEvidenceMissing');
  if (config.requireChapterSetEvidence === true && !catalogEvidenceVerified) reasons.push('chapterSetEvidenceUnverified');
  if (config.requireChapterOrderEvidence === true && catalogIds.length > 0 && !chapterOrderMatches) reasons.push('chapterOrderMismatch');
  if (!expectedCountMatchesCatalog) reasons.push('expectedChapterCountMismatch');
  return {
    isFanfiction: fanfiction.isFanfiction,
    forumLike: forum.forumLike,
    incomplete: integrity.incomplete,
    partial: options.partial === true,
    completionStatus,
    completionVerified: completionStatus === 'completed',
    completionEvidenceVerified: config.requireCompletionEvidence !== true
      ? true
      : Boolean(String(options.completionEvidenceRef || '').trim()) && completionEvidenceVerified,
    contentScope,
    fullWorkEvidenceRef: String(options.fullWorkEvidenceRef || '').trim(),
    fullWorkEvidenceVerified,
    chapterCountDeclared: options.chapterCountDeclared === true,
    chapterCountEvidenceVerified,
    expectedChapterCount,
    fetchedChapterCount,
    chapterCoverage,
    expectedCountMatchesCatalog,
    catalogSnapshot,
    catalogEvidenceVerified,
    catalogChapterCount: catalogIds.length,
    fetchedChapterIdCount: fetchedIds.length,
    missingChapterIds,
    duplicateCatalogIds,
    chapterSetMatches,
    chapterOrderMatches,
    hasVerifiedChapterCoverage,
    fullWorkVerified: config.requireFullWork !== true
      || (contentScope === 'full_work' && hasVerifiedChapterCoverage && chapterCountEvidenceVerified && fullWorkEvidenceVerified),
    reasons,
    fanfictionHits: fanfiction.hits,
    forumMetrics: forum,
    integrity
  };
}

/** 写入单书抓取元数据，供 manifest 重建时合并来源时间和质量信息。
 * 参数：record 为抓取结果记录。
 * 返回值：写入的 sidecar 文件路径。
 */
function writeFetchMetadata(record) {
  fs.mkdirSync(METADATA_ROOT, { recursive: true });
  const id = crypto.createHash('sha256').update(`${record.sourceWorkId || ''}|${record.sourceUrl || ''}|${record.filePath || ''}`).digest('hex').slice(0, 16);
  const filePath = path.join(METADATA_ROOT, `${id}.json`);
  if (fs.existsSync(filePath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (existing?.filePath !== record.filePath || existing?.contentHash !== record.contentHash) {
        if (!record.allowOverwrite) throw new Error(`拒绝覆盖已有不同内容的抓取 sidecar：${filePath}；如确认替换，请显式传入 --allow-overwrite`);
      }
    } catch (error) {
      if (error.message.startsWith('拒绝覆盖')) throw error;
    }
  }
  fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return filePath;
}

/** 校验资源库内证据文件，并在生产配置下强制要求完整 SHA-256。
 * 参数：reference 为证据文件相对路径；expectedHash 为命令行声明的哈希；config 为配额配置。
 * 返回值：包含 verified、sha256 和 reason 的证据校验结果。
 */
function verifyEvidence(reference, expectedHash, config) {
  const expected = String(expectedHash || '').trim().toLowerCase();
  if (config.requireFullSha256 === true && !/^[a-f0-9]{64}$/u.test(expected)) {
    return { verified: false, resolvedPath: '', sha256: '', reason: 'evidence_hash_not_full' };
  }
  return verifyLocalEvidenceReference(reference, expected, RESOURCE_ROOT);
}

/** 抓取一本公开目录书并在质量门禁通过后落盘，不自动填充虚构来源信息。
 * 参数：options 为 readOptions 返回的抓取选项。
 * 返回值：抓取结果记录。
 */
async function fetchNovel(options) {
  const config = readJson(CONFIG_PATH);
  const blocklist = readJson(BLOCKLIST_PATH);
  options.genres = canonicalizeRawGenres(options.genres, config);
  options.primaryGenre = canonicalizeRawGenre(options.primaryGenre || (options.genres.length === 1 ? options.genres[0] : ''), config);
  if (!options.genres.length) throw new Error('归一化后没有可用原题材');
  if (options.primaryGenre && !options.genres.includes(options.primaryGenre)) throw new Error('--primary-genre 必须包含在归一化后的 --genres 中');
  if (options.genres.length > 1 && !options.primaryGenre) throw new Error('多题材作品必须通过 --primary-genre 指定唯一主归属题材');
  const configuredArchiveGroups = [
    ...Object.keys(config.genreBuckets || {}),
    ...Object.values(config.archiveGroupMap || {})
  ].map(value => String(value || '').trim()).filter(Boolean);
  if (!configuredArchiveGroups.includes(options.bucket)) throw new Error(`未知原书归档组：${options.bucket}`);
  const expectedArchiveGroup = archiveGroupForGenre(options.primaryGenre || options.genres[0], config);
  if (expectedArchiveGroup && expectedArchiveGroup !== options.bucket) {
    throw new Error(`归档组与主归属题材不一致：${options.primaryGenre || options.genres[0]} 应归入 ${expectedArchiveGroup}`);
  }
  const limiter = createRateLimiter(options.delayMs);
  const requestedPlatform = normalizePlatform(options.platform || platformFromSourceUrl(options.url));
  const directory = await fetchPublicPage(options.url, limiter);
  const identity = resolveFetchIdentity(options, directory.url || options.url);
  let chapters = [];
  let catalogSnapshot;
  let parserAudit;
  let bodyFallbackCount = 0;
  let links = [];
  if (identity.platform === 'GitHub' || requestedPlatform === 'GitHub') {
    const parsedFile = parseGitHubFileWork(directory.text, directory.url || options.url);
    catalogSnapshot = parsedFile.catalogSnapshot;
    chapters = options.maxChapters > 0 ? parsedFile.chapters.slice(0, options.maxChapters) : parsedFile.chapters;
    parserAudit = {
      adapterId: parsedFile.adapterId,
      catalogStrategy: parsedFile.catalogStrategy,
      bodyStrategy: parsedFile.bodyStrategy,
      fallbackUsed: parsedFile.fallbackUsed
    };
  } else {
    const parsedCatalog = parseChapterLinksForPlatform(directory.text, directory.url, identity.platform);
    links = parsedCatalog.links;
    catalogSnapshot = buildCatalogSnapshot(links, directory.url);
    if (options.maxChapters > 0) links = links.slice(0, options.maxChapters);
    if (!links.length) throw new Error(`${parsedCatalog.adapterId} 未发现可访问章节链接`);
    const bodyStrategies = new Set();
    for (const link of links) {
      const page = await fetchPublicPage(link.url, limiter);
      const body = extractChapterBodyForPlatform(page.text, identity.platform);
      bodyStrategies.add(body.bodyStrategy);
      if (body.fallbackUsed) bodyFallbackCount += 1;
      if (body.text.replace(/\s/gu, '').length < 80) continue;
      chapters.push({ title: link.title, chapterId: link.chapterId, url: page.url, text: body.text });
    }
    parserAudit = {
      adapterId: parsedCatalog.adapterId,
      catalogStrategy: parsedCatalog.catalogStrategy,
      bodyStrategy: [...bodyStrategies].join(',') || 'none',
      fallbackUsed: parsedCatalog.fallbackUsed || bodyFallbackCount > 0
    };
  }
  const partial = options.maxChapters > 0 || options.contentScope === 'partial';
  const expectedChapterCount = options.expectedChapterCount > 0 ? options.expectedChapterCount : catalogSnapshot.chapterCount;
  if (!chapters.length) throw new Error('已发现作品内容，但没有提取到有效正文');
  const archiveText = renderArchive(chapters);
  const contentScope = partial ? 'partial' : options.contentScope;
  const authorizationInput = normalizeAuthorization(options.authorization);
  const authorizationEvidence = verifyEvidence(
    authorizationInput.evidenceRef,
    authorizationInput.evidenceSha256,
    config
  );
  const authorization = {
    ...authorizationInput,
    evidenceVerified: authorizationEvidence.verified,
    evidenceSha256: authorizationEvidence.sha256 || authorizationInput.evidenceSha256
  };
  const completionEvidence = verifyEvidence(options.completionEvidenceRef, options.completionEvidenceSha256, config);
  const fullWorkEvidence = verifyEvidence(options.fullWorkEvidenceRef, options.fullWorkEvidenceSha256, config);
  const catalogEvidence = options.catalogEvidenceRef
    ? verifyEvidence(options.catalogEvidenceRef, options.catalogEvidenceSha256, config)
    : { verified: true, resolvedPath: '', sha256: catalogSnapshot.snapshotSha256, reason: 'generated_from_directory_snapshot' };
  const chapterCountDeclared = catalogSnapshot.chapterCount > 0 && catalogSnapshot.duplicateChapterIds.length === 0;
  const quality = runQualityGates(archiveText, chapters, config, blocklist, {
    partial,
    completionStatus: options.completionStatus,
    completionEvidenceRef: options.completionEvidenceRef,
    completionEvidenceVerified: completionEvidence.verified,
    contentScope,
    fullWorkEvidenceRef: options.fullWorkEvidenceRef,
    fullWorkEvidenceVerified: fullWorkEvidence.verified,
    chapterCountDeclared,
    catalogSnapshot,
    catalogEvidenceVerified: catalogEvidence.verified,
    expectedChapterCount,
    fetchedChapterCount: chapters.length
  });
  quality.platformAdapter = parserAudit;
  quality.platformAdapterFallbackCount = bodyFallbackCount;
  const authorizationCheck = evaluateAuthorization(authorization, config.authorizationPolicy || {});
  if (!authorizationCheck.usable && !quality.reasons.includes('authorizationUnverified')) quality.reasons.push('authorizationUnverified');
  quality.authorizationVerified = authorizationCheck.usable;
  quality.authorizationReason = authorizationCheck.reason;
  quality.authorizationEvidenceMissingFields = authorizationCheck.missingFields;
  quality.authorizationEvidenceReason = authorizationEvidence.reason;
  quality.completionEvidenceReason = completionEvidence.reason;
  quality.fullWorkEvidenceReason = fullWorkEvidence.reason;
  quality.catalogEvidenceReason = catalogEvidence.reason;
  if (config.requireChapterSetEvidence === true && !catalogEvidence.verified && !quality.reasons.includes('catalogEvidenceUnverified')) {
    quality.reasons.push('catalogEvidenceUnverified');
  }
  const platformMetadata = validatePlatformMetadata({
    ...options,
    sourceUrl: identity.sourceUrl,
    platform: identity.platform,
    platformWorkId: options.platformWorkId || identity.platformWorkId,
    catalogSnapshot,
    ranking: options.ranking
  }, {
    evidenceRoot: RESOURCE_ROOT,
    requireRanking: true,
    requireRankingEvidence: config.requireRankingEvidence !== false
  });
  if (!platformMetadata.verified && !quality.reasons.includes('platformMetadataUnverified')) quality.reasons.push('platformMetadataUnverified');
  quality.platformMetadataVerified = platformMetadata.verified;
  quality.platformMetadataReasons = platformMetadata.reasons;
  const relativeFilePath = buildArchiveRelativePath(options.bucket, options.title, identity.sourceWorkId);
  const filePath = path.join(RESOURCE_ROOT, relativeFilePath);
  const buffer = Buffer.from(`${archiveText}\n`, 'utf8');
  const archiveAction = checkArchiveWrite(filePath, buffer, options.allowOverwrite);
  const record = {
    schemaVersion: 'fetch-result-3',
    title: options.title,
    author: options.author,
    bucket: options.bucket,
    archiveGroup: options.bucket,
    genreBucket: config.sourceBucketMap?.[options.primaryGenre] || null,
    sourceUrl: identity.sourceUrl,
    platform: platformMetadata.platform || identity.platform,
    platformWorkId: platformMetadata.platformWorkId || identity.platformWorkId,
    sourceWorkId: identity.sourceWorkId,
    canonicalWorkId: identity.canonicalWorkId,
    canonicalWorkIdExplicit: Boolean(options.canonicalWorkId),
    sourceNovelId: identity.sourceNovelId,
    sourceKind: platformMetadata.platform === 'GitHub' ? 'github' : 'platform',
    repository: platformMetadata.repository,
    sourcePath: platformMetadata.sourcePath,
    commitSha: platformMetadata.commitSha,
    licenseEvidenceRef: platformMetadata.licenseEvidenceRef,
    licenseEvidenceSha256: platformMetadata.licenseEvidenceSha256,
    licenseEvidenceVerified: platformMetadata.licenseEvidenceVerified,
    platformMetadataVerified: platformMetadata.verified,
    platformMetadataReasons: platformMetadata.reasons,
    rawGenres: options.genres,
    primaryGenre: options.primaryGenre || (options.genres.length === 1 ? options.genres[0] : ''),
    audience: options.audience,
    completionStatus: options.completionStatus,
    completionEvidenceRef: options.completionEvidenceRef,
    completionEvidenceVerified: completionEvidence.verified,
    completionEvidenceSha256: completionEvidence.sha256 || options.completionEvidenceSha256,
    completionObservedAt: options.completionStatus ? new Date().toISOString() : '',
    contentScope,
    fullWorkEvidenceRef: options.fullWorkEvidenceRef,
    fullWorkEvidenceVerified: fullWorkEvidence.verified,
    fullWorkEvidenceSha256: fullWorkEvidence.sha256 || options.fullWorkEvidenceSha256,
    catalogEvidenceRef: options.catalogEvidenceRef || '',
    catalogEvidenceSha256: catalogEvidence.sha256 || catalogSnapshot.snapshotSha256 || options.catalogEvidenceSha256,
    catalogSnapshot,
    ranking: platformMetadata.ranking,
    parser: parserAudit,
    chapterCountDeclared,
    expectedChapterCount,
    fetchedChapterCount: quality.fetchedChapterCount,
    chapterCoverage: quality.chapterCoverage,
    authorization,
    partial: quality.partial,
    fetchedAt: new Date().toISOString(),
    filePath: relativeFilePath,
    totalChars: archiveText.replace(/\s/g, '').length,
    chapterCount: chapters.length,
    chapters: chapters.map((chapter, index) => ({
      chapterIndex: index,
      chapterId: chapter.chapterId || chapterIdentity(chapter.url, index),
      title: chapter.title || `第${index + 1}章`,
      url: chapter.url,
      chars: chapter.text.replace(/\s/g, '').length,
      contentHash: sha256(Buffer.from(chapter.text, 'utf8'))
    })),
    contentHash: sha256(buffer),
    quality,
    excludeFromCorpus: quality.reasons.length > 0,
    contributedCells: [],
    archiveAction,
    allowOverwrite: options.allowOverwrite === true
  };
  // 门禁排除的正文仍留在私有归档，manifest 通过 excludeFromCorpus 阻止它进入语料库。
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (archiveAction !== 'reused') fs.writeFileSync(filePath, buffer);
  record.metadataPath = path.relative(RESOURCE_ROOT, writeFetchMetadata(record)).replace(/\\/g, '/');
  return record;
}

/** 生成 SHA-256 哈希，供 fetch sidecar 与 manifest 相互校验。
 * 参数：value 为 Buffer 或字符串。
 * 返回值：完整十六进制 SHA-256 字符串。
 */
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  fetchNovel(readOptions(process.argv.slice(2)))
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

export {
  readOptions,
  createRateLimiter,
  decodeResponse,
  parseChapterLinks,
  parseChapterLinksForPlatform,
  extractChapterBody,
  extractChapterBodyForPlatform,
  parseGitHubFileWork,
  renderArchive,
  runQualityGates,
  resolveFetchIdentity,
  buildArchiveRelativePath,
  checkArchiveWrite,
  writeFetchMetadata,
  fetchNovel
};
