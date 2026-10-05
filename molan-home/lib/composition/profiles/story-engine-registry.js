'use strict';

/**
 * @file story-engine-registry.js
 * 故事引擎 (Story Engine) 独立注册中心与种子库
 * 
 * 核心功能：
 * 1. 提供 standalone first-class 故事引擎注册中心 StoryEngineRegistry；
 * 2. 预装 10 个通用正交种子故事引擎，彻底解耦故事驱动力与题材刻板印象；
 * 3. 支持严格模式查询与自定义引擎动态热注册。
 */

const { createStoryEngineProfile } = require('../models/data-schemas');

let ProfileResolutionError;
try {
  ({ ProfileResolutionError } = require('./profile-registry'));
} catch (_) {}

if (!ProfileResolutionError) {
  ProfileResolutionError = class ProfileResolutionError extends Error {
    constructor(message, details = {}) {
      super(message);
      this.name = 'ProfileResolutionError';
      this.dimension = String(details.dimension || 'storyEngine');
      this.query = String(details.query || '');
      this.available = Array.isArray(details.available) ? details.available : [];
      if (Error.captureStackTrace) {
        Error.captureStackTrace(this, ProfileResolutionError);
      }
    }
  };
}

const SEED_STORY_ENGINES = [
  createStoryEngineProfile({
    id: 'resource_competition',
    name: '资源争夺引擎',
    driveMechanism: 'resource_building',
    corePacingRhythm: 'steady_spiral',
    typicalObstacles: ['资源垄断', '同侪竞争', '黑市博弈', '规矩压制'],
    primaryPayoffType: 'resource_accumulation',
    forbiddenTropes: ['毫无代价天降神物', '对手无脑赠送资产'],
    metadata: {
      description: '围绕核心生存/修行/经济资源的获取与垄断展开的稳健推进引擎'
    }
  }),
  createStoryEngineProfile({
    id: 'survival_evolution',
    name: '极限求生进化引擎',
    driveMechanism: 'survival',
    corePacingRhythm: 'burst_release',
    typicalObstacles: ['生死危机', '严苛环境', '掠食者追杀', '生机断绝'],
    primaryPayoffType: 'survival_breakthrough',
    forbiddenTropes: ['生死关头机械降神', '敌人突然因话多被反杀'],
    metadata: {
      description: '在不可逆极限压力逼迫下的爆发式生存蜕变'
    }
  }),
  createStoryEngineProfile({
    id: 'mystery_unravelling',
    name: '悬疑解构引擎',
    driveMechanism: 'mystery',
    corePacingRhythm: 'slow_burn',
    typicalObstacles: ['虚假线索', '证人遇害', '权势封口', '认知误区'],
    primaryPayoffType: 'truth_reveal',
    forbiddenTropes: ['主角凭空未卜先知', '凶手最后毫无伏笔突兀现身'],
    metadata: {
      description: '抽丝剥茧还原真相核心的递进式解谜引擎'
    }
  }),
  createStoryEngineProfile({
    id: 'cat_and_mouse',
    name: '猫鼠博弈引擎',
    driveMechanism: 'competition',
    corePacingRhythm: 'burst_release',
    typicalObstacles: ['追捕逼近', '藏匿破绽', '情报反制', '心理试探'],
    primaryPayoffType: 'tactical_outsmart',
    forbiddenTropes: ['降智对手', '主角强行隐身无视逻辑'],
    metadata: {
      description: '攻防身份快速对调的高智商对决引擎'
    }
  }),
  createStoryEngineProfile({
    id: 'exploration',
    name: '未知开拓引擎',
    driveMechanism: 'exploration',
    corePacingRhythm: 'steady_spiral',
    typicalObstacles: ['未知法则', '险恶地界', '补给匮乏', '古代遗迹异变'],
    primaryPayoffType: 'horizon_expansion',
    forbiddenTropes: ['无视恶劣环境如履平地', '古人智商不如狗'],
    metadata: {
      description: '探索宏大未知疆域与法则奥秘的探索发现引擎'
    }
  }),
  createStoryEngineProfile({
    id: 'crisis_mitigation',
    name: '危机化解引擎',
    driveMechanism: 'survival',
    corePacingRhythm: 'burst_release',
    typicalObstacles: ['倒计时危机', '连锁崩塌', '次生灾难', '协作破裂'],
    primaryPayoffType: 'disaster_averted',
    forbiddenTropes: ['按下红按钮一秒解决', '毫无牺牲的廉价胜利'],
    metadata: {
      description: '面对重大毁灭性灾难的拆弹与救赎引擎'
    }
  }),
  createStoryEngineProfile({
    id: 'political_intrigue',
    name: '权谋倾轧引擎',
    driveMechanism: 'conquest',
    corePacingRhythm: 'slow_burn',
    typicalObstacles: ['借刀杀人', '礼法构陷', '党争掣肘', '信任危机'],
    primaryPayoffType: 'power_balance_shift',
    forbiddenTropes: ['帝王高官被一眼说服', '政敌无脑咆哮送人头'],
    metadata: {
      description: '朝堂与门阀之间利益算计与大势借力的权谋引擎'
    }
  }),
  createStoryEngineProfile({
    id: 'dynastic_struggle',
    name: '王朝鼎革引擎',
    driveMechanism: 'conquest',
    corePacingRhythm: 'steady_spiral',
    typicalObstacles: ['天下大势', '门阀割据', '粮草军饷', '民心向背'],
    primaryPayoffType: 'epoch_transition',
    forbiddenTropes: ['一人成军平推天下且无后勤因果', '改朝换代如同儿戏'],
    metadata: {
      description: '改朝换代与乱世争雄的宏大历史推进引擎'
    }
  }),
  createStoryEngineProfile({
    id: 'growth_clash',
    name: '成长碰撞引擎',
    driveMechanism: 'progression',
    corePacingRhythm: 'steady_spiral',
    typicalObstacles: ['阶层壁垒', '试炼磨砺', '理念分歧', '心魔叩问'],
    primaryPayoffType: 'competence_validation',
    forbiddenTropes: ['不劳而获无痛升级', '旁白吹嘘无实打实战绩'],
    metadata: {
      description: '主角与环境力量体系正面碰撞实现阶段跨越的成长引擎'
    }
  }),
  createStoryEngineProfile({
    id: 'revenge_ladder',
    name: '复仇阶梯引擎',
    driveMechanism: 'revenge',
    corePacingRhythm: 'steady_spiral',
    typicalObstacles: ['仇敌势大', '仇恨蒙蔽', '线索断裂', '附带伤害'],
    primaryPayoffType: 'cathartic_reckoning',
    forbiddenTropes: ['圣母原谅灭门仇人', '复仇毫无阻力一击即溃'],
    metadata: {
      description: '步步为营清算旧怨与讨还公道的复仇引擎'
    }
  })
];

