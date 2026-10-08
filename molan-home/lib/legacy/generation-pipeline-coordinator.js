'use strict';

/**
 * @deprecated
 * ⚠️【历史组件说明 / DEPRECATED】
 * 本文件为战役实验期使用的管线调度器。
 * 当前生产生成主链路已完全统一收敛至：
 * 1. 唯一业务状态机：lib/generation/state-machine.js
 * 2. 唯一生产编排器：lib/generation/orchestrator.js
 * 3. 唯一正文起草引擎：lib/generation/content-engine.js
 * 生产入口（server.js /api/generation-runs）严禁调用本模块。
 * 本模块禁止作为通用生产链调用，仅保留历史兼容。
 */

const fs = require('node:fs');
const path = require('node:path');
const { planScenes, compileSceneDirectives, evaluateChapterCapacity, partitionChapterEvents } = require('../scene-planner');
const { compileCharacterStateDirectives, getDynamicCharacterContext } = require('../character-state-adapter');
const { evaluateClimaxShockGate, generateMicroPatchPrompt } = require('../genre-narrative-audit');
const { PipelineCoordinator, PIPELINE_STATES, parseDecoupledStream, applyHunkPatch } = require('./pipeline-coordinator');
const { validateEntityTreeConsistency, compileStoryBiblePrompt } = require('../story-bible-schema');
const { evaluateUnifiedQuality } = require('../quality/unified-quality-gate');
const { legacyUsageTelemetry } = require('./legacy-telemetry');


/**
 * 结构化实体关系图谱与规则校验器 (Entity Graph & Prop Consistency Guard)
 * 根治 DEF-CONSIST-001: 解决自然语言导致的多角色代际混淆与道具操作矛盾
 */
const ENTITY_RELATION_SCHEMA = Object.freeze({
  validateEntityRelations: (entities = {}) => {
    const warnings = [];
    const relations = entities.relations || [];

    // 检查祖辈与母辈代际冲突 (如 地姥 vs 姑射云琉 vs 姑射静)
    for (const r of relations) {
      if (r.subject === '张若尘' && r.predicate === '女婿' && r.object === '地姥') {
        warnings.push('实体代际严重冲突：地姥为罗祖云山界老祖宗，张若尘婚约为天阁目（姑射静），不可称为“地姥的女婿”！');
      }
    }
    return { valid: warnings.length === 0, warnings };
  },

  compileStructuredEntityPrompt: (entityConfig = {}) => {
    const lines = [
      '### 【确定性实体关系图谱 (Entity Graph Enforced - DEF-CONSIST-001)】',
      '- 代际防混淆规范：',
      '  * 【老祖宗】：地姥（罗祖云山界最高战力，神灵与神尊皆敬畏，说一不二）。',
      '  * 【母神】：姑射云琉（云琉神殿之主，姑射静之母神）。',
      '  * 【天阁目】：姑射静（姑射云琉之女，元会级大圣，地姥指婚对象）。',
      '  * 【张若尘身份】：若宣扬婚事，只能称为“天阁目的夫婿”或“云琉神殿的姑爷”，【绝对严禁写成地姥女婿】！',
      '- 道具状态机规范：',
      '  * 《天魔石刻》/《天魔贪狼图》：借给姑射静观悟，以日晷延长时间。',
      '  * 魔窟镇物（黑晶）：【张若尘两手空空】，未带走镇物，表明不抢宝不杀人的行事界线。'
    ];
    return lines.join('\n');
  }
});

// parseDecoupledStream 统一由 ./pipeline-coordinator 提供并复用


/**
 * 组装经过全能架构升级强化的终极生产 Prompt
 * 整合：分场景切片 + 转场契约 + 人物情绪弱点 + 实体图谱 + 物理抗阻门禁
 */
