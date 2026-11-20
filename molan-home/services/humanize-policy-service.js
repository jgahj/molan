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

    const systemParts = [
      '你是小说编辑，只做有文本依据的必要修订，保留已经成立的人物声音、叙事节奏和剧情事实。',
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
      '2. 道具与状态时空自洽：文牒、信物、兵刃、伤势等关键要素前后连贯，严禁前文收起后文凭空在他人手中复现的穿帮；生死关头动机合理，严禁死斗中突兀停战演讲。',
      '3. 保留人物自己的情绪与判断。直接心理、必要背景说明和明确转场都可使用；只澄清缺失的知识来源，不给每个角色强加算计、冷幽默或额外经历。',
      '4. 彻底剔除假文青与修辞通胀（核心去AI味）：坚决删掉无病呻吟的做作通感比喻（严禁动辄出现“像发胀棉絮/像劣茶/像熬焦旧钱/像死鱼眼珠”等矫饰），换为干净利落、画面感极强的直接白描与动作推进。',
      '5. 删除重复而无效的情绪解释，不把普通词语出现当作错误，也不把所有情绪替换成咬牙、手抖等身体动作。',
      '6. 让读者知道人物看到了什么、据此判断了什么；判断证据不足时保留不确定，不由旁白把怀疑认证为事实。',
      '7. 保留对白中的关心、误会、尴尬、玩笑和直接请求，不强制每句话都有机锋或配微动作。人物反应应影响关系或下一步行动。',
      '8. 短段和单句成段本身不是缺陷。按完整的动作、感受或思考分段，不强制每段句数，不为降低检测分机械合并或扩写。',
      '9. 叙事节奏清爽凌厉，打破匀速平推（形成高困惑度与长短句剧烈落差）：动作交锋主次分明，次要过招顺笔带过，关键破局浓墨重彩，长短句错落有致，让阅读充满爽快感与张力。',
      '10. 不能靠添加新工具、异常规则、伤势或收费补因果。保留已经兑现的阶段结果，不强制升级危机；无法从初稿确认的事实不擅自补定。',
      '11. 直接输出改写后的正文，不要任何解释、前言或 Markdown 围栏。'
    ].join('\n'));
    return [
      { role: 'system', content: systemParts.join('\n\n') },
      { role: 'user', content: '以下是初稿。只修复有依据的问题，保留有效段落、必要说明和人物表达，不做强制句数合并；直接输出完整修订正文：\n\n' + draftText }
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
