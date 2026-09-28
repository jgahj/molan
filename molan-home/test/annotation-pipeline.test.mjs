import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANNOTATION_PASSES,
  buildAnnotationPlan,
  buildAnnotationPrompt,
  buildCalibrationSet,
  runAnnotationPipeline,
  validateAnnotationPass
} from '../scripts/annotation-pipeline.mjs';

const TEXT = '他把杯子推到她面前，随后才低声问她是不是还在生气。';

function candidate(id = 'candidate-1') {
  return {
    id,
    text: TEXT,
    source: {
      sourceWorkId: `work-${id}`,
      canonicalWorkId: `work-${id}`,
      platform: '起点',
      title: `作品-${id}`,
      author: `作者-${id}`,
      completionStatus: 'completed'
    },
    evidence: { chapterIndex: 1, paragraphIndex: 1, charStart: 0, charEnd: TEXT.length },
    grade: 'S'
  };
}

function passes() {
  return {
    'candidate-1': {
      person: { personId: 'person-1', canonicalName: '内部人物', primaryArchetype: '冷静理智型', evidenceSpans: [{ start: 0, end: 2, text: '他把' }], confidence: 0.9 },
      dimension: { dimension: 'action', secondaryDimensions: ['dialogue'], confidence: 0.9 },
      scene: { scene: ['试探'], confidence: 0.8 },
      relationship: { relationship: ['暧昧对象'], confidence: 0.8 },
      emotionalState: { emotionalState: ['紧张'], confidence: 0.8 },
      subtext: { label: '寻求确认', evidence: ['他先递杯子，随后才低声追问。'], surfaceIntent: '确认对方态度', confidence: 0.8 },
      humanTexture: { signals: ['speech_vs_action'], evidence: { speech_vs_action: ['他用动作先表达关心，再开口追问。'] }, confidence: 0.8 },
      microPattern: { id: 'mp-1', dimension: 'action', scene: ['试探'], relationship: ['暧昧对象'], signals: ['speech_vs_action'], pattern: ['先做一个低风险的照料动作', '再用问题确认对方态度'], whyItWorks: '关心先落在行动，给对白保留试探空间。', antiPattern: '直接解释人物已经很担心。', confidence: 0.8 }
    }
  };
}

test('annotation passes are separate and prompts keep each pass narrow', () => {
  assert.deepEqual(ANNOTATION_PASSES, ['person', 'dimension', 'scene', 'relationship', 'emotionalState', 'subtext', 'humanTexture', 'microPattern']);
  assert.match(buildAnnotationPrompt('humanTexture', candidate()), /先列出原文 evidence/);
  assert.doesNotMatch(buildAnnotationPrompt('dimension', candidate()), /潜台词/);
});

test('pass validation requires evidence for subtext and every HTL signal', () => {
  const subtext = validateAnnotationPass('subtext', { label: '嘴硬', confidence: 0.8 }, candidate());
  assert.equal(subtext.valid, false);
  assert.ok(subtext.errors.some(error => error.includes('subtext evidence')));
  const htl = validateAnnotationPass('humanTexture', { signals: ['avoidance', 'pause'], evidence: { avoidance: ['他避开了问题。'] }, confidence: 0.8 }, candidate());
  assert.equal(htl.valid, false);
  assert.ok(htl.errors.some(error => error.includes('pause')));
});

test('person evidenceSpans must stay within and match the candidate text', () => {
  const outside = validateAnnotationPass('person', {
    personId: 'person-1',
    primaryArchetype: '冷静理智型',
    evidenceSpans: [{ start: 0, end: 99, text: '他'.repeat(99) }],
    confidence: 0.9,
  }, candidate());
  assert.equal(outside.valid, false);
  assert.ok(outside.errors.some(error => error.includes('inconsistent with candidate text')));

  const mismatch = validateAnnotationPass('person', {
    personId: 'person-1',
    primaryArchetype: '冷静理智型',
    evidenceSpans: [{ start: 0, end: 2, text: '不匹' }],
    confidence: 0.9,
  }, candidate());
  assert.equal(mismatch.valid, false);
});

