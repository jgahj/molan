'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { createGenerationOrchestrator } = require('../lib/generation/orchestrator');
const { createJsonGenerationStore } = require('../lib/generation/json-store');
const { JsonFileRepository } = require('../lib/repositories/json-file-repository');
const contentEngine = require('../lib/generation/content-engine');
const deterministicAuditModule = require('../lib/generation/deterministic-audit');
const {
  createQualityAssessment,
  validateQualityAssessment,
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
const { MAX_REVISION_ROUNDS } = require('../lib/generation/revision');

function computeSha256(content) {
  return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}

// ==============================================================================
// SUITE 1 (AC1): Autonomous Progression, Stall & Infinite Loop Stress Harness
// ==============================================================================

test('AC1 Stress 1: Repeated deterministic audit failure strictly terminates at MAX_REVISION_ROUNDS without infinite loop', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-adv-ac1-loop-det-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-adv-1', projectId: 'proj-adv-1', actorUserId: 'user-adv-1' };
  const runId = 'run-adv-det-loop';
  const initialText = '古塔顶层的寒风呼啸。黑袍人拔出长剑，剑锋指向地面的血迹。';

  let deterministicAttempts = 0;
  let reviseAttempts = 0;

  const orchestrator = createGenerationOrchestrator({
    store,
    db: repository,
    dependencies: {
      resolveGenre: async () => ({ status: 'resolved', genre: '武侠' }),
      resolveStyle: async () => ({ status: 'resolved', style: '传统武侠' }),
      loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 'snap-1', storyContext: {} }),
      preGenerationGuard: async () => ({ passed: true, snapshotHash: 'snap-1' }),
      planScenes: async () => [{ id: 's1', goal: '塔顶对决' }],
      writer: async ({ contextPlan, contract }) => ({
        text: initialText,
        manifest: buildGenerationManifest({
          generationId: runId,
          projectId: scope.projectId,
          chapterId: 'ch-1',
          pipelineVersion: 'content-engine-v2',
          contextHash: contextPlan.contextHash,
          contractHash: contractHash(contract),
          promptHash: 'prompt-1',
          outputHash: hashValue(initialText)
        })
      }),
      // 故意让确定性审计在每轮都报 blocker，测试是否死循环
      deterministicAudit: async ({ draft, attempt }) => {
        deterministicAttempts++;
        const targetQuote = draft.includes('血迹') ? '剑锋指向地面的血迹。' : (draft.includes('暗斑') ? '剑锋指向地面的暗斑。' : '剑锋指向地面的灰尘。');
        return {
          passed: false,
          blockerCount: 1,
          issues: [{
            issueId: `issue-det-stubborn-${attempt}`,
            severity: 'blocker',
            status: 'verified',
            quote: targetQuote,
            problem: '无休止的设定冲突'
          }]
        };
      },
      revise: async ({ issue, round }) => {
        reviseAttempts++;
        const rep = round === 0 ? '剑锋指向地面的暗斑。' : '剑锋指向地面的灰尘。';
        return {
          replacement: rep,
          preservedFacts: ['地面']
        };
      }
    }
  });

  await orchestrator.create({
    ...scope,
    id: runId,
    chapterId: 'ch-1',
    idempotencyKey: 'idem-adv-det-loop',
    requestHash: '1'.repeat(64),
    request: { chapterId: 'ch-1', prompt: '塔顶对决' }
  });

  let finalRun = null;
  for (let i = 0; i < 50; i++) {
    finalRun = await store.getRun({}, { ...scope, id: runId });
    if (finalRun && (finalRun.state === 'needs_human' || finalRun.state === 'failed' || finalRun.state === 'waiting_author')) {
      break;
    }
    await new Promise(r => setTimeout(r, 20));
  }

  // 验证：绝对不能死循环，达到上限后必须安全熔断至 needs_human
  assert.ok(finalRun);
  assert.equal(finalRun.state, 'needs_human', '多轮修订失败后必须安全收敛至 needs_human');
  assert.equal(reviseAttempts, MAX_REVISION_ROUNDS, `局修必须严格在 ${MAX_REVISION_ROUNDS} 轮后停止，绝不无限重试`);
  assert.equal(deterministicAttempts, MAX_REVISION_ROUNDS + 1, '确定性审计执行轮数 = 局修轮数 + 最终判定轮数');
});

