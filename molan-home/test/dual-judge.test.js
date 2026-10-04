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

test('P1 Quality - Dual Judge flags discrepancy when score delta > 0.18', () => {
  const judgeA = {
    passed: true,
    score: 0.85,
    qualityVector: {
      language: { score: 0.88, source: 'judge_a', evidence: '描写生动细腻' },
      character: { score: 0.82, source: 'judge_a', evidence: '主角行动明确' }
    }
  };

  const judgeB = {
    passed: true,
    score: 0.60, // 0.85 - 0.60 = 0.25 > 0.18
    qualityVector: {
      language: { score: 0.62, source: 'judge_b', evidence: '有部分空洞形容词' },
      character: { score: 0.58, source: 'judge_b', evidence: '配角动机不足' }
    }
  };

  const result = evaluateDualJudgeConsensus(judgeA, judgeB);
  assert.equal(result.consensus, false);
  assert.equal(result.passed, false);
  assert.equal(result.status, 'needs_human');
  assert.equal(result.code, 'DUAL_JUDGE_DISCREPANCY');
  assert.ok(result.maxDelta > MAX_ALLOWED_DISCREPANCY_DELTA);
  assert.ok(result.discrepancies.length >= 1);
});

test('P1 Quality - Dual Judge flags discrepancy when pass/fail conclusions conflict', () => {
  const judgeA = {
    passed: true,
    score: 0.72,
    qualityVector: { language: { score: 0.72, source: 'judge_a' } }
  };

  const judgeB = {
    passed: false,
    score: 0.68, // delta = 0.04 <= 0.18, 但结论冲突
    qualityVector: { language: { score: 0.68, source: 'judge_b' } }
  };

  const result = evaluateDualJudgeConsensus(judgeA, judgeB);
  assert.equal(result.consensus, false);
  assert.equal(result.passed, false);
  assert.equal(result.code, 'DUAL_JUDGE_DISCREPANCY');
  assert.ok(result.discrepancies.some(d => d.dimension === 'pass_fail_consensus'));
});

test('P1 Quality - Dual Judge merges consensus when evaluations align within tolerance', () => {
  const judgeA = {
    passed: true,
    score: 0.80,
    qualityVector: {
      language: { score: 0.82, source: 'judge_a', evidence: '文笔流畅' },
      character: { score: 0.78, source: 'judge_a', evidence: '人设鲜明' }
    }
  };

  const judgeB = {
    passed: true,
    score: 0.75, // delta = 0.05 <= 0.18
    qualityVector: {
      language: { score: 0.76, source: 'judge_b', evidence: '节奏紧凑' },
      character: { score: 0.74, source: 'judge_b', evidence: '对话生动' }
    }
  };

  const result = evaluateDualJudgeConsensus(judgeA, judgeB);
  assert.equal(result.consensus, true);
  assert.equal(result.passed, true);
  assert.equal(result.status, 'MEASURED');
  assert.equal(result.score, 0.775); // (0.80 + 0.75) / 2
  assert.equal(result.qualityVector.language.score, 0.79);
  assert.equal(result.qualityVector.character.score, 0.76);
  assert.equal(result.discrepancies.length, 0);
});

test('P1 Quality - Quality Gate integration with Dual Judge', () => {
  const draft = '演武场四周古树参天，狂风呼啸而过。叶凌天长剑出鞘，剑鸣声清越如龙吟。石砖在狂暴的剑气激荡下寸寸龟裂。';
  const hash = crypto.createHash('sha256').update(draft, 'utf8').digest('hex');

  // 1. 双评委发生分歧时的门禁阻断
  const conflictingQuality = {
    judgeA: { passed: true, score: 0.90, qualityVector: { language: { score: 0.90, source: 'model_a' } } },
    judgeB: { passed: false, score: 0.50, qualityVector: { language: { score: 0.50, source: 'model_b' } } },
    contentDigest: hash
  };

  const gateResultConflicting = evaluateQualityGate({
    draft,
    quality: conflictingQuality,
    contentDigest: hash
  });
  assert.equal(gateResultConflicting.passed, false);
  assert.equal(gateResultConflicting.status, 'needs_human');
  assert.equal(gateResultConflicting.code, 'DUAL_JUDGE_DISCREPANCY');

  // 2. 双评委达成共识时的门禁通过
  const consensusQuality = {
    judgeA: { passed: true, score: 0.85, qualityVector: { language: { score: 0.85, source: 'model_a', evidence: '剑气激荡下寸寸龟裂' } } },
    judgeB: { passed: true, score: 0.80, qualityVector: { language: { score: 0.80, source: 'model_b', evidence: '长剑出鞘，剑鸣声清越如龙吟' } } },
    contentDigest: hash
  };

  const gateResultConsensus = evaluateQualityGate({
    draft,
    quality: consensusQuality,
    contentDigest: hash
  });
  assert.equal(gateResultConsensus.passed, true);
  assert.equal(gateResultConsensus.quality.status, 'MEASURED');
  assert.ok(gateResultConsensus.quality.dualJudge.consensus);
});

