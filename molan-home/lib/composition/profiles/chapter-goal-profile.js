'use strict';

/**
 * @file chapter-goal-profile.js
 * 章节目标核心 Profile 契约模型 (Chapter Goal Profile)
 * 
 * 核心设计原则：
 * 1. 拒绝干瘪的标签名称，建立【状态变化模型 (State Delta)】；
 * 2. 必须明确回答四要素：章前状态、章后状态、读者收益、删除失效检验；
 * 3. 产出强约束的章节驱动策略（Chapter Objective Policy）。
 */

const { createNarrativeOutcomeContract } = require('../models/data-schemas');

/**
 * 规范化并校验 State Delta 结构
 * @param {Object} rawDelta
 * @returns {Object} 规范化的 State Delta
 */
function normalizeStateDelta(rawDelta = {}) {
  const input = rawDelta || {};
  return {
    stateBefore: typeof input.stateBefore === 'object' && input.stateBefore !== null
      ? { ...input.stateBefore }
      : { summary: String(input.stateBefore || '初始平衡状态') },
    events: Array.isArray(input.events)
      ? input.events.map(String).filter(Boolean)
      : (input.events ? [String(input.events)] : []),
    stateAfter: typeof input.stateAfter === 'object' && input.stateAfter !== null
      ? { ...input.stateAfter }
      : { summary: String(input.stateAfter || '达成不可逆推进状态') },
    invalidIfRemoved: String(input.invalidIfRemoved || '后续剧情因果链条断裂').trim()
  };
}

/**
 * 创建合规的 ChapterGoalProfile 实体
 * @param {Object} options
 * @returns {Object} 冻结的 ChapterGoalProfile 实体
 */
function createChapterGoalProfile(options = {}) {
  const input = options || {};
  const id = String(input.id || '').trim();
  const name = String(input.name || '').trim();

  if (!id) throw new TypeError('ChapterGoalProfile 必须具备唯一 id');
  if (!name) throw new TypeError('ChapterGoalProfile 必须具备人类可读 name');

  const readerEffect = Array.isArray(input.readerEffect)
    ? input.readerEffect.map(String).filter(Boolean)
    : (input.readerEffect && typeof input.readerEffect === 'object' ? [input.readerEffect.knowledgeDelta || input.readerEffect.emotionalShift].filter(Boolean) : []);
  const mustHave = Array.isArray(input.mustHave)
    ? input.mustHave.map(String).filter(Boolean)
    : [];
  const mustNot = Array.isArray(input.mustNot)
    ? input.mustNot.map(String).filter(Boolean)
    : [];

  const defaultStateDelta = normalizeStateDelta(input.defaultStateDelta || input.outcomeContract?.stateDelta);
  const outcomeContract = input.outcomeContract ? createNarrativeOutcomeContract(input.outcomeContract) : null;

  const profile = {
    schemaVersion: 'chapter-goal-profile-v2',
    id,
    name,
    category: String(input.category || 'plot'),
    readerEffect,
    mustHave,
    mustNot,
    defaultStateDelta,
    outcomeContract,
    characterEffect: input.characterEffect && typeof input.characterEffect === 'object' ? { ...input.characterEffect } : null,
    description: String(input.description || ''),
    metadata: typeof input.metadata === 'object' && input.metadata !== null ? { ...input.metadata } : {}
  };

  return Object.freeze(profile);
}

/**
 * 编译章节目标策略指令块 (Chapter Goal Policy Directive)
 * @param {Object} profile 
 * @param {Object} activeDelta 当前章节传入的实例化状态跃迁或完整 Outcome Contract
 * @returns {string}
 */
function compileGoalPolicy(profile, activeDelta = null) {
  if (!profile) return '';
  const input = activeDelta || {};
  const delta = (input.stateDelta || input.stateBefore || input.events || input.stateAfter)
    ? normalizeStateDelta(input.stateDelta || input)
    : profile.defaultStateDelta;

  const characterEffect = input.characterEffect || profile.characterEffect || null;
  const rawReader = input.readerEffect || profile.readerEffect || [];
  const readerTexts = Array.isArray(rawReader)
    ? rawReader.map(String).filter(Boolean)
    : [rawReader.knowledgeDelta, rawReader.emotionalShift, rawReader.curiosityTrigger].filter(Boolean);

  function formatState(val) {
    if (typeof val === 'string') return val;
    if (val && typeof val === 'object') {
      if (typeof val.summary === 'string') return val.summary;
      return JSON.stringify(val);
    }
    return String(val || '');
  }

  const lines = [
    `【本章核心目标·${profile.name}】`,
    `读者阅读收益目标：${readerTexts.join('、') || '推进核心剧情与获得信息'}`,
    '【状态跃迁契约 (State Delta)】：',
    `· 章前状态：${formatState(delta.stateBefore)}`,
    delta.events.length ? `· 推进事件：${delta.events.join(' -> ')}` : '',
    `· 章后状态：${formatState(delta.stateAfter)}`,
    `· 存在性检验：若删除本章，必须导致【${delta.invalidIfRemoved}】失效！`
  ];

  if (characterEffect && (characterEffect.beliefShift || characterEffect.motivationDelta)) {
    lines.push('【人物信念与内在位移 (Character Shift)】：');
    if (characterEffect.beliefShift) lines.push(`· 认知/信念裂痕：${characterEffect.beliefShift}`);
    if (characterEffect.motivationDelta) lines.push(`· 动机转变：${characterEffect.motivationDelta}`);
    if (characterEffect.internalStakes) lines.push(`· 心理代价：${characterEffect.internalStakes}`);
  }

  if (profile.mustHave && profile.mustHave.length) {
    lines.push(`必须达成的关键要素：\n${profile.mustHave.map(m => `· ${m}`).join('\n')}`);
  }
  if (profile.mustNot && profile.mustNot.length) {
    lines.push(`严厉禁止的违规形式：\n${profile.mustNot.map(m => `· ${m}`).join('\n')}`);
  }

  return lines.join('\n');
}

module.exports = {
  createChapterGoalProfile,
  normalizeStateDelta,
  compileGoalPolicy
};
