'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const memorySystem = require('../lib/memory-system');
const workflow = require('../lib/memory-workflow');
const commitGuard = require('../lib/memory-commit-guard');
const projectScope = require('../lib/project-scope');
const projectResources = require('../lib/project-resources');
const styleSystem = require('../lib/style-system');
const memoryRoutes = require('../lib/memory-routes');

function createTestDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      email TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  const now = Date.now();
  db.prepare(`INSERT INTO accounts VALUES ('author@test.com', 'usr_author', 'Author')`).run();
  db.prepare(`INSERT INTO accounts VALUES ('reviewer@test.com', 'usr_reviewer', 'Reviewer')`).run();
  db.prepare(`INSERT INTO workspaces VALUES ('ws_1', 'usr_author', 'Default WS', ?, ?)`).run(now, now);

  memorySystem.initializeSchema(db);
  workflow.initializeSchema(db);
  commitGuard.initializeSchema(db);
  projectScope.initializeSchema(db);
  projectResources.initializeSchema(db);
  styleSystem.initializeSchema(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS novels (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      state_json TEXT NOT NULL,
      word_count INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS creation_books (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      bible_id TEXT NOT NULL,
      plan_json TEXT NOT NULL DEFAULT '{}',
      current_state_version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS creation_bibles (
      id TEXT PRIMARY KEY,
      current_version INTEGER NOT NULL DEFAULT 1
    );
  `);

  return db;
}

test('六维基线正式提交合同：正文、圣经、计划、文风、披露、ACL版本失配均拒绝，一致时原子提交', () => {
  const db = createTestDatabase();
  const bookId = 'n_book_contract_1';
  const now = Date.now();

  // 1. 初始化小说与多维版本基线
  const state = {
    title: '剑试九霄',
    volumes: [{
      id: 'v1',
      title: '第一卷',
      chapters: [{
        id: 'c1',
        title: '第一章 剑出青云',
        content: '<p>少年提剑而立。</p>'
      }]
    }]
  };
  db.prepare(`INSERT INTO novels VALUES (?, 'ws_1', ?, 'usr_author', '剑试九霄', ?, 10, 1, ?, ?)`).run(bookId, bookId, JSON.stringify(state), now, now);
  db.prepare(`INSERT INTO novel_projects (workspace_id, project_id, owner_user_id, title, status, acl_revision, created_at, updated_at) VALUES ('ws_1', ?, 'usr_author', '剑试九霄', 'active', 3, ?, ?)`).run(bookId, now, now);
  db.prepare(`INSERT INTO creation_books VALUES ('cb_1', ?, ?, 'bible_1', '{}', 2)`).run(bookId, bookId);
  db.prepare(`INSERT INTO creation_bibles VALUES ('bible_1', 4)`).run();
  db.prepare(`INSERT INTO disclosure_policies (id, book_id, branch_id, target_info_id, policy_type, created_at) VALUES ('dp_1', ?, 'main', 'secret_1', 'hide', ?)`).run(bookId, now);
  db.prepare(`INSERT INTO style_profiles (id, book_id, branch_id, name, level, revision, active, created_at, updated_at) VALUES ('sp_1', ?, 'main', '玄幻沉稳', 'novel_narrative', 5, 1, ?, ?)`).run(bookId, now, now);

  // 2. 保存候选正文并创建绑定的变更集
  const saved = workflow.saveManuscript(db, bookId, 'usr_author', {
    chapterId: 'c1',
    text: '少年提剑而立，眸光如雪。',
    expectedRevision: 0,
    expectedNovelRevision: 1
  });

  const changeset = workflow.createBoundChangeset(db, bookId, 'usr_author', {
    manuscriptRevisionId: saved.id,
    operations: []
  });

  memorySystem.approveChangeset(db, bookId, changeset.id, 'usr_author');

  // 3. 测试基线版本校验失配：正文版本不匹配
  const badNovelRev = memorySystem.commitChangeset(db, bookId, changeset.id, 'usr_author', {
    expectedNovelRevision: 99
  });
  assert.equal(badNovelRev.ok, false);
  assert.equal(badNovelRev.code, 'BASELINE_STALE');

  // 4. 测试圣经版本失配
  const badBibleVer = memorySystem.commitChangeset(db, bookId, changeset.id, 'usr_author', {
    expectedBibleVersion: 99
  });
  assert.equal(badBibleVer.ok, false);
  assert.equal(badBibleVer.code, 'BASELINE_STALE');

  // 5. 测试计划版本失配
  const badPlanVer = memorySystem.commitChangeset(db, bookId, changeset.id, 'usr_author', {
    expectedPlanVersion: 99
  });
  assert.equal(badPlanVer.ok, false);
  assert.equal(badPlanVer.code, 'BASELINE_STALE');

  // 6. 测试文风版本失配
  const badStyleVer = memorySystem.commitChangeset(db, bookId, changeset.id, 'usr_author', {
    expectedStyleVersion: 99
  });
  assert.equal(badStyleVer.ok, false);
  assert.equal(badStyleVer.code, 'BASELINE_STALE');

  // 7. 测试披露策略版本失配
  const badPolicyVer = memorySystem.commitChangeset(db, bookId, changeset.id, 'usr_author', {
    expectedDisclosurePolicyVersion: 99
  });
  assert.equal(badPolicyVer.ok, false);
  assert.equal(badPolicyVer.code, 'BASELINE_STALE');

  // 8. 测试 ACL 版本失配
  const badAclRev = memorySystem.commitChangeset(db, bookId, changeset.id, 'usr_author', {
    expectedAclRevision: 99
  });
  assert.equal(badAclRev.ok, false);
  assert.equal(badAclRev.code, 'BASELINE_STALE');

  // 9. 正确版本基线提交：全部吻合时原子采纳
  const commitResult = memorySystem.commitChangeset(db, bookId, changeset.id, 'usr_author', {
    expectedNovelRevision: 1,
    expectedBibleVersion: 4,
    expectedPlanVersion: 2,
    expectedStyleVersion: 5,
    expectedDisclosurePolicyVersion: 1,
    expectedAclRevision: 3
  });
  assert.equal(commitResult.ok, true);
  assert.equal(commitResult.novelRevision, 2);

  const updatedNovel = db.prepare('SELECT revision, state_json FROM novels WHERE id = ?').get(bookId);
  assert.equal(updatedNovel.revision, 2);
  assert.ok(updatedNovel.state_json.includes('眸光如雪'));
});

test('双人审批策略（two_person）：禁止自审自批，必须独立审核者批准，且 reviewer 不能代替执行 commit', () => {
  const db = createTestDatabase();
  const bookId = 'n_two_person_1';
  const now = Date.now();

  const state = {
    title: '天问录',
    volumes: [{ id: 'v1', title: '卷一', chapters: [{ id: 'c1', title: '第一章', content: '<p>初始正文</p>' }] }]
  };
  db.prepare(`INSERT INTO novels VALUES (?, 'ws_1', ?, 'usr_author', '天问录', ?, 10, 1, ?, ?)`).run(bookId, bookId, JSON.stringify(state), now, now);

  const saved = workflow.saveManuscript(db, bookId, 'usr_author', {
    chapterId: 'c1',
    text: '独立双人审核正文稿。',
    expectedRevision: 0,
    expectedNovelRevision: 1
  });

  const changeset = workflow.createBoundChangeset(db, bookId, 'usr_author', {
    manuscriptRevisionId: saved.id,
    approvalPolicy: 'two_person'
  });

  // 1. 发起者本人尝试审批 -> 被拒绝 SELF_APPROVAL_FORBIDDEN
  const selfApprove = memorySystem.approveChangeset(db, bookId, changeset.id, 'usr_author');
  assert.equal(selfApprove.ok, false);
  assert.equal(selfApprove.code, 'SELF_APPROVAL_FORBIDDEN');

  // 2. 独立审核员批准
  const reviewerApprove = memorySystem.approveChangeset(db, bookId, changeset.id, 'usr_reviewer');
  assert.equal(reviewerApprove.ok, true);

  // 3. reviewer 尝试执行正式提交 -> 被角色守卫拦截（403/FORBIDDEN）
  const reviewerCommit = memorySystem.commitChangeset(db, bookId, changeset.id, 'usr_reviewer', {
    actorRole: 'reviewer'
  });
  assert.equal(reviewerCommit.ok, false);
  assert.equal(reviewerCommit.code, 'FORBIDDEN');

  // 4. 具备编辑/作者权限者执行 commit -> 成功原子采纳
  const authorCommit = memorySystem.commitChangeset(db, bookId, changeset.id, 'usr_author', {
    actorRole: 'owner'
  });
  assert.equal(authorCommit.ok, true);
  assert.equal(authorCommit.novelRevision, 2);
});

test('手工稿无需调用外部模型：通过标准 changeset 与人工确认路径，零 Token 消耗并原子采纳', () => {
  const db = createTestDatabase();
  const bookId = 'n_manual_1';
  const now = Date.now();

  const state = {
    title: '手工长卷',
    volumes: [{ id: 'v1', title: '卷一', chapters: [{ id: 'c1', title: '第一章', content: '<p>旧草稿</p>' }] }]
  };
  db.prepare(`INSERT INTO novels VALUES (?, 'ws_1', ?, 'usr_author', '手工长卷', ?, 10, 1, ?, ?)`).run(bookId, bookId, JSON.stringify(state), now, now);

  // 作者纯手工录入新章节内容
  const manualText = '夜深人静，青石板路落满寒霜。他没有回头，只提着一盏残灯。';
  const saved = workflow.saveManuscript(db, bookId, 'usr_author', {
    chapterId: 'c1',
    text: manualText,
    expectedRevision: 0,
    expectedNovelRevision: 1
  });
  assert.ok(saved.id);

  // 建立绑定变更集，不含任何外部模型依赖
  const changeset = workflow.createBoundChangeset(db, bookId, 'usr_author', {
    manuscriptRevisionId: saved.id,
    operations: []
  });

  const approveRes = memorySystem.approveChangeset(db, bookId, changeset.id, 'usr_author');
  assert.equal(approveRes.ok, true);

  const commitRes = memorySystem.commitChangeset(db, bookId, changeset.id, 'usr_author');
  assert.equal(commitRes.ok, true);
  assert.equal(commitRes.operationsApplied, 0); // 纯文本变更，零外部模型费用与推理

  const novel = db.prepare('SELECT state_json, revision FROM novels WHERE id = ?').get(bookId);
  assert.equal(novel.revision, 2);
  assert.ok(novel.state_json.includes('落满寒霜'));
});

test('部分确认（Partial Confirmation）与依赖完整性校验：缺少前置事件依赖拒绝提交', () => {
  const db = createTestDatabase();
  const bookId = 'n_partial_1';
  const now = Date.now();

  const state = {
    title: '断链测验',
    volumes: [{ id: 'v1', title: '卷一', chapters: [{ id: 'c1', title: '第一章', content: '<p>旧稿</p>' }] }]
  };
  db.prepare(`INSERT INTO novels VALUES (?, 'ws_1', ?, 'usr_author', '断链测验', ?, 10, 1, ?, ?)`).run(bookId, bookId, JSON.stringify(state), now, now);

  const saved = workflow.saveManuscript(db, bookId, 'usr_author', {
    chapterId: 'c1',
    text: '宗门大会召开，掌门赐予弟子玄阳玉佩。',
    expectedRevision: 0,
    expectedNovelRevision: 1
  });

  // 候选提取出了事件和依赖该事件的状态转换：
  // 如果作者只部分确认状态转换，却勾选放弃/去除了该事件
  const brokenChangeset = workflow.createBoundChangeset(db, bookId, 'usr_author', {
    manuscriptRevisionId: saved.id,
    operations: [
      {
        type: 'STATE_TRANSITION',
        payload: {
          eventId: 'evt_unconfirmed_event_999', // 未被确认入库也未包含在当前变更集中
          entityId: 'item_token_1',
          dimension: 'possession',
          preState: 'sect_vault',
          postState: 'disciple_hand'
        }
      }
    ]
  });

  memorySystem.approveChangeset(db, bookId, brokenChangeset.id, 'usr_author');

  const commitRes = memorySystem.commitChangeset(db, bookId, brokenChangeset.id, 'usr_author');
  assert.equal(commitRes.ok, false);
  assert.equal(commitRes.code, 'CHANGESET_DEPENDENCY_MISSING');

  // 若同时保留事件与状态转换，依赖完整，则提交成功
  const completeChangeset = workflow.createBoundChangeset(db, bookId, 'usr_author', {
    manuscriptRevisionId: saved.id,
    operations: [
      {
        type: 'INSERT_EVENT',
        payload: {
          id: 'evt_conf_1',
          title: '赐宝大会',
          summary: '掌门赐玉佩'
        }
      },
      {
        type: 'STATE_TRANSITION',
        payload: {
          eventId: 'evt_conf_1',
          entityId: 'item_token_1',
          dimension: 'possession',
          preState: 'sect_vault',
          postState: 'disciple_hand'
        }
      }
    ]
  });

  memorySystem.approveChangeset(db, bookId, completeChangeset.id, 'usr_author');
  const validCommit = memorySystem.commitChangeset(db, bookId, completeChangeset.id, 'usr_author');
  assert.equal(validCommit.ok, true);
});

test('嵌套认知递归展开与预算限制、故事时间过滤以及未记录认知语义', () => {
  const db = createTestDatabase();
  const bookId = 'n_cognition_test';

  db.prepare("INSERT INTO memory_propositions (id, book_id, display_text, created_at) VALUES ('prop_sword', ?, '青云古剑在断崖下', 100)").run(bookId);

  // 递归嵌套结构：李玄 以为 师妹 以为 古剑在断崖下
  const shimeiNested = {
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

  db.prepare(`INSERT INTO character_cognition (
    id, book_id, branch_id, holder_entity_id, target_expression_id, awareness, attitude,
    subjective_certainty, public_stance, acquisition_channel, source_evidence_ids_json,
    nested_cognition_json, valid_interval_start, valid_interval_end, acquired_time_ref,
    review_status, revision, created_at
  ) VALUES ('cog_lixuan', ?, 'main', 'lixuan', 'prop_sword', 'aware', 'believed', 0.9, 'concealed', 'secret_letter', '[]', ?, 't100', 't500', 300, 'confirmed', 1, 1000)`).run(bookId, JSON.stringify(shimeiNested));

  // 1. 递归展开带深度限制（maxDepth=2）
  const expanded = memorySystem.getCognition(db, bookId, {
    holderEntityId: 'lixuan',
    expandNested: true,
    maxDepth: 2
  });
  assert.equal(expanded.length, 1);
  assert.equal(expanded[0].nestedCognition.targetHolderId, 'shimei');
  // 第三层被预算截断并标记
  assert.equal(expanded[0].nestedCognition.resolvedCognition.nested.truncated, true);
  assert.equal(expanded[0].nestedCognition.resolvedCognition.nested.hasUnexpanded, true);

  // 2. 故事时间过滤：在时间点 200 时，李玄尚未获得该认知（acquired_time_ref = 300）
  const atTime200 = memorySystem.getCognition(db, bookId, {
    holderEntityId: 'lixuan',
    storyTime: 200
  });
  assert.equal(atTime200.length, 0, '时间点200尚未获得该认知');

  const atTime400 = memorySystem.getCognition(db, bookId, {
    holderEntityId: 'lixuan',
    storyTime: 400
  });
  assert.equal(atTime400.length, 1, '时间点400已获得该认知');

  // 3. 无认知记录语义：“没有认知记录不等于明确不知”
  const unrecorded = memorySystem.getCognition(db, bookId, {
    holderEntityId: 'stranger',
    targetExpressionId: 'prop_sword'
  });
  assert.equal(unrecorded.length, 1);
  assert.equal(unrecorded[0].status, 'unknown_not_recorded');
  assert.equal(unrecorded[0].note, '没有认知记录不等于明确不知');
});

test('改写合同合规与文风润色任务防线：锁定数字、时序与禁止借润色改剧情', () => {
  const contract = {
    bookId: 'b1',
    taskType: 'style_polish',
    lockedPropositions: ['断魂谷'],
    lockedNumbers: ['三年', '七重天'],
    lockedEvents: ['宗门初试', '血战断魂谷'],
    lockedIdentities: ['陆沉'],
    lockedForeshadows: [{ title: '玉佩暗藏真龙残魂' }],
    disclosureBoundary: { forbiddenAnswers: ['真凶是三长老'] }
  };

  // 1. 违规泄露禁止答案
  const breachLeaked = memorySystem.verifyRewriteContractCompliance(contract, '陆沉在宗门初试后去往血战断魂谷，苦修三年达七重天。其实真凶是三长老。玉佩暗藏真龙残魂');
  assert.equal(breachLeaked.passed, false);
  assert.ok(breachLeaked.violations.some(v => v.type === 'DISCLOSURE_BOUNDARY_BREACH'));

  // 2. 擅自篡改关键数字（将三年改成了五年）
  const breachNumber = memorySystem.verifyRewriteContractCompliance(contract, '陆沉在宗门初试后去往血战断魂谷，苦修五年达七重天。玉佩暗藏真龙残魂');
  assert.equal(breachNumber.passed, false);
  assert.ok(breachNumber.violations.some(v => v.type === 'LOCKED_NUMBER_LOST'));

  // 3. 事件时序逆转（先血战后初试）
  const breachOrder = memorySystem.verifyRewriteContractCompliance(contract, '陆沉在血战断魂谷经历九死一生，随后回山参加宗门初试，苦修三年达七重天。玉佩暗藏真龙残魂');
  assert.equal(breachOrder.passed, false);
  assert.ok(breachOrder.violations.some(v => v.type === 'EVENT_ORDER_VIOLATION'));

  // 4. 文风润色暗改伏笔（删除了玉佩伏笔）
  const breachPolish = memorySystem.verifyRewriteContractCompliance(contract, '陆沉在宗门初试后去往血战断魂谷，苦修三年达七重天。剑气纵横三万里。');
  assert.equal(breachPolish.passed, false);
  assert.ok(breachPolish.violations.some(v => v.type === 'POLISH_UNAUTHORIZED_PLOT_MODIFICATION'));

  // 5. 合规润色稿通过
  const compliant = memorySystem.verifyRewriteContractCompliance(contract, '陆沉在宗门初试拔得头筹，其后赴血战断魂谷，苦修三年达七重天之境，掌中玉佩暗藏真龙残魂微鸣。');
  assert.equal(compliant.passed, true);
  assert.equal(compliant.violations.length, 0);
});

test('上下文检索装配：必须项超预算抛出 CONTEXT_BUDGET_EXCEEDED，且隐藏信息不泄漏至正文写作包', () => {
  const db = createTestDatabase();
  const bookId = 'n_budget_ctx_1';

  db.prepare("INSERT INTO memory_propositions (id, book_id, display_text, created_at) VALUES ('p_secret', ?, '魔门圣女真实身份是宗主之女', 100)").run(bookId);
  db.prepare("INSERT INTO world_fact_decisions (id, book_id, proposition_id, verdict, status, created_at) VALUES ('fact_secret', ?, 'p_secret', 'true', 'confirmed', 200)").run(bookId);
  db.prepare("INSERT INTO disclosure_policies (id, book_id, branch_id, target_info_id, policy_type, created_at) VALUES ('dp_hide', ?, 'main', 'fact_secret', 'hide', 300)").run(bookId);

  // 1. 预算超限检查：必须项超过 budgetTokens
  assert.throws(() => {
    memorySystem.assembleContext(db, bookId, {
      budgetTokens: 50,
      mandatoryItems: ['一段极其冗长必须要放入上下文不可省略的背景设定描述文本'.repeat(20)]
    });
  }, err => err.code === 'CONTEXT_BUDGET_EXCEEDED');

  // 2. 正常预算下的信息隔离：写作包不泄露隐藏答案，审校包保留真相
  const manifest = memorySystem.assembleContext(db, bookId, {
    budgetTokens: 3000
  });
  assert.equal(manifest.writingPackage.facts.some(f => f.id === 'fact_secret'), false, '写作包排除了隐藏事实');
  assert.equal(manifest.auditPackage.facts.some(f => f.id === 'fact_secret'), true, '审校包保留隐藏事实以供质检');
});

test('权限与能力防线：reviewer 获赋予能力仍不能支出与导出，且 49 类资料题材不适用必须附带非空理由', () => {
  const db = createTestDatabase();
  const now = Date.now();
  db.prepare(`INSERT INTO novel_projects (workspace_id, project_id, owner_user_id, title, status, acl_revision, created_at, updated_at) VALUES ('ws_1', 'proj_1', 'usr_author', '测试作品', 'active', 1, ?, ?)`).run(now, now);
  const accessReviewerWithErrantFlags = {
    workspace_id: 'ws_1',
    project_id: 'proj_1',
    role: 'reviewer',
    active: 1,
    can_spend: 1,
    can_export: 1
  };

  // 1. reviewer 无法获得支出或导出能力
  assert.equal(projectScope.canAccess(accessReviewerWithErrantFlags, projectScope.PROJECT_ROLES, 'spend'), false);
  assert.equal(projectScope.canAccess(accessReviewerWithErrantFlags, projectScope.PROJECT_ROLES, 'export'), false);

  const scope = projectScope.scopePublic(accessReviewerWithErrantFlags);
  assert.equal(scope.canSpend, false);
  assert.equal(scope.canExport, false);

  // 2. 题材不适用必须有明确理由
  const accessOwner = { workspace_id: 'ws_1', project_id: 'proj_1', role: 'owner', active: 1 };
  
  // 理由为空 -> 被拒绝
  const failNotApplicable = projectResources.createResource(db, accessOwner, 'power-system', {
    notApplicable: true,
    notApplicableReason: '   ' // 空白字符串
  }, 'user_1', 'ps_none');
  assert.equal(failNotApplicable.ok, false);
  assert.equal(failNotApplicable.code, 'NOT_APPLICABLE_REASON_REQUIRED');

  // 提供明确理由 -> 成功写入
  const okNotApplicable = projectResources.createResource(db, accessOwner, 'power-system', {
    notApplicable: true,
    notApplicableReason: '历史写实权谋题材，本书不存在任何超自然超凡力量体系'
  }, 'user_1', 'ps_none');
  assert.equal(okNotApplicable.ok, true);
  assert.equal(okNotApplicable.resource.payload.notApplicableReason, '历史写实权谋题材，本书不存在任何超自然超凡力量体系');

  // 3. 跨项目引用被拒绝
  const failCrossProject = projectResources.createResource(db, accessOwner, 'item', {
    name: '青铜鼎',
    targetProjectId: 'proj_other_999'
  }, 'user_1', 'item_bronze');
  assert.equal(failCrossProject.ok, false);
  assert.equal(failCrossProject.code, 'REFERENCE_CROSS_PROJECT_FORBIDDEN');
});
