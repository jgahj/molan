'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createGenerationService } = require('../services/generation-service');
const { evaluateQualityGate } = require('../lib/generation/quality-gate');
const { evaluateDualJudgeConsensus, resolveEvaluationRoute, shouldEscalateToDualJudge } = require('../lib/quality/dual-judge');
const { createJsonGenerationStore } = require('../lib/generation/json-store');
const { JsonFileRepository } = require('../lib/repositories/json-file-repository');
const { createGenerationOrchestrator } = require('../lib/generation/orchestrator');
const { buildGenerationManifest, hashValue } = require('../lib/generation/manifest');
const { contractHash } = require('../lib/generation/contract');

// ============================================================================
// PART 1: Model Judge Error Paths & Strict Fail-Closed Verification
// ============================================================================

test('Challenger M4-2 Verification 1.1: 502 Bad Gateway strictly fails closed with EVALUATION_FAILED', async () => {
  let capturedOptions;
  const dummyService = createGenerationService({
    POSTGRES_MODE: false,
    crypto,
    projectScope: require('../lib/project-scope'),
    generationManifest: require('../lib/generation/manifest'),
    generationProviderRequestId: (runId, stage, slot, attempt) => [runId, stage, slot, attempt].join('_'),
    getNativeCreationRepository: () => null,
    getNativeAppRepository: () => null,
    getDatabase: () => null,
    callMolanChat: async () => {
      const err = new Error('HTTP 502 Bad Gateway from Gateway proxy');
      err.status = 502;
      throw err;
    },
    generationRunStore: () => ({}),
    createGenerationOrchestrator: opts => { capturedOptions = opts; return {}; },
    creationChapterContext: () => ({ characters: [], characterLibrary: [], rules: [] })
  });
  dummyService.generationRunOrchestrator();

  const user = { userId: 'u_challenger', email: 'challenger@test.local' };
  const deps = capturedOptions.dependenciesForRun({
    auth: { user, authorization: 'Bearer test-token' },
    user,
    actorUserId: user.userId,
    projectId: 'p_challenger',
    workspaceId: 'w_challenger',
    authorization: 'Bearer test-token'
  }, {});

  const prose = '演武场四周古树参天，狂风呼啸而过。叶凌天长剑出鞘，剑鸣声清越如龙吟。';
  const auditRes = await deps.qualityAudit({
    draft: prose,
    request: { chapterNo: 1, genre: '通用', enableQualityJudge: true },
    contract: { chapterNo: 1, chapterGoal: '立威' },
    genre: '通用'
  });

  assert.equal(auditRes.passed, false, 'Model error must NEVER yield passed: true');
  assert.equal(auditRes.status, 'EVALUATION_FAILED', 'Status must be EVALUATION_FAILED');
  assert.equal(auditRes.code, 'EVALUATION_FAILED', 'Code must be EVALUATION_FAILED');
  assert.notEqual(auditRes.score, 0.86, 'Must NOT synthesize 0.86 pass');
  assert.notEqual(auditRes.score, 0.84, 'Must NOT synthesize 0.84 pass');
  assert.ok(auditRes.error, 'Must include error payload');
  assert.ok(auditRes.error.message.includes('502 Bad Gateway'));

  // Gate check
  const gateRes = evaluateQualityGate({
    draft: prose,
    quality: auditRes,
    genre: '通用'
  });
  assert.equal(gateRes.passed, false);
  assert.equal(gateRes.status, 'needs_human');
});

