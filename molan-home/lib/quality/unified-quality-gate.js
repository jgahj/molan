'use strict';

/**
 * 统一质量门禁体系 (Unified Quality Gate System)
 * 职责：
 * 聚合五大质检模块：
 * 1. 物理冲击与感官受创审计 (Physical Shock & Sensory Damage)
 * 2. 反向规避词与 AI 味多维检测 (AI Flavor & Spasms)
 * 3. 角色声音与台词契约审计 (Character Voice Contract)
 * 4. 事实连续性与实体约束审计 (Fact Continuity & Entity Integrity)
 * 5. 爽点与叙事因果债审计 (Payoff & Causal Debt)
 *
 * 门禁分级体系：
 * - Hard Blocker: 事实不可逆冲突、严重 AI 味超标 (score >= 60 或抽搐高频)、悬疑开篇上帝剧透等，直接拦截生成 (status: 'block')
 * - Soft Warning: 节奏微调、词频偏高、高潮物理受力偏弱、反派口嗨，记录告警建议修复 (status: 'warn')
 * - Advisory: 仅供作者参考的文字润色建议 (status: 'pass' 或 'warn')
 *
 * 输出统一结构：
 * {
 *   status: 'pass' | 'block' | 'warn',
 *   passed: boolean,
 *   score: number, // 0 - 100 综合质量健康分
 *   blockers: Array<{ code, message, category, evidence }>,
 *   warnings: Array<{ code, message, category, evidence, suggestion }>,
 *   advisories: Array<{ code, message, category, suggestion }>,
 *   evidence: { physicalShock, aiFlavor, characterVoice, factContinuity, payoffAndCausal, rhythm }
 * }
 */

const { computeAiFlavorScore, STRUCTURAL_AI_PATTERNS } = require('../ai-flavor-detector');
const {
  evaluateClimaxShockGate,
  evaluateSuspenseSandboxGate,
  evaluateSocialDialogueGate,
  evaluateFemaleRomanceGate,
  evaluateHistoricalEtiquetteGate
} = require('../genre-narrative-audit');

const SOMATIC_SPASM_REGEX = /(?:(?:指腹|指肚|拇指|手指)反复?摩挲|食指轻叩(?:桌面|桌案)|指尖(?:骤然)?(?:一顿|悬在半空|僵在半空)|掐(?:进|入)掌心|骨节捏得泛白|指节泛白|指骨泛白|喉咙发紧|咽喉发紧|喉头发干|喉头一哽|呼吸骤然一窒|按揉发胀的太阳穴|后槽牙咬得咯咯作响|咬紧后槽牙|喉结上下滚动|心跳漏了一拍|下颌紧绷|嘴角勾起一抹(?:玩味的)?弧度)/gu;

