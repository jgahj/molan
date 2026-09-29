'use strict';

const BASE_PROFILES = Object.freeze({
  '玄幻': { narrativeMode: '成长与世界探索', pacing: 'rising-release', payoffPolicy: { combat: true, loot: true, relationship: true, mystery: false }, requireConflict: true },
  '都市': { narrativeMode: '现实目标与关系变化', pacing: 'variable', payoffPolicy: { combat: false, loot: false, relationship: true, mystery: false }, requireConflict: false },
  '悬疑': { narrativeMode: '线索递进与认知反转', pacing: 'clue-escalation', payoffPolicy: { combat: false, loot: false, relationship: false, mystery: true }, requireConflict: true },
  '历史': { narrativeMode: '时代约束下的人物选择', pacing: 'measured', payoffPolicy: { combat: false, loot: false, relationship: true, mystery: false }, requireConflict: false },
  '言情': { narrativeMode: '关系变化与情感兑现', pacing: 'emotional-arc', payoffPolicy: { combat: false, loot: false, relationship: true, mystery: false }, requireConflict: false },
  '科幻': { narrativeMode: '设定后果与人物选择', pacing: 'escalating', payoffPolicy: { combat: false, loot: false, relationship: true, mystery: true }, requireConflict: false },
  '西幻': { narrativeMode: '异域规则与旅程推进', pacing: 'quest-arc', payoffPolicy: { combat: true, loot: false, relationship: true, mystery: false }, requireConflict: true },
  '轻小说': { narrativeMode: '人物互动与事件回合', pacing: 'episodic', payoffPolicy: { combat: false, loot: false, relationship: true, mystery: false }, requireConflict: false },
  '通用': { narrativeMode: '现实推进与戏剧交互', pacing: 'balanced', payoffPolicy: { combat: false, loot: false, relationship: true, mystery: false }, requireConflict: false },
  'universal': { narrativeMode: '现实推进与戏剧交互', pacing: 'balanced', payoffPolicy: { combat: false, loot: false, relationship: true, mystery: false }, requireConflict: false }
});

/** 建立题材预算与审计策略，使爽点规则仅作用于适配题材。 */
function buildGenreProfile(input = {}) {
  const genre = String(input.genre || '').trim();
  const base = BASE_PROFILES[genre];
  if (!base) return { status: 'needs_choice', genre, candidates: Object.keys(BASE_PROFILES) };
  const targetChars = Math.max(300, Number(input.targetChars) || 2800);
  return {
    status: 'resolved', genre, subgenre: String(input.subgenre || ''),
    narrativeMode: base.narrativeMode, pov: String(input.pov || 'third-limited'), tone: String(input.tone || ''),
    pacing: base.pacing, payoffPolicy: { ...base.payoffPolicy, ...(input.payoffPolicy || {}) },
    auditPolicy: { requireExternalEvent: false, requireConflict: base.requireConflict, requireInformationChange: true },
    budgetProfile: { targetChars, minChars: Math.round(targetChars * 0.78), maxChars: Math.round(targetChars * 1.22) }
  };
}

module.exports = { BASE_PROFILES, buildGenreProfile };
