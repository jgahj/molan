'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { compileDraftPrompt, generateDraft } = require('../lib/generation/content-engine');
const {
  tierAttention,
  estimateTokens,
  scoreEvidenceCard
} = require('../lib/composition/compiler/attention-tiering');
const {
  createStrategyIR,
  STRATEGY_IR_SCHEMA_VERSION,
  STRATEGY_COMPILER_VERSION,
  LOWERING_VERSION,
  COMPATIBILITY_RULE_VERSION,
  KNOWLEDGE_PACKAGE_VERSION
} = require('../lib/composition/ir/strategy-ir-schema');
const {
  lowerToPrompt,
  estimatePromptTokens,
  resolveModelFamily
} = require('../lib/composition/ir/ir-lowering');
const {
  compileToStrategyIR,
  compileChapterStrategy
} = require('../lib/composition/compiler/strategy-compiler');
const { defaultProfileRegistry } = require('../lib/composition/profiles/profile-registry');

// ============================================================================
// Suite 1: R2 Prompt Compiler Neutralization & Strategy Injection (P0-2)
// ============================================================================

test('R2 Suite 1.1: Fallback prompt in compileDraftPrompt is completely neutralized', () => {
  const fallbackResult = compileDraftPrompt({
    genre: '玄幻修真',
    style: '冷峻克制',
    scenePlan: null,
    scenes: [
      { goal: '场景一：暗夜探查' },
      { goal: '场景二：发现暗印' }
    ],
    context: '前情提要：主角抵达破庙。',
    request: {
      userInstruction: '重点写出发现残破道契的过程'
    }
  });

  const sysPrompt = fallbackResult.systemPrompt;

  // 1. 绝对剔除旧版硬编码规则
  assert.equal(sysPrompt.includes('三幕分镜与剧情骨架已锁定'), false, '不得包含硬编码三幕骨架');
  assert.equal(sysPrompt.includes('动作-对白交错律'), false, '不得包含硬编码动作-对白交错律');
  assert.equal(sysPrompt.includes('旧事闪回'), false, '不得包含硬编码100~200字旧事闪回');
  assert.equal(sysPrompt.includes('嘴角勾起'), false, '不得硬编码套路词库拦截');
  assert.equal(sysPrompt.includes('瞳孔骤缩'), false, '不得硬编码套路词库拦截');
  assert.equal(sysPrompt.includes('骨节泛白'), false, '不得硬编码套路词库拦截');
  assert.equal(sysPrompt.includes('喉头一甜'), false, '不得硬编码套路词库拦截');
  assert.equal(sysPrompt.includes('三幕分镜剧本执行卡'), false, '不得将场景卡打为三幕分镜');

  // 2. 验证中立场景卡标头与指令
  assert.ok(sysPrompt.includes('【场景规划执行卡】'), '场景指令必须使用中立的【场景规划执行卡】');
  assert.ok(sysPrompt.includes('场景一：暗夜探查'));
  assert.ok(sysPrompt.includes('场景二：发现暗印'));
  assert.ok(sysPrompt.includes('只写原创中文小说正文，不输出提纲、前言或总结。紧扣当下人物目标、阻力与现场因果，保持叙事连贯与现场实感。'));
});

