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

  const pacingPolicy = {
    transitionRange: options.pacingPolicy?.transitionRange || [10, 30],
    breathingAllowed: options.pacingPolicy?.breathingAllowed !== false,
    breathingRange: options.pacingPolicy?.breathingRange || [60, 90],
    actionDensity: options.pacingPolicy?.actionDensity || { min: 0.2, max: 0.65 },
    ...options.pacingPolicy
  };

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
      const maxTrans = pacingPolicy.transitionRange[1] || 30;
      transitionBridgeDirective = `【反过度平滑转场桥梁指令 (DEF-PACING-001 / OPT-SCENE-002)】：此处涉及时空位移（${jumpDesc}）。严禁直接以孤立词“${jumpDesc}”硬切开篇；但同时【严禁书写冗长的闭门调息流水账】，调息与环境说明控制在 ${maxTrans} 字以内（如仅以黄昏光影或风声简单锚定），确保篇幅重心留给实质剧情。`;
    }

    // 3. 呼吸留白预算判定 (Downtime Allocation)
    // 在中段或高潮交锋之后（如场景 3、5）强制要求 1 段休整呼吸镜头
    const isPostClimaxOrMidway = i === 2 || (i > 0 && i === Math.floor(nodes.length / 2));
    const allocateDowntime = pacingPolicy.breathingAllowed && isPostClimaxOrMidway;
    const [bMin, bMax] = pacingPolicy.breathingRange || [60, 90];
    const downtimeDirective = allocateDowntime
      ? `【呼吸留白指令 (DEF-PACING-002)】：此处安排约 ${bMin}~${bMax} 字的从容沉淀留白。可书写角色片刻的沉思、环境景物光影变迁、或对杯盏/器物的把玩，为读者提供战后消化与心流回落空间，严禁挤占后续高潮交锋的动作烈度。`
      : null;

    // 4. 场景类型推断
    let sceneType = (typeof rawNode === 'object' && (rawNode.sceneType || rawNode.sceneMode || rawNode.type)) || 'narrative';
    if (sceneType === 'narrative') {
      if (/(交锋|踢门|神威|压迫|神灵|出手|对决|斗法|死战|战斗|搏杀|冲突|刺杀)/.test(nodeText)) {
        sceneType = 'action_conflict';
      } else if (/(谈话|抱怨|点破|结拜|设宴|双关|机锋|试探|交涉|谈判|对话|审讯)/.test(nodeText)) {
        sceneType = 'dialogue_game';
      } else if (/(借宝|观悟|日晷|天魔石刻|突破|感悟|顿悟|推演|领悟|觉醒)/.test(nodeText)) {
        sceneType = 'comprehension_turning';
      } else if (/(吐露|揭秘|反转|悬念|异样|轻笑|离开|突发|伏笔|危机)/.test(nodeText)) {
        sceneType = 'cliffhanger_reveal';
      }
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
    '### 【分场景规划与时空转场契约 (Scene Planner Enforced)】'
  ];

  if (planResult.freePlayPlot) {
    lines.push('> 规划模式: GOAL_ONLY (仅有章节目标) | 自由发挥情节标记: 启用 (creativeLicense: true)');
    lines.push('> ⚠️ 注意：以下场景切片系由系统轻量推导生成，供行文结构参考。');
    lines.push('【自由发挥因果安全限制 (Causal Guard)】：');
    lines.push('模型在此模式下拥有情节演绎自由度，但【严禁冲垮大纲核心因果】：');
    lines.push('1. 必须达成章节核心目标；');
    lines.push('2. 严禁越俎代庖终结全书长线主线或未排期伏笔；');
    lines.push('3. 严禁擅自击杀或改写未授权的核心角色生死状态。\n');
  }

  if (capacity) {
    lines.push(`> 容量状态: ${String(capacity.status || 'OPTIMAL').toUpperCase()} | 总场景数: ${scenes.length} | 目标字数: 约 ${capacity.targetWordCount || 2400} 字 (含约 ${capacity.downtimeChars || 0} 字呼吸留白预算)`);
    lines.push('');
    if (capacity.issue) {
      lines.push(`> ⚠️ 容量预警：${capacity.issue}`);
      lines.push(`> 建议对策：${capacity.recommendation}`, '');
    }
  } else {
    lines.push(`> 总场景数: ${scenes.length}`);
    lines.push('');
  }

  lines.push('按照以下场景切片与转场衔接规范依次推进行文，严禁遗漏转场桥梁与留白呼吸：');

  for (const s of scenes) {
    lines.push(`\n**[场景 ${s.sceneIndex}: ${s.sceneType || 'narrative'}]** (预估篇幅: ~${s.estimatedChars || 800}字)`);
    lines.push(`- 剧情推进: ${s.rawNodeText || s.goal || s.purpose || ''}`);
    if (s.requiresTransitionBridge && s.transitionBridgeDirective) {
      lines.push(`- 🔗 转场衔接: ${s.transitionBridgeDirective}`);
    }
    if (s.allocateDowntime && s.downtimeDirective) {
      lines.push(`- 🍃 呼吸留白: ${s.downtimeDirective}`);
    }
    if (s.actionMomentumDirective) {
      lines.push(`- 💥 动作动量: ${s.actionMomentumDirective}`);
    }
  }

  return lines.join('\n');
}

