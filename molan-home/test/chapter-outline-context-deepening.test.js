'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { assembleContext, formatOutlineContextMarkdown, BLOCK_TO_LAYER, PRIORITY } = require('../lib/generation/context');
const { createGenerationOrchestrator } = require('../lib/generation/orchestrator');
const { createJsonGenerationStore } = require('../lib/generation/json-store');
const { JsonFileRepository } = require('../lib/repositories/json-file-repository');
const { contractHash } = require('../lib/generation/contract');
const { buildGenerationManifest, hashValue } = require('../lib/generation/manifest');
const { createQualityAssessment } = require('../lib/generation/quality-assessment');
const { GenerationError } = require('../lib/generation/errors');
const {
  createGenerationService,
  buildCanonicalOutlineContext,
  extractAuthoritativeChapters
} = require('../services/generation-service');

function setupMockGenerationService() {
  return createGenerationService({
    CLOUD_API_BASE: 'http://mock-api',
    DATA_DIR: 'mock-data',
    GenerationError,
    MAX_NOVEL_STATE_BYTES: 1024 * 1024,
    POSTGRES_MODE: false,
    attachResponseDisconnect: () => {},
    authenticateXuanhuanCloud: () => ({ ok: true }),
    benchmarkPipeline: {},
    calcWordCount: () => 100,
    calculateBenchmarkCallTimeoutMs: () => 1000,
    callMolanChat: async () => ({ text: 'mock' }),
    canonicalResolveGenre: g => ({ genre: g || '玄幻' }),
    contentEngine: {},
    createGenerationOrchestrator,
    creationChapterContext: (biblePayload, chapterNo) => ({
      chapterNo,
      title: `第${chapterNo}章 考核开始`,
      goal: `第${chapterNo}章核心目标：通过考核`,
      characters: [{ name: '萧炎' }],
      characterLibrary: [],
      rules: ['斗气法则'],
      scenePlan: [{ id: 's1', goal: '步入大厅' }],
      openForeshadows: [{ id: 'f1', name: '神秘残图' }]
    }),
    crypto,
    currentDefaultModel: () => 'gemini-3.8-flash-high',
    dbReady: () => true,
    decodePathParam: v => v,
    generationManifest: {
      hashValue: obj => crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex')
    },
    generationProviderRequestId: () => 'mock-req-id',
    generationRunContext: {
      requestHash: () => 'mock-hash'
    },
    generationRunStore: () => ({}),
    generationScenePatch: {},
    generationV2Enabled: () => true,
    generationV2Status: () => ({ enabled: true }),
    getAuthUser: () => ({ userId: 'u1' }),
    getUserByEmail: () => null,
    json: () => {},
    loadCreationSnapshots: () => [],
    loadCurrentBiblePayload: () => ({
      bibleId: 'b1',
      version: 1,
      payload: {
        creationPlan: {
          volumePlan: [{ volumeNo: 1, title: '乌坦风云', goal: '打破耻辱' }],
          arcPlan: [{ goal: '积累初期资源' }]
        }
      }
    }),
    path,
    projectScope: {
      WRITE_ROLES: ['owner', 'editor'],
      canAccess: () => true
    },
    sanitizeNovelStateForStorage: s => s
  });
}

