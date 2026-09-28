'use strict';

/**
 * 墨阑长篇记忆与文风稳定系统 · 记忆核心领域服务
 * 
 * 职责：
 * 1. 数据作用域与原文锚点（book_id, branch_id, timeline_id, cycle_id, state_version 等）
 * 2. 命题 (Propositions) 与证据 (Evidence) 模态化建模（陈述、声称、猜测、计划、梦境等）
 * 3. 世界事实裁决 (World Fact Decisions) 独立落点与有效区间管理
 * 4. 人物认知 (Character Cognition) 私下认知与对外表现分离、嵌套认知展开
 * 5. 事件 (Story Events)、参与者与状态转换 (State Transitions: 前状态 → 事件 → 后状态)
 * 6. 计划、条件承诺与伏笔生命周期追踪
 * 7. 四维时间系统（事件时间、披露位置、知情时间、记录版本时间）及因果/先后时序校验
 * 8. 上下文检索装配（写作包 vs 审校包）与披露策略 (Disclosure Policies)、清单留痕 (Manifests)
 * 9. 记忆变更集 (Changesets)、自动化授权策略与补偿性撤销 (Revert)
 * 10. 依赖图与修改传播影响分析 (Impact Analysis)
 * 11. SQLite 原子提交事务、Outbox 任务生成与兼容因果债务投影校验器
 */

const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const commitGuard = require('./memory-commit-guard');
const workflow = require('./memory-workflow');
const domain = require('./memory-domain');

/**
 * 计算规范化文本的 SHA-256 哈希（严格按 UTF-8 字节计算）。
 */
