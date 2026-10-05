'use strict';

/**
 * @file story-debt-ledger.js
 * 纯追加事件驱动的叙事债务总账 (Append-only Story Debt Event Ledger)
 * 
 * 核心架构定位：
 * 1. 债务不是单一字段，而是一条具象生命周期；
 * 2. 状态不可直接就地覆盖，必须经由 DebtEvent 不可变流追加推进；
 * 3. 严格确定性回放：任何时刻的债务状态由其生命周期事件序列折叠聚合得出；
 * 4. 具备审计解释器：精准回答“为什么此伏笔被判定为已回收/已部分兑现”。
 */

const {
  DEBT_TYPES,
  DEBT_TYPE_DESCRIPTIONS,
  DEBT_STATUSES,
  DEBT_EVENT_TYPES,
  DEBT_PRIORITIES,
  normalizeDebtType,
  normalizeDebtStatus,
  normalizeDebtPriority,
  normalizeDebtEventType
} = require('./debt-types');
const { createDebtEvent } = require('./debt-event');

class StoryDebtLedger {
  /**
   * @param {Object} options
   */
  constructor(options = {}) {
    this.storyId = String(options.storyId || options.story_id || 'default_story').trim();
    this.schemaVersion = 'story-debt-ledger-v1';
    this._events = []; // Append-only 事件流
    this._debts = new Map(); // 当前物化视图 (debtId -> 聚合状态)
  }

  /**
   * 追加不可变事件并确定性更新债务物化状态
   * @param {Object} eventInput
   * @returns {Object} { event: 记录的事件, debt: 更新后的债务快照 }
   */
  recordEvent(eventInput) {
    const event = createDebtEvent(eventInput);
    this._events.push(event);

    const updatedDebt = this._applyEvent(event);
    return {
      event,
      debt: updatedDebt ? this._cloneDebt(updatedDebt) : null
    };
  }

  /**
   * 创建一条新债务（底层自动派发 CREATED 事件）
   * @param {Object} input 债务核心字段
   * @param {Object} eventContext 触发创建的上下文（章节、场景、引文等）
   * @returns {Object} 创建后的完整债务实体快照
   */
  createDebt(input = {}, eventContext = {}) {
    const debtId = String(input.debtId || input.debt_id || `debt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`).trim();
    if (!input.summary && !eventContext.summary) {
      throw new TypeError('创建债务必须具备 summary 说明');
    }

    const payload = {
      story_id: String(input.storyId || input.story_id || this.storyId).trim(),
      volume_id: String(input.volumeId || input.volume_id || '').trim(),
      arc_id: String(input.arcId || input.arc_id || '').trim(),
      debt_type: normalizeDebtType(input.debtType || input.debt_type),
      summary: String(input.summary || eventContext.summary || '').trim(),
      origin_chapter_id: String(input.originChapterId || input.origin_chapter_id || eventContext.chapterId || '').trim(),
      origin_scene_id: String(input.originSceneId || input.origin_scene_id || eventContext.sceneId || '').trim(),
      target_entity_id: String(input.targetEntityId || input.target_entity_id || '').trim(),
      target_entity_type: String(input.targetEntityType || input.target_entity_type || 'character').trim(),
      created_at_chapter: Number(input.createdAtChapter ?? input.created_at_chapter ?? eventContext.chapterNo ?? 1) || 1,
      expected_payoff_from: Number(input.expectedPayoffFrom ?? input.expected_payoff_from ?? ((Number(input.createdAtChapter ?? input.created_at_chapter ?? eventContext.chapterNo ?? 1) || 1) + 1)),
      expected_payoff_to: Number(input.expectedPayoffTo ?? input.expected_payoff_to ?? ((Number(input.createdAtChapter ?? input.created_at_chapter ?? eventContext.chapterNo ?? 1) || 1) + 5)),
      priority: normalizeDebtPriority(input.priority),
      weight: Math.max(0.0, Math.min(1.0, Number(input.weight ?? 0.5))),
      parent_debt_id: String(input.parentDebtId || input.parent_debt_id || '').trim(),
      related_debt_ids: Array.isArray(input.relatedDebtIds || input.related_debt_ids)
        ? (input.relatedDebtIds || input.related_debt_ids).map(String)
        : [],
      creation_evidence: String(input.creationEvidence || input.creation_evidence || eventContext.evidence || '').trim(),
      metadata: typeof input.metadata === 'object' && input.metadata !== null ? { ...input.metadata } : {}
    };

    const record = this.recordEvent({
      debtId,
      eventType: DEBT_EVENT_TYPES.CREATED,
      chapterId: payload.origin_chapter_id,
      chapterNo: payload.created_at_chapter,
      sceneId: payload.origin_scene_id,
      evidence: payload.creation_evidence,
      notes: String(eventContext.notes || `在第 ${payload.created_at_chapter} 章产生 ${payload.debt_type} 债务`).trim(),
      operator: eventContext.operator || 'system',
      payload
    });

    return record.debt;
  }

