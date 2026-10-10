'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { assembleContext } = require('../lib/generation/context');
const { createGenerationOrchestrator } = require('../lib/generation/orchestrator');

test('R4-1: assembleContext 完整生成 8 维大纲审计指标闭环', () => {
  const outlineContext = {
    chapterId: 'chap-204-audit',
    chapterNo: 12,
    planRevision: 4,
    outlineHash: 'sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069',
    dependencies: ['chap-203-relic-found', 'debt-oath-of-fire'],
    outlineImpact: {
      completed: ['beat-break-seal'],
      deferred: ['beat-confront-guardian'],
      changed: ['dialogue-parley-with-foe'],
      omitted: []
    },
    chapter: {
      id: 'chap-204-audit',
      chapterNo: 12,
      title: '封印瓦解之日',
      summary: '主角于火山内部破除千年封印',
      beats: ['深入熔岩回廊', '打破外层符文', '封印核心震颤']
    }
  };

  const input = {
    outlineContext,
    currentTask: '撰写第十二章决战前奏',
    hardState: { location: 'volcano_core' },
    stateDelta: { sealWeakened: true }
  };

  const options = {
    model: 'gemini-3.8-flash',
    provider: 'google',
    hardLimit: 32000,
    outputReserve: 4000,
    chapterId: 'chap-204-audit',
    chapterNo: 12,
    outlineRevision: 4,
    outlineHash: 'sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069'
  };

  const { contextPlan } = assembleContext(input, options);
  assert.ok(contextPlan, 'contextPlan 必须存在');

  const audit = contextPlan.outlineAudit;
  const manifest = contextPlan.replayManifest;
  assert.ok(audit, 'contextPlan.outlineAudit 必须存在');
  assert.ok(manifest, 'contextPlan.replayManifest 必须存在');
  assert.ok(manifest.outlineAudit, 'manifest.outlineAudit 必须存在');

  // 1. resolvedChapterId
  assert.equal(audit.resolvedChapterId, 'chap-204-audit');
  assert.equal(contextPlan.resolvedChapterId, 'chap-204-audit');
  assert.equal(manifest.resolvedChapterId, 'chap-204-audit');

  // 2. resolvedChapterNo
  assert.equal(audit.resolvedChapterNo, 12);
  assert.equal(contextPlan.resolvedChapterNo, 12);
  assert.equal(manifest.resolvedChapterNo, 12);

  // 3. outlineRevision & outlineHash
  assert.equal(audit.outlineRevision, 4);
  assert.equal(manifest.outlineRevision, 4);
  assert.equal(audit.outlineHash, 'sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069');
  assert.equal(manifest.outlineHash, 'sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069');

  // 4. requiredOutlineIncluded
  assert.equal(audit.requiredOutlineIncluded, true);
  assert.equal(contextPlan.requiredOutlineIncluded, true);
  assert.equal(manifest.requiredOutlineIncluded, true);

  // 5. outlineBlockTokens
  assert.ok(audit.outlineBlockTokens > 0);
  assert.equal(audit.outlineBlockTokens, contextPlan.outlineBlockTokens);
  assert.equal(audit.outlineBlockTokens, manifest.outlineBlockTokens);

  // 6. outlineDependenciesIncluded
  assert.deepEqual(audit.outlineDependenciesIncluded, ['chap-203-relic-found', 'debt-oath-of-fire']);
  assert.deepEqual(manifest.outlineDependenciesIncluded, ['chap-203-relic-found', 'debt-oath-of-fire']);

  // 7. outlineImpact
  assert.deepEqual(audit.outlineImpact.completed, ['beat-break-seal']);
  assert.deepEqual(audit.outlineImpact.deferred, ['beat-confront-guardian']);
  assert.deepEqual(audit.outlineImpact.changed, ['dialogue-parley-with-foe']);

  // 8. contextTruncationReasons & stateDeltaCommitted
  assert.ok(Array.isArray(audit.contextTruncationReasons));
  assert.equal(audit.stateDeltaCommitted, true);
  assert.equal(contextPlan.stateDeltaCommitted, true);
  assert.equal(manifest.stateDeltaCommitted, true);
});

