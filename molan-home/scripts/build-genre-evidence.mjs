import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const evidenceLib = require('../lib/genre-evidence.js');
const metrics = require('../lib/benchmark-metrics.js');
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const ARCHIVE_ROOT = path.resolve(REPO_ROOT, '..', '资源库', '小说原本');
const OUTPUT_DIR = path.join(REPO_ROOT, 'data', 'genre-evidence');
const SELECTION_PATH = path.join(OUTPUT_DIR, 'selection.json');
const RULES_DIR = path.join(REPO_ROOT, 'data', 'genre-rules');

function sourcePathOf(selection) {
  if (!evidenceLib.GENRES.includes(selection.genre) || typeof selection.title !== 'string' || /[\\/\u0000]/u.test(selection.title) || selection.title === '..') throw new Error('非法范本选择');
  const filePath = path.join(ARCHIVE_ROOT, selection.genre, `${selection.title}.txt`);
  const realArchive = fs.realpathSync(ARCHIVE_ROOT);
  const realFile = fs.realpathSync(filePath);
  const relative = path.relative(realArchive, realFile);
  if (path.isAbsolute(relative) || relative.startsWith('..') || relative.split(path.sep).length !== 2) throw new Error('范本路径越界或非直接题材文件');
  return filePath;
}

export function buildBookEvidence(buffer, selection, sourcePath, reviewMetadata) {
  const source = evidenceLib.decodeSource(buffer, { encoding: selection.encoding });
  if (source.sourceSha256 !== selection.sourceSha256) throw new Error(`${selection.title}: source SHA256 已变化，旧摘段解释不可自动重用`);
  const chapters = evidenceLib.extractCompleteChapters(source.text, 3);
  if (chapters.length !== 3) throw new Error(`${selection.title}: 无法确认连续完整前三章`);
  if (selection.chapters?.length !== 3) throw new Error(`${selection.title}: 缺少三章摘段记录`);
  const reviewedChapters = chapters.map(chapter => {
    const review = selection.chapters.find(item => item.number === chapter.number);
    if (!review?.observations?.length) throw new Error(`${selection.title}/${chapter.id}: 缺少摘段解释`);
    const reviewedParagraphIds = [...new Set(review.observations.flatMap(item => item.paragraphIds))];
    const excerpts = reviewedParagraphIds.map(paragraphId => {
      const paragraph = chapter.paragraphs.find(item => item.id === paragraphId);
      if (!paragraph) throw new Error(`${selection.title}/${paragraphId}: 证据段落不存在`);
      const text = Array.from(paragraph.text).slice(0, 160).join('');
      return { paragraphId, start: paragraph.start, end: paragraph.start + text.length, sha256: evidenceLib.sha256(text), text, truncated: text.length < paragraph.text.length };
    });
    const { body, paragraphs, ...chapterMetadata } = chapter;
    return {
      ...chapterMetadata,
      paragraphs: paragraphs.map(({ text, ...paragraph }) => paragraph),
      excerpts,
      metrics: { fingerprint: metrics.computeTextFingerprint(body), structure: metrics.computeStructureStats(body) },
      closeReading: {
        status: 'excerpt-reviewed',
        reviewer: reviewMetadata.reviewer,
        reviewedAt: reviewMetadata.reviewedAt,
        humanReviewStatus: 'pending',
        fullChapterReviewStatus: 'pending',
        method: '本轮代理阅读所引段落并作首尾/相邻段对照；未评读段落只建立确定性索引。observations为局部阅读解释，不是模型全文审稿结果。',
        coverage: { indexedParagraphs: paragraphs.length, citedParagraphs: reviewedParagraphIds.length, fullyReviewedChapters: 0 },
        observations: structuredClone(review.observations),
        limitations: ['原文仅保存每个证据段前160个Unicode字符；truncated=true时需用段落范围回查全文。', '整章语义、后文兑现、人工复核待完成；量化指标不证明文学质量。']
      }
    };
  });
  return {
    book: {
      id: `${selection.genre}:${source.sourceSha256.slice(0, 16)}`,
      title: selection.title,
      source: {
        path: sourcePath, sha256: source.sourceSha256,
        decodedSha256: evidenceLib.sha256(source.text), byteLength: source.byteLength,
        encoding: source.encoding, encodingMethod: source.encodingMethod,
        offsetUnit: evidenceLib.OFFSET_UNIT,
        hashMethod: 'source.sha256=raw-file-bytes; decoded/chapter/body/paragraph/excerpt hashes=UTF-8 encoding of exact decoded slices; ranges=[start,end), UTF-16 offsets, BOM retained',
        completeFileRead: true
      },
      chapters: reviewedChapters
    },
    sourceText: source.text
  };
}

export function buildGenreEvidence(genre, selectionManifest) {
  if (!evidenceLib.GENRES.includes(genre)) throw new Error('不支持的题材');
  const selections = selectionManifest.books.filter(item => item.genre === genre);
  if (selections.length !== 2) throw new Error(`${genre}: 必须恰好两本固定来源，不自动补样`);
  const books = [];
  const sourceTexts = {};
  const sourceBuffers = {};
  for (const selection of selections) {
    const filePath = sourcePathOf(selection);
    const buffer = fs.readFileSync(filePath);
    const sourcePath = path.relative(path.resolve(REPO_ROOT, '..'), filePath).split(path.sep).join('/');
    const result = buildBookEvidence(buffer, selection, sourcePath, selectionManifest);
    books.push(result.book);
    sourceTexts[sourcePath] = result.sourceText;
    sourceBuffers[sourcePath] = buffer;
  }
  const evidence = {
    schemaVersion: evidenceLib.SCHEMA_VERSION,
    measurementVersion: metrics.MEASUREMENT_VERSION,
    genre,
    status: 'excerpt-evidence-ready',
    method: selectionManifest.method,
    selectionManifestSha256: evidenceLib.sha256(JSON.stringify(selectionManifest)),
    reviewStatus: { deterministicIndex: 'complete', excerptReview: 'complete-for-cited-paragraphs-only', fullChapterReview: 'pending', humanReview: 'pending' },
    limitations: selectionManifest.limitations,
    books
  };
  const validation = evidenceLib.validateGenreEvidence(evidence, { sourceTexts, sourceBuffers });
  if (!validation.valid || !validation.sourceVerified) throw new Error(`${genre}: ${validation.errors.join('; ') || '来源尚未验证'}`);
  return { evidence, validation };
}

