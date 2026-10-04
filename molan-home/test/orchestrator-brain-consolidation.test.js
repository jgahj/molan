'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createJsonGenerationStore } = require('../lib/generation/json-store');
const { JsonFileRepository } = require('../lib/repositories/json-file-repository');
const { createGenerationOrchestrator, ACTIVE_STATES } = require('../lib/generation/orchestrator');
const contentEngine = require('../lib/generation/content-engine');
const { buildGenerationManifest, hashValue } = require('../lib/generation/manifest');
const { contractHash } = require('../lib/generation/contract');
const { createQualityAssessment } = require('../lib/generation/quality-assessment');

test('R4: content-engine.compileDraftPrompt is a pure stateless prompt compiler', () => {
  const contract = {
    chapterId: 'ch-compile-1',
    chapterNo: 1,
    chapterGoal: '查明古镇夜半异响来源',
    novelGenre: '悬疑',
    writingStyle: '冷硬悬疑',
    wordBudget: { minChars: 1000, maxChars: 2000, targetChars: 1500 }
  };
  const request = {
    chapterId: 'ch-compile-1',
    userInstruction: '调查破败道观中的铜钟，发现有人暗中祭祀',
    targetChars: 1500
  };
  const context = '前情提要：主角抵达黑石镇，听说镇东有座废弃道观。';

  const compiled1 = contentEngine.compileDraftPrompt({
    request,
    contract,
    scenes: [{ id: 's1', goal: '推开道观朽烂大门' }, { id: 's2', goal: '撞击铜钟引发震颤' }],
    context,
    genre: '悬疑',
    style: '冷硬悬疑'
  });

  const compiled2 = contentEngine.compileDraftPrompt({
    request,
    contract,
    scenes: [{ id: 's1', goal: '推开道观朽烂大门' }, { id: 's2', goal: '撞击铜钟引发震颤' }],
    context,
    genre: '悬疑',
    style: '冷硬悬疑'
  });

  // 纯函数幂等性与确定性验证
  assert.equal(compiled1.systemPrompt, compiled2.systemPrompt);
  assert.equal(compiled1.userPrompt, compiled2.userPrompt);
  assert.equal(compiled1.wordBudget.target, 1500);
  assert.ok(compiled1.systemPrompt.includes('悬疑'));
  assert.ok(compiled1.systemPrompt.includes('推开道观朽烂大门'));
  assert.ok(compiled1.userPrompt.includes('黑石镇'));
  assert.ok(compiled1.userPrompt.includes('铜钟'));

  // 空参数防御性验证
  const emptyCompiled = contentEngine.compileDraftPrompt({});
  assert.ok(emptyCompiled.systemPrompt);
  assert.ok(emptyCompiled.userPrompt);
  assert.equal(typeof emptyCompiled.wordBudget.target, 'number');
});

test('R4: content-engine.buildDraftRequest compiles request parameters statelessly', () => {
  const req = {
    modelId: 'molan-v2',
    modelParams: { temperature: 0.7, topP: 0.9, seed: 42, contextWindow: 32000 },
    targetChars: 1200
  };
  const draftReq = contentEngine.buildDraftRequest({
    request: req,
    contract: { chapterGoal: '穿过迷雾丛林' },
    context: '背景故事',
    genre: '奇幻'
  });

  assert.equal(draftReq.stage, 'writer');
  assert.equal(draftReq.modelId, 'molan-v2');
  assert.equal(draftReq.temperature, 0.7);
  assert.equal(draftReq.topP, 0.9);
  assert.equal(draftReq.seed, 42);
  assert.ok(draftReq.maxTokens >= 4200);
  assert.ok(draftReq.system.includes('奇幻'));
  assert.ok(draftReq.userPrompt.includes('穿过迷雾丛林'));
  assert.ok(draftReq.contextPlan.renderedPromptBudget);
});