  /**
   * 债务升级/加深 (ESCALATED)
   */
  escalateDebt(debtId, options = {}) {
    return this.recordEvent({
      debtId,
      eventType: DEBT_EVENT_TYPES.ESCALATED,
      chapterId: options.chapterId,
      chapterNo: options.chapterNo,
      sceneId: options.sceneId,
      evidence: options.evidence,
      notes: options.notes || '因果加深或危机升级',
      operator: options.operator || 'system',
      payload: options.payload || {}
    });
  }

  /**
   * 债务重构/视角翻转 (REFRAMED)
   */
  reframeDebt(debtId, options = {}) {
    return this.recordEvent({
      debtId,
      eventType: DEBT_EVENT_TYPES.REFRAMED,
      chapterId: options.chapterId,
      chapterNo: options.chapterNo,
      sceneId: options.sceneId,
      evidence: options.evidence,
      notes: options.notes || '伏笔重构或认知反转',
      operator: options.operator || 'system',
      payload: options.payload || {}
    });
  }

  /**
   * 债务部分兑现/部分解释 (PARTIALLY_PAID)
   */
  partiallyPayDebt(debtId, options = {}) {
    return this.recordEvent({
      debtId,
      eventType: DEBT_EVENT_TYPES.PARTIALLY_PAID,
      chapterId: options.chapterId,
      chapterNo: options.chapterNo,
      sceneId: options.sceneId,
      evidence: options.evidence,
      notes: options.notes || '部分信息解密或部分兑现',
      operator: options.operator || 'system',
      payload: options.payload || {}
    });
  }

  /**
   * 债务完全偿还/伏笔完全回收 (PAID)
   */
  payDebt(debtId, options = {}) {
    return this.recordEvent({
      debtId,
      eventType: DEBT_EVENT_TYPES.PAID,
      chapterId: options.chapterId,
      chapterNo: options.chapterNo,
      sceneId: options.sceneId,
      evidence: options.evidence,
      notes: options.notes || '伏笔或承诺完全回收兑现',
      operator: options.operator || 'system',
      payload: options.payload || {}
    });
  }

  /**
   * 债务延期 (DEFERRED)
   */
  deferDebt(debtId, options = {}) {
    return this.recordEvent({
      debtId,
      eventType: DEBT_EVENT_TYPES.DEFERRED,
      chapterId: options.chapterId,
      chapterNo: options.chapterNo,
      sceneId: options.sceneId,
      evidence: options.evidence,
      notes: options.notes || '因主线推进节奏延后兑现窗口',
      operator: options.operator || 'system',
      payload: {
        deferUntilChapter: options.deferUntilChapter || null,
        ...(options.payload || {})
      }
    });
  }

