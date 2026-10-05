'use strict';

/**
 * @file reader-promise-registry.js
 * 读者阅读契约 (Reader Promise) 独立注册中心与种子库
 * 
 * 核心功能：
 * 1. 提供 standalone first-class 读者期待注册中心 ReaderPromiseRegistry；
 * 2. 预装 9 个通用正交读者阅读契约实体，将阅读快感期待与题材刻板印象解耦；
 * 3. 支持字符串 ID、别名、中文名或实体对象的灵活解析与集合解析 (resolveReaderPromises)。
 */

const { createReaderPromiseProfile } = require('../models/data-schemas');

let ProfileResolutionError;
try {
  ({ ProfileResolutionError } = require('./profile-registry'));
} catch (_) {}

if (!ProfileResolutionError) {
  ProfileResolutionError = class ProfileResolutionError extends Error {
    constructor(message, details = {}) {
      super(message);
      this.name = 'ProfileResolutionError';
      this.dimension = String(details.dimension || 'readerPromises');
      this.query = String(details.query || '');
      this.available = Array.isArray(details.available) ? details.available : [];
      if (Error.captureStackTrace) {
        Error.captureStackTrace(this, ProfileResolutionError);
      }
    }
  };
}

const SEED_READER_PROMISES = [
  createReaderPromiseProfile({
    id: 'underdog_triumph',
    name: '以弱胜强',
    coreExpectation: '以弱胜强，防守反击与绝地逆袭',
    payoffPacing: 'rhythmic_ladder',
    gapGenerationMechanism: 'higher_realm_threat_emerges',
    emotionalPayoff: 'cathartic_triumph',
    metadata: {
      aliases: ['以弱胜强', '弱胜强', '逆袭']
    }
  }),
  createReaderPromiseProfile({
    id: 'cautious_growth',
    name: '谨慎藏拙带来的安全感',
    coreExpectation: '谨慎谋划发育，规避无谓风险',
    payoffPacing: 'steady_accumulation',
    gapGenerationMechanism: 'hidden_trump_card_accumulated',
    emotionalPayoff: 'secure_relief',
    metadata: {
      aliases: ['谨慎藏拙带来的安全感', '谨慎藏拙', '安全感']
    }
  }),
  createReaderPromiseProfile({
    id: 'solid_development',
    name: '扎实发育',
    coreExpectation: '资源与战力脚踏实地提升，不虚浮冒进',
    payoffPacing: 'steady_accumulation',
    gapGenerationMechanism: 'next_tier_resource_bottleneck',
    emotionalPayoff: 'satisfying_mastery',
    metadata: {
      aliases: ['扎实发育', '脚踏实地']
    }
  }),
  createReaderPromiseProfile({
    id: 'defense_counterattack',
    name: '防守反击',
    coreExpectation: '忍辱蓄力，关键时刻一击致命破局',
    payoffPacing: 'rhythmic_ladder',
    gapGenerationMechanism: 'counter_strike_triggers_retaliation',
    emotionalPayoff: 'cathartic_release',
    metadata: {
      aliases: ['防守反击', '后发制人']
    }
  }),
  createReaderPromiseProfile({
    id: 'clue_closure',
    name: '线索闭环',
    coreExpectation: '前置细节与物证形成严密闭环因果',
    payoffPacing: 'cyclic_wave',
    gapGenerationMechanism: 'closed_loop_unveils_broader_conspiracy',
    emotionalPayoff: 'intellectual_clarity',
    metadata: {
      aliases: ['线索闭环', '伏笔闭环']
    }
  }),
  createReaderPromiseProfile({
    id: 'rational_intelligence',
    name: '智商在线',
    coreExpectation: '博弈各方逻辑严密，严禁机械降智',
    payoffPacing: 'cyclic_wave',
    gapGenerationMechanism: 'intelligent_adversary_adapts',
    emotionalPayoff: 'strategic_admiration',
    metadata: {
      aliases: ['逻辑严密', '智商在线', '高智商博弈']
    }
  }),
  createReaderPromiseProfile({
    id: 'truth_uncover',
    name: '水落石出',
    coreExpectation: '抽丝剥茧还原真相核心',
    payoffPacing: 'cyclic_wave',
    gapGenerationMechanism: 'truth_implicates_higher_power',
    emotionalPayoff: 'revelation_shock',
    metadata: {
      aliases: ['水落石出', '逼近真相', '逼近悬案真相', '真凶浮现']
    }
  }),
  createReaderPromiseProfile({
    id: 'grand_vision',
    name: '宏大视野与科学敬畏感',
    coreExpectation: '深空尺度与自洽物理铁律震撼',
    payoffPacing: 'long_fuse',
    gapGenerationMechanism: 'cosmic_scale_enigma',
    emotionalPayoff: 'sublime_awe',
    metadata: {
      aliases: ['宏大视野', '科学敬畏感', '硬逻辑自洽', '宏大视野与科学敬畏感']
    }
  }),
  createReaderPromiseProfile({
    id: 'political_chess',
    name: '政治推演与借力打力',
    coreExpectation: '大势所趋与阳谋无解格局',
    payoffPacing: 'steady_spiral',
    gapGenerationMechanism: 'factional_balance_destabilized',
    emotionalPayoff: 'cerebral_gratification',
    metadata: {
      aliases: ['格局厚重', '政治推演', '借力打力', '阳谋无解', '政治推演与借力打力']
    }
  })
];

