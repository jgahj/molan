'use strict';

/**
 * 全品类网文叙事与情绪门禁（GENRE NARRATIVE AUDIT GATES）
 * 对应 8 大母战区在盲测中暴露的真实硬伤：
 * 1. evaluateClimaxShockGate: 传统玄幻/高武/仙侠高潮打脸反响与生理受创门禁
 * 2. evaluateSuspenseSandboxGate: 悬疑怪谈偷看剧本与上帝视角泄密门禁
 * 3. evaluateSocialDialogueGate: 都市题材反派低智降智口嗨与书面腔门禁
 * 4. evaluateFemaleRomanceGate: 女频古风宅斗/甜宠粗暴男频化与油腻土味门禁
 * 5. evaluateHistoricalEtiquetteGate: 历史正剧现代大词穿帮与朝堂君臣礼制门禁
 */

// 1. 高潮情绪与现场反响门禁
function evaluateClimaxShockGate(content, contract = {}, genre = '') {
  const text = String(content || '');
  const c = contract || {};
  const isClimax = Boolean(
    c.isClimax ||
    c.climaxChapter ||
    Number(c.emotionIntensity || c.intensity || c.tension) >= 7 ||
    /(打脸|决战|破局|斩杀|绝杀|翻盘|震惊|突破|大胜)/.test(String(c.goal || c.task || c.sceneType || ''))
  );

  if (!isClimax) {
    return { passed: true, issue: null };
  }

  // 围观者震惊/反响关键词
  const shockPatterns = /(倒吸.*凉气|目瞪口呆|全场死寂|骇然|失声|呆若木鸡|难以置信|面色狂变|呼吸一窒|满座皆惊|神情僵硬|倒吸一口气|如见鬼魅)/;
  // 实质物理受创或力量反馈细节
  const physicalDamagePatterns = /(血腥|骨裂|焦糊|震颤|崩碎|剧痛|闷哼|暴退|吐血|撕裂|爆鸣|寸步未移|倒飞而出|尘埃散尽)/;

  const hasShock = shockPatterns.test(text);
  const hasDamage = physicalDamagePatterns.test(text);

  if (!hasShock && !hasDamage) {
    return {
      passed: false,
      issue: {
        severity: 'warning',
        category: 'emotional_climax',
        description: '本章标注为高潮/反转破局节点，但正文严重缺乏【围观者情绪反向震惊】与【实质物理受力/受创】描写，爽点反馈平淡。',
        suggestion: '增加至少1-2处第三方围观者的认知破碎反应（如倒吸凉气、杯盏捏碎），并强化骨裂、吐血、爆退等物理受创细节。'
      }
    };
  }

  return { passed: true, issue: null };
}

// 2. 悬疑怪谈沙箱隔离门禁
function evaluateSuspenseSandboxGate(content, contract = {}, genre = '') {
  const text = String(content || '');
  const isSuspense = /(悬疑|怪谈|解密|逃生|灵异|规则)/.test(genre);
  const chapterNo = Number(contract.chapterNo || contract.chapterIndex || 1);

  if (!isSuspense) {
    return { passed: true, issue: null };
  }

  // 前 3 章禁止上帝视角提前剧透核心谜底
  if (chapterNo <= 3) {
    const spoilerPatterns = /(真相其实是|幕后黑手就是|他早已看穿了.*的所有秘密|这个怪谈的生路很简单|一眼便识破了凶手)/;
    const match = text.match(spoilerPatterns);
    if (match) {
      return {
        passed: false,
        issue: {
          severity: 'blocker',
          category: 'suspense_sandbox',
          description: `悬疑开篇第 ${chapterNo} 章出现上帝视角剧透短语（「${match[0]}」），打破了读者探索与沉浸推理的悬念心流。`,
          suggestion: '屏蔽全知视角，将直接结论改为可疑线索碎片，让主角通过试错与感官危机逐步推导出真相。'
        }
      };
    }
  }

  return { passed: true, issue: null };
}

