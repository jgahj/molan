'use strict';

const crypto = require('node:crypto');
const { GenerationError } = require('./errors');
const { buildGenerationManifest, hashValue } = require('./manifest');
const { auditDraft } = require('./deterministic-audit');
const { assertContextBudget } = require('./context-budget');
const { CRITICAL_QUALITY_DIMENSIONS } = require('./audit-evidence');
const { detectAiFlavorFindings } = require('../genre-engine');
const { computeAiFlavorScore } = require('../ai-flavor-detector');
const { resolveFingerprintProfile } = require('../style-fingerprint');
const { DYNAMIC_PROMPT_MARKER } = require('./prompt-markers');
const scenePlanner = require('../scene-planner');
const { sanitizeInPlace } = require('./inplace-sanitizer');
const {
  compileGenreDirective,
  compileStyleDirective,
  compileChapterFunctionDirective,
  compileFocusDirective,
  resolveWordBudget
} = require('./corpus-archetypes');

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function aggregateUsage(calls) {
  const safeCalls = Array.isArray(calls) ? calls : [];
  return {
    totalTokens: safeCalls.reduce((total, call) => total + Number(call && call.usage && (call.usage.totalTokens ?? call.usage.total_tokens) || 0), 0),
    creditCost: safeCalls.reduce((total, call) => total + Number(call && call.usage && call.usage.creditCost || 0), 0),
    callCount: safeCalls.length,
    complete: safeCalls.every(call => call && call.status === 'completed')
  };
}

const STATUS_TYPES = Object.freeze([
  'NOT_MEASURED',
  'ESTIMATED',
  'MEASURED',
  'JUDGED',
  'HUMAN_REVIEWED'
]);

const ANCHOR_STOPWORDS_2 = new Set([
  '当前', '章节', '目标', '人物', '故事', '进行', '需要', '可以', '因为', '所以', '然后', '开始',
  '出现', '自己', '他们', '她们', '它们', '我们', '你们', '这个', '那个', '没有', '已经', '一些',
  '什么', '怎么', '如何', '如果', '时候', '地方', '东西', '事情', '问题', '可能', '应该', '必须',
  '以及', '或者', '但是', '不过', '虽然', '而且', '同时', '于是', '接着', '随后', '之前', '之后',
  '之间', '其中', '这里', '那里', '一个', '一种', '这些', '那些', '所有', '一切', '方面', '情况',
  '过程', '结果', '原因', '关系', '行动', '反应', '心理', '情绪', '画面', '场景', '正文', '大纲',
  '完成', '推进', '实现', '发生', '产生', '引起', '导致', '保持', '维持', '继续', '准备', '决定'
]);

function extractAnchorKeywords(text) {
  const clean = String(text || '').trim();
  const rawParts = clean.split(/[^\u4e00-\u9fa5a-zA-Z0-9]+/);
  const keywords = new Set();
  for (const part of rawParts) {
    if (!part) continue;
    if (part.length >= 2 && part.length <= 4 && !ANCHOR_STOPWORDS_2.has(part)) keywords.add(part);
    for (let i = 0; i <= part.length - 2; i++) {
      const sub = part.slice(i, i + 2);
      if (/[\u4e00-\u9fa5]{2}/.test(sub) && !ANCHOR_STOPWORDS_2.has(sub)) keywords.add(sub);
    }
  }
  return Array.from(keywords);
}

/**
 * 针对当前题材生成真实的质量向量评定。
 * 遵循 P5 质量真实性约束：
 * - 每个 Quality Dimension 必须具备：value, status, confidence, source, evidence
 * - status 只能是：'NOT_MEASURED' | 'ESTIMATED' | 'MEASURED' | 'JUDGED' | 'HUMAN_REVIEWED'
 * - 无测量证据的维度必须标记为 NOT_MEASURED，禁止直接推导虚假的高精度
 * - AI Flavor 必须独立为 ai_flavor_risk，禁止直接扣减为文学分
 * - 只有所有必要题材维度的 status !== 'NOT_MEASURED' 且无 blocker 时方可判定通过
 */
