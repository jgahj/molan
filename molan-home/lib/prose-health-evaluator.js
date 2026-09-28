'use strict';

/**
 * @file prose-health-evaluator.js
 * 正文健康度与合规质检评估引擎 (Prose Health & Compliance Evaluator)
 * 职责：
 * 1. 视听呼吸律评估：段长分布、实心大砖块检测（>160字未换行）；
 * 2. 去AI味生理抽搐评分：调用 computeAiFlavorScore，对零抽搐给予极高评级；
 * 3. 核心道具与关键原话履约率：核对提示词中的道具与台词是否已全数具象登场；
 * 4. 章末钩子与悬念强度评估：检测结尾是否具备扣人心弦的伏笔、警告或反转；
 * 5. 综合评级 (S/A/B/C) 与针对性改写建议。
 */

const { computeAiFlavorScore } = require('./ai-flavor-detector');

const SOMATIC_SPASM_PATTERN = /(?:(?:指腹|指肚|拇指|手指)反复?摩挲|食指轻叩(?:桌面|桌案)|指尖(?:骤然)?(?:一顿|悬在半空|僵在半空)|掐(?:进|入)掌心|骨节捏得泛白|指节泛白|指骨泛白|指骨发白|喉咙发紧|咽喉发紧|喉头发干|喉头一哽|呼吸骤然一窒|按揉发胀的太阳穴|后槽牙咬得咯咯作响|咬紧后槽牙|喉结上下滚动|心跳漏了一拍|下颌紧绷|嘴角勾起一抹(?:玩味的)?弧度)/gu;

function cleanChineseText(text) {
  return String(text || '').replace(/[\s\r\n]+/g, '');
}

/**
 * 评估小说正文健康度与网文合规指标
 * @param {string} rawText 章节正文
 * @param {Object} [metadata] 包含 keyProps, keyQuotes, targetMin, targetMax, title 等
 * @param {Object} [options] 额外选项
 * @returns {Object} 全维健康报告
 */