test('R3 P0-02 - Independent evaluation metadata recorded for Judge A and Judge B', () => {
  const recordA = createJudgeEvaluationRecord({
    judgeId: 'judge_a',
    evaluatorId: 'literary_evaluator_a',
    modelId: 'gpt-4o',
    promptVersion: 'judge_prompt_v2.1',
    score: 0.85,
    passed: true,
    qualityVector: { language: { score: 0.85, status: 'MEASURED' } },
    inputPayload: { draft: '正文样例 A' },
    outputPayload: { score: 0.85, passed: true }
  }, 'judge_a');

  const recordB = createJudgeEvaluationRecord({
    judgeId: 'judge_b',
    evaluatorId: 'literary_evaluator_b',
    modelId: 'deepseek-reasoner',
    promptVersion: 'judge_prompt_v2.1',
    score: 0.82,
    passed: true,
    qualityVector: { language: { score: 0.82, status: 'MEASURED' } },
    inputPayload: { draft: '正文样例 B' },
    outputPayload: { score: 0.82, passed: true }
  }, 'judge_b');

  // 1. 验证 Judge A 与 Judge B 独立属性完整且互不混淆
  assert.equal(recordA.judgeId, 'judge_a');
  assert.equal(recordA.evaluatorId, 'literary_evaluator_a');
  assert.equal(recordA.modelId, 'gpt-4o');
  assert.equal(recordA.promptVersion, 'judge_prompt_v2.1');
  assert.ok(recordA.inputHash && recordA.inputHash.length === 64);
  assert.ok(recordA.outputHash && recordA.outputHash.length === 64);

  assert.equal(recordB.judgeId, 'judge_b');
  assert.equal(recordB.evaluatorId, 'literary_evaluator_b');
  assert.equal(recordB.modelId, 'deepseek-reasoner');
  assert.equal(recordB.promptVersion, 'judge_prompt_v2.1');
  assert.ok(recordB.inputHash && recordB.inputHash.length === 64);
  assert.ok(recordB.outputHash && recordB.outputHash.length === 64);

  // 2. 验证评委独立性：judgeId, evaluatorId, modelId, outputHash 必须相异
  assert.notEqual(recordA.judgeId, recordB.judgeId);
  assert.notEqual(recordA.evaluatorId, recordB.evaluatorId);
  assert.notEqual(recordA.modelId, recordB.modelId);
  assert.notEqual(recordA.outputHash, recordB.outputHash);

  // 3. 共识运算后在返回记录中完整保留双评委独立元数据
  const consensus = evaluateDualJudgeConsensus(recordA, recordB);
  assert.equal(consensus.consensus, true);
  assert.equal(consensus.status, 'MEASURED');
  assert.equal(consensus.source, 'dual_judge_consensus');
  assert.equal(consensus.judgeA.judgeId, 'judge_a');
  assert.equal(consensus.judgeA.evaluatorId, 'literary_evaluator_a');
  assert.equal(consensus.judgeA.modelId, 'gpt-4o');
  assert.equal(consensus.judgeA.inputHash, recordA.inputHash);
  assert.equal(consensus.judgeA.outputHash, recordA.outputHash);
  assert.equal(consensus.judgeB.judgeId, 'judge_b');
  assert.equal(consensus.judgeB.evaluatorId, 'literary_evaluator_b');
  assert.equal(consensus.judgeB.modelId, 'deepseek-reasoner');
  assert.equal(consensus.judgeB.inputHash, recordB.inputHash);
  assert.equal(consensus.judgeB.outputHash, recordB.outputHash);
});

test('R3 P0-03 - Selective Routing: Golden chapters (1-3) route to DUAL_JUDGE', () => {
  // 第 1、2、3 章强制双评委
  for (const ch of [1, 2, 3]) {
    const routeByNumber = resolveEvaluationRoute({ chapterNo: ch });
    assert.deepEqual(routeByNumber, { route: 'DUAL_JUDGE', reason: 'GOLDEN_CHAPTER' });

    const routeByContract = resolveEvaluationRoute({ contract: { chapterNo: ch } });
    assert.deepEqual(routeByContract, { route: 'DUAL_JUDGE', reason: 'GOLDEN_CHAPTER' });

    const routeByRequest = resolveEvaluationRoute({ request: { chapterNo: ch } });
    assert.deepEqual(routeByRequest, { route: 'DUAL_JUDGE', reason: 'GOLDEN_CHAPTER' });
  }

  // 黄金三章功能标签
  const routeByFunc = resolveEvaluationRoute({
    contract: { chapterFunction: 'golden_ch1_hook' }
  });
  assert.deepEqual(routeByFunc, { route: 'DUAL_JUDGE', reason: 'GOLDEN_CHAPTER' });
});

