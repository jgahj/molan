'use strict';

/**
 * @file profile-registry.js
 * 创作 Profile 统一注册中心与解析器
 * 
 * 核心功能：
 * 1. 预装纯正正交的种子 Profile 资产（题材无角色锁定、文风量化、目标含 State Delta、侧重含预算、钩子含兑现期）；
 * 2. 支持自定义 Profile 动态注册与热替换；
 * 3. 实现 resolveCompositionSpec：将用户简明 5 维输入无缝解析为标准 CompositionSpec，并自动推导其余 7 维系统策略。
 */

const { createGenreProfile } = require('./genre-profile');
const { createStyleProfile } = require('./style-profile');
const { createChapterGoalProfile } = require('./chapter-goal-profile');
const { createFocusProfile } = require('./focus-profile');
const { createHookProfile } = require('./hook-profile');

// ===========================================================================
// 一、预装内置种子 Profile 库
// ===========================================================================

const SEED_GENRES = [
  createGenreProfile({
    id: 'xuanhuan_cautious',
    name: '凡人谨慎修真',
    family: 'xuanhuan',
    background: ['东方架空', '宗门', '坊市', '灵气匮乏', '等级森严'],
    coreConflicts: ['底层生存', '微薄资源竞争', '强者压制', '利益背叛'],
    readerPromises: ['以弱胜强', '谨慎藏拙带来的安全感', '扎实发育', '防守反击'],
    commonStoryEngines: ['resource_competition', 'survival_evolution'],
    forbiddenAssumptions: ['严禁预设主角姓名或金手指', '严禁开局全知视角']
  }),
  createGenreProfile({
    id: 'urban_investigation',
    name: '都市现实悬疑',
    family: 'urban',
    background: ['现代都市', '市井街巷', '档案室', '隐秘角落'],
    coreConflicts: ['正邪博弈', '信息不对称', '利益交换', '人性深渊'],
    readerPromises: ['线索闭环', '逻辑严密', '智商在线', '水落石出'],
    commonStoryEngines: ['mystery_unravelling', 'cat_and_mouse']
  }),
  createGenreProfile({
    id: 'scifi_hardcore',
    name: '硬核探索科幻',
    family: 'scifi',
    background: ['深空宇宙', '太空站', '物理法则约束', '技术瓶颈'],
    coreConflicts: ['环境极限', '科学伦理', '文明生存', '未知异象'],
    readerPromises: ['宏大视野', '硬逻辑自洽', '科学敬畏感'],
    commonStoryEngines: ['exploration', 'crisis_mitigation']
  }),
  createGenreProfile({
    id: 'ancient_court',
    name: '历史古代权谋',
    family: 'history',
    background: ['古代朝堂', '门阀世家', '官制礼法', '边关烽火'],
    coreConflicts: ['皇权相权', '世族争端', '粮饷民生', '权力更迭'],
    readerPromises: ['格局厚重', '政治推演', '借力打力', '阳谋无解'],
    commonStoryEngines: ['political_intrigue', 'dynastic_struggle']
  })
];

