'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createJsonGenerationStore } = require('../lib/generation/json-store');
const { JsonFileRepository } = require('../lib/repositories/json-file-repository');
const { createGenerationOrchestrator } = require('../lib/generation/orchestrator');
const contentEngine = require('../lib/generation/content-engine');
const { buildGenerationManifest, hashValue } = require('../lib/generation/manifest');
const { contractHash } = require('../lib/generation/contract');
const { createQualityAssessment } = require('../lib/generation/quality-assessment');
const { TRANSITIONS, isTerminal } = require('../lib/generation/state-machine');

function setupTestEnvironment(prefix = 'molan-ch-m5-') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  const cleanup = async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  };
  return { directory, repository, store, cleanup };
}

// ============================================================================
// Group 1: State Machine Progression & Autonomous Completion to waiting_author
// ============================================================================

test('Challenger M5-2 1.1: Exact ordered state sequence during autonomous progression to waiting_author', async testContext => {
  const { repository, store, cleanup } = setupTestEnvironment('molan-ch-m5-seq-');
  testContext.after(cleanup);

  const scope = { workspaceId: 'ws-seq', projectId: 'proj-seq', actorUserId: 'author-seq' };
  const runId = 'run-seq-verify';
  const chapterId = 'ch-seq-1';
  const draftText = '夜色笼罩着荒凉的古驿道，狂风卷起漫天沙尘。沈炼握紧腰间绣春刀，目光死死盯住前方的客栈暗影。';

  const observedStateTransitions = [];

  // 包装 store.updateRun 与 store.beginProvider 以严格捕获每次实际发生的状态迁移
  const originalUpdateRun = store.updateRun.bind(store);
  store.updateRun = async (db, params) => {
    observedStateTransitions.push({ state: params.state });
    return originalUpdateRun(db, params);
  };
  const originalBeginProvider = store.beginProvider.bind(store);
  store.beginProvider = async (db, params) => {
    observedStateTransitions.push({ state: 'generating' });
    return originalBeginProvider(db, params);
  };

  const deps = {
    resolveGenre: async () => ({ status: 'resolved', genre: '武侠' }),
    resolveStyle: async () => ({ status: 'resolved', style: '冷峻硬派' }),
    loadAuthoritativeContext: async () => ({
      ok: true,
      snapshotHash: 'snap-seq-001',
      storyContext: { pov: 'third-limited', characters: ['沈炼'] }
    }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 'snap-seq-001' }),
    planScenes: async () => [{ id: 's1', goal: '逼近客栈' }],
    writer: async ({ request, contract, contextPlan }) => ({
      text: draftText,
      manifest: buildGenerationManifest({
        generationId: runId,
        projectId: scope.projectId,
        chapterId,
        pipelineVersion: 'content-engine-v2',
        contextHash: contextPlan.contextHash,
        contractHash: contractHash(contract),
        promptHash: 'prompt-seq-test',
        outputHash: hashValue(draftText)
      })
    }),
    deterministicAudit: async () => ({ passed: true, issues: [], blockerCount: 0, unverifiedCount: 0 }),
    semanticAudit: async () => ({ passed: true, status: 'MEASURED', issues: [] }),
    qualityAudit: async ({ draft }) => createQualityAssessment({
      genre: '武侠',
      contentDigest: hashValue(draft),
      compliance: { passed: true, checks: { length: { passed: true } } },
      literary: {
        passed: true,
        score: 0.88,
        confidence: 0.90,
        evaluator: { mode: 'single', modelId: 'judge-1' },
        dimensions: {
          language: {
            score: 0.88,
            confidence: 0.90,
            status: 'MEASURED',
            source: 'literary_evaluator',
            quote: '夜色笼罩着荒凉的古驿道',
            evidence: '氛围营造有力'
          }
        }
      }
    })
  };

  const orchestrator = createGenerationOrchestrator({ store, db: repository, dependencies: deps });
  const created = await orchestrator.create({
    ...scope,
    id: runId,
    chapterId,
    idempotencyKey: 'idem-seq-verify',
    requestHash: '1'.repeat(64),
    request: { chapterId, prompt: '客栈夜探' }
  });

  let finalRun = null;
  for (let i = 0; i < 60; i++) {
    finalRun = await store.getRun({}, { ...scope, id: created.run.id });
    if (finalRun && (finalRun.state === 'waiting_author' || finalRun.state === 'needs_human' || isTerminal(finalRun.state))) {
      break;
    }
    await new Promise(r => setTimeout(r, 20));
  }

  assert.ok(finalRun);
  assert.equal(finalRun.state, 'waiting_author', '自主生成必须顺利抵达 waiting_author');

  // 验证状态迁移序列中每一个 transition 在 state-machine.js 中皆为合法
  for (let i = 0; i < observedStateTransitions.length - 1; i++) {
    const from = observedStateTransitions[i].state;
    const to = observedStateTransitions[i + 1].state;
    if (from && to && from !== to) {
      const allowed = TRANSITIONS[from];
      assert.ok(allowed && allowed.includes(to),
        `Illegal state transition observed: ${from} -> ${to}`);
    }
  }

  // 验证关键主链状态均被按序遍历
  const targetSequence = [
    'request_validated',
    'genre_resolved',
    'style_resolved',
    'context_built',
    'contract_validated',
    'pre_generation_guard',
    'scene_planning',
    'generating',
    'draft_received',
    'deterministic_audit',
    'semantic_audit',
    'quality_audit',
    'waiting_author'
  ];

  const traversedStates = observedStateTransitions.map(t => t.state);
  for (const expectedState of targetSequence) {
    assert.ok(traversedStates.includes(expectedState),
      `Expected state ${expectedState} must be traversed in sequence. Traversed: ${traversedStates.join(' -> ')}`);
  }

  // 验证严格顺序（每个目标状态在数组中的索引单调递增）
  let lastIdx = -1;
  for (const expectedState of targetSequence) {
    const currentIdx = traversedStates.indexOf(expectedState);
    assert.ok(currentIdx > lastIdx,
      `State order violated: ${expectedState} (index ${currentIdx}) appeared after or equal to previous index ${lastIdx}`);
    lastIdx = currentIdx;
  }
});