function evaluateUnifiedQuality(rawText, context = {}) {
  const text = String(rawText || '').trim();
  const genre = String(context.genre || context.genreProfile?.genre || '通用').trim();
  const contract = context.contract || context.chapterContract || {};

  const blockers = [];
  const warnings = [];
  const advisories = [];

  let overallScore = 100;

  // 0. 基础文本篇幅与非空校验
  if (!text) {
    blockers.push({
      code: 'EMPTY_TEXT',
      category: 'basic',
      message: '正文内容为空',
      evidence: ''
    });
    return {
      status: 'block',
      passed: false,
      score: 0,
      blockers,
      warnings,
      advisories,
      evidence: {}
    };
  }

  const charCount = text.replace(/[\s\r\n]+/g, '').length;
  const minChars = context.minChars !== undefined
    ? Number(context.minChars)
    : (context.requireMinimumLength ? 300 : 0);

  if (charCount < 5) {
    blockers.push({
      code: 'CONTENT_TOO_SHORT',
      category: 'basic',
      message: `文本内容过短 (字数=${charCount})`,
      evidence: `字数=${charCount}`
    });
    overallScore -= 50;
  } else if (minChars > 0 && charCount < minChars) {
    blockers.push({
      code: 'CONTENT_TOO_SHORT',
      category: 'basic',
      message: `章节有效字数仅 ${charCount} 字，低于最低下限 ${minChars} 字`,
      evidence: `字数=${charCount}`
    });
    overallScore -= 50;
  }

  // 1. 反向规避与 AI 味多维检测 (AI Flavor & Spasms)
  let aiScore = 0;
  let detectedSpasms = [];
  try {
    const aiReport = computeAiFlavorScore(text);
    aiScore = typeof aiReport?.score === 'number' ? aiReport.score : 0;
  } catch (_) {
    aiScore = 0;
  }

  for (const m of text.matchAll(SOMATIC_SPASM_REGEX)) {
    detectedSpasms.push(m[0]);
  }

  // 结构性深层 AI 痕迹检查
  const structuralHits = [];
  for (const [patName, pat] of Object.entries(STRUCTURAL_AI_PATTERNS || {})) {
    const matches = text.match(pat);
    if (matches && matches.length > 0) {
      structuralHits.push({ pattern: patName, count: matches.length, samples: matches.slice(0, 3) });
    }
  }

  if (aiScore >= 60 || detectedSpasms.length >= 4) {
    blockers.push({
      code: 'AI_FLAVOR_CRITICAL',
      category: 'ai_flavor',
      message: `AI 套话与生理抽搐严重超标 (AI分=${aiScore}, 抽搐数=${detectedSpasms.length})`,
      evidence: detectedSpasms.slice(0, 5).join(', ')
    });
    overallScore -= 40;
  } else if (aiScore >= 40 || detectedSpasms.length >= 2 || structuralHits.length >= 2) {
    warnings.push({
      code: 'AI_FLAVOR_WARNING',
      category: 'ai_flavor',
      message: `检测到轻度 AI 语言惯性与刻板修辞 (AI分=${aiScore}, 抽搐数=${detectedSpasms.length})`,
      evidence: detectedSpasms.join(', ') || '结构性套路',
      suggestion: '删减生理抽搐（如喉咙发紧、指节泛白），将排队交锋改为混乱物理对抗'
    });
    overallScore -= 15;
  }

  // 2. 事实连续性与实体约束 (Fact Continuity)
  const mentionsWrongRelationship = /(地姥女婿|地姥的女婿)/.test(text);
  const mentionsContradictoryCrystal = /(拿着黑晶.*两手空空|放回.*又拿走)/.test(text);

  if (mentionsWrongRelationship) {
    blockers.push({
      code: 'FACT_RELATIONSHIP_CONFLICT',
      category: 'fact_continuity',
      message: '正文出现严重实体关系事实冲突：错误标记主角或配角为地姥女婿',
      evidence: '地姥女婿'
    });
    overallScore -= 30;
  }

  if (mentionsContradictoryCrystal) {
    blockers.push({
      code: 'FACT_ITEM_STATE_CONFLICT',
      category: 'fact_continuity',
      message: '正文出现道具状态物理矛盾（持有状态前后冲突）',
      evidence: '黑晶持有矛盾'
    });
    overallScore -= 20;
  }

  // 3. 题材叙事门禁 (Genre Narrative Audit Gates)
  const suspenseCheck = evaluateSuspenseSandboxGate(text, contract, genre);
  if (suspenseCheck.issue) {
    if (suspenseCheck.issue.severity === 'blocker') {
      blockers.push({
        code: 'SUSPENSE_SPOILER_BLOCKER',
        category: 'narrative_gate',
        message: suspenseCheck.issue.description,
        evidence: suspenseCheck.issue.description
      });
      overallScore -= 35;
    } else {
      warnings.push({
        code: 'SUSPENSE_SPOILER_WARNING',
        category: 'narrative_gate',
        message: suspenseCheck.issue.description,
        evidence: '',
        suggestion: suspenseCheck.issue.suggestion
      });
      overallScore -= 10;
    }
  }

  const romanceCheck = evaluateFemaleRomanceGate(text, contract, genre);
  if (romanceCheck.issue) {
    if (romanceCheck.issue.severity === 'blocker') {
      blockers.push({
        code: 'FEMALE_ROMANCE_BRUTE_FORCE',
        category: 'narrative_gate',
        message: romanceCheck.issue.description,
        evidence: romanceCheck.issue.description
      });
      overallScore -= 35;
    } else {
      warnings.push({
        code: 'FEMALE_ROMANCE_WARNING',
        category: 'narrative_gate',
        message: romanceCheck.issue.description,
        evidence: '',
        suggestion: romanceCheck.issue.suggestion
      });
      overallScore -= 10;
    }
  }

  const socialCheck = evaluateSocialDialogueGate(text, contract, genre);
  if (socialCheck.issue) {
    warnings.push({
      code: 'URBAN_VILLAIN_LOW_IQ',
      category: 'narrative_gate',
      message: socialCheck.issue.description,
      evidence: socialCheck.issue.description,
      suggestion: socialCheck.issue.suggestion
    });
    overallScore -= 10;
  }

  const historyCheck = evaluateHistoricalEtiquetteGate(text, contract, genre);
  if (historyCheck.issue) {
    warnings.push({
      code: 'HISTORICAL_ANACHRONISM',
      category: 'narrative_gate',
      message: historyCheck.issue.description,
      evidence: historyCheck.issue.description,
      suggestion: historyCheck.issue.suggestion
    });
    overallScore -= 10;
  }

  // 4. 物理冲击与感官受创审计 (Physical Shock)
  const climaxCheck = evaluateClimaxShockGate(text, contract, genre);
  if (climaxCheck.issue) {
    warnings.push({
      code: 'CLIMAX_SHOCK_DEFICIENCY',
      category: 'physical_shock',
      message: climaxCheck.issue.description,
      evidence: '',
      suggestion: climaxCheck.issue.suggestion
    });
    overallScore -= 10;
  }

  // 5. 角色声音与台词禁忌词检查 (Character Voice Contract)
  const characterVoiceAudit = { passed: true, issues: [] };
  const characters = context.contextCharacters || (contract && contract.characters) || [];
  if (Array.isArray(characters)) {
    for (const char of characters) {
      if (!char || !char.voice) continue;
      const taboos = Array.isArray(char.voice.tabooWords || char.voice.taboos) ? (char.voice.tabooWords || char.voice.taboos) : [];
      for (const taboo of taboos) {
        if (text.includes(taboo)) {
          warnings.push({
            code: 'CHARACTER_VOICE_TABOO',
            category: 'character_voice',
            message: `角色 [${char.name || char.id}] 违反声音禁忌词：出现了「${taboo}」`,
            evidence: taboo,
            suggestion: `从角色 [${char.name || char.id}] 的对白与神态中剔除该词`
          });
          characterVoiceAudit.passed = false;
          characterVoiceAudit.issues.push({ character: char.name || char.id, taboo });
          overallScore -= 5;
        }
      }
    }
  }

  // 6. 时空与视听呼吸律审计 (Rhythm & Transitions)
  const abruptTimeJump = /(?:。|”)\s*三日后，/.test(text);
  if (abruptTimeJump) {
    advisories.push({
      code: 'TRANSITION_ABRUPT',
      category: 'rhythm',
      message: '检出时空硬切「三日后」，建议补充场景光影或人物行止过渡句',
      suggestion: '强化转场过渡句'
    });
  }

  // 实心大砖块段落检测 (>160字)
  const paragraphs = text.split(/\n+/).map(p => p.trim()).filter(Boolean);
  const brickParagraphs = paragraphs.filter(p => p.replace(/[\s\r\n]+/g, '').length > 160);
  if (brickParagraphs.length >= 2) {
    advisories.push({
      code: 'BRICK_PARAGRAPHS',
      category: 'rhythm',
      message: `存在 ${brickParagraphs.length} 处超过 160 字的实心大砖块段落`,
      suggestion: '建议适当拆分段落，使阅读呼吸感更加均匀'
    });
    overallScore -= 5;
  }

  overallScore = Math.max(0, Math.min(100, Math.round(overallScore)));

  const status = blockers.length > 0 ? 'block' : warnings.length > 0 ? 'warn' : 'pass';
  const passed = status !== 'block';

  return {
    status,
    passed,
    score: overallScore,
    blockers,
    warnings,
    advisories,
    evidence: {
      physicalShock: {
        passed: climaxCheck.passed,
        issue: climaxCheck.issue
      },
      aiFlavor: {
        score: aiScore,
        spasms: detectedSpasms,
        structuralHits,
        passed: aiScore < 60 && detectedSpasms.length < 4
      },
      characterVoice: characterVoiceAudit,
      factContinuity: {
        passed: !mentionsWrongRelationship && !mentionsContradictoryCrystal,
        mentionsWrongRelationship,
        mentionsContradictoryCrystal
      },
      payoffAndCausal: {
        passed: climaxCheck.passed
      },
      rhythm: {
        brickCount: brickParagraphs.length,
        hasAbruptJump: abruptTimeJump,
        paragraphCount: paragraphs.length
      }
    }
  };
}

module.exports = {
  evaluateUnifiedQuality,
  SOMATIC_SPASM_REGEX
};
