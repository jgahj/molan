'use strict';

/**
 * 跨章节因果债务记账簿与三级复利兑现引擎 (Causal Debt & Compounding Payoff Tracker)
 * 职责：
 * 1. 跟踪每一章中主角付出的沉重代价、未平账目、受损器物与程序瑕疵（因果债务 Seed）；
 * 2. 实行“三主三辅”动态容量控制（主债 ≤ 3，支线债 ≤ 3，微债 5 章未用自动沉降），杜绝债务通胀；
 * 3. 动态组装后续章节的写作提示词（注入已成熟待兑现的复利杀招或反转引信）。
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_STORE_DIR = path.join(__dirname, '..', 'data', 'causal-debts');

class CausalDebtTracker {
  constructor(options = {}) {
    const opts = typeof options === 'string' ? { storeDir: options } : (options || {});
    this.storeDir = opts.storeDir || DEFAULT_STORE_DIR;
    this.maxMajorDebts = opts.maxMajorDebts || 3;
    this.maxArcDebts = opts.maxArcDebts || 3;
    this.maxMicroDebts = opts.maxMicroDebts || 3;
    this.microExpirationSpan = opts.microExpirationSpan || 5;
    this._ensureDir();
  }

  _ensureDir() {
    try {
      if (!fs.existsSync(this.storeDir)) {
        fs.mkdirSync(this.storeDir, { recursive: true });
      }
    } catch (_) {}
  }

  _getStoreFile(bookId) {
    const safeId = String(bookId || 'default').replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_');
    return path.join(this.storeDir, `${safeId}-debts.json`);
  }

  loadBookDebts(bookId) {
    const file = this._getStoreFile(bookId);
    if (!fs.existsSync(file)) {
      return { bookId, debts: [] };
    }
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return { bookId, debts: [] };
    }
  }

  saveBookDebts(bookId, data) {
    this._ensureDir();
    const file = this._getStoreFile(bookId);
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * 录入一项新的因果债务
   * @param {string} bookId 
   * @param {object} debtItem
   */
  recordDebt(bookId, debtItem) {
    const seed = debtItem && (debtItem.seed || debtItem.description);
    if (!seed) {
      throw new Error('debtItem 必须包含 seed 描述');
    }
    const store = this.loadBookDebts(bookId);
    const type = debtItem.type || 'arc'; // 'major' | 'arc' | 'micro'
    const chapter = Number(debtItem.originChapter || debtItem.chapter || debtItem.chapterNum) || 1;

    const newDebt = {
      id: debtItem.id || `debt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      originChapter: chapter,
      type,
      debtCategory: debtItem.debtCategory || debtItem.category || 'general',
      seed,
      immediateCost: debtItem.immediateCost || debtItem.stakes || '',
      status: 'active', // 'active' | 'matured' | 'redeemed' | 'settled'
      maturationChapter: Number(debtItem.maturationChapter) || (type === 'major' ? chapter + 25 : type === 'arc' ? chapter + 10 : chapter + 3),
      payoffTier: debtItem.payoffTier || (type === 'major' ? 3 : type === 'arc' ? 2 : 1),
      suggestedPayoffAction: debtItem.suggestedPayoffAction || '',
      recordedAt: Date.now()
    };

    store.debts.push(newDebt);
    this._enforceCapacity(store, chapter);
    this.saveBookDebts(bookId, store);
    return newDebt;
  }

  /**
   * 动态容量管理：三主三辅，微债 5 章超时自动沉降为人物生活履历背景
   */
  _enforceCapacity(store, currentChapter) {
    const activeDebts = store.debts.filter(d => d.status === 'active' || d.status === 'matured');
    
    // 1. 处理微债过期
    for (const d of activeDebts) {
      if (d.type === 'micro' && (currentChapter - d.originChapter) > this.microExpirationSpan) {
        d.status = 'settled';
        d.settledReason = '自然沉降为角色生活履历背景';
      }
    }

    // 2. 超量裁切：按先进先出淘汰多余的支线债
    const activeMajor = store.debts.filter(d => (d.status === 'active' || d.status === 'matured') && d.type === 'major');
    const activeArc = store.debts.filter(d => (d.status === 'active' || d.status === 'matured') && d.type === 'arc');
    const activeMicro = store.debts.filter(d => (d.status === 'active' || d.status === 'matured') && d.type === 'micro');

    if (activeMajor.length > this.maxMajorDebts) {
      const overflow = activeMajor.slice(0, activeMajor.length - this.maxMajorDebts);
      for (const d of overflow) d.status = 'settled';
    }
    if (activeArc.length > this.maxArcDebts) {
      const overflow = activeArc.slice(0, activeArc.length - this.maxArcDebts);
      for (const d of overflow) d.status = 'settled';
    }
    if (activeMicro.length > this.maxMicroDebts) {
      const overflow = activeMicro.slice(0, activeMicro.length - this.maxMicroDebts);
      for (const d of overflow) d.status = 'settled';
    }
  }

  /**
   * 获取当前章节可用的活跃与成熟债务
   */
  getActiveDebts(bookId, currentChapter = 1) {
    const store = this.loadBookDebts(bookId);
    this._enforceCapacity(store, currentChapter);

    const active = [];
    const matured = [];

    for (const d of store.debts) {
      if (d.status !== 'active' && d.status !== 'matured') continue;
      if (currentChapter >= d.maturationChapter) {
        d.status = 'matured';
        matured.push(d);
      } else {
        active.push(d);
      }
    }

    return { active, matured, allActiveCount: active.length + matured.length };
  }

  /**
   * 获取结构化因果债务视图（供 genre-engine 场景规划与质检使用）
   */
  getDebts(bookId, currentChapter = 1) {
    const store = this.loadBookDebts(bookId);
    const { active, matured, allActiveCount } = this.getActiveDebts(bookId, currentChapter);
    return {
      allDebts: store.debts,
      active,
      matured,
      allActiveCount,
      majorDebts: active.filter(d => d.type === 'major'),
      arcDebts: active.filter(d => d.type === 'arc'),
      microDebts: active.filter(d => d.type === 'micro')
    };
  }

  /**
   * 兑现/平息某项因果债务（触发复利收割）
   */
  redeemDebt(bookId, debtId, redemptionChapter, payoffAction) {
    const store = this.loadBookDebts(bookId);
    const target = store.debts.find(d => d.id === debtId);
    if (!target) return false;

    target.status = 'redeemed';
    target.redeemedChapter = Number(redemptionChapter) || 1;
    target.payoffAction = payoffAction || target.suggestedPayoffAction || '已兑现戏剧反弹';
    target.redeemedAt = Date.now();

    this.saveBookDebts(bookId, store);
    return target;
  }

  /**
   * 平账/结清指定债务
   */
  settleDebt(bookId, debtId, settledReason = '已在本章兑现平账') {
    const store = this.loadBookDebts(bookId);
    const target = store.debts.find(d => d.id === debtId);
    if (!target) return null;

    target.status = 'settled';
    target.settledReason = settledReason;
    target.settledAt = Date.now();
    this.saveBookDebts(bookId, store);
    return target;
  }

  /**
   * 组装注入到正文生成的提示词块
   */
  buildDebtPromptInjection(bookId, currentChapter = 1) {
    const { active, matured } = this.getActiveDebts(bookId, currentChapter);
    if (active.length === 0 && matured.length === 0) return '';

    const categoryNames = {
      comedy_mess: '【烂摊子/误会喜剧债】',
      emotional_tension: '【情感拉扯/承诺暧昧债】',
      contractual: '【契约法务/利益纠纷债】',
      martial_cost: '【功法代价/反噬伏笔债】',
      rule_violation: '【规则异变/禁忌侵蚀债】',
      general: '【因果伏笔债】'
    };

    const lines = ['【跨章节因果债务与细节复利（Causal Debt & Compounding Payoffs）】'];
    lines.push('网文长篇铁律：前期章节留下的悬念、未了账目、人物溜号烂摊子或未解之谜，后续章节必须有条不紊推进与呼应！');

    if (matured.length > 0) {
      lines.push('\n★【本章已成熟、建议收割兑付的因果伏笔（优先在本章反转兑现）】：');
      for (const m of matured) {
        const catTag = categoryNames[m.debtCategory] || categoryNames.general;
        lines.push(`- [债务${m.id}·第${m.originChapter}章${catTag}] 代价/线索：“${m.seed}”`);
        if (m.immediateCost) lines.push(`  当时直接利害：${m.immediateCost}`);
        if (m.suggestedPayoffAction) lines.push(`  建议兑现方案：${m.suggestedPayoffAction}`);
      }
    }

    if (active.length > 0) {
      lines.push('\n★【当前潜伏中、可借机呼应或加深因果的未平账目（三主三辅在列）】：');
      for (const a of active) {
        const catTag = categoryNames[a.debtCategory] || categoryNames.general;
        const tierName = a.type === 'major' ? '主线核心大债' : a.type === 'arc' ? '分卷支线债' : '日常微账';
        lines.push(`- [第${a.originChapter}章·${tierName}${catTag}] “${a.seed}”（预计第${a.maturationChapter}章成熟）`);
        if (a.immediateCost) lines.push(`  当时直接代价/利害：${a.immediateCost}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 从章节正文中多维提取潜在的新代价种子（支持搞笑女频、情感拉扯、契约漏洞、超凡代价）
   */
  extractPotentialDebts(chapterText, chapterNum = 1, options = {}) {
    const text = String(chapterText || '');
    const candidates = [];

    // 1. 悬念台词、反噬承诺与放狠话 (Major / Arc)
    const quoteWarnings = [...text.matchAll(/[“"]([^”"\n\r]{3,60}(?:别回|没有活人|灭门|死定了|等我回来|老娘|打爆|杀机|警告|小心|倒霉|秘密|活物|有鬼|反噬|记下|代价|脖子|不准|开门|少了一钱|折色))[^”"\n\r]*[”"]/g)];
    for (const m of quoteWarnings) {
      if (candidates.length >= 4) break;
      const seedText = m[1].trim();
      const cat = seedText.includes('老娘') ? 'comedy_mess' : seedText.includes('反噬') || seedText.includes('代价') ? 'martial_cost' : 'general';
      candidates.push({
        type: 'major',
        debtCategory: cat,
        seed: `第${chapterNum}章伏笔承诺：“${seedText}”`,
        immediateCost: `第${chapterNum}章留下的悬念或代价伏笔`
      });
    }

    // 2. 契约法务、账目争议与程序瑕疵 (Major / Arc / Contractual)
    const contractMatches = [...text.matchAll(/(?:少[了一二三四五六七八九十半]+[两钱文]|折色少[^，。\n]{1,10}|欠[下着][^，。\n]{1,10}[两钱文]|仲裁|公章|路引|身契|红契|调令|批条|检材未登记[^，。\n]{0,10}|程序瑕疵|勘验笔录[^，。\n]{0,10})[^，。\n]{0,20}/g)];
    for (const m of contractMatches) {
      if (candidates.length >= 4) break;
      const seedText = m[0].trim();
      if (!candidates.some(c => c.seed.includes(seedText))) {
        candidates.push({
          type: 'arc',
          debtCategory: 'contractual',
          seed: seedText,
          immediateCost: `第${chapterNum}章留下的账目瑕疵或程序把柄`
        });
      }
    }

    // 3. 功法代价与异变规则 (Major / Martial / Rule)
    const costMatches = [...text.matchAll(/(?:(?:服下|吞服|动用|施展)[^，。\n]{1,15}(?:丹|功|法|禁术)|(?:气海|经脉|神魂|三个月内)[^，。\n]{0,10}(?:反噬|受损|强开)|规则血字|不可在午夜[^，。\n]{0,10}开门|禁忌规则)[^，。\n]{0,20}/g)];
    for (const m of costMatches) {
      if (candidates.length >= 4) break;
      const seedText = m[0].trim();
      if (!candidates.some(c => c.seed.includes(seedText))) {
        candidates.push({
          type: 'major',
          debtCategory: seedText.includes('规则') || seedText.includes('门') ? 'rule_violation' : 'martial_cost',
          seed: seedText,
          immediateCost: `第${chapterNum}章动用超常手段付出的代价或触发的规则禁忌`
        });
      }
    }

    // 4. 喜剧烂摊子与意外缴获道具 (Arc / Comedy)
    const comedyMessMatches = [...text.matchAll(/(?:黑色铁箱|神秘.*?木盒|铁箱内|活物|溜号|跑路|送走瘟神|借口上厕所|趁山还在|打断腿|抢劫抢到老娘)[^，。\n]{0,20}/g)];
    for (const m of comedyMessMatches) {
      if (candidates.length >= 4) break;
      const seedText = m[0].trim();
      if (!candidates.some(c => c.seed.includes(seedText))) {
        candidates.push({
          type: 'arc',
          debtCategory: 'comedy_mess',
          seed: `意外缴获与烂摊子：${seedText}`,
          immediateCost: `第${chapterNum}章留给同门/族人的未知隐患与突发收获`
        });
      }
    }

    // 5. 情感拉扯与暗中在乎 (Arc / Romance)
    const romanceMatches = [...text.matchAll(/(?:红了耳根|未送出的信|暗中收下|借物未还|眼神闪躲|欲言又止|系上红绳)[^，。\n]{0,20}/g)];
    for (const m of romanceMatches) {
      if (candidates.length >= 4) break;
      const seedText = m[0].trim();
      if (!candidates.some(c => c.seed.includes(seedText))) {
        candidates.push({
          type: 'arc',
          debtCategory: 'emotional_tension',
          seed: `情感微澜伏笔：${seedText}`,
          immediateCost: `第${chapterNum}章未挑明的心思与微表情暗扣`
        });
      }
    }

    return candidates.slice(0, 4);
  }

  clearDebts(bookId) {
    const file = this._getStoreFile(bookId);
    if (fs.existsSync(file)) {
      try { fs.unlinkSync(file); } catch (_) {}
    }
  }
}