test('Challenger M4-2 Verification 1.2: Network timeout strictly fails closed with EVALUATION_FAILED', async () => {
  let capturedOptions;
  const dummyService = createGenerationService({
    POSTGRES_MODE: false,
    crypto,
    projectScope: require('../lib/project-scope'),
    generationManifest: require('../lib/generation/manifest'),
    generationProviderRequestId: (runId, stage, slot, attempt) => [runId, stage, slot, attempt].join('_'),
    getNativeCreationRepository: () => null,
    getNativeAppRepository: () => null,
    getDatabase: () => null,
    callMolanChat: async () => {
      const err = new Error('ETIMEDOUT connection timed out after 30000ms');
      err.code = 'ETIMEDOUT';
      throw err;
    },
    generationRunStore: () => ({}),
    createGenerationOrchestrator: opts => { capturedOptions = opts; return {}; },
    creationChapterContext: () => ({ characters: [], characterLibrary: [], rules: [] })
  });
  dummyService.generationRunOrchestrator();

  const user = { userId: 'u_timeout', email: 'timeout@test.local' };
  const deps = capturedOptions.dependenciesForRun({
    auth: { user, authorization: 'Bearer test' },
    user,
    actorUserId: user.userId,
    projectId: 'p_timeout',
    workspaceId: 'w_timeout',
    authorization: 'Bearer test'
  }, {});

  const prose = '演武场四周古树参天，狂风呼啸而过。叶凌天长剑出鞘，剑鸣声清越如龙吟。';
  const auditRes = await deps.qualityAudit({
    draft: prose,
    request: { chapterNo: 1, genre: '通用', enableQualityJudge: true },
    contract: { chapterNo: 1 },
    genre: '通用'
  });

  assert.equal(auditRes.passed, false);
  assert.equal(auditRes.status, 'EVALUATION_FAILED');
  assert.equal(auditRes.code, 'EVALUATION_FAILED');
  assert.notEqual(auditRes.score, 0.86);
  assert.notEqual(auditRes.score, 0.84);
});

test('Challenger M4-2 Verification 1.3: Unparseable/Non-JSON response strictly fails closed with EVALUATION_FAILED', async () => {
  let capturedOptions;
  const dummyService = createGenerationService({
    POSTGRES_MODE: false,
    crypto,
    projectScope: require('../lib/project-scope'),
    generationManifest: require('../lib/generation/manifest'),
    generationProviderRequestId: (runId, stage, slot, attempt) => [runId, stage, slot, attempt].join('_'),
    getNativeCreationRepository: () => null,
    getNativeAppRepository: () => null,
    getDatabase: () => null,
    callMolanChat: async () => {
      // Returns non-JSON text output
      return { text: 'I am not valid JSON at all: <html>500 Internal Error</html>', json: null };
    },
    generationRunStore: () => ({}),
    createGenerationOrchestrator: opts => { capturedOptions = opts; return {}; },
    creationChapterContext: () => ({ characters: [], characterLibrary: [], rules: [] })
  });
  dummyService.generationRunOrchestrator();

  const user = { userId: 'u_nonjson', email: 'nonjson@test.local' };
  const deps = capturedOptions.dependenciesForRun({
    auth: { user, authorization: 'Bearer test' },
    user,
    actorUserId: user.userId,
    projectId: 'p_test',
    workspaceId: 'w_test',
    authorization: 'Bearer test'
  }, {});

  const prose = '演武场四周古树参天，狂风呼啸而过。叶凌天长剑出鞘，剑鸣声清越如龙吟。';
  const auditRes = await deps.qualityAudit({
    draft: prose,
    request: { chapterNo: 1, genre: '通用', enableQualityJudge: true },
    contract: { chapterNo: 1 },
    genre: '通用'
  });

  assert.equal(auditRes.passed, false);
  assert.equal(auditRes.status, 'EVALUATION_FAILED');
  assert.equal(auditRes.code, 'EVALUATION_FAILED');
  assert.ok(auditRes.error.message.includes('JSON'));
  assert.notEqual(auditRes.score, 0.86);
  assert.notEqual(auditRes.score, 0.84);
});