// 3. 都市生活与反派行为门禁
function evaluateSocialDialogueGate(content, contract = {}, genre = '') {
  const text = String(content || '');
  const isUrban = /(都市|高武|脑洞|种田|战神|生活)/.test(genre);

  if (!isUrban) {
    return { passed: true, issue: null };
  }

  // 极度低幼、刻意招仇恨的反派弱智台词
  const lowIqVillainPatterns = /(给我跪下磕头叫爷爷|打断他的两条腿扔出去喂狗|知道我爸是谁吗|天王老子来了也保不住你|小子，你很有种啊)/;
  const match = text.match(lowIqVillainPatterns);
  if (match) {
    return {
      passed: false,
      issue: {
        severity: 'warning',
        category: 'urban_villain_iq',
        description: `都市反派台词出现脸谱化低智口嗨（「${match[0]}」），严重脱离现代社会秩序与法制博弈现实。`,
        suggestion: '将街头式叫嚣改为现代利益施压（如行业封杀、银行抽贷、法律合同陷阱、利用人脉舆论抹黑）。'
      }
    };
  }

  return { passed: true, issue: null };
}

// 4. 女频古风与宅斗仪轨门禁
function evaluateFemaleRomanceGate(content, contract = {}, genre = '') {
  const text = String(content || '');
  const isFemaleRomance = /(宫斗|宅斗|古言|世情|甜宠|豪门|总裁|言情)/.test(genre);

  if (!isFemaleRomance) {
    return { passed: true, issue: null };
  }

  // 粗暴物理刺杀式宅斗（男频打法侵染女频）
  const bruteForceMansion = /(直接拔剑刺向主母|当场一拳打死主母|拔刀架在老夫人脖子上|暴力屠灭后宅)/;
  const bfMatch = text.match(bruteForceMansion);
  if (bfMatch) {
    return {
      passed: false,
      issue: {
        severity: 'blocker',
        category: 'female_genre_integrity',
        description: `后宅/宫斗场景出现男频化粗暴武力破局（「${bfMatch[0]}」），违背了古风宅斗的名节礼制与借刀杀人核心看点。`,
        suggestion: '改用内宅规则、宗族族规、账本核对、名声清白与借长辈威严进行惩治，严禁简单粗暴物理刺杀。'
      }
    };
  }

  // 油腻土味霸总台词
  const greasyBossPatterns = /(小东西，你成功引起了我的注意|女人，你这是在玩火|命都给你，满意了吗)/;
  const gbMatch = text.match(greasyBossPatterns);
  if (gbMatch) {
    return {
      passed: false,
      issue: {
        severity: 'warning',
        category: 'romance_greasy',
        description: `言情互动出现过时油腻霸总台词（「${gbMatch[0]}」），削弱现代读者的情感共鸣。`,
        suggestion: '改为眼神避让、微表情克制、指节紧绷与行动上的暗中护短，避免口头说教式煽情。'
      }
    };
  }

  return { passed: true, issue: null };
}

// 5. 历史古代正统礼制与语言穿越门禁
function evaluateHistoricalEtiquetteGate(content, contract = {}, genre = '') {
  const text = String(content || '');
  const isHistory = /(历史|古代|军事|明朝|大唐|三国|汉朝)/.test(genre);

  if (!isHistory) {
    return { passed: true, issue: null };
  }

  // 现代网络流行或金融管理大词误入古风正文
  const modernJargon = /(经济模型|宏观调控|降维打击|互联网思维|大数据沉淀|底层逻辑|私域流量)/;
  const match = text.match(modernJargon);
  if (match) {
    return {
      passed: false,
      issue: {
        severity: 'warning',
        category: 'historical_anachronism',
        description: `历史古代行文中出现现代经济/管理学名词（「${match[0]}」），造成严重出戏感。`,
        suggestion: '替换为古代表达（如：国库出入、常平仓均输之法、度支司权衡、经世济民之策）。'
      }
    };
  }

  return { passed: true, issue: null };
}