const SEED_STYLES = [
  createStyleProfile({
    id: 'laobai_restrained',
    name: '老白冷硬克制',
    baseVector: {
      narrativeDensity: 0.82,
      emotionalIntensity: 0.45,
      rhetoricalAbundance: 0.30,
      colloquialLevel: 0.40,
      dialogueRatio: 0.35,
      psychologicalRatio: 0.38,
      settingRatio: 0.22,
      averageSentenceLength: 18.5,
      shortSentenceRatio: 0.62,
      informationDensity: 0.85,
      negativeSpaceRatio: 0.48
    },
    positiveRules: [
      '用白描具体动作传达物理受力与冷硬质感',
      '关键台词穿插人物微表情或器物交互，严禁单向连珠炮台词',
      '情感用不可逆行动体现，留白交由读者体悟'
    ],
    negativeRules: [
      '严禁使用“瞳孔骤缩”、“嘴角勾起”等套话',
      '严禁旁白越俎代庖发表道德审判'
    ]
  }),
  createStyleProfile({
    id: 'fast_paced_cool',
    name: '干练快节奏爽文',
    baseVector: {
      narrativeDensity: 0.75,
      emotionalIntensity: 0.70,
      rhetoricalAbundance: 0.35,
      colloquialLevel: 0.60,
      dialogueRatio: 0.40,
      psychologicalRatio: 0.20,
      settingRatio: 0.15,
      averageSentenceLength: 14.0,
      shortSentenceRatio: 0.78,
      informationDensity: 0.75,
      negativeSpaceRatio: 0.25
    },
    positiveRules: [
      '短句排比推进，节奏明快，动作反应迅速果决',
      '正面回击不拖泥带水，即时兑现行动结果'
    ],
    negativeRules: [
      '严禁长篇大论环境描写拖慢交锋节奏'
    ]
  }),
  createStyleProfile({
    id: 'lyrical_minimalist',
    name: '清冷留白写意',
    baseVector: {
      narrativeDensity: 0.60,
      emotionalIntensity: 0.40,
      rhetoricalAbundance: 0.50,
      colloquialLevel: 0.25,
      dialogueRatio: 0.25,
      psychologicalRatio: 0.35,
      settingRatio: 0.35,
      averageSentenceLength: 22.0,
      shortSentenceRatio: 0.50,
      informationDensity: 0.60,
      negativeSpaceRatio: 0.60
    },
    positiveRules: [
      '声色光影勾勒空间氛围，以景衬人',
      '行文克制疏离，言有尽而意无穷'
    ],
    negativeRules: [
      '严禁喧闹口语与泛滥感叹号'
    ]
  })
];

const SEED_GOALS = [
  createChapterGoalProfile({
    id: 'info_reveal',
    name: '信息揭露',
    readerEffect: ['获得新线索', '推翻旧假设', '激化核心悬念'],
    defaultStateDelta: {
      stateBefore: '主角与读者均处于假象或迷雾中',
      events: ['发现关键物证或撬开知情人缺口'],
      stateAfter: '真凶/隐秘真相浮现一角，危机不可逆深化',
      invalidIfRemoved: '后续防御与追查行动将失去因果支撑'
    },
    mustHave: ['旧线索锚点', '新证物物理细节', '认知重塑过程'],
    mustNot: ['旁白直接报幕剧透', '无意义琐碎八卦']
  }),
  createChapterGoalProfile({
    id: 'conflict_push',
    name: '冲突推进',
    readerEffect: ['紧张紧迫感', '对抗升级', '不可逆代价'],
    defaultStateDelta: {
      stateBefore: '双方摩擦初现但尚存缓冲余地',
      events: ['正面摩擦爆发，打破平衡'],
      stateAfter: '局势彻底撕破脸，对抗不可逆升级',
      invalidIfRemoved: '后续大战或破裂显得突兀无由'
    },
    mustHave: ['核心利益冲突点', '双方反制招数', '胜负或攻守转换'],
    mustNot: ['各打五十大板的无效平局']
  }),
  createChapterGoalProfile({
    id: 'breakthrough_upgrade',
    name: '突破成长',
    readerEffect: ['成长质变爽感', '力量体系兑现', '期待后续施展'],
    defaultStateDelta: {
      stateBefore: '瓶颈受限，实力或认知处于临界点',
      events: ['克服痛苦凶险，完成功法参悟或关键突破'],
      stateAfter: '战力质变，解锁全新层次能力',
      invalidIfRemoved: '战胜后续强敌缺乏合理逻辑'
    },
    mustHave: ['突破的阻力与凶险过程', '力量质变的微观物理感受'],
    mustNot: ['一句话无痛跳过突破描写']
  })
];