test('Challenger M5-2 1.2: Pre-declared scenes cleanly bypasses scene_planning transition', async testContext => {
  const { repository, store, cleanup } = setupTestEnvironment('molan-ch-m5-declared-');
  testContext.after(cleanup);

  const scope = { workspaceId: 'ws-dec', projectId: 'proj-dec', actorUserId: 'author-dec' };
  const runId = 'run-dec-scenes';
  const chapterId = 'ch-dec-1';
  const draftText = '刀光一闪，落叶分为两半。楚留香收刀入鞘，微笑着看向窗外的月色。';

  let planScenesCalled = false;
  const deps = {
    resolveGenre: async () => ({ status: 'resolved', genre: '武侠' }),
    resolveStyle: async () => ({ status: 'resolved', style: '飘逸' }),
    loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 's-dec', storyContext: { pov: 'third-limited' } }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 's-dec' }),
    planScenes: async () => {
      planScenesCalled = true;
      return [];
    },
    writer: async ({ contract, contextPlan }) => ({
      text: draftText,
      manifest: buildGenerationManifest({
        generationId: runId,
        projectId: scope.projectId,
        chapterId,
        pipelineVersion: 'content-engine-v2',
        contextHash: contextPlan.contextHash,
        contractHash: contractHash(contract),
        promptHash: 'p-dec',
        outputHash: hashValue(draftText)
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
        confidence: 0.90,
        evaluator: { mode: 'single' },
        dimensions: {
          language: { score: 0.85, confidence: 0.90, status: 'MEASURED', source: 'literary_evaluator', quote: '刀光一闪' }
        }
      }
    })
  };

  const orchestrator = createGenerationOrchestrator({ store, db: repository, dependencies: deps });
  const created = await orchestrator.create({
    ...scope,
    id: runId,
    chapterId,
    idempotencyKey: 'idem-dec-scenes',
    requestHash: '2'.repeat(64),
    request: {
      chapterId,
      prompt: '月下对决',
      chapterContract: {
        chapterId,
        chapterGoal: '月下论刀',
        scenes: [{ id: 's1', goal: '拔刀' }, { id: 's2', goal: '论刀' }]
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
  assert.equal(planScenesCalled, false, 'Pre-declared scenes must completely bypass planScenes LLM call');
});

// ============================================================================
// Group 2: Compliance Blockers and Revision Loop Stress-Testing
// ============================================================================

test('Challenger M5-2 2.1: Semantic blocker triggers revision loop, re-verifies deterministic & semantic cleanly', async testContext => {
  const { repository, store, cleanup } = setupTestEnvironment('molan-ch-m5-sem-rev-');
  testContext.after(cleanup);

  const scope = { workspaceId: 'ws-sem', projectId: 'proj-sem', actorUserId: 'author-sem' };
  const runId = 'run-sem-rev';
  const chapterId = 'ch-sem-1';
  const initialText = '他掏出手机给李峰拨通了电话。屏幕信号显示满格，但那头却传来冰冷的忙音。';
  const revisedText = '他掏出卫星电话给李峰拨通了呼叫。屏幕信号显示满格，但那头却传来冰冷的忙音。';

  let deterministicAuditAttempts = [];
  let semanticAuditAttempts = [];
  let qualityAuditCalls = 0;
  let reviseCalls = 0;

  const deps = {
    resolveGenre: async () => ({ status: 'resolved', genre: '悬疑' }),
    resolveStyle: async () => ({ status: 'resolved', style: '写实' }),
    loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 's-sem', storyContext: {} }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 's-sem' }),
    planScenes: async () => [{ id: 's1', goal: '通讯联络' }],
    writer: async ({ contract, contextPlan }) => ({
      text: initialText,
      manifest: buildGenerationManifest({
        generationId: runId,
        projectId: scope.projectId,
        chapterId,
        pipelineVersion: 'content-engine-v2',
        contextHash: contextPlan.contextHash,
        contractHash: contractHash(contract),
        promptHash: 'p-sem-rev',
        outputHash: hashValue(initialText)
      })
    }),
    deterministicAudit: async ({ draft, attempt }) => {
      deterministicAuditAttempts.push({ attempt, draft });
      return { passed: true, issues: [], blockerCount: 0, unverifiedCount: 0 };
    },
    semanticAudit: async ({ draft, attempt }) => {
      semanticAuditAttempts.push({ attempt, draft });
      if (attempt === 1) {
        // 第一轮：语义审计阻断项（深山无基站，普通手机违背设定）
        return {
          passed: false,
          status: 'MEASURED',
          issues: [{
            issueId: 'issue-satellite-phone',
            severity: 'blocker',
            status: 'verified',
            quote: '他掏出手机给李峰拨通了电话。',
            problem: '深山无人区无地面基站，必须使用卫星电话'
          }]
        };
      }
      return { passed: true, status: 'MEASURED', issues: [] };
    },
    revise: async ({ issue, round }) => {
      reviseCalls++;
      assert.equal(issue.quote, '他掏出手机给李峰拨通了电话。');
      return {
        replacement: '他掏出卫星电话给李峰拨通了呼叫。',
        preservedFacts: ['李峰', '呼叫']
      };
    },
    qualityAudit: async ({ draft }) => {
      qualityAuditCalls++;
      return createQualityAssessment({
        genre: '悬疑',
        contentDigest: hashValue(draft),
        compliance: { passed: true, checks: {} },
        literary: {
          passed: true,
          score: 0.86,
          confidence: 0.90,
          evaluator: { mode: 'single' },
          dimensions: {
            clueIntegrity: { score: 0.88, confidence: 0.90, status: 'MEASURED', source: 'literary_evaluator', quote: '屏幕信号显示满格' },
            povBoundary: { score: 0.85, confidence: 0.90, status: 'MEASURED', source: 'literary_evaluator', quote: '他掏出卫星电话' },
            language: { score: 0.86, confidence: 0.90, status: 'MEASURED', source: 'literary_evaluator', quote: '那头却传来冰冷的忙音。' }
          }
        }
      });
    }
  };

  const orchestrator = createGenerationOrchestrator({ store, db: repository, dependencies: deps });
  const created = await orchestrator.create({
    ...scope,
    id: runId,
    chapterId,
    idempotencyKey: 'idem-sem-rev',
    requestHash: '3'.repeat(64),
    request: { chapterId, prompt: '呼叫支援' }
  });

  let finalRun = null;
  for (let i = 0; i < 60; i++) {
    finalRun = await store.getRun({}, { ...scope, id: created.run.id });
    if (finalRun && (finalRun.state === 'waiting_author' || finalRun.state === 'needs_human' || isTerminal(finalRun.state))) break;
    await new Promise(r => setTimeout(r, 20));
  }

  assert.ok(finalRun);
  assert.equal(finalRun.state, 'waiting_author', '语义审计修复后必须自主达成 waiting_author');
  assert.equal(finalRun.result.draft, revisedText);
  assert.equal(finalRun.result.revisionRound, 1);

  // 严格核查审计执行行为：
  // 1. revise 恰好执行 1 次
  assert.equal(reviseCalls, 1);
  // 2. 确定性审计执行 2 次：第 1 轮初稿验证，第 2 轮修订稿安全复核！
  assert.equal(deterministicAuditAttempts.length, 2);
  assert.equal(deterministicAuditAttempts[0].attempt, 1);
  assert.equal(deterministicAuditAttempts[0].draft, initialText);
  assert.equal(deterministicAuditAttempts[1].attempt, 2);
  assert.equal(deterministicAuditAttempts[1].draft, revisedText);
  // 3. 语义审计执行 2 次：第 1 轮阻断，第 2 轮通过
  assert.equal(semanticAuditAttempts.length, 2);
  assert.equal(semanticAuditAttempts[0].attempt, 1);
  assert.equal(semanticAuditAttempts[1].attempt, 2);
  // 4. 质量门禁仅在最终修订版本通过后执行 1 次
  assert.equal(qualityAuditCalls, 1);
});