/**
 * 探测大纲信息完备度梯队
 * @param {Object} contract 章节合同
 * @param {Object} outlineContext 权威分层大纲对象
 * @returns {'full_scenes' | 'event_chain' | 'goal_only'}
 */
function detectOutlineCompletenessTier(contract = {}, outlineContext = {}) {
  const c = (contract && typeof contract === 'object' && ('contract' in contract || 'chapterContext' in contract))
    ? (contract.contract || {})
    : (contract || {});
  const oc = (contract && typeof contract === 'object' && ('outlineContext' in contract || 'storyContext' in contract))
    ? (contract.outlineContext || contract.storyContext?.outlineContext || outlineContext || {})
    : (outlineContext || {});
  const chapterCtx = (contract && contract.chapterContext) || (contract && contract.storyContext?.chapterContext) || {};

  // 1. Tier 1: 拥有完整预置场景列表
  const scenesList = (Array.isArray(c.scenes) && c.scenes.length > 0)
    ? c.scenes
    : (Array.isArray(oc.chapter?.scenes) && oc.chapter.scenes.length > 0
      ? oc.chapter.scenes
      : (Array.isArray(chapterCtx.scenePlan) && chapterCtx.scenePlan.length > 0 ? chapterCtx.scenePlan : []));

  if (scenesList.length > 0 || oc.meta?.completenessTier === 'full_scenes') {
    return 'full_scenes';
  }

  // 2. Tier 2: 拥有多步事件链或 5 维节拍
  const explicitBeats = (Array.isArray(c.beats) && c.beats.length > 0)
    ? c.beats
    : ((Array.isArray(c.keyBeats) && c.keyBeats.length > 0)
      ? c.keyBeats
      : ((Array.isArray(c.eventChain) && c.eventChain.length > 0)
        ? c.eventChain
        : ((Array.isArray(oc.chapter?.beats) && oc.chapter.beats.length > 0)
          ? oc.chapter.beats
          : ((Array.isArray(chapterCtx.eventChain) && chapterCtx.eventChain.length > 0)
            ? chapterCtx.eventChain
            : ((Array.isArray(chapterCtx.beats) && chapterCtx.beats.length > 0) ? chapterCtx.beats : [])))));

  if (explicitBeats.length > 0 || oc.meta?.completenessTier === 'event_chain') {
    return 'event_chain';
  }

  // 检查 5 维结构化节拍字段
  const structuredFields = [
    c.protagonistAction || oc.chapter?.protagonistAction || chapterCtx.protagonistAction,
    c.opposition || oc.chapter?.opposition || chapterCtx.opposition,
    c.informationChange || oc.chapter?.informationChange || chapterCtx.informationChange,
    c.result || c.irreversibleResult || oc.chapter?.result || chapterCtx.result,
    c.hook || oc.chapter?.hook || chapterCtx.hook
  ].filter(f => typeof f === 'string' && f.trim().length > 0);

  if (structuredFields.length >= 2) {
    return 'event_chain';
  }

  // 3. Tier 3: 仅有章节目标
  return 'goal_only';
}

/**
 * 状态 1: 预声明完整场景本地时空与因果校验及转场增强 (完全 bypass 外部 LLM)
 * @param {Array<Object|string>} rawScenes 原始场景列表
 * @param {Object} options 配置选项
 * @returns {Object} 增强后的场景计划
 */