test('R3 P0-03 - Selective Routing: Volume climaxes, turning points, and explicit overrides route to DUAL_JUDGE', () => {
  // 分卷高潮 (Volume Climax)
  const routeClimax1 = resolveEvaluationRoute({
    chapterNo: 15,
    contract: { isVolumeClimax: true }
  });
  assert.deepEqual(routeClimax1, { route: 'DUAL_JUDGE', reason: 'VOLUME_CLIMAX' });

  const routeClimax2 = resolveEvaluationRoute({
    chapterNo: 20,
    contract: { chapterType: 'volume_climax' }
  });
  assert.deepEqual(routeClimax2, { route: 'DUAL_JUDGE', reason: 'VOLUME_CLIMAX' });

  const routeClimax3 = resolveEvaluationRoute({
    chapterNo: 25,
    request: { isVolumeClimax: true }
  });
  assert.deepEqual(routeClimax3, { route: 'DUAL_JUDGE', reason: 'VOLUME_CLIMAX' });

  // 重大转折点 (Major Turning Point)
  const routeTurn1 = resolveEvaluationRoute({
    chapterNo: 8,
    contract: { isMajorTurningPoint: true }
  });
  assert.deepEqual(routeTurn1, { route: 'DUAL_JUDGE', reason: 'MAJOR_TURNING_POINT' });

  const routeTurn2 = resolveEvaluationRoute({
    chapterNo: 12,
    contract: { chapterType: 'major_turning_point' }
  });
  assert.deepEqual(routeTurn2, { route: 'DUAL_JUDGE', reason: 'MAJOR_TURNING_POINT' });

  const routeTurn3 = resolveEvaluationRoute({
    chapterNo: 18,
    request: { isMajorTurningPoint: true }
  });
  assert.deepEqual(routeTurn3, { route: 'DUAL_JUDGE', reason: 'MAJOR_TURNING_POINT' });

  // 显式强制覆盖 (Explicit Override) - 即使是第 4 章或无特殊标签
  const routeOverride1 = resolveEvaluationRoute({
    chapterNo: 4,
    request: { forceDualJudge: true }
  });
  assert.deepEqual(routeOverride1, { route: 'DUAL_JUDGE', reason: 'EXPLICIT_OVERRIDE' });

  const routeOverride2 = resolveEvaluationRoute({
    chapterNo: 10,
    options: { forceDualJudge: true }
  });
  assert.deepEqual(routeOverride2, { route: 'DUAL_JUDGE', reason: 'EXPLICIT_OVERRIDE' });

  // 显式强制覆盖优先于黄金三章标签
  const routeOverridePriority = resolveEvaluationRoute({
    chapterNo: 1,
    request: { forceDualJudge: true }
  });
  assert.deepEqual(routeOverridePriority, { route: 'DUAL_JUDGE', reason: 'EXPLICIT_OVERRIDE' });
});

test('R3 P0-03 - Selective Routing: Normal chapters route to SINGLE_JUDGE', () => {
  // 第 4 章及后续普通章节路由至单评委
  for (const ch of [4, 5, 10, 50, 100]) {
    const route = resolveEvaluationRoute({ chapterNo: ch });
    assert.deepEqual(route, { route: 'SINGLE_JUDGE', reason: 'NORMAL_CHAPTER' });
  }
});

test('R3 P0-03 - Dynamic Escalation: Borderline score [0.65, 0.78] escalates to DUAL_JUDGE', () => {
  // 综合分处于 [0.65, 0.78] 临界区间触发升阶
  for (const score of [0.65, 0.70, 0.72, 0.75, 0.78]) {
    const escalation = shouldEscalateToDualJudge({
      score,
      confidence: 0.90,
      qualityVector: { language: { score, confidence: 0.90 } }
    });
    assert.equal(escalation.escalate, true);
    assert.equal(escalation.reason, 'BORDERLINE_SCORE');
  }

  // 低于 0.65 (明确不及格) 或 高于 0.78 (稳健通过) 不因综合分升阶
  const lowPass = shouldEscalateToDualJudge({
    score: 0.60,
    passed: false,
    confidence: 0.90,
    qualityVector: { language: { score: 0.60, confidence: 0.90 } }
  });
  assert.equal(lowPass.escalate, false);

  const highPass = shouldEscalateToDualJudge({
    score: 0.82,
    passed: true,
    confidence: 0.90,
    qualityVector: { language: { score: 0.82, confidence: 0.90 } }
  });
  assert.equal(highPass.escalate, false);
});

