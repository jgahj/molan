'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { createGenerationOrchestrator, ACTIVE_STATES } = require('../lib/generation/orchestrator');
const { createJsonGenerationStore } = require('../lib/generation/json-store');
const { JsonFileRepository } = require('../lib/repositories/json-file-repository');
const contentEngine = require('../lib/generation/content-engine');
const {
  createQualityAssessment,
  validateQualityAssessment,
  validateGenerationAuditEvidence,
  CRITICAL_QUALITY_DIMENSIONS
} = require('../lib/generation/quality-assessment');
const { evaluateQualityGate } = require('../lib/generation/quality-gate');
const {
  evaluateDualJudgeConsensus,
  createJudgeEvaluationRecord,
  resolveEvaluationRoute,
  shouldEscalateToDualJudge,
  MAX_ALLOWED_DISCREPANCY_DELTA
} = require('../lib/quality/dual-judge');
const { buildGenerationManifest, hashValue } = require('../lib/generation/manifest');
const { contractHash } = require('../lib/generation/contract');
const { GenerationError } = require('../lib/generation/errors');

function computeSha256(content) {
  return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}

/**
 * ==============================================================================
 * Test 1 (AC1): E2E Generation Loop
 * 验证端到端生成管线利用 Mock Provider，自主顺畅流转完整生命周期状态机：
 * created -> planned -> writing -> deterministic_audit -> semantic_audit -> quality_audit -> waiting_author
 * 全程 0 人工干预，最终结果与正文哈希完全自洽。
 * ==============================================================================
 */
