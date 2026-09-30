import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  calculateRawGenreCoverage,
  evaluateArchiveRecord,
  evaluateAuthorization,
  normalizeCompletionStatus,
  normalizeGitHubRepository,
  platformWorkIdFromUrl,
  validatePlatformMetadata,
  verifyLocalEvidenceReference
} from '../../资源库/scripts/corpus-utils.mjs';
import {
  buildArchiveRelativePath,
  checkArchiveWrite,
  extractChapterBodyForPlatform,
  parseChapterLinksForPlatform,
  parseGitHubFileWork,
  readOptions,
  runQualityGates
} from '../../资源库/scripts/fetch-novel.mjs';
import { buildArchiveGroups, inspectArchiveFile, mergeBookParts, readFetchMetadata } from '../../资源库/scripts/build-manifest.mjs';
import { buildMigrationReport } from '../../资源库/scripts/legacy-sample-migration.mjs';
import material from '../lib/character-material.js';
import { buildReviewBatches, candidateReviewGroupKey, parseReviews, readExistingReview } from '../scripts/review-character-candidates.mjs';
import {
  buildArchiveCandidateRows,
  buildCanonicalDedupAudit,
  buildIndex,
  buildIncrementalCorpus,
  buildProfiles,
  buildQuotaReport,
  extractCharacterEvidence,
  applyClassificationReviews,
  confirmCatchphraseRows,
  evaluateRawGenreProfiles,
  evaluateProfileRelease,
  calculatePlatformCoverage,
  calculateProfile,
  evaluateMarkdownPublication,
  parseSourceMarkdown,
  stableCharacterKey,
  renderPublishedMarkdown,
  renderPublicReleaseMarkdown,
  scoreWorkForSelection,
  selectPublicationRows,
  selectPerBookCellCap,
  validateQuotaConfig,
  loadQuotaConfig
} from '../scripts/build-character-material-index.mjs';

const resourceRoot = path.resolve(import.meta.dirname, '..', '..', '资源库');
const quotaConfigFile = path.join(resourceRoot, 'quota-config.json');
const blocklistFile = path.join(resourceRoot, 'ip-blocklist.json');
const quotaConfig = fs.existsSync(quotaConfigFile) ? JSON.parse(fs.readFileSync(quotaConfigFile, 'utf8')) : {};
const blocklist = fs.existsSync(blocklistFile) ? JSON.parse(fs.readFileSync(blocklistFile, 'utf8')) : {};
const testCorpusConfig = {
  ...quotaConfig,
  requireCompletedWork: false,
  requireFullWork: false,
  requireCompletionEvidence: false,
  requireCompletionEvidenceVerification: false,
  requireFullWorkEvidence: false,
  requireContentHash: false,
  requireChapterSetEvidence: false,
  requireChapterOrderEvidence: false,
  authorizationPolicy: { requiredForArchiveUse: false }
};

test('抓取参数拒绝非法间隔和非整数限章，并保留合规值', () => {
  const base = ['--url', 'https://example.test/book', '--bucket', '都市', '--title', '测试书'];
  assert.throws(() => readOptions([...base, '--delay', 'NaN']), /--delay 必须是数字/);
  assert.throws(() => readOptions([...base, '--max-chapters', '1.5']), /--max-chapters 必须是非负整数/);
  const options = readOptions([
    ...base,
    '--genres', '都市,现实',
    '--primary-genre', '都市',
    '--audience', '女频',
    '--authorization-status', 'licensed',
    '--authorization-scope', 'corpus',
    '--authorization-evidence', 'test:evidence',
    '--completion-status', '已完结', '--completion-evidence', 'test:completion',
    '--delay', '2', '--max-chapters', '3'
  ]);
  assert.equal(options.delayMs, 2000);
  assert.equal(options.maxChapters, 3);
  assert.deepEqual(options.genres, ['都市', '现实']);
  assert.equal(options.primaryGenre, '都市');
  assert.equal(options.audience, '女频');
  assert.deepEqual(options.authorization, {
    status: 'licensed', scope: 'corpus', evidenceRef: 'test:evidence', evidenceSha256: '', evidenceVerified: false,
    expiresAt: '', rightsHolder: '', license: '', archiveUseAllowed: false,
    modelProcessingAllowed: false, redistributionAllowed: false, runtimeUseAllowed: false
  });
  assert.equal(options.completionStatus, 'completed');
  assert.equal(options.completionEvidenceRef, 'test:completion');
});

