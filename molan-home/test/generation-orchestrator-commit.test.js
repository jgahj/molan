'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createJsonGenerationStore } = require('../lib/generation/json-store');
const { JsonFileRepository } = require('../lib/repositories/json-file-repository');
const { createGenerationOrchestrator } = require('../lib/generation/orchestrator');
const { buildGenerationManifest, hashValue } = require('../lib/generation/manifest');
const { contractHash } = require('../lib/generation/contract');
const { GenerationError } = require('../lib/generation/errors');

test('orchestrator fences the formal commit and releases its lease after persisting the receipt', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-commit-json-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const scope = { workspaceId: 'workspace-1', projectId: 'project-1', actorUserId: 'author-1' };
  const request = { chapterId: 'chapter_1', genre: 'fantasy', style: 'direct' };
  const text = 'The audited chapter';
  const outputHash = hashValue(text);
  const created = (await store.createRun({
    ...scope, id: 'run-commit', chapterId: 'chapter_1', idempotencyKey: 'commit-key',
    requestHash: 'a'.repeat(64), request, now: 1700000000000
  })).run;
  const initialOwner = '11111111-1111-4111-8111-111111111111';
  const initialLease = await store.acquireLease({ ...scope, id: created.id, leaseOwner: initialOwner, now: 1700000000001 });
  const worker = { ...scope, id: created.id, leaseOwner: initialOwner, fencingToken: initialLease.fencingToken, now: 1700000000002 };
  let run = created;
  for (const stateName of [
    'request_validated', 'genre_resolved', 'style_resolved', 'context_built', 'contract_validated',
    'pre_generation_guard', 'scene_planning', 'generating', 'draft_received', 'deterministic_audit',
    'semantic_audit', 'quality_audit'
  ]) run = await store.updateRun({ ...worker, state: stateName });
  run = await store.updateRun({
    ...worker, state: 'waiting_author',
    result: {
      draft: text,
      outputHash,
      quality: {
        passed: true,
        status: 'MEASURED',
        qualityVector: {
          language: {
            value: 0.9,
            confidence: 0.9,
            status: 'MEASURED',
            source: 'literary_evaluator',
            evidence: {
              quote: text,
              start: 0,
              end: text.length
            }
          }
        }
      }
    },
    event: { message: 'ready' }
  });
  await store.releaseLease(worker);

  let commitRun;
  const orchestrator = createGenerationOrchestrator({
    store,
    db: {},
    dependencies: {
      commit: async input => {
        commitRun = input.run;
        return { committed: true, snapshotId: 'snapshot-1', stateVersion: 12, contentHash: outputHash };
      }
    }
  });
  const result = await orchestrator.commit({ ...scope, id: created.id, text, outputHash });
  const committed = await store.getRun({ ...scope, id: created.id });
  assert.equal(result.run.state, 'committed');
  assert.equal(committed.state, 'committed');
  assert.equal(committed.result.commitReceipt.snapshotId, 'snapshot-1');
  assert.equal(commitRun.fencingToken, 2);
  assert.equal(committed.fencingToken, 2);
  const persisted = await repository.generation.get(scope.projectId, created.id);
  assert.equal(persisted.leaseOwner, '');
  assert.equal(persisted.leaseUntil, null);
});

