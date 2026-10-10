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
  CausalInvariantViolationError
} = require('../lib/scene-planner');

const { createGenerationOrchestrator } = require('../lib/generation/orchestrator');
const { createJsonGenerationStore } = require('../lib/generation/json-store');
const { JsonFileRepository } = require('../lib/repositories/json-file-repository');
const { contractHash } = require('../lib/generation/contract');
const { buildGenerationManifest, hashValue } = require('../lib/generation/manifest');
const { isTerminal } = require('../lib/generation/state-machine');

function setupTestEnvironment(prefix = 'molan-causal-adv-') {
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
// SUITE 1: POV Boundary Interception & Adversarial Substring Evasion
// ============================================================================

test('ADV-M2-POV-01: verifyCausalInvariants catches straightforward POV mismatch', () => {
  const scenes = [
    { sceneIndex: 1, viewpointCharacter: '纳兰嫣然', goal: '纳兰嫣然冷眼相待' }
  ];
  const contract = { viewpointCharacter: '萧炎' };
  const check = verifyCausalInvariants(scenes, contract);

  assert.equal(check.valid, false);
  assert.equal(check.violations.length, 1);
  assert.equal(check.violations[0].type, 'POV_VIOLATION');
});

test('ADV-M2-POV-02 [HARDENED]: Substring inclusion in scenePov is strictly intercepted (no evasion)', () => {
  // If viewpointCharacter is '萧炎', and an antagonist POV explicitly mentions '萧炎',
  // e.g. '击杀萧炎的神秘人视角' or '反派针对萧炎视点',
  // normalized POV strictly detects mismatch and flags POV_VIOLATION!
  const scenes = [
    { sceneIndex: 1, viewpointCharacter: '击杀萧炎的神秘人视角', goal: '暗中搭弓射箭' },
    { sceneIndex: 2, viewpointCharacter: '纳兰嫣然（审视萧炎视角）', goal: '嫌弃退婚' }
  ];
  const contract = { viewpointCharacter: '萧炎' };
  const check = verifyCausalInvariants(scenes, contract);

  assert.equal(check.valid, false);
  assert.equal(check.violations.length, 2);
  assert.equal(check.violations[0].type, 'POV_VIOLATION');
  assert.equal(check.violations[1].type, 'POV_VIOLATION');
});

test('ADV-M2-POV-03 [VULNERABILITY]: Omitted viewpointCharacter on scene avoids POV verification', () => {
  // Scenes often only have goal without explicit viewpointCharacter property
  const scenes = [
    { sceneIndex: 1, goal: '纳兰嫣然以第一人称展开极度轻蔑的内心独白，怨恨萧炎' }
  ];
  const contract = { viewpointCharacter: '萧炎' };
  const check = verifyCausalInvariants(scenes, contract);

  // Because s.viewpointCharacter is undefined, check is skipped
  assert.equal(check.valid, true, 'Omitted scene viewpointCharacter completely bypasses POV check');
});

// ============================================================================
// SUITE 2: mustNot Forbidden Behavior Interception & Evasions
// ============================================================================

test('ADV-M2-MUSTNOT-01: Exact substring mustNot violation is reliably intercepted', () => {
  const scenes = [
    { sceneIndex: 1, goal: '萧炎在广场上当众施展骨灵冷火' }
  ];
  const contract = { mustNot: ['施展骨灵冷火'] };
  const check = verifyCausalInvariants(scenes, contract);

  assert.equal(check.valid, false);
  assert.equal(check.violations[0].type, 'MUST_NOT_VIOLATION');
  assert.equal(check.violations[0].forbidden, '施展骨灵冷火');
});

test('ADV-M2-MUSTNOT-02 [HARDENED]: String mustNot in contract is normalized and enforced', () => {
  // If user or template passes mustNot as a string instead of an array
  const scenes = [
    { sceneIndex: 1, goal: '萧炎直接击杀药殿执事' }
  ];
  const contract = { mustNot: '击杀药殿执事' };
  const check = verifyCausalInvariants(scenes, contract);

  assert.equal(check.valid, false);
  assert.equal(check.violations.length, 1);
  assert.equal(check.violations[0].type, 'MUST_NOT_VIOLATION');
  assert.equal(check.violations[0].forbidden, '击杀药殿执事');
});

test('ADV-M2-MUSTNOT-03 [HARDENED]: Untrimmed whitespace in contract mustNot is trimmed and matches', () => {
  const scenes = [
    { sceneIndex: 1, goal: '萧炎施展骨灵冷火' }
  ];
  const contract = { mustNot: [' 施展骨灵冷火 '] }; // untrimmed item
  const check = verifyCausalInvariants(scenes, contract);

  assert.equal(check.valid, false);
  assert.equal(check.violations.length, 1);
  assert.equal(check.violations[0].type, 'MUST_NOT_VIOLATION');
  assert.equal(check.violations[0].forbidden, '施展骨灵冷火');
});

test('ADV-M2-MUSTNOT-04 [VULNERABILITY]: Whitespace padding or casing in scene text bypasses check', () => {
  // Evasion via whitespace insertion
  const scenes1 = [
    { sceneIndex: 1, goal: '萧炎 施 展 骨 灵 冷 火 破局' }
  ];
  const check1 = verifyCausalInvariants(scenes1, { mustNot: ['施展骨灵冷火'] });
  assert.equal(check1.valid, true, 'Whitespace-padded forbidden act bypasses substring search');

  // Evasion via casing
  const scenes2 = [
    { sceneIndex: 1, goal: 'Xiao Yan decides to KILL the referee' }
  ];
  const check2 = verifyCausalInvariants(scenes2, { mustNot: ['kill the referee'] });
  assert.equal(check2.valid, true, 'Different casing bypasses exact substring search');
});

test('ADV-M2-MUSTNOT-05 [VULNERABILITY]: Prohibited act in alternate scene fields (content, plot, details, subscenes) is missed', () => {
  const scenes = [
    {
      sceneIndex: 1,
      goal: '普通比试',
      content: '暗中施展骨灵冷火',
      plot: '焚烧对手',
      details: '毁灭证据',
      subscenes: [{ goal: '施展骨灵冷火' }]
    }
  ];
  const contract = { mustNot: ['施展骨灵冷火'] };
  const check = verifyCausalInvariants(scenes, contract);

  assert.equal(check.valid, true, 'Forbidden action hidden in non-checked fields/subscenes is bypassed');
});

// ============================================================================
// SUITE 3: Secret Leakage (forbiddenKnowledge) Interception & Gaps
// ============================================================================

test('ADV-M2-LEAK-01: Secret leakage with standard verb is caught', () => {
  const scenes = [
    { sceneIndex: 1, goal: '雅妃在隔壁识破药老灵魂体的秘密' }
  ];
  const contract = { forbiddenKnowledge: ['药老灵魂体'] };
  const check = verifyCausalInvariants(scenes, contract);

  assert.equal(check.valid, false);
  assert.equal(check.violations[0].type, 'FORBIDDEN_KNOWLEDGE_LEAK');
});

test('ADV-M2-LEAK-02 [HARDENED]: Expanded revelation verbs strictly intercept secret disclosures', () => {
  // Verbs like '曝光', '透露', '公布', '公开', '偷听', '窥见', '目睹', '告知' are caught
  const evasionVerbs = [
    '雅妃当众曝光了药老灵魂体',
    '萧炎当面透露了药老灵魂体的存在',
    '加列家族公布药老灵魂体的情报',
    '暗中公开药老灵魂体',
    '雅妃在窗外偷听到了药老灵魂体',
    '探子暗中窥见药老灵魂体',
    '众人当场目睹药老灵魂体',
    '直接告知药老灵魂体'
  ];

  for (const text of evasionVerbs) {
    const check = verifyCausalInvariants([{ sceneIndex: 1, goal: text }], { forbiddenKnowledge: ['药老灵魂体'] });
    assert.equal(check.valid, false, `Secret leak must be caught with verb in phrase: "${text}"`);
    assert.equal(check.violations[0].type, 'FORBIDDEN_KNOWLEDGE_LEAK');
  }
});

test('ADV-M2-LEAK-03 [HARDENED]: String forbiddenKnowledge in contract is normalized and enforced', () => {
  const scenes = [
    { sceneIndex: 1, goal: '雅妃发现药老灵魂体' }
  ];
  const contract = { forbiddenKnowledge: '药老灵魂体' };
  const check = verifyCausalInvariants(scenes, contract);

  assert.equal(check.valid, false);
  assert.equal(check.violations.length, 1);
  assert.equal(check.violations[0].type, 'FORBIDDEN_KNOWLEDGE_LEAK');
  assert.equal(check.violations[0].secret, '药老灵魂体');
});

// ============================================================================
// SUITE 4: Orchestrator scene_planning Hard Invariant Guardrail Verification
// ============================================================================

test('ADV-M2-ORCH-01: Orchestrator full_scenes with mustNot violation throws CAUSAL_INVARIANT_VIOLATION', async testContext => {
  const { repository, store, cleanup } = setupTestEnvironment('orch-adv-fs-');
  testContext.after(cleanup);

  const scope = { workspaceId: 'ws-adv-1', projectId: 'p-adv-1', actorUserId: 'u-adv-1' };
  const runId = 'run-adv-fs-viol';

  const deps = {
    resolveGenre: async () => ({ status: 'resolved', genre: '玄幻' }),
    resolveStyle: async () => ({ status: 'resolved', style: '热血' }),
    loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 's1', storyContext: {} }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 's1' }),
    writer: async () => ({ text: '正文' })
  };

  const orchestrator = createGenerationOrchestrator({ store, db: repository, dependencies: deps });
  const created = await orchestrator.create({
    ...scope,
    id: runId,
    chapterId: 'ch-1',
    idempotencyKey: 'idem-fs',
    requestHash: '1'.repeat(64),
    request: {
      chapterId: 'ch-1',
      chapterContract: {
        chapterId: 'ch-1',
        chapterGoal: '炼丹测试',
        mustNot: ['击碎药鼎'],
        scenes: [
          { id: 's1', goal: '点燃炉火' },
          { id: 's2', goal: '暴怒之下击碎药鼎' }
        ]
      }
    }
  });

  let finalRun = null;
  for (let i = 0; i < 40; i++) {
    finalRun = await store.getRun({}, { ...scope, id: created.run.id });
    if (finalRun && (finalRun.state === 'failed' || isTerminal(finalRun.state))) break;
    await new Promise(r => setTimeout(r, 20));
  }

  assert.ok(finalRun);
  assert.equal(finalRun.state, 'failed');
  assert.equal(finalRun.errorCode, 'CAUSAL_INVARIANT_VIOLATION');
  assert.ok(finalRun.errorDetail.includes('击碎药鼎'));
});

