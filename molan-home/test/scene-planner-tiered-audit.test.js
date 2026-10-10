'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  detectOutlineCompletenessTier,
  validateAndEnforceFullScenePlan,
  deriveScenesFromEventChain,
  inferLightweightScenePlan,
  verifyCausalInvariants,
  planScenesTiered,
  compileSceneDirectives,
  planScenes,
  CausalInvariantViolationError
} = require('../lib/scene-planner');

const { createGenerationOrchestrator } = require('../lib/generation/orchestrator');
const { createJsonGenerationStore } = require('../lib/generation/json-store');
const { JsonFileRepository } = require('../lib/repositories/json-file-repository');
const { contractHash } = require('../lib/generation/contract');
const { buildGenerationManifest, hashValue } = require('../lib/generation/manifest');
const { createQualityAssessment } = require('../lib/generation/quality-assessment');
const { GenerationError } = require('../lib/generation/errors');
const { isTerminal } = require('../lib/generation/state-machine');

function setupTestEnvironment(prefix = 'molan-sp-test-') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  const cleanup = async () => {
    try { await repository.close(); } catch (_) {}
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch (_) {}
  };
  return { directory, repository, store, cleanup };
}

// ============================================================================
// Group 1: detectOutlineCompletenessTier 完备度自动探测器
// ============================================================================

test('SP-Tier-01: detectOutlineCompletenessTier 准确识别 full_scenes', () => {
  // 1. 显式 contract.scenes
  assert.equal(detectOutlineCompletenessTier({ scenes: [{ goal: '开场' }] }), 'full_scenes');

  // 2. outlineContext.chapter.scenes
  assert.equal(detectOutlineCompletenessTier({}, {
    chapter: { scenes: [{ id: 's1', goal: '破庙避雨' }] }
  }), 'full_scenes');

  // 3. outlineContext.meta.completenessTier
  assert.equal(detectOutlineCompletenessTier({}, {
    meta: { completenessTier: 'full_scenes' }
  }), 'full_scenes');
});

test('SP-Tier-02: detectOutlineCompletenessTier 准确识别 event_chain', () => {
  // 1. contract.beats 数组
  assert.equal(detectOutlineCompletenessTier({
    beats: ['初入秘境', '遭遇凶兽', '绝境反杀']
  }), 'event_chain');

  // 2. contract.eventChain 数组
  assert.equal(detectOutlineCompletenessTier({
    eventChain: ['潜入', '探查']
  }), 'event_chain');

  // 3. 5 维结构化节拍字段
  assert.equal(detectOutlineCompletenessTier({
    protagonistAction: '萧炎潜入药谷采摘药草',
    opposition: '遭到二阶魔兽赤尾蝎领地伏击',
    result: '凭借控火之术斩杀魔兽'
  }), 'event_chain');

  // 4. outlineContext.chapter.beats
  assert.equal(detectOutlineCompletenessTier({}, {
    chapter: { beats: ['出发', '交锋', '斩获'] }
  }), 'event_chain');
});

test('SP-Tier-03: detectOutlineCompletenessTier 准确识别 goal_only', () => {
  // 仅有 chapterGoal
  assert.equal(detectOutlineCompletenessTier({ chapterGoal: '通过一品炼药师考核' }), 'goal_only');

  // 仅有空大纲
  assert.equal(detectOutlineCompletenessTier({}, {}), 'goal_only');
});

test('SP-Tier-03B: detectOutlineCompletenessTier 支持封装参数返回完备度对象与 full_plan 别名', () => {
  // 1. 封装参数 full_scenes
  const r1 = detectOutlineCompletenessTier({
    contract: { scenes: [{ id: 'sc-1', goal: '萧家测验' }] },
    storyContext: {},
    request: {}
  });
  assert.equal(typeof r1, 'object');
  assert.equal(r1.tier, 'full_scenes');
  assert.equal(r1.tierAlias, 'full_plan');
  assert.equal(r1.full_scenes, true);
  assert.equal(r1.full_plan, true);
  assert.equal(r1.mode, 'authoritative_verified');
  assert.equal(r1.rawScenes.length, 1);

  // 2. 封装参数 event_chain
  const r2 = detectOutlineCompletenessTier({
    contract: { beats: ['前置行动', '交锋对决'] },
    storyContext: { chapterContext: {} }
  });
  assert.equal(r2.tier, 'event_chain');
  assert.equal(r2.mode, 'deterministic_derived');

  // 3. 封装参数 goal_only
  const r3 = detectOutlineCompletenessTier({
    contract: { chapterGoal: '通过考核' },
    request: { prompt: '通过考核' }
  });
  assert.equal(r3.tier, 'goal_only');
  assert.equal(r3.mode, 'lightweight_inferred');
  assert.equal(r3.goalText, '通过考核');
});


// ============================================================================
// Group 2: Tier 1 (full_scenes) 本地时空因果校验与转场增强
// ============================================================================