const SEED_FOCUSES = [
  createFocusProfile({
    id: 'balanced',
    name: '剧情均衡推进',
    budgetWeights: {
      conflict: 0.20, character: 0.20, emotion: 0.15,
      dialogue: 0.20, setting: 0.10, action: 0.10, foreshadowing: 0.05
    },
    directives: { dialogue: '推进主线', action: '提供物理阻力', setting: '建立空间质感' }
  }),
  createFocusProfile({
    id: 'dialogue_game',
    name: '对话机锋博弈',
    budgetWeights: {
      conflict: 0.20, character: 0.20, emotion: 0.10,
      dialogue: 0.40, setting: 0.05, action: 0.03, foreshadowing: 0.02
    },
    directives: { dialogue: '重点突出：机锋暗藏，话里有话，严禁直接交代底牌' }
  }),
  createFocusProfile({
    id: 'action_combat',
    name: '动作物理搏杀',
    budgetWeights: {
      conflict: 0.35, character: 0.10, emotion: 0.05,
      dialogue: 0.10, setting: 0.10, action: 0.25, foreshadowing: 0.05
    },
    directives: { action: '重点突出：肌肉紧绷、脚步重心、兵刃形变与受力反馈' }
  })
];

const SEED_HOOKS = [
  createHookProfile({
    id: 'suspense_clue',
    name: '物证异样悬念钩',
    type: 'suspense',
    placement: 'ending',
    strength: 0.80,
    gapType: 'information_gap',
    payoffHorizon: 'medium',
    directiveTemplate: '结尾抛出颠覆前期认知的异常物证或未死之人的信物，卡在惊愕瞬间。',
    exampleSnippet: '那封密信上，赫然盖着已经殉职三年的镇守使私印。'
  }),
  createHookProfile({
    id: 'crisis_imminent',
    name: '危机降临死生钩',
    type: 'crisis',
    placement: 'ending',
    strength: 0.88,
    gapType: 'danger_gap',
    payoffHorizon: 'short',
    directiveTemplate: '千钧一发之际强敌或异象突然破门而入，主角退路被封死。',
    exampleSnippet: '他刚握住玉简，头顶的青石板轰然塌陷，一只覆满黑鳞的巨爪探了下来。'
  }),
  createHookProfile({
    id: 'anticipation_duel',
    name: '大比决战期待钩',
    type: 'anticipation',
    placement: 'ending',
    strength: 0.75,
    gapType: 'expectation_gap',
    payoffHorizon: 'short',
    directiveTemplate: '宣告明日决战/开炉/大典，给读者明确的打脸或蜕变期待。',
    exampleSnippet: '“明日午时，生死台见。”他收剑入鞘，没有再看台下一眼。'
  })
];

// ===========================================================================
// 二、Registry 容器与解析器
// ===========================================================================

class ProfileRegistry {
  constructor() {
    this._genres = new Map();
    this._styles = new Map();
    this._goals = new Map();
    this._focuses = new Map();
    this._hooks = new Map();

    // 加载种子库
    for (const g of SEED_GENRES) this.registerGenre(g);
    for (const s of SEED_STYLES) this.registerStyle(s);
    for (const g of SEED_GOALS) this.registerGoal(g);
    for (const f of SEED_FOCUSES) this.registerFocus(f);
    for (const h of SEED_HOOKS) this.registerHook(h);
  }

  registerGenre(profile) { this._genres.set(profile.id, profile); return this; }
  registerStyle(profile) { this._styles.set(profile.id, profile); return this; }
  registerGoal(profile) { this._goals.set(profile.id, profile); return this; }
  registerFocus(profile) { this._focuses.set(profile.id, profile); return this; }
  registerHook(profile) { this._hooks.set(profile.id, profile); return this; }

  getGenre(idOrAlias) {
    const key = String(idOrAlias || '').trim();
    if (this._genres.has(key)) return this._genres.get(key);
    for (const g of this._genres.values()) {
      if (g.name.includes(key) || key.includes(g.family)) return g;
    }
    return SEED_GENRES[0]; // 默认安全兜底
  }

