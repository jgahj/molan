'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { selectRelevantPlans, compileContext } = require('../lib/memory-context');
const {
  formatStoryPlansMarkdown,
  assembleContext
} = require('../lib/generation/context');
const { createGenerationOrchestrator } = require('../lib/generation/orchestrator');

// ============================================================================
// 1. selectRelevantPlans 对抗性防御验证 (ID 0 / 畸形 query / 参与人防御)
// ============================================================================

test('REV-M3-01: selectRelevantPlans 严防数值 0 假值坍塌 (ID 0 / castIds 0 / requiredPlanIds 0)', () => {
  const plans = [
    { id: 0, title: '零号计划', targetChapterRange: '1', participantIds: [0] },
    { id: 1, title: '壹号计划', targetChapterRange: '1', participantIds: ['hero'] }
  ];

  // 1.1 query.castIds: [null, undefined, 0] 不得把 0 过滤掉，应成功匹配 participantIds: [0]
  const resCast0 = selectRelevantPlans(plans, { chapterNo: 1, castIds: [null, undefined, 0] });
  assert.equal(resCast0.selectedPlans.length, 2);
  const p0 = resCast0.selectedPlans.find(p => p.id === '0');
  assert.ok(p0, 'ID 为 0 的计划必须被保留且字符串化为 "0"');
  assert.equal(p0.id, '0');
  const d0 = resCast0.decisions.find(d => d.id === '0');
  assert.equal(d0.score, 15, '应获得当章 10 分 + 角色匹配 5 分 = 15 分');

  // 1.2 query.castIds: 0 (非数组裸数值 0) 也应正常匹配
  const resBare0 = selectRelevantPlans(plans, { chapterNo: 1, castIds: 0 });
  const p0Bare = resBare0.selectedPlans.find(p => p.id === '0');
  assert.ok(p0Bare);
  const d0Bare = resBare0.decisions.find(d => d.id === '0');
  assert.equal(d0Bare.score, 15);

  // 1.3 query.requiredPlanIds: [0] 必须命中 id: 0，获得 +100 分及 required_plan_directive
  const resReq0 = selectRelevantPlans(plans, { chapterNo: 1, requiredPlanIds: [0] });
  const d0Req = resReq0.decisions.find(d => d.id === '0');
  assert.equal(d0Req.reason, 'required_plan_directive');
  assert.equal(d0Req.score, 110, '必保 100 分 + 当章 10 分');

  // 1.4 query.requiredPlanIds: 0 (裸数值 0) 也应正常穿透
  const resReqBare0 = selectRelevantPlans(plans, { chapterNo: 1, requiredPlanIds: 0 });
  const d0ReqBare = resReqBare0.decisions.find(d => d.id === '0');
  assert.equal(d0ReqBare.reason, 'required_plan_directive');
});

test('REV-M3-02: selectRelevantPlans 兼容序章 (0 章) 与 targetChapterRange 为 0', () => {
  const plans = [
    { id: 'p-prologue', title: '序章专属', targetChapterRange: 0 },
    { id: 'p-arc-0-2', title: '前序起步卷', targetChapterRange: '0-2' },
    { id: 'p-ch1-3', title: '正篇开端', targetChapterRange: '1-3' }
  ];

  // 2.1 当章为 0 时：targetChapterRange: 0 当章命中 (+10)，0-2 当章命中 (+10)，1-3 下章视界命中 (+3)
  const resCh0 = selectRelevantPlans(plans, { chapterNo: 0 });
  assert.equal(resCh0.selectedPlans.length, 3);
  const decPrologue = resCh0.decisions.find(d => d.id === 'p-prologue');
  assert.equal(decPrologue.reason, 'chapter_target_match');
  assert.equal(decPrologue.score, 10);

  const decArc = resCh0.decisions.find(d => d.id === 'p-arc-0-2');
  assert.equal(decArc.reason, 'chapter_target_match');
  assert.equal(decArc.score, 10);

  const decNext = resCh0.decisions.find(d => d.id === 'p-ch1-3');
  assert.equal(decNext.reason, 'chapter_upcoming_horizon');
  assert.equal(decNext.score, 3);
});