test('Challenger M5-2 2.2: Blocker with unlocatable quote transitions directly to needs_human', async testContext => {
  const { repository, store, cleanup } = setupTestEnvironment('molan-ch-m5-unloc-');
  testContext.after(cleanup);

  const scope = { workspaceId: 'ws-unloc', projectId: 'proj-unloc', actorUserId: 'author-unloc' };
  const runId = 'run-unloc-quote';
  const chapterId = 'ch-unloc-1';
  const draftText = '长街寂静，唯有马蹄声回荡在青石板上。';

  const deps = {
    resolveGenre: async () => ({ status: 'resolved', genre: '历史' }),
    resolveStyle: async () => ({ status: 'resolved', style: '庄重' }),
    loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 's-unloc', storyContext: {} }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 's-unloc' }),
    planScenes: async () => [{ id: 's1', goal: '骑马' }],
    writer: async ({ contract, contextPlan }) => ({
      text: draftText,
      manifest: buildGenerationManifest({
        generationId: runId,
        projectId: scope.projectId,
        chapterId,
        pipelineVersion: 'content-engine-v2',
        contextHash: contextPlan.contextHash,
        contractHash: contractHash(contract),
        promptHash: 'p-unloc',
        outputHash: hashValue(draftText)
      })
    }),
    deterministicAudit: async () => ({
      passed: false,
      blockerCount: 1,
      issues: [{
        issueId: 'phantom-issue',
        severity: 'blocker',
        status: 'verified',
        quote: '这段文字根本不存在于正文中！', // 幽灵证据，无法唯一定位
        problem: '虚假事实'
      }]
    }),
    revise: async () => {
      assert.fail('revise must not be invoked when quote cannot be located');
    }
  };

  const orchestrator = createGenerationOrchestrator({ store, db: repository, dependencies: deps });
  const created = await orchestrator.create({
    ...scope,
    id: runId,
    chapterId,
    idempotencyKey: 'idem-unloc',
    requestHash: '4'.repeat(64),
    request: { chapterId, prompt: '夜巡' }
  });

  let finalRun = null;
  for (let i = 0; i < 60; i++) {
    finalRun = await store.getRun({}, { ...scope, id: created.run.id });
    if (finalRun && (finalRun.state === 'needs_human' || isTerminal(finalRun.state))) break;
    await new Promise(r => setTimeout(r, 20));
  }

  assert.ok(finalRun);
  assert.equal(finalRun.state, 'needs_human', '证据无法唯一定位时必须转入 needs_human');
});

