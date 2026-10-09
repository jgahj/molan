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
  planScenes
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