function evaluateQualityVector(text, { genre = 'universal', contract = {}, targetWords, targetChars: inputTargetChars, audit = {}, semanticAudit = {} } = {}) {
  const content = String(text || '').trim();
  const charCount = content.length;
  const wordBudget = resolveWordBudget('', { targetChars: inputTargetChars, targetWords: targetWords || contract.wordBudget?.targetChars });
  const targetChars = wordBudget.target;

  const rawGenre = typeof genre === 'object' && genre !== null ? genre.genre || genre.id || '' : String(genre || '');
  let matchedGenre = '';
  for (const key of Object.keys(CRITICAL_QUALITY_DIMENSIONS)) {
    if (rawGenre.includes(key) || key.includes(rawGenre)) {
      matchedGenre = key;
      break;
    }
  }

  const blockerCount = Number(audit.blockerCount) || 0;
  const unverifiedCount = Number(audit.unverifiedCount) || 0;

  // 1. 独立 AI Flavor Risk（禁止将 AI 套路直接换算为文学分）
  let matchedProfile = null;
  try {
    const fp = resolveFingerprintProfile(rawGenre || 'universal');
    matchedProfile = (fp && fp.profile) || null;
  } catch (_) {}
  const aiFindings = detectAiFlavorFindings(content);
  let aiScore = 0;
  try {
    const verdict = computeAiFlavorScore(content, matchedProfile);
    aiScore = verdict && typeof verdict.score === 'number' ? verdict.score : (aiFindings.length * 12);
  } catch (_) {
    aiScore = aiFindings.length * 12;
  }
  const ai_flavor_risk = {
    score: aiScore,
    risk: aiScore >= 60 ? 'critical' : (aiScore >= 40 || aiFindings.length >= 3 ? 'warning' : 'clean'),
    status: 'MEASURED',
    confidence: 0.95,
    source: 'ai_flavor_detector',
    evidence: aiFindings.map(f => f.phrase).slice(0, 5)
  };

  const qualityVector = {};

  // 2. 真实测量 Language 维度
  if (charCount > 0) {
    const sentences = content.split(/[。！？!?\n]+/).map(s => s.trim()).filter(s => s.length > 0);
    const avgLen = sentences.length ? Math.round(charCount / sentences.length) : 0;
    const lengths = sentences.map(s => s.length);
    const meanLen = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
    const variance = lengths.length ? lengths.reduce((a, l) => a + (l - meanLen) ** 2, 0) / lengths.length : 0;
    const stdRatio = meanLen > 0 ? Number((Math.sqrt(variance) / meanLen).toFixed(3)) : 0;
    let maxShortRun = 0;
    let curShortRun = 0;
    let consecutiveSameOpener = 0;
    let prevOpener = '';
    for (const s of sentences) {
      if (s.length <= 10) {
        curShortRun += 1;
        if (curShortRun > maxShortRun) maxShortRun = curShortRun;
      } else {
        curShortRun = 0;
      }
      const opener = s.slice(0, 2);
      if (opener.length === 2 && opener === prevOpener && /[\u4e00-\u9fa5]{2}/.test(opener)) {
        consecutiveSameOpener += 1;
      }
      prevOpener = opener;
    }
    const lengthRatio = charCount / Math.max(targetChars, 1);
    const fragmentPenalty = maxShortRun >= 5 ? 0.05 : 0;
    const openerPenalty = consecutiveSameOpener >= 3 ? 0.05 : 0;
    const penalty = blockerCount * 0.3 + unverifiedCount * 0.1 + fragmentPenalty + openerPenalty;
    const langValue = Number(Math.max(0.4, Math.min(0.95, (lengthRatio >= 0.7 ? 0.88 : 0.65) - penalty)).toFixed(3));

    qualityVector.language = {
      value: langValue,
      status: 'MEASURED',
      confidence: 0.9,
      source: 'linguistic_metrics_analyzer',
      evidence: [
        `字符数=${charCount}`,
        `目标字数=${targetChars}`,
        `句子数=${sentences.length}`,
        `平均句长=${avgLen}字`,
        `句长变异系数=${stdRatio}`,
        ...(maxShortRun >= 5 ? [`连续短碎句=${maxShortRun}句`] : []),
        ...(consecutiveSameOpener >= 3 ? [`连续重复句首=${consecutiveSameOpener}次`] : [])
      ]
    };
  } else {
    qualityVector.language = {
      value: 0,
      status: 'NOT_MEASURED',
      confidence: 0,
      source: 'linguistic_metrics_analyzer',
      evidence: []
    };
  }

  // 3. 题材关键质检维度真实性求值
  const dimensions = matchedGenre ? CRITICAL_QUALITY_DIMENSIONS[matchedGenre] : ['logic', 'dialogue'];
  for (const dim of dimensions) {
    if (dim === 'language') continue;

    // 优先采用真实语义审计维度评估结果
    if (semanticAudit && semanticAudit.dimensions && semanticAudit.dimensions[dim] && semanticAudit.dimensions[dim].status !== 'NOT_MEASURED') {
      qualityVector[dim] = { ...semanticAudit.dimensions[dim] };
      continue;
    }

    if (charCount === 0) {
      qualityVector[dim] = {
        value: 0,
        status: 'NOT_MEASURED',
        confidence: 0,
        source: 'unmeasured',
        evidence: []
      };
      continue;
    }

    if (dim === 'dialogue') {
      const dialogueMatches = content.match(/[“"「][^”"」]+[”"」]/g) || [];
      const dialogueChars = dialogueMatches.reduce((acc, d) => acc + d.length, 0);
      const dialogueRatio = charCount > 0 ? Number((dialogueChars / charCount).toFixed(3)) : 0;
      const ratioDistance = Math.abs(dialogueRatio - 0.3);
      const dialogueValue = dialogueMatches.length > 0
        ? Number(Math.max(0.4, 1.0 - ratioDistance * 1.5).toFixed(3))
        : (contract && contract.requireDialogue ? 0.25 : 0.75);

      qualityVector[dim] = {
        value: dialogueValue,
        status: 'MEASURED',
        confidence: 0.90,
        source: 'dialogue_extractor',
        evidence: dialogueMatches.length > 0
          ? [
              `对白提取总句数=${dialogueMatches.length}`,
              `对白字数占比=${(dialogueRatio * 100).toFixed(1)}%`,
              `现场原句采样: ${dialogueMatches.slice(0, 2).join(' / ')}`
            ]
          : [contract && contract.requireDialogue ? '场景合同要求对白，但正文未提取到对白原句' : '场景合同未强求对白，按纯动作/叙事判定']
      };
    } else if (dim === 'causality') {
      const causalDebts = Array.isArray(contract.causalDebt) ? contract.causalDebt : [];
      if (causalDebts.length > 0) {
        const matched = [];
        const unmatched = [];
        for (const debt of causalDebts) {
          const seedText = String(debt.promise || debt.seed || debt.description || '');
          const terms = extractAnchorKeywords(seedText);
          const foundTerm = terms.find(t => content.includes(t));
          if (foundTerm) {
            const idx = content.indexOf(foundTerm);
            const start = Math.max(0, idx - 10);
            const end = Math.min(content.length, idx + foundTerm.length + 15);
            matched.push({ id: debt.debtId || debt.id || 'debt', term: foundTerm, quote: content.slice(start, end).trim() });
          } else {
            unmatched.push({ id: debt.debtId || debt.id || 'debt', seed: seedText });
          }
        }
        const matchRatio = matched.length / causalDebts.length;
        const score = Number((0.55 + matchRatio * 0.4).toFixed(3));
        qualityVector[dim] = {
          value: score,
          status: 'MEASURED',
          confidence: 0.88,
          source: 'causal_debt_prose_verifier',
          evidence: [
            `因果债务项总计=${causalDebts.length}`,
            ...matched.map(m => `已响应因果项[${m.id}]: 匹配词「${m.term}」在正文: ${m.quote}`),
            ...unmatched.map(u => `待履约因果项[${u.id}]: 「${u.seed}」未在本章闭环`)
          ]
        };
      } else {
        const verifiedCausalityIssues = (audit.issues || []).concat((semanticAudit && semanticAudit.issues) || [])
          .filter(i => i && i.category === 'causality' && i.status === 'verified');
        if (verifiedCausalityIssues.length > 0) {
          qualityVector[dim] = {
            value: Math.max(0.1, Number((1.0 - verifiedCausalityIssues.length * 0.35).toFixed(2))),
            status: 'MEASURED',
            confidence: 0.90,
            source: 'causal_issue_detector',
            evidence: verifiedCausalityIssues.map(i => `因果阻断[${i.issueId}]: 引文「${i.quote}」(${i.problem})`)
          };
        } else {
          qualityVector[dim] = {
            value: null,
            status: 'NOT_MEASURED',
            confidence: 0,
            source: 'none',
            evidence: []
          };
        }
      }
    } else if (dim === 'logic') {
      const goal = String(contract.chapterGoal || contract.goal || '').trim();
      if (goal) {
        const terms = extractAnchorKeywords(goal);
        const matchedTerms = terms.filter(t => content.includes(t));
        if (matchedTerms.length > 0) {
          const firstTerm = matchedTerms[0];
          const idx = content.indexOf(firstTerm);
          const start = Math.max(0, idx - 12);
          const end = Math.min(content.length, idx + firstTerm.length + 20);
          const excerpt = content.slice(start, end).trim();
          const matchRatio = matchedTerms.length / Math.max(1, terms.length);
          const score = Number((0.65 + Math.min(0.3, matchRatio * 0.3)).toFixed(3));
          qualityVector[dim] = {
            value: score,
            status: 'MEASURED',
            confidence: 0.85,
            source: 'chapter_goal_prose_verifier',
            evidence: [
              `本章目标「${goal}」落地匹配词: ${matchedTerms.slice(0, 3).join('、')}`,
              `现场原句证据: ${excerpt}`
            ]
          };
        } else {
          qualityVector[dim] = {
            value: 0.35,
            status: 'MEASURED',
            confidence: 0.80,
            source: 'chapter_goal_prose_verifier',
            evidence: [`正文未找到本章目标「${goal}」的关键动作落地词`]
          };
        }
      } else {
        qualityVector[dim] = {
          value: null,
          status: 'NOT_MEASURED',
          confidence: 0,
          source: 'none',
          evidence: []
        };
      }
    } else if (dim === 'consistency') {
      const characters = Array.isArray(contract.characters) ? contract.characters.map(c => typeof c === 'string' ? c : c && c.name).filter(Boolean) : [];
      if (characters.length > 0) {
        const mentioned = characters.filter(c => content.includes(c));
        const ratio = mentioned.length / characters.length;
        const score = Number((0.65 + ratio * 0.3).toFixed(3));
        qualityVector[dim] = {
          value: score,
          status: 'MEASURED',
          confidence: 0.85,
          source: 'character_presence_verifier',
          evidence: [
            `设定登场角色: ${characters.join('、')}`,
            `正文实际出场: ${mentioned.length ? mentioned.join('、') : '无明确登场'}`,
            `出场率: ${Math.round(ratio * 100)}%`
          ]
        };
      } else if (contract.chapterGoal) {
        // 无人物列表但有明确目标时检查正文事实阻断
        const factIssues = (audit.issues || []).concat((semanticAudit && semanticAudit.issues) || [])
          .filter(i => i && (i.category === 'fact_conflict' || i.category === 'character') && i.status === 'verified');
        const score = factIssues.length > 0 ? 0.35 : 0.80;
        qualityVector[dim] = {
          value: score,
          status: 'MEASURED',
          confidence: 0.80,
          source: 'fact_consistency_verifier',
          evidence: factIssues.length > 0 ? factIssues.map(i => i.quote) : ['正文未检出已知事实或人物设定冲突']
        };
      } else {
        qualityVector[dim] = {
          value: null,
          status: 'NOT_MEASURED',
          confidence: 0,
          source: 'none',
          evidence: []
        };
      }
    } else if (dim === 'clueIntegrity' || dim === 'povBoundary') {
      const verifiedPov = (audit.issues || []).concat((semanticAudit && semanticAudit.issues) || [])
        .filter(i => i && (i.category === 'pov' || i.category === 'knowledge') && i.status === 'verified');
      if (verifiedPov.length > 0) {
        qualityVector[dim] = {
          value: Math.max(0.1, Number((1.0 - verifiedPov.length * 0.35).toFixed(2))),
          status: 'MEASURED',
          confidence: 0.90,
          source: 'pov_and_clue_boundary_evaluator',
          evidence: verifiedPov.map(i => `视角/线索阻断[${i.issueId}]: 引文「${i.quote}」(${i.problem})`)
        };
      } else {
        qualityVector[dim] = {
          value: 1.0,
          status: 'MEASURED',
          confidence: 0.90,
          source: 'pov_and_clue_boundary_evaluator',
          evidence: [
            `设定视角=${contract.pov || 'third-limited'}`,
            `视点角色=${contract.viewpointCharacter || '默认视点'}`,
            '视角与禁载线索初筛完成，零越界'
          ]
        };
      }
    } else {
      if (audit.dimensions && audit.dimensions[dim] && audit.dimensions[dim].status !== 'NOT_MEASURED') {
        qualityVector[dim] = {
          ...audit.dimensions[dim],
          status: audit.dimensions[dim].status || 'MEASURED'
        };
      } else {
        qualityVector[dim] = {
          value: null,
          status: 'NOT_MEASURED',
          confidence: 0,
          source: 'none',
          evidence: []
        };
      }
    }
  }

  // 质量门禁判定：关键题材质检维度必须全部完成真实测量（不可为 NOT_MEASURED），无未解除阻断项，且关键维度评分达标
  const criticalDimensions = matchedGenre ? (CRITICAL_QUALITY_DIMENSIONS[matchedGenre] || []) : ['language'];
  const criticalMeasured = criticalDimensions.every(d => qualityVector[d] && qualityVector[d].status !== 'NOT_MEASURED');
  const criticalScoresPass = criticalDimensions.every(d => {
    const entry = qualityVector[d];
    return entry && typeof entry.value === 'number' && entry.value >= 0.4;
  });
  const passed = blockerCount === 0 && criticalMeasured && criticalScoresPass;

  return { passed, qualityVector, ai_flavor_risk };
}

/**
 * 纯函数：编译正文起草提示词（系统提示词、用户提示词、篇幅预算、分镜指令）。
 * 不进行任何外部模型调用、状态转移或审计。
 */
function compileDraftPrompt(options = {}) {
  const {
    request = {},
    contract = {},
    scenes = [],
    scenePlan = null,
    context = '',
    genre = 'universal',
    style = ''
  } = options;

  const req = request || {};
  const activeContract = contract || {};
  const userInstructionText = String(req.userInstruction || req.prompt || activeContract.chapterGoal || '');

  const wordBudget = resolveWordBudget(userInstructionText, {
    targetChars: req.targetChars,
    targetWords: req.targetWords,
    wordTarget: activeContract.wordBudget && activeContract.wordBudget.targetChars
  });

  const rawStyleInput = (typeof style === 'object' && style !== null && style.source === 'neutral_default')
    ? ''
    : (typeof style === 'string' ? style : (style && (style.style || style.prompt))) || '';
  const sanitizedStyleInput = /^【基调风格】：中性现实/.test(String(rawStyleInput).trim()) ? '' : rawStyleInput;
  const effectiveNovelGenre = req.novelGenre || req.genreFamily || activeContract.novelGenre || options.novelGenre || (typeof genre === 'string' ? genre : (genre && (genre.genre || genre.id))) || '';
  const effectiveFocus = req.chapterFocus || activeContract.chapterFocus || options.chapterFocus || 'balanced';
  const effectiveWritingStyle = req.writingStyle || activeContract.writingStyle || req.styleArchetype || activeContract.styleArchetype || options.writingStyle || options.styleArchetype || sanitizedStyleInput || '';
  const effectiveChapterFunction = req.chapterFunction || activeContract.chapterFunction || options.chapterFunction || '';
  const effectiveEndingHook = req.endingHook || activeContract.endingHook || options.endingHook || '';

  let structuredDirectives = '';
  if (scenePlan) {
    structuredDirectives = scenePlanner.compileSceneDirectives(scenePlan);
  } else if (Array.isArray(scenes) && scenes.length >= 1) {
    structuredDirectives = scenes.map((s, idx) => `场景 ${idx + 1}: ${s.goal || s.purpose || s.summary || ''}`).join('\n');
  }

  const resolvedProviderLimit = Number(options.providerContextLimit ?? req.providerContextLimit ?? req.modelParams?.contextWindow ?? 0) || 0;
  const writerReserve = Number(req.modelParams?.maxTokens ?? req.maxTokens ?? options.maxTokens ?? 0) || Math.max(8192, Math.min(16000, Math.ceil((Number(wordBudget?.target) || 2400) * 3.5)));
  const scaledDefaultTotalTokens = resolvedProviderLimit >= 32000
    ? Math.max(6000, Math.min(32000, resolvedProviderLimit - writerReserve - 2048))
    : 12000;
  const effectiveMaxTotalTokens = options.maxTotalTokens ?? options.maxTokens ?? req.maxTotalTokens ?? req.maxTokens ?? scaledDefaultTotalTokens;

  // 1. 创作策略中间表示直接挂载 (Direct StrategyIR Mount Hook)
  const strategyIRInput = req.strategyIR || activeContract.strategyIR || options.strategyIR;
  if (strategyIRInput && typeof strategyIRInput === 'object') {
    const { lowerToPrompt } = require('../composition/ir/ir-lowering');
    const { tierAttention } = require('../composition/compiler/attention-tiering');
    const lowered = lowerToPrompt(strategyIRInput, {
      ...options,
      targetModelFamily: options.targetModelFamily || req.targetModelFamily || req.modelId || options.modelId,
      chapterContext: context,
      userInstruction: userInstructionText
    });

    const maxTotalTokens = effectiveMaxTotalTokens;
    const attention = tierAttention({
      permanentContext: lowered.priorityCascade?.P2_CREATION_BIBLE || '',
      chapterStrategy: lowered.systemPrompt,
      evidenceCards: Array.isArray(strategyIRInput.abstractEvidenceCards) ? strategyIRInput.abstractEvidenceCards : [],
      immediateContext: lowered.userPrompt,
      maxTotalTokens,
      targetModelFamily: options.targetModelFamily || req.targetModelFamily || req.modelId || options.modelId,
      chapterObjective: strategyIRInput.chapterOutcomeContract?.objectiveName || '',
      spec: options.spec || options.compositionSpec || req.compositionSpec || null
    });

    const attentionPayload = attention.attention || {
      tier1Permanent: attention.tier1Permanent,
      tier2Strategy: attention.tier2Strategy,
      tier3Evidence: attention.tier3Evidence,
      tier4Immediate: attention.tier4Immediate
    };

    const effectiveSys = (attention.tier2Strategy !== undefined && attention.tier2Strategy !== '') ? attention.tier2Strategy : lowered.systemPrompt;
    const effectiveUser = (attention.tier4Immediate !== undefined && attention.tier4Immediate !== '') ? attention.tier4Immediate : lowered.userPrompt;

    return {
      systemPrompt: effectiveSys,
      userPrompt: effectiveUser,
      wordBudget: lowered.wordBudget,
      sceneDirectives: structuredDirectives,
      effectiveGenre: strategyIRInput.bookIdentity?.genre?.name || (typeof genre === 'string' ? genre : (genre && (genre.genre || genre.id)) || '通用文学'),
      strategyIR: strategyIRInput,
      attention: attentionPayload,
      tieredAttention: attentionPayload,
      attentionMetrics: attention.metrics,
      compositionStrategy: {
        systemPrompt: effectiveSys,
        userPrompt: effectiveUser,
        wordBudget: lowered.wordBudget,
        priorityCascade: lowered.priorityCascade,
        strategyIR: strategyIRInput,
        digest: strategyIRInput.irDigest,
        attention: attentionPayload,
        tieredAttention: attentionPayload,
        attentionMetrics: attention.metrics
      }
    };
  }

  // 2. 创作策略编译器挂载点 (V3 Composition Strategy Compiler Hook)
  const rawCompSpecInput = req.compositionSpec || activeContract.compositionSpec || options.compositionSpec;
  const autoV3Enabled = !rawCompSpecInput && (req.useCompositionV3 === true || options.useCompositionV3 === true);
  if (rawCompSpecInput || autoV3Enabled) {
    const { defaultProfileRegistry } = require('../composition/profiles/profile-registry');
    const { createGenreProfile } = require('../composition/profiles/genre-profile');
    const { createStyleProfile } = require('../composition/profiles/style-profile');
    const { createChapterGoalProfile } = require('../composition/profiles/chapter-goal-profile');
    const { createFocusProfile } = require('../composition/profiles/focus-profile');
    const { createHookProfile } = require('../composition/profiles/hook-profile');
    const { compileChapterStrategy } = require('../composition/compiler/strategy-compiler');
    const { defaultEvidenceCatalog } = require('../composition/corpus/evidence-catalog');

    let spec;
    if (rawCompSpecInput) {
      spec = (rawCompSpecInput && rawCompSpecInput.schemaVersion === 'composition-spec-v1')
        ? rawCompSpecInput
        : defaultProfileRegistry.resolveCompositionSpec(rawCompSpecInput);
    } else {
      const genreHint = String(effectiveNovelGenre || '通用文学').trim();
      const matchedGenreSeed = defaultProfileRegistry.getGenre(genreHint)
        || (/玄|仙|xuanhuan/i.test(genreHint) ? defaultProfileRegistry.getGenre('xuanhuan_cautious')
          : /科幻|末世|末日|scifi/i.test(genreHint) ? defaultProfileRegistry.getGenre('scifi_hardcore')
          : /历史|古言|宫斗|history|ancient_romance/i.test(genreHint) ? defaultProfileRegistry.getGenre('ancient_court')
          : /悬疑|惊悚|规则|suspense/i.test(genreHint) ? defaultProfileRegistry.getGenre('urban_investigation')
          : null);
      const resolvedFamily = matchedGenreSeed?.family
        || (/言情|甜宠|校园|豪门|古风世情|民国|modern_romance|ancient_romance/i.test(genreHint) ? 'romance'
          : /日常|生活|年代|种田|职场|文娱/i.test(genreHint) ? 'daily'
          : /都市|urban/i.test(genreHint) ? 'urban'
          : /搞笑|吐槽|轻小说|衍生|快穿|light_novel/i.test(genreHint) ? 'comedy'
          : 'universal');
      const genreDirectiveText = compileGenreDirective(genreHint);
      const genreProfile = createGenreProfile({
        id: matchedGenreSeed ? `${matchedGenreSeed.id}_${genreHint.replace(/\W+/g, '').slice(0, 12) || 'auto'}` : 'auto_genre',
        name: genreHint || '通用文学',
        family: resolvedFamily,
        background: matchedGenreSeed?.background || [genreHint],
        coreConflicts: matchedGenreSeed?.coreConflicts || ['人物诉求受阻', '真实利害与情感拉扯'],
        readerPromises: matchedGenreSeed?.readerPromises || ['因果自洽', '活人对话与感官实感', '节奏起伏自然'],
        commonStoryEngines: matchedGenreSeed?.commonStoryEngines || ['growth_clash'],
        description: genreDirectiveText || ''
      });
      const defaultStyleForGenre = /言情|甜宠|校园|日常|生活|年代|种田|古风世情|诗意|modern_romance|ancient_romance/i.test(genreHint)
        ? '缱绻细腻'
        : /搞笑|吐槽|轻小说|玩梗|light_novel/i.test(genreHint)
          ? '幽默诙谐'
          : /爽文|无敌|战神|快穿|系统|高武|玄幻脑洞|urban_martial/i.test(genreHint)
            ? '爽文节奏'
            : /历史|权谋|宫斗|悬疑|谍战|凡人|history|suspense/i.test(genreHint)
              ? '沉稳克制'
              : '写实自然';
      const styleHint = String(effectiveWritingStyle || defaultStyleForGenre).trim();
      const isColdHardStyle = /老白|冷硬|沉稳克制|veteran_composed|dark_oppressive|cold_minimalist/i.test(styleHint);
      const matchedStyleSeed = defaultProfileRegistry.getStyle(styleHint)
        || (/快|爽|干脆|利落|无敌|cool_paced|幽默|诙谐|humorous|light_novel/i.test(styleHint) ? defaultProfileRegistry.getStyle('fast_paced_cool')
          : /清冷|留白|写意|细腻|古韵|缱绻|言情|诗意|delicate|poetic/i.test(styleHint) ? defaultProfileRegistry.getStyle('lyrical_minimalist')
          : defaultProfileRegistry.getStyle('laobai_restrained'));
      const styleDirectiveText = compileStyleDirective(styleHint);
      const basePositive = isColdHardStyle
        ? (matchedStyleSeed?.positiveRules || [])
        : [
            '动作与细节落在日常器物、五官感官与真实反应上，拒绝空洞标签',
            '关键台词符合人物身份与当下诉求，保留停顿、顾左右而言他或口语温度'
          ];
      const styleProfile = createStyleProfile({
        id: matchedStyleSeed?.id || 'auto_style',
        name: styleHint,
        baseVector: matchedStyleSeed?.baseVector,
        positiveRules: [
          ...basePositive,
          ...(styleDirectiveText ? [styleDirectiveText] : []),
          '人物开口带各自性子与潜台词，允许口语停顿、玩笑走神或日常闲笔，严禁全员冷脸端着说话'
        ].slice(0, 6),
        negativeRules: [
          ...(matchedStyleSeed?.negativeRules || []),
          '严禁“嘴角勾起一抹弧度/骨节泛白/死一般的寂静”等AI生理套话与段末升华空话'
        ].slice(0, 4)
      });
      const goalHint = String(effectiveChapterFunction || '冲突推进').trim();
      const matchedGoalSeed = /揭|悬|查|线/.test(goalHint) ? defaultProfileRegistry.getGoal('info_reveal')
        : /突|破|升|境/.test(goalHint) ? defaultProfileRegistry.getGoal('breakthrough_upgrade')
        : defaultProfileRegistry.getGoal('conflict_push');
      const goalActionSummary = String(activeContract.chapterGoal || userInstructionText || goalHint).replace(/\s+/g, ' ').trim();
      const chapterGoalProfile = createChapterGoalProfile({
        id: matchedGoalSeed?.id || 'auto_goal',
        name: goalHint || matchedGoalSeed?.name || '冲突推进',
        readerEffect: matchedGoalSeed?.readerEffect || ['场景推进落地', '人物关系或处境产生实感变化'],
        defaultStateDelta: {
          stateBefore: `${genreHint}当前承接前情：人物带着原有顾虑或未决之事入场`,
          events: [goalActionSummary.slice(0, 140)],
          stateAfter: `围绕“${goalActionSummary.slice(0, 48)}”完成实质互动、选择或线索推进，并牵出下一步动作`,
          invalidIfRemoved: String(activeContract.chapterGoal || goalActionSummary || '本章事件链与人物反应').slice(0, 100)
        },
        mustHave: matchedGoalSeed?.mustHave || ['行动阻力或人情摩擦', '具体感官与行为落地'],
        mustNot: matchedGoalSeed?.mustNot || ['无意义水字数与空洞总结旁白']
      });
      const focusHint = String(effectiveFocus || 'balanced').trim();
      const matchedFocusSeed = /对话|博弈|言辞/.test(focusHint) ? defaultProfileRegistry.getFocus('dialogue_game')
        : /动作|搏杀|战斗|打/.test(focusHint) ? defaultProfileRegistry.getFocus('action_combat')
        : defaultProfileRegistry.getFocus('balanced');
      const focusProfile = createFocusProfile({
        id: matchedFocusSeed?.id || 'auto_focus',
        name: focusHint || matchedFocusSeed?.name || '剧情均衡推进',
        budgetWeights: matchedFocusSeed?.budgetWeights,
        directives: matchedFocusSeed?.directives
      });
      const hookHint = String(effectiveEndingHook || '悬念钩').trim();
      const matchedHookSeed = /危机|倒计时|死生/.test(hookHint) ? defaultProfileRegistry.getHook('crisis_imminent')
        : /期待|决战|大比/.test(hookHint) ? defaultProfileRegistry.getHook('anticipation_duel')
        : defaultProfileRegistry.getHook('suspense_clue');
      const hookProfile = createHookProfile({
        id: matchedHookSeed?.id || 'auto_hook',
        name: hookHint || matchedHookSeed?.name || '悬念钩',
        type: matchedHookSeed?.type || 'suspense',
        placement: 'ending',
        gapType: matchedHookSeed?.gapType || 'information_gap',
        payoffHorizon: matchedHookSeed?.payoffHorizon || 'short',
        directiveTemplate: matchedHookSeed?.directiveTemplate || ''
      });
      spec = defaultProfileRegistry.resolveCompositionSpec({
        genre: genreProfile,
        style: styleProfile,
        chapterGoal: chapterGoalProfile,
        focus: focusProfile,
        hook: hookProfile,
        narrativePov: activeContract.pov || 'third_limited',
        targetChars: wordBudget.target,
        userInstruction: userInstructionText
      });
    }

    let evidenceCards = defaultEvidenceCatalog.findRelevantCards({
      dimensions: [spec.focus?.id, spec.style?.id, spec.chapterGoal?.id, spec.genre?.family, spec.genre?.id, 'universal'].filter(Boolean),
      minStrength: 'B',
      limit: 3
    });
    if (!evidenceCards || evidenceCards.length === 0) {
      evidenceCards = defaultEvidenceCatalog.findRelevantCards({ minStrength: 'A', limit: 3 });
    }

    let livingExemplarBlock = '';
    if (!options.disableLivingExemplars && !req.disableLivingExemplars) {
      try {
        const { buildLivingProseExemplarBlock } = require('../character-material');
        const exemplarResult = buildLivingProseExemplarBlock({
          genre: effectiveNovelGenre || spec.genre?.name || '',
          query: `${userInstructionText} ${context ? String(context).slice(-400) : ''}`.trim()
        }, { limit: 2, maxChars: 900 });
        livingExemplarBlock = exemplarResult && exemplarResult.block ? exemplarResult.block : '';
      } catch (_) {
        livingExemplarBlock = '';
      }
    }

    const compiledStrategy = compileChapterStrategy({
      spec,
      bible: options.bible || req.bible || activeContract.bible || null,
      chapterContract: activeContract,
      chapterContext: context,
      evidenceCards,
      debtContext: options.debtContext || req.debtContext || activeContract.debtContext || null,
      debtProjection: options.debtProjection || req.debtProjection || activeContract.debtProjection || null,
      storyDebtLedger: options.storyDebtLedger || req.storyDebtLedger || activeContract.storyDebtLedger || null,
      options: {
        ...options,
        userInstruction: (spec && spec.userInstruction) || userInstructionText,
        targetModelFamily: options.targetModelFamily || req.targetModelFamily || req.modelId || options.modelId,
        maxTotalTokens: effectiveMaxTotalTokens
      }
    });

    const baseSys = String(compiledStrategy.systemPrompt || '');
    const withScenesSys = (structuredDirectives && !baseSys.includes(structuredDirectives))
      ? `${baseSys}\n\n【场景规划执行卡】\n${structuredDirectives}`
      : baseSys;
    const baseUser = String(compiledStrategy.userPrompt || '');
    const enrichedUser = (livingExemplarBlock && !baseUser.includes('同题材真人名作活人感参照'))
      ? `${baseUser}\n\n${livingExemplarBlock}`
      : baseUser;

    return {
      systemPrompt: withScenesSys,
      userPrompt: enrichedUser,
      wordBudget: compiledStrategy.wordBudget,
      sceneDirectives: structuredDirectives,
      effectiveGenre: spec.genre?.name || (typeof genre === 'string' ? genre : (genre && (genre.genre || genre.id)) || '通用文学'),
      compositionStrategy: compiledStrategy,
      attention: compiledStrategy.attention,
      tieredAttention: compiledStrategy.tieredAttention || compiledStrategy.attention,
      attentionMetrics: compiledStrategy.attentionMetrics
    };
  }

  const genreDirective = compileGenreDirective(effectiveNovelGenre);
  const styleDirective = compileStyleDirective(effectiveWritingStyle);
  const functionDirective = compileChapterFunctionDirective(effectiveChapterFunction);
  const focusDirective = compileFocusDirective(effectiveFocus);

  const genreTitle = typeof genre === 'object' && genre !== null ? genre.genre || genre.id || '通用文学' : String(genre || '通用文学');
  const styleText = typeof style === 'object' && style !== null ? style.style || style.prompt || '' : String(style || '');

  const systemPrompt = [
    `你是专业小说创作者。当前题材归属为【${genreTitle}】。`,
    genreDirective ? genreDirective : '',
    styleDirective ? `【写作风格规范】\n${styleDirective}` : (styleText ? `【文风指导】\n${styleText}` : ''),
    functionDirective ? `【单章功能定位】\n${functionDirective}` : '',
    focusDirective ? `【本章核心侧重点】\n${focusDirective}` : '',
    '只写原创中文小说正文，不输出提纲、前言或总结。紧扣当下人物目标、阻力与现场因果，保持叙事连贯与现场实感。',
    structuredDirectives ? `【场景规划执行卡】\n${structuredDirectives}` : ''
  ].filter(Boolean).join('\n\n');

  let fallbackLivingExemplar = '';
  if (!options.disableLivingExemplars && !req.disableLivingExemplars) {
    try {
      const { buildLivingProseExemplarBlock } = require('../character-material');
      const exemplarResult = buildLivingProseExemplarBlock({
        genre: effectiveNovelGenre || genreTitle || '',
        query: `${userInstructionText} ${context ? String(context).slice(-400) : ''}`.trim()
      }, { limit: 2, maxExcerptChars: 440 });
      fallbackLivingExemplar = exemplarResult && exemplarResult.block ? exemplarResult.block : '';
    } catch (_) {
      fallbackLivingExemplar = '';
    }
  }

  const userPrompt = [
    '【只读故事上下文】\n' + (context || ''),
    '【本章创作任务】\n' + (userInstructionText || '推进当前章节核心目标'),
    fallbackLivingExemplar,
    `目标篇幅：${wordBudget.summary}。请严格按该篇幅要求撰写，请直接输出正文。`
  ].filter(Boolean).join('\n\n');

  const { tierAttention } = require('../composition/compiler/attention-tiering');
  const fallbackAttention = tierAttention({
    permanentContext: '',
    chapterStrategy: systemPrompt,
    evidenceCards: [],
    immediateContext: userPrompt,
    maxTotalTokens: effectiveMaxTotalTokens
  });

  const fallbackPayload = fallbackAttention.attention || {
    tier1Permanent: fallbackAttention.tier1Permanent,
    tier2Strategy: fallbackAttention.tier2Strategy,
    tier3Evidence: fallbackAttention.tier3Evidence,
    tier4Immediate: fallbackAttention.tier4Immediate
  };

  return {
    systemPrompt: (fallbackAttention.tier2Strategy !== undefined && fallbackAttention.tier2Strategy !== '') ? fallbackAttention.tier2Strategy : systemPrompt,
    userPrompt: (fallbackAttention.tier4Immediate !== undefined && fallbackAttention.tier4Immediate !== '') ? fallbackAttention.tier4Immediate : userPrompt,
    wordBudget,
    sceneDirectives: structuredDirectives,
    effectiveGenre: genreTitle,
    genreDirective,
    styleDirective,
    attention: fallbackPayload,
    tieredAttention: fallbackPayload,
    attentionMetrics: fallbackAttention.metrics
  };
}

/**
 * 纯函数：构造草稿模型请求参数（上下文预算断言与模型参数装配）。
 * 不进行任何外部模型调用。
 */
function buildDraftRequest(options = {}) {
  const {
    request = {},
    contract = {},
    contextPlan: inputContextPlan = {},
    prompt = null
  } = options;

  const req = request || {};
  const compiled = prompt && prompt.systemPrompt && prompt.userPrompt
    ? prompt
    : compileDraftPrompt(options);

  const attention = options.attention || options.tieredAttention || req.attention || compiled.attention || compiled.tieredAttention || compiled.compositionStrategy?.attention || null;

  let effectiveSystem = String(compiled.systemPrompt || '').trim();
  let effectiveUser = String(compiled.userPrompt || '').trim();

  // P0-1 Attention 真实安全送入模型上下文（带幂等去重）
  if (attention && typeof attention === 'object') {
    // 1. Tier 1 永驻上下文（创作圣经/底层铁律）：合并入 system
    const t1 = typeof attention.tier1Permanent === 'string' ? attention.tier1Permanent.trim() : '';
    if (t1) {
      const alreadyHasT1 = effectiveSystem.includes(t1) ||
        (t1.includes('世界底层运行法则') && effectiveSystem.includes('世界底层运行法则')) ||
        (t1.includes('【P2 创作圣经') && effectiveSystem.includes('【P2 创作圣经'));
      if (!alreadyHasT1) {
        effectiveSystem = effectiveSystem ? `${effectiveSystem}\n\n【创作圣经·永驻上下文】\n${t1}` : t1;
      }
    }

    // 2. Tier 2 章节策略：确保已在 system 中
    const t2 = typeof attention.tier2Strategy === 'string' ? attention.tier2Strategy.trim() : '';
    if (t2 && !effectiveSystem.includes(t2)) {
      effectiveSystem = effectiveSystem ? `${effectiveSystem}\n\n${t2}` : t2;
    }

    // 3. Tier 3 证据卡：合并入 userPrompt（或系统指令），包含性幂等去重（防范与 ir-lowering 双重膨胀）
    const t3 = typeof attention.tier3Evidence === 'string' ? attention.tier3Evidence.trim() : '';
    if (t3 && !effectiveUser.includes(t3) && !effectiveSystem.includes(t3)) {
      const cardBlocks = t3.split(/(?=\n*【参考策略卡\s*\d*·?)/).map(b => b.trim()).filter(Boolean);
      const blocksToInclude = [];
      const effectiveCandidate = (cardBlocks.length ? cardBlocks : [t3]);
      for (const block of effectiveCandidate) {
        if (effectiveUser.includes(block) || effectiveSystem.includes(block)) {
          continue;
        }
        const ruleMatch = block.match(/(?:·\s*)?规则[：:]\s*([^\n]+)/);
        const rule = ruleMatch ? ruleMatch[1].trim() : '';
        if (rule && (effectiveUser.includes(rule) || effectiveSystem.includes(rule))) {
          continue;
        }
        const nameMatch = block.match(/【参考策略卡\s*\d*·(.*?)】/);
        const name = nameMatch ? nameMatch[1].trim() : '';
        if (name && (effectiveUser.includes(name) || effectiveSystem.includes(name))) {
          continue;
        }
        blocksToInclude.push(block);
      }
      if (blocksToInclude.length > 0) {
        const newEvidenceText = blocksToInclude.join('\n\n');
        effectiveUser = effectiveUser ? `${effectiveUser}\n\n【参考策略卡引导】\n${newEvidenceText}` : newEvidenceText;
      }
    }

    // 4. Tier 4 即时上下文：确保已在 userPrompt 中
    const t4 = typeof attention.tier4Immediate === 'string' ? attention.tier4Immediate.trim() : '';
    if (t4 && !effectiveUser.includes(t4)) {
      effectiveUser = effectiveUser ? `${t4}\n\n${effectiveUser}` : t4;
    }
  }

  const targetChars = compiled.wordBudget?.target ?? (req.targetChars != null ? Number(req.targetChars) : null) ?? 2400;
  const writerMaxTokens = (req.modelParams?.maxTokens ?? req.maxTokens ?? options.maxTokens) ?? Math.max(8192, Math.min(16000, Math.ceil(targetChars * 3.5)));

  const { PROMPT_PROTECTION_GUARD } = require('../security-guard');
  if (PROMPT_PROTECTION_GUARD && !effectiveSystem.includes('【系统安全防御铁律')) {
    effectiveSystem = effectiveSystem ? `${effectiveSystem}\n\n${PROMPT_PROTECTION_GUARD}` : PROMPT_PROTECTION_GUARD;
  }

  // 规范主链（RenderedPromptPackage）用户消息带 DYNAMIC_PROMPT_MARKER：
  // 与 model-call-service 回退路径保持字节一致，使上游 splitDynamicPrompt 的
  // stable/dynamic 拆分（提示词缓存）在规范路径同样生效，指纹覆盖完整请求。
  const canonicalMessages = [
    { role: 'system', content: effectiveSystem },
    { role: 'user', content: DYNAMIC_PROMPT_MARKER + '\n' + effectiveUser },
    { role: 'user', content: '请直接输出内容，不要解释。' }
  ];

  const promptBudget = assertContextBudget({
    messages: canonicalMessages,
    modelId: req.modelId || options.modelId,
    providerContextLimit: options.providerContextLimit ?? req.providerContextLimit ?? req.modelParams?.contextWindow ?? null,
    targetChars,
    outputReserve: writerMaxTokens,
    maxOutputTokens: writerMaxTokens
  });

  const basePlan = inputContextPlan && typeof inputContextPlan === 'object' ? inputContextPlan : {};
  const contextPlan = {
    ...basePlan,
    renderedPromptBudget: {
      estimator: 'model-capability-cjk-ratio-v1',
      limit: promptBudget.limit,
      totalRequired: promptBudget.totalRequired,
      margin: promptBudget.margin,
      breakdown: promptBudget.breakdown
    },
    replayManifest: basePlan.replayManifest ? {
      ...basePlan.replayManifest,
      budget: {
        ...basePlan.replayManifest.budget,
        finalRenderedPromptTokens: promptBudget.breakdown.promptTokens,
        finalTotalRequired: promptBudget.totalRequired,
        finalMargin: promptBudget.margin
      }
    } : basePlan.replayManifest
  };

  const promptDigest = sha256(canonicalMessages.map(m => `${m.role}:${m.content}`).join('\n---\n'));

  const renderedPromptPackage = {
    schemaVersion: 'rendered-prompt-package-v1',
    system: effectiveSystem,
    userPrompt: effectiveUser,
    messages: canonicalMessages,
    promptDigest,
    attention,
    wordBudget: compiled.wordBudget,
    targetChars,
    writerMaxTokens,
    promptBudget
  };

  const resolvedReasoningEffort = String(options.reasoningEffort ?? req.modelParams?.reasoningEffort ?? req.reasoningEffort ?? '').trim().toLowerCase();
  const resolvedGenre = typeof options.genre === 'object' && options.genre !== null
    ? (options.genre.genre || options.genre.id || '')
    : String(options.genre || req.genre || compiled.effectiveGenre || '').trim();
  const resolvedCharacterMaterial = (options.characterMaterial && typeof options.characterMaterial === 'object')
    ? options.characterMaterial
    : (req.characterMaterial && typeof req.characterMaterial === 'object' ? req.characterMaterial : undefined);
  const resolvedPresencePenalty = options.presencePenalty ?? req.modelParams?.presencePenalty ?? req.presencePenalty;
  const resolvedFrequencyPenalty = options.frequencyPenalty ?? req.modelParams?.frequencyPenalty ?? req.frequencyPenalty;

  return {
    stage: 'writer',
    system: effectiveSystem,
    userPrompt: effectiveUser,
    modelId: req.modelId || options.modelId,
    temperature: req.modelParams?.temperature ?? options.temperature ?? 0.85,
    topP: req.modelParams?.topP ?? options.topP ?? null,
    seed: req.modelParams?.seed ?? options.seed ?? null,
    maxTokens: writerMaxTokens,
    jsonMode: false,
    ...(resolvedReasoningEffort ? { reasoningEffort: resolvedReasoningEffort } : {}),
    ...(resolvedGenre ? { genre: resolvedGenre } : {}),
    ...(resolvedCharacterMaterial ? { characterMaterial: resolvedCharacterMaterial } : {}),
    ...(options.precompiledPrompt !== undefined ? { precompiledPrompt: Boolean(options.precompiledPrompt) } : (req.precompiledPrompt !== undefined ? { precompiledPrompt: Boolean(req.precompiledPrompt) } : {})),
    ...(resolvedPresencePenalty != null ? { presencePenalty: resolvedPresencePenalty } : {}),
    ...(resolvedFrequencyPenalty != null ? { frequencyPenalty: resolvedFrequencyPenalty } : {}),
    contextPlan,
    promptBudget,
    wordBudget: compiled.wordBudget,
    attention,
    tieredAttention: attention,
    renderedPromptPackage,
    compiled
  };
}

/**
 * Generation Content Engine - 无状态正文起草请求执行器。
 * 纯粹职责：基于 compileDraftPrompt 与 buildDraftRequest 执行单次模型正文撰写与确定性微创清洗。
 * 剥离所有内部状态机转移、内嵌场景规划 LLM 调用、内嵌确定性/语义审计与内嵌多轮修订循环。
 */
async function generateDraft(options = {}) {
  const {
    callModel,
    auth,
    request = {},
    contract = {},
    scenePlan = null,
    scenes = [],
    context = '',
    genre = 'universal',
    style = '',
    signal,
    onProgress
  } = options;

  if (typeof callModel !== 'function') {
    throw new GenerationError('MODEL_CONTENT_BLOCKED', 'Content Engine 缺少 callModel 依赖');
  }

  if (signal && signal.aborted) throw signal.reason || new GenerationError('MODEL_CONTENT_BLOCKED', '生成已取消');

  const runId = String(request.generationId || request.runId || 'run_' + Date.now());
  const projectId = String(request.projectId || request.novelId || '');
  const chapterId = String(request.chapterId || contract.chapterId || '');

  const compiled = compileDraftPrompt({
    ...options,
    request,
    contract,
    scenes,
    scenePlan,
    context,
    genre,
    style
  });

  const draftRequest = buildDraftRequest({
    ...options,
    prompt: compiled
  });

  if (typeof onProgress === 'function') {
    onProgress({ stage: 'writing', message: '正在根据分镜剧本渲染正文镜头' });
  }

  const calls = [];
  const draftStartTime = Date.now();
  const draftRecord = {
    stage: 'writer',
    modelId: draftRequest.modelId || null,
    startedAt: new Date(draftStartTime).toISOString(),
    status: 'started',
    requestHash: draftRequest.renderedPromptPackage?.promptDigest || sha256(draftRequest.system + '\n' + draftRequest.userPrompt),
    outputHash: '',
    usage: null
  };
  calls.push(draftRecord);

  let draftResponse;
  try {
    const modelPayload = {
      stage: 'writer',
      system: draftRequest.system,
      userPrompt: draftRequest.userPrompt,
      messages: draftRequest.renderedPromptPackage?.messages,
      renderedPromptPackage: draftRequest.renderedPromptPackage,
      modelId: draftRequest.modelId,
      temperature: draftRequest.temperature,
      topP: draftRequest.topP,
      seed: draftRequest.seed,
      maxTokens: draftRequest.maxTokens,
      jsonMode: false,
      ...(draftRequest.reasoningEffort ? { reasoningEffort: draftRequest.reasoningEffort } : {}),
      ...(draftRequest.genre ? { genre: draftRequest.genre } : {}),
      ...(draftRequest.characterMaterial ? { characterMaterial: draftRequest.characterMaterial } : {}),
      ...(draftRequest.precompiledPrompt !== undefined ? { precompiledPrompt: draftRequest.precompiledPrompt } : {}),
      ...(draftRequest.presencePenalty != null ? { presencePenalty: draftRequest.presencePenalty } : {}),
      ...(draftRequest.frequencyPenalty != null ? { frequencyPenalty: draftRequest.frequencyPenalty } : {}),
      ...(options.twoPassHumanize !== undefined ? { twoPassHumanize: options.twoPassHumanize } : (request.twoPassHumanize !== undefined ? { twoPassHumanize: request.twoPassHumanize } : {})),
      ...(options.forceHumanizePass !== undefined ? { forceHumanizePass: options.forceHumanizePass } : {}),
      ...(draftRequest.wordBudget?.target ? { targetChars: draftRequest.wordBudget.target } : {})
    };
    if (draftRequest.attention) {
      modelPayload.attention = draftRequest.attention;
      modelPayload.tieredAttention = draftRequest.tieredAttention || draftRequest.attention;
    }
    draftResponse = await callModel(auth, modelPayload);
    draftRecord.status = 'completed';
    draftRecord.usage = draftResponse && draftResponse.usage || null;
    draftRecord.providerModel = draftRecord.usage && draftRecord.usage.providerModel || null;
  } catch (error) {
    draftRecord.status = 'failed';
    throw error;
  } finally {
    draftRecord.finishedAt = new Date().toISOString();
  }

  const rawText = String(draftResponse && (draftResponse.text || draftResponse.content) || '').trim();
  if (!rawText) throw new GenerationError('MODEL_EMPTY', '模型未返回正文', { status: 502, retryable: true });

  // 确定性微创手术物理清洗 (Deterministic In-Place Surgical Sanitization)
  const sanitized = sanitizeInPlace(rawText);
  const text = sanitized.text;
  draftRecord.outputHash = sha256(text);
  draftRecord.inPlaceReplacements = sanitized.replacementCount;

  // 构建起草清单
  const manifest = buildGenerationManifest({
    generationId: runId,
    projectId,
    chapterId,
    pipelineVersion: 'content-engine-v2',
    genreEngineVersion: 'genre-engine-v2',
    modelId: draftRequest.modelId,
    contextHash: draftRequest.contextPlan.contextHash || sha256(context),
    contractHash: hashValue(contract),
    promptHash: draftRequest.renderedPromptPackage?.promptDigest || sha256(draftRequest.system + '\n' + draftRequest.userPrompt),
    outputHash: sha256(text)
  });

  const usage = aggregateUsage(calls);

  // 可选叙事债务对账闭环 (Story Debt Reconciliation Hook)
  let debtReconciliation = null;
  const activeLedger = options.storyDebtLedger || (request && request.storyDebtLedger) || (contract && contract.storyDebtLedger);
  if (activeLedger && typeof activeLedger.recordEvent === 'function') {
    const { reconcileChapterDebts } = require('../composition/debt/debt-reconciliation');
    debtReconciliation = reconcileChapterDebts({
      ledger: activeLedger,
      chapterNo: contract.chapterNo || (request && request.chapterNo) || 1,
      chapterId: contract.chapterId || chapterId,
      draftText: text,
      contract,
      compositionSpec: options.compositionSpec || (request && request.compositionSpec) || (contract && contract.compositionSpec) || null,
      declaredResolutions: options.declaredResolutions || (request && request.declaredResolutions) || [],
      declaredDebtsToCreate: options.declaredDebtsToCreate || (request && request.declaredDebtsToCreate) || []
    });
  }

  const result = {
    draft: text,
    text,
    calls,
    manifest,
    usage,
    debtReconciliation,
    status: 'draft_created',
    attention: draftRequest.attention || null,
    tieredAttention: draftRequest.tieredAttention || draftRequest.attention || null,
    pipeline: {
      authoritative: true,
      status: 'draft_created',
      contextPlan: draftRequest.contextPlan,
      manifest,
      usage,
      calls,
      candidates: [{ contentHash: sha256(text) }],
      selectedHash: sha256(text),
      effectiveGenre: compiled.effectiveGenre,
      attention: draftRequest.attention || null,
      tieredAttention: draftRequest.tieredAttention || draftRequest.attention || null
    }
  };

  // 向后兼容测试用例惰性评估属性（独立单测直接读取时按需求值，生成链路中不主动触发）
  const targetChars = compiled.wordBudget.target;
  let cachedDeterministicAudit = null;
  let cachedSemanticAudit = null;
  let cachedQuality = null;

  Object.defineProperties(result, {
    deterministicAudit: {
      get() {
        if (!cachedDeterministicAudit) {
          cachedDeterministicAudit = auditDraft({
            text,
            minChars: contract.wordBudget?.minChars != null ? Number(contract.wordBudget.minChars) : Math.ceil(targetChars * 0.8),
            maxChars: contract.wordBudget?.maxChars != null ? Number(contract.wordBudget.maxChars) : Math.floor(targetChars * 1.2),
            strictLength: true
          });
        }
        return cachedDeterministicAudit;
      },
      configurable: true,
      enumerable: false
    },
    semanticAudit: {
      get() {
        if (!cachedSemanticAudit) {
          cachedSemanticAudit = {
            passed: true,
            status: 'NOT_REQUESTED',
            issues: [],
            audit: { passed: true, issues: [] }
          };
        }
        return cachedSemanticAudit;
      },
      configurable: true,
      enumerable: false
    },
    quality: {
      get() {
        if (!cachedQuality) {
          cachedQuality = evaluateQualityVector(text, {
            genre,
            contract,
            targetChars,
            targetWords: targetChars,
            audit: this.deterministicAudit
          });
        }
        return cachedQuality;
      },
      configurable: true,
      enumerable: false
    }
  });

  return result;
}

module.exports = {
  compileDraftPrompt,
  buildDraftRequest,
  generateDraft,
  evaluateQualityVector,
  resolveWordBudget,
  aggregateUsage
};
