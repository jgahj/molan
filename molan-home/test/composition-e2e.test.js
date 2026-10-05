'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const contentEngine = require('../lib/generation/content-engine');
const { createGenerationOrchestrator } = require('../lib/generation/orchestrator');
const { createJsonGenerationStore } = require('../lib/generation/json-store');
const { JsonFileRepository } = require('../lib/repositories/json-file-repository');
const { defaultProfileRegistry } = require('../lib/composition/profiles/profile-registry');
const { REPAIR_STRATEGIES } = require('../lib/composition/audit-repair/targeted-repair-router');

function createTempDir(prefix = 'molan-comp-e2e-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('Composition E2E: content-engine.compileDraftPrompt 无缝挂载 StrategyCompiler', () => {
  const spec = defaultProfileRegistry.resolveCompositionSpec({
    genre: 'xuanhuan_cautious',
    style: 'laobai_restrained',
    chapterGoal: 'info_reveal',
    focus: 'dialogue_game',
    hook: 'suspense_clue',
    targetChars: 3000,
    userInstruction: '本章主角必须在对话中故意示弱，诱使对方说漏嘴。'
  });

  const compiled = contentEngine.compileDraftPrompt({
    compositionSpec: spec,
    context: '前情提要：主角抵达坊市茶楼。',
    contract: { chapterGoal: '信息揭露', wordBudget: { targetChars: 3000 } }
  });

  assert.ok(compiled.systemPrompt.includes('【P0 绝对事实与物理围栏'));
  assert.ok(compiled.systemPrompt.includes('【题材策略·凡人谨慎修真】'));
  assert.ok(compiled.systemPrompt.includes('【文风质感策略·老白冷硬克制】'));
  assert.ok(compiled.systemPrompt.includes('【本章镜头与笔墨预算分配·对话机锋博弈】'));
  assert.ok(compiled.systemPrompt.includes('【本章钩子策略·物证异样悬念钩】'));

  assert.ok(compiled.userPrompt.includes('【P1 用户明确不可变指令'));
  assert.ok(compiled.userPrompt.includes('故意示弱'));
  assert.ok(compiled.userPrompt.includes('【状态跃迁契约 (State Delta)】'));

  assert.equal(compiled.wordBudget.target, 3000);
  assert.ok(compiled.compositionStrategy !== undefined);
  assert.equal(compiled.effectiveGenre, '凡人谨慎修真');
});

test('Composition E2E: 向后兼容性保障 (未传 compositionSpec 时平滑走既有逻辑)', () => {
  const compiledLegacy = contentEngine.compileDraftPrompt({
    genre: '传统玄幻',
    novelGenre: 'xuanhuan',
    style: 'mars-style-pure-xuanhuan-writing',
    chapterFocus: 'balanced',
    chapterFunction: 'golden_ch1_hook',
    context: '前情提要：宗门测试。'
  });

  assert.ok(compiledLegacy.systemPrompt.includes('【题材归属为【传统玄幻】】') || compiledLegacy.systemPrompt.includes('传统玄幻'));
  assert.equal(compiledLegacy.compositionStrategy, undefined);
});

test('Composition E2E: generateDraft 无状态模型起草在 CompositionSpec 下稳定运行', async () => {
  const spec = defaultProfileRegistry.resolveCompositionSpec({
    genre: 'urban_investigation',
    style: 'laobai_restrained',
    chapterGoal: 'info_reveal',
    focus: 'dialogue_game',
    hook: 'suspense_clue',
    targetChars: 2500
  });

  const mockCallModel = async (auth, req) => {
    assert.ok(req.system.includes('【P0 绝对事实与物理围栏'));
    assert.ok(req.userPrompt.includes('【状态跃迁契约'));
    return {
      text: '长街夜雨，茶楼檐角水滴不断。李巡放下粗瓷茶盏，看向对面算账的掌柜。“三年前的账，该结了。”掌柜手指微紧，拨弄算盘的手蓦地停在半空。',
      usage: { totalTokens: 120, promptTokens: 80, completionTokens: 40 }
    };
  };

  const draftResult = await contentEngine.generateDraft({
    callModel: mockCallModel,
    auth: { user: { userId: 'u_comp_1' } },
    request: { compositionSpec: spec, runId: 'run_comp_e2e_1' },
    contract: { chapterGoal: '信息揭露', wordBudget: { targetChars: 2500 } },
    context: '雨夜茶楼。'
  });

  assert.equal(draftResult.status, 'draft_created');
  assert.ok(draftResult.text.includes('李巡放下粗瓷茶盏'));
  assert.ok(draftResult.manifest !== null);
  assert.ok(draftResult.pipeline !== null);
  assert.equal(draftResult.calls.length, 1);
});

