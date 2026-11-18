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
      ? `【初稿实时警报】单句独立旁白=${zqMeta.singleNarrativeCount || 0}处（目标<=3处）、连续均长句簇=${(zqMeta.sentenceBurstiness && zqMeta.sentenceBurstiness.flatClusterCount) || 0}组（目标0组）、“的+名词”=${zqMeta.deModifierPerKilo || 0}/千字（目标<=14）、感叹号=${zqMeta.exclamationCount || 0}/破折号=${zqMeta.dashCount || 0}。`
      : '';

    systemParts.push([
      '【改写边界（必须遵守）】',
      '1. 重构句法语序，但严守事实与因果：100% 保留原稿人物、物品、数字、秘密、前情承接与剧情顺序；修补悬浮动作或常识漏洞，但不能顺着原句逐字微调，要像记清剧情后用真人自己的话重讲一遍，换掉大部分原句结构。',
      '2. 感叹号与破折号严格限流（朱雀核心标点红灯）：整章感叹号（！）最多 2 个，破折号（——）最多 1 处（能不用就不用）；95% 以上正常使用逗号、句号、问号。',
      '3. 合并单句旁白碎行，打散均长句簇（拉高困惑度与 Burstiness）：严禁“一句话一段”刷屏或把一个动作和紧接解释敲成两段（例如不能写成“他站在台后。\\n\\n抽屉里有把剪刀。”或“可后屋睡着姑妈。\\n\\n姑妈眼睛瞎。”，必须合并在同段里）。单句独立叙述行全章最多留 3 处关键停顿，同时不强制每段句数；把连续 15~28 字的匀称句用逗号顺进 45~85 字带市井算计的宽松长句，再紧接一句 3~9 字极短口语切开，让句长和段长形成剧烈落差，绝不连续 4 句落在同一长度带！',
      '4. 对白松弛去标签（口语活人感）：砍掉一半以上“人名+动作+：”的整齐前置标签，多用裸对话或把小动作插在话尾、话中间；口语保留真人的“嘛、呢、呗、啥、没”等自然省略与带刺反问（放宽书面“没→没有”硬规，但绝不制造错别字、乱码或无意义口癖）。',
      '5. 狠删“……的+名词”AI精致定语（每千字 <= 14 处）：扒掉日常物品前硬贴的视觉/触觉形容词（如“褪色的/生锈的/发稠的/粗糙发黄的/湿了边的”），删掉“发出一声闷响/透出一阵阴凉/随后”等工整补语与书面转折；至少一半叙述句用直白大白话交代（“门没锁紧”“茶凉了一半”），彻底剔除假文青通感比喻与 AI 套路。',
      '6. 道具与状态时空自洽：兵刃、文牒、仪器、伤势等关键要素前后连贯，不引入违和器物，不靠平白塞入新工具或异常规则补因果。',
      '7. 保留人物自己的情绪、尴尬、试探与小市民算计，不用生理痉挛（咬牙/发凉/手抖）或单一旁白判决替代具体行动与立场；判断证据不足时保留不确定。',
      `8. 严守原稿体量与自然结尾${genreLabel ? `（当前题材：${genreLabel}）` : ''}：篇幅严格控制在 ${lengthLow}~${lengthHigh} 字之间，禁止偷工减料或擅自扩写翻倍；结尾严禁“看着镜子/手握器物特写/迈入夜色/陷入沉思”等 AI 电影镜头模板，落在具体日常动作或一句干脆口语收束。`,
      '9. 直接输出完整修订后的正文，不要任何解释、前言或 Markdown 围栏。'
    ].join('\n'));
    return [
      { role: 'system', content: systemParts.join('\n\n') },
      { role: 'user', content: `${quickAlert ? quickAlert + '\n' : ''}以下是初稿（约 ${effectiveLengthTarget} 字）。请按上面 9 条规则重写：千万合并单句独立旁白（全章最多留<=3处，其余动作和心理顺进同段）、用逗号把匀称中短句揉成 45~85 字宽松长句并穿插 3~9 字极短口语消灭均长句簇、扒掉多余“的+名词”定语并控死感叹号<=2/破折号<=1；严守原有事实并将字数控制在 ${lengthLow}~${lengthHigh} 字，直接输出完整修订正文：\n\n` + draftText }
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