test('R2 Suite 1.2: Direct mounting of strategyIR without re-resolution', () => {
  const strategyIR = createStrategyIR({
    metadata: {
      generationId: 'gen_direct_01',
      chapterId: 'ch_42'
    },
    hardConstraints: {
      targetWordRange: { min: 2500, max: 3500, target: 3000 },
      narrativePov: '第三人称限制视角',
      viewpointCharacter: '楚云'
    },
    bookIdentity: {
      worldRuleSummary: '星力衰变，神格破碎',
      genre: { name: '星际修真' }
    },
    chapterOutcomeContract: {
      objectiveName: '截获星舰密令',
      stateDelta: {
        stateBefore: '潜伏外围',
        events: ['破译信号', '植入木马'],
        stateAfter: '取得控制核心'
      }
    },
    stylePolicy: {
      name: '工业冷峻'
    },
    focusPolicy: {
      name: '技术潜入'
    },
    hookPolicy: {
      name: '倒计时钩'
    }
  });

  const result = compileDraftPrompt({
    strategyIR,
    context: '前情提要：星舰正在进行跃迁预热。',
    request: {
      userInstruction: '重点写出破译过程中的技术交锋'
    }
  });

  assert.equal(result.strategyIR, strategyIR);
  assert.ok(result.compositionStrategy);
  assert.equal(result.compositionStrategy.digest, strategyIR.irDigest);
  assert.ok(result.systemPrompt.includes('【P0 绝对事实与物理围栏'));
  assert.ok(result.systemPrompt.includes('星力衰变，神格破碎'));
  assert.ok(result.userPrompt.includes('截获星舰密令'));
  assert.equal(result.effectiveGenre, '星际修真');
});

test('R2 Suite 1.3: Direct mounting via request.strategyIR or contract.strategyIR', () => {
  const strategyIR = createStrategyIR({
    hardConstraints: { targetWordRange: { target: 2000, min: 1800, max: 2200 } },
    bookIdentity: { genre: { name: '赛博武侠' } }
  });

  const fromReq = compileDraftPrompt({
    request: { strategyIR }
  });
  const fromContract = compileDraftPrompt({
    contract: { strategyIR }
  });

  assert.equal(fromReq.strategyIR, strategyIR);
  assert.equal(fromContract.strategyIR, strategyIR);
  assert.equal(fromReq.compositionStrategy.digest, strategyIR.irDigest);
  assert.equal(fromContract.compositionStrategy.digest, strategyIR.irDigest);
});

test('R2 Suite 1.4: generateDraft executes with directly mounted strategyIR', async () => {
  const strategyIR = createStrategyIR({
    hardConstraints: { targetWordRange: { target: 100, min: 30, max: 200 } },
    bookIdentity: { genre: { name: '都市' } },
    chapterOutcomeContract: { objectiveName: '街头偶遇' }
  });

  let capturedPrompt = null;
  const mockCalls = [];
  const fakeDraftText = '雨夜中，街角的霓虹灯闪烁着暗红色的微光。林巡拉低了风衣的帽檐，快步穿过积水的小巷，目光警惕地扫过两侧废弃的店铺。';

  const result = await generateDraft({
    callModel: async (_auth, options) => {
      capturedPrompt = options;
      mockCalls.push(options);
      return {
        text: fakeDraftText,
        usage: { promptTokens: 200, completionTokens: 60, totalTokens: 260, creditCost: 0.02 }
      };
    },
    auth: { user: { email: 'writer@test.com' } },
    strategyIR,
    request: {
      generationId: 'gen_strat_test',
      targetWords: 100
    },
    contract: {
      chapterId: 'ch_strat_test',
      chapterNo: 1,
      wordBudget: { minChars: 30, maxChars: 200, targetChars: 100 }
    },
    context: '前情提要：刚离开安全屋。'
  });

  assert.equal(mockCalls.length, 1);
  assert.ok(capturedPrompt);
  assert.ok(capturedPrompt.system.includes('【P0 绝对事实与物理围栏'));
  assert.ok(capturedPrompt.userPrompt.includes('街头偶遇'));
  assert.equal(result.draft, fakeDraftText);
  assert.equal(result.deterministicAudit.passed, true);
});

// ============================================================================
// Suite 2: R7 Active Attention Tiering & Budget Enforcement (P1-8)
// ============================================================================