export function buildGenreRules(evidence, selectionManifest) {
  const profile = selectionManifest.ruleProfiles[evidence.genre];
  if (!profile) throw new Error(`${evidence.genre}: 缺少规则方法记录`);
  const writingDirectives = profile.writingDirectives.map(({ bookIndex, chapterNumber, ...directive }) => {
    const book = evidence.books[bookIndex];
    const chapter = book?.chapters.find(item => item.number === chapterNumber);
    if (!chapter) throw new Error('规则证据不存在');
    return { ...directive, enforcement: 'advisory', evidenceRefs: [{ bookId: book.id, chapterId: chapter.id, paragraphIds: chapter.closeReading.observations[0].paragraphIds }] };
  });
  return {
    schemaVersion: 2, genre: evidence.genre, familyId: profile.familyId, summary: profile.summary,
    policy: {
      enforcement: 'advisory-only',
      nameOverlap: '共姓、辈分字和一般共享汉字本身不构成硬门禁；仅在具体辨识困难时提示复核。',
      opening: '宏观、微观、对白均可按当前叙事任务选择，不统一强制任何开篇尺度或器物清单。',
      ending: '关键词未命中为unknown；ease需有上下文证据，不据结尾词自动通过或拒稿。',
      metrics: '同口径描述性分布，不设置文学质量、字数、对白长度或词频硬门禁。',
      review: '仅定点摘段已评；整章、后文及人工复核pending。',
      legacyCards: '旧卡缺原文定位，旧固定targetMetrics和自造范句均已撤下；未将未读作品印象迁移为已证实事实。'
    },
    targetMetrics: {},
    baselineRef: `../genre-baselines/${evidence.genre}.json`,
    evidenceRef: `../genre-evidence/${evidence.genre}.json`,
    selectionManifestSha256: evidence.selectionManifestSha256,
    writingDirectives,
    positivePatterns: [],
    negativePatterns: [],
    decisionCards: evidence.books.map(book => ({
      sourceTitle: book.title, topic: '前三章局部信息与行动变化',
      application: book.chapters.map(chapter => chapter.closeReading.observations[0].claim).join(' '),
      limits: '仅所列摘段，不是整章或全书质量认证；关系边界、完整因果、后文兑现和人工复核待完成。',
      evidenceBookId: book.id, sourceSha256: book.source.sha256,
      evidenceRefs: book.chapters.map(chapter => ({ chapterId: chapter.id, paragraphIds: chapter.closeReading.observations[0].paragraphIds })),
      reviewStatus: 'excerpt-reviewed-human-pending'
    }))
  };
}

export function main(argv = process.argv.slice(2)) {
  if (argv.some(arg => arg !== '--check')) throw new Error('仅支持 --check；来源和输出固定在授权目录，不接受任意路径');
  const check = argv.includes('--check');
  const manifest = JSON.parse(fs.readFileSync(SELECTION_PATH, 'utf8'));
  const built = evidenceLib.GENRES.map(genre => buildGenreEvidence(genre, manifest));
  const index = {
    schemaVersion: evidenceLib.SCHEMA_VERSION,
    scope: 'P1-only; existing corpus rows untouched',
    counts: { genres: built.length, books: built.length * 2, completeChapters: built.length * 6, humanReviewedChapters: 0, fullChapterReviewedChapters: 0 },
    genres: built.map(({ evidence }) => ({ genre: evidence.genre, file: `${evidence.genre}.json`, status: evidence.status, bookCount: evidence.books.length, chapterCount: evidence.books.reduce((sum, book) => sum + book.chapters.length, 0) }))
  };
  const rules = built.map(({ evidence }) => {
    const value = buildGenreRules(evidence, manifest);
    const validation = evidenceLib.validateGenreRules(value, evidence);
    if (!validation.valid) throw new Error(`${evidence.genre}: ${validation.errors.join('; ')}`);
    return { directory: RULES_DIR, name: `${evidence.genre}.json`, value };
  });
  const outputs = [
    ...built.map(({ evidence }) => ({ directory: OUTPUT_DIR, name: `${evidence.genre}.json`, value: evidence })),
    ...rules,
    { directory: OUTPUT_DIR, name: 'index.json', value: index }
  ];
  for (const output of outputs) {
    const destination = path.join(output.directory, output.name);
    const serialized = `${JSON.stringify(output.value, null, 2)}\n`;
    if (check) {
      if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== serialized) throw new Error(`${output.name}: 缺失或与固定原文及摘段记录不一致`);
    } else fs.writeFileSync(destination, serialized, 'utf8');
  }
  for (const { evidence, validation } of built) console.log(`[genre-evidence] ${evidence.genre}: ${check ? 'checked' : 'built'} books=2 completeChapters=6 humanReviews=0 sourceVerified=${validation.sourceVerified}`);
  return 0;
}

if (path.resolve(process.argv[1] || '') === SCRIPT_PATH) {
  try { process.exitCode = main(); } catch (error) { console.error(`[genre-evidence] ${error.message}`); process.exitCode = 1; }
}
