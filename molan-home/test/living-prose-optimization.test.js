'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  anonymizeSampleText,
  isBrokenAnonymizedText,
  isCleanExemplarSample,
  buildLivingProseExemplarBlock,
  buildCharacterMaterialBlock,
  scanCharacterMaterialOverlap
} = require('../lib/character-material');
const {
  compileGenreDirective,
  compileStyleDirective
} = require('../lib/generation/corpus-archetypes');
const {
  resolveModelFamily
} = require('../lib/composition/ir/ir-lowering');
const {
  compileDraftPrompt,
  buildDraftRequest
} = require('../lib/generation/content-engine');
const {
  sanitizeInPlace
} = require('../lib/generation/inplace-sanitizer');
const correctionPolicy = require('../correction-policy');
const { createHumanizePolicyService } = require('../services/humanize-policy-service');
const { buildHumanizeLexiconBlock, computeAiFlavorScore } = require('../lib/ai-flavor-detector');
const { analyzeHumanTexture } = require('../lib/style/human-texture');

test('anonymizeSampleText 不再把“那是/于是/那个”误伤为【人X】', () => {
  const input = '那是他三年前从旧货摊淘来的紫砂壶，于是他顺手提起来倒了半杯凉茶。';
  const out = anonymizeSampleText(input);
  assert.equal(out.includes('【人'), false, 'common functional phrases must not be anonymized: ' + out);
  assert.equal(isBrokenAnonymizedText('【人乙】？他皱着眉把杯子搁回桌角。'), true);
  assert.equal(isBrokenAnonymizedText('她顺手把茶杯往前推了半寸。'), false);
});

test('isCleanExemplarSample 过滤含 AI 套词与破碎占位符的样本', () => {
  const filler = '巷口早点摊的煤炉已经架起来了，铁锅底烧得发红，老板娘拿长筷子拨着油条，油花噼啪往外溅，热气顺着掀起的布帘子直往外冒，路边蹲着喝豆腐脑的老头吸溜吸溜喝完碗底最后一点卤，把零钱拍在木头桌角上招呼着再来两根麻花。旁边修车铺的伙计刚拉起卷闸门，铁链哗啦响了一声，他又拎起半桶凉水泼在门槛前，把昨夜落下来的灰泥冲进阴沟里，顺手摸出半盒皱巴巴的烟点了一根，站在风口狠狠抽了两口才拍拍裤腿蹲下捡扳手。';
  assert.equal(isCleanExemplarSample({ text: filler + '屋内陷入死一般的寂静，他嘴角勾起一抹冷笑。', flavorScore: 0 }), false);
  assert.equal(isCleanExemplarSample({ text: filler + '她指节捏得发白，瞳孔骤然收缩。', flavorScore: 20 }), false);
  assert.equal(isCleanExemplarSample({ anonymizedText: '【人乙】？' + filler, flavorScore: 0 }), false);
  assert.equal(isCleanExemplarSample({
    text: '天还没亮透，' + filler,
    flavorScore: 0
  }), true);
});

test('buildLivingProseExemplarBlock 跨题材抽取零AI味《小说原本》范本并支持重叠防抄袭检测', () => {
  for (const genre of ['玄幻', '都市', '青春甜宠', '历史', '科幻', '悬疑']) {
    const res = buildLivingProseExemplarBlock({
      genre,
      query: '两人坐在桌边试探交锋，气氛微妙'
    }, { limit: 2, maxChars: 900 });
    assert.ok(res.samples.length >= 1 && res.samples.length <= 2, `${genre} should yield 1-2 exemplars`);
    assert.ok(res.text.includes('同题材真人名作活人感参照'), `${genre} block header missing`);
    assert.equal(res.block, res.text);
    for (const s of res.samples) {
      assert.equal(isBrokenAnonymizedText(s.text), false, `${genre} exemplar must not have broken placeholder`);
      assert.doesNotMatch(s.text, /死一般的寂静|嘴角勾起一抹弧度|瞳孔骤然收缩/);
    }
    const overlap = scanCharacterMaterialOverlap(res.samples[0].text.slice(0, 30), res.samples);
    assert.equal(overlap.blocked, true, `${genre} overlap detector must block verbatim copying`);
  }
});

test('buildCharacterMaterialBlock 在 raw 与 auto 模式下按需注入原著活人示范段落', () => {
  const rawRes = buildCharacterMaterialBlock({ user: { id: 'u1' } }, {
    mode: 'raw',
    includeParagraphExemplars: true,
    proseTask: true,
    genre: '青春甜宠',
    query: '校园图书馆门口偶遇，假装没看见对方'
  });
  assert.equal(rawRes.audit.paragraphSamples, true);
  assert.ok(rawRes.samples.length >= 1);
  assert.ok(rawRes.messages.some(m => m.content.includes('同题材真人名作活人感参照')));

  const autoRes = buildCharacterMaterialBlock({ user: { id: 'u1' } }, {
    mode: 'auto',
    includeParagraphExemplars: true,
    proseTask: true,
    genre: '都市日常',
    query: '下班路过菜市场砍价'
  });
  assert.equal(autoRes.audit.paragraphSamples, true);
  assert.ok(autoRes.samples.length >= 1);
  assert.ok(autoRes.messages.some(m => m.content.includes('同题材真人名作活人感参照')));
});

test('compileGenreDirective 与 compileStyleDirective 兼容中文题材名与别名并命中语料库经验规则', () => {
  for (const genre of ['东方仙侠', '青春甜宠', '都市高武', '宫斗宅斗', '年代文', '悬疑']) {
    const dir = compileGenreDirective(genre);
    assert.ok(dir.length > 50, `${genre} must resolve empirical or taxonomy directive, got length=${dir.length}`);
  }
  for (const style of ['爽文文风', '缱绻细腻', '沉稳克制', '幽默诙谐']) {
    const sDir = compileStyleDirective(style);
    assert.ok(sDir.length > 20, `${style} must resolve style directive`);
  }
});