test('R7 Suite 2.1: Dynamic multi-factor scoring ranks cards by relevance * evidenceStrength * currentObjective', () => {
  const cardHigh = {
    name: '高匹配强证据卡',
    rule: '在物理对抗中呈现微观受力形变',
    pattern: '受力 -> 形变 -> 反作用力',
    evidenceStrength: 'A', // 1.0
    relevance: 0.9,
    currentObjective: 0.9
  };
  const cardMed = {
    name: '中匹配证据卡',
    rule: '借环境异物反衬心理压迫',
    pattern: '物像聚焦 -> 动静反差',
    evidenceStrength: 'B', // 0.8
    relevance: 0.6,
    currentObjective: 0.7
  };
  const cardLow = {
    name: '低匹配弱证据卡',
    rule: '偶发现象不作推广',
    pattern: '特例范式',
    evidenceStrength: 'C', // 0.5
    relevance: 0.4,
    currentObjective: 0.3
  };

  const scoreHigh = scoreEvidenceCard(cardHigh);
  const scoreMed = scoreEvidenceCard(cardMed);
  const scoreLow = scoreEvidenceCard(cardLow);

  // High: 0.9 * 1.0 * 0.9 = 0.81
  // Med: 0.6 * 0.8 * 0.7 = 0.336
  // Low: 0.4 * 0.5 * 0.3 = 0.06
  assert.ok(scoreHigh.score > scoreMed.score, 'High card score must exceed Medium');
  assert.ok(scoreMed.score > scoreLow.score, 'Medium card score must exceed Low');

  const attention = tierAttention({
    permanentContext: '世界法则',
    chapterStrategy: '章节策略',
    evidenceCards: [cardMed, cardLow, cardHigh],
    maxTotalTokens: 4000
  });

  // cardLow score 0.06 is < 0.25, so disqualified
  assert.equal(attention.metrics.selectedCardCount, 2);
  assert.ok(attention.metrics.selectedCards[0].score >= attention.metrics.selectedCards[1].score);
  assert.ok(attention.metrics.selectedCards[0].name.includes('高匹配强证据卡'));
});

test('R7 Suite 2.2: Disqualifies low-tier cards (strength D) and filters low scores', () => {
  const attention = tierAttention({
    permanentContext: '规则',
    chapterStrategy: '策略',
    evidenceCards: [
      { name: '合格卡1', rule: '有效规则', pattern: '有效范式', evidenceStrength: 'A' },
      { name: '合格卡2', rule: '备选规则', pattern: '备选范式', evidenceStrength: 'B' },
      { name: '劣质D卡', rule: '未经检验的谣言', pattern: '不可靠范式', evidenceStrength: 'D' }
    ],
    maxTotalTokens: 4000
  });

  assert.equal(attention.metrics.selectedCardCount, 2);
  assert.ok(!attention.tier3Evidence.includes('劣质D卡'));
  assert.ok(attention.tier3Evidence.includes('合格卡1'));
  assert.ok(attention.tier3Evidence.includes('合格卡2'));
});

test('R7 Suite 2.3: Active budgeting: excessive evidence cards pruned when totalTokens > maxTotalTokens', () => {
  const cards = [
    { name: '顶级卡1', rule: '白描动作极简', pattern: '动作细节', evidenceStrength: 'A', relevance: 0.9, currentObjective: 0.9 },
    { name: '优质卡2', rule: '对白机锋反差', pattern: '言外之意', evidenceStrength: 'A', relevance: 0.8, currentObjective: 0.8 },
    { name: '次优卡3', rule: '伏笔道具呼应', pattern: '道具特写', evidenceStrength: 'B', relevance: 0.7, currentObjective: 0.7 },
    { name: '备选卡4', rule: '情绪微弱外化', pattern: '生理反应', evidenceStrength: 'B', relevance: 0.6, currentObjective: 0.6 }
  ];

  // Set tight budget: 50 tokens
  const attention = tierAttention({
    permanentContext: '底层物理：能量守恒',
    chapterStrategy: '本章策略指令：深入敌营展开探查',
    evidenceCards: cards,
    immediateContext: '主角站在大殿阴影中。',
    maxTotalTokens: 50
  });

  assert.ok(attention.metrics.withinBudget, 'Must be within budget after active pruning');
  assert.ok(attention.metrics.totalTokens <= 50, `Total tokens ${attention.metrics.totalTokens} must be <= 50`);
  assert.ok(attention.metrics.pruned, 'Metrics must indicate pruned');
  assert.ok(attention.metrics.pruningActions.length >= 1, 'Must record pruning actions');
  assert.ok(attention.metrics.selectedCardCount < cards.length, 'Lower ranked cards must be pruned');
});