test('REV-M3-03: selectRelevantPlans 兼容包含对象/数值/字符串的 participantIds 数组与非数组平稳降级', () => {
  const plans = [
    { id: 'p-single-num', title: '单数值人物', targetChapterRange: '1', participantIds: [1001] },
    { id: 'p-single-obj', title: '单对象人物', targetChapterRange: '1', participantIds: [{ id: 2002 }] },
    { id: 'p-single-str', title: '单字符串人物', targetChapterRange: '1', participantIds: ['char_master'] },
    { id: 'p-non-arr', title: '非数组降级', targetChapterRange: '1', participantIds: 'not_json_nor_array' }
  ];

  const res = selectRelevantPlans(plans, {
    chapterNo: 1,
    castIds: ['1001', 2002, 'char_master']
  });

  assert.equal(res.selectedPlans.length, 3);
  for (const p of res.selectedPlans) {
    const d = res.decisions.find(item => item.id === p.id);
    assert.equal(d.score, 15, `计划 ${p.id} 角色单项应成功匹配获得 15 分`);
  }

  // 非数组 participantIds 平稳降级为 []，不匹配 castIds 但作为普通当章计划选入 (10 分)
  const allRes = selectRelevantPlans(plans, { chapterNo: 1, maxPlans: 5 });
  const pNonArr = allRes.selectedPlans.find(p => p.id === 'p-non-arr');
  assert.ok(pNonArr);
  assert.deepEqual(pNonArr.participantIds, []);

  // 格式化测试
  const md = formatStoryPlansMarkdown(res.selectedPlans);
  assert.ok(md.includes('涉及人物: 1001'));
  assert.ok(md.includes('涉及人物: 2002'));
  assert.ok(md.includes('涉及人物: char_master'));
});

// ============================================================================
// 2. assembleContext 8 维指标归一化与防御验证
// ============================================================================

test('REV-M4-01: assembleContext 对非标准 outlineImpact 自动规范化补齐 4 项数组', () => {
  // 2.1 外部仅传入 completed，缺少 deferred, changed, omitted
  const resPartial = assembleContext({
    outlineContext: {
      chapter: { title: '测试章节' },
      outlineImpact: { completed: ['beat-1'] }
    }
  });

  const impact = resPartial.contextPlan.outlineAudit.outlineImpact;
  assert.ok(impact, 'outlineImpact 必须存在');
  assert.deepEqual(impact.completed, ['beat-1']);
  assert.deepEqual(impact.deferred, [], '缺省的 deferred 必须规范化为空数组');
  assert.deepEqual(impact.changed, [], '缺省的 changed 必须规范化为空数组');
  assert.deepEqual(impact.omitted, [], '缺省的 omitted 必须规范化为空数组');

  // 2.2 外部传入非对象 (如字符串或 null) 时平稳降级为全空数组结构体
  const resInvalid = assembleContext({
    outlineContext: { chapter: { title: '降级测试' } }
  }, { outlineImpact: 'invalid_string' });

  const impactInvalid = resInvalid.contextPlan.outlineAudit.outlineImpact;
  assert.deepEqual(impactInvalid.completed, []);
  assert.deepEqual(impactInvalid.deferred, []);
  assert.deepEqual(impactInvalid.changed, []);
  assert.deepEqual(impactInvalid.omitted, []);

  // 2.3 外部传入单值非数组时，自动包装为数组
  const resSingle = assembleContext({
    outlineContext: {
      chapter: { title: '单值测试' },
      outlineImpact: { completed: 'single-beat' }
    }
  });
  assert.deepEqual(resSingle.contextPlan.outlineAudit.outlineImpact.completed, ['single-beat']);
});

test('REV-M4-02: assembleContext 针对 chapterNo 与 outlineRevision 防范 NaN 污染', () => {
  const res = assembleContext({}, {
    chapterNo: 'invalid-nan',
    outlineRevision: 'not-a-number'
  });

  const audit = res.contextPlan.outlineAudit;
  assert.equal(audit.resolvedChapterNo, null, '非法数值 chapterNo 应回退为 null，绝不能是 NaN');
  assert.equal(audit.outlineRevision, null, '非法数值 outlineRevision 应回退为 null，绝不能是 NaN');

  // 序章 0 测试
  const resCh0 = assembleContext({}, { chapterNo: 0, outlineRevision: 0 });
  assert.equal(resCh0.contextPlan.outlineAudit.resolvedChapterNo, 0, '序章 chapterNo 0 必须精准保留为 0');
  assert.equal(resCh0.contextPlan.outlineAudit.outlineRevision, 0, '版本号 0 必须精准保留为 0');
});

