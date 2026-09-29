'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReplayManifest } = require('../lib/evolution/replay-manifest');
const { SOAK_MILESTONES, SOAK_CHECKPOINT_METRICS, buildSoakPlan, evaluateSoakRun } = require('../lib/evolution/soak-test');

const replayManifest = buildReplayManifest({
  sourceGenerationId: 'gold-1', pipelineVersion: 'pipe-1', promptVersion: 'prompt-1',
  genreProfileVersion: 'genre-1', styleVersion: 'style-1', model: 'test-model', parameters: { temperature: 0.7 },
  artifacts: {
    bible: { ref: 'bible:1', snapshot: { id: 'bible' } },
    outline: { ref: 'outline:1', snapshot: { id: 'outline' } },
    chapterContract: { ref: 'contract:1', snapshot: { id: 'contract' } },
    contextSnapshot: { ref: 'context:1', snapshot: { id: 'context' } }
  }
});

function completedChapters(count) {
  return Array.from({ length: count }, (_, index) => ({
    chapter_index: index + 1, text_hash: `hash-${index + 1}`, evidence_ref: `chapter:${index + 1}`,
    status: 'completed', audit_passed: true
  }));
}

function checkpoints(indices) {
  return indices.map(chapterIndex => ({
    chapter_index: chapterIndex,
    evidence_ref: `snapshot:${chapterIndex}`,
    metrics: Object.fromEntries(SOAK_CHECKPOINT_METRICS.map((metric, index) => [metric, index]))
  }));
}

test('long-form soak plan supports the required 3/10/20/50/100/200 chapter milestones', () => {
  assert.deepEqual(SOAK_MILESTONES, [3, 10, 20, 50, 100, 200]);
  assert.deepEqual(buildSoakPlan({ replayManifest, milestone: 3 }).checkpoints, []);
  assert.deepEqual(buildSoakPlan({ replayManifest, milestone: 20 }).checkpoints, [10, 20]);
  assert.deepEqual(buildSoakPlan({ replayManifest, milestone: 100 }).checkpoints, [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  assert.equal(buildSoakPlan({ replayManifest, milestone: 200 }).checkpoints.length, 20);
});

test('soak run passes only with every audited chapter and all 10-chapter health snapshots', () => {
  const plan = buildSoakPlan({ replayManifest, milestone: 20 });
  const report = evaluateSoakRun({ plan, chapters: completedChapters(20), checkpoints: checkpoints([10, 20]) });
  assert.equal(report.status, 'PASS');
  assert.equal(report.completed_chapters, 20);
  assert.deepEqual(Object.keys(report.checkpoints), ['10', '20']);
  assert.equal(report.checkpoints[10].metrics.aiFlavorDrift, 8);
});

test('incomplete chapter evidence or a missing checkpoint blocks long-form acceptance', () => {
  const plan = buildSoakPlan({ replayManifest, milestone: 10 });
  const report = evaluateSoakRun({ plan, chapters: completedChapters(9), checkpoints: [] });
  assert.equal(report.status, 'BLOCKED');
  assert.ok(report.blocked_chapters.includes(10));
  assert.ok(report.blocked_chapters.includes('checkpoint_10'));
});

test('an audited chapter failure fails the cumulative soak report', () => {
  const chapters = completedChapters(10);
  chapters[6] = { ...chapters[6], status: 'failed', audit_passed: false };
  const report = evaluateSoakRun({
    plan: buildSoakPlan({ replayManifest, milestone: 10 }),
    chapters,
    checkpoints: checkpoints([10])
  });
  assert.equal(report.status, 'FAIL');
  assert.deepEqual(report.failed_chapters, [7]);
});
