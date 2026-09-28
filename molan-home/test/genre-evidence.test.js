'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const evidenceLib = require('../lib/genre-evidence.js');
const metrics = require('../lib/benchmark-metrics.js');
const ROOT = path.resolve(__dirname, '..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const chapterText = (suffix = '') => `\uFEFF第一章起点\r\n  甲醒来。${suffix}\r\n\t门外有人。\r\n第二章 转折\r\n“是谁？”\r\n他没有回答。\r\n第三章 决定\r\n他走上台阶😀。\r\n尾句未落标点\r\n第四章 下一章\r\n仅下一章残片`;

test('空题材规范化保留未定状态，不匹配首个题材', () => {
  assert.equal(evidenceLib.normalizeGenre(''), '');
  assert.equal(evidenceLib.normalizeGenre('   '), '');
  assert.equal(evidenceLib.normalizeGenre(null), '');
  assert.equal(evidenceLib.loadGenreRuntime(null).status, 'unsupported');
});

test('解码：完整UTF-8越过旧600KiB字节边界仍不误判编码', () => {
  const text = `第一章 标题\n${'甲'.repeat(220000)}\n第二章 标题\n乙\n第三章 标题\n丙\n第四章 标题\n丁`;
  const decoded = evidenceLib.decodeSource(Buffer.from(text));
  assert.equal(decoded.encoding, 'utf-8');
  assert.equal(decoded.text, text);
  assert.equal(evidenceLib.extractCompleteChapters(decoded.text, 3).length, 3);
  assert.equal(decoded.sourceSha256, evidenceLib.sha256(Buffer.from(text)));
});

test('解码：残缺UTF-8拒绝回退GB18030，旧边界不是EOF', () => {
  const bytes = Buffer.from('甲乙丙');
  assert.throws(() => evidenceLib.decodeSource(bytes.subarray(0, bytes.length - 1)), /显式指定 encoding/u);
  assert.throws(() => evidenceLib.decodeSource(Buffer.from([0xef, 0xbb, 0xbf, 0xe4, 0xb8])));
});

test('解码：GB18030显式指定且严格解码，UTF-16 BOM保留供定位', () => {
  const gb = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]);
  assert.throws(() => evidenceLib.decodeSource(gb));
  assert.equal(evidenceLib.decodeSource(gb, { encoding: 'gb18030' }).text, '中文');
  assert.throws(() => evidenceLib.decodeSource(Buffer.from([0x81]), { encoding: 'gb18030' }));
  const utf16 = Buffer.from('\uFEFF第一章 标题\n中文', 'utf16le');
  const decoded = evidenceLib.decodeSource(utf16);
  assert.equal(decoded.encoding, 'utf-16le');
  assert.equal(decoded.text[0], '\uFEFF');
  const bigEndian = Buffer.from([0xfe, 0xff, 0x4e, 0x2d]);
  assert.equal(evidenceLib.decodeSource(bigEndian).text, '\uFEFF中');
});

test('切章：三章需第四个连续标题，EOF末章和残章不当完整', () => {
  const full = chapterText();
  const chapters = evidenceLib.extractCompleteChapters(full, 3);
  assert.equal(chapters.length, 3);
  assert.equal(chapters[2].boundary, 'next-consecutive-numbered-heading');
  assert.equal(evidenceLib.extractCompleteChapters(full.split('第四章')[0], 3).length, 0);
  assert.equal(evidenceLib.extractCompleteChapters('第一章 标题\n完整或残缺无法判断', 1).length, 0);
});

test('切章：缺章和短章不跳号凑前三章', () => {
  assert.deepEqual(evidenceLib.extractCompleteChapters('第1章\n甲\n第2章\n乙\n第6章\n丙\n第7章\n丁', 3), []);
  assert.deepEqual(evidenceLib.extractCompleteChapters('第2章\n乙\n第3章\n丙\n第4章\n丁\n第5章\n戊', 3), []);
  const short = evidenceLib.extractCompleteChapters('第1章\n甲\n第2章\n乙\n第3章\n丙\n第4章\n丁', 3);
  assert.equal(short.length, 3);
  assert.equal(short[0].body.trim(), '甲');
});