test('AC1 Stress 2: Repeated semantic audit failure strictly terminates at MAX_REVISION_ROUNDS without infinite loop', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-adv-ac1-loop-sem-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-adv-2', projectId: 'proj-adv-2', actorUserId: 'user-adv-2' };
  const runId = 'run-adv-sem-loop';
  const initialText = '他冷冷地望着远方的烟波，心中翻江倒海。手中紧握着那枚青铜令牌。';

  let semanticAttempts = 0;
  let reviseAttempts = 0;

  const orchestrator = createGenerationOrchestrator({
    store,
    db: repository,
    dependencies: {
      resolveGenre: async () => ({ status: 'resolved', genre: '历史' }),
      resolveStyle: async () => ({ status: 'resolved', style: '正史' }),
      loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 'snap-2', storyContext: {} }),
      preGenerationGuard: async () => ({ passed: true, snapshotHash: 'snap-2' }),
      planScenes: async () => [{ id: 's1', goal: '江畔凝望' }],
      writer: async ({ contextPlan, contract }) => ({
        text: initialText,
        manifest: buildGenerationManifest({
          generationId: runId,
          projectId: scope.projectId,
          chapterId: 'ch-2',
          pipelineVersion: 'content-engine-v2',
          contextHash: contextPlan.contextHash,
          contractHash: contractHash(contract),
          promptHash: 'prompt-2',
          outputHash: hashValue(initialText)
        })
      }),
      deterministicAudit: async () => ({ passed: true, blockerCount: 0, issues: [] }),
      semanticAudit: async ({ draft, attempt }) => {
        semanticAttempts++;
        const targetQuote = draft.includes('青铜令牌') ? '手中紧握着那枚青铜令牌。' : (draft.includes('铁铸兵符') ? '手中紧握着那枚铁铸兵符。' : '手中紧握着那枚玄铁腰牌。');
        return {
          passed: false,
          status: 'MEASURED',
          issues: [{
            issueId: `issue-sem-stubborn-${attempt}`,
            severity: 'blocker',
            status: 'verified',
            quote: targetQuote,
            problem: '年代道具历史失实'
          }]
        };
      },
      revise: async ({ round }) => {
        reviseAttempts++;
        const rep = round === 0 ? '手中紧握着那枚铁铸兵符。' : '手中紧握着那枚玄铁腰牌。';
        return {
          replacement: rep,
          preservedFacts: ['手中']
        };
      }
    }
  });

  await orchestrator.create({
    ...scope,
    id: runId,
    chapterId: 'ch-2',
    idempotencyKey: 'idem-adv-sem-loop',
    requestHash: '2'.repeat(64),
    request: { chapterId: 'ch-2', prompt: '江畔凝望' }
  });

  let finalRun = null;
  for (let i = 0; i < 50; i++) {
    finalRun = await store.getRun({}, { ...scope, id: runId });
    if (finalRun && (finalRun.state === 'needs_human' || finalRun.state === 'failed' || finalRun.state === 'waiting_author')) {
      break;
    }
    await new Promise(r => setTimeout(r, 20));
  }

  assert.ok(finalRun);
  assert.equal(finalRun.state, 'needs_human', '语义审计持续失败必须安全收敛至 needs_human');
  assert.equal(reviseAttempts, MAX_REVISION_ROUNDS, `语义修订必须严格在 ${MAX_REVISION_ROUNDS} 轮后停止`);
  assert.equal(semanticAttempts, MAX_REVISION_ROUNDS + 1);
});

test('AC1 Stress 3: Ambiguous replacement window instantly converges to needs_human without stall or loop', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-adv-ac1-ambig-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-adv-3', projectId: 'proj-adv-3', actorUserId: 'user-adv-3' };
  const runId = 'run-adv-ambig';
  // 正文中多次出现相同引文
  const initialText = '他举起长剑。四周一片寂静。\n\n他举起长剑。风声渐起。';

  let reviseCalled = false;

  const orchestrator = createGenerationOrchestrator({
    store,
    db: repository,
    dependencies: {
      resolveGenre: async () => ({ status: 'resolved', genre: '武侠' }),
      resolveStyle: async () => ({ status: 'resolved', style: '简练' }),
      loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 'snap-3', storyContext: {} }),
      preGenerationGuard: async () => ({ passed: true, snapshotHash: 'snap-3' }),
      planScenes: async () => [{ id: 's1', goal: '拔剑' }],
      writer: async ({ contextPlan, contract }) => ({
        text: initialText,
        manifest: buildGenerationManifest({
          generationId: runId,
          projectId: scope.projectId,
          chapterId: 'ch-3',
          pipelineVersion: 'content-engine-v2',
          contextHash: contextPlan.contextHash,
          contractHash: contractHash(contract),
          promptHash: 'prompt-3',
          outputHash: hashValue(initialText)
        })
      }),
      deterministicAudit: async () => ({
        passed: false,
        blockerCount: 1,
        issues: [{
          issueId: 'issue-ambig-1',
          severity: 'blocker',
          status: 'verified',
          quote: '他举起长剑。', // 多次出现，无法唯一定位
          problem: '重复描写'
        }]
      }),
      revise: async () => {
        reviseCalled = true;
        return { replacement: '他放下长剑。' };
      }
    }
  });

  await orchestrator.create({
    ...scope,
    id: runId,
    chapterId: 'ch-3',
    idempotencyKey: 'idem-adv-ambig',
    requestHash: '3'.repeat(64),
    request: { chapterId: 'ch-3', prompt: '拔剑' }
  });

  let finalRun = null;
  for (let i = 0; i < 50; i++) {
    finalRun = await store.getRun({}, { ...scope, id: runId });
    if (finalRun && (finalRun.state === 'needs_human' || finalRun.state === 'failed' || finalRun.state === 'waiting_author')) {
      break;
    }
    await new Promise(r => setTimeout(r, 20));
  }

  assert.ok(finalRun);
  assert.equal(finalRun.state, 'needs_human', '引文不唯一定位时必须立即转为 needs_human');
  assert.equal(reviseCalled, false, '定位失败时不应发起修订调用');
});

