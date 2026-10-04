'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  evaluateDualJudgeConsensus,
  createJudgeEvaluationRecord,
  resolveEvaluationRoute,
  shouldEscalateToDualJudge,
  MAX_ALLOWED_DISCREPANCY_DELTA
} = require('../lib/quality/dual-judge');

const { evaluateQualityGate } = require('../lib/generation/quality-gate');
const { createGenerationService } = require('../services/generation-service');

function sha256(str) {
  return crypto.createHash('sha256').update(String(str || ''), 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// SUITE 1: Escalation Boundary Testing (Exact Thresholds)
// ---------------------------------------------------------------------------

test('Challenger M4-2 Stress 1.1: Overall score boundaries (0.649 vs 0.650, 0.780 vs 0.781)', () => {
  // 1.1.1 score = 0.649 (outside borderline, does not escalate on score)
  const belowLower = shouldEscalateToDualJudge({
    score: 0.649,
    confidence: 0.90,
    qualityVector: { language: { score: 0.649, confidence: 0.90 } }
  });
  assert.equal(belowLower.escalate, false, 'Score 0.649 must NOT escalate (below borderline)');
  assert.equal(belowLower.reason, 'HIGH_CONFIDENCE_NORMAL');

  // 1.1.2 score = 0.650 (exact lower boundary of borderline, escalates)
  const atLower = shouldEscalateToDualJudge({
    score: 0.650,
    confidence: 0.90,
    qualityVector: { language: { score: 0.650, confidence: 0.90 } }
  });
  assert.equal(atLower.escalate, true, 'Score 0.650 MUST escalate (lower borderline boundary)');
  assert.equal(atLower.reason, 'BORDERLINE_SCORE');

  // 1.1.3 score = 0.780 (exact upper boundary of borderline, escalates)
  const atUpper = shouldEscalateToDualJudge({
    score: 0.780,
    confidence: 0.90,
    qualityVector: { language: { score: 0.780, confidence: 0.90 } }
  });
  assert.equal(atUpper.escalate, true, 'Score 0.780 MUST escalate (upper borderline boundary)');
  assert.equal(atUpper.reason, 'BORDERLINE_SCORE');

  // 1.1.4 score = 0.781 (outside borderline, does not escalate on score)
  const aboveUpper = shouldEscalateToDualJudge({
    score: 0.781,
    confidence: 0.90,
    qualityVector: { language: { score: 0.781, confidence: 0.90 } }
  });
  assert.equal(aboveUpper.escalate, false, 'Score 0.781 must NOT escalate (above borderline)');
  assert.equal(aboveUpper.reason, 'HIGH_CONFIDENCE_NORMAL');
});

test('Challenger M4-2 Stress 1.2: Overall confidence boundaries (0.849 vs 0.850)', () => {
  // 1.2.1 confidence = 0.849 (below 0.85, escalates)
  const belowConf = shouldEscalateToDualJudge({
    score: 0.820,
    confidence: 0.849,
    qualityVector: { language: { score: 0.820, confidence: 0.90 } }
  });
  assert.equal(belowConf.escalate, true, 'Confidence 0.849 MUST escalate (below 0.85 threshold)');
  assert.equal(belowConf.reason, 'LOW_CONFIDENCE');

  // 1.2.2 confidence = 0.850 (at 0.85 threshold, does not escalate)
  const atConf = shouldEscalateToDualJudge({
    score: 0.820,
    confidence: 0.850,
    qualityVector: { language: { score: 0.820, confidence: 0.90 } }
  });
  assert.equal(atConf.escalate, false, 'Confidence 0.850 must NOT escalate on confidence');
  assert.equal(atConf.reason, 'HIGH_CONFIDENCE_NORMAL');

  // 1.2.3 confidence = 0.851 (above threshold, does not escalate)
  const aboveConf = shouldEscalateToDualJudge({
    score: 0.820,
    confidence: 0.851,
    qualityVector: { language: { score: 0.820, confidence: 0.90 } }
  });
  assert.equal(aboveConf.escalate, false, 'Confidence 0.851 must NOT escalate');
  assert.equal(aboveConf.reason, 'HIGH_CONFIDENCE_NORMAL');
});

test('Challenger M4-2 Stress 1.3: Critical dimension score boundaries [0.700, 0.750]', () => {
  // 1.3.1 Critical dimension score = 0.700 (exact lower boundary, escalates)
  const dimLower = shouldEscalateToDualJudge({
    score: 0.820,
    confidence: 0.90,
    qualityVector: {
      language: { score: 0.700, confidence: 0.90 },
      character: { score: 0.850, confidence: 0.90 }
    }
  });
  assert.equal(dimLower.escalate, true, 'Dimension score 0.700 MUST escalate (lower borderline boundary)');
  assert.equal(dimLower.reason, 'BORDERLINE_DIMENSION');

  // 1.3.2 Critical dimension score = 0.750 (exact upper boundary, escalates)
  const dimUpper = shouldEscalateToDualJudge({
    score: 0.820,
    confidence: 0.90,
    qualityVector: {
      language: { score: 0.750, confidence: 0.90 },
      character: { score: 0.850, confidence: 0.90 }
    }
  });
  assert.equal(dimUpper.escalate, true, 'Dimension score 0.750 MUST escalate (upper borderline boundary)');
  assert.equal(dimUpper.reason, 'BORDERLINE_DIMENSION');

  // 1.3.3 Critical dimension score = 0.699 (below [0.700, 0.750] range)
  const dimBelow = shouldEscalateToDualJudge({
    score: 0.820,
    confidence: 0.90,
    qualityVector: {
      language: { score: 0.699, confidence: 0.90 }
    }
  });
  assert.equal(dimBelow.escalate, false, 'Dimension score 0.699 must NOT trigger BORDERLINE_DIMENSION');

  // 1.3.4 Critical dimension score = 0.751 (above [0.700, 0.750] range)
  const dimAbove = shouldEscalateToDualJudge({
    score: 0.820,
    confidence: 0.90,
    qualityVector: {
      language: { score: 0.751, confidence: 0.90 }
    }
  });
  assert.equal(dimAbove.escalate, false, 'Dimension score 0.751 must NOT trigger BORDERLINE_DIMENSION');
});

test('Challenger M4-2 Stress 1.4: Critical dimension confidence boundaries (<0.80)', () => {
  // 1.4.1 Dimension confidence = 0.799 (< 0.80, escalates)
  const dimConfLow = shouldEscalateToDualJudge({
    score: 0.820,
    confidence: 0.90,
    qualityVector: {
      language: { score: 0.850, confidence: 0.799 }
    }
  });
  assert.equal(dimConfLow.escalate, true, 'Dimension confidence 0.799 MUST escalate (below 0.80)');
  assert.equal(dimConfLow.reason, 'LOW_CONFIDENCE');

  // 1.4.2 Dimension confidence = 0.800 (at threshold, does not escalate)
  const dimConfAt = shouldEscalateToDualJudge({
    score: 0.820,
    confidence: 0.90,
    qualityVector: {
      language: { score: 0.850, confidence: 0.800 }
    }
  });
  assert.equal(dimConfAt.escalate, false, 'Dimension confidence 0.800 must NOT escalate');
  assert.equal(dimConfAt.reason, 'HIGH_CONFIDENCE_NORMAL');
});

test('Challenger M4-2 Stress 1.5: shouldEscalateToDualJudge edge cases & malformed inputs', () => {
  assert.deepEqual(shouldEscalateToDualJudge(null), { escalate: false, reason: 'NO_EVALUATION' });
  assert.deepEqual(shouldEscalateToDualJudge(undefined), { escalate: false, reason: 'NO_EVALUATION' });
  assert.deepEqual(shouldEscalateToDualJudge('not an object'), { escalate: false, reason: 'NO_EVALUATION' });
  assert.deepEqual(shouldEscalateToDualJudge({}), { escalate: false, reason: 'HIGH_CONFIDENCE_NORMAL' });

  // literary.dimensions compatibility
  const literaryEscalate = shouldEscalateToDualJudge({
    score: 0.82,
    confidence: 0.90,
    literary: {
      dimensions: {
        causality: { score: 0.72, confidence: 0.90 }
      }
    }
  });
  assert.equal(literaryEscalate.escalate, true);
  assert.equal(literaryEscalate.reason, 'BORDERLINE_DIMENSION');
});

// ---------------------------------------------------------------------------
// SUITE 2: Selective Routing Engine Exhaustive Edge Cases
// ---------------------------------------------------------------------------

test('Challenger M4-2 Stress 2.1: Selective routing - Golden chapters 1-3 all extraction forms', () => {
  const goldenInputs = [
    { chapterNo: 1 },
    { chapterNo: 2 },
    { chapterNo: 3 },
    { contract: { chapterNo: 1 } },
    { contract: { chapterNo: 2 } },
    { contract: { chapterNo: 3 } },
    { request: { chapterNo: 1 } },
    { request: { chapterNo: 2 } },
    { request: { chapterNo: 3 } },
    { options: { chapterNo: 1 } },
    { options: { chapterNo: 2 } },
    { options: { chapterNo: 3 } },
    { request: { chapterId: 'chap_001_intro' } },
    { contract: { chapterId: 'c2_hook' } },
    { contract: { chapterFunction: 'golden_chapter_1' } },
    { contract: { chapterFunction: 'hook_opening' } },
    { request: { chapterFunction: 'goldfinger_manifest' } },
    { contract: { chapterFunction: 'first_cool_payoff' } }
  ];

  for (const input of goldenInputs) {
    const route = resolveEvaluationRoute(input);
    assert.equal(route.route, 'DUAL_JUDGE', `Failed for input: ${JSON.stringify(input)}`);
    assert.equal(route.reason, 'GOLDEN_CHAPTER', `Failed reason for input: ${JSON.stringify(input)}`);
  }
});

test('Challenger M4-2 Stress 2.2: Selective routing - Volume climaxes & turning points', () => {
  const climaxInputs = [
    { chapterNo: 10, isVolumeClimax: true },
    { chapterNo: 15, options: { isVolumeClimax: true } },
    { chapterNo: 20, request: { isVolumeClimax: true } },
    { chapterNo: 25, contract: { isVolumeClimax: true } },
    { chapterNo: 30, contract: { chapterType: 'volume_climax' } },
    { chapterNo: 35, request: { chapterType: 'volume_climax' } },
    { chapterNo: 40, contract: { isClimax: true } },
    { chapterNo: 45, request: { isClimax: true } }
  ];

  for (const input of climaxInputs) {
    const route = resolveEvaluationRoute(input);
    assert.equal(route.route, 'DUAL_JUDGE', `Failed climax for: ${JSON.stringify(input)}`);
    assert.equal(route.reason, 'VOLUME_CLIMAX', `Failed reason for: ${JSON.stringify(input)}`);
  }

  const turningPointInputs = [
    { chapterNo: 8, isMajorTurningPoint: true },
    { chapterNo: 12, options: { isMajorTurningPoint: true } },
    { chapterNo: 16, request: { isMajorTurningPoint: true } },
    { chapterNo: 24, contract: { isMajorTurningPoint: true } },
    { chapterNo: 28, contract: { isTurningPoint: true } },
    { chapterNo: 32, request: { isTurningPoint: true } },
    { chapterNo: 36, contract: { chapterType: 'major_turning_point' } },
    { chapterNo: 42, request: { chapterType: 'major_turning_point' } }
  ];

  for (const input of turningPointInputs) {
    const route = resolveEvaluationRoute(input);
    assert.equal(route.route, 'DUAL_JUDGE', `Failed turning point for: ${JSON.stringify(input)}`);
    assert.equal(route.reason, 'MAJOR_TURNING_POINT', `Failed reason for: ${JSON.stringify(input)}`);
  }
});

test('Challenger M4-2 Stress 2.3: Selective routing - Explicit override beats normal chapters', () => {
  const overrideInputs = [
    { chapterNo: 4, forceDualJudge: true },
    { chapterNo: 10, options: { forceDualJudge: true } },
    { chapterNo: 50, request: { forceDualJudge: true } },
    { chapterNo: 100, contract: { forceDualJudge: true } }
  ];

  for (const input of overrideInputs) {
    const route = resolveEvaluationRoute(input);
    assert.equal(route.route, 'DUAL_JUDGE');
    assert.equal(route.reason, 'EXPLICIT_OVERRIDE');
  }

  // Normal chapters default to SINGLE_JUDGE
  for (const ch of [4, 5, 6, 11, 49, 99]) {
    const route = resolveEvaluationRoute({ chapterNo: ch });
    assert.equal(route.route, 'SINGLE_JUDGE');
    assert.equal(route.reason, 'NORMAL_CHAPTER');
  }
});

// ---------------------------------------------------------------------------
// SUITE 3: Consensus Merging Properties & Metadata Provenance
// ---------------------------------------------------------------------------

test('Challenger M4-2 Stress 3.1: Arithmetic score and confidence merging with distinct metadata', () => {
  const judgeA = {
    judgeId: 'judge_a',
    evaluatorId: 'evaluator_deep_a',
    modelId: 'gpt-4o',
    promptVersion: 'v2.1',
    score: 0.86,
    passed: true,
    confidence: 0.92,
    qualityVector: {
      language: { score: 0.88, confidence: 0.94, quote: '剑鸣清越如龙吟', evidence: '音韵铿锵' },
      causality: { score: 0.84, confidence: 0.90, quote: '因前尘宿怨而拔剑', evidence: '动机闭环' }
    }
  };

  const judgeB = {
    judgeId: 'judge_b',
    evaluatorId: 'evaluator_deep_b',
    modelId: 'deepseek-reasoner',
    promptVersion: 'v2.1',
    score: 0.80,
    passed: true,
    confidence: 0.86,
    qualityVector: {
      language: { score: 0.82, confidence: 0.88, quote: '石砖寸寸龟裂', evidence: '动词精准' },
      causality: { score: 0.78, confidence: 0.84, quote: '伏笔在第三幕呼应', evidence: '因果严密' }
    }
  };

  const merged = evaluateDualJudgeConsensus(judgeA, judgeB);

  // 1. Overall arithmetic properties
  assert.equal(merged.consensus, true);
  assert.equal(merged.passed, true);
  assert.equal(merged.status, 'MEASURED');
  assert.equal(merged.source, 'dual_judge_consensus');
  assert.equal(merged.score, 0.83, 'Overall score must be exactly (0.86 + 0.80) / 2 = 0.83');
  assert.equal(merged.confidence, 0.89, 'Overall confidence must be exactly (0.92 + 0.86) / 2 = 0.89');

  // 2. Per-dimension arithmetic properties
  assert.equal(merged.qualityVector.language.score, 0.85, 'Language score (0.88 + 0.82) / 2 = 0.85');
  assert.equal(merged.qualityVector.language.confidence, 0.91, 'Language confidence (0.94 + 0.88) / 2 = 0.91');
  assert.equal(merged.qualityVector.language.status, 'MEASURED');
  assert.equal(merged.qualityVector.language.source, 'dual_judge_consensus');

  assert.equal(merged.qualityVector.causality.score, 0.81, 'Causality score (0.84 + 0.78) / 2 = 0.81');
  assert.equal(merged.qualityVector.causality.confidence, 0.87, 'Causality confidence (0.90 + 0.84) / 2 = 0.87');

  // 3. Evidence combination and quote preservation
  assert.equal(merged.qualityVector.language.quote, '剑鸣清越如龙吟', 'Quote from Judge A must be retained');
  assert.ok(Array.isArray(merged.qualityVector.language.evidence), 'Evidence must be combined array');
  assert.ok(merged.qualityVector.language.evidence.includes('音韵铿锵'));
  assert.ok(merged.qualityVector.language.evidence.includes('动词精准'));

  // 4. Distinct evaluator metadata retention
  assert.equal(merged.judgeA.judgeId, 'judge_a');
  assert.equal(merged.judgeA.evaluatorId, 'evaluator_deep_a');
  assert.equal(merged.judgeA.modelId, 'gpt-4o');
  assert.ok(merged.judgeA.inputHash && merged.judgeA.inputHash.length === 64);
  assert.ok(merged.judgeA.outputHash && merged.judgeA.outputHash.length === 64);

  assert.equal(merged.judgeB.judgeId, 'judge_b');
  assert.equal(merged.judgeB.evaluatorId, 'evaluator_deep_b');
  assert.equal(merged.judgeB.modelId, 'deepseek-reasoner');
  assert.ok(merged.judgeB.inputHash && merged.judgeB.inputHash.length === 64);
  assert.ok(merged.judgeB.outputHash && merged.judgeB.outputHash.length === 64);

  assert.notEqual(merged.judgeA.judgeId, merged.judgeB.judgeId);
  assert.notEqual(merged.judgeA.evaluatorId, merged.judgeB.evaluatorId);
  assert.notEqual(merged.judgeA.modelId, merged.judgeB.modelId);
  assert.notEqual(merged.judgeA.outputHash, merged.judgeB.outputHash);
});

test('Challenger M4-2 Stress 3.2: Asymmetric dimension merging & fallback quotes', () => {
  const judgeA = {
    score: 0.80,
    passed: true,
    qualityVector: {
      language: { score: 0.82, quote: '', evidence: '无引文证据' },
      dialogue: { score: 0.78, quote: '对话第一句', evidence: '对话生动' }
    }
  };

  const judgeB = {
    score: 0.80,
    passed: true,
    qualityVector: {
      language: { score: 0.80, quote: '正文第二句引文', evidence: '句式清晰' },
      pacing: { score: 0.79, quote: '节奏第四段', evidence: '推进紧凑' } // Only in B
    }
  };

  const merged = evaluateDualJudgeConsensus(judgeA, judgeB);
  assert.equal(merged.consensus, true);

  // language: judgeA quote empty -> should fallback to judgeB quote
  assert.equal(merged.qualityVector.language.quote, '正文第二句引文');

  // dialogue: only in A -> preserved
  assert.equal(merged.qualityVector.dialogue.score, 0.78);
  assert.equal(merged.qualityVector.dialogue.source, 'dual_judge_consensus');

  // pacing: only in B -> preserved
  assert.equal(merged.qualityVector.pacing.score, 0.79);
  assert.equal(merged.qualityVector.pacing.source, 'dual_judge_consensus');
});

// ---------------------------------------------------------------------------
// SUITE 4: Discrepancy & Conflict Gate Stress Testing
// ---------------------------------------------------------------------------

test('Challenger M4-2 Stress 4.1: Pass/Fail conclusion conflict blocks unconditionally', () => {
  // Even if scores are nearly identical (e.g. 0.71 vs 0.70, delta = 0.01)
  const conflict = evaluateDualJudgeConsensus(
    { score: 0.71, passed: true },
    { score: 0.70, passed: false }
  );

  assert.equal(conflict.consensus, false);
  assert.equal(conflict.passed, false);
  assert.equal(conflict.status, 'needs_human');
  assert.equal(conflict.code, 'DUAL_JUDGE_DISCREPANCY');
  assert.ok(conflict.discrepancies.some(d => d.dimension === 'pass_fail_consensus'));
});

test('Challenger M4-2 Stress 4.2: Both judges fail within tolerance results in consensus=true, passed=false', () => {
  const bothFail = evaluateDualJudgeConsensus(
    { score: 0.55, passed: false },
    { score: 0.52, passed: false }
  );

  assert.equal(bothFail.consensus, true, 'Both agree that draft fails -> consensus achieved');
  assert.equal(bothFail.passed, false, 'Consensus outcome is failure');
  assert.equal(bothFail.status, 'needs_human');
  assert.equal(bothFail.score, 0.535);
});

test('Challenger M4-2 Stress 4.3: Score discrepancy delta boundary (> 0.18)', () => {
  // 1. Delta = 0.20 (> 0.18) must fail
  const delta20 = evaluateDualJudgeConsensus(
    { score: 0.85, passed: true },
    { score: 0.65, passed: true }
  );
  assert.equal(delta20.consensus, false);
  assert.equal(delta20.code, 'DUAL_JUDGE_DISCREPANCY');

  // 2. Dimension delta = 0.20 (> 0.18) must fail even if overall score delta is 0
  const dimDelta20 = evaluateDualJudgeConsensus(
    { score: 0.80, passed: true, qualityVector: { language: { score: 0.90 } } },
    { score: 0.80, passed: true, qualityVector: { language: { score: 0.70 } } }
  );
  assert.equal(dimDelta20.consensus, false);
  assert.equal(dimDelta20.code, 'DUAL_JUDGE_DISCREPANCY');
  assert.ok(dimDelta20.discrepancies.some(d => d.dimension === 'language'));

  // 3. Clear within-tolerance delta = 0.10 (<= 0.18) must pass
  const delta10 = evaluateDualJudgeConsensus(
    { score: 0.85, passed: true },
    { score: 0.75, passed: true }
  );
  assert.equal(delta10.consensus, true);
  assert.equal(delta10.passed, true);
});

// ---------------------------------------------------------------------------
// SUITE 5: Production Pipeline Wiring in generation-service.js
// ---------------------------------------------------------------------------

test('Challenger M4-2 Stress 5.1: generation-service wires qualityAudit with golden chapter dual routing', async () => {
  let capturedOptions;
  const service = createGenerationService({
    POSTGRES_MODE: false,
    crypto,
    projectScope: require('../lib/project-scope'),
    generationManifest: require('../lib/generation/manifest'),
    getNativeCreationRepository: () => null,
    getNativeAppRepository: () => null,
    getDatabase: () => null,
    generationRunStore: () => ({}),
    createGenerationOrchestrator: opts => { capturedOptions = opts; return {}; },
    creationChapterContext: () => ({ characters: [], characterLibrary: [], rules: [] })
  });

  service.generationRunOrchestrator();
  assert.ok(capturedOptions?.dependenciesForRun);

  const user = { userId: 'u_challenger', email: 'c@test.local' };
  const deps = capturedOptions.dependenciesForRun({ auth: { user }, user, actorUserId: user.userId, projectId: 'p1', workspaceId: 'w1' }, {});
  assert.equal(typeof deps.qualityAudit, 'function');

  const prose = '叶凌天一剑破空，剑意滔天。天穹在剑芒下震颤不休，整座青云峰鸦雀无声。';

  // Chapter 1 -> DUAL_JUDGE
  const auditCh1 = await deps.qualityAudit({
    draft: prose,
    request: { chapterNo: 1, genre: '玄幻' },
    contract: { chapterNo: 1, goal: '破敌' },
    genre: '玄幻'
  });

  assert.equal(auditCh1.routing.route, 'DUAL_JUDGE');
  assert.equal(auditCh1.consensus, true);
  assert.equal(auditCh1.status, 'MEASURED');
  assert.ok(auditCh1.judgeA && auditCh1.judgeB);
  assert.equal(auditCh1.judgeA.judgeId, 'judge_a');
  assert.equal(auditCh1.judgeB.judgeId, 'judge_b');
  assert.notEqual(auditCh1.judgeA.modelId, auditCh1.judgeB.modelId);
});

test('Challenger M4-2 Stress 5.2: generation-service single judge escalates on borderline score', async () => {
  let capturedOptions;
  const service = createGenerationService({
    POSTGRES_MODE: false,
    crypto,
    projectScope: require('../lib/project-scope'),
    generationManifest: require('../lib/generation/manifest'),
    getNativeCreationRepository: () => null,
    getNativeAppRepository: () => null,
    getDatabase: () => null,
    generationRunStore: () => ({}),
    createGenerationOrchestrator: opts => { capturedOptions = opts; return {}; },
    creationChapterContext: () => ({ characters: [], characterLibrary: [], rules: [] })
  });
  service.generationRunOrchestrator();
  const deps = capturedOptions.dependenciesForRun({ auth: {}, user: {}, actorUserId: 'u1' }, {});

  const prose = '演武场上微风轻拂，少年握紧木剑，脚步略有凌乱。';

  // Chapter 5 with mockJudgeA score 0.72 (borderline in [0.65, 0.78])
  const escalated = await deps.qualityAudit({
    draft: prose,
    request: {
      chapterNo: 5,
      genre: '通用',
      mockJudgeA: {
        score: 0.72,
        passed: true,
        confidence: 0.90,
        qualityVector: { language: { score: 0.72, confidence: 0.90, quote: '少年握紧木剑' } }
      }
    },
    contract: { chapterNo: 5 }
  });

  assert.equal(escalated.routing.route, 'SINGLE_JUDGE');
  assert.equal(escalated.routing.escalated, true);
  assert.equal(escalated.routing.escalationReason, 'BORDERLINE_SCORE');
  assert.ok(escalated.judgeA && escalated.judgeB, 'Escalation must execute Judge B');
  assert.equal(escalated.consensus, true);
});

test('Challenger M4-2 Stress 5.3: Discrepancy from qualityAudit propagates to QualityGate needs_human', async () => {
  let capturedOptions;
  const service = createGenerationService({
    POSTGRES_MODE: false,
    crypto,
    projectScope: require('../lib/project-scope'),
    generationManifest: require('../lib/generation/manifest'),
    getNativeCreationRepository: () => null,
    getNativeAppRepository: () => null,
    getDatabase: () => null,
    generationRunStore: () => ({}),
    createGenerationOrchestrator: opts => { capturedOptions = opts; return {}; },
    creationChapterContext: () => ({ characters: [], characterLibrary: [], rules: [] })
  });
  service.generationRunOrchestrator();
  const deps = capturedOptions.dependenciesForRun({ auth: {}, user: {}, actorUserId: 'u1' }, {});

  const prose = '演武场四周古树参天，狂风呼啸而过。叶凌天长剑出鞘，剑鸣声清越如龙吟。石砖在狂暴的剑气激荡下寸寸龟裂。';

  // Discrepant judges: 0.90 vs 0.55 (delta 0.35)
  const auditResult = await deps.qualityAudit({
    draft: prose,
    request: {
      chapterNo: 1,
      genre: '通用',
      mockJudgeA: { score: 0.90, passed: true, qualityVector: { language: { score: 0.90, quote: '剑鸣声清越如龙吟' } } },
      mockJudgeB: { score: 0.55, passed: true, qualityVector: { language: { score: 0.55, quote: '剑鸣声清越如龙吟' } } }
    },
    contract: { chapterNo: 1 }
  });

  assert.equal(auditResult.consensus, false);
  assert.equal(auditResult.code, 'DUAL_JUDGE_DISCREPANCY');

  const gateResult = evaluateQualityGate({
    draft: prose,
    quality: auditResult,
    genre: '通用'
  });

  assert.equal(gateResult.passed, false);
  assert.equal(gateResult.status, 'needs_human');
  assert.equal(gateResult.code, 'DUAL_JUDGE_DISCREPANCY');
});