function validateAndEnforceFullScenePlan(rawScenes = [], options = {}) {
  const targetWordCount = Number(options.targetWordCount || options.contract?.wordBudget?.targetChars) || 2400;
  const rawList = Array.isArray(rawScenes) ? rawScenes : [];
  const pacingPolicy = {
    transitionRange: options.pacingPolicy?.transitionRange || [10, 30],
    breathingAllowed: options.pacingPolicy?.breathingAllowed !== false,
    breathingRange: options.pacingPolicy?.breathingRange || [60, 90],
    ...options.pacingPolicy
  };

  const capacity = evaluateChapterCapacity(rawList, targetWordCount);
  const enrichedScenes = [];
  let previousLocation = '';
  let transitionsAdded = 0;

  for (let i = 0; i < rawList.length; i++) {
    const raw = rawList[i];
    const isObj = raw && typeof raw === 'object';
    const sceneId = (isObj && (raw.sceneId || raw.id)) || `SCENE-${String(i + 1).padStart(2, '0')}`;
    const nodeText = isObj
      ? (raw.rawNodeText || raw.goal || raw.purpose || raw.summary || raw.text || raw.title || raw.action || raw.description || '')
      : String(raw || '');

    const temporalMatch = nodeText.match(TEMPORAL_JUMP_PATTERN);
    const spatialMatch = nodeText.match(SPATIAL_SHIFT_PATTERN);
    let hasTemporalShift = Boolean(temporalMatch) || Boolean(isObj && raw.hasTemporalShift);
    let hasSpatialShift = Boolean(spatialMatch) || Boolean(isObj && raw.hasSpatialShift);

    const currentLocation = (isObj && (raw.location || raw.place || raw.sceneLocation)) || '';
    if (previousLocation && currentLocation && currentLocation !== previousLocation) {
      hasSpatialShift = true;
    }
    if (currentLocation) previousLocation = currentLocation;

    let requiresTransitionBridge = false;
    let transitionBridgeDirective = (isObj && raw.transitionBridgeDirective) || null;

    if (i > 0 && (hasTemporalShift || hasSpatialShift)) {
      requiresTransitionBridge = true;
      if (!transitionBridgeDirective) {
        const jumpDesc = temporalMatch ? temporalMatch[0] : (spatialMatch ? spatialMatch[0] : (currentLocation ? `前往${currentLocation}` : '跨越新场景'));
        const maxTrans = pacingPolicy.transitionRange[1] || 30;
        transitionBridgeDirective = `【反过度平滑转场桥梁指令 (DEF-PACING-001 / OPT-SCENE-002)】：此处涉及时空位移（${jumpDesc}）。严禁直接以孤立词“${jumpDesc}”硬切开篇；但同时【严禁书写冗长的闭门调息流水账】，调息与环境说明控制在 ${maxTrans} 字以内（如仅以黄昏光影或风声简单锚定），确保篇幅重心留给实质剧情。`;
        transitionsAdded++;
      }
    }

    const isPostClimaxOrMidway = i === 2 || (i > 0 && i === Math.floor(rawList.length / 2));
    const allocateDowntime = pacingPolicy.breathingAllowed && isPostClimaxOrMidway;
    const [bMin, bMax] = pacingPolicy.breathingRange || [60, 90];
    let downtimeDirective = (isObj && raw.downtimeDirective) || null;
    if (allocateDowntime && !downtimeDirective) {
      downtimeDirective = `【呼吸留白指令 (DEF-PACING-002)】：此处安排约 ${bMin}~${bMax} 字的从容沉淀留白。可书写角色片刻的沉思、环境景物光影变迁、或对杯盏/器物的把玩，为读者提供战后消化与心流回落空间，严禁挤占后续高潮交锋的动作烈度。`;
    }

    let sceneType = (isObj && (raw.sceneType || raw.sceneMode || raw.type)) || 'narrative';
    if (sceneType === 'narrative') {
      if (/(交锋|踢门|神威|压迫|神灵|出手|对决|斗法|死战|战斗|搏杀|冲突|刺杀|拔刀|论刀|开战)/.test(nodeText)) {
        sceneType = 'action_conflict';
      } else if (/(谈话|抱怨|点破|结拜|设宴|双关|机锋|试探|交涉|谈判|对话|审讯|商讨)/.test(nodeText)) {
        sceneType = 'dialogue_game';
      } else if (/(借宝|观悟|日晷|天魔石刻|突破|感悟|顿悟|推演|领悟|觉醒|晋阶)/.test(nodeText)) {
        sceneType = 'comprehension_turning';
      } else if (/(吐露|揭秘|反转|悬念|异样|轻笑|离开|突发|伏笔|危机|发现)/.test(nodeText)) {
        sceneType = 'cliffhanger_reveal';
      }
    }

    let actionMomentumDirective = (isObj && raw.actionMomentumDirective) || null;
    if (sceneType === 'action_conflict' && i === 0 && !actionMomentumDirective) {
      actionMomentumDirective = `【开篇动作动量守恒契约 (OPT-SCENE-002)】：第一幕踢门破窟严禁仅用温和对峙或言语推托替代动作交锋！必须包含神威压迫、石壁轰塌震落、神光破壁与掌风激荡等微观物理对抗细节，确保开篇动作冲突动词密度充足。`;
    }

    enrichedScenes.push({
      ...(isObj ? raw : {}),
      sceneId,
      sceneIndex: i + 1,
      sceneType,
      rawNodeText: nodeText,
      goal: (isObj && raw.goal) || nodeText,
      purpose: (isObj && raw.purpose) || (isObj && raw.summary) || `推进场景 ${i + 1}`,
      estimatedChars: (isObj && Number(raw.estimatedChars)) || Math.round(capacity.narrativeChars / Math.max(1, rawList.length)),
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
    valid: true,
    scenes: enrichedScenes,
    transitionsAdded,
    totalScenes: enrichedScenes.length,
    scenesWithBridgeRequired: enrichedScenes.filter(s => s.requiresTransitionBridge).length,
    scenesWithDowntimeBudget: enrichedScenes.filter(s => s.allocateDowntime).length,
    capacity,
    tier: 'full_scenes',
    freePlayPlot: false,
    creativeLicense: false,
    validation: {
      valid: true,
      temporal: 'verified',
      spatial: 'verified',
      transitionsAdded
    }
  };
}

/**
 * 状态 2: 确定性依据事件链推导场景卡 (5 维结构化节拍或事件序列)
 * @param {Array|Object} beats 事件链列表或 5 维节拍对象
 * @param {Object} options 配置选项
 * @returns {Object} 场景计划
 */
function deriveScenesFromEventChain(beats = [], options = {}) {
  const contract = options.contract || {};
  const chapterCtx = options.chapterContext || {};
  const rawBeatsObj = (beats && typeof beats === 'object' && !Array.isArray(beats)) ? beats : {};

  const pAction = rawBeatsObj.protagonistAction || contract.protagonistAction || chapterCtx.protagonistAction;
  const opp = rawBeatsObj.opposition || contract.opposition || chapterCtx.opposition;
  const info = rawBeatsObj.informationChange || contract.informationChange || chapterCtx.informationChange;
  const res = rawBeatsObj.result || rawBeatsObj.irreversibleResult || contract.irreversibleResult || contract.result || chapterCtx.result;
  const hook = rawBeatsObj.hook || contract.hook || chapterCtx.hook;

  const rawNodes = [];

  if (pAction || opp || info || res) {
    if (pAction) {
      rawNodes.push({
        goal: String(pAction).trim(),
        stage: 'setup_action',
        role: '主角主动行动',
        purpose: '主角主动行动与现场动机确立',
        rawNodeText: String(pAction).trim(),
        sceneType: /(交锋|出手|死战|战斗|搏杀|拔刀)/.test(pAction) ? 'action_conflict' : 'dialogue_game'
      });
    }
    if (opp) {
      rawNodes.push({
        goal: String(opp).trim(),
        stage: 'conflict_opposition',
        role: '对抗阻力',
        purpose: '对抗阻力爆发与冲突博弈交锋',
        rawNodeText: String(opp).trim(),
        sceneType: 'action_conflict'
      });
    }
    if (info) {
      rawNodes.push({
        goal: String(info).trim(),
        stage: 'turning_information',
        role: '关键信息剧变',
        purpose: '关键信息揭露与认知局势转折',
        rawNodeText: String(info).trim(),
        sceneType: 'comprehension_turning'
      });
    }
    if (res) {
      rawNodes.push({
        goal: String(res).trim(),
        stage: 'outcome_result',
        role: '不可逆结果',
        purpose: '不可逆结果确立与高潮收束',
        rawNodeText: String(res).trim(),
        sceneType: 'action_conflict'
      });
    }
    if (hook && String(hook).trim().length >= 4) {
      rawNodes.push({
        goal: String(hook).trim(),
        stage: 'exit_hook',
        role: '章末悬念钩子',
        purpose: '章末余波扩散与悬念钩子锁定',
        rawNodeText: String(hook).trim(),
        sceneType: 'cliffhanger_reveal'
      });
    }
  } else if (Array.isArray(beats) && beats.length > 0) {
    for (let i = 0; i < beats.length; i++) {
      const b = beats[i];
      const text = typeof b === 'string' ? b : (b.text || b.goal || b.description || b.name || '');
      rawNodes.push({
        ...(typeof b === 'object' ? b : {}),
        goal: text,
        purpose: (typeof b === 'object' && (b.purpose || b.summary)) || `推进大纲节拍: ${text}`,
        rawNodeText: text
      });
    }
  }

  const enforced = validateAndEnforceFullScenePlan(rawNodes, options);

  return {
    ...enforced,
    tier: 'event_chain',
    freePlayPlot: false,
    creativeLicense: false,
    derivedFrom: (pAction || opp || info || res) ? '5d_event_beats' : 'event_chain',
    preservedEventCount: rawNodes.length
  };
}

/**
 * 状态 3: 仅有章节目标的轻量三幕式推导与自由发挥标记
 * @param {string|Object} goal 粗粒度章节目标
 * @param {Object} options 配置选项
 * @returns {Object} 场景计划
 */
function inferLightweightScenePlan(goal = '', options = {}) {
  const contract = options.contract || {};
  const goalText = String(
    (typeof goal === 'string' && goal.trim().length > 0)
      ? goal
      : (goal && (goal.goal || goal.chapterGoal)) || contract.chapterGoal || contract.goal || options.goal || '推进本章节核心目标'
  ).trim();

  const creativeLicenseScope = [
    'scene_progression',
    'micro_conflict',
    'inferred_beats',
    'dialogue_expansion'
  ];

  const inferredBeats = [
    {
      sceneIndex: 1,
      act: 'act1_setup',
      sceneType: 'dialogue_game',
      goal: `围绕「${goalText}」展开前置试探与局势确立`,
      purpose: '现场动机展开与环境试探',
      rawNodeText: `围绕「${goalText}」的前置行动与局势试探`,
      inferredGoal: '局势试探与目标确立',
      isModelGenerated: true
    },
    {
      sceneIndex: 2,
      act: 'act2_confrontation',
      sceneType: 'action_conflict',
      goal: `直面核心阻力，推进「${goalText}」的正面冲突交锋`,
      purpose: '核心阻力爆发与冲突升级',
      rawNodeText: `直面阻力激化，推进目标「${goalText}」的核心交锋`,
      inferredGoal: '核心阻力爆发与交锋推进',
      isModelGenerated: true
    },
    {
      sceneIndex: 3,
      act: 'act3_resolution_hook',
      sceneType: 'cliffhanger_reveal',
      goal: `确立阶段性成果「${goalText}」，引出章末余波与未决悬念`,
      purpose: '阶段结果确立与悬念钩子收尾',
      rawNodeText: `产生阶段结果并锁定章末悬念钩子`,
      inferredGoal: '阶段成果与章末余波',
      isModelGenerated: true
    }
  ];

  const inputNodes = (Array.isArray(options.scenes) && options.scenes.length > 0)
    ? options.scenes
    : inferredBeats;

  const enforced = validateAndEnforceFullScenePlan(inputNodes, options);

  return {
    ...enforced,
    tier: 'goal_only',
    mode: 'lightweight_inferred',
    freePlayPlot: true,
    creativeLicense: true,
    creativeLicenseScope,
    inferredBeats,
    authorProvidedConstraints: {
      chapterGoal: goalText
    }
  };
}

/**
 * 场景入模前因果硬围栏校验器 (Causal Invariant Verification)
 * @param {Array<Object>} scenes 细化场景卡列表
 * @param {Object} contract 章节合同与公理级因果锚点
 * @returns {{ valid: boolean, passed: boolean, violations: Array<Object> }}
 */
function verifyCausalInvariants(scenes = [], contract = {}) {
  const violations = [];
  const list = Array.isArray(scenes) ? scenes : (scenes?.scenes || []);

  const viewpointCharacter = String(contract.viewpointCharacter || contract.povCharacter || contract.pov || '').trim();
  const mustNotList = Array.isArray(contract.mustNot) ? contract.mustNot.map(String).filter(Boolean) : [];
  const forbiddenKnowledge = Array.isArray(contract.forbiddenKnowledge) ? contract.forbiddenKnowledge.map(String).filter(Boolean) : [];
  const expectedResult = String(contract.irreversibleResult || contract.result || '').trim();
  const allowedDebts = new Set([
    ...(Array.isArray(contract.requiredPayoff) ? contract.requiredPayoff : [contract.requiredPayoff]),
    ...(Array.isArray(contract.declaredResolutions) ? contract.declaredResolutions : []),
    ...(Array.isArray(contract.allowedDebts) ? contract.allowedDebts : [])
  ].map(d => String(d && (d.id || d.debtId || d) || '')).filter(Boolean));

  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!s || typeof s !== 'object') continue;
    const sceneIndex = s.sceneIndex || (i + 1);
    const sceneText = [s.rawNodeText, s.goal, s.purpose, s.action, s.description, s.summary, s.title].filter(Boolean).join(' ');

    // 1. 视点人物越界校验
    if (viewpointCharacter) {
      const scenePov = String(s.viewpointCharacter || s.povCharacter || s.pov || '').trim();
      if (scenePov && scenePov !== viewpointCharacter && !scenePov.includes(viewpointCharacter)) {
        violations.push({
          sceneIndex,
          type: 'POV_VIOLATION',
          message: `场景 ${sceneIndex} 视点人物「${scenePov}」与合同视点人物「${viewpointCharacter}」冲突`,
          declaredPov: scenePov,
          expectedPov: viewpointCharacter
        });
      }
    }

    // 2. mustNot 禁忌动作穿透校验
    for (const forbidden of mustNotList) {
      if (sceneText.includes(forbidden)) {
        violations.push({
          sceneIndex,
          type: 'MUST_NOT_VIOLATION',
          message: `场景 ${sceneIndex} 包含了合同禁止事项「${forbidden}」`,
          forbidden
        });
      }
    }

    // 3. 秘密泄露校验 (提前获知未授权秘密)
    for (const secret of forbiddenKnowledge) {
      if (sceneText.includes(secret) && /(知晓|发现|识破|揭秘|得知|勘破|晓得|察觉|泄露)/.test(sceneText)) {
        violations.push({
          sceneIndex,
          type: 'FORBIDDEN_KNOWLEDGE_LEAK',
          message: `场景 ${sceneIndex} 涉嫌提前泄露未可知秘密「${secret}」`,
          secret
        });
      }
    }

    // 4. 未排期债务投机核销校验
    const sceneDebts = [
      ...(Array.isArray(s.resolvesDebt) ? s.resolvesDebt : [s.resolvesDebt]),
      ...(Array.isArray(s.paidDebts) ? s.paidDebts : [s.paidDebts]),
      ...(Array.isArray(s.debtPayoffs) ? s.debtPayoffs : [s.debtPayoffs])
    ].map(d => String(d && (d.id || d.debtId || d) || '')).filter(Boolean);

    for (const debtId of sceneDebts) {
      if (!allowedDebts.has(debtId)) {
        violations.push({
          sceneIndex,
          type: 'UNAUTHORIZED_DEBT_PAYOFF',
          message: `场景 ${sceneIndex} 企图提前结算未排期因果债务「${debtId}」`,
          debtId
        });
      }
    }

    const forbiddenPayoffs = Array.isArray(contract.forbiddenPayoffs) ? contract.forbiddenPayoffs.map(String).filter(Boolean) : [];
    for (const forbiddenDebt of forbiddenPayoffs) {
      if (sceneText.includes(forbiddenDebt) && /(偿还|解决|回收|平账|结清|兑现|终结)/.test(sceneText)) {
        violations.push({
          sceneIndex,
          type: 'UNAUTHORIZED_DEBT_PAYOFF',
          message: `场景 ${sceneIndex} 企图违规结算被禁因果债务「${forbiddenDebt}」`,
          debtId: forbiddenDebt
        });
      }
    }
  }

  // 5. 终局不可逆因果闭环冲突检查
  if (expectedResult && list.length > 0) {
    const lastScene = list[list.length - 1];
    const lastText = [lastScene.rawNodeText, lastScene.goal, lastScene.purpose, lastScene.description, lastScene.summary].filter(Boolean).join(' ');

    const defeatPattern = /(失败|受挫|遁走|退让|隐忍|重伤|失利|受辱|被逐)/;
    const victoryPattern = /(大获全胜|全歼|彻底击溃|秒杀|反杀全场|横扫|完胜|反杀并击毙)/;
    if (defeatPattern.test(expectedResult) && victoryPattern.test(lastText)) {
      violations.push({
        sceneIndex: list.length,
        type: 'OUTCOME_MISALIGNMENT',
        message: `收尾场景结果与大纲终局预期「${expectedResult}」发生因果反向冲突`
      });
    }

    const successPattern = /(获胜|成功|击败|突破|成丹|过关|夺冠|斩获)/;
    const failurePattern = /(全盘皆输|彻底失败|殒命|认输投降|惨败收场)/;
    if (successPattern.test(expectedResult) && failurePattern.test(lastText)) {
      violations.push({
        sceneIndex: list.length,
        type: 'OUTCOME_MISALIGNMENT',
        message: `收尾场景结果与大纲终局预期「${expectedResult}」发生因果反向冲突`
      });
    }
  }

  return {
    valid: violations.length === 0,
    passed: violations.length === 0,
    violations
  };
}

