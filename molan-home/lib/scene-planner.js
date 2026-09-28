'use strict';

/**
 * scene-planner.js
 * ---------------------------------------------------------------------------
 * 分场景规划器 (Scene Planner & Pacing Budgeting Engine)
 *
 * 核心设计目标：
 * 1. 根治 DEF-PACING-001：时空硬切生硬问题。在场景切换处检测时空跳跃，强制注入
 *    转场过渡桥梁契约（Transition Bridge Contract），杜绝“三日后”等孤立硬切；
 * 2. 根治 DEF-PACING-002：全篇紧绷无呼吸留白问题。实现单章戏剧容量门禁与
 *    呼吸留白预算分配（Downtime Budgeting），确保 10~15% 的舒缓沉淀空间；
 * 3. 衔接大纲（Planner）与生成（Writer），将扁平大纲切片为具备明确进出条件、
 *    镜头类型与感官锚点的结构化场景契约。
 * ---------------------------------------------------------------------------
 */

const fs = require('node:fs');
const path = require('node:path');

// 时空跳跃识别正则
const TEMPORAL_JUMP_PATTERN = /(?:(?:(\d+|[一二三四五六七八九十半两数]+)\s*(?:日|天|年|月|个时辰|小时|刻钟|载)后)|翌日|次日|隔天|三天后|三日后|半月后|数日后|转眼间|眨眼过)/;
const SPATIAL_SHIFT_PATTERN = /(?:来到|前往|赶往|走进|回到|步入|移步|遁入|潜入|行至|到达|踏入|立于|转战|后山|殿后|神殿|密室|洞窟|魔窟)/;

const {
  CAPACITY_RULES,
  evaluateChapterCapacity,
  partitionChapterEvents
} = require('./planner-capacity-gate');

// 兼容别名
const CAPACITY_LIMITS = CAPACITY_RULES;


/**
 * 将大纲节点切片并构建具备时空过渡桥梁的场景规格清单 (Scene Specifications)
 * @param {Array<string|Object>} outlineNodes 大纲节点或文本列表
 * @param {Object} options 配置选项
 * @returns {Array<Object>} 结构化场景规划结果
 */
