'use strict';

/**
 * @file debt-event.js
 * 叙事债务不可变事件模型 (Narrative Debt Event Model)
 * 
 * 核心设计原则：
 * 1. 债务状态不是随手覆写的标量字段，必须通过 Append-only 事件序列推进；
 * 2. 每个事件包含真实的章节事实证据 (evidence) 与审计推理理由 (notes)；
 * 3. 支撑“确定性审计”：能明确回答“这个伏笔为什么在此刻被认为已经回收？”
 */

const crypto = require('node:crypto');
const { normalizeDebtEventType } = require('./debt-types');

function generateEventId() {
  const rand = crypto.randomBytes(4).toString('hex');
  return `dbevt_${Date.now()}_${rand}`;
}

/**
 * 创建不可变债务事件
 * @param {Object} input
 * @returns {Object} 冻结的 DebtEvent 实体
 */
function createDebtEvent(input = {}) {
  const debtId = String(input.debtId || input.debt_id || '').trim();
  if (!debtId) {
    throw new TypeError('DebtEvent 必须具备 debtId');
  }

  const eventType = normalizeDebtEventType(input.eventType || input.event_type || 'CREATED');
  const eventId = String(input.eventId || input.event_id || generateEventId()).trim();

  let idempotencyKey = null;
  const rawIdempotencyKey = input.idempotencyKey ?? input.idempotency_key;
  if (rawIdempotencyKey !== undefined && rawIdempotencyKey !== null) {
    idempotencyKey = String(rawIdempotencyKey).trim();
    if (!idempotencyKey) {
      throw new TypeError('DebtEvent idempotencyKey 不能为空字符串');
    }
  }

  const chapterId = String(input.chapterId || input.chapter_id || '').trim();
  const chapterNo = Number(input.chapterNo ?? input.chapter_no ?? input.chapter ?? 0) || 0;
  const sceneId = String(input.sceneId || input.scene_id || '').trim();
  const evidence = String(input.evidence || input.creation_evidence || input.payoff_evidence || '').trim();
  const notes = String(input.notes || input.reason || '').trim();
  const operator = String(input.operator || 'system').trim();
  const timestamp = input.timestamp ? new Date(input.timestamp).toISOString() : new Date().toISOString();
  const payload = (typeof input.payload === 'object' && input.payload !== null)
    ? { ...input.payload }
    : {};

  const event = {
    schemaVersion: 'debt-event-v1',
    eventId,
    idempotencyKey,
    debtId,
    eventType,
    chapterId,
    chapterNo,
    sceneId,
    evidence,
    notes,
    operator,
    payload: Object.freeze(payload),
    timestamp
  };

  return Object.freeze(event);
}

module.exports = {
  createDebtEvent
};