test('切章：目录、序章不混入编号正文，无标题空文本不造章', () => {
  const toc = '目录\n第一章起点\n第二章 转折\n第三章 决定\n第四章 下一章\n序章\n不作为编号前三章。\n';
  const chapters = evidenceLib.extractCompleteChapters(toc + chapterText(), 3);
  assert.equal(chapters.length, 3);
  assert.ok(chapters[0].body.includes('甲醒来'));
  assert.deepEqual(evidenceLib.extractCompleteChapters('', 3), []);
  assert.deepEqual(evidenceLib.extractCompleteChapters('没有章标题的正文', 3), []);
  assert.throws(() => evidenceLib.extractCompleteChapters('正文', 1.5), RangeError);
});

test('切章：段落与章节哈希可用UTF-16偏移回查，PS及原文不被改写', () => {
  const text = chapterText(' PS：作者注。');
  for (const chapter of evidenceLib.extractCompleteChapters(text, 3)) {
    assert.equal(chapter.sha256, evidenceLib.sha256(text.slice(chapter.start, chapter.end)));
    assert.equal(chapter.bodySha256, evidenceLib.sha256(text.slice(chapter.bodyStart, chapter.end)));
    for (const paragraph of chapter.paragraphs) assert.deepEqual(evidenceLib.resolveEvidenceParagraph(text, paragraph, { decodedSha256: evidenceLib.sha256(text) }), { ok: true, reason: null, text: paragraph.text });
  }
  assert.ok(evidenceLib.extractCompleteChapters(text, 3)[0].body.includes('PS：作者注'));
  const reference = evidenceLib.extractCompleteChapters(text, 3)[2].paragraphs[0];
  assert.equal(evidenceLib.resolveEvidenceParagraph(text.replace('😀', '😁'), reference).ok, false);
  assert.equal(evidenceLib.resolveEvidenceParagraph(`${text}变化`, reference, { decodedSha256: evidenceLib.sha256(text) }).reason, 'source-mismatch');
  assert.equal(evidenceLib.resolveEvidenceParagraph(text, { start: -1, end: 3 }).ok, false);
});

test('度量：null、空串、字符串数值和缺失项不伪装为0，真0计入', () => {
  const baseline = metrics.aggregateBaseline([{ commaPeriodRatio: null }, {}, { commaPeriodRatio: '' }, { commaPeriodRatio: '2' }, { commaPeriodRatio: 0 }, { commaPeriodRatio: 2 }]);
  assert.deepEqual(baseline.commaPeriodRatio, { mean: 1, stdDev: 1, count: 2 });
  assert.equal(metrics.computeTextFingerprint('只有逗号，').commaPeriodRatio, null);
  assert.equal(metrics.computeStyleDistance({ commaPeriodRatio: null }, baseline), null);
  assert.equal(metrics.computeStyleDistance({ commaPeriodRatio: '' }, baseline), null);
  assert.equal(metrics.computeStyleDistance({ commaPeriodRatio: 0 }, { commaPeriodRatio: { mean: null, stdDev: 1 } }), null);
  assert.ok(metrics.computeStyleDistance({ commaPeriodRatio: 0 }, baseline));
});

test('度量：结尾未命中是unknown，空文和带引号问句不误判ease', () => {
  assert.equal(metrics.computeStructureStats('名字写在纸上。').endingMode, 'unknown');
  assert.equal(metrics.computeStructureStats('').endingMode, 'unknown');
  assert.equal(metrics.computeStructureStats('“真的吗？”').endingMode, 'question');
  assert.equal(metrics.computeStructureStats('“门外突然响起脚步。”').endingMode, 'newProblem');
  assert.equal(metrics.computeStructureStats('他终于松了口气。').endingMode, 'fulfil');
  assert.match(metrics.computeStructureStats('文字').endingModeMethod, /heuristic/u);
});