test('orchestrator: 自动生成 pipeline 仅有 semantic / quality 为 null / 空对象 / undefined 时独立进入 needs_human，保留原稿且 commit 写入严格为 0 不自动重生成', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-orch-unmeasured-auto-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-param-auto', projectId: 'proj-param-auto', actorUserId: 'author-param-auto' };
  const draftText = '这是真实编排器生成的正文，但缺少独立文学质量评估。';

  const testBranches = [
    {
      caseName: 'pipeline_only_semantic_audit',
      omitQualityInPipeline: true
    },
    {
      caseName: 'pipeline_quality_null',
      pipelineQualityValue: null
    },
    {
      caseName: 'pipeline_quality_empty_object',
      pipelineQualityValue: {}
    },
    {
      caseName: 'pipeline_quality_undefined',
      pipelineQualityValue: undefined
    }
  ];

  for (let caseIndex = 0; caseIndex < testBranches.length; caseIndex++) {
    const branchCase = testBranches[caseIndex];
    let commitCallCount = 0;
    const runId = `run-param-auto-${caseIndex}`;

    const orchestratorDeps = {
      resolveGenre: () => ({ status: 'resolved', genre: 'universal' }),
      resolveStyle: () => ({ status: 'resolved', style: '平实叙事' }),
      loadAuthoritativeContext: () => ({ ok: true, snapshotHash: 'snap-hash-param', storyContext: {} }),
      preGenerationGuard: () => ({ passed: true, snapshotHash: 'snap-hash-param' }),
      planScenes: () => [{ id: 'scene-1', goal: '主要情节' }],
      deterministicAudit: () => ({ passed: true, issues: [] }),
      semanticAudit: () => ({ passed: true, issues: [] }),
      commit: async () => {
        commitCallCount++;
        return { committed: true };
      },
      writer: async ({ request: runRequest, contract, context: ctxText, contextPlan, genre: runGenre, style: runStyle, scenes, scenePlan }) => {
        const promptInput = { request: runRequest, contract, context: ctxText, contextPlan, genre: runGenre, style: runStyle, scenes, scenePlan };
        const pipelinePayload = {
          authoritative: true,
          status: 'passed',
          audit: { passed: true, issues: [] },
          deterministicAudit: { passed: true, issues: [], blockerCount: 0, unverifiedCount: 0 },
          semanticAudit: { passed: true, audit: { passed: true, issues: [] } },
          manifest: buildGenerationManifest({
            generationId: runId,
            projectId: scope.projectId,
            chapterId: 'ch-auto-param',
            pipelineVersion: 'generation-v2.1',
            contextHash: contextPlan.contextHash,
            contractHash: contractHash(contract),
            promptHash: hashValue(promptInput),
            outputHash: hashValue(draftText)
          })
        };
        if (!branchCase.omitQualityInPipeline) {
          pipelinePayload.quality = branchCase.pipelineQualityValue;
        }
        return {
          text: draftText,
          pipeline: pipelinePayload
        };
      }
    };

    const orchestratorInstance = createGenerationOrchestrator({
      store,
      db: {},
      dependencies: orchestratorDeps
    });

    const created = await orchestratorInstance.create({
      ...scope,
      id: runId,
      chapterId: 'ch-auto-param',
      idempotencyKey: `key-param-auto-${caseIndex}`,
      requestHash: String(caseIndex).padStart(64, '0'),
      request: { chapterId: 'ch-auto-param', prompt: '写一段测试正文' }
    });

    let runFinished = false;
    for (let pollIndex = 0; pollIndex < 60; pollIndex++) {
      const currentRun = await store.getRun({}, { ...scope, id: created.run.id });
      if (currentRun && (currentRun.state === 'needs_human' || currentRun.state === 'waiting_author' || currentRun.state === 'failed')) {
        runFinished = true;
        assert.equal(currentRun.state, 'needs_human', `分支「${branchCase.caseName}」必须进入 needs_human`);
        assert.equal(currentRun.result.draft, draftText, `分支「${branchCase.caseName}」必须保留生成原稿`);
        assert.equal(currentRun.result.quality.passed, false, `分支「${branchCase.caseName}」质量门禁必须未通过`);
        break;
      }
      await new Promise(resolveWait => setTimeout(resolveWait, 20));
    }
    assert.equal(runFinished, true, `分支「${branchCase.caseName}」编排器必须在无有效质检时终止于 needs_human`);

    await assert.rejects(
      () => orchestratorInstance.commit({ ...scope, id: created.run.id, text: draftText, outputHash: hashValue(draftText) }),
      error => error instanceof GenerationError && (error.code === 'QUALITY_UNMEASURED' || error.code === 'STATE_CONFLICT'),
      `分支「${branchCase.caseName}」提交未质检记录必须被门禁拒绝`
    );
    assert.equal(commitCallCount, 0, `分支「${branchCase.caseName}」被拒绝时底层 commit 写入次数必须严格为 0`);

    const finalRunState = await store.getRun({}, { ...scope, id: created.run.id });
    assert.equal(finalRunState.state, 'needs_human', `分支「${branchCase.caseName}」被拒绝后不自动重生成，状态保持 needs_human`);
  }
});

