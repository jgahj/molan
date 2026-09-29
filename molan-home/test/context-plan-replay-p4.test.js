'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { assembleContext, CONTEXT_LAYERS } = require('../lib/generation/context');
const { calculateContextBudget, assertContextBudget } = require('../lib/generation/context-budget');
const { normalizeChapterContract, contractHash } = require('../lib/generation/contract');
const { buildGenerationManifest } = require('../lib/generation/manifest');
const { createGenerationOrchestrator } = require('../lib/generation/orchestrator');

test('P4 ContextPlan: 严格包含所有指定字段与 8 大固定分层', () => {
  const input = {
    sceneContract: { goal: '探索地宫' },
    immediateTimeline: '主角刚踏入石门',
    scenes: [{ id: 'scene_1', goal: '点燃火把' }],
    chapterContract: { chapterGoal: '夺得地宫灵符' },
    recentChapters: '上一章击败了守门黑熊',
    volumeState: '第一卷：初入江湖',
    characters: [{ name: '周叙' }],
    relationships: { '周叙-林婉': '盟友' },
    hardState: { injured: false },
    factLedger: { gold: 100 },
    worldRules: '末法时代不可御空',
    povKnowledge: '主角不知道密道所在',
    activeCausalDebt: [{ debtId: 'debt-1', promise: '偿还恩情' }],
    foreshadows: ['暗处有人窥伺']
  };

  const { text, blocks, contextPlan } = assembleContext(input, {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet',
    hardLimit: 200000,
    outputReserve: 4000,
    system: '你是一位严谨的玄幻作家。'
  });

  // 1. 验证必须包含的字段
  assert.equal(contextPlan.contextPlanVersion, '4');
  assert.equal(contextPlan.provider, 'anthropic');
  assert.equal(contextPlan.model, 'claude-3-5-sonnet');
  assert.equal(contextPlan.hardLimit, 200000);
  assert.equal(contextPlan.outputReserve, 4000);
  assert.ok(contextPlan.systemTokens > 0);
  assert.ok(contextPlan.contractTokens > 0);
  assert.ok(contextPlan.memoryTokens > 0);
  assert.ok(contextPlan.storyTokens > 0);
  assert.ok(contextPlan.recentTokens > 0);
  assert.ok(contextPlan.availableInputTokens > 0);
  assert.ok(contextPlan.availableInputTokens <= contextPlan.hardLimit);
  assert.equal(typeof contextPlan.contextHash, 'string');
  assert.equal(contextPlan.fits, true);

  // 2. 验证 8 大固定分层
  for (const layer of CONTEXT_LAYERS) {
    assert.ok(layer in contextPlan.layers, `分层缺失: ${layer}`);
    assert.ok(layer in contextPlan.layerTokens, `分层Token缺失: ${layer}`);
  }

  assert.ok(contextPlan.layers.L0_current.includes('sceneContract'));
  assert.ok(contextPlan.layers.L0_current.includes('immediateTimeline'));
  assert.ok(contextPlan.layers.L1_scene.includes('scenes'));
  assert.ok(contextPlan.layers.L2_chapter.includes('chapterContract'));
  assert.ok(contextPlan.layers.L3_recent.includes('recentChapters'));
  assert.ok(contextPlan.layers.L4_volume.includes('volumeState'));
  assert.ok(contextPlan.layers.L5_facts.includes('characters'));
  assert.ok(contextPlan.layers.L5_facts.includes('relationships'));
  assert.ok(contextPlan.layers.L6_world_axioms.includes('worldRules'));
  assert.ok(contextPlan.layers.L6_world_axioms.includes('povKnowledge'));
  assert.ok(contextPlan.layers.L7_causal_debt.includes('activeCausalDebt'));
  assert.ok(contextPlan.layers.L7_causal_debt.includes('foreshadows'));
});

test('P4 Single Source of Truth: context-budget 与 ContextPlan 计算完全一致', () => {
  const input = {
    sceneContract: { goal: '破开阵法' },
    chapterContract: { chapterGoal: '第三章：破阵' },
    characters: ['陆青', '沈姑娘'],
    worldRules: '阵法受月光强弱影响'
  };

  const { contextPlan } = assembleContext(input, {
    model: 'gpt-4o',
    hardLimit: 128000,
    outputReserve: 3840
  });

  // 使用 ContextPlan 进行预算校验
  const budget = calculateContextBudget({ contextPlan });
  assert.equal(budget.fits, true);
  assert.equal(budget.limit, 128000);
  assert.equal(budget.breakdown.outputReserve, 3840);
  assert.equal(budget.breakdown.contractTokens, contextPlan.contractTokens);
  assert.equal(budget.breakdown.memoryTokens, contextPlan.memoryTokens);
  assert.equal(budget.breakdown.storyTokens, contextPlan.storyTokens);

  // assertContextBudget 必须通过
  assert.doesNotThrow(() => assertContextBudget({ contextPlan }));
});