test('M1-01: buildCanonicalOutlineContext 标准化组装 chapter / volume / dependencies / meta 契约', () => {
  const novelState = {
    volumes: [
      {
        id: 'vol_01',
        volumeNo: 1,
        title: '第一卷 乌坦城风云',
        goal: '打破退婚耻辱，立下三年之约',
        chapters: [
          { id: 'ch_01', title: '第一章 陨落的天才' },
          { id: 'ch_02', title: '第二章 斗气大陆' },
          { id: 'ch_03', title: '第三章 炼药师工会' }
        ]
      }
    ]
  };

  const biblePayload = {
    creationPlan: {
      volumePlan: [
        { volumeNo: 1, title: '第一卷 乌坦城风云', goal: '打破退婚耻辱', plan: '前期资源积累' }
      ],
      arcPlan: [
        { goal: '结识雅妃，借力炼药师工会' },
        { goal: '突破斗者瓶颈' }
      ],
      chapterPlan: [
        { chapterNo: 1, title: '第一章', goal: '测验斗之气' },
        { chapterNo: 2, title: '第二章', goal: '了解世界规则' },
        {
          chapterNo: 3,
          title: '第三章 炼药师工会',
          goal: '通过一品炼药师考核，引起雅妃注意',
          beats: ['抵达工会遭受轻视', '展现精纯控火', '药老暗中指点成丹', '考核官惊叹'],
          scenes: [{ id: 's1', goal: '考核大厅' }],
          summary: '萧炎考核一品炼药师',
          sceneDirectives: [{ directive: '注意药老传音的隐秘感' }]
        },
        {
          chapterNo: 4,
          title: '第四章 坊市淘药',
          goal: '利用炼药师身份采购筑基灵药',
          tension: '加列家族在坊市暗中盯梢'
        }
      ]
    }
  };

  const previous = {
    timeline: ['萧炎离开后山', '换上神秘黑袍'],
    openForeshadows: [{ id: 'f_ring', name: '黑色古戒初次发热' }],
    recentFacts: []
  };

  const factLedger = {
    rules: [{ description: '炼药师分为一至九品' }],
    promises: [{ description: '答应药老保守苏醒秘密' }]
  };

  const canonical = buildCanonicalOutlineContext({
    novelState,
    biblePayload,
    chapterNo: 3,
    chapterId: 'ch_03',
    request: { chapterId: 'ch_03', chapterNo: 3 },
    contract: { chapterId: 'ch_03', chapterNo: 3, chapterGoal: '通过一品炼药师考核' },
    previous,
    factLedger,
    projectRevision: 5
  });

  // 1. chapter 契约断言
  assert.equal(canonical.chapter.chapterId, 'ch_03');
  assert.equal(canonical.chapter.chapterNo, 3);
  assert.equal(canonical.chapter.title, '第三章 炼药师工会');
  assert.equal(canonical.chapter.goal, '通过一品炼药师考核');
  assert.equal(canonical.chapter.beats.length, 4);
  assert.equal(canonical.chapter.beats[0], '抵达工会遭受轻视');
  assert.equal(canonical.chapter.scenes.length, 1);
  assert.equal(canonical.chapter.summary, '萧炎考核一品炼药师');
  assert.equal(canonical.chapter.sceneDirectives.length, 1);

  // 2. volume 契约断言
  assert.equal(canonical.volume.volumeId, 'vol_01');
  assert.equal(canonical.volume.volumeNo, 1);
  assert.equal(canonical.volume.title, '第一卷 乌坦城风云');
  assert.equal(canonical.volume.goal, '打破退婚耻辱，立下三年之约');
  assert.equal(canonical.volume.arcGoals.length, 2);
  assert.equal(canonical.volume.arcGoals[0], '结识雅妃，借力炼药师工会');

  // 3. dependencies 契约断言
  assert.ok(canonical.dependencies.prerequisiteEvents.length > 0);
  assert.equal(canonical.dependencies.foreshadows.length, 1);
  assert.equal(canonical.dependencies.foreshadows[0].name, '黑色古戒初次发热');
  assert.equal(canonical.dependencies.causalDebts.length, 1);
  assert.equal(canonical.dependencies.causalDebts[0].description, '答应药老保守苏醒秘密');
  assert.equal(canonical.dependencies.nextChapterInterface.hookGoal, '利用炼药师身份采购筑基灵药');
  assert.equal(canonical.dependencies.nextChapterInterface.unresolvedTension, '加列家族在坊市暗中盯梢');

  // 4. meta 契约断言
  assert.equal(canonical.meta.revision, 5);
  assert.match(canonical.meta.outlineHash, /^[a-f0-9]{64}$/);
  assert.equal(canonical.meta.completenessTier, 'full_scenes');
});

