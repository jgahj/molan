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
      if (zq && Number(zq.singleNarrativeCount) >= 4) {
        diagnosticLines.push(`- 孤立单句叙述段过多（${zq.singleNarrativeCount} 处）：按《纠错库》C07-02 保留 <=3 处关键转折停顿，其余并入上下文长段`);
      }
      if (zq && (zq.overPolishedSensoryRisk || Number(zq.deModifierPerKilo) >= 22)) {
        diagnosticLines.push(`- 定语与感官雕琢过载（“……的+名词”达 ${zq.deModifierPerKilo}/千字，平实短直句仅 ${Math.round((Number(zq.plainShortRatio) || 0) * 100)}%）：这是朱雀判定 AI 的第一大诱因！请大刀阔斧扒掉日常物品前硬贴的视觉/触觉形容词（如“褪色的”“生锈的”“廉价的”“发稠的”），至少一半叙述句改用不带修饰的大白话直说`);
      }
      if (zq && (zq.punctuationOverloadRisk || Number(zq.exclamationCount) >= 3 || Number(zq.dashCount) >= 2)) {
        diagnosticLines.push(`- 情绪标点过载（感叹号 ${zq.exclamationCount || 0} 个、破折号 ${zq.dashCount || 0} 处）：高密感叹号与破折号极易被朱雀标红！全章感叹号必须压到 <=2 个，破折号压到 <=1 处（优先改用逗号、句号、问号）。`);
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
          }, { limit: 2, maxExcerptChars: 380, maxDeModifierPerKilo: 15 });
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
      ? `【初稿实时警报】连续均长句簇=${(zqMeta.sentenceBurstiness && zqMeta.sentenceBurstiness.flatClusterCount) || 0}组（目标0组）、“的+名词”=${zqMeta.deModifierPerKilo || 0}/千字（目标<=12）、感叹号=${zqMeta.exclamationCount || 0}/破折号=${zqMeta.dashCount || 0}。`
      : '';
    const isLightComedyGenre = /轻小说|搞笑|沙雕|吐槽|甜宠|轻松|脑洞|日常|系统/i.test(genreLabel);
    const toneRule = isLightComedyGenre
      ? '7. 高困惑度口语吐槽与反差意象（轻喜/脑洞/甜宠题材专属）：保留人物鲜活情绪与带刺吐槽，允许把法门/场面反差类比成日常俗物、斤两、价钱或市井俗话来打破 AI 书面平顺感，同时不制造错别字或乱码。'
      : '7. 纯实体白描动作链与账目实操（正剧/仙侠/都市/悬疑主流）：用“试一次不行换个法子或工具再试”的具体步骤与实在花费/斤两替代抽象心理议论，动作后面只接物理结果，不用生理痉挛套话替代立场。';

    systemParts.push([
      '【改写边界（必须遵守）】',
      '1. 重构句法语序，但严守事实与因果：100% 保留原稿人物、物品、数字、秘密、前情承接与剧情顺序；像记清剧情后用十年老作者自己的大白话重讲一遍，不要顺着原句逐字微调。',
      '2. 禁止同义词刻意避重（破除 AI 高敏特征）：同一个核心物品、人名或钱数在全章保持同一个朴素叫法（例如反复写“铁盒子/陈阿明/小瓶”），严禁为了“文采”轮换写成“这东西/旧铁箱/那物件/青年”。',
      '3. 砍掉 AI 开场三件套、静音转场与黑镜头结尾：删掉“雨下得很大/水沟满溢/烂菜叶铁锈”这类环境感官引子，第一句直接从人物正在干的具体活儿或推门动作写起；删掉反派“衣服+湿发+刀疤+破鞋”全套外貌清单；删掉“店里只剩这阵闷响”；结尾禁止“把笑收起抬头望向暗楼梯”，只写关灯闩门与一句实在的下一步打算（如明早去找谁）。',
      '4. 拆出“实操试错步骤 + 短客观结果”，打散均长句簇：翻包数零钱、撬箱子、查门窗等动作一步步按顺序写实，动作后允许跟一句 4~12 字极短客观结果单行（如“抽屉锁着。”“盖子没动。”），同时不强制每段句数；把连续 15~28 字的匀称句用逗号顺进 45~85 字宽松长句或口语短行交错，让句长和段长形成剧烈落差，拉高困惑度与 Burstiness（绝不连续 4 句落在同一长度带）。',
      '5. 感叹号与破折号严格限流，对白去标签：整章感叹号（！）最多 1~2 个，破折号（——）最多 0~1 处；砍掉一半以上“人名+动作+：”整齐前置标签，多用裸对话或把动作插在话尾，口语保留真实省略（嘛、呢、呗、啥、没）。',
      '6. 狠删“……的+名词”AI精致定语（每千字 <= 12 处）：扒掉日常物品前硬贴的视觉/触觉形容词（如“褪色的/粗糙发黄的/湿了边的”），多用最普通的日常动词（拿、摸、放、看、数、推、拉），彻底剔除假文青通感比喻与 AI 胶水词。',
      toneRule,
      `8. 严守原稿体量与时空自洽${genreLabel ? `（当前题材：${genreLabel}）` : ''}：篇幅控制在 ${lengthLow}~${lengthHigh} 字之间，禁止偷工减料或擅自扩写翻倍，道具与伤势前后连贯，不平白新增违和工具或章节标题。`,
      '9. 直接输出完整修订后的正文，不要任何解释、前言或 Markdown 围栏。'
    ].join('\n'));
    return [
      { role: 'system', content: systemParts.join('\n\n') },
      { role: 'user', content: `${quickAlert ? quickAlert + '\n' : ''}以下是初稿（约 ${effectiveLengthTarget} 字）。请对照上面 9 条规则重写：砍掉天气开场/外貌拼盘/静音转场/凝视结尾，同一个物件绝不轮换同义词避重，拆出笨拙实在的动作试错步骤与客观短结果，段落兼顾 120~200 字长细段与 4~25 字短口语/短结果（绝不全篇写成40~60字均匀方块），压低“的+名词”到 <=12/千字并控死感叹号<=2/破折号<=1；严守原有事实并将字数控制在 ${lengthLow}~${lengthHigh} 字，直接输出完整修订正文：\n\n` + draftText }
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