test('orchestrator: 手动 revision 缺失 qualityAudit 依赖或返回 undefined / null / 空对象时进入 needs_human，commit 写入严格为 0', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-orch-rev-unmeasured-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-rev-param', projectId: 'proj-rev-param', actorUserId: 'author-rev-param' };
  const initialText = '原始正文，准备进行局部修订。';
  const revisedText = '修订后的第二版正文，修正了词汇。';

  const revisionBranches = [
    {
      caseName: 'no_quality_audit_dependency',
      qualityAuditFn: undefined
    },
    {
      caseName: 'quality_audit_returns_undefined',
      qualityAuditFn: async () => undefined
    },
    {
      caseName: 'quality_audit_returns_null',
      qualityAuditFn: async () => null
    },
    {
      caseName: 'quality_audit_returns_empty_object',
      qualityAuditFn: async () => ({})
    }
  ];

  for (let branchIndex = 0; branchIndex < revisionBranches.length; branchIndex++) {
    const revBranch = revisionBranches[branchIndex];
    let commitCallCount = 0;
    const runId = `run-rev-unmeasured-${branchIndex}`;

    const created = (await store.createRun({
      ...scope, id: runId, chapterId: 'ch-rev-p-1', idempotencyKey: `rev-p-key-${branchIndex}`,
      requestHash: String(branchIndex).padStart(64, '1'), request: { chapterId: 'ch-rev-p-1' }, now: 1700000000000
    })).run;

    const leaseOwner = `aaaaaaaa-aaaa-4aaa-8aaa-${String(branchIndex).padStart(12, 'a')}`;
    const lease = await store.acquireLease({ ...scope, id: created.id, leaseOwner, now: 1700000000001 });
    const worker = { ...scope, id: created.id, leaseOwner, fencingToken: lease.fencingToken, now: 1700000000002 };

    let currentRun = created;
    for (const stateName of [
      'request_validated', 'genre_resolved', 'style_resolved', 'context_built', 'contract_validated',
      'pre_generation_guard', 'scene_planning', 'generating', 'draft_received', 'deterministic_audit',
      'semantic_audit', 'quality_audit'
    ]) currentRun = await store.updateRun({ ...worker, state: stateName });

    await store.updateRun({
      ...worker, state: 'waiting_author',
      result: {
        draft: initialText,
        outputHash: hashValue(initialText),
        contract: { chapterNo: 1 },
        genreResolution: { genre: 'universal' },
        audit: {
          issues: [{
            issueId: `issue-rev-${branchIndex}`,
            status: 'verified',
            quote: initialText,
            problem: '字词润色'
          }]
        },
        quality: {
          passed: true,
          status: 'MEASURED',
          qualityVector: {
            language: {
              value: 0.9, confidence: 0.9, status: 'MEASURED',
              source: 'literary_evaluator',
              evidence: { quote: initialText, start: 0, end: initialText.length }
            }
          }
        }
      },
      event: { message: 'ready' }
    });
    await store.releaseLease(worker);

    const orchestratorDeps = {
      revise: async () => ({ text: revisedText, replacement: revisedText, changes: ['润色'] }),
      reaudit: async () => ({ passed: true, issues: [], quality: null }),
      commit: async () => {
        commitCallCount++;
        return { committed: true };
      }
    };
    if (revBranch.qualityAuditFn !== undefined) {
      orchestratorDeps.qualityAudit = revBranch.qualityAuditFn;
    }

    const orchestratorInstance = createGenerationOrchestrator({
      store,
      db: {},
      dependencies: orchestratorDeps
    });

    const revisionResult = await orchestratorInstance.revise({
      ...scope,
      id: created.id,
      outputHash: hashValue(initialText),
      issueId: `issue-rev-${branchIndex}`,
      quote: initialText,
      replacementWindow: { before: '', target: initialText, after: '' }
    });

    assert.equal(revisionResult.run.state, 'needs_human', `修订分支「${revBranch.caseName}」必须进入 needs_human`);
    assert.equal(revisionResult.run.result.draft, revisedText, `修订分支「${revBranch.caseName}」必须保留修订正文`);
    assert.equal(revisionResult.run.result.originalDraft, initialText, `修订分支「${revBranch.caseName}」必须保留原稿`);
    assert.equal(revisionResult.run.result.quality.passed, false, `修订分支「${revBranch.caseName}」质量门禁必须未通过`);

    await assert.rejects(
      () => orchestratorInstance.commit({ ...scope, id: created.id, text: revisedText, outputHash: hashValue(revisedText) }),
      error => error instanceof GenerationError && (error.code === 'QUALITY_UNMEASURED' || error.code === 'STATE_CONFLICT')
    );
    assert.equal(commitCallCount, 0, `修订分支「${revBranch.caseName}」被拒绝时底层 commit 写入次数必须严格为 0`);
  }
});