test('R4: content-engine.generateDraft acts statelessly without internal state machines, internal audits, or revision loops', async () => {
  const callLog = [];
  const fakeText = '苏白踏碎了地上的枯枝，脚下传来沉闷的脆响。月光穿透云层，照亮了供桌上那盏未熄灭的油灯。';

  const result = await contentEngine.generateDraft({
    callModel: async (_auth, options) => {
      callLog.push({ stage: options.stage, system: options.system, userPrompt: options.userPrompt });
      return {
        text: fakeText,
        usage: { promptTokens: 450, completionTokens: 120, totalTokens: 570, creditCost: 0.08 }
      };
    },
    auth: { user: { email: 'author@test.local' } },
    request: {
      generationId: 'gen-stateless-test',
      projectId: 'proj-stateless',
      chapterId: 'ch-stateless-1',
      genre: '悬疑',
      targetWords: 100
    },
    contract: {
      chapterId: 'ch-stateless-1',
      chapterNo: 1,
      chapterGoal: '勘查荒庙供桌',
      wordBudget: { minChars: 30, maxChars: 300, targetChars: 100 }
    },
    context: '前情：林间古庙。',
    genre: '悬疑'
  });

  // 核心断言 1：callModel 仅被单次调用（零场景规划 LLM 调用，零局部修订 LLM 循环）
  assert.equal(callLog.length, 1);
  assert.equal(callLog[0].stage, 'writer');
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].stage, 'writer');

  // 核心断言 2：正文与清单正常产出，不附带内嵌修订轮次
  assert.equal(result.draft, fakeText);
  assert.equal(result.text, fakeText);
  assert.equal(result.status, 'draft_created');
  assert.ok(result.manifest);
  assert.equal(result.manifest.pipelineVersion, 'content-engine-v2');
  assert.equal(result.manifest.outputHash, hashValue(fakeText));

  // 核心断言 3：pipeline 载荷中不携带内嵌确定性审计、内嵌语义审计或质量向量结果
  assert.equal(result.pipeline.deterministicAudit, undefined);
  assert.equal(result.pipeline.audit, undefined);
  assert.equal(result.pipeline.quality, undefined);
  assert.equal(result.pipeline.qualityVector, undefined);
  assert.equal(result.pipeline.rounds, undefined);
});