test('R7 Suite 2.4: Progressive summarization on Tier 1 / P2 Creation Bible rules under budget overage', () => {
  const longBibleRules = [
    '【世界底层运行法则与物理铁律大典】',
    '第一法则：灵石内部蕴含驳杂天道残渣，修士绝不可直接吸收入体，必须经由炼化鼎三次淬洗。违者经脉寸断，修为尽废。',
    '第二铁律：凡人与修士之间存在不可逾越的生理断层，凡俗刀兵绝对无法伤及筑基以上修士肉身，唯有特种玄铁可破法。',
    '第三法则：修仙界严禁私自跨越宗门边界设立传送阵，所有空间位移均受王朝观天镜严密监测。',
    '第四补充说明：各宗门外门坊市交易必须使用官方发行的度牒通宝，私铸货币按通魔重罪论处。凡有异议者直接押送黑狱。',
    '第五详细例证：昔年青云宗叛徒曾尝试以凡铁刺杀长老，最终反震而亡，血溅当场。此乃修仙界人尽皆知之常识。'
  ].join('\n\n');

  const attention = tierAttention({
    permanentContext: longBibleRules,
    chapterStrategy: '核心策略指令',
    evidenceCards: [],
    immediateContext: '现场前情',
    maxTotalTokens: 150 // Very tight budget
  });

  assert.ok(attention.metrics.withinBudget, 'Within budget guaranteed');
  assert.ok(attention.metrics.totalTokens <= 150, `totalTokens ${attention.metrics.totalTokens} <= 150`);
  assert.ok(attention.metrics.pruned, 'Must be marked as pruned');
  // Check progressive summarization occurred
  assert.ok(
    attention.tier1Permanent.includes('法则') || attention.tier1Permanent.includes('底层物理'),
    'Summarized Tier 1 must retain invariant keywords'
  );
  assert.ok(attention.tier1Permanent.length < longBibleRules.length, 'Tier 1 text must be shortened');
});

test('R7 Suite 2.5: Critical retention strictly preserves P0 Hard Constraints, P3 State Delta, and P4 Boundary Guards', () => {
  const chapterStrategyWithCriticals = [
    '【P0 绝对事实与物理围栏（最高指令，不得违反）】\n· 篇幅字数硬性预算：基准 3000 字\n· 叙事视角准则：第三人称限制视角（主角）',
    '【题材策略·凡人修真】\n【题材边界绝不假定】：\n· 绝不假定主角拥有免死金牌\n· 绝不假定宗门长辈无私庇护',
    '【本章核心目标·夺取密信】\n【状态跃迁契约 (State Delta)】：\n· 章前状态：一无所知\n· 推进事件：探查密室 -> 破解暗锁\n· 章后状态：掌控把柄\n· 存在性检验：若删除本章，必须导致后续逼宫剧情失效！',
    '【文风质感策略·老白沉稳】\n本章量化调制标尺：叙事密度 80% | 短句比 60% | 留白克制 40%\n详细拓展说明：此处可以包含大量的文风背景阐述和次要描写规则。',
    '【本章镜头与笔墨预算分配】\n重点倾斜：冲突、对话\n辅助呼应：动作\n克制点缀：环境描写大段说明。'
  ].join('\n\n');

  const attention = tierAttention({
    permanentContext: '世界法则：灵气守恒',
    chapterStrategy: chapterStrategyWithCriticals,
    evidenceCards: [],
    immediateContext: '即时前情',
    maxTotalTokens: 300 // Tight budget triggering Tier 2 compression
  });

  const tier2 = attention.tier2Strategy;
  assert.ok(attention.metrics.withinBudget, 'Guaranteed within budget');
  assert.ok(tier2.includes('P0 绝对事实'), 'P0 must be critically retained');
  assert.ok(tier2.includes('状态跃迁契约'), 'P3 State Delta must be critically retained');
  assert.ok(tier2.includes('章前状态：一无所知'), 'StateBefore must be retained');
  assert.ok(tier2.includes('章后状态：掌控把柄'), 'StateAfter must be retained');
  assert.ok(tier2.includes('存在性检验'), 'invalidIfRemoved existence check must be retained');
  assert.ok(tier2.includes('题材边界绝不假定'), 'P4 Genre Boundary Guards must be critically retained');
});