test('Challenger M4-2 Verification 1.4: Asymmetric judge failure in DUAL_JUDGE route (Judge A ok, Judge B fails 502)', async () => {
  let capturedOptions;
  let callCount = 0;
  const dummyService = createGenerationService({
    POSTGRES_MODE: false,
    crypto,
    projectScope: require('../lib/project-scope'),
    generationManifest: require('../lib/generation/manifest'),
    generationProviderRequestId: (runId, stage, slot, attempt) => [runId, stage, slot, attempt].join('_'),
    getNativeCreationRepository: () => null,
    getNativeAppRepository: () => null,
    getDatabase: () => null,
    callMolanChat: async (_auth, _user, params) => {
      callCount++;
      if (params.stage === 'quality_judge_judge_a') {
        return {
          json: {
            score: 0.90,
            passed: true,
            confidence: 0.95,
            qualityVector: { language: { score: 0.90, confidence: 0.95, quote: '剑鸣声清越如龙吟' } }
          }
        };
      } else {
        // Judge B throws 502
        throw new Error('502 Bad Gateway on Judge B replica');
      }
    },
    generationRunStore: () => ({}),
    createGenerationOrchestrator: opts => { capturedOptions = opts; return {}; },
    creationChapterContext: () => ({ characters: [], characterLibrary: [], rules: [] })
  });
  dummyService.generationRunOrchestrator();

  const user = { userId: 'u_asym', email: 'asym@test.local' };
  const deps = capturedOptions.dependenciesForRun({
    auth: { user, authorization: 'Bearer test' },
    user,
    actorUserId: user.userId,
    projectId: 'p_test',
    workspaceId: 'w_test',
    authorization: 'Bearer test'
  }, {});

  const prose = '演武场四周古树参天，狂风呼啸而过。叶凌天长剑出鞘，剑鸣声清越如龙吟。';
  const auditRes = await deps.qualityAudit({
    draft: prose,
    request: { chapterNo: 1, genre: '通用', enableQualityJudge: true },
    contract: { chapterNo: 1 },
    genre: '通用'
  });

  // When either judge fails, overall status must be EVALUATION_FAILED and passed must be false
  assert.equal(auditRes.passed, false, 'Partial failure must fail closed');
  assert.equal(auditRes.status, 'EVALUATION_FAILED');
  assert.equal(auditRes.code, 'EVALUATION_FAILED');
  assert.ok(auditRes.judgeB.error);
});

test('Challenger M4-2 Verification 1.5: Single judge borderline escalation to Judge B where Judge B fails 502', async () => {
  let capturedOptions;
  const dummyService = createGenerationService({
    POSTGRES_MODE: false,
    crypto,
    projectScope: require('../lib/project-scope'),
    generationManifest: require('../lib/generation/manifest'),
    generationProviderRequestId: (runId, stage, slot, attempt) => [runId, stage, slot, attempt].join('_'),
    getNativeCreationRepository: () => null,
    getNativeAppRepository: () => null,
    getDatabase: () => null,
    callMolanChat: async (_auth, _user, params) => {
      if (params.stage === 'quality_judge_judge_a') {
        // Judge A produces borderline score (0.72) -> triggers escalation
        return {
          json: {
            score: 0.72,
            passed: true,
            confidence: 0.90,
            qualityVector: { language: { score: 0.72, confidence: 0.90, quote: '剑鸣声清越如龙吟' } }
          }
        };
      } else {
        // Judge B throws network timeout
        throw new Error('ETIMEDOUT during escalation to Judge B');
      }
    },
    generationRunStore: () => ({}),
    createGenerationOrchestrator: opts => { capturedOptions = opts; return {}; },
    creationChapterContext: () => ({ characters: [], characterLibrary: [], rules: [] })
  });
  dummyService.generationRunOrchestrator();

  const user = { userId: 'u_escfail', email: 'escfail@test.local' };
  const deps = capturedOptions.dependenciesForRun({
    auth: { user, authorization: 'Bearer test' },
    user,
    actorUserId: user.userId,
    projectId: 'p_test',
    workspaceId: 'w_test',
    authorization: 'Bearer test'
  }, {});

  const prose = '演武场四周古树参天，狂风呼啸而过。叶凌天长剑出鞘，剑鸣声清越如龙吟。';
  // Chapter 5 is a normal chapter -> SINGLE_JUDGE route initially
  const auditRes = await deps.qualityAudit({
    draft: prose,
    request: { chapterNo: 5, genre: '通用', enableQualityJudge: true },
    contract: { chapterNo: 5 },
    genre: '通用'
  });

  assert.equal(auditRes.passed, false, 'Escalated Judge B failure must fail closed');
  assert.equal(auditRes.status, 'EVALUATION_FAILED');
  assert.equal(auditRes.code, 'EVALUATION_FAILED');
  assert.ok(auditRes.routing.escalated, 'Must have recorded escalated: true');
});

// ============================================================================
// PART 2: Orchestrator Fallback to runDependencies.qualityAudit Verification
// ============================================================================

