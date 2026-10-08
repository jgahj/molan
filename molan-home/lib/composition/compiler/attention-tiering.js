'use strict';

/**
 * @file attention-tiering.js
 * 模型注意力 4 层分级过滤与预算分配器 (Active Attention Tiering Engine)
 * 
 * 核心设计原则：
 * 1. 解决模型注意力随 Token 膨胀被动稀释的问题；
 * 2. 严格划分 4 层注意力结构：
 *    - 第一层：永驻上下文 (Permanent Context: 创作圣经底层设定、物理铁律、时间线)
 *    - 第二层：章节策略 (Chapter Strategy: 本章目标 State Delta、文风量化标尺、镜头预算、钩子)
 *    - 第三层：实时证据 (Real-time Evidence: 动态评分精选高置信度 A/B 策略卡)
 *    - 第四层：即时上下文 (Immediate Context: 最近章节钩子承接、现场微观事实)
 * 3. 多因子评分排序：relevance * evidenceStrength * currentObjective
 * 4. 主动预算控制与截断：超额时对 Tier 1 进行渐进式摘要，严格保护 Tier 2 关键项（P3 结果契约、P4 题材边界绝不假定），动态剔除低分证据卡，确保 totalTokens <= maxTotalTokens。
 */

const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g;

const TOKENIZER_RATIOS = {
  o200k_base: { cjkRatio: 0.70, nonCjkRatio: 0.30 },
  cl100k_base: { cjkRatio: 0.85, nonCjkRatio: 0.32 },
  claude: { cjkRatio: 0.75, nonCjkRatio: 0.30 },
  deepseek: { cjkRatio: 0.72, nonCjkRatio: 0.28 },
  qwen: { cjkRatio: 0.68, nonCjkRatio: 0.28 },
  standard: { cjkRatio: 0.75, nonCjkRatio: 0.30 }
};

/**
 * 校验并估算文本 Token 消耗（模型分词器校准）
 * @param {string} text 待测文本
 * @param {Object} options 模型族或分词器选项
 * @returns {number} 估算的 Token 数量
 */
