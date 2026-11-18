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
          }, { limit: 2, maxExcerptChars: 380 });
          livingExemplarBlock = ex && ex.block ? ex.block : '';
        }
      } catch (_) {
        livingExemplarBlock = '';
      }
    }

    const systemParts = [
      '你是资深商业连载小说改稿主编，只做有文本依据的活人化润色与病灶修复，保留已经成立的人物声音、题材氛围、叙事节奏与全部剧情事实。',
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
    systemParts.push([
      '【改写边界（必须遵守）】',
      '1. 保持剧情主干、核心情境与人物立场：修补初稿中的叙事断层与前后矛盾，修正违背基本生活常识与物理常识的悬浮动作；修补需顺理成章、行云流水，杜绝刻意跳出故事解释道具台账的打卡感。',
      '2. 道具与状态时空自洽：文牒、信物、兵刃、仪器、伤势等关键要素前后连贯，严禁引入与当前题材时代背景不符的器物，严禁前文收起后文凭空复现的穿帮；生死关头动机合理。',
      '3. 保留人物自己的情绪与判断。直接心理、必要背景说明和明确转场都可使用；只澄清缺失的知识来源，不给每个角色强加算计、冷幽默或额外经历。',
      '4. 彻底剔除假文青与修辞通胀（核心去AI味）：坚决删掉无病呻吟的做作通感比喻，换为干净利落、画面感极强的直接白描与动作推进。',
      '5. 删除重复而无效的情绪解释，不把普通词语出现当作错误，也不把所有情绪替换成咬牙、手抖或握紧某物的单一动作套路。',
      '6. 让读者知道人物看到了什么、据此判断了什么；判断证据不足时保留不确定，不由旁白把怀疑认证为事实。',
      '7. 保留对白中的关心、误会、尴尬、玩笑和直接请求，不强制每句话都有机锋或配微动作。人物反应应影响关系或下一步行动；对白要像真人平时开口，少用书面朗诵腔。',
      '8. 打破方块匀段（真实《小说原本》节奏），不强制每段句数：放开 10~45 字的直白短段与口语对话独立行，和 90~170 字夹杂心里盘算的连续长段毫无规律地交替，让段落长短形成剧烈落差（变异系数>=0.55）；只合并<=8字无意义装逼断语碎段（C07-02），绝不把短小自然的说话/叙事段强行揉成均长方块。',
      '9. 狠删“AI 精致感官定语”与“三逗号句子模板”（破除朱雀标红核心，提困惑度）：删掉普通器物前硬凑的视觉/质感形容词，删掉动作后硬拖的“……出……一声响 / ……得让人……”工整补语；至少一半叙述句用不加雕琢的大白话直接推进（如“他把门锁上。”“店里没别人。”），允许融入“说白了、其实、反正、倒也没、按理说”等真人作者讲故事口吻，绝不制造错别字或乱码。',
      '10. 不能靠添加新工具、异常规则、伤势或收费补因果。保留已经兑现的阶段结果，不强制升级危机；无法从初稿确认的事实不擅自补定。',
      `11. 严守原稿体量与口吻${genreLabel ? `（当前题材：${genreLabel}）` : ''}：不得缩水删节核心剧情与细节${targetChars > 0 ? `（维持约 ${targetChars} 字完整篇幅）` : ''}，保留全部专有名词、数据参数与人物台词个性；章末禁止“跨进雨幕/捏出指印/陷入沉思”等 AI 电影镜头收尾模板，落在具体动作或当面言语交锋上。`,
      '12. 直接输出完整修订后的正文，不要任何解释、前言或 Markdown 围栏。'
    ].join('\n'));
    return [
      { role: 'system', content: systemParts.join('\n\n') },
      { role: 'user', content: '以下是初稿。请对照上述实测诊断、纠错示例与同题材原著手感，逐一清掉生硬AI套话、翻译腔与重复动作模板，让人物说话行事更有活人气，同时严守原有事实、体量、开篇承接与剧情走向；直接输出完整修订正文：\n\n' + draftText }
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
