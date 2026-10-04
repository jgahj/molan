'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createJsonGenerationStore } = require('../lib/generation/json-store');
const { JsonFileRepository } = require('../lib/repositories/json-file-repository');
const { createGenerationOrchestrator } = require('../lib/generation/orchestrator');
const deterministicAuditModule = require('../lib/generation/deterministic-audit');
const qualityGateModule = require('../lib/generation/quality-gate');
const { buildGenerationManifest, hashValue } = require('../lib/generation/manifest');
const { contractHash } = require('../lib/generation/contract');
const { createQualityAssessment } = require('../lib/generation/quality-assessment');

// ---------------------------------------------------------------------------
// SUITE 1: Statelessness of content-engine.generateDraft
// ---------------------------------------------------------------------------

test('Adversarial 1: contentEngine.generateDraft executes ZERO internal audits, ZERO gates, and ZERO revision loops', async () => {
  let modelCallCount = 0;
  const originalAuditDraft = deterministicAuditModule.auditDraft;
  const originalEvaluateGate = qualityGateModule.evaluateQualityGate;

  let auditDraftCalls = 0;
  let evaluateGateCalls = 0;

  // Spy on global auditDraft and evaluateQualityGate
  deterministicAuditModule.auditDraft = function (...args) {
    auditDraftCalls++;
    return originalAuditDraft.apply(this, args);
  };
  qualityGateModule.evaluateQualityGate = function (...args) {
    evaluateGateCalls++;
    return originalEvaluateGate.apply(this, args);
  };

  // 重新加载 content-engine 确保绑定到 spied 方法
  delete require.cache[require.resolve('../lib/generation/content-engine')];
  const contentEngine = require('../lib/generation/content-engine');

  try {
    const fakeText = '月光如水洒在冷寂的青石板上。楚平驻足于斑驳的门楼前，拔出了腰间的陨铁短剑。';

    const result = await contentEngine.generateDraft({
      callModel: async (_auth, options) => {
        modelCallCount++;
        return {
          text: fakeText,
          usage: { promptTokens: 350, completionTokens: 90, totalTokens: 440, creditCost: 0.06 }
        };
      },
      auth: { user: { email: 'author@adversarial.test' } },
      request: {
        generationId: 'gen-adv-1',
        projectId: 'proj-adv-1',
        chapterId: 'ch-adv-1',
        genre: '武侠',
        targetWords: 80
      },
      contract: {
        chapterId: 'ch-adv-1',
        chapterNo: 1,
        chapterGoal: '查探旧门楼',
        wordBudget: { minChars: 20, maxChars: 200, targetChars: 80 }
      },
      context: '前情提要：夜半古镇。',
      genre: '武侠'
    });

    // 严密断言 1: 在未访问向后兼容 lazy getter 前，外部/内部审计调用次数严格为 0
    assert.equal(auditDraftCalls, 0, 'generateDraft 执行期间严禁调用 auditDraft');
    assert.equal(evaluateGateCalls, 0, 'generateDraft 执行期间严禁调用 evaluateQualityGate');

    // 严密断言 2: 模型正文撰写调用严格为 1 次
    assert.equal(modelCallCount, 1, '仅允许 1 次单次 writer 模型调用');
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].stage, 'writer');

    // 严密断言 3: pipeline 载荷中不携带内嵌审计结果与内嵌修订轮次
    assert.equal(result.pipeline.deterministicAudit, undefined);
    assert.equal(result.pipeline.audit, undefined);
    assert.equal(result.pipeline.quality, undefined);
    assert.equal(result.pipeline.qualityVector, undefined);
    assert.equal(result.pipeline.rounds, undefined);

    // 严密断言 4: 访问 lazy getter 时才按需触发 1 次，且具有缓存不重复触发
    assert.ok(result.deterministicAudit);
    assert.equal(auditDraftCalls, 1, '首次访问 lazy getter 时触发 1 次');
    assert.ok(result.deterministicAudit);
    assert.equal(auditDraftCalls, 1, '二次访问 lazy getter 命中缓存，不重复执行 auditDraft');
  } finally {
    deterministicAuditModule.auditDraft = originalAuditDraft;
    qualityGateModule.evaluateQualityGate = originalEvaluateGate;
    delete require.cache[require.resolve('../lib/generation/content-engine')];
  }
});