test('Test 1 (AC1): E2E Generation Loop - autonomous progression to waiting_author with zero human intervention', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-e2e-ac1-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = {
    workspaceId: 'ws-e2e-ac1',
    projectId: 'proj-e2e-ac1',
    actorUserId: 'author-e2e-ac1'
  };
  const runId = 'run-e2e-ac1-loop';
  const chapterId = 'ch-e2e-001';

  const contract = {
    chapterId,
    chapterNo: 5,
    chapterGoal: '突入废弃科研站，查验深层反应堆异常波动',
    novelGenre: '科幻',
    writingStyle: '硬核科幻',
    pov: 'third-limited',
    viewpointCharacter: '陆沉',
    characters: ['陆沉', '林博士'],
    wordBudget: { minChars: 100, maxChars: 2000, targetChars: 300 }
  };

  const draftText = '陆沉推开厚重的手动隔离门，冰冷的合金把手上挂着一层白霜。控制室里红色的应急警报灯仍在机械地旋转闪烁，仪器仪表盘上的指针在零界点附近剧烈抖动。林博士快步走向主操作台，指尖在覆满尘埃的键盘上飞速敲击。全息投影中，重力透镜曲率正在以肉眼可见的速度发生坍缩，深层反应堆的核心封印已经出现裂痕。';
  const outputHash = hashValue(draftText);

  // 记录各关键生命周期阶段的触发计数
  const lifecycleCounters = {
    resolveGenre: 0,
    resolveStyle: 0,
    loadContext: 0,
    preGuard: 0,
    planScenes: 0,
    writer: 0,
    deterministicAudit: 0,
    semanticAudit: 0,
    qualityAudit: 0
  };

  const orchestratorDeps = {
    resolveGenre: async () => {
      lifecycleCounters.resolveGenre++;
      return { status: 'resolved', genre: '科幻' };
    },
    resolveStyle: async () => {
      lifecycleCounters.resolveStyle++;
      return { status: 'resolved', style: '硬核科幻' };
    },
    loadAuthoritativeContext: async () => {
      lifecycleCounters.loadContext++;
      return {
        ok: true,
        snapshotHash: 'snap-e2e-001',
        storyContext: {
          pov: 'third-limited',
          characters: ['陆沉', '林博士'],
          currentLocation: '极地深层科研站'
        }
      };
    },
    preGenerationGuard: async () => {
      lifecycleCounters.preGuard++;
      return { passed: true, snapshotHash: 'snap-e2e-001' };
    },
    planScenes: async () => {
      lifecycleCounters.planScenes++;
      return [
        { id: 'scene-1', goal: '突破隔离门进入控制室' },
        { id: 'scene-2', goal: '检视反应堆曲率坍缩' }
      ];
    },
    writer: async ({ request, contract: passedContract, contextPlan, scenes, scenePlan }) => {
      lifecycleCounters.writer++;
      // 真实调用 contentEngine.generateDraft，驱动 Mock 模型生成
      const genResult = await contentEngine.generateDraft({
        callModel: async (_auth, options) => {
          assert.equal(options.stage, 'writer');
          assert.ok(options.system.includes('科幻'));
          return {
            text: draftText,
            usage: { promptTokens: 600, completionTokens: 250, totalTokens: 850, creditCost: 0.15 }
          };
        },
        auth: { user: { email: 'author@molan.local' } },
        request: {
          generationId: runId,
          projectId: scope.projectId,
          chapterId,
          genre: '科幻',
          targetWords: 300
        },
        contract: passedContract || contract,
        contextPlan,
        scenes,
        scenePlan,
        genre: '科幻',
        style: '硬核科幻'
      });
      return genResult;
    },
    deterministicAudit: async ({ draft }) => {
      lifecycleCounters.deterministicAudit++;
      assert.equal(draft, draftText);
      return {
        passed: true,
        blockerCount: 0,
        unverifiedCount: 0,
        issues: []
      };
    },
    semanticAudit: async ({ draft }) => {
      lifecycleCounters.semanticAudit++;
      assert.equal(draft, draftText);
      return {
        passed: true,
        status: 'MEASURED',
        blockerCount: 0,
        issues: [],
        dimensions: {
          logic: {
            score: 0.90,
            confidence: 0.92,
            status: 'MEASURED',
            source: 'literary_evaluator',
            quote: '控制室里红色的应急警报灯仍在机械地旋转闪烁',
            evidence: '危机氛围渲染扎实，情节因果连贯'
          }
        }
      };
    },
    qualityAudit: async ({ draft }) => {
      lifecycleCounters.qualityAudit++;
      assert.equal(draft, draftText);
      return createQualityAssessment({
        genre: '科幻',
        contentDigest: hashValue(draft),
        compliance: {
          passed: true,
          checks: {
            wordCount: { passed: true, actual: draft.length, target: 300 },
            characterPresence: { passed: true, characters: ['陆沉', '林博士'] }
          }
        },
        literary: {
          passed: true,
          score: 0.88,
          confidence: 0.92,
          evaluator: { mode: 'single', modelId: 'deepseek-reasoner' },
          dimensions: {
            // 科幻题材关键三维度: speculativeConsistency, logic, language
            speculativeConsistency: {
              score: 0.90,
              confidence: 0.92,
              status: 'MEASURED',
              source: 'literary_evaluator',
              quote: '全息投影中，重力透镜曲率正在以肉眼可见的速度发生坍缩',
              evidence: '科幻设定自洽，曲率坍缩规律一致'
            },
            logic: {
              score: 0.88,
              confidence: 0.90,
              status: 'MEASURED',
              source: 'literary_evaluator',
              quote: '控制室里红色的应急警报灯仍在机械地旋转闪烁',
              evidence: '危机因果链条严密，情节推进合乎逻辑'
            },
            language: {
              score: 0.88,
              confidence: 0.92,
              status: 'MEASURED',
              source: 'literary_evaluator',
              quote: '深层反应堆的核心封印已经出现裂痕',
              evidence: '硬核科幻质感鲜明，行文冷峻洗练'
            }
          }
        }
      });
    }
  };

  const orchestrator = createGenerationOrchestrator({
    store,
    db: repository,
    dependencies: orchestratorDeps
  });

  const created = await orchestrator.create({
    ...scope,
    id: runId,
    chapterId,
    idempotencyKey: 'idem-e2e-ac1',
    requestHash: '1'.repeat(64),
    request: { chapterId, prompt: '深层科研站调查' }
  });

  assert.ok(created && created.run);
  assert.equal(created.run.id, runId);

  // 轮询等待任务异步收敛完成
  let finalRun = null;
  for (let i = 0; i < 80; i++) {
    finalRun = await store.getRun({}, { ...scope, id: runId });
    if (finalRun && (finalRun.state === 'waiting_author' || finalRun.state === 'needs_human' || finalRun.state === 'failed')) {
      break;
    }
    await new Promise(r => setTimeout(r, 20));
  }

  // AC1 验收断言 1: 零人工介入，自主进入 waiting_author 终态
  assert.ok(finalRun, '任务必须成功持久化并落定');
  assert.equal(finalRun.state, 'waiting_author', '合规与文学质量全过时必须自主推进至 waiting_author');
  assert.equal(finalRun.result.draft, draftText, '最终落定正文内容必须与起草正文一致');
  assert.equal(finalRun.result.outputHash, outputHash, '正文 SHA-256 摘要必须完全匹配');
  assert.equal(finalRun.result.quality.passed, true, '质量门禁判定结果必须为严格 passed: true');
  assert.equal(finalRun.result.quality.status, 'MEASURED', '质量门禁状态必须为权威 MEASURED');

  // AC1 验收断言 2: 生命周期各阶段执行恰好 1 次
  assert.equal(lifecycleCounters.planScenes, 1, '场景分镜规划执行恰好 1 次');
  assert.equal(lifecycleCounters.writer, 1, '正文起草调用执行恰好 1 次');
  assert.equal(lifecycleCounters.deterministicAudit, 1, '确定性审计执行恰好 1 次');
  assert.equal(lifecycleCounters.semanticAudit, 1, '语义审计执行恰好 1 次');
  assert.equal(lifecycleCounters.qualityAudit, 1, '质量评估执行恰好 1 次');

  // AC1 验收断言 3: 持久化数据库阶段审计踪迹完整包含规划、撰写与三重质检
  const persistedRun = await repository.generation.get(scope.projectId, runId);
  assert.ok(persistedRun);
  const recordedStages = persistedRun.stages.map(s => s.stage);
  assert.ok(recordedStages.includes('scene_planning'), '阶段记录包含 scene_planning');
  assert.ok(recordedStages.includes('writer'), '阶段记录包含 writer');
  assert.ok(recordedStages.includes('deterministic_audit'), '阶段记录包含 deterministic_audit');
  assert.ok(recordedStages.includes('semantic_audit'), '阶段记录包含 semantic_audit');
  assert.ok(recordedStages.includes('quality_audit'), '阶段记录包含 quality_audit');
});

/**
 * ==============================================================================
 * Test 2 (AC2): Dual Judge Evidence & Provenance
 * 验证 Dual Judge 生产管线：
 * 1. 独立评委元数据：Judge A 与 Judge B 分别具备独立 judgeId, evaluatorId, modelId, promptVersion, inputHash, outputHash；
 * 2. 选择性分流路由：黄金前三章 (1-3)、分卷高潮、重大转折点强制路由至 DUAL_JUDGE，普通章节路由至 SINGLE_JUDGE，临界分/低置信度动态升阶；
 * 3. 共识与分歧门禁：容差 delta <= 0.18 内达成共识并合并打分；分歧 > 0.18 或结论冲突阻断至 needs_human (DUAL_JUDGE_DISCREPANCY)。
 * ==============================================================================
 */