  /**
   * 债务作废/前提崩溃 (INVALIDATED)
   */
  invalidateDebt(debtId, options = {}) {
    return this.recordEvent({
      debtId,
      eventType: DEBT_EVENT_TYPES.INVALIDATED,
      chapterId: options.chapterId,
      chapterNo: options.chapterNo,
      sceneId: options.sceneId,
      evidence: options.evidence,
      notes: options.notes || '因果前提已被不可逆剧情推翻而失效',
      operator: options.operator || 'system',
      payload: options.payload || {}
    });
  }

  /**
   * 债务放弃/战略砍线 (ABANDONED)
   */
  abandonDebt(debtId, options = {}) {
    return this.recordEvent({
      debtId,
      eventType: DEBT_EVENT_TYPES.ABANDONED,
      chapterId: options.chapterId,
      chapterNo: options.chapterNo,
      sceneId: options.sceneId,
      evidence: options.evidence,
      notes: options.notes || '创作取舍战略性放弃该支线',
      operator: options.operator || 'system',
      payload: options.payload || {}
    });
  }

  /**
   * 确定性审计解释：回答“这个伏笔为什么现在被认为已经回收/处于当前状态？”
   * @param {string} debtId
   * @returns {Object} 具备时间戳、章节序列、引文证据链的审计说明
   */
  explainDebt(debtId) {
    const debt = this._debts.get(debtId);
    if (!debt) return null;

    const events = this._events.filter(e => e.debtId === debtId);
    const timeline = events.map(e => ({
      eventId: e.eventId,
      eventType: e.eventType,
      chapterNo: e.chapterNo,
      chapterId: e.chapterId,
      evidence: e.evidence,
      notes: e.notes,
      operator: e.operator,
      timestamp: e.timestamp
    }));

    // 生成人类可读审计判词
    let auditStatement = `债务【${debt.summary}】(ID: ${debt.debt_id}) 当前状态为【${debt.status}】。`;
    const createdEvt = events.find(e => e.eventType === DEBT_EVENT_TYPES.CREATED);
    if (createdEvt) {
      auditStatement += ` 于第 ${createdEvt.chapterNo} 章产生`;
      if (createdEvt.evidence) auditStatement += `（产生证据：“${createdEvt.evidence}”）`;
    }

    const midEvents = events.filter(e => [DEBT_EVENT_TYPES.ESCALATED, DEBT_EVENT_TYPES.REFRAMED, DEBT_EVENT_TYPES.PARTIALLY_PAID, DEBT_EVENT_TYPES.DEFERRED].includes(e.eventType));
    for (const mid of midEvents) {
      auditStatement += `；第 ${mid.chapterNo} 章【${mid.eventType}】（${mid.notes || mid.evidence}）`;
    }

    const finalEvents = events.filter(e => [DEBT_EVENT_TYPES.PAID, DEBT_EVENT_TYPES.INVALIDATED, DEBT_EVENT_TYPES.ABANDONED].includes(e.eventType));
    const finalEvt = finalEvents.length ? finalEvents[finalEvents.length - 1] : null;
    if (finalEvt) {
      auditStatement += `；最终于第 ${finalEvt.chapterNo} 章根据证据【${finalEvt.evidence || '情节点达成'}】判定为【${finalEvt.eventType}】（说明：${finalEvt.notes}）。`;
    }

    return {
      debtId: debt.debt_id,
      summary: debt.summary,
      debtType: debt.debt_type,
      status: debt.status,
      isResolved: [DEBT_STATUSES.PAID, DEBT_STATUSES.INVALIDATED, DEBT_STATUSES.ABANDONED].includes(debt.status),
      originChapter: debt.created_at_chapter,
      lastTouchedChapter: debt.last_touched_chapter,
      totalEvents: events.length,
      creationEvidence: debt.creation_evidence,
      payoffEvidence: debt.payoff_evidence,
      timeline,
      auditStatement
    };
  }

  /**
   * 获取指定债务快照
   */
  getDebt(debtId) {
    const debt = this._debts.get(debtId);
    return debt ? this._cloneDebt(debt) : null;
  }