test('ADV-M2-ORCH-02: Orchestrator event_chain with mustNot violation throws CAUSAL_INVARIANT_VIOLATION', async testContext => {
  const { repository, store, cleanup } = setupTestEnvironment('orch-adv-ec-');
  testContext.after(cleanup);

  const scope = { workspaceId: 'ws-adv-2', projectId: 'p-adv-2', actorUserId: 'u-adv-2' };
  const runId = 'run-adv-ec-viol';

  const deps = {
    resolveGenre: async () => ({ status: 'resolved', genre: '玄幻' }),
    resolveStyle: async () => ({ status: 'resolved', style: '热血' }),
    loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 's2', storyContext: {} }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 's2' }),
    writer: async () => ({ text: '正文' })
  };

  const orchestrator = createGenerationOrchestrator({ store, db: repository, dependencies: deps });
  const created = await orchestrator.create({
    ...scope,
    id: runId,
    chapterId: 'ch-2',
    idempotencyKey: 'idem-ec',
    requestHash: '2'.repeat(64),
    request: {
      chapterId: 'ch-2',
      chapterContract: {
        chapterId: 'ch-2',
        chapterGoal: '擂台对决',
        mustNot: ['使用暗器'],
        beats: [
          '萧炎登台',
          '遭遇猛烈攻势',
          '暗中偷偷使用暗器伤人'
        ]
      }
    }
  });

  let finalRun = null;
  for (let i = 0; i < 40; i++) {
    finalRun = await store.getRun({}, { ...scope, id: created.run.id });
    if (finalRun && (finalRun.state === 'failed' || isTerminal(finalRun.state))) break;
    await new Promise(r => setTimeout(r, 20));
  }

  assert.ok(finalRun);
  assert.equal(finalRun.state, 'failed');
  assert.equal(finalRun.errorCode, 'CAUSAL_INVARIANT_VIOLATION');
  assert.ok(finalRun.errorDetail.includes('使用暗器'));
});

