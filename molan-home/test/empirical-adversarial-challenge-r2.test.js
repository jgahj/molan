'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { assembleContext, formatOutlineContextMarkdown } = require('../lib/generation/context');
const { createGenerationOrchestrator } = require('../lib/generation/orchestrator');
const { createJsonGenerationStore } = require('../lib/generation/json-store');
const { JsonFileRepository } = require('../lib/repositories/json-file-repository');
const { contractHash } = require('../lib/generation/contract');
const { buildGenerationManifest, hashValue } = require('../lib/generation/manifest');
const { createQualityAssessment } = require('../lib/generation/quality-assessment');
const { sanitizeInPlace } = require('../lib/generation/inplace-sanitizer');
const { buildCanonicalOutlineContext } = require('../services/generation-service');

function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    const val = obj[key];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

function createMockOrchestrator(store, repository, { authoritativeStoryContext, onWriterCall }) {
  const rawDraftText = '萧炎袖袍微抖，玄重尺在黑布包裹下悄无声息。他缓缓退入人群，眼角微抬。';
  const draftText = sanitizeInPlace(rawDraftText).text;

  return createGenerationOrchestrator({
    store,
    db: repository,
    dependencies: {
      resolveGenre: async () => ({ status: 'resolved', genre: '玄幻' }),
      resolveStyle: async () => ({ status: 'resolved', style: '苍劲沉郁' }),
      loadAuthoritativeContext: async () => ({
        ok: true,
        snapshotHash: 'snap-hash-mock',
        storyContext: authoritativeStoryContext
      }),
      preGenerationGuard: async () => ({ passed: true, snapshotHash: 'snap-hash-mock' }),
      planScenes: async () => [{ id: 's1', goal: '魔石碑测验' }],
      writer: async input => {
        if (typeof onWriterCall === 'function') onWriterCall(input);
        return {
          text: draftText,
          manifest: buildGenerationManifest({
            generationId: input.request.id || 'run_mock_test',
            projectId: input.request.projectId || 'p_mock',
            chapterId: input.request.chapterId || 'ch_mock',
            pipelineVersion: 'content-engine-v2',
            contextHash: input.contextPlan.contextHash,
            contractHash: contractHash(input.contract),
            promptHash: 'prompt-hash-mock',
            outputHash: hashValue(draftText)
          })
        };
      },
      deterministicAudit: async () => ({ passed: true, issues: [], blockerCount: 0, unverifiedCount: 0 }),
      semanticAudit: async () => ({ passed: true, status: 'MEASURED', issues: [], blockerCount: 0, dimensions: {} }),
      qualityAudit: async ({ draft }) => createQualityAssessment({
        genre: '玄幻',
        contentDigest: hashValue(draft),
        compliance: { passed: true, checks: { length: { passed: true } } },
        literary: {
          passed: true,
          score: 0.92,
          confidence: 0.95,
          evaluator: { mode: 'dual', modelId: 'dual-judge' },
          dimensions: {
            language: {
              score: 0.92,
              confidence: 0.95,
              status: 'MEASURED',
              source: 'dual_judge_consensus',
              quote: '玄重尺在黑布包裹下悄无声息',
              evidence: ['动作神态克制冷峻']
            }
          }
        }
      }),
      commit: async () => ({ committed: true, snapshotId: 'snap-final', contentHash: hashValue(draftText) })
    }
  });
}

