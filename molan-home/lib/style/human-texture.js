'use strict';

/**
 * 人性化肌理与反套路审查 (Human Texture & Anti-Template Engine v2)
 *
 * 核心设计：
 * - 陈词滥调与 AI 套路识别 (Clichés & Stereotypes)：精确捕获机械化的肢体抽搐、通货膨胀式网文惯用语；
 * - 句法节奏单一性诊断 (Rhythm & Monotony)：检测段落首句雷同、句长无方差机械排列、并列三段式堆砌；
 * - 微补丁替换窗口映射 (Micro-Patch Window Mapping)：为检测到的套路生成带精确定位 (startOffset, endOffset) 的局部微修订建议；
 * - 肌理健康分 (Texture Score)：0~100 综合分，低于 70 分标记为套路化待修复。
 */

const AI_CLICHE_RULES = Object.freeze([
  {
    regex: /嘴角勾起一抹(?:玩味|冷酷|嗜血|嘲讽|森然|淡淡)?的?弧度/g,
    name: '嘴角弧度套路',
    suggestion: '删除脸谱化假笑，改用真实的眼神停顿或人物动作'
  },
  {
    regex: /(?:后槽牙|牙关)(?:咬得|紧咬得?)咯咯作响/g,
    name: '咬后槽牙套路',
    suggestion: '改用呼吸变重、手部青筋或沉默压抑来体现愤怒'
  },
  {
    regex: /(?:指腹|指肚)反复?摩挲/g,
    name: '指腹摩挲套路',
    suggestion: '替换为具体的道具互动或环境接触细节'
  },
  {
    regex: /深吸了一口(?:冷)?气/g,
    name: '深吸一口气套路',
    suggestion: '除非剧烈运动，尽量减少生理大惊小怪描写'
  },
  {
    regex: /瞳孔(?:骤然|剧烈)?(?:收缩|一缩)/g,
    name: '瞳孔骤缩套路',
    suggestion: '替换为视线聚焦、身体本能后撤或动作滞止'
  },
  {
    regex: /空气仿佛(?:在此刻)?(?:凝固|凝结|静止)了?/g,
    name: '空气凝固套路',
    suggestion: '转写为环境音的突兀放大（如水滴声、心跳声）'
  },
  {
    regex: /宛如断(?:了)?线的风筝/g,
    name: '断线风筝俗套比喻',
    suggestion: '改用符合物理重力的受力砸地描写'
  },
  {
    regex: /心中涌起(?:了)?一股(?:难以言喻的)?(?:暖流|莫名的情绪)/g,
    name: '心中涌起暖流套路',
    suggestion: '用具体的肢体微反应或回忆闪现替代抽象的情感口号'
  },
  {
    regex: /时间一分一秒(?:地)?流逝/g,
    name: '时间流逝套话',
    suggestion: '用具体物候变化（烛光渐短、茶水变凉、天色转暗）体现时间推移'
  },
  {
    regex: /骨节捏得泛白|指节泛白/g,
    name: '指节泛白套路',
    suggestion: '避免千篇一律的手部特写，描写握持物的受压变形'
  },
  {
    regex: /倒吸了一口(?:凉|冷)气/g,
    name: '倒吸凉气套路',
    suggestion: '删除旁观者无意义惊叹，聚焦当下核心冲突'
  },
  {
    regex: /(?:吸了口气|吐了口气|闭了闭眼)[^。！？\n]{0,18}(?:压回|按回|咽回|藏回|收了回去)/g,
    name: '冗余压回情绪套路(C14-03)',
    suggestion: '动作或眼神已经交代情绪，删去“又压回去/硬生生压回”等二次解释'
  },
  {
    regex: /(?:某种(?:类似|难以言喻|说不清)[^，。\n]{0,12}感|悄无声息地|平静得有些|硬生生(?=[压咽憋吞忍])|正顺着[^，。\n]{1,10}往[^，。\n]{1,8}涌)/g,
    name: '隐形翻译腔与可预测修饰链(R-41)',
    suggestion: '删掉“悄无声息地/硬生生/某种类似”等大模型修饰链，改为直接具体的物理动作或口语判断'
  },
  {
    regex: /(?:发出|压出)[^。！？\n]{0,6}(?:一记|一声)?[^。！？\n]{1,12}的(?:钝响|闷响|脆响|轻响|声响)/g,
    name: '声音修饰模板堆砌(R-01)',
    suggestion: '直接写出声响本身或动作结果（如“门卡了一声”“椅背往下一沉”），避免反复用“发出一记……的闷响”模板'
  }
]);

