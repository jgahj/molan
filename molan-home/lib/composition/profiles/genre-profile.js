'use strict';

/**
 * @file genre-profile.js
 * 题材核心 Profile 契约模型 (Genre Profile)
 * 
 * 核心设计原则：
 * 1. 题材彻底脱离文风、角色人设与特定剧情走向；
 * 2. 严格定义 forbiddenAssumptions（禁止越权假设），从数据模型层切断对主角性别、姓名、金手指系统或固定人设的绑架；
 * 3. 产出正交的题材世界观与冲突驱动策略（Genre Policy）。
 */

const DEFAULT_FORBIDDEN_ASSUMPTIONS = Object.freeze([
  '严禁预设主角的特定性别、姓名、身份或开局性格',
  '严禁强制预设机械降神系统、开局老爷爷或特定金手指',
  '严禁强制预设后宫、无情道或单一感情线模式',
  '严禁强制敌对角色全员脸谱化降智或机械叫嚣'
]);

/**
 * 校验并创建合规的 GenreProfile 实体
 * @param {Object} options
 * @returns {Object} 冻结的 GenreProfile 实体
 */
function createGenreProfile(options = {}) {
  const input = options || {};
  const id = String(input.id || '').trim();
  const name = String(input.name || '').trim();
  const family = String(input.family || 'universal').trim();

  if (!id) {
    throw new TypeError('GenreProfile 必须具备唯一 id');
  }
  if (!name) {
    throw new TypeError('GenreProfile 必须具备人类可读 name');
  }

  const background = Array.isArray(input.background)
    ? input.background.map(String).filter(Boolean)
    : [];
  const coreConflicts = Array.isArray(input.coreConflicts)
    ? input.coreConflicts.map(String).filter(Boolean)
    : [];
  const readerPromises = Array.isArray(input.readerPromises)
    ? input.readerPromises.map(String).filter(Boolean)
    : [];
  const commonStoryEngines = Array.isArray(input.commonStoryEngines)
    ? input.commonStoryEngines.map(String).filter(Boolean)
    : [];

  const rawForbidden = Array.isArray(input.forbiddenAssumptions)
    ? input.forbiddenAssumptions.map(String).filter(Boolean)
    : [];
  const forbiddenAssumptions = Array.from(new Set([...DEFAULT_FORBIDDEN_ASSUMPTIONS, ...rawForbidden]));

  const profile = {
    schemaVersion: 'genre-profile-v1',
    id,
    name,
    family,
    background,
    coreConflicts,
    readerPromises,
    commonStoryEngines,
    forbiddenAssumptions,
    description: String(input.description || ''),
    mechanisms: Array.isArray(input.mechanisms) ? input.mechanisms.map(String) : [],
    metadata: typeof input.metadata === 'object' && input.metadata !== null ? { ...input.metadata } : {}
  };

  return Object.freeze(profile);
}

/**
 * 检查给定指令或上下文是否存在违禁的角色人设越权假设
 * @param {string|Object} textOrObject
 * @param {Object} profile
 * @returns {{ passed: boolean, violations: string[] }}
 */
function checkForbiddenAssumptions(textOrObject, profile) {
  const text = typeof textOrObject === 'string'
    ? textOrObject
    : JSON.stringify(textOrObject || {});
  
  const violations = [];
  const p = profile || {};
  const forbidden = Array.isArray(p.forbiddenAssumptions) ? p.forbiddenAssumptions : DEFAULT_FORBIDDEN_ASSUMPTIONS;

  // 严防硬编码角色名与机械降神套话侵入题材层
  if (/佳云泽|顾凝欣|叶天|萧炎|林动|楚风/i.test(text) && !/【已知书本角色】/.test(text)) {
    violations.push('检测到侵入题材层的硬编码预设角色姓名');
  }

  return {
    passed: violations.length === 0,
    violations
  };
}

/**
 * 编译为无污染的题材策略指令块 (Genre Policy Directive)
 * @param {Object} profile
 * @returns {string}
 */
function compileGenrePolicy(profile) {
  if (!profile) return '';
  const lines = [
    `【题材策略·${profile.name}】`,
    profile.background.length ? `世界观底层基石：${profile.background.join('、')}` : '',
    profile.coreConflicts.length ? `核心矛盾类型：${profile.coreConflicts.join('、')}` : '',
    profile.readerPromises.length ? `读者阅读契约与反馈：${profile.readerPromises.join('、')}` : '',
    profile.forbiddenAssumptions.length
      ? `【题材边界绝不假定】：\n${profile.forbiddenAssumptions.map(item => `· ${item}`).join('\n')}`
      : ''
  ].filter(Boolean);

  return lines.join('\n');
}

module.exports = {
  createGenreProfile,
  checkForbiddenAssumptions,
  compileGenrePolicy,
  DEFAULT_FORBIDDEN_ASSUMPTIONS
};