test('REV-M4-03: assembleContext 支持 options.outlineDependencies 透传', () => {
  const res = assembleContext({
    outlineContext: { chapter: { title: '依赖透传' } }
  }, {
    outlineDependencies: ['dep-alpha', 'dep-beta']
  });

  const audit = res.contextPlan.outlineAudit;
  assert.deepEqual(audit.outlineDependenciesIncluded, ['dep-alpha', 'dep-beta']);
  assert.deepEqual(res.contextPlan.replayManifest.outlineAudit.outlineDependenciesIncluded, ['dep-alpha', 'dep-beta']);
});

test('REV-M4-04: assembleContext 极小预算 (hardLimit 50) 强阻断 Priority 0 大纲并抛出 CONTEXT_OVERFLOW', () => {
  assert.throws(() => {
    assembleContext({
      outlineContext: {
        chapter: {
          title: '超长核心大纲不可裁剪',
          summary: '这是一段用于测试预算不足时严格强阻断的大纲内容'.repeat(10)
        }
      }
    }, {
      hardLimit: 50,
      outputReserve: 10,
      reservedInputTokens: 0
    });
  }, (err) => {
    assert.equal(err.code, 'CONTEXT_OVERFLOW');
    assert.equal(err.status, 413);
    return true;
  });
});

// ============================================================================
// 3. orchestrator.getReplay 降级与跨层提取验证
// ============================================================================

test('REV-M4-05: orchestrator getReplay 支持从 manifest 提取 contextPlan 与 outlineAudit', async () => {
  const mockDb = {};
  const mockStore = {
    runs: new Map(),
    inputs: new Map(),
    async getRun(db, scope) {
      return this.runs.get(scope.id) || null;
    },
    async getRunInput(db, scope) {
      return this.inputs.get(scope.id) || null;
    }
  };

  const orchestrator = createGenerationOrchestrator({
    db: mockDb,
    store: mockStore
  });

  const runId = 'test-run-manifest-only';
  const mockContextPlan = {
    contextPlanVersion: 2,
    outlineAudit: {
      resolvedChapterId: 'chap-manifest-only',
      resolvedChapterNo: 99,
      outlineRevision: 1,
      outlineHash: 'sha256:manifest-hash',
      requiredOutlineIncluded: true,
      outlineBlockTokens: 120,
      outlineDependenciesIncluded: [],
      outlineImpact: { completed: [], deferred: [], changed: [], omitted: [] },
      contextTruncationReasons: [],
      stateDeltaCommitted: true
    }
  };

  // contextPlan 仅记录在 manifest 中，而未在 result 顶层记录
  mockStore.runs.set(runId, {
    id: runId,
    status: 'completed',
    result: {
      contract: { id: 'c1', chapterNo: 99 },
      stateSnapshot: { snapshotHash: 'sh1', storyContext: {} },
      styleResolution: { bundle: {} },
      genreResolution: { profile: {} },
      promptHash: 'ph1'
    },
    manifest: {
      contextPlan: mockContextPlan,
      promptHash: 'ph1'
    }
  });

  const replay = await orchestrator.getReplay({ bookId: 'test-book' }, runId);
  assert.ok(replay, 'getReplay 必须返回对象');
  assert.equal(replay.replayable, true, '即使 contextPlan 在 manifest 中也应识别出完整并重放');
  assert.ok(replay.outlineAudit, 'outlineAudit 必须成功提取');
  assert.equal(replay.outlineAudit.resolvedChapterId, 'chap-manifest-only');
  assert.equal(replay.outlineAudit.resolvedChapterNo, 99);
});

// ============================================================================
// 4. Round 2 深度对抗审查与边界加固 (REV2)
// ============================================================================