test('ADV-M2-ORCH-03: Orchestrator goal_only with mustNot violation throws CAUSAL_INVARIANT_VIOLATION', async testContext => {
  const { repository, store, cleanup } = setupTestEnvironment('orch-adv-go-');
  testContext.after(cleanup);

  const scope = { workspaceId: 'ws-adv-3', projectId: 'p-adv-3', actorUserId: 'u-adv-3' };
  const runId = 'run-adv-go-viol';

  const deps = {
    resolveGenre: async () => ({ status: 'resolved', genre: '玄幻' }),
    resolveStyle: async () => ({ status: 'resolved', style: '热血' }),
    loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 's3', storyContext: {} }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 's3' }),
    writer: async () => ({ text: '正文' })
  };

  const orchestrator = createGenerationOrchestrator({ store, db: repository, dependencies: deps });
  const created = await orchestrator.create({
    ...scope,
    id: runId,
    chapterId: 'ch-3',
    idempotencyKey: 'idem-go',
    requestHash: '3'.repeat(64),
    request: {
      chapterId: 'ch-3',
      chapterContract: {
        chapterId: 'ch-3',
        chapterGoal: '私自盗取禁阁藏书',
        mustNot: ['盗取禁阁藏书']
      }
    }
  });

  let finalRun = null;
  for (let i = 0; i < 40; i++) {
    finalRun = await store.getRun({}, { ...scope, id: created.run.id });
    if (finalRun && (finalRun.state === 'failed' || isTerminal(finalRun.state))) break;
    await new Promise(r => setTimeout(r, 20));
  }

  assert.ok(finalRun);
  assert.equal(finalRun.state, 'failed');
  assert.equal(finalRun.errorCode, 'CAUSAL_INVARIANT_VIOLATION');
  assert.ok(finalRun.errorDetail.includes('盗取禁阁藏书'));
});