test('Challenger M4-2 Verification 2.1: Orchestrator invokes qualityAudit when pipeline lacks quality, and reaches waiting_author on pass', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-challenger-fallback-pass-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-fallback-pass', projectId: 'proj-fallback-pass', actorUserId: 'author-fb' };
  const request = {
    projectId: scope.projectId,
    chapterId: 'chap_10',
    chapterNo: 10,
    genre: '通用',
    style: '热血',
    chapterContract: { chapterId: 'chap_10', chapterNo: 10, chapterGoal: '击败强敌', scenes: [{ id: 'sc_1' }] }
  };
  const created = (await store.createRun({
    ...scope,
    id: 'run-fb-pass',
    chapterId: request.chapterId,
    idempotencyKey: 'idemp-fb-pass',
    requestHash: 'f'.repeat(64),
    request
  })).run;

  let qualityAuditInvoked = false;
  let receivedSignal = null;
  const draftProse = '演武场四周古树参天，狂风呼啸而过。叶凌天长剑出鞘，剑鸣声清越如龙吟。石砖在狂暴的剑气激荡下寸寸龟裂。';

  const orchestrator = createGenerationOrchestrator({
    store,
    db: repository,
    dependencies: {
      resolveGenre: async () => ({ status: 'resolved', genre: '通用' }),
      resolveStyle: async () => ({ status: 'resolved', style: '热血' }),
      loadAuthoritativeContext: async () => ({
        ok: true,
        storyContext: {},
        snapshotHash: 'snap-fb-1',
        contextPlan: {
          contextHash: 'ctx-fb-1',
          budgetResolution: { targetWords: 3000, bounds: { min: 2500, max: 3500 } }
        }
      }),
      preGenerationGuard: async () => ({ passed: true, snapshotHash: 'snap-fb-1' }),
      planScenes: async () => [{ id: 'sc_1', goal: '击败强敌' }],
      writer: async ({ request: r, contract, context: ctx, contextPlan, genre, style, scenes, scenePlan }) => {
        const promptInput = { request: r, contract, context: ctx, contextPlan, genre, style, scenes, scenePlan };
        return {
          text: draftProse,
          pipeline: {
            authoritative: true,
            status: 'passed',
            audit: { passed: true, issues: [] },
            deterministicAudit: { passed: true, issues: [], blockerCount: 0, unverifiedCount: 0 },
            semanticAudit: { passed: true, audit: { passed: true, issues: [] } },
            manifest: buildGenerationManifest({
              generationId: created.id,
              projectId: scope.projectId,
              chapterId: request.chapterId,
              pipelineVersion: 'generation-v2.1',
              contextHash: contextPlan.contextHash,
              contractHash: contractHash(contract),
              promptHash: hashValue(promptInput),
              outputHash: hashValue(draftProse)
            })
            // NOTE: pipeline has NO quality, NO qualityVector, NO audit.quality
          }
        };
      },
      screen: async () => ({ passed: true }),
      deterministicAudit: async () => ({ passed: true, issues: [] }),
      semanticAudit: async () => ({ passed: true, issues: [], status: 'MEASURED' }),
      qualityAudit: async ({ draft, signal }) => {
        qualityAuditInvoked = true;
        receivedSignal = signal;
        assert.equal(draft, draftProse);
        return {
          passed: true,
          status: 'MEASURED',
          score: 0.88,
          confidence: 0.92,
          source: 'dual_judge_consensus',
          qualityVector: {
            language: {
              score: 0.88,
              confidence: 0.92,
              status: 'MEASURED',
              source: 'dual_judge_consensus',
              evidence: '描写生动细腻',
              quote: '剑鸣声清越如龙吟'
            }
          }
        };
      },
      commit: async () => ({ committed: true, snapshotId: 'snap-committed', stateVersion: 1, contentHash: hashValue(draftProse) })
    }
  });

  const finalRun = await orchestrator.execute(scope, created.id);
  assert.equal(qualityAuditInvoked, true, 'runDependencies.qualityAudit must be invoked');
  assert.equal(finalRun.state, 'waiting_author', 'Passing quality audit must transition to waiting_author');
  assert.equal(finalRun.result.quality.passed, true);
  assert.equal(finalRun.result.quality.score, 0.88);
});