test('REV2-01: assembleContext 针对 input 传入的元数据正确入模审计且绝不泄漏为提示词块', () => {
  const input = {
    currentTask: '撰写核心剧情',
    chapterId: 'chap-input-001',
    chapterNo: 42,
    outlineRevision: 7,
    outlineHash: 'sha256:input-hash-val',
    outlineDependencies: ['dep-alpha', 'dep-beta'],
    outlineImpact: { completed: ['beat-win'] },
    stateDeltaCommitted: true
  };

  const res = assembleContext(input);
  const audit = res.contextPlan.outlineAudit;
  const manifestAudit = res.contextPlan.replayManifest.outlineAudit;

  // 1. 验证 8 维指标从 input 成功捕获并同构一致
  assert.equal(audit.resolvedChapterId, 'chap-input-001');
  assert.equal(manifestAudit.resolvedChapterId, 'chap-input-001');
  assert.equal(audit.resolvedChapterNo, 42);
  assert.equal(manifestAudit.resolvedChapterNo, 42);
  assert.equal(audit.outlineRevision, 7);
  assert.equal(manifestAudit.outlineRevision, 7);
  assert.equal(audit.outlineHash, 'sha256:input-hash-val');
  assert.equal(manifestAudit.outlineHash, 'sha256:input-hash-val');
  assert.deepEqual(audit.outlineDependenciesIncluded, ['dep-alpha', 'dep-beta']);
  assert.deepEqual(manifestAudit.outlineDependenciesIncluded, ['dep-alpha', 'dep-beta']);
  assert.deepEqual(audit.outlineImpact.completed, ['beat-win']);
  assert.deepEqual(audit.outlineImpact.deferred, []);
  assert.equal(audit.stateDeltaCommitted, true);
  assert.equal(manifestAudit.stateDeltaCommitted, true);

  // 2. 严防元数据作为提示词块泄漏入模
  const blockIds = res.contextPlan.includedBlocks;
  assert.ok(!blockIds.includes('chapterId'), 'chapterId 严禁作为上下文提示块');
  assert.ok(!blockIds.includes('chapterNo'), 'chapterNo 严禁作为上下文提示块');
  assert.ok(!blockIds.includes('outlineRevision'), 'outlineRevision 严禁作为上下文提示块');
  assert.ok(!blockIds.includes('outlineHash'), 'outlineHash 严禁作为上下文提示块');
  assert.ok(!blockIds.includes('outlineImpact'), 'outlineImpact 严禁作为上下文提示块');
  assert.ok(!blockIds.includes('stateDeltaCommitted'), 'stateDeltaCommitted 严禁作为上下文提示块');

  // 3. 提示词正文中严禁出现元数据裸露文本
  assert.ok(!res.text.includes('[outlineRevision]'));
  assert.ok(!res.text.includes('[outlineHash]'));
  assert.ok(!res.text.includes('[outlineImpact]'));
  assert.ok(!res.text.includes('[stateDeltaCommitted]'));
});

test('REV2-02: assembleContext 与 splitCausalDebt 正确支持 options.chapterNo 与序章/第0章', () => {
  // 验证因果债务在 options.chapterNo 下能正确识别到期
  const res = assembleContext({
    activeCausalDebt: [
      { debtId: 'debt-due-ch5', dueChapter: 5 },
      { debtId: 'debt-future-ch10', dueChapter: 10 }
    ]
  }, {
    chapterNo: 5
  });

  const decisions = res.contextPlan.replayManifest.causalDebt.decisions;
  const d5 = decisions.find(d => d.id === 'debt-due-ch5');
  assert.ok(d5, 'debt-due-ch5 决策记录必须存在');
  assert.equal(d5.decision, 'required', '本章到期债务必须标记为 required');

  // 序章 (0章) 验证
  const resCh0 = assembleContext({
    activeCausalDebt: [
      { debtId: 'debt-ch0', dueChapter: 0 }
    ]
  }, {
    chapterNo: 0
  });
  assert.equal(resCh0.contextPlan.outlineAudit.resolvedChapterNo, 0);
  assert.equal(resCh0.contextPlan.replayManifest.causalDebt.currentChapterNo, 0);
});