test('度量：句长、结构句数及尾句采用同一切分，闭引号不独立计句', () => {
  const text = '“甲。”\n乙！\n尾巴';
  assert.deepEqual(metrics.sentencesOf(text), ['“甲。”', '乙！', '尾巴']);
  const fingerprint = metrics.computeTextFingerprint(text);
  const structure = metrics.computeStructureStats(text);
  assert.equal(structure.sentenceCount, 3);
  assert.equal(fingerprint.sentenceLenMean, 2.6667);
  assert.equal(fingerprint.totalChars, structure.chars);
  assert.equal(structure.chars, metrics.hardConstraintChecks(text).chars);
  assert.equal(metrics.computeTextFingerprint('没有句终符').sentenceLenMean, 5);
  assert.equal(metrics.computeTextFingerprint(text.replace(/\n/gu, '\r\n')).sentenceLenMean, fingerprint.sentenceLenMean);
  assert.equal(metrics.computeStructureStats('甲 乙。').singleSentenceParagraphRatio, 1);
});

test('度量：Unicode对白分母同为UTF-16，中英文及角引号一致识别', () => {
  for (const text of ['“😀”', '"😀"', '「😀」', '『😀』']) {
    const fingerprint = metrics.computeTextFingerprint(text);
    assert.equal(fingerprint.totalChars, 4);
    assert.equal(fingerprint.dialogueTurnMean, 2);
    assert.equal(fingerprint.dialogueRatio, 0.5);
    assert.equal(metrics.computeStructureStats(text).dialogueParagraphRatio, 1);
    assert.equal(metrics.computeStructureStats(text).openingMode, 'dialogue');
  }
});

test('度量：null tolerance使用默认值，共姓提醒不阻断', () => {
  const checked = metrics.hardConstraintChecks('甲'.repeat(90), { targetWords: 100, tolerance: null });
  assert.equal(checked.issues.some(item => item.code === 'word_count'), false);
  const shared = metrics.hardConstraintChecks('白辞说道：“走。”\n白辞说道：“嗯。”\n白衍说道：“来。”\n白衍说道：“好。”');
  assert.equal(shared.passed, true);
  assert.ok(shared.issues.every(item => item.code !== 'name_char_overlap' || item.severity === 'info'));
});

test('基线包装采用同一完整切章实现', async () => {
  const { extractChapters } = await import('../scripts/build-genre-baselines.mjs');
  assert.deepEqual(extractChapters(chapterText(), 3), evidenceLib.extractCompleteChapters(chapterText(), 3));
  assert.deepEqual(extractChapters(chapterText().split('第四章')[0], 3), []);
});

test('构建器：固定SHA不匹配或缺少摘段记录时拒绝复用，不写真实data', async () => {
  const { buildBookEvidence } = await import('../scripts/build-genre-evidence.mjs');
  const buffer = Buffer.from(chapterText());
  const selection = { genre: '玄幻', title: '内存夹具', sourceSha256: evidenceLib.sha256(buffer), chapters: [1, 2, 3].map(number => ({ number, observations: [{ claim: '夹具摘段事实。', limits: '测试用，不是文学分析。', paragraphIds: [`ch${number}:p1`] }] })) };
  const result = buildBookEvidence(buffer, selection, 'fixtures/read-only.txt', { reviewer: 'test-fixture', reviewedAt: '2026-09-10' });
  assert.equal(result.book.chapters.length, 3);
  assert.equal(result.book.chapters[0].paragraphs[0].text, undefined);
  assert.ok(result.book.chapters[0].excerpts[0].text);
  assert.throws(() => buildBookEvidence(Buffer.from(chapterText('变化')), selection, 'fixtures/read-only.txt', {}), /SHA256/u);
  assert.throws(() => buildBookEvidence(buffer, { ...selection, chapters: [] }, 'fixtures/read-only.txt', {}), /缺少/u);
});

test('资产：六题材各两本完整前三章，所有解释具备摘录引用而人工/整章仍pending', () => {
  const index = readJson('data/genre-evidence/index.json');
  assert.deepEqual(index.counts, { genres: 6, books: 12, completeChapters: 36, humanReviewedChapters: 0, fullChapterReviewedChapters: 0 });
  for (const genre of evidenceLib.GENRES) {
    const evidence = readJson(`data/genre-evidence/${genre}.json`);
    const validation = evidenceLib.validateGenreEvidence(evidence);
    assert.deepEqual(validation, { valid: true, errors: [], sourceVerified: false }, genre);
    for (const book of evidence.books) for (const chapter of book.chapters) {
      assert.equal(chapter.closeReading.humanReviewStatus, 'pending');
      assert.equal(chapter.closeReading.fullChapterReviewStatus, 'pending');
      assert.equal(chapter.closeReading.coverage.fullyReviewedChapters, 0);
      assert.ok(chapter.paragraphs.every(paragraph => !Object.hasOwn(paragraph, 'text')));
      assert.ok(chapter.excerpts.every(excerpt => Array.from(excerpt.text).length <= 160));
    }
  }
});

