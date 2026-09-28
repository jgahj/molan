import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import * as rich from '../lib/character-material-v31.mjs';
import {
  buildSourceRecord,
  inferArchetype,
  inferContext,
  inferHtl,
  walkTxtFiles,
} from './rebuild-character-material-from-original.mjs';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '..');
const RESOURCE_ROOT = path.resolve(REPOSITORY_ROOT, '..', '资源库');
const DEFAULT_ARCHIVE_ROOT = path.join(RESOURCE_ROOT, '小说原本');
const DEFAULT_MARKDOWN = path.join(RESOURCE_ROOT, '素材库.md');
const DEFAULT_INDEX = path.join(REPOSITORY_ROOT, 'lib', 'character-material', 'index.json');
const DEFAULT_REPORT = path.join(REPOSITORY_ROOT, 'data', 'character-material-raw-v3.1', 'quality-report.json');
const DEFAULT_JSONL = path.join(REPOSITORY_ROOT, 'data', 'character-material-raw-v3.1', 'samples.jsonl');

const CHAPTER_HEADER = /^(第\s*[0-9零一二三四五六七八九十百千万两〇○]+\s*[章节回卷集部篇节].*|番外.*|序章.*)$/gmu;
const MAX_SCAN_UNIT_CHARS = 80_000;
const SENSITIVE_PATTERN = /露骨|下身|阴茎|阴部|乳房|乳头|性交|做爱|高潮|插入|性器官|呻吟|床笫|媾合|肉棒|精液|裸身|裸体|春药|发情|淫靡|潮吹|奸淫/u;
const DIMENSIONS = ['appearance', 'expression', 'action', 'dialogue', 'catchphrase', 'psychology'];
const DIMENSION_LABELS = {
  appearance: '外貌',
  expression: '神态',
  action: '动作',
  dialogue: '语言',
  catchphrase: '口头禅',
  psychology: '心理',
};

function text(value) {
  return String(value ?? '');
}