test('REV2-03: formatStoryPlansMarkdown 与 selectRelevantPlans 支持包含 characterId 的角色对象', () => {
  const plans = [
    {
      id: 'p-char-id',
      title: '因果追溯',
      targetChapterRange: '1',
      participantIds: [{ characterId: 'char_protagonist' }]
    }
  ];

  const query = {
    chapterNo: 1,
    castIds: [{ characterId: 'char_protagonist' }]
  };

  const res = selectRelevantPlans(plans, query);
  assert.equal(res.selectedPlans.length, 1);
  assert.equal(res.decisions[0].reason, 'chapter_target_match');
  assert.equal(res.decisions[0].score, 15, '当章匹配(10) + 角色匹配(5) = 15');
  assert.deepEqual(res.selectedPlans[0].participantIds, ['char_protagonist']);

  const md = formatStoryPlansMarkdown(res.selectedPlans);
  assert.ok(md.includes('涉及人物: char_protagonist'));
});

test('REV2-04: compileContext 正确将 query.chapterNumber/currentChapterNo 透传给 assembleContext', () => {
  const { compileContext } = require('../lib/memory-context');
  const dummySourceCurrent = () => true;

  const manifest = compileContext({
    bookId: 'test-book',
    branchId: 'main',
    version: 1,
    facts: [],
    cognitions: [],
    policies: [],
    profiles: [],
    plans: [
      { id: 'p1', title: '目标规划', targetChapterRange: '8', content: '规划详情' }
    ],
    sourceCurrent: dummySourceCurrent
  }, {
    chapterNumber: 8,
    currentTask: '撰写第八章'
  });

  assert.equal(manifest.contextPlan.outlineAudit.resolvedChapterNo, 8, 'chapterNumber 必须透传至 outlineAudit.resolvedChapterNo');
  assert.equal(manifest.writingPackage.plans.length, 1);
  assert.equal(manifest.writingPackage.plans[0].id, 'p1');
});

test('REV2-05: orchestrator run 完成时在 finalManifest 双重持久化 outlineAudit 与 contextPlan', async () => {
  const mockDb = {};
  const mockStore = {
    runs: new Map(),
    inputs: new Map(),
    async getRun(db, scope) { return this.runs.get(scope.id) || null; },
    async getRunInput(db, scope) { return this.inputs.get(scope.id) || null; },
    async createRun(db, scope, data) { this.runs.set(data.id, { ...data, status: 'created' }); return this.runs.get(data.id); },
    async saveRunInput(db, scope, input) { this.inputs.set(scope.id, input); },
    async updateRunState(db, scope, status, data, result, manifest) {
      const existing = this.runs.get(scope.id) || {};
      const updated = { ...existing, status, ...data, ...(result ? { result } : {}), ...(manifest ? { manifest } : {}) };
      this.runs.set(scope.id, updated);
      return updated;
    },
    async appendEvent() {},
    async stage() {}
  };

  const orchestrator = createGenerationOrchestrator({
    db: mockDb,
    store: mockStore
  });

  const runId = 'test-run-lifecycle';
  mockStore.runs.set(runId, {
    id: runId,
    status: 'completed',
    result: {
      contract: { id: 'c1', chapterNo: 5 },
      contextPlan: {
        outlineAudit: {
          resolvedChapterId: 'c1',
          resolvedChapterNo: 5,
          requiredOutlineIncluded: true,
          outlineBlockTokens: 50,
          outlineDependenciesIncluded: [],
          outlineImpact: { completed: [], deferred: [], changed: [], omitted: [] },
          contextTruncationReasons: [],
          stateDeltaCommitted: true
        }
      },
      outlineAudit: {
        resolvedChapterId: 'c1',
        resolvedChapterNo: 5,
        requiredOutlineIncluded: true,
        outlineBlockTokens: 50,
        outlineDependenciesIncluded: [],
        outlineImpact: { completed: [], deferred: [], changed: [], omitted: [] },
        contextTruncationReasons: [],
        stateDeltaCommitted: true
      },
      stateSnapshot: { snapshotHash: 'sh', storyContext: {} },
      styleResolution: { bundle: {} },
      genreResolution: { profile: {} },
      promptHash: 'ph'
    },
    manifest: {
      outlineAudit: {
        resolvedChapterId: 'c1',
        resolvedChapterNo: 5,
        requiredOutlineIncluded: true,
        outlineBlockTokens: 50,
        outlineDependenciesIncluded: [],
        outlineImpact: { completed: [], deferred: [], changed: [], omitted: [] },
        contextTruncationReasons: [],
        stateDeltaCommitted: true
      },
      contextPlan: {
        outlineAudit: {
          resolvedChapterId: 'c1',
          resolvedChapterNo: 5
        }
      },
      promptHash: 'ph'
    }
  });

  const replay = await orchestrator.getReplay({ bookId: 'b1' }, runId);
  assert.equal(replay.replayable, true);
  assert.equal(replay.outlineAudit.resolvedChapterNo, 5);
  assert.equal(replay.outlineAudit.stateDeltaCommitted, true);
});