test('R4 & AC3: orchestrator exclusively owns lifecycle, enforcing Single Audit Trail (clean passage to waiting_author)', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-orch-single-brain-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-brain-1', projectId: 'proj-brain-1', actorUserId: 'author-brain-1' };
  const runId = 'run-single-brain-clean';
  const draftText = '沉重的铁闸在身后轰然合拢，扬起漫天铁锈味的风尘。陈野握紧了手里的合金短匕，冷眼注视着巷道深处闪烁的红外探头。';
  const chapterId = 'ch-brain-1';

  let writerCalls = 0;
  let planScenesCalls = 0;
  let deterministicAuditCalls = 0;
  let semanticAuditCalls = 0;
  let qualityAuditCalls = 0;

  const orchestratorDeps = {
    resolveGenre: async () => ({ status: 'resolved', genre: '都市' }),
    resolveStyle: async () => ({ status: 'resolved', style: '冷峻硬派' }),
    loadAuthoritativeContext: async () => ({
      ok: true,
      snapshotHash: 'snap-brain-001',
      storyContext: {
        pov: 'third-limited',
        characters: ['陈野']
      }
    }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 'snap-brain-001' }),
    planScenes: async () => {
      planScenesCalls++;
      return [{ id: 's1', goal: '穿过合金铁闸' }, { id: 's2', goal: '避开红外探头' }];
    },
    writer: async ({ request, contract, contextPlan }) => {
      writerCalls++;
      return {
        text: draftText,
        manifest: buildGenerationManifest({
          generationId: runId,
          projectId: scope.projectId,
          chapterId,
          pipelineVersion: 'content-engine-v2',
          contextHash: contextPlan.contextHash,
          contractHash: contractHash(contract),
          promptHash: 'prompt-hash-test',
          outputHash: hashValue(draftText)
        })
      };
    },
    deterministicAudit: async ({ draft }) => {
      deterministicAuditCalls++;
      return {
        passed: true,
        issues: [],
        blockerCount: 0,
        unverifiedCount: 0
      };
    },
    semanticAudit: async ({ draft }) => {
      semanticAuditCalls++;
      return {
        passed: true,
        status: 'MEASURED',
        issues: [],
        blockerCount: 0,
        dimensions: {
          logic: { score: 0.88, status: 'MEASURED', confidence: 0.90, source: 'literary_evaluator', quote: '合金铁闸在身后轰然合拢' }
        }
      };
    },
    qualityAudit: async ({ draft }) => {
      qualityAuditCalls++;
      return createQualityAssessment({
        genre: '都市',
        contentDigest: hashValue(draft),
        compliance: { passed: true, checks: { length: { passed: true } } },
        literary: {
          passed: true,
          score: 0.88,
          confidence: 0.92,
          evaluator: { mode: 'dual', modelId: 'dual-judge' },
          dimensions: {
            logic: {
              score: 0.88,
              confidence: 0.90,
              status: 'MEASURED',
              source: 'dual_judge_consensus',
              quote: '沉重的铁闸在身后轰然合拢',
              evidence: '动作目标明确，障碍递进合理'
            },
            dialogue: {
              score: 0.85,
              confidence: 0.88,
              status: 'MEASURED',
              source: 'dual_judge_consensus',
              quote: '陈野握紧了手里的合金短匕',
              evidence: '现场动作张力十足'
            },
            language: {
              score: 0.90,
              confidence: 0.95,
              status: 'MEASURED',
              source: 'dual_judge_consensus',
              quote: '冷眼注视着巷道深处闪烁的红外探头',
              evidence: '冷峻硬派风格鲜明'
            }
          }
        }
      });
    },
    commit: async () => ({ committed: true, snapshotId: 'snap-final', contentHash: hashValue(draftText) })
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
    idempotencyKey: 'idem-brain-clean',
    requestHash: 'f'.repeat(64),
    request: { chapterId, prompt: '突围潜入行动' }
  });

  // 轮询直至任务落定
  let finalRun = null;
  for (let i = 0; i < 60; i++) {
    finalRun = await store.getRun({}, { ...scope, id: created.run.id });
    if (finalRun && (finalRun.state === 'waiting_author' || finalRun.state === 'needs_human' || finalRun.state === 'failed')) {
      break;
    }
    await new Promise(r => setTimeout(r, 25));
  }

  // 验收指标 1: 端到端自主顺利推进至 waiting_author，无需人工介入
  assert.ok(finalRun);
  assert.equal(finalRun.state, 'waiting_author', '合规与文学质量达标后必须自主流转至 waiting_author');
  assert.equal(finalRun.result.draft, draftText);
  assert.equal(finalRun.result.quality.passed, true);
  assert.equal(finalRun.result.quality.status, 'MEASURED');

  // 验收指标 2: 单审计踪迹 (Single Audit Trail) - 整个生命周期各阶段严格仅执行 1 次（零重复审计）
  assert.equal(writerCalls, 1, 'Writer 撰写仅执行 1 次');
  assert.equal(planScenesCalls, 1, '场景规划仅执行 1 次');
  assert.equal(deterministicAuditCalls, 1, '确定性合规审计全生命周期严格执行 1 次（零重复）');
  assert.equal(semanticAuditCalls, 1, '语义文学审计全生命周期严格执行 1 次（零重复）');
  assert.equal(qualityAuditCalls, 1, '质量门禁评估全生命周期严格执行 1 次');

  // 验收指标 3: 状态转移与阶段记录验证
  const persistedRun = await repository.generation.get(scope.projectId, created.run.id);
  const stageNames = persistedRun.stages.map(s => s.stage);
  assert.ok(stageNames.includes('scene_planning'));
  assert.ok(stageNames.includes('writer'));
  assert.ok(stageNames.includes('deterministic_audit'));
  assert.ok(stageNames.includes('semantic_audit'));
  assert.ok(stageNames.includes('quality_audit'));

  // 验证各质检 stage 记录计数严格为 1
  const detStages = persistedRun.stages.filter(s => s.stage === 'deterministic_audit');
  const semStages = persistedRun.stages.filter(s => s.stage === 'semantic_audit');
  const qualStages = persistedRun.stages.filter(s => s.stage === 'quality_audit');
  assert.equal(detStages.length, 1, 'Store 记录的 deterministic_audit stage 严格为 1 条');
  assert.equal(semStages.length, 1, 'Store 记录的 semantic_audit stage 严格为 1 条');
  assert.equal(qualStages.length, 1, 'Store 记录的 quality_audit stage 严格为 1 条');

  // 验收指标 4: 正式提交校验一致性
  const commitResult = await orchestrator.commit({
    ...scope,
    id: created.run.id,
    text: draftText,
    outputHash: hashValue(draftText)
  });
  assert.equal(commitResult.run.state, 'committed');
});

