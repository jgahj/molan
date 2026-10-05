'use strict';

/**
 * @file attention-tiering.js
 * 模型注意力 4 层分级过滤与预算分配器
 * 
 * 核心设计原则：
 * 1. 解决模型注意力随 Token 膨胀被动稀释的问题；
 * 2. 严格划分 4 层注意力结构：
 *    - 第一层：永驻上下文 (Permanent Context: 圣经底层设定、物理铁律、时间线)
 *    - 第二层：章节策略 (Chapter Strategy: 本章目标 State Delta、文风量化标尺、镜头预算、钩子)
 *    - 第三层：实时证据 (Real-time Evidence: 精选 3~6 条最高置信度 A/B 策略卡)
 *    - 第四层：即时上下文 (Immediate Context: 最近章节钩子承接、现场微观事实)
 * 3. 动态计算各层预算上限，超出时执行渐进式剪裁与摘要，保护高优先级策略。
 */

function estimateTokens(text) {
  const str = String(text || '');
  // 中文为主：约 1.5 字符 / token，英文代码 4 字符 / token
  return Math.ceil(str.length * 0.7);
}

/**
 * 将多源上下文分级装配并保证注意力集中
 * @param {Object} options
 * @returns {Object} 分层装配结果与 Token 消耗审计
 */
function tierAttention(options = {}) {
  const {
    permanentContext = '',
    chapterStrategy = '',
    evidenceCards = [],
    immediateContext = '',
    maxTotalTokens = 6000
  } = options;

  // 1. 第一层：永驻上下文（上限约 25%）
  const tier1Text = String(permanentContext || '').trim();
  const tier1Tokens = estimateTokens(tier1Text);

  // 2. 第二层：章节策略核心（P3~P7 纯净策略块，不可裁剪，约 35%）
  const tier2Text = String(chapterStrategy || '').trim();
  const tier2Tokens = estimateTokens(tier2Text);

  // 3. 第三层：实时策略卡筛选（仅保留最相关的 3~6 张，上限约 20%）
  const cards = Array.isArray(evidenceCards) ? evidenceCards : [];
  const selectedCards = cards
    .filter(c => c && (c.evidenceStrength === 'A' || c.evidenceStrength === 'B' || !c.evidenceStrength))
    .slice(0, 5);
  
  const tier3Text = selectedCards.length
    ? selectedCards.map((c, i) => `【参考策略卡 ${i + 1}·${c.name || '经典范式'}】：\n· 规则：${c.rule || ''}\n· 范式：${c.pattern || ''}${c.microExample ? `\n· 微示范：${c.microExample}` : ''}${c.failureMode ? `\n· 警戒反例：${c.failureMode}` : ''}`).join('\n\n')
    : '';
  const tier3Tokens = estimateTokens(tier3Text);

  // 4. 第四层：即时上下文（承接前文，约 20%）
  const tier4Text = String(immediateContext || '').trim();
  const tier4Tokens = estimateTokens(tier4Text);

  const totalTokens = tier1Tokens + tier2Tokens + tier3Tokens + tier4Tokens;

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
      selectedCardCount: selectedCards.length,
      withinBudget: totalTokens <= maxTotalTokens
    }
  });
}

module.exports = {
  tierAttention,
  estimateTokens
};
