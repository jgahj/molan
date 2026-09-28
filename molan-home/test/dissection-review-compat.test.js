'use strict';

// 历史流水线结果兼容：人物档案已存在但旧版本未保存 characterAggregation 时，不能反复误报 review。
const test = require('node:test');
const assert = require('node:assert/strict');
const { __test } = require('../server');

function completeLegacyResult() {
  const result = __test.emptyDissectionResult();
  result.overview = { summary: '作品概览' };
  result.framework = { mainline: '主线' };
  result.dissectionMap = { factCount: 1 };
  result.architecture = { structuralPattern: '结构骨架' };
  result.opening = { hook: '开篇钩子' };
  result.goldenFinger = { exists: false, type: 'none' };
  result.evidenceLedger = [{ source: '第1章', observation: '事实' }];
  result.timeline = [{ position: '第1章', event: '事件' }];
  result.outline = [{ position: '第1章', goal: '目标' }];
  result.foreshadowing = [{ id: 'f1', setupChapter: 1, expectedPayoff: '回收', status: 'planned' }];
  result.styleProfile = { summary: '文风' };
  result.craftConstraints = [{ rule: '约束' }];
  result.emotion = { emotionCurve: [{ position: '第1章', intensity: 5 }] };
  result.characters = [{ name: '主角', function: '推动主线' }];
  result.summaryCoverage = {
    chapter: { complete: true },
    arc: { complete: true },
    volume: { complete: true },
    book: { complete: true },
    volumeDigestComplete: true
  };
  result.bookSummary = { coverage: { complete: true } };
  result.validation = {
    conclusion: 'needs_review',
    uncertain: [],
    conflicts: [],
    notes: [],
    missingFields: ['characters aggregation coverage'],
    portableRules: [],
    coverage: 1
  };
  return result;
}

test('legacy character records infer aggregation metadata only when characters are meaningful', () => {
  const result = completeLegacyResult();
  const aggregation = __test.legacyPipelineCharacterAggregation(result);
  assert.equal(aggregation.complete, true);
  assert.equal(aggregation.status, 'legacy');
  assert.equal(aggregation.expected, 1);
  assert.deepEqual(__test.pipelineAggregationMissingFields(result), []);

  const normalized = __test.normalizePipelineAggregationResult(result);
  assert.equal(normalized.characterAggregation.source, 'legacy-character-records');
  assert.equal(normalized.characterAggregation.complete, true);
});

test('empty or explicitly incomplete character aggregation remains needs_review', () => {
  const emptyCharacters = completeLegacyResult();
  emptyCharacters.characters = [];
  assert.equal(__test.legacyPipelineCharacterAggregation(emptyCharacters), null);
  assert.ok(__test.pipelineAggregationMissingFields(emptyCharacters).includes('characters aggregation coverage'));

  const explicitIncomplete = completeLegacyResult();
  explicitIncomplete.characterAggregation = { complete: false, status: 'needs_review' };
  assert.equal(__test.legacyPipelineCharacterAggregation(explicitIncomplete), null);
  assert.ok(__test.pipelineAggregationMissingFields(explicitIncomplete).includes('characters aggregation coverage'));
});

test('fully covered historical review records are upgraded to completed', () => {
  const record = {
    id: 'legacy-review',
    userEmail: 'tester@example.com',
    status: 'needs_review',
    phase: 'needs_review',
    progress: 95,
    depth: 'deep',
    result: completeLegacyResult(),
    meta: { pipeline: { unitTotal: 10, unitCompleted: 10, factCoverage: 1, failedBatches: [] } }
  };
  const upgraded = __test.normalizeLegacyPipelineRecord(record);
  assert.ok(upgraded);
  assert.equal(upgraded.status, 'completed');
  assert.equal(upgraded.phase, 'completed');
  assert.equal(upgraded.progress, 100);
  assert.equal(upgraded.result.validation.conclusion, 'passed');
  assert.deepEqual(upgraded.result.validation.missingFields, []);
  assert.equal(upgraded.meta.pipeline.aggregationComplete, true);
  assert.equal(upgraded.meta.pipeline.legacyCharacterAggregation, true);
});

test('coverage gaps and failed batches are never upgraded by legacy compatibility', () => {
  const incomplete = {
    id: 'legacy-incomplete',
    status: 'needs_review',
    depth: 'deep',
    result: completeLegacyResult(),
    meta: { pipeline: { unitTotal: 10, unitCompleted: 9, factCoverage: 0.9, failedBatches: [] } }
  };
  assert.equal(__test.normalizeLegacyPipelineRecord(incomplete), null);

  const failedBatch = {
    ...incomplete,
    meta: { pipeline: { unitTotal: 10, unitCompleted: 10, factCoverage: 1, failedBatches: [3] } }
  };
  assert.equal(__test.normalizeLegacyPipelineRecord(failedBatch), null);
});