  /**
   * 获取所有债务快照（支持按状态、类型、范围过滤）
   */
  getAllDebts(filter = {}) {
    const all = Array.from(this._debts.values());
    return all.filter(d => {
      if (filter.status && d.status !== normalizeDebtStatus(filter.status)) return false;
      if (filter.debtType && d.debt_type !== normalizeDebtType(filter.debtType)) return false;
      if (filter.priority && d.priority !== normalizeDebtPriority(filter.priority)) return false;
      if (filter.targetEntityId && d.target_entity_id !== filter.targetEntityId) return false;
      if (filter.isResolved !== undefined) {
        const resolved = [DEBT_STATUSES.PAID, DEBT_STATUSES.INVALIDATED, DEBT_STATUSES.ABANDONED].includes(d.status);
        if (resolved !== Boolean(filter.isResolved)) return false;
      }
      return true;
    }).map(d => this._cloneDebt(d));
  }

  /**
   * 获取未结清的活跃债务 (open, developing, partially_paid, deferred)
   */
  getOpenDebts() {
    return this.getAllDebts({ isResolved: false });
  }

  /**
   * 获取只读不可变事件流
   */
  getEventStream() {
    return [...this._events];
  }

  /**
   * 确定性回放重建（测试、同步或快照恢复）
   * @param {Array} events
   */
  replay(events = []) {
    this._events = [];
    this._debts.clear();
    for (const evt of events) {
      this.recordEvent(evt);
    }
    return this;
  }

  /**
   * 序列化总账状态
   */
  toJSON() {
    return {
      schemaVersion: this.schemaVersion,
      storyId: this.storyId,
      events: this._events.map(e => ({ ...e })),
      debts: Array.from(this._debts.values()).map(d => this._cloneDebt(d))
    };
  }

  /**
   * 从 JSON 恢复总账
   */
  static fromJSON(data = {}) {
    const ledger = new StoryDebtLedger({ storyId: data.storyId });
    if (Array.isArray(data.events) && data.events.length > 0) {
      ledger.replay(data.events);
    }
    return ledger;
  }

  // =========================================================================
  // 内部纯聚合状态转移状态机 (Internal Fold/Reducer)
  // =========================================================================