test('annotation pipeline remains pending without real pass outputs and publishes no claim', () => {
  const result = runAnnotationPipeline({ candidates: [candidate()] });
  assert.equal(result.status, 'pending');
  assert.equal(result.records.length, 0);
  assert.equal(result.claimable, false);
  assert.ok(result.pending.some(item => item.pass === 'person'));
});

test('annotation pipeline materializes a valid rich record only after all required passes pass', () => {
  const result = runAnnotationPipeline({ candidates: [candidate()], passOutputs: passes() });
  assert.equal(result.status, 'ready');
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].sample.dimension, 'action');
  assert.deepEqual(result.records[0].sample.humanTextureSignals, ['speech_vs_action']);
  assert.equal(result.records[0].quality.grade === 'D', false);
});

test('annotation pipeline preserves source authorization, hashes, chapter and file provenance', () => {
  const row = candidate();
  row.source = {
    ...row.source,
    authorization: {
      status: 'licensed',
      scope: 'corpus',
      evidenceRef: 'evidence/license.txt',
      evidenceSha256: 'a'.repeat(64),
      evidenceVerified: true,
      archiveUseAllowed: true,
      modelProcessingAllowed: true,
      runtimeUseAllowed: true,
    },
    contentHash: 'b'.repeat(64),
    sourceContentHash: 'c'.repeat(64),
    provenance: {
      filePath: '小说原本/都市/作品-作者.txt',
      chapterId: 'chapter-7',
      chapterUrl: 'https://example.test/chapter/7',
      charStart: 120,
      charEnd: 122,
      candidateTextSha256: 'd'.repeat(64),
    },
  };
  const result = runAnnotationPipeline({ candidates: [row], passOutputs: passes() });
  assert.equal(result.status, 'ready');
  const record = result.records[0];
  assert.deepEqual(record.sample.evidence.evidenceSpans, [{ start: 0, end: 2, text: '他把' }]);
  assert.equal(record.source.authorization.evidenceRef, 'evidence/license.txt');
  assert.equal(record.source.authorization.evidenceSha256, 'a'.repeat(64));
  assert.equal(record.source.contentHash, 'b'.repeat(64));
  assert.equal(record.source.sourceContentHash, 'c'.repeat(64));
  assert.equal(record.source.provenance.filePath, '小说原本/都市/作品-作者.txt');
  assert.equal(record.source.provenance.chapterId, 'chapter-7');
  assert.equal(record.source.provenance.charStart, 120);
  assert.equal(record.source.provenance.candidateTextSha256, 'd'.repeat(64));
});

test('calibration set is deterministic, stratified and explicitly pending', () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    ...candidate(`candidate-${index + 1}`),
    source: { ...candidate(`candidate-${index + 1}`).source, platform: index % 2 ? '番茄' : '起点' },
    dimension: index % 2 ? 'dialogue' : 'action',
    scene: index % 3 ? '试探' : '误解'
  }));
  const first = buildCalibrationSet(rows, { target: 8 });
  const second = buildCalibrationSet(rows, { target: 8 });
  assert.deepEqual(first, second);
  assert.equal(first.status, 'ready_for_review');
  assert.equal(first.rows.every(row => row.status === 'pending' && row.answers === null), true);
  assert.equal(first.claimable, false);
  assert.ok(first.coverage.platforms.length >= 2);
  assert.ok(first.coverage.dimensions.length >= 2);
});

test('ordinary B candidates skip expensive passes by default', () => {
  const plan = buildAnnotationPlan([{ ...candidate(), id: 'b', grade: 'B' }]);
  assert.deepEqual(plan[0].requiredPasses, ['person', 'dimension', 'scene', 'relationship', 'emotionalState']);
});