test('R7 Suite 2.6: Hard guarantee totalTokens <= maxTotalTokens under extreme input loads', () => {
  const hugeText = '天道崩塌，法则断绝。'.repeat(500); // ~5000 tokens
  const attention = tierAttention({
    permanentContext: hugeText,
    chapterStrategy: hugeText,
    evidenceCards: [
      { name: '卡1', rule: '规则1', pattern: '范式1', evidenceStrength: 'A' },
      { name: '卡2', rule: '规则2', pattern: '范式2', evidenceStrength: 'A' }
    ],
    immediateContext: hugeText,
    maxTotalTokens: 500
  });

  assert.ok(attention.metrics.withinBudget, 'withinBudget must be true');
  assert.ok(attention.metrics.totalTokens <= 500, `totalTokens ${attention.metrics.totalTokens} must be <= 500`);
});

// ============================================================================
// Suite 3: R8 Replayable StrategyIR with Full Provenance Digest (P1-9)
// ============================================================================

test('R8 Suite 3.1: StrategyIR creates frozen provenance binding 5 architecture and 7 profile version dimensions', () => {
  const ir = createStrategyIR({
    metadata: { generationId: 'gen_prov_1' },
    hardConstraints: { targetWordRange: { target: 3000 } },
    bookIdentity: { genre: { name: '传统玄幻' } }
  });

  assert.ok(ir.provenance, 'StrategyIR must have provenance block');
  assert.equal(ir.provenance.schemaVersion, STRATEGY_IR_SCHEMA_VERSION);
  assert.equal(ir.provenance.compilerVersion, STRATEGY_COMPILER_VERSION);
  assert.equal(ir.provenance.loweringVersion, LOWERING_VERSION);
  assert.equal(ir.provenance.compatibilityRuleVersion, COMPATIBILITY_RULE_VERSION);
  assert.equal(ir.provenance.knowledgePackageVersion, KNOWLEDGE_PACKAGE_VERSION);

  const pv = ir.provenance.profileVersions;
  assert.ok(pv, 'profileVersions must exist');
  assert.equal(pv.genre, 'genre-profile-v1');
  assert.equal(pv.style, 'style-profile-v2');
  assert.equal(pv.chapterGoal, 'chapter-goal-profile-v2');
  assert.equal(pv.focus, 'focus-profile-v2');
  assert.equal(pv.hook, 'hook-profile-v1');
  assert.equal(pv.storyEngine, 'story-engine-profile-v1');
  assert.equal(pv.readerPromise, 'reader-promise-profile-v1');

  assert.ok(Object.isFrozen(ir.provenance), 'provenance must be frozen');
  assert.ok(Object.isFrozen(pv), 'profileVersions must be frozen');
});

test('R8 Suite 3.2: Replay determinism produces bit-identical 64-char SHA-256 digest', () => {
  const input = {
    metadata: { generationId: 'gen_replay_1' },
    hardConstraints: { targetWordRange: { target: 3000 }, viewpointCharacter: '林凡' },
    bookIdentity: { worldRuleSummary: '灵气守恒' },
    chapterOutcomeContract: { objectiveName: '试探暗桩' },
    stylePolicy: { name: '冷峻克制' },
    focusPolicy: { name: '调查' },
    hookPolicy: { name: '危机' }
  };

  const ir1 = createStrategyIR(input);
  const ir2 = createStrategyIR(input);

  assert.equal(typeof ir1.irDigest, 'string');
  assert.equal(ir1.irDigest.length, 64);
  assert.equal(ir1.irDigest, ir2.irDigest, 'Identical input must produce identical irDigest');
});

