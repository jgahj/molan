'use strict';

/**
 * @file evidence-catalog.js
 * 因子化策略卡与证据库 (Factorized Strategy Card Catalog)
 * 
 * 核心设计原则：
 * 1. 策略卡标准格式：Rule + Abstract Pattern + Micro Example + Counter Example + Failure Mode；
 * 2. 证据强度严格分级：
 *    - A 级：多部名作反复验证的普适创作铁律
 *    - B 级：多部作品稳定出现的成熟范式
 *    - C 级：单一作者高频写作习惯（隔离保留，不默认进入通用库）
 *    - D 级：单章偶然写法（严格过滤）
 * 3. 仅允许 A/B 级高质量策略卡注入编译流水线，防止作者个人癖好或坏味道污染生成。
 */

const path = require('node:path');
const fs = require('node:fs');

const DEFAULT_KB_DIR = path.resolve(__dirname, '../../../data/strategy-knowledge-base');

function calculateStatisticalStrength(stats = {}) {
  const conf = Math.max(0, Math.min(1, Number(stats.confidence ?? 0.85)));
  const lift = Number(stats.qualityLift ?? 0.15);
  const books = Math.max(0, Number(stats.bookCount ?? 2));
  const authors = Math.max(0, Number(stats.authorCount ?? 2));
  const confound = Math.max(0, Math.min(1, Number(stats.confoundScore ?? 0.10)));
  const support = Math.max(0, Number(stats.supportCount ?? 12));

  // Gate 1: supportCount <= 1 -> 'D'
  if (support <= 1) {
    return 'D';
  }

  // Gate 2: books < 2 || authors < 2 -> 'C'
  if (books < 2 || authors < 2) {
    return 'C';
  }

  // Gate 3: supportCount < 3 -> 'C'
  if (support < 3) {
    return 'C';
  }

  // Gate 4: qualityLift <= 0 -> barred from Tier A and B (calculate score with 0.8 multiplier -> 'C' if >= 0.4 else 'D')
  if (lift <= 0) {
    const score = conf * (1 - confound) * 0.8 * Math.min(2.0, Math.log2(books + authors + 1));
    return score >= 0.4 ? 'C' : 'D';
  }

  // 跨作品、跨作者复现度与混杂抵抗力综合得分
  const score = conf * (1 - confound) * 1.2 * Math.min(2.0, Math.log2(books + authors + 1));

  // Gate 5: Tier A vs Tier B
  // score >= 1.5 && supportCount >= 5 && books >= 2 && authors >= 2 -> 'A'
  if (score >= 1.5 && support >= 5 && books >= 2 && authors >= 2) {
    return 'A';
  }

  // score >= 0.8 && supportCount >= 3 && books >= 2 && authors >= 2 -> 'B' (note: supportCount == 4 with score >= 1.5 capped at 'B')
  if (score >= 0.8 && support >= 3 && books >= 2 && authors >= 2) {
    return 'B';
  }

  // score >= 0.4 -> 'C'
  if (score >= 0.4) {
    return 'C';
  }

  // else -> 'D'
  return 'D';
}

function createStrategyCard(input = {}) {
  const stats = {
    supportCount: Math.max(0, Number(input.stats?.supportCount ?? 12)),
    bookCount: Math.max(0, Number(input.stats?.bookCount ?? 3)),
    authorCount: Math.max(0, Number(input.stats?.authorCount ?? 3)),
    genreCount: Math.max(0, Number(input.stats?.genreCount ?? 2)),
    qualityLift: Number(input.stats?.qualityLift ?? 0.18),
    confidence: Math.max(0, Math.min(1, Number(input.stats?.confidence ?? 0.88))),
    confoundScore: Math.max(0, Math.min(1, Number(input.stats?.confoundScore ?? 0.08)))
  };

  const dynamicStrength = input.evidenceStrength || calculateStatisticalStrength(stats);

  const card = {
    id: String(input.id || 'card_' + Date.now()).trim(),
    name: String(input.name || '经典创作范式').trim(),
    type: ['style', 'goal', 'focus', 'hook', 'combo'].includes(input.type) ? input.type : 'combo',
    rule: String(input.rule || input.ruleStatement || '').trim(),
    abstractPattern: String(input.abstractPattern || '').trim(),
    microExample: String(input.microExample || '').trim(),
    counterExample: String(input.counterExample || '').trim(),
    failureMode: String(input.failureMode || '').trim(),
    abstractionLevel: ['high', 'medium', 'low'].includes(input.abstractionLevel) ? input.abstractionLevel : 'high',
    evidenceStrength: ['A', 'B', 'C', 'D'].includes(dynamicStrength) ? dynamicStrength : 'B',
    stats: Object.freeze(stats),
    applicableDimensions: Array.isArray(input.applicableDimensions) ? input.applicableDimensions.map(String) : [],
    tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
    similarityRiskPolicy: 'prohibit_verbatim_quote',
    metadata: typeof input.metadata === 'object' && input.metadata !== null ? { ...input.metadata } : {}
  };

  if (!card.rule) throw new TypeError('策略卡必须具备 rule 正向创作规则');
  return Object.freeze(card);
}

