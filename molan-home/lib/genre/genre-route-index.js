'use strict';

/**
 * @file genre-route-index.js
 * ---------------------------------------------------------------------------
 * 题材路由与叙事机制唯一定位索引 (Canonical Genre Route Index)
 *
 * 解决架构核心缺陷：
 * 1. 彻底根除 fObj.routes?.some 脆弱反查失效问题；
 * 2. 作为 family <-> subcategory <-> route <-> sceneType <-> runtime 唯一真源；
 * 3. 完整支持 canonical value 与 legacy value 双向安全映射。
 * ---------------------------------------------------------------------------
 */

const { GENRE_CATALOG } = require('./genre-registry');

/**
 * 完整路由机制注册元表
 */
const ROUTE_DEFINITIONS = [
  // 玄幻修真
  {
    familyId: 'xuanhuan',
    familyTitle: '玄幻修真',
    canonical: 'cautious_survival',
    legacy: 'fanren',
    label: '《凡人修仙传》· 散修生计与谨慎藏拙',
    defaultSceneType: 'action_conflict',
    mechanisms: ['low_profile_cultivation', 'resource_economy', 'risk_first_decision']
  },
  {
    familyId: 'xuanhuan',
    familyTitle: '玄幻修真',
    canonical: 'clan_lineage_sacrifice',
    legacy: 'xuanjian',
    label: '《家族修仙》· 宗族谱系与族运牺牲',
    defaultSceneType: 'narrative',
    mechanisms: ['dynasty_ancestry', 'collective_destiny', 'generation_debt']
  },
  {
    familyId: 'xuanhuan',
    familyTitle: '玄幻修真',
    canonical: 'industrial_cultivation',
    legacy: 'yuanshi',
    label: '《元始法则》· 重型战舰与修真工业',
    defaultSceneType: 'action_conflict',
    mechanisms: ['heavy_formation_engineering', 'institutional_mobilization']
  },
  {
    familyId: 'xuanhuan',
    familyTitle: '玄幻修真',
    canonical: 'ancient_market_mechanic',
    legacy: 'jianzhu',
    label: '《剑主沉浮》· 大荒机关与市井互嵌',
    defaultSceneType: 'dialogue_game',
    mechanisms: ['folk_craftsmanship', 'daily_economy', 'localized_friction']
  },

  // 都市高武
  {
    familyId: 'urban_martial',
    familyTitle: '都市高武',
    canonical: 'official_regulation_tactics',
    legacy: 'urban_grind',
    label: '《以神通之名》· 官方规制与实战攻防',
    defaultSceneType: 'action_conflict',
    mechanisms: ['institutional_audit', 'street_combat_tactics', 'law_pressure']
  },
  {
    familyId: 'urban_martial',
    familyTitle: '都市高武',
    canonical: 'coastal_harvest_fieldwork',
    legacy: 'yucun_1982',
    label: '《重回1982小渔村》· 沿海捕捞与潮汐考据',
    defaultSceneType: 'narrative',
    mechanisms: ['ecological_chronicle', 'empirical_trade', 'family_labor']
  },
  {
    familyId: 'urban_martial',
    familyTitle: '都市高武',
    canonical: 'heavy_industry_pioneering',
    legacy: 'daguo_junken',
    label: '《大国军垦》· 重工拓荒与集体纪律',
    defaultSceneType: 'narrative',
    mechanisms: ['collective_discipline', 'environmental_conquest']
  },

  // 科幻末世
  {
    familyId: 'scifi_apocalypse',
    familyTitle: '科幻末世',
    canonical: 'wasteland_industrial_recovery',
    legacy: 'hard_survival',
    label: '《这游戏也太真实了》· 废土避难所工业复苏',
    defaultSceneType: 'action_conflict',
    mechanisms: ['shelter_resource_grid', 'engineering_bottleneck', 'tech_decay']
  },
  {
    familyId: 'scifi_apocalypse',
    familyTitle: '科幻末世',
    canonical: 'magic_industrial_enlightenment',
    legacy: 'dawn_blade',
    label: '《黎明之剑》· 魔导工业化与深空神明去魅',
    defaultSceneType: 'narrative',
    mechanisms: ['industrial_demystification', 'civil_engineering', 'godhead_logic']
  },
  {
    familyId: 'scifi_apocalypse',
    familyTitle: '科幻末世',
    canonical: 'genetic_deep_space_scale',
    legacy: 'swallow_star',
    label: '《吞噬星空》· 基因武者考核与深空尺度',
    defaultSceneType: 'action_conflict',
    mechanisms: ['biological_breakthrough', 'cosmic_hierarchy']
  },

  // 悬疑惊悚
  {
    familyId: 'suspense',
    familyTitle: '悬疑惊悚',
    canonical: 'river_folk_secrets',
    legacy: 'laoshiren',
    label: '《捞尸人》· 黄河捞尸门道与民俗禁忌',
    defaultSceneType: 'cliffhanger_reveal',
    mechanisms: ['taboo_rules', 'river_folklore', 'psychological_dread']
  },
  {
    familyId: 'suspense',
    familyTitle: '悬疑惊悚',
    canonical: 'spatial_rule_horror',
    legacy: 'rule_horror',
    label: '《玩家请上车》· 空间规则怪谈与心理压榨',
    defaultSceneType: 'cliffhanger_reveal',
    mechanisms: ['rule_verification', 'spatial_claustrophobia', 'countdown_tension']
  },
  {
    familyId: 'suspense',
    familyTitle: '悬疑惊悚',
    canonical: 'folklore_investigation',
    legacy: 'folklore_investigation',
    label: '悬疑惊悚 · 民俗异闻与心理递进通用',
    defaultSceneType: 'cliffhanger_reveal',
    mechanisms: ['stepwise_anomaly', 'cognitive_misdirection']
  },

  // 历史古代
  {
    familyId: 'history',
    familyTitle: '历史古代',
    canonical: 'dynasty_legion_grand_strategy',
    legacy: 'dynasty_friction',
    label: '《神话版三国》· 军团大阵与天下大势',
    defaultSceneType: 'action_conflict',
    mechanisms: ['formation_battlefield', 'grand_strategy', 'bureaucracy_inertia']
  },
  {
    familyId: 'history',
    familyTitle: '历史古代',
    canonical: 'covert_cipher_camouflage',
    legacy: 'spy_years',
    label: '《我的谍战岁月》· 隐蔽战线密电破译与伪装',
    defaultSceneType: 'dialogue_game',
    mechanisms: ['covert_camouflage', 'surveillance_countermeasures', 'dual_identity']
  },

  // 西方奇幻
  {
    familyId: 'western_fantasy',
    familyTitle: '西方奇幻',
    canonical: 'potion_sequence_order_cost',
    legacy: 'sequence_cost',
    label: '《诡秘序列》· 秩序隐秘与魔药代价',
    defaultSceneType: 'comprehension_turning',
    mechanisms: ['mystical_cost', 'order_entropy', 'ritual_conditions']
  },
  {
    familyId: 'western_fantasy',
    familyTitle: '西方奇幻',
    canonical: 'machinist_blueprint_forging',
    legacy: 'super_mechanic',
    label: '《超神机械师》· 机械图纸锻造与智械军团',
    defaultSceneType: 'action_conflict',
    mechanisms: ['blueprint_crafting', 'tactical_firepower', 'tech_tree']
  },
  {
    familyId: 'western_fantasy',
    familyTitle: '西方奇幻',
    canonical: 'hunter_contract_combat',
    legacy: 'reincarnation_paradise',
    label: '《轮回乐园》· 猎杀者契约与刀术搏杀',
    defaultSceneType: 'action_conflict',
    mechanisms: ['ruthless_efficiency', 'contract_execution', 'physical_lethality']
  },

  // 古言世情
  {
    familyId: 'ancient_romance',
    familyTitle: '古言世情',
    canonical: 'mansion_financial_survival',
    legacy: 'mansion_secrets',
    label: '《深宅利益世情》· 月例账目与内宅生存策略',
    defaultSceneType: 'dialogue_game',
    mechanisms: ['household_accounting', 'etiquette_constraint', 'subtle_retaliation']
  },

  // 现代言情
  {
    familyId: 'modern_romance',
    familyTitle: '现代言情',
    canonical: 'corporate_duel_subtle_romance',
    legacy: 'urban_emotion',
    label: '《职场博弈心动》· 投行对赌与势均力敌情感',
    defaultSceneType: 'dialogue_game',
    mechanisms: ['corporate_due_diligence', 'emotional_subtext', 'professional_boundaries']
  },

  // 通用现实
  {
    familyId: 'universal',
    familyTitle: '通用现实',
    canonical: 'neutral_dramatic_realism',
    legacy: 'neutral_dramatic',
    label: '通用现实 · 生活本相与克制叙事',
    defaultSceneType: 'narrative',
    mechanisms: ['human_texture', 'behavioral_hesitation', 'grounded_observation']
  }
];