test('SP-Tier-04: validateAndEnforceFullScenePlan 校验时空跳跃并注入转场桥梁与留白', () => {
  const scenes = [
    { id: 's1', goal: '宗门大殿受辱', sceneType: 'action_conflict', location: '大殿' },
    { id: 's2', goal: '三日后来到后山密林潜心修炼', location: '后山密林' },
    { id: 's3', goal: '突破斗者瓶颈，领悟焚诀玄妙' }
  ];

  const plan = validateAndEnforceFullScenePlan(scenes, {
    targetWordCount: 2400
  });

  assert.equal(plan.valid, true);
  assert.equal(plan.tier, 'full_scenes');
  assert.equal(plan.freePlayPlot, false);
  assert.equal(plan.creativeLicense, false);
  assert.equal(plan.scenes.length, 3);

  // 场景 1: 首幕冲突具备动量守恒契约
  assert.ok(plan.scenes[0].actionMomentumDirective, '首幕动作冲突应注入动量守恒契约');

  // 场景 2: 检测到时空位移（“三日后” + 地点变更），成功注入转场桥梁
  assert.equal(plan.scenes[1].requiresTransitionBridge, true);
  assert.ok(plan.scenes[1].transitionBridgeDirective.includes('反过度平滑转场桥梁指令'));
  assert.ok(plan.transitionsAdded >= 1);

  // 场景 3: 中段/高潮后分配呼吸留白
  assert.equal(plan.scenes[2].allocateDowntime, true);
  assert.ok(plan.scenes[2].downtimeDirective.includes('呼吸留白指令'));
});

// ============================================================================
// Group 3: Tier 2 (event_chain) 5维节拍确定性推导与零捏造
// ============================================================================

test('SP-Tier-05: deriveScenesFromEventChain 依据 5 维节拍确定性推导场景卡', () => {
  const fiveBeats = {
    protagonistAction: '萧炎带上黑袍，独自潜入乌坦城特米尔拍卖行',
    opposition: '遭到门口护卫与管事的盘查轻视',
    informationChange: '雅妃察觉筑基灵液品质，态度剧变引出贵宾室密谈',
    result: '达成长期供药合作并拍得筑基残卷',
    hook: '加列家族二长老在街角暗中盯上黑袍人的背影'
  };

  const plan = deriveScenesFromEventChain(fiveBeats, {
    targetWordCount: 3000
  });

  assert.equal(plan.valid, true);
  assert.equal(plan.tier, 'event_chain');
  assert.equal(plan.freePlayPlot, false);
  assert.equal(plan.creativeLicense, false);
  assert.equal(plan.preservedEventCount, 5);
  assert.equal(plan.scenes.length, 5);

  // 验证 5 维节拍文本完整保留，零捏造
  assert.equal(plan.scenes[0].goal, fiveBeats.protagonistAction);
  assert.equal(plan.scenes[1].goal, fiveBeats.opposition);
  assert.equal(plan.scenes[2].goal, fiveBeats.informationChange);
  assert.equal(plan.scenes[3].goal, fiveBeats.result);
  assert.equal(plan.scenes[4].goal, fiveBeats.hook);

  // 验证场景类型与角色定位
  assert.equal(plan.scenes[2].sceneType, 'comprehension_turning');
  assert.equal(plan.scenes[4].sceneType, 'cliffhanger_reveal');
});

test('SP-Tier-06: deriveScenesFromEventChain 数组节拍确定性保真', () => {
  const beats = [
    '踏入云岚宗山门',
    '纳兰嫣然冷语相向立下誓约',
    '拔出玄重尺力压当场'
  ];

  const plan = deriveScenesFromEventChain(beats, { targetWordCount: 2400 });

  assert.equal(plan.tier, 'event_chain');
  assert.equal(plan.freePlayPlot, false);
  assert.equal(plan.scenes.length, 3);
  assert.equal(plan.scenes[0].goal, beats[0]);
  assert.equal(plan.scenes[1].goal, beats[1]);
  assert.equal(plan.scenes[2].goal, beats[2]);
});

// ============================================================================
// Group 4: Tier 3 (goal_only) 轻量三幕式推导与自由发挥标记
// ============================================================================

test('SP-Tier-07: inferLightweightScenePlan 轻量推导并显式记录自由发挥标记', () => {
  const plan = inferLightweightScenePlan('萧炎测验斗之气', {
    targetWordCount: 2400
  });

  assert.equal(plan.valid, true);
  assert.equal(plan.tier, 'goal_only');
  assert.equal(plan.freePlayPlot, true);
  assert.equal(plan.creativeLicense, true);
  assert.deepEqual(plan.creativeLicenseScope, [
    'scene_progression',
    'micro_conflict',
    'inferred_beats',
    'dialogue_expansion'
  ]);

  // 三幕式推导
  assert.equal(plan.scenes.length, 3);
  assert.equal(plan.scenes[0].act, 'act1_setup');
  assert.equal(plan.scenes[1].act, 'act2_confrontation');
  assert.equal(plan.scenes[2].act, 'act3_resolution_hook');

  // Prompt 渲染断言：包含 GOAL_ONLY 自由发挥声明与安全限制
  const rendered = compileSceneDirectives(plan);
  assert.ok(rendered.includes('规划模式: GOAL_ONLY'));
  assert.ok(rendered.includes('creativeLicense: true'));
  assert.ok(rendered.includes('【自由发挥因果安全限制 (Causal Guard)】'));
});

// ============================================================================
// Group 5: verifyCausalInvariants 因果硬围栏校验器
// ============================================================================