function estimateTokens(text, options = {}) {
  const str = String(text || '');
  if (!str) return 0;

  const modelFamily = String(options.targetModelFamily || options.modelFamily || '').toLowerCase();
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
 * 提取文本关键词辅助相关度计算
 */
function extractKeywords(text) {
  const clean = String(text || '').trim();
  const rawParts = clean.split(/[^\u4e00-\u9fa5a-zA-Z0-9]+/);
  const keywords = new Set();
  for (const part of rawParts) {
    if (part.length >= 2) keywords.add(part);
  }
  return Array.from(keywords);
}

/**
 * 多因子策略卡打分函数：Score = relevance * evidenceStrength * currentObjective
 * @param {Object} card 证据策略卡
 * @param {Object} options 上下文与策略参数
 * @returns {Object} 评分详情
 */
function scoreEvidenceCard(card, options = {}) {
  // 1. Evidence Strength
  const strength = String(card.evidenceStrength || card.strength || '').toUpperCase();
  let strengthWeight = 0.7; // default neutral
  if (strength === 'A') strengthWeight = 1.0;
  else if (strength === 'B') strengthWeight = 0.8;
  else if (strength === 'C') strengthWeight = 0.5;
  else if (strength === 'D') strengthWeight = 0.2;

  // 2. Relevance
  let relevance = 0.6;
  if (typeof card.relevance === 'number') {
    relevance = Math.max(0.1, Math.min(1.0, card.relevance));
  } else {
    const contextStr = String(options.chapterStrategy || options.chapterContext || options.spec?.genre?.name || '');
    const cardText = `${card.name || ''} ${card.rule || card.ruleStatement || ''} ${card.pattern || card.abstractPattern || ''} ${(Array.isArray(card.tags) ? card.tags : []).join(' ')}`;
    const cardWords = extractKeywords(cardText);
    let matchCount = 0;
    for (const w of cardWords) {
      if (contextStr.includes(w)) matchCount++;
    }
    if (matchCount > 0) {
      relevance = Math.min(1.0, 0.6 + Math.min(0.4, matchCount * 0.1));
    }
  }

  // 3. Current Objective Alignment
  let currentObjective = 0.6;
  if (typeof card.currentObjective === 'number') {
    currentObjective = Math.max(0.1, Math.min(1.0, card.currentObjective));
  } else {
    const objectiveStr = String(options.chapterObjective || options.objectiveName || '');
    if (objectiveStr) {
      const cardText = `${card.rule || card.ruleStatement || ''} ${card.pattern || card.abstractPattern || ''}`;
      const objWords = extractKeywords(objectiveStr);
      let matchCount = 0;
      for (const w of objWords) {
        if (cardText.includes(w)) matchCount++;
      }
      if (matchCount > 0) {
        currentObjective = Math.min(1.0, 0.6 + Math.min(0.4, matchCount * 0.15));
      }
    }
  }

  const score = Math.round(relevance * strengthWeight * currentObjective * 1000) / 1000;
  return {
    score,
    relevance,
    strengthWeight,
    currentObjective
  };
}

/**
 * 确定性二分截断文本以绝对满足目标 Token 预算
 * @param {string} text 待截断文本
 * @param {number} targetMaxTokens 目标 Token 上限
 * @param {Object} options 估算选项
 * @returns {string} 截断后的安全子串
 */
function truncateToBudget(text, targetMaxTokens, options = {}) {
  const str = String(text || '').trim();
  if (!str || targetMaxTokens <= 0) return '';
  if (estimateTokens(str, options) <= targetMaxTokens) return str;

  let low = 0;
  let high = str.length;
  let best = '';

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = str.slice(0, mid);
    const tokens = estimateTokens(candidate, options);
    if (tokens <= targetMaxTokens) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best.trim();
}

/**
 * 对单个关键策略块执行渐进式浓缩 (Compaction)
 * @param {string} block 原始关键块
 * @param {number} level 浓缩级别 (1: 关键行过滤, 2: 元组化超紧凑)
 * @returns {string} 浓缩后文本
 */
function compactCriticalBlock(block, level = 1) {
  const str = String(block || '').trim();
  if (!str) return '';

  if (level === 1) {
    const lines = str.split('\n').map(l => l.trim()).filter(Boolean);
    const preserved = lines.filter(line => (
      line.includes('P0 绝对事实') ||
      line.includes('硬性预算') ||
      line.includes('叙事视角准则') ||
      line.includes('状态跃迁契约') ||
      line.includes('State Delta') ||
      line.includes('本章核心目标') ||
      line.includes('章前状态') ||
      line.includes('章后状态') ||
      line.includes('推进事件') ||
      line.includes('存在性检验') ||
      line.includes('题材边界绝不假定') ||
      line.includes('绝不假定')
    ));
    if (preserved.length > 0) {
      return preserved.map(l => l.replace(/^[·\-\*•\s]+/, '').trim()).join('\n');
    }
    return lines.slice(0, 2).join('\n');
  }

  // Level 2: 超紧凑元组化浓缩
  const tuples = [];
  if (str.includes('P0 绝对事实') || str.includes('硬性预算') || str.includes('叙事视角准则')) {
    const bMatch = str.match(/(?:硬性预算[：:\s]*|基准\s*)([^\n·]+)/);
    const pMatch = str.match(/(?:叙事视角准则[：:\s]*|第三人称[^\n·]+)/);
    const bStr = bMatch ? bMatch[1].replace(/^[：:\s]+/, '').trim() : '';
    const pStr = pMatch ? (pMatch[1] || pMatch[0]).replace(/^[：:\s]+/, '').trim() : '';
    const part = ['【P0事实】', bStr ? `预算:${bStr}` : '', pStr ? `视角:${pStr}` : ''].filter(Boolean).join(' ');
    tuples.push(part || '【P0事实】');
  }
  if (str.includes('状态跃迁契约') || str.includes('State Delta') || str.includes('章前状态') || str.includes('章后状态')) {
    const beforeMatch = str.match(/章前状态[：:\s]*([^\n·]+)/);
    const afterMatch = str.match(/章后状态[：:\s]*([^\n·]+)/);
    const existMatch = str.match(/存在性检验[：:\s]*([^\n·]+)/);
    const b = beforeMatch ? beforeMatch[1].trim() : '';
    const a = afterMatch ? afterMatch[1].trim() : '';
    const e = existMatch ? existMatch[1].trim() : '';
    const part = ['【状态契约】', b ? `前:${b}` : '', a ? `后:${a}` : '', e ? `检验:${e}` : ''].filter(Boolean).join(' ');
    tuples.push(part || '【状态契约】');
  }
  if (str.includes('题材边界绝不假定') || str.includes('绝不假定')) {
    const guards = Array.from(str.matchAll(/绝不假定([^\n·]+)/g)).map(m => m[1].trim());
    if (guards.length > 0) {
      tuples.push(`【绝不假定】${guards.join(';')}`);
    } else {
      tuples.push('【绝不假定】');
    }
  }

  if (tuples.length > 0) {
    return tuples.join('\n');
  }

  return str.split('\n')[0].trim();
}

/**
 * 对 Tier 1 永驻上下文（创作圣经/底层物理）执行渐进式摘要
 */
function summarizePermanentContext(text, targetMaxTokens, options) {
  let str = String(text || '').trim();
  if (!str || targetMaxTokens <= 0) return '';

  // Pass 1: Whitespace / formatting trim
  str = str.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  if (estimateTokens(str, options) <= targetMaxTokens) return str;

  // Pass 2: Extract invariant statements (lines with 法则, 铁律, 绝不, 必须, 禁止, or bullet points)
  const lines = str.split('\n').map(l => l.trim()).filter(Boolean);
  const invariantKeywords = ['法则', '铁律', '绝不', '必须', '禁止', '严禁', '不可', '恒定', '底层', '世界'];
  const invariantLines = lines.filter(line => 
    invariantKeywords.some(kw => line.includes(kw)) || line.startsWith('·') || line.startsWith('-') || line.startsWith('*')
  );

  let candidate = invariantLines.length ? invariantLines.join('\n') : lines.slice(0, 3).join('\n');
  if (estimateTokens(candidate, options) <= targetMaxTokens) return candidate;

  // Pass 3: 确定性二分截断保障，保留开头铁律关键词
  return truncateToBudget(candidate, targetMaxTokens, options);
}

/**
 * 保护关键策略项前提下裁减 Tier 2 章节策略 (P3 State Delta 与 P4 绝不假定为核心保留项)
 */
function pruneChapterStrategyWithCriticalRetention(strategyText, targetMaxTokens, options = {}) {
  if (targetMaxTokens <= 0) return '';
  if (estimateTokens(strategyText, options) <= targetMaxTokens) return strategyText;

  const blocks = strategyText.split(/\n\n+/).filter(Boolean);
  const criticalBlocks = [];
  const softBlocks = [];

  for (const block of blocks) {
    const isCritical = (
      block.includes('P0 绝对事实') ||
      block.includes('硬性预算') ||
      block.includes('叙事视角准则') ||
      block.includes('状态跃迁契约') ||
      block.includes('State Delta') ||
      block.includes('本章核心目标') ||
      block.includes('存在性检验') ||
      block.includes('题材边界绝不假定') ||
      block.includes('绝不假定')
    );
    if (isCritical) {
      criticalBlocks.push(block);
    } else {
      softBlocks.push(block);
    }
  }

  // 1. 无关键项：贪心保留软项或截断
  if (criticalBlocks.length === 0) {
    const retained = [];
    for (const sb of softBlocks) {
      const candidate = [...retained, sb].join('\n\n');
      if (estimateTokens(candidate, options) <= targetMaxTokens) {
        retained.push(sb);
      }
    }
    if (retained.length > 0) return retained.join('\n\n');
    return truncateToBudget(softBlocks[0] || '', targetMaxTokens, options);
  }

  // 2. 关键项原始组合若能在预算内容纳，绝对完整保留，并尝试追加软项（保持单测兼容性）
  const uncompressedTokens = estimateTokens(criticalBlocks.join('\n\n'), options);
  if (uncompressedTokens <= targetMaxTokens) {
    const retained = [...criticalBlocks];
    for (const sb of softBlocks) {
      const candidate = [...retained, sb].join('\n\n');
      if (estimateTokens(candidate, options) <= targetMaxTokens) {
        retained.push(sb);
      }
    }
    return retained.join('\n\n');
  }

  // 3. 关键项原始超额：Level 1 清洗排版
  const l1Blocks = criticalBlocks.map(b => compactCriticalBlock(b, 1)).filter(Boolean);
  const l1Tokens = estimateTokens(l1Blocks.join('\n\n'), options);
  if (l1Tokens <= targetMaxTokens) {
    return l1Blocks.join('\n\n');
  }

  // 4. 仍超额：Level 2 元组化浓缩
  const l2Blocks = criticalBlocks.map(b => compactCriticalBlock(b, 2)).filter(Boolean);
  const l2Tokens = estimateTokens(l2Blocks.join('\n\n'), options);
  if (l2Tokens <= targetMaxTokens) {
    return l2Blocks.join('\n\n');
  }

  // 5. 多个关键块过多：按优先级贪心选取
  const prioritized = [];
  for (const block of l2Blocks) {
    const candidate = [...prioritized, block].join('\n\n');
    if (estimateTokens(candidate, options) <= targetMaxTokens) {
      prioritized.push(block);
    }
  }
  if (prioritized.length > 0) {
    return prioritized.join('\n\n');
  }

  // 6. 极端预算（如 targetMaxTokens = 15 或单行超长 CJK 文本）：二分截断首要关键块
  const primaryCritical = l2Blocks[0] || l1Blocks[0] || criticalBlocks[0];
  return truncateToBudget(primaryCritical, targetMaxTokens, options);
}

/**
 * 对 Tier 4 即时上下文（前文承接）进行逆向截断（保留最新段落以维持即时因果）
 */
function pruneImmediateContext(text, targetMaxTokens, options = {}) {
  let str = String(text || '').trim();
  if (!str || targetMaxTokens <= 0) return '';
  if (estimateTokens(str, options) <= targetMaxTokens) return str;

  const paras = str.split(/\n\n+/).filter(Boolean);
  const retained = [];
  for (let i = paras.length - 1; i >= 0; i--) {
    const candidate = [paras[i], ...retained].join('\n\n');
    if (estimateTokens(candidate, options) <= targetMaxTokens) {
      retained.unshift(paras[i]);
    } else {
      break;
    }
  }

  if (retained.length > 0) {
    return retained.join('\n\n');
  }

  // 逆向二分截断（保留最新尾部）
  let low = 0;
  let high = str.length;
  let best = '';
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = str.slice(str.length - mid);
    const tokens = estimateTokens(candidate, options);
    if (tokens <= targetMaxTokens) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best.trim();
}

/**
 * 最终注意力预算硬断言 (Mathematical Invariant Assertion)
 * @param {number} actualTotalTokens 实际总 Token
 * @param {number} maxTotalTokens 允许的最大 Token
 * @param {Object} context 附加上下文信息
 * @returns {boolean} 满足时返回 true
 */
function FINAL_BUDGET_ASSERT(actualTotalTokens, maxTotalTokens, context = {}) {
  const current = Number(actualTotalTokens) || 0;
  const max = Number(maxTotalTokens) || 0;

  if (current > max || (max <= 0 && current > 0)) {
    const error = new Error(`BUDGET_EXCEEDED: totalTokens (${current}) strictly exceeds maxTotalTokens (${max})`);
    error.code = 'BUDGET_EXCEEDED';
    error.status = 402;
    error.statusCode = 402;
    error.details = {
      totalTokens: current,
      maxTotalTokens: max,
      overflow: current - max,
      ...context
    };
    throw error;
  }
  return true;
}

/**
 * 将多源上下文分级装配并保证注意力集中与主动预算控制
 * @param {Object} options
 * @returns {Object} 分层装配结果与 Token 消耗审计
 */
function tierAttention(options = {}) {
  const {
    permanentContext = '',
    chapterStrategy = '',
    evidenceCards = [],
    immediateContext = '',
    maxTotalTokens = 6000,
    targetModelFamily = 'generic'
  } = options;

  const tokenOpts = { targetModelFamily };

  // 0. 极端边界处理：maxTotalTokens <= 0
  const hasContent = Boolean(
    String(permanentContext || '').trim() ||
    String(chapterStrategy || '').trim() ||
    (Array.isArray(evidenceCards) && evidenceCards.length > 0) ||
    String(immediateContext || '').trim()
  );
  if (maxTotalTokens <= 0) {
    if (hasContent) {
      const err = new Error(`BUDGET_EXCEEDED: maxTotalTokens is ${maxTotalTokens} but non-empty attention payload provided`);
      err.code = 'BUDGET_EXCEEDED';
      err.status = 402;
      err.statusCode = 402;
      err.details = { maxTotalTokens, totalTokens: estimateTokens(chapterStrategy, tokenOpts) };
      throw err;
    }
    return Object.freeze({
      tier1Permanent: '',
      tier2Strategy: '',
      tier3Evidence: '',
      tier4Immediate: '',
      attention: {
        tier1Permanent: '',
        tier2Strategy: '',
        tier3Evidence: '',
        tier4Immediate: ''
      },
      metrics: {
        tier1Tokens: 0,
        tier2Tokens: 0,
        tier3Tokens: 0,
        tier4Tokens: 0,
        totalTokens: 0,
        maxTotalTokens: 0,
        withinBudget: true,
        pruned: false,
        pruningActions: [],
        selectedCardCount: 0,
        selectedCards: []
      }
    });
  }

  // 1. 第三层策略卡动态多因子评分过滤
  const cards = Array.isArray(evidenceCards) ? evidenceCards : [];
  const scoredCards = [];
  for (const card of cards) {
    if (!card) continue;
    const scoreResult = scoreEvidenceCard(card, options);
    const strength = String(card.evidenceStrength || card.strength || '').toUpperCase();
    // 劣质卡 (Tier D) 或极低分直接过滤
    if (strength === 'D' || scoreResult.score < 0.25) {
      continue;
    }
    scoredCards.push({
      ...card,
      _score: scoreResult.score,
      _scoring: scoreResult
    });
  }

  // 按得分降序排序
  scoredCards.sort((a, b) => b._score - a._score);

  // 初始最多保留 5 张高分策略卡
  let selectedCards = scoredCards.slice(0, 5);

  function buildTier3Text(cardsList) {
    if (!cardsList || cardsList.length === 0) return '';
    return cardsList.map((c, i) => {
      const name = c.name || c.id || '经典范式';
      const rule = c.rule || c.ruleStatement || '';
      const pattern = c.pattern || c.abstractPattern || '';
      const microExample = c.microExample ? `\n· 微示范：${c.microExample}` : '';
      const failureMode = c.failureMode ? `\n· 警戒反例：${c.failureMode}` : '';
      return `【参考策略卡 ${i + 1}·${name}】：\n· 规则：${rule}\n· 范式：${pattern}${microExample}${failureMode}`;
    }).join('\n\n');
  }

  let tier1Text = String(permanentContext || '').trim();
  let tier2Text = String(chapterStrategy || '').trim();
  let tier3Text = buildTier3Text(selectedCards);
  let tier4Text = String(immediateContext || '').trim();

  let tier1Tokens = estimateTokens(tier1Text, tokenOpts);
  let tier2Tokens = estimateTokens(tier2Text, tokenOpts);
  let tier3Tokens = estimateTokens(tier3Text, tokenOpts);
  let tier4Tokens = estimateTokens(tier4Text, tokenOpts);

  let totalTokens = tier1Tokens + tier2Tokens + tier3Tokens + tier4Tokens;
  const pruningActions = [];
  let pruned = false;

  // 2. 主动多阶段预算控制与渐进式截断
  if (totalTokens > maxTotalTokens) {
    pruned = true;

    // 阶段 A: 主动剔除低顺位证据卡
    while (selectedCards.length > 0 && totalTokens > maxTotalTokens) {
      const removedCard = selectedCards.pop();
      tier3Text = buildTier3Text(selectedCards);
      tier3Tokens = estimateTokens(tier3Text, tokenOpts);
      totalTokens = tier1Tokens + tier2Tokens + tier3Tokens + tier4Tokens;
      pruningActions.push(`pruned_evidence_card: ${removedCard.name || removedCard.id || 'card'}`);
    }

    // 阶段 B: 对 Tier 1 永驻规则执行渐进式摘要（移除 100 硬编码底线）
    if (totalTokens > maxTotalTokens && tier1Text) {
      const maxTier1Budget = Math.max(1, Math.floor(maxTotalTokens * 0.20));
      tier1Text = summarizePermanentContext(tier1Text, maxTier1Budget, tokenOpts);
      tier1Tokens = estimateTokens(tier1Text, tokenOpts);
      totalTokens = tier1Tokens + tier2Tokens + tier3Tokens + tier4Tokens;
      pruningActions.push('progressive_summarization_tier1');
    }

    // 阶段 C: 对 Tier 4 即时上下文执行尾部因果截断（移除 100 硬编码底线）
    if (totalTokens > maxTotalTokens && tier4Text) {
      const maxTier4Budget = Math.max(1, Math.floor(maxTotalTokens * 0.20));
      tier4Text = pruneImmediateContext(tier4Text, maxTier4Budget, tokenOpts);
      tier4Tokens = estimateTokens(tier4Text, tokenOpts);
      totalTokens = tier1Tokens + tier2Tokens + tier3Tokens + tier4Tokens;
      pruningActions.push('truncated_immediate_context');
    }

    // 阶段 D: 若仍超额，在关键保留守则前提下剪裁/浓缩 Tier 2（移除 200 硬编码底线）
    if (totalTokens > maxTotalTokens && tier2Text) {
      const remainingForTier2 = Math.max(0, maxTotalTokens - tier1Tokens - tier3Tokens - tier4Tokens);
      tier2Text = pruneChapterStrategyWithCriticalRetention(tier2Text, remainingForTier2, tokenOpts);
      tier2Tokens = estimateTokens(tier2Text, tokenOpts);
      totalTokens = tier1Tokens + tier2Tokens + tier3Tokens + tier4Tokens;
      pruningActions.push('pruned_tier2_critical_retention');
    }

    // 阶段 E: 极端紧缩（压制 Tier 4 与 Tier 1，让位给关键策略）
    if (totalTokens > maxTotalTokens && tier4Text) {
      tier4Text = '';
      tier4Tokens = 0;
      totalTokens = tier1Tokens + tier2Tokens + tier3Tokens + tier4Tokens;
      pruningActions.push('suppressed_tier4_for_critical_budget');
    }
    if (totalTokens > maxTotalTokens && tier1Text) {
      tier1Text = '';
      tier1Tokens = 0;
      totalTokens = tier1Tokens + tier2Tokens + tier3Tokens + tier4Tokens;
      pruningActions.push('suppressed_tier1_for_critical_budget');
    }

    // 阶段 F: 终极确定性二分截断保障
    if (totalTokens > maxTotalTokens && tier2Text) {
      const remaining = Math.max(0, maxTotalTokens - tier1Tokens - tier3Tokens - tier4Tokens);
      tier2Text = truncateToBudget(tier2Text, remaining, tokenOpts);
      tier2Tokens = estimateTokens(tier2Text, tokenOpts);
      totalTokens = tier1Tokens + tier2Tokens + tier3Tokens + tier4Tokens;
      pruningActions.push('compacted_tier2_hard_boundary');
    }
  }

  // 3. 最终硬预算不变式断言 (FINAL_BUDGET_ASSERT)
  FINAL_BUDGET_ASSERT(totalTokens, maxTotalTokens, {
    tier1Tokens,
    tier2Tokens,
    tier3Tokens,
    tier4Tokens,
    pruningActions
  });

  return Object.freeze({
    tier1Permanent: tier1Text,
    tier2Strategy: tier2Text,
    tier3Evidence: tier3Text,
    tier4Immediate: tier4Text,
    attention: {
      tier1Permanent: tier1Text,
      tier2Strategy: tier2Text,
      tier3Evidence: tier3Text,
      tier4Immediate: tier4Text
    },
    metrics: {
      tier1Tokens,
      tier2Tokens,
      tier3Tokens,
      tier4Tokens,
      totalTokens,
      maxTotalTokens,
      withinBudget: totalTokens <= maxTotalTokens,
      pruned,
      pruningActions,
      selectedCardCount: selectedCards.length,
      selectedCards: selectedCards.map(c => ({
        ...c,
        card: c,
        score: c._score || 0
      }))
    }
  });
}

module.exports = {
  tierAttention,
  estimateTokens,
  scoreEvidenceCard,
  pruneChapterStrategyWithCriticalRetention,
  truncateToBudget,
  compactCriticalBlock,
  FINAL_BUDGET_ASSERT,
  TOKENIZER_RATIOS
};
