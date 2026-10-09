'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { assembleContext } = require('../lib/generation/context');
const { createGenerationOrchestrator } = require('../lib/generation/orchestrator');
const { createJsonGenerationStore } = require('../lib/generation/json-store');
const { JsonFileRepository } = require('../lib/repositories/json-file-repository');
const { contractHash } = require('../lib/generation/contract');
const { buildGenerationManifest, hashValue } = require('../lib/generation/manifest');
const { createQualityAssessment } = require('../lib/generation/quality-assessment');
const { sanitizeInPlace } = require('../lib/generation/inplace-sanitizer');

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

// --------------------------------------------------------------------------
// TEST 1: 验证现场大纲提升与根级 legacy 别名抑制已生效的部分
// --------------------------------------------------------------------------
test('ADV-TEST-01 [ROBUST]: orchestrator 现场大纲提升与 chapterOutline/chapterPlan 根级别名抑制有效', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-adv-01-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  let capturedInput = null;
  const clientOutline = '【现场细纲】：绝不可暴露玄重尺！';

  const orchestrator = createMockOrchestrator(store, repository, {
    authoritativeStoryContext: {
      outlineContext: {
        chapter: { chapterNo: 1, title: '第一章', goal: '测验', beats: [], scenes: [], summary: '已有正规章节概要' },
        volume: { volumeNo: 1, title: '第一卷', goal: '', arcGoals: [], volumePlan: '' },
        dependencies: { prerequisiteEvents: [], foreshadows: [], causalDebts: [], nextChapterInterface: {} },
        meta: { revision: 1, outlineHash: 'a'.repeat(64), completenessTier: 'event_chain' }
      },
      chapterOutline: { chapterNo: 1, serverField: 'SERVER_OUTLINE' },
      chapterPlan: { chapterNo: 1, serverField: 'SERVER_PLAN' },
      chapterContext: { chapterNo: 1, serverField: 'SERVER_CONTEXT' },
      planText: '{"serverField": "SERVER_PLAN_TEXT"}'
    },
    onWriterCall: input => { capturedInput = input; }
  });

  const runId = 'run_adv_t1';
  const scope = { workspaceId: 'ws_adv', projectId: 'p_adv', actorUserId: 'u1' };
  const created = await orchestrator.create({
    ...scope,
    id: runId,
    chapterId: 'ch_mock',
    idempotencyKey: 'idem_adv_t1',
    requestHash: '1'.repeat(64),
    request: {
      id: runId,
      projectId: 'p_adv',
      chapterId: 'ch_mock',
      chapterNo: 1,
      chapterContract: { chapterId: 'ch_mock', chapterNo: 1, chapterGoal: '测验', wordBudget: { minChars: 10, maxChars: 500, targetChars: 50 } },
      storyContext: { continuity: { outline: clientOutline } }
    }
  });

  let finalRun = null;
  for (let i = 0; i < 60; i++) {
    finalRun = await store.getRun({}, { ...scope, id: created.run.id });
    if (finalRun && (finalRun.state === 'waiting_author' || finalRun.state === 'needs_human' || finalRun.state === 'failed')) break;
    await new Promise(r => setTimeout(r, 25));
  }

  assert.ok(['waiting_author', 'needs_human'].includes(finalRun.state));
  const authStoryContext = finalRun.result.authoritativeStoryContext;

  // 1. 现场大纲成功提升至 currentChapterOutline
  assert.equal(authStoryContext.currentChapterOutline, clientOutline);
  // 2. 现场大纲同步进 outlineContext.chapter.clientOutline
  assert.equal(authStoryContext.outlineContext.chapter.clientOutline, clientOutline);
  // 3. context.text 中旧根级别名不存在
  const contextText = capturedInput.context;
  assert.equal(contextText.includes('[chapterOutline]'), false);
  assert.equal(contextText.includes('[chapterPlan]'), false);
  assert.equal(contextText.includes('[chapterContext]'), false);
  assert.equal(contextText.includes('[planText]'), false);
});