function evaluateChapterHealth(rawText, metadata = {}, options = {}) {
  const text = String(rawText || '').trim();
  const totalChars = cleanChineseText(text).length;

  // 1. 段落与呼吸律审计
  const paragraphs = text
    .split(/\n+/)
    .map(p => p.trim())
    .filter(Boolean);

  const paragraphCount = paragraphs.length;
  const paragraphLengths = paragraphs.map(p => cleanChineseText(p).length);
  const avgParagraphLen = paragraphCount > 0 ? Math.round(totalChars / paragraphCount) : 0;
  const maxParagraphLen = paragraphLengths.length > 0 ? Math.max(...paragraphLengths) : 0;

  // 实心大砖块段落（超 160 汉字未换行）
  const brickParagraphs = [];
  paragraphs.forEach((p, idx) => {
    const len = cleanChineseText(p).length;
    if (len > 160) {
      brickParagraphs.push({
        index: idx + 1,
        length: len,
        snippet: p.slice(0, 40) + '...'
      });
    }
  });

  // 单句独占行过度检测（连续5段以上小于15字碎片）
  let fragmentedCount = 0;
  paragraphs.forEach(p => {
    if (cleanChineseText(p).length <= 15) fragmentedCount += 1;
  });
  const fragmentationRate = paragraphCount > 0 ? (fragmentedCount / paragraphCount) : 0;

  let rhythmScore = 100;
  if (brickParagraphs.length > 0) rhythmScore -= brickParagraphs.length * 15;
  if (fragmentationRate > 0.45) rhythmScore -= 20;
  if (avgParagraphLen > 140) rhythmScore -= 15;
  rhythmScore = Math.max(20, Math.min(100, rhythmScore));

  // 2. 去 AI 味与生理抽搐评估
  let aiFlavorReport;
  try {
    aiFlavorReport = computeAiFlavorScore(text);
  } catch (_) {
    aiFlavorReport = { score: 0, matches: [], passed: true };
  }

  const detectedSpasms = [];
  for (const m of text.matchAll(SOMATIC_SPASM_PATTERN)) {
    detectedSpasms.push(m[0]);
  }
  const spasmCount = detectedSpasms.length;
  const flavorScore = typeof aiFlavorReport.score === 'number' ? aiFlavorReport.score : 0;
  let flavorGradeScore = Math.max(0, 100 - flavorScore * 25 - spasmCount * 30);

  // 3. 关键道具与核心台词履约率
  const propsExpected = Array.isArray(metadata.keyProps) ? metadata.keyProps : [];
  const propsFulfilled = [];
  const propsMissing = [];

  propsExpected.forEach(prop => {
    const cleanProp = String(prop || '').replace(/^[《“"']|[》”"']$/g, '').trim();
    if (!cleanProp) return;
    if (text.includes(cleanProp)) {
      propsFulfilled.push(cleanProp);
    } else {
      propsMissing.push(cleanProp);
    }
  });

  const quotesExpected = Array.isArray(metadata.keyQuotes) ? metadata.keyQuotes : [];
  const quotesFulfilled = [];
  const quotesMissing = [];

  quotesExpected.forEach(quote => {
    const cleanQuote = String(quote || '').replace(/^[“"']|[”"']$/g, '').trim();
    if (!cleanQuote) return;
    // 允许忽略轻微标点差异的匹配
    const normQuote = cleanQuote.replace(/[，。！？、…—\s]/g, '');
    const normText = text.replace(/[，。！？、…—\s]/g, '');
    if (text.includes(cleanQuote) || (normQuote.length >= 4 && normText.includes(normQuote))) {
      quotesFulfilled.push(cleanQuote);
    } else {
      quotesMissing.push(cleanQuote);
    }
  });

  const totalReqItems = propsExpected.length + quotesExpected.length;
  const fulfilledItems = propsFulfilled.length + quotesFulfilled.length;
  const fulfillmentRate = totalReqItems > 0 ? (fulfilledItems / totalReqItems) : 1.0;

  // 4. 章末悬念与强钩子评估
  const tailText = text.slice(-300);
  const hookSignals = /(？|\?|！|!|……|\.{3,}|危险|小心|究竟|秘密|没有活人|别回|倒霉|等着|死定了|变数|阴谋|杀机|冷笑|谁|怎么可能)/;
  const hasHook = hookSignals.test(tailText);
  let hookScore = hasHook ? 95 : 60;
  if (tailText.includes('？') || tailText.includes('?')) hookScore += 5;
  hookScore = Math.min(100, hookScore);

  // 5. 篇幅达标度
  const targetMin = Number(metadata.targetMin) || 2000;
  const targetMax = Number(metadata.targetMax) || 3500;
  let wordCountStatus = 'optimal';
  if (totalChars < targetMin * 0.8) wordCountStatus = 'too_short';
  else if (totalChars > targetMax * 1.3) wordCountStatus = 'too_long';

  // 6. 综合评级
  // S级：字数达标 + 零生理抽搐 + 无砖块段落 + 关键道具台词100%兑现 + 章末有强钩子
  const suggestions = [];
  if (brickParagraphs.length > 0) {
    suggestions.push(`发现 ${brickParagraphs.length} 处超过 160 字的实心大段（第 ${brickParagraphs.map(b => b.index).join('、')} 段），建议拆分为复合短句提升阅读呼吸感。`);
  }
  if (spasmCount > 0) {
    suggestions.push(`检出 ${spasmCount} 处常见 AI 生理抽搐词（如 ${detectedSpasms.slice(0, 3).join('、')}），建议替换为具体动作行为。`);
  }
  if (propsMissing.length > 0) {
    suggestions.push(`关键道具【${propsMissing.join('、')}】未在正文中明显登场，建议在对应冲突中加强具象化运用。`);
  }
  if (quotesMissing.length > 0) {
    suggestions.push(`指定核心原话【“${quotesMissing.join('”、“')}”】未完整呈现，建议由对应角色自然道出推进局势。`);
  }
  if (!hasHook) {
    suggestions.push('章末叙事略显平缓，建议在最后两段追加危机反转、警告或悬念问句以增强追读欲望。');
  }

  let grade = 'S';
  const compositeScore = Math.round(
    rhythmScore * 0.25 +
    flavorGradeScore * 0.35 +
    (fulfillmentRate * 100) * 0.25 +
    hookScore * 0.15
  );

  if (spasmCount > 2 || brickParagraphs.length > 2 || fulfillmentRate < 0.6) {
    grade = 'B';
  } else if (spasmCount > 0 || brickParagraphs.length > 0 || fulfillmentRate < 0.9 || !hasHook) {
    grade = 'A';
  } else if (compositeScore >= 90) {
    grade = 'S';
  } else {
    grade = 'A';
  }

  return {
    ok: true,
    grade,
    compositeScore,
    totalChars,
    wordCountStatus,
    targetBounds: [targetMin, targetMax],
    rhythm: {
      score: rhythmScore,
      paragraphCount,
      avgParagraphLen,
      maxParagraphLen,
      brickParagraphCount: brickParagraphs.length,
      brickParagraphs
    },
    aiFlavor: {
      score: flavorGradeScore,
      spasmCount,
      passed: spasmCount === 0 && (aiFlavorReport ? aiFlavorReport.passed !== false : true),
      detectedSpasms
    },
    fulfillment: {
      rate: Math.round(fulfillmentRate * 100),
      props: {
        expected: propsExpected,
        fulfilled: propsFulfilled,
        missing: propsMissing
      },
      quotes: {
        expected: quotesExpected,
        fulfilled: quotesFulfilled,
        missing: quotesMissing
      }
    },
    hook: {
      score: hookScore,
      hasHook,
      tailSnippet: tailText.slice(-100)
    },
    suggestions
  };
}

module.exports = {
  evaluateChapterHealth
};