test('Challenger M5-2 2.3: Revision exceeding MAX_REVISION_ROUNDS terminates in needs_human without looping', async testContext => {
  const { repository, store, cleanup } = setupTestEnvironment('molan-ch-m5-maxrev-');
  testContext.after(cleanup);

  const scope = { workspaceId: 'ws-maxrev', projectId: 'proj-maxrev', actorUserId: 'author-maxrev' };
  const runId = 'run-maxrev-test';
  const chapterId = 'ch-maxrev-1';
  let currentDraft = '第一段文字。第二段文字。第三段文字。';

  let auditCount = 0;
  let reviseCount = 0;

  const deps = {
    resolveGenre: async () => ({ status: 'resolved', genre: '科幻' }),
    resolveStyle: async () => ({ status: 'resolved', style: '冷硬' }),
    loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 's-max', storyContext: {} }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 's-max' }),
    planScenes: async () => [{ id: 's1', goal: '测试' }],
    writer: async ({ contract, contextPlan }) => ({
      text: currentDraft,
      manifest: buildGenerationManifest({
        generationId: runId,
        projectId: scope.projectId,
        chapterId,
        pipelineVersion: 'content-engine-v2',
        contextHash: contextPlan.contextHash,
        contractHash: contractHash(contract),
        promptHash: 'p-max',
        outputHash: hashValue(currentDraft)
      })
    }),
    deterministicAudit: async ({ draft, attempt }) => {
      auditCount++;
      // 持续报 blocker，永不通过
      return {
        passed: false,
        blockerCount: 1,
        issues: [{
          issueId: `blocker-round-${attempt}`,
          severity: 'blocker',
          status: 'verified',
          quote: '第二段文字。',
          problem: `顽固阻断项 ${attempt}`
        }]
      };
    },
    revise: async () => {
      reviseCount++;
      return {
        replacement: '第二段文字。',
        preservedFacts: ['第二段']
      };
    }
  };

  const orchestrator = createGenerationOrchestrator({ store, db: repository, dependencies: deps });
  const created = await orchestrator.create({
    ...scope,
    id: runId,
    chapterId,
    idempotencyKey: 'idem-maxrev',
    requestHash: '5'.repeat(64),
    request: { chapterId, prompt: '顽固缺陷' }
  });

  let finalRun = null;
  for (let i = 0; i < 60; i++) {
    finalRun = await store.getRun({}, { ...scope, id: created.run.id });
    if (finalRun && (finalRun.state === 'needs_human' || isTerminal(finalRun.state))) break;
    await new Promise(r => setTimeout(r, 20));
  }

  assert.ok(finalRun);
  assert.equal(finalRun.state, 'needs_human', '超出最大修订轮次后必须安全落入 needs_human');
  // MAX_REVISION_ROUNDS = 2
  // attempt 1 (revisionRound 0) -> revise 1 (revisionRound becomes 1)
  // attempt 2 (revisionRound 1) -> revise 2 (revisionRound becomes 2)
  // attempt 3 (revisionRound 2 >= 2) -> STOP -> needs_human!
  assert.equal(reviseCount, 2, '局部修订调用不能超过 MAX_REVISION_ROUNDS (2 次)');
  assert.equal(auditCount, 3, '确定性审计在耗尽上限前执行 3 次');
});