test('R8 Suite 3.3: Mutating compilerVersion, loweringVersion, or compatibilityRuleVersion invalidates digest', () => {
  const baseInput = {
    hardConstraints: { targetWordRange: { target: 3000 } },
    bookIdentity: { genre: { name: '玄幻' } }
  };

  const baseIR = createStrategyIR(baseInput);

  const irDiffCompiler = createStrategyIR({
    ...baseInput,
    provenance: { compilerVersion: 'strategy-compiler-v3-future' }
  });
  assert.notEqual(baseIR.irDigest, irDiffCompiler.irDigest, 'Mutating compilerVersion must change digest');

  const irDiffLowering = createStrategyIR({
    ...baseInput,
    provenance: { loweringVersion: 'ir-lowering-v3-experimental' }
  });
  assert.notEqual(baseIR.irDigest, irDiffLowering.irDigest, 'Mutating loweringVersion must change digest');

  const irDiffCompat = createStrategyIR({
    ...baseInput,
    provenance: { compatibilityRuleVersion: 'compat-matrix-v2' }
  });
  assert.notEqual(baseIR.irDigest, irDiffCompat.irDigest, 'Mutating compatibilityRuleVersion must change digest');
});

test('R8 Suite 3.4: Mutating any of the 7 profile versions strictly invalidates digest', () => {
  const baseInput = {
    hardConstraints: { targetWordRange: { target: 3000 } },
    bookIdentity: { genre: { name: '玄幻' } }
  };
  const baseIR = createStrategyIR(baseInput);

  const profileDimensions = ['genre', 'style', 'chapterGoal', 'focus', 'hook', 'storyEngine', 'readerPromise'];
  for (const dim of profileDimensions) {
    const mutated = createStrategyIR({
      ...baseInput,
      provenance: {
        profileVersions: {
          [dim]: `${dim}-v99-mutated`
        }
      }
    });
    assert.notEqual(baseIR.irDigest, mutated.irDigest, `Mutating profile dimension [${dim}] must change irDigest`);
  }
});

test('R8 Suite 3.5: Mutating knowledgePackageVersion strictly invalidates digest', () => {
  const baseInput = {
    hardConstraints: { targetWordRange: { target: 3000 } },
    bookIdentity: { genre: { name: '玄幻' } }
  };
  const baseIR = createStrategyIR(baseInput);

  const irDiffKnowledge = createStrategyIR({
    ...baseInput,
    provenance: { knowledgePackageVersion: 'strategy-knowledge-base-v2-expanded' }
  });
  assert.notEqual(baseIR.irDigest, irDiffKnowledge.irDigest, 'Mutating knowledgePackageVersion must change digest');
});

test('R8 Suite 3.6: End-to-end StrategyCompiler binds profile versions from spec into IR provenance', () => {
  const spec = defaultProfileRegistry.resolveCompositionSpec({
    genre: 'xuanhuan_cautious',
    style: 'laobai_restrained',
    chapterGoal: 'info_reveal',
    focus: 'combat',
    hook: 'suspense_clue'
  });

  const compiled = compileChapterStrategy({
    spec,
    bible: { title: '天道录', worldRuleSummary: '天道不全' },
    chapterContract: { chapterId: 'ch_bind_test' }
  });

  assert.ok(compiled.strategyIR);
  assert.ok(compiled.strategyIR.provenance);
  assert.equal(compiled.digest, compiled.strategyIR.irDigest);
  assert.equal(compiled.strategyIR.provenance.compilerVersion, STRATEGY_COMPILER_VERSION);
  assert.equal(compiled.strategyIR.provenance.profileVersions.genre, spec.genre?.version || 'genre-profile-v1');
  assert.equal(compiled.strategyIR.provenance.profileVersions.style, spec.style?.version || 'style-profile-v2');
});

// ============================================================================
// Suite 4: R13 Model-Specific Prompt Lowering & Accurate Tokenization (P1-14)
// ============================================================================

