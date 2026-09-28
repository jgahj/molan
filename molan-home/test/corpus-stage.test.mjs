import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  analyzeSourceQuality,
  applyReorganization,
  buildQualityOutputs,
  linkSourceMetadata,
  planReorganization,
  sha256
} from '../scripts/corpus-stage.mjs';

const chapters = count => Array.from({ length: count }, (_, index) => `第${index + 1}章\n她先核对门锁，再把杯子移到手边，等对方说明来意${index + 1}。` ).join('\n');

test('阶段 1 按文件名生成确定性的整理计划，不会默认移动文件', () => {
  const report = planReorganization([
    { path: 'C:/resource/小说原本/都市/测试书 - 作者.txt', relativePath: '都市/测试书 - 作者.txt', bytes: 200000 },
    { path: 'C:/resource/小说原本/女频衍生/旧书.txt', relativePath: '女频衍生/旧书.txt', bytes: 200000, header: { title: '旧书', author: '作者' } },
    { path: 'C:/resource/小说原本/女频衍生/坏书.txt', relativePath: '女频衍生/坏书.txt', bytes: 10 }
  ], { archiveRoot: 'C:/resource/小说原本', resourceRoot: 'C:/resource' });
  assert.equal(report.status, 'ready');
  assert.equal(report.files[0].action, 'keep');
  assert.equal(report.files.find(file => file.title === '旧书').to, '女频衍生/旧书 - 作者.txt');
  assert.equal(report.files.find(file => file.title === '坏书').action, 'quarantine');
  assert.equal(report.files.some(file => file.applied === true), false);
});

test('阶段 2 同榜去重、跨平台去重，并在缺少补采输入时保持 pending', () => {
  const qidian = { categories: [{ name: '玄幻', ranks: { 畅销榜: [{ id: '1', title: '同名书', author: '作者', rank: 2 }], 新书榜: [{ id: '1', title: '同名书', author: '作者', rank: 1 }] } }] };
  const fanqie = { categories: [{ name: '女频衍生', ranks: { 畅销榜: [{ bookId: '2', rank: 1, wordNumber: '100000', creationStatus: '1' }] } }] };
  const report = { files: [
    { path: '玄幻/同名书 - 作者.txt', toPath: '玄幻/同名书 - 作者.txt', title: '同名书', author: '作者', action: 'keep' },
    { path: '女频补充/女频衍生/同名书 - 作者.txt', toPath: '女频补充/女频衍生/同名书 - 作者.txt', title: '同名书', author: '作者', action: 'keep' }
  ] };
  const result = linkSourceMetadata({
    qidianRankManifest: qidian,
    shukugeDownloadProgress: { done: { '同名书|作者': '玄幻/同名书 - 作者.txt' } },
    fanqieRankManifest: fanqie,
    fanqieDownloadProgress: { '2': { status: 'ok', title: '同名书' } },
    qidianBookMetadata: null,
    reorganizationReport: report
  });
  assert.equal(result.status, 'pending');
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].rankType, '畅销榜');
  assert.equal(result.sources[0].authorization.verified, false);
  assert.equal(result.sources[0].fullWorkEvidence.verified, false);
  assert.ok(result.crossPlatformDuplicates.length === 1);
  assert.ok(result.missingInputs.includes('qidianBookMetadata'));
});