test('平台作品 ID、目录榜单元数据和 GitHub 固定版本证据必须可核验', () => {
  assert.equal(platformWorkIdFromUrl('https://www.qimao.com/shuku/123456/'), '123456');
  assert.equal(platformWorkIdFromUrl('https://fanqienovel.com/page/753123456789'), '753123456789');
  assert.equal(platformWorkIdFromUrl('https://book.qidian.com/info/1012345678/'), '1012345678');
  assert.equal(normalizeGitHubRepository('https://github.com/sennic/BL.git'), 'sennic/BL');

  const catalogSnapshot = {
    capturedAt: '2026-08-27T00:00:00.000Z',
    chapterCount: 2,
    chapterIds: ['chapter-1', 'chapter-2'],
    snapshotSha256: 'a'.repeat(64)
  };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-platform-evidence-'));
  const rankingText = '七猫都市榜｜总榜第 2 名｜热度｜2026-08-27';
  fs.writeFileSync(path.join(root, 'ranking.txt'), rankingText, 'utf8');
  const rankingSha256 = crypto.createHash('sha256').update(rankingText).digest('hex');
  const qimao = validatePlatformMetadata({
    platform: '七猫',
    sourceUrl: 'https://www.qimao.com/shuku/123456/',
    platformWorkId: '123456',
    catalogSnapshot,
    ranking: {
      ranks: { overall: 2 }, type: '全站榜', metric: '热度',
      capturedAt: '2026-08-27T00:00:00.000Z', evidenceRef: 'ranking.txt', evidenceSha256: rankingSha256
    }
  }, { evidenceRoot: root });
  assert.equal(qimao.verified, true);
  const mismatched = validatePlatformMetadata({
    platform: '七猫',
    sourceUrl: 'https://www.qimao.com/shuku/123456/',
    platformWorkId: '654321',
    catalogSnapshot,
    ranking: qimao.ranking
  });
  assert.ok(mismatched.reasons.includes('platformWorkIdMismatch'));

  const githubRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-github-evidence-'));
  const licenseText = 'SPDX-License-Identifier: CC-BY-4.0';
  const licensePath = path.join(githubRoot, 'LICENSE.txt');
  fs.writeFileSync(licensePath, licenseText, 'utf8');
  const licenseSha256 = crypto.createHash('sha256').update(licenseText).digest('hex');
  try {
    const github = validatePlatformMetadata({
      platform: 'GitHub',
      sourceUrl: 'https://raw.githubusercontent.com/sennic/BL/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/book.txt',
      repository: 'sennic/BL',
      sourcePath: 'book.txt',
      commitSha: 'b'.repeat(40),
      licenseEvidenceRef: 'LICENSE.txt',
      licenseEvidenceSha256: licenseSha256
    }, { evidenceRoot: githubRoot });
    assert.equal(github.verified, true);
    const badRepository = validatePlatformMetadata({
      platform: 'GitHub',
      sourceUrl: github.sourceUrl,
      repository: 'other/BL',
      sourcePath: 'book.txt',
      commitSha: 'b'.repeat(40),
      licenseEvidenceRef: 'LICENSE.txt',
      licenseEvidenceSha256: licenseSha256
    }, { evidenceRoot: githubRoot });
    assert.ok(badRepository.reasons.includes('githubRepositoryMismatch'));
  } finally {
    fs.rmSync(githubRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('平台适配器分别解析目录和正文，GitHub 固定文件按章节拆分', () => {
  const qimaoCatalog = parseChapterLinksForPlatform(
    '<a href="/shuku/123-001/">第一章</a><a href="/shuku/123-002/">第二章</a>',
    'https://www.qimao.com/shuku/123/',
    '七猫'
  );
  assert.equal(qimaoCatalog.adapterId, 'qimao-html-v1');
  assert.equal(qimaoCatalog.catalogStrategy, 'qimao-html-v1:catalog');
  assert.deepEqual(qimaoCatalog.links.map(item => item.title), ['第一章', '第二章']);

  const body = extractChapterBodyForPlatform(
    '<div class="txtBox"><p>张三抬眼核对门锁，确认没有异常。</p></div>',
    '七猫'
  );
  assert.equal(body.bodyStrategy, 'qimao-html-v1:body');
  assert.equal(body.fallbackUsed, false);
  assert.match(body.text, /张三抬眼核对门锁/);

  const github = parseGitHubFileWork(
    `第一章\n${'张三先核对现场，再决定是否进入房间。'.repeat(8)}\n\n第二章\n${'他没有解释，只把证据收进文件夹。'.repeat(8)}`,
    'https://raw.githubusercontent.com/example/novels/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/book.txt'
  );
  assert.equal(github.adapterId, 'github-file-v1');
  assert.equal(github.catalogStrategy, 'github-fixed-commit-file');
  assert.equal(github.chapters.length, 2);
  assert.equal(github.catalogSnapshot.chapterCount, 2);
  assert.ok(github.chapters.every(chapter => chapter.url.includes('raw.githubusercontent.com')));
});

test('目录证据哈希校验失败时抓取质量门禁不得放行', () => {
  const chapters = [1, 2].map(index => ({
    chapterId: `chapter-${index}`,
    url: `https://example.test/chapter/${index}`,
    text: '他抬眼核对门锁，确认没有异常。'.repeat(80)
  }));
  const result = runQualityGates('正文', chapters, quotaConfig, blocklist, {
    completionStatus: 'completed',
    completionEvidenceRef: 'completion.txt',
    completionEvidenceVerified: true,
    contentScope: 'full_work',
    fullWorkEvidenceRef: 'full-work.txt',
    fullWorkEvidenceVerified: true,
    chapterCountDeclared: true,
    expectedChapterCount: 2,
    catalogEvidenceVerified: false,
    catalogSnapshot: {
      capturedAt: '2026-08-27T00:00:00.000Z',
      chapterCount: 2,
      chapterIds: ['chapter-1', 'chapter-2'],
      duplicateChapterIds: [],
      snapshotSha256: 'a'.repeat(64)
    }
  });
  assert.equal(result.catalogEvidenceVerified, false);
  assert.ok(result.reasons.includes('chapterSetEvidenceUnverified'));
});

test('发布版溯源行不会在再次解析时并入样本正文', () => {
  const rows = parseSourceMarkdown([
    '## 冷静理智型',
    '### 语言',
    '**1. 测试作品**',
    '> 来源哈希：abc；原题材：都市；题材桶：都市；平台：番茄',
    '> 样本ID：sample-1；作品ID：work-1；归档文件：小说原本/都市/测试.txt',
    '> 章节ID：1；章节标题：第一章；章节URL：https://example.test/chapter/1',
    '> 原文偏移：1-10（utf16-code-unit）；候选文本 SHA-256：abc；原书文件 SHA-256：def',
    '> 她先核对证据，再决定是否开门。'
  ].join('\n'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].text, '她先核对证据，再决定是否开门。');
});

test('未完结和英文否定状态不会被误识别为 completed', () => {
  assert.equal(normalizeCompletionStatus('未完结'), 'ongoing');
  assert.equal(normalizeCompletionStatus('incomplete'), 'ongoing');
  assert.equal(normalizeCompletionStatus('not complete'), 'ongoing');
  assert.equal(normalizeCompletionStatus('not completed'), 'ongoing');
  assert.equal(normalizeCompletionStatus('已完结'), 'completed');
  assert.equal(normalizeCompletionStatus('弃坑'), 'abandoned');
});

test('全文、完结证据、哈希和主归属门禁必须同时满足', () => {
  const base = {
    rawGenres: ['都市'],
    primaryGenre: '都市',
    completionStatus: 'completed',
    completionEvidenceRef: 'test:completion',
    completionEvidenceVerified: true,
    contentScope: 'full_work',
    fullWorkEvidenceRef: 'test:full-work',
    fullWorkEvidenceVerified: true,
    expectedChapterCount: 10,
    fetchedChapterCount: 10,
    chapterCountDeclared: true,
    contentHash: '0'.repeat(64),
    catalogSnapshot: {
      snapshotSha256: '1'.repeat(64),
      chapterIds: Array.from({ length: 10 }, (_, index) => String(index + 1)),
      duplicateChapterIds: []
    },
    chapters: Array.from({ length: 10 }, (_, index) => ({ chapterId: String(index + 1) })),
    authorization: {
      status: 'licensed', scope: 'corpus', evidenceRef: 'test:license', evidenceSha256: '2'.repeat(64),
      evidenceVerified: true, rightsHolder: '测试权利人', license: '测试许可',
      archiveUseAllowed: true, modelProcessingAllowed: true, runtimeUseAllowed: true
    },
    quality: { incomplete: false, partial: false }
  };
  assert.equal(evaluateArchiveRecord(base, quotaConfig).usable, true);
  assert.equal(evaluateArchiveRecord({ ...base, contentScope: 'partial' }, quotaConfig).reasons.includes('fullWorkUnverified'), true);
  assert.equal(evaluateArchiveRecord({ ...base, fetchedChapterCount: 9 }, quotaConfig).reasons.includes('fullWorkUnverified'), true);
  assert.equal(evaluateArchiveRecord({ ...base, chapterCountDeclared: false }, quotaConfig).reasons.includes('chapterCountEvidenceMissing'), true);
  assert.equal(evaluateArchiveRecord({ ...base, completionEvidenceRef: '' }, quotaConfig).reasons.includes('completionEvidenceMissing'), true);
  assert.equal(evaluateArchiveRecord({ ...base, primaryGenre: '' }, quotaConfig).reasons.includes('primaryGenreUnverified'), true);
  assert.equal(evaluateArchiveRecord({ ...base, catalogSnapshot: null, chapters: [] }, quotaConfig).reasons.includes('chapterSetEvidenceUnverified'), true);
  const reversed = evaluateArchiveRecord({
    ...base,
    chapters: base.chapters.slice().reverse()
  }, quotaConfig);
  assert.equal(reversed.chapterOrderMatches, false);
  assert.equal(reversed.reasons.includes('chapterOrderMismatch'), true);
  assert.equal(reversed.usable, false);
});

test('高热度选样必须有排名证据，GitHub 或平台标签只作为辅助分', () => {
  const common = {
    platform: '番茄',
    primaryGenre: '都市',
    completionStatus: 'completed',
    authorization: { status: 'licensed', scope: 'corpus', evidenceRef: 'test:license' }
  };
  const ranked = scoreWorkForSelection({
    ...common,
    ranking: {
      ranks: { overall: 3 }, capturedAt: '2026-08-27T00:00:00Z', evidenceRef: 'test:rank',
      evidenceSha256: 'a'.repeat(64), evidenceVerified: true
    }
  }, quotaConfig);
  const unverified = scoreWorkForSelection({ ...common, ranking: { ranks: { overall: 1 } } }, quotaConfig);
  assert.equal(ranked.rankingEvidence, true);
  assert.equal(unverified.rankingEvidence, false);
  assert.ok(ranked.score > unverified.score);
});

test('焦点切片支持至少命中指定数量的原题材，避免要求作品同时填写三个标签', () => {
  const config = {
    archetypes: ['冷静理智型'],
    genreBuckets: { 都市: ['都市'] },
    sourceBucketMap: { 都市: '都市', 玄幻: '都市', 言情: '都市' },
    bucketPriority: ['都市'],
    focusSlices: [{ id: 'female-urban-fantasy', runtimeKey: '女频|玄幻+都市+言情', audience: '女频', genres: ['玄幻', '都市', '言情'], genreMatch: 'at_least', minimumGenreHits: 2, requiresExplicitAudience: true }],
    profileMinimumChars: 1,
    profileMinimumWorks: 1,
    profileMinimumDimensions: 1
  };
  const rejected = buildProfiles([{
    archetype: '冷静理智型',
    dimension: 'psychology',
    rawGenres: ['都市'],
    audience: '女频',
    sourceWorkId: 'focus-1',
    text: '她先核对证据，再决定是否开门。'
  }], config);
  assert.equal(rejected.profiles['冷静理智型|女频|玄幻+都市+言情'].sampleCount, 0);
  const result = buildProfiles([{
    archetype: '冷静理智型',
    dimension: 'psychology',
    rawGenres: ['都市', '玄幻'],
    audience: '女频',
    sourceWorkId: 'focus-2',
    text: '她先核对证据，再决定是否开门。'
  }], config);
  assert.equal(result.profiles['冷静理智型|女频|玄幻+都市+言情'].sampleCount, 1);
});

test('本地证据必须存在且哈希匹配，外部 URL 不能作为授权凭证', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-evidence-'));
  const evidencePath = path.join(root, 'license.txt');
  const content = '测试授权凭证';
  fs.writeFileSync(evidencePath, content, 'utf8');
  const digest = crypto.createHash('sha256').update(content).digest('hex');
  try {
    assert.equal(verifyLocalEvidenceReference('license.txt', digest, root).verified, true);
    assert.equal(verifyLocalEvidenceReference('license.txt', '0'.repeat(64), root).reason, 'evidence_hash_mismatch');
    assert.equal(verifyLocalEvidenceReference('https://example.test/license', '', root).reason, 'evidence_reference_not_local');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('口头禅必须由同一人物在三个不同章节重复确认', () => {
  const repeated = [1, 2, 3].map(chapterNumber => ({
    candidateId: `catchphrase-${chapterNumber}`,
    sourceWorkId: 'catchphrase-work',
    dimension: 'catchphrase',
    text: '他抬眼说：“我先看看。”',
    classification: { characterKey: 'catchphrase-character' },
    provenance: { chapterNumber }
  }));
  const single = {
    candidateId: 'catchphrase-single',
    sourceWorkId: 'single-work',
    dimension: 'catchphrase',
    text: '她低声说：“我先看看。”',
    classification: { characterKey: 'single-character' },
    provenance: { chapterNumber: 1 }
  };
  const confirmed = confirmCatchphraseRows([...repeated, single], testCorpusConfig);
  assert.ok(confirmed.slice(0, 3).every(row => row.classification.catchphraseStatus === 'confirmed'));
  assert.equal(confirmed[0].classification.catchphraseChapterCount, 3);
  assert.equal(confirmed[3].classification.catchphraseStatus, 'candidate');

  const deduped = confirmCatchphraseRows([{
    candidateId: 'catchphrase-deduped',
    sourceWorkId: 'catchphrase-work',
    dimension: 'catchphrase',
    text: '他抬眼说：“我先看看。”',
    classification: { characterKey: 'catchphrase-character' },
    occurrences: [1, 2, 3].map(chapterNumber => ({ chapterNumber }))
  }], testCorpusConfig);
  assert.equal(deduped[0].classification.catchphraseStatus, 'confirmed');
  assert.equal(deduped[0].classification.catchphraseChapterCount, 3);
});

test('人物证据保留主体状态和维度跨度，模型可以纠正词法标签', () => {
  const evidence = extractCharacterEvidence('张三抬眼看向门口，说：“我先核对证据。”');
  assert.equal(evidence.status, 'candidate');
  assert.equal(evidence.speakerCue, true);
  assert.ok(evidence.evidenceSpans.action);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-corpus-review-'));
  const reviewPath = path.join(root, 'review.json');
  try {
    const inputBinding = {
      candidateTextHash: 'a'.repeat(16),
      candidateTextSha256: 'b'.repeat(64),
      chapterTextHash: 'c'.repeat(16),
      chapterTextSha256: 'd'.repeat(64),
      sourceContentHash: 'e'.repeat(64),
      sourceTextHash: 'f'.repeat(64)
    };
    const row = {
      candidateId: 'candidate-correct-label',
      archetype: '热血冲动型',
      dimension: 'action',
      text: '张三抬眼看向门口，说：“我先核对证据。”',
      characterEvidence: evidence,
      classification: { method: 'lexical', modelReview: 'pending' },
      provenance: inputBinding
    };
    fs.writeFileSync(reviewPath, JSON.stringify({ reviews: [{
      candidateId: row.candidateId,
      isMatch: true,
      confidence: 0.95,
      archetype: '冷静理智型',
      dimension: 'psychology',
      characterEntityStatus: 'confirmed',
      characterName: '张三',
      characterKey: 'test-character',
      modelId: 'test-model',
      promptVersion: 'character-candidate-review-v3',
      inputBinding,
      entityEvidenceSpans: [{ source: 'text', start: 0, end: 2, signal: '张三' }],
      evidenceSpans: { psychology: { start: 0, end: 4 } }
    }] }));
    const applied = applyClassificationReviews([row], reviewPath, quotaConfig);
    assert.equal(applied.approved, 1);
    assert.equal(applied.rows[0].archetype, '冷静理智型');
    assert.equal(applied.rows[0].dimension, 'psychology');
    assert.equal(applied.rows[0].classification.entityStatus, 'confirmed');

    const bindingMismatchPath = path.join(root, 'binding-mismatch.json');
    fs.writeFileSync(bindingMismatchPath, JSON.stringify({ reviews: [{
      candidateId: row.candidateId,
      isMatch: true,
      confidence: 0.95,
      archetype: '冷静理智型',
      dimension: 'psychology',
      characterEntityStatus: 'confirmed',
      characterName: '张三',
      characterKey: 'test-character',
      modelId: 'test-model',
      promptVersion: 'character-candidate-review-v3',
      inputBinding: { ...inputBinding, candidateTextHash: '0'.repeat(16) },
      entityEvidenceSpans: [{ source: 'text', start: 0, end: 2, signal: '张三' }],
      evidenceSpans: { psychology: { start: 0, end: 4 } }
    }] }));
    const bindingMismatch = applyClassificationReviews([row], bindingMismatchPath, quotaConfig);
    assert.equal(bindingMismatch.approved, 0);
    assert.equal(bindingMismatch.rows[0].classification.modelReviewReason, 'review_input_binding_mismatch');

    const evidenceMismatchPath = path.join(root, 'evidence-mismatch.json');
    fs.writeFileSync(evidenceMismatchPath, JSON.stringify({ reviews: [{
      candidateId: row.candidateId,
      isMatch: true,
      confidence: 0.95,
      archetype: '冷静理智型',
      dimension: 'psychology',
      characterEntityStatus: 'confirmed',
      characterName: '张三',
      characterKey: 'test-character',
      modelId: 'test-model',
      promptVersion: 'character-candidate-review-v3',
      inputBinding,
      entityEvidenceSpans: [{ source: 'text', start: 0, end: 2, signal: '张三' }],
      evidenceSpans: { psychology: { start: 0, end: row.text.length + 1 } }
    }] }));
    const evidenceMismatch = applyClassificationReviews([row], evidenceMismatchPath, quotaConfig);
    assert.equal(evidenceMismatch.approved, 0);
    assert.equal(evidenceMismatch.rows[0].classification.modelReviewReason, 'evidence_spans_invalid');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('抓取归档使用来源身份，默认拒绝不同内容覆盖', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-fetch-identity-'));
  const first = Buffer.from('第一章\n甲', 'utf8');
  const second = Buffer.from('第一章\n乙', 'utf8');
  try {
    const firstPath = buildArchiveRelativePath('都市', '同名书', 'novel-source-a');
    const secondPath = buildArchiveRelativePath('都市', '同名书', 'novel-source-b');
    assert.notEqual(firstPath, secondPath);
    const target = path.join(root, 'archive.txt');
    fs.writeFileSync(target, first);
    assert.equal(checkArchiveWrite(target, first), 'reused');
    assert.throws(() => checkArchiveWrite(target, second), /拒绝覆盖已有不同内容/);
    assert.equal(checkArchiveWrite(target, second, true), 'overwritten');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('限章抓取进入质量门禁的 partial 状态', () => {
  const chapters = [
    { title: '第一章', text: '这是一段足够长的章节正文，用于验证限章抓取不会被误判成完整作品。' },
    { title: '第二章', text: '这是第二段足够长的章节正文，用于构造门禁输入。' }
  ];
  const quality = runQualityGates(chapters.map(chapter => chapter.text).join('\n'), chapters, quotaConfig, blocklist, { partial: true });
  assert.equal(quality.partial, true);
  assert.equal(quality.reasons.includes('partial'), true);
});

test('原题材覆盖同时区分来源、素材和可用原书', () => {
  const config = {
    rawGenres: ['都市', '科幻'],
    sourceBucketMap: { 都市: '都市', 科幻: null },
    rawGenreTargetBooks: 2,
    rawGenreCountMode: 'primary'
  };
  const sources = {
    sources: [
      { status: 'ok', novelid: 1, work_title: '甲', genre: '都市', url: 'https://example.test/1' },
      { status: 'ok', novelid: 2, work_title: '乙', genre: '都市', url: 'https://example.test/2' },
      { status: 'ok', novelid: 3, work_title: '丙', genre: '科幻', url: 'https://example.test/3' }
    ]
  };
  const coverage = calculateRawGenreCoverage(sources, config, [
      { sourceWorkId: 'novel-1', rawGenres: ['都市'], primaryGenre: '都市' }
  ], {
    books: [
      { id: 'book-1', sourceNovelId: '1', rawGenres: ['都市'], excludeFromCorpus: false, authorization: { status: 'licensed', scope: 'corpus', evidenceRef: 'test:book-1' } },
      { id: 'book-2', sourceNovelId: '2', rawGenres: ['都市'], excludeFromCorpus: true, authorization: { status: 'licensed', scope: 'corpus', evidenceRef: 'test:book-2' } }
    ]
  });
  const city = coverage.byGenre.都市;
  assert.equal(city.successfulBooks, 2);
  assert.equal(city.primarySuccessfulBooks, 2);
  assert.equal(city.materializedBooks, 1);
  assert.equal(city.primaryMaterializedBooks, 1);
  assert.equal(city.archivedBooks, 2);
  assert.equal(city.usableArchivedBooks, 1);
  assert.equal(city.countedUsableArchivedBooks, 1);
  assert.equal(city.unverifiedArchivedBooks, 0);
  assert.equal(city.archiveGapBooks, 1);
  assert.equal(city.gapBooks, 1);
  assert.equal(city.countMode, 'primary');
  assert.equal(city.status, 'gap');
  assert.equal(coverage.byGenre.科幻.status, 'gap');
  assert.equal(Object.keys(coverage.byGenre).length, 2);
});

test('授权证据缺失时原书不进入可用归档口径', () => {
  const missing = evaluateAuthorization({ status: 'licensed' }, { requiredForArchiveUse: true });
  assert.equal(missing.usable, false);
  assert.equal(missing.reason, 'authorization_evidence_missing');
  const fetchStateOnly = evaluateAuthorization({ status: 'ok', work_title: '测试书' }, { requiredForArchiveUse: true });
  assert.equal(fetchStateOnly.authorization.status, '');
  const verified = evaluateAuthorization({ status: 'licensed', scope: 'corpus', evidenceRef: 'test:evidence' }, { requiredForArchiveUse: true });
  assert.equal(verified.usable, true);
});

test('18 个原题材保持独立统计键，不因四个运行时桶折叠', () => {
  const config = JSON.parse(fs.readFileSync(path.join(resourceRoot, 'quota-config.json'), 'utf8'));
  assert.deepEqual(validateQuotaConfig(config), { valid: true, errors: [] });
  const coverage = calculateRawGenreCoverage({ sources: [] }, config, [], { books: [] });
  assert.equal(config.rawGenres.length, 18);
  assert.deepEqual(Object.keys(coverage.byGenre), config.rawGenres);
});

test('生产配额配置拒绝会放宽原题材和授权门禁的配置', () => {
  assert.equal(validateQuotaConfig({ ...quotaConfig, rawGenreCountMode: 'tagged' }).valid, false);
  assert.equal(validateQuotaConfig({ ...quotaConfig, rawGenreTargetBooks: 1 }).valid, false);
  assert.throws(() => loadQuotaConfig({ quotaConfigValue: { ...quotaConfig, requireFullWork: false } }), /配额配置无效/);
});

test('已审核候选没有稳定人物标识时不得通过入库门禁', () => {
  const row = {
    candidateId: 'candidate-no-character-key',
    archetype: '冷静理智型',
    dimension: 'psychology',
    classification: {
      modelReview: 'approved',
      modelConfidence: 0.95,
      entityStatus: 'confirmed'
    }
  };
  const applied = applyClassificationReviews([row], '', quotaConfig);
  assert.equal(applied.rows[0].classification.characterKey, undefined);
  assert.equal(applied.rows[0].classification.modelReview, 'approved');
  assert.equal(buildIndex('', {
    sourceList: { sources: [] },
    archiveManifest: { books: [] },
    archiveCandidateRows: [row],
    quotaConfigValue: quotaConfig
  }).report.counts.archiveCandidatesEligible, 0);
});

test('同名跨平台作品没有明确 canonicalWorkId 时阻断去重门禁', () => {
  const audit = buildCanonicalDedupAudit({ books: [
    { id: 'qimao-1', title: '同名书', author: '作者', sourceWorkId: 'qimao-work', sourceUrl: 'https://qimao.com/book/1', platform: '七猫' },
    { id: 'fanqie-1', title: '同名书', author: '作者', sourceWorkId: 'fanqie-work', sourceUrl: 'https://fanqienovel.com/page/1', platform: '番茄' }
  ] }, quotaConfig);
  assert.equal(audit.pass, false);
  assert.equal(audit.issues[0].reason, 'canonical_work_id_required');
  const resolved = buildCanonicalDedupAudit({ books: [
    { id: 'qimao-1', title: '同名书', author: '作者', sourceWorkId: 'qimao-work', canonicalWorkId: 'same-work', canonicalWorkIdExplicit: true, sourceUrl: 'https://qimao.com/book/1', platform: '七猫' },
    { id: 'fanqie-1', title: '同名书', author: '作者', sourceWorkId: 'fanqie-work', canonicalWorkId: 'same-work', canonicalWorkIdExplicit: true, sourceUrl: 'https://fanqienovel.com/page/1', platform: '番茄' }
  ] }, quotaConfig);
  assert.equal(resolved.pass, true);
});

test('未映射四桶的原题材仍生成独立 raw 画像', () => {
  const result = buildProfiles([{
    archetype: '冷静理智型',
    dimension: 'psychology',
    rawGenres: ['科幻'],
    primaryGenre: '科幻',
    sourceWorkId: 'raw-only-1',
    text: '他检查仪器，确认舱门已经关闭。'
  }], quotaConfig);
  assert.equal(result.unmappedRows, 1);
  assert.equal(result.samples.length, 0);
  assert.equal(result.profiles['冷静理智型|raw:科幻'].sampleCount, 1);
  assert.equal(result.profiles['冷静理智型|raw:科幻'].charCount, '他检查仪器，确认舱门已经关闭。'.length);
});

test('raw 画像门禁覆盖全部十类人物和十八个原题材，并逐格校验六维度', () => {
  const config = {
    ...quotaConfig,
    rawGenreProfileMinimumChars: 1,
    rawGenreProfileMinimumSamples: 1,
    rawGenreProfileMinimumWorks: 1,
    rawGenreProfileMinimumDimensionChars: 1,
    rawGenreProfileMinimumDimensionSamples: 1,
    rawGenreProfileMinimumDimensionWorks: 1
  };
  const dimensionCoverage = Object.fromEntries(['appearance', 'expression', 'action', 'dialogue', 'catchphrase', 'psychology'].map(dimension => [dimension, 1]));
  const profiles = Object.fromEntries(config.archetypes.flatMap(archetype => config.rawGenres.map(genre => [
    `${archetype}|raw:${genre}`,
    {
      charCount: 1,
      sampleCount: 1,
      sourceWorkCount: 1,
      reliable: true,
      dimensionCoverage,
      dimensionSampleCoverage: dimensionCoverage,
      dimensionWorkCounts: dimensionCoverage
    }
  ])));
  const complete = evaluateRawGenreProfiles({ profiles }, config);
  assert.equal(complete.cellCount, 180);
  assert.equal(complete.passedCellCount, 180);
  assert.equal(complete.pass, true);

  const missingKey = `${config.archetypes[0]}|raw:${config.rawGenres[0]}`;
  const incomplete = evaluateRawGenreProfiles({ profiles: {
    ...profiles,
    [missingKey]: { ...profiles[missingKey], dimensionCoverage: { ...dimensionCoverage, psychology: 0 } }
  } }, config);
  const missingCell = incomplete.cells.find(cell => cell.key === missingKey);
  assert.equal(incomplete.pass, false);
  assert.equal(missingCell.status, 'gap');
  assert.ok(missingCell.reasons.includes('dimension_psychology'));
});

test('焦点切片同时执行最低作品数和最低字数门禁', () => {
  const config = {
    rawGenres: ['玄幻', '都市'],
    rawGenreAliases: {},
    sourceBucketMap: { 玄幻: '都市', 都市: '都市' },
    platformCoverage: {
      enforce: true,
      reportOnlyUntilEvidence: false,
      requiredForFocusSlices: ['七猫', '番茄', '起点'],
      minimumFocusSliceWorks: 3,
      minimumFocusSliceWorksPerPlatform: 3,
      minimumFocusSliceChars: 30000
    },
    focusSlices: [{
      id: 'female-urban-fantasy',
      runtimeKey: '女频|玄幻+都市',
      audience: '女频',
      genres: ['玄幻', '都市'],
      genreMatch: 'all',
      platforms: ['七猫', '番茄', '起点'],
      gate: 'enforce',
      requiresExplicitAudience: true
    }]
  };
  const result = calculatePlatformCoverage([{
    sourceWork: 'focus-1', rawGenres: ['玄幻', '都市'], audience: '女频', platform: '七猫', text: '短样本'
  }], config);
  const slice = result.focusSlices[0];
  assert.equal(slice.minimumWorksPass, false);
  assert.equal(slice.platformWorksPass, false);
  assert.equal(slice.minimumCharsPass, false);
  assert.equal(slice.pass, false);
  assert.equal(result.pass, false);
});

test('焦点切片不能用每个平台一部作品冒充逐平台三部作品', () => {
  const config = {
    rawGenres: ['玄幻', '都市'],
    sourceBucketMap: { 玄幻: '都市', 都市: '都市' },
    platformCoverage: {
      enforce: true,
      reportOnlyUntilEvidence: false,
      requiredForFocusSlices: ['七猫', '番茄', '起点'],
      minimumFocusSliceWorks: 3,
      minimumFocusSliceWorksPerPlatform: 2,
      minimumFocusSliceChars: 1
    },
    focusSlices: [{
      id: 'female-urban-fantasy',
      runtimeKey: '女频|玄幻+都市',
      audience: '女频',
      genres: ['玄幻', '都市'],
      genreMatch: 'all',
      platforms: ['七猫', '番茄', '起点'],
      gate: 'enforce',
      requiresExplicitAudience: true
    }]
  };
  const result = calculatePlatformCoverage(['七猫', '番茄', '起点'].map((platform, index) => ({
    sourceWork: `focus-${index + 1}`,
    rawGenres: ['玄幻', '都市'],
    audience: '女频',
    platform,
    text: '足够长的焦点切片样本'
  })), config);
  const slice = result.focusSlices[0];
  assert.equal(slice.minimumWorksPass, true);
  assert.equal(slice.missingPlatforms.length, 0);
  assert.equal(slice.platformWorksPass, false);
  assert.equal(slice.platformWorkCounts['七猫'], 1);
  assert.equal(slice.pass, false);
});

test('平台题材别名归一化后进入正确的原题材覆盖和一等画像', () => {
  const config = {
    archetypes: ['冷静理智型'],
    rawGenres: ['言情', '悬疑'],
    rawGenreAliases: { 现言: '言情', 惊悚: '悬疑' },
    genreBuckets: { 言情: ['言情'], 悬疑: ['悬疑'] },
    sourceBucketMap: { 言情: '言情', 悬疑: '悬疑' },
    bucketPriority: ['言情', '悬疑'],
    rawGenreTargetBooks: 1,
    rawGenreCountMode: 'primary',
    rawGenreProfileMode: 'orthogonal',
    rawGenreMinimumSampleChars: 1,
    rawGenreMinimumSampleWorks: 1,
    rawGenreMinimumSampleCount: 1,
    rawGenreRequiresUsableArchive: true,
    authorizationPolicy: { requiredForArchiveUse: false },
    profileMinimumChars: 1,
    profileMinimumWorks: 1,
    profileMinimumDimensions: 1
  };
  const sources = { sources: [{ status: 'ok', novelid: 1, work_title: '别名测试', genres: ['现言'], primaryGenre: '现言', url: 'https://example.test/1' }] };
  const coverage = calculateRawGenreCoverage(sources, config, [{
    sourceWorkId: 'novel-1', rawGenres: ['现言'], primaryGenre: '现言', text: '她核对证据。'
  }], { books: [{
    id: 'book-1', sourceNovelId: '1', rawGenres: ['现言'], primaryGenre: '现言', excludeFromCorpus: false,
    quality: { incomplete: false, partial: false }, authorization: {}
  }] });
  assert.equal(coverage.byGenre.言情.status, 'met');
  assert.equal(Object.prototype.hasOwnProperty.call(coverage.byGenre, '现言'), false);
  const profiles = buildProfiles([{
    archetype: '冷静理智型', dimension: 'psychology', rawGenres: ['现言'], primaryGenre: '现言', sourceWorkId: 'novel-1', text: '她核对证据。'
  }], config);
  assert.equal(profiles.profiles['冷静理智型|raw:言情'].sampleCount, 1);
  assert.equal(Object.keys(profiles.strictRawGenreProfiles).length, 2);
  assert.equal(Object.keys(profiles.aggregateRawGenreProfiles).length, 2);
});

test('canonicalWorkId 将跨平台同一本书按一个逻辑作品计数，同时保留样本字数门禁', () => {
  const config = {
    rawGenres: ['都市'],
    sourceBucketMap: { 都市: '都市' },
    rawGenreTargetBooks: 1,
    rawGenreCountMode: 'tagged',
    rawGenreMinimumSampleChars: 4,
    rawGenreMinimumSampleWorks: 1,
    rawGenreMinimumSampleCount: 1,
    rawGenreRequiresUsableArchive: true,
    authorizationPolicy: { requiredForArchiveUse: true }
  };
  const licensed = { status: 'licensed', scope: 'corpus', evidenceRef: 'test:license' };
  const sources = {
    sources: [
      { status: 'ok', novelid: 1, canonicalWorkId: 'canonical-same', work_title: '同一本书', genres: ['都市'], url: 'https://example.test/a', authorization: licensed, completionStatus: 'completed' },
      { status: 'ok', novelid: 2, canonicalWorkId: 'canonical-same', work_title: '同一本书', genres: ['都市'], url: 'https://example.test/b', authorization: licensed, completionStatus: 'completed' }
    ]
  };
  const coverage = calculateRawGenreCoverage(sources, config, [{
    sourceWorkId: 'novel-1', canonicalWorkId: 'canonical-same', rawGenres: ['都市'], text: '样本正文。'
  }], {
    books: [
      { id: 'book-a', sourceWorkId: 'novel-1', canonicalWorkId: 'canonical-same', rawGenres: ['都市'], excludeFromCorpus: false, quality: { incomplete: false, partial: false }, authorization: licensed },
      { id: 'book-b', sourceWorkId: 'novel-2', canonicalWorkId: 'canonical-same', rawGenres: ['都市'], excludeFromCorpus: false, quality: { incomplete: false, partial: false }, authorization: licensed }
    ]
  });
  const city = coverage.byGenre.都市;
  assert.equal(city.successfulBooks, 1);
  assert.equal(city.archivedBooks, 1);
  assert.equal(city.countedUsableArchivedBooks, 1);
  assert.equal(city.sampleStatus, 'met');
  assert.equal(city.status, 'met');
});

test('不同 canonicalWorkId 的同名作品不会共用逻辑 book ID', () => {
  const base = {
    title: '同名作品',
    bucket: '都市',
    rawGenres: ['都市'],
    primaryGenre: '都市',
    quality: { reasons: [], isFanfiction: false, forumLike: false, incomplete: false, partial: false },
    excludeFromCorpus: false,
    chapters: [],
    authorization: {}
  };
  const config = { requireCompletedWork: false, authorizationPolicy: { requiredForArchiveUse: false } };
  const first = mergeBookParts([{ ...base, filePath: 'a.txt', author: '甲', sourceWorkId: 'novel-a', canonicalWorkId: 'canonical-a' }], config);
  const second = mergeBookParts([{ ...base, filePath: 'b.txt', author: '乙', sourceWorkId: 'novel-b', canonicalWorkId: 'canonical-b' }], config);
  assert.notEqual(first.id, second.id);
  assert.equal(first.canonicalWorkId, 'canonical-a');
});

test('manifest 合并逻辑作品时保留平台和 GitHub provenance 字段', () => {
  const config = { requireCompletedWork: false, authorizationPolicy: { requiredForArchiveUse: false } };
  const merged = mergeBookParts([{
    title: 'GitHub 测试作品',
    bucket: 'raw/科幻',
    filePath: '小说原本/raw/科幻/测试.txt',
    sourceUrl: 'https://raw.githubusercontent.com/example/novels/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/book.txt',
    platform: 'GitHub',
    platformWorkId: '',
    repository: 'example/novels',
    sourcePath: 'book.txt',
    commitSha: 'b'.repeat(40),
    licenseEvidenceRef: '授权证据/example-license.txt',
    licenseEvidenceSha256: 'c'.repeat(64),
    licenseEvidenceVerified: true,
    platformMetadataVerified: true,
    platformMetadataReasons: [],
    sourceWorkId: 'github-example-book',
    canonicalWorkId: 'github-example-book',
    rawGenres: ['科幻'],
    primaryGenre: '科幻',
    quality: { reasons: [], incomplete: false, partial: false, fullWorkVerified: true, contentHashVerified: true },
    authorization: {},
    chapters: [],
    totalChars: 10,
    chapterCount: 0,
    expectedChapterCount: 0,
    fetchedChapterCount: 0,
    contentHash: 'd'.repeat(64),
    excludeFromCorpus: false
  }], config);
  assert.equal(merged.repository, 'example/novels');
  assert.equal(merged.sourcePath, 'book.txt');
  assert.equal(merged.commitSha, 'b'.repeat(40));
  assert.equal(merged.licenseEvidenceSha256, 'c'.repeat(64));
  assert.equal(merged.platformMetadataVerified, true);
  assert.equal(merged.parts[0].commitSha, 'b'.repeat(40));
});

test('无来源身份的同名非重叠章节分卷可以保守合并，重叠范围仍保持隔离', () => {
  const base = { title: '逆天邪神', author: '', canonicalWorkId: null, sourceWorkId: null, sourceNovelId: null, sourceUrl: '', contentHash: 'hash' };
  const parts = [
    { ...base, originalFileName: '逆天邪神(1-500章).txt', filePath: 'a.txt' },
    { ...base, originalFileName: '逆天邪神(2001-2198章).txt', filePath: 'b.txt' }
  ];
  const groups = buildArchiveGroups(parts);
  assert.equal(groups.size, 1);
  assert.equal([...groups.values()][0].length, 2);

  const overlapping = [
    { ...base, contentHash: 'hash-a', originalFileName: '逆天邪神(1-500章).txt', filePath: 'a.txt' },
    { ...base, contentHash: 'hash-b', originalFileName: '逆天邪神(400-800章).txt', filePath: 'b.txt' }
  ];
  assert.equal(buildArchiveGroups(overlapping).size, 2);
});

test('空画像返回有限比例且对话交替率封顶为 1', () => {
  const empty = calculateProfile([]);
  assert.equal(empty.singleSentenceParaRatio, 0);
  assert.equal(empty.dialogueRowRatio, 0);
  assert.equal(empty.dialogueNarrationAlternation, 0);
  const mixed = calculateProfile(['“甲。”', '他转身。', '“乙。”', '她点头。']);
  assert.ok(mixed.dialogueNarrationAlternation >= 0 && mixed.dialogueNarrationAlternation <= 1);
});

test('已授权章节候选为同一段保留全部命中的六个描写维度，并留下待复核状态', () => {
  const text = '张三穿着黑色长风衣，眉头紧皱，抬手握住门把，冷声道：“嗯，必须先核对证据，再决定是否进去。”他心想这次不能出错。';
  const result = buildArchiveCandidateRows({
    sourceList: {
      sources: [{
        status: 'ok',
        novelid: 9001,
        work_title: '授权测试书',
        author: '测试作者',
        genres: ['都市'],
        authorization: { status: 'licensed', scope: 'corpus', evidenceRef: 'test:license' },
         completionStatus: 'completed', completionEvidenceRef: 'test:completion',
         contentScope: 'full_work', expectedChapterCount: 3, fetchedChapterCount: 3,
         chapters: [1, 2, 3].map(chapterid => ({
           chapterid,
           url: `https://example.test/book/9001/chapter/${chapterid}`,
           text
         }))
      }]
    },
    archiveManifest: { books: [] },
    config: testCorpusConfig
  });
  assert.equal(result.skipped.sourceList.works, 0);
  assert.equal(result.rows.length, 6);
  assert.deepEqual(new Set(result.rows.map(row => row.dimension)), new Set(['appearance', 'expression', 'action', 'dialogue', 'catchphrase', 'psychology']));
  assert.ok(result.rows.every(row => row.classification.modelReview === 'pending'));
  assert.ok(result.rows.every(row => row.provenance.chapterId === '1'));
  assert.equal(result.rows.find(row => row.dimension === 'catchphrase').occurrences.length, 3);
});

test('原书候选需通过模型复核后才进入画像，待复核状态保留在审计统计', () => {
  const text = '张三穿着黑色长风衣，眉头紧皱，抬手握住门把，冷声道：“嗯，必须先核对证据，再决定是否进去。”张三心想这次不能出错。';
  const chapterText = `${text}\n`;
  const chapterUrl = 'https://example.test/book/9002/chapter/1';
  const candidates = buildArchiveCandidateRows({
    sourceList: {
      sources: [{
        status: 'ok', novelid: 9002, work_title: '授权原书', genres: ['都市'],
        authorization: { status: 'licensed', scope: 'corpus', evidenceRef: 'test:license' },
        completionStatus: 'completed', completionEvidenceRef: 'test:completion',
        contentScope: 'full_work', expectedChapterCount: 1, fetchedChapterCount: 1,
         chapters: [{ chapterid: 1, url: chapterUrl, text: chapterText }]
      }]
    },
    archiveManifest: { books: [] },
     config: testCorpusConfig
  }).rows;
  const archiveRelativePath = `小说原本/.test-authorized-${process.pid}.txt`;
  const archiveText = [1, 2, 3].map(chapterNumber => `第${chapterNumber}章\n${chapterText}`).join('');
  const chapterBodyOffsets = [1, 2, 3].map(chapterNumber => {
    const header = `第${chapterNumber}章\n`;
    return archiveText.indexOf(header) + header.length;
  });
  const archiveBuffer = Buffer.from(archiveText, 'utf8');
  const sourceContentHash = crypto.createHash('sha256').update(archiveBuffer).digest('hex');
  const sourceTextHash = crypto.createHash('sha256').update(archiveText).digest('hex');
  const buildOptions = {
    sourceList: { sources: [] },
    archiveManifest: { books: [{
      id: 'book-9002', title: '授权原书', sourceWorkId: 'novel-9002', rawGenres: ['都市'], primaryGenre: '都市',
      authorization: {
        status: 'licensed', scope: 'corpus', evidenceRef: 'test:license', evidenceSha256: 'a'.repeat(64),
        evidenceVerified: true, rightsHolder: '测试权利人', license: '测试许可',
        archiveUseAllowed: true, modelProcessingAllowed: true, runtimeUseAllowed: true
      },
      completionStatus: 'completed', completionEvidenceRef: 'test:completion', completionEvidenceVerified: true,
      contentScope: 'full_work', fullWorkEvidenceRef: 'test:full-work', fullWorkEvidenceVerified: true,
      expectedChapterCount: 3, fetchedChapterCount: 3, chapterCountDeclared: true, chapterCoverage: 1,
      contentHash: sourceContentHash, excludeFromCorpus: false, quality: { incomplete: false, partial: false, fullWorkVerified: true, contentHashVerified: true },
      filePath: archiveRelativePath,
      catalogSnapshot: { snapshotSha256: 'b'.repeat(64), chapterIds: ['1', '2', '3'], duplicateChapterIds: [] },
      chapters: [1, 2, 3].map(chapterNumber => ({ chapterId: String(chapterNumber), url: chapterUrl }))
    }] },
    archiveCandidateRows: candidates,
    quotaConfigValue: quotaConfig
  };
  const archiveRelativePathFromManifest = buildOptions.archiveManifest.books[0].filePath;
  assert.equal(archiveRelativePathFromManifest, archiveRelativePath);
  const archivePath = path.join(resourceRoot, archiveRelativePath);
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  fs.writeFileSync(archivePath, archiveBuffer);
  try {
    const pendingResult = buildIndex('', buildOptions);
    assert.equal(pendingResult.report.counts.archiveCandidates, 6);
    assert.equal(pendingResult.report.source.uniqueMaterializedWorks, 0);
    assert.equal(pendingResult.report.profiles.reliableCount, 0);
    assert.equal(pendingResult.index.audit.classification.pendingModelReviewRows, 6);

    const approvedCandidates = candidates.map(row => ({
      ...row,
      classification: {
        ...row.classification,
        modelReview: 'approved',
         modelConfidence: 0.95,
         entityStatus: 'confirmed',
         characterName: '张三',
         characterKey: stableCharacterKey(row, '张三'),
         catchphraseStatus: row.dimension === 'catchphrase' ? 'confirmed' : undefined,
         modelId: 'test-model',
         promptVersion: 'character-candidate-review-v3',
         inputBinding: {
           candidateTextHash: row.provenance.candidateTextHash,
           candidateTextSha256: row.provenance.candidateTextSha256,
           chapterTextHash: row.provenance.chapterTextHash,
           chapterTextSha256: row.provenance.chapterTextSha256,
           sourceContentHash,
           sourceTextHash
         },
         entityEvidenceSpans: [{ source: 'text', start: 0, end: 2, signal: '张三' }],
         evidenceSpans: { [row.dimension]: { start: 0, end: Math.min(4, row.text.length) } }
      },
      provenance: {
        ...row.provenance,
        sourceFilePath: archiveRelativePath,
        sourceContentHash,
        sourceTextHash,
        startOffset: row.provenance.startOffset + '第一章\n'.length,
        endOffset: row.provenance.endOffset + '第一章\n'.length,
        contextStartOffset: row.provenance.contextStartOffset + '第一章\n'.length,
        contextEndOffset: row.provenance.contextEndOffset + '第一章\n'.length,
        chapterUrl
      },
       occurrences: [1, 2, 3].map((chapterNumber, index) => ({
         ...row.provenance,
         sourceFilePath: archiveRelativePath,
         sourceContentHash,
         sourceTextHash,
         chapterNumber,
         chapterIndex: index,
         chapterId: String(chapterNumber),
         chapterUrl,
         startOffset: row.provenance.startOffset + chapterBodyOffsets[index],
         endOffset: row.provenance.endOffset + chapterBodyOffsets[index],
         contextStartOffset: row.provenance.contextStartOffset + chapterBodyOffsets[index],
         contextEndOffset: row.provenance.contextEndOffset + chapterBodyOffsets[index]
       }))
     }));
    const approvedResult = buildIndex('', { ...buildOptions, archiveCandidateRows: approvedCandidates });
    assert.equal(approvedResult.report.source.uniqueMaterializedWorks, 1);
    assert.equal(approvedResult.report.counts.provenanceExcluded, 0);
    assert.equal(approvedResult.index.audit.classification.pendingModelReviewRows, 0);

    const occurrenceMismatchResult = buildIndex('', {
      ...buildOptions,
      archiveCandidateRows: approvedCandidates.map(row => ({
        ...row,
        occurrences: row.occurrences.map((occurrence, index) => index === 1
          ? { ...occurrence, sourceContentHash: '0'.repeat(64) }
          : occurrence)
      }))
    });
    assert.equal(occurrenceMismatchResult.report.source.uniqueMaterializedWorks, 0);
    assert.equal(occurrenceMismatchResult.report.counts.provenanceExcluded > 0, true);
    assert.ok(Object.keys(occurrenceMismatchResult.report.source.provenanceExcludedReasons)
      .some(reason => reason.startsWith('sample_occurrence_2_')));

    const mismatchedResult = buildIndex('', {
      ...buildOptions,
      archiveCandidateRows: approvedCandidates.map(row => ({
        ...row,
        text: `${row.text}篡改`,
        provenance: { ...row.provenance, candidateTextHash: '0000000000000000' }
      }))
    });
    assert.equal(mismatchedResult.report.source.uniqueMaterializedWorks, 0);
    assert.equal(mismatchedResult.report.counts.archiveCandidatesEligible, 0);
  } finally {
    fs.rmSync(archivePath, { force: true });
  }
});

test('作品级候选缓存命中后不重复抽取来源章节', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-corpus-candidates-'));
  const text = '他穿着黑色长风衣，眉头紧皱，抬手握住门把，冷声道：“嗯，必须先核对证据，再决定是否进去。”他心想这次不能出错。';
  const sourceList = {
    sources: [{
      status: 'ok', novelid: 9010, work_title: '缓存测试书', genres: ['都市'],
      url: 'https://example.test/book/9010', completionStatus: 'completed', completionEvidenceRef: 'test:completion',
      contentScope: 'full_work', expectedChapterCount: 1, fetchedChapterCount: 1,
      authorization: { status: 'licensed', scope: 'corpus', evidenceRef: 'test:license' },
      chapters: [{ chapterid: 1, text }]
    }]
  };
  try {
    const first = buildArchiveCandidateRows({ sourceList, archiveManifest: { books: [] }, config: testCorpusConfig, blocklist, intermediate: root });
    const second = buildArchiveCandidateRows({ sourceList, archiveManifest: { books: [] }, config: testCorpusConfig, blocklist, intermediate: root });
    assert.ok(first.rows.length > 0);
    assert.equal(first.skipped.sourceList.generatedWorks, 1);
    assert.equal(second.skipped.sourceList.cachedWorks, 1);
    assert.equal(second.rows.length, first.rows.length);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('画像和配额按同一文本跨维度只计一次，并记录单书截断字数', () => {
  const config = {
    archetypes: ['冷静理智型'],
    genreBuckets: { 都市: ['都市'] },
    sourceBucketMap: { 都市: '都市' },
    bucketPriority: ['都市'],
    cellMinChars: 100,
    cellHardFloor: 20,
    perBookCellCapPct: 0.5,
    profileMinimumChars: 1,
    profileMinimumWorks: 1,
    profileMinimumDimensions: 1
  };
  const text = '先核对证据，再决定下一步动作，保持冷静。';
  const rows = ['appearance', 'expression'].map(dimension => ({
    sourceWorkId: 'book-1',
    sourceUrl: 'https://example.test/book-1',
    archetype: '冷静理智型',
    dimension,
    rawGenres: ['都市'],
    text
  }));
  const cap = selectPerBookCellCap([
    { ...rows[0], bucket: '都市', text: '甲'.repeat(40) },
    { ...rows[0], bucket: '都市', text: '乙'.repeat(20) }
  ], config);
  assert.equal(cap.cells['冷静理智型|都市'].rawChars, 60);
  assert.equal(cap.cells['冷静理智型|都市'].effectiveChars, 40);
  assert.equal(cap.cells['冷静理智型|都市'].trimmedChars, 20);
  assert.deepEqual(cap.perBookCapViolations, []);
  const profileResult = buildProfiles(rows, config);
  const quota = buildQuotaReport(profileResult, config);
  assert.equal(profileResult.profiles['冷静理智型|都市'].dimensionCount, 2);
  assert.equal(quota.cells[0].rawUniqueChars, text.length);
  assert.equal(quota.cells[0].effectiveChars, text.length);
});

test('最终发布去重键保留同一文本在不同描写维度的分类', () => {
  const config = {
    archetypes: ['冷静理智型'],
    cellMinChars: 100,
    perBookCellCapPct: 0.5,
    genreBuckets: { 都市: ['都市'] },
    sourceBucketMap: { 都市: '都市' },
    bucketPriority: ['都市']
  };
  const rows = ['appearance', 'psychology'].map(dimension => ({
    sampleKey: 'same-text',
    archetype: '冷静理智型',
    dimension,
    sourceWorkId: 'book-1',
    genreBucket: '都市',
    rawGenres: ['都市'],
    text: '同一段证据文本'
  }));
  assert.equal(selectPublicationRows(rows, config).rows.length, 2);
});

test('最终 Markdown 门禁要求类型字数、六维度和唯一作品数同时满足', () => {
  const config = {
    archetypes: ['冷静理智型'],
    uniqueUsableBookTarget: 1,
    publishedMinimumCharsByArchetype: 1
  };
  const dimensions = ['appearance', 'expression', 'action', 'dialogue', 'catchphrase', 'psychology'];
  const rows = dimensions.map(dimension => ({
    archetype: '冷静理智型',
    dimension,
    sourceWorkId: 'book-1',
    text: '样本文本'
  }));
  assert.equal(evaluateMarkdownPublication(true, rows, { pass: true }, config).pass, true);
  assert.equal(evaluateMarkdownPublication(true, rows.slice(1), { pass: true }, config).pass, false);
});

test('最终 Markdown 门禁不能用其他原题材补齐缺失的原题材', () => {
  const config = {
    archetypes: ['冷静理智型'],
    rawGenres: ['都市', '玄幻'],
    rawGenreTargetBooks: 1,
    rawGenreMinimumSampleChars: 4,
    rawGenreMinimumSampleCount: 1,
    publishedMinimumCharsByArchetype: 1,
    uniqueUsableBookTarget: 1
  };
  const dimensions = ['appearance', 'expression', 'action', 'dialogue', 'catchphrase', 'psychology'];
  const rows = ['都市', '玄幻'].flatMap((genre, genreIndex) => dimensions.map(dimension => ({
    archetype: '冷静理智型',
    dimension,
    sourceWorkId: `book-${genreIndex + 1}`,
    primaryGenre: genre,
    rawGenres: [genre],
    text: '样本文本'
  })));
  const complete = evaluateMarkdownPublication(true, rows, { pass: true }, config);
  assert.equal(complete.rawGenrePass, true);
  assert.equal(complete.pass, true);
  const missingGenre = evaluateMarkdownPublication(true, rows.filter(row => row.primaryGenre !== '玄幻'), { pass: true }, config);
  assert.equal(missingGenre.rawGenrePass, false);
  assert.ok(missingGenre.reasons.includes('published_raw_genre_coverage'));
});

test('画像发布门禁实际阻断平台覆盖失败，并保留逐项结果', () => {
  const config = {
    archetypes: ['冷静理智型'],
    genreBuckets: { 都市: ['都市'] },
    bucketTargetRange: [0, 1],
    profileMinimumDimensions: 6,
    uniqueUsableBookTarget: 1
  };
  const rawGenreCoverage = {
    byGenre: { 都市: { status: 'met' } },
    uniqueUsableArchiveWorkCount: 1
  };
  const quota = {
    cells: [{ status: 'met', sampleCount: 1, dimensionCount: 6, reliable: true }],
    bucketBalance: { 都市: 1 },
    perBookCapViolations: [],
    platformCoverage: { pass: false, enforced: true, focusSlicePass: false, maxSinglePlatformPass: true }
  };
  const blocked = evaluateProfileRelease(quota, rawGenreCoverage, config);
  assert.equal(blocked.pass, false);
  assert.equal(blocked.platformCoveragePass, false);
  assert.ok(blocked.reasons.includes('platform_coverage'));
  const allowed = evaluateProfileRelease({ ...quota, platformCoverage: { pass: true } }, rawGenreCoverage, config);
  assert.equal(allowed.platformCoveragePass, true);
  assert.equal(allowed.pass, true);
});

test('稀疏原题材画像默认只进入诊断，不阻断四桶硬发布门禁', () => {
  const config = {
    archetypes: ['冷静理智型'],
    rawGenres: ['都市'],
    genreBuckets: { 都市: ['都市'] },
    bucketTargetRange: [0, 1],
    uniqueUsableBookTarget: 1
  };
  const quota = {
    cells: [{ status: 'met', sampleCount: 1, dimensionCount: 6, reliable: true }],
    bucketBalance: { 都市: 1 },
    perBookCapViolations: [],
    platformCoverage: { pass: true }
  };
  const rawGenreCoverage = {
    byGenre: { 都市: { status: 'met' } },
    uniqueUsableArchiveWorkCount: 1
  };
  const diagnosticOnly = evaluateProfileRelease(quota, rawGenreCoverage, config);
  assert.equal(diagnosticOnly.rawProfileDiagnosticPass, false);
  assert.equal(diagnosticOnly.rawProfileGateEnforced, false);
  assert.equal(diagnosticOnly.rawProfilePass, true);
  assert.equal(diagnosticOnly.pass, true);

  const enforced = evaluateProfileRelease(quota, rawGenreCoverage, { ...config, enforceRawGenreProfileRelease: true });
  assert.equal(enforced.rawProfileGateEnforced, true);
  assert.equal(enforced.pass, false);
  assert.ok(enforced.reasons.includes('raw_genre_profile_coverage'));
});

test('发布字数区分强审核池、最终候选池和实际 Markdown', () => {
  const config = {
    archetypes: ['冷静理智型'],
    uniqueUsableBookTarget: 1,
    publishedMinimumCharsByArchetype: 1
  };
  const rows = ['appearance', 'expression', 'action', 'dialogue', 'catchphrase', 'psychology'].map(dimension => ({
    archetype: '冷静理智型', dimension, sourceWorkId: 'book-1', text: '样本文本'
  }));
  const blocked = evaluateMarkdownPublication(false, rows, { pass: true }, config, { strongApprovedRows: rows });
  assert.equal(blocked.metrics.strongApprovedChars, '样本文本'.length);
  assert.equal(blocked.metrics.uniqueTextCount, 1);
  assert.equal(blocked.metrics.publicationCandidateChars, '样本文本'.length);
  assert.equal(blocked.metrics.archetypeChars['冷静理智型'], '样本文本'.length);
  assert.equal(blocked.metrics.totalChars, '样本文本'.length);
  assert.deepEqual(
    Object.fromEntries(Object.entries(blocked.metrics.dimensionChars['冷静理智型']).map(([dimension, chars]) => [dimension, chars])),
    Object.fromEntries(['appearance', 'expression', 'action', 'dialogue', 'catchphrase', 'psychology'].map(dimension => [dimension, '样本文本'.length]))
  );
  assert.equal(blocked.metrics.markdownPublishedChars, 0);
  assert.equal(blocked.metrics.publishedChars, 0);
  const published = evaluateMarkdownPublication(true, rows, { pass: true }, config, { strongApprovedRows: rows });
  assert.equal(published.metrics.markdownPublishedChars, '样本文本'.length);
  assert.equal(published.metrics.publishedChars, published.metrics.markdownPublishedChars);
});

test('发布 Markdown 按人物类型、题材桶和描写维度分组并保留溯源字段', () => {
  const rendered = renderPublishedMarkdown({
    markdownPublished: true,
    sourceHash: 'build-hash',
    general: {
      samples: [{
        id: 'sample-1', sourceWorkId: 'novel-1', canonicalWorkId: 'work-1', sourceHash: 'sample-hash', archetype: '冷静理智型',
        genreBucket: '都市', rawGenres: ['都市', '现实'], platform: '番茄',
        dimension: 'psychology', text: '匿名化后的心理描写样本。',
        provenance: {
          sourceFilePath: '小说原本/都市/样本.txt', chapterId: '42', chapterTitle: '雨夜',
          chapterUrl: 'https://example.test/chapter/42', startOffset: 120, endOffset: 138,
          offsetUnit: 'utf16-code-unit', candidateTextSha256: 'a'.repeat(64), sourceContentHash: 'b'.repeat(64)
        }
      }]
    },
    mature: { samples: [] }
  }, { sourceHash: 'build-hash' });
  assert.match(rendered, /## 冷静理智型\n\n### 都市\n\n#### 心理/);
  assert.match(rendered, /来源哈希：sample-hash；原题材：都市、现实；题材桶：都市；平台：番茄/);
  assert.match(rendered, /样本ID：sample-1；作品ID：work-1；归档文件：小说原本\/都市\/样本\.txt/);
  assert.match(rendered, /章节ID：42；章节标题：雨夜；章节URL：https:\/\/example\.test\/chapter\/42/);
  assert.match(rendered, /原文偏移：120-138（utf16-code-unit）；候选文本 SHA-256：a{64}；原书文件 SHA-256：b{64}/);
});

test('Stage 73 安全 Markdown 只保留规则、模式、匿名化样本、画像摘要和统计', () => {
  const rendered = renderPublicReleaseMarkdown({
    markdownPublished: true,
    profilesPublished: true,
    general: {
      rules: [{
        id: 'rule-public-1', archetype: '冷静理智型', dimension: 'psychology',
        scene: ['试探'], relationship: ['暧昧'], signals: ['subtext'],
        rule: '先处理可观察的小动作，再回答核心问题。',
        application: '让情绪通过延迟和选择体现。', caution: '避免直接贴情绪标签。',
        microPatterns: ['mp-001'], antiPatterns: ['ap-001']
      }],
      samples: [{
        id: 'sample-internal-id', archetype: '冷静理智型', dimension: 'psychology', genreBucket: '都市',
        safeText: '她停了停，把证据收好。', text: '匿名化后的兼容文本。',
        rawText: '泄露原文', contextBefore: '上下文前文泄露', contextAfter: '上下文后文泄露',
        forbiddenTerms: ['内部禁词一', '内部禁词二'], sourceWorkId: 'source-work-secret',
        canonicalWorkId: 'canonical-work-secret', sourceHash: 'source-hash-secret',
        characterEvidence: { canonicalName: '内部规范人物' },
        provenance: {
          sourceFilePath: '小说原本/都市/内部归档.txt', chapterId: 'chapter-42', chapterTitle: '雨夜',
          chapterUrl: 'https://example.test/chapter/42', startOffset: 120, endOffset: 138,
          candidateTextSha256: 'candidate-hash-secret', sourceContentHash: 'source-content-hash-secret'
        }
      }]
    },
    mature: { rules: [], samples: [] },
    microPatterns: [{
      id: 'mp-001', dimension: 'psychology', scene: ['试探'], relationship: ['暧昧'],
      signals: ['subtext'], pattern: ['先停顿', '再回答'], mechanism: '把压力放进延迟。',
      sampleCount: 3, evidence: { canonicalName: '内部规范人物' }
    }],
    antiPatterns: [{ id: 'ap-001', antiPattern: '情绪标签 + 微表情解释', sampleCount: 2, forbiddenTerms: ['内部禁词一'] }],
    profiles: {
      '冷静理智型|都市': {
        available: true, reliable: true, sampleCount: 3, charCount: 42, sentenceCount: 3,
        sentenceMean: 14, sentenceStd: 2, shortSentenceRatio: 0.2, longSentenceRatio: 0.1,
        commaPerSentence: 1, sourceWorkCount: 3, dimensionCount: 2, platformCount: 2,
        dimensionCoverage: { psychology: 42 }, sourceWorkNames: ['内部作品名'], evidence: { rawText: '画像证据' }
      }
    }
  }, {
    counts: { published: 1, markdownPublishedChars: 42, publicationCandidateChars: 42 },
    profiles: { uniqueSamples: 3, uniqueChars: 42, reliableCount: 1, sourceHash: 'report-hash-secret' }
  });

  assert.match(rendered, /## Rules/);
  assert.match(rendered, /## MicroPatterns/);
  assert.match(rendered, /## AntiPatterns/);
  assert.match(rendered, /## Samples/);
  assert.match(rendered, /## Profiles/);
  assert.match(rendered, /## 统计/);
  assert.match(rendered, /先处理可观察的小动作/);
  assert.match(rendered, /她停了停，把证据收好/);
  for (const forbidden of [
    'rawText', 'contextBefore', 'contextAfter', 'forbiddenTerms', 'provenance',
    '泄露原文', '上下文前文泄露', '上下文后文泄露', '内部禁词一', '内部禁词二',
    'source-work-secret', 'canonical-work-secret', 'source-hash-secret', 'candidate-hash-secret',
    'source-content-hash-secret', '内部规范人物', 'chapter-42', '雨夜',
    'https://example.test/chapter/42', '小说原本/都市/内部归档.txt', 'report-hash-secret'
  ]) assert.equal(rendered.includes(forbidden), false, `发布版不应包含 ${forbidden}`);
});

test('CLI 发布路径写入 Stage 73 安全渲染结果', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-public-release-'));
  const inputPath = path.join(root, 'input.md');
  const sourcesPath = path.join(root, 'sources.json');
  const manifestPath = path.join(root, 'manifest.json');
  const outputDir = path.join(root, 'index');
  const intermediate = path.join(root, 'intermediate');
  const markdownPath = path.join(root, 'published.md');
  const scriptPath = path.resolve(import.meta.dirname, '..', 'scripts', 'build-character-material-index.mjs');
  try {
    fs.writeFileSync(inputPath, '', 'utf8');
    fs.writeFileSync(sourcesPath, JSON.stringify({ sources: [] }), 'utf8');
    fs.writeFileSync(manifestPath, JSON.stringify({ books: [] }), 'utf8');
    const cli = spawnSync(process.execPath, [
      scriptPath,
      '--input', inputPath,
      '--sources', sourcesPath,
      '--archive-manifest', manifestPath,
      '--output', outputDir,
      '--intermediate', intermediate,
      '--markdown-output', markdownPath,
      '--force'
    ], { cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr || cli.stdout);
    const index = JSON.parse(fs.readFileSync(path.join(outputDir, 'index.json'), 'utf8'));
    const report = JSON.parse(fs.readFileSync(path.join(outputDir, 'quality-report.json'), 'utf8'));
    const rendered = fs.readFileSync(markdownPath, 'utf8');
    assert.equal(rendered, renderPublicReleaseMarkdown(index, report));
    assert.doesNotMatch(rendered, /来源哈希|归档文件|章节ID|章节标题|章节URL|原文偏移|候选文本 SHA-256|原书文件 SHA-256/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('模型复核只接受当前批次的 candidateId，并保留明确的拒绝结论', () => {
  const batch = [{ candidateId: 'candidate-1', archetype: '冷静理智型', dimension: 'psychology', text: '样本一' }];
  const reviews = parseReviews(JSON.stringify({ reviews: [
    { candidateId: 'candidate-1', isMatch: false, confidence: 0.2 },
    { candidateId: 'other', isMatch: true, confidence: 1 }
  ] }), batch, 'test-model');
  assert.deepEqual(reviews, [{
    candidateId: 'candidate-1', isMatch: false, confidence: 0.2, archetype: '', dimension: '', modelId: 'test-model',
    promptVersion: 'character-candidate-review-v3', inputBinding: {}, reviewedAt: reviews[0].reviewedAt
  }]);
});

test('模型复核按作品、人物实体、性格和维度分组，并在组内保持章节顺序', () => {
  const candidates = [
    { candidateId: 'work-a-late', sourceWorkId: 'work-a', archetype: '冷静理智型', dimension: 'psychology', chapterIndex: 3, characterEvidence: { candidateNames: ['甲'] } },
    { candidateId: 'work-a-early', sourceWorkId: 'work-a', archetype: '冷静理智型', dimension: 'psychology', chapterIndex: 1, characterEvidence: { candidateNames: ['甲'] } },
    { candidateId: 'work-a-other', sourceWorkId: 'work-a', archetype: '冷静理智型', dimension: 'psychology', chapterIndex: 0, characterEvidence: { candidateNames: ['乙'] } },
    { candidateId: 'work-b', sourceWorkId: 'work-b', archetype: '冷静理智型', dimension: 'psychology', chapterIndex: 0, characterEvidence: { candidateNames: ['甲'] } }
  ];
  const batches = buildReviewBatches(candidates, 20);
  assert.equal(batches.length, 3);
  assert.ok(batches.every(batch => batch.items.every(item => candidateReviewGroupKey(item) === batch.groupKey)));
  const workAGroup = batches.find(batch => batch.groupKey.includes('work-a|names:甲|'));
  assert.deepEqual(workAGroup.items.map(item => item.candidateId), ['work-a-early', 'work-a-late']);
});

test('复核缓存切换模型时不复用旧模型结果', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-corpus-review-cache-'));
  const outputPath = path.join(root, 'review.json');
  const inputBinding = {
    candidateTextHash: 'a'.repeat(16), candidateTextSha256: 'b'.repeat(64),
    chapterTextHash: 'c'.repeat(16), chapterTextSha256: 'd'.repeat(64),
    sourceContentHash: 'e'.repeat(64), sourceTextHash: 'f'.repeat(64)
  };
  try {
    fs.writeFileSync(outputPath, JSON.stringify({
      modelId: 'model-a',
      reviews: [{ candidateId: 'candidate-1', modelId: 'model-a', promptVersion: 'character-candidate-review-v3', inputBinding }]
    }), 'utf8');
    assert.equal(readExistingReview(outputPath, 'model-a').reviewedIds.has('candidate-1'), true);
    assert.equal(readExistingReview(outputPath, 'model-b').reviewedIds.has('candidate-1'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('增量中间产物首跑处理、二跑跳过同一作品', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-corpus-incremental-'));
  const rows = [{
    sourceWorkId: 'novel-test-1',
    sourceUrl: 'https://example.test/book/1',
    archetype: '冷静理智型',
    dimension: 'psychology',
    text: '先核对证据，再决定下一步动作。'
  }];
  try {
    const first = buildIncrementalCorpus(rows, { intermediate: root, force: false }, 'input-a');
    const second = buildIncrementalCorpus(rows, { intermediate: root, force: false }, 'input-a');
    assert.equal(first.processedBooks, 1);
    assert.equal(first.skippedBooks, 0);
    assert.equal(second.processedBooks, 0);
    assert.equal(second.skippedBooks, 1);
    const changed = buildIncrementalCorpus([{ ...rows[0], authorization: { status: 'licensed', scope: 'corpus', evidenceRef: 'test:evidence' } }], { intermediate: root, force: false }, 'input-a');
    assert.equal(changed.processedBooks, 1);
    assert.equal(changed.skippedBooks, 0);
    assert.equal(fs.existsSync(path.join(root, 'progress.json')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('旧样本迁移报告只有完成归属和回读校验才标记 verified', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-corpus-migration-'));
  const sourceUrl = 'https://example.test/book/1';
  const chapterUrl = 'https://example.test/book/1/chapter/1';
  const archiveRelativePath = '小说原本/都市/迁移书.txt';
  const archiveText = '第一章\n她核对证据，才开口。\n';
  const archiveBuffer = Buffer.from(archiveText, 'utf8');
  const archivePath = path.join(root, archiveRelativePath);
  const inputPath = path.join(root, '人物描写素材库_真实抓取版.md');
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  fs.writeFileSync(archivePath, archiveBuffer);
  fs.writeFileSync(inputPath, [
    '## 冷静理智型',
    '',
    '### 心理',
    '',
    '**1. 迁移书 · 作者**',
    `> 题材：都市；[原文定位](${sourceUrl})；规则信号：心理`,
    '> 她核对证据，才开口。',
    ''
  ].join('\n'), 'utf8');
  try {
    const report = buildMigrationReport({
      resourceRoot: root,
      input: inputPath,
      sourceList: { sources: [{ status: 'ok', novelid: 1, work_title: '迁移书', url: sourceUrl, genres: ['都市'] }] },
      manifest: { books: [{
        id: 'book-1', title: '迁移书', sourceWorkId: 'novel-1', canonicalWorkId: 'canon-1', sourceUrl,
        filePath: archiveRelativePath, contentHash: crypto.createHash('sha256').update(archiveBuffer).digest('hex'),
        chapters: [{ chapterId: '1', url: chapterUrl }]
      }] }
    });
    assert.equal(report.summary.totalSamples, 1);
    assert.equal(report.summary.verifiedSamples, 1);
    assert.equal(report.samples[0].canonicalWorkId, 'canon-1');
    assert.equal(report.samples[0].sourceFile, archiveRelativePath);
    assert.equal(report.samples[0].chapterId, '1');
    assert.equal(report.samples[0].chapterUrl, chapterUrl);
    assert.equal(report.samples[0].startOffset, '第一章\n'.length);
    assert.equal(report.samples[0].verified, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('增量缓存的来源、manifest 或配置变化会强制重新处理作品', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-corpus-context-'));
  const rows = [{ sourceWorkId: 'novel-context-1', archetype: '冷静理智型', dimension: 'psychology', text: '先核对证据，再决定下一步。' }];
  const context = { sourceList: { sources: [{ id: 1 }] }, archiveManifest: { books: [{ id: 'book-1' }] }, config: { version: 'a' } };
  try {
    const first = buildIncrementalCorpus(rows, { intermediate: root, force: false }, 'input-a', context);
    const second = buildIncrementalCorpus(rows, { intermediate: root, force: false }, 'input-a', context);
    const volatileOnly = buildIncrementalCorpus(rows, { intermediate: root, force: false }, 'input-a', {
      ...context,
      archiveManifest: { ...context.archiveManifest, generatedAt: '2026-08-27T01:00:00.000Z', observedAt: '2026-08-27T01:00:00.000Z' },
      sourceList: { ...context.sourceList, updatedAt: '2026-08-27T01:00:00.000Z' }
    });
    const changed = buildIncrementalCorpus(rows, { intermediate: root, force: false }, 'input-a', { ...context, config: { version: 'b' } });
    assert.equal(first.processedBooks, 1);
    assert.equal(second.skippedBooks, 1);
    assert.equal(volatileOnly.skippedBooks, 1);
    assert.equal(changed.processedBooks, 1);
    assert.equal(changed.skippedBooks, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('manifest 读取同哈希 sidecar，并将 partial 带入原书质量结果', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-corpus-manifest-'));
  const filePath = path.join(root, '测试书.txt');
  const content = '第一章\n这是第一章的正文内容，长度足够用于原书质量门禁测试。\n\n第二章\n这是第二章的正文内容，长度足够用于原书质量门禁测试。\n';
  fs.writeFileSync(filePath, content, 'utf8');
  const contentHash = crypto.createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex').slice(0, 16);
  const metadataRoot = path.join(root, '.fetch-metadata');
  fs.mkdirSync(metadataRoot, { recursive: true });
  fs.writeFileSync(path.join(metadataRoot, 'book.json'), JSON.stringify({
    filePath: '测试书.txt',
    sourceUrl: 'https://example.test/book/1',
    fetchedAt: '2026-08-27T00:00:00.000Z',
    contentHash,
    quality: { partial: true },
    rawGenres: ['都市'],
    expectedChapterCount: 2,
    fetchedChapterCount: 2,
    chapterCountDeclared: true,
    catalogSnapshot: {
      snapshotSha256: 'a'.repeat(64),
      chapterIds: ['1', '2'],
      duplicateChapterIds: []
    },
    chapters: [
      { chapterId: '1', url: 'https://example.test/book/1/chapter/1' },
      { chapterId: '2', url: 'https://example.test/book/1/chapter/2' }
    ]
  }), 'utf8');
  try {
    const metadata = readFetchMetadata(metadataRoot).get('测试书.txt');
    const inspected = inspectArchiveFile(filePath, quotaConfig, blocklist, { sources: [] }, metadata);
    assert.equal(inspected.fetchedAt, '2026-08-27T00:00:00.000Z');
    assert.equal(inspected.quality.partial, true);
    assert.equal(inspected.quality.chapterSetMatches, true);
    assert.equal(inspected.quality.chapterOrderMatches, true);
    assert.equal(inspected.excludeFromCorpus, true);
    assert.equal(inspected.rawGenres[0], '都市');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('原书归属只接受唯一精确书名，不接受包含关系', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-corpus-title-'));
  const filePath = path.join(root, '测试书.txt');
  const content = '第一章\n这是用于书名精确归属测试的完整章节正文，长度足够且没有质量问题。\n';
  fs.writeFileSync(filePath, content, 'utf8');
  const source = {
    novelid: 1,
    work_title: '测试',
    url: 'https://example.test/book/1',
    genres: ['都市'],
    authorization: { status: 'licensed', scope: 'corpus', evidenceRef: 'test:evidence' }
  };
  try {
    const partialMatch = inspectArchiveFile(filePath, testCorpusConfig, blocklist, { sources: [source] });
    assert.equal(partialMatch.sourceUrl, null);
    assert.equal(partialMatch.sourceWorkId, null);
    const exactMatch = inspectArchiveFile(filePath, testCorpusConfig, blocklist, {
      sources: [{ ...source, work_title: '测试书' }]
    });
    assert.equal(exactMatch.sourceUrl, 'https://example.test/book/1');
    assert.equal(exactMatch.sourceWorkId, 'novel-1');
    assert.equal(exactMatch.quality.authorizationVerified, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('复合题材输入命中画像，运行时只注入统计画像而不注入原文', () => {
  const index = {
    version: 'corpus-v2',
    published: true,
    general: { rules: [], samples: [] },
    mature: { rules: [], samples: [] },
    profilesPublished: true,
    profileGenreMap: { 都市: '都市' },
    profiles: {
      '冷静理智型|都市': {
        available: true,
        reliable: true,
        sampleCount: 24,
        charCount: 12000,
        sentenceMean: 16,
        sentenceStd: 5,
        shortSentenceRatio: 0.2,
        longSentenceRatio: 0.1,
        commaPerSentence: 1.5
      }
    }
  };
  const result = material.buildCharacterMaterialBlock({}, {
    mode: 'auto',
    archetypes: ['冷静理智型'],
    genre: '玄幻都市女频',
    proseTask: true
  }, { index });
  assert.equal(result.audit.profileKey, '冷静理智型|都市');
  assert.equal(result.audit.profileInjected, true);
  assert.match(result.messages[0].content, /molan-character-material-profile-v1/);
  assert.doesNotMatch(result.messages[0].content, /匿名样本/);
});

test('profilesPublished 为 false 时禁止画像注入并记录门禁原因', () => {
  const index = {
    version: 'corpus-v3',
    published: true,
    profilesPublished: false,
    general: { rules: [], samples: [] },
    mature: { rules: [], samples: [] },
    profileGenreMap: { 都市: '都市' },
    profiles: {
      '冷静理智型|都市': { available: true, reliable: true, sampleCount: 24, charCount: 12000 }
    }
  };
  const result = material.buildCharacterMaterialBlock({}, {
    mode: 'auto',
    archetypes: ['冷静理智型'],
    genre: '都市',
    proseTask: true
  }, { index });
  assert.equal(result.audit.profileInjected, undefined);
  assert.equal(result.audit.profileReason, 'profiles_not_published');
  assert.doesNotMatch(result.messages[0].content, /molan-character-material-profile-v1/);
});