// ---------------------------------------------------------------------------
// SUITE 2: Multi-Round Revisions Single Audit Trail Stress Test
// ---------------------------------------------------------------------------

test('Adversarial 2: Multi-round revision loop enforces exactly-once audit per revision attempt across deterministic and semantic stages', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-adv-rev-brain-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-adv-multi', projectId: 'proj-adv-multi', actorUserId: 'author-adv-multi' };
  const runId = 'run-adv-multi-rev';
  const chapterId = 'ch-adv-multi-1';

  // 模拟三轮正文演变：
  // Round 0 (初始稿): 包含确定性合规阻断（违禁词/角色冲突）
  // Round 1 (第一轮修订稿): 确定性合规通过，但语义文学审计阻断（因果逻辑断层）
  // Round 2 (第二轮修订稿): 确定性合规通过，语义文学审计通过，质量门禁通过
  const draftRound0 = '李云飞推开破庙的木门，冷风裹挟着血腥味扑面而来。地上赫然躺着一具早已冰冷的尸体。李云飞拔出佩剑警惕四顾。';
  // Round 0 修订将 '地上赫然躺着一具早已冰冷的尸体。' 替换为 '地上赫然散落着一堆未燃尽的柴炭。'
  const draftRound1 = '李云飞推开破庙的木门，冷风裹挟着血腥味扑面而来。地上赫然散落着一堆未燃尽的柴炭。李云飞拔出佩剑警惕四顾。';
  // Round 1 修订将 '李云飞拔出佩剑警惕四顾。' 替换为 '李云飞纵身一跃攀上了房梁。'
  const draftRound2 = '李云飞推开破庙的木门，冷风裹挟着血腥味扑面而来。地上赫然散落着一堆未燃尽的柴炭。李云飞纵身一跃攀上了房梁。';

  // 审计调用追踪记录仪
  const auditCallLog = [];
  let reviseCalls = 0;

  const orchestratorDeps = {
    resolveGenre: async () => ({ status: 'resolved', genre: '仙侠' }),
    resolveStyle: async () => ({ status: 'resolved', style: '典雅' }),
    loadAuthoritativeContext: async () => ({
      ok: true,
      snapshotHash: 'snap-multi-001',
      storyContext: { pov: 'third-limited', characters: ['李云飞'] }
    }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 'snap-multi-001' }),
    planScenes: async () => [{ id: 's1', goal: '搜查破庙并隐匿身形' }],
    writer: async ({ request, contract, contextPlan }) => ({
      text: draftRound0,
      manifest: buildGenerationManifest({
        generationId: runId,
        projectId: scope.projectId,
        chapterId,
        pipelineVersion: 'content-engine-v2',
        contextHash: contextPlan.contextHash,
        contractHash: contractHash(contract),
        promptHash: 'prompt-multi-test',
        outputHash: hashValue(draftRound0)
      })
    }),

    deterministicAudit: async ({ draft, attempt }) => {
      auditCallLog.push({ stage: 'deterministic_audit', attempt, textSnippet: draft.slice(0, 20) });
      if (attempt === 1) {
        // Round 0: 确定性合规阻断
        return {
          passed: false,
          blockerCount: 1,
          unverifiedCount: 0,
          issues: [{
            issueId: 'det-blocker-1',
            severity: 'blocker',
            status: 'verified',
            quote: '地上赫然躺着一具早已冰冷的尸体。',
            problem: '无伤亡主线合同违规'
          }]
        };
      }
      // Round 1 & Round 2: 确定性合规通过
      return {
        passed: true,
        blockerCount: 0,
        unverifiedCount: 0,
        issues: []
      };
    },

    revise: async ({ issue, round }) => {
      reviseCalls++;
      if (round === 0) {
        // 修复确定性阻断
        return {
          replacement: '地上赫然散落着一堆未燃尽的柴炭。',
          preservedFacts: ['地上', '柴炭']
        };
      }
      if (round === 1) {
        // 修复语义阻断
        return {
          replacement: '李云飞纵身一跃攀上了房梁。',
          preservedFacts: ['李云飞', '房梁']
        };
      }
      throw new Error(`Unexpected revision round: ${round}`);
    },

    semanticAudit: async ({ draft, attempt }) => {
      auditCallLog.push({ stage: 'semantic_audit', attempt, textSnippet: draft.slice(0, 20) });
      if (attempt === 2) {
        // Round 1: 语义文学审计阻断（引用存在于当前 draft 中的原句）
        return {
          passed: false,
          status: 'MEASURED',
          blockerCount: 1,
          issues: [{
            issueId: 'sem-blocker-1',
            category: 'causality',
            severity: 'blocker',
            status: 'verified',
            quote: '李云飞拔出佩剑警惕四顾。',
            problem: '隐匿目标下拔剑声响过大，违背因果'
          }]
        };
      }
      if (attempt === 3) {
        // Round 2: 语义文学审计通过
        return {
          passed: true,
          status: 'MEASURED',
          issues: [],
          blockerCount: 0,
          dimensions: {
            causality: { score: 0.92, status: 'MEASURED', confidence: 0.95, quote: '李云飞纵身一跃攀上了房梁' }
          }
        };
      }
      throw new Error(`Unexpected semanticAudit attempt: ${attempt}`);
    },

    qualityAudit: async ({ draft, attempt }) => {
      auditCallLog.push({ stage: 'quality_audit', attempt, textSnippet: draft.slice(0, 20) });
      return createQualityAssessment({
        genre: '仙侠',
        contentDigest: hashValue(draft),
        compliance: { passed: true, checks: { bounds: { passed: true } } },
        literary: {
          passed: true,
          score: 0.90,
          confidence: 0.92,
          evaluator: { mode: 'single', modelId: 'judge-final' },
          dimensions: {
            causality: {
              score: 0.92,
              confidence: 0.95,
              status: 'MEASURED',
              source: 'literary_evaluator',
              quote: '李云飞纵身一跃攀上了房梁。',
              evidence: '动作因果自然，身手敏捷'
            },
            language: {
              score: 0.90,
              confidence: 0.92,
              status: 'MEASURED',
              source: 'literary_evaluator',
              quote: '冷风裹挟着血腥味扑面而来。',
              evidence: '氛围描写到位'
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
    idempotencyKey: 'idem-multi-rev',
    requestHash: 'a'.repeat(64),
    request: { chapterId, prompt: '破庙潜入' }
  });

  let finalRun = null;
  for (let i = 0; i < 80; i++) {
    finalRun = await store.getRun({}, { ...scope, id: created.run.id });
    if (finalRun && (finalRun.state === 'waiting_author' || finalRun.state === 'needs_human' || finalRun.state === 'failed')) {
      break;
    }
    await new Promise(r => setTimeout(r, 25));
  }

  // 1. 最终状态验证
  assert.ok(finalRun);
  assert.equal(finalRun.state, 'waiting_author', '经两轮修订后应成功达成 waiting_author');
  assert.equal(finalRun.result.draft, draftRound2, '最终正文应为第二轮修订后的最终文本');
  assert.equal(finalRun.result.revisionRound, 2, '修订轮次累计记录为 2');
  assert.equal(reviseCalls, 2, '局部修订执行调用恰好 2 次');

  // 2. 单审计踪迹 (Single Audit Trail) 严密核对：
  // 预期审计时序调用链：
  // [1] deterministic_audit (attempt=1) -> failed
  // [2] deterministic_audit (attempt=2) -> passed
  // [3] semantic_audit (attempt=2) -> failed
  // [4] deterministic_audit (attempt=3) -> passed
  // [5] semantic_audit (attempt=3) -> passed
  // [6] quality_audit (attempt=3) -> passed
  assert.equal(auditCallLog.length, 6, '全流程总共执行 6 次审计调用，不多也不少');

  assert.deepEqual(auditCallLog[0], { stage: 'deterministic_audit', attempt: 1, textSnippet: draftRound0.slice(0, 20) });
  assert.deepEqual(auditCallLog[1], { stage: 'deterministic_audit', attempt: 2, textSnippet: draftRound1.slice(0, 20) });
  assert.deepEqual(auditCallLog[2], { stage: 'semantic_audit', attempt: 2, textSnippet: draftRound1.slice(0, 20) });
  assert.deepEqual(auditCallLog[3], { stage: 'deterministic_audit', attempt: 3, textSnippet: draftRound2.slice(0, 20) });
  assert.deepEqual(auditCallLog[4], { stage: 'semantic_audit', attempt: 3, textSnippet: draftRound2.slice(0, 20) });
  assert.deepEqual(auditCallLog[5], { stage: 'quality_audit', attempt: 3, textSnippet: draftRound2.slice(0, 20) });

  // 验证各 revision round 内的独立执行次数：
  // Round 0 (attempt 1): deterministicAudit 1 次, semanticAudit 0 次, qualityAudit 0 次
  const r0Dets = auditCallLog.filter(c => c.attempt === 1 && c.stage === 'deterministic_audit');
  const r0Sems = auditCallLog.filter(c => c.attempt === 1 && c.stage === 'semantic_audit');
  assert.equal(r0Dets.length, 1, 'Round 0 确定性审计恰好 1 次');
  assert.equal(r0Sems.length, 0, 'Round 0 语义审计不得执行（已在合规阶段阻断）');

  // Round 1 (attempt 2): deterministicAudit 1 次, semanticAudit 1 次, qualityAudit 0 次
  const r1Dets = auditCallLog.filter(c => c.attempt === 2 && c.stage === 'deterministic_audit');
  const r1Sems = auditCallLog.filter(c => c.attempt === 2 && c.stage === 'semantic_audit');
  const r1Quals = auditCallLog.filter(c => c.attempt === 2 && c.stage === 'quality_audit');
  assert.equal(r1Dets.length, 1, 'Round 1 确定性审计恰好 1 次');
  assert.equal(r1Sems.length, 1, 'Round 1 语义审计恰好 1 次');
  assert.equal(r1Quals.length, 0, 'Round 1 质量门禁不得执行（已在语义阶段阻断）');

  // Round 2 (attempt 3): deterministicAudit 1 次, semanticAudit 1 次, qualityAudit 1 次
  const r2Dets = auditCallLog.filter(c => c.attempt === 3 && c.stage === 'deterministic_audit');
  const r2Sems = auditCallLog.filter(c => c.attempt === 3 && c.stage === 'semantic_audit');
  const r2Quals = auditCallLog.filter(c => c.attempt === 3 && c.stage === 'quality_audit');
  assert.equal(r2Dets.length, 1, 'Round 2 确定性审计恰好 1 次');
  assert.equal(r2Sems.length, 1, 'Round 2 语义审计恰好 1 次');
  assert.equal(r2Quals.length, 1, 'Round 2 质量门禁恰好 1 次');

  // 3. 验证持久化层 Store Stages 记录
  const persistedRun = await repository.generation.get(scope.projectId, created.run.id);
  const detStages = persistedRun.stages.filter(s => s.stage === 'deterministic_audit');
  const semStages = persistedRun.stages.filter(s => s.stage === 'semantic_audit');
  const qualStages = persistedRun.stages.filter(s => s.stage === 'quality_audit');
  const revEvents = persistedRun.events.filter(e => e.state === 'revision');

  assert.equal(detStages.length, 3, 'Store 记录的 deterministic_audit stages 严格为 3 条');
  assert.equal(detStages[0].attemptNo, 1);
  assert.equal(detStages[0].status, 'failed');
  assert.equal(detStages[1].attemptNo, 2);
  assert.equal(detStages[1].status, 'completed');
  assert.equal(detStages[2].attemptNo, 3);
  assert.equal(detStages[2].status, 'completed');

  assert.equal(semStages.length, 2, 'Store 记录的 semantic_audit stages 严格为 2 条');
  assert.equal(semStages[0].attemptNo, 2);
  assert.equal(semStages[0].status, 'failed');
  assert.equal(semStages[1].attemptNo, 3);
  assert.equal(semStages[1].status, 'completed');

  assert.equal(qualStages.length, 1, 'Store 记录的 quality_audit stages 严格为 1 条');
  assert.equal(qualStages[0].attemptNo, 3);
  assert.equal(qualStages[0].status, 'completed');

  assert.equal(revEvents.length, 2, 'Store 记录的 revision 状态转移事件严格为 2 次');
});

// ---------------------------------------------------------------------------
// SUITE 3: Quality Gate Failure Non-Looping Boundary
// ---------------------------------------------------------------------------

test('Adversarial 3: Quality gate rejection terminates immediately in needs_human without re-auditing or silent looping', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-adv-gate-fail-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-adv-gate', projectId: 'proj-adv-gate', actorUserId: 'author-adv-gate' };
  const runId = 'run-adv-gate-fail';
  const draftText = '夜深人静，窗外树影摇曳。他坐起身来，若有所思。';
  const chapterId = 'ch-adv-gate-1';

  let deterministicAuditCalls = 0;
  let semanticAuditCalls = 0;
  let qualityAuditCalls = 0;

  const orchestratorDeps = {
    resolveGenre: async () => ({ status: 'resolved', genre: 'universal' }),
    resolveStyle: async () => ({ status: 'resolved', style: 'direct' }),
    loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 's-gate', storyContext: {} }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 's-gate' }),
    planScenes: async () => [{ id: 's1', goal: '静夜思' }],
    writer: async ({ request, contract, contextPlan }) => ({
      text: draftText,
      manifest: buildGenerationManifest({
        generationId: runId,
        projectId: scope.projectId,
        chapterId,
        pipelineVersion: 'content-engine-v2',
        contextHash: contextPlan.contextHash,
        contractHash: contractHash(contract),
        promptHash: 'prompt-gate-test',
        outputHash: hashValue(draftText)
      })
    }),
    deterministicAudit: async () => {
      deterministicAuditCalls++;
      return { passed: true, issues: [] };
    },
    semanticAudit: async () => {
      semanticAuditCalls++;
      return { passed: true, status: 'MEASURED', issues: [] };
    },
    qualityAudit: async () => {
      qualityAuditCalls++;
      return {
        passed: false,
        status: 'MEASURED',
        score: 0.52,
        confidence: 0.88,
        qualityVector: {
          language: { value: 0.52, confidence: 0.88, status: 'MEASURED', source: 'literary_evaluator', quote: '夜深人静', evidence: '描写过简' }
        }
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
    idempotencyKey: 'idem-gate-fail',
    requestHash: 'b'.repeat(64),
    request: { chapterId, prompt: '静夜思' }
  });

  let finalRun = null;
  for (let i = 0; i < 60; i++) {
    finalRun = await store.getRun({}, { ...scope, id: created.run.id });
    if (finalRun && (finalRun.state === 'needs_human' || finalRun.state === 'waiting_author' || finalRun.state === 'failed')) {
      break;
    }
    await new Promise(r => setTimeout(r, 25));
  }

  assert.ok(finalRun);
  assert.equal(finalRun.state, 'needs_human');
  // 严格核查：质量门禁不达标时，各阶段审计恰好仅执行 1 次，严禁尝试死循环自动重审
  assert.equal(deterministicAuditCalls, 1, 'deterministicAudit 严格仅执行 1 次');
  assert.equal(semanticAuditCalls, 1, 'semanticAudit 严格仅执行 1 次');
  assert.equal(qualityAuditCalls, 1, 'qualityAudit 严格仅执行 1 次');
});