class StoryEngineRegistry {
  constructor(options = {}) {
    this._engines = new Map();
    const seeds = Array.isArray(options.seeds) ? options.seeds : SEED_STORY_ENGINES;
    for (const engine of seeds) {
      this.registerStoryEngine(engine);
    }
  }

  registerStoryEngine(profile) {
    if (!profile) throw new TypeError('StoryEngine profile is required');
    const validated = (profile.schemaVersion === 'story-engine-profile-v1')
      ? profile
      : createStoryEngineProfile(profile);
    this._engines.set(validated.id, validated);
    return this;
  }

  getStoryEngine(idOrAlias, options = {}) {
    const strict = Boolean(options && options.strict);
    const key = String(idOrAlias || '').trim();

    if (!key) {
      if (strict) {
        throw new ProfileResolutionError('Cannot resolve story engine profile for empty query', {
          dimension: 'storyEngine',
          query: idOrAlias,
          available: Array.from(this._engines.keys())
        });
      }
      return null;
    }

    if (this._engines.has(key)) return this._engines.get(key);

    for (const e of this._engines.values()) {
      if (e.name === key || e.id === key || e.driveMechanism === key) return e;
    }

    for (const e of this._engines.values()) {
      if (e.name.includes(key) || key.includes(e.name) || key.includes(e.id)) return e;
    }

    if (strict) {
      throw new ProfileResolutionError(`Unregistered story engine profile query: "${key}"`, {
        dimension: 'storyEngine',
        query: key,
        available: Array.from(this._engines.keys())
      });
    }

    return null;
  }

  hasStoryEngine(idOrAlias) {
    return this.getStoryEngine(idOrAlias) !== null;
  }

  listStoryEngines() {
    return Array.from(this._engines.values());
  }
}

const defaultStoryEngineRegistry = new StoryEngineRegistry();

module.exports = {
  StoryEngineRegistry,
  defaultStoryEngineRegistry,
  SEED_STORY_ENGINES,
  ProfileResolutionError
};