// ============================================================================
// 5. Round 3 深度对抗审查与边界加固 (REV3)
// ============================================================================

test('REV3-01: assembleContext 严防全部 8 维审计与契约元数据泄漏为提示词块 (Prompt Pollution Defense)', () => {
  const input = {
    currentTask: '撰写核心决战',
    stateDelta: { sealWeakened: true, bossEnraged: true },
    outlineDependencies: ['dep-alpha', 'dep-beta'],
    outlineDependenciesIncluded: ['dep-gamma'],
    dependencies: ['dep-delta'],
    impact: { completed: ['b1'] },
    revision: 3,
    contextPlan: { legacy: true },
    outlineAudit: { legacy: true },
    replayManifest: { legacy: true },
    contextTruncationReasons: ['old-reason'],
    requiredOutlineIncluded: true,
    outlineBlockTokens: 100
  };

  const res = assembleContext(input);

  // 1. 验证 includedBlocks 中绝对不包含任何审计元数据块
  const forbiddenKeys = [
    'stateDelta', 'outlineDependencies', 'outlineDependenciesIncluded', 'dependencies',
    'impact', 'revision', 'contextPlan', 'outlineAudit', 'replayManifest',
    'contextTruncationReasons', 'requiredOutlineIncluded', 'outlineBlockTokens'
  ];
  for (const key of forbiddenKeys) {
    assert.ok(!res.contextPlan.includedBlocks.includes(key), `Block ${key} 严禁进入 includedBlocks`);
  }

  // 2. 验证最终提示词文本中绝对不泄漏元数据标签
  for (const key of forbiddenKeys) {
    assert.ok(!res.text.includes(`[${key}]`), `提示词正文严禁出现 [${key}]`);
  }

  // 3. stateDeltaCommitted 仍能正确被感知并记录入 8 维指标
  assert.equal(res.contextPlan.outlineAudit.stateDeltaCommitted, true);
  assert.equal(res.contextPlan.replayManifest.outlineAudit.stateDeltaCommitted, true);
});

test('REV3-02: assembleContext 与 selectRelevantPlans 严防空串/布尔/空数组假值坍塌为序章0 (Falsy Coercion Trap Defense)', () => {
  // 2.1 assembleContext: options.chapterNo 为空串时不应假冒为第0章，应回退为 null
  const resEmptyStr = assembleContext({}, { chapterNo: '' });
  assert.equal(resEmptyStr.contextPlan.outlineAudit.resolvedChapterNo, null, '空字符串 chapterNo 应为 null');

  // options.chapterNo 为纯空格时
  const resSpaces = assembleContext({}, { chapterNo: '   ' });
  assert.equal(resSpaces.contextPlan.outlineAudit.resolvedChapterNo, null, '纯空格 chapterNo 应为 null');

  // options.chapterNo 为布尔 false 或空数组时不应假冒为第0章
  const resFalse = assembleContext({}, { chapterNo: false });
  assert.equal(resFalse.contextPlan.outlineAudit.resolvedChapterNo, null, '布尔 false chapterNo 应为 null');
  const resArr = assembleContext({}, { chapterNo: [] });
  assert.equal(resArr.contextPlan.outlineAudit.resolvedChapterNo, null, '空数组 chapterNo 应为 null');

  // options.chapterNo 为空串，但 currentChapterNo 为有效数字 5 时，能正确回退到 5 而不是被 0 劫持
  const resFallback = assembleContext({}, { chapterNo: '', currentChapterNo: 5 });
  assert.equal(resFallback.contextPlan.outlineAudit.resolvedChapterNo, 5, '空串应自动回退至有效 currentChapterNo');

  // options.outlineRevision 为空串时不应被篡改为 0
  const resRevEmpty = assembleContext({}, { outlineRevision: '' });
  assert.equal(resRevEmpty.contextPlan.outlineAudit.outlineRevision, null);

  // 2.2 selectRelevantPlans: query.chapterNo 为空串时不应假冒为第0章而误杀当章计划
  const plans = [
    { id: 'p-mid', targetChapterRange: '5-10', title: '中段规划' }
  ];
  const resPlans = selectRelevantPlans(plans, { chapterNo: '' });
  assert.equal(resPlans.selectedPlans.length, 1, '未指定章节时，一般范围规划不应因空串被按0章误杀');
  assert.equal(resPlans.decisions[0].reason, 'chapter_target_match');
});