// ---------------------------------------------------------------------------
// SUITE 4: Max Revision Rounds Boundary
// ---------------------------------------------------------------------------

test('Adversarial 4: When revisions persistently fail, orchestrator strictly halts at MAX_REVISION_ROUNDS with exact audit parity', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-adv-max-rev-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-adv-max', projectId: 'proj-adv-max', actorUserId: 'author-adv-max' };
  const runId = 'run-adv-max-rev';
  const initialText = '正文中有一处致命的合规错误原句必须修订。其余部分内容正常。';
  const chapterId = 'ch-adv-max-1';

  let deterministicAuditCalls = 0;
  let reviseCalls = 0;

  const orchestratorDeps = {
    resolveGenre: async () => ({ status: 'resolved', genre: 'universal' }),
    resolveStyle: async () => ({ status: 'resolved', style: 'direct' }),
    loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 's-max', storyContext: {} }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 's-max' }),
    planScenes: async () => [{ id: 's1', goal: '测试最大轮次' }],
    writer: async ({ request, contract, contextPlan }) => ({
      text: initialText,
      manifest: buildGenerationManifest({
        generationId: runId,
        projectId: scope.projectId,
        chapterId,
        pipelineVersion: 'content-engine-v2',
        contextHash: contextPlan.contextHash,
        contractHash: contractHash(contract),
        promptHash: 'prompt-max-test',
        outputHash: hashValue(initialText)
      })
    }),
    deterministicAudit: async ({ draft, attempt }) => {
      deterministicAuditCalls++;
      // 每一轮持续返回 blocker，永不通过
      return {
        passed: false,
        blockerCount: 1,
        unverifiedCount: 0,
        issues: [{
          issueId: `det-blocker-${attempt}`,
          severity: 'blocker',
          status: 'verified',
          quote: '致命的合规错误原句必须修订。',
          problem: '持续阻断测试'
        }]
      };
    },
    revise: async ({ issue, round }) => {
      reviseCalls++;
      // 即使修订了，下一轮审计依然报 blocker（模拟顽固阻断）
      return {
        replacement: '致命的合规错误原句必须修订。',
        preservedFacts: ['合规']
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
    idempotencyKey: 'idem-max-rev',
    requestHash: 'd'.repeat(64),
    request: { chapterId, prompt: '最大轮次测试' }
  });

  let finalRun = null;
  for (let i = 0; i < 60; i++) {
    finalRun = await store.getRun({}, { ...scope, id: created.run.id });
    if (finalRun && (finalRun.state === 'needs_human' || finalRun.state === 'waiting_author' || finalRun.state === 'failed')) {
      break;
    }
    await new Promise(r => setTimeout(r, 25));
  }

  assert.ok(finalRun);
  assert.equal(finalRun.state, 'needs_human', '超出最大修订轮次后必须流转至 needs_human');

  // MAX_REVISION_ROUNDS = 2
  // Attempt 1 (Round 0): Audit 1 -> blocker -> Revise 1 (round=0) -> revisionRound becomes 1
  // Attempt 2 (Round 1): Audit 2 -> blocker -> Revise 2 (round=1) -> revisionRound becomes 2
  // Attempt 3 (Round 2): Audit 3 -> blocker -> revisionRound (2) >= MAX_REVISION_ROUNDS (2) -> needs_human!
  assert.equal(reviseCalls, 2, 'revise 服务最多被调用 MAX_REVISION_ROUNDS (2) 次');
  assert.equal(deterministicAuditCalls, 3, '确定性审计执行恰好 3 次（1 初始 + 2 修订轮次）');
});

