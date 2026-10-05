'use strict';

/**
 * @file ir-lowering.js
 * 创作策略 IR 降级渲染器 (Strategy IR Lowering Engine)
 * 
 * 核心功能：
 * 1. 将模型无关的 StrategyIR 下沉渲染为针对特定大模型架构的最佳提示词形态（支持 Claude XML 标签、GPT 尾部强化 Markdown、DeepSeek 中文叙事框架、Local LLM 高密度压缩）；
 * 2. 严格执行“抽象规则优先、微示例示范、失败模式警戒、严禁小说原句大段直出”的降级过滤纪律；
 * 3. 彻底剥除旧版硬编码的“动作-对白交错律”与模板化三幕闪回指令；
 * 4. 支持针对目标模型的分词器校准 Token 消耗评估。
 */

const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g;

const TOKENIZER_RATIOS = {
  // o200k_base (GPT-4o, GPT-5.6-Luna, Grok 4.5/4.6)
  o200k_base: { cjkRatio: 0.70, nonCjkRatio: 0.30 },
  // cl100k_base (GPT-4)
  cl100k_base: { cjkRatio: 0.85, nonCjkRatio: 0.32 },
  // Claude tokenizer (Claude 3.5 Sonnet / Opus)
  claude: { cjkRatio: 0.75, nonCjkRatio: 0.30 },
  // DeepSeek tokenizer (DeepSeek V3 / R1)
  deepseek: { cjkRatio: 0.72, nonCjkRatio: 0.28 },
  // Qwen tokenizer (Qwen 2.5 / Plus / Max)
  qwen: { cjkRatio: 0.68, nonCjkRatio: 0.28 },
  // Local / standard fallback
  standard: { cjkRatio: 0.75, nonCjkRatio: 0.30 }
};

/**
 * 校验并估算提示词 Token 消耗（模型分词器校准）
 * @param {string} text 待测提示词
 * @param {Object} options 降级选项
 * @returns {number} 估算的 Token 数量
 */
function estimatePromptTokens(text, options = {}) {
  const str = String(text || '');
  if (!str) return 0;

  const modelFamily = String(options.targetModelFamily || options.modelFamily || 'generic').toLowerCase();
  const tokenizerKey = options.tokenizer || (
    modelFamily.includes('gpt') || modelFamily.includes('o1') || modelFamily.includes('o3') ? 'o200k_base' :
    modelFamily.includes('claude') ? 'claude' :
    modelFamily.includes('deepseek') ? 'deepseek' :
    modelFamily.includes('qwen') || modelFamily.includes('llama') || modelFamily.includes('local') ? 'qwen' :
    'standard'
  );

  const ratios = TOKENIZER_RATIOS[tokenizerKey] || TOKENIZER_RATIOS.standard;
  const cjkMatches = str.match(CJK_REGEX);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const nonCjkCount = str.length - cjkCount;

  const rawTokens = Math.ceil(cjkCount * ratios.cjkRatio + nonCjkCount * ratios.nonCjkRatio);
  const safetyMargin = Number(options.safetyMargin) || 1.05;
  return Math.ceil(rawTokens * safetyMargin);
}

/**
 * 解析并归一化目标模型家族
 */
function resolveModelFamily(options = {}, strategyIR = {}) {
  const raw = String(
    options.targetModelFamily ||
    options.modelFamily ||
    options.modelId ||
    strategyIR.metadata?.targetModelFamily ||
    ''
  ).toLowerCase().trim();

  if (raw.includes('claude')) return 'claude';
  if (raw.includes('gpt') || raw.includes('openai') || raw.includes('o1') || raw.includes('o3')) return 'gpt';
  if (raw.includes('deepseek')) return 'deepseek';
  if (raw.includes('qwen') || raw.includes('llama') || raw.includes('mistral') || raw.includes('local')) return 'local';
  return 'generic';
}

/**
 * Claude 架构定制渲染器 (XML 语义边界，防止 Prompt Bleed，上下文置于任务之前)
 */
function renderForClaude(cascade, strategyIR, contextText, userInstructionText, targetWordRange) {
  const systemPrompt = [
    '<system_directives>',
    '<hard_constraints>',
    cascade.P0_HARD_CONSTRAINTS,
    '</hard_constraints>',
    cascade.P2_CREATION_BIBLE ? `<creation_bible>\n${cascade.P2_CREATION_BIBLE}\n</creation_bible>` : '',
    '<genre_policy>',
    cascade.P4_GENRE_POLICY,
    '</genre_policy>',
    '<style_policy>',
    cascade.P5_STYLE_POLICY,
    '</style_policy>',
    '<focus_budget>',
    cascade.P6_FOCUS_BUDGET,
    '</focus_budget>',
    '<hook_policy>',
    cascade.P7_HOOK_POLICY,
    '</hook_policy>',
    '</system_directives>'
  ].filter(Boolean).join('\n');

  const userPrompt = [
    '<narrative_context>',
    contextText,
    '</narrative_context>',
    '<chapter_task>',
    cascade.P1_USER_DIRECTIVE,
    '</chapter_task>',
    '<outcome_contract>',
    cascade.P3_CHAPTER_OBJECTIVE,
    '</outcome_contract>',
    cascade.P8_EVIDENCE ? `<evidence_guidance>\n${cascade.P8_EVIDENCE}\n</evidence_guidance>` : ''
  ].filter(Boolean).join('\n\n');

  return { systemPrompt, userPrompt };
}