test('Challenger M4-2 Verification 2.2: Orchestrator moves to needs_human when qualityAudit fails (EVALUATION_FAILED)', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-challenger-fallback-fail-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-fallback-fail', projectId: 'proj-fallback-fail', actorUserId: 'author-fb-fail' };
  const request = {
    projectId: scope.projectId,
    chapterId: 'chap_11',
    chapterNo: 11,
    genre: '玄幻',
    style: '热血',
    chapterContract: { chapterId: 'chap_11', chapterNo: 11, chapterGoal: '突破瓶颈', scenes: [{ id: 'sc_2' }] }
  };
  const created = (await store.createRun({
    ...scope,
    id: 'run-fb-fail',
    chapterId: request.chapterId,
    idempotencyKey: 'idemp-fb-fail',
    requestHash: 'e'.repeat(64),
    request
  })).run;

  const draftProse = '演武场四周古树参天，狂风呼啸而过。叶凌天长剑出鞘，剑鸣声清越如龙吟。';

  const orchestrator = createGenerationOrchestrator({
    store,
    db: repository,
    dependencies: {
      resolveGenre: async () => ({ status: 'resolved', genre: '玄幻' }),
      resolveStyle: async () => ({ status: 'resolved', style: '热血' }),
      loadAuthoritativeContext: async () => ({
        ok: true,
        storyContext: {},
        snapshotHash: 'snap-fb-2',
        contextPlan: {
          contextHash: 'ctx-fb-2',
          budgetResolution: { targetWords: 3000, bounds: { min: 2500, max: 3500 } }
        }
      }),
      preGenerationGuard: async () => ({ passed: true, snapshotHash: 'snap-fb-2' }),
      planScenes: async () => [{ id: 'sc_2', goal: '突破瓶颈' }],
      writer: async ({ request: r, contract, context: ctx, contextPlan, genre, style, scenes, scenePlan }) => {
        const promptInput = { request: r, contract, context: ctx, contextPlan, genre, style, scenes, scenePlan };
        return {
          text: draftProse,
          pipeline: {
            authoritative: true,
            status: 'passed',
            audit: { passed: true, issues: [] },
            deterministicAudit: { passed: true, issues: [], blockerCount: 0, unverifiedCount: 0 },
            semanticAudit: { passed: true, audit: { passed: true, issues: [] } },
            manifest: buildGenerationManifest({
              generationId: created.id,
              projectId: scope.projectId,
              chapterId: request.chapterId,
              pipelineVersion: 'generation-v2.1',
              contextHash: contextPlan.contextHash,
              contractHash: contractHash(contract),
              promptHash: hashValue(promptInput),
              outputHash: hashValue(draftProse)
            })
          }
        };
      },
      screen: async () => ({ passed: true }),
      deterministicAudit: async () => ({ passed: true, issues: [] }),
      semanticAudit: async () => ({ passed: true, issues: [], status: 'MEASURED' }),
      qualityAudit: async () => {
        // Simulates model judge 502 returning EVALUATION_FAILED
        return {
          passed: false,
          status: 'EVALUATION_FAILED',
          code: 'EVALUATION_FAILED',
          reason: '评委模型评估执行失败: 502 Bad Gateway',
          error: { message: '502 Bad Gateway' }
        };
      },
      commit: async () => {
        throw new Error('Commit must NOT be called on failed quality audit');
      }
    }
  });

  const finalRun = await orchestrator.execute(scope, created.id);
  assert.equal(finalRun.state, 'needs_human', 'Failed quality gate must halt in needs_human');
  assert.equal(finalRun.result.quality.passed, false);
});

