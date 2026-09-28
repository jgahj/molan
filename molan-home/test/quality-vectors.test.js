'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  QUALITY_DIMENSIONS,
  DEFECT_DIMENSIONS,
  ROOT_CAUSE_DIMENSIONS,
  buildQualityVector,
  buildDefectVector,
  buildRootCauseVector
} = require('../lib/quality-vectors');

test('quality vector preserves explicit scores and marks absent dimensions unknown', () => {
  const vector = buildQualityVector({
    schemaVersion: 'fixture-v1',
    plot: { value: { score: 73 }, confidence: 0.8, evidence: [{ id: 'ev-1', location: 'ch-1' }] },
    language: { value: { aiFlavorScore: 22 }, confidence: 0.7, evidence: [] }
  });

  assert.equal(vector.schemaVersion, 'quality-vector-v1');
  assert.equal(vector.values.plot, 73);
  assert.equal(vector.dimensions.plot.status, 'measured');
  assert.equal(vector.values.ai_flavor, 22);
  assert.equal(vector.dimensions.ai_flavor.direction, 'lower_is_better');
  assert.equal(vector.values.originality, null);
  assert.equal(vector.dimensions.originality.status, 'unknown');
  assert.equal(Object.keys(vector.values).length, QUALITY_DIMENSIONS.length);
});

test('defect vector distinguishes undetected from explicitly clear dimensions', () => {
  const vector = buildDefectVector({
    status: 'partial',
    assessed_dimensions: ['weak_hook'],
    defects: [{
      defect_id: 'DEF-OPEN-1',
      category: '开篇',
      severity: 'B',
      confidence: 0.9,
      location: { chapter: 1, paragraph_range: [2, 3] },
      evidence: '不应复制到向量'
    }]
  });

  assert.equal(vector.values.weak_opening, 0.8);
  assert.equal(vector.dimensions.weak_opening.count, 1);
  assert.equal(vector.values.weak_hook, 0);
  assert.equal(vector.dimensions.weak_hook.status, 'clear');
  assert.equal(vector.values.flat_pacing, null);
  assert.equal(vector.dimensions.weak_opening.evidence_refs[0].reference, 'DEF-OPEN-1');
});

test('defect vector does not infer full coverage from a complete report flag', () => {
  const vector = buildDefectVector({
    status: 'complete',
    complete: true,
    assessed_dimensions: ['weak_opening'],
    defects: []
  });

  assert.equal(vector.values.weak_opening, 0);
  assert.equal(vector.dimensions.weak_opening.status, 'clear');
  assert.equal(vector.values.weak_hook, null);
  assert.equal(vector.dimensions.weak_hook.status, 'unknown');
});

test('root cause vector only assigns a risk value when the input has an explicit strength', () => {
  const vector = buildRootCauseVector({
    status: 'partial',
    rootCauses: [{
      defect_id: 'DEF-PLAN-1',
      root_cause: 'Planner goal missing from the chapter contract',
      root_cause_categories: ['Planner'],
      strength: 0.73,
      confidence: 0.8
    }]
  });

  assert.equal(vector.values.planner_goal_missing, 0.73);
  assert.equal(vector.dimensions.planner_goal_missing.count, 1);
  assert.equal(vector.values.context_overload, null);
  assert.equal(Object.keys(vector.values).length, ROOT_CAUSE_DIMENSIONS.length);
  assert.equal(DEFECT_DIMENSIONS.includes('weak_opening'), true);
});

test('root cause confidence does not become strength, and an unquantified diagnosis stays visible', () => {
  const vector = buildRootCauseVector({
    status: 'complete',
    complete: true,
    rootCauses: [{
      defect_id: 'DEF-PLAN-2',
      root_cause: 'Planner goal missing from the chapter contract',
      confidence: 0.98
    }]
  });

  assert.equal(vector.values.planner_goal_missing, null);
  assert.equal(vector.dimensions.planner_goal_missing.status, 'diagnosed');
  assert.equal(vector.dimensions.planner_goal_missing.confidence, 0.98);
  assert.equal(vector.values.scene_objective_missing, null);
  assert.equal(vector.dimensions.scene_objective_missing.status, 'unknown');
});

test('a complete root cause report clears only explicitly assessed dimensions', () => {
  const vector = buildRootCauseVector({
    status: 'complete',
    assessed_dimensions: ['context_overload'],
    rootCauses: []
  });

  assert.equal(vector.values.context_overload, 0);
  assert.equal(vector.dimensions.context_overload.status, 'clear');
  assert.equal(vector.values.writer_template_bias, null);
  assert.equal(vector.dimensions.writer_template_bias.status, 'unknown');
});