test('REV3-03: assembleContext 循环引用对象免疫测试 (Circular Reference Immunity)', () => {
  const circ = { name: 'circular_ref' };
  circ.self = circ;

  assert.doesNotThrow(() => {
    const res = assembleContext({
      currentTask: '决战',
      stateDelta: circ
    }, {
      outlineDependencies: [circ],
      outlineImpact: { completed: [circ] }
    });

    assert.ok(res.contextPlan);
    assert.equal(res.contextPlan.outlineAudit.stateDeltaCommitted, true);
    assert.ok(Array.isArray(res.contextPlan.outlineAudit.outlineDependenciesIncluded));
    assert.ok(Array.isArray(res.contextPlan.outlineAudit.outlineImpact.completed));
  }, '包含循环引用对象时不得抛出 Converting circular structure to JSON 异常');
});

test('REV3-04: assembleContext 与 compileContext 对 options/query 为 null 时优雅降级不崩溃', () => {
  assert.doesNotThrow(() => {
    const res = assembleContext({ currentTask: '测试任务' }, null);
    assert.ok(res.contextPlan);
    assert.equal(res.contextPlan.outlineAudit.requiredOutlineIncluded, false);
  }, 'assembleContext 遇到 options 为 null 时应正常执行');

  assert.doesNotThrow(() => {
    const manifest = compileContext({
      bookId: 'b1', branchId: 'm1', version: 1, facts: [], cognitions: [], policies: [], profiles: [], plans: [],
      sourceCurrent: () => true
    }, null);
    assert.ok(manifest.writingPackage);
    assert.equal(manifest.writingPackage.plans.length, 0);
  }, 'compileContext 遇到 query 为 null 时应正常执行');
});

test('REV3-05: selectRelevantPlans 支持 query.chapterId 为空串平稳降级 (Empty chapterId String Bug Defense)', () => {
  const plans = [
    { id: 'p1', chapterNo: 1, chapterId: 'ch-001', title: '第一章专属' }
  ];

  // query.chapterId 为空字符串时不应触发 chapter_id_mismatch 排除
  const res = selectRelevantPlans(plans, { chapterNo: 1, chapterId: '' });
  assert.equal(res.selectedPlans.length, 1);
  assert.equal(res.selectedPlans[0].id, 'p1');
  assert.equal(res.decisions[0].reason, 'applicable_story_plan');
});

test('REV3-06: assembleContext 解构直接暴露 outlineAudit，且 outlineHash/chapterId 拒绝 [object Object]', () => {
  const res = assembleContext({
    currentTask: '任务'
  }, {
    outlineHash: {}, // 畸形对象不应转为 [object Object]
    chapterId: {}    // 畸形对象不应转为 [object Object]
  });

  // 1. 验证顶层解构暴露
  assert.ok(res.outlineAudit, 'assembleContext 返回对象顶层必须暴露 outlineAudit');
  assert.equal(res.outlineAudit, res.contextPlan.outlineAudit);

  // 2. 验证非字符串对象平稳回退为 null，绝无 [object Object]
  assert.equal(res.outlineAudit.outlineHash, null);
  assert.equal(res.outlineAudit.resolvedChapterId, null);
});

test('REV3-07: formatStoryPlansMarkdown 防御畸形数组与非对象基元元素', () => {
  const inputPlans = [
    ['nested_array_elem'],
    12345,
    true,
    null,
    { title: '正规计划', content: '按时执行' }
  ];

  const md = formatStoryPlansMarkdown(inputPlans);
  assert.ok(md.includes('【正规计划】'));
  assert.ok(!md.includes('【计划 1】')); // 嵌套数组不应生成虚假计划1
});