/** 在不加载任何账本文件的前提下复用因果债务文本提取规则。 */
function extractPotentialDebts(chapterText, chapterNum = 1, options = {}) {
  return CausalDebtTracker.prototype.extractPotentialDebts.call({}, chapterText, chapterNum, options);
}

/** 根据已经由调用方读取的债务列表生成提示词，供 PostgreSQL 路径复用。 */
function buildDebtPromptInjection(debts, currentChapter = 1) {
  const all = Array.isArray(debts) ? debts : [];
  const chapter = Math.max(1, Number(currentChapter) || 1);
  const active = all.filter(debt => debt && (debt.status === 'active' || debt.status === 'matured') && chapter < Number(debt.maturationChapter || 1));
  const matured = all.filter(debt => debt && (debt.status === 'matured' || chapter >= Number(debt.maturationChapter || 1)) && debt.status !== 'settled' && debt.status !== 'redeemed');
  if (!active.length && !matured.length) return '';
  const categoryNames = {
    comedy_mess: '【烂摊子/误会喜剧债】',
    emotional_tension: '【情感拉扯/承诺暧昧债】',
    contractual: '【契约法务/利益纠纷债】',
    martial_cost: '【功法代价/反噬伏笔债】',
    rule_violation: '【规则异变/禁忌侵蚀债】',
    general: '【因果伏笔债】'
  };
  const lines = ['【跨章节因果债务与细节复利（Causal Debt & Compounding Payoffs）】'];
  lines.push('网文长篇铁律：前期章节留下的悬念、未了账目、人物溜号烂摊子或未解之谜，后续章节必须有条不紊推进与呼应！');
  if (matured.length) {
    lines.push('\n★【本章已成熟、建议收割兑付的因果伏笔（优先在本章反转兑现）】：');
    for (const debt of matured) {
      const catTag = categoryNames[debt.debtCategory] || categoryNames.general;
      lines.push(`- [债务${debt.id}·第${debt.originChapter}章${catTag}] 代价/线索：“${debt.seed}”`);
      if (debt.immediateCost) lines.push(`  当时直接利害：${debt.immediateCost}`);
      if (debt.suggestedPayoffAction) lines.push(`  建议兑现方案：${debt.suggestedPayoffAction}`);
    }
  }
  if (active.length) {
    lines.push('\n★【当前潜伏中、可借机呼应或加深因果的未平账目（三主三辅在列）】：');
    for (const debt of active) {
      const catTag = categoryNames[debt.debtCategory] || categoryNames.general;
      const tierName = debt.type === 'major' ? '主线核心大债' : debt.type === 'arc' ? '分卷支线债' : '日常微账';
      lines.push(`- [第${debt.originChapter}章·${tierName}${catTag}] “${debt.seed}”（预计第${debt.maturationChapter}章成熟）`);
      if (debt.immediateCost) lines.push(`  当时直接代价/利害：${debt.immediateCost}`);
    }
  }
  return lines.join('\n');
}

module.exports = {
  CausalDebtTracker,
  extractPotentialDebts,
  buildDebtPromptInjection,
  defaultTracker: new CausalDebtTracker()
};
