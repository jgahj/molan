import crypto from 'node:crypto';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createPostgresRepository } = require('../lib/postgres-repository.js');

/** 运行一条不调用模型的 PostgreSQL 多用户纵向闭环。 */
async function main() {
  const repository = createPostgresRepository(process.env);
  if (!repository.enabled) throw new Error('未启用 PostgreSQL，请设置 MOLAN_PG_ENABLED=1');
  const suffix = crypto.randomBytes(6).toString('hex');
  const userA = `usr_pg_smoke_a_${suffix}`;
  const userB = `usr_pg_smoke_b_${suffix}`;
  const workspaceId = `ws_pg_smoke_${suffix}`;
  const projectId = `n_pg_smoke_${suffix}`;
  const state = {
    title: 'PostgreSQL纵向闭环',
    volumes: [{ id: 'volume-1', title: '第一卷', chapters: [] }],
    creationAssets: { worldRules: [{ id: 'rule-1', text: '只用于数据库烟测' }] }
  };
  let stage = 'save-profile';
  try {
    const created = await repository.saveProfile({
      userId: userA,
      workspaceId,
      projectId,
      title: state.title,
      state
    });
    if (!created.ok || created.revision !== 1) throw new Error('首次作品资料保存失败');
    stage = 'get-profile';
    const firstRead = await repository.getProfile(userA, projectId, workspaceId);
    if (!firstRead || firstRead.state.creationAssets.worldRules[0].id !== 'rule-1') {
      throw new Error('作品资料读取失败');
    }
    if (await repository.getProfile(userB, projectId, workspaceId)) throw new Error('未授权用户读取到了项目');

    stage = 'workspace-member';
    await repository.upsertWorkspaceMember(userA, workspaceId, userB, 'member');
    const workspaceMembers = await repository.listWorkspaceMembers(userA, workspaceId);
    if (!workspaceMembers.some(member => member.userId === userB && member.role === 'member')) {
      throw new Error('工作区成员列表读取失败');
    }
    stage = 'project-member';
    await repository.upsertProjectMember(userA, workspaceId, projectId, userB, 'editor', false, false, false, firstRead.access.acl_revision);
    const projectMembers = await repository.listProjectMembers(userA, workspaceId, projectId);
    if (!projectMembers.some(member => member.userId === userB && member.role === 'editor')) {
      throw new Error('项目成员列表读取失败');
    }
    stage = 'shared-profile';
    const sharedRead = await repository.getProfile(userB, projectId, workspaceId);
    if (!sharedRead || sharedRead.access.role !== 'editor') throw new Error('协作者授权或读取失败');

    stage = 'editor-save';
    const nextState = { ...sharedRead.state, title: '协作者保存', revisionMarker: 'b' };
    const updated = await repository.saveProfile({
      userId: userB,
      workspaceId,
      projectId,
      title: nextState.title,
      state: nextState,
      expectedRevision: sharedRead.revision
    });
    if (updated.revision !== 2) throw new Error('协作者 CAS 保存失败');
    stage = 'stale-save';
    let conflictCode = '';
    try {
      await repository.saveProfile({
        userId: userA,
        workspaceId,
        projectId,
        title: '过期保存',
        state: { ...state, title: '过期保存' },
        expectedRevision: firstRead.revision
      });
    } catch (error) {
      conflictCode = String(error.code || '');
    }
    if (conflictCode !== 'revision_conflict') throw new Error('过期版本未被拒绝');

    stage = 'resource-create';
    const createdResource = await repository.createResource({
      userId: userA,
      workspaceId,
      projectId,
      kind: 'character',
      id: 'character-pg-smoke',
      payload: { name: '数据库角色', age: 1 }
    });
    stage = 'resource-read';
    const resourceRead = await repository.listResources(userB, projectId, 'character', 'character-pg-smoke', workspaceId);
    if (!resourceRead || resourceRead.payload.age !== 1) throw new Error('协作者读取资料失败');
    stage = 'resource-update';
    const resourceUpdate = await repository.updateResource({
      userId: userB,
      workspaceId,
      projectId,
      kind: 'character',
      resourceId: 'character-pg-smoke',
      payload: { name: '数据库角色', age: 2 },
      expectedRevision: resourceRead.revision
    });
    if (!resourceUpdate.ok || resourceUpdate.resource.revision !== 2) throw new Error('资料 CAS 更新失败');
    stage = 'resource-delete';
    const deleted = await repository.deleteResource({
      userId: userA,
      workspaceId,
      projectId,
      kind: 'character',
      resourceId: 'character-pg-smoke',
      expectedRevision: resourceUpdate.resource.revision
    });
    if (!deleted.ok || deleted.resource.status !== 'deleted') throw new Error('资料软删除失败');
    stage = 'resource-restore';
    const restored = await repository.restoreResource({
      userId: userA,
      workspaceId,
      projectId,
      kind: 'character',
      resourceId: 'character-pg-smoke',
      expectedRevision: deleted.resource.revision
    });
    if (!restored.ok || restored.resource.status !== 'active') throw new Error('资料恢复失败');
    stage = 'resource-projection-save';
    const projectedProfile = await repository.getProfile(userA, projectId, workspaceId);
    const projectedEntities = projectedProfile.state.knowledge && projectedProfile.state.knowledge.entities;
    if (!projectedEntities || Array.isArray(projectedEntities) || !projectedEntities['character-pg-smoke']) {
      throw new Error('结构化资料未回投到作品 state');
    }
    const projectedState = {
      ...projectedProfile.state,
      knowledge: {
        ...projectedProfile.state.knowledge,
        entities: {
          ...projectedEntities,
          'character-pg-smoke': { ...projectedEntities['character-pg-smoke'], age: 3 }
        }
      }
    };
    const projectedSave = await repository.saveProfile({
      userId: userA,
      workspaceId,
      projectId,
      title: projectedState.title,
      state: projectedState,
      expectedRevision: projectedProfile.revision
    });
    if (!projectedSave.ok || (await repository.listResources(userA, projectId, 'character', 'character-pg-smoke', workspaceId)).payload.age !== 3) {
      throw new Error('旧编辑器 state 保存未同步结构化资料');
    }
    stage = 'resource-projection-conflict';
    let projectionConflictCode = '';
    try {
      await repository.saveProfile({
        userId: userA,
        workspaceId,
        projectId,
        title: projectedState.title,
        state: {
          ...projectedState,
          knowledge: {
            ...projectedState.knowledge,
            entities: {
              ...projectedState.knowledge.entities,
              'character-pg-smoke': { ...projectedState.knowledge.entities['character-pg-smoke'], age: 4 }
            }
          }
        },
        expectedRevision: projectedSave.revision
      });
    } catch (error) {
      projectionConflictCode = String(error.code || '');
    }
    if (projectionConflictCode !== 'revision_conflict') throw new Error('结构化资料并发更新未被拒绝');

    stage = 'creation-book';
    let creationBook;
    try {
      creationBook = await repository.createCreationBook({
      userId: userA,
      workspaceId,
      projectId,
      bookId: `cb_pg_smoke_${suffix}`,
      title: 'PG创作书',
      plan: { totalChapters: 1 },
      payload: { creationPlan: { totalChapters: 1 }, chapterPlan: [] }
      });
    } catch (error) {
      throw new Error('PG创作书首版Bible保存失败：' + String(error && error.code || '') + ' ' + String(error && error.message || ''));
    }
    if (!creationBook.ok || !creationBook.bible) throw new Error('PG创作书首版Bible保存失败');
    stage = 'creation-bible-read';
    const bibleRead = await repository.getCreationBible(userA, creationBook.book.id);
    if (!bibleRead || !bibleRead.bible || bibleRead.bible.version !== 1) throw new Error('PG创作书Bible读取失败');
    stage = 'creation-bible-update';
    const bibleUpdate = await repository.putCreationBible({
      userId: userA,
      bookId: creationBook.book.id,
      payload: { ...bibleRead.bible.payload, chapterPlan: [{ chapterNo: 1, goal: '完成PG存储闭环' }] },
      expectedRevision: bibleRead.bible.version
    });
    if (!bibleUpdate.ok || bibleUpdate.bibleVersion !== 2) throw new Error('PG创作书Bible CAS保存失败');
    stage = 'generation-run-create';
    const content = '这是用于数据库闭环验证的章节正文。';
    const contentHash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
    const runId = crypto.randomUUID();
    const request = { creationBookId: creationBook.book.id, chapterNo: 1, smoke: true };
    const generation = await repository.createGenerationRun({
      userId: userA,
      workspaceId,
      projectId,
      id: runId,
      chapterId: 'chapter_1',
      pipelineVersion: 'postgres-runtime-smoke-v1',
      idempotencyKey: `postgres-runtime-smoke-${suffix}`,
      requestHash: crypto.createHash('sha256').update(JSON.stringify(request), 'utf8').digest('hex'),
      request,
      manifest: { smoke: true },
      modelId: 'postgres-runtime-smoke',
      providerModel: 'no-provider-call'
    });
    if (!generation.run || generation.run.id !== runId || generation.idempotent) throw new Error('Generation Run创建失败');
    stage = 'generation-run-lease';
    const initialOwner = crypto.randomUUID();
    const initialLease = await repository.acquireGenerationRunLease({
      userId: userA, workspaceId, projectId, id: runId, leaseOwner: initialOwner, ttlMs: 60000
    });
    if (!initialLease.acquired || initialLease.fencingToken !== 1) throw new Error('Generation Run初始fencing租约获取失败');
    const initialWorker = { userId: userA, workspaceId, projectId, id: runId, leaseOwner: initialOwner, fencingToken: initialLease.fencingToken };
    const chapterResult = {
      draft: content,
      outputHash: contentHash,
      contract: { chapterNo: 1 },
      audit: { passed: true, blockerCount: 0, issues: [] },
      semanticAudit: { passed: true, audit: { passed: true, issues: [] } },
      quality: { passed: true, qualityVector: { language: { value: 0.9, status: 'MEASURED' } } }
    };
    for (const state of [
      'request_validated', 'genre_resolved', 'style_resolved', 'context_built', 'contract_validated',
      'pre_generation_guard', 'scene_planning', 'generating', 'draft_received', 'deterministic_audit',
      'semantic_audit', 'quality_audit', 'waiting_author'
    ]) {
      const updatedRun = await repository.updateGenerationRun({
        ...initialWorker,
        state,
        event: { message: `PG runtime smoke: ${state}` },
        ...(state === 'waiting_author' ? { result: chapterResult } : {})
      });
      if (updatedRun.state !== state) throw new Error(`Generation Run状态迁移失败：${state}`);
    }
    if (!await repository.releaseGenerationRunLease(initialWorker)) throw new Error('Generation Run初始租约释放失败');
    stage = 'generation-run-commit-lease';
    const commitOwner = crypto.randomUUID();
    const commitLease = await repository.acquireGenerationRunLease({
      userId: userA, workspaceId, projectId, id: runId, leaseOwner: commitOwner, leasePurpose: 'commit', ttlMs: 60000
    });
    if (!commitLease.acquired || commitLease.fencingToken !== 2) throw new Error('Generation Run提交fencing租约获取失败');
    const commitWorker = { userId: userA, workspaceId, projectId, id: runId, leaseOwner: commitOwner, fencingToken: commitLease.fencingToken };
    const committingRun = await repository.updateGenerationRun({
      ...commitWorker,
      state: 'committing',
      event: { message: 'PG runtime smoke: committing' }
    });
    if (committingRun.state !== 'committing') throw new Error('Generation Run进入提交态失败');
    stage = 'creation-audit';
    const audit = await repository.createGenerationChapterAudit({
      userId: userA,
      bookId: creationBook.book.id,
      generationId: runId,
      chapterNo: 1,
      content,
      contentHash
    });
    stage = 'creation-commit';
    const committed = await repository.commitChapter({
      userId: userA,
      workspaceId,
      projectId,
      bookId: creationBook.book.id,
      generationId: runId,
      runLeaseOwner: commitOwner,
      fencingToken: commitLease.fencingToken,
      chapterNo: 1,
      content,
      contentHash,
      auditId: audit.auditId,
      baseStateVersion: 0
    });
    if (!committed.ok || committed.stateVersion !== 1) throw new Error('PG创作书章节提交失败');
    const finishedRun = await repository.updateGenerationRun({
      ...commitWorker,
      state: 'committed',
      result: { ...chapterResult, commitReceipt: committed },
      event: { message: 'PG runtime smoke: committed' }
    });
    if (finishedRun.state !== 'committed' || !finishedRun.result.commitReceipt) throw new Error('Generation Run提交回执保存失败');
    if (!await repository.releaseGenerationRunLease(commitWorker)) throw new Error('Generation Run提交租约释放失败');
    stage = 'creation-state';
    const creationState = await repository.getCreationState(userA, creationBook.book.id);
    if (!creationState || creationState.snapshots.length !== 1) throw new Error('PG创作书状态快照读取失败');

    await repository.deactivateProjectMember(userA, workspaceId, projectId, userB);
    if (await repository.getProfile(userB, projectId, workspaceId)) throw new Error('撤权后仍可读取项目');
    const removed = await repository.deleteProject(userA, projectId, workspaceId);
    if (!removed.deleted) throw new Error('项目软删除失败');
    const recovered = await repository.restoreProject(userA, projectId);
    if (!recovered.restored) throw new Error('项目恢复失败');
    process.stdout.write(JSON.stringify({
      ok: true,
      projectId,
      workspaceId,
      checks: ['profile', 'project-member', 'cas', 'resource-version', 'resource-projection-cas', 'creation-bible', 'generation-run-fencing', 'creation-audit-commit', 'revoke', 'project-restore']
    }) + '\n');
  } catch (error) {
    const wrapped = new Error(stage + ': ' + String(error && error.message || '') + (error && error.databaseCode ? ` [${error.databaseCode}] ${error.databaseMessage || ''}` : ''));
    wrapped.code = error && error.code;
    wrapped.status = error && error.status;
    throw wrapped;
  } finally {
    await repository.close();
  }
}

main().catch(error => {
  process.stderr.write(JSON.stringify({
    ok: false,
    code: String(error && error.code || 'postgres_smoke_failed'),
    error: String(error && error.message || 'PostgreSQL 运行时烟测失败')
  }) + '\n');
  process.exitCode = 1;
});