test('AC1 Stress 4: Semantic preservation breach (polarity inversion) immediately converges to needs_human', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-adv-ac1-polarity-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-adv-4', projectId: 'proj-adv-4', actorUserId: 'user-adv-4' };
  const runId = 'run-adv-polarity';
  const initialText = '他站在窗前，心中明白自己绝不能背叛师门。月光洒在青石板上。';

  const orchestrator = createGenerationOrchestrator({
    store,
    db: repository,
    dependencies: {
      resolveGenre: async () => ({ status: 'resolved', genre: '武侠' }),
      resolveStyle: async () => ({ status: 'resolved', style: '正剧' }),
      loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 'snap-4', storyContext: {} }),
      preGenerationGuard: async () => ({ passed: true, snapshotHash: 'snap-4' }),
      planScenes: async () => [{ id: 's1', goal: '抉择' }],
      writer: async ({ contextPlan, contract }) => ({
        text: initialText,
        manifest: buildGenerationManifest({
          generationId: runId,
          projectId: scope.projectId,
          chapterId: 'ch-4',
          pipelineVersion: 'content-engine-v2',
          contextHash: contextPlan.contextHash,
          contractHash: contractHash(contract),
          promptHash: 'prompt-4',
          outputHash: hashValue(initialText)
        })
      }),
      deterministicAudit: async () => ({
        passed: false,
        blockerCount: 1,
        issues: [{
          issueId: 'issue-polarity-1',
          severity: 'blocker',
          status: 'verified',
          quote: '自己绝不能背叛师门。',
          problem: '表述生硬'
        }]
      }),
      // 恶意或有缺陷的 revise 模型：发生否定极性反转（绝不能 -> 必须）
      revise: async () => ({
        replacement: '自己必须背叛师门。',
        preservedFacts: ['师门']
      })
    }
  });

  await orchestrator.create({
    ...scope,
    id: runId,
    chapterId: 'ch-4',
    idempotencyKey: 'idem-adv-polarity',
    requestHash: '4'.repeat(64),
    request: { chapterId: 'ch-4', prompt: '抉择' }
  });

  let finalRun = null;
  for (let i = 0; i < 50; i++) {
    finalRun = await store.getRun({}, { ...scope, id: runId });
    if (finalRun && (finalRun.state === 'needs_human' || finalRun.state === 'failed' || finalRun.state === 'waiting_author')) {
      break;
    }
    await new Promise(r => setTimeout(r, 20));
  }

  assert.ok(finalRun);
  assert.equal(finalRun.state, 'needs_human', '语义篡改/极性反转必须触发 needs_human 阻断');
});

// ==============================================================================
// SUITE 2 (AC2): Dual Judge Metadata Distinctness & Discrepancy Gate Boundary
// ==============================================================================