test('orchestrator: revise 时 qualityAudit 返回旧正文摘要或与新正文不一致的 contentHash 拒绝并进入 needs_human，commit 写入为 0', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-orch-rev-hash-mismatch-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-rev-mismatch', projectId: 'proj-rev-mismatch', actorUserId: 'author-rev-mismatch' };
  const initialText = '原始版本正文内容，带有待修订语病。';
  const revisedText = '修订后的第二版正文内容，已修复语病。';
  let commitCallCount = 0;

  const created = (await store.createRun({
    ...scope, id: 'run-rev-mismatch-test', chapterId: 'ch-rev-m-1', idempotencyKey: 'rev-m-key',
    requestHash: '7'.repeat(64), request: { chapterId: 'ch-rev-m-1' }, now: 1700000000000
  })).run;

  const leaseOwner = '88888888-8888-4888-8888-888888888888';
  const lease = await store.acquireLease({ ...scope, id: created.id, leaseOwner, now: 1700000000001 });
  const worker = { ...scope, id: created.id, leaseOwner, fencingToken: lease.fencingToken, now: 1700000000002 };

  let currentRun = created;
  for (const stateName of [
    'request_validated', 'genre_resolved', 'style_resolved', 'context_built', 'contract_validated',
    'pre_generation_guard', 'scene_planning', 'generating', 'draft_received', 'deterministic_audit',
    'semantic_audit', 'quality_audit'
  ]) currentRun = await store.updateRun({ ...worker, state: stateName });

  await store.updateRun({
    ...worker, state: 'waiting_author',
    result: {
      draft: initialText,
      outputHash: hashValue(initialText),
      contract: { chapterNo: 1 },
      genreResolution: { genre: 'universal' },
      audit: {
        issues: [{
          issueId: 'issue-m-1',
          status: 'verified',
          quote: initialText,
          problem: '语病需要局部调整'
        }]
      },
      quality: {
        passed: true,
        status: 'MEASURED',
        contentHash: hashValue(initialText),
        contentDigest: hashValue(initialText),
        qualityVector: {
          language: {
            value: 0.9, confidence: 0.9, status: 'MEASURED',
            source: 'literary_evaluator',
            evidence: { quote: initialText, start: 0, end: initialText.length }
          }
        }
      }
    },
    event: { message: 'ready' }
  });
  await store.releaseLease(worker);

  const orchestrator = createGenerationOrchestrator({
    store,
    db: {},
    dependencies: {
      revise: async () => ({ text: revisedText, replacement: revisedText, changes: ['调整字词'] }),
      reaudit: async () => ({ passed: true, issues: [], quality: null }),
      qualityAudit: async () => ({
        passed: true,
        status: 'MEASURED',
        contentHash: hashValue(initialText),
        contentDigest: hashValue(initialText),
        qualityVector: {
          language: {
            value: 0.9, confidence: 0.9, status: 'MEASURED',
            source: 'literary_evaluator',
            evidence: { quote: revisedText, start: 0, end: revisedText.length }
          }
        }
      }),
      commit: async () => {
        commitCallCount++;
        return { committed: true };
      }
    }
  });

  await assert.rejects(
    () => orchestrator.revise({
      ...scope,
      id: created.id,
      outputHash: 'mismatched-old-hash'.padEnd(64, '0'),
      issueId: 'issue-m-1',
      quote: initialText,
      replacementWindow: { before: '', target: initialText, after: '' }
    }),
    error => error instanceof GenerationError && error.code === 'STATE_CONFLICT',
    '传入过时 outputHash 必须被 revise 直接拒绝'
  );

  const revisionResult = await orchestrator.revise({
    ...scope,
    id: created.id,
    outputHash: hashValue(initialText),
    issueId: 'issue-m-1',
    quote: initialText,
    replacementWindow: { before: '', target: initialText, after: '' }
  });

  assert.equal(revisionResult.run.state, 'needs_human');
  assert.equal(revisionResult.run.result.draft, revisedText);
  assert.equal(revisionResult.run.result.originalDraft, initialText);
  assert.equal(revisionResult.run.result.quality.passed, false);

  await assert.rejects(
    () => orchestrator.commit({ ...scope, id: created.id, text: revisedText, outputHash: hashValue(revisedText) }),
    error => error instanceof GenerationError && (error.code === 'QUALITY_UNMEASURED' || error.code === 'STATE_CONFLICT')
  );
  assert.equal(commitCallCount, 0, '质量门禁未通过时 commit 写入次数必须严格为 0');
});

test('orchestrator: 手动 revision 缺失 fresh quality 阻断并标为 QUALITY_UNMEASURED', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-orch-rev-fresh-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-rev', projectId: 'proj-rev', actorUserId: 'author-rev' };
  const initialText = '原始版本正文内容。';
  const revisedText = '修订后的第二版正文内容，已修正字词。';

  const created = (await store.createRun({
    ...scope, id: 'run-revision-test', chapterId: 'ch-rev-1', idempotencyKey: 'rev-key-1',
    requestHash: 'e'.repeat(64), request: { chapterId: 'ch-rev-1' }, now: 1700000000000
  })).run;

  const leaseOwner = '44444444-4444-4444-8444-444444444444';
  const lease = await store.acquireLease({ ...scope, id: created.id, leaseOwner, now: 1700000000001 });
  const worker = { ...scope, id: created.id, leaseOwner, fencingToken: lease.fencingToken, now: 1700000000002 };

  let currentRun = created;
  for (const stateName of [
    'request_validated', 'genre_resolved', 'style_resolved', 'context_built', 'contract_validated',
    'pre_generation_guard', 'scene_planning', 'generating', 'draft_received', 'deterministic_audit',
    'semantic_audit', 'quality_audit'
  ]) currentRun = await store.updateRun({ ...worker, state: stateName });

  await store.updateRun({
    ...worker, state: 'waiting_author',
    result: {
      draft: initialText,
      outputHash: hashValue(initialText),
      contract: { chapterNo: 1 },
      genreResolution: { genre: 'universal' },
      audit: {
        issues: [{
          issueId: 'issue-rev-1',
          status: 'verified',
          quote: initialText,
          problem: '缺少细节'
        }]
      },
      quality: {
        passed: true,
        status: 'MEASURED',
        qualityVector: {
          language: {
            value: 0.9, confidence: 0.9, status: 'MEASURED',
            source: 'literary_evaluator',
            evidence: { quote: initialText, start: 0, end: initialText.length }
          }
        }
      }
    },
    event: { message: 'ready' }
  });
  await store.releaseLease(worker);

  const orchestrator = createGenerationOrchestrator({
    store,
    db: {},
    dependencies: {
      revise: async () => ({ text: revisedText, replacement: revisedText, changes: ['润色文字'] }),
      reaudit: async () => ({ passed: true, issues: [], quality: null })
    }
  });

  const revisionResult = await orchestrator.revise({
    ...scope,
    id: created.id,
    outputHash: hashValue(initialText),
    issueId: 'issue-rev-1',
    quote: initialText,
    replacementWindow: { before: '', target: initialText, after: '' }
  });

  assert.equal(revisionResult.run.state, 'needs_human');
  assert.equal(revisionResult.run.result.draft, revisedText);
  assert.equal(revisionResult.run.result.originalDraft, initialText);
  assert.equal(revisionResult.run.result.quality.passed, false);
});