test('R3 P0-03 - Dynamic Escalation: Low confidence (<0.85 overall or <0.80 dimension) escalates to DUAL_JUDGE', () => {
  // 整体置信度 < 0.85
  const overallLowConf = shouldEscalateToDualJudge({
    score: 0.85,
    confidence: 0.82, // < 0.85
    qualityVector: { language: { score: 0.85, confidence: 0.90 } }
  });
  assert.equal(overallLowConf.escalate, true);
  assert.equal(overallLowConf.reason, 'LOW_CONFIDENCE');

  // 关键维度置信度 < 0.80
  const dimLowConf = shouldEscalateToDualJudge({
    score: 0.85,
    confidence: 0.90,
    qualityVector: {
      language: { score: 0.85, confidence: 0.78 }, // < 0.80
      character: { score: 0.82, confidence: 0.90 }
    }
  });
  assert.equal(dimLowConf.escalate, true);
  assert.equal(dimLowConf.reason, 'LOW_CONFIDENCE');
});

test('R3 P0-03 - Dynamic Escalation: Borderline dimension score [0.70, 0.75] escalates to DUAL_JUDGE', () => {
  // 整体分高于 0.78 (如 0.82)，且置信度高，但任一维度处于 [0.70, 0.75]
  const borderlineDim = shouldEscalateToDualJudge({
    score: 0.82,
    confidence: 0.90,
    qualityVector: {
      language: { score: 0.88, confidence: 0.90 },
      character: { score: 0.72, confidence: 0.90 } // 处于 [0.70, 0.75]
    }
  });
  assert.equal(borderlineDim.escalate, true);
  assert.equal(borderlineDim.reason, 'BORDERLINE_DIMENSION');
});

test('R3 P0-02/P0-03 - Score discrepancy (>0.18 delta) and pass/fail conflicts block with DUAL_JUDGE_DISCREPANCY', () => {
  // 1. 维度分歧 > 0.18
  const dimDiscrepancy = evaluateDualJudgeConsensus(
    {
      score: 0.80,
      passed: true,
      qualityVector: { language: { score: 0.90 } }
    },
    {
      score: 0.80,
      passed: true,
      qualityVector: { language: { score: 0.70 } } // |0.90 - 0.70| = 0.20 > 0.18
    }
  );
  assert.equal(dimDiscrepancy.consensus, false);
  assert.equal(dimDiscrepancy.passed, false);
  assert.equal(dimDiscrepancy.code, 'DUAL_JUDGE_DISCREPANCY');
  assert.equal(dimDiscrepancy.status, 'needs_human');
  assert.ok(dimDiscrepancy.discrepancies.some(d => d.dimension === 'language'));

  // 2. 综合分分歧 > 0.18
  const overallDiscrepancy = evaluateDualJudgeConsensus(
    { score: 0.85, passed: true },
    { score: 0.65, passed: true } // |0.85 - 0.65| = 0.20 > 0.18
  );
  assert.equal(overallDiscrepancy.consensus, false);
  assert.equal(overallDiscrepancy.code, 'DUAL_JUDGE_DISCREPANCY');
  assert.equal(overallDiscrepancy.status, 'needs_human');

  // 3. 结论冲突 (一过一挂)
  const conclusionConflict = evaluateDualJudgeConsensus(
    { score: 0.72, passed: true },
    { score: 0.70, passed: false } // delta = 0.02 <= 0.18, 但 passed 状态矛盾
  );
  assert.equal(conclusionConflict.consensus, false);
  assert.equal(conclusionConflict.code, 'DUAL_JUDGE_DISCREPANCY');
  assert.equal(conclusionConflict.status, 'needs_human');
});

test('R3 P0-02/P0-03 - Consensus merging within tolerance preserves verified quotes and records status MEASURED', () => {
  const judgeA = {
    judgeId: 'judge_a',
    evaluatorId: 'evaluator_a',
    modelId: 'model-a',
    score: 0.84,
    passed: true,
    confidence: 0.90,
    qualityVector: {
      language: {
        score: 0.86,
        confidence: 0.92,
        quote: '剑鸣声清越如龙吟',
        evidence: '剑鸣声清越如龙吟'
      }
    }
  };

  const judgeB = {
    judgeId: 'judge_b',
    evaluatorId: 'evaluator_b',
    modelId: 'model-b',
    score: 0.80,
    passed: true,
    confidence: 0.88,
    qualityVector: {
      language: {
        score: 0.82,
        confidence: 0.86,
        quote: '石砖在狂暴的剑气激荡下寸寸龟裂',
        evidence: '石砖在狂暴的剑气激荡下寸寸龟裂'
      }
    }
  };

  const result = evaluateDualJudgeConsensus(judgeA, judgeB);
  assert.equal(result.consensus, true);
  assert.equal(result.passed, true);
  assert.equal(result.status, 'MEASURED');
  assert.equal(result.source, 'dual_judge_consensus');
  assert.equal(result.score, 0.82); // (0.84 + 0.80) / 2
  assert.equal(result.confidence, 0.89); // (0.90 + 0.88) / 2
  assert.equal(result.qualityVector.language.score, 0.84); // (0.86 + 0.82) / 2
  assert.equal(result.qualityVector.language.confidence, 0.89); // (0.92 + 0.86) / 2
  assert.equal(result.qualityVector.language.source, 'dual_judge_consensus');
  assert.equal(result.qualityVector.language.status, 'MEASURED');
  assert.ok(result.qualityVector.language.quote);
  assert.equal(result.judgeA.judgeId, 'judge_a');
  assert.equal(result.judgeB.judgeId, 'judge_b');
});