test('SP-Tier-08: verifyCausalInvariants 拦截 POV 视点越界', () => {
  const scenes = [
    { sceneIndex: 1, viewpointCharacter: '萧炎', goal: '萧炎走上测验台' },
    { sceneIndex: 2, viewpointCharacter: '纳兰嫣然', goal: '纳兰嫣然心生嫌弃并冷笑' }
  ];

  const contract = { viewpointCharacter: '萧炎' };
  const check = verifyCausalInvariants(scenes, contract);

  assert.equal(check.valid, false);
  assert.equal(check.violations.length, 1);
  assert.equal(check.violations[0].type, 'POV_VIOLATION');
  assert.ok(check.violations[0].message.includes('纳兰嫣然'));
});

test('SP-Tier-09: verifyCausalInvariants 拦截 mustNot 禁忌行为穿透', () => {
  const scenes = [
    { sceneIndex: 1, goal: '与加列奥当街交手' },
    { sceneIndex: 2, goal: '祭出异火使用骨灵冷火将对手瞬间重创' }
  ];

  const contract = {
    viewpointCharacter: '萧炎',
    mustNot: ['使用骨灵冷火', '暴露药老身份']
  };

  const check = verifyCausalInvariants(scenes, contract);

  assert.equal(check.valid, false);
  assert.equal(check.violations.length, 1);
  assert.equal(check.violations[0].type, 'MUST_NOT_VIOLATION');
  assert.ok(check.violations[0].message.includes('使用骨灵冷火'));
});

test('SP-Tier-10: verifyCausalInvariants 拦截未排期秘密泄露与未排期因果债务投机核销', () => {
  // 1. 秘密泄露
  const scenes1 = [
    { sceneIndex: 1, goal: '萧炎与药老交流' },
    { sceneIndex: 2, goal: '雅妃在隔壁提前识破药老灵魂体的秘密' }
  ];
  const contract1 = {
    forbiddenKnowledge: ['药老灵魂体']
  };
  const check1 = verifyCausalInvariants(scenes1, contract1);
  assert.equal(check1.valid, false);
  assert.equal(check1.violations[0].type, 'FORBIDDEN_KNOWLEDGE_LEAK');

  // 2. 未排期因果债务投机核销
  const scenes2 = [
    { sceneIndex: 1, goal: '购买灵药', resolvesDebt: 'debt_ring_ancient_secret' }
  ];
  const contract2 = {
    requiredPayoff: ['debt_market_herb']
  };
  const check2 = verifyCausalInvariants(scenes2, contract2);
  assert.equal(check2.valid, false);
  assert.equal(check2.violations[0].type, 'UNAUTHORIZED_DEBT_PAYOFF');
  assert.ok(check2.violations[0].message.includes('debt_ring_ancient_secret'));
});

test('SP-Tier-11: verifyCausalInvariants 拦截终局不可逆结果反向冲突', () => {
  // 合同要求“谈判失败隐忍遁走”，收尾场景却写成“大获全胜反杀全场”
  const scenes = [
    { sceneIndex: 1, goal: '双方谈判' },
    { sceneIndex: 2, goal: '当场大获全胜反杀全场秒杀所有人' }
  ];
  const contract = {
    irreversibleResult: '谈判失败受挫，立下三年之约后遁走'
  };

  const check = verifyCausalInvariants(scenes, contract);
  assert.equal(check.valid, false);
  assert.equal(check.violations.length, 1);
  assert.equal(check.violations[0].type, 'OUTCOME_MISALIGNMENT');
});

test('SP-Tier-12: verifyCausalInvariants 合规场景通过验证', () => {
  const scenes = [
    { sceneIndex: 1, viewpointCharacter: '萧炎', goal: '萧炎踏入考场' },
    { sceneIndex: 2, viewpointCharacter: '萧炎', goal: '萧炎精纯控火成丹', resolvesDebt: 'debt_exam_pass' }
  ];
  const contract = {
    viewpointCharacter: '萧炎',
    mustNot: ['击杀考官'],
    requiredPayoff: ['debt_exam_pass'],
    irreversibleResult: '成丹获胜通过一品考核'
  };

  const check = verifyCausalInvariants(scenes, contract);
  assert.equal(check.valid, true);
  assert.equal(check.violations.length, 0);
});

test('SP-Tier-12B: verifyCausalInvariants 支持 throwOnViolation 抛错与 autoPrune 自动因果剪枝自愈', () => {
  const contract = {
    viewpointCharacter: '萧炎',
    mustNot: ['施展骨灵冷火'],
    forbiddenKnowledge: ['药老灵魂体'],
    irreversibleResult: '失败受挫隐忍退避'
  };

  const offendingScenes = [
    { sceneIndex: 1, viewpointCharacter: '纳兰嫣然', goal: '纳兰嫣然冷眼相看' },
    { sceneIndex: 2, viewpointCharacter: '萧炎', goal: '萧炎施展骨灵冷火反击，雅妃提前识破药老灵魂体的秘密' },
    { sceneIndex: 3, viewpointCharacter: '萧炎', goal: '当场大获全胜彻底击溃全场秒杀所有人' }
  ];

  // 1. throwOnViolation 抛出 CausalInvariantViolationError
  assert.throws(() => {
    verifyCausalInvariants(offendingScenes, contract, { throwOnViolation: true });
  }, err => {
    assert.ok(err instanceof CausalInvariantViolationError);
    assert.equal(err.name, 'CausalInvariantViolationError');
    assert.equal(err.code, 'CAUSAL_INVARIANT_VIOLATION');
    assert.equal(err.status, 422);
    assert.ok(err.violations.length >= 3);
    return true;
  });

  // 2. autoPrune 自动因果剪枝自愈
  const pruneRes = verifyCausalInvariants(offendingScenes, contract, { autoPrune: true });
  assert.equal(pruneRes.autoPruned, true);
  assert.equal(pruneRes.prunedScenes.length, 3);
  // POV 矫正
  assert.equal(pruneRes.prunedScenes[0].viewpointCharacter, '萧炎');
  // mustNot 词汇剪枝
  assert.ok(!pruneRes.prunedScenes[1].goal.includes('施展骨灵冷火'));
  assert.ok(pruneRes.prunedScenes[1].goal.includes('[已剪枝禁忌动作]'));
  // 秘密泄露词汇保密
  assert.ok(!pruneRes.prunedScenes[1].goal.includes('药老灵魂体'));
  assert.ok(pruneRes.prunedScenes[1].goal.includes('[保密信息]'));
  // 终局对齐矫正
  assert.ok(pruneRes.prunedScenes[2].goal.includes('达成终局预期: 失败受挫隐忍退避'));
});