test('M1-02: buildCanonicalOutlineContext completenessTier 三态完备度推导', () => {
  // 态 1: 拥有 scenes 列表 -> 'full_scenes'
  const tier1 = buildCanonicalOutlineContext({
    chapter: {
      scenes: [{ id: 's1', goal: '打脸反派' }]
    }
  });
  assert.equal(tier1.meta.completenessTier, 'full_scenes');

  // 态 2: 无 scenes 但拥有 beats 事件链 -> 'event_chain'
  const tier2 = buildCanonicalOutlineContext({
    chapter: {
      scenes: [],
      beats: ['起步', '冲突', '逆转', '高潮']
    }
  });
  assert.equal(tier2.meta.completenessTier, 'event_chain');

  // 态 3: 无 scenes 无 beats 仅有目标 -> 'goal_only'
  const tier3 = buildCanonicalOutlineContext({
    chapter: {
      scenes: [],
      beats: [],
      goal: '仅有目标推进'
    }
  });
  assert.equal(tier3.meta.completenessTier, 'goal_only');
});

test('M1-03: loadAuthoritativeGenerationContext 挂载 outlineContext 并保持旧字段向后兼容', async () => {
  const service = setupMockGenerationService();
  const novelState = {
    volumes: [
      {
        id: 'vol_main',
        title: '第一卷',
        chapters: [{ id: 'ch_test_1', title: '第1章' }]
      }
    ]
  };

  // 通过 buildCanonicalOutlineContext 直接调用验证
  const outline = service.buildCanonicalOutlineContext({
    novelState,
    chapterNo: 1,
    chapterId: 'ch_test_1',
    chapterContext: {
      chapterNo: 1,
      title: '第1章',
      goal: '开篇测试',
      openForeshadows: [{ name: '伏笔' }],
      rules: ['规则']
    }
  });
  assert.ok(outline, 'outlineContext 必须成功生成');
  assert.equal(outline.chapter.chapterNo, 1);
  assert.equal(outline.chapter.title, '第1章');
  assert.equal(outline.volume.title, '第一卷');
  assert.equal(outline.dependencies.foreshadows[0].name, '伏笔');
});