// ============================================================================
// PART 1: 冻结对象 (Frozen outlineContext & deepFreeze) 压力测试
// ============================================================================
test('EMPIRICAL-01: assembleContext 承受 Deeply Frozen outlineContext 及冻结 continuity 零异常', () => {
  const canonical = {
    chapter: {
      chapterId: 'ch_deep_freeze',
      chapterNo: 3,
      title: '退婚之辱',
      goal: '纳兰嫣然上门退婚',
      beats: [{ name: '纳兰到来' }, { name: '拿出聚气丹' }, { name: '三年之约' }],
      scenes: [{ goal: '萧家大厅剑拔弩张' }],
      summary: '纳兰嫣然携云岚宗长老强行退婚',
      sceneDirectives: [{ directive: '突出葛叶的威压与萧战的隐忍' }]
    },
    volume: {
      volumeId: 'vol_01',
      volumeNo: 1,
      title: '乌坦城风云',
      goal: '确立崛起起点',
      arcGoals: ['休书立约', '药老苏醒'],
      volumePlan: '第一卷总推进规划'
    },
    dependencies: {
      prerequisiteEvents: ['三年前斗气倒退', '家族议事'],
      foreshadows: [{ name: '黑色古戒隐隐发热' }],
      causalDebts: [{ description: '三年之约云岚宗决战' }],
      nextChapterInterface: {
        chapterNo: 4,
        title: '神秘古戒',
        hookGoal: '后山发现药老残魂',
        unresolvedTension: '古戒吸纳斗气的真相即将揭晓'
      }
    },
    meta: {
      revision: 2,
      outlineHash: 'f'.repeat(64),
      completenessTier: 'full_scenes'
    }
  };

  deepFreeze(canonical);
  assert.ok(Object.isFrozen(canonical));
  assert.ok(Object.isFrozen(canonical.chapter));
  assert.ok(Object.isFrozen(canonical.chapter.beats));
  assert.ok(Object.isFrozen(canonical.chapter.beats[0]));
  assert.ok(Object.isFrozen(canonical.dependencies.nextChapterInterface));

  const frozenContinuity = deepFreeze({
    outline: '现场细纲：萧炎当场写下休书，莫欺少年穷！',
    nextChapter: { goal: '后山偶遇药老' },
    atmosphere: '悲愤且决绝',
    dossier: { protagonistState: '斗之气三段' }
  });

  const input = deepFreeze({
    outlineContext: canonical,
    currentChapterOutline: '现场细纲：萧炎当场写下休书，莫欺少年穷！',
    continuity: frozenContinuity,
    chapterOutline: { leaked: 'OLD_OUTLINE' },
    nextChapterOutline: { leaked: 'OLD_NEXT' }
  });

  // 执行 assembleContext，必须零崩溃
  let result = null;
  assert.doesNotThrow(() => {
    result = assembleContext(input, { model: 'gpt-4o', hardLimit: 40000 });
  });

  assert.ok(result);
  assert.ok(result.text);

  // 验证原冻结对象未被篡改
  assert.equal(canonical.chapter.clientOutline, undefined);
  assert.ok(Object.isFrozen(canonical));
  assert.ok(Object.isFrozen(canonical.chapter));

  // 验证输出中包含了现场细纲约束
  assert.ok(result.text.includes('现场细纲约束：现场细纲：萧炎当场写下休书，莫欺少年穷！'));

  // 验证 continuity 净除：未泄露 outline / nextChapter 的 raw JSON
  assert.ok(!result.text.includes('"outline":'));
  assert.ok(!result.text.includes('"nextChapter":'));
  assert.ok(result.text.includes('悲愤且决绝')); // 保留非大纲 continuity 字段
});

test('EMPIRICAL-02: assembleContext 承受 chapter 为 null / undefined / 空对象的冻结 outlineContext', () => {
  const edgeCases = [
    { chapter: null },
    { chapter: undefined },
    { chapter: Object.freeze({}) },
    Object.freeze({})
  ];

  for (const oc of edgeCases) {
    deepFreeze(oc);
    const input = {
      outlineContext: oc,
      currentChapterOutline: '孤立现场细纲'
    };
    let result = null;
    assert.doesNotThrow(() => {
      result = assembleContext(input, { model: 'gpt-4o' });
    });
    assert.ok(result);
  }
});