test('Test 2 (AC2): Dual Judge Evidence & Provenance - distinct metadata, selective routing, consensus merging within delta <= 0.18', () => {
  const sampleProse = '演武场四周古树参天，狂风呼啸而过。林巡长剑出鞘，剑鸣声清越如龙吟。青石板在剑气激荡下寸寸龟裂。';
  const proseDigest = hashValue(sampleProse);

  // 1. 独立评估元数据验证
  const judgeA = createJudgeEvaluationRecord({
    judgeId: 'judge_a',
    evaluatorId: 'literary_evaluator_a',
    modelId: 'gpt-4o',
    promptVersion: 'judge_prompt_v2.1',
    score: 0.85,
    passed: true,
    confidence: 0.90,
    qualityVector: {
      language: {
        score: 0.86,
        confidence: 0.90,
        status: 'MEASURED',
        source: 'judge_a',
        quote: '林巡长剑出鞘，剑鸣声清越如龙吟',
        evidence: '动作描写凌厉，画面张力充足'
      }
    },
    draft: sampleProse
  }, 'judge_a');

  const judgeB = createJudgeEvaluationRecord({
    judgeId: 'judge_b',
    evaluatorId: 'literary_evaluator_b',
    modelId: 'deepseek-reasoner',
    promptVersion: 'judge_prompt_v2.1',
    score: 0.75, // |0.85 - 0.75| = 0.10 <= 0.18
    passed: true,
    confidence: 0.88,
    qualityVector: {
      language: {
        score: 0.78,
        confidence: 0.88,
        status: 'MEASURED',
        source: 'judge_b',
        quote: '青石板在剑气激荡下寸寸龟裂',
        evidence: '破坏感具象，节奏适度'
      }
    },
    draft: sampleProse
  }, 'judge_b');

  // 验证独立身份与不可冒充性
  assert.equal(judgeA.judgeId, 'judge_a');
  assert.equal(judgeB.judgeId, 'judge_b');
  assert.equal(judgeA.evaluatorId, 'literary_evaluator_a');
  assert.equal(judgeB.evaluatorId, 'literary_evaluator_b');
  assert.notEqual(judgeA.evaluatorId, judgeB.evaluatorId, '两位评委 evaluatorId 必须完全独立');
  assert.notEqual(judgeA.modelId, judgeB.modelId, '两位评委 modelId 必须独立');
  assert.equal(judgeA.promptVersion, 'judge_prompt_v2.1');
  assert.equal(judgeB.promptVersion, 'judge_prompt_v2.1');
  assert.ok(/^[a-f0-9]{64}$/.test(judgeA.inputHash), 'Judge A inputHash 必须为 64 位 SHA-256');
  assert.ok(/^[a-f0-9]{64}$/.test(judgeB.inputHash), 'Judge B inputHash 必须为 64 位 SHA-256');
  assert.ok(/^[a-f0-9]{64}$/.test(judgeA.outputHash), 'Judge A outputHash 必须为 64 位 SHA-256');
  assert.ok(/^[a-f0-9]{64}$/.test(judgeB.outputHash), 'Judge B outputHash 必须为 64 位 SHA-256');

  // 2. 选择性分流路由验证 (Selective Routing)
  // 黄金前三章 (1-3)
  assert.deepEqual(resolveEvaluationRoute({ chapterNo: 1 }), { route: 'DUAL_JUDGE', reason: 'GOLDEN_CHAPTER' });
  assert.deepEqual(resolveEvaluationRoute({ chapterNo: 2 }), { route: 'DUAL_JUDGE', reason: 'GOLDEN_CHAPTER' });
  assert.deepEqual(resolveEvaluationRoute({ chapterNo: 3 }), { route: 'DUAL_JUDGE', reason: 'GOLDEN_CHAPTER' });

  // 常态后续章节降本路由至单评委
  assert.deepEqual(resolveEvaluationRoute({ chapterNo: 4 }), { route: 'SINGLE_JUDGE', reason: 'NORMAL_CHAPTER' });
  assert.deepEqual(resolveEvaluationRoute({ chapterNo: 15 }), { route: 'SINGLE_JUDGE', reason: 'NORMAL_CHAPTER' });

  // 分卷高潮与重大转折点强制路由
  assert.deepEqual(resolveEvaluationRoute({ chapterNo: 15, isVolumeClimax: true }), { route: 'DUAL_JUDGE', reason: 'VOLUME_CLIMAX' });
  assert.deepEqual(resolveEvaluationRoute({ chapterNo: 20, isMajorTurningPoint: true }), { route: 'DUAL_JUDGE', reason: 'MAJOR_TURNING_POINT' });
  assert.deepEqual(resolveEvaluationRoute({ chapterNo: 25, forceDualJudge: true }), { route: 'DUAL_JUDGE', reason: 'EXPLICIT_OVERRIDE' });

  // 动态升阶判定 (Dynamic Escalation)
  // 临界分 [0.65, 0.78]
  assert.deepEqual(shouldEscalateToDualJudge({ score: 0.72, confidence: 0.90 }), { escalate: true, reason: 'BORDERLINE_SCORE' });
  // 低置信度 < 0.85
  assert.deepEqual(shouldEscalateToDualJudge({ score: 0.85, confidence: 0.80 }), { escalate: true, reason: 'LOW_CONFIDENCE' });
  // 高置信度常态通过，无需升阶
  assert.deepEqual(shouldEscalateToDualJudge({ score: 0.88, confidence: 0.92 }), { escalate: false, reason: 'HIGH_CONFIDENCE_NORMAL' });

  // 3. 共识合并 (Consensus Merging) within delta <= 0.18
  const consensusResult = evaluateDualJudgeConsensus(judgeA, judgeB);
  assert.equal(consensusResult.consensus, true, 'delta = 0.10 <= 0.18 时必须达成共识');
  assert.equal(consensusResult.passed, true);
  assert.equal(consensusResult.status, 'MEASURED');
  assert.equal(consensusResult.score, 0.8, '(0.85 + 0.75) / 2 = 0.8');
  assert.equal(consensusResult.source, 'dual_judge_consensus');
  assert.ok(consensusResult.judgeA);
  assert.ok(consensusResult.judgeB);
  assert.equal(consensusResult.discrepancies.length, 0);

  // 质量门禁无缝接纳共识结果
  const gatePassResult = evaluateQualityGate({
    draft: sampleProse,
    genre: '通用',
    quality: {
      passed: true,
      status: 'MEASURED',
      contentDigest: proseDigest,
      ...consensusResult
    }
  });
  assert.equal(gatePassResult.passed, true);
  assert.equal(gatePassResult.status, 'passed');

  // 4. 分歧过大阻断 (Discrepancy Rejection) when delta > 0.18
  const divergentJudgeB = createJudgeEvaluationRecord({
    judgeId: 'judge_b',
    evaluatorId: 'literary_evaluator_b',
    modelId: 'deepseek-reasoner',
    score: 0.60, // |0.85 - 0.60| = 0.25 > 0.18
    passed: true,
    qualityVector: { language: { score: 0.60 } }
  }, 'judge_b');

  const discrepancyResult = evaluateDualJudgeConsensus(judgeA, divergentJudgeB);
  assert.equal(discrepancyResult.consensus, false, 'delta = 0.25 > 0.18 必须判定分歧');
  assert.equal(discrepancyResult.passed, false);
  assert.equal(discrepancyResult.status, 'needs_human');
  assert.equal(discrepancyResult.code, 'DUAL_JUDGE_DISCREPANCY');
  assert.ok(discrepancyResult.maxDelta > MAX_ALLOWED_DISCREPANCY_DELTA);

  // 质量门禁阻断分歧结果
  const gateBlockedResult = evaluateQualityGate({
    draft: sampleProse,
    genre: '通用',
    quality: {
      passed: false,
      status: 'needs_human',
      ...discrepancyResult
    }
  });
  assert.equal(gateBlockedResult.passed, false);
  assert.equal(gateBlockedResult.status, 'needs_human');
  assert.equal(gateBlockedResult.code, 'DUAL_JUDGE_DISCREPANCY');

  // 5. 结论相悖阻断 (Pass/Fail Conflict)
  const conflictingJudgeB = createJudgeEvaluationRecord({
    judgeId: 'judge_b',
    evaluatorId: 'literary_evaluator_b',
    modelId: 'deepseek-reasoner',
    score: 0.70, // delta = 0.15 <= 0.18，但 passed 为 false
    passed: false,
    qualityVector: { language: { score: 0.70 } }
  }, 'judge_b');

  const conflictResult = evaluateDualJudgeConsensus(judgeA, conflictingJudgeB);
  assert.equal(conflictResult.consensus, false);
  assert.equal(conflictResult.passed, false);
  assert.equal(conflictResult.code, 'DUAL_JUDGE_DISCREPANCY');
  assert.ok(conflictResult.discrepancies.some(d => d.dimension === 'pass_fail_consensus'));
});