test('阶段 2 合并 metadata/progress 的授权、完结、全文、完整性、证据引用和 hash', () => {
  const hash = character => character.repeat(64);
  const result = linkSourceMetadata({
    qidianRankManifest: {
      categories: [{ name: '都市', ranks: { 畅销榜: [{
            id: 'merge-1', title: '合并书', author: '作者',
            rankEvidenceRef: 'evidence/rank.json', rankEvidenceSha256: hash('b'), rankEvidenceVerified: true,
            rankCapturedAt: '2026-08-28T00:00:00.000Z'
          }] } }]
    },
    shukugeDownloadProgress: {
      works: {
        'merge-1': {
          path: '都市/合并书 - 作者.txt',
          authorization: {
            rightsHolder: '进度中的权利人',
            evidenceVerified: true,
            evidenceSha256: hash('a')
          },
          contentScope: 'partial',
          sourceTextHash: hash('b'),
          quality: { partial: true, incomplete: true, contentHashVerified: false },
          integrity: { status: 'reported', fetchedChapterCount: 8 }
        }
      }
    },
    fanqieRankManifest: {},
    fanqieDownloadProgress: {},
    qidianBookMetadata: {
      books: {
        'merge-1': {
          authorization: {
            status: 'licensed',
            evidenceRef: 'evidence/license.json',
            evidenceSha256: hash('c'),
            evidenceVerified: true,
            license: 'corpus'
          },
          completionStatus: 'completed',
          completionEvidenceRef: 'evidence/completion.json',
          completionEvidenceVerified: true,
          completionEvidenceSha256: hash('d'),
          contentScope: 'full_work',
          fullWorkEvidenceRef: 'evidence/full-work.json',
          fullWorkEvidenceVerified: true,
          fullWorkEvidenceSha256: hash('e'),
          chapterCountDeclared: true,
          expectedChapterCount: 10,
          fetchedChapterCount: 10,
          chapterCoverage: 1,
          contentHash: hash('f'),
          sourceContentHash: hash('e'),
          quality: { partial: false, incomplete: false, contentHashVerified: true }
        }
      }
    },
    reorganizationReport: {
      files: [{ path: '都市/合并书 - 作者.txt', toPath: '都市/合并书 - 作者.txt', title: '合并书', author: '作者', action: 'keep' }]
    }
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.sources.length, 1);
  const source = result.sources[0];
  assert.deepEqual(source.authorization, {
    rightsHolder: '进度中的权利人',
    status: 'licensed',
    evidenceRef: 'evidence/license.json',
    evidenceSha256: hash('c'),
    evidenceVerified: true,
    verified: true,
    license: 'corpus'
  });
  assert.equal(source.completionStatus, 'completed');
  assert.equal(source.completionEvidenceRef, 'evidence/completion.json');
  assert.equal(source.completionEvidenceVerified, true);
  assert.equal(source.completionEvidenceSha256, hash('d'));
  assert.equal(source.contentScope, 'full_work');
  assert.equal(source.fullWorkEvidence.evidenceRef, 'evidence/full-work.json');
  assert.equal(source.fullWorkEvidence.verified, true);
  assert.equal(source.fullWorkEvidence.evidenceSha256, hash('e'));
  assert.equal(source.chapterCountDeclared, true);
  assert.equal(source.expectedChapterCount, 10);
  assert.equal(source.fetchedChapterCount, 10);
  assert.equal(source.chapterCoverage, 1);
  assert.equal(source.partial, false);
  assert.equal(source.incomplete, false);
  assert.equal(source.contentHash, hash('f'));
  assert.equal(source.sourceContentHash, hash('e'));
  assert.equal(source.sourceTextHash, hash('b'));
  assert.equal(source.contentHashVerified, true);
  assert.equal(source.integrity.status, 'reported');
  assert.equal(source.rankEvidenceRef, 'evidence/rank.json');
  assert.equal(source.rankEvidenceSha256, hash('b'));
  assert.equal(source.rankEvidenceVerified, true);
  assert.equal(source.rankCapturedAt, '2026-08-28T00:00:00.000Z');
  assert.equal(result.sources[0].rankEvidenceRef, 'evidence/rank.json');
  assert.equal(result.sources[0].ranking.rankEvidenceRef, 'evidence/rank.json');
  assert.equal(result.sources[0].ranking.rankEvidenceSha256, hash('b'));
});

test('阶段 3 逐条合并来源 gate：缺证据、partial 或 incomplete 不得进入高级分析', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-stage-gate-'));
  const file = path.join(root, 'book.txt');
  const content = Array.from({ length: 10 }, (_, chapterIndex) => [
    `第${chapterIndex + 1}章`,
    Array.from({ length: 1000 }, (_, paragraphIndex) => `她先核对第${chapterIndex}章第${paragraphIndex}次记录，再把杯子移到手边。`).join('\n')
  ].join('\n')).join('\n');
  fs.writeFileSync(file, content, 'utf8');
  const hash = character => character.repeat(64);
  const source = {
    sourceWorkId: 'qidian-gate', canonicalWorkId: 'qidian-gate', platformWorkId: 'gate', platform: '起点',
    title: '门禁书', author: '作者', filePath: 'book.txt', expectedChapterCount: 10, fetchedChapterCount: 10,
    contentScope: 'full_work', contentHash: sha256(content), contentHashVerified: true,
    completionStatus: 'completed', completionEvidenceRef: 'evidence/completion.txt', completionEvidenceVerified: true, completionEvidenceSha256: hash('c'),
    fullWorkEvidence: { status: 'verified', evidenceRef: 'evidence/full-work.txt', verified: true, evidenceSha256: hash('f') },
    authorization: { status: 'licensed', scope: 'corpus', evidenceRef: 'evidence/license.txt', evidenceVerified: true, evidenceSha256: hash('a') },
    rankEvidenceRef: 'evidence/rank.json', rankEvidenceSha256: hash('d'), rankEvidenceVerified: true,
    rankCapturedAt: '2026-08-28T00:00:00.000Z',
  };
  try {
    const admitted = buildQualityOutputs([source], { resolveFile: () => file });
    assert.equal(admitted.sourceManifest.sources[0].eligibleForAdvancedAnalysis, true);
    assert.equal(admitted.sourceManifest.sources[0].admission, 'admitted');
    assert.equal(admitted.sourceQualityReport.reports[0].provenance.rank.evidenceRef, 'evidence/rank.json');
    assert.equal(admitted.sourceQualityReport.reports[0].provenance.authorization.evidenceSha256, hash('a'));
    assert.equal(admitted.sourceQualityReport.reports[0].provenance.content.contentHash, source.contentHash);

    const partial = buildQualityOutputs([{ ...source, contentScope: 'partial', partial: true }], { resolveFile: () => file });
    assert.equal(partial.sourceManifest.sources[0].admission, 'pending');
    assert.equal(partial.sourceManifest.sources[0].eligibleForAdvancedAnalysis, false);
    assert.ok(partial.sourceManifest.sources[0].sourceGate.reasons.includes('partial_source_not_admissible'));

    const incomplete = buildQualityOutputs([{ ...source, incomplete: true }], { resolveFile: () => file });
    assert.equal(incomplete.sourceManifest.sources[0].admission, 'pending');
    assert.equal(incomplete.sourceManifest.sources[0].eligibleForAdvancedAnalysis, false);
    assert.ok(incomplete.sourceManifest.sources[0].sourceGate.reasons.includes('incomplete_source_not_admissible'));

    const limited = buildQualityOutputs([{ ...source, fetchedChapterCount: 9 }], { resolveFile: () => file });
    assert.equal(limited.sourceManifest.sources[0].admission, 'pending');
    assert.equal(limited.sourceManifest.sources[0].eligibleForAdvancedAnalysis, false);
    assert.ok(limited.sourceManifest.sources[0].sourceGate.reasons.includes('partial_source_not_admissible'));

    const missingEvidence = buildQualityOutputs([{ ...source, rankEvidenceRef: '', rankEvidenceSha256: null, rankEvidenceVerified: false }], { resolveFile: () => file });
    assert.equal(missingEvidence.sourceManifest.sources[0].admission, 'pending');
    assert.equal(missingEvidence.sourceManifest.sources[0].eligibleForAdvancedAnalysis, false);
    assert.ok(missingEvidence.sourceManifest.sources[0].sourceGate.reasons.includes('rank_evidence_pending'));

    const mismatchedHash = buildQualityOutputs([{ ...source, contentHash: hash('a') }], { resolveFile: () => file });
    assert.equal(mismatchedHash.sourceManifest.sources[0].admission, 'pending');
    assert.equal(mismatchedHash.sourceManifest.sources[0].eligibleForAdvancedAnalysis, false);
    assert.ok(mismatchedHash.sourceManifest.sources[0].sourceGate.reasons.includes('content_hash_mismatch'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('阶段 2 缺少来源证据时保留 unknown 并保持 pending，不伪造 ready', () => {
  const result = linkSourceMetadata({
    qidianRankManifest: {
      categories: [{ name: '都市', ranks: { 畅销榜: [{ id: 'missing-evidence', title: '待核验书', author: '作者' }] } }]
    },
    shukugeDownloadProgress: { done: { 'missing-evidence': '都市/待核验书 - 作者.txt' } },
    fanqieRankManifest: {},
    fanqieDownloadProgress: {},
    qidianBookMetadata: {},
    reorganizationReport: {
      files: [{ path: '都市/待核验书 - 作者.txt', toPath: '都市/待核验书 - 作者.txt', title: '待核验书', author: '作者', action: 'keep' }]
    }
  });

  assert.equal(result.status, 'pending');
  assert.equal(result.sources.length, 1);
  const source = result.sources[0];
  assert.equal(source.authorization.status, 'unknown');
  assert.equal(source.authorization.verified, false);
  assert.equal(source.authorization.evidenceRef, null);
  assert.equal(source.completionStatus, 'unknown');
  assert.equal(source.completionEvidenceVerified, false);
  assert.equal(source.fullWorkEvidence.status, 'unknown');
  assert.equal(source.fullWorkEvidence.verified, false);
  assert.equal(source.contentScope, null);
  assert.equal(source.contentHash, null);
  assert.equal(source.contentHashVerified, false);
  assert.ok(result.pendingReasons.includes('authorization_evidence_pending'));
  assert.ok(result.pendingReasons.includes('completion_status_pending'));
  assert.ok(result.pendingReasons.includes('completion_evidence_pending'));
  assert.ok(result.pendingReasons.includes('full_work_scope_pending'));
  assert.ok(result.pendingReasons.includes('full_work_evidence_pending'));
  assert.ok(result.pendingReasons.includes('content_integrity_pending'));
});

test('阶段 3 对全部九项质量门禁给出可解释结果，缺 expected 章节数时 pending 而非猜测通过', () => {
  const text = chapters(10);
  const result = analyzeSourceQuality({
    text,
    bytes: 200000,
    platform: '起点',
    metadata: { sourceWorkId: 'qidian-1', platformWorkId: '1' }
  });
  assert.equal(result.status, 'pending');
  assert.equal(result.checks.coverage.status, 'pending');
  assert.equal(result.checks.coverage.pass, null);
  assert.ok(result.pendingReasons.includes('expected_chapter_count_missing'));
  assert.ok(Object.hasOwn(result.checks, 'pua'));
  assert.ok(Object.hasOwn(result.checks, 'mojibake'));
  assert.ok(Object.hasOwn(result.checks, 'shortAttack'));
  assert.ok(Object.hasOwn(result.checks, 'watermark'));
});

test('阶段 3 缺少文件大小和损坏输入时不会伪造 ready', () => {
  const missingBytes = analyzeSourceQuality({ text: chapters(10), platform: '起点', metadata: { sourceWorkId: 'qidian-1', expectedChapterCount: 10 } });
  assert.equal(missingBytes.status, 'pending');
  assert.ok(missingBytes.pendingReasons.includes('file_size_missing'));
  const malformed = linkSourceMetadata({ qidianRankManifest: { __parseError: 'invalid json' }, shukugeDownloadProgress: {}, fanqieRankManifest: {}, fanqieDownloadProgress: {}, qidianBookMetadata: {}, reorganizationReport: { files: [] } });
  assert.equal(malformed.status, 'blocked');
  assert.ok(malformed.inputErrors.some(error => error.includes('qidianRankManifest')));
});

test('阶段 3 拒绝 PUA、乱码、空章、重复段和水印污染，并保留隔离记录', () => {
  const text = `${chapters(10)}\n${'重复段落\n'.repeat(20)}${'\uE3F8'.repeat(30)}${'�'.repeat(30)}\nwww.shukuge.com`;
  const result = analyzeSourceQuality({
    text,
    bytes: 200000,
    platform: '番茄',
    metadata: { sourceWorkId: 'fanqie-1', platformWorkId: '1', expectedChapterCount: 10 }
  });
  assert.equal(result.status, 'rejected');
  assert.ok(result.blockingReasons.includes('pua'));
  assert.ok(result.blockingReasons.includes('mojibake'));
  assert.ok(result.blockingReasons.includes('watermark'));
});

test('阶段 3 可恢复：相同 fingerprint 复用既有报告，且缺失原文保持 pending', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-stage-test-'));
  const file = path.join(root, 'book.txt');
  fs.writeFileSync(file, chapters(10), 'utf8');
  const source = { sourceWorkId: 'qidian-1', platformWorkId: '1', platform: '起点', filePath: 'book.txt', expectedChapterCount: 10 };
  const first = buildQualityOutputs([source], { resolveFile: () => file });
  const second = buildQualityOutputs([source], { resolveFile: () => file, previousSourceManifest: first.sourceManifest });
  const missing = buildQualityOutputs([{ ...source, sourceWorkId: 'qidian-missing', filePath: 'missing.txt' }], { resolveFile: () => path.join(root, 'missing.txt') });
  assert.equal(second.sourceManifest.summary.resumedCount, 1);
  assert.equal(missing.sourceManifest.sources[0].admission, 'pending');
  assert.equal(missing.sourceQualityReport.reports[0].pendingReasons.includes('source_text_missing'), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('阶段 1 --apply 只允许在 archive/resource 范围内移动，并拒绝路径穿越', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-stage-apply-'));
  const archive = path.join(root, '小说原本');
  const sourceDir = path.join(archive, '待整理');
  fs.mkdirSync(sourceDir, { recursive: true });
  try {
    const safeSource = path.join(sourceDir, '安全书.txt');
    fs.writeFileSync(safeSource, 'safe', 'utf8');
    const safeResult = applyReorganization({
      files: [{ action: 'move', fromPath: '待整理/安全书.txt', toPath: '都市/安全书.txt' }]
    }, archive);
    assert.equal(safeResult[0].applied, true);
    assert.equal(fs.existsSync(path.join(archive, '都市', '安全书.txt')), true);

    const traversalSource = path.join(archive, '待整理', '来源越界.txt');
    fs.writeFileSync(traversalSource, 'source', 'utf8');
    const outsideSource = path.join(root, '来源越界.txt');
    fs.writeFileSync(outsideSource, 'outside', 'utf8');
    const sourceTraversalResult = applyReorganization({
      files: [{ action: 'move', fromPath: '../来源越界.txt', toPath: '都市/不应移动.txt' }]
    }, archive);
    assert.equal(sourceTraversalResult[0].applied, false);
    assert.equal(sourceTraversalResult[0].reason, 'source_path_traversal');
    assert.equal(fs.existsSync(outsideSource), true);

    const targetTraversalSource = path.join(archive, '待整理', '目标越界.txt');
    fs.writeFileSync(targetTraversalSource, 'target', 'utf8');
    const targetTraversalResult = applyReorganization({
      files: [{ action: 'move', fromPath: '待整理/目标越界.txt', toPath: '../目标越界.txt' }]
    }, archive);
    assert.equal(targetTraversalResult[0].applied, false);
    assert.equal(targetTraversalResult[0].reason, 'target_path_traversal');
    assert.equal(fs.existsSync(targetTraversalSource), true);

    const externalTargetSource = path.join(archive, '待整理', '外部目标.txt');
    fs.writeFileSync(externalTargetSource, 'external', 'utf8');
    const externalTarget = path.join(root, '外部目标.txt');
    const externalTargetResult = applyReorganization({
      files: [{ action: 'move', fromPath: '待整理/外部目标.txt', toPath: externalTarget }]
    }, archive);
    assert.equal(externalTargetResult[0].applied, false);
    assert.equal(externalTargetResult[0].reason, 'target_path_outside_allowed_root');
    assert.equal(fs.existsSync(externalTargetSource), true);
    assert.equal(fs.existsSync(externalTarget), false);

    const quarantineSource = path.join(archive, '待整理', '隔离书.txt');
    fs.writeFileSync(quarantineSource, 'quarantine', 'utf8');
    const quarantineResult = applyReorganization({
      files: [{ action: 'quarantine', fromPath: '待整理/隔离书.txt', toPath: '_quarantine/隔离书.txt' }]
    }, archive);
    assert.equal(quarantineResult[0].applied, true);
    assert.equal(fs.existsSync(path.join(root, '_quarantine', '隔离书.txt')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI 在临时目录独立运行并生成四类阶段产物，输入缺失时显式 pending', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-stage-cli-'));
  const archive = path.join(root, '小说原本');
  fs.mkdirSync(path.join(archive, '玄幻'), { recursive: true });
  fs.writeFileSync(path.join(archive, '玄幻', '书 - 作者.txt'), chapters(10), 'utf8');
  const script = path.resolve(import.meta.dirname, '..', 'scripts', 'corpus-stage.mjs');
  const run = spawnSync(process.execPath, [script, '--stage', 'all', '--archive-root', archive, '--output-root', root], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  for (const name of ['corpus-reorganize-report.json', 'corpus-source-metadata.json', 'source-manifest.json', 'source-quality-report.json', 'quarantine-report.json']) assert.equal(fs.existsSync(path.join(root, name)), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'corpus-source-metadata.json'), 'utf8')).status, 'pending');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'source-manifest.json'), 'utf8')).status, 'pending');
  fs.rmSync(root, { recursive: true, force: true });
});