test('R13 Suite 4.1: Claude renderer generates semantic XML tags and places context before directives', () => {
  const ir = createStrategyIR({
    hardConstraints: { targetWordRange: { target: 3000 }, viewpointCharacter: '沈墨' },
    bookIdentity: { genre: { name: '仙侠' } },
    chapterOutcomeContract: { objectiveName: '试探虚实' }
  });

  const lowered = lowerToPrompt(ir, {
    targetModelFamily: 'claude',
    chapterContext: '前情：大雪封山，孤舟渡江。',
    userInstruction: '重点写出渡口盘查细节'
  });

  assert.equal(lowered.modelFamily, 'claude');
  // 1. XML tags in systemPrompt
  assert.ok(lowered.systemPrompt.includes('<system_directives>'));
  assert.ok(lowered.systemPrompt.includes('<hard_constraints>'));
  assert.ok(lowered.systemPrompt.includes('<genre_policy>'));
  assert.ok(lowered.systemPrompt.includes('</system_directives>'));

  // 2. XML tags in userPrompt
  assert.ok(lowered.userPrompt.includes('<narrative_context>'));
  assert.ok(lowered.userPrompt.includes('大雪封山，孤舟渡江'));
  assert.ok(lowered.userPrompt.includes('<chapter_task>'));
  assert.ok(lowered.userPrompt.includes('渡口盘查细节'));
  assert.ok(lowered.userPrompt.includes('<outcome_contract>'));

  // 3. 上下文置于任务之前（Anthropic Steerability）
  const contextIndex = lowered.userPrompt.indexOf('<narrative_context>');
  const taskIndex = lowered.userPrompt.indexOf('<chapter_task>');
  assert.ok(contextIndex < taskIndex, 'Context tag must appear before task tag for Claude');

  // 4. 彻底剥除动作-对白交错律
  assert.equal(lowered.systemPrompt.includes('动作-对白交错律'), false);
  assert.equal(lowered.userPrompt.includes('动作-对白交错律'), false);
});

test('R13 Suite 4.2: GPT renderer generates Markdown with Recency Reinforcement', () => {
  const ir = createStrategyIR({
    hardConstraints: { targetWordRange: { target: 3200, min: 2800, max: 3600 }, viewpointCharacter: '严振' },
    bookIdentity: { genre: { name: '刑侦破案' } },
    chapterOutcomeContract: { objectiveName: '突击提审' }
  });

  const lowered = lowerToPrompt(ir, {
    targetModelFamily: 'gpt',
    chapterContext: '前情：嫌疑人已被押解至审讯室。',
    userInstruction: '突破口供防线'
  });

  assert.equal(lowered.modelFamily, 'gpt');
  // 1. Markdown 标头
  assert.ok(lowered.systemPrompt.includes('### P0 核心物理与字数围栏'));
  assert.ok(lowered.systemPrompt.includes('### P4 题材策略'));

  // 2. 尾部 Recency Reinforcement
  assert.ok(lowered.userPrompt.includes('### 执行确认 (Recency Reinforcement)'));
  assert.ok(lowered.userPrompt.includes('2800 ~ 3600 字'));
  assert.ok(lowered.userPrompt.includes('第三人称限制视角'));

  // 3. 剥除动作-对白交错律
  assert.equal(lowered.systemPrompt.includes('动作-对白交错律'), false);
});

test('R13 Suite 4.3: DeepSeek renderer generates Chinese literary framing', () => {
  const ir = createStrategyIR({
    hardConstraints: { targetWordRange: { target: 2800 } },
    bookIdentity: { genre: { name: '武侠传奇' } },
    chapterOutcomeContract: { objectiveName: '月下对饮' }
  });

  const lowered = lowerToPrompt(ir, {
    targetModelFamily: 'deepseek',
    chapterContext: '前情：十年重逢。',
    userInstruction: '写出客栈暗流'
  });

  assert.equal(lowered.modelFamily, 'deepseek');
  assert.ok(lowered.systemPrompt.includes('【底层物理与创作硬界】'));
  assert.ok(lowered.systemPrompt.includes('【题材基石与矛盾主轴】'));
  assert.ok(lowered.systemPrompt.includes('【笔触规范与留白标尺】'));
  assert.ok(lowered.userPrompt.includes('【现场因果前情】'));
  assert.ok(lowered.userPrompt.includes('【核心位移契约·状态跃迁】'));
  assert.equal(lowered.systemPrompt.includes('动作-对白交错律'), false);
});