// ============================================================================
// PART 2: 验证 Bug 1 (continuity raw JSON leakage) 100% 根治
// ============================================================================
test('EMPIRICAL-03: Bug 1 验证 - continuity 包含混合大纲与非大纲字段时，精准净除且保留业务状态', () => {
  const outlineContext = {
    chapter: { chapterNo: 1, title: '第一章', goal: '测验', beats: [], scenes: [], summary: '测验概要' },
    volume: { volumeNo: 1, title: '第一卷', goal: '', arcGoals: [], volumePlan: '' },
    dependencies: { prerequisiteEvents: [], foreshadows: [], causalDebts: [], nextChapterInterface: {} },
    meta: { revision: 1, outlineHash: '1'.repeat(64), completenessTier: 'goal_only' }
  };

  const input = {
    outlineContext,
    continuity: {
      outline: '【细纲特异标记12345】',
      currentChapterOutline: '【细纲特异标记12345】',
      chapterOutline: '【旧大纲】',
      chapterPlan: '【旧计划】',
      nextChapter: { goal: '下章目标999' },
      nextChapterOutline: '下章大纲999',
      // 非大纲字段：
      sceneName: '测试广场',
      currentBody: '萧炎站在人群中',
      authorNotes: '保持冷峻节奏'
    }
  };

  const { text, blocks } = assembleContext(input, { model: 'gpt-4o' });

  // 1. 唯一性验证：【细纲特异标记12345】在 text 中出现且仅出现 0 或 1 次（若未同步为 clientOutline 则在 outlineContext 中未出现，但绝不在 continuity 中出现）
  assert.equal(text.includes('"outline":"【细纲特异标记12345】"'), false);
  assert.equal(text.includes('"nextChapter":'), false);
  assert.equal(text.includes('"chapterOutline":'), false);

  // 2. 非大纲字段必须依然在 continuity 块中被保留
  const continuityBlock = blocks.find(b => b.id === 'continuity');
  assert.ok(continuityBlock, 'continuity 块应保留非大纲字段');
  assert.ok(continuityBlock.content.includes('测试广场'));
  assert.ok(continuityBlock.content.includes('保持冷峻节奏'));
});

test('EMPIRICAL-04: Bug 1 验证 - continuity 纯粹仅有大纲字段时，[continuity] 块彻底消失而不残留空 JSON', () => {
  const outlineContext = {
    chapter: { chapterNo: 1, title: '第一章', goal: '测验', beats: [], scenes: [], summary: '' },
    volume: { volumeNo: 1, title: '第一卷', goal: '', arcGoals: [], volumePlan: '' },
    dependencies: { prerequisiteEvents: [], foreshadows: [], causalDebts: [], nextChapterInterface: {} },
    meta: { revision: 1, outlineHash: '1'.repeat(64), completenessTier: 'goal_only' }
  };

  const input = {
    outlineContext,
    continuity: {
      outline: '唯一大纲',
      nextChapter: { goal: '唯一下章' }
    }
  };

  const { text, blocks } = assembleContext(input, { model: 'gpt-4o' });

  const continuityBlock = blocks.find(b => b.id === 'continuity');
  assert.equal(continuityBlock, undefined, '仅包含大纲字段的 continuity 净化后为空对象，必须被彻底 delete');
  assert.equal(text.includes('[continuity]'), false);
  assert.equal(text.includes('{}'), false);
});

// ============================================================================
// PART 3: 验证 Bug 2 (nextChapterOutline alias leakage) 100% 根治
// ============================================================================
test('EMPIRICAL-05: Bug 2 验证 - 存在 outlineContext 时，所有 8 种根级别名全数被彻底拔除', () => {
  const canonical = {
    chapter: { chapterNo: 2, title: '测试章', goal: '核心目标', beats: ['节拍1'], scenes: [], summary: '总结' },
    volume: { volumeNo: 1, title: '卷一', goal: '', arcGoals: [], volumePlan: '' },
    dependencies: { prerequisiteEvents: [], foreshadows: [], causalDebts: [], nextChapterInterface: {} },
    meta: { revision: 1, outlineHash: '2'.repeat(64), completenessTier: 'event_chain' }
  };

  const aliases = {
    chapterOutline: { leak: 'LEAK_CH_OUTLINE' },
    chapterContext: { leak: 'LEAK_CH_CONTEXT' },
    chapterPlan: { leak: 'LEAK_CH_PLAN' },
    planText: 'LEAK_PLAN_TEXT',
    currentChapterOutline: 'LEAK_CURRENT_OUTLINE',
    outline: { leak: 'LEAK_OUTLINE' },
    outlineDependencies: { leak: 'LEAK_OUTLINE_DEPS' },
    nextChapterOutline: { leak: 'LEAK_NEXT_CH_OUTLINE' }
  };

  const input = {
    outlineContext: canonical,
    ...aliases
  };

  const { text, blocks } = assembleContext(input, { model: 'gpt-4o' });
  const blockIds = blocks.map(b => b.id);

  for (const aliasKey of Object.keys(aliases)) {
    assert.equal(blockIds.includes(aliasKey), false, `block 列表中不应出现 ${aliasKey}`);
    assert.equal(text.includes(`[${aliasKey}]`), false, `prompt 中不应出现 [${aliasKey}] 独立渲染块`);
  }

  assert.equal(text.includes('LEAK_NEXT_CH_OUTLINE'), false);
  assert.equal(text.includes('LEAK_OUTLINE_DEPS'), false);
  assert.equal(text.includes('LEAK_CH_OUTLINE'), false);
});