// ---------------------------------------------------------------------------
// SUITE 5: Hallucinated / Unlocatable Blocker Quote Fail-Closed Stop
// ---------------------------------------------------------------------------

test('Adversarial 5: Blocker with hallucinated unlocatable quote immediately halts to needs_human with zero duplicate audit', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-adv-unloc-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-adv-unloc', projectId: 'proj-adv-unloc', actorUserId: 'author-adv-unloc' };
  const runId = 'run-adv-unloc';
  const draftText = '正文写得很正常，没有任何提及青龙偃月刀的内容。';
  const chapterId = 'ch-adv-unloc-1';

  let deterministicAuditCalls = 0;
  let reviseCalls = 0;

  const orchestratorDeps = {
    resolveGenre: async () => ({ status: 'resolved', genre: 'universal' }),
    resolveStyle: async () => ({ status: 'resolved', style: 'direct' }),
    loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 's-unloc', storyContext: {} }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 's-unloc' }),
    planScenes: async () => [{ id: 's1', goal: '测试定位失败' }],
    writer: async ({ request, contract, contextPlan }) => ({
      text: draftText,
      manifest: buildGenerationManifest({
        generationId: runId,
        projectId: scope.projectId,
        chapterId,
        pipelineVersion: 'content-engine-v2',
        contextHash: contextPlan.contextHash,
        contractHash: contractHash(contract),
        promptHash: 'prompt-unloc-test',
        outputHash: hashValue(draftText)
      })
    }),
    deterministicAudit: async ({ draft, attempt }) => {
      deterministicAuditCalls++;
      return {
        passed: false,
        blockerCount: 1,
        unverifiedCount: 0,
        issues: [{
          issueId: 'det-hallucinated-1',
          severity: 'blocker',
          status: 'verified',
          quote: '关公挥舞起八十二斤青龙偃月刀。', // 正文中完全不存在的原句
          problem: '凭空虚构原句'
        }]
      };
    },
    revise: async () => {
      reviseCalls++;
      return { replacement: '正常描写', preservedFacts: [] };
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
    idempotencyKey: 'idem-unloc',
    requestHash: 'e'.repeat(64),
    request: { chapterId, prompt: '测试定位失败' }
  });

  let finalRun = null;
  for (let i = 0; i < 60; i++) {
    finalRun = await store.getRun({}, { ...scope, id: created.run.id });
    if (finalRun && (finalRun.state === 'needs_human' || finalRun.state === 'waiting_author' || finalRun.state === 'failed')) {
      break;
    }
    await new Promise(r => setTimeout(r, 25));
  }

  assert.ok(finalRun);
  assert.equal(finalRun.state, 'needs_human');
  // 定位失败时立即终止，revise 不应被调用，审计只执行了 1 次
  assert.equal(reviseCalls, 0, '无法唯一定位时严禁调用 revise');
  assert.equal(deterministicAuditCalls, 1, '确定性审计执行恰好 1 次');
});