function assembleUpgradedGenerationPrompt(rawPrompt, options = {}) {
  legacyUsageTelemetry.record('generation-pipeline-coordinator', { action: 'assembleUpgradedGenerationPrompt' });
  const targetWordCount = options.targetWordCount || 2400;

  // 1. 提取或解析大纲节点
  const nodeMatches = [...rawPrompt.matchAll(/(?:^|\n|[；;])\s*(?:(\d+|[一二三四五六七八九十]+)[.、：:]|节点[一二三四五六七八九十\d]+[：:])\s*([^；;\n]+)/g)];
  const nodes = nodeMatches.length > 0
    ? nodeMatches.map(m => m[2].trim())
    : [
        '张若尘高调游历故意惹事强闯魔窟',
        '姑射静被迫当救火队长从神灵手中救回',
        '伪神设宴抢着结拜',
        '姑射静向母神抱怨，母神点破逼退婚算计',
        '三日后，张若尘主动找姑射静借出天魔石刻并开日晷助悟',
        '张若尘对木灵希吐露真实目的是月圆夜见蚩刑天，次日必须离开'
      ];

  // 2. 战役一：Scene Planner 切片与转场桥梁
  const planResult = planScenes(nodes, { targetWordCount });
  const sceneDirectives = compileSceneDirectives(planResult);

  // 3. 战役二：Character State Adapter 动态情绪与人味弱点
  const characters = [
    { name: '张若尘', role: '主角，俗世神话，十界之战胜者' },
    { name: '姑射静', role: '天阁目，元会级天才' }
  ];
  const characterDirectives = compileCharacterStateDirectives(characters, { dangerLevel: 'high' });

  // 4. 战役三：Genre Narrative Audit 物理受创指令
  const somaticDirective = [
    '### 【战斗感官物理抗阻与通感门禁 (Climax Shock Gate - DEF-DESC-001)】',
    '- 神灵威压与高潮交锋规范：',
    '  * 当神灵大手突袭或威压临空时，【严禁轻描淡写两句带过】！',
    '  * 必须调用骨骼微鸣、重力形变、肌肉抗阻、气流狂啸、地面龟裂下陷等微观物理受力细节；',
    '  * 写出千钧一发的窒息阻力感与境界天堑，让读者产生切实的肉体紧张与临场震撼。'
  ].join('\n');

  // 5. 战役四：结构化实体图谱防混淆
  const entityDirectives = ENTITY_RELATION_SCHEMA.compileStructuredEntityPrompt();

  // 6. 组装全量强化 Prompt
  const assembledPrompt = [
    rawPrompt.trim(),
    '',
    '======================================================================',
    '🛡️ 以下为墨阑架构升级核心门禁指令（最高优先级执行，严禁违反）：',
    '======================================================================',
    '',
    entityDirectives,
    '',
    sceneDirectives,
    '',
    characterDirectives,
    '',
    somaticDirective,
    '',
    '======================================================================'
  ].join('\n');

  return {
    assembledPrompt,
    planResult,
    capacity: planResult.capacity,
    scenesCount: planResult.scenes.length
  };
}

/**
 * 执行闭环生成后质检审计 (Post-Generation Audit Loop)
 * @param {string} chapterText 生成的正文文本
 * @param {Object} context 审核上下文
 * @returns {Object} 门禁审计结果
 */
function auditGeneratedChapter(chapterText, context = {}) {
  legacyUsageTelemetry.record('generation-pipeline-coordinator', { action: 'auditGeneratedChapter' });
  const genre = context.genre || '通用';
  const contract = {
    isClimax: true,
    emotionIntensity: 8,
    ...context
  };

  const unified = evaluateUnifiedQuality(chapterText, { genre, contract, ...context });

  // 1. 物理冲击与感官受创门禁审核 (DEF-DESC-001)
  const climaxGate = evaluateClimaxShockGate(chapterText, contract, genre);

  // 2. 实体关系校验 (DEF-CONSIST-001)
  const mentionsWrongRelationship = /(地姥女婿|地姥的女婿)/.test(chapterText);
  const mentionsContradictoryCrystal = /(拿着黑晶.*两手空空|放回.*又拿走)/.test(chapterText);
  const entityPassed = !mentionsWrongRelationship && !mentionsContradictoryCrystal;

  // 3. 时空硬切违规检测 (DEF-PACING-001)
  const abruptTimeJump = /(?:。|”)\s*三日后，/.test(chapterText);

  const passed = climaxGate.passed && entityPassed && unified.passed;

  return {
    passed,
    qualityGate: unified,
    climaxShockAudit: climaxGate,
    entityConsistencyAudit: {
      passed: entityPassed,
      mentionsWrongRelationship,
      mentionsContradictoryCrystal
    },
    transitionAudit: {
      hasAbruptJump: abruptTimeJump,
      note: abruptTimeJump ? '检出时空硬切，建议强化转场过渡句' : '转场平滑'
    }
  };
}

module.exports = {
  legacyUsageTelemetry,
  ENTITY_RELATION_SCHEMA,
  PIPELINE_STATES,
  PipelineCoordinator,
  parseDecoupledStream,
  applyHunkPatch,
  assembleUpgradedGenerationPrompt,
  auditGeneratedChapter,
  evaluateChapterCapacity,
  partitionChapterEvents,
  planScenes,
  compileSceneDirectives,
  compileCharacterStateDirectives,
  getDynamicCharacterContext,
  evaluateClimaxShockGate,
  generateMicroPatchPrompt,
  validateEntityTreeConsistency,
  compileStoryBiblePrompt
};