// ============================================================================
// Group 3: Irrecoverable Literary Failures Transition to needs_human
// ============================================================================

test('Challenger M5-2 3.1: Quality gate score below threshold (0.65 < 0.70) transitions directly to needs_human', async testContext => {
  const { repository, store, cleanup } = setupTestEnvironment('molan-ch-m5-score-fail-');
  testContext.after(cleanup);

  const scope = { workspaceId: 'ws-qfail', projectId: 'proj-qfail', actorUserId: 'author-qfail' };
  const runId = 'run-score-fail';
  const chapterId = 'ch-qfail-1';
  const draftText = '暮色深沉，冷风穿堂而过。案桌上的烛火忽明忽暗。';

  let reviseCalled = false;
  const deps = {
    resolveGenre: async () => ({ status: 'resolved', genre: '悬疑' }),
    resolveStyle: async () => ({ status: 'resolved', style: '冷峻' }),
    loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 's-qfail', storyContext: {} }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 's-qfail' }),
    planScenes: async () => [{ id: 's1', goal: '烛火' }],
    writer: async ({ contract, contextPlan }) => ({
      text: draftText,
      manifest: buildGenerationManifest({
        generationId: runId,
        projectId: scope.projectId,
        chapterId,
        pipelineVersion: 'content-engine-v2',
        contextHash: contextPlan.contextHash,
        contractHash: contractHash(contract),
        promptHash: 'p-qfail',
        outputHash: hashValue(draftText)
      })
    }),
    deterministicAudit: async () => ({ passed: true, issues: [] }),
    semanticAudit: async () => ({ passed: true, status: 'MEASURED', issues: [] }),
    revise: async () => {
      reviseCalled = true;
      return {};
    },
    qualityAudit: async ({ draft }) => ({
      passed: false,
      status: 'MEASURED',
      score: 0.65, // 低于 0.70 门限
      confidence: 0.88,
      qualityVector: {
        language: {
          value: 0.65,
          confidence: 0.88,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '案桌上的烛火忽明忽暗。',
          evidence: '文字平淡'
        }
      }
    })
  };

  const orchestrator = createGenerationOrchestrator({ store, db: repository, dependencies: deps });
  const created = await orchestrator.create({
    ...scope,
    id: runId,
    chapterId,
    idempotencyKey: 'idem-score-fail',
    requestHash: '6'.repeat(64),
    request: { chapterId, prompt: '平淡文字' }
  });

  let finalRun = null;
  for (let i = 0; i < 60; i++) {
    finalRun = await store.getRun({}, { ...scope, id: created.run.id });
    if (finalRun && (finalRun.state === 'needs_human' || isTerminal(finalRun.state))) break;
    await new Promise(r => setTimeout(r, 20));
  }

  assert.ok(finalRun);
  assert.equal(finalRun.state, 'needs_human', '文学评分未达标必须流转至 needs_human');
  assert.equal(reviseCalled, false, '宏观文学评分未达标不能误触发局部微创修订循环');
  assert.equal(finalRun.result.quality.passed, false);
});