test('orchestrator: 旧摘要拒绝与 quality 缺失拒绝时底层写入调用严格为 0 (commit writing=0)', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-orch-writing0-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-w0', projectId: 'proj-w0', actorUserId: 'author-w0' };
  const validText = '符合门禁的章节正文。';
  const validHash = hashValue(validText);
  let commitCallCount = 0;

  const created = (await store.createRun({
    ...scope, id: 'run-w0-test', chapterId: 'ch-w0-1', idempotencyKey: 'w0-key',
    requestHash: 'f'.repeat(64), request: { chapterId: 'ch-w0-1' }, now: 1700000000000
  })).run;

  const leaseOwner = '55555555-5555-4555-8555-555555555555';
  const lease = await store.acquireLease({ ...scope, id: created.id, leaseOwner, now: 1700000000001 });
  const worker = { ...scope, id: created.id, leaseOwner, fencingToken: lease.fencingToken, now: 1700000000002 };

  let currentRun = created;
  for (const stateName of [
    'request_validated', 'genre_resolved', 'style_resolved', 'context_built', 'contract_validated',
    'pre_generation_guard', 'scene_planning', 'generating', 'draft_received', 'deterministic_audit',
    'semantic_audit', 'quality_audit'
  ]) currentRun = await store.updateRun({ ...worker, state: stateName });

  await store.updateRun({
    ...worker, state: 'waiting_author',
    result: {
      draft: validText,
      outputHash: validHash,
      quality: {
        passed: false,
        status: 'NOT_MEASURED',
        qualityVector: {}
      }
    },
    event: { message: 'ready' }
  });
  await store.releaseLease(worker);

  const orchestrator = createGenerationOrchestrator({
    store,
    db: {},
    dependencies: {
      commit: async () => {
        commitCallCount++;
        return { committed: true };
      }
    }
  });

  await assert.rejects(
    () => orchestrator.commit({ ...scope, id: created.id, text: validText, outputHash: 'tampered-hash' }),
    error => error instanceof GenerationError && error.code === 'STATE_CONFLICT'
  );
  assert.equal(commitCallCount, 0, '旧摘要或不匹配哈希被拒绝且底层写入调用次数为 0');

  await assert.rejects(
    () => orchestrator.commit({ ...scope, id: created.id, text: validText, outputHash: validHash }),
    error => error instanceof GenerationError && error.code === 'QUALITY_UNMEASURED'
  );
  assert.equal(commitCallCount, 0, 'qualityGate 失败被拒绝且底层写入调用次数为 0');
});

