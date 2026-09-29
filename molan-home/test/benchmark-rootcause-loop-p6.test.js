'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createGenerationArtifact,
  executeClosedEvolutionLoop
} = require('../lib/evolution/benchmark-evolution-loop');
const { analyzeQualityRootCauses } = require('../lib/quality/root-cause');

test('P6: GenerationArtifact 具备所有完整定义字段', () => {
  const artifact = createGenerationArtifact({
    generationId: 'gen-art-001',
    genreProfile: { genre: '玄幻', confidence: 1 },
    styleBundle: { version: 'style-bundle-v1', hash: 'sb-hash-1' },
    contract: { chapterGoal: '探查深渊', scenes: [] },
    contextPlan: { contextPlanVersion: '4', hardLimit: 32768 },
    content: '长风呼啸，周叙按剑驻足在石门之前。四周荒草丛生，唯有远处传来两声隐约的钟鸣。',
    qualityVector: { language: { value: 0.85, status: 'MEASURED', confidence: 0.9, source: 'test', evidence: ['字数合规'] } },
    usage: { creditCost: 0.05, latency: 1200 },
    model: 'claude-3-5-sonnet',
    promptVersion: 'writer-v2',
    pipelineVersion: 'generation-v2.1'
  });

  assert.equal(artifact.generationId, 'gen-art-001');
  assert.equal(artifact.genreProfile.genre, '玄幻');
  assert.equal(artifact.styleBundle.version, 'style-bundle-v1');
  assert.equal(artifact.contract.chapterGoal, '探查深渊');
  assert.equal(artifact.contextPlan.contextPlanVersion, '4');
  assert.equal(artifact.model, 'claude-3-5-sonnet');
  assert.equal(artifact.promptVersion, 'writer-v2');
  assert.equal(artifact.pipelineVersion, 'generation-v2.1');
  assert.equal(typeof artifact.hash, 'string');
  assert.ok(artifact.hash.length >= 32);
});

test('P6: Root Cause 必须严格满足 11 大标准字段', () => {
  const defect = {
    defect_id: 'defect-diag-001',
    category: 'dialogue',
    symptom: '对白指标低于同题材基准 P25',
    diagnostics: {
      benchmark: { value: 0.08, p25: 0.20, evidence_ref: { evidence_id: 'ev-b', artifact_id: 'benchmark', location: 'p25' } },
      scene_contract: { dialogue_objective: 'missing', evidence_ref: { evidence_id: 'ev-s', artifact_id: 'contract', location: 'scene' } },
      planner_contract: { dialogue_objective: 'missing', evidence_ref: { evidence_id: 'ev-p', artifact_id: 'planner', location: 'plan' } }
    },
    evidence_refs: [
      { evidence_id: 'ev-b', artifact_id: 'benchmark', location: 'p25' },
      { evidence_id: 'ev-s', artifact_id: 'contract', location: 'scene' },
      { evidence_id: 'ev-p', artifact_id: 'planner', location: 'plan' },
      { evidence_id: 'ev-c', artifact_id: 'content', location: 'quotes' }
    ]
  };

  const diagnosis = analyzeQualityRootCauses({ defects: [defect] });
  assert.equal(diagnosis.status, 'ANALYZED');
  assert.equal(diagnosis.rootCauses.length, 1);

  const rc = diagnosis.rootCauses[0];

  // 11 维字段完整性断言
  assert.ok(rc.symptom, 'Missing Symptom');
  assert.ok(rc.metric, 'Missing Metric');
  assert.ok(rc.evidence, 'Missing Evidence');
  assert.ok(rc.defect, 'Missing Defect');
  assert.ok(rc.root_cause, 'Missing Root Cause');
  assert.ok(rc.module, 'Missing Module');
  assert.ok(rc.parameter, 'Missing Parameter');
  assert.ok(rc.hypothesis, 'Missing Hypothesis');
  assert.ok(rc.experiment, 'Missing Experiment');
  assert.ok(rc.result, 'Missing Result');
  assert.equal(rc.status, 'confirmed');
});

test('P6: 真实完整演化闭环 (生成 → 发现问题 → 定位根因 → 修改参数 → A/B → Shadow → Regression → Accept)', async () => {
  // 1. 低对白正文（对白为 0，低于玄幻 P25=0.18）
  const lowDialogueText = '风沙卷过破败的客栈门板，枯草在石阶前堆积如山。陈寻擦去刀锋上的水渍，眼神沉凝。远处黑云压顶，雷声滚滚。'.repeat(3);

  const artifact = createGenerationArtifact({
    generationId: 'gen-loop-001',
    genreProfile: { genre: '玄幻' },
    styleBundle: { version: 'style-bundle-v1', hash: 'sb-1' },
    contract: { chapterGoal: '查探客栈', dialogue_objective: 'missing' },
    content: lowDialogueText,
    qualityVector: {
      language: { value: 0.85, status: 'MEASURED', confidence: 0.9, source: 'test', evidence: ['字数达标'] }
    },
    usage: { creditCost: 0.05, latency: 1200 },
    model: 'claude-3-5-sonnet'
  });

  // 2. 运行完整闭环
  const loopResult = await executeClosedEvolutionLoop(artifact, {
    benchmarkPool: {
      '玄幻': { dialogue: { p25: 0.18, p50: 0.30, p75: 0.45 } }
    },
    parameterChange: {
      parameter: 'sceneContract.dialogue_objective',
      from: 'missing',
      to: 'interrogation_dialogue',
      targetMetric: 'dialogue'
    }
  });

  assert.equal(loopResult.status, 'COMPLETED');
  assert.equal(loopResult.decision, 'ACCEPT');

  // 验证问题发现与根因定位
  assert.ok(loopResult.metricGaps.length > 0);
  assert.equal(loopResult.metricGaps[0].metric, 'dialogue');
  assert.ok(loopResult.rootCause);
  assert.equal(loopResult.rootCause.parameter, 'sceneContract.dialogue_objective');

  // 验证 Shadow 评估与回归门禁通过
  assert.equal(loopResult.shadowEvaluation.status, 'completed');
  assert.equal(loopResult.regressionGate.status, 'PASS');

  // 验证产生沉淀知识
  assert.ok(loopResult.acceptedKnowledge);
  assert.equal(loopResult.acceptedKnowledge.parameter, 'sceneContract.dialogue_objective');
  assert.equal(loopResult.acceptedKnowledge.optimal_value, 'interrogation_dialogue');
  assert.ok(loopResult.acceptedKnowledge.gain > 0);
});

test('P6: 回归门禁拦截劣质修改并输出 REJECT', async () => {
  const lowDialogueText = '风沙卷过破败的客栈门板，枯草在石阶前堆积如山。'.repeat(5);

  const artifact = createGenerationArtifact({
    generationId: 'gen-loop-fail',
    genreProfile: { genre: '玄幻' },
    contract: { chapterGoal: '查探客栈' },
    content: lowDialogueText,
    qualityVector: {
      language: { value: 0.85, status: 'MEASURED', confidence: 0.9, source: 'test', evidence: ['字数达标'] }
    }
  });

  // 模拟引发连续性崩塌的破坏性候选
  const loopResult = await executeClosedEvolutionLoop(artifact, {
    benchmarkPool: {
      '玄幻': { dialogue: { p25: 0.18, p50: 0.30, p75: 0.45 } }
    },
    mutateCandidate: async (orig) => ({
      ...orig,
      content: orig.content // 未实质改善对白
    })
  });

  // 未改善 target metric 时正确 REJECT
  assert.equal(loopResult.decision, 'REJECT');
  assert.equal(loopResult.acceptedKnowledge, null);
});