test('M1-04: orchestrator 修复遮蔽 Bug：即使服务端 chapterOutline 存在对象，客户端现场大纲仍提升并同步进 outlineContext', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-m1-orch-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const rawDraftText = '测试正文内容，展现剧情冲突与转折。';
  const draftText = rawDraftText;

  const initialOutlineContext = {
    chapter: {
      chapterId: 'ch_test',
      chapterNo: 1,
      title: '第一章 陨落的天才',
      goal: '萧炎测验斗之气',
      beats: ['魔石碑报数'],
      scenes: [],
      summary: '',
      sceneDirectives: []
    },
    volume: {
      volumeId: 'vol_1',
      volumeNo: 1,
      title: '第一卷 乌坦城',
      goal: '三年之约',
      arcGoals: [],
      volumePlan: ''
    },
    dependencies: {
      prerequisiteEvents: [],
      foreshadows: [],
      causalDebts: [],
      nextChapterInterface: { hookGoal: '', unresolvedTension: '' }
    },
    meta: {
      revision: 1,
      outlineHash: 'a'.repeat(64),
      completenessTier: 'event_chain'
    }
  };

  const orchestrator = createGenerationOrchestrator({
    store,
    db: repository,
    dependencies: {
      resolveGenre: async () => ({ status: 'resolved', genre: '玄幻' }),
      resolveStyle: async () => ({ status: 'resolved', style: '冷峻' }),
      loadAuthoritativeContext: async () => ({
        ok: true,
        snapshotHash: 'mock-snap-hash',
        storyContext: {
          outlineContext: initialOutlineContext,
          // 模拟服务端权威状态总是存在的 chapterOutline 对象
          chapterOutline: {
            chapterNo: 1,
            serverField: '服务端大纲，过去会遮蔽现场细纲'
          },
          chapterContext: { chapterNo: 1 },
          characters: [{ name: '萧炎' }],
          factLedger: { rules: [] },
          continuity: {
            characters: [{ name: '萧炎' }],
            worldRules: []
          }
        }
      }),
      preGenerationGuard: async () => ({ passed: true, snapshotHash: 'mock-snap-hash' }),
      planScenes: async () => [{ id: 's1', goal: '测验魔石碑' }],
      writer: async ({ request, contract, contextPlan }) => ({
        text: draftText,
        manifest: buildGenerationManifest({
          generationId: 'run_m1_test',
          projectId: 'p_test',
          chapterId: 'ch_test',
          pipelineVersion: 'content-engine-v2',
          contextHash: contextPlan.contextHash,
          contractHash: contractHash(contract),
          promptHash: 'prompt-hash-test',
          outputHash: hashValue(draftText)
        })
      }),
      deterministicAudit: async () => ({ passed: true, issues: [], blockerCount: 0, unverifiedCount: 0 }),
      semanticAudit: async () => ({ passed: true, status: 'MEASURED', issues: [], blockerCount: 0, dimensions: {} }),
      qualityAudit: async ({ draft }) => createQualityAssessment({
        genre: '玄幻',
        contentDigest: hashValue(draft),
        compliance: { passed: true, checks: { length: { passed: true } } },
        literary: { passed: true, score: 0.90, confidence: 0.95 }
      }),
      commit: async () => ({ committed: true, snapshotId: 'snap-final', contentHash: hashValue(draftText) })
    }
  });

  const request = {
    projectId: 'p_test',
    chapterId: 'ch_test',
    chapterNo: 1,
    chapterContract: {
      chapterId: 'ch_test',
      chapterNo: 1,
      chapterGoal: '萧炎测验斗之气',
      wordBudget: { minChars: 10, maxChars: 500, targetChars: 50 }
    },
    storyContext: {
      continuity: {
        outline: '【客户端现场细纲硬约束】：绝不可提前暴露玄重尺，必须退入人群冷笑！',
        nextChapter: {
          goal: '次日前往坊市淘换筑基灵液药材',
          unresolvedTension: '加列毕暗中盯梢'
        }
      }
    }
  };

  const scope = { workspaceId: 'ws_test', projectId: 'p_test', actorUserId: 'u1' };
  const runId = 'run_m1_test';
  const created = await orchestrator.create({
    ...scope,
    id: runId,
    chapterId: 'ch_test',
    idempotencyKey: 'idem_m1_test',
    requestHash: 'd'.repeat(64),
    request
  });

  let finalRun = null;
  for (let i = 0; i < 60; i++) {
    finalRun = await store.getRun({}, { ...scope, id: created.run.id });
    if (finalRun && (finalRun.state === 'waiting_author' || finalRun.state === 'needs_human' || finalRun.state === 'failed')) {
      break;
    }
    await new Promise(r => setTimeout(r, 25));
  }

  assert.ok(finalRun, '任务必须产出执行状态');
  assert.ok(['waiting_author', 'needs_human'].includes(finalRun.state), '任务必须顺利完成');

  const authStoryContext = (finalRun.result && finalRun.result.authoritativeStoryContext) || finalRun.authoritativeStoryContext;
  assert.ok(authStoryContext, 'authoritativeStoryContext 必须存在');

  // 关键断言 1: 现场大纲即便在服务端 chapterOutline 为对象的情况下，也被成功提升到 currentChapterOutline
  assert.equal(authStoryContext.currentChapterOutline, '【客户端现场细纲硬约束】：绝不可提前暴露玄重尺，必须退入人群冷笑！');

  // 关键断言 2: 现场大纲被成功同步进 outlineContext.chapter.clientOutline
  assert.ok(authStoryContext.outlineContext, 'outlineContext 必须存在');
  assert.equal(authStoryContext.outlineContext.chapter.clientOutline, '【客户端现场细纲硬约束】：绝不可提前暴露玄重尺，必须退入人群冷笑！');

  // 关键断言 3: 现场下章承接被同步进 outlineContext.dependencies.nextChapterInterface
  assert.equal(authStoryContext.outlineContext.dependencies.nextChapterInterface.hookGoal, '次日前往坊市淘换筑基灵液药材');
  assert.equal(authStoryContext.outlineContext.dependencies.nextChapterInterface.unresolvedTension, '加列毕暗中盯梢');
});

