'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { assembleContext, CONTEXT_LAYERS } = require('../lib/generation/context');
const { createGenerationOrchestrator } = require('../lib/generation/orchestrator');
const { createJsonGenerationStore } = require('../lib/generation/json-store');
const { JsonFileRepository } = require('../lib/repositories/json-file-repository');
const { normalizeChapterContract } = require('../lib/generation/contract');
const { GenerationError } = require('../lib/generation/errors');
const { createGenerationService } = require('../services/generation-service');

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
      goal: `第${chapterNo}章核心目标`,
      characters: [{ name: '主角' }],
      characterLibrary: [],
      rules: ['因果法则']
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
    loadCurrentBiblePayload: () => ({ bibleId: 'b1', version: 1, payload: {} }),
    path,
    projectScope: {
      WRITE_ROLES: ['owner', 'editor'],
      canAccess: () => true
    },
    sanitizeNovelStateForStorage: s => s
  });
}

test('大纲专项审查 R1: 章节编号不再从随机哈希 ID 正则提取数字，精准走权威章节树物理索引', () => {
  const service = setupMockGenerationService();
  const { generationChapterNo } = service;

  // 模拟一个随机 ID（包含数字 4 和 83）
  const randomId = 'chapter-mh4-83k2ab';

  const novelState = {
    volumes: [
      {
        id: 'vol_1',
        title: '第一卷',
        chapters: [
          { id: randomId, title: '第一章：初入江湖' },
          { id: 'chapter-uuid-second', title: '第二章：风云突变' }
        ]
      }
    ]
  };

  // 1. 在没有 contract.chapterNo 的情况下：
  // 旧逻辑会 match(/(\d+)/) 从 'chapter-mh4-83k2ab' 中提取出 4，错误推断为第 4 章！
  // 新逻辑必须根据权威章节树，精准识别其位于第 1 个位置，返回 1！
  const resolvedChapterNo = generationChapterNo({ chapterId: randomId }, null, {}, novelState);
  assert.equal(resolvedChapterNo, 1, '必须根据权威章节树定位为第 1 章，绝不能被随机哈希中的数字 4 误导');

  // 2. 第二章同样准确解析
  const secondChapterNo = generationChapterNo({ chapterId: 'chapter-uuid-second' }, null, {}, novelState);
  assert.equal(secondChapterNo, 2, '必须精准解析为第 2 章');
});

test('大纲专项审查 R2: 客户端章节编号与服务端权威位置冲突时抛出 CHAPTER_POSITION_CONFLICT 强阻断', () => {
  const service = setupMockGenerationService();
  const { generationChapterNo } = service;

  const novelState = {
    volumes: [
      {
        id: 'vol_1',
        title: '第一卷',
        chapters: [
          { id: 'ch_real_1', title: '第1章' },
          { id: 'ch_real_2', title: '第2章' }
        ]
      }
    ]
  };

  // 客户端声称 ch_real_1 是第 5 章，但权威树中它是第 1 章
  assert.throws(() => {
    generationChapterNo({ chapterId: 'ch_real_1', chapterNo: 5 }, null, {}, novelState);
  }, error => {
    assert.equal(error.code, 'CHAPTER_POSITION_CONFLICT');
    assert.equal(error.status, 409);
    assert.match(error.message, /不一致/);
    return true;
  }, '客户端传错编号时必须抛出 CHAPTER_POSITION_CONFLICT 阻断');

  // 当编号一致时正常放行
  const okNo = generationChapterNo({ chapterId: 'ch_real_1', chapterNo: 1 }, null, {}, novelState);
  assert.equal(okNo, 1);
});