test('Challenger M4-2 Verification 2.3: Orchestrator moves to needs_human with QUALITY_UNMEASURED when qualityAudit is omitted', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-challenger-no-qa-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-no-qa', projectId: 'proj-no-qa', actorUserId: 'author-no-qa' };
  const request = {
    projectId: scope.projectId,
    chapterId: 'chap_12',
    chapterNo: 12,
    genre: '通用',
    style: '简洁',
    chapterContract: { chapterId: 'chap_12', chapterNo: 12, chapterGoal: '常规叙事', scenes: [{ id: 'sc_3' }] }
  };
  const created = (await store.createRun({
    ...scope,
    id: 'run-no-qa',
    chapterId: request.chapterId,
    idempotencyKey: 'idemp-no-qa',
    requestHash: 'd'.repeat(64),
    request
  })).run;

  const draftProse = '演武场四周古树参天，狂风呼啸而过。叶凌天长剑出鞘，剑鸣声清越如龙吟。';

  const orchestrator = createGenerationOrchestrator({
    store,
    db: repository,
    dependencies: {
      resolveGenre: async () => ({ status: 'resolved', genre: '通用' }),
      resolveStyle: async () => ({ status: 'resolved', style: '简洁' }),
      loadAuthoritativeContext: async () => ({
        ok: true,
        storyContext: {},
        snapshotHash: 'snap-fb-3',
        contextPlan: {
          contextHash: 'ctx-fb-3',
          budgetResolution: { targetWords: 3000, bounds: { min: 2500, max: 3500 } }
        }
      }),
      preGenerationGuard: async () => ({ passed: true, snapshotHash: 'snap-fb-3' }),
      planScenes: async () => [{ id: 'sc_3', goal: '常规叙事' }],
      writer: async ({ request: r, contract, context: ctx, contextPlan, genre, style, scenes, scenePlan }) => {
        const promptInput = { request: r, contract, context: ctx, contextPlan, genre, style, scenes, scenePlan };
        return {
          text: draftProse,
          pipeline: {
            authoritative: true,
            status: 'passed',
            audit: { passed: true, issues: [] },
            deterministicAudit: { passed: true, issues: [], blockerCount: 0, unverifiedCount: 0 },
            semanticAudit: { passed: true, audit: { passed: true, issues: [] } },
            manifest: buildGenerationManifest({
              generationId: created.id,
              projectId: scope.projectId,
              chapterId: request.chapterId,
              pipelineVersion: 'generation-v2.1',
              contextHash: contextPlan.contextHash,
              contractHash: contractHash(contract),
              promptHash: hashValue(promptInput),
              outputHash: hashValue(draftProse)
            })
          }
        };
      },
      screen: async () => ({ passed: true }),
      deterministicAudit: async () => ({ passed: true, issues: [] }),
      semanticAudit: async () => ({ passed: true, issues: [], status: 'MEASURED' })
      // qualityAudit intentionally omitted
    }
  });

  const finalRun = await orchestrator.execute(scope, created.id);
  assert.equal(finalRun.state, 'needs_human', 'Omitted qualityAudit must transition to needs_human');
  assert.equal(finalRun.result.quality.passed, false);
});

test('Challenger M4-2 Verification 3.1: String exception throw in callMolanChat fails closed without crash', async () => {
  let capturedOptions;
  const dummyService = createGenerationService({
    POSTGRES_MODE: false,
    crypto,
    projectScope: require('../lib/project-scope'),
    generationManifest: require('../lib/generation/manifest'),
    generationProviderRequestId: (runId, stage, slot, attempt) => [runId, stage, slot, attempt].join('_'),
    getNativeCreationRepository: () => null,
    getNativeAppRepository: () => null,
    getDatabase: () => null,
    callMolanChat: async () => {
      // throw primitive string instead of Error instance
      throw 'Raw string error: socket hang up';
    },
    generationRunStore: () => ({}),
    createGenerationOrchestrator: opts => { capturedOptions = opts; return {}; },
    creationChapterContext: () => ({ characters: [], characterLibrary: [], rules: [] })
  });
  dummyService.generationRunOrchestrator();

  const user = { userId: 'u_str_err', email: 'str@test.local' };
  const deps = capturedOptions.dependenciesForRun({
    auth: { user, authorization: 'Bearer test' },
    user,
    actorUserId: user.userId,
    projectId: 'p_test',
    workspaceId: 'w_test',
    authorization: 'Bearer test'
  }, {});

  const prose = '演武场四周古树参天，狂风呼啸而过。叶凌天长剑出鞘，剑鸣声清越如龙吟。';
  const auditRes = await deps.qualityAudit({
    draft: prose,
    request: { chapterNo: 1, genre: '通用', enableQualityJudge: true },
    contract: { chapterNo: 1 },
    genre: '通用'
  });

  assert.equal(auditRes.passed, false);
  assert.equal(auditRes.status, 'EVALUATION_FAILED');
  assert.equal(auditRes.code, 'EVALUATION_FAILED');
  assert.notEqual(auditRes.score, 0.86);
  assert.notEqual(auditRes.score, 0.84);
  assert.ok(auditRes.error);
  assert.ok(auditRes.error.message.includes('socket hang up'));
});