  getStyle(idOrAlias) {
    const key = String(idOrAlias || '').trim();
    if (this._styles.has(key)) return this._styles.get(key);
    for (const s of this._styles.values()) {
      if (s.name.includes(key) || key.includes(s.id)) return s;
    }
    return SEED_STYLES[0];
  }

  getGoal(idOrAlias) {
    const key = String(idOrAlias || '').trim();
    if (this._goals.has(key)) return this._goals.get(key);
    for (const g of this._goals.values()) {
      if (g.name.includes(key) || key.includes(g.id)) return g;
    }
    return SEED_GOALS[0];
  }

  getFocus(idOrAlias) {
    const key = String(idOrAlias || '').trim();
    if (this._focuses.has(key)) return this._focuses.get(key);
    for (const f of this._focuses.values()) {
      if (f.name.includes(key) || key.includes(f.id)) return f;
    }
    return SEED_FOCUSES[0];
  }

  getHook(idOrAlias) {
    const key = String(idOrAlias || '').trim();
    if (this._hooks.has(key)) return this._hooks.get(key);
    for (const h of this._hooks.values()) {
      if (h.name.includes(key) || h.type === key) return h;
    }
    return SEED_HOOKS[0];
  }

  /**
   * 将用户选择与上下文解析为完整的 CompositionSpec 规范对象
   * @param {Object} input 包含 5 维选择及可选高级覆盖参数
   * @returns {Object} 包含全部 14 维规范的 CompositionSpec
   */
  resolveCompositionSpec(input = {}) {
    const raw = input || {};

    const genre = this.getGenre(raw.genre || raw.genreId);
    const style = this.getStyle(raw.style || raw.styleId);
    const chapterGoal = this.getGoal(raw.chapterGoal || raw.goalId);
    const focus = this.getFocus(raw.focus || raw.focusId);
    const hook = this.getHook(raw.hook || raw.hookId);

    // 系统自动推导 7 维参数
    const derived = {
      storyEngine: String(raw.storyEngine || (genre.commonStoryEngines[0] || 'growth_clash')),
      pace: String(raw.pace || (chapterGoal.id === 'conflict_push' ? 'fast' : 'moderate')),
      informationFlow: String(raw.informationFlow || (chapterGoal.id === 'info_reveal' ? 'partial_reveal' : 'normal')),
      conflictMode: String(raw.conflictMode || (focus.id === 'dialogue_game' ? 'verbal_sparring' : 'physical_confrontation')),
      emotionArc: String(raw.emotionArc || (chapterGoal.id === 'conflict_push' ? 'tension_escalation' : 'steady_curiosity')),
      narrativePov: String(raw.narrativePov || raw.pov || 'third_limited'),
      readerPromise: Array.isArray(raw.readerPromise) ? raw.readerPromise : genre.readerPromises,
      continuity: typeof raw.continuity === 'object' && raw.continuity !== null ? { ...raw.continuity } : {},
      creativity: String(raw.creativity || 'balanced')
    };

    // 局部文风调制
    const localStyleModulation = raw.localStyleModulation || (chapterGoal.id === 'conflict_push' ? {
      shortSentenceRatio: +0.10,
      averageSentenceLength: -3.0,
      emotionalIntensity: +0.15
    } : null);

    return Object.freeze({
      schemaVersion: 'composition-spec-v1',
      genre,
      style,
      chapterGoal,
      focus,
      hook,
      stateDelta: raw.stateDelta ? raw.stateDelta : chapterGoal.defaultStateDelta,
      localStyleModulation,
      targetChars: Number(raw.targetChars) || 3000,
      userInstruction: String(raw.userInstruction || raw.prompt || ''),
      derived,
      overrides: typeof raw.overrides === 'object' && raw.overrides !== null ? { ...raw.overrides } : {}
    });
  }
}

const defaultProfileRegistry = new ProfileRegistry();

module.exports = {
  ProfileRegistry,
  defaultProfileRegistry,
  SEED_GENRES,
  SEED_STYLES,
  SEED_GOALS,
  SEED_FOCUSES,
  SEED_HOOKS
};