// --------------------------------------------------------------------------
// TEST 2: 漏洞复现 - continuity 字段未在 assembleContext 清洗 outline，且 summary 为空时发生内部双写
// --------------------------------------------------------------------------
test('ADV-TEST-02 [CHALLENGE-FAIL]: context.text 接收多份大纲 (continuity.outline raw JSON 泄露与 summary 重复)', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-adv-02-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  let capturedInput = null;
  const clientOutline = '【现场细纲特异性标记】：萧炎退入人群冷笑！';

  const orchestrator = createMockOrchestrator(store, repository, {
    authoritativeStoryContext: {
      outlineContext: {
        chapter: { chapterNo: 1, title: '第一章', goal: '测验', beats: [], scenes: [], summary: '' },
        volume: { volumeNo: 1, title: '第一卷', goal: '', arcGoals: [], volumePlan: '' },
        dependencies: { prerequisiteEvents: [], foreshadows: [], causalDebts: [], nextChapterInterface: {} },
        meta: { revision: 1, outlineHash: 'a'.repeat(64), completenessTier: 'event_chain' }
      },
      chapterOutline: { chapterNo: 1 }
    },
    onWriterCall: input => { capturedInput = input; }
  });

  const runId = 'run_adv_t2';
  const scope = { workspaceId: 'ws_adv', projectId: 'p_adv', actorUserId: 'u1' };
  const created = await orchestrator.create({
    ...scope,
    id: runId,
    chapterId: 'ch_mock',
    idempotencyKey: 'idem_adv_t2',
    requestHash: '2'.repeat(64),
    request: {
      id: runId,
      projectId: 'p_adv',
      chapterId: 'ch_mock',
      chapterNo: 1,
      chapterContract: { chapterId: 'ch_mock', chapterNo: 1, chapterGoal: '测验', wordBudget: { minChars: 10, maxChars: 500, targetChars: 50 } },
      storyContext: { continuity: { outline: clientOutline } }
    }
  });

  let finalRun = null;
  for (let i = 0; i < 60; i++) {
    finalRun = await store.getRun({}, { ...scope, id: created.run.id });
    if (finalRun && (finalRun.state === 'waiting_author' || finalRun.state === 'needs_human' || finalRun.state === 'failed')) break;
    await new Promise(r => setTimeout(r, 25));
  }

  assert.ok(['waiting_author', 'needs_human'].includes(finalRun.state));
  const contextText = capturedInput.context;

  // 契约断言：context.text 接收且仅接收 1 份大纲，严禁旧 JSON 形式残留
  const occurrences = contextText.split(clientOutline).length - 1;
  const hasContinuityRawJson = contextText.includes('[continuity]') && contextText.includes(`"outline":"${clientOutline}"`);

  // 实证断言：此处应当且必须只有 1 份大纲，且严禁 continuity 携带原始 JSON 大纲泄露入模
  assert.equal(
    hasContinuityRawJson,
    false,
    `[BUG-1]: continuity 字段未做 outline 清洗，导致 [continuity] 块将大纲以 raw JSON 形式二次泄露入模`
  );
  assert.equal(
    occurrences,
    1,
    `[BUG-2]: 大纲在 context.text 中实际出现了 ${occurrences} 次 (包含 Markdown 内部 summary/clientOutline 重复及 continuity raw JSON 副本)，违反唯一性入模契约`
  );
});

// --------------------------------------------------------------------------
// TEST 3: 漏洞复现 - nextChapterOutline 别名未在 assembleContext 清洗
// --------------------------------------------------------------------------
test('ADV-TEST-03 [CHALLENGE-FAIL]: nextChapterOutline 未在 assembleContext 清洗，产生冗余独立 JSON 块', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-adv-03-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  let capturedInput = null;
  const nextChapterGoal = '次日前往坊市淘药';

  const orchestrator = createMockOrchestrator(store, repository, {
    authoritativeStoryContext: {
      outlineContext: {
        chapter: { chapterNo: 1, title: '第一章', goal: '测验', beats: [], scenes: [], summary: '' },
        volume: { volumeNo: 1, title: '第一卷', goal: '', arcGoals: [], volumePlan: '' },
        dependencies: { prerequisiteEvents: [], foreshadows: [], causalDebts: [], nextChapterInterface: {} },
        meta: { revision: 1, outlineHash: 'a'.repeat(64), completenessTier: 'event_chain' }
      }
    },
    onWriterCall: input => { capturedInput = input; }
  });

  const runId = 'run_adv_t3';
  const scope = { workspaceId: 'ws_adv', projectId: 'p_adv', actorUserId: 'u1' };
  const created = await orchestrator.create({
    ...scope,
    id: runId,
    chapterId: 'ch_mock',
    idempotencyKey: 'idem_adv_t3',
    requestHash: '3'.repeat(64),
    request: {
      id: runId,
      projectId: 'p_adv',
      chapterId: 'ch_mock',
      chapterNo: 1,
      chapterContract: { chapterId: 'ch_mock', chapterNo: 1, chapterGoal: '测验', wordBudget: { minChars: 10, maxChars: 500, targetChars: 50 } },
      storyContext: { continuity: { outline: '当章细纲', nextChapter: { goal: nextChapterGoal } } }
    }
  });

  let finalRun = null;
  for (let i = 0; i < 60; i++) {
    finalRun = await store.getRun({}, { ...scope, id: created.run.id });
    if (finalRun && (finalRun.state === 'waiting_author' || finalRun.state === 'needs_human' || finalRun.state === 'failed')) break;
    await new Promise(r => setTimeout(r, 25));
  }

  assert.ok(['waiting_author', 'needs_human'].includes(finalRun.state));
  const contextText = capturedInput.context;

  // 契约断言：outlineContext 已渲染下章承接，不得再出现 [nextChapterOutline] 原始 JSON 块
  const hasNextChapterOutlineBlock = contextText.includes('[nextChapterOutline]');
  assert.equal(
    hasNextChapterOutlineBlock,
    false,
    `[BUG-3]: nextChapterOutline 未在 assembleContext 中被 delete，导致产生 [nextChapterOutline] 独立原始 JSON 块`
  );
});