test('AC2 Adversarial 1: Judge A and Judge B metadata verification (evaluatorId, modelId, promptVersion, sha256 hashes)', () => {
  const sampleDraft = '夜幕低垂，暴雨如注。黑衣剑客站在屋脊之上，雨水顺着锋利的剑尖滴落。';
  const draftHash = hashValue(sampleDraft);

  const judgeA = createJudgeEvaluationRecord({
    judgeId: 'judge_a',
    evaluatorId: 'literary_evaluator_a',
    modelId: 'gpt-4o',
    promptVersion: 'judge_prompt_v2.1',
    score: 0.86,
    passed: true,
    confidence: 0.91,
    inputPayload: { draft: sampleDraft, judgeSlot: 'judge_a' },
    outputPayload: { score: 0.86, passed: true, modelId: 'gpt-4o' },
    qualityVector: {
      language: { score: 0.86, status: 'MEASURED', quote: '雨水顺着锋利的剑尖滴落', evidence: '意象生动' }
    }
  }, 'judge_a');

  const judgeB = createJudgeEvaluationRecord({
    judgeId: 'judge_b',
    evaluatorId: 'literary_evaluator_b',
    modelId: 'deepseek-reasoner',
    promptVersion: 'judge_prompt_v2.1',
    score: 0.83,
    passed: true,
    confidence: 0.89,
    inputPayload: { draft: sampleDraft, judgeSlot: 'judge_b' },
    outputPayload: { score: 0.83, passed: true, modelId: 'deepseek-reasoner' },
    qualityVector: {
      language: { score: 0.83, status: 'MEASURED', quote: '黑衣剑客站在屋脊之上', evidence: '画面感强' }
    }
  }, 'judge_b');

  // 严格断言元数据区分度与格式
  assert.equal(judgeA.judgeId, 'judge_a');
  assert.equal(judgeB.judgeId, 'judge_b');
  assert.notEqual(judgeA.judgeId, judgeB.judgeId, 'judgeId 必须区分');
  assert.equal(judgeA.evaluatorId, 'literary_evaluator_a');
  assert.equal(judgeB.evaluatorId, 'literary_evaluator_b');
  assert.notEqual(judgeA.evaluatorId, judgeB.evaluatorId, 'evaluatorId 必须完全独立');
  assert.notEqual(judgeA.modelId, judgeB.modelId, '执行模型必须完全独立');
  assert.equal(judgeA.promptVersion, 'judge_prompt_v2.1');
  assert.equal(judgeB.promptVersion, 'judge_prompt_v2.1');

  // 哈希格式与独立性校验
  assert.match(judgeA.inputHash, /^[a-f0-9]{64}$/, 'Judge A inputHash 必须为 64 位 SHA-256');
  assert.match(judgeB.inputHash, /^[a-f0-9]{64}$/, 'Judge B inputHash 必须为 64 位 SHA-256');
  assert.notEqual(judgeA.inputHash, judgeB.inputHash, '独立评审入参哈希必须独立');
  assert.match(judgeA.outputHash, /^[a-f0-9]{64}$/, 'Judge A outputHash 必须为 64 位 SHA-256');
  assert.match(judgeB.outputHash, /^[a-f0-9]{64}$/, 'Judge B outputHash 必须为 64 位 SHA-256');
  assert.notEqual(judgeA.outputHash, judgeB.outputHash, '独立评审输出哈希必须独立');
});

test('AC2 Adversarial 2: Discrepancy Gate Boundary testing at Delta = 0.18 threshold', () => {
  const baseVectorA = { language: { score: 0.80, status: 'MEASURED', quote: '引文A' } };

  // 场景 A: Delta = 0.1799 (微低于 0.18) -> 共识通过
  const judgeA_1 = { passed: true, score: 0.80, qualityVector: baseVectorA };
  const judgeB_1 = { passed: true, score: 0.6201, qualityVector: { language: { score: 0.6201, status: 'MEASURED', quote: '引文B' } } };
  const res1 = evaluateDualJudgeConsensus(judgeA_1, judgeB_1);
  assert.equal(res1.consensus, true, 'delta = 0.1799 <= 0.18 必须达成共识');
  assert.equal(res1.passed, true);
  assert.equal(res1.status, 'MEASURED');

  // 场景 B: Delta = 0.1800 (精确等于 0.18 临界) -> 共识通过
  const judgeB_2 = { passed: true, score: 0.62, qualityVector: { language: { score: 0.62, status: 'MEASURED', quote: '引文B' } } };
  const res2 = evaluateDualJudgeConsensus(judgeA_1, judgeB_2);
  assert.equal(res2.consensus, true, 'delta = 0.1800 <= 0.18 处于容差上限内，必须达成共识');
  assert.equal(res2.passed, true);

  // 场景 C: Delta = 0.88 - 0.70 = 0.18000000000000005 (IEEE 754 浮点微距溢出防御)
  const judgeA_float = { passed: true, score: 0.88, qualityVector: { language: { score: 0.88 } } };
  const judgeB_float = { passed: true, score: 0.70, qualityVector: { language: { score: 0.70 } } };
  const resFloat = evaluateDualJudgeConsensus(judgeA_float, judgeB_float);
  assert.equal(resFloat.consensus, true, 'IEEE 754 浮点微距抖动下 0.88 - 0.70 必须被四位小数取整防御，达成共识');
  assert.equal(resFloat.passed, true);

  // 场景 D: Delta = 0.1801 (微超过 0.18) -> 严格阻断
  const judgeB_3 = { passed: true, score: 0.6199, qualityVector: { language: { score: 0.6199, status: 'MEASURED', quote: '引文B' } } };
  const res3 = evaluateDualJudgeConsensus(judgeA_1, judgeB_3);
  assert.equal(res3.consensus, false, 'delta = 0.1801 > 0.18 必须严格阻断');
  assert.equal(res3.passed, false);
  assert.equal(res3.code, 'DUAL_JUDGE_DISCREPANCY');
  assert.equal(res3.status, 'needs_human');

  // 场景 E: Delta = 0.25 (显著超标) -> 严格阻断
  const judgeB_4 = { passed: true, score: 0.55, qualityVector: { language: { score: 0.55, status: 'MEASURED', quote: '引文B' } } };
  const res4 = evaluateDualJudgeConsensus(judgeA_1, judgeB_4);
  assert.equal(res4.consensus, false);
  assert.equal(res4.code, 'DUAL_JUDGE_DISCREPANCY');
});