// ============================================================================
// SUITE 5: Debt Payoff and Irreversible Result Hard Invariants
// ============================================================================

test('ADV-M2-DEBT-01: Unauthorized debt payoff is strictly caught', () => {
  const scenes = [
    { sceneIndex: 1, goal: '结算戒指秘密', resolvesDebt: 'debt_forbidden_origin' }
  ];
  const contract = { requiredPayoff: ['debt_herb_purchase'] };
  const check = verifyCausalInvariants(scenes, contract);

  assert.equal(check.valid, false);
  assert.equal(check.violations[0].type, 'UNAUTHORIZED_DEBT_PAYOFF');
  assert.equal(check.violations[0].debtId, 'debt_forbidden_origin');
});

test('ADV-M2-OUTCOME-01: Irreversible result contradiction (defeat vs victory) is caught', () => {
  const scenes = [
    { sceneIndex: 1, goal: '大殿对峙' },
    { sceneIndex: 2, goal: '萧炎大获全胜彻底击溃当场秒杀所有人' }
  ];
  const contract = { irreversibleResult: '萧炎谈判失利受挫，重伤隐忍遁走' };
  const check = verifyCausalInvariants(scenes, contract);

  assert.equal(check.valid, false);
  assert.equal(check.violations[0].type, 'OUTCOME_MISALIGNMENT');
});
