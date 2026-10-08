'use strict';

/**
 * @file profile-registry.js
 * 创作 Profile 统一注册中心与解析器
 * 
 * 核心功能：
 * 1. 预装纯正正交的种子 Profile 资产（题材无角色锁定、文风量化、目标含 State Delta、侧重含预算、钩子含兑现期）；
 * 2. 挂载 standalone first-class 故事引擎 (StoryEngineRegistry) 与读者契约 (ReaderPromiseRegistry) 注册中心；
 * 3. 严格解析契约：消除静默回退，支持 ProfileResolutionError 阻断与显式未决描述符；
 * 4. 全维 Profile 模式追踪 (profileModes: explicit / inferred / locked / adaptive) 与 provenance 元数据存证。
 */

class ProfileResolutionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ProfileResolutionError';
    this.dimension = String(details.dimension || 'unknown');
    this.query = String(details.query || '');
    this.available = Array.isArray(details.available) ? details.available : [];
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ProfileResolutionError);
    }
  }
}

module.exports.ProfileResolutionError = ProfileResolutionError;

const { createGenreProfile } = require('./genre-profile');
const { createStyleProfile } = require('./style-profile');
const { createChapterGoalProfile } = require('./chapter-goal-profile');
const { createFocusProfile } = require('./focus-profile');
const { createHookProfile } = require('./hook-profile');
const { StoryEngineRegistry, defaultStoryEngineRegistry, SEED_STORY_ENGINES } = require('./story-engine-registry');
const { ReaderPromiseRegistry, defaultReaderPromiseRegistry, SEED_READER_PROMISES } = require('./reader-promise-registry');

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
  constructor(options = {}) {
    this._genres = new Map();
    this._styles = new Map();
    this._goals = new Map();
    this._focuses = new Map();
    this._hooks = new Map();

    this._storyEngineRegistry = new StoryEngineRegistry({
      seeds: options.storyEngines || SEED_STORY_ENGINES
    });
    this._readerPromiseRegistry = new ReaderPromiseRegistry({
      seeds: options.readerPromises || SEED_READER_PROMISES
    });

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

  // 挂载 StoryEngineRegistry 方法
  registerStoryEngine(profile) {
    return this._storyEngineRegistry.registerStoryEngine(profile);
  }
  getStoryEngine(idOrAlias, options = {}) {
    return this._storyEngineRegistry.getStoryEngine(idOrAlias, options);
  }
  hasStoryEngine(idOrAlias) {
    return this._storyEngineRegistry.hasStoryEngine(idOrAlias);
  }
  listStoryEngines() {
    return this._storyEngineRegistry.listStoryEngines();
  }

  // 挂载 ReaderPromiseRegistry 方法
  registerReaderPromise(profile) {
    return this._readerPromiseRegistry.registerReaderPromise(profile);
  }
  getReaderPromise(idOrAlias, options = {}) {
    return this._readerPromiseRegistry.getReaderPromise(idOrAlias, options);
  }
  resolveReaderPromises(listOrItem, options = {}) {
    return this._readerPromiseRegistry.resolveReaderPromises(listOrItem, options);
  }
  hasReaderPromise(idOrAlias) {
    return this._readerPromiseRegistry.hasReaderPromise(idOrAlias);
  }
  listReaderPromises() {
    return this._readerPromiseRegistry.listReaderPromises();
  }

  getGenre(idOrAlias, options = {}) {
    const strict = Boolean(options && options.strict);
    const key = String(idOrAlias || '').trim();

    if (!key) {
      if (strict) {
        throw new ProfileResolutionError('Cannot resolve genre profile for empty query', {
          dimension: 'genre',
          query: idOrAlias,
          available: Array.from(this._genres.keys())
        });
      }
      return null;
    }

    if (this._genres.has(key)) return this._genres.get(key);

    for (const g of this._genres.values()) {
      if (g.name === key || g.id === key || g.family === key) return g;
    }
    for (const g of this._genres.values()) {
      if (g.name.includes(key) || g.id.includes(key) || key.includes(g.name) || key.includes(g.id) || key.includes(g.family) || g.family.includes(key)) return g;
    }

    if (strict) {
      throw new ProfileResolutionError(`Unregistered genre profile query: "${key}"`, {
        dimension: 'genre',
        query: key,
        available: Array.from(this._genres.keys())
      });
    }

    return null;
  }

  getStyle(idOrAlias, options = {}) {
    const strict = Boolean(options && options.strict);
    const key = String(idOrAlias || '').trim();

    if (!key) {
      if (strict) {
        throw new ProfileResolutionError('Cannot resolve style profile for empty query', {
          dimension: 'style',
          query: idOrAlias,
          available: Array.from(this._styles.keys())
        });
      }
      return null;
    }

    if (this._styles.has(key)) return this._styles.get(key);

    for (const s of this._styles.values()) {
      if (s.name === key || s.id === key) return s;
    }
    for (const s of this._styles.values()) {
      if (s.name.includes(key) || s.id.includes(key) || key.includes(s.name) || key.includes(s.id)) return s;
    }

    if (strict) {
      throw new ProfileResolutionError(`Unregistered style profile query: "${key}"`, {
        dimension: 'style',
        query: key,
        available: Array.from(this._styles.keys())
      });
    }

    return null;
  }

  getGoal(idOrAlias, options = {}) {
    const strict = Boolean(options && options.strict);
    const key = String(idOrAlias || '').trim();

    if (!key) {
      if (strict) {
        throw new ProfileResolutionError('Cannot resolve goal profile for empty query', {
          dimension: 'goal',
          query: idOrAlias,
          available: Array.from(this._goals.keys())
        });
      }
      return null;
    }

    if (this._goals.has(key)) return this._goals.get(key);

    for (const g of this._goals.values()) {
      if (g.name === key || g.id === key) return g;
    }
    for (const g of this._goals.values()) {
      if (g.name.includes(key) || g.id.includes(key) || key.includes(g.name) || key.includes(g.id)) return g;
    }

    if (strict) {
      throw new ProfileResolutionError(`Unregistered goal profile query: "${key}"`, {
        dimension: 'goal',
        query: key,
        available: Array.from(this._goals.keys())
      });
    }

    return null;
  }

  getFocus(idOrAlias, options = {}) {
    const strict = Boolean(options && options.strict);
    const key = String(idOrAlias || '').trim();

    if (!key) {
      if (strict) {
        throw new ProfileResolutionError('Cannot resolve focus profile for empty query', {
          dimension: 'focus',
          query: idOrAlias,
          available: Array.from(this._focuses.keys())
        });
      }
      return null;
    }

    if (this._focuses.has(key)) return this._focuses.get(key);

    for (const f of this._focuses.values()) {
      if (f.name === key || f.id === key) return f;
    }
    for (const f of this._focuses.values()) {
      if (f.name.includes(key) || f.id.includes(key) || key.includes(f.name) || key.includes(f.id)) return f;
    }

    if (strict) {
      throw new ProfileResolutionError(`Unregistered focus profile query: "${key}"`, {
        dimension: 'focus',
        query: key,
        available: Array.from(this._focuses.keys())
      });
    }

    return null;
  }

  getHook(idOrAlias, options = {}) {
    const strict = Boolean(options && options.strict);
    const key = String(idOrAlias || '').trim();

    if (!key) {
      if (strict) {
        throw new ProfileResolutionError('Cannot resolve hook profile for empty query', {
          dimension: 'hook',
          query: idOrAlias,
          available: Array.from(this._hooks.keys())
        });
      }
      return null;
    }

    if (this._hooks.has(key)) return this._hooks.get(key);

    for (const h of this._hooks.values()) {
      if (h.name === key || h.id === key || h.type === key) return h;
    }
    for (const h of this._hooks.values()) {
      if (h.name.includes(key) || h.id.includes(key) || key.includes(h.name) || key.includes(h.id) || key.includes(h.type) || h.type.includes(key)) return h;
    }

    if (strict) {
      throw new ProfileResolutionError(`Unregistered hook profile query: "${key}"`, {
        dimension: 'hook',
        query: key,
        available: Array.from(this._hooks.keys())
      });
    }

    return null;
  }

  /**
   * 将用户选择与上下文解析为完整的 CompositionSpec 规范对象
   * @param {Object} input 包含 5 维选择及可选高级覆盖参数
   * @param {Object} [options] 解析选项 (strict, allowUnresolved 等)
   * @returns {Object} 包含全部 14 维规范与 7 维 profileModes/provenance 的 CompositionSpec
   */
  resolveCompositionSpec(input = {}, options = {}) {
    const raw = input || {};
    const opts = { ...(raw.options || {}), ...(options || {}) };
    const strict = Boolean(opts.strict);
    const allowUnresolved = Boolean(opts.allowUnresolved);

    // 辅助解析模式判定 (explicit, inferred, locked, adaptive, unresolved)
    const determineMode = (dim, wasSupplied) => {
      if (raw.profileModes && raw.profileModes[dim]) {
        return raw.profileModes[dim];
      }
      if (Array.isArray(raw.lockedDimensions) && raw.lockedDimensions.includes(dim)) {
        return 'locked';
      }
      if (Array.isArray(raw.adaptiveDimensions) && raw.adaptiveDimensions.includes(dim)) {
        return 'adaptive';
      }
      return wasSupplied ? 'explicit' : 'inferred';
    };

    // 1. 题材 Genre
    const genreQuery = raw.genre !== undefined ? raw.genre : raw.genreId;
    const genreSupplied = genreQuery !== undefined && genreQuery !== null && genreQuery !== '';
    let genreMode = determineMode('genre', genreSupplied);
    let genre = null;

    if (genreSupplied) {
      if (typeof genreQuery === 'object' && genreQuery !== null && genreQuery.id) {
        genre = genreQuery;
      } else {
        genre = this.getGenre(genreQuery);
        if (!genre) {
          if (allowUnresolved) {
            genre = { resolved: false, id: null, query: String(genreQuery), error: 'Unregistered profile', mode: 'unresolved', reason: 'unregistered_profile' };
            genreMode = 'unresolved';
          } else {
            throw new ProfileResolutionError(`Unregistered genre profile query: "${genreQuery}"`, {
              dimension: 'genre',
              query: String(genreQuery),
              available: Array.from(this._genres.keys())
            });
          }
        }
      }
    } else {
      if (strict) {
        throw new ProfileResolutionError('Genre profile is required in strict mode', {
          dimension: 'genre',
          query: '',
          available: Array.from(this._genres.keys())
        });
      }
      if (allowUnresolved) {
        genre = { id: null, name: '未指定题材', resolved: false, mode: 'unresolved', reason: 'genre_not_selected' };
        genreMode = 'unresolved';
      } else {
        genre = SEED_GENRES[0];
        if (genreMode === 'explicit') genreMode = 'inferred';
      }
    }

    // 2. 文风 Style
    const styleQuery = raw.style !== undefined ? raw.style : raw.styleId;
    const styleSupplied = styleQuery !== undefined && styleQuery !== null && styleQuery !== '';
    let styleMode = determineMode('style', styleSupplied);
    let style = null;

    if (styleSupplied) {
      if (typeof styleQuery === 'object' && styleQuery !== null && styleQuery.id) {
        style = styleQuery;
      } else {
        style = this.getStyle(styleQuery);
        if (!style) {
          if (allowUnresolved) {
            style = { resolved: false, id: null, query: String(styleQuery), error: 'Unregistered profile', mode: 'unresolved', reason: 'unregistered_profile' };
            styleMode = 'unresolved';
          } else {
            throw new ProfileResolutionError(`Unregistered style profile query: "${styleQuery}"`, {
              dimension: 'style',
              query: String(styleQuery),
              available: Array.from(this._styles.keys())
            });
          }
        }
      }
    } else {
      if (strict) {
        throw new ProfileResolutionError('Style profile is required in strict mode', {
          dimension: 'style',
          query: '',
          available: Array.from(this._styles.keys())
        });
      }
      if (allowUnresolved) {
        style = { id: null, name: '未指定文风', resolved: false, mode: 'unresolved', reason: 'style_not_selected' };
        styleMode = 'unresolved';
      } else {
        style = SEED_STYLES[0];
        if (styleMode === 'explicit') styleMode = 'inferred';
      }
    }

    // 3. 章节目标 Goal / ChapterGoal
    const goalQuery = raw.chapterGoal !== undefined ? raw.chapterGoal : (raw.goal !== undefined ? raw.goal : raw.goalId);
    const goalSupplied = goalQuery !== undefined && goalQuery !== null && goalQuery !== '';
    let goalMode = raw.profileModes?.goal || raw.profileModes?.chapterGoal || determineMode('goal', goalSupplied);
    let chapterGoal = null;

    if (goalSupplied) {
      if (typeof goalQuery === 'object' && goalQuery !== null && goalQuery.id) {
        chapterGoal = goalQuery;
      } else {
        chapterGoal = this.getGoal(goalQuery);
        if (!chapterGoal) {
          if (allowUnresolved) {
            chapterGoal = { resolved: false, id: null, query: String(goalQuery), error: 'Unregistered profile', mode: 'unresolved', reason: 'unregistered_profile' };
            goalMode = 'unresolved';
          } else {
            throw new ProfileResolutionError(`Unregistered goal profile query: "${goalQuery}"`, {
              dimension: 'goal',
              query: String(goalQuery),
              available: Array.from(this._goals.keys())
            });
          }
        }
      }
    } else {
      if (strict) {
        throw new ProfileResolutionError('Goal profile is required in strict mode', {
          dimension: 'goal',
          query: '',
          available: Array.from(this._goals.keys())
        });
      }
      if (allowUnresolved) {
        chapterGoal = { id: null, name: '未指定章节目标', resolved: false, mode: 'unresolved', reason: 'goal_not_selected' };
        goalMode = 'unresolved';
      } else {
        chapterGoal = SEED_GOALS[0];
        if (goalMode === 'explicit') goalMode = 'inferred';
      }
    }

    // 4. 镜头侧重 Focus
    const focusQuery = raw.focus !== undefined ? raw.focus : raw.focusId;
    const focusSupplied = focusQuery !== undefined && focusQuery !== null && focusQuery !== '';
    let focusMode = determineMode('focus', focusSupplied);
    let focus = null;

    if (focusSupplied) {
      if (typeof focusQuery === 'object' && focusQuery !== null && focusQuery.id) {
        focus = focusQuery;
      } else {
        focus = this.getFocus(focusQuery);
        if (!focus) {
          if (allowUnresolved) {
            focus = { resolved: false, id: null, query: String(focusQuery), error: 'Unregistered profile', mode: 'unresolved', reason: 'unregistered_profile' };
            focusMode = 'unresolved';
          } else {
            throw new ProfileResolutionError(`Unregistered focus profile query: "${focusQuery}"`, {
              dimension: 'focus',
              query: String(focusQuery),
              available: Array.from(this._focuses.keys())
            });
          }
        }
      }
    } else {
      if (strict) {
        throw new ProfileResolutionError('Focus profile is required in strict mode', {
          dimension: 'focus',
          query: '',
          available: Array.from(this._focuses.keys())
        });
      }
      if (allowUnresolved) {
        focus = { id: null, name: '未指定侧重', resolved: false, mode: 'unresolved', reason: 'focus_not_selected' };
        focusMode = 'unresolved';
      } else {
        focus = SEED_FOCUSES[0];
        if (focusMode === 'explicit') focusMode = 'inferred';
      }
    }

    // 5. 钩子 Hook
    const hookQuery = raw.hook !== undefined ? raw.hook : raw.hookId;
    const hookSupplied = hookQuery !== undefined && hookQuery !== null && hookQuery !== '';
    let hookMode = determineMode('hook', hookSupplied);
    let hook = null;

    if (hookSupplied) {
      if (typeof hookQuery === 'object' && hookQuery !== null && hookQuery.id) {
        hook = hookQuery;
      } else {
        hook = this.getHook(hookQuery);
        if (!hook) {
          if (allowUnresolved) {
            hook = { resolved: false, id: null, query: String(hookQuery), error: 'Unregistered profile', mode: 'unresolved', reason: 'unregistered_profile' };
            hookMode = 'unresolved';
          } else {
            throw new ProfileResolutionError(`Unregistered hook profile query: "${hookQuery}"`, {
              dimension: 'hook',
              query: String(hookQuery),
              available: Array.from(this._hooks.keys())
            });
          }
        }
      }
    } else {
      if (strict) {
        throw new ProfileResolutionError('Hook profile is required in strict mode', {
          dimension: 'hook',
          query: '',
          available: Array.from(this._hooks.keys())
        });
      }
      if (allowUnresolved) {
        hook = { id: null, name: '未指定钩子', resolved: false, mode: 'unresolved', reason: 'hook_not_selected' };
        hookMode = 'unresolved';
      } else {
        hook = SEED_HOOKS[0];
        if (hookMode === 'explicit') hookMode = 'inferred';
      }
    }

    // 6. 故事驱动引擎 StoryEngine (First-Class)
    const engineQuery = raw.storyEngine !== undefined ? raw.storyEngine : raw.storyEngineId;
    const engineSupplied = engineQuery !== undefined && engineQuery !== null && engineQuery !== '';
    let engineMode = determineMode('storyEngine', engineSupplied);
    let storyEngine = null;

    if (engineSupplied) {
      if (typeof engineQuery === 'object' && engineQuery !== null && engineQuery.id) {
        storyEngine = engineQuery;
      } else {
        storyEngine = this.getStoryEngine(engineQuery);
        if (!storyEngine) {
          if (allowUnresolved) {
            storyEngine = { resolved: false, query: String(engineQuery), error: 'Unregistered profile' };
            engineMode = 'unresolved';
          } else {
            throw new ProfileResolutionError(`Unregistered story engine profile query: "${engineQuery}"`, {
              dimension: 'storyEngine',
              query: String(engineQuery),
              available: this.listStoryEngines().map(e => e.id)
            });
          }
        }
      }
    } else {
      const inferredId = (genre && Array.isArray(genre.commonStoryEngines) && genre.commonStoryEngines[0]) || 'growth_clash';
      storyEngine = this.getStoryEngine(inferredId) || { id: inferredId, name: inferredId };
      if (engineMode === 'explicit') engineMode = 'inferred';
    }

    // 7. 读者阅读契约 ReaderPromises (First-Class)
    const promisesQuery = raw.readerPromises !== undefined ? raw.readerPromises : raw.readerPromise;
    const promisesSupplied = promisesQuery !== undefined && promisesQuery !== null && (Array.isArray(promisesQuery) ? promisesQuery.length > 0 : Boolean(promisesQuery));
    let promisesMode = raw.profileModes?.readerPromises || raw.profileModes?.readerPromise || determineMode('readerPromises', promisesSupplied);
    let readerPromises = [];

    if (promisesSupplied) {
      try {
        readerPromises = this.resolveReaderPromises(promisesQuery, { strict: !allowUnresolved });
      } catch (err) {
        if (allowUnresolved) {
          readerPromises = [{ resolved: false, query: promisesQuery, error: err.message }];
          promisesMode = 'unresolved';
        } else {
          throw err;
        }
      }
    } else {
      const genrePromises = (genre && Array.isArray(genre.readerPromises)) ? genre.readerPromises : [];
      readerPromises = this.resolveReaderPromises(genrePromises, { strict: false });
      if (promisesMode === 'explicit') promisesMode = 'inferred';
    }

    // 归一化 profileModes（含别名映射）
    const profileModes = Object.freeze({
      genre: genreMode,
      style: styleMode,
      goal: goalMode,
      chapterGoal: goalMode,
      focus: focusMode,
      hook: hookMode,
      storyEngine: engineMode,
      readerPromises: promisesMode,
      readerPromise: promisesMode
    });

    const provenance = Object.freeze({
      profileModes,
      resolvedAt: new Date().toISOString(),
      registryVersion: 'composition-profile-registry-v2'
    });

    // 系统自动推导 7 维参数（保留向后兼容）
    const derived = {
      storyEngine: typeof storyEngine === 'object' && storyEngine !== null
        ? (storyEngine.id || storyEngine.name || 'growth_clash')
        : String(raw.storyEngine || (genre?.commonStoryEngines?.[0] || 'growth_clash')),
      pace: String(raw.pace || (chapterGoal?.id === 'conflict_push' ? 'fast' : 'moderate')),
      informationFlow: String(raw.informationFlow || (chapterGoal?.id === 'info_reveal' ? 'partial_reveal' : 'normal')),
      conflictMode: String(raw.conflictMode || (focus?.id === 'dialogue_game' ? 'verbal_sparring' : 'physical_confrontation')),
      emotionArc: String(raw.emotionArc || (chapterGoal?.id === 'conflict_push' ? 'tension_escalation' : 'steady_curiosity')),
      narrativePov: String(raw.narrativePov || raw.pov || 'third_limited'),
      readerPromise: Array.isArray(readerPromises) && readerPromises.length > 0
        ? readerPromises.map(p => p.name || p.id || String(p))
        : (Array.isArray(raw.readerPromise) ? raw.readerPromise : (genre?.readerPromises || [])),
      continuity: typeof raw.continuity === 'object' && raw.continuity !== null ? { ...raw.continuity } : {},
      creativity: String(raw.creativity || 'balanced')
    };

    // 局部文风调制
    const localStyleModulation = raw.localStyleModulation || (chapterGoal?.id === 'conflict_push' ? {
      shortSentenceRatio: +0.10,
      averageSentenceLength: -3.0,
      emotionalIntensity: +0.15
    } : null);

    return Object.freeze({
      schemaVersion: 'composition-spec-v1',
      genre,
      style,
      chapterGoal,
      goal: chapterGoal,
      focus,
      hook,
      storyEngine,
      readerPromises,
      profileModes,
      provenance,
      stateDelta: raw.stateDelta ? raw.stateDelta : (chapterGoal?.defaultStateDelta || null),
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
  ProfileResolutionError,
  SEED_GENRES,
  SEED_STYLES,
  SEED_GOALS,
  SEED_FOCUSES,
  SEED_HOOKS,
  StoryEngineRegistry,
  defaultStoryEngineRegistry,
  SEED_STORY_ENGINES,
  ReaderPromiseRegistry,
  defaultReaderPromiseRegistry,
  SEED_READER_PROMISES
};