test('ir-lowering 支持 gemini 模型家族专属渲染，并渲染 P4 题材经验说明', () => {
  assert.equal(resolveModelFamily({ modelId: 'gemini-4-hydrogen' }), 'gemini');
  const compiled = compileDraftPrompt({
    request: {
      useCompositionV3: true,
      novelGenre: '青春甜宠',
      modelId: 'gemini-4-hydrogen',
      userInstruction: '女主雨天忘带伞在便利店门口遇见男主，写2200字。'
    },
    context: '前情：两人上周因社团预算吵过一架，各自别扭着没说话。'
  });
  assert.equal(compiled.compositionStrategy.modelFamily, 'gemini');
  assert.ok(compiled.systemPrompt.includes('<creative_identity>'));
  assert.ok(compiled.systemPrompt.includes('青春'), 'genre directive / empirical prompt should be rendered in P4');
  assert.doesNotMatch(compiled.systemPrompt, /老白冷硬克制/);
  assert.ok(compiled.userPrompt.includes('同题材真人名作活人感参照'));
  assert.doesNotMatch(compiled.userPrompt, /当前局面处于临界压迫点/);

  const draftReq = buildDraftRequest({
    request: { modelId: 'gemini-4-hydrogen', userInstruction: '写正文', useCompositionV3: true },
    compiled
  });
  assert.equal(draftReq.temperature, 0.85);
});

test('inplace-sanitizer 区分冷笑与温和笑意，且绝不无中生有发明雨水', () => {
  const warm = sanitizeInPlace('她嘴角勾起一抹笑意，把热豆浆推到他手边。');
  assert.doesNotMatch(warm.text, /冷冷吐出半句话/);
  assert.doesNotMatch(warm.text, /嘴角勾起一抹笑意/);

  const hostile = sanitizeInPlace('他嘴角勾起一抹冷笑，站起身逼近两步。');
  assert.doesNotMatch(hostile.text, /嘴角勾起一抹冷笑/);
  assert.match(hostile.text, /眼角微抬|视线骤沉|眉眼纹丝不动/);

  const silence = sanitizeInPlace('院子里陷入死一般的寂静。');
  assert.doesNotMatch(silence.text, /雨水/);
  assert.doesNotMatch(silence.text, /死一般的寂静/);
});

test('correction-policy 通用化 R-47/R-50 并提供《纠错库》靶向诊断与原句→修正句示范', () => {
  assert.doesNotMatch(correctionPolicy.UNIVERSAL_CORRECTION_POLICY_PROMPT, /功德簿墙|圣王|符箓|道法破绽/);
  for (const code of ['R-01', 'R-47', 'R-50']) {
    assert.ok(correctionPolicy.UNIVERSAL_CORRECTION_POLICY_PROMPT.includes(code));
  }

  const badDraft = '屋里陷入死一般的寂静。她嘴角勾起一抹冷笑，目光如刀，声音从夜色里漏出来。他只觉得喉咙发紧，呼吸骤然一滞。普通人未必能分辨，叶辰却太熟悉。';
  const guidance = correctionPolicy.buildTargetedCorrectionGuidance(badDraft, { genre: '都市言情' });
  assert.ok(guidance.findingCount >= 3);
  assert.ok(guidance.block.includes('【本篇初稿《纠错库》逐项病灶定位'));
  assert.ok(guidance.block.includes('【《纠错库》原句 → 修正句示范'));
  assert.doesNotMatch(guidance.block, /佳云泽|顾凝欣|慕容天|叶辰|叶天|叶宁|周烈|千嶂山脉/);
  assert.doesNotMatch(guidance.block, /R-14-template-smile.*比喻必须准确对应人物态度/);
  assert.doesNotMatch(guidance.block, /R-20-contrast-cliche.*线索不足时只表达当前信息边界/);
});

test('humanize-policy-service Pass 2 同时注入实测诊断、《纠错库》对照示例与《小说原本》活人示范', () => {
  const service = createHumanizePolicyService({
    buildHumanizeLexiconBlock,
    UNIVERSAL_CORRECTION_MARKER: '<!-- molan-universal-correction-policy-v1 -->',
    UNIVERSAL_CORRECTION_POLICY_PROMPT: correctionPolicy.UNIVERSAL_CORRECTION_POLICY_PROMPT
  });
  const badDraft = '所有人都愣住了。她的嘴角勾起一抹弧度，目光如刀，空气中仿佛凝固了一般。他心跳漏了一拍，呼吸一滞。';
  const aiFlavorReport = computeAiFlavorScore(badDraft);
  const correctionScan = correctionPolicy.scanUniversalCorrectionRisks(badDraft, { genre: '青春甜宠', includeLibrary: true });
  const textureReport = analyzeHumanTexture(badDraft, { genre: '青春甜宠' });

  const messages = service.buildHumanizePassMessages(badDraft, {
    genre: '青春甜宠',
    targetChars: 2400,
    aiFlavorReport,
    correctionScan,
    textureReport
  });
  assert.equal(messages.length, 2);
  assert.ok(messages[0].content.includes('改写边界'));
  assert.ok(messages[0].content.includes('不强制每段句数'));
  assert.ok(messages[0].content.includes('【本篇初稿实测 AI 味诊断'));
  assert.ok(messages[0].content.includes('【本篇初稿《纠错库》逐项病灶定位'));
  assert.ok(messages[0].content.includes('【《纠错库》原句 → 修正句示范'));
  assert.ok(messages[0].content.includes('同题材真人名作活人感参照'));
  assert.ok(messages[1].content.includes(badDraft));
});