// 统一执行全题材叙事门禁
function runGenreNarrativeAudits(content, contract = {}, genre = '') {
  const issues = [];
  const g = String(genre || contract.genre || '');

  const shock = evaluateClimaxShockGate(content, contract, g);
  if (shock.issue) issues.push(shock.issue);

  const suspense = evaluateSuspenseSandboxGate(content, contract, g);
  if (suspense.issue) issues.push(suspense.issue);

  const urban = evaluateSocialDialogueGate(content, contract, g);
  if (urban.issue) issues.push(urban.issue);

  const romance = evaluateFemaleRomanceGate(content, contract, g);
  if (romance.issue) issues.push(romance.issue);

  const history = evaluateHistoricalEtiquetteGate(content, contract, g);
  if (history.issue) issues.push(history.issue);

  return {
    passed: !issues.some(i => i.severity === 'blocker'),
    issues
  };
}

/**
 * 闭环门禁自愈：根据质检不合格原因，生成精准局部微补丁提示词 (OPT-AUDIT-001)
 * @param {Object} auditResult runGenreNarrativeAudits 或单个 gate 的结果
 * @param {string} sceneText 场景上下文
 * @param {string} genre 小说题材
 * @returns {Object} 微补丁指令规格 { required, targetCategory, promptDirective, suggestedHunkRule }
 */
function generateMicroPatchPrompt(auditResult = {}, sceneText = '', genre = '') {
  const issues = auditResult.issues || (auditResult.issue ? [auditResult.issue] : []);

  if (issues.length === 0) {
    return { required: false, targetCategory: null, promptDirective: null, suggestedHunkRule: null };
  }

  const primaryIssue = issues[0];
  let promptDirective = '';
  let suggestedHunkRule = '';

  switch (primaryIssue.category) {
    case 'emotional_climax':
      promptDirective = '【物理受力与高潮通感微观自愈 (DEF-DESC-001)】：当前神灵威压/交锋缺乏具象物理受力描写。请在施压或碰撞瞬间增补 1~2 句骨骼受力微鸣、地面寸寸龟裂崩碎、或重力窒息感细节，拒绝过场式交代。';
      suggestedHunkRule = '在威压爆发句后插入微观形变特写';
      break;
    case 'suspense_leak':
      promptDirective = '【悬疑上帝视角消除】：开篇严禁主角知晓未解线索的终极真相，请将全知断言改为直观环境异常感知。';
      suggestedHunkRule = '将全知解释替换为感官疑点';
      break;
    case 'urban_villain_iq':
      promptDirective = '【反派降智口嗨纠偏】：反派必须具备现实社会规则压迫力，禁止出现“磕头叫爷爷”等无脑台词，改为契约/法律/人脉博弈。';
      suggestedHunkRule = '将无脑威胁改为制度性施压';
      break;
    case 'romance_greasy':
      promptDirective = '【女频去油腻纠偏】：去除粗暴身体推搡与邪魅狂狷台词，改为微观视线拉扯、呼吸节奏与心率微妙变化。';
      suggestedHunkRule = '将油腻动作改为细腻心绪与呼吸细节';
      break;
    case 'historical_anachronism':
      promptDirective = '【历史大词出戏纠偏】：严禁出现“降维打击/大数据/重构模型”等现代经济互联网用语，替换为考据的明清/古代钱粮制度词汇。';
      suggestedHunkRule = '将现代商业词汇替换为朝堂典章制度语汇';
      break;
    default:
      promptDirective = `【叙事门禁质检反馈】：${primaryIssue.description || primaryIssue.suggestion}`;
      suggestedHunkRule = '局部段落润色';
  }

  return {
    required: true,
    targetCategory: primaryIssue.category,
    severity: primaryIssue.severity || 'warning',
    promptDirective,
    suggestedHunkRule,
    issue: primaryIssue
  };
}

module.exports = {
  evaluateClimaxShockGate,
  evaluateSuspenseSandboxGate,
  evaluateSocialDialogueGate,
  evaluateFemaleRomanceGate,
  evaluateHistoricalEtiquetteGate,
  runGenreNarrativeAudits,
  generateMicroPatchPrompt
};