test('R13 Suite 4.4: Local LLM renderer generates high-density compact directives', () => {
  const ir = createStrategyIR({
    hardConstraints: { targetWordRange: { target: 2000, min: 1800, max: 2200 }, viewpointCharacter: '张三' },
    bookIdentity: { genre: { name: '历史演义' } },
    chapterOutcomeContract: {
      objectiveName: '草船借箭',
      stateDelta: { stateBefore: '无箭可用', stateAfter: '十万支箭到手' }
    }
  });

  const lowered = lowerToPrompt(ir, {
    targetModelFamily: 'local',
    chapterContext: '前情：江面大雾。',
    userInstruction: '擂鼓呐喊'
  });

  assert.equal(lowered.modelFamily, 'local');
  assert.ok(lowered.systemPrompt.includes('[物理约束]'));
  assert.ok(lowered.systemPrompt.includes('[题材策略]'));
  assert.ok(lowered.systemPrompt.includes('[文风准则]'));
  assert.ok(lowered.userPrompt.includes('[前情]'));
  assert.ok(lowered.userPrompt.includes('[目标]'));
  assert.ok(lowered.userPrompt.includes('[指令]'));
  assert.equal(lowered.systemPrompt.includes('动作-对白交错律'), false);
});

test('R13 Suite 4.5: Calibrated tokenizer estimation reflects distinct CJK and non-CJK ratios across tokenizers', () => {
  const sampleChineseText = '林凡推开厚重的青铜古门，门轴转动发出刺耳的摩擦声。石殿中央矗立着一尊断臂石雕。'; // 39 CJK chars

  const gptTokens = estimatePromptTokens(sampleChineseText, { tokenizer: 'o200k_base' });
  const gpt4Tokens = estimatePromptTokens(sampleChineseText, { tokenizer: 'cl100k_base' });
  const qwenTokens = estimatePromptTokens(sampleChineseText, { tokenizer: 'qwen' });
  const claudeTokens = estimatePromptTokens(sampleChineseText, { tokenizer: 'claude' });

  // cl100k_base has cjkRatio 0.85; o200k_base has 0.70; qwen has 0.68
  assert.ok(gpt4Tokens > gptTokens, 'cl100k_base CJK tokens must exceed o200k_base');
  assert.ok(gptTokens > qwenTokens, 'o200k_base CJK tokens must exceed qwen');
  assert.ok(claudeTokens > qwenTokens, 'claude CJK tokens must exceed qwen');

  const ir = createStrategyIR({
    hardConstraints: { targetWordRange: { target: 3000 } }
  });
  const lowered = lowerToPrompt(ir, { targetModelFamily: 'gpt' });
  assert.ok(lowered.tokens);
  assert.equal(lowered.tokens.calibrated, true);
  assert.ok(lowered.tokens.systemTokens > 0);
  assert.ok(lowered.tokens.userTokens > 0);
  assert.ok(lowered.tokens.totalTokens >= lowered.tokens.systemTokens);
});

test('R13 Suite 4.6: Model family resolution correctly maps diverse model IDs', () => {
  assert.equal(resolveModelFamily({ targetModelFamily: 'claude-3-5-sonnet' }), 'claude');
  assert.equal(resolveModelFamily({ modelId: 'gpt-4o' }), 'gpt');
  assert.equal(resolveModelFamily({ modelId: 'o1-mini' }), 'gpt');
  assert.equal(resolveModelFamily({ modelId: 'deepseek-chat' }), 'deepseek');
  assert.equal(resolveModelFamily({ modelId: 'deepseek-reasoner' }), 'deepseek');
  assert.equal(resolveModelFamily({ modelId: 'qwen-2.5-72b' }), 'local');
  assert.equal(resolveModelFamily({ modelId: 'meta-llama-3-8b' }), 'local');
  assert.equal(resolveModelFamily({}), 'generic');
});