// ============================================================================
// Group 6: planScenesTiered 统一分级总入口
// ============================================================================

test('SP-Tier-13: planScenesTiered 统一入口分发三态并完成因果审计', () => {
  // 分发 Tier 1
  const t1 = planScenesTiered({
    contract: { scenes: [{ goal: '目标1' }] }
  });
  assert.equal(t1.tier, 'full_scenes');
  assert.equal(t1.causalInvariantsPassed, true);

  // 分发 Tier 2
  const t2 = planScenesTiered({
    contract: { beats: ['节拍A', '节拍B'] }
  });
  assert.equal(t2.tier, 'event_chain');
  assert.equal(t2.causalInvariantsPassed, true);

  // 分发 Tier 3
  const t3 = planScenesTiered({
    contract: { chapterGoal: '核心目标' }
  });
  assert.equal(t3.tier, 'goal_only');
  assert.equal(t3.freePlayPlot, true);
  assert.equal(t3.causalInvariantsPassed, true);
});

test('SP-Tier-13B: planScenesTiered 支持双参数传参并支持 throwOnViolation', () => {
  // 1. 双参数调用 (params, secondaryOptions)
  const result = planScenesTiered(
    { contract: { beats: ['踏入云岚宗', '大展神威'] } },
    { targetWordCount: 3600 }
  );
  assert.equal(result.tier, 'event_chain');
  assert.equal(result.scenes.length, 2);
  assert.equal(result.causalInvariantsPassed, true);

  // 2. throwOnViolation 违规直接抛出
  assert.throws(() => {
    planScenesTiered({
      contract: {
        mustNot: ['破坏丹炉'],
        scenes: [{ goal: '失手破坏丹炉导致炼丹失败' }]
      }
    }, { throwOnViolation: true });
  }, err => {
    assert.ok(err instanceof CausalInvariantViolationError);
    return true;
  });
});

// ============================================================================
// Group 7: Orchestrator 编排器三态分级端到端测试
// ============================================================================

test('SP-Tier-14: Orchestrator Tier 1 (full_scenes) 预声明场景严格 bypass 外部 planScenes', async testContext => {
  const { repository, store, cleanup } = setupTestEnvironment('molan-orch-t1-');
  testContext.after(cleanup);

  const scope = { workspaceId: 'ws-t1', projectId: 'proj-t1', actorUserId: 'author-t1' };
  const runId = 'run-tier-1-bypass';
  const chapterId = 'ch-t1';
  let planScenesCalled = false;

  const deps = {
    resolveGenre: async () => ({ status: 'resolved', genre: '武侠' }),
    resolveStyle: async () => ({ status: 'resolved', style: '飘逸' }),
    loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 's1', storyContext: { pov: 'third-limited' } }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 's1' }),
    planScenes: async () => {
      planScenesCalled = true;
      return [];
    },
    writer: async ({ contract, contextPlan }) => ({
      text: '萧炎紧握铁拳，昂首步入大厅。',
      manifest: buildGenerationManifest({
        generationId: runId,
        projectId: scope.projectId,
        chapterId,
        pipelineVersion: 'content-engine-v2',
        contextHash: contextPlan.contextHash,
        contractHash: contractHash(contract),
        promptHash: 'p1',
        outputHash: hashValue('萧炎紧握铁拳，昂首步入大厅。')
      })
    }),
    deterministicAudit: async () => ({ passed: true, issues: [] }),
    semanticAudit: async () => ({ passed: true, status: 'MEASURED', issues: [] }),
    qualityAudit: async ({ draft }) => createQualityAssessment({
      genre: '武侠',
      contentDigest: hashValue(draft),
      compliance: { passed: true, checks: {} },
      literary: {
        passed: true,
        score: 0.88,
        confidence: 0.90,
        evaluator: { mode: 'single' },
        dimensions: {
          language: { score: 0.88, confidence: 0.90, status: 'MEASURED', source: 'literary_evaluator', quote: draft.slice(0, 4) }
        }
      }
    })
  };

  const orchestrator = createGenerationOrchestrator({ store, db: repository, dependencies: deps });
  const created = await orchestrator.create({
    ...scope,
    id: runId,
    chapterId,
    idempotencyKey: 'idem-t1',
    requestHash: '3'.repeat(64),
    request: {
      chapterId,
      chapterContract: {
        chapterId,
        chapterGoal: '魔石碑考核',
        scenes: [{ id: 's1', goal: '步入大厅' }, { id: 's2', goal: '三日后登上测验台' }]
      }
    }
  });

  let finalRun = null;
  for (let i = 0; i < 60; i++) {
    finalRun = await store.getRun({}, { ...scope, id: created.run.id });
    if (finalRun && (finalRun.state === 'waiting_author' || isTerminal(finalRun.state))) break;
    await new Promise(r => setTimeout(r, 20));
  }

  assert.ok(finalRun);
  assert.equal(finalRun.state, 'waiting_author');
  assert.equal(planScenesCalled, false, 'Pre-declared scenes must strictly bypass external planScenes LLM call');
  assert.equal(finalRun.result.contextPlan.scenePlanningTier, 'full_scenes');
  assert.equal(finalRun.result.contextPlan.freePlayPlot, false);
});

