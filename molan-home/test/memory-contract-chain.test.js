'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { JsonFileRepository } = require('../lib/repositories/json-file-repository');
const { JsonAppRepository } = require('../lib/repositories/json-app-repository');
const { JsonCreationRepository } = require('../lib/repositories/json-creation-repository');
const { createJsonStyleProfileStore } = require('../lib/style-profile-store');
const { createMemoryStore } = require('../lib/memory-store');
const projectScope = require('../lib/project-scope');

async function fixture(context, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-memory-contract-'));
  const author = { userId: 'usr_author', email: 'author@memory-contract.test' };
  const reviewer = { userId: 'usr_reviewer', email: 'reviewer@memory-contract.test' };
  const bookId = `n_contract${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
  const creationBookId = `cb_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
  const state = {
    title: '合同链测试',
    volumes: [{
      id: 'v1',
      title: '第一卷',
      chapters: [{ id: 'c1', title: '第一章', content: '<p>初始正文</p>' }]
    }]
  };
  const repository = new JsonFileRepository(directory);
  const app = new JsonAppRepository(directory, { repository });
  const creation = new JsonCreationRepository(app);
  const styles = createJsonStyleProfileStore(directory, { repository });
  const scope = { userId: author.userId, bookId };
  const store = createMemoryStore({ repository, getAccess: input => app.getAccess(input) });

  await app.saveAccount(author);
  await app.saveAccount(reviewer);
  await app.create({ id: bookId, user: author, state });
  const created = await repository.novels.get(bookId, bookId);
  await app.saveCAS({ userId: author.userId, projectId: bookId, state: created.state, expectedRevision: created.contentRevision });
  if (options.withBaselineSources !== false) {
    await creation.create({ userId: author.userId, projectId: bookId, bookId: creationBookId, title: state.title, plan: { totalChapters: 1 }, payload: {} });
    if (options.withStyleProfile !== false) {
      await styles.upsertStyleProfile({ projectId: bookId, bookId: creationBookId, id: 'style-baseline', branchId: 'main', name: '基线文风' });
    }
  }

  context.after(async () => {
    await styles.close();
    await store.close();
    await repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { directory, author, reviewer, bookId, creationBookId, scope, state, repository, app, creation, styles, store };
}

async function readBaselineVersions(fixtureState) {
  const { author, bookId, creationBookId, scope, repository, app, creation, styles, store } = fixtureState;
  const [novel, book, bible, profiles, policies, access] = await Promise.all([
    repository.novels.get(bookId, bookId),
    creation.read({ userId: author.userId, projectId: bookId, bookId: creationBookId }),
    creation.readBible({ userId: author.userId, projectId: bookId, bookId: creationBookId }),
    styles.getStyleProfiles({ projectId: bookId, bookId: creationBookId, branchId: 'main' }),
    store.getRecords({ ...scope, type: 'disclosure' }),
    app.getAccess({ userId: author.userId, projectId: bookId })
  ]);
  assert.ok(novel);
  assert.ok(book);
  assert.ok(Object.hasOwn(book, 'currentStateVersion'));
  assert.ok(bible && Number.isSafeInteger(Number(bible.version)));
  assert.equal(profiles.length, 1);
  assert.equal(policies.length, 1);
  assert.ok(access && Number.isSafeInteger(Number(access.acl_revision)));
  return {
    expectedNovelRevision: Number(novel.contentRevision),
    expectedBibleVersion: Number(bible.version),
    expectedPlanVersion: Number(book.currentStateVersion),
    expectedStyleVersion: Number(profiles[0].revision),
    expectedDisclosurePolicyVersion: policies.length,
    expectedAclRevision: Number(access.acl_revision)
  };
}

async function createCandidate(fixtureState, operations, overrides = {}) {
  const state = await fixtureState.store.workbenchState(fixtureState.scope);
  return fixtureState.store.createChangeset({
    ...fixtureState.scope,
    ...overrides,
    baseStateVersion: overrides.baseStateVersion ?? state.stateVersion,
    operations
  });
}

async function approveCandidate(fixtureState, candidate, userId = fixtureState.author.userId) {
  return fixtureState.store.approveChangeset({
    ...fixtureState.scope, userId, changesetId: candidate.id
  });
}

async function saveReviewedManuscript(fixtureState, text) {
  const { store, scope, bookId, repository } = fixtureState;
  const novel = await repository.novels.get(bookId, bookId);
  const manuscript = await store.saveManuscript({
    ...scope, chapterId: 'c1', text, expectedRevision: 0, expectedNovelRevision: novel.contentRevision
  });
  const review = await store.rewrite({
    ...scope,
    manuscriptRevisionId: manuscript.id,
    contract: { bookId, taskType: 'manual-review' }
  });
  assert.equal(review.compliant, true);
  assert.ok(review.review);
  return { manuscript, rewriteReviewId: review.review.id };
}

async function createSourceCandidate(fixtureState, source, operations, overrides = {}) {
  return createCandidate(fixtureState, operations, {
    ...overrides,
    manuscriptRevisionId: source.manuscript.id,
    rewriteReviewId: source.rewriteReviewId
  });
}

async function commitOperations(fixtureState, operations) {
  const candidate = await createCandidate(fixtureState, operations);
  await approveCandidate(fixtureState, candidate);
  return fixtureState.store.commitChangeset({ ...fixtureState.scope, changesetId: candidate.id });
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, { code });
}

test('六维基线正式提交合同：正文、圣经、计划、文风、披露、ACL版本失配均拒绝，一致时原子提交', async context => {
  const fixtureState = await fixture(context);
  const { store, scope, bookId, repository } = fixtureState;

  const extracted = await store.extract({ ...scope, text: '魔门圣女真实身份是宗主之女。' });
  const propositionId = extracted.propositions[0].id;
  await commitOperations(fixtureState, [{
    type: 'SET_DISCLOSURE',
    payload: { id: 'dp_baseline', targetInfoId: propositionId, policyType: 'hide' }
  }]);
  const baseline = await readBaselineVersions(fixtureState);

  const source = await saveReviewedManuscript(fixtureState, '少年提剑而立，眸光如雪。');
  const candidate = await createSourceCandidate(fixtureState, source, []);
  await approveCandidate(fixtureState, candidate);

  const staleCases = [
    { expectedNovelRevision: baseline.expectedNovelRevision + 1 },
    { expectedBibleVersion: baseline.expectedBibleVersion + 1 },
    { expectedPlanVersion: baseline.expectedPlanVersion + 1 },
    { expectedStyleVersion: baseline.expectedStyleVersion + 1 },
    { expectedDisclosurePolicyVersion: baseline.expectedDisclosurePolicyVersion + 1 },
    { expectedAclRevision: baseline.expectedAclRevision + 1 }
  ];
  for (const staleBaseline of staleCases) {
    await rejectsCode(store.commitChangeset({ ...scope, changesetId: candidate.id, ...staleBaseline }), 'BASELINE_STALE');
  }

  const commitResult = await store.commitChangeset({
    ...scope, changesetId: candidate.id, ...baseline
  });
  assert.equal(commitResult.ok, true);
  assert.equal(commitResult.novelRevision, baseline.expectedNovelRevision + 1);

  const updatedNovel = await repository.novels.get(bookId, bookId);
  assert.equal(updatedNovel.contentRevision, baseline.expectedNovelRevision + 1);
  assert.ok(updatedNovel.state.volumes[0].chapters[0].content.includes('眸光如雪'));
});

test('指定基线但没有对应领域来源时拒绝提交', async context => {
  const fixtureState = await fixture(context, { withBaselineSources: false });
  const candidate = await createCandidate(fixtureState, []);
  await approveCandidate(fixtureState, candidate);
  await rejectsCode(fixtureState.store.commitChangeset({
    ...fixtureState.scope, changesetId: candidate.id, expectedBibleVersion: 1
  }), 'BASELINE_AUTHORITY_UNAVAILABLE');
});

test('双人审批策略（two_person）：禁止自审自批，必须独立审核者批准，且 reviewer 不能代替执行 commit', async context => {
  const fixtureState = await fixture(context);
  const ownerAccess = await fixtureState.app.getAccess({
    userId: fixtureState.author.userId, projectId: fixtureState.bookId
  });
  await fixtureState.app.upsertWorkspaceMember(
    fixtureState.author.userId, ownerAccess.workspace_id, fixtureState.reviewer.userId, 'member'
  );
  await fixtureState.app.upsertProjectMember({
    userId: fixtureState.author.userId, projectId: fixtureState.bookId,
    targetUserId: fixtureState.reviewer.userId, role: 'reviewer', canSpend: true, canExport: true,
    expectedAclRevision: ownerAccess.acl_revision
  });

  const source = await saveReviewedManuscript(fixtureState, '独立双人审核正文稿。');
  const candidate = await createSourceCandidate(fixtureState, source, [], { approvalPolicy: 'two_person' });

  await rejectsCode(approveCandidate(fixtureState, candidate), 'SELF_APPROVAL_FORBIDDEN');

  const reviewerApprove = await approveCandidate(fixtureState, candidate, fixtureState.reviewer.userId);
  assert.equal(reviewerApprove.ok, true);

  await rejectsCode(fixtureState.store.commitChangeset({
    ...fixtureState.scope, userId: fixtureState.reviewer.userId,
    changesetId: candidate.id, actorRole: 'reviewer'
  }), 'FORBIDDEN');

  const authorCommit = await fixtureState.store.commitChangeset({
    ...fixtureState.scope, changesetId: candidate.id, actorRole: 'owner'
  });
  assert.equal(authorCommit.ok, true);
  assert.equal(authorCommit.novelRevision, 2);
});

test('手工稿无需调用外部模型：通过标准 changeset 与人工确认路径，零 Token 消耗并原子采纳', async context => {
  const fixtureState = await fixture(context);
  const manualText = '夜深人静，青石板路落满寒霜。他没有回头，只提着一盏残灯。';
  const source = await saveReviewedManuscript(fixtureState, manualText);
  const candidate = await createSourceCandidate(fixtureState, source, []);
  assert.equal((await approveCandidate(fixtureState, candidate)).ok, true);

  const commit = await fixtureState.store.commitChangeset({
    ...fixtureState.scope, changesetId: candidate.id
  });
  assert.equal(commit.ok, true);
  assert.equal(commit.operationsApplied, 0);

  const novel = await fixtureState.repository.novels.get(fixtureState.bookId, fixtureState.bookId);
  assert.equal(novel.contentRevision, 2);
  assert.ok(novel.state.volumes[0].chapters[0].content.includes('落满寒霜'));
});

test('部分确认（Partial Confirmation）与依赖完整性校验：缺少前置事件依赖拒绝提交', async context => {
  const fixtureState = await fixture(context);
  const source = await saveReviewedManuscript(fixtureState, '宗门大会召开，掌门赐予弟子玄阳玉佩。');
  const broken = await createSourceCandidate(fixtureState, source, [{
    type: 'STATE_TRANSITION',
    payload: {
      eventId: 'evt_unconfirmed_event_999', entityId: 'item_token_1', dimension: 'possession',
      preState: 'sect_vault', postState: 'disciple_hand'
    }
  }]);
  await approveCandidate(fixtureState, broken);
  await rejectsCode(fixtureState.store.commitChangeset({
    ...fixtureState.scope, changesetId: broken.id
  }), 'CHANGESET_DEPENDENCY_MISSING');

  const complete = await createSourceCandidate(fixtureState, source, [
    { type: 'INSERT_EVENT', payload: { id: 'evt_conf_1', title: '赐宝大会', summary: '掌门赐玉佩' } },
    { type: 'STATE_TRANSITION', payload: {
      eventId: 'evt_conf_1', entityId: 'item_token_1', dimension: 'possession',
      preState: 'sect_vault', postState: 'disciple_hand'
    } }
  ]);
  await approveCandidate(fixtureState, complete);
  assert.equal((await fixtureState.store.commitChangeset({
    ...fixtureState.scope, changesetId: complete.id
  })).ok, true);
});

test('嵌套认知递归展开与预算限制、故事时间过滤以及未记录认知语义', async context => {
  const fixtureState = await fixture(context);
  const { store, scope } = fixtureState;
  const extracted = await store.extract({ ...scope, text: '青云古剑在断崖下。' });
  const nestedCognition = {
    targetHolderId: 'shimei',
    resolvedCognition: {
      holderEntityId: 'shimei',
      attitude: 'believed',
      nested: {
        targetHolderId: 'third_person',
        resolvedCognition: {
          holderEntityId: 'third_person',
          attitude: 'suspected',
          nested: {
            targetHolderId: 'fourth_person',
            resolvedCognition: { holderEntityId: 'fourth_person', attitude: 'denied' }
          }
        }
      }
    }
  };
  await commitOperations(fixtureState, [{
    type: 'INSERT_COGNITION',
    payload: {
      id: 'cog_lixuan', holderEntityId: 'lixuan', targetExpressionId: extracted.propositions[0].id,
      awareness: 'aware', attitude: 'believed', subjectiveCertainty: 0.9, publicStance: 'concealed',
      acquisitionChannel: 'secret_letter', sourceEvidenceIds: [], nestedCognition,
      validIntervalStart: 't100', validIntervalEnd: 't500', acquiredTimeRef: 300
    }
  }]);

  const expanded = await store.getCognition({
    ...scope, holderEntityId: 'lixuan', expandNested: true, maxDepth: 2
  });
  assert.equal(expanded.length, 1);
  assert.equal(expanded[0].nestedCognition.targetHolderId, 'shimei');
  assert.equal(expanded[0].nestedCognition.resolvedCognition.nested.truncated, true);
  assert.equal(expanded[0].nestedCognition.resolvedCognition.nested.hasUnexpanded, true);

  const atTime200 = await store.getCognition({ ...scope, holderEntityId: 'lixuan', storyTime: 200 });
  assert.equal(atTime200.length, 0, '时间点200尚未获得该认知');
  const atTime400 = await store.getCognition({ ...scope, holderEntityId: 'lixuan', storyTime: 400 });
  assert.equal(atTime400.length, 1, '时间点400已获得该认知');

  const unrecorded = await store.getCognition({
    ...scope, holderEntityId: 'stranger', targetExpressionId: extracted.propositions[0].id
  });
  assert.equal(unrecorded.length, 1);
  assert.equal(unrecorded[0].status, 'unknown_not_recorded');
  assert.equal(unrecorded[0].bookId, scope.bookId);
  assert.equal(unrecorded[0].note, '没有认知记录不等于明确不知');
});

test('改写合同合规与文风润色任务防线：锁定数字、时序与禁止借润色改剧情', async context => {
  const fixtureState = await fixture(context);
  const contract = {
    bookId: fixtureState.bookId,
    taskType: 'style_polish',
    lockedPropositions: ['断魂谷'],
    lockedNumbers: ['三年', '七重天'],
    lockedEvents: ['宗门初试', '血战断魂谷'],
    lockedIdentities: ['陆沉'],
    lockedForeshadows: [{ title: '玉佩暗藏真龙残魂' }],
    disclosureBoundary: { forbiddenAnswers: ['真凶是三长老'] }
  };
  const rewrite = text => fixtureState.store.rewrite({
    ...fixtureState.scope, contract, candidateText: text
  });

  const breachLeaked = await rewrite('陆沉在宗门初试后去往血战断魂谷，苦修三年达七重天。其实真凶是三长老。玉佩暗藏真龙残魂');
  assert.equal(breachLeaked.compliant, false);
  assert.ok(breachLeaked.violations.some(v => v.type === 'DISCLOSURE_BOUNDARY_BREACH'));

  const breachNumber = await rewrite('陆沉在宗门初试后去往血战断魂谷，苦修五年达七重天。玉佩暗藏真龙残魂');
  assert.equal(breachNumber.compliant, false);
  assert.ok(breachNumber.violations.some(v => v.type === 'LOCKED_NUMBER_LOST'));

  const breachOrder = await rewrite('陆沉在血战断魂谷经历九死一生，随后回山参加宗门初试，苦修三年达七重天。玉佩暗藏真龙残魂');
  assert.equal(breachOrder.compliant, false);
  assert.ok(breachOrder.violations.some(v => v.type === 'EVENT_ORDER_VIOLATION'));

  const breachPolish = await rewrite('陆沉在宗门初试后去往血战断魂谷，苦修三年达七重天。剑气纵横三万里。');
  assert.equal(breachPolish.compliant, false);
  assert.ok(breachPolish.violations.some(v => v.type === 'POLISH_UNAUTHORIZED_PLOT_MODIFICATION'));

  const compliant = await rewrite('陆沉在宗门初试拔得头筹，其后赴血战断魂谷，苦修三年达七重天之境，掌中玉佩暗藏真龙残魂微鸣。');
  assert.equal(compliant.compliant, true);
  assert.equal(compliant.violations.length, 0);
});

test('上下文检索装配：必须项超预算抛出 CONTEXT_BUDGET_EXCEEDED，且隐藏信息不泄漏至正文写作包', async context => {
  const fixtureState = await fixture(context);
  const { store, scope } = fixtureState;
  const extracted = await store.extract({ ...scope, text: '魔门圣女真实身份是宗主之女。' });
  const propositionId = extracted.propositions[0].id;
  await commitOperations(fixtureState, [{
    type: 'INSERT_FACT',
    payload: { id: 'fact_secret', propositionId, verdict: 'true' }
  }]);
  await commitOperations(fixtureState, [{
    type: 'SET_DISCLOSURE',
    payload: { id: 'dp_hide', targetInfoId: 'fact_secret', policyType: 'hide' }
  }]);

  await rejectsCode(store.assembleContext({
    ...scope,
    budgetTokens: 50,
    mandatoryItems: ['一段极其冗长必须要放入上下文不可省略的背景设定描述文本'.repeat(20)]
  }), 'CONTEXT_BUDGET_EXCEEDED');

  const manifest = await store.assembleContext({ ...scope, budgetTokens: 3000 });
  assert.equal(manifest.writingPackage.facts.some(fact => fact.id === 'fact_secret'), false, '写作包排除了隐藏事实');
  assert.equal(manifest.auditPackage.facts.some(fact => fact.id === 'fact_secret'), true, '审校包保留隐藏事实以供质检');
});

test('权限与能力防线：reviewer 获赋予能力仍不能支出与导出，且 49 类资料题材不适用必须附带非空理由', async context => {
  const fixtureState = await fixture(context);
  const accessReviewerWithErrantFlags = {
    workspace_id: 'ws_1', project_id: fixtureState.bookId, role: 'reviewer', active: 1,
    can_spend: 1, can_export: 1
  };
  assert.equal(projectScope.canAccess(accessReviewerWithErrantFlags, projectScope.PROJECT_ROLES, 'spend'), false);
  assert.equal(projectScope.canAccess(accessReviewerWithErrantFlags, projectScope.PROJECT_ROLES, 'export'), false);

  const scope = projectScope.scopePublic(accessReviewerWithErrantFlags);
  assert.equal(scope.canSpend, false);
  assert.equal(scope.canExport, false);

  const { app, author, bookId } = fixtureState;
  await assert.rejects(app.saveResource({
    userId: author.userId, projectId: bookId, id: 'ps_none', kind: 'power-system',
    payload: { notApplicable: true, notApplicableReason: '   ' }, expectedRevision: 0
  }), { code: 'NOT_APPLICABLE_REASON_REQUIRED' });

  const okNotApplicable = await app.saveResource({
    userId: author.userId, projectId: bookId, id: 'ps_none', kind: 'power-system',
    payload: { notApplicable: true, notApplicableReason: '历史写实权谋题材，本书不存在任何超自然超凡力量体系' },
    expectedRevision: 0
  });
  assert.equal(okNotApplicable.ok, true);
  assert.equal(okNotApplicable.resource.payload.notApplicableReason, '历史写实权谋题材，本书不存在任何超自然超凡力量体系');

  await assert.rejects(app.saveResource({
    userId: author.userId, projectId: bookId, id: 'item_bronze', kind: 'item',
    payload: { name: '青铜鼎', targetProjectId: 'proj_other_999' }, expectedRevision: 0
  }), { code: 'REFERENCE_CROSS_PROJECT_FORBIDDEN' });
});