test('orchestrator: revision qualityAudit 抛出 PROVIDER_UNKNOWN 保持 provider_unknown 状态与原稿/修订稿', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-orch-unknown-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-unk', projectId: 'proj-unk', actorUserId: 'author-unk' };
  const originalText = '修订前的第一版草稿。';
  const revisedDraft = '修订后的第二版草稿内容。';

  const created = (await store.createRun({
    ...scope, id: 'run-unk-test', chapterId: 'ch-unk-1', idempotencyKey: 'unk-key',
    requestHash: '1'.repeat(64), request: { chapterId: 'ch-unk-1' }, now: 1700000000000
  })).run;

  const leaseOwner = '66666666-6666-4666-8666-666666666666';
  const lease = await store.acquireLease({ ...scope, id: created.id, leaseOwner, now: 1700000000001 });
  const worker = { ...scope, id: created.id, leaseOwner, fencingToken: lease.fencingToken, now: 1700000000002 };

  let currentRun = created;
  for (const stateName of [
    'request_validated', 'genre_resolved', 'style_resolved', 'context_built', 'contract_validated',
    'pre_generation_guard', 'scene_planning', 'generating', 'draft_received', 'deterministic_audit',
    'semantic_audit', 'quality_audit'
  ]) currentRun = await store.updateRun({ ...worker, state: stateName });

  await store.updateRun({
    ...worker, state: 'waiting_author',
    result: {
      draft: originalText,
      outputHash: hashValue(originalText),
      contract: { chapterNo: 1 },
      genreResolution: { genre: 'universal' },
      audit: {
        issues: [{
          issueId: 'issue-unk-1',
          status: 'verified',
          quote: originalText,
          problem: '语病'
        }]
      }
    },
    event: { message: 'ready' }
  });
  await store.releaseLease(worker);

  const unknownError = new GenerationError('PROVIDER_UNKNOWN', '质检外部服务调用超时未响应', { status: 504 });
  unknownError.unknown = true;

  const orchestrator = createGenerationOrchestrator({
    store,
    db: {},
    dependencies: {
      revise: async () => ({ text: revisedDraft, replacement: revisedDraft, changes: ['修改措辞'] }),
      reaudit: async () => ({ passed: true, issues: [], quality: null }),
      qualityAudit: async () => {
        throw unknownError;
      }
    }
  });

  await assert.rejects(
    () => orchestrator.revise({
      ...scope,
      id: created.id,
      outputHash: hashValue(originalText),
      issueId: 'issue-unk-1',
      quote: originalText,
      replacementWindow: { before: '', target: originalText, after: '' }
    }),
    error => error instanceof GenerationError && error.code === 'PROVIDER_UNKNOWN'
  );

  const persistedRun = await store.getRun({}, { ...scope, id: created.id });
  assert.equal(persistedRun.state, 'provider_unknown');
  assert.equal(persistedRun.result.draft, revisedDraft);
  assert.equal(persistedRun.result.originalDraft, originalText);
  assert.equal(persistedRun.result.revisions.length, 1);
});

test('orchestrator: committing 恢复保持且已 committed 幂等回执不重复调用底层 commit', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-orch-committing-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-rec', projectId: 'proj-rec', actorUserId: 'author-rec' };
  const text = '恢复测试正文。';
  const outputHash = hashValue(text);
  let commitCount = 0;

  const created = (await store.createRun({
    ...scope, id: 'run-rec-test', chapterId: 'ch-rec-1', idempotencyKey: 'rec-key',
    requestHash: '2'.repeat(64), request: { chapterId: 'ch-rec-1' }, now: 1700000000000
  })).run;

  const leaseOwner = '77777777-7777-4777-8777-777777777777';
  const lease = await store.acquireLease({ ...scope, id: created.id, leaseOwner, now: 1700000000001 });
  const worker = { ...scope, id: created.id, leaseOwner, fencingToken: lease.fencingToken, now: 1700000000002 };

  let currentRun = created;
  for (const stateName of [
    'request_validated', 'genre_resolved', 'style_resolved', 'context_built', 'contract_validated',
    'pre_generation_guard', 'scene_planning', 'generating', 'draft_received', 'deterministic_audit',
    'semantic_audit', 'quality_audit', 'waiting_author'
  ]) currentRun = await store.updateRun({ ...worker, state: stateName });

  await store.updateRun({
    ...worker, state: 'committing',
    result: {
      draft: text,
      outputHash,
      quality: {
        passed: true,
        status: 'MEASURED',
        qualityVector: {
          language: {
            value: 0.92, confidence: 0.92, status: 'MEASURED',
            source: 'literary_evaluator',
            evidence: { quote: text, start: 0, end: text.length }
          }
        }
      }
    },
    event: { message: 'committing' }
  });
  await store.releaseLease(worker);

  const orchestrator = createGenerationOrchestrator({
    store,
    db: {},
    dependencies: {
      commit: async () => {
        commitCount++;
        return { committed: true, snapshotId: 'snap-recovered-1', stateVersion: 5, contentHash: outputHash };
      }
    }
  });

  const recoveryResult = await orchestrator.commit({ ...scope, id: created.id, text, outputHash });
  assert.equal(recoveryResult.run.state, 'committed');
  assert.equal(commitCount, 1);

  const idempotentResult = await orchestrator.commit({ ...scope, id: created.id, text, outputHash });
  assert.equal(idempotentResult.idempotent, true);
  assert.equal(commitCount, 1, '已提交状态再次调用 commit 绝不重复执行底层写入');
});