/** 诊断文本的人性化肌理与套路化程度。 */
function analyzeHumanTexture(text, options = {}) {
  const content = String(text || '');
  if (!content.trim()) {
    return {
      passed: false,
      score: 0,
      cliches: [],
      structuralIssues: [],
      replacementWindows: []
    };
  }

  const cliches = [];
  const replacementWindows = [];

  // 1. 扫描已知陈词滥调与 AI 套路
  for (const rule of AI_CLICHE_RULES) {
    rule.regex.lastIndex = 0;
    let match;
    while ((match = rule.regex.exec(content)) !== null) {
      const startOffset = match.index;
      const endOffset = startOffset + match[0].length;
      const quote = match[0];

      cliches.push({
        name: rule.name,
        quote,
        startOffset,
        endOffset,
        suggestion: rule.suggestion
      });

      replacementWindows.push({
        startOffset,
        endOffset,
        quote,
        issue: rule.name,
        suggestedPatch: rule.suggestion,
        severity: 'warning'
      });
    }
  }

  // 2. 句式单调与机械节奏检查
  const structuralIssues = [];
  const paragraphs = content.split(/\r?\n+/).map(p => p.trim()).filter(Boolean);

  // 2.1 连续段落首词回声 (3段以上以相同代词/连词/副词开头)
  function extractParagraphLead(paragraph) {
    if (!paragraph) return '';
    const pronouns = ['他', '她', '它', '我', '你', '这', '那'];
    if (pronouns.includes(paragraph[0])) return paragraph[0];
    const twoCharWords = ['此时', '随后', '旋即', '然而', '紧接', '只见', '突然', '忽地'];
    const prefix2 = paragraph.slice(0, 2);
    if (twoCharWords.includes(prefix2)) return prefix2;
    return prefix2;
  }

  for (let i = 0; i <= paragraphs.length - 3; i++) {
    const l1 = extractParagraphLead(paragraphs[i]);
    const l2 = extractParagraphLead(paragraphs[i + 1]);
    const l3 = extractParagraphLead(paragraphs[i + 2]);
    if (l1 && l1 === l2 && l2 === l3) {
      structuralIssues.push({
        type: 'paragraph_lead_repetition',
        pattern: l1,
        paragraphIndex: i,
        message: `连续 3 段以「${l1}」开头，存在句式机械回声`,
        suggestion: '调整段落起始视角，倒装或加入环境动词引入'
      });
    }
  }

  // 2.2 三段式并列短语堆砌 (例如: 提刀、挥砍、收招连珠式出现)
  const tripartitePattern = /([\u4e00-\u9fa5]{2,4})[，、]([\u4e00-\u9fa5]{2,4})[，、]([\u4e00-\u9fa5]{2,4})[。！]/g;
  let triMatch;
  let triCount = 0;
  while ((triMatch = tripartitePattern.exec(content)) !== null) {
    triCount += 1;
    if (triCount >= 4) {
      structuralIssues.push({
        type: 'excessive_tripartite_parallelism',
        quote: triMatch[0],
        startOffset: triMatch.index,
        endOffset: triMatch.index + triMatch[0].length,
        message: `文本中出现过多（>=4处）三段式并列短语堆砌（如「${triMatch[0]}」）`,
        suggestion: '打破刻板的对称短语节奏，使句式长短错落'
      });
      break;
    }
  }

  // 2.3 单句独立叙述段过多（《纠错库》C07-02~06：破坏段长波峰波谷，拉低朱雀突发性）
  const singleNarrativeParas = paragraphs.filter(p => {
    if (!p || p.startsWith('“') || p.startsWith('"') || p.startsWith('「') || p.startsWith('#')) return false;
    const sents = p.split(/[。！？!?]/).filter(s => s.trim().length > 0);
    return sents.length <= 1;
  });
  if (singleNarrativeParas.length >= 4) {
    structuralIssues.push({
      type: 'single_sentence_paragraph_overflow',
      count: singleNarrativeParas.length,
      message: `单句独立叙述段偏多（${singleNarrativeParas.length}处），按《纠错库》C07-02 建议只留<=3处关键停顿，其余并入上下文长段以拉开段长起伏`,
      suggestion: '将不构成重大转折的孤立动作/环境短句并入邻近叙述段，避免段段一两句整齐切镜'
    });
  }

  // 3. 计算肌理健康分 (基准 100 分)
  // 每处套路扣 8 分，结构问题扣 10 分
  const totalDeductions = (cliches.length * 8) + (structuralIssues.length * 10);
  const score = Math.max(0, 100 - totalDeductions);
  const passingThreshold = Number(options.threshold) || 75;
  const passed = score >= passingThreshold;

  return {
    passed,
    score,
    passingThreshold,
    clicheCount: cliches.length,
    cliches,
    structuralIssues,
    replacementWindows
  };
}

module.exports = {
  AI_CLICHE_RULES,
  analyzeHumanTexture
};