test('Challenger M5-2 3.2: Quality gate confidence below threshold (0.60 < 0.75) transitions to needs_human', async testContext => {
  const { repository, store, cleanup } = setupTestEnvironment('molan-ch-m5-conf-fail-');
  testContext.after(cleanup);

  const scope = { workspaceId: 'ws-cfail', projectId: 'proj-cfail', actorUserId: 'author-cfail' };
  const runId = 'run-conf-fail';
  const chapterId = 'ch-cfail-1';
  const draftText = '残阳如血，将士们的甲胄反射着凄厉的光斑。';

  const deps = {
    resolveGenre: async () => ({ status: 'resolved', genre: '历史' }),
    resolveStyle: async () => ({ status: 'resolved', style: '壮烈' }),
    loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 's-cfail', storyContext: {} }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 's-cfail' }),
    planScenes: async () => [{ id: 's1', goal: '残阳' }],
    writer: async ({ contract, contextPlan }) => ({
      text: draftText,
      manifest: buildGenerationManifest({
        generationId: runId,
        projectId: scope.projectId,
        chapterId,
        pipelineVersion: 'content-engine-v2',
        contextHash: contextPlan.contextHash,
        contractHash: contractHash(contract),
        promptHash: 'p-cfail',
        outputHash: hashValue(draftText)
      })
    }),
    deterministicAudit: async () => ({ passed: true, issues: [] }),
    semanticAudit: async () => ({ passed: true, status: 'MEASURED', issues: [] }),
    qualityAudit: async ({ draft }) => ({
      passed: true,
      status: 'MEASURED',
      score: 0.88,
      confidence: 0.60, // 置信度低于 0.75 门限
      qualityVector: {
        language: {
          value: 0.88,
          confidence: 0.60,
          status: 'MEASURED',
          source: 'literary_evaluator',
          quote: '残阳如血',
          evidence: '意象尚可但样本置信不足'
        }
      }
    })
  };

  const orchestrator = createGenerationOrchestrator({ store, db: repository, dependencies: deps });
  const created = await orchestrator.create({
    ...scope,
    id: runId,
    chapterId,
    idempotencyKey: 'idem-conf-fail',
    requestHash: '7'.repeat(64),
    request: { chapterId, prompt: '低置信度测试' }
  });

  let finalRun = null;
  for (let i = 0; i < 60; i++) {
    finalRun = await store.getRun({}, { ...scope, id: created.run.id });
    if (finalRun && (finalRun.state === 'needs_human' || isTerminal(finalRun.state))) break;
    await new Promise(r => setTimeout(r, 20));
  }

  assert.ok(finalRun);
  assert.equal(finalRun.state, 'needs_human');
  assert.equal(finalRun.result.quality.passed, false);
});

