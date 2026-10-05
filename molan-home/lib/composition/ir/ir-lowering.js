'use strict';

/**
 * @file ir-lowering.js
 * 创作策略 IR 降级渲染器 (Strategy IR Lowering Engine)
 * 
 * 核心功能：
 * 1. 将模型无关的 StrategyIR 下沉渲染为针对特定大模型架构的最佳提示词形态（System/User 分层与 P0~P8 优先级梯队）；
 * 2. 严格执行“抽象规则优先、微示例示范、失败模式警戒、严禁小说原句大段直出”的降级过滤纪律；
 * 3. 支持输出完全兼容既有管线的 systemPrompt、userPrompt 与 priorityCascade 结构。
 */

/**
 * 将 StrategyIR 渲染降级为模型提示词
 * @param {Object} strategyIR 规范化的 StrategyIR 实体
 * @param {Object} options 降级选项 (targetModelFamily, contextText, userInstruction)
 * @returns {Object} 包含 systemPrompt, userPrompt, priorityCascade 的提示词包
 */
function lowerToPrompt(strategyIR, options = {}) {
  if (!strategyIR || typeof strategyIR !== 'object') {
    throw new TypeError('lowerToPrompt 需要有效的 strategyIR');
  }

  const {
    hardConstraints = {},
    bookIdentity = {},
    chapterOutcomeContract = {},
    stylePolicy = {},
    focusPolicy = {},
    hookPolicy = {},
    abstractEvidenceCards = [],
    repairInstructions = null
  } = strategyIR;

  const targetChars = hardConstraints.targetWordRange?.target || 3000;
  const minChars = hardConstraints.targetWordRange?.min || Math.round(targetChars * 0.85);
  const maxChars = hardConstraints.targetWordRange?.max || Math.round(targetChars * 1.15);

  const cascade = {};

  // =========================================================================
  // P0: 绝对事实与物理围栏 (Hard Constraints)
  // =========================================================================
  const forbiddenText = hardConstraints.forbiddenKnowledge?.length
    ? `\n· 本章绝对禁载泄露知识：${hardConstraints.forbiddenKnowledge.join('、')}`
    : '';
  const povText = hardConstraints.narrativePov || '第三人称限制视角';
  const povLimit = hardConstraints.viewpointCharacter
    ? `（核心视点人物为【${hardConstraints.viewpointCharacter}】，严禁窥探非视点角色内心）`
    : '（严禁全知越界，所有他者反应均须通过可见外在神态与动作呈现）';

  cascade.P0_HARD_CONSTRAINTS = [
    '【P0 绝对事实与物理围栏（最高指令，不得违反）】',
    `· 篇幅字数硬性预算：基准 ${targetChars} 字（允许范围：${minChars} ~ ${maxChars} 字）`,
    `· 叙事视角准则：${povText}${povLimit}`,
    forbiddenText,
    '· 只写原创小说正文，严禁输出任何大纲、总结、问候语或解释性旁白。'
  ].filter(Boolean).join('\n');

  // =========================================================================
  // P1: 用户明确不可变指令 (User Directives)
  // =========================================================================
  const userInstruction = String(options.userInstruction || '').trim();
  cascade.P1_USER_DIRECTIVE = userInstruction
    ? `【P1 用户明确不可变指令（高于常规模板规则）】\n${userInstruction}`
    : '【P1 用户明确指令】\n紧扣当前章节任务推进，以现场因果为第一驱动力。';

  // =========================================================================
  // P2: 创作圣经·全局基因 (Creation Bible)
  // =========================================================================
  const bibleSummary = bookIdentity.worldRuleSummary
    ? `世界底层运行法则：${bookIdentity.worldRuleSummary}`
    : '';
  cascade.P2_CREATION_BIBLE = bibleSummary
    ? `【P2 创作圣经·全局基因】\n${bibleSummary}`
    : '';

  // =========================================================================
  // P3: 结果契约与状态跃迁 (Outcome Contract & State Delta)
  // =========================================================================
  const outcome = chapterOutcomeContract;
  const delta = outcome.stateDelta || {};
  const readerEffect = outcome.readerEffect || {};
  const charEffect = outcome.characterEffect || {};

  function formatState(val) {
    if (typeof val === 'string') return val;
    if (val && typeof val === 'object') return val.summary || JSON.stringify(val);
    return String(val || '');
  }

  const p3Lines = [
    `【本章核心目标·${outcome.objectiveName || '核心推进'}】`,
    (readerEffect.knowledgeDelta || readerEffect.emotionalShift || readerEffect.summary)
      ? `读者阅读收益目标：${[readerEffect.knowledgeDelta, readerEffect.emotionalShift, readerEffect.summary].filter(Boolean).join('、')}`
      : '',
    '【状态跃迁契约 (State Delta)】：',
    `· 章前状态：${formatState(delta.stateBefore || '初始平衡状态')}`,
    Array.isArray(delta.events) && delta.events.length ? `· 推进事件：${delta.events.join(' -> ')}` : '',
    `· 章后状态：${formatState(delta.stateAfter || '不可逆推进状态')}`,
    delta.invalidIfRemoved ? `· 存在性检验：若删除本章，必须导致【${delta.invalidIfRemoved}】失效！` : ''
  ];

  if (charEffect.beliefShift || charEffect.motivationDelta) {
    p3Lines.push('【人物信念与内在位移 (Character Shift)】：');
    if (charEffect.beliefShift) p3Lines.push(`· 认知/信念裂痕：${charEffect.beliefShift}`);
    if (charEffect.motivationDelta) p3Lines.push(`· 动机转变：${charEffect.motivationDelta}`);
  }

  cascade.P3_CHAPTER_OBJECTIVE = p3Lines.filter(Boolean).join('\n');

  // =========================================================================
  // P4: 题材叙事策略 (Genre Policy)
  // =========================================================================
  const genre = bookIdentity.genre || {};
  const genreName = genre.name || genre.id || '通用文学';
  const genreLines = [
    `【题材策略·${genreName}】`,
    Array.isArray(genre.background) && genre.background.length ? `世界观底层基石：${genre.background.join('、')}` : '',
    Array.isArray(genre.coreConflicts) && genre.coreConflicts.length ? `核心矛盾类型：${genre.coreConflicts.join('、')}` : '',
    Array.isArray(genre.readerPromises) && genre.readerPromises.length ? `读者阅读契约与反馈：${genre.readerPromises.join('、')}` : '',
    Array.isArray(genre.forbiddenAssumptions) && genre.forbiddenAssumptions.length
      ? `【题材边界绝不假定】：\n${genre.forbiddenAssumptions.map(item => `· ${item}`).join('\n')}`
      : ''
  ].filter(Boolean);
  cascade.P4_GENRE_POLICY = genreLines.join('\n');

  // =========================================================================
  // P5: 文风质感策略与局部调制 (Style Policy)
  // =========================================================================
  const style = stylePolicy;
  const effectiveVector = style.modulatedVector || {};
  const vectorDesc = [
    `叙事密度: ${((Number(effectiveVector.narrativeDensity) || 0.7) * 100).toFixed(0)}%`,
    `情绪浓度: ${((Number(effectiveVector.emotionalIntensity) || 0.5) * 100).toFixed(0)}%`,
    `对白占比目标: ${((Number(effectiveVector.dialogueRatio) || 0.35) * 100).toFixed(0)}%`,
    `短句比例: ${((Number(effectiveVector.shortSentenceRatio) || 0.55) * 100).toFixed(0)}%`,
    `平均句长: ${(Number(effectiveVector.averageSentenceLength) || 20).toFixed(1)}字`,
    `留白克制: ${((Number(effectiveVector.negativeSpaceRatio) || 0.4) * 100).toFixed(0)}%`
  ].join(' | ');

  const dna = style.stableDna || {};
  const dnaLines = [];
  if (Array.isArray(dna.syntaxHabits) && dna.syntaxHabits.length) dnaLines.push(`· 句法特征：${dna.syntaxHabits.join('；')}`);
  if (Array.isArray(dna.lexicalPreferences) && dna.lexicalPreferences.length) dnaLines.push(`· 词汇习惯：${dna.lexicalPreferences.join('；')}`);
  if (dna.narrativeDistance) dnaLines.push(`· 叙事距离：${dna.narrativeDistance}`);

  const styleLines = [
    `【文风质感策略·${style.name}】`,
    dnaLines.length ? `【稳定文风基因 (Stable DNA)】：\n${dnaLines.join('\n')}` : '',
    `本章量化调制标尺：${vectorDesc}`,
    Array.isArray(style.positiveRules) && style.positiveRules.length ? `必须遵循的笔触规范：\n${style.positiveRules.map(r => `· ${r}`).join('\n')}` : '',
    Array.isArray(style.negativeRules) && style.negativeRules.length ? `严厉禁止的行文禁忌：\n${style.negativeRules.map(r => `· ${r}`).join('\n')}` : ''
  ].filter(Boolean);
  cascade.P5_STYLE_POLICY = styleLines.join('\n');

  // =========================================================================
  // P6: 镜头与笔墨预算分配 (Focus Budget)
  // =========================================================================
  const focus = focusPolicy;
  const tiers = focus.priorityTiers || {};
  const focusLines = [
    `【本章镜头与笔墨预算分配·${focus.name}】（基准总字数：${targetChars} 字）`
  ];
  if (Array.isArray(tiers.dominant) && tiers.dominant.length) {
    focusLines.push(`· 【重点倾斜 (Dominant)】：${tiers.dominant.join('、')}`);
  }
  if (Array.isArray(tiers.supporting) && tiers.supporting.length) {
    focusLines.push(`· 【辅助呼应 (Supporting)】：${tiers.supporting.join('、')}`);
  }
  if (Array.isArray(tiers.optional) && tiers.optional.length) {
    focusLines.push(`· 【克制点缀 (Optional)】：${tiers.optional.join('、')}`);
  }
  if (Array.isArray(tiers.forbidden) && tiers.forbidden.length) {
    focusLines.push(`· 【禁止抢戏 (Forbidden)】：严禁本章大篇幅描写 ${tiers.forbidden.join('、')}`);
  }
  focusLines.push('【镜头资源软预算准则】：上述配比为镜头关注倾向与软预算区间，非逐字硬性配额；严禁为凑对白比例而机械对话，重点关注主倾斜元素的情节推进力。');
  cascade.P6_FOCUS_BUDGET = focusLines.join('\n');

  // =========================================================================
  // P7: 钩子与因果债务策略 (Hook & Debt Policy)
  // =========================================================================
  const hook = hookPolicy;
  const hookLines = [
    `【本章钩子策略·${hook.name}】`,
    hook.closingHook ? `章末缺口类型：${hook.closingHook.gapType || hook.closingHook.type || '悬念缺口'}` : '',
    hook.payoffHorizon ? `预期兑现周期：${hook.payoffHorizon.label || '中短线'}` : ''
  ].filter(Boolean);

  if (hook.debtTracking?.promptGuidance) {
    hookLines.push(hook.debtTracking.promptGuidance);
  } else if (hook.debtTracking?.debtsToAddress?.length) {
    hookLines.push(`本章须呼应/推进的既有因果债：\n${hook.debtTracking.debtsToAddress.map(d => `· ${d.summary || d}`).join('\n')}`);
  }
  cascade.P7_HOOK_POLICY = hookLines.join('\n');

  // =========================================================================
  // P8: 因子化参考策略卡与失败模式反例 (Abstract Evidence Cards)
  // =========================================================================
  const cards = Array.isArray(abstractEvidenceCards) ? abstractEvidenceCards : [];
  cascade.P8_EVIDENCE = cards.length
    ? `【工业创作策略规则库·抽象模式示范与警戒】\n${cards.slice(0, 3).map(c => `· 规则：${c.rule || c.ruleStatement || ''}\n· 抽象模式：${c.abstractPattern || '现场因果触发'}\n· 微示例：${c.microExample || '现场动作对应'}\n· 警戒反例：${c.failureMode || '直接旁白解释'}`).join('\n\n')}\n【执行纪律】：上述规则卡为创作技巧与结构模式引导，严禁整段抄袭或直出示例原句！`
    : '';
  cascade.P8_NEGATIVE_GUARDS = '严禁“嘴角勾起一抹弧度”、严禁“倒吸一口凉气”等套路AI腔调。';
  cascade.P3_OUTCOME_CONTRACT = cascade.P3_CHAPTER_OBJECTIVE;
  cascade.P7_EVIDENCE_CARDS = cascade.P8_EVIDENCE;
  cascade.P5_FOCUS_BUDGET = cascade.P6_FOCUS_BUDGET;

  // =========================================================================
  // 组装最终提示词与注意力分层 (System & User Partitioning)
  // =========================================================================
  const systemBlocks = [
    cascade.P0_HARD_CONSTRAINTS,
    cascade.P4_GENRE_POLICY,
    cascade.P5_STYLE_POLICY,
    cascade.P6_FOCUS_BUDGET,
    cascade.P7_HOOK_POLICY,
    '【镜头摄像机执行准则】：遵循【动作-对白交错律】（每句关键台词必须穿插对方微表情或微动作），严禁空洞套话，严禁角色内心自报家门。'
  ].filter(Boolean).join('\n\n');

  const contextText = typeof options.chapterContext === 'string'
    ? options.chapterContext
    : (options.context || '');

  const userBlocks = [
    '【前情与环境上下文】\n' + contextText,
    cascade.P1_USER_DIRECTIVE,
    cascade.P3_CHAPTER_OBJECTIVE,
    cascade.P8_EVIDENCE
  ].filter(Boolean).join('\n\n');

  return {
    systemPrompt: systemBlocks,
    userPrompt: userBlocks,
    priorityCascade: Object.freeze(cascade),
    wordBudget: {
      target: targetChars,
      targetChars,
      min: minChars,
      minChars,
      max: maxChars,
      maxChars,
      summary: `${minChars} ~ ${maxChars} 字（基准 ${targetChars} 字）`
    }
  };
}

module.exports = {
  lowerToPrompt
};
