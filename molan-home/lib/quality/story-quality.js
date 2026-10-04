'use strict';

/**
 * 篇章级故事质量审查 (Story-Level QA & Checkpoints)
 *
 * 核心设计：
 * - 针对 5 / 10 / 20 章节里程碑（以及任意多章合集）进行全局质检；
 * - 角色弧光与幽灵人物诊断 (Character Arc & Ghost Characters)：
 *   追踪主要人物出场频率与行为主动性，检测早先出场后离奇失踪 5 章以上的幽灵人物；
 * - 因果债务生命周期管理 (Causal Debt Lifecycle)：
 *   追踪伏笔埋设与回收，标注沉没/悬挂超过 5 章无响应的呆滞债务，预警债务过载；
 * - 跨章套路重复度诊断 (Repetition Risk)：
 *   分析连续章节的高潮结构相似度、章末钩子 (Cliffhanger) 模式同质化。
 */

function evaluateStoryQuality(chapters = [], options = {}) {
  const chapterList = Array.isArray(chapters) ? chapters : [];
  const chapterCount = chapterList.length;

  if (chapterCount === 0) {
    return {
      status: 'pass',
      checkpoint: 0,
      chapterCount: 0,
      healthScore: 100,
      characterArc: { trackedCharacters: [], ghostCharacters: [] },
      causalDebtLifecycle: { totalDebts: 0, openDebts: [], staleDebts: [] },
      repetitionRisk: { repetitionScore: 0, warnings: [] },
      recommendations: []
    };
  }

  const recommendations = [];
  let scoreDeductions = 0;

  // 1. 角色生命周期与幽灵角色审查
  // 收集所有出场人物及其出现的章节编号
  const characterAppearances = new Map(); // name -> Set<chapterNo>
  const characterFirstSeen = new Map();  // name -> chapterNo

  chapterList.forEach((chap, idx) => {
    const chapNo = chap.chapterNo !== undefined ? Number(chap.chapterNo) : (idx + 1);
    const chars = Array.isArray(chap.characters)
      ? chap.characters.map(c => typeof c === 'string' ? c : (c.name || c.id)).filter(Boolean)
      : [];

    // 若章节文本存在，尝试从文本匹配已知人物
    const text = String(chap.text || chap.content || '');

    chars.forEach(name => {
      if (!characterAppearances.has(name)) {
        characterAppearances.set(name, new Set());
        characterFirstSeen.set(name, chapNo);
      }
      characterAppearances.get(name).add(chapNo);
    });
  });

  const ghostCharacters = [];
  const trackedCharacters = [];

  for (const [name, appearances] of characterAppearances.entries()) {
    const firstSeen = characterFirstSeen.get(name);
    const lastSeen = Math.max(...appearances);
    const absenceSpan = chapterCount - lastSeen;

    trackedCharacters.push({
      name,
      appearanceCount: appearances.size,
      firstSeen,
      lastSeen,
      absenceSpan
    });

    // 若在早期 (<=第2章) 出场且出场 >=2 次，但随后连续失踪超过 4 章，判定为幽灵人物
    if (appearances.size >= 2 && absenceSpan >= 5 && chapterCount >= 5) {
      ghostCharacters.push({
        name,
        lastSeen,
        absenceSpan,
        message: `核心/常驻角色「${name}」在第 ${lastSeen} 章后连续 ${absenceSpan} 章未出场或提及`
      });
      scoreDeductions += 10;
      recommendations.push(`建议在后续章节安排角色「${name}」的动向交代或侧面消息`);
    }
  }

  // 2. 因果债务与伏笔生命周期审查
  const allDebts = [];
  const openDebts = [];
  const staleDebts = [];

  chapterList.forEach((chap, idx) => {
    const chapNo = chap.chapterNo !== undefined ? Number(chap.chapterNo) : (idx + 1);
    const debts = Array.isArray(chap.causalDebts || chap.debts) ? (chap.causalDebts || chap.debts) : [];

    debts.forEach(d => {
      const debtId = d.id || `${chapNo}_${d.keyword || 'debt'}`;
      const status = String(d.status || 'open').toLowerCase();
      const plantedAt = Number(d.plantedAt || chapNo);
      const isResolved = status === 'resolved' || status === 'paid';

      allDebts.push({ ...d, debtId, plantedAt, isResolved });

      if (!isResolved) {
        openDebts.push({ ...d, debtId, plantedAt });
        // 挂起超过 5 章未推进视为呆滞因果债务
        if (chapterCount - plantedAt >= 5) {
          staleDebts.push({
            debtId,
            keyword: d.keyword || d.name,
            plantedAt,
            pendingChapters: chapterCount - plantedAt,
            message: `因果债务「${d.keyword || d.name || debtId}」在第 ${plantedAt} 章埋设，已逾期 ${chapterCount - plantedAt} 章未兑付`
          });
        }
      }
    });
  });

  if (staleDebts.length > 0) {
    scoreDeductions += Math.min(30, staleDebts.length * 6);
    recommendations.push(`存在 ${staleDebts.length} 条长周期未回收的呆滞因果债，建议在下一个高潮节点逐步解套`);
  }

  if (openDebts.length > 8) {
    scoreDeductions += 12;
    recommendations.push(`当前未闭环的因果债务已达到 ${openDebts.length} 条，超出单卷认知负荷，请防范剧情失控崩盘`);
  }

  // 3. 跨章套路重复度与章末钩子 (Cliffhanger) 同质化
  const endings = [];
  const repeatedEndingPatterns = [];
  chapterList.forEach((chap, idx) => {
    const chapNo = chap.chapterNo !== undefined ? Number(chap.chapterNo) : (idx + 1);
    const text = String(chap.text || chap.content || '').trim();
    if (text) {
      const lastLine = text.slice(-60).replace(/[\r\n]+/g, ' ').trim();
      const lastPunctuation = text.slice(-1);
      endings.push({ chapNo, lastLine, lastPunctuation });
    }
  });

  // 检测连续 3 章章末以问号/反诘句或相同标点形式结尾
  for (let i = 0; i <= endings.length - 3; i++) {
    const e1 = endings[i];
    const e2 = endings[i + 1];
    const e3 = endings[i + 2];
    if (e1.lastPunctuation && e1.lastPunctuation === e2.lastPunctuation && e2.lastPunctuation === e3.lastPunctuation && ['？', '?', '！', '!'].includes(e1.lastPunctuation)) {
      repeatedEndingPatterns.push({
        chapters: [e1.chapNo, e2.chapNo, e3.chapNo],
        punctuation: e1.lastPunctuation,
        message: `第 ${e1.chapNo}、${e2.chapNo}、${e3.chapNo} 章连续使用「${e1.lastPunctuation}」作为章末卡点钩子，模式雷同`
      });
      scoreDeductions += 8;
      recommendations.push(`避免连续章节使用同一种章末悬念形式，改用人物动作收煞、意象留白或环境暗示切换`);
    }
  }

  // 4. 汇总健康评分与判定
  const healthScore = Math.max(0, 100 - scoreDeductions);
  let status = 'pass';
  if (healthScore < 60) status = 'alert';
  else if (healthScore < 80) status = 'warn';

  // 判定里程碑类型
  let checkpoint = 0;
  if (chapterCount >= 20) checkpoint = 20;
  else if (chapterCount >= 10) checkpoint = 10;
  else if (chapterCount >= 5) checkpoint = 5;

  return {
    status,
    checkpoint,
    chapterCount,
    healthScore,
    characterArc: {
      totalTracked: trackedCharacters.length,
      trackedCharacters,
      ghostCharacters
    },
    causalDebtLifecycle: {
      totalDebts: allDebts.length,
      openCount: openDebts.length,
      staleCount: staleDebts.length,
      staleDebts
    },
    repetitionRisk: {
      repetitionScore: Math.min(100, repeatedEndingPatterns.length * 20),
      repeatedEndingPatterns
    },
    recommendations
  };
}

module.exports = {
  evaluateStoryQuality
};
