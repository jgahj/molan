'use strict';

const { createHash } = require('node:crypto');

const GENRES = Object.freeze(['玄幻', '都市高武', '悬疑脑洞', '青春甜宠', '历史脑洞', '科幻末世']);
const SCHEMA_VERSION = 1;
const OFFSET_UNIT = 'utf16-code-unit';
const HEADING_PATTERN = /^[ \t\u3000\uFEFF]*(第([零〇一二三四五六七八九十百千万两\d]+)章[^\r\n]{0,120})[ \t\u3000]*\r?$/gmu;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function decodeSource(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('source 必须是完整文件 Buffer');
  let encoding = options.encoding;
  if (!encoding) {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) encoding = 'utf-16le';
    else if (buffer[0] === 0xfe && buffer[1] === 0xff) encoding = 'utf-16be';
    else if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) encoding = 'utf-8';
    else {
      try {
        return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer), encoding: 'utf-8', encodingMethod: 'strict-utf8', sourceSha256: sha256(buffer), byteLength: buffer.length };
      } catch {
        throw new Error('非 UTF-8 或源文件编码损坏；请显式指定 encoding，禁止把截断 UTF-8 自动误判为 GB18030');
      }
    }
  }
  if (!['utf-8', 'utf-16le', 'utf-16be', 'gb18030'].includes(encoding)) throw new Error('不支持的编码');
  return { text: new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(buffer), encoding, encodingMethod: options.encoding ? 'explicit' : 'bom', sourceSha256: sha256(buffer), byteLength: buffer.length };
}

function chapterNumber(value) {
  if (/^\d+$/u.test(value)) return Number(value);
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  let total = 0;
  let pending = 0;
  for (const character of value) {
    if (Object.hasOwn(digits, character)) pending = digits[character];
    else if (units[character]) {
      total += (pending || 1) * units[character];
      pending = 0;
    } else return NaN;
  }
  return total + pending;
}

function paragraphsWithOffsets(text, start, end, chapterId) {
  const paragraphs = [];
  for (const match of text.slice(start, end).matchAll(/[^\r\n]+/gu)) {
    const content = match[0].trim();
    if (!content) continue;
    const paragraphStart = start + match.index + match[0].indexOf(content);
    paragraphs.push({
      id: `${chapterId}:p${paragraphs.length + 1}`,
      number: paragraphs.length + 1,
      start: paragraphStart,
      end: paragraphStart + content.length,
      sha256: sha256(content),
      text: content
    });
  }
  return paragraphs;
}

function extractCompleteChapters(text, count = 3, options = {}) {
  if (typeof text !== 'string') throw new TypeError('text 必须为完整解码后的字符串');
  if (!Number.isInteger(count) || count < 1) throw new RangeError('count 必须是正整数');
  const minBodyChars = options.minBodyChars ?? 1;
  const headings = [...text.matchAll(HEADING_PATTERN)].map(match => ({ title: match[1].trim(), number: chapterNumber(match[2]), start: match.index, end: match.index + match[0].length }));
  for (let candidate = 0; candidate + count < headings.length; candidate += 1) {
    if (headings[candidate].number !== 1) continue;
    const window = headings.slice(candidate, candidate + count + 1);
    if (!window.every((heading, index) => heading.number === index + 1)) continue;
    const chapters = window.slice(0, count).map((heading, index) => {
      const end = window[index + 1].start;
      const id = `ch${heading.number}`;
      const rawBody = text.slice(heading.end, end);
      const paragraphs = paragraphsWithOffsets(text, heading.end, end, id);
      return {
        id, number: heading.number, title: heading.title,
        start: heading.start, bodyStart: heading.end, end,
        complete: true, boundary: 'next-consecutive-numbered-heading',
        nextHeading: window[index + 1].title,
        sha256: sha256(text.slice(heading.start, end)),
        bodySha256: sha256(rawBody),
        body: rawBody,
        paragraphs
      };
    });
    if (chapters.every(chapter => chapter.body.replace(/\s/gu, '').length >= minBodyChars)) return chapters;
  }
  return [];
}