test('SP-Tier-15: Orchestrator Tier 2 (event_chain) 确定性推导并透传 scenePlanningTier', async testContext => {
  const { repository, store, cleanup } = setupTestEnvironment('molan-orch-t2-');
  testContext.after(cleanup);

  const scope = { workspaceId: 'ws-t2', projectId: 'proj-t2', actorUserId: 'author-t2' };
  const runId = 'run-tier-2-events';
  const chapterId = 'ch-t2';

  const deps = {
    resolveGenre: async () => ({ status: 'resolved', genre: '武侠' }),
    resolveStyle: async () => ({ status: 'resolved', style: '飘逸' }),
    loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 's2', storyContext: { pov: 'third-limited' } }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 's2' }),
    writer: async ({ contract, contextPlan }) => ({
      text: '炼药师工会的大门敞开，药香扑鼻。',
      manifest: buildGenerationManifest({
        generationId: runId,
        projectId: scope.projectId,
        chapterId,
        pipelineVersion: 'content-engine-v2',
        contextHash: contextPlan.contextHash,
        contractHash: contractHash(contract),
        promptHash: 'p2',
        outputHash: hashValue('炼药师工会的大门敞开，药香扑鼻。')
      })
    }),
    deterministicAudit: async () => ({ passed: true, issues: [] }),
    semanticAudit: async () => ({ passed: true, status: 'MEASURED', issues: [] }),
    qualityAudit: async ({ draft }) => createQualityAssessment({
      genre: '武侠',
      contentDigest: hashValue(draft),
      compliance: { passed: true, checks: {} },
      literary: {
        passed: true,
        score: 0.85,
        confidence: 0.88,
        evaluator: { mode: 'single' },
        dimensions: {
          language: { score: 0.85, confidence: 0.88, status: 'MEASURED', source: 'literary_evaluator', quote: draft.slice(0, 4) }
        }
      }
    })
  };

  const orchestrator = createGenerationOrchestrator({ store, db: repository, dependencies: deps });
  const created = await orchestrator.create({
    ...scope,
    id: runId,
    chapterId,
    idempotencyKey: 'idem-t2',
    requestHash: '4'.repeat(64),
    request: {
      chapterId,
      chapterContract: {
        chapterId,
        chapterGoal: '考核一品炼药师',
        beats: ['抵达工会', '展现控火', '成功成丹']
      }
    }
  });

  let finalRun = null;
  for (let i = 0; i < 60; i++) {
    finalRun = await store.getRun({}, { ...scope, id: created.run.id });
    if (finalRun && (finalRun.state === 'waiting_author' || isTerminal(finalRun.state))) break;
    await new Promise(r => setTimeout(r, 20));
  }

  assert.ok(finalRun);
  assert.equal(finalRun.state, 'waiting_author');
  assert.equal(finalRun.result.contextPlan.scenePlanningTier, 'event_chain');
  assert.equal(finalRun.result.contextPlan.freePlayPlot, false);
  assert.equal(finalRun.result.contextPlan.creativeLicense, false);
});