test('orchestrator: 非 pipeline 纯文本自动生成在 qualityAudit 缺失或返回 undefined / null / 空对象时在 manifest 门禁直接终止为 failed，qualityAudit 与 commit 均不执行', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-orch-plain-auto-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    if (directory && directory.startsWith(os.tmpdir())) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  const scope = { workspaceId: 'ws-plain-auto', projectId: 'proj-plain-auto', actorUserId: 'author-plain-auto' };

  const testBranches = [
    {
      caseName: 'quality_audit_dependency_missing',
      qualityAuditFunction: undefined
    },
    {
      caseName: 'quality_audit_returns_undefined',
      qualityAuditFunction: async () => undefined
    },
    {
      caseName: 'quality_audit_returns_null',
      qualityAuditFunction: async () => null
    },
    {
      caseName: 'quality_audit_returns_empty_object',
      qualityAuditFunction: async () => ({})
    }
  ];

  for (let branchIndex = 0; branchIndex < testBranches.length; branchIndex++) {
    const branchCase = testBranches[branchIndex];
    let writerCallCount = 0;
    let qualityAuditCallCount = 0;
    let commitCallCount = 0;
    const runId = `run-plain-auto-${branchIndex}`;
    const draftText = '这是未包装pipeline的原始正文生成内容。';

    const orchestratorDeps = {
      resolveGenre: () => ({ status: 'resolved', genre: 'universal' }),
      resolveStyle: () => ({ status: 'resolved', style: '平实叙事' }),
      loadAuthoritativeContext: () => ({ ok: true, snapshotHash: 'snap-hash-plain', storyContext: {} }),
      preGenerationGuard: () => ({ passed: true, snapshotHash: 'snap-hash-plain' }),
      planScenes: () => [{ id: 'scene-1', goal: '主要情节' }],
      deterministicAudit: () => ({ passed: true, issues: [] }),
      semanticAudit: () => ({ passed: true, issues: [] }),
      commit: async () => {
        commitCallCount++;
        return { committed: true };
      },
      writer: async () => {
        writerCallCount++;
        return {
          text: draftText
        };
      }
    };
    if (branchCase.qualityAuditFunction !== undefined) {
      orchestratorDeps.qualityAudit = async (argumentPayload) => {
        qualityAuditCallCount++;
        return branchCase.qualityAuditFunction(argumentPayload);
      };
    }

    const orchestratorInstance = createGenerationOrchestrator({
      store,
      db: {},
      dependencies: orchestratorDeps
    });

    const created = await orchestratorInstance.create({
      ...scope,
      id: runId,
      chapterId: 'ch-plain-auto',
      idempotencyKey: `key-plain-auto-${branchIndex}`,
      requestHash: String(branchIndex).padStart(64, '9'),
      request: { chapterId: 'ch-plain-auto', prompt: '写一段纯文本正文' }
    });

    let runSettled = false;
    for (let pollIndex = 0; pollIndex < 60; pollIndex++) {
      const currentRun = await store.getRun({}, { ...scope, id: created.run.id });
      if (currentRun && (currentRun.state === 'failed' || currentRun.state === 'needs_human' || currentRun.state === 'waiting_author')) {
        runSettled = true;
        assert.equal(currentRun.state, 'failed');
        assert.equal(currentRun.errorCode, 'MODEL_CONTENT_BLOCKED');
        break;
      }
      await new Promise(resolveWait => setTimeout(resolveWait, 20));
    }
    assert.equal(runSettled, true);
    assert.equal(writerCallCount, 1);
    assert.equal(qualityAuditCallCount, 0);

    const persistedRun = await repository.generation.get(scope.projectId, created.run.id);
    assert.ok(persistedRun);
    const hasQualityAuditStage = Array.isArray(persistedRun.stages) &&
      persistedRun.stages.some(stageRecord => stageRecord && stageRecord.stage === 'quality_audit');
    assert.equal(hasQualityAuditStage, false);

    const runEvents = await store.listEvents({}, { ...scope, generationId: created.run.id });
    const reachedWaitingAuthor = Array.isArray(runEvents) &&
      runEvents.some(eventRecord => eventRecord && eventRecord.state === 'waiting_author');
    assert.equal(reachedWaitingAuthor, false);

    await assert.rejects(
      () => orchestratorInstance.commit({ ...scope, id: created.run.id, text: draftText, outputHash: hashValue(draftText) }),
      errorItem => errorItem instanceof GenerationError && errorItem.code === 'STATE_CONFLICT'
    );
    assert.equal(commitCallCount, 0);
  }
});