test('M1-05: assembleContext 编译器唯一性渲染：登记 L2_chapter (Priority 0)，清洗别名并杜绝 double-JSON', () => {
  // 1. 验证元数据配置
  assert.equal(BLOCK_TO_LAYER.outlineContext, 'L2_chapter', 'outlineContext 必须映射到 L2_chapter');
  assert.equal(PRIORITY.outlineContext, 0, 'outlineContext 优先级必须为 0');

  const canonicalOutline = {
    chapter: {
      chapterId: 'ch_03',
      chapterNo: 3,
      title: '炼药师工会',
      goal: '通过一品炼药师考核',
      beats: ['抵达工会', '展现控火', '成功成丹'],
      scenes: [],
      summary: '考核一品炼药师',
      sceneDirectives: []
    },
    volume: {
      volumeId: 'vol_01',
      volumeNo: 1,
      title: '乌坦城风云',
      goal: '打破退婚耻辱',
      arcGoals: ['积累资本'],
      volumePlan: '前期起势'
    },
    dependencies: {
      prerequisiteEvents: ['药老初步苏醒'],
      foreshadows: [{ name: '古戒' }],
      causalDebts: [{ description: '承诺保守秘密' }],
      nextChapterInterface: {
        hookGoal: '坊市淘药',
        unresolvedTension: '加列家密谋'
      }
    },
    meta: {
      revision: 1,
      outlineHash: '1234567890abcdef',
      completenessTier: 'event_chain'
    }
  };

  const hugeDuplicateObject = {
    chapterNo: 3,
    title: '炼药师工会',
    hugeData: 'x'.repeat(2000)
  };

  const inputWithDuplicates = {
    sceneContract: { goal: '考核' },
    outlineContext: canonicalOutline,
    chapterOutline: hugeDuplicateObject, // 别名 1
    chapterContext: hugeDuplicateObject, // 别名 2
    chapterPlan: hugeDuplicateObject,    // 别名 3
    planText: JSON.stringify(hugeDuplicateObject), // 别名 4
    currentChapterOutline: '考核一品炼药师' // 别名 5
  };

  const { text, blocks, contextPlan } = assembleContext(inputWithDuplicates, {
    model: 'gpt-4o',
    hardLimit: 100000,
    outputReserve: 1000
  });

  // 1. 断言分层归属与唯一性
  assert.ok(contextPlan.layers.L2_chapter.includes('outlineContext'), 'outlineContext 必须在 L2_chapter');
  assert.ok(contextPlan.requiredBlocks.includes('outlineContext'), 'outlineContext 必须属于 requiredBlocks');

  const blockIds = blocks.map(b => b.id);
  assert.ok(blockIds.includes('outlineContext'), 'outlineContext 必须被包含在渲染块中');

  // 2. 断言所有旧的别名字段被完全清理清洗，绝无 double-JSON
  assert.ok(!blockIds.includes('chapterOutline'), 'chapterOutline 必须被剔除');
  assert.ok(!blockIds.includes('chapterContext'), 'chapterContext 必须被剔除');
  assert.ok(!blockIds.includes('chapterPlan'), 'chapterPlan 必须被剔除');
  assert.ok(!blockIds.includes('planText'), 'planText 必须被剔除');
  assert.ok(!blockIds.includes('currentChapterOutline'), 'currentChapterOutline 必须被剔除');

  // 3. 断言文本输出为 Markdown 且无旧 JSON 块
  assert.match(text, /\[outlineContext\]/);
  assert.match(text, /【当前章节目标与核心节拍】/);
  assert.match(text, /【所属卷与剧情主线弧线】/);
  assert.match(text, /【前置因果依赖与下章承接接口】/);
  assert.doesNotMatch(text, /\[chapterOutline\]/);
  assert.doesNotMatch(text, /\[chapterContext\]/);
  assert.doesNotMatch(text, /\[chapterPlan\]/);
  assert.doesNotMatch(text, /\[planText\]/);

  // 4. 断言巨大冗余文本没有出现在最终 Prompt 中
  assert.equal(text.includes('x'.repeat(2000)), false, '巨型重复别名数据绝不可入模膨胀');
});