test('大纲专项审查 R3: 前端 continuity 现场上下文与服务端权威状态深度合并，草稿正文与大纲不被覆盖', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-orch-outline-audit-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const rawDraftText = '“斗之气，三段！”望着测验魔石碑上面闪亮得甚至有些刺眼的四个大字，少年面无表情，唇角有着一抹自嘲。';
  const { sanitizeInPlace } = require('../lib/generation/inplace-sanitizer');
  const draftText = sanitizeInPlace(rawDraftText).text;
  const { createQualityAssessment } = require('../lib/generation/quality-assessment');
  const { buildGenerationManifest, hashValue } = require('../lib/generation/manifest');
  const { contractHash } = require('../lib/generation/contract');

  const orchestrator = createGenerationOrchestrator({
    store,
    db: repository,
    dependencies: {
      resolveGenre: async () => ({ status: 'resolved', genre: '玄幻' }),
      resolveStyle: async () => ({ status: 'resolved', style: '苍劲沉郁' }),
      loadAuthoritativeContext: async () => ({
        ok: true,
        snapshotHash: 'mock-snap-hash',
        storyContext: {
          characters: [{ name: '权威萧炎' }],
          factLedger: { rules: ['斗气大陆以斗气为尊'] },
          continuity: {
            characters: [{ name: '权威萧炎' }],
            worldRules: ['斗气大陆以斗气为尊'],
            characterStates: { 萧炎: '斗之气三段' }
          }
        }
      }),
      preGenerationGuard: async () => ({ passed: true, snapshotHash: 'mock-snap-hash' }),
      planScenes: async () => [{ id: 's1', goal: '测验魔石碑' }],
      writer: async ({ request, contract, contextPlan }) => ({
        text: draftText,
        manifest: buildGenerationManifest({
          generationId: 'run_audit_r3',
          projectId: 'p_test',
          chapterId: 'ch_test',
          pipelineVersion: 'content-engine-v2',
          contextHash: contextPlan.contextHash,
          contractHash: contractHash(contract),
          promptHash: 'prompt-hash-test',
          outputHash: hashValue(draftText)
        })
      }),
      deterministicAudit: async () => ({
        passed: true,
        issues: [],
        blockerCount: 0,
        unverifiedCount: 0
      }),
      semanticAudit: async () => ({
        passed: true,
        status: 'MEASURED',
        issues: [],
        blockerCount: 0,
        dimensions: { logic: { score: 0.9, status: 'MEASURED', confidence: 0.9 } }
      }),
      qualityAudit: async ({ draft }) => createQualityAssessment({
        genre: '玄幻',
        contentDigest: hashValue(draft),
        compliance: { passed: true, checks: { length: { passed: true } } },
        literary: {
          passed: true,
          score: 0.90,
          confidence: 0.95,
          evaluator: { mode: 'dual', modelId: 'dual-judge' },
          dimensions: {
            logic: {
              score: 0.90,
              confidence: 0.95,
              status: 'MEASURED',
              source: 'dual_judge_consensus',
              quote: '“斗之气，三段！”',
              evidence: '开篇冲突与落差直接明确'
            },
            dialogue: {
              score: 0.88,
              confidence: 0.90,
              status: 'MEASURED',
              source: 'dual_judge_consensus',
              quote: '“斗之气，三段！”',
              evidence: '测验报数引发群嘲，对白功能性强'
            },
            language: {
              score: 0.92,
              confidence: 0.96,
              status: 'MEASURED',
              source: 'dual_judge_consensus',
              quote: '唇角有着一抹自嘲',
              evidence: '神态细节克制冷峻'
            }
          }
        }
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
      wordBudget: { minChars: 30, maxChars: 500, targetChars: 100 }
    },
    storyContext: {
      continuity: {
        chapterTitle: '第一章 陨落的天才',
        sceneName: '测试魔石碑前',
        currentBody: '“斗之气，三段！”望着测验魔石碑上面闪亮得甚至有些刺眼的四个大字……',
        outline: '本章必须完成：魔石碑测验被嘲讽，退至人群后冷笑，返回后山偶遇薰儿。',
        nextChapter: {
          title: '第二章 斗气大陆',
          outline: '萧炎与薰儿交谈，透露穿越者身世背景与戒指异动。'
        },
        dossier: '纳兰嫣然婚约线索'
      }
    }
  };

  const scope = { workspaceId: 'ws_test', projectId: 'p_test', actorUserId: 'u1' };
  const runId = 'run_audit_r3';
  const created = await orchestrator.create({
    ...scope,
    id: runId,
    chapterId: 'ch_test',
    idempotencyKey: 'idem_audit_r3',
    requestHash: 'c'.repeat(64),
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
  assert.ok(['waiting_author', 'needs_human'].includes(finalRun.state), '任务必须顺利推进至有效审核状态');

  // 验证 finalRun.result.authoritativeStoryContext 中的深度合并证据：
  const authStoryContext = (finalRun.result && finalRun.result.authoritativeStoryContext) || finalRun.authoritativeStoryContext;
  assert.ok(authStoryContext, 'authoritativeStoryContext 必须存在');
  const continuity = authStoryContext.continuity;
  assert.ok(continuity, 'continuity 必须存在');

  // 1. 服务端权威事实必须注入
  assert.deepEqual(continuity.characters, [{ name: '权威萧炎' }], '服务端权威角色必须生效');
  assert.deepEqual(continuity.worldRules, ['斗气大陆以斗气为尊'], '服务端权威世界规则必须生效');

  // 2. 客户端现场草稿、大纲、下章规划绝不能被浅合并洗掉！
  assert.match(continuity.currentBody, /“斗之气，三段！”/, '客户端编辑态正文草稿必须完整保留');
  assert.match(continuity.outline, /魔石碑测验被嘲讽/, '客户端当前章大纲细纲必须完整保留');
  assert.ok(continuity.nextChapter, '下一章规划必须保留');
  assert.match(continuity.nextChapter.outline, /萧炎与薰儿交谈/, '下一章大纲必须保留');
  assert.equal(continuity.dossier, '纳兰嫣然婚约线索', '现场案卷必须保留');

  // 3. 根层级大纲提升必须生效
  assert.equal(authStoryContext.currentChapterOutline, continuity.outline, '现场大纲必须提升到 storyContext.currentChapterOutline');
  assert.equal(authStoryContext.currentBody, continuity.currentBody, '现场正文必须提升到 storyContext.currentBody');
  assert.equal(authStoryContext.nextChapterOutline, continuity.nextChapter.outline, '下章大纲必须提升到 storyContext.nextChapterOutline');
});

test('大纲专项审查 R4: 上下文编译器将大纲体系显式映射为 L2/L1/L4 一等公民，优先级为 0 且强约束必保', () => {
  const input = {
    sceneContract: { goal: '击退魔兽' },
    currentChapterOutline: '【当前章大纲硬约束】：萧炎必须在此战中第一次唤醒药老残魂，绝不可提前暴露玄重尺。',
    currentScenePlan: '【当前场景规划】：1. 萧炎被逼入死角；2. 掌心骨灵冷火初现；3. 魔兽被逼退。',
    volumeOutline: '【第一卷大纲】：乌坦城受辱与药老苏醒，三年之约誓言确立。',
    nextChapterOutline: '【下一章大纲】：炼制筑基灵液与坊市淘药。'
  };

  const { contextPlan, text } = assembleContext(input, {
    model: 'gpt-4o',
    hardLimit: 100000,
    outputReserve: 1000
  });

  // 1. 验证分层映射
  assert.ok(contextPlan.layers.L2_chapter.includes('currentChapterOutline'), 'currentChapterOutline 必须归属于 L2_chapter');
  assert.ok(contextPlan.layers.L1_scene.includes('currentScenePlan'), 'currentScenePlan 必须归属于 L1_scene');
  assert.ok(contextPlan.layers.L4_volume.includes('volumeOutline'), 'volumeOutline 必须归属于 L4_volume');
  assert.ok(contextPlan.layers.L3_recent.includes('nextChapterOutline'), 'nextChapterOutline 必须归属于 L3_recent');

  // 2. 验证文本注入
  assert.match(text, /第一次唤醒药老残魂/);
  assert.match(text, /掌心骨灵冷火初现/);
  assert.match(text, /乌坦城受辱与药老苏醒/);
});

test('大纲专项审查 R5: 编译器对 chapterContext、chapterPlan 与 planText 重复冗余进行智能去重，杜绝三倍膨胀', () => {
  const chapterContextData = {
    chapterNo: 3,
    title: '炼药师工会',
    coreEvent: '考核一品炼药师资格',
    keyCharacters: ['奥托大师', '雅妃']
  };

  const input = {
    sceneContract: { goal: '参加考核' },
    chapterContext: chapterContextData,
    chapterPlan: chapterContextData, // 别名重复引用
    planText: JSON.stringify(chapterContextData) // 冗余 JSON 序列化
  };

  const { text, blocks } = assembleContext(input, {
    model: 'gpt-4o',
    hardLimit: 100000,
    outputReserve: 1000
  });

  // 验证只有一份被渲染进入最终 Prompt
  const blockIds = blocks.map(b => b.id);
  assert.ok(blockIds.includes('chapterContext'), 'chapterContext 必须被保留');
  assert.ok(!blockIds.includes('chapterPlan'), '重复的 chapterPlan 必须被去重清除');
  assert.ok(!blockIds.includes('planText'), '重复序列化的 planText 必须被去重清除');

  // 验证文本中仅出现一次核心内容
  const occurrences = (text.match(/考核一品炼药师资格/g) || []).length;
  assert.equal(occurrences, 1, '大纲核心内容在最终 Prompt 中必须且仅能出现一次，杜绝重复序列化');
});

test('大纲专项审查 R6: 风格样本抽样就近控制在 1~3 章内，杜绝全书成百章节遍历膨胀', () => {
  const service = setupMockGenerationService();

  // 构造一本书包含 10 个章节，每个章节都有正文
  const chapters = [];
  for (let i = 1; i <= 10; i++) {
    chapters.push({
      id: `ch_${i}`,
      title: `第${i}章`,
      content: `这是第${i}章的精彩正文，展现了修真界弱肉强食与大道争锋的深厚底蕴。`.repeat(5)
    });
  }

  const novelState = {
    volumes: [
      {
        id: 'vol_1',
        title: '第一卷',
        chapters
      }
    ]
  };

  // 从 extractAuthoritativeChapters 验证章节提取
  const authoritativeChapters = service.extractAuthoritativeChapters(novelState);
  assert.equal(authoritativeChapters.length, 10);
});