test('AC2 Adversarial 3: Pass/Fail conclusion conflict (even with microscopic delta) must strictly block', () => {
  // 分数几乎完全相同 (0.75 vs 0.74, delta = 0.01)，但 Judge A判定通过，Judge B判定未通过
  const judgeA = {
    passed: true,
    score: 0.75,
    qualityVector: { language: { score: 0.75 } }
  };
  const judgeB = {
    passed: false,
    score: 0.74,
    qualityVector: { language: { score: 0.74 } }
  };

  const result = evaluateDualJudgeConsensus(judgeA, judgeB);
  assert.equal(result.consensus, false, '结论相悖时绝不允许达成共识');
  assert.equal(result.passed, false);
  assert.equal(result.status, 'needs_human');
  assert.equal(result.code, 'DUAL_JUDGE_DISCREPANCY');
  assert.ok(result.discrepancies.some(d => d.dimension === 'pass_fail_consensus'));

  // 质量门禁对接阻断
  const gateResult = evaluateQualityGate({
    draft: '测试正文样例',
    genre: '通用',
    quality: result
  });
  assert.equal(gateResult.passed, false);
  assert.equal(gateResult.status, 'needs_human');
  assert.equal(gateResult.code, 'DUAL_JUDGE_DISCREPANCY');
});

test('AC2 Adversarial 4: Dimension-level discrepancy exceeds 0.18 while overall score delta is 0 strictly blocks', () => {
  // 总分完全一致 (0.80 vs 0.80)，但 logic 维度分歧高达 0.25
  const judgeA = {
    passed: true,
    score: 0.80,
    qualityVector: {
      language: { score: 0.70 },
      logic: { score: 0.90 }
    }
  };
  const judgeB = {
    passed: true,
    score: 0.80,
    qualityVector: {
      language: { score: 0.95 },
      logic: { score: 0.65 } // |0.90 - 0.65| = 0.25 > 0.18
    }
  };

  const result = evaluateDualJudgeConsensus(judgeA, judgeB);
  assert.equal(result.consensus, false, '关键维度分歧超标必须判定分歧');
  assert.equal(result.passed, false);
  assert.equal(result.code, 'DUAL_JUDGE_DISCREPANCY');
  assert.ok(result.discrepancies.some(d => d.dimension === 'logic'));
});

test('AC2 Adversarial 5: Both judges reject -> consensus: true, passed: false, code: DUAL_JUDGE_REJECTED', () => {
  const judgeA = { passed: false, score: 0.50, qualityVector: { language: { score: 0.50 } } };
  const judgeB = { passed: false, score: 0.52, qualityVector: { language: { score: 0.52 } } };

  const result = evaluateDualJudgeConsensus(judgeA, judgeB);
  assert.equal(result.consensus, true, '双评委意见一致时达成共识');
  assert.equal(result.passed, false, '全挂时结论必须为挂');
  assert.equal(result.code, 'DUAL_JUDGE_REJECTED', '错误码必须明确标识一致否决');
  assert.equal(result.status, 'needs_human');
});

test('AC2 Adversarial 6: Fail-Closed discipline on model execution exception (EVALUATION_FAILED)', () => {
  const judgeA = {
    status: 'EVALUATION_FAILED',
    code: 'EVALUATION_FAILED',
    error: { message: 'Cloud LLM provider timeout' }
  };
  const judgeB = { passed: true, score: 0.95, qualityVector: { language: { score: 0.95 } } };

  const result = evaluateDualJudgeConsensus(judgeA, judgeB);
  assert.equal(result.consensus, false);
  assert.equal(result.passed, false);
  assert.equal(result.code, 'EVALUATION_FAILED');
  assert.equal(result.status, 'needs_human');
  assert.match(result.reason, /EVALUATION_FAILED/);
});

// ==============================================================================
// SUITE 3 (AC3): Single Audit Trail Invariant & Multi-Round Telemetry
// ==============================================================================