test('资产：验证拒绝篡改摘录、伪完成人工审读、缺章及无证据解释', () => {
  const original = readJson('data/genre-evidence/玄幻.json');
  for (const mutate of [
    evidence => { evidence.books[0].chapters[0].excerpts[0].text += '伪造'; },
    evidence => { evidence.books[0].chapters[0].closeReading.humanReviewStatus = 'complete'; },
    evidence => { evidence.reviewStatus.fullChapterReview = 'complete'; },
    evidence => { evidence.books[0].chapters.pop(); },
    evidence => { evidence.books[0].chapters[0].closeReading.observations[0].paragraphIds = ['ch1:p99999']; },
    evidence => { evidence.books[1].source.sha256 = evidence.books[0].source.sha256; }
  ]) {
    const changed = structuredClone(original);
    mutate(changed);
    assert.equal(evidenceLib.validateGenreEvidence(changed).valid, false);
  }
  for (const malformed of [null, {}, { schemaVersion: 1, genre: '玄幻', books: {} }, { ...original, books: [null] }]) assert.equal(evidenceLib.validateGenreEvidence(malformed).valid, false);
});

test('纯runtime：注入接口可挂起草与审稿，不读盘、不修改输入或输出原文段落', () => {
  for (const genre of evidenceLib.GENRES) {
    const evidence = readJson(`data/genre-evidence/${genre}.json`);
    const rules = readJson(`data/genre-rules/${genre}.json`);
    const before = JSON.stringify({ evidence, rules });
    const result = evidenceLib.loadGenreRuntime(genre, { evidence, rules });
    assert.equal(result.status, 'ready', genre);
    assert.equal(result.evidenceStatus, 'excerpt-reviewed');
    assert.equal(result.humanReviewStatus, 'pending');
    assert.equal(result.fullChapterReviewStatus, 'pending');
    assert.equal(result.sourceVerification, 'not-run');
    assert.match(result.writingBlock, /可选方法/u);
    assert.match(result.reviewBlock, /不可据此自动通过或拒稿/u);
    assert.ok(result.writingBlock.length < 4500);
    assert.ok(result.reviewBlock.length < 3500);
    assert.ok(!result.writingBlock.includes('targetMetrics'));
    for (const book of evidence.books) for (const chapter of book.chapters) for (const excerpt of chapter.excerpts.filter(item => item.text.length > 15)) {
      assert.equal(result.writingBlock.includes(excerpt.text), false);
      assert.equal(result.reviewBlock.includes(excerpt.text), false);
    }
    assert.equal(JSON.stringify({ evidence, rules }), before);
    assert.deepEqual(evidenceLib.loadGenreRuntime(genre, { evidenceByGenre: { [genre]: evidence }, rulesByGenre: { [genre]: rules } }), result);
    const assets = evidenceLib.loadGenreAssets(genre, { evidenceByGenre: { [genre]: evidence }, rulesByGenre: { [genre]: rules } });
    assets.evidence.books[0].title = '改返回值';
    assert.equal(JSON.stringify({ evidence, rules }), before);
  }
});

test('纯runtime：缺失、题材错配、旧硬规则或失效引用明确非ready且blocks为空', () => {
  const evidence = readJson('data/genre-evidence/玄幻.json');
  const rules = readJson('data/genre-rules/玄幻.json');
  const wrongRules = structuredClone(rules);
  wrongRules.writingDirectives[0].evidenceRefs[0].paragraphIds = ['ch99:p99'];
  const staleRules = { ...rules, selectionManifestSha256: '旧版本' };
  for (const [genre, options] of [
    ['玄幻', undefined], ['玄幻', null], ['不支持', { evidence, rules }],
    ['都市高武', { evidence, rules }], ['玄幻', { evidence, rules: { ...rules, policy: { enforcement: 'blocker' } } }],
    ['玄幻', { evidence, rules: wrongRules }], ['玄幻', { evidence, rules: staleRules }]
  ]) {
    const result = evidenceLib.loadGenreRuntime(genre, options);
    assert.notEqual(result.status, 'ready');
    assert.equal(result.writingBlock, '');
    assert.equal(result.reviewBlock, '');
  }
});