test('Challenger M5-2 3.3: Semantic audit EVALUATION_FAILED status transitions cleanly to needs_human', async testContext => {
  const { repository, store, cleanup } = setupTestEnvironment('molan-ch-m5-sem-eval-fail-');
  testContext.after(cleanup);

  const scope = { workspaceId: 'ws-efail', projectId: 'proj-efail', actorUserId: 'author-efail' };
  const runId = 'run-sem-eval-fail';
  const chapterId = 'ch-efail-1';
  const draftText = '夜色苍茫，林深不知处。前路漫漫，唯有明月相伴。';

  const deps = {
    resolveGenre: async () => ({ status: 'resolved', genre: '武侠' }),
    resolveStyle: async () => ({ status: 'resolved', style: '意境' }),
    loadAuthoritativeContext: async () => ({ ok: true, snapshotHash: 's-efail', storyContext: {} }),
    preGenerationGuard: async () => ({ passed: true, snapshotHash: 's-efail' }),
    planScenes: async () => [{ id: 's1', goal: '行路' }],
    writer: async ({ contract, contextPlan }) => ({
      text: draftText,
      manifest: buildGenerationManifest({
        generationId: runId,
        projectId: scope.projectId,
        chapterId,
        pipelineVersion: 'content-engine-v2',
        contextHash: contextPlan.contextHash,
        contractHash: contractHash(contract),
        promptHash: 'p-efail',
        outputHash: hashValue(draftText)
      })
    }),
    deterministicAudit: async () => ({ passed: true, issues: [] }),
    // 语义审计发生异常/评定失败
    semanticAudit: async () => ({
      passed: false,
      status: 'EVALUATION_FAILED',
      issues: [{
        severity: 'blocker',
        status: 'verified',
        problem: 'Model evaluation network failure',
        quote: '夜色苍茫，林深不知处。'
      }]
    }),
    qualityAudit: async () => {
      assert.fail('qualityAudit must not be reached when semanticAudit failed with EVALUATION_FAILED');
    }
  };

  const orchestrator = createGenerationOrchestrator({ store, db: repository, dependencies: deps });
  const created = await orchestrator.create({
    ...scope,
    id: runId,
    chapterId,
    idempotencyKey: 'idem-eval-fail',
    requestHash: '8'.repeat(64),
    request: { chapterId, prompt: '网络故障测试' }
  });

  let finalRun = null;
  for (let i = 0; i < 60; i++) {
    finalRun = await store.getRun({}, { ...scope, id: created.run.id });
    if (finalRun && (finalRun.state === 'needs_human' || isTerminal(finalRun.state))) break;
    await new Promise(r => setTimeout(r, 20));
  }

  assert.ok(finalRun);
  assert.equal(finalRun.state, 'needs_human', 'EVALUATION_FAILED 状态必须严格阻断并转移至 needs_human');
  assert.equal(finalRun.result.semanticAudit.passed, false);
});