function resolveEvidenceParagraph(sourceText, reference, expectedSource = {}) {
  if (typeof sourceText !== 'string' || !reference || !Number.isInteger(reference.start) || !Number.isInteger(reference.end) || reference.start < 0 || reference.end <= reference.start || reference.end > sourceText.length) {
    return { ok: false, reason: 'invalid-range', text: null };
  }
  if (expectedSource.decodedSha256 && sha256(sourceText) !== expectedSource.decodedSha256) return { ok: false, reason: 'source-mismatch', text: null };
  const text = sourceText.slice(reference.start, reference.end);
  if (sha256(text) !== reference.sha256 || (reference.text !== undefined && reference.text !== text)) return { ok: false, reason: 'paragraph-mismatch', text: null };
  return { ok: true, reason: null, text };
}

function inspectGenreEvidence(evidence, options = {}) {
  const errors = [];
  const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
  if (!evidence || evidence.schemaVersion !== SCHEMA_VERSION || !GENRES.includes(evidence.genre)) return { valid: false, errors: ['invalid-schema-or-genre'], sourceVerified: false };
  if (evidence.reviewStatus?.humanReview !== 'pending' || evidence.reviewStatus?.fullChapterReview !== 'pending' || evidence.reviewStatus?.deterministicIndex !== 'complete' || evidence.reviewStatus?.excerptReview !== 'complete-for-cited-paragraphs-only') errors.push('invalid-review-coverage');
  if (!Array.isArray(evidence.books) || evidence.books.length !== 2) errors.push('expected-two-books');
  const sourceHashes = new Set();
  let sourceVerified = true;
  for (const book of evidence.books || []) {
    const source = book.source || {};
    const prefix = book.id || 'book';
    if (!validHash(source.sha256) || !validHash(source.decodedSha256) || !source.path || source.offsetUnit !== OFFSET_UNIT || source.completeFileRead !== true || !Number.isInteger(source.byteLength) || source.byteLength < 1) errors.push(`${prefix}:invalid-source`);
    if (sourceHashes.has(source.sha256)) errors.push(`${prefix}:duplicate-source`);
    sourceHashes.add(source.sha256);
    if (!Array.isArray(book.chapters) || book.chapters.length !== 3) errors.push(`${prefix}:expected-three-chapters`);
    const sourceBuffer = options.sourceBuffers?.[source.path];
    let sourceText = options.sourceTexts?.[source.path];
    if (Buffer.isBuffer(sourceBuffer)) {
      const decoded = decodeSource(sourceBuffer, { encoding: source.encoding });
      if (decoded.sourceSha256 !== source.sha256 || sourceBuffer.length !== source.byteLength || (typeof sourceText === 'string' && sourceText !== decoded.text)) errors.push(`${prefix}:source-bytes-mismatch`);
      sourceText = decoded.text;
    } else sourceVerified = false;
    if (typeof sourceText !== 'string') sourceVerified = false;
    else if (sha256(sourceText) !== source.decodedSha256) errors.push(`${prefix}:source-mismatch`);
    const actualChapters = typeof sourceText === 'string' ? extractCompleteChapters(sourceText, 3) : null;
    for (const [index, chapter] of (book.chapters || []).entries()) {
      const chapterPrefix = `${prefix}:${chapter.id}`;
      if (chapter.number !== index + 1 || chapter.complete !== true || chapter.boundary !== 'next-consecutive-numbered-heading' || !validHash(chapter.sha256) || !validHash(chapter.bodySha256)) errors.push(`${chapterPrefix}:invalid-chapter`);
      if (!Number.isInteger(chapter.start) || !Number.isInteger(chapter.bodyStart) || !Number.isInteger(chapter.end) || chapter.start < 0 || chapter.bodyStart < chapter.start || chapter.end <= chapter.bodyStart) errors.push(`${chapterPrefix}:invalid-range`);
      if (typeof sourceText === 'string' && (sha256(sourceText.slice(chapter.start, chapter.end)) !== chapter.sha256 || sha256(sourceText.slice(chapter.bodyStart, chapter.end)) !== chapter.bodySha256)) errors.push(`${chapterPrefix}:chapter-mismatch`);
      const actualChapter = actualChapters?.[index];
      if (actualChapters && (!actualChapter || actualChapter.start !== chapter.start || actualChapter.bodyStart !== chapter.bodyStart || actualChapter.end !== chapter.end || actualChapter.sha256 !== chapter.sha256 || actualChapter.title !== chapter.title || actualChapter.nextHeading !== chapter.nextHeading || actualChapter.paragraphs.length !== chapter.paragraphs?.length)) errors.push(`${chapterPrefix}:boundary-or-coverage-mismatch`);
      const paragraphIds = new Set();
      let lastEnd = chapter.bodyStart;
      if (!Array.isArray(chapter.paragraphs) || !chapter.paragraphs.length) errors.push(`${chapterPrefix}:no-paragraphs`);
      for (const paragraph of chapter.paragraphs || []) {
        if (paragraphIds.has(paragraph.id) || !Number.isInteger(paragraph.start) || !Number.isInteger(paragraph.end) || paragraph.start < lastEnd || paragraph.end > chapter.end || paragraph.end <= paragraph.start || !validHash(paragraph.sha256) || (paragraph.text !== undefined && (typeof paragraph.text !== 'string' || paragraph.text.length !== paragraph.end - paragraph.start || sha256(paragraph.text) !== paragraph.sha256))) errors.push(`${chapterPrefix}:invalid-paragraph`);
        paragraphIds.add(paragraph.id);
        lastEnd = paragraph.end;
        if (actualChapter && !actualChapter.paragraphs.some(item => item.id === paragraph.id && item.start === paragraph.start && item.end === paragraph.end && item.sha256 === paragraph.sha256)) errors.push(`${chapterPrefix}:paragraph-index-mismatch`);
        if (typeof sourceText === 'string' && !resolveEvidenceParagraph(sourceText, paragraph).ok) errors.push(`${chapterPrefix}:paragraph-mismatch`);
      }
      const excerptIds = new Set();
      for (const excerpt of chapter.excerpts || []) {
        const paragraph = (chapter.paragraphs || []).find(item => item.id === excerpt.paragraphId);
        if (!paragraph || typeof excerpt.text !== 'string' || excerpt.text.length > 320 || excerpt.start !== paragraph.start || excerpt.end > paragraph.end || excerpt.end - excerpt.start !== excerpt.text.length || sha256(excerpt.text) !== excerpt.sha256) errors.push(`${chapterPrefix}:invalid-excerpt`);
        excerptIds.add(excerpt.paragraphId);
        if (typeof sourceText === 'string' && !resolveEvidenceParagraph(sourceText, excerpt).ok) errors.push(`${chapterPrefix}:excerpt-mismatch`);
      }
      const review = chapter.closeReading;
      if (!review || review.status !== 'excerpt-reviewed' || review.humanReviewStatus !== 'pending' || review.fullChapterReviewStatus !== 'pending' || !review.method || !review.limitations?.length || !review.observations?.length) errors.push(`${chapterPrefix}:invalid-review-status`);
      for (const observation of review?.observations || []) {
        if (!observation.claim || !observation.limits || !observation.paragraphIds?.length || !observation.paragraphIds.every(id => paragraphIds.has(id) && excerptIds.has(id))) errors.push(`${chapterPrefix}:unbacked-observation`);
      }
    }
  }
  return { valid: errors.length === 0, errors, sourceVerified: sourceVerified && errors.length === 0 };
}

