'use strict';

function createHumanizePolicyService({ buildHumanizeLexiconBlock, UNIVERSAL_CORRECTION_MARKER, UNIVERSAL_CORRECTION_POLICY_PROMPT }) {
  /**
   * 判断是否启用两遍生成（生成遍 + 去 AI 味改写遍）。
   * 已全局默认停用 Humanizer 两遍洗稿机制，切换为单遍极质高张力起草（直接前置注入通用纠错库与管线基准）。
   * 仅在显式传入 input.twoPassHumanize === true 或环境变量 MOLAN_TWO_PASS_HUMANIZE === '1' 时放行（向后兼容）。
   */
  function isTwoPassHumanizeEnabled(stage, input) {
    const normalizedStage = String(stage || '').toLowerCase();
    if (normalizedStage !== 'writing') return false;
    if (input && input.editorOnly === true) return false;
    if (process.env.MOLAN_TWO_PASS_HUMANIZE === '0') return false;
    if (!input || input.jsonMode === true) return false;
    if (input.twoPassHumanize === false) return false;
    // 默认停用两遍 Humanizer；仅显式声明时开启
    if (process.env.MOLAN_TWO_PASS_HUMANIZE === '1' || (input && input.twoPassHumanize === true)) return true;
    return false;
  }

  /**
   * 向第一条 system 消息追加提示块（无 system 时新建一条）。
   * 用于把正面节奏目标注入生成遍，而不触碰用户消息。
   */
  function appendSystemBlock(messages, block) {
    if (!block || !Array.isArray(messages)) return messages;
    const output = messages.map(message => ({ ...message }));
    const systemIndex = output.findIndex(message => message && message.role === 'system' && typeof message.content === 'string');
    if (systemIndex < 0) {
      output.unshift({ role: 'system', content: block.replace(/^\n+/, '') });
      return output;
    }
    output[systemIndex].content = String(output[systemIndex].content || '') + block;
    return output;
  }

  /**
   * 构造第二遍（humanize 遍）的完整消息集：
   * 纠错库总则 + 针对本初稿的实测诊断（AI味指标 / 纠错库逐句定位）+ 纠错库原句→修正句示范
   * + 数据驱动 AI 词表 + 同题材零AI味原著活人笔触范本 + 改写边界 + 初稿全文。
   */
  function buildHumanizePassMessages(draft, meta = null) {
    const lexiconBlock = buildHumanizeLexiconBlock();
    const metaInfo = meta && typeof meta === 'object' ? meta : {};
    const genreLabel = String(metaInfo.genre || '').trim();
    const targetChars = Number(metaInfo.targetChars) || 0;
    const draftText = String(draft || '');

    let targetedCorrectionBlock = '';
    try {
      const correctionPolicy = require('../correction-policy');
      if (typeof correctionPolicy.buildTargetedCorrectionGuidance === 'function') {
        const guided = correctionPolicy.buildTargetedCorrectionGuidance(draftText, {
          genre: genreLabel,
          scan: metaInfo.correctionScan || null
        });
        targetedCorrectionBlock = guided && guided.block ? guided.block : '';
      }
    } catch (_) {
      targetedCorrectionBlock = '';
    }

    const aiFlavorReport = metaInfo.aiFlavorReport || null;
    const textureReport = metaInfo.textureReport || null;
    const diagnosticLines = [];
    if (aiFlavorReport && typeof aiFlavorReport === 'object') {
      const score = Number(aiFlavorReport.score) || 0;
      const metrics = aiFlavorReport.metrics || {};
      const blockHits = Array.isArray(aiFlavorReport.details?.blockHits)
        ? aiFlavorReport.details.blockHits.map(item => (typeof item === 'string' ? item : item?.term || item?.phrase || '')).filter(Boolean).slice(0, 8)
        : [];
      const rawStructural = aiFlavorReport.details?.structuralRisks;
      let structuralRisks = [];
      if (Array.isArray(rawStructural)) {
        structuralRisks = rawStructural.map(item => (typeof item === 'string' ? item : item?.label || item?.id || '')).filter(Boolean).slice(0, 5);
      } else if (rawStructural && typeof rawStructural === 'object') {
        const riskLabels = {
          pseudoFragCount: '拟声/断语孤立碎段',
          turnTakingCount: '回合制点名排队打斗',
          binarySymmetryCount: '机械二元对称句式',
          isolatedExplanatoryCount: '视听分镜式孤立说明行',
          somaticOverreactionCount: '植物神经痉挛生理套话'
        };
        structuralRisks = Object.entries(riskLabels)
          .filter(([k]) => Number(rawStructural[k]) > 0)
          .map(([k, label]) => `${label}(${rawStructural[k]}处)`);
      }
      if (score > 0 || blockHits.length || structuralRisks.length) {
        diagnosticLines.push(`- AI 腔综合风险分：${score}（目标压低至 15 以下）`);
      }
      if (blockHits.length) diagnosticLines.push(`- 初稿实测高频 AI 套词：${blockHits.join('、')}（逐处替换为具体感官、口语或物理动作）`);
      if (structuralRisks.length) diagnosticLines.push(`- 初稿实测 AI 句式病灶：${structuralRisks.join('；')}`);
      if (metrics.sentenceStdRatio != null && Number.isFinite(Number(metrics.sentenceStdRatio)) && Number(metrics.sentenceStdRatio) < 0.75) {
        diagnosticLines.push(`- 句长起伏偏平（方差比基线仅 ${Number(metrics.sentenceStdRatio).toFixed(2)}）：请拉开长短句呼吸，重要转折或抢白处用短句，日常铺叙可留流畅复句`);
      }
      if (metrics.paragraphUniformity > 0 && Number(metrics.paragraphUniformity) < 0.48) {
        diagnosticLines.push(`- 段落长度过于均匀（变异系数 ${Number(metrics.paragraphUniformity).toFixed(2)}）：避免每段字数像模具压出来一样齐整，按动作与情绪自然分段，揉合 140~240 字饱满长段与短促口语断句`);
      }
      const zq = metrics.zhuqueSignals && typeof metrics.zhuqueSignals === 'object' ? metrics.zhuqueSignals : null;
      const llmGlueTerms = Array.isArray(aiFlavorReport.details?.llmGlueHits)
        ? aiFlavorReport.details.llmGlueHits.slice(0, 6).map(h => h && h.term ? `${h.term}(${h.count}次)` : '').filter(Boolean)
        : [];
      if (llmGlueTerms.length) {
        diagnosticLines.push(`- 朱雀高危模型高频连接/修饰词（必须打散重写）：${llmGlueTerms.join('、')}`);
      }
      if (zq && zq.sentenceBurstiness) {
        const sb = zq.sentenceBurstiness;
        if (Number(sb.flatClusterCount) > 0 || (Number(sb.cv) > 0 && Number(sb.cv) < 0.52)) {
          diagnosticLines.push(`- 句长突发性（Burstiness）偏平（变异系数 ${Number(sb.cv || 0).toFixed(2)}，连续均长句簇 ${sb.flatClusterCount || 0} 组）：必须打破“每句15~28字齐步走”，把连贯动作与思绪合并成流畅长复句，并在冲突或抢白处突然切出 3~8 字极短句`);
        }
      }
      if (zq && zq.overCompressedVocabRisk) {
        diagnosticLines.push(`- 词汇过度浓缩不重复（bigramTTR 达 ${zq.bigramTtr}，1,279 本真人网文普遍落在 0.78~0.83）：AI 味重灾区！请放松用词，自然高频复现“自己、什么、没有、这个、那个、知道、已经、怎么、现在、时候、还是、不过、一下”等日常汉语词，并直接重复核心物件原名，不要刻意轮换同义词`);
      }
      if (zq && zq.overPolishedSensoryRisk) {
        diagnosticLines.push(`- 抽象雕琢定语偏多（“……的+名词”达 ${zq.deModifierPerKilo}/千字）：请删掉硬贴的假文青形容词与四字套话，保留日常自然“的”字表达`);
      }
      if (zq && (zq.punctuationOverloadRisk || Number(zq.dashCount) >= 2)) {
        diagnosticLines.push(`- 标点异常（感叹号 ${zq.exclamationCount || 0} 个、破折号 ${zq.dashCount || 0} 处）：1,279 本真人语料破折号中位数为 0，请清掉破折号并将感叹号控制在自然合理范围（1~4 个）。`);
      }
    }
    if (textureReport && typeof textureReport === 'object') {
      const rawCliches = Array.isArray(textureReport.cliches)
        ? textureReport.cliches
        : (Array.isArray(textureReport.clicheHits) ? textureReport.clicheHits : []);
      const cliches = rawCliches.slice(0, 5)
        .map(c => {
          const q = c && (c.quote || c.phrase || '');
          const n = c && (c.name || c.label || '');
          return q && n ? `${n}“${q}”` : (q || n);
        })
        .filter(Boolean);
      const issues = Array.isArray(textureReport.structuralIssues) ? textureReport.structuralIssues.slice(0, 4).map(i => i.message || i.type).filter(Boolean) : [];
      if (cliches.length) diagnosticLines.push(`- 人味质感命中套话：${cliches.join('、')}`);
      if (issues.length) diagnosticLines.push(`- 文本结构单调提示：${issues.join('；')}`);
    }

    let livingExemplarBlock = '';
    if (metaInfo.includeLivingExemplars !== false) {
      try {
        const { buildLivingProseExemplarBlock } = require('../lib/character-material');
        if (typeof buildLivingProseExemplarBlock === 'function') {
          const ex = buildLivingProseExemplarBlock({
            genre: genreLabel,
            query: draftText.slice(0, 500)
          }, { limit: 2, maxExcerptChars: 380, maxDeModifierPerKilo: 32 });
          livingExemplarBlock = ex && ex.block ? ex.block : '';
        }
      } catch (_) {
        livingExemplarBlock = '';
      }
    }

    const effectiveLengthTarget = targetChars > 0 ? targetChars : Math.max(300, draftText.replace(/\s+/g, '').length);
    const lengthLow = Math.max(200, Math.round(effectiveLengthTarget * 0.88));
    const lengthHigh = Math.max(lengthLow + 150, Math.round(effectiveLengthTarget * 1.15));

    const systemParts = [
      '你是帮商业连载网文作者做“跨模型句法重构 + 真人大白话定稿（专破朱雀 AI 概率峰值）”的资深老编辑。你的工作不是做同义词微调，而是在 100% 忠实保留原稿事实与人物口吻的前提下，换用真人作者敲键盘的语序与节奏重新把这场戏讲一遍。',
      UNIVERSAL_CORRECTION_MARKER,
      UNIVERSAL_CORRECTION_POLICY_PROMPT
    ];
    if (lexiconBlock) systemParts.push(lexiconBlock);
    if (diagnosticLines.length) {
      systemParts.push(`【本篇初稿实测 AI 味诊断（优先逐项修复）】\n${diagnosticLines.join('\n')}`);
    }
    if (targetedCorrectionBlock) {
      systemParts.push(targetedCorrectionBlock);
    }
    if (livingExemplarBlock) {
      systemParts.push(livingExemplarBlock);
    }
    const zqMeta = aiFlavorReport && aiFlavorReport.metrics && aiFlavorReport.metrics.zhuqueSignals
      ? aiFlavorReport.metrics.zhuqueSignals
      : null;
    const quickAlert = zqMeta
      ? `【初稿对照 1,279 本真人语料警报】段均=${zqMeta.paraMean || 0}字（真人 23~35 字）、bigramTTR=${zqMeta.bigramTtr || 0}（真人 0.78~0.83）、均长句簇=${(zqMeta.sentenceBurstiness && zqMeta.sentenceBurstiness.flatClusterCount) || 0}组、破折号=${zqMeta.dashCount || 0}处。`
      : '';
    const isLightComedyGenre = /轻小说|搞笑|沙雕|吐槽|甜宠|轻松|脑洞|日常|系统/i.test(genreLabel);
    const toneRule = isLightComedyGenre
      ? '7. 高困惑度口语吐槽与反差意象（轻喜/脑洞/甜宠题材专属）：保留人物鲜活情绪与带刺吐槽，允许把场面或招式反差类比成日常俗物、斤两、价钱或市井俗话，绝不制造错别字或乱码。'
      : '7. 实操生活感与顺口推进（正剧/仙侠/都市/悬疑主流）：用具体生活账目、顺手动作与真实权衡推进，不用生理痉挛套话（咬牙/发凉/手抖）或空洞心理议论凑数。';

    systemParts.push([
      '【改写边界（基于 1,279 本真人连载小说实测共性，必须遵守）】',
      '1. 重构句法语序，严守原稿事实与因果：100% 保留原稿人物、物品、数字、前情与剧情顺序；像十年连载老作者记下剧情后用最松弛的手机网文手感重讲一遍，不要顺着原句逐字微调。',
      '2. 手机网文轻快自然分段（1,279 本真人段均 27.6 字、76% 段落 <=40 字）：大多数段落写完 1 句话（20~55 字）就自然换行，绝不强行揉成 100 字以上密密麻麻的散文方块，同时不强制每段句数；可以连续铺 6~12 段动作、观察与心理细节再切进对话，不必每两三段硬切对话。',
      '3. 少打电报碎句号，多用逗号顺完一个念头（拉高困惑度与句长剧烈落差）：不要写“他走过去。他拉开抽屉。抽屉开了。”这类密句号电报体！正常网文习惯一句话里用 2~4 个逗号顺完连贯动作与思绪（全章保留 10%~20% 的 45~75 字多逗号顺口长句），再与 5~15 字短句自然交替，消灭连续 4 句均长平句簇。',
      '4. 放开高频日常“大水词”自然复现（把 bigramTTR 压回真人 0.78~0.83 区间）：真人码字松弛不炫技，会自然、反复用到“自己、什么、没有、这个、那个、知道、已经、怎么、现在、时候、还是、不过、一下、就是、不是”以及人称代词（他/她/我/你）；同一个核心物品/人名直接重复原名，严禁刻意轮换花哨同义词避重。',
      '5. 正常用“的”字与自然标点，清零破折号：每千字自然保留 20~32 个日常“的”字（只删假文青抽象修辞与 AI 套话，不删成电报体）；全章尽量不用破折号（——），可自然带 1~4 个感叹号与 1~2 处省略号（……）；对话混用裸对话、前置动作与后置尾标（如“那下次？”他问了一句。）。',
      '6. 砍掉 AI 套路四件套：不写天气水沟感官排比开场，不写反派“衣着+头发+刀疤+破鞋”全套外貌体检表，不写“屋里安静下来只剩……声”转场，结尾严禁“收起笑抬头望向黑楼梯/握紧器物特写”电影镜头，落在关灯、收拾或一句实在打算上。',
      toneRule,
      `8. 严守原稿体量与时空自洽${genreLabel ? `（当前题材：${genreLabel}）` : ''}：篇幅控制在 ${lengthLow}~${lengthHigh} 字之间，禁止偷工减料或擅自扩写翻倍，道具与伤势前后连贯，不平白新增违和工具或章节标题。`,
      '9. 直接输出完整修订后的正文，不要任何解释、前言或 Markdown 围栏。'
    ].join('\n'));
    return [
      { role: 'system', content: systemParts.join('\n\n') },
      { role: 'user', content: `${quickAlert ? quickAlert + '\n' : ''}以下是初稿（约 ${effectiveLengthTarget} 字）。请按 1,279 本真人手机网文连载手感重写：每段多为 1 句（平均 25~38 字，不写百字大方块）、少打碎句号多用 2~4 个逗号把动作思绪一口气顺下来、自然高频用“什么/自己/没有/这个/知道/已经/怎么/时候/还是/不过”放松词汇密度、核心物件不轮换同义词、正常用“的”字、清零破折号并砍掉 AI 套路四件套；严守原有事实并将字数控制在 ${lengthLow}~${lengthHigh} 字，直接输出完整修订正文：\n\n` + draftText }
    ];
  }

  /**
   * 合并两遍生成的 token 用量（逐字段相加）。
   * 任一值为 null 时返回另一值；两者都为 null 返回 null。
   */
  function mergeUsageSum(first, second) {
    if (!first) return second || null;
    if (!second) return first;
    const merged = { ...second };
    ['promptTokens', 'completionTokens', 'reasoningTokens', 'cachedTokens', 'cacheWriteTokens', 'totalTokens'].forEach(key => {
      const a = first[key] === null || first[key] === undefined ? NaN : Number(first[key]);
      const b = second[key] === null || second[key] === undefined ? NaN : Number(second[key]);
      if (Number.isFinite(a) && Number.isFinite(b)) merged[key] = a + b;
      else if (Number.isFinite(b)) merged[key] = b;
      else if (Number.isFinite(a)) merged[key] = a;
      else merged[key] = null;
    });
    merged.usageSource = second.usageSource || first.usageSource || null;
    return merged;
  }

  /**
   * 把 AI 味检测结论压缩为可下发的摘要（避免 details 里长列表膨胀 molan_usage 事件）。
   */
  function summarizeAiFlavorVerdict(verdict) {
    if (!verdict) return null;
    return {
      score: verdict.score,
      passed: !!verdict.passed,
      metrics: verdict.metrics || null,
      blockHitTerms: verdict.details && Array.isArray(verdict.details.blockHits) ? verdict.details.blockHits.slice(0, 10) : []
    };
  }
  return { isTwoPassHumanizeEnabled, appendSystemBlock, buildHumanizePassMessages, mergeUsageSum, summarizeAiFlavorVerdict };
}

module.exports = { createHumanizePolicyService };