test('SP-Tier-16: Orchestrator Tier 3 (goal_only) 轻量推导并标记 freePlayPlot & creativeLicense', async testContext => {
  const { repository, store, cleanup } = setupTestEnvironment('molan-orch-t3-');
  testContext.after(cleanup);

  const scope = { workspaceId: 'ws-t3', projectId: 'proj-t3', actorUserId: 'author-t3' };
  const runId = 'run-tier-3-goal';
  const chapterId = 'ch-t3';

  const deps = {
    resolveGenre: async () => ({ status: 'resolved', genre: '武侠' }),
    resolveStyle: async () => ({ status: 'resolved', style: '飘逸' }),
    loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 's3', storyContext: { pov: 'third-limited' } }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 's3' }),
    writer: async ({ contract, contextPlan }) => ({
      text: '魔石碑前，金光璀璨。',
      manifest: buildGenerationManifest({
        generationId: runId,
        projectId: scope.projectId,
        chapterId,
        pipelineVersion: 'content-engine-v2',
        contextHash: contextPlan.contextHash,
        contractHash: contractHash(contract),
        promptHash: 'p3',
        outputHash: hashValue('魔石碑前，金光璀璨。')
      })
    }),
    deterministicAudit: async () => ({ passed: true, issues: [] }),
    semanticAudit: async () => ({ passed: true, status: 'MEASURED', issues: [] }),
    qualityAudit: async ({ draft }) => createQualityAssessment({
      genre: '武侠',
      contentDigest: hashValue(draft),
      compliance: { passed: true, checks: {} },
      literary: {
        passed: true,
        score: 0.82,
        confidence: 0.85,
        evaluator: { mode: 'single' },
        dimensions: {
          language: { score: 0.82, confidence: 0.85, status: 'MEASURED', source: 'literary_evaluator', quote: draft.slice(0, 4) }
        }
      }
    })
  };

  const orchestrator = createGenerationOrchestrator({ store, db: repository, dependencies: deps });
  const created = await orchestrator.create({
    ...scope,
    id: runId,
    chapterId,
    idempotencyKey: 'idem-t3',
    requestHash: '5'.repeat(64),
    request: {
      chapterId,
      chapterContract: {
        chapterId,
        chapterGoal: '魔石碑测验斗之气'
      }
    }
  });

  let finalRun = null;
  for (let i = 0; i < 60; i++) {
    finalRun = await store.getRun({}, { ...scope, id: created.run.id });
    if (finalRun && (finalRun.state === 'waiting_author' || isTerminal(finalRun.state))) break;
    await new Promise(r => setTimeout(r, 20));
  }

  assert.ok(finalRun);
  assert.equal(finalRun.state, 'waiting_author');
  assert.equal(finalRun.result.contextPlan.scenePlanningTier, 'goal_only');
  assert.equal(finalRun.result.contextPlan.freePlayPlot, true);
  assert.equal(finalRun.result.contextPlan.creativeLicense, true);
});

test('SP-Tier-17: Orchestrator 因果硬围栏违规拦截并抛出 CAUSAL_INVARIANT_VIOLATION 失败', async testContext => {
  const { repository, store, cleanup } = setupTestEnvironment('molan-orch-causal-err-');
  testContext.after(cleanup);

  const scope = { workspaceId: 'ws-causal', projectId: 'proj-causal', actorUserId: 'author-causal' };
  const runId = 'run-causal-violation';
  const chapterId = 'ch-causal';

  const deps = {
    resolveGenre: async () => ({ status: 'resolved', genre: '玄幻' }),
    resolveStyle: async () => ({ status: 'resolved', style: '热血' }),
    loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 'sc1', storyContext: {} }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 'sc1' }),
    planScenes: async () => [
      { id: 's1', goal: '踏入大厅' },
      // 违规：场景触犯了合同中的 mustNot 禁忌规则
      { id: 's2', goal: '当众施展骨灵冷火将大厅焚毁' }
    ],
    writer: async () => ({ text: '正文' })
  };

  const orchestrator = createGenerationOrchestrator({ store, db: repository, dependencies: deps });
  const created = await orchestrator.create({
    ...scope,
    id: runId,
    chapterId,
    idempotencyKey: 'idem-causal-err',
    requestHash: '6'.repeat(64),
    request: {
      chapterId,
      chapterContract: {
        chapterId,
        chapterGoal: '考核测试',
        mustNot: ['施展骨灵冷火']
      }
    }
  });

  let finalRun = null;
  for (let i = 0; i < 60; i++) {
    finalRun = await store.getRun({}, { ...scope, id: created.run.id });
    if (finalRun && (finalRun.state === 'failed' || isTerminal(finalRun.state))) break;
    await new Promise(r => setTimeout(r, 20));
  }

  assert.ok(finalRun);
  assert.equal(finalRun.state, 'failed', '因果硬围栏违规必须阻断生成并进入 failed 状态');
  assert.equal(finalRun.errorCode, 'CAUSAL_INVARIANT_VIOLATION', '错误码必须指示因果硬约束违背');
  assert.ok(finalRun.errorDetail.includes('因果硬约束') || finalRun.errorDetail.includes('施展骨灵冷火'));
});

test('SP-Tier-18: Orchestrator 预声明场景 (full_scenes) 触犯 mustNot 禁忌因果硬围栏时立即强阻断', async testContext => {
  const { repository, store, cleanup } = setupTestEnvironment('molan-orch-full-causal-');
  testContext.after(cleanup);

  const scope = { workspaceId: 'ws-full-c', projectId: 'proj-full-c', actorUserId: 'author-full-c' };
  const runId = 'run-full-causal-violation';
  const chapterId = 'ch-full-causal';

  const deps = {
    resolveGenre: async () => ({ status: 'resolved', genre: '玄幻' }),
    resolveStyle: async () => ({ status: 'resolved', style: '热血' }),
    loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 'sfc1', storyContext: {} }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 'sfc1' }),
    writer: async () => ({ text: '正文' })
  };

  const orchestrator = createGenerationOrchestrator({ store, db: repository, dependencies: deps });
  const created = await orchestrator.create({
    ...scope,
    id: runId,
    chapterId,
    idempotencyKey: 'idem-full-causal',
    requestHash: '7'.repeat(64),
    request: {
      chapterId,
      chapterContract: {
        chapterId,
        chapterGoal: '魔药提炼',
        mustNot: ['击碎药鼎'],
        scenes: [
          { id: 's1', goal: '点燃炉火' },
          { id: 's2', goal: '失控暴怒之下击碎药鼎' }
        ]
      }
    }
  });

  let finalRun = null;
  for (let i = 0; i < 60; i++) {
    finalRun = await store.getRun({}, { ...scope, id: created.run.id });
    if (finalRun && (finalRun.state === 'failed' || isTerminal(finalRun.state))) break;
    await new Promise(r => setTimeout(r, 20));
  }

  assert.ok(finalRun);
  assert.equal(finalRun.state, 'failed', '预声明场景违规亦必须阻断生成并进入 failed 状态');
  assert.equal(finalRun.errorCode, 'CAUSAL_INVARIANT_VIOLATION');
  assert.ok(finalRun.errorDetail.includes('击碎药鼎'));
});