function compactMeta(value) {
  return text(value).replace(/[\r\n]+/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function shortId(value) {
  return crypto.createHash('sha1').update(text(value), 'utf8').digest('hex').slice(0, 16);
}

function parseChapterNumber(title, fallback) {
  const match = text(title).match(/^第\s*(\d+)/u);
  return match ? Number(match[1]) : fallback;
}

function chunkRawRange(source, range, titlePrefix = range.title) {
  const chunks = [];
  let start = range.bodyStart;
  let part = 1;
  while (start < range.end) {
    let end = Math.min(range.end, start + MAX_SCAN_UNIT_CHARS);
    if (end < range.end) {
      const newline = source.lastIndexOf('\n', end);
      const punctuation = Math.max(
        source.lastIndexOf('。', end),
        source.lastIndexOf('！', end),
        source.lastIndexOf('？', end),
        source.lastIndexOf('；', end),
      );
      const boundary = Math.max(newline + 1, punctuation + 1);
      if (boundary > start + Math.floor(MAX_SCAN_UNIT_CHARS * 0.6)) end = boundary;
    }
    chunks.push({
      title: part === 1 && end === range.end ? titlePrefix : `${titlePrefix}（片段${part}）`,
      number: range.number,
      start,
      bodyStart: start,
      end,
    });
    start = end;
    part += 1;
  }
  return chunks;
}

/** Split a raw source string without normalizing it, so evidence offsets point to original characters. */
export function splitRawChapters(sourceText) {
  const source = text(sourceText);
  const matches = [];
  CHAPTER_HEADER.lastIndex = 0;
  let match;
  while ((match = CHAPTER_HEADER.exec(source)) !== null) {
    const title = match[0].replace(/\r$/u, '').trim();
    matches.push({
      title,
      start: match.index,
      headerEnd: match.index + match[0].length,
    });
  }
  if (!matches.length) {
    return chunkRawRange(source, { title: '全文', number: 1, start: 0, bodyStart: 0, end: source.length }, '全文');
  }
  return matches.flatMap((item, index) => {
    let bodyStart = item.headerEnd;
    while (bodyStart < source.length && (source[bodyStart] === '\r' || source[bodyStart] === '\n')) bodyStart += 1;
    return chunkRawRange(source, {
      title: item.title,
      number: parseChapterNumber(item.title, index + 1),
      start: item.start,
      bodyStart,
      end: index + 1 < matches.length ? matches[index + 1].start : source.length,
    }, item.title);
  });
}

function rawFence(rawText) {
  let longest = 0;
  for (const match of text(rawText).matchAll(/`+/gu)) longest = Math.max(longest, match[0].length);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text(rawText)}\n${fence}`;
}

function candidateScore(candidate, context, htl, rawText) {
  const length = rich.characterCount(rawText);
  const targetDistance = Math.abs(72 - length);
  const kindScore = (candidate.recallKinds || []).reduce((sum, kind) => sum + (kind === 'dialogue' ? 18 : kind === 'catchphrase' ? 16 : 8), 0);
  return Number((kindScore + htl.signals.length * 4 + context.scene.length * 2 + context.relationship.length * 2 + Math.max(0, 16 - targetDistance / 8)).toFixed(3));
}

function annotateRawCandidate(candidate, source, chapter, rawSource) {
  const start = Number(candidate.evidence?.charStart || 0);
  const end = Number(candidate.evidence?.charEnd || 0);
  const rawText = rawSource.slice(start, end);
  const normalized = rich.normalizeSampleText(rawText);
  const context = inferContext(normalized, candidate.dimension);
  const htl = inferHtl(normalized, candidate.dimension, context);
  const archetype = inferArchetype(normalized, candidate.dimension, source.sourceWorkId);
  const category = source.sourceFilePath.includes('/') ? source.category : '未分类';
  const id = `raw-${shortId(`${source.sourceWorkId}|${start}|${end}|${candidate.dimension}|${normalized}`)}`;
  return {
    id,
    rawText,
    normalizedText: normalized,
    dimension: candidate.dimension,
    secondaryDimensions: candidate.secondaryDimensions || [],
    recallKinds: candidate.recallKinds || [],
    archetype: archetype.primaryArchetype || '',
    archetypeConfidence: archetype.confidence || 0,
    scene: context.scene,
    relationship: context.relationship,
    emotionalState: context.emotionalState,
    surfaceIntent: context.surfaceIntent || '',
    subtext: context.subtext ? [context.subtext] : [],
    humanTextureSignals: htl.signals,
    score: candidateScore(candidate, context, htl, rawText),
    corpus: SENSITIVE_PATTERN.test(rawText) ? 'mature' : 'general',
    sourceWorkId: source.sourceWorkId,
    canonicalWorkId: source.canonicalWorkId,
    title: source.title,
    author: source.author,
    platform: source.platform,
    audience: source.audience,
    category,
    genre: source.primaryGenre,
    primaryGenre: source.primaryGenre,
    rawGenres: source.rawGenres,
    genreBucket: source.genreBucket,
    sourceFilePath: source.sourceFilePath,
    chapterIndex: chapter.number,
    chapterTitle: chapter.title,
    charStart: start,
    charEnd: end,
    sourceHash: shortId(`${source.sourceWorkId}|${start}|${end}|${rawText}`),
    forbiddenTerms: [],
    residualTerms: [],
  };
}

function dedupeCandidates(rows) {
  const byText = new Map();
  for (const row of rows) {
    const key = `${row.dimension}|${rich.canonicalizeText(row.normalizedText)}`;
    const current = byText.get(key);
    if (!current || row.score > current.score) byText.set(key, row);
  }
  return [...byText.values()];
}

/** Keep each work's strongest material while rotating dimensions for retrieval diversity. */
export function selectWorkCandidates(rows, limit) {
  const max = Math.max(1, Number(limit) || 120);
  const pools = new Map(DIMENSIONS.map(dimension => [dimension, rows.filter(row => row.dimension === dimension).sort(compareRows)]));
  const selected = [];
  while (selected.length < max) {
    let added = false;
    for (const dimension of DIMENSIONS) {
      const pool = pools.get(dimension);
      if (!pool || !pool.length || selected.length >= max) continue;
      selected.push(pool.shift());
      added = true;
    }
    if (!added) break;
  }
  const selectedIds = new Set(selected.map(row => row.id));
  return selected.concat(rows.filter(row => !selectedIds.has(row.id)).sort(compareRows)).slice(0, max);
}

function compareRows(left, right) {
  return right.score - left.score
    || rich.characterCount(right.rawText) - rich.characterCount(left.rawText)
    || left.charStart - right.charStart
    || left.id.localeCompare(right.id);
}

function repairSourceQuality(source, rawSource, chapters) {
  const current = source.quality || {};
  const filenamePartial = /[（(]\s*\d+\s*[-—至]\s*\d+\s*[章节卷部集篇回节]/u.test(path.basename(source.sourceFilePath));
  const chapterRows = chapters.map(chapter => ({
    title: chapter.title,
    chars: text(rawSource.slice(chapter.bodyStart, chapter.end)).replace(/\s/gu, '').length,
  }));
  const totalChars = chapterRows.reduce((sum, chapter) => sum + chapter.chars, 0);
  const meanChapterChars = chapterRows.length ? totalChars / chapterRows.length : 0;
  const reasons = (Array.isArray(current.reasons) ? current.reasons : [])
    .filter(reason => reason !== 'chapter_count_too_low' && reason !== 'partial_or_incomplete');
  if (chapterRows.length < 3) reasons.push('chapter_count_too_low');
  if (filenamePartial) reasons.push('partial_or_incomplete');
  const uniqueReasons = [...new Set(reasons)];
  source.quality = {
    ...current,
    status: uniqueReasons.length ? 'rejected' : 'admitted',
    eligibleForAdvancedAnalysis: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    characterCount: totalChars,
    chapterCount: chapterRows.length,
    chapters: chapterRows,
    meanChapterChars,
    partial: filenamePartial,
    missingChapterRanges: [],
    completionHeuristic: filenamePartial ? 'incomplete' : 'completed',
  };
  source.completionStatus = source.quality.completionHeuristic;
  source.contentScope = filenamePartial ? 'partial' : 'full_work';
  return source;
}

export function mineRawWork(source, rawSource, perWorkLimit = 120) {
  const chapters = splitRawChapters(rawSource);
  const rows = [];
  for (const chapter of chapters) {
    const body = rawSource.slice(chapter.bodyStart, chapter.end);
    if (!body.trim()) continue;
    const candidates = rich.candidateMine([{
      text: body,
      charOffset: chapter.bodyStart,
      chapterIndex: chapter.number,
      sourceWorkId: source.sourceWorkId,
    }], { sourceWorkId: source.sourceWorkId });
    for (const candidate of candidates) {
      const row = annotateRawCandidate(candidate, source, chapter, rawSource);
      const length = rich.characterCount(row.rawText);
      if (length < 12 || length > 140 || !row.rawText.trim()) continue;
      rows.push(row);
    }
  }
  return selectWorkCandidates(dedupeCandidates(rows), perWorkLimit).map(row => {
    const { normalizedText, ...kept } = row;
    return kept;
  });
}

function runtimeSample(row) {
  return {
    id: row.id,
    archetype: row.archetype,
    dimension: row.dimension,
    corpus: row.corpus,
    text: row.rawText,
    sourceHash: row.sourceHash,
    canonicalWorkId: row.canonicalWorkId,
    sourceWorkId: row.sourceWorkId,
    sourceNovelId: row.sourceWorkId,
    platform: row.platform,
    audience: row.audience,
    genre: row.genre,
    rawGenres: row.rawGenres,
    primaryGenre: row.primaryGenre,
    genreBucket: row.genreBucket,
    authorHash: row.author ? shortId(row.author) : '',
    signals: row.humanTextureSignals,
    scene: row.scene[0] || '',
    scenes: row.scene,
    relationship: row.relationship[0] || '',
    relationships: row.relationship,
    emotionalState: row.emotionalState[0] || '',
    emotionalStates: row.emotionalState,
    intent: row.surfaceIntent,
    surfaceIntent: row.surfaceIntent,
    subtext: row.subtext,
    humanTextureSignals: row.humanTextureSignals,
    forbiddenTerms: [],
    residualTerms: [],
    score: row.score,
  };
}

function buildRawRuntimeIndex(rows, sources) {
  const samples = rows.map(runtimeSample);
  return {
    version: 'character-material-raw-v3.1-1',
    published: true,
    markdownPublished: true,
    sourceHash: 'raw-local-corpus-v3.1',
    general: { rules: [], samples: samples.filter(row => row.corpus !== 'mature') },
    mature: { rules: [], samples: samples.filter(row => row.corpus === 'mature') },
    profiles: {},
    rawGenreProfiles: {},
    aggregateRawGenreProfiles: {},
    profilesPublished: false,
    profileFallback: 'raw-samples-only',
    profileFocusSlices: [],
    profileGenreMap: {},
    rawGenreCoverage: {},
    audit: {
      strongSamplesPublished: true,
      markdownPublished: true,
      manualReview: false,
      automaticReview: true,
      rawTextRuntime: true,
      sourcePolicy: 'original-local-corpus-only',
      materialTextPolicy: 'raw-source-excerpts-no-distillation-no-anonymization',
      sourceCount: sources.length,
      sampleCount: samples.length,
    },
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const handle = fs.openSync(filePath, 'w');
  try {
    for (const row of rows) fs.writeSync(handle, `${JSON.stringify(row)}\n`, null, 'utf8');
  } finally {
    fs.closeSync(handle);
  }
}

function writeMarkdown(filePath, rows, report) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const handle = fs.openSync(filePath, 'w');
  try {
    fs.writeSync(handle, [
      '# 素材库（原文版）',
      '',
      '> 本文件直接收录本地小说原本中的连续原文片段。原文正文不压缩、不匿名化、不改写、不蒸馏；下方标签仅用于检索，不能替代原文。',
      '> 每条记录保留原文件、章节和字符区间，便于回到原本核对。',
      '',
      '## 构建摘要',
      '',
      `- 输入目录：${report.inputRoot}`,
      `- 扫描文件：${report.filesScanned}`,
      `- 通过准入：${report.admittedFiles}`,
      `- 排除文件：${report.rejectedFiles}`,
      `- 原文样本：${report.sampleCount}`,
      `- 原文字符：${report.rawCharacterCount}`,
      `- 文本策略：${report.textPolicy}`,
      '',
      '## 原文样本',
      '',
    ].join('\n'), null, 'utf8');
    let currentSource = '';
    rows.forEach((row, index) => {
      if (row.sourceFilePath !== currentSource) {
        currentSource = row.sourceFilePath;
        fs.writeSync(handle, [`## ${compactMeta(row.title || currentSource)}`, '', `- 原文件：${row.sourceFilePath}`, `- 作者字段：${compactMeta(row.author || '未署名')}`, `- 分类：${compactMeta(row.category || '未分类')}`, ''].join('\n'), null, 'utf8');
      }
      const labels = [
        `维度：${DIMENSION_LABELS[row.dimension] || row.dimension}`,
        `召回：${row.recallKinds.join('、') || '无'}`,
        `场景：${row.scene.join('、') || '未标注'}`,
        `关系：${row.relationship.join('、') || '未标注'}`,
        `状态：${row.emotionalState.join('、') || '未标注'}`,
        `HTL：${row.humanTextureSignals.join('、') || '未标注'}`,
      ];
      fs.writeSync(handle, [
        `### ${String(index + 1).padStart(6, '0')} · ${row.id}`,
        '',
        `- 章节：${compactMeta(row.chapterTitle)}（第${row.chapterIndex ?? '?'}章）`,
        `- 原文位置：${row.charStart}-${row.charEnd}`,
        `- ${labels.join('；')}`,
        '- 原文：',
        rawFence(row.rawText),
        '',
      ].join('\n'), null, 'utf8');
    });
  } finally {
    fs.closeSync(handle);
  }
}

function parseArgs(argv = []) {
  const options = {
    archiveRoot: DEFAULT_ARCHIVE_ROOT,
    markdown: DEFAULT_MARKDOWN,
    index: DEFAULT_INDEX,
    report: DEFAULT_REPORT,
    jsonl: DEFAULT_JSONL,
    perWorkLimit: 120,
    maxWorks: 0,
    publishRuntime: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] || '';
    if (arg === '--archive-root') options.archiveRoot = path.resolve(next());
    else if (arg === '--markdown') options.markdown = path.resolve(next());
    else if (arg === '--index') options.index = path.resolve(next());
    else if (arg === '--report') options.report = path.resolve(next());
    else if (arg === '--jsonl') options.jsonl = path.resolve(next());
    else if (arg === '--per-work-limit') options.perWorkLimit = Math.max(1, Number.parseInt(next(), 10) || 120);
    else if (arg === '--max-works') options.maxWorks = Math.max(0, Number.parseInt(next(), 10) || 0);
    else if (arg === '--publish-runtime') options.publishRuntime = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
  }
  return options;
}

export function buildRawMaterialLibrary(options = {}) {
  const archiveRoot = path.resolve(options.archiveRoot || DEFAULT_ARCHIVE_ROOT);
  const configPath = path.join(RESOURCE_ROOT, 'quota-config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const allFiles = walkTxtFiles(archiveRoot);
  const files = options.maxWorks ? allFiles.slice(0, options.maxWorks) : allFiles;
  const sources = [];
  const rows = [];
  let rawCharacterCount = 0;
  let candidatesMined = 0;
  const byDimension = Object.fromEntries(DIMENSIONS.map(dimension => [dimension, 0]));
  for (const [index, filePath] of files.entries()) {
    const rawSource = fs.readFileSync(filePath, 'utf8');
    const source = buildSourceRecord(filePath, archiveRoot, rawSource, config, index + 1);
    const chapters = splitRawChapters(rawSource);
    repairSourceQuality(source, rawSource, chapters);
    sources.push({
      sourceWorkId: source.sourceWorkId,
      canonicalWorkId: source.canonicalWorkId,
      title: source.title,
      author: source.author,
      platform: source.platform,
      category: source.category,
      primaryGenre: source.primaryGenre,
      genreBucket: source.genreBucket,
      sourceFilePath: source.sourceFilePath,
      quality: {
        status: source.quality.status,
        eligibleForAdvancedAnalysis: source.quality.eligibleForAdvancedAnalysis,
        reasons: source.quality.reasons,
        characterCount: source.quality.characterCount,
        chapterCount: source.quality.chapterCount,
      },
    });
    if (source.quality.eligibleForAdvancedAnalysis) {
      const workRows = mineRawWork(source, rawSource, options.perWorkLimit || 120);
      candidatesMined += workRows.length;
      for (const row of workRows) {
        rows.push(row);
        rawCharacterCount += rich.characterCount(row.rawText);
        if (Object.prototype.hasOwnProperty.call(byDimension, row.dimension)) byDimension[row.dimension] += rich.characterCount(row.rawText);
      }
    }
    if ((index + 1) % 25 === 0 || index + 1 === files.length) console.error(`[raw-material] ${index + 1}/${files.length}`);
  }
  rows.sort((left, right) => left.sourceFilePath.localeCompare(right.sourceFilePath, 'zh-CN') || compareRows(left, right));
  const runtimeIndex = buildRawRuntimeIndex(rows, sources);
  const report = {
    schemaVersion: 'character-material-raw-library-report-v1',
    status: 'completed',
    generatedAt: new Date().toISOString(),
    inputRoot: path.relative(RESOURCE_ROOT, archiveRoot).replace(/\\/gu, '/') || '.',
    filesScanned: files.length,
    admittedFiles: sources.filter(source => source.quality.eligibleForAdvancedAnalysis).length,
    rejectedFiles: sources.filter(source => !source.quality.eligibleForAdvancedAnalysis).length,
    candidatesMined,
    sampleCount: rows.length,
    rawCharacterCount,
    byDimension,
    textPolicy: '原文连续片段；不压缩、不匿名化、不改写、不蒸馏',
    sourcePolicy: 'original-local-corpus-only',
    legacyInputsUsed: false,
    humanCalibration: 'skipped-by-user-instruction',
    output: {
      markdown: path.resolve(options.markdown || DEFAULT_MARKDOWN),
      index: path.resolve(options.index || DEFAULT_INDEX),
      jsonl: path.resolve(options.jsonl || DEFAULT_JSONL),
    },
    rejectedSourceIds: sources.filter(source => !source.quality.eligibleForAdvancedAnalysis).map(source => source.sourceWorkId),
  };
  writeMarkdown(options.markdown || DEFAULT_MARKDOWN, rows, report);
  writeJson(options.index || DEFAULT_INDEX, runtimeIndex);
  writeJsonl(options.jsonl || DEFAULT_JSONL, rows);
  writeJson(options.report || DEFAULT_REPORT, report);
  return { report, runtimeIndex, rows, sources };
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('用法：node scripts/build-raw-material-library.mjs [--archive-root path] [--markdown path] [--index path] [--report path] [--jsonl path] [--per-work-limit N] [--max-works N]');
  } else {
    try {
      const result = buildRawMaterialLibrary(options);
      console.log(JSON.stringify(result.report, null, 2));
    } catch (error) {
      console.error(error?.stack || error);
      process.exitCode = 1;
    }
  }
}