/**
 * GPT 架构定制渲染器 (清晰 Markdown 层级，尾部 Recency Reinforcement 强化字数与视点遵从)
 */
function renderForGpt(cascade, strategyIR, contextText, userInstructionText, targetWordRange) {
  const { min, max, target } = targetWordRange;
  const pov = strategyIR.hardConstraints?.narrativePov || '第三人称限制视角';

  const systemPrompt = [
    '### P0 核心物理与字数围栏',
    cascade.P0_HARD_CONSTRAINTS,
    cascade.P2_CREATION_BIBLE ? `\n### P2 创作圣经\n${cascade.P2_CREATION_BIBLE}` : '',
    '\n### P4 题材策略',
    cascade.P4_GENRE_POLICY,
    '\n### P5 文风质感策略',
    cascade.P5_STYLE_POLICY,
    '\n### P6 镜头与笔墨预算分配',
    cascade.P6_FOCUS_BUDGET,
    '\n### P7 钩子与因果债务策略',
    cascade.P7_HOOK_POLICY
  ].filter(Boolean).join('\n');

  const userPrompt = [
    '### 只读故事上下文\n' + contextText,
    '### P1 用户指令\n' + cascade.P1_USER_DIRECTIVE,
    '### P3 结果契约与状态跃迁\n' + cascade.P3_CHAPTER_OBJECTIVE,
    cascade.P8_EVIDENCE ? '### P8 策略卡引导\n' + cascade.P8_EVIDENCE : '',
    `### 执行确认 (Recency Reinforcement)\n- 目标篇幅：${min} ~ ${max} 字（基准 ${target} 字）\n- 视点准则：${pov}\n- 最终指令：只写原创中文正文，直接从第一句叙事动作展开，严禁前言与解释性旁白。`
  ].filter(Boolean).join('\n\n');

  return { systemPrompt, userPrompt };
}

/**
 * DeepSeek 架构定制渲染器 (原生中文文学语境化，凸显暗流、因果与留白标尺)
 */
function renderForDeepSeek(cascade, strategyIR, contextText, userInstructionText, targetWordRange) {
  const systemPrompt = [
    '【底层物理与创作硬界】\n' + cascade.P0_HARD_CONSTRAINTS,
    cascade.P2_CREATION_BIBLE ? '【创作圣经·全局基因】\n' + cascade.P2_CREATION_BIBLE : '',
    '【题材基石与矛盾主轴】\n' + cascade.P4_GENRE_POLICY,
    '【笔触规范与留白标尺】\n' + cascade.P5_STYLE_POLICY,
    '【镜头焦距与软预算】\n' + cascade.P6_FOCUS_BUDGET,
    '【章末余波与暗流因果】\n' + cascade.P7_HOOK_POLICY
  ].filter(Boolean).join('\n\n');

  const userPrompt = [
    '【现场因果前情】\n' + contextText,
    cascade.P1_USER_DIRECTIVE,
    '【核心位移契约·状态跃迁】\n' + cascade.P3_CHAPTER_OBJECTIVE,
    cascade.P8_EVIDENCE ? '【推演逻辑与因果暗流参考】\n' + cascade.P8_EVIDENCE : ''
  ].filter(Boolean).join('\n\n');

  return { systemPrompt, userPrompt };
}

/**
 * Local LLM 定制渲染器 (精简紧凑指令，适应短注意力与小上下文窗口)
 */
function renderForLocal(cascade, strategyIR, contextText, userInstructionText, targetWordRange) {
  const { min, max, target } = targetWordRange;
  const hard = strategyIR.hardConstraints || {};
  const book = strategyIR.bookIdentity || {};
  const style = strategyIR.stylePolicy || {};
  const focus = strategyIR.focusPolicy || {};
  const hook = strategyIR.hookPolicy || {};
  const outcome = strategyIR.chapterOutcomeContract || {};

  const systemPrompt = [
    `[物理约束] 字数:${min}-${max}字(基准${target}) | 视点:${hard.narrativePov || '第三人称'}${hard.viewpointCharacter ? '【' + hard.viewpointCharacter + '】' : ''} | 禁载:${(hard.forbiddenKnowledge || []).join('、') || '无'}`,
    `[题材策略] ${book.genre?.name || '通用'}: ${(book.genre?.coreConflicts || []).join('、') || '核心推进'}`,
    `[文风准则] 风格:${style.name || '沉稳'} | 规范:${(style.positiveRules || []).slice(0, 2).join('；') || '现场实感'} | 禁忌:${(style.negativeRules || []).slice(0, 2).join('；') || '拒绝空洞'}`,
    `[镜头分配] 重点:${(focus.priorityTiers?.dominant || []).join('、')} | 钩子:${hook.name || '悬念'}`
  ].join('\n');

  const stateBeforeStr = typeof outcome.stateDelta?.stateBefore === 'object'
    ? JSON.stringify(outcome.stateDelta.stateBefore)
    : (outcome.stateDelta?.stateBefore || '初始');
  const stateAfterStr = typeof outcome.stateDelta?.stateAfter === 'object'
    ? JSON.stringify(outcome.stateDelta.stateAfter)
    : (outcome.stateDelta?.stateAfter || '推进');

  const userPrompt = [
    `[前情] ${contextText}`,
    `[目标] ${outcome.objectiveName || '核心推进'}: 章前【${stateBeforeStr}】 -> 章后【${stateAfterStr}】`,
    `[指令] ${userInstructionText || '推进剧情'}`,
    '[要求] 直接输出原创中文正文，严禁大纲、前言或总结。'
  ].join('\n\n');

  return { systemPrompt, userPrompt };
}