test('R4-2: 预算挤压时非必要块被裁剪，准确记录 contextTruncationReasons', () => {
  const input = {
    outlineContext: {
      chapterId: 'chap-tight',
      chapterNo: 1,
      chapter: { title: '紧急任务', summary: '必须优先保留' }
    },
    longOptionalLore: 'A'.repeat(5000), // 低优先级长文本
    secondaryBackground: 'B'.repeat(5000)
  };

  const options = {
    model: 'gemini-3.8-flash',
    hardLimit: 8000,
    outputReserve: 1000,
    maxChars: 600
  };

  const { contextPlan } = assembleContext(input, options);
  assert.ok(contextPlan.outlineAudit);
  assert.equal(contextPlan.outlineAudit.requiredOutlineIncluded, true);

  const truncations = contextPlan.outlineAudit.contextTruncationReasons;
  assert.ok(Array.isArray(truncations));
  assert.ok(truncations.length > 0, '预算紧张时应当有块被裁剪并记录原因');
  const omittedKeys = truncations.map(t => t.blockId);
  assert.ok(omittedKeys.includes('longOptionalLore') || omittedKeys.includes('secondaryBackground'));
  for (const t of truncations) {
    assert.ok(t.reason, '裁剪记录必须包含决策原因');
    assert.ok(t.decision === 'truncated' || t.decision === 'omitted');
  }
});

test('R4-3: orchestrator getReplay 完整透传 outlineAudit 与 8 维指标', async () => {
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

  const runId = 'test-run-replay-8dim';
  const mockContract = {
    id: 'contract-test',
    chapterNo: 8,
    scenes: []
  };

  const mockContextPlan = {
    contextPlanVersion: 2,
    resolvedChapterId: 'chap-8-replay',
    resolvedChapterNo: 8,
    outlineRevision: 2,
    outlineHash: 'sha256:replay-hash-1234',
    requiredOutlineIncluded: true,
    outlineBlockTokens: 350,
    outlineDependenciesIncluded: ['dep-1'],
    outlineImpact: { completed: ['c1'], deferred: [], changed: [], omitted: [] },
    contextTruncationReasons: [],
    stateDeltaCommitted: true,
    outlineAudit: {
      resolvedChapterId: 'chap-8-replay',
      resolvedChapterNo: 8,
      outlineRevision: 2,
      outlineHash: 'sha256:replay-hash-1234',
      requiredOutlineIncluded: true,
      outlineBlockTokens: 350,
      outlineDependenciesIncluded: ['dep-1'],
      outlineImpact: { completed: ['c1'], deferred: [], changed: [], omitted: [] },
      contextTruncationReasons: [],
      stateDeltaCommitted: true
    }
  };

  mockStore.runs.set(runId, {
    id: runId,
    status: 'completed',
    result: {
      contract: mockContract,
      contextPlan: mockContextPlan,
      stateSnapshot: { snapshotHash: 'hash-state-1', storyContext: {} },
      styleResolution: { bundle: { tone: 'epic' } },
      genreResolution: { profile: { genre: 'xianxia' } },
      promptHash: 'prompt-hash-xyz',
      outputHash: 'output-hash-xyz'
    },
    manifest: {
      promptHash: 'prompt-hash-xyz',
      outputHash: 'output-hash-xyz'
    }
  });

  const replay = await orchestrator.getReplay({ bookId: 'test-book' }, runId);
  assert.ok(replay, 'getReplay 返回对象必须存在');
  assert.equal(replay.replayable, true, 'replayable 必须为 true');
  assert.ok(replay.outlineAudit, 'replay.outlineAudit 必须直接暴露');
  assert.equal(replay.outlineAudit.resolvedChapterId, 'chap-8-replay');
  assert.equal(replay.outlineAudit.resolvedChapterNo, 8);
  assert.equal(replay.outlineAudit.outlineRevision, 2);
  assert.equal(replay.outlineAudit.outlineHash, 'sha256:replay-hash-1234');
  assert.equal(replay.outlineAudit.requiredOutlineIncluded, true);
  assert.equal(replay.outlineAudit.outlineBlockTokens, 350);
  assert.deepEqual(replay.outlineAudit.outlineDependenciesIncluded, ['dep-1']);
  assert.deepEqual(replay.outlineAudit.outlineImpact.completed, ['c1']);
  assert.equal(replay.outlineAudit.stateDeltaCommitted, true);
});
