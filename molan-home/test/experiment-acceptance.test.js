'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateExperimentAcceptance } = require('../lib/evolution/experiment-acceptance');

function pairedTasks(count = 80) {
  return Array.from({ length: count }, (_, index) => {
    const fixed = {
      genre: index % 2 ? '玄幻修真' : '都市',
      bibleHash: `bible-${index}`,
      outlineHash: `outline-${index}`,
      sceneHash: `scene-${index}`,
      contractHash: `contract-${index}`,
      contextHash: `context-${index}`,
      model: 'test-model',
      parametersHash: 'params-hash',
      benchmarkId: `benchmark-${index}`
    };
    return {
      task_id: `task-${index}`,
      control: {
        fixed_inputs: fixed,
        metrics: {
          dialogue: 0.5, subtext: 0.62, characterVoice: 0.78, continuity: 0.95,
          genreFit: 90, styleFit: 88, originality: 80, stability: 0.99, aiFlavor: 20, cost: 1, latency: 1200
        },
        evidence_refs: [`control:${index}`]
      },
      treatment: {
        fixed_inputs: { ...fixed },
        metrics: {
          dialogue: 0.53, subtext: 0.67, characterVoice: 0.82, continuity: 0.95,
          genreFit: 89, styleFit: 87, originality: 80, stability: 0.99, aiFlavor: 19, cost: 1.1, latency: 1250
        },
        evidence_refs: [`treatment:${index}`]
      },
      blocker_check: { status: 'PASS', evidence_ref: `blockers:${index}` }
    };
  });
}

test('optimization experiment requires 80 controlled, evidence-backed pairs and applies guard thresholds', () => {
  const report = evaluateExperimentAcceptance({ pairs: pairedTasks(), targetMetric: 'dialogue' });
  assert.equal(report.status, 'PROMOTE');
  assert.equal(report.accepted, true);
  assert.equal(report.pair_count, 80);
  assert.equal(report.checks.find(check => check.metric === 'dialogue').relative_improvement, 0.06);
  assert.equal(report.checks.find(check => check.metric === 'genreFit').status, 'PASS');
  assert.equal(report.checks.find(check => check.metric === 'continuity').status, 'PASS');
  assert.equal(report.observed_metrics.subtext.after, 0.67);
  assert.equal(report.observed_metrics.latency.after, 1250);
});

test('small or uncontrolled experiments stay blocked', () => {
  const tooSmall = evaluateExperimentAcceptance({ pairs: pairedTasks(79), targetMetric: 'dialogue' });
  assert.equal(tooSmall.status, 'BLOCKED');

  const drifted = pairedTasks();
  drifted[0].treatment.fixed_inputs.model = 'different-model';
  const report = evaluateExperimentAcceptance({ pairs: drifted, targetMetric: 'dialogue' });
  assert.equal(report.status, 'BLOCKED');
  assert.equal(report.blocked_pairs[0].reason, 'fixed_input_mismatch:model');
});

test('optimization is rejected for blocker regressions, inadequate target gains, or guard damage', () => {
  const lowGain = pairedTasks();
  for (const pair of lowGain) pair.treatment.metrics.dialogue = 0.51;
  assert.equal(evaluateExperimentAcceptance({ pairs: lowGain, targetMetric: 'dialogue' }).status, 'REJECT');

  const guardDamage = pairedTasks();
  for (const pair of guardDamage) pair.treatment.metrics.originality = 79;
  assert.equal(evaluateExperimentAcceptance({ pairs: guardDamage, targetMetric: 'dialogue' }).status, 'REJECT');

  const continuityDamage = pairedTasks();
  for (const pair of continuityDamage) pair.treatment.metrics.continuity = 0.94;
  assert.equal(evaluateExperimentAcceptance({ pairs: continuityDamage, targetMetric: 'dialogue' }).status, 'REJECT');

  const blocker = pairedTasks();
  blocker[12].blocker_check = { status: 'FAIL', evidence_ref: 'blockers:12' };
  const report = evaluateExperimentAcceptance({ pairs: blocker, targetMetric: 'dialogue' });
  assert.equal(report.status, 'REJECT');
  assert.equal(report.checks.find(check => check.metric === 'blocker_regressions').count, 1);
});

test('target metric direction can optimize a lower-is-better measure such as latency or cost', () => {
  const pairs = pairedTasks();
  for (const pair of pairs) {
    pair.control.metrics.cost = 2;
    pair.treatment.metrics.cost = 1.8;
  }
  const report = evaluateExperimentAcceptance({ pairs, targetMetric: 'cost', targetDirection: 'lower' });
  assert.equal(report.status, 'PROMOTE');
  assert.equal(report.target_direction, 'lower');
  assert.equal(report.checks.find(check => check.metric === 'cost').relative_improvement, 0.1);
});