// --------------------------------------------------------------------------
// TEST 4: 漏洞复现 - 服务端预置 hookGoal 时，客户端现场 nextChapter.goal 被 !nci.hookGoal 遮蔽
// --------------------------------------------------------------------------
test('ADV-TEST-04 [CHALLENGE-FAIL]: 服务端预置 hookGoal 时，客户端现场 nextChapter.goal 被 !nci.hookGoal 遮蔽', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-adv-04-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const clientNextGoal = '【客户端现场意图】：次日前往米特尔拍卖行';
  const serverPreloadedHookGoal = '【服务端旧有预案】：次日后山苦修';

  const orchestrator = createMockOrchestrator(store, repository, {
    authoritativeStoryContext: {
      outlineContext: {
        chapter: { chapterNo: 1, title: '第一章', goal: '测验', beats: [], scenes: [], summary: '' },
        volume: { volumeNo: 1, title: '第一卷', goal: '', arcGoals: [], volumePlan: '' },
        dependencies: {
          prerequisiteEvents: [],
          foreshadows: [],
          causalDebts: [],
          // 服务端根据全书大纲树预生成的 nextChapterInterface
          nextChapterInterface: { hookGoal: serverPreloadedHookGoal, unresolvedTension: '旧悬念' }
        },
        meta: { revision: 1, outlineHash: 'a'.repeat(64), completenessTier: 'event_chain' }
      }
    }
  });

  const runId = 'run_adv_t4';
  const scope = { workspaceId: 'ws_adv', projectId: 'p_adv', actorUserId: 'u1' };
  const created = await orchestrator.create({
    ...scope,
    id: runId,
    chapterId: 'ch_mock',
    idempotencyKey: 'idem_adv_t4',
    requestHash: '4'.repeat(64),
    request: {
      id: runId,
      projectId: 'p_adv',
      chapterId: 'ch_mock',
      chapterNo: 1,
      chapterContract: { chapterId: 'ch_mock', chapterNo: 1, chapterGoal: '测验', wordBudget: { minChars: 10, maxChars: 500, targetChars: 50 } },
      storyContext: {
        continuity: {
          outline: '当章大纲',
          nextChapter: { goal: clientNextGoal }
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

  assert.ok(['waiting_author', 'needs_human'].includes(finalRun.state));
  const authStoryContext = finalRun.result.authoritativeStoryContext;
  const nci = authStoryContext.outlineContext.dependencies.nextChapterInterface;

  // 契约断言：客户端现场显式传入的 nextChapter 规划必须覆盖服务端旧预案，不得被遮蔽
  assert.equal(
    nci.hookGoal,
    clientNextGoal,
    `[BUG-4]: orchestrator.js:299 的 "!nci.hookGoal" 守卫导致客户端现场 nextChapter 目标被服务端旧 hookGoal 遮蔽`
  );
});

// --------------------------------------------------------------------------
// TEST 5: 验证 assembleContext 单元级别在纯净输入时的去重功能
// --------------------------------------------------------------------------
test('ADV-TEST-05 [ROBUST]: assembleContext 单元级别在无 continuity 干扰时清洗 legacy 别名有效', () => {
  const canonical = {
    chapter: {
      chapterId: 'ch_01',
      chapterNo: 1,
      title: '第一章',
      goal: '测验',
      beats: ['节拍1'],
      scenes: [],
      summary: '概要',
      clientOutline: '【现场细纲约束】'
    },
    volume: { volumeNo: 1, title: '第一卷', goal: '', arcGoals: [], volumePlan: '' },
    dependencies: { prerequisiteEvents: [], foreshadows: [], causalDebts: [], nextChapterInterface: {} },
    meta: { revision: 1, outlineHash: 'x'.repeat(64), completenessTier: 'event_chain' }
  };

  const input = {
    outlineContext: canonical,
    chapterOutline: { leaked: 'DATA1' },
    chapterPlan: { leaked: 'DATA2' },
    chapterContext: { leaked: 'DATA3' },
    planText: '{"leaked": "DATA4"}',
    currentChapterOutline: '【现场细纲约束】'
  };

  const { text, blocks } = assembleContext(input, {
    model: 'gpt-4o',
    hardLimit: 50000
  });

  const blockIds = blocks.map(b => b.id);
  assert.ok(blockIds.includes('outlineContext'));
  assert.equal(blockIds.includes('chapterOutline'), false);
  assert.equal(blockIds.includes('chapterPlan'), false);
  assert.equal(blockIds.includes('chapterContext'), false);
  assert.equal(blockIds.includes('planText'), false);
  assert.equal(blockIds.includes('currentChapterOutline'), false);

  assert.equal(text.includes('DATA1'), false);
  assert.equal(text.includes('DATA2'), false);
  assert.equal(text.includes('DATA3'), false);
  assert.equal(text.includes('DATA4'), false);
});