test('R4 & AC3: orchestrator local revision loop enforces exactly once audit per draft revision round', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-orch-revision-brain-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-brain-rev', projectId: 'proj-brain-rev', actorUserId: 'author-brain-rev' };
  const runId = 'run-single-brain-rev';
  const initialText = '他走进了房间，看见地上有一滩奇怪的血迹。门外传来了急促的脚步声。';
  const revisedText = '他走进了房间，看见地上有一滩暗红的油渍。门外传来了急促的脚步声。';
  const chapterId = 'ch-brain-rev-1';

  let deterministicAuditCalls = 0;
  let semanticAuditCalls = 0;
  let qualityAuditCalls = 0;
  let reviseCalls = 0;

  const orchestratorDeps = {
    resolveGenre: async () => ({ status: 'resolved', genre: 'universal' }),
    resolveStyle: async () => ({ status: 'resolved', style: 'direct' }),
    loadAuthoritativeContext: async () => ({
      ok: true,
      snapshotHash: 'snap-rev-001',
      storyContext: { pov: 'third-limited' }
    }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 'snap-rev-001' }),
    planScenes: async () => [{ id: 's1', goal: '调查房间' }],
    writer: async ({ request, contract, contextPlan }) => ({
      text: initialText,
      manifest: buildGenerationManifest({
        generationId: runId,
        projectId: scope.projectId,
        chapterId,
        pipelineVersion: 'content-engine-v2',
        contextHash: contextPlan.contextHash,
        contractHash: contractHash(contract),
        promptHash: 'prompt-rev-test',
        outputHash: hashValue(initialText)
      })
    }),
    deterministicAudit: async ({ draft, attempt }) => {
      deterministicAuditCalls++;
      if (attempt === 1) {
        // 第一轮出现阻断项（包含有效 quote）
        return {
          passed: false,
          blockerCount: 1,
          unverifiedCount: 0,
          issues: [{
            issueId: 'issue-blood-stain',
            severity: 'blocker',
            status: 'verified',
            quote: '看见地上有一滩奇怪的血迹。',
            problem: '与前文无伤亡设定冲突'
          }]
        };
      }
      // 第二轮修订后通过
      return {
        passed: true,
        blockerCount: 0,
        unverifiedCount: 0,
        issues: []
      };
    },
    revise: async ({ issue, round }) => {
      reviseCalls++;
      return {
        replacement: '看见地上有一滩暗红的油渍。',
        preservedFacts: ['地上', '油渍']
      };
    },
    semanticAudit: async ({ draft, attempt }) => {
      semanticAuditCalls++;
      return {
        passed: true,
        status: 'MEASURED',
        issues: []
      };
    },
    qualityAudit: async ({ draft }) => {
      qualityAuditCalls++;
      return createQualityAssessment({
        genre: '通用',
        contentDigest: hashValue(draft),
        compliance: { passed: true, checks: { bounds: { passed: true } } },
        literary: {
          passed: true,
          score: 0.85,
          confidence: 0.90,
          evaluator: { mode: 'single', modelId: 'judge-1' },
          dimensions: {
            language: {
              score: 0.85,
              confidence: 0.90,
              status: 'MEASURED',
              source: 'literary_evaluator',
              quote: '门外传来了急促的脚步声。',
              evidence: '节奏适中，叙事清晰'
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
    idempotencyKey: 'idem-brain-rev',
    requestHash: 'e'.repeat(64),
    request: { chapterId, prompt: '调查案发现场' }
  });

  let finalRun = null;
  for (let i = 0; i < 60; i++) {
    finalRun = await store.getRun({}, { ...scope, id: created.run.id });
    if (finalRun && (finalRun.state === 'waiting_author' || finalRun.state === 'needs_human' || finalRun.state === 'failed')) {
      break;
    }
    await new Promise(r => setTimeout(r, 25));
  }

  assert.ok(finalRun);
  assert.equal(finalRun.state, 'waiting_author');
  assert.equal(finalRun.result.draft, revisedText, '经过局部修订后正文内容更新为修订版');
  assert.equal(finalRun.result.revisionRound, 1, '记录经过了 1 轮局部修订');

  // 单审计踪迹 (Single Audit Trail) 严密核对：
  // 第 1 轮：执行 1 次 deterministicAudit -> 阻断 -> 调用 1 次 revise (未触发 semanticAudit/qualityAudit)
  // 第 2 轮：执行 1 次 deterministicAudit -> 通过 -> 执行 1 次 semanticAudit -> 通过 -> 执行 1 次 qualityAudit -> 通过
  assert.equal(reviseCalls, 1, '局部修订服务调用恰好 1 次');
  assert.equal(deterministicAuditCalls, 2, '确定性审计总共执行 2 次（每版修订恰好 1 次）');
  assert.equal(semanticAuditCalls, 1, '语义审计总共执行 1 次（仅在合规通过后执行）');
  assert.equal(qualityAuditCalls, 1, '质量门禁总共执行 1 次');

  // 阶段记录核对
  const persistedRun = await repository.generation.get(scope.projectId, created.run.id);
  const detStages = persistedRun.stages.filter(s => s.stage === 'deterministic_audit');
  assert.equal(detStages.length, 2, '存在 2 次 deterministic_audit stage 记录');
  assert.equal(detStages[0].attemptNo, 1);
  assert.equal(detStages[0].status, 'failed');
  assert.equal(detStages[1].attemptNo, 2);
  assert.equal(detStages[1].status, 'completed');
});

test('R4: orchestrator transitions cleanly to needs_human when literary threshold is not met', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-orch-fail-threshold-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-fail', projectId: 'proj-fail', actorUserId: 'author-fail' };
  const runId = 'run-literary-fail';
  const draftText = '简短的测试正文，文字质量不足。';
  const chapterId = 'ch-fail-1';

  const orchestratorDeps = {
    resolveGenre: async () => ({ status: 'resolved', genre: 'universal' }),
    resolveStyle: async () => ({ status: 'resolved', style: 'direct' }),
    loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 's-fail', storyContext: {} }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 's-fail' }),
    planScenes: async () => [{ id: 's1', goal: '测试' }],
    writer: async ({ request, contract, contextPlan }) => ({
      text: draftText,
      manifest: buildGenerationManifest({
        generationId: runId,
        projectId: scope.projectId,
        chapterId,
        pipelineVersion: 'content-engine-v2',
        contextHash: contextPlan.contextHash,
        contractHash: contractHash(contract),
        promptHash: 'prompt-fail-test',
        outputHash: hashValue(draftText)
      })
    }),
    deterministicAudit: async () => ({ passed: true, issues: [] }),
    semanticAudit: async () => ({ passed: true, status: 'MEASURED', issues: [] }),
    qualityAudit: async () => ({
      passed: false,
      status: 'MEASURED',
      score: 0.50, // 低于门限 0.70
      confidence: 0.85,
      qualityVector: {
        language: {
          value: 0.50,
          confidence: 0.85,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '简短的测试正文',
          evidence: '文字单薄'
        }
      }
    })
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
    idempotencyKey: 'idem-fail-key',
    requestHash: 'c'.repeat(64),
    request: { chapterId, prompt: '低质量测试' }
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
  assert.equal(finalRun.state, 'needs_human', '文学评分未达标时必须流转至 needs_human');
  assert.equal(finalRun.result.quality.passed, false);
});