  _applyEvent(event) {
    const { debtId, eventType, chapterNo, evidence, notes, payload } = event;
    let debt = this._debts.get(debtId);

    if (eventType === DEBT_EVENT_TYPES.CREATED) {
      debt = {
        schemaVersion: 'debt-entity-v1',
        debt_id: debtId,
        story_id: payload.story_id || this.storyId,
        volume_id: payload.volume_id || '',
        arc_id: payload.arc_id || '',
        debt_type: payload.debt_type || DEBT_TYPES.PLOT,
        summary: payload.summary || '',
        origin_chapter_id: payload.origin_chapter_id || event.chapterId || '',
        origin_scene_id: payload.origin_scene_id || event.sceneId || '',
        target_entity_id: payload.target_entity_id || '',
        target_entity_type: payload.target_entity_type || 'character',
        created_at_chapter: Number(payload.created_at_chapter || chapterNo) || 1,
        expected_payoff_from: Number(payload.expected_payoff_from || 2),
        expected_payoff_to: Number(payload.expected_payoff_to || 6),
        priority: payload.priority || DEBT_PRIORITIES.NORMAL,
        weight: Number(payload.weight ?? 0.5),
        status: DEBT_STATUSES.OPEN,
        parent_debt_id: payload.parent_debt_id || '',
        related_debt_ids: Array.isArray(payload.related_debt_ids) ? [...payload.related_debt_ids] : [],
        creation_evidence: payload.creation_evidence || evidence || '',
        payoff_evidence: '',
        last_touched_chapter: Number(chapterNo) || Number(payload.created_at_chapter) || 1,
        created_at: event.timestamp,
        updated_at: event.timestamp,
        event_count: 1,
        resolution_notes: '',
        metadata: { ...(payload.metadata || {}) }
      };
      this._debts.set(debtId, debt);
      return debt;
    }

    if (!debt) {
      // 容错：若之前未捕获 CREATED 事件，自愈生成骨架
      debt = {
        schemaVersion: 'debt-entity-v1',
        debt_id: debtId,
        story_id: this.storyId,
        volume_id: '',
        arc_id: '',
        debt_type: DEBT_TYPES.PLOT,
        summary: payload.summary || `未知债务【${debtId}】`,
        origin_chapter_id: event.chapterId || '',
        origin_scene_id: event.sceneId || '',
        target_entity_id: '',
        target_entity_type: 'character',
        created_at_chapter: Number(chapterNo) || 1,
        expected_payoff_from: (Number(chapterNo) || 1) + 1,
        expected_payoff_to: (Number(chapterNo) || 1) + 5,
        priority: DEBT_PRIORITIES.NORMAL,
        weight: 0.5,
        status: DEBT_STATUSES.OPEN,
        parent_debt_id: '',
        related_debt_ids: [],
        creation_evidence: evidence || '',
        payoff_evidence: '',
        last_touched_chapter: Number(chapterNo) || 1,
        created_at: event.timestamp,
        updated_at: event.timestamp,
        event_count: 0,
        resolution_notes: '',
        metadata: {}
      };
      this._debts.set(debtId, debt);
    }

    debt.event_count += 1;
    debt.last_touched_chapter = Number(chapterNo) || debt.last_touched_chapter;
    debt.updated_at = event.timestamp;

    switch (eventType) {
      case DEBT_EVENT_TYPES.ESCALATED:
        if (debt.status === DEBT_STATUSES.OPEN || debt.status === DEBT_STATUSES.DEFERRED) {
          debt.status = DEBT_STATUSES.DEVELOPING;
        }
        debt.weight = Math.min(1.0, debt.weight + 0.1);
        if (payload.weight != null) debt.weight = Number(payload.weight);
        break;

      case DEBT_EVENT_TYPES.REFRAMED:
        if (payload.summary) debt.summary = String(payload.summary);
        if (payload.expected_payoff_to) debt.expected_payoff_to = Number(payload.expected_payoff_to);
        if (debt.status === DEBT_STATUSES.OPEN || debt.status === DEBT_STATUSES.DEFERRED) debt.status = DEBT_STATUSES.DEVELOPING;
        break;

      case DEBT_EVENT_TYPES.PARTIALLY_PAID:
        debt.status = DEBT_STATUSES.PARTIALLY_PAID;
        debt.payoff_evidence = debt.payoff_evidence
          ? `${debt.payoff_evidence}；第${chapterNo}章局部兑现：${evidence || notes}`
          : (evidence || notes);
        break;

      case DEBT_EVENT_TYPES.PAID:
        debt.status = DEBT_STATUSES.PAID;
        debt.payoff_evidence = debt.payoff_evidence
          ? `${debt.payoff_evidence}；最终偿还证据：${evidence || notes}`
          : (evidence || notes);
        debt.resolution_notes = notes || '正常闭环回收';
        break;

      case DEBT_EVENT_TYPES.DEFERRED:
        debt.status = DEBT_STATUSES.DEFERRED;
        if (payload.deferUntilChapter) {
          debt.expected_payoff_to = Number(payload.deferUntilChapter);
        } else {
          debt.expected_payoff_to = Math.max(debt.expected_payoff_to, (Number(chapterNo) || 1) + 5);
        }
        break;

      case DEBT_EVENT_TYPES.INVALIDATED:
        debt.status = DEBT_STATUSES.INVALIDATED;
        debt.resolution_notes = notes || '因果被前置剧情推翻失效';
        break;

      case DEBT_EVENT_TYPES.ABANDONED:
        debt.status = DEBT_STATUSES.ABANDONED;
        debt.resolution_notes = notes || '创作放弃';
        break;
    }

    return debt;
  }

  _cloneDebt(debt) {
    return JSON.parse(JSON.stringify(debt));
  }
}

module.exports = {
  StoryDebtLedger
};