// ---------------------------------------------------------------------------
// SUITE 6: Structural and Code Integrity Invariant Verification
// ---------------------------------------------------------------------------

test('Adversarial 6: content-engine.generateDraft has zero loops, zero recursive calls, and zero eager audit invocations in source code', () => {
  const contentEngineSrc = fs.readFileSync(path.join(__dirname, '../lib/generation/content-engine.js'), 'utf8');

  // 提取 generateDraft 函数实现源码
  const match = contentEngineSrc.match(/async function generateDraft\([\s\S]*?\n\}/);
  assert.ok(match, '必须能提取到 generateDraft 函数定义');
  const funcSrc = match[0];

  // 验证无循环语法
  assert.equal(/\bwhile\s*\(/.test(funcSrc), false, 'generateDraft 函数体内严禁存在 while 循环');
  assert.equal(/\bdo\s*\{/.test(funcSrc), false, 'generateDraft 函数体内严禁存在 do-while 循环');
  assert.equal(/\bfor\s*\(/.test(funcSrc), false, 'generateDraft 函数体内严禁存在 for 循环');

  // 验证在 Object.defineProperties 之前，没有调用 auditDraft 或 auditSemantics
  const beforeDefineProps = funcSrc.split('Object.defineProperties')[0];
  assert.equal(beforeDefineProps.includes('auditDraft('), false, '正文起草执行期间严禁调用 auditDraft');
  assert.equal(beforeDefineProps.includes('auditSemantics('), false, '正文起草执行期间严禁调用 auditSemantics');
  assert.equal(beforeDefineProps.includes('evaluateQualityVector('), false, '正文起草执行期间严禁调用 evaluateQualityVector');
  assert.equal(beforeDefineProps.includes('evaluateQualityGate('), false, '正文起草执行期间严禁调用 evaluateQualityGate');
});