test('规则：六题材可选方法都有已评摘段来源，旧数值门禁及伪范句撤下', () => {
  for (const genre of evidenceLib.GENRES) {
    const evidence = readJson(`data/genre-evidence/${genre}.json`);
    const rules = readJson(`data/genre-rules/${genre}.json`);
    assert.deepEqual(evidenceLib.validateGenreRules(rules, evidence), { valid: true, errors: [] });
    assert.deepEqual(rules.targetMetrics, {});
    assert.deepEqual(rules.positivePatterns, []);
    assert.deepEqual(rules.negativePatterns, []);
    assert.match(rules.policy.nameOverlap, /不构成硬门禁/u);
    assert.match(rules.policy.ending, /unknown/u);
    assert.equal(rules.decisionCards.length, 2);
  }
});

test('基线资产：固定候选窗口不补样，来源与新度量重算一致且不写data', async () => {
  const { buildGenreBaseline } = await import('../scripts/build-genre-baselines.mjs');
  const index = readJson('data/genre-baselines/index.json');
  assert.equal(index.measurementVersion, metrics.MEASUREMENT_VERSION);
  for (const genre of evidenceLib.GENRES) {
    const stored = readJson(`data/genre-baselines/${genre}.json`);
    const rebuilt = buildGenreBaseline(genre, { books: 20, chapters: 3 });
    const { generatedAt: storedTime, ...expected } = stored;
    const { generatedAt: rebuiltTime, ...actual } = rebuilt;
    assert.ok(storedTime && rebuiltTime);
    assert.deepEqual(actual, expected, genre);
    assert.equal(stored.bookCount + stored.skipped.length, stored.sampling.consideredCount);
    assert.equal(stored.sampling.method, 'sorted-file-window-without-refill');
    const evidence = readJson(`data/genre-evidence/${genre}.json`);
    for (const book of evidence.books) {
      const baselineBook = stored.books.find(item => item.source.sha256 === book.source.sha256);
      assert.ok(baselineBook);
      assert.deepEqual(baselineBook.chapterChars, book.chapters.map(chapter => chapter.metrics.structure.chars));
      assert.deepEqual(baselineBook.chapters.map(chapter => chapter.sha256), book.chapters.map(chapter => chapter.sha256));
    }
  }
});

test('来源验收：原始字节、解码、章边界及全部段落均回查，仅只读明确范本路径', () => {
  for (const genre of evidenceLib.GENRES) {
    const evidence = readJson(`data/genre-evidence/${genre}.json`);
    const sourceBuffers = {};
    for (const book of evidence.books) {
      const expectedPrefix = `资源库/小说原本/${genre}/`;
      assert.ok(book.source.path.startsWith(expectedPrefix));
      assert.equal(book.source.path.slice(expectedPrefix.length).includes('/'), false);
      const sourcePath = path.resolve(ROOT, '..', book.source.path);
      const archive = fs.realpathSync(path.resolve(ROOT, '..', '资源库', '小说原本'));
      const relative = path.relative(archive, fs.realpathSync(sourcePath));
      assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative));
      sourceBuffers[book.source.path] = fs.readFileSync(sourcePath);
    }
    assert.deepEqual(evidenceLib.validateGenreEvidence(evidence, { sourceBuffers }), { valid: true, errors: [], sourceVerified: true });
    if (genre === evidenceLib.GENRES[0]) {
      const changed = structuredClone(evidence);
      changed.books[0].chapters[0].paragraphs.pop();
      assert.equal(evidenceLib.validateGenreEvidence(changed, { sourceBuffers }).valid, false);
      const corrupted = { ...sourceBuffers, [evidence.books[0].source.path]: Buffer.concat([sourceBuffers[evidence.books[0].source.path], Buffer.from('changed')]) };
      assert.equal(evidenceLib.validateGenreEvidence(evidence, { sourceBuffers: corrupted }).valid, false);
    }
  }
});