test('SP-Tier-19: Orchestrator stage 元数据显式记录 causalInvariants 并沉淀至 contextPlan', async testContext => {
  const { repository, store, cleanup } = setupTestEnvironment('molan-orch-stage-meta-');
  testContext.after(cleanup);

  const scope = { workspaceId: 'ws-sm', projectId: 'proj-sm', actorUserId: 'author-sm' };
  const runId = 'run-stage-meta-audit';
  const chapterId = 'ch-sm';

  const deps = {
    resolveGenre: async () => ({ status: 'resolved', genre: '武侠' }),
    resolveStyle: async () => ({ status: 'resolved', style: '飘逸' }),
    loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 'ssm1', storyContext: { pov: 'third-limited' } }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 'ssm1' }),
    writer: async ({ contract, contextPlan }) => ({
      text: '清风徐来，水波不兴。',
      manifest: buildGenerationManifest({
        generationId: runId,
        projectId: scope.projectId,
        chapterId,
        pipelineVersion: 'content-engine-v2',
        contextHash: contextPlan.contextHash,
        contractHash: contractHash(contract),
        promptHash: 'psm',
        outputHash: hashValue('清风徐来，水波不兴。')
      })
    }),
    deterministicAudit: async () => ({ passed: true, issues: [] }),
    semanticAudit: async () => ({ passed: true, status: 'MEASURED', issues: [] }),
    qualityAudit: async ({ draft }) => createQualityAssessment({
      genre: '武侠',
      contentDigest: hashValue(draft),
      compliance: { passed: true, checks: {} },
      literary: {
        passed: true,
        score: 0.88,
        confidence: 0.90,
        evaluator: { mode: 'single' },
        dimensions: {
          language: { score: 0.88, confidence: 0.90, status: 'MEASURED', source: 'literary_evaluator', quote: draft.slice(0, 4) }
        }
      }
    })
  };

  const orchestrator = createGenerationOrchestrator({ store, db: repository, dependencies: deps });
  const created = await orchestrator.create({
    ...scope,
    id: runId,
    chapterId,
    idempotencyKey: 'idem-sm',
    requestHash: '8'.repeat(64),
    request: {
      chapterId,
      chapterContract: {
        chapterId,
        chapterGoal: '江畔悟道',
        viewpointCharacter: '张三丰',
        scenes: [{ id: 's1', goal: '静坐听潮', viewpointCharacter: '张三丰' }]
      }
    }
  });

  let finalRun = null;
  for (let i = 0; i < 60; i++) {
    finalRun = await store.getRun({}, { ...scope, id: created.run.id });
    if (finalRun && (finalRun.state === 'waiting_author' || isTerminal(finalRun.state))) break;
    await new Promise(r => setTimeout(r, 20));
  }

  assert.ok(finalRun);
  assert.equal(finalRun.state, 'waiting_author');

  // 验证 contextPlan 沉淀
  const cp = finalRun.result.contextPlan;
  assert.equal(cp.scenePlanningTier, 'full_scenes');
  assert.equal(cp.freePlayPlot, false);
  assert.equal(cp.creativeLicense, false);
  assert.equal(cp.causalInvariantsPassed, true);

  // 验证 store.listStages 中的 scene_planning 阶段记录
  const stages = await store.listStages(repository, { ...scope, generationId: created.run.id });
  const planningStage = stages.find(s => s.stage === 'scene_planning');
  assert.ok(planningStage, '必须存在 scene_planning 阶段记录');
  assert.equal(planningStage.status, 'completed', 'scene_planning 状态必须为 completed');
  assert.ok(planningStage.outputHash, 'scene_planning 必须具备场景 outputHash 证据');
});

// ============================================================================
// Group 6: M2 Hardening Remediation (BUG-SP-001 & BUG-SP-002 & Invariant Guards)
// ============================================================================

test('SP-Hardening-01: BUG-SP-001 空白/null/稀疏节拍优雅降级至 goal_only 且 deriveScenes 防御防崩', () => {
  // 1. detectOutlineCompletenessTier 空节拍降级
  assert.equal(detectOutlineCompletenessTier({ beats: [null] }), 'goal_only');
  assert.equal(detectOutlineCompletenessTier({ beats: ['', '   '] }), 'goal_only');
  assert.equal(detectOutlineCompletenessTier({ beats: [{ text: '' }] }), 'goal_only');

  // 2. deriveScenesFromEventChain 防御性执行不抛出 TypeError
  const derived = deriveScenesFromEventChain([null, undefined, { text: '有效节拍' }, '']);
  assert.ok(derived);
  assert.equal(derived.tier, 'event_chain');
  assert.equal(derived.scenes.length, 1);
  assert.equal(derived.scenes[0].goal, '有效节拍');

  // 3. planScenesTiered 遇到 sparse beats 不崩盘
  const plan = planScenesTiered({ contract: { beats: [null, '   '] } });
  assert.ok(plan);
  assert.equal(plan.tier, 'goal_only');
  assert.equal(plan.freePlayPlot, true);
});

