'use strict';

/**
 * @file index.js
 * 叙事债务总账系统统一导出模块 (Story Debt Subsystem Entry)
 */

const {
  DEBT_TYPES,
  DEBT_TYPE_DESCRIPTIONS,
  DEBT_STATUSES,
  DEBT_STATUS_DESCRIPTIONS,
  DEBT_EVENT_TYPES,
  DEBT_PRIORITIES,
  TERMINAL_DEBT_STATUSES,
  ALLOWED_TRANSITIONS,
  StateTransitionRejectedError,
  resolveTargetStatus,
  normalizeDebtType,
  normalizeDebtStatus,
  normalizeDebtPriority,
  normalizeDebtEventType
} = require('./debt-types');

const { createDebtEvent } = require('./debt-event');
const { StoryDebtLedger } = require('./story-debt-ledger');
const { projectDebtsForChapter } = require('./debt-projection');
const { reconcileChapterDebts } = require('./debt-reconciliation');

module.exports = {
  StoryDebtLedger,
  createDebtEvent,
  projectDebtsForChapter,
  reconcileChapterDebts,
  DEBT_TYPES,
  DEBT_TYPE_DESCRIPTIONS,
  DEBT_STATUSES,
  DEBT_STATUS_DESCRIPTIONS,
  DEBT_EVENT_TYPES,
  DEBT_PRIORITIES,
  TERMINAL_DEBT_STATUSES,
  ALLOWED_TRANSITIONS,
  StateTransitionRejectedError,
  resolveTargetStatus,
  normalizeDebtType,
  normalizeDebtStatus,
  normalizeDebtPriority,
  normalizeDebtEventType
};