/**
 * ==============================================================================
 * Test 3 (AC3): Single Audit Trail Telemetry
 * 审计遥测保证：在单次生成生命周期中，确定性与语义审计对于每个修订稿版本严格执行恰好 1 次；
 * content-engine.generateDraft 为纯粹无状态 Prompt 编译器与单次起草器，不附带内嵌重复审计；
 * 本地修订场景下，每轮修订精准对应 1 次确定性审计记录，杜绝双脑重复与影子审计。
 * ==============================================================================
 */
test('Test 3 (AC3): Single Audit Trail Telemetry - exactly once audit execution per draft revision with zero duplicates', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-e2e-ac3-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  // 步骤 1: 验证 content-engine.generateDraft 无内嵌确定性/语义审计调用
  const initialText = '他快步走过回廊，看见地面上残留着一处斑驳的血迹。风从廊窗灌入，吹熄了灯台上的残烛。';
  const revisedText = '他快步走过回廊，看见地面上残留着一处斑驳的油渍。风从廊窗灌入，吹熄了灯台上的残烛。';

  let rawModelCalls = 0;
  const ceResult = await contentEngine.generateDraft({
    callModel: async () => {
      rawModelCalls++;
      return { text: initialText, usage: { totalTokens: 100 } };
    },
    request: { generationId: 'gen-stateless-audit-check', chapterId: 'ch-ac3-1' },
    contract: { chapterId: 'ch-ac3-1', wordBudget: { targetChars: 200 } }
  });

  assert.equal(rawModelCalls, 1, 'ContentEngine 只发起 1 次模型撰写');
  assert.equal(ceResult.pipeline.deterministicAudit, undefined, 'ContentEngine 返回载荷中不携带内嵌确定性审计');
  assert.equal(ceResult.pipeline.audit, undefined, 'ContentEngine 返回载荷中不携带内嵌语义审计');
  assert.equal(ceResult.pipeline.quality, undefined, 'ContentEngine 返回载荷中不携带内嵌质量评定');

  // 步骤 2: 验证包含 1 轮本地修订的多版本生命周期单审计踪迹
  const scope = { workspaceId: 'ws-e2e-ac3', projectId: 'proj-e2e-ac3', actorUserId: 'author-e2e-ac3' };
  const runId = 'run-e2e-ac3-telemetry';
  const chapterId = 'ch-ac3-1';

  let deterministicAuditAttempts = [];
  let semanticAuditAttempts = [];
  let qualityAuditAttempts = [];
  let reviseAttempts = [];

  const orchestratorDeps = {
    resolveGenre: async () => ({ status: 'resolved', genre: '悬疑' }),
    resolveStyle: async () => ({ status: 'resolved', style: '冷硬' }),
    loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 'snap-ac3-1', storyContext: {} }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 'snap-ac3-1' }),
    planScenes: async () => [{ id: 's1', goal: '穿过回廊' }],
    writer: async ({ request, contract: passedContract, contextPlan }) => ({
      text: initialText,
      manifest: buildGenerationManifest({
        generationId: runId,
        projectId: scope.projectId,
        chapterId,
        pipelineVersion: 'content-engine-v2',
        contextHash: contextPlan.contextHash,
        contractHash: contractHash(passedContract),
        promptHash: 'prompt-hash-ac3',
        outputHash: hashValue(initialText)
      })
    }),
    deterministicAudit: async ({ draft, attempt }) => {
      deterministicAuditAttempts.push({ draft, attempt });
      if (attempt === 1) {
        // 第一轮稿件包含设定冲突阻断项
        return {
          passed: false,
          blockerCount: 1,
          unverifiedCount: 0,
          issues: [{
            issueId: 'issue-blood-stain',
            severity: 'blocker',
            status: 'verified',
            quote: '看见地面上残留着一处斑驳的血迹。',
            problem: '无人员伤亡前置设定冲突'
          }]
        };
      }
      // 第二轮修订稿件通过确定性审计
      return {
        passed: true,
        blockerCount: 0,
        unverifiedCount: 0,
        issues: []
      };
    },
    revise: async ({ issue, round }) => {
      reviseAttempts.push({ issueId: issue.issueId, round });
      return {
        replacement: '看见地面上残留着一处斑驳的油渍。',
        preservedFacts: ['地面', '油渍']
      };
    },
    semanticAudit: async ({ draft, attempt }) => {
      semanticAuditAttempts.push({ draft, attempt });
      return {
        passed: true,
        status: 'MEASURED',
        issues: []
      };
    },
    qualityAudit: async ({ draft, attempt }) => {
      qualityAuditAttempts.push({ draft, attempt });
      return createQualityAssessment({
        genre: '悬疑',
        contentDigest: hashValue(draft),
        compliance: { passed: true, checks: { bounds: { passed: true } } },
        literary: {
          passed: true,
          score: 0.86,
          confidence: 0.90,
          evaluator: { mode: 'single', modelId: 'judge-sus' },
          dimensions: {
            // 悬疑题材必要三维度: clueIntegrity, povBoundary, language
            clueIntegrity: {
              score: 0.88,
              confidence: 0.90,
              status: 'MEASURED',
              source: 'literary_evaluator',
              quote: '看见地面上残留着一处斑驳的油渍。',
              evidence: '现场遗留线索清晰，符合破案轨迹'
            },
            povBoundary: {
              score: 0.86,
              confidence: 0.90,
              status: 'MEASURED',
              source: 'literary_evaluator',
              quote: '他快步走过回廊',
              evidence: '第三人称限知视角严谨，无越界'
            },
            language: {
              score: 0.86,
              confidence: 0.90,
              status: 'MEASURED',
              source: 'literary_evaluator',
              quote: '吹熄了灯台上的残烛。',
              evidence: '悬疑氛围营造到位'
            }
          }
        }
      });
    }
  };

  const orchestrator = createGenerationOrchestrator({
    store,
    db: repository,
    dependencies: orchestratorDeps
  });

  const created = await orchestrator.create({
    ...scope,
    id: runId,
    chapterId,
    idempotencyKey: 'idem-e2e-ac3',
    requestHash: '3'.repeat(64),
    request: { chapterId, prompt: '勘查回廊' }
  });

  let finalRun = null;
  for (let i = 0; i < 80; i++) {
    finalRun = await store.getRun({}, { ...scope, id: runId });
    if (finalRun && (finalRun.state === 'waiting_author' || finalRun.state === 'needs_human' || finalRun.state === 'failed')) {
      break;
    }
    await new Promise(r => setTimeout(r, 20));
  }

  assert.ok(finalRun);
  assert.equal(finalRun.state, 'waiting_author');
  assert.equal(finalRun.result.draft, revisedText, '经过单次局部修订后正文更新为修复后文本');

  // AC3 核心遥测断言：
  // 1. deterministicAudit: 第1版稿件执行 attempt=1，第2版修订稿执行 attempt=2，严格执行 2 次（零重复）
  assert.equal(deterministicAuditAttempts.length, 2, '确定性审计执行恰好 2 次（每版稿件恰好 1 次）');
  assert.equal(deterministicAuditAttempts[0].attempt, 1);
  assert.equal(deterministicAuditAttempts[0].draft, initialText);
  assert.equal(deterministicAuditAttempts[1].attempt, 2);
  assert.equal(deterministicAuditAttempts[1].draft, revisedText);

  // 2. revise: 局修仅针对第 1 版稿件执行 1 次
  assert.equal(reviseAttempts.length, 1);
  assert.equal(reviseAttempts[0].round, 0);

  // 3. semanticAudit: 仅在确定性审计通过后针对修订版正文执行恰好 1 次
  assert.equal(semanticAuditAttempts.length, 1, '语义审计严格执行恰好 1 次');
  assert.equal(semanticAuditAttempts[0].attempt, 2);
  assert.equal(semanticAuditAttempts[0].draft, revisedText);

  // 4. qualityAudit: 仅在语义审计通过后执行恰好 1 次
  assert.equal(qualityAuditAttempts.length, 1, '质量评估严格执行恰好 1 次');
  assert.equal(qualityAuditAttempts[0].attempt, 2);

  // 5. 校验数据库阶段追踪记录完全与遥测计数对齐
  const persisted = await repository.generation.get(scope.projectId, runId);
  const detStages = persisted.stages.filter(s => s.stage === 'deterministic_audit');
  const semStages = persisted.stages.filter(s => s.stage === 'semantic_audit');
  const qualStages = persisted.stages.filter(s => s.stage === 'quality_audit');

  assert.equal(detStages.length, 2, '持久化 stages 严格记录 2 条 deterministic_audit 阶段');
  assert.equal(detStages[0].status, 'failed');
  assert.equal(detStages[1].status, 'completed');
  assert.equal(semStages.length, 1, '持久化 stages 严格记录 1 条 semantic_audit 阶段');
  assert.equal(semStages[0].status, 'completed');
  assert.equal(qualStages.length, 1, '持久化 stages 严格记录 1 条 quality_audit 阶段');
  assert.equal(qualStages[0].status, 'completed');
});