test('P4 Replay: getReplay 能从 generationId 恢复 6 大关键凭证并报告 replayable=true', async () => {
  // 模拟轻量内存 store
  const mockRun = {
    id: 'gen-replay-001',
    project_id: 'proj-1',
    actor_user_id: 'user-1',
    workspace_id: 'ws-1',
    state: 'waiting_author',
    pipeline_version: 'generation-v2.1',
    attempt_no: 1,
    manifest_json: JSON.stringify({
      generationId: 'gen-replay-001',
      promptHash: 'phash-abc12345',
      stateSnapshotHash: 'snap-hash-999',
      contextHash: 'chash-888',
      contractHash: 'conthash-777',
      outputHash: 'out-hash-666'
    }),
    result_json: JSON.stringify({
      draft: '深秋的夜风卷着湿冷的沙尘。',
      outputHash: 'out-hash-666',
      contract: {
        chapterId: 'chap-1',
        chapterGoal: '查清驿站异常',
        pov: 'third-limited',
        wordBudget: { targetChars: 2400 }
      },
      contextPlan: {
        contextPlanVersion: '4',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        hardLimit: 200000,
        outputReserve: 3840,
        systemTokens: 100,
        contractTokens: 200,
        memoryTokens: 300,
        storyTokens: 400,
        recentTokens: 150,
        availableInputTokens: 195000,
        layers: { L0_current: [], L1_scene: [], L2_chapter: [], L3_recent: [], L4_volume: [], L5_facts: [], L6_world_axioms: [], L7_causal_debt: [] },
        contextHash: 'chash-888'
      },
      stateSnapshot: {
        snapshotHash: 'snap-hash-999',
        storyContext: { characters: [{ name: '周叙' }], factLedger: {} }
      },
      styleResolution: {
        bundle: { version: 'style-bundle-v1', hash: 'style-hash-111', styleId: 'xuanhuan-hard' }
      },
      genreResolution: {
        profile: { genre: '玄幻', confidence: 1, family: '东方玄幻' }
      },
      promptHash: 'phash-abc12345'
    })
  };

  const mockDb = {};
  const mockStore = {
    getRun: (_db, scope) => {
      if (scope.id === 'gen-replay-001') {
        const { publicRun } = require('../lib/generation/sqlite-store');
        return publicRun(mockRun);
      }
      return null;
    },
    getRunInput: (_db, _scope) => ({
      projectId: 'proj-1',
      actorUserId: 'user-1',
      chapterContract: { chapterGoal: '查清驿站异常' }
    })
  };

  const orchestrator = createGenerationOrchestrator({ store: mockStore, db: mockDb });
  const replay = await orchestrator.getReplay({ projectId: 'proj-1', actorUserId: 'user-1' }, 'gen-replay-001');

  assert.equal(replay.generationId, 'gen-replay-001');
  assert.equal(replay.replayable, true);
  assert.ok(replay.contract);
  assert.equal(replay.contract.chapterGoal, '查清驿站异常');
  assert.ok(replay.contextPlan);
  assert.equal(replay.contextPlan.contextPlanVersion, '4');
  assert.ok(replay.stateSnapshot);
  assert.equal(replay.stateSnapshot.snapshotHash, 'snap-hash-999');
  assert.ok(replay.styleBundle);
  assert.equal(replay.styleBundle.hash, 'style-hash-111');
  assert.ok(replay.genreProfile);
  assert.equal(replay.genreProfile.genre, '玄幻');
  assert.equal(replay.promptHash, 'phash-abc12345');
});

test('P4 Replay: 关键凭证缺失时正确报告 replayable=false', async () => {
  const mockIncompleteRun = {
    id: 'gen-incomplete-002',
    project_id: 'proj-1',
    actor_user_id: 'user-1',
    workspace_id: 'ws-1',
    state: 'failed',
    pipeline_version: 'generation-v2.1',
    attempt_no: 1,
    manifest_json: '{}',
    result_json: '{}'
  };

  const mockDb = {};
  const mockStore = {
    getRun: (_db, scope) => {
      const { publicRun } = require('../lib/generation/sqlite-store');
      return publicRun(mockIncompleteRun);
    },
    getRunInput: (_db, _scope) => null
  };

  const orchestrator = createGenerationOrchestrator({ store: mockStore, db: mockDb });
  const replay = await orchestrator.getReplay({ projectId: 'proj-1', actorUserId: 'user-1' }, 'gen-incomplete-002');

  assert.equal(replay.generationId, 'gen-incomplete-002');
  assert.equal(replay.replayable, false);
});