test('chat-service 两遍精修整合《小说原本》范本与《纠错库》靶向诊断并留足推理预算', async () => {
  const { EventEmitter } = require('node:events');
  const { createChatService } = require('../services/chat-service');
  const { resolveFingerprintProfile, buildRhythmTargetBlock } = require('../lib/style-fingerprint');

  const humanizeService = createHumanizePolicyService({
    buildHumanizeLexiconBlock,
    UNIVERSAL_CORRECTION_MARKER: '<!-- molan-universal-correction-policy-v1 -->',
    UNIVERSAL_CORRECTION_POLICY_PROMPT: correctionPolicy.UNIVERSAL_CORRECTION_POLICY_PROMPT
  });

  const acpModel = {
    id: 'gemini-4-hydrogen',
    name: 'Gemini 4 Hydrogen (官方 ACP)',
    group: 'antigravity',
    provider: 'antigravity-acp',
    model: 'gemini-4-hydrogen',
    supportsReasoning: true,
    reasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
    defaultReasoningEffort: 'high',
    promptCaching: false
  };

  const upstreamRequests = [];
  const service = createChatService({
    getDatabase: () => null,
    getEnvironment: () => ({}),
    getDeepseekKey: () => '',
    getDeepseekUrl: () => '',
    getProxyUrl: () => '',
    POSTGRES_MODE: false,
    postgresRepository: { enabled: false },
    postgresActor: () => 'u_1',
    getAuthUser: () => ({ user: { userId: 'u_1', email: 'test@local' } }),
    requireSqliteForPublic: () => false,
    allowChatRate: () => true,
    acquireChatSlot: () => true,
    releaseChatSlot: () => {},
    json: (res, code, data) => { res.statusCode = code; res.body = data; },
    readBody: async () => ({
      model: 'gemini-4-hydrogen',
      stage: 'writing',
      genre: '青春甜宠',
      targetChars: 2400,
      characterMaterial: { proseTask: true, genre: '青春甜宠' },
      messages: [
        { role: 'system', content: '小说正文创作任务' },
        { role: 'user', content: '写便利店避雨互动正文' }
      ]
    }),
    respondError: (_res, err) => { throw err; },
    CHAT_MAX_JSON_BODY_BYTES: 1024 * 1024,
    nativeSkillCatalog: async () => null,
    appRepository: () => ({ recordDispatchAttempt: async () => ({ ok: true, authorized: true }) }),
    projectScope: { stableUserId: x => x },
    isAdminUser: () => true,
    INTERNAL_MODEL_ROUTE_KEY: 'internal-secret',
    INTERNAL_MODEL_ROUTE_HEADER: 'x-molan-internal-route',
    generationV2Enabled: () => true,
    validateChatMessages: m => m,
    splitDynamicPrompt: m => m,
    detectNovelStyle: () => '',
    adaptIpContinuationMessages: m => m,
    DEFAULT_WRITING_SKILL_ID: 'writing',
    loadEditorOnlyWritingSkill: () => null,
    ensureEditorOnlyWritingSkill: m => ({ messages: m, injected: false }),
    editorOnlySkillAuditRequest: () => ({}),
    ensureDefaultWritingSkill: m => ({ messages: m, injected: false }),
    addDefaultWritingSkillAudit: () => ({}),
    buildSkillAudit: () => ({ skills: [] }),
    prepareSkillMessagesForUpstream: (_auth, m, skillAudit) => ({ messages: m, skillAudit }),
    correctionPolicyEnabled: () => false,
    isTwoPassHumanizeEnabled: () => true,
    loadEditorOnlyCorrectionLibrary: () => null,
    CORRECTION_PRIOR_TEXT_MAX_CHARS: 1000,
    lastUserMessageText: () => '',
    injectEditorOnlyCorrectionLibrary: m => m,
    EDITOR_ONLY_CORRECTION_VERSION: '1.0',
    EDITOR_ONLY_CORRECTION_FILE_DEFAULT: '',
    UNIVERSAL_CORRECTION_POLICY_VERSION: '1.0',
    UNIVERSAL_CORRECTION_STAGES: [],
    injectUniversalCorrectionPolicy: m => m,
    emptyEditorOnlyCharacterMaterialResult: () => ({ messages: [], audit: {} }),
    buildCharacterMaterialBlock,
    isMatureCharacterMaterialEnabledForNovel: () => false,
    reviewCharacterMaterialSamples: async () => ({ approvedIds: [], audit: { required: false } }),
    calculateCharacterMaterialRhythmDeviation: () => 0,
    scanCharacterMaterialOverlap: () => ({ blocked: false, overlapFragments: [], leakedTerms: [] }),
    injectPromptInjectionGuard: m => m,
    resolveFingerprintProfile,
    buildRhythmTargetBlock,
    appendSystemBlock: humanizeService.appendSystemBlock,
    planContextWindow: (_pm, msgs, reqMax) => ({
      ok: true,
      messages: msgs,
      promptTokens: 100,
      contextWindowTokens: 1000000,
      availableCompletionTokens: reqMax || 8192,
      dynamicPromptTruncated: false
    }),
    sanitizeSystemForUpstream: s => s,
    internalModelIdFromRequest: () => '',
    resolveModelForUser: () => 'gemini-4-hydrogen',
    findPlatformModel: () => acpModel,
    currentDefaultModel: () => 'gemini-4-hydrogen',
    buildHumanizePassMessages: humanizeService.buildHumanizePassMessages,
    mergeUsageSum: humanizeService.mergeUsageSum,
    computeAiFlavorScore: () => ({ score: 12, passed: true, metrics: { structuralRiskTotal: 0 }, details: { blockHits: [] } }),
    summarizeAiFlavorVerdict: humanizeService.summarizeAiFlavorVerdict,
    addPromptCacheBreakpoint: m => m,
    normalizeReasoningEffort: (_pm, v) => v || '',
    stablePromptCacheKey: () => 'k',
    reserveCredits: async () => ({ ok: true }),
    planCreditReservation: () => ({ ok: true, maxTokens: 8192, reservedCost: 0 }),
    normalizeUsage: u => ({ promptTokens: u && u.prompt_tokens || 0, completionTokens: u && u.completion_tokens || 0, totalTokens: u && u.total_tokens || 0 }),
    estimateTextTokenUpperBound: () => 500,
    creditCostForUser: () => 0,
    roundCreditValue: v => v,
    emptyCorrectionAudit: () => ({}),
    scanUniversalCorrectionRisks: correctionPolicy.scanUniversalCorrectionRisks,
    recordCorrectionHits: () => {},
    settleTokenUsage: async () => ({ ok: true }),
    openUpstream: () => { throw new Error('HTTP openUpstream must not be called for antigravity-acp'); },
    openAcpUpstream: (reqOpts, cb) => {
      const req = new EventEmitter();
      let buf = '';
      req.write = c => { buf += c; };
      req.destroy = () => {};
      req.end = () => {
        const parsed = JSON.parse(buf);
        upstreamRequests.push(parsed);
        const callIndex = upstreamRequests.length;
        const upRes = new EventEmitter();
        upRes.statusCode = 200;
        upRes.setEncoding = () => {};
        upRes.resume = () => {};
        reqOpts.onResponse(upRes);
        const text = callIndex === 1
          ? '便利店里陷入死一般的寂静，她嘴角勾起一抹弧度，所有人同时转头看过来。'
          : '便利店玻璃门上的雨点往下滑，她拎起塑料袋顺手往他那边递了一把。';
        upRes.emit('data', `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
        upRes.emit('data', 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n');
        upRes.emit('data', 'data: [DONE]\n\n');
        upRes.emit('end');
      };
      cb(null, req);
      return req;
    },
    responseCors: () => ({}),
    UPSTREAM_MAX_RESPONSE_BYTES: 1024 * 1024,
    UPSTREAM_SSE_BUFFER_BYTES: 65536,
    UPSTREAM_QUALITY_SCAN_MAX_CHARS: 10000,
    UPSTREAM_TOTAL_TIMEOUT_MS: 30000,
    LIVE_BILLING_EVENT_INTERVAL_MS: 5000
  });

  let sseOut = '';
  let finishRes;
  const donePromise = new Promise(resolve => { finishRes = resolve; });
  const res = {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    on: () => {},
    once: () => {},
    setHeader: () => {},
    writeHead: () => { res.headersSent = true; },
    write: chunk => { sseOut += chunk; },
    end: () => { res.writableEnded = true; finishRes(); }
  };

  await service.handleChat({ headers: { 'x-molan-internal-route': 'internal-secret' }, on: () => {}, once: () => {} }, res);
  if (!res.writableEnded) {
    assert.equal(res.statusCode, undefined, 'unexpected json error: ' + JSON.stringify(res.body));
    await donePromise;
  }

  assert.equal(upstreamRequests.length, 2, 'must trigger Pass 2 on 纠错库 hit even when AI score is 12');
  const pass1Text = upstreamRequests[0].messages.map(m => m.content).join('\n');
  assert.ok(pass1Text.includes('同题材真人名作活人感参照'), 'Pass 1 must inject 《小说原本》 living exemplars');

  const pass2Body = upstreamRequests[1];
  const pass2System = pass2Body.messages[0].content;
  assert.ok(pass2Body.max_completion_tokens >= 6144, 'Pass 2 reasoning model must reserve >= 6144 tokens');
  assert.ok(pass2System.includes('【本篇初稿《纠错库》逐项病灶定位'), 'Pass 2 must receive per-draft 纠错库 findings');
  assert.ok(pass2System.includes('【《纠错库》原句 → 修正句示范'), 'Pass 2 must receive 纠错库 before->after examples');
  assert.ok(pass2System.includes('同题材真人名作活人感参照'), 'Pass 2 must receive 《小说原本》 living exemplars');
  assert.match(sseOut, /便利店玻璃门上的雨点往下滑/);
});

test('completion-editor.js 语法完整无重声明错误', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const src = fs.readFileSync(path.join(__dirname, '..', 'completion-editor.js'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(src, { filename: 'completion-editor.js' }));
});

test('run-context 透传 UI 题材/风格/章节功能/侧重点/钩子字段，且不覆写中性默认风格为老白冷硬', () => {
  const { normalizeGenerationRequest } = require('../lib/generation/run-context');
  const { buildNeutralDefaultBundle } = require('../lib/style/style-resolver');
  const { normalized, request } = (() => {
    const out = normalizeGenerationRequest({
      projectId: 'n_test',
      idempotencyKey: 'idem_living_1',
      genre: 'modern_romance',
      novelGenre: 'modern_romance',
      genreFamily: 'modern_romance',
      writingStyle: '缱绻细腻',
      styleArchetype: '缱绻细腻',
      chapterFunction: 'emotion_pull',
      chapterFocus: 'dialogue',
      endingHook: '反转钩',
      prompt: '写一段雨夜咖啡店偶遇正文'
    });
    return { normalized: out, request: out.request };
  })();
  assert.equal(normalized.request.novelGenre, 'modern_romance');
  assert.equal(normalized.request.genreFamily, 'modern_romance');
  assert.equal(normalized.request.writingStyle, '缱绻细腻');
  assert.equal(normalized.request.chapterFunction, 'emotion_pull');
  assert.equal(normalized.request.chapterFocus, 'dialogue');
  assert.equal(normalized.request.endingHook, '反转钩');
  assert.equal(normalized.request.modelParams.temperature, 0.85);

  // 中性默认 style bundle 不应覆盖青春甜宠/现代言情的题材自适应风格
  const neutral = buildNeutralDefaultBundle();
  const compiled = compileDraftPrompt({
    request: {
      useCompositionV3: true,
      novelGenre: 'modern_romance',
      modelId: 'gemini-4-hydrogen',
      userInstruction: '写雨夜咖啡店偶遇。'
    },
    genre: 'modern_romance',
    style: neutral,
    context: '前情：两人冷战一周。'
  });
  assert.doesNotMatch(compiled.systemPrompt, /老白冷硬克制/);
  assert.match(compiled.systemPrompt, /甜宠|校园|言情/);
});

test('buildLivingProseExemplarBlock 过滤作者废话噪音、支持英文题材ID并拒绝破碎占位符', () => {
  const filler = '巷口早点摊的煤炉已经架起来了，铁锅底烧得发红，老板娘拿长筷子拨着油条，油花噼啪往外溅，热气顺着掀起的布帘子直往外冒，路边蹲着喝豆腐脑的老头吸溜吸溜喝完碗底最后一点卤，把零钱拍在木头桌角上招呼着再来两根麻花。旁边修车铺的伙计刚拉起卷闸门，铁链哗啦响了一声，他又拎起半桶凉水泼在门槛前。';
  assert.equal(isCleanExemplarSample({ text: '【脑子寄存柜，寄存大脑】' + filler, flavorScore: 0 }), false);
  assert.equal(isBrokenAnonymizedText('【人戊】道又开放了。'), true);
  assert.equal(isBrokenAnonymizedText('孩子喝了几口水，【人乙】。'), true);
  assert.equal(anonymizeSampleText('全区频道又开放了，他拿着鱼竿马上走。').includes('【人'), false);

  for (const g of ['modern_romance', 'scifi_apocalypse', 'suspense', 'history', 'ancient_romance', 'urban_martial', 'universal']) {
    const res = buildLivingProseExemplarBlock({ genre: g, query: '主角对话试探' }, { limit: 2, maxExcerptChars: 380 });
    assert.ok(res && res.samples.length >= 1, `${g} should yield clean exemplars`);
    for (const s of res.samples) {
      assert.doesNotMatch(s.text, /【脑子寄存|求收藏|搜笔趣阁|【人[甲乙丙丁戊己庚辛壬癸]】/);
    }
  }
});

test('humanize-policy-service 真实透传 structuralRisks 对象、句长方差比与 human-texture cliches', () => {
  const service = createHumanizePolicyService({
    buildHumanizeLexiconBlock,
    UNIVERSAL_CORRECTION_MARKER: '<!-- molan-universal-correction-policy-v1 -->',
    UNIVERSAL_CORRECTION_POLICY_PROMPT: correctionPolicy.UNIVERSAL_CORRECTION_POLICY_PROMPT
  });
  const badDraft = '他嘴角勾起一抹弧度。\n\n他没有退。\n\n他指腹反复摩挲着杯沿，瞳孔骤然收缩。\n\n咚。';
  const aiFlavorReport = {
    score: 48,
    passed: false,
    metrics: { sentenceStdRatio: 0.48, paragraphUniformity: 0.28, structuralRiskTotal: 3 },
    details: {
      blockHits: [{ term: '嘴角勾起一抹', count: 1 }],
      structuralRisks: { pseudoFragCount: 1, turnTakingCount: 0, binarySymmetryCount: 0, isolatedExplanatoryCount: 1, somaticOverreactionCount: 1 }
    }
  };
  const textureReport = analyzeHumanTexture(badDraft, { genre: '都市' });
  const msgs = service.buildHumanizePassMessages(badDraft, {
    genre: '都市',
    aiFlavorReport,
    textureReport
  });
  const sys = msgs[0].content;
  assert.ok(sys.includes('拟声/断语孤立碎段'), 'must report structuralRisks object counts');
  assert.ok(sys.includes('句长起伏偏平'), 'must report sentenceStdRatio');
  assert.ok(sys.includes('段落长度过于均匀'), 'must report paragraphUniformity');
  assert.ok(sys.includes('人味质感命中套话'), 'must report analyzeHumanTexture().cliches');
});

test('chat-service 当 precompiledPrompt 已含《小说原本》范本时不重复注入第二次', async () => {
  const { EventEmitter } = require('node:events');
  const { createChatService } = require('../services/chat-service');
  const { resolveFingerprintProfile, buildRhythmTargetBlock } = require('../lib/style-fingerprint');
  const humanizeService = createHumanizePolicyService({
    buildHumanizeLexiconBlock,
    UNIVERSAL_CORRECTION_MARKER: '<!-- molan-universal-correction-policy-v1 -->',
    UNIVERSAL_CORRECTION_POLICY_PROMPT: correctionPolicy.UNIVERSAL_CORRECTION_POLICY_PROMPT
  });
  const precompiled = compileDraftPrompt({
    request: { useCompositionV3: true, novelGenre: '青春甜宠', modelId: 'gemini-4-hydrogen', userInstruction: '写避雨对话' },
    context: '前情：雨天放学。'
  });
  const upstreamRequests = [];
  const service = createChatService({
    getDatabase: () => null,
    getEnvironment: () => ({}),
    getDeepseekKey: () => '',
    getDeepseekUrl: () => '',
    getProxyUrl: () => '',
    postgresRepository: { enabled: false },
    postgresActor: () => 'u_1',
    getAuthUser: () => ({ user: { userId: 'u_1', email: 'test@local' } }),
    allowChatRate: () => true,
    acquireChatSlot: () => true,
    releaseChatSlot: () => {},
    json: (res, code, data) => { res.statusCode = code; res.body = data; },
    readBody: async () => ({
      model: 'gemini-4-hydrogen',
      stage: 'writing',
      genre: '青春甜宠',
      precompiledPrompt: true,
      characterMaterial: { mode: 'raw', proseTask: true, includeParagraphExemplars: true, genre: '青春甜宠' },
      messages: [
        { role: 'system', content: precompiled.systemPrompt },
        { role: 'user', content: precompiled.userPrompt }
      ]
    }),
    respondError: (_res, err) => { throw err; },
    CHAT_MAX_JSON_BODY_BYTES: 1024 * 1024,
    nativeSkillCatalog: async () => null,
    appRepository: () => ({ recordDispatchAttempt: async () => ({ ok: true, authorized: true }) }),
    projectScope: { stableUserId: x => x },
    isAdminUser: () => true,
    INTERNAL_MODEL_ROUTE_KEY: 'internal-secret',
    INTERNAL_MODEL_ROUTE_HEADER: 'x-molan-internal-route',
    generationV2Enabled: () => true,
    validateChatMessages: m => m,
    splitDynamicPrompt: m => m,
    detectNovelStyle: () => '',
    adaptIpContinuationMessages: m => m,
    DEFAULT_WRITING_SKILL_ID: 'writing',
    loadEditorOnlyWritingSkill: () => null,
    ensureEditorOnlyWritingSkill: m => ({ messages: m, injected: false }),
    editorOnlySkillAuditRequest: () => ({}),
    ensureDefaultWritingSkill: m => ({ messages: m, injected: false }),
    addDefaultWritingSkillAudit: () => ({}),
    buildSkillAudit: () => ({ skills: [] }),
    prepareSkillMessagesForUpstream: (_auth, m, skillAudit) => ({ messages: m, skillAudit }),
    correctionPolicyEnabled: () => false,
    isTwoPassHumanizeEnabled: () => false,
    loadEditorOnlyCorrectionLibrary: () => null,
    CORRECTION_PRIOR_TEXT_MAX_CHARS: 1000,
    lastUserMessageText: () => '',
    injectEditorOnlyCorrectionLibrary: m => m,
    EDITOR_ONLY_CORRECTION_VERSION: '1.0',
    EDITOR_ONLY_CORRECTION_FILE_DEFAULT: '',
    UNIVERSAL_CORRECTION_POLICY_VERSION: '1.0',
    UNIVERSAL_CORRECTION_STAGES: [],
    injectUniversalCorrectionPolicy: m => m,
    emptyEditorOnlyCharacterMaterialResult: () => ({ messages: [], audit: {} }),
    buildCharacterMaterialBlock,
    isMatureCharacterMaterialEnabledForNovel: () => false,
    reviewCharacterMaterialSamples: async () => ({ approvedIds: [], audit: { required: false } }),
    calculateCharacterMaterialRhythmDeviation: () => 0,
    scanCharacterMaterialOverlap: () => ({ blocked: false, overlapFragments: [], leakedTerms: [] }),
    injectPromptInjectionGuard: m => m,
    resolveFingerprintProfile,
    buildRhythmTargetBlock,
    appendSystemBlock: humanizeService.appendSystemBlock,
    planContextWindow: (_pm, msgs, reqMax) => ({ ok: true, messages: msgs, promptTokens: 100, contextWindowTokens: 1000000, availableCompletionTokens: reqMax || 8192, dynamicPromptTruncated: false }),
    sanitizeSystemForUpstream: s => s,
    internalModelIdFromRequest: () => '',
    resolveModelForUser: () => 'gemini-4-hydrogen',
    findPlatformModel: () => ({ id: 'gemini-4-hydrogen', provider: 'antigravity-acp', model: 'gemini-4-hydrogen', supportsReasoning: true, defaultReasoningEffort: 'high', promptCaching: false }),
    currentDefaultModel: () => 'gemini-4-hydrogen',
    buildHumanizePassMessages: humanizeService.buildHumanizePassMessages,
    mergeUsageSum: humanizeService.mergeUsageSum,
    computeAiFlavorScore: () => ({ score: 8, passed: true, metrics: { structuralRiskTotal: 0 }, details: { blockHits: [] } }),
    summarizeAiFlavorVerdict: humanizeService.summarizeAiFlavorVerdict,
    addPromptCacheBreakpoint: m => m,
    normalizeReasoningEffort: (_pm, v) => v || '',
    stablePromptCacheKey: () => 'k',
    reserveCredits: async () => ({ ok: true }),
    planCreditReservation: () => ({ ok: true, maxTokens: 8192, reservedCost: 0 }),
    normalizeUsage: u => ({ promptTokens: u && u.prompt_tokens || 0, completionTokens: u && u.completion_tokens || 0, totalTokens: u && u.total_tokens || 0 }),
    estimateTextTokenUpperBound: () => 500,
    creditCostForUser: () => 0,
    roundCreditValue: v => v,
    emptyCorrectionAudit: () => ({}),
    scanUniversalCorrectionRisks: correctionPolicy.scanUniversalCorrectionRisks,
    recordCorrectionHits: () => {},
    settleTokenUsage: async () => ({ ok: true }),
    openUpstream: () => { throw new Error('unexpected'); },
    openAcpUpstream: (reqOpts, cb) => {
      const req = new EventEmitter();
      let buf = '';
      req.write = c => { buf += c; };
      req.destroy = () => {};
      req.end = () => {
        upstreamRequests.push(JSON.parse(buf));
        const upRes = new EventEmitter();
        upRes.statusCode = 200;
        upRes.setEncoding = () => {};
        upRes.resume = () => {};
        reqOpts.onResponse(upRes);
        upRes.emit('data', 'data: {"choices":[{"delta":{"content":"雨停了，她把伞收起来。"}}]}\n\n');
        upRes.emit('data', 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n');
        upRes.emit('data', 'data: [DONE]\n\n');
        upRes.emit('end');
      };
      cb(null, req);
      return req;
    },
    responseCors: () => ({}),
    UPSTREAM_MAX_RESPONSE_BYTES: 1024 * 1024,
    UPSTREAM_SSE_BUFFER_BYTES: 65536,
    UPSTREAM_QUALITY_SCAN_MAX_CHARS: 10000,
    UPSTREAM_TOTAL_TIMEOUT_MS: 30000,
    LIVE_BILLING_EVENT_INTERVAL_MS: 5000
  });
  let finishRes;
  const donePromise = new Promise(resolve => { finishRes = resolve; });
  const res = {
    headersSent: false, writableEnded: false, destroyed: false,
    on: () => {}, once: () => {}, setHeader: () => {},
    writeHead: () => { res.headersSent = true; },
    write: () => {},
    end: () => { res.writableEnded = true; finishRes(); }
  };
  await service.handleChat({ headers: { 'x-molan-internal-route': 'internal-secret' }, on: () => {}, once: () => {} }, res);
  if (!res.writableEnded) await donePromise;
  const fullPrompt = upstreamRequests[0].messages.map(m => m.content).join('\n');
  const markerHits = fullPrompt.match(/molan-living-prose-exemplars-v1/g) || [];
  assert.equal(markerHits.length, 1, 'living exemplar block must be injected exactly once');
});

test('纠错库泛化规则与朱雀统计维度可真实命中“压回/视线落在/嘴角扯起/翻译腔/单句段/盯视”', () => {
  const { resolveFingerprintProfile } = require('../lib/style-fingerprint');
  const { analyzeHumanTexture } = require('../lib/style/human-texture');
  assert.ok(resolveFingerprintProfile('modern_romance').matchedBucket, 'modern_romance 应命中真实语料指纹桶');
  assert.ok(resolveFingerprintProfile('urban_martial').matchedBucket, 'urban_martial 应命中真实语料指纹桶');

  const sample = [
    '铁门卡簧发出嘎啦一声酸涩的钝响。',
    '陈阿明站在原地。',
    '他的视线落在对方球鞋上，嘴角扯起一点冷肉。',
    '皮肤底下某种类似水银般的微温感正顺着腕骨悄无声息地往指尖涌，但他只是吸了口气，把那股温热硬生生压回掌纹深处。',
    '陈阿明盯着镜子里的自己。',
    '他又盯着门缝看了一阵。',
    '夜风刮了进来。',
    '外头的路灯灭了。'
  ].join('\n\n');

  const scan = correctionPolicy.scanUniversalCorrectionRisks(sample, { genre: 'urban_martial', includeLibrary: true });
  assert.ok(scan.findingCount >= 4, '应真实扫出泛化纠错库病灶');
  assert.ok(scan.matchedRuleIds.includes('R-01-sensory-personification'));
  assert.ok(scan.matchedRuleIds.includes('R-04-redundant-emotion'));
  assert.ok(scan.matchedRuleIds.includes('R-13-artificial-body-subject'));
  assert.ok(scan.matchedRuleIds.includes('R-14-template-smile'));
  assert.ok(scan.matchedRuleIds.includes('R-41-hidden-translationese'));

  const guidance = correctionPolicy.buildTargetedCorrectionGuidance(sample, { genre: 'urban_martial', scan });
  assert.ok(guidance.block.includes('R-46'));
  assert.ok(guidance.block.includes('C07-02'));
  assert.ok(guidance.examples.length >= 3);

  const ai = computeAiFlavorScore(sample, resolveFingerprintProfile('urban_martial').profile);
  assert.ok(ai.metrics.zhuqueSignals.llmGluePerKilo > 0);
  assert.ok(ai.metrics.zhuqueSignals.singleNarrativeCount >= 4);
  const tx = analyzeHumanTexture(sample);
  assert.ok(tx.structuralIssues.some(i => i.type === 'single_sentence_paragraph_overflow'));
});

test('chat-service 两遍模式下 >=200字初稿即使浅层分不高也不跳过第二遍《纠错库》改写', async () => {
  const { createChatService } = require('../services/chat-service');
  const { createHumanizePolicyService } = require('../services/humanize-policy-service');
  const { buildCharacterMaterialBlock } = require('../lib/character-material');
  const { resolveFingerprintProfile, buildRhythmTargetBlock } = require('../lib/style-fingerprint');
  const { buildHumanizeLexiconBlock } = require('../lib/ai-flavor-detector');
  const { EventEmitter } = require('node:events');
  const humanizeService = createHumanizePolicyService({
    buildHumanizeLexiconBlock,
    UNIVERSAL_CORRECTION_MARKER: '<!-- m -->',
    UNIVERSAL_CORRECTION_POLICY_PROMPT: correctionPolicy.UNIVERSAL_CORRECTION_POLICY_PROMPT
  });
  const upstreamRequests = [];
  const longFirstPass = '陈阿明把扫帚倚在镜台边，满地的细碎发茬刚聚成小堆，门底下的铁皮猛地被人往上一掀。'.repeat(5);
  const service = createChatService({
    getDatabase: () => null,
    getEnvironment: () => ({}),
    getDeepseekKey: () => '',
    getDeepseekUrl: () => '',
    getProxyUrl: () => '',
    postgresRepository: { enabled: false },
    postgresActor: () => 'u_1',
    getAuthUser: () => ({ user: { userId: 'u_1', email: 'test@local' } }),
    allowChatRate: () => true,
    acquireChatSlot: () => true,
    releaseChatSlot: () => {},
    json: (res, code, data) => { res.statusCode = code; res.body = data; },
    readBody: async () => ({
      stage: 'writing',
      twoPassHumanize: true,
      genre: 'urban_martial',
      model: 'gemini-3.8-flash-acp',
      messages: [{ role: 'user', content: '写一段发廊夜雨戏' }]
    }),
    respondError: (_res, err) => { throw err; },
    CHAT_MAX_JSON_BODY_BYTES: 1024 * 1024,
    nativeSkillCatalog: async () => null,
    appRepository: () => ({ recordDispatchAttempt: async () => ({ ok: true, authorized: true }) }),
    projectScope: { stableUserId: x => x },
    isAdminUser: () => true,
    INTERNAL_MODEL_ROUTE_KEY: 'internal-secret',
    INTERNAL_MODEL_ROUTE_HEADER: 'x-molan-internal-route',
    generationV2Enabled: () => true,
    validateChatMessages: m => m,
    splitDynamicPrompt: m => m,
    detectNovelStyle: () => '都市',
    adaptIpContinuationMessages: m => m,
    DEFAULT_WRITING_SKILL_ID: 'writing',
    loadEditorOnlyWritingSkill: () => null,
    ensureEditorOnlyWritingSkill: m => ({ messages: m, injected: false }),
    editorOnlySkillAuditRequest: () => ({}),
    ensureDefaultWritingSkill: m => ({ messages: m, injected: false }),
    addDefaultWritingSkillAudit: () => ({}),
    buildSkillAudit: () => ({ skills: [] }),
    prepareSkillMessagesForUpstream: (_auth, m, skillAudit) => ({ messages: m, skillAudit }),
    correctionPolicyEnabled: () => true,
    isTwoPassHumanizeEnabled: humanizeService.isTwoPassHumanizeEnabled,
    loadEditorOnlyCorrectionLibrary: () => null,
    CORRECTION_PRIOR_TEXT_MAX_CHARS: 2000,
    lastUserMessageText: m => m[m.length - 1]?.content || '',
    injectEditorOnlyCorrectionLibrary: m => m,
    EDITOR_ONLY_CORRECTION_VERSION: 'v2',
    EDITOR_ONLY_CORRECTION_FILE_DEFAULT: '',
    UNIVERSAL_CORRECTION_POLICY_VERSION: 'v3',
    UNIVERSAL_CORRECTION_STAGES: ['writing'],
    injectUniversalCorrectionPolicy: m => m,
    emptyEditorOnlyCharacterMaterialResult: () => ({ messages: [], audit: {} }),
    buildCharacterMaterialBlock,
    isMatureCharacterMaterialEnabledForNovel: () => false,
    reviewCharacterMaterialSamples: async () => ({ approvedIds: [], audit: { required: false } }),
    calculateCharacterMaterialRhythmDeviation: () => 0,
    scanCharacterMaterialOverlap: () => ({ blocked: false, overlapFragments: [], leakedTerms: [] }),
    injectPromptInjectionGuard: m => m,
    resolveFingerprintProfile,
    buildRhythmTargetBlock,
    appendSystemBlock: humanizeService.appendSystemBlock,
    planContextWindow: (_pm, msgs, reqMax) => ({ ok: true, messages: msgs, promptTokens: 100, contextWindowTokens: 1000000, availableCompletionTokens: reqMax || 8192, dynamicPromptTruncated: false }),
    sanitizeSystemForUpstream: s => s,
    internalModelIdFromRequest: () => '',
    resolveModelForUser: () => 'gemini-3.8-flash-acp',
    findPlatformModel: () => ({ id: 'gemini-3.8-flash-acp', provider: 'antigravity-acp', model: 'gemini-3.8-flash-acp', supportsReasoning: false, promptCaching: false }),
    currentDefaultModel: () => 'gemini-3.8-flash-acp',
    buildHumanizePassMessages: humanizeService.buildHumanizePassMessages,
    mergeUsageSum: humanizeService.mergeUsageSum,
    computeAiFlavorScore: () => ({ score: 0, passed: true, metrics: { structuralRiskTotal: 0 }, details: { blockHits: [] } }),
    summarizeAiFlavorVerdict: humanizeService.summarizeAiFlavorVerdict,
    addPromptCacheBreakpoint: m => m,
    normalizeReasoningEffort: () => '',
    stablePromptCacheKey: () => 'k',
    reserveCredits: async () => ({ ok: true }),
    planCreditReservation: () => ({ ok: true, maxTokens: 8192, reservedCost: 0 }),
    normalizeUsage: u => ({ promptTokens: u?.prompt_tokens || 0, completionTokens: u?.completion_tokens || 0, totalTokens: u?.total_tokens || 0 }),
    estimateTextTokenUpperBound: () => 500,
    creditCostForUser: () => 0,
    roundCreditValue: v => v,
    emptyCorrectionAudit: () => ({}),
    scanUniversalCorrectionRisks: correctionPolicy.scanUniversalCorrectionRisks,
    recordCorrectionHits: () => {},
    settleTokenUsage: async () => ({ ok: true }),
    openUpstream: () => { throw new Error('unexpected'); },
    openAcpUpstream: (reqOpts, cb) => {
      const req = new EventEmitter();
      let buf = '';
      req.write = c => { buf += c; };
      req.destroy = () => {};
      req.end = () => {
        upstreamRequests.push(JSON.parse(buf));
        const callIndex = upstreamRequests.length;
        const upRes = new EventEmitter();
        upRes.statusCode = 200;
        upRes.setEncoding = () => {};
        upRes.resume = () => {};
        reqOpts.onResponse(upRes);
        const content = callIndex === 1 ? longFirstPass : '陈阿明把扫帚靠在桌腿边，外头雨点敲在铁皮上噼啪响，他搓了搓手上的洗发水沫去拉卷帘门。';
        upRes.emit('data', `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
        upRes.emit('data', 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n');
        upRes.emit('data', 'data: [DONE]\n\n');
        upRes.emit('end');
      };
      cb(null, req);
      return req;
    },
    responseCors: () => ({}),
    UPSTREAM_MAX_RESPONSE_BYTES: 1024 * 1024,
    UPSTREAM_SSE_BUFFER_BYTES: 65536,
    UPSTREAM_QUALITY_SCAN_MAX_CHARS: 10000,
    UPSTREAM_TOTAL_TIMEOUT_MS: 30000,
    LIVE_BILLING_EVENT_INTERVAL_MS: 5000
  });
  let finishRes;
  const donePromise = new Promise(resolve => { finishRes = resolve; });
  const res = {
    headersSent: false, writableEnded: false, destroyed: false,
    on: () => {}, once: () => {}, setHeader: () => {},
    writeHead: () => { res.headersSent = true; },
    write: () => {},
    end: () => { res.writableEnded = true; finishRes(); }
  };
  await service.handleChat({ headers: { 'x-molan-internal-route': 'internal-secret' }, on: () => {}, once: () => {} }, res);
  if (!res.writableEnded) await donePromise;
  assert.equal(upstreamRequests.length, 2, 'two-pass writing >=200 chars must execute Pass 2 with 纠错库');
  const pass2Sys = upstreamRequests[1].messages[0].content;
  assert.ok(pass2Sys.includes('困惑度') && pass2Sys.includes('剧烈落差'), 'Pass 2 system prompt must include anti-AI statistical guidance');
  assert.ok(pass2Sys.includes('《纠错库》'), 'Pass 2 system prompt must inject 《纠错库》 guidance');
});