// 构建快速索引映射
const ROUTE_BY_KEY = new Map();
const FAMILY_ROUTES_MAP = new Map();
const SUBCATEGORY_TO_FAMILY = new Map();

for (const def of ROUTE_DEFINITIONS) {
  ROUTE_BY_KEY.set(def.canonical.toLowerCase(), def);
  ROUTE_BY_KEY.set(def.legacy.toLowerCase(), def);

  if (!FAMILY_ROUTES_MAP.has(def.familyId)) {
    FAMILY_ROUTES_MAP.set(def.familyId, []);
  }
  FAMILY_ROUTES_MAP.get(def.familyId).push(def);

  if (!FAMILY_ROUTES_MAP.has(def.familyTitle)) {
    FAMILY_ROUTES_MAP.set(def.familyTitle, []);
  }
  FAMILY_ROUTES_MAP.get(def.familyTitle).push(def);
}

// 建立子分类索引
for (const [fId, family] of Object.entries(GENRE_CATALOG)) {
  for (const sub of family.subcategories || []) {
    SUBCATEGORY_TO_FAMILY.set(sub.toLowerCase(), {
      familyId: family.id,
      familyTitle: family.title
    });
  }
}

/**
 * 根据任意 route 标识（canonical 或 legacy）精确反查题材母类
 */