test('M1-06: formatOutlineContextMarkdown 紧凑结构与 Token 节约率验证', () => {
  const data = {
    chapter: {
      chapterId: 'ch_1',
      chapterNo: 1,
      title: '陨落的天才',
      goal: '魔石碑测验受辱',
      beats: ['斗之气三段', '众人嘲讽', '萧炎冷笑'],
      clientOutline: '不可暴露古戒'
    },
    volume: {
      volumeNo: 1,
      title: '乌坦城',
      goal: '打破退婚耻辱',
      arcGoals: ['药老苏醒']
    },
    dependencies: {
      prerequisiteEvents: ['三年前修为倒退'],
      nextChapterInterface: {
        hookGoal: '坊市偶遇薰儿',
        unresolvedTension: '三年之约前夕'
      }
    }
  };

  const md = formatOutlineContextMarkdown(data);
  assert.match(md, /第 1 章《陨落的天才》/);
  assert.match(md, /核心目标：魔石碑测验受辱/);
  assert.match(md, /所属卷：第 1 卷·乌坦城 \(卷目标：打破退婚耻辱\)/);
  assert.match(md, /前置依赖：1\. 三年前修为倒退/);
  assert.match(md, /下章承接：核心钩子：坊市偶遇薰儿，未解悬念：三年之约前夕/);

  // 相比直接 JSON.stringify(data)，Markdown 格式没有大量的引号、转义符和花括号
  const jsonLen = JSON.stringify(data, null, 2).length;
  const mdLen = md.length;
  assert.ok(mdLen < jsonLen, `Markdown 格式 (${mdLen}) 应比格式化 JSON (${jsonLen}) 更为紧凑`);
});

test('M1-07: assembleContext handles frozen inputs and prevents in-place mutation crash', () => {
  const frozenOutline = Object.freeze({
    chapter: Object.freeze({
      chapterNo: 1,
      title: '第一章',
      goal: '测验斗之气'
    }),
    volume: Object.freeze({
      volumeNo: 1,
      title: '乌坦城'
    }),
    dependencies: Object.freeze({}),
    meta: Object.freeze({ revision: 1 })
  });

  const input = {
    outlineContext: frozenOutline,
    currentChapterOutline: '【现场细纲】：萧炎不可暴露古戒'
  };

  // Must not throw TypeError: Cannot add property clientOutline, object is not extensible
  let result;
  assert.doesNotThrow(() => {
    result = assembleContext(input, { model: 'gpt-4o' });
  });

  assert.ok(result);
  assert.match(result.text, /现场细纲约束：【现场细纲】：萧炎不可暴露古戒/);
  // Ensure original frozen object was not mutated
  assert.equal(frozenOutline.chapter.clientOutline, undefined);
});

test('M1-08: assembleContext unconditional alias suppression for object and string variants', () => {
  const canonicalOutline = buildCanonicalOutlineContext({
    chapter: { chapterNo: 1, title: '第一章', goal: '测验' }
  });

  const input = {
    outlineContext: canonicalOutline,
    chapterOutline: { summary: '旧大纲' },
    chapterContext: { summary: '旧上下文' },
    chapterPlan: { summary: '旧计划' },
    planText: '旧计划文本',
    currentChapterOutline: { outline: '现场大纲对象' },
    outline: { summary: '旧通用大纲' },
    outlineDependencies: { deps: '旧依赖' },
    nextChapterOutline: '旧下章大纲'
  };

  const { blocks, text } = assembleContext(input, { model: 'gpt-4o' });
  const blockIds = blocks.map(b => b.id);

  assert.ok(blockIds.includes('outlineContext'));
  assert.ok(!blockIds.includes('chapterOutline'));
  assert.ok(!blockIds.includes('chapterContext'));
  assert.ok(!blockIds.includes('chapterPlan'));
  assert.ok(!blockIds.includes('planText'));
  assert.ok(!blockIds.includes('currentChapterOutline'));
  assert.ok(!blockIds.includes('outline'));
  assert.ok(!blockIds.includes('outlineDependencies'));
  assert.ok(!blockIds.includes('nextChapterOutline'));

  assert.doesNotMatch(text, /\[chapterOutline\]/);
  assert.doesNotMatch(text, /\[currentChapterOutline\]/);
  assert.doesNotMatch(text, /\[nextChapterOutline\]/);
});

