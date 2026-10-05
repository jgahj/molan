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
 * 对 Tier 1 永驻上下文（创作圣经/底层物理）执行渐进式摘要
 */
function summarizePermanentContext(text, targetMaxTokens, options) {
  let str = String(text || '').trim();
  if (!str) return '';

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

  // Pass 3: Compact invariant digest
  const maxChars = Math.max(60, Math.floor(targetMaxTokens / 0.8));
  const truncated = candidate.slice(0, maxChars);
  return `【底层物理与世界法则摘要】: ${truncated}…`;
}

/**
 * 保护关键策略项前提下裁减 Tier 2 章节策略 (P3 State Delta 与 P4 绝不假定为核心保留项)
 */
function pruneChapterStrategyWithCriticalRetention(strategyText, targetMaxTokens, options) {
  if (estimateTokens(strategyText, options) <= targetMaxTokens) return strategyText;

  const blocks = strategyText.split(/\n\n+/);
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
      block.includes('题材边界绝不假定')
    );
    if (isCritical) {
      criticalBlocks.push(block);
    } else {
      softBlocks.push(block);
    }
  }

  // 关键项绝对保留
  let retained = [...criticalBlocks];

  // 尝试加入次要软项
  for (const sb of softBlocks) {
    const nextTokens = estimateTokens([...retained, sb].join('\n\n'), options);
    if (nextTokens <= targetMaxTokens) {
      retained.push(sb);
    }
  }

  return retained.join('\n\n');
}

/**
 * 对 Tier 4 即时上下文（前文承接）进行逆向截断（保留最新段落以维持即时因果）
 */
function pruneImmediateContext(text, targetMaxTokens, options) {
  let str = String(text || '').trim();
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

  const maxChars = Math.max(40, Math.floor(targetMaxTokens / 0.8));
  return str.slice(-maxChars);
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

  // 2. 主动预算控制与截断执行
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

    // 阶段 B: 对 Tier 1 永驻规则执行渐进式摘要
    if (totalTokens > maxTotalTokens && tier1Text) {
      const maxTier1Budget = Math.max(100, Math.floor(maxTotalTokens * 0.20));
      tier1Text = summarizePermanentContext(tier1Text, maxTier1Budget, tokenOpts);
      tier1Tokens = estimateTokens(tier1Text, tokenOpts);
      totalTokens = tier1Tokens + tier2Tokens + tier3Tokens + tier4Tokens;
      pruningActions.push('progressive_summarization_tier1');
    }

    // 阶段 C: 对 Tier 4 即时上下文执行尾部因果截断
    if (totalTokens > maxTotalTokens && tier4Text) {
      const maxTier4Budget = Math.max(100, Math.floor(maxTotalTokens * 0.20));
      tier4Text = pruneImmediateContext(tier4Text, maxTier4Budget, tokenOpts);
      tier4Tokens = estimateTokens(tier4Text, tokenOpts);
      totalTokens = tier1Tokens + tier2Tokens + tier3Tokens + tier4Tokens;
      pruningActions.push('truncated_immediate_context');
    }

    // 阶段 D: 若仍超额，在关键保留守则（P3/P4）前提下剪裁 Tier 2 次要部分
    if (totalTokens > maxTotalTokens && tier2Text) {
      const remainingForTier2 = Math.max(200, maxTotalTokens - tier1Tokens - tier3Tokens - tier4Tokens);
      tier2Text = pruneChapterStrategyWithCriticalRetention(tier2Text, remainingForTier2, tokenOpts);
      tier2Tokens = estimateTokens(tier2Text, tokenOpts);
      totalTokens = tier1Tokens + tier2Tokens + tier3Tokens + tier4Tokens;
      pruningActions.push('pruned_tier2_critical_retention');
    }
  }

  return Object.freeze({
    tier1Permanent: tier1Text,
    tier2Strategy: tier2Text,
    tier3Evidence: tier3Text,
    tier4Immediate: tier4Text,
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
  TOKENIZER_RATIOS
};