function computeTextHash(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

/**
 * 初始化长篇记忆系统所需的所有 SQLite 表结构。
 */
function initializeSchema(db) {
  commitGuard.initializeSchema(db);
  workflow.initializeSchema(db);
  // 1. 命题表：表达描述讨论的具体内容
  db.exec(`CREATE TABLE IF NOT EXISTS memory_propositions (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    branch_id TEXT NOT NULL DEFAULT 'main',
    expression_type TEXT NOT NULL DEFAULT 'atomic',
    subject_entity_id TEXT NOT NULL DEFAULT '',
    predicate TEXT NOT NULL DEFAULT '',
    object_value TEXT NOT NULL DEFAULT '',
    expression_json TEXT NOT NULL DEFAULT '{}',
    display_text TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_mem_props_book ON memory_propositions(book_id, branch_id, subject_entity_id)');

  // 2. 证据表：表达信息如何出现、模态及立场
  db.exec(`CREATE TABLE IF NOT EXISTS memory_evidence (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    branch_id TEXT NOT NULL DEFAULT 'main',
    proposition_id TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'narration',
    source_entity_id TEXT NOT NULL DEFAULT '',
    modality TEXT NOT NULL DEFAULT 'statement',
    stance TEXT NOT NULL DEFAULT 'supports',
    source_anchor_json TEXT NOT NULL DEFAULT '{}',
    story_time_ref TEXT NOT NULL DEFAULT '',
    disclosure_position TEXT NOT NULL DEFAULT '',
    extraction_confidence REAL NOT NULL DEFAULT 1.0,
    review_status TEXT NOT NULL DEFAULT 'pending',
    revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (proposition_id) REFERENCES memory_propositions(id)
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_mem_evid_prop ON memory_evidence(book_id, proposition_id)');

  // 3. 世界事实裁决：正式真相唯一落点
  db.exec(`CREATE TABLE IF NOT EXISTS world_fact_decisions (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    branch_id TEXT NOT NULL DEFAULT 'main',
    proposition_id TEXT NOT NULL,
    verdict TEXT NOT NULL DEFAULT 'undetermined',
    timeline_id TEXT NOT NULL DEFAULT 't0',
    cycle_id TEXT NOT NULL DEFAULT 'c0',
    valid_interval_start TEXT NOT NULL DEFAULT '',
    valid_interval_end TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    supporting_evidence_ids_json TEXT NOT NULL DEFAULT '[]',
    opposing_evidence_ids_json TEXT NOT NULL DEFAULT '[]',
    approval_id TEXT NOT NULL DEFAULT '',
    decision_reason TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 1,
    supersedes_id TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (proposition_id) REFERENCES memory_propositions(id)
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_world_facts_prop ON world_fact_decisions(book_id, proposition_id, status)');

  // 4. 人物认知：私下认知与对外表现分离，支持嵌套认知展开
  db.exec(`CREATE TABLE IF NOT EXISTS character_cognition (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    branch_id TEXT NOT NULL DEFAULT 'main',
    holder_entity_id TEXT NOT NULL,
    target_expression_id TEXT NOT NULL,
    awareness TEXT NOT NULL DEFAULT 'direct_experience',
    attitude TEXT NOT NULL DEFAULT 'knows',
    subjective_certainty TEXT NOT NULL DEFAULT 'certain',
    public_stance TEXT NOT NULL DEFAULT 'admit',
    acquisition_channel TEXT NOT NULL DEFAULT 'experience',
    source_event_id TEXT NOT NULL DEFAULT '',
    source_evidence_ids_json TEXT NOT NULL DEFAULT '[]',
    acquired_time_ref TEXT NOT NULL DEFAULT '',
    valid_interval_start TEXT NOT NULL DEFAULT '',
    valid_interval_end TEXT NOT NULL DEFAULT '',
    review_status TEXT NOT NULL DEFAULT 'confirmed',
    nested_cognition_json TEXT NOT NULL DEFAULT '{}',
    revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_char_cog_holder ON character_cognition(book_id, holder_entity_id, target_expression_id)');

  // 5. 事件、参与者与状态转换
  db.exec(`CREATE TABLE IF NOT EXISTS story_events (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    branch_id TEXT NOT NULL DEFAULT 'main',
    timeline_id TEXT NOT NULL DEFAULT 't0',
    cycle_id TEXT NOT NULL DEFAULT 'c0',
    event_type TEXT NOT NULL DEFAULT 'action',
    title TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    story_time TEXT NOT NULL DEFAULT '',
    narrative_position TEXT NOT NULL DEFAULT '',
    scene_id TEXT NOT NULL DEFAULT '',
    pov_entity_id TEXT NOT NULL DEFAULT '',
    source_evidence_ids_json TEXT NOT NULL DEFAULT '[]',
    preconditions_json TEXT NOT NULL DEFAULT '[]',
    revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_story_events_book ON story_events(book_id, timeline_id)');

  db.exec(`CREATE TABLE IF NOT EXISTS event_participants (
    event_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'participant',
    status TEXT NOT NULL DEFAULT 'active',
    PRIMARY KEY (event_id, entity_id),
    FOREIGN KEY (event_id) REFERENCES story_events(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS state_transitions (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    branch_id TEXT NOT NULL DEFAULT 'main',
    event_id TEXT NOT NULL DEFAULT '',
    entity_id TEXT NOT NULL,
    dimension TEXT NOT NULL DEFAULT 'possession',
    pre_state TEXT NOT NULL DEFAULT '',
    post_state TEXT NOT NULL DEFAULT '',
    valid_interval_start TEXT NOT NULL DEFAULT '',
    valid_interval_end TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_state_trans ON state_transitions(book_id, entity_id, dimension)');

  // 6. 计划、承诺与伏笔
  db.exec(`CREATE TABLE IF NOT EXISTS story_plans (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    branch_id TEXT NOT NULL DEFAULT 'main',
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    target_chapter_range TEXT NOT NULL DEFAULT '',
    preconditions_json TEXT NOT NULL DEFAULT '[]',
    participant_ids_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'planned',
    realization_event_id TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS conditional_commitments (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    branch_id TEXT NOT NULL DEFAULT 'main',
    promisor_id TEXT NOT NULL,
    promisee_id TEXT NOT NULL,
    trigger_condition TEXT NOT NULL,
    fulfillment_content TEXT NOT NULL,
    condition_evidence_ids_json TEXT NOT NULL DEFAULT '[]',
    fulfillment_evidence_ids_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active',
    revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS story_foreshadows (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    branch_id TEXT NOT NULL DEFAULT 'main',
    title TEXT NOT NULL,
    anchor_json TEXT NOT NULL DEFAULT '{}',
    target_secret TEXT NOT NULL DEFAULT '',
    disclosed_clues_json TEXT NOT NULL DEFAULT '[]',
    reinforcement_events_json TEXT NOT NULL DEFAULT '[]',
    planned_payoff_range TEXT NOT NULL DEFAULT '',
    required_conditions_json TEXT NOT NULL DEFAULT '[]',
    payoff_evidence_ids_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'planted',
    revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  )`);

  // 7. 时间关系表（先后、同时、包含等）
  db.exec(`CREATE TABLE IF NOT EXISTS temporal_relations (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    branch_id TEXT NOT NULL DEFAULT 'main',
    timeline_id TEXT NOT NULL DEFAULT 't0',
    cycle_id TEXT NOT NULL DEFAULT 'c0',
    source_event_id TEXT NOT NULL,
    target_event_id TEXT NOT NULL,
    relation_type TEXT NOT NULL DEFAULT 'before',
    interval_value TEXT NOT NULL DEFAULT '',
    source_evidence_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'confirmed',
    created_at INTEGER NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_temp_rel ON temporal_relations(book_id, timeline_id, source_event_id)');

  // 8. 披露策略与上下文清单
  db.exec(`CREATE TABLE IF NOT EXISTS disclosure_policies (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    branch_id TEXT NOT NULL DEFAULT 'main',
    target_info_id TEXT NOT NULL,
    target_info_type TEXT NOT NULL DEFAULT 'fact',
    scope_chapter_range TEXT NOT NULL DEFAULT '',
    scope_scene_id TEXT NOT NULL DEFAULT '',
    scope_pov_id TEXT NOT NULL DEFAULT '',
    policy_type TEXT NOT NULL DEFAULT 'allow',
    allowed_clues_json TEXT NOT NULL DEFAULT '[]',
    forbidden_answers_json TEXT NOT NULL DEFAULT '[]',
    approved_by TEXT NOT NULL DEFAULT 'author',
    revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS context_manifests (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    branch_id TEXT NOT NULL DEFAULT 'main',
    state_version INTEGER NOT NULL DEFAULT 1,
    writing_package_json TEXT NOT NULL DEFAULT '{}',
    audit_package_json TEXT NOT NULL DEFAULT '{}',
    included_reasons_json TEXT NOT NULL DEFAULT '[]',
    excluded_reasons_json TEXT NOT NULL DEFAULT '[]',
    budget_tokens INTEGER NOT NULL DEFAULT 4000,
    input_hash TEXT NOT NULL DEFAULT '',
    model_id TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`);

  // 9. 改写合同表
  db.exec(`CREATE TABLE IF NOT EXISTS rewrite_contracts (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    branch_id TEXT NOT NULL DEFAULT 'main',
    candidate_hash TEXT NOT NULL DEFAULT '',
    locked_propositions_json TEXT NOT NULL DEFAULT '[]',
    locked_events_json TEXT NOT NULL DEFAULT '[]',
    locked_causal_relations_json TEXT NOT NULL DEFAULT '[]',
    locked_cognition_json TEXT NOT NULL DEFAULT '[]',
    disclosure_boundary_json TEXT NOT NULL DEFAULT '{}',
    voice_constraints_json TEXT NOT NULL DEFAULT '{}',
    allowed_changes_json TEXT NOT NULL DEFAULT '[]',
    contract_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`);
  const rewriteContractColumns = new Set(db.prepare('PRAGMA table_info(rewrite_contracts)').all().map(column => column.name));
  if (!rewriteContractColumns.has('contract_json')) {
    db.exec("ALTER TABLE rewrite_contracts ADD COLUMN contract_json TEXT NOT NULL DEFAULT '{}'");
  }
  db.exec(`CREATE TABLE IF NOT EXISTS rewrite_reviews (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    branch_id TEXT NOT NULL DEFAULT 'main',
    manuscript_revision_id TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    candidate_hash TEXT NOT NULL,
    passed INTEGER NOT NULL DEFAULT 0 CHECK (passed IN (0, 1)),
    report_json TEXT NOT NULL DEFAULT '{}',
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_rewrite_reviews_candidate ON rewrite_reviews(book_id, branch_id, manuscript_revision_id, candidate_hash, created_at DESC)');

  // 10. 记忆变更集与自动策略
  db.exec(`CREATE TABLE IF NOT EXISTS memory_changesets (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    branch_id TEXT NOT NULL DEFAULT 'main',
    base_state_version INTEGER NOT NULL DEFAULT 1,
    candidate_hash TEXT NOT NULL DEFAULT '',
    operations_json TEXT NOT NULL DEFAULT '[]',
    dependencies_json TEXT NOT NULL DEFAULT '[]',
    risk_level TEXT NOT NULL DEFAULT 'low',
    audit_report_json TEXT NOT NULL DEFAULT '{}',
    approval_status TEXT NOT NULL DEFAULT 'pending',
    approved_by TEXT NOT NULL DEFAULT '',
    approved_at INTEGER,
    committed_at INTEGER,
    created_at INTEGER NOT NULL
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS automation_policies (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    branch_id TEXT NOT NULL DEFAULT 'main',
    op_type TEXT NOT NULL,
    memory_category TEXT NOT NULL,
    risk_threshold TEXT NOT NULL DEFAULT 'low',
    allowed_evidence_types_json TEXT NOT NULL DEFAULT '["narration","author_canon"]',
    auto_accept INTEGER NOT NULL DEFAULT 0,
    valid_until INTEGER,
    created_at INTEGER NOT NULL
  )`);

  // 11. 记忆操作变更流水（支持补偿性撤销）
  db.exec(`CREATE TABLE IF NOT EXISTS memory_operations_log (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    branch_id TEXT NOT NULL DEFAULT 'main',
    changeset_id TEXT NOT NULL DEFAULT '',
    operation_type TEXT NOT NULL,
    target_table TEXT NOT NULL,
    record_id TEXT NOT NULL,
    before_state_json TEXT NOT NULL DEFAULT '{}',
    after_state_json TEXT NOT NULL DEFAULT '{}',
    reverted INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`);

  // 12. 事务 Outbox 任务表
  db.exec(`CREATE TABLE IF NOT EXISTS memory_outbox (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    book_id TEXT NOT NULL,
    branch_id TEXT NOT NULL DEFAULT 'main',
    state_version INTEGER NOT NULL,
    projection_type TEXT NOT NULL,
    projection_schema_version INTEGER NOT NULL DEFAULT 1,
    payload_hash TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'queued',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  domain.initializeSchema(db);
  require('./memory-generation').initializeSchema(db);
}

/**
 * 提取文本中的候选命题与证据（模拟/规则提取器）。
 */
function extractPropositionsAndEvidence(text, context = {}) {
  const content = String(text || '');
  const bookId = String(context.bookId || 'default');
  const branchId = String(context.branchId || 'main');
  const now = Date.now();

  const propositions = [];
  const evidence = [];

  // 基于标点分句简单识别命题线索
  const sentences = Array.from(content.matchAll(/[^。！？\r\n]+/g)).map(match => ({
    text: match[0].trim(), offset: match.index + match[0].length - match[0].trimStart().length
  })).filter(sentence => sentence.text);
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i].text;
    const propId = `prop_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const evidId = `evid_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    // 模态与来源识别（优先识别内心独白/猜测，避免难道、武道等词被误判为对白）
    let modality = 'statement';
    let stance = 'supports';
    let sourceType = 'narration';

    if (/梦见|梦到|梦中/.test(s)) {
      modality = 'dream';
    } else if (/要不是|若非|要是当初|假如当初/.test(s)) {
      modality = 'counterfactual';
    } else if (/如果|假如|若是|只要.+就|除非/.test(s)) {
      modality = 'conditional';
    } else if (/假设|假定/.test(s)) {
      modality = 'hypothetical';
    } else if (/暗想|心道|心想|纳闷|难道|莫非|不知是否/.test(s)) {
      sourceType = 'monologue';
      modality = 'guess';
    } else if (/[“"][^”"]*[”"]/.test(s) || /(?:叹|说|问|喊|道)[：:“"]/.test(s) || /(?:说道|喊道|叹道|沉声道|反问)/.test(s)) {
      sourceType = 'dialogue';
      modality = 'claim';
    } else if (/打算|计划|准备/.test(s)) {
      modality = 'plan';
    } else if (/梦见|仿佛梦到/.test(s)) {
      modality = 'dream';
    } else if (/回忆|想起当年/.test(s)) {
      modality = 'memory';
    }

    const prop = {
      id: propId,
      bookId,
      branchId,
      expressionType: 'text',
      subjectEntityId: context.subjectEntityId || '',
      predicate: 'claims_or_observes',
      objectValue: s,
      displayText: s,
      revision: 1,
      createdAt: now
    };

    const startOffset = sentences[i].offset;
    const endOffset = startOffset >= 0 ? startOffset + s.length : 0;

    const evid = {
      id: evidId,
      bookId,
      branchId,
      propositionId: propId,
      sourceType,
      sourceEntityId: context.sourceEntityId || (sourceType === 'narration' ? 'narrator' : ''),
      modality,
      stance,
      sourceAnchor: {
        chapterRevisionId: context.chapterRevisionId || '',
        contentHash: computeTextHash(content),
        sceneId: context.sceneId || '',
        paragraphId: `p_${content.slice(0, startOffset).split('\n').length}`,
        offsetUnit: 'utf16',
        startOffset,
        endOffset,
        quote: s,
        prefixContext: content.slice(Math.max(0, startOffset - 32), startOffset),
        suffixContext: content.slice(endOffset, endOffset + 32)
      },
      storyTimeRef: context.storyTime || '',
      disclosurePosition: context.disclosurePosition || '',
      extractionConfidence: 0.5,
      reviewStatus: 'pending',
      revision: 1,
      createdAt: now
    };

    propositions.push(prop);
    evidence.push(evid);
  }

  return { propositions, evidence };
}

/**
 * 查询指定条件下的世界事实裁决与命题。
 */
function getMemory(db, bookId, options = {}) {
  const branchId = options.branchId || 'main';
  const status = options.status || 'confirmed';

  let sql = `SELECT d.*, p.display_text, p.subject_entity_id, p.predicate, p.object_value, p.expression_type
    FROM world_fact_decisions d
    JOIN memory_propositions p ON p.id = d.proposition_id
    WHERE d.book_id = ? AND d.branch_id = ?`;
  const params = [bookId, branchId];

  if (status !== 'all') {
    sql += ' AND d.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY d.created_at DESC';

  const rows = db.prepare(sql).all(...params);
  return rows.map(r => ({
    id: r.id,
    bookId: r.book_id,
    branchId: r.branch_id,
    propositionId: r.proposition_id,
    verdict: r.verdict,
    status: r.status,
    timelineId: r.timeline_id,
    cycleId: r.cycle_id,
    displayText: r.display_text,
    subjectEntityId: r.subject_entity_id,
    predicate: r.predicate,
    objectValue: r.object_value,
    expressionType: r.expression_type,
    validIntervalStart: r.valid_interval_start,
    validIntervalEnd: r.valid_interval_end,
    supportingEvidenceIds: JSON.parse(r.supporting_evidence_ids_json || '[]'),
    opposingEvidenceIds: JSON.parse(r.opposing_evidence_ids_json || '[]'),
    revision: Number(r.revision) || 1,
    createdAt: r.created_at,
    sourceInvalidated: JSON.parse(r.supporting_evidence_ids_json || '[]').some(id => {
      const evidence = db.prepare('SELECT source_anchor_json FROM memory_evidence WHERE id = ? AND book_id = ?').get(id, bookId);
      if (!evidence) return true;
      const anchor = JSON.parse(evidence.source_anchor_json);
      return !!(anchor.chapterRevisionId && db.prepare('SELECT id FROM memory_invalidations WHERE manuscript_id = ?').get(anchor.chapterRevisionId));
    })
  }));
}

/**
 * 登记一条事实裁决。
 */
function recordDecision(db, entry) {
  const id = entry.id || `dec_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = Date.now();
  db.prepare(`INSERT INTO world_fact_decisions (
    id, book_id, branch_id, proposition_id, verdict, timeline_id, cycle_id,
    valid_interval_start, valid_interval_end, status, supporting_evidence_ids_json,
    opposing_evidence_ids_json, approval_id, decision_reason, revision, supersedes_id, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id,
    entry.bookId,
    entry.branchId || 'main',
    entry.propositionId,
    entry.verdict || 'true',
    entry.timelineId || 't0',
    entry.cycleId || 'c0',
    entry.validIntervalStart || '',
    entry.validIntervalEnd || '',
    entry.status || 'confirmed',
    JSON.stringify(entry.supportingEvidenceIds || []),
    JSON.stringify(entry.opposingEvidenceIds || []),
    entry.approvalId || 'author',
    entry.decisionReason || '',
    entry.revision || 1,
    entry.supersedesId || null,
    now
  );
  return { ...entry, id, createdAt: now };
}

/**
 * 登记人物认知与对外表现（支持嵌套结构）。
 */
function recordCognition(db, entry) {
  const id = entry.id || `cog_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = Date.now();
  db.prepare(`INSERT INTO character_cognition (
    id, book_id, branch_id, holder_entity_id, target_expression_id, awareness, attitude,
    subjective_certainty, public_stance, acquisition_channel, source_event_id,
    source_evidence_ids_json, acquired_time_ref, valid_interval_start, valid_interval_end,
    review_status, nested_cognition_json, revision, created_at, timeline_id, cycle_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id,
    entry.bookId,
    entry.branchId || 'main',
    entry.holderEntityId,
    entry.targetExpressionId,
    entry.awareness || 'direct_experience',
    entry.attitude || 'knows',
    entry.subjectiveCertainty || 'certain',
    entry.publicStance || 'admit',
    entry.acquisitionChannel || 'experience',
    entry.sourceEventId || '',
    JSON.stringify(entry.sourceEvidenceIds || []),
    entry.acquiredTimeRef || '',
    entry.validIntervalStart || '',
    entry.validIntervalEnd || '',
    entry.reviewStatus || 'confirmed',
    JSON.stringify(entry.nestedCognition || {}),
    entry.revision || 1,
    now,
    entry.timelineId || 't0',
    entry.cycleId || 'c0'
  );
  return { ...entry, id, createdAt: now };
}

/**
 * 查询人物认知矩阵（可展开嵌套认知层级，带深度/节点预算限制与未展开标记，支持故事时间过滤与无记录语义说明）。
 */
function getCognition(db, bookId, options = {}) {
  const holderId = options.holderEntityId;
  let sql = "SELECT * FROM character_cognition WHERE book_id = ? AND branch_id = ? AND review_status = 'confirmed' AND timeline_id = ? AND cycle_id = ?";
  const params = [bookId, options.branchId || 'main', options.timelineId || 't0', options.cycleId || 'c0'];
  if (holderId) {
    sql += ' AND holder_entity_id = ?';
    params.push(holderId);
  }
  if (options.targetExpressionId) {
    sql += ' AND target_expression_id = ?';
    params.push(options.targetExpressionId);
  }
  sql += ' ORDER BY created_at DESC';
  const rows = db.prepare(sql).all(...params);

  // 区分“没有认知记录”与“明确不知”：无记录时返回带有 status: 'unknown_not_recorded' 的空集合或状态
  if (rows.length === 0 && options.targetExpressionId) {
    return [{
      status: 'unknown_not_recorded',
      bookId,
      holderEntityId: holderId || '',
      targetExpressionId: options.targetExpressionId,
      awareness: 'unrecorded',
      note: '没有认知记录不等于明确不知'
    }];
  }

  const maxDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : 3;
  const maxNodes = Number.isInteger(options.maxNodes) ? options.maxNodes : 50;
  let totalExpandedNodes = 0;

  function expandNested(nested, currentDepth) {
    if (!nested || typeof nested !== 'object') return nested;
    if (currentDepth >= maxDepth || totalExpandedNodes >= maxNodes) {
      return { ...nested, truncated: true, hasUnexpanded: true };
    }
    totalExpandedNodes++;
    const expanded = { ...nested };
    if (nested.targetHolderId && !nested.resolvedCognition) {
      const child = db.prepare(`SELECT * FROM character_cognition
        WHERE book_id = ? AND branch_id = ? AND holder_entity_id = ? AND review_status = 'confirmed' LIMIT 1`)
        .get(bookId, options.branchId || 'main', nested.targetHolderId);
      if (child) {
        let childNested = {};
        try { childNested = JSON.parse(child.nested_cognition_json || '{}'); } catch (_) {}
        expanded.resolvedCognition = {
          holderEntityId: child.holder_entity_id,
          attitude: child.attitude,
          nested: expandNested(childNested, currentDepth + 1)
        };
      }
    } else if (nested.resolvedCognition && nested.resolvedCognition.nested) {
      expanded.resolvedCognition = {
        ...nested.resolvedCognition,
        nested: expandNested(nested.resolvedCognition.nested, currentDepth + 1)
      };
    }
    return expanded;
  }

  return rows.filter(r => {
    if (options.storyTime !== undefined && options.storyTime !== null) {
      if (r.acquired_time_ref && Number(r.acquired_time_ref) > Number(options.storyTime)) {
        return false; // 该故事时间点人物尚未获取此项认知
      }
    }
    return true;
  }).map(r => {
    let nested = {};
    try { nested = JSON.parse(r.nested_cognition_json || '{}'); } catch (_) {}
    if (options.expandNested) {
      nested = expandNested(nested, 1);
    }
    return {
      id: r.id,
      bookId: r.book_id,
      branchId: r.branch_id,
      holderEntityId: r.holder_entity_id,
      targetExpressionId: r.target_expression_id,
      awareness: r.awareness,
      attitude: r.attitude,
      subjectiveCertainty: r.subjective_certainty,
      publicStance: r.public_stance,
      acquisitionChannel: r.acquisition_channel,
      sourceEvidenceIds: JSON.parse(r.source_evidence_ids_json || '[]'),
      nestedCognition: nested,
      validIntervalStart: r.valid_interval_start,
      validIntervalEnd: r.valid_interval_end,
      acquiredTimeRef: r.acquired_time_ref,
      revision: Number(r.revision) || 1,
      createdAt: r.created_at
    };
  });
}

/**
 * 校验时序关系无环。
 */
function validateTemporalRelations(relations) {
  if (relations.length > 10000) return false;
  const groups = new Map();
  for (const relation of relations) {
    const scope = `${relation.timelineId || relation.timeline_id || 't0'}:${relation.cycleId || relation.cycle_id || 'c0'}`;
    if (!groups.has(scope)) groups.set(scope, []);
    groups.get(scope).push(relation);
  }
  if (groups.size > 1) return [...groups.values()].every(group => validateTemporalRelations(group));
  const graph = new Map();
  const parents = new Map();
  const root = node => {
    while (parents.has(node) && parents.get(node) !== node) node = parents.get(node);
    return node;
  };
  for (const relation of relations) {
    const type = relation.relationType || relation.relation_type;
    if (type === 'simultaneous') parents.set(root(relation.sourceEventId || relation.source_event_id), root(relation.targetEventId || relation.target_event_id));
  }
  for (const r of relations) {
    const type = r.relationType || r.relation_type;
    let source = root(r.sourceEventId || r.source_event_id);
    let target = root(r.targetEventId || r.target_event_id);
    if (type === 'after') [source, target] = [target, source];
    if (type === 'before' || type === 'after') {
      if (!graph.has(source)) graph.set(source, []);
      graph.get(source).push(target);
    }
  }

  const visited = new Set();
  const recStack = new Set();

  function isCyclic(node) {
    visited.add(node);
    recStack.add(node);
    const neighbors = graph.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor) && isCyclic(neighbor)) return true;
      if (recStack.has(neighbor)) return true;
    }
    recStack.delete(node);
    return false;
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      if (isCyclic(node)) return false;
    }
  }
  return true;
}

/**
 * 查询时间线与时序关系。
 */
function getTimeline(db, bookId, timelineId = 't0', branchId = 'main', cycleId = 'c0') {
  const events = db.prepare(`SELECT * FROM story_events WHERE book_id = ? AND timeline_id = ? AND branch_id = ? AND cycle_id = ? ORDER BY created_at ASC`)
    .all(bookId, timelineId, branchId, cycleId);
  const relations = db.prepare(`SELECT * FROM temporal_relations WHERE book_id = ? AND timeline_id = ? AND branch_id = ? AND cycle_id = ? AND status = 'confirmed'`)
    .all(bookId, timelineId, branchId, cycleId);

  return {
    timelineId,
    events: events.map(e => ({
      id: e.id,
      title: e.title,
      summary: e.summary,
      storyTime: e.story_time,
      narrativePosition: e.narrative_position,
      sceneId: e.scene_id,
      povEntityId: e.pov_entity_id
    })),
    relations: relations.map(r => ({
      id: r.id,
      sourceEventId: r.source_event_id,
      targetEventId: r.target_event_id,
      relationType: r.relation_type,
      intervalValue: r.interval_value,
      status: r.status
    })),
    temporalAcyclic: validateTemporalRelations(relations)
  };
}

/**
 * 上下文检索与装配（区分正文写作包与审校包，遵循披露策略与预算约束）。
 */
function assembleContext(db, bookId, query = {}) {
  const branchId = query.branchId || 'main';
  const povId = query.povId || '';
  const chapterRange = query.chapterRange || '';
  const budgetTokens = Number(query.budgetTokens) || 4000;

  // 必须项预算溢出检查：必须项超预算时明确返回 CONTEXT_BUDGET_EXCEEDED，不能静默截断
  if (Array.isArray(query.mandatoryItems) && query.mandatoryItems.length) {
    const mandatoryChars = query.mandatoryItems.reduce((acc, item) => acc + (typeof item === 'string' ? item.length : JSON.stringify(item).length), 0);
    const estimatedMandatoryTokens = Math.ceil(mandatoryChars * 1.5);
    if (estimatedMandatoryTokens > budgetTokens) {
      throw Object.assign(new Error('必须项超出上下文预算限制'), { code: 'CONTEXT_BUDGET_EXCEEDED', statusCode: 409 });
    }
  }

  // 1. 读取披露策略并按 POV 及章节范围过滤
  const policies = db.prepare(`SELECT * FROM disclosure_policies WHERE book_id = ? AND branch_id = ?`)
    .all(bookId, branchId);
  const hiddenInfoIds = new Set();
  const implyInfoMap = new Map();

  for (const p of policies) {
    if (p.pov_entity_id && povId && p.pov_entity_id !== povId) continue;
    if (p.policy_type === 'hide') {
      hiddenInfoIds.add(p.target_info_id);
    } else if (p.policy_type === 'imply') {
      let allowedClues = [];
      try { allowedClues = JSON.parse(p.allowed_clues_json || '[]'); } catch (_) {}
      implyInfoMap.set(p.target_info_id, allowedClues);
    }
  }

  // 2. 读取事实裁决
  const facts = getMemory(db, bookId, { branchId, status: 'confirmed' });

  // 3. 构造正文写作包与审校包
  const writingPackageFacts = [];
  const auditPackageFacts = [];
  const includedReasons = [];
  const excludedReasons = [];

  for (const f of facts) {
    auditPackageFacts.push(f); // 审校包可以查看包括隐藏在内的所有已确认事实

    if (hiddenInfoIds.has(f.propositionId) || hiddenInfoIds.has(f.id)) {
      excludedReasons.push({ id: f.id, reason: 'disclosure_policy_hidden' });
      continue;
    }

    if (implyInfoMap.has(f.propositionId)) {
      writingPackageFacts.push({
        ...f,
        impliedMode: true,
        allowedClues: implyInfoMap.get(f.propositionId),
        objectValue: '[仅允许根据线索暗示，禁止直接揭露答案]'
      });
      includedReasons.push({ id: f.id, reason: 'disclosure_policy_imply' });
      continue;
    }

    writingPackageFacts.push(f);
    includedReasons.push({ id: f.id, reason: 'regular_confirmed_fact' });
  }

  // 4. 读取该 POV 认知
  const cognitions = povId ? getCognition(db, bookId, { holderEntityId: povId, storyTime: query.storyTime }) : [];

  const manifestId = `manif_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const inputHash = computeTextHash(JSON.stringify(writingPackageFacts));
  const now = Date.now();

  const manifest = {
    id: manifestId,
    bookId,
    branchId,
    stateVersion: query.stateVersion || 1,
    writingPackage: { facts: writingPackageFacts, cognitions },
    auditPackage: { facts: auditPackageFacts, cognitions },
    includedReasons,
    excludedReasons,
    budgetTokens: query.budgetTokens || 4000,
    inputHash,
    modelId: query.modelId || 'gpt-5.6-luna',
    createdAt: now
  };

  db.prepare(`INSERT INTO context_manifests (
    id, book_id, branch_id, state_version, writing_package_json, audit_package_json,
    included_reasons_json, excluded_reasons_json, budget_tokens, input_hash, model_id, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    manifestId,
    bookId,
    branchId,
    manifest.stateVersion,
    JSON.stringify(manifest.writingPackage),
    JSON.stringify(manifest.auditPackage),
    JSON.stringify(includedReasons),
    JSON.stringify(excludedReasons),
    manifest.budgetTokens,
    inputHash,
    manifest.modelId,
    now
  );

  return manifest;
}

/**
 * 读取上下文清单。
 */
function getContextManifest(db, bookId, manifestId) {
  const row = db.prepare('SELECT * FROM context_manifests WHERE book_id = ? AND id = ?')
    .get(bookId, manifestId);
  if (!row) return null;
  return {
    id: row.id,
    bookId: row.book_id,
    branchId: row.branch_id,
    stateVersion: row.state_version,
    writingPackage: JSON.parse(row.writing_package_json || '{}'),
    auditPackage: JSON.parse(row.audit_package_json || '{}'),
    includedReasons: JSON.parse(row.included_reasons_json || '[]'),
    excludedReasons: JSON.parse(row.excluded_reasons_json || '[]'),
    budgetTokens: row.budget_tokens,
    inputHash: row.input_hash,
    modelId: row.model_id,
    createdAt: row.created_at
  };
}

/**
 * 建立改写合同（Rewrite Contract）。
 */
function createRewriteContract(db, contract) {
  const id = contract.id || `rwc_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = Date.now();
  const storedContract = { ...contract, id, branchId: contract.branchId || 'main' };
  db.prepare(`INSERT INTO rewrite_contracts (
    id, book_id, branch_id, candidate_hash, locked_propositions_json, locked_events_json,
    locked_causal_relations_json, locked_cognition_json, disclosure_boundary_json,
    voice_constraints_json, allowed_changes_json, contract_json, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id,
    contract.bookId,
    contract.branchId || 'main',
    contract.candidateHash || '',
    JSON.stringify(contract.lockedPropositions || []),
    JSON.stringify(contract.lockedEvents || []),
    JSON.stringify(contract.lockedCausalRelations || []),
    JSON.stringify(contract.lockedCognition || []),
    JSON.stringify(contract.disclosureBoundary || {}),
    JSON.stringify(contract.voiceConstraints || {}),
    JSON.stringify(contract.allowedChanges || []),
    JSON.stringify(storedContract),
    now
  );
  return { ...storedContract, createdAt: now };
}

function getRewriteContract(db, bookId, contractId) {
  const row = db.prepare('SELECT * FROM rewrite_contracts WHERE book_id = ? AND id = ?').get(bookId, contractId);
  if (!row) return null;
  let stored;
  try { stored = JSON.parse(row.contract_json || '{}'); } catch (_) { stored = {}; }
  if (!stored || typeof stored !== 'object' || Array.isArray(stored) || !Object.keys(stored).length) {
    stored = {
      lockedPropositions: JSON.parse(row.locked_propositions_json || '[]'),
      lockedEvents: JSON.parse(row.locked_events_json || '[]'),
      lockedCausalRelations: JSON.parse(row.locked_causal_relations_json || '[]'),
      lockedCognition: JSON.parse(row.locked_cognition_json || '[]'),
      disclosureBoundary: JSON.parse(row.disclosure_boundary_json || '{}'),
      voiceConstraints: JSON.parse(row.voice_constraints_json || '{}'),
      allowedChanges: JSON.parse(row.allowed_changes_json || '[]')
    };
  }
  return { ...stored, id: row.id, bookId: row.book_id, branchId: row.branch_id, candidateHash: row.candidate_hash, createdAt: row.created_at };
}

function createRewriteReview(db, review) {
  const id = review.id || `rwr_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = Date.now();
  const report = review.report && typeof review.report === 'object' ? review.report : {};
  const passed = report.passed === true;
  db.prepare(`INSERT INTO rewrite_reviews (
    id, book_id, branch_id, manuscript_revision_id, contract_id, candidate_hash,
    passed, report_json, created_by, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, review.bookId, review.branchId || 'main', review.manuscriptRevisionId,
    review.contractId, review.candidateHash, passed ? 1 : 0, JSON.stringify(report), review.actorId || '', now
  );
  return { id, bookId: review.bookId, branchId: review.branchId || 'main',
    manuscriptRevisionId: review.manuscriptRevisionId, contractId: review.contractId,
    candidateHash: review.candidateHash, passed, report, createdAt: now };
}

/**
 * 校验候选正文是否遵守改写合同。
 */
function verifyRewriteContractCompliance(contract, rewrittenText) {
  const violations = [];
  const text = String(rewrittenText || '');

  // 1. 检查锁定的核心命题是否被擅自删除/颠覆
  for (const prop of contract.lockedPropositions || []) {
    const keyStr = typeof prop === 'string' ? prop : (prop.objectValue || prop.displayText || '');
    if (keyStr && !text.includes(keyStr)) {
      violations.push({ type: 'LOCKED_PROPOSITION_LOST', detail: `关键命题丢失: ${keyStr}` });
    }
  }

  // 2. 检查披露边界（不能出现禁止揭露的内容）
  const forbidden = contract.disclosureBoundary?.forbiddenAnswers || [];
  for (const f of forbidden) {
    if (text.includes(f)) {
      violations.push({ type: 'DISCLOSURE_BOUNDARY_BREACH', detail: `违规泄露禁止答案: ${f}` });
    }
  }

  // 3. 锁定数字与度量衡（润色不得篡改关键数字）
  const lockedNumbers = contract.lockedNumbers || [];
  for (const num of lockedNumbers) {
    if (num && !text.includes(String(num))) {
      violations.push({ type: 'LOCKED_NUMBER_LOST', detail: `锁定数字/时间丢失或被篡改: ${num}` });
    }
  }

  // 4. 锁定事件时序
  const lockedEvents = contract.lockedEvents || [];
  let lastIndex = -1;
  for (const ev of lockedEvents) {
    const evStr = typeof ev === 'string' ? ev : (ev.title || ev.displayText || '');
    if (evStr) {
      const idx = text.indexOf(evStr);
      if (idx === -1) {
        violations.push({ type: 'LOCKED_EVENT_LOST', detail: `锁定事件丢失: ${evStr}` });
      } else if (idx < lastIndex) {
        violations.push({ type: 'EVENT_ORDER_VIOLATION', detail: `锁定事件发生时序逆转: ${evStr}` });
      } else {
        lastIndex = idx;
      }
    }
  }

  // 5. 锁定角色身份
  const lockedIdentities = contract.lockedIdentities || [];
  for (const idn of lockedIdentities) {
    if (idn && !text.includes(String(idn))) {
      violations.push({ type: 'LOCKED_IDENTITY_LOST', detail: `锁定人物身份或姓名丢失: ${idn}` });
    }
  }

  // 锁定的伏笔在任何候选类型下都不能静默丢失。
  for (const fs of contract.lockedForeshadows || []) {
    const fsStr = typeof fs === 'string' ? fs : (fs.title || fs.content || '');
    if (fsStr && !text.includes(fsStr)) {
      violations.push({
        type: contract.taskType === 'style_polish' ? 'POLISH_UNAUTHORIZED_PLOT_MODIFICATION' : 'LOCKED_FORESHADOW_LOST',
        detail: contract.taskType === 'style_polish' ? `文风润色擅自删除或变更伏笔: ${fsStr}` : `锁定伏笔丢失: ${fsStr}`
      });
    }
  }

  return {
    passed: violations.length === 0,
    violations
  };
}

/**
 * 创建记忆变更集 (Changeset)。
 */
function createChangeset(db, changeset) {
  const id = changeset.id || `cs_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = Date.now();
  db.prepare(`INSERT INTO memory_changesets (
    id, book_id, branch_id, base_state_version, candidate_hash, operations_json,
    dependencies_json, risk_level, audit_report_json, approval_status, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`).run(
    id,
    changeset.bookId,
    changeset.branchId || 'main',
    changeset.baseStateVersion || 1,
    changeset.candidateHash || '',
    JSON.stringify(changeset.operations || []),
    JSON.stringify(changeset.dependencies || []),
    changeset.riskLevel || 'low',
    JSON.stringify(changeset.auditReport || {}),
    now
  );
  return { id, ...changeset, approvalStatus: 'pending', createdAt: now };
}

/**
 * 审批记忆变更集。
 */
function approveChangeset(db, bookId, changesetId, actorId, approvalStatus = 'approved') {
  if (!['approved', 'rejected'].includes(approvalStatus)) return { ok: false, code: 'INVALID_APPROVAL_STATUS' };
  db.exec('BEGIN IMMEDIATE');
  try {
    const cs = db.prepare('SELECT * FROM memory_changesets WHERE book_id = ? AND id = ?')
      .get(bookId, changesetId);
    if (!cs || cs.committed_at) {
      db.exec('ROLLBACK');
      return { ok: false, code: cs ? 'CHANGESET_ALREADY_COMMITTED' : 'changeset_missing' };
    }

    const audit = JSON.parse(cs.audit_report_json || '{}');
    const policy = cs.approval_policy || audit.approvalPolicy || 'author_owned';
    if (policy === 'two_person' && audit.proposedBy && audit.proposedBy === actorId) {
      db.exec('ROLLBACK');
      return { ok: false, code: 'SELF_APPROVAL_FORBIDDEN' };
    }

    const sourceConflict = workflow.validateSource(db, cs);
    if (sourceConflict) {
      db.exec('ROLLBACK');
      return { ok: false, code: sourceConflict };
    }

    const now = Date.now();
    const contentHash = commitGuard.changesetHash(cs);
    db.prepare(`INSERT INTO memory_approvals (changeset_id, content_hash, actor_id, status, created_at)
      VALUES (?, ?, ?, ?, ?)`).run(changesetId, contentHash, actorId, approvalStatus, now);
    db.prepare(`UPDATE memory_changesets
      SET approval_status = ?, approved_by = ?, approved_at = ?
      WHERE id = ?`).run(approvalStatus, actorId, now, changesetId);
    workflow.emitEvent(db, bookId, cs.branch_id, changesetId,
      approvalStatus === 'approved' ? 'AUTHOR_APPROVED' : 'AUTHOR_REJECTED', { actorId, contentHash });

    db.exec('COMMIT');
    return { ok: true, changesetId, approvalStatus, approvedBy: actorId, approvedAt: now, contentHash };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/**
 * 正式原子提交变更集（更新 SQLite 表、版本递增、Outbox 任务写入）。
 */
function commitChangeset(db, bookId, changesetId, actorId, options = {}) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const cs = db.prepare('SELECT * FROM memory_changesets WHERE book_id = ? AND id = ?')
      .get(bookId, changesetId);
    if (!cs) {
      db.exec('ROLLBACK');
      return { ok: false, code: 'changeset_missing' };
    }
    const prepared = commitGuard.prepareCommit(db, cs, actorId, options);
    if (prepared.code || prepared.replay) {
      db.exec(prepared.replay ? 'COMMIT' : 'ROLLBACK');
      return prepared.replay || { ok: false, code: prepared.code };
    }
    const operations = prepared.operations;
    const now = Date.now();
    const nextStateVersion = cs.base_state_version + 1;
    const manuscriptReceipt = workflow.acceptManuscript(db, cs);

    for (const op of [...operations].sort((left, right) => Number(right.type === 'INSERT_EVENT') - Number(left.type === 'INSERT_EVENT'))) {
      const opLogId = `oplog_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      let beforeState = {};

      if (op.type === 'INSERT_FACT') {
        if (op.payload.supersedesId) {
          const previous = db.prepare('SELECT * FROM world_fact_decisions WHERE id = ?').get(op.payload.supersedesId);
          domain.archiveRecord(db, 'world_fact_decisions', previous, changesetId);
          db.prepare("UPDATE world_fact_decisions SET status = 'superseded' WHERE id = ?").run(previous.id);
        }
        const decision = recordDecision(db, { ...op.payload, bookId, branchId: cs.branch_id, status: 'confirmed', approvalId: changesetId });
        db.prepare(`INSERT INTO memory_operations_log (
          id, book_id, branch_id, changeset_id, operation_type, target_table, record_id, before_state_json, after_state_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          opLogId, bookId, cs.branch_id, changesetId, op.type, 'world_fact_decisions', decision.id,
          JSON.stringify(beforeState), JSON.stringify(op.payload), now
        );
      } else if (op.type === 'INSERT_COGNITION') {
        const cognition = recordCognition(db, { ...op.payload, bookId, branchId: cs.branch_id });
        db.prepare(`INSERT INTO memory_operations_log (
          id, book_id, branch_id, changeset_id, operation_type, target_table, record_id, before_state_json, after_state_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          opLogId, bookId, cs.branch_id, changesetId, op.type, 'character_cognition', cognition.id,
          JSON.stringify(beforeState), JSON.stringify(op.payload), now
        );
      } else if (op.type === 'STATE_TRANSITION') {
        const transId = op.payload.id || `trans_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
        db.prepare(`INSERT INTO state_transitions (
          id, book_id, branch_id, event_id, entity_id, dimension, pre_state, post_state, valid_interval_start, valid_interval_end, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          transId, bookId, cs.branch_id, op.payload.eventId || '', op.payload.entityId, op.payload.dimension || 'possession',
          op.payload.preState || '', op.payload.postState || '', op.payload.validIntervalStart || '', op.payload.validIntervalEnd || '', now
        );
        db.prepare(`INSERT INTO memory_operations_log (
          id, book_id, branch_id, changeset_id, operation_type, target_table, record_id, before_state_json, after_state_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          opLogId, bookId, cs.branch_id, changesetId, op.type, 'state_transitions', transId,
          JSON.stringify(beforeState), JSON.stringify(op.payload), now
        );
      } else {
        domain.applyDomainOperation(db, op, cs, actorId);
      }
    }

    // 标记变更集已提交
    db.prepare('UPDATE memory_changesets SET committed_at = ? WHERE id = ?').run(now, changesetId);

    // 写入 Outbox 任务供派生索引与兼容因果债务投影更新
    const outboxId = `outbox_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const payloadJson = JSON.stringify({
      changesetId,
      stateVersion: nextStateVersion,
      operationsCount: operations.length
    });
    db.prepare(`INSERT INTO memory_outbox (
      id, event_id, book_id, branch_id, state_version, projection_type,
      projection_schema_version, payload_hash, payload_json, status, attempt_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'causal_debts_and_snapshots', 1, ?, ?, 'queued', 0, ?, ?)`).run(
      outboxId, changesetId, bookId, cs.branch_id, nextStateVersion,
      computeTextHash(payloadJson), payloadJson, now, now
    );

    const receipt = {
      ok: true,
      changesetId,
      stateVersion: nextStateVersion,
      committedAt: now,
      operationsApplied: operations.length,
      committedBy: actorId,
      projectionStatus: 'queued',
      ...manuscriptReceipt
    };
    workflow.emitEvent(db, bookId, cs.branch_id, changesetId, 'MEMORY_COMMITTED', { stateVersion: nextStateVersion });
    commitGuard.saveReceipt(db, cs, actorId, prepared, receipt);
    db.exec('COMMIT');
    return receipt;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }
}

/**
 * 补偿性撤销单项操作（Revert operation）。
 */
function revertOperation(db, bookId, operationId, actorId, reason = '') {
  return domain.revertOperation(db, bookId, operationId, actorId, reason);
}

/**
 * 修改影响分析 (Impact Analysis)。
 * 计算正文或事实被修改后，明确影响与可能影响的范围。
 */
function analyzeImpact(db, bookId, target = {}) {
  const branchId = target.branchId || 'main';
  const targetId = target.targetId || '';
  const modifiedType = target.modifiedType || 'fact'; // 'fact' | 'chapter' | 'entity'

  const explicitImpacts = [];
  const potentialImpacts = [];

  // 1. 查找明确依赖此事实的证据和裁决
  if (modifiedType === 'fact' && targetId) {
    const dependentDecisions = db.prepare(`SELECT * FROM world_fact_decisions
      WHERE book_id = ? AND branch_id = ? AND supersedes_id = ?`).all(bookId, branchId, targetId);
    for (const d of dependentDecisions) {
      explicitImpacts.push({
        type: 'SUPERSEDED_DECISION',
        id: d.id,
        summary: `后续裁决引用了此目标: ${d.decision_reason || d.id}`,
        severity: 'high'
      });
    }

    // 查找以此事实为前状态的状态转换
    const trans = db.prepare(`SELECT * FROM state_transitions
      WHERE book_id = ? AND branch_id = ? AND pre_state LIKE ?`).all(bookId, branchId, `%${targetId}%`);
    for (const t of trans) {
      explicitImpacts.push({
        type: 'STATE_TRANSITION_BROKEN',
        id: t.id,
        summary: `实体 ${t.entity_id} 的 ${t.dimension} 状态转换依赖此前状态`,
        severity: 'high'
      });
    }

    // 查找涉及此实体的人物认知
    const cognitions = db.prepare(`SELECT * FROM character_cognition
      WHERE book_id = ? AND branch_id = ? AND target_expression_id = ?`).all(bookId, branchId, targetId);
    for (const c of cognitions) {
      potentialImpacts.push({
        type: 'CHARACTER_BELIEF_MISMATCH',
        id: c.id,
        summary: `角色 ${c.holder_entity_id} 对此事实存在已知认知 (${c.attitude})，可能产生误信或信息差`,
        severity: 'medium'
      });
    }
  }
  if (modifiedType === 'chapter' && targetId) {
    const manuscripts = db.prepare(`SELECT id FROM memory_manuscripts WHERE book_id = ? AND branch_id = ? AND (chapter_id = ? OR id = ?)`)
      .all(bookId, branchId, targetId, targetId);
    const manuscriptIds = new Set(manuscripts.map(row => row.id));
    const evidence = db.prepare('SELECT id, source_anchor_json FROM memory_evidence WHERE book_id = ? AND branch_id = ?')
      .all(bookId, branchId).filter(row => manuscriptIds.has(JSON.parse(row.source_anchor_json).chapterRevisionId));
    const evidenceIds = new Set(evidence.map(row => row.id));
    for (const row of evidence) explicitImpacts.push({ type: 'SOURCE_EVIDENCE', id: row.id, severity: 'high', summary: '证据指向被修改章节的确切版本' });
    const decisions = db.prepare('SELECT id, supporting_evidence_ids_json FROM world_fact_decisions WHERE book_id = ? AND branch_id = ?').all(bookId, branchId);
    for (const row of decisions) {
      if (JSON.parse(row.supporting_evidence_ids_json).some(id => evidenceIds.has(id))) {
        explicitImpacts.push({ type: 'FACT_SOURCE_CHANGED', id: row.id, severity: 'high', summary: '裁决来源需要重新确认，不自动修改人物认知' });
      }
    }
  }
  const manifests = db.prepare(`SELECT id, included_reasons_json FROM context_manifests
    WHERE book_id = ? AND branch_id = ? ORDER BY created_at DESC LIMIT 1000`).all(bookId, branchId);
  const affected = new Set([targetId, ...explicitImpacts.map(impact => impact.id)]);
  for (const manifest of manifests) {
    if (JSON.parse(manifest.included_reasons_json).some(item => affected.has(item.id))) {
      explicitImpacts.push({ type: 'PROVIDED_CONTEXT', id: manifest.id, severity: 'high', summary: '生成输入曾包含目标信息；这不是剧情因果关系的证明' });
    }
  }

  // 2. 查找伏笔影响
  const foreshadows = db.prepare(`SELECT * FROM story_foreshadows
    WHERE book_id = ? AND branch_id = ? AND status IN ('planted', 'reinforced')`).all(bookId, branchId);
  for (const f of foreshadows) {
    potentialImpacts.push({
      type: 'OPEN_FORESHADOW_CHECK',
      id: f.id,
      summary: `未闭环伏笔 [${f.title}] 需复核计划回收范围 ${f.planned_payoff_range}`,
      severity: 'low'
    });
  }

  return {
    bookId,
    targetId,
    modifiedType,
    analysisTime: Date.now(),
    explicitImpacts,
    potentialImpacts,
    totalImpactCount: explicitImpacts.length + potentialImpacts.length,
    coverage: { semanticDependencies: 'not_checked', recentManifestLimit: 1000, truncated: manifests.length === 1000 },
    recommendations: explicitImpacts.length > 0
      ? ['修改后续章节对白或事件', '更新状态转换前置条件', '向变更集提交修正裁决']
      : ['检查人物认知是否需同步修正', '保留例外并在改写合同中锁定']
  };
}

/**
 * 校验派生投影与权威 SQLite 状态版本的一致性。
 */
function verifyProjections(db, bookId, branchId = 'main') {
  return workflow.verifyProjections(db, bookId, branchId);
}

module.exports = {
  initializeSchema,
  computeTextHash,
  extractPropositionsAndEvidence,
  getMemory,
  recordDecision,
  recordCognition,
  getCognition,
  validateTemporalRelations,
  getTimeline,
  assembleContext: require('./memory-context').assembleContext,
  getContextManifest,
  createRewriteContract,
  getRewriteContract,
  createRewriteReview,
  verifyRewriteContractCompliance,
  createChangeset,
  approveChangeset,
  commitChangeset,
  revertOperation,
  analyzeImpact,
  verifyProjections,
  saveManuscript: workflow.saveManuscript,
  createBoundChangeset: workflow.createBoundChangeset,
  extractSavedManuscript: workflow.extractSavedManuscript,
  processProjections: workflow.processProjections
};