function validateGenreEvidence(evidence, options = {}) {
  try {
    return inspectGenreEvidence(evidence, options);
  } catch {
    return { valid: false, errors: ['malformed-evidence-or-source'], sourceVerified: false };
  }
}

function validateGenreRules(rules, evidence) {
  const errors = [];
  try {
    if (!rules || rules.schemaVersion !== 2 || rules.genre !== evidence?.genre || rules.policy?.enforcement !== 'advisory-only' || rules.selectionManifestSha256 !== evidence.selectionManifestSha256) return { valid: false, errors: ['invalid-rule-schema-or-provenance'] };
    if (!Array.isArray(rules.writingDirectives) || !rules.writingDirectives.length) errors.push('missing-directives');
    for (const directive of rules.writingDirectives || []) {
      if (directive.enforcement !== 'advisory' || ![directive.key, directive.rule, directive.detail, directive.scope, directive.limits].every(value => typeof value === 'string' && value.trim()) || !directive.evidenceRefs?.length) errors.push('invalid-directive');
      for (const reference of directive.evidenceRefs || []) {
        const book = evidence.books.find(item => item.id === reference.bookId);
        const chapter = book?.chapters.find(item => item.id === reference.chapterId);
        const cited = new Set(chapter?.excerpts.map(item => item.paragraphId));
        if (!chapter || !reference.paragraphIds?.length || !reference.paragraphIds.every(id => cited.has(id))) errors.push('unbacked-directive');
      }
    }
    return { valid: !errors.length, errors };
  } catch {
    return { valid: false, errors: ['malformed-rules'] };
  }
}