/**
 * ==============================================================================
 * Test 4 (AC4): Quality Gate Provenance Guard
 * 验证质量门禁来源与反篡改守卫：
 * 1. 仅凭合规指标（字数、格式、事实一致、人物出现）绝不能单独解锁文学质量通过状态；
 * 2. 代理/启发式分析器（linguistic_metrics_analyzer, dialogue_extractor 等）被严格限定在 compliance 范围，
 *    即便伪造高分与引文，也绝不能被当作文学维度采纳；
 * 3. 真实文学评测证据（有效正文逐字引文、分数 >= 0.70、置信度 >= 0.75）被正常识别与接纳，无误报拦截。
 * ==============================================================================
 */
test('Test 4 (AC4): Quality Gate Provenance Guard - compliance metrics alone cannot unlock literary pass while genuine literary evidence passes without false-positives', () => {
  const genuineProse = '暮色笼罩着荒凉的关隘，战旗在朔风中猎猎作响。楚寒勒住缰绳，俯瞰着脚下蜿蜒如龙的栈道。十年前离开时的断壁残垣，如今已被杂草吞没。';
  const digest = computeSha256(genuineProse);

  // 场景 1: 合规层 100% 通过，但文学评估缺失或未测量 -> 严格阻断
  const complianceOnlyAssessment = createQualityAssessment({
    genre: '历史',
    contentDigest: digest,
    compliance: {
      passed: true,
      checks: {
        wordCount: { passed: true, score: 1.0 },
        prohibitedPatterns: { passed: true, score: 1.0 },
        characterPresence: { passed: true, score: 1.0 }
      }
    },
    literary: {
      passed: false,
      status: 'NOT_MEASURED',
      score: null,
      dimensions: {}
    }
  });

  assert.equal(complianceOnlyAssessment.compliance.passed, true);
  assert.equal(complianceOnlyAssessment.literary.passed, false);
  assert.equal(complianceOnlyAssessment.passed, false, '合规通过绝不能自动让整体评估通过');

  const gateResultComplianceOnly = evaluateQualityGate({
    draft: genuineProse,
    genre: '通用',
    quality: complianceOnlyAssessment
  });
  assert.equal(gateResultComplianceOnly.passed, false);
  assert.equal(gateResultComplianceOnly.status, 'needs_human');
  assert.equal(gateResultComplianceOnly.code, 'QUALITY_UNMEASURED');

  // 场景 2: 代理指标伪装成文学评估条目（附带正文真实引文与高分） -> 严格拦截
  const proxySources = [
    'linguistic_metrics_analyzer',
    'dialogue_extractor',
    'character_presence_verifier',
    'word_count',
    'heuristic',
    'dialogue_density_evaluator',
    'causal_debt_prose_verifier'
  ];

  for (const proxySource of proxySources) {
    const spoofedQuality = {
      passed: true,
      status: 'MEASURED',
      contentDigest: digest,
      compliance: { passed: true },
      literary: {
        passed: true,
        status: 'MEASURED',
        score: 0.95,
        confidence: 0.95,
        evaluator: { mode: 'proxy', modelId: proxySource },
        dimensions: {
          language: {
            score: 0.95,
            confidence: 0.95,
            status: 'MEASURED',
            source: proxySource, // 伪造来源为代理指标
            quote: '战旗在朔风中猎猎作响',
            start: 11,
            end: 21,
            evidence: '代理指标统计推算'
          }
        }
      }
    };

    const gateSpoofResult = evaluateQualityGate({
      draft: genuineProse,
      genre: '通用',
      quality: spoofedQuality
    });
    assert.equal(gateSpoofResult.passed, false, `代理指标 ${proxySource} 必须被质量门禁拦截`);
    assert.equal(gateSpoofResult.status, 'needs_human');
    assert.ok(gateSpoofResult.blockers.some(b => b.reason.includes('代理指标') || b.code === 'CRITICAL_QUALITY_DIMENSION_EVIDENCE_INVALID'));
  }

  // 场景 3: 真实文学评测证据无误报接纳（同时合规层包含代理指标） -> 顺畅通过
  const genuineQualityAssessment = createQualityAssessment({
    genre: '历史',
    contentDigest: digest,
    compliance: {
      passed: true,
      checks: {
        // 合规层合法使用代理与统计指标
        linguistic_metrics: { passed: true, source: 'linguistic_metrics_analyzer', score: 0.88 },
        dialogue_stats: { passed: true, source: 'dialogue_extractor', score: 0.90 }
      }
    },
    literary: {
      passed: true,
      score: 0.88,
      confidence: 0.92,
      evaluator: { mode: 'single', modelId: 'literary_critic_v1' },
      dimensions: {
        language: {
          score: 0.88,
          confidence: 0.92,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '战旗在朔风中猎猎作响',
          evidence: '意象雄浑苍凉，极具历史厚重感'
        }
      }
    },
    style: { passed: true, score: 0.85, status: 'MEASURED' },
    aiFlavor: { passed: true, risk: 'clean', score: 10, status: 'MEASURED' }
  });

  const gateGenuineResult = evaluateQualityGate({
    draft: genuineProse,
    genre: '通用',
    quality: genuineQualityAssessment
  });

  assert.equal(gateGenuineResult.passed, true, '真实文学评估证据必须顺利通过质量门禁，合规层代理指标不产生误报');
  assert.equal(gateGenuineResult.status, 'passed');
  assert.equal(gateGenuineResult.code, 'OK');
});