// ============================================================================
// PART 4: 验证 Bug 3 (client nextChapter shadowing) 100% 根治
// ============================================================================
test('EMPIRICAL-06: Bug 3 验证 - orchestrator 端点下客户端多样化 nextChapter 格式均能压制服务端预案', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-adv-shadow-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const serverDefaultHook = '服务端死板预设：留在乌坦城闭关三十天';
  const serverDefaultTension = '旧悬念：谁偷吃了聚气丹';

  const testVariations = [
    {
      label: 'client nextChapter as { goal }',
      clientNextChapter: { goal: '现场突发：立刻动身前往魔兽山脉' },
      expectedHook: '现场突发：立刻动身前往魔兽山脉'
    },
    {
      label: 'client nextChapter as { hookGoal }',
      clientNextChapter: { hookGoal: '现场突发：药老传授吸掌' },
      expectedHook: '现场突发：药老传授吸掌'
    },
    {
      label: 'client nextChapter as { outline }',
      clientNextChapter: { outline: '现场突发：坊市淘宝遇萧媚' },
      expectedHook: '现场突发：坊市淘宝遇萧媚'
    },
    {
      label: 'client nextChapter as pure string',
      clientNextChapter: '现场突发：熏儿身份初露端倪',
      expectedHook: '现场突发：熏儿身份初露端倪'
    }
  ];

  let counter = 0;
  for (const v of testVariations) {
    counter++;
    const orchestrator = createMockOrchestrator(store, repository, {
      authoritativeStoryContext: {
        outlineContext: {
          chapter: { chapterNo: 1, title: '第一章', goal: '测验', beats: [], scenes: [], summary: '' },
          volume: { volumeNo: 1, title: '第一卷', goal: '', arcGoals: [], volumePlan: '' },
          dependencies: {
            prerequisiteEvents: [],
            foreshadows: [],
            causalDebts: [],
            nextChapterInterface: { hookGoal: serverDefaultHook, unresolvedTension: serverDefaultTension }
          },
          meta: { revision: 1, outlineHash: '9'.repeat(64), completenessTier: 'event_chain' }
        }
      }
    });

    const runId = `run_adv_shadow_${counter}`;
    const scope = { workspaceId: 'ws_adv', projectId: 'p_adv', actorUserId: 'u1' };
    const created = await orchestrator.create({
      ...scope,
      id: runId,
      chapterId: 'ch_mock',
      idempotencyKey: `idem_adv_shadow_${counter}`,
      requestHash: String(counter).repeat(64),
      request: {
        id: runId,
        projectId: 'p_adv',
        chapterId: 'ch_mock',
        chapterNo: 1,
        chapterContract: { chapterId: 'ch_mock', chapterNo: 1, chapterGoal: '测验', wordBudget: { minChars: 10, maxChars: 500, targetChars: 50 } },
        storyContext: {
          continuity: {
            outline: '当章细纲',
            nextChapter: v.clientNextChapter
          }
        }
      }
    });

    let finalRun = null;
    for (let i = 0; i < 60; i++) {
      finalRun = await store.getRun({}, { ...scope, id: created.run.id });
      if (finalRun && (finalRun.state === 'waiting_author' || finalRun.state === 'needs_human' || finalRun.state === 'failed')) break;
      await new Promise(r => setTimeout(r, 25));
    }

    assert.ok(finalRun);
    assert.ok(['waiting_author', 'needs_human'].includes(finalRun.state));
    const authStoryContext = finalRun.result.authoritativeStoryContext;
    const nci = authStoryContext.outlineContext.dependencies.nextChapterInterface;

    assert.equal(
      nci.hookGoal,
      v.expectedHook,
      `[${v.label}]: 客户端现场意图未能成功覆盖服务端预案，实际值为: ${nci.hookGoal}`
    );
  }
});