/**
 * 通用基线渲染器 (标准 Markdown，向下兼容)
 */
function renderGeneric(cascade, strategyIR, contextText, userInstructionText, targetWordRange) {
  const systemPrompt = [
    cascade.P0_HARD_CONSTRAINTS,
    cascade.P2_CREATION_BIBLE,
    cascade.P4_GENRE_POLICY,
    cascade.P5_STYLE_POLICY,
    cascade.P6_FOCUS_BUDGET,
    cascade.P7_HOOK_POLICY
  ].filter(Boolean).join('\n\n');

  const userPrompt = [
    '【前情与环境上下文】\n' + contextText,
    cascade.P1_USER_DIRECTIVE,
    cascade.P3_CHAPTER_OBJECTIVE,
    cascade.P8_EVIDENCE
  ].filter(Boolean).join('\n\n');

  return { systemPrompt, userPrompt };
}

/**
 * 将 StrategyIR 渲染降级为模型提示词
 * @param {Object} strategyIR 规范化的 StrategyIR 实体
 * @param {Object} options 降级选项 (targetModelFamily, contextText, userInstruction)
 * @returns {Object} 包含 systemPrompt, userPrompt, priorityCascade, wordBudget, modelFamily, tokens 的提示词包
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
  const targetWordRange = { target: targetChars, min: minChars, max: maxChars };

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
  cascade.P8_NEGATIVE_GUARDS = (Array.isArray(hardConstraints.negativeGuards) && hardConstraints.negativeGuards.length)
    ? hardConstraints.negativeGuards.join('\n')
    : '严禁“嘴角勾起一抹弧度”、严禁“倒吸一口凉气”等套路AI腔调。';
  cascade.P3_OUTCOME_CONTRACT = cascade.P3_CHAPTER_OBJECTIVE;
  cascade.P7_EVIDENCE_CARDS = cascade.P8_EVIDENCE;
  cascade.P5_FOCUS_BUDGET = cascade.P6_FOCUS_BUDGET;

  // =========================================================================
  // 目标模型家族分发与分层渲染 (Model-Family Dispatch & Partitioning)
  // =========================================================================
  const resolvedFamily = resolveModelFamily(options, strategyIR);
  const contextText = typeof options.chapterContext === 'string'
    ? options.chapterContext
    : (options.context || '');

  let rendered;
  if (resolvedFamily === 'claude') {
    rendered = renderForClaude(cascade, strategyIR, contextText, userInstruction, targetWordRange);
  } else if (resolvedFamily === 'gpt') {
    rendered = renderForGpt(cascade, strategyIR, contextText, userInstruction, targetWordRange);
  } else if (resolvedFamily === 'deepseek') {
    rendered = renderForDeepSeek(cascade, strategyIR, contextText, userInstruction, targetWordRange);
  } else if (resolvedFamily === 'local') {
    rendered = renderForLocal(cascade, strategyIR, contextText, userInstruction, targetWordRange);
  } else {
    rendered = renderGeneric(cascade, strategyIR, contextText, userInstruction, targetWordRange);
  }

  const { systemPrompt, userPrompt } = rendered;

  return {
    systemPrompt,
    userPrompt,
    priorityCascade: Object.freeze(cascade),
    wordBudget: {
      target: targetChars,
      targetChars,
      min: minChars,
      minChars,
      max: maxChars,
      maxChars,
      summary: `${minChars} ~ ${maxChars} 字（基准 ${targetChars} 字）`
    },
    modelFamily: resolvedFamily,
    tokens: {
      systemTokens: estimatePromptTokens(systemPrompt, { targetModelFamily: resolvedFamily }),
      userTokens: estimatePromptTokens(userPrompt, { targetModelFamily: resolvedFamily }),
      totalTokens: estimatePromptTokens(systemPrompt + '\n\n' + userPrompt, { targetModelFamily: resolvedFamily }),
      targetModelFamily: resolvedFamily,
      calibrated: true
    }
  };
}

module.exports = {
  lowerToPrompt,
  estimatePromptTokens,
  resolveModelFamily,
  TOKENIZER_RATIOS
};
