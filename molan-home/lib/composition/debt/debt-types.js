'use strict';

/**
 * @file debt-types.js
 * 叙事债务核心枚举与类型规约 (Story Debt Types & Statuses)
 * 
 * 核心设计原则：
 * 1. 统一 7 维底层叙事债务类型，覆盖剧情、钩子、人物、信息、关系、世界观与读者预期；
 * 2. 债务非静态字段，具备 7 阶段完整生命周期状态；
 * 3. 采用 Append-only 事件类型驱动状态跃迁，杜绝无因果凭据的直接字段篡改；
 * 4. 保持向前兼容，支持旧版 (plot_debt, active 等) 别名平滑映射。
 */

const DEBT_TYPES = Object.freeze({
  PLOT: 'plot',
  HOOK: 'hook',
  CHARACTER: 'character',
  INFORMATION: 'information',
  RELATIONSHIP: 'relationship',
  WORLD: 'world',
  READER_EXPECTATION: 'reader_expectation',
  READER_PROMISE: 'reader_expectation'
});

const DEBT_TYPE_DESCRIPTIONS = Object.freeze({
  plot: '剧情承诺还没完成（主线/支线剧情事件、行动推进、契约与任务）',
  hook: '章节钩子尚未兑现（章末悬念、危机切断、即时/短线刺激）',
  character: '人物异常行为、心理变化、承诺尚未解释或兑现（行为反常、隐瞒真相、誓言）',
  information: '读者知道出现了信息缺口，但答案还没给（物证矛盾、身份疑云、情报残缺）',
  relationship: '两个人关系发生异常变化，需要后续处理（结怨、倒戈、生隙、试探）',
  world: '世界规则、设定、历史信息留下的未解释问题（禁地异动、天道反常、古史残卷）',
  reader_expectation: '读者预期债务（如宗门大比、宿命决战、重大重逢等已建立的强期待承诺）'
});

const DEBT_STATUSES = Object.freeze({
  OPEN: 'open',
  DEVELOPING: 'developing',
  PARTIALLY_PAID: 'partially_paid',
  PROPOSED_RESOLUTION: 'proposed_resolution',
  PAID: 'paid',
  DEFERRED: 'deferred',
  INVALIDATED: 'invalidated',
  ABANDONED: 'abandoned'
});

const DEBT_STATUS_DESCRIPTIONS = Object.freeze({
  open: '已建立未解决（处于待触发或初期潜伏状态）',
  developing: '加深/推进中（已通过新章节事件升级或复杂化）',
  partially_paid: '部分兑现/部分解释（核心谜底揭开局部，仍有余波）',
  proposed_resolution: '已提出候选解决方案（由正文启发式匹配检出，待显式声明或形式语义验证确认）',
  paid: '已偿还/已闭环（伏笔回收、钩子兑现、承诺履行）',
  deferred: '延期兑现（因主线剧情转移调整兑现窗口）',
  invalidated: '已失效（剧情前提或因果已被不可逆事件打破）',
  abandoned: '已放弃（由作者或编剧战略性砍线，留存审计备忘）'
});

const DEBT_EVENT_TYPES = Object.freeze({
  CREATED: 'CREATED',
  ESCALATED: 'ESCALATED',
  REFRAMED: 'REFRAMED',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PROPOSED_RESOLUTION: 'PROPOSED_RESOLUTION',
  PAID: 'PAID',
  DEFERRED: 'DEFERRED',
  INVALIDATED: 'INVALIDATED',
  ABANDONED: 'ABANDONED'
});

const DEBT_PRIORITIES = Object.freeze({
  CRITICAL: 'critical',
  HIGH: 'high',
  NORMAL: 'normal',
  LOW: 'low'
});

const TYPE_ALIAS_MAP = Object.freeze({
  plot: 'plot',
  plot_debt: 'plot',
  hook: 'hook',
  hook_debt: 'hook',
  character: 'character',
  character_debt: 'character',
  information: 'information',
  info: 'information',
  info_debt: 'information',
  information_debt: 'information',
  relationship: 'relationship',
  relationship_debt: 'relationship',
  world: 'world',
  world_debt: 'world',
  reader_expectation: 'reader_expectation',
  reader_promise: 'reader_expectation',
  reader_promise_debt: 'reader_expectation',
  expectation: 'reader_expectation'
});

const STATUS_ALIAS_MAP = Object.freeze({
  open: 'open',
  active: 'open',
  developing: 'developing',
  deepened: 'developing',
  escalated: 'developing',
  partially_paid: 'partially_paid',
  partially_resolved: 'partially_paid',
  proposed_resolution: 'proposed_resolution',
  proposed: 'proposed_resolution',
  candidate_resolution: 'proposed_resolution',
  paid: 'paid',
  resolved: 'paid',
  deferred: 'deferred',
  postponed: 'deferred',
  invalidated: 'invalidated',
  abandoned: 'abandoned'
});

const PRIORITY_ALIAS_MAP = Object.freeze({
  critical: 'critical',
  urgent: 'critical',
  p0: 'critical',
  high: 'high',
  p1: 'high',
  normal: 'normal',
  p2: 'normal',
  medium: 'normal',
  low: 'low',
  p3: 'low'
});

/**
 * 规范化债务类型
 * @param {string} type
 * @returns {string} 7 维核心债务类型之一
 */
function normalizeDebtType(type) {
  const key = String(type || '').trim().toLowerCase();
  return TYPE_ALIAS_MAP[key] || DEBT_TYPES.PLOT;
}

/**
 * 规范化债务生命周期状态
 * @param {string} status
 * @returns {string} 7 阶段状态之一
 */
function normalizeDebtStatus(status) {
  const key = String(status || '').trim().toLowerCase();
  return STATUS_ALIAS_MAP[key] || DEBT_STATUSES.OPEN;
}

/**
 * 规范化债务优先级
 * @param {string} priority
 * @returns {string}
 */
function normalizeDebtPriority(priority) {
  const key = String(priority || '').trim().toLowerCase();
  return PRIORITY_ALIAS_MAP[key] || DEBT_PRIORITIES.NORMAL;
}

/**
 * 校验债务事件类型
 * @param {string} eventType
 * @returns {string}
 */
function normalizeDebtEventType(eventType) {
  let key = String(eventType || '').trim().toUpperCase();
  if (key === 'PROPOSED') key = 'PROPOSED_RESOLUTION';
  if (!DEBT_EVENT_TYPES[key]) {
    throw new TypeError(`非法的债务事件类型: ${eventType}。有效类型为: ${Object.keys(DEBT_EVENT_TYPES).join(', ')}`);
  }
  return key;
}

module.exports = {
  DEBT_TYPES,
  DEBT_TYPE_DESCRIPTIONS,
  DEBT_STATUSES,
  DEBT_STATUS_DESCRIPTIONS,
  DEBT_EVENT_TYPES,
  DEBT_PRIORITIES,
  normalizeDebtType,
  normalizeDebtStatus,
  normalizeDebtPriority,
  normalizeDebtEventType
};