/**
 * ==============================================================================
 * Test 5 (AC1 + AC2 + AC3 Integration): Full Lifecycle commit
 * 端到端全链路闭环验证：
 * 1. 完整生命周期调度：created -> planned -> writing -> deterministic_audit -> semantic_audit -> quality_audit (Dual Judge) -> waiting_author；
 * 2. 状态持久化与审计证据完整性：各阶段持久化记录完备，Dual Judge 共识记录无缝留存；
 * 3. 终态防篡改提交围栏 (Commit Fencing)：验证正式提交过程的租约释放、围栏令牌自增、收据留存与二次重放/正文篡改拦截。
 * ==============================================================================
 */
test('Test 5 (AC1 + AC2 + AC3 Integration): Full Lifecycle commit - end-to-end execution, state persistence, and final commit fencing', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-e2e-ac5-commit-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = {
    workspaceId: 'ws-e2e-commit-1',
    projectId: 'proj-e2e-commit-1',
    actorUserId: 'author-e2e-commit-1'
  };
  const runId = 'run-e2e-commit-lifecycle';
  const chapterId = 'ch-commit-001';

  const committedText = '暮云低垂，江面笼罩在一层迷蒙的水汽之中。萧成舟站在船首，掌心紧贴着浸满桐油的缆绳。远处的灯塔隐没在重重雾霭里，只剩下一道微弱的红光在波涛间若隐若现。水手们压低了呼吸，整艘乌篷船如同离弦之箭，悄无声息地滑入夜航的暗流。';
  const correctOutputHash = hashValue(committedText);

  let commitInvoked = false;
  let commitPassedPayload = null;

  const orchestratorDeps = {
    resolveGenre: async () => ({ status: 'resolved', genre: '历史' }),
    resolveStyle: async () => ({ status: 'resolved', style: '沉郁顿挫' }),
    loadAuthoritativeContext: async () => ({
      ok: true,
      snapshotHash: 'snap-commit-001',
      storyContext: { characters: ['萧成舟'] }
    }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 'snap-commit-001' }),
    planScenes: async () => [{ id: 's1', goal: '夜航潜渡' }],
    writer: async ({ request, contract: passedContract, contextPlan }) => ({
      text: committedText,
      manifest: buildGenerationManifest({
        generationId: runId,
        projectId: scope.projectId,
        chapterId,
        pipelineVersion: 'content-engine-v2',
        contextHash: contextPlan.contextHash,
        contractHash: contractHash(passedContract),
        promptHash: 'prompt-hash-commit',
        outputHash: correctOutputHash
      })
    }),
    deterministicAudit: async () => ({
      passed: true,
      blockerCount: 0,
      unverifiedCount: 0,
      issues: []
    }),
    semanticAudit: async () => ({
      passed: true,
      status: 'MEASURED',
      issues: []
    }),
    qualityAudit: async ({ draft }) => {
      // 模拟 Dual Judge 独立评估与共识合并（历史题材必要三维度: historicalPlausibility, logic, language）
      const judgeA = createJudgeEvaluationRecord({
        judgeId: 'judge_a',
        evaluatorId: 'literary_evaluator_a',
        modelId: 'gpt-4o',
        score: 0.86,
        passed: true,
        confidence: 0.92,
        qualityVector: {
          historicalPlausibility: {
            score: 0.88,
            confidence: 0.92,
            status: 'MEASURED',
            source: 'judge_a',
            quote: '掌心紧贴着浸满桐油的缆绳。',
            evidence: '古代水运桐油与乌篷船细节考据扎实'
          },
          logic: {
            score: 0.85,
            confidence: 0.90,
            status: 'MEASURED',
            source: 'judge_a',
            quote: '水手们压低了呼吸，整艘乌篷船如同离弦之箭',
            evidence: '夜航潜行行动逻辑前后呼应'
          },
          language: {
            score: 0.86,
            confidence: 0.92,
            status: 'MEASURED',
            source: 'judge_a',
            quote: '暮云低垂，江面笼罩在一层迷蒙的水汽之中。',
            evidence: '细节写实细腻，氛围渲染沉郁'
          }
        },
        draft
      }, 'judge_a');

      const judgeB = createJudgeEvaluationRecord({
        judgeId: 'judge_b',
        evaluatorId: 'literary_evaluator_b',
        modelId: 'deepseek-reasoner',
        score: 0.84, // delta = 0.02 <= 0.18
        passed: true,
        confidence: 0.90,
        qualityVector: {
          historicalPlausibility: {
            score: 0.86,
            confidence: 0.90,
            status: 'MEASURED',
            source: 'judge_b',
            quote: '掌心紧贴着浸满桐油的缆绳。',
            evidence: '符合明清江南水系行舟习惯'
          },
          logic: {
            score: 0.84,
            confidence: 0.90,
            status: 'MEASURED',
            source: 'judge_b',
            quote: '整艘乌篷船如同离弦之箭，悄无声息地滑入夜航的暗流。',
            evidence: '行舟动态流畅，节奏控制精准'
          },
          language: {
            score: 0.85,
            confidence: 0.90,
            status: 'MEASURED',
            source: 'judge_b',
            quote: '远处的灯塔隐没在重重雾霭里',
            evidence: '行文笔法克制简练'
          }
        },
        draft
      }, 'judge_b');

      const consensus = evaluateDualJudgeConsensus(judgeA, judgeB);
      assert.equal(consensus.consensus, true);

      return createQualityAssessment({
        genre: '历史',
        contentDigest: hashValue(draft),
        compliance: { passed: true, checks: { length: { passed: true } } },
        literary: {
          passed: true,
          score: consensus.score,
          confidence: consensus.confidence,
          evaluator: { mode: 'dual', modelId: 'dual-judge-consensus' },
          dimensions: consensus.qualityVector
        },
        style: { passed: true, score: 0.88, status: 'MEASURED' },
        aiFlavor: { passed: true, risk: 'clean', score: 5, status: 'MEASURED' }
      });
    },
    commit: async input => {
      commitInvoked = true;
      commitPassedPayload = input;
      return {
        committed: true,
        snapshotId: 'snap-commit-final-e2e',
        contentHash: correctOutputHash,
        version: 1
      };
    }
  };

  const orchestrator = createGenerationOrchestrator({
    store,
    db: repository,
    dependencies: orchestratorDeps
  });

  const created = await orchestrator.create({
    ...scope,
    id: runId,
    chapterId,
    idempotencyKey: 'idem-e2e-commit',
    requestHash: '5'.repeat(64),
    request: { chapterId, prompt: '夜航潜渡江面' }
  });

  // 1. 轮询达成 waiting_author
  let waitingRun = null;
  for (let i = 0; i < 80; i++) {
    waitingRun = await store.getRun({}, { ...scope, id: runId });
    if (waitingRun && (waitingRun.state === 'waiting_author' || waitingRun.state === 'needs_human' || waitingRun.state === 'failed')) {
      break;
    }
    await new Promise(r => setTimeout(r, 20));
  }

  assert.ok(waitingRun);
  assert.equal(waitingRun.state, 'waiting_author', '管线完成三重质检后成功驻留在 waiting_author');
  assert.equal(waitingRun.result.draft, committedText);
  assert.equal(waitingRun.result.quality.passed, true);
  const initialFencingToken = waitingRun.fencingToken;

  // 2. 防篡改守卫验证：提交被篡改的正文或哈希不匹配时必须被围栏拦截
  await assert.rejects(
    async () => {
      await orchestrator.commit({
        ...scope,
        id: runId,
        text: '篡改后的正文内容，破坏了哈希一致性。',
        outputHash: correctOutputHash
      });
    },
    /STATE_CONFLICT|不一致/
  );

  // 3. 正常正式提交 (Formal Commit)
  const commitResult = await orchestrator.commit({
    ...scope,
    id: runId,
    text: committedText,
    outputHash: correctOutputHash
  });

  assert.equal(commitInvoked, true, '后端 commit 依赖被成功调用');
  assert.equal(commitResult.run.state, 'committed', '任务状态迁移为 committed');
  assert.equal(commitResult.run.fencingToken, initialFencingToken + 1, '提交动作必须使围栏令牌递增');
  assert.equal(commitResult.run.result.commitReceipt.snapshotId, 'snap-commit-final-e2e', '提交凭据收据完整记录');

  // 4. 验证持久化层状态与租约释放 (Lease Released)
  const persistedCommitted = await repository.generation.get(scope.projectId, runId);
  assert.equal(persistedCommitted.state, 'committed');
  assert.equal(persistedCommitted.leaseOwner, '', '提交后租约所有者必须清空释放');
  assert.equal(persistedCommitted.leaseUntil, null, '提交后租约期限必须清空');
  assert.equal(persistedCommitted.fencingToken, initialFencingToken + 1);

  // 5. 幂等安全守卫：已提交任务二次提交幂等安全返回，且不再二次触发下层写提交
  const reCommitResult = await orchestrator.commit({
    ...scope,
    id: runId,
    text: committedText,
    outputHash: correctOutputHash
  });
  assert.equal(reCommitResult.idempotent, true, '已提交任务幂等返回');
  assert.equal(reCommitResult.run.state, 'committed');
});