test('orchestrator: Single Brain Consolidation - 端到端经单审计踪迹自主达成 waiting_author 并成功提交 commit', async testContext => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-orch-brain-commit-'));
  const repository = new JsonFileRepository(directory);
  const store = createJsonGenerationStore(directory, { repository });
  testContext.after(async () => {
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const scope = { workspaceId: 'ws-brain-commit', projectId: 'proj-brain-commit', actorUserId: 'author-brain-commit' };
  const runId = 'run-brain-commit-1';
  const chapterId = 'ch-brain-commit-1';
  const draftText = '夜幕笼罩着空旷的甲板，海风裹挟着腥咸的湿气扑面而来。林巡警惕地扫视四周，在救生艇底座旁发现了那枚遗落的青铜徽记。';

  let writerCalls = 0;
  let deterministicAuditCalls = 0;
  let semanticAuditCalls = 0;
  let qualityAuditCalls = 0;
  let commitCalls = 0;

  const orchestratorDeps = {
    resolveGenre: () => ({ status: 'resolved', genre: '悬疑' }),
    resolveStyle: () => ({ status: 'resolved', style: '冷硬' }),
    loadAuthoritativeContext: () => ({
      ok: true,
      snapshotHash: 'snap-hash-commit',
      storyContext: { pov: 'third-limited', characters: ['林巡'] }
    }),
    preGenerationGuard: () => ({ passed: true, snapshotHash: 'snap-hash-commit' }),
    planScenes: () => [{ id: 's1', goal: '排查甲板' }, { id: 's2', goal: '搜寻青铜徽记' }],
    writer: async ({ request: runRequest, contract, contextPlan }) => {
      writerCalls++;
      return {
        text: draftText,
        manifest: buildGenerationManifest({
          generationId: runId,
          projectId: scope.projectId,
          chapterId,
          pipelineVersion: 'content-engine-v2',
          contextHash: contextPlan.contextHash,
          contractHash: contractHash(contract),
          promptHash: 'prompt-brain-commit',
          outputHash: hashValue(draftText)
        })
      };
    },
    deterministicAudit: async () => {
      deterministicAuditCalls++;
      return { passed: true, issues: [], blockerCount: 0, unverifiedCount: 0 };
    },
    semanticAudit: async () => {
      semanticAuditCalls++;
      return { passed: true, status: 'MEASURED', issues: [] };
    },
    qualityAudit: async ({ draft }) => {
      qualityAuditCalls++;
      return {
        passed: true,
        status: 'MEASURED',
        score: 0.88,
        confidence: 0.90,
        contentDigest: hashValue(draft),
        source: 'dual_judge_consensus',
        qualityVector: {
          clueIntegrity: {
            value: 0.88,
            confidence: 0.90,
            status: 'MEASURED',
            source: 'dual_judge_consensus',
            quote: '在救生艇底座旁发现了那枚遗落的青铜徽记。',
            evidence: '线索发现自然，悬疑链条闭合'
          },
          povBoundary: {
            value: 0.90,
            confidence: 0.92,
            status: 'MEASURED',
            source: 'dual_judge_consensus',
            quote: '林巡警惕地扫视四周',
            evidence: '第三人称限知视角严谨无越界'
          },
          language: {
            value: 0.86,
            confidence: 0.90,
            status: 'MEASURED',
            source: 'dual_judge_consensus',
            quote: '海风裹挟着腥咸的湿气扑面而来。',
            evidence: '环境质感烘托充分'
          }
        }
      };
    },
    commit: async () => {
      commitCalls++;
      return { committed: true, snapshotId: 'snap-brain-commit-final', contentHash: hashValue(draftText) };
    }
  };

  const orchestratorInstance = createGenerationOrchestrator({
    store,
    db: repository,
    dependencies: orchestratorDeps
  });

  const created = await orchestratorInstance.create({
    ...scope,
    id: runId,
    chapterId,
    idempotencyKey: 'idem-brain-commit',
    requestHash: '8'.repeat(64),
    request: { chapterId, prompt: '甲板夜探' }
  });

  let settled = false;
  for (let i = 0; i < 60; i++) {
    const currentRun = await store.getRun({}, { ...scope, id: created.run.id });
    if (currentRun && (currentRun.state === 'waiting_author' || currentRun.state === 'needs_human' || currentRun.state === 'failed')) {
      settled = true;
      assert.equal(currentRun.state, 'waiting_author');
      assert.equal(currentRun.result.draft, draftText);
      assert.equal(currentRun.result.quality.passed, true);
      break;
    }
    await new Promise(r => setTimeout(r, 20));
  }
  assert.equal(settled, true);

  // 单审计踪迹断言：每项审计严格执行恰好 1 次
  assert.equal(writerCalls, 1);
  assert.equal(deterministicAuditCalls, 1);
  assert.equal(semanticAuditCalls, 1);
  assert.equal(qualityAuditCalls, 1);

  // 成功提交断言
  const commitResult = await orchestratorInstance.commit({
    ...scope,
    id: created.run.id,
    text: draftText,
    outputHash: hashValue(draftText)
  });
  assert.equal(commitResult.run.state, 'committed');
  assert.equal(commitCalls, 1);
});