test('EMPIRICAL-07: Bug 3 验证 - orchestrator authoritativeStoryContext 内含 Object.freeze 时的健壮性', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-adv-frozen-orch-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const frozenAuthoritative = deepFreeze({
    outlineContext: {
      chapter: { chapterNo: 1, title: '第一章', goal: '测验', beats: [], scenes: [], summary: '已冻结概要' },
      volume: { volumeNo: 1, title: '第一卷', goal: '', arcGoals: [], volumePlan: '' },
      dependencies: {
        prerequisiteEvents: [],
        foreshadows: [],
        causalDebts: [],
        nextChapterInterface: { hookGoal: '冻结的服务端预案', unresolvedTension: '冻结悬念' }
      },
      meta: { revision: 1, outlineHash: '8'.repeat(64), completenessTier: 'event_chain' }
    }
  });

  const orchestrator = createMockOrchestrator(store, repository, {
    authoritativeStoryContext: frozenAuthoritative
  });

  const runId = 'run_frozen_orch_1';
  const scope = { workspaceId: 'ws_adv', projectId: 'p_adv', actorUserId: 'u1' };

  const created = await orchestrator.create({
    ...scope,
    id: runId,
    chapterId: 'ch_mock',
    idempotencyKey: 'idem_frozen_orch_1',
    requestHash: '7'.repeat(64),
    request: {
      id: runId,
      projectId: 'p_adv',
      chapterId: 'ch_mock',
      chapterNo: 1,
      chapterContract: { chapterId: 'ch_mock', chapterNo: 1, chapterGoal: '测验', wordBudget: { minChars: 10, maxChars: 500, targetChars: 50 } },
      storyContext: {
        continuity: {
          outline: '动态现场细纲',
          nextChapter: { goal: '客户端打破冻结' }
        }
      }
    }
  });

  let finalRun = null;
  for (let i = 0; i < 60; i++) {
    finalRun = await store.getRun({}, { ...scope, id: created.run.id });
    if (finalRun && (finalRun.state === 'waiting_author' || finalRun.state === 'needs_human' || finalRun.state === 'failed')) break;
    await new Promise(r => setTimeout(r, 25));
  }

  assert.ok(finalRun);
  assert.ok(['waiting_author', 'needs_human'].includes(finalRun.state));
  const nci = finalRun.result.authoritativeStoryContext.outlineContext.dependencies.nextChapterInterface;
  assert.equal(nci.hookGoal, '客户端打破冻结');
});

// ============================================================================
// PART 5: formatOutlineContextMarkdown 边界测试 (Sparse, Empty, Deduplication)
// ============================================================================
test('EMPIRICAL-08: formatOutlineContextMarkdown 概要与细纲完全一致时不重复输出', () => {
  const data = {
    chapter: {
      chapterNo: 5,
      title: '斗气阁',
      goal: '选取功法',
      summary: '萧炎在斗气阁挑选功法',
      clientOutline: '萧炎在斗气阁挑选功法' // summary 与 clientOutline 完全相同
    }
  };

  const md = formatOutlineContextMarkdown(data);
  const summaryMatches = md.split('萧炎在斗气阁挑选功法').length - 1;
  assert.equal(summaryMatches, 1, '完全相同的故事概要与现场细纲不应重复渲染两次');
  assert.equal(md.includes('- 章节概要：'), false);
  assert.ok(md.includes('- 现场细纲约束：萧炎在斗气阁挑选功法'));
});

test('EMPIRICAL-09: formatOutlineContextMarkdown 当依赖项全部为空时省略 Section 3 头部', () => {
  const data = {
    chapter: { chapterNo: 1, goal: '目标' },
    volume: { volumeNo: 1 },
    dependencies: {
      prerequisiteEvents: [],
      foreshadows: [],
      causalDebts: [],
      nextChapterInterface: {}
    }
  };

  const md = formatOutlineContextMarkdown(data);
  assert.equal(md.includes('【前置因果依赖与下章承接接口】'), false, '空依赖时不应产生悬挂的Section 3头部');
});

test('EMPIRICAL-10: buildCanonicalOutlineContext 承受极端非法与稀疏输入', () => {
  const badInputs = [
    null,
    undefined,
    12345,
    'not-an-object',
    [],
    { chapter: null, beats: [null, undefined, '', {}, '有效节拍'] },
    { dependencies: { foreshadows: [{}, { name: null }, { name: '有效伏笔' }] } }
  ];

  for (const bi of badInputs) {
    let result = null;
    assert.doesNotThrow(() => {
      result = buildCanonicalOutlineContext(bi);
    });
    assert.ok(result);
    assert.ok(result.chapter);
    assert.ok(result.volume);
    assert.ok(result.dependencies);
    assert.ok(result.meta);
  }
});
