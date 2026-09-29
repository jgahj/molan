'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeQualityRootCauses } = require('../lib/quality/root-cause');

function dialogueDefect(withTrace = true) {
  const defect = {
    defect_id: 'DEF-DIALOGUE-1',
    category: 'dialogue',
    symptom: '对白回合数低于同题材基准',
    evidence_refs: [{ evidence_id: 'ev-symptom', artifact_id: 'chapter-1', location: 'chapter:1/paragraph:4' }]
  };
  if (withTrace) {
    defect.diagnostics = {
      benchmark: {
        metric: 'dialogueTurns', value: 2, p25: 5,
        evidence_ref: { evidence_id: 'ev-benchmark', artifact_id: 'pool-1', location: 'dialogueTurns.p25' }
      },
      scene_contract: {
        dialogue_objective: 'missing',
        evidence_ref: { evidence_id: 'ev-scene-contract', artifact_id: 'contract-1', location: 'scene.dialogueObjective' }
      },
      planner_contract: {
        dialogue_objective: 'missing',
        evidence_ref: { evidence_id: 'ev-planner-contract', artifact_id: 'prompt-1', location: 'planner.dialogueObjective' }
      }
    };
  } else {
    defect.diagnostics = { benchmark: { value: 2, p25: 5 } };
  }
  return defect;
}

test('root cause engine traces a confirmed dialogue gap through scene and planner contracts', () => {
  const report = analyzeQualityRootCauses({ defects: [dialogueDefect()] });
  assert.equal(report.status, 'ANALYZED');
  assert.equal(report.rootCauses.length, 1);
  const cause = report.rootCauses[0];
  assert.equal(cause.status, 'confirmed');
  assert.match(cause.cause_chain.system_cause, /DialogueObjective/);
  assert.deepEqual(cause.affected_module, ['Scene Planner', 'Dialogue Contract', 'Character Voice']);
  assert.equal(cause.evidence_refs.length, 4);
  assert.equal(report.root_cause_vector.dimensions.planner_goal_missing.status, 'diagnosed');
});

test('root cause engine leaves symptom-only findings unresolved instead of inventing a chain', () => {
  const report = analyzeQualityRootCauses({ defects: [dialogueDefect(false)] });
  assert.equal(report.status, 'NEEDS_MORE_DATA');
  assert.equal(report.rootCauses.length, 0);
  assert.deepEqual(report.unresolved_defects, [{ defect_id: 'DEF-DIALOGUE-1', reason: 'causal_trace_evidence_incomplete' }]);
});

test('root cause evidence references reject excerpts and copied text', () => {
  const report = analyzeQualityRootCauses({ defects: [{
    ...dialogueDefect(),
    evidence_refs: [{ evidence_id: 'ev-1', artifact_id: 'chapter-1', location: 'p1', quote: 'private excerpt' }]
  }] });
  assert.equal(report.rootCauses.length, 0);
  assert.equal(JSON.stringify(report).includes('private excerpt'), false);
});

test('root cause engine accepts complete six-layer traces for any defect when every link has evidence', () => {
  const stages = ['phenomenon', 'direct_cause', 'system_cause', 'process_cause', 'data_cause', 'architectural_cause'];
  const causeChain = Object.fromEntries(stages.map(stage => [stage, `${stage} is traced to context overload`]));
  const evidenceRefsByStage = Object.fromEntries(stages.map((stage, index) => [stage, [{
    evidence_id: `ev-${index}`, artifact_id: `trace-${index}`, location: `trace/${stage}`
  }]]));
  const report = analyzeQualityRootCauses({ defects: [{
    defect_id: 'DEF-CONTEXT-1',
    category: 'context',
    causal_trace: {
      root_cause: 'context overload',
      root_cause_categories: ['context_overload'],
      affected_module: ['Context Builder'],
      cause_chain: causeChain,
      evidence_refs_by_stage: evidenceRefsByStage
    }
  }] });

  assert.equal(report.status, 'ANALYZED');
  assert.equal(report.rootCauses[0].trace_rule, 'verified-causal-trace-v1');
  assert.equal(report.rootCauses[0].evidence_refs.length, 6);
  assert.equal(report.root_cause_vector.dimensions.context_overload.status, 'diagnosed');
});