const GENRE_ALIASES = Object.freeze({
  '都市': '都市高武',
  '都市高武': '都市高武',
  '都市脑洞': '都市高武',
  '都市生活': '都市高武',
  '都市修真': '都市高武',
  '都市异能': '都市高武',
  'urban': '都市高武',
  'dushi': '都市高武',

  '玄幻': '玄幻',
  '玄幻脑洞': '玄幻',
  '仙侠': '玄幻',
  '修真': '玄幻',
  '凡人流': '玄幻',
  '凡人': '玄幻',
  'xuanhuan': '玄幻',

  '悬疑': '悬疑脑洞',
  '悬疑脑洞': '悬疑脑洞',
  '推理': '悬疑脑洞',
  '惊悚': '悬疑脑洞',
  'xuanyi': '悬疑脑洞',

  '青春': '青春甜宠',
  '青春甜宠': '青春甜宠',
  '言情': '青春甜宠',
  '甜宠': '青春甜宠',
  '恋爱': '青春甜宠',
  '校园': '青春甜宠',
  'tianchong': '青春甜宠',

  '历史': '历史脑洞',
  '历史脑洞': '历史脑洞',
  '架空历史': '历史脑洞',
  '三国': '历史脑洞',
  'lishi': '历史脑洞',

  '科幻': '科幻末世',
  '科幻末世': '科幻末世',
  '末世': '科幻末世',
  '无限流': '科幻末世',
  'kehuan': '科幻末世'
});