function planScenes(outlineNodes = [], options = {}) {
  const targetWordCount = options.targetWordCount || 2400;
  const nodes = Array.isArray(outlineNodes) ? outlineNodes : [];
  const scenes = [];

  const capacity = evaluateChapterCapacity(nodes, targetWordCount);
  let previousLocation = '';
  let accumulatedTime = '';

  for (let i = 0; i < nodes.length; i++) {
    const rawNode = nodes[i];
    const nodeText = typeof rawNode === 'string' ? rawNode : (rawNode.text || rawNode.description || rawNode.title || '');
    const sceneId = `SCENE-${String(i + 1).padStart(2, '0')}`;

    // 1. 检测时空跳跃
    const temporalMatch = nodeText.match(TEMPORAL_JUMP_PATTERN);
    const spatialMatch = nodeText.match(SPATIAL_SHIFT_PATTERN);
    const hasTemporalShift = Boolean(temporalMatch);
    const hasSpatialShift = Boolean(spatialMatch);

    // 2. 转场过渡桥梁判定 (Transition Bridge Requirement)
    let requiresTransitionBridge = false;
    let transitionBridgeDirective = null;

    if (i > 0 && (hasTemporalShift || hasSpatialShift)) {
      requiresTransitionBridge = true;
      const jumpDesc = temporalMatch ? temporalMatch[0] : '跨越新场景';
      transitionBridgeDirective = `【反过度平滑转场桥梁指令 (DEF-PACING-001 / OPT-SCENE-002)】：此处涉及时空位移（${jumpDesc}）。严禁直接以孤立词“${jumpDesc}”硬切开篇；但同时【严禁书写冗长的闭门调息流水账】，调息与环境说明控制在 30 字以内（如仅以黄昏光影或风声简单锚定），确保篇幅重心留给实质剧情。`;
    }

    // 3. 呼吸留白预算判定 (Downtime Allocation)
    // 在中段或高潮交锋之后（如场景 3、5）强制要求 1 段休整呼吸镜头
    const isPostClimaxOrMidway = i === 2 || (i > 0 && i === Math.floor(nodes.length / 2));
    const allocateDowntime = isPostClimaxOrMidway;
    const downtimeDirective = allocateDowntime
      ? `【呼吸留白指令 (DEF-PACING-002)】：此处安排约 60~90 字的从容沉淀留白。可书写角色片刻的沉思、环境景物光影变迁、或对杯盏/器物的把玩，为读者提供战后消化与心流回落空间，严禁挤占后续高潮交锋的动作烈度。`
      : null;

    // 4. 场景类型推断
    let sceneType = 'narrative';
    if (/(交锋|踢门|神威|压迫|神灵|出手|对决|斗法|死战)/.test(nodeText)) {
      sceneType = 'action_conflict';
    } else if (/(谈话|抱怨|点破|结拜|设宴|双关|机锋|试探)/.test(nodeText)) {
      sceneType = 'dialogue_game';
    } else if (/(借宝|观悟|日晷|天魔石刻|突破|感悟)/.test(nodeText)) {
      sceneType = 'comprehension_turning';
    } else if (/(吐露|揭秘|反转|悬念|异样|轻笑|离开)/.test(nodeText)) {
      sceneType = 'cliffhanger_reveal';
    }

    // 5. 开篇动作动量守恒门禁 (OPT-SCENE-002)
    let actionMomentumDirective = null;
    if (sceneType === 'action_conflict' && i === 0) {
      actionMomentumDirective = `【开篇动作动量守恒契约 (OPT-SCENE-002)】：第一幕踢门破窟严禁仅用温和对峙或言语推托替代动作交锋！必须包含神威压迫、石壁轰塌震落、神光破壁与掌风激荡等微观物理对抗细节，确保开篇动作冲突动词密度充足。`;
    }

    scenes.push({
      sceneId,
      sceneIndex: i + 1,
      sceneType,
      rawNodeText: nodeText,
      estimatedChars: Math.round(capacity.narrativeChars / Math.max(1, nodes.length)),
      hasTemporalShift,
      hasSpatialShift,
      requiresTransitionBridge,
      transitionBridgeDirective,
      allocateDowntime,
      downtimeDirective,
      actionMomentumDirective
    });
  }

  return {
    capacity,
    scenes,
    totalScenes: scenes.length,
    scenesWithBridgeRequired: scenes.filter(s => s.requiresTransitionBridge).length,
    scenesWithDowntimeBudget: scenes.filter(s => s.allocateDowntime).length
  };
}

/**
 * 将规划好的场景结构编译为可直接注入 Writer Prompt 的指令文本块
 * @param {Object} planResult planScenes 的返回结果
 * @returns {string} 提示词注入文本
 */
function compileSceneDirectives(planResult = {}) {
  const { capacity, scenes } = planResult;
  if (!Array.isArray(scenes) || scenes.length === 0) return '';

  const lines = [
    '### 【分场景规划与时空转场契约 (Scene Planner Enforced)】',
    `> 容量状态: ${capacity.status.toUpperCase()} | 总场景数: ${scenes.length} | 目标字数: 约 ${capacity.targetWordCount} 字 (含约 ${capacity.downtimeChars} 字呼吸留白预算)`,
    ''
  ];

  if (capacity.issue) {
    lines.push(`> ⚠️ 容量预警：${capacity.issue}`);
    lines.push(`> 建议对策：${capacity.recommendation}`, '');
  }

  lines.push('按照以下场景切片与转场衔接规范依次推进行文，严禁遗漏转场桥梁与留白呼吸：');

  for (const s of scenes) {
    lines.push(`\n**[场景 ${s.sceneIndex}: ${s.sceneType}]** (预估篇幅: ~${s.estimatedChars}字)`);
    lines.push(`- 剧情推进: ${s.rawNodeText}`);
    if (s.requiresTransitionBridge) {
      lines.push(`- 🔗 转场衔接: ${s.transitionBridgeDirective}`);
    }
    if (s.allocateDowntime) {
      lines.push(`- 🍃 呼吸留白: ${s.downtimeDirective}`);
    }
    if (s.actionMomentumDirective) {
      lines.push(`- 💥 动作动量: ${s.actionMomentumDirective}`);
    }
  }

  return lines.join('\n');
}

module.exports = {
  CAPACITY_LIMITS,
  evaluateChapterCapacity,
  partitionChapterEvents,
  planScenes,
  compileSceneDirectives
};