test('SP-Hardening-02: BUG-SP-002 autoPrune 全字段清洗盲区闭环且二次因果校验通过', () => {
  const contract = {
    viewpointCharacter: '韩立',
    mustNot: ['使用掌天瓶催熟灵药'],
    forbiddenKnowledge: ['掌天瓶可吸收月华'],
    requiredPayoff: ['debt_herb_seed']
  };

  const dirtyScenes = [
    {
      sceneIndex: 1,
      viewpointCharacter: '韩立',
      goal: '韩立假意买药',
      rawNodeText: '暗中计划使用掌天瓶催熟灵药，且意外被察觉掌天瓶可吸收月华的隐秘',
      action: '私下使用掌天瓶催熟灵药',
      description: '动作隐蔽，使用掌天瓶催熟灵药',
      resolvesDebt: 'debt_unauthorized_fake'
    }
  ];

  const pruneRes = verifyCausalInvariants(dirtyScenes, contract, { autoPrune: true });
  assert.equal(pruneRes.autoPruned, true);
  const s = pruneRes.scenes[0];

  // 验证全字段清洗
  assert.ok(!s.rawNodeText.includes('使用掌天瓶催熟灵药'));
  assert.ok(!s.rawNodeText.includes('掌天瓶可吸收月华'));
  assert.ok(!s.action.includes('使用掌天瓶催熟灵药'));
  assert.ok(!s.description.includes('使用掌天瓶催熟灵药'));
  assert.equal(s.resolvesDebt, undefined, '未排期因果债务必须被安全清除');

  // 二次校验真值断言
  const recheck = verifyCausalInvariants(pruneRes.scenes, contract);
  assert.equal(recheck.valid, true, '清洗后二次校验必须 100% 通过');
});

test('SP-Hardening-03: POV 视点归一化校验与子串绕过拦截', () => {
  const contract = { viewpointCharacter: '罗峰' };

  // 1. 规范合法视点后缀（视角/视点）正常通过
  const validScenes = [
    { sceneIndex: 1, viewpointCharacter: '罗峰视角', goal: '罗峰潜入基地' },
    { sceneIndex: 2, viewpointCharacter: '罗峰视点', goal: '领悟刀意' }
  ];
  const validCheck = verifyCausalInvariants(validScenes, contract);
  assert.equal(validCheck.valid, true);

  // 2. 敌对第三方视点即便包含主角名字也严格拦截
  const hostileScenes = [
    { sceneIndex: 1, viewpointCharacter: '击杀罗峰的李耀视点', goal: '狙击' },
    { sceneIndex: 2, viewpointCharacter: '李耀（审视罗峰视角）', goal: '复仇' }
  ];
  const hostileCheck = verifyCausalInvariants(hostileScenes, contract);
  assert.equal(hostileCheck.valid, false);
  assert.equal(hostileCheck.violations.length, 2);
  assert.equal(hostileCheck.violations[0].type, 'POV_VIOLATION');
  assert.equal(hostileCheck.violations[1].type, 'POV_VIOLATION');
});

test('SP-Hardening-04: 泄密动词库全面扩充 (透露/曝光/公布/公开/偷听/窥见/目睹/告知)', () => {
  const contract = { forbiddenKnowledge: ['金角巨兽幼崽'] };
  const expandedVerbs = [
    '徐欣当面透露了金角巨兽幼崽',
    '极限武馆暗中曝光了金角巨兽幼崽',
    '军方提前公布金角巨兽幼崽',
    '洪当众公开金角巨兽幼崽',
    '李耀偷听到了金角巨兽幼崽',
    '雷神暗中窥见了金角巨兽幼崽',
    '众人目睹金角巨兽幼崽',
    '巴巴塔直接告知金角巨兽幼崽'
  ];

  for (const text of expandedVerbs) {
    const res = verifyCausalInvariants([{ sceneIndex: 1, goal: text }], contract);
    assert.equal(res.valid, false, `必须拦截动词泄露: ${text}`);
    assert.equal(res.violations[0].type, 'FORBIDDEN_KNOWLEDGE_LEAK');
  }
});

test('SP-Hardening-05: 契约输入防御性归一化 (字符串与带空格数组)', () => {
  // 1. mustNot 为字符串且带空格
  const res1 = verifyCausalInvariants(
    [{ sceneIndex: 1, goal: '违规出手抢夺宝物' }],
    { mustNot: ' 抢夺宝物 ' }
  );
  assert.equal(res1.valid, false);
  assert.equal(res1.violations[0].type, 'MUST_NOT_VIOLATION');
  assert.equal(res1.violations[0].forbidden, '抢夺宝物');

  // 2. forbiddenKnowledge 为字符串且带空格
  const res2 = verifyCausalInvariants(
    [{ sceneIndex: 1, goal: '探子发现夺舍秘法' }],
    { forbiddenKnowledge: ' 夺舍秘法 ' }
  );
  assert.equal(res2.valid, false);
  assert.equal(res2.violations[0].type, 'FORBIDDEN_KNOWLEDGE_LEAK');
  assert.equal(res2.violations[0].secret, '夺舍秘法');
});