function normalizeGenre(genre) {
  if (typeof genre !== 'string') return '';
  const trimmed = genre.trim();
  if (!trimmed) return '';
  if (GENRES.includes(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  if (GENRE_ALIASES[trimmed]) return GENRE_ALIASES[trimmed];
  if (GENRE_ALIASES[lower]) return GENRE_ALIASES[lower];
  for (const g of GENRES) {
    if (trimmed.includes(g) || g.includes(trimmed)) return g;
  }
  return trimmed;
}

function loadGenreAssets(genre, { evidenceByGenre = {}, rulesByGenre = {} } = {}) {
  const normGenre = normalizeGenre(genre);
  if (!GENRES.includes(normGenre)) return { genre: normGenre || genre, originalGenre: genre, status: 'unsupported', evidence: null, rules: null, validation: null };
  const evidence = Object.hasOwn(evidenceByGenre, normGenre)
    ? evidenceByGenre[normGenre]
    : (Object.hasOwn(evidenceByGenre, genre) ? evidenceByGenre[genre] : null);
  const rules = Object.hasOwn(rulesByGenre, normGenre)
    ? rulesByGenre[normGenre]
    : (Object.hasOwn(rulesByGenre, genre) ? rulesByGenre[genre] : null);
  const validation = evidence ? (evidence.genre === normGenre ? validateGenreEvidence(evidence) : { valid: false, errors: ['genre-mismatch'], sourceVerified: false }) : null;
  const ruleValidation = validation?.valid && rules ? validateGenreRules(rules, evidence) : null;
  const safeRules = ruleValidation?.valid ? rules : null;
  return {
    genre: normGenre,
    originalGenre: genre,
    status: validation?.valid && safeRules ? 'ready' : 'incomplete',
    evidence: validation?.valid ? structuredClone(evidence) : null,
    rules: safeRules ? structuredClone(safeRules) : null,
    validation,
    ruleValidation,
    usage: 'excerpt-evidence-and-advice-only; not a completed human/full-chapter review or quality gate'
  };
}

function loadGenreRuntime(genre, options = {}) {
  options = options && typeof options === 'object' ? options : {};
  const normGenre = normalizeGenre(genre);
  const assets = loadGenreAssets(normGenre, {
    evidenceByGenre: options.evidence ? { [normGenre]: options.evidence } : options.evidenceByGenre || {},
    rulesByGenre: options.rules ? { [normGenre]: options.rules } : options.rulesByGenre || {}
  });
  const result = {
    genre: normGenre, originalGenre: genre, status: assets.status, writingBlock: '', reviewBlock: '',
    evidenceStatus: assets.validation?.valid ? 'excerpt-reviewed' : 'missing-or-invalid',
    humanReviewStatus: 'pending', fullChapterReviewStatus: 'pending',
    sourceVerification: 'not-run', validation: assets.validation, ruleValidation: assets.ruleValidation
  };
  if (assets.status !== 'ready') return result;
  const { evidence, rules } = assets;
  if (!Array.isArray(rules.writingDirectives) || !rules.writingDirectives.length || rules.writingDirectives.some(item => !item || item.enforcement !== 'advisory' || typeof item.rule !== 'string' || typeof item.detail !== 'string' || !item.scope || !item.limits)) {
    return { ...result, status: 'invalid-rules' };
  }
  const short = (value, limit) => Array.from(String(value || '').replace(/\s+/gu, ' ')).slice(0, limit).join('');
  const methods = rules.writingDirectives.slice(0, 4).map(item => `- 可选方法：${short(item.rule, 40)}；${short(item.detail, 130)}；适用：${short(item.scope, 70)}；限制：${short(item.limits, 80)}`);
  const summaries = evidence.books.flatMap(book => book.chapters.map(chapter => {
    const observation = chapter.closeReading.observations[0];
    return `- ${short(book.title, 55)}／第${chapter.number}章：${short(observation.claim, 125)}（${book.id}/${observation.paragraphIds.join(',')}）；限于：${short(observation.limits, 85)}`;
  }));
  result.writingBlock = [
    `【${normGenre}题材证据：可选参考，不是质量门禁】`,
    '范围为两本各前三章的定点摘段；非整章精读完成，人工复核待完成。样本目录标签不等于题材规范。',
    ...methods,
    '证据摘要（不含原文段落）：',
    ...summaries,
    '人物共姓本身不构成缺陷；开篇可宏观、微观或对白，取决于当前叙事任务；关键词未命中的结尾为 unknown，不推断 ease。'
  ].join('\n');
  result.reviewBlock = [
    `【${normGenre}审稿参考：不可据此自动通过或拒稿】`,
    '区分原文事实、摘段解释、启发式指标与待核验推断；检查当前稿件中的具体因果和读者信息变化，而非复制范句。',
    ...summaries,
    '本资产未完成人工复核、整章语义评读及后文兑现核验；缺少证据须标待核验。量化分布不是文学质量分，unknown 结尾需结合正文人工判断；共姓、开篇尺度及关键词不作硬门禁。'
  ].join('\n');
  result.coverage = { books: evidence.books.length, completeChapters: evidence.books.reduce((sum, book) => sum + book.chapters.length, 0), fullChapterReviews: 0, humanReviews: 0 };
  return result;
}

module.exports = { GENRES, GENRE_ALIASES, SCHEMA_VERSION, OFFSET_UNIT, sha256, decodeSource, extractCompleteChapters, resolveEvidenceParagraph, validateGenreEvidence, validateGenreRules, normalizeGenre, loadGenreAssets, loadGenreRuntime };