test('R3 Production Wiring - generation-service.dependenciesForRun actively integrates Dual Judge qualityAudit', async () => {
  const { createGenerationService } = require('../services/generation-service');
  let capturedOptions;
  const dummyService = createGenerationService({
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
  dummyService.generationRunOrchestrator();

  assert.ok(capturedOptions && typeof capturedOptions.dependenciesForRun === 'function', 'dependenciesForRun 必须已配置');
  const user = { userId: 'u_dual_judge', email: 'user@test.local' };
  const deps = capturedOptions.dependenciesForRun({ auth: { user }, user, actorUserId: user.userId, projectId: 'p_test', workspaceId: 'w_test' }, {});
  assert.ok(typeof deps.qualityAudit === 'function', 'qualityAudit 必须作为依赖提供给 orchestrator');

  const prose = '演武场四周古树参天，狂风呼啸而过。叶凌天长剑出鞘，剑鸣声清越如龙吟。石砖在狂暴的剑气激荡下寸寸龟裂。';

  // 1. 黄金前三章 (第 1 章)：必须执行双评委，产出完整共识及双评委元数据
  const goldenAudit = await deps.qualityAudit({
    draft: prose,
    request: { chapterNo: 1, genre: '通用' },
    contract: { chapterNo: 1, chapterGoal: '立威' },
    genre: '通用'
  });
  assert.equal(goldenAudit.routing.route, 'DUAL_JUDGE');
  assert.equal(goldenAudit.routing.reason, 'GOLDEN_CHAPTER');
  assert.equal(goldenAudit.consensus, true);
  assert.equal(goldenAudit.status, 'MEASURED');
  assert.equal(goldenAudit.source, 'dual_judge_consensus');
  assert.ok(goldenAudit.judgeA && goldenAudit.judgeA.judgeId === 'judge_a');
  assert.ok(goldenAudit.judgeB && goldenAudit.judgeB.judgeId === 'judge_b');
  assert.notEqual(goldenAudit.judgeA.outputHash, goldenAudit.judgeB.outputHash);

  // 2. 普通章节 (第 5 章) 默认路由至单评委且高置信度不升阶
  const normalAudit = await deps.qualityAudit({
    draft: prose,
    request: { chapterNo: 5, genre: '通用' },
    contract: { chapterNo: 5, chapterGoal: '日常推进' },
    genre: '通用'
  });
  assert.equal(normalAudit.routing.route, 'SINGLE_JUDGE');
  assert.equal(normalAudit.routing.reason, 'NORMAL_CHAPTER');
  assert.equal(normalAudit.status, 'MEASURED');
  assert.ok(normalAudit.judgeA && normalAudit.judgeA.judgeId === 'judge_a');
  assert.equal(normalAudit.judgeB, undefined); // 单评委不产生 judgeB

  // 3. 普通章节临界分动态升级至双评委
  const escalatedAudit = await deps.qualityAudit({
    draft: prose,
    request: {
      chapterNo: 5,
      genre: '通用',
      mockJudgeA: {
        score: 0.72,
        passed: true,
        confidence: 0.90,
        qualityVector: { language: { score: 0.72, confidence: 0.90, quote: '剑鸣声清越如龙吟' } }
      }
    },
    contract: { chapterNo: 5 },
    genre: '通用'
  });
  assert.equal(escalatedAudit.routing.route, 'SINGLE_JUDGE');
  assert.equal(escalatedAudit.routing.escalated, true);
  assert.equal(escalatedAudit.routing.escalationReason, 'BORDERLINE_SCORE');
  assert.ok(escalatedAudit.judgeA && escalatedAudit.judgeB);
  assert.equal(escalatedAudit.consensus, true);

  // 4. 双评委分歧或一过一挂在 qualityGate 中正确触发阻断
  const conflictingAudit = await deps.qualityAudit({
    draft: prose,
    request: {
      chapterNo: 1,
      genre: '通用',
      mockJudgeA: { score: 0.90, passed: true, qualityVector: { language: { score: 0.90, quote: '长剑出鞘' } } },
      mockJudgeB: { score: 0.50, passed: false, qualityVector: { language: { score: 0.50, quote: '长剑出鞘' } } }
    },
    contract: { chapterNo: 1 },
    genre: '通用'
  });
  assert.equal(conflictingAudit.consensus, false);
  assert.equal(conflictingAudit.code, 'DUAL_JUDGE_DISCREPANCY');

  const gateResult = evaluateQualityGate({
    draft: prose,
    quality: conflictingAudit,
    genre: '通用'
  });
  assert.equal(gateResult.passed, false);
  assert.equal(gateResult.status, 'needs_human');
  assert.equal(gateResult.code, 'DUAL_JUDGE_DISCREPANCY');
});

// ---------------------------------------------------------------------------
// Milestone 4 Remediation Tests
// ---------------------------------------------------------------------------

test('Remediation: Defensive null parameter handling in resolveEvaluationRoute, escalation, and consensus', () => {
  // 1. resolveEvaluationRoute with null inputs
  assert.doesNotThrow(() => resolveEvaluationRoute(null));
  assert.equal(resolveEvaluationRoute(null).route, 'SINGLE_JUDGE');

  assert.doesNotThrow(() => resolveEvaluationRoute({ request: null }));
  assert.doesNotThrow(() => resolveEvaluationRoute({ contract: null }));
  assert.doesNotThrow(() => resolveEvaluationRoute({ options: null }));
  assert.doesNotThrow(() => resolveEvaluationRoute({ request: null, contract: null, options: null }));
  assert.equal(resolveEvaluationRoute({ request: null, contract: null, options: null, chapterNo: 1 }).route, 'DUAL_JUDGE');

  // 2. shouldEscalateToDualJudge with null inputs
  assert.doesNotThrow(() => shouldEscalateToDualJudge(null));
  assert.equal(shouldEscalateToDualJudge(null).escalate, false);
  assert.doesNotThrow(() => shouldEscalateToDualJudge({ score: 0.82, confidence: 0.90 }, null));
  assert.equal(shouldEscalateToDualJudge({ score: 0.82, confidence: 0.90 }, null).escalate, false);

  // 3. evaluateDualJudgeConsensus with null inputs
  assert.doesNotThrow(() => evaluateDualJudgeConsensus(null, null));
  assert.equal(evaluateDualJudgeConsensus(null, null).consensus, false);
  assert.equal(evaluateDualJudgeConsensus(null, null).code, 'DUAL_JUDGE_DISCREPANCY');

  const validJudge = { score: 0.80, passed: true };
  assert.doesNotThrow(() => evaluateDualJudgeConsensus(validJudge, null));
  assert.equal(evaluateDualJudgeConsensus(validJudge, null).consensus, false);
  assert.doesNotThrow(() => evaluateDualJudgeConsensus(null, validJudge));
  assert.equal(evaluateDualJudgeConsensus(null, validJudge).consensus, false);

  assert.doesNotThrow(() => evaluateDualJudgeConsensus(validJudge, validJudge, null));
  assert.equal(evaluateDualJudgeConsensus(validJudge, validJudge, null).consensus, true);
});

test('Remediation: Fail-closed discipline when model judge throws exception (Zero Self-Certification)', async () => {
  const { createGenerationService } = require('../services/generation-service');
  let capturedOptions;
  const mockCallMolanChat = async () => {
    throw new Error('LLM Gateway 502 Bad Gateway / Network Timeout');
  };
  const dummyService = createGenerationService({
    POSTGRES_MODE: false,
    crypto,
    projectScope: require('../lib/project-scope'),
    generationManifest: require('../lib/generation/manifest'),
    generationProviderRequestId: (runId, stage, slot, attempt) => `${runId}_${stage}_${slot}_${attempt}`,
    getNativeCreationRepository: () => null,
    getNativeAppRepository: () => null,
    getDatabase: () => null,
    callMolanChat: mockCallMolanChat,
    generationRunStore: () => ({}),
    createGenerationOrchestrator: opts => { capturedOptions = opts; return {}; },
    creationChapterContext: () => ({ characters: [], characterLibrary: [], rules: [] })
  });
  dummyService.generationRunOrchestrator();

  const user = { userId: 'u_fail_test', email: 'fail@test.local' };
  const deps = capturedOptions.dependenciesForRun({
    auth: { user, authorization: 'Bearer test' },
    user,
    actorUserId: user.userId,
    projectId: 'p_test',
    workspaceId: 'w_test',
    authorization: 'Bearer test'
  }, {});

  const prose = '演武场四周古树参天，狂风呼啸而过。叶凌天长剑出鞘，剑鸣声清越如龙吟。';

  // 启用模型评委调用，并在异常时严格 Fail-Closed
  const auditResult = await deps.qualityAudit({
    draft: prose,
    request: { chapterNo: 1, genre: '通用', enableQualityJudge: true },
    contract: { chapterNo: 1, chapterGoal: '立威' },
    genre: '通用'
  });

  assert.equal(auditResult.passed, false, 'Failed model call must NEVER pass');
  assert.equal(auditResult.status, 'EVALUATION_FAILED', 'Status must be EVALUATION_FAILED');
  assert.equal(auditResult.code, 'EVALUATION_FAILED', 'Code must be EVALUATION_FAILED');
  assert.ok(auditResult.error, 'Must include structured error');
  assert.ok(auditResult.error.message.includes('502 Bad Gateway'));
  assert.notEqual(auditResult.score, 0.86, 'Must NOT synthesize 0.86 score');
  assert.notEqual(auditResult.score, 0.84, 'Must NOT synthesize 0.84 score');
});

test('Remediation: Fail-closed discipline when model judge returns invalid non-JSON output', async () => {
  const { createGenerationService } = require('../services/generation-service');
  let capturedOptions;
  const mockCallMolanChat = async () => {
    return { text: 'Sorry I cannot output JSON', json: null };
  };
  const dummyService = createGenerationService({
    POSTGRES_MODE: false,
    crypto,
    projectScope: require('../lib/project-scope'),
    generationManifest: require('../lib/generation/manifest'),
    generationProviderRequestId: (runId, stage, slot, attempt) => `${runId}_${stage}_${slot}_${attempt}`,
    getNativeCreationRepository: () => null,
    getNativeAppRepository: () => null,
    getDatabase: () => null,
    callMolanChat: mockCallMolanChat,
    generationRunStore: () => ({}),
    createGenerationOrchestrator: opts => { capturedOptions = opts; return {}; },
    creationChapterContext: () => ({ characters: [], characterLibrary: [], rules: [] })
  });
  dummyService.generationRunOrchestrator();

  const user = { userId: 'u_invalid_json', email: 'invalid@test.local' };
  const deps = capturedOptions.dependenciesForRun({
    auth: { user, authorization: 'Bearer test' },
    user,
    actorUserId: user.userId,
    projectId: 'p_test',
    workspaceId: 'w_test',
    authorization: 'Bearer test'
  }, {});

  const prose = '演武场四周古树参天，狂风呼啸而过。叶凌天长剑出鞘，剑鸣声清越如龙吟。';

  const auditResult = await deps.qualityAudit({
    draft: prose,
    request: { chapterNo: 1, genre: '通用', enableQualityJudge: true },
    contract: { chapterNo: 1 },
    genre: '通用'
  });

  assert.equal(auditResult.passed, false);
  assert.equal(auditResult.status, 'EVALUATION_FAILED');
  assert.equal(auditResult.code, 'EVALUATION_FAILED');
});

test('Remediation: Floating point precision boundary delta = 0.18 (IEEE 754 rounding)', () => {
  // scoreA = 0.88, scoreB = 0.70 -> mathematical delta is exactly 0.18
  // 0.88 - 0.70 in JS IEEE 754 is 0.18000000000000005
  // Must NOT trigger discrepancy
  const boundaryRes = evaluateDualJudgeConsensus(
    { score: 0.88, passed: true, qualityVector: { language: { score: 0.88, source: 'judge_a' } } },
    { score: 0.70, passed: true, qualityVector: { language: { score: 0.70, source: 'judge_b' } } }
  );
  assert.equal(boundaryRes.consensus, true, 'Delta 0.18 exactly must be within tolerance');
  assert.equal(boundaryRes.passed, true);
  assert.equal(boundaryRes.discrepancies.length, 0);

  // Exceeding 0.18: scoreA = 0.881, scoreB = 0.70 -> delta = 0.181 > 0.18
  const exceedRes = evaluateDualJudgeConsensus(
    { score: 0.881, passed: true, qualityVector: { language: { score: 0.881, source: 'judge_a' } } },
    { score: 0.70, passed: true, qualityVector: { language: { score: 0.70, source: 'judge_b' } } }
  );
  assert.equal(exceedRes.consensus, false, 'Delta 0.181 must trigger discrepancy');
  assert.equal(exceedRes.code, 'DUAL_JUDGE_DISCREPANCY');
});

test('Remediation: Explicit DUAL_JUDGE_REJECTED code when both judges fail within tolerance', () => {
  const bothFail = evaluateDualJudgeConsensus(
    { score: 0.55, passed: false, qualityVector: { language: { score: 0.55, source: 'judge_a' } } },
    { score: 0.52, passed: false, qualityVector: { language: { score: 0.52, source: 'judge_b' } } }
  );
  assert.equal(bothFail.consensus, true, 'Both agree on rejection -> consensus is true');
  assert.equal(bothFail.passed, false, 'Outcome is failed');
  assert.equal(bothFail.code, 'DUAL_JUDGE_REJECTED', 'Must set DUAL_JUDGE_REJECTED code');
  assert.equal(bothFail.status, 'needs_human');

  // Also check QualityGate output code
  const prose = '演武场四周古树参天，狂风呼啸而过。叶凌天长剑出鞘，剑鸣声清越如龙吟。';
  const gateRes = evaluateQualityGate({
    draft: prose,
    quality: {
      judgeA: { score: 0.55, passed: false },
      judgeB: { score: 0.52, passed: false }
    },
    genre: '通用'
  });
  assert.equal(gateRes.passed, false);
  assert.equal(gateRes.status, 'needs_human');
  assert.equal(gateRes.code, 'DUAL_JUDGE_REJECTED', 'QualityGate must inherit DUAL_JUDGE_REJECTED code');
});

test('Remediation: Orchestrator quality_audit falls back to runDependencies.qualityAudit when pipeline lacks quality scores', async testContext => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { createJsonGenerationStore } = require('../lib/generation/json-store');
  const { JsonFileRepository } = require('../lib/repositories/json-file-repository');
  const { createGenerationOrchestrator } = require('../lib/generation/orchestrator');

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-fallback-test-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-fallback', projectId: 'project-fallback', actorUserId: 'author-fallback' };
  const request = {
    projectId: scope.projectId,
    chapterId: 'chapter_1',
    chapterNo: 1,
    genre: '通用',
    style: '简洁',
    chapterContract: { chapterId: 'chapter_1', chapterNo: 1, chapterGoal: '推进事件', scenes: [{ id: 'scene_1' }] }
  };
  const created = (await store.createRun({
    ...scope,
    id: 'run-fallback-test',
    chapterId: request.chapterId,
    idempotencyKey: 'key-fallback',
    requestHash: 'a'.repeat(64),
    request
  })).run;

  const { buildGenerationManifest, hashValue } = require('../lib/generation/manifest');
  const { contractHash } = require('../lib/generation/contract');

  let qualityAuditCalled = false;
  const orchestrator = createGenerationOrchestrator({
    store,
    db: repository,
    dependencies: {
      resolveGenre: async () => ({ status: 'resolved', genre: '通用' }),
      resolveStyle: async () => ({ status: 'resolved', style: '简洁' }),
      loadAuthoritativeContext: async () => ({
        ok: true,
        storyContext: {},
        snapshotHash: 's-1',
        contextPlan: {
          contextHash: 'c-1',
          budgetResolution: { targetWords: 3000, bounds: { min: 2500, max: 3500 } }
        }
      }),
      preGenerationGuard: async () => ({ passed: true, snapshotHash: 's-1' }),
      planScenes: async () => [{ id: 'scene_1', goal: '推进事件' }],
      writer: async ({ request: runRequest, contract, context: ctxText, contextPlan, genre: runGenre, style: runStyle, scenes, scenePlan }) => {
        const promptInput = { request: runRequest, contract, context: ctxText, contextPlan, genre: runGenre, style: runStyle, scenes, scenePlan };
        const text = '演武场四周古树参天，狂风呼啸而过。叶凌天长剑出鞘，剑鸣声清越如龙吟。石砖在狂暴的剑气激荡下寸寸龟裂。';
        return {
          text,
          pipeline: {
            authoritative: true,
            status: 'passed',
            audit: { passed: true, issues: [] },
            deterministicAudit: { passed: true, issues: [], blockerCount: 0, unverifiedCount: 0 },
            semanticAudit: { passed: true, audit: { passed: true, issues: [] } },
            manifest: buildGenerationManifest({
              generationId: created.id,
              projectId: scope.projectId,
              chapterId: request.chapterId,
              pipelineVersion: 'generation-v2.1',
              contextHash: contextPlan.contextHash,
              contractHash: contractHash(contract),
              promptHash: hashValue(promptInput),
              outputHash: hashValue(text)
            })
            // Intentionally omit quality and qualityVector so orchestrator falls back to runDependencies.qualityAudit
          }
        };
      },
      screen: async () => ({ passed: true }),
      deterministicAudit: async () => ({ passed: true, issues: [] }),
      semanticAudit: async () => ({ passed: true, issues: [], status: 'MEASURED' }),
      qualityAudit: async () => {
        qualityAuditCalled = true;
        return {
          passed: true,
          status: 'MEASURED',
          score: 0.85,
          confidence: 0.90,
          source: 'dual_judge_consensus',
          qualityVector: {
            language: {
              score: 0.85,
              confidence: 0.90,
              status: 'MEASURED',
              source: 'dual_judge_consensus',
              evidence: '描写生动细腻',
              quote: '剑鸣声清越如龙吟'
            }
          }
        };
      },
      commit: async () => ({ committed: true, snapshotId: 'snap-1', stateVersion: 1, contentHash: 'h-1' })
    }
  });

  const finalRun = await orchestrator.execute(scope, created.id);
  assert.ok(qualityAuditCalled, 'runDependencies.qualityAudit must be invoked when pipeline lacks quality');
  assert.equal(finalRun.state, 'waiting_author', 'Should reach waiting_author state');
});