class ReaderPromiseRegistry {
  constructor(options = {}) {
    this._promises = new Map();
    const seeds = Array.isArray(options.seeds) ? options.seeds : SEED_READER_PROMISES;
    for (const promise of seeds) {
      this.registerReaderPromise(promise);
    }
  }

  registerReaderPromise(profile) {
    if (!profile) throw new TypeError('ReaderPromise profile is required');
    const validated = (profile.schemaVersion === 'reader-promise-profile-v1')
      ? profile
      : createReaderPromiseProfile(profile);
    this._promises.set(validated.id, validated);
    return this;
  }

  getReaderPromise(idOrAlias, options = {}) {
    const strict = Boolean(options && options.strict);
    const key = String(idOrAlias || '').trim();

    if (!key) {
      if (strict) {
        throw new ProfileResolutionError('Cannot resolve reader promise profile for empty query', {
          dimension: 'readerPromises',
          query: idOrAlias,
          available: Array.from(this._promises.keys())
        });
      }
      return null;
    }

    if (this._promises.has(key)) return this._promises.get(key);

    for (const p of this._promises.values()) {
      if (p.name === key || p.id === key) return p;
      if (Array.isArray(p.metadata?.aliases) && p.metadata.aliases.includes(key)) return p;
    }

    for (const p of this._promises.values()) {
      if (p.name.includes(key) || key.includes(p.name)) return p;
      if (Array.isArray(p.metadata?.aliases) && p.metadata.aliases.some(a => a.includes(key) || key.includes(a))) return p;
    }

    if (strict) {
      throw new ProfileResolutionError(`Unregistered reader promise profile query: "${key}"`, {
        dimension: 'readerPromises',
        query: key,
        available: Array.from(this._promises.keys())
      });
    }

    return null;
  }

  resolveReaderPromises(listOrItem, options = {}) {
    const rawList = Array.isArray(listOrItem) ? listOrItem : (listOrItem ? [listOrItem] : []);
    const resolved = [];
    for (const item of rawList) {
      if (item && typeof item === 'object') {
        if (item.schemaVersion === 'reader-promise-profile-v1') {
          resolved.push(item);
        } else if (item.id && item.name) {
          const validated = createReaderPromiseProfile(item);
          resolved.push(validated);
        } else if (item.id || item.name) {
          const found = this.getReaderPromise(item.id || item.name, options);
          if (found) {
            resolved.push(found);
          } else if (options && options.strict) {
            throw new ProfileResolutionError(`Unregistered reader promise query: "${item.id || item.name}"`, {
              dimension: 'readerPromises',
              query: item.id || item.name,
              available: Array.from(this._promises.keys())
            });
          } else {
            const adHoc = createReaderPromiseProfile({
              id: String(item.id || `adhoc_${Date.now()}`),
              name: String(item.name || item.id),
              coreExpectation: String(item.coreExpectation || item.name || item.id)
            });
            resolved.push(adHoc);
          }
        }
      } else if (typeof item === 'string') {
        const found = this.getReaderPromise(item, options);
        if (found) {
          resolved.push(found);
        } else if (options && options.strict) {
          throw new ProfileResolutionError(`Unregistered reader promise query: "${item}"`, {
            dimension: 'readerPromises',
            query: item,
            available: Array.from(this._promises.keys())
          });
        } else {
          const adHoc = createReaderPromiseProfile({
            id: `adhoc_${Buffer.from(item).toString('hex').slice(0, 12)}`,
            name: item,
            coreExpectation: item
          });
          resolved.push(adHoc);
        }
      }
    }
    return resolved;
  }

  hasReaderPromise(idOrAlias) {
    return this.getReaderPromise(idOrAlias) !== null;
  }

  listReaderPromises() {
    return Array.from(this._promises.values());
  }
}

const defaultReaderPromiseRegistry = new ReaderPromiseRegistry();

module.exports = {
  ReaderPromiseRegistry,
  defaultReaderPromiseRegistry,
  SEED_READER_PROMISES,
  ProfileResolutionError
};