test('M1-09: assembleContext purges continuity outline/nextChapter to prevent prompt raw JSON leak', () => {
  const canonicalOutline = buildCanonicalOutlineContext({
    chapter: { chapterNo: 1, title: '第一章', goal: '测验' }
  });

  // Scenario A: Continuity with characters + outline + nextChapter
  const inputA = {
    outlineContext: canonicalOutline,
    continuity: {
      characters: ['萧炎', '薰儿'],
      outline: '【现场细纲特异性标记】：萧炎退入人群冷笑！',
      nextChapter: { goal: '次日前往米特尔拍卖行' }
    }
  };

  const resA = assembleContext(inputA, { model: 'gpt-4o' });
  assert.match(resA.text, /\[continuity\]/);
  const continuityBlockA = resA.blocks.find(b => b.id === 'continuity');
  assert.ok(continuityBlockA);
  assert.doesNotMatch(continuityBlockA.content, /"outline"/);
  assert.doesNotMatch(continuityBlockA.content, /"nextChapter"/);
  assert.match(continuityBlockA.content, /"萧炎"/);

  // Scenario B: Continuity with ONLY outline and nextChapter -> block should be removed completely
  const inputB = {
    outlineContext: canonicalOutline,
    continuity: {
      outline: '【现场细纲特异性标记】：萧炎退入人群冷笑！',
      nextChapter: { goal: '次日前往米特尔拍卖行' }
    }
  };

  const resB = assembleContext(inputB, { model: 'gpt-4o' });
  const continuityBlockB = resB.blocks.find(b => b.id === 'continuity');
  assert.equal(continuityBlockB, undefined);
  assert.doesNotMatch(resB.text, /\[continuity\]/);
});

test('M1-10: buildCanonicalOutlineContext handles null and malformed inputs gracefully', () => {
  assert.doesNotThrow(() => {
    const res = buildCanonicalOutlineContext(null);
    assert.ok(res);
    assert.equal(res.chapter.chapterNo, 1);
    assert.equal(typeof res.meta.outlineHash, 'string');
    assert.equal(res.meta.completenessTier, 'goal_only');
  });

  assert.doesNotThrow(() => {
    const res = buildCanonicalOutlineContext('some string');
    assert.ok(res);
  });
});

test('M1-11: formatOutlineContextMarkdown formatting edge cases', () => {
  // Case A: summary === clientOutline, summary is deduplicated
  const dataA = {
    chapter: {
      chapterNo: 1,
      title: '第一章',
      goal: '测验',
      summary: '相同的大纲描述',
      clientOutline: '相同的大纲描述'
    }
  };
  const mdA = formatOutlineContextMarkdown(dataA);
  const summaryMatches = (mdA.match(/章节概要/g) || []).length;
  assert.equal(summaryMatches, 0, 'When summary === clientOutline, summary line must be suppressed');
  assert.match(mdA, /现场细纲约束：相同的大纲描述/);

  // Case B: empty Section 3 omits header
  const dataB = {
    chapter: { chapterNo: 1, title: '第一章', goal: '测验' },
    volume: { volumeNo: 1, title: '第一卷' },
    dependencies: {}
  };
  const mdB = formatOutlineContextMarkdown(dataB);
  assert.doesNotMatch(mdB, /【前置因果依赖与下章承接接口】/);

  // Case C: foreshadow objects have 1-based indexing and sparse nullish filtered
  const dataC = {
    chapter: {
      chapterNo: 1,
      beats: [null, undefined, '', '有效节拍一', {}]
    },
    dependencies: {
      foreshadows: [{ name: '伏笔一' }, { description: '伏笔二' }]
    }
  };
  const mdC = formatOutlineContextMarkdown(dataC);
  assert.match(mdC, /关键节拍：1\. 有效节拍一/);
  assert.match(mdC, /关键伏笔：1\. 伏笔一；2\. 伏笔二/);
});