// ============================================================================
// Group 4: Statelessness of content-engine.js and Single Audit Trail
// ============================================================================

test('Challenger M5-2 4.1: content-engine.generateDraft enforces single model call and zero duplicate audits', async () => {
  const modelCalls = [];
  const fakeProse = '窗外落叶萧萧，室内炉火正旺。白发老人缓缓端起陶杯，吹开漂浮的碎沫。';

  const result = await contentEngine.generateDraft({
    callModel: async (_auth, options) => {
      modelCalls.push({ stage: options.stage, maxTokens: options.maxTokens });
      return {
        text: fakeProse,
        usage: { promptTokens: 300, completionTokens: 100, totalTokens: 400, creditCost: 0.05 }
      };
    },
    auth: { user: { id: 'u-stateless' } },
    request: {
      generationId: 'gen-ce-stateless',
      projectId: 'proj-ce-stateless',
      chapterId: 'ch-ce-1',
      genre: '武侠',
      targetWords: 1500
    },
    contract: {
      chapterId: 'ch-ce-1',
      chapterNo: 1,
      chapterGoal: '茶肆相逢',
      wordBudget: { minChars: 1200, maxChars: 2000, targetChars: 1500 }
    },
    context: '前情：古道旁的小茶肆。',
    genre: '武侠'
  });

  // 断言 1: callModel 严格仅被调用 1 次且 stage 为 writer
  assert.equal(modelCalls.length, 1);
  assert.equal(modelCalls[0].stage, 'writer');

  // 断言 2: result 载荷中不携带预计算的确定性/语义审计/质量判定
  assert.equal(result.pipeline.deterministicAudit, undefined);
  assert.equal(result.pipeline.semanticAudit, undefined);
  assert.equal(result.pipeline.audit, undefined);
  assert.equal(result.pipeline.quality, undefined);
  assert.equal(result.pipeline.qualityVector, undefined);
  assert.equal(result.pipeline.rounds, undefined);

  // 断言 3: manifest 的 pipelineVersion 为 content-engine-v2
  assert.equal(result.manifest.pipelineVersion, 'content-engine-v2');
  assert.equal(result.manifest.outputHash, hashValue(fakeProse));
});