test('AC3 Adversarial 1: Instrument & spy proves contentEngine.generateDraft executes ZERO internal audits', async () => {
  const originalAuditDraft = deterministicAuditModule.auditDraft;
  const originalEvaluateQualityVector = contentEngine.evaluateQualityVector;

  let auditDraftSpiedCount = 0;
  let evaluateQualityVectorSpiedCount = 0;

  deterministicAuditModule.auditDraft = function (...args) {
    auditDraftSpiedCount++;
    return originalAuditDraft.apply(this, args);
  };
  contentEngine.evaluateQualityVector = function (...args) {
    evaluateQualityVectorSpiedCount++;
    return originalEvaluateQualityVector.apply(this, args);
  };

  try {
    const textSample = '月照松林，幽泉流响。道长缓步而行，拂尘轻摆。';
    const result = await contentEngine.generateDraft({
      callModel: async () => ({
        text: textSample,
        usage: { promptTokens: 120, completionTokens: 40, totalTokens: 160, creditCost: 0.02 }
      }),
      auth: { user: { email: 'author@molan.test' } },
      request: { generationId: 'gen-zero-audit', chapterId: 'ch-zero-1' },
      contract: { chapterId: 'ch-zero-1', wordBudget: { targetChars: 100 } }
    });

    // 严密断言：在纯正文起草调用过程中，没有任何内部审计被隐式触发
    assert.equal(auditDraftSpiedCount, 0, 'contentEngine.generateDraft 执行过程中绝对不调用 auditDraft');
    assert.equal(evaluateQualityVectorSpiedCount, 0, 'contentEngine.generateDraft 执行过程中绝对不调用 evaluateQualityVector');

    // pipeline 载荷中绝无内嵌审计字段
    assert.equal(result.pipeline.deterministicAudit, undefined, 'pipeline.deterministicAudit 必须为 undefined');
    assert.equal(result.pipeline.audit, undefined, 'pipeline.audit 必须为 undefined');
    assert.equal(result.pipeline.quality, undefined, 'pipeline.quality 必须为 undefined');
  } finally {
    deterministicAuditModule.auditDraft = originalAuditDraft;
    contentEngine.evaluateQualityVector = originalEvaluateQualityVector;
  }
});