// ===========================================================================
// 预置 A/B 级黄金创作策略卡
// ===========================================================================
const SEED_STRATEGY_CARDS = [
  createStrategyCard({
    id: 'card_dialogue_action_interleave',
    name: '动作-对白交错律',
    type: 'focus',
    rule: '人物每说出一句带有试探或交锋的核心台词，必须穿插对手的生理微动作或手中的器物交互。',
    abstractPattern: '关键台词抛出 -> 视线落点或动作微滞 -> 给予器物反作用力 -> 转移话题或反诘。',
    microExample: '“三年前的账，该平了。”他将茶盏往桌角推了半寸，瓷底与粗糙松木发出沉闷的擦刮声。对面老掌柜的手指不易察觉地扣紧了算盘梁。',
    counterExample: '“三年前的账该平了。”“你胡说，我没欠你。”“你欠了，今天必须还。”',
    failureMode: '双方如乒乓球般无停顿连珠炮单向输出台词，缺失空间感与肢体暗流。',
    evidenceStrength: 'A',
    applicableDimensions: ['dialogue_game', 'laobai_restrained', 'info_reveal'],
    tags: ['对白', '机锋', '动作']
  }),
  createStrategyCard({
    id: 'card_physical_force_combat',
    name: '微观物理受力搏杀律',
    type: 'focus',
    rule: '动作对抗严禁空洞报招式名称，必须描写具体的物理受力形变（重心位移、沙石碾碎、刃口崩缺、肌肉紧绷）。',
    abstractPattern: '发力起点（脚步/腰跨） -> 传导至器物 -> 发生物理阻力与碰撞形变 -> 承受反震与不可逆损耗。',
    microExample: '刀锋没有劈开铁甲，而是在护心镜上犁出一串刺目火星，震得他虎口崩裂，后撤两步才借着靴底碾碎沙石的力道止住倒仰。',
    counterExample: '他大喝一声使出天罡碎星斩，一道耀眼的金光瞬间将敌人击退十丈！',
    failureMode: '口号化报招，光芒万丈特效描写，缺乏肌肉与器物的真实质感。',
    evidenceStrength: 'A',
    applicableDimensions: ['action_combat', 'conflict_push', 'xuanhuan_cautious'],
    tags: ['打斗', '动作', '物理']
  }),
  createStrategyCard({
    id: 'card_suspense_physical_clue',
    name: '物证反常引爆悬念律',
    type: 'hook',
    rule: '章末悬念必须落在具体可触摸的物证异样上，而不是泛泛的旁白惊叹。',
    abstractPattern: '看似寻常的查验收尾 -> 发现与已知事实绝对矛盾的细节 -> 认知崩塌瞬间收束。',
    microExample: '他抖开那张发黄的户籍底册，目光扫过最后一栏时指节僵住了——本该死在十八年前的户主一栏，墨迹竟然还泛着新磨的微亮。',
    counterExample: '他心中充满了疑惑，感觉这件事情背后藏着一个天大的阴谋……',
    failureMode: '在结尾用旁白直接宣布“危险即将来临/事情没那么简单”，毫无具体物证支撑。',
    evidenceStrength: 'A',
    applicableDimensions: ['suspense_clue', 'info_reveal', 'urban_investigation'],
    tags: ['悬念', '钩子', '物证']
  })
];

class EvidenceCatalog {
  constructor() {
    this._cards = new Map();
    this._seedCards = new Map();
    for (const card of SEED_STRATEGY_CARDS) {
      const validated = createStrategyCard(card);
      this._cards.set(validated.id, validated);
      this._seedCards.set(validated.id, validated);
    }
    this._activeBaseDir = null;
    this._loadedPackageVersion = null;
    this._loadedPackageMtime = 0;
  }

  registerCard(card) {
    const validated = createStrategyCard(card);
    this._cards.set(validated.id, validated);
    return this;
  }