/**
 * 统一分级场景规划总入口
 * @param {Object} options 配置选项
 * @returns {Object} 场景规划与因果校验结果
 */
function planScenesTiered(options = {}) {
  const contract = options.contract || {};
  const outlineContext = options.outlineContext || {};
  const chapterContext = options.chapterContext || {};
  const targetWordCount = Number(options.targetWordCount || contract.wordBudget?.targetChars) || 2400;

  const tier = detectOutlineCompletenessTier(contract, outlineContext || chapterContext);
  let planResult = null;

  if (tier === 'full_scenes') {
    const rawScenes = (Array.isArray(contract.scenes) && contract.scenes.length)
      ? contract.scenes
      : (Array.isArray(outlineContext.chapter?.scenes) && outlineContext.chapter.scenes.length
        ? outlineContext.chapter.scenes
        : (Array.isArray(chapterContext.scenePlan) ? chapterContext.scenePlan : []));
    planResult = validateAndEnforceFullScenePlan(rawScenes, { ...options, targetWordCount });
  } else if (tier === 'event_chain') {
    const beats = (Array.isArray(contract.beats) && contract.beats.length)
      ? contract.beats
      : ((Array.isArray(contract.keyBeats) && contract.keyBeats.length)
        ? contract.keyBeats
        : ((Array.isArray(contract.eventChain) && contract.eventChain.length)
          ? contract.eventChain
          : (outlineContext.chapter?.beats || chapterContext.eventChain || chapterContext.beats || contract)));
    planResult = deriveScenesFromEventChain(beats, { ...options, targetWordCount });
  } else {
    const goal = contract.chapterGoal || contract.goal ||
      outlineContext.chapter?.goal || chapterContext.goal ||
      options.goal || '推进当前章节核心目标';
    planResult = inferLightweightScenePlan(goal, { ...options, targetWordCount });
  }

  const causalAudit = verifyCausalInvariants(planResult.scenes, contract);
  planResult.causalInvariants = causalAudit;
  planResult.causalInvariantsPassed = causalAudit.valid;

  return planResult;
}

module.exports = {
  CAPACITY_LIMITS,
  evaluateChapterCapacity,
  partitionChapterEvents,
  planScenes,
  compileSceneDirectives,

  // Milestone 2 exports
  detectOutlineCompletenessTier,
  validateAndEnforceFullScenePlan,
  deriveScenesFromEventChain,
  inferLightweightScenePlan,
  verifyCausalInvariants,
  planScenesTiered
};