test('AC3 Adversarial 2: Exact single audit execution per draft revision across multi-stage local revisions', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-adv-ac3-multi-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-adv-ac3', projectId: 'proj-adv-ac3', actorUserId: 'author-adv-ac3' };
  const runId = 'run-adv-ac3-multi-rev';
  const chapterId = 'ch-multi-01';

  // 版本稿件定义
  // v1: 包含确定性阻断词【血迹】
  const textV1 = '暮色沉沉。巡捕楚恒推开库房重门，地面上赫然残留着一滩发黑的血迹。屋梁上挂着蛛网。';
  // v2: 修复【血迹】为【油污】，但包含语义阻断词【青铜令牌】
  const textV2 = '暮色沉沉。巡捕楚恒推开库房重门，地面上赫然残留着一滩发黑的油污。屋梁上挂着蛛网。手中握着青铜令牌。';
  // v3: 修复【青铜令牌】为【腰牌】，全检通过
  const textV3 = '暮色沉沉。巡捕楚恒推开库房重门，地面上赫然残留着一滩发黑的油污。屋梁上挂着蛛网。手中握着巡捕腰牌。';

  let detAuditCalls = [];
  let semAuditCalls = [];
  let qualAuditCalls = [];
  let reviseCalls = [];

  const orchestrator = createGenerationOrchestrator({
    store,
    db: repository,
    dependencies: {
      resolveGenre: async () => ({ status: 'resolved', genre: '悬疑' }),
      resolveStyle: async () => ({ status: 'resolved', style: '冷硬' }),
      loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 'snap-ac3-multi', storyContext: {} }),
      preGenerationGuard: async () => ({ passed: true, snapshotHash: 'snap-ac3-multi' }),
      planScenes: async () => [{ id: 's1', goal: '勘查库房' }],
      writer: async ({ contextPlan, contract }) => ({
        text: textV1,
        manifest: buildGenerationManifest({
          generationId: runId,
          projectId: scope.projectId,
          chapterId,
          pipelineVersion: 'content-engine-v2',
          contextHash: contextPlan.contextHash,
          contractHash: contractHash(contract),
          promptHash: 'prompt-ac3-multi',
          outputHash: hashValue(textV1)
        })
      }),
      deterministicAudit: async ({ draft, attempt }) => {
        detAuditCalls.push({ draft, attempt });
        if (draft.includes('血迹')) {
          return {
            passed: false,
            blockerCount: 1,
            issues: [{
              issueId: 'det-issue-blood',
              severity: 'blocker',
              status: 'verified',
              quote: '地面上赫然残留着一滩发黑的血迹。',
              problem: '不符合无人伤亡设定'
            }]
          };
        }
        return { passed: true, blockerCount: 0, issues: [] };
      },
      revise: async ({ issue, round }) => {
        reviseCalls.push({ issueId: issue.issueId, round });
        if (issue.issueId === 'det-issue-blood') {
          return {
            replacement: '地面上赫然残留着一滩发黑的油污。屋梁上挂着蛛网。手中握着青铜令牌。',
            preservedFacts: ['地面', '油污']
          };
        }
        if (issue.issueId === 'sem-issue-token') {
          return {
            replacement: '手中握着巡捕腰牌。',
            preservedFacts: ['手中']
          };
        }
        throw new Error('未知 issue');
      },
      semanticAudit: async ({ draft, attempt }) => {
        semAuditCalls.push({ draft, attempt });
        if (draft.includes('青铜令牌')) {
          return {
            passed: false,
            status: 'MEASURED',
            issues: [{
              issueId: 'sem-issue-token',
              severity: 'blocker',
              status: 'verified',
              quote: '手中握着青铜令牌。',
              problem: '年代背景道具失实'
            }]
          };
        }
        return { passed: true, status: 'MEASURED', issues: [] };
      },
      qualityAudit: async ({ draft, attempt }) => {
        qualAuditCalls.push({ draft, attempt });
        return createQualityAssessment({
          genre: '悬疑',
          contentDigest: hashValue(draft),
          compliance: { passed: true },
          literary: {
            passed: true,
            score: 0.88,
            confidence: 0.92,
            evaluator: { mode: 'single', modelId: 'critic-sus' },
            dimensions: {
              clueIntegrity: {
                score: 0.88, confidence: 0.92, status: 'MEASURED',
                source: 'literary_evaluator', quote: '残留着一滩发黑的油污', evidence: '线索写实'
              },
              povBoundary: {
                score: 0.86, confidence: 0.90, status: 'MEASURED',
                source: 'literary_evaluator', quote: '巡捕楚恒推开库房重门', evidence: '限知视点'
              },
              language: {
                score: 0.88, confidence: 0.92, status: 'MEASURED',
                source: 'literary_evaluator', quote: '屋梁上挂着蛛网', evidence: '氛围冷硬'
              }
            }
          }
        });
      }
    }
  });

  await orchestrator.create({
    ...scope,
    id: runId,
    chapterId,
    idempotencyKey: 'idem-ac3-multi',
    requestHash: '7'.repeat(64),
    request: { chapterId, prompt: '勘查库房' }
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
  assert.equal(finalRun.state, 'waiting_author', '经过两轮精准局修后成功进入 waiting_author');

  // AC3 核心遥测断言：
  // 1. 确定性审计：初始 v1 稿件执行 1 次 (attempt=1) -> v2 稿件执行 1 次 (attempt=2) -> v3 稿件执行 1 次 (attempt=3)
  //    共严格执行 3 次，每版稿件恰好执行 1 次
  assert.equal(detAuditCalls.length, 3, '确定性审计在 3 版稿件上恰好各执行 1 次（总共 3 次）');
  assert.equal(detAuditCalls[0].attempt, 1);
  assert.equal(detAuditCalls[1].attempt, 2);
  assert.equal(detAuditCalls[2].attempt, 3);

  // 2. 局部修订：严格执行 2 次（round 0 修复血迹，round 1 修复令牌）
  assert.equal(reviseCalls.length, 2, '局修严格执行 2 次');
  assert.equal(reviseCalls[0].issueId, 'det-issue-blood');
  assert.equal(reviseCalls[1].issueId, 'sem-issue-token');

  // 3. 语义审计：在确定性通过后才触发
  //    v1: 确定性失败，不触发语义审计
  //    v2: 确定性通过，触发语义审计 (attempt=2)，发现令牌 blocker
  //    v3: 确定性通过，触发语义审计 (attempt=3)，全通
  //    共严格执行 2 次，零冗余！
  assert.equal(semAuditCalls.length, 2, '语义审计仅在确定性通过后执行，总计恰好 2 次');
  assert.equal(semAuditCalls[0].attempt, 2);
  assert.equal(semAuditCalls[1].attempt, 3);

  // 4. 质量评估：仅在语义审计通过后执行恰好 1 次 (attempt=3)
  assert.equal(qualAuditCalls.length, 1, '质量评估仅在最终全通后执行恰好 1 次');
  assert.equal(qualAuditCalls[0].attempt, 3);

  // 5. 校验数据库持久化 stage 记录完全吻合遥测计数
  const persisted = await repository.generation.get(scope.projectId, runId);
  const detStages = persisted.stages.filter(s => s.stage === 'deterministic_audit');
  const semStages = persisted.stages.filter(s => s.stage === 'semantic_audit');
  const qualStages = persisted.stages.filter(s => s.stage === 'quality_audit');

  assert.equal(detStages.length, 3, '持久化 stage 必须严格记录 3 条 deterministic_audit');
  assert.equal(detStages[0].status, 'failed');
  assert.equal(detStages[1].status, 'completed');
  assert.equal(detStages[2].status, 'completed');

  assert.equal(semStages.length, 2, '持久化 stage 必须严格记录 2 条 semantic_audit');
  assert.equal(semStages[0].status, 'failed');
  assert.equal(semStages[1].status, 'completed');

  assert.equal(qualStages.length, 1, '持久化 stage 必须严格记录 1 条 quality_audit');
  assert.equal(qualStages[0].status, 'completed');
});