  _checkHotReload(customBaseDir = null) {
    const baseDir = customBaseDir || this._activeBaseDir || DEFAULT_KB_DIR;
    const pointerFile = path.join(baseDir, 'active_package.json');
    if (!fs.existsSync(pointerFile)) return;

    try {
      const stat = fs.statSync(pointerFile);
      if (stat.mtimeMs !== this._loadedPackageMtime || baseDir !== this._activeBaseDir) {
        this.loadActivePublishedPackage(baseDir);
      }
    } catch (_) {}
  }

  getCard(id, options = {}) {
    const baseDir = (options && typeof options === 'object' ? options.baseDir : null) ||
                    (typeof options === 'string' ? options : null);
    if (baseDir || this._activeBaseDir) {
      this._checkHotReload(baseDir);
    }
    return this._cards.get(id) || null;
  }

  findRelevantCards(options = {}) {
    const baseDir = options.baseDir || this._activeBaseDir;
    this._checkHotReload(baseDir);

    const {
      dimensions = [],
      minStrength = 'B',
      limit = 5
    } = options;

    const allowedStrengths = minStrength === 'A' ? new Set(['A']) : new Set(['A', 'B']);
    const targets = Array.isArray(dimensions) ? dimensions.map(String) : [];

    const matched = [];
    for (const card of this._cards.values()) {
      if (!allowedStrengths.has(card.evidenceStrength)) continue;

      if (!targets.length) {
        matched.push(card);
        continue;
      }

      const hit = card.applicableDimensions.some(d => targets.includes(d))
        || card.tags.some(t => targets.includes(t));
      if (hit) matched.push(card);
    }

    return matched.slice(0, limit);
  }

  /**
   * 自动发现并加载当前生效的已发布知识包 (data/strategy-knowledge-base/active_package.json)
   * 彻底打通 语料离线发布 -> 运行时生成策略检索 的生产闭环
   * @param {string|null} customKnowledgeBaseDir
   * @returns {number} 成功加载的规则卡数
   */
  loadActivePublishedPackage(customKnowledgeBaseDir = null) {
    const baseDir = customKnowledgeBaseDir || this._activeBaseDir || DEFAULT_KB_DIR;
    this._activeBaseDir = baseDir;
    const pointerFile = path.join(baseDir, 'active_package.json');
    if (!fs.existsSync(pointerFile)) return 0;

    try {
      const stat = fs.statSync(pointerFile);
      const pointer = JSON.parse(fs.readFileSync(pointerFile, 'utf8'));
      this._loadedPackageMtime = stat.mtimeMs;
      this._loadedPackageVersion = pointer.activeVersion;

      let pkgDir = pointer.packageDir;
      if (pkgDir) {
        if (!path.isAbsolute(pkgDir)) {
          pkgDir = path.resolve(baseDir, pkgDir);
        }
        if (fs.existsSync(pkgDir)) {
          return this.loadFromPublishedPackage(pkgDir);
        }
      }
    } catch (_) {}
    return 0;
  }

  loadFromPublishedPackage(packageDir, customBaseDir = null) {
    const baseDir = customBaseDir || this._activeBaseDir || DEFAULT_KB_DIR;
    const resolvedPackageDir = path.isAbsolute(packageDir)
      ? packageDir
      : (fs.existsSync(packageDir) ? path.resolve(packageDir) : path.resolve(baseDir, packageDir));
    const rulesFile = path.join(resolvedPackageDir, 'strategy-rules.jsonl');
    if (!fs.existsSync(rulesFile)) return 0;

    // 清空非种子卡，确保版本切换时陈旧卡被原子剔除 (Purge stale cards on reload)
    this._cards = new Map(this._seedCards);

    let loadedCount = 0;
    const lines = fs.readFileSync(rulesFile, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        if (['A', 'B'].includes(item.evidenceStrength)) {
          this.registerCard({
            id: item.id,
            name: item.name,
            type: item.type || 'combo',
            rule: item.rule || item.ruleStatement,
            abstractPattern: item.abstractPattern,
            microExample: item.microExample,
            counterExample: item.counterExample,
            failureMode: item.failureMode,
            evidenceStrength: item.evidenceStrength,
            stats: item.stats,
            applicableDimensions: item.applicableDimensions || ['dialogue_game', 'laobai_restrained', 'conflict_push']
          });
          loadedCount++;
        }
      } catch (_) {}
    }
    return loadedCount;
  }
}

const defaultEvidenceCatalog = new EvidenceCatalog();

module.exports = {
  createStrategyCard,
  calculateStatisticalStrength,
  EvidenceCatalog,
  defaultEvidenceCatalog,
  SEED_STRATEGY_CARDS
};