function findFamilyByRoute(route) {
  if (!route || route === 'auto') return null;
  const key = String(route).trim().toLowerCase();
  const def = ROUTE_BY_KEY.get(key);
  if (!def) return null;
  return {
    familyId: def.familyId,
    familyTitle: def.familyTitle,
    routeDef: def
  };
}

/**
 * 根据子类名称查找题材母类
 */
function findFamilyBySubcategory(subcategory) {
  if (!subcategory) return null;
  const key = String(subcategory).trim().toLowerCase();
  return SUBCATEGORY_TO_FAMILY.get(key) || null;
}

/**
 * 获取规范化的 canonical route 标识
 */
function getCanonicalRoute(route) {
  if (!route || route === 'auto') return 'auto';
  const def = ROUTE_BY_KEY.get(String(route).trim().toLowerCase());
  return def ? def.canonical : route;
}

/**
 * 获取兼容历史的 legacy route 标识
 */
function getLegacyRoute(route) {
  if (!route || route === 'auto') return 'auto';
  const def = ROUTE_BY_KEY.get(String(route).trim().toLowerCase());
  return def ? def.legacy : route;
}

/**
 * 构建兼容 GENRE_FAMILIES 且挂载完整 routes 数组的母类注册表
 */
function buildGenreFamiliesWithRoutes() {
  const result = {};
  for (const [key, catalog] of Object.entries(GENRE_CATALOG)) {
    const titleKey = catalog.title;
    const routesList = (FAMILY_ROUTES_MAP.get(catalog.id) || []).map(r => ({
      id: r.canonical,
      value: r.canonical,
      legacyValue: r.legacy,
      label: r.label,
      defaultSceneType: r.defaultSceneType,
      mechanisms: r.mechanisms
    }));

    const entry = {
      id: catalog.id,
      title: catalog.title,
      subcategories: [...catalog.subcategories],
      defaultRoute: catalog.defaultRoute,
      routes: routesList
    };

    result[titleKey] = entry;
    result[catalog.id] = entry;
  }
  return result;
}

const GENRE_FAMILIES_WITH_ROUTES = Object.freeze(buildGenreFamiliesWithRoutes());

module.exports = {
  ROUTE_DEFINITIONS,
  findFamilyByRoute,
  findFamilyBySubcategory,
  getCanonicalRoute,
  getLegacyRoute,
  GENRE_FAMILIES_WITH_ROUTES
};