test('AC1 Stress 5: Null / invalid object from deterministicAudit & semanticAudit fails closed safely without stalling', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-adv-ac1-null-audit-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-adv-null', projectId: 'proj-adv-null', actorUserId: 'user-adv-null' };
  const runId = 'run-adv-null-audit';
  const sampleText = '窗外风雨大作。石桌上的蜡烛在疾风中摇曳不定。';

  const orchestrator = createGenerationOrchestrator({
    store,
    db: repository,
    dependencies: {
      resolveGenre: async () => ({ status: 'resolved', genre: '悬疑' }),
      resolveStyle: async () => ({ status: 'resolved', style: '冷硬' }),
      loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 'snap-null', storyContext: {} }),
      preGenerationGuard: async () => ({ passed: true, snapshotHash: 'snap-null' }),
      planScenes: async () => [{ id: 's1', goal: '雨夜对坐' }],
      writer: async ({ contextPlan, contract }) => ({
        text: sampleText,
        manifest: buildGenerationManifest({
          generationId: runId,
          projectId: scope.projectId,
          chapterId: 'ch-null',
          pipelineVersion: 'content-engine-v2',
          contextHash: contextPlan.contextHash,
          contractHash: contractHash(contract),
          promptHash: 'prompt-null',
          outputHash: hashValue(sampleText)
        })
      }),
      // 模拟审计模块抛出异常或返回非预期的 null
      deterministicAudit: async () => null,
      revise: null // 无局修器
    }
  });

  await orchestrator.create({
    ...scope,
    id: runId,
    chapterId: 'ch-null',
    idempotencyKey: 'idem-adv-null',
    requestHash: '8'.repeat(64),
    request: { chapterId: 'ch-null', prompt: '雨夜对坐' }
  });

  let finalRun = null;
  for (let i = 0; i < 50; i++) {
    finalRun = await store.getRun({}, { ...scope, id: runId });
    if (finalRun && (finalRun.state === 'needs_human' || finalRun.state === 'failed' || finalRun.state === 'waiting_author')) {
      break;
    }
    await new Promise(r => setTimeout(r, 20));
  }

  // 必须安全防御，不可抛未捕获异常导致停机，应安全 Fail-Closed 降级至 needs_human
  assert.ok(finalRun);
  assert.equal(finalRun.state, 'needs_human');
});

test('AC1 Stress 6: Empty text from writer throws MODEL_EMPTY and transitions to failed without stalling', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-adv-ac1-empty-writer-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-adv-empty', projectId: 'proj-adv-empty', actorUserId: 'user-adv-empty' };
  const runId = 'run-adv-empty-writer';

  const orchestrator = createGenerationOrchestrator({
    store,
    db: repository,
    dependencies: {
      resolveGenre: async () => ({ status: 'resolved', genre: '科幻' }),
      resolveStyle: async () => ({ status: 'resolved', style: '硬核' }),
      loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 'snap-empty', storyContext: {} }),
      preGenerationGuard: async () => ({ passed: true, snapshotHash: 'snap-empty' }),
      planScenes: async () => [{ id: 's1', goal: '起飞' }],
      writer: async () => ({
        text: '   \n  \t  ' // 空白正文
      })
    }
  });

  await orchestrator.create({
    ...scope,
    id: runId,
    chapterId: 'ch-empty',
    idempotencyKey: 'idem-adv-empty',
    requestHash: '9'.repeat(64),
    request: { chapterId: 'ch-empty', prompt: '起飞' }
  });

  let finalRun = null;
  for (let i = 0; i < 50; i++) {
    finalRun = await store.getRun({}, { ...scope, id: runId });
    if (finalRun && (finalRun.state === 'failed' || finalRun.state === 'provider_unknown' || finalRun.state === 'needs_human')) {
      break;
    }
    await new Promise(r => setTimeout(r, 20));
  }

  assert.ok(finalRun);
  assert.equal(finalRun.state, 'failed');
  assert.equal(finalRun.errorCode, 'MODEL_EMPTY');
});