test('Composition E2E: Orchestrator 挂载 CompositionSpec 自主流转至 waiting_author 并验证定向修复路由', async () => {
  const dir = createTempDir();
  const repository = new JsonFileRepository(dir);
  const store = createJsonGenerationStore(dir, { repository });
  const spec = defaultProfileRegistry.resolveCompositionSpec({
    genre: 'xuanhuan_cautious',
    style: 'laobai_restrained',
    chapterGoal: 'info_reveal',
    focus: 'dialogue_game',
    hook: 'suspense_clue',
    targetChars: 2400
  });

  let reviseCalled = false;
  let receivedRepairPlan = null;
  const draftText = '青石长阶之上，云雾翻涌。李巡躬身递上一枚焦黑古钱，低声道：“弟子在后山废池所得。”值守长老眼皮微抬，掌心暗扣灵石，指尖泛起微光。';

  const scope = {
    projectId: 'proj_comp_1',
    actorUserId: 'user_comp_1',
    workspaceId: 'ws_comp_1'
  };
  const runId = 'run_comp_1';
  const chapterId = 'chap_comp_1';

  const orchestrator = createGenerationOrchestrator({
    store,
    db: repository,
    dependenciesForRun: () => ({
      loadAuthoritativeContext: async () => ({
        ok: true,
        snapshotHash: 'snap_comp_1',
        storyContext: { pov: 'third-limited', characters: ['李巡'] }
      }),
      preGenerationGuard: async () => ({ passed: true, snapshotHash: 'snap_comp_1' }),
      planScenes: async () => ([{ id: 's1', goal: '暗池寻钱' }]),
      writer: async ({ request, contract: passedContract, contextPlan, scenes, scenePlan }) => {
        return await contentEngine.generateDraft({
          callModel: async (_auth, options) => {
            assert.ok(options.system.includes('【题材策略·凡人谨慎修真】'));
            return {
              text: draftText,
              usage: { promptTokens: 300, completionTokens: 120, totalTokens: 420, creditCost: 0.1 }
            };
          },
          auth: { user: { userId: scope.actorUserId } },
          request: {
            generationId: runId,
            projectId: scope.projectId,
            chapterId,
            genre: '玄幻',
            targetWords: 2400,
            compositionSpec: spec
          },
          contract: passedContract,
          contextPlan,
          scenes,
          scenePlan,
          genre: '玄幻',
          style: '老白克制'
        });
      },
      deterministicAudit: async () => ({
        passed: true,
        blockerCount: 0,
        unverifiedCount: 0,
        issues: []
      }),
      semanticAudit: async ({ draft, attempt }) => {
        // 第一轮模拟报告一个微小 issue，触发定向修复路由验证
        if (attempt === 1) {
          return {
            passed: false,
            status: 'MEASURED',
            issues: [{
              severity: 'blocker',
              status: 'verified',
              issueId: 'iss_hook_1',
              category: 'hook',
              dimension: 'hook',
              quote: '指尖泛起微光。',
              problem: '章末缺少强悬念缺口'
            }],
            usage: { totalTokens: 50 }
          };
        }
        return {
          passed: true,
          status: 'MEASURED',
          issues: [],
          usage: { totalTokens: 50 }
        };
      },
      revise: async ({ issue, window, round, repairPlan }) => {
        reviseCalled = true;
        receivedRepairPlan = repairPlan;
        return {
          quote: issue.quote,
          replacement: '指尖泛起微光。那焦黑古钱背面，赫然刻着老宗主佩剑纹样！',
          preservedFacts: ['焦黑古钱', '老宗主佩剑纹样']
        };
      },
      qualityAudit: async () => ({
        passed: true,
        status: 'MEASURED',
        score: 0.88,
        confidence: 0.92,
        qualityVector: {
          causality: {
            value: 0.88,
            score: 0.88,
            confidence: 0.9,
            status: 'MEASURED',
            source: 'literary_evaluator',
            quote: '弟子在后山废池所得',
            evidence: '因果逻辑连贯'
          },
          consistency: {
            value: 0.86,
            score: 0.86,
            confidence: 0.9,
            status: 'MEASURED',
            source: 'literary_evaluator',
            quote: '李巡躬身递上一枚焦黑古钱',
            evidence: '人物行为一致'
          },
          language: {
            value: 0.90,
            score: 0.90,
            confidence: 0.92,
            status: 'MEASURED',
            source: 'literary_evaluator',
            quote: '青石长阶之上，云雾翻涌',
            evidence: '文风沉稳洗练'
          }
        }
      })
    })
  });

  const created = await orchestrator.create({
    ...scope,
    id: runId,
    chapterId,
    idempotencyKey: 'idem_comp_1',
    requestHash: '1'.repeat(64),
    request: {
      chapterId,
      genre: '玄幻',
      style: '老白克制',
      compositionSpec: spec,
      userInstruction: '找出古钱线索',
      chapterContract: {
        chapterId,
        compositionSpec: spec,
        chapterGoal: '信息揭露',
        wordBudget: { targetChars: 2400 },
        scenes: [{ id: 's1', goal: '暗池寻钱' }]
      }
    }
  });

  assert.ok(created && created.run);

  let executed = null;
  for (let i = 0; i < 60; i++) {
    executed = await store.getRun(repository, { ...scope, id: runId });
    if (executed && (executed.state === 'waiting_author' || executed.state === 'needs_human' || executed.state === 'failed')) {
      break;
    }
    await new Promise(r => setTimeout(r, 20));
  }

  try {
    assert.equal(reviseCalled, true);
    assert.ok(receivedRepairPlan !== null);
    assert.equal(receivedRepairPlan.strategy, REPAIR_STRATEGIES.HOOK_TAIL_RECONSTRUCT);
    assert.equal(receivedRepairPlan.requiresFullRegeneration, false);

    // 2. 验证修复后干净达成 waiting_author
    assert.ok(executed, 'run 必须落定');
    assert.equal(executed.state, 'waiting_author');
    assert.ok(executed.result.draft.includes('老宗主佩剑纹样'));
  } finally {
    await repository.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
