'use strict';

const { GenerationError } = require('./errors');

const TRANSITIONS = Object.freeze({
  created: ['request_validated', 'paused', 'cancel_requested', 'failed'],
  request_validated: ['genre_resolved', 'waiting_author', 'needs_human', 'paused', 'failed', 'cancel_requested'],
  genre_resolved: ['style_resolved', 'waiting_author', 'paused', 'failed', 'cancel_requested'],
  style_resolved: ['context_built', 'waiting_author', 'paused', 'failed', 'cancel_requested'],
  context_built: ['contract_validated', 'paused', 'failed', 'cancel_requested'],
  contract_validated: ['pre_generation_guard', 'paused', 'failed', 'cancel_requested'],
  pre_generation_guard: ['scene_planning', 'generating', 'paused', 'needs_human', 'failed', 'cancel_requested'],
  scene_planning: ['generating', 'paused', 'failed', 'cancel_requested'],
  generating: ['draft_received', 'paused', 'cancel_requested', 'provider_unknown', 'failed'],
  draft_received: ['deterministic_audit', 'failed', 'cancel_requested'],
  deterministic_audit: ['semantic_audit', 'revision', 'rejected', 'needs_human', 'provider_unknown', 'cancel_requested'],
  semantic_audit: ['quality_audit', 'revision', 'waiting_author', 'needs_human', 'provider_unknown', 'cancel_requested'],
  quality_audit: ['revision', 'committing', 'waiting_author', 'needs_human', 'provider_unknown', 'rejected', 'cancel_requested'],
  revision: ['deterministic_audit', 'waiting_author', 'needs_human', 'provider_unknown', 'rejected', 'cancel_requested'],
  waiting_author: ['revision', 'committing', 'cancelled'],
  committing: ['committed', 'waiting_author', 'provider_unknown', 'failed'],
  cancel_requested: ['cancelled', 'provider_unknown'],
  paused: ['created', 'cancelled'],
  needs_human: ['revision', 'committing', 'cancelled'],
  committed: [],
  cancelled: [],
  failed: [],
  provider_unknown: [],
  rejected: []
});

const TERMINAL_STATES = new Set(['committed', 'cancelled', 'failed', 'provider_unknown', 'rejected']);

/** 只允许服务端预定义的任务状态迁移。 */
function transition(run, nextState, now = Date.now()) {
  const current = String(run && run.state || '');
  const next = String(nextState || '');
  if (!Object.hasOwn(TRANSITIONS, current) || !TRANSITIONS[current].includes(next)) {
    throw new GenerationError('INVALID_STATE_TRANSITION', `${current || 'unknown'} -> ${next || 'unknown'}`, { status: 409 });
  }
  return { ...run, state: next, updatedAt: Number(now) || Date.now() };
}

/** 判断任务状态是否已经结束且不得再次调度。 */
function isTerminal(state) {
  return TERMINAL_STATES.has(String(state || ''));
}

module.exports = { TRANSITIONS, TERMINAL_STATES, transition, isTerminal };
